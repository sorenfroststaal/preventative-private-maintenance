import { lstat, mkdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { atomicJson, isCloudPath, openArchive, type Archive } from './archive';
import { createBackup, restoreBackup } from './backup/backup';
import { today } from './domain/dates';
import { importArchiveDocument } from './node-documents';
import { documentLimit, documentPath, listDocuments } from './repo/documents';
import { completeTask, createTask, openTasks, postponeTask } from './repo/tasks';
import { listRecords, saveRecord, setArchived } from './repo/records';
import { writeLink } from './repo/links';
import { dashboard, history, vehicleCosts } from './repo/overview';
import { searchRecords } from './repo/search';
import { importBank, parseBank, previewBank, profileSchema, type Profile } from './import/bank';
import { insideArchive } from './scoped-path';
import { insuranceReport } from './report/insurance';
import { startInbox } from './import/inbox';
import { exportFile } from './report/export';
import { authenticate, createPerson, createUser, listUsers } from './repo/users';

const configDir = process.argv[2];
if (!configDir) throw new Error('Konfigurationsmappen mangler.');
const configPath = join(configDir, 'config.json');
const configSchema = z.object({ archivePath: z.string(), lastUserId: z.string().optional() });
let archive: Archive | undefined;
let userId: string | undefined;
let inbox: ReturnType<typeof startInbox> | undefined;
let pendingBank: { rows: ReturnType<typeof parseBank>; name: string; bytes: Buffer<ArrayBuffer>; account: string; profile: Profile } | undefined;

async function settings() {
  try {
    return configSchema.parse(JSON.parse(await readFile(configPath, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function saveConfig(path: string, lastUserId?: string) {
  await mkdir(configDir, { recursive: true });
  await atomicJson(configPath, { archivePath: path, lastUserId });
}

const pathSchema = z.string().min(1);
const request = z.object({ action: z.string(), data: z.unknown().optional() });

async function call(action: string, data: unknown) {
  if (action === 'config') return settings();
  if (action === 'open' || action === 'openRecent') {
    const { path: chosen, create, stale, cloud } = z.object({
      path: pathSchema.nullable(), create: z.boolean(), stale: z.boolean().optional(), cloud: z.boolean().optional(),
    }).parse(data);
    const path = action === 'openRecent' ? (await settings())?.archivePath : chosen;
    if (!path) throw new Error('Der er intet valgt arkiv.');
    if (isCloudPath(path) && !cloud) return { cloud: true };
    await inbox?.stop();
    inbox = undefined;
    if (archive) await archive.close();
    archive = undefined;
    userId = undefined;
    pendingBank = undefined;
    archive = await openArchive(path, { create: action === 'open' && create, confirmStale: async () => Boolean(stale) });
    if (!archive.readonly) inbox = startInbox(archive);
    const last = await settings();
    const lastUserId = last?.archivePath === archive.root ? last.lastUserId : undefined;
    await saveConfig(archive.root, lastUserId);
    return { users: archive.readonly ? [] : await listUsers(archive.db), readonly: archive.readonly, lastUserId };
  }
  if (!archive) throw new Error('Åbn et arkiv først.');
  if (archive.readonly) throw new Error('Arkivet er skrivebeskyttet.');
  const { db } = archive;
  if (action === 'login') {
    const credentials = z.object({ id: z.uuid(), pin: z.string() }).parse(data);
    if (!await authenticate(db, credentials.id, credentials.pin)) throw new Error('PIN-koden er forkert.');
    userId = credentials.id;
    await saveConfig(archive.root, userId);
    return true;
  }
  if (action === 'createUser') {
    const id = await createUser(db, data, userId);
    return { id, users: await listUsers(db) };
  }
  if (!userId) throw new Error('Vælg en bruger først.');
  const ctx = { via: 'ui', userId } as const;
  switch (action) {
    case 'logout': userId = undefined; pendingBank = undefined; return true;
    case 'createPerson': return createPerson(db, data, userId);
    case 'backupDue': {
      const [row] = await db.select<{ value_json: string }>("SELECT value_json FROM setting WHERE key = 'backup.last_at'");
      const previous = row ? Date.parse(JSON.parse(row.value_json)) : Date.parse(archive.manifest.createdAt);
      return Date.now() - previous > 30 * 86400000;
    }
    case 'dashboard': return dashboard(db, userId, today());
    case 'report': return insuranceReport(archive, data);
    case 'inbox': return inbox?.warnings() ?? [];
    case 'previewDocument': {
      const id = z.uuid().parse(data);
      const doc = (await listDocuments(db)).find(d => d.id === id);
      if (!doc) throw new Error('Bilaget er ikke tilgængeligt.');
      const [record] = await db.select<{ mime: string; size_bytes: number; extracted_text: string | null }>(
        'SELECT mime, size_bytes, extracted_text FROM document WHERE id = ?', [id]);
      if (!['application/pdf', 'image/png', 'image/jpeg'].includes(record.mime) || record.size_bytes > 10_000_000) {
        return { text: record.extracted_text };
      }
      const path = await insideArchive(archive.root, join(archive.root, documentPath(doc.sha256, doc.ext)));
      if ((await lstat(path)).size > 10_000_000) return { text: record.extracted_text };
      return { mime: record.mime, base64: (await readFile(path)).toString('base64'), text: record.extracted_text };
    }
    case 'export': return exportFile(archive, data, userId);
    case 'bankPreview': {
      pendingBank = undefined;
      const { path, account, profile } = z.object({ path: pathSchema, account: z.uuid(), profile: profileSchema }).parse(data);
      const stat = await lstat(path);
      if (!stat.isFile() || stat.size > 10_000_000 || !/\.csv$/i.test(path)) throw new Error('Vælg en CSV-fil på højst 10 MB.');
      const bytes = await readFile(path);
      const rows = parseBank(bytes, profile, account);
      pendingBank = { rows, account, profile, bytes, name: basename(path) };
      return previewBank(db, account, rows);
    }
    case 'bankApply': {
      if (!pendingBank) throw new Error('Vis en forhåndsvisning før import.');
      const { rows, account, profile, name, bytes } = pendingBank;
      const selectedArchive = archive;
      const result = await importBank(db, account, rows, profile, { ...ctx, via: 'import' },
        async tx => (await importArchiveDocument(selectedArchive, name, bytes, { ...ctx, via: 'import' }, 'bank_import', tx)).id);
      pendingBank = undefined;
      return result;
    }
    case 'tasks': return openTasks(db, userId);
    case 'records': return data === 'person'
      ? db.select('SELECT id, name FROM person WHERE archived_at IS NULL ORDER BY name')
      : listRecords(db, data, ctx);
    case 'vehicleCosts': {
      const { id, year } = z.object({ id: z.uuid(), year: z.number().int().min(1900).max(9999) }).parse(data);
      return vehicleCosts(db, id, year);
    }
    case 'history': {
      const { type, id } = z.object({ type: z.enum(['vehicle', 'item', 'building_part', 'work_order']), id: z.uuid() }).parse(data);
      return history(db, type, id);
    }
    case 'search': return searchRecords(db, data, userId);
    case 'saveRecord': {
      const input = z.object({ type: z.string(), values: z.unknown(), id: z.uuid().optional() }).parse(data);
      return saveRecord(db, input.type, input.values, ctx, input.id);
    }
    case 'archiveRecord': {
      const input = z.object({ type: z.string(), id: z.uuid(), archive: z.boolean() }).parse(data);
      return setArchived(db, input.type, input.id, input.archive, ctx);
    }
    case 'linkRecord':
    case 'unlinkRecord': {
      const input = z.object({ type: z.string(), key: z.unknown() }).parse(data);
      return writeLink(db, input.type, input.key, action === 'unlinkRecord', ctx);
    }
    case 'createTask': return createTask(db, data, ctx);
    case 'completeTask': {
      const { id, status } = z.object({ id: z.uuid(), status: z.enum(['done', 'skipped']) }).parse(data);
      return completeTask(db, id, status, today(), ctx);
    }
    case 'postponeTask': {
      const { id, date } = z.object({ id: z.uuid(), date: z.string() }).parse(data);
      return postponeTask(db, id, date, ctx);
    }
    case 'documentLinks': {
      const input = z.object({ type: z.enum(['item', 'work_order', 'policy', 'vehicle', 'building_part']), id: z.uuid() }).parse(data);
      const documents = await listDocuments(db);
      const ids = new Set(documents.map(doc => doc.id));
      const links = await db.select<{ document_id: string; role: string; title: string }>(`SELECT l.document_id, l.role, d.title
        FROM document_link l JOIN document d ON d.id = l.document_id WHERE l.target_type = ? AND l.target_id = ?`, [input.type, input.id]);
      return { documents, links: links.filter(l => ids.has(l.document_id)) };
    }
    case 'documents': return listDocuments(db);
    case 'import': {
      const path = pathSchema.parse(data);
      const info = await lstat(path);
      if (!info.isFile()) throw new Error('Vælg en almindelig fil.');
      if (info.size > documentLimit) throw new Error('Filen fylder mere end 100 MB.');
      return importArchiveDocument(archive, basename(path), await readFile(path), ctx);
    }
    case 'backup': return createBackup(archive, pathSchema.parse(data), ctx);
    case 'restore': {
      const path = pathSchema.parse(data);
      const target = archive.root;
      await inbox?.stop();
      inbox = undefined;
      await archive.close();
      archive = undefined;
      userId = undefined;
      return await restoreBackup(path, target) ?? true;
    }
    default: throw new Error('Ukendt handling.');
  }
}

try {
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    try {
      const { action, data } = request.parse(JSON.parse(line));
      const result = await call(action, data);
      console.log(JSON.stringify({ result: result ?? null }));
    } catch (error) {
      const message = error instanceof z.ZodError
        ? error.issues.map(({ path, message }) => `${path.join('.')}: ${message}`).join(' · ')
        : error instanceof Error ? error.message : 'Handlingen mislykkedes.';
      console.log(JSON.stringify({ error: message }));
    }
  }
} finally {
  await inbox?.stop();
  await archive?.close();
}

import { lstat, mkdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { atomicJson, isCloudPath, openArchive, type Archive } from './archive';
import { createBackup, restoreBackup } from './backup/backup';
import { today } from './domain/dates';
import { importArchiveDocument } from './node-documents';
import { documentLimit, listDocuments } from './repo/documents';
import { completeTask, createTask, openTasks } from './repo/tasks';
import { authenticate, createPerson, createUser, listUsers } from './repo/users';

const configDir = process.argv[2];
if (!configDir) throw new Error('Konfigurationsmappen mangler.');
const configPath = join(configDir, 'config.json');
const configSchema = z.object({ archivePath: z.string(), lastUserId: z.string().optional() });
let archive: Archive | undefined;
let userId: string | undefined;

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
  if (action === 'open') {
    const { path, create, stale, cloud } = z.object({
      path: pathSchema, create: z.boolean(), stale: z.boolean().optional(), cloud: z.boolean().optional(),
    }).parse(data);
    if (isCloudPath(path) && !cloud) return { cloud: true };
    if (archive) await archive.close();
    archive = undefined;
    userId = undefined;
    archive = await openArchive(path, { create, confirmStale: async () => Boolean(stale) });
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
    case 'logout': userId = undefined; return true;
    case 'createPerson': return createPerson(db, data, userId);
    case 'backupDue': {
      const [row] = await db.select<{ value_json: string }>("SELECT value_json FROM setting WHERE key = 'backup.last_at'");
      const previous = row ? Date.parse(JSON.parse(row.value_json)) : Date.parse(archive.manifest.createdAt);
      return Date.now() - previous > 30 * 86400000;
    }
    case 'tasks': return openTasks(db);
    case 'createTask': return createTask(db, data, ctx);
    case 'completeTask': {
      const { id, status } = z.object({ id: z.uuid(), status: z.enum(['done', 'skipped']) }).parse(data);
      return completeTask(db, id, status, today(), ctx);
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
  await archive?.close();
}

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { unzipSync, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireLock, archiveDirectories, migration, openArchive, type Archive } from './archive';
import { createBackup, restoreBackup } from './backup/backup';
import { BetterSqliteAdapter } from './db/better-sqlite';
import { migrate } from './db/migrate';
import { importArchiveDocument } from './node-documents';
import { nextDate } from './recurrence/next';
import { completeTask, createTask, openTasks } from './repo/tasks';
import { authenticate, createUser, listUsers } from './repo/users';

const ctx = { via: 'ui' } as const;
const bytes = (text: string) => new TextEncoder().encode(text);
let temp: string;
let archives: Archive[];

beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), 'ppm-test-'));
  archives = [];
});
afterEach(async () => {
  for (const archive of archives.reverse()) await archive.close();
  await rm(temp, { recursive: true, force: true });
});

async function createArchive() {
  const archive = await openArchive(join(temp, 'archive'), { create: true });
  archives.push(archive);
  return archive;
}

it('creates the archive layout and opens it again', async () => {
  const archive = await createArchive();
  expect(JSON.parse(await readFile(join(archive.root, 'manifest.json'), 'utf8'))).toMatchObject({
    format: 'ppm-archive', formatVersion: 1, schemaVersion: 1,
  });
  for (const dir of archiveDirectories) expect(await readdir(join(archive.root, dir))).toBeDefined();
  await archive.close();
  archives.pop();
  const reopened = await openArchive(archive.root);
  archives.push(reopened);
  expect(await reopened.db.select('PRAGMA journal_mode')).toEqual([{ journal_mode: 'wal' }]);
  expect(await reopened.db.select('PRAGMA foreign_keys')).toEqual([{ foreign_keys: 1 }]);
  expect(await reopened.db.select('PRAGMA busy_timeout')).toEqual([{ timeout: 5000 }]);
});

it('applies the exact first migration once', async () => {
  const sql = await migration();
  expect(sql).toBe(await readFile(new URL('../../../docs/spec/schema.sql', import.meta.url), 'utf8'));
  const db = new BetterSqliteAdapter(':memory:');
  try {
    await expect(migrate(db, sql)).resolves.toBe(1);
    const initial = await db.select('SELECT * FROM schema_migrations');
    const changes = await db.select('SELECT total_changes() AS count');
    await expect(migrate(db, sql)).resolves.toBe(1);
    expect(await db.select('SELECT * FROM schema_migrations')).toEqual(initial);
    expect(await db.select('SELECT total_changes() AS count')).toEqual(changes);
  } finally {
    db.close();
  }
});

it('rolls back a partially applied migration', async () => {
  const db = new BetterSqliteAdapter(':memory:');
  try {
    await expect(migrate(db, 'CREATE TABLE example (id INTEGER); INVALID SQL;')).rejects.toThrow();
    expect(await db.select("SELECT name FROM sqlite_master WHERE name = 'example'")).toEqual([]);
  } finally {
    db.close();
  }
});

it('opens a newer database read-only without changing its manifest', async () => {
  const archive = await createArchive();
  await archive.db.execute("INSERT INTO schema_migrations VALUES (2, '2026-11-24T18:10:00Z')");
  await archive.close();
  archives.pop();
  const reopen = await openArchive(archive.root);
  archives.push(reopen);
  expect(reopen.readonly).toBe(true);
  await expect(reopen.db.execute('DELETE FROM schema_migrations')).rejects.toThrow();
  expect(JSON.parse(await readFile(join(archive.root, 'manifest.json'), 'utf8')).schemaVersion).toBe(1);
});

it('refuses a second writer while a live process holds the lock', async () => {
  const archive = await createArchive();
  await expect(openArchive(archive.root, { confirmStale: async () => true })).rejects.toThrow('allerede åbent');
});

it('replaces a stale lock only after confirmation', async () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)']);
  await once(child, 'exit');
  const original = JSON.stringify({ pid: child.pid, hostname: hostname(), at: '2026-11-24T18:10:00Z' });
  const path = join(temp, '.lock');
  await writeFile(path, original);
  await expect(acquireLock(temp)).rejects.toThrow('forældede');
  expect(await readFile(path, 'utf8')).toBe(original);
  const release = await acquireLock(temp, async () => true);
  expect(JSON.parse(await readFile(path, 'utf8')).pid).toBe(process.pid);
  await release();
  expect(await readdir(temp)).toEqual([]);
});

it('stores immutable hash-addressed bytes and reuses the row across filenames', async () => {
  const archive = await createArchive();
  const data = bytes('Syntetisk bilag');
  const first = await importArchiveDocument(archive, 'demo.pdf', data, ctx);
  const duplicate = await importArchiveDocument(archive, 'demo.png', data, ctx);
  expect(duplicate).toMatchObject({ id: first.id, ext: 'pdf', duplicate: true });
  expect(new Uint8Array(await readFile(join(archive.root, 'bilag', first.sha256.slice(0, 2), first.sha256 + '.pdf')))).toEqual(data);
  expect(await archive.db.select('SELECT id FROM document')).toEqual([{ id: first.id }]);
});

describe('calendar recurrence', () => {
  it.each([
    ['2025-01-31', '2025-02-28'],
    ['2024-01-31', '2024-02-29'],
  ])('clamps %s to %s', (input, result) => {
    expect(nextDate({ kind: 'interval', unit: 'month', every: 1 }, input, input)).toBe(result);
  });
  it('uses completion for a six-month interval', () => {
    expect(nextDate({ kind: 'interval', unit: 'month', every: 6 }, '2026-03-01', '2026-03-15')).toBe('2026-09-15');
  });
  it('uses the previous due date for fixed annual recurrence', () => {
    expect(nextDate({ kind: 'fixed', unit: 'year', every: 1, month: 10, day: 1 }, '2026-10-01', '2026-11-20')).toBe('2027-10-01');
  });
  it('uses the first matching day when the initial monthly due date precedes it', () => {
    expect(nextDate({ kind: 'fixed', unit: 'month', every: 1, day: 20 }, '2026-03-10', '2026-04-15')).toBe('2026-03-20');
  });
  it('creates exactly one next occurrence on skip', async () => {
    const { db } = await createArchive();
    const { occurrenceId } = await createTask(db, {
      title: 'Demo', due_date: '2026-01-31', recurrence: { kind: 'interval', unit: 'month', every: 1 },
    }, ctx);
    await completeTask(db, occurrenceId, 'skipped', '2026-04-15', ctx);
    await expect(completeTask(db, occurrenceId, 'skipped', '2026-04-15', ctx)).rejects.toThrow();
    expect((await openTasks(db)).map(({ due_date }) => due_date)).toEqual(['2026-02-28']);
  });
});

it('audits and indexes task and document creation', async () => {
  const archive = await createArchive();
  await createTask(archive.db, { title: 'Tagrende', due_date: null }, ctx);
  await importArchiveDocument(archive, 'Tagrende.pdf', bytes('Demo'), ctx);
  expect(await archive.db.select('SELECT entity_type FROM audit_log ORDER BY rowid')).toEqual([
    { entity_type: 'task' }, { entity_type: 'task_occurrence' }, { entity_type: 'document' },
  ]);
  expect(await archive.db.select('SELECT entity_type FROM search_index WHERE search_index MATCH ?', ['Tagrende']))
    .toEqual([{ entity_type: 'task' }, { entity_type: 'document' }]);
});

it('requires the selected admin to create more users and verifies PIN without auditing secrets', async () => {
  const { db } = await createArchive();
  const id = await createUser(db, { name: 'Demo', personName: 'Testperson', pin: '1234' });
  await expect(authenticate(db, id, '1234')).resolves.toBe(true);
  await expect(authenticate(db, id, '0000')).resolves.toBe(false);
  await expect(createUser(db, { name: 'Bruger', personName: 'Testperson 2' })).rejects.toThrow('administrator');
  await createUser(db, { name: 'Bruger', personName: 'Testperson 2' }, id);
  expect(await listUsers(db)).toHaveLength(2);
  expect(JSON.stringify(await db.select('SELECT diff_json FROM audit_log'))).not.toMatch(/1234|pbkdf2/i);
});

it('round-trips a snapshot with three attachments and rejects a corrupt attachment before replacing the target', async () => {
  const archive = await createArchive();
  for (const example of ['Et', 'To', 'Tre']) await importArchiveDocument(archive, example + '.pdf', bytes(example), ctx);
  await writeFile(join(archive.root, 'indbakke', 'ignorer.txt'), 'Eksempel');
  const zip = await createBackup(archive, temp);
  const files = unzipSync(await readFile(zip));
  expect(Object.keys(files)).toHaveLength(5);
  const target = join(temp, 'restored');
  await restoreBackup(zip, target);
  const restored = await openArchive(target);
  archives.push(restored);
  expect(await restored.db.select('SELECT * FROM document ORDER BY filename')).toEqual(await archive.db.select('SELECT * FROM document ORDER BY filename'));
  for (const [name, data] of Object.entries(files).filter(([name]) => name.startsWith('bilag/'))) {
    expect(new Uint8Array(await readFile(join(target, name)))).toEqual(data);
  }
  expect(await readdir(join(target, 'indbakke'))).toEqual(['ai', 'importeret']);
  await restored.close();
  archives.pop();
  const corruptTarget = join(temp, 'unchanged');
  await mkdir(corruptTarget);
  await writeFile(join(corruptTarget, 'marker.txt'), 'Bevar');
  const corrupt = join(temp, 'corrupt.zip');
  const attachment = Object.keys(files).find((name) => name.startsWith('bilag/'))!;
  files[attachment] = bytes('Forkert indhold');
  await writeFile(corrupt, zipSync(files));
  await expect(restoreBackup(corrupt, corruptTarget)).rejects.toThrow(attachment);
  expect(await readdir(corruptTarget)).toEqual(['marker.txt']);
  expect(await readFile(join(corruptTarget, 'marker.txt'), 'utf8')).toBe('Bevar');
});

it('keeps foreign-host locks even after confirmation', async () => {
  const path = join(temp, '.lock');
  const lock = JSON.stringify({ pid: process.pid, hostname: 'synthetic-other-host', at: '2026-11-24T18:10:00Z' });
  await writeFile(path, lock);
  await expect(acquireLock(temp, async () => true)).rejects.toThrow();
  expect(await readFile(path, 'utf8')).toBe(lock);
});

it('allows only an archive-local snapshot and rejects ATTACH on every SQL entry point', async () => {
  const { db, root } = await createArchive();
  await expect(db.execute('ATTACH DATABASE ? AS external', [join(temp, 'external.sqlite')])).rejects.toThrow('ATTACH');
  await expect(db.executeScript("SELECT 1; ATTACH DATABASE ':memory:' AS external")).rejects.toThrow('ATTACH');
  await expect(db.select('VACUUM INTO ?', [join(temp, 'external.sqlite')])).rejects.toThrow('arkivet');
  await expect(db.execute('VACUUM INTO ?', [join(root, 'snapshot.sqlite')])).resolves.toBeDefined();
});

it('rejects a ZIP member that traverses out of the restore directory', async () => {
  const zip = join(temp, 'traversal.zip');
  const safe = zipSync({ 'AA/extra.txt': bytes('synthetic') });
  const modified = Buffer.from(safe);
  let offset = modified.indexOf('AA/extra.txt');
  while (offset !== -1) {
    modified.write('../extra.txt', offset);
    offset = modified.indexOf('AA/extra.txt');
  }
  await writeFile(zip, modified);
  await expect(restoreBackup(zip, join(temp, 'target'))).rejects.toThrow(/invalid relative path/i);
  expect(await readdir(temp)).toEqual(['traversal.zip']);
});

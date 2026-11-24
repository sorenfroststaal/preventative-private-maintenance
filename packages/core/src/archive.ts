import { mkdir, readFile, writeFile, rename, readdir, realpath, lstat, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { insideArchive } from './scoped-path';
import { BetterSqliteAdapter } from './db/better-sqlite';
import { databaseVersion, migrate, now, schemaVersion } from './db/migrate';

export const migration = () => readFile(process.env.PPM_RUNTIME_DIR ? join(process.env.PPM_RUNTIME_DIR, '0001_init.sql') : new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');
export const archiveDirectories = ['bilag', 'indbakke/importeret', 'indbakke/ai', 'eksport'];
export const manifestSchema = z.object({
  format: z.literal('ppm-archive'),
  formatVersion: z.literal(1),
  schemaVersion: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  appVersion: z.string(),
});
export type Manifest = z.infer<typeof manifestSchema>;

export async function atomicJson(path: string, value: object) {
  const temp = path + '.' + randomUUID();
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  try {
    await rename(temp, path);
  } catch (error) {
    await unlink(temp);
    throw error;
  }
}

async function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

const lockSchema = z.object({ pid: z.number().int().positive(), at: z.iso.datetime(), hostname: z.string().min(1).optional() });
export async function acquireLock(root: string, confirmStale?: () => Promise<boolean>) {
  const path = join(root, '.lock');
  const contents = JSON.stringify({ pid: process.pid, hostname: hostname(), at: now() });
  while (true) {
    try {
      await writeFile(path, contents, { flag: 'wx' });
      return async (directory = root) => {
        const lock = join(directory, '.lock');
        if (await readFile(lock, 'utf8') === contents) await unlink(lock);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const original = await readFile(path, 'utf8');
    const lock = lockSchema.parse(JSON.parse(original));
    if (lock.hostname !== hostname() || await processIsAlive(lock.pid)) throw new Error('Arkivet er allerede åbent.');
    if (!await confirmStale?.()) throw new Error('Bekræft fjernelse af den forældede arkivlås.');
    // Serialize stale-lock removal between competing openers.
    const guard = path + '.recovery';
    await writeFile(guard, contents, { flag: 'wx' });
    try {
      if (await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      }) === original) await unlink(path);
    } finally {
      await unlink(guard);
    }
  }
}

export function isCloudPath(path: string, oneDrive = process.env.OneDrive) {
  const normalized = path.replaceAll('\\', '/').toLowerCase();
  const prefix = oneDrive?.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
  return /(?:^|\/)(?:onedrive(?: - [^/]+)?|dropbox(?: \([^/]+\))?|google drive|icloud drive)(?:\/|$)/i.test(normalized)
    || Boolean(prefix && (normalized === prefix || normalized.startsWith(prefix + '/')));
}

export async function openArchive(path: string, options: { create?: boolean; confirmStale?: () => Promise<boolean> } = {}) {
  const requested = resolve(path);
  if (options.create) await mkdir(requested, { recursive: true });
  const root = await realpath(requested);
  const manifestPath = join(root, 'manifest.json');
  const databasePath = join(root, 'arkiv.sqlite');
  let release: (() => Promise<void>) | undefined;
  let db: BetterSqliteAdapter | undefined;
  try {
    let manifest: Manifest;
    if (options.create) {
      release = await acquireLock(root, options.confirmStale);
      if ((await readdir(root)).some((name) => name !== '.lock')) {
        throw new Error('Vælg en tom mappe til det nye arkiv.');
      }
      manifest = { format: 'ppm-archive', formatVersion: 1, schemaVersion, createdAt: now(), appVersion: '0.1.0' };
    } else {
      manifest = manifestSchema.parse(JSON.parse(await readFile(await insideArchive(root, manifestPath), 'utf8')));
      if (!(await lstat(databasePath)).isFile()) throw new Error('Arkivdatabasen mangler.');
      for (const name of ['arkiv.sqlite-wal', 'arkiv.sqlite-shm', 'arkiv.sqlite-journal', '.lock']) {
        const stat = await lstat(join(root, name)).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return undefined;
          throw error;
        });
        if (stat && !stat.isFile()) throw new Error('Arkivet indeholder en ugyldig fil: ' + name);
      }
      db = new BetterSqliteAdapter(databasePath, true);
      const version = await databaseVersion(db);
      if (Math.max(version, manifest.schemaVersion) > schemaVersion) {
        const readonlyDb = db;
        return { root, manifest, db: readonlyDb, readonly: true, close: async () => readonlyDb.close() };
      }
      db.close();
      db = undefined;
      release = await acquireLock(root, options.confirmStale);
    }
    db = new BetterSqliteAdapter(databasePath);
    const version = await migrate(db, await migration());
    if (version > schemaVersion) throw new Error('Arkivet blev opdateret, mens det blev åbnet.');
    if (options.create) {
      for (const name of archiveDirectories) await mkdir(join(root, name), { recursive: true });
    }
    if (options.create || manifest.schemaVersion !== version) {
      manifest.schemaVersion = version;
      await atomicJson(manifestPath, manifest);
    }
    const connection = db;
    return {
      root, manifest, db: connection, readonly: false,
      close: async () => {
        connection.close();
        await release?.();
      },
    };
  } catch (error) {
    db?.close();
    await release?.();
    throw error;
  }
}

export type Archive = Awaited<ReturnType<typeof openArchive>>;

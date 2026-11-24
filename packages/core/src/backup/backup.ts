import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { z } from 'zod';
import { archiveDirectories, manifestSchema, type Archive } from '../archive';
import { BetterSqliteAdapter } from '../db/better-sqlite';
import { databaseVersion, now } from '../db/migrate';
import { sha256 } from '../repo/documents';
import { recordChange, type WriteContext } from '../repo/write';

const attachment = /^bilag\/([a-f0-9]{2})\/\1[a-f0-9]{62}\.[a-z0-9]+$/;
const allowedPath = (path: string) => path === 'arkiv.sqlite' || attachment.test(path);
const backupManifest = manifestSchema.extend({
  files: z.array(z.object({ path: z.string().refine(allowedPath), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().nonnegative() })),
});

export async function createBackup(archive: Archive, destination: string, ctx: WriteContext = { via: 'system' }) {
  if (archive.readonly) throw new Error('Arkivet er skrivebeskyttet.');
  const temp = await mkdtemp(join(archive.root, '.backup-'));
  try {
    const snapshot = join(temp, 'arkiv.sqlite');
    await archive.db.execute('VACUUM INTO ?', [snapshot]);
    const db = new BetterSqliteAdapter(snapshot, true);
    let documents: { sha256: string; ext: string }[];
    try {
      documents = await db.select('SELECT sha256, ext FROM document');
    } finally {
      db.close();
    }
    const files: Record<string, Uint8Array<ArrayBuffer>> = { 'arkiv.sqlite': await readFile(snapshot) };
    for (const { sha256: hash, ext } of documents) {
      const path = `bilag/${hash.slice(0, 2)}/${hash}.${ext}`;
      if (!attachment.test(path)) throw new Error(`Ugyldig bilagssti: ${path}`);
      const bytes = await readFile(join(archive.root, path));
      if (await sha256(bytes) !== hash) throw new Error(`Bilaget er beskadiget: ${path}`);
      files[path] = bytes;
    }
    const checksums = await Promise.all(Object.entries(files).map(async ([path, bytes]) =>
      ({ path, sha256: await sha256(bytes), size: bytes.length })));
    files['manifest.json'] = strToU8(JSON.stringify({ ...archive.manifest, files: checksums }));
    const stamp = now().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const output = join(destination, `ppm-backup-${stamp}.zip`);
    await writeFile(output, zipSync(files), { flag: 'wx' });
    await archive.db.transaction(async (tx) => {
      const [before] = await tx.select<{ value_json: string }>('SELECT value_json FROM setting WHERE key = ?', ['backup.last_at']);
      const value = JSON.stringify(now());
      await tx.execute('INSERT INTO setting VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json', ['backup.last_at', value]);
      await recordChange(tx, ctx, 'setting', 'backup.last_at', before ?? null, { value_json: value });
    });
    return output;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export async function restoreBackup(zipPath: string, targetPath: string) {
  const target = resolve(targetPath);
  const temp = await mkdtemp(join(dirname(target), '.' + basename(target) + '-restore-'));
  try {
    const files = unzipSync(await readFile(zipPath), { filter: ({ name }) => name === 'manifest.json' || allowedPath(name) });
    if (!files['manifest.json']) throw new Error('manifest.json mangler.');
    const { files: entries, ...manifest } = backupManifest.parse(JSON.parse(strFromU8(files['manifest.json'])));
    const expected = new Set(entries.map(({ path }) => path));
    if (expected.size !== entries.length || !expected.has('arkiv.sqlite')) throw new Error('Manifestets filliste er ugyldig.');
    const failed = Object.keys(files).filter((path) => path !== 'manifest.json' && !expected.has(path));
    for (const { path, size, sha256: checksum } of entries) {
      const bytes = files[path];
      if (!bytes || bytes.length !== size || await sha256(new Uint8Array(bytes)) !== checksum ||
        (attachment.test(path) && !path.endsWith('/' + checksum + '.' + path.split('.').at(-1)))) failed.push(path);
    }
    if (failed.length) throw new Error('Kontrol af backup fejlede: ' + failed.join(', '));
    for (const { path } of entries) {
      const output = join(temp, path);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, files[path], { flag: 'wx' });
    }
    const db = new BetterSqliteAdapter(join(temp, 'arkiv.sqlite'), true);
    try {
      const integrity = await db.select<{ integrity_check: string }>('PRAGMA integrity_check');
      if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || await databaseVersion(db) !== manifest.schemaVersion) {
        throw new Error('Kontrol af arkiv.sqlite fejlede.');
      }
      const documents = await db.select<{ sha256: string; ext: string }>('SELECT sha256, ext FROM document');
      const missing = documents.map(({ sha256, ext }) => `bilag/${sha256.slice(0, 2)}/${sha256}.${ext}`).filter((path) => !expected.has(path));
      if (missing.length) throw new Error('Bilag mangler: ' + missing.join(', '));
    } finally {
      db.close();
    }
    for (const name of archiveDirectories) await mkdir(join(temp, name), { recursive: true });
    await writeFile(join(temp, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    const exists = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    let old: string | undefined;
    if (exists) {
      if (!exists.isDirectory()) throw new Error('Målet skal være en mappe.');
      if ((await readdir(target)).includes('.lock')) throw new Error('Luk arkivet inden gendannelse.');
      old = target + '.old-' + now().replace(/:/g, '') + '-' + crypto.randomUUID();
      await rename(target, old);
    }
    try {
      await rename(temp, target);
    } catch (error) {
      if (old) await rename(old, target);
      throw error;
    }
    return old;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

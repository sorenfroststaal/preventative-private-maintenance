import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, writeFile, link } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';
import { openPromise } from 'yauzl';
import { z } from 'zod';
import { archiveDirectories, manifestSchema, type Archive } from '../archive';
import { BetterSqliteAdapter } from '../db/better-sqlite';
import { databaseVersion, now } from '../db/migrate';
import { insideArchive } from '../scoped-path';
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
    const paths = ['arkiv.sqlite', ...documents.map(({ sha256, ext }) => `bilag/${sha256.slice(0, 2)}/${sha256}.${ext}`)];
    const checksums = [];
    const zip = new ZipFile();
    for (const path of paths) {
      if (!allowedPath(path)) throw new Error(`Ugyldig bilagssti: ${path}`);
      const source = path === 'arkiv.sqlite' ? snapshot : await insideArchive(archive.root, join(archive.root, path));
      const info = await checksum(source);
      if (!matchesName(path, info.sha256)) throw new Error(`Bilaget er beskadiget: ${path}`);
      checksums.push({ path, ...info });
      zip.addFile(source, path);
    }
    zip.addBuffer(Buffer.from(JSON.stringify({ ...archive.manifest, files: checksums })), 'manifest.json');
    const stamp = now().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const output = join(destination, `ppm-backup-${stamp}.zip`);
    const staging = join(destination, '.ppm-backup-' + crypto.randomUUID());
    try {
      const written = pipeline(zip.outputStream, createWriteStream(staging, { flags: 'wx' }));
      zip.end();
      await written;
      await link(staging, output);
    } finally {
      await rm(staging, { force: true });
    }
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

async function checksum(path: string) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha256: hash.digest('hex'), size };
}

function matchesName(path: string, hash: string) {
  return path === 'arkiv.sqlite' || path.split('/').at(-1)?.split('.')[0] === hash;
}

export async function restoreBackup(zipPath: string, targetPath: string) {
  const target = resolve(targetPath);
  const temp = await mkdtemp(target + '.restore-');
  try {
    const zip = await openPromise(zipPath, { strictFileNames: true });
    const actual = new Map<string, Awaited<ReturnType<typeof checksum>>>();
    const seen = new Set<string>();
    try {
      for await (const entry of zip.eachEntry()) {
        const path = entry.fileName;
        if ((path !== 'manifest.json' && !allowedPath(path)) || seen.has(path)) {
          throw new Error(`Ugyldig sti i backup: ${path}`);
        }
        if (path === 'manifest.json' && entry.uncompressedSize > 32 * 1024 * 1024) {
          throw new Error('Manifestet er for stort.');
        }
        seen.add(path);
        const output = join(temp, path);
        await mkdir(dirname(output), { recursive: true });
        await pipeline(await zip.openReadStreamPromise(entry), createWriteStream(output, { flags: 'wx' }));
        if (path !== 'manifest.json') actual.set(path, await checksum(output));
      }
    } finally {
      zip.close();
    }
    if (!seen.has('manifest.json')) throw new Error('manifest.json mangler.');
    const { files: entries, ...manifest } = backupManifest.parse(JSON.parse(await readFile(join(temp, 'manifest.json'), 'utf8')));
    const expected = new Set(entries.map(({ path }) => path));
    if (expected.size !== entries.length || !expected.has('arkiv.sqlite')) throw new Error('Manifestets filliste er ugyldig.');
    const failed = [...actual.keys()].filter((path) => !expected.has(path));
    for (const { path, size, sha256 } of entries) {
      const info = actual.get(path);
      if (!info || info.size !== size || info.sha256 !== sha256 || !matchesName(path, sha256)) failed.push(path);
    }
    if (failed.length) throw new Error('Kontrol af backup fejlede: ' + failed.join(', '));
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
    let removedEmpty = false;
    if (exists) {
      if (!exists.isDirectory()) throw new Error('Målet skal være en mappe.');
      const contents = await readdir(target);
      if (contents.includes('.lock')) throw new Error('Luk arkivet inden gendannelse.');
      if (contents.length === 0) {
        await rmdir(target);
        removedEmpty = true;
      } else {
        old = target + '.old-' + now().replace(/:/g, '') + '-' + crypto.randomUUID();
        await rename(target, old);
      }
    }
    try {
      await rename(temp, target);
    } catch (error) {
      if (old) await rename(old, target);
      else if (removedEmpty) await mkdir(target);
      throw error;
    }
    return old;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

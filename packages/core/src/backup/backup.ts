import type { Archive, Manifest } from "../archive/archive";
import { readManifest, writeManifest } from "../archive/archive";
import { readLock, isLockStale } from "../archive/lock";
import type { Env, ZipEntry } from "../env";
import { setSetting } from "../repo/settings";
import type { Ctx } from "../repo/entities";

export interface BackupResult {
  path: string;
  files: number;
  bytes: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function backupFileName(d: Date): string {
  return `ppm-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.zip`;
}

/** Recursively lists files under dir, returning paths relative to `base` with forward slashes. */
async function walk(env: Env, dir: string, rel: string): Promise<string[]> {
  if (!(await env.fs.exists(dir))) return [];
  const out: string[] = [];
  for (const e of await env.fs.listDir(dir)) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    const child = env.fs.join(dir, e.name);
    if (e.isDir) out.push(...(await walk(env, child, childRel)));
    else if (!e.name.endsWith(".part")) out.push(childRel);
  }
  return out.sort();
}

const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Writes a full backup zip (spec 02): a VACUUM INTO snapshot of the database, all
 * documents, and a manifest with checksums. The inbox is not included.
 */
export async function createBackup(env: Env, archive: Archive, ctx: Ctx, destDir: string): Promise<BackupResult> {
  const { fs } = env;
  const stamp = env.clock.now();
  await fs.mkdirp(destDir);
  const dest = fs.join(destDir, backupFileName(stamp));
  const snapshot = archive.path(`.backup-${stamp.getTime()}.sqlite`);
  const manifestTmp = archive.path(`.backup-${stamp.getTime()}.manifest.json`);
  try {
    await archive.db.execute(`VACUUM INTO ${sqlString(snapshot)}`);
    const files: NonNullable<Manifest["files"]> = [];
    const entries: ZipEntry[] = [];
    const snapStat = await fs.stat(snapshot);
    files.push({ path: "arkiv.sqlite", sha256: await fs.sha256File(snapshot), size: snapStat!.size });
    entries.push({ src: snapshot, name: "arkiv.sqlite" });
    for (const rel of await walk(env, archive.path("bilag"), "bilag")) {
      const abs = archive.path(rel);
      const st = await fs.stat(abs);
      files.push({ path: rel, sha256: await fs.sha256File(abs), size: st!.size });
      entries.push({ src: abs, name: rel });
    }
    const manifest: Manifest = { ...(await readManifest(env, archive.root)), files };
    await fs.writeText(manifestTmp, JSON.stringify(manifest, null, 2) + "\n");
    entries.push({ src: manifestTmp, name: "manifest.json" });
    await env.zip.zip(entries, dest);
    await setSetting(ctx, "backup.last_at", env.clock.nowIso());
    return { path: dest, files: files.length, bytes: files.reduce((a, f) => a + f.size, 0) };
  } finally {
    await fs.remove(snapshot).catch(() => undefined);
    await fs.remove(manifestTmp).catch(() => undefined);
  }
}

export class RestoreError extends Error {
  constructor(
    message: string,
    readonly failedFiles: string[] = [],
  ) {
    super(message);
    this.name = "RestoreError";
  }
}

/** Unpacks into a temp folder and verifies checksums and integrity. Returns the temp folder. */
export async function verifyBackup(env: Env, zipPath: string, tmpDir: string): Promise<Manifest> {
  const { fs } = env;
  await env.zip.unzip(zipPath, tmpDir);
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await fs.readText(fs.join(tmpDir, "manifest.json"))) as Manifest;
  } catch {
    throw new RestoreError("Backuppen indeholder ikke et gyldigt manifest.json.", ["manifest.json"]);
  }
  if (manifest.format !== "ppm-archive" || !Array.isArray(manifest.files)) {
    throw new RestoreError("Filen er ikke en PPM-backup.", ["manifest.json"]);
  }
  const failed: string[] = [];
  for (const f of manifest.files) {
    const abs = fs.join(tmpDir, ...f.path.split("/"));
    const st = await fs.stat(abs);
    if (!st || st.size !== f.size || (await fs.sha256File(abs)) !== f.sha256) failed.push(f.path);
  }
  if (!manifest.files.some((f) => f.path === "arkiv.sqlite")) failed.push("arkiv.sqlite");
  if (failed.length) throw new RestoreError("Backuppen er beskadiget. Disse filer fejlede kontrollen:", failed);

  const db = await env.openDb(fs.join(tmpDir, "arkiv.sqlite"));
  try {
    const r = await db.select<{ integrity_check: string }>("PRAGMA integrity_check");
    if (r[0]?.integrity_check !== "ok") {
      throw new RestoreError("Databasen i backuppen fejlede integritetskontrollen.", ["arkiv.sqlite"]);
    }
  } finally {
    await db.close();
  }
  return manifest;
}

export interface RestoreResult {
  target: string;
  previousMovedTo: string | null;
}

/**
 * Restores a backup into `target` (spec 02): unpack next to the target, verify, then
 * swap folders by rename. On any failure the target is left unchanged. The archive
 * must be closed by the caller first.
 */
export async function restoreBackup(env: Env, zipPath: string, target: string): Promise<RestoreResult> {
  const { fs } = env;
  const stamp = env.clock.now().getTime();
  const lock = await readLock(env, target).catch(() => null);
  if (lock && !(await isLockStale(env, lock))) {
    throw new RestoreError("Arkivet er åbent. Luk det, før du gendanner.");
  }
  const tmp = `${target}.restore-${stamp}`;
  try {
    const manifest = await verifyBackup(env, zipPath, tmp);
    for (const d of ["indbakke", "indbakke/importeret", "indbakke/ai", "eksport"]) {
      await fs.mkdirp(fs.join(tmp, ...d.split("/")));
    }
    await writeManifest(env, tmp, manifest); // strips the file list
  } catch (err) {
    await fs.remove(tmp, { recursive: true }).catch(() => undefined);
    throw err;
  }
  let previousMovedTo: string | null = null;
  if (await fs.exists(target)) {
    previousMovedTo = `${target}.old-${stamp}`;
    await fs.rename(target, previousMovedTo);
  }
  try {
    await fs.rename(tmp, target);
  } catch (err) {
    if (previousMovedTo) await fs.rename(previousMovedTo, target).catch(() => undefined);
    throw err;
  }
  return { target, previousMovedTo };
}

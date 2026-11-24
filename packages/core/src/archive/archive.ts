import { applyPragmas, type ClosableDb } from "../db/adapter";
import { APP_SCHEMA_VERSION, migrate } from "../db/migrate";
import type { Env } from "../env";
import { acquireLock, releaseLock } from "./lock";
import { seedDefaults } from "./defaults";
import { ArchiveError } from "./errors";

export { ArchiveError };

export const ARCHIVE_FORMAT = "ppm-archive";
export const ARCHIVE_FORMAT_VERSION = 1;

export const ARCHIVE_DIRS = [
  "bilag",
  "indbakke",
  "indbakke/importeret",
  "indbakke/ai",
  "eksport",
] as const;

export interface Manifest {
  format: typeof ARCHIVE_FORMAT;
  formatVersion: number;
  schemaVersion: number;
  createdAt: string;
  appVersion: string;
  files?: { path: string; sha256: string; size: number }[];
}

export interface Archive {
  root: string;
  db: ClosableDb;
  manifest: Manifest;
  readOnly: boolean;
  /** Path helper relative to the archive root (forward-slash parts). */
  path(...parts: string[]): string;
  close(): Promise<void>;
}

export interface OpenOptions {
  appVersion: string;
}

function archivePath(env: Env, root: string, ...parts: string[]): string {
  return env.fs.join(root, ...parts.flatMap((p) => p.split("/")));
}

/** Creates a new archive in an empty (or non-existent) folder. */
export async function createArchive(env: Env, root: string, opts: OpenOptions): Promise<Archive> {
  const { fs } = env;
  if (await fs.exists(root)) {
    const entries = await fs.listDir(root);
    if (entries.length > 0) {
      throw new ArchiveError("Mappen er ikke tom. Vælg en tom mappe til et nyt arkiv.", "not_empty");
    }
  }
  await fs.mkdirp(root);
  for (const d of ARCHIVE_DIRS) await fs.mkdirp(archivePath(env, root, d));
  const manifest: Manifest = {
    format: ARCHIVE_FORMAT,
    formatVersion: ARCHIVE_FORMAT_VERSION,
    schemaVersion: 0,
    createdAt: env.clock.nowIso(),
    appVersion: opts.appVersion,
  };
  await writeManifest(env, root, manifest);
  const archive = await openArchive(env, root, opts);
  await seedDefaults(env, archive.db);
  return archive;
}

export async function readManifest(env: Env, root: string): Promise<Manifest> {
  const p = archivePath(env, root, "manifest.json");
  if (!(await env.fs.exists(p))) {
    throw new ArchiveError("Mappen indeholder ikke et arkiv (manifest.json mangler).", "not_an_archive");
  }
  let m: Manifest;
  try {
    m = JSON.parse(await env.fs.readText(p)) as Manifest;
  } catch {
    throw new ArchiveError("manifest.json kan ikke læses.", "not_an_archive");
  }
  if (m.format !== ARCHIVE_FORMAT) {
    throw new ArchiveError("Mappen indeholder ikke et PPM-arkiv.", "not_an_archive");
  }
  if (m.formatVersion > ARCHIVE_FORMAT_VERSION) {
    throw new ArchiveError(
      `Arkivformat ${m.formatVersion} er nyere end programmet understøtter. Opdatér programmet.`,
      "unsupported_format",
    );
  }
  return m;
}

export async function writeManifest(env: Env, root: string, m: Manifest): Promise<void> {
  const { files: _files, ...rest } = m;
  await env.fs.writeText(archivePath(env, root, "manifest.json"), JSON.stringify(rest, null, 2) + "\n");
}

/**
 * Opens an existing archive: validates the manifest, takes the instance lock, applies
 * pragmas and migrations. If the database is newer than the program, the archive is
 * opened read-only (spec 02).
 */
export async function openArchive(env: Env, root: string, opts: OpenOptions): Promise<Archive> {
  const manifest = await readManifest(env, root);
  for (const d of ARCHIVE_DIRS) await env.fs.mkdirp(archivePath(env, root, d));
  await acquireLock(env, root);
  let db: ClosableDb | undefined;
  try {
    db = await env.openDb(archivePath(env, root, "arkiv.sqlite"));
    await applyPragmas(db);
    const result = await migrate(db, () => env.clock.nowIso());
    const readOnly = result.newerThanApp;
    if (!readOnly && manifest.schemaVersion !== result.to) {
      manifest.schemaVersion = result.to;
      manifest.appVersion = opts.appVersion;
      await writeManifest(env, root, manifest);
    }
    const opened = db;
    return {
      root,
      db: opened,
      manifest,
      readOnly,
      path: (...parts) => archivePath(env, root, ...parts),
      close: async () => {
        await opened.close();
        await releaseLock(env, root);
      },
    };
  } catch (err) {
    await db?.close().catch(() => undefined);
    await releaseLock(env, root).catch(() => undefined);
    throw err;
  }
}

export { APP_SCHEMA_VERSION };

const CLOUD_MARKERS = ["onedrive", "dropbox", "google drive", "googledrive", "icloud drive", "iclouddrive", "icloud"];

/**
 * Returns the name of a cloud-synced folder if the path appears to be inside one
 * (spec 02). `oneDriveEnv` is the value of the OneDrive environment variable(s).
 */
export function detectCloudFolder(path: string, oneDriveEnv: string[] = []): string | null {
  const norm = path.replace(/\\/g, "/").toLowerCase();
  for (const env of oneDriveEnv.filter(Boolean)) {
    const e = env.replace(/\\/g, "/").toLowerCase().replace(/\/$/, "");
    if (norm === e || norm.startsWith(e + "/")) return "OneDrive";
  }
  const segments = norm.split("/");
  for (const seg of segments) {
    for (const marker of CLOUD_MARKERS) {
      if (seg === marker || seg.startsWith(marker + " ") || seg.startsWith(marker + "-")) {
        if (marker.startsWith("onedrive")) return "OneDrive";
        if (marker.startsWith("dropbox")) return "Dropbox";
        if (marker.startsWith("google")) return "Google Drive";
        return "iCloud Drive";
      }
    }
  }
  return null;
}

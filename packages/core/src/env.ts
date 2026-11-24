import type { DbOpener } from "./db/adapter";

export interface FileStat {
  size: number;
  isDir: boolean;
  mtimeMs: number;
}

export interface DirEntry {
  name: string;
  isDir: boolean;
}

/**
 * File system operations used by core. Implemented with node:fs (MCP, tests, seed)
 * and with scoped Rust commands in the desktop app.
 */
export interface FileSystem {
  join(...parts: string[]): string;
  dirname(path: string): string;
  basename(path: string): string;
  readFile(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  writeText(path: string, text: string): Promise<void>;
  /** Creates the file only if it does not exist. Returns false if it already existed. */
  createExclusive(path: string, text: string): Promise<boolean>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileStat | null>;
  mkdirp(path: string): Promise<void>;
  listDir(path: string): Promise<DirEntry[]>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string, opts?: { recursive?: boolean }): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  /** Lowercase hex SHA-256 of the file contents (streamed by the implementation). */
  sha256File(path: string): Promise<string>;
}

export interface Platform {
  pid(): Promise<number>;
  isProcessAlive(pid: number): Promise<boolean>;
  hostname(): Promise<string>;
}

export interface ZipEntry {
  /** Absolute source path on disk. */
  src: string;
  /** Path inside the zip, always with forward slashes. */
  name: string;
}

export interface Zipper {
  zip(entries: ZipEntry[], dest: string): Promise<void>;
  /** Extracts into destDir and returns the entry names. MUST reject unsafe paths (zip slip). */
  unzip(src: string, destDir: string): Promise<string[]>;
}

export interface Clock {
  /** ISO 8601 UTC timestamp. */
  nowIso(): string;
  /** Today's local calendar date as YYYY-MM-DD (Europe/Copenhagen in the app). */
  today(): string;
  now(): Date;
}

export interface Env {
  fs: FileSystem;
  platform: Platform;
  zip: Zipper;
  openDb: DbOpener;
  clock: Clock;
  newId(): string;
}

export const systemClock: Clock = {
  nowIso: () => new Date().toISOString(),
  today: () => localDate(new Date()),
  now: () => new Date(),
};

export function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const randomId = (): string => globalThis.crypto.randomUUID();

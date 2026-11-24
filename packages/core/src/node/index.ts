import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, promises as fsp, constants as fsc } from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, join, resolve, sep, isAbsolute } from "node:path";
import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { nodePdfText } from "./pdftext";
import { SerializedDb, type ClosableDb, type RawExecutor, type SqlValue } from "../db/adapter";
import { randomId, systemClock, type Clock, type Env, type FileSystem, type Platform, type Zipper } from "../env";

class BetterSqliteExecutor implements RawExecutor {
  constructor(private readonly db: Database.Database) {}
  async select(sql: string, params: SqlValue[]) {
    const stmt = this.db.prepare(sql);
    if (!stmt.reader) {
      stmt.run(...params);
      return [];
    }
    return stmt.all(...params) as Record<string, unknown>[];
  }
  async execute(sql: string, params: SqlValue[]) {
    const stmt = this.db.prepare(sql);
    if (stmt.reader) {
      stmt.all(...params);
      return { rowsAffected: 0 };
    }
    return { rowsAffected: stmt.run(...params).changes };
  }
  async executeScript(sql: string) {
    this.db.exec(sql);
  }
  async close() {
    this.db.close();
  }
}

export async function openBetterSqlite(path: string, opts: { readonly?: boolean } = {}): Promise<ClosableDb> {
  const db = new Database(path, { readonly: opts.readonly ?? false, fileMustExist: opts.readonly ?? false });
  return new SerializedDb(new BetterSqliteExecutor(db));
}

export const nodeFs: FileSystem = {
  join: (...parts) => join(...parts),
  dirname: (p) => dirname(p),
  basename: (p) => basename(p),
  readFile: async (p) => new Uint8Array(await fsp.readFile(p)),
  readText: (p) => fsp.readFile(p, "utf8"),
  writeFile: async (p, data) => {
    await fsp.writeFile(p, data);
  },
  writeText: async (p, text) => {
    // Write-then-rename for atomic replacement.
    const tmp = `${p}.tmp-${process.pid}`;
    await fsp.writeFile(tmp, text, "utf8");
    await fsp.rename(tmp, p);
  },
  createExclusive: async (p, text) => {
    try {
      await fsp.writeFile(p, text, { flag: "wx" });
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw e;
    }
  },
  exists: async (p) => {
    try {
      await fsp.access(p, fsc.F_OK);
      return true;
    } catch {
      return false;
    }
  },
  stat: async (p) => {
    try {
      const s = await fsp.stat(p);
      return { size: s.size, isDir: s.isDirectory(), mtimeMs: s.mtimeMs };
    } catch {
      return null;
    }
  },
  mkdirp: async (p) => {
    await fsp.mkdir(p, { recursive: true });
  },
  listDir: async (p) => (await fsp.readdir(p, { withFileTypes: true })).map((d) => ({ name: d.name, isDir: d.isDirectory() })),
  rename: (a, b) => fsp.rename(a, b),
  remove: (p, opts) => fsp.rm(p, { recursive: opts?.recursive ?? false, force: true }),
  copyFile: (a, b) => fsp.copyFile(a, b),
  sha256File: (p) =>
    new Promise((res, rej) => {
      const h = createHash("sha256");
      createReadStream(p)
        .on("data", (c) => h.update(c))
        .on("error", rej)
        .on("end", () => res(h.digest("hex")));
    }),
};

export const nodePlatform: Platform = {
  pid: async () => process.pid,
  isProcessAlive: async (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "EPERM";
    }
  },
  hostname: async () => hostname(),
};

const STORED_EXT = new Set(["jpg", "jpeg", "png", "heic", "pdf", "zip"]);

/** Resolves a zip entry name inside destDir, rejecting zip-slip paths. */
export function safeJoin(destDir: string, name: string): string {
  if (!name || name.includes("\0") || name.includes("\\") || name.startsWith("/") || isAbsolute(name)) {
    throw new Error(`Ugyldigt filnavn i zip: ${name}`);
  }
  const parts = name.split("/");
  if (parts.some((p) => p === ".." || p === "." || /^[a-zA-Z]:$/.test(p))) {
    throw new Error(`Ugyldigt filnavn i zip: ${name}`);
  }
  const root = resolve(destDir);
  const full = resolve(root, ...parts);
  if (!full.startsWith(root + sep)) throw new Error(`Ugyldigt filnavn i zip: ${name}`);
  return full;
}

export const nodeZipper: Zipper = {
  zip: (entries, dest) =>
    new Promise<void>((res, rej) => {
      const out = createWriteStream(dest);
      out.on("error", rej);
      const zip = new Zip((err, chunk, final) => {
        if (err) return rej(err);
        out.write(chunk);
        if (final) out.end(() => res());
      });
      (async () => {
        for (const e of entries) {
          const ext = e.name.slice(e.name.lastIndexOf(".") + 1).toLowerCase();
          const file = STORED_EXT.has(ext) ? new ZipPassThrough(e.name) : new ZipDeflate(e.name, { level: 6 });
          zip.add(file);
          await new Promise<void>((r2, j2) => {
            const s = createReadStream(e.src);
            s.on("data", (c) => file.push(new Uint8Array(c as Buffer)));
            s.on("error", j2);
            s.on("end", () => {
              file.push(new Uint8Array(0), true);
              r2();
            });
          });
        }
        zip.end();
      })().catch(rej);
    }),
  unzip: async (src, destDir) => {
    await fsp.mkdir(destDir, { recursive: true });
    const names: string[] = [];
    const pending: Promise<void>[] = [];
    await new Promise<void>((res, rej) => {
      const unzip = new Unzip((file) => {
        if (file.name.endsWith("/")) return;
        let target: string;
        try {
          target = safeJoin(destDir, file.name);
        } catch (e) {
          rej(e);
          return;
        }
        names.push(file.name);
        // Must start synchronously inside the callback, before more data is pushed.
        mkdirSync(dirname(target), { recursive: true });
        const out = createWriteStream(target);
        pending.push(
          new Promise<void>((r2, j2) => {
            out.on("error", j2);
            file.ondata = (err, chunk, final) => {
              if (err) return j2(err);
              out.write(chunk);
              if (final) out.end(() => r2());
            };
          }),
        );
        file.start();
      });
      unzip.register(UnzipInflate);
      const s = createReadStream(src);
      s.on("data", (c) => unzip.push(new Uint8Array(c as Buffer)));
      s.on("error", rej);
      s.on("end", () => {
        unzip.push(new Uint8Array(0), true);
        res();
      });
    });
    await Promise.all(pending);
    return names;
  },
};

export function nodeEnv(overrides: Partial<Env> & { clock?: Clock } = {}): Env {
  return {
    fs: nodeFs,
    platform: nodePlatform,
    zip: nodeZipper,
    openDb: openBetterSqlite,
    clock: systemClock,
    newId: randomId,
    pdfText: nodePdfText,
    ...overrides,
  };
}

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promises as fsp } from "node:fs";
import {
  APP_SCHEMA_VERSION,
  ArchiveError,
  createArchive,
  detectCloudFolder,
  getSchemaVersion,
  migrate,
  openArchive,
  readManifest,
  removeStaleLock,
} from "../src";
import { migrations } from "../src/db/migrations.generated";
import { newArchive, tempDir, testEnv, track } from "./helpers";

const repoRoot = join(__dirname, "../../..");

describe("phase 1.2 – create and open archive", () => {
  it("creates manifest, folders and runs migration 0001", async () => {
    const { env, archive, root } = await newArchive();
    for (const d of ["bilag", "indbakke", "indbakke/importeret", "indbakke/ai", "eksport"]) {
      expect((await env.fs.stat(join(root, d)))?.isDir).toBe(true);
    }
    const m = await readManifest(env, root);
    expect(m).toMatchObject({ format: "ppm-archive", formatVersion: 1, schemaVersion: 2, appVersion: "0.1.0-test" });
    expect(await getSchemaVersion(archive.db)).toBe(2);
    const tables = await archive.db.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'");
    expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(["item", "task", "search_index", "ai_draft"]));
    const pragmas = await archive.db.select<{ journal_mode: string }>("PRAGMA journal_mode");
    expect(pragmas[0]?.journal_mode).toBe("wal");
    const fk = await archive.db.select<{ foreign_keys: number }>("PRAGMA foreign_keys");
    expect(fk[0]?.foreign_keys).toBe(1);
  });

  it("refuses to create an archive in a non-empty folder", async () => {
    const env = testEnv();
    const dir = tempDir();
    await fsp.writeFile(join(dir, "x.txt"), "x");
    await expect(createArchive(env, dir, { appVersion: "t" })).rejects.toMatchObject({ code: "not_empty" });
  });

  it("refuses to open a folder that is not an archive", async () => {
    await expect(openArchive(testEnv(), tempDir(), { appVersion: "t" })).rejects.toMatchObject({
      code: "not_an_archive",
    });
  });

  it("re-opens an existing archive with data intact", async () => {
    const { env, archive, root } = await newArchive();
    await archive.db.execute("INSERT INTO tag (id, name) VALUES ('00000000-0000-4000-8000-000000000001', 'x')");
    await archive.close();
    const again = track(await openArchive(env, root, { appVersion: "t" }));
    expect(await again.db.select("SELECT * FROM tag")).toHaveLength(1);
    expect(again.readOnly).toBe(false);
  });

  it("migration 0001 is identical to docs/spec/schema.sql", () => {
    const spec = readFileSync(join(repoRoot, "docs/spec/schema.sql"), "utf8");
    const file = readFileSync(join(repoRoot, "packages/core/migrations/0001_init.sql"), "utf8");
    expect(file).toBe(spec);
    expect(migrations[0]?.sql).toBe(spec);
  });
});

describe("phase 1.3 – migrations", () => {
  it("brings an empty database to the latest schemaVersion and a second run changes nothing", async () => {
    const env = testEnv();
    const db = await env.openDb(join(tempDir(), "x.sqlite"));
    const first = await migrate(db, () => env.clock.nowIso());
    expect(first).toMatchObject({ from: 0, to: APP_SCHEMA_VERSION, applied: [1, 2] });
    const schemaBefore = await db.select("SELECT type, name, sql FROM sqlite_master ORDER BY name");
    const second = await migrate(db, () => env.clock.nowIso());
    expect(second.applied).toEqual([]);
    expect(await db.select("SELECT type, name, sql FROM sqlite_master ORDER BY name")).toEqual(schemaBefore);
    expect(await db.select("SELECT * FROM schema_migrations")).toHaveLength(2);
    await db.close();
  });

  it("rolls back a failing migration completely", async () => {
    const env = testEnv();
    const db = await env.openDb(join(tempDir(), "x.sqlite"));
    await migrate(db, () => env.clock.nowIso());
    const bad = [...migrations, { version: 3, name: "0003_bad.sql", sql: "CREATE TABLE t2 (a); SELECT nope FROM missing;" }];
    await expect(migrate(db, () => env.clock.nowIso(), bad)).rejects.toThrow();
    expect(await getSchemaVersion(db)).toBe(2);
    expect(await db.select("SELECT name FROM sqlite_master WHERE name='t2'")).toHaveLength(0);
    await db.close();
  });

  it("opens a newer database read-only", async () => {
    const { env, archive, root } = await newArchive();
    await archive.db.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (99, 'x')");
    await archive.close();
    const again = track(await openArchive(env, root, { appVersion: "t" }));
    expect(again.readOnly).toBe(true);
  });
});

describe("phase 1.4 – instance lock", () => {
  it("prevents a second instance from opening the archive for writing", async () => {
    const { env, root } = await newArchive();
    // Another live process (same host) tries to open.
    const other = testEnv({
      platform: { pid: async () => 424242, isProcessAlive: async () => true, hostname: env.platform.hostname },
    });
    await expect(openArchive(other, root, { appVersion: "t" })).rejects.toMatchObject({ code: "locked" });
  });

  it("detects a stale lock and only removes it when asked", async () => {
    const env = testEnv();
    const { archive, root } = await newArchive(env);
    await archive.close();
    // Simulate a crashed process that left a lock behind.
    await fsp.writeFile(
      join(root, ".lock"),
      JSON.stringify({ pid: 999999, hostname: await env.platform.hostname(), at: "x" }),
    );
    const err = await openArchive(env, root, { appVersion: "t" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArchiveError);
    expect((err as ArchiveError).code).toBe("stale_lock");
    expect(await removeStaleLock(env, root)).toBe(true);
    track(await openArchive(env, root, { appVersion: "t" }));
  });

  it("does not remove a lock held by a live process", async () => {
    const { env, root } = await newArchive();
    expect(await removeStaleLock(env, root)).toBe(false);
    expect(await env.fs.exists(join(root, ".lock"))).toBe(true);
  });

  it("releases the lock on close", async () => {
    const { env, archive, root } = await newArchive();
    await archive.close();
    expect(await env.fs.exists(join(root, ".lock"))).toBe(false);
  });
});

describe("cloud folder warning", () => {
  it.each([
    ["C:\\Users\\a\\OneDrive\\Dokumenter\\PPM", "OneDrive"],
    ["C:\\Users\\a\\OneDrive - Firma\\PPM", "OneDrive"],
    ["/Users/a/Dropbox/PPM", "Dropbox"],
    ["G:\\Google Drive\\PPM", "Google Drive"],
    ["C:\\Users\\a\\Documents\\PPM", null],
  ])("%s → %s", (p, expected) => {
    expect(detectCloudFolder(p)).toBe(expected);
  });
  it("uses the OneDrive environment variable", () => {
    expect(detectCloudFolder("D:\\Sky\\PPM", ["D:\\Sky"])).toBe("OneDrive");
  });
});

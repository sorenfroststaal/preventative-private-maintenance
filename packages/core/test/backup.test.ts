import { describe, expect, it } from "vitest";
import { promises as fsp, readdirSync } from "node:fs";
import { join } from "node:path";
import { unzipSync, zipSync } from "fflate";
import {
  createBackup,
  createEntity,
  createTask,
  createUser,
  getSetting,
  importDocument,
  openArchive,
  restoreBackup,
  RestoreError,
  type DbAdapter,
} from "../src";
import { ctxFor, newArchive, tempDir, track, writeTempFile } from "./helpers";

async function dumpAll(db: DbAdapter): Promise<Record<string, unknown[]>> {
  const tables = await db.select<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'search_index_%' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  const out: Record<string, unknown[]> = {};
  for (const { name } of tables) out[name] = await db.select(`SELECT * FROM ${name} ORDER BY rowid`);
  return out;
}

async function seedSmall() {
  const { env, archive, root } = await newArchive();
  const ctx = ctxFor(env, archive);
  const { user } = await createUser(ctx, { name: "Anna", pin: "1234", isAdmin: true });
  const uctx = ctxFor(env, archive, String(user.id));
  const item = await createEntity(uctx, "item", { name: "Køleskab", purchase_price_minor: 499500 });
  await createTask(uctx, { title: "Afrim fryser", module: "home", recurrence: { kind: "interval", unit: "year", every: 1 } });
  const docs = [];
  for (const [name, body] of [
    ["kvittering.pdf", "%PDF-1.4 a"],
    ["foto.jpg", "\xff\xd8\xff b"],
    ["manual.pdf", "%PDF-1.4 c"],
  ] as const) {
    const src = await writeTempFile(name, body);
    docs.push((await importDocument(env, archive, uctx, src, { source: "drop" })).document);
  }
  return { env, archive, root, uctx, item, docs };
}

describe("phase 1.9 – backup and restore", () => {
  it("round-trips an archive with 3 documents: identical data and checksums", async () => {
    const { env, archive, root, uctx } = await seedSmall();
    const outDir = tempDir();
    const res = await createBackup(env, archive, uctx, outDir);
    expect(res.path).toMatch(/ppm-backup-\d{8}-\d{4}\.zip$/);
    expect(res.files).toBe(4); // db + 3 documents
    expect(await getSetting(archive.db, "backup.last_at")).toBeTruthy();

    // No temp files left in the archive.
    expect(readdirSync(root).filter((f) => f.startsWith(".backup"))).toEqual([]);

    const before = await dumpAll(archive.db);
    const bilagBefore = await listBilag(env, root);
    await archive.close();

    const target = join(tempDir(), "gendannet");
    const r = await restoreBackup(env, res.path, target);
    expect(r.previousMovedTo).toBeNull();
    const restored = track(await openArchive(env, target, { appVersion: "t" }));
    const after = await dumpAll(restored.db);
    // backup.last_at is written after the snapshot, so it is the only expected difference.
    const strip = (d: Record<string, unknown[]>) => ({
      ...d,
      setting: d.setting!.filter((s) => (s as { key: string }).key !== "backup.last_at"),
      audit_log: d.audit_log!.filter((a) => (a as { entity_id: string }).entity_id !== "backup.last_at"),
    });
    expect(strip(after)).toEqual(strip(before));
    expect(await listBilag(env, target)).toEqual(bilagBefore);
    // Restored manifest no longer carries the file list; inbox folders exist again.
    const manifest = JSON.parse(await fsp.readFile(join(target, "manifest.json"), "utf8"));
    expect(manifest.files).toBeUndefined();
    expect((await env.fs.stat(join(target, "indbakke", "ai")))?.isDir).toBe(true);
    // Search works in the restored archive.
    expect(await restored.db.select("SELECT * FROM search_index WHERE search_index MATCH 'køleskab'")).toHaveLength(1);
  });

  it("restoring over an existing archive moves the old one aside", async () => {
    const { env, archive, root, uctx } = await seedSmall();
    const res = await createBackup(env, archive, uctx, tempDir());
    await createEntity(uctx, "item", { name: "Efter backup" });
    await archive.close();
    const r = await restoreBackup(env, res.path, root);
    expect(r.previousMovedTo).toMatch(/\.old-\d+$/);
    expect(await env.fs.exists(r.previousMovedTo!)).toBe(true);
    const restored = track(await openArchive(env, root, { appVersion: "t" }));
    expect(await restored.db.select("SELECT * FROM item WHERE name = 'Efter backup'")).toHaveLength(0);
  });

  it("rejects a backup with a corrupted file and leaves the target unchanged", async () => {
    const { env, archive, root, uctx, docs } = await seedSmall();
    const res = await createBackup(env, archive, uctx, tempDir());
    await archive.close();

    const entries = unzipSync(new Uint8Array(await fsp.readFile(res.path)));
    const sha = String(docs[1]!.sha256);
    const name = `bilag/${sha.slice(0, 2)}/${sha}.jpg`;
    expect(entries[name]).toBeDefined();
    entries[name] = new TextEncoder().encode("tampered");
    const corrupt = join(tempDir(), "corrupt.zip");
    await fsp.writeFile(corrupt, zipSync(entries));

    const snapshotBefore = await listBilag(env, root);
    const manifestBefore = await fsp.readFile(join(root, "manifest.json"), "utf8");
    const err = await restoreBackup(env, corrupt, root).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RestoreError);
    expect((err as RestoreError).failedFiles).toEqual([name]);
    expect(await listBilag(env, root)).toEqual(snapshotBefore);
    expect(await fsp.readFile(join(root, "manifest.json"), "utf8")).toBe(manifestBefore);
    // No leftover temp folders next to the target.
    const siblings = readdirSync(join(root, "..")).filter((f) => f.includes(".restore-"));
    expect(siblings).toEqual([]);
  });

  it("rejects a backup with a corrupted database", async () => {
    const { env, archive, uctx } = await seedSmall();
    const res = await createBackup(env, archive, uctx, tempDir());
    const entries = unzipSync(new Uint8Array(await fsp.readFile(res.path)));
    const db = entries["arkiv.sqlite"]!;
    db[db.length - 100] = db[db.length - 100]! ^ 0xff;
    const corrupt = join(tempDir(), "corrupt.zip");
    await fsp.writeFile(corrupt, zipSync(entries));
    const err = await restoreBackup(env, corrupt, join(tempDir(), "x")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RestoreError);
    expect((err as RestoreError).failedFiles).toContain("arkiv.sqlite");
  });

  it("rejects zip-slip entries", async () => {
    const { env } = await seedSmall();
    const evil = join(tempDir(), "evil.zip");
    await fsp.writeFile(evil, zipSync({ "../escape.txt": new TextEncoder().encode("x"), "manifest.json": new Uint8Array() }));
    const target = join(tempDir(), "t");
    await expect(restoreBackup(env, evil, target)).rejects.toThrow(/Ugyldigt filnavn/);
    expect(await env.fs.exists(join(target, "..", "escape.txt"))).toBe(false);
  });

  it("refuses to restore into an archive that is open", async () => {
    const { env, archive, root, uctx } = await seedSmall();
    const res = await createBackup(env, archive, uctx, tempDir());
    await expect(restoreBackup(env, res.path, root)).rejects.toThrow(/åbent/);
  });
});

async function listBilag(env: import("../src").Env, root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string, rel: string) => {
    for (const e of await env.fs.listDir(dir)) {
      const p = join(dir, e.name);
      if (e.isDir) await walk(p, `${rel}/${e.name}`);
      else out[`${rel}/${e.name}`] = await env.fs.sha256File(p);
    }
  };
  await walk(join(root, "bilag"), "bilag");
  return out;
}

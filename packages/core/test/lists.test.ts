import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addTextListValue,
  createEntity,
  getSchemaVersion,
  linkDocument,
  migrate,
  removeTextListValue,
  renameTextListValue,
  textListValues,
} from "../src";
import { migrations } from "../src/db/migrations.generated";
import { ctxFor, newArchive, tempDir, testEnv, writeTempFile } from "./helpers";
import { importDocument } from "../src/repo/documents";

describe("migration 0003 – documents on spare parts", () => {
  it("rebuilds document_link with item_part allowed and keeps existing links", async () => {
    const env = testEnv();
    const db = await env.openDb(join(tempDir(), "v2.sqlite"));
    await migrate(db, () => env.clock.nowIso(), migrations.filter((m) => m.version <= 2));
    await db.execute("INSERT INTO document (id, sha256, filename, ext, mime, size_bytes, source, created_at) VALUES ('00000000-0000-4000-8000-000000000001', ?, 'a.pdf', 'pdf', 'application/pdf', 1, 'drop', 'x')", ["a".repeat(64)]);
    await db.execute("INSERT INTO document_link VALUES ('00000000-0000-4000-8000-000000000001', 'item', '00000000-0000-4000-8000-000000000002', 'receipt')");
    await expect(db.execute("INSERT INTO document_link VALUES ('00000000-0000-4000-8000-000000000001', 'item_part', 'x', 'photo')")).rejects.toThrow();
    await migrate(db, () => env.clock.nowIso());
    expect(await getSchemaVersion(db)).toBe(3);
    expect(await db.select("SELECT target_type, role FROM document_link")).toEqual([{ target_type: "item", role: "receipt" }]);
    await db.execute("INSERT INTO document_link VALUES ('00000000-0000-4000-8000-000000000001', 'item_part', 'x', 'photo')");
    expect(await db.select("SELECT name FROM sqlite_master WHERE name = 'idx_doclink_target'")).toHaveLength(1);
    expect(readFileSync(join(__dirname, "../migrations/0003_item_part_documents.sql"), "utf8")).toBe(migrations.find((m) => m.version === 3)!.sql);
    await db.close();
  });

  it("a photo can be linked to a spare part", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const item = await createEntity(ctx, "item", { name: "Emhætte" });
    const part = await createEntity(ctx, "item_part", { item_id: String(item.id), name: "Fedtfilter" });
    const png = await writeTempFile("filter.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
    const r = await importDocument(env, archive, ctx, png, { source: "drop" });
    await linkDocument(ctx, { document_id: String(r.document.id), target_type: "item_part", target_id: String(part.id), role: "photo" });
    expect(await archive.db.select("SELECT role FROM document_link WHERE target_type = 'item_part'")).toEqual([{ role: "photo" }]);
  });
});

describe("value lists behind dropdowns", () => {
  it("defaults plus values in use, add, rename everywhere with audit, and remove only when unused", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const values = async () => (await textListValues(archive.db, "item_category")).map((v) => `${v.value}:${v.used}`);
    expect(await values()).toContain("Hvidevarer:0");
    await createEntity(ctx, "item", { name: "TV", category: "elektronik" });
    await createEntity(ctx, "item", { name: "Robot", category: "Smarthome" });
    // Case-insensitive match with the stored value; an unknown value in use is included.
    expect(await values()).toEqual(expect.arrayContaining(["Elektronik:1", "Smarthome:1"]));
    expect(await addTextListValue(ctx, "item_category", " hvidevarer ")).toBe("Hvidevarer");
    await addTextListValue(ctx, "item_category", "Cykler");
    expect(await values()).toContain("Cykler:0");

    expect(await renameTextListValue(ctx, "item_category", "Smarthome", "Elektronik")).toBe(1);
    expect(await archive.db.select("SELECT name, category FROM item ORDER BY name")).toEqual([
      { name: "Robot", category: "Elektronik" },
      { name: "TV", category: "elektronik" },
    ]);
    expect((await archive.db.select<{ n: number }>("SELECT count(*) AS n FROM audit_log WHERE entity_type = 'item' AND action = 'update'"))[0]!.n).toBe(1);
    expect(await values()).not.toContain("Smarthome:0");

    await expect(removeTextListValue(ctx, "item_category", "Elektronik")).rejects.toThrow(/bruges af 2/);
    await removeTextListValue(ctx, "item_category", "Cykler");
    expect((await values()).some((v) => v.startsWith("Cykler"))).toBe(false);
    expect((await textListValues(archive.db, "building_part_kind")).map((v) => v.value)).toContain("Tag");
  });
});

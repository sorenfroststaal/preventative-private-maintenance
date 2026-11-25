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
  search,
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
    await migrate(db, () => env.clock.nowIso(), migrations.filter((m) => m.version <= 3));
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

describe("migration 0004 – pets", () => {
  it("adds pet, lets documents and insurance coverage point at a pet and keeps existing rows", async () => {
    const env = testEnv();
    const db = await env.openDb(join(tempDir(), "v3.sqlite"));
    await migrate(db, () => env.clock.nowIso(), migrations.filter((m) => m.version <= 3));
    await db.execute("INSERT INTO policy (id, kind, title, created_at) VALUES ('00000000-0000-4000-8000-0000000000a1', 'pet', 'Hundeforsikring', 'x')");
    await db.execute("INSERT INTO policy_coverage VALUES ('00000000-0000-4000-8000-0000000000a1', 'person', '00000000-0000-4000-8000-0000000000b1')");
    await migrate(db, () => env.clock.nowIso());
    expect(await getSchemaVersion(db)).toBe(migrations.length);
    expect(await db.select("SELECT target_type FROM policy_coverage")).toEqual([{ target_type: "person" }]);
    await db.execute("INSERT INTO pet (id, name, species, created_at) VALUES ('00000000-0000-4000-8000-0000000000c1', 'Fido', 'dog', 'x')");
    await db.execute("INSERT INTO policy_coverage VALUES ('00000000-0000-4000-8000-0000000000a1', 'pet', '00000000-0000-4000-8000-0000000000c1')");
    await expect(db.execute("INSERT INTO pet (id, name, species, created_at) VALUES ('00000000-0000-4000-8000-0000000000c2', 'X', 'dragon', 'x')")).rejects.toThrow();
    // Cascade still works after the rebuild.
    await db.execute("PRAGMA foreign_keys = ON");
    await db.execute("DELETE FROM policy WHERE id = '00000000-0000-4000-8000-0000000000a1'");
    expect(await db.select("SELECT * FROM policy_coverage")).toEqual([]);
    await db.close();
  });

  it("a pet is created with audit and found by search", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const vet = await createEntity(ctx, "contact", { name: "Eksempel Dyreklinik", kind: "other" });
    await createEntity(ctx, "pet", { name: "Fido", species: "dog", breed: "Eksempelrace", vet_contact_id: String(vet.id) });
    expect((await search(archive.db, "dyreklinik")).map((h) => h.type)).toContain("pet");
    expect((await archive.db.select<{ n: number }>("SELECT count(*) AS n FROM audit_log WHERE entity_type = 'pet'"))[0]!.n).toBe(1);
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

describe("dashboard: an invoice counts as receipt (feedback 25.11.2026)", () => {
  it("an item with a price and an invoice is not listed as missing a receipt", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const item = await createEntity(ctx, "item", { name: "Varmepumpe", purchase_price_minor: 2500000 });
    const { dashboard, isTempFolder } = await import("../src");
    const missing = async () => (await dashboard(archive.db, { today: "2026-11-24", userId: null })).missing.itemsWithoutReceipt.map((i) => i.name);
    expect(await missing()).toEqual(["Varmepumpe"]);
    const pdf = await writeTempFile("faktura.pdf", "%PDF-1.4 syntetisk faktura");
    const r = await importDocument(env, archive, ctx, pdf, { source: "drop" });
    await linkDocument(ctx, { document_id: String(r.document.id), target_type: "item", target_id: String(item.id), role: "invoice" });
    expect(await missing()).toEqual([]);
    expect(isTempFolder("C:\\tmp\\Ny mappe")).toBe(true);
    expect(isTempFolder("C:\\Users\\a\\AppData\\Local\\Temp\\x")).toBe(true);
    expect(isTempFolder("C:\\Users\\a\\Documents\\PPM-arkiv")).toBe(false);
  });
});

describe("migration 0005 – recurring expense priority", () => {
  it("adds priority 1-5 and keeps existing recurring expenses", async () => {
    const env = testEnv();
    const db = await env.openDb(join(tempDir(), "v4.sqlite"));
    await migrate(db, () => env.clock.nowIso(), migrations.filter((m) => m.version <= 4));
    await db.execute("INSERT INTO recurring_expense (id, name, amount_minor, period) VALUES ('00000000-0000-4000-8000-0000000000d1', 'Internet', 29900, 'month')");
    await migrate(db, () => env.clock.nowIso(), migrations.filter((m) => m.version <= 5));
    expect(await getSchemaVersion(db)).toBe(5);
    expect(await db.select("SELECT name, priority FROM recurring_expense")).toEqual([{ name: "Internet", priority: null }]);
    await db.execute("UPDATE recurring_expense SET priority = 4");
    await expect(db.execute("UPDATE recurring_expense SET priority = 9")).rejects.toThrow();
  });
});

describe("migration 0006 – loans, more documents and fields", () => {
  it("adds loan, documents on contacts/accounts/loans with new roles, loan transactions and new columns, keeping data", async () => {
    const env = testEnv();
    const db = await env.openDb(join(tempDir(), "v5.sqlite"));
    await migrate(db, () => env.clock.nowIso(), migrations.filter((m) => m.version <= 5));
    await db.execute("INSERT INTO document (id, sha256, filename, ext, mime, size_bytes, source, created_at) VALUES ('00000000-0000-4000-8000-0000000000e1', 'h', 'a.pdf', 'pdf', 'application/pdf', 1, 'drop', 'x')");
    await db.execute("INSERT INTO document_link VALUES ('00000000-0000-4000-8000-0000000000e1', 'item', '00000000-0000-4000-8000-0000000000e2', 'receipt')");
    await expect(db.execute("INSERT INTO document_link VALUES ('00000000-0000-4000-8000-0000000000e1', 'contact', '00000000-0000-4000-8000-0000000000e3', 'contract')")).rejects.toThrow();
    await migrate(db, () => env.clock.nowIso(), migrations.filter((m) => m.version <= 6));
    expect(await getSchemaVersion(db)).toBe(6);
    expect(await db.select("SELECT target_type, role FROM document_link")).toEqual([{ target_type: "item", role: "receipt" }]);
    for (const [t, role] of [["contact", "contract"], ["account", "certificate"], ["loan", "warranty"]] as const)
      await db.execute("INSERT INTO document_link VALUES ('00000000-0000-4000-8000-0000000000e1', ?, '00000000-0000-4000-8000-0000000000e3', ?)", [t, role]);
    await db.execute("INSERT INTO loan (id, name, kind, created_at) VALUES ('00000000-0000-4000-8000-0000000000f1', 'Boliglån', 'mortgage', 'x')");
    await expect(db.execute("INSERT INTO loan (id, name, kind, created_at) VALUES ('00000000-0000-4000-8000-0000000000f2', 'X', 'payday', 'x')")).rejects.toThrow();
    await db.execute("INSERT INTO account (id, name) VALUES ('00000000-0000-4000-8000-0000000000a9', 'K')");
    await db.execute("INSERT INTO bank_transaction (id, account_id, booking_date, text, amount_minor, dedupe_hash) VALUES ('00000000-0000-4000-8000-0000000000b9', '00000000-0000-4000-8000-0000000000a9', '2026-11-01', 'Afdrag', -500000, 'h1')");
    await db.execute("INSERT INTO transaction_link VALUES ('00000000-0000-4000-8000-0000000000b9', 'loan', '00000000-0000-4000-8000-0000000000f1')");
    await db.execute("DELETE FROM bank_transaction");
    expect(await db.select("SELECT * FROM transaction_link")).toEqual([]); // ON DELETE CASCADE kept
    await db.execute("INSERT INTO recurring_expense (id, name, amount_minor, period) VALUES ('00000000-0000-4000-8000-0000000000d2', 'El', 90000, 'month')");
    expect(await db.select("SELECT amount_variable, end_date, property_id, vehicle_id FROM recurring_expense")).toEqual([{ amount_variable: 0, end_date: null, property_id: null, vehicle_id: null }]);
    await expect(db.execute("UPDATE recurring_expense SET amount_variable = 2")).rejects.toThrow();
    expect(await db.select("SELECT purchase_date, purchase_price_minor FROM vehicle")).toEqual([]);
    await db.execute("INSERT INTO vehicle (id, name, purchase_date, purchase_price_minor, created_at) VALUES ('00000000-0000-4000-8000-0000000000c9', 'Bil', '2024-03-01', 18000000, 'x')");
  });
});


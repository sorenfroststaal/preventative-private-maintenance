import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  createEntity,
  createOutsidePerson,
  deleteItemsPermanently,
  deletionImpact,
  disposeItems,
  getSchemaVersion,
  itemTree,
  lendItem,
  listArchivedItems,
  listGifts,
  migrate,
  restoreItems,
  search,
} from "../src";
import { ctxFor, newArchive, tempDir, testEnv } from "./helpers";
import { migrations } from "../src/db/migrations.generated";

const DOC = "00000000-0000-4000-8000-00000000d0c1";

describe("migration 0013 – item disposal", () => {
  it("adds the disposal columns with their rules", async () => {
    const env = testEnv();
    const db = await env.openDb(join(tempDir(), "v12.sqlite"));
    await migrate(db, () => env.clock.nowIso(), migrations.filter((m) => m.version <= 12));
    await db.execute("INSERT INTO item (id, name, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000001', 'Cykel', 'x', 'x')");
    await migrate(db, () => env.clock.nowIso(), migrations.filter((m) => m.version <= 13));
    expect(await getSchemaVersion(db)).toBe(13);
    expect(await db.select("SELECT disposal_kind, disposal_date, disposal_price_minor, disposal_person_id, disposal_note FROM item")).toEqual([
      { disposal_kind: null, disposal_date: null, disposal_price_minor: null, disposal_person_id: null, disposal_note: null },
    ]);
    await expect(db.execute("UPDATE item SET disposal_kind = 'stolen'")).rejects.toThrow();
  });
});

describe("disposing of items", () => {
  it("archives with a reason (sold, given to, discarded), keeps them findable in the archive and restores them", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const db = archive.db;
    const karl = await createOutsidePerson(ctx, "Karl Ven");
    const bike = await createEntity(ctx, "item", { name: "Cykel", brand: "Eksempel Cykler" });
    const lamp = await createEntity(ctx, "item", { name: "Lampe" });
    const sofa = await createEntity(ctx, "item", { name: "Sofa" });
    await createEntity(ctx, "item", { name: "Ringeklokke", parent_item_id: String(bike.id), component_role: "accessory" });

    await expect(disposeItems(ctx, [String(lamp.id)], { kind: "given_to" })).rejects.toThrow(/hvem tingen er givet til/);
    await expect(disposeItems(ctx, [String(lamp.id)], { kind: "sold", priceMinor: -1 })).rejects.toThrow(/negativ/);

    await disposeItems(ctx, [String(bike.id)], { kind: "sold", priceMinor: 125000, personId: String(karl.id), date: "2026-11-20", note: "Via opslag" });
    await disposeItems(ctx, [String(lamp.id)], { kind: "given_to", personId: String(karl.id), alsoGift: true });
    await disposeItems(ctx, [String(sofa.id)], { kind: "discarded" });

    const rows = await listArchivedItems(db);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(Object.keys(byName).sort()).toEqual(["Cykel", "Lampe", "Ringeklokke", "Sofa"]);
    expect(byName.Cykel).toMatchObject({ disposal_kind: "sold", disposal_price_minor: 125000, disposal_person: "Karl Ven", disposal_date: "2026-11-20", components: 1 });
    // The component goes with the bike, with the reason but not the price.
    expect(byName.Ringeklokke).toMatchObject({ disposal_kind: "sold", disposal_price_minor: null, parent_name: "Cykel" });
    expect(byName.Lampe).toMatchObject({ disposal_kind: "given_to", disposal_person: "Karl Ven", disposal_date: "2026-11-24" });
    expect(byName.Sofa).toMatchObject({ disposal_kind: "discarded", disposal_person: null });
    expect((await listGifts(db, { personId: String(karl.id) })).map((g) => [g.title, g.item, g.gift_date])).toEqual([["Lampe", "Lampe", "2026-11-24"]]);

    // Search in the archive by name, brand, person or note; filter by reason. Not in the normal search.
    expect((await listArchivedItems(db, { q: "karl" })).map((r) => r.name).sort()).toEqual(["Cykel", "Lampe"]);
    expect((await listArchivedItems(db, { q: "opslag" })).map((r) => r.name)).toEqual(["Cykel"]);
    expect((await listArchivedItems(db, { kind: "discarded" })).map((r) => r.name)).toEqual(["Sofa"]);
    expect((await search(db, "Cykel")).length).toBe(0);
    expect(JSON.stringify(await itemTree(db, { groupBy: "category" }))).not.toContain("Cykel");

    await restoreItems(ctx, [String(bike.id)]);
    expect((await listArchivedItems(db)).map((r) => r.name).sort()).toEqual(["Lampe", "Sofa"]);
    expect(await db.select("SELECT name, archived_at, disposal_kind, disposal_price_minor FROM item WHERE name IN ('Cykel','Ringeklokke') ORDER BY name")).toEqual([
      { name: "Cykel", archived_at: null, disposal_kind: null, disposal_price_minor: null },
      { name: "Ringeklokke", archived_at: null, disposal_kind: null, disposal_price_minor: null },
    ]);
    expect((await search(db, "Cykel")).length).toBeGreaterThan(0);
  });
});

describe("deleting items permanently", () => {
  it("removes the item and its links, keeps history without the target, and audits the delete", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const db = archive.db;
    const anna = await createEntity(ctx, "person", { name: "Anna Eksempel" });
    const karl = await createOutsidePerson(ctx, "Karl Ven");
    const printer = await createEntity(ctx, "item", { name: "Printer" });
    const hotend = await createEntity(ctx, "item", { name: "Hotend", parent_item_id: String(printer.id), component_role: "spare_part" });
    const nozzle = await createEntity(ctx, "item", { name: "Dyse", parent_item_id: String(hotend.id), component_role: "spare_part" });
    const id = String(printer.id);
    await db.execute(`INSERT INTO document (id, sha256, filename, ext, mime, size_bytes, source, created_at) VALUES ('${DOC}', '${"b".repeat(64)}', 'kvittering.pdf', 'pdf', 'application/pdf', 1, 'drop', 'x')`);
    await createEntity(ctx, "document_link", { document_id: DOC, target_type: "item", target_id: id, role: "receipt" });
    await createEntity(ctx, "person_link", { person_id: String(anna.id), target_type: "item", target_id: id });
    const wo = await createEntity(ctx, "work_order", { title: "Skift remme", kind: "repair", target_type: "item", target_id: id, reported_date: "2026-11-01" });
    const task = await createEntity(ctx, "task", { title: "Rens printer", module: "home", target_type: "item", target_id: id });
    const lending = await lendItem(ctx, { item_id: id, borrower_person_id: String(karl.id), lent_date: "2026-10-01" });

    expect(await deletionImpact(db, [id])).toEqual({ items: 1, components: 2, documents: 1, workOrders: 1, lendings: 1, gifts: 0 });

    // Without components: the hotend becomes an item of its own and keeps its nozzle.
    await deleteItemsPermanently(ctx, [id], { withComponents: false });
    expect(await db.select("SELECT count(*) AS n FROM item WHERE id = ?", [id])).toEqual([{ n: 0 }]);
    expect(await db.select("SELECT name, parent_item_id, component_role FROM item ORDER BY name")).toEqual([
      { name: "Dyse", parent_item_id: String(hotend.id), component_role: "spare_part" },
      { name: "Hotend", parent_item_id: null, component_role: null },
    ]);
    expect(await db.select("SELECT count(*) AS n FROM document_link WHERE target_id = ?", [id])).toEqual([{ n: 0 }]);
    expect(await db.select("SELECT count(*) AS n FROM person_link WHERE target_id = ?", [id])).toEqual([{ n: 0 }]);
    expect(await db.select("SELECT count(*) AS n FROM document WHERE id = ?", [DOC])).toEqual([{ n: 1 }]);
    expect(await db.select("SELECT title, target_type, target_id FROM work_order WHERE id = ?", [String(wo.id)])).toEqual([{ title: "Skift remme", target_type: null, target_id: null }]);
    expect(await db.select("SELECT status, target_id FROM task WHERE id = ?", [String(task.id)])).toEqual([{ status: "archived", target_id: null }]);
    expect(await db.select("SELECT item_id, title FROM lending WHERE id = ?", [String(lending.id)])).toEqual([{ item_id: null, title: "Printer" }]);
    expect(await db.select("SELECT count(*) AS n FROM search_index WHERE entity_type = 'item' AND entity_id = ?", [id])).toEqual([{ n: 0 }]);
    const [audit] = await db.select<{ action: string; diff_json: string }>("SELECT action, diff_json FROM audit_log WHERE entity_type = 'item' AND entity_id = ? ORDER BY at DESC, rowid DESC LIMIT 1", [id]);
    expect(audit!.action).toBe("delete");
    expect(JSON.parse(audit!.diff_json).name).toEqual(["Printer", null]);

    // With components: the whole subtree goes, children first.
    expect(await deleteItemsPermanently(ctx, [String(hotend.id)], { withComponents: true })).toBe(2);
    expect(await db.select("SELECT count(*) AS n FROM item WHERE id IN (?, ?)", [String(hotend.id), String(nozzle.id)])).toEqual([{ n: 0 }]);
  });
});

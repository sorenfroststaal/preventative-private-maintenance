import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  ancestorsOf,
  componentsInStockFor,
  componentsOf,
  componentsUsedIn,
  createEntity,
  getSchemaVersion,
  itemTree,
  migrate,
  search,
  setPersonLinks,
  updateEntity,
  consumeComponent,
  type TreeNode,
} from "../src";
import { ctxFor, newArchive, tempDir, testEnv } from "./helpers";
import { migrations } from "../src/db/migrations.generated";

/** "Bragesvej / Bryggers / Vaskemaskine / Kulbørster" as text lines, two spaces per level. */
const draw = (nodes: TreeNode[], depth = 0): string[] =>
  nodes.flatMap((n) => [`${"  ".repeat(depth)}${n.label}${n.note ? ` (${n.note})` : ""}`, ...draw(n.children, depth + 1)]);

describe("migration 0012 – components", () => {
  it("moves spare parts from item_part to item with their documents", async () => {
    const env = testEnv();
    const db = await env.openDb(join(tempDir(), "v11.sqlite"));
    await migrate(db, () => env.clock.nowIso(), migrations.filter((m) => m.version <= 11));
    await db.execute("INSERT INTO location (id, property_id, name) SELECT '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a1', 'Bryggers' FROM (SELECT 1) WHERE 0");
    await db.execute("INSERT INTO item (id, name, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000001', 'Vaskemaskine', 'x', 'x')");
    await db.execute("INSERT INTO item_part (id, item_id, name, part_number, vendor) VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Kulbørster', 'KB-12', 'Reservedelsbutikken')");
    await db.execute("INSERT INTO document (id, sha256, filename, ext, mime, size_bytes, source, created_at) VALUES ('00000000-0000-4000-8000-000000000003', '" + "a".repeat(64) + "', 'f.jpg', 'jpg', 'image/jpeg', 1, 'drop', 'x')");
    await db.execute("INSERT INTO document_link (document_id, target_type, target_id, role) VALUES ('00000000-0000-4000-8000-000000000003', 'item_part', '00000000-0000-4000-8000-000000000002', 'photo')");
    await migrate(db, () => env.clock.nowIso(), migrations.filter((m) => m.version <= 12));
    expect(await getSchemaVersion(db)).toBe(12);
    expect(await db.select("SELECT name, parent_item_id, component_role, part_number, vendor_name, quantity FROM item WHERE id = '00000000-0000-4000-8000-000000000002'")).toEqual([
      { name: "Kulbørster", parent_item_id: "00000000-0000-4000-8000-000000000001", component_role: "spare_part", part_number: "KB-12", vendor_name: "Reservedelsbutikken", quantity: 1 },
    ]);
    expect(await db.select("SELECT target_type FROM document_link")).toEqual([{ target_type: "item" }]);
    expect(await db.select("SELECT count(*) AS n FROM item_part")).toEqual([{ n: 0 }]);
    await expect(db.execute("UPDATE item SET component_role = 'gadget'")).rejects.toThrow();
    await expect(db.execute("UPDATE item SET quantity = -1")).rejects.toThrow();
  });
});

describe("components", () => {
  it("nest items, reject cycles, show the path and list components by role", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const db = archive.db;
    const printer = await createEntity(ctx, "item", { name: "3D-printer" });
    const hotend = await createEntity(ctx, "item", { name: "Hotend, hærdet 0,4 mm", parent_item_id: String(printer.id), component_role: "accessory" });
    const thermistor = await createEntity(ctx, "item", { name: "Termistor", parent_item_id: String(hotend.id), component_role: "spare_part", part_number: "NTC-100K", quantity: 3, stock_status: "in_stock" });
    await createEntity(ctx, "item", { name: "Filament PLA sort", parent_item_id: String(printer.id), component_role: "consumable", quantity: 2, stock_status: "in_stock" });
    await expect(updateEntity(ctx, "item", String(printer.id), { parent_item_id: String(thermistor.id) })).rejects.toThrow(/under sig selv/);
    await expect(updateEntity(ctx, "item", String(printer.id), { parent_item_id: String(printer.id) })).rejects.toThrow(/under sig selv/);
    expect((await componentsOf(db, String(printer.id))).map((c) => [c.name, c.component_role, c.children])).toEqual([
      ["Hotend, hærdet 0,4 mm", "accessory", 1],
      ["Filament PLA sort", "consumable", 0],
    ]);
    expect((await ancestorsOf(db, String(thermistor.id))).map((a) => a.name)).toEqual(["3D-printer", "Hotend, hærdet 0,4 mm"]);
    expect((await search(db, "NTC-100K")).map((h) => h.title)).toContain("Termistor");
  });

  it("uses spare parts in a repair: part of the stock is split off and linked to the work order", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const db = archive.db;
    const washer = await createEntity(ctx, "item", { name: "Vaskemaskine" });
    const brushes = await createEntity(ctx, "item", { name: "Kulbørster", parent_item_id: String(washer.id), component_role: "spare_part", quantity: 4, stock_status: "in_stock" });
    const wo = await createEntity(ctx, "work_order", { title: "Skift kulbørster", kind: "repair", target_type: "item", target_id: String(washer.id), reported_date: "2026-11-20" });
    expect((await componentsInStockFor(db, "item", String(washer.id))).map((c) => c.name)).toEqual(["Kulbørster"]);
    await expect(consumeComponent(ctx, String(brushes.id), { quantity: 5 })).rejects.toThrow(/mellem 1 og 4/);
    await consumeComponent(ctx, String(brushes.id), { quantity: 2, workOrderId: String(wo.id), date: "2026-11-21" });
    expect(await db.select("SELECT quantity, stock_status, used_work_order_id, used_date FROM item WHERE name = 'Kulbørster' ORDER BY stock_status")).toEqual([
      { quantity: 2, stock_status: "in_stock", used_work_order_id: null, used_date: null },
      { quantity: 2, stock_status: "used", used_work_order_id: wo.id, used_date: "2026-11-21" },
    ]);
    expect((await componentsUsedIn(db, String(wo.id))).map((c) => [c.name, c.parent_name, c.quantity])).toEqual([["Kulbørster", "Vaskemaskine", 2]]);
    await consumeComponent(ctx, String(brushes.id), { workOrderId: String(wo.id) });
    expect((await componentsInStockFor(db, "item", String(washer.id))).length).toBe(0);
    const [used] = await componentsUsedIn(db, String(wo.id));
    await expect(consumeComponent(ctx, String(used!.id))).rejects.toThrow(/allerede brugt/);
  });

  it("shows a nested tree by location, by owner (several owners, inherited by components) and by category", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const db = archive.db;
    const house = await createEntity(ctx, "property", { name: "Bragesvej", kind: "house" });
    const utility = await createEntity(ctx, "location", { property_id: String(house.id), name: "Bryggers" });
    const shelf = await createEntity(ctx, "location", { property_id: String(house.id), name: "Reol", parent_id: String(utility.id) });
    const office = await createEntity(ctx, "location", { property_id: String(house.id), name: "Kontor" });
    const washer = await createEntity(ctx, "item", { name: "Vaskemaskine", location_id: String(utility.id), category: "Hvidevarer" });
    await createEntity(ctx, "item", { name: "Kulbørster", parent_item_id: String(washer.id), component_role: "spare_part" });
    await createEntity(ctx, "item", { name: "Afkalker", parent_item_id: String(washer.id), component_role: "consumable", location_id: String(shelf.id) });
    const printer = await createEntity(ctx, "item", { name: "3D-printer", location_id: String(office.id) });
    await createEntity(ctx, "item", { name: "Hotend", parent_item_id: String(printer.id), component_role: "accessory" });
    await createEntity(ctx, "item", { name: "Løs lampe" });
    const anna = await createEntity(ctx, "person", { name: "Anna" });
    const bo = await createEntity(ctx, "person", { name: "Bo" });
    await setPersonLinks(ctx, "item", String(washer.id), [String(anna.id), String(bo.id)]);
    await setPersonLinks(ctx, "item", String(printer.id), [String(bo.id)]);

    expect(draw(await itemTree(db, { groupBy: "location" }))).toEqual([
      "Bragesvej",
      "  Bryggers",
      "    Reol",
      "      Afkalker (del af Vaskemaskine)",
      "    Vaskemaskine",
      "      Afkalker",
      "      Kulbørster",
      "  Kontor",
      "    3D-printer",
      "      Hotend",
      "Uden placering",
      "  Løs lampe",
    ]);
    expect(draw(await itemTree(db, { groupBy: "owner" }))).toEqual([
      "Anna",
      "  Vaskemaskine",
      "    Afkalker",
      "    Kulbørster",
      "Bo",
      "  3D-printer",
      "    Hotend",
      "  Vaskemaskine",
      "    Afkalker",
      "    Kulbørster",
      "Uden ejer",
      "  Løs lampe",
    ]);
    expect(draw(await itemTree(db, { groupBy: "category" }))[0]).toBe("Hvidevarer");
    // Searching keeps the path to the match.
    expect(draw(await itemTree(db, { groupBy: "location", match: "hotend" }))).toEqual(["Bragesvej", "  Kontor", "    3D-printer", "      Hotend"]);
    const [root] = await itemTree(db, { groupBy: "location" });
    expect(root!.count).toBe(6);
  });
});

describe("components – review round 2", () => {
  it("archiving an item archives its components, and restoring brings back those archived with it", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const { archiveEntity, restoreEntity } = await import("../src");
    const washer = await createEntity(ctx, "item", { name: "Vaskemaskine" });
    const brushes = await createEntity(ctx, "item", { name: "Kulbørster", parent_item_id: String(washer.id), component_role: "spare_part" });
    const old = await createEntity(ctx, "item", { name: "Gammel slange", parent_item_id: String(washer.id), component_role: "part" });
    await archiveEntity(ctx, "item", String(old.id));
    (env.clock as unknown as { set(v: string): void }).set("2026-11-25T10:00:00.000Z");
    await archiveEntity(ctx, "item", String(washer.id));
    const state = async () => Object.fromEntries((await archive.db.select<{ name: string; archived_at: string | null }>("SELECT name, archived_at FROM item ORDER BY name")).map((r) => [r.name, Boolean(r.archived_at)]));
    expect(await state()).toEqual({ "Gammel slange": true, Kulbørster: true, Vaskemaskine: true });
    // An archived component can still be edited (no "parent is archived" lock).
    await updateEntity(ctx, "item", String(brushes.id), { notes: "Rettet efter arkivering" });
    await restoreEntity(ctx, "item", String(washer.id));
    expect(await state()).toEqual({ "Gammel slange": true, Kulbørster: false, Vaskemaskine: false });
    // A new component under an archived item is still refused.
    await archiveEntity(ctx, "item", String(washer.id));
    await expect(createEntity(ctx, "item", { name: "Ny del", parent_item_id: String(washer.id) })).rejects.toThrow(/arkiveret/);
  });

  it("only spare parts and consumables in stock can be used; renaming an item updates its components' search", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const washer = await createEntity(ctx, "item", { name: "Vaskemaskine" });
    const buy = await createEntity(ctx, "item", { name: "Filter", parent_item_id: String(washer.id), component_role: "spare_part", quantity: 3, stock_status: "to_buy" });
    const acc = await createEntity(ctx, "item", { name: "Låg", parent_item_id: String(washer.id), component_role: "accessory" });
    await expect(consumeComponent(ctx, String(buy.id), { quantity: 1 })).rejects.toThrow(/ikke på lager/);
    await expect(consumeComponent(ctx, String(acc.id))).rejects.toThrow(/Kun reservedele og forbrugsstoffer/);
    expect((await search(archive.db, "Vaskemaskine")).map((h) => h.title)).toContain("Filter");
    await updateEntity(ctx, "item", String(washer.id), { name: "Tørretumbler" });
    expect((await search(archive.db, "Tørretumbler")).map((h) => h.title).sort()).toEqual(["Filter", "Låg", "Tørretumbler"]);
    expect((await search(archive.db, "Vaskemaskine")).length).toBe(0);
  });
});

describe("expired complaint period and warranty", () => {
  it("closes the automatic tasks when the date has passed and reports the state", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const { closeExpiredDeadlines, deadlineState } = await import("../src");
    // Today is 2026-11-24 in the test clock.
    const old = await createEntity(ctx, "item", { name: "Gammel brødrister", complaint_until: "2026-11-01", warranty_until: "2026-12-31" });
    await createEntity(ctx, "item", { name: "Ny kedel", complaint_until: "2028-01-01" });
    const occ = () =>
      archive.db.select<{ title: string; status: string; completed_date: string | null; note: string | null }>(
        "SELECT t.title, o.status, o.completed_date, o.note FROM task_occurrence o JOIN task t ON t.id = o.task_id WHERE t.source = 'system' ORDER BY t.title",
      );
    expect((await occ()).map((o) => o.status)).toEqual(["open", "open", "open"]);
    expect(await closeExpiredDeadlines(ctx)).toBe(1);
    expect(await occ()).toEqual([
      { title: "Garanti udløber: Gammel brødrister", status: "open", completed_date: null, note: null },
      { title: "Reklamationsret udløber: Gammel brødrister", status: "skipped", completed_date: "2026-11-01", note: "Udløbet" },
      { title: "Reklamationsret udløber: Ny kedel", status: "open", completed_date: null, note: null },
    ]);
    // Running again changes nothing, and saving the item again does not reopen the task.
    expect(await closeExpiredDeadlines(ctx)).toBe(0);
    await updateEntity(ctx, "item", String(old.id), { notes: "rettet" });
    expect((await occ())[1]!.status).toBe("skipped");
    expect(deadlineState(old, "2026-11-24")).toMatchObject({ complaintExpired: true, warrantyExpired: false, complaintDaysLeft: -23, warrantyDaysLeft: 37 });
    // The change is audited as made by the system.
    expect((await archive.db.select<{ via: string }>("SELECT via FROM audit_log WHERE entity_type = 'task_occurrence' AND action = 'update'")).map((a) => a.via)).toEqual(["system"]);
  });
});

describe("drag and drop in the tree", () => {
  it("moves an item to a room, a category, an owner, under another item or to the top level, and undoes it", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const { moveItem, undoMove, personLinks } = await import("../src");
    const house = await createEntity(ctx, "property", { name: "Bragesvej", kind: "house" });
    const utility = await createEntity(ctx, "location", { property_id: String(house.id), name: "Bryggers" });
    const kitchen = await createEntity(ctx, "location", { property_id: String(house.id), name: "Køkken" });
    const washer = await createEntity(ctx, "item", { name: "Vaskemaskine", location_id: String(utility.id) });
    const filter = await createEntity(ctx, "item", { name: "Filter", location_id: String(kitchen.id), category: "Køkken" });
    const anna = await createEntity(ctx, "person", { name: "Anna" });
    const bo = await createEntity(ctx, "person", { name: "Bo" });
    await setPersonLinks(ctx, "item", String(filter.id), [String(anna.id)]);
    const get = async () => (await archive.db.select("SELECT location_id, category, parent_item_id, component_role FROM item WHERE id = ?", [String(filter.id)]))[0];

    const u1 = await moveItem(ctx, String(filter.id), { kind: "location", locationId: String(utility.id) });
    expect(await get()).toMatchObject({ location_id: utility.id });
    await moveItem(ctx, String(filter.id), { kind: "category", category: "Reservedele" });
    expect(await get()).toMatchObject({ category: "Reservedele" });
    await moveItem(ctx, String(filter.id), { kind: "item", parentId: String(washer.id) });
    expect(await get()).toMatchObject({ parent_item_id: washer.id, component_role: "part" });
    await expect(moveItem(ctx, String(washer.id), { kind: "item", parentId: String(filter.id) })).rejects.toThrow(/under sig selv/);
    await moveItem(ctx, String(filter.id), { kind: "owner", personId: String(bo.id), fromPersonId: String(anna.id) });
    expect((await personLinks(archive.db, "item")).get(String(filter.id))?.map((p) => p.name)).toEqual(["Bo"]);
    await moveItem(ctx, String(filter.id), { kind: "root" });
    expect(await get()).toMatchObject({ parent_item_id: null, component_role: null });
    await undoMove(ctx, u1);
    expect(await get()).toMatchObject({ location_id: kitchen.id, category: "Køkken", parent_item_id: null });
  });
});

describe("several items at once", () => {
  it("moves, edits and archives a selection in one go, all or nothing, and undoes a move", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const { moveItems, undoMoves, editItems, archiveItems, personLinks } = await import("../src");
    const house = await createEntity(ctx, "property", { name: "Hus", kind: "house" });
    const shed = await createEntity(ctx, "location", { property_id: String(house.id), name: "Skur" });
    const printer = await createEntity(ctx, "item", { name: "3D-printer" });
    const a = await createEntity(ctx, "item", { name: "Filament rød", category: "Diverse" });
    const b = await createEntity(ctx, "item", { name: "Filament blå" });
    const anna = await createEntity(ctx, "person", { name: "Anna" });
    const ids = [String(a.id), String(b.id)];
    const rows = () => archive.db.select<Record<string, unknown>>("SELECT name, location_id, category, parent_item_id, component_role, stock_status, archived_at FROM item WHERE id IN (?, ?) ORDER BY name", ids);

    const undo = await moveItems(ctx, ids, { kind: "location", locationId: String(shed.id) });
    expect((await rows()).map((r) => r.location_id)).toEqual([shed.id, shed.id]);
    await undoMoves(ctx, undo);
    expect((await rows()).map((r) => r.location_id)).toEqual([null, null]);

    await moveItems(ctx, ids, { kind: "item", parentId: String(printer.id) });
    await editItems(ctx, ids, { component_role: "consumable", stock_status: "in_stock", addOwner: String(anna.id) });
    expect((await rows()).map((r) => [r.parent_item_id, r.component_role, r.stock_status])).toEqual([
      [printer.id, "consumable", "in_stock"],
      [printer.id, "consumable", "in_stock"],
    ]);
    expect((await personLinks(archive.db, "item")).get(String(b.id))?.map((p) => p.name)).toEqual(["Anna"]);
    // All or nothing: one bad item stops the whole batch.
    await expect(moveItems(ctx, [String(a.id), String(printer.id)], { kind: "item", parentId: String(a.id) })).rejects.toThrow();
    expect((await rows()).map((r) => r.parent_item_id)).toEqual([printer.id, printer.id]);
    await archiveItems(ctx, ids);
    expect((await rows()).every((r) => r.archived_at)).toBe(true);
  });
});

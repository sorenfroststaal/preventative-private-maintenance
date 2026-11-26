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

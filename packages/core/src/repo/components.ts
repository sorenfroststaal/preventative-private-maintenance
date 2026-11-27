/**
 * Components (migration 0012): items under items as built-in parts, accessories, consumables or spare
 * parts, spare parts in stock or used in a repair, and the nested tree by location, owner or category.
 */
import type { DbAdapter } from "../db/adapter";
import type { Row } from "../domain/registry";
import { archiveEntity, createEntity, mustGet, registerAfterWrite, reindex, restoreEntity, updateEntity, ValidationError, type Ctx } from "./entities";

export type ComponentRole = "part" | "accessory" | "consumable" | "spare_part";
export const COMPONENT_ROLES: [ComponentRole, string, string][] = [
  ["part", "Indbygget del", "Indbyggede dele"],
  ["accessory", "Tilbehør", "Tilbehør"],
  ["consumable", "Forbrugsstof", "Forbrugsstoffer"],
  ["spare_part", "Reservedel", "Reservedele"],
];
export const STOCK_STATUSES: [string, string][] = [
  ["in_stock", "På lager"],
  ["used", "Brugt"],
  ["to_buy", "Skal købes"],
];

// A component may not be its own ancestor, and a new parent must exist and not be archived. The check
// runs when an item is created or moved, not when it is only edited or archived.
registerAfterWrite("item", async (ctx, row, action, before) => {
  if (!row.parent_item_id) return;
  if (action !== "create" && before?.parent_item_id === row.parent_item_id) return;
  const seen = new Set<string>([String(row.id)]);
  let cur: string | null = String(row.parent_item_id);
  while (cur) {
    if (seen.has(cur)) throw new ValidationError([{ path: "parent_item_id", message: "En genstand kan ikke ligge under sig selv eller sine egne dele" }], "item");
    seen.add(cur);
    const [p]: { parent_item_id: string | null; archived_at: string | null }[] = await ctx.db.select("SELECT parent_item_id, archived_at FROM item WHERE id = ?", [cur]);
    if (!p) throw new ValidationError([{ path: "parent_item_id", message: "Den overordnede genstand findes ikke" }], "item");
    if (cur === row.parent_item_id && p.archived_at) throw new ValidationError([{ path: "parent_item_id", message: "Den overordnede genstand er arkiveret" }], "item");
    cur = p.parent_item_id;
  }
});

// Archiving an item archives its components; restoring it restores those archived with it (at or after
// the item's own archive time; components archived earlier on their own stay archived).
registerAfterWrite("item", async (ctx, row, action, before) => {
  if (action !== "archive" && action !== "restore") return;
  const kids = await ctx.db.select<{ id: string; archived_at: string | null }>("SELECT id, archived_at FROM item WHERE parent_item_id = ?", [String(row.id)]);
  const since = String(before?.archived_at ?? "");
  for (const k of kids) {
    if (action === "archive" && !k.archived_at) await archiveEntity(ctx, "item", k.id);
    if (action === "restore" && k.archived_at && since && k.archived_at >= since) await restoreEntity(ctx, "item", k.id);
  }
});

// The parent's name is part of a component's search text: renaming an item updates its components.
registerAfterWrite("item", async (ctx, row, action, before) => {
  if (action !== "update" || before?.name === row.name) return;
  for (const k of await ctx.db.select<Row>("SELECT * FROM item WHERE parent_item_id = ?", [String(row.id)])) await reindex(ctx.db, "item", k);
});

export interface ComponentRow extends Row {
  id: string;
  name: string;
  component_role: ComponentRole | null;
  quantity: number;
  stock_status: string | null;
  used_work_order_title: string | null;
  children: number;
}

/** Direct components of an item, ordered by role and name, with their own number of components. */
export async function componentsOf(db: DbAdapter, itemId: string): Promise<ComponentRow[]> {
  return db.select<ComponentRow>(
    `SELECT i.*, w.title AS used_work_order_title,
            (SELECT count(*) FROM item c WHERE c.parent_item_id = i.id AND c.archived_at IS NULL) AS children
       FROM item i LEFT JOIN work_order w ON w.id = i.used_work_order_id
      WHERE i.parent_item_id = ? AND i.archived_at IS NULL
      ORDER BY CASE i.component_role WHEN 'part' THEN 0 WHEN 'accessory' THEN 1 WHEN 'consumable' THEN 2 WHEN 'spare_part' THEN 3 ELSE 4 END,
               i.stock_status = 'used', i.name`,
    [itemId],
  );
}

/** The chain of parents from the top down (for "Del af Printer › Hotend"). */
export async function ancestorsOf(db: DbAdapter, itemId: string): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  let [cur] = await db.select<{ parent_item_id: string | null }>("SELECT parent_item_id FROM item WHERE id = ?", [itemId]);
  const seen = new Set([itemId]);
  while (cur?.parent_item_id && !seen.has(cur.parent_item_id)) {
    seen.add(cur.parent_item_id);
    const [p] = await db.select<{ id: string; name: string; parent_item_id: string | null }>("SELECT id, name, parent_item_id FROM item WHERE id = ?", [cur.parent_item_id]);
    if (!p) break;
    out.unshift({ id: p.id, name: p.name });
    cur = p;
  }
  return out;
}

/**
 * Uses spare parts or consumables in a repair: the used quantity is linked to the work order (if any)
 * with the date. Using part of the stock splits the row, so the rest stays "på lager".
 */
export async function consumeComponent(ctx: Ctx, itemId: string, opts: { quantity?: number; workOrderId?: string | null; date?: string } = {}): Promise<Row> {
  const item = await mustGet(ctx.db, "item", itemId);
  const have = Number(item.quantity ?? 1);
  const qty = opts.quantity ?? have;
  if (item.component_role !== "spare_part" && item.component_role !== "consumable") throw new ValidationError([{ path: "component_role", message: "Kun reservedele og forbrugsstoffer kan registreres som brugt" }], "item");
  if (item.stock_status === "used") throw new ValidationError([{ path: "stock_status", message: "Delen er allerede brugt" }], "item");
  if ((item.stock_status ?? "in_stock") !== "in_stock") throw new ValidationError([{ path: "stock_status", message: "Delen er ikke på lager" }], "item");
  if (!Number.isInteger(qty) || qty < 1 || qty > have) throw new ValidationError([{ path: "quantity", message: `Vælg et antal mellem 1 og ${have}` }], "item");
  const used = { stock_status: "used", used_work_order_id: opts.workOrderId ?? null, used_date: opts.date ?? ctx.clock.today() };
  return ctx.db.transaction(async (tx) => {
    const c = { ...ctx, db: tx };
    if (qty === have) return updateEntity(c, "item", itemId, used as never);
    await updateEntity(c, "item", itemId, { quantity: have - qty } as never);
    const copy = Object.fromEntries(
      ["name", "category", "location_id", "brand", "model", "serial_number", "part_number", "vendor_name", "vendor_contact_id", "parent_item_id", "component_role", "notes"].map((k) => [k, item[k] ?? null]),
    );
    return createEntity(c, "item", { ...copy, quantity: qty, ...used } as never);
  });
}

/** Spare parts and consumables used in a work order. */
export const componentsUsedIn = (db: DbAdapter, workOrderId: string) =>
  db.select<Row>("SELECT i.*, p.name AS parent_name FROM item i LEFT JOIN item p ON p.id = i.parent_item_id WHERE i.used_work_order_id = ? ORDER BY i.name", [workOrderId]);

/** Spare parts and consumables in stock on a record's items (for "Brug reservedel" on a work order). */
export async function componentsInStockFor(db: DbAdapter, targetType: string | null, targetId: string | null): Promise<Row[]> {
  if (targetType !== "item" || !targetId) {
    return db.select<Row>(
      `SELECT i.*, p.name AS parent_name FROM item i LEFT JOIN item p ON p.id = i.parent_item_id
        WHERE i.archived_at IS NULL AND i.component_role IN ('spare_part','consumable') AND COALESCE(i.stock_status, 'in_stock') = 'in_stock' AND i.quantity > 0
        ORDER BY p.name, i.name`,
    );
  }
  return db.select<Row>(
    `WITH RECURSIVE tree(id) AS (SELECT ? UNION ALL SELECT c.id FROM item c JOIN tree t ON c.parent_item_id = t.id)
     SELECT i.*, p.name AS parent_name FROM item i JOIN tree t ON t.id = i.id LEFT JOIN item p ON p.id = i.parent_item_id
      WHERE i.archived_at IS NULL AND i.component_role IN ('spare_part','consumable') AND COALESCE(i.stock_status, 'in_stock') = 'in_stock' AND i.quantity > 0
      ORDER BY p.name, i.name`,
    [targetId],
  );
}

// ---------------------------------------------------------------- tree

export type TreeGroupBy = "location" | "owner" | "category";

export interface TreeNode {
  /** Unique within the tree (a node can appear in several places, so the key includes the path). */
  key: string;
  kind: "property" | "location" | "person" | "group" | "item";
  label: string;
  /** For items. */
  item?: Row;
  /** Where else the item belongs, e.g. "del af Vaskemaskine" when shown under its own room. */
  note?: string;
  children: TreeNode[];
  /** Number of items in the subtree. */
  count: number;
}

interface ItemRow extends Row {
  id: string;
  name: string;
  parent_item_id: string | null;
  location_id: string | null;
  category: string | null;
}

/**
 * Items as a nested tree: by location (property › room › sub-room › item › components), by owner
 * (an item with several owners appears under each), or by category. Components are always nested
 * under their item; a component placed in another room or owned by someone else also appears there,
 * marked "del af …". `match` limits the tree to items whose name, brand, model or numbers contain it
 * (with their parents, so the path stays visible).
 */
export async function itemTree(db: DbAdapter, opts: { groupBy: TreeGroupBy; match?: string }): Promise<TreeNode[]> {
  const items = await db.select<ItemRow>("SELECT * FROM item WHERE archived_at IS NULL ORDER BY name");
  const byId = new Map(items.map((i) => [i.id, i]));
  const kids = new Map<string, ItemRow[]>();
  for (const i of items) if (i.parent_item_id && byId.has(i.parent_item_id)) kids.set(i.parent_item_id, [...(kids.get(i.parent_item_id) ?? []), i]);
  const top = items.filter((i) => !i.parent_item_id || !byId.has(i.parent_item_id));

  const q = opts.match?.trim().toLocaleLowerCase("da");
  let keep: Set<string> | null = null;
  if (q) {
    keep = new Set();
    for (const i of items) {
      if (![i.name, i.brand, i.model, i.serial_number, i.part_number, i.category].some((v) => v && String(v).toLocaleLowerCase("da").includes(q))) continue;
      // The match, its parents (the path) and all its components.
      let cur: ItemRow | undefined = i;
      while (cur) {
        keep.add(cur.id);
        cur = cur.parent_item_id ? byId.get(cur.parent_item_id) : undefined;
      }
      const stack = [...(kids.get(i.id) ?? [])];
      while (stack.length) {
        const c = stack.pop()!;
        keep.add(c.id);
        stack.push(...(kids.get(c.id) ?? []));
      }
    }
  }
  const visible = (i: ItemRow) => !keep || keep.has(i.id);

  const itemNode = (i: ItemRow, path: string, note?: string, depth = 0): TreeNode => {
    const children = depth > 20 ? [] : (kids.get(i.id) ?? []).filter(visible).map((c) => itemNode(c, `${path}/${i.id}`, undefined, depth + 1));
    return { key: `${path}/${i.id}`, kind: "item", label: i.name, item: i, note, children, count: 1 + children.reduce((a, c) => a + c.count, 0) };
  };
  const nameOf = (id: string | null) => (id ? byId.get(id)?.name : undefined);
  const group = (key: string, kind: TreeNode["kind"], label: string, children: TreeNode[]): TreeNode => ({ key, kind, label, children, count: children.reduce((a, c) => a + c.count, 0) });

  if (opts.groupBy === "category") {
    const cats = new Map<string, ItemRow[]>();
    for (const i of top.filter(visible)) {
      const c = i.category?.trim() || "";
      cats.set(c, [...(cats.get(c) ?? []), i]);
    }
    return [...cats.entries()]
      .sort(([a], [b]) => (a ? (b ? a.localeCompare(b, "da") : -1) : 1))
      .map(([c, list]) => group(`c:${c}`, "group", c || "Uden kategori", list.map((i) => itemNode(i, `c:${c}`))));
  }

  if (opts.groupBy === "owner") {
    const links = await db.select<{ person_id: string; target_id: string; name: string }>(
      "SELECT l.person_id, l.target_id, p.name FROM person_link l JOIN person p ON p.id = l.person_id WHERE l.target_type = 'item' AND p.archived_at IS NULL ORDER BY p.name",
    );
    const ownersOf = new Map<string, Set<string>>();
    const personName = new Map<string, string>();
    for (const l of links) {
      ownersOf.set(l.target_id, new Set([...(ownersOf.get(l.target_id) ?? []), l.person_id]));
      personName.set(l.person_id, l.name);
    }
    // An item's owners, or its nearest owned parent's (a hotend belongs to whoever owns the printer).
    const effective = (i: ItemRow): Set<string> => {
      let cur: ItemRow | undefined = i;
      const seen = new Set<string>();
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        const o = ownersOf.get(cur.id);
        if (o?.size) return o;
        cur = cur.parent_item_id ? byId.get(cur.parent_item_id) : undefined;
      }
      return new Set();
    };
    const persons = [...personName.entries()].sort((a, b) => a[1].localeCompare(b[1], "da"));
    const out = persons.map(([pid, pname]) => {
      const roots = items.filter((i) => visible(i) && effective(i).has(pid) && !(i.parent_item_id && byId.has(i.parent_item_id) && effective(byId.get(i.parent_item_id)!).has(pid)));
      return group(
        `p:${pid}`,
        "person",
        pname,
        roots.map((i) => itemNode(i, `p:${pid}`, i.parent_item_id && byId.has(i.parent_item_id) ? `del af ${nameOf(i.parent_item_id)}` : undefined)),
      );
    });
    const none = top.filter((i) => visible(i) && effective(i).size === 0);
    if (none.length) out.push(group("p:none", "group", "Uden ejer", none.map((i) => itemNode(i, "p:none"))));
    return out.filter((g) => g.children.length);
  }

  // By location: property › rooms (nested by parent_id) › items.
  const locs = await db.select<{ id: string; name: string; parent_id: string | null; property_id: string; property: string }>(
    `SELECT l.id, l.name, l.parent_id, l.property_id, p.name AS property FROM location l JOIN property p ON p.id = l.property_id
      WHERE l.archived_at IS NULL AND p.archived_at IS NULL ORDER BY p.name, l.name`,
  );
  const locIds = new Set(locs.map((l) => l.id));
  // Items shown directly in a room: top-level items there, and components placed in another room than their parent.
  const effectiveLoc = (i: ItemRow): string | null => {
    let cur: ItemRow | undefined = i;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (cur.location_id && locIds.has(cur.location_id)) return cur.location_id;
      cur = cur.parent_item_id ? byId.get(cur.parent_item_id) : undefined;
    }
    return null;
  };
  const inRoom = new Map<string, TreeNode[]>();
  for (const i of items.filter(visible)) {
    const loc = effectiveLoc(i);
    if (!loc) continue;
    const parent = i.parent_item_id ? byId.get(i.parent_item_id) : undefined;
    const isRoot = !parent;
    const elsewhere = parent && effectiveLoc(parent) !== loc;
    if (isRoot || elsewhere) inRoom.set(loc, [...(inRoom.get(loc) ?? []), itemNode(i, `l:${loc}`, elsewhere ? `del af ${parent!.name}` : undefined)]);
  }
  const roomNode = (l: (typeof locs)[number], depth = 0): TreeNode => {
    const sub = depth > 20 ? [] : locs.filter((c) => c.parent_id === l.id).map((c) => roomNode(c, depth + 1));
    return group(`l:${l.id}`, "location", l.name, [...sub, ...(inRoom.get(l.id) ?? [])]);
  };
  const props = [...new Map(locs.map((l) => [l.property_id, l.property])).entries()];
  const out = props.map(([pid, pname]) =>
    group(`pr:${pid}`, "property", pname, locs.filter((l) => l.property_id === pid && (!l.parent_id || !locIds.has(l.parent_id))).map((l) => roomNode(l))),
  );
  const noPlace = top.filter((i) => visible(i) && !effectiveLoc(i));
  if (noPlace.length) out.push(group("l:none", "group", "Uden placering", noPlace.map((i) => itemNode(i, "l:none"))));
  // Empty rooms stay visible (things can be dragged into them); a search shows only rooms with matches.
  return q ? out.map(prune).filter((n): n is TreeNode => n !== null) : out.filter((n) => n.kind !== "group" || n.children.length);
}

/** Drops empty rooms and properties (used when searching). */
function prune(n: TreeNode): TreeNode | null {
  if (n.kind === "item") return n;
  const children = n.children.map(prune).filter((c): c is TreeNode => c !== null);
  return children.length ? { ...n, children, count: children.reduce((a, c) => a + c.count, 0) } : null;
}

/** Search index for spare parts moved from item_part by migration 0012. */
export async function reindexMovedParts(db: DbAdapter): Promise<void> {
  for (const r of await db.select<Row>("SELECT * FROM item WHERE component_role = 'spare_part'")) await reindex(db, "item", r);
}

export interface MobileItemRow {
  id: string;
  name: string;
  category: string | null;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  location: string | null;
  parent: string | null;
}

/** Active items for the phone's list, with room and parent name (review A2: no SQL in the server). */
export const itemsForMobile = (db: DbAdapter) =>
  db.select<MobileItemRow>(
    `SELECT i.id, i.name, i.category, i.brand, i.model, i.serial_number, l.name AS location, p.name AS parent
       FROM item i LEFT JOIN location l ON l.id = i.location_id LEFT JOIN item p ON p.id = i.parent_item_id AND p.archived_at IS NULL
      WHERE i.archived_at IS NULL ORDER BY i.name`,
  );

// ---------------------------------------------------------------- drag and drop in the tree

/** Where an item is dropped in the tree. */
export type MoveTarget =
  | { kind: "location"; locationId: string | null }
  | { kind: "category"; category: string | null }
  | { kind: "owner"; personId: string | null; fromPersonId?: string | null }
  | { kind: "item"; parentId: string }
  | { kind: "root" };

/** What a move changed, so it can be undone. */
export interface MoveUndo {
  itemId: string;
  before: { location_id: unknown; category: unknown; parent_item_id: unknown; component_role: unknown };
  owners: string[] | null;
}

const ownersOf = async (db: DbAdapter, itemId: string) =>
  (await db.select<{ person_id: string }>("SELECT person_id FROM person_link WHERE target_type = 'item' AND target_id = ? ORDER BY person_id", [itemId])).map((r) => r.person_id);

/**
 * Moves an item dropped in the tree: onto a room (location), a category, an owner (replaces the owner it
 * was dragged from), another item (becomes its component; the cycle check still applies) or the top
 * level (no longer a component). Returns what is needed to undo it.
 */
export async function moveItem(ctx: Ctx, itemId: string, target: MoveTarget): Promise<MoveUndo> {
  const item = await mustGet(ctx.db, "item", itemId);
  const undo: MoveUndo = {
    itemId,
    before: { location_id: item.location_id ?? null, category: item.category ?? null, parent_item_id: item.parent_item_id ?? null, component_role: item.component_role ?? null },
    owners: null,
  };
  await ctx.db.transaction(async (tx) => {
    const c = { ...ctx, db: tx };
    if (target.kind === "location") await updateEntity(c, "item", itemId, { location_id: target.locationId } as never);
    else if (target.kind === "category") await updateEntity(c, "item", itemId, { category: target.category?.trim() || null } as never);
    else if (target.kind === "item") {
      if (target.parentId === itemId) throw new ValidationError([{ path: "parent_item_id", message: "En genstand kan ikke ligge under sig selv" }], "item");
      await updateEntity(c, "item", itemId, { parent_item_id: target.parentId, component_role: item.component_role ?? "part" } as never);
    } else if (target.kind === "root") await updateEntity(c, "item", itemId, { parent_item_id: null, component_role: null } as never);
    else {
      const now = await ownersOf(tx, itemId);
      undo.owners = now;
      const next = new Set(now.filter((p) => p !== target.fromPersonId));
      if (target.personId) next.add(target.personId);
      const { setPersonLinks } = await import("./personLinks");
      await setPersonLinks(c, "item", itemId, [...next]);
    }
  });
  return undo;
}

/** Undoes a move from moveItem. */
export async function undoMove(ctx: Ctx, undo: MoveUndo): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const c = { ...ctx, db: tx };
    await updateEntity(c, "item", undo.itemId, undo.before as never);
    if (undo.owners) {
      const { setPersonLinks } = await import("./personLinks");
      await setPersonLinks(c, "item", undo.itemId, undo.owners);
    }
  });
}

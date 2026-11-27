/**
 * Disposal of items (migration 0013): archive with a reason (given away, given to a person, sold,
 * discarded, other), the archive view with restore, and "Slet helt" – the only physical delete of a
 * primary record (spec 03, Afhændelse af genstande).
 */
import type { DbAdapter } from "../db/adapter";
import type { Row } from "../domain/registry";
import { archiveEntity, deleteLink, mustGet, restoreEntity, updateEntity, ValidationError, writeAudit, type Ctx } from "./entities";
import { createGift } from "./gifts";

export type DisposalKind = "given_away" | "given_to" | "sold" | "discarded" | "other";
export const DISPOSAL_KINDS: [DisposalKind, string][] = [
  ["given_away", "Givet væk"],
  ["given_to", "Givet til"],
  ["sold", "Solgt"],
  ["discarded", "Smidt ud"],
  ["other", "Andet"],
];
export const disposalLabel = (kind: string | null | undefined): string => DISPOSAL_KINDS.find(([k]) => k === kind)?.[1] ?? "Arkiveret";

export interface Disposal {
  /** null = archive without a reason. */
  kind: DisposalKind | null;
  date?: string | null;
  priceMinor?: number | null;
  /** The recipient (given_to) or the buyer (sold). */
  personId?: string | null;
  note?: string | null;
  /** given_to: also register a gift to the person. */
  alsoGift?: boolean;
}

const EMPTY = { disposal_kind: null, disposal_date: null, disposal_price_minor: null, disposal_person_id: null, disposal_note: null };

/** All components below an item, at any depth (archived or not), parents before children. */
async function descendants(db: DbAdapter, id: string): Promise<string[]> {
  const out: string[] = [];
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const k of await db.select<{ id: string }>("SELECT id FROM item WHERE parent_item_id = ? ORDER BY name", [cur])) {
      if (out.includes(k.id) || k.id === id) continue;
      out.push(k.id);
      queue.push(k.id);
    }
  }
  return out;
}

/**
 * Archives items with a reason. Components archived with them get the same reason and date (no price).
 * Returns the number of items given.
 */
export async function disposeItems(ctx: Ctx, itemIds: string[], d: Disposal): Promise<number> {
  const issues: { path: string; message: string }[] = [];
  if (d.kind === "given_to" && !d.personId) issues.push({ path: "disposal_person_id", message: "Vælg, hvem tingen er givet til" });
  if (d.priceMinor != null && (!Number.isInteger(d.priceMinor) || d.priceMinor < 0)) issues.push({ path: "disposal_price_minor", message: "Prisen kan ikke være negativ" });
  if (d.alsoGift && d.kind !== "given_to") issues.push({ path: "alsoGift", message: "Kun ting givet til en person kan registreres som gave" });
  if (issues.length) throw new ValidationError(issues, "item");
  const date = d.kind ? (d.date || ctx.clock.today()) : null;
  await ctx.db.transaction(async (tx) => {
    const c = { ...ctx, db: tx };
    for (const id of [...new Set(itemIds)]) {
      const item = await mustGet(tx, "item", id);
      const below = await descendants(tx, id);
      const kids = below.length
        ? await tx.select<{ id: string }>(`SELECT id FROM item WHERE id IN (${below.map(() => "?").join(",")}) AND archived_at IS NULL`, below)
        : [];
      await updateEntity(c, "item", id, d.kind
        ? {
            disposal_kind: d.kind,
            disposal_date: date,
            disposal_price_minor: d.kind === "sold" ? d.priceMinor ?? null : null,
            disposal_person_id: d.kind === "given_to" || d.kind === "sold" ? d.personId ?? null : null,
            disposal_note: d.note?.trim() || null,
          }
        : EMPTY);
      await archiveEntity(c, "item", id);
      for (const k of kids) {
        await updateEntity(c, "item", k.id, d.kind ? { ...EMPTY, disposal_kind: d.kind, disposal_date: date, disposal_person_id: d.kind === "given_to" ? d.personId ?? null : null } : EMPTY);
      }
      if (d.alsoGift && d.personId) {
        await createGift(c, { direction: "given", person_id: d.personId, title: String(item.name), gift_date: date!, item_id: id, occasion: null, amount_minor: null, notes: d.note?.trim() || null });
      }
    }
  });
  return itemIds.length;
}

/** Restores archived items (and the components archived with them) and clears the reason. */
export async function restoreItems(ctx: Ctx, itemIds: string[]): Promise<number> {
  await ctx.db.transaction(async (tx) => {
    const c = { ...ctx, db: tx };
    for (const id of [...new Set(itemIds)]) {
      await restoreEntity(c, "item", id);
      for (const k of [id, ...(await descendants(tx, id))]) {
        const [row] = await tx.select<{ archived_at: string | null; disposal_kind: string | null }>("SELECT archived_at, disposal_kind FROM item WHERE id = ?", [k]);
        if (row && !row.archived_at && row.disposal_kind) await updateEntity(c, "item", k, EMPTY);
      }
    }
  });
  return itemIds.length;
}

export interface ArchivedItemRow extends Row {
  id: string;
  name: string;
  archived_at: string;
  disposal_kind: DisposalKind | null;
  disposal_date: string | null;
  disposal_price_minor: number | null;
  disposal_person: string | null;
  disposal_note: string | null;
  location_id: string | null;
  parent_name: string | null;
  location: string | null;
  components: number;
}

/** Archived items, newest first, optionally filtered by text (name, brand, model, reason note, person). */
export async function listArchivedItems(db: DbAdapter, opts: { q?: string; kind?: DisposalKind | "none" } = {}): Promise<ArchivedItemRow[]> {
  const where = ["i.archived_at IS NOT NULL"];
  const args: string[] = [];
  if (opts.kind === "none") where.push("i.disposal_kind IS NULL");
  else if (opts.kind) {
    where.push("i.disposal_kind = ?");
    args.push(opts.kind);
  }
  const q = opts.q?.trim().toLowerCase();
  if (q) {
    where.push("(lower(i.name) LIKE ? OR lower(coalesce(i.brand,'')) LIKE ? OR lower(coalesce(i.model,'')) LIKE ? OR lower(coalesce(i.disposal_note,'')) LIKE ? OR lower(coalesce(p.name,'')) LIKE ? OR lower(coalesce(i.category,'')) LIKE ?)");
    args.push(...Array(6).fill(`%${q}%`));
  }
  return db.select<ArchivedItemRow>(
    `SELECT i.*, p.name AS disposal_person, par.name AS parent_name, l.name AS location,
            (SELECT count(*) FROM item c WHERE c.parent_item_id = i.id) AS components
       FROM item i
       LEFT JOIN person p ON p.id = i.disposal_person_id
       LEFT JOIN item par ON par.id = i.parent_item_id
       LEFT JOIN location l ON l.id = i.location_id
      WHERE ${where.join(" AND ")}
      ORDER BY i.archived_at DESC, i.name`,
    args,
  );
}

/** What "Slet helt" would touch, for the confirmation text. */
export async function deletionImpact(db: DbAdapter, itemIds: string[]): Promise<{ items: number; components: number; documents: number; workOrders: number; lendings: number; gifts: number }> {
  const ids = [...new Set(itemIds)];
  const kids = new Set<string>();
  for (const id of ids) for (const k of await descendants(db, id)) if (!ids.includes(k)) kids.add(k);
  const all = [...ids, ...kids];
  const ph = all.map(() => "?").join(",") || "NULL";
  const count = async (sql: string) => Number((await db.select<{ n: number }>(sql, all))[0]?.n ?? 0);
  return {
    items: ids.length,
    components: kids.size,
    documents: await count(`SELECT count(DISTINCT document_id) AS n FROM document_link WHERE target_type = 'item' AND target_id IN (${ph})`),
    workOrders: await count(`SELECT count(*) AS n FROM work_order WHERE target_type = 'item' AND target_id IN (${ph})`),
    lendings: await count(`SELECT count(*) AS n FROM lending WHERE item_id IN (${ph})`),
    gifts: await count(`SELECT count(*) AS n FROM gift WHERE item_id IN (${ph})`),
  };
}

const LINK_TABLES = ["document_link", "person_link", "policy_coverage", "transaction_link", "entity_tag"] as const;

/**
 * Deletes items physically ("Slet helt"). Links and the search index go with them; lendings and gifts
 * keep the name as title; work orders and tasks stay without a target (tasks are archived). Components
 * are deleted too when `withComponents`, otherwise they become items of their own. Documents stay.
 */
export async function deleteItemsPermanently(ctx: Ctx, itemIds: string[], opts: { withComponents: boolean }): Promise<number> {
  let deleted = 0;
  await ctx.db.transaction(async (tx) => {
    const c = { ...ctx, db: tx };
    const ids = [...new Set(itemIds)];
    const order: string[] = [];
    for (const id of ids) {
      if (order.includes(id)) continue;
      if (opts.withComponents) {
        for (const k of await descendants(tx, id)) if (!order.includes(k)) order.push(k);
      } else {
        for (const k of await tx.select<{ id: string }>("SELECT id FROM item WHERE parent_item_id = ?", [id])) {
          if (!ids.includes(k.id)) await updateEntity(c, "item", k.id, { parent_item_id: null, component_role: null });
        }
      }
      order.push(id);
    }
    // Children before parents (parent_item_id references item).
    const depth = async (id: string) => {
      let n = 0;
      let cur: string | null = id;
      while (cur && n < 100) {
        const [r]: { parent_item_id: string | null }[] = await tx.select("SELECT parent_item_id FROM item WHERE id = ?", [cur]);
        cur = r?.parent_item_id ?? null;
        n++;
      }
      return n;
    };
    const depths = new Map<string, number>();
    for (const id of order) depths.set(id, await depth(id));
    order.sort((a, b) => depths.get(b)! - depths.get(a)!);

    for (const id of order) {
      const item = await mustGet(tx, "item", id);
      const name = String(item.name);
      for (const t of LINK_TABLES) {
        for (const row of await tx.select<Row>(`SELECT * FROM ${t} WHERE target_type = 'item' AND target_id = ?`, [id])) await deleteLink(c, t, row);
      }
      for (const l of await tx.select<{ id: string; title: string | null }>("SELECT id, title FROM lending WHERE item_id = ?", [id])) {
        await updateEntity(c, "lending", l.id, { item_id: null, title: l.title || name });
      }
      for (const g of await tx.select<{ id: string }>("SELECT id FROM gift WHERE item_id = ?", [id])) await updateEntity(c, "gift", g.id, { item_id: null });
      for (const w of await tx.select<{ id: string }>("SELECT id FROM work_order WHERE target_type = 'item' AND target_id = ?", [id])) {
        await updateEntity(c, "work_order", w.id, { target_type: null, target_id: null });
      }
      for (const t of await tx.select<{ id: string }>("SELECT id FROM task WHERE target_type = 'item' AND target_id = ?", [id])) {
        await updateEntity(c, "task", t.id, { target_type: null, target_id: null, status: "archived" });
      }
      // Rows still pointing at the item from other items (another parent's leftovers) are detached.
      for (const k of await tx.select<{ id: string }>("SELECT id FROM item WHERE parent_item_id = ?", [id])) {
        await updateEntity(c, "item", k.id, { parent_item_id: null, component_role: null });
      }
      await tx.execute("DELETE FROM item_part WHERE item_id = ?", [id]);
      await tx.execute("DELETE FROM item WHERE id = ?", [id]);
      await tx.execute("DELETE FROM search_index WHERE entity_type = 'item' AND entity_id = ?", [id]);
      const diff: Record<string, [unknown, unknown]> = {};
      for (const [k, v] of Object.entries(item)) diff[k] = [v, null];
      await writeAudit(c, "item", id, "delete", diff);
      deleted++;
    }
  });
  return deleted;
}

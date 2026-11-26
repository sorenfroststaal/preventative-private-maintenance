/** Gifts given and received (migration 0011), and persons in and outside the household. */
import type { DbAdapter } from "../db/adapter";
import type { Row } from "../domain/registry";
import { createEntity, ValidationError, type Ctx } from "./entities";

export interface PersonRow extends Row {
  id: string;
  name: string;
  relation: string | null;
  household: 0 | 1;
}

/** Active persons; `household` true = only the household, false = only people outside it. */
export async function listPersons(db: DbAdapter, opts: { household?: boolean } = {}): Promise<PersonRow[]> {
  const where = opts.household === undefined ? "" : `AND household = ${opts.household ? 1 : 0}`;
  return db.select<PersonRow>(`SELECT * FROM person WHERE archived_at IS NULL ${where} ORDER BY household DESC, name`);
}

/** Creates a person outside the household (family, friends, neighbours), e.g. while lending or giving. */
export async function createOutsidePerson(ctx: Ctx, name: string, relation?: string | null): Promise<Row> {
  return createEntity(ctx, "person", { name: name.trim(), relation: relation?.trim() || null, household: 0 });
}

export interface GiftInput {
  direction?: "given" | "received";
  person_id: string;
  title: string;
  occasion?: string | null;
  gift_date: string;
  amount_minor?: number | null;
  item_id?: string | null;
  notes?: string | null;
}

export interface GiftRow extends Row {
  id: string;
  direction: "given" | "received";
  person_id: string;
  person: string;
  household: 0 | 1;
  title: string;
  occasion: string | null;
  gift_date: string;
  amount_minor: number | null;
  item_id: string | null;
  item: string | null;
}

export async function createGift(ctx: Ctx, input: GiftInput): Promise<Row> {
  const issues: { path: string; message: string }[] = [];
  if (!input.person_id) issues.push({ path: "person_id", message: input.direction === "received" ? "Vælg, hvem gaven er fra" : "Vælg, hvem gaven er til" });
  if (!input.title?.trim()) issues.push({ path: "title", message: "Skriv, hvad gaven er" });
  if (issues.length) throw new ValidationError(issues, "gift");
  return createEntity(ctx, "gift", { ...input, title: input.title.trim(), occasion: input.occasion?.trim() || null });
}

export async function listGifts(db: DbAdapter, opts: { personId?: string; direction?: "given" | "received"; year?: number } = {}): Promise<GiftRow[]> {
  const where: string[] = [];
  const args: (string | number)[] = [];
  const add = (sql: string, v: string) => {
    where.push(sql);
    args.push(v);
  };
  if (opts.personId) add("g.person_id = ?", opts.personId);
  if (opts.direction) add("g.direction = ?", opts.direction);
  if (opts.year) add("substr(g.gift_date, 1, 4) = ?", String(opts.year));
  return db.select<GiftRow>(
    `SELECT g.*, p.name AS person, p.household, i.name AS item FROM gift g JOIN person p ON p.id = g.person_id LEFT JOIN item i ON i.id = g.item_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY g.gift_date DESC, g.created_at DESC`,
    args,
  );
}

export interface GiftPersonSummary {
  person_id: string;
  person: string;
  given: number;
  received: number;
  given_minor: number;
  last_given: string | null;
}

/** Per person: how many gifts were given and received, what was spent, and when the last gift was given. */
export async function giftSummary(db: DbAdapter, opts: { year?: number } = {}): Promise<GiftPersonSummary[]> {
  const rows = await listGifts(db, { year: opts.year });
  const by = new Map<string, GiftPersonSummary>();
  for (const g of rows) {
    const s = by.get(g.person_id) ?? { person_id: g.person_id, person: g.person, given: 0, received: 0, given_minor: 0, last_given: null };
    if (g.direction === "given") {
      s.given++;
      s.given_minor += g.amount_minor ?? 0;
      if (!s.last_given || g.gift_date > s.last_given) s.last_given = g.gift_date;
    } else s.received++;
    by.set(g.person_id, s);
  }
  return [...by.values()].sort((a, b) => a.person.localeCompare(b.person, "da"));
}

export interface LocationOption {
  id: string;
  /** "Køkken", or "Sommerhus · Køkken" when there is more than one property. */
  label: string;
}

/** Rooms and places for dropdowns, with the property's name when there are several properties. */
export async function locationOptions(db: DbAdapter): Promise<LocationOption[]> {
  const rows = await db.select<{ id: string; name: string; property: string; property_id: string }>(
    `SELECT l.id, l.name, p.name AS property, p.id AS property_id FROM location l JOIN property p ON p.id = l.property_id
      WHERE l.archived_at IS NULL AND p.archived_at IS NULL ORDER BY p.name, l.name`,
  );
  const several = new Set(rows.map((r) => r.property_id)).size > 1;
  return rows.map((r) => ({ id: r.id, label: several ? `${r.property} · ${r.name}` : r.name }));
}

/** Lending things out (migration 0007): tools, games, books … to a person, a contact or a free name. */
import type { DbAdapter } from "../db/adapter";
import type { Row } from "../domain/registry";
import { createEntity, updateEntity, ValidationError, type Ctx } from "./entities";

export interface LendInput {
  item_id?: string | null;
  title?: string | null;
  borrower_person_id?: string | null;
  borrower_contact_id?: string | null;
  borrower_name?: string | null;
  lent_date: string;
  due_date?: string | null;
  notes?: string | null;
}

export interface LendingRow extends Row {
  id: string;
  /** The item's name or the free text. */
  thing: string;
  borrower: string;
  lent_date: string;
  due_date: string | null;
  returned_date: string | null;
  overdue: boolean;
}

const LIST_SQL = `SELECT l.*, COALESCE(i.name, l.title) AS thing,
       COALESCE(p.name, c.name, l.borrower_name) AS borrower
  FROM lending l
  LEFT JOIN item i ON i.id = l.item_id
  LEFT JOIN person p ON p.id = l.borrower_person_id
  LEFT JOIN contact c ON c.id = l.borrower_contact_id`;

/** Lends something out. A thing (item or text) and a borrower are required; an item can only be lent once at a time. */
export async function lendItem(ctx: Ctx, input: LendInput): Promise<Row> {
  const issues: { path: string; message: string }[] = [];
  const title = input.title?.trim() || null;
  const name = input.borrower_name?.trim() || null;
  if (!input.item_id && !title) issues.push({ path: "item_id", message: "Vælg en genstand, eller skriv hvad der lånes ud" });
  if (!input.borrower_person_id && !input.borrower_contact_id && !name) issues.push({ path: "borrower_name", message: "Vælg eller skriv, hvem der låner" });
  if (input.due_date && input.due_date < input.lent_date) issues.push({ path: "due_date", message: "Afleveringsdatoen ligger før udlånsdatoen" });
  if (input.item_id) {
    const active = await activeLendingForItem(ctx.db, input.item_id);
    if (active) issues.push({ path: "item_id", message: `Genstanden er allerede udlånt til ${active.borrower}` });
  }
  if (issues.length) throw new ValidationError(issues, "lending");
  return createEntity(ctx, "lending", { ...input, title, borrower_name: name });
}

/** Marks a lending as returned (default today). */
export async function returnLending(ctx: Ctx, id: string, date?: string): Promise<Row> {
  return updateEntity(ctx, "lending", id, { returned_date: date ?? ctx.clock.today() });
}

export async function listLendings(db: DbAdapter, today: string, opts: { active?: boolean } = {}): Promise<LendingRow[]> {
  const where = opts.active === undefined ? "" : opts.active ? "WHERE l.returned_date IS NULL" : "WHERE l.returned_date IS NOT NULL";
  const order = opts.active === false ? "l.returned_date DESC" : "l.due_date IS NULL, l.due_date, l.lent_date";
  const rows = await db.select<LendingRow>(`${LIST_SQL} ${where} ORDER BY ${order}`);
  return rows.map((r) => ({ ...r, overdue: !r.returned_date && Boolean(r.due_date) && r.due_date! < today }));
}

export async function activeLendingForItem(db: DbAdapter, itemId: string): Promise<LendingRow | null> {
  const [r] = await db.select<LendingRow>(`${LIST_SQL} WHERE l.item_id = ? AND l.returned_date IS NULL`, [itemId]);
  return r ? { ...r, overdue: false } : null;
}

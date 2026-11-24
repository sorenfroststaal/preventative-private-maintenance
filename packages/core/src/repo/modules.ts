/** Read models and calculations for the phase 2 modules. */
import type { DbAdapter } from "../db/adapter";
import type { Row } from "../domain/registry";
import { createEntity, getEntity, mustGet, reindex, updateEntity, ValidationError, type Ctx } from "./entities";

// ---------- Work orders ----------

export const WORK_ORDER_STATUSES = ["registered", "quote_requested", "ordered", "done", "invoiced", "closed", "cancelled"] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

/** Changes status (the hook writes the event); an optional note becomes its own event. */
export async function changeWorkOrderStatus(ctx: Ctx, id: string, status: WorkOrderStatus, note?: string | null): Promise<Row> {
  return ctx.db.transaction(async (tx) => {
    const c = { ...ctx, db: tx };
    const changes: Record<string, unknown> = { status };
    const before = await mustGet(tx, "work_order", id);
    if (status === "done" && !before.completed_date) changes.completed_date = ctx.clock.today();
    const after = await updateEntity(c, "work_order", id, changes);
    if (note) await addWorkOrderNote(c, id, note);
    return after;
  });
}

export async function addWorkOrderNote(ctx: Ctx, id: string, note: string): Promise<void> {
  await createEntity(ctx, "work_order_event", {
    work_order_id: id,
    at: ctx.clock.nowIso(),
    status: null,
    note,
    user_id: ctx.userId,
  });
  // Notes are part of the work order's search text (spec 03).
  await reindex(ctx.db, "work_order", await mustGet(ctx.db, "work_order", id));
}

export async function workOrderEvents(db: DbAdapter, id: string): Promise<Row[]> {
  return db.select<Row>(
    `SELECT e.*, u.name AS user_name FROM work_order_event e LEFT JOIN app_user u ON u.id = e.user_id
      WHERE e.work_order_id = ? ORDER BY e.at, e.rowid`,
    [id],
  );
}

export interface HistoryEntry {
  kind: "work_order" | "task_occurrence";
  id: string;
  date: string;
  title: string;
  status: string;
  cost_minor: number | null;
}

/** Work orders and completed task occurrences for a target, newest first (spec 04 "Historikfanen"). */
export async function getHistory(db: DbAdapter, targetType: string, targetId: string): Promise<HistoryEntry[]> {
  const wo = await db.select<HistoryEntry>(
    `SELECT 'work_order' AS kind, id, COALESCE(completed_date, reported_date) AS date, title, status, cost_minor
       FROM work_order WHERE target_type = ? AND target_id = ?`,
    [targetType, targetId],
  );
  const occ = await db.select<HistoryEntry>(
    `SELECT 'task_occurrence' AS kind, o.id, o.completed_date AS date, t.title, o.status, NULL AS cost_minor
       FROM task_occurrence o JOIN task t ON t.id = o.task_id
      WHERE t.target_type = ? AND t.target_id = ? AND o.status != 'open'`,
    [targetType, targetId],
  );
  return [...wo, ...occ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// ---------- Vehicle ----------

export interface VehicleYearCost {
  year: number;
  work_orders_minor: number;
  transactions_minor: number;
  total_minor: number;
}

/** Operating cost per year: work order costs + transactions linked to the vehicle (spec 04). */
export async function vehicleCostsByYear(db: DbAdapter, vehicleId: string): Promise<VehicleYearCost[]> {
  const wo = await db.select<{ year: string; s: number }>(
    `SELECT substr(COALESCE(completed_date, reported_date), 1, 4) AS year, SUM(COALESCE(cost_minor, 0)) AS s
       FROM work_order WHERE target_type = 'vehicle' AND target_id = ? AND status != 'cancelled' GROUP BY year`,
    [vehicleId],
  );
  const tx = await db.select<{ year: string; s: number }>(
    `SELECT substr(t.booking_date, 1, 4) AS year, SUM(-t.amount_minor) AS s
       FROM transaction_link l JOIN bank_transaction t ON t.id = l.transaction_id
      WHERE l.target_type = 'vehicle' AND l.target_id = ? GROUP BY year`,
    [vehicleId],
  );
  const years = new Map<number, VehicleYearCost>();
  const get = (y: string) => {
    const n = Number(y);
    if (!years.has(n)) years.set(n, { year: n, work_orders_minor: 0, transactions_minor: 0, total_minor: 0 });
    return years.get(n)!;
  };
  for (const r of wo) get(r.year).work_orders_minor += r.s ?? 0;
  for (const r of tx) get(r.year).transactions_minor += r.s ?? 0;
  for (const v of years.values()) v.total_minor = v.work_orders_minor + v.transactions_minor;
  return [...years.values()].sort((a, b) => b.year - a.year);
}

export async function latestOdometer(db: DbAdapter, vehicleId: string): Promise<Row | null> {
  const r = await db.select<Row>(
    "SELECT * FROM odometer_reading WHERE vehicle_id = ? ORDER BY reading_date DESC, km DESC LIMIT 1",
    [vehicleId],
  );
  return r[0] ?? null;
}

// ---------- Insurance ----------

const PERIODS_PER_YEAR: Record<string, number> = { month: 12, quarter: 4, half_year: 2, year: 1 };

/** Normalises a premium to a yearly amount (spec 04). */
export function annualAmount(amountMinor: number | null | undefined, period: string | null | undefined): number | null {
  if (amountMinor === null || amountMinor === undefined || !period) return null;
  return amountMinor * (PERIODS_PER_YEAR[period] ?? 1);
}

export function monthlyAverage(amountMinor: number, period: string): number {
  return Math.round((amountMinor * (PERIODS_PER_YEAR[period] ?? 1)) / 12);
}

/** Items covered by a policy: directly, or by being located in a covered property. */
export async function coveredItems(db: DbAdapter, policyId: string): Promise<Row[]> {
  return db.select<Row>(
    `SELECT DISTINCT i.* FROM item i
       LEFT JOIN location l ON l.id = i.location_id
      WHERE i.archived_at IS NULL AND (
        EXISTS (SELECT 1 FROM policy_coverage c WHERE c.policy_id = ? AND c.target_type = 'item' AND c.target_id = i.id)
        OR EXISTS (SELECT 1 FROM policy_coverage c WHERE c.policy_id = ? AND c.target_type = 'property' AND c.target_id = l.property_id)
      ) ORDER BY i.name`,
    [policyId, policyId],
  );
}

export interface CoverageSummary {
  items: number;
  items_value_minor: number;
  coverage_sum_minor: number | null;
  underinsured: boolean;
}

/** Compares the coverage sum with the purchase value of covered items (spec 04). */
export async function coverageSummary(db: DbAdapter, policyId: string): Promise<CoverageSummary> {
  const policy = await mustGet(db, "policy", policyId);
  const items = await coveredItems(db, policyId);
  const value = items.reduce((a, i) => a + ((i.purchase_price_minor as number | null) ?? 0), 0);
  const sum = (policy.coverage_sum_minor as number | null) ?? null;
  return { items: items.length, items_value_minor: value, coverage_sum_minor: sum, underinsured: sum !== null && value > sum };
}

/** Policies covering an item directly or via its property (spec 04 "Fanen Forsikring"). */
export async function policiesForItem(db: DbAdapter, itemId: string): Promise<Row[]> {
  return db.select<Row>(
    `SELECT DISTINCT p.* FROM policy p JOIN policy_coverage c ON c.policy_id = p.id
      WHERE p.archived_at IS NULL AND (
        (c.target_type = 'item' AND c.target_id = ?)
        OR (c.target_type = 'property' AND c.target_id = (
              SELECT l.property_id FROM item i JOIN location l ON l.id = i.location_id WHERE i.id = ?)))
      ORDER BY p.title`,
    [itemId, itemId],
  );
}

// ---------- Health visibility ----------

export function canSeeHealth(person: Row, userId: string | null): boolean {
  return !person.health_private_user_id || person.health_private_user_id === userId;
}

/** Persons whose health data the user may see. */
export async function healthPersons(db: DbAdapter, userId: string | null): Promise<Row[]> {
  return db.select<Row>(
    `SELECT * FROM person WHERE archived_at IS NULL AND (health_private_user_id IS NULL OR health_private_user_id = ?)
      ORDER BY name`,
    [userId],
  );
}

export const HEALTH_TABLES = [
  "health_visit",
  "health_screening",
  "health_vaccination",
  "health_medication",
  "health_allergy",
  "health_measurement",
] as const;
export type HealthTable = (typeof HEALTH_TABLES)[number];

const HEALTH_ORDER: Record<HealthTable, string> = {
  health_visit: "visit_date DESC",
  health_screening: "COALESCE(screening_date, next_due_date) DESC",
  health_vaccination: "given_date DESC",
  health_medication: "end_date IS NOT NULL, start_date DESC",
  health_allergy: "substance",
  health_measurement: "type, measured_at",
};

export class HealthAccessError extends Error {
  constructor() {
    super("Helbredsoplysningerne for denne person er private.");
    this.name = "HealthAccessError";
  }
}

/** Health records for a person, respecting health_private_user_id (spec 03/04). */
export async function healthRecords(db: DbAdapter, table: HealthTable, personId: string, userId: string | null): Promise<Row[]> {
  const person = await getEntity(db, "person", personId);
  if (!person) throw new ValidationError([{ path: "person_id", message: "Personen findes ikke" }]);
  if (!canSeeHealth(person, userId)) throw new HealthAccessError();
  return db.select<Row>(`SELECT * FROM ${table} WHERE person_id = ? ORDER BY ${HEALTH_ORDER[table]}`, [personId]);
}

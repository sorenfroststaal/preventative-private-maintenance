/**
 * Derived rules (spec 03): date fields that create/update exactly one system task
 * identified by a unique system_ref.
 */
import type { Row } from "./registry";
import type { EntityType } from "./schemas";
import { createEntity, getEntity, registerAfterWrite, updateEntity, type Ctx } from "../repo/entities";

type TaskModule = "home" | "maintenance" | "vehicle" | "finance" | "insurance" | "health" | "custom";
type TaskTarget = "property" | "building_part" | "item" | "vehicle" | "person" | "policy";

interface Rule {
  type: EntityType;
  field: string;
  ref: (id: string) => string;
  module: TaskModule;
  title: (row: Row, ctx: Ctx) => Promise<string>;
  target: (row: Row) => { type: TaskTarget; id: string } | null;
}

async function personName(ctx: Ctx, id: unknown): Promise<string> {
  const p = id ? await getEntity(ctx.db, "person", String(id)) : null;
  return p ? String(p.name) : "?";
}

export const DERIVED_RULES: Rule[] = [
  {
    type: "item",
    field: "complaint_until",
    ref: (id) => `item.complaint_until:${id}`,
    module: "home",
    title: async (r) => `Reklamationsret udløber: ${r.name}`,
    target: (r) => ({ type: "item", id: String(r.id) }),
  },
  {
    type: "item",
    field: "warranty_until",
    ref: (id) => `item.warranty_until:${id}`,
    module: "home",
    title: async (r) => `Garanti udløber: ${r.name}`,
    target: (r) => ({ type: "item", id: String(r.id) }),
  },
  {
    type: "policy",
    field: "renewal_date",
    ref: (id) => `policy.renewal:${id}`,
    module: "insurance",
    title: async (r) => `Forsikring fornyes: ${r.title}`,
    target: (r) => ({ type: "policy", id: String(r.id) }),
  },
  {
    type: "recurring_expense",
    field: "binding_until",
    ref: (id) => `recurring_expense.binding:${id}`,
    module: "finance",
    title: async (r) => `Binding udløber: ${r.name}`,
    target: () => null,
  },
  {
    type: "health_screening",
    field: "next_due_date",
    ref: (id) => `health_screening.next:${id}`,
    module: "health",
    title: async (r, ctx) => `${r.name} (${await personName(ctx, r.person_id)})`,
    target: (r) => ({ type: "person", id: String(r.person_id) }),
  },
  {
    type: "health_vaccination",
    field: "next_due_date",
    ref: (id) => `health_vaccination.next:${id}`,
    module: "health",
    title: async (r, ctx) => `${r.vaccine} (${await personName(ctx, r.person_id)})`,
    target: (r) => ({ type: "person", id: String(r.person_id) }),
  },
  {
    type: "health_medication",
    field: "prescription_renewal_date",
    ref: (id) => `health_medication.renewal:${id}`,
    module: "health",
    title: async (r, ctx) => `Forny recept: ${r.name} (${await personName(ctx, r.person_id)})`,
    target: (r) => ({ type: "person", id: String(r.person_id) }),
  },
];

/** Creates, updates or archives the system task for one rule and row. */
export async function syncSystemTask(ctx: Ctx, rule: Rule, row: Row): Promise<void> {
  const ref = rule.ref(String(row.id));
  const date = (row[rule.field] as string | null) ?? null;
  const archived = Boolean(row.archived_at);
  const existing = (await ctx.db.select<Row>("SELECT * FROM task WHERE system_ref = ?", [ref]))[0];

  if (!date || archived) {
    if (existing && existing.status !== "archived") {
      await updateEntity(ctx, "task", String(existing.id), { status: "archived" });
    }
    return;
  }
  const title = await rule.title(row, ctx);
  const target = rule.target(row);
  if (!existing) {
    const task = await createEntity(ctx, "task", {
      title,
      module: rule.module,
      target_type: target?.type ?? null,
      target_id: target?.id ?? null,
      source: "system",
      system_ref: ref,
      reminder_days: 60,
    });
    await createEntity(ctx, "task_occurrence", { task_id: String(task.id), due_date: date, status: "open" });
    return;
  }
  await updateEntity(ctx, "task", String(existing.id), { title, status: "active" });
  const open = (
    await ctx.db.select<Row>("SELECT * FROM task_occurrence WHERE task_id = ? AND status = 'open'", [String(existing.id)])
  )[0];
  if (open) {
    if (open.due_date !== date) await updateEntity(ctx, "task_occurrence", String(open.id), { due_date: date });
  } else {
    // The previous date was completed; a new date starts a new occurrence.
    const last = (
      await ctx.db.select<Row>(
        "SELECT due_date FROM task_occurrence WHERE task_id = ? ORDER BY completed_date DESC LIMIT 1",
        [String(existing.id)],
      )
    )[0];
    if (last?.due_date !== date) {
      await createEntity(ctx, "task_occurrence", { task_id: String(existing.id), due_date: date, status: "open" });
    }
  }
}

let registered = false;
export function registerDerivedRules(): void {
  if (registered) return;
  registered = true;
  const byType = new Map<EntityType, Rule[]>();
  for (const r of DERIVED_RULES) byType.set(r.type, [...(byType.get(r.type) ?? []), r]);
  for (const [type, rules] of byType) {
    registerAfterWrite(type, async (ctx, row) => {
      for (const rule of rules) await syncSystemTask(ctx, rule, row);
    });
  }
}

/** The automatic deadline tasks that end by themselves when the date has passed. */
const EXPIRING_REFS = ["item.complaint_until:", "item.warranty_until:"];

/**
 * Closes open occurrences of expired complaint-period and warranty tasks (the deadline has passed, so
 * there is nothing left to do): status 'skipped' on the due date with the note "Udløbet". Run when the
 * app opens and regularly while it runs. Returns the number closed.
 */
export async function closeExpiredDeadlines(ctx: Ctx): Promise<number> {
  const today = ctx.clock.today();
  const rows = await ctx.db.select<{ id: string; due_date: string }>(
    `SELECT o.id, o.due_date FROM task_occurrence o JOIN task t ON t.id = o.task_id
      WHERE o.status = 'open' AND o.due_date IS NOT NULL AND o.due_date < ? AND t.source = 'system'
        AND (${EXPIRING_REFS.map(() => "t.system_ref LIKE ?").join(" OR ")})`,
    [today, ...EXPIRING_REFS.map((r) => `${r}%`)],
  );
  const c = { ...ctx, via: "system" as const };
  for (const r of rows) await updateEntity(c, "task_occurrence", r.id, { status: "skipped", completed_date: r.due_date, note: "Udløbet" });
  return rows.length;
}

/** Whether an item's complaint period (reklamationsret) or warranty has run out, and days left. */
export function deadlineState(
  item: Row,
  today: string,
): { complaintExpired: boolean; warrantyExpired: boolean; complaintDaysLeft: number | null; warrantyDaysLeft: number | null } {
  const days = (v: unknown) =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? Math.round((Date.parse(`${v}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000) : null;
  const c = days(item.complaint_until);
  const w = days(item.warranty_until);
  return { complaintExpired: c !== null && c < 0, warrantyExpired: w !== null && w < 0, complaintDaysLeft: c, warrantyDaysLeft: w };
}

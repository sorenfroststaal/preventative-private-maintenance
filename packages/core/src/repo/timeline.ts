/**
 * Events for the calendar and the timeline: dates from across the app in one shape. Each kind can be
 * switched on and off. Health events respect private health data (spec 03).
 */
import type { DbAdapter, SqlValue } from "../db/adapter";

export const TIMELINE_KINDS = [
  { id: "task", label: "Opgaver", module: "tasks" },
  { id: "work_order", label: "Arbejdsordrer", module: "maintenance" },
  { id: "purchase", label: "Køb", module: "home" },
  { id: "warranty", label: "Garanti og reklamationsret", module: "home" },
  { id: "lending", label: "Udlån", module: "home" },
  { id: "policy", label: "Forsikringer", module: "insurance" },
  { id: "recurring", label: "Faste udgifter og bindinger", module: "finance" },
  { id: "loan", label: "Lån", module: "finance" },
  { id: "meal", label: "Madplan", module: "food" },
  { id: "health", label: "Helbred", module: "health" },
  { id: "document", label: "Dokumenter", module: "documents" },
] as const;

export type TimelineKind = (typeof TIMELINE_KINDS)[number]["id"];
export const DEFAULT_TIMELINE_KINDS: TimelineKind[] = ["task", "work_order", "purchase", "warranty", "lending", "policy", "recurring", "loan"];

export interface TimelineEvent {
  id: string;
  kind: TimelineKind;
  /** YYYY-MM-DD */
  start: string;
  /** Last day of a period (inclusive), or null for a single day. */
  end: string | null;
  /** The period is still going on; `end` is today, not a real end date. */
  ongoing?: boolean;
  title: string;
  detail: string | null;
  status: "open" | "done" | "overdue" | null;
  /** The record behind the event, for navigation. */
  ref: { type: string; id: string };
}

interface Opts {
  from: string;
  to: string;
  kinds?: TimelineKind[];
  today: string;
  /** The logged-in user; persons with health data private to another user are left out. */
  userId: string | null;
}

type Raw = Record<string, SqlValue>;
/** 2026-11-23 → 23.11.2026 (Danish date in event details). */
const da = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const str = (v: SqlValue | undefined) => (v === null || v === undefined ? null : String(v));

/** All events overlapping [from, to], sorted by start date. */
export async function timelineEvents(db: DbAdapter, o: Opts): Promise<TimelineEvent[]> {
  const kinds = new Set<TimelineKind>(o.kinds ?? DEFAULT_TIMELINE_KINDS);
  const out: TimelineEvent[] = [];
  const inRange = (d: string | null) => d !== null && d >= o.from && d <= o.to;
  const overlaps = (s: string, e: string | null) => s <= o.to && (e ?? s) >= o.from;
  const sel = (sql: string, params: SqlValue[] = []) => db.select<Raw>(sql, params);
  const push = (e: TimelineEvent) => {
    if (overlaps(e.start, e.end)) out.push(e);
  };

  if (kinds.has("task")) {
    const rows = await sel(
      `SELECT o.id, o.due_date, o.completed_date, o.status, t.id AS task_id, t.title, t.module FROM task_occurrence o JOIN task t ON t.id = o.task_id
         LEFT JOIN person p ON t.target_type = 'person' AND p.id = t.target_id
        WHERE t.status != 'archived' AND o.status != 'skipped'
          AND NOT (t.module = 'health' AND p.health_private_user_id IS NOT NULL AND p.health_private_user_id IS NOT ?)
          AND ((o.status = 'open' AND o.due_date BETWEEN ? AND ?) OR (o.status = 'done' AND o.completed_date BETWEEN ? AND ?))`,
      [o.userId, o.from, o.to, o.from, o.to],
    );
    for (const r of rows) {
      const done = r.status === "done";
      const date = String(done ? r.completed_date : r.due_date);
      push({ id: `task:${r.id}`, kind: "task", start: date, end: null, title: String(r.title), detail: done ? "Udført" : null, status: done ? "done" : date < o.today ? "overdue" : "open", ref: { type: "task", id: String(r.task_id) } });
    }
  }
  if (kinds.has("work_order")) {
    const rows = await sel(
      `SELECT id, title, status, reported_date, completed_date FROM work_order WHERE status != 'cancelled' AND reported_date <= ? AND COALESCE(completed_date, ?) >= ?`,
      [o.to, o.today > o.to ? o.to : o.today, o.from],
    );
    for (const r of rows) {
      const done = ["done", "invoiced", "closed"].includes(String(r.status));
      const end = str(r.completed_date) ?? (done ? null : o.today);
      push({ id: `work_order:${r.id}`, kind: "work_order", start: String(r.reported_date), end, ongoing: !done && !r.completed_date, title: String(r.title), detail: done ? null : "I gang", status: done ? "done" : "open", ref: { type: "work_order", id: String(r.id) } });
    }
  }
  if (kinds.has("purchase")) {
    for (const r of await sel("SELECT id, name, purchase_date FROM item WHERE archived_at IS NULL AND purchase_date BETWEEN ? AND ?", [o.from, o.to]))
      push({ id: `purchase:item:${r.id}`, kind: "purchase", start: String(r.purchase_date), end: null, title: `Købt: ${r.name}`, detail: null, status: null, ref: { type: "item", id: String(r.id) } });
    for (const r of await sel("SELECT id, name, purchase_date FROM vehicle WHERE archived_at IS NULL AND purchase_date BETWEEN ? AND ?", [o.from, o.to]))
      push({ id: `purchase:vehicle:${r.id}`, kind: "purchase", start: String(r.purchase_date), end: null, title: `Købt: ${r.name}`, detail: null, status: null, ref: { type: "vehicle", id: String(r.id) } });
  }
  if (kinds.has("warranty")) {
    const rows = await sel(
      "SELECT id, name, warranty_until, complaint_until FROM item WHERE archived_at IS NULL AND (warranty_until BETWEEN ? AND ? OR complaint_until BETWEEN ? AND ?)",
      [o.from, o.to, o.from, o.to],
    );
    for (const r of rows) {
      if (inRange(str(r.warranty_until))) push({ id: `warranty:${r.id}`, kind: "warranty", start: String(r.warranty_until), end: null, title: `Garanti udløber: ${r.name}`, detail: null, status: null, ref: { type: "item", id: String(r.id) } });
      if (inRange(str(r.complaint_until))) push({ id: `complaint:${r.id}`, kind: "warranty", start: String(r.complaint_until), end: null, title: `Reklamationsret udløber: ${r.name}`, detail: null, status: null, ref: { type: "item", id: String(r.id) } });
    }
  }
  if (kinds.has("lending")) {
    const rows = await sel(
      `SELECT l.id, l.lent_date, l.due_date, l.returned_date, COALESCE(i.name, l.title) AS thing, COALESCE(p.name, c.name, l.borrower_name) AS borrower
         FROM lending l LEFT JOIN item i ON i.id = l.item_id LEFT JOIN person p ON p.id = l.borrower_person_id LEFT JOIN contact c ON c.id = l.borrower_contact_id
        WHERE l.lent_date <= ?`,
      [o.to],
    );
    for (const r of rows) {
      const returned = str(r.returned_date);
      const due = str(r.due_date);
      const end = returned ?? (due && due > o.today ? due : o.today);
      const overdue = !returned && due !== null && due < o.today;
      push({ id: `lending:${r.id}`, kind: "lending", start: String(r.lent_date), end, ongoing: !returned && end === o.today, title: `${r.thing} lånt ud til ${r.borrower}`, detail: returned ? `Afleveret ${da(returned)}` : due ? `Afleveres ${da(due)}` : "Ingen afleveringsdato", status: returned ? "done" : overdue ? "overdue" : "open", ref: { type: "lending", id: String(r.id) } });
    }
  }
  if (kinds.has("policy")) {
    for (const r of await sel("SELECT id, title, renewal_date FROM policy WHERE archived_at IS NULL AND renewal_date BETWEEN ? AND ?", [o.from, o.to]))
      push({ id: `policy:${r.id}`, kind: "policy", start: String(r.renewal_date), end: null, title: `Fornyelse: ${r.title}`, detail: null, status: null, ref: { type: "policy", id: String(r.id) } });
  }
  if (kinds.has("recurring")) {
    const rows = await sel(
      "SELECT id, name, next_date, binding_until, end_date FROM recurring_expense WHERE archived_at IS NULL AND (next_date BETWEEN ? AND ? OR binding_until BETWEEN ? AND ? OR end_date BETWEEN ? AND ?)",
      [o.from, o.to, o.from, o.to, o.from, o.to],
    );
    for (const r of rows) {
      const ref = { type: "recurring_expense", id: String(r.id) };
      if (inRange(str(r.next_date))) push({ id: `recurring:next:${r.id}`, kind: "recurring", start: String(r.next_date), end: null, title: `Betaling: ${r.name}`, detail: null, status: null, ref });
      if (inRange(str(r.binding_until))) push({ id: `recurring:binding:${r.id}`, kind: "recurring", start: String(r.binding_until), end: null, title: `Binding slutter: ${r.name}`, detail: null, status: null, ref });
      if (inRange(str(r.end_date))) push({ id: `recurring:end:${r.id}`, kind: "recurring", start: String(r.end_date), end: null, title: `Slutter: ${r.name}`, detail: null, status: null, ref });
    }
  }
  if (kinds.has("loan")) {
    for (const r of await sel("SELECT id, name, start_date, end_date FROM loan WHERE archived_at IS NULL AND (start_date IS NOT NULL OR end_date IS NOT NULL)")) {
      const start = str(r.start_date);
      const end = str(r.end_date);
      if (start && end) push({ id: `loan:${r.id}`, kind: "loan", start, end, title: String(r.name), detail: `Sidste ydelse ${da(end)}`, status: null, ref: { type: "loan", id: String(r.id) } });
      else if (end) push({ id: `loan:${r.id}`, kind: "loan", start: end, end: null, title: `Sidste ydelse: ${r.name}`, detail: null, status: null, ref: { type: "loan", id: String(r.id) } });
      else if (start) push({ id: `loan:${r.id}`, kind: "loan", start, end: null, title: `Lån optaget: ${r.name}`, detail: null, status: null, ref: { type: "loan", id: String(r.id) } });
    }
  }
  if (kinds.has("meal")) {
    const rows = await sel(
      "SELECT m.id, m.plan_date, m.meal, COALESCE(r.name, m.title) AS name FROM meal_plan_entry m LEFT JOIN recipe r ON r.id = m.recipe_id WHERE m.plan_date BETWEEN ? AND ?",
      [o.from, o.to],
    );
    const MEAL: Record<string, string> = { breakfast: "Morgenmad", lunch: "Frokost", dinner: "Aftensmad", snack: "Mellemmåltid" };
    for (const r of rows) push({ id: `meal:${r.id}`, kind: "meal", start: String(r.plan_date), end: null, title: String(r.name), detail: MEAL[String(r.meal)] ?? null, status: null, ref: { type: "meal_plan_entry", id: String(r.id) } });
  }
  if (kinds.has("health")) {
    const visible = "(p.health_private_user_id IS NULL OR p.health_private_user_id IS ?)";
    const VISIT: Record<string, string> = { gp: "Læge", dentist: "Tandlæge", specialist: "Speciallæge", hospital: "Hospital", physio: "Fysioterapeut", other: "Besøg" };
    for (const r of await sel(`SELECT v.id, v.visit_date, v.kind, p.name, p.id AS pid FROM health_visit v JOIN person p ON p.id = v.person_id WHERE ${visible} AND v.visit_date BETWEEN ? AND ?`, [o.userId, o.from, o.to]))
      push({ id: `health:visit:${r.id}`, kind: "health", start: String(r.visit_date), end: null, title: `${VISIT[String(r.kind)] ?? "Besøg"}: ${r.name}`, detail: null, status: String(r.visit_date) < o.today ? "done" : "open", ref: { type: "person", id: String(r.pid) } });
    for (const r of await sel(`SELECT v.id, v.vaccine, v.next_due_date, p.name, p.id AS pid FROM health_vaccination v JOIN person p ON p.id = v.person_id WHERE ${visible} AND v.next_due_date BETWEEN ? AND ?`, [o.userId, o.from, o.to]))
      push({ id: `health:vacc:${r.id}`, kind: "health", start: String(r.next_due_date), end: null, title: `Vaccination (${r.vaccine}): ${r.name}`, detail: null, status: null, ref: { type: "person", id: String(r.pid) } });
  }
  if (kinds.has("document")) {
    for (const r of await sel("SELECT id, COALESCE(title, filename) AS title, doc_date FROM document WHERE doc_date BETWEEN ? AND ?", [o.from, o.to]))
      push({ id: `document:${r.id}`, kind: "document", start: String(r.doc_date), end: null, title: String(r.title), detail: null, status: null, ref: { type: "document", id: String(r.id) } });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title, "da"));
}

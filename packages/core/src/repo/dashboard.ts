/** Queries behind each dashboard section (spec 04 "Overblik"). */
import type { DbAdapter } from "../db/adapter";
import { addDays, addMonths } from "../recurrence/dates";
import { mealsTodayTomorrow, type PlannedDish } from "../food/mealplan";
import { monthFinance, type MonthFinance } from "./finance";
import { getSetting } from "./settings";

export interface DashboardTask {
  task_id: string;
  occurrence_id: string;
  title: string;
  module: string;
  source: string;
  due_date: string | null;
  target_type: string | null;
  target_id: string | null;
}

export interface Dashboard {
  overdue: DashboardTask[];
  upcoming: DashboardTask[];
  expiring: DashboardTask[];
  missing: {
    itemsWithoutReceipt: { id: string; name: string }[];
    tasksWithoutDate: DashboardTask[];
    policiesWithoutRenewal: { id: string; title: string }[];
    vehiclesWithoutOdometer: { id: string; name: string }[];
  };
  aiPending: number;
  finance: MonthFinance;
  /** Spending per month, oldest first, ending with the current month (spec 04 "Visuel stil"). */
  spending: MonthSpending[];
  /** Today's and tomorrow's dishes; null when this week's meal plan is empty. */
  meals: { today: PlannedDish[]; tomorrow: PlannedDish[] } | null;
  backup: { lastAt: string | null; due: boolean };
  horizonDays: number;
}

export interface MonthSpending {
  month: string;
  expense_minor: number;
}

/**
 * Spending for the last `months` months: all outgoing transactions except transfers
 * (uncategorised ones included), as positive numbers.
 */
export async function monthlySpending(db: DbAdapter, today: string, months = 6): Promise<MonthSpending[]> {
  const first = addMonths(`${today.slice(0, 7)}-01`, -(months - 1)).slice(0, 7);
  const rows = await db.select<{ m: string; s: number }>(
    `SELECT substr(t.booking_date, 1, 7) AS m, -SUM(t.amount_minor) AS s FROM bank_transaction t
       LEFT JOIN category c ON c.id = t.category_id
      WHERE t.amount_minor < 0 AND (c.kind IS NULL OR c.kind != 'transfer')
        AND substr(t.booking_date, 1, 7) BETWEEN ? AND ? GROUP BY m`,
    [first, today.slice(0, 7)],
  );
  const by = new Map(rows.map((r) => [r.m, r.s]));
  return Array.from({ length: months }, (_, i) => {
    const month = addMonths(`${first}-01`, i).slice(0, 7);
    return { month, expense_minor: by.get(month) ?? 0 };
  });
}

export const EXPIRING_DAYS = 60;
/** Recently expired system tasks stay visible this long; older ones are no longer actionable. */
export const EXPIRED_GRACE_DAYS = 30;

/**
 * Open occurrences of active tasks the user may see. Health tasks on persons whose
 * health data is private to another user are hidden.
 */
async function openTasks(db: DbAdapter, userId: string | null): Promise<DashboardTask[]> {
  return db.select<DashboardTask>(
    `SELECT t.id AS task_id, o.id AS occurrence_id, t.title, t.module, t.source, o.due_date, t.target_type, t.target_id
       FROM task t JOIN task_occurrence o ON o.task_id = t.id AND o.status = 'open'
       LEFT JOIN person p ON t.target_type = 'person' AND p.id = t.target_id
      WHERE t.status = 'active'
        AND NOT (t.module = 'health' AND p.health_private_user_id IS NOT NULL AND p.health_private_user_id IS NOT ?)
      ORDER BY o.due_date IS NULL, o.due_date, t.title`,
    [userId],
  );
}

export async function dashboard(db: DbAdapter, opts: { today: string; userId: string | null }): Promise<Dashboard> {
  const { today } = opts;
  const horizonDays = (await getSetting<number>(db, "dashboard.horizon_days")) ?? 30;
  const until = addDays(today, horizonDays);
  const expiringUntil = addDays(today, EXPIRING_DAYS);
  const expiredSince = addDays(today, -EXPIRED_GRACE_DAYS);
  const tasks = await openTasks(db, opts.userId);
  // System tasks (warranty, complaint, policy, binding, prescription…) live in "Udløber snart".
  const normal = tasks.filter((t) => t.source !== "system");
  const system = tasks.filter((t) => t.source === "system");

  const itemsWithoutReceipt = await db.select<{ id: string; name: string }>(
    `SELECT i.id, i.name FROM item i WHERE i.archived_at IS NULL AND i.purchase_price_minor IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM document_link l WHERE l.target_type = 'item' AND l.target_id = i.id AND l.role = 'receipt')
      ORDER BY i.name`,
  );
  const policiesWithoutRenewal = await db.select<{ id: string; title: string }>(
    "SELECT id, title FROM policy WHERE archived_at IS NULL AND renewal_date IS NULL ORDER BY title",
  );
  const vehiclesWithoutOdometer = await db.select<{ id: string; name: string }>(
    `SELECT v.id, v.name FROM vehicle v WHERE v.archived_at IS NULL AND NOT EXISTS (
        SELECT 1 FROM odometer_reading r WHERE r.vehicle_id = v.id AND r.reading_date >= ?) ORDER BY v.name`,
    [addDays(today, -365)],
  );
  const ai = await db.select<{ n: number }>("SELECT count(*) AS n FROM ai_draft WHERE status = 'pending'");
  const lastAt = (await getSetting<string>(db, "backup.last_at")) ?? null;
  const backupDue = !lastAt || lastAt.slice(0, 10) < addDays(today, -30);

  return {
    overdue: normal.filter((t) => t.due_date !== null && t.due_date < today),
    upcoming: normal.filter((t) => t.due_date !== null && t.due_date >= today && t.due_date <= until),
    expiring: system.filter((t) => t.due_date !== null && t.due_date >= expiredSince && t.due_date <= expiringUntil),
    missing: {
      itemsWithoutReceipt,
      tasksWithoutDate: tasks.filter((t) => t.due_date === null),
      policiesWithoutRenewal,
      vehiclesWithoutOdometer,
    },
    aiPending: ai[0]?.n ?? 0,
    finance: await monthFinance(db, today.slice(0, 7)),
    spending: await monthlySpending(db, today),
    meals: await mealsTodayTomorrow(db, today, opts.userId),
    backup: { lastAt, due: backupDue },
    horizonDays,
  };
}

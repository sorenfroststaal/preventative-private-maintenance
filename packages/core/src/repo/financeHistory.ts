/** Finance history: monthly income/expense, per-category history and the food budget (Økonomi → Overblik). */
import type { DbAdapter } from "../db/adapter";
import { FOOD_CATEGORY, foodCategoryIds } from "../food/mealplan";
import { createEntity, updateEntity, ValidationError, type Ctx } from "./entities";
import { recurringSummary } from "./finance";
import { addMonths } from "../recurrence/dates";

/** The last `months` months ending with the month of `today`, oldest first ("YYYY-MM"). */
export function monthRange(today: string, months: number): string[] {
  const first = addMonths(`${today.slice(0, 7)}-01`, -(months - 1));
  return Array.from({ length: months }, (_, i) => addMonths(first, i).slice(0, 7));
}

export interface MonthFlow {
  month: string;
  income_minor: number;
  /** Positive = spent. */
  expense_minor: number;
}

/**
 * Income and expense per month. Transfers are left out. Uncategorised transactions count by sign:
 * money in is income, money out is expense. Categorised ones count by the category's kind (a refund
 * in an expense category lowers the expense).
 */
export async function monthlyFlow(db: DbAdapter, today: string, months = 12): Promise<MonthFlow[]> {
  const range = monthRange(today, months);
  const rows = await db.select<{ m: string; kind: string | null; pos: number; neg: number }>(
    `SELECT substr(t.booking_date, 1, 7) AS m, c.kind AS kind,
            SUM(CASE WHEN t.amount_minor > 0 THEN t.amount_minor ELSE 0 END) AS pos,
            SUM(CASE WHEN t.amount_minor < 0 THEN t.amount_minor ELSE 0 END) AS neg
       FROM bank_transaction t LEFT JOIN category c ON c.id = t.category_id
      WHERE substr(t.booking_date, 1, 7) BETWEEN ? AND ? AND (c.kind IS NULL OR c.kind != 'transfer')
      GROUP BY m, c.kind`,
    [range[0]!, range[range.length - 1]!],
  );
  const by = new Map(range.map((m) => [m, { month: m, income_minor: 0, expense_minor: 0 }]));
  for (const r of rows) {
    const f = by.get(r.m);
    if (!f) continue;
    if (r.kind === "income") f.income_minor += r.pos + r.neg;
    else if (r.kind === "expense") f.expense_minor -= r.pos + r.neg;
    else {
      f.income_minor += r.pos;
      f.expense_minor -= r.neg;
    }
  }
  return [...by.values()];
}

/** The category and all its subcategories. */
export async function categoryWithChildren(db: DbAdapter, categoryId: string): Promise<string[]> {
  const cats = await db.select<{ id: string; parent_id: string | null }>("SELECT id, parent_id FROM category");
  const ids = new Set([categoryId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of cats) {
      if (c.parent_id && ids.has(c.parent_id) && !ids.has(c.id)) {
        ids.add(c.id);
        grew = true;
      }
    }
  }
  return [...ids];
}

export interface MonthAmount {
  month: string;
  /** Positive = spent (expense) or received (income), by the category's kind. */
  amount_minor: number;
  budget_minor: number;
}

async function seriesFor(db: DbAdapter, ids: string[], sign: 1 | -1, today: string, months: number): Promise<MonthAmount[]> {
  const range = monthRange(today, months);
  const by = new Map(range.map((m) => [m, { month: m, amount_minor: 0, budget_minor: 0 }]));
  if (ids.length === 0) return [...by.values()];
  const marks = ids.map(() => "?").join(",");
  const tx = await db.select<{ m: string; s: number }>(
    `SELECT substr(booking_date, 1, 7) AS m, SUM(amount_minor) AS s FROM bank_transaction
      WHERE category_id IN (${marks}) AND substr(booking_date, 1, 7) BETWEEN ? AND ? GROUP BY m`,
    [...ids, range[0]!, range[range.length - 1]!],
  );
  for (const t of tx) by.get(t.m)!.amount_minor = sign * t.s;
  const years = [...new Set(range.map((m) => Number(m.slice(0, 4))))];
  const lines = await db.select<{ year: number; month: number | null; amount_minor: number }>(
    `SELECT b.year, l.month, l.amount_minor FROM budget_line l JOIN budget b ON b.id = l.budget_id
      WHERE l.category_id IN (${marks}) AND b.year IN (${years.map(() => "?").join(",")})`,
    [...ids, ...years],
  );
  for (const l of lines) {
    for (const f of by.values()) {
      if (Number(f.month.slice(0, 4)) !== l.year) continue;
      if (l.month === null || l.month === Number(f.month.slice(5, 7))) f.budget_minor += l.amount_minor;
    }
  }
  return [...by.values()];
}

/** Monthly history of one category (with subcategories), plus its budget. */
export async function categoryHistory(db: DbAdapter, categoryId: string, today: string, months = 12): Promise<MonthAmount[]> {
  const [cat] = await db.select<{ kind: string }>("SELECT kind FROM category WHERE id = ?", [categoryId]);
  if (!cat) return monthRange(today, months).map((month) => ({ month, amount_minor: 0, budget_minor: 0 }));
  return seriesFor(db, await categoryWithChildren(db, categoryId), cat.kind === "income" ? 1 : -1, today, months);
}

export interface FoodHistory {
  /** False when there is no "Mad og dagligvarer" category. */
  has_category: boolean;
  months: MonthAmount[];
  average_minor: number;
}

/** Food spending per month ("Mad og dagligvarer" and subcategories) against the budget. */
export async function foodHistory(db: DbAdapter, today: string, months = 12): Promise<FoodHistory> {
  const ids = await foodCategoryIds(db);
  const series = await seriesFor(db, ids, -1, today, months);
  // The current month is incomplete; average the full months only.
  const full = series.slice(0, -1).filter((m) => m.amount_minor !== 0);
  const average = full.length ? Math.round(full.reduce((a, m) => a + m.amount_minor, 0) / full.length) : 0;
  return { has_category: ids.length > 0, months: series, average_minor: average };
}

/** Finds the year's budget (the first one) or creates "Familiebudget". */
export async function ensureBudget(ctx: Ctx, year: number): Promise<string> {
  const [b] = await ctx.db.select<{ id: string }>("SELECT id FROM budget WHERE year = ? ORDER BY rowid LIMIT 1", [year]);
  if (b) return b.id;
  return String((await createEntity(ctx, "budget", { year, name: "Familiebudget" })).id);
}

/**
 * Sets the monthly food budget for a year: one line without month on "Mad og dagligvarer".
 * Replaces an existing whole-year line for that category; month-specific lines are kept.
 */
export async function setFoodBudget(ctx: Ctx, year: number, monthlyMinor: number): Promise<void> {
  const [food] = await ctx.db.select<{ id: string }>("SELECT id FROM category WHERE name = ? AND parent_id IS NULL AND archived_at IS NULL", [FOOD_CATEGORY]);
  if (!food) throw new ValidationError([{ path: "category_id", message: `Kategorien "${FOOD_CATEGORY}" findes ikke` }]);
  const budgetId = await ensureBudget(ctx, year);
  const [line] = await ctx.db.select<{ id: string }>("SELECT id FROM budget_line WHERE budget_id = ? AND category_id = ? AND month IS NULL", [budgetId, food.id]);
  if (line) await updateEntity(ctx, "budget_line", line.id, { amount_minor: monthlyMinor });
  else await createEntity(ctx, "budget_line", { budget_id: budgetId, category_id: food.id, amount_minor: monthlyMinor });
}

/**
 * "Foreslå fra faste udgifter": adds a monthly line per category from the recurring expenses'
 * monthly averages, for categories that have no line in the budget yet. Returns the number added.
 */
export async function budgetFromRecurring(ctx: Ctx, budgetId: string): Promise<number> {
  const { items } = await recurringSummary(ctx.db);
  const existing = new Set((await ctx.db.select<{ category_id: string }>("SELECT category_id FROM budget_line WHERE budget_id = ?", [budgetId])).map((l) => l.category_id));
  const sums = new Map<string, number>();
  for (const i of items) {
    if (!i.category_id || existing.has(String(i.category_id))) continue;
    sums.set(String(i.category_id), (sums.get(String(i.category_id)) ?? 0) + i.monthly_minor);
  }
  for (const [category_id, amount] of sums) await createEntity(ctx, "budget_line", { budget_id: budgetId, category_id, amount_minor: Math.max(0, amount) });
  return sums.size;
}

export interface CategoryTrend {
  category_id: string;
  /** "Fritid › Streaming" for subcategories. */
  name: string;
  kind: string;
  values: number[];
  total_minor: number;
}

/** Every category with activity in the period, with its own monthly series (incl. subcategories), largest first. */
export async function categoryTrends(db: DbAdapter, today: string, months = 12): Promise<{ months: string[]; rows: CategoryTrend[] }> {
  const range = monthRange(today, months);
  const cats = await db.select<{ id: string; parent_id: string | null; name: string; kind: string }>(
    "SELECT id, parent_id, name, kind FROM category WHERE archived_at IS NULL AND kind != 'transfer'",
  );
  const byId = new Map(cats.map((c) => [c.id, c]));
  const tx = await db.select<{ category_id: string; m: string; s: number }>(
    `SELECT category_id, substr(booking_date, 1, 7) AS m, SUM(amount_minor) AS s FROM bank_transaction
      WHERE category_id IS NOT NULL AND substr(booking_date, 1, 7) BETWEEN ? AND ? GROUP BY category_id, m`,
    [range[0]!, range[range.length - 1]!],
  );
  const rows = new Map<string, CategoryTrend>();
  for (const c of cats) {
    const parent = c.parent_id ? byId.get(c.parent_id) : undefined;
    rows.set(c.id, { category_id: c.id, name: parent ? `${parent.name} › ${c.name}` : c.name, kind: c.kind, values: range.map(() => 0), total_minor: 0 });
  }
  for (const t of tx) {
    const i = range.indexOf(t.m);
    // Add to the category and every ancestor.
    let c = byId.get(t.category_id);
    const seen = new Set<string>();
    while (c && !seen.has(c.id)) {
      seen.add(c.id);
      const r = rows.get(c.id)!;
      const v = c.kind === "income" ? t.s : -t.s;
      r.values[i]! += v;
      r.total_minor += v;
      c = c.parent_id ? byId.get(c.parent_id) : undefined;
    }
  }
  return { months: range, rows: [...rows.values()].filter((r) => r.values.some((v) => v !== 0)).sort((a, b) => b.total_minor - a.total_minor) };
}

/** Number of transactions in a year and how many have no category (Budget explanation). */
export async function transactionYearStats(db: DbAdapter, year: number): Promise<{ count: number; uncategorized: number }> {
  const [r] = await db.select<{ n: number; unc: number | null }>(
    "SELECT count(*) AS n, SUM(category_id IS NULL) AS unc FROM bank_transaction WHERE substr(booking_date, 1, 4) = ?",
    [String(year)],
  );
  return { count: r?.n ?? 0, uncategorized: r?.unc ?? 0 };
}

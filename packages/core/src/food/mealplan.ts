/** Weekly meal plan: entries, move, copy, estimated price, budget and warnings (spec 04 "Uge"). */
import type { DbAdapter } from "../db/adapter";
import type { Row } from "../domain/registry";
import { MEALS, type Meal } from "../domain/schemas";
import { addDays, daysInMonth, parseYmd } from "../recurrence/dates";
import { createEntity, deleteRow, mustGet, updateEntity, ValidationError, withDb, type Ctx } from "../repo/entities";
import { getSetting } from "../repo/settings";
import { householdAllergies, recipeAllergens, warningsFor, type AllergyWarning } from "./allergens";

// ---------- ISO weeks ----------

/** Monday of the ISO week containing the date. */
export function weekStart(date: string): string {
  const { y, m, d } = parseYmd(date);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(date, -dow);
}

/** ISO 8601 week number and week-year. */
export function isoWeek(date: string): { year: number; week: number } {
  const thursday = addDays(weekStart(date), 3);
  const { y } = parseYmd(thursday);
  const jan4 = `${y}-01-04`;
  const week = Math.round(daysBetween(weekStart(jan4), weekStart(date)) / 7) + 1;
  return { year: y, week };
}

function daysBetween(a: string, b: string): number {
  const pa = parseYmd(a);
  const pb = parseYmd(b);
  return (Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000;
}

export const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

// ---------- Settings ----------

export async function foodSettings(db: DbAdapter): Promise<{ meals: Meal[]; defaultServings: number }> {
  const meals = (await getSetting<string[]>(db, "food.meals")) ?? ["dinner"];
  const defaultServings = (await getSetting<number>(db, "food.default_servings")) ?? 4;
  const valid = MEALS.filter((m) => meals.includes(m));
  return { meals: valid.length ? valid : ["dinner"], defaultServings };
}

// ---------- Entries ----------

export interface PlanInput {
  plan_date: string;
  meal?: Meal;
  recipe_id?: string | null;
  title?: string | null;
  servings?: number | null;
  note?: string | null;
}

function requireRecipeOrTitle(input: { recipe_id?: string | null; title?: string | null }) {
  if (!input.recipe_id && !input.title?.trim()) {
    throw new ValidationError([{ path: "title", message: "Vælg en opskrift eller skriv en titel" }], "meal_plan_entry");
  }
}

/** Plans a dish (recipe) or a free title on a day. Servings default to food.default_servings. */
export async function planMeal(ctx: Ctx, input: PlanInput): Promise<Row> {
  requireRecipeOrTitle(input);
  const servings = input.servings === undefined ? (await foodSettings(ctx.db)).defaultServings : input.servings;
  if (input.recipe_id) await mustGet(ctx.db, "recipe", input.recipe_id);
  return createEntity(ctx, "meal_plan_entry", {
    plan_date: input.plan_date,
    meal: input.meal ?? "dinner",
    recipe_id: input.recipe_id ?? null,
    title: input.title?.trim() || null,
    servings,
    note: input.note ?? null,
  });
}

export async function updateMeal(ctx: Ctx, id: string, changes: Partial<PlanInput>): Promise<Row> {
  const before = await mustGet(ctx.db, "meal_plan_entry", id);
  requireRecipeOrTitle({
    recipe_id: "recipe_id" in changes ? changes.recipe_id : (before.recipe_id as string | null),
    title: "title" in changes ? changes.title : (before.title as string | null),
  });
  return updateEntity(ctx, "meal_plan_entry", id, changes);
}

/** Moves a dish to another day (and optionally another meal). */
export const moveMeal = (ctx: Ctx, id: string, toDate: string, meal?: Meal) =>
  updateEntity(ctx, "meal_plan_entry", id, meal ? { plan_date: toDate, meal } : { plan_date: toDate });

export const removeMeal = (ctx: Ctx, id: string) => deleteRow(ctx, "meal_plan_entry", id);

export async function entriesBetween(db: DbAdapter, from: string, to: string): Promise<Row[]> {
  return db.select<Row>(
    `SELECT e.*, r.name AS recipe_name, r.servings AS recipe_servings, r.estimated_cost_minor, r.allergens_json
       FROM meal_plan_entry e LEFT JOIN recipe r ON r.id = e.recipe_id
      WHERE e.plan_date BETWEEN ? AND ?
      ORDER BY e.plan_date, CASE e.meal WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 WHEN 'dinner' THEN 2 ELSE 3 END, e.created_at`,
    [from, to],
  );
}

/**
 * "Kopiér sidste uge": copies every entry of the previous week 7 days forward.
 * Entries that already exist on the target day (same meal and dish) are not duplicated.
 */
export async function copyLastWeek(ctx: Ctx, monday: string): Promise<number> {
  const prev = addDays(monday, -7);
  return ctx.db.transaction(async (tx) => {
    const c = withDb(ctx, tx);
    const source = await entriesBetween(tx, prev, addDays(prev, 6));
    const existing = await entriesBetween(tx, monday, addDays(monday, 6));
    const key = (e: Row, date: string) => `${date}|${e.meal}|${e.recipe_id ?? ""}|${e.title ?? ""}`;
    const have = new Set(existing.map((e) => key(e, String(e.plan_date))));
    let n = 0;
    for (const e of source) {
      const date = addDays(String(e.plan_date), 7);
      if (have.has(key(e, date))) continue;
      await createEntity(c, "meal_plan_entry", {
        plan_date: date,
        meal: e.meal as Meal,
        recipe_id: (e.recipe_id as string | null) ?? null,
        title: (e.title as string | null) ?? null,
        servings: (e.servings as number | null) ?? null,
        note: (e.note as string | null) ?? null,
      });
      n++;
    }
    return n;
  });
}

// ---------- Price and budget ----------

/** Servings for an entry: the entry's own number, otherwise the recipe's. */
export const entryServings = (e: Row) => Number(e.servings ?? e.recipe_servings ?? 0) || null;

/** Estimated price of one planned dish: estimated_cost_minor × portions / servings. */
export function entryCost(e: Row): number | null {
  if (!e.recipe_id || e.estimated_cost_minor === null || e.estimated_cost_minor === undefined) return null;
  const portions = entryServings(e) ?? Number(e.recipe_servings);
  return Math.round((Number(e.estimated_cost_minor) * portions) / Number(e.recipe_servings));
}

export interface WeekCost {
  total_minor: number;
  priced: number;
  /** Planned recipes without a price. Free titles ("Rester") are not counted. */
  without_price: number;
}

export function weekCost(entries: Row[]): WeekCost {
  let total = 0;
  let priced = 0;
  let without = 0;
  for (const e of entries) {
    if (!e.recipe_id) continue;
    const c = entryCost(e);
    if (c === null) without++;
    else {
      total += c;
      priced++;
    }
  }
  return { total_minor: total, priced, without_price: without };
}

export const FOOD_CATEGORY = "Mad og dagligvarer";

/** Ids of "Mad og dagligvarer" and all its subcategories. */
export async function foodCategoryIds(db: DbAdapter): Promise<string[]> {
  const cats = await db.select<{ id: string; parent_id: string | null; name: string }>("SELECT id, parent_id, name FROM category");
  const ids = new Set(cats.filter((c) => c.name === FOOD_CATEGORY && !c.parent_id).map((c) => c.id));
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

export interface WeekBudget {
  /** Monthly budget / days in month × 7 (per day, so a week across two months is exact). */
  budget_minor: number;
  /** Actual spending in the week from transactions in the same categories (positive = spent). */
  actual_minor: number;
  has_budget: boolean;
}

export async function weekBudget(db: DbAdapter, monday: string): Promise<WeekBudget> {
  const ids = await foodCategoryIds(db);
  if (ids.length === 0) return { budget_minor: 0, actual_minor: 0, has_budget: false };
  const marks = ids.map(() => "?").join(",");
  let budget = 0;
  let hasBudget = false;
  const monthCache = new Map<string, number>();
  for (const day of weekDays(monday)) {
    const { y, m } = parseYmd(day);
    const k = `${y}-${m}`;
    if (!monthCache.has(k)) {
      const r = await db.select<{ s: number | null; n: number }>(
        `SELECT SUM(l.amount_minor) AS s, count(*) AS n FROM budget_line l JOIN budget b ON b.id = l.budget_id
          WHERE b.year = ? AND (l.month IS NULL OR l.month = ?) AND l.category_id IN (${marks})`,
        [y, m, ...ids],
      );
      if ((r[0]?.n ?? 0) > 0) hasBudget = true;
      monthCache.set(k, r[0]?.s ?? 0);
    }
    budget += monthCache.get(k)! / daysInMonth(y, m);
  }
  const tx = await db.select<{ s: number | null }>(
    `SELECT SUM(amount_minor) AS s FROM bank_transaction WHERE booking_date BETWEEN ? AND ? AND category_id IN (${marks})`,
    [monday, addDays(monday, 6), ...ids],
  );
  return { budget_minor: Math.round(budget), actual_minor: -(tx[0]?.s ?? 0), has_budget: hasBudget };
}

// ---------- Week view ----------

export interface PlannedDish extends Row {
  id: string;
  plan_date: string;
  meal: Meal;
  label: string;
  cost_minor: number | null;
  allergens: string[];
  warnings: AllergyWarning[];
}

export interface WeekPlan {
  monday: string;
  week: number;
  year: number;
  days: string[];
  meals: Meal[];
  entries: PlannedDish[];
  cost: WeekCost;
  budget: WeekBudget;
}

/** Dishes with allergens (marked + derived) and warnings for the viewing user. */
export async function decorateEntries(db: DbAdapter, entries: Row[], userId: string | null): Promise<PlannedDish[]> {
  const household = await householdAllergies(db, userId);
  const ids = [...new Set(entries.map((e) => e.recipe_id).filter(Boolean))] as string[];
  const names = new Map<string, string[]>();
  if (ids.length) {
    const rows = await db.select<{ recipe_id: string; name: string }>(
      `SELECT recipe_id, name FROM recipe_ingredient WHERE recipe_id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    for (const r of rows) names.set(r.recipe_id, [...(names.get(r.recipe_id) ?? []), r.name]);
  }
  return entries.map((e) => {
    const al = e.recipe_id ? recipeAllergens(e.allergens_json, names.get(String(e.recipe_id)) ?? []).all : [];
    return {
      ...e,
      id: String(e.id),
      plan_date: String(e.plan_date),
      meal: e.meal as Meal,
      label: String(e.recipe_name ?? e.title ?? ""),
      cost_minor: entryCost(e),
      allergens: al,
      warnings: warningsFor(al, household),
    };
  });
}

export async function weekPlan(db: DbAdapter, date: string, userId: string | null): Promise<WeekPlan> {
  const monday = weekStart(date);
  const { year, week } = isoWeek(monday);
  const raw = await entriesBetween(db, monday, addDays(monday, 6));
  const { meals } = await foodSettings(db);
  // Entries in meals that are switched off are still shown.
  const used = new Set([...meals, ...raw.map((e) => e.meal as Meal)]);
  return {
    monday,
    week,
    year,
    days: weekDays(monday),
    meals: MEALS.filter((m) => used.has(m)),
    entries: await decorateEntries(db, raw, userId),
    cost: weekCost(raw),
    budget: await weekBudget(db, monday),
  };
}

/** Today's and tomorrow's dishes for the dashboard; null when the current week has no dishes. */
export async function mealsTodayTomorrow(
  db: DbAdapter,
  today: string,
  userId: string | null,
): Promise<{ today: PlannedDish[]; tomorrow: PlannedDish[] } | null> {
  const monday = weekStart(today);
  const week = await entriesBetween(db, monday, addDays(monday, 6));
  if (week.length === 0) return null;
  const tomorrow = addDays(today, 1);
  const rows = await decorateEntries(db, await entriesBetween(db, today, tomorrow), userId);
  return { today: rows.filter((r) => r.plan_date === today), tomorrow: rows.filter((r) => r.plan_date === tomorrow) };
}

export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: "Morgenmad",
  lunch: "Frokost",
  dinner: "Aftensmad",
  snack: "Mellemmåltid",
};

/** Shopping list generated from the meal plan (spec 04 "Indkøbsliste"). */
import type { DbAdapter } from "../db/adapter";
import type { Row } from "../domain/registry";
import { addDays } from "../recurrence/dates";
import { createEntity, deleteRow, mustGet, updateEntity, withDb, type Ctx } from "../repo/entities";
import { formatAmount, normalizeName } from "./ingredients";
import { entriesBetween, entryServings, isoWeek, weekStart } from "./mealplan";

/** Store sections in display order (spec 04). */
export const SHOP_CATEGORIES = ["Frugt og grønt", "Kød og fisk", "Mejeri", "Brød", "Kolonial", "Frost", "Andet"] as const;
export type ShopCategory = (typeof SHOP_CATEGORIES)[number];

/** Simple keyword list for guessing the section from the item name. First match wins. */
const SECTION_KEYWORDS: [ShopCategory, string[]][] = [
  ["Frost", ["frost", "frosne", "frossen", "is ", "frysepizza"]],
  ["Brød", ["brød", "bolle", "rundstykke", "toast", "pita", "tortilla", "flute", "baguette", "knækbrød"]],
  ["Mejeri", ["mælk", "fløde", "smør", "ost", "yoghurt", "skyr", "creme fraiche", "æg", "kvark", "mascarpone", "parmesan", "mozzarella", "feta"]],
  ["Kød og fisk", ["kød", "okse", "svin", "kylling", "kalkun", "lam", "bacon", "pølse", "skinke", "frikadelle", "fars", "laks", "torsk", "fisk", "rejer", "reje", "tun", "sild", "makrel", "rødspætte", "muslinger", "krabbe", "hummer", "medister", "flæsk", "kotelet"]],
  ["Frugt og grønt", ["løg", "hvidløg", "kartoffel", "kartofler", "gulerod", "gulerødder", "tomat", "agurk", "salat", "kål", "porre", "selleri", "peberfrugt", "chili", "æble", "pære", "banan", "citron", "lime", "appelsin", "bær", "spinat", "broccoli", "blomkål", "squash", "aubergine", "champignon", "svampe", "persille", "dild", "purløg", "basilikum", "ingefær", "avocado", "majs", "ærter", "bønner", "rødbede", "pastinak", "frugt", "grønt", "krydderurter"]],
  ["Kolonial", ["mel", "sukker", "salt", "pasta", "ris", "gryn", "havre", "olie", "eddike", "dåse", "hakkede tomater", "tomatpuré", "bouillon", "krydderi", "karry", "paprika", "kanel", "spaghetti", "nudler", "couscous", "bulgur", "linser", "kikærter", "sennep", "ketchup", "mayonnaise", "soja", "honning", "sirup", "kakao", "kaffe", "te", "rasp", "bagepulver", "gær", "vanilje", "nødder", "mandler"]],
];

export function guessCategory(name: string): ShopCategory {
  const n = ` ${normalizeName(name)} `;
  // Dry goods whose names contain a fresh-produce word: "hakkede tomater" (canned) before
  // "tomat", "grøntsagsbouillon" before "grønt".
  if (["hakkede tomater", "flåede tomater", "bouillon", "fond", "tomatpuré"].some((w) => n.includes(w))) return "Kolonial";
  for (const [cat, words] of SECTION_KEYWORDS) if (words.some((w) => n.includes(w))) return cat;
  return "Andet";
}

/** Units that are summed in a base unit (spec 04): g/kg in g, ml/dl/l in ml. */
const BASE: Record<string, { base: string; factor: number }> = {
  g: { base: "g", factor: 1 },
  kg: { base: "g", factor: 1000 },
  ml: { base: "ml", factor: 1 },
  dl: { base: "ml", factor: 100 },
  l: { base: "ml", factor: 1000 },
};

/**
 * Items without an amount are stored with amount = number of dishes and the pseudo-unit
 * "retter", so "salt (3 retter)" keeps name and unit stable between regenerations.
 */
export const DISH_COUNT_UNIT = "retter";

export interface ListLine {
  name: string;
  amount: number | null;
  unit: string | null;
}

/** Display text: g ≥ 1000 as kg, ml ≥ 1000 as l, dish counts as "(3 retter)". */
export function formatShoppingItem(i: ListLine): string {
  if (i.unit === DISH_COUNT_UNIT) return `${i.name} (${i.amount ?? 1} ${i.amount === 1 ? "ret" : "retter"})`;
  if (i.amount === null || i.amount === undefined) return i.name;
  let { amount, unit } = i as { amount: number; unit: string | null };
  if (unit === "g" && amount >= 1000) [amount, unit] = [amount / 1000, "kg"];
  else if (unit === "ml" && amount >= 1000) [amount, unit] = [amount / 1000, "l"];
  return `${formatAmount(amount)}${unit && unit !== "stk" ? ` ${unit}` : ""} ${i.name}`;
}

/** Aggregates the week's ingredients: scaled by portions / servings and summed per name and unit. */
export async function aggregateWeek(db: DbAdapter, monday: string): Promise<ListLine[]> {
  const entries = (await entriesBetween(db, monday, addDays(monday, 6))).filter((e) => e.recipe_id);
  const sums = new Map<string, ListLine>();
  const dishes = new Map<string, Set<string>>();
  for (const e of entries) {
    const ings = await db.select<{ amount: number | null; unit: string | null; name: string }>(
      "SELECT amount, unit, name FROM recipe_ingredient WHERE recipe_id = ? ORDER BY position",
      [String(e.recipe_id)],
    );
    const factor = (entryServings(e) ?? Number(e.recipe_servings)) / Number(e.recipe_servings);
    for (const i of ings) {
      const name = normalizeName(i.name);
      if (i.amount === null) {
        const k = `${name}|`;
        dishes.set(k, (dishes.get(k) ?? new Set()).add(String(e.id)));
        continue;
      }
      const b = i.unit ? BASE[i.unit] : undefined;
      const unit = b ? b.base : i.unit;
      const amount = i.amount * factor * (b ? b.factor : 1);
      const k = `${name}|${unit ?? ""}`;
      const cur = sums.get(k);
      sums.set(k, { name, unit, amount: (cur?.amount ?? 0) + amount });
    }
  }
  const lines = [...sums.values()].map((l) => ({ ...l, amount: Math.round((l.amount ?? 0) * 100) / 100 }));
  for (const [k, set] of dishes) lines.push({ name: k.slice(0, -1), amount: set.size, unit: DISH_COUNT_UNIT });
  return lines.sort((a, b) => a.name.localeCompare(b.name, "da"));
}

export async function listForWeek(db: DbAdapter, monday: string): Promise<Row | null> {
  const r = await db.select<Row>(
    "SELECT * FROM shopping_list WHERE week_start = ? AND archived_at IS NULL ORDER BY created_at LIMIT 1",
    [monday],
  );
  return r[0] ?? null;
}

export async function shoppingItems(db: DbAdapter, listId: string): Promise<Row[]> {
  return db.select<Row>("SELECT * FROM shopping_item WHERE list_id = ? ORDER BY position", [listId]);
}

/**
 * "Lav indkøbsliste for ugen": creates or updates the week's list. Generated items
 * (source = 'plan') are replaced; manual items are kept. Checked state and a section the
 * user chose are kept for items with the same name and unit.
 */
export async function generateShoppingList(ctx: Ctx, date: string): Promise<{ list: Row; items: Row[] }> {
  const monday = weekStart(date);
  const lines = await aggregateWeek(ctx.db, monday);
  return ctx.db.transaction(async (tx) => {
    const c = withDb(ctx, tx);
    let list = await listForWeek(tx, monday);
    if (!list) {
      const { week } = isoWeek(monday);
      list = await createEntity(c, "shopping_list", { name: `Indkøb uge ${week}`, week_start: monday });
    }
    const listId = String(list.id);
    const old = await shoppingItems(tx, listId);
    const key = (r: { name?: unknown; unit?: unknown }) => `${normalizeName(String(r.name))}|${r.unit ?? ""}`;
    const previous = new Map(old.filter((o) => o.source === "plan").map((o) => [key(o), o]));
    for (const o of old) if (o.source === "plan") await deleteRow(c, "shopping_item", String(o.id));
    let position = Math.max(-1, ...old.filter((o) => o.source !== "plan").map((o) => Number(o.position))) + 1;
    for (const l of lines) {
      const prev = previous.get(key(l));
      await createEntity(c, "shopping_item", {
        list_id: listId,
        position: position++,
        name: l.name,
        amount: l.amount,
        unit: l.unit,
        category: (prev?.category as string | undefined) ?? guessCategory(l.name),
        checked: prev?.checked === 1 ? 1 : 0,
        source: "plan",
      });
    }
    return { list, items: await shoppingItems(tx, listId) };
  });
}

export async function addShoppingItem(
  ctx: Ctx,
  listId: string,
  input: { name: string; amount?: number | null; unit?: string | null; category?: string | null },
): Promise<Row> {
  await mustGet(ctx.db, "shopping_list", listId);
  const r = await ctx.db.select<{ p: number | null }>("SELECT max(position) AS p FROM shopping_item WHERE list_id = ?", [listId]);
  return createEntity(ctx, "shopping_item", {
    list_id: listId,
    position: (r[0]?.p ?? -1) + 1,
    name: normalizeName(input.name),
    amount: input.amount ?? null,
    unit: input.unit ?? null,
    category: input.category ?? guessCategory(input.name),
    source: "manual",
  });
}

export const setItemChecked = (ctx: Ctx, id: string, checked: boolean) =>
  updateEntity(ctx, "shopping_item", id, { checked: checked ? 1 : 0 });
export const setItemCategory = (ctx: Ctx, id: string, category: string) => updateEntity(ctx, "shopping_item", id, { category });
export const removeShoppingItem = (ctx: Ctx, id: string) => deleteRow(ctx, "shopping_item", id);

/** Items grouped by section in the fixed order; unknown sections go last. */
export function groupBySection<T extends Row>(items: T[]): { category: string; items: T[] }[] {
  const order = (c: string) => {
    const i = (SHOP_CATEGORIES as readonly string[]).indexOf(c);
    return i < 0 ? SHOP_CATEGORIES.length : i;
  };
  const groups = new Map<string, T[]>();
  for (const i of items) {
    const c = String(i.category ?? "Andet");
    groups.set(c, [...(groups.get(c) ?? []), i]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b, "da"))
    .map(([category, list]) => ({ category, items: list.sort((x, y) => String(x.name).localeCompare(String(y.name), "da")) }));
}

/** "Kopiér som tekst": one item per line, grouped by section. Checked items are left out by default. */
export function shoppingListText(items: Row[], opts: { includeChecked?: boolean } = {}): string {
  const rows = items.filter((i) => opts.includeChecked || !i.checked);
  return groupBySection(rows)
    .flatMap((g) => g.items.map((i) => formatShoppingItem({ name: String(i.name), amount: i.amount as number | null, unit: i.unit as string | null })))
    .join("\n");
}

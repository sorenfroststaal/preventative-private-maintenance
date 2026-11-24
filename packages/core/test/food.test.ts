import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addShoppingItem,
  addStarterCatalog,
  aggregateWeek,
  allergensInText,
  allergyKeys,
  copyLastWeek,
  createEntity,
  createRecipe,
  dashboard,
  dismissStarterCatalog,
  exportOpenPlanner,
  formatIngredient,
  formatShoppingItem,
  generateShoppingList,
  getSchemaVersion,
  getSetting,
  groupBySection,
  guessCategory,
  importOpenPlanner,
  ingredientLines,
  listDocuments,
  isoWeek,
  listRecipes,
  migrate,
  monthlySpending,
  moveMeal,
  parseIngredientLine,
  parseIngredients,
  parseOpenPlanner,
  planMeal,
  PRIVATE_ALLERGY_TEXT,
  previewOpenPlanner,
  removeShoppingItem,
  search,
  setItemCategory,
  setItemChecked,
  shoppingItems,
  shoppingListText,
  shouldOfferCatalog,
  slugify,
  STARTER_CATALOG,
  updateRecipe,
  ValidationError,
  weekBudget,
  weekPlan,
  weekStart,
} from "../src";
import { migrations } from "../src/db/migrations.generated";
import type { DbAdapter } from "../src/db/adapter";
import { ctxFor, newArchive, tempDir, testEnv } from "./helpers";

const repoRoot = join(__dirname, "..", "..", "..");
const fixture = (name: string) => readFileSync(join(repoRoot, "fixtures/open-planner", name), "utf8");

async function auditFor(db: DbAdapter, type: string) {
  return db.select<{ action: string; entity_id: string }>("SELECT action, entity_id FROM audit_log WHERE entity_type = ? ORDER BY rowid", [type]);
}

describe("phase 2b.1 – migration 0002", () => {
  it("is identical to docs/spec/schema-0002.sql", () => {
    const spec = readFileSync(join(repoRoot, "docs/spec/schema-0002.sql"), "utf8");
    expect(readFileSync(join(repoRoot, "packages/core/migrations/0002_meal_plan.sql"), "utf8")).toBe(spec);
    expect(migrations.find((m) => m.version === 2)?.sql).toBe(spec);
  });

  it("upgrades an archive on schemaVersion 1 to 2 and sets ai.modules.food", async () => {
    const env = testEnv();
    const db = await env.openDb(join(tempDir(), "v1.sqlite"));
    await migrate(db, () => env.clock.nowIso(), migrations.filter((m) => m.version === 1));
    expect(await getSchemaVersion(db)).toBe(1);
    // A v1 archive has ai.modules without food (spec 03 before PR #3).
    await db.execute("INSERT INTO setting (key, value_json) VALUES ('ai.modules', ?)", [
      JSON.stringify({ home: true, health: false, documents: true }),
    ]);
    const r = await migrate(db, () => env.clock.nowIso());
    expect(r).toMatchObject({ from: 1, to: 2, applied: [2] });
    expect(await getSetting<Record<string, boolean>>(db, "ai.modules")).toEqual({ home: true, health: false, documents: true, food: true });
    const tables = (await db.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(["recipe", "recipe_ingredient", "meal_plan_entry", "shopping_list", "shopping_item"]));
    // Running again changes nothing.
    expect((await migrate(db, () => env.clock.nowIso())).applied).toEqual([]);
    await db.close();
  });

  it("new archives get food settings", async () => {
    const { archive } = await newArchive();
    expect((await getSetting<Record<string, boolean>>(archive.db, "ai.modules"))?.food).toBe(true);
    expect(await getSetting(archive.db, "food.meals")).toEqual(["dinner"]);
    expect(await getSetting(archive.db, "food.default_servings")).toBe(4);
  });
});

describe("phase 2b.3 – ingredient parser (all examples in spec 05)", () => {
  const cases: [string, number | null, string | null, string, string | null][] = [
    ["500 g hakket oksekød", 500, "g", "hakket oksekød", null],
    ["2 dl fløde", 2, "dl", "fløde", null],
    ["1,5 kg kartofler, skrællede", 1.5, "kg", "kartofler", "skrællede"],
    ["½ tsk salt", 0.5, "tsk", "salt", null],
    ["2 løg", 2, "stk", "løg", null],
    ["2-3 fed hvidløg", 3, "fed", "hvidløg", null],
    ["Salt og peber", null, null, "salt og peber", null],
  ];
  it.each(cases)("%s", (line, amount, unit, name, note) => {
    expect(parseIngredientLine(line)).toEqual({ amount, unit, name, note, raw_text: line });
  });

  it("normalises the unit table and other quantity forms", () => {
    const p = (l: string) => parseIngredientLine(l)!;
    expect(p("200 Gram smør")).toMatchObject({ amount: 200, unit: "g", name: "smør" });
    expect(p("1 Kilo mel")).toMatchObject({ unit: "kg" });
    expect(p("1 liter mælk")).toMatchObject({ unit: "l", name: "mælk" });
    expect(p("1 l sødmælk")).toMatchObject({ unit: "l", name: "sødmælk" });
    expect(p("3 stk. æg")).toMatchObject({ amount: 3, unit: "stk", name: "æg" });
    expect(p("1 SPSK. olie")).toMatchObject({ unit: "spsk", name: "olie" });
    expect(p("2 dåser hakkede tomater")).toMatchObject({ amount: 2, unit: "dåse", name: "hakkede tomater" });
    expect(p("1 pakke gær")).toMatchObject({ unit: "pk" });
    expect(p("1 bdt persille")).toMatchObject({ unit: "bundt", name: "persille" });
    expect(p("1/2 citron")).toMatchObject({ amount: 0.5, unit: "stk", name: "citron" });
    expect(p("1½ dl ris")).toMatchObject({ amount: 1.5, unit: "dl" });
    expect(p("500g pasta")).toMatchObject({ amount: 500, unit: "g", name: "pasta" });
    expect(p("2 dl fløde, kan udelades")).toMatchObject({ name: "fløde", note: "kan udelades" });
    expect(p("  Peber, friskkværnet ")).toMatchObject({ amount: null, unit: null, name: "peber", note: "friskkværnet", raw_text: "Peber, friskkværnet" });
    expect(parseIngredientLine("   ")).toBeNull();
    expect(parseIngredients("2 dl grødris\n\n1 l sødmælk\n½ tsk salt")).toHaveLength(3);
  });

  it("formats in short form", () => {
    expect(formatIngredient({ amount: 500, unit: "g", name: "hakket oksekød" })).toBe("500 g hakket oksekød");
    expect(formatIngredient({ amount: 2, unit: "stk", name: "løg" })).toBe("2 løg");
    expect(formatIngredient({ amount: 1.5, unit: "kg", name: "kartofler", note: "skrællede" })).toBe("1,5 kg kartofler, skrællede");
    expect(formatIngredient({ amount: null, unit: null, name: "salt og peber" })).toBe("salt og peber");
  });
});

describe("phase 2b.2 – recipes", () => {
  it("creates, updates and archives with ingredient table, tags, price and allergens", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const r = await createRecipe(
      ctx,
      { name: "Lasagne", servings: 4, prep_minutes: 60, tags_json: JSON.stringify(["pasta", "familie"]), estimated_cost_minor: 12000, allergens_json: JSON.stringify(["celery"]) },
      ["500 g hakket oksekød", "12 lasagneplader", "2 dl fløde"],
    );
    const id = String(r.id);
    expect(await ingredientLines(archive.db, id)).toEqual(["500 g hakket oksekød", "12 lasagneplader", "2 dl fløde"]);

    const [summary] = await listRecipes(archive.db);
    expect(summary).toMatchObject({ name: "Lasagne", tags: ["pasta", "familie"], ingredient_count: 3 });
    // Marked: celery; derived: milk (fløde).
    expect(summary!.allergens).toEqual(["milk", "celery"]);
    expect(summary!.derived_allergens).toEqual(["milk"]);
    expect(await listRecipes(archive.db, { tag: "familie" })).toHaveLength(1);
    expect(await listRecipes(archive.db, { q: "fløde" })).toHaveLength(1);
    expect(await listRecipes(archive.db, { q: "fisk" })).toHaveLength(0);

    // Invalid allergen keys and ingredient amounts are rejected by the shared Zod schema.
    await expect(createRecipe(ctx, { name: "X", allergens_json: '["peanuts"]' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createRecipe(ctx, { name: "X" }, [{ name: "mel", amount: -1 }])).rejects.toBeInstanceOf(ValidationError);
    expect(await listRecipes(archive.db)).toHaveLength(1);
  });

  it("replaces the ingredient list in one transaction with audit, and rolls back on errors", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const r = await createRecipe(ctx, { name: "Suppe" }, ["1 l bouillon", "2 gulerødder"]);
    const id = String(r.id);
    const firstIds = (await archive.db.select<{ id: string }>("SELECT id FROM recipe_ingredient WHERE recipe_id = ?", [id])).map((x) => x.id);

    await updateRecipe(ctx, id, { description: "Varm" }, ["1 l bouillon", "1 porre", "100 g bacon"]);
    expect(await ingredientLines(archive.db, id)).toEqual(["1 l bouillon", "1 porre", "100 g bacon"]);
    const audit = await auditFor(archive.db, "recipe_ingredient");
    expect(audit.filter((a) => a.action === "delete").map((a) => a.entity_id).sort()).toEqual([...firstIds].sort());
    expect(audit.filter((a) => a.action === "create")).toHaveLength(5);

    // A failing replacement leaves both recipe and ingredients untouched.
    await expect(updateRecipe(ctx, id, { name: "" }, ["1 løg"])).rejects.toThrow();
    expect(await ingredientLines(archive.db, id)).toEqual(["1 l bouillon", "1 porre", "100 g bacon"]);

    // Search finds the recipe by ingredient name after the replacement (spec 03 "Søgeindeks").
    expect((await search(archive.db, "porre")).map((h) => h.type)).toContain("recipe");
    expect(await search(archive.db, "gulerødder")).toHaveLength(0);
  });
});

async function household(env: ReturnType<typeof testEnv>, archive: Awaited<ReturnType<typeof newArchive>>["archive"]) {
  const ctx = ctxFor(env, archive);
  const u1 = await createEntity(ctx, "app_user", { name: "Anne" });
  const u2 = await createEntity(ctx, "app_user", { name: "Bo" });
  const ida = await createEntity(ctx, "person", { name: "Ida" });
  const bo = await createEntity(ctx, "person", { name: "Bo", health_private_user_id: String(u2.id) });
  await createEntity(ctx, "health_allergy", { person_id: String(ida.id), substance: "Rejer" });
  await createEntity(ctx, "health_allergy", { person_id: String(bo.id), substance: "Hvedemel (cøliaki)" });
  return { ctx, anne: String(u1.id), boUser: String(u2.id) };
}

describe("phase 2b.5 – allergy warnings", () => {
  it("matches marked and derived allergens against health_allergy, case-insensitive", () => {
    expect(allergensInText("Indbagte REJER")).toEqual(["shellfish"]);
    expect(allergensInText("hvedemel")).toEqual(["gluten"]);
    expect(allergensInText("Crème fraîche 18 %")).toEqual(["milk"]);
    expect(allergyKeys("Æg")).toEqual(["egg"]);
    expect(allergyKeys("SKALDYR")).toEqual(["shellfish"]);
    expect(allergyKeys("Mælkeprotein")).toEqual(["milk"]);
    expect(allergyKeys("Birkepollen")).toEqual([]);
  });

  it("shows person and substance, and masks private health data for other users", async () => {
    const { env, archive } = await newArchive();
    const { ctx, anne, boUser } = await household(env, archive);
    const shrimp = await createRecipe(ctx, { name: "Rejer med ris" }, ["300 g rejer", "250 g ris", "1 dl hvedemel"]);
    const marked = await createRecipe(ctx, { name: "Ris", allergens_json: '["shellfish"]' }, ["250 g ris"]);
    const plain = await createRecipe(ctx, { name: "Kartofler" }, ["1 kg kartofler"]);
    for (const [d, r] of [["2026-11-23", shrimp], ["2026-11-24", marked], ["2026-11-25", plain]] as const) {
      await planMeal(ctx, { plan_date: d, recipe_id: String(r.id) });
    }
    const forAnne = await weekPlan(archive.db, "2026-11-25", anne);
    const w = (d: string) => forAnne.entries.find((e) => e.plan_date === d)!.warnings;
    expect(w("2026-11-23").map((x) => x.text)).toEqual(["Rejer (Ida)", PRIVATE_ALLERGY_TEXT]);
    const priv = w("2026-11-23")[1]!;
    expect(priv).toMatchObject({ person: null, substance: null, key: null, private: true });
    expect(JSON.stringify(priv)).not.toMatch(/Bo|Hvede|gluten/i);
    expect(w("2026-11-24").map((x) => x.text)).toEqual(["Rejer (Ida)"]);
    expect(w("2026-11-25")).toEqual([]);

    // The owner of the private health data sees name and substance.
    const forBo = await weekPlan(archive.db, "2026-11-25", boUser);
    expect(forBo.entries[0]!.warnings.map((x) => x.text)).toEqual(["Hvedemel (cøliaki) (Bo)", "Rejer (Ida)"]);
  });
});

describe("phase 2b.4 – week: dishes, move, copy, price and budget", () => {
  it("uses ISO weeks starting on Monday", () => {
    expect(weekStart("2026-11-24")).toBe("2026-11-23");
    expect(weekStart("2026-11-29")).toBe("2026-11-23");
    expect(isoWeek("2026-11-24")).toEqual({ year: 2026, week: 48 });
    expect(isoWeek("2027-01-01")).toEqual({ year: 2026, week: 53 });
    expect(isoWeek("2027-01-04")).toEqual({ year: 2027, week: 1 });
    expect(isoWeek("2025-12-29")).toEqual({ year: 2026, week: 1 });
  });

  it("plans recipes and free titles, moves, copies last week and computes price", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const a = await createRecipe(ctx, { name: "A", servings: 4, estimated_cost_minor: 10000 });
    const b = await createRecipe(ctx, { name: "B", servings: 2, estimated_cost_minor: 5000 });
    const c = await createRecipe(ctx, { name: "C uden pris" });
    const ea = await planMeal(ctx, { plan_date: "2026-11-16", recipe_id: String(a.id) }); // default 4 servings
    await planMeal(ctx, { plan_date: "2026-11-17", recipe_id: String(b.id), servings: 3 });
    await planMeal(ctx, { plan_date: "2026-11-18", recipe_id: String(c.id) });
    await planMeal(ctx, { plan_date: "2026-11-19", title: "Rester" });
    await expect(planMeal(ctx, { plan_date: "2026-11-19", title: "  " })).rejects.toBeInstanceOf(ValidationError);

    const w = await weekPlan(archive.db, "2026-11-20", null);
    expect(w).toMatchObject({ monday: "2026-11-16", week: 47, meals: ["dinner"] });
    // 10000 × 4/4 + 5000 × 3/2 = 17500; C has no price; "Rester" is not counted.
    expect(w.cost).toEqual({ total_minor: 17500, priced: 2, without_price: 1 });
    expect(w.entries.map((e) => e.label)).toEqual(["A", "B", "C uden pris", "Rester"]);

    await moveMeal(ctx, String(ea.id), "2026-11-22");
    expect((await weekPlan(archive.db, "2026-11-16", null)).entries.at(-1)).toMatchObject({ label: "A", plan_date: "2026-11-22" });

    expect(await copyLastWeek(ctx, "2026-11-23")).toBe(4);
    const next = await weekPlan(archive.db, "2026-11-23", null);
    expect(next.entries.map((e) => [e.plan_date, e.label, e.servings])).toEqual([
      ["2026-11-24", "B", 3],
      ["2026-11-25", "C uden pris", 4],
      ["2026-11-26", "Rester", 4],
      ["2026-11-29", "A", 4],
    ]);
    // Copying again does not duplicate.
    expect(await copyLastWeek(ctx, "2026-11-23")).toBe(0);
  });

  it("budget for the week = monthly budget for 'Mad og dagligvarer' incl. subcategories / days × 7, and actual spending", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const food = (await archive.db.select<{ id: string }>("SELECT id FROM category WHERE name = 'Mad og dagligvarer'"))[0]!.id;
    const sub = await createEntity(ctx, "category", { name: "Slik", parent_id: food, kind: "expense" });
    const other = (await archive.db.select<{ id: string }>("SELECT id FROM category WHERE name = 'Fritid'"))[0]!.id;
    const budget = await createEntity(ctx, "budget", { year: 2026, name: "Husstand" });
    await createEntity(ctx, "budget_line", { budget_id: String(budget.id), category_id: food, amount_minor: 600000 });
    await createEntity(ctx, "budget_line", { budget_id: String(budget.id), category_id: String(sub.id), month: 11, amount_minor: 30000 });
    await createEntity(ctx, "budget_line", { budget_id: String(budget.id), category_id: other, amount_minor: 99999 });
    const acc = await createEntity(ctx, "account", { name: "Løn" });
    const tx = (date: string, amount: number, cat: string, n: number) =>
      createEntity(ctx, "bank_transaction", { account_id: String(acc.id), booking_date: date, text: "Netto", amount_minor: amount, category_id: cat, dedupe_hash: `h${n}` });
    await tx("2026-11-16", -45000, food, 1);
    await tx("2026-11-20", -5000, String(sub.id), 2);
    await tx("2026-11-21", -99900, other, 3);
    await tx("2026-11-23", -1000, food, 4); // next week

    // November: (6000 + 300) kr / 30 days × 7 = 1470 kr.
    expect(await weekBudget(archive.db, "2026-11-16")).toEqual({ budget_minor: 147000, actual_minor: 50000, has_budget: true });
    // Week 49 spans Nov 30 – Dec 6: 1 day of November (6300/30) + 6 days of December (6000/31).
    expect((await weekBudget(archive.db, "2026-11-30")).budget_minor).toBe(Math.round(630000 / 30 + (600000 / 31) * 6));
  });
});

describe("phase 2b.6 – shopping list", () => {
  async function setup() {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const a = await createRecipe(ctx, { name: "Kødsovs", servings: 4 }, ["500 g hakket oksekød", "2 løg", "1 dl fløde", "Salt og peber"]);
    const b = await createRecipe(ctx, { name: "Gryde", servings: 2 }, ["0,75 kg hakket oksekød", "2 dl fløde", "0,5 l mælk", "salt og peber", "1 dåse tomater"]);
    await planMeal(ctx, { plan_date: "2026-11-23", recipe_id: String(a.id), servings: 2 }); // factor 0.5
    await planMeal(ctx, { plan_date: "2026-11-24", recipe_id: String(b.id), servings: 4 }); // factor 2
    return { env, archive, ctx, a, b };
  }

  it("scales, sums g/kg and ml/dl/l, and counts items without amount", async () => {
    const { archive } = await setup();
    const lines = await aggregateWeek(archive.db, "2026-11-23");
    const text = lines.map(formatShoppingItem);
    // 250 g + 1500 g = 1750 g → 1,75 kg; 0,5 dl + 4 dl = 450 ml fløde; 1 l mælk; salt (2 retter).
    expect(text).toEqual(["450 ml fløde", "1,75 kg hakket oksekød", "1 løg", "1 l mælk", "salt og peber (2 retter)", "2 dåse tomater"]);
    expect(lines.find((l) => l.name === "hakket oksekød")).toMatchObject({ amount: 1750, unit: "g" });
  });

  it("regenerates plan items, keeps manual items, checks and chosen sections; groups and copies as text", async () => {
    const { archive, ctx, a } = await setup();
    const { list, items } = await generateShoppingList(ctx, "2026-11-25");
    expect(list).toMatchObject({ week_start: "2026-11-23", name: "Indkøb uge 48" });
    expect(items).toHaveLength(6);
    const meat = items.find((i) => i.name === "hakket oksekød")!;
    expect(meat.category).toBe("Kød og fisk");
    await setItemChecked(ctx, String(meat.id), true);
    const salt = items.find((i) => i.name === "salt og peber")!;
    await setItemCategory(ctx, String(salt.id), "Kolonial");
    const toilet = await addShoppingItem(ctx, String(list.id), { name: "Toiletpapir" });
    const milk = await addShoppingItem(ctx, String(list.id), { name: "Havremælk", amount: 1, unit: "l" });
    await setItemChecked(ctx, String(milk.id), true);

    // The plan changes: one more Kødsovs.
    await planMeal(ctx, { plan_date: "2026-11-26", recipe_id: String(a.id), servings: 4 });
    const again = await generateShoppingList(ctx, "2026-11-23");
    expect(again.list.id).toBe(list.id);
    const get = (n: string) => again.items.find((i) => i.name === n)!;
    expect(get("hakket oksekød")).toMatchObject({ amount: 2250, checked: 1, source: "plan" });
    expect(get("salt og peber")).toMatchObject({ amount: 3, unit: "retter", category: "Kolonial" });
    expect(get("toiletpapir")).toMatchObject({ source: "manual", id: toilet.id, category: "Andet" });
    expect(get("havremælk")).toMatchObject({ checked: 1, source: "manual" });
    expect(again.items.filter((i) => i.source === "plan")).toHaveLength(6);

    const groups = groupBySection(again.items).map((g) => g.category);
    expect(groups).toEqual(["Frugt og grønt", "Kød og fisk", "Mejeri", "Kolonial", "Andet"]);
    expect(shoppingListText(again.items)).toBe(
      // 50 + 400 + 100 ml fløde; fresh "tomater" go to Frugt og grønt.
      ["3 løg", "2 dåse tomater", "550 ml fløde", "1 l mælk", "salt og peber (3 retter)", "toiletpapir"].join("\n"),
    );
    expect(shoppingListText(again.items, { includeChecked: true }).split("\n")).toHaveLength(8);

    await removeShoppingItem(ctx, String(toilet.id));
    expect((await shoppingItems(archive.db, String(list.id))).some((i) => i.id === toilet.id)).toBe(false);
    expect((await auditFor(archive.db, "shopping_item")).some((x) => x.action === "delete" && x.entity_id === toilet.id)).toBe(true);
  });

  it("guesses store sections", () => {
    expect(guessCategory("Gulerødder")).toBe("Frugt og grønt");
    expect(guessCategory("kyllingebryst")).toBe("Kød og fisk");
    expect(guessCategory("sødmælk")).toBe("Mejeri");
    expect(guessCategory("rugbrød")).toBe("Brød");
    expect(guessCategory("hakkede tomater")).toBe("Kolonial");
    expect(guessCategory("grøntsagsbouillon")).toBe("Kolonial");
    expect(guessCategory("frosne ærter")).toBe("Frost");
    expect(guessCategory("opvaskemiddel")).toBe("Andet");
  });
});

describe("phase 2b.7 – Open Planner", () => {
  it("imports version 1: lists and text ingredients, empty dish, relative image ignored with a message", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const data = parseOpenPlanner(fixture("v1.json"));
    const preview = await previewOpenPlanner(archive.db, data);
    expect(preview.counts).toEqual({ new: 3, changed: 0, unchanged: 0 });
    expect(preview.messages).toEqual(['Billedet til "Pasta med kødsovs" ligger ikke i filen og importeres ikke.']);
    const res = await importOpenPlanner(env, archive, ctx, data);
    expect(res).toMatchObject({ created: 3, updated: 0, photos: 0 });
    const recipes = await archive.db.select<{ id: string; name: string; source: string; source_ref: string; instructions: string | null; photo_document_id: string | null }>(
      "SELECT * FROM recipe ORDER BY name",
    );
    expect(recipes.map((r) => [r.name, r.source, r.source_ref])).toEqual([
      ["Pasta med kødsovs", "import", "open-planner:pasta-med-kodsovs"],
      ["Risengrød", "import", "open-planner:risengrod"],
      ["Tomatsuppe", "import", "open-planner:tomatsuppe"],
    ]);
    expect(recipes[0]!.photo_document_id).toBeNull();
    expect(recipes[1]!.instructions).toBe("Kog langsomt i 45 minutter. (syntetisk)");
    expect(await ingredientLines(archive.db, recipes[1]!.id)).toEqual(["2 dl grødris", "1 l sødmælk", "0,5 tsk salt"]);
    expect(await ingredientLines(archive.db, recipes[0]!.id)).toContain("3 fed hvidløg");
    expect(recipes[2]!.instructions).toBeNull();
    // Importing the same file again: everything unchanged.
    expect((await previewOpenPlanner(archive.db, data)).counts).toEqual({ new: 0, changed: 0, unchanged: 3 });
  });

  it("imports version 2 on top: embedded photo, update via source_ref, changed ones can be deselected", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    await importOpenPlanner(env, archive, ctx, parseOpenPlanner(fixture("v1.json")));
    const v2 = parseOpenPlanner(fixture("v2.json"));
    const preview = await previewOpenPlanner(archive.db, v2);
    expect(preview.counts).toEqual({ new: 1, changed: 1, unchanged: 0 });
    expect(preview.dishes.find((d) => d.id === "pasta-med-kodsovs")!.changes).toEqual(["instructions", "ingredients", "photo"]);

    // Deselecting the changed dish leaves it as it was.
    const skipped = await importOpenPlanner(env, archive, ctx, v2, { skip: ["pasta-med-kodsovs"] });
    expect(skipped).toMatchObject({ created: 1, updated: 0, skipped: 1 });
    const pasta = () => archive.db.select<{ id: string; instructions: string; photo_document_id: string | null }>("SELECT * FROM recipe WHERE source_ref = 'open-planner:pasta-med-kodsovs'");
    expect((await pasta())[0]!.photo_document_id).toBeNull();
    const shrimp = (await listRecipes(archive.db, { q: "rejer" }))[0]!;
    expect(shrimp.allergens).toEqual(["gluten", "egg", "shellfish"]);

    const res = await importOpenPlanner(env, archive, ctx, v2);
    expect(res).toMatchObject({ created: 0, updated: 1, unchanged: 1, photos: 1 });
    const [p] = await pasta();
    expect(p!.instructions).toBe("Ændret fremgangsmåde i version 2. (syntetisk)");
    expect(await ingredientLines(archive.db, p!.id)).toEqual(["500 g hakket oksekød", "1 dåse hakkede tomater", "2 løg", "400 g pasta", "2 dl fløde, kan udelades"]);
    const doc = (await archive.db.select<{ mime: string; source: string; sha256: string; ext: string; title: string }>("SELECT * FROM document WHERE id = ?", [p!.photo_document_id]))[0]!;
    expect(doc).toMatchObject({ mime: "image/png", source: "drop", ext: "png", title: "Pasta med kødsovs" });
    expect(await env.fs.exists(archive.path(`bilag/${doc.sha256.slice(0, 2)}/${doc.sha256}.png`))).toBe(true);
    // No temporary files are left behind.
    expect((await env.fs.listDir(archive.path("bilag"))).filter((e) => e.name.startsWith("."))).toEqual([]);
    expect((await previewOpenPlanner(archive.db, v2)).counts).toEqual({ new: 0, changed: 0, unchanged: 2 });
    // The photo is used by the recipe, so it is not in the import queue (documents without links).
    expect((await listDocuments(archive.db, { unlinkedOnly: true })).map((d) => d.id)).not.toContain(p!.photo_document_id);
    expect((await listDocuments(archive.db)).find((d) => d.id === p!.photo_document_id)?.link_count).toBe(1);
  });

  it("rejects invalid files and more than 200 dishes", () => {
    expect(() => parseOpenPlanner("nope")).toThrow(/gyldig JSON/);
    expect(() => parseOpenPlanner(JSON.stringify({ version: 3, retter: [] }))).toThrow(/version 1 eller 2/);
    const many = { version: 2, retter: Array.from({ length: 201 }, (_, i) => ({ id: `r${i}`, navn: `Ret ${i}`, ingredienser: [] })) };
    expect(() => parseOpenPlanner(JSON.stringify(many))).toThrow(/200/);
    expect(() => parseOpenPlanner(new Uint8Array(50 * 1024 * 1024 + 1))).toThrow(/50 MB/);
  });

  it("exports version 2 with embedded photos that round-trips through the importer", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    await importOpenPlanner(env, archive, ctx, parseOpenPlanner(fixture("v2.json")));
    const own = await createRecipe(ctx, { name: "Æblegrød på 5 min", instructions: "Rør." }, ["1 kg æbler", "Sukker"]);
    const twin = await createRecipe(ctx, { name: "Æblegrød på 5 min" });
    const ids = (await archive.db.select<{ id: string }>("SELECT id FROM recipe ORDER BY created_at, rowid")).map((r) => r.id);
    const out = await exportOpenPlanner(env, archive, ids, "2026-11-24");
    expect(out).toMatchObject({ format: "extruda-open-planner-database", version: 2, sprog: "da", opdateret: "2026-11-24" });
    expect(out.retter.map((r) => r.id)).toEqual(["pasta-med-kodsovs", "rejer-med-ris", "aeblegroed-paa-5-min", "aeblegroed-paa-5-min-2"]);
    const v2 = JSON.parse(fixture("v2.json"));
    expect(out.retter[0]!.billede).toBe(v2.retter[0].billede);
    expect(out.retter[0]!.ingredienser).toEqual(v2.retter[0].ingredienser);
    expect(out.retter[2]).toEqual({ id: "aeblegroed-paa-5-min", navn: "Æblegrød på 5 min", ingredienser: ["1 kg æbler", "sukker"], fremgangsmaade: "Rør." });
    expect(String(own.id) && String(twin.id)).toBeTruthy();

    // The export is a valid version-2 database for our own importer, and nothing changes.
    const again = parseOpenPlanner(JSON.stringify(out));
    const p = await previewOpenPlanner(archive.db, again);
    expect(p.dishes.slice(0, 2).map((d) => d.status)).toEqual(["unchanged", "unchanged"]);
    expect(slugify("Kylling i karry (hurtig!)")).toBe("kylling-i-karry-hurtig");
  });
});

describe("phase 2b.8 – starter catalog", () => {
  it("creates the 40 dishes from templates/da/retter.json once", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const file = JSON.parse(readFileSync(join(repoRoot, "templates/da/retter.json"), "utf8"));
    expect(STARTER_CATALOG.retter).toEqual(file.retter);
    expect(file.retter).toHaveLength(40);
    expect(await shouldOfferCatalog(archive.db)).toBe(true);
    expect(await addStarterCatalog(ctx)).toBe(40);
    expect(await shouldOfferCatalog(archive.db)).toBe(false);
    expect(await addStarterCatalog(ctx)).toBe(0);
    const rows = await archive.db.select<{ n: number; s: string }>("SELECT count(*) AS n, group_concat(DISTINCT source) AS s FROM recipe");
    expect(rows[0]).toEqual({ n: 40, s: "template" });
    // A later Open Planner import fills in the same recipes instead of duplicating them.
    const res = await importOpenPlanner(env, archive, ctx, parseOpenPlanner(fixture("v1.json")));
    expect(res).toMatchObject({ created: 0 });
    expect((await archive.db.select<{ n: number }>("SELECT count(*) AS n FROM recipe"))[0]!.n).toBe(40);
    expect(await ingredientLines(archive.db, (await archive.db.select<{ id: string }>("SELECT id FROM recipe WHERE source_ref = 'open-planner:pasta-med-kodsovs'"))[0]!.id)).toHaveLength(6);
  });

  it("can be declined", async () => {
    const { env, archive } = await newArchive();
    await dismissStarterCatalog(ctxFor(env, archive));
    expect(await shouldOfferCatalog(archive.db)).toBe(false);
  });
});

describe("phase 2b.9/10 – dashboard: spending graph and today's dish", () => {
  it("returns 6 months of spending and today's/tomorrow's dishes", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const acc = await createEntity(ctx, "account", { name: "Konto" });
    const transfer = (await archive.db.select<{ id: string }>("SELECT id FROM category WHERE kind = 'transfer'"))[0]!.id;
    let n = 0;
    const tx = (d: string, a: number, cat: string | null = null) =>
      createEntity(ctx, "bank_transaction", { account_id: String(acc.id), booking_date: d, text: "x", amount_minor: a, category_id: cat, dedupe_hash: `h${n++}` });
    await tx("2026-05-31", -100);
    await tx("2026-06-02", -1000);
    await tx("2026-11-03", -2000);
    await tx("2026-11-04", 50000);
    await tx("2026-11-05", -7000, transfer);
    expect(await monthlySpending(archive.db, "2026-11-24")).toEqual([
      { month: "2026-06", expense_minor: 1000 },
      { month: "2026-07", expense_minor: 0 },
      { month: "2026-08", expense_minor: 0 },
      { month: "2026-09", expense_minor: 0 },
      { month: "2026-10", expense_minor: 0 },
      { month: "2026-11", expense_minor: 2000 },
    ]);

    expect((await dashboard(archive.db, { today: "2026-11-24", userId: null })).meals).toBeNull();
    const r = await createRecipe(ctx, { name: "Fiskefrikadeller" }, ["500 g fiskefars"]);
    await planMeal(ctx, { plan_date: "2026-11-23", title: "Rester" });
    await planMeal(ctx, { plan_date: "2026-11-25", recipe_id: String(r.id) });
    const d = await dashboard(archive.db, { today: "2026-11-24", userId: null });
    expect(d.spending).toHaveLength(6);
    expect(d.meals).toMatchObject({ today: [], tomorrow: [{ label: "Fiskefrikadeller", allergens: ["fish"] }] });
    expect((await search(archive.db, "fiskefrik"))[0]).toMatchObject({ type: "recipe", module: "food" });
  });
});

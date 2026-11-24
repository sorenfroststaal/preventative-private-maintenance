/** Recipes with ingredient lists (spec 03 "Madplan", 04 "Opskrifter"). */
import { z } from "zod";
import type { DbAdapter } from "../db/adapter";
import type { Row } from "../domain/registry";
import { fields, type EntityInput } from "../domain/schemas";
import {
  createEntity,
  deleteRow,
  mustGet,
  parseOrThrow,
  reindex,
  updateEntity,
  ValidationError,
  withDb,
  type Ctx,
} from "../repo/entities";
import { recipeAllergens } from "./allergens";
import { formatIngredient, normalizeName, parseIngredients } from "./ingredients";

export interface IngredientInput {
  amount?: number | null;
  unit?: string | null;
  name: string;
  note?: string | null;
  raw_text?: string | null;
}

const zIngredient = z
  .object({
    amount: fields.recipe_ingredient.amount,
    unit: fields.recipe_ingredient.unit,
    name: fields.recipe_ingredient.name,
    note: fields.recipe_ingredient.note,
    raw_text: fields.recipe_ingredient.raw_text,
  })
  .strict();

export type RecipeInput = Omit<EntityInput<"recipe">, never>;

/** Ingredients as structured rows or as text lines (parsed with the ingredient parser). */
export type IngredientsInput = IngredientInput[] | string[] | string;

export function toIngredientRows(input: IngredientsInput): IngredientInput[] {
  if (typeof input === "string") return parseIngredients(input);
  if (input.every((x) => typeof x === "string")) return parseIngredients(input as string[]);
  return input as IngredientInput[];
}

function validateIngredients(rows: IngredientInput[]): IngredientInput[] {
  return rows.map((r, i) => {
    const res = zIngredient.safeParse({ ...r, name: r.name === undefined ? r.name : normalizeName(r.name) });
    if (!res.success) {
      throw new ValidationError(
        res.error.issues.map((x) => ({ path: `ingredients.${i}.${x.path.join(".")}`, message: x.message })),
        "recipe_ingredient",
      );
    }
    return res.data;
  });
}

/**
 * Replaces the whole ingredient list in the caller's transaction: every old row is
 * deleted and every new row inserted, each with its own audit entry (spec 03).
 */
async function replaceIngredients(ctx: Ctx, recipeId: string, rows: IngredientInput[]): Promise<void> {
  const old = await ctx.db.select<{ id: string }>("SELECT id FROM recipe_ingredient WHERE recipe_id = ? ORDER BY position", [recipeId]);
  for (const o of old) await deleteRow(ctx, "recipe_ingredient", o.id);
  let position = 0;
  for (const r of rows) {
    await createEntity(ctx, "recipe_ingredient", {
      recipe_id: recipeId,
      position: position++,
      amount: r.amount ?? null,
      unit: r.unit ?? null,
      name: r.name,
      note: r.note ?? null,
      raw_text: r.raw_text ?? null,
    });
  }
}

/** Creates a recipe with its ingredients in one transaction. */
export async function createRecipe(ctx: Ctx, data: RecipeInput, ingredients: IngredientsInput = []): Promise<Row> {
  const rows = validateIngredients(toIngredientRows(ingredients));
  parseOrThrow(z.object(fields.recipe).strict(), data, "recipe");
  return ctx.db.transaction(async (tx) => {
    const c = withDb(ctx, tx);
    const recipe = await createEntity(c, "recipe", data);
    await replaceIngredients(c, String(recipe.id), rows);
    await reindex(tx, "recipe", recipe);
    return recipe;
  });
}

/**
 * Updates a recipe. When `ingredients` is given, the list is replaced as a whole in the
 * same transaction; when omitted, the ingredients are left as they are.
 */
export async function updateRecipe(
  ctx: Ctx,
  id: string,
  changes: Partial<RecipeInput>,
  ingredients?: IngredientsInput,
): Promise<Row> {
  const rows = ingredients === undefined ? null : validateIngredients(toIngredientRows(ingredients));
  return ctx.db.transaction(async (tx) => {
    const c = withDb(ctx, tx);
    let recipe = Object.keys(changes).length ? await updateEntity(c, "recipe", id, changes) : await mustGet(tx, "recipe", id);
    if (rows) {
      const current = await recipeIngredients(tx, id);
      if (!sameIngredients(current, rows)) {
        await replaceIngredients(c, id, rows);
        // The ingredient list is part of the recipe: bump updated_at.
        await tx.execute("UPDATE recipe SET updated_at = ? WHERE id = ?", [ctx.clock.nowIso(), id]);
        recipe = await mustGet(tx, "recipe", id);
      }
      await reindex(tx, "recipe", recipe);
    }
    return recipe;
  });
}

const ingKey = (r: IngredientInput) => JSON.stringify([r.amount ?? null, r.unit ?? null, r.name, r.note ?? null]);
export function sameIngredients(a: IngredientInput[], b: IngredientInput[]): boolean {
  return a.length === b.length && a.every((x, i) => ingKey(x) === ingKey(b[i]!));
}

export type IngredientRow = Row & IngredientInput & { id: string; position: number };

export async function recipeIngredients(db: DbAdapter, recipeId: string): Promise<IngredientRow[]> {
  return db.select<IngredientRow>("SELECT * FROM recipe_ingredient WHERE recipe_id = ? ORDER BY position", [recipeId]);
}

export interface RecipeSummary extends Row {
  id: string;
  name: string;
  servings: number;
  tags: string[];
  allergens: string[];
  derived_allergens: string[];
  ingredient_count: number;
}

const tagsOf = (v: unknown): string[] => {
  if (typeof v !== "string") return [];
  try {
    const a: unknown = JSON.parse(v);
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
};

/** Recipes with tags and allergens (marked and derived), optionally filtered. */
export async function listRecipes(
  db: DbAdapter,
  opts: { q?: string; tag?: string; includeArchived?: boolean } = {},
): Promise<RecipeSummary[]> {
  const recipes = await db.select<Row>(
    `SELECT * FROM recipe ${opts.includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY name COLLATE NOCASE`,
  );
  const ings = await db.select<{ recipe_id: string; name: string }>("SELECT recipe_id, name FROM recipe_ingredient ORDER BY position");
  const byRecipe = new Map<string, string[]>();
  for (const i of ings) byRecipe.set(i.recipe_id, [...(byRecipe.get(i.recipe_id) ?? []), i.name]);
  const q = opts.q?.trim().toLowerCase();
  return recipes
    .map((r) => {
      const names = byRecipe.get(String(r.id)) ?? [];
      const al = recipeAllergens(r.allergens_json, names);
      return {
        ...r,
        id: String(r.id),
        name: String(r.name),
        servings: Number(r.servings),
        tags: tagsOf(r.tags_json),
        allergens: al.all,
        derived_allergens: al.derived,
        ingredient_count: names.length,
        _names: names,
      };
    })
    .filter((r) => !opts.tag || r.tags.includes(opts.tag))
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r._names.some((n) => n.includes(q)) || r.tags.some((t) => t.toLowerCase().includes(q)))
    .map(({ _names, ...r }) => r);
}

export async function allRecipeTags(db: DbAdapter): Promise<string[]> {
  const rows = await db.select<{ tags_json: string | null }>("SELECT tags_json FROM recipe WHERE archived_at IS NULL");
  return [...new Set(rows.flatMap((r) => tagsOf(r.tags_json)))].sort((a, b) => a.localeCompare(b, "da"));
}

/** Ingredients in short text form, one per line (for editing as text, export and AI). */
export async function ingredientLines(db: DbAdapter, recipeId: string): Promise<string[]> {
  return (await recipeIngredients(db, recipeId)).map((i) => formatIngredient(i));
}

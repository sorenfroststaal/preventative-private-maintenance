import { z } from 'zod';
import type { DbAdapter } from '../db/adapter';
import { now } from '../db/migrate';
import { recordChange, type WriteContext, type Fields } from '../repo/write';
import { parseIngredients } from './ingredients';

import { allergenWords } from './allergens';
const short = z.string().trim().min(1).max(240);
export const ingredient = z.strictObject({ name: short, amount: z.number().positive().nullish(), unit: short.nullish(),
  note: z.string().nullish(), raw_text: z.string().nullish() });
export const recipeInput = z.strictObject({ name: short, servings: z.number().int().positive().default(4),
  description: z.string().nullish(), instructions: z.string().nullish(), prep_minutes: z.number().int().nonnegative().nullish(),
  tags: z.array(short).default([]), allergens: z.array(z.enum(Object.keys(allergenWords) as (keyof typeof allergenWords)[])).default([]),
  estimated_cost_minor: z.number().int().nonnegative().nullish(), photo_document_id: z.uuid().nullish(),
  ingredients: z.union([z.string(), z.array(z.string()), z.array(ingredient)]).default([]) });
export type FoodTable = 'recipe' | 'recipe_ingredient' | 'meal_plan_entry' | 'shopping_list' | 'shopping_item';

// Callers validate fields and wrap related writes in one transaction.
export async function change(tx: DbAdapter, ctx: WriteContext, table: FoodTable, id: string, values: Fields | null) {
  const [before] = await tx.select<Fields>('SELECT * FROM '+table+' WHERE id = ?', [id]);
  if (values === null) {
    if (!before) throw new Error('Posten findes ikke.');
    await tx.execute('DELETE FROM '+table+' WHERE id = ?', [id]);
  } else {
    const entries = Object.entries(values).filter(([,v]) => v !== undefined);
    const keys = entries.map(([k]) => k);
    const args = entries.map(([,v]) => v);
    if (before) await tx.execute('UPDATE '+table+' SET '+keys.map(k=>k+' = ?').join(',')+' WHERE id = ?', [...args,id]);
    else await tx.execute('INSERT INTO '+table+' (id,'+keys.join(',')+') VALUES (?,'+keys.map(()=>'?').join(',')+')', [id,...args]);
  }
  const [after] = await tx.select<Fields>('SELECT * FROM '+table+' WHERE id = ?', [id]);
  const ingredients = table === 'recipe' && after ? await tx.select<{name:string}>('SELECT name FROM recipe_ingredient WHERE recipe_id = ?', [id]) : [];
  await recordChange(tx,ctx,table,id,before ?? null,after ?? null,table === 'recipe' && after ?
    { module:'food',title:String(after.name),body:[after.description,after.instructions,after.tags_json,...ingredients.map(i=>i.name)].join(' '),archived:Boolean(after.archived_at) } : undefined);
  return id;
}

export async function readRecipe(db: DbAdapter, rawId: unknown) {
  const id = z.uuid().parse(rawId);
  const [row] = await db.select<Fields & { id:string;name:string;servings:number;instructions:string|null;description:string|null;photo_document_id:string|null;tags_json:string|null;allergens_json:string|null;estimated_cost_minor:number|null;prep_minutes:number|null;source_ref:string|null }>('SELECT * FROM recipe WHERE id = ?', [id]);
  if (!row) throw new Error('Opskriften findes ikke.');
  return { ...row, tags: JSON.parse(String(row.tags_json ?? '[]')), allergens: JSON.parse(String(row.allergens_json ?? '[]')),
    ingredients: await db.select<z.infer<typeof ingredient>>('SELECT name, amount, unit, note, raw_text FROM recipe_ingredient WHERE recipe_id = ? ORDER BY position', [id]) };
}

export async function saveRecipe(db: DbAdapter, ctx: WriteContext, raw: unknown, id?: string, origin?: {source: 'import'|'ai'; source_ref?: string}) {
  const data = recipeInput.parse(raw);
  const key = id ? z.uuid().parse(id) : crypto.randomUUID();
  const { ingredients, tags, allergens, ...fields } = data;
  const lines = typeof ingredients === 'string' || ingredients.every(i=>typeof i === 'string') ?
    parseIngredients(ingredients as string|string[]) : ingredients as z.infer<typeof ingredient>[];
  return db.transaction(async tx => {
    if (id && !(await tx.select('SELECT id FROM recipe WHERE id = ? AND archived_at IS NULL',[key])).length) throw new Error('Opskriften er utilgængelig.');
    if (fields.photo_document_id && !(await tx.select("SELECT id FROM document d WHERE id = ? AND mime IN ('image/jpeg','image/png') AND NOT EXISTS (SELECT 1 FROM document_link WHERE document_id=d.id AND (target_type LIKE 'health_%' OR target_type IN ('person','task_occurrence')))",[fields.photo_document_id])).length) throw new Error('Vælg et synligt billede.');
    const at = now();
    // The parent must exist before inserting child rows.
    if (!id) await tx.execute('INSERT INTO recipe (id,name,created_at,updated_at) VALUES (?,?,?,?)',[key,fields.name,at,at]);
    for (const old of await tx.select<{id:string}>('SELECT id FROM recipe_ingredient WHERE recipe_id=?',[key])) await change(tx,ctx,'recipe_ingredient',old.id,null);
    for (const [position,line] of lines.entries()) await change(tx,ctx,'recipe_ingredient',crypto.randomUUID(),{...line, name:line.name.trim().toLowerCase(),position,recipe_id:key});
    const updated = { ...fields, ...origin, tags_json:JSON.stringify(tags),allergens_json:JSON.stringify(allergens),updated_at:at };
    if (id) return change(tx,ctx,'recipe',key,updated);
    const entries = Object.entries(updated).filter(([,v])=>v!==undefined);
    await tx.execute('UPDATE recipe SET '+entries.map(([k])=>k+'=?').join(',')+' WHERE id=?',[...entries.map(([,v])=>v),key]);
    const [saved] = await tx.select<Fields>('SELECT * FROM recipe WHERE id=?',[key]);
    await recordChange(tx,ctx,'recipe',key,null,saved,{module:'food',title:data.name,body:[fields.description,fields.instructions,...tags,...lines.map(i=>i.name)].join(' ')});
    return key;
  });
}

export async function archiveRecipe(db: DbAdapter, ctx: WriteContext, rawId: unknown) {
  const id=z.uuid().parse(rawId);
  return db.transaction(async tx=>{ await readRecipe(tx,id); return change(tx,ctx,'recipe',id,{archived_at:now(),updated_at:now()}); });
}

export async function allergyWarnings(db: DbAdapter, recipeId: string, userId?: string) {
  const r=await readRecipe(db,recipeId);
  const keys=new Set<string>(r.allergens);
  for (const [key,words] of Object.entries(allergenWords)) {
    if (r.ingredients.some(i=>words.some(w=>i.name.toLowerCase().includes(w.toLowerCase())))) keys.add(key);
  }
  const rows=await db.select<{name:string;substance:string;owner:string|null}>('SELECT p.name,a.substance,p.health_private_user_id AS owner FROM health_allergy a JOIN person p ON p.id=a.person_id WHERE p.archived_at IS NULL');
  const warnings=new Set<string>();
  for (const row of rows) {
    if (Object.entries(allergenWords).some(([k,words])=>keys.has(k)&&words.some(w=>row.substance.toLowerCase().includes(w.toLowerCase()))))
      warnings.add(row.owner && row.owner!==userId ? 'Allergi hos et husstandsmedlem (privat)' : row.substance+' ('+row.name+')');
  }
  return [...warnings];
}

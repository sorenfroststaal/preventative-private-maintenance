/** Import from and export to Open Planner databases (spec 05 "Import fra/Eksport til Open Planner"). */
import { safeParseDanish } from "../domain/messages";
import { z } from "zod";
import type { Archive } from "../archive/archive";
import type { DbAdapter } from "../db/adapter";
import type { Row } from "../domain/registry";
import type { Env } from "../env";
import { documentRelPath, importDocument } from "../repo/documents";
import { mustGet, withDb, type Ctx } from "../repo/entities";
import { OPEN_PLANNER_PREFIX } from "./catalog";
import { formatIngredient, parseIngredients, type ParsedIngredient } from "./ingredients";
import { createRecipe, recipeIngredients, sameIngredients, updateRecipe } from "./recipes";

export const OPEN_PLANNER_MAX_DISHES = 200;
export const OPEN_PLANNER_MAX_BYTES = 50 * 1024 * 1024;
export const OPEN_PLANNER_FORMAT = "extruda-open-planner-database";

const zDish = z
  .object({
    id: z.string().min(1),
    navn: z.string().min(1),
    billede: z.string().optional().nullable(),
    ingredienser: z.union([z.array(z.string()), z.string()]).optional().nullable(),
    fremgangsmaade: z.string().optional().nullable(),
    opskrift: z.string().optional().nullable(),
  })
  .passthrough();

const zDatabase = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    format: z.string().optional(),
    sprog: z.string().optional(),
    retter: z.array(zDish).max(OPEN_PLANNER_MAX_DISHES, { message: `Højst ${OPEN_PLANNER_MAX_DISHES} retter` }),
  })
  .passthrough();

export type OpenPlannerDatabase = z.infer<typeof zDatabase>;

export class OpenPlannerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenPlannerError";
  }
}

/** Validates the file (JSON, version 1 or 2, at most 200 dishes and 50 MB). */
export function parseOpenPlanner(input: string | Uint8Array): OpenPlannerDatabase {
  const size = typeof input === "string" ? new TextEncoder().encode(input).length : input.length;
  if (size > OPEN_PLANNER_MAX_BYTES) throw new OpenPlannerError("Filen er større end 50 MB.");
  const text = typeof input === "string" ? input : new TextDecoder("utf-8").decode(input);
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new OpenPlannerError("Filen er ikke gyldig JSON.");
  }
  const r = safeParseDanish(zDatabase, json);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new OpenPlannerError(`Filen er ikke en Open Planner-database (version 1 eller 2): ${i?.path.join(".") || ""} ${i?.message ?? ""}`.trim());
  }
  return r.data;
}

interface IncomingPhoto {
  mime: "image/png" | "image/jpeg";
  ext: "png" | "jpg";
  bytes: Uint8Array;
}

const DATA_URI = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)$/;

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function photoOf(billede: string | null | undefined): IncomingPhoto | "relative" | null {
  if (!billede) return null;
  const m = DATA_URI.exec(billede.trim());
  if (!m) return "relative";
  const png = m[1] === "png";
  return { mime: png ? "image/png" : "image/jpeg", ext: png ? "png" : "jpg", bytes: decodeBase64(m[2]!) };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface IncomingDish {
  id: string;
  source_ref: string;
  name: string;
  instructions: string | null;
  ingredients: ParsedIngredient[];
  photo: IncomingPhoto | "relative" | null;
}

function toIncoming(d: z.infer<typeof zDish>): IncomingDish {
  const instructions = (d.fremgangsmaade ?? d.opskrift ?? "").trim() || null;
  return {
    id: d.id,
    source_ref: OPEN_PLANNER_PREFIX + d.id,
    name: d.navn.trim(),
    instructions,
    ingredients: parseIngredients(d.ingredienser ?? []),
    photo: photoOf(d.billede),
  };
}

export type DishStatus = "new" | "changed" | "unchanged";

export interface PreviewDish {
  id: string;
  name: string;
  status: DishStatus;
  recipe_id: string | null;
  /** Fields that would change for an existing recipe. */
  changes: ("name" | "instructions" | "ingredients" | "photo")[];
  ingredient_count: number;
  has_photo: boolean;
}

export interface OpenPlannerPreview {
  version: 1 | 2;
  dishes: PreviewDish[];
  counts: Record<DishStatus, number>;
  /** Messages for the dialog, e.g. relative image paths that cannot be imported. */
  messages: string[];
}

/**
 * Compares incoming dishes with existing recipes by source_ref. Empty fields in the file
 * never count as a change: they do not overwrite what the user has filled in.
 */
async function classify(db: DbAdapter, dish: IncomingDish): Promise<PreviewDish> {
  const existing = (await db.select<Row>("SELECT * FROM recipe WHERE source_ref = ?", [dish.source_ref]))[0];
  const base = {
    id: dish.id,
    name: dish.name,
    ingredient_count: dish.ingredients.length,
    has_photo: typeof dish.photo === "object" && dish.photo !== null,
  };
  if (!existing) return { ...base, status: "new", recipe_id: null, changes: [] };
  const changes: PreviewDish["changes"] = [];
  if (existing.name !== dish.name) changes.push("name");
  if (dish.instructions && existing.instructions !== dish.instructions) changes.push("instructions");
  if (dish.ingredients.length && !sameIngredients(await recipeIngredients(db, String(existing.id)), dish.ingredients)) {
    changes.push("ingredients");
  }
  if (typeof dish.photo === "object" && dish.photo) {
    const doc = existing.photo_document_id ? await db.select<{ sha256: string }>("SELECT sha256 FROM document WHERE id = ?", [String(existing.photo_document_id)]) : [];
    if (doc[0]?.sha256 !== (await sha256Hex(dish.photo.bytes))) changes.push("photo");
  }
  return { ...base, status: changes.length ? "changed" : "unchanged", recipe_id: String(existing.id), changes };
}

export async function previewOpenPlanner(db: DbAdapter, data: OpenPlannerDatabase): Promise<OpenPlannerPreview> {
  const dishes: PreviewDish[] = [];
  const messages: string[] = [];
  const seen = new Set<string>();
  for (const d of data.retter) {
    if (seen.has(d.id)) {
      messages.push(`Retten "${d.navn}" står flere gange i filen. Kun den første bruges.`);
      continue;
    }
    seen.add(d.id);
    const inc = toIncoming(d);
    if (inc.photo === "relative") messages.push(`Billedet til "${inc.name}" ligger ikke i filen og importeres ikke.`);
    dishes.push(await classify(db, inc));
  }
  const counts = { new: 0, changed: 0, unchanged: 0 };
  for (const d of dishes) counts[d.status]++;
  return { version: data.version, dishes, counts, messages };
}

export interface OpenPlannerImportResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  photos: number;
  messages: string[];
}

async function importPhoto(env: Env, archive: Archive, ctx: Ctx, dish: IncomingDish, photo: IncomingPhoto): Promise<string> {
  // Written next to the attachments under a temporary name, then imported like a dropped file.
  const tmp = archive.path("bilag", `.open-planner-${ctx.newId()}.${photo.ext}`);
  await env.fs.writeFile(tmp, photo.bytes);
  try {
    const r = await importDocument(env, archive, ctx, tmp, { source: "drop", filename: `${dish.id}.${photo.ext}`, title: dish.name });
    return String(r.document.id);
  } finally {
    await env.fs.remove(tmp).catch(() => undefined);
  }
}

/**
 * Imports the database. New dishes are created; changed ones are updated unless their id is
 * in `skip` (the user deselected them in the dialog). Everything runs in one transaction.
 */
export async function importOpenPlanner(
  env: Env,
  archive: Archive,
  ctx: Ctx,
  data: OpenPlannerDatabase,
  opts: { skip?: string[] } = {},
): Promise<OpenPlannerImportResult> {
  const preview = await previewOpenPlanner(ctx.db, data);
  const byId = new Map(preview.dishes.map((d) => [d.id, d]));
  const skip = new Set(opts.skip ?? []);
  const res: OpenPlannerImportResult = { created: 0, updated: 0, unchanged: preview.counts.unchanged, skipped: 0, photos: 0, messages: preview.messages };
  await ctx.db.transaction(async (tx) => {
    const c = withDb(ctx, tx);
    const done = new Set<string>();
    for (const raw of data.retter) {
      if (done.has(raw.id)) continue;
      done.add(raw.id);
      const dish = toIncoming(raw);
      const p = byId.get(dish.id)!;
      if (p.status === "unchanged") continue;
      if (p.status === "changed" && skip.has(dish.id)) {
        res.skipped++;
        continue;
      }
      let photoId: string | null = null;
      if (typeof dish.photo === "object" && dish.photo && (p.status === "new" || p.changes.includes("photo"))) {
        photoId = await importPhoto(env, archive, c, dish, dish.photo);
        res.photos++;
      }
      if (p.status === "new") {
        await createRecipe(
          c,
          { name: dish.name, instructions: dish.instructions, source: "import", source_ref: dish.source_ref, photo_document_id: photoId },
          dish.ingredients,
        );
        res.created++;
      } else {
        await updateRecipe(
          c,
          p.recipe_id!,
          {
            source: "import",
            ...(p.changes.includes("name") ? { name: dish.name } : {}),
            ...(p.changes.includes("instructions") ? { instructions: dish.instructions } : {}),
            ...(photoId ? { photo_document_id: photoId } : {}),
          },
          p.changes.includes("ingredients") ? dish.ingredients : undefined,
        );
        res.updated++;
      }
    }
  });
  return res;
}

// ---------- Export ----------

/** URL-safe id from a Danish name: "Æblegrød på 5 min" → "aeblegroed-paa-5-min". */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/æ/g, "ae")
      .replace(/ø/g, "oe")
      .replace(/å/g, "aa")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "ret"
  );
}

export interface OpenPlannerExportDish {
  id: string;
  navn: string;
  billede?: string;
  ingredienser: string[];
  fremgangsmaade?: string;
}

/**
 * Exports recipes as an Open Planner database version 2 with embedded photos (spec 05).
 * `id` is source_ref without the prefix when present, otherwise a unique slug of the name.
 */
export async function exportOpenPlanner(
  env: Env,
  archive: Archive,
  recipeIds: string[],
  today: string,
): Promise<{ format: string; version: 2; sprog: "da"; opdateret: string; standardkortMm: { bredde: number; hoejde: number }; retter: OpenPlannerExportDish[] }> {
  const used = new Set<string>();
  const retter: OpenPlannerExportDish[] = [];
  for (const id of recipeIds) {
    const r = await mustGet(archive.db, "recipe", id);
    const ref = typeof r.source_ref === "string" && r.source_ref.startsWith(OPEN_PLANNER_PREFIX) ? r.source_ref.slice(OPEN_PLANNER_PREFIX.length) : null;
    let dishId = ref ?? slugify(String(r.name));
    if (!ref) for (let n = 2; used.has(dishId); n++) dishId = `${slugify(String(r.name))}-${n}`;
    used.add(dishId);
    const dish: OpenPlannerExportDish = {
      id: dishId,
      navn: String(r.name),
      ingredienser: (await recipeIngredients(archive.db, id)).map((i) => formatIngredient(i)),
    };
    if (r.instructions) dish.fremgangsmaade = String(r.instructions);
    if (r.photo_document_id) {
      const doc = (await archive.db.select<Row>("SELECT * FROM document WHERE id = ?", [String(r.photo_document_id)]))[0];
      if (doc && (doc.mime === "image/png" || doc.mime === "image/jpeg")) {
        const bytes = await env.fs.readFile(archive.path(documentRelPath(String(doc.sha256), String(doc.ext))));
        dish.billede = `data:${doc.mime};base64,${encodeBase64(bytes)}`;
      }
    }
    retter.push(dish);
  }
  return { format: OPEN_PLANNER_FORMAT, version: 2, sprog: "da", opdateret: today, standardkortMm: { bredde: 69, hoejde: 66 }, retter };
}

/** Recipe ids planned in a week (for "eksportér ugens retter"), in plan order, without duplicates. */
export async function weekRecipeIds(db: DbAdapter, monday: string, sunday: string): Promise<string[]> {
  const rows = await db.select<{ recipe_id: string }>(
    "SELECT recipe_id FROM meal_plan_entry WHERE plan_date BETWEEN ? AND ? AND recipe_id IS NOT NULL ORDER BY plan_date, created_at",
    [monday, sunday],
  );
  return [...new Set(rows.map((r) => r.recipe_id))];
}

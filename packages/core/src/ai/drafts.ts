/**
 * Draft groups proposed by AI (spec 06 "propose" and "Kladdegrupper"). This module only
 * writes to ai_draft and copies files into indbakke/ai/ – nothing else.
 */
import { z } from "zod";
import type { Archive } from "../archive/archive";
import type { DbAdapter } from "../db/adapter";
import type { Row } from "../domain/registry";
import { createSchema, fields, updateSchema, zRecurrence, type EntityType } from "../domain/schemas";
import type { Env } from "../env";
import { toIngredientRows } from "../food/recipes";
import { extOf, MIME_BY_EXT } from "../repo/documents";
import { ValidationError } from "../repo/entities";
import { getSetting } from "../repo/settings";
import { aiModuleOf, assertModule, canSee, hiddenHealthPersons, type AiAccess } from "./access";
import { expandRefs, isRef, isUuid, refOf, resolveRef } from "./compact";

/** Types that may be created/updated via propose (spec 06). */
export const PROPOSE_TYPES = [
  "person",
  "property",
  "item",
  "building_part",
  "location",
  "contact",
  "vehicle",
  "pet",
  "loan",
  "lending",
  "gift",
  "odometer_reading",
  "work_order",
  "task",
  "policy",
  "claim",
  "bank_transaction",
  "recurring_expense",
  "budget_line",
  "health_visit",
  "health_screening",
  "health_vaccination",
  "health_medication",
  "health_allergy",
  "health_measurement",
  "recipe",
  "meal_plan_entry",
  "shopping_item",
  "policy_coverage",
  "document",
] as const;

/** Link tables: create only (no update), result is the composite key. */
const LINK_TYPES = new Set(["policy_coverage"]);

export const zProposeOp = z
  .object({
    op: z.enum(["create", "update", "complete_task", "attach_document"]),
    type: z.string().optional(),
    ref: z.string().optional(),
    data: z.record(z.unknown()).optional(),
  })
  .strict();
export type ProposeOp = z.infer<typeof zProposeOp>;

export const zPropose = z
  .object({ ops: z.array(zProposeOp).min(1).max(100), rationale: z.string().trim().min(1), dry_run: z.boolean().optional() })
  .strict();

export class ProposeError extends Error {
  constructor(
    readonly index: number,
    message: string,
  ) {
    super(index > 0 ? `Operation ${index}: ${message}` : message);
    this.name = "ProposeError";
  }
}

/** Payload stored in ai_draft.payload_json. */
export interface DraftPayload {
  group: string;
  /** Id of an existing record with the same name (warning shown in the inbox). */
  duplicate_of?: string;
  index: number;
  op: ProposeOp["op"];
  type: string;
  /** Full id of the target (update, complete_task, attach target). */
  target_id?: string;
  data: Record<string, unknown>;
  /** recipe: structured ingredient rows. */
  ingredients?: unknown[];
  /** attach_document: archive-relative path of the copied file, or the document id. */
  file?: string;
  document_id?: string;
}

export interface ProposeContext {
  env: Env;
  archive: Archive;
  access: AiAccess;
  /** Allowed import folders when ai.allowed_import_dirs is not set (defaults: indbakke, Downloads, Overførsler). */
  homeDir?: string;
  /** Resolves symlinks and `..` (node: fs.realpath). */
  realpath?(p: string): Promise<string>;
  sep?: string;
}

const PLACEHOLDER = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DOLLAR = /^\$(\d+)$/;

/** Replaces "$n" with a syntactically valid placeholder id so the shared Zod schema can validate. */
function placeholders(data: Record<string, unknown>, index: number, creates: Set<number>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    const m = typeof v === "string" ? DOLLAR.exec(v) : null;
    if (m) {
      const n = Number(m[1]);
      if (n >= index || !creates.has(n)) throw new ProposeError(index, `"$${n}" skal pege på en tidligere create-operation.`);
      out[k] = PLACEHOLDER(n);
    } else out[k] = v;
  }
  return out;
}

const issues = (e: unknown) => (e instanceof ValidationError ? e.message : e instanceof Error ? e.message : String(e));

/**
 * Compact description of the fields of a type for error messages, so an AI client can
 * correct a proposal without guessing: `name*` (required), `kind=house|apartment`,
 * `purchase_date:date`, `price_minor:øre`, `location_id:ref`.
 */
export function describeFields(type: string): string {
  const shape = (fields as Record<string, z.ZodRawShape>)[type];
  if (!shape && type !== "attach_document") return "";
  const parts: string[] = [];
  for (const [key, schema] of Object.entries(shape ?? {})) {
    if (AI_FORBIDDEN_FIELDS[type]?.includes(key)) continue;
    let t: z.ZodTypeAny = schema as z.ZodTypeAny;
    let required = true;
    for (;;) {
      if (t instanceof z.ZodOptional || t instanceof z.ZodNullable) {
        required = false;
        t = t.unwrap();
      } else if (t instanceof z.ZodDefault) {
        required = false;
        t = t.removeDefault();
      } else if (t instanceof z.ZodEffects) {
        t = t.innerType();
      } else break;
    }
    let hint = "";
    if (t instanceof z.ZodEnum) hint = `=${(t.options as string[]).join("|")}`;
    else if (t instanceof z.ZodUnion) hint = "=0|1";
    else if (key.endsWith("_minor")) hint = ":øre";
    else if (key.endsWith("_date") || key.endsWith("_until") || key === "plan_date") hint = ":ÅÅÅÅ-MM-DD";
    else if (key.endsWith("_id")) hint = ":ref";
    else if (key.endsWith("_json")) hint = ":JSON-tekst";
    else if (t instanceof z.ZodNumber) hint = ":tal";
    parts.push(`${key}${required ? "*" : ""}${hint}`);
  }
  if (type === "recipe") parts.push("ingredients:[tekstlinjer]");
  if (type === "task") parts.push('recurrence:{kind=fixed|interval,unit=day|week|month|year,every,month?,day?}', "first_due_date:ÅÅÅÅ-MM-DD (create)", "due_date:ÅÅÅÅ-MM-DD (update, næste forekomst)");
  if (type === "attach_document") {
    return `Gyldige felter for attach_document (* = påkrævet): document:ref ELLER file_path, target*:ref (eller ref på operationen), role*=${fields.document_link.role.options.join("|")}, title, doc_date:ÅÅÅÅ-MM-DD`;
  }
  return `Gyldige felter for ${type} (* = påkrævet): ${parts.join(", ")}`;
}

/** Types a document can be linked to (document_link.target_type). */
export const ATTACHABLE: string[] = [...(fields.document_link.target_type as unknown as { options: string[] }).options];
const notAttachable = (type: string) => `Bilag kan ikke kobles til ${type}. Bilag kan kobles til: ${ATTACHABLE.join(", ")}.`;

/** Types created earlier in the same propose call, for checking "$n" targets. */
const createdTypeMaps = new Map<string, Map<number, string>>();
const createdTypes = (group: string) => {
  let m = createdTypeMaps.get(group);
  if (!m) {
    m = new Map();
    createdTypeMaps.set(group, m);
  }
  return m;
};

/** Columns that identify a record for the duplicate warning (spec: brugerens feedback, A10). */
const DUPLICATE_KEYS: Record<string, string[]> = {
  person: ["name"],
  property: ["name"],
  item: ["name"],
  building_part: ["name"],
  vehicle: ["registration", "name"],
  pet: ["name"],
  contact: ["name"],
  policy: ["policy_number", "title"],
  recurring_expense: ["name"],
  recipe: ["name"],
  location: ["name"],
};

/** An active record of the same type with the same identifying value (case-insensitive). */
async function findDuplicate(db: DbAdapter, type: string, data: Record<string, unknown>): Promise<{ id: string; label: string } | null> {
  for (const col of DUPLICATE_KEYS[type] ?? []) {
    const v = data[col];
    if (typeof v !== "string" || !v.trim()) continue;
    const archived = (await db.select<{ name: string }>(`PRAGMA table_info(${type})`)).some((c) => c.name === "archived_at") ? "AND archived_at IS NULL" : "";
    const r = await db.select<{ id: string }>(`SELECT id FROM ${type} WHERE lower(trim(${col})) = lower(trim(?)) ${archived} LIMIT 1`, [v]);
    if (r[0]) return { id: r[0].id, label: v.trim() };
  }
  return null;
}

/** Fields AI may not set (access control and privacy stay with the user). */
const AI_FORBIDDEN_FIELDS: Record<string, string[]> = {
  person: ["app_user_id", "health_private_user_id"],
};

function validate(schema: z.ZodTypeAny, data: unknown, index: number, type?: string) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => (i.code === "unrecognized_keys" ? `ukendte felter: ${i.keys.join(", ")}` : `${i.path.join(".")}: ${i.message}`)).join("; ");
    throw new ProposeError(index, type ? `${msg}. ${describeFields(type)}` : msg);
  }
}

async function allowedDirs(ctx: ProposeContext): Promise<string[]> {
  const stored = await getSetting<string[]>(ctx.archive.db, "ai.allowed_import_dirs");
  if (Array.isArray(stored) && stored.length) return stored;
  const dirs = [ctx.archive.path("indbakke")];
  if (ctx.homeDir) dirs.push(ctx.env.fs.join(ctx.homeDir, "Downloads"), ctx.env.fs.join(ctx.homeDir, "Overførsler"));
  return dirs;
}

/** True if `path` (after resolving symlinks and `..`) lies inside one of the allowed folders. */
export async function isAllowedImportPath(ctx: ProposeContext, path: string): Promise<boolean> {
  if (path.split(/[\\/]/).includes("..")) return false;
  const real = ctx.realpath ?? (async (p: string) => p);
  const sep = ctx.sep ?? "/";
  let target: string;
  try {
    target = await real(path);
  } catch {
    return false;
  }
  for (const d of await allowedDirs(ctx)) {
    let dir: string;
    try {
      dir = await real(d);
    } catch {
      continue;
    }
    const prefix = dir.endsWith(sep) ? dir : dir + sep;
    if (target.startsWith(prefix)) return true;
  }
  return false;
}

interface Prepared {
  /** Shown to the AI client and in the inbox, e.g. a record with the same name exists. */
  warning?: string;
  payload: DraftPayload;
  action: DraftPayload["op"];
  entity_type: string;
  entity_id: string | null;
  copy?: { from: string; rel: string };
}

async function prepareOp(ctx: ProposeContext, op: ProposeOp, index: number, group: string, creates: Set<number>): Promise<Prepared> {
  const db = ctx.archive.db;
  const access = ctx.access;
  const hidden = await hiddenHealthPersons(db, access);
  try {
    if (op.op === "create" || op.op === "update") {
      const type = op.type;
      if (!type || !(PROPOSE_TYPES as readonly string[]).includes(type)) {
        throw new ProposeError(index, `type skal være en af: ${PROPOSE_TYPES.join(", ")}.`);
      }
      assertModule(access, aiModuleOf(type));
      const { ingredients, ...rest0 } = (op.data ?? {}) as Record<string, unknown> & { ingredients?: unknown };
      // Tasks: recurrence as an object and the first due date (createTask), outside the table schema.
      const { recurrence, first_due_date, due_date, ...rest } =
        type === "task" ? (rest0 as Record<string, unknown>) : { ...rest0, recurrence: undefined, first_due_date: undefined, due_date: undefined };
      const taskExtras: Record<string, unknown> = {};
      if (type === "task") {
        if (recurrence !== undefined) {
          const r = zRecurrence.safeParse(recurrence);
          if (!r.success) throw new ProposeError(index, `recurrence: ${r.error.issues.map((i) => i.message).join("; ")}. Fx {"kind":"fixed","unit":"year","every":1,"month":11,"day":1} eller {"kind":"interval","unit":"month","every":6}`);
          taskExtras.recurrence = r.data;
        }
        if (first_due_date !== undefined) {
          if (op.op !== "create") throw new ProposeError(index, "first_due_date bruges ved create; brug due_date ved update.");
          if (typeof first_due_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(first_due_date)) throw new ProposeError(index, "first_due_date skal være ÅÅÅÅ-MM-DD.");
          taskExtras.first_due_date = first_due_date;
        }
        if (due_date !== undefined) {
          if (op.op !== "update") throw new ProposeError(index, "due_date bruges ved update; brug first_due_date ved create.");
          if (due_date !== null && (typeof due_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(due_date))) throw new ProposeError(index, "due_date skal være ÅÅÅÅ-MM-DD.");
          taskExtras.due_date = due_date;
        }
      }
      if (type === "document") {
        if (op.op === "create") throw new ProposeError(index, "Dokumenter oprettes med attach_document (file_path eller document).");
        const extra = Object.keys(rest).filter((k) => k !== "title" && k !== "doc_date");
        if (extra.length) throw new ProposeError(index, `document: kun title og doc_date kan ændres (ikke ${extra.join(", ")}).`);
      }
      if (ingredients !== undefined && type !== "recipe") throw new ProposeError(index, "ingredients bruges kun ved recipe.");
      const expanded = await expandRefs(db, rest);
      const withPh = placeholders(expanded, index, creates);
      // Health records must belong to a person the AI user may see.
      if (type.startsWith("health_") && typeof expanded.person_id === "string" && hidden.has(expanded.person_id)) {
        throw new ProposeError(index, "Helbredsoplysningerne for personen er private.");
      }
      let rows: unknown[] | undefined;
      if (ingredients !== undefined) {
        try {
          rows = toIngredientRows(ingredients as never);
        } catch (e) {
          throw new ProposeError(index, `ingredients: ${issues(e)}`);
        }
      }
      const forbidden = Object.keys(expanded).filter((k) => AI_FORBIDDEN_FIELDS[type]?.includes(k));
      if (forbidden.length) throw new ProposeError(index, `${forbidden.join(", ")} kan kun ændres af brugeren i appen.`);
      if (op.op === "create") {
        validate(createSchema(type as EntityType), withPh, index, type);
        if (type === "meal_plan_entry" && !expanded.recipe_id && !String(expanded.title ?? "").trim()) {
          throw new ProposeError(index, "meal_plan_entry kræver recipe_id eller title.");
        }
        if (type === "bank_transaction") throw new ProposeError(index, "bank_transaction kan kun opdateres (kategori og note).");
        if (type === "policy_coverage") {
          // Polymorphic target: check that it exists (unless it is created in the same group).
          const target = String(expanded.target_id ?? "");
          if (!DOLLAR.test(target)) await resolveRef(db, target, [String(expanded.target_type)]);
          if (!DOLLAR.test(String(expanded.policy_id ?? ""))) await resolveRef(db, String(expanded.policy_id), ["policy"]);
        }
        if (!LINK_TYPES.has(type)) {
          creates.add(index);
          createdTypes(group).set(index, type);
        }
        const dup = await findDuplicate(db, type, expanded);
        return {
          payload: { group, index, op: op.op, type, data: { ...expanded, ...taskExtras }, ...(rows ? { ingredients: rows } : {}), ...(dup ? { duplicate_of: dup.id } : {}) },
          warning: dup ? `${type} "${dup.label}" findes allerede (ref ${refOf(dup.id)}). Brug update i stedet for at oprette en dublet.` : undefined,
          action: "create",
          entity_type: type,
          entity_id: null,
        };
      }
      if (LINK_TYPES.has(type)) throw new ProposeError(index, `${type} kan kun oprettes (create).`);
      if (!op.ref) throw new ProposeError(index, "update kræver ref.");
      const target = await resolveRef(db, op.ref, [type]);
      const row = (await db.select<Row>(`SELECT * FROM ${type} WHERE id = ?`, [target.id]))[0]!;
      if (!(await canSee(db, access, type, row, hidden))) throw new ProposeError(index, "Posten er ikke tilgængelig for AI.");
      if (type === "bank_transaction") {
        const extra = Object.keys(expanded).filter((k) => k !== "category_id" && k !== "note");
        if (extra.length) throw new ProposeError(index, `bank_transaction: kun category_id og note kan ændres (ikke ${extra.join(", ")}).`);
      }
      validate(updateSchema(type as EntityType), withPh, index, type);
      return {
        payload: { group, index, op: op.op, type, target_id: target.id, data: { ...expanded, ...taskExtras }, ...(rows ? { ingredients: rows } : {}) },
        action: "update",
        entity_type: type,
        entity_id: target.id,
      };
    }

    if (op.op === "complete_task") {
      assertModule(access, "maintenance");
      if (!op.ref) throw new ProposeError(index, "complete_task kræver ref på opgaven eller forekomsten.");
      const t = await resolveRef(db, op.ref, ["task_occurrence", "task"]);
      let occId = t.id;
      if (t.type === "task") {
        const o = await db.select<{ id: string }>("SELECT id FROM task_occurrence WHERE task_id = ? AND status = 'open'", [t.id]);
        if (!o[0]) throw new ProposeError(index, "Opgaven har ingen åben forekomst.");
        occId = o[0].id;
      }
      const occ = (await db.select<Row>("SELECT o.*, t.module, t.target_type, t.target_id FROM task_occurrence o JOIN task t ON t.id = o.task_id WHERE o.id = ?", [occId]))[0]!;
      if (occ.status !== "open") throw new ProposeError(index, "Forekomsten er ikke åben.");
      if (!(await canSee(db, access, "task", occ, hidden))) throw new ProposeError(index, "Opgaven er ikke tilgængelig for AI.");
      const data = op.data ?? {};
      validate(z.object({ completed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().optional() }).strict(), data, index);
      return { payload: { group, index, op: op.op, type: "task_occurrence", target_id: occId, data }, action: "complete_task", entity_type: "task_occurrence", entity_id: occId };
    }

    // attach_document
    assertModule(access, "documents");
    const data = { ...(op.data ?? {}) };
    // The target may also be given as ref on the operation.
    if (data.target === undefined && op.ref) data.target = op.ref;
    validate(
      z
        .object({
          document: z.string().optional(),
          file_path: z.string().optional(),
          target: z.string(),
          role: fields.document_link.role,
          title: z.string().optional(),
          doc_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        })
        .strict()
        .refine((d) => Boolean(d.document) !== Boolean(d.file_path), { message: "Angiv enten document eller file_path" }),
      data,
      index,
      "attach_document",
    );
    const d = data as { document?: string; file_path?: string; target: string; role: string };
    let target: { type: string; id: string };
    if (DOLLAR.test(d.target)) {
      const n = Number(DOLLAR.exec(d.target)![1]);
      if (n >= index || !creates.has(n)) throw new ProposeError(index, `"$${n}" skal pege på en tidligere create-operation.`);
      const t = createdTypes(group).get(n);
      if (t && !ATTACHABLE.includes(t)) throw new ProposeError(index, notAttachable(t));
      target = { type: "$", id: d.target };
    } else {
      target = await resolveRef(db, d.target);
      // Validate the target type now, not first at approval (feedback: a whole group was rolled back).
      if (!ATTACHABLE.includes(target.type)) throw new ProposeError(index, notAttachable(target.type));
      const row = (await db.select<Row>(`SELECT * FROM ${target.type} WHERE id = ?`, [target.id]))[0]!;
      if (!(await canSee(db, access, target.type, row, hidden))) throw new ProposeError(index, "Målet er ikke tilgængeligt for AI.");
    }
    const payload: DraftPayload = { group, index, op: "attach_document", type: "document_link", data: { ...data, target: target.id } };
    if (target.type !== "$") payload.target_id = target.id;
    let copy: Prepared["copy"];
    if (d.document) {
      const doc = await resolveRef(db, d.document, ["document"]);
      payload.document_id = doc.id;
    } else {
      const path = d.file_path!;
      const ext = extOf(path);
      if (!(ext in MIME_BY_EXT)) throw new ProposeError(index, `Filtypen .${ext || "?"} understøttes ikke.`);
      if (!(await isAllowedImportPath(ctx, path))) {
        throw new ProposeError(index, "file_path ligger uden for de tilladte mapper (indbakke og Overførsler/Downloads). Se Indstillinger → AI-adgang.");
      }
      if (!(await ctx.env.fs.exists(path))) throw new ProposeError(index, "Filen findes ikke.");
      const rel = `indbakke/ai/${group}-${index}.${ext}`;
      payload.file = rel;
      copy = { from: path, rel };
    }
    return { payload, action: "attach_document", entity_type: target.type === "$" ? "document_link" : target.type, entity_id: target.type === "$" ? null : target.id, copy };
  } catch (e) {
    if (e instanceof ProposeError) throw e;
    throw new ProposeError(index, issues(e));
  }
}

export interface ProposeResult {
  group: string;
  n: number;
  warnings?: string[];
  /** "valid" for dry_run: everything validated, nothing stored. */
  status: "pending" | "valid";
}

/**
 * Validates every operation first; if one fails, nothing is stored and the error names its
 * index (1-based). Then inserts one ai_draft row per operation sharing payload.group.
 */
export async function proposeGroup(ctx: ProposeContext, input: unknown): Promise<ProposeResult> {
  const parsed = zPropose.safeParse(input);
  if (!parsed.success) throw new ProposeError(0, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const { ops, rationale, dry_run } = parsed.data;
  const group = ctx.env.newId();
  const creates = new Set<number>();
  const prepared: Prepared[] = [];
  // Validate every operation and report all failures at once; nothing is stored if one fails.
  const errors: string[] = [];
  for (const [i, op] of ops.entries()) {
    try {
      prepared.push(await prepareOp(ctx, op, i + 1, group, creates));
    } catch (e) {
      if (!(e instanceof ProposeError)) throw e;
      errors.push(e.message);
    }
  }
  createdTypeMaps.delete(group);
  if (errors.length) throw new ProposeError(0, errors.join("\n"));
  const warnings = prepared.flatMap((p) => (p.warning ? [`Operation ${p.payload.index}: ${p.warning}`] : []));
  if (dry_run) return { group: "", n: prepared.length, status: "valid", ...(warnings.length ? { warnings } : {}) };

  const copied: string[] = [];
  try {
    for (const p of prepared) {
      if (!p.copy) continue;
      const dest = ctx.archive.path(p.copy.rel);
      await ctx.env.fs.mkdirp(ctx.env.fs.dirname(dest));
      await ctx.env.fs.copyFile(p.copy.from, dest);
      copied.push(dest);
    }
    const now = ctx.env.clock.nowIso();
    await ctx.archive.db.transaction(async (tx) => {
      for (const p of prepared) {
        await tx.execute(
          "INSERT INTO ai_draft (id, created_at, tool, action, entity_type, entity_id, payload_json, rationale, status) VALUES (?,?,?,?,?,?,?,?, 'pending')",
          [ctx.env.newId(), now, "propose", p.action, p.entity_type, p.entity_id, JSON.stringify(p.payload), rationale],
        );
      }
    });
  } catch (e) {
    for (const c of copied) await ctx.env.fs.remove(c).catch(() => undefined);
    throw e;
  }
  return { group, n: prepared.length, status: "pending", ...(warnings.length ? { warnings } : {}) };
}

export interface DraftRow extends Row {
  id: string;
  created_at: string;
  action: DraftPayload["op"];
  entity_type: string;
  entity_id: string | null;
  status: "pending" | "approved" | "rejected" | "failed";
  rationale: string;
  payload: DraftPayload;
  result_entity_id: string | null;
  error: string | null;
}

export async function draftsOfGroup(db: DbAdapter, group: string): Promise<DraftRow[]> {
  const rows = await db.select<Row>("SELECT * FROM ai_draft WHERE json_extract(payload_json, '$.group') = ? ORDER BY json_extract(payload_json, '$.index')", [group]);
  return rows.map(toDraft);
}

export function toDraft(r: Row): DraftRow {
  const payload = JSON.parse(String(r.payload_json)) as DraftPayload;
  return { ...(r as DraftRow), payload };
}

/** draft_status: status per operation and for the group as a whole. */
export async function draftStatus(db: DbAdapter, groupRef: string): Promise<{ group: string; status: string; ops: { n: number; status: string; result?: string; error?: string }[] }> {
  let group = groupRef.trim().toLowerCase();
  if (!isUuid(group)) {
    if (!isRef(group)) throw new Error("Ugyldig gruppe.");
    const r = await db.select<{ g: string }>("SELECT DISTINCT json_extract(payload_json, '$.group') AS g FROM ai_draft WHERE json_extract(payload_json, '$.group') LIKE ?", [`${group}%`]);
    if (r.length !== 1) throw new Error(r.length ? "Gruppen er tvetydig. Brug det fulde id." : "Ingen gruppe med det id.");
    group = r[0]!.g;
  }
  const drafts = await draftsOfGroup(db, group);
  if (!drafts.length) throw new Error("Ingen gruppe med det id.");
  return { group, status: groupStatus(drafts), ops: drafts.map((d) => ({ n: d.payload.index, status: d.status, ...(d.result_entity_id ? { result: d.result_entity_id } : {}), ...(d.error ? { error: d.error } : {}) })) };
}

export function groupStatus(drafts: { status: string }[]): string {
  const s = new Set(drafts.map((d) => d.status));
  if (s.has("pending")) return "pending";
  if (s.has("failed")) return "failed";
  if (s.size === 1) return [...s][0]!;
  return "partial";
}

/**
 * The MCP tools (spec 06 "Værktøjer") as plain functions over core. The MCP server only
 * wires these to the protocol. Every call: version check, access check, ai_access_log row.
 */
import { z } from "zod";
import type { Archive } from "../archive/archive";
import type { DbAdapter } from "../db/adapter";
import { APP_SCHEMA_VERSION, getSchemaVersion } from "../db/migrate";
import type { Row } from "../domain/registry";
import type { Env } from "../env";
import { weekPlan } from "../food/mealplan";
import { encodeBase64 } from "../food/openplanner";
import { formatIngredient } from "../food/ingredients";
import { listRecipes, recipeIngredients } from "../food/recipes";
import { formatShoppingItem, listForWeek, shoppingItems } from "../food/shopping";
import { addDays } from "../recurrence/dates";
import { dashboard } from "../repo/dashboard";
import { documentRelPath, MIME_BY_EXT } from "../repo/documents";
import { budgetVsActual, monthFinance, recurringSummary } from "../repo/finance";
import { getHistory } from "../repo/modules";
import { search } from "../repo/search";
import {
  AI_MODULES,
  AiDeniedError,
  aiModuleOf,
  assertModule,
  canSee,
  documentVisible,
  hiddenHealthPersons,
  moduleDenied,
  readAiAccess,
  type AiAccess,
  type AiModule,
} from "./access";
import { compact, isRef, isUuid, listResult, refOf, resolveRef, toJson } from "./compact";
import { draftStatus, proposeGroup, type ProposeContext } from "./drafts";

export interface ToolDeps {
  env: Env;
  archive: Archive;
  clientName?: string | null;
  homeDir?: string;
  realpath?(p: string): Promise<string>;
  sep?: string;
}

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; mimeType: string; blob: string } };

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

interface Call {
  deps: ToolDeps;
  db: DbAdapter;
  access: AiAccess;
  hidden: Set<string>;
  today: string;
  refs: { type: string; id: string }[];
}

const seen = (c: Call, type: string, id: unknown) => {
  if (typeof id === "string") c.refs.push({ type, id });
};

const zLimit = z.number().int().min(1).max(100).optional();
const zYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const zRefStr = z.string().min(8).max(36);

/** Input schemas (shared by the MCP server). No field descriptions: names are self-explanatory. */
export const TOOL_INPUTS = {
  overview: {},
  search: { q: z.string().min(1), modules: z.array(z.enum(AI_MODULES)).optional(), limit: zLimit },
  get: { ref: zRefStr, fields: z.array(z.string()).optional(), offset: z.number().int().min(0).optional() },
  list: {
    type: z.string(),
    filter: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    fields: z.array(z.string()).optional(),
    limit: zLimit,
    cursor: z.string().optional(),
  },
  tasks: {
    status: z.enum(["overdue", "upcoming", "open", "done"]).optional(),
    from: zYmd.optional(),
    to: zYmd.optional(),
    module: z.string().optional(),
  },
  history: { ref: zRefStr },
  finance: { kind: z.enum(["budget", "month", "recurring"]), year: z.number().int().optional(), month: z.number().int().min(1).max(12).optional() },
  health: { person: zRefStr },
  meal_plan: { week: zYmd.optional() },
  recipes: { q: z.string().optional(), tag: z.string().optional(), limit: zLimit },
  document: { ref: zRefStr, content: z.enum(["text", "file"]).optional() },
  inbox: {},
  propose: {
    ops: z
      .array(
        z.object({
          op: z.enum(["create", "update", "complete_task", "attach_document"]),
          type: z.string().optional(),
          ref: z.string().optional(),
          data: z.record(z.unknown()).optional(),
        }),
      )
      .min(1),
    rationale: z.string().min(1),
  },
  draft_status: { group: z.string().min(8) },
} as const;

export type ToolName = keyof typeof TOOL_INPUTS;

/** English descriptions, at most 160 characters each (spec 06 krav 1). */
export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  overview: "Household dashboard: overdue/upcoming/expiring tasks, missing info, budget this month and this week's meal plan. Start here.",
  search: "Full-text search across the archive. Returns ref, type, module, title and snippet.",
  get: "One record by ref with links and the last 10 history entries. Use fields to limit output and offset for long texts.",
  list: "List records of a type with simple field=value filters and from/to on the main date. Paginated with cursor.",
  tasks: "Task occurrences by status (overdue, upcoming, open, done), date range and module.",
  history: "Work orders and completed tasks for a target (item, vehicle, property, building_part), newest first.",
  finance: "Budget vs actual per category for a year, one month's figures, or recurring expenses.",
  health: "Health overview for a person: medication, allergies, upcoming checks, recent visits and measurements.",
  meal_plan: "Meal plan for a week (Monday date): dishes, estimated price, budget, allergy warnings and shopping list.",
  recipes: "Recipes with ingredients in short form, filtered by text or tag.",
  document: "Document metadata and extracted text; content=file also returns the image or PDF itself (max 10 MB).",
  inbox: "Documents without links and files waiting in the archive's inbox folder.",
  propose: "Propose changes as one draft group (create, update, complete_task, attach_document). The user approves in the app. Use $1, $2 for earlier creates.",
  draft_status: "Status of a draft group created by propose.",
};

export const SERVER_INSTRUCTIONS =
  "Du har adgang til brugerens lokale husstandsarkiv. Start med `overview` eller `search`. Hent kun de felter, du har brug for. Du kan ikke ændre data direkte: saml ændringer i ét `propose`-kald, og fortæl brugeren, at forslaget skal godkendes i appen under AI-indbakke. Gæt ikke datoer eller beløb. Spørg hellere. Helbredsoplysninger er følsomme. Gentag kun det, der er nødvendigt.";

const text = (v: unknown): ToolResult => ({ content: [{ type: "text", text: toJson(v) }] });

// ---------- Helpers ----------

const pick = (row: Record<string, unknown>, fields?: string[]) =>
  fields?.length ? Object.fromEntries(Object.entries(row).filter(([k]) => fields.includes(k) || (k === "id" && fields.includes("ref")))) : row;

function titleOf(type: string, r: Row): string {
  return String(r.name ?? r.title ?? r.text ?? r.substance ?? r.vaccine ?? r.reason ?? r.filename ?? r.description ?? type);
}

/** Types the generic list tool supports, with their main date column for from/to. */
const LIST_TYPES: Record<string, string | null> = {
  person: null,
  contact: null,
  property: null,
  location: null,
  item: "purchase_date",
  item_part: null,
  building_part: "installed_date",
  vehicle: null,
  odometer_reading: "reading_date",
  policy: "renewal_date",
  claim: "incident_date",
  work_order: "reported_date",
  task: null,
  account: null,
  category: null,
  bank_transaction: "booking_date",
  budget: null,
  budget_line: null,
  recurring_expense: "next_date",
  health_visit: "visit_date",
  health_screening: "next_due_date",
  health_vaccination: "given_date",
  health_medication: "start_date",
  health_allergy: null,
  health_measurement: "measured_at",
  document: "doc_date",
  recipe: null,
  meal_plan_entry: "plan_date",
  shopping_list: "week_start",
  shopping_item: null,
};

async function columns(db: DbAdapter, table: string): Promise<Set<string>> {
  return new Set((await db.select<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name));
}

async function visibleRows(c: Call, type: string, rows: Row[]): Promise<Row[]> {
  const out: Row[] = [];
  for (const r of rows) if (await canSee(c.db, c.access, type, r, c.hidden)) out.push(r);
  return out;
}

async function mustSee(c: Call, ref: string, types?: string[]): Promise<{ type: string; id: string; row: Row }> {
  const t = await resolveRef(c.db, ref, types);
  if (t.type === "ai_draft") throw new Error("Brug draft_status til kladder.");
  assertModule(c.access, aiModuleOf(t.type));
  const row = (await c.db.select<Row>(`SELECT * FROM ${t.type} WHERE id = ?`, [t.id]))[0]!;
  if (!(await canSee(c.db, c.access, t.type, row, c.hidden))) {
    throw new AiDeniedError(
      t.type.startsWith("health_") || t.type === "task" ? "Helbredsoplysningerne for denne person er private." : "Posten er ikke delt med AI.",
      `hidden:${t.type}`,
    );
  }
  return { ...t, row };
}

const MAX_GET_TEXT = 4000;

// ---------- Tools ----------

async function overview(c: Call) {
  const d = await dashboard(c.db, { today: c.today, userId: c.access.asUserId });
  const mod = (m: string): AiModule => (m === "custom" ? "maintenance" : (m as AiModule));
  const tasks = (rows: typeof d.overdue) =>
    rows.filter((t) => c.access.modules.maintenance && (c.access.modules[mod(t.module)] ?? true));
  const top = (rows: typeof d.overdue) => {
    const v = tasks(rows);
    for (const t of v.slice(0, 5)) seen(c, "task", t.task_id);
    return { n: v.length, top: v.slice(0, 5).map((t) => ({ ref: refOf(t.task_id), t: t.title, due: t.due_date })) };
  };
  const out: Record<string, unknown> = { today: c.today, overdue: top(d.overdue), upcoming: top(d.upcoming), expiring: top(d.expiring) };
  const m = d.missing;
  const missing: { t: string; why: string }[] = [];
  if (c.access.modules.home) for (const i of m.itemsWithoutReceipt) missing.push({ t: i.name, why: "receipt" });
  if (c.access.modules.maintenance) for (const t of tasks(m.tasksWithoutDate)) missing.push({ t: t.title, why: "date" });
  if (c.access.modules.insurance) for (const p of m.policiesWithoutRenewal) missing.push({ t: p.title, why: "renewal" });
  if (c.access.modules.vehicle) for (const v of m.vehiclesWithoutOdometer) missing.push({ t: v.name, why: "km" });
  out.missing = { n: missing.length, top: missing.slice(0, 5) };
  out.drafts = d.aiPending;
  if (c.access.modules.finance) {
    const rows = [...d.finance.rows].sort((a, b) => b.actual - a.actual).slice(0, 5);
    out.finance = { month: c.today.slice(0, 7), top: rows.map((r) => ({ cat: r.name, budget: r.budget, actual: r.actual })), uncategorized: d.finance.uncategorized };
  }
  if (c.access.modules.food) {
    const w = await weekPlan(c.db, c.today, c.access.asUserId);
    out.meals = { week: w.week, dishes: w.entries.slice(0, 7).map((e) => `${e.plan_date.slice(5)} ${e.label}`), cost: w.cost.total_minor };
  }
  if (d.backup.due) out.backup_due = true;
  return out;
}

async function searchTool(c: Call, a: { q: string; modules?: AiModule[]; limit?: number }) {
  const allowed = AI_MODULES.filter((m) => c.access.modules[m] && (!a.modules || a.modules.includes(m)));
  if (a.modules?.length) for (const m of a.modules) if (!c.access.modules[m]) throw moduleDenied(m);
  const mods = [...allowed, ...(a.modules ? [] : (["core"] as const))];
  const hits = await search(c.db, a.q, { modules: mods as never, limit: 50 });
  const items: unknown[] = [];
  for (const h of hits) {
    const row = (await c.db.select<Row>(`SELECT * FROM ${h.type} WHERE id = ?`, [h.id]))[0];
    if (!row || !(await canSee(c.db, c.access, h.type, row, c.hidden))) continue;
    seen(c, h.type, h.id);
    items.push(compact({ id: h.id, type: h.type, module: h.module, title: h.title, snippet: h.snippet }));
  }
  return listResult(items, a.limit ?? 20);
}

async function linksOf(c: Call, type: string, id: string) {
  if (type === "document") {
    const rows = await c.db.select<Row>("SELECT target_type, target_id, role FROM document_link WHERE document_id = ?", [id]);
    const out = [];
    for (const r of rows) {
      const t = (await c.db.select<Row>(`SELECT * FROM ${String(r.target_type)} WHERE id = ?`, [String(r.target_id)]))[0];
      if (!t || !(await canSee(c.db, c.access, String(r.target_type), t, c.hidden))) continue;
      out.push({ ref: refOf(String(r.target_id)), title: titleOf(String(r.target_type), t), role: r.role });
    }
    return out;
  }
  const docs = await c.db.select<Row>(
    "SELECT d.id, d.title, d.filename, l.role FROM document_link l JOIN document d ON d.id = l.document_id WHERE l.target_type = ? AND l.target_id = ?",
    [type, id],
  );
  if (!c.access.modules.documents) return [];
  return docs.map((d) => {
    seen(c, "document", d.id);
    return { ref: refOf(String(d.id)), title: String(d.title ?? d.filename), role: d.role };
  });
}

async function getTool(c: Call, a: { ref: string; fields?: string[]; offset?: number }) {
  const { type, id, row } = await mustSee(c, a.ref);
  seen(c, type, id);
  const offset = a.offset ?? 0;
  let moreFrom: number | undefined;
  const r: Row = { ...row };
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === "string" && v.length > MAX_GET_TEXT) {
      r[k] = v.slice(offset, offset + MAX_GET_TEXT);
      if (offset + MAX_GET_TEXT < v.length) moreFrom = offset + MAX_GET_TEXT;
    } else if (typeof v === "string" && offset > 0 && (k === "extracted_text" || k === "instructions" || k === "notes")) {
      r[k] = v.slice(offset);
    }
  }
  const out: Record<string, unknown> = { type, ...(pick(r, a.fields) as Row) };
  if (type === "recipe") out.ingredients = (await recipeIngredients(c.db, id)).map((i) => formatIngredient(i));
  if (type === "task") {
    const o = await c.db.select<Row>("SELECT id, due_date FROM task_occurrence WHERE task_id = ? AND status = 'open'", [id]);
    if (o[0]) out.open = { ref: refOf(String(o[0].id)), due: o[0].due_date };
  }
  if (!a.fields?.length) {
    out.links = await linksOf(c, type, id);
    if (["property", "building_part", "item", "vehicle"].includes(type)) {
      out.history = (await getHistory(c.db, type, id)).slice(0, 10).map((h) => ({ date: h.date, t: h.title, status: h.status, cost: h.cost_minor }));
    } else {
      out.history = await c.db.select("SELECT at, action, via FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY at DESC LIMIT 10", [type, id]);
    }
  }
  if (moreFrom !== undefined) out.more_from = moreFrom;
  return compact(out, { maxText: MAX_GET_TEXT, keepTimestamps: Boolean(a.fields?.length) }) ?? {};
}

async function listTool(c: Call, a: { type: string; filter?: Record<string, unknown>; fields?: string[]; limit?: number; cursor?: string }) {
  if (!(a.type in LIST_TYPES)) throw new Error(`Ukendt type. Brug en af: ${Object.keys(LIST_TYPES).join(", ")}.`);
  assertModule(c.access, aiModuleOf(a.type));
  const cols = await columns(c.db, a.type);
  const conds: string[] = [];
  const params: (string | number | null)[] = [];
  const dateCol = LIST_TYPES[a.type];
  for (const [k, raw] of Object.entries(a.filter ?? {})) {
    if ((k === "from" || k === "to") && dateCol) {
      conds.push(`${dateCol} ${k === "from" ? ">=" : "<="} ?`);
      params.push(String(raw));
      continue;
    }
    if (!cols.has(k)) throw new Error(`Ukendt felt '${k}' på ${a.type}.`);
    let v = raw as string | number | boolean | null;
    if (typeof v === "boolean") v = v ? 1 : 0;
    if ((k.endsWith("_id") || k === "id") && isRef(v)) v = (await resolveRef(c.db, String(v))).id;
    if (v === null) conds.push(`${k} IS NULL`);
    else {
      conds.push(`${k} = ?`);
      params.push(v);
    }
  }
  if (cols.has("archived_at")) conds.push("archived_at IS NULL");
  const order = dateCol ? `${dateCol} DESC` : cols.has("name") ? "name" : cols.has("title") ? "title" : "rowid";
  const rows = await c.db.select<Row>(`SELECT * FROM ${a.type}${conds.length ? ` WHERE ${conds.join(" AND ")}` : ""} ORDER BY ${order}`, params);
  const visible = await visibleRows(c, a.type, rows);
  const res = listResult(visible, a.limit ?? 20, Number(a.cursor ?? 0) || 0);
  for (const r of res.items) seen(c, a.type, r.id);
  return { ...res, items: res.items.map((r) => compact(pick(r, a.fields))).filter(Boolean) };
}

async function tasksTool(c: Call, a: { status?: string; from?: string; to?: string; module?: string }) {
  assertModule(c.access, "maintenance");
  if (a.module && (AI_MODULES as readonly string[]).includes(a.module)) assertModule(c.access, a.module as AiModule);
  const status = a.status ?? "open";
  const conds = ["t.status = 'active'"];
  const params: (string | null)[] = [];
  if (status === "done") conds.push("o.status = 'done'");
  else conds.push("o.status = 'open'");
  const dateExpr = status === "done" ? "o.completed_date" : "o.due_date";
  if (status === "overdue") {
    conds.push("o.due_date < ?");
    params.push(c.today);
  }
  if (status === "upcoming") {
    conds.push("o.due_date >= ?", "o.due_date <= ?");
    params.push(c.today, a.to ?? addDays(c.today, 30));
  }
  if (a.from) {
    conds.push(`${dateExpr} >= ?`);
    params.push(a.from);
  }
  if (a.to && status !== "upcoming") {
    conds.push(`${dateExpr} <= ?`);
    params.push(a.to);
  }
  if (a.module) {
    conds.push("t.module = ?");
    params.push(a.module);
  }
  const rows = await c.db.select<Row>(
    `SELECT o.id AS occ, o.due_date, o.completed_date, o.status AS occ_status, t.* FROM task_occurrence o JOIN task t ON t.id = o.task_id
      WHERE ${conds.join(" AND ")} ORDER BY ${dateExpr} IS NULL, ${dateExpr} ${status === "done" ? "DESC" : ""}`,
    params,
  );
  const items = [];
  for (const r of rows) {
    if (!(await canSee(c.db, c.access, "task", r, c.hidden))) continue;
    const m = r.module === "custom" ? "maintenance" : String(r.module);
    if ((AI_MODULES as readonly string[]).includes(m) && !c.access.modules[m as AiModule]) continue;
    seen(c, "task", r.id);
    items.push(compact({ ref: refOf(String(r.occ)), task: r.id, t: r.title, module: r.module, due: r.due_date, done: r.completed_date, target: r.target_id, target_type: r.target_type }));
  }
  return listResult(items, 50);
}

async function historyTool(c: Call, a: { ref: string }) {
  const { type, id } = await mustSee(c, a.ref, ["property", "building_part", "item", "vehicle"]);
  assertModule(c.access, "maintenance");
  seen(c, type, id);
  const h = await getHistory(c.db, type, id);
  for (const e of h) seen(c, e.kind, e.id);
  return listResult(h.map((e) => compact({ ref: refOf(e.id), kind: e.kind, date: e.date, t: e.title, status: e.status, cost: e.cost_minor })), 50);
}

async function financeTool(c: Call, a: { kind: string; year?: number; month?: number }) {
  assertModule(c.access, "finance");
  const year = a.year ?? Number(c.today.slice(0, 4));
  if (a.kind === "month") {
    const ym = `${year}-${String(a.month ?? Number(c.today.slice(5, 7))).padStart(2, "0")}`;
    const f = await monthFinance(c.db, ym);
    return compact({ month: ym, rows: f.rows.map((r) => ({ cat: r.name, kind: r.kind, budget: r.budget, actual: r.actual })), uncategorized: f.uncategorized }) ?? {};
  }
  if (a.kind === "recurring") {
    const r = await recurringSummary(c.db);
    for (const i of r.items) seen(c, "recurring_expense", i.id);
    return compact({ monthly_total: r.monthly_total_minor, items: r.items.map((i) => ({ ref: i.id, name: i.name, amount: i.amount_minor, period: i.period, next: i.next_date, cat: i.category_name, binding_until: i.binding_until })) }) ?? {};
  }
  const budgets = await c.db.select<{ id: string; name: string }>("SELECT id, name FROM budget WHERE year = ? ORDER BY name", [year]);
  const out = [];
  for (const b of budgets) {
    seen(c, "budget", b.id);
    const rows = await budgetVsActual(c.db, b.id);
    const mi = a.month ? a.month - 1 : null;
    out.push({
      ref: refOf(b.id),
      name: b.name,
      rows: rows.map((r) => (mi === null ? { cat: r.name, budget: r.budget_total, actual: r.actual_total } : { cat: r.name, budget: r.budget[mi], actual: r.actual[mi] })),
    });
  }
  return compact({ year, ...(a.month ? { month: a.month } : {}), budgets: out }) ?? { year, budgets: [] };
}

async function healthTool(c: Call, a: { person: string }) {
  assertModule(c.access, "health");
  const p = await resolveRef(c.db, a.person, ["person"]);
  if (c.hidden.has(p.id)) throw new AiDeniedError("Helbredsoplysningerne for denne person er private.", "hidden:person");
  seen(c, "person", p.id);
  const q = (sql: string) => c.db.select<Row>(sql, [p.id]);
  const meds = await q("SELECT * FROM health_medication WHERE person_id = ? AND (end_date IS NULL OR end_date >= date('now')) ORDER BY name");
  const allergies = await q("SELECT * FROM health_allergy WHERE person_id = ? ORDER BY substance");
  const screenings = await q("SELECT * FROM health_screening WHERE person_id = ? AND next_due_date IS NOT NULL ORDER BY next_due_date");
  const vaccinations = await q("SELECT * FROM health_vaccination WHERE person_id = ? AND next_due_date IS NOT NULL ORDER BY next_due_date");
  const visits = await q("SELECT * FROM health_visit WHERE person_id = ? ORDER BY visit_date DESC LIMIT 10");
  const measurements = await q(
    `SELECT m.* FROM health_measurement m WHERE person_id = ? AND measured_at = (SELECT max(measured_at) FROM health_measurement x WHERE x.person_id = m.person_id AND x.type = m.type) ORDER BY type`,
  );
  for (const [t, rows] of [["health_medication", meds], ["health_allergy", allergies], ["health_screening", screenings], ["health_vaccination", vaccinations], ["health_visit", visits], ["health_measurement", measurements]] as const) {
    for (const r of rows) seen(c, t, r.id);
  }
  const strip = (rows: Row[]) => rows.map((r) => ({ ...r, person_id: undefined }));
  return compact({ person: p.id, medication: strip(meds), allergies: strip(allergies), screenings: strip(screenings), vaccinations: strip(vaccinations), visits: strip(visits), measurements: strip(measurements) }) ?? {};
}

async function mealPlanTool(c: Call, a: { week?: string }) {
  assertModule(c.access, "food");
  const w = await weekPlan(c.db, a.week ?? c.today, c.access.asUserId);
  // Allergy warnings are health data: only with the health module shared (spec 07 fase 3 nr. 3).
  const showWarnings = c.access.modules.health;
  for (const e of w.entries) seen(c, "meal_plan_entry", e.id);
  const list = await listForWeek(c.db, w.monday);
  const items = list ? await shoppingItems(c.db, String(list.id)) : [];
  if (list) seen(c, "shopping_list", list.id);
  return (
    compact({
      week: w.week,
      monday: w.monday,
      dishes: w.entries.map((e) => ({
        ref: e.id,
        date: e.plan_date,
        meal: e.meal === "dinner" ? undefined : e.meal,
        t: e.label,
        recipe: e.recipe_id,
        servings: e.servings,
        cost: e.cost_minor,
        warnings: showWarnings ? e.warnings.map((x) => x.text) : undefined,
      })),
      cost: w.cost.total_minor,
      without_price: w.cost.without_price,
      budget: w.budget.has_budget ? w.budget.budget_minor : undefined,
      spent: w.budget.actual_minor,
      ...(showWarnings ? {} : { warnings_hidden: true }),
      shopping: list ? { ref: list.id, items: items.map((i) => `${i.checked ? "[x] " : ""}${formatShoppingItem({ name: String(i.name), amount: i.amount as number | null, unit: i.unit as string | null })}`) } : undefined,
    }) ?? {}
  );
}

async function recipesTool(c: Call, a: { q?: string; tag?: string; limit?: number }) {
  assertModule(c.access, "food");
  const all = await listRecipes(c.db, { q: a.q, tag: a.tag });
  const res = listResult(all, a.limit ?? 20);
  const items = [];
  for (const r of res.items) {
    seen(c, "recipe", r.id);
    items.push(
      compact({
        ref: r.id,
        name: r.name,
        servings: r.servings === 4 ? undefined : r.servings,
        tags: r.tags,
        price: r.estimated_cost_minor,
        allergens: r.allergens,
        ingredients: (await recipeIngredients(c.db, r.id)).map((i) => formatIngredient(i)),
      }),
    );
  }
  return { ...res, items };
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;

async function documentTool(c: Call, a: { ref: string; content?: "text" | "file" }): Promise<ToolResult> {
  assertModule(c.access, "documents");
  const t = await resolveRef(c.db, a.ref, ["document"]);
  if (!(await documentVisible(c.db, c.access, t.id))) throw new AiDeniedError("Dokumentet er ikke delt med AI.", "hidden:document");
  const d = (await c.db.select<Row>("SELECT * FROM document WHERE id = ?", [t.id]))[0]!;
  seen(c, "document", t.id);
  const meta = compact(
    { id: d.id, title: d.title, filename: d.filename, mime: d.mime, size: d.size_bytes, doc_date: d.doc_date, source: d.source, links: await linksOf(c, "document", t.id), text: d.extracted_text },
    { maxText: MAX_GET_TEXT },
  );
  const content: ToolContent[] = [{ type: "text", text: toJson(meta) }];
  if (a.content === "file" && Number(d.size_bytes) <= MAX_FILE_BYTES && ["jpg", "jpeg", "png", "pdf"].includes(String(d.ext))) {
    const bytes = await c.deps.env.fs.readFile(c.deps.archive.path(documentRelPath(String(d.sha256), String(d.ext))));
    const b64 = encodeBase64(bytes);
    if (d.ext === "pdf") content.push({ type: "resource", resource: { uri: `ppm://document/${refOf(String(d.id))}`, mimeType: "application/pdf", blob: b64 } });
    else content.push({ type: "image", data: b64, mimeType: String(d.mime) });
  }
  return { content };
}

async function inboxTool(c: Call) {
  assertModule(c.access, "documents");
  const docs = await c.db.select<Row>(
    `SELECT d.* FROM document d WHERE NOT EXISTS (SELECT 1 FROM document_link l WHERE l.document_id = d.id)
       AND NOT EXISTS (SELECT 1 FROM recipe r WHERE r.photo_document_id = d.id) ORDER BY d.created_at DESC`,
  );
  for (const d of docs) seen(c, "document", d.id);
  const files: { name: string; size?: number }[] = [];
  const dir = c.deps.archive.path("indbakke");
  for (const e of await c.deps.env.fs.listDir(dir).catch(() => [])) {
    if (e.isDir || e.name.startsWith(".")) continue;
    const st = await c.deps.env.fs.stat(c.deps.env.fs.join(dir, e.name));
    files.push({ name: e.name, size: st?.size });
  }
  return compact({
    documents: docs.map((d) => ({ ref: d.id, title: d.title ?? d.filename, ext: d.ext, doc_date: d.doc_date, text: d.extracted_text ? String(d.extracted_text).slice(0, 120) : undefined })),
    files: files.map((f) => ({ ...f, supported: f.name.split(".").pop()!.toLowerCase() in MIME_BY_EXT })),
  }) ?? {};
}

// ---------- Dispatcher ----------

export class ToolError extends Error {}

async function validUserId(db: DbAdapter, id: string | null): Promise<string | null> {
  if (!id) return null;
  const r = await db.select("SELECT 1 FROM app_user WHERE id = ?", [id]);
  return r.length ? id : null;
}

/** Runs one tool call: version check, Zod validation, access control and one ai_access_log row. */
export async function runTool(deps: ToolDeps, name: string, args: unknown): Promise<ToolResult> {
  const db = deps.archive.db;
  const version = await getSchemaVersion(db);
  if (version !== APP_SCHEMA_VERSION) {
    return { isError: true, content: [{ type: "text", text: `Arkivets version (${version}) passer ikke til MCP-serveren (${APP_SCHEMA_VERSION}). Opdatér programmet.` }] };
  }
  const access = await readAiAccess(db);
  access.asUserId = await validUserId(db, access.asUserId);
  const c: Call = { deps, db, access, hidden: await hiddenHealthPersons(db, access), today: deps.env.clock.today(), refs: [] };
  let denied: string | null = null;
  let result: ToolResult;
  try {
    if (!(name in TOOL_INPUTS)) throw new ToolError(`Ukendt værktøj: ${name}`);
    const parsed = z.object(TOOL_INPUTS[name as ToolName]).strict().safeParse(args ?? {});
    if (!parsed.success) throw new ToolError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const a = parsed.data as never;
    switch (name as ToolName) {
      case "overview":
        result = text(await overview(c));
        break;
      case "search":
        result = text(await searchTool(c, a));
        break;
      case "get":
        result = text(await getTool(c, a));
        break;
      case "list":
        result = text(await listTool(c, a));
        break;
      case "tasks":
        result = text(await tasksTool(c, a));
        break;
      case "history":
        result = text(await historyTool(c, a));
        break;
      case "finance":
        result = text(await financeTool(c, a));
        break;
      case "health":
        result = text(await healthTool(c, a));
        break;
      case "meal_plan":
        result = text(await mealPlanTool(c, a));
        break;
      case "recipes":
        result = text(await recipesTool(c, a));
        break;
      case "document":
        result = await documentTool(c, a);
        break;
      case "inbox":
        result = text(await inboxTool(c));
        break;
      case "propose": {
        const pctx: ProposeContext = { env: deps.env, archive: deps.archive, access, homeDir: deps.homeDir, realpath: deps.realpath, sep: deps.sep };
        const r = await proposeGroup(pctx, a);
        result = text({ group: r.group, n: r.n, status: r.status });
        break;
      }
      case "draft_status":
        result = text(compact(await draftStatus(db, (a as { group: string }).group)));
        break;
    }
  } catch (e) {
    if (e instanceof AiDeniedError) denied = e.reason;
    result = { isError: true, content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }] };
  }
  await db.execute(
    "INSERT INTO ai_access_log (id, at, client_name, as_user_id, tool, args_json, returned_refs, denied_reason) VALUES (?,?,?,?,?,?,?,?)",
    [deps.env.newId(), deps.env.clock.nowIso(), deps.clientName ?? null, access.asUserId, name, JSON.stringify(args ?? {}), JSON.stringify(dedupeRefs(c.refs)), denied],
  );
  return result!;
}

function dedupeRefs(refs: { type: string; id: string }[]) {
  const seenKeys = new Set<string>();
  return refs.filter((r) => {
    const k = `${r.type}:${r.id}`;
    if (seenKeys.has(k) || !isUuid(r.id)) return false;
    seenKeys.add(k);
    return true;
  });
}

export const TOOL_NAMES = Object.keys(TOOL_INPUTS) as ToolName[];

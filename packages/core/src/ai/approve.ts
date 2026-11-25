/**
 * Approval of AI draft groups in the app (spec 06 "Godkendelse i appen" and "Kladdegrupper").
 * Approved operations run through core in one transaction with audit_log.via = 'ai_draft'.
 */
import type { Archive } from "../archive/archive";
import type { DbAdapter } from "../db/adapter";
import type { Row } from "../domain/registry";
import { createSchema, updateSchema, type EntityType } from "../domain/schemas";
import type { Env } from "../env";
import { planMeal } from "../food/mealplan";
import { createRecipe, updateRecipe } from "../food/recipes";
import { importDocument, linkDocument } from "../repo/documents";
import { createEntity, getEntity, parseOrThrow, updateEntity, withDb, writeAudit, type Ctx } from "../repo/entities";
import { completeOccurrence, createTask, parseRecurrence } from "../repo/tasks";
import { groupStatus, toDraft, type DraftPayload, type DraftRow } from "./drafts";

export interface DraftGroup {
  group: string;
  created_at: string;
  rationale: string;
  status: string;
  drafts: DraftRow[];
}

/** Draft groups, newest first. Drafts without a group (older format) form a group of one. */
export async function listDraftGroups(db: DbAdapter, opts: { status?: "pending" | "all" } = {}): Promise<DraftGroup[]> {
  const rows = (await db.select<Row>("SELECT * FROM ai_draft ORDER BY created_at DESC, rowid DESC")).map(toDraft);
  const groups = new Map<string, DraftRow[]>();
  for (const d of rows) {
    const g = d.payload.group ?? d.id;
    groups.set(g, [...(groups.get(g) ?? []), d]);
  }
  const out = [...groups.entries()].map(([group, drafts]) => {
    drafts.sort((a, b) => a.payload.index - b.payload.index);
    return { group, created_at: drafts[0]!.created_at, rationale: drafts[0]!.rationale, status: groupStatus(drafts), drafts };
  });
  return opts.status === "pending" ? out.filter((g) => g.status === "pending") : out;
}

export const pendingDraftGroupCount = async (db: DbAdapter) => (await listDraftGroups(db, { status: "pending" })).length;

export interface Conflict {
  draft_id: string;
  index: number;
  type: string;
  target_id: string;
  updated_at: string;
}

/** Update drafts whose target changed after the draft was created (spec 06). */
export async function draftConflicts(db: DbAdapter, drafts: DraftRow[]): Promise<Conflict[]> {
  const out: Conflict[] = [];
  for (const d of drafts) {
    if (d.action !== "update" || !d.entity_id) continue;
    const row = await getEntity(db, d.entity_type as EntityType, d.entity_id);
    if (row && typeof row.updated_at === "string" && row.updated_at > d.created_at) {
      out.push({ draft_id: d.id, index: d.payload.index, type: d.entity_type, target_id: d.entity_id, updated_at: row.updated_at });
    }
  }
  return out;
}

export class ConflictError extends Error {
  constructor(readonly conflicts: Conflict[]) {
    super(`${conflicts.length} ${conflicts.length === 1 ? "post er" : "poster er"} ændret, siden forslaget blev lavet. Bekræft for at fortsætte.`);
    this.name = "ConflictError";
  }
}

const DOLLAR = /^\$(\d+)$/;

function resolveDollars(data: Record<string, unknown>, results: Map<number, string>, index: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    const m = typeof v === "string" ? DOLLAR.exec(v) : null;
    if (m) {
      const id = results.get(Number(m[1]));
      if (!id) throw new Error(`Operation ${index}: "$${m[1]}" er ikke godkendt i samme omgang.`);
      out[k] = id;
    } else out[k] = v;
  }
  return out;
}

async function execute(env: Env, archive: Archive, ctx: Ctx, d: DraftRow, results: Map<number, string>): Promise<string | null> {
  const p = d.payload;
  const data = resolveDollars(p.data ?? {}, results, p.index);
  switch (p.op) {
    case "create": {
      if (p.type === "recipe") return String((await createRecipe(ctx, data as never, (p.ingredients ?? []) as never)).id);
      if (p.type === "meal_plan_entry") return String((await planMeal(ctx, data as never)).id);
      if (p.type === "task") {
        const { recurrence_json, ...rest } = data as Record<string, unknown>;
        return String((await createTask(ctx, { ...rest, source: "ai", recurrence: parseRecurrence(recurrence_json) } as never)).task.id);
      }
      if (p.type === "shopping_item" && data.position === undefined) {
        const r = await ctx.db.select<{ p: number | null }>("SELECT max(position) AS p FROM shopping_item WHERE list_id = ?", [String(data.list_id)]);
        data.position = (r[0]?.p ?? -1) + 1;
        data.source ??= "ai";
      }
      if (p.type === "odometer_reading") data.source ??= "ai";
      return String((await createEntity(ctx, p.type as EntityType, data as never)).id);
    }
    case "update": {
      const id = p.target_id!;
      if (p.type === "recipe") return String((await updateRecipe(ctx, id, data as never, p.ingredients as never)).id);
      if (p.type === "bank_transaction" && "category_id" in data) data.category_source = "ai";
      return String((await updateEntity(ctx, p.type as EntityType, id, data as never)).id);
    }
    case "complete_task": {
      const r = await completeOccurrence(ctx, p.target_id!, { completedDate: String(data.completed_date), note: (data.note as string | undefined) ?? null });
      return String(r.completed.id);
    }
    case "attach_document": {
      const targetRaw = String(data.target);
      const targetId = DOLLAR.test(targetRaw) ? resolveDollars({ t: targetRaw }, results, p.index).t as string : targetRaw;
      const target = await findType(ctx.db, targetId);
      let documentId = p.document_id;
      if (!documentId && p.file) {
        const src = archive.path(p.file);
        const r = await importDocument(env, archive, ctx, src, {
          source: "ai",
          filename: String((data.file_path as string | undefined)?.split(/[\\/]/).pop() ?? p.file.split("/").pop()),
          title: (data.title as string | undefined) ?? null,
          docDate: (data.doc_date as string | undefined) ?? null,
        });
        documentId = String(r.document.id);
      }
      await linkDocument(ctx, { document_id: documentId!, target_type: target as never, target_id: targetId, role: data.role as never });
      return documentId!;
    }
  }
}

async function findType(db: DbAdapter, id: string): Promise<string> {
  const types = ["property", "location", "item", "item_part", "building_part", "vehicle", "work_order", "claim", "policy", "person", "health_visit", "health_screening", "health_vaccination", "health_medication", "bank_transaction", "task_occurrence", "recurring_expense"];
  for (const t of types) if ((await db.select(`SELECT 1 FROM ${t} WHERE id = ?`, [id])).length) return t;
  throw new Error("Målet kan ikke få bilag koblet på.");
}

async function setStatus(ctx: Ctx, d: DraftRow, status: DraftRow["status"], extra: { result?: string | null; error?: string | null } = {}) {
  const now = ctx.clock.nowIso();
  await ctx.db.execute("UPDATE ai_draft SET status = ?, decided_at = ?, decided_by = ?, result_entity_id = ?, error = ? WHERE id = ?", [
    status,
    now,
    ctx.userId,
    extra.result ?? null,
    extra.error ?? null,
    d.id,
  ]);
  // Decisions on drafts are audited as app actions (spec 03).
  await writeAudit({ ...ctx, via: "ui" }, "ai_draft", d.id, "update", { status: [d.status, status], ...(extra.error ? { error: [null, extra.error] } : {}) });
}

export interface ApproveOptions {
  /** Approve only these draft ids ("Godkend valgte"). Default: all pending in the group. */
  only?: string[];
  /** Set after the user confirmed the conflict warning. */
  confirmConflicts?: boolean;
}

export interface ApproveResult {
  approved: number;
  results: { draft_id: string; index: number; result: string | null }[];
}

/**
 * Approves pending drafts of a group in one transaction. If one fails, everything is rolled
 * back and the selected drafts are marked failed with the error (spec 06).
 */
export async function approveGroup(env: Env, archive: Archive, uiCtx: Ctx, group: string, opts: ApproveOptions = {}): Promise<ApproveResult> {
  const all = (await listDraftGroups(archive.db)).find((g) => g.group === group);
  if (!all) throw new Error("Gruppen findes ikke.");
  const selected = all.drafts.filter((d) => d.status === "pending" && (!opts.only || opts.only.includes(d.id)));
  if (selected.length === 0) throw new Error("Der er ingen ventende forslag at godkende.");
  const conflicts = await draftConflicts(archive.db, selected);
  if (conflicts.length && !opts.confirmConflicts) throw new ConflictError(conflicts);
  // Earlier approved creates in the group can be referenced by $n.
  const results = new Map<number, string>();
  for (const d of all.drafts) if (d.status === "approved" && d.result_entity_id) results.set(d.payload.index, d.result_entity_id);
  const ctx: Ctx = { ...uiCtx, via: "ai_draft" };
  const out: ApproveResult = { approved: 0, results: [] };
  let failedAt: DraftRow | null = null;
  try {
    await archive.db.transaction(async (tx) => {
      const c = withDb(ctx, tx);
      for (const d of selected) {
        failedAt = d;
        const id = await execute(env, archive, c, d, results);
        if (id) results.set(d.payload.index, id);
        await setStatus(c, d, "approved", { result: id });
        out.results.push({ draft_id: d.id, index: d.payload.index, result: id });
      }
      failedAt = null;
    });
  } catch (e) {
    const msg = `Operation ${(failedAt as DraftRow | null)?.payload.index ?? "?"}: ${e instanceof Error ? e.message : String(e)}`;
    await archive.db.transaction(async (tx) => {
      for (const d of selected) await setStatus(withDb(uiCtx, tx), d, "failed", { error: msg });
    });
    throw new Error(`Godkendelsen blev rullet tilbage. ${msg}`);
  }
  // Imported files are now attachments; remove the copies from indbakke/ai/.
  for (const d of selected) if (d.payload.file) await env.fs.remove(archive.path(d.payload.file)).catch(() => undefined);
  out.approved = selected.length;
  return out;
}

/** "Afvis alle": rejects pending drafts of the group and deletes their files in indbakke/ai/. */
export async function rejectGroup(env: Env, archive: Archive, ctx: Ctx, group: string): Promise<number> {
  const g = (await listDraftGroups(archive.db)).find((x) => x.group === group);
  if (!g) throw new Error("Gruppen findes ikke.");
  const pending = g.drafts.filter((d) => d.status === "pending");
  await archive.db.transaction(async (tx) => {
    for (const d of pending) await setStatus(withDb(ctx, tx), d, "rejected");
  });
  for (const d of pending) if (d.payload.file) await env.fs.remove(archive.path(d.payload.file)).catch(() => undefined);
  return pending.length;
}

/** "Redigér": replaces the data of a pending create/update draft after validating it with the shared schema. */
export async function editDraft(ctx: Ctx, draftId: string, data: Record<string, unknown>, ingredients?: unknown[]): Promise<DraftRow> {
  const row = (await ctx.db.select<Row>("SELECT * FROM ai_draft WHERE id = ?", [draftId]))[0];
  if (!row) throw new Error("Forslaget findes ikke.");
  const d = toDraft(row);
  if (d.status !== "pending") throw new Error("Kun ventende forslag kan redigeres.");
  const p: DraftPayload = { ...d.payload, data };
  if (ingredients) p.ingredients = ingredients;
  if (p.op === "create" || p.op === "update") {
    const check = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typeof v === "string" && DOLLAR.test(v) ? "00000000-0000-4000-8000-000000000000" : v]));
    parseOrThrow(p.op === "create" ? createSchema(p.type as EntityType) : updateSchema(p.type as EntityType), check, p.type);
  }
  await ctx.db.transaction(async (tx) => {
    await tx.execute("UPDATE ai_draft SET payload_json = ? WHERE id = ?", [JSON.stringify(p), draftId]);
    await writeAudit({ ...ctx, db: tx, via: "ui" }, "ai_draft", draftId, "update", { payload_json: [d.payload.data, data] });
  });
  return { ...d, payload: p };
}

/** Danish names of the types AI can propose (the UI is in Danish). */
export const DRAFT_TYPE_LABELS: Record<string, string> = {
  person: "person",
  property: "bolig",
  item: "genstand",
  item_part: "reservedel",
  building_part: "bygningsdel",
  location: "rum",
  contact: "kontakt",
  vehicle: "bil",
  odometer_reading: "km-stand",
  work_order: "arbejdsordre",
  task: "opgave",
  policy: "police",
  claim: "skadesag",
  bank_transaction: "postering",
  recurring_expense: "fast udgift",
  budget_line: "budgetlinje",
  health_visit: "lægebesøg",
  health_screening: "screening",
  health_vaccination: "vaccination",
  health_medication: "medicin",
  health_allergy: "allergi",
  health_measurement: "måling",
  recipe: "opskrift",
  meal_plan_entry: "ret i madplanen",
  shopping_item: "vare på indkøbslisten",
};

const ROLE_LABELS: Record<string, string> = {
  receipt: "kvittering",
  invoice: "faktura",
  quote: "tilbud",
  photo: "foto",
  photo_before: "foto før",
  photo_after: "foto efter",
  manual: "manual",
  policy_terms: "policevilkår",
  report: "rapport",
  letter: "brev",
  other: "andet",
};

const typeLabel = (t: string) => DRAFT_TYPE_LABELS[t] ?? t;

/** Human-readable one-line summary of an operation for the inbox. */
export function describeDraft(d: DraftRow): string {
  const p = d.payload;
  const data = p.data ?? {};
  const name = String(data.name ?? data.title ?? data.text ?? data.substance ?? data.vaccine ?? "");
  switch (p.op) {
    case "create":
      if (p.type === "meal_plan_entry") return `Planlæg ret ${String(data.plan_date ?? "")}${name ? `: ${name}` : ""}`;
      return `Opret ${typeLabel(p.type)}${name ? `: ${name}` : ""}`;
    case "update":
      return `Ret ${typeLabel(p.type)}: ${Object.keys(data).join(", ")}`;
    case "complete_task":
      return `Marker opgave udført ${String(data.completed_date ?? "")}`;
    case "attach_document": {
      const role = ROLE_LABELS[String(data.role)] ?? String(data.role ?? "");
      const file = p.file ? String(data.file_path ?? "").split(/[\\/]/).pop() : "eksisterende dokument";
      return `Kobl ${role}: ${file}`;
    }
  }
}

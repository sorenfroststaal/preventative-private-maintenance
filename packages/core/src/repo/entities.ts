import { z } from "zod";
import type { DbAdapter, SqlValue } from "../db/adapter";
import type { Clock } from "../env";
import { createSchema, fields, updateSchema, type EntityInput, type EntityType } from "../domain/schemas";
import { registry, type Row } from "../domain/registry";

export type Via = "ui" | "ai_draft" | "import" | "system";

/** Everything a write needs: the db (or transaction), who is writing and how. */
export interface Ctx {
  db: DbAdapter;
  clock: Clock;
  newId(): string;
  userId: string | null;
  via: Via;
}

export const withDb = (ctx: Ctx, db: DbAdapter): Ctx => ({ ...ctx, db });

export class ValidationError extends Error {
  constructor(
    readonly issues: { path: string; message: string }[],
    readonly entityType?: string,
  ) {
    super(issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; "));
    this.name = "ValidationError";
  }
  static fromZod(err: z.ZodError, entityType?: string) {
    return new ValidationError(
      err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      entityType,
    );
  }
}

export class NotFoundError extends Error {
  constructor(readonly entityType: string, readonly id: string) {
    super(`${entityType} ${id} findes ikke`);
    this.name = "NotFoundError";
  }
}

export function parseOrThrow<S extends z.ZodTypeAny>(schema: S, input: unknown, entityType?: string): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw ValidationError.fromZod(r.error, entityType);
  return r.data;
}

/** Hooks for derived rules (spec 03), run inside the write transaction. */
export type AfterWriteHook = (ctx: Ctx, row: Row, action: "create" | "update" | "archive" | "restore") => Promise<void>;
const afterWriteHooks = new Map<EntityType, AfterWriteHook[]>();
export function registerAfterWrite(type: EntityType, hook: AfterWriteHook) {
  afterWriteHooks.set(type, [...(afterWriteHooks.get(type) ?? []), hook]);
}

const columnsOf = (type: EntityType) => Object.keys(fields[type]);

export function entityKey(type: EntityType, row: Row): string {
  return registry[type].pk.map((k) => String(row[k])).join(":");
}

function toSql(v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "string") return v;
  return JSON.stringify(v);
}

/** Fields whose values must never be written to audit_log (only that they changed). */
const SECRET_FIELDS = new Set(["pin_hash"]);
const REDACTED = "[skjult]";

function redact(diff: Record<string, [unknown, unknown]>): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const [k, [before, after]] of Object.entries(diff)) {
    out[k] = SECRET_FIELDS.has(k)
      ? [before == null ? null : REDACTED, after == null ? null : REDACTED]
      : [before, after];
  }
  return out;
}

export async function writeAudit(
  ctx: Ctx,
  entityType: string,
  entityId: string,
  action: "create" | "update" | "archive" | "restore" | "delete",
  diff: Record<string, [unknown, unknown]> | null,
): Promise<void> {
  await ctx.db.execute(
    "INSERT INTO audit_log (id, at, user_id, via, entity_type, entity_id, action, diff_json) VALUES (?,?,?,?,?,?,?,?)",
    [ctx.newId(), ctx.clock.nowIso(), ctx.userId, ctx.via, entityType, entityId, action, diff ? JSON.stringify(redact(diff)) : null],
  );
}

export async function reindex(db: DbAdapter, type: EntityType, row: Row): Promise<void> {
  const meta = registry[type];
  if (!meta.search) return;
  const id = String(row.id);
  await db.execute("DELETE FROM search_index WHERE entity_type = ? AND entity_id = ?", [type, id]);
  if (meta.archivable && row.archived_at) return;
  await db.execute(
    "INSERT INTO search_index (entity_type, entity_id, module, title, body) VALUES (?,?,?,?,?)",
    [type, id, meta.module, meta.search.title(row), await meta.search.body(row, db)],
  );
}

async function runHooks(ctx: Ctx, type: EntityType, row: Row, action: "create" | "update" | "archive" | "restore") {
  for (const h of afterWriteHooks.get(type) ?? []) await h(ctx, row, action);
}

export async function getEntity<T extends Row = Row>(db: DbAdapter, type: EntityType, id: string): Promise<T | null> {
  const r = await db.select<T>(`SELECT * FROM ${type} WHERE id = ?`, [id]);
  return r[0] ?? null;
}

export async function mustGet<T extends Row = Row>(db: DbAdapter, type: EntityType, id: string): Promise<T> {
  const r = await getEntity<T>(db, type, id);
  if (!r) throw new NotFoundError(type, id);
  return r;
}

export interface ListOptions {
  where?: Record<string, SqlValue>;
  includeArchived?: boolean;
  orderBy?: string;
  desc?: boolean;
  limit?: number;
}

export async function listEntities<T extends Row = Row>(
  db: DbAdapter,
  type: EntityType,
  opts: ListOptions = {},
): Promise<T[]> {
  const cols = new Set([...columnsOf(type), "id", "created_at", "updated_at", "archived_at"]);
  const conds: string[] = [];
  const params: SqlValue[] = [];
  for (const [k, v] of Object.entries(opts.where ?? {})) {
    if (!cols.has(k)) throw new Error(`Unknown column ${type}.${k}`);
    if (v === null) conds.push(`${k} IS NULL`);
    else {
      conds.push(`${k} = ?`);
      params.push(v);
    }
  }
  if (registry[type].archivable && !opts.includeArchived) conds.push("archived_at IS NULL");
  let sql = `SELECT * FROM ${type}`;
  if (conds.length) sql += ` WHERE ${conds.join(" AND ")}`;
  if (opts.orderBy) {
    if (!cols.has(opts.orderBy)) throw new Error(`Unknown column ${type}.${opts.orderBy}`);
    sql += ` ORDER BY ${opts.orderBy}${opts.desc ? " DESC" : ""}`;
  }
  if (opts.limit) sql += ` LIMIT ${Math.max(1, Math.floor(opts.limit))}`;
  return db.select<T>(sql, params);
}

/** Creates an entity: validate, insert, audit, reindex, derived rules (spec 03). */
export async function createEntity<T extends EntityType>(
  ctx: Ctx,
  type: T,
  input: EntityInput<T>,
  opts: { id?: string } = {},
): Promise<Row> {
  const parsed = parseOrThrow(createSchema(type), input, type) as Row;
  const meta = registry[type];
  return ctx.db.transaction(async (tx) => {
    const c = withDb(ctx, tx);
    const now = ctx.clock.nowIso();
    const row: Row = {};
    if (meta.pk.length === 1) row.id = opts.id ?? ctx.newId();
    for (const k of columnsOf(type)) row[k] = parsed[k] ?? null;
    if (meta.createdAt) row.created_at = now;
    if (meta.updatedAt) row.updated_at = now;
    const keys = Object.keys(row);
    await tx.execute(
      `INSERT INTO ${type} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
      keys.map((k) => toSql(row[k])),
    );
    const diff: Record<string, [unknown, unknown]> = {};
    for (const k of columnsOf(type)) if (row[k] !== null) diff[k] = [null, row[k]];
    await writeAudit(c, type, entityKey(type, row), "create", diff);
    if (meta.pk.length === 1) {
      const stored = await mustGet(tx, type, String(row.id));
      await reindex(tx, type, stored);
      await runHooks(c, type, stored, "create");
      return stored;
    }
    return row;
  });
}

/** Updates selected fields. Only changed fields are audited. */
export async function updateEntity<T extends EntityType>(
  ctx: Ctx,
  type: T,
  id: string,
  changes: Partial<EntityInput<T>>,
): Promise<Row> {
  const parsed = parseOrThrow(updateSchema(type), changes, type) as Row;
  const meta = registry[type];
  return ctx.db.transaction(async (tx) => {
    const c = withDb(ctx, tx);
    const before = await mustGet(tx, type, id);
    const diff: Record<string, [unknown, unknown]> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v === undefined) continue;
      const next = v ?? null;
      if (before[k] !== next) diff[k] = [before[k], next];
    }
    if (Object.keys(diff).length === 0) return before;
    const sets = Object.keys(diff);
    const params = sets.map((k) => toSql(diff[k]![1]));
    let sql = `UPDATE ${type} SET ${sets.map((k) => `${k} = ?`).join(", ")}`;
    if (meta.updatedAt) {
      sql += ", updated_at = ?";
      params.push(ctx.clock.nowIso());
    }
    await tx.execute(`${sql} WHERE id = ?`, [...params, id]);
    await writeAudit(c, type, id, "update", diff);
    const after = await mustGet(tx, type, id);
    await reindex(tx, type, after);
    await runHooks(c, type, after, "update");
    return after;
  });
}

async function setArchived(ctx: Ctx, type: EntityType, id: string, archived: boolean): Promise<Row> {
  if (!registry[type].archivable) throw new Error(`${type} kan ikke arkiveres`);
  return ctx.db.transaction(async (tx) => {
    const c = withDb(ctx, tx);
    const before = await mustGet(tx, type, id);
    if (Boolean(before.archived_at) === archived) return before;
    const value = archived ? ctx.clock.nowIso() : null;
    await tx.execute(`UPDATE ${type} SET archived_at = ? WHERE id = ?`, [value, id]);
    await writeAudit(c, type, id, archived ? "archive" : "restore", {
      archived_at: [before.archived_at ?? null, value],
    });
    const after = await mustGet(tx, type, id);
    await reindex(tx, type, after);
    await runHooks(c, type, after, archived ? "archive" : "restore");
    return after;
  });
}

export const archiveEntity = (ctx: Ctx, type: EntityType, id: string) => setArchived(ctx, type, id, true);
export const restoreEntity = (ctx: Ctx, type: EntityType, id: string) => setArchived(ctx, type, id, false);

/** Physically deletes a link row (only link tables and drafts may be deleted, spec README). */
export async function deleteLink(ctx: Ctx, type: EntityType, key: Row): Promise<boolean> {
  const meta = registry[type];
  if (meta.pk.length === 1) throw new Error(`${type} må ikke slettes; arkivér i stedet`);
  return ctx.db.transaction(async (tx) => {
    const where = meta.pk.map((k) => `${k} = ?`).join(" AND ");
    const params = meta.pk.map((k) => toSql(key[k]));
    const existing = await tx.select<Row>(`SELECT * FROM ${type} WHERE ${where}`, params);
    if (!existing[0]) return false;
    await tx.execute(`DELETE FROM ${type} WHERE ${where}`, params);
    const diff: Record<string, [unknown, unknown]> = {};
    for (const [k, v] of Object.entries(existing[0])) diff[k] = [v, null];
    await writeAudit(withDb(ctx, tx), type, entityKey(type, existing[0]), "delete", diff);
    return true;
  });
}

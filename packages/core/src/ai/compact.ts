/** Compact, token-efficient output and short references (spec 06 "Få tokens"). */
import type { DbAdapter } from "../db/adapter";
import { registry } from "../domain/registry";
import { ENTITY_TYPES, type EntityType } from "../domain/schemas";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF = /^[0-9a-f]{8}$/i;

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
export const isRef = (v: unknown): v is string => typeof v === "string" && REF.test(v);

/** `ref` = the first 8 hex characters of the id (the id without dashes starts with them). */
export const refOf = (id: string) => id.replace(/-/g, "").slice(0, 8).toLowerCase();

/** Fields that are never worth sending (defaults, bookkeeping). */
const DROP_VALUES: Record<string, unknown> = { currency: "DKK", archived_at: null };
const DROP_KEYS = new Set(["created_at", "updated_at", "dedupe_hash", "sha256", "pin_hash", "search_index"]);

/**
 * Removes null, empty and default values recursively, turns UUIDs into refs and
 * truncates long texts. `id` becomes `ref`.
 */
export function compact(value: unknown, opts: { maxText?: number; keepTimestamps?: boolean } = {}): unknown {
  const max = opts.maxText ?? 300;
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    if (value === "") return undefined;
    if (UUID.test(value)) return refOf(value);
    return value.length > max ? `${value.slice(0, max)}…` : value;
  }
  if (Array.isArray(value)) {
    const out = value.map((v) => compact(v, opts)).filter((v) => v !== undefined);
    return out.length ? out : undefined;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!opts.keepTimestamps && DROP_KEYS.has(k)) continue;
      if (k in DROP_VALUES && DROP_VALUES[k] === v) continue;
      const c = compact(v, opts);
      if (c === undefined) continue;
      out[k === "id" ? "ref" : k] = c;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value;
}

/** JSON without whitespace (spec 06 krav 2). */
export const toJson = (v: unknown) => JSON.stringify(v ?? {});

export interface ListResult<T> {
  n: number;
  items: T[];
  more: boolean;
}

export function listResult<T>(all: T[], limit: number, offset = 0): ListResult<T> & { cursor?: string } {
  const items = all.slice(offset, offset + limit);
  const more = offset + limit < all.length;
  return { n: all.length, items, more, ...(more ? { cursor: String(offset + limit) } : {}) };
}

export class RefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefError";
  }
}

/** Tables a ref can point at: every entity with a single `id` key, plus drafts. */
const REF_TABLES: string[] = [...ENTITY_TYPES.filter((t) => registry[t as EntityType].pk.length === 1), "ai_draft"];

export interface Resolved {
  type: string;
  id: string;
}

/**
 * Resolves a ref (8 hex) or a full id to {type, id}. An ambiguous ref fails with the
 * candidates (spec 06 krav 3). `types` limits the tables searched.
 */
export async function resolveRef(db: DbAdapter, ref: string, types?: string[]): Promise<Resolved> {
  const r = ref.trim().toLowerCase();
  if (!isRef(r) && !isUuid(r)) throw new RefError(`Ugyldig ref '${ref}'. Brug de 8 tegn fra 'ref' eller det fulde id.`);
  const tables = types?.length ? REF_TABLES.filter((t) => types.includes(t)) : REF_TABLES;
  const found: Resolved[] = [];
  for (const t of tables) {
    const rows = isUuid(r)
      ? await db.select<{ id: string }>(`SELECT id FROM ${t} WHERE id = ?`, [r])
      : await db.select<{ id: string }>(`SELECT id FROM ${t} WHERE id LIKE ? LIMIT 5`, [`${r}%`]);
    for (const row of rows) found.push({ type: t, id: row.id });
  }
  if (found.length === 0) throw new RefError(`Ingen post med ref '${ref}'.`);
  if (found.length > 1) {
    throw new RefError(`Ref '${ref}' er tvetydig: ${found.map((f) => `${f.type}:${f.id}`).join(", ")}. Brug det fulde id.`);
  }
  return found[0]!;
}

/** Replaces refs in *_id fields of `data` with full ids (proposals from AI use refs). */
export async function expandRefs(db: DbAdapter, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...data };
  for (const [k, v] of Object.entries(data)) {
    if ((k.endsWith("_id") || k === "id") && isRef(v)) out[k] = (await resolveRef(db, v)).id;
  }
  return out;
}

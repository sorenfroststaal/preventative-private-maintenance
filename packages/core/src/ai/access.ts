/** AI access control (spec 06 "Adgangskontrol"): modules shared with AI and the user AI acts as. */
import type { DbAdapter } from "../db/adapter";
import { registry, type Row } from "../domain/registry";
import type { EntityType } from "../domain/schemas";
import { getSetting } from "../repo/settings";

export const AI_MODULES = ["home", "maintenance", "vehicle", "finance", "insurance", "health", "documents", "food"] as const;
export type AiModule = (typeof AI_MODULES)[number];

export const AI_MODULE_LABELS: Record<AiModule, string> = {
  home: "Bolig og inventar",
  maintenance: "Vedligehold og opgaver",
  vehicle: "Bil",
  finance: "Økonomi",
  insurance: "Forsikring",
  health: "Helbred",
  documents: "Dokumenter",
  food: "Madplan",
};

export interface AiAccess {
  modules: Record<AiModule, boolean>;
  asUserId: string | null;
}

const DEFAULT_MODULES: Record<AiModule, boolean> = {
  home: true,
  maintenance: true,
  vehicle: true,
  finance: true,
  insurance: true,
  health: false,
  documents: true,
  food: true,
};

/** Read on every call so changes in the app take effect immediately (spec 06). */
export async function readAiAccess(db: DbAdapter): Promise<AiAccess> {
  const stored = (await getSetting<Partial<Record<AiModule, boolean>>>(db, "ai.modules")) ?? {};
  const modules = { ...DEFAULT_MODULES };
  for (const m of AI_MODULES) if (typeof stored[m] === "boolean") modules[m] = stored[m]!;
  const asUserId = (await getSetting<string | null>(db, "ai.as_user_id")) ?? null;
  return { modules, asUserId };
}

export class AiDeniedError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = "AiDeniedError";
  }
}

export const moduleDenied = (m: string) =>
  new AiDeniedError(`Modulet '${m}' er ikke delt med AI. Det kan slås til i Indstillinger → AI-adgang.`, `module:${m}`);

/** The AI module of an entity type, or null for types that are always visible (persons, contacts). */
export function aiModuleOf(type: string): AiModule | null {
  const meta = registry[type as EntityType];
  if (!meta) return null;
  return (AI_MODULES as readonly string[]).includes(meta.module) ? (meta.module as AiModule) : null;
}

export function assertModule(access: AiAccess, m: AiModule | null) {
  if (m && !access.modules[m]) throw moduleDenied(m);
}

/** Person ids whose health data the AI user may not see. */
export async function hiddenHealthPersons(db: DbAdapter, access: AiAccess): Promise<Set<string>> {
  const rows = await db.select<{ id: string }>(
    "SELECT id FROM person WHERE health_private_user_id IS NOT NULL AND health_private_user_id IS NOT ?",
    [access.asUserId],
  );
  return new Set(rows.map((r) => r.id));
}

/**
 * Whether a single row may be shown: module shared, health privacy respected, and for
 * documents at least one link in a shared module (or no links at all).
 */
export async function canSee(db: DbAdapter, access: AiAccess, type: string, row: Row, hidden?: Set<string>): Promise<boolean> {
  const m = aiModuleOf(type);
  if (m && !access.modules[m]) return false;
  const priv = hidden ?? (await hiddenHealthPersons(db, access));
  if (type.startsWith("health_") && priv.has(String(row.person_id))) return false;
  if (type === "task") {
    if (row.module === "health" && !access.modules.health) return false;
    if (row.target_type === "person" && row.module === "health" && priv.has(String(row.target_id))) return false;
  }
  if (type === "document") return documentVisible(db, access, String(row.id));
  return true;
}

/** Document visibility (spec 06): `documents` and the module of at least one link, or no links. */
export async function documentVisible(db: DbAdapter, access: AiAccess, documentId: string): Promise<boolean> {
  if (!access.modules.documents) return false;
  const links = await db.select<{ target_type: string; target_id: string }>(
    "SELECT target_type, target_id FROM document_link WHERE document_id = ?",
    [documentId],
  );
  const photo = await db.select<{ n: number }>("SELECT count(*) AS n FROM recipe WHERE photo_document_id = ?", [documentId]);
  if (photo[0]?.n) links.push({ target_type: "recipe", target_id: "" });
  if (links.length === 0) return true;
  const priv = await hiddenHealthPersons(db, access);
  for (const l of links) {
    const m = aiModuleOf(l.target_type);
    if (m && !access.modules[m]) continue;
    if (l.target_type.startsWith("health_")) {
      const r = await db.select<{ person_id: string }>(`SELECT person_id FROM ${l.target_type} WHERE id = ?`, [l.target_id]);
      if (r[0] && priv.has(r[0].person_id)) continue;
    }
    return true;
  }
  return false;
}

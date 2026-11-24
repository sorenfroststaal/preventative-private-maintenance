import type { DbAdapter } from "../db/adapter";
import type { Env } from "../env";
import { createEntity, type Ctx } from "../repo/entities";
import { DEFAULT_SETTINGS, setSetting } from "../repo/settings";

/** Standard categories (spec 04). */
export const DEFAULT_CATEGORIES: { name: string; kind: "expense" | "income" | "transfer" }[] = [
  { name: "Bolig", kind: "expense" },
  { name: "Forsyning", kind: "expense" },
  { name: "Mad og dagligvarer", kind: "expense" },
  { name: "Transport", kind: "expense" },
  { name: "Forsikring", kind: "expense" },
  { name: "Børn", kind: "expense" },
  { name: "Sundhed", kind: "expense" },
  { name: "Fritid", kind: "expense" },
  { name: "Abonnementer", kind: "expense" },
  { name: "Opsparing", kind: "expense" },
  { name: "Indtægt", kind: "income" },
  { name: "Overførsel", kind: "transfer" },
  { name: "Andet", kind: "expense" },
];

/** Inserts default settings and categories into a freshly created archive. */
export async function seedDefaults(env: Env, db: DbAdapter): Promise<void> {
  const ctx: Ctx = { db, clock: env.clock, newId: env.newId, userId: null, via: "system" };
  await db.transaction(async (tx) => {
    const c = { ...ctx, db: tx };
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) await setSetting(c, k, v);
    for (const cat of DEFAULT_CATEGORIES) await createEntity(c, "category", cat);
  });
}

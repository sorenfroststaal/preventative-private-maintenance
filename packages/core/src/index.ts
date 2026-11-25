export * from "./db/adapter";
export { migrate, getSchemaVersion, APP_SCHEMA_VERSION } from "./db/migrate";
export * from "./env";
export * from "./archive/archive";
export * from "./archive/lock";
export { DEFAULT_CATEGORIES } from "./archive/defaults";
export * from "./domain/schemas";
export * from "./domain/registry";
export * from "./repo/entities";
export * from "./repo/search";
export * from "./repo/settings";
export * from "./repo/users";
export * from "./repo/tasks";
export * from "./repo/documents";
export * from "./recurrence/dates";
export * from "./recurrence/next";
export * from "./backup/backup";
export * from "./repo/modules";
export * from "./repo/finance";
export * from "./repo/eml";
export * from "./repo/inbox";
export * from "./repo/dashboard";
export * from "./repo/export";
export * from "./repo/lists";
export * from "./report/insurance";
export * from "./food";
export * from "./ai";
export { DERIVED_RULES, syncSystemTask } from "./domain/derived";

import { registerDerivedRules } from "./domain/derived";
import { registerModuleRules } from "./domain/rules";
registerDerivedRules();
registerModuleRules();

import type { DbAdapter } from "./db/adapter";
import type { Env } from "./env";
import type { Ctx, Via } from "./repo/entities";

/** Convenience to build a write context. */
export function makeCtx(env: Env, db: DbAdapter, userId: string | null, via: Via = "ui"): Ctx {
  return { db, clock: env.clock, newId: env.newId, userId, via };
}

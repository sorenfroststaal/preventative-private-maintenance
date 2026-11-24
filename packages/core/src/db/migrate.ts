import type { DbAdapter } from "./adapter";
import { migrations as allMigrations, type Migration } from "./migrations.generated";

export const APP_SCHEMA_VERSION = Math.max(...allMigrations.map((m) => m.version));

export async function getSchemaVersion(db: DbAdapter): Promise<number> {
  const t = await db.select<{ n: number }>(
    "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
  );
  if (!t[0] || t[0].n === 0) return 0;
  const r = await db.select<{ v: number | null }>("SELECT max(version) AS v FROM schema_migrations");
  return r[0]?.v ?? 0;
}

export interface MigrationResult {
  from: number;
  to: number;
  applied: number[];
  /** True when the database is newer than this program; the caller must open it read-only. */
  newerThanApp: boolean;
}

/** Applies all pending migrations in a single transaction. Idempotent. */
export async function migrate(
  db: DbAdapter,
  now: () => string,
  migrations: Migration[] = allMigrations,
): Promise<MigrationResult> {
  const from = await getSchemaVersion(db);
  const target = Math.max(0, ...migrations.map((m) => m.version));
  if (from > target) return { from, to: from, applied: [], newerThanApp: true };
  const pending = migrations.filter((m) => m.version > from).sort((a, b) => a.version - b.version);
  if (pending.length === 0) return { from, to: from, applied: [], newerThanApp: false };
  await db.transaction(async (tx) => {
    for (const m of pending) {
      await tx.executeScript(m.sql);
      await tx.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [
        m.version,
        now(),
      ]);
    }
  });
  return { from, to: target, applied: pending.map((m) => m.version), newerThanApp: false };
}

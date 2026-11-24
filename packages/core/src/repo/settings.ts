import type { DbAdapter } from "../db/adapter";
import { writeAudit, type Ctx } from "./entities";

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  "ai.modules": {
    home: true,
    maintenance: true,
    vehicle: true,
    finance: true,
    insurance: true,
    health: false,
    documents: true,
    food: true,
  },
  "food.meals": ["dinner"],
  "food.default_servings": 4,
  "dashboard.horizon_days": 30,
  "import.inbox_enabled": true,
};

export async function getSetting<T>(db: DbAdapter, key: string, fallback?: T): Promise<T | undefined> {
  const r = await db.select<{ value_json: string }>("SELECT value_json FROM setting WHERE key = ?", [key]);
  if (!r[0]) return fallback ?? (DEFAULT_SETTINGS[key] as T | undefined);
  return JSON.parse(r[0].value_json) as T;
}

export async function setSetting(ctx: Ctx, key: string, value: unknown): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const before = await tx.select<{ value_json: string }>("SELECT value_json FROM setting WHERE key = ?", [key]);
    const json = JSON.stringify(value);
    if (before[0]?.value_json === json) return;
    await tx.execute(
      "INSERT INTO setting (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
      [key, json],
    );
    await writeAudit({ ...ctx, db: tx }, "setting", key, before[0] ? "update" : "create", {
      value: [before[0] ? JSON.parse(before[0].value_json) : null, value],
    });
  });
}

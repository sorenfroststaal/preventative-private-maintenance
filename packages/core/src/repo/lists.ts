/**
 * Editable value lists behind dropdowns for free-text columns (item.category,
 * building_part.kind). The list is stored in `setting` (`lists.<key>`) and always also
 * contains the values already in use, so nothing disappears from a dropdown.
 */
import type { DbAdapter } from "../db/adapter";
import type { EntityType } from "../domain/schemas";
import { updateEntity, ValidationError, withDb, type Ctx } from "./entities";
import { getSetting, setSetting } from "./settings";

export interface TextListDef {
  key: string;
  label: string;
  entity: EntityType;
  column: string;
  defaults: string[];
}

export const TEXT_LISTS: TextListDef[] = [
  {
    key: "item_category",
    label: "Genstandskategorier",
    entity: "item",
    column: "category",
    defaults: ["Hvidevarer", "Elektronik", "Møbler", "Køkken", "Værktøj", "Have", "Belysning", "Sport og fritid", "Andet"],
  },
  {
    key: "building_part_kind",
    label: "Bygningsdelstyper",
    entity: "building_part",
    column: "kind",
    defaults: ["Tag", "Facade", "Vinduer og døre", "Varme", "Ventilation", "VVS", "El", "Kloak og afløb", "Have og udearealer", "Andet"],
  },
];

const def = (key: string) => {
  const d = TEXT_LISTS.find((l) => l.key === key);
  if (!d) throw new Error(`Ukendt liste: ${key}`);
  return d;
};
const settingKey = (key: string) => `lists.${key}`;
const same = (a: string, b: string) => a.trim().toLocaleLowerCase("da") === b.trim().toLocaleLowerCase("da");

async function stored(db: DbAdapter, key: string): Promise<string[]> {
  const v = await getSetting<string[]>(db, settingKey(key));
  return Array.isArray(v) ? v : def(key).defaults;
}

export interface TextListValue {
  value: string;
  /** Number of active records using the value. */
  used: number;
  /** In the stored list (false: only found in data). */
  listed: boolean;
}

/** The list's values: stored values plus values in use, sorted Danish, case-insensitively unique. */
export async function textListValues(db: DbAdapter, key: string): Promise<TextListValue[]> {
  const d = def(key);
  const archived = d.entity === "item" || d.entity === "building_part" ? "AND archived_at IS NULL" : "";
  const usedRows = await db.select<{ v: string; n: number }>(
    `SELECT ${d.column} AS v, count(*) AS n FROM ${d.entity} WHERE ${d.column} IS NOT NULL AND trim(${d.column}) != '' ${archived} GROUP BY ${d.column}`,
  );
  const out: TextListValue[] = [];
  for (const v of await stored(db, key)) if (!out.some((o) => same(o.value, v))) out.push({ value: v, used: 0, listed: true });
  for (const u of usedRows) {
    const o = out.find((x) => same(x.value, u.v));
    if (o) o.used += u.n;
    else out.push({ value: u.v, used: u.n, listed: false });
  }
  return out.sort((a, b) => a.value.localeCompare(b.value, "da"));
}

export async function addTextListValue(ctx: Ctx, key: string, value: string): Promise<string> {
  const v = value.trim();
  if (!v) throw new ValidationError([{ path: "value", message: "Feltet skal udfyldes" }]);
  const list = await stored(ctx.db, key);
  if (!list.some((x) => same(x, v))) await setSetting(ctx, settingKey(key), [...list, v]);
  return list.find((x) => same(x, v)) ?? v;
}

/** Renames a value in the list and in every record that uses it (each change audited). */
export async function renameTextListValue(ctx: Ctx, key: string, from: string, to: string): Promise<number> {
  const d = def(key);
  const target = to.trim();
  if (!target) throw new ValidationError([{ path: "value", message: "Feltet skal udfyldes" }]);
  return ctx.db.transaction(async (tx) => {
    const c = withDb(ctx, tx);
    const list = (await stored(tx, key)).filter((x) => !same(x, from) && !same(x, target));
    await setSetting(c, settingKey(key), [...list, target]);
    const rows = await tx.select<{ id: string }>(`SELECT id FROM ${d.entity} WHERE ${d.column} = ?`, [from]);
    for (const r of rows) await updateEntity(c, d.entity, r.id, { [d.column]: target } as never);
    return rows.length;
  });
}

/** Removes an unused value from the list. A value in use must be renamed (merged) instead. */
export async function removeTextListValue(ctx: Ctx, key: string, value: string): Promise<void> {
  const v = (await textListValues(ctx.db, key)).find((x) => same(x.value, value));
  if (v && v.used > 0) {
    throw new ValidationError([{ path: "value", message: `"${v.value}" bruges af ${v.used} poster. Omdøb den i stedet for at slette den.` }]);
  }
  await setSetting(ctx, settingKey(key), (await stored(ctx.db, key)).filter((x) => !same(x, value)));
}

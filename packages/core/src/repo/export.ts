/** Export: CSV/JSON per table, full JSON, and ICS (spec 05). */
import type { DbAdapter } from "../db/adapter";
import { getSchemaVersion } from "../db/migrate";
import { addDays } from "../recurrence/dates";

/** Tables that hold user data (FTS shadow tables and the index itself are left out). */
export async function exportableTables(db: DbAdapter): Promise<string[]> {
  const rows = await db.select<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'search_index%' ORDER BY name`,
  );
  return rows.map((r) => r.name);
}

async function assertTable(db: DbAdapter, table: string) {
  if (!(await exportableTables(db)).includes(table)) throw new Error(`Ukendt tabel: ${table}`);
}

const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV with header, `;` as delimiter (opens directly in Danish Excel), UTF-8 with BOM. */
export async function exportTableCsv(db: DbAdapter, table: string): Promise<string> {
  await assertTable(db, table);
  const cols = (await db.select<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name);
  const rows = await db.select<Record<string, unknown>>(`SELECT * FROM ${table} ORDER BY rowid`);
  const lines = [cols.join(";"), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(";"))];
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export async function exportTableJson(db: DbAdapter, table: string): Promise<string> {
  await assertTable(db, table);
  return JSON.stringify(await db.select(`SELECT * FROM ${table} ORDER BY rowid`), null, 2);
}

/** ppm-export.json: all tables plus schemaVersion (spec 05). */
export async function exportAllJson(db: DbAdapter, exportedAt: string): Promise<string> {
  const tables: Record<string, unknown[]> = {};
  for (const t of await exportableTables(db)) tables[t] = await db.select(`SELECT * FROM ${t} ORDER BY rowid`);
  return JSON.stringify({ format: "ppm-export", schemaVersion: await getSchemaVersion(db), exportedAt, tables }, null, 2);
}

// ---------- ICS ----------

const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Folds lines at 75 octets (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let len = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (len + n > (out.length === 0 ? 75 : 74)) {
      out.push(current);
      current = "";
      len = 0;
    }
    current += ch;
    len += n;
  }
  out.push(current);
  return out.join("\r\n ");
}

export interface IcsOptions {
  /** Only these tasks; default all active tasks with an open, dated occurrence. */
  taskIds?: string[];
  /** Use full titles for health tasks (default: neutral "Helbred: påmindelse"). */
  fullHealthTitles?: boolean;
  nowIso: string;
}

export const NEUTRAL_HEALTH_TITLE = "Helbred: påmindelse";

/**
 * All-day VEVENTs for open occurrences. Never includes notes, descriptions,
 * documents or health details (spec 05).
 */
export async function exportIcs(db: DbAdapter, opts: IcsOptions): Promise<string> {
  const rows = await db.select<{ occ_id: string; task_id: string; title: string; module: string; due_date: string }>(
    `SELECT o.id AS occ_id, t.id AS task_id, t.title, t.module, o.due_date FROM task t
       JOIN task_occurrence o ON o.task_id = t.id AND o.status = 'open' AND o.due_date IS NOT NULL
      WHERE t.status = 'active' ORDER BY o.due_date`,
  );
  const selected = opts.taskIds ? rows.filter((r) => opts.taskIds!.includes(r.task_id)) : rows;
  const stamp = opts.nowIso.replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PPM//Preventative Private Maintenance//DA", "CALSCALE:GREGORIAN"];
  for (const r of selected) {
    const title = r.module === "health" && !opts.fullHealthTitles ? NEUTRAL_HEALTH_TITLE : r.title;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${r.occ_id}@ppm.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${r.due_date.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${addDays(r.due_date, 1).replace(/-/g, "")}`,
      fold(`SUMMARY:${icsEscape(title)}`),
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

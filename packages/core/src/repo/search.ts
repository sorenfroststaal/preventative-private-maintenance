import type { DbAdapter, SqlValue } from "../db/adapter";
import type { Module } from "../domain/registry";

export interface SearchHit {
  type: string;
  id: string;
  module: Module;
  title: string;
  snippet: string;
}

/** Turns free text into a safe FTS5 query: every term quoted and prefix-matched. */
export function toFtsQuery(input: string): string | null {
  const terms = input
    .split(/\s+/)
    .map((t) => t.replace(/"/g, "").trim())
    .filter(Boolean);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t}"*`).join(" ");
}

export async function search(
  db: DbAdapter,
  query: string,
  opts: { modules?: Module[]; limit?: number } = {},
): Promise<SearchHit[]> {
  const q = toFtsQuery(query);
  if (!q) return [];
  if (opts.modules && opts.modules.length === 0) return [];
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const params: SqlValue[] = [q];
  let sql =
    "SELECT entity_type AS type, entity_id AS id, module, title, " +
    "snippet(search_index, 4, '[', ']', '…', 12) AS snippet " +
    "FROM search_index WHERE search_index MATCH ?";
  if (opts.modules) {
    sql += ` AND module IN (${opts.modules.map(() => "?").join(",")})`;
    params.push(...opts.modules);
  }
  // A match in the title weighs ten times a match in the body (a dishwasher before its rinse aid).
  sql += " ORDER BY bm25(search_index, 0, 0, 0, 10.0, 1.0) LIMIT ?";
  params.push(limit);
  return db.select<SearchHit>(sql, params);
}

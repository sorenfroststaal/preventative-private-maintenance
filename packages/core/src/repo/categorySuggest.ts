/** Category suggestions from earlier categorised transactions (phase 4.2). */
import type { DbAdapter } from "../db/adapter";
import { matchRule } from "./finance";
import { createEntity, updateEntity, type Ctx } from "./entities";

const MONTHS = "jan|feb|mar|apr|maj|may|jun|jul|aug|sep|okt|oct|nov|dec";

/**
 * Payee key: the text in lower case without dates, card numbers and other numbers.
 * "Dankort-nota NETTO 4711 12.11" and "Dankort-nota Netto 4711 03.12" give the same key.
 */
export function payeeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b\d{1,4}[./-]\d{1,2}([./-]\d{2,4})?\b/g, " ") // dates 12.11, 12-11-2026, 2026-11-12
    .replace(new RegExp(`\\b\\d{1,2}\\.?\\s*(${MONTHS})[a-z]*\\.?(\\s*\\d{2,4})?\\b`, "g"), " ") // 12. nov 2026
    .replace(/\b(x{2,}|\*{2,})\s*\d+\b/g, " ") // masked card numbers xxxx1234, ****1234
    .replace(/\d+/g, " ")
    .replace(/[^\p{L}&]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pattern for a learned "contains" rule from a transaction text: the longest part of the text without
 * digits, in lower case, so it is a real substring of future texts ("Dankort-nota NETTO 4711 12.11" →
 * "dankort-nota netto").
 */
export function rulePatternFor(text: string): string {
  const parts = text
    .toLowerCase()
    .split(/\d+/)
    .map((p) => p.replace(/^[\s./*,:-]+|[\s./*,:-]+$/g, ""))
    .filter((p) => /\p{L}{2,}/u.test(p));
  return parts.sort((a, b) => b.length - a.length)[0] ?? "";
}

export interface CategorySuggestion {
  transaction_id: string;
  text: string;
  booking_date: string;
  amount_minor: number;
  category_id: string;
  category_name: string;
  /** "rule": an existing rule matches (rules win); "history": earlier transactions with the same payee key. */
  source: "rule" | "history";
  /** Number of earlier transactions with this payee key, sign and category. */
  count: number;
  key: string;
}

/**
 * Suggestions for transactions without category. The suggestion is the most frequent category among
 * categorised transactions with the same payee key and sign. It needs at least 2 occurrences, or 1 when
 * the key has no other category. A tie between categories gives no suggestion.
 */
export async function suggestCategories(db: DbAdapter, opts: { limit?: number } = {}): Promise<CategorySuggestion[]> {
  const rules = await db.select<{ match_type: "contains" | "starts_with" | "regex"; pattern: string; category_id: string }>(
    "SELECT match_type, pattern, category_id FROM category_rule ORDER BY priority, rowid",
  );
  const cats = new Map(
    (await db.select<{ id: string; name: string }>("SELECT id, name FROM category WHERE archived_at IS NULL")).map((c) => [c.id, c.name]),
  );
  const known = await db.select<{ text: string; amount_minor: number; category_id: string }>(
    "SELECT text, amount_minor, category_id FROM bank_transaction WHERE category_id IS NOT NULL",
  );
  const history = new Map<string, Map<string, number>>();
  for (const k of known) {
    if (!cats.has(k.category_id)) continue;
    const key = `${k.amount_minor < 0 ? "-" : "+"}${payeeKey(k.text)}`;
    const m = history.get(key) ?? new Map<string, number>();
    m.set(k.category_id, (m.get(k.category_id) ?? 0) + 1);
    history.set(key, m);
  }
  const open = await db.select<{ id: string; text: string; booking_date: string; amount_minor: number }>(
    "SELECT id, text, booking_date, amount_minor FROM bank_transaction WHERE category_id IS NULL ORDER BY booking_date DESC, rowid DESC LIMIT ?",
    [opts.limit ?? 1000],
  );
  const out: CategorySuggestion[] = [];
  for (const t of open) {
    const key = payeeKey(t.text);
    const base = { transaction_id: t.id, text: t.text, booking_date: t.booking_date, amount_minor: t.amount_minor, key };
    const ruleCat = matchRule(rules, t.text);
    if (ruleCat && cats.has(ruleCat)) {
      out.push({ ...base, category_id: ruleCat, category_name: cats.get(ruleCat)!, source: "rule", count: 0 });
      continue;
    }
    if (!key) continue;
    const m = history.get(`${t.amount_minor < 0 ? "-" : "+"}${key}`);
    if (!m) continue;
    const ranked = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const [best, n] = ranked[0]!;
    if (ranked[1] && ranked[1][1] === n) continue;
    if (n >= 2 || (n === 1 && ranked.length === 1)) {
      out.push({ ...base, category_id: best, category_name: cats.get(best)!, source: "history", count: n });
    }
  }
  return out;
}

/**
 * Accepts suggestions (one, several or all): the category is set as chosen by the user
 * (`category_source = 'user'`). With `makeRule`, a learned "contains" rule is created per distinct
 * text pattern (`rulePatternFor`) and category, so future imports are categorised automatically. Returns the number set.
 */
export async function acceptCategorySuggestions(
  ctx: Ctx,
  items: { transaction_id: string; category_id: string; text?: string }[],
  opts: { makeRule?: boolean } = {},
): Promise<number> {
  return ctx.db.transaction(async (tx) => {
    const c = { ...ctx, db: tx };
    const rulesMade = new Set<string>();
    for (const i of items) {
      await updateEntity(c, "bank_transaction", i.transaction_id, { category_id: i.category_id, category_source: "user" });
      const pattern = i.text ? rulePatternFor(i.text) : "";
      if (opts.makeRule && pattern && !rulesMade.has(`${pattern}|${i.category_id}`)) {
        rulesMade.add(`${pattern}|${i.category_id}`);
        const exists = await tx.select("SELECT 1 FROM category_rule WHERE match_type = 'contains' AND lower(pattern) = ? AND category_id = ?", [pattern, i.category_id]);
        if (!exists.length) await createEntity(c, "category_rule", { match_type: "contains", pattern, category_id: i.category_id, created_from: "learned" });
      }
    }
    return items.length;
  });
}

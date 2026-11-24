/** Ingredient parser and formatting (spec 05 "Ingrediens-parser"). */

export interface ParsedIngredient {
  amount: number | null;
  unit: string | null;
  name: string;
  note: string | null;
  raw_text: string;
}

/** Written unit → stored unit (spec 05). Keys are lowercase without a trailing dot. */
const UNITS: Record<string, string> = {
  g: "g",
  gram: "g",
  kg: "kg",
  kilo: "kg",
  ml: "ml",
  dl: "dl",
  l: "l",
  liter: "l",
  stk: "stk",
  spsk: "spsk",
  tsk: "tsk",
  fed: "fed",
  dåse: "dåse",
  dåser: "dåse",
  pk: "pk",
  pakke: "pk",
  pakker: "pk",
  bdt: "bundt",
  bundt: "bundt",
};

/** Units whose abbreviation may be written with a trailing dot ("stk.", "spsk.", "tsk."). */
const DOTTED = new Set(["stk", "spsk", "tsk"]);

export const KNOWN_UNITS = [...new Set(Object.values(UNITS))];

const VULGAR: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };
const NUM = String.raw`\d+(?:[.,]\d+)?`;
const VULG = "[½¼¾⅓⅔⅛]";
/** One quantity: "1", "1,5", "1/2", "½", "1½", "1 1/2". */
const QTY = String.raw`(?:\d+\s+\d+\s*/\s*\d+|\d+\s*/\s*\d+|\d*${VULG}|${NUM})`;
const AMOUNT_RE = new RegExp(String.raw`^(${QTY})(?:\s*[-–]\s*(${QTY}))?(?=\s|$|[a-zA-ZæøåÆØÅ])`);

function qtyValue(q: string): number {
  const t = q.trim();
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const vulg = new RegExp(`^(\\d*)(${VULG})$`).exec(t);
  if (vulg) return (vulg[1] ? Number(vulg[1]) : 0) + VULGAR[vulg[2]!]!;
  return Number(t.replace(",", "."));
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Normalised item name: lowercase, trimmed, single spaces. */
export const normalizeName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Parses one line in the format `[mængde] [enhed] vare[, note]`.
 * Returns null for empty lines.
 */
export function parseIngredientLine(line: string): ParsedIngredient | null {
  const raw = line.trim();
  if (!raw) return null;
  let rest = raw.replace(/^[-•*]\s+/, "");
  let amount: number | null = null;
  let unit: string | null = null;

  const m = AMOUNT_RE.exec(rest);
  if (m) {
    const a = qtyValue(m[1]!);
    const b = m[2] ? qtyValue(m[2]) : null;
    const v = b !== null ? Math.max(a, b) : a;
    if (Number.isFinite(v) && v > 0) amount = round(v);
    rest = rest.slice(m[0].length).trim();
    const u = /^([a-zA-ZæøåÆØÅ]+)(\.?)(?=\s|,|$)/.exec(rest);
    if (u) {
      const key = u[1]!.toLowerCase();
      const known = UNITS[key];
      if (known && (!u[2] || DOTTED.has(key))) {
        unit = known;
        rest = rest.slice(u[0].length).trim();
      }
    }
    if (amount !== null && unit === null) unit = "stk";
    if (amount === null) unit = null;
  }

  const comma = rest.indexOf(",");
  const namePart = comma >= 0 ? rest.slice(0, comma) : rest;
  const notePart = comma >= 0 ? rest.slice(comma + 1).trim() : "";
  const name = normalizeName(namePart) || normalizeName(raw);
  return { amount, unit, name, note: notePart || null, raw_text: raw };
}

/** Parses a block of text (one ingredient per line). Empty lines are skipped. */
export function parseIngredients(text: string | string[]): ParsedIngredient[] {
  const lines = Array.isArray(text) ? text : text.split(/\r?\n/);
  return lines.map(parseIngredientLine).filter((x): x is ParsedIngredient => x !== null);
}

/** Danish number formatting without trailing zeros: 1.5 → "1,5", 1000 → "1000". */
export function formatAmount(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(r).replace(".", ",");
}

/** Short form used in lists, exports and AI ("500 g hakket oksekød"). */
export function formatIngredient(i: { amount?: number | null; unit?: string | null; name: string; note?: string | null }): string {
  const parts: string[] = [];
  if (i.amount !== null && i.amount !== undefined) {
    parts.push(formatAmount(i.amount));
    if (i.unit && i.unit !== "stk") parts.push(i.unit);
  }
  parts.push(i.name);
  return parts.join(" ") + (i.note ? `, ${i.note}` : "");
}

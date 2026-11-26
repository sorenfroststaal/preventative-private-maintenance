/** Suggestions from receipt text (phase 4.4): total, date and vendor from OCR or a PDF text layer. */
import type { DbAdapter } from "../db/adapter";
import type { Row } from "../domain/registry";
import { isValidDate } from "../domain/schemas";
import { updateEntity, type Ctx } from "./entities";
import { getSetting, setSetting } from "./settings";

export interface ReceiptSuggestion {
  total_minor: number | null;
  date: string | null;
  vendor: string | null;
}

const MONTHS: Record<string, number> = {
  jan: 1, januar: 1, feb: 2, februar: 2, mar: 3, marts: 3, apr: 4, april: 4, maj: 5, jun: 6, juni: 6,
  jul: 7, juli: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/** Danish amounts in a line: 5.298,00 · 5298,00 · 5 298,00 · 299,- · 299,50 (öre required unless ",-"). */
function amountsIn(line: string): number[] {
  const out: number[] = [];
  const re = /(?<![\d.,])(-?\d{1,3}(?:[. ]\d{3})+|-?\d+),(\d{2}|-)(?![\d])/g;
  for (const m of line.matchAll(re)) {
    const int = Number(m[1]!.replace(/[. ]/g, ""));
    const frac = m[2] === "-" ? 0 : Number(m[2]);
    out.push(Math.sign(int || 1) * (Math.abs(int) * 100 + frac));
  }
  return out;
}

/** Ranked total keywords; a higher rank wins. Lines about VAT, subtotals, change and card payments are skipped. */
const TOTAL_KEYS: [RegExp, number][] = [
  [/\bat\s+betale\b/i, 4],
  [/\bi\s*alt\b/i, 3],
  [/\btotal(beløb)?\b/i, 3],
  [/\bsum\b/i, 2],
  [/\bbeløb\b/i, 1],
];
const NOT_TOTAL = /subtotal|sub\s*total|byttepenge|retur|rabat|kontant\s*modtaget|heraf|ex\.?\s*moms|ekskl/i;
/** A VAT line ("Moms 509,60") is not a total, but "Total inkl. moms 2.548,00" is. */
const isVatLine = (line: string) => /moms/i.test(line) && !/inkl/i.test(line);

function findTotal(lines: string[]): number | null {
  let best: { rank: number; amount: number; index: number } | null = null;
  lines.forEach((line, index) => {
    if (NOT_TOTAL.test(line) || isVatLine(line)) return;
    const key = TOTAL_KEYS.find(([re]) => re.test(line));
    if (!key) return;
    // The amount is on the same line, or alone on the next line.
    const amounts = amountsIn(line).length ? amountsIn(line) : amountsIn(lines[index + 1] ?? "");
    if (!amounts.length) return;
    const amount = amounts[amounts.length - 1]!;
    if (amount <= 0) return;
    // Higher rank wins; on the same rank the later line (totals come last).
    if (!best || key[1] > best.rank || (key[1] === best.rank && index > best.index)) best = { rank: key[1], amount, index };
  });
  return (best as { amount: number } | null)?.amount ?? null;
}

const pad = (n: number) => String(n).padStart(2, "0");
function toIso(y: number, m: number, d: number): string | null {
  const year = y < 100 ? 2000 + y : y;
  const iso = `${year}-${pad(m)}-${pad(d)}`;
  return isValidDate(iso) && year >= 1990 && year <= 2200 ? iso : null;
}

function findDate(text: string): string | null {
  const candidates: { index: number; iso: string }[] = [];
  const push = (index: number, iso: string | null) => iso && candidates.push({ index, iso });
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(m.index!, toIso(+m[1]!, +m[2]!, +m[3]!));
  for (const m of text.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/g)) push(m.index!, toIso(+m[3]!, +m[2]!, +m[1]!));
  for (const m of text.matchAll(/\b(\d{1,2})\.?\s+([a-zæøå]+)\.?\s+(\d{4})\b/gi)) {
    const month = MONTHS[m[2]!.toLowerCase()];
    if (month) push(m.index!, toIso(+m[3]!, month, +m[1]!));
  }
  candidates.sort((a, b) => a.index - b.index);
  return candidates[0]?.iso ?? null;
}

const NOT_VENDOR = /kvittering|faktura|bon\b|dato|tlf|telefon|cvr|www\.|@|velkommen|kopi|ordre/i;

function findVendor(lines: string[]): string | null {
  for (const raw of lines.slice(0, 6)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line.length < 3 || NOT_VENDOR.test(line)) continue;
    const letters = (line.match(/\p{L}/gu) ?? []).length;
    if (letters < 3 || letters < line.replace(/\s/g, "").length * 0.6) continue;
    return line.length > 60 ? line.slice(0, 60).trim() : line;
  }
  return null;
}

/** Parses receipt text. Every field is null when it cannot be found with reasonable certainty. */
export function parseReceipt(text: string): ReceiptSuggestion {
  // PDF text layers are stored on one line; then every amount ends a pseudo-line.
  const flat = !/\n/.test(text.trim());
  const source = flat ? text.replace(/(\d,(?:\d{2}|-)(?:\s*kr\.?)?)\s+/gi, "$1\n") : text;
  const lines = source.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return { total_minor: findTotal(lines), date: findDate(text), vendor: flat ? vendorFromFlat(text) : findVendor(lines) };
}

const STREET = /(vej|gade|allé|alle|plads|stræde|vænget|torv|boulevard)$/i;

/** Vendor from one-line text: the words before the first digit, without a trailing street name. */
function vendorFromFlat(text: string): string | null {
  const words = (text.trim().split(/\d/, 1)[0] ?? "").split(/\s+/).filter(Boolean);
  while (words.length && (NOT_VENDOR.test(words[0]!) || /^(kvittering|faktura)$/i.test(words[0]!))) words.shift();
  const stop = words.findIndex((w, i) => i > 0 && NOT_VENDOR.test(w));
  if (stop > 0) words.splice(stop);
  while (words.length > 1 && (STREET.test(words[words.length - 1]!) || /[:,]$/.test(words[words.length - 1]!))) words.pop();
  const v = words.slice(0, 5).join(" ");
  return findVendor([v]);
}

export interface ItemReceiptSuggestion {
  document_id: string;
  /** Only fields with a value; `current` is the item's value now (null = empty). */
  fields: { key: "purchase_price_minor" | "purchase_date" | "vendor_name"; suggested: number | string; current: unknown }[];
}

/** Suggestion for an item from a linked receipt or invoice with text, or null if nothing was found. */
export async function receiptSuggestionForItem(db: DbAdapter, itemId: string, documentId: string): Promise<ItemReceiptSuggestion | null> {
  const [doc] = await db.select<{ extracted_text: string | null }>("SELECT extracted_text FROM document WHERE id = ?", [documentId]);
  const [item] = await db.select<Row>("SELECT name, purchase_price_minor, purchase_date, vendor_name FROM item WHERE id = ?", [itemId]);
  if (!doc?.extracted_text || !item) return null;
  const s = parseReceipt(doc.extracted_text);
  const fields: ItemReceiptSuggestion["fields"] = [];
  if (s.total_minor !== null) fields.push({ key: "purchase_price_minor", suggested: s.total_minor, current: item.purchase_price_minor ?? null });
  if (s.date) fields.push({ key: "purchase_date", suggested: s.date, current: item.purchase_date ?? null });
  // A "vendor" that is really the product name (first line of an order confirmation) is not suggested.
  const words = (t: string) => t.toLowerCase().match(/\p{L}{2,}/gu) ?? [];
  const sameAsItem = (v: string) => {
    const vw = words(v);
    const iw = new Set(words(String(item.name ?? "")));
    return vw.length > 0 && vw.filter((w) => iw.has(w)).length * 2 >= vw.length;
  };
  if (s.vendor && !sameAsItem(s.vendor)) fields.push({ key: "vendor_name", suggested: s.vendor, current: item.vendor_name ?? null });
  return fields.length ? { document_id: documentId, fields } : null;
}

/** Fills the confirmed fields on the item. */
export async function applyReceiptSuggestion(ctx: Ctx, itemId: string, values: { purchase_price_minor?: number; purchase_date?: string; vendor_name?: string }): Promise<Row> {
  return updateEntity(ctx, "item", itemId, values);
}

const DISMISSED_KEY = "receipt.dismissed";

export interface ItemReceiptStatus {
  /** The first linked receipt/invoice with a suggestion for at least one empty field, not dismissed. */
  suggestion: ItemReceiptSuggestion | null;
  /** A linked receipt/invoice image is still waiting for OCR. */
  waiting_for_ocr: boolean;
}

/** For the item detail: is there a receipt suggestion to show (only when it would fill an empty field)? */
export async function itemReceiptStatus(db: DbAdapter, itemId: string): Promise<ItemReceiptStatus> {
  const docs = await db.select<{ id: string; extracted_text: string | null }>(
    `SELECT d.id, d.extracted_text FROM document_link l JOIN document d ON d.id = l.document_id
      WHERE l.target_type = 'item' AND l.target_id = ? AND l.role IN ('receipt', 'invoice') ORDER BY d.created_at`,
    [itemId],
  );
  const dismissed = new Set<string>((await getSetting<string[]>(db, DISMISSED_KEY)) ?? []);
  let waiting = false;
  for (const d of docs) {
    if (d.extracted_text === null) waiting = true;
    if (!d.extracted_text || dismissed.has(`${itemId}:${d.id}`)) continue;
    const s = await receiptSuggestionForItem(db, itemId, d.id);
    if (s && s.fields.some((f) => f.current === null || f.current === "")) return { suggestion: s, waiting_for_ocr: false };
  }
  return { suggestion: null, waiting_for_ocr: waiting };
}

/** "Afvis": the suggestion from this receipt is not shown again for this item. */
export async function dismissReceiptSuggestion(ctx: Ctx, itemId: string, documentId: string): Promise<void> {
  const list = (await getSetting<string[]>(ctx.db, DISMISSED_KEY)) ?? [];
  const key = `${itemId}:${documentId}`;
  if (!list.includes(key)) await setSetting(ctx, DISMISSED_KEY, [...list, key].slice(-500));
}

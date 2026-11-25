/** Finance: bank CSV import (spec 05), categorisation, budget and recurring expenses (spec 04). */
import type { Archive } from "../archive/archive";
import type { DbAdapter, SqlValue } from "../db/adapter";
import type { Row } from "../domain/registry";
import { isValidDate } from "../domain/schemas";
import type { Env } from "../env";
import { importDocument } from "./documents";
import { createEntity, mustGet, updateEntity, ValidationError, type Ctx } from "./entities";
import { monthlyAverage } from "./modules";

// ---------- Parsing primitives ----------

/** "-1.234,56" → -123456 (øre). Returns null if the text is not a Danish amount. */
export function parseDanishAmount(input: string): number | null {
  const s = input.trim().replace(/\s/g, "").replace(/kr\.?$/i, "");
  if (!/^[-+]?(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(s)) return null;
  const neg = s.startsWith("-");
  const [int, frac = ""] = s.replace(/^[-+]/, "").replace(/\./g, "").split(",");
  const minor = Number(int) * 100 + Number(frac.padEnd(2, "0"));
  return neg ? -minor : minor;
}

export type DateFormat = "DD-MM-YYYY" | "DD.MM.YYYY" | "YYYY-MM-DD" | "DD/MM/YYYY" | "YYYY/MM/DD";

/** DD-MM-YYYY / DD.MM.YYYY (and ISO for the generic profile) → YYYY-MM-DD, or null. */
export function parseBankDate(input: string, format?: DateFormat): string | null {
  const s = input.trim();
  let m: RegExpMatchArray | null = null;
  if ((!format || format === "DD-MM-YYYY") && (m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/))) {
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    return isValidDate(iso) ? iso : null;
  }
  if ((!format || format === "DD.MM.YYYY") && (m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/))) {
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    return isValidDate(iso) ? iso : null;
  }
  if (format === "YYYY-MM-DD" && isValidDate(s)) return s;
  if (format === "DD/MM/YYYY" && (m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/))) {
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    return isValidDate(iso) ? iso : null;
  }
  if (format === "YYYY/MM/DD" && (m = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/))) {
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    return isValidDate(iso) ? iso : null;
  }
  return null;
}

/** UTF-8 (with or without BOM); falls back to Windows-1252 if not valid UTF-8 (spec 05). */
export function decodeBankFile(bytes: Uint8Array): string {
  let b = bytes;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    return new TextDecoder("windows-1252").decode(b);
  }
}

/** RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF/LF). */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const norm = (s: string) => s.trim().toLowerCase();

// ---------- Profiles ----------

export interface GenericProfile {
  name: string;
  delimiter: string;
  hasHeader: boolean;
  dateFormat: DateFormat;
  /** Decimal separator of amounts: "," (Danish, default, "." as thousands) or "." (e.g. 1234.50, "," as thousands). */
  decimal?: "," | ".";
  /**
   * One amount column (`amount`, negative = expense), or separate columns for money out (`debit`)
   * and money in (`credit`). In the separate case the sign in the file is ignored.
   */
  columns: { date: number; text: number; amount?: number | null; debit?: number | null; credit?: number | null; balance?: number | null };
}

/** Amount with the given decimal separator; also accepts the Unicode minus sign. */
export function parseAmount(input: string, decimal: "," | "." = ","): number | null {
  let s = input.trim().replace(/\u2212/g, "-");
  if (decimal === ".") s = s.replace(/[\s,]/g, "").replace(".", ",");
  return parseDanishAmount(s);
}

export interface ParsedRow {
  line: number;
  booking_date: string;
  text: string;
  amount_minor: number;
  balance_minor: number | null;
}

export interface ParseResult {
  profile: string;
  rows: ParsedRow[];
  errors: { line: number; message: string }[];
}

export const SPARKRON_HEADER = ["dato", "posteringstekst", "beløb"];

/** True if the text looks like a Sparekassen Kronjylland export (spec 05). */
export function detectSparkron(text: string): string | null {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  for (const d of [";", ","]) {
    const header = parseCsv(firstLine, d)[0] ?? [];
    if (header.length === 3 && header.map(norm).every((h, i) => h === SPARKRON_HEADER[i])) return d;
  }
  return null;
}

/** Parses with the sparkron profile. Any invalid row rejects the whole import (spec 05). */
export function parseSparkron(text: string): ParseResult {
  const d = detectSparkron(text);
  if (!d) {
    return { profile: "sparkron", rows: [], errors: [{ line: 1, message: "Overskriften skal være Dato;Posteringstekst;Beløb" }] };
  }
  const rows: ParsedRow[] = [];
  const errors: ParseResult["errors"] = [];
  parseCsv(text, d).forEach((cols, i) => {
    const line = i + 1;
    if (i === 0) return;
    if (cols.every((c) => c.trim() === "")) return; // blank line
    if (cols.length !== 3) return void errors.push({ line, message: `Forventede 3 kolonner, fandt ${cols.length}` });
    const date = parseBankDate(cols[0]!);
    const amount = parseDanishAmount(cols[2]!);
    if (!date) errors.push({ line, message: `Ugyldig dato: "${cols[0]}"` });
    if (amount === null) errors.push({ line, message: `Ugyldigt beløb: "${cols[2]}"` });
    if (date && amount !== null) rows.push({ line, booking_date: date, text: cols[1]!.trim(), amount_minor: amount, balance_minor: null });
  });
  return { profile: "sparkron", rows, errors };
}

export function parseGeneric(text: string, p: GenericProfile): ParseResult {
  const rows: ParsedRow[] = [];
  const errors: ParseResult["errors"] = [];
  const split = p.columns.amount === null || p.columns.amount === undefined;
  const dec = p.decimal ?? ",";
  parseCsv(text, p.delimiter).forEach((cols, i) => {
    const line = i + 1;
    if (p.hasHeader && i === 0) return;
    if (cols.every((c) => c.trim() === "")) return;
    const get = (idx: number | null | undefined) => (idx === null || idx === undefined ? undefined : cols[idx]);
    const rawDate = get(p.columns.date);
    const rawText = get(p.columns.text);
    let amount: number | null = null;
    let rawAmount: string | undefined;
    if (!split) {
      rawAmount = get(p.columns.amount);
      amount = rawAmount === undefined ? null : parseAmount(rawAmount, dec);
    } else {
      const out = get(p.columns.debit)?.trim() ?? "";
      const inn = get(p.columns.credit)?.trim() ?? "";
      rawAmount = `${out}|${inn}`;
      if (get(p.columns.debit) === undefined && get(p.columns.credit) === undefined) rawAmount = undefined;
      const o = out ? parseAmount(out, dec) : 0;
      const n = inn ? parseAmount(inn, dec) : 0;
      amount = o === null || n === null || (!out && !inn) ? null : Math.abs(n) - Math.abs(o);
    }
    if (rawDate === undefined || rawText === undefined || rawAmount === undefined) {
      return void errors.push({ line, message: "Rækken har for få kolonner" });
    }
    const date = parseBankDate(rawDate, p.dateFormat);
    const rawBalance = get(p.columns.balance);
    const balance = rawBalance !== undefined && rawBalance.trim() !== "" ? parseAmount(rawBalance, dec) : null;
    if (!date) errors.push({ line, message: `Ugyldig dato: "${rawDate}"` });
    if (amount === null) errors.push({ line, message: split ? `Ugyldigt beløb i ud/ind: "${rawAmount.replace("|", '" / "')}"` : `Ugyldigt beløb: "${rawAmount}"` });
    if (rawBalance && rawBalance.trim() !== "" && balance === null) errors.push({ line, message: `Ugyldig saldo: "${rawBalance}"` });
    if (date && amount !== null) rows.push({ line, booking_date: date, text: rawText.trim(), amount_minor: amount, balance_minor: balance });
  });
  return { profile: `generic:${p.name}`, rows, errors };
}

// ---------- Dedupe, preview, import ----------

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** dedupe_hash per spec 05, with n = index among identical rows in the same file. */
export async function dedupeHashes(accountId: string, rows: ParsedRow[]): Promise<string[]> {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const r of rows) {
    const key = `${accountId}|${r.booking_date}|${r.text}|${r.amount_minor}|${r.balance_minor ?? ""}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    out.push(await sha256Hex(`${key}|${n}`));
  }
  return out;
}

export interface ImportPreview {
  total: number;
  newRows: number;
  duplicates: number;
  sample: (ParsedRow & { duplicate: boolean })[];
}

export async function previewBankImport(db: DbAdapter, accountId: string, parsed: ParseResult): Promise<ImportPreview> {
  if (parsed.errors.length) throw new ValidationError(parsed.errors.map((e) => ({ path: `linje ${e.line}`, message: e.message })), "bank_transaction");
  const hashes = await dedupeHashes(accountId, parsed.rows);
  const existing = await existingHashes(db, accountId, hashes);
  const dup = hashes.map((h) => existing.has(h));
  return {
    total: parsed.rows.length,
    newRows: dup.filter((d) => !d).length,
    duplicates: dup.filter(Boolean).length,
    sample: parsed.rows.slice(0, 20).map((r, i) => ({ ...r, duplicate: dup[i]! })),
  };
}

async function existingHashes(db: DbAdapter, accountId: string, hashes: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < hashes.length; i += 500) {
    const chunk = hashes.slice(i, i + 500);
    const rows = await db.select<{ dedupe_hash: string }>(
      `SELECT dedupe_hash FROM bank_transaction WHERE account_id = ? AND dedupe_hash IN (${chunk.map(() => "?").join(",")})`,
      [accountId, ...chunk],
    );
    rows.forEach((r) => out.add(r.dedupe_hash));
  }
  return out;
}

export interface BankImportResult {
  batchId: string;
  total: number;
  imported: number;
  duplicates: number;
  categorized: number;
}

/**
 * Imports parsed rows (spec 05): stores the raw file as a document, writes an
 * import_batch, skips duplicates and categorises new rows with the rules.
 */
export async function commitBankImport(
  env: Env,
  archive: Archive,
  ctx: Ctx,
  input: { accountId: string; parsed: ParseResult; filePath: string },
): Promise<BankImportResult> {
  const { accountId, parsed, filePath } = input;
  if (parsed.errors.length) throw new ValidationError(parsed.errors.map((e) => ({ path: `linje ${e.line}`, message: e.message })), "bank_transaction");
  await mustGet(ctx.db, "account", accountId);
  const { document } = await importDocument(env, archive, ctx, filePath, { source: "bank_import" });
  const hashes = await dedupeHashes(accountId, parsed.rows);
  const rules = await loadRules(ctx.db);
  return ctx.db.transaction(async (tx) => {
    const c = { ...ctx, db: tx, via: "import" as const };
    const existing = await existingHashes(tx, accountId, hashes);
    const batchId = env.newId();
    const toImport = parsed.rows.map((r, i) => ({ r, h: hashes[i]! })).filter(({ h }) => !existing.has(h));
    await createEntity(
      c,
      "import_batch",
      {
        account_id: accountId,
        profile: parsed.profile,
        file_document_id: String(document.id),
        imported_at: ctx.clock.nowIso(),
        rows_total: parsed.rows.length,
        rows_imported: toImport.length,
        rows_duplicate: parsed.rows.length - toImport.length,
      },
      { id: batchId },
    );
    let categorized = 0;
    for (const { r, h } of toImport) {
      const cat = matchRule(rules, r.text);
      if (cat) categorized++;
      await createEntity(c, "bank_transaction", {
        account_id: accountId,
        booking_date: r.booking_date,
        text: r.text,
        amount_minor: r.amount_minor,
        balance_minor: r.balance_minor,
        category_id: cat,
        category_source: cat ? "rule" : null,
        import_batch_id: batchId,
        dedupe_hash: h,
      });
    }
    return { batchId, total: parsed.rows.length, imported: toImport.length, duplicates: parsed.rows.length - toImport.length, categorized };
  });
}

// ---------- Categorisation ----------

interface RuleRow {
  match_type: "contains" | "starts_with" | "regex";
  pattern: string;
  category_id: string;
}

async function loadRules(db: DbAdapter): Promise<RuleRow[]> {
  // Lowest priority wins; on ties the oldest rule (spec 05).
  return db.select<RuleRow>("SELECT match_type, pattern, category_id FROM category_rule ORDER BY priority, rowid");
}

export function matchRule(rules: RuleRow[], text: string): string | null {
  const t = text.toLowerCase();
  for (const r of rules) {
    const p = r.pattern.toLowerCase();
    if (r.match_type === "contains" && t.includes(p)) return r.category_id;
    if (r.match_type === "starts_with" && t.startsWith(p)) return r.category_id;
    if (r.match_type === "regex") {
      try {
        if (new RegExp(r.pattern, "i").test(text)) return r.category_id;
      } catch {
        // invalid user regex: ignore the rule
      }
    }
  }
  return null;
}

export async function categorize(db: DbAdapter, text: string): Promise<string | null> {
  return matchRule(await loadRules(db), text);
}

/**
 * Sets a category by hand. With `learnPattern`, a learned "contains" rule is created
 * ("Brug altid for tekster der indeholder …", spec 04).
 */
export async function setTransactionCategory(
  ctx: Ctx,
  transactionId: string,
  categoryId: string | null,
  opts: { learnPattern?: string | null } = {},
): Promise<Row> {
  return ctx.db.transaction(async (tx) => {
    const c = { ...ctx, db: tx };
    const row = await updateEntity(c, "bank_transaction", transactionId, {
      category_id: categoryId,
      category_source: categoryId ? "user" : null,
    });
    if (categoryId && opts.learnPattern?.trim()) {
      await createEntity(c, "category_rule", {
        match_type: "contains",
        pattern: opts.learnPattern.trim(),
        category_id: categoryId,
        created_from: "learned",
      });
    }
    return row;
  });
}

/** Suggested pattern for a learned rule: the text without trailing numbers/dates. */
export function suggestPattern(text: string): string {
  return text
    .replace(/\d[\d\s./-]*$/g, "")
    .replace(/\s+\d+\s*$/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(" ");
}

export async function listTransactions(
  db: DbAdapter,
  f: { accountId?: string; from?: string; to?: string; categoryId?: string; text?: string; uncategorized?: boolean; limit?: number } = {},
): Promise<Row[]> {
  const conds: string[] = [];
  const params: SqlValue[] = [];
  const add = (cond: string, value?: SqlValue) => {
    conds.push(cond);
    if (value !== undefined) params.push(value);
  };
  if (f.accountId) add("t.account_id = ?", f.accountId);
  if (f.from) add("t.booking_date >= ?", f.from);
  if (f.to) add("t.booking_date <= ?", f.to);
  if (f.categoryId) add("t.category_id = ?", f.categoryId);
  if (f.uncategorized) add("t.category_id IS NULL");
  if (f.text) add("t.text LIKE ?", `%${f.text}%`);
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  params.push(Math.min(f.limit ?? 500, 5000));
  return db.select<Row>(
    `SELECT t.*, c.name AS category_name, a.name AS account_name FROM bank_transaction t
       LEFT JOIN category c ON c.id = t.category_id JOIN account a ON a.id = t.account_id
     ${where} ORDER BY t.booking_date DESC, t.rowid DESC LIMIT ?`,
    params,
  );
}

// ---------- Budget ----------

export interface BudgetRow {
  category_id: string;
  name: string;
  kind: string;
  /** index 0..11 = Jan..Dec */
  budget: number[];
  actual: number[];
  budget_total: number;
  actual_total: number;
}

/** Budget vs actual per category per month for a year (spec 04). Expenses are positive numbers. */
export async function budgetVsActual(db: DbAdapter, budgetId: string): Promise<BudgetRow[]> {
  const budget = await mustGet(db, "budget", budgetId);
  const year = String(budget.year);
  const cats = await db.select<{ id: string; name: string; kind: string }>(
    "SELECT id, name, kind FROM category WHERE archived_at IS NULL AND kind != 'transfer' ORDER BY kind DESC, name",
  );
  const lines = await db.select<{ category_id: string; month: number | null; amount_minor: number }>(
    "SELECT category_id, month, amount_minor FROM budget_line WHERE budget_id = ?",
    [budgetId],
  );
  const actuals = await db.select<{ category_id: string; m: string; s: number }>(
    `SELECT category_id, substr(booking_date, 6, 2) AS m, SUM(amount_minor) AS s FROM bank_transaction
      WHERE substr(booking_date, 1, 4) = ? AND category_id IS NOT NULL GROUP BY category_id, m`,
    [year],
  );
  const rows = new Map<string, BudgetRow>();
  for (const c of cats) {
    rows.set(c.id, { category_id: c.id, name: c.name, kind: c.kind, budget: Array(12).fill(0), actual: Array(12).fill(0), budget_total: 0, actual_total: 0 });
  }
  for (const l of lines) {
    const r = rows.get(l.category_id);
    if (!r) continue;
    if (l.month === null) r.budget = r.budget.map((v) => v + l.amount_minor);
    else r.budget[l.month - 1]! += l.amount_minor;
  }
  for (const a of actuals) {
    const r = rows.get(a.category_id);
    if (!r) continue;
    r.actual[Number(a.m) - 1]! += r.kind === "income" ? a.s : -a.s;
  }
  for (const r of rows.values()) {
    r.budget_total = r.budget.reduce((x, y) => x + y, 0);
    r.actual_total = r.actual.reduce((x, y) => x + y, 0);
  }
  return [...rows.values()].filter((r) => r.budget_total !== 0 || r.actual_total !== 0);
}

export interface MonthFinance {
  rows: { category_id: string; name: string; kind: string; budget: number; actual: number }[];
  uncategorized: number;
}

/** "Økonomi denne måned" on the dashboard: top-level categories (spec 04). */
export async function monthFinance(db: DbAdapter, yearMonth: string): Promise<MonthFinance> {
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(5, 7));
  const budgets = await db.select<{ id: string }>("SELECT id FROM budget WHERE year = ? ORDER BY rowid", [year]);
  const map = new Map<string, MonthFinance["rows"][number]>();
  const top = await db.select<{ id: string; parent_id: string | null; name: string; kind: string }>(
    "SELECT id, parent_id, name, kind FROM category WHERE kind != 'transfer'",
  );
  const byId = new Map(top.map((c) => [c.id, c]));
  const rootOf = (id: string) => {
    let c = byId.get(id);
    while (c?.parent_id && byId.get(c.parent_id)) c = byId.get(c.parent_id);
    return c;
  };
  const add = (catId: string, field: "budget" | "actual", v: number) => {
    const root = rootOf(catId);
    if (!root) return;
    const row = map.get(root.id) ?? { category_id: root.id, name: root.name, kind: root.kind, budget: 0, actual: 0 };
    row[field] += v;
    map.set(root.id, row);
  };
  for (const b of budgets) {
    const lines = await db.select<{ category_id: string; amount_minor: number }>(
      "SELECT category_id, amount_minor FROM budget_line WHERE budget_id = ? AND (month IS NULL OR month = ?)",
      [b.id, month],
    );
    for (const l of lines) add(l.category_id, "budget", l.amount_minor);
  }
  const tx = await db.select<{ category_id: string; s: number; kind: string }>(
    `SELECT t.category_id, SUM(t.amount_minor) AS s, c.kind FROM bank_transaction t JOIN category c ON c.id = t.category_id
      WHERE substr(t.booking_date, 1, 7) = ? GROUP BY t.category_id`,
    [yearMonth],
  );
  for (const t of tx) add(t.category_id, "actual", t.kind === "income" ? t.s : -t.s);
  const unc = await db.select<{ n: number }>(
    "SELECT count(*) AS n FROM bank_transaction WHERE category_id IS NULL AND substr(booking_date, 1, 7) = ?",
    [yearMonth],
  );
  return { rows: [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "da")), uncategorized: unc[0]?.n ?? 0 };
}

export interface RecurringSummary {
  /** `ended`: the end date has passed; listed, but not counted in the totals. */
  items: (Row & { monthly_minor: number; ended: boolean })[];
  monthly_total_minor: number;
  /** Monthly total per priority (migration 0005): keys "1".."5" and "none" (not rated). */
  monthly_by_priority: Record<string, number>;
}

/** Labels for recurring_expense.priority: 5 = obligatorisk … 1 = kan undværes. */
export const RECURRING_PRIORITY: [number, string][] = [
  [5, "Obligatorisk"],
  [4, "Vigtig"],
  [3, "Nyttig"],
  [2, "Rart at have"],
  [1, "Kan undværes"],
];

export async function recurringSummary(
  db: DbAdapter,
  opts: { today?: string; propertyId?: string; vehicleId?: string } = {},
): Promise<RecurringSummary> {
  const where = ["r.archived_at IS NULL"];
  const params: string[] = [];
  if (opts.propertyId) {
    where.push("r.property_id = ?");
    params.push(opts.propertyId);
  }
  if (opts.vehicleId) {
    where.push("r.vehicle_id = ?");
    params.push(opts.vehicleId);
  }
  const rows = await db.select<Row>(
    `SELECT r.*, c.name AS category_name, p.name AS property_name, v.name AS vehicle_name FROM recurring_expense r
       LEFT JOIN category c ON c.id = r.category_id LEFT JOIN property p ON p.id = r.property_id LEFT JOIN vehicle v ON v.id = r.vehicle_id
      WHERE ${where.join(" AND ")} ORDER BY r.name`,
    params,
  );
  const items = rows.map((r) => ({
    ...r,
    monthly_minor: monthlyAverage(Number(r.amount_minor), String(r.period)),
    ended: Boolean(opts.today && r.end_date && String(r.end_date) < opts.today),
  }));
  const active = items.filter((i) => !i.ended);
  const byPriority: Record<string, number> = {};
  for (const i of active) {
    const p = (i as Row).priority;
    const k = p == null ? "none" : String(p);
    byPriority[k] = (byPriority[k] ?? 0) + i.monthly_minor;
  }
  return { items, monthly_total_minor: active.reduce((a, i) => a + i.monthly_minor, 0), monthly_by_priority: byPriority };
}

// ---------- Loans (migration 0006) ----------

export const LOAN_KINDS: [string, string][] = [
  ["mortgage", "Realkreditlån"],
  ["bank", "Banklån"],
  ["car", "Billån"],
  ["student", "SU-lån"],
  ["consumer", "Forbrugslån"],
  ["private", "Privat lån"],
  ["other", "Andet"],
];

export interface LoanSummary {
  items: (Row & { monthly_payment_minor: number; lender_name: string | null })[];
  balance_total_minor: number;
  monthly_payment_total_minor: number;
}

/** Active loans with the payment as a monthly average, and totals. Optionally only one property's or vehicle's. */
export async function loanSummary(db: DbAdapter, opts: { propertyId?: string; vehicleId?: string } = {}): Promise<LoanSummary> {
  const where = ["l.archived_at IS NULL"];
  const params: string[] = [];
  if (opts.propertyId) {
    where.push("l.property_id = ?");
    params.push(opts.propertyId);
  }
  if (opts.vehicleId) {
    where.push("l.vehicle_id = ?");
    params.push(opts.vehicleId);
  }
  const rows = await db.select<Row>(
    `SELECT l.*, c.name AS lender_name FROM loan l LEFT JOIN contact c ON c.id = l.lender_contact_id WHERE ${where.join(" AND ")} ORDER BY l.name`,
    params,
  );
  const items = rows.map((r) => ({
    ...r,
    lender_name: (r.lender_name as string | null) ?? null,
    monthly_payment_minor: r.payment_minor == null ? 0 : monthlyAverage(Number(r.payment_minor), String(r.payment_period)),
  }));
  return {
    items,
    balance_total_minor: items.reduce((a, i) => a + Number((i as Row).balance_minor ?? 0), 0),
    monthly_payment_total_minor: items.reduce((a, i) => a + i.monthly_payment_minor, 0),
  };
}

// ---------- Generic profiles stored in settings ----------

export const PROFILES_KEY = "import.profiles";

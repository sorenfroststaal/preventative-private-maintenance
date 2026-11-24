import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  budgetVsActual,
  commitBankImport,
  createEntity,
  decodeBankFile,
  listTransactions,
  monthFinance,
  parseBankDate,
  parseCsv,
  parseDanishAmount,
  parseGeneric,
  parseSparkron,
  previewBankImport,
  recurringSummary,
  setTransactionCategory,
  suggestPattern,
  ValidationError,
} from "../src";
import { ctxFor, newArchive, writeTempFile } from "./helpers";

const fixture = join(__dirname, "../../../fixtures/bank/sparkron-eksempel.csv");

describe("Danish parsing", () => {
  it("amounts", () => {
    expect(parseDanishAmount("-1.234,56")).toBe(-123456);
    expect(parseDanishAmount("28.500,00")).toBe(2850000);
    expect(parseDanishAmount("-245,5")).toBe(-24550);
    expect(parseDanishAmount("12")).toBe(1200);
    expect(parseDanishAmount("1.000.000,00")).toBe(100000000);
    expect(parseDanishAmount(" -612,35 ")).toBe(-61235);
    expect(parseDanishAmount("1,234.56")).toBeNull();
    expect(parseDanishAmount("12,345")).toBeNull();
    expect(parseDanishAmount("abc")).toBeNull();
    expect(parseDanishAmount("1.23,00")).toBeNull();
  });
  it("dates", () => {
    expect(parseBankDate("02-11-2026")).toBe("2026-11-02");
    expect(parseBankDate("02.11.2026")).toBe("2026-11-02");
    expect(parseBankDate("31-02-2026")).toBeNull();
    expect(parseBankDate("2026-11-02")).toBeNull();
    expect(parseBankDate("2026-11-02", "YYYY-MM-DD")).toBe("2026-11-02");
  });
  it("CSV with quotes", () => {
    expect(parseCsv('a;"b;c";"d ""e"""\r\n1;2;3', ";")).toEqual([
      ["a", "b;c", 'd "e"'],
      ["1", "2", "3"],
    ]);
  });
  it("UTF-8 with BOM and Windows-1252 fallback", () => {
    expect(decodeBankFile(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Løn")]))).toBe("Løn");
    // "Løn" in Windows-1252: ø = 0xF8
    expect(decodeBankFile(new Uint8Array([0x4c, 0xf8, 0x6e]))).toBe("Løn");
  });
});

describe("phase 2.4 – sparkron profile", () => {
  it("parses the fixture", () => {
    const r = parseSparkron(decodeBankFile(readFileSync(fixture)));
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(6);
    expect(r.rows[0]).toEqual({ line: 2, booking_date: "2026-11-02", text: "Netto 1234 Randers", amount_minor: -24550, balance_minor: null });
    expect(r.rows[1]?.amount_minor).toBe(2850000);
  });

  it("accepts comma as delimiter with quoted amounts and DD.MM.YYYY", () => {
    const r = parseSparkron('Dato,Posteringstekst,Beløb\n02.11.2026,"Netto, Randers","-1.245,50"\n\n');
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([{ line: 2, booking_date: "2026-11-02", text: "Netto, Randers", amount_minor: -124550, balance_minor: null }]);
  });

  it("one invalid row rejects the whole import with line numbers", () => {
    const r = parseSparkron("Dato;Posteringstekst;Beløb\n02-11-2026;Ok;-1,00\n32-11-2026;Dårlig dato;-2,00\n03-11-2026;Dårligt beløb;abc\n");
    expect(r.errors).toEqual([
      { line: 3, message: 'Ugyldig dato: "32-11-2026"' },
      { line: 4, message: 'Ugyldigt beløb: "abc"' },
    ]);
  });

  it("rejects a wrong header", () => {
    expect(parseSparkron("Dato;Tekst;Beløb;Saldo\n").errors[0]?.message).toMatch(/Overskriften/);
  });

  it("imports, categorises with rules and finds 0 new rows the second time", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const acc = await createEntity(ctx, "account", { name: "Budgetkonto", bank: "Sparekassen Kronjylland" });
    const food = (await archive.db.select<{ id: string }>("SELECT id FROM category WHERE name = 'Mad og dagligvarer'"))[0]!.id;
    await createEntity(ctx, "category_rule", { match_type: "contains", pattern: "NETTO", category_id: food });
    const parsed = parseSparkron(decodeBankFile(readFileSync(fixture)));

    const preview = await previewBankImport(archive.db, String(acc.id), parsed);
    expect(preview).toMatchObject({ total: 6, newRows: 6, duplicates: 0 });
    expect(preview.sample).toHaveLength(6);

    const first = await commitBankImport(env, archive, ctx, { accountId: String(acc.id), parsed, filePath: fixture });
    expect(first).toMatchObject({ total: 6, imported: 6, duplicates: 0, categorized: 1 });
    // The two identical MobilePay rows are both imported (index n in the hash).
    expect(await listTransactions(archive.db, { text: "MobilePay" })).toHaveLength(2);
    const netto = (await listTransactions(archive.db, { text: "Netto" }))[0]!;
    expect(netto).toMatchObject({ category_id: food, category_source: "rule", category_name: "Mad og dagligvarer" });

    const again = await commitBankImport(env, archive, ctx, { accountId: String(acc.id), parsed, filePath: fixture });
    expect(again).toMatchObject({ imported: 0, duplicates: 6 });
    expect(await previewBankImport(archive.db, String(acc.id), parsed)).toMatchObject({ newRows: 0, duplicates: 6 });
    expect(await archive.db.select("SELECT * FROM bank_transaction")).toHaveLength(6);
    // Raw file kept once as a document; two batches.
    const docs = await archive.db.select<{ source: string; mime: string }>("SELECT source, mime FROM document");
    expect(docs).toEqual([{ source: "bank_import", mime: "text/csv" }]);
    expect(await archive.db.select("SELECT * FROM import_batch")).toHaveLength(2);
  });

  it("refuses to import a file with errors", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const acc = await createEntity(ctx, "account", { name: "K" });
    const p = await writeTempFile("x.csv", "Dato;Posteringstekst;Beløb\nfoo;bar;baz\n");
    const parsed = parseSparkron(readFileSync(p, "utf8"));
    await expect(commitBankImport(env, archive, ctx, { accountId: String(acc.id), parsed, filePath: p })).rejects.toBeInstanceOf(ValidationError);
    expect(await archive.db.select("SELECT * FROM bank_transaction")).toHaveLength(0);
  });

  it("Windows-1252 file with Danish amounts imports correctly", async () => {
    const latin = new Uint8Array([
      ...new TextEncoder().encode("Dato;Posteringstekst;Bel"),
      0xf8,
      ...new TextEncoder().encode("b\r\n01-12-2026;K"),
      0xf8,
      ...new TextEncoder().encode("bmand;-1.234,56\r\n"),
    ]);
    const r = parseSparkron(decodeBankFile(latin));
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ text: "Købmand", amount_minor: -123456, booking_date: "2026-12-01" });
  });
});

describe("generic profile", () => {
  it("maps columns with balance", () => {
    const r = parseGeneric("x|y|2026-11-02|Husleje|-9.500,00|1.000,00\n", {
      name: "Test",
      delimiter: "|",
      hasHeader: false,
      dateFormat: "YYYY-MM-DD",
      columns: { date: 2, text: 3, amount: 4, balance: 5 },
    });
    expect(r.profile).toBe("generic:Test");
    expect(r.rows).toEqual([{ line: 1, booking_date: "2026-11-02", text: "Husleje", amount_minor: -950000, balance_minor: 100000 }]);
  });
});

describe("categories, learned rules, budget and recurring expenses", () => {
  it("manual category can create a learned rule used by the next import", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const acc = await createEntity(ctx, "account", { name: "K" });
    const cats = Object.fromEntries((await archive.db.select<{ id: string; name: string }>("SELECT id, name FROM category")).map((c) => [c.name, c.id]));
    const p1 = await writeTempFile("a.csv", "Dato;Posteringstekst;Beløb\n05-11-2026;Q8 Benzin 4411;-500,00\n");
    await commitBankImport(env, archive, ctx, { accountId: String(acc.id), parsed: parseSparkron(readFileSync(p1, "utf8")), filePath: p1 });
    const tx = (await listTransactions(archive.db))[0]!;
    expect(tx.category_id).toBeNull();
    expect(suggestPattern(String(tx.text))).toBe("Q8 Benzin");
    await setTransactionCategory(ctx, String(tx.id), cats["Transport"]!, { learnPattern: "Q8" });
    expect((await listTransactions(archive.db))[0]).toMatchObject({ category_source: "user", category_name: "Transport" });
    const rules = await archive.db.select<{ created_from: string }>("SELECT created_from FROM category_rule");
    expect(rules).toEqual([{ created_from: "learned" }]);
    const p2 = await writeTempFile("b.csv", "Dato;Posteringstekst;Beløb\n20-11-2026;Q8 Benzin 9999;-450,00\n");
    const r = await commitBankImport(env, archive, ctx, { accountId: String(acc.id), parsed: parseSparkron(readFileSync(p2, "utf8")), filePath: p2 });
    expect(r.categorized).toBe(1);
  });

  it("budget vs actual per month and dashboard month summary", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const db = archive.db;
    const cats = Object.fromEntries((await db.select<{ id: string; name: string }>("SELECT id, name FROM category")).map((c) => [c.name, c.id]));
    const acc = await createEntity(ctx, "account", { name: "K" });
    const b = await createEntity(ctx, "budget", { year: 2026, name: "Familie" });
    await createEntity(ctx, "budget_line", { budget_id: String(b.id), category_id: cats["Mad og dagligvarer"]!, amount_minor: 600000 });
    await createEntity(ctx, "budget_line", { budget_id: String(b.id), category_id: cats["Fritid"]!, month: 12, amount_minor: 200000 });
    const tx = (date: string, amount: number, cat: string | null, h: string) =>
      createEntity(ctx, "bank_transaction", { account_id: String(acc.id), booking_date: date, text: "x", amount_minor: amount, category_id: cat, dedupe_hash: h });
    await tx("2026-11-02", -24550, cats["Mad og dagligvarer"]!, "1");
    await tx("2026-11-20", -100000, cats["Mad og dagligvarer"]!, "2");
    await tx("2026-11-03", 2850000, cats["Indtægt"]!, "3");
    await tx("2026-11-04", -5000, null, "4");
    await tx("2025-11-04", -9999, cats["Mad og dagligvarer"]!, "5");

    const rows = await budgetVsActual(db, String(b.id));
    const food = rows.find((r) => r.name === "Mad og dagligvarer")!;
    expect(food.budget[0]).toBe(600000);
    expect(food.budget_total).toBe(7200000);
    expect(food.actual[10]).toBe(124550);
    expect(food.actual_total).toBe(124550);
    expect(rows.find((r) => r.name === "Fritid")?.budget[11]).toBe(200000);
    expect(rows.find((r) => r.name === "Indtægt")?.actual[10]).toBe(2850000);

    const m = await monthFinance(db, "2026-11");
    expect(m.uncategorized).toBe(1);
    expect(m.rows.find((r) => r.name === "Mad og dagligvarer")).toMatchObject({ budget: 600000, actual: 124550 });
  });

  it("recurring expenses give monthly averages", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    await createEntity(ctx, "recurring_expense", { name: "Streaming", amount_minor: 12900, period: "month" });
    await createEntity(ctx, "recurring_expense", { name: "Forsikring", amount_minor: 189000, period: "year" });
    await createEntity(ctx, "recurring_expense", { name: "Vand", amount_minor: 90000, period: "quarter" });
    const s = await recurringSummary(archive.db);
    expect(s.items.map((i) => [i.name, i.monthly_minor])).toEqual([
      ["Forsikring", 15750],
      ["Streaming", 12900],
      ["Vand", 30000],
    ]);
    expect(s.monthly_total_minor).toBe(58650);
  });
});

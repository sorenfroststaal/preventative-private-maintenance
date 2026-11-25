import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  archiveEntity,
  loanSummary,
  budgetVsActual,
  budgetFromRecurring,
  categoryHistory,
  categoryTrends,
  ensureBudget,
  setFoodBudget,
  foodHistory,
  monthlyFlow,
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

  it("recurring expenses have a priority 1-5 (migration 0005), totals per priority, and can be archived", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const st = await createEntity(ctx, "recurring_expense", { name: "Streaming", amount_minor: 12900, period: "month", priority: 1 });
    await createEntity(ctx, "recurring_expense", { name: "Husleje", amount_minor: 800000, period: "month", priority: 5 });
    await createEntity(ctx, "recurring_expense", { name: "Avis", amount_minor: 30000, period: "quarter" });
    await expect(createEntity(ctx, "recurring_expense", { name: "x", amount_minor: 1, period: "month", priority: 6 })).rejects.toThrow();
    await expect(archive.db.execute("UPDATE recurring_expense SET priority = 0 WHERE id = ?", [String(st.id)])).rejects.toThrow();
    let s = await recurringSummary(archive.db);
    expect(s.monthly_by_priority).toEqual({ "1": 12900, "5": 800000, none: 10000 });
    await archiveEntity(ctx, "recurring_expense", String(st.id));
    s = await recurringSummary(archive.db);
    expect(s.items.map((i) => i.name)).toEqual(["Avis", "Husleje"]);
  });

  it("history: income/expense per month, one category over time, and the food budget", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const db = archive.db;
    const cats = Object.fromEntries((await db.select<{ id: string; name: string }>("SELECT id, name FROM category")).map((c) => [c.name, c.id]));
    const acc = await createEntity(ctx, "account", { name: "K" });
    const sub = await createEntity(ctx, "category", { name: "Streaming", kind: "expense", parent_id: cats["Fritid"]! });
    const tx = (date: string, amount: number, cat: string | null, h: string) =>
      createEntity(ctx, "bank_transaction", { account_id: String(acc.id), booking_date: date, text: "x", amount_minor: amount, category_id: cat, dedupe_hash: h });
    await tx("2026-10-01", 3000000, cats["Indtægt"]!, "1");
    await tx("2026-10-05", -400000, cats["Mad og dagligvarer"]!, "2");
    await tx("2026-10-06", 10000, cats["Mad og dagligvarer"]!, "3"); // refund lowers food expense
    await tx("2026-10-07", -12900, String(sub.id), "4");
    await tx("2026-11-07", -12900, String(sub.id), "5");
    await tx("2026-11-08", -5000, null, "6");
    await tx("2026-11-09", 2000, null, "7");
    const transfer = Object.entries(cats).find(([n]) => /overf/i.test(n));
    if (transfer) await tx("2026-11-10", -100000, transfer[1], "8");
    await tx("2025-01-01", -999999, cats["Mad og dagligvarer"]!, "9"); // outside the range

    const flow = await monthlyFlow(db, "2026-11-25", 3);
    expect(flow).toEqual([
      { month: "2026-09", income_minor: 0, expense_minor: 0 },
      { month: "2026-10", income_minor: 3000000, expense_minor: 402900 },
      { month: "2026-11", income_minor: 2000, expense_minor: 17900 },
    ]);

    const b = await createEntity(ctx, "budget", { year: 2026, name: "Familie" });
    await createEntity(ctx, "budget_line", { budget_id: String(b.id), category_id: cats["Mad og dagligvarer"]!, amount_minor: 450000 });
    await createEntity(ctx, "budget_line", { budget_id: String(b.id), category_id: cats["Fritid"]!, month: 11, amount_minor: 20000 });

    const fritid = await categoryHistory(db, cats["Fritid"]!, "2026-11-25", 2);
    expect(fritid).toEqual([
      { month: "2026-10", amount_minor: 12900, budget_minor: 0 },
      { month: "2026-11", amount_minor: 12900, budget_minor: 20000 },
    ]);
    expect((await categoryHistory(db, cats["Indtægt"]!, "2026-11-25", 2))[0]!.amount_minor).toBe(3000000);

    const food = await foodHistory(db, "2026-11-25", 3);
    expect(food.has_category).toBe(true);
    expect(food.months.map((m) => [m.month, m.amount_minor, m.budget_minor])).toEqual([
      ["2026-09", 0, 450000],
      ["2026-10", 390000, 450000],
      ["2026-11", 0, 450000],
    ]);
    expect(food.average_minor).toBe(390000);

    const trends = await categoryTrends(db, "2026-11-25", 2);
    expect(trends.months).toEqual(["2026-10", "2026-11"]);
    expect(trends.rows.find((r) => r.name === "Fritid › Streaming")?.values).toEqual([12900, 12900]);
    expect(trends.rows.find((r) => r.name === "Fritid")?.values).toEqual([12900, 12900]);
    expect(trends.rows[0]!.name).toBe("Indtægt");
  });

  it("loans (migration 0006): monthly payment, totals, filtered by vehicle; recurring expenses end and link to a vehicle", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const db = archive.db;
    const car = await createEntity(ctx, "vehicle", { name: "Familiebil", purchase_date: "2024-03-01", purchase_price_minor: 18000000 });
    await createEntity(ctx, "loan", { name: "Boliglån", kind: "mortgage", balance_minor: 150000000, interest_rate: 4.25, payment_minor: 2400000, payment_period: "quarter" });
    await createEntity(ctx, "loan", { name: "Billån", kind: "car", balance_minor: 9000000, payment_minor: 250000, vehicle_id: String(car.id) });
    await expect(createEntity(ctx, "loan", { name: "X", balance_minor: -1 })).rejects.toThrow();
    const all = await loanSummary(db);
    expect(all.items.map((l) => [l.name, l.monthly_payment_minor])).toEqual([
      ["Billån", 250000],
      ["Boliglån", 800000],
    ]);
    expect(all.balance_total_minor).toBe(159000000);
    expect(all.monthly_payment_total_minor).toBe(1050000);
    expect((await loanSummary(db, { vehicleId: String(car.id) })).items.map((l) => l.name)).toEqual(["Billån"]);

    await createEntity(ctx, "recurring_expense", { name: "Bilforsikring", amount_minor: 600000, period: "year", vehicle_id: String(car.id) });
    await createEntity(ctx, "recurring_expense", { name: "El", amount_minor: 90000, period: "month", amount_variable: 1 });
    await createEntity(ctx, "recurring_expense", { name: "Gammel avis", amount_minor: 20000, period: "month", end_date: "2026-10-31" });
    const r = await recurringSummary(db, { today: "2026-11-25" });
    expect(r.items.map((i) => [i.name, i.ended])).toEqual([
      ["Bilforsikring", false],
      ["El", false],
      ["Gammel avis", true],
    ]);
    expect(r.monthly_total_minor).toBe(50000 + 90000);
    expect(r.items.find((i) => i.name === "Bilforsikring")?.vehicle_name).toBe("Familiebil");
    expect((await recurringSummary(db, { vehicleId: String(car.id) })).items.map((i) => i.name)).toEqual(["Bilforsikring"]);
    expect((await recurringSummary(db)).monthly_total_minor).toBe(160000);
  });

  it("food budget can be set in one step, and a budget can be suggested from recurring expenses", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const db = archive.db;
    const cats = Object.fromEntries((await db.select<{ id: string; name: string }>("SELECT id, name FROM category")).map((c) => [c.name, c.id]));
    await setFoodBudget(ctx, 2026, 500000);
    await setFoodBudget(ctx, 2026, 550000);
    expect(await db.select("SELECT b.year, l.month, l.amount_minor FROM budget_line l JOIN budget b ON b.id = l.budget_id")).toEqual([{ year: 2026, month: null, amount_minor: 550000 }]);
    expect((await foodHistory(db, "2026-11-25", 1)).months[0]!.budget_minor).toBe(550000);

    await createEntity(ctx, "recurring_expense", { name: "Streaming", amount_minor: 12900, period: "month", category_id: cats["Fritid"]! });
    await createEntity(ctx, "recurring_expense", { name: "Netflix", amount_minor: 120000, period: "year", category_id: cats["Fritid"]! });
    await createEntity(ctx, "recurring_expense", { name: "Mad-abonnement", amount_minor: 1, period: "month", category_id: cats["Mad og dagligvarer"]! });
    const budgetId = await ensureBudget(ctx, 2026);
    expect(await budgetFromRecurring(ctx, budgetId)).toBe(1);
    expect(await budgetFromRecurring(ctx, budgetId)).toBe(0);
    const fritid = await db.select<{ amount_minor: number }>("SELECT amount_minor FROM budget_line WHERE category_id = ?", [cats["Fritid"]!]);
    expect(fritid).toEqual([{ amount_minor: 22900 }]);
  });
});

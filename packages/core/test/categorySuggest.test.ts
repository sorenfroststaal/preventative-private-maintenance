import { describe, expect, it } from "vitest";
import { acceptCategorySuggestions, categorize, createEntity, payeeKey, rulePatternFor, suggestCategories } from "../src";
import { ctxFor, newArchive } from "./helpers";

describe("phase 4.2 – category suggestions", () => {
  it("payee key drops case, dates, card numbers and other numbers", () => {
    expect(payeeKey("Dankort-nota NETTO 4711 12.11")).toBe("dankort nota netto");
    expect(payeeKey("Dankort-nota Netto 4711 03.12.2026")).toBe("dankort nota netto");
    expect(payeeKey("VISA xxxx1234 Spotify P1A2B3")).toBe("visa spotify p a b");
    expect(payeeKey("MobilePay 12. nov 2026 Hans")).toBe("mobilepay hans");
    expect(payeeKey("Løn 2026-11-28 Firma A/S")).toBe("løn firma a s");
    expect(payeeKey("12345")).toBe("");
    expect(rulePatternFor("Dankort-nota NETTO 4711 12.11")).toBe("dankort-nota netto");
    expect(rulePatternFor("4711 Føtex Århus 12.11")).toBe("føtex århus");
  });

  async function setup() {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const db = archive.db;
    const cats = Object.fromEntries((await db.select<{ id: string; name: string }>("SELECT id, name FROM category")).map((c) => [c.name, c.id]));
    const acc = await createEntity(ctx, "account", { name: "K" });
    let n = 0;
    const tx = async (text: string, amount: number, cat: string | null = null, date = "2026-11-01") =>
      String((await createEntity(ctx, "bank_transaction", { account_id: String(acc.id), booking_date: date, text, amount_minor: amount, category_id: cat, category_source: cat ? "user" : null, dedupe_hash: `h${n++}` })).id);
    return { ctx, db, cats, tx };
  }

  it("suggests the most frequent category for the same payee key and sign, with the 2-or-1 rule and no ties", async () => {
    const { db, cats, tx } = await setup();
    const food = cats["Mad og dagligvarer"]!;
    const fun = cats["Fritid"]!;
    // Netto: 2 × food, 1 × leisure → food.
    await tx("Dankort-nota Netto 4711 01.10", -20000, food);
    await tx("Dankort-nota Netto 4711 08.10", -30000, food);
    await tx("Dankort-nota Netto 4711 15.10", -5000, fun);
    const netto = await tx("Dankort-nota NETTO 4711 12.11", -25000);
    // Single earlier occurrence, no other category → suggested.
    await tx("Biografen 1234", -15000, fun);
    const bio = await tx("Biografen 5678", -16000);
    // Single occurrence but the key also has another category → not suggested (1 vs 1 is a tie too).
    await tx("Kiosken 1", -1000, food);
    await tx("Kiosken 2", -1000, fun);
    const kiosk = await tx("Kiosken 3", -1000);
    // Tie 2–2 → no suggestion.
    await tx("Torvet 1", -1000, food);
    await tx("Torvet 2", -1000, food);
    await tx("Torvet 3", -1000, fun);
    await tx("Torvet 4", -1000, fun);
    const torv = await tx("Torvet 5", -1000);
    // Same text, other sign → no history (income vs expense).
    const refund = await tx("Dankort-nota Netto 4711 20.11", 25000);
    // Nothing similar.
    const unknown = await tx("Helt ukendt butik", -100);

    const s = await suggestCategories(db);
    const by = new Map(s.map((x) => [x.transaction_id, x]));
    expect(by.get(netto)).toMatchObject({ category_id: food, source: "history", count: 2 });
    expect(by.get(bio)).toMatchObject({ category_id: fun, count: 1 });
    for (const id of [kiosk, torv, refund, unknown]) expect(by.has(id)).toBe(false);
  });

  it("rules go before suggestions", async () => {
    const { ctx, db, cats, tx } = await setup();
    await tx("Shell 1", -1000, cats["Mad og dagligvarer"]!);
    await tx("Shell 2", -1000, cats["Mad og dagligvarer"]!);
    await createEntity(ctx, "category_rule", { match_type: "contains", pattern: "shell", category_id: cats["Transport"]! });
    const id = await tx("Shell 3", -1000);
    expect((await suggestCategories(db)).find((x) => x.transaction_id === id)).toMatchObject({ category_id: cats["Transport"], source: "rule" });
  });

  it("accepting sets category_source user; a rule can be made so the next import is categorised", async () => {
    const { ctx, db, cats, tx } = await setup();
    const food = cats["Mad og dagligvarer"]!;
    await tx("Dankort-nota Netto 4711 01.10", -20000, food);
    await tx("Dankort-nota Netto 4711 08.10", -30000, food);
    const a = await tx("Dankort-nota NETTO 4711 12.11", -25000);
    const b = await tx("Dankort-nota Netto 4711 19.11", -26000);
    const s = await suggestCategories(db);
    expect(s).toHaveLength(2);
    expect(await acceptCategorySuggestions(ctx, s, { makeRule: true })).toBe(2);
    expect(await db.select("SELECT category_id, category_source FROM bank_transaction WHERE id IN (?, ?)", [a, b])).toEqual([
      { category_id: food, category_source: "user" },
      { category_id: food, category_source: "user" },
    ]);
    expect(await db.select("SELECT match_type, pattern, created_from FROM category_rule")).toEqual([{ match_type: "contains", pattern: "dankort-nota netto", created_from: "learned" }]);
    expect(await categorize(db, "Dankort-nota Netto 4711 02.01")).toBe(food);
    expect(await suggestCategories(db)).toEqual([]);
  });
});

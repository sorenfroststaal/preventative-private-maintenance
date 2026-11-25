import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BANK_PRESETS, detectBankPreset, detectSparkron, parseAmount, parseGeneric, resolvePreset } from "../src";

const fixture = (name: string) => readFileSync(join(__dirname, "../../../fixtures/bank", name), "utf8");
const EXPECTED = [
  { booking_date: "2026-11-02", text: "Netto 1234 Randers", amount_minor: -24550 },
  { booking_date: "2026-11-03", text: "Løn November", amount_minor: 2850000 },
  { booking_date: "2026-11-05", text: expect.stringMatching(/^MobilePay Hansen,? VVS$/), amount_minor: -312500 },
];

describe("phase 4.1 – bank presets", () => {
  it("has at least four presets besides sparkron, all marked as not verified", () => {
    expect(BANK_PRESETS.length).toBeGreaterThanOrEqual(4);
    expect(BANK_PRESETS.every((p) => !p.verified)).toBe(true);
    expect(new Set(BANK_PRESETS.map((p) => p.id)).size).toBe(BANK_PRESETS.length);
  });

  it.each([
    ["danske-bank-eksempel.csv", "danske_bank"],
    ["nordea-eksempel.csv", "nordea"],
    ["jyske-bank-eksempel.csv", "jyske_bank"],
    ["arbejdernes-landsbank-eksempel.csv", "arbejdernes_landsbank"],
    ["lunar-eksempel.csv", "lunar"],
  ])("%s is recognised by its headers and parsed to the same rows", (file, id) => {
    const text = fixture(file);
    expect(detectSparkron(text)).toBeNull();
    const d = detectBankPreset(text)!;
    expect(d.preset.id).toBe(id);
    const r = parseGeneric(text, d.profile);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual(EXPECTED.map((e) => expect.objectContaining(e)));
    expect(r.rows[0]!.balance_minor).toBe(1025450);
  });

  it("sparkron and unknown files are not taken by a preset", () => {
    expect(detectBankPreset(fixture("sparkron-eksempel.csv"))).toBeNull();
    expect(detectBankPreset("Dato;Tekst;Beløb\n01-01-2026;x;1,00\n")).toBeNull(); // Danske Bank needs Status and Afstemt
  });

  it("separate out/in columns: the sign in the file is ignored, an empty row is an error", () => {
    const p = resolvePreset(BANK_PRESETS.find((b) => b.id === "arbejdernes_landsbank")!, ["Bogført", "Tekst", "Udbetaling", "Indbetaling", "Saldo"])!;
    expect(p.columns).toMatchObject({ amount: null, debit: 2, credit: 3 });
    const r = parseGeneric("h\n01-11-2026;Ud med minus;-100,00;;\n02-11-2026;Ind;;50,00;\n03-11-2026;Tom;;;\n04-11-2026;Forkert;abc;;\n", p);
    expect(r.rows.map((x) => x.amount_minor)).toEqual([-10000, 5000]);
    expect(r.errors.map((e) => e.line)).toEqual([4, 5]);
  });

  it("a preset is a generic profile the user can adjust (e.g. another text column)", () => {
    const d = detectBankPreset(fixture("nordea-eksempel.csv"))!;
    const r = parseGeneric(fixture("nordea-eksempel.csv"), { ...d.profile, columns: { ...d.profile.columns, text: 4 } });
    expect(r.rows[1]!.text).toBe("Eksempel A/S");
  });

  it("amounts with a decimal point and the Unicode minus sign", () => {
    expect(parseAmount("1,234.50", ".")).toBe(123450);
    expect(parseAmount("−245.5", ".")).toBe(-24550);
    expect(parseAmount("-1.234,56")).toBe(-123456);
    expect(parseAmount("12.34.56", ".")).toBeNull();
  });
});

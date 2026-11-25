/**
 * Built-in bank presets (phase 4.1). Each preset is a generic profile whose columns are found by
 * header names, so the user can adjust it like any generic profile. None is verified against a real
 * export file yet; the UI says so ("ikke verificeret").
 */
import { parseCsv, type DateFormat, type GenericProfile } from "./finance";

type ColumnKey = "date" | "text" | "amount" | "debit" | "credit" | "balance";

export interface BankPreset {
  id: string;
  label: string;
  delimiter: string;
  dateFormat: DateFormat;
  decimal: "," | ".";
  /** Header names per column (lower case, any of them). Either `amount` or both `debit` and `credit`. */
  headers: Partial<Record<ColumnKey, string[]>>;
  /** Headers that must also be present to tell the preset apart from similar files. */
  extra?: string[];
  /** True once tested with a real export file from the bank. */
  verified: boolean;
}

export const BANK_PRESETS: BankPreset[] = [
  {
    id: "danske_bank",
    label: "Danske Bank",
    delimiter: ";",
    dateFormat: "DD.MM.YYYY",
    decimal: ",",
    headers: { date: ["dato"], text: ["tekst"], amount: ["beløb"], balance: ["saldo"] },
    extra: ["status", "afstemt"],
    verified: false,
  },
  {
    id: "nordea",
    label: "Nordea",
    delimiter: ";",
    dateFormat: "YYYY/MM/DD",
    decimal: ",",
    headers: { date: ["bogføringsdato"], text: ["beskrivelse"], amount: ["beløb"], balance: ["saldo"] },
    extra: ["afsender", "modtager"],
    verified: false,
  },
  {
    id: "jyske_bank",
    label: "Jyske Bank",
    delimiter: ";",
    dateFormat: "DD.MM.YYYY",
    decimal: ",",
    headers: { date: ["bogføringsdato"], text: ["tekst"], amount: ["beløb"], balance: ["saldo"] },
    extra: ["rentedato"],
    verified: false,
  },
  {
    id: "arbejdernes_landsbank",
    label: "Arbejdernes Landsbank",
    delimiter: ";",
    dateFormat: "DD-MM-YYYY",
    decimal: ",",
    headers: { date: ["bogført"], text: ["tekst"], debit: ["udbetaling"], credit: ["indbetaling"], balance: ["saldo"] },
    verified: false,
  },
  {
    id: "lunar",
    label: "Lunar",
    delimiter: ",",
    dateFormat: "YYYY-MM-DD",
    decimal: ".",
    headers: { date: ["date"], text: ["text", "description"], amount: ["amount"], balance: ["balance"] },
    verified: false,
  },
];

const clean = (h: string) => h.replace(/^\uFEFF/, "").trim().toLowerCase();

/** Column indexes for a preset from a header row, or null if a required column is missing. */
export function resolvePreset(preset: BankPreset, header: string[]): GenericProfile | null {
  const names = header.map(clean);
  const idx = (k: ColumnKey) => {
    const want = preset.headers[k];
    if (!want) return null;
    const i = names.findIndex((n) => want.includes(n));
    return i < 0 ? undefined : i;
  };
  const date = idx("date");
  const text = idx("text");
  const amount = idx("amount");
  const debit = idx("debit");
  const credit = idx("credit");
  const balance = idx("balance");
  if (date == null || text == null) return null;
  if (preset.headers.amount ? amount == null : debit == null || credit == null) return null;
  if ((preset.extra ?? []).some((e) => !names.includes(e))) return null;
  return {
    name: preset.label,
    delimiter: preset.delimiter,
    hasHeader: true,
    dateFormat: preset.dateFormat,
    decimal: preset.decimal,
    columns: { date, text, amount: amount ?? null, debit: debit ?? null, credit: credit ?? null, balance: balance ?? null },
  };
}

/** Recognises a bank by the header row (first line). Returns the preset and the resolved profile. */
export function detectBankPreset(text: string): { preset: BankPreset; profile: GenericProfile } | null {
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  for (const preset of BANK_PRESETS) {
    const header = parseCsv(firstLine, preset.delimiter)[0] ?? [];
    const profile = resolvePreset(preset, header);
    if (profile) return { preset, profile };
  }
  return null;
}

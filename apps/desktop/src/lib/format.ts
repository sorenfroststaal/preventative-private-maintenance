import type { Recurrence } from "@ppm/core";

const MONTHS = [
  "januar",
  "februar",
  "marts",
  "april",
  "maj",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "december",
];

/** 2026-11-24 → 24.11.2026 (spec README). */
export function formatDate(d: string | null | undefined): string {
  if (!d) return "–";
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
}

/** ISO timestamp → local "24.11.2026 19:05". */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 123450 → "1.234,50 kr." */
export function formatMoney(minor: number | null | undefined, currency = "DKK"): string {
  if (minor === null || minor === undefined) return "–";
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const kr = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const ore = String(abs % 100).padStart(2, "0");
  const unit = currency === "DKK" ? "kr." : currency;
  return `${neg ? "-" : ""}${kr},${ore} ${unit}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

const UNIT_SINGULAR = { day: "dag", week: "uge", month: "måned", year: "år" } as const;
const UNIT_PLURAL = { day: "dage", week: "uger", month: "måneder", year: "år" } as const;

function every(n: number, unit: Recurrence["unit"]): string {
  if (n === 1) return unit === "year" ? "hvert år" : unit === "month" ? "hver måned" : `hver ${UNIT_SINGULAR[unit]}`;
  return `hver ${n}. ${UNIT_SINGULAR[unit]}`;
}

/** Human-readable Danish description of a recurrence rule. */
export function describeRecurrence(r: Recurrence | null): string {
  if (!r) return "Engangsopgave";
  if (r.kind === "interval") {
    return `${cap(`${r.every} ${r.every === 1 ? UNIT_SINGULAR[r.unit] : UNIT_PLURAL[r.unit]}`)} efter udførelse`;
  }
  if (r.unit === "year") return `${cap(every(r.every, "year"))} d. ${r.day}. ${MONTHS[r.month! - 1]}`;
  if (r.unit === "month") return `${cap(every(r.every, "month"))} d. ${r.day}.`;
  return cap(every(r.every, r.unit));
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const MODULE_LABELS: Record<string, string> = {
  home: "Bolig og inventar",
  maintenance: "Vedligehold",
  vehicle: "Bil",
  finance: "Økonomi",
  insurance: "Forsikring",
  health: "Helbred",
  custom: "Egne",
};

export const MONTH_NAMES = MONTHS;

export function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

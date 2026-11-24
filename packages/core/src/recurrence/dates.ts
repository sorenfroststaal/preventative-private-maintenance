/** Calendar-date arithmetic on YYYY-MM-DD strings. No time zones involved (spec 04). */

export interface Ymd {
  y: number;
  m: number; // 1-12
  d: number;
}

export function parseYmd(s: string): Ymd {
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date ${s}`);
  return { y, m, d };
}

export function formatYmd({ y, m, d }: Ymd): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Builds a date, clamping the day to the month's length (31 → 28/29/30). */
export function clampYmd(y: number, m: number, d: number): Ymd {
  return { y, m, d: Math.min(d, daysInMonth(y, m)) };
}

export function addDays(s: string, n: number): string {
  const { y, m, d } = parseYmd(s);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return formatYmd({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
}

/** Adds months, clamping at month end: 2026-01-31 + 1 month = 2026-02-28. */
export function addMonths(s: string, n: number, day?: number): string {
  const { y, m, d } = parseYmd(s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return formatYmd(clampYmd(ny, nm, day ?? d));
}

export function compareYmd(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

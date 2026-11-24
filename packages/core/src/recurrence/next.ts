import type { Recurrence } from "../domain/schemas";
import { addDays, addMonths, clampYmd, formatYmd, parseYmd } from "./dates";

type Unit = Recurrence["unit"];

function add(date: string, every: number, unit: Unit): string {
  switch (unit) {
    case "day":
      return addDays(date, every);
    case "week":
      return addDays(date, every * 7);
    case "month":
      return addMonths(date, every);
    case "year":
      return addMonths(date, every * 12);
  }
}

type Fixed = Extract<Recurrence, { kind: "fixed" }>;

/** True if the date matches the fixed pattern (day clamped to month length). */
function matchesFixed(r: Fixed, date: string): boolean {
  const { y, m, d } = parseYmd(date);
  if (r.unit === "year") return m === r.month && d === clampYmd(y, m, r.day!).d;
  if (r.unit === "month") return d === clampYmd(y, m, r.day!).d;
  return true;
}

/** First date strictly after `after` that matches a year/month pattern. */
function firstMatchAfter(r: Fixed, after: string): string {
  const { y, m } = parseYmd(after);
  if (r.unit === "year") {
    const thisYear = formatYmd(clampYmd(y, r.month!, r.day!));
    return thisYear > after ? thisYear : formatYmd(clampYmd(y + 1, r.month!, r.day!));
  }
  // month
  const thisMonth = formatYmd(clampYmd(y, m, r.day!));
  return thisMonth > after ? thisMonth : addMonths(formatYmd({ y, m, d: 1 }), 1, r.day!);
}

/**
 * First due date for a new task when the user gave none. Fixed patterns define their own
 * date (first match on or after today); interval tasks have no date until the user sets
 * one, so null is returned ("dato mangler" rather than a guess).
 */
export function firstDueDate(r: Recurrence | null, today: string): string | null {
  if (!r || r.kind === "interval") return null;
  if (r.unit === "year" || r.unit === "month") {
    return matchesFixed(r, today) ? today : firstMatchAfter(r, today);
  }
  return null;
}

/**
 * Next due date after an occurrence is completed or skipped (spec 04):
 * - fixed: next date matching the pattern after the previous due date; completion date ignored.
 * - interval: completion date + every×unit; when skipped, counted from the previous due date.
 * When the previous occurrence had no due date, the completion date is used as base.
 */
export function nextDueDate(
  r: Recurrence,
  prev: { dueDate: string | null; completedDate: string; status: "done" | "skipped" },
): string {
  if (r.kind === "interval") {
    const base = prev.status === "skipped" && prev.dueDate ? prev.dueDate : prev.completedDate;
    return add(base, r.every, r.unit);
  }
  const base = prev.dueDate ?? prev.completedDate;
  if (r.unit === "day" || r.unit === "week") return add(base, r.every, r.unit);
  if (prev.dueDate && matchesFixed(r, prev.dueDate)) {
    // Step `every` periods from the matching previous due date, re-applying the pattern day.
    const months = r.unit === "year" ? r.every * 12 : r.every;
    const stepped = addMonths(prev.dueDate, months, 1);
    const { y, m } = parseYmd(stepped);
    return r.unit === "year"
      ? formatYmd(clampYmd(y, r.month!, r.day!))
      : formatYmd(clampYmd(y, m, r.day!));
  }
  return firstMatchAfter(r, base);
}

import type { Recurrence } from "@ppm/core";

/** Flat form state for the recurrence editor. */
export interface RecurrenceFormState {
  kind: "none" | "fixed" | "interval";
  unit: Recurrence["unit"];
  every: string;
  month: string;
  day: string;
}

export const emptyRecurrenceForm: RecurrenceFormState = {
  kind: "none",
  unit: "year",
  every: "1",
  month: "1",
  day: "1",
};

/** Converts the form to a Recurrence, or returns an error text in Danish. */
export function toRecurrence(f: RecurrenceFormState): { value: Recurrence | null } | { error: string } {
  if (f.kind === "none") return { value: null };
  const every = Number(f.every);
  if (!Number.isInteger(every) || every < 1) return { error: "Interval skal være et helt tal på mindst 1" };
  if (f.kind === "interval") return { value: { kind: "interval", unit: f.unit, every } };
  const day = Number(f.day);
  const month = Number(f.month);
  if (f.unit === "year") {
    if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return { error: "Vælg måned og dag" };
    return { value: { kind: "fixed", unit: "year", every, month, day } };
  }
  if (f.unit === "month") {
    if (!(day >= 1 && day <= 31)) return { error: "Vælg dag i måneden" };
    return { value: { kind: "fixed", unit: "month", every, day } };
  }
  return { value: { kind: "fixed", unit: f.unit, every } };
}

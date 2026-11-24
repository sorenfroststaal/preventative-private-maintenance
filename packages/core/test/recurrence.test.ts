import { describe, expect, it } from "vitest";
import { addMonths, firstDueDate, nextDueDate, zRecurrence, type Recurrence } from "../src";

const fixedYear = (month: number, day: number, every = 1): Recurrence => ({ kind: "fixed", unit: "year", every, month, day });
const fixedMonth = (day: number, every = 1): Recurrence => ({ kind: "fixed", unit: "month", every, day });
const interval = (unit: Recurrence["unit"], every: number): Recurrence => ({ kind: "interval", unit, every });

describe("phase 1.7 – recurrence (spec test cases)", () => {
  it("31.01 + 1 month gives 28.02 (non-leap) or 29.02 (leap)", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(nextDueDate(interval("month", 1), { dueDate: "2026-01-31", completedDate: "2026-01-31", status: "done" })).toBe("2026-02-28");
    expect(nextDueDate(interval("month", 1), { dueDate: "2028-01-31", completedDate: "2028-01-31", status: "done" })).toBe("2028-02-29");
  });

  it("interval of 6 months completed 15.03 gives 15.09", () => {
    expect(nextDueDate(interval("month", 6), { dueDate: "2026-03-01", completedDate: "2026-03-15", status: "done" })).toBe("2026-09-15");
  });

  it("fixed yearly 01.10 completed 20.11 gives 01.10 the year after", () => {
    expect(nextDueDate(fixedYear(10, 1), { dueDate: "2026-10-01", completedDate: "2026-11-20", status: "done" })).toBe("2027-10-01");
  });
});

describe("recurrence – further rules", () => {
  it("interval: skipping counts from the previous due date", () => {
    expect(nextDueDate(interval("month", 3), { dueDate: "2026-01-10", completedDate: "2026-02-20", status: "skipped" })).toBe("2026-04-10");
  });

  it("interval: missing due date uses completion date", () => {
    expect(nextDueDate(interval("year", 1), { dueDate: null, completedDate: "2026-05-05", status: "skipped" })).toBe("2027-05-05");
  });

  it("interval: days and weeks", () => {
    expect(nextDueDate(interval("day", 10), { dueDate: null, completedDate: "2026-12-25", status: "done" })).toBe("2027-01-04");
    expect(nextDueDate(interval("week", 2), { dueDate: null, completedDate: "2026-12-25", status: "done" })).toBe("2027-01-08");
  });

  it("fixed monthly day 31 clamps each month and returns to 31", () => {
    const r = fixedMonth(31);
    const a = nextDueDate(r, { dueDate: "2026-01-31", completedDate: "2026-01-31", status: "done" });
    expect(a).toBe("2026-02-28");
    const b = nextDueDate(r, { dueDate: a, completedDate: a, status: "done" });
    expect(b).toBe("2026-03-31");
  });

  it("fixed: completion date is irrelevant, even when completed early or late", () => {
    const r = fixedYear(4, 1);
    expect(nextDueDate(r, { dueDate: "2026-04-01", completedDate: "2026-03-01", status: "done" })).toBe("2027-04-01");
    expect(nextDueDate(r, { dueDate: "2026-04-01", completedDate: "2027-06-01", status: "done" })).toBe("2027-04-01");
  });

  it("fixed every 2 years", () => {
    expect(nextDueDate(fixedYear(6, 15, 2), { dueDate: "2026-06-15", completedDate: "2026-06-16", status: "done" })).toBe("2028-06-15");
  });

  it("fixed yearly 29.02 clamps to 28.02 in non-leap years", () => {
    expect(nextDueDate(fixedYear(2, 29), { dueDate: "2028-02-29", completedDate: "2028-02-29", status: "done" })).toBe("2029-02-28");
    expect(nextDueDate(fixedYear(2, 29), { dueDate: "2031-02-28", completedDate: "2031-02-28", status: "done" })).toBe("2032-02-29");
  });

  it("fixed: a previous due date off-pattern moves to the next matching date", () => {
    expect(nextDueDate(fixedYear(10, 1), { dueDate: "2026-09-15", completedDate: "2026-09-15", status: "done" })).toBe("2026-10-01");
    expect(nextDueDate(fixedMonth(15), { dueDate: "2026-03-20", completedDate: "2026-03-20", status: "done" })).toBe("2026-04-15");
    // Due date before the pattern day in the same month (case from codex/app): stays in that month.
    expect(nextDueDate(fixedMonth(20), { dueDate: "2026-03-10", completedDate: "2026-04-15", status: "done" })).toBe("2026-03-20");
  });

  it("firstDueDate: fixed derives the date, interval leaves it missing", () => {
    expect(firstDueDate(fixedYear(11, 1), "2026-11-24")).toBe("2027-11-01");
    expect(firstDueDate(fixedYear(11, 24), "2026-11-24")).toBe("2026-11-24");
    expect(firstDueDate(fixedMonth(1), "2026-11-24")).toBe("2026-12-01");
    expect(firstDueDate(interval("month", 6), "2026-11-24")).toBeNull();
    expect(firstDueDate(null, "2026-11-24")).toBeNull();
  });

  it("validates recurrence JSON", () => {
    expect(zRecurrence.safeParse({ kind: "fixed", unit: "year", every: 1, month: 10, day: 1 }).success).toBe(true);
    expect(zRecurrence.safeParse({ kind: "fixed", unit: "year", every: 1 }).success).toBe(false);
    expect(zRecurrence.safeParse({ kind: "fixed", unit: "month", every: 1, day: 5, month: 3 }).success).toBe(false);
    expect(zRecurrence.safeParse({ kind: "interval", unit: "month", every: 0 }).success).toBe(false);
    expect(zRecurrence.safeParse({ kind: "interval", unit: "month", every: 6, extra: 1 }).success).toBe(false);
  });
});

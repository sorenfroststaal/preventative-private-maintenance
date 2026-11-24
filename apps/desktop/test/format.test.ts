import { describe, expect, it } from "vitest";
import { describeRecurrence, formatBytes, formatDate, formatMoney } from "../src/lib/format";
import { toRecurrence, emptyRecurrenceForm } from "../src/lib/recurrenceForm";
import { pathUtil } from "../src/platform/tauri";

describe("Danish formatting (spec README)", () => {
  it("dates and money", () => {
    expect(formatDate("2026-11-24")).toBe("24.11.2026");
    expect(formatDate(null)).toBe("–");
    expect(formatMoney(123450)).toBe("1.234,50 kr.");
    expect(formatMoney(-24550)).toBe("-245,50 kr.");
    expect(formatMoney(5)).toBe("0,05 kr.");
    expect(formatMoney(100000000)).toBe("1.000.000,00 kr.");
    expect(formatBytes(2048)).toBe("2,0 KB");
  });

  it("describes recurrences", () => {
    expect(describeRecurrence(null)).toBe("Engangsopgave");
    expect(describeRecurrence({ kind: "fixed", unit: "year", every: 1, month: 10, day: 1 })).toBe("Hvert år d. 1. oktober");
    expect(describeRecurrence({ kind: "fixed", unit: "month", every: 2, day: 15 })).toBe("Hver 2. måned d. 15.");
    expect(describeRecurrence({ kind: "interval", unit: "month", every: 6 })).toBe("6 måneder efter udførelse");
    expect(describeRecurrence({ kind: "interval", unit: "year", every: 1 })).toBe("1 år efter udførelse");
  });
});

describe("recurrence form", () => {
  it("builds valid rules", () => {
    expect(toRecurrence(emptyRecurrenceForm)).toEqual({ value: null });
    expect(toRecurrence({ kind: "fixed", unit: "year", every: "1", month: "10", day: "1" })).toEqual({
      value: { kind: "fixed", unit: "year", every: 1, month: 10, day: 1 },
    });
    expect(toRecurrence({ kind: "fixed", unit: "month", every: "1", month: "3", day: "31" })).toEqual({
      value: { kind: "fixed", unit: "month", every: 1, day: 31 },
    });
    expect(toRecurrence({ kind: "interval", unit: "month", every: "6", month: "1", day: "1" })).toEqual({
      value: { kind: "interval", unit: "month", every: 6 },
    });
  });
  it("reports errors", () => {
    expect(toRecurrence({ kind: "interval", unit: "month", every: "0", month: "1", day: "1" })).toHaveProperty("error");
    expect(toRecurrence({ kind: "fixed", unit: "year", every: "1", month: "13", day: "1" })).toHaveProperty("error");
  });
});

describe("path helpers", () => {
  it("joins Windows and POSIX paths", () => {
    expect(pathUtil.join("C:\\Users\\a\\Arkiv", "bilag", "ab")).toBe("C:\\Users\\a\\Arkiv\\bilag\\ab");
    expect(pathUtil.join("C:\\Users\\a\\Arkiv\\", "manifest.json")).toBe("C:\\Users\\a\\Arkiv\\manifest.json");
    expect(pathUtil.join("/home/a/arkiv", "bilag", "x.pdf")).toBe("/home/a/arkiv/bilag/x.pdf");
    expect(pathUtil.dirname("C:\\Users\\a\\x.pdf")).toBe("C:\\Users\\a");
    expect(pathUtil.dirname("C:\\x.pdf")).toBe("C:\\");
    expect(pathUtil.dirname("/home/a/x.pdf")).toBe("/home/a");
    expect(pathUtil.basename("C:\\Users\\a\\Kvittering.pdf")).toBe("Kvittering.pdf");
  });
});

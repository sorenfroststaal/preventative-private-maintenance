import { describe, expect, it } from "vitest";
import { fromFormValues, toFormValue } from "../src/components/EntityForm";
import { fieldsFor } from "../src/lib/entityFields";
import { createSchema, ENTITY_TYPES } from "@ppm/core";

describe("form value conversion", () => {
  const item = fieldsFor("item");
  it("money round-trips in Danish format", () => {
    const f = item.find((x) => x.key === "purchase_price_minor")!;
    expect(toFormValue(f, 499950)).toBe("4999,50");
    expect(toFormValue(f, -5)).toBe("-0,05");
    const { data, errors } = fromFormValues(item, { name: "TV", purchase_price_minor: "7.995,00", purchase_date: "2025-11-28", notes: "" });
    expect(errors).toEqual({});
    expect(data).toEqual({ name: "TV", purchase_price_minor: 799500, purchase_date: "2025-11-28", notes: null });
  });
  it("reports unparsable money and numbers", () => {
    const { errors } = fromFormValues(item, { purchase_price_minor: "1,234.56" });
    expect(errors.purchase_price_minor).toMatch(/1\.234,50/);
    expect(fromFormValues(fieldsFor("vehicle"), { model_year: "abc" }).errors.model_year).toBeTruthy();
  });
  it("numeric selects become numbers", () => {
    expect(fromFormValues(fieldsFor("property"), { owned: "0", kind: "house" }).data).toEqual({ owned: 0, kind: "house" });
  });
  it("every UI field exists in the core schema", () => {
    for (const t of ENTITY_TYPES) {
      const keys = Object.keys(createSchema(t).shape);
      for (const f of fieldsFor(t)) expect(keys, `${t}.${f.key}`).toContain(f.key);
    }
  });
});

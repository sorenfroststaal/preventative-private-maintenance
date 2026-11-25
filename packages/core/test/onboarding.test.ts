import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyOnboarding, createEntity, finishOnboarding, onboardingSuggestions, shouldOfferOnboarding, type OnboardingAnswers, type TaskTemplate } from "../src";
import { ctxFor, newArchive } from "./helpers";

const templates = JSON.parse(readFileSync(join(__dirname, "../../../templates/da/basis.json"), "utf8")) as TaskTemplate[];
const base: OnboardingAnswers = { propertyKind: "house", owned: true, woodStove: false, rainwaterWell: false, heatPump: false, car: false, children: false };
const ids = (a: Partial<OnboardingAnswers>) => onboardingSuggestions({ ...base, ...a }, templates).map((s) => s.template_id);

describe("phase 4.6 – onboarding", () => {
  it("maps answers to template suggestions", () => {
    expect(ids({})).toEqual(["home.smoke_alarm.test", "home.drain.clean", "insurance.review", "home.water_heater.check", "home.gutters.clean", "home.roof.inspect", "finance.budget.review"]);
    // Renting an apartment: no gutters, roof or water heater.
    expect(ids({ propertyKind: "apartment", owned: false })).toEqual(["home.smoke_alarm.test", "home.drain.clean", "insurance.review", "finance.budget.review"]);
    const all = onboardingSuggestions({ ...base, woodStove: true, rainwaterWell: true, heatPump: true, car: true, children: true }, templates);
    expect(all.filter((s) => s.target === "woodStove").map((s) => s.template_id)).toEqual(["home.wood_stove.sweep", "home.wood_stove.check"]);
    expect(all.find((s) => s.template_id === "home.rainwater_well.clean")?.target).toBe("rainwaterWell");
    expect(all.find((s) => s.template_id === "home.heat_pump.service")?.target).toBe("heatPump");
    expect(all.filter((s) => s.target === "vehicle")).toHaveLength(4);
    expect(all.find((s) => s.template_id === "health.child_exam")).toMatchObject({ target: null, selected: true });
    // Without a home only car, children and budget remain.
    expect(ids({ propertyKind: "none", woodStove: true, car: true })).toEqual(["vehicle.service", "vehicle.inspection", "vehicle.tires.summer", "vehicle.tires.winter", "finance.budget.review"]);
    // Every suggested id exists in the catalogue.
    for (const s of all) expect(templates.some((t) => t.id === s.template_id)).toBe(true);
  });

  it("is offered in a new archive, can be skipped, and creates the chosen tasks with template id/version without duplicates", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const db = archive.db;
    expect(await shouldOfferOnboarding(db)).toBe(true);
    const answers = { ...base, woodStove: true, car: true };
    const chosen = ["home.smoke_alarm.test", "home.wood_stove.sweep", "vehicle.inspection"];
    expect(await applyOnboarding(ctx, answers, chosen, templates)).toEqual({ created: 3, skipped: 0 });
    const tasks = await db.select<{ title: string; template_id: string; template_version: number; source: string; target_type: string }>(
      "SELECT title, template_id, template_version, source, target_type FROM task ORDER BY template_id",
    );
    expect(tasks).toEqual([
      { title: "Test røgalarmer", template_id: "home.smoke_alarm.test", template_version: 1, source: "template", target_type: "property" },
      { title: "Skorstensfejning af brændeovn", template_id: "home.wood_stove.sweep", template_version: 1, source: "template", target_type: "building_part" },
      { title: "Syn af bil", template_id: "vehicle.inspection", template_version: 1, source: "template", target_type: "vehicle" },
    ]);
    expect(await db.select("SELECT name, kind, owned FROM property")).toEqual([{ name: "Min bolig", kind: "house", owned: 1 }]);
    expect(await db.select("SELECT name FROM building_part")).toEqual([{ name: "Brændeovn" }]);
    expect(await db.select("SELECT name FROM vehicle")).toEqual([{ name: "Bil" }]);
    expect(await shouldOfferOnboarding(db)).toBe(false);
    // Opened again from Settings: same choices do not create duplicates, and existing records are reused.
    expect(await applyOnboarding(ctx, answers, [...chosen, "home.wood_stove.check"], templates)).toEqual({ created: 1, skipped: 3 });
    expect(await db.select("SELECT count(*) AS n FROM building_part")).toEqual([{ n: 1 }]);
    expect(await db.select("SELECT count(*) AS n FROM task_occurrence WHERE status = 'open'")).toEqual([{ n: 4 }]);
  });

  it("is not offered when the archive has items or the guide was skipped", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    await finishOnboarding(ctx);
    expect(await shouldOfferOnboarding(archive.db)).toBe(false);
    const other = await newArchive();
    await createEntity(ctxFor(other.env, other.archive), "item", { name: "Sofa" });
    expect(await shouldOfferOnboarding(other.archive.db)).toBe(false);
  });
});

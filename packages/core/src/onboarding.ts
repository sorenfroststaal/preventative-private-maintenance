/** Task templates (templates/da/README.md) and the onboarding guide (phase 4.6). */
import type { DbAdapter } from "./db/adapter";
import type { Recurrence } from "./domain/schemas";
import { createEntity, type Ctx } from "./repo/entities";
import { getSetting, setSetting } from "./repo/settings";
import { createTask } from "./repo/tasks";

export interface TemplateSource {
  title: string;
  url: string;
  scope: string;
  checked_date: string;
}

export interface TaskTemplate {
  id: string;
  version: number;
  title: string;
  description: string;
  module: string;
  applies_to: "property" | "building_part" | "item" | "vehicle" | "person";
  recurrence: Recurrence | null;
  basis: "suggestion" | "recommendation" | "requirement";
  source: TemplateSource | null;
}

export interface OnboardingAnswers {
  propertyKind: "house" | "apartment" | "summerhouse" | "other" | "none";
  owned: boolean;
  woodStove: boolean;
  rainwaterWell: boolean;
  heatPump: boolean;
  car: boolean;
  children: boolean;
}

/** Building parts the guide can create; templates for them are attached to the part. */
export const ONBOARDING_PARTS = { woodStove: "Brændeovn", rainwaterWell: "Regnvandsbrønd", heatPump: "Varmepumpe" } as const;
type PartKey = keyof typeof ONBOARDING_PARTS;

export interface OnboardingSuggestion {
  template_id: string;
  title: string;
  reason: string;
  target: "property" | PartKey | "vehicle" | null;
  /** Shown chosen by default. */
  selected: boolean;
}

const ONBOARDING_KEY = "onboarding.done";

/** The guide is offered in an archive without tasks and items, unless it was finished or skipped. */
export async function shouldOfferOnboarding(db: DbAdapter): Promise<boolean> {
  if (await getSetting<boolean>(db, ONBOARDING_KEY)) return false;
  const [r] = await db.select<{ n: number }>("SELECT (SELECT count(*) FROM task) + (SELECT count(*) FROM item) AS n");
  return (r?.n ?? 0) === 0;
}

/** "Spring over" (and finishing): the guide is not offered again; it can be opened from Indstillinger. */
export async function finishOnboarding(ctx: Ctx): Promise<void> {
  await setSetting(ctx, ONBOARDING_KEY, true);
}

/** Maps the answers to template suggestions. Unknown template ids are ignored. */
export function onboardingSuggestions(a: OnboardingAnswers, templates: TaskTemplate[]): OnboardingSuggestion[] {
  const out: OnboardingSuggestion[] = [];
  const add = (id: string, target: OnboardingSuggestion["target"], reason: string, selected = true) => {
    const t = templates.find((x) => x.id === id);
    if (t && !out.some((o) => o.template_id === id)) out.push({ template_id: id, title: t.title, reason, target, selected });
  };
  const home = a.propertyKind !== "none";
  const house = a.propertyKind === "house" || a.propertyKind === "summerhouse";
  if (home) {
    add("home.smoke_alarm.test", "property", "Alle boliger");
    add("home.drain.clean", "property", "Alle boliger", false);
    add("insurance.review", "property", a.owned ? "Hus- og indboforsikring" : "Indboforsikring");
    if (a.owned) add("home.water_heater.check", "property", "Du ejer boligen");
    if (a.owned && house) {
      add("home.gutters.clean", "property", "Hus, du ejer");
      add("home.roof.inspect", "property", "Hus, du ejer");
    }
    if (a.woodStove) {
      add("home.wood_stove.sweep", "woodStove", "Brændeovn");
      add("home.wood_stove.check", "woodStove", "Brændeovn");
    }
    if (a.rainwaterWell) add("home.rainwater_well.clean", "rainwaterWell", "Regnvandsbrønd");
    if (a.heatPump) add("home.heat_pump.service", "heatPump", "Varmepumpe");
  }
  if (a.car) {
    add("vehicle.service", "vehicle", "Bil");
    add("vehicle.inspection", "vehicle", "Bil");
    add("vehicle.tires.summer", "vehicle", "Bil");
    add("vehicle.tires.winter", "vehicle", "Bil");
  }
  if (a.children) {
    add("health.child_exam", null, "Børn");
    add("health.dentist", null, "Børn", false);
  }
  add("finance.budget.review", null, "Alle husstande", false);
  return out;
}

export interface OnboardingResult {
  created: number;
  /** Already existed with the same template and target (no duplicates). */
  skipped: number;
}

/**
 * Creates the chosen suggestions as tasks with template_id and template_version. The guide reuses the
 * first active property and car, or creates "Min bolig" / "Bil", and the building parts it needs. A task
 * that already exists for the same template and target is skipped. Finishes the guide.
 */
export async function applyOnboarding(ctx: Ctx, a: OnboardingAnswers, chosen: string[], templates: TaskTemplate[]): Promise<OnboardingResult> {
  const suggestions = onboardingSuggestions(a, templates).filter((s) => chosen.includes(s.template_id));
  const result = await ctx.db.transaction(async (tx) => {
    const c = { ...ctx, db: tx };
    let created = 0;
    let skipped = 0;
    let propertyId: string | null = null;
    const property = async () => {
      if (propertyId) return propertyId;
      const [p] = await tx.select<{ id: string }>("SELECT id FROM property WHERE archived_at IS NULL ORDER BY created_at LIMIT 1");
      propertyId = p?.id ?? String((await createEntity(c, "property", { name: "Min bolig", kind: a.propertyKind === "none" ? "other" : a.propertyKind, owned: a.owned ? 1 : 0 })).id);
      return propertyId;
    };
    const part = async (key: PartKey) => {
      const pid = await property();
      const name = ONBOARDING_PARTS[key];
      const [bp] = await tx.select<{ id: string }>("SELECT id FROM building_part WHERE property_id = ? AND lower(name) = lower(?) AND archived_at IS NULL", [pid, name]);
      return bp?.id ?? String((await createEntity(c, "building_part", { property_id: pid, name })).id);
    };
    const vehicle = async () => {
      const [v] = await tx.select<{ id: string }>("SELECT id FROM vehicle WHERE archived_at IS NULL ORDER BY created_at LIMIT 1");
      return v?.id ?? String((await createEntity(c, "vehicle", { name: "Bil" })).id);
    };
    for (const s of suggestions) {
      const t = templates.find((x) => x.id === s.template_id)!;
      let targetType: string | null = null;
      let targetId: string | null = null;
      if (s.target === "property") [targetType, targetId] = ["property", await property()];
      else if (s.target === "vehicle") [targetType, targetId] = ["vehicle", await vehicle()];
      else if (s.target) [targetType, targetId] = ["building_part", await part(s.target)];
      const dup = await tx.select(
        "SELECT 1 FROM task WHERE template_id = ? AND status != 'archived' AND target_type IS ? AND target_id IS ?",
        [t.id, targetType, targetId],
      );
      if (dup.length) {
        skipped++;
        continue;
      }
      await createTask(c, {
        title: t.title,
        description: t.description,
        module: t.module as never,
        target_type: targetType as never,
        target_id: targetId,
        template_id: t.id,
        template_version: t.version,
        source: "template",
        recurrence: t.recurrence,
      });
      created++;
    }
    return { created, skipped };
  });
  await finishOnboarding(ctx);
  return result;
}

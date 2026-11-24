/** Starter catalog of 40 Danish dishes (spec 05 "Startkatalog"). */
import { z } from "zod";
import type { DbAdapter } from "../db/adapter";
import { createEntity, withDb, type Ctx } from "../repo/entities";
import { getSetting, setSetting } from "../repo/settings";
import retter from "../../../../templates/da/retter.json";

const zCatalog = z.object({
  format: z.literal("ppm-recipe-templates"),
  version: z.literal(1),
  retter: z.array(z.object({ id: z.string().min(1), navn: z.string().min(1) })),
});
export type RecipeCatalog = z.infer<typeof zCatalog>;

export const STARTER_CATALOG: RecipeCatalog = zCatalog.parse(retter);
export const OPEN_PLANNER_PREFIX = "open-planner:";
const CATALOG_SETTING = "food.catalog_added_at";

/** True when "Tilføj startkatalog" should be offered: never added before. */
export async function shouldOfferCatalog(db: DbAdapter): Promise<boolean> {
  return !(await getSetting<string>(db, CATALOG_SETTING));
}

/**
 * Creates the catalog dishes as recipes (source = 'template'). Dishes whose source_ref
 * already exists (also archived or imported ones) are skipped, so it only happens once.
 */
export async function addStarterCatalog(ctx: Ctx, catalog: RecipeCatalog = STARTER_CATALOG): Promise<number> {
  return ctx.db.transaction(async (tx) => {
    const c = withDb(ctx, tx);
    const existing = new Set(
      (await tx.select<{ source_ref: string }>("SELECT source_ref FROM recipe WHERE source_ref IS NOT NULL")).map((r) => r.source_ref),
    );
    let n = 0;
    for (const r of catalog.retter) {
      const ref = OPEN_PLANNER_PREFIX + r.id;
      if (existing.has(ref)) continue;
      await createEntity(c, "recipe", { name: r.navn, source: "template", source_ref: ref });
      existing.add(ref);
      n++;
    }
    await setSetting(c, CATALOG_SETTING, ctx.clock.nowIso());
    return n;
  });
}

/** Hides the offer without adding anything ("Nej tak"). */
export const dismissStarterCatalog = (ctx: Ctx) => setSetting(ctx, CATALOG_SETTING, ctx.clock.nowIso());

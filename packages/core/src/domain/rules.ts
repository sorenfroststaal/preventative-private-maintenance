/**
 * Module rules wired as after-write hooks: work order events and odometer readings (spec 04).
 */
import type { Row } from "./registry";
import { createEntity, registerAfterWrite } from "../repo/entities";

let registered = false;

export function registerModuleRules(): void {
  if (registered) return;
  registered = true;

  // Every status change (and creation) writes a work_order_event.
  registerAfterWrite("work_order", async (ctx, row, action, before) => {
    if (action === "create" || (action === "update" && before && before.status !== row.status)) {
      await createEntity(ctx, "work_order_event", {
        work_order_id: String(row.id),
        at: ctx.clock.nowIso(),
        status: String(row.status),
        note: null,
        user_id: ctx.userId,
      });
    }
    // Saving a vehicle work order with a km reading records an odometer reading.
    const km = row.odometer_km as number | null;
    const kmChanged = action === "create" ? km !== null : before?.odometer_km !== km;
    if (row.target_type === "vehicle" && row.target_id && km !== null && km !== undefined && kmChanged) {
      await createEntity(ctx, "odometer_reading", {
        vehicle_id: String(row.target_id),
        reading_date: String(row.completed_date ?? row.reported_date),
        km,
        source: "work_order",
      });
    }
  });
}

export type { Row };

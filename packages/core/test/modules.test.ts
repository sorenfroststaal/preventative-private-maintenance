import { describe, expect, it } from "vitest";
import {
  annualAmount,
  archiveEntity,
  changeWorkOrderStatus,
  completeOccurrence,
  coverageSummary,
  createEntity,
  createUser,
  getHistory,
  getOpenOccurrence,
  healthPersons,
  healthRecords,
  HealthAccessError,
  createTask,
  policiesForItem,
  setPin,
  updateEntity,
  vehicleCostsByYear,
  workOrderEvents,
  type Ctx,
  type DbAdapter,
  type Row,
} from "../src";
import { ctxFor, newArchive } from "./helpers";

const systemTask = async (db: DbAdapter, ref: string) =>
  (await db.select<Row>("SELECT * FROM task WHERE system_ref = ?", [ref]))[0] ?? null;

async function setup() {
  const { env, archive } = await newArchive();
  const ctx = ctxFor(env, archive);
  return { env, archive, ctx, db: archive.db };
}

describe("audit never contains pin_hash (spec 03)", () => {
  it("redacts on create and update", async () => {
    const { ctx, db } = await setup();
    const { user } = await createUser(ctx, { name: "Anna", pin: "1234" });
    await setPin(ctx, String(user.id), "5678");
    await setPin(ctx, String(user.id), null);
    const rows = await db.select<{ diff_json: string }>("SELECT diff_json FROM audit_log WHERE entity_type = 'app_user'");
    const all = rows.map((r) => r.diff_json).join("\n");
    expect(all).not.toContain("pbkdf2");
    expect(rows.map((r) => JSON.parse(r.diff_json).pin_hash)).toEqual([
      [null, "[skjult]"],
      ["[skjult]", "[skjult]"],
      ["[skjult]", null],
    ]);
  });
});

describe("phase 2.1 / 2.5 / 2.7 – derived system tasks (spec 03)", () => {
  it("item complaint/warranty dates create, move and archive one task each", async () => {
    const { ctx, db } = await setup();
    const item = await createEntity(ctx, "item", { name: "Opvasker", complaint_until: "2027-03-14", warranty_until: "2028-03-14" });
    const id = String(item.id);
    const t1 = await systemTask(db, `item.complaint_until:${id}`);
    expect(t1).toMatchObject({ title: "Reklamationsret udløber: Opvasker", module: "home", source: "system", target_type: "item", status: "active" });
    expect((await getOpenOccurrence(db, String(t1!.id)))?.due_date).toBe("2027-03-14");
    expect((await systemTask(db, `item.warranty_until:${id}`))?.title).toBe("Garanti udløber: Opvasker");

    await updateEntity(ctx, "item", id, { complaint_until: "2027-04-01", name: "Opvaskemaskine" });
    const t1b = await systemTask(db, `item.complaint_until:${id}`);
    expect(t1b?.id).toBe(t1!.id);
    expect(t1b?.title).toBe("Reklamationsret udløber: Opvaskemaskine");
    expect((await getOpenOccurrence(db, String(t1!.id)))?.due_date).toBe("2027-04-01");
    expect(await db.select("SELECT * FROM task_occurrence WHERE task_id = ?", [String(t1!.id)])).toHaveLength(1);

    await updateEntity(ctx, "item", id, { complaint_until: null });
    expect((await systemTask(db, `item.complaint_until:${id}`))?.status).toBe("archived");
    await updateEntity(ctx, "item", id, { complaint_until: "2027-05-01" });
    expect((await systemTask(db, `item.complaint_until:${id}`))?.status).toBe("active");

    await archiveEntity(ctx, "item", id);
    expect((await systemTask(db, `item.complaint_until:${id}`))?.status).toBe("archived");
    expect((await systemTask(db, `item.warranty_until:${id}`))?.status).toBe("archived");
  });

  it("a completed system task gets a new occurrence when the date changes", async () => {
    const { ctx, db } = await setup();
    const p = await createEntity(ctx, "policy", { kind: "home_contents", title: "Indbo", renewal_date: "2027-01-01" });
    const t = (await systemTask(db, `policy.renewal:${p.id}`))!;
    expect(t.module).toBe("insurance");
    const occ = (await getOpenOccurrence(db, String(t.id)))!;
    await completeOccurrence(ctx, String(occ.id), { completedDate: "2026-12-20" });
    expect(await getOpenOccurrence(db, String(t.id))).toBeNull(); // no recurrence on system tasks
    await updateEntity(ctx, "policy", String(p.id), { renewal_date: "2028-01-01" });
    expect((await getOpenOccurrence(db, String(t.id)))?.due_date).toBe("2028-01-01");
  });

  it("binding and health dates create tasks with person names", async () => {
    const { ctx, db } = await setup();
    const exp = await createEntity(ctx, "recurring_expense", { name: "Mobil", amount_minor: 9900, period: "month", binding_until: "2027-06-01" });
    expect(await systemTask(db, `recurring_expense.binding:${exp.id}`)).toMatchObject({ title: "Binding udløber: Mobil", module: "finance" });
    const ida = await createEntity(ctx, "person", { name: "Ida" });
    const s = await createEntity(ctx, "health_screening", { person_id: String(ida.id), name: "Børneundersøgelse 5 år", next_due_date: "2027-02-01" });
    const v = await createEntity(ctx, "health_vaccination", { person_id: String(ida.id), vaccine: "MFR", given_date: "2026-01-01", next_due_date: "2030-01-01" });
    const m = await createEntity(ctx, "health_medication", { person_id: String(ida.id), name: "Eksempel", prescription_renewal_date: "2026-12-15" });
    expect((await systemTask(db, `health_screening.next:${s.id}`))?.title).toBe("Børneundersøgelse 5 år (Ida)");
    expect((await systemTask(db, `health_vaccination.next:${v.id}`))?.title).toBe("MFR (Ida)");
    expect(await systemTask(db, `health_medication.renewal:${m.id}`)).toMatchObject({ title: "Forny recept: Eksempel (Ida)", module: "health", target_type: "person" });
  });
});

describe("phase 2.2 – work orders", () => {
  it("status changes write events; notes too; history on target", async () => {
    const { env, archive, db } = await setup();
    const { user } = await createUser(ctxFor(env, archive), { name: "Anna" });
    const ctx: Ctx = ctxFor(env, archive, String(user.id));
    const house = await createEntity(ctx, "property", { name: "Huset", kind: "house" });
    const wo = await createEntity(ctx, "work_order", {
      title: "Utæt tag",
      kind: "repair",
      target_type: "property",
      target_id: String(house.id),
      reported_date: "2026-11-01",
    });
    const id = String(wo.id);
    await changeWorkOrderStatus(ctx, id, "quote_requested", "Ringet til tømrer");
    await changeWorkOrderStatus(ctx, id, "done");
    const events = await workOrderEvents(db, id);
    expect(events.map((e) => [e.status, e.note])).toEqual([
      ["registered", null],
      ["quote_requested", null],
      [null, "Ringet til tømrer"],
      ["done", null],
    ]);
    expect(events[0]?.user_name).toBe("Anna");
    expect((await db.select<Row>("SELECT completed_date FROM work_order WHERE id = ?", [id]))[0]?.completed_date).toBe("2026-11-24");
    // Notes are searchable.
    expect(await db.select("SELECT * FROM search_index WHERE search_index MATCH '\"tømrer\"*'")).toHaveLength(1);
    // History combines work orders and completed tasks on the target.
    const t = await createTask(ctx, { title: "Rens tagrender", module: "maintenance", target_type: "property", target_id: String(house.id), firstDueDate: "2026-10-01" });
    await completeOccurrence(ctx, String(t.occurrence.id), { completedDate: "2026-10-05" });
    const hist = await getHistory(db, "property", String(house.id));
    expect(hist.map((h) => [h.kind, h.title, h.date])).toEqual([
      ["work_order", "Utæt tag", "2026-11-24"],
      ["task_occurrence", "Rens tagrender", "2026-10-05"],
    ]);
  });

  it("vehicle work order with km creates an odometer reading once", async () => {
    const { ctx, db } = await setup();
    const car = await createEntity(ctx, "vehicle", { name: "Bilen" });
    const wo = await createEntity(ctx, "work_order", {
      title: "Service",
      kind: "service",
      target_type: "vehicle",
      target_id: String(car.id),
      reported_date: "2026-03-15",
      odometer_km: 84210,
    });
    await updateEntity(ctx, "work_order", String(wo.id), { description: "Olie skiftet" });
    await updateEntity(ctx, "work_order", String(wo.id), { odometer_km: 84250 });
    const readings = await db.select<Row>("SELECT km, source, reading_date FROM odometer_reading ORDER BY km");
    expect(readings).toEqual([
      { km: 84210, source: "work_order", reading_date: "2026-03-15" },
      { km: 84250, source: "work_order", reading_date: "2026-03-15" },
    ]);
  });
});

describe("phase 2.3 – vehicle operating costs", () => {
  it("sums work orders and linked transactions per year", async () => {
    const { ctx } = await setup();
    const db = ctx.db;
    const car = await createEntity(ctx, "vehicle", { name: "Bilen" });
    const wo = (date: string, cost: number, status = "closed") =>
      createEntity(ctx, "work_order", { title: "x", kind: "service", status: status as never, target_type: "vehicle", target_id: String(car.id), reported_date: date, cost_minor: cost });
    await wo("2025-05-01", 100000);
    await wo("2026-03-15", 289500);
    await wo("2026-06-01", 50000, "cancelled");
    const acc = await createEntity(ctx, "account", { name: "Konto" });
    const tx = await createEntity(ctx, "bank_transaction", { account_id: String(acc.id), booking_date: "2026-11-15", text: "Benzin", amount_minor: -61235, dedupe_hash: "a" });
    await createEntity(ctx, "transaction_link", { transaction_id: String(tx.id), target_type: "vehicle", target_id: String(car.id) });
    expect(await vehicleCostsByYear(db, String(car.id))).toEqual([
      { year: 2026, work_orders_minor: 289500, transactions_minor: 61235, total_minor: 350735 },
      { year: 2025, work_orders_minor: 100000, transactions_minor: 0, total_minor: 100000 },
    ]);
  });
});

describe("phase 2.5 – insurance", () => {
  it("normalises premiums", () => {
    expect(annualAmount(78000, "quarter")).toBe(312000);
    expect(annualAmount(10000, "month")).toBe(120000);
    expect(annualAmount(189000, "year")).toBe(189000);
    expect(annualAmount(null, "year")).toBeNull();
  });

  it("warns about underinsurance including items via the property", async () => {
    const { ctx, db } = await setup();
    const house = await createEntity(ctx, "property", { name: "Huset", kind: "house" });
    const room = await createEntity(ctx, "location", { property_id: String(house.id), name: "Stue" });
    const sofa = await createEntity(ctx, "item", { name: "Sofa", location_id: String(room.id), purchase_price_minor: 2000000 });
    const bike = await createEntity(ctx, "item", { name: "Cykel", purchase_price_minor: 1500000 });
    const pol = await createEntity(ctx, "policy", { kind: "home_contents", title: "Indbo", coverage_sum_minor: 3000000 });
    await createEntity(ctx, "policy_coverage", { policy_id: String(pol.id), target_type: "property", target_id: String(house.id) });
    expect(await coverageSummary(db, String(pol.id))).toEqual({ items: 1, items_value_minor: 2000000, coverage_sum_minor: 3000000, underinsured: false });
    await createEntity(ctx, "policy_coverage", { policy_id: String(pol.id), target_type: "item", target_id: String(bike.id) });
    expect(await coverageSummary(db, String(pol.id))).toMatchObject({ items: 2, items_value_minor: 3500000, underinsured: true });
    expect((await policiesForItem(db, String(sofa.id))).map((p) => p.title)).toEqual(["Indbo"]);
  });
});

describe("phase 2.7 – health visibility filter", () => {
  it("private health data is only visible to the chosen user", async () => {
    const { env, archive, db } = await setup();
    const sys = ctxFor(env, archive);
    const { user: anna } = await createUser(sys, { name: "Anna" });
    const { user: bo, person: boP } = await createUser(sys, { name: "Bo" });
    await updateEntity(sys, "person", String(boP!.id), { health_private_user_id: String(bo.id) });
    await createEntity(sys, "health_allergy", { person_id: String(boP!.id), substance: "Nødder" });
    expect((await healthPersons(db, String(anna.id))).map((p) => p.name)).toEqual(["Anna"]);
    expect((await healthPersons(db, String(bo.id))).map((p) => p.name)).toEqual(["Anna", "Bo"]);
    await expect(healthRecords(db, "health_allergy", String(boP!.id), String(anna.id))).rejects.toBeInstanceOf(HealthAccessError);
    expect(await healthRecords(db, "health_allergy", String(boP!.id), String(bo.id))).toHaveLength(1);
  });
});

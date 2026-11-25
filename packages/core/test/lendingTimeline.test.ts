import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  createEntity,
  createTask,
  createUser,
  getSchemaVersion,
  lendItem,
  listLendings,
  migrate,
  returnLending,
  search,
  timelineEvents,
  TIMELINE_KINDS,
} from "../src";
import { ctxFor, newArchive, tempDir, testEnv } from "./helpers";
import { migrations } from "../src/db/migrations.generated";

describe("migration 0007 – lending and serial numbers", () => {
  it("adds lending with its CHECK rules and serial numbers on building parts and parts", async () => {
    const env = testEnv();
    const db = await env.openDb(join(tempDir(), "v6.sqlite"));
    await migrate(db, () => env.clock.nowIso(), migrations.filter((m) => m.version <= 6));
    await db.execute("INSERT INTO property (id, name, kind, created_at) VALUES ('00000000-0000-4000-8000-000000000001', 'Hus', 'house', 'x')");
    await db.execute("INSERT INTO building_part (id, property_id, name, created_at) VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Varmepumpe', 'x')");
    await migrate(db, () => env.clock.nowIso());
    expect(await getSchemaVersion(db)).toBe(7);
    await db.execute("UPDATE building_part SET brand = 'Mærke', model = 'M1', serial_number = 'SN-123'");
    expect(await db.select("SELECT name, serial_number FROM building_part")).toEqual([{ name: "Varmepumpe", serial_number: "SN-123" }]);
    await db.execute("INSERT INTO lending (id, title, borrower_name, lent_date, created_at) VALUES ('00000000-0000-4000-8000-000000000003', 'Boremaskine', 'Nabo', '2026-11-01', 'x')");
    await expect(db.execute("INSERT INTO lending (id, borrower_name, lent_date, created_at) VALUES ('00000000-0000-4000-8000-000000000004', 'Nabo', '2026-11-01', 'x')")).rejects.toThrow();
    await expect(db.execute("INSERT INTO lending (id, title, lent_date, created_at) VALUES ('00000000-0000-4000-8000-000000000005', 'Spil', '2026-11-01', 'x')")).rejects.toThrow();
  });
});

describe("lending", () => {
  it("lends an item or a free text to a person, contact or name; one active lending per item; returning ends it", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const db = archive.db;
    const drill = await createEntity(ctx, "item", { name: "Boremaskine", serial_number: "BM-0042" });
    const bo = await createEntity(ctx, "person", { name: "Bo Testesen" });
    await expect(lendItem(ctx, { lent_date: "2026-11-01" })).rejects.toThrow(/Vælg en genstand/);
    await expect(lendItem(ctx, { title: "Spil", lent_date: "2026-11-01" })).rejects.toThrow(/hvem der låner/);
    await expect(lendItem(ctx, { title: "Spil", borrower_name: "X", lent_date: "2026-11-10", due_date: "2026-11-01" })).rejects.toThrow(/før udlånsdatoen/);
    const l1 = await lendItem(ctx, { item_id: String(drill.id), borrower_person_id: String(bo.id), lent_date: "2026-11-01", due_date: "2026-11-15" });
    await expect(lendItem(ctx, { item_id: String(drill.id), borrower_name: "Nabo", lent_date: "2026-11-02" })).rejects.toThrow(/allerede udlånt til Bo Testesen/);
    await lendItem(ctx, { title: "Brætspillet Eksempel", borrower_name: "Familien Hansen", lent_date: "2026-11-20" });
    const active = await listLendings(db, "2026-11-25", { active: true });
    expect(active.map((l) => [l.thing, l.borrower, l.overdue])).toEqual([
      ["Boremaskine", "Bo Testesen", true],
      ["Brætspillet Eksempel", "Familien Hansen", false],
    ]);
    await returnLending(ctx, String(l1.id), "2026-11-26");
    expect((await listLendings(db, "2026-11-27", { active: true })).map((l) => l.thing)).toEqual(["Brætspillet Eksempel"]);
    expect((await listLendings(db, "2026-11-27", { active: false })).map((l) => [l.thing, l.returned_date])).toEqual([["Boremaskine", "2026-11-26"]]);
    // Lending again after the return is fine; serial numbers are searchable.
    await lendItem(ctx, { item_id: String(drill.id), borrower_name: "Nabo", lent_date: "2026-11-28" });
    expect((await search(db, "BM-0042")).map((h) => h.type)).toContain("item");
    expect((await search(db, "Hansen")).map((h) => h.type)).toContain("lending");
  });
});

describe("calendar and timeline events", () => {
  it("collects dates from tasks, items, policies, lending, loans and more; kinds can be chosen; health respects privacy", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const db = archive.db;
    await createTask(ctx, { title: "Rens tagrender", module: "maintenance", firstDueDate: "2026-11-10" });
    await createTask(ctx, { title: "Service", module: "maintenance", firstDueDate: "2027-03-01" }); // outside
    const item = await createEntity(ctx, "item", { name: "Opvasker", purchase_date: "2026-10-05", warranty_until: "2026-12-01", complaint_until: "2028-10-05" });
    await createEntity(ctx, "policy", { kind: "home_contents", title: "Indbo", renewal_date: "2026-12-15" });
    await lendItem(ctx, { item_id: String(item.id), borrower_name: "Nabo", lent_date: "2026-11-20", due_date: "2026-11-22" });
    await createEntity(ctx, "loan", { name: "Billån", start_date: "2024-01-01", end_date: "2029-12-31" });
    await createEntity(ctx, "recurring_expense", { name: "Mobil", amount_minor: 9900, period: "month", binding_until: "2026-12-31" });
    const wo = await createEntity(ctx, "work_order", { title: "Utæt tag", kind: "repair", reported_date: "2026-11-05" });
    const anna = await createEntity(ctx, "person", { name: "Anna" });
    const secret = await createEntity(ctx, "person", { name: "Privat", health_private_user_id: null });
    await createEntity(ctx, "health_visit", { person_id: String(anna.id), visit_date: "2026-11-12", kind: "dentist" });
    await createEntity(ctx, "health_visit", { person_id: String(secret.id), visit_date: "2026-11-13", kind: "gp" });
    const { user: other } = await createUser(ctx, { name: "Anden bruger" });
    await db.execute("UPDATE person SET health_private_user_id = ? WHERE id = ?", [String(other.id), String(secret.id)]);

    const all = TIMELINE_KINDS.map((k) => k.id);
    const ev = await timelineEvents(db, { from: "2026-11-01", to: "2026-12-31", kinds: all, today: "2026-11-25", userId: null });
    const titles = ev.map((e) => e.title);
    expect(titles).toEqual(
      expect.arrayContaining(["Rens tagrender", "Garanti udløber: Opvasker", "Fornyelse: Indbo", "Opvasker lånt ud til Nabo", "Billån", "Binding slutter: Mobil", "Utæt tag", "Tandlæge: Anna"]),
    );
    expect(titles).not.toContain("Service");
    expect(titles).not.toContain("Reklamationsret udløber: Opvasker");
    expect(titles).not.toContain("Læge: Privat"); // private to another user
    expect(ev.find((e) => e.title === "Rens tagrender")).toMatchObject({ status: "overdue", ref: { type: "task" } });
    expect(ev.find((e) => e.kind === "lending")).toMatchObject({ start: "2026-11-20", end: "2026-11-25", status: "overdue" });
    expect(ev.find((e) => e.kind === "work_order")).toMatchObject({ start: "2026-11-05", end: "2026-11-25", status: "open", ref: { id: String(wo.id) } });
    expect(ev.find((e) => e.kind === "loan")).toMatchObject({ start: "2024-01-01", end: "2029-12-31" });
    // Sorted by date; kinds filter.
    expect(ev.map((e) => e.start)).toEqual([...ev.map((e) => e.start)].sort());
    const onlyPolicy = await timelineEvents(db, { from: "2026-11-01", to: "2026-12-31", kinds: ["policy"], today: "2026-11-25", userId: null });
    expect(onlyPolicy.map((e) => e.kind)).toEqual(["policy"]);
    // Purchases before the range are not included.
    expect((await timelineEvents(db, { from: "2026-11-01", to: "2026-12-31", kinds: ["purchase"], today: "2026-11-25", userId: null })).length).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  createEntity,
  createGift,
  createOutsidePerson,
  getSchemaVersion,
  giftSummary,
  healthPersons,
  lendItem,
  listGifts,
  listLendings,
  listPersons,
  migrate,
  search,
  setPersonLinks,
  timelineEvents,
} from "../src";
import { ctxFor, newArchive, tempDir, testEnv } from "./helpers";
import { migrations } from "../src/db/migrations.generated";

describe("migration 0011 – persons outside the household and gifts", () => {
  it("keeps existing persons in the household and adds the gift table with its rules", async () => {
    const env = testEnv();
    const db = await env.openDb(join(tempDir(), "v10.sqlite"));
    await migrate(db, () => env.clock.nowIso(), migrations.filter((m) => m.version <= 10));
    await db.execute("INSERT INTO person (id, name, created_at) VALUES ('00000000-0000-4000-8000-000000000001', 'Anna Eksempel', 'x')");
    await migrate(db, () => env.clock.nowIso(), migrations.filter((m) => m.version <= 11));
    expect(await getSchemaVersion(db)).toBe(11);
    expect(await db.select("SELECT name, household FROM person")).toEqual([{ name: "Anna Eksempel", household: 1 }]);
    await expect(db.execute("UPDATE person SET household = 2")).rejects.toThrow();
    await expect(db.execute("INSERT INTO gift (id, person_id, title, gift_date, created_at) VALUES ('00000000-0000-4000-8000-000000000002', NULL, 'Bog', '2026-12-24', 'x')")).rejects.toThrow();
    await expect(
      db.execute("INSERT INTO gift (id, direction, person_id, title, gift_date, created_at) VALUES ('00000000-0000-4000-8000-000000000003', 'lent', '00000000-0000-4000-8000-000000000001', 'Bog', '2026-12-24', 'x')"),
    ).rejects.toThrow();
  });
});

describe("persons outside the household", () => {
  it("can borrow and get gifts, but are kept out of household choices (owners, health)", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const db = archive.db;
    const me = await createEntity(ctx, "person", { name: "Anna Eksempel" });
    const friend = await createOutsidePerson(ctx, "  Karl Ven ", "ven");
    expect(friend).toMatchObject({ name: "Karl Ven", relation: "ven", household: 0 });
    expect((await listPersons(db, { household: true })).map((p) => p.name)).toEqual(["Anna Eksempel"]);
    expect((await listPersons(db, { household: false })).map((p) => p.name)).toEqual(["Karl Ven"]);
    expect((await listPersons(db)).map((p) => p.name)).toEqual(["Anna Eksempel", "Karl Ven"]);
    expect((await healthPersons(db, null)).map((p) => p.name)).toEqual(["Anna Eksempel"]);

    const item = await createEntity(ctx, "item", { name: "Stige" });
    await expect(setPersonLinks(ctx, "item", String(item.id), [String(friend.id)])).rejects.toThrow(/ikke med i husstanden/);
    await setPersonLinks(ctx, "item", String(item.id), [String(me.id)]);

    await lendItem(ctx, { item_id: String(item.id), borrower_person_id: String(friend.id), lent_date: "2026-11-20" });
    expect((await listLendings(db, "2026-11-24", { active: true })).map((l) => l.borrower)).toEqual(["Karl Ven"]);
  });
});

describe("gifts", () => {
  it("registers gifts given and received, lists and sums them per person, and shows them in search and the calendar", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const db = archive.db;
    const karl = await createOutsidePerson(ctx, "Karl Ven");
    const mor = await createOutsidePerson(ctx, "Mor Eksempel", "mor");
    await expect(createGift(ctx, { person_id: "", title: "Bog", gift_date: "2026-12-24" })).rejects.toThrow(/hvem gaven er til/);
    await expect(createGift(ctx, { person_id: String(karl.id), title: " ", gift_date: "2026-12-24" })).rejects.toThrow(/hvad gaven er/);
    await createGift(ctx, { person_id: String(karl.id), title: "Brætspillet Eksempel", occasion: "Fødselsdag", gift_date: "2026-03-02", amount_minor: 29900 });
    await createGift(ctx, { person_id: String(karl.id), title: "Vin", occasion: "Jul", gift_date: "2026-12-24", amount_minor: 15000 });
    await createGift(ctx, { person_id: String(mor.id), title: "Strikket halstørklæde", occasion: "Jul", gift_date: "2025-12-24", direction: "received" });

    expect((await listGifts(db, { personId: String(karl.id) })).map((g) => [g.title, g.person])).toEqual([
      ["Vin", "Karl Ven"],
      ["Brætspillet Eksempel", "Karl Ven"],
    ]);
    expect((await listGifts(db, { direction: "received" })).map((g) => g.title)).toEqual(["Strikket halstørklæde"]);
    expect((await listGifts(db, { year: 2025 })).map((g) => g.title)).toEqual(["Strikket halstørklæde"]);
    expect(await giftSummary(db)).toEqual([
      { person_id: karl.id, person: "Karl Ven", given: 2, received: 0, given_minor: 44900, last_given: "2026-12-24" },
      { person_id: mor.id, person: "Mor Eksempel", given: 0, received: 1, given_minor: 0, last_given: null },
    ]);
    expect((await giftSummary(db, { year: 2026 })).map((s) => s.person)).toEqual(["Karl Ven"]);

    expect((await search(db, "Brætspillet")).map((h) => h.type)).toContain("gift");
    const ev = await timelineEvents(db, { from: "2026-12-01", to: "2026-12-31", kinds: ["gift"], today: "2026-11-24", userId: null });
    expect(ev.map((e) => [e.title, e.detail])).toEqual([["Gave til Karl Ven: Vin", "Jul"]]);
  });
});

describe("Danish messages (review D2)", () => {
  it("validation errors and database constraint errors are in Danish", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const { createEntity: create, friendlyDbError } = await import("../src");
    await expect(create(ctx, "person", {} as never)).rejects.toThrow(/name: Feltet skal udfyldes/);
    await expect(create(ctx, "contact", { name: "X", kind: "alien" } as never)).rejects.toThrow(/kind: Ugyldig værdi\. Vælg en af: craftsman/);
    await expect(create(ctx, "person", { name: "X", birth_year: "1980" } as never)).rejects.toThrow(/birth_year: Skal være et tal/);
    await expect(create(ctx, "person", { name: "X", shoe: 42 } as never)).rejects.toThrow(/Ukendt felt: shoe/);
    try {
      await create(ctx, "person", {} as never);
    } catch (e) {
      expect((e as Error).message).not.toMatch(/Required|Invalid|Expected/);
    }
    expect(friendlyDbError("UNIQUE constraint failed: tag.name")).toMatch(/^Findes allerede/);
    expect(friendlyDbError("FOREIGN KEY constraint failed")).toMatch(/hænger sammen/);
    expect(friendlyDbError("CHECK constraint failed: x")).toBe("Værdien er ikke tilladt her.");
    expect(friendlyDbError("noget andet")).toBe("noget andet");
  });
});

describe("recurring expenses that duplicate a loan (review B2)", () => {
  it("finds a recurring expense with the loan's monthly payment or name on the same vehicle", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const { recurringLoanOverlaps } = await import("../src");
    const car = await createEntity(ctx, "vehicle", { name: "Familiebil" });
    const other = await createEntity(ctx, "vehicle", { name: "Anden bil" });
    await createEntity(ctx, "loan", { name: "Billån", kind: "car", payment_minor: 250000, vehicle_id: String(car.id) });
    await createEntity(ctx, "recurring_expense", { name: "Afdrag bil", amount_minor: 250050, period: "month", vehicle_id: String(car.id) });
    await createEntity(ctx, "recurring_expense", { name: "Forsikring", amount_minor: 60000, period: "month", vehicle_id: String(car.id) });
    await createEntity(ctx, "recurring_expense", { name: "Afdrag", amount_minor: 250000, period: "month", vehicle_id: String(other.id) });
    await createEntity(ctx, "loan", { name: "Boliglån Eksempel", kind: "mortgage", payment_minor: 900000 });
    await createEntity(ctx, "recurring_expense", { name: "Boliglån Eksempel", amount_minor: 12345, period: "month" });
    const all = await recurringLoanOverlaps(archive.db, { today: "2026-11-24" });
    expect(all.map((o) => [o.recurring_name, o.loan_name]).sort()).toEqual([
      ["Afdrag bil", "Billån"],
      ["Boliglån Eksempel", "Boliglån Eksempel"],
    ]);
    expect((await recurringLoanOverlaps(archive.db, { vehicleId: String(car.id) })).map((o) => o.recurring_name)).toEqual(["Afdrag bil"]);
  });
});

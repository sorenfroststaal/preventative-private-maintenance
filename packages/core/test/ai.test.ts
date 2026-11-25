import { describe, expect, it } from "vitest";
import { promises as fsp, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import {
  approveGroup,
  ConflictError,
  draftConflicts,
  editDraft,
  listDraftGroups,
  makeCtx,
  openArchive,
  openArchiveForAi,
  refOf,
  rejectGroup,
  runTool,
  setSetting,
  updateEntity,
  type Archive,
  type Env,
  type ToolDeps,
  type ToolResult,
} from "../src";
import { createDemoArchive, type DemoInfo } from "../scripts/seed";
import { tempDir, testEnv, track } from "./helpers";

async function demo(): Promise<{ env: Env; info: DemoInfo; ai: Archive; deps: ToolDeps; home: string }> {
  const env = testEnv();
  const info = await createDemoArchive(env, join(tempDir(), "arkiv"));
  const ai = track(await openArchiveForAi(env, info.root));
  const home = tempDir();
  await fsp.mkdir(join(home, "Downloads"));
  const deps: ToolDeps = { env, archive: ai, clientName: "vitest", homeDir: home, realpath: async (p) => realpathSync(p), sep };
  return { env, info, ai, deps, home };
}

const json = (r: ToolResult) => {
  expect(r.isError, r.content[0]?.type === "text" ? r.content[0].text : "").toBeFalsy();
  return JSON.parse((r.content[0] as { text: string }).text);
};
const s2 = (r: ToolResult) => json(r).items.find((i: { type: string }) => i.type === "vehicle").ref as string;
const errText = (r: ToolResult) => {
  expect(r.isError).toBe(true);
  return (r.content[0] as { text: string }).text;
};

/** No null, empty strings, empty arrays or empty objects anywhere (spec 06 krav 2). */
function assertCompact(v: unknown, path = "$") {
  expect(v, path).not.toBeNull();
  if (typeof v === "string") expect(v, path).not.toBe("");
  if (Array.isArray(v)) {
    expect(v.length, path).toBeGreaterThan(0);
    v.forEach((x, i) => assertCompact(x, `${path}[${i}]`));
  } else if (v && typeof v === "object") {
    expect(Object.keys(v).length, path).toBeGreaterThan(0);
    for (const [k, x] of Object.entries(v)) {
      if (k === "items" && Array.isArray(x) && x.length === 0) continue;
      assertCompact(x, `${path}.${k}`);
    }
  }
}

async function enableAll(env: Env, ai: Archive) {
  await setSetting(makeCtx(env, ai.db, null, "ui"), "ai.modules", { home: true, maintenance: true, vehicle: true, finance: true, insurance: true, health: true, documents: true, food: true });
}

describe("phase 3.2 / 3.8 – tools against the seed archive, compact output", () => {
  it("overview is under 1500 characters and covers the dashboard and this week's meal plan", async () => {
    const { deps } = await demo();
    const r = await runTool(deps, "overview", {});
    const text = (r.content[0] as { text: string }).text;
    expect(text.length).toBeLessThan(1500);
    const o = json(r);
    assertCompact(o);
    expect(o.overdue).toMatchObject({ n: 2 });
    expect(o.overdue.top.map((t: { t: string }) => t.t)).toEqual(["Skift til vinterdæk", "Rens tagrender"]);
    expect(o.missing.n).toBeGreaterThan(0);
    expect(o.meals.dishes).toHaveLength(6);
    expect(o.finance.top[0]).toHaveProperty("cat");
  });

  it("search, get, list, tasks, history, finance, recipes, meal_plan, inbox and document answer correctly", async () => {
    const { deps } = await demo();
    const s = json(await runTool(deps, "search", { q: "opvaskemaskine" }));
    assertCompact(s);
    const item = s.items.find((i: { type: string }) => i.type === "item");
    expect(item).toMatchObject({ title: "Opvaskemaskine", module: "home" });
    expect(item.ref).toMatch(/^[0-9a-f]{8}$/);

    const g = json(await runTool(deps, "get", { ref: item.ref }));
    assertCompact(g);
    expect(g).toMatchObject({ type: "item", name: "Opvaskemaskine", ref: item.ref });
    expect(g.links.map((l: { role: string }) => l.role).sort()).toEqual(["photo", "receipt"]);
    expect(g.history).toBeUndefined(); // no work orders on the item: empty fields are left out
    expect(json(await runTool(deps, "get", { ref: item.ref, fields: ["name", "purchase_price_minor"] }))).toEqual({ type: "item", name: "Opvaskemaskine", purchase_price_minor: 499900 });

    const l = json(await runTool(deps, "list", { type: "item", limit: 2 }));
    expect(l).toMatchObject({ n: 6, more: true, cursor: "2" });
    expect(l.items).toHaveLength(2);
    const l2 = json(await runTool(deps, "list", { type: "item", limit: 2, cursor: l.cursor }));
    expect(l2.items[0].ref).not.toBe(l.items[0].ref);
    const tx = json(await runTool(deps, "list", { type: "bank_transaction", filter: { from: "2026-11-01", to: "2026-11-30" } }));
    expect(tx.n).toBe(6);

    const t = json(await runTool(deps, "tasks", { status: "upcoming" }));
    expect(t.items.map((x: { t: string }) => x.t)).toContain("Rens brønd");

    const car = s2(await runTool(deps, "search", { q: "Familiebilen" }));
    const h = json(await runTool(deps, "history", { ref: car }));
    expect(h.items[0]).toMatchObject({ kind: "work_order" });
    expect(json(await runTool(deps, "get", { ref: car })).history[0]).toHaveProperty("t");

    const f = json(await runTool(deps, "finance", { kind: "budget", year: 2026 }));
    expect(f.budgets[0].name).toBe("Familiebudget");
    expect(json(await runTool(deps, "finance", { kind: "recurring" })).items).toHaveLength(2);
    expect(json(await runTool(deps, "finance", { kind: "month", year: 2026, month: 11 })).month).toBe("2026-11");

    const rec = json(await runTool(deps, "recipes", { q: "rejer" }));
    expect(rec.items[0]).toMatchObject({ name: "Indbagte rejer med ris", ingredients: ["300 g rejer", "250 g ris", "2 æg", "1 dl hvedemel", "salt og peber"] });

    const mp = json(await runTool(deps, "meal_plan", {}));
    expect(mp.week).toBe(48);
    expect(mp.dishes).toHaveLength(6);
    expect(mp.shopping.items.length).toBeGreaterThan(5);

    const inbox = json(await runTool(deps, "inbox", {}));
    expect(inbox.documents ?? []).toEqual([]);

    const receipt = g.links.find((x: { role: string }) => x.role === "receipt");
    const doc = await runTool(deps, "document", { ref: receipt.ref, content: "file" });
    expect(JSON.parse((doc.content[0] as { text: string }).text).text).toMatch(/Kvittering/);
    expect(doc.content[1]).toMatchObject({ type: "resource", resource: { mimeType: "application/pdf" } });
  });

  it("8-character refs and full ids work in every tool that takes a ref; ambiguous or unknown refs fail clearly", async () => {
    const { deps, ai } = await demo();
    const [car] = await ai.db.select<{ id: string }>("SELECT id FROM vehicle");
    for (const ref of [refOf(car!.id), car!.id]) {
      expect(json(await runTool(deps, "get", { ref })).name).toBe("Familiebilen");
      expect(json(await runTool(deps, "history", { ref })).n).toBeGreaterThanOrEqual(1);
      expect(json(await runTool(deps, "list", { type: "odometer_reading", filter: { vehicle_id: ref } })).n).toBeGreaterThanOrEqual(1);
    }
    expect(errText(await runTool(deps, "get", { ref: "ffffffff" }))).toMatch(/Ingen post/);
    expect(errText(await runTool(deps, "get", { ref: "xyz" }))).toBeTruthy();
  });
});

describe("phase 3.3 – modules switched off and private health data are filtered everywhere", () => {
  it("health is off by default: health tool, search, get and meal plan warnings", async () => {
    const { deps, ai } = await demo();
    const [ida] = await ai.db.select<{ id: string }>("SELECT id FROM person WHERE name = 'Ida Eksempel'");
    expect(errText(await runTool(deps, "health", { person: refOf(ida!.id) }))).toBe(
      "Modulet 'health' er ikke delt med AI. Det kan slås til i Indstillinger → AI-adgang.",
    );
    expect(json(await runTool(deps, "search", { q: "Birkepollen" })).n).toBe(0);
    const [allergy] = await ai.db.select<{ id: string }>("SELECT id FROM health_allergy LIMIT 1");
    expect(errText(await runTool(deps, "get", { ref: allergy!.id }))).toMatch(/health/);
    const mp = json(await runTool(deps, "meal_plan", {}));
    expect(mp.warnings_hidden).toBe(true);
    expect(JSON.stringify(mp)).not.toMatch(/Rejer \(/);
  });

  it("with health shared: owner sees warnings; private persons are hidden for other users in health, search, list and meal_plan", async () => {
    const { env, deps, ai, info } = await demo();
    await enableAll(env, ai);
    const mp = json(await runTool(deps, "meal_plan", {}));
    expect(mp.dishes.find((d: { t: string }) => d.t === "Indbagte rejer med ris").warnings).toEqual(["Rejer (Ida Eksempel)"]);
    const [ida] = await ai.db.select<{ id: string }>("SELECT id FROM person WHERE name = 'Ida Eksempel'");
    expect(json(await runTool(deps, "health", { person: ida!.id })).allergies).toHaveLength(2);

    // Ida's health data becomes private to Bo; AI acts as Anna.
    await ai.db.execute("UPDATE person SET health_private_user_id = ? WHERE id = ?", [info.boUserId, ida!.id]);
    expect(errText(await runTool(deps, "health", { person: ida!.id }))).toMatch(/private/);
    expect(json(await runTool(deps, "search", { q: "Birkepollen" })).n).toBe(0);
    expect(json(await runTool(deps, "list", { type: "health_allergy" })).n).toBe(0);
    const masked = json(await runTool(deps, "meal_plan", {}));
    expect(masked.dishes.find((d: { t: string }) => d.t === "Indbagte rejer med ris").warnings).toEqual(["Allergi hos et husstandsmedlem (privat)"]);
    expect(JSON.stringify(masked)).not.toMatch(/Ida|Rejer \(/);
  });

  it("documents need the documents module and a shared module among their links", async () => {
    const { env, deps, ai } = await demo();
    const [receipt] = await ai.db.select<{ id: string }>(
      "SELECT d.id FROM document d JOIN document_link l ON l.document_id = d.id WHERE l.target_type = 'item' AND l.role = 'receipt' LIMIT 1",
    );
    expect(json(await runTool(deps, "document", { ref: receipt!.id })).title).toBeTruthy();
    await setSetting(makeCtx(env, ai.db, null, "ui"), "ai.modules", { home: false, maintenance: true, vehicle: true, finance: true, insurance: true, health: false, documents: true, food: true });
    expect(errText(await runTool(deps, "document", { ref: receipt!.id }))).toMatch(/ikke delt/);
    expect(json(await runTool(deps, "search", { q: "kvittering opvasker" })).n).toBe(0);
    expect(errText(await runTool(deps, "list", { type: "item" }))).toMatch(/'home'/);
    await setSetting(makeCtx(env, ai.db, null, "ui"), "ai.modules", { home: true, maintenance: true, vehicle: true, finance: true, insurance: true, health: false, documents: false, food: true });
    expect(errText(await runTool(deps, "inbox", {}))).toMatch(/'documents'/);
    expect(json(await runTool(deps, "get", { ref: (await ai.db.select<{ id: string }>("SELECT id FROM item LIMIT 1"))[0]!.id })).links).toBeUndefined();
  });
});

describe("phase 3.4 – every call is logged in ai_access_log", () => {
  it("logs tool, args, returned refs, client and denials", async () => {
    const { deps, ai, info } = await demo();
    await runTool(deps, "search", { q: "opvaskemaskine" });
    await runTool(deps, "health", { person: "00000000" });
    await runTool(deps, "nope", {});
    const log = await ai.db.select<{ tool: string; args_json: string; returned_refs: string; denied_reason: string | null; client_name: string; as_user_id: string }>(
      "SELECT * FROM ai_access_log ORDER BY rowid",
    );
    expect(log.map((l) => l.tool)).toEqual(["search", "health", "nope"]);
    expect(JSON.parse(log[0]!.args_json)).toEqual({ q: "opvaskemaskine" });
    expect(JSON.parse(log[0]!.returned_refs).map((r: { type: string }) => r.type)).toContain("item");
    expect(log[0]).toMatchObject({ client_name: "vitest", as_user_id: info.annaUserId, denied_reason: null });
    expect(log[1]!.denied_reason).toBe("module:health");
  });
});

describe("phase 3.5 / 3.6 – propose creates only one draft group and writes nothing else", () => {
  async function snapshot(db: Archive["db"]) {
    const tables = (await db.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'search_index_%' ORDER BY name")).map((t) => t.name);
    const out: Record<string, unknown> = {};
    for (const t of tables) if (t !== "ai_draft" && t !== "ai_access_log") out[t] = await db.select(`SELECT * FROM ${t} ORDER BY rowid`);
    return out;
  }

  it("a series of reads and proposals leaves every other table unchanged", async () => {
    const { deps, ai, home } = await demo();
    const before = await snapshot(ai.db);
    const files = await fsp.readdir(ai.path("bilag"), { recursive: true });
    await fsp.writeFile(join(home, "Downloads", "kvittering.pdf"), "%PDF-1.4 syntetisk");
    for (const [n, a] of [
      ["overview", {}],
      ["search", { q: "rejer" }],
      ["get", { ref: (await ai.db.select<{ id: string }>("SELECT id FROM item LIMIT 1"))[0]!.id }],
      ["list", { type: "recipe" }],
      ["tasks", {}],
      ["meal_plan", {}],
      ["recipes", {}],
      ["inbox", {}],
      ["finance", { kind: "budget" }],
    ] as const) {
      await runTool(deps, n, a);
    }
    const item = (await ai.db.select<{ id: string }>("SELECT id FROM item LIMIT 1"))[0]!.id;
    const r = json(
      await runTool(deps, "propose", {
        rationale: "Test",
        ops: [
          { op: "create", type: "item", data: { name: "Ny robotstøvsuger", purchase_price_minor: 299900 } },
          { op: "update", type: "item", ref: refOf(item), data: { notes: "Tjekket" } },
          { op: "attach_document", data: { file_path: join(home, "Downloads", "kvittering.pdf"), target: "$1", role: "receipt" } },
        ],
      }),
    );
    expect(r).toMatchObject({ n: 3, status: "pending" });
    expect(await snapshot(ai.db)).toEqual(before);
    expect(await fsp.readdir(ai.path("bilag"), { recursive: true })).toEqual(files);
    const drafts = await ai.db.select<{ payload_json: string }>("SELECT payload_json FROM ai_draft");
    expect(new Set(drafts.map((d) => JSON.parse(d.payload_json).group))).toEqual(new Set([r.group]));
    expect(await fsp.readdir(ai.path("indbakke", "ai"))).toEqual([`${r.group}-3.pdf`]);
    expect(json(await runTool(deps, "draft_status", { group: r.group.slice(0, 8) }))).toMatchObject({ status: "pending", ops: [{ n: 1 }, { n: 2 }, { n: 3 }] });
  });

  it("rejects invalid data with the operation index and creates nothing", async () => {
    const { deps, ai, home } = await demo();
    const bad = await runTool(deps, "propose", {
      rationale: "x",
      ops: [
        { op: "create", type: "recipe", data: { name: "Ok", ingredients: ["1 løg"] } },
        { op: "create", type: "item", data: { name: "" } },
      ],
    });
    expect(errText(bad)).toMatch(/^Operation 2: name/);
    expect(errText(await runTool(deps, "propose", { rationale: "x", ops: [{ op: "create", type: "app_user", data: { name: "x" } }] }))).toMatch(/^Operation 1: type/);
    expect(errText(await runTool(deps, "propose", { rationale: "x", ops: [{ op: "create", type: "meal_plan_entry", data: { plan_date: "2026-11-30", recipe_id: "$2" } }] }))).toMatch(/\$2/);
    expect(errText(await runTool(deps, "propose", { rationale: "x", ops: [{ op: "create", type: "health_allergy", data: { person_id: "00000000-0000-4000-8000-000000000001", substance: "x" } }] }))).toMatch(/'health'/);
    // file_path outside the allowed folders, and `..` traversal.
    const outside = join(tempDir(), "hemmelig.pdf");
    await fsp.writeFile(outside, "%PDF");
    const item = (await ai.db.select<{ id: string }>("SELECT id FROM item LIMIT 1"))[0]!.id;
    for (const p of [outside, join(home, "Downloads", "..", "..", outside)]) {
      expect(errText(await runTool(deps, "propose", { rationale: "x", ops: [{ op: "attach_document", data: { file_path: p, target: item, role: "receipt" } }] }))).toMatch(/uden for de tilladte mapper/);
    }
    expect(await ai.db.select("SELECT * FROM ai_draft")).toEqual([]);
  });
});

describe("propose errors teach the AI client the valid fields; persons and properties", () => {
  it("lists valid fields with required markers, enums and units on unknown or invalid fields", async () => {
    const { deps } = await demo();
    const r = errText(await runTool(deps, "propose", { rationale: "x", ops: [{ op: "create", type: "vehicle", data: { name: "Ford S-Max", plate: "XX 12 345", year: 2018 } }] }));
    expect(r).toMatch(/^Operation 1: ukendte felter: plate, year\./);
    expect(r).toMatch(/Gyldige felter for vehicle \(\* = påkrævet\): name\*, registration, vin, make, model, model_year:tal/);
    expect(r).toMatch(/fuel=petrol\|diesel\|electric\|hybrid\|plugin_hybrid\|other/);
    const item = errText(await runTool(deps, "propose", { rationale: "x", ops: [{ op: "create", type: "item", data: { title: "TV" } }] }));
    expect(item).toMatch(/purchase_price_minor:øre/);
    expect(item).toMatch(/purchase_date:ÅÅÅÅ-MM-DD/);
    expect(item).toMatch(/location_id:ref/);
    expect(item).toMatch(/name: Required|name: /);
  });

  it("household members and homes can be proposed; access fields cannot", async () => {
    const { deps, ai } = await demo();
    const ok = json(
      await runTool(deps, "propose", {
        rationale: "Husstand",
        ops: [
          { op: "create", type: "person", data: { name: "Testperson", relation: "barn", birth_year: 2015 } },
          { op: "create", type: "property", data: { name: "Sommerhus", kind: "summerhouse", address: "Eksempelvej 1" } },
        ],
      }),
    );
    expect(ok).toMatchObject({ n: 2, status: "pending" });
    const [anna] = await ai.db.select<{ id: string }>("SELECT id FROM app_user LIMIT 1");
    const bad = errText(await runTool(deps, "propose", { rationale: "x", ops: [{ op: "create", type: "person", data: { name: "X", health_private_user_id: anna!.id } }] }));
    expect(bad).toMatch(/health_private_user_id kan kun ændres af brugeren/);
    // Pets (migration 0004): a dog with its vet, and an error listing the fields.
    expect(errText(await runTool(deps, "propose", { rationale: "x", ops: [{ op: "create", type: "pet", data: { chip: "1" } }] }))).toMatch(/species=dog\|cat.*chip_number/s);
    expect(json(await runTool(deps, "propose", { rationale: "Hunde", ops: [{ op: "create", type: "pet", data: { name: "Fido", species: "dog", breed: "Eksempelrace", chip_number: "208000000000001" } }] })).n).toBe(1);
  });
});

describe("propose: dry_run, all errors at once and coverage links", () => {
  it("dry_run validates without storing; every failing operation is reported", async () => {
    const { deps, ai } = await demo();
    const ok = json(await runTool(deps, "propose", { rationale: "x", dry_run: true, ops: [{ op: "create", type: "contact", data: { name: "VVS", kind: "craftsman" } }] }));
    expect(ok).toEqual({ dry_run: true, n: 1, status: "valid" });
    const bad = errText(
      await runTool(deps, "propose", {
        rationale: "x",
        dry_run: true,
        ops: [
          { op: "create", type: "policy", data: { title: "Husforsikring", kind: "building", premium: 1000, end_date: "2027-01-01" } },
          { op: "create", type: "contact", data: { name: "OK", kind: "shop" } },
          { op: "create", type: "location", data: { name: "Kælder", notes: "x" } },
        ],
      }),
    );
    expect(bad).toMatch(/^Operation 1: ukendte felter: premium, end_date\..*premium_minor:øre.*renewal_date:ÅÅÅÅ-MM-DD/s);
    expect(bad).toMatch(/\nOperation 3: .*property_id/s);
    expect(bad).not.toMatch(/Operation 2/);
    expect(await ai.db.select("SELECT * FROM ai_draft")).toEqual([]);
  });

  it("a home insurance policy and its coverage of the house in one group", async () => {
    const d = await demo();
    await d.ai.close();
    const app = track(await openArchive(d.env, d.info.root, { appVersion: "t" }));
    const deps: ToolDeps = { ...d.deps, archive: app };
    const [house] = await app.db.select<{ id: string }>("SELECT id FROM property LIMIT 1");
    const r = json(
      await runTool(deps, "propose", {
        rationale: "Husforsikring",
        ops: [
          { op: "create", type: "policy", data: { title: "Husforsikring", kind: "building", premium_minor: 450000, premium_period: "year", renewal_date: "2027-01-01" } },
          { op: "create", type: "policy_coverage", data: { policy_id: "$1", target_type: "property", target_id: refOf(house!.id) } },
        ],
      }),
    );
    expect(errText(await runTool(deps, "propose", { rationale: "x", ops: [{ op: "create", type: "policy_coverage", data: { policy_id: "$1", target_type: "property", target_id: "ffffffff" } }] }))).toMatch(/Operation 1/);
    await approveGroup(d.env, app, makeCtx(d.env, app.db, d.info.annaUserId, "ui"), r.group);
    const cov = await app.db.select<{ title: string }>(
      "SELECT p.title FROM policy_coverage c JOIN policy p ON p.id = c.policy_id WHERE c.target_type = 'property' AND c.target_id = ?",
      [house!.id],
    );
    expect(cov.map((c) => c.title)).toContain("Husforsikring");
  });
});

describe("feedback from filling a real archive (round 2)", () => {
  it("attach_document to a type that cannot have documents is rejected at propose, also via $n", async () => {
    const { deps, ai } = await demo();
    const [task] = await ai.db.select<{ id: string }>("SELECT id FROM task LIMIT 1");
    const [doc] = await ai.db.select<{ id: string }>("SELECT id FROM document LIMIT 1");
    const e1 = errText(await runTool(deps, "propose", { rationale: "x", ops: [{ op: "attach_document", data: { document: refOf(doc!.id), target: refOf(task!.id), role: "other" } }] }));
    expect(e1).toMatch(/Bilag kan ikke kobles til task\. Bilag kan kobles til: .*item.*pet.*contact/);
    const e2 = errText(
      await runTool(deps, "propose", {
        rationale: "x",
        ops: [
          { op: "create", type: "task", data: { title: "Ny opgave", module: "maintenance" } },
          { op: "attach_document", data: { document: refOf(doc!.id), target: "$1", role: "other" } },
        ],
      }),
    );
    expect(e2).toMatch(/^Operation 2: Bilag kan ikke kobles til task/);
    // Since migration 0006 a contact can have documents, with the new roles.
    const [contact] = await ai.db.select<{ id: string }>("SELECT id FROM contact LIMIT 1");
    expect(json(await runTool(deps, "propose", { rationale: "x", ops: [{ op: "attach_document", data: { document: refOf(doc!.id), target: refOf(contact!.id), role: "contract" } }] })).n).toBe(1);
    // The target may be given as ref on the operation; the error lists all attach fields.
    const [item] = await ai.db.select<{ id: string }>("SELECT id FROM item LIMIT 1");
    expect(json(await runTool(deps, "propose", { rationale: "x", ops: [{ op: "attach_document", ref: refOf(item!.id), data: { document: refOf(doc!.id), role: "manual" } }] })).n).toBe(1);
    expect(errText(await runTool(deps, "propose", { rationale: "x", ops: [{ op: "attach_document", data: { target: refOf(item!.id), role: "manual" } }] }))).toMatch(/document:ref ELLER file_path/);
  });

  it("warns about duplicates by name, policy number or registration", async () => {
    const { deps } = await demo();
    const r = json(
      await runTool(deps, "propose", {
        rationale: "x",
        ops: [
          { op: "create", type: "item", data: { name: "opvaskemaskine" } },
          { op: "create", type: "item", data: { name: "Helt ny ting" } },
        ],
      }),
    );
    expect(r.warnings).toEqual([expect.stringMatching(/^Operation 1: item "opvaskemaskine" findes allerede \(ref [0-9a-f]{8}\)/)]);
    expect(json(await runTool(deps, "propose", { rationale: "x", dry_run: true, ops: [{ op: "create", type: "item", data: { name: "Opvaskemaskine" } }] })).warnings).toHaveLength(1);
  });

  it("tasks: recurrence and first due date on create, due date on update; documents: title and date", async () => {
    const d = await demo();
    await d.ai.close();
    const app = track(await openArchive(d.env, d.info.root, { appVersion: "t" }));
    const deps: ToolDeps = { ...d.deps, archive: app };
    const ctx = makeCtx(d.env, app.db, d.info.annaUserId, "ui");
    const r = json(
      await runTool(deps, "propose", {
        rationale: "Service",
        ops: [{ op: "create", type: "task", data: { title: "Service af varmepumpe", module: "maintenance", recurrence: { kind: "fixed", unit: "year", every: 1, month: 11, day: 1 }, first_due_date: "2026-11-01" } }],
      }),
    );
    await approveGroup(d.env, app, ctx, r.group);
    const [task] = await app.db.select<{ id: string; recurrence_json: string; source: string }>("SELECT * FROM task WHERE title = 'Service af varmepumpe'");
    expect(JSON.parse(task!.recurrence_json)).toMatchObject({ kind: "fixed", month: 11, day: 1 });
    expect(task!.source).toBe("ai");
    const [noDate] = await app.db.select<{ id: string }>("SELECT t.id FROM task t JOIN task_occurrence o ON o.task_id = t.id AND o.status = 'open' WHERE o.due_date IS NULL LIMIT 1");
    const u = json(await runTool(deps, "propose", { rationale: "Dato", ops: [{ op: "update", type: "task", ref: refOf(noDate!.id), data: { due_date: "2026-12-15" } }] }));
    await approveGroup(d.env, app, ctx, u.group);
    expect((await app.db.select<{ due_date: string }>("SELECT due_date FROM task_occurrence WHERE task_id = ? AND status = 'open'", [noDate!.id]))[0]!.due_date).toBe("2026-12-15");
    expect(errText(await runTool(deps, "propose", { rationale: "x", ops: [{ op: "create", type: "task", data: { title: "x", module: "maintenance", recurrence: { kind: "fixed", unit: "year", every: 1 } } }] }))).toMatch(/recurrence:/);

    const [doc] = await app.db.select<{ id: string }>("SELECT id FROM document LIMIT 1");
    const dd = json(await runTool(deps, "propose", { rationale: "Dato", ops: [{ op: "update", type: "document", ref: refOf(doc!.id), data: { doc_date: "2025-05-01", title: "Garantibevis" } }] }));
    await approveGroup(d.env, app, ctx, dd.group);
    expect((await app.db.select("SELECT title, doc_date FROM document WHERE id = ?", [doc!.id]))[0]).toEqual({ title: "Garantibevis", doc_date: "2025-05-01" });
    expect(errText(await runTool(deps, "propose", { rationale: "x", ops: [{ op: "update", type: "document", ref: refOf(doc!.id), data: { sha256: "x" } }] }))).toMatch(/kun title og doc_date/);
  });

  it("inbox explains files in indbakke/ai that do not belong to a pending draft", async () => {
    const { deps, ai } = await demo();
    await fsp.mkdir(ai.path("indbakke", "ai"), { recursive: true });
    await fsp.writeFile(ai.path("indbakke", "ai", "lagt-her-ved-en-fejl.pdf"), "%PDF");
    const r = json(await runTool(deps, "inbox", {}));
    expect(r.ai_folder.not_imported).toEqual(["lagt-her-ved-en-fejl.pdf"]);
    expect(r.ai_folder.note).toMatch(/importeres ikke/);
  });
});

describe("phase 3.7 – AI inbox: approve all, approve selected, edit, reject, conflicts and rollback", () => {
  async function setup() {
    const d = await demo();
    const app = await (async () => {
      await d.ai.close();
      return track(await openArchive(d.env, d.info.root, { appVersion: "t" }));
    })();
    const deps: ToolDeps = { ...d.deps, archive: app };
    const ctx = makeCtx(d.env, app.db, d.info.annaUserId, "ui");
    return { ...d, app, deps, ctx };
  }

  it("approve all: a recipe and its planning via $1 in one transaction with via=ai_draft", async () => {
    const { env, app, deps, ctx } = await setup();
    const r = json(
      await runTool(deps, "propose", {
        rationale: "Ugens madplan",
        ops: [
          { op: "create", type: "recipe", data: { name: "Kyllingesalat", servings: 2, ingredients: ["300 g kylling", "1 salathoved"] } },
          { op: "create", type: "meal_plan_entry", data: { plan_date: "2026-11-30", recipe_id: "$1", servings: 2 } },
        ],
      }),
    );
    const [g] = await listDraftGroups(app.db, { status: "pending" });
    expect(g).toMatchObject({ group: r.group, rationale: "Ugens madplan", status: "pending" });
    const res = await approveGroup(env, app, ctx, r.group);
    expect(res.approved).toBe(2);
    const recipe = (await app.db.select<{ id: string }>("SELECT id FROM recipe WHERE name = 'Kyllingesalat'"))[0]!;
    expect((await app.db.select("SELECT * FROM meal_plan_entry WHERE recipe_id = ?", [recipe.id])).length).toBe(1);
    const audit = await app.db.select<{ via: string; user_id: string }>("SELECT via, user_id FROM audit_log WHERE entity_type = 'recipe' AND entity_id = ?", [recipe.id]);
    expect(audit[0]).toEqual({ via: "ai_draft", user_id: ctx.userId });
    expect((await listDraftGroups(app.db))[0]!.status).toBe("approved");
  });

  it("approve selected, edit before approval, reject the rest and delete its files", async () => {
    const { env, app, deps, ctx, home } = await setup();
    await fsp.writeFile(join(home, "Downloads", "bon.pdf"), "%PDF-1.4 syntetisk bon");
    const item = (await app.db.select<{ id: string }>("SELECT id FROM item WHERE name = 'Opvaskemaskine'"))[0]!.id;
    const r = json(
      await runTool(deps, "propose", {
        rationale: "Rydning",
        ops: [
          { op: "create", type: "contact", data: { name: "VVS Eksempel", kind: "craftsman" } },
          { op: "update", type: "item", ref: item, data: { notes: "Filter skiftet" } },
          { op: "attach_document", data: { file_path: join(home, "Downloads", "bon.pdf"), target: item, role: "receipt" } },
        ],
      }),
    );
    const g = (await listDraftGroups(app.db)).find((x) => x.group === r.group)!;
    await editDraft(ctx, g.drafts[0]!.id, { name: "VVS Eksempel ApS", kind: "craftsman" });
    await expect(editDraft(ctx, g.drafts[0]!.id, { name: "", kind: "craftsman" })).rejects.toThrow();
    await approveGroup(env, app, ctx, r.group, { only: [g.drafts[0]!.id, g.drafts[1]!.id] });
    expect((await app.db.select<{ name: string }>("SELECT name FROM contact WHERE name LIKE 'VVS%'"))[0]!.name).toBe("VVS Eksempel ApS");
    expect((await app.db.select<{ notes: string }>("SELECT notes FROM item WHERE id = ?", [item]))[0]!.notes).toBe("Filter skiftet");
    const file = app.path("indbakke", "ai", `${r.group}-3.pdf`);
    expect(await env.fs.exists(file)).toBe(true);
    expect(await rejectGroup(env, app, ctx, r.group)).toBe(1);
    expect(await env.fs.exists(file)).toBe(false);
    const statuses = (await listDraftGroups(app.db)).find((x) => x.group === r.group)!.drafts.map((d) => d.status);
    expect(statuses).toEqual(["approved", "approved", "rejected"]);
  });

  it("attach_document imports the file from indbakke/ai/ on approval", async () => {
    const { env, app, deps, ctx, home } = await setup();
    await fsp.writeFile(join(home, "Downloads", "faktura.pdf"), "%PDF-1.4 syntetisk faktura");
    const item = (await app.db.select<{ id: string }>("SELECT id FROM item WHERE name = 'Opvaskemaskine'"))[0]!.id;
    const r = json(await runTool(deps, "propose", { rationale: "Faktura", ops: [{ op: "attach_document", data: { file_path: join(home, "Downloads", "faktura.pdf"), target: refOf(item), role: "invoice", title: "Faktura service" } }] }));
    await approveGroup(env, app, ctx, r.group);
    const docs = await app.db.select<{ title: string; source: string }>(
      "SELECT d.title, d.source FROM document d JOIN document_link l ON l.document_id = d.id WHERE l.target_id = ? AND l.role = 'invoice'",
      [item],
    );
    expect(docs).toEqual([{ title: "Faktura service", source: "ai" }]);
    expect(await fsp.readdir(app.path("indbakke", "ai"))).toEqual([]);
  });

  it("warns about conflicts and requires confirmation", async () => {
    const { env, app, deps, ctx } = await setup();
    const item = (await app.db.select<{ id: string }>("SELECT id FROM item WHERE name = 'Sofa'"))[0]!.id;
    const r = json(await runTool(deps, "propose", { rationale: "x", ops: [{ op: "update", type: "item", ref: item, data: { notes: "AI" } }] }));
    (env.clock as unknown as { set(v: string): void }).set("2026-11-24T11:00:00.000Z");
    await updateEntity(ctx, "item", item, { notes: "Bruger" });
    const g = (await listDraftGroups(app.db)).find((x) => x.group === r.group)!;
    expect(await draftConflicts(app.db, g.drafts)).toHaveLength(1);
    await expect(approveGroup(env, app, ctx, r.group)).rejects.toBeInstanceOf(ConflictError);
    await approveGroup(env, app, ctx, r.group, { confirmConflicts: true });
    expect((await app.db.select<{ notes: string }>("SELECT notes FROM item WHERE id = ?", [item]))[0]!.notes).toBe("AI");
  });

  it("rolls everything back if one operation fails; only that one is failed, the rest can be approved without it", async () => {
    const { env, app, deps, ctx } = await setup();
    const r = json(
      await runTool(deps, "propose", {
        rationale: "x",
        ops: [
          { op: "create", type: "contact", data: { name: "Skal rulles tilbage", kind: "shop" } },
          { op: "create", type: "location", data: { property_id: "00000000-0000-4000-8000-0000000000ff", name: "Findes ikke" } },
        ],
      }),
    );
    await expect(approveGroup(env, app, ctx, r.group)).rejects.toThrow(/rullet tilbage.*Operation 2/);
    expect(await app.db.select("SELECT * FROM contact WHERE name = 'Skal rulles tilbage'")).toEqual([]);
    let g = (await listDraftGroups(app.db)).find((x) => x.group === r.group)!;
    expect(g.drafts.map((d) => d.status)).toEqual(["pending", "failed"]);
    expect(g.drafts[1]!.error).toMatch(/Operation 2/);
    await approveGroup(env, app, ctx, r.group);
    expect(await app.db.select("SELECT * FROM contact WHERE name = 'Skal rulles tilbage'")).toHaveLength(1);
    g = (await listDraftGroups(app.db)).find((x) => x.group === r.group)!;
    expect(g.drafts.map((d) => d.status)).toEqual(["approved", "failed"]);
  });
});

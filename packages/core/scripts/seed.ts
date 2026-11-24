/**
 * Creates a demo archive with SYNTHETIC data for all modules (spec 07, phase 1.10).
 * Usage: pnpm seed -- --archive ./local-data/demo
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  changeWorkOrderStatus,
  createArchive,
  createEntity,
  createTask,
  createUser,
  importDocument,
  linkDocument,
  makeCtx,
  addDays,
  addMonths,
  createRecipe,
  generateShoppingList,
  planMeal,
  updateRecipe,
  weekStart,
  type Ctx,
  type Row,
} from "../src";
import { nodeEnv } from "../src/node";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Minimal valid one-page PDF with a line of text. */
function syntheticPdf(text: string): Uint8Array {
  const stream = `BT /F1 14 Tf 50 750 Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

// 1x1 px PNG, colour varied per call so every photo has a unique hash.
function syntheticPng(seed: number): Uint8Array {
  const base = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  // Append a harmless tEXt-like trailer after IEND to vary the hash without breaking decoders.
  return new Uint8Array(Buffer.concat([base, Buffer.from(`seed:${seed}`)]));
}

const kr = (n: number) => Math.round(n * 100);

async function main() {
  const target = arg("archive");
  if (!target) {
    console.error("Brug: pnpm seed -- --archive <sti>");
    process.exit(1);
  }
  const root = resolve(target);
  const env = nodeEnv();
  const archive = await createArchive(env, root, { appVersion: "0.1.0-seed" });
  const sys = makeCtx(env, archive.db, null, "system");
  const tmp = mkdtempSync(join(tmpdir(), "ppm-seed-"));

  const { user: anna, person: annaP } = await createUser(sys, { name: "Anna Eksempel", isAdmin: true });
  const { person: boP } = await createUser(sys, { name: "Bo Eksempel", pin: "1234", relation: "partner" });
  const ctx: Ctx = makeCtx(env, archive.db, String(anna.id), "ui");
  const ida = await createEntity(ctx, "person", { name: "Ida Eksempel", relation: "barn", birth_year: 2018 });

  const doc = async (name: string, data: Uint8Array, target: { type: string; id: unknown; role: string }) => {
    const p = join(tmp, name);
    writeFileSync(p, data);
    const { document } = await importDocument(env, archive, ctx, p, { source: "drop" });
    await linkDocument(ctx, {
      document_id: String(document.id),
      target_type: target.type as never,
      target_id: String(target.id),
      role: target.role as never,
    });
    return document;
  };

  // ---- Contacts
  const vvs = await createEntity(ctx, "contact", { name: "Hansen VVS (eksempel)", kind: "craftsman", phone: "11 22 33 44" });
  const shop = await createEntity(ctx, "contact", { name: "Elektronikhuset (eksempel)", kind: "shop" });
  const insurer = await createEntity(ctx, "contact", { name: "Eksempel Forsikring", kind: "insurer" });
  const workshop = await createEntity(ctx, "contact", { name: "Byens Autoværksted (eksempel)", kind: "workshop" });
  const doctor = await createEntity(ctx, "contact", { name: "Lægehuset Eksempelby", kind: "doctor" });

  // ---- Home and inventory
  const house = await createEntity(ctx, "property", { name: "Huset", address: "Eksempelvej 1, 9999 Eksempelby", kind: "house" });
  const loc = async (name: string) => createEntity(ctx, "location", { property_id: String(house.id), name });
  const kitchen = await loc("Køkken");
  const living = await loc("Stue");
  await loc("Kælder");
  await loc("Have");
  const items: Row[] = [];
  for (const [name, location, brand, price, date] of [
    ["Opvaskemaskine", kitchen, "Eksempel", 4999, "2025-03-14"],
    ["Køleskab", kitchen, "Eksempel", 6499, "2024-08-02"],
    ["Emhætte", kitchen, "Eksempel", 2299, "2023-05-10"],
    ["Fjernsyn 55\"", living, "Eksempel", 7995, "2025-11-28"],
    ["Sofa", living, "Eksempel", 12000, "2022-02-01"],
  ] as const) {
    items.push(
      await createEntity(ctx, "item", {
        name,
        location_id: String(location.id),
        brand,
        model: "Model " + name.slice(0, 3).toUpperCase(),
        serial_number: `SN-${Math.abs(hash(name))}`,
        purchase_date: date,
        purchase_price_minor: kr(price),
        vendor_contact_id: String(shop.id),
        complaint_until: addYears(date, 2),
      }),
    );
  }
  await createEntity(ctx, "item_part", { item_id: String(items[2]!.id), name: "Kulfilter", part_number: "KF-100" });
  await doc("kvittering-opvasker.pdf", syntheticPdf("Kvittering opvaskemaskine 4.999,00 kr (syntetisk)"), { type: "item", id: items[0]!.id, role: "receipt" });
  await doc("kvittering-tv.pdf", syntheticPdf("Kvittering fjernsyn 7.995,00 kr (syntetisk)"), { type: "item", id: items[3]!.id, role: "receipt" });
  await doc("foto-opvasker.png", syntheticPng(1), { type: "item", id: items[0]!.id, role: "photo" });
  await doc("manual-emhaette.pdf", syntheticPdf("Brugsanvisning emhaette (syntetisk)"), { type: "item", id: items[2]!.id, role: "manual" });

  const well = await createEntity(ctx, "building_part", { property_id: String(house.id), name: "Regnvandsbrønd", kind: "well" });
  const heatPump = await createEntity(ctx, "building_part", { property_id: String(house.id), name: "Varmepumpe", kind: "heat_pump", installed_date: "2021-09-01" });
  await createEntity(ctx, "building_part", { property_id: String(house.id), name: "Tag", kind: "roof" });

  // ---- Work orders
  const wo = await createEntity(ctx, "work_order", {
    title: "Utæt afløb under køkkenvask",
    description: "Vand i skabet under vasken",
    kind: "repair",
    target_type: "property",
    target_id: String(house.id),
    contact_id: String(vvs.id),
    reported_date: "2026-05-02",
    cost_minor: kr(3125),
    created_by: String(anna.id),
  });
  await changeWorkOrderStatus(ctx, String(wo.id), "ordered", "VVS bestilt");
  await changeWorkOrderStatus(ctx, String(wo.id), "done", "Pakning skiftet");
  await changeWorkOrderStatus(ctx, String(wo.id), "closed");
  await doc("faktura-vvs.pdf", syntheticPdf("Faktura Hansen VVS 3.125,00 kr (syntetisk)"), { type: "work_order", id: wo.id, role: "invoice" });
  await createEntity(ctx, "work_order", {
    title: "Service af varmepumpe",
    kind: "service",
    status: "registered",
    target_type: "building_part",
    target_id: String(heatPump.id),
    reported_date: "2026-11-01",
  });

  // ---- Vehicle
  const car = await createEntity(ctx, "vehicle", {
    name: "Familiebilen",
    registration: "XX 12 345",
    make: "Eksempel",
    model: "Stationcar",
    model_year: 2019,
    first_registration_date: "2019-04-01",
    fuel: "petrol",
  });
  await createEntity(ctx, "odometer_reading", { vehicle_id: String(car.id), reading_date: "2026-03-15", km: 84210 });
  const carService = await createEntity(ctx, "work_order", {
    title: "Årsservice",
    kind: "service",
    status: "closed",
    target_type: "vehicle",
    target_id: String(car.id),
    contact_id: String(workshop.id),
    reported_date: "2026-03-15",
    completed_date: "2026-03-15",
    cost_minor: kr(2895),
    odometer_km: 84210,
  });
  await doc("servicefaktura-bil.pdf", syntheticPdf("Servicefaktura 2.895,00 kr (syntetisk)"), { type: "work_order", id: carService.id, role: "invoice" });

  // ---- Insurance
  const indbo = await createEntity(ctx, "policy", {
    insurer_contact_id: String(insurer.id),
    insurer_name: "Eksempel Forsikring",
    policy_number: "EKS-0001",
    kind: "home_contents",
    title: "Indboforsikring",
    premium_minor: kr(1890),
    premium_period: "year",
    renewal_date: "2027-01-01",
    deductible_minor: kr(1500),
    coverage_sum_minor: kr(30000),
  });
  await createEntity(ctx, "policy_coverage", { policy_id: String(indbo.id), target_type: "property", target_id: String(house.id) });
  for (const it of items) await createEntity(ctx, "policy_coverage", { policy_id: String(indbo.id), target_type: "item", target_id: String(it.id) });
  const carPolicy = await createEntity(ctx, "policy", { insurer_name: "Eksempel Forsikring", kind: "car", title: "Bilforsikring", premium_minor: kr(780), premium_period: "quarter", renewal_date: "2027-04-01" });
  await createEntity(ctx, "policy_coverage", { policy_id: String(carPolicy.id), target_type: "vehicle", target_id: String(car.id) });
  await doc("police-indbo.pdf", syntheticPdf("Policevilkaar indbo (syntetisk)"), { type: "policy", id: indbo.id, role: "policy_terms" });
  await createEntity(ctx, "claim", { policy_id: String(indbo.id), incident_date: "2026-05-02", description: "Vandskade i køkkenskab", status: "closed" });

  // ---- Finance
  const acc = await createEntity(ctx, "account", { name: "Budgetkonto", bank: "Sparekassen Kronjylland", last4: "0000" });
  const cats = Object.fromEntries((await archive.db.select<{ id: string; name: string }>("SELECT id, name FROM category")).map((c) => [c.name, c.id]));
  const tx = [
    ["2026-11-02", "Netto 1234 Eksempelby", -245.5, "Mad og dagligvarer"],
    ["2026-11-03", "Løn November", 28500, "Indtægt"],
    ["2026-11-05", "MobilePay Hansen VVS", -3125, "Bolig"],
    ["2026-11-10", "Husforsikring Eksempel Forsikring", -1890, "Forsikring"],
    ["2026-11-15", "Benzin Q8 Eksempelby", -612.35, "Transport"],
    ["2026-11-18", "Streamingtjeneste (eksempel)", -129, "Abonnementer"],
  ] as const;
  for (const [i, [date, text, amount, cat]] of tx.entries()) {
    await createEntity(ctx, "bank_transaction", {
      account_id: String(acc.id),
      booking_date: date,
      text,
      amount_minor: kr(amount),
      category_id: cats[cat],
      category_source: "user",
      dedupe_hash: `seed-${i}`,
    });
  }
  // Earlier months, so the dashboard shows 6 months of spending.
  const firstOfMonth = `${env.clock.today().slice(0, 7)}-01`;
  for (let m = 1; m <= 5; m++) {
    const month = addMonths(firstOfMonth, -m);
    for (const [j, [day, text, amount, cat]] of ([
      ["03", "Netto 1234 Eksempelby", -1450 - m * 85, "Mad og dagligvarer"],
      ["12", "Rema 1000 Eksempelby", -980 + m * 40, "Mad og dagligvarer"],
      ["15", "Benzin Q8 Eksempelby", -550 - m * 20, "Transport"],
      ["20", "Husleje og fællesudgifter (eksempel)", -6200, "Bolig"],
    ] as const).entries()) {
      await createEntity(ctx, "bank_transaction", {
        account_id: String(acc.id),
        booking_date: `${month.slice(0, 7)}-${day}`,
        text,
        amount_minor: kr(amount),
        category_id: cats[cat],
        category_source: "rule",
        dedupe_hash: `seed-m${m}-${j}`,
      });
    }
  }
  await createEntity(ctx, "category_rule", { match_type: "contains", pattern: "netto", category_id: cats["Mad og dagligvarer"]!, created_from: "learned" });
  const budget = await createEntity(ctx, "budget", { year: 2026, name: "Familiebudget" });
  for (const [cat, amount] of [["Mad og dagligvarer", 6000], ["Bolig", 9500], ["Transport", 2000], ["Forsikring", 1200], ["Abonnementer", 400]] as const) {
    await createEntity(ctx, "budget_line", { budget_id: String(budget.id), category_id: cats[cat]!, amount_minor: kr(amount) });
  }
  await createEntity(ctx, "recurring_expense", { name: "Streamingtjeneste", category_id: cats["Abonnementer"], amount_minor: kr(129), period: "month", next_date: "2026-12-18" });
  await createEntity(ctx, "recurring_expense", { name: "Indboforsikring", category_id: cats["Forsikring"], amount_minor: kr(1890), period: "year", policy_id: String(indbo.id) });

  // ---- Health (synthetic, no real medical data)
  await createEntity(ctx, "health_visit", { person_id: String(ida.id), visit_date: "2026-06-10", kind: "gp", contact_id: String(doctor.id), reason: "Børneundersøgelse", notes: "Alt fint (syntetisk)" });
  await createEntity(ctx, "health_screening", { person_id: String(annaP!.id), name: "Eksempelscreening", screening_date: "2024-02-01", result: "Normal", next_due_date: "2027-02-01" });
  await createEntity(ctx, "health_vaccination", { person_id: String(ida.id), vaccine: "Eksempelvaccine", dose: "2. dosis", given_date: "2026-01-15" });
  await createEntity(ctx, "health_medication", { person_id: String(boP!.id), name: "Eksempelmedicin", strength: "10 mg", dosage: "1 dagligt", start_date: "2026-01-01", prescription_renewal_date: "2026-12-15" });
  await createEntity(ctx, "health_allergy", { person_id: String(ida.id), substance: "Birkepollen", reaction: "Høfeber", severity: "mild" });
  // Triggers an allergy warning in the meal plan (shellfish).
  await createEntity(ctx, "health_allergy", { person_id: String(ida.id), substance: "Rejer", reaction: "Udslæt (syntetisk)", severity: "moderate" });
  for (const [d, v] of [["2026-01-10", 128], ["2026-06-10", 124], ["2026-11-10", 121]] as const) {
    await createEntity(ctx, "health_measurement", { person_id: String(boP!.id), type: "blood_pressure_sys", value: v, unit: "mmHg", measured_at: `${d}T08:00:00.000Z` });
  }

  // ---- Tasks (from templates/da/basis.json style)
  await createTask(ctx, { title: "Rens tagrender", module: "maintenance", target_type: "property", target_id: String(house.id), template_id: "home.gutters.clean", template_version: 1, source: "template", recurrence: { kind: "fixed", unit: "year", every: 1, month: 11, day: 1 }, firstDueDate: "2026-11-01" });
  await createTask(ctx, { title: "Rens brønd", module: "maintenance", target_type: "building_part", target_id: String(well.id), template_id: "home.rainwater_well.clean", template_version: 1, source: "template", recurrence: { kind: "interval", unit: "year", every: 1 }, firstDueDate: "2026-12-10" });
  await createTask(ctx, { title: "Test røgalarmer", module: "maintenance", target_type: "property", target_id: String(house.id), source: "template", template_id: "home.smoke_alarm.test", template_version: 1, recurrence: { kind: "interval", unit: "month", every: 3 } });
  await createTask(ctx, { title: "Skift til vinterdæk", module: "vehicle", target_type: "vehicle", target_id: String(car.id), source: "template", template_id: "vehicle.tires.winter", template_version: 1, recurrence: { kind: "fixed", unit: "year", every: 1, month: 10, day: 15 }, firstDueDate: "2026-10-15" });
  await createTask(ctx, { title: "Tandlægetjek", module: "health", target_type: "person", target_id: String(ida.id), assignee_person_id: String(annaP!.id), recurrence: { kind: "interval", unit: "year", every: 1 }, firstDueDate: "2027-01-20" });
  await createTask(ctx, { title: "Gennemgå forsikringer", module: "insurance", recurrence: { kind: "interval", unit: "year", every: 1 }, firstDueDate: "2026-12-01" });

  // ---- Meal plan (synthetic recipes, this week)
  const recipe = (name: string, data: Record<string, unknown>, ingredients: string[]) =>
    createRecipe(ctx, { name, ...data } as never, ingredients);
  const kodsovs = await recipe("Pasta med kødsovs", { servings: 4, prep_minutes: 30, estimated_cost_minor: kr(95), tags_json: '["pasta","hverdag"]', source_ref: "open-planner:pasta-med-kodsovs", instructions: "Brun kødet. Tilsæt løg, hvidløg og tomater. Kog pastaen. (syntetisk)" }, ["500 g hakket oksekød", "1 dåse hakkede tomater", "2 løg", "2-3 fed hvidløg", "400 g pasta", "Salt og peber"]);
  const rejer = await recipe("Indbagte rejer med ris", { servings: 4, prep_minutes: 40, estimated_cost_minor: kr(140), tags_json: '["fisk"]' }, ["300 g rejer", "250 g ris", "2 æg", "1 dl hvedemel", "Salt og peber"]);
  const suppe = await recipe("Tomatsuppe", { servings: 4, prep_minutes: 25, estimated_cost_minor: kr(45), tags_json: '["vegetar","hurtig"]' }, ["2 dåser hakkede tomater", "1 løg", "1 l grøntsagsbouillon", "1 dl fløde"]);
  const frikadeller = await recipe("Frikadeller med kartofler", { servings: 4, prep_minutes: 45, estimated_cost_minor: kr(110), tags_json: '["klassiker"]' }, ["500 g hakket svinekød", "1 æg", "1 dl mælk", "2 spsk hvedemel", "1 kg kartofler", "Salt og peber"]);
  const wok = await recipe("Grøntsagswok med tofu", { servings: 2, prep_minutes: 20, tags_json: '["vegetar","hurtig"]' }, ["200 g tofu", "1 pk wokgrøntsager", "2 spsk soja", "125 g nudler"]);
  const photo = join(tmp, "pasta.png");
  writeFileSync(photo, syntheticPng(4242));
  const pastaPhoto = await importDocument(env, archive, ctx, photo, { source: "drop", title: "Pasta med kødsovs" });
  await updateRecipe(ctx, String(kodsovs.id), { photo_document_id: String(pastaPhoto.document.id) });

  const monday = weekStart(env.clock.today());
  const plan: [number, Row | null, string | null][] = [
    [0, kodsovs, null],
    [1, suppe, null],
    [2, rejer, null],
    [3, null, "Rester"],
    [4, frikadeller, null],
    [5, wok, null],
  ];
  for (const [d, r, title] of plan) {
    await planMeal(ctx, { plan_date: addDays(monday, d), recipe_id: r ? String(r.id) : null, title, servings: r === wok ? 2 : 4 });
  }
  await generateShoppingList(ctx, monday);

  await archive.close();
  console.log(`Demoarkiv oprettet i ${root}`);
  console.log("Brugere: 'Anna Eksempel' (admin, ingen PIN) og 'Bo Eksempel' (PIN 1234). Alle data er syntetiske.");
}

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

function addYears(date: string, n: number): string {
  const [y, m, d] = date.split("-");
  return `${Number(y) + n}-${m}-${d}`;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

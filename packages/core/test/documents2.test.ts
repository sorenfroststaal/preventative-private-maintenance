import { describe, expect, it } from "vitest";
import { promises as fsp, readdirSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  APP_SCHEMA_VERSION,
  createEntity,
  createTask,
  createUser,
  dashboard,
  exportAllJson,
  exportIcs,
  exportTableCsv,
  generateInsuranceReport,
  importDocument,
  linkDocument,
  parseEml,
  reportItems,
  scanInbox,
  setSetting,
  updateEntity,
  type InboxState,
} from "../src";
import { ctxFor, fixedClock, newArchive, testEnv, writeTempFile } from "./helpers";

async function makePdf(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  page.drawText(text, { x: 50, y: 700, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  return doc.save();
}

// 1x1 PNG
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

describe("phase 2.8 – text extraction (spec 05 step 3)", () => {
  it("extracts the PDF text layer into the search index", async () => {
    const { env, archive } = await newArchive();
    const src = await writeTempFile("faktura.pdf", await makePdf("Faktura Hansen VVS 3.125,00 kr"));
    const { document } = await importDocument(env, archive, ctxFor(env, archive), src, { source: "drop" });
    expect(String(document.extracted_text)).toContain("Hansen VVS");
    expect(await archive.db.select("SELECT * FROM search_index WHERE search_index MATCH '\"hansen\"*'")).toHaveLength(1);
  });

  it("parses .eml: subject, sender, date and plain text only (no HTML)", () => {
    const eml = [
      "From: =?utf-8?B?SsO4cmdlbiBFa3NlbXBlbA==?= <j@example.invalid>",
      "Subject: =?iso-8859-1?Q?Ordrebekr=E6ftelse?= 1234",
      "Date: Tue, 24 Nov 2026 10:00:00 +0100",
      "MIME-Version: 1.0",
      'Content-Type: multipart/alternative; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>HTML <script>alert(1)</script></p>",
      "--b1",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Tak for din ordre p=C3=A5 opvaskemaskinen.=",
      " Pris 4.999 kr.",
      "--b1--",
      "",
    ].join("\r\n");
    const m = parseEml(new TextEncoder().encode(eml));
    expect(m).toEqual({
      subject: "Ordrebekræftelse 1234",
      from: "Jørgen Eksempel <j@example.invalid>",
      date: "2026-11-24",
      text: "Tak for din ordre på opvaskemaskinen. Pris 4.999 kr.",
    });
  });

  it("imports .eml with subject as title and date as doc_date", async () => {
    const { env, archive } = await newArchive();
    const src = await writeTempFile(
      "mail.eml",
      "From: butik@example.invalid\r\nSubject: Kvittering\r\nDate: Mon, 02 Nov 2026 12:00:00 +0100\r\n\r\nBeløb 245,50 kr\r\n",
    );
    const { document } = await importDocument(env, archive, ctxFor(env, archive), src, { source: "drop" });
    expect(document).toMatchObject({ title: "Kvittering", doc_date: "2026-11-02", mime: "message/rfc822" });
    expect(String(document.extracted_text)).toContain("Beløb 245,50 kr");
  });

  it("a damaged PDF is still imported without text", async () => {
    const { env, archive } = await newArchive();
    const src = await writeTempFile("broken.pdf", "%PDF-1.4 not really");
    const { document } = await importDocument(env, archive, ctxFor(env, archive), src, { source: "drop" });
    expect(document.extracted_text).toBeNull();
  });
});

describe("phase 2.8 – watched inbox", () => {
  it("imports only files whose size is stable for 2 s and moves them", async () => {
    const clock = fixedClock("2026-11-24T10:00:00.000Z");
    const env = testEnv({ clock });
    const { archive, root } = await newArchive(env);
    const ctx = ctxFor(env, archive);
    const inbox = join(root, "indbakke");
    const state: InboxState = new Map();
    await fsp.writeFile(join(inbox, "kvittering.pdf"), await makePdf("Kvittering"));
    await fsp.writeFile(join(inbox, "noter.docx"), "x");
    await fsp.mkdir(join(inbox, "undermappe"));
    await fsp.writeFile(join(inbox, "undermappe", "skjult.pdf"), "x");

    let r = await scanInbox(env, archive, ctx, state);
    expect(r).toMatchObject({ imported: [], pending: ["kvittering.pdf"], unsupported: ["noter.docx"] });

    clock.set("2026-11-24T10:00:01.000Z");
    r = await scanInbox(env, archive, ctx, state);
    expect(r.imported).toEqual([]);

    // File still growing: the timer restarts.
    await fsp.appendFile(join(inbox, "kvittering.pdf"), "\n%more");
    clock.set("2026-11-24T10:00:02.500Z");
    r = await scanInbox(env, archive, ctx, state);
    expect(r.imported).toEqual([]);

    clock.set("2026-11-24T10:00:04.600Z");
    r = await scanInbox(env, archive, ctx, state);
    expect(r.imported.map((i) => i.name)).toEqual(["kvittering.pdf"]);
    expect(r.imported[0]?.document.source).toBe("inbox");
    expect(readdirSync(inbox).sort()).toEqual(["ai", "importeret", "noter.docx", "undermappe"]);
    expect(readdirSync(join(inbox, "importeret", "2026-11"))).toEqual(["kvittering.pdf"]);

    // Same name again (different content) gets a unique name in importeret/.
    await fsp.writeFile(join(inbox, "kvittering.pdf"), await makePdf("Anden kvittering"));
    await scanInbox(env, archive, ctx, state);
    clock.set("2026-11-24T10:00:07.000Z");
    r = await scanInbox(env, archive, ctx, state);
    expect(r.imported).toHaveLength(1);
    expect(readdirSync(join(inbox, "importeret", "2026-11")).sort()).toEqual(["kvittering (2).pdf", "kvittering.pdf"]);
    expect(await archive.db.select("SELECT * FROM document WHERE source = 'inbox'")).toHaveLength(2);
  });
});

describe("phase 2.9 – dashboard queries", () => {
  it("fills every section", async () => {
    const { env, archive } = await newArchive();
    const sys = ctxFor(env, archive);
    const { user: anna } = await createUser(sys, { name: "Anna" });
    const { user: bo, person: boP } = await createUser(sys, { name: "Bo" });
    const ctx = ctxFor(env, archive, String(anna.id));
    const db = archive.db;
    await createTask(ctx, { title: "Forfalden", module: "maintenance", firstDueDate: "2026-11-01" });
    await createTask(ctx, { title: "Snart", module: "maintenance", firstDueDate: "2026-12-10" });
    await createTask(ctx, { title: "Langt ude", module: "maintenance", firstDueDate: "2027-06-01" });
    await createTask(ctx, { title: "Uden dato", module: "maintenance", recurrence: { kind: "interval", unit: "year", every: 1 } });
    await createEntity(ctx, "item", { name: "TV", purchase_price_minor: 799500, complaint_until: "2027-01-10" });
    await createEntity(ctx, "item", { name: "Gammel", complaint_until: "2028-01-01" });
    await createEntity(ctx, "item", { name: "Udløbet for længe siden", complaint_until: "2024-01-01" });
    await createEntity(ctx, "item", { name: "Netop udløbet", complaint_until: "2026-11-10" });
    await createEntity(ctx, "policy", { kind: "car", title: "Bil" });
    await createEntity(ctx, "vehicle", { name: "Bilen" });
    // Private health task for Bo
    await updateEntity(sys, "person", String(boP!.id), { health_private_user_id: String(bo.id) });
    await createEntity(sys, "health_medication", { person_id: String(boP!.id), name: "Medicin", prescription_renewal_date: "2026-12-01" });
    await db.execute(
      "INSERT INTO ai_draft (id, created_at, tool, action, entity_type, payload_json, rationale) VALUES ('d1','x','propose_create','create','item','{}','r')",
    );

    const d = await dashboard(db, { today: "2026-11-24", userId: String(anna.id) });
    expect(d.overdue.map((t) => t.title)).toEqual(["Forfalden"]);
    expect(d.upcoming.map((t) => t.title)).toEqual(["Snart"]);
    expect(d.expiring.map((t) => t.title)).toEqual(["Reklamationsret udløber: Netop udløbet", "Reklamationsret udløber: TV"]);
    expect(d.missing.tasksWithoutDate.map((t) => t.title)).toEqual(["Uden dato"]);
    expect(d.missing.itemsWithoutReceipt.map((i) => i.name)).toEqual(["TV"]);
    expect(d.missing.policiesWithoutRenewal.map((p) => p.title)).toEqual(["Bil"]);
    expect(d.missing.vehiclesWithoutOdometer.map((v) => v.name)).toEqual(["Bilen"]);
    expect(d.aiPending).toBe(1);
    expect(d.backup).toEqual({ lastAt: null, due: true });
    expect(d.horizonDays).toBe(30);

    // Bo sees his own private health task; the horizon setting is respected.
    await setSetting(ctx, "dashboard.horizon_days", 10);
    const forBo = await dashboard(db, { today: "2026-11-24", userId: String(bo.id) });
    expect(forBo.expiring.map((t) => t.title).sort()).toEqual(["Forny recept: Medicin (Bo)", "Reklamationsret udløber: Netop udløbet", "Reklamationsret udløber: TV"]);
    expect(forBo.upcoming).toEqual([]);
    await setSetting(ctx, "backup.last_at", "2026-11-20T10:00:00.000Z");
    expect((await dashboard(db, { today: "2026-11-24", userId: null })).backup.due).toBe(false);
  });
});

describe("phase 2.11 – export", () => {
  it("CSV, JSON and ICS without notes and with neutral health titles", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const ida = await createEntity(ctx, "person", { name: "Ida" });
    await createTask(ctx, { title: "Rens tagrender; vigtigt", description: "HEMMELIG NOTE", module: "maintenance", firstDueDate: "2026-12-01" });
    await createTask(ctx, { title: "Tandlæge Ida", module: "health", target_type: "person", target_id: String(ida.id), firstDueDate: "2027-01-20" });
    await createEntity(ctx, "item", { name: 'Sofa "Lux"; grå', notes: "line1\nline2" });

    const csv = await exportTableCsv(archive.db, "item");
    expect(csv.startsWith("﻿id;name;")).toBe(true);
    expect(csv).toContain('"Sofa ""Lux""; grå"');
    await expect(exportTableCsv(archive.db, "sqlite_master")).rejects.toThrow();

    const json = JSON.parse(await exportAllJson(archive.db, "2026-11-24T10:00:00Z"));
    expect(json).toMatchObject({ format: "ppm-export", schemaVersion: APP_SCHEMA_VERSION });
    expect(json.tables.item).toHaveLength(1);
    expect(json.tables.search_index).toBeUndefined();

    const ics = await exportIcs(archive.db, { nowIso: "2026-11-24T10:00:00.000Z" });
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261201");
    expect(ics).toContain("DTEND;VALUE=DATE:20261202");
    expect(ics).toContain("SUMMARY:Rens tagrender\\; vigtigt");
    expect(ics).toContain("SUMMARY:Helbred: påmindelse");
    expect(ics).not.toContain("Tandlæge");
    expect(ics).not.toContain("HEMMELIG");
    expect(ics).not.toContain("DESCRIPTION");
    const full = await exportIcs(archive.db, { nowIso: "2026-11-24T10:00:00.000Z", fullHealthTitles: true });
    expect(full).toContain("SUMMARY:Tandlæge Ida");
  });
});

describe("phase 2.6 – insurance report", () => {
  it("contains the expected items, total, and attachments", async () => {
    const { env, archive } = await newArchive();
    const ctx = ctxFor(env, archive);
    const house = await createEntity(ctx, "property", { name: "Huset", address: "Eksempelvej 1", kind: "house" });
    const stue = await createEntity(ctx, "location", { property_id: String(house.id), name: "Stue" });
    const koekken = await createEntity(ctx, "location", { property_id: String(house.id), name: "Køkken" });
    const tv = await createEntity(ctx, "item", { name: "Fjernsyn", location_id: String(stue.id), purchase_price_minor: 799500, purchase_date: "2025-11-28" });
    await createEntity(ctx, "item", { name: "Opvasker", location_id: String(koekken.id), purchase_price_minor: 499900 });
    await createEntity(ctx, "item", { name: "Løs cykel", purchase_price_minor: 300000 });
    const old = await createEntity(ctx, "item", { name: "Gammel radio", location_id: String(stue.id), purchase_price_minor: 10000 });
    await updateEntity(ctx, "item", String(old.id), {});
    const { archiveEntity } = await import("../src");
    await archiveEntity(ctx, "item", String(old.id));
    const pol = await createEntity(ctx, "policy", { kind: "home_contents", title: "Indbo", policy_number: "EKS-1" });
    await createEntity(ctx, "policy_coverage", { policy_id: String(pol.id), target_type: "property", target_id: String(house.id) });
    // Photo and receipts
    const photo = await importDocument(env, archive, ctx, await writeTempFile("tv.png", PNG), { source: "drop" });
    await linkDocument(ctx, { document_id: String(photo.document.id), target_type: "item", target_id: String(tv.id), role: "photo" });
    const receipt = await importDocument(env, archive, ctx, await writeTempFile("kvit.pdf", await makePdf("Kvittering TV")), { source: "drop" });
    await linkDocument(ctx, { document_id: String(receipt.document.id), target_type: "item", target_id: String(tv.id), role: "receipt" });

    const all = await generateInsuranceReport(env, archive, {}, { today: "2026-11-24" });
    expect(all.items).toBe(3);
    expect(all.totalMinor).toBe(799500 + 499900 + 300000);
    const parsed = await PDFDocument.load(all.bytes);
    expect(parsed.getTitle()).toBe("Forsikringsrapport");
    expect(all.pages).toBe(3); // cover, overview, items

    const byPolicy = await generateInsuranceReport(env, archive, { policyId: String(pol.id), includeAttachments: true }, { today: "2026-11-24" });
    expect(byPolicy.items).toBe(2);
    expect(byPolicy.totalMinor).toBe(1299400);
    expect(byPolicy.pages).toBe(4); // + one receipt page

    expect((await reportItems(archive.db, { locationId: String(stue.id), includeArchived: true })).map((i) => i.name)).toEqual(["Fjernsyn", "Gammel radio"]);
    expect((await reportItems(archive.db, { locationId: String(stue.id) })).map((i) => [i.name, i.has_receipt])).toEqual([["Fjernsyn", 1]]);
  });
});

/** Insurance report (spec 05): cover page, overview per location, items, optional attachments. */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { Archive } from "../archive/archive";
import type { DbAdapter, SqlValue } from "../db/adapter";
import type { Row } from "../domain/registry";
import type { Env } from "../env";
import { documentRelPath } from "../repo/documents";

export interface ReportFilter {
  propertyId?: string | null;
  locationId?: string | null;
  policyId?: string | null;
  includeArchived?: boolean;
  includeAttachments?: boolean;
}

export interface ReportItem extends Row {
  location_name: string | null;
  has_receipt: number;
}

export interface InsuranceReport {
  bytes: Uint8Array;
  items: number;
  totalMinor: number;
  pages: number;
}

/** Items matching the filter; a policy filter includes items covered via their property. */
export async function reportItems(db: DbAdapter, f: ReportFilter): Promise<ReportItem[]> {
  const conds: string[] = [];
  const params: SqlValue[] = [];
  if (!f.includeArchived) conds.push("i.archived_at IS NULL");
  if (f.locationId) {
    conds.push("i.location_id = ?");
    params.push(f.locationId);
  }
  if (f.propertyId) {
    conds.push("l.property_id = ?");
    params.push(f.propertyId);
  }
  if (f.policyId) {
    conds.push(`(EXISTS (SELECT 1 FROM policy_coverage c WHERE c.policy_id = ? AND c.target_type = 'item' AND c.target_id = i.id)
              OR EXISTS (SELECT 1 FROM policy_coverage c WHERE c.policy_id = ? AND c.target_type = 'property' AND c.target_id = l.property_id))`);
    params.push(f.policyId, f.policyId);
  }
  return db.select<ReportItem>(
    `SELECT i.*, l.name AS location_name,
            EXISTS (SELECT 1 FROM document_link d WHERE d.target_type = 'item' AND d.target_id = i.id AND d.role = 'receipt') AS has_receipt
       FROM item i LEFT JOIN location l ON l.id = i.location_id
     ${conds.length ? `WHERE ${conds.join(" AND ")}` : ""}
      ORDER BY l.name IS NULL, l.name, i.name`,
    params,
  );
}

const fmtDate = (d: unknown) => {
  if (!d) return "–";
  const [y, m, day] = String(d).split("-");
  return `${day}.${m}.${y}`;
};
const fmtMoney = (minor: unknown) => {
  if (minor === null || minor === undefined) return "–";
  const n = Number(minor);
  const kr = Math.floor(Math.abs(n) / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${n < 0 ? "-" : ""}${kr},${String(Math.abs(n) % 100).padStart(2, "0")} kr.`;
};

/** Replaces characters the standard (WinAnsi) font cannot encode. */
function safe(font: PDFFont, text: string): string {
  let out = "";
  for (const ch of text) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

class Writer {
  page!: PDFPage;
  y = 0;
  readonly margin = 50;
  constructor(
    readonly doc: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
  ) {
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage([595.28, 841.89]);
    this.y = 841.89 - this.margin;
  }
  ensure(h: number) {
    if (this.y - h < this.margin) this.newPage();
  }
  text(t: string, opts: { size?: number; bold?: boolean; x?: number; color?: [number, number, number] } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const maxWidth = 595.28 - this.margin - (opts.x ?? this.margin);
    for (const line of wrap(font, safe(font, t), size, maxWidth)) {
      this.ensure(size + 4);
      this.page.drawText(line, { x: opts.x ?? this.margin, y: this.y - size, size, font, color: rgb(...(opts.color ?? [0.1, 0.1, 0.1])) });
      this.y -= size + 4;
    }
  }
  gap(h = 8) {
    this.y -= h;
  }
}

function wrap(font: PDFFont, text: string, size: number, max: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > max && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  lines.push(line);
  return lines;
}

async function embedImage(doc: PDFDocument, env: Env, archive: Archive, d: Row): Promise<PDFImage | null> {
  try {
    const bytes = await env.fs.readFile(archive.path(documentRelPath(String(d.sha256), String(d.ext))));
    if (d.ext === "png") return await doc.embedPng(bytes);
    if (d.ext === "jpg" || d.ext === "jpeg") return await doc.embedJpg(bytes);
  } catch {
    // unreadable image: skipped
  }
  return null;
}

export async function generateInsuranceReport(
  env: Env,
  archive: Archive,
  filter: ReportFilter,
  opts: { today: string },
): Promise<InsuranceReport> {
  const db = archive.db;
  const items = await reportItems(db, filter);
  const total = items.reduce((a, i) => a + ((i.purchase_price_minor as number | null) ?? 0), 0);
  const doc = await PDFDocument.create();
  doc.setTitle("Forsikringsrapport");
  doc.setCreator("PPM");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold);

  // 1. Cover page
  const persons = await db.select<{ name: string }>("SELECT name FROM person WHERE archived_at IS NULL ORDER BY name");
  const property = filter.propertyId
    ? (await db.select<Row>("SELECT * FROM property WHERE id = ?", [filter.propertyId]))[0]
    : (await db.select<Row>("SELECT * FROM property WHERE archived_at IS NULL ORDER BY rowid LIMIT 1"))[0];
  const policy = filter.policyId ? (await db.select<Row>("SELECT * FROM policy WHERE id = ?", [filter.policyId]))[0] : undefined;
  const location = filter.locationId ? (await db.select<Row>("SELECT * FROM location WHERE id = ?", [filter.locationId]))[0] : undefined;
  w.gap(80);
  w.text("Forsikringsrapport", { size: 26, bold: true });
  w.gap(6);
  w.text(`Dato: ${fmtDate(opts.today)}`, { size: 12 });
  w.gap(18);
  if (persons.length) w.text(`Husstand: ${persons.map((p) => p.name).join(", ")}`, { size: 12 });
  if (property?.address) w.text(`Adresse: ${property.address}`, { size: 12 });
  if (policy) w.text(`Police: ${policy.title}${policy.policy_number ? ` (nr. ${policy.policy_number})` : ""}`, { size: 12 });
  w.gap(12);
  const filters = [
    filter.propertyId && property ? `Bolig: ${property.name}` : null,
    location ? `Lokation: ${location.name}` : null,
    policy ? `Police: ${policy.title}` : null,
    filter.includeArchived ? "Inkl. arkiverede genstande" : null,
  ].filter(Boolean);
  w.text(`Filtre: ${filters.length ? filters.join(" · ") : "Ingen (alle genstande)"}`, { size: 10, color: [0.35, 0.35, 0.35] });
  w.gap(30);
  w.text("Rapporten er dannet lokalt ud fra brugerens egne registreringer. Købspriser er ikke en vurdering af genanskaffelsesværdi.", {
    size: 9,
    color: [0.4, 0.4, 0.4],
  });

  // 2. Overview per location
  w.newPage();
  w.text("Oversigt", { size: 18, bold: true });
  w.gap(6);
  w.text(`Antal genstande: ${items.length}`, { size: 12 });
  w.text(`Samlet købspris: ${fmtMoney(total)}`, { size: 12, bold: true });
  w.gap(10);
  const byLocation = new Map<string, { n: number; sum: number }>();
  for (const i of items) {
    const k = i.location_name ?? "Uden lokation";
    const v = byLocation.get(k) ?? { n: 0, sum: 0 };
    v.n++;
    v.sum += (i.purchase_price_minor as number | null) ?? 0;
    byLocation.set(k, v);
  }
  for (const [k, v] of byLocation) {
    w.ensure(16);
    w.text(k, { size: 11 });
    w.y += 15;
    w.text(`${v.n} stk.`, { size: 11, x: 330 });
    w.y += 15;
    w.text(fmtMoney(v.sum), { size: 11, x: 420 });
  }

  // 3. Items
  w.newPage();
  w.text("Genstande", { size: 18, bold: true });
  w.gap(6);
  for (const i of items) {
    const photos = await db.select<Row>(
      `SELECT d.* FROM document_link l JOIN document d ON d.id = l.document_id
        WHERE l.target_type = 'item' AND l.target_id = ? AND l.role IN ('photo','photo_before','photo_after') AND d.ext IN ('jpg','jpeg','png')
        ORDER BY d.created_at LIMIT 2`,
      [String(i.id)],
    );
    const images = (await Promise.all(photos.map((p) => embedImage(doc, env, archive, p)))).filter((x): x is PDFImage => x !== null);
    const blockHeight = 110 + (images.length ? 0 : 0);
    w.ensure(blockHeight);
    const top = w.y;
    w.text(String(i.name), { size: 12, bold: true });
    const line = (label: string, value: string) => w.text(`${label}: ${value}`, { size: 9.5 });
    line("Mærke / model", [i.brand, i.model].filter(Boolean).join(" ") || "–");
    line("Serienummer", String(i.serial_number ?? "–"));
    line("Lokation", i.location_name ?? "–");
    line("Købsdato", fmtDate(i.purchase_date));
    line("Købspris", fmtMoney(i.purchase_price_minor));
    line("Forhandler", String(i.vendor_name ?? "–"));
    line("Kvittering", i.has_receipt ? "Ja" : "Nej");
    let x = 400;
    for (const img of images) {
      const scale = Math.min(80 / img.width, 80 / img.height);
      w.page.drawImage(img, { x, y: top - 85, width: img.width * scale, height: img.height * scale });
      x += 90;
    }
    w.y = Math.min(w.y, top - 92);
    w.page.drawLine({ start: { x: w.margin, y: w.y }, end: { x: 545, y: w.y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    w.gap(10);
  }

  // 4. Attachments
  if (filter.includeAttachments) {
    for (const i of items) {
      const receipts = await db.select<Row>(
        `SELECT d.* FROM document_link l JOIN document d ON d.id = l.document_id
          WHERE l.target_type = 'item' AND l.target_id = ? AND l.role = 'receipt' ORDER BY d.created_at`,
        [String(i.id)],
      );
      for (const r of receipts) {
        const path = archive.path(documentRelPath(String(r.sha256), String(r.ext)));
        try {
          if (r.ext === "pdf") {
            const src = await PDFDocument.load(await env.fs.readFile(path), { ignoreEncryption: true });
            for (const p of await doc.copyPages(src, src.getPageIndices())) doc.addPage(p);
          } else {
            const img = await embedImage(doc, env, archive, r);
            if (!img) continue;
            const page = doc.addPage([595.28, 841.89]);
            page.drawText(safe(font, `Bilag: ${i.name} – ${r.title ?? r.filename}`), { x: 50, y: 800, size: 10, font });
            const scale = Math.min(495 / img.width, 720 / img.height, 1);
            page.drawImage(img, { x: 50, y: 780 - img.height * scale, width: img.width * scale, height: img.height * scale });
          }
        } catch {
          // a damaged attachment must not stop the report
        }
      }
    }
  }

  const bytes = await doc.save();
  return { bytes, items: items.length, totalMinor: total, pages: doc.getPageCount() };
}

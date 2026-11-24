import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Archive } from '../archive';
import type { DbAdapter } from '../db/adapter';
import { today } from '../domain/dates';
import { insideArchive } from '../scoped-path';
import { documentPath } from '../repo/documents';

type Item = { id: string; name: string; brand: string | null; model: string | null; serial_number: string | null;
  location: string | null; purchase_date: string | null; purchase_price_minor: number | null; currency: string; vendor: string | null };
const filters = z.object({ property: z.uuid().optional(), location: z.uuid().optional(), policy: z.uuid().optional(),
  archived: z.boolean().default(false), receipts: z.boolean().default(false) }).default({ archived: false, receipts: false });
export async function insuranceItems(db: DbAdapter, raw: unknown) {
  const filter = filters.parse(raw);
  const items = await db.select<Item>(`SELECT i.id, i.name, i.brand, i.model, i.serial_number, l.name AS location,
    i.purchase_date, i.purchase_price_minor, i.currency, COALESCE(i.vendor_name, c.name) AS vendor
    FROM item i LEFT JOIN location l ON l.id = i.location_id LEFT JOIN contact c ON c.id = i.vendor_contact_id
    WHERE (? OR i.archived_at IS NULL) AND (? IS NULL OR l.property_id = ?) AND (? IS NULL OR i.location_id = ?)
      AND (? IS NULL OR EXISTS (SELECT 1 FROM policy_coverage p WHERE p.policy_id = ? AND
        (p.target_type = 'item' AND p.target_id = i.id OR p.target_type = 'property' AND p.target_id = l.property_id)))
    ORDER BY l.name, i.name`, [Number(filter.archived), filter.property ?? null, filter.property ?? null, filter.location ?? null,
    filter.location ?? null, filter.policy ?? null, filter.policy ?? null]);
  const totals: Record<string, number> = Object.create(null);
  for (const item of items) totals[item.currency] = (totals[item.currency] ?? 0) + (item.purchase_price_minor ?? 0);
  return { filter, items, totals };
}

const money = (value: number, currency: string) => new Intl.NumberFormat('da-DK', { style: 'currency', currency }).format(value / 100);
export async function insuranceReport(archive: Archive, raw: unknown) {
  const { filter, items, totals } = await insuranceItems(archive.db, raw);
  const pdf = await PDFDocument.create();
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const clean = (string: string) => Array.from(string, c => {
    try { normal.encodeText(c); return c; } catch { return '?'; }
  }).join('');
  let page = pdf.addPage();
  let y = page.getHeight() - 56;
  const next = () => { page = pdf.addPage(); y = page.getHeight() - 56; };
  function line(value: string, heading = false) {
    const string = clean(value);
    const size = heading ? 18 : 11;
    const font = heading ? bold : normal;
    let partial = '';
    for (const char of string) {
      if (font.widthOfTextAtSize(partial + char, size) > page.getWidth() - 96) {
        if (y < 45) next();
        page.drawText(partial, { x: 48, y, size, font });
        y -= 17;
        partial = '';
      }
      partial += char;
    }
    if (y < 45) next();
    page.drawText(partial, { x: 48, y, size, font });
    y -= heading ? 29 : 17;
  }
  pdf.setTitle('Forsikringsrapport');
  line('Forsikringsrapport', true);
  line(today());
  const people = await archive.db.select<{ name: string }>('SELECT name FROM person WHERE archived_at IS NULL ORDER BY name');
  line('Husstand: ' + people.map(p => p.name).join(', '));
  const addresses = await archive.db.select<{ name: string; address: string | null }>('SELECT name, address FROM property WHERE archived_at IS NULL AND (? IS NULL OR id = ?)', [filter.property ?? null, filter.property ?? null]);
  for (const address of addresses) line([address.name, address.address].filter(Boolean).join(' · '));
  if (filter.policy) {
    const [policy] = await archive.db.select<{ title: string; policy_number: string }>('SELECT title, policy_number FROM policy WHERE id = ?', [filter.policy]);
    if (policy) line('Police: ' + [policy.title, policy.policy_number].filter(Boolean).join(' · '));
  }
  line(filter.archived ? 'Aktive og arkiverede genstande' : 'Aktive genstande');
  next();
  line('Oversigt', true);
  line(items.length + ' genstande');
  for (const [currency, amount] of Object.entries(totals)) line(money(amount, currency));
  const locations = new Map<string, { count: number; values: Map<string, number> }>();
  for (const item of items) {
    const label = item.location ?? 'Uden placering';
    const location = locations.get(label) ?? { count: 0, values: new Map<string, number>() };
    location.count++;
    location.values.set(item.currency, (location.values.get(item.currency) ?? 0) + (item.purchase_price_minor ?? 0));
    locations.set(label, location);
  }
  for (const [name, group] of locations) line([name, group.count, ...[...group.values].map(([currency, amount]) => money(amount, currency))].join(' · '));
  const receipts = new Map<string, { sha256: string; ext: string }>();
  if (items.length) { next(); line('Genstande', true); }
  for (const item of items) {
    const docs = await archive.db.select<{ id: string; sha256: string; role: string; ext: string }>(`
      SELECT d.id, d.sha256, d.ext, l.role FROM document_link l JOIN document d ON d.id = l.document_id
      WHERE l.target_type = 'item' AND l.target_id = ? AND l.role IN ('receipt', 'photo') ORDER BY d.created_at`, [item.id]);
    if (y < 130) next();
    line(item.name, true);
    line([item.brand, item.model, item.serial_number, item.location].filter(Boolean).join(' · '));
    line([item.purchase_date, item.purchase_price_minor === null ? null : money(item.purchase_price_minor, item.currency), item.vendor].filter(Boolean).join(' · '));
    line(docs.some(doc => doc.role === 'receipt') ? 'Kvittering: ja' : 'Kvittering: nej');
    const images = docs.filter(doc => doc.role === 'photo' && /^(png|jpg|jpeg)$/.test(doc.ext)).slice(0, 2);
    if (images.length) {
      if (y < 130) next();
      for (const [index, doc] of images.entries()) {
        try {
          const bytes = await readFile(await insideArchive(archive.root, join(archive.root, documentPath(doc.sha256, doc.ext))));
          const img = doc.ext === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
          page.drawImage(img, { ...img.scaleToFit(200, 90), x: 48 + index * 220, y: y - 90 });
        } catch { /* A damaged photo does not prevent the inventory report. */ }
      }
      y -= 100;
    }
    for (const doc of docs.filter(d => d.role === 'receipt')) receipts.set(doc.id, doc);
  }
  if (filter.receipts) {
    for (const doc of receipts.values()) {
      try {
        const bytes = await readFile(await insideArchive(archive.root, join(archive.root, documentPath(doc.sha256, doc.ext))));
        if (doc.ext === 'pdf') {
          const receipt = await PDFDocument.load(bytes);
          for (const copy of await pdf.copyPages(receipt, receipt.getPageIndices())) pdf.addPage(copy);
        } else if (/^(png|jpg|jpeg)$/.test(doc.ext)) {
          next();
          const img = doc.ext === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
          const size = img.scaleToFit(page.getWidth() - 96, page.getHeight() - 112);
          page.drawImage(img, { ...size, x: 48, y: y - size.height });
        }
      } catch { next(); line('Et kvitteringsbilag kunne ikke medtages.'); }
    }
  }
  const path = join(await insideArchive(archive.root, join(archive.root, 'eksport')), 'forsikringsrapport-' + today().replaceAll('-', '') + '.pdf');
  await writeFile(path, await pdf.save(), { flag: 'wx' });
  return path;
}

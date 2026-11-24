import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openArchive, type Archive } from './archive';
import { writeLink } from './repo/links';
import { saveRecord, setArchived, listRecords } from './repo/records';
import { searchRecords } from './repo/search';
import { dashboard, financeYear, history, vehicleCosts } from './repo/overview';
import { importArchiveDocument } from './node-documents';
import { importBank, parseBank, previewBank, danishMinor, saveBankProfile } from './import/bank';
import { calendar, exportFile } from './report/export';
import { insuranceItems, insuranceReport } from './report/insurance';
import { PDFDocument } from 'pdf-lib';
import { trackInbox } from './import/inbox';
import { createUser, setHealthPrivacy } from './repo/users';
import { completeTask, createTask } from './repo/tasks';

const ctx = { via: 'ui' } as const;
let root: string;
let archive: Archive;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ppm-modules-'));
  archive = await openArchive(root, { create: true });
});

afterEach(async () => {
  await archive.close();
  await rm(root, { recursive: true, force: true });
});

it('indexes item lifecycle, audits changes and updates derived deadlines without duplicates', async () => {
  const { db } = archive;
  const item = await saveRecord(db, 'item', { name: 'Eksempelmaskine', warranty_until: '2027-01-01',
    complaint_until: '2028-01-01' }, ctx);
  expect(await searchRecords(db, 'eksempelma')).toHaveLength(3);
  const references = await db.select('SELECT system_ref FROM task ORDER BY system_ref');
  expect(references).toHaveLength(2);
  await saveRecord(db, 'item', { name: 'Testmaskine', warranty_until: '2027-02-01' }, ctx, item.id);
  expect(await searchRecords(db, 'eksempelma')).toHaveLength(0);
  const [due] = await db.select<{ due_date: string }>(`SELECT o.due_date FROM task_occurrence o JOIN task t ON t.id = o.task_id
    WHERE t.system_ref = ? AND o.status = 'open'`, ['item.warranty_until:' + item.id]);
  expect(due.due_date).toBe('2027-02-01');
  await setArchived(db, 'item', item.id, true, ctx);
  expect(await searchRecords(db, 'testmaskine')).toEqual([]);
  expect(await db.select('SELECT id FROM task WHERE status = ?', ['archived'])).toHaveLength(2);
  await setArchived(db, 'item', item.id, false, ctx);
  expect(await searchRecords(db, 'testmaskine')).toHaveLength(3);
  expect(await db.select('SELECT system_ref FROM task ORDER BY system_ref')).toEqual(references);
  const audits = await db.select<{ action: string; diff_json: string }>('SELECT action, diff_json FROM audit_log WHERE entity_id = ? ORDER BY rowid', [item.id]);
  expect(audits.map(r => r.action)).toEqual(['create', 'update', 'archive', 'restore']);
  expect(JSON.parse(audits[1].diff_json).name).toEqual(['Eksempelmaskine', 'Testmaskine']);
});

it('validates polymorphic links and audits tuple identifiers on add and remove', async () => {
  const { db } = archive;
  const photo = await importArchiveDocument(archive, 'syntetisk.png', new TextEncoder().encode('fixture'), ctx);
  const item = await saveRecord(db, 'item', { name: 'Syntetisk apparat' }, ctx);
  const key = { document_id: photo.id, target_type: 'item', target_id: item.id, role: 'photo' };
  await expect(writeLink(db, 'document_link', { ...key, target_id: crypto.randomUUID() }, false, ctx)).rejects.toThrow('findes ikke');
  await writeLink(db, 'document_link', key, false, ctx);
  await writeLink(db, 'document_link', key, true, ctx);
  expect(await db.select('SELECT * FROM document_link')).toEqual([]);
  const log = await db.select<{ action: string; diff_json: string }>('SELECT action, diff_json FROM audit_log WHERE entity_id = ? ORDER BY rowid', [Object.values(key).join(':')]);
  expect(log.map(entry => entry.action)).toEqual(['create', 'delete']);
  expect(JSON.parse(log[1].diff_json).role).toEqual(['photo', null]);
});

it('keeps status history and odometer readings and groups vehicle costs by currency and year', async () => {
  const { db } = archive;
  const car = await saveRecord(db, 'vehicle', { name: 'Demobil' }, ctx);
  const job = await saveRecord(db, 'work_order', { title: 'Demoservice', kind: 'service', target_type: 'vehicle', target_id: car.id,
    reported_date: '2026-02-03', cost_minor: 12000, odometer_km: 23456 }, ctx);
  await saveRecord(db, 'work_order', { status: 'done' }, ctx, job.id);
  expect(await history(db, 'work_order', job.id)).toHaveLength(2);
  expect(await listRecords(db, 'odometer_reading', ctx)).toMatchObject([{ km: 23456, source: 'work_order' }]);
  expect(await vehicleCosts(db, car.id, 2026)).toEqual([{ currency: 'DKK', amount: 12000 }]);
  expect(await vehicleCosts(db, car.id, 2025)).toEqual([]);
});

it('reads Danish money and Windows-1252 and only imports new rows, including repeated originals', async () => {
  const { db } = archive;
  const account = await saveRecord(db, 'account', { name: 'Demokonto' }, ctx);
  const category = await saveRecord(db, 'category', { name: 'Testindkøb', kind: 'expense' }, ctx);
  const rule = await saveRecord(db, 'category_rule', { match_type: 'regex', pattern: '^k[øo]b$', category_id: category.id }, ctx);
  await expect(saveRecord(db, 'category_rule', { pattern: '[' }, ctx, rule.id)).rejects.toThrow('Ugyldigt');
  expect(danishMinor('-1.234,56')).toBe(-123456);
  const bytes = Buffer.from('Dato;Posteringstekst;Beløb\n01.03.2026;Køb;"-1.234,56"\n01.03.2026;Køb;"-1.234,56"', 'latin1');
  const rows = parseBank(bytes, 'sparkron', account.id);
  expect(rows.map(r => r.text)).toEqual(['Køb', 'Køb']);
  expect(rows[0].dedupe_hash).not.toBe(rows[1].dedupe_hash);
  const store = async (tx: Parameters<typeof importArchiveDocument>[5]) =>
    (await importArchiveDocument(archive, 'syntetisk.csv', bytes, ctx, 'bank_import', tx)).id;
  expect(await previewBank(db, account.id, rows)).toMatchObject({ added: 2, duplicates: 0 });
  expect(await importBank(db, account.id, rows, 'sparkron', ctx, store)).toEqual({ added: 2, duplicates: 0 });
  expect(await importBank(db, account.id, rows, 'sparkron', ctx, store)).toEqual({ added: 0, duplicates: 2 });
  expect(await db.select('SELECT category_id FROM bank_transaction')).toEqual([{ category_id: category.id }, { category_id: category.id }]);
  expect(() => parseBank(Buffer.from('Dato;Posteringstekst;Beløb\n99.03.2026;Demo;12,00'), 'sparkron', account.id)).toThrow('Række 2');
});

it('uses the policy scope in the report and generates a PDF with inventory and totals', async () => {
  const { db } = archive;
  const item = await saveRecord(db, 'item', { name: 'Demogenstand', purchase_price_minor: 159900 }, ctx);
  const policy = await saveRecord(db, 'policy', { title: 'Demopolice', kind: 'home_contents', renewal_date: '2026-06-01' }, ctx);
  await writeLink(db, 'policy_coverage', { policy_id: policy.id, target_type: 'item', target_id: item.id }, false, ctx);
  await saveRecord(db, 'item', { name: 'Uden dækning', purchase_price_minor: 99 }, ctx);
  expect(await insuranceItems(db, { policy: policy.id })).toMatchObject({ items: [{ id: item.id }], totals: { DKK: 159900 } });
  const path = await insuranceReport(archive, { policy: policy.id });
  const pdf = await PDFDocument.load(await readFile(path));
  expect(pdf.getTitle()).toBe('Forsikringsrapport');
  expect(pdf.getPageCount()).toBe(3);
  expect(await db.select('SELECT system_ref FROM task')).toEqual([{ system_ref: 'policy.renewal:' + policy.id }]);
});

it('omits private health records from lists, prefix searches and dashboard for other users', async () => {
  const { db } = archive;
  const owner = await createUser(db, { name: 'Ejer', personName: 'Eksempelperson' });
  const other = await createUser(db, { name: 'Medbruger', personName: 'Anden eksempelperson' }, owner);
  const [person] = await db.select<{ id: string }>('SELECT id FROM person WHERE app_user_id = ?', [owner]);
  await db.execute('UPDATE person SET health_private_user_id = ? WHERE id = ?', [owner, person.id]);
  await saveRecord(db, 'health_screening', { person_id: person.id, name: 'Syntetisk screening', next_due_date: '2026-11-25' }, { ...ctx, userId: owner });
  expect(await listRecords(db, 'health_screening', { ...ctx, userId: other })).toEqual([]);
  expect(await searchRecords(db, 'syntetisk', other)).toEqual([]);
  expect(await searchRecords(db, 'syntetisk', owner)).toHaveLength(2);
  expect((await dashboard(db, other, '2026-11-24')).upcoming).toEqual([]);
  expect((await dashboard(db, owner, '2026-11-24')).upcoming).toHaveLength(1);
});

it('waits for inbox files to stabilize and resets the timer when bytes change', () => {
  const track = trackInbox();
  const file = { name: 'simuleret.pdf', size: 100, modified: 1 };
  expect(track([file], 0)).toEqual([]);
  expect(track([file], 1999)).toEqual([]);
  expect(track([{ ...file, size: 200 }], 2000)).toEqual([]);
  expect(track([{ ...file, size: 200 }], 4000)).toHaveLength(1);
});

it('queries dashboard buckets, finance, missing data, and the draft count', async () => {
  const { db } = archive;
  const userId = await createUser(db, { name: 'Demo', personName: 'Demo' });
  await createTask(db, { title: 'Forfalden', due_date: '2026-11-23' }, ctx);
  await createTask(db, { title: 'Uden dato' }, ctx);
  await saveRecord(db, 'item', { name: 'Maskine', warranty_until: '2027-01-10', purchase_price_minor: 100 }, ctx);
  await saveRecord(db, 'vehicle', { name: 'Demo' }, ctx);
  await saveRecord(db, 'policy', { title: 'Demopolice', kind: 'home_contents' }, ctx);
  await saveRecord(db, 'category', { name: 'Syntetisk udgift', kind: 'expense' }, ctx);
  const view = await dashboard(db, userId, '2026-11-24');
  expect(view.overdue).toHaveLength(1);
  expect(view.upcoming).toEqual([]);
  expect(view.expires).toHaveLength(1);
  expect(view.missing).toHaveLength(4);
  expect(view.drafts).toBe(0);
  expect(view.finances).toEqual([{ category: 'Syntetisk udgift', actual: 0, budget: 0 }]);
  expect(view.uncategorized).toBe(0);
});

it('exports all-day ICS without notes or private health titles and escapes separators', () => {
  const health = { id: 'synthetic', title: 'Eksempelmedicin', due_date: '2026-11-24', module: 'health' };
  const result = calendar([{ ...health, notes: 'Syntetisk note' } as typeof health, { ...health, id: 'other', title: 'Tag; mur', module: 'home' }]);
  expect(result).toContain('DTSTART;VALUE=DATE:20261124');
  expect(result).toContain('SUMMARY:Helbred: påmindelse');
  expect(result).toContain('SUMMARY:Tag\\; mur');
  expect(result).not.toMatch(/Eksempelmedicin|Syntetisk note/);
});

it('exports the public schema metadata with private PIN hashes omitted and checks household permissions', async () => {
  const { db } = archive;
  const admin = await createUser(db, { name: 'Demo-admin', personName: 'Eksempel', pin: '1234' });
  const household = await createUser(db, { name: 'Demo-bruger', personName: 'Eksempelperson' }, admin);
  await expect(exportFile(archive, { format: 'json', table: 'all' }, household)).rejects.toThrow('administratoren');
  const output = await exportFile(archive, { format: 'json', table: 'all' }, admin);
  const data = JSON.parse(await readFile(output, 'utf8'));
  expect(data.schemaVersion).toBe(1);
  expect(data.tables.app_user).toMatchObject([{ pin_hash: null }, { pin_hash: null }]);
  expect(data.tables.search_index).toEqual([]);
  expect(data.tables.search_index_data).toBeUndefined();
  const [person] = await db.select<{ id: string }>('SELECT id FROM person WHERE app_user_id = ?', [household]);
  await setHealthPrivacy(db, admin, person.id, household);
  await expect(exportFile(archive, { format: 'json', table: 'all' }, admin)).rejects.toThrow('helbredsdata');
});

it('extracts and indexes PDF text locally with its creation date', async () => {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date('2026-11-24T12:00:00Z'));
  pdf.addPage().drawText('Syntetisk fakturatekst');
  const doc = await importArchiveDocument(archive, 'testbilag.pdf', new Uint8Array(await pdf.save()), ctx);
  const facts = await archive.db.select<{ doc_date: string; extracted_text: string }>('SELECT doc_date, extracted_text FROM document WHERE id = ?', [doc.id]);
  expect(facts).toEqual([{ doc_date: '2026-11-24', extracted_text: 'Syntetisk fakturatekst' }]);
  expect(await searchRecords(archive.db, 'fakturatek')).toMatchObject([{ entity_id: doc.id }]);
});

it('persists generic CSV mappings and calculates annual and monthly budget totals', async () => {
  const { db } = archive;
  const profile = { delimiter: ';', header: false, dateFormat: 'iso', date: 0, text: 1, amount: 2 };
  expect(await saveBankProfile(db, 'Demoformat', profile, ctx)).toMatchObject({ Demoformat: profile });
  const source = Buffer.from('2026-01-10;Syntetisk post;-10,50');
  expect(parseBank(source, profile, crypto.randomUUID())).toMatchObject([{ booking_date: '2026-01-10', amount_minor: -1050 }]);
  const budget = await saveRecord(db, 'budget', { name: 'Budget 2026', year: 2026 }, ctx);
  const category = await saveRecord(db, 'category', { name: 'Demokategori', kind: 'expense' }, ctx);
  await saveRecord(db, 'budget_line', { budget_id: budget.id, category_id: category.id, amount_minor: 2000 }, ctx);
  await saveRecord(db, 'recurring_expense', { name: 'Demoudgift', amount_minor: 12345, period: 'quarter' }, ctx);
  const summary = await financeYear(db, 2026);
  expect(summary.categories[0].months.map(month => month.budget)).toEqual(Array(12).fill(2000));
  expect(summary.fixed).toEqual([{ currency: 'DKK', annual: 49380 }]);
});

it('preserves a completed automatic reminder until the source deadline changes', async () => {
  const { db } = archive;
  const item = await saveRecord(db, 'item', { name: 'Demomaskine', warranty_until: '2027-01-02' }, ctx);
  const [occurrence] = await db.select<{ id: string }>("SELECT id FROM task_occurrence WHERE status = 'open'");
  await completeTask(db, occurrence.id, 'done', '2027-01-02', ctx);
  await saveRecord(db, 'item', { name: 'Ændret navn', notes: 'Syntetisk note' }, ctx, item.id);
  expect(await db.select("SELECT id FROM task_occurrence WHERE status = 'open'")).toEqual([]);
  await saveRecord(db, 'item', { warranty_until: '2027-02-01' }, ctx, item.id);
  expect(await db.select("SELECT due_date FROM task_occurrence WHERE status = 'open'")).toEqual([{ due_date: '2027-02-01' }]);
});

import { openArchive } from './archive';
import { importArchiveDocument } from './node-documents';
import { createTask } from './repo/tasks';
import { createUser } from './repo/users';
import { now } from './db/migrate';
import { recordChange } from './repo/write';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
if (args.length !== 2 || args[0] !== '--archive') throw new Error('Brug pnpm seed -- --archive <sti>.');
const archive = await openArchive(args[1], { create: true });
try {
  const userId = await createUser(archive.db, { name: 'Demo', personName: 'Eksempelperson' });
  const ctx = { via: 'system', userId } as const;
  await createTask(archive.db, {
    title: 'Kontrollér tagrende', due_date: '2026-10-01',
    recurrence: { kind: 'fixed', unit: 'year', every: 1, month: 10, day: 1 },
  }, ctx);
  await importArchiveDocument(archive, 'demo.eml', new TextEncoder().encode('Subject: Syntetisk eksempel\r\n\r\nDemobilag'), ctx);
  const id = () => crypto.randomUUID();
  await archive.db.transaction(async (tx) => {
    const [person] = await tx.select<{ id: string }>('SELECT id FROM person WHERE app_user_id = ?', [userId]);
    const propertyId = id();
    const locationId = id();
    const records: { table: string; module?: string; data: Record<string, string | number> & { id: string; title?: string; name?: string } }[] = [
      { table: 'property', data: { id: propertyId, name: 'Demobolig', kind: 'house', created_at: now() } },
      { table: 'location', data: { id: locationId, name: 'Demorum', property_id: propertyId } },
      { table: 'item', module: 'home', data: { id: id(), name: 'Demogenstand', location_id: locationId, purchase_price_minor: 159900, created_at: now(), updated_at: now() } },
      { table: 'work_order', module: 'maintenance', data: { id: id(), title: 'Rens tagrende', kind: 'service', reported_date: '2026-09-10', created_at: now(), updated_at: now() } },
      { table: 'vehicle', module: 'vehicle', data: { id: id(), name: 'Demobil', created_at: now() } },
      { table: 'account', data: { id: id(), name: 'Demokonto' } },
      { table: 'policy', module: 'insurance', data: { id: id(), title: 'Demopolice', kind: 'home_contents', created_at: now() } },
      { table: 'health_screening', module: 'health', data: { id: id(), person_id: person.id, name: 'Demoscreening' } },
      ...['Bolig', 'Forsyning', 'Mad og dagligvarer', 'Transport', 'Forsikring', 'Børn', 'Sundhed', 'Fritid',
        'Abonnementer', 'Opsparing', 'Indtægt', 'Overførsel', 'Andet'].map((name) => ({
        table: 'category',
        data: { id: id(), name, kind: name === 'Indtægt' ? 'income' : name === 'Overførsel' ? 'transfer' : 'expense' },
      })),
    ];
    for (const { table, data, module } of records) {
      const fields = Object.entries(data);
      const columns = fields.map(([key]) => key);
      await tx.execute(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
        fields.map(([, value]) => value),
      );
      await recordChange(tx, ctx, table, data.id, null, data,
        module ? { module, title: data.title ?? data.name ?? '' } : undefined);
    }
  });
  console.log(archive.root);
} finally {
  await archive.close();
}

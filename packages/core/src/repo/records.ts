import { z } from 'zod';
import type { DbAdapter } from '../db/adapter';
import { now } from '../db/migrate';
import { fields, recordType, createdTables, updatedTables, archivedTables, type RecordType } from '../domain/records';
import { recordChange, type Fields, type WriteContext } from './write';

type Row = Fields & { id: string };
const body = (...values: unknown[]) => values.filter(Boolean).join(' ');
const text = (value: unknown): string => typeof value === 'string' ? value : '';

export async function synchronizeIndex(tx: DbAdapter, type: string, row: Row, ctx: WriteContext, before: Row | null, action?: string) {
  const details = await indexDetails(tx, type, row);
  await recordChange(tx, ctx, type, row.id, before, row, details, action);
}

async function indexDetails(tx: DbAdapter, type: string, row: Row) {
  const index = (module: string, title: unknown, content: unknown) =>
    ({ module, title: text(title), body: text(content), archived: Boolean(row.archived_at || row.status === 'archived' && type === 'task') });
  if (type === 'task') return index(text(row.module), row.title, row.description);
  if (type === 'vehicle') return index('vehicle', row.name, body(row.registration, row.make, row.model, row.notes));
  if (type === 'policy') return index('insurance', row.title, body(row.insurer_name, row.policy_number, row.notes));
  if (type === 'contact') return index('maintenance', row.name, body(row.notes, row.email, row.phone));
  if (type === 'document') return index('documents', row.title ?? row.filename, row.extracted_text);
  if (type.startsWith('health_')) return index('health', row.name ?? row.vaccine ?? row.reason ?? row.substance ?? row.type, body(row.notes, row.note, row.result));
  if (type === 'work_order') {
    const [contact] = await tx.select<{ name: string }>('SELECT name FROM contact WHERE id = ?', [row.contact_id]);
    const events = await tx.select<{ note: string }>('SELECT note FROM work_order_event WHERE work_order_id = ? ORDER BY at, rowid', [row.id]);
    return index('maintenance', row.title, body(row.description, contact?.name, ...events.map((x) => x.note)));
  }
  if (type === 'item') {
    const [location] = await tx.select<{ name: string }>('SELECT name FROM location WHERE id = ?', [row.location_id]);
    const tags = await tx.select<{ name: string }>("SELECT t.name FROM tag t JOIN entity_tag e ON t.id = e.tag_id WHERE target_type = 'item' AND target_id = ?", [row.id]);
    return index('home', row.name, body(row.brand, row.model, row.serial_number, row.category, location?.name, row.notes, ...tags.map((x) => x.name)));
  }
  if (type === 'bank_transaction') {
    const [category] = await tx.select<{ name: string }>('SELECT name FROM category WHERE id = ?', [row.category_id]);
    return index('finance', row.text, body(row.note, category?.name));
  }
}

const derived = {
  item: [
    ['complaint_until', 'item.complaint_until', 'Reklamationsret udløber: ', 'home'],
    ['warranty_until', 'item.warranty_until', 'Garanti udløber: ', 'home'],
  ],
  policy: [['renewal_date', 'policy.renewal', 'Forsikring fornyes: ', 'insurance']],
  recurring_expense: [['binding_until', 'recurring_expense.binding', 'Binding udløber: ', 'finance']],
  health_screening: [['next_due_date', 'health_screening.next', '', 'health']],
  health_vaccination: [['next_due_date', 'health_vaccination.next', '', 'health']],
  health_medication: [['prescription_renewal_date', 'health_medication.renewal', 'Forny recept: ', 'health']],
} as Record<string, string[][]>;

async function deriveTasks(tx: DbAdapter, type: RecordType, row: Row, ctx: WriteContext, previous?: Row) {
  for (const [column, prefix, label, module] of derived[type] ?? []) {
    const reference = prefix + ':' + row.id;
    const [before] = await tx.select<Row>('SELECT * FROM task WHERE system_ref = ?', [reference]);
    const due = row.archived_at ? null : row[column];
    const dateChanged = !previous || previous[column] !== row[column] || Boolean(previous.archived_at) !== Boolean(row.archived_at);
    if (!due && (!before || before.status === 'archived')) continue;
    const personId = module === 'health' ? row.person_id : null;
    const [person] = personId ? await tx.select<{ name: string }>('SELECT name FROM person WHERE id = ?', [personId]) : [];
    const targetType = personId ? 'person' : type === 'item' || type === 'policy' ? type : null;
    const title = label + text(row.title ?? row.name ?? row.vaccine) + (person ? ' (' + person.name + ')' : '');
    const changes = { title, module, target_type: targetType, target_id: personId ?? (targetType ? row.id : null),
      status: due ? 'active' : 'archived', updated_at: now() };
    const id = before?.id ?? crypto.randomUUID();
    const [open] = await tx.select<Row>("SELECT * FROM task_occurrence WHERE task_id = ? AND status = 'open'", [id]);
    if (before) {
      if (before.title === title && before.status === changes.status && (!dateChanged || open?.due_date === due)) continue;
      await tx.execute('UPDATE task SET title = ?, module = ?, target_type = ?, target_id = ?, status = ?, updated_at = ? WHERE id = ?', [...Object.values(changes), id]);
    } else {
      await tx.execute("INSERT INTO task (title, module, target_type, target_id, status, updated_at, id, created_at, source, system_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'system', ?)", [...Object.values(changes), id, now(), reference]);
    }
    const [after] = await tx.select<Row>('SELECT * FROM task WHERE id = ?', [id]);
    const action = before?.status === 'archived' ? 'restore' : before && !due ? 'archive' : undefined;
    await synchronizeIndex(tx, 'task', after, ctx, before ?? null, action);
    if (due && (open || dateChanged || !before) && open?.due_date !== due) {
      const occurrenceId = open?.id ?? crypto.randomUUID();
      if (open) await tx.execute('UPDATE task_occurrence SET due_date = ? WHERE id = ?', [due, occurrenceId]);
      else await tx.execute('INSERT INTO task_occurrence (id, task_id, due_date) VALUES (?, ?, ?)', [occurrenceId, id, due]);
      const [occurrence] = await tx.select<Row>('SELECT * FROM task_occurrence WHERE id = ?', [occurrenceId]);
      await recordChange(tx, ctx, 'task_occurrence', occurrenceId, open ?? null, occurrence);
    }
  }
}

export async function assertPersonVisible(db: DbAdapter, personId: unknown, userId?: string) {
  const [person] = await db.select<{ id: string }>('SELECT id FROM person WHERE id = ? AND archived_at IS NULL AND (health_private_user_id IS NULL OR health_private_user_id = ?)', [personId, userId ?? null]);
  if (!person) throw new Error('Helbredsoplysningerne er ikke tilgængelige.');
}

export async function saveRecord(db: DbAdapter, rawType: unknown, values: unknown, ctx: WriteContext, rawId?: unknown) {
  const type = recordType.parse(rawType);
  const id = rawId === undefined ? crypto.randomUUID() : z.uuid().parse(rawId);
  const schema = z.strictObject(fields[type]);
  const input = (rawId === undefined ? schema : schema.partial()).parse(values) as Fields;
  return db.transaction(async tx => {
    const [before] = await tx.select<Row>(`SELECT * FROM ${type} WHERE id = ?`, [id]);
    if (rawId !== undefined && !before) throw new Error('Posten findes ikke.');
    const data: Fields = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    if (!before && createdTables.has(type)) data.created_at = now();
    if (updatedTables.has(type)) data.updated_at = now();
    const current: Row = { ...before, ...data, id };
    if (type === 'category_rule' && current.match_type === 'regex') {
      try { new RegExp(String(current.pattern), 'iu'); }
      catch { throw new Error('Ugyldigt regulært udtryk.'); }
    }
    if (type.startsWith('health_')) {
      if (before) await assertPersonVisible(tx, before.person_id, ctx.userId);
      await assertPersonVisible(tx, current.person_id, ctx.userId);
    }
    if (type === 'work_order') {
      if (Boolean(current.target_type) !== Boolean(current.target_id)) throw new Error('Vælg både måltype og mål.');
      if (current.target_type) {
        const table = z.enum(['property', 'building_part', 'item', 'vehicle']).parse(current.target_type);
        if (!(await tx.select(`SELECT id FROM ${table} WHERE id = ?`, [current.target_id])).length) throw new Error('Målet findes ikke.');
      }
      if (current.odometer_km != null && current.target_type !== 'vehicle') throw new Error('Km-stand kræver en bil.');
      if (!before) data.created_by = ctx.userId ?? null;
    }
    if (type === 'location' && current.parent_id) {
      const [parent] = await tx.select<Row>(`WITH RECURSIVE parents(id, parent_id, property_id) AS (
        SELECT id, parent_id, property_id FROM location WHERE id = ?
        UNION SELECT l.id, l.parent_id, l.property_id FROM location l JOIN parents p ON l.id = p.parent_id
      ) SELECT id FROM parents WHERE id = ? OR property_id != ?`, [current.parent_id, id, current.property_id]);
      if (parent) throw new Error('Placeringen skal være i samme bolig og danne et træ.');
    }
    const columns = Object.keys(data);
    if (before && columns.length) {
      await tx.execute(`UPDATE ${type} SET ${columns.map(key => key + ' = ?').join(', ')} WHERE id = ?`, [...Object.values(data), id]);
    } else if (!before) {
      await tx.execute(`INSERT INTO ${type} (id, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')})`, [id, ...Object.values(data)]);
    }
    const [after] = await tx.select<Row>(`SELECT * FROM ${type} WHERE id = ?`, [id]);
    if (type === 'work_order') await recordWorkOrderEffects(tx, before, after, ctx);
    await synchronizeIndex(tx, type, after, ctx, before ?? null);
    await deriveTasks(tx, type, after, ctx, before);
    return after;
  });
}

async function recordWorkOrderEffects(tx: DbAdapter, before: Row | undefined, after: Row, ctx: WriteContext) {
  if (before?.status !== after.status) {
    const id = crypto.randomUUID();
    const event = { work_order_id: after.id, at: now(), status: after.status, user_id: ctx.userId ?? null };
    await tx.execute('INSERT INTO work_order_event (id, work_order_id, at, status, user_id) VALUES (?, ?, ?, ?, ?)', [id, ...Object.values(event)]);
    await recordChange(tx, ctx, 'work_order_event', id, null, { id, ...event });
  }
  if (typeof after.odometer_km === 'number' && (before?.odometer_km !== after.odometer_km ||
      before?.target_id !== after.target_id || before?.completed_date !== after.completed_date)) {
    const reading = { vehicle_id: after.target_id, reading_date: after.completed_date ?? after.reported_date, km: after.odometer_km, source: 'work_order' };
    const [existing] = await tx.select<Row>('SELECT id FROM odometer_reading WHERE vehicle_id = ? AND reading_date = ? AND km = ? AND source = ?', Object.values(reading));
    if (!existing) {
      const id = crypto.randomUUID();
      await tx.execute('INSERT INTO odometer_reading (id, vehicle_id, reading_date, km, source) VALUES (?, ?, ?, ?, ?)', [id, ...Object.values(reading)]);
      await recordChange(tx, ctx, 'odometer_reading', id, null, { id, ...reading });
    }
  }
}

export async function setArchived(db: DbAdapter, rawType: unknown, rawId: unknown, archive: boolean, ctx: WriteContext) {
  const type = z.union([recordType, z.literal('task')]).parse(rawType);
  const id = z.uuid().parse(rawId);
  if (!archivedTables.has(type) && type !== 'task') throw new Error('Posttypen har intet arkivfelt.');
  return db.transaction(async tx => {
    const [before] = await tx.select<Row>(`SELECT * FROM ${type} WHERE id = ?`, [id]);
    if (!before) throw new Error('Posten findes ikke.');
    if (type === 'task') {
      if (before.module === 'health') await assertPersonVisible(tx, before.target_id, ctx.userId);
      await tx.execute('UPDATE task SET status = ?, updated_at = ? WHERE id = ?', [archive ? 'archived' : 'active', now(), id]);
    } else if (updatedTables.has(type)) {
      await tx.execute(`UPDATE ${type} SET archived_at = ?, updated_at = ? WHERE id = ?`, [archive ? now() : null, now(), id]);
    } else {
      await tx.execute(`UPDATE ${type} SET archived_at = ? WHERE id = ?`, [archive ? now() : null, id]);
    }
    const [after] = await tx.select<Row>(`SELECT * FROM ${type} WHERE id = ?`, [id]);
    await synchronizeIndex(tx, type, after, ctx, before, archive ? 'archive' : 'restore');
    if (type !== 'task') await deriveTasks(tx, type, after, ctx, before);
  });
}

export async function listRecords(db: DbAdapter, rawType: unknown, ctx: WriteContext) {
  const type = recordType.parse(rawType);
  if (type.startsWith('health_')) {
    return db.select<Row>(`SELECT r.* FROM ${type} r JOIN person p ON p.id = r.person_id
      WHERE p.archived_at IS NULL AND (p.health_private_user_id IS NULL OR p.health_private_user_id = ?) ORDER BY r.rowid DESC`, [ctx.userId ?? null]);
  }
  return db.select<Row>(`SELECT * FROM ${type} ORDER BY rowid DESC`);
}

export function listInventory(db: DbAdapter) {
  return db.select<Row>(`SELECT i.*, (SELECT d.id FROM document_link l JOIN document d ON d.id = l.document_id
    WHERE l.target_type = 'item' AND l.target_id = i.id AND l.role = 'photo' AND d.mime IN ('image/png','image/jpeg')
      AND NOT EXISTS(SELECT 1 FROM document_link x WHERE x.document_id=d.id AND
        x.target_type IN ('person','task_occurrence','health_visit','health_screening','health_vaccination','health_medication'))
    ORDER BY l.rowid LIMIT 1) AS photo_id FROM item i ORDER BY i.rowid DESC`);
}

export async function addOrderNote(db: DbAdapter, raw: unknown, ctx: WriteContext) {
  const { id, note } = z.object({ id: z.uuid(), note: z.string().trim().min(1).max(20000) }).parse(raw);
  await db.transaction(async tx => {
    const [order] = await tx.select<Row>('SELECT * FROM work_order WHERE id = ?', [id]);
    if (!order) throw new Error('Arbejdsordren findes ikke.');
    const event = { id: crypto.randomUUID(), work_order_id: id, at: now(), note, user_id: ctx.userId ?? null };
    await tx.execute('INSERT INTO work_order_event (id,work_order_id,at,note,user_id) VALUES (?,?,?,?,?)', Object.values(event));
    await recordChange(tx, ctx, 'work_order_event', event.id, null, event);
    await saveRecord(tx, 'work_order', {}, ctx, id);
  });
}

export async function claimForOrder(db: DbAdapter, raw: unknown, ctx: WriteContext) {
  const { id, policy } = z.object({ id: z.uuid(), policy: z.uuid() }).parse(raw);
  return db.transaction(async tx => {
    const [order] = await tx.select<Row>('SELECT * FROM work_order WHERE id = ?', [id]);
    if (!order || order.kind !== 'damage' || order.claim_id) throw new Error('Vælg en skade uden tilknyttet skadesag.');
    const claim = await saveRecord(tx, 'claim', { policy_id: policy, incident_date: order.reported_date, description: order.title }, ctx);
    return saveRecord(tx, 'work_order', { claim_id: claim.id }, ctx, id);
  });
}

export async function deleteItemPart(db: DbAdapter, input: unknown, ctx: WriteContext) {
  const { itemId, partId } = z.object({ itemId: z.uuid(), partId: z.uuid() }).parse(input);
  await db.transaction(async tx => {
    const [part] = await tx.select<Row>('SELECT * FROM item_part WHERE id = ? AND item_id = ?', [partId, itemId]);
    if (!part) throw new Error('Reservedelen findes ikke på genstanden.');
    await tx.execute('DELETE FROM item_part WHERE id = ? AND item_id = ?', [partId, itemId]);
    await recordChange(tx, ctx, 'item_part', partId, part, null);
  });
}

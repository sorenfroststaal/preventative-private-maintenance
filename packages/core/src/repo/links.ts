import { z } from 'zod';
import type { DbAdapter } from '../db/adapter';
import { assertPersonVisible, synchronizeIndex } from './records';
import { recordChange, type Fields, type WriteContext } from './write';

const element = z.uuid();
const documentTargets = z.enum(['property', 'location', 'item', 'building_part', 'vehicle', 'work_order', 'claim', 'policy', 'person', 'health_visit', 'health_screening', 'health_vaccination', 'health_medication', 'bank_transaction', 'task_occurrence', 'recurring_expense']);
const role = z.enum(['receipt', 'invoice', 'quote', 'photo', 'photo_before', 'photo_after', 'manual', 'policy_terms', 'report', 'letter', 'other']);
export const linkSchemas = {
  document_link: z.strictObject({ document_id: element, target_type: documentTargets, target_id: element, role }),
  policy_coverage: z.strictObject({ policy_id: element, target_type: z.enum(['property', 'item', 'vehicle', 'person']), target_id: element }),
  transaction_link: z.strictObject({ transaction_id: element, target_type: z.enum(['item', 'work_order', 'policy', 'vehicle', 'recurring_expense']), target_id: element }),
  entity_tag: z.strictObject({ tag_id: element, target_type: documentTargets, target_id: element }),
};

export async function writeLink(db: DbAdapter, rawType: unknown, values: unknown, remove: boolean, ctx: WriteContext) {
  const type = z.enum(['document_link', 'policy_coverage', 'transaction_link', 'entity_tag']).parse(rawType);
  const row = linkSchemas[type].parse(values);
  const columns = Object.keys(row);
  const params = Object.values(row);
  const key = params.join(':');
  const where = columns.map(c => c + ' = ?').join(' AND ');
  await db.transaction(async tx => {
    const [target] = await tx.select<Fields & { id: string }>(`SELECT * FROM ${row.target_type} WHERE id = ?`, [row.target_id]);
    if (!target) throw new Error('Koblingens mål findes ikke.');
    if (row.target_type.startsWith('health_')) await assertPersonVisible(tx, target.person_id, ctx.userId);
    if (row.target_type === 'task_occurrence') {
      const [task] = await tx.select<{ module: string; target_id: string }>('SELECT module, target_id FROM task WHERE id = ?', [target.task_id]);
      if (task?.module === 'health') await assertPersonVisible(tx, task.target_id, ctx.userId);
    }
    const [before] = await tx.select<Fields>(`SELECT * FROM ${type} WHERE ${where}`, params);
    if (remove) {
      if (!before) return;
      await tx.execute(`DELETE FROM ${type} WHERE ${where}`, params);
      await recordChange(tx, ctx, type, key, before, null);
    } else {
      if (before) return;
      await tx.execute(`INSERT INTO ${type} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, params);
      await recordChange(tx, ctx, type, key, null, row);
    }
    if (type === 'entity_tag' && row.target_type === 'item') {
      await synchronizeIndex(tx, 'item', target, ctx, target);
    }
  });
}

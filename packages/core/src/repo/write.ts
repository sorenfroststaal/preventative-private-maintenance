import type { DbAdapter } from '../db/adapter';
import { now } from '../db/migrate';

export type WriteContext = { via: 'ui' | 'import' | 'system' | 'ai_draft'; userId?: string };
export type Fields = Record<string, unknown>;

export async function recordChange(
  tx: DbAdapter, ctx: WriteContext, type: string, id: string,
  before: Fields | null, after: Fields | null,
  index?: { module: string; title: string; body?: string; archived?: boolean },
  action = !after ? 'delete' : before ? 'update' : 'create',
) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const diff = Object.fromEntries([...keys].flatMap((key) => {
    const oldValue = before?.[key] ?? null;
    const newValue = after?.[key] ?? null;
    if (Object.is(oldValue, newValue)) return [];
    return [[key, key === 'pin_hash'
      ? [oldValue === null ? null : '[skjult]', newValue === null ? null : '[skjult]']
      : [oldValue, newValue]]];
  }));
  await tx.execute(
    'INSERT INTO audit_log (id, at, user_id, via, entity_type, entity_id, action, diff_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [crypto.randomUUID(), now(), ctx.userId ?? null, ctx.via, type, id, action, JSON.stringify(diff)],
  );
  if (index) {
    await tx.execute('DELETE FROM search_index WHERE entity_type = ? AND entity_id = ?', [type, id]);
    if (after && !index.archived) await tx.execute(
      'INSERT INTO search_index (entity_type, entity_id, module, title, body) VALUES (?, ?, ?, ?, ?)',
      [type, id, index.module, index.title, index.body ?? ''],
    );
  }
}

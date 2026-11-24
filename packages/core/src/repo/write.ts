import type { DbAdapter } from '../db/adapter';
import { now } from '../db/migrate';

export type WriteContext = { via: 'ui' | 'import' | 'system' | 'ai_draft'; userId?: string };
type Fields = Record<string, unknown>;

export async function recordChange(
  tx: DbAdapter, ctx: WriteContext, type: string, id: string,
  before: Fields | null, after: Fields,
  index?: { module: string; title: string; body?: string; archived?: boolean },
) {
  const diff = Object.fromEntries(Object.entries(after)
    .filter(([key, value]) => (before?.[key] ?? null) !== (value ?? null))
    .map(([key, value]) => [key, [before?.[key] ?? null, value ?? null]]));
  await tx.execute(
    'INSERT INTO audit_log (id, at, user_id, via, entity_type, entity_id, action, diff_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [crypto.randomUUID(), now(), ctx.userId ?? null, ctx.via, type, id, before ? 'update' : 'create', JSON.stringify(diff)],
  );
  if (index) {
    await tx.execute('DELETE FROM search_index WHERE entity_type = ? AND entity_id = ?', [type, id]);
    if (!index.archived) await tx.execute(
      'INSERT INTO search_index (entity_type, entity_id, module, title, body) VALUES (?, ?, ?, ?, ?)',
      [type, id, index.module, index.title, index.body ?? ''],
    );
  }
}

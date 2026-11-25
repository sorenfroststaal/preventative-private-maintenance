import { expect, it } from 'vitest';
import { BetterSqliteAdapter } from '../db/better-sqlite';
import { migrate } from '../db/migrate';
import { migrationFiles, migration } from '../archive';
import { searchRecords } from '../repo/search';
import { addStarterCatalog, recipes } from './catalog';

it('adds all starter dishes once and makes them searchable', async () => {
  const db = new BetterSqliteAdapter(':memory:');
  try {
    await migrate(db, await Promise.all(migrationFiles.map(migration)));
    expect(await addStarterCatalog(db, { via: 'ui' })).toBe(40);
    expect(await addStarterCatalog(db, { via: 'ui' })).toBe(0);
    expect(await recipes(db)).toHaveLength(40);
    expect(await searchRecords(db, 'tomatsup')).toEqual([expect.objectContaining({ module: 'food', title: 'Tomatsuppe' })]);
    expect(await db.select("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'recipe'")).toEqual([{ n: 40 }]);
  } finally { db.close(); }
});

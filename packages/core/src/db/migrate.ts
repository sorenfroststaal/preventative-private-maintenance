import type { DbAdapter } from './adapter';

export const schemaVersion = 1;
export const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

export async function databaseVersion(db: DbAdapter) {
  const [table] = await db.select('SELECT name FROM sqlite_master WHERE type = ? AND name = ?', [
    'table', 'schema_migrations',
  ]);
  if (!table) return 0;
  const [row] = await db.select<{ version: number | null }>('SELECT max(version) as version FROM schema_migrations');
  return row.version ?? 0;
}

export async function migrate(db: DbAdapter, initialSql: string) {
  const version = await databaseVersion(db);
  if (version >= schemaVersion) return version;
  await db.transaction(async (tx) => {
    if (await databaseVersion(tx) === schemaVersion) return;
    // Migration 0001 has no quoted semicolons or trigger bodies.
    for (const statement of initialSql.replace(/--[^\r\n]*/g, '').split(';')) {
      if (statement.trim()) await tx.execute(statement.trim());
    }
    await tx.execute('INSERT INTO schema_migrations VALUES (?, ?)', [schemaVersion, now()]);
  });
  return schemaVersion;
}

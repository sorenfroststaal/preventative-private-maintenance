import type { DbAdapter } from './adapter';

export const schemaVersion = 2;
export const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

export async function databaseVersion(db: DbAdapter) {
  const [table] = await db.select('SELECT name FROM sqlite_master WHERE type = ? AND name = ?', [
    'table', 'schema_migrations',
  ]);
  if (!table) return 0;
  const [row] = await db.select<{ version: number | null }>('SELECT max(version) as version FROM schema_migrations');
  return row.version ?? 0;
}

export async function migrate(db: DbAdapter, scripts: string[]) {
  return db.transaction(async tx => {
    let version = await databaseVersion(tx);
    for (const script of scripts.slice(version)) {
      if (version === 1) {
        const modules = { home: true, maintenance: true, vehicle: true, finance: true,
          insurance: true, health: false, documents: true };
        await tx.execute('INSERT OR IGNORE INTO setting (key, value_json) VALUES (?, ?)', ['ai.modules', JSON.stringify(modules)]);
      }
      await tx.executeScript(script);
      version += 1;
      await tx.execute('INSERT INTO schema_migrations VALUES (?, ?)', [version, now()]);
    }
    return version;
  });
}

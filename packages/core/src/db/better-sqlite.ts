import { join } from 'node:path';
import Database from 'better-sqlite3';
import { SerializedAdapter } from './adapter';

export class BetterSqliteAdapter extends SerializedAdapter {
  private readonly db: Database.Database;

  constructor(path: string, readonly = false) {
    const db = new Database(path, { readonly, fileMustExist: readonly, timeout: 5000, nativeBinding: process.env.PPM_RUNTIME_DIR ? join(process.env.PPM_RUNTIME_DIR, 'better_sqlite3.node') : undefined });
    db.pragma('foreign_keys = ON');
    if (!readonly) db.pragma('journal_mode = WAL');
    super({
      select: async <T>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...params) as T[],
      execute: async (sql, params = []) => {
        if (sql === 'BEGIN IMMEDIATE' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          db.exec(sql);
          return { rowsAffected: 0 };
        }
        const statement = db.prepare(sql);
        if (statement.reader) {
          statement.all(...params);
          return { rowsAffected: 0 };
        }
        return { rowsAffected: statement.run(...params).changes };
      },
    });
    this.db = db;
  }

  close() {
    this.db.close();
  }
}

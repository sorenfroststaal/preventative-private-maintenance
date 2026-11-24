import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
import Database from 'better-sqlite3';
import { SerializedAdapter } from './adapter';

export class BetterSqliteAdapter extends SerializedAdapter {
  private readonly db: Database.Database;

  constructor(path: string, readonly = false) {
    const db = new Database(path, { readonly, fileMustExist: readonly, timeout: 5000, nativeBinding: process.env.PPM_RUNTIME_DIR ? join(process.env.PPM_RUNTIME_DIR, 'better_sqlite3.node') : undefined });
    db.pragma('foreign_keys = ON');
    if (!readonly) db.pragma('journal_mode = WAL');
    function guard(sql: string, params: unknown[] = []) {
      if (/\b(?:ATTACH|DETACH)\b/i.test(sql)) throw new Error('ATTACH er ikke tilladt.');
      if (!/\bVACUUM\b/i.test(sql)) return;
      const [target] = params;
      if (path === ':memory:' || sql !== 'VACUUM INTO ?' || typeof target !== 'string' || !isAbsolute(target)) {
        throw new Error('VACUUM INTO kræver et mål i arkivet.');
      }
      const root = realpathSync(dirname(path));
      const parent = realpathSync(dirname(target));
      const fromRoot = relative(root, parent);
      if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith('..' + sep) ||
          lstatSync(target, { throwIfNoEntry: false })) {
        throw new Error('VACUUM INTO kræver en ny fil i arkivet.');
      }
    }
    super({
      executeScript: async (sql) => { guard(sql); db.exec(sql); },
      select: async <T>(sql: string, params: unknown[] = []) => { guard(sql, params); return db.prepare(sql).all(...params) as T[]; },
      execute: async (sql, params = []) => {
        guard(sql, params);
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

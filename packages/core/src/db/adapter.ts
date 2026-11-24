/** Value types that can be bound as SQL parameters. */
export type SqlValue = string | number | null;

/**
 * Driver-independent database access (spec 01). Business logic only talks to this
 * interface. `executeScript` is an addition to the spec's minimum interface, needed
 * to apply multi-statement migrations.
 */
export interface DbAdapter {
  select<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  execute(sql: string, params?: SqlValue[]): Promise<{ rowsAffected: number }>;
  executeScript(sql: string): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

export interface ClosableDb extends DbAdapter {
  close(): Promise<void>;
}

/** Low-level executor implemented by each driver (better-sqlite3, Tauri/rusqlite). */
export interface RawExecutor {
  select(sql: string, params: SqlValue[]): Promise<Record<string, unknown>[]>;
  execute(sql: string, params: SqlValue[]): Promise<{ rowsAffected: number }>;
  executeScript(sql: string): Promise<void>;
  close(): Promise<void>;
}

/** Simple FIFO async mutex. */
class Mutex {
  private tail: Promise<void> = Promise.resolve();
  async lock(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const prev = this.tail;
    this.tail = prev.then(() => next);
    await prev;
    return release;
  }
}

/**
 * Wraps a single-connection executor so that transactions are serialized: while a
 * transaction runs, all other calls wait. This makes BEGIN/COMMIT over an async
 * bridge (Tauri IPC) safe, and gives identical semantics in Node.
 */
export class SerializedDb implements ClosableDb {
  private readonly mutex = new Mutex();
  constructor(private readonly raw: RawExecutor) {}

  private async locked<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.mutex.lock();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  select<T = Record<string, unknown>>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    return this.locked(() => this.raw.select(sql, params) as Promise<T[]>);
  }
  execute(sql: string, params: SqlValue[] = []) {
    return this.locked(() => this.raw.execute(sql, params));
  }
  executeScript(sql: string) {
    return this.locked(() => this.raw.executeScript(sql));
  }
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    return this.locked(async () => {
      const tx = new TxDb(this.raw);
      await this.raw.execute("BEGIN IMMEDIATE", []);
      try {
        const result = await fn(tx);
        await this.raw.execute("COMMIT", []);
        return result;
      } catch (err) {
        await this.raw.execute("ROLLBACK", []).catch(() => undefined);
        throw err;
      } finally {
        tx.done = true;
      }
    });
  }
  close() {
    return this.locked(() => this.raw.close());
  }
}

/** Adapter handed to transaction callbacks. Nested transactions run inline. */
class TxDb implements DbAdapter {
  done = false;
  constructor(private readonly raw: RawExecutor) {}
  private check() {
    if (this.done) throw new Error("Transaction already finished");
  }
  async select<T = Record<string, unknown>>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    this.check();
    return (await this.raw.select(sql, params)) as T[];
  }
  execute(sql: string, params: SqlValue[] = []) {
    this.check();
    return this.raw.execute(sql, params);
  }
  executeScript(sql: string) {
    this.check();
    return this.raw.executeScript(sql);
  }
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    this.check();
    return fn(this);
  }
}

export type DbOpener = (path: string, opts?: { readonly?: boolean }) => Promise<ClosableDb>;

/** Applies the connection pragmas required by spec 02. */
export async function applyPragmas(db: DbAdapter): Promise<void> {
  await db.select("PRAGMA journal_mode = WAL");
  await db.execute("PRAGMA foreign_keys = ON");
  await db.execute("PRAGMA busy_timeout = 5000");
}

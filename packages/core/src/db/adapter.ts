export interface DbAdapter {
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>;
  executeScript(sql: string): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

export class SerializedAdapter implements DbAdapter {
  private queue = Promise.resolve();

  constructor(private readonly connection: Omit<DbAdapter, 'transaction'>) {}

  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  select<T>(sql: string, params?: unknown[]) {
    return this.exclusive(() => this.connection.select<T>(sql, params));
  }

  execute(sql: string, params?: unknown[]) {
    return this.exclusive(() => this.connection.execute(sql, params));
  }

  executeScript(sql: string) {
    return this.exclusive(() => this.connection.executeScript(sql));
  }

  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      await this.connection.execute('BEGIN IMMEDIATE');
      try {
        const tx: DbAdapter = {
          select: this.connection.select.bind(this.connection),
          execute: this.connection.execute.bind(this.connection),
          executeScript: this.connection.executeScript.bind(this.connection),
          transaction: (nested) => nested(tx),
        };
        const result = await fn(tx);
        await this.connection.execute('COMMIT');
        return result;
      } catch (error) {
        await this.connection.execute('ROLLBACK');
        throw error;
      }
    });
  }
}

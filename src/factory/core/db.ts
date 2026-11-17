import { Pool, PoolClient, types } from "pg";

// DATE columns stay "YYYY-MM-DD" strings (calendar dates have no time zone); same rule as ABT Portal.
// NUMERIC stays a string so quantities never pass through binary floating point.
types.setTypeParser(1082, (v: string) => v);

/**
 * Connection pool of the factory database (`abt_factory`). Same PostgreSQL server as ABT Portal,
 * separate database: factory code never reads `abt_portal` tables directly.
 * Sessions run in UTC; every timestamp column is timestamptz and is formatted for Asia/Ho_Chi_Minh
 * only when displayed.
 */
let pool: Pool | null = null;

export function factoryDatabaseName(): string {
  return process.env.FACTORY_PGDATABASE || "abt_factory";
}

export function getFactoryPool(): Pool {
  if (pool) return pool;
  if (process.env.NODE_ENV === "production" && !process.env.PGPASSWORD) {
    throw new Error("PGPASSWORD chưa được cấu hình cho môi trường production.");
  }
  pool = new Pool({
    host: process.env.PGHOST || "127.0.0.1",
    port: parseInt(process.env.PGPORT || "5432", 10),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD,
    database: factoryDatabaseName(),
    max: 15,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    // Set at connection start-up, so no query can run before the session is in UTC
    options: "-c TimeZone=UTC",
  });
  return pool;
}

export async function closeFactoryPool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}

export type Tx = PoolClient;

const commitHooks = new WeakMap<Tx, Array<() => void>>();

/**
 * Runs `fn` once the current transaction of `tx` has committed (dropped if it rolls back). For a client that is not
 * inside `withTransaction` (tests, scripts) it runs at once. Use it for process-level "already done" flags, so a
 * rolled-back transaction never leaves the flag set while its work was undone.
 */
export function onCommit(tx: Tx, fn: () => void): void {
  const hooks = commitHooks.get(tx);
  if (hooks) hooks.push(fn);
  else fn();
}

/** Runs `fn` in one transaction; rolls back on any error. */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await getFactoryPool().connect();
  const hooks: Array<() => void> = [];
  commitHooks.set(client, hooks);
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    commitHooks.delete(client);
    for (const h of hooks) {
      try { h(); } catch { /* a hook never fails the committed request */ }
    }
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    commitHooks.delete(client);
    client.release();
  }
}

/** deadlock_detected / serialization_failure: the transaction was rolled back and can simply run again. */
export function isRetryableTxError(error: any): boolean {
  return error?.code === "40P01" || error?.code === "40001";
}

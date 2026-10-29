import { Pool, PoolClient } from "pg";

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

/** Runs `fn` in one transaction; rolls back on any error. */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await getFactoryPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

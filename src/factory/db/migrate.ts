import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { Pool } from "pg";

export const MIGRATIONS_DIR = path.join(process.cwd(), "src", "factory", "db", "migrations");
const LOCK_KEY = 72_610_001; // pg_advisory_lock key reserved for factory migrations

export interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

export function readMigrations(dir = MIGRATIONS_DIR): MigrationFile[] {
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((name) => {
      const sql = fs.readFileSync(path.join(dir, name), "utf8");
      return { name, sql, checksum: crypto.createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex") };
    });
}

/**
 * Applies pending migrations in name order, each in its own transaction, under an advisory lock so
 * two deploys never migrate at once. An applied migration whose file changed afterwards stops the run:
 * schema changes always go into a new file.
 */
export async function migrate(pool: Pool, log: (msg: string) => void = () => {}): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Map<string, string>(
      (await client.query("SELECT name, checksum FROM public.schema_migrations")).rows.map((r) => [r.name, r.checksum])
    );
    for (const m of readMigrations()) {
      const prev = done.get(m.name);
      if (prev) {
        if (prev !== m.checksum) {
          throw new Error(`Migration ${m.name} đã chạy nhưng nội dung file đã bị sửa. Hãy hoàn tác file và tạo migration mới.`);
        }
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query("INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)", [m.name, m.checksum]);
        await client.query("COMMIT");
      } catch (error: any) {
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(`Migration ${m.name} lỗi: ${error.message}`);
      }
      applied.push(m.name);
      log(`✓ ${m.name}`);
    }
    return applied;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

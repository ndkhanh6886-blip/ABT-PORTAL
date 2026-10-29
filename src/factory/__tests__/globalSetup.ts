import { loadEnv } from "../../../scripts/lib/loadEnv";

/**
 * Rebuilds the test database from the migrations before every run, so tests always run against
 * exactly the schema production gets. Refuses to touch a database whose name does not end in _test.
 */
export default async function setup() {
  loadEnv();
  process.env.FACTORY_PGDATABASE = "abt_factory_test";
  const { getFactoryPool, closeFactoryPool, withTransaction, factoryDatabaseName } = await import("../core/db");
  if (!factoryDatabaseName().endsWith("_test")) throw new Error("Test chỉ được chạy trên database *_test");
  const { migrate } = await import("../db/migrate");
  const { syncPermissions } = await import("../core/authz");
  await import("../permissions");
  await import("./fixtures/permissions");

  const pool = getFactoryPool();
  const schemas = (
    await pool.query(
      "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname NOT IN ('information_schema', 'public')"
    )
  ).rows.map((r) => r.nspname as string);
  for (const s of schemas) await pool.query(`DROP SCHEMA "${s}" CASCADE`);
  await pool.query("DROP TABLE IF EXISTS public.schema_migrations");
  await migrate(pool);
  await withTransaction(syncPermissions);
  await pool.query(`
    CREATE SCHEMA test_fixture;
    CREATE TABLE test_fixture.doc (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      status text NOT NULL,
      owner_org_unit_id uuid,
      amount numeric(18,2) NOT NULL DEFAULT 0,
      version integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by integer
    );`);
  await closeFactoryPool();
}

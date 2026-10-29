// Applies pending factory database migrations and syncs the permission catalogue.
// Usage: npm run factory:migrate
import { loadEnv } from "./lib/loadEnv";

async function main() {
  loadEnv();
  const { getFactoryPool, closeFactoryPool, withTransaction, factoryDatabaseName } = await import("../src/factory/core/db");
  const { migrate } = await import("../src/factory/db/migrate");
  const { syncPermissions } = await import("../src/factory/core/authz");
  await import("../src/factory/permissions");
  console.log(`Database: ${factoryDatabaseName()}`);
  const applied = await migrate(getFactoryPool(), console.log);
  await withTransaction(syncPermissions);
  const { ensureDefaultRoles } = await import("../src/factory/core/defaultRoles");
  const roles = await withTransaction(ensureDefaultRoles);
  if (roles.length) console.log(`Vai trò mặc định đã tạo hoặc bổ sung: ${roles.join(", ")}`);
  console.log(applied.length ? `Đã chạy ${applied.length} migration.` : "Không có migration mới.");
  await closeFactoryPool();
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

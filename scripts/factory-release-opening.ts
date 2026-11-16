// Releases all OPENING lots pending QC (quarantine / pending_qc) and moves quarantine balances to active shelves.
// Usage: npm run factory:release-opening [optional audit reason]
import { loadEnv } from "./lib/loadEnv";

async function main() {
  loadEnv();
  const { closeFactoryPool, factoryDatabaseName, withTransaction } = await import("../src/factory/core/db");
  await import("../src/factory/permissions");
  const { releaseOpeningLotsSkipQc } = await import("../src/factory/qms/qaOps");

  const customReason = process.argv.slice(2).join(" ").trim();
  console.log(`Database: ${factoryDatabaseName()}`);

  const result = await withTransaction(async (tx) => {
    const adminRow = (
      await tx.query(
        "SELECT user_id, display_name FROM core.user_profile WHERE status = 'ACTIVE' ORDER BY user_id ASC LIMIT 1"
      )
    ).rows[0] as { user_id: number; display_name: string } | undefined;

    const actor = {
      userId: adminRow?.user_id ?? 1,
      name: adminRow?.display_name ?? "Quản Trị Viên Hệ Thống (CLI)",
      isRootAdmin: true,
    };

    return releaseOpeningLotsSkipQc(tx, actor, customReason ? { reason: customReason } : undefined);
  });

  console.log(
    `Hoàn tất: đã giải phóng ${result.released_lots} lô tồn đầu kỳ -> RELEASED, ` +
      `hủy ${result.cancelled_tests} phiếu QC chưa duyệt, ` +
      `chuyển ${result.moved_balances} dòng tồn kho từ khu Biệt trữ sang Kệ chính (${result.transfer_docs} phiếu chuyển kệ PUTAWAY).`
  );
  await closeFactoryPool();
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});

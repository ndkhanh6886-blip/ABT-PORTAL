import { SYSTEM_ACTOR } from "../core/authz";
import { notifyUsers, usersWithPermission } from "../core/notifications";
import { registerDailyJob } from "../core/worker";
import { expireLots } from "./lots";
import { findBalanceMismatches, findReservationMismatches } from "./reconcile";

registerDailyJob("inv.expire_lots", async (tx, today) => {
  const expired = await expireLots(tx, SYSTEM_ACTOR, today);
  return { expired: expired.length };
});

registerDailyJob("inv.reconcile_balances", async (tx, today) => {
  const balances = await findBalanceMismatches(tx);
  const reservations = await findReservationMismatches(tx);
  if (balances.length || reservations.length) {
    await notifyUsers(tx, await usersWithPermission(tx, "inv.document.reverse", null), {
      type: "INV_RECONCILE_MISMATCH",
      title: "Đối chiếu tồn kho phát hiện chênh lệch",
      body: `${balances.length} dòng tồn lệch sổ cái, ${reservations.length} dòng giữ chỗ lệch. Cần kiểm tra ngay.`,
      sourceKey: `reconcile:${today}`,
    });
  }
  return { balance_mismatches: balances.length, reservation_mismatches: reservations.length };
});

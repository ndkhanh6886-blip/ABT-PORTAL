import { factoryRoute } from "@/factory/http";
import { hasFactoryPermission } from "@/factory/core/authz";

/** Oligo departments the user can open orders for, with their open internal orders from Kinh doanh. */
export const GET = factoryRoute(async (tx, { actor }) => {
  const units = (await tx.query("SELECT id, code, name FROM core.org_unit WHERE module_key = 'OLIGO' AND status = 'ACTIVE' ORDER BY code")).rows;
  const out = [];
  for (const u of units) {
    if (!(await hasFactoryPermission(tx, actor, "oligo.order.manage", u.id))) continue;
    const orders = (
      await tx.query(
        "SELECT id, code, kd_po_code, committed_date FROM intake.internal_order WHERE org_unit_id = $1 AND status IN ('ACCEPTED', 'IN_PRODUCTION', 'READY', 'PARTIALLY_DELIVERED') ORDER BY created_at DESC",
        [u.id]
      )
    ).rows;
    out.push({ ...u, internal_orders: orders });
  }
  return out;
});

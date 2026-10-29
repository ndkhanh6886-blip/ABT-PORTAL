import { factoryRoute } from "@/factory/http";
import { hasFactoryPermission } from "@/factory/core/authz";

/** Departments the user may request for, each with its own active warehouses (the only allowed receiving warehouses). */
export const GET = factoryRoute(async (tx, { actor }) => {
  const units = (await tx.query("SELECT id, code, name FROM core.org_unit WHERE status = 'ACTIVE' AND unit_type <> 'COMPANY' ORDER BY code")).rows;
  const out = [];
  for (const u of units) {
    if (!(await hasFactoryPermission(tx, actor, "purchase.pr.create", u.id))) continue;
    const warehouses = (await tx.query("SELECT id, code, name FROM master.warehouse WHERE owner_org_unit_id = $1 AND status = 'ACTIVE' ORDER BY code", [u.id])).rows;
    out.push({ ...u, warehouses });
  }
  return out;
});

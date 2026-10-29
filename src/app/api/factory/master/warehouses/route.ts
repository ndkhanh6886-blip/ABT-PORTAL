import { factoryRoute } from "@/factory/http";
import { hasFactoryPermission } from "@/factory/core/authz";
import { createWarehouse } from "@/factory/master/service";
import { viewableWarehouses } from "@/factory/inv/queries";

/** Warehouse managers see every warehouse; others only those whose stock they may view. */
export const GET = factoryRoute(async (tx, { actor }) => {
  if (await hasFactoryPermission(tx, actor, "master.warehouse.manage")) {
    return (
      await tx.query(
        `SELECT w.id, w.code, w.name, w.purpose, w.access_mode, w.owner_org_unit_id, w.status, o.name AS owner_name
           FROM master.warehouse w JOIN core.org_unit o ON o.id = w.owner_org_unit_id ORDER BY w.code`
      )
    ).rows;
  }
  return viewableWarehouses(tx, actor);
});
export const POST = factoryRoute((tx, { actor, body }) => createWarehouse(tx, actor, body));

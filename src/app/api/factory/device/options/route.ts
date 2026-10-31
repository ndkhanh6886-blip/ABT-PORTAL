import { authorizeAnywhere, hasFactoryPermission } from "@/factory/core/authz";
import { factoryRoute } from "@/factory/http";

export const GET = factoryRoute(async (tx, { actor }) => {
  await authorizeAnywhere(tx, actor, "device.view");
  const allUnits = (
    await tx.query("SELECT id, code, name, unit_type FROM core.org_unit WHERE status = 'ACTIVE' ORDER BY code")
  ).rows;
  const units = [];
  for (const u of allUnits) {
    if (await hasFactoryPermission(tx, actor, "device.view", u.id)) units.push(u);
  }
  const warehouses = (
    await tx.query("SELECT id, code, name, owner_org_unit_id FROM master.warehouse WHERE status = 'ACTIVE' ORDER BY code")
  ).rows;
  const items = (
    await tx.query(
      "SELECT id, code, name, item_type, base_uom, tracking FROM master.item WHERE status = 'ACTIVE' ORDER BY code LIMIT 500"
    )
  ).rows;
  const vendors = (
    await tx.query(
      "SELECT id, code, name FROM master.partner WHERE is_supplier = true AND status = 'ACTIVE' ORDER BY name LIMIT 300"
    )
  ).rows;
  const serialUnits = (
    await tx.query(
      `SELECT du.id, du.serial_no, du.status, du.customer_name, du.warranty_end::text AS warranty_end,
              m.code AS model_code, m.name AS model_name, o.org_unit_id
         FROM device.device_unit du
         JOIN device.device_model m ON m.id = du.model_id
         JOIN device.device_order o ON o.id = du.order_id
        ORDER BY du.serial_no DESC LIMIT 300`
    )
  ).rows;
  return { units, warehouses, items, vendors, serial_units: serialUnits };
});

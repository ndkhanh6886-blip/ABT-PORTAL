import { authorizeAnywhere, hasFactoryPermission } from "@/factory/core/authz";
import { factoryRoute } from "@/factory/http";
import { ensureKitBomRoutingAndIfuSchema } from "@/factory/kit/bomRouting";
import { listDepartmentStaffForKitAndQa } from "@/factory/kit/ordersEbr";
import { ensureDepartmentEquipmentSeed } from "@/factory/asset/service";
import "@/factory/kit/permissions";

export const GET = factoryRoute(async (tx, { actor }) => {
  await authorizeAnywhere(tx, actor, "kit.view");
  await ensureKitBomRoutingAndIfuSchema(tx);
  await ensureDepartmentEquipmentSeed(tx);

  const allUnits = (
    await tx.query(
      "SELECT id, code, name, unit_type FROM core.org_unit WHERE status = 'ACTIVE' ORDER BY CASE WHEN code = 'P-KIT' THEN 0 ELSE 1 END, code"
    )
  ).rows;
  const units = [];
  for (const u of allUnits) {
    if (await hasFactoryPermission(tx, actor, "kit.view", u.id)) units.push(u);
  }
  const warehouses = (
    await tx.query(
      "SELECT id, code, name, owner_org_unit_id FROM master.warehouse WHERE status = 'ACTIVE' ORDER BY CASE WHEN code = 'KHO-KIT' THEN 0 ELSE 1 END, code"
    )
  ).rows;
  const items = (
    await tx.query(
      "SELECT id, code, name, item_type, base_uom, tracking, shelf_life_days FROM master.item WHERE status = 'ACTIVE' ORDER BY code LIMIT 500"
    )
  ).rows;
  const assets = (
    await tx.query(
      "SELECT id, code, name, asset_type, status, next_calibration_due::text AS next_calibration_due FROM asset.asset WHERE status <> 'RETIRED' ORDER BY code LIMIT 300"
    )
  ).rows;
  const lots = (
    await tx.query(
      `SELECT l.id, l.code, l.status, l.expiry_date::text AS expiry_date, i.code AS item_code, i.name AS item_name, i.item_type
         FROM inv.lot l JOIN master.item i ON i.id = l.item_id
        ORDER BY l.created_at DESC LIMIT 300`
    )
  ).rows;

  const po_lines = (
    await tx.query(
      `SELECT l.id AS line_id, l.order_id, l.item_id,
              COALESCE(i.code, l.kd_item_code) AS item_code,
              COALESCE(i.name, l.kd_item_name) AS description,
              l.qty::float AS qty_ordered, l.qty_delivered::float AS qty_delivered,
              COALESCE(i.base_uom, l.kd_unit, 'kit') AS uom,
              io.code AS internal_order_code, io.kd_po_code, io.requested_date::text AS requested_date, io.status AS order_status
         FROM intake.internal_order_line l
         JOIN intake.internal_order io ON io.id = l.order_id
         JOIN core.org_unit u ON u.id = io.org_unit_id
         LEFT JOIN master.item i ON i.id = l.item_id
        WHERE u.code = 'P-KIT'
          AND io.status NOT IN ('REJECTED', 'CANCELLED', 'CLOSED')
        ORDER BY io.created_at DESC LIMIT 100`
    )
  ).rows;

  const { kit_staff, qa_staff } = await listDepartmentStaffForKitAndQa(tx);

  return { units, warehouses, items, assets, lots, po_lines, kit_staff, qa_staff };
});

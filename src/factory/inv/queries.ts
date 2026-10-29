import { z } from "zod";
import type { Tx } from "../core/db";
import { hasFactoryPermission, type AuthzActor } from "../core/authz";
import { forbidden } from "../core/errors";
import { parseInput } from "../core/records";

/** Warehouses whose stock the actor may see: own department's (by role scope), company-wide roles see all, SHARED_READ visible to any stock viewer. */
export async function viewableWarehouses(tx: Tx, actor: AuthzActor) {
  const all = (
    await tx.query(
      `SELECT w.id, w.code, w.name, w.purpose, w.access_mode, w.owner_org_unit_id, o.name AS owner_name
         FROM master.warehouse w JOIN core.org_unit o ON o.id = w.owner_org_unit_id
        WHERE w.status = 'ACTIVE' ORDER BY w.code`
    )
  ).rows;
  const visible = [];
  let viewerAnywhere: boolean | null = null;
  for (const w of all) {
    if (await hasFactoryPermission(tx, actor, "inv.stock.view", w.owner_org_unit_id)) visible.push(w);
    else if (w.access_mode === "SHARED_READ") {
      if (viewerAnywhere === null) {
        viewerAnywhere = (
          await tx.query(
            `SELECT 1 FROM core.user_role ur JOIN core.role_permission rp ON rp.role_id = ur.role_id
              WHERE ur.user_id = $1 AND rp.permission_code = 'inv.stock.view' AND ur.revoked_at IS NULL LIMIT 1`,
            [actor.userId]
          )
        ).rowCount! > 0;
      }
      if (viewerAnywhere) visible.push(w);
    }
  }
  return visible;
}

const stockQuerySchema = z.object({
  warehouse_id: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  status: z.enum(["QUARANTINE", "PENDING_QC", "RELEASED", "ON_HOLD", "REJECTED", "EXPIRED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

/** Stock by lot and location, server-side filtered and paged, restricted to viewable warehouses. */
export async function listStock(tx: Tx, actor: AuthzActor, query: unknown) {
  const q = parseInput(stockQuerySchema, query);
  const allowed = (await viewableWarehouses(tx, actor)).map((w) => w.id);
  if (q.warehouse_id && !allowed.includes(q.warehouse_id)) throw forbidden("Bạn không có quyền xem tồn của kho này.");
  const ids = q.warehouse_id ? [q.warehouse_id] : allowed;
  const params: unknown[] = [ids];
  const where = ["loc.warehouse_id = ANY($1::uuid[])", "b.qty_on_hand > 0"];
  if (q.q) {
    params.push(`%${q.q}%`);
    where.push(`(i.code ILIKE $${params.length} OR i.name ILIKE $${params.length} OR l.code ILIKE $${params.length} OR l.mfr_lot_no ILIKE $${params.length})`);
  }
  if (q.status) {
    params.push(q.status);
    where.push(`l.status = $${params.length}`);
  }
  const from = `FROM inv.stock_balance b
      JOIN master.item i ON i.id = b.item_id
      JOIN master.location loc ON loc.id = b.location_id
      JOIN master.warehouse w ON w.id = loc.warehouse_id
      LEFT JOIN inv.lot l ON l.id = b.lot_id
     WHERE ${where.join(" AND ")}`;
  const total = Number((await tx.query(`SELECT count(*) ${from}`, params)).rows[0].count);
  params.push(q.page_size, (q.page - 1) * q.page_size);
  const rows = (
    await tx.query(
      `SELECT b.id, l.id AS lot_id, i.code AS item_code, i.name AS item_name, i.base_uom, l.code AS lot_code, l.mfr_lot_no, l.status AS lot_status,
              l.expiry_date, w.code AS warehouse_code, loc.code AS location_code, loc.is_quarantine,
              b.qty_on_hand::text AS qty_on_hand, b.qty_reserved::text AS qty_reserved,
              (b.qty_on_hand - b.qty_reserved)::text AS qty_available
       ${from}
       ORDER BY i.code, l.expiry_date NULLS LAST, l.code, loc.code
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
  ).rows;
  return { rows, total, page: q.page, page_size: q.page_size };
}

export async function listLocations(tx: Tx, warehouseId: string) {
  return (
    await tx.query(
      "SELECT id, code, name, parent_id, temperature_condition, is_quarantine, status FROM master.location WHERE warehouse_id = $1 ORDER BY code",
      [warehouseId]
    )
  ).rows;
}

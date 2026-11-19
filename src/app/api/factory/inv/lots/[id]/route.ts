import { allowedActionsFor, factoryRoute } from "@/factory/http";
import { hasFactoryPermission } from "@/factory/core/authz";
import { forbidden, notFound } from "@/factory/core/errors";
import { lotMachine } from "@/factory/inv/lots";
import { viewableWarehouses } from "@/factory/inv/queries";

/** A lot with the quality actions the user may run now and its QC history. */
export const GET = factoryRoute(async (tx, { actor, params }) => {
  const lot = (
    await tx.query(
      `SELECT l.*, i.code AS item_code, i.name AS item_name, i.base_uom FROM inv.lot l JOIN master.item i ON i.id = l.item_id WHERE l.id = $1`,
      [params.id]
    )
  ).rows[0];
  if (!lot) throw notFound("lô");
  // QA/QC (company-wide) see every lot; others only lots held in a warehouse they may view
  if (!(await hasFactoryPermission(tx, actor, "qms.qc.view"))) {
    const allowed = (await viewableWarehouses(tx, actor)).map((w) => w.id);
    const visible = await tx.query(
      `SELECT 1 FROM inv.stock_balance b JOIN master.location loc ON loc.id = b.location_id
        WHERE b.lot_id = $1 AND loc.warehouse_id = ANY($2::uuid[]) LIMIT 1`,
      [params.id, allowed]
    );
    if (!visible.rowCount) throw forbidden("Bạn không có quyền xem lô này.");
  }
  const tests = (
    await tx.query(
      "SELECT id, code, test_kind, status, overall_result, created_at, reviewed_at FROM qms.qc_test WHERE entity_type = 'LOT' AND entity_id = $1 ORDER BY created_at DESC",
      [params.id]
    )
  ).rows;
  const balances = (
    await tx.query(
      `SELECT b.location_id, loc.code AS location_code, loc.is_quarantine, w.id AS warehouse_id, w.code AS warehouse_code,
              b.qty_on_hand::text AS qty_on_hand, b.qty_reserved::text AS qty_reserved
         FROM inv.stock_balance b JOIN master.location loc ON loc.id = b.location_id JOIN master.warehouse w ON w.id = loc.warehouse_id
        WHERE b.lot_id = $1 AND b.qty_on_hand > 0 ORDER BY w.code, loc.code`,
      [params.id]
    )
  ).rows;
  const movements = (
    await tx.query(
      `SELECT l.id AS line_id,
              d.id AS document_id, d.code AS document_code, d.doc_type, d.reason_code, d.notes,
              COALESCE(d.posted_at, d.created_at) AS occurred_at,
              up.display_name AS performed_by_name,
              fw.code AS from_wh_code, fl.code AS from_loc_code,
              tw.code AS to_wh_code, tl.code AS to_loc_code,
              l.qty::float AS qty, l.uom
         FROM inv.stock_document_line l
         JOIN inv.stock_document d ON d.id = l.document_id AND d.status = 'POSTED'
         LEFT JOIN master.location fl ON fl.id = l.from_location_id
         LEFT JOIN master.warehouse fw ON fw.id = fl.warehouse_id
         LEFT JOIN master.location tl ON tl.id = l.to_location_id
         LEFT JOIN master.warehouse tw ON tw.id = tl.warehouse_id
         LEFT JOIN core.user_profile up ON up.user_id = COALESCE(d.posted_by, d.created_by)
        WHERE l.lot_id = $1
        ORDER BY COALESCE(d.posted_at, d.created_at) DESC, d.code DESC`,
      [params.id]
    )
  ).rows;
  return { ...lot, qc_tests: tests, balances, movements, actions: await allowedActionsFor(tx, lotMachine, actor, lot) };
});

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
  return { ...lot, qc_tests: tests, actions: await allowedActionsFor(tx, lotMachine, actor, lot) };
});

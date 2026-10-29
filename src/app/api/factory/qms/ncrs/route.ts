import { factoryRoute } from "@/factory/http";
import { authorize } from "@/factory/core/authz";

/** Open deviations / NCRs (disposition workflow comes with the NCR module). */
export const GET = factoryRoute(async (tx, { actor }) => {
  await authorize(tx, actor, "qms.qc.view");
  return (
    await tx.query(
      `SELECT n.id, n.code, n.status, n.disposition, n.description, n.created_at, d.code AS deviation_code, d.severity,
              l.code AS lot_code, i.code AS item_code, i.name AS item_name
         FROM qms.ncr n LEFT JOIN qms.deviation d ON d.id = n.deviation_id
         LEFT JOIN inv.lot l ON l.id = n.lot_id LEFT JOIN master.item i ON i.id = n.item_id
        ORDER BY n.created_at DESC LIMIT 200`
    )
  ).rows;
});

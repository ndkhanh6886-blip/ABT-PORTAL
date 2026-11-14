import type { Tx } from "../core/db";
import { authorize, type AuthzActor } from "../core/authz";
import { invalid } from "../core/errors";
import { getSetting } from "../core/settings";
import { getQcTest } from "./qcTests";
import { loadQcFormsConfig } from "./qaOps";

export async function coaHeader(tx: Tx) {
  return { header: await getSetting<string>(tx, "company.coa_header"), footer: await getSetting<string>(tx, "company.coa_footer") };
}

/** The reviewer's e-signature of a test (meaning REVIEWED), printed on the certificate. */
export async function reviewSignature(tx: Tx, testId: string) {
  return (
    (await tx.query("SELECT signer_name, signed_at, meaning FROM core.e_signature WHERE entity_type = 'qc_test' AND entity_id = $1 AND meaning = 'REVIEWED' ORDER BY signed_at DESC LIMIT 1", [testId])).rows[0] ??
    null
  );
}

/**
 * Certificate of Analysis / Quality Test Report (`BM-QC-TR-01`) of one reviewed QC test:
 * enriches batch traceability (`order_code`, `kd_po_code`, `tccs_code`, `specification`, `storage_condition`, `lot_qty`),
 * parameter test equipment from `qms.qc_method` or `qms.qc_result`, and the configured QC/COA template settings.
 */
export async function coaForTest(tx: Tx, actor: AuthzActor, testId: string) {
  await authorize(tx, actor, "qms.qc.view");
  const t = await getQcTest(tx, testId);
  if (t.status !== "REVIEWED") throw invalid("Chỉ in Phiếu KQ / COA cho phiếu QC đã được duyệt.", undefined, "NOT_REVIEWED");

  const lot =
    t.entity_type === "LOT"
      ? (
          await tx.query(
            `SELECT l.id, l.code, l.mfr_lot_no,
                    COALESCE(po.mfg_date, l.mfg_date) AS mfg_date,
                    COALESCE(po.expiry_date, l.expiry_date) AS expiry_date,
                    i.code AS item_code, i.name AS item_name, i.base_uom,
                    i.storage_condition AS item_storage_condition,
                    COALESCE(
                      po.good_qty,
                      po.planned_qty,
                      (SELECT COALESCE(SUM(sb.qty_on_hand), 0) FROM inv.stock_balance sb WHERE sb.lot_id = l.id),
                      0
                    )::float AS lot_qty,
                    COALESCE(po.uom, i.base_uom) AS uom,
                    po.code AS order_code,
                    io.kd_po_code AS kd_po_code,
                    b.tccs_code,
                    b.specification,
                    b.storage_condition AS bom_storage_condition,
                    b.tests_per_kit,
                    b.shelf_life_months
               FROM inv.lot l
               JOIN master.item i ON i.id = l.item_id
               LEFT JOIN LATERAL (
                 SELECT p.id, p.code, p.bom_id, p.mfg_date, p.expiry_date, p.good_qty, p.planned_qty, p.uom, p.internal_order_line_id
                   FROM kit.production_order p
                  WHERE p.lot_id = l.id
                  ORDER BY p.created_at DESC
                  LIMIT 1
               ) po ON true
               LEFT JOIN intake.internal_order_line iol ON iol.id = po.internal_order_line_id
               LEFT JOIN intake.internal_order io ON io.id = iol.order_id
               LEFT JOIN LATERAL (
                 SELECT b1.tccs_code, b1.specification, b1.storage_condition, b1.tests_per_kit, b1.shelf_life_months
                   FROM kit.bom b1
                  WHERE b1.id = po.bom_id OR (po.bom_id IS NULL AND b1.product_item_id = l.item_id)
                  ORDER BY (b1.id = po.bom_id) DESC, (b1.status = 'EFFECTIVE') DESC, b1.bom_version DESC
                  LIMIT 1
               ) b ON true
              WHERE l.id = $1`,
            [t.entity_id]
          )
        ).rows[0]
      : t.entity_type === "PRODUCTION_ORDER"
        ? (
            await tx.query(
              `SELECT l.id, l.code, l.mfr_lot_no,
                      COALESCE(po.mfg_date, l.mfg_date) AS mfg_date,
                      COALESCE(po.expiry_date, l.expiry_date) AS expiry_date,
                      i.code AS item_code, i.name AS item_name, i.base_uom,
                      i.storage_condition AS item_storage_condition,
                      COALESCE(po.good_qty, po.planned_qty, 0)::float AS lot_qty,
                      COALESCE(po.uom, i.base_uom) AS uom,
                      po.code AS order_code,
                      io.kd_po_code AS kd_po_code,
                      b.tccs_code,
                      b.specification,
                      b.storage_condition AS bom_storage_condition,
                      b.tests_per_kit,
                      b.shelf_life_months
                 FROM kit.production_order po
                 JOIN master.item i ON i.id = po.product_item_id
                 LEFT JOIN inv.lot l ON l.id = po.lot_id
                 LEFT JOIN intake.internal_order_line iol ON iol.id = po.internal_order_line_id
                 LEFT JOIN intake.internal_order io ON io.id = iol.order_id
                 LEFT JOIN kit.bom b ON b.id = po.bom_id
                WHERE po.id = $1`,
              [t.entity_id]
            )
          ).rows[0]
        : null;

  // Match test parameters against qms.qc_method to enrich equipment name when not explicitly stored on qc_result
  let methods: { code: string; name: string; instrument_type: string | null }[] = [];
  try {
    methods = (
      await tx.query("SELECT code, name, instrument_type FROM qms.qc_method WHERE status IN ('EFFECTIVE', 'VALIDATED') ORDER BY version_no DESC")
    ).rows;
  } catch {
    methods = [];
  }

  const enrichedParams = Array.isArray(t.parameters)
    ? t.parameters.map((p: any) => {
        const res = Array.isArray(t.results) ? t.results.find((r: any) => r.parameter_id === p.id) : null;
        let eqName: string | null = res?.instrument_name || res?.instrument_code || null;
        if (!eqName && p.method && methods.length > 0) {
          const mLower = String(p.method).toLowerCase();
          const hit = methods.find(
            (m) =>
              (m.code && mLower.includes(m.code.toLowerCase())) ||
              (m.name && mLower.includes(m.name.toLowerCase()))
          );
          if (hit?.instrument_type) eqName = hit.instrument_type;
        }
        return { ...p, equipment_name: eqName };
      })
    : [];

  const linkedCoa = lot?.id
    ? (
        await tx.query(
          `SELECT id, code, issued_by_name, analyst_name, qc_summary, issued_at
             FROM kit.coa_certificate
            WHERE qc_test_id = $1 OR lot_id = $2
            ORDER BY (qc_test_id = $1) DESC, revision_no DESC, issued_at DESC
            LIMIT 1`,
          [testId, lot.id]
        )
      ).rows[0] ?? null
    : null;

  const { qcFormsConfig } = await loadQcFormsConfig(tx);

  return {
    ...(await coaHeader(tx)),
    test: { ...t, parameters: enrichedParams },
    lot,
    linked_coa: linkedCoa,
    signature: await reviewSignature(tx, testId),
    qc_forms_config: qcFormsConfig,
  };
}

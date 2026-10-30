import type { Tx } from "../core/db";
import type { AuthzActor } from "../core/authz";
import { notFound } from "../core/errors";
import { coaHeader, reviewSignature } from "../qms/coa";
import { visibleOligoUnits } from "./orders";

/**
 * Certificate of analysis of an Oligo order (as OligoFlow's "Phiếu phân tích chất lượng sản phẩm"): per sequence the
 * theoretical properties, the measured quantity and the results of its last passed, reviewed QC test (a pooled
 * sequence takes its pool master's). Sequences without a passed test are listed as such, never filled in.
 */
export async function orderCoa(tx: Tx, actor: AuthzActor, orderId: string) {
  const o = (
    await tx.query(
      "SELECT o.*, io.kd_po_code FROM oligo.oligo_order o LEFT JOIN intake.internal_order io ON io.id = o.internal_order_id WHERE o.id = $1",
      [orderId]
    )
  ).rows[0];
  const units = o ? await visibleOligoUnits(tx, actor) : [];
  if (!o || (units !== "ALL" && !units.includes(o.org_unit_id))) throw notFound("đơn Oligo");
  const seqs = (
    await tx.query(
      `SELECT s.id, s.code, s.name, s.normalized_sequence, s.base_count, s.molecule_type, s.scale_code, s.purification, s.format, s.mw::float AS mw, s.tm::float AS tm,
              s.gc_percent::float AS gc_percent, s.ext_coeff_260::float AS ext_coeff_260, s.nmol_per_od::float AS nmol_per_od, s.ug_per_od::float AS ug_per_od, s.modifications, s.status,
              coalesce(m.id, s.id) AS tested_id
         FROM oligo.oligo_sequence s
         LEFT JOIN oligo.oligo_pool p ON p.id = s.pool_id AND s.status = 'POOLED' LEFT JOIN oligo.oligo_sequence m ON m.id = p.master_sequence_id
        WHERE s.order_id = $1 AND s.status NOT IN ('CANCELLED', 'SPLIT')
          AND NOT (s.status = 'FAILED' AND EXISTS (SELECT 1 FROM oligo.oligo_sequence r WHERE r.parent_sequence_id = s.id AND r.relation = 'RESYNTH'))
        ORDER BY s.line_no NULLS LAST, s.code`,
      [orderId]
    )
  ).rows;
  const sequences = [];
  for (const s of seqs) {
    const pp = (
      await tx.query("SELECT od_total::float AS od_total, nmol::float AS nmol, ug::float AS ug, tube_count FROM oligo.post_process WHERE sequence_id = $1 AND status = 'SUBMITTED'", [s.tested_id])
    ).rows[0];
    const test = (
      await tx.query(
        "SELECT id, code, reviewed_at FROM qms.qc_test WHERE entity_type = 'OLIGO_SEQUENCE' AND entity_id = $1 AND status = 'REVIEWED' AND overall_result = 'PASS' ORDER BY reviewed_at DESC LIMIT 1",
        [s.tested_id]
      )
    ).rows[0];
    const results = test
      ? (
          await tx.query(
            `SELECT p.seq, p.name, p.unit, p.method, p.lower_limit::float AS lower_limit, p.upper_limit::float AS upper_limit, p.value_type, p.target,
                    r.value_numeric::float AS value_numeric, r.observed_numeric::float AS observed_numeric, r.value_text, r.passed
               FROM qms.qc_result r JOIN qms.qc_spec_parameter p ON p.id = r.parameter_id WHERE r.test_id = $1 ORDER BY p.seq`,
            [test.id]
          )
        ).rows
      : [];
    sequences.push({ ...s, measured: pp ?? null, qc: test ? { code: test.code, reviewed_at: test.reviewed_at, signature: await reviewSignature(tx, test.id), results } : null });
  }
  return {
    ...(await coaHeader(tx)),
    order: { code: o.code, customer_label: o.customer_label, kd_po_code: o.kd_po_code, due_date: o.due_date },
    sequences,
  };
}

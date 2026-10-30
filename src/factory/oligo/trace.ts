import type { Tx } from "../core/db";
import type { AuthzActor } from "../core/authz";
import { notFound } from "../core/errors";
import { visibleOligoUnits } from "./orders";

/**
 * Full history of one sequence (as OligoFlow's "Truy vết"): its order and relatives (tubes, fragments, pool,
 * resynthesis), every synthesis position with machine, operator, column lot and the reagent lots of the batch,
 * post-processing records with their SOP steps, QC tests and results, deviations / NCRs, label prints and delivery.
 * Looked up by id or by code; only within the Oligo departments the user may see.
 */
export async function traceSequence(tx: Tx, actor: AuthzActor, idOrCode: string) {
  const s = (
    await tx.query(
      `SELECT s.*, s.mw::float AS mw, o.code AS order_code, o.customer_label, io.kd_po_code
         FROM oligo.oligo_sequence s LEFT JOIN oligo.oligo_order o ON o.id = s.order_id LEFT JOIN intake.internal_order io ON io.id = o.internal_order_id
        WHERE s.id::text = $1 OR upper(s.code) = upper($1)`,
      [idOrCode.trim()]
    )
  ).rows[0];
  const units = s ? await visibleOligoUnits(tx, actor) : [];
  if (!s || (units !== "ALL" && !units.includes(s.org_unit_id))) throw notFound("trình tự");
  // a pooled member was synthesised as its pool master: trace the master's production
  const master = s.pool_id ? (await tx.query("SELECT m.id, m.code FROM oligo.oligo_pool p JOIN oligo.oligo_sequence m ON m.id = p.master_sequence_id WHERE p.id = $1", [s.pool_id])).rows[0] : null;
  const made = master?.id ?? s.id;

  const relatives = (
    await tx.query(
      `SELECT r.id, r.code, r.name, r.relation, r.status, 'child' AS link FROM oligo.oligo_sequence r WHERE r.parent_sequence_id = $1
       UNION ALL SELECT p.id, p.code, p.name, s.relation, p.status, 'parent' FROM oligo.oligo_sequence s JOIN oligo.oligo_sequence p ON p.id = s.parent_sequence_id WHERE s.id = $1
       ORDER BY code`,
      [s.id]
    )
  ).rows;
  const synthesis = (
    await tx.query(
      `SELECT b.id AS batch_id, b.code AS batch_code, b.status AS batch_status, b.started_at, b.finished_at, b.program_name, a.code AS synthesizer_code, a.name AS synthesizer_name,
              u.display_name AS operator_name, p.position_no, p.couplings, p.coupling_efficiency_pct::float AS coupling_efficiency_pct, p.result, cl.code AS column_lot_code
         FROM oligo.synthesis_position p JOIN oligo.synthesis_batch b ON b.id = p.batch_id JOIN asset.asset a ON a.id = b.synthesizer_id
         JOIN inv.lot cl ON cl.id = p.column_lot_id LEFT JOIN core.user_profile u ON u.user_id = b.operator_id
        WHERE p.sequence_id = $1 ORDER BY b.created_at`,
      [made]
    )
  ).rows;
  for (const b of synthesis) {
    b.lots = (
      await tx.query(
        `SELECT i.code AS item_code, i.name AS item_name, l.code AS lot_code, l.expiry_date, -sum(sl.qty_delta_base)::float AS qty, i.base_uom
           FROM inv.stock_ledger sl JOIN inv.stock_document_line dl ON dl.id = sl.document_line_id JOIN inv.stock_document d ON d.id = dl.document_id
           JOIN master.item i ON i.id = sl.item_id LEFT JOIN inv.lot l ON l.id = sl.lot_id
          WHERE d.source_entity_type = 'SYNTHESIS_BATCH' AND d.source_entity_id = $1
          GROUP BY i.code, i.name, l.code, l.expiry_date, i.base_uom HAVING sum(sl.qty_delta_base) <> 0 ORDER BY i.code, l.code`,
        [b.batch_id]
      )
    ).rows;
    b.bottle_changes = (
      await tx.query(
        `SELECT e.port_no, e.role, e.swap_cycle, n.code AS new_lot, o.code AS old_lot FROM oligo.bottle_event e
           LEFT JOIN inv.lot n ON n.id = e.lot_id LEFT JOIN inv.lot o ON o.id = e.old_lot_id WHERE e.batch_id = $1 AND e.event = 'SWAP' ORDER BY e.created_at`,
        [b.batch_id]
      )
    ).rows;
  }
  const post = (
    await tx.query(
      `SELECT pp.id, pp.status, pp.purification, pp.format, pp.od_total::float AS od_total, pp.nmol::float AS nmol, pp.ug::float AS ug, pp.tube_count, pp.created_at, pp.submitted_at, pp.notes
         FROM oligo.post_process pp WHERE pp.sequence_id = $1 ORDER BY pp.created_at`,
      [made]
    )
  ).rows;
  for (const r of post) {
    r.steps = (
      await tx.query(
        `SELECT l.step_no, l.step_name, l.values, l.performed_at, u.display_name AS performed_by_name, d.code AS stock_document_code
           FROM oligo.ps_step_log l LEFT JOIN core.user_profile u ON u.user_id = l.performed_by LEFT JOIN inv.stock_document d ON d.id = l.stock_document_id
          WHERE l.post_process_id = $1 ORDER BY l.step_no`,
        [r.id]
      )
    ).rows;
  }
  const qc = (
    await tx.query(
      `SELECT t.id, t.code, t.status, t.overall_result, t.created_at, t.reviewed_at, an.display_name AS analyst_name, rv.display_name AS reviewer_name,
              (SELECT json_agg(json_build_object('name', p.name, 'unit', p.unit, 'value', r.value_numeric, 'observed', r.observed_numeric, 'text', r.value_text, 'passed', r.passed) ORDER BY p.seq)
                 FROM qms.qc_result r JOIN qms.qc_spec_parameter p ON p.id = r.parameter_id WHERE r.test_id = t.id) AS results
         FROM qms.qc_test t LEFT JOIN core.user_profile an ON an.user_id = t.analyst_id LEFT JOIN core.user_profile rv ON rv.user_id = t.reviewer_id
        WHERE t.entity_type = 'OLIGO_SEQUENCE' AND t.entity_id = $1 ORDER BY t.created_at`,
      [made]
    )
  ).rows;
  const quality = (
    await tx.query(
      `SELECT d.code, d.title, d.severity, d.status, d.description, d.step_ref, d.root_cause, d.corrective_action, d.created_at, n.code AS ncr_code, n.disposition, n.status AS ncr_status
         FROM qms.deviation d LEFT JOIN qms.ncr n ON n.deviation_id = d.id
        WHERE (d.entity_type = 'OLIGO_SEQUENCE' AND d.entity_id = ANY($1::uuid[]))
           OR (d.entity_type = 'SYNTHESIS_BATCH' AND d.entity_id = ANY($2::uuid[]))
        ORDER BY d.created_at`,
      [[s.id, made], synthesis.map((b) => b.batch_id)]
    )
  ).rows;
  const labels = (
    await tx.query("SELECT lp.labels, lp.reprint, lp.reason, lp.printed_at, u.display_name AS printed_by_name FROM oligo.label_print lp LEFT JOIN core.user_profile u ON u.user_id = lp.printed_by WHERE lp.sequence_id = $1 ORDER BY lp.printed_at", [made])
  ).rows;
  const delivery = (
    await tx.query(
      `SELECT d.code, d.recipient, d.created_at, di.tube_count, sh.status AS shipment_status, sh.kd_inbound_code
         FROM oligo.delivery_item di JOIN oligo.delivery d ON d.id = di.delivery_id LEFT JOIN intake.shipment sh ON sh.id = d.shipment_id WHERE di.sequence_id = $1`,
      [s.id]
    )
  ).rows[0] ?? null;
  return {
    sequence: { id: s.id, code: s.code, name: s.name, status: s.status, normalized_sequence: s.normalized_sequence, base_count: s.base_count, mw: s.mw, scale_code: s.scale_code, purification: s.purification, relation: s.relation, created_at: s.created_at },
    order: s.order_id ? { code: s.order_code, customer_label: s.customer_label, kd_po_code: s.kd_po_code } : null,
    pool_master: master,
    relatives,
    synthesis,
    post,
    qc,
    quality,
    labels,
    delivery,
  };
}

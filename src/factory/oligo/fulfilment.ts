import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, registerPermissions, type AuthzActor } from "../core/authz";
import { vnToday } from "../core/dates";
import { invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { enqueueEvent } from "../core/outbox";
import { parseInput } from "../core/records";
import { runTransition } from "../core/stateMachine";
import { syncOrderStatus } from "../intake/shipments";
import { registerNcrSubject, type Ncr } from "../qms/ncr";
import { analyze, pyRound } from "./analyzer";
import { loadCatalog } from "./catalog";
import { insertSequence, recomputeOrdersOf, visibleOligoUnits } from "./orders";
import { openRecord } from "./postProcess";
import { sequenceMachine } from "./sequences";

registerPermissions([{ code: "oligo.delivery.manage", description: "In nhãn ống Oligo, giao Oligo cho Kinh doanh / bàn giao nội bộ" }]);

const lockSeq = async (tx: Tx, id: string) => {
  const s = (await tx.query("SELECT * FROM oligo.oligo_sequence WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!s) throw notFound("trình tự");
  return s;
};
const move = (tx: Tx, actor: AuthzActor, s: { id: string; version: number }, action: string, reason?: string, trusted = false) =>
  runTransition(tx, sequenceMachine, actor, { id: s.id, action, expectedVersion: s.version, reason }, { trusted });
const reachedQc = async (tx: Tx, seqId: string) =>
  Boolean((await tx.query("SELECT 1 FROM oligo.post_process WHERE sequence_id = $1 AND status = 'SUBMITTED'", [seqId])).rowCount);

// ---- NCR on a sequence: the approved disposition decides what happens next ----

async function dispositionProblem(tx: Tx, s: any, disposition: string): Promise<string | null> {
  if (s.status !== "FAILED") return `Trình tự ${s.code} không ở trạng thái Lỗi.`;
  if (disposition === "RETURN_TO_SUPPLIER") return "Trả nhà cung cấp không áp dụng cho Oligo tự tổng hợp.";
  if ((disposition === "REWORK" || disposition === "USE_AS_IS") && !(await reachedQc(tx, s.id))) {
    return `Trình tự ${s.code} lỗi ở bước tổng hợp (chưa có sản phẩm để làm lại / đặc cách): chỉ tổng hợp lại hoặc hủy.`;
  }
  if (disposition === "RESYNTHESIZE") {
    const again = await tx.query("SELECT 1 FROM oligo.oligo_sequence WHERE parent_sequence_id = $1 AND relation = 'RESYNTH' AND status <> 'CANCELLED'", [s.id]);
    if (again.rowCount) return `Trình tự ${s.code} đã có bản tổng hợp lại.`;
  }
  return null;
}

/** RESYNTHESIZE: a new pending sequence (a pool master is replaced in its pool, so the members follow the new synthesis). */
async function resynthesize(tx: Tx, actor: AuthzActor, s: any, ncr: Ncr) {
  const a = analyze(s.raw_sequence, await loadCatalog(tx));
  const master = s.relation === "POOL_MASTER";
  const n = await insertSequence(tx, actor, {
    order_id: s.order_id, org_unit_id: s.org_unit_id, line_no: s.line_no, name: s.name, raw: s.raw_sequence, a,
    scale_code: s.scale_code, purification: s.purification, format: s.format,
    parent_sequence_id: master ? null : s.id, relation: master ? "POOL_MASTER" : "RESYNTH",
  });
  await tx.query("UPDATE oligo.oligo_sequence SET notes = $2 WHERE id = $1", [n.id, `Tổng hợp lại ${s.code} theo NCR ${ncr.code}`]);
  if (master) await tx.query("UPDATE oligo.oligo_pool SET master_sequence_id = $2 WHERE master_sequence_id = $1", [s.id, n.id]);
  await writeAudit(tx, actor, { entityType: "oligo_sequence", entityId: s.id, action: "resynthesize", changes: { resynthesis: [null, n.code] }, reason: `NCR ${ncr.code}` });
  return n;
}

registerNcrSubject("OLIGO_SEQUENCE", {
  check: async (tx, ncr, disposition) => {
    const s = (await tx.query("SELECT * FROM oligo.oligo_sequence WHERE id = $1", [ncr.entity_id])).rows[0];
    return s ? dispositionProblem(tx, s, disposition) : "Không tìm thấy trình tự của NCR.";
  },
  onApproved: async (tx, actor, ncr) => {
    const s = await lockSeq(tx, ncr.entity_id);
    const problem = await dispositionProblem(tx, s, ncr.disposition);
    if (problem) throw invalid(problem, undefined, "DISPOSITION_FIT");
    const why = `NCR ${ncr.code}: ${ncr.disposition}`;
    if (ncr.disposition === "RESYNTHESIZE") await resynthesize(tx, actor, s, ncr);
    else if (ncr.disposition === "REWORK") {
      // the measured product goes back to post-processing (e.g. re-purification) and is measured and tested again
      const old = (await tx.query("UPDATE oligo.post_process SET status = 'VOID', version = version + 1, updated_at = now() WHERE sequence_id = $1 AND status = 'SUBMITTED' RETURNING *", [s.id])).rows[0];
      await move(tx, actor, s, "rework", why, true);
      await openRecord(tx, actor, { sequence_id: s.id, batch_id: old.batch_id, purification: old.purification, format: old.format, notes: `Làm lại theo NCR ${ncr.code}` });
    } else if (ncr.disposition === "USE_AS_IS") await move(tx, actor, s, "concession", why, true);
    // SCRAP: the sequence stays failed
    await recomputeOrdersOf(tx, actor, [s.id]);
  },
});

// ---- tube labels ----

/** Sequences whose tubes may be labelled: in post-processing / QC (shown as not released) or completed. */
const LABEL_STATUSES = ["POST_PROCESSING", "QC", "COMPLETED"];

/**
 * Label data for every tube, computed from the post-processing record (never typed): OD, nmol and,
 * for liquid oligo, volume and concentration per tube. Every print is recorded; a reprint needs a reason.
 */
export async function printLabels(tx: Tx, actor: AuthzActor, input: unknown) {
  const data = parseInput(
    z.object({
      sequence_ids: z.array(z.string().uuid()).min(1).max(200),
      reason: z.string().trim().max(500).optional().nullable(),
      // preview: what the labels will look like, at any stage — nothing is recorded, values not measured yet stay empty
      preview: z.boolean().default(false),
    }),
    input
  );
  const rows = (
    await tx.query(
      `SELECT s.id, s.code, s.name, s.org_unit_id, s.status, s.normalized_sequence, s.base_count, s.mw::float AS mw, s.tm::float AS tm, s.scale_code, s.purification, s.format,
              s.modifications, o.code AS order_code, o.customer_label, sc.label AS scale_label,
              -- a pooled member (customer tube) takes its aliquot of the pool master's measurement
              coalesce(pp.od_total, pa.od)::float AS od_total, coalesce(pp.nmol, pa.nmol)::float AS nmol, coalesce(pp.ug, pa.ug)::float AS ug,
              coalesce(pp.tube_count, pa.tube_count) AS tube_count, coalesce(pp.target_conc_um, mpp.target_conc_um)::float AS conc_um,
              coalesce(pp.resuspend_volume_ul, pa.volume_ul)::float AS volume_ul, CASE WHEN s.status = 'POOLED' THEN m.status ELSE s.status END AS eff_status,
              EXISTS (SELECT 1 FROM oligo.label_print lp WHERE lp.sequence_id = s.id) AS printed
         FROM oligo.oligo_sequence s JOIN oligo.scale sc ON sc.code = s.scale_code
         LEFT JOIN oligo.oligo_order o ON o.id = s.order_id
         LEFT JOIN oligo.post_process pp ON pp.sequence_id = s.id AND pp.status <> 'VOID'
         LEFT JOIN oligo.oligo_pool pl ON pl.id = s.pool_id AND s.status = 'POOLED'
         LEFT JOIN oligo.oligo_sequence m ON m.id = pl.master_sequence_id
         LEFT JOIN oligo.post_process mpp ON mpp.sequence_id = m.id AND mpp.status <> 'VOID'
         LEFT JOIN oligo.pool_aliquot pa ON pa.master_post_process_id = mpp.id AND pa.sequence_id = s.id
        WHERE s.id = ANY($1::uuid[]) ORDER BY s.code`,
      [data.sequence_ids]
    )
  ).rows;
  if (rows.length !== new Set(data.sequence_ids).size) throw notFound("trình tự");
  const labels = [];
  for (const r of rows) {
    if (data.preview) {
      await authorize(tx, actor, "oligo.view", r.org_unit_id);
      const tubes = r.tube_count ?? 1;
      for (let i = 1; i <= tubes; i++) {
        labels.push({
          sequence_id: r.id, code: r.code, name: r.name, order_code: r.order_code, customer: r.customer_label, sequence: r.normalized_sequence, bases: r.base_count,
          mw: r.mw, tm: r.tm, scale: r.scale_label, purification: r.purification, format: r.format, modifications: r.modifications, tube: `${i}/${tubes}`,
          od: r.od_total == null ? null : pyRound(r.od_total / tubes, 2), nmol: r.nmol == null ? null : pyRound(r.nmol / tubes, 1),
          volume_ul: r.format === "LIQUID" && r.volume_ul ? pyRound(r.volume_ul / tubes, 1) : null, conc_um: r.format === "LIQUID" ? r.conc_um : null,
          released: r.eff_status === "COMPLETED", date: vnToday(), preview: true,
          printable: LABEL_STATUSES.includes(r.eff_status) && r.od_total != null, printed: r.printed,
        });
      }
      continue;
    }
    await authorize(tx, actor, "oligo.delivery.manage", r.org_unit_id);
    if (r.status === "POOLED" && r.od_total == null) throw invalid(`${r.code} nằm trong mẻ gộp: chia ống cho trình tự gộp trước khi in nhãn.`, undefined, "ALIQUOT_MISSING");
    if (!LABEL_STATUSES.includes(r.eff_status) || r.od_total == null) throw invalid(`${r.code}: chỉ in nhãn khi đã đo OD ở hậu tổng hợp.`);
    if (r.printed && !data.reason) throw invalid(`${r.code} đã in nhãn. In lại cần ghi lý do.`, undefined, "REPRINT_REASON");
    await tx.query("INSERT INTO oligo.label_print (sequence_id, labels, reprint, reason, printed_by) VALUES ($1, $2, $3, $4, $5)", [
      r.id, r.tube_count, r.printed, r.printed ? data.reason : null, actor.userId,
    ]);
    await writeAudit(tx, actor, { entityType: "oligo_sequence", entityId: r.id, action: r.printed ? "reprint_labels" : "print_labels", changes: { labels: [null, r.tube_count] }, reason: data.reason ?? null });
    for (let i = 1; i <= r.tube_count; i++) {
      labels.push({
        sequence_id: r.id, code: r.code, name: r.name, order_code: r.order_code, customer: r.customer_label, sequence: r.normalized_sequence, bases: r.base_count,
        mw: r.mw, tm: r.tm, scale: r.scale_label, purification: r.purification, format: r.format, modifications: r.modifications,
        tube: `${i}/${r.tube_count}`, od: pyRound(r.od_total / r.tube_count, 2), nmol: pyRound(r.nmol / r.tube_count, 1),
        volume_ul: r.format === "LIQUID" && r.volume_ul ? pyRound(r.volume_ul / r.tube_count, 1) : null, conc_um: r.format === "LIQUID" ? r.conc_um : null,
        released: r.eff_status === "COMPLETED", date: vnToday(),
      });
    }
  }
  return labels;
}

// ---- delivery ----

/** Completed sequences of an order not yet delivered (pool members once their pool master passed QC). */
async function deliverable(tx: Tx, orderId: string) {
  return (
    await tx.query(
      `SELECT s.id, s.code, s.name, s.status, s.version, s.base_count, s.scale_code, s.purification,
              coalesce(pp.tube_count, pa.tube_count, mpp.tube_count, 1) AS tube_count,
              EXISTS (SELECT 1 FROM oligo.label_print lp WHERE lp.sequence_id IN (s.id, m.id)) AS labelled
         FROM oligo.oligo_sequence s
         LEFT JOIN oligo.oligo_pool p ON p.id = s.pool_id AND s.status = 'POOLED'
         LEFT JOIN oligo.oligo_sequence m ON m.id = p.master_sequence_id
         LEFT JOIN oligo.post_process pp ON pp.sequence_id = s.id AND pp.status = 'SUBMITTED'
         LEFT JOIN oligo.post_process mpp ON mpp.sequence_id = m.id AND mpp.status = 'SUBMITTED'
         LEFT JOIN oligo.pool_aliquot pa ON pa.master_post_process_id = mpp.id AND pa.sequence_id = s.id
        WHERE s.order_id = $1 AND (s.status = 'COMPLETED' OR (s.status = 'POOLED' AND m.status = 'COMPLETED'))
          AND NOT EXISTS (SELECT 1 FROM oligo.delivery_item di WHERE di.sequence_id = s.id)
        ORDER BY s.line_no, s.code`,
      [orderId]
    )
  ).rows;
}

export async function deliveryOptions(tx: Tx, actor: AuthzActor, orderId: string) {
  const o = (await tx.query("SELECT * FROM oligo.oligo_order WHERE id = $1", [orderId])).rows[0];
  if (!o) throw notFound("đơn Oligo");
  await authorize(tx, actor, "oligo.delivery.manage", o.org_unit_id);
  const lines = o.internal_order_id
    ? (
        await tx.query(
          `SELECT l.id, l.line_no, l.kd_item_code, l.kd_item_name, l.kd_unit, l.qty::float AS qty, l.qty_delivered::float AS qty_delivered
             FROM intake.internal_order_line l WHERE l.order_id = $1 ORDER BY l.line_no`,
          [o.internal_order_id]
        )
      ).rows
    : [];
  const internal = o.internal_order_id ? (await tx.query("SELECT code, kd_po_code, ship_mode, status FROM intake.internal_order WHERE id = $1", [o.internal_order_id])).rows[0] : null;
  const deliveries = (
    await tx.query(
      `SELECT d.id, d.code, d.recipient, d.created_at, s.status AS shipment_status, (SELECT count(*)::int FROM oligo.delivery_item i WHERE i.delivery_id = d.id) AS sequences
         FROM oligo.delivery d LEFT JOIN intake.shipment s ON s.id = d.shipment_id WHERE d.order_id = $1 ORDER BY d.created_at`,
      [orderId]
    )
  ).rows;
  return { order: { id: o.id, code: o.code, customer_label: o.customer_label }, internal_order: internal, lines, sequences: await deliverable(tx, orderId), deliveries };
}

const deliverySchema = z.object({
  order_id: z.string().uuid(),
  sequence_ids: z.array(z.string().uuid()).min(1, "chọn ít nhất một trình tự").max(500),
  lines: z.array(z.object({ order_line_id: z.string().uuid(), qty: z.coerce.number().positive("số lượng phải lớn hơn 0") })).max(50).default([]),
  recipient: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

/**
 * Delivers labelled, QC-passed sequences. An order from a Kinh doanh PO becomes a shipment to Kinh doanh
 * (counted against the PO lines, never over the ordered quantity; a drop ship still goes through KD's paperwork);
 * an order without a PO is an internal hand-over to a named recipient.
 */
export async function createDelivery(tx: Tx, actor: AuthzActor, input: unknown) {
  const data = parseInput(deliverySchema, input);
  const o = (await tx.query("SELECT * FROM oligo.oligo_order WHERE id = $1 FOR UPDATE", [data.order_id])).rows[0];
  if (!o) throw notFound("đơn Oligo");
  await authorize(tx, actor, "oligo.delivery.manage", o.org_unit_id);
  const ids = [...new Set(data.sequence_ids)];
  await tx.query("SELECT 1 FROM oligo.oligo_sequence WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE", [ids]);
  const ready = new Map((await deliverable(tx, o.id)).map((s) => [s.id, s]));
  const picked = ids.map((id) => ready.get(id));
  if (picked.some((s) => !s)) throw invalid("Có trình tự không thuộc đơn, chưa đạt QC hoặc đã giao. Tải lại trang.", undefined, "NOT_DELIVERABLE");
  const unlabelled = picked.filter((s) => !s!.labelled).map((s) => s!.code);
  if (unlabelled.length) throw invalid(`Chưa in nhãn ống: ${unlabelled.join(", ")}.`, undefined, "NOT_LABELLED");

  const code = await nextNumber(tx, "DELIVERY_NOTE");
  let shipmentId: string | null = null;
  if (o.internal_order_id) {
    await authorize(tx, actor, "intake.shipment.post", o.org_unit_id);
    const io = (await tx.query("SELECT * FROM intake.internal_order WHERE id = $1 FOR UPDATE", [o.internal_order_id])).rows[0];
    if (!["ACCEPTED", "IN_PRODUCTION", "READY", "PARTIALLY_DELIVERED"].includes(io.status)) throw invalid(`Đơn nội bộ ${io.code} không ở trạng thái giao được.`);
    if (!data.lines.length) throw invalid("Chọn dòng PO Kinh doanh và số lượng tính cho lần giao này.");
    const shipment = (
      await tx.query("INSERT INTO intake.shipment (code, order_id, kind, ship_mode, notes, created_by, updated_by) VALUES ($1, $2, 'OLIGO', $3, $4, $5, $5) RETURNING id", [
        code, io.id, io.ship_mode, data.notes ?? null, actor.userId,
      ])
    ).rows[0];
    shipmentId = shipment.id;
    const eventLines = [];
    for (const [i, l] of data.lines.entries()) {
      const ol = (await tx.query("SELECT * FROM intake.internal_order_line WHERE id = $1 AND order_id = $2 FOR UPDATE", [l.order_line_id, io.id])).rows[0];
      if (!ol) throw invalid(`Dòng ${i + 1}: không thuộc đơn nội bộ ${io.code}.`);
      if (Number(ol.qty_delivered) + l.qty > Number(ol.qty) + 1e-9) {
        throw invalid(`Dòng ${i + 1} (${ol.kd_item_code}): giao vượt số lượng đặt (đặt ${Number(ol.qty)}, đã giao ${Number(ol.qty_delivered)}).`, undefined, "OVER_DELIVERY");
      }
      await tx.query("UPDATE intake.internal_order_line SET qty_delivered = qty_delivered + $2 WHERE id = $1", [ol.id, l.qty]);
      await tx.query("INSERT INTO intake.shipment_line (shipment_id, order_line_id, item_id, qty) VALUES ($1, $2, $3, $4)", [shipment.id, ol.id, ol.item_id, l.qty]);
      eventLines.push({
        line_index: ol.kd_line_index, product_code: ol.kd_item_code, product_name: ol.kd_item_name, unit: ol.kd_unit, quantity: l.qty,
        unit_price: Number(ol.transfer_price), lot_number: o.code, expiry_date: null, manufacture_date: vnToday(),
      });
    }
    await syncOrderStatus(tx, actor, io.id);
    await enqueueEvent(
      tx,
      "FactoryShipmentPosted",
      {
        shipment_id: shipment.id, shipment_code: code, kd_po_code: io.kd_po_code, ship_mode: io.ship_mode, ship_to: io.ship_to, lines: eventLines,
        oligo_sequences: picked.map((s) => ({ code: s!.code, name: s!.name, bases: s!.base_count, scale: s!.scale_code, purification: s!.purification, tubes: s!.tube_count })),
      },
      "KD"
    );
  } else if (!data.recipient) {
    throw invalid("Đơn không gắn PO Kinh doanh: ghi người / bộ phận nhận (bàn giao nội bộ).");
  }

  const d = (
    await tx.query("INSERT INTO oligo.delivery (code, order_id, shipment_id, recipient, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *", [
      code, o.id, shipmentId, shipmentId ? null : data.recipient, data.notes ?? null, actor.userId,
    ])
  ).rows[0];
  for (const s of picked) {
    await tx.query("INSERT INTO oligo.delivery_item (delivery_id, sequence_id, tube_count) VALUES ($1, $2, $3)", [d.id, s!.id, s!.tube_count]);
    await move(tx, actor, s!, "deliver");
  }
  await recomputeOrdersOf(tx, actor, ids);
  await writeAudit(tx, actor, { entityType: "oligo_delivery", entityId: d.id, action: "create", changes: { code: [null, code], sequences: [null, picked.length] } });
  return d;
}

/** Orders with sequences waiting for labels or delivery, for the delivery screen. */
export async function listDeliveryQueue(tx: Tx, actor: AuthzActor) {
  const units = await visibleOligoUnits(tx, actor);
  if (units !== "ALL" && !units.length) return [];
  return (
    await tx.query(
      `SELECT o.id, o.code, o.customer_label, o.due_date, o.status, io.kd_po_code,
              count(*) FILTER (WHERE s.status = 'COMPLETED' OR (s.status = 'POOLED' AND m.status = 'COMPLETED'))::int AS ready,
              count(*) FILTER (WHERE s.status = 'DELIVERED')::int AS delivered,
              count(*) FILTER (WHERE s.status NOT IN ('CANCELLED', 'SPLIT'))::int AS total
         FROM oligo.oligo_order o LEFT JOIN intake.internal_order io ON io.id = o.internal_order_id
         JOIN oligo.oligo_sequence s ON s.order_id = o.id
         LEFT JOIN oligo.oligo_pool p ON p.id = s.pool_id AND s.status = 'POOLED'
         LEFT JOIN oligo.oligo_sequence m ON m.id = p.master_sequence_id
        WHERE o.status IN ('IN_PROGRESS', 'COMPLETED') AND ($1::uuid[] IS NULL OR o.org_unit_id = ANY($1::uuid[]))
        GROUP BY o.id, io.kd_po_code
       HAVING count(*) FILTER (WHERE s.status = 'COMPLETED' OR (s.status = 'POOLED' AND m.status = 'COMPLETED')) > 0
        ORDER BY o.due_date NULLS LAST, o.code`,
      [units === "ALL" ? null : units]
    )
  ).rows;
}

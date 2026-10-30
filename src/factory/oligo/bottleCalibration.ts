import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, type AuthzActor } from "../core/authz";
import { conflict, invalid, notFound } from "../core/errors";
import { parseInput } from "../core/records";
import { runTransition } from "../core/stateMachine";
import { allocate, findCandidates } from "../inv/allocation";
import { createStockDocument, stockDocumentMachine } from "../inv/documents";
import { getItem, toBaseQty } from "../master/service";
import { visibleOligoUnits } from "./orders";

const removeSchema = z.object({
  volume_start: z.coerce.number().positive("nhập dung tích chai lúc lắp"),
  volume_left: z.coerce.number().min(0, "lượng còn lại không âm"),
  uom: z.string().min(1),
  // book the difference between what the bottle really gave and what batches booked on the lot
  adjust_stock: z.boolean().default(true),
  notes: z.string().trim().max(500).optional().nullable(),
});

const round = (n: number, d = 6) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Takes a bottle off a port and calibrates the rule, as OligoFlow's "Hiệu chuẩn định mức": what the bottle really
 * gave (volume at install − volume left) against what the batches booked from that lot while it was on the port.
 * The ratio proposes a corrected rule (applied separately, by whoever manages the rules); the difference can be
 * booked on the lot at once so the stock matches the bottle.
 */
export async function removeAndCalibrate(tx: Tx, actor: AuthzActor, synthId: string, portNo: number, input: unknown) {
  const d = parseInput(removeSchema, input);
  if (d.volume_left > d.volume_start) throw invalid("Lượng còn lại không được lớn hơn dung tích lúc lắp.");
  const synth = (await tx.query("SELECT a.code, a.owner_org_unit_id FROM oligo.synthesizer s JOIN asset.asset a ON a.id = s.asset_id WHERE s.asset_id = $1", [synthId])).rows[0];
  if (!synth) throw notFound("máy tổng hợp");
  await authorize(tx, actor, "oligo.batch.manage", synth.owner_org_unit_id);
  const running = (await tx.query("SELECT code FROM oligo.synthesis_batch WHERE synthesizer_id = $1 AND status = 'RUNNING' LIMIT 1", [synthId])).rows[0];
  if (running) throw conflict(`Máy đang chạy mẻ ${running.code}: tháo chai sau khi mẻ kết thúc (hoặc thay chai trong mẻ).`, "SYNTHESIZER_RUNNING");
  const port = (await tx.query("SELECT * FROM oligo.synth_port WHERE synthesizer_id = $1 AND port_no = $2 FOR UPDATE", [synthId, portNo])).rows[0];
  if (!port) throw notFound(`cổng ${portNo}`);
  if (!port.current_lot_id) throw invalid(`Cổng ${portNo} đang không có chai.`, undefined, "PORT_EMPTY");
  const lot = (await tx.query("SELECT id, code, item_id FROM inv.lot WHERE id = $1", [port.current_lot_id])).rows[0];
  const item = await getItem(tx, lot.item_id);
  const start = await toBaseQty(tx, item, d.volume_start, d.uom);
  const left = await toBaseQty(tx, item, d.volume_left, d.uom);
  const actual = round(start - left);
  // net quantity batches of this synthesizer took from the lot since the bottle went on (issues minus returns)
  const booked = Number(
    (
      await tx.query(
        `SELECT coalesce(-sum(sl.qty_delta_base), 0) AS q
           FROM inv.stock_ledger sl JOIN inv.stock_document_line dl ON dl.id = sl.document_line_id JOIN inv.stock_document d ON d.id = dl.document_id
           JOIN oligo.synthesis_batch b ON d.source_entity_type = 'SYNTHESIS_BATCH' AND b.id = d.source_entity_id
          WHERE sl.lot_id = $1 AND b.synthesizer_id = $2 AND ($3::timestamptz IS NULL OR sl.posted_at >= $3)`,
        [lot.id, synthId, port.installed_at]
      )
    ).rows[0].q
  );
  const ratio = booked > 0 ? round(actual / booked, 4) : null;
  const rule = port.role.startsWith("MOD:") ? null : (await tx.query("SELECT qty::float AS qty FROM oligo.reagent_rule WHERE role = $1", [port.role])).rows[0];
  const suggested = rule && booked > 0 ? round((rule.qty * actual) / booked, 4) : null; // from the exact ratio, not the rounded one

  let adjDoc: string | null = null;
  const diff = round(actual - booked);
  if (d.adjust_stock && Math.abs(diff) > 1e-6) adjDoc = await bookDifference(tx, actor, synth.owner_org_unit_id, lot, item, diff, `Hiệu chỉnh khi tháo chai cổng ${portNo} máy ${synth.code}`);

  const cal = (
    await tx.query(
      `INSERT INTO oligo.bottle_calibration (synthesizer_id, port_no, role, lot_id, installed_at, volume_start, volume_left, actual_qty, booked_qty, ratio, rule_qty_before, suggested_qty,
         adjustment_document_id, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [synthId, portNo, port.role, lot.id, port.installed_at, start, left, actual, booked, ratio, rule?.qty ?? null, suggested, adjDoc, d.notes ?? null, actor.userId]
    )
  ).rows[0];
  await tx.query("UPDATE oligo.synth_port SET current_lot_id = NULL, installed_at = now(), installed_by = $3, version = version + 1 WHERE synthesizer_id = $1 AND port_no = $2", [
    synthId, portNo, actor.userId,
  ]);
  await tx.query(
    "INSERT INTO oligo.bottle_event (synthesizer_id, port_no, role, event, old_lot_id, qty_moved_base, notes, created_by) VALUES ($1, $2, $3, 'REMOVE', $4, $5, $6, $7)",
    [synthId, portNo, port.role, lot.id, actual, `Tháo chai, thực tế ${actual} / ghi sổ ${booked}`, actor.userId]
  );
  await writeAudit(tx, actor, { entityType: "synthesizer", entityId: synthId, action: "remove_bottle", changes: { [`port ${portNo}`]: [lot.code, null], actual: [booked, actual] }, reason: d.notes ?? null });
  return cal;
}

/** Books what the bottle gave beyond (issue) or below (return) what batches booked on the lot. */
async function bookDifference(tx: Tx, actor: AuthzActor, unit: string, lot: { id: string; code: string; item_id: string }, item: { base_uom: string; code: string }, diff: number, note: string) {
  const warehouses = (await tx.query("SELECT id FROM master.warehouse WHERE owner_org_unit_id = $1 AND status = 'ACTIVE'", [unit])).rows.map((r) => r.id);
  const post = async (doc: Parameters<typeof createStockDocument>[2]) => {
    const c = await createStockDocument(tx, actor, doc, { trusted: true });
    await runTransition(tx, stockDocumentMachine, actor, { id: c.id, action: "post", expectedVersion: c.version }, { trusted: true });
    return c.id;
  };
  if (diff > 0) {
    const plan = allocate((await findCandidates(tx, lot.item_id, warehouses, { lock: true })).filter((c) => c.lot_id === lot.id), diff);
    if (plan.shortfall > 1e-9) throw invalid(`Lô ${lot.code} không đủ tồn sổ sách để ghi phần dùng thêm (${diff} ${item.base_uom}). Bỏ chọn ghi chênh lệch và cho kho kiểm kê.`, undefined, "INSUFFICIENT_STOCK");
    const wh = (await tx.query("SELECT warehouse_id FROM master.location WHERE id = $1", [plan.picks[0].candidate.location_id])).rows[0].warehouse_id;
    return post({
      doc_type: "ISSUE", reason_code: "SYNTHESIS_VARIANCE", warehouse_id: wh, source_entity_type: "OLIGO_BOTTLE", source_entity_id: lot.id, notes: note,
      lines: plan.picks.map((p) => ({ item_id: lot.item_id, lot_id: lot.id, from_location_id: p.candidate.location_id, qty: p.qty, uom: item.base_uom })),
    });
  }
  const loc = (
    await tx.query(
      `SELECT b.location_id, l.warehouse_id FROM inv.stock_balance b JOIN master.location l ON l.id = b.location_id
        WHERE b.lot_id = $1 AND l.warehouse_id = ANY($2::uuid[]) AND NOT l.is_quarantine ORDER BY b.qty_on_hand DESC LIMIT 1`,
      [lot.id, warehouses]
    )
  ).rows[0];
  if (!loc) throw invalid(`Không xác định được vị trí của lô ${lot.code} để trả phần dùng ít hơn ghi sổ.`);
  return post({
    doc_type: "ADJUSTMENT", reason_code: "SYNTHESIS_VARIANCE", warehouse_id: loc.warehouse_id, source_entity_type: "OLIGO_BOTTLE", source_entity_id: lot.id, notes: note,
    lines: [{ item_id: lot.item_id, lot_id: lot.id, to_location_id: loc.location_id, qty: -diff, uom: item.base_uom }],
  });
}

/** Applies a calibration's suggested quantity to the rule (rule managers only), audited with the reason. */
export async function applyCalibration(tx: Tx, actor: AuthzActor, id: string, reasonInput: unknown) {
  await authorizeAnywhere(tx, actor, "oligo.reagent.manage");
  const reason = parseInput(z.string().trim().min(3, "nhập lý do áp dụng"), reasonInput);
  const c = (await tx.query("SELECT * FROM oligo.bottle_calibration WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!c) throw notFound("hiệu chuẩn");
  if (c.applied) throw invalid("Đã áp dụng.");
  if (c.suggested_qty == null) throw invalid("Không có định mức đề xuất (chưa ghi sổ lượng nào cho chai này).");
  const rule = (await tx.query("SELECT qty::float AS qty FROM oligo.reagent_rule WHERE role = $1 FOR UPDATE", [c.role])).rows[0];
  if (!rule) throw notFound("định mức");
  await tx.query("UPDATE oligo.reagent_rule SET qty = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE role = $1", [c.role, c.suggested_qty, actor.userId]);
  await tx.query("UPDATE oligo.bottle_calibration SET applied = true, applied_at = now(), applied_by = $2 WHERE id = $1", [id, actor.userId]);
  await writeAudit(tx, actor, { entityType: "oligo_reagent_rule", entityId: c.role, action: "calibrate", changes: { qty: [rule.qty, Number(c.suggested_qty)] }, reason });
}

export async function listCalibrations(tx: Tx, actor: AuthzActor) {
  const units = await visibleOligoUnits(tx, actor);
  if (units !== "ALL" && !units.length) return [];
  return (
    await tx.query(
      `SELECT c.id, c.port_no, c.role, c.installed_at, c.removed_at, c.volume_start::float AS volume_start, c.volume_left::float AS volume_left, c.actual_qty::float AS actual_qty,
              c.booked_qty::float AS booked_qty, c.ratio::float AS ratio, c.rule_qty_before::float AS rule_qty_before, c.suggested_qty::float AS suggested_qty, c.applied, c.notes,
              a.code AS synthesizer_code, l.code AS lot_code, i.code AS item_code, i.base_uom, r.uom AS rule_uom, d.code AS adjustment_code
         FROM oligo.bottle_calibration c JOIN asset.asset a ON a.id = c.synthesizer_id JOIN inv.lot l ON l.id = c.lot_id JOIN master.item i ON i.id = l.item_id
         LEFT JOIN oligo.reagent_rule r ON r.role = c.role LEFT JOIN inv.stock_document d ON d.id = c.adjustment_document_id
        WHERE $1::uuid[] IS NULL OR a.owner_org_unit_id = ANY($1::uuid[])
        ORDER BY c.removed_at DESC LIMIT 200`,
      [units === "ALL" ? null : units]
    )
  ).rows;
}

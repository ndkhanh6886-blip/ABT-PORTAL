import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, hasFactoryPermission, type AuthzActor } from "../core/authz";
import { vnToday } from "../core/dates";
import { conflict, invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { parseInput } from "../core/records";
import { runTransition } from "../core/stateMachine";
import { createStockDocument, stockDocumentMachine } from "../inv/documents";
import { lotMachine } from "../inv/lots";
import { releaseDemandReservations, reserve } from "../inv/reservations";
import { getItem, toBaseQty } from "../master/service";
import { getFormula, prepare } from "./service";

const DEMAND = "PREPARATION" as const;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

const orderSchema = z.object({
  formula_id: z.string().uuid(),
  qty: z.coerce.number().positive("lượng pha phải lớn hơn 0"),
  uom: z.string().min(1),
  warehouse_id: z.string().uuid("chọn kho"),
  to_location_id: z.string().uuid().optional().nullable(),
  planned_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "chọn ngày pha"),
  notes: z.string().trim().max(1000).optional().nullable(),
});

/**
 * A preparation order waiting to be made (as OligoFlow's "Lệnh pha chế chờ thực hiện"): the ingredients are
 * reserved at once (FEFO, released and unexpired), so nothing else takes them before the preparation.
 */
export async function createPrepOrder(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(orderSchema, input);
  const wh = (await tx.query("SELECT id, owner_org_unit_id FROM master.warehouse WHERE id = $1 AND status = 'ACTIVE'", [d.warehouse_id])).rows[0];
  if (!wh) throw notFound("kho");
  await authorize(tx, actor, "prep.execute", wh.owner_org_unit_id);
  const f = await getFormula(tx, d.formula_id);
  if (f.status !== "ACTIVE") throw invalid(`Công thức ${f.code} đang ngừng dùng.`);
  const out = await getItem(tx, f.output_item_id);
  const factor = (await toBaseQty(tx, out, d.qty, d.uom)) / (await toBaseQty(tx, out, Number(f.basis_qty), f.basis_uom));
  const code = await nextNumber(tx, "PREP_ORDER");
  const o = (
    await tx.query(
      `INSERT INTO prep.prep_order (code, formula_id, qty, uom, warehouse_id, to_location_id, planned_date, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING *`,
      [code, f.id, d.qty, d.uom, wh.id, d.to_location_id ?? null, d.planned_date, d.notes ?? null, actor.userId]
    )
  ).rows[0];
  for (const l of f.lines) {
    const item = await getItem(tx, l.item_id);
    await reserve(tx, actor, { item_id: item.id, qty_base: round6((await toBaseQty(tx, item, Number(l.qty), l.uom)) * factor), warehouse_ids: [wh.id], demand_entity_type: DEMAND, demand_entity_id: o.id });
  }
  await writeAudit(tx, actor, { entityType: "prep_order", entityId: o.id, action: "create", changes: { code: [null, code], formula: [null, f.code], qty: [null, `${d.qty} ${d.uom}`] } });
  return o;
}

async function lockOrder(tx: Tx, actor: AuthzActor, id: string) {
  const o = (await tx.query("SELECT o.*, w.owner_org_unit_id FROM prep.prep_order o JOIN master.warehouse w ON w.id = o.warehouse_id WHERE o.id = $1 FOR UPDATE OF o", [id])).rows[0];
  if (!o) throw notFound("lệnh pha");
  await authorize(tx, actor, "prep.execute", o.owner_org_unit_id);
  if (o.status !== "PLANNED") throw conflict("Lệnh pha đã thực hiện hoặc đã hủy.", "ORDER_CLOSED");
  return o;
}

/** Makes the order: its reservations are released and the preparation runs (same FEFO choice, now consumed). */
export async function executePrepOrder(tx: Tx, actor: AuthzActor, id: string, input: unknown) {
  const extra = parseInput(z.object({ to_location_id: z.string().uuid().optional().nullable(), notes: z.string().trim().max(1000).optional().nullable() }), input ?? {});
  const o = await lockOrder(tx, actor, id);
  await releaseDemandReservations(tx, actor, DEMAND, o.id, `Thực hiện lệnh pha ${o.code}`);
  const prep = await prepare(tx, actor, {
    formula_id: o.formula_id, qty: Number(o.qty), uom: o.uom, warehouse_id: o.warehouse_id,
    to_location_id: extra.to_location_id ?? o.to_location_id, notes: [o.notes, extra.notes, `Lệnh ${o.code}`].filter(Boolean).join(" · "),
  });
  await tx.query("UPDATE prep.prep_order SET status = 'DONE', preparation_id = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1", [o.id, prep.id, actor.userId]);
  await writeAudit(tx, actor, { entityType: "prep_order", entityId: o.id, action: "execute", changes: { status: ["PLANNED", "DONE"], preparation: [null, prep.code] } });
  return prep;
}

export async function cancelPrepOrder(tx: Tx, actor: AuthzActor, id: string, reasonInput: unknown) {
  const reason = parseInput(z.string().trim().min(3, "nhập lý do hủy"), reasonInput);
  const o = await lockOrder(tx, actor, id);
  await releaseDemandReservations(tx, actor, DEMAND, o.id, `Hủy lệnh pha ${o.code}`);
  await tx.query("UPDATE prep.prep_order SET status = 'CANCELLED', cancel_reason = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1", [o.id, reason, actor.userId]);
  await writeAudit(tx, actor, { entityType: "prep_order", entityId: o.id, action: "cancel", changes: { status: ["PLANNED", "CANCELLED"] }, reason });
}

export async function listPrepOrders(tx: Tx, actor: AuthzActor) {
  const rows = (
    await tx.query(
      `SELECT o.id, o.code, o.status, o.qty::float AS qty, o.uom, o.planned_date, o.notes, o.cancel_reason, o.created_at, w.owner_org_unit_id, w.code AS warehouse_code,
              f.code AS formula_code, f.name AS formula_name, u.display_name AS created_by_name, p.code AS preparation_code,
              (SELECT json_agg(json_build_object('item_code', i.code, 'lot_code', l.code, 'qty', (r.qty_base - r.qty_consumed)::float, 'uom', i.base_uom) ORDER BY i.code)
                 FROM inv.reservation r JOIN master.item i ON i.id = r.item_id LEFT JOIN inv.lot l ON l.id = r.lot_id
                WHERE r.demand_entity_type = 'PREPARATION' AND r.demand_entity_id = o.id AND r.status = 'ACTIVE') AS reserved
         FROM prep.prep_order o JOIN prep.formula f ON f.id = o.formula_id JOIN master.warehouse w ON w.id = o.warehouse_id
         LEFT JOIN core.user_profile u ON u.user_id = o.created_by LEFT JOIN prep.preparation p ON p.id = o.preparation_id
        ORDER BY CASE o.status WHEN 'PLANNED' THEN 0 ELSE 1 END, o.planned_date, o.code LIMIT 300`
    )
  ).rows;
  const out = [];
  for (const r of rows) if (await hasFactoryPermission(tx, actor, "prep.execute", r.owner_org_unit_id)) out.push(r);
  return out;
}

/**
 * Incubation done ("Ủ xong"): not before the date. Without QC the lot is released and put away on the chosen
 * location; with QC it stays in quarantine for QA/QC to sample.
 */
export async function finishIncubation(tx: Tx, actor: AuthzActor, prepId: string, input: unknown) {
  const d = parseInput(z.object({ to_location_id: z.string().uuid().optional().nullable() }), input ?? {});
  const p = (await tx.query("SELECT p.*, w.owner_org_unit_id FROM prep.preparation p JOIN master.warehouse w ON w.id = p.warehouse_id WHERE p.id = $1 FOR UPDATE OF p", [prepId])).rows[0];
  if (!p) throw notFound("lệnh pha chế");
  await authorize(tx, actor, "prep.execute", p.owner_org_unit_id);
  if (p.status !== "DONE" || !p.incubation_until) throw invalid("Lô pha này không cần ủ.");
  if (p.incubated_at) throw invalid("Đã xác nhận ủ xong.");
  if (p.incubation_until > vnToday()) throw invalid(`Chưa đủ thời gian ủ (đến ${p.incubation_until}).`, undefined, "INCUBATING");
  const f = await getFormula(tx, p.formula_id);
  const item = await getItem(tx, f.output_item_id);
  const qcNeeded = f.requires_qc || item.receipt_qc_required;
  await tx.query("UPDATE prep.preparation SET incubated_at = now(), incubated_by = $2, version = version + 1 WHERE id = $1", [prepId, actor.userId]);
  if (!qcNeeded) {
    const target = d.to_location_id ?? p.to_location_id;
    const loc = target ? (await tx.query("SELECT warehouse_id, is_quarantine FROM master.location WHERE id = $1", [target])).rows[0] : null;
    if (!loc || loc.warehouse_id !== p.warehouse_id || loc.is_quarantine) throw invalid("Chọn vị trí cất (vị trí thường của kho).");
    const lot = (await tx.query("SELECT version FROM inv.lot WHERE id = $1", [p.lot_id])).rows[0];
    await runTransition(tx, lotMachine, actor, { id: p.lot_id, action: "skip_qc", expectedVersion: lot.version }, { trusted: true });
    const bal = (await tx.query("SELECT location_id, qty_on_hand::float AS q FROM inv.stock_balance WHERE lot_id = $1 AND qty_on_hand > 0", [p.lot_id])).rows;
    if (bal.length) {
      const doc = await createStockDocument(
        tx,
        actor,
        { doc_type: "TRANSFER", reason_code: "PUTAWAY", warehouse_id: p.warehouse_id, source_entity_type: "PREPARATION", source_entity_id: p.id, lines: bal.map((b) => ({ item_id: item.id, lot_id: p.lot_id, from_location_id: b.location_id, to_location_id: target, qty: b.q, uom: item.base_uom })) },
        { trusted: true }
      );
      await runTransition(tx, stockDocumentMachine, actor, { id: doc.id, action: "post", expectedVersion: doc.version }, { trusted: true });
    }
  }
  await writeAudit(tx, actor, { entityType: "preparation", entityId: prepId, action: "incubated", changes: { incubated: [false, true] } });
  return { qc_needed: qcNeeded };
}

/** One preparation with its formula, ingredients as used and the lot made — the printed preparation record. */
export async function getPreparation(tx: Tx, actor: AuthzActor, id: string) {
  const p = (
    await tx.query(
      `SELECT p.*, p.qty_out::float AS qty_out, f.code AS formula_code, f.name AS formula_name, f.instructions, f.requires_qc, f.incubation_days, f.shelf_life_days,
              i.code AS item_code, i.name AS item_name, l.code AS lot_code, l.expiry_date, l.mfg_date, l.status AS lot_status, w.code AS warehouse_code, w.owner_org_unit_id,
              u.display_name AS prepared_by_name, ib.display_name AS incubated_by_name
         FROM prep.preparation p JOIN prep.formula f ON f.id = p.formula_id JOIN master.item i ON i.id = f.output_item_id JOIN inv.lot l ON l.id = p.lot_id
         JOIN master.warehouse w ON w.id = p.warehouse_id LEFT JOIN core.user_profile u ON u.user_id = p.prepared_by LEFT JOIN core.user_profile ib ON ib.user_id = p.incubated_by
        WHERE p.id = $1`,
      [id]
    )
  ).rows[0];
  if (!p) throw notFound("lệnh pha chế");
  if (!(await hasFactoryPermission(tx, actor, "prep.execute", p.owner_org_unit_id)) && !(await hasFactoryPermission(tx, actor, "inv.stock.view", p.owner_org_unit_id))) throw notFound("lệnh pha chế");
  return p;
}

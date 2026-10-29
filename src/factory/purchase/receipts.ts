import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, SYSTEM_ACTOR, type AuthzActor } from "../core/authz";
import { vnToday } from "../core/dates";
import { invalid, notFound } from "../core/errors";
import { notifyUsers, usersWithPermission } from "../core/notifications";
import { nextNumber } from "../core/numbering";
import { parseInput } from "../core/records";
import { getNumberSetting } from "../core/settings";
import { runTransition } from "../core/stateMachine";
import { createStockDocument, stockDocumentMachine } from "../inv/documents";
import { createLot, lotMachine } from "../inv/lots";
import { poMachine } from "./orders";
import "./permissions";

const receiptSchema = z.object({
  po_id: z.string().uuid(),
  delivery_note_no: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  lines: z
    .array(
      z.object({
        po_line_id: z.string().uuid(),
        qty: z.coerce.number().positive("số lượng nhận phải lớn hơn 0"),
        mfr_lot_no: z.string().trim().max(100).optional().nullable(),
        mfg_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
        expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
        /** Serial-tracked items: one serial number per unit received. */
        serials: z.array(z.string().trim().min(1).max(100)).optional(),
        location_id: z.string().uuid().optional().nullable(),
      })
    )
    .min(1, "nhập ít nhất một dòng nhận")
    .max(200),
});

async function quarantineLocation(tx: Tx, warehouseId: string, requested?: string | null): Promise<string> {
  if (requested) {
    const loc = (await tx.query("SELECT warehouse_id, is_quarantine, status FROM master.location WHERE id = $1", [requested])).rows[0];
    if (!loc || loc.warehouse_id !== warehouseId || !loc.is_quarantine || loc.status !== "ACTIVE") {
      throw invalid("Hàng mua phải nhận vào một vị trí biệt trữ của kho nhận.");
    }
    return requested;
  }
  const loc = (await tx.query("SELECT id FROM master.location WHERE warehouse_id = $1 AND is_quarantine AND status = 'ACTIVE' ORDER BY code LIMIT 1", [warehouseId])).rows[0];
  if (!loc) {
    const wh = (await tx.query("SELECT code FROM master.warehouse WHERE id = $1", [warehouseId])).rows[0];
    throw invalid(`Kho ${wh?.code} chưa có vị trí biệt trữ. Trưởng kho cần tạo vị trí biệt trữ trước khi nhận hàng.`);
  }
  return loc.id;
}

/**
 * Receives (part of) an order: per line a new lot in QUARANTINE (supplier lot, expiry), one RECEIPT
 * stock document per receiving warehouse into a quarantine location, received quantities and order
 * status updated, QC notified. Over-receipt is refused beyond the configured tolerance.
 * The order row is locked, so two receipts on the same order are serialised.
 */
export async function postGoodsReceipt(tx: Tx, actor: AuthzActor, input: unknown) {
  const data = parseInput(receiptSchema, input);
  const po = (await tx.query("SELECT * FROM purchase.purchase_order WHERE id = $1 FOR UPDATE", [data.po_id])).rows[0];
  if (!po) throw notFound("đơn mua");
  if (!["ISSUED", "PARTIALLY_RECEIVED"].includes(po.status)) throw invalid("Chỉ nhận hàng cho đơn đã phát hành và chưa nhận đủ.");
  const tolerance = await getNumberSetting(tx, "purchase.receipt_over_tolerance_pct", 0);
  const today = vnToday();

  const code = await nextNumber(tx, "GOODS_RECEIPT");
  const gr = (
    await tx.query(
      `INSERT INTO purchase.goods_receipt (code, po_id, received_by, delivery_note_no, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $3, $3) RETURNING *`,
      [code, po.id, actor.userId, data.delivery_note_no ?? null, data.notes ?? null]
    )
  ).rows[0];

  const byWarehouse = new Map<string, { lines: any[]; grLineIds: string[] }>();
  const newLots: { id: string; code: string; item_code: string; qcRequired: boolean; owner: string }[] = [];
  for (const [idx, l] of data.lines.entries()) {
    const pol = (
      await tx.query(
        `SELECT pol.*, pol.qty_ordered::text AS ordered, pol.qty_received::text AS received, i.code AS item_code, i.tracking, i.receipt_qc_required,
                w.owner_org_unit_id
           FROM purchase.purchase_order_line pol JOIN master.item i ON i.id = pol.item_id JOIN master.warehouse w ON w.id = pol.target_warehouse_id
          WHERE pol.id = $1 AND pol.po_id = $2 FOR UPDATE OF pol`,
        [l.po_line_id, po.id]
      )
    ).rows[0];
    const n = idx + 1;
    if (!pol) throw invalid(`Dòng ${n}: không thuộc đơn mua này.`);
    await authorize(tx, actor, "purchase.receipt.post", pol.owner_org_unit_id);
    const limit = Number(pol.ordered) * (1 + tolerance / 100);
    if (Number(pol.received) + l.qty > limit + 1e-9) {
      throw invalid(`Dòng ${n} (${pol.item_code}): nhận vượt số lượng đặt (đặt ${Number(pol.ordered)}, đã nhận ${Number(pol.received)}, dung sai ${tolerance}%).`, undefined, "OVER_RECEIPT");
    }
    if (l.expiry_date && l.expiry_date < today) throw invalid(`Dòng ${n} (${pol.item_code}): hàng đã hết hạn (${l.expiry_date}), không nhận.`);
    const location = await quarantineLocation(tx, pol.target_warehouse_id, l.location_id);

    // one lot per receipt line; serial items: one lot per serial number
    const units: { lotCode?: string; qty: number }[] =
      pol.tracking === "SERIAL"
        ? (() => {
            if (!Number.isInteger(l.qty) || (l.serials?.length ?? 0) !== l.qty || new Set(l.serials).size !== l.qty) {
              throw invalid(`Dòng ${n} (${pol.item_code}): nhập đủ ${l.qty} số serial, không trùng nhau.`);
            }
            return l.serials!.map((s) => ({ lotCode: s.toUpperCase(), qty: 1 }));
          })()
        : [{ qty: l.qty }];

    for (const u of units) {
      let lotId: string | null = null;
      if (pol.tracking !== "NONE") {
        const lot = await createLot(tx, actor, {
          item_id: pol.item_id,
          origin: "PURCHASE",
          code: u.lotCode,
          mfr_lot_no: l.mfr_lot_no ?? (pol.tracking === "SERIAL" ? u.lotCode : null),
          supplier_id: po.supplier_id,
          mfg_date: l.mfg_date ?? null,
          expiry_date: l.expiry_date ?? null,
          origin_entity_type: "GOODS_RECEIPT",
          origin_entity_id: gr.id,
        });
        lotId = lot.id;
        newLots.push({ id: lot.id, code: lot.code, item_code: pol.item_code, qcRequired: pol.receipt_qc_required, owner: pol.owner_org_unit_id });
      }
      const grl = (
        await tx.query(
          `INSERT INTO purchase.goods_receipt_line (receipt_id, po_line_id, item_id, qty, uom, mfr_lot_no, mfg_date, expiry_date, lot_id, location_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [gr.id, pol.id, pol.item_id, u.qty, pol.uom, l.mfr_lot_no ?? null, l.mfg_date ?? null, l.expiry_date ?? null, lotId, location]
        )
      ).rows[0];
      const bucket = byWarehouse.get(pol.target_warehouse_id) ?? { lines: [], grLineIds: [] };
      bucket.lines.push({ item_id: pol.item_id, lot_id: lotId, to_location_id: location, qty: u.qty, uom: pol.uom, unit_cost: Number(pol.unit_price) });
      bucket.grLineIds.push(grl.id);
      byWarehouse.set(pol.target_warehouse_id, bucket);
    }
    await tx.query("UPDATE purchase.purchase_order_line SET qty_received = qty_received + $2 WHERE id = $1", [pol.id, l.qty]);
  }

  for (const [warehouseId, bucket] of [...byWarehouse.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const doc = await createStockDocument(
      tx,
      actor,
      { doc_type: "RECEIPT", reason_code: "PURCHASE", warehouse_id: warehouseId, source_entity_type: "GOODS_RECEIPT", source_entity_id: gr.id, lines: bucket.lines },
      { trusted: true }
    );
    await runTransition(tx, stockDocumentMachine, actor, { id: doc.id, action: "post", expectedVersion: doc.version }, { trusted: true });
    await tx.query("UPDATE purchase.goods_receipt_line SET stock_document_id = $2 WHERE id = ANY($1::uuid[])", [bucket.grLineIds, doc.id]);
  }

  // Items that need no receiving QC are released at once (they stay in quarantine until put away).
  for (const lot of newLots.filter((x) => !x.qcRequired)) {
    await runTransition(tx, lotMachine, SYSTEM_ACTOR, { id: lot.id, action: "skip_qc", expectedVersion: 0 });
  }

  const fully = (await tx.query("SELECT bool_and(qty_received >= qty_ordered) AS done FROM purchase.purchase_order_line WHERE po_id = $1", [po.id])).rows[0].done;
  const action = fully ? "mark_received" : po.status === "ISSUED" ? "mark_partial" : null;
  if (action) await runTransition(tx, poMachine, actor, { id: po.id, action, expectedVersion: po.version }, { trusted: true });

  await writeAudit(tx, actor, { entityType: "goods_receipt", entityId: gr.id, action: "create", changes: { code: [null, code], po: [null, po.code], lots: [null, newLots.map((x) => x.code)] } });
  const pending = newLots.filter((x) => x.qcRequired);
  for (const owner of [...new Set(pending.map((x) => x.owner))]) {
    await notifyUsers(tx, await usersWithPermission(tx, "inv.lot.sample", owner), {
      type: "IQC_PENDING",
      title: `Hàng mới về chờ kiểm tra đầu vào (${code})`,
      body: pending.filter((x) => x.owner === owner).map((x) => `${x.code} · ${x.item_code}`).join(", "),
      entityType: "goods_receipt",
      entityId: gr.id,
      link: "/?tab=factory-qa",
      sourceKey: `iqc:${gr.id}:${owner}`,
    });
  }
  return { ...gr, lots: newLots.map(({ id, code: c, item_code, qcRequired }) => ({ id, code: c, item_code, qc_required: qcRequired })) };
}

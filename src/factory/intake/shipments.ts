import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { saveAttachment } from "../core/files";
import { authorize, type AuthzActor } from "../core/authz";
import { invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { enqueueEvent } from "../core/outbox";
import { parseInput } from "../core/records";
import { runTransition } from "../core/stateMachine";
import { createStockDocument, stockDocumentMachine } from "../inv/documents";
import { orderMachine } from "./orders";

const shipmentSchema = z.object({
  order_id: z.string().uuid(),
  warehouse_id: z.string().uuid("chọn kho xuất"),
  notes: z.string().trim().max(1000).optional().nullable(),
  lines: z
    .array(
      z.object({
        order_line_id: z.string().uuid(),
        lot_id: z.string().uuid().optional().nullable(),
        from_location_id: z.string().uuid(),
        qty: z.coerce.number().positive("số lượng giao phải lớn hơn 0"),
      })
    )
    .min(1, "chọn ít nhất một dòng giao")
    .max(200),
});

/** Re-derives the order status from delivered quantities and acknowledged shipments (never set by hand). */
export async function syncOrderStatus(tx: Tx, actor: AuthzActor, orderId: string): Promise<void> {
  const o = (
    await tx.query(
      `SELECT o.id, o.status, o.version,
              bool_and(l.qty_delivered >= l.qty) AS full, bool_or(l.qty_delivered > 0) AS any,
              (SELECT bool_and(s.status = 'ACKNOWLEDGED') FROM intake.shipment s WHERE s.order_id = o.id) AS all_ack
         FROM intake.internal_order o JOIN intake.internal_order_line l ON l.order_id = o.id
        WHERE o.id = $1 GROUP BY o.id`,
      [orderId]
    )
  ).rows[0];
  const go = async (action: string) => {
    const cur = (await tx.query("SELECT version FROM intake.internal_order WHERE id = $1", [orderId])).rows[0];
    await runTransition(tx, orderMachine, actor, { id: orderId, action, expectedVersion: cur.version }, { trusted: true });
  };
  if (o.full && o.status !== "DELIVERED" && o.status !== "CLOSED") await go("mark_delivered");
  else if (!o.full && o.any && ["ACCEPTED", "IN_PRODUCTION", "READY"].includes(o.status)) await go("mark_partial");
  const now = (await tx.query("SELECT status FROM intake.internal_order WHERE id = $1", [orderId])).rows[0].status;
  if (now === "DELIVERED" && o.all_ack) await go("close");
}

/**
 * Ships (part of) an internal order from the department's own warehouse: only released, unexpired lots
 * (checked by the stock ledger), never more than ordered. The issue is posted at once and Kinh doanh
 * receives a FactoryShipmentPosted event with lot, expiry and transfer price per line.
 */
export async function postShipment(tx: Tx, actor: AuthzActor, input: unknown) {
  const data = parseInput(shipmentSchema, input);
  const order = (await tx.query("SELECT * FROM intake.internal_order WHERE id = $1 FOR UPDATE", [data.order_id])).rows[0];
  if (!order) throw notFound("đơn nội bộ");
  await authorize(tx, actor, "intake.shipment.post", order.org_unit_id);
  if (!["ACCEPTED", "IN_PRODUCTION", "READY", "PARTIALLY_DELIVERED"].includes(order.status)) throw invalid("Chỉ giao hàng cho đơn đã nhận và chưa giao đủ.");
  const wh = (await tx.query("SELECT owner_org_unit_id FROM master.warehouse WHERE id = $1 AND status = 'ACTIVE'", [data.warehouse_id])).rows[0];
  if (!wh || wh.owner_org_unit_id !== order.org_unit_id) throw invalid("Chỉ xuất giao từ kho của phòng sản xuất đơn này.");

  const code = await nextNumber(tx, "DELIVERY_NOTE");
  const shipment = (
    await tx.query(
      "INSERT INTO intake.shipment (code, order_id, warehouse_id, ship_mode, notes, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING *",
      [code, order.id, data.warehouse_id, order.ship_mode, data.notes ?? null, actor.userId]
    )
  ).rows[0];

  const stockLines: any[] = [];
  const eventLines: any[] = [];
  for (const [i, l] of data.lines.entries()) {
    const ol = (
      await tx.query(
        `SELECT l.*, l.qty::text AS ordered, l.qty_delivered::text AS delivered, i.base_uom, i.code AS item_code, i.kd_unit_factor::text AS factor
           FROM intake.internal_order_line l JOIN master.item i ON i.id = l.item_id WHERE l.id = $1 AND l.order_id = $2 FOR UPDATE OF l`,
        [l.order_line_id, order.id]
      )
    ).rows[0];
    if (!ol) throw invalid(`Dòng ${i + 1}: không thuộc đơn này.`);
    if (Number(ol.delivered) + l.qty > Number(ol.ordered) + 1e-9) {
      throw invalid(`Dòng ${i + 1} (${ol.kd_item_code}): giao vượt số lượng đặt (đặt ${Number(ol.ordered)}, đã giao ${Number(ol.delivered)}).`, undefined, "OVER_DELIVERY");
    }
    const lot = l.lot_id ? (await tx.query("SELECT code, expiry_date, mfg_date, item_id FROM inv.lot WHERE id = $1", [l.lot_id])).rows[0] : null;
    if (l.lot_id && (!lot || lot.item_id !== ol.item_id)) throw invalid(`Dòng ${i + 1}: lô không thuộc mã hàng ${ol.item_code}.`);
    await tx.query("UPDATE intake.internal_order_line SET qty_delivered = qty_delivered + $2 WHERE id = $1", [ol.id, l.qty]);
    await tx.query(
      "INSERT INTO intake.shipment_line (shipment_id, order_line_id, item_id, lot_id, from_location_id, qty) VALUES ($1, $2, $3, $4, $5, $6)",
      [shipment.id, ol.id, ol.item_id, l.lot_id ?? null, l.from_location_id, l.qty]
    );
    stockLines.push({ item_id: ol.item_id, lot_id: l.lot_id ?? null, from_location_id: l.from_location_id, qty: Math.round(l.qty * Number(ol.factor) * 1e6) / 1e6, uom: ol.base_uom });
    eventLines.push({
      line_index: ol.kd_line_index,
      product_code: ol.kd_item_code,
      product_name: ol.kd_item_name,
      unit: ol.kd_unit,
      quantity: l.qty,
      unit_price: Number(ol.transfer_price),
      lot_number: lot?.code ?? null,
      expiry_date: lot?.expiry_date ?? null,
      manufacture_date: lot?.mfg_date ?? null,
    });
  }

  const doc = await createStockDocument(
    tx,
    actor,
    { doc_type: "ISSUE", reason_code: "DELIVERY", warehouse_id: data.warehouse_id, source_entity_type: "SHIPMENT", source_entity_id: shipment.id, lines: stockLines },
    { trusted: true }
  );
  await runTransition(tx, stockDocumentMachine, actor, { id: doc.id, action: "post", expectedVersion: doc.version }, { trusted: true });
  await tx.query("UPDATE intake.shipment SET stock_document_id = $2 WHERE id = $1", [shipment.id, doc.id]);
  await syncOrderStatus(tx, actor, order.id);
  await enqueueEvent(
    tx,
    "FactoryShipmentPosted",
    { shipment_id: shipment.id, shipment_code: code, kd_po_code: order.kd_po_code, ship_mode: order.ship_mode, ship_to: order.ship_to, lines: eventLines },
    "KD"
  );
  await writeAudit(tx, actor, { entityType: "shipment", entityId: shipment.id, action: "post", changes: { code: [null, code], order: [null, order.code] } });
  return shipment;
}

/** Drop ship: the goods reached the end customer; the signed hand-over record is mandatory. */
export async function markDropShipDelivered(tx: Tx, actor: AuthzActor, shipmentId: string, input: unknown) {
  const { attachment_id } = parseInput(z.object({ attachment_id: z.string().uuid("tải lên biên bản giao nhận có chữ ký khách") }), input);
  const s = (await tx.query("SELECT s.*, o.org_unit_id, o.kd_po_code FROM intake.shipment s JOIN intake.internal_order o ON o.id = s.order_id WHERE s.id = $1 FOR UPDATE OF s", [shipmentId])).rows[0];
  if (!s) throw notFound("phiếu giao");
  await authorize(tx, actor, "intake.shipment.post", s.org_unit_id);
  if (s.ship_mode !== "DROP_SHIP" || s.status !== "POSTED") throw invalid("Chỉ phiếu giao thẳng vừa xuất mới xác nhận đã giao khách.");
  const att = (await tx.query("SELECT category, file_name FROM core.attachment WHERE id = $1 AND entity_type = 'shipment' AND entity_id = $2 AND voided_at IS NULL", [attachment_id, shipmentId])).rows[0];
  if (!att || att.category !== "SIGNED_RECORD") throw invalid("Biên bản phải là file loại 'biên bản có chữ ký' đính kèm vào phiếu giao này.");
  await tx.query(
    "UPDATE intake.shipment SET status = 'DELIVERED', proof_attachment_id = $2, delivered_at = now(), version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1",
    [shipmentId, attachment_id, actor.userId]
  );
  await writeAudit(tx, actor, { entityType: "shipment", entityId: shipmentId, action: "deliver", changes: { status: ["POSTED", "DELIVERED"], proof: [null, att.file_name] } });
  await enqueueEvent(tx, "FactoryShipmentDelivered", { shipment_id: shipmentId, kd_po_code: s.kd_po_code, proof_file_name: att.file_name }, "KD");
}

/** Drop ship hand-over: the signed record is stored (checksummed) and the shipment marked delivered, together. */
export async function deliverDropShipWithProof(tx: Tx, actor: AuthzActor, shipmentId: string, file: { fileName: string; mimeType: string; data: Buffer }) {
  const s = (await tx.query("SELECT o.org_unit_id FROM intake.shipment s JOIN intake.internal_order o ON o.id = s.order_id WHERE s.id = $1", [shipmentId])).rows[0];
  if (!s) throw notFound("phiếu giao");
  await authorize(tx, actor, "intake.shipment.post", s.org_unit_id);
  const att = await saveAttachment(tx, actor, { entityType: "shipment", entityId: shipmentId, category: "SIGNED_RECORD", ...file });
  await markDropShipDelivered(tx, actor, shipmentId, { attachment_id: att.id });
}

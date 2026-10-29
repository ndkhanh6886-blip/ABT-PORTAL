import { z } from "zod";
import { withTransaction, type Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { SYSTEM_ACTOR } from "../core/authz";
import { notifyUsers, usersWithPermission } from "../core/notifications";
import { nextNumber } from "../core/numbering";
import { runTransition } from "../core/stateMachine";
import type { BridgeEvent } from "./gateway";
import { notifyNewOrder, orderMachine } from "./orders";
import { syncOrderStatus } from "./shipments";

const FACTORY_UNITS = ["KIT", "OLIGO", "DEVICE"] as const;

const poIssued = z.object({
  kd_po_id: z.number().int(),
  kd_po_code: z.string().min(1),
  factory_unit: z.enum(FACTORY_UNITS),
  ship_mode: z.enum(["TO_KD", "DROP_SHIP"]),
  ship_to: z.record(z.unknown()).nullable().optional(),
  kd_so_code: z.string().nullable().optional(),
  requested_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().nullable().optional(),
  lines: z
    .array(
      z.object({
        line_index: z.number().int().min(0),
        product_code: z.string().min(1),
        product_name: z.string().nullable().optional(),
        unit: z.string().nullable().optional(),
        quantity: z.number().positive(),
        unit_price: z.number().min(0),
      })
    )
    .min(1),
});

async function receivePo(tx: Tx, payload: unknown): Promise<void> {
  const p = poIssued.parse(payload);
  if ((await tx.query("SELECT 1 FROM intake.internal_order WHERE kd_po_code = $1", [p.kd_po_code])).rowCount) return; // already received
  const unit = (
    await tx.query("SELECT id FROM core.org_unit WHERE module_key = $1 AND unit_type = 'DEPARTMENT' AND status = 'ACTIVE' ORDER BY created_at LIMIT 1", [p.factory_unit])
  ).rows[0];
  // thrown → the message is retried later, once the department exists in Cơ cấu tổ chức
  if (!unit) throw new Error(`Chưa có phòng ban phân hệ ${p.factory_unit} trong Cơ cấu tổ chức nhà máy`);
  const code = await nextNumber(tx, "INTERNAL_ORDER");
  const order = (
    await tx.query(
      `INSERT INTO intake.internal_order (code, kd_po_id, kd_po_code, org_unit_id, ship_mode, ship_to, kd_so_code, requested_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [code, p.kd_po_id, p.kd_po_code, unit.id, p.ship_mode, p.ship_to ? JSON.stringify(p.ship_to) : null, p.kd_so_code ?? null, p.requested_date ?? null, p.notes ?? null]
    )
  ).rows[0];
  let n = 0;
  for (const l of p.lines) {
    const item = (await tx.query("SELECT id FROM master.item WHERE kd_item_code = $1 AND status = 'ACTIVE'", [l.product_code])).rows[0];
    await tx.query(
      `INSERT INTO intake.internal_order_line (order_id, line_no, kd_line_index, kd_item_code, kd_item_name, kd_unit, item_id, qty, transfer_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [order.id, ++n, l.line_index, l.product_code, l.product_name ?? null, l.unit ?? null, item?.id ?? null, l.quantity, l.unit_price]
    );
  }
  await writeAudit(tx, SYSTEM_ACTOR, { entityType: "internal_order", entityId: order.id, action: "receive", changes: { kd_po_code: [null, p.kd_po_code], lines: [null, p.lines.length] } });
  await notifyNewOrder(tx, order);
}

async function cancelPo(tx: Tx, payload: any): Promise<void> {
  const o = (await tx.query("SELECT id, status, version, org_unit_id, code FROM intake.internal_order WHERE kd_po_code = $1 FOR UPDATE", [payload.kd_po_code])).rows[0];
  if (!o || ["CANCELLED", "REJECTED", "CLOSED"].includes(o.status)) return;
  try {
    await runTransition(tx, orderMachine, SYSTEM_ACTOR, { id: o.id, action: "cancel", expectedVersion: o.version, reason: `Kinh doanh hủy PO: ${payload.reason ?? ""}` });
  } catch {
    // already shipped or in delivery: the department must settle it with Kinh doanh
    await notifyUsers(tx, await usersWithPermission(tx, "intake.order.accept", o.org_unit_id), {
      type: "INTERNAL_ORDER_CANCEL_CONFLICT",
      title: `Kinh doanh hủy PO ${payload.kd_po_code} nhưng đơn ${o.code} đã giao hàng`,
      entityType: "internal_order",
      entityId: o.id,
      sourceKey: `cancel:${o.id}`,
    });
  }
}

async function acknowledgeShipment(tx: Tx, payload: any): Promise<void> {
  const s = (await tx.query("SELECT id, order_id, status FROM intake.shipment WHERE id = $1 FOR UPDATE", [payload.shipment_id])).rows[0];
  if (!s || s.status === "ACKNOWLEDGED") return;
  await tx.query(
    "UPDATE intake.shipment SET status = 'ACKNOWLEDGED', kd_acknowledged_at = now(), kd_inbound_code = $2, version = version + 1, updated_at = now() WHERE id = $1",
    [s.id, payload.inbound_code ?? null]
  );
  await writeAudit(tx, SYSTEM_ACTOR, { entityType: "shipment", entityId: s.id, action: "kd_acknowledge", changes: { status: [s.status, "ACKNOWLEDGED"], inbound: [null, payload.inbound_code ?? null] } });
  await syncOrderStatus(tx, SYSTEM_ACTOR, s.order_id);
}

/**
 * Entry point for messages from Kinh doanh. Runs in its own transaction; the event id is recorded in
 * core.inbox_event in that same transaction, so a redelivered message has no second effect.
 */
export async function handleKdEvent(event: BridgeEvent): Promise<"processed" | "duplicate"> {
  return withTransaction(async (tx) => {
    const fresh = await tx.query("INSERT INTO core.inbox_event (event_id, source, event_type) VALUES ($1, 'KD', $2) ON CONFLICT DO NOTHING RETURNING event_id", [
      event.event_id,
      event.event_type,
    ]);
    if (!fresh.rowCount) return "duplicate";
    if (event.event_type === "KdPoIssued") await receivePo(tx, event.payload);
    else if (event.event_type === "KdPoCancelled") await cancelPo(tx, event.payload);
    else if (event.event_type === "KdShipmentAcknowledged") await acknowledgeShipment(tx, event.payload);
    else throw new Error(`Loại sự kiện không hỗ trợ: ${event.event_type}`);
    return "processed";
  });
}


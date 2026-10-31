import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, hasFactoryPermission, type AuthzActor } from "../core/authz";
import { vnToday } from "../core/dates";
import { invalid, notFound } from "../core/errors";
import { notifyUsers, usersWithPermission } from "../core/notifications";
import { enqueueEvent } from "../core/outbox";
import { parseInput } from "../core/records";
import { defineMachine, type GuardContext } from "../core/stateMachine";
import { z } from "zod";
import "./gateway";

export type OrderStatus = "RECEIVED" | "ACCEPTED" | "IN_PRODUCTION" | "READY" | "PARTIALLY_DELIVERED" | "DELIVERED" | "CLOSED" | "REJECTED" | "CANCELLED";
export interface InternalOrder {
  id: string;
  code: string;
  kd_po_code: string;
  org_unit_id: string;
  ship_mode: "TO_KD" | "DROP_SHIP";
  committed_date: string | null;
  status: OrderStatus;
  version: number;
}

/** Every status change is reported to Kinh doanh, so the PO there always shows the factory's progress. */
const reportProgress = async ({ tx, updated }: GuardContext<InternalOrder> & { updated: InternalOrder }) => {
  await enqueueEvent(tx, "FactoryOrderProgress", { kd_po_code: updated.kd_po_code, order_code: updated.code, status: updated.status, committed_date: updated.committed_date }, "KD");
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const orderMachine = defineMachine<OrderStatus, InternalOrder>({
  entityType: "internal_order",
  table: "intake.internal_order",
  states: ["RECEIVED", "ACCEPTED", "IN_PRODUCTION", "READY", "PARTIALLY_DELIVERED", "DELIVERED", "CLOSED", "REJECTED", "CANCELLED"],
  terminal: ["CLOSED", "REJECTED", "CANCELLED"],
  scopeOf: (row) => row.org_unit_id,
  transitions: [
    {
      action: "accept",
      from: "RECEIVED",
      to: "ACCEPTED",
      permission: "intake.order.accept",
      signature: "APPROVED",
      guards: [
        {
          code: "UNMAPPED",
          message: "Còn mã hàng Kinh doanh chưa gắn với mã vật tư nhà máy (Danh mục vật tư → Mã hàng KD).",
          check: async ({ tx, row }) => !(await tx.query("SELECT 1 FROM intake.internal_order_line WHERE order_id = $1 AND item_id IS NULL", [row.id])).rowCount,
        },
        {
          code: "COMMITTED_DATE",
          message: "Nhập ngày giao cam kết (không trước hôm nay).",
          check: ({ payload }) => DATE.test(String(payload.committed_date ?? "")) && String(payload.committed_date) >= vnToday(),
        },
      ],
      patch: ({ payload }) => ({ committed_date: payload.committed_date, initial_committed_date: payload.committed_date }),
      effects: async ({ tx, updated }) => {
        await enqueueEvent(tx, "FactoryOrderAccepted", { kd_po_code: updated.kd_po_code, order_code: updated.code, committed_date: updated.committed_date }, "KD");
      },
    },
    {
      action: "reject",
      from: "RECEIVED",
      to: "REJECTED",
      permission: "intake.order.accept",
      reasonRequired: true,
      effects: async ({ tx, updated, reason }) => {
        await enqueueEvent(tx, "FactoryOrderRejected", { kd_po_code: updated.kd_po_code, order_code: updated.code, reason }, "KD");
      },
    },
    { action: "start_production", from: "ACCEPTED", to: "IN_PRODUCTION", permission: "intake.order.manage", effects: reportProgress },
    { action: "mark_ready", from: ["ACCEPTED", "IN_PRODUCTION"], to: "READY", permission: "intake.order.manage", effects: reportProgress },
    { action: "mark_partial", from: ["ACCEPTED", "IN_PRODUCTION", "READY"], to: "PARTIALLY_DELIVERED", permission: "intake.system", effects: reportProgress },
    { action: "mark_delivered", from: ["ACCEPTED", "IN_PRODUCTION", "READY", "PARTIALLY_DELIVERED"], to: "DELIVERED", permission: "intake.system", effects: reportProgress },
    { action: "close", from: "DELIVERED", to: "CLOSED", permission: "intake.system", effects: reportProgress },
    {
      action: "cancel",
      from: ["RECEIVED", "ACCEPTED", "IN_PRODUCTION", "READY"],
      to: "CANCELLED",
      permission: "intake.system",
      reasonRequired: true,
      guards: [
        {
          code: "SHIPPED",
          message: "Đơn đã có phiếu giao hàng, không hủy được.",
          check: async ({ tx, row }) => !(await tx.query("SELECT 1 FROM intake.shipment WHERE order_id = $1 LIMIT 1", [row.id])).rowCount,
        },
      ],
    },
  ],
});

/** Moves the committed delivery date, keeping the first one and counting the changes; Kinh doanh is told. */
export async function changeCommittedDate(tx: Tx, actor: AuthzActor, id: string, input: unknown) {
  const data = parseInput(z.object({ committed_date: z.string().regex(DATE), reason: z.string().trim().min(3, "nhập lý do dời ngày"), version: z.number().int() }), input);
  const order = (await tx.query("SELECT * FROM intake.internal_order WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!order) throw notFound("đơn nội bộ");
  await authorize(tx, actor, "intake.order.manage", order.org_unit_id);
  if (!["ACCEPTED", "IN_PRODUCTION", "READY", "PARTIALLY_DELIVERED"].includes(order.status)) throw invalid("Chỉ dời ngày giao của đơn đang thực hiện.");
  if (order.version !== data.version) throw invalid("Đơn vừa được cập nhật. Tải lại rồi thực hiện lại.", undefined, "STALE_VERSION");
  if (data.committed_date < vnToday()) throw invalid("Ngày giao mới không được trước hôm nay.");
  const upd = (
    await tx.query(
      `UPDATE intake.internal_order SET committed_date = $2, due_date_change_count = due_date_change_count + 1, version = version + 1, updated_at = now(), updated_by = $3
        WHERE id = $1 RETURNING *`,
      [id, data.committed_date, actor.userId]
    )
  ).rows[0];
  await writeAudit(tx, actor, { entityType: "internal_order", entityId: id, action: "change_date", changes: { committed_date: [order.committed_date, data.committed_date] }, reason: data.reason });
  await enqueueEvent(tx, "FactoryOrderProgress", { kd_po_code: upd.kd_po_code, order_code: upd.code, status: upd.status, committed_date: upd.committed_date, date_change_reason: data.reason }, "KD");
  return upd;
}

/** Org units whose internal orders the actor may see. */
async function visibleUnits(tx: Tx, actor: AuthzActor): Promise<string[] | "ALL"> {
  if (await hasFactoryPermission(tx, actor, "intake.order.view")) return "ALL";
  const units = (await tx.query("SELECT id FROM core.org_unit WHERE module_key IN ('KIT', 'OLIGO', 'DEVICE')")).rows.map((r) => r.id as string);
  const out: string[] = [];
  for (const u of units) if (await hasFactoryPermission(tx, actor, "intake.order.view", u)) out.push(u);
  return out;
}

export async function listOrders(tx: Tx, actor: AuthzActor, status?: string) {
  const units = await visibleUnits(tx, actor);
  if (units !== "ALL" && !units.length) return [];
  return (
    await tx.query(
      `SELECT o.id, o.code, o.kd_po_code, o.kd_so_code, o.ship_mode, o.requested_date, o.committed_date, o.due_date_change_count, o.status, o.created_at,
              u.id AS org_unit_id, u.code AS org_unit_code, u.name AS org_unit_name, u.module_key,
              (SELECT count(*)::int FROM intake.internal_order_line l WHERE l.order_id = o.id) AS line_count,
              (SELECT string_agg(COALESCE(l.kd_item_code, '') || ' (' || l.qty::float || ' ' || COALESCE(l.kd_unit, 'ĐV') || ')', ', ' ORDER BY l.line_no)
                 FROM intake.internal_order_line l WHERE l.order_id = o.id) AS items_summary
         FROM intake.internal_order o JOIN core.org_unit u ON u.id = o.org_unit_id
        WHERE ($1::uuid[] IS NULL OR o.org_unit_id = ANY($1::uuid[])) AND ($2::text IS NULL OR o.status = $2)
        ORDER BY o.created_at DESC LIMIT 300`,
      [units === "ALL" ? null : units, status ?? null]
    )
  ).rows;
}

export async function getOrder(tx: Tx, actor: AuthzActor, id: string) {
  const order = (
    await tx.query(
      "SELECT o.*, u.code AS org_unit_code, u.name AS org_unit_name, u.module_key FROM intake.internal_order o JOIN core.org_unit u ON u.id = o.org_unit_id WHERE o.id = $1",
      [id]
    )
  ).rows[0];
  if (!order) throw notFound("đơn nội bộ");
  const units = await visibleUnits(tx, actor);
  if (units !== "ALL" && !units.includes(order.org_unit_id)) throw notFound("đơn nội bộ");
  const lines = (
    await tx.query(
      `SELECT l.id, l.line_no, l.kd_item_code, l.kd_item_name, l.kd_unit, l.item_id, i.code AS item_code, i.name AS item_name, i.base_uom, i.kd_unit_factor::text AS kd_unit_factor,
              l.qty::text AS qty, l.qty_delivered::text AS qty_delivered, l.transfer_price::text AS transfer_price,
              COALESCE((
                SELECT sum(b.qty_on_hand - b.qty_reserved)::float
                  FROM inv.stock_balance b
                  JOIN master.location loc ON loc.id = b.location_id
                  LEFT JOIN inv.lot lot ON lot.id = b.lot_id
                 WHERE b.item_id = l.item_id
                   AND loc.is_quarantine = false
                   AND COALESCE(lot.status, 'RELEASED') = 'RELEASED'
                   AND (b.qty_on_hand - b.qty_reserved) > 0
              ), 0) AS available_fg_qty,
              ARRAY(
                SELECT kpo.code || ' [' || kpo.status || ' · Lô: ' || COALESCE(kl.code, 'N/A') || ']'
                  FROM kit.production_order kpo
                  LEFT JOIN inv.lot kl ON kl.id = kpo.lot_id
                 WHERE kpo.internal_order_line_id = l.id
                 ORDER BY kpo.created_at DESC
              ) AS kit_order_lots,
              ARRAY(
                SELECT oo.code || ' [' || oo.status || ' · ' || (SELECT count(*)::int FROM oligo.oligo_sequence os WHERE os.order_id = oo.id) || ' chuỗi]'
                  FROM oligo.oligo_order oo
                 WHERE oo.internal_order_id = l.order_id
                 ORDER BY oo.created_at DESC
              ) AS oligo_order_codes,
              ARRAY(
                SELECT dpo.code || ' [' || dpo.status || ' · S/N: ' || COALESCE((SELECT string_agg(du.serial_no, ', ' ORDER BY du.serial_no) FROM device.device_unit du WHERE du.order_id = dpo.id), 'N/A') || ']'
                  FROM device.device_order dpo
                 WHERE dpo.internal_order_line_id = l.id
                 ORDER BY dpo.created_at DESC
              ) AS device_order_serials
         FROM intake.internal_order_line l LEFT JOIN master.item i ON i.id = l.item_id WHERE l.order_id = $1 ORDER BY l.line_no`,
      [id]
    )
  ).rows;
  const shipments = (
    await tx.query(
      `SELECT s.id, s.code, s.status, s.ship_mode, s.created_at, s.delivered_at, s.kd_acknowledged_at, s.kd_inbound_code, s.version, w.code AS warehouse_code
         FROM intake.shipment s LEFT JOIN master.warehouse w ON w.id = s.warehouse_id WHERE s.order_id = $1 ORDER BY s.created_at`,
      [id]
    )
  ).rows;
  return { ...order, lines, shipments };
}

/** Tells the producing department's heads that a new internal order arrived. */
export async function notifyNewOrder(tx: Tx, order: { id: string; code: string; kd_po_code: string; org_unit_id: string }) {
  await notifyUsers(tx, await usersWithPermission(tx, "intake.order.accept", order.org_unit_id), {
    type: "INTERNAL_ORDER_NEW",
    title: `Đơn nội bộ mới ${order.code} (PO ${order.kd_po_code})`,
    entityType: "internal_order",
    entityId: order.id,
    link: "/?tab=factory-orders",
    sourceKey: `order:${order.id}`,
  });
}

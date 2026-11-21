import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, hasFactoryPermission, type AuthzActor } from "../core/authz";
import { vnToday } from "../core/dates";
import { forbidden, invalid, notFound } from "../core/errors";
import { notifyUsers, usersWithPermission } from "../core/notifications";
import { nextNumber } from "../core/numbering";
import { enqueueEvent } from "../core/outbox";
import { parseInput } from "../core/records";
import { defineMachine, type GuardContext } from "../core/stateMachine";
import { z } from "zod/v3";
import { ensureInternalOrderLineKitSpecColumns } from "./kdEvents";
import { ensureDeviceTrialInspectionSchema } from "../device/assembly";
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

/** Moves the committed delivery date, keeping the first one and counting the changes; Kinh doanh and linked Oligo orders are told. */
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
  // Đồng bộ ngày giao sang các Đơn Oligo liên kết với Đơn nội bộ này
  await tx.query(
    `UPDATE oligo.oligo_order
        SET due_date = $2,
            due_date_change_count = due_date_change_count + 1,
            version = version + 1,
            updated_at = now(),
            updated_by = $3
      WHERE internal_order_id = $1`,
    [id, data.committed_date, actor.userId]
  );
  await writeAudit(tx, actor, { entityType: "internal_order", entityId: id, action: "change_date", changes: { committed_date: [order.committed_date, data.committed_date] }, reason: data.reason });
  await enqueueEvent(tx, "FactoryOrderProgress", { kd_po_code: upd.kd_po_code, order_code: upd.code, status: upd.status, committed_date: upd.committed_date, date_change_reason: data.reason }, "KD");
  return upd;
}

export async function updateInternalOrderNotes(tx: Tx, actor: AuthzActor, id: string, input: unknown) {
  const data = parseInput(z.object({ notes: z.string().trim().max(2000).nullable() }), input);
  const order = (await tx.query("SELECT * FROM intake.internal_order WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!order) throw notFound("đơn nội bộ");
  await authorize(tx, actor, "intake.order.view", order.org_unit_id);
  const upd = (
    await tx.query(
      `UPDATE intake.internal_order
          SET notes = $2, version = version + 1, updated_at = now(), updated_by = $3
        WHERE id = $1 RETURNING *`,
      [id, data.notes || null, actor.userId]
    )
  ).rows[0];
  await tx.query(
    `UPDATE oligo.oligo_order
        SET notes = COALESCE(NULLIF($2, ''), notes), updated_at = now()
      WHERE internal_order_id = $1`,
    [id, data.notes || null]
  );
  await writeAudit(tx, actor, {
    entityType: "internal_order",
    entityId: id,
    action: "update_notes",
    changes: { notes: [order.notes, data.notes || null] },
  });
  return upd;
}

/** Org units whose internal orders the actor may see. */
async function visibleUnits(tx: Tx, actor: AuthzActor): Promise<string[] | "ALL"> {
  if (actor.isRootAdmin || (await hasFactoryPermission(tx, actor, "intake.order.view"))) return "ALL";
  const units = (await tx.query("SELECT id FROM core.org_unit WHERE module_key IN ('KIT', 'OLIGO', 'DEVICE')")).rows.map((r) => r.id as string);
  const out: string[] = [];
  for (const u of units) if (await hasFactoryPermission(tx, actor, "intake.order.view", u)) out.push(u);
  return out;
}

export async function listOrders(tx: Tx, actor: AuthzActor, status?: string) {
  await ensureDeviceTrialInspectionSchema(tx);
  const units = await visibleUnits(tx, actor);
  if (units !== "ALL" && !units.length) return [];
  return (
    await tx.query(
      `SELECT o.id, o.code, o.kd_po_code, o.kd_so_code, o.ship_mode, o.requested_date, o.committed_date, o.initial_committed_date,
              o.due_date_change_count, o.notes, o.status, o.created_at,
              u.id AS org_unit_id, u.code AS org_unit_code, u.name AS org_unit_name, u.module_key,
              (SELECT count(*)::int FROM intake.internal_order_line l WHERE l.order_id = o.id) AS line_count,
              (SELECT string_agg(COALESCE(l.kd_item_code, '') || ' (' || l.qty::float || ' ' || COALESCE(l.kd_unit, 'ĐV') || ')', ', ' ORDER BY l.line_no)
                 FROM intake.internal_order_line l WHERE l.order_id = o.id) AS items_summary,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object('id', oo.id, 'code', oo.code, 'status', oo.status) ORDER BY oo.created_at DESC)
                  FROM oligo.oligo_order oo WHERE oo.internal_order_id = o.id
              ), '[]'::jsonb) AS linked_oligo_orders,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object('id', kpo.id, 'code', kpo.code, 'status', kpo.status) ORDER BY kpo.created_at DESC)
                  FROM kit.production_order kpo
                  JOIN intake.internal_order_line l ON l.id = kpo.internal_order_line_id
                 WHERE l.order_id = o.id
              ), '[]'::jsonb) AS linked_kit_orders,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object('id', dpo.id, 'code', dpo.code, 'status', dpo.status) ORDER BY dpo.created_at DESC)
                  FROM device.device_order dpo
                  JOIN intake.internal_order_line l ON l.id = dpo.internal_order_line_id
                 WHERE l.order_id = o.id
              ), '[]'::jsonb) AS linked_device_orders,
              COALESCE((
                SELECT jsonb_agg(to_jsonb(c) ORDER BY c.issued_at DESC)
                  FROM kit.coa_certificate c
                 WHERE c.superseded_by_id IS NULL
                   AND NOT EXISTS (SELECT 1 FROM kit.coa_certificate child WHERE child.amended_from_id = c.id)
                   AND (
                     EXISTS (
                       SELECT 1 FROM kit.production_order kpo
                       JOIN intake.internal_order_line l ON l.id = kpo.internal_order_line_id
                      WHERE l.order_id = o.id AND (c.production_order_id = kpo.id OR c.lot_id = kpo.lot_id)
                     )
                     OR EXISTS (
                       SELECT 1 FROM intake.shipment s
                       JOIN intake.shipment_line sl ON sl.shipment_id = s.id
                      WHERE s.order_id = o.id AND sl.lot_id = c.lot_id
                     )
                   )
              ), '[]'::jsonb) AS issued_kit_coas,
              COALESCE((
                SELECT jsonb_agg(
                         jsonb_build_object(
                           'test_id', t.id,
                           'test_code', t.code,
                           'overall_result', t.overall_result,
                           'serial_no', du.serial_no,
                           'model_code', dm.code,
                           'model_name', dm.name,
                           'revision_code', drev.revision,
                           'order_code', dpo.code,
                           'trial_nas_path', dtr.nas_path,
                           'trial_attachment_name', dtr.attachment_name,
                           'trial_attachment_data', dtr.attachment_data
                         )
                         ORDER BY du.serial_no ASC
                       )
                  FROM device.device_order dpo
                  JOIN intake.internal_order_line l ON l.id = dpo.internal_order_line_id
                  JOIN device.device_unit du ON du.order_id = dpo.id
                  JOIN device.device_model dm ON dm.id = du.model_id
                  LEFT JOIN device.model_revision drev ON drev.id = du.model_revision_id
                  JOIN qms.qc_test t ON t.entity_type = 'DEVICE_UNIT' AND t.entity_id = du.id AND t.status = 'REVIEWED' AND t.overall_result = 'PASS'
                  LEFT JOIN LATERAL (
                    SELECT br.nas_path, br.attachment_name, br.attachment_data
                      FROM device.burn_in_run br
                     WHERE br.unit_id = du.id
                     ORDER BY br.created_at DESC
                     LIMIT 1
                  ) dtr ON true
                 WHERE l.order_id = o.id
              ), '[]'::jsonb) AS device_fqc_coas
         FROM intake.internal_order o JOIN core.org_unit u ON u.id = o.org_unit_id
        WHERE ($1::uuid[] IS NULL OR o.org_unit_id = ANY($1::uuid[])) AND ($2::text IS NULL OR o.status = $2)
        ORDER BY o.created_at DESC LIMIT 300`,
      [units === "ALL" ? null : units, status ?? null]
    )
  ).rows;
}

export async function getOrder(tx: Tx, actor: AuthzActor, id: string) {
  await ensureInternalOrderLineKitSpecColumns(tx);
  await ensureDeviceTrialInspectionSchema(tx);
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
              l.supply_form, l.tube_code, l.accessory_set, l.specification, l.line_notes,
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
              ) AS device_order_serials,
              dm.id AS device_model_id,
              dm.code AS device_model_code,
              mr.revision AS device_model_revision,
              COALESCE((SELECT count(*)::int FROM device.model_bom_line bl WHERE bl.revision_id = dm.current_revision_id), 0) AS device_bom_count
         FROM intake.internal_order_line l
         LEFT JOIN master.item i ON i.id = l.item_id
         LEFT JOIN device.device_model dm
           ON (l.item_id IS NOT NULL AND dm.item_id = l.item_id)
           OR upper(dm.code) = upper(l.kd_item_code)
         LEFT JOIN device.model_revision mr ON mr.id = dm.current_revision_id
        WHERE l.order_id = $1
        ORDER BY l.line_no`,
      [id]
    )
  ).rows;
  let device_po_summary: {
    po_code: string;
    pr_codes: string[];
    subcontract_codes: string[];
    wo_codes: string[];
  } | null = null;
  if (order.module_key === "DEVICE" || lines.some((ln: any) => Boolean(ln.device_model_id))) {
    const prs = (
      await tx.query(
        `SELECT pr.code, pr.status
           FROM purchase.purchase_request pr
          WHERE (pr.purpose_entity_type = 'INTERNAL_ORDER' AND pr.purpose_entity_id = $1)
             OR pr.reason ILIKE '%' || $2 || '%'
             OR pr.reason ILIKE '%' || $3 || '%'
          ORDER BY pr.created_at DESC`,
        [order.id, order.code, order.kd_po_code]
      )
    ).rows;
    const subcontracts = (
      await tx.query(
        `SELECT so.code, so.status
           FROM device.subcontract_order so
          WHERE so.notes ILIKE '%' || $1 || '%'
             OR so.notes ILIKE '%' || $2 || '%'
             OR EXISTS (
               SELECT 1 FROM device.device_order dpo
               JOIN intake.internal_order_line iol ON iol.id = dpo.internal_order_line_id
               WHERE iol.order_id = $3 AND so.device_order_id = dpo.id
             )
          ORDER BY so.created_at DESC`,
        [order.code, order.kd_po_code, order.id]
      )
    ).rows;
    const prBadges = prs.map((p: any) => `PR Mua hàng: ${p.code} [${p.status}]`);
    const scBadges = subcontracts.map((s: any) => `Gia công: ${s.code} [${s.status}]`);
    for (const ln of lines as any[]) {
      const poStateLabel = order.status === "RECEIVED" ? "Chờ xác nhận PO" : "Đã đồng bộ PO & MRP";
      const modelInfo = ln.device_model_code
        ? ` · Model ${ln.device_model_code} Rev ${ln.device_model_revision || "A"} (${ln.device_bom_count || 0} dòng BOM)`
        : "";
      ln.device_po_sync_badges = [
        `PO SX: ${order.kd_po_code} [${poStateLabel}${modelInfo}]`,
        ...prBadges,
        ...scBadges,
        ...(ln.device_order_serials ?? []).map((w: string) => `Lệnh lắp ráp WO: ${w}`),
      ];
    }
    device_po_summary = {
      po_code: order.kd_po_code,
      pr_codes: prs.map((p: any) => p.code),
      subcontract_codes: subcontracts.map((s: any) => s.code),
      wo_codes: lines.flatMap((ln: any) => (ln.device_order_serials ?? []).map((w: string) => w.split(" ")[0])),
    };
  }
  const linked_oligo_orders = (
    await tx.query(
      `SELECT oo.id, oo.code, oo.status, oo.due_date, oo.notes,
              (SELECT count(*)::int FROM oligo.oligo_sequence os WHERE os.order_id = oo.id AND os.status NOT IN ('CANCELLED', 'SPLIT')) AS sequence_count
         FROM oligo.oligo_order oo
        WHERE oo.internal_order_id = $1
        ORDER BY oo.created_at DESC`,
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
  const issued_kit_coas = (
    await tx.query(
      `SELECT c.*,
              po.code AS order_code,
              COALESCE(b.tccs_code, b_item.tccs_code) AS tccs_code,
              COALESCE(b.specification, b_item.specification) AS bom_specification,
              COALESCE(b.storage_condition, b_item.storage_condition) AS bom_storage_condition,
              COALESCE(b.shelf_life_months, b_item.shelf_life_months) AS shelf_life_months,
              i.storage_condition AS item_storage_condition,
              rv.display_name AS reviewer_name
         FROM kit.coa_certificate c
         LEFT JOIN kit.production_order po ON po.id = c.production_order_id
         LEFT JOIN inv.lot l ON l.id = c.lot_id
         LEFT JOIN master.item i ON i.id = l.item_id
         LEFT JOIN kit.bom b ON b.id = po.bom_id
         LEFT JOIN LATERAL (
           SELECT b2.tccs_code, b2.specification, b2.storage_condition, b2.shelf_life_months
             FROM kit.bom b2
            WHERE b2.product_item_id = l.item_id
            ORDER BY (b2.status = 'EFFECTIVE') DESC, b2.bom_version DESC
            LIMIT 1
         ) b_item ON po.bom_id IS NULL AND l.item_id IS NOT NULL
         LEFT JOIN qms.qc_test qt ON qt.id = c.qc_test_id
         LEFT JOIN core.user_profile rv ON rv.user_id = qt.reviewer_id
        WHERE c.superseded_by_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM kit.coa_certificate child WHERE child.amended_from_id = c.id)
          AND (
            EXISTS (
              SELECT 1 FROM kit.production_order kpo
              JOIN intake.internal_order_line iol ON iol.id = kpo.internal_order_line_id
             WHERE iol.order_id = $1 AND (c.production_order_id = kpo.id OR c.lot_id = kpo.lot_id)
            )
            OR EXISTS (
              SELECT 1 FROM intake.shipment s
              JOIN intake.shipment_line sl ON sl.shipment_id = s.id
             WHERE s.order_id = $1 AND sl.lot_id = c.lot_id
            )
          )
        ORDER BY c.issued_at DESC`,
      [id]
    )
  ).rows;
  const device_fqc_coas = (
    await tx.query(
      `SELECT t.id AS test_id, t.code AS test_code, t.overall_result,
              du.serial_no, dm.code AS model_code, dm.name AS model_name,
              drev.revision AS revision_code, dpo.code AS order_code,
              dtr.nas_path AS trial_nas_path,
              dtr.attachment_name AS trial_attachment_name,
              dtr.attachment_data AS trial_attachment_data
         FROM device.device_order dpo
         JOIN intake.internal_order_line l ON l.id = dpo.internal_order_line_id
         JOIN device.device_unit du ON du.order_id = dpo.id
         JOIN device.device_model dm ON dm.id = du.model_id
         LEFT JOIN device.model_revision drev ON drev.id = du.model_revision_id
         JOIN qms.qc_test t ON t.entity_type = 'DEVICE_UNIT' AND t.entity_id = du.id AND t.status = 'REVIEWED' AND t.overall_result = 'PASS'
         LEFT JOIN LATERAL (
           SELECT br.nas_path, br.attachment_name, br.attachment_data
             FROM device.burn_in_run br
            WHERE br.unit_id = du.id
            ORDER BY br.created_at DESC
            LIMIT 1
         ) dtr ON true
        WHERE l.order_id = $1
        ORDER BY du.serial_no ASC`,
      [id]
    )
  ).rows;
  return { ...order, lines, linked_oligo_orders, issued_kit_coas, device_fqc_coas, device_po_summary, shipments };
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

/** Cho phép Quản trị viên (Admin) hoặc người có quyền quản lý đơn nội bộ xóa Đơn nội bộ và các lệnh nháp liên kết. */
export async function deleteInternalOrder(tx: Tx, actor: AuthzActor, id: string) {
  const order = (await tx.query("SELECT * FROM intake.internal_order WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!order) throw notFound("đơn nội bộ");
  if (!actor.isRootAdmin && !(await hasFactoryPermission(tx, actor, "intake.order.manage", order.org_unit_id))) {
    throw forbidden("Chỉ Quản trị viên (Admin) hoặc người có quyền Quản lý Đơn nội bộ mới được xóa đơn hàng.");
  }

  const lineIds = (
    await tx.query("SELECT id FROM intake.internal_order_line WHERE order_id = $1", [id])
  ).rows.map((r) => r.id as string);

  // 1. Dọn dẹp các Lệnh lắp ráp Thiết bị (device.device_order) liên kết với dòng đơn này
  if (lineIds.length > 0) {
    const devOrderIds = (
      await tx.query("SELECT id FROM device.device_order WHERE internal_order_line_id = ANY($1::uuid[])", [lineIds])
    ).rows.map((r) => r.id as string);
    if (devOrderIds.length > 0) {
      const unitIds = (
        await tx.query("SELECT id FROM device.device_unit WHERE order_id = ANY($1::uuid[])", [devOrderIds])
      ).rows.map((r) => r.id as string);
      if (unitIds.length > 0) {
        await tx.query("DELETE FROM device.service_ticket WHERE unit_id = ANY($1::uuid[])", [unitIds]);
        await tx.query("DELETE FROM device.service_schedule WHERE unit_id = ANY($1::uuid[])", [unitIds]);
        await tx.query("DELETE FROM device.burn_in_run WHERE unit_id = ANY($1::uuid[])", [unitIds]);
        await tx.query("DELETE FROM device.device_unit_component WHERE unit_id = ANY($1::uuid[])", [unitIds]);
        await tx.query("DELETE FROM device.device_unit WHERE id = ANY($1::uuid[])", [unitIds]);
      }
      await tx.query("UPDATE device.subcontract_order SET device_order_id = NULL WHERE device_order_id = ANY($1::uuid[])", [devOrderIds]);
      await tx.query("DELETE FROM device.device_order WHERE id = ANY($1::uuid[])", [devOrderIds]);
    }
  }

  // 2. Dọn dẹp hoặc ngắt liên kết các Lệnh sản xuất Kit (kit.production_order)
  if (lineIds.length > 0) {
    const kitOrderIds = (
      await tx.query("SELECT id FROM kit.production_order WHERE internal_order_line_id = ANY($1::uuid[])", [lineIds])
    ).rows.map((r) => r.id as string);
    await tx.query(
      "UPDATE kit.production_order SET internal_order_line_id = NULL WHERE internal_order_line_id = ANY($1::uuid[])",
      [lineIds]
    );
    if (kitOrderIds.length > 0) {
      await tx.query("UPDATE kit.lot_genealogy SET production_order_id = NULL WHERE production_order_id = ANY($1::uuid[])", [kitOrderIds]);
      await tx.query("UPDATE kit.retain_sample SET production_order_id = NULL WHERE production_order_id = ANY($1::uuid[])", [kitOrderIds]);
      await tx.query(
        `DELETE FROM kit.production_order
          WHERE id = ANY($1::uuid[])
            AND NOT EXISTS (SELECT 1 FROM kit.coa c WHERE c.production_order_id = kit.production_order.id)
            AND NOT EXISTS (SELECT 1 FROM kit.rework_order r WHERE r.production_order_id = kit.production_order.id)`,
        [kitOrderIds]
      );
    }
  }

  // 3. Dọn dẹp hoặc ngắt liên kết các Đơn Tổng hợp Oligo (oligo.oligo_order)
  const oligoOrderIds = (
    await tx.query("SELECT id FROM oligo.oligo_order WHERE internal_order_id = $1", [id])
  ).rows.map((r) => r.id as string);
  await tx.query("UPDATE oligo.oligo_order SET internal_order_id = NULL WHERE internal_order_id = $1", [id]);
  if (oligoOrderIds.length > 0) {
    const deletableOligoIds = (
      await tx.query(
        `SELECT o.id
           FROM oligo.oligo_order o
          WHERE o.id = ANY($1::uuid[])
            AND NOT EXISTS (
              SELECT 1 FROM oligo.oligo_sequence s
              JOIN oligo.synthesis_batch_item bi ON bi.sequence_id = s.id
              WHERE s.order_id = o.id
            )`,
        [oligoOrderIds]
      )
    ).rows.map((r) => r.id as string);
    if (deletableOligoIds.length > 0) {
      const seqIds = (
        await tx.query("SELECT id FROM oligo.oligo_sequence WHERE order_id = ANY($1::uuid[])", [deletableOligoIds])
      ).rows.map((r) => r.id as string);
      if (seqIds.length > 0) {
        await tx.query("DELETE FROM oligo.post_process WHERE sequence_id = ANY($1::uuid[])", [seqIds]);
        await tx.query("DELETE FROM oligo.oligo_pool_member WHERE sequence_id = ANY($1::uuid[])", [seqIds]);
        await tx.query("UPDATE oligo.oligo_sequence SET parent_sequence_id = NULL WHERE parent_sequence_id = ANY($1::uuid[])", [seqIds]);
        await tx.query("DELETE FROM oligo.oligo_sequence WHERE id = ANY($1::uuid[])", [seqIds]);
      }
      await tx.query("DELETE FROM oligo.oligo_order WHERE id = ANY($1::uuid[])", [deletableOligoIds]);
    }
  }

  // 4. Xóa các dòng giao hàng, phiếu giao hàng, dòng đơn nội bộ và chính đơn nội bộ
  if (lineIds.length > 0) {
    await tx.query(
      "DELETE FROM intake.shipment_line WHERE order_line_id = ANY($1::uuid[]) OR shipment_id IN (SELECT id FROM intake.shipment WHERE order_id = $2)",
      [lineIds, id]
    );
  } else {
    await tx.query(
      "DELETE FROM intake.shipment_line WHERE shipment_id IN (SELECT id FROM intake.shipment WHERE order_id = $1)",
      [id]
    );
  }
  await tx.query("DELETE FROM intake.shipment WHERE order_id = $1", [id]);
  await tx.query("DELETE FROM intake.internal_order_line WHERE order_id = $1", [id]);
  await tx.query("DELETE FROM intake.internal_order WHERE id = $1", [id]);

  await writeAudit(tx, actor, {
    entityType: "internal_order",
    entityId: id,
    action: "delete",
    changes: { code: [order.code, null], kd_po_code: [order.kd_po_code, null] },
  });

  return { deleted: true, id, code: order.code, kd_po_code: order.kd_po_code };
}

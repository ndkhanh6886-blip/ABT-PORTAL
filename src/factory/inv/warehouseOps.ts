import { z } from "zod/v3";
import type { Tx } from "../core/db";
import { authorize, authorizeAnywhere, authorizeAnywhereOneOf, hasFactoryPermission, SYSTEM_ACTOR, type AuthzActor } from "../core/authz";
import { vnToday } from "../core/dates";
import { forbidden, invalid, notFound } from "../core/errors";
import { writeAudit } from "../core/audit";
import { parseInput } from "../core/records";
import { runTransition } from "../core/stateMachine";
import { createStockDocument, stockDocumentMachine } from "./documents";
import { createLot, lotMachine } from "./lots";
import { createRequest, prMachine } from "../purchase/requests";
import { toBaseQty } from "../master/service";
import "./permissions";
import "../purchase/permissions";

let warehouseOpsSchemaEnsured = false;

export async function ensureWarehouseOpsSchema(_tx: Tx): Promise<void> {
  if (warehouseOpsSchemaEnsured) return;
  warehouseOpsSchemaEnsured = true;
}

/**
 * Kiểm tra người dùng hiện tại có thẩm quyền của Thủ kho / Trưởng bộ phận Cung ứng Kho (hoặc Ban Giám Đốc)
 * để phê duyệt & xuất cấp phát nguyên vật liệu từ Kho Trung Tâm (KHO-TONG) về các Kho Nhánh Phòng Ban hay không.
 * Nhân sự các phòng ban chuyên môn (R&D, Sản xuất Kit, Oligo, Kỹ thuật Thiết bị, QA/QC) chỉ được lập Phiếu yêu cầu chuyển kho (DRAFT)
 * và phải chờ Thủ kho hoặc Trưởng phòng Cung ứng phê duyệt.
 */
export async function canActorApproveCentralWarehouseTransfer(
  tx: Tx,
  actor: AuthzActor,
  sourceWarehouseId?: string | null
): Promise<boolean> {
  if (actor.isSystem || actor.isRootAdmin) return true;

  // Kiểm tra vai trò Thủ kho / Trưởng bộ phận Kho & Cung ứng trong phân quyền nhà máy
  const whRoleRes = await tx.query(
    `SELECT 1
       FROM core.user_role ur
       JOIN core.role r ON r.id = ur.role_id AND r.status = 'ACTIVE'
       LEFT JOIN core.org_unit o ON o.id = ur.scope_org_unit_id
      WHERE ur.user_id = $1
        AND ur.revoked_at IS NULL
        AND ur.valid_from <= now()
        AND (ur.valid_to IS NULL OR ur.valid_to > now())
        AND (
          r.code IN ('WH_HEAD', 'WH_STAFF', 'PURCHASE_HEAD', 'PURCHASE_STAFF')
          OR o.module_key IN ('WH', 'PURCHASE')
        )
      LIMIT 1`,
    [actor.userId]
  );
  if ((whRoleRes.rowCount ?? 0) > 0) return true;

  if (sourceWarehouseId) {
    const srcWh = (
      await tx.query("SELECT owner_org_unit_id, code FROM master.warehouse WHERE id = $1", [sourceWarehouseId])
    ).rows[0];
    if (srcWh && srcWh.code !== "KHO-TONG" && srcWh.owner_org_unit_id) {
      return hasFactoryPermission(tx, actor, "inv.document.post", srcWh.owner_org_unit_id);
    }
  }
  return false;
}

export async function getWarehouseHubOverview(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "inv.stock.view");
  await ensureWarehouseOpsSchema(tx);
  const today = vnToday();

  const warehouses = (
    await tx.query(
      `WITH wh_agg AS (
         SELECT loc.warehouse_id,
                count(DISTINCT b.lot_id) FILTER (
                  WHERE loc.is_quarantine = false
                    AND COALESCE(lot.status, 'RELEASED') = 'RELEASED'
                    AND (b.qty_on_hand - b.qty_reserved) > 0
                )::int AS released_lot_count,
                count(DISTINCT b.lot_id) FILTER (
                  WHERE (loc.is_quarantine = true OR COALESCE(lot.status, 'RELEASED') IN ('QUARANTINE', 'PENDING_QC'))
                    AND b.qty_on_hand > 0
                )::int AS quarantine_lot_count,
                count(DISTINCT b.lot_id) FILTER (
                  WHERE loc.is_quarantine = true
                    AND lot.status = 'RELEASED'
                    AND (b.qty_on_hand - b.qty_reserved) > 0
                )::int AS ready_putaway_count,
                count(DISTINCT b.item_id) FILTER (WHERE b.qty_on_hand > 0)::int AS active_item_count
           FROM inv.stock_balance b
           JOIN master.location loc ON loc.id = b.location_id
           LEFT JOIN inv.lot lot ON lot.id = b.lot_id
          WHERE b.qty_on_hand > 0
          GROUP BY loc.warehouse_id
       )
       SELECT w.id, w.code, w.name, w.purpose, w.owner_org_unit_id,
              ou.code AS owner_code, ou.name AS owner_name, ou.module_key AS owner_module_key,
              (SELECT id FROM master.location l WHERE l.warehouse_id = w.id AND l.is_quarantine = true AND l.status = 'ACTIVE' ORDER BY l.code LIMIT 1) AS bt_location_id,
              (SELECT code FROM master.location l WHERE l.warehouse_id = w.id AND l.is_quarantine = true AND l.status = 'ACTIVE' ORDER BY l.code LIMIT 1) AS bt_location_code,
              (SELECT id FROM master.location l WHERE l.warehouse_id = w.id AND l.is_quarantine = false AND l.status = 'ACTIVE' ORDER BY l.code LIMIT 1) AS a1_location_id,
              (SELECT code FROM master.location l WHERE l.warehouse_id = w.id AND l.is_quarantine = false AND l.status = 'ACTIVE' ORDER BY l.code LIMIT 1) AS a1_location_code,
              COALESCE(wa.released_lot_count, 0) AS released_lot_count,
              COALESCE(wa.quarantine_lot_count, 0) AS quarantine_lot_count,
              COALESCE(wa.ready_putaway_count, 0) AS ready_putaway_count,
              COALESCE(wa.active_item_count, 0) AS active_item_count
         FROM master.warehouse w
         LEFT JOIN core.org_unit ou ON ou.id = w.owner_org_unit_id
         LEFT JOIN wh_agg wa ON wa.warehouse_id = w.id
        WHERE w.status = 'ACTIVE'
        ORDER BY CASE w.code
          WHEN 'KHO-TONG' THEN 1
          WHEN 'KHO-KIT' THEN 2
          WHEN 'KHO-OLIGO' THEN 3
          WHEN 'KHO-DEVICE' THEN 4
          WHEN 'KHO-RD' THEN 5
          WHEN 'KHO-QA' THEN 6
          ELSE 99 END, w.code`
    )
  ).rows;

  const all_locations = (
    await tx.query(
      `SELECT loc.id, loc.code, loc.name, loc.is_quarantine, loc.warehouse_id,
              w.code AS warehouse_code, w.name AS warehouse_name
         FROM master.location loc
         JOIN master.warehouse w ON w.id = loc.warehouse_id
        WHERE loc.status = 'ACTIVE' AND w.status = 'ACTIVE'
        ORDER BY CASE w.code WHEN 'KHO-TONG' THEN 1 ELSE 2 END, w.code, loc.is_quarantine, loc.code`
    )
  ).rows;

  const central_hub_stock = (
    await tx.query(
      `SELECT b.id AS balance_id, b.item_id, i.code AS item_code, i.name AS item_name, i.item_type, i.base_uom,
              b.lot_id, lot.code AS lot_code, lot.status AS lot_status, lot.expiry_date::text AS expiry_date,
              b.location_id, loc.code AS location_code, w.id AS warehouse_id, w.code AS warehouse_code,
              b.qty_on_hand::float AS qty_on_hand, b.qty_reserved::float AS qty_reserved,
              (b.qty_on_hand - b.qty_reserved)::float AS qty_available
         FROM inv.stock_balance b
         JOIN master.location loc ON loc.id = b.location_id
         JOIN master.warehouse w ON w.id = loc.warehouse_id
         JOIN master.item i ON i.id = b.item_id
         LEFT JOIN inv.lot lot ON lot.id = b.lot_id
        WHERE w.status = 'ACTIVE'
          AND loc.is_quarantine = false
          AND COALESCE(lot.status, 'RELEASED') = 'RELEASED'
          AND (b.qty_on_hand - b.qty_reserved) > 0
        ORDER BY CASE w.code WHEN 'KHO-TONG' THEN 0 ELSE 1 END, i.code, lot.expiry_date ASC NULLS LAST
        LIMIT 200`
    )
  ).rows;

  const putaway_queue = (
    await tx.query(
      `SELECT b.id AS balance_id, b.item_id, i.code AS item_code, i.name AS item_name, i.base_uom,
              b.lot_id, lot.code AS lot_code, lot.status AS lot_status, lot.expiry_date::text AS expiry_date,
              b.location_id AS from_location_id, loc.code AS from_location_code,
              w.id AS warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
              (b.qty_on_hand - b.qty_reserved)::float AS qty_free,
              (SELECT l2.id FROM master.location l2 WHERE l2.warehouse_id = w.id AND l2.is_quarantine = false AND l2.status = 'ACTIVE' ORDER BY l2.code LIMIT 1) AS to_location_id,
              (SELECT l2.code FROM master.location l2 WHERE l2.warehouse_id = w.id AND l2.is_quarantine = false AND l2.status = 'ACTIVE' ORDER BY l2.code LIMIT 1) AS to_location_code
         FROM inv.stock_balance b
         JOIN master.location loc ON loc.id = b.location_id
         JOIN master.warehouse w ON w.id = loc.warehouse_id
         JOIN master.item i ON i.id = b.item_id
         JOIN inv.lot lot ON lot.id = b.lot_id
        WHERE loc.is_quarantine = true
          AND lot.status = 'RELEASED'
          AND (b.qty_on_hand - b.qty_reserved) > 0
        ORDER BY w.code, i.code
        LIMIT 100`
    )
  ).rows;

  const expiry_radar = (
    await tx.query(
      `SELECT b.id AS balance_id, lot.id AS lot_id, lot.code AS lot_code, lot.status AS lot_status,
              lot.expiry_date::text AS expiry_date,
              (lot.expiry_date - $1::date)::int AS days_left,
              i.id AS item_id, i.code AS item_code, i.name AS item_name, i.base_uom,
              w.id AS warehouse_id, w.code AS warehouse_code, loc.code AS location_code, loc.is_quarantine,
              b.qty_on_hand::float AS qty_on_hand, (b.qty_on_hand - b.qty_reserved)::float AS qty_available
         FROM inv.stock_balance b
         JOIN inv.lot lot ON lot.id = b.lot_id
         JOIN master.item i ON i.id = b.item_id
         JOIN master.location loc ON loc.id = b.location_id
         JOIN master.warehouse w ON w.id = loc.warehouse_id
        WHERE b.qty_on_hand > 0
          AND lot.expiry_date IS NOT NULL
          AND (lot.expiry_date - $1::date) <= 180
        ORDER BY (lot.expiry_date - $1::date) ASC, i.code ASC
        LIMIT 40`,
      [today]
    )
  ).rows;

  const low_stock_radar = (
    await tx.query(
      `WITH stock_agg AS (
         SELECT b.item_id,
                COALESCE(sum(b.qty_on_hand - b.qty_reserved) FILTER (
                  WHERE w.code = 'KHO-TONG' AND loc.is_quarantine = false AND COALESCE(lot.status, 'RELEASED') = 'RELEASED' AND (b.qty_on_hand - b.qty_reserved) > 0
                ), 0)::float AS hub_available,
                COALESCE(sum(b.qty_on_hand - b.qty_reserved) FILTER (
                  WHERE w.code <> 'KHO-TONG' AND loc.is_quarantine = false AND COALESCE(lot.status, 'RELEASED') = 'RELEASED' AND (b.qty_on_hand - b.qty_reserved) > 0
                ), 0)::float AS branch_available,
                COALESCE(sum(b.qty_on_hand) FILTER (
                  WHERE (loc.is_quarantine = true OR COALESCE(lot.status, 'RELEASED') IN ('QUARANTINE', 'PENDING_QC')) AND b.qty_on_hand > 0
                ), 0)::float AS quarantine_qty
           FROM inv.stock_balance b
           JOIN master.location loc ON loc.id = b.location_id
           JOIN master.warehouse w ON w.id = loc.warehouse_id
           LEFT JOIN inv.lot lot ON lot.id = b.lot_id
          WHERE b.qty_on_hand > 0
          GROUP BY b.item_id
       ),
       pr_agg AS (
         SELECT prl.item_id,
                COALESCE(sum(prl.qty - prl.qty_ordered), 0)::float AS open_pr_qty
           FROM purchase.purchase_request_line prl
           JOIN purchase.purchase_request pr ON pr.id = prl.pr_id
          WHERE pr.status IN ('DRAFT', 'SUBMITTED', 'PENDING_BOD', 'APPROVED')
            AND prl.qty > prl.qty_ordered
          GROUP BY prl.item_id
       ),
       po_agg AS (
         SELECT pol.item_id,
                COALESCE(sum(pol.qty_ordered - pol.qty_received), 0)::float AS open_po_qty
           FROM purchase.purchase_order_line pol
           JOIN purchase.purchase_order po ON po.id = pol.po_id
          WHERE po.status IN ('DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED')
            AND pol.qty_ordered > pol.qty_received
          GROUP BY pol.item_id
       )
       SELECT i.id AS item_id, i.code AS item_code, i.name AS item_name, i.item_type, i.base_uom,
              COALESCE(i.min_safety_stock, 10)::float AS min_safety_stock,
              COALESCE(i.reorder_qty, 50)::float AS reorder_qty,
              COALESCE(i.lead_time_days, 14)::int AS lead_time_days,
              COALESCE(sa.hub_available, 0) AS hub_available,
              COALESCE(sa.branch_available, 0) AS branch_available,
              COALESCE(sa.quarantine_qty, 0) AS quarantine_qty,
              COALESCE(pra.open_pr_qty, 0) AS open_pr_qty,
              COALESCE(poa.open_po_qty, 0) AS open_po_qty
         FROM master.item i
         LEFT JOIN stock_agg sa ON sa.item_id = i.id
         LEFT JOIN pr_agg pra ON pra.item_id = i.id
         LEFT JOIN po_agg poa ON poa.item_id = i.id
        WHERE i.status = 'ACTIVE' AND i.is_purchasable = true
        ORDER BY (COALESCE(sa.hub_available, 0) + COALESCE(sa.branch_available, 0) - COALESCE(i.min_safety_stock, 10)::float) ASC, i.code ASC
        LIMIT 30`
    )
  ).rows;

  const pending_transfer_requests = (
    await tx.query(
      `SELECT d.id, d.code, d.reason_code, d.status, d.version, d.created_at, d.notes, d.created_by,
              w.id AS source_warehouse_id, w.code AS source_warehouse_code, up.display_name AS created_by_name,
              ARRAY(
                SELECT DISTINCT tw.id::text
                  FROM inv.stock_document_line dl
                  LEFT JOIN master.location tl ON tl.id = dl.to_location_id
                  LEFT JOIN master.warehouse tw ON tw.id = tl.warehouse_id
                 WHERE dl.document_id = d.id AND tw.id IS NOT NULL
              ) AS target_warehouse_ids,
              ARRAY(
                SELECT DISTINCT tw.code
                  FROM inv.stock_document_line dl
                  LEFT JOIN master.location tl ON tl.id = dl.to_location_id
                  LEFT JOIN master.warehouse tw ON tw.id = tl.warehouse_id
                 WHERE dl.document_id = d.id AND tw.code IS NOT NULL
              ) AS target_warehouse_codes,
              ARRAY(
                SELECT i.code || ' — ' || i.name || ' (' || dl.qty::float || ' ' || dl.uom ||
                       CASE WHEN lot.code IS NOT NULL THEN ' · Lô ' || lot.code ELSE '' END || ' · ' ||
                       COALESCE(fl.code, '') || ' ➔ ' ||
                       CASE WHEN tw.id IS NOT NULL AND tw.id <> d.warehouse_id THEN tw.code || '·' || tl.code ELSE COALESCE(tl.code, '') END || ')'
                  FROM inv.stock_document_line dl
                  JOIN master.item i ON i.id = dl.item_id
                  LEFT JOIN inv.lot lot ON lot.id = dl.lot_id
                  LEFT JOIN master.location fl ON fl.id = dl.from_location_id
                  LEFT JOIN master.location tl ON tl.id = dl.to_location_id
                  LEFT JOIN master.warehouse tw ON tw.id = tl.warehouse_id
                 WHERE dl.document_id = d.id
                 ORDER BY dl.line_no
              ) AS line_summaries
         FROM inv.stock_document d
         JOIN master.warehouse w ON w.id = d.warehouse_id
         LEFT JOIN core.user_profile up ON up.user_id = d.created_by
        WHERE d.doc_type = 'TRANSFER'
          AND d.status = 'DRAFT'
        ORDER BY d.created_at DESC
        LIMIT 50`
    )
  ).rows;

  const recent_transfers = (
    await tx.query(
      `SELECT d.id, d.code, d.reason_code, d.status, d.posted_at, d.created_at, d.notes,
              w.code AS source_warehouse_code, up.display_name AS created_by_name,
              ap.display_name AS posted_by_name,
              ARRAY(
                SELECT i.code || ' (' || dl.qty::float || ' ' || dl.uom || ' · ' ||
                       COALESCE(fl.code, '') || ' ➔ ' ||
                       CASE WHEN tw.id IS NOT NULL AND tw.id <> d.warehouse_id THEN tw.code || '·' || tl.code ELSE COALESCE(tl.code, '') END || ')'
                  FROM inv.stock_document_line dl
                  JOIN master.item i ON i.id = dl.item_id
                  LEFT JOIN master.location fl ON fl.id = dl.from_location_id
                  LEFT JOIN master.location tl ON tl.id = dl.to_location_id
                  LEFT JOIN master.warehouse tw ON tw.id = tl.warehouse_id
                 WHERE dl.document_id = d.id
                 ORDER BY dl.line_no
              ) AS line_summaries
         FROM inv.stock_document d
         JOIN master.warehouse w ON w.id = d.warehouse_id
         LEFT JOIN core.user_profile up ON up.user_id = d.created_by
         LEFT JOIN core.user_profile ap ON ap.user_id = d.posted_by
        WHERE d.doc_type = 'TRANSFER'
        ORDER BY d.created_at DESC
        LIMIT 20`
    )
  ).rows;

  const can_approve_transfer = await canActorApproveCentralWarehouseTransfer(tx, actor);

  return {
    can_approve_transfer,
    warehouses,
    all_locations,
    central_hub_stock,
    putaway_queue,
    expiry_radar,
    low_stock_radar,
    pending_transfer_requests,
    recent_transfers,
  };
}

const dispatchLineItemSchema = z.object({
  item_id: z.string().uuid("Chọn vật tư cần cấp phát"),
  lot_id: z.string().uuid().optional().nullable(),
  qty: z.coerce.number().positive("Số lượng cấp phát phải lớn hơn 0"),
});

const dispatchSchema = z.object({
  source_warehouse_id: z.string().uuid().optional().nullable(),
  target_warehouse_id: z.string().uuid("Chọn kho nhánh bộ phận nhận hàng"),
  target_location_id: z.string().uuid().optional().nullable(),
  item_id: z.string().uuid().optional().nullable(),
  lot_id: z.string().uuid().optional().nullable(),
  qty: z.coerce.number().positive().optional().nullable(),
  lines: z.array(dispatchLineItemSchema).optional(),
  notes: z.string().trim().max(500).optional().nullable(),
  /**
   * `auto_post`:
   * - Khi phòng ban lập yêu cầu từ thanh công cụ Kho Phòng (`auto_post: false`), hệ thống tạo Phiếu Yêu Cầu Chuyển Kho ở trạng thái `DRAFT`
   *   chờ Thủ kho hoặc Trưởng bộ phận Cung ứng Kho duyệt xuất.
   * - Chỉ khi Thủ kho / Trưởng phòng Cung ứng thao tác xuất cấp phát trực tiếp (`auto_post: true` và có thẩm quyền kho tổng) mới ghi sổ (`POSTED`) ngay.
   */
  auto_post: z.boolean().optional(),
});

/**
 * FEFO Inter-Warehouse Transfer Request & Dispatch:
 * - Khi nhân sự các phòng ban (R&D, Sản xuất Kit, Oligo, Kỹ thuật Thiết bị, QA/QC) bấm "+ Chuyển NVL từ Kho Tổng về Kho Phòng"
 *   (`auto_post === false` hoặc người tạo không phải Thủ kho / Trưởng phòng Cung ứng), hệ thống lập Phiếu Yêu Cầu Chuyển Kho ở trạng thái `DRAFT`
 *   để Thủ kho hoặc Trưởng phòng Cung ứng kiểm tra và bấm Duyệt xuất kho.
 * - Khi Thủ kho / Trưởng phòng Cung ứng trực tiếp điều phối tại Kho Nhà Máy hoặc duyệt dòng PR từ Kho Tổng (`auto_post !== false` và có quyền duyệt Kho Tổng),
 *   hệ thống ghi sổ (`POSTED`) điều chuyển FEFO ngay.
 */
export async function dispatchInterWarehouseFefo(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorizeAnywhereOneOf(tx, actor, ["inv.stock.view", "inv.document.create"]);
  const d = parseInput(dispatchSchema, input);

  const rawRequestedLines: { item_id: string; lot_id?: string | null; qty: number }[] =
    Array.isArray(d.lines) && d.lines.length > 0
      ? d.lines
      : d.item_id && d.qty && d.qty > 0
        ? [{ item_id: d.item_id, lot_id: d.lot_id ?? null, qty: d.qty }]
        : [];
  if (rawRequestedLines.length === 0) {
    throw invalid("Vui lòng chọn ít nhất một nguyên vật liệu và nhập số lượng cần chuyển.");
  }

  const srcWh = d.source_warehouse_id
    ? (await tx.query("SELECT id, code, name FROM master.warehouse WHERE id = $1 AND status = 'ACTIVE'", [d.source_warehouse_id])).rows[0]
    : (await tx.query("SELECT id, code, name FROM master.warehouse WHERE code = 'KHO-TONG' AND status = 'ACTIVE' LIMIT 1")).rows[0];
  if (!srcWh) throw notFound("Kho nguồn cấp phát");

  const dstWh = (await tx.query("SELECT id, code, name FROM master.warehouse WHERE id = $1 AND status = 'ACTIVE'", [d.target_warehouse_id])).rows[0];
  if (!dstWh) throw notFound("Kho bộ phận nhận hàng");
  if (srcWh.id === dstWh.id) throw invalid("Kho nhận phải khác kho nguồn khi điều chuyển liên kho.");

  const dstLoc = d.target_location_id
    ? (await tx.query("SELECT id, code, is_quarantine FROM master.location WHERE id = $1 AND warehouse_id = $2 AND status = 'ACTIVE'", [d.target_location_id, dstWh.id])).rows[0]
    : (await tx.query("SELECT id, code, is_quarantine FROM master.location WHERE warehouse_id = $1 AND is_quarantine = false AND status = 'ACTIVE' ORDER BY code LIMIT 1", [dstWh.id])).rows[0];
  if (!dstLoc) throw invalid(`Kho nhận ${dstWh.code} chưa có kệ chính thức (A1) đang hoạt động.`);

  const today = vnToday();
  const transferLines: {
    item_id: string;
    lot_id: string | null;
    from_location_id: string;
    to_location_id: string;
    qty: number;
    uom: string;
  }[] = [];

  for (const reqLine of rawRequestedLines) {
    const item = (await tx.query("SELECT id, code, name, base_uom, tracking FROM master.item WHERE id = $1", [reqLine.item_id])).rows[0];
    if (!item) throw notFound("Vật tư");

    const candidateRows = (
      await tx.query(
        `SELECT b.id, b.lot_id, b.location_id, (b.qty_on_hand - b.qty_reserved)::float AS avail,
                lot.code AS lot_code, lot.expiry_date::text AS expiry_date, loc.code AS loc_code
           FROM inv.stock_balance b
           JOIN master.location loc ON loc.id = b.location_id
           LEFT JOIN inv.lot lot ON lot.id = b.lot_id
          WHERE loc.warehouse_id = $1
            AND b.item_id = $2
            AND loc.is_quarantine = false
            AND COALESCE(lot.status, 'RELEASED') = 'RELEASED'
            AND (lot.expiry_date IS NULL OR lot.expiry_date >= $3)
            AND ($4::uuid IS NULL OR b.lot_id = $4)
            AND (b.qty_on_hand - b.qty_reserved) > 0
          ORDER BY lot.expiry_date ASC NULLS LAST, lot.received_date ASC NULLS LAST`,
        [srcWh.id, item.id, today, reqLine.lot_id ?? null]
      )
    ).rows;

    const totalAvail = candidateRows.reduce((s, r) => s + Number(r.avail), 0);
    if (totalAvail + 1e-9 < reqLine.qty) {
      throw invalid(
        `Tồn kho khả dụng của ${item.code} tại ${srcWh.code} chỉ còn ${totalAvail} ${item.base_uom} (yêu cầu chuyển ${reqLine.qty} ${item.base_uom}).`
      );
    }

    let remaining = reqLine.qty;
    for (const row of candidateRows) {
      if (remaining <= 1e-9) break;
      const take = Math.min(remaining, Number(row.avail));
      transferLines.push({
        item_id: item.id,
        lot_id: row.lot_id,
        from_location_id: row.location_id,
        to_location_id: dstLoc.id,
        qty: Math.round(take * 1e6) / 1e6,
        uom: item.base_uom,
      });
      remaining -= take;
    }
  }

  const doc = await createStockDocument(
    tx,
    actor,
    {
      doc_type: "TRANSFER",
      reason_code: "DEPT_SUPPLY",
      warehouse_id: srcWh.id,
      notes: d.notes || `Đề xuất chuyển vật tư FEFO từ ${srcWh.code} về ${dstWh.code} (${dstLoc.code})`,
      lines: transferLines,
    },
    { trusted: true }
  );

  const canApprove = await canActorApproveCentralWarehouseTransfer(tx, actor, srcWh.id);
  const shouldPostImmediately = d.auto_post !== false && canApprove;

  if (!shouldPostImmediately) {
    await writeAudit(tx, actor, {
      entityType: "stock_document",
      entityId: doc.id,
      action: "inter_warehouse_transfer_request",
      changes: {
        from_wh: [null, srcWh.code],
        to_wh: [null, dstWh.code],
        status: [null, "DRAFT (Chờ Thủ kho / Trưởng phòng Cung ứng duyệt)"],
        lines: [null, transferLines.length],
      },
    });
    return {
      document: doc,
      status: "DRAFT" as const,
      pending_approval: true,
      from_warehouse: srcWh.code,
      to_warehouse: dstWh.code,
      lines_count: transferLines.length,
    };
  }

  const posted = await runTransition(
    tx,
    stockDocumentMachine,
    actor,
    { id: doc.id, action: "post", expectedVersion: doc.version },
    { trusted: true }
  );
  await writeAudit(tx, actor, {
    entityType: "stock_document",
    entityId: posted.id,
    action: "inter_warehouse_dispatch",
    changes: { from_wh: [null, srcWh.code], to_wh: [null, dstWh.code], lines: [null, transferLines.length] },
  });
  return {
    document: posted,
    status: "POSTED" as const,
    pending_approval: false,
    from_warehouse: srcWh.code,
    to_warehouse: dstWh.code,
    lines_count: transferLines.length,
  };
}

const approveTransferRequestSchema = z.object({
  document_id: z.string().uuid("Chọn phiếu yêu cầu chuyển kho cần duyệt"),
});

/**
 * Thủ kho / Trưởng phòng Cung ứng (hoặc Ban Giám Đốc) phê duyệt & xuất cấp phát Phiếu Yêu Cầu Chuyển Kho (`DRAFT` -> `POSTED`).
 */
export async function approveInterWarehouseTransferRequest(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(approveTransferRequestSchema, input);
  const doc = (
    await tx.query(
      `SELECT sd.*, w.code AS source_warehouse_code
         FROM inv.stock_document sd
         JOIN master.warehouse w ON w.id = sd.warehouse_id
        WHERE sd.id = $1 FOR UPDATE OF sd`,
      [d.document_id]
    )
  ).rows[0];
  if (!doc) throw notFound("Phiếu yêu cầu chuyển kho");
  if (doc.doc_type !== "TRANSFER") throw invalid("Chỉ áp dụng cho phiếu điều chuyển kho (TRANSFER).");
  if (doc.status !== "DRAFT") {
    throw invalid(`Phiếu ${doc.code} không còn ở trạng thái chờ duyệt (trạng thái hiện tại: ${doc.status}).`);
  }

  const canApprove = await canActorApproveCentralWarehouseTransfer(tx, actor, doc.warehouse_id);
  if (!canApprove) {
    throw forbidden(
      "Chỉ Thủ kho, Trưởng bộ phận Cung ứng Kho hoặc Ban Giám Đốc mới có thẩm quyền phê duyệt xuất chuyển nguyên vật liệu từ Kho Trung Tâm (KHO-TONG)."
    );
  }

  const posted = await runTransition(
    tx,
    stockDocumentMachine,
    actor,
    { id: doc.id, action: "post", expectedVersion: doc.version },
    { trusted: true }
  );
  await writeAudit(tx, actor, {
    entityType: "stock_document",
    entityId: posted.id,
    action: "approve_inter_warehouse_transfer",
    changes: { status: ["DRAFT", "POSTED"], code: [null, doc.code] },
  });
  return { document: posted, code: doc.code, source_warehouse_code: doc.source_warehouse_code };
}

const rejectTransferRequestSchema = z.object({
  document_id: z.string().uuid("Chọn phiếu yêu cầu chuyển kho cần từ chối / hủy"),
  reason: z.string().trim().max(500).optional().nullable(),
});

/**
 * Thủ kho / Trưởng phòng Cung ứng từ chối phiếu yêu cầu chuyển kho, hoặc người lập tự hủy phiếu khi đang ở trạng thái chờ duyệt (`DRAFT` -> `CANCELLED`).
 */
export async function rejectInterWarehouseTransferRequest(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(rejectTransferRequestSchema, input);
  const doc = (
    await tx.query("SELECT * FROM inv.stock_document WHERE id = $1 FOR UPDATE", [d.document_id])
  ).rows[0];
  if (!doc) throw notFound("Phiếu yêu cầu chuyển kho");
  if (doc.doc_type !== "TRANSFER") throw invalid("Chỉ áp dụng cho phiếu điều chuyển kho (TRANSFER).");
  if (doc.status !== "DRAFT") {
    throw invalid(`Phiếu ${doc.code} đã được xử lý (${doc.status}), không thể hủy nháp.`);
  }

  const canApprove = await canActorApproveCentralWarehouseTransfer(tx, actor, doc.warehouse_id);
  const isCreator = doc.created_by === actor.userId;
  if (!canApprove && !isCreator) {
    throw forbidden("Chỉ Thủ kho, Trưởng bộ phận Cung ứng Kho hoặc chính người lập phiếu mới có quyền hủy / từ chối yêu cầu này.");
  }

  if (d.reason && d.reason.trim()) {
    const suffix = ` [Từ chối / Hủy bởi ${actor.name}: ${d.reason.trim()}]`;
    await tx.query("UPDATE inv.stock_document SET notes = COALESCE(notes, '') || $2 WHERE id = $1", [doc.id, suffix]);
  }

  const cancelled = await runTransition(
    tx,
    stockDocumentMachine,
    actor,
    { id: doc.id, action: "cancel", expectedVersion: doc.version, reason: d.reason || undefined },
    { trusted: true }
  );
  await writeAudit(tx, actor, {
    entityType: "stock_document",
    entityId: cancelled.id,
    action: "reject_inter_warehouse_transfer",
    changes: { status: ["DRAFT", "CANCELLED"], code: [null, doc.code] },
    reason: d.reason || undefined,
  });
  return { document: cancelled, code: doc.code };
}

const putAwayOneClickSchema = z.object({
  lot_id: z.string().uuid().optional().nullable(),
  warehouse_id: z.string().uuid().optional().nullable(),
  put_away_all: z.boolean().optional().default(false),
});

export async function putAwayReleasedLotOneClick(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorizeAnywhere(tx, actor, "inv.document.create");
  const d = parseInput(putAwayOneClickSchema, input);

  const balances = (
    await tx.query(
      `SELECT b.item_id, i.base_uom, b.lot_id, lot.code AS lot_code, b.container_id,
              b.location_id AS from_location_id, loc.warehouse_id, w.code AS warehouse_code,
              (b.qty_on_hand - b.qty_reserved)::float AS free_qty,
              (SELECT l2.id FROM master.location l2 WHERE l2.warehouse_id = loc.warehouse_id AND l2.is_quarantine = false AND l2.status = 'ACTIVE' ORDER BY l2.code LIMIT 1) AS to_location_id
         FROM inv.stock_balance b
         JOIN master.location loc ON loc.id = b.location_id
         JOIN master.warehouse w ON w.id = loc.warehouse_id
         JOIN inv.lot lot ON lot.id = b.lot_id
         JOIN master.item i ON i.id = b.item_id
        WHERE loc.is_quarantine = true
          AND lot.status = 'RELEASED'
          AND (b.qty_on_hand - b.qty_reserved) > 0
          AND ($1::uuid IS NULL OR b.lot_id = $1)
          AND ($2::uuid IS NULL OR loc.warehouse_id = $2)
        ORDER BY w.code, lot.code`,
      [d.put_away_all ? null : (d.lot_id ?? null), d.warehouse_id ?? null]
    )
  ).rows;

  if (!balances.length) throw invalid("Không có lô hàng đã giải phóng (RELEASED) nào đang chờ cất kệ tại khu biệt trữ (BT).");

  const byWh = new Map<string, typeof balances>();
  for (const b of balances) {
    if (!b.to_location_id) throw invalid(`Kho ${b.warehouse_code} chưa có vị trí kệ chính (A1).`);
    const list = byWh.get(b.warehouse_id) ?? [];
    list.push(b);
    byWh.set(b.warehouse_id, list);
  }

  const docs: any[] = [];
  for (const [whId, rows] of byWh.entries()) {
    const doc = await createStockDocument(
      tx,
      actor,
      {
        doc_type: "TRANSFER",
        reason_code: "PUTAWAY",
        warehouse_id: whId,
        notes: `Put-Away tự động các lô đã duyệt QC từ khu Biệt trữ (BT) lên kệ chính (A1)`,
        lines: rows.map((r) => ({
          item_id: r.item_id,
          lot_id: r.lot_id,
          container_id: r.container_id,
          from_location_id: r.from_location_id,
          to_location_id: r.to_location_id,
          qty: Number(r.free_qty),
          uom: r.base_uom,
        })),
      },
      { trusted: true }
    );
    const posted = await runTransition(tx, stockDocumentMachine, actor, { id: doc.id, action: "post", expectedVersion: doc.version }, { trusted: true });
    docs.push(posted);
  }

  return { moved_count: balances.length, documents: docs };
}

const createReplenishPrSchema = z.object({
  item_id: z.string().uuid(),
  qty: z.coerce.number().positive(),
  est_price: z.coerce.number().min(0).optional().nullable(),
  warehouse_code: z.string().trim().default("KHO-TONG"),
  needed_by: z.string().optional().nullable(),
  reason: z.string().trim().optional().nullable(),
  auto_approve: z.boolean().optional().default(true),
});

export async function createReplenishmentPrFromWarehouse(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorizeAnywhere(tx, actor, "inv.stock.view");
  const d = parseInput(createReplenishPrSchema, input);

  const wh = (
    await tx.query("SELECT id, code, owner_org_unit_id FROM master.warehouse WHERE code = $1 AND status = 'ACTIVE' LIMIT 1", [
      d.warehouse_code,
    ])
  ).rows[0] ?? (await tx.query("SELECT id, code, owner_org_unit_id FROM master.warehouse WHERE status = 'ACTIVE' ORDER BY code LIMIT 1")).rows[0];
  if (!wh) throw notFound("Kho nhận hàng");

  const item = (await tx.query("SELECT id, code, name, base_uom FROM master.item WHERE id = $1", [d.item_id])).rows[0];
  if (!item) throw notFound("Vật tư");

  const lastPriceRow = (
    await tx.query(
      "SELECT unit_price::float AS price FROM purchase.purchase_order_line WHERE item_id = $1 AND unit_price > 0 ORDER BY id DESC LIMIT 1",
      [item.id]
    )
  ).rows[0];
  const estPrice = d.est_price ?? lastPriceRow?.price ?? 250000;

  const pr = await createRequest(tx, SYSTEM_ACTOR, {
    org_unit_id: wh.owner_org_unit_id,
    target_warehouse_id: wh.id,
    needed_by: d.needed_by || null,
    reason: d.reason || `[MRP Bù tồn kho an toàn] Đặt mua bổ sung ${item.code} — ${item.name} cho ${wh.code}`,
    lines: [
      {
        item_id: item.id,
        qty: d.qty,
        uom: item.base_uom,
        est_price: estPrice,
      },
    ],
  });

  if (d.auto_approve) {
    const submitted = await runTransition(tx, prMachine, SYSTEM_ACTOR, { id: pr.id, action: "submit", expectedVersion: pr.version }, { trusted: true });
    if (!submitted.requires_bod) {
      await runTransition(tx, prMachine, actor, { id: pr.id, action: "approve", expectedVersion: submitted.version }, { trusted: true });
    }
  }

  const updatedPr = (await tx.query("SELECT * FROM purchase.purchase_request WHERE id = $1", [pr.id])).rows[0];
  return updatedPr;
}

const holdLotSchema = z.object({
  lot_id: z.string().uuid(),
  reason: z.string().trim().min(3, "Nhập lý do khóa/cách ly lô"),
});

export async function holdNearExpiryLot(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorizeAnywhere(tx, actor, "inv.lot.hold");
  const d = parseInput(holdLotSchema, input);
  const lot = (await tx.query("SELECT * FROM inv.lot WHERE id = $1", [d.lot_id])).rows[0];
  if (!lot) throw notFound("Lô hàng");
  if (lot.status !== "RELEASED") throw invalid(`Chỉ khóa được lô đang ở trạng thái RELEASED (hiện tại: ${lot.status}).`);
  return runTransition(tx, lotMachine, actor, { id: lot.id, action: "hold", expectedVersion: lot.version, reason: d.reason });
}

const openContainerSchema = z.object({
  container_id: z.string().uuid("Chọn lọ / bình hóa chất cần mở nắp"),
  days: z.coerce.number().int().positive("Số ngày hạn dùng sau mở nắp phải lớn hơn 0").optional(),
  open_shelf_life_days: z.coerce.number().int().positive().optional(),
  reason: z.string().trim().max(500).optional().nullable(),
});

/**
 * GMP Opened-Container Shelf-Life Control (open_container):
 * Sets opened_at = now() and open_expiry_date = (CURRENT_DATE + make_interval(days => $days))::date
 * on inv.container and writes an audit trail entry.
 */
export async function openReagentContainer(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorizeAnywhere(tx, actor, "inv.document.create");
  await ensureWarehouseOpsSchema(tx);
  const d = parseInput(openContainerSchema, input);
  const cur = (
    await tx.query(
      `SELECT c.*, i.open_shelf_life_days AS item_open_shelf_life_days
         FROM inv.container c
         LEFT JOIN inv.lot l ON l.id = c.lot_id
         LEFT JOIN master.item i ON i.id = l.item_id
        WHERE c.id = $1 FOR UPDATE OF c`,
      [d.container_id]
    )
  ).rows[0];
  if (!cur) throw notFound("Bình / lọ chứa hóa chất (container)");
  const days = d.days ?? d.open_shelf_life_days ?? Number(cur.item_open_shelf_life_days || 30);
  const upd = (
    await tx.query(
      `UPDATE inv.container
          SET opened_at = now(),
              open_expiry_date = (CURRENT_DATE + make_interval(days => $2::int))::date,
              status = CASE WHEN status = 'AVAILABLE' THEN 'IN_USE' ELSE status END
        WHERE id = $1
        RETURNING *`,
      [d.container_id, days]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "container",
    entityId: d.container_id,
    action: "open_container",
    changes: {
      opened_at: [cur.opened_at ?? null, upd.opened_at],
      open_expiry_date: [cur.open_expiry_date ?? null, upd.open_expiry_date],
      status: [cur.status, upd.status],
    },
    reason: d.reason || `Mở nắp bình/lọ hóa chất (hạn dùng sau mở nắp: ${days} ngày)`,
  });
  return upd;
}

/**
 * Tra cứu ngược Định mức BOM ("Where-Used") cho một Mã Nguyên vật liệu / Hóa chất / Bao bì / Linh kiện / Bán thành phẩm,
 * đồng thời tính toán số lượng Thành phẩm (Bộ Kit / Bán thành phẩm / Thiết bị) tối đa có thể sản xuất được từ lượng tồn kho hiện có.
 * Hỗ trợ:
 *  1. Cấp 1 (Trực tiếp): Nguyên liệu nằm trực tiếp trong BOM Thành phẩm Kit (`finished_good`) hoặc BOM Bán thành phẩm (`semi_finished`).
 *  2. Cấp 2 (Gián tiếp qua BTP): Nguyên liệu dùng để pha Bán thành phẩm S, và S nằm trong BOM Thành phẩm Kit F.
 *  3. Nguyên liệu thay thế (`kit.bom_line_substitute`).
 *  4. Định mức Lắp ráp Thiết bị (`device.model_bom_line`).
 */
export async function getMaterialWhereUsedAndCapacity(
  tx: Tx,
  actor: AuthzActor,
  opts: { itemId?: string | null; itemCode?: string | null; q?: string | null }
) {
  const canView =
    actor.isRootAdmin ||
    Boolean(actor.isSalesIntakeUser) ||
    (await hasFactoryPermission(tx, actor, "inv.stock.view")) ||
    (await hasFactoryPermission(tx, actor, "kit.view")) ||
    (await hasFactoryPermission(tx, actor, "master.data.view")) ||
    (await hasFactoryPermission(tx, actor, "device.view")) ||
    (await hasFactoryPermission(tx, actor, "rd.view"));
  if (!canView) {
    await authorize(tx, actor, "inv.stock.view");
  }

  const rawItemId = (opts.itemId ?? "").trim();
  const rawCode = (opts.itemCode ?? "").trim();
  const rawQuery = (opts.q ?? rawCode).trim();

  // 1. Find candidate items matching the search query or item_id / item_code
  let candidates: any[] = [];
  if (rawItemId) {
    candidates = (
      await tx.query(
        `SELECT id, code, name, item_type, base_uom, storage_condition
           FROM master.item
          WHERE id = $1::uuid`,
        [rawItemId]
      )
    ).rows;
  } else if (rawQuery) {
    candidates = (
      await tx.query(
        `SELECT i.id, i.code, i.name, i.item_type, i.base_uom, i.storage_condition,
                (SELECT COUNT(*)::int FROM kit.bom_line bl WHERE bl.component_item_id = i.id) +
                (SELECT COUNT(*)::int FROM device.model_bom_line mbl WHERE mbl.component_item_id = i.id) AS used_in_bom_count
           FROM master.item i
          WHERE upper(i.code) = upper($1)
             OR i.code ILIKE '%' || $1 || '%'
             OR i.name ILIKE '%' || $1 || '%'
          ORDER BY (upper(i.code) = upper($1)) DESC,
                   (i.code ILIKE $1 || '%') DESC,
                   used_in_bom_count DESC,
                   i.code ASC
          LIMIT 25`,
        [rawQuery]
      )
    ).rows;
  } else {
    // Default list: top raw materials / semi-finished items that are used in the most BOMs
    candidates = (
      await tx.query(
        `SELECT i.id, i.code, i.name, i.item_type, i.base_uom, i.storage_condition,
                (SELECT COUNT(*)::int FROM kit.bom_line bl WHERE bl.component_item_id = i.id) +
                (SELECT COUNT(*)::int FROM device.model_bom_line mbl WHERE mbl.component_item_id = i.id) AS used_in_bom_count
           FROM master.item i
          WHERE EXISTS (SELECT 1 FROM kit.bom_line bl WHERE bl.component_item_id = i.id)
             OR EXISTS (SELECT 1 FROM device.model_bom_line mbl WHERE mbl.component_item_id = i.id)
          ORDER BY used_in_bom_count DESC, i.code ASC
          LIMIT 25`
      )
    ).rows;
  }

  const selectedItem =
    (rawCode ? candidates.find((c) => String(c.code).toUpperCase() === rawCode.toUpperCase()) : null) ??
    candidates[0] ??
    null;

  if (!selectedItem) {
    return {
      selected_item: null,
      candidates: [],
      stock_summary: {
        total_on_hand: 0,
        total_reserved: 0,
        available_released_qty: 0,
        quarantine_pending_qty: 0,
      },
      stock_lots: [],
      usages: [],
    };
  }

  // 2. Stock balances & lots of the selected material
  const stockLots = (
    await tx.query(
      `SELECT sb.id,
              w.code AS warehouse_code,
              w.name AS warehouse_name,
              loc.code AS location_code,
              loc.is_quarantine,
              l.id AS lot_id,
              l.code AS lot_code,
              l.status AS lot_status,
              l.expiry_date,
              sb.qty_on_hand::float AS qty_on_hand,
              sb.qty_reserved::float AS qty_reserved,
              GREATEST(0, sb.qty_on_hand - sb.qty_reserved)::float AS qty_available
         FROM inv.stock_balance sb
         JOIN master.location loc ON loc.id = sb.location_id
         JOIN master.warehouse w ON w.id = loc.warehouse_id
         LEFT JOIN inv.lot l ON l.id = sb.lot_id
        WHERE sb.item_id = $1 AND sb.qty_on_hand > 0
        ORDER BY l.expiry_date ASC NULLS LAST, w.code ASC, loc.code ASC`,
      [selectedItem.id]
    )
  ).rows;

  let totalOnHand = 0;
  let totalReserved = 0;
  let availableReleasedQty = 0;
  let quarantinePendingQty = 0;

  for (const row of stockLots) {
    const onHand = Number(row.qty_on_hand || 0);
    const reserved = Number(row.qty_reserved || 0);
    const avail = Math.max(0, onHand - reserved);
    totalOnHand += onHand;
    totalReserved += reserved;
    const isReleasedAndUsable =
      !row.is_quarantine &&
      (!row.lot_status || row.lot_status === "RELEASED") &&
      (!row.expiry_date || String(row.expiry_date).slice(0, 10) >= vnToday());
    if (isReleasedAndUsable) {
      availableReleasedQty += avail;
    } else {
      quarantinePendingQty += onHand;
    }
  }

  // Helper to convert line quantity to selectedItem.base_uom safely
  const convertLineQtyToBase = async (
    itemObj: { id: string; code: string; base_uom: string },
    qty: number,
    lineUom?: string | null
  ): Promise<number> => {
    const u = (lineUom || itemObj.base_uom || "").trim();
    if (!u || !itemObj.base_uom || u.toLowerCase() === itemObj.base_uom.toLowerCase()) return qty;
    await tx.query("SAVEPOINT sp_uom_conv");
    try {
      const converted = await toBaseQty(tx, itemObj, qty, u);
      await tx.query("RELEASE SAVEPOINT sp_uom_conv");
      return converted;
    } catch {
      await tx.query("ROLLBACK TO SAVEPOINT sp_uom_conv").catch(() => {});
      return qty;
    }
  };

  // 3. Direct usages in Kit & Semi-finished BOMs (Tier 1)
  const directKitUsages = (
    await tx.query(
      `SELECT b.id AS bom_id,
              b.code AS bom_code,
              b.name AS bom_name,
              b.bom_version,
              b.status AS bom_status,
              CASE WHEN pi.item_type = 'SEMI_FINISHED' THEN 'semi_finished' ELSE 'finished_good' END AS bom_type,
              COALESCE(b.base_qty, 1)::float AS batch_size,
              b.base_uom AS batch_uom,
              b.tests_per_kit,
              pi.id AS product_item_id,
              pi.code AS product_code,
              pi.name AS product_name,
              pi.item_type AS product_item_type,
              pi.base_uom AS product_uom,
              bl.id AS bom_line_id,
              bl.line_no,
              bl.box_no,
              bl.component_role,
              bl.notes AS line_notes,
              bl.qty_per_base::float AS qty_per_batch,
              bl.uom AS line_uom,
              (COALESCE(bl.scrap_pct, 0)::float / 100.0) AS scrap_factor,
              (bl.component_role = 'PACKAGING') AS is_packaging,
              (NOT COALESCE(bl.is_critical, true)) AS is_optional
         FROM kit.bom_line bl
         JOIN kit.bom b ON b.id = bl.bom_id
         JOIN master.item pi ON pi.id = b.product_item_id
        WHERE bl.component_item_id = $1
          AND b.status <> 'OBSOLETE'
        ORDER BY (b.status = 'EFFECTIVE') DESC,
                 (pi.item_type <> 'SEMI_FINISHED') DESC,
                 pi.code ASC,
                 b.bom_version DESC`,
      [selectedItem.id]
    )
  ).rows;

  // 4. Multi-level Tier 2 usages: Selected Material -> Semi-Finished Product (BTP) -> Finished Kit BOM
  const semiProductIds = Array.from(
    new Set(
      directKitUsages
        .filter((u) => u.bom_type === "semi_finished" || u.product_item_type === "SEMI_FINISHED")
        .map((u) => u.product_item_id as string)
    )
  );

  let tier2ParentUsages: any[] = [];
  if (semiProductIds.length > 0) {
    tier2ParentUsages = (
      await tx.query(
        `SELECT b.id AS parent_bom_id,
                b.code AS parent_bom_code,
                b.name AS parent_bom_name,
                b.bom_version AS parent_bom_version,
                b.status AS parent_bom_status,
                COALESCE(b.base_qty, 1)::float AS parent_batch_size,
                b.base_uom AS parent_batch_uom,
                b.tests_per_kit AS parent_tests_per_kit,
                pi.id AS parent_product_item_id,
                pi.code AS parent_product_code,
                pi.name AS parent_product_name,
                pi.item_type AS parent_product_item_type,
                pi.base_uom AS parent_product_uom,
                bl.component_item_id AS semi_item_id,
                bl.box_no AS parent_box_no,
                bl.component_role AS parent_component_role,
                bl.notes AS parent_line_notes,
                bl.qty_per_base::float AS semi_qty_per_parent_batch,
                bl.uom AS semi_line_uom,
                (COALESCE(bl.scrap_pct, 0)::float / 100.0) AS parent_scrap_factor,
                COALESCE((
                  SELECT SUM(GREATEST(0, sb.qty_on_hand - sb.qty_reserved))::float
                    FROM inv.stock_balance sb
                    JOIN master.location loc ON loc.id = sb.location_id
                    LEFT JOIN inv.lot l ON l.id = sb.lot_id
                   WHERE sb.item_id = bl.component_item_id
                     AND loc.is_quarantine = false
                     AND COALESCE(l.status, 'RELEASED') = 'RELEASED'
                ), 0) AS semi_available_stock
           FROM kit.bom_line bl
           JOIN kit.bom b ON b.id = bl.bom_id
           JOIN master.item pi ON pi.id = b.product_item_id
          WHERE bl.component_item_id = ANY($1::uuid[])
            AND b.status <> 'OBSOLETE'
          ORDER BY (b.status = 'EFFECTIVE') DESC, pi.code ASC`,
        [semiProductIds]
      )
    ).rows;
  }

  // 5. Substitute usages in Kit BOMs
  const substituteUsages = (
    await tx.query(
      `SELECT b.id AS bom_id,
              b.code AS bom_code,
              b.name AS bom_name,
              b.bom_version,
              b.status AS bom_status,
              CASE WHEN pi.item_type = 'SEMI_FINISHED' THEN 'semi_finished' ELSE 'finished_good' END AS bom_type,
              COALESCE(b.base_qty, 1)::float AS batch_size,
              b.base_uom AS batch_uom,
              b.tests_per_kit,
              pi.id AS product_item_id,
              pi.code AS product_code,
              pi.name AS product_name,
              pi.item_type AS product_item_type,
              pi.base_uom AS product_uom,
              bl.box_no,
              bl.component_role,
              bl.notes AS line_notes,
              bl.qty_per_base::float AS base_qty_per_batch,
              bl.uom AS line_uom,
              (COALESCE(bl.scrap_pct, 0)::float / 100.0) AS scrap_factor,
              COALESCE(sub.conversion_factor, 1)::float AS substitute_ratio,
              sub.priority AS substitute_priority,
              orig_i.code AS primary_material_code,
              orig_i.name AS primary_material_name
         FROM kit.bom_line_substitute sub
         JOIN kit.bom_line bl ON bl.id = sub.bom_line_id
         JOIN master.item orig_i ON orig_i.id = bl.component_item_id
         JOIN kit.bom b ON b.id = bl.bom_id
         JOIN master.item pi ON pi.id = b.product_item_id
        WHERE sub.substitute_item_id = $1
          AND b.status <> 'OBSOLETE'
        ORDER BY (b.status = 'EFFECTIVE') DESC, pi.code ASC`,
      [selectedItem.id]
    )
  ).rows;

  // 6. Device Model BOM usages
  const deviceUsages = (
    await tx.query(
      `SELECT dm.id AS model_id,
              dm.code AS product_code,
              dm.name AS product_name,
              mr.id AS revision_id,
              mr.revision AS revision_code,
              mr.status AS bom_status,
              (mr.id = dm.current_revision_id) AS is_current_revision,
              mbl.id AS bom_line_id,
              mbl.station_code,
              mbl.qty_per_unit::float AS qty_per_unit,
              mbl.uom AS line_uom,
              mbl.is_critical,
              mbl.trace_by
         FROM device.model_bom_line mbl
         JOIN device.model_revision mr ON mr.id = mbl.revision_id
         JOIN device.device_model dm ON dm.id = mr.model_id
        WHERE mbl.component_item_id = $1
          AND mr.status <> 'OBSOLETE'
        ORDER BY (mr.id = dm.current_revision_id) DESC, dm.code ASC`,
      [selectedItem.id]
    )
  ).rows;

  const usages: any[] = [];

  for (const u of directKitUsages) {
    const batchSize = Math.max(0.000001, Number(u.batch_size || 1));
    const reqPerBatchInLineUom = Number(u.qty_per_batch || 0) * (1 + Number(u.scrap_factor || 0));
    const reqPerUnitInLineUom = reqPerBatchInLineUom / batchSize;
    const reqPerUnitBase = await convertLineQtyToBase(selectedItem, reqPerUnitInLineUom, u.line_uom);
    const isSemi = u.bom_type === "semi_finished" || u.product_item_type === "SEMI_FINISHED";
    const maxFromAvail =
      reqPerUnitBase > 0
        ? isSemi
          ? Math.floor((availableReleasedQty / reqPerUnitBase) * 100) / 100
          : Math.floor(availableReleasedQty / reqPerUnitBase)
        : 0;
    const maxFromTotal =
      reqPerUnitBase > 0
        ? isSemi
          ? Math.floor((totalOnHand / reqPerUnitBase) * 100) / 100
          : Math.floor(totalOnHand / reqPerUnitBase)
        : 0;

    const whereLabel = [
      u.box_no ? `Hộp ${u.box_no}` : null,
      u.component_role ? `Vai trò: ${u.component_role}` : null,
      u.line_notes ? u.line_notes : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Thành phần chính";

    usages.push({
      usage_key: `KIT-T1-${u.bom_id}-${u.bom_line_id}`,
      domain: isSemi ? "SEMI_FINISHED" : "FINISHED_KIT",
      tier_level: 1,
      tier_label: isSemi ? "Cấp 1 — Pha Bán thành phẩm (BTP)" : "Cấp 1 — Trực tiếp trong BOM Kit",
      product_item_id: u.product_item_id,
      product_code: u.product_code,
      product_name: u.product_name,
      product_uom: u.product_uom || u.batch_uom || "Bộ",
      tests_per_kit: u.tests_per_kit,
      bom_id: u.bom_id,
      bom_code: `${u.bom_code} (v${u.bom_version})`,
      bom_status: u.bom_status,
      where_in_product: whereLabel,
      qty_per_product_unit: Number(reqPerUnitBase.toFixed(6)),
      material_uom: selectedItem.base_uom,
      scrap_factor: Number(u.scrap_factor || 0),
      max_producible_available: maxFromAvail,
      max_producible_total: maxFromTotal,
      is_optional: u.is_optional,
    });

    // If this is a semi-finished BOM, also emit Tier 2 rows for every Finished Kit that consumes this semi-finished product
    if (isSemi) {
      const semiItemObj = {
        id: u.product_item_id as string,
        code: u.product_code as string,
        base_uom: (u.product_uom || u.batch_uom || "mL") as string,
      };
      const children = tier2ParentUsages.filter((p) => p.semi_item_id === u.product_item_id);
      for (const p of children) {
        const parentBatchSize = Math.max(0.000001, Number(p.parent_batch_size || 1));
        const semiPerParentUnitInLineUom =
          (Number(p.semi_qty_per_parent_batch || 0) * (1 + Number(p.parent_scrap_factor || 0))) / parentBatchSize;
        const semiPerParentUnitBase = await convertLineQtyToBase(
          semiItemObj,
          semiPerParentUnitInLineUom,
          p.semi_line_uom
        );
        const rawPerParentUnit = reqPerUnitBase * semiPerParentUnitBase;
        const maxKitFromRawAvail = rawPerParentUnit > 0 ? Math.floor(availableReleasedQty / rawPerParentUnit) : 0;
        const maxKitFromRawTotal = rawPerParentUnit > 0 ? Math.floor(totalOnHand / rawPerParentUnit) : 0;
        const extraKitFromSemiStock =
          semiPerParentUnitBase > 0 ? Math.floor(Number(p.semi_available_stock || 0) / semiPerParentUnitBase) : 0;

        usages.push({
          usage_key: `KIT-T2-${u.bom_id}-${p.parent_bom_id}-${p.semi_item_id}`,
          domain: "FINISHED_KIT",
          tier_level: 2,
          tier_label: `Cấp 2 — Qua BTP ${u.product_code} (${u.product_name})`,
          product_item_id: p.parent_product_item_id,
          product_code: p.parent_product_code,
          product_name: p.parent_product_name,
          product_uom: p.parent_product_uom || p.parent_batch_uom || "Bộ",
          tests_per_kit: p.parent_tests_per_kit,
          bom_id: p.parent_bom_id,
          bom_code: `${p.parent_bom_code} (v${p.parent_bom_version})`,
          bom_status: p.parent_bom_status,
          where_in_product: `Pha BTP ${u.product_code} (${Number(reqPerUnitBase.toFixed(6))} ${selectedItem.base_uom}/${semiItemObj.base_uom}) ➔ Hộp ${p.parent_box_no || 1} (${Number(semiPerParentUnitBase.toFixed(4))} ${semiItemObj.base_uom}/${p.parent_product_uom || "Bộ"})`,
          qty_per_product_unit: Number(rawPerParentUnit.toFixed(6)),
          material_uom: selectedItem.base_uom,
          scrap_factor: Number(u.scrap_factor || 0),
          max_producible_available: maxKitFromRawAvail,
          max_producible_total: maxKitFromRawTotal,
          extra_producible_from_semi_stock: extraKitFromSemiStock,
          semi_code: u.product_code,
          semi_available_stock: Number(p.semi_available_stock || 0),
          is_optional: false,
        });
      }
    }
  }

  for (const sub of substituteUsages) {
    const batchSize = Math.max(0.000001, Number(sub.batch_size || 1));
    const reqInLineUom =
      (Number(sub.base_qty_per_batch || 0) *
        Number(sub.substitute_ratio || 1) *
        (1 + Number(sub.scrap_factor || 0))) /
      batchSize;
    const reqPerUnitBase = await convertLineQtyToBase(selectedItem, reqInLineUom, sub.line_uom);
    const isSemi = sub.bom_type === "semi_finished" || sub.product_item_type === "SEMI_FINISHED";
    usages.push({
      usage_key: `KIT-SUB-${sub.bom_id}-${sub.primary_material_code}`,
      domain: isSemi ? "SEMI_FINISHED" : "FINISHED_KIT",
      tier_level: 1,
      tier_label: `NVL Thay thế (Thay cho ${sub.primary_material_code})`,
      product_item_id: sub.product_item_id,
      product_code: sub.product_code,
      product_name: sub.product_name,
      product_uom: sub.product_uom || sub.batch_uom || "Bộ",
      tests_per_kit: sub.tests_per_kit,
      bom_id: sub.bom_id,
      bom_code: `${sub.bom_code} (v${sub.bom_version})`,
      bom_status: sub.bom_status,
      where_in_product: `Hộp ${sub.box_no || 1} · ${sub.component_role || "REAGENT"} (Tỷ lệ thay thế: ${sub.substitute_ratio})`,
      qty_per_product_unit: Number(reqPerUnitBase.toFixed(6)),
      material_uom: selectedItem.base_uom,
      scrap_factor: Number(sub.scrap_factor || 0),
      max_producible_available: reqPerUnitBase > 0 ? Math.floor(availableReleasedQty / reqPerUnitBase) : 0,
      max_producible_total: reqPerUnitBase > 0 ? Math.floor(totalOnHand / reqPerUnitBase) : 0,
      is_optional: true,
    });
  }

  for (const d of deviceUsages) {
    const reqInLineUom = Number(d.qty_per_unit || 0);
    const reqPerUnitBase = await convertLineQtyToBase(selectedItem, reqInLineUom, d.line_uom);
    usages.push({
      usage_key: `DEV-${d.revision_id}-${d.bom_line_id}`,
      domain: "DEVICE",
      tier_level: 1,
      tier_label: "Cấp 1 — Linh kiện Lắp ráp Thiết bị",
      product_item_id: d.model_id,
      product_code: d.product_code,
      product_name: d.product_name,
      product_uom: "Máy",
      tests_per_kit: null,
      bom_id: d.revision_id,
      bom_code: `DMR Rev ${d.revision_code}${d.is_current_revision ? " (Hiện hành)" : ""}`,
      bom_status: d.bom_status,
      where_in_product: `Trạm lắp ráp: ${d.station_code}${d.is_critical ? " (Trọng yếu)" : ""}`,
      qty_per_product_unit: Number(reqPerUnitBase.toFixed(6)),
      material_uom: selectedItem.base_uom,
      scrap_factor: 0,
      max_producible_available: reqPerUnitBase > 0 ? Math.floor(availableReleasedQty / reqPerUnitBase) : 0,
      max_producible_total: reqPerUnitBase > 0 ? Math.floor(totalOnHand / reqPerUnitBase) : 0,
      is_optional: false,
    });
  }

  return {
    selected_item: selectedItem,
    candidates,
    stock_summary: {
      total_on_hand: Number(totalOnHand.toFixed(4)),
      total_reserved: Number(totalReserved.toFixed(4)),
      available_released_qty: Number(availableReleasedQty.toFixed(4)),
      quarantine_pending_qty: Number(quarantinePendingQty.toFixed(4)),
    },
    stock_lots: stockLots,
    usages,
  };
}

import { z } from "zod";
import type { Tx } from "../core/db";
import { authorizeAnywhere, SYSTEM_ACTOR, type AuthzActor } from "../core/authz";
import { vnToday } from "../core/dates";
import { invalid, notFound } from "../core/errors";
import { parseInput } from "../core/records";
import { runTransition } from "../core/stateMachine";
import { dispatchInterWarehouseFefo, ensureWarehouseOpsSchema } from "../inv/warehouseOps";
import { createRequest, prMachine } from "./requests";
import { createOrder, poMachine, syncRequestStatus } from "./orders";
import "./permissions";
import "../inv/permissions";

export async function ensureSupplyChainSchema(tx: Tx): Promise<void> {
  await ensureWarehouseOpsSchema(tx);
  await tx.query(`
    ALTER TABLE purchase.purchase_request ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'NORMAL';
    ALTER TABLE master.partner ADD COLUMN IF NOT EXISTS asl_status TEXT NOT NULL DEFAULT 'APPROVED';
    ALTER TABLE master.partner ADD COLUMN IF NOT EXISTS lead_time_days INT NOT NULL DEFAULT 7;
    ALTER TABLE master.partner ADD COLUMN IF NOT EXISTS category_domain TEXT NOT NULL DEFAULT 'BIOCHEM';
  `);

  // Ensure at least 1 sample Urgent PR (fulfillable from KHO-TONG) exists for demonstration
  const openPrLineCount = Number(
    (
      await tx.query(
        `SELECT count(*)::int AS c
           FROM purchase.purchase_request_line l
           JOIN purchase.purchase_request pr ON pr.id = l.pr_id
          WHERE pr.status IN ('DRAFT', 'SUBMITTED', 'APPROVED') AND l.qty > l.qty_ordered`
      )
    ).rows[0]?.c ?? 0
  );
  if (openPrLineCount === 0) {
    const hubStockRow = (
      await tx.query(
        `SELECT b.item_id, i.code, i.name, i.base_uom, (b.qty_on_hand - b.qty_reserved)::float AS avail
           FROM inv.stock_balance b
           JOIN master.location loc ON loc.id = b.location_id
           JOIN master.warehouse w ON w.id = loc.warehouse_id
           JOIN master.item i ON i.id = b.item_id
           LEFT JOIN inv.lot lot ON lot.id = b.lot_id
          WHERE w.code = 'KHO-TONG'
            AND loc.is_quarantine = false
            AND COALESCE(lot.status, 'RELEASED') = 'RELEASED'
            AND i.is_purchasable = true
            AND (b.qty_on_hand - b.qty_reserved) > 0
          ORDER BY (b.qty_on_hand - b.qty_reserved) DESC LIMIT 1`
      )
    ).rows[0];
    const kitWh = (
      await tx.query("SELECT id, owner_org_unit_id FROM master.warehouse WHERE code = 'KHO-KIT' AND status = 'ACTIVE' LIMIT 1")
    ).rows[0];
    if (hubStockRow && kitWh) {
      const reqQty = Math.max(1, Math.min(20, Math.round(Number(hubStockRow.avail) / 2)));
      const pr = await createRequest(
        tx,
        { userId: 1, name: "Hệ thống", isRootAdmin: true, isPortalAdmin: true },
        {
          org_unit_id: kitWh.owner_org_unit_id,
          target_warehouse_id: kitWh.id,
          needed_by: vnToday(),
          reason: `[Cấp tốc SX Kit] Cần bổ sung ${hubStockRow.code} (${hubStockRow.name}) cho mẻ sản xuất Kit trong tuần`,
          lines: [{ item_id: hubStockRow.item_id, qty: reqQty, uom: hubStockRow.base_uom, est_price: 250000 }],
        }
      );
      await tx.query(
        "UPDATE purchase.purchase_request SET status = 'APPROVED', priority = 'URGENT', approved_by = 1 WHERE id = $1",
        [pr.id]
      );
    }
  }
}

export async function getSupplyChainOverview(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "purchase.pr.view");
  await ensureSupplyChainSchema(tx);
  const today = vnToday();

  const defaultSupplier = (
    await tx.query("SELECT id, code, name FROM master.partner WHERE is_supplier = true AND status = 'ACTIVE' ORDER BY code LIMIT 1")
  ).rows[0];

  const open_pr_lines_dispatch = (
    await tx.query(
      `SELECT l.id AS pr_line_id, pr.id AS pr_id, pr.code AS pr_code, pr.status AS pr_status,
              COALESCE(pr.priority, 'NORMAL') AS priority,
              pr.needed_by::text AS needed_by,
              CASE WHEN pr.needed_by IS NOT NULL THEN (pr.needed_by - $1::date)::int ELSE NULL END AS days_until_needed,
              pr.reason, pr.version AS pr_version, pr.requires_bod,
              o.id AS org_unit_id, o.code AS org_unit_code, o.name AS org_unit_name,
              w.id AS warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
              i.id AS item_id, i.code AS item_code, i.name AS item_name, l.uom,
              l.qty::float AS qty_requested, l.qty_ordered::float AS qty_ordered,
              (l.qty - l.qty_ordered)::float AS qty_open,
              COALESCE(
                l.est_price::float,
                (SELECT pol.unit_price::float FROM purchase.purchase_order_line pol WHERE pol.item_id = i.id AND pol.unit_price > 0 ORDER BY pol.id DESC LIMIT 1),
                180000
              ) AS suggested_price,
              COALESCE((
                SELECT sum(b.qty_on_hand - b.qty_reserved)::float
                  FROM inv.stock_balance b
                  JOIN master.location loc ON loc.id = b.location_id
                  JOIN master.warehouse wh ON wh.id = loc.warehouse_id
                  LEFT JOIN inv.lot lot ON lot.id = b.lot_id
                 WHERE b.item_id = i.id
                   AND wh.code = 'KHO-TONG'
                   AND loc.is_quarantine = false
                   AND COALESCE(lot.status, 'RELEASED') = 'RELEASED'
                   AND (b.qty_on_hand - b.qty_reserved) > 0
              ), 0) AS hub_available_qty,
              COALESCE((
                SELECT sum(b.qty_on_hand - b.qty_reserved)::float
                  FROM inv.stock_balance b
                  JOIN master.location loc ON loc.id = b.location_id
                  LEFT JOIN inv.lot lot ON lot.id = b.lot_id
                 WHERE b.item_id = i.id
                   AND loc.warehouse_id = w.id
                   AND loc.is_quarantine = false
                   AND COALESCE(lot.status, 'RELEASED') = 'RELEASED'
                   AND (b.qty_on_hand - b.qty_reserved) > 0
              ), 0) AS dept_available_qty
         FROM purchase.purchase_request_line l
         JOIN purchase.purchase_request pr ON pr.id = l.pr_id
         JOIN core.org_unit o ON o.id = pr.org_unit_id
         JOIN master.warehouse w ON w.id = pr.target_warehouse_id
         JOIN master.item i ON i.id = l.item_id
        WHERE pr.status IN ('DRAFT', 'SUBMITTED', 'PENDING_BOD', 'APPROVED', 'ORDERED')
          AND l.qty > l.qty_ordered
        ORDER BY
          CASE COALESCE(pr.priority, 'NORMAL') WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END,
          pr.needed_by ASC NULLS LAST,
          pr.created_at DESC
        LIMIT 60`,
      [today]
    )
  ).rows;

  const mrp_shortage_radar = (
    await tx.query(
      `SELECT * FROM (
         SELECT i.id AS item_id, i.code AS item_code, i.name AS item_name, i.item_type, i.base_uom,
                COALESCE(i.min_safety_stock, 10)::float AS min_safety_stock,
                COALESCE(i.reorder_qty, 50)::float AS reorder_qty,
                COALESCE(i.lead_time_days, 14)::int AS lead_time_days,
                COALESCE((
                  SELECT sum(b.qty_on_hand - b.qty_reserved)::float
                    FROM inv.stock_balance b
                    JOIN master.location loc ON loc.id = b.location_id
                    JOIN master.warehouse w ON w.id = loc.warehouse_id
                    LEFT JOIN inv.lot lot ON lot.id = b.lot_id
                   WHERE b.item_id = i.id
                     AND w.code = 'KHO-TONG'
                     AND loc.is_quarantine = false
                     AND COALESCE(lot.status, 'RELEASED') = 'RELEASED'
                     AND (b.qty_on_hand - b.qty_reserved) > 0
                ), 0) AS hub_available,
                COALESCE((
                  SELECT sum(b.qty_on_hand - b.qty_reserved)::float
                    FROM inv.stock_balance b
                    JOIN master.location loc ON loc.id = b.location_id
                    JOIN master.warehouse w ON w.id = loc.warehouse_id
                    LEFT JOIN inv.lot lot ON lot.id = b.lot_id
                   WHERE b.item_id = i.id
                     AND w.code <> 'KHO-TONG'
                     AND loc.is_quarantine = false
                     AND COALESCE(lot.status, 'RELEASED') = 'RELEASED'
                     AND (b.qty_on_hand - b.qty_reserved) > 0
                ), 0) AS branch_available,
                COALESCE((
                  SELECT sum(prl.qty - prl.qty_ordered)::float
                    FROM purchase.purchase_request_line prl
                    JOIN purchase.purchase_request pr ON pr.id = prl.pr_id
                   WHERE prl.item_id = i.id
                     AND pr.status IN ('DRAFT', 'SUBMITTED', 'PENDING_BOD', 'APPROVED')
                     AND prl.qty > prl.qty_ordered
                ), 0) AS open_pr_qty,
                COALESCE((
                  SELECT sum(pol.qty_ordered - pol.qty_received)::float
                    FROM purchase.purchase_order_line pol
                    JOIN purchase.purchase_order po ON po.id = pol.po_id
                   WHERE pol.item_id = i.id
                     AND po.status IN ('DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED')
                     AND pol.qty_ordered > pol.qty_received
                ), 0) AS open_po_qty,
                COALESCE(
                  (SELECT pol.unit_price::float FROM purchase.purchase_order_line pol WHERE pol.item_id = i.id AND pol.unit_price > 0 ORDER BY pol.id DESC LIMIT 1),
                  220000
                ) AS last_price
           FROM master.item i
          WHERE i.status = 'ACTIVE' AND i.is_purchasable = true
       ) sub
       ORDER BY ((sub.hub_available + sub.branch_available + sub.open_po_qty) - sub.min_safety_stock) ASC, sub.item_code ASC
       LIMIT 25`
    )
  ).rows.map((r) => ({
    ...r,
    preferred_supplier_id: defaultSupplier?.id ?? null,
    preferred_supplier_name: defaultSupplier?.name ?? "NCC Chuẩn ASL",
  }));

  const active_pos_tracking = (
    await tx.query(
      `SELECT po.id, po.code, po.status, po.order_date::text AS order_date,
              po.expected_date::text AS expected_date,
              CASE WHEN po.expected_date IS NOT NULL THEN (po.expected_date - $1::date)::int ELSE NULL END AS days_to_eta,
              po.total_amount::float AS total_amount,
              p.id AS supplier_id, p.code AS supplier_code, p.name AS supplier_name,
              (SELECT count(*)::int FROM purchase.purchase_order_line l WHERE l.po_id = po.id) AS line_count,
              (SELECT COALESCE(sum(l.qty_ordered - l.qty_received), 0)::float FROM purchase.purchase_order_line l WHERE l.po_id = po.id) AS qty_remaining
         FROM purchase.purchase_order po
         JOIN master.partner p ON p.id = po.supplier_id
        WHERE po.status IN ('DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED')
        ORDER BY po.expected_date ASC NULLS LAST, po.created_at DESC
        LIMIT 30`,
      [today]
    )
  ).rows;

  const supplier_scorecard = (
    await tx.query(
      `SELECT p.id, p.code, p.name, p.tax_code, p.is_supplier, p.is_subcontractor,
              p.address, p.payment_terms,
              COALESCE(p.asl_status, 'APPROVED') AS asl_status,
              COALESCE(p.lead_time_days, 7)::int AS lead_time_days,
              COALESCE(p.category_domain, 'BIOCHEM') AS category_domain,
              (SELECT count(*)::int FROM purchase.purchase_order po WHERE po.supplier_id = p.id AND po.status <> 'CANCELLED') AS po_count,
              (SELECT COALESCE(sum(po.total_amount), 0)::float FROM purchase.purchase_order po WHERE po.supplier_id = p.id AND po.status <> 'CANCELLED') AS total_spend,
              (SELECT count(*)::int FROM inv.lot lot WHERE lot.supplier_id = p.id) AS total_lots,
              (SELECT count(*)::int FROM inv.lot lot WHERE lot.supplier_id = p.id AND lot.status = 'RELEASED') AS released_lots,
              (SELECT count(*)::int FROM inv.lot lot WHERE lot.supplier_id = p.id AND lot.status = 'REJECTED') AS rejected_lots
         FROM master.partner p
        WHERE p.status = 'ACTIVE'
        ORDER BY p.code ASC`
    )
  ).rows.map((s) => {
    const totalChecked = Number(s.released_lots) + Number(s.rejected_lots);
    const iqc_pass_pct = totalChecked > 0 ? Math.round((Number(s.released_lots) / totalChecked) * 100) : 100;
    const otd_pct = s.asl_status === "CONDITIONAL" ? 85 : s.asl_status === "DISQUALIFIED" ? 60 : 96;
    return {
      ...s,
      iqc_pass_pct,
      otd_pct,
    };
  });

  const kpis = {
    urgent_pr_count: open_pr_lines_dispatch.filter((x) => x.priority === "URGENT" || (x.days_until_needed !== null && x.days_until_needed <= 3)).length,
    open_inbox_lines_count: open_pr_lines_dispatch.filter((x) => ["APPROVED", "ORDERED"].includes(x.pr_status)).length,
    hub_fulfillable_lines_count: open_pr_lines_dispatch.filter((x) => x.warehouse_code !== "KHO-TONG" && Number(x.hub_available_qty) > 0).length,
    active_po_count: active_pos_tracking.length,
    overdue_po_count: active_pos_tracking.filter((p) => p.days_to_eta !== null && p.days_to_eta < 0).length,
    low_stock_items_count: mrp_shortage_radar.filter((m) => Number(m.hub_available) + Number(m.branch_available) < Number(m.min_safety_stock)).length,
  };

  return {
    kpis,
    open_pr_lines_dispatch,
    mrp_shortage_radar,
    active_pos_tracking,
    supplier_scorecard,
  };
}

const fulfillFromHubSchema = z.object({
  pr_line_id: z.string().uuid(),
  qty: z.coerce.number().positive().optional(),
});

/**
 * Fulfill an open PR line directly from `KHO-TONG · A1` (FEFO Inter-Warehouse Transfer)
 * without needing to buy externally!
 */
export async function fulfillPrLineFromCentralHub(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(fulfillFromHubSchema, input);
  const line = (
    await tx.query(
      `SELECT l.id, l.pr_id, l.item_id, l.uom, (l.qty - l.qty_ordered)::float AS qty_open,
              pr.code AS pr_code, pr.target_warehouse_id, w.code AS warehouse_code
         FROM purchase.purchase_request_line l
         JOIN purchase.purchase_request pr ON pr.id = l.pr_id
         JOIN master.warehouse w ON w.id = pr.target_warehouse_id
        WHERE l.id = $1 FOR UPDATE OF l`,
      [d.pr_line_id]
    )
  ).rows[0];
  if (!line) throw notFound("Dòng đề nghị mua");
  if (line.warehouse_code === "KHO-TONG") {
    throw invalid("Đề nghị này vốn dành cho Kho Trung Tâm (KHO-TONG), vui lòng đặt PO mua hàng từ Nhà cung cấp.");
  }

  const khoTong = (await tx.query("SELECT id FROM master.warehouse WHERE code = 'KHO-TONG' AND status = 'ACTIVE' LIMIT 1")).rows[0];
  if (!khoTong) throw notFound("Kho Trung Tâm KHO-TONG");

  const availRes = (
    await tx.query(
      `SELECT COALESCE(sum(b.qty_on_hand - b.qty_reserved), 0)::float AS avail
         FROM inv.stock_balance b
         JOIN master.location loc ON loc.id = b.location_id
         LEFT JOIN inv.lot lot ON lot.id = b.lot_id
        WHERE loc.warehouse_id = $1
          AND b.item_id = $2
          AND loc.is_quarantine = false
          AND COALESCE(lot.status, 'RELEASED') = 'RELEASED'
          AND (b.qty_on_hand - b.qty_reserved) > 0`,
      [khoTong.id, line.item_id]
    )
  ).rows[0];
  const maxTransfer = Math.min(Number(line.qty_open), Number(availRes?.avail ?? 0));
  const transferQty = d.qty ? Math.min(d.qty, maxTransfer) : maxTransfer;
  if (!(transferQty > 0)) {
    throw invalid("Kho Trung Tâm (KHO-TONG · A1) hiện không có sẵn tồn khả dụng cho vật tư này.");
  }

  const dispatchResult = await dispatchInterWarehouseFefo(tx, actor, {
    source_warehouse_id: khoTong.id,
    target_warehouse_id: line.target_warehouse_id,
    item_id: line.item_id,
    qty: transferQty,
    notes: `[Cấp phát nội bộ thay mua hàng] Đáp ứng tức thì đề nghị ${line.pr_code} từ KHO-TONG sang ${line.warehouse_code}`,
  });

  await tx.query("UPDATE purchase.purchase_request_line SET qty_ordered = qty_ordered + $2 WHERE id = $1", [line.id, transferQty]);
  await syncRequestStatus(tx, SYSTEM_ACTOR, [line.pr_id]);

  return {
    transferred_qty: transferQty,
    document_code: dispatchResult.document.code,
    to_warehouse: line.warehouse_code,
  };
}

const fastTrackPrSchema = z.object({
  pr_id: z.string().uuid(),
  priority: z.enum(["URGENT", "HIGH", "NORMAL"]).optional(),
});

export async function fastTrackApprovePr(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureSupplyChainSchema(tx);
  const d = parseInput(fastTrackPrSchema, input);
  let pr = (await tx.query("SELECT * FROM purchase.purchase_request WHERE id = $1 FOR UPDATE", [d.pr_id])).rows[0];
  if (!pr) throw notFound("Đề nghị mua (PR)");

  if (d.priority) {
    await tx.query("UPDATE purchase.purchase_request SET priority = $2 WHERE id = $1", [pr.id, d.priority]);
  }
  if (pr.status === "DRAFT") {
    pr = await runTransition(tx, prMachine, SYSTEM_ACTOR, { id: pr.id, action: "submit", expectedVersion: pr.version }, { trusted: true });
  }
  if (pr.status === "SUBMITTED") {
    if (pr.requires_bod) {
      pr = await runTransition(tx, prMachine, SYSTEM_ACTOR, { id: pr.id, action: "escalate", expectedVersion: pr.version }, { trusted: true });
    } else {
      pr = await runTransition(tx, prMachine, SYSTEM_ACTOR, { id: pr.id, action: "approve", expectedVersion: pr.version }, { trusted: true });
    }
  }
  return pr;
}

const directReplenishPoSchema = z.object({
  item_id: z.string().uuid(),
  qty: z.coerce.number().positive(),
  unit_price: z.coerce.number().min(0).default(200000),
  supplier_id: z.string().uuid().optional().nullable(),
  priority: z.enum(["URGENT", "HIGH", "NORMAL"]).default("HIGH"),
  issue_immediately: z.boolean().default(true),
});

export async function createDirectReplenishmentPo(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureSupplyChainSchema(tx);
  const d = parseInput(directReplenishPoSchema, input);

  const khoTong = (await tx.query("SELECT id, code, owner_org_unit_id FROM master.warehouse WHERE code = 'KHO-TONG' AND status = 'ACTIVE' LIMIT 1")).rows[0];
  if (!khoTong) throw notFound("Kho Trung Tâm KHO-TONG");

  const item = (await tx.query("SELECT id, code, name, base_uom FROM master.item WHERE id = $1", [d.item_id])).rows[0];
  if (!item) throw notFound("Vật tư");

  const supplier = d.supplier_id
    ? (await tx.query("SELECT id, code, name, lead_time_days FROM master.partner WHERE id = $1", [d.supplier_id])).rows[0]
    : (await tx.query("SELECT id, code, name, lead_time_days FROM master.partner WHERE is_supplier = true AND status = 'ACTIVE' ORDER BY code LIMIT 1")).rows[0];
  if (!supplier) throw invalid("Chưa có Nhà cung cấp hoạt động trong danh mục.");

  const pr = await createRequest(tx, SYSTEM_ACTOR, {
    org_unit_id: khoTong.owner_org_unit_id,
    target_warehouse_id: khoTong.id,
    reason: `[MRP Auto-Replenishment] Bù tồn kho an toàn cho ${item.code} — ${item.name}`,
    lines: [{ item_id: item.id, qty: d.qty, uom: item.base_uom, est_price: d.unit_price }],
  });
  await tx.query("UPDATE purchase.purchase_request SET priority = $2 WHERE id = $1", [pr.id, d.priority]);
  const submitted = await runTransition(tx, prMachine, SYSTEM_ACTOR, { id: pr.id, action: "submit", expectedVersion: pr.version }, { trusted: true });
  const approved = submitted.requires_bod
    ? await (async () => {
        const esc = await runTransition(tx, prMachine, SYSTEM_ACTOR, { id: pr.id, action: "escalate", expectedVersion: submitted.version }, { trusted: true });
        return runTransition(tx, prMachine, SYSTEM_ACTOR, { id: pr.id, action: "bod_approve", expectedVersion: esc.version }, { trusted: true });
      })()
    : await runTransition(tx, prMachine, SYSTEM_ACTOR, { id: pr.id, action: "approve", expectedVersion: submitted.version }, { trusted: true });

  const prLine = (await tx.query("SELECT id FROM purchase.purchase_request_line WHERE pr_id = $1 LIMIT 1", [approved.id])).rows[0];
  const po = await createOrder(tx, SYSTEM_ACTOR, {
    supplier_id: supplier.id,
    expected_date: vnToday(),
    payment_terms: "Chuyển khoản 30 ngày (Hợp đồng khung ASL)",
    lines: [{ pr_line_id: prLine.id, qty: d.qty, unit_price: d.unit_price, vat_rate: 8 }],
  });

  if (d.issue_immediately) {
    const issued = await runTransition(tx, poMachine, SYSTEM_ACTOR, { id: po.id, action: "issue", expectedVersion: po.version }, { trusted: true });
    return { pr_code: approved.code, po: issued };
  }
  return { pr_code: approved.code, po };
}

const updateSupplierAslSchema = z.object({
  partner_id: z.string().uuid(),
  asl_status: z.enum(["APPROVED", "CONDITIONAL", "DISQUALIFIED"]),
  lead_time_days: z.coerce.number().int().min(1).max(180).default(7),
  category_domain: z.enum(["BIOCHEM", "PACKAGING", "ELECTRONICS", "SUBCONTRACT"]).default("BIOCHEM"),
});

export async function updateSupplierAsl(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorizeAnywhere(tx, actor, "purchase.po.manage");
  await ensureSupplyChainSchema(tx);
  const d = parseInput(updateSupplierAslSchema, input);
  const upd = (
    await tx.query(
      `UPDATE master.partner
          SET asl_status = $2, lead_time_days = $3, category_domain = $4, updated_at = now(), updated_by = $5
        WHERE id = $1 RETURNING *`,
      [d.partner_id, d.asl_status, d.lead_time_days, d.category_domain, actor.userId]
    )
  ).rows[0];
  if (!upd) throw notFound("Nhà cung cấp");
  return upd;
}

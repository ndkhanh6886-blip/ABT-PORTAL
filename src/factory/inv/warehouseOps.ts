import { z } from "zod";
import type { Tx } from "../core/db";
import { authorizeAnywhere, SYSTEM_ACTOR, type AuthzActor } from "../core/authz";
import { vnToday } from "../core/dates";
import { invalid, notFound } from "../core/errors";
import { writeAudit } from "../core/audit";
import { parseInput } from "../core/records";
import { runTransition } from "../core/stateMachine";
import { createStockDocument, stockDocumentMachine } from "./documents";
import { createLot, lotMachine } from "./lots";
import { createRequest, prMachine } from "../purchase/requests";
import "./permissions";
import "../purchase/permissions";

export async function ensureWarehouseOpsSchema(tx: Tx): Promise<void> {
  await tx.query(`
    ALTER TABLE master.item ADD COLUMN IF NOT EXISTS min_safety_stock NUMERIC(18,6) NOT NULL DEFAULT 10;
    ALTER TABLE master.item ADD COLUMN IF NOT EXISTS reorder_qty NUMERIC(18,6) NOT NULL DEFAULT 50;
    ALTER TABLE master.item ADD COLUMN IF NOT EXISTS lead_time_days INT NOT NULL DEFAULT 14;
  `);

  const khoTong = (
    await tx.query(
      `SELECT w.id,
              (SELECT l.id FROM master.location l WHERE l.warehouse_id = w.id AND l.is_quarantine = false AND l.status = 'ACTIVE' ORDER BY l.code LIMIT 1) AS a1_id,
              (SELECT l.id FROM master.location l WHERE l.warehouse_id = w.id AND l.is_quarantine = true AND l.status = 'ACTIVE' ORDER BY l.code LIMIT 1) AS bt_id
         FROM master.warehouse w
        WHERE w.code = 'KHO-TONG' AND w.status = 'ACTIVE' LIMIT 1`
    )
  ).rows[0];

  if (khoTong && khoTong.a1_id && khoTong.bt_id) {
    const cnt = Number(
      (
        await tx.query(
          "SELECT count(*)::int AS c FROM inv.stock_balance b JOIN master.location l ON l.id = b.location_id WHERE l.warehouse_id = $1 AND b.qty_on_hand > 0",
          [khoTong.id]
        )
      ).rows[0]?.c ?? 0
    );
    if (cnt === 0) {
      const sampleItems = (
        await tx.query(
          "SELECT id, code, base_uom FROM master.item WHERE status = 'ACTIVE' AND is_purchasable = true AND tracking = 'LOT' ORDER BY code LIMIT 4"
        )
      ).rows;
      const rootActor: AuthzActor = { userId: 1, name: "Hệ thống", isRootAdmin: true, isPortalAdmin: true };
      const lines: any[] = [];
      for (const [idx, it] of sampleItems.entries()) {
        const lotCode = `LOT-HUB-2610-0${idx + 1}`;
        let lot = (await tx.query("SELECT * FROM inv.lot WHERE code = $1 LIMIT 1", [lotCode])).rows[0];
        if (!lot) {
          lot = await createLot(tx, rootActor, {
            item_id: it.id,
            origin: "OPENING",
            code: lotCode,
            mfr_lot_no: `MFR-HUB-0${idx + 1}`,
            mfg_date: "2026-09-01",
            expiry_date: idx === 0 ? "2026-12-15" : "2027-09-01",
          });
        }
        await tx.query("UPDATE inv.lot SET status = 'RELEASED' WHERE id = $1", [lot.id]);
        lines.push({
          item_id: it.id,
          lot_id: lot.id,
          to_location_id: idx === 3 ? khoTong.bt_id : khoTong.a1_id,
          qty: idx === 3 ? 120 : 500,
          uom: it.base_uom,
        });
      }
      if (lines.length > 0) {
        const doc = await createStockDocument(
          tx,
          rootActor,
          {
            doc_type: "RECEIPT",
            reason_code: "OPENING",
            warehouse_id: khoTong.id,
            notes: "Tồn kho đầu kỳ tại Kho Trung Tâm KHO-TONG (A1 & BT chờ Put-Away)",
            lines,
          },
          { trusted: true }
        );
        await runTransition(tx, stockDocumentMachine, rootActor, { id: doc.id, action: "post", expectedVersion: doc.version }, { trusted: true });
      }
    }
  }
}

export async function getWarehouseHubOverview(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "inv.stock.view");
  await ensureWarehouseOpsSchema(tx);
  const today = vnToday();

  const warehouses = (
    await tx.query(
      `SELECT w.id, w.code, w.name, w.purpose, w.owner_org_unit_id,
              ou.code AS owner_code, ou.name AS owner_name, ou.module_key AS owner_module_key,
              (SELECT id FROM master.location l WHERE l.warehouse_id = w.id AND l.is_quarantine = true AND l.status = 'ACTIVE' ORDER BY l.code LIMIT 1) AS bt_location_id,
              (SELECT code FROM master.location l WHERE l.warehouse_id = w.id AND l.is_quarantine = true AND l.status = 'ACTIVE' ORDER BY l.code LIMIT 1) AS bt_location_code,
              (SELECT id FROM master.location l WHERE l.warehouse_id = w.id AND l.is_quarantine = false AND l.status = 'ACTIVE' ORDER BY l.code LIMIT 1) AS a1_location_id,
              (SELECT code FROM master.location l WHERE l.warehouse_id = w.id AND l.is_quarantine = false AND l.status = 'ACTIVE' ORDER BY l.code LIMIT 1) AS a1_location_code,
              (SELECT count(DISTINCT b.lot_id)::int
                 FROM inv.stock_balance b
                 JOIN master.location loc ON loc.id = b.location_id
                 LEFT JOIN inv.lot lot ON lot.id = b.lot_id
                WHERE loc.warehouse_id = w.id
                  AND loc.is_quarantine = false
                  AND COALESCE(lot.status, 'RELEASED') = 'RELEASED'
                  AND (b.qty_on_hand - b.qty_reserved) > 0) AS released_lot_count,
              (SELECT count(DISTINCT b.lot_id)::int
                 FROM inv.stock_balance b
                 JOIN master.location loc ON loc.id = b.location_id
                 LEFT JOIN inv.lot lot ON lot.id = b.lot_id
                WHERE loc.warehouse_id = w.id
                  AND (loc.is_quarantine = true OR COALESCE(lot.status, 'RELEASED') IN ('QUARANTINE', 'PENDING_QC'))
                  AND b.qty_on_hand > 0) AS quarantine_lot_count,
              (SELECT count(DISTINCT b.lot_id)::int
                 FROM inv.stock_balance b
                 JOIN master.location loc ON loc.id = b.location_id
                 JOIN inv.lot lot ON lot.id = b.lot_id
                WHERE loc.warehouse_id = w.id
                  AND loc.is_quarantine = true
                  AND lot.status = 'RELEASED'
                  AND (b.qty_on_hand - b.qty_reserved) > 0) AS ready_putaway_count,
              (SELECT count(DISTINCT b.item_id)::int
                 FROM inv.stock_balance b
                 JOIN master.location loc ON loc.id = b.location_id
                WHERE loc.warehouse_id = w.id AND b.qty_on_hand > 0) AS active_item_count
         FROM master.warehouse w
         LEFT JOIN core.org_unit ou ON ou.id = w.owner_org_unit_id
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
        ORDER BY CASE w.code WHEN 'KHO-TONG' THEN 0 ELSE 1 END, i.code, lot.expiry_date ASC NULLS LAST`
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
        ORDER BY w.code, i.code`
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
      `SELECT i.id AS item_id, i.code AS item_code, i.name AS item_name, i.item_type, i.base_uom,
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
                SELECT sum(b.qty_on_hand)::float
                  FROM inv.stock_balance b
                  JOIN master.location loc ON loc.id = b.location_id
                  LEFT JOIN inv.lot lot ON lot.id = b.lot_id
                 WHERE b.item_id = i.id
                   AND (loc.is_quarantine = true OR COALESCE(lot.status, 'RELEASED') IN ('QUARANTINE', 'PENDING_QC'))
                   AND b.qty_on_hand > 0
              ), 0) AS quarantine_qty,
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
              ), 0) AS open_po_qty
         FROM master.item i
        WHERE i.status = 'ACTIVE' AND i.is_purchasable = true
        ORDER BY (
          COALESCE((
            SELECT sum(b.qty_on_hand - b.qty_reserved)::float
              FROM inv.stock_balance b
              JOIN master.location loc ON loc.id = b.location_id
              LEFT JOIN inv.lot lot ON lot.id = b.lot_id
             WHERE b.item_id = i.id AND loc.is_quarantine = false AND COALESCE(lot.status, 'RELEASED') = 'RELEASED'
          ), 0) - COALESCE(i.min_safety_stock, 10)::float
        ) ASC, i.code ASC
        LIMIT 30`
    )
  ).rows;

  const recent_transfers = (
    await tx.query(
      `SELECT d.id, d.code, d.reason_code, d.status, d.posted_at, d.created_at, d.notes,
              w.code AS source_warehouse_code, up.display_name AS created_by_name,
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
        WHERE d.doc_type = 'TRANSFER'
        ORDER BY d.created_at DESC
        LIMIT 15`
    )
  ).rows;

  return {
    warehouses,
    all_locations,
    central_hub_stock,
    putaway_queue,
    expiry_radar,
    low_stock_radar,
    recent_transfers,
  };
}

const dispatchSchema = z.object({
  source_warehouse_id: z.string().uuid().optional().nullable(),
  target_warehouse_id: z.string().uuid("Chọn kho nhánh bộ phận nhận hàng"),
  target_location_id: z.string().uuid().optional().nullable(),
  item_id: z.string().uuid("Chọn vật tư cần cấp phát"),
  lot_id: z.string().uuid().optional().nullable(),
  qty: z.coerce.number().positive("Số lượng cấp phát phải lớn hơn 0"),
  notes: z.string().trim().max(500).optional().nullable(),
});

/**
 * 1-Click FEFO Inter-Warehouse Distribution:
 * Dispatches stock from Central Hub (`KHO-TONG · A1`, or selected source warehouse)
 * to a Department Branch Warehouse (`KHO-KIT`, `KHO-OLIGO`, `KHO-DEVICE`, `KHO-RD`, `KHO-QA`).
 * Automatically picks FEFO released lots if `lot_id` is omitted.
 */
export async function dispatchInterWarehouseFefo(tx: Tx, actor: AuthzActor, input: unknown) {
  await authorizeAnywhere(tx, actor, "inv.document.create");
  const d = parseInput(dispatchSchema, input);

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

  const item = (await tx.query("SELECT id, code, name, base_uom, tracking FROM master.item WHERE id = $1", [d.item_id])).rows[0];
  if (!item) throw notFound("Vật tư");

  const today = vnToday();
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
      [srcWh.id, item.id, today, d.lot_id ?? null]
    )
  ).rows;

  const totalAvail = candidateRows.reduce((s, r) => s + Number(r.avail), 0);
  if (totalAvail + 1e-9 < d.qty) {
    throw invalid(
      `Tồn kho khả dụng của ${item.code} tại ${srcWh.code} chỉ còn ${totalAvail} ${item.base_uom} (cần cấp ${d.qty} ${item.base_uom}).`
    );
  }

  let remaining = d.qty;
  const transferLines: {
    item_id: string;
    lot_id: string | null;
    from_location_id: string;
    to_location_id: string;
    qty: number;
    uom: string;
  }[] = [];

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

  const doc = await createStockDocument(
    tx,
    actor,
    {
      doc_type: "TRANSFER",
      reason_code: "DEPT_SUPPLY",
      warehouse_id: srcWh.id,
      notes: d.notes || `Cấp phát vật tư FEFO từ ${srcWh.code} sang ${dstWh.code} (${dstLoc.code})`,
      lines: transferLines,
    },
    { trusted: true }
  );
  const posted = await runTransition(tx, stockDocumentMachine, actor, { id: doc.id, action: "post", expectedVersion: doc.version }, { trusted: true });
  await writeAudit(tx, actor, {
    entityType: "stock_document",
    entityId: posted.id,
    action: "inter_warehouse_dispatch",
    changes: { from_wh: [null, srcWh.code], to_wh: [null, dstWh.code], item: [null, item.code], qty: [null, d.qty] },
  });
  return { document: posted, from_warehouse: srcWh.code, to_warehouse: dstWh.code, lines_count: transferLines.length };
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
  await authorizeAnywhere(tx, actor, "inv.stock.view");
  const d = parseInput(holdLotSchema, input);
  const lot = (await tx.query("SELECT * FROM inv.lot WHERE id = $1", [d.lot_id])).rows[0];
  if (!lot) throw notFound("Lô hàng");
  if (lot.status !== "RELEASED") throw invalid(`Chỉ khóa được lô đang ở trạng thái RELEASED (hiện tại: ${lot.status}).`);
  return runTransition(tx, lotMachine, actor, { id: lot.id, action: "hold", expectedVersion: lot.version, reason: d.reason }, { trusted: true });
}

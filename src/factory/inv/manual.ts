import { z } from "zod/v3";
import type { Tx } from "../core/db";
import type { AuthzActor } from "../core/authz";
import { forbidden, invalid, notFound } from "../core/errors";
import { parseInput } from "../core/records";
import { createStockDocument, postStockDocument, stockDocumentMachine, type StockDocument } from "./documents";
import { viewableWarehouses } from "./queries";
import { stockLineSchema } from "./schemas";
import { listAllowedActions } from "../core/stateMachine";
import { openReagentContainer } from "./warehouseOps";

export { openReagentContainer };

/**
 * Documents a person may raise by hand. Receipts come only from purchasing / production (they create
 * the lot and its quality status); opening stock is loaded by the data migration.
 */
export const MANUAL_REASONS = {
  ISSUE: ["PRODUCTION", "RND", "QC_SAMPLE", "SCRAP", "RETURN_TO_SUPPLIER", "OTHER"],
  TRANSFER: ["PUTAWAY", "RELOCATE", "DEPT_SUPPLY", "INTER_WAREHOUSE", "REPLENISHMENT"],
  ADJUSTMENT: ["COUNT_DIFF", "DAMAGE", "OTHER"],
} as const;
/** Reasons that must be explained in the notes. */
const NOTES_REQUIRED = new Set(["SCRAP", "RETURN_TO_SUPPLIER", "OTHER", "COUNT_DIFF", "DAMAGE"]);

const manualSchema = z.object({
  doc_type: z.enum(["ISSUE", "TRANSFER", "ADJUSTMENT"]),
  reason_code: z.string().trim(),
  warehouse_id: z.string().uuid(),
  notes: z.string().trim().max(2000).optional().nullable(),
  post: z.boolean().default(true),
  lines: z.array(stockLineSchema).min(1, "phiếu cần ít nhất một dòng").max(200),
});

export async function createManualDocument(tx: Tx, actor: AuthzActor, input: unknown): Promise<StockDocument> {
  const data = parseInput(manualSchema, input);
  if (!(MANUAL_REASONS[data.doc_type] as readonly string[]).includes(data.reason_code)) {
    throw invalid(`Lý do "${data.reason_code}" không dùng cho phiếu ${data.doc_type}.`);
  }
  if (NOTES_REQUIRED.has(data.reason_code) && !data.notes) throw invalid("Lý do này bắt buộc ghi diễn giải.");
  const { post, ...doc } = data;
  const created = await createStockDocument(tx, actor, { ...doc, lines: doc.lines.map((l) => ({ ...l, unit_cost: null })) });
  return post ? postStockDocument(tx, actor, created.id, created.version) : created;
}

/**
 * Moves every free quantity of a released lot out of the quarantine locations of `to_location`'s
 * warehouse onto that location (put-away after QA release).
 */
export async function putAwayLot(tx: Tx, actor: AuthzActor, input: unknown): Promise<StockDocument> {
  const { lot_id, to_location_id } = parseInput(z.object({ lot_id: z.string().uuid(), to_location_id: z.string().uuid() }), input);
  const lot = (await tx.query("SELECT l.status, l.item_id, l.code, i.base_uom FROM inv.lot l JOIN master.item i ON i.id = l.item_id WHERE l.id = $1", [lot_id])).rows[0];
  if (!lot) throw notFound("lô");
  if (lot.status !== "RELEASED") throw invalid(`Lô ${lot.code} chưa được giải phóng, phải ở lại khu biệt trữ.`);
  const to = (await tx.query("SELECT warehouse_id, is_quarantine, status FROM master.location WHERE id = $1", [to_location_id])).rows[0];
  if (!to || to.status !== "ACTIVE" || to.is_quarantine) throw invalid("Chọn một vị trí thường (không phải biệt trữ) đang hoạt động.");
  const balances = (
    await tx.query(
      `SELECT b.location_id, b.container_id, (b.qty_on_hand - b.qty_reserved)::text AS free
         FROM inv.stock_balance b JOIN master.location loc ON loc.id = b.location_id
        WHERE b.lot_id = $1 AND loc.is_quarantine AND loc.warehouse_id = $2 AND b.qty_on_hand - b.qty_reserved > 0`,
      [lot_id, to.warehouse_id]
    )
  ).rows;
  if (!balances.length) throw invalid("Lô không còn hàng ở khu biệt trữ của kho này.");
  const doc = await createStockDocument(tx, actor, {
    doc_type: "TRANSFER",
    reason_code: "PUTAWAY",
    warehouse_id: to.warehouse_id,
    lines: balances.map((b) => ({
      item_id: lot.item_id,
      lot_id,
      container_id: b.container_id,
      from_location_id: b.location_id,
      to_location_id,
      qty: Number(b.free),
      uom: lot.base_uom,
    })),
  });
  return postStockDocument(tx, actor, doc.id, doc.version);
}

const docListQuerySchema = z.object({
  view: z.enum(["documents", "ledger"]).optional().default("documents"),
  warehouse_id: z.string().uuid().optional().or(z.literal("")),
  doc_type: z.enum(["RECEIPT", "RETURN", "ISSUE", "TRANSFER", "ADJUSTMENT", "COUNT_ADJUST"]).optional().or(z.literal("")),
  flow: z.enum(["ALL", "PURCHASE_IN", "SUPPLY_TRANSFER", "PRODUCTION_OUT", "OPENING"]).optional().or(z.literal("")),
  item_id: z.string().uuid().optional().or(z.literal("")),
  lot_id: z.string().uuid().optional().or(z.literal("")),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listDocuments(tx: Tx, actor: AuthzActor, queryOrWarehouseId?: unknown) {
  const q =
    typeof queryOrWarehouseId === "string" || queryOrWarehouseId === undefined
      ? {
          view: "documents" as const,
          warehouse_id: queryOrWarehouseId || undefined,
          doc_type: undefined,
          flow: undefined,
          item_id: undefined,
          lot_id: undefined,
          q: undefined,
          page: 1,
          page_size: 50,
        }
      : parseInput(docListQuerySchema, queryOrWarehouseId);

  const allowed = (await viewableWarehouses(tx, actor)).map((w) => w.id);
  const whId = q.warehouse_id || undefined;
  if (whId && !allowed.includes(whId)) throw forbidden("Bạn không có quyền xem kho này.");

  const targetWhIds = whId ? [whId] : allowed;

  if (q.view === "ledger") {
    return listStockLedgerAndTrace(tx, targetWhIds, q);
  }

  const params: unknown[] = [targetWhIds];
  // Match documents owned by the warehouse OR documents that move stock from/to locations inside the warehouse
  const where: string[] = [
    `(
      d.warehouse_id = ANY($1::uuid[])
      OR EXISTS (
        SELECT 1 FROM inv.stock_document_line l
        LEFT JOIN master.location fl ON fl.id = l.from_location_id
        LEFT JOIN master.location tl ON tl.id = l.to_location_id
        WHERE l.document_id = d.id
          AND (fl.warehouse_id = ANY($1::uuid[]) OR tl.warehouse_id = ANY($1::uuid[]))
      )
    )`,
  ];

  if (q.doc_type) {
    params.push(q.doc_type);
    where.push(`d.doc_type = $${params.length}`);
  }
  if (q.flow === "PURCHASE_IN") {
    where.push(`d.doc_type IN ('RECEIPT', 'RETURN') AND d.reason_code <> 'INITIAL_BALANCE'`);
  } else if (q.flow === "SUPPLY_TRANSFER") {
    where.push(`d.doc_type = 'TRANSFER'`);
  } else if (q.flow === "PRODUCTION_OUT") {
    where.push(`d.doc_type = 'ISSUE'`);
  } else if (q.flow === "OPENING") {
    where.push(`d.reason_code = 'INITIAL_BALANCE'`);
  }

  if (q.item_id) {
    params.push(q.item_id);
    where.push(`EXISTS (SELECT 1 FROM inv.stock_document_line l WHERE l.document_id = d.id AND l.item_id = $${params.length}::uuid)`);
  }
  if (q.lot_id) {
    params.push(q.lot_id);
    where.push(`EXISTS (SELECT 1 FROM inv.stock_document_line l WHERE l.document_id = d.id AND l.lot_id = $${params.length}::uuid)`);
  }

  if (q.q) {
    params.push(`%${q.q}%`);
    const pIdx = `$${params.length}`;
    where.push(`(
      d.code ILIKE ${pIdx}
      OR COALESCE(d.notes, '') ILIKE ${pIdx}
      OR d.reason_code ILIKE ${pIdx}
      OR EXISTS (
        SELECT 1 FROM inv.stock_document_line l
        JOIN master.item i ON i.id = l.item_id
        LEFT JOIN inv.lot lot ON lot.id = l.lot_id
        LEFT JOIN master.location tl ON tl.id = l.to_location_id
        LEFT JOIN master.warehouse tw ON tw.id = tl.warehouse_id
        WHERE l.document_id = d.id
          AND (
            i.code ILIKE ${pIdx}
            OR i.name ILIKE ${pIdx}
            OR COALESCE(lot.code, '') ILIKE ${pIdx}
            OR COALESCE(lot.mfr_lot_no, '') ILIKE ${pIdx}
            OR COALESCE(tw.code, '') ILIKE ${pIdx}
          )
      )
    )`);
  }

  const whereSql = where.join(" AND ");
  const total = Number(
    (await tx.query(`SELECT count(*)::int AS c FROM inv.stock_document d WHERE ${whereSql}`, params)).rows[0]?.c ?? 0
  );

  params.push(q.page_size, (q.page - 1) * q.page_size);
  const rows = (
    await tx.query(
      `SELECT d.id, d.code, d.doc_type, d.reason_code, d.status, d.posted_at, d.created_at, d.notes, d.reversal_of_id,
              d.source_entity_type, d.source_entity_id,
              w.code AS warehouse_code, w.name AS warehouse_name,
              up.display_name AS created_by_name,
              (SELECT count(*)::int FROM inv.stock_document_line l WHERE l.document_id = d.id) AS line_count,
              COALESCE(
                (
                  SELECT jsonb_agg(
                    jsonb_build_object(
                      'line_no', l.line_no,
                      'item_id', i.id,
                      'item_code', i.code,
                      'item_name', i.name,
                      'lot_id', lot.id,
                      'lot_code', lot.code,
                      'mfr_lot_no', lot.mfr_lot_no,
                      'qty', l.qty::float,
                      'uom', l.uom,
                      'from_wh_code', fw.code,
                      'from_loc_code', fl.code,
                      'to_wh_code', tw.code,
                      'to_loc_code', tl.code
                    ) ORDER BY l.line_no
                  )
                  FROM inv.stock_document_line l
                  JOIN master.item i ON i.id = l.item_id
                  LEFT JOIN inv.lot lot ON lot.id = l.lot_id
                  LEFT JOIN master.location fl ON fl.id = l.from_location_id
                  LEFT JOIN master.warehouse fw ON fw.id = fl.warehouse_id
                  LEFT JOIN master.location tl ON tl.id = l.to_location_id
                  LEFT JOIN master.warehouse tw ON tw.id = tl.warehouse_id
                  WHERE l.document_id = d.id
                ),
                '[]'::jsonb
              ) AS lines_preview
         FROM inv.stock_document d
         JOIN master.warehouse w ON w.id = d.warehouse_id
         LEFT JOIN core.user_profile up ON up.user_id = d.created_by
        WHERE ${whereSql}
        ORDER BY COALESCE(d.posted_at, d.created_at) DESC, d.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
  ).rows;

  return { rows, total, page: q.page, page_size: q.page_size };
}

/**
 * Sổ cái Thẻ Kho & Truy vết Nhập Kho Tổng -> Cấp phát Kho Nhánh -> Xuất dùng Sản xuất:
 * Trả về:
 * 1. `movements`: từng dòng giao dịch xuất/nhập/điều chuyển theo thời gian
 * 2. `item_summaries`: tổng hợp theo từng vật tư (Tổng nhập mua/pha chế, Đã cấp phát sang từng kho nhánh, Đã xuất tiêu hao, Tồn hiện tại ở từng kho)
 */
async function listStockLedgerAndTrace(
  tx: Tx,
  targetWhIds: string[],
  q: z.infer<typeof docListQuerySchema>
) {
  const params: unknown[] = [targetWhIds];
  const where: string[] = [
    `d.status = 'POSTED'`,
    `(d.warehouse_id = ANY($1::uuid[]) OR fw.id = ANY($1::uuid[]) OR tw.id = ANY($1::uuid[]))`,
  ];

  if (q.flow === "PURCHASE_IN") {
    where.push(`d.doc_type IN ('RECEIPT', 'RETURN') AND d.reason_code <> 'INITIAL_BALANCE'`);
  } else if (q.flow === "SUPPLY_TRANSFER") {
    where.push(`d.doc_type = 'TRANSFER'`);
  } else if (q.flow === "PRODUCTION_OUT") {
    where.push(`d.doc_type = 'ISSUE'`);
  } else if (q.flow === "OPENING") {
    where.push(`d.reason_code = 'INITIAL_BALANCE'`);
  }

  if (q.item_id) {
    params.push(q.item_id);
    where.push(`l.item_id = $${params.length}::uuid`);
  }
  if (q.lot_id) {
    params.push(q.lot_id);
    where.push(`l.lot_id = $${params.length}::uuid`);
  }
  if (q.q) {
    params.push(`%${q.q}%`);
    const pIdx = `$${params.length}`;
    where.push(`(
      i.code ILIKE ${pIdx}
      OR i.name ILIKE ${pIdx}
      OR COALESCE(lot.code, '') ILIKE ${pIdx}
      OR COALESCE(lot.mfr_lot_no, '') ILIKE ${pIdx}
      OR d.code ILIKE ${pIdx}
      OR COALESCE(d.notes, '') ILIKE ${pIdx}
    )`);
  }

  const whereSql = where.join(" AND ");
  const total = Number(
    (
      await tx.query(
        `SELECT count(*)::int AS c
           FROM inv.stock_document_line l
           JOIN inv.stock_document d ON d.id = l.document_id
           JOIN master.item i ON i.id = l.item_id
           LEFT JOIN inv.lot lot ON lot.id = l.lot_id
           LEFT JOIN master.location fl ON fl.id = l.from_location_id
           LEFT JOIN master.warehouse fw ON fw.id = fl.warehouse_id
           LEFT JOIN master.location tl ON tl.id = l.to_location_id
           LEFT JOIN master.warehouse tw ON tw.id = tl.warehouse_id
          WHERE ${whereSql}`,
        params
      )
    ).rows[0]?.c ?? 0
  );

  const pageParams = [...params, q.page_size, (q.page - 1) * q.page_size];
  const movements = (
    await tx.query(
      `SELECT l.id AS line_id, l.line_no,
              d.id AS document_id, d.code AS document_code, d.doc_type, d.reason_code, d.notes,
              d.source_entity_type, d.source_entity_id,
              COALESCE(d.posted_at, d.created_at) AS occurred_at,
              w.code AS doc_warehouse_code,
              up.display_name AS performed_by_name,
              i.id AS item_id, i.code AS item_code, i.name AS item_name, i.base_uom,
              lot.id AS lot_id, lot.code AS lot_code, lot.mfr_lot_no, lot.origin AS lot_origin, lot.expiry_date,
              sup.name AS supplier_name,
              fw.code AS from_wh_code, fl.code AS from_loc_code,
              tw.code AS to_wh_code, tl.code AS to_loc_code,
              l.qty::float AS qty, l.uom, l.qty_base::float AS qty_base
         FROM inv.stock_document_line l
         JOIN inv.stock_document d ON d.id = l.document_id
         JOIN master.warehouse w ON w.id = d.warehouse_id
         JOIN master.item i ON i.id = l.item_id
         LEFT JOIN inv.lot lot ON lot.id = l.lot_id
         LEFT JOIN master.partner sup ON sup.id = lot.supplier_id
         LEFT JOIN master.location fl ON fl.id = l.from_location_id
         LEFT JOIN master.warehouse fw ON fw.id = fl.warehouse_id
         LEFT JOIN master.location tl ON tl.id = l.to_location_id
         LEFT JOIN master.warehouse tw ON tw.id = tl.warehouse_id
         LEFT JOIN core.user_profile up ON up.user_id = COALESCE(d.posted_by, d.created_by)
        WHERE ${whereSql}
        ORDER BY COALESCE(d.posted_at, d.created_at) DESC, d.code DESC, l.line_no ASC
        LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams
    )
  ).rows;

  // Aggregate item trace summary (Receipts into KHO-TONG / Total Receipts, Distributed to Branch Warehouses, Consumed, and Current Balances by Warehouse)
  const itemFilterParams: unknown[] = [];
  const itemWhere: string[] = [];
  if (q.item_id) {
    itemFilterParams.push(q.item_id);
    itemWhere.push(`i.id = $${itemFilterParams.length}::uuid`);
  }
  if (q.q) {
    itemFilterParams.push(`%${q.q}%`);
    const pIdx = `$${itemFilterParams.length}`;
    itemWhere.push(`(i.code ILIKE ${pIdx} OR i.name ILIKE ${pIdx} OR EXISTS (SELECT 1 FROM inv.lot lt WHERE lt.item_id = i.id AND (lt.code ILIKE ${pIdx} OR COALESCE(lt.mfr_lot_no, '') ILIKE ${pIdx})))`);
  }

  const itemSummaries = (
    await tx.query(
      `WITH mov AS (
         SELECT l.item_id,
                d.doc_type,
                d.reason_code,
                fw.code AS from_wh,
                tw.code AS to_wh,
                l.qty_base::float AS qty_base
           FROM inv.stock_document_line l
           JOIN inv.stock_document d ON d.id = l.document_id AND d.status = 'POSTED'
           LEFT JOIN master.location fl ON fl.id = l.from_location_id
           LEFT JOIN master.warehouse fw ON fw.id = fl.warehouse_id
           LEFT JOIN master.location tl ON tl.id = l.to_location_id
           LEFT JOIN master.warehouse tw ON tw.id = tl.warehouse_id
       ),
       agg AS (
         SELECT item_id,
                COALESCE(SUM(qty_base) FILTER (WHERE doc_type = 'RECEIPT' AND reason_code <> 'INITIAL_BALANCE'), 0)::float AS qty_purchased_in,
                COALESCE(SUM(qty_base) FILTER (WHERE doc_type = 'RECEIPT' AND reason_code = 'INITIAL_BALANCE'), 0)::float AS qty_opening_in,
                COALESCE(SUM(qty_base) FILTER (WHERE doc_type = 'TRANSFER' AND from_wh IS DISTINCT FROM to_wh), 0)::float AS qty_transferred_between_wh,
                COALESCE(SUM(qty_base) FILTER (WHERE doc_type = 'ISSUE'), 0)::float AS qty_issued_out
           FROM mov
          GROUP BY item_id
       ),
       dist AS (
         SELECT item_id,
                jsonb_agg(jsonb_build_object('to_wh', to_wh, 'qty', total_to_wh) ORDER BY to_wh) AS distributed_by_wh
           FROM (
             SELECT item_id, to_wh, SUM(qty_base)::float AS total_to_wh
               FROM mov
              WHERE doc_type = 'TRANSFER' AND to_wh IS NOT NULL AND from_wh IS DISTINCT FROM to_wh
              GROUP BY item_id, to_wh
           ) sub
          GROUP BY item_id
       ),
       bal AS (
         SELECT item_id,
                jsonb_agg(jsonb_build_object('wh_code', wh_code, 'qty_on_hand', wh_qty) ORDER BY wh_code) AS balance_by_wh,
                SUM(wh_qty)::float AS total_on_hand
           FROM (
             SELECT b.item_id, w.code AS wh_code, SUM(b.qty_on_hand)::float AS wh_qty
               FROM inv.stock_balance b
               JOIN master.location loc ON loc.id = b.location_id
               JOIN master.warehouse w ON w.id = loc.warehouse_id
              WHERE b.qty_on_hand > 0
              GROUP BY b.item_id, w.code
           ) sub
          GROUP BY item_id
       )
       SELECT i.id AS item_id, i.code AS item_code, i.name AS item_name, i.base_uom, i.item_type,
              COALESCE(agg.qty_purchased_in, 0) AS qty_purchased_in,
              COALESCE(agg.qty_opening_in, 0) AS qty_opening_in,
              COALESCE(agg.qty_transferred_between_wh, 0) AS qty_transferred_between_wh,
              COALESCE(agg.qty_issued_out, 0) AS qty_issued_out,
              COALESCE(dist.distributed_by_wh, '[]'::jsonb) AS distributed_by_wh,
              COALESCE(bal.balance_by_wh, '[]'::jsonb) AS balance_by_wh,
              COALESCE(bal.total_on_hand, 0) AS total_on_hand
         FROM master.item i
         LEFT JOIN agg ON agg.item_id = i.id
         LEFT JOIN dist ON dist.item_id = i.id
         LEFT JOIN bal ON bal.item_id = i.id
        WHERE (COALESCE(agg.qty_purchased_in, 0) > 0 OR COALESCE(agg.qty_transferred_between_wh, 0) > 0 OR COALESCE(agg.qty_issued_out, 0) > 0 OR COALESCE(bal.total_on_hand, 0) > 0)
          ${itemWhere.length ? `AND ${itemWhere.join(" AND ")}` : ""}
        ORDER BY COALESCE(agg.qty_purchased_in, 0) DESC, COALESCE(agg.qty_transferred_between_wh, 0) DESC, i.code ASC
        LIMIT 40`,
      itemFilterParams
    )
  ).rows;

  return {
    rows: movements,
    item_summaries: itemSummaries,
    total,
    page: q.page,
    page_size: q.page_size,
  };
}

export async function getDocumentDetail(tx: Tx, actor: AuthzActor, id: string) {
  const doc = (await tx.query("SELECT d.*, w.code AS warehouse_code FROM inv.stock_document d JOIN master.warehouse w ON w.id = d.warehouse_id WHERE d.id = $1", [id])).rows[0];
  if (!doc) throw notFound("phiếu kho");
  if (!(await viewableWarehouses(tx, actor)).some((w) => w.id === doc.warehouse_id)) throw forbidden("Bạn không có quyền xem kho này.");
  const lines = (
    await tx.query(
      `SELECT l.line_no, i.code AS item_code, i.name AS item_name, lot.code AS lot_code,
              CASE WHEN fw.id IS NOT NULL AND fw.id <> $2 THEN fw.code || ' · ' || fl.code ELSE fl.code END AS from_code,
              CASE WHEN tw.id IS NOT NULL AND tw.id <> $2 THEN tw.code || ' · ' || tl.code ELSE tl.code END AS to_code,
              l.qty::text AS qty, l.uom, l.qty_base::text AS qty_base, i.base_uom
         FROM inv.stock_document_line l JOIN master.item i ON i.id = l.item_id LEFT JOIN inv.lot lot ON lot.id = l.lot_id
         LEFT JOIN master.location fl ON fl.id = l.from_location_id LEFT JOIN master.warehouse fw ON fw.id = fl.warehouse_id
         LEFT JOIN master.location tl ON tl.id = l.to_location_id LEFT JOIN master.warehouse tw ON tw.id = tl.warehouse_id
        WHERE l.document_id = $1 ORDER BY l.line_no`,
      [id, doc.warehouse_id]
    )
  ).rows;
  return { ...doc, lines, actions: await listAllowedActions(tx, stockDocumentMachine, actor, doc) };
}

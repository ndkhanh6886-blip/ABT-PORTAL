import { z } from "zod";
import type { Tx } from "../core/db";
import type { AuthzActor } from "../core/authz";
import { forbidden, invalid, notFound } from "../core/errors";
import { parseInput } from "../core/records";
import { createStockDocument, postStockDocument, stockDocumentMachine, type StockDocument } from "./documents";
import { viewableWarehouses } from "./queries";
import { stockLineSchema } from "./schemas";
import { listAllowedActions } from "../core/stateMachine";

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

export async function listDocuments(tx: Tx, actor: AuthzActor, warehouseId?: string) {
  const allowed = (await viewableWarehouses(tx, actor)).map((w) => w.id);
  if (warehouseId && !allowed.includes(warehouseId)) throw forbidden("Bạn không có quyền xem kho này.");
  return (
    await tx.query(
      `SELECT d.id, d.code, d.doc_type, d.reason_code, d.status, d.posted_at, d.created_at, d.notes, d.reversal_of_id,
              w.code AS warehouse_code, up.display_name AS created_by_name,
              (SELECT count(*)::int FROM inv.stock_document_line l WHERE l.document_id = d.id) AS line_count
         FROM inv.stock_document d JOIN master.warehouse w ON w.id = d.warehouse_id
         LEFT JOIN core.user_profile up ON up.user_id = d.created_by
        WHERE d.warehouse_id = ANY($1::uuid[]) ORDER BY d.created_at DESC LIMIT 300`,
      [warehouseId ? [warehouseId] : allowed]
    )
  ).rows;
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

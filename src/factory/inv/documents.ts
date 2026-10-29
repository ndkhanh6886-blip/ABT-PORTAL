import type { Tx } from "../core/db";
import { authorize, type AuthzActor } from "../core/authz";
import { vnToday } from "../core/dates";
import { FactoryError, invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { insertRecord, parseInput } from "../core/records";
import { defineMachine, runTransition } from "../core/stateMachine";
import { getItem, toBaseQty } from "../master/service";
import { createStockDocumentSchema, NON_RELEASED_ISSUE_REASONS, SEQUENCE_BY_DOC_TYPE, type DocType } from "./schemas";
import "./permissions";

type DocStatus = "DRAFT" | "POSTED" | "CANCELLED" | "REVERSED";
export interface StockDocument {
  id: string;
  code: string;
  doc_type: DocType;
  reason_code: string;
  warehouse_id: string;
  status: DocStatus;
  version: number;
  reversal_of_id: string | null;
}

async function warehouseOwner(tx: Tx, warehouseId: string): Promise<string> {
  const w = (await tx.query("SELECT owner_org_unit_id FROM master.warehouse WHERE id = $1 AND status = 'ACTIVE'", [warehouseId])).rows[0];
  if (!w) throw invalid("Kho không tồn tại hoặc đã ngừng hoạt động.");
  return w.owner_org_unit_id;
}

export const stockDocumentMachine = defineMachine<DocStatus, StockDocument>({
  entityType: "stock_document",
  table: "inv.stock_document",
  states: ["DRAFT", "POSTED", "CANCELLED", "REVERSED"],
  terminal: ["CANCELLED", "REVERSED"],
  scopeOf: (row, tx) => warehouseOwner(tx, row.warehouse_id),
  transitions: [
    { action: "post", from: "DRAFT", to: "POSTED", permission: "inv.document.post", effects: ({ tx, actor, updated }) => applyPosting(tx, actor, updated) },
    { action: "cancel", from: "DRAFT", to: "CANCELLED", permission: "inv.document.create" },
    {
      action: "reverse",
      from: "POSTED",
      to: "REVERSED",
      permission: "inv.document.reverse",
      reasonRequired: true,
      guards: [{ code: "IS_REVERSAL", message: "Không đảo một phiếu đảo; hãy lập phiếu mới.", check: ({ row }) => !row.reversal_of_id }],
      effects: ({ tx, actor, row, reason }) => postReversal(tx, actor, row, reason ?? ""),
    },
  ],
});

/** Creates a DRAFT document. `trusted` = called by another module that already authorised its action. */
export async function createStockDocument(tx: Tx, actor: AuthzActor, input: unknown, opts: { trusted?: boolean } = {}): Promise<StockDocument> {
  const data = parseInput(createStockDocumentSchema, input);
  if (!opts.trusted) await authorize(tx, actor, "inv.document.create", await warehouseOwner(tx, data.warehouse_id));
  const code = await nextNumber(tx, SEQUENCE_BY_DOC_TYPE[data.doc_type]);
  const { lines, ...header } = data;
  const doc = await insertRecord<StockDocument>(tx, actor, "inv.stock_document", "stock_document", { ...header, code });
  let lineNo = 0;
  for (const l of lines) {
    const item = await getItem(tx, l.item_id);
    const qtyBase = Math.round((await toBaseQty(tx, item, l.qty, l.uom)) * 1e6) / 1e6;
    if (!(qtyBase > 0)) throw invalid(`Dòng ${lineNo + 1}: số lượng quy đổi quá nhỏ.`);
    await tx.query(
      `INSERT INTO inv.stock_document_line (document_id, line_no, item_id, lot_id, container_id, from_location_id, to_location_id,
                                            qty, uom, qty_base, unit_cost, reservation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [doc.id, ++lineNo, l.item_id, l.lot_id, l.container_id, l.from_location_id, l.to_location_id, l.qty, l.uom, qtyBase, l.unit_cost ?? null, l.reservation_id]
    );
  }
  return doc;
}

/** Posts a document through the state machine (permission, audit, outbox); `trusted` documents use the system path. */
export async function postStockDocument(tx: Tx, actor: AuthzActor, id: string, expectedVersion: number): Promise<StockDocument> {
  return runTransition(tx, stockDocumentMachine, actor, { id, action: "post", expectedVersion });
}

interface Delta {
  lineId: string;
  itemId: string;
  lotId: string | null;
  containerId: string | null;
  locationId: string;
  qty: string; // base unit, numeric text
  sign: 1 | -1;
  reservationId: string | null;
}

const keyOf = (d: Delta) => [d.itemId, d.lotId ?? "~", d.containerId ?? "~", d.locationId].join("|");

function directionError(docType: DocType, lineNo: number): FactoryError {
  const rule: Record<DocType, string> = {
    RECEIPT: "chỉ có vị trí nhập",
    RETURN: "chỉ có vị trí nhập",
    ISSUE: "chỉ có vị trí xuất",
    TRANSFER: "có cả vị trí xuất và vị trí nhập",
    ADJUSTMENT: "có đúng một trong hai: vị trí xuất (giảm) hoặc vị trí nhập (tăng)",
    COUNT_ADJUST: "có đúng một trong hai: vị trí xuất (giảm) hoặc vị trí nhập (tăng)",
  };
  return invalid(`Dòng ${lineNo}: phiếu loại ${docType} ${rule[docType]}.`);
}

/** Validates every line, then writes ledger rows and balances in fixed key order (no deadlocks). */
async function applyPosting(tx: Tx, actor: AuthzActor, doc: StockDocument, opts: { reversal?: boolean } = {}): Promise<void> {
  const lines = (
    await tx.query(
      `SELECT dl.*, dl.qty_base::text AS qty_base_text, i.code AS item_code, i.tracking,
              lot.item_id AS lot_item_id, lot.status AS lot_status, lot.expiry_date, lot.code AS lot_code,
              fl.warehouse_id AS from_wh, tl.warehouse_id AS to_wh, tl.is_quarantine AS to_quarantine
         FROM inv.stock_document_line dl
         JOIN master.item i ON i.id = dl.item_id
         LEFT JOIN inv.lot lot ON lot.id = dl.lot_id
         LEFT JOIN master.location fl ON fl.id = dl.from_location_id
         LEFT JOIN master.location tl ON tl.id = dl.to_location_id
        WHERE dl.document_id = $1 ORDER BY dl.line_no`,
      [doc.id]
    )
  ).rows;
  if (!lines.length) throw invalid("Phiếu không có dòng nào.");
  const today = vnToday();
  const deltas: Delta[] = [];
  for (const l of lines) {
    const n = l.line_no;
    const hasFrom = l.from_location_id != null;
    const hasTo = l.to_location_id != null;
    const dirOk = {
      RECEIPT: !hasFrom && hasTo,
      RETURN: !hasFrom && hasTo,
      ISSUE: hasFrom && !hasTo,
      TRANSFER: hasFrom && hasTo,
      ADJUSTMENT: hasFrom !== hasTo,
      COUNT_ADJUST: hasFrom !== hasTo,
    }[doc.doc_type];
    if (!dirOk && !opts.reversal) throw directionError(doc.doc_type, n);
    if ((hasFrom && l.from_wh !== doc.warehouse_id) || (hasTo && l.to_wh !== doc.warehouse_id)) {
      throw invalid(`Dòng ${n}: vị trí không thuộc kho của phiếu. Chuyển giữa hai kho cần yêu cầu chuyển kho được duyệt.`);
    }
    if (l.tracking !== "NONE" && !l.lot_id) throw invalid(`Dòng ${n}: vật tư ${l.item_code} quản lý theo lô/serial, phải chọn lô.`);
    if (l.tracking === "NONE" && l.lot_id) throw invalid(`Dòng ${n}: vật tư ${l.item_code} không quản lý theo lô.`);
    if (l.lot_id && l.lot_item_id !== l.item_id) throw invalid(`Dòng ${n}: lô ${l.lot_code} không thuộc vật tư ${l.item_code}.`);
    if (l.tracking === "SERIAL" && Number(l.qty_base_text) !== 1) throw invalid(`Dòng ${n}: mỗi serial chỉ có số lượng 1.`);
    if (!opts.reversal && l.lot_id) {
      const outbound = doc.doc_type === "ISSUE" && !(NON_RELEASED_ISSUE_REASONS as readonly string[]).includes(doc.reason_code);
      if (outbound && l.lot_status !== "RELEASED") throw invalid(`Dòng ${n}: lô ${l.lot_code} đang ở trạng thái ${l.lot_status}, chỉ lô đã giải phóng mới được xuất dùng.`);
      if (outbound && l.expiry_date && l.expiry_date < today) throw invalid(`Dòng ${n}: lô ${l.lot_code} đã hết hạn (${l.expiry_date}).`);
      if (hasTo && !l.to_quarantine && ["QUARANTINE", "PENDING_QC", "REJECTED"].includes(l.lot_status)) {
        throw invalid(`Dòng ${n}: lô ${l.lot_code} chưa được giải phóng nên phải để ở vị trí biệt trữ.`);
      }
    }
    const base = { lineId: l.id, itemId: l.item_id, lotId: l.lot_id, containerId: l.container_id, qty: l.qty_base_text };
    if (hasFrom) deltas.push({ ...base, locationId: l.from_location_id, sign: -1, reservationId: l.reservation_id });
    if (hasTo) deltas.push({ ...base, locationId: l.to_location_id, sign: 1, reservationId: null });
  }

  deltas.sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : a.sign - b.sign));
  for (const d of deltas) await applyDelta(tx, d);

  const serialOver = await tx.query(
    `SELECT l.code FROM inv.stock_balance b JOIN inv.lot l ON l.id = b.lot_id JOIN master.item i ON i.id = b.item_id
      WHERE i.tracking = 'SERIAL' AND b.lot_id = ANY($1::uuid[]) GROUP BY l.code HAVING sum(b.qty_on_hand) > 1`,
    [lines.filter((l) => l.tracking === "SERIAL").map((l) => l.lot_id)]
  );
  if (serialOver.rowCount) throw invalid(`Serial ${serialOver.rows[0].code} đã có trong kho, không nhập trùng.`);
  await tx.query("UPDATE inv.stock_document SET posted_at = now(), posted_by = $2 WHERE id = $1", [doc.id, actor.userId]);
}

async function applyDelta(tx: Tx, d: Delta): Promise<void> {
  await tx.query(
    `INSERT INTO inv.stock_balance (item_id, lot_id, container_id, location_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (item_id, lot_id, container_id, location_id) DO NOTHING`,
    [d.itemId, d.lotId, d.containerId, d.locationId]
  );
  const bal = (
    await tx.query(
      `SELECT id, qty_on_hand::text AS on_hand, qty_reserved::text AS reserved FROM inv.stock_balance
        WHERE item_id = $1 AND lot_id IS NOT DISTINCT FROM $2 AND container_id IS NOT DISTINCT FROM $3 AND location_id = $4 FOR UPDATE`,
      [d.itemId, d.lotId, d.containerId, d.locationId]
    )
  ).rows[0];
  if (d.sign > 0) {
    await tx.query("UPDATE inv.stock_balance SET qty_on_hand = qty_on_hand + $2::numeric, updated_at = now() WHERE id = $1", [bal.id, d.qty]);
  } else if (d.reservationId) {
    const r = await tx.query(
      `UPDATE inv.reservation SET qty_consumed = qty_consumed + $3::numeric,
              status = CASE WHEN qty_consumed + $3::numeric >= qty_base THEN 'CONSUMED' ELSE status END,
              version = version + 1, updated_at = now()
        WHERE id = $1 AND balance_id = $2 AND status = 'ACTIVE' AND qty_base - qty_consumed >= $3::numeric RETURNING id`,
      [d.reservationId, bal.id, d.qty]
    );
    if (!r.rowCount) throw invalid("Giữ chỗ không còn hiệu lực, không khớp lô/vị trí hoặc không đủ số lượng đã giữ.", undefined, "RESERVATION_MISMATCH");
    await tx.query(
      "UPDATE inv.stock_balance SET qty_on_hand = qty_on_hand - $2::numeric, qty_reserved = qty_reserved - $2::numeric, updated_at = now() WHERE id = $1",
      [bal.id, d.qty]
    );
  } else {
    const ok = await tx.query(
      `UPDATE inv.stock_balance SET qty_on_hand = qty_on_hand - $2::numeric, updated_at = now()
        WHERE id = $1 AND qty_on_hand - qty_reserved >= $2::numeric RETURNING id`,
      [bal.id, d.qty]
    );
    if (!ok.rowCount) {
      throw new FactoryError(
        422,
        "INSUFFICIENT_STOCK",
        `Không đủ tồn khả dụng để xuất ${Number(d.qty)}: tồn ${Number(bal.on_hand)}, đã giữ chỗ ${Number(bal.reserved)}. Không cho phép tồn âm.`
      );
    }
  }
  await tx.query(
    `INSERT INTO inv.stock_ledger (document_line_id, item_id, lot_id, container_id, location_id, qty_delta_base)
     VALUES ($1, $2, $3, $4, $5, $6::numeric * $7)`,
    [d.lineId, d.itemId, d.lotId, d.containerId, d.locationId, d.qty, d.sign]
  );
}

/** Reversal = a new POSTED document with every movement inverted, linked both ways. Never edits the original. */
async function postReversal(tx: Tx, actor: AuthzActor, original: StockDocument, reason: string): Promise<void> {
  const code = await nextNumber(tx, SEQUENCE_BY_DOC_TYPE[original.doc_type]);
  const rev = (
    await tx.query(
      `INSERT INTO inv.stock_document (code, doc_type, reason_code, warehouse_id, source_entity_type, source_entity_id, status, reversal_of_id, notes, created_by, updated_by)
       VALUES ($1, $2, 'REVERSAL', $3, 'STOCK_DOCUMENT', $4, 'POSTED', $4, $5, $6, $6) RETURNING *`,
      [code, original.doc_type, original.warehouse_id, original.id, reason, actor.userId]
    )
  ).rows[0] as StockDocument;
  await tx.query(
    `INSERT INTO inv.stock_document_line (document_id, line_no, item_id, lot_id, container_id, from_location_id, to_location_id, qty, uom, qty_base, unit_cost)
     SELECT $1, line_no, item_id, lot_id, container_id, to_location_id, from_location_id, qty, uom, qty_base, unit_cost
       FROM inv.stock_document_line WHERE document_id = $2`,
    [rev.id, original.id]
  );
  await applyPosting(tx, actor, rev, { reversal: true });
}

export async function getStockDocument(tx: Tx, id: string) {
  const doc = (await tx.query("SELECT * FROM inv.stock_document WHERE id = $1", [id])).rows[0];
  if (!doc) throw notFound("phiếu kho");
  const lines = (await tx.query("SELECT * FROM inv.stock_document_line WHERE document_id = $1 ORDER BY line_no", [id])).rows;
  return { ...doc, lines };
}

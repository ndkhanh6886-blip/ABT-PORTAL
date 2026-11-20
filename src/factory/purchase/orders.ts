import { z } from "zod/v3";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorizeAnywhere, hasFactoryPermission, type AuthzActor } from "../core/authz";
import { forbidden, invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { parseInput } from "../core/records";
import { defineMachine, runTransition } from "../core/stateMachine";
import { prMachine } from "./requests";
import "./permissions";

type PoStatus = "DRAFT" | "ISSUED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CLOSED" | "CANCELLED";
export interface PurchaseOrder {
  id: string;
  code: string;
  supplier_id: string;
  status: PoStatus;
  version: number;
}

/** Re-syncs request statuses after their ordered quantities changed: fully ordered → ORDERED, otherwise back to APPROVED. */
export async function syncRequestStatus(tx: Tx, actor: AuthzActor, prIds: string[]): Promise<void> {
  for (const prId of [...new Set(prIds)].sort()) {
    const pr = (
      await tx.query(
        `SELECT pr.id, pr.status, pr.version, bool_and(l.qty_ordered >= l.qty) AS full
           FROM purchase.purchase_request pr JOIN purchase.purchase_request_line l ON l.pr_id = pr.id
          WHERE pr.id = $1 GROUP BY pr.id`,
        [prId]
      )
    ).rows[0];
    if (pr.status === "APPROVED" && pr.full) await runTransition(tx, prMachine, actor, { id: pr.id, action: "mark_ordered", expectedVersion: pr.version }, { trusted: true });
    if (pr.status === "ORDERED" && !pr.full) await runTransition(tx, prMachine, actor, { id: pr.id, action: "reopen", expectedVersion: pr.version }, { trusted: true });
  }
}

/** Gives the ordered quantity back to the request lines (cancelled order). */
async function releaseOrderedQty(tx: Tx, actor: AuthzActor, poId: string): Promise<void> {
  const lines = (await tx.query("SELECT pr_line_id, qty_ordered::text AS q FROM purchase.purchase_order_line WHERE po_id = $1 ORDER BY pr_line_id", [poId])).rows;
  const prIds: string[] = [];
  for (const l of lines) {
    const r = await tx.query("UPDATE purchase.purchase_request_line SET qty_ordered = qty_ordered - $2::numeric WHERE id = $1 RETURNING pr_id", [l.pr_line_id, l.q]);
    prIds.push(r.rows[0].pr_id);
  }
  await syncRequestStatus(tx, actor, prIds);
}

const hasReceipts = async (tx: Tx, poId: string) => ((await tx.query("SELECT 1 FROM purchase.goods_receipt WHERE po_id = $1 LIMIT 1", [poId])).rowCount ?? 0) > 0;

export const poMachine = defineMachine<PoStatus, PurchaseOrder>({
  entityType: "purchase_order",
  table: "purchase.purchase_order",
  states: ["DRAFT", "ISSUED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"],
  terminal: ["CLOSED", "CANCELLED"],
  transitions: [
    { action: "issue", from: "DRAFT", to: "ISSUED", permission: "purchase.po.manage", patch: () => ({ issued_at: new Date() }) },
    {
      action: "cancel",
      from: ["DRAFT", "ISSUED"],
      to: "CANCELLED",
      permission: "purchase.po.manage",
      reasonRequired: true,
      guards: [{ code: "HAS_RECEIPTS", message: "Đơn đã có phiếu nhận hàng, không hủy được. Hãy đóng đơn.", check: async ({ tx, row }) => !(await hasReceipts(tx, row.id)) }],
      effects: ({ tx, actor, row }) => releaseOrderedQty(tx, actor, row.id),
    },
    { action: "mark_partial", from: "ISSUED", to: "PARTIALLY_RECEIVED", permission: "purchase.system" },
    { action: "mark_received", from: ["ISSUED", "PARTIALLY_RECEIVED"], to: "RECEIVED", permission: "purchase.system" },
    { action: "close", from: "RECEIVED", to: "CLOSED", permission: "purchase.po.manage" },
    { action: "short_close", from: "PARTIALLY_RECEIVED", to: "CLOSED", permission: "purchase.po.manage", reasonRequired: true },
  ],
});

const orderSchema = z.object({
  supplier_id: z.string().uuid("chọn nhà cung cấp"),
  expected_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  payment_terms: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  lines: z
    .array(
      z.object({
        pr_line_id: z.string().uuid(),
        qty: z.coerce.number().positive("số lượng phải lớn hơn 0"),
        unit_price: z.coerce.number().min(0, "đơn giá không âm"),
        vat_rate: z.coerce.number().refine((v) => [0, 5, 8, 10].includes(v), "thuế suất 0, 5, 8 hoặc 10%").default(0),
      })
    )
    .min(1, "chọn ít nhất một dòng đề nghị")
    .max(200),
});

/**
 * Builds a DRAFT order from approved request lines (several departments may share one supplier order).
 * Request lines are locked in id order, so two buyers cannot order the same remaining quantity twice.
 */
export async function createOrder(tx: Tx, actor: AuthzActor, input: unknown): Promise<PurchaseOrder> {
  await authorizeAnywhere(tx, actor, "purchase.po.manage");
  const data = parseInput(orderSchema, input);
  const supplier = (await tx.query("SELECT is_supplier, status, code FROM master.partner WHERE id = $1", [data.supplier_id])).rows[0];
  if (!supplier || !supplier.is_supplier || supplier.status !== "ACTIVE") throw invalid("Đối tác không phải nhà cung cấp đang hoạt động.");
  if (new Set(data.lines.map((l) => l.pr_line_id)).size !== data.lines.length) throw invalid("Một dòng đề nghị chỉ xuất hiện một lần trong đơn.");
  const ids = data.lines.map((l) => l.pr_line_id).sort();
  const prLines = new Map(
    (
      await tx.query(
        `SELECT l.id, l.pr_id, l.item_id, l.uom, (l.qty - l.qty_ordered)::text AS open, pr.status, pr.code, pr.target_warehouse_id
           FROM purchase.purchase_request_line l JOIN purchase.purchase_request pr ON pr.id = l.pr_id
          WHERE l.id = ANY($1::uuid[]) ORDER BY l.id FOR UPDATE OF l`,
        [ids]
      )
    ).rows.map((r) => [r.id, r])
  );
  const code = await nextNumber(tx, "PURCHASE_ORDER");
  const po = (
    await tx.query(
      `INSERT INTO purchase.purchase_order (code, supplier_id, expected_date, payment_terms, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING *`,
      [code, data.supplier_id, data.expected_date ?? null, data.payment_terms ?? null, data.notes ?? null, actor.userId]
    )
  ).rows[0] as PurchaseOrder;
  let lineNo = 0;
  let total = 0;
  for (const l of data.lines) {
    const pl = prLines.get(l.pr_line_id);
    if (!pl) throw notFound("dòng đề nghị mua");
    if (!["APPROVED", "ORDERED"].includes(pl.status)) throw invalid(`Đề nghị ${pl.code} chưa được duyệt.`);
    if (l.qty > Number(pl.open) + 1e-9) throw invalid(`Đề nghị ${pl.code}: chỉ còn ${Number(pl.open)} ${pl.uom} chưa đặt.`, undefined, "OVER_ORDER");
    await tx.query("UPDATE purchase.purchase_request_line SET qty_ordered = qty_ordered + $2 WHERE id = $1", [pl.id, l.qty]);
    await tx.query(
      `INSERT INTO purchase.purchase_order_line (po_id, line_no, pr_line_id, item_id, target_warehouse_id, qty_ordered, uom, unit_price, vat_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [po.id, ++lineNo, pl.id, pl.item_id, pl.target_warehouse_id, l.qty, pl.uom, l.unit_price, l.vat_rate]
    );
    total += l.qty * l.unit_price * (1 + l.vat_rate / 100);
  }
  await tx.query("UPDATE purchase.purchase_order SET total_amount = $2 WHERE id = $1", [po.id, Math.round(total)]);
  await syncRequestStatus(tx, actor, [...prLines.values()].map((p) => p.pr_id));
  await writeAudit(tx, actor, { entityType: "purchase_order", entityId: po.id, action: "create", changes: { code: [null, code], supplier: [null, supplier.code], total: [null, Math.round(total)] } });
  return po;
}

/**
 * Purchasing sees every order; warehouse staff who may receive see the issued / partly received
 * orders that deliver into one of their warehouses (their receiving queue).
 */
export async function listOrders(tx: Tx, actor: AuthzActor, status?: string) {
  let warehouses: string[] | null = null;
  if (!(await hasFactoryPermission(tx, actor, "purchase.po.view")) && !(await hasFactoryPermission(tx, actor, "purchase.po.manage"))) {
    const all = (await tx.query("SELECT id, owner_org_unit_id FROM master.warehouse WHERE status = 'ACTIVE'")).rows;
    warehouses = [];
    for (const w of all) if (await hasFactoryPermission(tx, actor, "purchase.receipt.post", w.owner_org_unit_id)) warehouses.push(w.id);
    if (!warehouses.length) throw forbidden("Bạn chưa có quyền xem đơn mua NVL.");
  }
  return (
    await tx.query(
      `SELECT po.id, po.code, po.status, po.order_date, po.expected_date, po.total_amount::text AS total_amount,
              p.code AS supplier_code, p.name AS supplier_name,
              (SELECT count(*)::int FROM purchase.purchase_order_line l WHERE l.po_id = po.id) AS line_count,
              COALESCE(
                (SELECT array_agg(DISTINCT w.code ORDER BY w.code)
                   FROM purchase.purchase_order_line l
                   JOIN master.warehouse w ON w.id = l.target_warehouse_id
                  WHERE l.po_id = po.id),
                ARRAY[]::text[]
              ) AS warehouse_codes,
              COALESCE(
                (SELECT jsonb_agg(
                          jsonb_build_object(
                            'item_code', i.code,
                            'item_name', i.name,
                            'qty_ordered', l.qty_ordered::float,
                            'qty_received', l.qty_received::float,
                            'uom', l.uom,
                            'warehouse_code', w.code,
                            'pr_code', pr.code
                          ) ORDER BY l.line_no
                        )
                   FROM purchase.purchase_order_line l
                   JOIN master.item i ON i.id = l.item_id
                   JOIN master.warehouse w ON w.id = l.target_warehouse_id
                   JOIN purchase.purchase_request_line prl ON prl.id = l.pr_line_id
                   JOIN purchase.purchase_request pr ON pr.id = prl.pr_id
                  WHERE l.po_id = po.id),
                '[]'::jsonb
              ) AS items_summary,
              COALESCE(
                (SELECT jsonb_agg(
                          jsonb_build_object(
                            'gr_code', gr.code,
                            'stock_doc_code', sd.code,
                            'warehouse_code', w.code,
                            'location_code', loc.code,
                            'lot_id', lot.id,
                            'lot_code', lot.code,
                            'lot_status', lot.status,
                            'qty', grl.qty::float,
                            'uom', grl.uom,
                            'received_at', gr.received_at
                          ) ORDER BY gr.received_at ASC, grl.id ASC
                        )
                   FROM purchase.goods_receipt gr
                   JOIN purchase.goods_receipt_line grl ON grl.receipt_id = gr.id
                   LEFT JOIN inv.stock_document sd ON sd.id = grl.stock_document_id
                   LEFT JOIN master.location loc ON loc.id = grl.location_id
                   LEFT JOIN master.warehouse w ON w.id = COALESCE(sd.warehouse_id, loc.warehouse_id)
                   LEFT JOIN inv.lot lot ON lot.id = grl.lot_id
                  WHERE gr.po_id = po.id),
                '[]'::jsonb
              ) AS receipt_docs,
              COALESCE(
                (SELECT jsonb_agg(
                          jsonb_build_object(
                            'doc_code', d.code,
                            'doc_type', d.doc_type,
                            'reason_code', d.reason_code,
                            'from_wh_code', fw.code,
                            'from_loc_code', fl.code,
                            'to_wh_code', tw.code,
                            'to_loc_code', tl.code,
                            'qty', sdl.qty::float,
                            'uom', sdl.uom,
                            'occurred_at', COALESCE(d.posted_at, d.created_at)
                          ) ORDER BY COALESCE(d.posted_at, d.created_at) ASC, sdl.line_no ASC
                        )
                   FROM inv.stock_document_line sdl
                   JOIN inv.stock_document d ON d.id = sdl.document_id
                   LEFT JOIN master.location fl ON fl.id = sdl.from_location_id
                   LEFT JOIN master.warehouse fw ON fw.id = fl.warehouse_id
                   LEFT JOIN master.location tl ON tl.id = sdl.to_location_id
                   LEFT JOIN master.warehouse tw ON tw.id = tl.warehouse_id
                  WHERE d.status = 'POSTED'
                    AND sdl.lot_id IN (
                      SELECT grl2.lot_id
                        FROM purchase.goods_receipt gr2
                        JOIN purchase.goods_receipt_line grl2 ON grl2.receipt_id = gr2.id
                       WHERE gr2.po_id = po.id AND grl2.lot_id IS NOT NULL
                    )
                    AND d.id NOT IN (
                      SELECT grl3.stock_document_id
                        FROM purchase.goods_receipt gr3
                        JOIN purchase.goods_receipt_line grl3 ON grl3.receipt_id = gr3.id
                       WHERE gr3.po_id = po.id AND grl3.stock_document_id IS NOT NULL
                    )),
                '[]'::jsonb
              ) AS downstream_moves,
              COALESCE(
                (SELECT jsonb_agg(
                          jsonb_build_object(
                            'warehouse_code', w.code,
                            'location_code', loc.code,
                            'is_quarantine', loc.is_quarantine,
                            'lot_code', lot.code,
                            'lot_status', lot.status,
                            'qty_on_hand', sb.qty_on_hand::float,
                            'qty_reserved', sb.qty_reserved::float,
                            'uom', i.base_uom
                          ) ORDER BY w.code ASC, loc.code ASC
                        )
                   FROM inv.stock_balance sb
                   JOIN master.location loc ON loc.id = sb.location_id
                   JOIN master.warehouse w ON w.id = loc.warehouse_id
                   JOIN inv.lot lot ON lot.id = sb.lot_id
                   JOIN master.item i ON i.id = sb.item_id
                  WHERE sb.qty_on_hand > 0
                    AND sb.lot_id IN (
                      SELECT grl4.lot_id
                        FROM purchase.goods_receipt gr4
                        JOIN purchase.goods_receipt_line grl4 ON grl4.receipt_id = gr4.id
                       WHERE gr4.po_id = po.id AND grl4.lot_id IS NOT NULL
                    )),
                '[]'::jsonb
              ) AS current_stock_places
         FROM purchase.purchase_order po JOIN master.partner p ON p.id = po.supplier_id
        WHERE ($1::text IS NULL OR po.status = $1)
          AND ($2::uuid[] IS NULL OR (po.status IN ('ISSUED', 'PARTIALLY_RECEIVED')
               AND EXISTS (SELECT 1 FROM purchase.purchase_order_line l WHERE l.po_id = po.id AND l.target_warehouse_id = ANY($2::uuid[]))))
        ORDER BY po.created_at DESC LIMIT 300`,
      [status ?? null, warehouses]
    )
  ).rows;
}

/** An order with its lines; warehouse staff who may receive into one of its warehouses can open it too. */
export async function getOrder(tx: Tx, actor: AuthzActor, id: string) {
  const po = (
    await tx.query(
      `SELECT po.*, po.total_amount::text AS total_amount, p.code AS supplier_code, p.name AS supplier_name
         FROM purchase.purchase_order po JOIN master.partner p ON p.id = po.supplier_id WHERE po.id = $1`,
      [id]
    )
  ).rows[0];
  if (!po) throw notFound("đơn mua");
  const lines = (
    await tx.query(
      `SELECT l.id, l.line_no, l.item_id, i.code AS item_code, i.name AS item_name, i.tracking, l.uom, l.qty_ordered::text AS qty_ordered,
              l.qty_received::text AS qty_received, l.unit_price::text AS unit_price, l.vat_rate::text AS vat_rate,
              w.id AS warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name, w.owner_org_unit_id, pr.code AS pr_code
         FROM purchase.purchase_order_line l JOIN master.item i ON i.id = l.item_id JOIN master.warehouse w ON w.id = l.target_warehouse_id
         JOIN purchase.purchase_request_line prl ON prl.id = l.pr_line_id JOIN purchase.purchase_request pr ON pr.id = prl.pr_id
        WHERE l.po_id = $1 ORDER BY l.line_no`,
      [id]
    )
  ).rows;
  const canSee =
    (await hasFactoryPermission(tx, actor, "purchase.po.view")) ||
    (await hasFactoryPermission(tx, actor, "purchase.po.manage")) ||
    (await Promise.all(lines.map((l) => hasFactoryPermission(tx, actor, "purchase.receipt.post", l.owner_org_unit_id)))).some(Boolean);
  if (!canSee) throw forbidden("Bạn chưa có quyền xem đơn mua này.");
  const receipts = (
    await tx.query(
      `SELECT r.id, r.code, r.received_at, r.delivery_note_no, up.display_name AS received_by_name,
              COALESCE(
                (SELECT array_agg(DISTINCT sd.code ORDER BY sd.code)
                   FROM purchase.goods_receipt_line grl
                   JOIN inv.stock_document sd ON sd.id = grl.stock_document_id
                  WHERE grl.receipt_id = r.id),
                ARRAY[]::text[]
              ) AS stock_doc_codes
         FROM purchase.goods_receipt r
         LEFT JOIN core.user_profile up ON up.user_id = r.received_by
        WHERE r.po_id = $1
        ORDER BY r.received_at`,
      [id]
    )
  ).rows;

  const receipt_lines = (
    await tx.query(
      `SELECT grl.id, gr.code AS gr_code, gr.received_at, gr.delivery_note_no,
              up.display_name AS received_by_name,
              sd.id AS stock_doc_id, sd.code AS stock_doc_code,
              w.code AS warehouse_code, w.name AS warehouse_name,
              loc.code AS intake_location_code, loc.name AS intake_location_name, loc.is_quarantine AS intake_is_quarantine,
              i.code AS item_code, i.name AS item_name,
              grl.qty::float AS qty, grl.uom,
              lot.id AS lot_id, lot.code AS lot_code, lot.status AS lot_status,
              COALESCE(grl.mfr_lot_no, lot.mfr_lot_no) AS mfr_lot_no,
              COALESCE(grl.mfg_date, lot.mfg_date)::text AS mfg_date,
              COALESCE(grl.expiry_date, lot.expiry_date)::text AS expiry_date
         FROM purchase.goods_receipt gr
         JOIN purchase.goods_receipt_line grl ON grl.receipt_id = gr.id
         JOIN master.item i ON i.id = grl.item_id
         LEFT JOIN core.user_profile up ON up.user_id = gr.received_by
         LEFT JOIN inv.stock_document sd ON sd.id = grl.stock_document_id
         LEFT JOIN master.location loc ON loc.id = grl.location_id
         LEFT JOIN master.warehouse w ON w.id = COALESCE(sd.warehouse_id, loc.warehouse_id)
         LEFT JOIN inv.lot lot ON lot.id = grl.lot_id
        WHERE gr.po_id = $1
        ORDER BY gr.received_at ASC, grl.id ASC`,
      [id]
    )
  ).rows;

  const receivedLotIds = Array.from(new Set(receipt_lines.map((r: any) => r.lot_id).filter(Boolean)));
  const current_balances = receivedLotIds.length
    ? (
        await tx.query(
          `SELECT sb.lot_id, lot.code AS lot_code, lot.status AS lot_status,
                  i.code AS item_code, i.name AS item_name, i.base_uom AS uom,
                  w.code AS warehouse_code, w.name AS warehouse_name,
                  loc.code AS location_code, loc.name AS location_name, loc.is_quarantine,
                  sb.qty_on_hand::float AS qty_on_hand,
                  sb.qty_reserved::float AS qty_reserved,
                  (sb.qty_on_hand - sb.qty_reserved)::float AS available
             FROM inv.stock_balance sb
             JOIN inv.lot lot ON lot.id = sb.lot_id
             JOIN master.item i ON i.id = sb.item_id
             JOIN master.location loc ON loc.id = sb.location_id
             JOIN master.warehouse w ON w.id = loc.warehouse_id
            WHERE sb.lot_id = ANY($1::uuid[]) AND sb.qty_on_hand > 0
            ORDER BY w.code ASC, loc.code ASC`,
          [receivedLotIds]
        )
      ).rows
    : [];

  const lot_movements = receivedLotIds.length
    ? (
        await tx.query(
          `SELECT sdl.id AS line_id, sdl.line_no,
                  d.id AS document_id, d.code AS document_code, d.doc_type, d.reason_code, d.notes,
                  d.source_entity_type, d.source_entity_id,
                  COALESCE(d.posted_at, d.created_at) AS occurred_at,
                  w.code AS doc_warehouse_code,
                  up.display_name AS performed_by_name,
                  i.code AS item_code, i.name AS item_name,
                  lot.code AS lot_code, lot.status AS lot_status,
                  fw.code AS from_wh_code, fl.code AS from_loc_code,
                  tw.code AS to_wh_code, tl.code AS to_loc_code,
                  sdl.qty::float AS qty, sdl.uom
             FROM inv.stock_document_line sdl
             JOIN inv.stock_document d ON d.id = sdl.document_id
             JOIN master.warehouse w ON w.id = d.warehouse_id
             JOIN master.item i ON i.id = sdl.item_id
             LEFT JOIN inv.lot lot ON lot.id = sdl.lot_id
             LEFT JOIN master.location fl ON fl.id = sdl.from_location_id
             LEFT JOIN master.warehouse fw ON fw.id = fl.warehouse_id
             LEFT JOIN master.location tl ON tl.id = sdl.to_location_id
             LEFT JOIN master.warehouse tw ON tw.id = tl.warehouse_id
             LEFT JOIN core.user_profile up ON up.user_id = COALESCE(d.posted_by, d.created_by)
            WHERE d.status = 'POSTED' AND sdl.lot_id = ANY($1::uuid[])
            ORDER BY COALESCE(d.posted_at, d.created_at) ASC, d.code ASC, sdl.line_no ASC`,
          [receivedLotIds]
        )
      ).rows
    : [];

  return { ...po, lines, receipts, receipt_lines, current_balances, lot_movements };
}

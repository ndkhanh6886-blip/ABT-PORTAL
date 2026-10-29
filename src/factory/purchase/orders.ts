import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, hasFactoryPermission, type AuthzActor } from "../core/authz";
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
  await authorize(tx, actor, "purchase.po.manage");
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
      `SELECT po.id, po.code, po.status, po.order_date, po.expected_date, po.total_amount::text AS total_amount, p.code AS supplier_code, p.name AS supplier_name,
              (SELECT count(*)::int FROM purchase.purchase_order_line l WHERE l.po_id = po.id) AS line_count
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
              w.id AS warehouse_id, w.code AS warehouse_code, w.owner_org_unit_id, pr.code AS pr_code
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
    await tx.query("SELECT r.id, r.code, r.received_at, r.delivery_note_no, up.display_name AS received_by_name FROM purchase.goods_receipt r LEFT JOIN core.user_profile up ON up.user_id = r.received_by WHERE r.po_id = $1 ORDER BY r.received_at", [id])
  ).rows;
  return { ...po, lines, receipts };
}

import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, hasFactoryPermission, type AuthzActor } from "../core/authz";
import { conflict, invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { parseInput } from "../core/records";
import { getSetting } from "../core/settings";
import { defineMachine, type Guard } from "../core/stateMachine";
import { getItem, toBaseQty } from "../master/service";
import "./permissions";

type PrStatus = "DRAFT" | "SUBMITTED" | "PENDING_BOD" | "APPROVED" | "REJECTED" | "ORDERED" | "CLOSED" | "CANCELLED";
export interface PurchaseRequest {
  id: string;
  code: string;
  org_unit_id: string;
  requester_id: number;
  target_warehouse_id: string;
  status: PrStatus;
  requires_bod: boolean;
  version: number;
}

const lineSchema = z.object({
  item_id: z.string().uuid(),
  qty: z.coerce.number().positive("số lượng phải lớn hơn 0").max(1e12),
  uom: z.string().trim().min(1),
  est_price: z.coerce.number().min(0).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});
const requestSchema = z.object({
  org_unit_id: z.string().uuid("chọn phòng đề nghị"),
  target_warehouse_id: z.string().uuid("chọn kho nhận"),
  needed_by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ngày dạng YYYY-MM-DD").optional().nullable(),
  reason: z.string().trim().min(3, "nêu mục đích / lý do mua").max(1000),
  purpose_entity_type: z.string().trim().max(60).optional().nullable(),
  purpose_entity_id: z.string().uuid().optional().nullable(),
  lines: z.array(lineSchema).min(1, "cần ít nhất một dòng vật tư").max(200),
});

const notRequester: Guard<PurchaseRequest> = {
  code: "SAME_PERSON",
  message: "Người duyệt phải khác người lập đề nghị.",
  check: ({ actor, row }) => row.requester_id !== actor.userId,
};

async function estimate(tx: Tx, prId: string): Promise<number> {
  const r = await tx.query("SELECT coalesce(sum(qty * coalesce(est_price, 0)), 0)::text AS total FROM purchase.purchase_request_line WHERE pr_id = $1", [prId]);
  return Number(r.rows[0].total);
}

export const prMachine = defineMachine<PrStatus, PurchaseRequest>({
  entityType: "purchase_request",
  table: "purchase.purchase_request",
  states: ["DRAFT", "SUBMITTED", "PENDING_BOD", "APPROVED", "REJECTED", "ORDERED", "CLOSED", "CANCELLED"],
  terminal: ["REJECTED", "CLOSED", "CANCELLED"],
  scopeOf: (row) => row.org_unit_id,
  transitions: [
    {
      action: "submit",
      from: "DRAFT",
      to: "SUBMITTED",
      permission: "purchase.pr.create",
      // the threshold is configurable (core.setting); null = no Ban giám đốc approval needed
      patch: async ({ tx, row }) => {
        const total = await estimate(tx, row.id);
        const threshold = await getSetting<number>(tx, "purchase.pr_bod_approval_threshold_vnd");
        return { est_total: total, requires_bod: typeof threshold === "number" && total >= threshold };
      },
    },
    {
      action: "approve",
      from: "SUBMITTED",
      to: "APPROVED",
      permission: "purchase.pr.approve",
      guards: [notRequester, { code: "NEEDS_BOD", message: "Đề nghị vượt ngưỡng: chuyển Ban giám đốc duyệt.", check: ({ row }) => !row.requires_bod }],
      patch: ({ actor }) => ({ approved_by: actor.userId }),
    },
    {
      action: "escalate",
      from: "SUBMITTED",
      to: "PENDING_BOD",
      permission: "purchase.pr.approve",
      guards: [notRequester, { code: "BELOW_THRESHOLD", message: "Đề nghị dưới ngưỡng, trưởng phòng duyệt trực tiếp.", check: ({ row }) => row.requires_bod }],
    },
    {
      action: "bod_approve",
      from: "PENDING_BOD",
      to: "APPROVED",
      permission: "purchase.pr.approve_bod",
      signature: "APPROVED",
      guards: [notRequester],
      patch: ({ actor }) => ({ approved_by: actor.userId }),
    },
    { action: "reject", from: ["SUBMITTED", "PENDING_BOD"], to: "REJECTED", permission: "purchase.pr.approve", reasonRequired: true },
    { action: "return", from: ["SUBMITTED", "PENDING_BOD"], to: "DRAFT", permission: "purchase.pr.approve", reasonRequired: true },
    { action: "cancel", from: ["DRAFT", "SUBMITTED"], to: "CANCELLED", permission: "purchase.pr.create", reasonRequired: true },
    { action: "mark_ordered", from: "APPROVED", to: "ORDERED", permission: "purchase.system" },
    { action: "reopen", from: "ORDERED", to: "APPROVED", permission: "purchase.system" },
    {
      action: "close",
      from: ["APPROVED", "ORDERED"],
      to: "CLOSED",
      permission: "purchase.po.manage",
      reasonRequired: true,
      guards: [
        {
          code: "OPEN_PO",
          message: "Còn đơn mua nháp/đang mở cho đề nghị này.",
          check: async ({ tx, row }) =>
            !(
              await tx.query(
                `SELECT 1 FROM purchase.purchase_order_line pol JOIN purchase.purchase_order po ON po.id = pol.po_id
                   JOIN purchase.purchase_request_line prl ON prl.id = pol.pr_line_id
                  WHERE prl.pr_id = $1 AND po.status IN ('DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED') LIMIT 1`,
                [row.id]
              )
            ).rowCount,
        },
      ],
    },
  ],
});

async function validateHeaderAndLines(tx: Tx, data: z.infer<typeof requestSchema>) {
  const wh = (await tx.query("SELECT owner_org_unit_id, status FROM master.warehouse WHERE id = $1", [data.target_warehouse_id])).rows[0];
  if (!wh || wh.status !== "ACTIVE") throw invalid("Kho nhận không tồn tại hoặc đã ngừng.");
  if (wh.owner_org_unit_id !== data.org_unit_id) throw invalid("Kho nhận phải là kho của phòng đề nghị.");
  for (const [i, l] of data.lines.entries()) {
    const item = await getItem(tx, l.item_id);
    if (item.status !== "ACTIVE" || !(item as any).is_purchasable) throw invalid(`Dòng ${i + 1}: vật tư ${item.code} không được phép mua.`);
    await toBaseQty(tx, item, l.qty, l.uom); // refuses units without a declared conversion
  }
}

async function insertLines(tx: Tx, prId: string, lines: z.infer<typeof lineSchema>[]) {
  let n = 0;
  for (const l of lines) {
    await tx.query(
      "INSERT INTO purchase.purchase_request_line (pr_id, line_no, item_id, qty, uom, est_price, notes) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [prId, ++n, l.item_id, l.qty, l.uom, l.est_price ?? null, l.notes ?? null]
    );
  }
}

export async function createRequest(tx: Tx, actor: AuthzActor, input: unknown): Promise<PurchaseRequest> {
  const data = parseInput(requestSchema, input);
  await authorize(tx, actor, "purchase.pr.create", data.org_unit_id);
  await validateHeaderAndLines(tx, data);
  const code = await nextNumber(tx, "PURCHASE_REQUEST");
  const pr = (
    await tx.query(
      `INSERT INTO purchase.purchase_request (code, org_unit_id, requester_id, target_warehouse_id, needed_by, reason, purpose_entity_type, purpose_entity_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $3, $3) RETURNING *`,
      [code, data.org_unit_id, actor.userId, data.target_warehouse_id, data.needed_by ?? null, data.reason, data.purpose_entity_type ?? null, data.purpose_entity_id ?? null]
    )
  ).rows[0];
  await insertLines(tx, pr.id, data.lines);
  await tx.query("UPDATE purchase.purchase_request SET est_total = $2 WHERE id = $1", [pr.id, await estimate(tx, pr.id)]);
  await writeAudit(tx, actor, { entityType: "purchase_request", entityId: pr.id, action: "create", changes: { code: [null, code], lines: [null, data.lines.length] } });
  return pr;
}

/** Only a DRAFT is edited (lines replaced); after submission the request is changed by returning it to draft. */
export async function updateRequestDraft(tx: Tx, actor: AuthzActor, id: string, input: unknown): Promise<PurchaseRequest> {
  const { version, ...data } = parseInput(requestSchema.extend({ version: z.number().int().min(0) }), input);
  const cur = (await tx.query("SELECT * FROM purchase.purchase_request WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!cur) throw notFound("đề nghị mua");
  await authorize(tx, actor, "purchase.pr.create", cur.org_unit_id);
  if (cur.status !== "DRAFT") throw invalid("Chỉ sửa được đề nghị ở trạng thái nháp.");
  if (cur.version !== version) throw conflict("Đề nghị vừa được người khác sửa. Tải lại rồi thực hiện lại.", "STALE_VERSION");
  if (data.org_unit_id !== cur.org_unit_id) throw invalid("Không đổi phòng đề nghị; hãy hủy và lập đề nghị mới.");
  await validateHeaderAndLines(tx, data);
  await tx.query("DELETE FROM purchase.purchase_request_line WHERE pr_id = $1", [id]);
  await insertLines(tx, id, data.lines);
  const upd = (
    await tx.query(
      `UPDATE purchase.purchase_request SET target_warehouse_id = $2, needed_by = $3, reason = $4, est_total = $5,
              version = version + 1, updated_at = now(), updated_by = $6 WHERE id = $1 RETURNING *`,
      [id, data.target_warehouse_id, data.needed_by ?? null, data.reason, await estimate(tx, id), actor.userId]
    )
  ).rows[0];
  await writeAudit(tx, actor, { entityType: "purchase_request", entityId: id, action: "update_draft", changes: { lines: [null, data.lines.length] } });
  return upd;
}

/** Org units whose requests the actor may see: every one for company-wide viewers / purchasing, else those covered by their roles. */
async function visibleOrgUnits(tx: Tx, actor: AuthzActor): Promise<string[] | "ALL"> {
  if ((await hasFactoryPermission(tx, actor, "purchase.pr.view")) || (await hasFactoryPermission(tx, actor, "purchase.po.manage"))) return "ALL";
  const units = (await tx.query("SELECT id FROM core.org_unit WHERE status = 'ACTIVE'")).rows.map((r) => r.id as string);
  const out: string[] = [];
  for (const u of units) if (await hasFactoryPermission(tx, actor, "purchase.pr.view", u)) out.push(u);
  return out;
}

export async function listRequests(tx: Tx, actor: AuthzActor, status?: string) {
  const units = await visibleOrgUnits(tx, actor);
  if (units !== "ALL" && !units.length) return [];
  return (
    await tx.query(
      `SELECT pr.id, pr.code, pr.status, pr.est_total::text AS est_total, pr.needed_by, pr.reason, pr.requires_bod, pr.created_at,
              o.name AS org_unit_name, w.code AS warehouse_code, up.display_name AS requester_name,
              (SELECT count(*)::int FROM purchase.purchase_request_line l WHERE l.pr_id = pr.id) AS line_count
         FROM purchase.purchase_request pr JOIN core.org_unit o ON o.id = pr.org_unit_id
         JOIN master.warehouse w ON w.id = pr.target_warehouse_id LEFT JOIN core.user_profile up ON up.user_id = pr.requester_id
        WHERE ($1::uuid[] IS NULL OR pr.org_unit_id = ANY($1::uuid[])) AND ($2::text IS NULL OR pr.status = $2)
        ORDER BY pr.created_at DESC LIMIT 300`,
      [units === "ALL" ? null : units, status ?? null]
    )
  ).rows;
}

export async function getRequest(tx: Tx, actor: AuthzActor, id: string) {
  const pr = (
    await tx.query(
      `SELECT pr.*, pr.est_total::text AS est_total, o.name AS org_unit_name, w.code AS warehouse_code, w.name AS warehouse_name,
              up.display_name AS requester_name, ap.display_name AS approver_name
         FROM purchase.purchase_request pr JOIN core.org_unit o ON o.id = pr.org_unit_id JOIN master.warehouse w ON w.id = pr.target_warehouse_id
         LEFT JOIN core.user_profile up ON up.user_id = pr.requester_id LEFT JOIN core.user_profile ap ON ap.user_id = pr.approved_by
        WHERE pr.id = $1`,
      [id]
    )
  ).rows[0];
  if (!pr) throw notFound("đề nghị mua");
  const units = await visibleOrgUnits(tx, actor);
  if (units !== "ALL" && !units.includes(pr.org_unit_id)) throw notFound("đề nghị mua");
  const lines = (
    await tx.query(
      `SELECT l.id, l.line_no, l.item_id, i.code AS item_code, i.name AS item_name, l.qty::text AS qty, l.uom, l.est_price::text AS est_price,
              l.qty_ordered::text AS qty_ordered, l.notes
         FROM purchase.purchase_request_line l JOIN master.item i ON i.id = l.item_id WHERE l.pr_id = $1 ORDER BY l.line_no`,
      [id]
    )
  ).rows;
  return { ...pr, lines };
}

/** Approved request lines not yet fully on a purchase order: the Cung ứng NVL inbox. */
export async function openRequestLines(tx: Tx, actor: AuthzActor) {
  await authorize(tx, actor, "purchase.po.manage");
  return (
    await tx.query(
      `SELECT l.id AS pr_line_id, pr.id AS pr_id, pr.code AS pr_code, pr.needed_by, o.name AS org_unit_name, w.code AS warehouse_code,
              i.id AS item_id, i.code AS item_code, i.name AS item_name, l.uom, (l.qty - l.qty_ordered)::text AS qty_open, l.est_price::text AS est_price
         FROM purchase.purchase_request_line l JOIN purchase.purchase_request pr ON pr.id = l.pr_id
         JOIN core.org_unit o ON o.id = pr.org_unit_id JOIN master.warehouse w ON w.id = pr.target_warehouse_id
         JOIN master.item i ON i.id = l.item_id
        WHERE pr.status IN ('APPROVED', 'ORDERED') AND l.qty > l.qty_ordered
        ORDER BY pr.needed_by NULLS LAST, pr.code, l.line_no`
    )
  ).rows;
}

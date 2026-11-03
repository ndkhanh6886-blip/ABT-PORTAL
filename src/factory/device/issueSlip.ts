import { z } from "zod";
import type { Tx } from "../core/db";
import { authorize, type AuthzActor } from "../core/authz";
import { invalid, notFound } from "../core/errors";
import { parseInput } from "../core/records";
import { getSetting } from "../core/settings";
import { insertSignature, isSignatureValid, MEANING_LABEL, type SignatureMeaning } from "../core/signature";

/**
 * BM 21-01 "Phiếu sản xuất và xuất kho nguyên vật liệu" (QT 21) of a device assembly order: the BOM lines with the
 * lots actually issued, signed electronically by the three people of the paper form. A signature covers the slip
 * content as signed: issuing more material afterwards voids it, so the slip is signed again.
 */

export interface FormCode {
  code: string;
  name: string;
}
export async function deviceFormCodes(tx: Tx): Promise<{ issue_slip: FormCode; test_record: FormCode }> {
  const v = (await getSetting<any>(tx, "device.form_codes").catch(() => null)) ?? {};
  return {
    issue_slip: { code: v.issue_slip?.code ?? "BM 21-01", name: v.issue_slip?.name ?? "Phiếu sản xuất và xuất kho nguyên vật liệu" },
    test_record: { code: v.test_record?.code ?? "", name: v.test_record?.name ?? "Phiếu thử nghiệm thiết bị" },
  };
}

/** The three signature boxes of BM 21-01, in print order. */
export const ISSUE_SLIP_ROLES = {
  PRODUCTION: { meaning: "PERFORMED" as SignatureMeaning, label: "Nhân viên sản xuất", permission: "device.assembly.execute" },
  LEAD: { meaning: "APPROVED" as SignatureMeaning, label: "Trưởng nhóm sản xuất thiết bị", permission: "device.order.manage" },
  WAREHOUSE: { meaning: "CHECKED" as SignatureMeaning, label: "Nhân viên kho", permission: "inv.document.post" },
};
type SlipRole = keyof typeof ISSUE_SLIP_ROLES;
const ENTITY = "device_issue_slip";

async function loadSlip(tx: Tx, orderId: string) {
  const order = (
    await tx.query(
      `SELECT o.id, o.code, o.lot_no, o.qty, o.version, o.org_unit_id, o.warehouse_id, o.created_at, o.approved_at,
              m.code AS model_code, m.name AS model_name, w.owner_org_unit_id AS warehouse_org_unit_id
         FROM device.device_order o
         JOIN device.device_model m ON m.id = o.model_id
         JOIN master.warehouse w ON w.id = o.warehouse_id
        WHERE o.id = $1`,
      [orderId]
    )
  ).rows[0];
  if (!order) throw notFound("lệnh lắp ráp thiết bị");
  const serials = (await tx.query("SELECT serial_no FROM device.device_unit WHERE order_id = $1 ORDER BY serial_no", [orderId])).rows.map((r) => r.serial_no);
  // one row per BOM line and lot issued; a BOM line not issued yet keeps one row with no lot
  const rows = (
    await tx.query(
      `SELECT bl.line_no, it.code AS item_code, it.name AS item_name, bl.uom, bl.qty_per_unit::float AS qty_per_unit,
              l.code AS lot_code, l.received_date::text AS received_date, COALESCE(sum(c.qty), 0)::float AS qty_issued
         FROM device.device_order o
         JOIN device.model_bom_line bl ON bl.revision_id = o.model_revision_id
         JOIN master.item it ON it.id = bl.component_item_id
         LEFT JOIN device.device_unit_component c
                ON c.unit_id IN (SELECT id FROM device.device_unit WHERE order_id = o.id)
               AND (c.bom_line_id = bl.id OR (c.bom_line_id IS NULL AND c.item_id = bl.component_item_id))
         LEFT JOIN inv.lot l ON l.id = c.lot_id
        WHERE o.id = $1
        GROUP BY bl.line_no, it.code, it.name, bl.uom, bl.qty_per_unit, l.code, l.received_date
        ORDER BY bl.line_no, l.received_date NULLS LAST, l.code`,
      [orderId]
    )
  ).rows;
  const lines = rows.map((r) => ({
    line_no: r.line_no,
    item_code: r.item_code,
    item_name: r.item_name,
    uom: r.uom,
    qty_per_unit: r.qty_per_unit,
    qty_lot: Number((r.qty_per_unit * order.qty).toFixed(4)),
    qty_issued: r.qty_issued,
    lot_code: r.lot_code,
    received_date: r.received_date,
  }));
  // what a signature covers: identity of the batch and every quantity / lot on the slip
  const content = { order: order.code, lot_no: order.lot_no, qty: order.qty, serials, lines };
  return { order, serials, lines, content };
}

export async function getIssueSlip(tx: Tx, actor: AuthzActor, orderId: string) {
  const { order, serials, lines, content } = await loadSlip(tx, orderId);
  await authorize(tx, actor, "device.view", order.org_unit_id);
  const sigs = (
    await tx.query(
      `SELECT id, meaning, signer_id, signer_name, signed_at, auth_method, record_hash FROM core.e_signature
        WHERE entity_type = $1 AND entity_id = $2 ORDER BY signed_at DESC`,
      [ENTITY, orderId]
    )
  ).rows;
  const signatures = (Object.keys(ISSUE_SLIP_ROLES) as SlipRole[]).map((role) => {
    const def = ISSUE_SLIP_ROLES[role];
    const s = sigs.find((x) => x.meaning === def.meaning);
    return {
      role,
      label: def.label,
      meaning: MEANING_LABEL[def.meaning],
      signer_name: s?.signer_name ?? null,
      signed_at: s?.signed_at ?? null,
      // signed on an earlier content (more material issued since): shown struck through, to be signed again
      valid: s ? isSignatureValid(s.record_hash, content) : false,
    };
  });
  return {
    form: (await deviceFormCodes(tx)).issue_slip,
    order: { id: order.id, code: order.code, lot_no: order.lot_no, qty: order.qty, model_code: order.model_code, model_name: order.model_name, mfg_date: order.approved_at ?? order.created_at },
    serials,
    lines,
    signatures,
  };
}

const signSchema = z.object({ role: z.enum(["PRODUCTION", "LEAD", "WAREHOUSE"]) });

/** Signs one box of BM 21-01 (the caller re-authenticated the signer). One person signs one box only. */
export async function signIssueSlip(tx: Tx, actor: AuthzActor, orderId: string, input: unknown, method: "PIN" | "PASSWORD") {
  const { role } = parseInput(signSchema, input);
  const def = ISSUE_SLIP_ROLES[role];
  await tx.query("SELECT 1 FROM device.device_order WHERE id = $1 FOR UPDATE", [orderId]);
  const { order, lines, content } = await loadSlip(tx, orderId);
  await authorize(tx, actor, def.permission, role === "WAREHOUSE" ? order.warehouse_org_unit_id : order.org_unit_id);
  if (!lines.some((l) => l.qty_issued > 0)) throw invalid("Chưa xuất kho linh kiện nào cho lệnh này — chưa có gì để ký trên phiếu.", undefined, "NOTHING_ISSUED");
  const sigs = (await tx.query("SELECT meaning, signer_id, record_hash FROM core.e_signature WHERE entity_type = $1 AND entity_id = $2", [ENTITY, orderId])).rows;
  const current = sigs.filter((s) => isSignatureValid(s.record_hash, content));
  if (current.some((s) => s.meaning === def.meaning)) throw invalid(`Ô "${def.label}" đã được ký trên nội dung phiếu hiện tại.`, undefined, "ALREADY_SIGNED");
  if (current.some((s) => s.signer_id === actor.userId && s.meaning !== def.meaning)) {
    throw invalid("Mỗi người chỉ ký một ô trên phiếu (sản xuất, trưởng nhóm, kho là ba người khác nhau).", undefined, "SAME_SIGNER");
  }
  return insertSignature(tx, actor, { entityType: ENTITY, entityId: orderId, entityVersion: order.version, meaning: def.meaning, record: content, method, reason: def.label });
}

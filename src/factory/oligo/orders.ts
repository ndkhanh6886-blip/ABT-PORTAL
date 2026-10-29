import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, hasFactoryPermission, registerPermissions, type AuthzActor } from "../core/authz";
import { vnToday } from "../core/dates";
import { invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { parseInput } from "../core/records";
import { analyze, SequenceError } from "./analyzer";
import { loadCatalog } from "./catalog";

registerPermissions([{ code: "oligo.order.manage", description: "Lập đơn Oligo, nhập / sửa / tách / gộp trình tự" }]);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const PURIFICATIONS = ["DESALT", "OPC", "HPLC", "PAGE"] as const;
export const FORMATS = ["LYOPHILIZED", "LIQUID"] as const;

async function oligoUnit(tx: Tx, orgUnitId: string) {
  const u = (await tx.query("SELECT id FROM core.org_unit WHERE id = $1 AND module_key = 'OLIGO' AND status = 'ACTIVE'", [orgUnitId])).rows[0];
  if (!u) throw invalid("Đơn Oligo phải thuộc một phòng có phân hệ Tổng hợp Oligo.");
}

const orderSchema = z.object({
  org_unit_id: z.string().uuid("chọn phòng Oligo"),
  internal_order_id: z.string().uuid().optional().nullable(),
  customer_label: z.string().trim().max(200).optional().nullable(),
  due_date: z.string().regex(DATE, "ngày dạng YYYY-MM-DD").optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function createOligoOrder(tx: Tx, actor: AuthzActor, input: unknown) {
  const data = parseInput(orderSchema, input);
  await authorize(tx, actor, "oligo.order.manage", data.org_unit_id);
  await oligoUnit(tx, data.org_unit_id);
  let due = data.due_date ?? null;
  if (data.internal_order_id) {
    const io = (await tx.query("SELECT org_unit_id, status, committed_date, kd_po_code FROM intake.internal_order WHERE id = $1", [data.internal_order_id])).rows[0];
    if (!io || io.org_unit_id !== data.org_unit_id) throw invalid("Đơn nội bộ không thuộc phòng Oligo này.");
    if (!["ACCEPTED", "IN_PRODUCTION", "READY", "PARTIALLY_DELIVERED"].includes(io.status)) throw invalid("Đơn nội bộ chưa được nhận hoặc đã kết thúc.");
    due ??= io.committed_date;
  }
  if (due && due < vnToday()) throw invalid("Hạn giao không được trước hôm nay.");
  const code = await nextNumber(tx, "OLIGO_ORDER");
  const order = (
    await tx.query(
      `INSERT INTO oligo.oligo_order (code, org_unit_id, internal_order_id, customer_label, due_date, initial_due_date, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $7) RETURNING *`,
      [code, data.org_unit_id, data.internal_order_id ?? null, data.customer_label ?? null, due, data.notes ?? null, actor.userId]
    )
  ).rows[0];
  await writeAudit(tx, actor, { entityType: "oligo_order", entityId: order.id, action: "create", changes: { code: [null, code] } });
  return order;
}

const linesSchema = z.object({
  text: z.string().min(1, "dán ít nhất một trình tự").max(500_000),
  defaults: z.object({
    scale_code: z.string().min(1, "chọn thang tổng hợp mặc định"),
    purification: z.enum(PURIFICATIONS),
    format: z.enum(FORMATS),
  }),
});

interface ParsedLine {
  line: number;
  name: string;
  raw: string;
  scale_code: string;
  purification: string;
  format: string;
}

/**
 * Parses "name; sequence; scale; purification; format" lines (tab or ';' separated, only the sequence is
 * required). Every line is checked first and nothing is saved if any line is wrong (all or nothing).
 */
async function parseLines(tx: Tx, text: string, defaults: z.infer<typeof linesSchema>["defaults"]) {
  const scales = new Map(
    (await tx.query("SELECT code, label FROM oligo.scale WHERE status = 'ACTIVE'")).rows.flatMap((s) => [
      [s.code.toUpperCase(), s.code],
      [s.label.toUpperCase().replace(/\s+/g, ""), s.code],
    ])
  );
  if (!scales.has(defaults.scale_code.toUpperCase())) throw invalid(`Thang tổng hợp "${defaults.scale_code}" không có trong cấu hình.`);
  const catalog = await loadCatalog(tx);
  const errors: { line: number; message: string }[] = [];
  const out: (ParsedLine & { a: ReturnType<typeof analyze> })[] = [];
  text.split(/\r?\n/).forEach((rawLine, i) => {
    const l = rawLine.trim();
    if (!l) return;
    const cols = l.split(/\t|;/).map((c) => c.trim());
    const [name, raw, scale, purification, format] = cols.length === 1 ? ["", cols[0]] : cols;
    const line = i + 1;
    const sc = scale ? scales.get(scale.toUpperCase().replace(/\s+/g, "")) : defaults.scale_code;
    if (!sc) return void errors.push({ line, message: `Thang "${scale}" không có trong cấu hình (thang ngoài bảng không tự đoán).` });
    const pu = (purification || defaults.purification).toUpperCase();
    if (!(PURIFICATIONS as readonly string[]).includes(pu)) return void errors.push({ line, message: `Tinh sạch "${purification}" không hợp lệ (DESALT, OPC, HPLC, PAGE).` });
    const fo = (format || defaults.format).toUpperCase();
    const foNorm = fo === "DONG KHO" || fo === "ĐÔNG KHÔ" ? "LYOPHILIZED" : fo === "DUNG DICH" || fo === "DUNG DỊCH" ? "LIQUID" : fo;
    if (!(FORMATS as readonly string[]).includes(foNorm)) return void errors.push({ line, message: `Định dạng "${format}" không hợp lệ (LYOPHILIZED / LIQUID).` });
    try {
      const a = analyze(raw ?? "", catalog);
      out.push({ line, name: name || `Oligo ${line}`, raw: raw!, scale_code: sc, purification: pu, format: foNorm, a });
    } catch (e) {
      if (e instanceof SequenceError) errors.push({ line, message: e.message });
      else throw e;
    }
  });
  if (errors.length) throw invalid(`Có ${errors.length} dòng lỗi, chưa lưu dòng nào.`, errors, "SEQUENCE_LINES_INVALID");
  if (!out.length) throw invalid("Không có trình tự nào.");
  if (out.length > 1000) throw invalid("Tối đa 1000 trình tự mỗi lần.");
  return out;
}

export function productTypeOf(a: ReturnType<typeof analyze>): string {
  return a.product_type === "AMPLICON" ? "AMPLICON_LINEAR" : a.product_type;
}

export async function insertSequence(
  tx: Tx,
  actor: AuthzActor,
  fields: {
    order_id: string | null;
    org_unit_id: string;
    line_no: number | null;
    name: string;
    raw: string;
    a: ReturnType<typeof analyze>;
    scale_code: string;
    purification: string;
    format: string;
    parent_sequence_id?: string | null;
    relation?: string | null;
  }
) {
  const code = await nextNumber(tx, "OLIGO_SEQUENCE");
  const a = fields.a;
  return (
    await tx.query(
      `INSERT INTO oligo.oligo_sequence (code, order_id, org_unit_id, line_no, name, raw_sequence, normalized_sequence, base_count, molecule_type, product_type,
         scale_code, purification, format, mw, ext_coeff_260, tm, nmol_per_od, ug_per_od, gc_percent, modifications, warnings, parent_sequence_id, relation, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $24) RETURNING *`,
      [
        code, fields.order_id, fields.org_unit_id, fields.line_no, fields.name, fields.raw, a.normalized, a.length, a.molecule_type, productTypeOf(a),
        fields.scale_code, fields.purification, fields.format, a.mw, a.ext_coeff_260, a.tm, a.nmol_per_od, a.ug_per_od, a.gc_percent, a.modifications,
        JSON.stringify(a.warnings), fields.parent_sequence_id ?? null, fields.relation ?? null, actor.userId,
      ]
    )
  ).rows[0];
}

/** Adds pasted sequences to an order (all or nothing); properties are computed by the analyser. */
export async function addSequences(tx: Tx, actor: AuthzActor, orderId: string, input: unknown) {
  const data = parseInput(linesSchema, input);
  const order = (await tx.query("SELECT * FROM oligo.oligo_order WHERE id = $1 FOR UPDATE", [orderId])).rows[0];
  if (!order) throw notFound("đơn Oligo");
  await authorize(tx, actor, "oligo.order.manage", order.org_unit_id);
  if (["COMPLETED", "DELIVERED", "CANCELLED"].includes(order.status)) throw invalid("Đơn đã kết thúc, không thêm trình tự.");
  const lines = await parseLines(tx, data.text, data.defaults);
  let lineNo = Number((await tx.query("SELECT coalesce(max(line_no), 0) AS n FROM oligo.oligo_sequence WHERE order_id = $1", [orderId])).rows[0].n);
  const created = [];
  for (const l of lines) {
    created.push(await insertSequence(tx, actor, { order_id: orderId, org_unit_id: order.org_unit_id, line_no: ++lineNo, name: l.name, raw: l.raw, a: l.a, scale_code: l.scale_code, purification: l.purification, format: l.format }));
  }
  await writeAudit(tx, actor, { entityType: "oligo_order", entityId: orderId, action: "add_sequences", changes: { sequences: [null, created.length] } });
  return { added: created.length };
}

/** Order status is derived from its sequences (docs 02 §9.2), recomputed in the same transaction as any change. */
export async function recomputeOrderStatus(tx: Tx, actor: AuthzActor, orderId: string): Promise<void> {
  const order = (await tx.query("SELECT status FROM oligo.oligo_order WHERE id = $1 FOR UPDATE", [orderId])).rows[0];
  if (!order || order.status === "CANCELLED") return;
  const rows = (
    await tx.query(
      `SELECT CASE WHEN s.status = 'POOLED' THEN m.status ELSE s.status END AS st
         FROM oligo.oligo_sequence s
         LEFT JOIN oligo.oligo_pool p ON p.id = s.pool_id AND s.status = 'POOLED'
         LEFT JOIN oligo.oligo_sequence m ON m.id = p.master_sequence_id
        WHERE s.order_id = $1 AND s.status NOT IN ('CANCELLED', 'SPLIT')
          AND NOT (s.status = 'FAILED' AND EXISTS (SELECT 1 FROM oligo.oligo_sequence r WHERE r.parent_sequence_id = s.id AND r.relation = 'RESYNTH'))`,
      [orderId]
    )
  ).rows.map((r) => r.st as string);
  let next = "PENDING";
  if (rows.length && rows.every((s) => s === "DELIVERED")) next = "DELIVERED";
  else if (rows.length && rows.every((s) => s === "COMPLETED" || s === "DELIVERED")) next = "COMPLETED";
  else if (rows.length && rows.every((s) => s === "FAILED")) next = "FAILED";
  else if (rows.some((s) => s !== "PENDING")) next = "IN_PROGRESS";
  if (next !== order.status) {
    await tx.query("UPDATE oligo.oligo_order SET status = $2, version = version + 1, updated_at = now() WHERE id = $1", [orderId, next]);
    await writeAudit(tx, actor, { entityType: "oligo_order", entityId: orderId, action: "derive_status", changes: { status: [order.status, next] } });
  }
}

/** Re-derives every order the given sequences serve, pool members of a pool master included. */
export async function recomputeOrdersOf(tx: Tx, actor: AuthzActor, sequenceIds: string[]): Promise<void> {
  const orders = (
    await tx.query(
      `SELECT DISTINCT s.order_id FROM oligo.oligo_sequence s WHERE s.id = ANY($1::uuid[]) AND s.order_id IS NOT NULL
       UNION
       SELECT DISTINCT m.order_id FROM oligo.oligo_pool p JOIN oligo.oligo_pool_member pm ON pm.pool_id = p.id JOIN oligo.oligo_sequence m ON m.id = pm.sequence_id
        WHERE p.master_sequence_id = ANY($1::uuid[])`,
      [sequenceIds]
    )
  ).rows;
  for (const o of orders) await recomputeOrderStatus(tx, actor, o.order_id);
}

/** Cancels an order whose sequences have not gone to synthesis yet. */
export async function cancelOligoOrder(tx: Tx, actor: AuthzActor, orderId: string, reason: unknown) {
  const why = parseInput(z.string().trim().min(3, "nhập lý do hủy"), reason);
  const order = (await tx.query("SELECT * FROM oligo.oligo_order WHERE id = $1 FOR UPDATE", [orderId])).rows[0];
  if (!order) throw notFound("đơn Oligo");
  await authorize(tx, actor, "oligo.order.manage", order.org_unit_id);
  const started = await tx.query("SELECT 1 FROM oligo.oligo_sequence WHERE order_id = $1 AND status NOT IN ('PENDING', 'SPLIT', 'CANCELLED') LIMIT 1", [orderId]);
  if (started.rowCount) throw invalid("Đơn đã có trình tự được gộp hoặc xếp mẻ, không hủy được. Hủy gộp / hủy mẻ trước.");
  await tx.query("UPDATE oligo.oligo_sequence SET status = 'CANCELLED', version = version + 1, updated_at = now(), updated_by = $2 WHERE order_id = $1 AND status <> 'CANCELLED'", [orderId, actor.userId]);
  await tx.query("UPDATE oligo.oligo_order SET status = 'CANCELLED', version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $1", [orderId, actor.userId]);
  await writeAudit(tx, actor, { entityType: "oligo_order", entityId: orderId, action: "cancel", changes: { status: [order.status, "CANCELLED"] }, reason: why });
}

/** Org units of Oligo orders the actor may see. */
export async function visibleOligoUnits(tx: Tx, actor: AuthzActor): Promise<string[] | "ALL"> {
  if (await hasFactoryPermission(tx, actor, "oligo.view")) return "ALL";
  const units = (await tx.query("SELECT id FROM core.org_unit WHERE module_key = 'OLIGO'")).rows.map((r) => r.id as string);
  const out: string[] = [];
  for (const u of units) if (await hasFactoryPermission(tx, actor, "oligo.view", u)) out.push(u);
  return out;
}

export async function listOligoOrders(tx: Tx, actor: AuthzActor, status?: string) {
  const units = await visibleOligoUnits(tx, actor);
  if (units !== "ALL" && !units.length) return [];
  return (
    await tx.query(
      `SELECT o.id, o.code, o.customer_label, o.due_date, o.due_date_change_count, o.status, o.created_at, io.kd_po_code,
              (SELECT count(*)::int FROM oligo.oligo_sequence s WHERE s.order_id = o.id AND s.status NOT IN ('CANCELLED', 'SPLIT')) AS sequence_count
         FROM oligo.oligo_order o LEFT JOIN intake.internal_order io ON io.id = o.internal_order_id
        WHERE ($1::uuid[] IS NULL OR o.org_unit_id = ANY($1::uuid[])) AND ($2::text IS NULL OR o.status = $2)
        ORDER BY o.created_at DESC LIMIT 300`,
      [units === "ALL" ? null : units, status ?? null]
    )
  ).rows;
}

export async function getOligoOrder(tx: Tx, actor: AuthzActor, id: string) {
  const order = (
    await tx.query(
      "SELECT o.*, io.code AS internal_order_code, io.kd_po_code FROM oligo.oligo_order o LEFT JOIN intake.internal_order io ON io.id = o.internal_order_id WHERE o.id = $1",
      [id]
    )
  ).rows[0];
  if (!order) throw notFound("đơn Oligo");
  const units = await visibleOligoUnits(tx, actor);
  if (units !== "ALL" && !units.includes(order.org_unit_id)) throw notFound("đơn Oligo");
  const sequences = (
    await tx.query(
      `SELECT s.id, s.code, s.line_no, s.name, s.raw_sequence, s.normalized_sequence, s.base_count, s.molecule_type, s.product_type, s.scale_code, s.purification,
              s.format, s.mw::float AS mw, s.ext_coeff_260::float AS ext_coeff_260, s.tm::float AS tm, s.nmol_per_od::float AS nmol_per_od, s.ug_per_od::float AS ug_per_od,
              s.gc_percent::float AS gc_percent, s.modifications, s.warnings, s.status, s.parent_sequence_id, s.relation, s.pool_id, s.version,
              m.code AS pool_master_code
         FROM oligo.oligo_sequence s
         LEFT JOIN oligo.oligo_pool p ON p.id = s.pool_id LEFT JOIN oligo.oligo_sequence m ON m.id = p.master_sequence_id
        WHERE s.order_id = $1 ORDER BY s.line_no NULLS LAST, s.code`,
      [id]
    )
  ).rows;
  return { ...order, sequences };
}

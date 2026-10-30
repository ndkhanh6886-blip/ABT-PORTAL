import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, type AuthzActor } from "../core/authz";
import { invalid, notFound } from "../core/errors";
import { parseInput } from "../core/records";
import { pyRound } from "./analyzer";

const schema = z.object({
  members: z
    .array(z.object({ sequence_id: z.string().uuid(), ratio_pct: z.coerce.number().positive().max(100), tube_count: z.coerce.number().int().min(1).max(100).default(1) }))
    .min(2, "mẻ gộp có ít nhất 2 ống khách hàng"),
});

/** The pool master's members with their agreed share and the current aliquot, for the split screen. */
export async function poolAliquotView(tx: Tx, actor: AuthzActor, masterSeqId: string) {
  const m = (await tx.query("SELECT * FROM oligo.oligo_sequence WHERE id = $1 AND relation = 'POOL_MASTER'", [masterSeqId])).rows[0];
  if (!m) throw notFound("trình tự gộp");
  await authorize(tx, actor, "oligo.view", m.org_unit_id);
  const rec = (await tx.query("SELECT id, od_total::float AS od_total, nmol::float AS nmol, ug::float AS ug, resuspend_volume_ul::float AS volume_ul, format FROM oligo.post_process WHERE sequence_id = $1 AND status <> 'VOID'", [m.id])).rows[0] ?? null;
  const members = (
    await tx.query(
      `SELECT s.id, s.code, s.name, s.scale_code, s.status, o.code AS order_code, o.customer_label, pm.ratio_pct::float AS agreed_pct,
              pa.ratio_pct::float AS ratio_pct, pa.od::float AS od, pa.nmol::float AS nmol, pa.volume_ul::float AS volume_ul, pa.tube_count
         FROM oligo.oligo_pool p JOIN oligo.oligo_pool_member pm ON pm.pool_id = p.id JOIN oligo.oligo_sequence s ON s.id = pm.sequence_id
         LEFT JOIN oligo.oligo_order o ON o.id = s.order_id
         LEFT JOIN oligo.pool_aliquot pa ON pa.sequence_id = s.id AND pa.master_post_process_id = $2
        WHERE p.master_sequence_id = $1 ORDER BY s.code`,
      [m.id, rec?.id ?? null]
    )
  ).rows;
  return { master: { id: m.id, code: m.code, status: m.status }, record: rec, members };
}

/**
 * Post-OD aliquot of a pooled synthesis (as OligoFlow's "Tách chia ống sau đo nồng độ"): the measured OD / nmol / µg
 * (and the resuspension volume) of the pool master are shared between the customer tubes by percentage (100 % in
 * all). Redone freely until a member is delivered; each member's labels and delivery use its own share.
 */
export async function aliquotPool(tx: Tx, actor: AuthzActor, masterSeqId: string, input: unknown) {
  const d = parseInput(schema, input);
  const m = (await tx.query("SELECT * FROM oligo.oligo_sequence WHERE id = $1 AND relation = 'POOL_MASTER' FOR UPDATE", [masterSeqId])).rows[0];
  if (!m) throw notFound("trình tự gộp");
  await authorize(tx, actor, "oligo.post.manage", m.org_unit_id);
  if (!["POST_PROCESSING", "QC", "COMPLETED"].includes(m.status)) throw invalid("Chia ống sau khi đã đo OD ở hậu tổng hợp.");
  const rec = (await tx.query("SELECT * FROM oligo.post_process WHERE sequence_id = $1 AND status <> 'VOID' FOR UPDATE", [m.id])).rows[0];
  if (!rec || !(Number(rec.od_total) > 0)) throw invalid("Trình tự gộp chưa có kết quả đo OD.", undefined, "OD_MISSING");
  const members = (await tx.query("SELECT pm.sequence_id, s.code, s.status FROM oligo.oligo_pool p JOIN oligo.oligo_pool_member pm ON pm.pool_id = p.id JOIN oligo.oligo_sequence s ON s.id = pm.sequence_id WHERE p.master_sequence_id = $1", [m.id])).rows;
  if (members.some((x) => x.status === "DELIVERED")) throw invalid("Đã có ống khách hàng được giao: không chia lại được.", undefined, "ALREADY_DELIVERED");
  const ids = new Set(members.map((x) => x.sequence_id));
  if (d.members.length !== ids.size || d.members.some((x) => !ids.has(x.sequence_id))) throw invalid("Phải chia cho đúng và đủ các ống của mẻ gộp.");
  const total = d.members.reduce((n, x) => n + x.ratio_pct, 0);
  if (Math.abs(total - 100) > 0.01) throw invalid(`Tổng tỷ lệ phải là 100 % (đang ${pyRound(total, 2)} %).`, undefined, "RATIO_TOTAL");
  const before = (await tx.query("SELECT sequence_id, ratio_pct::float AS r FROM oligo.pool_aliquot WHERE master_post_process_id = $1", [rec.id])).rows;
  await tx.query("DELETE FROM oligo.pool_aliquot WHERE master_post_process_id = $1", [rec.id]);
  for (const x of d.members) {
    const f = x.ratio_pct / 100;
    await tx.query(
      "INSERT INTO oligo.pool_aliquot (master_post_process_id, sequence_id, ratio_pct, od, nmol, ug, volume_ul, tube_count, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [rec.id, x.sequence_id, x.ratio_pct, pyRound(Number(rec.od_total) * f, 3), pyRound(Number(rec.nmol) * f, 3), pyRound(Number(rec.ug) * f, 3),
        rec.resuspend_volume_ul == null ? null : pyRound(Number(rec.resuspend_volume_ul) * f, 2), x.tube_count, actor.userId],
    );
  }
  await writeAudit(tx, actor, {
    entityType: "oligo_post_process",
    entityId: rec.id,
    action: "pool_aliquot",
    changes: { split: [before.map((b) => `${b.sequence_id.slice(0, 8)}:${b.r}`).join(" "), d.members.map((x) => `${x.sequence_id.slice(0, 8)}:${x.ratio_pct}`).join(" ")] },
  });
  return poolAliquotView(tx, actor, masterSeqId);
}

const correctSchema = z.object({
  step_no: z.coerce.number().int().min(1),
  values: z.record(z.union([z.string(), z.number(), z.null()])),
  reason: z.string().trim().min(3, "nhập lý do sửa"),
});

/**
 * Corrects the recorded values of a logged SOP step while the record is still open (a typo, a reading entered in the
 * wrong field). Reagent quantities, the equipment and the column of the step are not changed here — those moved stock
 * and counted runs; a wrong one is handled through an incident. The previous values are kept and the change audited.
 */
export async function correctStep(tx: Tx, actor: AuthzActor, seqId: string, input: unknown) {
  const d = parseInput(correctSchema, input);
  const s = (await tx.query("SELECT id, code, org_unit_id FROM oligo.oligo_sequence WHERE id = $1", [seqId])).rows[0];
  if (!s) throw notFound("trình tự");
  await authorize(tx, actor, "oligo.post.manage", s.org_unit_id);
  const rec = (await tx.query("SELECT * FROM oligo.post_process WHERE sequence_id = $1 AND status <> 'VOID' FOR UPDATE", [seqId])).rows[0];
  if (!rec || rec.status !== "OPEN") throw invalid("Chỉ sửa số liệu khi hồ sơ hậu tổng hợp chưa gửi QC.");
  const log = (await tx.query("SELECT * FROM oligo.ps_step_log WHERE post_process_id = $1 AND step_no = $2 FOR UPDATE", [rec.id, d.step_no])).rows[0];
  if (!log) throw notFound(`bước ${d.step_no}`);
  const step = (rec.workflow_steps as any[]).find((x) => x.step_no === d.step_no);
  const editable = new Map<string, any>(step.fields.filter((f: any) => f.type === "NUMBER" || f.type === "TEXT").map((f: any) => [f.key, f]));
  const next = { ...log.values };
  const changes: Record<string, [unknown, unknown]> = {};
  for (const [k, v] of Object.entries(d.values)) {
    const f = editable.get(k);
    if (!f) throw invalid(`Không sửa được "${k}" ở đây (hóa chất, thiết bị, cột đã ghi kho / khấu hao).`, undefined, "NOT_EDITABLE");
    let val: string | number | null = v == null || String(v).trim() === "" ? null : f.type === "NUMBER" ? Number(String(v).replace(",", ".")) : String(v).trim();
    if (f.type === "NUMBER" && val != null && !Number.isFinite(val)) throw invalid(`"${f.label}" phải là số.`);
    if (val == null && f.required) throw invalid(`"${f.label}" là bắt buộc.`);
    if (next[k] !== val) changes[`${step.name} / ${f.label}`] = [next[k] ?? null, val];
    next[k] = val;
  }
  if (!Object.keys(changes).length) return log;
  await tx.query("UPDATE oligo.ps_step_log SET values = $3, previous_values = $4, corrected_at = now(), corrected_by = $5 WHERE post_process_id = $1 AND step_no = $2", [
    rec.id, d.step_no, JSON.stringify(next), JSON.stringify(log.values), actor.userId,
  ]);
  await writeAudit(tx, actor, { entityType: "oligo_post_process", entityId: rec.id, action: "correct_step", changes, reason: d.reason });
  return { ...log, values: next };
}

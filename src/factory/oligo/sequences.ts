import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, type AuthzActor } from "../core/authz";
import { conflict, invalid, notFound } from "../core/errors";
import { parseInput } from "../core/records";
import { defineMachine, runTransition } from "../core/stateMachine";
import { analyze, SequenceError } from "./analyzer";
import { loadCatalog } from "./catalog";
import { FORMATS, inferOligoRole, insertSequence, OLIGO_ROLES, productTypeOf, PURIFICATIONS, recomputeOrderStatus, visibleOligoUnits } from "./orders";

export type SeqStatus =
  | "PENDING" | "SPLIT" | "POOLED" | "QUEUED" | "SYNTHESIZING" | "SYNTHESIZED" | "POST_PROCESSING" | "QC" | "COMPLETED" | "DELIVERED" | "FAILED" | "CANCELLED";
export interface OligoSequence {
  id: string;
  code: string;
  order_id: string | null;
  org_unit_id: string;
  name: string;
  status: SeqStatus;
  relation: string | null;
  parent_sequence_id: string | null;
  pool_id: string | null;
  version: number;
}

/** Sequence life cycle (docs 02 §9.1). Synthesis / post-processing / QC transitions come with the batch module. */
export const sequenceMachine = defineMachine<SeqStatus, OligoSequence>({
  entityType: "oligo_sequence",
  table: "oligo.oligo_sequence",
  states: ["PENDING", "SPLIT", "POOLED", "QUEUED", "SYNTHESIZING", "SYNTHESIZED", "POST_PROCESSING", "QC", "COMPLETED", "DELIVERED", "FAILED", "CANCELLED"],
  terminal: ["DELIVERED", "CANCELLED"],
  scopeOf: (row) => row.org_unit_id,
  transitions: [
    {
      action: "cancel",
      from: "PENDING",
      to: "CANCELLED",
      permission: "oligo.order.manage",
      reasonRequired: true,
      guards: [{ code: "POOL_MASTER", message: "Trình tự gộp: dùng Hủy gộp.", check: ({ row }) => row.relation !== "POOL_MASTER" }],
    },
    { action: "split", from: "PENDING", to: "SPLIT", permission: "oligo.order.manage" },
    { action: "unsplit", from: "SPLIT", to: "PENDING", permission: "oligo.order.manage" },
    { action: "pool", from: "PENDING", to: "POOLED", permission: "oligo.order.manage" },
    { action: "unpool", from: "POOLED", to: "PENDING", permission: "oligo.order.manage" },
    // driven by synthesis batches (run as trusted follow-ups of the batch action)
    { action: "queue", from: "PENDING", to: "QUEUED", permission: "oligo.batch.manage" },
    { action: "dequeue", from: "QUEUED", to: "PENDING", permission: "oligo.batch.manage" },
    { action: "start_synthesis", from: "QUEUED", to: "SYNTHESIZING", permission: "oligo.batch.manage" },
    { action: "synthesized", from: "SYNTHESIZING", to: "SYNTHESIZED", permission: "oligo.batch.manage" },
    { action: "fail", from: ["SYNTHESIZING", "POST_PROCESSING", "QC"], to: "FAILED", permission: "oligo.batch.manage", reasonRequired: true },
    // post-synthesis (oligo/postProcess.ts) and the QA/QC review hook
    { action: "start_post", from: "SYNTHESIZED", to: "POST_PROCESSING", permission: "oligo.post.manage" },
    { action: "send_qc", from: "POST_PROCESSING", to: "QC", permission: "oligo.post.manage" },
    { action: "qc_cancelled", from: "QC", to: "POST_PROCESSING", permission: "qms.qc.lead", reasonRequired: true },
    { action: "qc_passed", from: "QC", to: "COMPLETED", permission: "qms.qc.review" },
    { action: "qc_failed", from: "QC", to: "FAILED", permission: "qms.qc.review", reasonRequired: true },
    // approved NCR dispositions (oligo/fulfilment.ts) and delivery
    { action: "rework", from: "FAILED", to: "POST_PROCESSING", permission: "qms.ncr.approve", reasonRequired: true },
    { action: "concession", from: "FAILED", to: "COMPLETED", permission: "qms.ncr.approve_bod", reasonRequired: true },
    { action: "deliver", from: ["COMPLETED", "POOLED"], to: "DELIVERED", permission: "oligo.delivery.manage" },
  ],
});

async function lockSequence(tx: Tx, id: string): Promise<OligoSequence> {
  const s = (await tx.query("SELECT * FROM oligo.oligo_sequence WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!s) throw notFound("trình tự");
  return s;
}
const move = (tx: Tx, actor: AuthzActor, s: OligoSequence, action: string, reason?: string) =>
  runTransition(tx, sequenceMachine, actor, { id: s.id, action, expectedVersion: s.version, reason });

const editSchema = z.object({
  version: z.number().int().min(0),
  name: z.string().trim().min(1).max(200).optional(),
  raw_sequence: z.string().trim().min(1).max(5000).optional(),
  scale_code: z.string().optional(),
  purification: z.enum(PURIFICATIONS).optional(),
  format: z.enum(FORMATS).optional(),
  oligo_role: z.enum(OLIGO_ROLES).optional(),
  target_pathogen: z.string().trim().max(150).optional().nullable(),
  reason: z.string().trim().max(500).optional().nullable(),
});

/** A sequence is edited only while PENDING (and not split / pooled); its properties are recomputed. */
export async function editSequence(tx: Tx, actor: AuthzActor, id: string, input: unknown) {
  const data = parseInput(editSchema, input);
  const s = await lockSequence(tx, id);
  await authorize(tx, actor, "oligo.order.manage", s.org_unit_id);
  if (s.status !== "PENDING" || s.relation === "POOL_MASTER") throw invalid("Chỉ sửa trình tự đang chờ, chưa tách / gộp / xếp mẻ.");
  if (s.version !== data.version) throw conflict("Trình tự vừa được người khác sửa. Tải lại rồi thực hiện lại.", "STALE_VERSION");
  if (data.scale_code && !(await tx.query("SELECT 1 FROM oligo.scale WHERE code = $1 AND status = 'ACTIVE'", [data.scale_code])).rowCount) {
    throw invalid(`Thang "${data.scale_code}" không có trong cấu hình.`);
  }
  const cur = (await tx.query("SELECT * FROM oligo.oligo_sequence WHERE id = $1", [id])).rows[0];
  const raw = data.raw_sequence ?? cur.raw_sequence;
  let a;
  try {
    a = analyze(raw, await loadCatalog(tx));
  } catch (e) {
    if (e instanceof SequenceError) throw invalid(e.message);
    throw e;
  }
  const nextName = data.name ?? cur.name;
  const next = {
    name: nextName,
    raw_sequence: raw,
    normalized_sequence: a.normalized,
    scale_code: data.scale_code ?? cur.scale_code,
    purification: data.purification ?? cur.purification,
    format: data.format ?? cur.format,
    oligo_role: data.oligo_role ?? cur.oligo_role ?? inferOligoRole(nextName, a),
    target_pathogen: data.target_pathogen === undefined ? cur.target_pathogen : data.target_pathogen,
  };
  await tx.query(
    `UPDATE oligo.oligo_sequence SET name = $2, raw_sequence = $3, normalized_sequence = $4, base_count = $5, molecule_type = $6, product_type = $7,
            scale_code = $8, purification = $9, format = $10, mw = $11, ext_coeff_260 = $12, tm = $13, nmol_per_od = $14, ug_per_od = $15, gc_percent = $16,
            modifications = $17, warnings = $18, oligo_role = $20, target_pathogen = $21, version = version + 1, updated_at = now(), updated_by = $19 WHERE id = $1`,
    [id, next.name, raw, a.normalized, a.length, a.molecule_type, productTypeOf(a), next.scale_code, next.purification, next.format, a.mw, a.ext_coeff_260, a.tm,
     a.nmol_per_od, a.ug_per_od, a.gc_percent, a.modifications, JSON.stringify(a.warnings), actor.userId, next.oligo_role, next.target_pathogen]
  );
  const changes: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(next) as (keyof typeof next)[]) if (cur[k] !== next[k]) changes[k] = [cur[k], next[k]];
  await writeAudit(tx, actor, { entityType: "oligo_sequence", entityId: id, action: "edit", changes, reason: data.reason ?? null });
}

export async function cancelSequence(tx: Tx, actor: AuthzActor, id: string, reason: unknown) {
  const s = await lockSequence(tx, id);
  await move(tx, actor, s, "cancel", parseInput(z.string().trim().min(3, "nhập lý do hủy"), reason));
  if (s.order_id) await recomputeOrderStatus(tx, actor, s.order_id);
}

/** Splits a pending sequence into separate tubes (child sequences), before any synthesis. */
export async function splitSequence(tx: Tx, actor: AuthzActor, id: string, input: unknown) {
  const { parts } = parseInput(z.object({ parts: z.array(z.object({ name: z.string().trim().max(200).optional(), scale_code: z.string().min(1) })).min(2, "tách ít nhất 2 ống").max(20) }), input);
  const s = await lockSequence(tx, id);
  if (s.relation) throw invalid("Chỉ tách trình tự gốc (không tách trình tự đã tách, đã gộp hay tổng hợp lại).");
  await move(tx, actor, s, "split");
  const cur = (await tx.query("SELECT * FROM oligo.oligo_sequence WHERE id = $1", [id])).rows[0];
  const a = analyze(cur.raw_sequence, await loadCatalog(tx));
  for (const [i, p] of parts.entries()) {
    if (!(await tx.query("SELECT 1 FROM oligo.scale WHERE code = $1 AND status = 'ACTIVE'", [p.scale_code])).rowCount) throw invalid(`Thang "${p.scale_code}" không có trong cấu hình.`);
    await insertSequence(tx, actor, {
      order_id: cur.order_id, org_unit_id: cur.org_unit_id, line_no: cur.line_no, name: p.name || `${cur.name}-${i + 1}`, raw: cur.raw_sequence, a,
      scale_code: p.scale_code, purification: cur.purification, format: cur.format, parent_sequence_id: id, relation: "SPLIT",
    });
  }
  await recomputeOrderStatus(tx, actor, cur.order_id);
}

/** Undoes a split while none of the tubes has moved on. */
export async function unsplitSequence(tx: Tx, actor: AuthzActor, id: string) {
  const s = await lockSequence(tx, id);
  const children = (await tx.query("SELECT id, status FROM oligo.oligo_sequence WHERE parent_sequence_id = $1 AND relation IN ('SPLIT', 'FRAGMENT') AND status <> 'CANCELLED' FOR UPDATE", [id])).rows;
  if (children.some((c) => c.status !== "PENDING")) throw invalid("Có ống đã gộp hoặc đã xếp mẻ, không hủy tách được.");
  await move(tx, actor, s, "unsplit");
  await tx.query("UPDATE oligo.oligo_sequence SET status = 'CANCELLED', version = version + 1, updated_at = now(), updated_by = $2 WHERE id = ANY($1::uuid[])", [
    children.map((c) => c.id),
    actor.userId,
  ]);
  await writeAudit(tx, actor, { entityType: "oligo_sequence", entityId: id, action: "unsplit_children", changes: { cancelled_children: [null, children.length] } });
  if (s.order_id) await recomputeOrderStatus(tx, actor, s.order_id);
}

/**
 * Pools identical pending sequences (same normalised sequence, purification, format and type — from one or
 * several orders) into one synthesis. Shares must total 100 %; a master sequence carries the synthesis.
 */
export async function poolSequences(tx: Tx, actor: AuthzActor, input: unknown) {
  const data = parseInput(
    z.object({
      sequence_ids: z.array(z.string().uuid()).min(2, "chọn ít nhất 2 trình tự").max(100),
      scale_code: z.string().min(1, "chọn thang tổng hợp cho mẻ gộp"),
      ratios: z.array(z.coerce.number().positive()).optional(),
    }),
    input
  );
  const ids = [...new Set(data.sequence_ids)].sort();
  if (ids.length < 2) throw invalid("Chọn ít nhất 2 trình tự khác nhau.");
  const rows = (await tx.query("SELECT * FROM oligo.oligo_sequence WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE", [ids])).rows;
  if (rows.length !== ids.length) throw notFound("trình tự");
  const first = rows[0];
  for (const r of rows) {
    if (r.status !== "PENDING" || r.relation === "POOL_MASTER") throw invalid(`${r.code}: chỉ gộp trình tự đang chờ.`);
    const same = ["normalized_sequence", "purification", "format", "product_type", "molecule_type", "org_unit_id"].every((k) => r[k] === first[k]);
    if (!same) throw invalid(`${r.code} khác ${first.code} (trình tự, tinh sạch, định dạng hoặc loại): không gộp được.`, undefined, "POOL_MISMATCH");
  }
  const ratios = data.ratios ?? rows.map(() => 100 / rows.length);
  if (ratios.length !== rows.length) throw invalid("Số tỉ lệ phải bằng số trình tự.");
  const rounded = ratios.map((r) => Math.round(r * 100) / 100);
  if (Math.abs(rounded.reduce((s, x) => s + x, 0) - 100) > 0.011) throw invalid("Tổng tỉ lệ chia phải bằng 100%.");
  rounded[rounded.length - 1] = Math.round((100 - rounded.slice(0, -1).reduce((s, x) => s + x, 0)) * 100) / 100;
  if (!(await tx.query("SELECT 1 FROM oligo.scale WHERE code = $1 AND status = 'ACTIVE'", [data.scale_code])).rowCount) throw invalid(`Thang "${data.scale_code}" không có trong cấu hình.`);

  const a = analyze(first.raw_sequence, await loadCatalog(tx));
  const master = await insertSequence(tx, actor, {
    order_id: null, org_unit_id: first.org_unit_id, line_no: null, name: `Gộp ${rows.map((r) => r.code).join(" + ")}`.slice(0, 200), raw: first.raw_sequence, a,
    scale_code: data.scale_code, purification: first.purification, format: first.format, relation: "POOL_MASTER",
  });
  await authorize(tx, actor, "oligo.order.manage", first.org_unit_id);
  const pool = (await tx.query("INSERT INTO oligo.oligo_pool (master_sequence_id, created_by) VALUES ($1, $2) RETURNING id", [master.id, actor.userId])).rows[0];
  for (const [i, r] of rows.entries()) {
    await tx.query("INSERT INTO oligo.oligo_pool_member (pool_id, sequence_id, ratio_pct) VALUES ($1, $2, $3)", [pool.id, r.id, rounded[i]]);
    await move(tx, actor, r, "pool");
    await tx.query("UPDATE oligo.oligo_sequence SET pool_id = $2 WHERE id = $1", [r.id, pool.id]);
  }
  await writeAudit(tx, actor, { entityType: "oligo_sequence", entityId: master.id, action: "pool", changes: { members: [null, rows.map((r) => `${r.code} ${rounded[rows.indexOf(r)]}%`)] } });
  for (const orderId of new Set(rows.map((r) => r.order_id))) await recomputeOrderStatus(tx, actor, orderId);
  return master;
}

/** Dissolves a pool whose master has not gone to synthesis: members return to PENDING. */
export async function unpoolSequences(tx: Tx, actor: AuthzActor, masterId: string) {
  const m = await lockSequence(tx, masterId);
  if (m.relation !== "POOL_MASTER") throw invalid("Không phải trình tự gộp.");
  await authorize(tx, actor, "oligo.order.manage", m.org_unit_id);
  if (m.status !== "PENDING") throw invalid("Trình tự gộp đã xếp mẻ, không hủy gộp được.");
  const pool = (await tx.query("SELECT id FROM oligo.oligo_pool WHERE master_sequence_id = $1 AND status = 'ACTIVE' FOR UPDATE", [masterId])).rows[0];
  const members = (await tx.query("SELECT s.* FROM oligo.oligo_pool_member pm JOIN oligo.oligo_sequence s ON s.id = pm.sequence_id WHERE pm.pool_id = $1 ORDER BY s.id FOR UPDATE OF s", [pool.id])).rows;
  for (const r of members) {
    await move(tx, actor, r, "unpool");
    await tx.query("UPDATE oligo.oligo_sequence SET pool_id = NULL WHERE id = $1", [r.id]);
  }
  await tx.query("UPDATE oligo.oligo_pool SET status = 'DISSOLVED' WHERE id = $1", [pool.id]);
  await tx.query("UPDATE oligo.oligo_sequence SET status = 'CANCELLED', version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $1", [masterId, actor.userId]);
  await writeAudit(tx, actor, { entityType: "oligo_sequence", entityId: masterId, action: "unpool", changes: { status: ["PENDING", "CANCELLED"] } });
  for (const orderId of new Set(members.map((r) => r.order_id))) await recomputeOrderStatus(tx, actor, orderId);
}

/** Groups of identical pending sequences that could be synthesised together (across orders). */
export async function poolCandidates(tx: Tx, actor: AuthzActor) {
  const units = await visibleOligoUnits(tx, actor);
  if (units !== "ALL" && !units.length) return [];
  return (
    await tx.query(
      `SELECT s.normalized_sequence, s.purification, s.format, s.product_type, s.org_unit_id,
              json_agg(json_build_object('id', s.id, 'code', s.code, 'name', s.name, 'scale_code', s.scale_code, 'order_code', o.code) ORDER BY s.code) AS sequences
         FROM oligo.oligo_sequence s JOIN oligo.oligo_order o ON o.id = s.order_id
        WHERE s.status = 'PENDING' AND (s.relation IS NULL OR s.relation = 'SPLIT') AND ($1::uuid[] IS NULL OR s.org_unit_id = ANY($1::uuid[]))
        GROUP BY s.normalized_sequence, s.purification, s.format, s.product_type, s.org_unit_id
       HAVING count(*) >= 2
        ORDER BY count(*) DESC LIMIT 200`,
      [units === "ALL" ? null : units]
    )
  ).rows;
}

/** Pending pool masters (synthesised for several orders). */
export async function listPools(tx: Tx, actor: AuthzActor) {
  const units = await visibleOligoUnits(tx, actor);
  if (units !== "ALL" && !units.length) return [];
  return (
    await tx.query(
      `SELECT m.id, m.code, m.name, m.normalized_sequence, m.scale_code, m.purification, m.status,
              json_agg(json_build_object('code', s.code, 'order_code', o.code, 'ratio_pct', pm.ratio_pct) ORDER BY s.code) AS members
         FROM oligo.oligo_pool p JOIN oligo.oligo_sequence m ON m.id = p.master_sequence_id
         JOIN oligo.oligo_pool_member pm ON pm.pool_id = p.id JOIN oligo.oligo_sequence s ON s.id = pm.sequence_id
         LEFT JOIN oligo.oligo_order o ON o.id = s.order_id
        WHERE p.status = 'ACTIVE' AND ($1::uuid[] IS NULL OR m.org_unit_id = ANY($1::uuid[]))
        GROUP BY m.id ORDER BY m.created_at DESC LIMIT 200`,
      [units === "ALL" ? null : units]
    )
  ).rows;
}

import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, registerPermissions, type AuthzActor } from "../core/authz";
import { conflict, invalid, notFound } from "../core/errors";
import { parseInput } from "../core/records";
import { runTransition } from "../core/stateMachine";
import { createQcTest, registerQcSubject } from "../qms/qcTests";
import { pyRound } from "./analyzer";
import { recomputeOrdersOf, visibleOligoUnits } from "./orders";
import { stepLogs, workflowFor } from "./postSop";
import { sequenceMachine } from "./sequences";

registerPermissions([{ code: "oligo.post.manage", description: "Hậu tổng hợp Oligo: cắt, khử bảo vệ, tinh sạch, đo OD, hoàn nguyên / chia ống, gửi QC" }]);

/** Quantification as in OligoFlow: OD × nmol/OD and µg/OD of the sequence; volume (µL) = nmol / µM × 1000. */
export function quantify(seq: { nmol_per_od: number; ug_per_od: number }, m: { a260: number; dilution_factor: number; path_cm: number; stock_volume_ul: number; target_conc_um?: number | null; tube_count: number }) {
  const od = pyRound((m.a260 * m.dilution_factor * (m.stock_volume_ul / 1000)) / m.path_cm, 3);
  const nmol = pyRound(od * seq.nmol_per_od, 2);
  return {
    od_total: od,
    nmol,
    ug: pyRound(od * seq.ug_per_od, 2),
    resuspend_volume_ul: m.target_conc_um ? pyRound((nmol / m.target_conc_um) * 1000, 1) : null,
    od_per_tube: pyRound(od / m.tube_count, 3),
  };
}

async function lockSequence(tx: Tx, id: string) {
  const s = (await tx.query("SELECT * FROM oligo.oligo_sequence WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!s) throw notFound("trình tự");
  return s;
}
const liveRecord = async (tx: Tx, seqId: string, lock = false) =>
  (await tx.query(`SELECT * FROM oligo.post_process WHERE sequence_id = $1 AND status <> 'VOID'${lock ? " FOR UPDATE" : ""}`, [seqId])).rows[0];
const move = async (tx: Tx, actor: AuthzActor, seq: { id: string; version: number }, action: string, reason?: string, trusted = false) => {
  const out = await runTransition(tx, sequenceMachine, actor, { id: seq.id, action, expectedVersion: seq.version, reason }, { trusted });
  await recomputeOrdersOf(tx, actor, [seq.id]);
  return out;
};

/** A new post-processing record; it follows (a frozen copy of) the SOP workflow of the purification when one is configured. */
export async function openRecord(tx: Tx, actor: AuthzActor, f: { sequence_id: string; batch_id: string | null; purification: string; format: string; scale_code?: string; mfg_date?: string | null; notes?: string }) {
  const wf = await workflowFor(tx, f.purification);
  return (
    await tx.query(
      `INSERT INTO oligo.post_process (sequence_id, batch_id, purification, format, synthesis_scale_code, mfg_date, notes, workflow_id, workflow_revision, workflow_steps, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) RETURNING *`,
      [f.sequence_id, f.batch_id, f.purification, f.format, f.scale_code ?? null, f.mfg_date ?? null, f.notes ?? null, wf?.id ?? null, wf?.revision ?? null, wf ? JSON.stringify(wf.steps) : null, actor.userId]
    )
  ).rows[0];
}

/** SYNTHESIZED → POST_PROCESSING: opens the post-processing record with the ordered purification and format. */
export async function startPostProcess(tx: Tx, actor: AuthzActor, seqId: string) {
  const s = await lockSequence(tx, seqId);
  await move(tx, actor, s, "start_post");
  const batch = (
    await tx.query(
      `SELECT p.batch_id, b.started_at::date::text AS batch_mfg_date
         FROM oligo.synthesis_position p
         LEFT JOIN oligo.synthesis_batch b ON b.id = p.batch_id
        WHERE p.sequence_id = $1 AND p.result = 'OK'
        ORDER BY p.batch_id DESC LIMIT 1`,
      [seqId]
    )
  ).rows[0];
  const rec = await openRecord(tx, actor, {
    sequence_id: seqId,
    batch_id: batch?.batch_id ?? null,
    purification: s.purification,
    format: s.format,
    scale_code: s.scale_code,
    mfg_date: batch?.batch_mfg_date ?? new Date().toISOString().slice(0, 10),
  });
  await writeAudit(tx, actor, { entityType: "oligo_post_process", entityId: rec.id, action: "create", changes: { sequence: [null, s.code] } });
  return rec;
}

const tubeDetailSchema = z.object({
  tube_no: z.coerce.number().int().positive(),
  label: z.string().trim().max(100).optional(),
  od: z.coerce.number().min(0),
  nmol: z.coerce.number().min(0),
  ug: z.coerce.number().min(0),
  vol_100um_ul: z.coerce.number().min(0),
});

const saveSchema = z.object({
  version: z.number().int().min(0),
  cleavage_done: z.boolean().optional(),
  deprotection_done: z.boolean().optional(),
  purification_done: z.boolean().optional(),
  a260: z.coerce.number().min(0).max(1000).nullable().optional(),
  dilution_factor: z.coerce.number().min(1).max(100000).optional(),
  path_cm: z.coerce.number().positive().max(10).optional(),
  stock_volume_ul: z.coerce.number().positive().max(1_000_000).nullable().optional(),
  target_conc_um: z.coerce.number().positive().max(100000).nullable().optional(),
  tube_count: z.coerce.number().int().min(1).max(100).optional(),
  synthesis_scale_code: z.string().trim().max(30).nullable().optional(),
  mfg_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  tubes_detail: z.array(tubeDetailSchema).max(100).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
const EDITABLE = ["cleavage_done", "deprotection_done", "purification_done", "a260", "dilution_factor", "path_cm", "stock_volume_ul", "target_conc_um", "tube_count", "synthesis_scale_code", "mfg_date", "notes"] as const;
const DERIVED = ["od_total", "nmol", "ug", "resuspend_volume_ul", "od_per_tube", "tubes_detail"] as const;

/** Saves steps and measurements while the sequence is in post-processing; OD, nmol, µg and volumes are always computed here. */
export async function savePostProcess(tx: Tx, actor: AuthzActor, seqId: string, input: unknown) {
  const data = parseInput(saveSchema, input);
  const s = await lockSequence(tx, seqId);
  await authorize(tx, actor, "oligo.post.manage", s.org_unit_id);
  const cur = await liveRecord(tx, seqId, true);
  if (!cur || s.status !== "POST_PROCESSING" || cur.status !== "OPEN") throw invalid("Chỉ sửa hậu tổng hợp khi trình tự đang ở bước hậu tổng hợp (chưa gửi QC).");
  if (cur.version !== data.version) throw conflict("Hồ sơ hậu tổng hợp vừa được người khác sửa. Tải lại rồi nhập lại.", "STALE_VERSION");
  const next: Record<string, any> = {};
  for (const k of EDITABLE) next[k] = data[k] === undefined ? cur[k] : data[k];
  if (!next.synthesis_scale_code) next.synthesis_scale_code = s.scale_code;
  // with an SOP the steps are confirmed one by one (logStep), not ticked here
  if (cur.workflow_steps) for (const k of ["cleavage_done", "deprotection_done", "purification_done"] as const) next[k] = cur[k];
  for (const k of ["a260", "dilution_factor", "path_cm", "stock_volume_ul", "target_conc_um"]) if (next[k] != null) next[k] = Number(next[k]);
  if (cur.format === "LYOPHILIZED") next.target_conc_um = null;
  const measured = next.a260 != null && next.stock_volume_ul != null;
  const q = measured
    ? quantify({ nmol_per_od: Number(s.nmol_per_od), ug_per_od: Number(s.ug_per_od) }, { ...next, target_conc_um: next.target_conc_um } as any)
    : { od_total: null, nmol: null, ug: null, resuspend_volume_ul: null, od_per_tube: null };
  Object.assign(next, q);

  const tc = Math.max(Number(next.tube_count || 1), 1);
  if (data.tubes_detail && data.tubes_detail.length === tc) {
    next.tubes_detail = JSON.stringify(
      data.tubes_detail.map((t, idx) => ({
        tube_no: idx + 1,
        label: t.label || `Ống ${idx + 1}/${tc}`,
        od: pyRound(t.od, 3),
        nmol: pyRound(t.od * Number(s.nmol_per_od), 2),
        ug: pyRound(t.od * Number(s.ug_per_od), 2),
        vol_100um_ul: pyRound(t.od * Number(s.nmol_per_od) * 10, 1),
      }))
    );
  } else if (measured && q.od_total != null) {
    const perOd = pyRound(q.od_total / tc, 3);
    const perNmol = pyRound(perOd * Number(s.nmol_per_od), 2);
    const perUg = pyRound(perOd * Number(s.ug_per_od), 2);
    next.tubes_detail = JSON.stringify(
      Array.from({ length: tc }, (_, idx) => ({
        tube_no: idx + 1,
        label: `Ống ${idx + 1}/${tc}`,
        od: perOd,
        nmol: perNmol,
        ug: perUg,
        vol_100um_ul: pyRound(perNmol * 10, 1),
      }))
    );
  } else {
    next.tubes_detail = JSON.stringify(cur.tubes_detail ?? []);
  }

  const cols = [...EDITABLE, ...DERIVED];
  await tx.query(
    `UPDATE oligo.post_process SET ${cols.map((c, i) => (c === "tubes_detail" ? `${c} = $${i + 2}::jsonb` : `${c} = $${i + 2}`)).join(", ")}, version = version + 1, updated_at = now(), updated_by = $${cols.length + 2} WHERE id = $1`,
    [cur.id, ...cols.map((c) => next[c]), actor.userId]
  );
  const changes: Record<string, [unknown, unknown]> = {};
  for (const c of cols) {
    const before = cur[c] == null ? null : typeof next[c] === "number" ? Number(cur[c]) : cur[c];
    if (before !== next[c]) changes[c] = [before, next[c]];
  }
  if (Object.keys(changes).length) await writeAudit(tx, actor, { entityType: "oligo_post_process", entityId: cur.id, action: "update", changes });
  return liveRecord(tx, seqId);
}

async function oligoSpec(tx: Tx) {
  return (await tx.query("SELECT id FROM qms.qc_spec WHERE status = 'EFFECTIVE' AND applies_to = 'OLIGO' LIMIT 1")).rows[0] as { id: string } | undefined;
}

/** POST_PROCESSING → QC: every step done and measured, then a final QC test against the effective Oligo spec goes to QA/QC. */
export async function sendToQc(tx: Tx, actor: AuthzActor, seqId: string) {
  const s = await lockSequence(tx, seqId);
  const rec = await liveRecord(tx, seqId, true);
  if (!rec || rec.status !== "OPEN") throw invalid("Trình tự chưa có hồ sơ hậu tổng hợp đang mở.");
  const sop: { name: string }[] | null = rec.workflow_steps;
  const logged = Number((await tx.query("SELECT count(*) FROM oligo.ps_step_log WHERE post_process_id = $1", [rec.id])).rows[0].count);
  const missing = [
    sop && logged < sop.length && `các bước SOP (${sop.slice(logged).map((x) => x.name).join(", ")})`,
    !sop && !rec.cleavage_done && "cắt khỏi cột",
    !sop && !rec.deprotection_done && "khử bảo vệ",
    !sop && !rec.purification_done && `tinh sạch ${rec.purification}`,
    !(Number(rec.od_total) > 0) && "đo OD260",
    rec.format === "LIQUID" && rec.resuspend_volume_ul == null && "nồng độ hoàn nguyên",
  ].filter(Boolean);
  if (missing.length) throw invalid(`Chưa hoàn tất: ${missing.join(", ")}.`, undefined, "POST_INCOMPLETE");
  const spec = await oligoSpec(tx);
  if (!spec) throw invalid("Chưa có tiêu chuẩn QC Oligo hiệu lực. QA cần phê duyệt tiêu chuẩn (áp dụng: Oligo) trước.", undefined, "NO_SPEC");
  await move(tx, actor, s, "send_qc");
  await tx.query("UPDATE oligo.post_process SET status = 'SUBMITTED', submitted_at = now(), submitted_by = $2, version = version + 1, updated_at = now() WHERE id = $1", [rec.id, actor.userId]);
  await writeAudit(tx, actor, { entityType: "oligo_post_process", entityId: rec.id, action: "submit", changes: { status: ["OPEN", "SUBMITTED"] } });
  return createQcTest(tx, actor, { entity_type: "OLIGO_SEQUENCE", entity_id: seqId, spec_id: spec.id, test_kind: "FQC" });
}

const QUEUE_STATUSES = ["SYNTHESIZED", "POST_PROCESSING", "QC"];

/** Sequences between synthesis and completion with their post-processing record and latest QC test. */
export async function listPostQueue(tx: Tx, actor: AuthzActor, status?: string) {
  const units = await visibleOligoUnits(tx, actor);
  if (units !== "ALL" && !units.length) return [];
  const statuses = status ? [status] : QUEUE_STATUSES;
  return (
    await tx.query(
      `SELECT s.id, s.code, s.name, s.status, s.version, s.scale_code, s.purification, s.format, s.base_count, s.mw::float AS mw, o.code AS order_code, o.due_date,
              pp.od_total::float AS od_total, pp.nmol::float AS nmol, pp.status AS post_status,
              qt.code AS qc_code, qt.status AS qc_status, qt.overall_result AS qc_result
         FROM oligo.oligo_sequence s LEFT JOIN oligo.oligo_order o ON o.id = s.order_id
         LEFT JOIN oligo.post_process pp ON pp.sequence_id = s.id AND pp.status <> 'VOID'
         LEFT JOIN LATERAL (SELECT code, status, overall_result FROM qms.qc_test WHERE entity_type = 'OLIGO_SEQUENCE' AND entity_id = s.id ORDER BY created_at DESC LIMIT 1) qt ON true
        WHERE s.status = ANY($1::text[]) AND ($2::uuid[] IS NULL OR s.org_unit_id = ANY($2::uuid[]))
        ORDER BY o.due_date NULLS LAST, s.code LIMIT 500`,
      [statuses, units === "ALL" ? null : units]
    )
  ).rows;
}

export async function getPostProcess(tx: Tx, actor: AuthzActor, seqId: string) {
  const s = (await tx.query("SELECT s.*, o.code AS order_code FROM oligo.oligo_sequence s LEFT JOIN oligo.oligo_order o ON o.id = s.order_id WHERE s.id = $1", [seqId])).rows[0];
  const units = s ? await visibleOligoUnits(tx, actor) : [];
  if (!s || (units !== "ALL" && !units.includes(s.org_unit_id))) throw notFound("trình tự");
  const record = (await tx.query("SELECT * FROM oligo.post_process WHERE sequence_id = $1 AND status <> 'VOID'", [seqId])).rows[0] ?? null;
  const qc_tests = (
    await tx.query("SELECT id, code, status, overall_result, created_at, reviewed_at FROM qms.qc_test WHERE entity_type = 'OLIGO_SEQUENCE' AND entity_id = $1 ORDER BY created_at", [seqId])
  ).rows;
  const steps = record?.workflow_steps ? await stepLogs(tx, record.id) : [];
  return { sequence: s, record, steps, qc_tests };
}

// ---- QA/QC hooks: what the Oligo department hands to the QC test of a sequence ----

registerQcSubject("OLIGO_SEQUENCE", {
  label: async (tx, id) => {
    const s = (await tx.query("SELECT code, name FROM oligo.oligo_sequence WHERE id = $1", [id])).rows[0];
    return s ? `trình tự ${s.code} (${s.name})` : `trình tự ${id}`;
  },
  // a parameter limited to some purifications (e.g. HPLC purity) applies only to sequences ordered that way
  applicable: async (tx, id, params) => {
    const pur = (await tx.query("SELECT purification FROM oligo.oligo_sequence WHERE id = $1", [id])).rows[0]?.purification;
    return params.filter((p) => !p.oligo_purifications?.length || p.oligo_purifications.includes(pur));
  },
  derive: async (tx, id, param, entered) => {
    if (param.derived_metric === "MW_DELTA_DA") {
      if (entered == null || !Number.isFinite(entered) || entered <= 0) throw invalid(`Chỉ tiêu "${param.name}": nhập khối lượng phân tử đo được (Da).`);
      const mw = Number((await tx.query("SELECT mw FROM oligo.oligo_sequence WHERE id = $1", [id])).rows[0].mw);
      return { value: pyRound(entered - mw, 2), observed: entered };
    }
    const rec = (await tx.query("SELECT od_total, nmol, ug FROM oligo.post_process WHERE sequence_id = $1 AND status = 'SUBMITTED'", [id])).rows[0];
    if (!rec) throw invalid("Trình tự chưa có kết quả đo của hậu tổng hợp.");
    const col = { OD_TOTAL: "od_total", YIELD_NMOL: "nmol", YIELD_UG: "ug" }[param.derived_metric as string];
    if (!col) throw invalid(`Chỉ tiêu "${param.name}": cách tính không hỗ trợ.`);
    return { value: Number(rec[col]), observed: null };
  },
  reference: async (tx, id) =>
    (
      await tx.query(
        `SELECT s.code, s.name, s.normalized_sequence, s.base_count, s.scale_code, s.purification, s.format, s.mw::float AS mw, s.ext_coeff_260::float AS ext_coeff_260,
                s.nmol_per_od::float AS nmol_per_od, sc.od_min::float AS scale_od_min, sc.synth_nmol::float AS scale_nmol,
                pp.od_total::float AS od_total, pp.nmol::float AS nmol, pp.ug::float AS ug, pp.resuspend_volume_ul::float AS resuspend_volume_ul, pp.tube_count
           FROM oligo.oligo_sequence s JOIN oligo.scale sc ON sc.code = s.scale_code
           LEFT JOIN oligo.post_process pp ON pp.sequence_id = s.id AND pp.status <> 'VOID' WHERE s.id = $1`,
        [id]
      )
    ).rows[0] ?? {},
  // the reviewed result moves the sequence; a failure has already opened the deviation / NCR in QMS
  onReviewed: async (tx, actor, test) => {
    const s = await lockSequence(tx, test.entity_id);
    if (s.status !== "QC") return; // e.g. a retest after the sequence already failed: the NCR decides what happens next
    if (test.overall_result === "PASS") await move(tx, actor, s, "qc_passed", undefined, true);
    else await move(tx, actor, s, "qc_failed", `QC không đạt (phiếu ${test.code}).`, true);
  },
  // a cancelled test sends the sequence back to post-processing to be re-submitted
  onCancelled: async (tx, actor, test, reason) => {
    const s = await lockSequence(tx, test.entity_id);
    if (s.status !== "QC") return;
    await move(tx, actor, s, "qc_cancelled", reason, true);
    const rec = await liveRecord(tx, s.id, true);
    if (rec?.status === "SUBMITTED") {
      await tx.query("UPDATE oligo.post_process SET status = 'OPEN', version = version + 1, updated_at = now() WHERE id = $1", [rec.id]);
      await writeAudit(tx, actor, { entityType: "oligo_post_process", entityId: rec.id, action: "reopen", changes: { status: ["SUBMITTED", "OPEN"] }, reason });
    }
  },
});

const batchPostSchema = z.object({
  action: z.enum(["batch_start", "batch_measure", "batch_submit_qc"]),
  sequence_ids: z.array(z.string().uuid()).min(1, "chọn ít nhất 1 trình tự").max(200),
  a260: z.coerce.number().positive().max(1000).optional(),
  dilution_factor: z.coerce.number().min(1).max(100000).optional().default(10),
  path_cm: z.coerce.number().positive().max(10).optional().default(1),
  stock_volume_ul: z.coerce.number().positive().max(1_000_000).optional().default(200),
  target_conc_um: z.coerce.number().positive().max(100000).optional().nullable().default(100),
  tube_count: z.coerce.number().int().min(1).max(100).optional().default(1),
  auto_submit_qc: z.boolean().optional().default(false),
});

async function ensureSopStepsCompletedForBatch(tx: Tx, actor: AuthzActor, rec: any) {
  const sop: { step_no: number; method_id: string; name: string }[] | null = rec.workflow_steps;
  if (!Array.isArray(sop) || !sop.length) {
    await tx.query(
      "UPDATE oligo.post_process SET cleavage_done = true, deprotection_done = true, purification_done = true WHERE id = $1",
      [rec.id]
    );
    return;
  }
  const existing = (await tx.query("SELECT step_no FROM oligo.ps_step_log WHERE post_process_id = $1", [rec.id])).rows.map(
    (r) => Number(r.step_no)
  );
  for (let i = 0; i < sop.length; i++) {
    const stepNo = sop[i].step_no ?? i + 1;
    if (existing.includes(stepNo)) continue;
    await tx.query(
      `INSERT INTO oligo.ps_step_log (post_process_id, step_no, method_id, step_name, values, performed_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [rec.id, stepNo, sop[i].method_id, sop[i].name, JSON.stringify({ batch_logged: true }), actor.userId]
    );
  }
  await tx.query(
    "UPDATE oligo.post_process SET cleavage_done = true, deprotection_done = true, purification_done = true WHERE id = $1",
    [rec.id]
  );
}

/**
 * Batch post-processing actions across a plate / order of Oligo sequences:
 * - `batch_start`: transitions selected `SYNTHESIZED` sequences to `POST_PROCESSING`
 * - `batch_measure`: records cleavage, deprotection, purification, and OD260 quantification across selected sequences (and optionally submits to QC)
 * - `batch_submit_qc`: submits all selected `POST_PROCESSING` sequences that have OD260 > 0 to QA/QC
 */
export async function batchPostProcessAction(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(batchPostSchema, input);
  const ids = [...new Set(d.sequence_ids)];
  const processed: string[] = [];

  if (d.action === "batch_start") {
    for (const seqId of ids) {
      const s = await lockSequence(tx, seqId);
      if (s.status === "SYNTHESIZED") {
        await startPostProcess(tx, actor, seqId);
        processed.push(s.code);
      }
    }
    return { action: d.action, count: processed.length, codes: processed };
  }

  if (d.action === "batch_measure") {
    if (d.a260 == null || !Number.isFinite(d.a260) || d.a260 <= 0) {
      throw invalid("Bắt buộc nhập giá trị A260 đo được (> 0) từ máy quang phổ trước khi ghi kết quả đo OD hàng loạt.", undefined, "A260_REQUIRED");
    }
    const a260 = d.a260;
    for (const seqId of ids) {
      let s = await lockSequence(tx, seqId);
      if (s.status === "SYNTHESIZED") {
        await startPostProcess(tx, actor, seqId);
        s = await lockSequence(tx, seqId);
      }
      if (s.status !== "POST_PROCESSING") continue;
      let rec = await liveRecord(tx, seqId, true);
      if (!rec || rec.status !== "OPEN") continue;

      await savePostProcess(tx, actor, seqId, {
        version: rec.version,
        cleavage_done: true,
        deprotection_done: true,
        purification_done: true,
        a260,
        dilution_factor: d.dilution_factor,
        path_cm: d.path_cm,
        stock_volume_ul: d.stock_volume_ul,
        target_conc_um: rec.format === "LIQUID" ? (d.target_conc_um ?? 100) : null,
        tube_count: d.tube_count,
      });

      rec = await liveRecord(tx, seqId, true);
      await ensureSopStepsCompletedForBatch(tx, actor, rec);

      if (d.auto_submit_qc) {
        await sendToQc(tx, actor, seqId);
      }
      processed.push(s.code);
    }
    return { action: d.action, count: processed.length, codes: processed };
  }

  if (d.action === "batch_submit_qc") {
    for (const seqId of ids) {
      const s = await lockSequence(tx, seqId);
      if (s.status !== "POST_PROCESSING") continue;
      const rec = await liveRecord(tx, seqId, true);
      if (!rec || rec.status !== "OPEN" || !(Number(rec.od_total) > 0)) continue;
      await ensureSopStepsCompletedForBatch(tx, actor, rec);
      await sendToQc(tx, actor, seqId);
      processed.push(s.code);
    }
    return { action: d.action, count: processed.length, codes: processed };
  }

  throw invalid("Hành động xử lý hàng loạt không hợp lệ.");
}


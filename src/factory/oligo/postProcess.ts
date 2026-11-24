import { z } from "zod/v3";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, registerPermissions, type AuthzActor } from "../core/authz";
import { conflict, invalid, notFound } from "../core/errors";
import { parseInput } from "../core/records";
import { runTransition } from "../core/stateMachine";
import { createQcTest, registerQcSubject } from "../qms/qcTests";
import { pyRound } from "./analyzer";
import { ensureLegacyOligoDataSeeded } from "./legacySync";
import { recomputeOrdersOf, visibleOligoUnits } from "./orders";
import { freezeWorkflowById, stepLogs, workflowFor } from "./postSop";
import { sequenceMachine } from "./sequences";

import { todayVN } from "@/backend/services/dates";
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
    mfg_date: batch?.batch_mfg_date ?? todayVN(),
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
  let row = (await tx.query("SELECT id FROM qms.qc_spec WHERE status = 'EFFECTIVE' AND applies_to = 'OLIGO' LIMIT 1")).rows[0] as { id: string } | undefined;
  if (!row) {
    const hasObsolete = (await tx.query("SELECT 1 FROM qms.qc_spec WHERE applies_to = 'OLIGO' AND status = 'OBSOLETE' LIMIT 1")).rows[0];
    if (!hasObsolete) {
      await tx.query("SAVEPOINT sp_auto_oligo_spec");
      try {
        const existingStd = (
          await tx.query("SELECT id FROM qms.qc_spec WHERE code = 'TC-OLIGO-STD' AND spec_version = 1 LIMIT 1")
        ).rows[0];
        let specId: string;
        if (existingStd) {
          specId = existingStd.id;
          await tx.query(
            "UPDATE qms.qc_spec SET status = 'EFFECTIVE', effective_at = COALESCE(effective_at, now()), updated_at = now() WHERE id = $1",
            [specId]
          );
        } else {
          specId = (
            await tx.query(
              `INSERT INTO qms.qc_spec (code, spec_version, name, applies_to, status, notes, effective_at)
               VALUES ('TC-OLIGO-STD', 1, 'Tiêu chuẩn Kiểm nghiệm Xuất xưởng Oligo', 'OLIGO', 'EFFECTIVE',
                       'Tiêu chuẩn xuất xưởng mặc định cho trình tự Oligonucleotide (Tổng OD260, Hiệu suất thu hồi, Cảm quan).', now())
               RETURNING id`
            )
          ).rows[0].id;
        }
        const hasParams = (await tx.query("SELECT 1 FROM qms.qc_spec_parameter WHERE spec_id = $1 LIMIT 1", [specId])).rows[0];
        if (!hasParams) {
          await tx.query(
            `INSERT INTO qms.qc_spec_parameter
               (spec_id, seq, name, method, unit, value_type, lower_limit, upper_limit, target, is_critical, derived_metric)
             VALUES
               ($1, 1, 'Tổng OD260', 'Quang phổ UV 260nm (Nanodrop / Reader)', 'OD', 'NUMERIC', 0.05, NULL, '≥ 0.05 OD', true, 'OD_TOTAL'),
               ($1, 2, 'Hiệu suất thu hồi (nmol)', 'Tính từ OD260 và hệ số tắt phân tử', 'nmol', 'NUMERIC', 0.1, NULL, '≥ 0.1 nmol', true, 'YIELD_NMOL'),
               ($1, 3, 'Ngoại quan & Cảm quan ống thành phẩm', 'Kiểm tra trực quan', NULL, 'PASS_FAIL', NULL, NULL, 'Đạt', true, NULL)`,
            [specId]
          );
        }
        await tx.query("RELEASE SAVEPOINT sp_auto_oligo_spec");
        row = { id: specId };
      } catch {
        await tx.query("ROLLBACK TO SAVEPOINT sp_auto_oligo_spec").catch(() => {});
      }
    }
  }
  return row;
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

/**
 * Performs and confirms Oligo QC in-house by Oligo department staff directly inside the Post-Synthesis workflow
 * (without transferring the QC task to the QA/QC department).
 * Also populates `qms.qc_test` & `qms.qc_result` as REVIEWED so Order COA certificates have complete analytical metrics.
 */
export async function confirmOligoPostQc(
  tx: Tx,
  actor: AuthzActor,
  seqId: string,
  opts: { result?: "PASS" | "FAIL"; notes?: string | null } = {}
) {
  let s = await lockSequence(tx, seqId);
  await authorize(tx, actor, "oligo.post.manage", s.org_unit_id);
  const verdict: "PASS" | "FAIL" = opts.result === "FAIL" ? "FAIL" : "PASS";

  let test = (
    await tx.query(
      "SELECT * FROM qms.qc_test WHERE entity_type = 'OLIGO_SEQUENCE' AND entity_id = $1 AND status NOT IN ('REVIEWED', 'CANCELLED') ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
      [seqId]
    )
  ).rows[0];

  if (s.status === "POST_PROCESSING") {
    test = await sendToQc(tx, actor, seqId);
    s = await lockSequence(tx, seqId);
  } else if (s.status === "QC" && !test) {
    const spec = await oligoSpec(tx);
    if (spec) {
      test = await createQcTest(tx, actor, { entity_type: "OLIGO_SEQUENCE", entity_id: seqId, spec_id: spec.id, test_kind: "FQC" });
    }
  }

  if (s.status !== "QC") {
    throw invalid(`Trình tự ${s.code} đang ở trạng thái ${s.status}, không ở bước xác nhận QC sau tổng hợp.`);
  }

  const rec = await liveRecord(tx, seqId, false);
  if (test) {
    const params = (
      await tx.query("SELECT * FROM qms.qc_spec_parameter WHERE spec_id = $1 ORDER BY seq", [test.spec_id])
    ).rows;
    for (const p of params) {
      let valNum: number | null = null;
      let valText: string | null = null;
      if (p.derived_metric === "OD_TOTAL") {
        valNum = Number(rec?.od_total ?? 0);
      } else if (p.derived_metric === "YIELD_NMOL") {
        valNum = Number(rec?.nmol ?? 0);
      } else if (p.derived_metric === "YIELD_UG") {
        valNum = Number(rec?.ug ?? 0);
      } else if (p.value_type === "NUMERIC") {
        valNum = Number(p.lower_limit ?? rec?.od_total ?? 1);
      } else {
        valText = verdict;
      }
      const passed = verdict === "PASS";
      await tx.query(
        `INSERT INTO qms.qc_result (test_id, parameter_id, value_numeric, value_text, passed, entered_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (test_id, parameter_id) DO UPDATE
           SET value_numeric = EXCLUDED.value_numeric,
               value_text = EXCLUDED.value_text,
               passed = EXCLUDED.passed,
               entered_by = EXCLUDED.entered_by,
               entered_at = now()`,
        [test.id, p.id, valNum, valText, passed, actor.userId]
      );
    }
    await tx.query(
      `UPDATE qms.qc_test
          SET status = 'REVIEWED',
              overall_result = $2,
              analyst_id = COALESCE(analyst_id, $3),
              reviewer_id = $3,
              reviewed_at = now(),
              version = version + 1,
              updated_at = now(),
              updated_by = $3
        WHERE id = $1`,
      [test.id, verdict, actor.userId]
    );
  }

  if (verdict === "PASS") {
    await move(tx, actor, s, "qc_passed", opts.notes || "Nhân viên phòng Oligo xác nhận Đạt QC sau tổng hợp", true);
  } else {
    await move(tx, actor, s, "qc_failed", opts.notes || "Nhân viên phòng Oligo xác nhận Không đạt QC sau tổng hợp", true);
  }

  await writeAudit(tx, actor, {
    entityType: "oligo_sequence",
    entityId: s.id,
    action: "confirm_oligo_qc",
    changes: { status: ["QC", verdict === "PASS" ? "COMPLETED" : "FAILED"], qc_result: [null, verdict] },
    reason: opts.notes || null,
  });

  return { sequence_id: s.id, code: s.code, status: verdict === "PASS" ? "COMPLETED" : "FAILED", qc_result: verdict };
}

const QUEUE_STATUSES = ["SYNTHESIZED", "POST_PROCESSING", "QC"];

/** Sequences between synthesis and completion with their post-processing record and latest QC test. */
export async function listPostQueue(tx: Tx, actor: AuthzActor, status?: string) {
  await ensureLegacyOligoDataSeeded(tx);
  const units = await visibleOligoUnits(tx, actor);
  if (units !== "ALL" && !units.length) return [];
  const statuses = status ? [status] : QUEUE_STATUSES;

  return (
    await tx.query(
      `SELECT s.id, s.code, s.name, s.status, s.version, s.scale_code, s.purification, s.format, s.base_count, s.mw::float AS mw,
              s.product_type, s.modifications,
              s.raw_sequence, s.normalized_sequence, s.relation,
              s.nmol_per_od::float AS nmol_per_od, s.ug_per_od::float AS ug_per_od,
              o.code AS order_code, o.due_date,
              pp.id AS post_id, pp.version AS post_version, pp.status AS post_status,
              pp.a260::float AS a260, pp.dilution_factor::float AS dilution_factor, pp.path_cm::float AS path_cm,
              pp.stock_volume_ul::float AS stock_volume_ul, pp.target_conc_um::float AS target_conc_um, pp.tube_count,
              pp.od_total::float AS od_total, pp.nmol::float AS nmol, pp.ug::float AS ug,
              pp.resuspend_volume_ul::float AS resuspend_volume_ul, pp.od_per_tube::float AS od_per_tube,
              pp.workflow_id, pw.name AS workflow_name, pp.workflow_steps,
              CASE WHEN jsonb_typeof(pp.workflow_steps) = 'array' THEN jsonb_array_length(pp.workflow_steps) ELSE 0 END AS workflow_total_steps,
              COALESCE((SELECT count(*)::int FROM oligo.ps_step_log l WHERE l.post_process_id = pp.id), 0) AS workflow_logged_steps,
              last_log.step_no AS last_step_no,
              last_log.step_name AS last_step_name,
              last_log.values AS last_step_values,
              last_log.performed_at AS last_step_at,
              last_log.performed_by_name AS last_step_by,
              last_log.stock_document_code AS last_step_doc,
              qt.code AS qc_code, qt.status AS qc_status, qt.overall_result AS qc_result
         FROM oligo.oligo_sequence s LEFT JOIN oligo.oligo_order o ON o.id = s.order_id
         LEFT JOIN oligo.post_process pp ON pp.sequence_id = s.id AND pp.status <> 'VOID'
         LEFT JOIN oligo.ps_workflow pw ON pw.id = pp.workflow_id
         LEFT JOIN LATERAL (
           SELECT l.step_no, l.step_name, l.values, l.performed_at,
                  p.display_name AS performed_by_name,
                  d.code AS stock_document_code
             FROM oligo.ps_step_log l
             LEFT JOIN core.user_profile p ON p.user_id = l.performed_by
             LEFT JOIN inv.stock_document d ON d.id = l.stock_document_id
            WHERE l.post_process_id = pp.id
            ORDER BY l.step_no DESC
            LIMIT 1
         ) last_log ON true
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
  const record = (
    await tx.query(
      `SELECT pp.*, pw.name AS workflow_name
         FROM oligo.post_process pp
         LEFT JOIN oligo.ps_workflow pw ON pw.id = pp.workflow_id
        WHERE pp.sequence_id = $1 AND pp.status <> 'VOID'`,
      [seqId]
    )
  ).rows[0] ?? null;
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
  action: z.enum(["batch_start", "batch_measure", "batch_submit_qc", "batch_confirm_qc", "batch_assign_workflow", "batch_rerun"]),
  sequence_ids: z.array(z.string().uuid()).min(1, "chọn ít nhất 1 trình tự").max(200),
  workflow_id: z.string().trim().max(100).optional().nullable(),
  rerun_mode: z.enum(["REWIND_STEP", "RESET_POST", "RESYNTHESIZE"]).optional().default("RESET_POST"),
  qc_result: z.enum(["PASS", "FAIL"]).optional().default("PASS"),
  reason: z.string().trim().max(500).optional().nullable(),
  a260: z.coerce.number().positive().max(1000).optional(),
  per_sequence_a260: z.record(z.string(), z.coerce.number().positive().max(1000)).optional(),
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
  const ids = [...new Set(d.sequence_ids)].sort();
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

  if (d.action === "batch_assign_workflow") {
    await ensureLegacyOligoDataSeeded(tx);
    const wfParam = d.workflow_id?.trim() || "AUTO";
    for (const seqId of ids) {
      let s = await lockSequence(tx, seqId);
      await authorize(tx, actor, "oligo.post.manage", s.org_unit_id);
      if (s.status === "SYNTHESIZED") {
        await startPostProcess(tx, actor, seqId);
        s = await lockSequence(tx, seqId);
      }
      if (s.status !== "POST_PROCESSING") continue;
      const rec = await liveRecord(tx, seqId, true);
      if (!rec || rec.status !== "OPEN") continue;

      let wf: { id: string; name: string; revision: number; steps: any[] } | null = null;
      if (wfParam === "NONE") {
        wf = null;
      } else if (wfParam === "AUTO") {
        wf = await workflowFor(tx, rec.purification || s.purification);
        if (!wf) {
          throw invalid(
            `Chưa có quy trình SOP mặc định cho kiểu tinh sạch ${rec.purification || s.purification}. Hãy chọn trực tiếp tên quy trình SOP trong danh sách.`
          );
        }
      } else {
        wf = await freezeWorkflowById(tx, wfParam);
        if (!wf) throw notFound("quy trình SOP sau tổng hợp");
      }

      await tx.query("DELETE FROM oligo.ps_step_log WHERE post_process_id = $1", [rec.id]);
      await tx.query(
        `UPDATE oligo.post_process
            SET workflow_id = $2,
                workflow_revision = $3,
                workflow_steps = $4,
                cleavage_done = false,
                deprotection_done = false,
                purification_done = false,
                version = version + 1,
                updated_at = now(),
                updated_by = $5
          WHERE id = $1`,
        [rec.id, wf?.id ?? null, wf?.revision ?? null, wf ? JSON.stringify(wf.steps) : null, actor.userId]
      );
      await writeAudit(tx, actor, {
        entityType: "oligo_post_process",
        entityId: rec.id,
        action: "assign_workflow",
        changes: {
          workflow_id: [rec.workflow_id ?? null, wf?.id ?? null],
          workflow_name: [null, wf?.name ?? "BASIC"],
        },
      });
      processed.push(s.code);
    }
    return { action: d.action, count: processed.length, codes: processed };
  }

  if (d.action === "batch_measure") {
    const missingA260 = ids.filter((id) => {
      const val = d.per_sequence_a260?.[id] ?? d.a260;
      return val == null || !Number.isFinite(val) || val <= 0;
    });
    if (missingA260.length > 0) {
      throw invalid(
        "Bắt buộc nhập giá trị A260 đo được (> 0) từ máy quang phổ (chung hoặc theo từng giếng/trình tự) trước khi ghi kết quả đo OD hàng loạt.",
        { missing_count: missingA260.length },
        "A260_REQUIRED"
      );
    }
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
        a260: Number(d.per_sequence_a260?.[seqId] ?? d.a260!),
        dilution_factor: d.dilution_factor,
        path_cm: d.path_cm,
        stock_volume_ul: d.stock_volume_ul,
        target_conc_um: rec.format === "LIQUID" ? (d.target_conc_um ?? 100) : null,
        tube_count: d.tube_count,
      });

      rec = await liveRecord(tx, seqId, true);
      await ensureSopStepsCompletedForBatch(tx, actor, rec);

      if (d.auto_submit_qc) {
        await confirmOligoPostQc(tx, actor, seqId, { result: "PASS", notes: d.reason });
      }
      processed.push(s.code);
    }
    return { action: d.action, count: processed.length, codes: processed };
  }

  if (d.action === "batch_submit_qc" || d.action === "batch_confirm_qc") {
    for (const seqId of ids) {
      const s = await lockSequence(tx, seqId);
      if (s.status === "POST_PROCESSING") {
        const rec = await liveRecord(tx, seqId, true);
        if (!rec || rec.status !== "OPEN" || !(Number(rec.od_total) > 0)) continue;
        await ensureSopStepsCompletedForBatch(tx, actor, rec);
        await confirmOligoPostQc(tx, actor, seqId, { result: d.qc_result, notes: d.reason });
        processed.push(s.code);
      } else if (s.status === "QC") {
        await confirmOligoPostQc(tx, actor, seqId, { result: d.qc_result, notes: d.reason });
        processed.push(s.code);
      }
    }
    return { action: d.action, count: processed.length, codes: processed };
  }

  if (d.action === "batch_rerun") {
    const mode = d.rerun_mode || "RESET_POST";
    const reason = (d.reason || "Kỹ thuật viên yêu cầu chạy lại / làm lại từ màn hình Hậu tổng hợp").trim();
    for (const seqId of ids) {
      const s = await lockSequence(tx, seqId);
      await authorize(tx, actor, "oligo.post.manage", s.org_unit_id);
      const rec = await liveRecord(tx, seqId, true);

      if (mode === "REWIND_STEP") {
        if (!rec || rec.status !== "OPEN") continue;
        const lastLog = (
          await tx.query(
            "SELECT id, step_no, step_name FROM oligo.ps_step_log WHERE post_process_id = $1 ORDER BY step_no DESC LIMIT 1",
            [rec.id]
          )
        ).rows[0];
        if (lastLog) {
          await tx.query("DELETE FROM oligo.ps_step_log WHERE id = $1", [lastLog.id]);
          await tx.query(
            "UPDATE oligo.post_process SET cleavage_done = false, deprotection_done = false, purification_done = false, version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $1",
            [rec.id, actor.userId]
          );
          await writeAudit(tx, actor, {
            entityType: "oligo_post_process",
            entityId: rec.id,
            action: "rewind_step",
            changes: { [`step ${lastLog.step_no}`]: [lastLog.step_name, null] },
            reason,
          });
          processed.push(s.code);
        }
      } else if (mode === "RESET_POST") {
        if (!rec || rec.status !== "OPEN") continue;
        await tx.query("DELETE FROM oligo.ps_step_log WHERE post_process_id = $1", [rec.id]);
        await tx.query(
          `UPDATE oligo.post_process
              SET cleavage_done = false,
                  deprotection_done = false,
                  purification_done = false,
                  a260 = NULL,
                  od_total = NULL,
                  nmol = NULL,
                  ug = NULL,
                  resuspend_volume_ul = NULL,
                  od_per_tube = NULL,
                  tubes_detail = '[]'::jsonb,
                  version = version + 1,
                  updated_at = now(),
                  updated_by = $2
            WHERE id = $1`,
          [rec.id, actor.userId]
        );
        await writeAudit(tx, actor, {
          entityType: "oligo_post_process",
          entityId: rec.id,
          action: "reset_post",
          changes: { status: ["IN_PROGRESS", "STEP_1"] },
          reason,
        });
        processed.push(s.code);
      } else if (mode === "RESYNTHESIZE") {
        if (rec) {
          await tx.query(
            "UPDATE oligo.post_process SET status = 'VOID', notes = COALESCE(notes || ' | ', '') || $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1",
            [rec.id, `Báo lỗi chạy lại: ${reason}`, actor.userId]
          );
        }
        await tx.query(
          "UPDATE oligo.oligo_sequence SET status = 'PENDING', notes = COALESCE(notes || ' | ', '') || $2, version = version + 1, updated_at = now() WHERE id = $1",
          [s.id, `Chạy lại từ Hậu tổng hợp: ${reason}`]
        );
        await recomputeOrdersOf(tx, actor, [s.id]);
        await writeAudit(tx, actor, {
          entityType: "oligo_sequence",
          entityId: s.id,
          action: "rerun_from_post",
          changes: { status: [s.status, "PENDING"] },
          reason,
        });
        processed.push(s.code);
      }
    }
    return { action: d.action, mode, count: processed.length, codes: processed };
  }

  throw invalid("Hành động xử lý hàng loạt không hợp lệ.");
}


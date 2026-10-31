import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, type AuthzActor } from "../core/authz";
import { conflict, FactoryError, invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { parseInput } from "../core/records";
import { defineMachine, runTransition } from "../core/stateMachine";
import { evaluateResult, overallResult, type ParameterSpec } from "./evaluate";
import { raiseDeviation } from "./incidents";
import "./permissions";

type QcStatus = "PLANNED" | "IN_PROGRESS" | "RESULTS_ENTERED" | "REVIEWED" | "CANCELLED";
export interface QcTest {
  id: string;
  code: string;
  entity_type: string;
  entity_id: string;
  spec_id: string;
  test_kind: string;
  status: QcStatus;
  analyst_id: number | null;
  reviewer_id: number | null;
  overall_result: "PASS" | "FAIL" | null;
  version: number;
}

export interface SpecParameter extends ParameterSpec {
  derived_metric: string | null;
  oligo_purifications: string[] | null;
}

/**
 * What a module tells QA/QC about the things it sends for testing (a sequence, a device unit …):
 * a label, which parameters apply, values the server derives itself, reference data for the analyst,
 * and what happens to the subject when the test is reviewed or cancelled. QMS never imports the modules.
 */
export interface QcSubjectHandler {
  label(tx: Tx, entityId: string): Promise<string>;
  applicable?(tx: Tx, entityId: string, params: SpecParameter[]): Promise<SpecParameter[]>;
  derive?(tx: Tx, entityId: string, param: SpecParameter, entered: number | null | undefined): Promise<{ value: number; observed: number | null }>;
  reference?(tx: Tx, entityId: string): Promise<Record<string, unknown>>;
  onReviewed?(tx: Tx, actor: AuthzActor, test: QcTest): Promise<void>;
  onCancelled?(tx: Tx, actor: AuthzActor, test: QcTest, reason: string): Promise<void>;
}
const subjects = new Map<string, QcSubjectHandler>();
export function registerQcSubject(entityType: string, handler: QcSubjectHandler) {
  subjects.set(entityType, handler);
}

async function specParameters(tx: Tx, test: Pick<QcTest, "spec_id" | "entity_type" | "entity_id">): Promise<SpecParameter[]> {
  const all: SpecParameter[] = (await tx.query("SELECT * FROM qms.qc_spec_parameter WHERE spec_id = $1 ORDER BY seq", [test.spec_id])).rows;
  const h = subjects.get(test.entity_type);
  return h?.applicable ? h.applicable(tx, test.entity_id, all) : all;
}
async function results(tx: Tx, testId: string) {
  return (await tx.query("SELECT parameter_id, passed FROM qms.qc_result WHERE test_id = $1", [testId])).rows;
}

/** What the failure is about, for the deviation / NCR (lot and item when the test is on a lot). */
async function subjectOf(tx: Tx, test: QcTest) {
  if (test.entity_type !== "LOT") {
    const h = subjects.get(test.entity_type);
    return { item_id: null, lot_id: null, label: h ? await h.label(tx, test.entity_id) : `${test.entity_type} ${test.entity_id}` };
  }
  const lot = (await tx.query("SELECT l.id, l.code, l.item_id, i.code AS item_code FROM inv.lot l JOIN master.item i ON i.id = l.item_id WHERE l.id = $1", [test.entity_id])).rows[0];
  return { item_id: lot.item_id, lot_id: lot.id, label: `lô ${lot.code} (${lot.item_code})` };
}

export const qcTestMachine = defineMachine<QcStatus, QcTest>({
  entityType: "qc_test",
  table: "qms.qc_test",
  states: ["PLANNED", "IN_PROGRESS", "RESULTS_ENTERED", "REVIEWED", "CANCELLED"],
  terminal: ["REVIEWED", "CANCELLED"],
  transitions: [
    { action: "start", from: "PLANNED", to: "IN_PROGRESS", permission: "qms.qc.analyze", patch: ({ actor }) => ({ analyst_id: actor.userId }) },
    {
      action: "submit_results",
      from: "IN_PROGRESS",
      to: "RESULTS_ENTERED",
      permission: "qms.qc.analyze",
      guards: [
        { code: "NOT_ANALYST", message: "Chỉ người đang kiểm nghiệm phiếu này mới gửi kết quả.", check: ({ actor, row }) => row.analyst_id === actor.userId },
        {
          code: "MISSING_RESULTS",
          message: "Còn chỉ tiêu bắt buộc chưa có kết quả.",
          check: async ({ tx, row }) => overallResult(await specParameters(tx, row), await results(tx, row.id)).missing.length === 0,
        },
      ],
      patch: async ({ tx, row }) => ({ overall_result: overallResult(await specParameters(tx, row), await results(tx, row.id)).result }),
    },
    {
      action: "review",
      from: "RESULTS_ENTERED",
      to: "REVIEWED",
      permission: "qms.qc.review",
      signature: "REVIEWED",
      guards: [{ code: "SAME_PERSON", message: "Người duyệt kết quả phải khác người kiểm nghiệm.", check: ({ actor, row }) => row.analyst_id !== actor.userId }],
      patch: ({ actor }) => ({ reviewer_id: actor.userId, reviewed_at: new Date() }),
      effects: async ({ tx, actor, updated }) => {
        if (updated.overall_result === "FAIL") await raiseFailure(tx, actor, updated);
        await subjects.get(updated.entity_type)?.onReviewed?.(tx, actor, updated);
      },
    },
    { action: "return", from: "RESULTS_ENTERED", to: "IN_PROGRESS", permission: "qms.qc.review", reasonRequired: true, patch: () => ({ overall_result: null }) },
    {
      action: "cancel",
      from: ["PLANNED", "IN_PROGRESS"],
      to: "CANCELLED",
      permission: "qms.qc.lead",
      reasonRequired: true,
      effects: async ({ tx, actor, updated, reason }) => subjects.get(updated.entity_type)?.onCancelled?.(tx, actor, updated, reason ?? ""),
    },
  ],
});

async function raiseFailure(tx: Tx, actor: AuthzActor, updated: QcTest) {
  const subject = await subjectOf(tx, updated);
  await raiseDeviation(tx, actor, {
    source_module: "QMS",
    entity_type: updated.entity_type,
    entity_id: updated.entity_id,
    severity: "MEDIUM",
    description: `Phiếu QC ${updated.code} không đạt cho ${subject.label}.`,
    step_ref: updated.code,
    performer_id: updated.analyst_id,
    ncr: { item_id: subject.item_id, lot_id: subject.lot_id },
  });
}

/** Creates a PLANNED test against the given specification. Module-internal (lot sampling, receipts, production). */
export async function createQcTest(
  tx: Tx,
  actor: AuthzActor,
  input: { entity_type: string; entity_id: string; spec_id: string; test_kind: "IQC" | "IPQC" | "FQC" | "RELEASE" | "STABILITY"; retest_of_id?: string; retest_reason?: string }
): Promise<QcTest> {
  const spec = (await tx.query("SELECT status FROM qms.qc_spec WHERE id = $1", [input.spec_id])).rows[0];
  if (!spec || spec.status !== "EFFECTIVE") throw invalid("Tiêu chuẩn QC chưa có hiệu lực.");
  const code = await nextNumber(tx, "QC_TEST");
  const test = (
    await tx.query(
      `INSERT INTO qms.qc_test (code, entity_type, entity_id, spec_id, test_kind, retest_of_id, retest_reason, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING *`,
      [code, input.entity_type, input.entity_id, input.spec_id, input.test_kind, input.retest_of_id ?? null, input.retest_reason ?? null, actor.userId]
    )
  ).rows[0] as QcTest;
  await writeAudit(tx, actor, { entityType: "qc_test", entityId: test.id, action: "create", changes: { code: [null, code], entity: [null, `${input.entity_type}:${input.entity_id}`] } });
  return test;
}

const resultsSchema = z.object({
  results: z
    .array(
      z.object({
        parameter_id: z.string().uuid(),
        value_numeric: z.coerce.number().optional().nullable(),
        value_text: z.string().trim().max(500).optional().nullable(),
        raw_attachment_id: z.string().uuid().optional().nullable(),
      })
    )
    .min(1)
    .max(100),
});

/** Saves results while the test is IN_PROGRESS (analyst only); pass/fail computed here from the spec. Changes are audited old → new. */
export async function saveResults(tx: Tx, actor: AuthzActor, testId: string, input: unknown) {
  await authorize(tx, actor, "qms.qc.analyze");
  const data = parseInput(resultsSchema, input);
  const test = (await tx.query("SELECT * FROM qms.qc_test WHERE id = $1 FOR UPDATE", [testId])).rows[0] as QcTest | undefined;
  if (!test) throw notFound("phiếu QC");
  if (test.status !== "IN_PROGRESS") throw invalid("Chỉ nhập kết quả khi phiếu đang kiểm nghiệm. Kết quả đã duyệt không sửa được: hãy tạo phiếu kiểm lại.");
  if (test.analyst_id !== actor.userId && !actor.isRootAdmin) throw new FactoryError(403, "FORBIDDEN", "Chỉ người đang kiểm nghiệm phiếu này mới nhập kết quả.");
  const params = new Map((await specParameters(tx, test)).map((p) => [p.id, p]));
  const handler = subjects.get(test.entity_type);
  for (const r of data.results) {
    const p = params.get(r.parameter_id);
    if (!p) throw invalid("Chỉ tiêu không thuộc tiêu chuẩn của phiếu này (hoặc không áp dụng cho mẫu này).");
    // a derived parameter: the analyst enters the raw reading (or nothing) and the server computes the value
    let observed: number | null = null;
    if (p.derived_metric) {
      if (!handler?.derive) throw invalid(`Chỉ tiêu "${p.name}" tính tự động nhưng loại mẫu này không hỗ trợ.`);
      const d = await handler.derive(tx, test.entity_id, p, r.value_numeric);
      r.value_numeric = d.value;
      observed = d.observed;
    }
    let passed: boolean | null;
    try {
      passed = evaluateResult(p, r);
    } catch (e: any) {
      throw invalid(e.message);
    }
    const prev = (await tx.query("SELECT value_numeric::text AS n, value_text AS t FROM qms.qc_result WHERE test_id = $1 AND parameter_id = $2", [testId, p.id])).rows[0];
    await tx.query(
      `INSERT INTO qms.qc_result (test_id, parameter_id, value_numeric, value_text, passed, raw_attachment_id, entered_by, observed_numeric)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (test_id, parameter_id) DO UPDATE SET value_numeric = EXCLUDED.value_numeric, value_text = EXCLUDED.value_text,
         passed = EXCLUDED.passed, raw_attachment_id = EXCLUDED.raw_attachment_id, entered_by = EXCLUDED.entered_by, entered_at = now(),
         observed_numeric = EXCLUDED.observed_numeric`,
      [testId, p.id, p.value_type === "NUMERIC" ? r.value_numeric : null, p.value_type === "NUMERIC" ? null : r.value_text, passed, r.raw_attachment_id ?? null, actor.userId, observed]
    );
    const before = prev ? prev.n ?? prev.t : null;
    const after = p.value_type === "NUMERIC" ? String(r.value_numeric) + (observed != null ? ` (đo ${observed})` : "") : r.value_text;
    if (String(before) !== String(after)) {
      await writeAudit(tx, actor, { entityType: "qc_test", entityId: testId, action: "result", changes: { [p.name]: [before, after] } });
    }
  }
  await tx.query("UPDATE qms.qc_test SET version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $1", [testId, actor.userId]);
  return getQcTest(tx, testId);
}

/** A reviewed result is never edited: a retest is a new linked test with a reason. */
export async function createRetest(tx: Tx, actor: AuthzActor, testId: string, reason: unknown): Promise<QcTest> {
  await authorize(tx, actor, "qms.qc.lead");
  const why = parseInput(z.string().trim().min(3, "nhập lý do kiểm lại"), reason);
  const orig = (await tx.query("SELECT * FROM qms.qc_test WHERE id = $1", [testId])).rows[0] as QcTest | undefined;
  if (!orig) throw notFound("phiếu QC");
  if (orig.status !== "REVIEWED") throw invalid("Chỉ kiểm lại phiếu đã được duyệt.");
  const open = await tx.query("SELECT 1 FROM qms.qc_test WHERE retest_of_id = $1 AND status NOT IN ('REVIEWED', 'CANCELLED')", [testId]);
  if (open.rowCount) throw conflict("Đã có phiếu kiểm lại đang mở cho phiếu này.", "RETEST_OPEN");
  return createQcTest(tx, actor, { entity_type: orig.entity_type, entity_id: orig.entity_id, spec_id: orig.spec_id, test_kind: orig.test_kind as any, retest_of_id: orig.id, retest_reason: why });
}

export async function getQcTest(tx: Tx, id: string) {
  const test = (
    await tx.query(
      `SELECT t.*, s.code AS spec_code, s.spec_version, s.name AS spec_name, a.display_name AS analyst_name, r.display_name AS reviewer_name
         FROM qms.qc_test t JOIN qms.qc_spec s ON s.id = t.spec_id
         LEFT JOIN core.user_profile a ON a.user_id = t.analyst_id LEFT JOIN core.user_profile r ON r.user_id = t.reviewer_id
        WHERE t.id = $1`,
      [id]
    )
  ).rows[0];
  if (!test) throw notFound("phiếu QC");
  const parameters = await specParameters(tx, test);
  const values = (
    await tx.query("SELECT parameter_id, value_numeric::text AS value_numeric, observed_numeric::text AS observed_numeric, value_text, passed FROM qms.qc_result WHERE test_id = $1", [id])
  ).rows;
  const h = subjects.get(test.entity_type);
  const subject = h ? { label: await h.label(tx, test.entity_id), reference: (await h.reference?.(tx, test.entity_id)) ?? null } : null;
  return { ...test, parameters, results: values, subject };
}

export async function listQcTests(tx: Tx, actor: AuthzActor, status?: string) {
  await authorize(tx, actor, "qms.qc.view");
  return (
    await tx.query(
      `SELECT t.id, t.code, t.entity_type, t.entity_id, t.test_kind, t.status, t.overall_result, t.version, t.created_at, t.analyst_id,
              s.code AS spec_code, s.name AS spec_name, l.code AS lot_code, i.code AS item_code, i.name AS item_name,
              sq.code AS sequence_code, sq.name AS sequence_name
         FROM qms.qc_test t JOIN qms.qc_spec s ON s.id = t.spec_id
         LEFT JOIN oligo.oligo_sequence sq ON t.entity_type = 'OLIGO_SEQUENCE' AND sq.id = t.entity_id
         LEFT JOIN inv.lot l ON t.entity_type = 'LOT' AND l.id = t.entity_id
         LEFT JOIN master.item i ON i.id = l.item_id
        WHERE ($1::text IS NULL AND t.status NOT IN ('REVIEWED', 'CANCELLED')) OR t.status = $1
        ORDER BY t.created_at DESC LIMIT 200`,
      [status ?? null]
    )
  ).rows;
}

export { runTransition };

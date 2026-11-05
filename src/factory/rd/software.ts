import { z } from "zod";
import type { Tx } from "../core/db";
import { authorize, authorizeAnywhere, hasFactoryPermission, type AuthzActor } from "../core/authz";
import { writeAudit } from "../core/audit";
import { invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { insertRecord, parseInput } from "../core/records";
import { defineMachine, listAllowedActions, type GuardContext } from "../core/stateMachine";
import "./permissions";

/**
 * Software development lifecycle run by KTCN (and R&D) on a SOFTWARE project:
 * requirements (SRS) → test cases → test runs per build → traceability matrix generated for a release (IEC 62304
 * §5.2, §5.7, §5.8); problem reports with fix and independent verification (§9); validation of in-house software
 * used for GMP work (GAMP 5: URS → IQ → OQ → PQ → approved for use).
 */

async function projectScope(tx: Tx, projectId: string): Promise<string> {
  const p = (await tx.query("SELECT owner_org_unit_id FROM rd.project WHERE id = $1", [projectId])).rows[0];
  if (!p) throw notFound("dự án phần mềm");
  return p.owner_org_unit_id;
}

// ---------------------------------------------------------------------------
// Requirements and test cases
// ---------------------------------------------------------------------------

const requirementSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  project_id: z.string().uuid("chọn dự án"),
  req_code: z.string().trim().regex(/^[A-Z][A-Z0-9_-]{1,29}$/, "mã yêu cầu viết hoa, ví dụ SRS-001"),
  title: z.string().trim().min(3, "nhập nội dung yêu cầu").max(300),
  description: z.string().trim().max(4000).optional().nullable(),
  kind: z.enum(["FUNCTIONAL", "PERFORMANCE", "SAFETY", "SECURITY", "USABILITY", "INTERFACE", "REGULATORY"]).default("FUNCTIONAL"),
  risk_item_id: z.string().uuid().optional().nullable(),
  status: z.enum(["ACTIVE", "OBSOLETE"]).default("ACTIVE"),
});

/** Adds or edits a software requirement (an obsolete requirement leaves the traceability matrix). */
export async function saveRequirement(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(requirementSchema, input);
  await authorize(tx, actor, "rd.project.manage", await projectScope(tx, d.project_id));
  const values = [d.project_id, d.req_code, d.title, d.description ?? null, d.kind, d.risk_item_id ?? null, d.status, actor.userId];
  const row = d.id
    ? (
        await tx.query(
          `UPDATE rd.sw_requirement SET req_code = $2, title = $3, description = $4, kind = $5, risk_item_id = $6, status = $7,
                  updated_by = $8, updated_at = now(), version = version + 1
            WHERE id = $9 AND project_id = $1 RETURNING *`,
          [...values, d.id]
        )
      ).rows[0]
    : (
        await tx.query(
          `INSERT INTO rd.sw_requirement (project_id, req_code, title, description, kind, risk_item_id, status, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING *`,
          values
        )
      ).rows[0];
  if (!row) throw notFound("yêu cầu phần mềm");
  await writeAudit(tx, actor, { entityType: "rd_sw_requirement", entityId: row.id, action: d.id ? "update" : "create", changes: { req: [null, `${d.req_code} ${d.title}`], status: [null, d.status] } });
  return row;
}

const testCaseSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  project_id: z.string().uuid("chọn dự án"),
  tc_code: z.string().trim().regex(/^[A-Z][A-Z0-9_-]{1,29}$/, "mã ca kiểm thử viết hoa, ví dụ TC-001"),
  title: z.string().trim().min(3, "nhập tên ca kiểm thử").max(300),
  level: z.enum(["UNIT", "INTEGRATION", "SYSTEM"]).default("SYSTEM"),
  steps: z.string().trim().max(4000).optional().nullable(),
  expected: z.string().trim().min(3, "nhập kết quả mong đợi").max(2000),
  requirement_ids: z.array(z.string().uuid()).default([]),
  status: z.enum(["ACTIVE", "OBSOLETE"]).default("ACTIVE"),
});

/** Adds or edits a test case and the requirements it verifies. */
export async function saveTestCase(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(testCaseSchema, input);
  await authorize(tx, actor, "rd.project.manage", await projectScope(tx, d.project_id));
  const values = [d.project_id, d.tc_code, d.title, d.level, d.steps ?? null, d.expected, d.status, actor.userId];
  const row = d.id
    ? (
        await tx.query(
          `UPDATE rd.sw_test_case SET tc_code = $2, title = $3, level = $4, steps = $5, expected = $6, status = $7,
                  updated_by = $8, updated_at = now(), version = version + 1
            WHERE id = $9 AND project_id = $1 RETURNING *`,
          [...values, d.id]
        )
      ).rows[0]
    : (
        await tx.query(
          `INSERT INTO rd.sw_test_case (project_id, tc_code, title, level, steps, expected, status, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING *`,
          values
        )
      ).rows[0];
  if (!row) throw notFound("ca kiểm thử");
  const foreign = d.requirement_ids.length
    ? (await tx.query("SELECT 1 FROM rd.sw_requirement WHERE id = ANY($1::uuid[]) AND project_id <> $2", [d.requirement_ids, d.project_id])).rowCount
    : 0;
  if (foreign) throw invalid("Ca kiểm thử chỉ liên kết được yêu cầu của cùng dự án.");
  await tx.query("DELETE FROM rd.sw_test_trace WHERE test_case_id = $1", [row.id]);
  if (d.requirement_ids.length) {
    await tx.query("INSERT INTO rd.sw_test_trace (test_case_id, requirement_id) SELECT $1, unnest($2::uuid[])", [row.id, d.requirement_ids]);
  }
  await writeAudit(tx, actor, { entityType: "rd_sw_test_case", entityId: row.id, action: d.id ? "update" : "create", changes: { tc: [null, `${d.tc_code} ${d.title}`], requirements: [null, d.requirement_ids.length] } });
  return row;
}

const testRunSchema = z.object({
  test_case_id: z.string().uuid("chọn ca kiểm thử"),
  version_tag: z.string().trim().regex(/^v?\d+\.\d+(\.\d+)?(-[A-Za-z0-9._-]+)?$/, "nhập phiên bản bản dựng (ví dụ v1.2.0)"),
  result: z.enum(["PASS", "FAIL", "BLOCKED"]),
  actual: z.string().trim().max(4000).optional().nullable(),
});

/** Records one execution of a test case on a build (append-only; a re-test is a new run). */
export async function recordTestRun(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(testRunSchema, input);
  const tc = (await tx.query("SELECT project_id, status FROM rd.sw_test_case WHERE id = $1", [d.test_case_id])).rows[0];
  if (!tc) throw notFound("ca kiểm thử");
  await authorize(tx, actor, "rd.project.manage", await projectScope(tx, tc.project_id));
  if (tc.status !== "ACTIVE") throw invalid("Ca kiểm thử đã ngừng sử dụng.");
  if (d.result !== "PASS" && !d.actual?.trim()) throw invalid("Ghi kết quả thực tế khi ca kiểm thử không đạt hoặc bị chặn.");
  const run = (
    await tx.query(
      "INSERT INTO rd.sw_test_run (test_case_id, version_tag, result, actual, executed_by) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [d.test_case_id, d.version_tag, d.result, d.actual ?? null, actor.userId]
    )
  ).rows[0];
  await writeAudit(tx, actor, { entityType: "rd_sw_test_run", entityId: run.id, action: "execute", changes: { result: [null, `${d.version_tag}: ${d.result}`] } });
  return run;
}

export interface TraceRow {
  req_id: string;
  title: string;
  test_case_id: string;
  result: "PASS" | "FAIL" | "NOT_TESTED";
}

/**
 * Traceability matrix of a build: every active requirement with the active test cases verifying it and the latest
 * run of each on that version. PASS only when it has tests and the latest run of every one passed.
 * Null when the project keeps no structured requirements (releases then carry a hand-written matrix).
 */
export async function buildTraceability(tx: Tx, projectId: string, versionTag: string): Promise<TraceRow[] | null> {
  const rows = (
    await tx.query(
      `SELECT r.req_code, r.title, tc.tc_code,
              (SELECT run.result FROM rd.sw_test_run run
                WHERE run.test_case_id = tc.id AND run.version_tag = $2
                ORDER BY run.executed_at DESC LIMIT 1) AS last_result
         FROM rd.sw_requirement r
         LEFT JOIN rd.sw_test_trace tt ON tt.requirement_id = r.id
         LEFT JOIN rd.sw_test_case tc ON tc.id = tt.test_case_id AND tc.status = 'ACTIVE'
        WHERE r.project_id = $1 AND r.status = 'ACTIVE'
        ORDER BY r.req_code, tc.tc_code`,
      [projectId, versionTag]
    )
  ).rows;
  if (!rows.length) return null;
  const byReq = new Map<string, { title: string; tests: { code: string; result: string | null }[] }>();
  for (const r of rows) {
    const e = byReq.get(r.req_code) ?? { title: r.title as string, tests: [] as { code: string; result: string | null }[] };
    if (r.tc_code) e.tests.push({ code: r.tc_code, result: r.last_result });
    byReq.set(r.req_code, e);
  }
  return [...byReq.entries()].map(([req, e]) => ({
    req_id: req,
    title: e.title,
    test_case_id: e.tests.map((t) => t.code).join(", "),
    result: !e.tests.length ? "NOT_TESTED" : e.tests.every((t) => t.result === "PASS") ? "PASS" : "FAIL",
  }));
}

/** Problems of a project not yet verified fixed: they are the known anomalies of any release made now. */
export async function openProblems(tx: Tx, projectId: string) {
  return (
    await tx.query(
      `SELECT code AS bug_id, severity, title AS description, 'OPEN' AS status
         FROM rd.sw_problem WHERE project_id = $1 AND status IN ('OPEN', 'INVESTIGATING', 'FIXED')
        ORDER BY created_at`,
      [projectId]
    )
  ).rows as { bug_id: string; severity: string; description: string; status: "OPEN" }[];
}

// ---------------------------------------------------------------------------
// Problem reports (IEC 62304 §9)
// ---------------------------------------------------------------------------

export type SwProblemStatus = "OPEN" | "INVESTIGATING" | "FIXED" | "VERIFIED" | "REJECTED";
interface SwProblemRow {
  id: string;
  code: string;
  project_id: string;
  status: SwProblemStatus;
  version: number;
  fixed_by: number | null;
  created_by: number | null;
}

const fixSchema = z.object({
  root_cause: z.string().trim().min(3, "nhập nguyên nhân gốc").max(2000),
  fix_summary: z.string().trim().min(3, "nhập nội dung sửa lỗi").max(2000),
  fixed_in_version: z.string().trim().regex(/^v?\d+\.\d+(\.\d+)?(-[A-Za-z0-9._-]+)?$/, "nhập phiên bản đã sửa (ví dụ v1.2.1)"),
});

/** OPEN → INVESTIGATING → FIXED (root cause, fix, version) → VERIFIED by someone else; FIXED → OPEN when the fix fails; OPEN/INVESTIGATING → REJECTED. */
export const swProblemMachine = defineMachine<SwProblemStatus, SwProblemRow>({
  entityType: "rd_sw_problem",
  table: "rd.sw_problem",
  states: ["OPEN", "INVESTIGATING", "FIXED", "VERIFIED", "REJECTED"],
  terminal: ["VERIFIED", "REJECTED"],
  scopeOf: (row, tx) => projectScope(tx!, row.project_id),
  transitions: [
    { action: "investigate", from: "OPEN", to: "INVESTIGATING", permission: "rd.project.manage" },
    {
      action: "fix",
      from: ["OPEN", "INVESTIGATING"],
      to: "FIXED",
      permission: "rd.project.manage",
      guards: [
        {
          code: "FIX_DETAILS",
          message: "Nhập nguyên nhân gốc, nội dung sửa và phiên bản đã sửa.",
          check: ({ payload }) => fixSchema.safeParse(payload).success,
        },
      ],
      patch: ({ payload, actor }: GuardContext<SwProblemRow>) => ({ ...fixSchema.parse(payload), fixed_by: actor.userId }),
    },
    {
      action: "verify",
      from: "FIXED",
      to: "VERIFIED",
      permission: "rd.project.manage",
      guards: [
        {
          code: "SAME_PERSON",
          message: "Người xác nhận lỗi đã được sửa phải khác người sửa lỗi.",
          check: ({ actor, row }) => row.fixed_by !== actor.userId,
        },
      ],
      patch: ({ actor }) => ({ verified_by: actor.userId, verified_at: new Date() }),
    },
    { action: "reopen", from: "FIXED", to: "OPEN", permission: "rd.project.manage", reasonRequired: true },
    {
      action: "reject",
      from: ["OPEN", "INVESTIGATING"],
      to: "REJECTED",
      permission: "rd.gate.review",
      reasonRequired: true,
      patch: ({ reason }) => ({ reject_reason: reason }),
    },
  ],
});

const problemSchema = z.object({
  project_id: z.string().uuid("chọn dự án"),
  title: z.string().trim().min(3, "nhập tiêu đề lỗi").max(300),
  description: z.string().trim().min(5, "mô tả lỗi và cách tái hiện").max(4000),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  source: z.enum(["INTERNAL_TEST", "FIELD", "SERVICE_TICKET", "CUSTOMER", "REVIEW"]).default("INTERNAL_TEST"),
  found_in_version: z.string().trim().max(60).optional().nullable(),
  service_ticket_id: z.string().uuid().optional().nullable(),
  eco_id: z.string().uuid().optional().nullable(),
});

/** Reports a software problem; one coming from a field service ticket keeps the link to it. */
export async function createProblem(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(problemSchema, input);
  await authorize(tx, actor, "rd.project.manage", await projectScope(tx, d.project_id));
  if (d.service_ticket_id && !(await tx.query("SELECT 1 FROM device.service_ticket WHERE id = $1", [d.service_ticket_id])).rowCount) {
    throw notFound("phiếu bảo hành / dịch vụ");
  }
  if (d.eco_id && !(await tx.query("SELECT 1 FROM device.eco_request WHERE id = $1", [d.eco_id])).rowCount) throw notFound("ECO");
  return insertRecord<SwProblemRow>(tx, actor, "rd.sw_problem", "rd_sw_problem", {
    code: await nextNumber(tx, "SW_PROBLEM"),
    project_id: d.project_id,
    title: d.title,
    description: d.description,
    severity: d.severity,
    source: d.service_ticket_id ? "SERVICE_TICKET" : d.source,
    found_in_version: d.found_in_version ?? null,
    service_ticket_id: d.service_ticket_id ?? null,
    eco_id: d.eco_id ?? null,
  });
}

/** Links (or unlinks) the ECO that carries a fix into the device design (firmware change). */
export async function linkProblemEco(tx: Tx, actor: AuthzActor, problemId: string, ecoId: string | null) {
  const p = (await tx.query("SELECT * FROM rd.sw_problem WHERE id = $1 FOR UPDATE", [problemId])).rows[0];
  if (!p) throw notFound("phiếu báo lỗi");
  await authorize(tx, actor, "rd.project.manage", await projectScope(tx, p.project_id));
  if (ecoId && !(await tx.query("SELECT 1 FROM device.eco_request WHERE id = $1", [ecoId])).rowCount) throw notFound("ECO");
  await tx.query("UPDATE rd.sw_problem SET eco_id = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1", [problemId, ecoId, actor.userId]);
  await writeAudit(tx, actor, { entityType: "rd_sw_problem", entityId: problemId, action: "link_eco", changes: { eco_id: [p.eco_id, ecoId] } });
}

// ---------------------------------------------------------------------------
// Lifecycle overview of a project
// ---------------------------------------------------------------------------

export async function getSoftwareLifecycle(tx: Tx, actor: AuthzActor, projectId: string, versionTag?: string | null) {
  const scope = await projectScope(tx, projectId);
  await authorize(tx, actor, "rd.view", scope);
  const requirements = (
    await tx.query(
      `SELECT r.*, COALESCE(array_agg(tc.tc_code ORDER BY tc.tc_code) FILTER (WHERE tc.id IS NOT NULL), '{}') AS test_codes
         FROM rd.sw_requirement r
         LEFT JOIN rd.sw_test_trace tt ON tt.requirement_id = r.id
         LEFT JOIN rd.sw_test_case tc ON tc.id = tt.test_case_id AND tc.status = 'ACTIVE'
        WHERE r.project_id = $1 GROUP BY r.id ORDER BY r.req_code`,
      [projectId]
    )
  ).rows;
  const tests = (
    await tx.query(
      `SELECT tc.*,
              COALESCE((SELECT array_agg(tt.requirement_id) FROM rd.sw_test_trace tt WHERE tt.test_case_id = tc.id), '{}') AS requirement_ids,
              (SELECT row_to_json(x) FROM (
                 SELECT run.version_tag, run.result, run.executed_at, p.display_name AS executed_by_name
                   FROM rd.sw_test_run run LEFT JOIN core.user_profile p ON p.user_id = run.executed_by
                  WHERE run.test_case_id = tc.id ORDER BY run.executed_at DESC LIMIT 1) x) AS last_run
         FROM rd.sw_test_case tc WHERE tc.project_id = $1 ORDER BY tc.tc_code`,
      [projectId]
    )
  ).rows;
  const versions = (
    await tx.query(
      `SELECT DISTINCT run.version_tag FROM rd.sw_test_run run JOIN rd.sw_test_case tc ON tc.id = run.test_case_id
        WHERE tc.project_id = $1 ORDER BY run.version_tag DESC`,
      [projectId]
    )
  ).rows.map((r) => r.version_tag as string);
  const version = versionTag?.trim() || versions[0] || null;
  const problems = (
    await tx.query(
      `SELECT pr.*, st.code AS service_ticket_code, eco.code AS eco_code
         FROM rd.sw_problem pr
         LEFT JOIN device.service_ticket st ON st.id = pr.service_ticket_id
         LEFT JOIN device.eco_request eco ON eco.id = pr.eco_id
        WHERE pr.project_id = $1
        ORDER BY CASE pr.status WHEN 'OPEN' THEN 0 WHEN 'INVESTIGATING' THEN 1 WHEN 'FIXED' THEN 2 ELSE 3 END, pr.created_at DESC`,
      [projectId]
    )
  ).rows;
  for (const p of problems) p.actions = await listAllowedActions(tx, swProblemMachine, actor, p);
  // what a problem report can be linked to: recent field service tickets and ECOs (device data, for those who see it)
  const seesDevices = actor.isRootAdmin || (await tx.query(
    `SELECT 1 FROM core.user_role ur JOIN core.role_permission rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = $1 AND ur.revoked_at IS NULL AND rp.permission_code = 'device.view' LIMIT 1`,
    [actor.userId]
  )).rowCount;
  const serviceTickets = seesDevices
    ? (
        await tx.query(
          `SELECT st.id, st.code, du.serial_no, st.symptom FROM device.service_ticket st
             JOIN device.device_unit du ON du.id = st.unit_id ORDER BY st.reported_at DESC, st.code DESC LIMIT 100`
        )
      ).rows
    : [];
  const ecos = seesDevices ? (await tx.query("SELECT id, code, title, status FROM device.eco_request ORDER BY created_at DESC LIMIT 100")).rows : [];
  return {
    service_tickets: serviceTickets,
    ecos,
    project_id: projectId,
    can_manage: await hasFactoryPermission(tx, actor, "rd.project.manage", scope),
    requirements,
    tests,
    versions,
    version,
    traceability: version ? await buildTraceability(tx, projectId, version) : null,
    problems,
  };
}

// ---------------------------------------------------------------------------
// Validation of in-house software used for GMP work (GAMP 5)
// ---------------------------------------------------------------------------

export type SwValidationStatus = "DRAFT" | "IQ_DONE" | "OQ_DONE" | "PQ_DONE" | "IN_USE" | "RETIRED";
interface SwValidationRow {
  id: string;
  code: string;
  org_unit_id: string;
  status: SwValidationStatus;
  version: number;
  created_by: number | null;
  pq_by: number | null;
}

const evidence = (field: "iq_summary" | "oq_summary" | "pq_summary", by: "iq_by" | "oq_by" | "pq_by", label: string) => ({
  guards: [
    {
      code: "EVIDENCE_REQUIRED",
      message: `Nhập tóm tắt kết quả ${label} (các bước kiểm, kết quả, sai lệch nếu có; đính kèm bằng chứng).`,
      check: ({ payload }: GuardContext<SwValidationRow>) => String(payload.summary ?? "").trim().length >= 10,
    },
  ],
  patch: ({ payload, actor }: GuardContext<SwValidationRow>) => ({ [field]: String(payload.summary).trim(), [by]: actor.userId }),
});

/** DRAFT (URS) → IQ → OQ → PQ → IN_USE ✍ (approved by someone who neither prepared it nor ran the PQ) → RETIRED. */
export const swValidationMachine = defineMachine<SwValidationStatus, SwValidationRow>({
  entityType: "rd_sw_validation",
  table: "rd.sw_validation",
  states: ["DRAFT", "IQ_DONE", "OQ_DONE", "PQ_DONE", "IN_USE", "RETIRED"],
  terminal: ["RETIRED"],
  scopeOf: (row) => row.org_unit_id,
  transitions: [
    { action: "complete_iq", from: "DRAFT", to: "IQ_DONE", permission: "rd.project.manage", ...evidence("iq_summary", "iq_by", "IQ (cài đặt)") },
    { action: "complete_oq", from: "IQ_DONE", to: "OQ_DONE", permission: "rd.project.manage", ...evidence("oq_summary", "oq_by", "OQ (vận hành)") },
    { action: "complete_pq", from: "OQ_DONE", to: "PQ_DONE", permission: "rd.project.manage", ...evidence("pq_summary", "pq_by", "PQ (hiệu năng)") },
    {
      action: "approve_use",
      from: "PQ_DONE",
      to: "IN_USE",
      permission: "rd.software.release",
      signature: "APPROVED",
      guards: [
        {
          code: "SELF_APPROVAL",
          message: "Người phê duyệt đưa vào sử dụng phải khác người lập hồ sơ và người thực hiện PQ.",
          check: ({ actor, row }) => row.created_by !== actor.userId && row.pq_by !== actor.userId,
        },
      ],
      patch: ({ actor }) => ({ approved_by: actor.userId, approved_at: new Date() }),
    },
    { action: "retire", from: ["DRAFT", "IQ_DONE", "OQ_DONE", "PQ_DONE", "IN_USE"], to: "RETIRED", permission: "rd.software.release", reasonRequired: true, patch: ({ reason }) => ({ retire_reason: reason }) },
  ],
});

const validationSchema = z.object({
  org_unit_id: z.string().uuid().optional().nullable(),
  system_name: z.string().trim().min(2, "nhập tên phần mềm / hệ thống").max(200),
  system_version: z.string().trim().min(1, "nhập phiên bản").max(60),
  gamp_category: z.enum(["1", "3", "4", "5"]).default("4"),
  gxp_impact: z.boolean().default(true),
  intended_use: z.string().trim().min(10, "nhập mục đích sử dụng / yêu cầu người dùng (URS)").max(4000),
  risk_level: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
});

/** Opens the validation record of an in-house system (default: run by KTCN). */
export async function createValidation(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(validationSchema, input);
  const unit =
    d.org_unit_id ?? (await tx.query("SELECT id FROM core.org_unit WHERE module_key = 'DEVICE' AND status = 'ACTIVE' LIMIT 1")).rows[0]?.id;
  if (!unit) throw invalid("Chưa cấu hình Phòng Kỹ thuật Công nghệ (KTCN).");
  await authorize(tx, actor, "rd.project.manage", unit);
  return insertRecord<SwValidationRow>(tx, actor, "rd.sw_validation", "rd_sw_validation", {
    code: await nextNumber(tx, "SW_VALIDATION"),
    org_unit_id: unit,
    system_name: d.system_name,
    system_version: d.system_version,
    gamp_category: d.gamp_category,
    gxp_impact: d.gxp_impact,
    intended_use: d.intended_use,
    risk_level: d.risk_level,
  });
}

export async function listValidations(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "rd.view");
  const rows = (
    await tx.query(
      `SELECT v.*, a.display_name AS approved_by_name FROM rd.sw_validation v
         LEFT JOIN core.user_profile a ON a.user_id = v.approved_by
        ORDER BY CASE v.status WHEN 'IN_USE' THEN 1 WHEN 'RETIRED' THEN 2 ELSE 0 END, v.created_at DESC LIMIT 200`
    )
  ).rows;
  const visible = [];
  for (const r of rows) {
    if (!(await hasFactoryPermission(tx, actor, "rd.view", r.org_unit_id))) continue;
    r.actions = await listAllowedActions(tx, swValidationMachine, actor, r);
    visible.push(r);
  }
  return visible;
}

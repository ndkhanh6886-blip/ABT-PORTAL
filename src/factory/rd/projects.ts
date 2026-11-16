import { z } from "zod";
import type { Tx } from "../core/db";
import { diffChanges, writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, hasFactoryPermission, type AuthzActor } from "../core/authz";
import { vnToday } from "../core/dates";
import { conflict, invalid, notFound } from "../core/errors";
import { readAttachment, saveAttachment } from "../core/files";
import { nextNumber } from "../core/numbering";
import { insertRecord, parseInput } from "../core/records";
import { defineMachine, listAllowedActions, runTransition } from "../core/stateMachine";
import { ideaMachine, type IdeaRow } from "./ideas";
import "./permissions";

export type ProjectStatus = "ACTIVE" | "ON_HOLD" | "TRANSFERRED" | "KILLED";
export type GateStatus = "LOCKED" | "OPEN" | "PENDING_REVIEW" | "PASSED" | "NEEDS_REVISION";

export interface ProjectRow {
  id: string;
  code: string;
  name: string;
  owner_org_unit_id: string;
  project_type: "NEW_PRODUCT" | "IMPROVEMENT" | "PROCESS" | "RESEARCH";
  target_domain: "KIT" | "OLIGO" | "DEVICE" | "SOFTWARE" | "OTHER";
  ivd_class: "CLASS_A" | "CLASS_B" | "CLASS_C" | "CLASS_D" | "RUO" | "NA" | null;
  idea_id: string | null;
  leader_id: number;
  gate_template_id: string;
  current_stage: string;
  status: ProjectStatus;
  planned_start: string | null;
  planned_end: string | null;
  actual_transfer_date: string | null;
  description: string | null;
  version: number;
}

export interface ProjectGateRow {
  id: string;
  project_id: string;
  gate_no: number;
  gate_name: string;
  stage_after: string;
  status: GateStatus;
  submitted_by: number | null;
  submitted_at: string | null;
  decision: "GO" | "RECYCLE" | "HOLD" | "KILL" | null;
  decided_by: number | null;
  decided_at: string | null;
  decision_note: string | null;
  version: number;
}

async function projectOwner(tx: Tx, projectId: string): Promise<string> {
  const p = (await tx.query("SELECT owner_org_unit_id FROM rd.project WHERE id = $1", [projectId])).rows[0];
  if (!p) throw notFound("dự án R&D");
  return p.owner_org_unit_id;
}

const immutableHandoffSql = (projIdExpr: string) => `(
  EXISTS (SELECT 1 FROM rd.tech_transfer_package ttp WHERE ttp.project_id = ${projIdExpr} AND ttp.status <> 'DRAFT')
  OR EXISTS (SELECT 1 FROM rd.software_release sr WHERE sr.project_id = ${projIdExpr} AND sr.status <> 'DRAFT')
  OR EXISTS (SELECT 1 FROM device.device_model dm WHERE dm.rd_project_id = ${projIdExpr} AND dm.status = 'COMMERCIAL')
  OR EXISTS (SELECT 1 FROM rd.sw_test_run tr JOIN rd.sw_test_case tc ON tc.id = tr.test_case_id WHERE tc.project_id = ${projIdExpr})
)`;

export async function hasImmutableProjectHandoff(tx: Tx, projectId: string): Promise<boolean> {
  const row = (await tx.query(`SELECT ${immutableHandoffSql("$1")} AS locked`, [projectId])).rows[0];
  return Boolean(row?.locked);
}

export const projectMachine = defineMachine<ProjectStatus, ProjectRow>({
  entityType: "rd_project",
  table: "rd.project",
  states: ["ACTIVE", "ON_HOLD", "TRANSFERRED", "KILLED"],
  terminal: ["TRANSFERRED", "KILLED"],
  scopeOf: (row) => row.owner_org_unit_id,
  transitions: [
    {
      action: "hold",
      from: "ACTIVE",
      to: "ON_HOLD",
      permission: "rd.gate.review",
      reasonRequired: true,
    },
    {
      action: "resume",
      from: "ON_HOLD",
      to: "ACTIVE",
      permission: "rd.gate.review",
      reasonRequired: true,
    },
    {
      action: "kill",
      from: ["ACTIVE", "ON_HOLD"],
      to: "KILLED",
      permission: "rd.gate.review",
      signature: "APPROVED",
      reasonRequired: true,
    },
    {
      action: "mark_transferred",
      from: "ACTIVE",
      to: "TRANSFERRED",
      permission: "rd.gate.review",
      guards: [
        {
          code: "GATES_OR_TRANSFER_NOT_READY",
          message:
            "Chỉ đánh dấu Đã chuyển giao SX khi dự án đã qua tất cả cổng Stage-Gate (PASSED) hoặc đã có Hồ sơ Chuyển giao Công nghệ / Phát hành Phần mềm được nghiệm thu.",
          check: async ({ tx, row }) => {
            const res = (
              await tx.query(
                `SELECT (
                   (EXISTS (SELECT 1 FROM rd.project_gate WHERE project_id = $1)
                    AND NOT EXISTS (SELECT 1 FROM rd.project_gate WHERE project_id = $1 AND status <> 'PASSED'))
                   OR EXISTS (SELECT 1 FROM rd.tech_transfer_package WHERE project_id = $1 AND status IN ('ACCEPTED', 'COMPLETED'))
                   OR EXISTS (SELECT 1 FROM rd.software_release WHERE project_id = $1 AND status = 'RELEASED')
                 ) AS ready`,
                [row.id]
              )
            ).rows[0];
            return Boolean(res?.ready);
          },
        },
      ],
      patch: () => ({ actual_transfer_date: vnToday(), current_stage: "TRANSFERRED" }),
    },
  ],
});

/**
 * ISO 13485 Stage-Gate state machine (docs/nha-may/02 §7.3):
 * LOCKED → OPEN (system) → PENDING_REVIEW (submit) → PASSED (decide_go ✍) | NEEDS_REVISION (decide_recycle 📝).
 * Sequential gate integrity: a gate can only be submitted if all previous gates are PASSED;
 * decide_go requires every required deliverable to be ACCEPTED and signed by someone other than the submitter.
 */
export const projectGateMachine = defineMachine<GateStatus, ProjectGateRow>({
  entityType: "rd_project_gate",
  table: "rd.project_gate",
  states: ["LOCKED", "OPEN", "PENDING_REVIEW", "PASSED", "NEEDS_REVISION"],
  terminal: ["PASSED"],
  scopeOf: (row, tx) => projectOwner(tx!, row.project_id),
  transitions: [
    {
      action: "unlock",
      from: "LOCKED",
      to: "OPEN",
      permission: "rd.project.manage",
    },
    {
      action: "submit",
      from: ["OPEN", "NEEDS_REVISION"],
      to: "PENDING_REVIEW",
      permission: "rd.project.manage",
      guards: [
        {
          code: "PROJECT_ACTIVE",
          message: "Dự án phải đang ở trạng thái ACTIVE mới được gửi duyệt cổng.",
          check: async ({ tx, row }) => {
            const p = (await tx.query("SELECT status FROM rd.project WHERE id = $1", [row.project_id])).rows[0];
            return p?.status === "ACTIVE";
          },
        },
        {
          code: "PREV_GATE_NOT_PASSED",
          message: "Các cổng trước phải đạt quyết định GO (PASSED) trước khi nộp cổng này.",
          check: async ({ tx, row }) => {
            const unpassed = await tx.query(
              "SELECT 1 FROM rd.project_gate WHERE project_id = $1 AND gate_no < $2 AND status <> 'PASSED' LIMIT 1",
              [row.project_id, row.gate_no]
            );
            return !unpassed.rowCount;
          },
        },
        {
          code: "MISSING_DELIVERABLES",
          message: "Tất cả hồ sơ bắt buộc của cổng phải được nộp (SUBMITTED hoặc ACCEPTED) trước khi gửi hội đồng.",
          check: async ({ tx, row }) => {
            const missing = await tx.query(
              "SELECT 1 FROM rd.gate_deliverable WHERE project_gate_id = $1 AND is_required AND status NOT IN ('SUBMITTED', 'ACCEPTED') LIMIT 1",
              [row.id]
            );
            return !missing.rowCount;
          },
        },
      ],
      patch: ({ actor }) => ({ submitted_by: actor.userId, submitted_at: new Date() }),
    },
    {
      action: "decide_go",
      from: "PENDING_REVIEW",
      to: "PASSED",
      permission: "rd.gate.review",
      signature: "APPROVED",
      guards: [
        {
          code: "SELF_REVIEW",
          message: "Người ký duyệt cổng Stage-Gate phải khác người đã nộp cổng.",
          check: ({ actor, row }) => row.submitted_by !== actor.userId,
        },
        {
          code: "DELIVERABLES_NOT_ACCEPTED",
          message: "Mọi hồ sơ bắt buộc trong checklist cổng phải được đánh giá Đạt (ACCEPTED) trước khi ký quyết định GO.",
          check: async ({ tx, row }) => {
            const unaccepted = await tx.query(
              "SELECT 1 FROM rd.gate_deliverable WHERE project_gate_id = $1 AND is_required AND status <> 'ACCEPTED' LIMIT 1",
              [row.id]
            );
            return !unaccepted.rowCount;
          },
        },
        {
          code: "SPEC_EVALUATION_NOT_PASSED",
          message: "Tất cả chỉ tiêu thiết kế / TPP (spec_evaluation) của giai đoạn này phải đạt kết quả PASS trước khi qua cổng.",
          check: async ({ tx, row }) => {
            const disallowed = Number(row.gate_no) < 2 ? "('FAIL')" : "('FAIL', 'PENDING')";
            const unpassed = await tx.query(
              `SELECT 1 FROM rd.spec_evaluation WHERE project_id = $1 AND result IN ${disallowed} LIMIT 1`,
              [row.project_id]
            );
            return !unpassed.rowCount;
          },
        },
        {
          code: "UNMITIGATED_RISK_ITEMS",
          message: "Không được qua cổng khi còn mục rủi ro ISO 14971 đang mở (OPEN) hoặc có RPN tồn dư cao (≥ 15) chưa được giảm thiểu / chấp nhận.",
          check: async ({ tx, row }) => {
            const openRisk = await tx.query(
              `SELECT 1 FROM rd.risk_item
                WHERE project_id = $1
                  AND (
                    status = 'OPEN'
                    OR (COALESCE(residual_severity * residual_occurrence * residual_detection, rpn) >= 15 AND status NOT IN ('MITIGATED', 'ACCEPTED'))
                  )
                LIMIT 1`,
              [row.project_id]
            );
            return !openRisk.rowCount;
          },
        },
      ],
      patch: ({ actor, reason, payload }) => ({
        decision: "GO",
        decided_by: actor.userId,
        decided_at: new Date(),
        decision_note: (payload.decision_note as string) || reason || null,
      }),
      effects: async ({ tx, actor, updated }) => {
        // Advance project stage to this gate's stage_after
        await tx.query(
          "UPDATE rd.project SET current_stage = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1",
          [updated.project_id, updated.stage_after, actor.userId]
        );
        // Unlock the next gate if one exists; otherwise if stage_after === 'TRANSFERRED', mark project TRANSFERRED
        const nextGate = (
          await tx.query(
            "SELECT * FROM rd.project_gate WHERE project_id = $1 AND gate_no > $2 ORDER BY gate_no ASC LIMIT 1 FOR UPDATE",
            [updated.project_id, updated.gate_no]
          )
        ).rows[0] as ProjectGateRow | undefined;
        if (nextGate && nextGate.status === "LOCKED") {
          await runTransition(
            tx,
            projectGateMachine,
            actor,
            { id: nextGate.id, action: "unlock", expectedVersion: nextGate.version },
            { trusted: true }
          );
        } else if (!nextGate) {
          const proj = (await tx.query("SELECT * FROM rd.project WHERE id = $1 FOR UPDATE", [updated.project_id])).rows[0] as ProjectRow;
          if (proj.status === "ACTIVE") {
            await runTransition(
              tx,
              projectMachine,
              actor,
              { id: proj.id, action: "mark_transferred", expectedVersion: proj.version },
              { trusted: true }
            );
          }
        }
      },
    },
    {
      action: "decide_recycle",
      from: "PENDING_REVIEW",
      to: "NEEDS_REVISION",
      permission: "rd.gate.review",
      reasonRequired: true,
      patch: ({ actor, reason }) => ({
        decision: "RECYCLE",
        decided_by: actor.userId,
        decided_at: new Date(),
        decision_note: reason ?? null,
      }),
    },
  ],
});

const BUILTIN_GATE_TEMPLATE_CODES = new Set(["SG_IVD_KIT", "SG_SOFTWARE", "SG_DEVICE_DHF"]);

async function authorizeGateCriteriaEdit(tx: Tx, actor: AuthzActor, ownerOrgUnitId: string): Promise<void> {
  for (const perm of ["rd.project.manage", "rd.project.edit", "rd.gate.review"]) {
    if (await hasFactoryPermission(tx, actor, perm, ownerOrgUnitId)) return;
  }
  await authorize(tx, actor, "rd.project.manage", ownerOrgUnitId);
}

async function authorizeGateTemplateManage(tx: Tx, actor: AuthzActor): Promise<void> {
  const perms = ["rd.gate.review", "rd.project.edit", "rd.project.manage"];
  const units = (await tx.query("SELECT id FROM core.org_unit WHERE status = 'ACTIVE'")).rows as { id: string }[];
  for (const perm of perms) {
    if (await hasFactoryPermission(tx, actor, perm, null)) return;
    for (const u of units) {
      if (await hasFactoryPermission(tx, actor, perm, u.id)) return;
    }
  }
  await authorizeAnywhere(tx, actor, "rd.project.manage");
}

async function assertProjectGatesCustomizable(tx: Tx, actor: AuthzActor, projectId: string): Promise<ProjectRow> {
  const project = (await tx.query("SELECT * FROM rd.project WHERE id = $1 FOR UPDATE", [projectId])).rows[0] as
    | ProjectRow
    | undefined;
  if (!project) throw notFound("dự án R&D");
  await authorizeGateCriteriaEdit(tx, actor, project.owner_org_unit_id);
  if (project.status === "TRANSFERRED" || project.status === "KILLED" || (await hasImmutableProjectHandoff(tx, projectId))) {
    throw conflict(
      "Không thể chỉnh sửa tiêu chí Stage-Gate của dự án đã kết thúc / chuyển giao sản xuất hoặc đã có hồ sơ nghiệm thu."
    );
  }
  return project;
}

async function insertProjectGatesFromTemplateItems(tx: Tx, projectId: string, tplItems: any[]): Promise<void> {
  const gatesMap = new Map<number, { gate_name: string; stage_after: string; items: any[] }>();
  for (const item of tplItems) {
    if (!gatesMap.has(item.gate_no)) {
      gatesMap.set(item.gate_no, { gate_name: item.gate_name, stage_after: item.stage_after, items: [] });
    }
    gatesMap.get(item.gate_no)!.items.push(item);
  }
  const sortedGateNos = [...gatesMap.keys()].sort((a, b) => a - b);
  for (const [idx, gateNo] of sortedGateNos.entries()) {
    const g = gatesMap.get(gateNo)!;
    const gateRow = (
      await tx.query(
        `INSERT INTO rd.project_gate (project_id, gate_no, gate_name, stage_after, status)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [projectId, gateNo, g.gate_name, g.stage_after, idx === 0 ? "OPEN" : "LOCKED"]
      )
    ).rows[0];
    for (const it of g.items) {
      await tx.query(
        `INSERT INTO rd.gate_deliverable (project_gate_id, template_item_id, seq, item_name, doc_type, is_required, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'MISSING')`,
        [gateRow.id, it.id, it.seq, it.item_name, it.doc_type, it.is_required]
      );
    }
  }
}

export async function listGateTemplates(tx: Tx, actor: AuthzActor) {
  await authorizeAnywhere(tx, actor, "rd.view");
  const templates = (
    await tx.query(
      `SELECT t.*,
              (SELECT count(*)::int FROM rd.project p WHERE p.gate_template_id = t.id) AS project_count
         FROM rd.gate_template t
        WHERE t.status = 'ACTIVE'
        ORDER BY CASE WHEN t.code IN ('SG_IVD_KIT', 'SG_SOFTWARE', 'SG_DEVICE_DHF') THEN 0 ELSE 1 END, t.code`
    )
  ).rows;
  for (const t of templates) {
    t.items = (
      await tx.query("SELECT * FROM rd.gate_template_item WHERE template_id = $1 ORDER BY gate_no ASC, seq ASC", [t.id])
    ).rows;
  }
  return templates;
}

const gateTemplateItemInputSchema = z.object({
  item_name: z.string().trim().min(2, "Nhập tên tiêu chí / hạng mục hồ sơ").max(300),
  doc_type: z.string().trim().min(1, "Nhập mã hồ sơ").max(60).default("DHF_DOC"),
  is_required: z.boolean().default(true),
});

const gateTemplateGateInputSchema = z.object({
  gate_no: z.coerce.number().int().min(0).max(10),
  gate_name: z.string().trim().min(2, "Nhập tên cổng Stage-Gate").max(200),
  stage_after: z.string().trim().min(2, "Nhập mã giai đoạn tiếp theo").max(80),
  items: z.array(gateTemplateItemInputSchema).min(1, "Mỗi cổng cần ít nhất 1 tiêu chí/hồ sơ").max(40),
});

const saveGateTemplateSchema = z.object({
  code: z.string().trim().max(40).optional().nullable(),
  name: z.string().trim().min(3, "Nhập tên bộ mẫu Stage-Gate").max(200),
  domain: z.enum(["KIT", "OLIGO", "DEVICE", "SOFTWARE", "OTHER"]).default("KIT"),
  description: z.string().trim().max(1000).optional().nullable(),
  gates: z.array(gateTemplateGateInputSchema).min(1, "Bộ mẫu phải có ít nhất 1 cổng Stage-Gate").max(11),
});

export async function saveGateTemplate(tx: Tx, actor: AuthzActor, templateId: string | null, input: unknown) {
  await authorizeGateTemplateManage(tx, actor);
  const d = parseInput(saveGateTemplateSchema, input);

  const gateNos = d.gates.map((g) => g.gate_no);
  if (new Set(gateNos).size !== gateNos.length) {
    throw invalid("Số thứ tự cổng (gate_no) trong bộ mẫu không được trùng nhau.");
  }

  const normalizedRawCode = (d.code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (d.code && d.code.trim() !== "" && normalizedRawCode.length < 2) {
    throw invalid("Mã bộ mẫu Stage-Gate phải có ít nhất 2 ký tự chữ/số.");
  }

  let tpl: any;
  let oldCode: string | null = null;
  if (templateId) {
    const existing = (await tx.query("SELECT * FROM rd.gate_template WHERE id = $1 FOR UPDATE", [templateId])).rows[0];
    if (!existing) throw notFound("bộ mẫu Stage-Gate");
    oldCode = existing.code;
    const finalCode = BUILTIN_GATE_TEMPLATE_CODES.has(existing.code)
      ? existing.code
      : normalizedRawCode || existing.code;
    if (finalCode !== existing.code) {
      const dup = await tx.query("SELECT 1 FROM rd.gate_template WHERE code = $1 AND id <> $2", [finalCode, templateId]);
      if (dup.rowCount) throw conflict("Mã bộ mẫu Stage-Gate đã tồn tại.");
    }
    tpl = (
      await tx.query(
        `UPDATE rd.gate_template
            SET code = $2,
                name = $3,
                domain = $4,
                description = $5,
                status = 'ACTIVE',
                version = version + 1,
                updated_at = now(),
                updated_by = $6
          WHERE id = $1
          RETURNING *`,
        [templateId, finalCode, d.name, d.domain, d.description ?? null, actor.userId]
      )
    ).rows[0];
  } else {
    const finalCode =
      normalizedRawCode ||
      `SG_CUSTOM_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const dup = await tx.query("SELECT 1 FROM rd.gate_template WHERE code = $1", [finalCode]);
    if (dup.rowCount) throw conflict("Mã bộ mẫu Stage-Gate đã tồn tại.");
    tpl = (
      await tx.query(
        `INSERT INTO rd.gate_template (code, name, domain, description, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING *`,
        [finalCode, d.name, d.domain, d.description ?? null, actor.userId]
      )
    ).rows[0];
  }

  // Delete previous template items cleanly (existing project deliverables keep their snapshots with template_item_id = NULL)
  await tx.query("DELETE FROM rd.gate_template_item WHERE template_id = $1", [tpl.id]);
  const sortedGates = [...d.gates].sort((a, b) => a.gate_no - b.gate_no);
  for (const g of sortedGates) {
    for (let idx = 0; idx < g.items.length; idx++) {
      const it = g.items[idx];
      await tx.query(
        `INSERT INTO rd.gate_template_item (template_id, gate_no, gate_name, stage_after, seq, item_name, doc_type, is_required)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          tpl.id,
          g.gate_no,
          g.gate_name,
          g.stage_after,
          idx + 1,
          it.item_name,
          (it.doc_type || "DHF_DOC").trim().toUpperCase(),
          it.is_required,
        ]
      );
    }
  }

  const items = (
    await tx.query("SELECT * FROM rd.gate_template_item WHERE template_id = $1 ORDER BY gate_no ASC, seq ASC", [tpl.id])
  ).rows;
  const projectCount = Number(
    (await tx.query("SELECT count(*)::int AS c FROM rd.project WHERE gate_template_id = $1", [tpl.id])).rows[0]?.c ?? 0
  );

  await writeAudit(tx, actor, {
    entityType: "rd_gate_template",
    entityId: tpl.id,
    action: templateId ? "update" : "create",
    changes: {
      code: [oldCode, tpl.code],
      name: [null, tpl.name],
      item_count: [null, items.length],
    },
  });

  return { ...tpl, project_count: projectCount, items };
}

export async function deleteGateTemplate(tx: Tx, actor: AuthzActor, templateId: string) {
  await authorizeGateTemplateManage(tx, actor);
  if (!templateId) throw invalid("Thiếu ID bộ mẫu Stage-Gate cần xóa.");
  const existing = (await tx.query("SELECT * FROM rd.gate_template WHERE id = $1 FOR UPDATE", [templateId])).rows[0];
  if (!existing) throw notFound("bộ mẫu Stage-Gate");
  if (BUILTIN_GATE_TEMPLATE_CODES.has(existing.code)) {
    throw invalid(
      "Không thể xóa bộ mẫu gốc mặc định của hệ thống. Bạn có thể chỉnh sửa trực tiếp tiêu chí của mẫu này hoặc nhân bản thành mẫu mới."
    );
  }

  const used = await tx.query("SELECT 1 FROM rd.project WHERE gate_template_id = $1 LIMIT 1", [templateId]);
  if (used.rowCount) {
    await tx.query(
      "UPDATE rd.gate_template SET status = 'INACTIVE', updated_at = now(), updated_by = $2 WHERE id = $1",
      [templateId, actor.userId]
    );
  } else {
    await tx.query("DELETE FROM rd.gate_template WHERE id = $1", [templateId]);
  }

  await writeAudit(tx, actor, {
    entityType: "rd_gate_template",
    entityId: templateId,
    action: "delete",
    changes: { code: [existing.code, null], name: [existing.name, null] },
  });
  return { deleted: true, id: templateId };
}

const projectGateMetaSchema = z.object({
  gate_no: z.coerce.number().int().min(0).max(10).optional(),
  gate_name: z.string().trim().min(2, "Nhập tên cổng Stage-Gate").max(200),
  stage_after: z.string().trim().min(2, "Nhập mã giai đoạn tiếp theo").max(80),
});

export async function saveProjectGateMeta(
  tx: Tx,
  actor: AuthzActor,
  projectId: string,
  gateId: string | null,
  input: unknown
) {
  await assertProjectGatesCustomizable(tx, actor, projectId);
  const d = parseInput(projectGateMetaSchema, input);

  if (gateId) {
    const existing = (
      await tx.query("SELECT * FROM rd.project_gate WHERE id = $1 AND project_id = $2 FOR UPDATE", [gateId, projectId])
    ).rows[0] as ProjectGateRow | undefined;
    if (!existing) throw notFound("cổng Stage-Gate");
    if (existing.status === "PASSED") {
      throw invalid("Không thể chỉnh sửa cổng đã được ký duyệt qua cổng (PASSED).");
    }
    const updated = (
      await tx.query(
        `UPDATE rd.project_gate
            SET gate_name = $2,
                stage_after = $3,
                version = version + 1,
                updated_at = now(),
                updated_by = $4
          WHERE id = $1
          RETURNING *`,
        [gateId, d.gate_name, d.stage_after, actor.userId]
      )
    ).rows[0];
    await writeAudit(tx, actor, {
      entityType: "rd_project_gate",
      entityId: gateId,
      action: "update_meta",
      changes: {
        gate_name: [existing.gate_name, updated.gate_name],
        stage_after: [existing.stage_after, updated.stage_after],
      },
    });
    return updated;
  }

  const existingGates = (
    await tx.query("SELECT id, gate_no, status FROM rd.project_gate WHERE project_id = $1 ORDER BY gate_no ASC", [
      projectId,
    ])
  ).rows as { id: string; gate_no: number; status: string }[];
  const maxGateNo = existingGates.length ? Math.max(...existingGates.map((g) => Number(g.gate_no))) : -1;
  const gateNo = d.gate_no ?? maxGateNo + 1;
  if (gateNo < 0 || gateNo > 10) {
    throw invalid("Số thứ tự cổng (gate_no) phải nằm trong khoảng 0 đến 10.");
  }
  if (existingGates.some((g) => Number(g.gate_no) === gateNo)) {
    throw conflict(`Dự án đã có Gate ${gateNo}. Vui lòng chọn số thứ tự cổng khác.`);
  }
  const hasUnpassedPrior = existingGates.some((g) => Number(g.gate_no) < gateNo && g.status !== "PASSED");
  const initialStatus: GateStatus = hasUnpassedPrior ? "LOCKED" : "OPEN";

  const inserted = (
    await tx.query(
      `INSERT INTO rd.project_gate (project_id, gate_no, gate_name, stage_after, status, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [projectId, gateNo, d.gate_name, d.stage_after, initialStatus, actor.userId]
    )
  ).rows[0];

  await writeAudit(tx, actor, {
    entityType: "rd_project_gate",
    entityId: inserted.id,
    action: "create_gate",
    changes: {
      gate_no: [null, gateNo],
      gate_name: [null, d.gate_name],
      stage_after: [null, d.stage_after],
    },
  });
  return inserted;
}

export async function deleteProjectGate(tx: Tx, actor: AuthzActor, projectId: string, gateId: string) {
  await assertProjectGatesCustomizable(tx, actor, projectId);
  const existing = (
    await tx.query("SELECT * FROM rd.project_gate WHERE id = $1 AND project_id = $2 FOR UPDATE", [gateId, projectId])
  ).rows[0] as ProjectGateRow | undefined;
  if (!existing) throw notFound("cổng Stage-Gate");
  if (existing.status === "PASSED") {
    throw invalid("Không thể xóa cổng đã được ký duyệt qua cổng (PASSED).");
  }
  const totalGates = Number(
    (await tx.query("SELECT count(*)::int AS c FROM rd.project_gate WHERE project_id = $1", [projectId])).rows[0]?.c ?? 0
  );
  if (totalGates <= 1) {
    throw invalid("Dự án phải có ít nhất 1 cổng Stage-Gate.");
  }
  const hasEvidence = await tx.query(
    "SELECT 1 FROM rd.gate_deliverable WHERE project_gate_id = $1 AND (status = 'ACCEPTED' OR attachment_id IS NOT NULL) LIMIT 1",
    [gateId]
  );
  if (hasEvidence.rowCount) {
    throw invalid(
      "Không thể xóa cổng đã có hồ sơ đính kèm hoặc đã được thẩm định Đạt. Hãy xóa/gỡ từng hạng mục trước nếu cần."
    );
  }

  await tx.query("DELETE FROM rd.gate_deliverable WHERE project_gate_id = $1", [gateId]);
  await tx.query("DELETE FROM rd.project_gate WHERE id = $1", [gateId]);

  const remaining = (
    await tx.query("SELECT id, status FROM rd.project_gate WHERE project_id = $1 ORDER BY gate_no ASC", [projectId])
  ).rows as { id: string; status: string }[];
  const hasActiveGate = remaining.some((g) => ["OPEN", "PENDING_REVIEW", "NEEDS_REVISION"].includes(g.status));
  if (!hasActiveGate) {
    const firstLocked = remaining.find((g) => g.status === "LOCKED");
    if (firstLocked) {
      await tx.query("UPDATE rd.project_gate SET status = 'OPEN', updated_at = now(), updated_by = $2 WHERE id = $1", [
        firstLocked.id,
        actor.userId,
      ]);
    }
  }

  await writeAudit(tx, actor, {
    entityType: "rd_project_gate",
    entityId: gateId,
    action: "delete_gate",
    changes: { gate_no: [existing.gate_no, null], gate_name: [existing.gate_name, null] },
  });
  return { deleted: true, id: gateId };
}

const projectDeliverableCriterionSchema = z.object({
  project_gate_id: z.string().uuid("Chọn cổng Stage-Gate"),
  item_name: z.string().trim().min(2, "Nhập tên tiêu chí / hạng mục hồ sơ").max(300),
  doc_type: z.string().trim().min(1).max(60).default("DHF_DOC"),
  is_required: z.boolean().default(true),
  seq: z.coerce.number().int().positive().optional(),
});

export async function saveProjectGateDeliverable(
  tx: Tx,
  actor: AuthzActor,
  projectId: string,
  deliverableId: string | null,
  input: unknown
) {
  await assertProjectGatesCustomizable(tx, actor, projectId);
  const d = parseInput(projectDeliverableCriterionSchema, input);

  const gate = (
    await tx.query("SELECT * FROM rd.project_gate WHERE id = $1 AND project_id = $2 FOR UPDATE", [
      d.project_gate_id,
      projectId,
    ])
  ).rows[0] as ProjectGateRow | undefined;
  if (!gate) throw notFound("cổng Stage-Gate");
  if (gate.status === "PASSED") {
    throw invalid("Không thể chỉnh sửa tiêu chí trên cổng đã ký duyệt qua cổng (PASSED).");
  }

  const normalizedDocType = (d.doc_type || "DHF_DOC").trim().toUpperCase();

  if (deliverableId) {
    const existing = (
      await tx.query("SELECT * FROM rd.gate_deliverable WHERE id = $1 AND project_gate_id = $2 FOR UPDATE", [
        deliverableId,
        d.project_gate_id,
      ])
    ).rows[0];
    if (!existing) throw notFound("hạng mục hồ sơ cổng");
    const updated = (
      await tx.query(
        `UPDATE rd.gate_deliverable
            SET item_name = $2,
                doc_type = $3,
                is_required = $4,
                seq = COALESCE($5, seq),
                updated_at = now(),
                updated_by = $6
          WHERE id = $1
          RETURNING *`,
        [deliverableId, d.item_name, normalizedDocType, d.is_required, d.seq ?? null, actor.userId]
      )
    ).rows[0];
    await writeAudit(tx, actor, {
      entityType: "rd_gate_deliverable",
      entityId: deliverableId,
      action: "update_criterion",
      changes: {
        item_name: [existing.item_name, updated.item_name],
        doc_type: [existing.doc_type, updated.doc_type],
        is_required: [existing.is_required, updated.is_required],
      },
    });
    return updated;
  }

  const nextSeq =
    d.seq ??
    Number(
      (await tx.query("SELECT coalesce(max(seq), 0) + 1 AS s FROM rd.gate_deliverable WHERE project_gate_id = $1", [
        d.project_gate_id,
      ])).rows[0]?.s ?? 1
    );

  const inserted = (
    await tx.query(
      `INSERT INTO rd.gate_deliverable
         (project_gate_id, template_item_id, seq, item_name, doc_type, is_required, status, updated_by)
       VALUES ($1, NULL, $2, $3, $4, $5, 'MISSING', $6)
       RETURNING *`,
      [d.project_gate_id, nextSeq, d.item_name, normalizedDocType, d.is_required, actor.userId]
    )
  ).rows[0];

  await writeAudit(tx, actor, {
    entityType: "rd_gate_deliverable",
    entityId: inserted.id,
    action: "create_criterion",
    changes: {
      project_gate_id: [null, d.project_gate_id],
      item_name: [null, d.item_name],
      doc_type: [null, normalizedDocType],
      is_required: [null, d.is_required],
    },
  });
  return inserted;
}

export async function deleteProjectGateDeliverable(
  tx: Tx,
  actor: AuthzActor,
  projectId: string,
  deliverableId: string
) {
  await assertProjectGatesCustomizable(tx, actor, projectId);
  const existing = (
    await tx.query(
      `SELECT gd.*, pg.project_id, pg.status AS gate_status
         FROM rd.gate_deliverable gd
         JOIN rd.project_gate pg ON pg.id = gd.project_gate_id
        WHERE gd.id = $1 AND pg.project_id = $2
        FOR UPDATE OF gd`,
      [deliverableId, projectId]
    )
  ).rows[0];
  if (!existing) throw notFound("hạng mục hồ sơ cổng");
  if (existing.gate_status === "PASSED") {
    throw invalid("Không thể xóa tiêu chí trên cổng đã ký duyệt qua cổng (PASSED).");
  }

  await tx.query("DELETE FROM rd.gate_deliverable WHERE id = $1", [deliverableId]);
  await tx.query(
    `WITH ordered AS (
       SELECT id, row_number() OVER (ORDER BY seq ASC, id ASC) AS rn
         FROM rd.gate_deliverable
        WHERE project_gate_id = $1
     )
     UPDATE rd.gate_deliverable gd
        SET seq = ordered.rn
       FROM ordered
      WHERE gd.id = ordered.id AND gd.seq <> ordered.rn`,
    [existing.project_gate_id]
  );

  await writeAudit(tx, actor, {
    entityType: "rd_gate_deliverable",
    entityId: deliverableId,
    action: "delete_criterion",
    changes: {
      item_name: [existing.item_name, null],
      doc_type: [existing.doc_type, null],
    },
  });
  return { deleted: true, id: deliverableId };
}

export async function applyTemplateToProjectGates(
  tx: Tx,
  actor: AuthzActor,
  projectId: string,
  templateId: string
) {
  const project = await assertProjectGatesCustomizable(tx, actor, projectId);
  if (!templateId) throw invalid("Vui lòng chọn bộ mẫu Stage-Gate cần áp dụng.");

  const blocked = await tx.query(
    `SELECT 1
       FROM rd.project_gate pg
       LEFT JOIN rd.gate_deliverable gd ON gd.project_gate_id = pg.id
      WHERE pg.project_id = $1
        AND (pg.status = 'PASSED' OR gd.status IN ('SUBMITTED', 'ACCEPTED') OR gd.attachment_id IS NOT NULL)
      LIMIT 1`,
    [projectId]
  );
  if (blocked.rowCount) {
    throw invalid("Chỉ được áp dụng lại bộ mẫu khi chưa có cổng nào qua cổng (PASSED) và chưa có minh chứng/file nào đã nộp.");
  }

  const tpl = (await tx.query("SELECT * FROM rd.gate_template WHERE id = $1", [templateId])).rows[0];
  if (!tpl) throw notFound("bộ mẫu Stage-Gate");
  const tplItems = (
    await tx.query("SELECT * FROM rd.gate_template_item WHERE template_id = $1 ORDER BY gate_no ASC, seq ASC", [
      templateId,
    ])
  ).rows;
  if (!tplItems.length) throw invalid("Bộ mẫu Stage-Gate chưa có cổng / tiêu chí nào.");

  await tx.query(
    "DELETE FROM rd.gate_deliverable USING rd.project_gate pg WHERE pg.id = rd.gate_deliverable.project_gate_id AND pg.project_id = $1",
    [projectId]
  );
  await tx.query("DELETE FROM rd.project_gate WHERE project_id = $1", [projectId]);
  await insertProjectGatesFromTemplateItems(tx, projectId, tplItems);
  await tx.query(
    "UPDATE rd.project SET gate_template_id = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1",
    [projectId, templateId, actor.userId]
  );

  await writeAudit(tx, actor, {
    entityType: "rd_project",
    entityId: projectId,
    action: "apply_gate_template",
    changes: { gate_template_id: [project.gate_template_id, templateId], template_code: [null, tpl.code] },
  });
  return getProjectDetail(tx, actor, projectId);
}

const createProjectSchema = z.object({
  name: z.string().trim().min(3, "nhập tên dự án").max(300),
  owner_org_unit_id: z.string().uuid("chọn phòng chủ trì dự án"),
  project_type: z.enum(["NEW_PRODUCT", "IMPROVEMENT", "PROCESS", "RESEARCH"]).default("NEW_PRODUCT"),
  target_domain: z.enum(["KIT", "OLIGO", "DEVICE", "SOFTWARE", "OTHER"]).default("KIT"),
  ivd_class: z.enum(["CLASS_A", "CLASS_B", "CLASS_C", "CLASS_D", "RUO", "NA"]).optional().nullable(),
  idea_id: z.string().uuid().optional().nullable(),
  leader_id: z.coerce.number().int().optional(),
  gate_template_id: z.string().uuid().optional().nullable(),
  planned_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  planned_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  description: z.string().trim().max(4000).optional().nullable(),
});

/**
 * Creates a Stage-Gate R&D project and populates its gates and deliverables from the selected template.
 * Gate 0 starts OPEN; all subsequent gates start LOCKED (no skipping).
 * If created from an APPROVED idea, the idea transitions to CONVERTED in the same transaction.
 */
export async function createProject(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(createProjectSchema, input);
  await authorize(tx, actor, "rd.project.manage", d.owner_org_unit_id);

  let idea: IdeaRow | null = null;
  if (d.idea_id) {
    idea = (await tx.query("SELECT * FROM rd.idea WHERE id = $1 FOR UPDATE", [d.idea_id])).rows[0] as IdeaRow | undefined ?? null;
    if (!idea) throw notFound("ý tưởng R&D");
    if (idea.status !== "APPROVED") throw invalid("Chỉ khởi tạo dự án từ ý tưởng đã được phê duyệt (APPROVED).");
  }

  let templateId = d.gate_template_id ?? null;
  if (!templateId) {
    const codeByDomain: Record<string, string> = {
      KIT: "SG_IVD_KIT",
      OLIGO: "SG_IVD_KIT",
      SOFTWARE: "SG_SOFTWARE",
      DEVICE: "SG_DEVICE_DHF",
      OTHER: "SG_IVD_KIT",
    };
    const tpl = (await tx.query("SELECT id FROM rd.gate_template WHERE code = $1", [codeByDomain[d.target_domain]])).rows[0];
    if (!tpl) throw invalid("Chưa có mẫu Stage-Gate cho lĩnh vực này.");
    templateId = tpl.id;
  }

  const tplItems = (
    await tx.query("SELECT * FROM rd.gate_template_item WHERE template_id = $1 ORDER BY gate_no, seq", [templateId])
  ).rows;
  if (!tplItems.length) throw invalid("Mẫu Stage-Gate chưa có cổng nào.");

  const code = await nextNumber(tx, "RD_PROJECT");
  const leaderId = d.leader_id ?? actor.userId;
  const project = await insertRecord<ProjectRow>(tx, actor, "rd.project", "rd_project", {
    code,
    name: d.name,
    owner_org_unit_id: d.owner_org_unit_id,
    project_type: d.project_type,
    target_domain: d.target_domain,
    ivd_class: d.ivd_class ?? (d.target_domain === "KIT" ? "CLASS_B" : "NA"),
    idea_id: d.idea_id ?? null,
    leader_id: leaderId,
    gate_template_id: templateId,
    current_stage: "G0_CONCEPT",
    planned_start: d.planned_start ?? vnToday(),
    planned_end: d.planned_end ?? null,
    description: d.description ?? null,
  });

  // Add leader as project member
  await tx.query(
    "INSERT INTO rd.project_member (project_id, user_id, role_in_project, allocation_pct) VALUES ($1, $2, 'LEADER', 100) ON CONFLICT DO NOTHING",
    [project.id, leaderId]
  );

  // Group template items by gate_no
  await insertProjectGatesFromTemplateItems(tx, project.id, tplItems);

  if (idea) {
    await runTransition(tx, ideaMachine, actor, { id: idea.id, action: "convert", expectedVersion: idea.version }, { trusted: true });
  }
  return getProjectDetail(tx, actor, project.id);
}

const deliverableUpdateSchema = z.object({
  notes: z.string().trim().max(2000).optional().nullable(),
  status: z.enum(["SUBMITTED", "ACCEPTED", "REJECTED"]),
  reviewer_comment: z.string().trim().max(2000).optional().nullable(),
});

/**
 * Updates a gate deliverable:
 * - Project members (`rd.project.manage`) can mark a deliverable as `SUBMITTED` with notes/evidence.
 * - Gate reviewers (`rd.gate.review`) can review a deliverable as `ACCEPTED` or `REJECTED` with comment.
 */
export async function updateGateDeliverable(tx: Tx, actor: AuthzActor, deliverableId: string, input: unknown) {
  const d = parseInput(deliverableUpdateSchema, input);
  const deliv = (
    await tx.query(
      `SELECT gd.*, pg.project_id, pg.status AS gate_status, p.owner_org_unit_id
         FROM rd.gate_deliverable gd
         JOIN rd.project_gate pg ON pg.id = gd.project_gate_id
         JOIN rd.project p ON p.id = pg.project_id
        WHERE gd.id = $1 FOR UPDATE`,
      [deliverableId]
    )
  ).rows[0];
  if (!deliv) throw notFound("hạng mục hồ sơ cổng");
  if (deliv.gate_status === "PASSED" || deliv.gate_status === "LOCKED") {
    throw invalid(`Không thể cập nhật hồ sơ khi cổng đang ở trạng thái ${deliv.gate_status}.`);
  }
  if (d.status === "SUBMITTED") {
    await authorize(tx, actor, "rd.project.manage", deliv.owner_org_unit_id);
    if (!d.notes && !deliv.attachment_id) {
      throw invalid("Cần nhập ghi chú minh chứng / tham chiếu hồ sơ hoặc đính kèm file trước khi nộp hạng mục.");
    }
    const upd = (
      await tx.query(
        "UPDATE rd.gate_deliverable SET notes = COALESCE($2, notes), status = 'SUBMITTED', updated_at = now(), updated_by = $3 WHERE id = $1 RETURNING *",
        [deliverableId, d.notes ?? null, actor.userId]
      )
    ).rows[0];
    await writeAudit(tx, actor, { entityType: "rd_gate_deliverable", entityId: deliverableId, action: "submit", changes: { status: [deliv.status, "SUBMITTED"] } });
    return upd;
  }
  // ACCEPTED / REJECTED requires rd.gate.review
  await authorize(tx, actor, "rd.gate.review", deliv.owner_org_unit_id);
  if (d.status === "REJECTED" && !d.reviewer_comment) {
    throw invalid("Bắt buộc nhập nhận xét khi từ chối hạng mục hồ sơ.");
  }
  const upd = (
    await tx.query(
      `UPDATE rd.gate_deliverable SET status = $2, reviewer_comment = $3, reviewed_by = $4, reviewed_at = now(), updated_at = now(), updated_by = $4
        WHERE id = $1 RETURNING *`,
      [deliverableId, d.status, d.reviewer_comment ?? null, actor.userId]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "rd_gate_deliverable",
    entityId: deliverableId,
    action: `review_${d.status.toLowerCase()}`,
    changes: { status: [deliv.status, d.status] },
    reason: d.reviewer_comment ?? null,
  });
  return upd;
}

export async function attachDeliverableFile(
  tx: Tx,
  actor: AuthzActor,
  deliverableId: string,
  file: { fileName: string; mimeType: string; data: Buffer }
) {
  const deliv = (
    await tx.query(
      `SELECT gd.*, pg.status AS gate_status, p.owner_org_unit_id
         FROM rd.gate_deliverable gd
         JOIN rd.project_gate pg ON pg.id = gd.project_gate_id
         JOIN rd.project p ON p.id = pg.project_id
        WHERE gd.id = $1 FOR UPDATE`,
      [deliverableId]
    )
  ).rows[0];
  if (!deliv) throw notFound("hạng mục hồ sơ cổng");
  await authorize(tx, actor, "rd.project.manage", deliv.owner_org_unit_id);
  if (deliv.gate_status === "PASSED" || deliv.gate_status === "LOCKED") {
    throw invalid(`Không thể đính kèm file khi cổng ở trạng thái ${deliv.gate_status}.`);
  }
  const category = file.mimeType.startsWith("image/") ? "IMAGE" : "DOCUMENT";
  const att = await saveAttachment(tx, actor, { entityType: "rd_gate_deliverable", entityId: deliverableId, category, ...file });
  await tx.query(
    "UPDATE rd.gate_deliverable SET attachment_id = $2, status = CASE WHEN status = 'MISSING' THEN 'SUBMITTED' ELSE status END, updated_at = now(), updated_by = $3 WHERE id = $1",
    [deliverableId, att.id, actor.userId]
  );
  return att;
}

export async function readDeliverableFile(tx: Tx, actor: AuthzActor, deliverableId: string) {
  const deliv = (
    await tx.query(
      `SELECT gd.attachment_id, p.owner_org_unit_id
         FROM rd.gate_deliverable gd
         JOIN rd.project_gate pg ON pg.id = gd.project_gate_id
         JOIN rd.project p ON p.id = pg.project_id
        WHERE gd.id = $1`,
      [deliverableId]
    )
  ).rows[0];
  if (!deliv?.attachment_id) throw notFound("file đính kèm");
  await authorize(tx, actor, "rd.view", deliv.owner_org_unit_id);
  return readAttachment(tx, deliv.attachment_id);
}

const specEvalSchema = z.object({
  category: z.string().trim().min(1).max(60).default("ANALYTICAL"),
  design_stage: z
    .enum(["USER_NEED", "DESIGN_INPUT", "DESIGN_OUTPUT", "VERIFICATION", "VALIDATION", "INPUT", "OUTPUT"])
    .default("DESIGN_INPUT")
    .transform((v) => (v === "INPUT" ? "DESIGN_INPUT" : v === "OUTPUT" ? "DESIGN_OUTPUT" : v)),
  parameter: z.string().trim().min(2, "nhập thông số thiết kế / TPP").max(200),
  unit: z.string().trim().max(40).optional().nullable(),
  baseline_value: z.string().trim().max(200).optional().nullable(),
  target_value: z.string().trim().min(1, "nhập chỉ tiêu mục tiêu").max(200),
  actual_value: z.string().trim().max(200).optional().nullable(),
  method_ref: z.string().trim().max(200).optional().nullable(),
  user_need_ref: z.string().trim().max(200).optional().nullable(),
  design_output_ref: z.string().trim().max(200).optional().nullable(),
  verification_experiment_id: z.string().uuid().optional().nullable(),
  validation_ref: z.string().trim().max(200).optional().nullable(),
  risk_item_id: z.string().uuid().optional().nullable(),
  result: z.enum(["PENDING", "PASS", "FAIL"]).default("PENDING"),
});

const STAGE_GATE_MAP: Record<string, number> = {
  USER_NEED: 0,
  INPUT: 1,
  DESIGN_INPUT: 1,
  OUTPUT: 2,
  DESIGN_OUTPUT: 2,
  VERIFICATION: 2,
  VALIDATION: 3,
};

async function isStageGatePassed(tx: Tx, projectId: string, designStage: string): Promise<boolean> {
  const baseGateNo = STAGE_GATE_MAP[designStage];
  if (baseGateNo === undefined) return false;
  const minRow = (
    await tx.query("SELECT min(gate_no)::int AS min_gate FROM rd.project_gate WHERE project_id = $1", [projectId])
  ).rows[0];
  const offset = Number(minRow?.min_gate ?? 0) >= 1 ? 1 : 0;
  const gate = (
    await tx.query("SELECT status FROM rd.project_gate WHERE project_id = $1 AND gate_no = $2", [
      projectId,
      baseGateNo + offset,
    ])
  ).rows[0];
  return gate?.status === "PASSED";
}

async function assertDhfEditable(tx: Tx, projectId: string) {
  const proj = (await tx.query("SELECT status, current_stage FROM rd.project WHERE id = $1", [projectId])).rows[0];
  if (!proj) throw notFound("dự án R&D");
  if (
    proj.status === "TRANSFERRED" ||
    (proj.status as string) === "COMPLETED" ||
    proj.status === "KILLED" ||
    proj.current_stage === "TRANSFERRED"
  ) {
    throw invalid(
      "Hồ sơ thiết kế (DHF) của giai đoạn đã phê duyệt không được phép chỉnh sửa trực tiếp.",
      undefined,
      "DHF_STAGE_FROZEN"
    );
  }
  const gates = (
    await tx.query("SELECT gate_no, status FROM rd.project_gate WHERE project_id = $1 ORDER BY gate_no ASC", [projectId])
  ).rows;
  if (gates.length > 0 && gates.every((g) => g.status === "PASSED")) {
    throw invalid(
      "Hồ sơ thiết kế (DHF) của giai đoạn đã phê duyệt không được phép chỉnh sửa trực tiếp.",
      undefined,
      "DHF_STAGE_FROZEN"
    );
  }
}

/** Saves a Design Input / Design Output / V&V Traceability Matrix (TPP) row for a project (ISO 13485 §7.3). */
export async function saveSpecEvaluation(tx: Tx, actor: AuthzActor, projectId: string, specId: string | null, input: unknown) {
  const proj = (
    await tx.query("SELECT owner_org_unit_id, target_domain FROM rd.project WHERE id = $1", [projectId])
  ).rows[0] as { owner_org_unit_id: string; target_domain: string } | undefined;
  if (!proj) throw notFound("dự án R&D");
  const canDeviceManage =
    proj.target_domain === "DEVICE" &&
    (await hasFactoryPermission(tx, actor, "device.model.manage", proj.owner_org_unit_id));
  if (!canDeviceManage) {
    await authorize(tx, actor, "rd.project.manage", proj.owner_org_unit_id);
  }
  await assertDhfEditable(tx, projectId);
  const d = parseInput(specEvalSchema, input);
  if (!specId && (await isStageGatePassed(tx, projectId, d.design_stage))) {
    throw invalid(
      "Hồ sơ thiết kế (DHF) của giai đoạn đã phê duyệt không được phép thêm mới trực tiếp.",
      undefined,
      "DHF_STAGE_FROZEN"
    );
  }
  if (!specId) {
    const row = (
      await tx.query(
        `INSERT INTO rd.spec_evaluation
           (project_id, category, design_stage, parameter, unit, baseline_value, target_value, actual_value,
            method_ref, user_need_ref, design_output_ref, verification_experiment_id, validation_ref, risk_item_id, result, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
        [
          projectId,
          d.category,
          d.design_stage,
          d.parameter,
          d.unit ?? null,
          d.baseline_value ?? null,
          d.target_value,
          d.actual_value ?? null,
          d.method_ref ?? null,
          d.user_need_ref ?? null,
          d.design_output_ref ?? null,
          d.verification_experiment_id ?? null,
          d.validation_ref ?? null,
          d.risk_item_id ?? null,
          d.result,
          actor.userId,
        ]
      )
    ).rows[0];
    await writeAudit(tx, actor, {
      entityType: "rd_spec_evaluation",
      entityId: row.id,
      action: "create",
      changes: { parameter: [null, d.parameter], target: [null, d.target_value], design_stage: [null, d.design_stage] },
    });
    return row;
  }
  const cur = (await tx.query("SELECT * FROM rd.spec_evaluation WHERE id = $1 AND project_id = $2 FOR UPDATE", [specId, projectId])).rows[0];
  if (!cur) throw notFound("thông số mục tiêu");
  if (await isStageGatePassed(tx, projectId, String(cur.design_stage))) {
    const coreChanged =
      d.parameter !== cur.parameter ||
      (d.unit ?? null) !== (cur.unit ?? null) ||
      d.target_value !== cur.target_value;
    const stageTargetFrozen =
      d.design_stage !== cur.design_stage && (await isStageGatePassed(tx, projectId, d.design_stage));
    if (coreChanged || stageTargetFrozen) {
      throw invalid(
        "Thông số mục tiêu (parameter / unit / target_value) của giai đoạn đã qua cổng không được phép chỉnh sửa trực tiếp.",
        undefined,
        "DHF_STAGE_FROZEN"
      );
    }
  }
  const upd = (
    await tx.query(
      `UPDATE rd.spec_evaluation
          SET category = $2, design_stage = $3, parameter = $4, unit = $5, baseline_value = $6, target_value = $7,
              actual_value = $8, method_ref = $9, user_need_ref = $10, design_output_ref = $11,
              verification_experiment_id = $12, validation_ref = $13, risk_item_id = $14, result = $15,
              updated_at = now(), updated_by = $16
        WHERE id = $1 RETURNING *`,
      [
        specId,
        d.category,
        d.design_stage,
        d.parameter,
        d.unit ?? null,
        d.baseline_value ?? null,
        d.target_value,
        d.actual_value ?? null,
        d.method_ref ?? null,
        d.user_need_ref ?? null,
        d.design_output_ref ?? null,
        d.verification_experiment_id ?? null,
        d.validation_ref ?? null,
        d.risk_item_id ?? null,
        d.result,
        actor.userId,
      ]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "rd_spec_evaluation",
    entityId: specId,
    action: "update",
    changes: {
      design_stage: [cur.design_stage, d.design_stage],
      actual_value: [cur.actual_value, d.actual_value ?? null],
      result: [cur.result, d.result],
    },
  });
  return upd;
}

const riskItemSchema = z.object({
  hazard: z.string().trim().min(2, "nhập mối nguy (Hazard)").max(500),
  hazardous_situation: z.string().trim().min(2, "nhập tình huống nguy hại").max(1000),
  harm: z.string().trim().min(2, "nhập tổn hại có thể xảy ra (Harm)").max(500),
  severity: z.coerce.number().int().min(1).max(5).default(3),
  occurrence: z.coerce.number().int().min(1).max(5).optional(),
  probability: z.coerce.number().int().min(1).max(5).optional(),
  detection: z.coerce.number().int().min(1).max(5).optional(),
  detectability: z.coerce.number().int().min(1).max(5).optional(),
  mitigation_measure: z.string().trim().max(2000).optional().nullable(),
  control_measure: z.string().trim().max(2000).optional().nullable(),
  residual_severity: z.coerce.number().int().min(1).max(5).optional().nullable(),
  residual_occurrence: z.coerce.number().int().min(1).max(5).optional().nullable(),
  residual_detection: z.coerce.number().int().min(1).max(5).optional().nullable(),
  status: z.enum(["OPEN", "MITIGATED", "ACCEPTED"]).default("OPEN"),
});

/** Saves or updates an ISO 14971 FMEA Risk Register item for an R&D project. */
export async function saveRiskItem(tx: Tx, actor: AuthzActor, projectId: string, riskId: string | null, input: unknown) {
  const owner = await projectOwner(tx, projectId);
  await authorize(tx, actor, "rd.project.manage", owner);
  await assertDhfEditable(tx, projectId);
  const d = parseInput(riskItemSchema, input);
  const occ = d.occurrence ?? d.probability ?? 2;
  const det = d.detection ?? d.detectability ?? 2;
  const mit = d.mitigation_measure ?? d.control_measure ?? null;
  if (!riskId) {
    const resSev = d.residual_severity ?? null;
    const resOcc = d.residual_occurrence ?? null;
    const resDet = d.residual_detection ?? null;
    if ((d.status === "MITIGATED" || d.status === "ACCEPTED") && (resSev == null || resOcc == null || resDet == null)) {
      throw invalid(
        "Phải nhập đầy đủ các chỉ số rủi ro tồn dư (residual_severity, residual_occurrence, residual_detection) trước khi đặt trạng thái MITIGATED hoặc ACCEPTED."
      );
    }
    const code = await nextNumber(tx, "RD_RISK");
    const row = (
      await tx.query(
        `INSERT INTO rd.risk_item
           (project_id, code, hazard, hazardous_situation, harm, severity, occurrence, detection,
            mitigation_measure, residual_severity, residual_occurrence, residual_detection,
            status, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14) RETURNING *`,
        [
          projectId,
          code,
          d.hazard,
          d.hazardous_situation,
          d.harm,
          d.severity,
          occ,
          det,
          mit,
          resSev,
          resOcc,
          resDet,
          d.status,
          actor.userId,
        ]
      )
    ).rows[0];
    await writeAudit(tx, actor, {
      entityType: "rd_risk_item",
      entityId: row.id,
      action: "create",
      changes: { code: [null, code], hazard: [null, d.hazard], rpn: [null, row.rpn] },
    });
    return row;
  }
  const cur = (await tx.query("SELECT * FROM rd.risk_item WHERE id = $1 AND project_id = $2 FOR UPDATE", [riskId, projectId])).rows[0];
  if (!cur) throw notFound("mục quản lý rủi ro ISO 14971");
  const nextResSev = d.residual_severity !== undefined ? d.residual_severity : cur.residual_severity;
  const nextResOcc = d.residual_occurrence !== undefined ? d.residual_occurrence : cur.residual_occurrence;
  const nextResDet = d.residual_detection !== undefined ? d.residual_detection : cur.residual_detection;
  if ((d.status === "MITIGATED" || d.status === "ACCEPTED") && (nextResSev == null || nextResOcc == null || nextResDet == null)) {
    throw invalid(
      "Phải nhập đầy đủ các chỉ số rủi ro tồn dư (residual_severity, residual_occurrence, residual_detection) trước khi đặt trạng thái MITIGATED hoặc ACCEPTED."
    );
  }
  const upd = (
    await tx.query(
      `UPDATE rd.risk_item
          SET hazard = $2, hazardous_situation = $3, harm = $4, severity = $5, occurrence = $6, detection = $7,
              mitigation_measure = $8, residual_severity = $9, residual_occurrence = $10, residual_detection = $11,
              status = $12, version = version + 1, updated_at = now(), updated_by = $13
        WHERE id = $1 RETURNING *`,
      [
        riskId,
        d.hazard,
        d.hazardous_situation,
        d.harm,
        d.severity,
        occ,
        det,
        mit,
        nextResSev,
        nextResOcc,
        nextResDet,
        d.status,
        actor.userId,
      ]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "rd_risk_item",
    entityId: riskId,
    action: "update",
    changes: { status: [cur.status, d.status], rpn: [cur.rpn, upd.rpn], mitigation_measure: [cur.mitigation_measure, mit] },
  });
  return upd;
}

const milestoneSchema = z.object({
  title: z.string().trim().min(2, "nhập tên cột mốc").max(250),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "chọn hạn cột mốc"),
  status: z.enum(["PLANNED", "DONE", "DELAYED", "CANCELLED"]).default("PLANNED"),
  tags: z.array(z.string().trim().max(40)).max(10).default([]),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export async function saveMilestone(tx: Tx, actor: AuthzActor, projectId: string, milestoneId: string | null, input: unknown) {
  const owner = await projectOwner(tx, projectId);
  await authorize(tx, actor, "rd.project.manage", owner);
  const d = parseInput(milestoneSchema, input);
  if (!milestoneId) {
    return insertRecord(tx, actor, "rd.roadmap_milestone", "rd_milestone", {
      project_id: projectId,
      title: d.title,
      due_date: d.due_date,
      status: d.status,
      tags: d.tags,
      notes: d.notes ?? null,
    });
  }
  const cur = (await tx.query("SELECT * FROM rd.roadmap_milestone WHERE id = $1 AND project_id = $2 FOR UPDATE", [milestoneId, projectId])).rows[0];
  if (!cur) throw notFound("cột mốc");
  const upd = (
    await tx.query(
      "UPDATE rd.roadmap_milestone SET title = $2, due_date = $3, status = $4, tags = $5, notes = $6, updated_at = now(), updated_by = $7 WHERE id = $1 RETURNING *",
      [milestoneId, d.title, d.due_date, d.status, d.tags, d.notes ?? null, actor.userId]
    )
  ).rows[0];
  await writeAudit(tx, actor, { entityType: "rd_milestone", entityId: milestoneId, action: "update", changes: { status: [cur.status, d.status], due_date: [cur.due_date, d.due_date] } });
  return upd;
}

/** Exports all active roadmap milestones visible to the user as an RFC 5545 `.ics` calendar string. */
export async function exportRoadmapIcs(tx: Tx, actor: AuthzActor, projectId?: string): Promise<string> {
  await authorizeAnywhere(tx, actor, "rd.view");
  const rows = (
    await tx.query(
      `SELECT m.id, m.title, m.due_date::text AS due_date, m.status, m.notes, p.code AS project_code, p.name AS project_name, p.owner_org_unit_id
         FROM rd.roadmap_milestone m JOIN rd.project p ON p.id = m.project_id
        WHERE ($1::uuid IS NULL OR m.project_id = $1) AND m.status <> 'CANCELLED'
        ORDER BY m.due_date ASC`,
      [projectId ?? null]
    )
  ).rows;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ABT Biolab//R&D Roadmap//VI",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const r of rows) {
    if (!(await hasFactoryPermission(tx, actor, "rd.view", r.owner_org_unit_id))) continue;
    const dt = r.due_date.replace(/-/g, "");
    const summary = `[${r.project_code}] ${r.title} (${r.status})`.replace(/[\r\n,;]/g, " ");
    const desc = `${r.project_name}${r.notes ? " - " + r.notes : ""}`.replace(/[\r\n,;]/g, " ");
    lines.push(
      "BEGIN:VEVENT",
      `UID:rd-milestone-${r.id}@abt.vn`,
      `DTSTAMP:${dt}T010000Z`,
      `DTSTART;VALUE=DATE:${dt}`,
      `DTEND;VALUE=DATE:${dt}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${desc}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export interface ListProjectsFilter {
  domain?: string | null;
  activeOnly?: boolean;
  performer?: string | null;
}

const normName = (s?: string | null) => (s || "").trim().replace(/\s+/g, " ").toLowerCase();

export async function listProjects(tx: Tx, actor: AuthzActor, domainOrFilter?: string | ListProjectsFilter) {
  await authorizeAnywhere(tx, actor, "rd.view");
  const filter: ListProjectsFilter =
    typeof domainOrFilter === "string" ? { domain: domainOrFilter } : domainOrFilter ?? {};
  const domain = filter.domain || null;
  const rows = (
    await tx.query(
      `SELECT p.*,
              u.name AS org_unit_name,
              coalesce(nullif(p.leader_name_override, ''), l.display_name) AS leader_name,
              t.name AS template_name,
              (SELECT count(*)::int FROM rd.project_gate g WHERE g.project_id = p.id) AS total_gates,
              (SELECT count(*)::int FROM rd.project_gate g WHERE g.project_id = p.id AND g.status = 'PASSED') AS passed_gates,
              (SELECT count(*)::int FROM rd.experiment e WHERE e.project_id = p.id) AS experiment_count,
              ${immutableHandoffSql("p.id")} AS has_immutable_handoff,
              coalesce((
                SELECT jsonb_agg(DISTINCT nm)
                  FROM (
                    SELECT trim(pt.assignee_name) AS nm
                      FROM rd.project_task pt
                     WHERE pt.project_id = p.id AND pt.assignee_name IS NOT NULL AND trim(pt.assignee_name) <> ''
                    UNION
                    SELECT trim(up.display_name) AS nm
                      FROM rd.project_member pm
                      JOIN core.user_profile up ON up.user_id = pm.user_id
                     WHERE pm.project_id = p.id
                       AND pm.role_in_project <> 'LEADER'
                       AND up.display_name IS NOT NULL AND trim(up.display_name) <> ''
                  ) sub
              ), '[]'::jsonb) AS assignees
         FROM rd.project p
         JOIN core.org_unit u ON u.id = p.owner_org_unit_id
         LEFT JOIN core.user_profile l ON l.user_id = p.leader_id
         LEFT JOIN rd.gate_template t ON t.id = p.gate_template_id
        WHERE ($1::text IS NULL OR p.target_domain = $1)
        ORDER BY p.created_at DESC LIMIT 200`,
      [domain]
    )
  ).rows;

  const targetPerformer = normName(filter.performer);
  const visible = [];
  for (const r of rows) {
    if (!(await hasFactoryPermission(tx, actor, "rd.view", r.owner_org_unit_id))) continue;
    if (filter.activeOnly && r.status !== "ACTIVE") continue;
    if (targetPerformer) {
      const assignees: string[] = Array.isArray(r.assignees) ? r.assignees : [];
      const matches =
        normName(r.leader_name) === targetPerformer ||
        assignees.some((a) => normName(a) === targetPerformer);
      if (!matches) continue;
    }
    visible.push(r);
  }
  return visible;
}

export async function getProjectDetail(tx: Tx, actor: AuthzActor, id: string) {
  const project = (
    await tx.query(
      `SELECT p.*, u.name AS org_unit_name,
              coalesce(nullif(p.leader_name_override, ''), l.display_name) AS leader_name,
              t.code AS template_code, t.name AS template_name,
              i.code AS idea_code, i.title AS idea_title
         FROM rd.project p
         JOIN core.org_unit u ON u.id = p.owner_org_unit_id
         LEFT JOIN core.user_profile l ON l.user_id = p.leader_id
         LEFT JOIN rd.gate_template t ON t.id = p.gate_template_id
         LEFT JOIN rd.idea i ON i.id = p.idea_id
        WHERE p.id = $1`,
      [id]
    )
  ).rows[0];
  if (!project) throw notFound("dự án R&D");
  await authorize(tx, actor, "rd.view", project.owner_org_unit_id);

  const gates = (
    await tx.query(
      `SELECT g.*, sb.display_name AS submitted_by_name, db.display_name AS decided_by_name
         FROM rd.project_gate g
         LEFT JOIN core.user_profile sb ON sb.user_id = g.submitted_by
         LEFT JOIN core.user_profile db ON db.user_id = g.decided_by
        WHERE g.project_id = $1 ORDER BY g.gate_no ASC`,
      [id]
    )
  ).rows;
  for (const g of gates) {
    g.deliverables = (
      await tx.query(
        `SELECT gd.*, a.file_name AS attachment_name, rb.display_name AS reviewed_by_name
           FROM rd.gate_deliverable gd
           LEFT JOIN core.attachment a ON a.id = gd.attachment_id
           LEFT JOIN core.user_profile rb ON rb.user_id = gd.reviewed_by
          WHERE gd.project_gate_id = $1 ORDER BY gd.seq ASC`,
        [g.id]
      )
    ).rows;
    g.actions = await listAllowedActions(tx, projectGateMachine, actor, g);
  }

  const specs = (
    await tx.query(
      `SELECT se.*, e.code AS verification_experiment_code, ri.code AS risk_code, ri.rpn AS risk_rpn
         FROM rd.spec_evaluation se
         LEFT JOIN rd.experiment e ON e.id = se.verification_experiment_id
         LEFT JOIN rd.risk_item ri ON ri.id = se.risk_item_id
        WHERE se.project_id = $1 ORDER BY se.category, se.parameter`,
      [id]
    )
  ).rows;
  const risks = (
    await tx.query("SELECT * FROM rd.risk_item WHERE project_id = $1 ORDER BY rpn DESC, code ASC", [id])
  ).rows;
  const milestones = (await tx.query("SELECT * FROM rd.roadmap_milestone WHERE project_id = $1 ORDER BY due_date ASC", [id])).rows;
  const members = (
    await tx.query(
      `SELECT pm.*, up.display_name FROM rd.project_member pm JOIN core.user_profile up ON up.user_id = pm.user_id WHERE pm.project_id = $1 ORDER BY pm.created_at`,
      [id]
    )
  ).rows;
  const actions = await listAllowedActions(tx, projectMachine, actor, project);
  const hasImmutableHandoff = await hasImmutableProjectHandoff(tx, id);
  return { ...project, has_immutable_handoff: hasImmutableHandoff, gates, specs, risks, milestones, members, actions };
}

const optDate = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "định dạng ngày YYYY-MM-DD").nullable().optional()
);

const updateProjectSchema = z.object({
  name: z.string().trim().min(3, "nhập tên dự án (tối thiểu 3 ký tự)").max(300).optional(),
  project_type: z.enum(["NEW_PRODUCT", "IMPROVEMENT", "PROCESS", "RESEARCH"]).optional(),
  target_domain: z.enum(["KIT", "OLIGO", "DEVICE", "SOFTWARE", "OTHER"]).optional(),
  ivd_class: z.enum(["CLASS_A", "CLASS_B", "CLASS_C", "CLASS_D", "RUO", "NA"]).nullable().optional(),
  leader_id: z.coerce.number().int().positive().optional(),
  leader_name_override: z.string().trim().max(150).nullable().optional(),
  budget_amount: z.coerce.number().min(0, "ngân sách phải >= 0").nullable().optional(),
  planned_start: optDate,
  planned_end: optDate,
  description: z.string().trim().max(4000).nullable().optional(),
  status: z.enum(["ACTIVE", "ON_HOLD", "KILLED", "TRANSFERRED"]).optional(),
  reason: z.string().trim().max(1000).optional().nullable(),
  version: z.coerce.number().int().nonnegative().optional(),
});

function fmtIsoDate(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10);
}

/**
 * Edits R&D project metadata (and optionally status among ACTIVE / ON_HOLD / KILLED, or reverting an
 * accidental TRANSFERRED when no immutable downstream handoff exists) under `rd.project.edit`.
 */
export async function updateProject(tx: Tx, actor: AuthzActor, id: string, input: unknown) {
  const d = parseInput(updateProjectSchema, input);
  const cur = (await tx.query("SELECT * FROM rd.project WHERE id = $1 FOR UPDATE", [id])).rows[0] as
    | (ProjectRow & { leader_name_override?: string | null; budget_amount?: string | number | null })
    | undefined;
  if (!cur) throw notFound("dự án R&D");

  if (!actor.isRootAdmin && !actor.isSystem) {
    await authorize(tx, actor, "rd.project.edit", cur.owner_org_unit_id);
  }
  if (d.version !== undefined && cur.version !== d.version) {
    throw conflict("Dự án vừa được người khác thay đổi. Tải lại trang rồi thử lại.", "STALE_VERSION");
  }
  if (cur.status === "TRANSFERRED" && d.status !== undefined && d.status !== "TRANSFERRED") {
    if (await hasImmutableProjectHandoff(tx, id)) {
      throw conflict("Dự án đã có hồ sơ chuyển giao công nghệ / phát hành phần mềm không thể hạ trạng thái.");
    }
  }

  const nextStart = d.planned_start === undefined ? fmtIsoDate(cur.planned_start) : d.planned_start;
  const nextEnd = d.planned_end === undefined ? fmtIsoDate(cur.planned_end) : d.planned_end;
  if (nextStart && nextEnd && nextEnd < nextStart) {
    throw invalid("Ngày kết thúc dự kiến không được nhỏ hơn ngày bắt đầu.");
  }

  if (d.leader_id !== undefined) {
    const prof = await tx.query("SELECT 1 FROM core.user_profile WHERE user_id = $1", [d.leader_id]);
    if (!prof.rowCount) throw notFound("nhân sự chủ nhiệm đề tài");
  }

  const nextStatus = d.status ?? cur.status;
  const isRevertingTransfer = cur.status === "TRANSFERRED" && nextStatus !== "TRANSFERRED";
  let restoredStage = cur.current_stage;
  if (isRevertingTransfer && cur.current_stage === "TRANSFERRED") {
    const lastPassed = (
      await tx.query(
        "SELECT stage_after FROM rd.project_gate WHERE project_id = $1 AND status = 'PASSED' ORDER BY gate_no DESC LIMIT 1",
        [id]
      )
    ).rows[0];
    restoredStage = lastPassed?.stage_after ?? "G0_CONCEPT";
  }

  const curNormalized: Record<string, unknown> = {
    name: cur.name,
    project_type: cur.project_type,
    target_domain: cur.target_domain,
    ivd_class: cur.ivd_class ?? null,
    leader_id: cur.leader_id,
    leader_name_override: cur.leader_name_override?.trim() || null,
    budget_amount: cur.budget_amount != null ? Number(cur.budget_amount) : 50000000,
    planned_start: fmtIsoDate(cur.planned_start),
    planned_end: fmtIsoDate(cur.planned_end),
    description: cur.description ?? null,
    status: cur.status,
    ...(isRevertingTransfer
      ? {
          current_stage: cur.current_stage,
          actual_transfer_date: fmtIsoDate(cur.actual_transfer_date),
        }
      : {}),
  };

  const nextNormalized: Record<string, unknown> = {
    name: d.name ?? curNormalized.name,
    project_type: d.project_type ?? curNormalized.project_type,
    target_domain: d.target_domain ?? curNormalized.target_domain,
    ivd_class: d.ivd_class === undefined ? curNormalized.ivd_class : d.ivd_class,
    leader_id: d.leader_id ?? curNormalized.leader_id,
    leader_name_override:
      d.leader_name_override === undefined ? curNormalized.leader_name_override : d.leader_name_override?.trim() || null,
    budget_amount:
      d.budget_amount === undefined ? curNormalized.budget_amount : d.budget_amount === null ? 0 : d.budget_amount,
    planned_start: nextStart,
    planned_end: nextEnd,
    description: d.description === undefined ? curNormalized.description : d.description?.trim() || null,
    status: nextStatus,
    ...(isRevertingTransfer
      ? {
          current_stage: restoredStage,
          actual_transfer_date: null,
        }
      : {}),
  };

  const fields = Object.keys(curNormalized);
  const changes = diffChanges(curNormalized, nextNormalized, fields);
  const changedFields = Object.keys(changes);

  if (changedFields.length > 0) {
    const sets = changedFields.map((col, idx) => `${col} = $${idx + 2}`);
    await tx.query(
      `UPDATE rd.project
          SET ${sets.join(", ")},
              version = version + 1,
              updated_at = now(),
              updated_by = $${changedFields.length + 2}
        WHERE id = $1`,
      [id, ...changedFields.map((col) => nextNormalized[col]), actor.userId]
    );
    await writeAudit(tx, actor, {
      entityType: "rd_project",
      entityId: id,
      action: "update",
      changes,
      reason: d.reason ?? null,
    });
  }

  return getProjectDetail(tx, actor, id);
}

/**
 * Deletes an R&D project safely with strict GxP/ISO 13485 immutability guards and audit logging.
 * Any linked ELN experiments are detached into Standalone ELN (`project_id = NULL`, retaining `org_unit_id`)
 * so ALCOA+ notebooks and stock ledger history are never lost.
 */
export async function deleteProject(tx: Tx, actor: AuthzActor, id: string, input: unknown) {
  const { reason } = parseInput(
    z.object({ reason: z.string().trim().min(3, "Vui lòng nhập lý do xóa dự án (tối thiểu 3 ký tự)").max(1000) }),
    input
  );
  const cur = (await tx.query("SELECT * FROM rd.project WHERE id = $1 FOR UPDATE", [id])).rows[0] as ProjectRow | undefined;
  if (!cur) throw notFound("dự án R&D");

  if (!actor.isRootAdmin && !actor.isSystem) {
    await authorize(tx, actor, "rd.project.delete", cur.owner_org_unit_id);
  }

  const hasNonDraftTransfer = await tx.query(
    "SELECT 1 FROM rd.tech_transfer_package WHERE project_id = $1 AND status <> 'DRAFT' LIMIT 1",
    [id]
  );
  if (hasNonDraftTransfer.rowCount) {
    throw conflict("Không thể xóa dự án đã gửi hoặc nghiệm thu Hồ sơ Chuyển giao Công nghệ.");
  }
  const hasNonDraftSwRelease = await tx.query(
    "SELECT 1 FROM rd.software_release WHERE project_id = $1 AND status <> 'DRAFT' LIMIT 1",
    [id]
  );
  if (hasNonDraftSwRelease.rowCount) {
    throw conflict("Không thể xóa dự án đã phát hành phiên bản phần mềm (Software Release).");
  }
  const hasCommercialDevice = await tx.query(
    "SELECT 1 FROM device.device_model WHERE rd_project_id = $1 AND status = 'COMMERCIAL' LIMIT 1",
    [id]
  );
  if (hasCommercialDevice.rowCount) {
    throw conflict("Không thể xóa dự án đang gắn với Dòng thiết bị thương mại (COMMERCIAL).");
  }
  const hasImmutableSwRun = await tx.query(
    `SELECT 1 FROM rd.sw_test_run tr
       JOIN rd.sw_test_case tc ON tc.id = tr.test_case_id
      WHERE tc.project_id = $1 LIMIT 1`,
    [id]
  );
  if (hasImmutableSwRun.rowCount) {
    throw conflict("Không thể xóa dự án đã có bản ghi chạy kiểm thử phần mềm bất biến (IEC 62304 Test Run).");
  }

  // Detach nullable links (preserving ALCOA+ ELNs, Biobank samples, and weekly work plans)
  await tx.query(
    "UPDATE rd.experiment SET project_id = NULL, org_unit_id = COALESCE(org_unit_id, $2) WHERE project_id = $1",
    [id, cur.owner_org_unit_id]
  );
  await tx.query("UPDATE rd.sample SET project_id = NULL WHERE project_id = $1", [id]);
  await tx.query("UPDATE work.work_task SET project_id = NULL WHERE project_id = $1", [id]);
  await tx.query("UPDATE device.device_model SET rd_project_id = NULL WHERE rd_project_id = $1", [id]);

  // Delete owned children in strict FK order
  await tx.query("DELETE FROM rd.project_task WHERE project_id = $1", [id]);
  await tx.query("DELETE FROM rd.project_material_ledger WHERE project_id = $1", [id]);
  await tx.query("DELETE FROM rd.project_prototype_bom WHERE project_id = $1", [id]);
  await tx.query(
    "DELETE FROM rd.gate_deliverable USING rd.project_gate pg WHERE pg.id = rd.gate_deliverable.project_gate_id AND pg.project_id = $1",
    [id]
  );
  await tx.query("DELETE FROM rd.project_gate WHERE project_id = $1", [id]);
  await tx.query("DELETE FROM rd.project_member WHERE project_id = $1", [id]);
  await tx.query("DELETE FROM rd.spec_evaluation WHERE project_id = $1", [id]);
  await tx.query("DELETE FROM rd.sw_test_case WHERE project_id = $1", [id]);
  await tx.query("DELETE FROM rd.sw_requirement WHERE project_id = $1", [id]);
  await tx.query("DELETE FROM rd.sw_problem WHERE project_id = $1", [id]);
  await tx.query("DELETE FROM rd.risk_item WHERE project_id = $1", [id]);
  await tx.query("DELETE FROM rd.roadmap_milestone WHERE project_id = $1", [id]);
  await tx.query("DELETE FROM rd.tech_transfer_package WHERE project_id = $1", [id]);
  await tx.query("DELETE FROM rd.software_release WHERE project_id = $1", [id]);
  await tx.query("DELETE FROM rd.project WHERE id = $1", [id]);

  if (cur.idea_id) {
    const otherProj = await tx.query("SELECT 1 FROM rd.project WHERE idea_id = $1 LIMIT 1", [cur.idea_id]);
    if (!otherProj.rowCount) {
      await tx.query("UPDATE rd.idea SET status = 'APPROVED', version = version + 1 WHERE id = $1 AND status = 'CONVERTED'", [cur.idea_id]);
    }
  }

  await writeAudit(tx, actor, {
    entityType: "rd_project",
    entityId: id,
    action: "delete",
    changes: {
      deleted: [false, true],
      code: [cur.code, null],
      name: [cur.name, null],
      status: [cur.status, null],
    },
    reason,
  });

  return { deleted: true, id, code: cur.code };
}

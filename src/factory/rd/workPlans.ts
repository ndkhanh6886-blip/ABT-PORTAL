import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, hasFactoryPermission, type AuthzActor } from "../core/authz";
import { conflict, invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { insertRecord, parseInput } from "../core/records";
import { defineMachine, listAllowedActions } from "../core/stateMachine";
import "./permissions";

export type WorkPlanStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "NEEDS_REVISION" | "CLOSED";
export type WorkTaskStatus = "PLANNED" | "IN_PROGRESS" | "DONE" | "DEFERRED" | "REPLACED";

export interface WorkPlanRow {
  id: string;
  code: string;
  user_id: number;
  org_unit_id: string;
  week_start: string;
  summary_notes: string | null;
  status: WorkPlanStatus;
  submitted_at: string | null;
  approved_by: number | null;
  approved_at: string | null;
  review_note: string | null;
  version: number;
}

export interface WorkTaskRow {
  id: string;
  plan_id: string;
  title: string;
  day_of_week: number;
  time_slot: string;
  project_id: string | null;
  experiment_id: string | null;
  target_metric: string | null;
  is_unplanned: boolean;
  status: WorkTaskStatus;
  result_summary: string | null;
  efficiency_rating: number | null;
  manager_comment: string | null;
  defer_category: "OBJECTIVE" | "SUBJECTIVE" | null;
  defer_reason: string | null;
  replaced_by_task_id: string | null;
  version: number;
}

/**
 * Weekly Work Plan state machine (docs/nha-may/02 §6.1):
 * DRAFT → PENDING_APPROVAL (submit) → APPROVED (approve) | NEEDS_REVISION (return 📝) → CLOSED (close).
 * Strict separation of duties: manager approving the plan must not be the plan's owner.
 */
export const workPlanMachine = defineMachine<WorkPlanStatus, WorkPlanRow>({
  entityType: "work_plan",
  table: "work.work_plan",
  states: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "NEEDS_REVISION", "CLOSED"],
  terminal: ["CLOSED"],
  scopeOf: (row) => row.org_unit_id,
  transitions: [
    {
      action: "submit",
      from: ["DRAFT", "NEEDS_REVISION"],
      to: "PENDING_APPROVAL",
      permission: "work.plan.submit",
      guards: [
        {
          code: "ONLY_OWNER",
          message: "Chỉ chính nhân sự lập kế hoạch tuần mới được gửi duyệt kế hoạch của mình.",
          check: ({ actor, row }) => row.user_id === actor.userId,
        },
        {
          code: "NO_TASKS",
          message: "Kế hoạch tuần phải có ít nhất một công việc dự kiến trước khi gửi duyệt.",
          check: async ({ tx, row }) => {
            const c = await tx.query("SELECT 1 FROM work.work_task WHERE plan_id = $1 LIMIT 1", [row.id]);
            return (c.rowCount ?? 0) > 0;
          },
        },
      ],
      patch: () => ({ submitted_at: new Date() }),
    },
    {
      action: "approve",
      from: "PENDING_APPROVAL",
      to: "APPROVED",
      permission: "work.plan.approve",
      guards: [
        {
          code: "SELF_APPROVAL",
          message: "Người phê duyệt kế hoạch tuần phải khác người lập kế hoạch.",
          check: ({ actor, row }) => row.user_id !== actor.userId,
        },
      ],
      patch: ({ actor, payload }) => ({
        approved_by: actor.userId,
        approved_at: new Date(),
        review_note: (payload.review_note as string) || null,
      }),
    },
    {
      action: "return",
      from: "PENDING_APPROVAL",
      to: "NEEDS_REVISION",
      permission: "work.plan.approve",
      reasonRequired: true,
      patch: ({ reason }) => ({ review_note: reason }),
    },
    {
      action: "close",
      from: "APPROVED",
      to: "CLOSED",
      permission: "work.plan.approve",
      guards: [
        {
          code: "OPEN_TASKS",
          message: "Tất cả công việc trong kế hoạch tuần phải đã hoàn thành (DONE), hoãn (DEFERRED) hoặc thay thế (REPLACED) trước khi đóng tuần.",
          check: async ({ tx, row }) => {
            const open = await tx.query(
              "SELECT 1 FROM work.work_task WHERE plan_id = $1 AND status IN ('PLANNED', 'IN_PROGRESS') LIMIT 1",
              [row.id]
            );
            return !open.rowCount;
          },
        },
      ],
    },
  ],
});

const createPlanSchema = z.object({
  org_unit_id: z.string().uuid("chọn phòng"),
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "chọn ngày đầu tuần (thứ Hai YYYY-MM-DD)"),
  summary_notes: z.string().trim().max(2000).optional().nullable(),
});

export async function createOrGetWorkPlan(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(createPlanSchema, input);
  await authorize(tx, actor, "work.plan.submit", d.org_unit_id);
  const existing = (
    await tx.query("SELECT id FROM work.work_plan WHERE user_id = $1 AND week_start = $2", [actor.userId, d.week_start])
  ).rows[0];
  if (existing) return getWorkPlanDetail(tx, actor, existing.id);

  const code = await nextNumber(tx, "WORK_PLAN");
  const plan = await insertRecord<WorkPlanRow>(tx, actor, "work.work_plan", "work_plan", {
    code,
    user_id: actor.userId,
    org_unit_id: d.org_unit_id,
    week_start: d.week_start,
    summary_notes: d.summary_notes ?? null,
  });
  return getWorkPlanDetail(tx, actor, plan.id);
}

const addTaskSchema = z.object({
  title: z.string().trim().min(2, "nhập nội dung công việc").max(300),
  day_of_week: z.coerce.number().int().min(1).max(7).default(1),
  time_slot: z.string().trim().max(40).default("ALL_DAY"),
  project_id: z.string().uuid().optional().nullable(),
  experiment_id: z.string().uuid().optional().nullable(),
  target_metric: z.string().trim().max(300).optional().nullable(),
});

/**
 * Adds a task to a weekly work plan (docs/nha-may/02 §6.1):
 * - When the plan is `DRAFT` or `NEEDS_REVISION`, `is_unplanned = false`.
 * - When the plan is `APPROVED`, new tasks are still allowed but automatically marked `is_unplanned = true` ("Phát sinh").
 * - Locked when `PENDING_APPROVAL` or `CLOSED`.
 */
export async function addWorkTask(tx: Tx, actor: AuthzActor, planId: string, input: unknown) {
  const d = parseInput(addTaskSchema, input);
  const plan = (await tx.query("SELECT * FROM work.work_plan WHERE id = $1 FOR UPDATE", [planId])).rows[0] as WorkPlanRow | undefined;
  if (!plan) throw notFound("kế hoạch tuần");
  await authorize(tx, actor, "work.plan.submit", plan.org_unit_id);
  if (plan.user_id !== actor.userId && !(await hasFactoryPermission(tx, actor, "work.plan.approve", plan.org_unit_id))) {
    throw invalid("Chỉ chủ sở hữu kế hoạch hoặc quản lý mới được thêm công việc.");
  }
  if (!["DRAFT", "NEEDS_REVISION", "APPROVED"].includes(plan.status)) {
    throw invalid(`Không thể thêm công việc khi kế hoạch tuần đang ở trạng thái ${plan.status}.`);
  }
  const isUnplanned = plan.status === "APPROVED";
  return insertRecord<WorkTaskRow>(tx, actor, "work.work_task", "work_task", {
    plan_id: planId,
    title: d.title,
    day_of_week: d.day_of_week,
    time_slot: d.time_slot,
    project_id: d.project_id ?? null,
    experiment_id: d.experiment_id ?? null,
    target_metric: d.target_metric ?? null,
    is_unplanned: isUnplanned,
  });
}

const taskActionSchema = z.object({
  action: z.enum(["start", "complete", "defer", "replace", "rate"]),
  version: z.coerce.number().int().min(0),
  result_summary: z.string().trim().max(2000).optional().nullable(),
  defer_category: z.enum(["OBJECTIVE", "SUBJECTIVE"]).optional().nullable(),
  defer_reason: z.string().trim().max(1000).optional().nullable(),
  replacement_title: z.string().trim().max(300).optional().nullable(),
  efficiency_rating: z.coerce.number().int().min(1).max(5).optional().nullable(),
  manager_comment: z.string().trim().max(2000).optional().nullable(),
});

/**
 * Executes a work task transition (docs/nha-may/02 §6.2):
 * - Recording execution (`start`, `complete`, `defer`, `replace`) is allowed ONLY when the parent `work_plan` is `APPROVED`.
 * - `complete` requires a non-empty `result_summary`.
 * - `defer` requires both `defer_category` (`OBJECTIVE` / `SUBJECTIVE`) and `defer_reason`.
 * - `replace` creates the replacement task and links `replaced_by_task_id`.
 * - `rate` allows a manager (`work.plan.approve`) to score efficiency (1–5) and leave a comment on a `DONE` task.
 */
export async function updateWorkTaskAction(tx: Tx, actor: AuthzActor, taskId: string, input: unknown) {
  const d = parseInput(taskActionSchema, input);
  const task = (await tx.query("SELECT * FROM work.work_task WHERE id = $1 FOR UPDATE", [taskId])).rows[0] as WorkTaskRow | undefined;
  if (!task) throw notFound("công việc trong kế hoạch tuần");
  const plan = (await tx.query("SELECT * FROM work.work_plan WHERE id = $1", [task.plan_id])).rows[0] as WorkPlanRow;
  if (task.version !== d.version) {
    throw conflict("Công việc vừa được thay đổi. Vui lòng tải lại.", "STALE_VERSION");
  }

  if (d.action === "rate") {
    await authorize(tx, actor, "work.plan.approve", plan.org_unit_id);
    if (task.status !== "DONE") throw invalid("Chỉ chấm điểm hiệu quả cho công việc đã hoàn thành (DONE).");
    if (d.efficiency_rating == null) throw invalid("Chọn mức điểm hiệu quả (1–5).");
    const upd = (
      await tx.query(
        "UPDATE work.work_task SET efficiency_rating = $2, manager_comment = $3, version = version + 1, updated_at = now(), updated_by = $4 WHERE id = $1 RETURNING *",
        [taskId, d.efficiency_rating, d.manager_comment ?? null, actor.userId]
      )
    ).rows[0];
    await writeAudit(tx, actor, {
      entityType: "work_task",
      entityId: taskId,
      action: "rate",
      changes: { efficiency_rating: [task.efficiency_rating, d.efficiency_rating] },
      reason: d.manager_comment ?? null,
    });
    return upd;
  }

  // Staff actions: start, complete, defer, replace
  await authorize(tx, actor, "work.plan.submit", plan.org_unit_id);
  if (plan.status !== "APPROVED") {
    throw invalid("Chỉ được bắt đầu, ghi kết quả hoặc báo hoãn khi kế hoạch tuần đã được phê duyệt (APPROVED).", undefined, "PLAN_NOT_APPROVED");
  }

  if (d.action === "start") {
    if (task.status !== "PLANNED") throw invalid("Chỉ bắt đầu công việc đang ở trạng thái PLANNED.");
    const upd = (
      await tx.query("UPDATE work.work_task SET status = 'IN_PROGRESS', version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $1 RETURNING *", [
        taskId,
        actor.userId,
      ])
    ).rows[0];
    await writeAudit(tx, actor, { entityType: "work_task", entityId: taskId, action: "start", changes: { status: [task.status, "IN_PROGRESS"] } });
    return upd;
  }

  if (d.action === "complete") {
    if (!["PLANNED", "IN_PROGRESS"].includes(task.status)) throw invalid("Không thể hoàn thành công việc ở trạng thái này.");
    if (!d.result_summary || d.result_summary.length < 3) {
      throw invalid("Bắt buộc nhập kết quả thực hiện (result_summary) khi hoàn thành công việc.");
    }
    const upd = (
      await tx.query(
        "UPDATE work.work_task SET status = 'DONE', result_summary = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1 RETURNING *",
        [taskId, d.result_summary, actor.userId]
      )
    ).rows[0];
    await writeAudit(tx, actor, {
      entityType: "work_task",
      entityId: taskId,
      action: "complete",
      changes: { status: [task.status, "DONE"], result_summary: [task.result_summary, d.result_summary] },
    });
    return upd;
  }

  if (d.action === "defer") {
    if (!["PLANNED", "IN_PROGRESS"].includes(task.status)) throw invalid("Chỉ hoãn công việc đang PLANNED hoặc IN_PROGRESS.");
    if (!d.defer_category || !d.defer_reason || d.defer_reason.length < 3) {
      throw invalid("Hoãn việc bắt buộc chọn phân loại nguyên nhân (Khách quan / Chủ quan) và nhập lý do cụ thể.");
    }
    const upd = (
      await tx.query(
        "UPDATE work.work_task SET status = 'DEFERRED', defer_category = $2, defer_reason = $3, version = version + 1, updated_at = now(), updated_by = $4 WHERE id = $1 RETURNING *",
        [taskId, d.defer_category, d.defer_reason, actor.userId]
      )
    ).rows[0];
    await writeAudit(tx, actor, {
      entityType: "work_task",
      entityId: taskId,
      action: "defer",
      changes: { status: [task.status, "DEFERRED"], defer_category: [null, d.defer_category] },
      reason: d.defer_reason,
    });
    return upd;
  }

  // d.action === "replace"
  if (!["PLANNED", "DEFERRED"].includes(task.status)) throw invalid("Chỉ thay thế công việc đang PLANNED hoặc DEFERRED.");
  if (!d.replacement_title || d.replacement_title.length < 2) throw invalid("Nhập tiêu đề công việc thay thế.");
  const replacement = await insertRecord<WorkTaskRow>(tx, actor, "work.work_task", "work_task", {
    plan_id: task.plan_id,
    title: d.replacement_title,
    day_of_week: task.day_of_week,
    time_slot: task.time_slot,
    project_id: task.project_id,
    experiment_id: task.experiment_id,
    is_unplanned: true,
  });
  const upd = (
    await tx.query(
      "UPDATE work.work_task SET status = 'REPLACED', replaced_by_task_id = $2, defer_reason = $3, version = version + 1, updated_at = now(), updated_by = $4 WHERE id = $1 RETURNING *",
      [taskId, replacement.id, d.defer_reason ?? null, actor.userId]
    )
  ).rows[0];
  await writeAudit(tx, actor, {
    entityType: "work_task",
    entityId: taskId,
    action: "replace",
    changes: { status: [task.status, "REPLACED"], replaced_by: [null, replacement.id] },
    reason: d.defer_reason ?? null,
  });
  return upd;
}

export async function listWorkPlans(tx: Tx, actor: AuthzActor, orgUnitId?: string) {
  await authorizeAnywhere(tx, actor, "rd.view").catch(() => authorizeAnywhere(tx, actor, "work.plan.submit"));
  const rows = (
    await tx.query(
      `SELECT wp.*, wp.week_start::text AS week_start, up.display_name AS user_name, u.name AS org_unit_name,
              ab.display_name AS approved_by_name,
              (SELECT count(*)::int FROM work.work_task wt WHERE wt.plan_id = wp.id) AS task_count,
              (SELECT count(*)::int FROM work.work_task wt WHERE wt.plan_id = wp.id AND wt.status = 'DONE') AS done_count,
              (SELECT count(*)::int FROM work.work_task wt WHERE wt.plan_id = wp.id AND wt.is_unplanned) AS unplanned_count
         FROM work.work_plan wp
         JOIN core.user_profile up ON up.user_id = wp.user_id
         JOIN core.org_unit u ON u.id = wp.org_unit_id
         LEFT JOIN core.user_profile ab ON ab.user_id = wp.approved_by
        WHERE ($1::uuid IS NULL OR wp.org_unit_id = $1)
        ORDER BY wp.week_start DESC, up.display_name ASC LIMIT 200`,
      [orgUnitId ?? null]
    )
  ).rows;
  const visible = [];
  for (const r of rows) {
    const canSee =
      r.user_id === actor.userId ||
      (await hasFactoryPermission(tx, actor, "work.plan.approve", r.org_unit_id)) ||
      (await hasFactoryPermission(tx, actor, "rd.view", r.org_unit_id));
    if (canSee) visible.push(r);
  }
  return visible;
}

export async function getWorkPlanDetail(tx: Tx, actor: AuthzActor, id: string) {
  const plan = (
    await tx.query(
      `SELECT wp.*, wp.week_start::text AS week_start, up.display_name AS user_name, u.name AS org_unit_name,
              ab.display_name AS approved_by_name
         FROM work.work_plan wp
         JOIN core.user_profile up ON up.user_id = wp.user_id
         JOIN core.org_unit u ON u.id = wp.org_unit_id
         LEFT JOIN core.user_profile ab ON ab.user_id = wp.approved_by
        WHERE wp.id = $1`,
      [id]
    )
  ).rows[0];
  if (!plan) throw notFound("kế hoạch tuần");
  const canSee =
    plan.user_id === actor.userId ||
    (await hasFactoryPermission(tx, actor, "work.plan.approve", plan.org_unit_id)) ||
    (await hasFactoryPermission(tx, actor, "rd.view", plan.org_unit_id));
  if (!canSee) throw notFound("kế hoạch tuần");

  const tasks = (
    await tx.query(
      `SELECT wt.*, p.code AS project_code, e.code AS experiment_code
         FROM work.work_task wt
         LEFT JOIN rd.project p ON p.id = wt.project_id
         LEFT JOIN rd.experiment e ON e.id = wt.experiment_id
        WHERE wt.plan_id = $1 ORDER BY wt.day_of_week ASC, wt.created_at ASC`,
      [id]
    )
  ).rows;
  const actions = await listAllowedActions(tx, workPlanMachine, actor, plan);
  const canApprove = await hasFactoryPermission(tx, actor, "work.plan.approve", plan.org_unit_id);
  return { ...plan, tasks, actions, can_approve: canApprove };
}

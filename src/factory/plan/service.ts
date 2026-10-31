import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, hasFactoryPermission, registerPermissions, type AuthzActor } from "../core/authz";
import { vnToday } from "../core/dates";
import { conflict, invalid, notFound } from "../core/errors";
import { parseInput } from "../core/records";
import { getSetting } from "../core/settings";

registerPermissions([
  { code: "plan.view", description: "Xem kế hoạch công việc của phòng" },
  { code: "plan.manage", description: "Lập, phân công, sửa kế hoạch công việc của phòng" },
]);

const toMin = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw invalid(`Giờ "${t}" không hợp lệ (HH:MM).`);
  return Number(m[1]) * 60 + Number(m[2]);
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Hours of a slot, as OligoFlow: inside the regular window regular, the rest overtime; a slot ending before it
 * starts runs past midnight; on Saturday and Sunday every hour is overtime. The window is a setting.
 */
export function workHours(date: string, start: string, end: string, window = { start: "08:00", end: "17:00" }) {
  const s = toMin(start);
  let e = toMin(end);
  if (e <= s) e += 24 * 60;
  const duration = e - s;
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (day === 0 || day === 6) return { duration_h: r2(duration / 60), regular_h: 0, overtime_h: r2(duration / 60) };
  const regular = Math.max(0, Math.min(e, toMin(window.end)) - Math.max(s, toMin(window.start)));
  return { duration_h: r2(duration / 60), regular_h: r2(regular / 60), overtime_h: r2((duration - regular) / 60) };
}

async function regularWindow(tx: Tx) {
  return { start: (await getSetting<string>(tx, "planner.regular_start")) ?? "08:00", end: (await getSetting<string>(tx, "planner.regular_end")) ?? "17:00" };
}

const KINDS = ["SYNTHESIS", "POST_PROCESS", "QC", "PREPARATION", "EQUIPMENT", "OTHER"] as const;
const taskSchema = z.object({
  org_unit_id: z.string().uuid(),
  kind: z.enum(KINDS),
  title: z.string().trim().min(2, "nhập tiêu đề công việc").max(300),
  assignee_id: z.coerce.number().int().optional().nullable(),
  work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "chọn ngày"),
  start_time: z.string().regex(/^\d{1,2}:\d{2}$/, "giờ bắt đầu HH:MM"),
  end_time: z.string().regex(/^\d{1,2}:\d{2}$/, "giờ kết thúc HH:MM"),
  notes: z.string().trim().max(2000).optional().nullable(),
  ref_type: z.string().max(40).optional().nullable(),
  ref_id: z.string().max(80).optional().nullable(),
});

/** People of the department (anyone holding a role there), for the board and the assignee picker. */
async function staffOf(tx: Tx, unit: string) {
  return (
    await tx.query(
      `SELECT DISTINCT p.user_id, p.display_name FROM core.user_role ur JOIN core.user_profile p ON p.user_id = ur.user_id
        WHERE ur.scope_org_unit_id = $1 AND ur.revoked_at IS NULL AND p.status = 'ACTIVE' ORDER BY p.display_name`,
      [unit]
    )
  ).rows;
}

async function checkAssignee(tx: Tx, unit: string, assignee: number | null | undefined) {
  if (assignee == null) return;
  if (!(await staffOf(tx, unit)).some((x) => x.user_id === assignee)) throw invalid("Chỉ phân công cho nhân sự của phòng.", undefined, "NOT_STAFF");
}

export async function createTask(tx: Tx, actor: AuthzActor, input: unknown) {
  const d = parseInput(taskSchema, input);
  await authorize(tx, actor, "plan.manage", d.org_unit_id);
  await checkAssignee(tx, d.org_unit_id, d.assignee_id);
  const h = workHours(d.work_date, d.start_time, d.end_time, await regularWindow(tx));
  const t = (
    await tx.query(
      `INSERT INTO plan.task (org_unit_id, kind, title, assignee_id, work_date, start_time, end_time, duration_h, regular_h, overtime_h, notes, ref_type, ref_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14) RETURNING *`,
      [d.org_unit_id, d.kind, d.title, d.assignee_id ?? null, d.work_date, d.start_time, d.end_time, h.duration_h, h.regular_h, h.overtime_h, d.notes ?? null, d.ref_type ?? null, d.ref_id ?? null, actor.userId]
    )
  ).rows[0];
  await writeAudit(tx, actor, { entityType: "plan_task", entityId: t.id, action: "create", changes: { title: [null, d.title], assignee: [null, d.assignee_id ?? null], date: [null, d.work_date] } });
  return t;
}

/** Re-plans a task (manager): date, slot, assignee, title, notes. Hours are recomputed. */
export async function updateTask(tx: Tx, actor: AuthzActor, id: string, input: unknown) {
  const raw = (input ?? {}) as Record<string, unknown>;
  const cur = (await tx.query("SELECT * FROM plan.task WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!cur) throw notFound("công việc");
  await authorize(tx, actor, "plan.manage", cur.org_unit_id);
  if (cur.version !== Number(raw.version)) throw conflict("Công việc vừa được người khác sửa. Tải lại.", "STALE_VERSION");
  const d = parseInput(taskSchema, { ...cur, start_time: String(cur.start_time).slice(0, 5), end_time: String(cur.end_time).slice(0, 5), ...raw, org_unit_id: cur.org_unit_id });
  await checkAssignee(tx, cur.org_unit_id, d.assignee_id);
  const h = workHours(d.work_date, d.start_time, d.end_time, await regularWindow(tx));
  await tx.query(
    `UPDATE plan.task SET kind = $2, title = $3, assignee_id = $4, work_date = $5, start_time = $6, end_time = $7, duration_h = $8, regular_h = $9, overtime_h = $10, notes = $11,
            version = version + 1, updated_at = now(), updated_by = $12 WHERE id = $1`,
    [id, d.kind, d.title, d.assignee_id ?? null, d.work_date, d.start_time, d.end_time, h.duration_h, h.regular_h, h.overtime_h, d.notes ?? null, actor.userId]
  );
  await writeAudit(tx, actor, {
    entityType: "plan_task",
    entityId: id,
    action: "update",
    changes: { assignee: [cur.assignee_id, d.assignee_id ?? null], date: [cur.work_date, d.work_date], slot: [`${cur.start_time}-${cur.end_time}`, `${d.start_time}-${d.end_time}`] },
  });
}

const STATUS_FLOW: Record<string, string[]> = { TODO: ["IN_PROGRESS", "DONE", "CANCELLED"], IN_PROGRESS: ["DONE", "TODO", "CANCELLED"], DONE: ["IN_PROGRESS"], CANCELLED: ["TODO"] };

/** The assignee moves their own task along (start, done); a manager may move any and cancel. */
export async function setTaskStatus(tx: Tx, actor: AuthzActor, id: string, input: unknown) {
  const d = parseInput(z.object({ status: z.enum(["TODO", "IN_PROGRESS", "DONE", "CANCELLED"]), version: z.number().int() }), input);
  const cur = (await tx.query("SELECT * FROM plan.task WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!cur) throw notFound("công việc");
  const manager = await hasFactoryPermission(tx, actor, "plan.manage", cur.org_unit_id);
  if (!manager && (cur.assignee_id !== actor.userId || d.status === "CANCELLED")) throw invalid("Chỉ người được giao cập nhật tiến độ việc của mình; hủy việc do người lập kế hoạch.", undefined, "FORBIDDEN");
  if (cur.version !== d.version) throw conflict("Công việc vừa thay đổi. Tải lại.", "STALE_VERSION");
  if (!STATUS_FLOW[cur.status].includes(d.status)) throw invalid("Không chuyển được sang trạng thái này.");
  await tx.query("UPDATE plan.task SET status = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1", [id, d.status, actor.userId]);
  await writeAudit(tx, actor, { entityType: "plan_task", entityId: id, action: "status", changes: { status: [cur.status, d.status] } });
}

/**
 * Work waiting to be planned in the department, derived from live records (as OligoFlow's "Hồ công việc chờ xếp"):
 * batches planned, sequences grouped by the next post-processing step, prepared lots waiting for QC or incubation,
 * preparation orders and equipment events due. Items already linked to an open task are left out.
 */
async function backlog(tx: Tx, unit: string) {
  const linked = new Set((await tx.query("SELECT ref_type || ':' || ref_id AS k FROM plan.task WHERE org_unit_id = $1 AND status IN ('TODO', 'IN_PROGRESS') AND ref_id IS NOT NULL", [unit])).rows.map((r) => r.k));
  const items: { kind: string; title: string; detail: string; ref_type: string; ref_id: string; count?: number }[] = [];
  for (const b of (await tx.query("SELECT b.id, b.code, a.code AS synth, (SELECT count(*)::int FROM oligo.synthesis_position p WHERE p.batch_id = b.id) AS n FROM oligo.synthesis_batch b JOIN asset.asset a ON a.id = b.synthesizer_id WHERE b.org_unit_id = $1 AND b.status = 'PLANNED' ORDER BY b.created_at", [unit])).rows) {
    items.push({ kind: "SYNTHESIS", title: `Chạy mẻ ${b.code}`, detail: `${b.synth} · ${b.n} vị trí`, ref_type: "SYNTHESIS_BATCH", ref_id: b.id, count: b.n });
  }
  const steps = (
    await tx.query(
      `SELECT coalesce(pp.workflow_steps -> (SELECT count(*)::int FROM oligo.ps_step_log l WHERE l.post_process_id = pp.id) ->> 'name', 'Hậu tổng hợp') AS step,
              count(*)::int AS n, string_agg(s.code, ', ' ORDER BY s.code) AS codes
         FROM oligo.post_process pp JOIN oligo.oligo_sequence s ON s.id = pp.sequence_id
        WHERE s.org_unit_id = $1 AND pp.status = 'OPEN' AND s.status = 'POST_PROCESSING' GROUP BY 1 ORDER BY 2 DESC`,
      [unit]
    )
  ).rows;
  for (const st of steps) items.push({ kind: "POST_PROCESS", title: `${st.step} (${st.n} trình tự)`, detail: st.codes.slice(0, 160), ref_type: "POST_STEP", ref_id: st.step, count: st.n });
  const synthesized = Number((await tx.query("SELECT count(*)::int AS n FROM oligo.oligo_sequence WHERE org_unit_id = $1 AND status = 'SYNTHESIZED'", [unit])).rows[0].n);
  if (synthesized) items.push({ kind: "POST_PROCESS", title: `Bắt đầu hậu tổng hợp (${synthesized} trình tự)`, detail: "Trình tự đã tổng hợp xong, chưa vào hậu tổng hợp", ref_type: "POST_START", ref_id: unit, count: synthesized });
  const whs = (await tx.query("SELECT id FROM master.warehouse WHERE owner_org_unit_id = $1", [unit])).rows.map((r) => r.id);
  for (const p of (await tx.query(
    `SELECT p.id, p.code, l.code AS lot, f.name, p.incubation_until, p.incubated_at, l.status FROM prep.preparation p JOIN inv.lot l ON l.id = p.lot_id JOIN prep.formula f ON f.id = p.formula_id
      WHERE p.warehouse_id = ANY($1::uuid[]) AND p.status = 'DONE' AND ((p.incubation_until IS NOT NULL AND p.incubated_at IS NULL) OR l.status IN ('QUARANTINE', 'PENDING_QC'))`,
    [whs]
  )).rows) {
    const incubating = p.incubation_until && !p.incubated_at;
    items.push({ kind: incubating ? "PREPARATION" : "QC", title: incubating ? `Ủ xong lô ${p.lot} (từ ${p.incubation_until})` : `Đánh giá chất lượng lô ${p.lot}`, detail: `${p.name} · ${p.code}`, ref_type: "PREPARATION", ref_id: p.id });
  }
  for (const o of (await tx.query("SELECT o.id, o.code, f.name, o.planned_date FROM prep.prep_order o JOIN prep.formula f ON f.id = o.formula_id WHERE o.warehouse_id = ANY($1::uuid[]) AND o.status = 'PLANNED' ORDER BY o.planned_date", [whs])).rows) {
    items.push({ kind: "PREPARATION", title: `Pha ${o.name}`, detail: `Lệnh ${o.code} · ngày ${o.planned_date}`, ref_type: "PREP_ORDER", ref_id: o.id });
  }
  for (const e of (await tx.query("SELECT e.id, e.code, e.kind, e.planned_date, a.code AS asset FROM asset.event e JOIN asset.asset a ON a.id = e.asset_id WHERE a.owner_org_unit_id = $1 AND e.status = 'PLANNED' ORDER BY e.planned_date", [unit])).rows) {
    items.push({ kind: "EQUIPMENT", title: `${e.kind === "CALIBRATION" ? "Hiệu chuẩn" : e.kind === "REPAIR" ? "Sửa chữa" : e.kind === "CLEANING" ? "Vệ sinh" : "Bảo trì"} ${e.asset}`, detail: `Phiếu ${e.code} · ngày ${e.planned_date}`, ref_type: "ASSET_EVENT", ref_id: e.id });
  }
  // Kit production orders (RELEASED / IN_PROGRESS)
  for (const ko of (await tx.query("SELECT ko.id, ko.code, ko.status, it.name AS product_name, ko.planned_qty::float AS qty FROM kit.production_order ko JOIN master.item it ON it.id = ko.product_item_id WHERE ko.org_unit_id = $1 AND ko.status IN ('RELEASED', 'IN_PROGRESS') ORDER BY ko.created_at", [unit])).rows) {
    items.push({ kind: "PREPARATION", title: `Sản xuất Kit ${ko.code}`, detail: `${ko.product_name} · SL ${ko.qty} (${ko.status})`, ref_type: "KIT_ORDER", ref_id: ko.id });
  }
  // Device assembly DHR orders & service tickets
  for (const ao of (await tx.query("SELECT ao.id, ao.code, ao.qty, ao.status, m.name AS model_name FROM device.device_order ao JOIN device.model_revision mr ON mr.id = ao.model_revision_id JOIN device.device_model m ON m.id = ao.model_id WHERE ao.org_unit_id = $1 AND ao.status IN ('APPROVED', 'IN_PRODUCTION') ORDER BY ao.created_at", [unit])).rows) {
    items.push({ kind: "EQUIPMENT", title: `Lắp ráp DHR ${ao.code}`, detail: `${ao.model_name} · SL ${ao.qty}`, ref_type: "DEVICE_ASSEMBLY", ref_id: ao.id });
  }
  for (const st of (await tx.query("SELECT st.id, st.code, st.symptom AS issue_summary, st.ticket_type AS priority FROM device.service_ticket st WHERE st.org_unit_id = $1 AND st.status IN ('OPEN', 'DIAGNOSING', 'IN_REPAIR') ORDER BY st.created_at", [unit])).rows) {
    items.push({ kind: "EQUIPMENT", title: `Xử lý phiếu kỹ thuật ${st.code}`, detail: `${st.issue_summary} (${st.priority})`, ref_type: "SERVICE_TICKET", ref_id: st.id });
  }
  // R&D active experiments
  for (const ex of (await tx.query("SELECT e.id, e.code, e.title, p.code AS proj_code FROM rd.experiment e JOIN rd.project p ON p.id = e.project_id WHERE p.owner_org_unit_id = $1 AND e.status IN ('DRAFT', 'IN_PROGRESS') ORDER BY e.created_at DESC LIMIT 15", [unit])).rows) {
    items.push({ kind: "OTHER", title: `Thí nghiệm ELN ${ex.code}`, detail: `Dự án ${ex.proj_code} · ${ex.title}`, ref_type: "RD_EXPERIMENT", ref_id: ex.id });
  }
  return items.filter((i) => !linked.has(`${i.ref_type}:${i.ref_id}`));
}

/** The board of one department for one day: staff with their tasks and hours, unassigned tasks, the backlog. */
export async function planBoard(tx: Tx, actor: AuthzActor, query: unknown) {
  const parsed = parseInput(z.object({ org_unit_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), query);
  const q = { ...parsed, date: parsed.date ?? vnToday() }; // today at call time, not when the module loaded
  if (!(await hasFactoryPermission(tx, actor, "plan.view", q.org_unit_id))) await authorize(tx, actor, "plan.manage", q.org_unit_id);
  const tasks = (
    await tx.query(
      `SELECT t.*, to_char(t.start_time, 'HH24:MI') AS start_time, to_char(t.end_time, 'HH24:MI') AS end_time, t.duration_h::float AS duration_h,
              t.regular_h::float AS regular_h, t.overtime_h::float AS overtime_h, p.display_name AS assignee_name
         FROM plan.task t LEFT JOIN core.user_profile p ON p.user_id = t.assignee_id
        WHERE t.org_unit_id = $1 AND t.work_date = $2 AND t.status <> 'CANCELLED' ORDER BY t.start_time, t.title`,
      [q.org_unit_id, q.date]
    )
  ).rows;
  const staff = (await staffOf(tx, q.org_unit_id)).map((s) => {
    const mine = tasks.filter((t) => t.assignee_id === s.user_id);
    return { ...s, tasks: mine, done: mine.filter((t) => t.status === "DONE").length, regular_h: r2(mine.reduce((n, t) => n + t.regular_h, 0)), overtime_h: r2(mine.reduce((n, t) => n + t.overtime_h, 0)) };
  });
  const sum = (k: "duration_h" | "regular_h" | "overtime_h") => r2(tasks.reduce((n, t) => n + t[k], 0));
  return {
    date: q.date,
    window: await regularWindow(tx),
    totals: { tasks: tasks.length, done: tasks.filter((t) => t.status === "DONE").length, hours: sum("duration_h"), regular_h: sum("regular_h"), overtime_h: sum("overtime_h") },
    staff,
    unassigned: tasks.filter((t) => t.assignee_id == null),
    backlog: await backlog(tx, q.org_unit_id),
    can_manage: await hasFactoryPermission(tx, actor, "plan.manage", q.org_unit_id),
  };
}

import type { Tx } from "../core/db";
import { vnToday } from "../core/dates";

export type HubDomainGroup = "RD" | "KIT_OLIGO" | "DEVICE" | "QA_WH_PUR" | "APP_LEGAL";

export interface HubWorkItem {
  uid: string;
  code: string;
  title: string;
  domainGroup: HubDomainGroup;
  sourceType: string;
  typeLabel: string;
  dept: string;
  involvedDepts: string[];
  targetTab: string;
  kanbanStatus: "TODO" | "IN_PROGRESS" | "DONE";
  isOpenForSchedule: boolean;
  statusLabel: string;
  priority: "URGENT" | "HIGH" | "MEDIUM" | "LOW";
  dueDate: string | null;
  location: string;
  assignees: string[];
  assigneeUserIds: number[];
  metaSummary: string;
  includeInTaskBoard: boolean;
  updatedAt?: string | null;
}

export interface HubProjectStageTask {
  id: string;
  code?: string;
  title: string;
  dept: string;
  assignee: string;
  due: string;
  status: "pending" | "in_progress" | "completed";
}

export interface HubProjectStage {
  id: string;
  name: string;
  dept: string;
  depts: string[];
  due: string;
  assignee: string;
  status: "pending" | "in_progress" | "completed";
  tasks: HubProjectStageTask[];
}

export interface HubProject {
  id: string;
  dbId: string;
  isHubProject: true;
  sourceBadge: string;
  targetTab: "factory-rd" | "factory-device";
  currentStageLabel: string;
  name: string;
  dept: string;
  participatingDepts: string[];
  customerOrRef: string;
  typeId: string;
  typeName: string;
  lead: string;
  leadUserId: number;
  collaborators: string[];
  memberUserIds: number[];
  startDate: string;
  endDate: string;
  slot: string;
  priority: "Cao" | "Trung bình" | "Bình thường";
  status: "Planning" | "Active" | "Review" | "Completed";
  tasksCount: number;
  budget: string;
  description: string;
  stages: HubProjectStage[];
}

export interface HubWeeklyPlanEvent {
  id: string;
  date: string;
  day: string;
  time: string;
  category: string;
  title: string;
  actor: string;
  actorUserId?: number | null;
  location: string;
  linkedTaskCodes: string[];
  isHubWeeklyPlan: true;
  sourceLabel: string;
  targetTab: string;
}

export interface FactoryWorkhubResult {
  workItems: HubWorkItem[];
  projects: HubProject[];
  weeklyPlans: HubWeeklyPlanEvent[];
  currentUserFactoryDept: string | null;
  userFactoryDepts: string[];
}

interface OrgMeta {
  dept: string;
  targetTab: string;
  defaultLocation: string;
  moduleKey: string;
}

interface UserProfileMeta {
  userId: number;
  displayName: string;
  orgUnitId: string | null;
  dept: string | null;
}

const MODULE_KEY_TO_META: Record<string, OrgMeta> = {
  RD: { dept: "Nghiên Cứu R&D", targetTab: "factory-rd", defaultLocation: "Phòng Lab R&D", moduleKey: "RD" },
  KIT: { dept: "Sản Xuất Kit", targetTab: "factory-kit", defaultLocation: "Phòng sạch Sản xuất Kit", moduleKey: "KIT" },
  OLIGO: { dept: "Tổng Hợp Oligo", targetTab: "factory-oligo", defaultLocation: "Trạm Tổng hợp Oligo", moduleKey: "OLIGO" },
  DEVICE: { dept: "Kỹ Thuật – Thiết Bị", targetTab: "factory-device", defaultLocation: "Xưởng Kỹ thuật – Thiết bị", moduleKey: "DEVICE" },
  IT: { dept: "Phòng IT", targetTab: "factory-it", defaultLocation: "Phòng IT", moduleKey: "IT" },
  QA: { dept: "QA/QC", targetTab: "factory-qa", defaultLocation: "Phòng Kiểm nghiệm QA/QC", moduleKey: "QA" },
  WH: { dept: "Kho Nhà Máy", targetTab: "factory-warehouse", defaultLocation: "Kho Nhà Máy", moduleKey: "WH" },
  PURCHASE: { dept: "Cung Ứng Kỹ Thuật", targetTab: "factory-purchase", defaultLocation: "Phòng Cung ứng Kỹ thuật", moduleKey: "PURCHASE" },
  SALES: { dept: "Kinh Doanh", targetTab: "sales", defaultLocation: "Khối Kinh Doanh", moduleKey: "SALES" },
  HR: { dept: "Hành Chính Nhân Sự", targetTab: "workspace", defaultLocation: "Văn phòng Công ty", moduleKey: "HR" },
  BOD: { dept: "Ban Giám Đốc", targetTab: "workspace", defaultLocation: "Ban Giám Đốc", moduleKey: "BOD" },
};

const DAY_NAMES_MON_FIRST = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"];

function toIsoDateStr(val: any): string | null {
  if (!val) return null;
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function dayNameFromIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "Thứ 2";
  const idx = (d.getUTCDay() + 6) % 7;
  return DAY_NAMES_MON_FIRST[idx] || "Thứ 2";
}

function addDaysIso(iso: string, deltaDays: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function normalizePriority(raw: any): "URGENT" | "HIGH" | "MEDIUM" | "LOW" {
  const p = String(raw || "").trim().toUpperCase();
  if (p === "URGENT" || p === "CRITICAL") return "URGENT";
  if (p === "HIGH") return "HIGH";
  if (p === "LOW") return "LOW";
  return "MEDIUM";
}

function domainGroupForDept(dept: string): HubDomainGroup {
  if (dept === "Nghiên Cứu R&D") return "RD";
  if (dept === "Sản Xuất Kit" || dept === "Tổng Hợp Oligo") return "KIT_OLIGO";
  if (dept === "Kỹ Thuật – Thiết Bị") return "DEVICE";
  return "QA_WH_PUR";
}

function dedupeStrings(arr: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    const clean = String(item || "").trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function dedupeIds(arr: Array<number | null | undefined>): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const v of arr) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function resolveUserRefs(
  ids: Array<number | null | undefined>,
  explicitNames: Array<string | null | undefined>,
  userMap: Map<number, UserProfileMeta>
): { assignees: string[]; assigneeUserIds: number[] } {
  const cleanExplicit = dedupeStrings(explicitNames);
  const matchedIdsFromNames: number[] = [];
  if (cleanExplicit.length > 0 && userMap.size > 0) {
    const lowerSet = new Set(cleanExplicit.map((n) => n.toLowerCase()));
    for (const meta of userMap.values()) {
      const dn = meta.displayName.trim().toLowerCase();
      if (dn && lowerSet.has(dn)) {
        matchedIdsFromNames.push(meta.userId);
      }
    }
  }
  const cleanIds = dedupeIds([...ids, ...matchedIdsFromNames]);
  const fromIds = cleanIds.map((uid) => userMap.get(uid)?.displayName).filter(Boolean) as string[];
  return {
    assignees: dedupeStrings([...cleanExplicit, ...fromIds]),
    assigneeUserIds: cleanIds,
  };
}

function resolveOrgMeta(orgUnitId: string | null | undefined, orgMap: Map<string, OrgMeta>, fallbackKey = "RD"): OrgMeta {
  if (orgUnitId && orgMap.has(orgUnitId)) {
    return orgMap.get(orgUnitId)!;
  }
  return MODULE_KEY_TO_META[fallbackKey] || MODULE_KEY_TO_META.RD;
}

/**
 * Safely runs a single query inside an active factory transaction using SAVEPOINT,
 * ensuring optional or unmigrated tables never abort the surrounding transaction (25P02).
 */
async function safeTxQuery<T = any>(tx: Tx, spCounter: { n: number }, sql: string, params: any[] = []): Promise<T[]> {
  spCounter.n += 1;
  const spName = `sp_workhub_${spCounter.n}`;
  await tx.query(`SAVEPOINT ${spName}`);
  try {
    const res = await tx.query(sql, params);
    await tx.query(`RELEASE SAVEPOINT ${spName}`);
    return res.rows as T[];
  } catch {
    await tx.query(`ROLLBACK TO SAVEPOINT ${spName}`).catch(() => {});
    return [];
  }
}

/**
 * Aggregates live projects, tasks, orders, ELNs, batches, QC tests, deviations,
 * procurement, internal orders and weekly plans across ALL technical departments in `abt_factory`.
 */
export async function getFactoryWorkhubData(tx: Tx, currentUserId?: number): Promise<FactoryWorkhubResult> {
  const sp = { n: 0 };
  const workItems: HubWorkItem[] = [];
  const projects: HubProject[] = [];
  const weeklyPlans: HubWeeklyPlanEvent[] = [];

  // 1. Load org units & user profiles
  const orgRows = await safeTxQuery(tx, sp, `SELECT id, code, name, module_key FROM core.org_unit WHERE status = 'ACTIVE'`);
  const orgMap = new Map<string, OrgMeta>();
  for (const r of orgRows) {
    const mk = String(r.module_key || "").toUpperCase();
    const mapped = MODULE_KEY_TO_META[mk];
    if (mapped) {
      orgMap.set(String(r.id), mapped);
    } else {
      const codeUpper = String(r.code || "").toUpperCase();
      if (codeUpper.includes("RD")) orgMap.set(String(r.id), MODULE_KEY_TO_META.RD);
      else if (codeUpper.includes("KIT")) orgMap.set(String(r.id), MODULE_KEY_TO_META.KIT);
      else if (codeUpper.includes("OLIGO")) orgMap.set(String(r.id), MODULE_KEY_TO_META.OLIGO);
      else if (codeUpper.includes("DEVICE") || codeUpper.includes("TB") || codeUpper.includes("KTCN")) orgMap.set(String(r.id), MODULE_KEY_TO_META.DEVICE);
      else if (codeUpper.includes("QA") || codeUpper.includes("QC")) orgMap.set(String(r.id), MODULE_KEY_TO_META.QA);
      else if (codeUpper.includes("WH") || codeUpper.includes("KHO")) orgMap.set(String(r.id), MODULE_KEY_TO_META.WH);
      else if (codeUpper.includes("PUR") || codeUpper.includes("CUNG")) orgMap.set(String(r.id), MODULE_KEY_TO_META.PURCHASE);
    }
  }

  const profileRows = await safeTxQuery(tx, sp, `SELECT user_id, display_name, org_unit_id FROM core.user_profile`);
  const userMap = new Map<number, UserProfileMeta>();
  for (const p of profileRows) {
    const uid = Number(p.user_id);
    const meta = p.org_unit_id ? orgMap.get(String(p.org_unit_id)) : undefined;
    userMap.set(uid, {
      userId: uid,
      displayName: String(p.display_name || ""),
      orgUnitId: p.org_unit_id ? String(p.org_unit_id) : null,
      dept: meta?.dept || null,
    });
  }

  let currentUserFactoryDept: string | null = null;
  const userFactoryDeptsSet = new Set<string>();
  if (currentUserId && Number.isFinite(currentUserId)) {
    const myProfile = userMap.get(currentUserId);
    if (myProfile?.dept) {
      currentUserFactoryDept = myProfile.dept;
      userFactoryDeptsSet.add(myProfile.dept);
    }
    const roleRows = await safeTxQuery(
      tx,
      sp,
      `SELECT ur.scope_org_unit_id, r.code AS role_code
         FROM core.user_role ur
         JOIN core.role r ON r.id = ur.role_id
        WHERE ur.user_id = $1
          AND ur.revoked_at IS NULL
          AND (ur.valid_to IS NULL OR ur.valid_to > now())`,
      [currentUserId]
    );
    for (const rr of roleRows) {
      if (rr.scope_org_unit_id) {
        const om = orgMap.get(String(rr.scope_org_unit_id));
        if (om?.dept) userFactoryDeptsSet.add(om.dept);
      }
      const rc = String(rr.role_code || "").toUpperCase();
      if (rc.startsWith("RD_")) userFactoryDeptsSet.add("Nghiên Cứu R&D");
      else if (rc.startsWith("KIT_")) userFactoryDeptsSet.add("Sản Xuất Kit");
      else if (rc.startsWith("OLIGO_")) userFactoryDeptsSet.add("Tổng Hợp Oligo");
      else if (rc.startsWith("DEVICE_")) userFactoryDeptsSet.add("Kỹ Thuật – Thiết Bị");
      else if (rc.startsWith("QA_") || rc.startsWith("QC_")) userFactoryDeptsSet.add("QA/QC");
      else if (rc.includes("WH_") || rc.includes("WAREHOUSE")) userFactoryDeptsSet.add("Kho Nhà Máy");
      else if (rc.includes("PUR_") || rc.includes("PROCUREMENT")) userFactoryDeptsSet.add("Cung Ứng Kỹ Thuật");
    }
    if (!currentUserFactoryDept && userFactoryDeptsSet.size > 0) {
      currentUserFactoryDept = Array.from(userFactoryDeptsSet)[0];
    }
  }

  // 2. R&D & KTCN Stage-Gate Projects + Gates + WBS Tasks + Members
  const rdProjectRows = await safeTxQuery(
    tx,
    sp,
    `SELECT id, code, name, owner_org_unit_id, project_type, target_domain, ivd_class,
            leader_id, leader_name_override, current_stage, status, planned_start, planned_end,
            description, budget_amount, created_at, updated_at
       FROM rd.project
      WHERE status IN ('ACTIVE', 'ON_HOLD')
         OR updated_at >= now() - interval '30 days'
      ORDER BY created_at DESC
      LIMIT 120`
  );

  const projectById = new Map<string, any>();
  const projectMemberMap = new Map<string, { names: string[]; ids: number[] }>();
  const projectGatesMap = new Map<string, any[]>();
  const projectWbsByProjAndGate = new Map<string, HubProjectStageTask[]>();

  if (rdProjectRows.length > 0) {
    const projectIds = rdProjectRows.map((p) => String(p.id));
    for (const p of rdProjectRows) {
      projectById.set(String(p.id), p);
    }

    const memberRows = await safeTxQuery(
      tx,
      sp,
      `SELECT project_id, user_id FROM rd.project_member WHERE project_id = ANY($1::uuid[])`,
      [projectIds]
    );
    for (const m of memberRows) {
      const pid = String(m.project_id);
      const uid = Number(m.user_id);
      const cur = projectMemberMap.get(pid) || { names: [], ids: [] };
      cur.ids.push(uid);
      const dName = userMap.get(uid)?.displayName;
      if (dName) cur.names.push(dName);
      projectMemberMap.set(pid, cur);
    }

    const gateRows = await safeTxQuery(
      tx,
      sp,
      `SELECT id, project_id, gate_no, gate_name, stage_after, status, decided_at
         FROM rd.project_gate
        WHERE project_id = ANY($1::uuid[])
        ORDER BY gate_no ASC`,
      [projectIds]
    );
    for (const g of gateRows) {
      const pid = String(g.project_id);
      const list = projectGatesMap.get(pid) || [];
      list.push(g);
      projectGatesMap.set(pid, list);
    }
  }

  // WBS Project Tasks (`rd.project_task`)
  const wbsRows = await safeTxQuery(
    tx,
    sp,
    `SELECT t.id, t.code, t.project_id, t.gate_no, t.title, t.assignee_name, t.due_date, t.status,
            t.progress_pct, t.notes, t.created_by, t.updated_at, t.completed_at,
            p.code AS project_code, p.name AS project_name, p.owner_org_unit_id, p.target_domain, p.leader_id, p.leader_name_override
       FROM rd.project_task t
       JOIN rd.project p ON p.id = t.project_id
      WHERE t.status NOT IN ('DONE', 'COMPLETED', 'CANCELLED')
         OR t.updated_at >= now() - interval '30 days'
      ORDER BY t.due_date ASC NULLS LAST, t.updated_at DESC
      LIMIT 200`
  );

  for (const w of wbsRows) {
    const om = resolveOrgMeta(w.owner_org_unit_id, orgMap, String(w.target_domain || "").toUpperCase() === "SOFTWARE" ? "IT" : String(w.target_domain || "").toUpperCase() === "DEVICE" ? "DEVICE" : "RD");
    const isDeviceProj = om.dept === "Kỹ Thuật – Thiết Bị";
    const stUpper = String(w.status || "TODO").toUpperCase();
    const isDone = stUpper === "DONE" || stUpper === "COMPLETED";
    const isCancelled = stUpper === "CANCELLED";
    if (isCancelled) continue;

    const kanbanStatus: "TODO" | "IN_PROGRESS" | "DONE" = isDone
      ? "DONE"
      : stUpper === "IN_PROGRESS" || stUpper === "BLOCKED" || Number(w.progress_pct || 0) > 0
      ? "IN_PROGRESS"
      : "TODO";

    const refs = resolveUserRefs(
      [w.assignee_name ? null : w.leader_id],
      [w.assignee_name, !w.assignee_name ? w.leader_name_override : null],
      userMap
    );

    const wbsKey = `${w.project_id}::${Number(w.gate_no ?? 0)}`;
    const stageTasks = projectWbsByProjAndGate.get(wbsKey) || [];
    stageTasks.push({
      id: String(w.id),
      code: String(w.code),
      title: `[${w.code}] ${w.title}`,
      dept: om.dept,
      assignee: refs.assignees[0] || "",
      due: toIsoDateStr(w.due_date) || "",
      status: isDone ? "completed" : kanbanStatus === "IN_PROGRESS" ? "in_progress" : "pending",
    });
    projectWbsByProjAndGate.set(wbsKey, stageTasks);

    workItems.push({
      uid: `rd_wbs:${w.id}`,
      code: String(w.code),
      title: `${w.title} (${w.project_code})`,
      domainGroup: isDeviceProj ? "DEVICE" : "RD",
      sourceType: "RD_WBS",
      typeLabel: `📋 WBS Gate ${w.gate_no}`,
      dept: om.dept,
      involvedDepts: [om.dept],
      targetTab: om.targetTab,
      kanbanStatus,
      isOpenForSchedule: !isDone,
      statusLabel:
        stUpper === "BLOCKED"
          ? "Đang vướng mắc"
          : isDone
          ? "Hoàn thành WBS"
          : kanbanStatus === "IN_PROGRESS"
          ? `Đang thực hiện (${Number(w.progress_pct || 0)}%)`
          : "Kế hoạch WBS",
      priority: stUpper === "BLOCKED" ? "URGENT" : "HIGH",
      dueDate: toIsoDateStr(w.due_date),
      location: om.defaultLocation,
      assignees: refs.assignees,
      assigneeUserIds: refs.assigneeUserIds,
      metaSummary: `Dự án ${w.project_code}: ${w.project_name} · Gate ${w.gate_no}`,
      includeInTaskBoard: true,
      updatedAt: w.updated_at ? String(w.updated_at) : null,
    });
  }

  // Build HubProject cards + Project schedule picker items
  for (const p of rdProjectRows) {
    const om = resolveOrgMeta(
      p.owner_org_unit_id,
      orgMap,
      String(p.target_domain || "").toUpperCase() === "SOFTWARE" ? "IT" : String(p.target_domain || "").toUpperCase() === "DEVICE" ? "DEVICE" : "RD"
    );
    const isDeviceProj = om.dept === "Kỹ Thuật – Thiết Bị";
    const mem = projectMemberMap.get(String(p.id)) || { names: [], ids: [] };
    const leadName = String(p.leader_name_override || "").trim() || userMap.get(Number(p.leader_id))?.displayName || "";
    const allMemberIds = dedupeIds([p.leader_id, ...mem.ids]);
    const allCollabs = dedupeStrings(mem.names).filter((n) => n.toLowerCase() !== leadName.toLowerCase());
    const gates = projectGatesMap.get(String(p.id)) || [];

    const stages: HubProjectStage[] = gates.map((g: any) => {
      const gKey = `${p.id}::${Number(g.gate_no ?? 0)}`;
      const wbsList = projectWbsByProjAndGate.get(gKey) || [];
      const gStatus = String(g.status || "LOCKED").toUpperCase();
      return {
        id: String(g.id),
        name: `Gate ${g.gate_no}: ${g.gate_name}`,
        dept: om.dept,
        depts: [om.dept],
        due: toIsoDateStr(p.planned_end) || "",
        assignee: leadName,
        status: gStatus === "PASSED" ? "completed" : gStatus === "OPEN" || gStatus === "PENDING_REVIEW" ? "in_progress" : "pending",
        tasks: wbsList,
      };
    });

    const totalWbsTasks = stages.reduce((acc, st) => acc + st.tasks.length, 0);
    const pStatusUpper = String(p.status || "ACTIVE").toUpperCase();
    const mappedStatus: HubProject["status"] =
      pStatusUpper === "TRANSFERRED" || pStatusUpper === "KILLED"
        ? "Completed"
        : pStatusUpper === "ON_HOLD"
        ? "Review"
        : "Active";

    projects.push({
      id: String(p.code),
      dbId: String(p.id),
      isHubProject: true,
      sourceBadge: isDeviceProj ? "⚙️ Dự án KTCN – Thiết bị / Phần mềm" : "🧬 Dự án Stage-Gate R&D",
      targetTab: isDeviceProj ? "factory-device" : "factory-rd",
      currentStageLabel: String(p.current_stage || ""),
      name: String(p.name),
      dept: om.dept,
      participatingDepts: [om.dept],
      customerOrRef: `${p.target_domain || "KIT"}${p.ivd_class && p.ivd_class !== "NA" ? ` • ${p.ivd_class}` : ""}`,
      typeId: isDeviceProj ? "ktcn_stage_gate" : "rd_stage_gate",
      typeName: isDeviceProj ? "Dự án Thiết bị & Phần mềm (ISO 13485 / IEC 62304)" : "Dự án R&D Stage-Gate (G0–G4)",
      lead: leadName || "Chưa gán chủ nhiệm",
      leadUserId: Number(p.leader_id) || 0,
      collaborators: allCollabs,
      memberUserIds: allMemberIds,
      startDate: toIsoDateStr(p.planned_start) || "",
      endDate: toIsoDateStr(p.planned_end) || "",
      slot: `Giai đoạn: ${p.current_stage || "Đang triển khai"}`,
      priority: "Cao",
      status: mappedStatus,
      tasksCount: Math.max(totalWbsTasks, stages.length),
      budget: Number(p.budget_amount || 0) > 0 ? `${Number(p.budget_amount).toLocaleString("vi-VN")} VNĐ` : "",
      description: String(p.description || ""),
      stages,
    });

    const isProjectOpen = pStatusUpper === "ACTIVE" || pStatusUpper === "ON_HOLD";
    workItems.push({
      uid: `rd_project:${p.id}`,
      code: String(p.code),
      title: `Dự án ${p.name} (${p.current_stage})`,
      domainGroup: isDeviceProj ? "DEVICE" : "RD",
      sourceType: "RD_PROJECT",
      typeLabel: isDeviceProj ? "⚙️ Dự án KTCN" : "🧬 Dự án R&D",
      dept: om.dept,
      involvedDepts: [om.dept],
      targetTab: om.targetTab,
      kanbanStatus: isProjectOpen ? "IN_PROGRESS" : "DONE",
      isOpenForSchedule: isProjectOpen,
      statusLabel: `Stage: ${p.current_stage || pStatusUpper}`,
      priority: "HIGH",
      dueDate: toIsoDateStr(p.planned_end),
      location: om.defaultLocation,
      assignees: dedupeStrings([leadName, ...allCollabs]),
      assigneeUserIds: allMemberIds,
      metaSummary: `${p.target_domain} · ${stages.length} Gate · ${totalWbsTasks} WBS`,
      includeInTaskBoard: false,
      updatedAt: p.updated_at ? String(p.updated_at) : null,
    });
  }

  // 3. Electronic Lab Notebook (ELN - `rd.experiment`)
  const elnRows = await safeTxQuery(
    tx,
    sp,
    `SELECT e.id, e.code, e.project_id, e.org_unit_id, e.title, e.objective, e.status, e.revision,
            e.performer_name, e.wbs_task_code, e.submitted_by, e.created_by, e.updated_at,
            p.code AS project_code, p.owner_org_unit_id AS project_org_unit_id, p.target_domain
       FROM rd.experiment e
       LEFT JOIN rd.project p ON p.id = e.project_id
      WHERE e.status IN ('PLANNED', 'IN_PROGRESS', 'SUBMITTED')
         OR (e.status = 'APPROVED' AND e.updated_at >= now() - interval '30 days')
      ORDER BY e.updated_at DESC
      LIMIT 150`
  );
  for (const e of elnRows) {
    const om = resolveOrgMeta(e.org_unit_id || e.project_org_unit_id, orgMap, String(e.target_domain || "").toUpperCase() === "SOFTWARE" ? "IT" : String(e.target_domain || "").toUpperCase() === "DEVICE" ? "DEVICE" : "RD");
    const st = String(e.status || "PLANNED").toUpperCase();
    const isDone = st === "APPROVED";
    const kanbanStatus: "TODO" | "IN_PROGRESS" | "DONE" = isDone
      ? "DONE"
      : st === "IN_PROGRESS" || st === "SUBMITTED"
      ? "IN_PROGRESS"
      : "TODO";
    const refs = resolveUserRefs([e.created_by, e.submitted_by], [e.performer_name], userMap);

    workItems.push({
      uid: `rd_eln:${e.id}`,
      code: String(e.code),
      title: String(e.title),
      domainGroup: domainGroupForDept(om.dept),
      sourceType: "RD_ELN",
      typeLabel: "🧪 Thí nghiệm ELN",
      dept: om.dept,
      involvedDepts: [om.dept],
      targetTab: om.targetTab,
      kanbanStatus,
      isOpenForSchedule: !isDone,
      statusLabel:
        st === "PLANNED"
          ? "Kế hoạch ELN"
          : st === "IN_PROGRESS"
          ? "Đang làm thí nghiệm"
          : st === "SUBMITTED"
          ? "Đã gửi duyệt"
          : "Đã phê duyệt",
      priority: st === "SUBMITTED" ? "HIGH" : "MEDIUM",
      dueDate: null,
      location: om.defaultLocation,
      assignees: refs.assignees,
      assigneeUserIds: refs.assigneeUserIds,
      metaSummary: [
        e.project_code ? `Dự án ${e.project_code}` : "Thí nghiệm độc lập",
        e.wbs_task_code ? `WBS ${e.wbs_task_code}` : "",
        `Rev ${e.revision || 1}`,
      ]
        .filter(Boolean)
        .join(" · "),
      includeInTaskBoard: true,
      updatedAt: e.updated_at ? String(e.updated_at) : null,
    });
  }

  // 4. Tech Transfer Packages (`rd.tech_transfer_package`)
  const transferRows = await safeTxQuery(
    tx,
    sp,
    `SELECT t.id, t.code, t.title, t.target_domain, t.target_org_unit_id, t.status, t.pilot_lot_ref,
            t.submitted_by, t.accepted_by, t.created_by, t.updated_at,
            p.code AS project_code, p.owner_org_unit_id, p.leader_id, p.leader_name_override
       FROM rd.tech_transfer_package t
       JOIN rd.project p ON p.id = t.project_id
      WHERE t.status <> 'COMPLETED' OR t.updated_at >= now() - interval '30 days'
      ORDER BY t.updated_at DESC
      LIMIT 60`
  );
  for (const t of transferRows) {
    const srcMeta = resolveOrgMeta(t.owner_org_unit_id, orgMap, "RD");
    const dstMeta = resolveOrgMeta(t.target_org_unit_id, orgMap, String(t.target_domain || "KIT").toUpperCase());
    const st = String(t.status || "DRAFT").toUpperCase();
    const isDone = st === "COMPLETED";
    const refs = resolveUserRefs([t.submitted_by, t.accepted_by, t.created_by, t.leader_id], [t.leader_name_override], userMap);

    workItems.push({
      uid: `rd_transfer:${t.id}`,
      code: String(t.code),
      title: `Chuyển giao công nghệ: ${t.title}`,
      domainGroup: "RD",
      sourceType: "TECH_TRANSFER",
      typeLabel: "🔁 Chuyển giao CN",
      dept: srcMeta.dept,
      involvedDepts: dedupeStrings([srcMeta.dept, dstMeta.dept, "QA/QC"]),
      targetTab: srcMeta.targetTab,
      kanbanStatus: isDone ? "DONE" : st === "DRAFT" ? "TODO" : "IN_PROGRESS",
      isOpenForSchedule: !isDone,
      statusLabel: st === "DRAFT" ? "Soạn hồ sơ TTP" : st === "SUBMITTED" ? "Chờ SX tiếp nhận" : st === "ACCEPTED" ? "Đang chạy Pilot" : "Hoàn tất chuyển giao",
      priority: "HIGH",
      dueDate: null,
      location: `${srcMeta.defaultLocation} → ${dstMeta.defaultLocation}`,
      assignees: refs.assignees,
      assigneeUserIds: refs.assigneeUserIds,
      metaSummary: `${t.project_code} → ${dstMeta.dept}${t.pilot_lot_ref ? ` · Lô ${t.pilot_lot_ref}` : ""}`,
      includeInTaskBoard: true,
      updatedAt: t.updated_at ? String(t.updated_at) : null,
    });
  }

  // 5. Software Releases (`rd.software_release`)
  const swRows = await safeTxQuery(
    tx,
    sp,
    `SELECT s.id, s.code, s.version_tag, s.target_kind, s.release_notes, s.status, s.created_by, s.released_by, s.updated_at,
            p.code AS project_code, p.name AS project_name, p.owner_org_unit_id, p.leader_id, p.leader_name_override
       FROM rd.software_release s
       JOIN rd.project p ON p.id = s.project_id
      WHERE s.status = 'DRAFT' OR s.updated_at >= now() - interval '30 days'
      ORDER BY s.updated_at DESC
      LIMIT 60`
  );
  for (const s of swRows) {
    const om = resolveOrgMeta(s.owner_org_unit_id, orgMap, "DEVICE");
    const st = String(s.status || "DRAFT").toUpperCase();
    if (st === "WITHDRAWN") continue;
    const isDone = st === "RELEASED";
    const refs = resolveUserRefs([s.created_by, s.released_by, s.leader_id], [s.leader_name_override], userMap);

    workItems.push({
      uid: `rd_sw:${s.id}`,
      code: String(s.code),
      title: `Phát hành phần mềm ${s.version_tag} — ${s.project_name}`,
      domainGroup: "DEVICE",
      sourceType: "SW_RELEASE",
      typeLabel: "💻 Phần mềm IEC 62304",
      dept: om.dept,
      involvedDepts: [om.dept],
      targetTab: "factory-device",
      kanbanStatus: isDone ? "DONE" : "IN_PROGRESS",
      isOpenForSchedule: !isDone,
      statusLabel: isDone ? "Đã phát hành" : "Đang kiểm thử / Chờ ký",
      priority: "HIGH",
      dueDate: null,
      location: om.defaultLocation,
      assignees: refs.assignees,
      assigneeUserIds: refs.assigneeUserIds,
      metaSummary: `${s.target_kind} · ${s.project_code}`,
      includeInTaskBoard: true,
      updatedAt: s.updated_at ? String(s.updated_at) : null,
    });
  }

  // 6. Kit Production Orders (`kit.production_order`) + Open EBR Steps + Rework Orders
  const kitOrderRows = await safeTxQuery(
    tx,
    sp,
    `SELECT o.id, o.code, o.org_unit_id, o.planned_qty, o.good_qty, o.uom, o.priority, o.status,
            o.order_mode, o.planned_start_date, o.planned_end_date, o.team_lead_name, o.qa_assignee_name,
            o.created_by, o.updated_at, i.code AS item_code, i.name AS item_name
       FROM kit.production_order o
       LEFT JOIN master.item i ON i.id = o.product_item_id
      WHERE o.status NOT IN ('COMPLETED', 'CANCELLED')
         OR (o.status = 'COMPLETED' AND o.updated_at >= now() - interval '30 days')
      ORDER BY o.planned_end_date ASC NULLS LAST, o.updated_at DESC
      LIMIT 120`
  );
  const kitOrderMap = new Map<string, any>();
  for (const ko of kitOrderRows) {
    kitOrderMap.set(String(ko.id), ko);
    const om = resolveOrgMeta(ko.org_unit_id, orgMap, "KIT");
    const st = String(ko.status || "DRAFT").toUpperCase();
    const isDone = st === "COMPLETED";
    const kanbanStatus: "TODO" | "IN_PROGRESS" | "DONE" = isDone
      ? "DONE"
      : st === "DRAFT" || st === "CONFIRMED"
      ? "TODO"
      : "IN_PROGRESS";
    const refs = resolveUserRefs([ko.created_by], [ko.team_lead_name, ko.qa_assignee_name], userMap);

    workItems.push({
      uid: `kit_order:${ko.id}`,
      code: String(ko.code),
      title: `SX Kit ${ko.item_name || ko.item_code || ""} (${Number(ko.planned_qty)} ${ko.uom})`,
      domainGroup: "KIT_OLIGO",
      sourceType: "KIT_ORDER",
      typeLabel: "🧪 Lệnh SX Kit",
      dept: om.dept,
      involvedDepts: dedupeStrings([om.dept, st === "PENDING_QC" || st === "PENDING_RELEASE" || ko.qa_assignee_name ? "QA/QC" : null]),
      targetTab: "factory-kit",
      kanbanStatus,
      isOpenForSchedule: !isDone,
      statusLabel:
        st === "DRAFT"
          ? "Nháp lệnh SX"
          : st === "CONFIRMED"
          ? "Đã xác nhận"
          : st === "IN_PROGRESS"
          ? "Đang sản xuất (eBR)"
          : st === "PENDING_QC"
          ? "Chờ QC kiểm nghiệm"
          : st === "PENDING_RELEASE"
          ? "Chờ QA giải phóng lô"
          : st === "ON_HOLD"
          ? "Đang tạm giữ (HOLD)"
          : "Hoàn thành lô Kit",
      priority: normalizePriority(ko.priority),
      dueDate: toIsoDateStr(ko.planned_end_date) || toIsoDateStr(ko.planned_start_date),
      location: om.defaultLocation,
      assignees: refs.assignees,
      assigneeUserIds: refs.assigneeUserIds,
      metaSummary: `${ko.item_code || ""} · Mode ${ko.order_mode || "STANDARD"}`,
      includeInTaskBoard: true,
      updatedAt: ko.updated_at ? String(ko.updated_at) : null,
    });
  }

  const kitStepRows = await safeTxQuery(
    tx,
    sp,
    `SELECT s.id, s.order_id, s.seq, s.step_code, s.step_name, s.work_center,
            s.assigned_to_name, s.qa_assignee_name, s.planned_date, s.status, s.updated_at,
            o.code AS order_code, o.org_unit_id, o.priority, i.name AS product_name
       FROM kit.production_step s
       JOIN kit.production_order o ON o.id = s.order_id
       LEFT JOIN master.item i ON i.id = o.product_item_id
      WHERE o.status NOT IN ('COMPLETED', 'CANCELLED')
        AND s.status IN ('PENDING', 'IN_PROGRESS', 'AWAITING_CHECK')
        AND (coalesce(trim(s.assigned_to_name), '') <> '' OR coalesce(trim(s.qa_assignee_name), '') <> '')
      ORDER BY s.planned_date ASC NULLS LAST, s.seq ASC
      LIMIT 120`
  );
  for (const ks of kitStepRows) {
    const om = resolveOrgMeta(ks.org_unit_id, orgMap, "KIT");
    const st = String(ks.status || "PENDING").toUpperCase();
    const refs = resolveUserRefs([], [ks.assigned_to_name, ks.qa_assignee_name], userMap);

    workItems.push({
      uid: `kit_step:${ks.id}`,
      code: `${ks.order_code}-S${ks.seq}`,
      title: `Công đoạn ${ks.seq}: ${ks.step_name} (${ks.order_code})`,
      domainGroup: "KIT_OLIGO",
      sourceType: "KIT_STEP",
      typeLabel: "🧫 Công đoạn eBR",
      dept: om.dept,
      involvedDepts: dedupeStrings([om.dept, ks.qa_assignee_name ? "QA/QC" : null]),
      targetTab: "factory-kit",
      kanbanStatus: st === "IN_PROGRESS" || st === "AWAITING_CHECK" ? "IN_PROGRESS" : "TODO",
      isOpenForSchedule: true,
      statusLabel: st === "AWAITING_CHECK" ? "Chờ kiểm tra chéo" : st === "IN_PROGRESS" ? "Đang chạy công đoạn" : "Chờ thực hiện",
      priority: normalizePriority(ks.priority),
      dueDate: toIsoDateStr(ks.planned_date),
      location: ks.work_center || om.defaultLocation,
      assignees: refs.assignees,
      assigneeUserIds: refs.assigneeUserIds,
      metaSummary: `${ks.product_name || ks.order_code} · ${ks.step_code}`,
      includeInTaskBoard: true,
      updatedAt: ks.updated_at ? String(ks.updated_at) : null,
    });
  }

  const kitReworkRows = await safeTxQuery(
    tx,
    sp,
    `SELECT r.id, r.code, r.org_unit_id, r.scope, r.qty_to_rework, r.uom, r.instructions, r.status,
            r.created_by, r.updated_at, o.code AS order_code, o.team_lead_name
       FROM kit.rework_order r
       JOIN kit.production_order o ON o.id = r.production_order_id
      WHERE r.status NOT IN ('COMPLETED', 'CANCELLED')
         OR (r.status = 'COMPLETED' AND r.updated_at >= now() - interval '30 days')
      ORDER BY r.updated_at DESC
      LIMIT 60`
  );
  for (const kr of kitReworkRows) {
    const om = resolveOrgMeta(kr.org_unit_id, orgMap, "KIT");
    const st = String(kr.status || "DRAFT").toUpperCase();
    const isDone = st === "COMPLETED";
    const refs = resolveUserRefs([kr.created_by], [kr.team_lead_name], userMap);

    workItems.push({
      uid: `kit_rework:${kr.id}`,
      code: String(kr.code),
      title: `Làm lại lô ${kr.order_code}: ${String(kr.instructions || kr.scope).slice(0, 80)}`,
      domainGroup: "KIT_OLIGO",
      sourceType: "KIT_REWORK",
      typeLabel: "🔁 Rework Kit",
      dept: om.dept,
      involvedDepts: [om.dept, "QA/QC"],
      targetTab: "factory-kit",
      kanbanStatus: isDone ? "DONE" : st === "IN_PROGRESS" ? "IN_PROGRESS" : "TODO",
      isOpenForSchedule: !isDone,
      statusLabel: isDone ? "Đã xử lý lại" : st === "IN_PROGRESS" ? "Đang làm lại" : st === "APPROVED" ? "Đã duyệt Rework" : "Nháp Rework",
      priority: "HIGH",
      dueDate: null,
      location: om.defaultLocation,
      assignees: refs.assignees,
      assigneeUserIds: refs.assigneeUserIds,
      metaSummary: `Lệnh gốc ${kr.order_code} · ${Number(kr.qty_to_rework)} ${kr.uom}`,
      includeInTaskBoard: true,
      updatedAt: kr.updated_at ? String(kr.updated_at) : null,
    });
  }

  // 7. Oligo Synthesis (`oligo.oligo_order`, `oligo.synthesis_batch`, `oligo.post_process`)
  const oligoOrderRows = await safeTxQuery(
    tx,
    sp,
    `SELECT o.id, o.code, o.org_unit_id, o.customer_label, o.due_date, o.notes, o.status, o.created_by, o.updated_at,
            (SELECT count(*)::int FROM oligo.oligo_sequence s WHERE s.order_id = o.id AND s.status NOT IN ('SPLIT', 'CANCELLED')) AS seq_count
       FROM oligo.oligo_order o
      WHERE o.status IN ('PENDING', 'IN_PROGRESS')
         OR (o.status IN ('COMPLETED', 'DELIVERED') AND o.updated_at >= now() - interval '30 days')
      ORDER BY o.due_date ASC NULLS LAST, o.updated_at DESC
      LIMIT 120`
  );
  for (const oo of oligoOrderRows) {
    const om = resolveOrgMeta(oo.org_unit_id, orgMap, "OLIGO");
    const st = String(oo.status || "PENDING").toUpperCase();
    const isDone = st === "COMPLETED" || st === "DELIVERED";
    const refs = resolveUserRefs([oo.created_by], [], userMap);

    workItems.push({
      uid: `oligo_order:${oo.id}`,
      code: String(oo.code),
      title: `Đơn Oligo ${oo.code}${oo.customer_label ? ` — ${oo.customer_label}` : ""} (${Number(oo.seq_count || 0)} trình tự)`,
      domainGroup: "KIT_OLIGO",
      sourceType: "OLIGO_ORDER",
      typeLabel: "🧬 Đơn Oligo",
      dept: om.dept,
      involvedDepts: [om.dept],
      targetTab: "factory-oligo",
      kanbanStatus: isDone ? "DONE" : st === "IN_PROGRESS" ? "IN_PROGRESS" : "TODO",
      isOpenForSchedule: !isDone,
      statusLabel: isDone ? "Hoàn tất / Đã giao" : st === "IN_PROGRESS" ? "Đang tổng hợp" : "Chờ xử lý",
      priority: "HIGH",
      dueDate: toIsoDateStr(oo.due_date),
      location: oo.customer_label || om.defaultLocation,
      assignees: refs.assignees,
      assigneeUserIds: refs.assigneeUserIds,
      metaSummary: `${Number(oo.seq_count || 0)} trình tự${oo.notes ? ` · ${String(oo.notes).slice(0, 60)}` : ""}`,
      includeInTaskBoard: true,
      updatedAt: oo.updated_at ? String(oo.updated_at) : null,
    });
  }

  const oligoBatchRows = await safeTxQuery(
    tx,
    sp,
    `SELECT b.id, b.code, b.org_unit_id, b.program_name, b.planned_start, b.operator_id, b.status, b.created_by, b.updated_at,
            a.name AS asset_name
       FROM oligo.synthesis_batch b
       LEFT JOIN asset.asset a ON a.id = b.synthesizer_id
      WHERE b.status IN ('PLANNED', 'RUNNING')
         OR (b.status = 'COMPLETED' AND b.updated_at >= now() - interval '30 days')
      ORDER BY b.planned_start ASC NULLS LAST, b.updated_at DESC
      LIMIT 100`
  );
  for (const ob of oligoBatchRows) {
    const om = resolveOrgMeta(ob.org_unit_id, orgMap, "OLIGO");
    const st = String(ob.status || "PLANNED").toUpperCase();
    const isDone = st === "COMPLETED";
    const refs = resolveUserRefs([ob.operator_id, ob.created_by], [], userMap);

    workItems.push({
      uid: `oligo_batch:${ob.id}`,
      code: String(ob.code),
      title: `Mẻ tổng hợp ${ob.code}${ob.asset_name ? ` (${ob.asset_name})` : ""}`,
      domainGroup: "KIT_OLIGO",
      sourceType: "OLIGO_BATCH",
      typeLabel: "⚗️ Mẻ tổng hợp Oligo",
      dept: om.dept,
      involvedDepts: [om.dept],
      targetTab: "factory-oligo",
      kanbanStatus: isDone ? "DONE" : st === "RUNNING" ? "IN_PROGRESS" : "TODO",
      isOpenForSchedule: !isDone,
      statusLabel: isDone ? "Đã chạy xong" : st === "RUNNING" ? "Máy đang chạy" : "Đã xếp mẻ",
      priority: st === "RUNNING" ? "HIGH" : "MEDIUM",
      dueDate: toIsoDateStr(ob.planned_start),
      location: ob.asset_name || om.defaultLocation,
      assignees: refs.assignees,
      assigneeUserIds: refs.assigneeUserIds,
      metaSummary: ob.program_name || "Chạy máy tổng hợp Oligo",
      includeInTaskBoard: true,
      updatedAt: ob.updated_at ? String(ob.updated_at) : null,
    });
  }

  const oligoPostRows = await safeTxQuery(
    tx,
    sp,
    `SELECT o.id AS order_id, o.code AS order_code, o.customer_label, o.due_date, o.org_unit_id,
            count(*)::int AS open_seq_count,
            max(pp.updated_at) AS latest_updated_at,
            array_agg(DISTINCT coalesce(pp.created_by, s.created_by)) FILTER (WHERE coalesce(pp.created_by, s.created_by) IS NOT NULL) AS actor_ids
       FROM oligo.post_process pp
       JOIN oligo.oligo_sequence s ON s.id = pp.sequence_id
       LEFT JOIN oligo.oligo_order o ON o.id = s.order_id
      WHERE pp.status = 'OPEN'
      GROUP BY o.id, o.code, o.customer_label, o.due_date, o.org_unit_id
      ORDER BY o.due_date ASC NULLS LAST, latest_updated_at DESC
      LIMIT 60`
  );
  for (const op of oligoPostRows) {
    const om = resolveOrgMeta(op.org_unit_id, orgMap, "OLIGO");
    const refs = resolveUserRefs(Array.isArray(op.actor_ids) ? op.actor_ids : [], [], userMap);
    const code = op.order_code ? `POST-${op.order_code}` : `POST-${String(op.order_id || "").slice(0, 6)}`;

    workItems.push({
      uid: `oligo_post:${op.order_id || code}`,
      code,
      title: `Hậu tổng hợp & Tinh sạch ${op.order_code || ""} (${Number(op.open_seq_count || 0)} trình tự)`,
      domainGroup: "KIT_OLIGO",
      sourceType: "OLIGO_POST",
      typeLabel: "🧫 Tinh sạch Oligo",
      dept: om.dept,
      involvedDepts: [om.dept],
      targetTab: "factory-oligo",
      kanbanStatus: "IN_PROGRESS",
      isOpenForSchedule: true,
      statusLabel: "Đang cắt/tinh sạch/đo OD",
      priority: "MEDIUM",
      dueDate: toIsoDateStr(op.due_date),
      location: op.customer_label || om.defaultLocation,
      assignees: refs.assignees,
      assigneeUserIds: refs.assigneeUserIds,
      metaSummary: `${Number(op.open_seq_count || 0)} trình tự đang hậu tổng hợp`,
      includeInTaskBoard: true,
      updatedAt: op.latest_updated_at ? String(op.latest_updated_at) : null,
    });
  }

  // 8. Preparation Orders (`prep.prep_order`) across R&D / Kit / Oligo
  const prepOrderRows = await safeTxQuery(
    tx,
    sp,
    `SELECT po.id, po.code, po.qty, po.uom, po.planned_date, po.notes, po.status, po.created_by, po.updated_at,
            f.code AS formula_code, f.name AS formula_name, f.dept_scope
       FROM prep.prep_order po
       JOIN prep.formula f ON f.id = po.formula_id
      WHERE po.status = 'PLANNED'
         OR (po.status = 'DONE' AND po.updated_at >= now() - interval '30 days')
      ORDER BY po.planned_date ASC NULLS LAST, po.updated_at DESC
      LIMIT 80`
  );
  for (const pr of prepOrderRows) {
    const scope = String(pr.dept_scope || "OLIGO").toUpperCase();
    const om = MODULE_KEY_TO_META[scope] || MODULE_KEY_TO_META.OLIGO;
    const st = String(pr.status || "PLANNED").toUpperCase();
    const isDone = st === "DONE";
    const refs = resolveUserRefs([pr.created_by], [], userMap);

    workItems.push({
      uid: `prep_order:${pr.id}`,
      code: String(pr.code),
      title: `Pha chế ${pr.formula_name} (${Number(pr.qty)} ${pr.uom})`,
      domainGroup: om.dept === "Nghiên Cứu R&D" ? "RD" : "KIT_OLIGO",
      sourceType: "PREP_ORDER",
      typeLabel: "⚗️ Lệnh pha chế",
      dept: om.dept,
      involvedDepts: [om.dept],
      targetTab: om.targetTab,
      kanbanStatus: isDone ? "DONE" : "TODO",
      isOpenForSchedule: !isDone,
      statusLabel: isDone ? "Đã pha xong" : "Chờ pha chế",
      priority: "MEDIUM",
      dueDate: toIsoDateStr(pr.planned_date),
      location: om.defaultLocation,
      assignees: refs.assignees,
      assigneeUserIds: refs.assigneeUserIds,
      metaSummary: `Công thức ${pr.formula_code}${pr.notes ? ` · ${String(pr.notes).slice(0, 60)}` : ""}`,
      includeInTaskBoard: true,
      updatedAt: pr.updated_at ? String(pr.updated_at) : null,
    });
  }

  // 9. Device Engineering (`device.device_order`, `device.service_ticket`, `device.eco_request`, `device.subcontract_order`, `asset.event`)
  const deviceOrderRows = await safeTxQuery(
    tx,
    sp,
    `SELECT o.id, o.code, o.org_unit_id, o.qty, o.priority, o.due_date, o.lead_engineer_id, o.status, o.created_by, o.updated_at,
            m.code AS model_code, m.name AS model_name
       FROM device.device_order o
       JOIN device.device_model m ON m.id = o.model_id
      WHERE o.status NOT IN ('DELIVERED', 'CANCELLED')
         OR (o.status = 'DELIVERED' AND o.updated_at >= now() - interval '30 days')
      ORDER BY o.due_date ASC NULLS LAST, o.updated_at DESC
      LIMIT 100`
  );
  for (const d of deviceOrderRows) {
    const om = resolveOrgMeta(d.org_unit_id, orgMap, "DEVICE");
    const st = String(d.status || "RECEIVED").toUpperCase();
    const isDone = st === "DELIVERED" || st === "READY";
    const refs = resolveUserRefs([d.lead_engineer_id, d.created_by], [], userMap);

    workItems.push({
      uid: `device_order:${d.id}`,
      code: String(d.code),
      title: `Lắp ráp ${d.qty} máy ${d.model_name} (${d.model_code})`,
      domainGroup: "DEVICE",
      sourceType: "DEVICE_ORDER",
      typeLabel: "⚙️ Lệnh lắp ráp máy",
      dept: om.dept,
      involvedDepts: dedupeStrings([om.dept, st === "QC_TESTING" ? "QA/QC" : null]),
      targetTab: "factory-device",
      kanbanStatus: isDone ? "DONE" : st === "RECEIVED" ? "TODO" : "IN_PROGRESS",
      isOpenForSchedule: st !== "DELIVERED",
      statusLabel:
        st === "RECEIVED"
          ? "Tiếp nhận lệnh"
          : st === "APPROVED"
          ? "Đã duyệt lắp ráp"
          : st === "IN_PRODUCTION"
          ? "Đang lắp ráp / Burn-in"
          : st === "QC_TESTING"
          ? "Đang FQC thiết bị"
          : st === "READY"
          ? "Sẵn sàng bàn giao"
          : "Đã bàn giao",
      priority: normalizePriority(d.priority),
      dueDate: toIsoDateStr(d.due_date),
      location: om.defaultLocation,
      assignees: refs.assignees,
      assigneeUserIds: refs.assigneeUserIds,
      metaSummary: `Model ${d.model_code} · SL ${d.qty}`,
      includeInTaskBoard: true,
      updatedAt: d.updated_at ? String(d.updated_at) : null,
    });
  }

  const serviceTicketRows = await safeTxQuery(
    tx,
    sp,
    `SELECT t.id, t.code, t.org_unit_id, t.ticket_type, t.reported_at, t.symptom, t.is_warranty,
            t.assigned_to, t.status, t.created_by, t.updated_at,
            u.serial_no, u.customer_name, m.name AS model_name
       FROM device.service_ticket t
       JOIN device.device_unit u ON u.id = t.unit_id
       JOIN device.device_model m ON m.id = u.model_id
      WHERE t.status NOT IN ('CLOSED', 'CANCELLED')
         OR (t.status = 'CLOSED' AND t.updated_at >= now() - interval '30 days')
      ORDER BY t.reported_at DESC, t.updated_at DESC
      LIMIT 100`
  );
  for (const s of serviceTicketRows) {
    const om = resolveOrgMeta(s.org_unit_id, orgMap, "DEVICE");
    const st = String(s.status || "OPEN").toUpperCase();
    const isDone = st === "CLOSED" || st === "RESOLVED";
    const refs = resolveUserRefs([s.assigned_to, s.created_by], [], userMap);

    workItems.push({
      uid: `device_srv:${s.id}`,
      code: String(s.code),
      title: `Dịch vụ TB ${s.serial_no} (${s.model_name}): ${String(s.symptom || "").slice(0, 70)}`,
      domainGroup: "DEVICE",
      sourceType: "SERVICE_TICKET",
      typeLabel: "🛠️ Bảo hành / Dịch vụ máy",
      dept: om.dept,
      involvedDepts: [om.dept],
      targetTab: "factory-device",
      kanbanStatus: isDone ? "DONE" : st === "OPEN" ? "TODO" : "IN_PROGRESS",
      isOpenForSchedule: st !== "CLOSED",
      statusLabel: st === "OPEN" ? "Mới tiếp nhận" : st === "DIAGNOSING" ? "Đang chẩn đoán" : st === "AWAITING_PARTS" ? "Chờ linh kiện" : st === "IN_REPAIR" ? "Đang sửa chữa" : st === "RESOLVED" ? "Đã khắc phục" : "Đã đóng",
      priority: s.ticket_type === "COMPLAINT" || s.is_warranty ? "HIGH" : "MEDIUM",
      dueDate: toIsoDateStr(s.reported_at),
      location: s.customer_name || om.defaultLocation,
      assignees: refs.assignees,
      assigneeUserIds: refs.assigneeUserIds,
      metaSummary: `${s.ticket_type} · ${s.serial_no}${s.customer_name ? ` · ${s.customer_name}` : ""}`,
      includeInTaskBoard: true,
      updatedAt: s.updated_at ? String(s.updated_at) : null,
    });
  }

  const ecoRows = await safeTxQuery(
    tx,
    sp,
    `SELECT e.id, e.code, e.target_revision, e.title, e.proposer_id, e.status, e.created_by, e.updated_at,
            m.code AS model_code, m.name AS model_name, m.org_unit_id
       FROM device.eco_request e
       JOIN device.device_model m ON m.id = e.model_id
      WHERE e.status NOT IN ('CLOSED', 'REJECTED', 'IMPLEMENTED')
         OR e.updated_at >= now() - interval '30 days'
      ORDER BY e.updated_at DESC
      LIMIT 60`
  );
  for (const e of ecoRows) {
    const om = resolveOrgMeta(e.org_unit_id, orgMap, "DEVICE");
    const st = String(e.status || "DRAFT").toUpperCase();
    if (st === "REJECTED") continue;
    const isDone = st === "CLOSED" || st === "IMPLEMENTED";
    const refs = resolveUserRefs([e.proposer_id, e.created_by], [], userMap);

    workItems.push({
      uid: `device_eco:${e.id}`,
      code: String(e.code),
      title: `ECO ${e.model_code} (${e.target_revision}): ${e.title}`,
      domainGroup: "DEVICE",
      sourceType: "DEVICE_ECO",
      typeLabel: "📐 Thay đổi KT (ECO)",
      dept: om.dept,
      involvedDepts: [om.dept, "QA/QC"],
      targetTab: "factory-device",
      kanbanStatus: isDone ? "DONE" : st === "DRAFT" ? "TODO" : "IN_PROGRESS",
      isOpenForSchedule: !isDone,
      statusLabel: st,
      priority: st === "PENDING_APPROVAL" ? "HIGH" : "MEDIUM",
      dueDate: null,
      location: om.defaultLocation,
      assignees: refs.assignees,
      assigneeUserIds: refs.assigneeUserIds,
      metaSummary: `Model ${e.model_name} → Rev ${e.target_revision}`,
      includeInTaskBoard: true,
      updatedAt: e.updated_at ? String(e.updated_at) : null,
    });
  }

  const subcontractRows = await safeTxQuery(
    tx,
    sp,
    `SELECT s.id, s.code, s.org_unit_id, s.due_date, s.notes, s.status, s.created_by, s.updated_at,
            p.name AS vendor_name
       FROM device.subcontract_order s
       LEFT JOIN master.partner p ON p.id = s.vendor_id
      WHERE s.status NOT IN ('CLOSED', 'CANCELLED')
         OR (s.status = 'CLOSED' AND s.updated_at >= now() - interval '30 days')
      ORDER BY s.due_date ASC NULLS LAST, s.updated_at DESC
      LIMIT 60`
  );
  for (const sc of subcontractRows) {
    const om = resolveOrgMeta(sc.org_unit_id, orgMap, "DEVICE");
    const st = String(sc.status || "DRAFT").toUpperCase();
    const isDone = st === "CLOSED" || st === "RECEIVED";
    const refs = resolveUserRefs([sc.created_by], [], userMap);

    workItems.push({
      uid: `device_sub:${sc.id}`,
      code: String(sc.code),
      title: `Gia công ngoài ${sc.code}${sc.vendor_name ? ` — ${sc.vendor_name}` : ""}`,
      domainGroup: "DEVICE",
      sourceType: "SUBCONTRACT",
      typeLabel: "🔩 Gia công ngoài",
      dept: om.dept,
      involvedDepts: [om.dept, "QA/QC"],
      targetTab: "factory-device",
      kanbanStatus: isDone ? "DONE" : st === "DRAFT" ? "TODO" : "IN_PROGRESS",
      isOpenForSchedule: st !== "CLOSED",
      statusLabel: st,
      priority: "MEDIUM",
      dueDate: toIsoDateStr(sc.due_date),
      location: sc.vendor_name || om.defaultLocation,
      assignees: refs.assignees,
      assigneeUserIds: refs.assigneeUserIds,
      metaSummary: sc.notes ? String(sc.notes).slice(0, 80) : `NCC: ${sc.vendor_name || "Ngoài"}`,
      includeInTaskBoard: true,
      updatedAt: sc.updated_at ? String(sc.updated_at) : null,
    });
  }

  // Equipment Maintenance / Calibration Events (`asset.event`)
  const assetEventRows = await safeTxQuery(
    tx,
    sp,
    `SELECT e.id, e.code, e.kind, e.status, e.planned_date, e.assignee, e.description, e.out_of_service,
            e.performed_by, e.created_by, e.updated_at, a.code AS asset_code, a.name AS asset_name, a.owner_org_unit_id, a.location
       FROM asset.event e
       JOIN asset.asset a ON a.id = e.asset_id
      WHERE e.status = 'PLANNED'
         OR (e.status = 'DONE' AND e.updated_at >= now() - interval '30 days')
      ORDER BY e.out_of_service DESC, e.planned_date ASC
      LIMIT 80`
  );
  for (const ae of assetEventRows) {
    const om = resolveOrgMeta(ae.owner_org_unit_id, orgMap, "DEVICE");
    const st = String(ae.status || "PLANNED").toUpperCase();
    const isDone = st === "DONE";
    const refs = resolveUserRefs([ae.created_by], [ae.assignee, ae.performed_by], userMap);

    workItems.push({
      uid: `asset_event:${ae.id}`,
      code: String(ae.code),
      title: `${ae.kind} thiết bị ${ae.asset_name} (${ae.asset_code})`,
      domainGroup: domainGroupForDept(om.dept),
      sourceType: "ASSET_EVENT",
      typeLabel: "🔧 Bảo trì / Hiệu chuẩn TB",
      dept: om.dept,
      involvedDepts: dedupeStrings([om.dept, "Kỹ Thuật – Thiết Bị"]),
      targetTab: om.targetTab,
      kanbanStatus: isDone ? "DONE" : ae.out_of_service ? "IN_PROGRESS" : "TODO",
      isOpenForSchedule: !isDone,
      statusLabel: isDone ? "Đã hoàn tất" : ae.out_of_service ? "Máy đang dừng (Hỏng)" : "Kế hoạch bảo trì/HC",
      priority: ae.out_of_service ? "URGENT" : "MEDIUM",
      dueDate: toIsoDateStr(ae.planned_date),
      location: ae.location || om.defaultLocation,
      assignees: refs.assignees,
      assigneeUserIds: refs.assigneeUserIds,
      metaSummary: ae.description ? String(ae.description).slice(0, 80) : `${ae.asset_code} · ${ae.kind}`,
      includeInTaskBoard: true,
      updatedAt: ae.updated_at ? String(ae.updated_at) : null,
    });
  }

  // 10. QA/QC (`qms.qc_test`, `qms.deviation`, `qms.ncr`)
  const qcTestRows = await safeTxQuery(
    tx,
    sp,
    `SELECT t.id, t.code, t.entity_type, t.test_kind, t.status, t.analyst_id, t.reviewer_id,
            t.overall_result, t.created_by, t.updated_at, s.code AS spec_code, s.name AS spec_name
       FROM qms.qc_test t
       JOIN qms.qc_spec s ON s.id = t.spec_id
      WHERE t.status IN ('PLANNED', 'IN_PROGRESS', 'RESULTS_ENTERED')
         OR (t.status = 'REVIEWED' AND t.updated_at >= now() - interval '14 days')
      ORDER BY t.updated_at DESC
      LIMIT 120`
  );
  for (const qt of qcTestRows) {
    const st = String(qt.status || "PLANNED").toUpperCase();
    const isDone = st === "REVIEWED";
    const refs = resolveUserRefs([qt.analyst_id, qt.reviewer_id, qt.created_by], [], userMap);

    workItems.push({
      uid: `qc_test:${qt.id}`,
      code: String(qt.code),
      title: `Kiểm nghiệm ${qt.test_kind}: ${qt.spec_name || qt.spec_code}`,
      domainGroup: "QA_WH_PUR",
      sourceType: "QC_TEST",
      typeLabel: `🛡️ Kiểm nghiệm ${qt.test_kind}`,
      dept: "QA/QC",
      involvedDepts: ["QA/QC"],
      targetTab: "factory-qa",
      kanbanStatus: isDone ? "DONE" : st === "PLANNED" ? "TODO" : "IN_PROGRESS",
      isOpenForSchedule: !isDone,
      statusLabel:
        st === "PLANNED"
          ? "Chờ lấy mẫu / Kiểm"
          : st === "IN_PROGRESS"
          ? "Đang kiểm nghiệm"
          : st === "RESULTS_ENTERED"
          ? "Chờ QA thẩm định"
          : `Đã duyệt (${qt.overall_result || "DONE"})`,
      priority: st === "RESULTS_ENTERED" || qt.test_kind === "FQC" || qt.test_kind === "RELEASE" ? "HIGH" : "MEDIUM",
      dueDate: null,
      location: "Phòng Kiểm nghiệm QA/QC",
      assignees: refs.assignees,
      assigneeUserIds: refs.assigneeUserIds,
      metaSummary: `${qt.entity_type} · TCCS ${qt.spec_code}`,
      includeInTaskBoard: true,
      updatedAt: qt.updated_at ? String(qt.updated_at) : null,
    });
  }

  const deviationRows = await safeTxQuery(
    tx,
    sp,
    `SELECT id, code, source_module, severity, title, description, detected_by, performer_id,
            action_owner, action_due, status, updated_at
       FROM qms.deviation
      WHERE status <> 'CLOSED' OR updated_at >= now() - interval '30 days'
      ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END, updated_at DESC
      LIMIT 80`
  );
  for (const dev of deviationRows) {
    const st = String(dev.status || "OPEN").toUpperCase();
    const isDone = st === "CLOSED";
    const srcDept = MODULE_KEY_TO_META[String(dev.source_module || "").toUpperCase()]?.dept;
    const refs = resolveUserRefs([dev.performer_id, dev.detected_by], [dev.action_owner], userMap);

    workItems.push({
      uid: `qms_dev:${dev.id}`,
      code: String(dev.code),
      title: `Sự cố & CAPA: ${dev.title || String(dev.description || "").slice(0, 75)}`,
      domainGroup: "QA_WH_PUR",
      sourceType: "DEVIATION_CAPA",
      typeLabel: "⚠️ Sự cố & CAPA",
      dept: "QA/QC",
      involvedDepts: dedupeStrings(["QA/QC", srcDept]),
      targetTab: "factory-qa",
      kanbanStatus: isDone ? "DONE" : st === "OPEN" ? "TODO" : "IN_PROGRESS",
      isOpenForSchedule: !isDone,
      statusLabel: st === "OPEN" ? "Mới ghi nhận" : st === "UNDER_INVESTIGATION" ? "Đang điều tra RCA" : st === "ACTION_DEFINED" ? "Đang chạy CAPA" : "Đã đóng CAPA",
      priority: normalizePriority(dev.severity),
      dueDate: toIsoDateStr(dev.action_due),
      location: srcDept || "Phòng Kiểm nghiệm QA/QC",
      assignees: refs.assignees,
      assigneeUserIds: refs.assigneeUserIds,
      metaSummary: `Mức độ ${dev.severity} · Nguồn ${dev.source_module}`,
      includeInTaskBoard: true,
      updatedAt: dev.updated_at ? String(dev.updated_at) : null,
    });
  }

  const ncrRows = await safeTxQuery(
    tx,
    sp,
    `SELECT n.id, n.code, n.qty_affected, n.description, n.disposition, n.status, n.created_by, n.updated_at,
            i.code AS item_code, i.name AS item_name
       FROM qms.ncr n
       LEFT JOIN master.item i ON i.id = n.item_id
      WHERE n.status <> 'CLOSED' OR n.updated_at >= now() - interval '30 days'
      ORDER BY n.updated_at DESC
      LIMIT 60`
  );
  for (const ncr of ncrRows) {
    const st = String(ncr.status || "OPEN").toUpperCase();
    const isDone = st === "CLOSED";
    const refs = resolveUserRefs([ncr.created_by], [], userMap);

    workItems.push({
      uid: `qms_ncr:${ncr.id}`,
      code: String(ncr.code),
      title: `Phiếu KPH (NCR): ${ncr.item_name || String(ncr.description || "").slice(0, 70)}`,
      domainGroup: "QA_WH_PUR",
      sourceType: "NCR",
      typeLabel: "🚫 Phiếu KPH (NCR)",
      dept: "QA/QC",
      involvedDepts: ["QA/QC"],
      targetTab: "factory-qa",
      kanbanStatus: isDone ? "DONE" : st === "OPEN" ? "TODO" : "IN_PROGRESS",
      isOpenForSchedule: !isDone,
      statusLabel: `${st} · ${ncr.disposition || "PENDING"}`,
      priority: "HIGH",
      dueDate: null,
      location: "Khu Biệt trữ / QA-QC",
      assignees: refs.assignees,
      assigneeUserIds: refs.assigneeUserIds,
      metaSummary: ncr.item_code ? `${ncr.item_code} · SL ${ncr.qty_affected ?? ""}` : String(ncr.description || "").slice(0, 60),
      includeInTaskBoard: true,
      updatedAt: ncr.updated_at ? String(ncr.updated_at) : null,
    });
  }

  // 11. Factory Warehouse Draft Documents (`inv.stock_document`), Purchase Requests/Orders, Internal Orders
  const stockDocRows = await safeTxQuery(
    tx,
    sp,
    `SELECT d.id, d.code, d.doc_type, d.reason_code, d.status, d.notes, d.created_by, d.updated_at,
            w.code AS wh_code, w.name AS wh_name
       FROM inv.stock_document d
       JOIN master.warehouse w ON w.id = d.warehouse_id
      WHERE d.status = 'DRAFT'
      ORDER BY d.updated_at DESC
      LIMIT 60`
  );
  for (const sd of stockDocRows) {
    const refs = resolveUserRefs([sd.created_by], [], userMap);
    workItems.push({
      uid: `stock_doc:${sd.id}`,
      code: String(sd.code),
      title: `Chứng từ ${sd.doc_type} chờ ghi sổ — ${sd.wh_name}`,
      domainGroup: "QA_WH_PUR",
      sourceType: "STOCK_DOC",
      typeLabel: "🏭 Phiếu Kho Nhà máy",
      dept: "Kho Nhà Máy",
      involvedDepts: ["Kho Nhà Máy"],
      targetTab: "factory-warehouse",
      kanbanStatus: "TODO",
      isOpenForSchedule: true,
      statusLabel: "Nháp chờ xuất/nhập FEFO",
      priority: "MEDIUM",
      dueDate: null,
      location: sd.wh_name || "Kho Nhà Máy",
      assignees: refs.assignees,
      assigneeUserIds: refs.assigneeUserIds,
      metaSummary: `${sd.wh_code} · ${sd.reason_code}`,
      includeInTaskBoard: true,
      updatedAt: sd.updated_at ? String(sd.updated_at) : null,
    });
  }

  const prRows = await safeTxQuery(
    tx,
    sp,
    `SELECT pr.id, pr.code, pr.org_unit_id, pr.requester_id, pr.needed_by, pr.reason, pr.priority, pr.status,
            pr.approved_by, pr.created_by, pr.updated_at
       FROM purchase.purchase_request pr
      WHERE pr.status IN ('DRAFT', 'SUBMITTED', 'PENDING_BOD', 'APPROVED')
         OR pr.updated_at >= now() - interval '30 days'
      ORDER BY pr.needed_by ASC NULLS LAST, pr.updated_at DESC
      LIMIT 80`
  );
  for (const pr of prRows) {
    const reqMeta = resolveOrgMeta(pr.org_unit_id, orgMap, "PURCHASE");
    const st = String(pr.status || "DRAFT").toUpperCase();
    if (st === "REJECTED" || st === "CANCELLED") continue;
    const isDone = st === "ORDERED" || st === "CLOSED";
    const refs = resolveUserRefs([pr.requester_id, pr.created_by, pr.approved_by], [], userMap);

    workItems.push({
      uid: `tech_pr:${pr.id}`,
      code: String(pr.code),
      title: `PR Kỹ thuật: ${String(pr.reason || "").slice(0, 80)}`,
      domainGroup: "QA_WH_PUR",
      sourceType: "TECH_PR",
      typeLabel: "🛒 PR Cung ứng KT",
      dept: "Cung Ứng Kỹ Thuật",
      involvedDepts: dedupeStrings(["Cung Ứng Kỹ Thuật", reqMeta.dept]),
      targetTab: "factory-purchase",
      kanbanStatus: isDone ? "DONE" : st === "DRAFT" ? "TODO" : "IN_PROGRESS",
      isOpenForSchedule: !isDone,
      statusLabel: st === "PENDING_BOD" ? "Chờ BGĐ duyệt PR" : st === "APPROVED" ? "Đã duyệt — Chờ lên PO" : st,
      priority: normalizePriority(pr.priority),
      dueDate: toIsoDateStr(pr.needed_by),
      location: "Phòng Cung ứng Kỹ thuật",
      assignees: refs.assignees,
      assigneeUserIds: refs.assigneeUserIds,
      metaSummary: `Phòng yêu cầu: ${reqMeta.dept}`,
      includeInTaskBoard: true,
      updatedAt: pr.updated_at ? String(pr.updated_at) : null,
    });
  }

  const poRows = await safeTxQuery(
    tx,
    sp,
    `SELECT po.id, po.code, po.expected_date, po.notes, po.status, po.created_by, po.updated_at,
            p.name AS supplier_name
       FROM purchase.purchase_order po
       JOIN master.partner p ON p.id = po.supplier_id
      WHERE po.status IN ('DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED')
         OR po.updated_at >= now() - interval '30 days'
      ORDER BY po.expected_date ASC NULLS LAST, po.updated_at DESC
      LIMIT 80`
  );
  for (const po of poRows) {
    const st = String(po.status || "DRAFT").toUpperCase();
    if (st === "CANCELLED") continue;
    const isDone = st === "RECEIVED" || st === "CLOSED";
    const refs = resolveUserRefs([po.created_by], [], userMap);

    workItems.push({
      uid: `tech_po:${po.id}`,
      code: String(po.code),
      title: `PO Nhà máy ${po.code} — ${po.supplier_name}`,
      domainGroup: "QA_WH_PUR",
      sourceType: "TECH_PO",
      typeLabel: "📦 PO Mua hàng KT",
      dept: "Cung Ứng Kỹ Thuật",
      involvedDepts: ["Cung Ứng Kỹ Thuật", "Kho Nhà Máy"],
      targetTab: "factory-purchase",
      kanbanStatus: isDone ? "DONE" : st === "DRAFT" ? "TODO" : "IN_PROGRESS",
      isOpenForSchedule: !isDone,
      statusLabel: st === "ISSUED" ? "Đang theo dõi giao hàng" : st === "PARTIALLY_RECEIVED" ? "Đã nhận một phần" : st,
      priority: "MEDIUM",
      dueDate: toIsoDateStr(po.expected_date),
      location: po.supplier_name || "Kho Nhà Máy",
      assignees: refs.assignees,
      assigneeUserIds: refs.assigneeUserIds,
      metaSummary: po.notes ? String(po.notes).slice(0, 70) : `NCC ${po.supplier_name}`,
      includeInTaskBoard: true,
      updatedAt: po.updated_at ? String(po.updated_at) : null,
    });
  }

  const internalOrderRows = await safeTxQuery(
    tx,
    sp,
    `SELECT io.id, io.code, io.kd_po_code, io.kd_so_code, io.org_unit_id, io.ship_mode, io.ship_to,
            io.requested_date, io.committed_date, io.notes, io.status, io.created_by, io.updated_at
       FROM intake.internal_order io
      WHERE io.status NOT IN ('CLOSED', 'REJECTED', 'CANCELLED', 'DELIVERED')
         OR io.updated_at >= now() - interval '30 days'
      ORDER BY coalesce(io.committed_date, io.requested_date) ASC NULLS LAST, io.updated_at DESC
      LIMIT 80`
  );
  for (const io of internalOrderRows) {
    const prodMeta = resolveOrgMeta(io.org_unit_id, orgMap, "KIT");
    const st = String(io.status || "RECEIVED").toUpperCase();
    if (st === "REJECTED" || st === "CANCELLED") continue;
    const isDone = st === "CLOSED" || st === "DELIVERED";
    const shipCustomer = io.ship_to && typeof io.ship_to === "object" ? String((io.ship_to as any).customer_name || (io.ship_to as any).name || "") : "";
    const refs = resolveUserRefs([io.created_by], [], userMap);

    workItems.push({
      uid: `internal_order:${io.id}`,
      code: String(io.code),
      title: `Đơn Nội Bộ ${io.code} (${io.kd_po_code}) → ${prodMeta.dept}`,
      domainGroup: "QA_WH_PUR",
      sourceType: "INTERNAL_ORDER",
      typeLabel: "📑 Đơn Nội Bộ",
      dept: "Đơn Nội Bộ",
      involvedDepts: dedupeStrings(["Đơn Nội Bộ", prodMeta.dept, "Kinh Doanh"]),
      targetTab: "factory-orders",
      kanbanStatus: isDone ? "DONE" : st === "RECEIVED" ? "TODO" : "IN_PROGRESS",
      isOpenForSchedule: !isDone,
      statusLabel: st === "RECEIVED" ? "Mới từ Kinh Doanh" : st === "ACCEPTED" ? "Đã nhận đơn" : st === "IN_PRODUCTION" ? "Đang sản xuất" : st === "READY" ? "Sẵn sàng bàn giao" : st,
      priority: "HIGH",
      dueDate: toIsoDateStr(io.committed_date) || toIsoDateStr(io.requested_date),
      location: shipCustomer || prodMeta.defaultLocation,
      assignees: refs.assignees,
      assigneeUserIds: refs.assigneeUserIds,
      metaSummary: `${io.kd_po_code}${io.kd_so_code ? ` · SO ${io.kd_so_code}` : ""}`,
      includeInTaskBoard: true,
      updatedAt: io.updated_at ? String(io.updated_at) : null,
    });
  }

  // 12. Technical Department Weekly Plans (`plan.task` + `work.work_plan` & `work.work_task`)
  const todayStr = vnToday();
  const planMinDate = addDaysIso(todayStr, -14);
  const planMaxDate = addDaysIso(todayStr, 28);

  const planTaskRows = await safeTxQuery(
    tx,
    sp,
    `SELECT id, org_unit_id, kind, title, assignee_id, work_date, start_time, end_time, notes, ref_type, ref_id, status, created_by, updated_at
       FROM plan.task
      WHERE status <> 'CANCELLED'
        AND work_date BETWEEN $1::date AND $2::date
      ORDER BY work_date ASC, start_time ASC
      LIMIT 150`,
    [planMinDate, planMaxDate]
  );
  for (const pt of planTaskRows) {
    const om = resolveOrgMeta(pt.org_unit_id, orgMap, "OLIGO");
    const iso = toIsoDateStr(pt.work_date) || todayStr;
    const refs = resolveUserRefs([pt.assignee_id, pt.created_by], [], userMap);
    const st = String(pt.status || "TODO").toUpperCase();
    const isDone = st === "DONE";
    const startHhmm = String(pt.start_time || "08:00").slice(0, 5);
    const endHhmm = String(pt.end_time || "17:00").slice(0, 5);

    weeklyPlans.push({
      id: `factory-plan-${pt.id}`,
      date: iso,
      day: dayNameFromIso(iso),
      time: `${startHhmm} - ${endHhmm}`,
      category: om.dept,
      title: `[${pt.kind}] ${pt.title}`,
      actor: refs.assignees[0] || `Kế hoạch ${om.dept}`,
      actorUserId: pt.assignee_id ? Number(pt.assignee_id) : null,
      location: om.defaultLocation,
      linkedTaskCodes: pt.ref_id ? [String(pt.ref_id)] : [],
      isHubWeeklyPlan: true,
      sourceLabel: `🏭 Kế hoạch ${om.dept}`,
      targetTab: om.targetTab,
    });

    if (!isDone) {
      workItems.push({
        uid: `plan_task:${pt.id}`,
        code: `PLN-${String(pt.id).slice(0, 6).toUpperCase()}`,
        title: String(pt.title),
        domainGroup: domainGroupForDept(om.dept),
        sourceType: "PLAN_TASK",
        typeLabel: "📆 Lịch phân công KT",
        dept: om.dept,
        involvedDepts: [om.dept],
        targetTab: om.targetTab,
        kanbanStatus: st === "IN_PROGRESS" ? "IN_PROGRESS" : "TODO",
        isOpenForSchedule: true,
        statusLabel: st === "IN_PROGRESS" ? "Đang thực hiện" : "Kế hoạch ngày",
        priority: "MEDIUM",
        dueDate: iso,
        location: om.defaultLocation,
        assignees: refs.assignees,
        assigneeUserIds: refs.assigneeUserIds,
        metaSummary: `${iso} ${startHhmm}-${endHhmm}${pt.notes ? ` · ${String(pt.notes).slice(0, 50)}` : ""}`,
        includeInTaskBoard: false,
        updatedAt: pt.updated_at ? String(pt.updated_at) : null,
      });
    }
  }

  const rdWeeklyTaskRows = await safeTxQuery(
    tx,
    sp,
    `SELECT wt.id, wt.title, wt.day_of_week, wt.time_slot, wt.target_metric, wt.status,
            wp.code AS plan_code, wp.user_id, wp.org_unit_id, wp.week_start, wp.status AS plan_status,
            p.code AS project_code, e.code AS exp_code
       FROM work.work_task wt
       JOIN work.work_plan wp ON wp.id = wt.plan_id
       LEFT JOIN rd.project p ON p.id = wt.project_id
       LEFT JOIN rd.experiment e ON e.id = wt.experiment_id
      WHERE wp.week_start BETWEEN $1::date AND $2::date
        AND wt.status NOT IN ('DEFERRED', 'REPLACED')
      ORDER BY wp.week_start DESC, wt.day_of_week ASC
      LIMIT 150`,
    [addDaysIso(todayStr, -21), addDaysIso(todayStr, 28)]
  );
  for (const wt of rdWeeklyTaskRows) {
    const om = resolveOrgMeta(wt.org_unit_id, orgMap, "RD");
    const weekStartIso = toIsoDateStr(wt.week_start) || todayStr;
    const dow = Math.max(1, Math.min(7, Number(wt.day_of_week || 1)));
    const eventIso = addDaysIso(weekStartIso, dow - 1);
    const refs = resolveUserRefs([wt.user_id], [], userMap);
    const st = String(wt.status || "PLANNED").toUpperCase();
    const isDone = st === "DONE";
    const linkedCodes = dedupeStrings([wt.project_code, wt.exp_code]);

    weeklyPlans.push({
      id: `rd-worktask-${wt.id}`,
      date: eventIso,
      day: dayNameFromIso(eventIso),
      time: wt.time_slot === "MORNING" ? "08:00 - 12:00" : wt.time_slot === "AFTERNOON" ? "13:30 - 17:30" : wt.time_slot && wt.time_slot !== "ALL_DAY" ? String(wt.time_slot) : "08:00 - 17:30",
      category: om.dept,
      title: String(wt.title),
      actor: refs.assignees[0] || `Nhân sự ${om.dept}`,
      actorUserId: Number(wt.user_id) || null,
      location: om.defaultLocation,
      linkedTaskCodes: linkedCodes,
      isHubWeeklyPlan: true,
      sourceLabel: `📅 Kế hoạch tuần ${wt.plan_code}`,
      targetTab: om.targetTab,
    });

    if (!isDone) {
      workItems.push({
        uid: `work_task:${wt.id}`,
        code: `${wt.plan_code}-D${dow}`,
        title: String(wt.title),
        domainGroup: domainGroupForDept(om.dept),
        sourceType: "WORK_TASK",
        typeLabel: "📅 Việc kế hoạch tuần KT",
        dept: om.dept,
        involvedDepts: [om.dept],
        targetTab: om.targetTab,
        kanbanStatus: st === "IN_PROGRESS" ? "IN_PROGRESS" : "TODO",
        isOpenForSchedule: true,
        statusLabel: st === "IN_PROGRESS" ? "Đang thực hiện" : "Kế hoạch tuần KT",
        priority: "MEDIUM",
        dueDate: eventIso,
        location: om.defaultLocation,
        assignees: refs.assignees,
        assigneeUserIds: refs.assigneeUserIds,
        metaSummary: wt.target_metric || linkedCodes.join(", ") || `Kế hoạch ${wt.plan_code}`,
        includeInTaskBoard: false,
      });
    }
  }

  return {
    workItems,
    projects,
    weeklyPlans,
    currentUserFactoryDept,
    userFactoryDepts: Array.from(userFactoryDeptsSet),
  };
}

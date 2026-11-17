import { NextResponse } from "next/server";
import { query } from "@/backend/db/db";
import { getAuthorizedUser, isAdminUser, unauthorizedResponse } from "@/backend/services/authz";
import { normalizeWorkspaceDept, sameStaffName } from "@/backend/services/workspaceTasks";
import { getFactoryPool, withTransaction } from "@/factory/core/db";
import { migrate } from "@/factory/db/migrate";
import {
  getFactoryWorkhubData,
  type HubProject,
  type HubWeeklyPlanEvent,
  type HubWorkItem,
} from "@/factory/workhub/service";

let startupMigrationPromise: Promise<unknown> | null = null;
async function ensureFactoryMigrated(): Promise<void> {
  if (process.env.VITEST) return;
  if (!startupMigrationPromise) {
    startupMigrationPromise = migrate(getFactoryPool()).catch((err) => {
      startupMigrationPromise = null;
      throw err;
    });
  }
  await startupMigrationPromise;
}

function toIsoDate(val: any): string | null {
  if (!val) return null;
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10);
  }
  const m = String(val).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function normPriority(raw: any): "URGENT" | "HIGH" | "MEDIUM" | "LOW" {
  const p = String(raw || "").trim().toUpperCase();
  if (p === "URGENT" || p === "CRITICAL") return "URGENT";
  if (p === "HIGH") return "HIGH";
  if (p === "LOW") return "LOW";
  return "MEDIUM";
}

function splitStaffNames(raw: any): string[] {
  return String(raw || "")
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function fetchPortalTechnicalItems(): Promise<HubWorkItem[]> {
  const items: HubWorkItem[] = [];

  try {
    const appTaskRes = await query(
      `SELECT id, task_code, title, assignee_name, customer_name, task_type, priority, status, deadline, created_at
         FROM application_tasks
        WHERE UPPER(COALESCE(status, 'TODO')) <> 'CANCELLED'
        ORDER BY id DESC
        LIMIT 120`
    );
    for (const r of appTaskRes.rows) {
      const st = String(r.status || "TODO").toUpperCase();
      const isDone = st === "DONE" || st === "COMPLETED";
      items.push({
        uid: `app_task:${r.id}`,
        code: String(r.task_code || `APP-${r.id}`),
        title: String(r.title || "Công việc Application"),
        domainGroup: "APP_LEGAL",
        sourceType: "APP_TASK",
        typeLabel: `🔬 ${r.task_type || "Application"}`,
        dept: "Application",
        involvedDepts: ["Application"],
        targetTab: "application",
        kanbanStatus: isDone ? "DONE" : st === "IN_PROGRESS" ? "IN_PROGRESS" : "TODO",
        isOpenForSchedule: !isDone,
        statusLabel: isDone ? "Hoàn tất" : st === "IN_PROGRESS" ? "Đang triển khai" : "Kế hoạch Application",
        priority: normPriority(r.priority),
        dueDate: toIsoDate(r.deadline),
        location: String(r.customer_name || "Phòng Application"),
        assignees: splitStaffNames(r.assignee_name),
        assigneeUserIds: [],
        metaSummary: String(r.customer_name || r.task_type || "Application"),
        includeInTaskBoard: true,
        updatedAt: r.created_at ? String(r.created_at) : null,
      });
    }
  } catch {
    // optional portal table guard
  }

  try {
    const appIssueRes = await query(
      `SELECT id, ticket_code, customer_name, device_name, issue_description, severity, status, assigned_technician, created_at
         FROM application_issues
        WHERE UPPER(COALESCE(status, 'OPEN')) NOT IN ('CLOSED', 'RESOLVED', 'CANCELLED')
           OR created_at >= NOW() - INTERVAL '30 days'
        ORDER BY id DESC
        LIMIT 80`
    );
    for (const r of appIssueRes.rows) {
      const st = String(r.status || "OPEN").toUpperCase();
      const isDone = st === "CLOSED" || st === "RESOLVED";
      items.push({
        uid: `app_issue:${r.id}`,
        code: String(r.ticket_code || `INC-${r.id}`),
        title: `Hỗ trợ KT ${r.customer_name}${r.device_name ? ` (${r.device_name})` : ""}: ${String(r.issue_description || "").slice(0, 70)}`,
        domainGroup: "APP_LEGAL",
        sourceType: "APP_ISSUE",
        typeLabel: "🛠️ Sự cố KT tại viện",
        dept: "Application",
        involvedDepts: ["Application", "Kỹ Thuật – Thiết Bị"],
        targetTab: "application",
        kanbanStatus: isDone ? "DONE" : st === "OPEN" ? "TODO" : "IN_PROGRESS",
        isOpenForSchedule: !isDone,
        statusLabel: isDone ? "Đã xử lý" : st === "IN_PROGRESS" ? "Đang khắc phục" : "Mới tiếp nhận",
        priority: normPriority(r.severity),
        dueDate: null,
        location: String(r.customer_name || "Tại bệnh viện / Viện"),
        assignees: splitStaffNames(r.assigned_technician),
        assigneeUserIds: [],
        metaSummary: `${r.customer_name}${r.device_name ? ` · ${r.device_name}` : ""}`,
        includeInTaskBoard: true,
        updatedAt: r.created_at ? String(r.created_at) : null,
      });
    }
  } catch {
    // optional portal table guard
  }

  try {
    const techCareRes = await query(
      `SELECT id, customer_name, contact_name, activity_type, performed_by, next_followup_date, next_followup_note, created_at
         FROM tech_care_logs
        WHERE followup_done = FALSE
          AND next_followup_date IS NOT NULL
        ORDER BY next_followup_date ASC
        LIMIT 80`
    );
    for (const r of techCareRes.rows) {
      items.push({
        uid: `tech_care:${r.id}`,
        code: `CSKT-${r.id}`,
        title: `Hẹn chăm sóc KT: ${r.customer_name} (${r.activity_type})`,
        domainGroup: "APP_LEGAL",
        sourceType: "TECH_CARE",
        typeLabel: "📞 Chăm sóc KT",
        dept: "Application",
        involvedDepts: ["Application"],
        targetTab: "application",
        kanbanStatus: "TODO",
        isOpenForSchedule: true,
        statusLabel: "Hẹn Follow-up KT",
        priority: "MEDIUM",
        dueDate: toIsoDate(r.next_followup_date),
        location: String(r.customer_name || ""),
        assignees: splitStaffNames(r.performed_by),
        assigneeUserIds: [],
        metaSummary: r.next_followup_note ? String(r.next_followup_note).slice(0, 75) : String(r.contact_name || r.activity_type || ""),
        includeInTaskBoard: true,
        updatedAt: r.created_at ? String(r.created_at) : null,
      });
    }
  } catch {
    // optional portal table guard
  }

  try {
    const storageRes = await query(
      `SELECT key, data FROM app_storage WHERE key IN ('legal_tenders', 'legal_contracts')`
    );
    for (const row of storageRes.rows) {
      const list = Array.isArray(row.data) ? row.data : [];
      if (row.key === "legal_tenders") {
        for (const t of list) {
          const st = String(t?.status || "").toUpperCase();
          if (!["DANG_RA_SOAT", "CHO_THAM_DINH", "CHUAN_BI", "PENDING"].includes(st)) continue;
          const rawDue = String(t?.submissionDeadline || "").trim();
          const ddmmyyyy = rawDue.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
          const dueDate = ddmmyyyy ? `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}` : toIsoDate(rawDue);
          items.push({
            uid: `legal_tender:${t.id || t.code}`,
            code: String(t.code || t.id || "TENDER"),
            title: `Hồ sơ thầu ${t.hospitalName || ""}: ${String(t.packageName || "").slice(0, 75)}`,
            domainGroup: "APP_LEGAL",
            sourceType: "LEGAL_ITEM",
            typeLabel: "⚖️ Thầu Pháp Chế",
            dept: "Pháp Chế",
            involvedDepts: ["Pháp Chế", "Kinh Doanh"],
            targetTab: "legal",
            kanbanStatus: "IN_PROGRESS",
            isOpenForSchedule: true,
            statusLabel: st === "DANG_RA_SOAT" ? "Đang rà soát hồ sơ" : "Chuẩn bị nộp thầu",
            priority: "HIGH",
            dueDate,
            location: String(t.hospitalName || "Phòng Pháp Chế"),
            assignees: splitStaffNames(t.assignedLawyer),
            assigneeUserIds: [],
            metaSummary: `${t.hospitalName || ""}${t.bidValue ? ` · ${t.bidValue}` : ""}`,
            includeInTaskBoard: true,
          });
        }
      } else if (row.key === "legal_contracts") {
        for (const c of list) {
          const st = String(c?.status || "").toUpperCase();
          if (!["DANG_RA_SOAT", "CHO_THAM_DINH", "CHUAN_BI", "PENDING"].includes(st)) continue;
          const relDept = c.department ? normalizeWorkspaceDept(c.department) : "";
          items.push({
            uid: `legal_contract:${c.id || c.code}`,
            code: String(c.code || c.id || "CONTRACT"),
            title: `Thẩm định HĐ: ${String(c.title || c.partnerName || "").slice(0, 75)}`,
            domainGroup: "APP_LEGAL",
            sourceType: "LEGAL_ITEM",
            typeLabel: "⚖️ Hợp đồng Pháp Chế",
            dept: "Pháp Chế",
            involvedDepts: Array.from(new Set(["Pháp Chế", ...(relDept ? [relDept] : [])])),
            targetTab: "legal",
            kanbanStatus: "IN_PROGRESS",
            isOpenForSchedule: true,
            statusLabel: "Đang thẩm định HĐ",
            priority: "HIGH",
            dueDate: null,
            location: String(c.partnerName || "Phòng Pháp Chế"),
            assignees: splitStaffNames([c.assignedLawyer, c.requester].filter(Boolean).join(", ")),
            assigneeUserIds: [],
            metaSummary: `${c.partnerName || ""}${c.value ? ` · ${c.value}` : ""}`,
            includeInTaskBoard: true,
          });
        }
      }
    }
  } catch {
    // optional storage guard
  }

  return items;
}

export async function GET(req: Request) {
  const authUser = await getAuthorizedUser(req);
  if (!authUser) return unauthorizedResponse();

  const userId = Number(authUser.id);
  const fullName = String(authUser.full_name || authUser.username || "").trim();
  const rawRole = String(authUser.role || "").toLowerCase();
  const rawDept = String(authUser.department || "");
  const isDirector =
    isAdminUser(authUser) ||
    rawRole === "admin" ||
    rawRole.includes("director") ||
    rawRole.includes("giám đốc") ||
    rawDept.toLowerCase().includes("giám đốc");

  let factoryData = {
    workItems: [] as HubWorkItem[],
    projects: [] as HubProject[],
    weeklyPlans: [] as HubWeeklyPlanEvent[],
    currentUserFactoryDept: null as string | null,
    userFactoryDepts: [] as string[],
  };

  try {
    await ensureFactoryMigrated();
    factoryData = await withTransaction((tx) => getFactoryWorkhubData(tx, userId));
  } catch (err: any) {
    console.warn("[workhub] Factory DB query fallback:", err?.message || err);
  }

  const portalItems = await fetchPortalTechnicalItems();
  const allWorkItems = [...factoryData.workItems, ...portalItems];

  const portalNormalizedDepts = rawDept
    .split(/[,;\n]+/)
    .map((d) => normalizeWorkspaceDept(d.trim()))
    .filter((d) => d && d !== "Ban Giám Đốc");

  const allowedDepts = new Set<string>([
    ...portalNormalizedDepts,
    ...(factoryData.currentUserFactoryDept ? [factoryData.currentUserFactoryDept] : []),
    ...factoryData.userFactoryDepts,
  ]);

  const isVisibleItem = (item: HubWorkItem) => {
    if (isDirector) return true;
    if (Number.isFinite(userId) && item.assigneeUserIds.includes(userId)) return true;
    if (fullName && item.assignees.some((a) => sameStaffName(a, fullName))) return true;
    if (item.involvedDepts.some((d) => allowedDepts.has(d)) || allowedDepts.has(item.dept)) return true;
    return false;
  };

  const isVisibleProject = (prj: HubProject) => {
    if (isDirector) return true;
    if (Number.isFinite(userId) && (prj.leadUserId === userId || prj.memberUserIds.includes(userId))) return true;
    if (fullName && (sameStaffName(prj.lead, fullName) || prj.collaborators.some((c) => sameStaffName(c, fullName)))) return true;
    if (allowedDepts.has(prj.dept) || prj.participatingDepts.some((d) => allowedDepts.has(d))) return true;
    return false;
  };

  const isVisiblePlan = (ev: HubWeeklyPlanEvent) => {
    if (isDirector) return true;
    if (Number.isFinite(userId) && ev.actorUserId === userId) return true;
    if (fullName && sameStaffName(ev.actor, fullName)) return true;
    if (allowedDepts.has(ev.category)) return true;
    return false;
  };

  const workItems = allWorkItems.filter(isVisibleItem);
  const projects = factoryData.projects.filter(isVisibleProject);
  const weeklyPlans = factoryData.weeklyPlans.filter(isVisiblePlan);

  const openBoardItems = workItems.filter((w) => w.includeInTaskBoard && w.kanbanStatus !== "DONE");
  const deptOpenCounts: Record<string, number> = {};
  for (const w of openBoardItems) {
    deptOpenCounts[w.dept] = (deptOpenCounts[w.dept] || 0) + 1;
  }

  return NextResponse.json({
    ok: true,
    currentUserDept: factoryData.currentUserFactoryDept || portalNormalizedDepts[0] || null,
    userFactoryDepts: factoryData.userFactoryDepts,
    workItems,
    projects,
    weeklyPlans,
    blockSummary: {
      rdOpen: openBoardItems.filter((w) => w.domainGroup === "RD").length,
      rdProjectsActive: projects.filter((p) => p.dept === "Nghiên Cứu R&D" && p.status !== "Completed").length,
      kitOligoOpen: openBoardItems.filter((w) => w.domainGroup === "KIT_OLIGO").length,
      deviceOpen: openBoardItems.filter((w) => w.domainGroup === "DEVICE").length,
      deviceProjectsActive: projects.filter((p) => p.dept === "Kỹ Thuật – Thiết Bị" && p.status !== "Completed").length,
      qaWhPurOpen: openBoardItems.filter((w) => w.domainGroup === "QA_WH_PUR").length,
      appLegalOpen: openBoardItems.filter((w) => w.domainGroup === "APP_LEGAL").length,
      deptOpenCounts,
    },
  });
}

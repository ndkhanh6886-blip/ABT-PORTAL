import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/backend/services/apiErrors";
import { query, withTransaction } from "@/backend/db/db";
import { getAuthorizedUser, isAdminUser, setAuditActor, unauthorizedResponse } from "@/backend/services/authz";
import { getFactoryPool, withTransaction as withFactoryTx } from "@/factory/core/db";
import { markRead as markFactoryNotificationsRead } from "@/factory/core/notifications";
import { FACTORY_NOTICE_EVENTS, factoryNoticeKey } from "@/factory/noticeMatrix";

export const dynamic = "force-dynamic";

function resolveDefaultFactoryRoles(type: string, category: string): string[] {
  const t = (type || "").toUpperCase();
  const def = FACTORY_NOTICE_EVENTS.find((e) => e.type.toUpperCase() === t);
  if (def?.defaultRoles && def.defaultRoles.length > 0) {
    return [...def.defaultRoles];
  }
  const dept = def?.dept || "";
  switch (dept) {
    case "Đơn Nội Bộ":
      return ["factory_intake", "factory_kit", "factory_oligo", "factory_device", "sales_head"];
    case "Nghiên cứu R&D": {
      const roles = ["factory_rd"];
      if (t.includes("GATE") || t.includes("HOLD") || t.includes("KILL") || t.includes("APPROVE")) roles.push("admin");
      if (t.includes("TECH_TRANSFER")) roles.push("factory_kit", "factory_qa");
      return roles;
    }
    case "Sản xuất Kit": {
      const roles = ["factory_kit"];
      if (t.includes("QC") || t.includes("QA") || t.includes("EBR") || t.includes("BOM") || t.includes("ROUTING")) roles.push("factory_qa");
      if (t.includes("FAIL_QC")) roles.push("admin");
      return roles;
    }
    case "Tổng hợp Oligo": {
      const roles = ["factory_oligo"];
      if (t.includes("QC")) roles.push("factory_qa");
      if (t.includes("QC_PASSED")) roles.push("factory_intake");
      return roles;
    }
    case "Kỹ thuật – Thiết bị": {
      const roles = ["factory_device"];
      if (t.includes("FQC") || t.includes("QA") || t.includes("VALIDATION") || t.includes("ECO")) roles.push("factory_qa");
      if (t.includes("COMPLETE_PQ") || t.includes("ECO_SUBMIT")) roles.push("admin");
      return roles;
    }
    case "QA/QC": {
      const roles = ["factory_qa", "qa_qc"];
      if (t.includes("CONCESSION") || t.includes("DEVIATION") || t.includes("NCR")) roles.push("admin");
      if (t.includes("IQC")) roles.push("factory_wh");
      return roles;
    }
    case "Kho Nhà máy": {
      const roles = ["factory_wh", "factory_qa"];
      if (t.includes("REJECT")) roles.push("factory_purchase");
      if (t.includes("RECONCILE")) roles.push("accountant", "admin");
      return roles;
    }
    case "Mua hàng Nhà máy": {
      const roles = ["factory_purchase"];
      if (t.includes("ESCALATE") || t.includes("BOD")) roles.push("admin");
      if (t.includes("APPROVE") || t.includes("MRP") || t.includes("DELIVERY")) roles.push("factory_wh");
      return roles;
    }
    default:
      return [category || "factory_qa"];
  }
}

function resolveMatrixRule(
  eventKey: string | undefined,
  storedMatrix: Record<string, any>,
  fallbackRoles: string[]
): {
  enabled: boolean;
  targetRoles: string[];
  targetEmployeeNames: string[];
  targetEmployeeIds: string[];
} {
  const cfg = eventKey && storedMatrix && typeof storedMatrix === "object" ? storedMatrix[eventKey] : undefined;
  if (cfg && typeof cfg === "object") {
    return {
      enabled: typeof cfg.enabled === "boolean" ? cfg.enabled : true,
      targetRoles: Array.isArray(cfg.targetRoles) ? cfg.targetRoles : fallbackRoles,
      targetEmployeeNames: Array.isArray(cfg.targetEmployeeNames) ? cfg.targetEmployeeNames : [],
      targetEmployeeIds: Array.isArray(cfg.targetEmployeeIds) ? cfg.targetEmployeeIds : [],
    };
  }
  return {
    enabled: true,
    targetRoles: fallbackRoles,
    targetEmployeeNames: [],
    targetEmployeeIds: [],
  };
}

function toIso(val: any, fallback?: string): string {
  if (!val) return fallback ?? new Date().toISOString();
  try {
    const d = new Date(val);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  } catch {
    // ignore parse error
  }
  return fallback ?? new Date().toISOString();
}

function splitNames(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x || "").trim()).filter(Boolean);
  }
  return String(raw)
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function inferFactoryCategory(type: string, link?: string | null): string {
  const t = (type || "").toUpperCase();
  const l = (link || "").toLowerCase();
  if (l.includes("factory-rd") || t.startsWith("RD_")) return "factory_rd";
  if (l.includes("factory-kit") || t.startsWith("KIT_")) return "factory_kit";
  if (l.includes("factory-oligo") || t.startsWith("OLIGO_") || t.startsWith("SYNTHESIS_")) return "factory_oligo";
  if (l.includes("factory-device") || t.startsWith("DEVICE_") || t.startsWith("ASSET_") || t.startsWith("RD_SW_")) return "factory_device";
  if (l.includes("factory-qa") || t.startsWith("QC_") || t.startsWith("NCR_") || t.startsWith("QMS_") || t.startsWith("IQC_")) return "quality";
  if (l.includes("factory-warehouse") || t.startsWith("LOT_") || t.startsWith("FEFO_") || t.startsWith("INV_") || t.startsWith("FINISHED_LOT")) return "factory_warehouse";
  if (l.includes("factory-purchase") || t.startsWith("PURCHASE_") || t.startsWith("MRP_") || t.startsWith("FACTORY_PO")) return "factory_procurement";
  if (l.includes("internal-orders") || t.startsWith("INTERNAL_ORDER")) return "factory_intake";
  return "factory_rd";
}

function extractCodes(text: string): string[] {
  const matches = text.match(/\b(?:WF\d*|TSK|TASK|PR\d*|PO\d*|BG\d*|SO\d*|HD\d*|DXNP|DX|DNTT|DNTU|QT|TTR|DXM|EXP|PRJ)-[A-Z0-9-]+\b/gi);
  return matches ? matches.map((m) => m.toUpperCase()) : [];
}

function extractTabFromLinkUrl(linkUrl?: string | null): { tab: string; itemId?: string } | undefined {
  if (!linkUrl) return undefined;
  try {
    const u = new URL(linkUrl, "http://localhost");
    const tab = u.searchParams.get("tab");
    const itemId = u.searchParams.get("id") || u.searchParams.get("lot") || u.searchParams.get("code") || undefined;
    if (tab) return { tab, itemId };
  } catch {
    // ignore malformed URL
  }
  return undefined;
}

const TASK_STATUS_VI: Record<string, string> = {
  TODO: "Cần làm",
  IN_PROGRESS: "Đang thực hiện",
  DONE: "Hoàn thành",
  CANCELLED: "Đã hủy",
};

const WF_STATUS_VI: Record<string, string> = {
  PENDING: "Chờ tiếp nhận",
  IN_PROGRESS: "Đang xử lý",
  COMPLETED: "Hoàn tất",
  REJECTED: "Từ chối",
  CANCELLED: "Đã hủy",
};

const PROPOSAL_STATUS_VI: Record<string, string> = {
  PENDING: "Chờ phê duyệt",
  RETURNED: "Trả lại chỉnh sửa",
  APPROVED: "Đã phê duyệt",
  EXECUTED: "Đã thực thi",
  REJECTED: "Từ chối",
};

export async function GET(req: NextRequest) {
  try {
    const me = await getAuthorizedUser(req);
    if (!me) return unauthorizedResponse();
    setAuditActor(me);
    const admin = isAdminUser(me);
    const meId = Number(me.id);
    const meReaderKeys = [(me as any).email, me.username, me.full_name, "current_viewer", "mine_viewer"]
      .map((s) => String(s || "").trim())
      .filter(Boolean);

    const [
      storageRes,
      tasksRes,
      wfRes,
      dailyRes,
      factoryNotifRes,
      rdProjectsRes,
      rdExpRes,
      birthdaysRes,
    ] = await Promise.all([
      query(
        `SELECT key, data FROM app_storage
          WHERE key = ANY($1::text[])`,
        [["tbr_activity_notifications", "workspace_proposals", "notification_read_receipts", "system_notification_matrix"]]
      ).catch(() => ({ rows: [] as any[] })),

      query(
        `SELECT id, task_code, title, department, task_category, assignee_name, status, created_by_name, created_at, updated_at
           FROM company_tasks
          ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST, id DESC
          LIMIT 80`
      ).catch(() => ({ rows: [] as any[] })),

      query(
        `SELECT id, workflow_code, workflow_type, title, requester_name, requester_dept, assignee_name, target_dept, status, created_at, updated_at
           FROM workflow_requests
          ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST, id DESC
          LIMIT 60`
      ).catch(() => ({ rows: [] as any[] })),

      query(
        `SELECT id, log_date, department, employee_name, work_content, result, issues, created_at
           FROM company_daily_logs
          ORDER BY log_date DESC NULLS LAST, id DESC
          LIMIT 30`
      ).catch(() => ({ rows: [] as any[] })),

      (async () => {
        try {
          const pool = getFactoryPool();
          if (admin) {
            return await pool.query(
              `SELECT DISTINCT ON (COALESCE(n.source_key, n.type || ':' || n.title || ':' || COALESCE(n.entity_id, n.id::text)))
                      n.id, n.user_id, n.type, n.title, n.body, n.entity_type, n.entity_id, n.link, n.source_key, n.read_at, n.created_at,
                      up.display_name AS recipient_name
                 FROM core.notification n
                 LEFT JOIN core.user_profile up ON up.user_id = n.user_id
                ORDER BY COALESCE(n.source_key, n.type || ':' || n.title || ':' || COALESCE(n.entity_id, n.id::text)),
                         CASE WHEN n.user_id = $1 THEN 0 ELSE 1 END,
                         n.created_at DESC
                LIMIT 100`,
              [meId]
            );
          }
          return await pool.query(
            `SELECT n.id, n.user_id, n.type, n.title, n.body, n.entity_type, n.entity_id, n.link, n.source_key, n.read_at, n.created_at,
                    up.display_name AS recipient_name
               FROM core.notification n
               LEFT JOIN core.user_profile up ON up.user_id = n.user_id
              WHERE n.user_id = $1
              ORDER BY n.created_at DESC
              LIMIT 80`,
            [meId]
          );
        } catch {
          return { rows: [] as any[] };
        }
      })(),

      (async () => {
        try {
          return await getFactoryPool().query(
            `SELECT p.id, p.code, p.name, p.target_domain, p.status, p.current_stage, p.created_at, p.updated_at,
                    u.name AS dept_name,
                    coalesce(nullif(p.leader_name_override, ''), l.display_name) AS leader_name
               FROM rd.project p
               JOIN core.org_unit u ON u.id = p.owner_org_unit_id
               LEFT JOIN core.user_profile l ON l.user_id = p.leader_id
              ORDER BY COALESCE(p.updated_at, p.created_at) DESC
              LIMIT 25`
          );
        } catch {
          return { rows: [] as any[] };
        }
      })(),

      (async () => {
        try {
          return await getFactoryPool().query(
            `SELECT e.id, e.code, e.title, e.status, e.created_at, e.updated_at,
                    coalesce(nullif(e.performer_name, ''), up.display_name) AS performer_name
               FROM rd.experiment e
               LEFT JOIN core.user_profile up ON up.user_id = coalesce(e.submitted_by, e.created_by)
              ORDER BY COALESCE(e.updated_at, e.created_at) DESC
              LIMIT 25`
          );
        } catch {
          return { rows: [] as any[] };
        }
      })(),

      (async () => {
        try {
          await query("ALTER TABLE personnel ADD COLUMN IF NOT EXISTS date_of_birth DATE").catch(() => {});
          return await query(
            `SELECT id, employee_code, full_name, department, position, date_of_birth::text AS date_of_birth
               FROM personnel
              WHERE date_of_birth IS NOT NULL
                AND (status IS NULL OR (UPPER(status) <> 'INACTIVE' AND UPPER(status) <> 'RESIGNED'))
              ORDER BY id ASC`
          );
        } catch {
          return { rows: [] as any[] };
        }
      })(),
    ]);

    const storageMap = new Map<string, any>();
    for (const r of storageRes.rows) {
      storageMap.set(r.key, r.data);
    }

    const storedRaw = storageMap.get("tbr_activity_notifications");
    const storedList: any[] = Array.isArray(storedRaw) ? storedRaw : [];
    const proposalsRaw = storageMap.get("workspace_proposals");
    const proposalsList: any[] = Array.isArray(proposalsRaw) ? proposalsRaw : [];
    const proposalByCode = new Map<string, any>();
    for (const p of proposalsList) {
      if (p?.proposalCode) proposalByCode.set(String(p.proposalCode).toUpperCase(), p);
    }

    let storedListCleaned = false;
    for (const n of storedList) {
      if (Array.isArray(n?.targetEmployeeNames) && n.targetEmployeeNames.length > 12) {
        const codes = extractCodes(`${n?.title || ""} ${n?.message || ""}`);
        const matchedProp = codes.map((c) => proposalByCode.get(c)).find(Boolean);
        if (matchedProp) {
          const steps: any[] = Array.isArray(matchedProp.steps) ? matchedProp.steps : [];
          const stepApprovers = steps.flatMap((s) => splitNames(s?.decidedBy || s?.approverName));
          const cleanTargets = Array.from(
            new Set([
              ...splitNames(matchedProp.requesterName),
              ...stepApprovers,
              ...(Array.isArray(matchedProp.followers) ? matchedProp.followers : []),
            ].filter(Boolean))
          );
          n.targetEmployeeNames = cleanTargets;
          storedListCleaned = true;
        } else {
          const titleColon = String(n?.title || "").split(":").slice(1).join(":").trim();
          n.targetEmployeeNames = titleColon ? [titleColon] : [];
          storedListCleaned = true;
        }
      }
    }
    if (storedListCleaned) {
      query(
        `UPDATE app_storage SET data = $2::jsonb, updated_at = CURRENT_TIMESTAMP WHERE key = $1`,
        ["tbr_activity_notifications", JSON.stringify(storedList)]
      ).catch(() => {});
    }

    const receiptsRaw = storageMap.get("notification_read_receipts");
    const receipts: Record<string, string[]> =
      receiptsRaw && typeof receiptsRaw === "object" && !Array.isArray(receiptsRaw) ? receiptsRaw : {};
    const matrixRaw = storageMap.get("system_notification_matrix");
    const storedMatrix: Record<string, any> =
      matrixRaw && typeof matrixRaw === "object" && !Array.isArray(matrixRaw) ? matrixRaw : {};

    const coveredCodes = new Set<string>();
    for (const n of storedList) {
      const candidates = [n?.taskId, n?.workflowCode, n?.workflowId, n?.orderCode, n?.targetId, n?.link?.itemId]
        .filter(Boolean)
        .map((x) => String(x).toUpperCase());
      candidates.forEach((c) => coveredCodes.add(c));
      extractCodes(`${n?.title || ""} ${n?.message || ""}`).forEach((c) => coveredCodes.add(c));
    }

    const feed: any[] = [];
    for (const rawN of storedList) {
      if (!rawN) continue;
      const evKey = rawN.eventKey;
      if (evKey) {
        const mRule = resolveMatrixRule(evKey, storedMatrix, Array.isArray(rawN.targetRoles) ? rawN.targetRoles : []);
        if (!mRule.enabled) continue;
        feed.push({
          ...rawN,
          targetRoles: mRule.targetRoles,
          targetEmployeeNames: Array.from(new Set([...(Array.isArray(rawN.targetEmployeeNames) ? rawN.targetEmployeeNames : []), ...mRule.targetEmployeeNames])),
          targetEmployeeIds: Array.from(new Set([...(Array.isArray(rawN.targetEmployeeIds) ? rawN.targetEmployeeIds : []), ...mRule.targetEmployeeIds])),
        });
      } else {
        feed.push({ ...rawN });
      }
    }

    // 1. Factory core.notification entries (cross-dept outbox events)
    for (const fn of factoryNotifRes.rows) {
      const category = inferFactoryCategory(fn.type, fn.link);
      const evKey = factoryNoticeKey(fn.type);
      const defaultRoles = resolveDefaultFactoryRoles(fn.type, category);
      const mRule = resolveMatrixRule(evKey, storedMatrix, defaultRoles);
      if (!mRule.enabled) continue;

      const parsedLink = extractTabFromLinkUrl(fn.link);
      const isReadOwn = Number(fn.user_id) === meId && Boolean(fn.read_at);
      const adminAllowedByMatrix = mRule.targetRoles.includes("admin") || mRule.targetRoles.includes("director");
      const recipientName = String(fn.recipient_name || "").trim();
      const includeRecipientAsPersonalTarget =
        Boolean(recipientName) &&
        (Number(fn.user_id) !== meId || !admin || adminAllowedByMatrix || mRule.targetEmployeeNames.includes(recipientName));
      const targetEmpNames = Array.from(
        new Set([
          ...(includeRecipientAsPersonalTarget ? [recipientName] : []),
          ...mRule.targetEmployeeNames,
        ].filter(Boolean))
      );

      feed.push({
        id: `FN-${fn.id}`,
        title: fn.title,
        message: fn.body || fn.title,
        type: /REJECT|FAIL|HOLD|KILL|SHORTAGE|MISMATCH|CONFLICT/i.test(fn.type) ? "warning" : "info",
        category,
        eventKey: evKey,
        createdAt: toIso(fn.created_at),
        readBy: isReadOwn ? [...meReaderKeys] : [],
        sender: { name: "Hệ thống Nhà máy (ISO 13485)" },
        targetRoles: mRule.targetRoles,
        targetEmployeeNames: targetEmpNames.length > 0 ? targetEmpNames : undefined,
        targetEmployeeIds: mRule.targetEmployeeIds.length > 0 ? mRule.targetEmployeeIds : undefined,
        targetId: fn.entity_id || fn.id,
        link: parsedLink
          ? { tab: parsedLink.tab, itemId: parsedLink.itemId || fn.entity_id || undefined }
          : { tab: "factory-rd", itemId: fn.entity_id || undefined },
        linkUrl: fn.link || undefined,
      });
    }

    // 2. Live Company Tasks
    for (const t of tasksRes.rows) {
      const codeUpper = String(t.task_code || "").toUpperCase();
      if (codeUpper && coveredCodes.has(codeUpper)) continue;
      const evKey = t.status === "DONE" ? "task_status_updated" : "task_assigned";
      const mRule = resolveMatrixRule(evKey, storedMatrix, t.status === "DONE" ? ["admin", "sales_head"] : ["admin"]);
      if (!mRule.enabled) continue;
      const assignees = splitNames(t.assignee_name);
      const statusLabel = TASK_STATUS_VI[t.status] || t.status;
      feed.push({
        id: `LIVE-TASK-${t.id}`,
        title: `💼 Công việc ${t.task_code || `#${t.id}`} [${statusLabel}]`,
        message: `${t.title}${assignees.length ? ` · Phụ trách: ${assignees.join(", ")}` : ""}${t.department ? ` (${t.department})` : ""}`,
        type: t.status === "DONE" ? "success" : "info",
        category: "task",
        eventKey: evKey,
        createdAt: toIso(t.updated_at || t.created_at),
        readBy: [],
        sender: { name: t.created_by_name || assignees[0] || "Điều hành công việc" },
        targetEmployeeNames: Array.from(new Set([...assignees, ...(t.created_by_name ? [t.created_by_name] : []), ...mRule.targetEmployeeNames].filter(Boolean))),
        targetEmployeeIds: mRule.targetEmployeeIds.length > 0 ? mRule.targetEmployeeIds : undefined,
        assignee: assignees[0] || undefined,
        assignees,
        creator: t.created_by_name || undefined,
        recipientDept: t.department || undefined,
        targetRoles: mRule.targetRoles,
        taskId: t.task_code || String(t.id),
        link: { tab: "workspace", subTab: "tasks", itemId: t.task_code || String(t.id) },
      });
    }

    // 3. Live Cross-Dept Workflows
    for (const w of wfRes.rows) {
      const codeUpper = String(w.workflow_code || "").toUpperCase();
      if (codeUpper && coveredCodes.has(codeUpper)) continue;
      const mRule = resolveMatrixRule("workflow_cross_dept", storedMatrix, ["admin"]);
      if (!mRule.enabled) continue;
      const names = Array.from(new Set([...splitNames(w.assignee_name), ...splitNames(w.requester_name), ...mRule.targetEmployeeNames]));
      const statusLabel = WF_STATUS_VI[w.status] || w.status;
      feed.push({
        id: `LIVE-WF-${w.id}`,
        title: `🔁 Luân chuyển ${w.workflow_code || `#${w.id}`} [${statusLabel}]`,
        message: `${w.title}${w.requester_dept && w.target_dept ? ` (${w.requester_dept} → ${w.target_dept})` : ""}`,
        type: w.status === "COMPLETED" ? "success" : w.status === "REJECTED" ? "warning" : "info",
        category: "task",
        eventKey: "workflow_cross_dept",
        createdAt: toIso(w.updated_at || w.created_at),
        readBy: [],
        sender: { name: w.requester_name || "Quy trình phối hợp" },
        targetEmployeeNames: names,
        targetEmployeeIds: mRule.targetEmployeeIds.length > 0 ? mRule.targetEmployeeIds : undefined,
        assignee: splitNames(w.assignee_name)[0] || undefined,
        assignees: splitNames(w.assignee_name),
        creator: w.requester_name || undefined,
        recipientDept: w.target_dept || w.requester_dept || undefined,
        targetRoles: mRule.targetRoles,
        workflowId: w.id,
        workflowCode: w.workflow_code || undefined,
        link: { tab: "workspace", subTab: "workflows", itemId: w.workflow_code || String(w.id) },
      });
    }

    // 4. Live Proposals (workspace_proposals)
    const sortedProposals = [...proposalsList]
      .filter((p) => p && p.status && p.status !== "DRAFT" && p.status !== "WITHDRAWN")
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())
      .slice(0, 40);
    for (const p of sortedProposals) {
      const code = String(p.proposalCode || p.id || "");
      if (code && coveredCodes.has(code.toUpperCase())) continue;
      const steps: any[] = Array.isArray(p.steps) ? p.steps : [];
      const activeStep = steps[Number(p.currentStepIndex ?? 0)] ?? steps.find((s) => s.status === "PENDING_NOW");
      const targetNames = Array.from(
        new Set([
          ...splitNames(p.requesterName),
          ...splitNames(activeStep?.approverName),
          ...splitNames(p.executorName),
          ...(Array.isArray(p.followers) ? p.followers : []),
        ])
      );
      const statusLabel = PROPOSAL_STATUS_VI[p.status] || p.status;
      feed.push({
        id: `LIVE-PROP-${p.id || code}`,
        title: `📝 Đề xuất ${code} [${statusLabel}]`,
        message: `${p.title || p.templateName || "Phiếu đề xuất"}${activeStep?.approverName ? ` · Chờ duyệt: ${activeStep.approverName}` : ""}`,
        type: p.status === "APPROVED" || p.status === "EXECUTED" ? "success" : p.status === "REJECTED" ? "warning" : "info",
        category: "task",
        createdAt: toIso(p.updatedAt || p.createdAt),
        readBy: [],
        sender: { name: p.requesterName || "Đề xuất & Phê duyệt" },
        targetEmployeeNames: targetNames,
        assignee: activeStep?.approverName || undefined,
        creator: p.requesterName || undefined,
        recipientDept: activeStep?.dept || p.requesterDept || undefined,
        targetRoles: ["admin"],
        targetId: code || String(p.id),
        link: { tab: "workspace", subTab: "proposals", itemId: code || String(p.id) },
      });
    }

    // 5. Live Daily Reports
    for (const d of dailyRes.rows) {
      const mRule = resolveMatrixRule("daily_report_submitted", storedMatrix, ["admin", "sales_head", "app_head"]);
      if (!mRule.enabled) continue;
      const ts = toIso(d.created_at, d.log_date ? `${String(d.log_date).slice(0, 10)}T17:00:00+07:00` : undefined);
      const preview = String(d.work_content || d.result || "Đã nộp báo cáo công việc ngày").slice(0, 140);
      feed.push({
        id: `LIVE-DAILY-${d.id}`,
        title: `🗒️ Nhật ký ngày ${String(d.log_date || "").slice(0, 10)} — ${d.employee_name || "Nhân sự"}`,
        message: `${preview}${d.department ? ` (${d.department})` : ""}`,
        type: "info",
        category: "daily",
        eventKey: "daily_report_submitted",
        createdAt: ts,
        readBy: [],
        sender: { name: d.employee_name || "Nhân viên" },
        targetEmployeeNames: Array.from(new Set([...(d.employee_name ? [d.employee_name] : []), ...mRule.targetEmployeeNames])),
        targetEmployeeIds: mRule.targetEmployeeIds.length > 0 ? mRule.targetEmployeeIds : undefined,
        creator: d.employee_name || undefined,
        recipientDept: d.department || undefined,
        targetRoles: mRule.targetRoles,
        link: { tab: "workspace", subTab: "reports", itemId: String(d.id) },
      });
    }

    // 6. Recent Factory R&D / Software Projects & ELN
    for (const p of rdProjectsRes.rows) {
      const codeUpper = String(p.code || "").toUpperCase();
      if (codeUpper && coveredCodes.has(codeUpper)) continue;
      const isSw = p.target_domain === "SOFTWARE";
      const evKey = "factory_rd_idea_approve";
      const mRule = resolveMatrixRule(evKey, storedMatrix, [isSw ? "factory_device" : "factory_rd"]);
      if (!mRule.enabled) continue;
      feed.push({
        id: `LIVE-RD-PRJ-${p.id}`,
        title: `${isSw ? "💻 Dự án Phần mềm" : "🧬 Đề tài R&D"} ${p.code} (${p.current_stage})`,
        message: `${p.name}${p.leader_name ? ` · Chủ nhiệm: ${p.leader_name}` : ""} · TT: ${p.status}`,
        type: p.status === "TRANSFERRED" ? "success" : "info",
        category: isSw ? "factory_device" : "factory_rd",
        eventKey: evKey,
        createdAt: toIso(p.updated_at || p.created_at),
        readBy: [],
        sender: { name: p.leader_name || p.dept_name || "R&D" },
        targetEmployeeNames: Array.from(new Set([...(p.leader_name ? [p.leader_name] : []), ...mRule.targetEmployeeNames])),
        targetEmployeeIds: mRule.targetEmployeeIds.length > 0 ? mRule.targetEmployeeIds : undefined,
        recipientDept: p.dept_name || (isSw ? "Kỹ thuật – Thiết bị" : "Nghiên cứu R&D"),
        targetRoles: mRule.targetRoles,
        targetId: p.code,
        link: { tab: isSw ? "factory-it" : "factory-rd", itemId: p.id },
      });
    }

    for (const e of rdExpRes.rows) {
      const codeUpper = String(e.code || "").toUpperCase();
      if (codeUpper && coveredCodes.has(codeUpper)) continue;
      const evKey = e.status === "APPROVED" ? "factory_rd_experiment_approve" : e.status === "RETURNED" ? "factory_rd_experiment_return" : "factory_rd_experiment_submit";
      const mRule = resolveMatrixRule(evKey, storedMatrix, ["factory_rd"]);
      if (!mRule.enabled) continue;
      feed.push({
        id: `LIVE-RD-ELN-${e.id}`,
        title: `🧪 Nhật ký Thí nghiệm ELN ${e.code} [${e.status}]`,
        message: `${e.title}${e.performer_name ? ` · Thực hiện: ${e.performer_name}` : ""}`,
        type: e.status === "APPROVED" ? "success" : "info",
        category: "factory_rd",
        eventKey: evKey,
        createdAt: toIso(e.updated_at || e.created_at),
        readBy: [],
        sender: { name: e.performer_name || "Phòng R&D" },
        targetEmployeeNames: Array.from(new Set([...(e.performer_name ? [e.performer_name] : []), ...mRule.targetEmployeeNames])),
        targetEmployeeIds: mRule.targetEmployeeIds.length > 0 ? mRule.targetEmployeeIds : undefined,
        recipientDept: "Nghiên cứu R&D",
        targetRoles: mRule.targetRoles,
        targetId: e.code,
        link: { tab: "factory-rd", itemId: e.id },
      });
    }

    // 7. Automatic Birthday Greeting & Upcoming Birthday Reminder Notifications (Vietnam Timezone)
    const vnNowStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const [vnYearStr, vnMonthStr, vnDayStr] = vnNowStr.split("-");
    const vnYear = Number(vnYearStr);
    const vnMonth = Number(vnMonthStr);
    const vnDay = Number(vnDayStr);
    const todayUtcMs = Date.UTC(vnYear, vnMonth - 1, vnDay);
    const ALL_COMPANY_ROLES = [
      "admin",
      "director",
      "hr_admin",
      "sales_head",
      "sales_rep",
      "app_head",
      "app_engineer",
      "warehouse_lead",
      "warehouse_staff",
      "procurement_lead",
      "procurement_staff",
      "accountant_head",
      "accountant",
      "legal_head",
      "legal_staff",
      "qa_qc_lead",
      "qa_qc",
      "rd_head",
      "rd_staff",
      "kit_head",
      "kit_staff",
      "oligo_head",
      "oligo_staff",
      "device_head",
      "device_staff",
      "factory_qa",
      "factory_rd",
      "factory_kit",
      "factory_oligo",
      "factory_device",
      "factory_wh",
      "factory_purchase",
      "factory_intake",
    ];

    for (const p of birthdaysRes.rows) {
      const dobStr = String(p.date_of_birth || "").slice(0, 10);
      const m = dobStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) continue;
      const bMonth = Number(m[2]);
      const bDay = Number(m[3]);
      let nextBdayUtcMs = Date.UTC(vnYear, bMonth - 1, bDay);
      if (nextBdayUtcMs < todayUtcMs) {
        nextBdayUtcMs = Date.UTC(vnYear + 1, bMonth - 1, bDay);
      }
      const daysUntil = Math.round((nextBdayUtcMs - todayUtcMs) / 86400000);
      const ddMm = `${String(bDay).padStart(2, "0")}/${String(bMonth).padStart(2, "0")}`;

      if (daysUntil === 0) {
        const mRule = resolveMatrixRule("hr_birthday_celebration", storedMatrix, ALL_COMPANY_ROLES);
        if (!mRule.enabled) continue;
        const targetNames = Array.from(
          new Set([
            ...(p.full_name ? [String(p.full_name).trim()] : []),
            ...(me.full_name ? [String(me.full_name).trim()] : []),
            ...mRule.targetEmployeeNames,
          ].filter(Boolean))
        );
        feed.push({
          id: `LIVE-BIRTHDAY-${vnYear}-${p.employee_code || p.id}`,
          title: `🎂 Chúc mừng sinh nhật ${p.full_name} (${ddMm})!`,
          message: `Hôm nay là sinh nhật của ${p.full_name} (${p.position || "Cán bộ nhân viên"} — ${p.department || "ABT"}). Chúc Anh/Chị tuổi mới thật nhiều sức khỏe, niềm vui và thành công rực rỡ cùng đại gia đình ABT! 🎉💐`,
          type: "success",
          category: "system",
          eventKey: "hr_birthday_celebration",
          createdAt: `${vnNowStr}T08:00:00+07:00`,
          readBy: [],
          sender: { name: "Hành Chính Nhân Sự & Văn Hóa ABT" },
          targetRoles: mRule.targetRoles,
          targetEmployeeNames: targetNames,
          targetEmployeeIds: mRule.targetEmployeeIds.length > 0 ? mRule.targetEmployeeIds : undefined,
          recipientDept: p.department || undefined,
          link: { tab: "chat" },
        });
      } else if (daysUntil >= 1 && daysUntil <= 3) {
        const mRule = resolveMatrixRule("hr_birthday_celebration", storedMatrix, ["admin", "hr_admin"]);
        if (!mRule.enabled) continue;
        feed.push({
          id: `LIVE-BIRTHDAY-UPCOMING-${vnYear}-${p.employee_code || p.id}`,
          title: `🎉 Sắp đến sinh nhật ${p.full_name} (${ddMm} — còn ${daysUntil} ngày)`,
          message: `Sinh nhật của ${p.full_name} (${p.position || "Chuyên viên"} — ${p.department || "ABT"}) vào ngày ${ddMm}/${vnYear}. Hãy chuẩn bị lời chúc mừng sinh nhật!`,
          type: "info",
          category: "system",
          eventKey: "hr_birthday_celebration",
          createdAt: `${vnNowStr}T07:30:00+07:00`,
          readBy: [],
          sender: { name: "Hành Chính Nhân Sự & Văn Hóa ABT" },
          targetRoles: mRule.targetRoles,
          targetEmployeeNames: mRule.targetEmployeeNames.length > 0 ? mRule.targetEmployeeNames : undefined,
          targetEmployeeIds: mRule.targetEmployeeIds.length > 0 ? mRule.targetEmployeeIds : undefined,
          recipientDept: p.department || undefined,
          link: { tab: "settings", subTab: "personnel" },
        });
      }
    }

    // Merge persisted read receipts onto every item, sort newest first, cap 250
    const seenIds = new Set<string>();
    const normalized = feed
      .filter((item) => {
        if (!item?.id || seenIds.has(item.id)) return false;
        seenIds.add(item.id);
        return true;
      })
      .map((item) => {
        const persistedReaders = Array.isArray(receipts[item.id]) ? receipts[item.id] : [];
        const mergedReaders = Array.from(
          new Set([...(Array.isArray(item.readBy) ? item.readBy : []), ...persistedReaders].filter(Boolean))
        );
        return { ...item, readBy: mergedReaders };
      })
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, 250);

    return NextResponse.json({ notifications: normalized });
  } catch (error: any) {
    console.error("[Notifications Feed GET Error]:", error);
    return apiErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await getAuthorizedUser(req);
    if (!me) return unauthorizedResponse();
    setAuditActor(me);
    const body = await req.json().catch(() => ({}));

    if (body?.action === "mark_read") {
      const ids: string[] = Array.isArray(body.ids)
        ? body.ids.map((x: unknown) => String(x || "").trim()).filter(Boolean).slice(0, 300)
        : [];
      if (ids.length === 0) return NextResponse.json({ ok: true });

      const rawReaderKeys: string[] = Array.isArray(body.readerKeys)
        ? body.readerKeys.map((x: unknown) => String(x || "").trim()).filter(Boolean)
        : [];
      const fallbackKeys = [(me as any).email, me.username, me.full_name, "current_viewer", "mine_viewer"]
        .map((s) => String(s || "").trim())
        .filter(Boolean);
      const readerKeys = Array.from(new Set([...rawReaderKeys, ...fallbackKeys]));

      await withTransaction(async (c) => {
        const curRes = await c.query(
          "SELECT data FROM app_storage WHERE key = 'notification_read_receipts' FOR UPDATE"
        );
        const cur: Record<string, string[]> =
          curRes.rows[0]?.data && typeof curRes.rows[0].data === "object" && !Array.isArray(curRes.rows[0].data)
            ? { ...curRes.rows[0].data }
            : {};

        for (const id of ids) {
          const prev = Array.isArray(cur[id]) ? cur[id] : [];
          cur[id] = Array.from(new Set([...prev, ...readerKeys]));
        }

        // Keep at most 600 newest receipt entries
        const keys = Object.keys(cur);
        if (keys.length > 600) {
          for (const drop of keys.slice(0, keys.length - 600)) {
            delete cur[drop];
          }
        }

        await c.query(
          `INSERT INTO app_storage (key, data, version, updated_at)
           VALUES ('notification_read_receipts', $1, 1, now())
           ON CONFLICT (key) DO UPDATE
             SET data = EXCLUDED.data, version = COALESCE(app_storage.version, 1) + 1, updated_at = now()`,
          [JSON.stringify(cur)]
        );
      });

      const factoryUuids = ids
        .filter((id) => id.startsWith("FN-"))
        .map((id) => id.slice(3))
        .filter((uuid) => /^[0-9a-f-]{36}$/i.test(uuid));
      if (factoryUuids.length > 0) {
        await withFactoryTx((tx) => markFactoryNotificationsRead(tx, Number(me.id), factoryUuids)).catch(() => {});
      }

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error: any) {
    console.error("[Notifications Feed POST Error]:", error);
    return apiErrorResponse(error);
  }
}

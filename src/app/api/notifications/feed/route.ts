import { NextRequest, NextResponse } from "next/server";
import { query, withTransaction } from "@/backend/db/db";
import { getAuthorizedUser, isAdminUser, setAuditActor, unauthorizedResponse } from "@/backend/services/authz";
import { getFactoryPool, withTransaction as withFactoryTx } from "@/factory/core/db";
import { markRead as markFactoryNotificationsRead } from "@/factory/core/notifications";
import { factoryNoticeKey } from "@/factory/noticeMatrix";

export const dynamic = "force-dynamic";

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
    ] = await Promise.all([
      query(
        `SELECT key, data FROM app_storage
          WHERE key = ANY($1::text[])`,
        [["tbr_activity_notifications", "workspace_proposals", "notification_read_receipts"]]
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
              `SELECT DISTINCT ON (COALESCE(source_key, type || ':' || title || ':' || COALESCE(entity_id, id::text)))
                      id, user_id, type, title, body, entity_type, entity_id, link, source_key, read_at, created_at
                 FROM core.notification
                ORDER BY COALESCE(source_key, type || ':' || title || ':' || COALESCE(entity_id, id::text)),
                         CASE WHEN user_id = $1 THEN 0 ELSE 1 END,
                         created_at DESC
                LIMIT 100`,
              [meId]
            );
          }
          return await pool.query(
            `SELECT id, user_id, type, title, body, entity_type, entity_id, link, source_key, read_at, created_at
               FROM core.notification
              WHERE user_id = $1
              ORDER BY created_at DESC
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
    ]);

    const storageMap = new Map<string, any>();
    for (const r of storageRes.rows) {
      storageMap.set(r.key, r.data);
    }

    const storedRaw = storageMap.get("tbr_activity_notifications");
    const storedList: any[] = Array.isArray(storedRaw) ? storedRaw : [];

    const receiptsRaw = storageMap.get("notification_read_receipts");
    const receipts: Record<string, string[]> =
      receiptsRaw && typeof receiptsRaw === "object" && !Array.isArray(receiptsRaw) ? receiptsRaw : {};

    const coveredCodes = new Set<string>();
    for (const n of storedList) {
      const candidates = [n?.taskId, n?.workflowCode, n?.workflowId, n?.orderCode, n?.targetId, n?.link?.itemId]
        .filter(Boolean)
        .map((x) => String(x).toUpperCase());
      candidates.forEach((c) => coveredCodes.add(c));
      extractCodes(`${n?.title || ""} ${n?.message || ""}`).forEach((c) => coveredCodes.add(c));
    }

    const feed: any[] = storedList.map((n) => ({ ...n }));

    // 1. Factory core.notification entries (cross-dept outbox events)
    for (const fn of factoryNotifRes.rows) {
      const category = inferFactoryCategory(fn.type, fn.link);
      const parsedLink = extractTabFromLinkUrl(fn.link);
      const isReadOwn = Number(fn.user_id) === meId && Boolean(fn.read_at);
      feed.push({
        id: `FN-${fn.id}`,
        title: fn.title,
        message: fn.body || fn.title,
        type: /REJECT|FAIL|HOLD|KILL|SHORTAGE|MISMATCH|CONFLICT/i.test(fn.type) ? "warning" : "info",
        category,
        eventKey: factoryNoticeKey(fn.type),
        createdAt: toIso(fn.created_at),
        readBy: isReadOwn ? [...meReaderKeys] : [],
        sender: { name: "Hệ thống Nhà máy (ISO 13485)" },
        targetRoles: ["admin", category],
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
      const assignees = splitNames(t.assignee_name);
      const statusLabel = TASK_STATUS_VI[t.status] || t.status;
      feed.push({
        id: `LIVE-TASK-${t.id}`,
        title: `💼 Công việc ${t.task_code || `#${t.id}`} [${statusLabel}]`,
        message: `${t.title}${assignees.length ? ` · Phụ trách: ${assignees.join(", ")}` : ""}${t.department ? ` (${t.department})` : ""}`,
        type: t.status === "DONE" ? "success" : "info",
        category: "task",
        eventKey: t.status === "DONE" ? "task_status_updated" : "task_assigned",
        createdAt: toIso(t.updated_at || t.created_at),
        readBy: [],
        sender: { name: t.created_by_name || assignees[0] || "Điều hành công việc" },
        targetEmployeeNames: [...assignees, ...(t.created_by_name ? [t.created_by_name] : [])].filter(Boolean),
        assignee: assignees[0] || undefined,
        assignees,
        creator: t.created_by_name || undefined,
        recipientDept: t.department || undefined,
        targetRoles: ["admin"],
        taskId: t.task_code || String(t.id),
        link: { tab: "workspace", subTab: "tasks", itemId: t.task_code || String(t.id) },
      });
    }

    // 3. Live Cross-Dept Workflows
    for (const w of wfRes.rows) {
      const codeUpper = String(w.workflow_code || "").toUpperCase();
      if (codeUpper && coveredCodes.has(codeUpper)) continue;
      const names = Array.from(new Set([...splitNames(w.assignee_name), ...splitNames(w.requester_name)]));
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
        assignee: splitNames(w.assignee_name)[0] || undefined,
        assignees: splitNames(w.assignee_name),
        creator: w.requester_name || undefined,
        recipientDept: w.target_dept || w.requester_dept || undefined,
        targetRoles: ["admin"],
        workflowId: w.id,
        workflowCode: w.workflow_code || undefined,
        link: { tab: "workspace", subTab: "workflows", itemId: w.workflow_code || String(w.id) },
      });
    }

    // 4. Live Proposals (workspace_proposals)
    const proposalsRaw = storageMap.get("workspace_proposals");
    const proposalsList: any[] = Array.isArray(proposalsRaw) ? proposalsRaw : [];
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
        targetEmployeeNames: d.employee_name ? [d.employee_name] : [],
        creator: d.employee_name || undefined,
        recipientDept: d.department || undefined,
        targetRoles: ["admin"],
        link: { tab: "workspace", subTab: "reports", itemId: String(d.id) },
      });
    }

    // 6. Recent Factory R&D / Software Projects & ELN
    for (const p of rdProjectsRes.rows) {
      const codeUpper = String(p.code || "").toUpperCase();
      if (codeUpper && coveredCodes.has(codeUpper)) continue;
      const isSw = p.target_domain === "SOFTWARE";
      feed.push({
        id: `LIVE-RD-PRJ-${p.id}`,
        title: `${isSw ? "💻 Dự án Phần mềm" : "🧬 Đề tài R&D"} ${p.code} (${p.current_stage})`,
        message: `${p.name}${p.leader_name ? ` · Chủ nhiệm: ${p.leader_name}` : ""} · TT: ${p.status}`,
        type: p.status === "TRANSFERRED" ? "success" : "info",
        category: isSw ? "factory_device" : "factory_rd",
        createdAt: toIso(p.updated_at || p.created_at),
        readBy: [],
        sender: { name: p.leader_name || p.dept_name || "R&D" },
        targetEmployeeNames: p.leader_name ? [p.leader_name] : [],
        recipientDept: p.dept_name || (isSw ? "Kỹ thuật – Thiết bị" : "Nghiên cứu R&D"),
        targetRoles: ["admin", isSw ? "factory_device" : "factory_rd"],
        targetId: p.code,
        link: { tab: isSw ? "factory-it" : "factory-rd", itemId: p.id },
      });
    }

    for (const e of rdExpRes.rows) {
      const codeUpper = String(e.code || "").toUpperCase();
      if (codeUpper && coveredCodes.has(codeUpper)) continue;
      feed.push({
        id: `LIVE-RD-ELN-${e.id}`,
        title: `🧪 Nhật ký Thí nghiệm ELN ${e.code} [${e.status}]`,
        message: `${e.title}${e.performer_name ? ` · Thực hiện: ${e.performer_name}` : ""}`,
        type: e.status === "APPROVED" ? "success" : "info",
        category: "factory_rd",
        createdAt: toIso(e.updated_at || e.created_at),
        readBy: [],
        sender: { name: e.performer_name || "Phòng R&D" },
        targetEmployeeNames: e.performer_name ? [e.performer_name] : [],
        recipientDept: "Nghiên cứu R&D",
        targetRoles: ["admin", "factory_rd"],
        targetId: e.code,
        link: { tab: "factory-rd", itemId: e.id },
      });
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
    return NextResponse.json({ error: error?.message || "Lỗi tải thông báo" }, { status: 500 });
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
    return NextResponse.json({ error: error?.message || "Lỗi cập nhật thông báo" }, { status: 500 });
  }
}

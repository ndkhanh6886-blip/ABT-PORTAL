import { NextRequest, NextResponse } from "next/server";
import { query, logAudit, withTransaction, httpErrorStatus } from "@/backend/db/db";
import { getAuthorizedUser, isAdminUser, unauthorizedResponse, forbiddenResponse, setAuditActor, AuthorizedUser } from "@/backend/services/authz";
import { hasPermission } from "@/backend/services/permissions";
import { todayVN, nowVNDateTime } from "@/backend/services/dates";
import { getTaskAccess, sameStaffName, TASK_STATUSES, TASK_RELATED_TYPE_IDS } from "@/backend/services/workspaceTasks";

/** Người đang đăng nhập theo dạng getTaskAccess cần (quyền duyệt phòng ban = Trưởng / Phó phòng) */
function taskActor(me: AuthorizedUser) {
  return {
    username: me.username,
    full_name: me.full_name,
    role: hasPermission(me, "workspace.approve_dept") ? `${me.role || ""} manager` : me.role,
    department: me.department,
    isAdmin: isAdminUser(me),
  };
}
const TASK_STATUS_IDS = new Set(TASK_STATUSES.map(s => s.id));

const lower = (v: any) => String(v || "").trim().toLowerCase();

const FICTIONAL_ASSIGNEES = new Set([
  "phạm quốc tuấn",
  "lê kỹ thuật",
  "nguyễn văn a",
  "nguyễn văn nam",
  "trần thủ kho",
  "trần thị thảo",
  "đội vận chuyển"
]);

function cleanAssigneeName(name: any): string {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "";
  if (FICTIONAL_ASSIGNEES.has(trimmed.toLowerCase())) return "";
  return trimmed;
}

function normalizeDeptKey(raw: any): string {
  const s = lower(raw);
  if (!s) return "";
  if (s.includes("ứng dụng") || s.includes("application") || s.includes("kỹ thuật")) return "application";
  if (s.includes("kho") || s.includes("vận hành") || s.includes("warehouse")) return "warehouse";
  if (s.includes("cung ứng") || s.includes("mua hàng") || s.includes("procurement")) return "procurement";
  if (s.includes("kinh doanh") || s.includes("sales") || s.includes("marketing")) return "sales";
  if (s.includes("pháp chế") || s.includes("legal") || s.includes("qa") || s.includes("qc") || s.includes("chất lượng")) return "legal";
  if (s.includes("kế toán") || s.includes("account")) return "accounting";
  if (s.includes("giám đốc") || s.includes("admin") || s.includes("bod")) return "director";
  return s;
}

function isSameDepartment(a: any, b: any): boolean {
  const splitKeys = (raw: any): string[] =>
    String(raw || "")
      .split(/[,;\n]+/)
      .map((d) => normalizeDeptKey(d.trim()))
      .filter(Boolean);
  const listA = splitKeys(a);
  const listB = splitKeys(b);
  if (listA.length === 0 || listB.length === 0) return false;
  return listA.some((ka) => listB.some((kb) => ka === kb || ka.includes(kb) || kb.includes(ka)));
}

/** Purchase requests (PR) are workflow tickets too; their approval belongs to the procurement approvers. */
function isPurchaseRequest(wf: any) {
  return lower(wf?.workflow_code).startsWith("pr") || lower(wf?.workflow_type).includes("procurement");
}

function canApprovePurchaseRequest(me: AuthorizedUser) {
  return isAdminUser(me) || hasPermission(me, "procurement.approve_po");
}

/** Requester, assignee (ticket or current step), manager/template-manager, or a member of the involved department may act on a ticket. */
function canActOnWorkflow(me: AuthorizedUser, wf: any, step?: any) {
  if (isAdminUser(me)) return true;
  if (hasPermission(me, "workspace.manage_templates") || hasPermission(me, "workspace.approve_dept")) return true;
  const fullName = String(me.full_name || "").trim();
  if (fullName) {
    const candidateNames = [
      wf?.requester_name,
      ...String(wf?.assignee_name || "").split(/[,;\n]+/),
      ...String(step?.assignee_name || "").split(/[,;\n]+/),
      ...(Array.isArray(step?.assignees) ? step.assignees : [])
    ]
      .map((s) => String(s || "").trim())
      .filter(Boolean);
    if (candidateNames.some((cand) => sameStaffName(cand, fullName))) return true;
  }
  const dept = me.department;
  if (!dept) return false;
  const stepDepts = Array.isArray(wf?.steps)
    ? wf.steps.flatMap((s: any) => [s?.dept, ...(Array.isArray(s?.departments) ? s.departments : [])])
    : [];
  return [wf?.target_dept, wf?.requester_dept, step?.dept, ...stepDepts]
    .filter(Boolean)
    .some(d => isSameDepartment(d, dept));
}

const PR_DECISION_STATUSES = new Set(["APPROVED", "REJECTED", "CONVERTED", "PARTIAL_CONVERTED", "COMPLETED"]);
import { generateDocumentCode } from "@/backend/services/codeGenerator";
import { NOT_PR_ROW_SQL } from "@/backend/services/prRows";

const DEFAULT_DB_WORKFLOW_TEMPLATES = [
  {
    code: "SALES_TO_APP",
    name: "Sales ──► Application: Yêu cầu Demo & Thử mẫu",
    source_dept: "Kinh Doanh",
    target_dept: "Application",
    icon: "FlaskConical",
    description: "Yêu cầu kỹ sư Application hỗ trợ chạy thử mẫu tại Lab ABT hoặc mang máy đi demo trực tiếp tại viện (Bộ phận Application sẽ tự phân công nhân sự phụ trách).",
    sla_days: 5,
    steps: [
      { step_index: 0, title: "Tiếp nhận & Thẩm định mẫu / Thiết bị", dept: "Application", assignee_name: "", sla_hours: 24, deliverables: "Xác nhận loại mẫu sinh học, hóa chất tương thích, phân công nhân sự & lịch Demo" },
      { step_index: 1, title: "Triển khai Demo & Chạy thử nghiệm thực tế", dept: "Application", assignee_name: "", sla_hours: 48, deliverables: "Biên bản chạy thực tế, dữ liệu huỳnh quang PCR/kết quả test" },
      { step_index: 2, title: "Báo cáo kỹ thuật & Nghiệm thu với Sales / Khách hàng", dept: "Kinh Doanh", assignee_name: "", sla_hours: 24, deliverables: "Biên bản bàn giao kết quả và xác nhận của khách hàng/BS" }
    ]
  },
  {
    code: "SALES_TO_WAREHOUSE",
    name: "Sales ──► Kho: Yêu cầu Soạn & Xuất kho giao hàng",
    source_dept: "Kinh Doanh",
    target_dept: "Kho & Vận Hành",
    icon: "Package",
    description: "Yêu cầu thủ kho kiểm tra số lô (Lot), hạn dùng (Exp), đóng gói lạnh và tạo phiếu xuất kho giao khách.",
    sla_days: 2,
    steps: [
      { step_index: 0, title: "Thẩm định tồn kho & Kiểm tra Lot/Hạn dùng", dept: "Kho & Vận Hành", assignee_name: "", sla_hours: 8, deliverables: "Phiếu kiểm kho xác nhận đủ số lượng & hạn sử dụng > 6 tháng" },
      { step_index: 1, title: "Đóng gói chuẩn lạnh & In phiếu xuất", dept: "Kho & Vận Hành", assignee_name: "", sla_hours: 8, deliverables: "Thùng xốp gel đá/đá khô có dán tem niêm phong và phiếu xuất kho" },
      { step_index: 2, title: "Giao hàng & Thu hồi biên bản bàn giao (POD)", dept: "Kho & Vận Hành", assignee_name: "", sla_hours: 24, deliverables: "Biên bản giao nhận ký xác nhận kèm ảnh chụp tại phòng khám/lab" }
    ]
  },
  {
    code: "TO_PROCUREMENT",
    name: "Kho / Sales ──► Cung Ứng: Đề xuất mua hàng (PR)",
    source_dept: "Kho & Vận Hành",
    target_dept: "Cung Ứng",
    icon: "ShoppingCart",
    description: "Đề xuất phòng Cung ứng đàm phán giá và tạo đơn mua hàng PO khi tồn kho chạm mức an toàn.",
    sla_days: 7,
    steps: [
      { step_index: 0, title: "Tiếp nhận đề xuất PR & Khảo sát nhà cung cấp", dept: "Cung Ứng", assignee_name: "", sla_hours: 24, deliverables: "Bảng đối chiếu báo giá tối thiểu 2 NCC và thời gian giao hàng (Lead-time)" },
      { step_index: 1, title: "Trình duyệt ban giám đốc & Phát hành đơn PO", dept: "Ban Giám Đốc", assignee_name: "BOD", sla_hours: 24, deliverables: "Đơn đặt hàng PO có chữ ký phê duyệt" },
      { step_index: 2, title: "Theo dõi hải quan / giao nhận & Nhập kho ABT", dept: "Kho & Vận Hành", assignee_name: "", sla_hours: 72, deliverables: "Biên bản kiểm tra CO/CQ và phiếu nhập kho (GRN)" }
    ]
  },
  {
    code: "APP_TO_WAREHOUSE",
    name: "App ──► Kho: Đề nghị xuất vật tư & Mượn máy demo",
    source_dept: "Application",
    target_dept: "Kho & Vận Hành",
    icon: "FlaskConical",
    description: "Đề nghị xuất kit test, hóa chất tiêu hao hoặc mượn máy demo mang đi công tác ngoại viện.",
    sla_days: 3,
    steps: [
      { step_index: 0, title: "Kiểm tra thiết bị & Phụ kiện đi kèm", dept: "Kho & Vận Hành", assignee_name: "", sla_hours: 8, deliverables: "Checklist máy móc đủ dây nguồn, phụ kiện, vali chống sốc" },
      { step_index: 1, title: "Ký biên bản bàn giao mượn thiết bị demo", dept: "Application", assignee_name: "", sla_hours: 8, deliverables: "Phiếu mượn máy có chữ ký người mượn và thủ kho" },
      { step_index: 2, title: "Hoàn trả máy & Kiểm tra tình trạng nguyên vẹn", dept: "Kho & Vận Hành", assignee_name: "", sla_hours: 24, deliverables: "Biên bản nhận trả máy, ghi nhận tình trạng hoạt động tốt" }
    ]
  },
  {
    code: "SALES_TO_LEGAL",
    name: "Sales ──► Pháp Chế: Thẩm định hợp đồng & Rà soát hồ sơ thầu",
    source_dept: "Kinh Doanh",
    target_dept: "Pháp Chế",
    icon: "ShieldCheck",
    description: "Yêu cầu bộ phận Pháp chế thẩm định các điều khoản hợp đồng kinh tế, đại lý phân phối hoặc hồ sơ pháp lý dự thầu bệnh viện.",
    sla_days: 3,
    steps: [
      { step_index: 0, title: "Tiếp nhận dự thảo hợp đồng & Kiểm tra tính pháp lý", dept: "Pháp Chế", assignee_name: "", sla_hours: 24, deliverables: "Biên bản thẩm tra pháp lý, rà soát điều khoản thanh toán, phạt vi phạm & bảo hành" },
      { step_index: 1, title: "Hiệu chỉnh điều khoản & Phản hồi cho Sales", dept: "Pháp Chế", assignee_name: "", sla_hours: 24, deliverables: "Bản hợp đồng hoàn chỉnh (redline track changes) đạt chuẩn pháp lý" },
      { step_index: 2, title: "Trình Ban Giám Đốc phê duyệt ký kết chính thức", dept: "Ban Giám Đốc", assignee_name: "BOD", sla_hours: 24, deliverables: "Hợp đồng kinh tế có chữ ký số / con dấu pháp nhân công ty" }
    ]
  }
];

let fictionalCleanupDone = false;
async function ensureFictionalAssigneesCleaned() {
  if (fictionalCleanupDone) return;
  fictionalCleanupDone = true;
  try {
    // 1. Seed 5 built-in workflow templates if any are missing in workflow_templates table
    const existingCodesRes = await query(`SELECT code FROM workflow_templates`);
    const existingCodes = new Set(existingCodesRes.rows.map((r: any) => String(r.code || "").toUpperCase()));
    for (const def of DEFAULT_DB_WORKFLOW_TEMPLATES) {
      if (!existingCodes.has(def.code.toUpperCase())) {
        await query(
          `INSERT INTO workflow_templates (code, name, source_dept, target_dept, icon, description, sla_days, steps, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)`,
          [def.code, def.name, def.source_dept, def.target_dept, def.icon, def.description, def.sla_days, JSON.stringify(def.steps)]
        );
      }
    }

    // 2. Clean fictional assignees
    await query(
      `UPDATE company_tasks 
       SET assignee_name = '' 
       WHERE LOWER(TRIM(assignee_name)) IN ('phạm quốc tuấn', 'lê kỹ thuật', 'nguyễn văn a', 'nguyễn văn nam', 'trần thủ kho', 'trần thị thảo', 'đội vận chuyển')`
    );
    await query(
      `UPDATE workflow_requests 
       SET assignee_name = '' 
       WHERE LOWER(TRIM(assignee_name)) IN ('phạm quốc tuấn', 'lê kỹ thuật', 'nguyễn văn a', 'nguyễn văn nam', 'trần thủ kho', 'trần thị thảo', 'đội vận chuyển')`
    );
    const wfRows = await query(`SELECT id, steps FROM workflow_requests WHERE steps IS NOT NULL`);
    for (const row of wfRows.rows) {
      if (Array.isArray(row.steps)) {
        let changed = false;
        const cleanedSteps = row.steps.map((s: any) => {
          const cleaned = cleanAssigneeName(s?.assignee_name);
          if (cleaned !== (s?.assignee_name || "")) {
            changed = true;
            return { ...s, assignee_name: cleaned };
          }
          return s;
        });
        if (changed) {
          await query(`UPDATE workflow_requests SET steps = $1 WHERE id = $2`, [JSON.stringify(cleanedSteps), row.id]);
        }
      }
    }
    // Tự động đóng các Task của những bước đã nghiệm thu hoặc phiếu đã hoàn tất từ trước
    await query(`
      UPDATE company_tasks t
      SET status = 'DONE'
      FROM workflow_requests w
      WHERE t.related_workflow_code = w.workflow_code
        AND t.status != 'DONE'
        AND (
          w.status = 'COMPLETED'
          OR (
            COALESCE(w.current_step_index, 0) > 0
            AND t.task_code != ('TSK-' || w.workflow_code || '-S' || (COALESCE(w.current_step_index, 0) + 1)::text)
          )
        )
    `);
    const tmplRows = await query(`SELECT id, steps FROM workflow_templates WHERE steps IS NOT NULL`);
    for (const row of tmplRows.rows) {
      if (Array.isArray(row.steps)) {
        let changed = false;
        const cleanedSteps = row.steps.map((s: any) => {
          const cleaned = cleanAssigneeName(s?.assignee_name);
          if (cleaned !== (s?.assignee_name || "")) {
            changed = true;
            return { ...s, assignee_name: cleaned };
          }
          return s;
        });
        if (changed) {
          await query(`UPDATE workflow_templates SET steps = $1 WHERE id = $2`, [JSON.stringify(cleanedSteps), row.id]);
        }
      }
    }
  } catch (e) {
    console.warn("Could not clean fictional assignees or seed templates:", e);
  }
}

export async function GET(req: NextRequest) {
  try {
    // Phiên phải còn hiệu lực (tài khoản chưa bị khóa, mật khẩu chưa đổi): proxy chỉ kiểm tra chữ ký cookie
    const authUser = await getAuthorizedUser(req);
    if (!authUser) return unauthorizedResponse();
    setAuditActor(authUser);
    await ensureFictionalAssigneesCleaned();
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") || "overview";

    if (action === "overview") {
      const [workflows, tasks, daily, customers, products, personnel, users, templates, recentOrders] = await Promise.all([
        // PR (đề xuất mua hàng) chỉ nằm ở Cung ứng, không hiện trong Quy trình phối hợp
        query(`SELECT * FROM workflow_requests WHERE ${NOT_PR_ROW_SQL} ORDER BY id DESC`),
        query("SELECT * FROM company_tasks ORDER BY id DESC"),
        query("SELECT * FROM company_daily_logs ORDER BY log_date DESC, id DESC LIMIT 100"),
        query("SELECT id, customer_code, name, address, phone, email, contact_person, contacts, classification, region, province FROM sales_customers ORDER BY name ASC"),
        query("SELECT code, name, category, unit, standard_price FROM products ORDER BY name ASC"),
        query("SELECT id, employee_code, full_name, department, position, email, phone FROM personnel ORDER BY full_name ASC"),
        query("SELECT id, username, full_name, department, role, email, permissions FROM users ORDER BY full_name ASC"),
        query("SELECT * FROM workflow_templates WHERE is_active = TRUE ORDER BY id ASC"),
        // Đơn bán gần đây cho ô "Liên quan tới: Đơn hàng" (chỉ mã đơn + khách hàng)
        query("SELECT order_code, customer_name FROM sales_orders ORDER BY id DESC LIMIT 500").catch((err: any) => {
          console.error("[workflows] Không đọc được danh sách đơn hàng:", err?.message || err);
          return { rows: [] as any[] };
        })
      ]);

      return NextResponse.json({
        workflows: workflows.rows,
        tasks: tasks.rows,
        daily: daily.rows,
        customers: customers.rows,
        products: products.rows,
        personnel: personnel.rows,
        users: users.rows,
        templates: templates.rows,
        orders: recentOrders.rows,
        currentUserPermissions: authUser.permissions || {}
      });
    }

    if (action === "templates") {
      const res = await query("SELECT * FROM workflow_templates WHERE is_active = TRUE ORDER BY id ASC");
      return NextResponse.json({ templates: res.rows });
    }

    if (action === "workflows") {
      const res = await query(`SELECT * FROM workflow_requests WHERE ${NOT_PR_ROW_SQL} ORDER BY id DESC`);
      return NextResponse.json({ workflows: res.rows });
    }

    if (action === "tasks") {
      const res = await query("SELECT * FROM company_tasks ORDER BY id DESC");
      return NextResponse.json({ tasks: res.rows });
    }

    return NextResponse.json({ error: "Hành động không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    console.error("Workflow API GET Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    const body = await req.json();

    const me = await getAuthorizedUser(req);
    if (!me) return unauthorizedResponse();
    setAuditActor(me);
    if (body && typeof body === "object" && !Array.isArray(body)) {
      // Người thực hiện luôn là người đang đăng nhập (giao diện từng tự khai tên)
      body.actor = me.full_name || me.username;
    }

    // 1. Single Task Create / Update
    if (action === "task") {
      // Phân quyền: chỉ người tạo / Trưởng phòng của phòng đó / BGĐ sửa được toàn bộ; người được giao chỉ cập nhật tiến độ
      if (body.id) {
        const existingTask = (await query("SELECT * FROM company_tasks WHERE id = $1", [body.id])).rows[0];
        if (!existingTask) return NextResponse.json({ error: "Không tìm thấy công việc" }, { status: 404 });
        const access = getTaskAccess(taskActor(me), existingTask);
        if (access === "view") {
          return forbiddenResponse("Bạn chỉ được xem công việc này (không phải người tạo, người được giao hoặc quản lý phòng ban).");
        }
        if (access === "progress") {
          // Người được giao: giữ nguyên nội dung giao việc, chỉ nhận trạng thái / kết quả / đính kèm / trao đổi
          for (const k of ["title", "department", "task_category", "assignee_name", "customer_name", "priority", "deadline", "description", "related_type", "related_ref"]) {
            body[k] = existingTask[k];
          }
        }
      }
      if (body.status && !TASK_STATUS_IDS.has(String(body.status))) {
        return NextResponse.json({ error: `Trạng thái công việc không hợp lệ: ${body.status}` }, { status: 400 });
      }
      const relatedType = body.related_type && TASK_RELATED_TYPE_IDS.has(String(body.related_type)) ? String(body.related_type) : null;
      const relatedRef = relatedType ? String(body.related_ref || "").trim().slice(0, 255) || null : null;
      const {
        id,
        task_code,
        title,
        department,
        task_category,
        assignee_name,
        customer_name,
        priority,
        status,
        deadline,
        description,
        related_workflow_code,
        logs,
        result,
        attachments
      } = body;

      // Báo cáo kết quả của công việc thuộc một phiếu phối hợp: đăng vào "Trao đổi nội bộ" của phiếu để bên yêu cầu thấy
      const prevTask = id ? (await query("SELECT task_code, title, assignee_name, status, deadline, priority, department, result, attachments, logs, related_workflow_code FROM company_tasks WHERE id = $1", [id])).rows[0] : null;
      // Lịch sử thay đổi tự động (ai đổi gì, lúc nào): giữ lại để không mất dấu khi việc bị sửa thành việc khác
      let mergedLogs: any[] = Array.isArray(logs) ? logs : [];
      if (prevTask) {
        const prevLogs: any[] = Array.isArray(prevTask.logs) ? prevTask.logs : [];
        if (mergedLogs.length < prevLogs.length) mergedLogs = prevLogs;
        const label: Record<string, string> = { title: "Tiêu đề", assignee_name: "Người phụ trách", status: "Trạng thái", deadline: "Hạn", priority: "Ưu tiên", department: "Phòng ban" };
        const next: Record<string, any> = { title, assignee_name, status, deadline, priority, department };
        const fmt = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").trim());
        const changes = Object.keys(label)
          .filter(k => next[k] !== undefined && fmt(prevTask[k]) !== fmt(next[k]))
          .map(k => `${label[k]}: "${fmt(prevTask[k])}" → "${fmt(next[k])}"`);
        if (changes.length) {
          mergedLogs = [...mergedLogs, { time: nowVNDateTime(), author: me.full_name || me.username || "", type: "change", text: changes.join("; ") }];
        }
      }
      const postReportToWorkflow = async (taskCode: string | null) => {
        const wfCode = String(related_workflow_code || prevTask?.related_workflow_code || "").trim();
        const text = String(result || "").trim();
        const effectiveTaskCode = String(taskCode || prevTask?.task_code || "").trim();
        const actorName = me.full_name || me.username || assignee_name || "Nhân viên";

        // 1. Đẩy báo cáo kết quả vào luồng Trao đổi nội bộ của Phiếu phối hợp
        if (wfCode && text && text !== String(prevTask?.result || "").trim()) {
          const prevAtt: any[] = Array.isArray(prevTask?.attachments) ? prevTask.attachments : [];
          const seen = new Set(prevAtt.map((a: any) => String(a?.url || a?.name || "")));
          const newAtt = (Array.isArray(attachments) ? attachments : []).filter((a: any) => !seen.has(String(a?.url || a?.name || "")));
          const comment = {
            author: actorName,
            time: nowVNDateTime(),
            text,
            attachments: newAtt,
            source: "task",
            task_code: effectiveTaskCode || null
          };
          await query(
            `UPDATE workflow_requests SET comments = COALESCE(comments, '[]'::jsonb) || $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE workflow_code = $2`,
            [JSON.stringify([comment]), wfCode]
          );
        }

        // 2. Đồng bộ trạng thái Task (IN_PROGRESS / DONE) ngược về Phiếu phối hợp (workflow_requests)
        if (wfCode && status && (!prevTask || prevTask.status !== status || (text && text !== String(prevTask?.result || "").trim()))) {
          const wfRes = await query("SELECT * FROM workflow_requests WHERE workflow_code = $1 LIMIT 1", [wfCode]);
          if (wfRes.rows.length > 0) {
            const wfRow = wfRes.rows[0];
            const wfSteps = Array.isArray(wfRow.steps) ? [...wfRow.steps] : [];
            const currIdx = typeof wfRow.current_step_index === "number" ? wfRow.current_step_index : 0;
            const stepMatch = effectiveTaskCode.match(/-S(\d+)$/i);
            const targetStepIdx = stepMatch ? Math.max(0, Number(stepMatch[1]) - 1) : currIdx;
            const wfLogs = Array.isArray(wfRow.logs) ? [...wfRow.logs] : [];
            let nextWfStatus = wfRow.status;

            if (status === "IN_PROGRESS") {
              if (nextWfStatus === "PENDING") nextWfStatus = "IN_PROGRESS";
              if (wfSteps[targetStepIdx] && wfSteps[targetStepIdx].status === "PENDING") {
                wfSteps[targetStepIdx] = { ...wfSteps[targetStepIdx], status: "IN_PROGRESS" };
              }
            } else if (status === "DONE") {
              if (wfSteps[targetStepIdx]) {
                wfSteps[targetStepIdx] = {
                  ...wfSteps[targetStepIdx],
                  task_completed: true,
                  deliverables_note: text || wfSteps[targetStepIdx].deliverables_note || "Đã hoàn thành trên Bảng Công Việc"
                };
              }
              if (prevTask?.status !== "DONE") {
                wfLogs.push({
                  time: nowVNDateTime(),
                  action: `[Bảng Công Việc]: ${actorName} đã hoàn thành công việc ${effectiveTaskCode || ""}${text ? ` — Kết quả: ${text}` : ""}`,
                  actor: actorName
                });
              }
              // Nếu quy trình 1 bước (không cấu hình nhiều bước) và không phải PR cần quyền duyệt riêng -> hoàn tất phiếu
              if (wfSteps.length === 0 && !isPurchaseRequest(wfRow) && nextWfStatus !== "COMPLETED") {
                nextWfStatus = "COMPLETED";
              } else if (nextWfStatus === "PENDING") {
                nextWfStatus = "IN_PROGRESS";
              }
            }

            await query(
              `UPDATE workflow_requests
               SET status = $1, steps = $2, logs = $3,
                   results_summary = CASE WHEN $4 != '' AND NOT $5 THEN COALESCE(NULLIF(results_summary, '') || E'\n' || $4, $4) ELSE results_summary END,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $6`,
              [
                nextWfStatus,
                JSON.stringify(wfSteps),
                JSON.stringify(wfLogs),
                text && status === "DONE" ? `[${effectiveTaskCode || "Task"}]: ${text}` : "",
                isPurchaseRequest(wfRow),
                wfRow.id
              ]
            );
          }
        }

        // 3. Đồng bộ trạng thái Task ngược về Kế hoạch chuyên đề (unified_thematic_projects trong app_storage)
        const prjCodeMatch = effectiveTaskCode.match(/^TSK-(.+)-S(\d+)$/i);
        const prjIdCandidate = prjCodeMatch ? prjCodeMatch[1] : wfCode;
        if (prjIdCandidate && status) {
          try {
            const stRes = await query("SELECT value FROM system_settings WHERE key = 'unified_thematic_projects' LIMIT 1");
            if (stRes.rows.length > 0 && stRes.rows[0].value) {
              const projects = typeof stRes.rows[0].value === "string" ? JSON.parse(stRes.rows[0].value) : stRes.rows[0].value;
              if (Array.isArray(projects)) {
                let changed = false;
                const updatedProjects = projects.map((p: any) => {
                  if (String(p.id).toUpperCase() !== String(prjIdCandidate).toUpperCase()) return p;
                  const stages = Array.isArray(p.stages) ? [...p.stages] : [];
                  if (prjCodeMatch) {
                    const stgIdx = Math.max(0, Number(prjCodeMatch[2]) - 1);
                    if (stages[stgIdx]) {
                      const nextStgStatus = status === "DONE" ? "completed" : status === "IN_PROGRESS" ? "in_progress" : "pending";
                      if (stages[stgIdx].status !== nextStgStatus) {
                        stages[stgIdx] = { ...stages[stgIdx], status: nextStgStatus };
                        changed = true;
                      }
                    }
                  }
                  const allDone = stages.length > 0 && stages.every((s: any) => s.status === "completed");
                  const anyActive = stages.some((s: any) => s.status === "completed" || s.status === "in_progress");
                  const nextPrjStatus = allDone ? "Completed" : (anyActive && p.status === "Planning" ? "Active" : p.status);
                  if (nextPrjStatus !== p.status) changed = true;
                  return { ...p, stages, status: nextPrjStatus };
                });
                if (changed) {
                  await query(
                    `UPDATE system_settings SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = 'unified_thematic_projects'`,
                    [JSON.stringify(updatedProjects)]
                  );
                }
              }
            }
          } catch {}
        }
      };

      if (id) {
        await query(
          `UPDATE company_tasks
           SET title=$1, department=$2, task_category=$3, assignee_name=$4, customer_name=$5,
               priority=$6, status=$7, deadline=$8, description=$9, related_workflow_code=COALESCE($10, related_workflow_code),
               logs=$11, result=$12, attachments=$13, related_type=$15, related_ref=$16
           WHERE id=$14`,
          [
            title,
            department || "Kinh Doanh",
            task_category || "Chung",
            assignee_name || "",
            customer_name || "",
            priority || "MEDIUM",
            status || "TODO",
            deadline || null,
            description || "",
            related_workflow_code || null,
            JSON.stringify(mergedLogs),
            result || "",
            JSON.stringify(attachments || []),
            id,
            relatedType,
            relatedRef
          ]
        );
        await postReportToWorkflow(prevTask?.task_code || task_code || null);
        const renamed = prevTask && String(prevTask.title || "").trim() !== String(title || "").trim();
        await logAudit("UPDATE", "TASKS", `Cập nhật công việc ${prevTask?.task_code || ""}: ${renamed ? `"${prevTask.title}" → ` : ""}${title} (${department})${prevTask && String(prevTask.assignee_name || "") !== String(assignee_name || "") ? ` [phụ trách: ${prevTask.assignee_name || "-"} → ${assignee_name || "-"}]` : ""}`);
      } else {
        const code = task_code || `TSK-${Date.now().toString().slice(-6)}`;
        await query(
          `INSERT INTO company_tasks (
             task_code, title, department, task_category, assignee_name, customer_name,
             priority, status, deadline, description, related_workflow_code, logs, result, attachments,
             created_by, created_by_name, related_type, related_ref
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
          [
            code,
            title,
            department || "Kinh Doanh",
            task_category || "Chung",
            assignee_name || "",
            customer_name || "",
            priority || "MEDIUM",
            status || "TODO",
            deadline || null,
            description || "",
            related_workflow_code || null,
            JSON.stringify(logs || []),
            result || "",
            JSON.stringify(attachments || []),
            me.username,
            me.full_name || me.username,
            relatedType,
            relatedRef
          ]
        );
        await postReportToWorkflow(code);
        await logAudit("CREATE", "TASKS", `Tạo mới công việc: ${code} - ${title} (${department})`);
      }

      return NextResponse.json({ success: true });
    }

    // 1b. Comment / Directive on Task (Trao đổi & Chỉ đạo trực tiếp trong Công việc)
    if (action === "task_comment") {
      const { id, text, role_type, reopen_status, attachments } = body;
      const cleanText = String(text || "").trim();
      if (!id || !cleanText) {
        return NextResponse.json({ error: "Vui lòng nhập nội dung trao đổi / chỉ đạo" }, { status: 400 });
      }
      const taskRes = await query("SELECT * FROM company_tasks WHERE id = $1 LIMIT 1", [id]);
      if (taskRes.rows.length === 0) {
        return NextResponse.json({ error: "Không tìm thấy công việc" }, { status: 404 });
      }
      const taskRow = taskRes.rows[0];
      const actorName = me.full_name || me.username || body.author || "Nhân viên";
      const isManagerOrAdmin = isAdminUser(me) || hasPermission(me, "workspace.approve_dept");
      const effectiveRole = role_type || (isManagerOrAdmin ? "directive" : "comment");

      const currentLogs: any[] = Array.isArray(taskRow.logs) ? [...taskRow.logs] : [];
      const commentEntry = {
        type: "comment",
        role: effectiveRole,
        author: actorName,
        time: nowVNDateTime(),
        text: cleanText,
        attachments: Array.isArray(attachments) ? attachments : []
      };
      currentLogs.push(commentEntry);

      if (reopen_status && (getTaskAccess(taskActor(me), taskRow) === "view" || !TASK_STATUS_IDS.has(String(reopen_status)))) {
        return forbiddenResponse("Bạn không có quyền đổi trạng thái công việc này.");
      }
      const nextStatus = reopen_status || taskRow.status;
      if (reopen_status && reopen_status !== taskRow.status) {
        currentLogs.push({
          time: nowVNDateTime(),
          author: actorName,
          type: "change",
          text: `Chỉ đạo triển khai tiếp — Trạng thái: "${taskRow.status}" → "${reopen_status}"`
        });
      }

      await query(
        `UPDATE company_tasks SET logs = $1, status = $2 WHERE id = $3`,
        [JSON.stringify(currentLogs), nextStatus, id]
      );

      let wfComments: any = null;
      if (taskRow.related_workflow_code) {
        const wfComment = {
          author: actorName,
          time: commentEntry.time,
          text: effectiveRole === "directive" ? `[Chỉ đạo CV ${taskRow.task_code || ""}]: ${cleanText}` : cleanText,
          attachments: commentEntry.attachments,
          source: "task",
          task_code: taskRow.task_code || null
        };
        const wfUpdate = await query(
          `UPDATE workflow_requests
           SET comments = COALESCE(comments, '[]'::jsonb) || $1::jsonb,
               updated_at = CURRENT_TIMESTAMP
           WHERE workflow_code = $2
           RETURNING comments`,
          [JSON.stringify([wfComment]), taskRow.related_workflow_code]
        );
        if (wfUpdate.rows.length > 0) {
          wfComments = wfUpdate.rows[0].comments;
        }
      }

      await logAudit(
        "COMMENT",
        "TASKS",
        `${effectiveRole === "directive" ? "Chỉ đạo" : "Trao đổi"} trên công việc ${taskRow.task_code || id}: "${cleanText.slice(0, 80)}"`
      );

      return NextResponse.json({
        success: true,
        logs: currentLogs,
        status: nextStatus,
        wfComments
      });
    }

    // 2. Batch Import Tasks From Excel
    if (action === "batch_tasks_excel") {
      const { items } = body;
      if (!Array.isArray(items) || items.length === 0) {
        return NextResponse.json({ error: "Dữ liệu danh sách rỗng" }, { status: 400 });
      }

      let insertedCount = 0;
      for (const item of items) {
        const code = item.task_code || `TSK-EXCEL-${Date.now().toString().slice(-6)}-${insertedCount + 1}`;
        await query(
          `INSERT INTO company_tasks (
             task_code, title, department, task_category, assignee_name, customer_name,
             priority, status, deadline, description, logs
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            code,
            item.title || "Công việc từ Excel",
            item.department || "Kinh Doanh",
            item.task_category || "Nhập từ Excel",
            item.assignee_name || "",
            item.customer_name || "",
            item.priority || "MEDIUM",
            item.status || "TODO",
            item.deadline || null,
            item.description || "",
            JSON.stringify([{ time: nowVNDateTime(), action: "Nhập khẩu từ file Excel", actor: "Hệ Thống" }])
          ]
        );
        insertedCount++;
      }

      await logAudit("IMPORT_EXCEL", "TASKS", `Nhập thành công ${insertedCount} công việc từ file Excel`);
      return NextResponse.json({ success: true, count: insertedCount });
    }

    // 3. Workflow Request Create / Update
    if (action === "workflow") {
      const {
        id,
        workflow_code,
        workflow_type,
        title,
        priority,
        status,
        requester_name,
        requester_dept,
        assignee_name,
        target_dept,
        customer_name,
        product_info,
        due_date,
        description,
        results_summary,
        attachments,
        comments,
        logs,
        steps,
        current_step_index
      } = body;

      if (id) {
        const existingRes = await query("SELECT * FROM workflow_requests WHERE id = $1", [id]);
        if (existingRes.rows.length === 0) {
          return NextResponse.json({ error: "Không tìm thấy phiếu quy trình" }, { status: 404 });
        }
        const existing = existingRes.rows[0];
        if (!canActOnWorkflow(me, existing)) {
          return forbiddenResponse("Bạn không có quyền chỉnh sửa phiếu quy trình này.");
        }
        const isRollback = Boolean(body.force_rollback);

        // FSM Monotonic Guards
        const WF_STATUS_HIERARCHY: Record<string, number> = {
          "PENDING": 0,
          "IN_PROGRESS": 1,
          "COMPLETED": 2,
          "CANCELLED": 99,
          "REJECTED": 99
        };

        let safeStepIndex = typeof current_step_index === "number" ? current_step_index : (existing.current_step_index || 0);
        let safeStatus = status || existing.status || "PENDING";
        
        if (!isRollback) {
          const oldIdx = typeof existing.current_step_index === "number" ? existing.current_step_index : 0;
          if (safeStepIndex < oldIdx) {
            safeStepIndex = oldIdx; // Bảo vệ: Không để form sửa lùi bước hiện tại
          }
          const currLevel = WF_STATUS_HIERARCHY[existing.status?.toUpperCase()] ?? 0;
          const nextLevel = WF_STATUS_HIERARCHY[safeStatus?.toUpperCase()] ?? 0;
          if (nextLevel < currLevel && safeStatus?.toUpperCase() !== "CANCELLED" && safeStatus?.toUpperCase() !== "REJECTED") {
            safeStatus = existing.status; // Giữ trạng thái tiến độ cao nhất
          }
        }

        if (
          isPurchaseRequest(existing) &&
          PR_DECISION_STATUSES.has(String(safeStatus || "").toUpperCase()) &&
          String(safeStatus || "").toUpperCase() !== String(existing.status || "").toUpperCase() &&
          !canApprovePurchaseRequest(me)
        ) {
          return forbiddenResponse("Chỉ Trưởng bộ phận Cung ứng / Ban Giám Đốc mới được duyệt / kết thúc đề xuất mua hàng (PR).");
        }

        // Merge steps safely so already completed steps retain completed_at and deliverables unless explicitly edited
        let safeSteps = Array.isArray(steps) && steps.length > 0 ? steps : (existing.steps || []);
        if (Array.isArray(existing.steps) && Array.isArray(safeSteps)) {
          safeSteps = safeSteps.map((st: any, idx: number) => {
            const oldSt = existing.steps[idx];
            const preservedStartedAt = st.started_at || oldSt?.started_at || (idx === safeStepIndex ? nowVNDateTime() : undefined);
            if (!isRollback && oldSt && oldSt.status === "COMPLETED" && st.status !== "COMPLETED") {
              return { 
                ...st, 
                started_at: preservedStartedAt,
                status: "COMPLETED", 
                completed_at: oldSt.completed_at || st.completed_at, 
                completed_by: oldSt.completed_by || st.completed_by, 
                deliverables_note: st.deliverables_note || oldSt.deliverables_note 
              };
            }
            return {
              ...st,
              ...(preservedStartedAt ? { started_at: preservedStartedAt } : {}),
              ...(oldSt?.completed_at && !st.completed_at ? { completed_at: oldSt.completed_at } : {}),
              ...(oldSt?.last_reminded_at && !st.last_reminded_at ? { last_reminded_at: oldSt.last_reminded_at } : {})
            };
          });
        }

        if (safeSteps.length > 0) {
          safeStepIndex = Math.min(Math.max(0, safeStepIndex), safeSteps.length - 1);
        } else {
          safeStepIndex = 0;
        }

        const activeStep = safeSteps.length > 0 ? (safeSteps[safeStepIndex] || safeSteps[0]) : null;
        const effectiveTargetDept = activeStep?.dept || target_dept || existing.target_dept || "Application";
        const effectiveAssignee = activeStep && activeStep.assignee_name !== undefined
          ? cleanAssigneeName(activeStep.assignee_name)
          : (assignee_name !== undefined ? cleanAssigneeName(assignee_name) : (existing.assignee_name || ""));

        const safeComments = Array.isArray(comments) ? comments : (existing.comments || []);
        const safeAttachments = Array.isArray(attachments) ? attachments : (existing.attachments || []);
        const safeResultsSummary = results_summary !== undefined && results_summary !== "" ? results_summary : (existing.results_summary || "");

        const prevLogs: any[] = Array.isArray(existing.logs) ? existing.logs : [];
        const mergedWfLogs: any[] = Array.isArray(logs) && logs.length >= prevLogs.length ? [...logs] : [...prevLogs];
        const actorName = me.full_name || me.username || "Nhân viên";
        mergedWfLogs.push({
          time: nowVNDateTime(),
          action: `[Chỉnh sửa thông tin phiếu]: ${actorName} đã cập nhật thông tin phiếu phối hợp / các bước & SLA`,
          actor: actorName
        });

        await query(
          `UPDATE workflow_requests 
           SET title=$1, priority=$2, status=$3, requester_name=$4, requester_dept=$5,
               assignee_name=$6, target_dept=$7, customer_name=$8, product_info=$9,
               due_date=$10, description=$11, results_summary=$12, attachments=$13,
               comments=$14, logs=$15, steps=$16, current_step_index=$17, updated_at=CURRENT_TIMESTAMP
           WHERE id=$18`,
          [
            title || existing.title,
            priority || existing.priority || "MEDIUM",
            safeStatus,
            requester_name || existing.requester_name || "",
            requester_dept || existing.requester_dept || "",
            effectiveAssignee,
            effectiveTargetDept,
            customer_name !== undefined ? customer_name : (existing.customer_name || ""),
            product_info !== undefined ? product_info : (existing.product_info || ""),
            due_date || existing.due_date || null,
            description !== undefined ? description : (existing.description || ""),
            safeResultsSummary,
            JSON.stringify(safeAttachments),
            JSON.stringify(safeComments),
            JSON.stringify(mergedWfLogs),
            JSON.stringify(safeSteps),
            safeStepIndex,
            id
          ]
        );

        // Đồng bộ thông tin vừa chỉnh sửa sang Công việc (company_tasks) đang gắn với phiếu quy trình này
        if (existing.workflow_code) {
          const syncedTaskTitle = safeSteps.length > 0 && activeStep
            ? `[Bước ${safeStepIndex + 1}/${safeSteps.length}: ${activeStep.title}] ${title || existing.title}`
            : `[Phối hợp từ ${requester_dept || existing.requester_dept}] ${title || existing.title}`;
          const syncedTaskDesc = `Yêu cầu từ: ${requester_name || existing.requester_name} (${requester_dept || existing.requester_dept})\nSản phẩm: ${product_info !== undefined ? product_info : (existing.product_info || "")}\nNội dung: ${description !== undefined ? description : (existing.description || "")}${activeStep?.deliverables ? `\nYêu cầu kết quả bước ${safeStepIndex + 1}: ${activeStep.deliverables}` : ""}`;

          await query(
            `UPDATE company_tasks
             SET title = $1,
                 department = $2,
                 assignee_name = $3,
                 customer_name = $4,
                 priority = $5,
                 deadline = $6,
                 description = $7
             WHERE related_workflow_code = $8 AND status != 'DONE'`,
            [
              syncedTaskTitle,
              effectiveTargetDept,
              effectiveAssignee,
              customer_name !== undefined ? customer_name : (existing.customer_name || ""),
              priority || existing.priority || "MEDIUM",
              due_date || existing.due_date || null,
              syncedTaskDesc,
              existing.workflow_code
            ]
          );
        }

        await logAudit("UPDATE", "WORKFLOW", `Cập nhật phiếu quy trình ${existing.workflow_code}: ${title} (${effectiveTargetDept}) [Bước: ${safeStepIndex + 1}]`);
      } else {
        const isProcReq =
          workflow_type === "TO_PROCUREMENT" ||
          workflow_type === "PURCHASE_REQUEST" ||
          String(workflow_code || "").toUpperCase().startsWith("PR");
        if (isProcReq && !String(product_info || "").trim() && !String(results_summary || "").trim()) {
          return NextResponse.json(
            {
              error:
                "Không thể tạo đề xuất mua hàng (PR): Vui lòng chọn sản phẩm cụ thể (có Mã sản xuất & Tên hàng) từ Bảng mã sản xuất tại ô 'Sản phẩm / Thiết bị'!"
            },
            { status: 400 }
          );
        }
        const subTag = workflow_type === "SALES_TO_APP" ? "APP" : (workflow_type === "TO_PROCUREMENT" ? "PROC" : (workflow_type === "SALES_TO_WAREHOUSE" ? "WH" : "REQ"));
        const code = workflow_code || await generateDocumentCode({
          docType: "WF",
          customPrefix: subTag,
          tagMode: "GENERAL"
        });

        const initialLogs = logs && logs.length > 0 ? logs : [
          {
            time: nowVNDateTime(),
            action: `Khởi tạo quy trình từ ${requester_dept || "Nội bộ"} sang ${target_dept}`,
            actor: requester_name || "Nhân viên"
          }
        ];

        // Format steps if provided
        let formattedSteps = Array.isArray(steps) ? steps : [];
        const isCreatorApp = isAdminUser(me) || isSameDepartment(me.department, "Application");
        let finalAssignee = cleanAssigneeName(assignee_name);
        if (workflow_type === "SALES_TO_APP" && !isCreatorApp) {
          finalAssignee = "";
        }
        let finalTargetDept = target_dept || "Application";
        if (formattedSteps.length > 0) {
          formattedSteps = formattedSteps.map((s: any, idx: number) => {
            const stepDept = s.dept || finalTargetDept;
            let stepAssignee = cleanAssigneeName(s.assignee_name);
            if (isSameDepartment(stepDept, "Application") && workflow_type === "SALES_TO_APP" && !isCreatorApp) {
              stepAssignee = "";
            }
            return {
              ...s,
              dept: stepDept,
              assignee_name: stepAssignee,
              step_index: idx,
              status: idx === 0 ? "IN_PROGRESS" : (s.status || "PENDING"),
              ...(idx === 0 ? { started_at: s.started_at || nowVNDateTime() } : {})
            };
          });
          finalAssignee = formattedSteps[0].assignee_name || "";
          if (formattedSteps[0].dept) finalTargetDept = formattedSteps[0].dept;
        }

        const initialWfStatus =
          status && status !== "PENDING"
            ? status
            : formattedSteps.length > 0 || Boolean(finalAssignee)
            ? "IN_PROGRESS"
            : status || "PENDING";

        const wfInsertRes = await query(
          `INSERT INTO workflow_requests (
             workflow_code, workflow_type, title, priority, status,
             requester_name, requester_dept, assignee_name, target_dept,
             customer_name, product_info, due_date, description, results_summary,
             attachments, comments, logs, steps, current_step_index
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
           RETURNING id`,
          [
            code,
            workflow_type || "GENERAL",
            title,
            priority || "MEDIUM",
            initialWfStatus,
            requester_name || "",
            requester_dept || "",
            finalAssignee,
            finalTargetDept,
            customer_name || "",
            product_info || "",
            due_date || null,
            description || "",
            results_summary || "",
            JSON.stringify(attachments || []),
            JSON.stringify(comments || []),
            JSON.stringify(initialLogs),
            JSON.stringify(formattedSteps),
            0
          ]
        );
        const createdWfId = wfInsertRes.rows[0]?.id;

        // Auto-create task for target department / initial step
        const autoTaskCode = `TSK-${code}`;
        const taskTitle = formattedSteps.length > 0
          ? `[Bước 1/${formattedSteps.length}: ${formattedSteps[0].title}] ${title}`
          : `[Phối hợp từ ${requester_dept}] ${title}`;

        await query(
          `INSERT INTO company_tasks (
             task_code, title, department, task_category, assignee_name, customer_name,
             priority, status, deadline, description, related_workflow_code, logs,
             created_by, created_by_name
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            autoTaskCode,
            taskTitle,
            finalTargetDept,
            workflow_type === "SALES_TO_APP" ? "Demo máy & Thiết bị tại viện" :
            workflow_type === "SALES_TO_WAREHOUSE" ? "Soạn hàng & Đóng gói phiếu xuất" :
            workflow_type === "TO_PROCUREMENT" ? "Đàm phán & Mua hàng NCC" : "Phối hợp liên phòng ban",
            finalAssignee,
            customer_name || "",
            priority || "MEDIUM",
            "TODO",
            due_date || null,
            `Yêu cầu từ: ${requester_name} (${requester_dept})\nSản phẩm: ${product_info}\nNội dung: ${description}${formattedSteps.length > 0 ? `\nYêu cầu kết quả bước 1: ${formattedSteps[0].deliverables || 'N/A'}` : ''}`,
            code,
            JSON.stringify([{ time: nowVNDateTime(), action: `Tiếp nhận yêu cầu liên phòng ban ${code}`, actor: requester_name || "Hệ Thống" }]),
            me.username || null,
            requester_name || me.full_name || me.username || null
          ]
        );

        await logAudit("CREATE", "WORKFLOW", `Khởi tạo quy trình liên phòng ban ${code}: ${title}`);
        return NextResponse.json({ success: true, id: createdWfId, workflow_code: code });
      }

      return NextResponse.json({ success: true });
    }

    // 3a2. Assign / Self-Assign Workflow Step & Linked Task (Dành cho bộ phận tiếp nhận như Application tự phân công)
    if (action === "assign_workflow") {
      return await withTransaction(async (c) => {
        const { id, assignee_name, step_index, actor } = body;
        const cleanAssignee = cleanAssigneeName(assignee_name);
        if (!cleanAssignee) {
          return NextResponse.json({ error: "Vui lòng chọn nhân sự phụ trách" }, { status: 400 });
        }
        const res = await c.query("SELECT * FROM workflow_requests WHERE id = $1 FOR UPDATE", [id]);
        if (res.rows.length === 0) {
          return NextResponse.json({ error: "Không tìm thấy phiếu phối hợp" }, { status: 404 });
        }
        const wf = res.rows[0];
        const steps = Array.isArray(wf.steps) ? [...wf.steps] : [];
        const currentIdx = typeof wf.current_step_index === "number" ? wf.current_step_index : 0;
        const targetIdx = typeof step_index === "number" ? step_index : currentIdx;
        const targetStep = steps[targetIdx];

        if (!canActOnWorkflow(me, wf, targetStep)) {
          return NextResponse.json({ error: "Bạn không thuộc bộ phận phụ trách phiếu này để phân công." }, { status: 403 });
        }

        const stepDept = targetStep?.dept || wf.target_dept;
        if (steps.length > 0 && steps[targetIdx]) {
          steps[targetIdx] = { ...steps[targetIdx], assignee_name: cleanAssignee };
          // Nếu đang phân công cho bước hiện tại và các bước tiếp theo cùng thuộc bộ phận này chưa có người nhận -> gán luôn để đồng bộ
          for (let i = targetIdx + 1; i < steps.length; i++) {
            if (!cleanAssigneeName(steps[i]?.assignee_name) && isSameDepartment(steps[i]?.dept, stepDept)) {
              steps[i] = { ...steps[i], assignee_name: cleanAssignee };
            }
          }
        }

        const newTicketAssignee = targetIdx === currentIdx ? cleanAssignee : (wf.assignee_name || cleanAssignee);
        const newStatus = wf.status === "PENDING" ? "IN_PROGRESS" : wf.status;
        const currentLogs = Array.isArray(wf.logs) ? [...wf.logs] : [];
        currentLogs.push({
          time: nowVNDateTime(),
          action: `[Phân công nhân sự]: Đã phân công ${cleanAssignee} phụ trách ${targetStep ? `Bước ${targetIdx + 1} (${targetStep.title})` : "phiếu phối hợp"}`,
          actor: actor || me.full_name || "Trưởng bộ phận"
        });

        await c.query(
          `UPDATE workflow_requests
           SET assignee_name = $1, steps = $2, status = $3, logs = $4, updated_at = CURRENT_TIMESTAMP
           WHERE id = $5`,
          [newTicketAssignee, JSON.stringify(steps), newStatus, JSON.stringify(currentLogs), id]
        );

        // Đồng bộ ngay người phụ trách sang bảng công việc (company_tasks)
        if (targetIdx === currentIdx) {
          await c.query(
            `UPDATE company_tasks
             SET assignee_name = $1
             WHERE related_workflow_code = $2 AND status != 'DONE'`,
            [cleanAssignee, wf.workflow_code]
          );
        }

        await logAudit("ASSIGN", "WORKFLOW", `Phân công ${cleanAssignee} phụ trách phiếu ${wf.workflow_code}`);
        return NextResponse.json({
          success: true,
          assignee_name: newTicketAssignee,
          steps,
          status: newStatus,
          logs: currentLogs
        });
      });
    }

    // 3b. Advance Workflow Step (Stage-Gate handoff)
    if (action === "advance_step") {
      return await withTransaction(async (c) => {
      const { id, step_index, step_result, attachments, actor, next_assignee_name } = body;
      const res = await c.query("SELECT * FROM workflow_requests WHERE id = $1 FOR UPDATE", [id]);
      if (res.rows.length === 0) return NextResponse.json({ error: "Không tìm thấy phiếu" }, { status: 404 });
      const wf = res.rows[0];
      if (!canActOnWorkflow(me, wf, (Array.isArray(wf.steps) ? wf.steps : [])[typeof wf.current_step_index === "number" ? wf.current_step_index : 0])) {
        return NextResponse.json({ error: "Bạn không phụ trách bước hiện tại của phiếu này." }, { status: 403 });
      }
      // Chỉ được nghiệm thu đúng bước đang thực hiện (bấm trùng / giao diện cũ không làm nhảy bước)
      if (typeof step_index === "number" && step_index !== (typeof wf.current_step_index === "number" ? wf.current_step_index : 0)) {
        return NextResponse.json({ error: "Bước này đã được xử lý hoặc phiếu vừa được người khác cập nhật. Vui lòng tải lại." }, { status: 409 });
      }
      let steps = Array.isArray(wf.steps) ? wf.steps : [];
      if (steps.length === 0) {
        return NextResponse.json({ error: "Phiếu này không có cấu hình quy trình nhiều bước" }, { status: 400 });
      }

      const currentIdx = typeof step_index === "number" ? step_index : (wf.current_step_index || 0);
      if (!steps[currentIdx]) {
        return NextResponse.json({ error: "Bước không hợp lệ" }, { status: 400 });
      }

      // Complete current step
      steps[currentIdx].status = "COMPLETED";
      steps[currentIdx].completed_at = nowVNDateTime();
      steps[currentIdx].completed_by = actor || wf.assignee_name || "Nhân viên";
      steps[currentIdx].deliverables_note = step_result || steps[currentIdx].deliverables_note || "";
      if (attachments && attachments.length > 0) {
        steps[currentIdx].attachments = [...(steps[currentIdx].attachments || []), ...attachments];
      }

      const currentLogs = wf.logs || [];
      const nextIdx = currentIdx + 1;
      const hasNextStep = nextIdx < steps.length;

      let newStatus = wf.status;
      let newTargetDept = wf.target_dept;
      let newAssigneeName = wf.assignee_name;
      let newCurrentStepIndex = currentIdx;

      if (hasNextStep) {
        newCurrentStepIndex = nextIdx;
        steps[nextIdx].status = "IN_PROGRESS";
        steps[nextIdx].started_at = nowVNDateTime();
        if (next_assignee_name) {
          steps[nextIdx].assignee_name = next_assignee_name;
        }
        newTargetDept = steps[nextIdx].dept || newTargetDept;
        newAssigneeName = steps[nextIdx].assignee_name || newAssigneeName;
        newStatus = "IN_PROGRESS";

        currentLogs.push({
          time: nowVNDateTime(),
          action: `[Nghiệm thu Bước ${currentIdx + 1}: ${steps[currentIdx].title}] ➔ Bàn giao sang Bước ${nextIdx + 1}: ${steps[nextIdx].title} (${newAssigneeName} - ${newTargetDept})`,
          actor: actor || "Hệ Thống"
        });

        // Đóng các Task thuộc bước vừa hoàn thành trước khi sinh Task cho bước kế tiếp
        const prevStepTaskCode = currentIdx === 0 ? `TSK-${wf.workflow_code}` : `TSK-${wf.workflow_code}-S${currentIdx + 1}`;
        await c.query(
          `UPDATE company_tasks
           SET status = 'DONE',
               result = CASE WHEN COALESCE(result, '') = '' THEN $1 ELSE result END,
               logs = COALESCE(logs, '[]'::jsonb) || $2::jsonb
           WHERE related_workflow_code = $3 AND (task_code = $4 OR status != 'DONE')`,
          [
            step_result || `Đã nghiệm thu Bước ${currentIdx + 1}: ${steps[currentIdx].title}`,
            JSON.stringify([{ time: nowVNDateTime(), action: `Hoàn tất & nghiệm thu Bước ${currentIdx + 1} (${steps[currentIdx].title})`, actor: actor || "Hệ Thống" }]),
            wf.workflow_code,
            prevStepTaskCode
          ]
        );

        // Create or update task for next step
        const nextTaskCode = `TSK-${wf.workflow_code}-S${nextIdx + 1}`;
        const existingNextTask = await c.query("SELECT id FROM company_tasks WHERE task_code = $1 LIMIT 1", [nextTaskCode]);
        if (existingNextTask.rows.length > 0) {
          await c.query(
            `UPDATE company_tasks
             SET title = $1, department = $2, assignee_name = $3, status = 'TODO',
                 description = $4,
                 logs = COALESCE(logs, '[]'::jsonb) || $5::jsonb
             WHERE id = $6`,
            [
              `[Bước ${nextIdx + 1}/${steps.length}] ${steps[nextIdx].title} (${wf.workflow_code})`,
              newTargetDept,
              newAssigneeName,
              `Nhiệm vụ: ${steps[nextIdx].deliverables || steps[nextIdx].title}\nKết quả bước trước: ${step_result || "Đã nghiệm thu"}`,
              JSON.stringify([{ time: nowVNDateTime(), action: `Kích hoạt lại Bước ${nextIdx + 1} sau nghiệm thu Bước ${currentIdx + 1}`, actor: actor || "Hệ Thống" }]),
              existingNextTask.rows[0].id
            ]
          );
        } else {
          await c.query(
            `INSERT INTO company_tasks (
               task_code, title, department, task_category, assignee_name, customer_name,
               priority, status, deadline, description, related_workflow_code, logs,
               created_by, created_by_name
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
              nextTaskCode,
              `[Bước ${nextIdx + 1}/${steps.length}] ${steps[nextIdx].title} (${wf.workflow_code})`,
              newTargetDept,
              "Phối hợp liên phòng ban",
              newAssigneeName,
              wf.customer_name || "",
              wf.priority || "MEDIUM",
              "TODO",
              wf.due_date || null,
              `Nhiệm vụ: ${steps[nextIdx].deliverables || steps[nextIdx].title}\nKết quả bước trước: ${step_result || "Đã nghiệm thu"}`,
              wf.workflow_code,
              JSON.stringify([{ time: nowVNDateTime(), action: `Tiếp nhận chuyển giao từ Bước ${currentIdx + 1}`, actor: actor || "Hệ Thống" }]),
              me.username || null,
              wf.requester_name || actor || me.full_name || me.username || null
            ]
          );
        }
      } else {
        // All steps completed
        if (isPurchaseRequest(wf) && !canApprovePurchaseRequest(me)) {
          return NextResponse.json({ error: "Chỉ Trưởng bộ phận Cung ứng / Ban Giám Đốc mới được hoàn tất / duyệt đề xuất mua hàng (PR)." }, { status: 403 });
        }
        newStatus = "COMPLETED";
        currentLogs.push({
          time: nowVNDateTime(),
          action: `[Nghiệm thu Bước ${currentIdx + 1}: ${steps[currentIdx].title}] ➔ Hoàn tất toàn bộ chuỗi quy trình (${steps.length} bước)!`,
          actor: actor || "Hệ Thống"
        });
        await c.query("UPDATE company_tasks SET status = 'DONE' WHERE related_workflow_code = $1", [wf.workflow_code]);
      }

      // Collect attachments into ticket attachments
      const combinedAttachments = [...(wf.attachments || []), ...(attachments || [])];
      const combinedResultsSummary = step_result 
        ? (wf.results_summary ? `${wf.results_summary}\n[B${currentIdx + 1} - ${steps[currentIdx].title}]: ${step_result}` : `[B${currentIdx + 1} - ${steps[currentIdx].title}]: ${step_result}`)
        : wf.results_summary;

      await c.query(
        `UPDATE workflow_requests 
         SET steps = $1, current_step_index = $2, status = $3, target_dept = $4, assignee_name = $5,
             logs = $6, results_summary = $7, attachments = $8, updated_at = CURRENT_TIMESTAMP
         WHERE id = $9`,
        [
          JSON.stringify(steps),
          newCurrentStepIndex,
          newStatus,
          newTargetDept,
          newAssigneeName,
          JSON.stringify(currentLogs),
          combinedResultsSummary,
          JSON.stringify(combinedAttachments),
          id
        ]
      );

      await logAudit("ADVANCE_STEP", "WORKFLOW", `Chuyển bước quy trình ${wf.workflow_code} sang bước ${newCurrentStepIndex + 1}`);
      return NextResponse.json({ success: true, steps, current_step_index: newCurrentStepIndex, status: newStatus });
          });
}

    // 3b2. Controlled Rollback Step (Lùi bước có kiểm soát, có lý do và ghi nhận nhật ký)
    if (action === "rollback_step") {
      return await withTransaction(async (c) => {
      const { id, rollback_reason, actor } = body;
      if (!rollback_reason || !rollback_reason.trim()) {
        return NextResponse.json({ error: "Vui lòng nhập rõ lý do trả hồ sơ / lùi bước quy trình!" }, { status: 400 });
      }
      const res = await c.query("SELECT * FROM workflow_requests WHERE id = $1 FOR UPDATE", [id]);
      if (res.rows.length === 0) return NextResponse.json({ error: "Không tìm thấy phiếu" }, { status: 404 });
      const wf = res.rows[0];
      if (!canActOnWorkflow(me, wf, (Array.isArray(wf.steps) ? wf.steps : [])[typeof wf.current_step_index === "number" ? wf.current_step_index : 0])) {
        return NextResponse.json({ error: "Bạn không phụ trách bước hiện tại của phiếu này." }, { status: 403 });
      }
      const steps = Array.isArray(wf.steps) ? wf.steps : [];
      const currentIdx = typeof wf.current_step_index === "number" ? wf.current_step_index : 0;

      if (currentIdx <= 0) {
        return NextResponse.json({ error: "Quy trình đang ở bước đầu tiên, không thể lùi bước thêm!" }, { status: 400 });
      }

      const prevIdx = currentIdx - 1;
      if (steps[currentIdx]) {
        steps[currentIdx].status = "PENDING";
      }
      if (steps[prevIdx]) {
        steps[prevIdx].status = "IN_PROGRESS";
        steps[prevIdx].started_at = nowVNDateTime();
        steps[prevIdx].return_reason = rollback_reason;
        steps[prevIdx].returned_at = nowVNDateTime();
        steps[prevIdx].returned_by = actor || "Quản trị viên";
      }

      const currentLogs = wf.logs || [];
      currentLogs.push({
        time: nowVNDateTime(),
        action: `[LÙI BƯỚC / TRẢ HỒ SƠ]: Trả từ Bước ${currentIdx + 1} (${steps[currentIdx]?.title || ''}) về Bước ${prevIdx + 1} (${steps[prevIdx]?.title || ''}). Lý do: ${rollback_reason}`,
        actor: actor || "Quản trị viên"
      });

      const newTargetDept = steps[prevIdx]?.dept || wf.target_dept;
      const newAssigneeName = steps[prevIdx]?.assignee_name || wf.assignee_name;

      await c.query(
        `UPDATE workflow_requests 
         SET steps = $1, current_step_index = $2, status = 'IN_PROGRESS', 
             target_dept = $3, assignee_name = $4, logs = $5, updated_at = CURRENT_TIMESTAMP
         WHERE id = $6`,
        [JSON.stringify(steps), prevIdx, newTargetDept, newAssigneeName, JSON.stringify(currentLogs), id]
      );

      // Đồng bộ Bảng Công Việc khi lùi bước: mở lại Task của bước trước về IN_PROGRESS và thu hồi Task bước bị lùi
      const prevTaskCode = prevIdx === 0 ? `TSK-${wf.workflow_code}` : `TSK-${wf.workflow_code}-S${prevIdx + 1}`;
      const currTaskCode = `TSK-${wf.workflow_code}-S${currentIdx + 1}`;
      await c.query(
        `DELETE FROM company_tasks WHERE task_code = $1 AND COALESCE(result, '') = '' AND status != 'DONE'`,
        [currTaskCode]
      );
      await c.query(
        `UPDATE company_tasks
         SET status = 'IN_PROGRESS',
             logs = COALESCE(logs, '[]'::jsonb) || $1::jsonb
         WHERE related_workflow_code = $2 AND task_code = $3`,
        [
          JSON.stringify([{ time: nowVNDateTime(), action: `[Lùi bước từ Bước ${currentIdx + 1}]: ${rollback_reason}`, actor: actor || "Quản trị viên" }]),
          wf.workflow_code,
          prevTaskCode
        ]
      );

      await logAudit("ROLLBACK_STEP", "WORKFLOW", `Lùi bước phiếu ${wf.workflow_code} từ B${currentIdx + 1} về B${prevIdx + 1}. Lý do: ${rollback_reason}`);
      return NextResponse.json({ success: true, current_step_index: prevIdx, status: "IN_PROGRESS", steps });
          });
}

    // 3c. Workflow Template Create / Update
    if (action === "template") {
      if (!isAdminUser(me) && !hasPermission(me, "workspace.manage_templates")) {
        return forbiddenResponse("Bạn chưa có quyền \"Quản lý quy trình phối hợp mẫu\". Nhờ Quản trị viên cấp quyền (Cấu hình → Phân quyền).");
      }
      const { id, code, name, source_dept, target_dept, icon, description, sla_days, steps } = body;
      if (!name || !source_dept || !target_dept) {
        return NextResponse.json({ error: "Vui lòng nhập đầy đủ Tên quy trình, Phòng ban nguồn và Phòng ban đích" }, { status: 400 });
      }

      const tCode = code || `WF-TMP-${Date.now().toString().slice(-6)}`;
      if (id && !isNaN(Number(id))) {
        await query(
          `UPDATE workflow_templates 
           SET code=$1, name=$2, source_dept=$3, target_dept=$4, icon=$5, description=$6, sla_days=$7, steps=$8, updated_at=CURRENT_TIMESTAMP
           WHERE id=$9`,
          [tCode, name, source_dept, target_dept, icon || "ArrowRight", description || "", sla_days || 3, JSON.stringify(steps || []), Number(id)]
        );
        await logAudit("UPDATE", "WORKFLOW_TEMPLATE", `Cập nhật mẫu quy trình: ${name}`);
      } else {
        const existingByCode = await query("SELECT id FROM workflow_templates WHERE UPPER(code) = UPPER($1) LIMIT 1", [tCode]);
        if (existingByCode.rows.length > 0) {
          await query(
            `UPDATE workflow_templates 
             SET name=$1, source_dept=$2, target_dept=$3, icon=$4, description=$5, sla_days=$6, steps=$7, is_active=TRUE, updated_at=CURRENT_TIMESTAMP
             WHERE id=$8`,
            [name, source_dept, target_dept, icon || "ArrowRight", description || "", sla_days || 3, JSON.stringify(steps || []), existingByCode.rows[0].id]
          );
          await logAudit("UPDATE", "WORKFLOW_TEMPLATE", `Cập nhật mẫu quy trình chuẩn: ${name}`);
        } else {
          await query(
            `INSERT INTO workflow_templates (code, name, source_dept, target_dept, icon, description, sla_days, steps)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [tCode, name, source_dept, target_dept, icon || "ArrowRight", description || "", sla_days || 3, JSON.stringify(steps || [])]
          );
          await logAudit("CREATE", "WORKFLOW_TEMPLATE", `Tạo mới mẫu quy trình: ${name} (${source_dept} ➔ ${target_dept})`);
        }
      }

      const updatedTemplates = await query("SELECT * FROM workflow_templates WHERE is_active = TRUE ORDER BY id ASC");
      return NextResponse.json({ success: true, templates: updatedTemplates.rows });
    }

    // 3d. Delete Workflow Template
    if (action === "delete_template") {
      if (!isAdminUser(me) && !hasPermission(me, "workspace.manage_templates")) {
        return forbiddenResponse("Bạn chưa có quyền \"Quản lý quy trình phối hợp mẫu\".");
      }
      const { id } = body;
      await query(
        "DELETE FROM workflow_templates WHERE id = $1 AND UPPER(code) NOT IN ('SALES_TO_APP', 'SALES_TO_WAREHOUSE', 'TO_PROCUREMENT', 'APP_TO_WAREHOUSE', 'SALES_TO_LEGAL')",
        [id]
      );
      await logAudit("DELETE", "WORKFLOW_TEMPLATE", `Xóa mẫu quy trình id: ${id}`);
      const updatedTemplates = await query("SELECT * FROM workflow_templates WHERE is_active = TRUE ORDER BY id ASC");
      return NextResponse.json({ success: true, templates: updatedTemplates.rows });
    }

    // 4. Comment on workflow
    if (action === "workflow_comment") {
      const { id, author, text, attachments } = body;
      const newComment = {
        author: me.full_name || me.username || author || "Nhân viên",
        time: nowVNDateTime(),
        text,
        attachments: attachments || []
      };
      const res = await query(
        `UPDATE workflow_requests
         SET comments = COALESCE(comments, '[]'::jsonb) || $1::jsonb,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING comments`,
        [JSON.stringify([newComment]), id]
      );
      if (res.rows.length === 0) return NextResponse.json({ error: "Không tìm thấy phiếu" }, { status: 404 });

      return NextResponse.json({ success: true, comments: res.rows[0].comments });
    }

    // 4b. Send SLA / Deadline Reminder on Workflow Step (Đôn đốc & Nhắc việc SLA / Hạn chót)
    if (action === "remind_workflow") {
      const { id, step_index, sla_status_text, custom_note } = body;
      const wfRes = await query("SELECT * FROM workflow_requests WHERE id = $1 LIMIT 1", [id]);
      if (wfRes.rows.length === 0) {
        return NextResponse.json({ error: "Không tìm thấy phiếu phối hợp" }, { status: 404 });
      }
      const wf = wfRes.rows[0];
      const actorName = me.full_name || me.username || body.actor || "Quản lý";
      const steps = Array.isArray(wf.steps) ? [...wf.steps] : [];
      const currIdx = typeof step_index === "number"
        ? step_index
        : (typeof wf.current_step_index === "number" ? wf.current_step_index : 0);
      const activeStep = steps[currIdx];
      const stepTitle = activeStep?.title || wf.title || `Bước ${currIdx + 1}`;
      const stepDept = activeStep?.dept || wf.target_dept || "Bộ phận xử lý";
      const stepAssignee = cleanAssigneeName(activeStep?.assignee_name || wf.assignee_name);
      const targetLabel = stepAssignee ? `${stepAssignee} (${stepDept})` : `Bộ phận ${stepDept} (chưa phân công nhân sự)`;
      const nowStr = nowVNDateTime();

      if (steps[currIdx]) {
        steps[currIdx] = {
          ...steps[currIdx],
          last_reminded_at: nowStr,
          last_reminded_by: actorName,
          remind_count: (Number(steps[currIdx].remind_count) || 0) + 1
        };
      }

      const remindMessage = [
        `🔔 [ĐÔN ĐỐC TIẾN ĐỘ / SLA — ${steps.length > 0 ? `BƯỚC ${currIdx + 1}/${steps.length}: ${stepTitle}` : "PHIẾU PHỐI HỢP"}]`,
        sla_status_text ? `⏰ Tình trạng thời hạn: ${sla_status_text}` : "",
        `👉 Đầu mối nhận nhắc việc: ${targetLabel}`,
        activeStep?.deliverables ? `📋 Yêu cầu kết quả bàn giao: ${activeStep.deliverables}` : "",
        custom_note ? `💬 Chỉ đạo / Lời nhắn: ${custom_note}` : "Đề nghị khẩn trương phân công / xử lý và cập nhật biên bản kết quả đúng cam kết SLA."
      ].filter(Boolean).join("\n");

      const newComment = {
        author: actorName,
        time: nowStr,
        text: remindMessage,
        source: "sla_reminder",
        attachments: []
      };

      const currentLogs = Array.isArray(wf.logs) ? [...wf.logs] : [];
      currentLogs.push({
        time: nowStr,
        action: `[🔔 Đôn đốc / Nhắc việc SLA]: ${actorName} đã gửi nhắc nhở xử lý ${steps.length > 0 ? `Bước ${currIdx + 1} (${stepTitle})` : "phiếu"} tới ${targetLabel}${sla_status_text ? ` [${sla_status_text}]` : ""}`,
        actor: actorName
      });

      const updateRes = await query(
        `UPDATE workflow_requests
         SET steps = $1,
             comments = COALESCE(comments, '[]'::jsonb) || $2::jsonb,
             logs = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4
         RETURNING comments, logs, steps`,
        [JSON.stringify(steps), JSON.stringify([newComment]), JSON.stringify(currentLogs), id]
      );

      if (wf.workflow_code) {
        const taskRemindLog = {
          time: nowStr,
          author: actorName,
          type: "comment",
          role: "directive",
          text: remindMessage,
          attachments: []
        };
        await query(
          `UPDATE company_tasks
           SET logs = COALESCE(logs, '[]'::jsonb) || $1::jsonb
           WHERE related_workflow_code = $2 AND status != 'DONE'`,
          [JSON.stringify([taskRemindLog]), wf.workflow_code]
        );
      }

      await logAudit("REMIND", "WORKFLOW", `Đôn đốc tiến độ / SLA phiếu ${wf.workflow_code} (${targetLabel})`);
      return NextResponse.json({
        success: true,
        comments: updateRes.rows[0]?.comments || [],
        logs: updateRes.rows[0]?.logs || currentLogs,
        steps: updateRes.rows[0]?.steps || steps,
        remindedAt: nowStr,
        targetLabel,
        stepAssignee,
        stepDept
      });
    }

    // 5. Update workflow status
    if (action === "workflow_status") {
      return await withTransaction(async (c) => {
      const { id, status, actor, note, results_summary, attachments } = body;
      const res = await c.query("SELECT * FROM workflow_requests WHERE id = $1 FOR UPDATE", [id]);
      if (res.rows.length === 0) return NextResponse.json({ error: "Không tìm thấy phiếu" }, { status: 404 });
      const wfRow = res.rows[0];
      if (!canActOnWorkflow(me, wfRow)) {
        return NextResponse.json({ error: "Bạn không có quyền cập nhật phiếu này." }, { status: 403 });
      }
      if (isPurchaseRequest(wfRow) && PR_DECISION_STATUSES.has(String(status || "").toUpperCase()) && !canApprovePurchaseRequest(me)) {
        return NextResponse.json({ error: "Chỉ Trưởng bộ phận Cung ứng / Ban Giám Đốc mới được duyệt / kết thúc đề xuất mua hàng (PR)." }, { status: 403 });
      }

      const currentLogs = res.rows[0].logs || [];
      currentLogs.push({
        time: nowVNDateTime(),
        action: `Chuyển trạng thái sang [${status}]: ${note || ""}`,
        actor: actor || "Hệ Thống"
      });

      await c.query(
        "UPDATE workflow_requests SET status = $1, logs = $2, results_summary = COALESCE($3, results_summary), attachments = COALESCE($4, attachments), updated_at = CURRENT_TIMESTAMP WHERE id = $5",
        [status, JSON.stringify(currentLogs), isPurchaseRequest(wfRow) ? null : (results_summary || null), attachments ? JSON.stringify(attachments) : null, id]
      );

      // Also update related task if any
      const wfCode = res.rows[0].workflow_code;
      const taskStatus = 
        status === "COMPLETED" ? "DONE" :
        status === "IN_PROGRESS" ? "IN_PROGRESS" :
        status === "REVIEW" ? "IN_PROGRESS" : "TODO";
      
      await c.query("UPDATE company_tasks SET status = $1 WHERE related_workflow_code = $2", [taskStatus, wfCode]);

      await logAudit("UPDATE_STATUS", "WORKFLOW", `Cập nhật trạng thái phiếu ${wfCode} thành ${status}`);
      return NextResponse.json({ success: true });
          });
}

    // 5b. Record Workflow Result & Attachments
    if (action === "record_result") {
      return await withTransaction(async (c) => {
      const { id, results_summary, attachments, status, actor, note } = body;
      const res = await c.query("SELECT * FROM workflow_requests WHERE id = $1 FOR UPDATE", [id]);
      if (res.rows.length === 0) return NextResponse.json({ error: "Không tìm thấy phiếu" }, { status: 404 });
      const wfRow = res.rows[0];
      if (!canActOnWorkflow(me, wfRow)) {
        return NextResponse.json({ error: "Bạn không có quyền cập nhật phiếu này." }, { status: 403 });
      }
      if (isPurchaseRequest(wfRow) && PR_DECISION_STATUSES.has(String(status || "").toUpperCase()) && !canApprovePurchaseRequest(me)) {
        return NextResponse.json({ error: "Chỉ Trưởng bộ phận Cung ứng / Ban Giám Đốc mới được duyệt / kết thúc đề xuất mua hàng (PR)." }, { status: 403 });
      }

      const currentLogs = res.rows[0].logs || [];
      const newStatus = status || res.rows[0].status;
      currentLogs.push({
        time: nowVNDateTime(),
        action: note || `Ghi nhận kết quả & hồ sơ đính kèm (Trạng thái: ${newStatus})`,
        actor: actor || "Hệ Thống"
      });

      await c.query(
        `UPDATE workflow_requests 
         SET results_summary = COALESCE($1, results_summary),
             attachments = COALESCE($2, attachments),
             status = $3,
             logs = $4,
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = $5`,
        [
          // Với phiếu PR, results_summary chứa danh sách mặt hàng / liên kết PO -> không ghi đè
          results_summary !== undefined && !isPurchaseRequest(wfRow) ? results_summary : null,
          attachments ? JSON.stringify(attachments) : null,
          newStatus,
          JSON.stringify(currentLogs),
          id
        ]
      );

      const wfCode = res.rows[0].workflow_code;
      const taskStatus = 
        newStatus === "COMPLETED" ? "DONE" :
        newStatus === "IN_PROGRESS" ? "IN_PROGRESS" :
        newStatus === "REVIEW" ? "IN_PROGRESS" : "TODO";
      
      await c.query("UPDATE company_tasks SET status = $1 WHERE related_workflow_code = $2", [taskStatus, wfCode]);

      await logAudit("RECORD_RESULT", "WORKFLOW", `Ghi nhận kết quả phiếu ${wfCode}`);
      return NextResponse.json({ success: true });
          });
}

    // 6. Daily Log Create / Update
    if (action === "daily") {
      const {
        id,
        log_date,
        department,
        employee_name,
        work_content,
        result,
        issues,
        next_day_plan,
        related_task_code,
        plan_items,
        manager_feedback,
        manager_name,
        manager_feedback_at,
        staff_feedback,
        staff_feedback_at,
        performance_rating,
        work_hours,
        proportionality_score
      } = body;

      const syncDailyPlanItemsToTasks = async (items: any[], logDateStr: string, empName: string) => {
        if (!Array.isArray(items) || items.length === 0) return;
        for (const item of items) {
          const tId = item?.task_id ? Number(item.task_id) : null;
          const tCode = item?.task_code ? String(item.task_code).trim() : "";
          if (!tId && !tCode) continue;
          const itemStatus = String(item.status || "").toLowerCase();
          const itemResult = String(item.result || "").trim();
          const itemIssues = String(item.issues || "").trim();
          if (itemStatus !== "completed" && itemStatus !== "partial" && !itemResult && !itemIssues) continue;

          const nextTaskStatus = itemStatus === "completed" ? "DONE" : "IN_PROGRESS";
          const logEntry = {
            time: nowVNDateTime(),
            author: empName || me.full_name || "Nhân viên",
            type: "daily_sync",
            text: `[Nhật ký Daily ${logDateStr}] ${itemStatus === "completed" ? "Hoàn thành (100%)" : "Thực hiện một phần"}${itemResult ? ` — Kết quả: ${itemResult}` : ""}${itemIssues ? ` — Vướng mắc: ${itemIssues}` : ""}`
          };

          if (tId && !isNaN(tId)) {
            await query(
              `UPDATE company_tasks
               SET status = CASE WHEN $1 = 'DONE' THEN 'DONE' WHEN status = 'TODO' THEN 'IN_PROGRESS' ELSE status END,
                   result = CASE WHEN $2 != '' THEN $2 ELSE result END,
                   logs = COALESCE(logs, '[]'::jsonb) || $3::jsonb
               WHERE id = $4`,
              [nextTaskStatus, itemResult, JSON.stringify([logEntry]), tId]
            );
          } else if (tCode) {
            await query(
              `UPDATE company_tasks
               SET status = CASE WHEN $1 = 'DONE' THEN 'DONE' WHEN status = 'TODO' THEN 'IN_PROGRESS' ELSE status END,
                   result = CASE WHEN $2 != '' THEN $2 ELSE result END,
                   logs = COALESCE(logs, '[]'::jsonb) || $3::jsonb
               WHERE task_code = $4`,
              [nextTaskStatus, itemResult, JSON.stringify([logEntry]), tCode]
            );
          }
        }
      };

      if (id) {
        await query(
          `UPDATE company_daily_logs
           SET work_content = $1, result = $2, issues = $3, next_day_plan = $4,
               plan_items = $5, manager_feedback = $6, manager_name = $7, manager_feedback_at = $8,
               staff_feedback = $9, staff_feedback_at = $10, performance_rating = $11,
               work_hours = $12, proportionality_score = $13
           WHERE id = $14`,
          [
            work_content,
            result || "",
            issues || "",
            next_day_plan || "",
            JSON.stringify(plan_items || []),
            manager_feedback || null,
            manager_name || null,
            manager_feedback_at || null,
            staff_feedback || null,
            staff_feedback_at || null,
            performance_rating || null,
            work_hours || 8,
            proportionality_score || null,
            id
          ]
        );
        await syncDailyPlanItemsToTasks(plan_items || [], log_date || todayVN(), employee_name);
        await logAudit("UPDATE", "DAILY_LOG", `Cập nhật nhật ký ngày: ${employee_name} (${department})`);
        return NextResponse.json({ success: true });
      }

      await query(
        `INSERT INTO company_daily_logs (
          log_date, department, employee_name, work_content, result, issues, 
          next_day_plan, related_task_code, plan_items, manager_feedback, 
          manager_name, manager_feedback_at, staff_feedback, staff_feedback_at, 
          performance_rating, work_hours, proportionality_score
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          log_date || todayVN(),
          department || "Kinh Doanh",
          employee_name,
          work_content,
          result || "",
          issues || "",
          next_day_plan || "",
          related_task_code || null,
          JSON.stringify(plan_items || []),
          manager_feedback || null,
          manager_name || null,
          manager_feedback_at || null,
          staff_feedback || null,
          staff_feedback_at || null,
          performance_rating || null,
          work_hours || 8,
          proportionality_score || null
        ]
      );
      await syncDailyPlanItemsToTasks(plan_items || [], log_date || todayVN(), employee_name);
      await logAudit("CREATE", "DAILY_LOG", `Báo cáo nhật ký ngày ${log_date}: ${employee_name} (${department})`);
      return NextResponse.json({ success: true });
    }

    // 6b. Daily Feedback from Manager or Staff
    if (action === "daily_feedback") {
      const { id, type, text, author } = body;
      if (type === "manager") {
        await query(
          `UPDATE company_daily_logs 
           SET manager_feedback = $1, manager_name = $2, manager_feedback_at = CURRENT_TIMESTAMP 
           WHERE id = $3`,
          [text, author || "Quản lý", id]
        );
        await logAudit("FEEDBACK", "DAILY_LOG", `Quản lý ${author} chỉ đạo nhật ký #${id}`);
      } else {
        await query(
          `UPDATE company_daily_logs 
           SET staff_feedback = $1, staff_feedback_at = CURRENT_TIMESTAMP 
           WHERE id = $2`,
          [text, id]
        );
        await logAudit("FEEDBACK", "DAILY_LOG", `Nhân viên phản hồi chỉ đạo nhật ký #${id}`);
      }
      return NextResponse.json({ success: true });
    }

    // 7. Delete Task (and optionally cancel/delete linked workflow if created by mistake)
    if (action === "delete_task") {
      const { id, cancel_workflow_code, delete_workflow } = body;
      const actor = taskActor(me);
      if (id) {
        const target = (await query("SELECT * FROM company_tasks WHERE id = $1", [id])).rows[0];
        if (target && getTaskAccess(actor, target) !== "full") {
          return forbiddenResponse("Chỉ người tạo, Trưởng / Phó phòng hoặc Ban Giám Đốc mới được xóa công việc này.");
        }
      }
      if (cancel_workflow_code) {
        const wf = (await query("SELECT requester_name FROM workflow_requests WHERE workflow_code = $1", [cancel_workflow_code])).rows[0];
        const canCancelWf = actor.isAdmin || hasPermission(me, "workspace.approve_dept") || (wf && sameStaffName(wf.requester_name, me.full_name));
        if (!canCancelWf) {
          return forbiddenResponse("Chỉ người lập phiếu, Trưởng / Phó phòng hoặc Ban Giám Đốc mới được hủy / xóa phiếu phối hợp.");
        }
        await query("DELETE FROM company_tasks WHERE related_workflow_code = $1", [cancel_workflow_code]);
        if (delete_workflow) {
          await query("DELETE FROM workflow_requests WHERE workflow_code = $1", [cancel_workflow_code]);
          await logAudit("DELETE", "WORKFLOW", `Xóa phiếu phối hợp tạo nhầm: ${cancel_workflow_code}`);
        } else {
          await query("UPDATE workflow_requests SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE workflow_code = $1", [cancel_workflow_code]);
          await logAudit("CANCEL", "WORKFLOW", `Hủy phiếu phối hợp: ${cancel_workflow_code}`);
        }
      }
      if (id) {
        await query("DELETE FROM company_tasks WHERE id = $1", [id]);
        await logAudit("DELETE", "TASKS", `Xóa / hủy công việc #${id}`);
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Hành động POST không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    console.error("Workflow API POST Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

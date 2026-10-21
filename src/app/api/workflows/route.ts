import { NextRequest, NextResponse } from "next/server";
import { query, logAudit, withTransaction, httpErrorStatus } from "@/backend/db/db";
import { getAuthorizedUser, isAdminUser, unauthorizedResponse, forbiddenResponse, setAuditActor, AuthorizedUser } from "@/backend/services/authz";
import { hasPermission } from "@/backend/services/permissions";
import { todayVN, nowVNDateTime } from "@/backend/services/dates";

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
  const ka = normalizeDeptKey(a);
  const kb = normalizeDeptKey(b);
  if (!ka || !kb) return false;
  return ka === kb || ka.includes(kb) || kb.includes(ka);
}

/** Purchase requests (PR) are workflow tickets too; their approval belongs to the procurement approvers. */
function isPurchaseRequest(wf: any) {
  return lower(wf?.workflow_code).startsWith("pr") || lower(wf?.workflow_type).includes("procurement");
}

function canApprovePurchaseRequest(me: AuthorizedUser) {
  return isAdminUser(me) || hasPermission(me, "procurement.approve_po");
}

/** Requester, assignee (ticket or current step) or a member of the involved department may act on a ticket. */
function canActOnWorkflow(me: AuthorizedUser, wf: any, step?: any) {
  if (isAdminUser(me)) return true;
  const name = lower(me.full_name);
  if (name && [wf?.requester_name, wf?.assignee_name, step?.assignee_name].map(lower).includes(name)) return true;
  const dept = me.department;
  if (!dept) return false;
  const stepDepts = Array.isArray(wf?.steps) ? wf.steps.map((s: any) => s?.dept) : [];
  return [wf?.target_dept, wf?.requester_dept, step?.dept, ...stepDepts]
    .filter(Boolean)
    .some(d => isSameDepartment(d, dept));
}

const PR_DECISION_STATUSES = new Set(["APPROVED", "REJECTED", "CONVERTED", "PARTIAL_CONVERTED", "COMPLETED"]);
import { generateDocumentCode } from "@/backend/services/codeGenerator";

const DEFAULT_DB_WORKFLOW_TEMPLATES = [
  {
    code: "SALES_TO_APP",
    name: "Sales ──► Application: Yêu cầu Demo & Thử mẫu",
    source_dept: "Kinh Doanh",
    target_dept: "Application",
    icon: "FlaskConical",
    description: "Yêu cầu kỹ sư Application hỗ trợ chạy thử mẫu tại Lab TBRs hoặc mang máy đi demo trực tiếp tại viện (Bộ phận Application sẽ tự phân công nhân sự phụ trách).",
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
      { step_index: 2, title: "Theo dõi hải quan / giao nhận & Nhập kho TBRs", dept: "Kho & Vận Hành", assignee_name: "", sla_hours: 72, deliverables: "Biên bản kiểm tra CO/CQ và phiếu nhập kho (GRN)" }
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
      { step_index: 0, title: "Tiếp nhận dự thảo hợp đồng & Kiểm tra tính pháp lý", dept: "Pháp Chế", assignee_name: "Nguyễn Thị Ngọc Huyền", sla_hours: 24, deliverables: "Biên bản thẩm tra pháp lý, rà soát điều khoản thanh toán, phạt vi phạm & bảo hành" },
      { step_index: 1, title: "Hiệu chỉnh điều khoản & Phản hồi cho Sales", dept: "Pháp Chế", assignee_name: "Nguyễn Thị Ngọc Huyền", sla_hours: 24, deliverables: "Bản hợp đồng hoàn chỉnh (redline track changes) đạt chuẩn pháp lý" },
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
      const [workflows, tasks, daily, customers, products, personnel, users, templates] = await Promise.all([
        query("SELECT * FROM workflow_requests ORDER BY id DESC"),
        query("SELECT * FROM company_tasks ORDER BY id DESC"),
        query("SELECT * FROM company_daily_logs ORDER BY log_date DESC, id DESC LIMIT 100"),
        query("SELECT id, customer_code, name, address, phone, email, contact_person, contacts, classification, region, province FROM sales_customers ORDER BY name ASC"),
        query("SELECT code, name, category, unit, standard_price FROM products ORDER BY name ASC"),
        query("SELECT id, employee_code, full_name, department, position, email, phone FROM personnel ORDER BY full_name ASC"),
        query("SELECT id, username, full_name, department, role, email FROM users ORDER BY full_name ASC"),
        query("SELECT * FROM workflow_templates WHERE is_active = TRUE ORDER BY id ASC")
      ]);

      return NextResponse.json({
        workflows: workflows.rows,
        tasks: tasks.rows,
        daily: daily.rows,
        customers: customers.rows,
        products: products.rows,
        personnel: personnel.rows,
        users: users.rows,
        templates: templates.rows
      });
    }

    if (action === "templates") {
      const res = await query("SELECT * FROM workflow_templates WHERE is_active = TRUE ORDER BY id ASC");
      return NextResponse.json({ templates: res.rows });
    }

    if (action === "workflows") {
      const res = await query("SELECT * FROM workflow_requests ORDER BY id DESC");
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
      const prevTask = id ? (await query("SELECT task_code, result, attachments, related_workflow_code FROM company_tasks WHERE id = $1", [id])).rows[0] : null;
      const postReportToWorkflow = async (taskCode: string | null) => {
        const wfCode = String(related_workflow_code || prevTask?.related_workflow_code || "").trim();
        const text = String(result || "").trim();
        if (!wfCode || !text || text === String(prevTask?.result || "").trim()) return;
        const prevAtt: any[] = Array.isArray(prevTask?.attachments) ? prevTask.attachments : [];
        const seen = new Set(prevAtt.map((a: any) => String(a?.url || a?.name || "")));
        const newAtt = (Array.isArray(attachments) ? attachments : []).filter((a: any) => !seen.has(String(a?.url || a?.name || "")));
        const comment = {
          author: me.full_name || me.username || assignee_name || "Nhân viên",
          time: nowVNDateTime(),
          text,
          attachments: newAtt,
          source: "task",
          task_code: taskCode || null
        };
        await query(
          `UPDATE workflow_requests SET comments = COALESCE(comments, '[]'::jsonb) || $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE workflow_code = $2`,
          [JSON.stringify([comment]), wfCode]
        );
      };

      if (id) {
        await query(
          `UPDATE company_tasks
           SET title=$1, department=$2, task_category=$3, assignee_name=$4, customer_name=$5,
               priority=$6, status=$7, deadline=$8, description=$9, related_workflow_code=COALESCE($10, related_workflow_code),
               logs=$11, result=$12, attachments=$13
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
            JSON.stringify(logs || []),
            result || "",
            JSON.stringify(attachments || []),
            id
          ]
        );
        await postReportToWorkflow(prevTask?.task_code || task_code || null);
        await logAudit("UPDATE", "TASKS", `Cập nhật công việc: ${title} (${department})`);
      } else {
        const code = task_code || `TSK-${Date.now().toString().slice(-6)}`;
        await query(
          `INSERT INTO company_tasks (
             task_code, title, department, task_category, assignee_name, customer_name,
             priority, status, deadline, description, related_workflow_code, logs, result, attachments
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
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
            JSON.stringify(attachments || [])
          ]
        );
        await postReportToWorkflow(code);
        await logAudit("CREATE", "TASKS", `Tạo mới công việc: ${code} - ${title} (${department})`);
      }

      return NextResponse.json({ success: true });
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

        // Merge steps safely so already completed steps retain completed_at and deliverables
        let safeSteps = Array.isArray(steps) && steps.length > 0 ? steps : (existing.steps || []);
        if (Array.isArray(existing.steps) && Array.isArray(safeSteps) && !isRollback) {
          safeSteps = safeSteps.map((st: any, idx: number) => {
            const oldSt = existing.steps[idx];
            if (oldSt && oldSt.status === "COMPLETED" && st.status !== "COMPLETED") {
              return { 
                ...st, 
                status: "COMPLETED", 
                completed_at: oldSt.completed_at || st.completed_at, 
                completed_by: oldSt.completed_by || st.completed_by, 
                deliverables_note: oldSt.deliverables_note || st.deliverables_note 
              };
            }
            return st;
          });
        }

        await query(
          `UPDATE workflow_requests 
           SET title=$1, priority=$2, status=$3, requester_name=$4, requester_dept=$5,
               assignee_name=$6, target_dept=$7, customer_name=$8, product_info=$9,
               due_date=$10, description=$11, results_summary=$12, attachments=$13,
               comments=$14, logs=$15, steps=$16, current_step_index=$17, updated_at=CURRENT_TIMESTAMP
           WHERE id=$18`,
          [
            title,
            priority || "MEDIUM",
            safeStatus,
            requester_name || "",
            requester_dept || "",
            assignee_name || "",
            target_dept || "",
            customer_name || "",
            product_info || "",
            due_date || null,
            description || "",
            results_summary || "",
            JSON.stringify(attachments || []),
            JSON.stringify(comments || []),
            JSON.stringify(logs || []),
            JSON.stringify(safeSteps),
            safeStepIndex,
            id
          ]
        );
        await logAudit("UPDATE", "WORKFLOW", `Cập nhật phiếu quy trình: ${title} (${target_dept}) [Bước: ${safeStepIndex + 1}]`);
      } else {
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
              status: idx === 0 ? "IN_PROGRESS" : (s.status || "PENDING")
            };
          });
          finalAssignee = formattedSteps[0].assignee_name || "";
          if (formattedSteps[0].dept) finalTargetDept = formattedSteps[0].dept;
        }

        await query(
          `INSERT INTO workflow_requests (
             workflow_code, workflow_type, title, priority, status,
             requester_name, requester_dept, assignee_name, target_dept,
             customer_name, product_info, due_date, description, results_summary,
             attachments, comments, logs, steps, current_step_index
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
          [
            code,
            workflow_type || "GENERAL",
            title,
            priority || "MEDIUM",
            status || "PENDING",
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

        // Auto-create task for target department / initial step
        const autoTaskCode = `TSK-${code}`;
        const taskTitle = formattedSteps.length > 0
          ? `[Bước 1/${formattedSteps.length}: ${formattedSteps[0].title}] ${title}`
          : `[Phối hợp từ ${requester_dept}] ${title}`;

        await query(
          `INSERT INTO company_tasks (
             task_code, title, department, task_category, assignee_name, customer_name,
             priority, status, deadline, description, related_workflow_code, logs
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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
            JSON.stringify([{ time: nowVNDateTime(), action: `Tiếp nhận yêu cầu liên phòng ban ${code}`, actor: requester_name || "Hệ Thống" }])
          ]
        );

        await logAudit("CREATE", "WORKFLOW", `Khởi tạo quy trình liên phòng ban ${code}: ${title}`);
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

        // Create or update task for next step
        const nextTaskCode = `TSK-${wf.workflow_code}-S${nextIdx + 1}`;
        await c.query(
          `INSERT INTO company_tasks (
             task_code, title, department, task_category, assignee_name, customer_name,
             priority, status, deadline, description, related_workflow_code, logs
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            nextTaskCode,
            `[Bước ${nextIdx + 1}/${steps.length}] ${steps[nextIdx].title} (${wf.workflow_code})`,
            newTargetDept,
            "Phối hợp liên phòng ban",
            newAssigneeName,
            wf.customer_name || "",
            wf.priority || "MEDIUM",
            "TODO",
            null,
            `Nhiệm vụ: ${steps[nextIdx].deliverables || steps[nextIdx].title}\nKết quả bước trước: ${step_result || "Đã nghiệm thu"}`,
            wf.workflow_code,
            JSON.stringify([{ time: nowVNDateTime(), action: `Tiếp nhận chuyển giao từ Bước ${currentIdx + 1}`, actor: actor || "Hệ Thống" }])
          ]
        );
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

      await logAudit("ROLLBACK_STEP", "WORKFLOW", `Lùi bước phiếu ${wf.workflow_code} từ B${currentIdx + 1} về B${prevIdx + 1}. Lý do: ${rollback_reason}`);
      return NextResponse.json({ success: true, current_step_index: prevIdx, status: "IN_PROGRESS", steps });
          });
}

    // 3c. Workflow Template Create / Update
    if (action === "template") {
      if (!isAdminUser(me)) return forbiddenResponse("Chỉ Quản trị viên mới được tạo hoặc cập nhật mẫu quy trình.");
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
      if (!isAdminUser(me)) return forbiddenResponse("Chỉ Quản trị viên mới được xóa mẫu quy trình.");
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

    // 7. Delete Task
    if (action === "delete_task") {
      const { id } = body;
      await query("DELETE FROM company_tasks WHERE id = $1", [id]);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Hành động POST không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    console.error("Workflow API POST Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

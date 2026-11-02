import { NextRequest, NextResponse } from "next/server";
import { query, logAudit, withTransaction, HttpError, httpErrorStatus } from "@/backend/db/db";
import {
  getAuthorizedUser,
  isAdminUser,
  unauthorizedResponse,
  setAuditActor,
  AuthorizedUser,
} from "@/backend/services/authz";
import { hasPermission } from "@/backend/services/permissions";
import { todayVN, nowVNDateTime } from "@/backend/services/dates";
import { sameStaffName, normalizeWorkspaceDept, isSameWorkspaceDept } from "@/backend/services/workspaceTasks";

export interface ApprovalFieldDef {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "textarea";
  required?: boolean;
  placeholder?: string;
  options?: string[];
}

export interface ApprovalStageTemplate {
  stage_no: number;
  stage_name: string;
  role_type: "DEPT_HEAD" | "SPECIALIST_DEPT" | "BOD";
  dept: string;
  default_approver_hint?: string;
  conditional_on_threshold?: boolean;
}

export interface ApprovalTemplateSeed {
  code: string;
  name: string;
  category: "FINANCE" | "PROCUREMENT" | "SALES" | "HR" | "TECHNICAL" | "GENERAL";
  icon: string;
  description: string;
  sla_hours: number;
  bod_threshold_amount: number | null;
  has_line_items: boolean;
  fields_schema: ApprovalFieldDef[];
  default_stages: ApprovalStageTemplate[];
}

export const DEFAULT_APPROVAL_TEMPLATES: ApprovalTemplateSeed[] = [
  {
    code: "FIN_PAYMENT",
    name: "Đề nghị Thanh toán / Hoàn ứng Chi phí",
    category: "FINANCE",
    icon: "DollarSign",
    description:
      "Đề nghị thanh toán công nợ nhà cung cấp, chi phí vận hành, tiếp khách, công tác phí hoặc hoàn ứng kèm hóa đơn chứng từ hợp lệ.",
    sla_hours: 24,
    bod_threshold_amount: 10000000,
    has_line_items: true,
    fields_schema: [
      {
        key: "payment_method",
        label: "Hình thức thanh toán",
        type: "select",
        required: true,
        options: ["Chuyển khoản ngân hàng", "Tiền mặt tại quỹ", "Bù trừ tạm ứng"],
      },
      {
        key: "beneficiary_name",
        label: "Đơn vị / Cá nhân thụ hưởng",
        type: "text",
        required: true,
        placeholder: "VD: Công ty TNHH Thiết bị Khoa học... hoặc Họ tên nhân viên",
      },
      {
        key: "bank_account",
        label: "Số tài khoản & Ngân hàng thụ hưởng",
        type: "text",
        required: false,
        placeholder: "VD: 190368xxxx - Techcombank CN TP.HCM",
      },
      {
        key: "invoice_no",
        label: "Số Hóa đơn VAT / Hợp đồng / Đề nghị gốc",
        type: "text",
        required: false,
        placeholder: "VD: HĐ GTGT số 0001284 ngày 25/10/2026",
      },
      {
        key: "payment_due_date",
        label: "Hạn chót cần thanh toán",
        type: "date",
        required: true,
      },
    ],
    default_stages: [
      {
        stage_no: 1,
        stage_name: "Trưởng bộ phận xác nhận phát sinh thực tế",
        role_type: "DEPT_HEAD",
        dept: "REQUESTER_DEPT",
      },
      {
        stage_no: 2,
        stage_name: "Phòng Kế toán kiểm tra chứng từ, hóa đơn & ngân sách",
        role_type: "SPECIALIST_DEPT",
        dept: "Kế Toán",
      },
      {
        stage_no: 3,
        stage_name: "Ban Giám Đốc phê duyệt chi (Bắt buộc từ 10.000.000 VNĐ)",
        role_type: "BOD",
        dept: "Ban Giám Đốc",
        conditional_on_threshold: true,
      },
    ],
  },
  {
    code: "FIN_ADVANCE",
    name: "Đề nghị Tạm ứng Công tác / Nghiệp vụ",
    category: "FINANCE",
    icon: "Briefcase",
    description:
      "Đề nghị tạm ứng tiền đi công tác ngoại viện, triển khai Demo máy/Kit, tổ chức hội thảo hoặc mua vật tư khẩn.",
    sla_hours: 24,
    bod_threshold_amount: 15000000,
    has_line_items: true,
    fields_schema: [
      {
        key: "advance_purpose",
        label: "Mục đích tạm ứng",
        type: "select",
        required: true,
        options: [
          "Công tác phí & Demo ngoại viện",
          "Mua vật tư / phụ tùng khẩn cấp",
          "Chi phí hội thảo / tiếp khách bệnh viện",
          "Khác",
        ],
      },
      {
        key: "settlement_date",
        label: "Ngày cam kết hoàn ứng / quyết toán",
        type: "date",
        required: true,
      },
      {
        key: "bank_account",
        label: "Tài khoản nhận tạm ứng",
        type: "text",
        required: true,
        placeholder: "Nhập STK & Ngân hàng của người nhận tạm ứng",
      },
    ],
    default_stages: [
      {
        stage_no: 1,
        stage_name: "Trưởng bộ phận phê duyệt nhu cầu tạm ứng",
        role_type: "DEPT_HEAD",
        dept: "REQUESTER_DEPT",
      },
      {
        stage_no: 2,
        stage_name: "Kế toán kiểm tra công nợ tạm ứng tồn đọng",
        role_type: "SPECIALIST_DEPT",
        dept: "Kế Toán",
      },
      {
        stage_no: 3,
        stage_name: "Ban Giám Đốc phê duyệt hạn mức tạm ứng (Từ 15.000.000 VNĐ)",
        role_type: "BOD",
        dept: "Ban Giám Đốc",
        conditional_on_threshold: true,
      },
    ],
  },
  {
    code: "PROC_CAPEX",
    name: "Tờ trình Mua sắm Thiết bị, Tài sản & Dịch vụ",
    category: "PROCUREMENT",
    icon: "ShoppingCart",
    description:
      "Đề xuất đầu tư máy móc Lab/Sản xuất, mua sắm công cụ dụng cụ, phần mềm, dịch vụ bảo trì/hiệu chuẩn ngoài hoặc vật tư vượt định mức.",
    sla_hours: 48,
    bod_threshold_amount: 5000000,
    has_line_items: true,
    fields_schema: [
      {
        key: "Compare_quotes_summary",
        label: "Tóm tắt so sánh báo giá (Tối thiểu 2–3 Nhà cung cấp)",
        type: "textarea",
        required: true,
        placeholder: "VD: NCC A báo 45tr (BH 12 tháng, giao ngay); NCC B báo 48tr (giao 2 tuần) -> Đề xuất chọn NCC A...",
      },
      {
        key: "recommended_supplier",
        label: "Nhà cung cấp đề xuất lựa chọn",
        type: "text",
        required: true,
        placeholder: "Tên Nhà cung cấp được chọn",
      },
      {
        key: "needed_by_date",
        label: "Ngày cần bàn giao / đưa vào sử dụng",
        type: "date",
        required: true,
      },
    ],
    default_stages: [
      {
        stage_no: 1,
        stage_name: "Trưởng bộ phận xác nhận nhu cầu kỹ thuật / sử dụng",
        role_type: "DEPT_HEAD",
        dept: "REQUESTER_DEPT",
      },
      {
        stage_no: 2,
        stage_name: "Phòng Cung Ứng & Kế Toán thẩm định giá và ngân sách",
        role_type: "SPECIALIST_DEPT",
        dept: "Cung Ứng",
      },
      {
        stage_no: 3,
        stage_name: "Ban Giám Đốc phê duyệt đầu tư mua sắm (Từ 5.000.000 VNĐ)",
        role_type: "BOD",
        dept: "Ban Giám Đốc",
        conditional_on_threshold: true,
      },
    ],
  },
  {
    code: "SALES_EXCEPTION",
    name: "Tờ trình Chính sách Giá, Chiết khấu Đặc biệt & Công nợ",
    category: "SALES",
    icon: "Award",
    description:
      "Đề xuất duyệt giá bán ưu đãi ngoài khung, chiết khấu thương mại đặc biệt, xuất hàng dùng thử 0đ hoặc nới hạn mức/thời hạn công nợ cho Bệnh viện/Đại lý.",
    sla_hours: 16,
    bod_threshold_amount: 0,
    has_line_items: true,
    fields_schema: [
      {
        key: "exception_type",
        label: "Loại ngoại lệ kinh doanh",
        type: "select",
        required: true,
        options: [
          "Chiết khấu thương mại / Giá bán đặc biệt ngoài khung",
          "Mở khóa / Nới hạn mức công nợ & gia hạn thanh toán",
          "Xuất hàng Demo / Mẫu thử nghiệm lâm sàng (Giá 0đ)",
          "Đặt máy cho mượn kèm cam kết sản lượng hóa chất (Reagent Rental)",
        ],
      },
      {
        key: "discount_or_credit_detail",
        label: "Mức chiết khấu (%) hoặc Hạn mức công nợ đề xuất",
        type: "text",
        required: true,
        placeholder: "VD: Chiết khấu 18% (vượt khung 8%) hoặc Nới hạn mức công nợ lên 500tr trong 45 ngày",
      },
      {
        key: "expected_revenue_commitment",
        label: "Cam kết sản lượng / Doanh số dự kiến từ Khách hàng",
        type: "text",
        required: true,
        placeholder: "VD: Cam kết tiêu thụ tối thiểu 300 bộ Kit HBV/HCV mỗi quý",
      },
    ],
    default_stages: [
      {
        stage_no: 1,
        stage_name: "Trưởng phòng Kinh doanh thẩm định hiệu quả thương mại",
        role_type: "DEPT_HEAD",
        dept: "Kinh Doanh",
      },
      {
        stage_no: 2,
        stage_name: "Kế toán kiểm soát công nợ & biên lợi nhuận gộp",
        role_type: "SPECIALIST_DEPT",
        dept: "Kế Toán",
      },
      {
        stage_no: 3,
        stage_name: "Ban Giám Đốc phê duyệt chính sách ngoại lệ",
        role_type: "BOD",
        dept: "Ban Giám Đốc",
        conditional_on_threshold: false,
      },
    ],
  },
  {
    code: "SALES_BIDDING",
    name: "Tờ trình Phê duyệt Hồ sơ Dự thầu & Bảo lãnh Thầu Bệnh viện",
    category: "SALES",
    icon: "ShieldCheck",
    description:
      "Trình duyệt danh mục hàng hóa, giá dự thầu, thư ủy quyền hãng (MA), cam kết kỹ thuật và phát hành Bảo lãnh dự thầu tại các Bệnh viện / Sở Y tế.",
    sla_hours: 24,
    bod_threshold_amount: 0,
    has_line_items: true,
    fields_schema: [
      {
        key: "bidding_package_name",
        label: "Tên gói thầu & Số thông báo mời thầu (TBMT)",
        type: "text",
        required: true,
        placeholder: "VD: IB260019283 - Cung cấp hóa chất sinh học phân tử năm 2026–2027",
      },
      {
        key: "bid_closing_date",
        label: "Thời điểm đóng thầu / Mở thầu",
        type: "date",
        required: true,
      },
      {
        key: "bid_security_amount",
        label: "Giá trị Bảo lãnh dự thầu & Thời hạn hiệu lực",
        type: "text",
        required: true,
        placeholder: "VD: 35.000.000 VNĐ — Hiệu lực 120 ngày qua Ngân hàng...",
      },
    ],
    default_stages: [
      {
        stage_no: 1,
        stage_name: "Trưởng phòng Kinh doanh rà soát giá & cấu hình chào thầu",
        role_type: "DEPT_HEAD",
        dept: "Kinh Doanh",
      },
      {
        stage_no: 2,
        stage_name: "Pháp Chế & QA/QC thẩm định hồ sơ pháp lý / ISO / CFS / Ủy quyền",
        role_type: "SPECIALIST_DEPT",
        dept: "Pháp Chế",
      },
      {
        stage_no: 3,
        stage_name: "Ban Giám Đốc ký duyệt Hồ sơ dự thầu & Bảo lãnh thầu",
        role_type: "BOD",
        dept: "Ban Giám Đốc",
        conditional_on_threshold: false,
      },
    ],
  },
  {
    code: "HR_LEAVE_TRIP",
    name: "Đơn Xin Nghỉ phép / Công tác Ngoại viện / Tăng ca",
    category: "HR",
    icon: "Calendar",
    description:
      "Đăng ký nghỉ phép năm, nghỉ việc riêng, lịch đi công tác lắp máy/hỗ trợ kỹ thuật ngoại tỉnh hoặc đăng ký làm thêm giờ (OT) có bàn giao công việc.",
    sla_hours: 12,
    bod_threshold_amount: 20000000,
    has_line_items: false,
    fields_schema: [
      {
        key: "hr_sub_type",
        label: "Loại đăng ký nhân sự",
        type: "select",
        required: true,
        options: [
          "Nghỉ phép năm (Có hưởng lương)",
          "Nghỉ việc riêng (Không hưởng lương)",
          "Nghỉ ốm / Thai sản / Chế độ BHXH",
          "Nghỉ chế độ (Kết hôn / Tang chế)",
          "Làm việc từ xa (Work From Home)",
          "Đi công tác ngoại viện / Tỉnh",
          "Đăng ký Tăng ca (Overtime) sản xuất / kỹ thuật",
          "Nghỉ việc riêng / Nghỉ ốm",
        ],
      },
      {
        key: "from_date",
        label: "Từ ngày",
        type: "date",
        required: true,
      },
      {
        key: "to_date",
        label: "Đến hết ngày",
        type: "date",
        required: true,
      },
      {
        key: "total_days_or_hours",
        label: "Tổng số ngày nghỉ / công tác hoặc Số giờ OT",
        type: "text",
        required: true,
        placeholder: "VD: 02 ngày (hoặc 04 giờ tăng ca tối)",
      },
      {
        key: "handover_person",
        label: "Nhân sự nhận bàn giao công việc trong thời gian vắng mặt",
        type: "text",
        required: true,
        placeholder: "Nhập họ tên đồng nghiệp nhận bàn giao",
      },
    ],
    default_stages: [
      {
        stage_no: 1,
        stage_name: "Trưởng bộ phận phê duyệt lịch & phân công bàn giao",
        role_type: "DEPT_HEAD",
        dept: "REQUESTER_DEPT",
      },
      {
        stage_no: 2,
        stage_name: "Ban Giám Đốc phê duyệt (Khi công tác phí >= 20tr hoặc nghỉ dài ngày)",
        role_type: "BOD",
        dept: "Ban Giám Đốc",
        conditional_on_threshold: true,
      },
    ],
  },
  {
    code: "TECH_QMS_PROPOSAL",
    name: "Tờ trình Kỹ thuật, Thay đổi Quy trình (ECO/PCR) & Xử lý Chất lượng",
    category: "TECHNICAL",
    icon: "FlaskConical",
    description:
      "Đề xuất thay đổi định mức BOM/Routing, phê duyệt phương án xử lý sai lệch chất lượng (Deviation/CAPA), thanh lý hủy lô hoặc bảo trì thiết bị nhà máy.",
    sla_hours: 24,
    bod_threshold_amount: 10000000,
    has_line_items: true,
    fields_schema: [
      {
        key: "tech_domain",
        label: "Phân hệ Kỹ thuật / Chất lượng liên quan",
        type: "select",
        required: true,
        options: [
          "Sản xuất Kit IVD (BOM / Routing / Lô eBR)",
          "Tổng hợp Oligo (Primer / Probe / Cột CPG)",
          "Kỹ thuật – Thiết bị (DMR / DHR / Bảo trì Hiệu chuẩn)",
          "Nghiên cứu R&D (Chuyển giao Thiết kế DHF)",
          "Đảm bảo Chất lượng QA/QC (ISO 13485 / CAPA / Hủy lô)",
        ],
      },
      {
        key: "impact_assessment",
        label: "Đánh giá ảnh hưởng tới Chất lượng & An toàn sản phẩm (ISO 13485)",
        type: "textarea",
        required: true,
        placeholder: "Nêu rõ ảnh hưởng tới độ nhạy, độ đặc hiệu, hạn dùng hoặc tiến độ giao PO...",
      },
    ],
    default_stages: [
      {
        stage_no: 1,
        stage_name: "Trưởng bộ phận Kỹ thuật / Sản xuất thẩm định chuyên môn",
        role_type: "DEPT_HEAD",
        dept: "REQUESTER_DEPT",
      },
      {
        stage_no: 2,
        stage_name: "Trưởng phòng QA/QC thẩm định tuân thủ ISO 13485 & GMP",
        role_type: "SPECIALIST_DEPT",
        dept: "QA/QC",
      },
      {
        stage_no: 3,
        stage_name: "Ban Giám Đốc phê duyệt thực thi",
        role_type: "BOD",
        dept: "Ban Giám Đốc",
        conditional_on_threshold: false,
      },
    ],
  },
  {
    code: "GEN_PROPOSAL",
    name: "Tờ trình Xin Chủ trương / Đề xuất Điều hành Chung",
    category: "GENERAL",
    icon: "FileText",
    description:
      "Tờ trình xin chủ trương triển khai dự án mới, ban hành quy chế phối hợp liên phòng, đề xuất khen thưởng hoặc sáng kiến cải tiến vận hành.",
    sla_hours: 48,
    bod_threshold_amount: 0,
    has_line_items: false,
    fields_schema: [
      {
        key: "proposal_scope",
        label: "Phạm vi áp dụng của đề xuất",
        type: "select",
        required: true,
        options: ["Toàn công ty ABT", "Khối Kinh Doanh & Application", "Khối Kỹ Thuật & Nhà Máy", "Nội bộ Phòng ban"],
      },
      {
        key: "expected_benefit",
        label: "Hiệu quả / Lợi ích kỳ vọng khi áp dụng",
        type: "textarea",
        required: true,
        placeholder: "Nêu rõ lợi ích về doanh thu, tiết kiệm chi phí, rút ngắn thời gian SLA hoặc nâng cao chất lượng...",
      },
    ],
    default_stages: [
      {
        stage_no: 1,
        stage_name: "Trưởng bộ phận xem xét & đồng thuận trình lên",
        role_type: "DEPT_HEAD",
        dept: "REQUESTER_DEPT",
      },
      {
        stage_no: 2,
        stage_name: "Ban Giám Đốc phê duyệt chủ trương",
        role_type: "BOD",
        dept: "Ban Giám Đốc",
        conditional_on_threshold: false,
      },
    ],
  },
];

let approvalSchemaEnsured = false;

async function ensureApprovalTables() {
  if (approvalSchemaEnsured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS portal_approval_templates (
      code VARCHAR(64) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(64) NOT NULL,
      icon VARCHAR(64) NOT NULL DEFAULT 'FileText',
      description TEXT,
      sla_hours INT NOT NULL DEFAULT 24,
      bod_threshold_amount NUMERIC(18, 2),
      has_line_items BOOLEAN NOT NULL DEFAULT FALSE,
      fields_schema JSONB NOT NULL DEFAULT '[]'::jsonb,
      default_stages JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS portal_approval_requests (
      id SERIAL PRIMARY KEY,
      request_code VARCHAR(64) UNIQUE NOT NULL,
      template_code VARCHAR(64) NOT NULL,
      template_name VARCHAR(255) NOT NULL,
      category VARCHAR(64) NOT NULL,
      title VARCHAR(500) NOT NULL,
      priority VARCHAR(32) NOT NULL DEFAULT 'NORMAL',
      requester_username VARCHAR(120),
      requester_name VARCHAR(255) NOT NULL,
      requester_dept VARCHAR(120) NOT NULL,
      related_customer VARCHAR(255),
      related_ref_code VARCHAR(120),
      total_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
      currency VARCHAR(16) NOT NULL DEFAULT 'VND',
      form_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
      justification TEXT,
      attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
      approval_stages JSONB NOT NULL DEFAULT '[]'::jsonb,
      current_stage_no INT NOT NULL DEFAULT 1,
      status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
      followers JSONB NOT NULL DEFAULT '[]'::jsonb,
      comments_log JSONB NOT NULL DEFAULT '[]'::jsonb,
      due_at TIMESTAMP,
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_portal_approval_req_status ON portal_approval_requests (status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_portal_approval_req_dept ON portal_approval_requests (requester_dept, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_portal_approval_req_requester ON portal_approval_requests (requester_name);
  `);

  for (const tpl of DEFAULT_APPROVAL_TEMPLATES) {
    await query(
      `INSERT INTO portal_approval_templates
         (code, name, category, icon, description, sla_hours, bod_threshold_amount, has_line_items, fields_schema, default_stages, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, TRUE)
       ON CONFLICT (code) DO NOTHING`,
      [
        tpl.code,
        tpl.name,
        tpl.category,
        tpl.icon,
        tpl.description,
        tpl.sla_hours,
        tpl.bod_threshold_amount,
        tpl.has_line_items,
        JSON.stringify(tpl.fields_schema),
        JSON.stringify(tpl.default_stages),
      ]
    );
  }

  // Seed 3 realistic enterprise approval requests if table is empty and demo seed is enabled
  const countRes = await query(`SELECT COUNT(*)::int AS cnt FROM portal_approval_requests`);
  const existingCount = Number(countRes.rows[0]?.cnt || 0);
  if (existingCount === 0 && process.env.FACTORY_ALLOW_DEMO_SEED === "1") {
    const nowIso = new Date().toISOString();
    const due24h = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const due8h = new Date(Date.now() + 8 * 3600 * 1000).toISOString();

    await query(
      `INSERT INTO portal_approval_requests (
         request_code, template_code, template_name, category, title, priority,
         requester_username, requester_name, requester_dept, related_customer, related_ref_code,
         total_amount, currency, form_data, line_items, justification,
         approval_stages, current_stage_no, status, followers, comments_log, due_at
       ) VALUES
       (
         'DX-202610-001',
         'PROC_CAPEX',
         'Tờ trình Mua sắm Vật tư / Hóa chất / Thiết bị (PR/CapEx)',
         'PROCUREMENT',
         'Mua bổ sung Enzyme Taq Polymerase & Hộp cột lọc Silica phục vụ PO sản xuất Kit Q4',
         'URGENT',
         'sxkit',
         'Phòng Sản Xuất Kit',
         'Sản Xuất Kit',
         'Nhà cung cấp Qiagen / Thermo',
         'PO-SX-2026-108',
         42500000,
         'VND',
         $1::jsonb,
         $2::jsonb,
         'Tồn kho khả dụng (FEFO) của Taq HotStart chỉ còn đủ cho 02 lô trong khi kế hoạch PO tháng 11 cần sản xuất 150 bộ Kit TopSENSI HBV-50T. Đã đối chiếu 03 báo giá nhà cung cấp.',
         $3::jsonb,
         2,
         'PENDING',
         '["QA/QC", "Kế Toán"]'::jsonb,
         $4::jsonb,
         $5
       ),
       (
         'DX-202610-002',
         'SALES_EXCEPTION',
         'Tờ trình Cơ chế Bán hàng Ngoại lệ (Chiết khấu / Công nợ / Cho mượn máy)',
         'SALES',
         'Xin cơ chế chiết khấu 12% & trả chậm 45 ngày cho Hợp đồng Kit xét nghiệm tại BV Đa khoa Trung ương',
         'HIGH',
         'kinhdoanh',
         'Phòng Kinh Doanh',
         'Kinh Doanh',
         'Bệnh viện Đa khoa Trung ương',
         'BG-2026-089',
         185000000,
         'VND',
         $6::jsonb,
         '[]'::jsonb,
         'Khách hàng cam kết ký hợp đồng nguyên tắc 12 tháng với sản lượng tối thiểu 1.200 test/tháng. Biên lợi nhuận gộp sau chiết khấu 12% vẫn đạt 34.5% (vượt ngưỡng tối thiểu 28%).',
         $7::jsonb,
         1,
         'PENDING',
         '["Sales Admin"]'::jsonb,
         '[]'::jsonb,
         $8
       ),
       (
         'DX-202610-003',
         'FIN_PAYMENT',
         'Đề nghị Thanh toán / Quyết toán Chi phí (Payment Request)',
         'FINANCE',
         'Thanh toán chi phí hiệu chuẩn định kỳ ISO 13485 cho 02 máy Real-Time PCR CFX96',
         'NORMAL',
         'kythuat',
         'Phòng Kỹ Thuật – Thiết Bị',
         'Kỹ Thuật – Thiết Bị',
         'Trung tâm Kiểm định & Hiệu chuẩn Quatest 3',
         'HD-GTGT-0048192',
         14800000,
         'VND',
         $9::jsonb,
         $10::jsonb,
         'Hiệu chuẩn định kỳ bắt buộc theo lịch bảo trì thiết bị phòng QC và R&D trước kỳ đánh giá giám sát ISO 13485. Đã có biên bản nghiệm thu và tem hiệu chuẩn hợp lệ.',
         $11::jsonb,
         2,
         'APPROVED',
         '["QA/QC"]'::jsonb,
         $12::jsonb,
         $5
       )`,
      [
        JSON.stringify({
          procurement_type: "Hóa chất / Sinh phẩm / Nguyên vật liệu sản xuất",
          needed_by_date: "2026-11-05",
          selected_supplier: "Công ty TNHH Thiết bị Khoa học Kỹ thuật Việt Anh (Đại lý Thermo)",
          quotation_comparison: "Đã so sánh 3 báo giá: Việt Anh (42.5tr, có sẵn hàng giao trong 48h), BCE (44.2tr, chờ nhập 2 tuần), Sinh học Nam Khoa (43.8tr).",
          delivery_location: "Kho Lạnh Nhà máy ABT (-20°C)",
        }),
        JSON.stringify([
          { name: "HotStart Taq DNA Polymerase (5U/µL)", spec: "Ống 2500 Units (Lot hạn > 18 tháng)", unit: "Ống", qty: 5, unit_price: 6500000, amount: 32500000, note: "Bảo quản đá khô -20°C" },
          { name: "Cột lọc Silica Spin Column chuẩn IVD", spec: "Túi 250 cột kèm Collection Tube", unit: "Túi", qty: 8, unit_price: 1250000, amount: 10000000, note: "Lot mới có COA" },
        ]),
        JSON.stringify([
          {
            stage_no: 1,
            stage_name: "Trưởng bộ phận xác nhận nhu cầu sử dụng thực tế",
            role_type: "DEPT_HEAD",
            dept: "Sản Xuất Kit",
            approver_name: "Trưởng bộ phận Sản Xuất Kit",
            required: true,
            status: "APPROVED",
            acted_by: "Trưởng bộ phận Sản Xuất Kit",
            acted_at: nowIso,
            comment: "Đã kiểm tra định mức BOM và tồn kho thực tế, đồng ý trình mua gấp.",
            signature_hash: "ESIG-SXKIT-89A1F2",
          },
          {
            stage_no: 2,
            stage_name: "Bộ phận Cung ứng thẩm định báo giá & nhà cung cấp",
            role_type: "SPECIALIST_DEPT",
            dept: "Cung Ứng",
            approver_name: "Trưởng bộ phận Cung Ứng",
            required: true,
            status: "PENDING",
          },
          {
            stage_no: 3,
            stage_name: "Kế toán kiểm soát ngân sách mua hàng",
            role_type: "SPECIALIST_DEPT",
            dept: "Kế Toán",
            approver_name: "Trưởng bộ phận Kế Toán",
            required: true,
            status: "WAITING",
          },
          {
            stage_no: 4,
            stage_name: "Ban Giám Đốc phê duyệt đầu tư / mua sắm (Từ 20.000.000đ)",
            role_type: "BOD",
            dept: "Ban Giám Đốc",
            approver_name: "Ban Giám Đốc",
            required: true,
            status: "WAITING",
          },
        ]),
        JSON.stringify([
          {
            id: "CMT-SEED-1",
            actor_name: "Trưởng bộ phận Sản Xuất Kit",
            actor_dept: "Sản Xuất Kit",
            action: "APPROVED_STAGE_1",
            message: "Đã kiểm tra định mức BOM và tồn kho thực tế, đồng ý trình mua gấp.",
            created_at: nowIso,
          },
        ]),
        due24h,
        JSON.stringify({
          exception_type: "Xin vượt khung Chiết khấu thương mại",
          customer_name: "Bệnh viện Đa khoa Trung ương",
          order_value: "185.000.000 VNĐ",
          standard_policy: "Chiết khấu tối đa 5%, thanh toán trong vòng 15 ngày",
          proposed_policy: "Chiết khấu 12%, thanh toán trong vòng 45 ngày kể từ ngày nghiệm thu lô hàng",
          gross_margin_impact: "Biên lợi nhuận gộp đạt 34.5% (Vượt mức sàn 28% của công ty)",
        }),
        JSON.stringify([
          {
            stage_no: 1,
            stage_name: "Trưởng phòng Kinh doanh thẩm định hiệu quả thương mại",
            role_type: "DEPT_HEAD",
            dept: "Kinh Doanh",
            approver_name: "Trưởng bộ phận Kinh Doanh",
            required: true,
            status: "PENDING",
          },
          {
            stage_no: 2,
            stage_name: "Kế toán đánh giá rủi ro công nợ & biên lợi nhuận",
            role_type: "SPECIALIST_DEPT",
            dept: "Kế Toán",
            approver_name: "Trưởng bộ phận Kế Toán",
            required: true,
            status: "WAITING",
          },
          {
            stage_no: 3,
            stage_name: "Ban Giám Đốc phê duyệt cơ chế ngoại lệ",
            role_type: "BOD",
            dept: "Ban Giám Đốc",
            approver_name: "Ban Giám Đốc",
            required: true,
            status: "WAITING",
          },
        ]),
        due8h,
        JSON.stringify({
          payment_method: "Chuyển khoản ngân hàng",
          beneficiary_name: "Trung tâm Kỹ thuật Tiêu chuẩn Đo lường Chất lượng 3 (Quatest 3)",
          bank_account: "0071000123456 - Vietcombank CN TP.HCM",
          invoice_no: "HD-GTGT-0048192",
          payment_deadline: "2026-11-03",
          budget_status: "Trong định mức ngân sách được duyệt",
        }),
        JSON.stringify([
          { name: "Hiệu chuẩn nhiệt độ & quang học Máy Real-Time PCR CFX96 #01", spec: "Chứng chỉ ISO/IEC 17025", unit: "Máy", qty: 1, unit_price: 7400000, amount: 7400000, note: "Phòng QC" },
          { name: "Hiệu chuẩn nhiệt độ & quang học Máy Real-Time PCR CFX96 #02", spec: "Chứng chỉ ISO/IEC 17025", unit: "Máy", qty: 1, unit_price: 7400000, amount: 7400000, note: "Phòng R&D" },
        ]),
        JSON.stringify([
          {
            stage_no: 1,
            stage_name: "Trưởng bộ phận xác nhận nghiệp vụ phát sinh",
            role_type: "DEPT_HEAD",
            dept: "Kỹ Thuật – Thiết Bị",
            approver_name: "Trưởng bộ phận Kỹ Thuật – Thiết Bị",
            required: true,
            status: "APPROVED",
            acted_by: "Trưởng bộ phận Kỹ Thuật – Thiết Bị",
            acted_at: nowIso,
            comment: "Thiết bị đã hiệu chuẩn đạt yêu cầu và dán tem mới.",
            signature_hash: "ESIG-TECH-31B8C4",
          },
          {
            stage_no: 2,
            stage_name: "Kế toán kiểm tra chứng từ, hóa đơn & ngân sách",
            role_type: "SPECIALIST_DEPT",
            dept: "Kế Toán",
            approver_name: "Trưởng bộ phận Kế Toán",
            required: true,
            status: "APPROVED",
            acted_by: "Trưởng bộ phận Kế Toán",
            acted_at: nowIso,
            comment: "Đã đối chiếu Hóa đơn GTGT hợp lệ, dưới 15tr nên hoàn tất duyệt chi.",
            signature_hash: "ESIG-FIN-92D4E1",
          },
          {
            stage_no: 3,
            stage_name: "Ban Giám Đốc phê duyệt chi (Bắt buộc từ 15.000.000đ)",
            role_type: "BOD",
            dept: "Ban Giám Đốc",
            approver_name: "Ban Giám Đốc",
            required: false,
            status: "SKIPPED",
            comment: "Tự động bỏ qua do giá trị đề xuất dưới hạn mức cần trình Ban Giám Đốc",
          },
        ]),
        JSON.stringify([
          {
            id: "CMT-SEED-3",
            actor_name: "Trưởng bộ phận Kế Toán",
            actor_dept: "Kế Toán",
            action: "FINAL_APPROVED",
            message: "Đã đối chiếu Hóa đơn GTGT hợp lệ, dưới 15tr nên hoàn tất duyệt chi.",
            created_at: nowIso,
          },
        ]),
      ]
    );
  }

  approvalSchemaEnsured = true;
}

function isDirectorOrAdmin(me: AuthorizedUser): boolean {
  if (isAdminUser(me)) return true;
  const r = String(me.role || "").toLowerCase();
  const d = String(me.department || "").toLowerCase();
  return r.includes("director") || r.includes("giám đốc") || d.includes("giám đốc") || d.includes("bod");
}

function isDeptManager(me: AuthorizedUser): boolean {
  if (isDirectorOrAdmin(me)) return true;
  if (hasPermission(me, "workspace.approve_dept")) return true;
  const r = String(me.role || "").toLowerCase();
  return r.includes("head") || r.includes("lead") || r.includes("manager") || r.includes("trưởng phòng") || r.includes("phó phòng") || r.includes("quản đốc");
}

/** Kiểm tra người dùng hiện tại có thẩm quyền phê duyệt tại bước (stage) đang xét hay không */
function canApproveStage(me: AuthorizedUser, stage: any, requesterDept: string): boolean {
  if (!stage) return false;
  if (isDirectorOrAdmin(me)) return true;

  const myName = String(me.full_name || "").trim();
  const myUsername = String(me.username || "").trim().toLowerCase();
  const stageApproverName = String(stage.approver_name || "").trim();
  const stageApproverUser = String(stage.approver_username || "").trim().toLowerCase();

  // Nếu bước này đã gán đích danh người duyệt và khớp với người đang đăng nhập
  if (stageApproverUser && myUsername && stageApproverUser === myUsername) return true;
  if (stageApproverName && myName && sameStaffName(stageApproverName, myName)) return true;

  // Nếu bước này là của Ban Giám Đốc thì chỉ BGD/Admin hoặc người được đích danh mới duyệt được
  const targetDept = stage.dept === "REQUESTER_DEPT" ? requesterDept : String(stage.dept || "");
  if (targetDept.toLowerCase().includes("giám đốc") || stage.role_type === "BOD") {
    return false;
  }

  // Nếu người dùng thuộc đúng phòng ban phụ trách bước này và là Quản lý/Trưởng phòng (hoặc bước chuyên môn Kế toán/Pháp chế/QA/Cung ứng)
  const sameDept = isSameWorkspaceDept(me.department, targetDept);
  if (!sameDept) return false;

  if (stage.role_type === "SPECIALIST_DEPT") {
    // Trong phòng chuyên môn (Kế toán, Pháp chế, Cung ứng, QA/QC), trưởng phòng hoặc chuyên viên được phân quyền của phòng đó có thể thẩm định bước 2
    return true;
  }
  return isDeptManager(me);
}

function buildSignatureHash(username: string, requestCode: string, stageNo: number, action: string): string {
  const raw = `${username}|${requestCode}|S${stageNo}|${action}|${Date.now()}`;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `ESIG-${(hash >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

async function resolveDefaultApproverForDept(client: any, deptName: string): Promise<{ full_name: string; username: string }> {
  const norm = normalizeWorkspaceDept(deptName);
  const res = await client.query(
    `SELECT username, full_name, role, department
       FROM users
      WHERE COALESCE(full_name, '') <> ''
      ORDER BY id ASC`
  );
  const users = res.rows || [];
  // Ưu tiên tìm Trưởng phòng / Giám đốc thuộc đúng phòng ban đó
  const deptManagers = users.filter((u: any) => {
    if (!isSameWorkspaceDept(u.department, norm)) return false;
    const r = String(u.role || "").toLowerCase();
    return (
      r.includes("director") ||
      r.includes("giám đốc") ||
      r.includes("manager") ||
      r.includes("head") ||
      r.includes("trưởng") ||
      r.includes("lead") ||
      r.includes("admin")
    );
  });
  if (deptManagers[0]) {
    return { full_name: deptManagers[0].full_name, username: deptManagers[0].username || "" };
  }
  const anyInDept = users.find((u: any) => isSameWorkspaceDept(u.department, norm));
  if (anyInDept) {
    return { full_name: anyInDept.full_name, username: anyInDept.username || "" };
  }
  if (norm.toLowerCase().includes("giám đốc")) {
    const bod = users.find((u: any) => String(u.role || "").toLowerCase().includes("admin") || String(u.role || "").toLowerCase().includes("director"));
    if (bod) return { full_name: bod.full_name, username: bod.username || "" };
  }
  return { full_name: `Trưởng bộ phận ${norm}`, username: "" };
}

export async function GET(req: NextRequest) {
  try {
    const me = await getAuthorizedUser(req);
    if (!me) return unauthorizedResponse();
    setAuditActor(me);
    await ensureApprovalTables();

    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category") || "ALL";
    const status = searchParams.get("status") || "ALL";
    const q = (searchParams.get("q") || "").trim();

    const templatesRes = await query(
      `SELECT * FROM portal_approval_templates WHERE is_active = TRUE ORDER BY
         CASE category
           WHEN 'FINANCE' THEN 1
           WHEN 'PROCUREMENT' THEN 2
           WHEN 'SALES' THEN 3
           WHEN 'TECHNICAL' THEN 4
           WHEN 'HR' THEN 5
           ELSE 6
         END, code ASC`
    );

    const params: any[] = [];
    const where: string[] = [];

    if (category && category !== "ALL") {
      params.push(category);
      where.push(`r.category = $${params.length}`);
    }
    if (status && status !== "ALL") {
      params.push(status);
      where.push(`r.status = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(
        `(r.request_code ILIKE $${params.length} OR r.title ILIKE $${params.length} OR r.requester_name ILIKE $${params.length} OR COALESCE(r.related_customer, '') ILIKE $${params.length} OR COALESCE(r.related_ref_code, '') ILIKE $${params.length})`
      );
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const reqRes = await query(
      `SELECT r.*
         FROM portal_approval_requests r
         ${whereSql}
        ORDER BY
          CASE r.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END,
          r.created_at DESC
        LIMIT 200`,
      params
    );

    // Lấy danh sách nhân sự thật theo phòng ban để hiển thị trong bộ chọn người duyệt / người theo dõi
    const usersRes = await query(
      `SELECT id, username, full_name, role, department, email
         FROM users
        WHERE COALESCE(full_name, '') <> ''
        ORDER BY department ASC, full_name ASC`
    );

    const myName = String(me.full_name || "").trim();
    const myUsername = String(me.username || "").trim().toLowerCase();
    const isBoss = isDirectorOrAdmin(me);
    const isMgr = isDeptManager(me);

    // Phân quyền hiển thị & Đánh dấu tờ trình nào đang chờ chính người dùng này phê duyệt
    const enrichedRequests = (reqRes.rows || [])
      .filter((row: any) => {
        if (isBoss) return true;
        // Cho phép toàn công ty & Kế toán xem lịch Nghỉ phép / Công tác (HR_LEAVE_TRIP) để phối hợp bàn giao & chấm công tháng
        if (row.template_code === "HR_LEAVE_TRIP" || row.category === "HR") return true;
        if (sameStaffName(row.requester_name, myName) || String(row.requester_username || "").toLowerCase() === myUsername) return true;
        if (isSameWorkspaceDept(row.requester_dept, me.department)) return true;
        const stages = Array.isArray(row.approval_stages) ? row.approval_stages : [];
        if (
          stages.some(
            (s: any) =>
              sameStaffName(s.approver_name, myName) ||
              String(s.approver_username || "").toLowerCase() === myUsername ||
              isSameWorkspaceDept(s.dept, me.department)
          )
        ) {
          return true;
        }
        const followers = Array.isArray(row.followers) ? row.followers : [];
        if (followers.some((f: any) => sameStaffName(f, myName))) return true;
        return false;
      })
      .map((row: any) => {
        const stages = Array.isArray(row.approval_stages) ? row.approval_stages : [];
        const currentStage = stages.find((s: any) => Number(s.stage_no) === Number(row.current_stage_no));
        const isPendingActive = ["PENDING", "IN_REVIEW"].includes(row.status);
        const canApproveNow = isPendingActive && currentStage ? canApproveStage(me, currentStage, row.requester_dept) : false;
        const isMyRequest =
          sameStaffName(row.requester_name, myName) ||
          (myUsername && String(row.requester_username || "").toLowerCase() === myUsername);
        const isOverdue =
          isPendingActive && row.due_at ? new Date(row.due_at).getTime() < Date.now() : false;

        return {
          ...row,
          total_amount: Number(row.total_amount || 0),
          current_stage: currentStage || null,
          can_approve_now: canApproveNow,
          is_my_request: isMyRequest,
          is_overdue: isOverdue,
        };
      });

    const summary = {
      pending_my_approval: enrichedRequests.filter((r: any) => r.can_approve_now).length,
      my_open_requests: enrichedRequests.filter(
        (r: any) => r.is_my_request && ["PENDING", "IN_REVIEW", "NEED_INFO"].includes(r.status)
      ).length,
      need_info_count: enrichedRequests.filter((r: any) => r.status === "NEED_INFO" && (r.is_my_request || isBoss)).length,
      approved_count: enrichedRequests.filter((r: any) => r.status === "APPROVED").length,
      rejected_count: enrichedRequests.filter((r: any) => r.status === "REJECTED").length,
      overdue_count: enrichedRequests.filter((r: any) => r.is_overdue).length,
    };

    return NextResponse.json({
      templates: templatesRes.rows,
      requests: enrichedRequests,
      summary,
      staff_directory: usersRes.rows,
      current_user: {
        username: me.username,
        full_name: me.full_name,
        department: me.department,
        role: me.role,
        is_director: isBoss,
        is_manager: isMgr,
      },
    });
  } catch (error: any) {
    console.error("[GET /api/approvals] error:", error);
    return NextResponse.json(
      { error: error?.message || "Không tải được danh sách Đề xuất & Phê duyệt" },
      { status: httpErrorStatus(error) }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await getAuthorizedUser(req);
    if (!me) return unauthorizedResponse();
    setAuditActor(me);
    await ensureApprovalTables();

    const body = await req.json();
    const { action } = body;

    return await withTransaction(async (client) => {
      // =========================================================================
      // 1. TẠO MỚI HOẶC CẬP NHẬT & TRÌNH DUYỆT ĐỀ XUẤT (CREATE / RESUBMIT)
      // =========================================================================
      if (action === "create_request" || action === "resubmit_request") {
        const isResubmit = action === "resubmit_request";
        const tplCode = String(body.template_code || "GEN_PROPOSAL").trim();
        const tplRes = await client.query("SELECT * FROM portal_approval_templates WHERE code = $1 LIMIT 1", [tplCode]);
        const tpl = tplRes.rows[0];
        if (!tpl) throw new HttpError(400, `Không tìm thấy mẫu đề xuất "${tplCode}".`);

        const title = String(body.title || "").trim();
        if (!title) throw new HttpError(400, "Vui lòng nhập Tiêu đề tờ trình / đề xuất.");

        const priority = ["URGENT", "HIGH", "NORMAL"].includes(body.priority) ? body.priority : "NORMAL";
        const requesterDept = normalizeWorkspaceDept(body.requester_dept || me.department || "Kinh Doanh");
        const lineItems = Array.isArray(body.line_items)
          ? body.line_items
              .filter((it: any) => String(it?.description || "").trim())
              .map((it: any, idx: number) => {
                const qty = Math.max(0, Number(it.qty || 1));
                const price = Math.max(0, Number(it.unit_price || 0));
                return {
                  line_no: idx + 1,
                  description: String(it.description || "").trim(),
                  unit: String(it.unit || "ĐV").trim(),
                  qty,
                  unit_price: price,
                  amount: Math.round(qty * price),
                  note: String(it.note || "").trim(),
                };
              })
          : [];

        const computedLineSum = lineItems.reduce((sum: number, it: any) => sum + Number(it.amount || 0), 0);
        const totalAmount = computedLineSum > 0 ? computedLineSum : Math.max(0, Number(body.total_amount || 0));
        const formData = body.form_data && typeof body.form_data === "object" ? body.form_data : {};
        const justification = String(body.justification || "").trim();
        const attachments = Array.isArray(body.attachments) ? body.attachments : [];
        const followers = Array.isArray(body.followers) ? body.followers : [];
        const customApprovers = body.stage_approvers && typeof body.stage_approvers === "object" ? body.stage_approvers : {};

        // Xây dựng chuỗi các cấp phê duyệt (Multi-stage conditional routing)
        const rawStages: ApprovalStageTemplate[] = Array.isArray(tpl.default_stages) ? tpl.default_stages : [];
        const bodThreshold = tpl.bod_threshold_amount !== null && tpl.bod_threshold_amount !== undefined ? Number(tpl.bod_threshold_amount) : null;

        const builtStages: any[] = [];
        for (const st of rawStages) {
          const actualDept = st.dept === "REQUESTER_DEPT" ? requesterDept : st.dept;
          const resolved = await resolveDefaultApproverForDept(client, actualDept);
          const customName = String(customApprovers[String(st.stage_no)] || "").trim();

          // Kiểm tra điều kiện vượt hạn mức đối với cấp Ban Giám Đốc
          let isRequired = true;
          let skipReason = "";
          if (st.conditional_on_threshold && bodThreshold !== null && bodThreshold > 0) {
            if (totalAmount < bodThreshold) {
              isRequired = false;
              skipReason = `Dưới hạn mức trình BGD (${bodThreshold.toLocaleString("vi-VN")} đ) — Duyệt theo phân cấp Trưởng bộ phận & Phòng chuyên môn`;
            }
          }

          builtStages.push({
            stage_no: st.stage_no,
            stage_name: st.stage_name,
            role_type: st.role_type,
            dept: actualDept,
            approver_name: customName || resolved.full_name,
            approver_username: customName ? "" : resolved.username,
            is_required: isRequired,
            status: isRequired ? "WAITING" : "SKIPPED",
            acted_by: null,
            acted_at: null,
            comment: skipReason || null,
            signature_hash: null,
          });
        }

        // Mở bước bắt buộc đầu tiên sang trạng thái PENDING
        const firstActiveStage = builtStages.find((s) => s.is_required) || builtStages[0];
        if (firstActiveStage) {
          firstActiveStage.status = "PENDING";
        }
        const currentStageNo = firstActiveStage ? firstActiveStage.stage_no : 1;
        const slaHours = Number(tpl.sla_hours || 24);
        const dueAt = new Date(Date.now() + slaHours * 3600 * 1000).toISOString();

        if (isResubmit && body.id) {
          const existingRes = await client.query("SELECT * FROM portal_approval_requests WHERE id = $1 FOR UPDATE", [Number(body.id)]);
          const existing = existingRes.rows[0];
          if (!existing) throw new HttpError(404, "Không tìm thấy tờ trình cần trình lại.");
          const isOwner =
            sameStaffName(existing.requester_name, me.full_name) ||
            String(existing.requester_username || "").toLowerCase() === String(me.username || "").toLowerCase() ||
            isDirectorOrAdmin(me);
          if (!isOwner) throw new HttpError(403, "Chỉ người tạo đề xuất mới có quyền chỉnh sửa và trình duyệt lại.");
          if (!["NEED_INFO", "WITHDRAWN", "DRAFT"].includes(existing.status)) {
            throw new HttpError(400, "Chỉ tờ trình ở trạng thái Cần bổ sung giải trình hoặc Đã rút mới được trình duyệt lại.");
          }

          const prevLogs = Array.isArray(existing.comments_log) ? existing.comments_log : [];
          const nextLogs = [
            ...prevLogs,
            {
              id: `LOG-${Date.now()}`,
              actor_name: me.full_name || me.username,
              actor_dept: me.department || requesterDept,
              action: "RESUBMIT",
              comment: body.resubmit_note || "Đã cập nhật hồ sơ / giải trình bổ sung và trình duyệt lại.",
              created_at: nowVNDateTime(),
            },
          ];

          const upd = await client.query(
            `UPDATE portal_approval_requests
                SET title = $2,
                    priority = $3,
                    related_customer = $4,
                    related_ref_code = $5,
                    total_amount = $6,
                    form_data = $7::jsonb,
                    line_items = $8::jsonb,
                    justification = $9,
                    attachments = $10::jsonb,
                    approval_stages = $11::jsonb,
                    current_stage_no = $12,
                    status = 'PENDING',
                    followers = $13::jsonb,
                    comments_log = $14::jsonb,
                    due_at = $15,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = $1
              RETURNING *`,
            [
              existing.id,
              title,
              priority,
              body.related_customer || null,
              body.related_ref_code || null,
              totalAmount,
              JSON.stringify(formData),
              JSON.stringify(lineItems),
              justification,
              JSON.stringify(attachments),
              JSON.stringify(builtStages),
              currentStageNo,
              JSON.stringify(followers),
              JSON.stringify(nextLogs),
              dueAt,
            ]
          );
          await logAudit("RESUBMIT_APPROVAL", "APPROVALS", `Trình duyệt lại đề xuất ${existing.request_code}: ${title}`);
          return NextResponse.json({ ok: true, request: upd.rows[0] });
        }

        // Sinh mã tờ trình tự động DX-YYYYMM-XXXX
        const ym = todayVN().slice(0, 7).replace("-", "");
        const seqRes = await client.query("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM portal_approval_requests");
        const nextSeq = String(seqRes.rows[0]?.next_id || 1).padStart(4, "0");
        const requestCode = `DX-${ym}-${nextSeq}`;

        const initLog = [
          {
            id: `LOG-${Date.now()}`,
            actor_name: me.full_name || me.username,
            actor_dept: requesterDept,
            action: "SUBMIT",
            comment: `Khởi tạo và trình duyệt đề xuất (${tpl.name})`,
            created_at: nowVNDateTime(),
          },
        ];

        const ins = await client.query(
          `INSERT INTO portal_approval_requests
             (request_code, template_code, template_name, category, title, priority,
              requester_username, requester_name, requester_dept,
              related_customer, related_ref_code, total_amount, currency,
              form_data, line_items, justification, attachments,
              approval_stages, current_stage_no, status, followers, comments_log, due_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'VND',$13::jsonb,$14::jsonb,$15,$16::jsonb,$17::jsonb,$18,'PENDING',$19::jsonb,$20::jsonb,$21)
           RETURNING *`,
          [
            requestCode,
            tpl.code,
            tpl.name,
            tpl.category,
            title,
            priority,
            me.username,
            me.full_name || me.username,
            requesterDept,
            body.related_customer || null,
            body.related_ref_code || null,
            totalAmount,
            JSON.stringify(formData),
            JSON.stringify(lineItems),
            justification,
            JSON.stringify(attachments),
            JSON.stringify(builtStages),
            currentStageNo,
            JSON.stringify(followers),
            JSON.stringify(initLog),
            dueAt,
          ]
        );

        await logAudit("CREATE_APPROVAL", "APPROVALS", `Tạo đề xuất ${requestCode} (${tpl.name}): ${title}`);
        return NextResponse.json({ ok: true, request: ins.rows[0] });
      }

      // =========================================================================
      // 2. XỬ LÝ PHÊ DUYỆT / YÊU CẦU BỔ SUNG / TỪ CHỐI / RÚT ĐỀ XUẤT / ỦY QUYỀN
      // =========================================================================
      if (["approve", "reject", "return_for_info", "withdraw", "delegate", "add_comment"].includes(action)) {
        const reqId = Number(body.id);
        if (!reqId) throw new HttpError(400, "Thiếu mã định danh tờ trình.");
        const rowRes = await client.query("SELECT * FROM portal_approval_requests WHERE id = $1 FOR UPDATE", [reqId]);
        const row = rowRes.rows[0];
        if (!row) throw new HttpError(404, "Không tìm thấy tờ trình đề xuất.");

        const stages: any[] = Array.isArray(row.approval_stages) ? [...row.approval_stages] : [];
        const logs: any[] = Array.isArray(row.comments_log) ? [...row.comments_log] : [];
        const comment = String(body.comment || "").trim();
        const actorName = me.full_name || me.username;

        // 2a. Bình luận trao đổi trên tờ trình
        if (action === "add_comment") {
          if (!comment) throw new HttpError(400, "Vui lòng nhập nội dung trao đổi / bình luận.");
          logs.push({
            id: `LOG-${Date.now()}`,
            actor_name: actorName,
            actor_dept: me.department || "",
            action: "COMMENT",
            comment,
            created_at: nowVNDateTime(),
          });
          const upd = await client.query(
            "UPDATE portal_approval_requests SET comments_log = $2::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *",
            [row.id, JSON.stringify(logs)]
          );
          return NextResponse.json({ ok: true, request: upd.rows[0] });
        }

        // 2b. Người tạo rút lại tờ trình (WITHDRAW)
        if (action === "withdraw") {
          const isOwner =
            sameStaffName(row.requester_name, actorName) ||
            String(row.requester_username || "").toLowerCase() === String(me.username || "").toLowerCase() ||
            isDirectorOrAdmin(me);
          if (!isOwner) throw new HttpError(403, "Chỉ người tạo tờ trình mới được rút lại đề xuất.");
          if (["APPROVED", "REJECTED"].includes(row.status)) {
            throw new HttpError(400, "Tờ trình đã có quyết định cuối cùng, không thể rút lại.");
          }
          logs.push({
            id: `LOG-${Date.now()}`,
            actor_name: actorName,
            actor_dept: me.department || "",
            action: "WITHDRAW",
            comment: comment || "Người đề xuất chủ động rút lại tờ trình để chỉnh sửa.",
            created_at: nowVNDateTime(),
          });
          const upd = await client.query(
            "UPDATE portal_approval_requests SET status = 'WITHDRAWN', comments_log = $2::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *",
            [row.id, JSON.stringify(logs)]
          );
          await logAudit("WITHDRAW_APPROVAL", "APPROVALS", `Rút lại tờ trình ${row.request_code}`);
          return NextResponse.json({ ok: true, request: upd.rows[0] });
        }

        // Kiểm tra tờ trình đang ở trạng thái chờ duyệt
        if (!["PENDING", "IN_REVIEW"].includes(row.status)) {
          throw new HttpError(400, `Tờ trình đang ở trạng thái "${row.status}", không thể thực hiện thao tác duyệt.`);
        }

        const currentIdx = stages.findIndex((s) => Number(s.stage_no) === Number(row.current_stage_no));
        if (currentIdx === -1) throw new HttpError(400, "Không xác định được bước phê duyệt hiện tại.");
        const currentStage = stages[currentIdx];

        if (!canApproveStage(me, currentStage, row.requester_dept)) {
          throw new HttpError(
            403,
            `Bạn chưa có thẩm quyền xử lý tại Bước ${currentStage.stage_no} (${currentStage.stage_name} — Phụ trách: ${currentStage.approver_name || currentStage.dept}).`
          );
        }

        // 2c. Ủy quyền / Chuyển người duyệt bước hiện tại (DELEGATE)
        if (action === "delegate") {
          const delegateToName = String(body.delegate_to_name || "").trim();
          if (!delegateToName) throw new HttpError(400, "Vui lòng chọn cán bộ nhận ủy quyền phê duyệt.");
          const prevApprover = currentStage.approver_name;
          stages[currentIdx] = {
            ...currentStage,
            approver_name: delegateToName,
            approver_username: String(body.delegate_to_username || "").trim(),
          };
          logs.push({
            id: `LOG-${Date.now()}`,
            actor_name: actorName,
            actor_dept: me.department || "",
            action: "DELEGATE",
            stage_no: currentStage.stage_no,
            comment: `Ủy quyền / Chuyển người duyệt Bước ${currentStage.stage_no} từ "${prevApprover}" sang "${delegateToName}". ${comment}`,
            created_at: nowVNDateTime(),
          });
          const upd = await client.query(
            "UPDATE portal_approval_requests SET approval_stages = $2::jsonb, comments_log = $3::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *",
            [row.id, JSON.stringify(stages), JSON.stringify(logs)]
          );
          await logAudit("DELEGATE_APPROVAL", "APPROVALS", `Ủy quyền duyệt Bước ${currentStage.stage_no} của ${row.request_code} sang ${delegateToName}`);
          return NextResponse.json({ ok: true, request: upd.rows[0] });
        }

        // 2d. Yêu cầu bổ sung giải trình / Trả về chỉnh sửa (RETURN_FOR_INFO)
        if (action === "return_for_info") {
          if (!comment) throw new HttpError(400, "Vui lòng ghi rõ nội dung yêu cầu người đề xuất bổ sung hoặc giải trình lại.");
          stages[currentIdx] = {
            ...currentStage,
            status: "RETURNED",
            acted_by: actorName,
            acted_at: nowVNDateTime(),
            comment,
          };
          logs.push({
            id: `LOG-${Date.now()}`,
            actor_name: actorName,
            actor_dept: me.department || "",
            action: "RETURN_FOR_INFO",
            stage_no: currentStage.stage_no,
            comment: `[Bước ${currentStage.stage_no} yêu cầu bổ sung]: ${comment}`,
            created_at: nowVNDateTime(),
          });
          const upd = await client.query(
            "UPDATE portal_approval_requests SET status = 'NEED_INFO', approval_stages = $2::jsonb, comments_log = $3::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *",
            [row.id, JSON.stringify(stages), JSON.stringify(logs)]
          );
          await logAudit("RETURN_APPROVAL", "APPROVALS", `Yêu cầu bổ sung hồ sơ tờ trình ${row.request_code}: ${comment}`);
          return NextResponse.json({ ok: true, request: upd.rows[0] });
        }

        // 2e. Từ chối tờ trình (REJECT)
        if (action === "reject") {
          if (!comment) throw new HttpError(400, "Bắt buộc nhập lý do từ chối phê duyệt.");
          const sig = buildSignatureHash(me.username, row.request_code, currentStage.stage_no, "REJECT");
          stages[currentIdx] = {
            ...currentStage,
            status: "REJECTED",
            acted_by: actorName,
            acted_at: nowVNDateTime(),
            comment,
            signature_hash: sig,
          };
          logs.push({
            id: `LOG-${Date.now()}`,
            actor_name: actorName,
            actor_dept: me.department || "",
            action: "REJECT",
            stage_no: currentStage.stage_no,
            signature_hash: sig,
            comment: `[Từ chối tại Bước ${currentStage.stage_no}]: ${comment}`,
            created_at: nowVNDateTime(),
          });
          const upd = await client.query(
            `UPDATE portal_approval_requests
                SET status = 'REJECTED',
                    approval_stages = $2::jsonb,
                    comments_log = $3::jsonb,
                    completed_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = $1 RETURNING *`,
            [row.id, JSON.stringify(stages), JSON.stringify(logs)]
          );
          await logAudit("REJECT_APPROVAL", "APPROVALS", `Từ chối tờ trình ${row.request_code} tại bước ${currentStage.stage_no}: ${comment}`);
          return NextResponse.json({ ok: true, request: upd.rows[0] });
        }

        // 2f. Phê duyệt bước hiện tại (APPROVE) & Tự động chuyển sang cấp kế tiếp
        if (action === "approve") {
          const sig = buildSignatureHash(me.username, row.request_code, currentStage.stage_no, "APPROVE");
          stages[currentIdx] = {
            ...currentStage,
            status: "APPROVED",
            acted_by: actorName,
            acted_at: nowVNDateTime(),
            comment: comment || "Đồng ý phê duyệt.",
            signature_hash: sig,
          };

          // Tìm bước bắt buộc tiếp theo chưa duyệt
          const nextStageIdx = stages.findIndex(
            (s, idx) => idx > currentIdx && s.is_required !== false && s.status !== "SKIPPED"
          );

          let nextStatus = "APPROVED";
          let nextStageNo = currentStage.stage_no;
          let completedAtSql = "CURRENT_TIMESTAMP";

          if (nextStageIdx !== -1) {
            stages[nextStageIdx] = {
              ...stages[nextStageIdx],
              status: "PENDING",
            };
            nextStageNo = stages[nextStageIdx].stage_no;
            nextStatus = "IN_REVIEW";
            completedAtSql = "NULL";
          }

          logs.push({
            id: `LOG-${Date.now()}`,
            actor_name: actorName,
            actor_dept: me.department || "",
            action: "APPROVE",
            stage_no: currentStage.stage_no,
            signature_hash: sig,
            comment:
              nextStatus === "APPROVED"
                ? `[Phê duyệt hoàn tất Bước ${currentStage.stage_no} — Mã ký số ${sig}]: ${comment || "Đồng ý phê duyệt ban hành."}`
                : `[Đồng ý Bước ${currentStage.stage_no} (${sig}) ➔ Chuyển sang Bước ${nextStageNo}]: ${comment || "Đồng ý chuyển cấp tiếp theo."}`,
            created_at: nowVNDateTime(),
          });

          const upd = await client.query(
            `UPDATE portal_approval_requests
                SET status = $2,
                    current_stage_no = $3,
                    approval_stages = $4::jsonb,
                    comments_log = $5::jsonb,
                    completed_at = ${completedAtSql},
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = $1 RETURNING *`,
            [row.id, nextStatus, nextStageNo, JSON.stringify(stages), JSON.stringify(logs)]
          );
          await logAudit(
            "APPROVE_STEP",
            "APPROVALS",
            `Duyệt Bước ${currentStage.stage_no} tờ trình ${row.request_code} (Trạng thái mới: ${nextStatus})`
          );
          return NextResponse.json({ ok: true, request: upd.rows[0] });
        }
      }

      // =========================================================================
      // 3. CẤU HÌNH HẠN MỨC & SLA MẪU ĐỀ XUẤT (DÀNH CHO BAN GIÁM ĐỐC / ADMIN)
      // =========================================================================
      if (action === "update_template_config") {
        if (!isDirectorOrAdmin(me)) {
          throw new HttpError(403, "Chỉ Ban Giám Đốc hoặc Quản trị viên mới được phép thay đổi hạn mức phê duyệt của mẫu đề xuất.");
        }
        const code = String(body.code || "").trim();
        const slaHours = Math.max(2, Number(body.sla_hours || 24));
        const bodThreshold =
          body.bod_threshold_amount === null || body.bod_threshold_amount === ""
            ? null
            : Math.max(0, Number(body.bod_threshold_amount));

        const upd = await client.query(
          `UPDATE portal_approval_templates
              SET sla_hours = $2,
                  bod_threshold_amount = $3,
                  updated_at = CURRENT_TIMESTAMP
            WHERE code = $1 RETURNING *`,
          [code, slaHours, bodThreshold]
        );
        if (!upd.rows[0]) throw new HttpError(404, "Không tìm thấy mẫu đề xuất.");
        await logAudit("UPDATE_APPROVAL_TEMPLATE", "APPROVALS", `Cập nhật cấu hình mẫu ${code}: SLA=${slaHours}h, Ngưỡng BGD=${bodThreshold}`);
        return NextResponse.json({ ok: true, template: upd.rows[0] });
      }

      // =========================================================================
      // 4. TẠO MỚI HOẶC CẬP NHẬT TOÀN DIỆN MẪU TỜ TRÌNH & LUỒNG DUYỆT (TEMPLATE BUILDER)
      // =========================================================================
      if (action === "save_template") {
        if (!isDeptManager(me) && !isDirectorOrAdmin(me)) {
          throw new HttpError(403, "Chỉ cấp Quản lý / Trưởng bộ phận hoặc Ban Giám Đốc mới được phép thiết kế mẫu phê duyệt.");
        }
        const rawCode = String(body.code || "")
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9_]/g, "_");
        const name = String(body.name || "").trim();
        if (!rawCode || !name) {
          throw new HttpError(400, "Vui lòng nhập đầy đủ Mã mẫu và Tên mẫu tờ trình phê duyệt.");
        }
        const category = String(body.category || "GENERAL").trim().toUpperCase();
        const icon = String(body.icon || "FileText").trim();
        const description = String(body.description || "").trim();
        const slaHours = Math.max(1, Number(body.sla_hours || 24));
        const bodThreshold =
          body.bod_threshold_amount === null || body.bod_threshold_amount === "" || body.bod_threshold_amount === undefined
            ? null
            : Math.max(0, Number(body.bod_threshold_amount));
        const hasLineItems = Boolean(body.has_line_items);
        const fieldsSchema = Array.isArray(body.fields_schema) ? body.fields_schema : [];
        const rawStages = Array.isArray(body.default_stages) ? body.default_stages : [];
        if (rawStages.length === 0) {
          throw new HttpError(400, "Mẫu phê duyệt phải có ít nhất 1 cấp phê duyệt.");
        }
        const normalizedStages = rawStages.map((s: any, idx: number) => ({
          stage_no: idx + 1,
          stage_name: String(s.stage_name || `Phê duyệt Cấp ${idx + 1}`).trim(),
          role_type:
            s.dept === "REQUESTER_DEPT"
              ? "DEPT_HEAD"
              : s.dept === "Ban Giám Đốc"
                ? "BOD"
                : String(s.role_type || "SPECIALIST_DEPT"),
          dept: String(s.dept || "REQUESTER_DEPT").trim(),
          conditional_on_threshold: Boolean(s.conditional_on_threshold),
        }));

        const saved = await client.query(
          `INSERT INTO portal_approval_templates
             (code, name, category, icon, description, sla_hours, bod_threshold_amount, has_line_items, fields_schema, default_stages, is_active, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, TRUE, CURRENT_TIMESTAMP)
           ON CONFLICT (code) DO UPDATE SET
             name = EXCLUDED.name,
             category = EXCLUDED.category,
             icon = EXCLUDED.icon,
             description = EXCLUDED.description,
             sla_hours = EXCLUDED.sla_hours,
             bod_threshold_amount = EXCLUDED.bod_threshold_amount,
             has_line_items = EXCLUDED.has_line_items,
             fields_schema = EXCLUDED.fields_schema,
             default_stages = EXCLUDED.default_stages,
             is_active = TRUE,
             updated_at = CURRENT_TIMESTAMP
           RETURNING *`,
          [
            rawCode,
            name,
            category,
            icon,
            description,
            slaHours,
            bodThreshold,
            hasLineItems,
            JSON.stringify(fieldsSchema),
            JSON.stringify(normalizedStages),
          ]
        );
        await logAudit("SAVE_APPROVAL_TEMPLATE", "APPROVALS", `Lưu thiết kế mẫu phê duyệt ${rawCode}: ${name}`);
        return NextResponse.json({ ok: true, template: saved.rows[0] });
      }

      if (action === "delete_template") {
        if (!isDirectorOrAdmin(me)) {
          throw new HttpError(403, "Chỉ Ban Giám Đốc hoặc Quản trị viên mới được phép xóa/ẩn mẫu phê duyệt.");
        }
        const code = String(body.code || "").trim();
        await client.query(
          `UPDATE portal_approval_templates SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE code = $1`,
          [code]
        );
        await logAudit("DELETE_APPROVAL_TEMPLATE", "APPROVALS", `Ẩn mẫu phê duyệt ${code}`);
        return NextResponse.json({ ok: true });
      }

      throw new HttpError(400, `Hành động không hợp lệ: "${action}"`);
    });
  } catch (error: any) {
    console.error("[POST /api/approvals] error:", error);
    return NextResponse.json(
      { error: error?.message || "Lỗi xử lý yêu cầu Đề xuất & Phê duyệt" },
      { status: httpErrorStatus(error) }
    );
  }
}

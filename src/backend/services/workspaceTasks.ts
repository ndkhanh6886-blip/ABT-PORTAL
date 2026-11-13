/**
 * Quy tắc dùng chung (giao diện + máy chủ) cho "Công việc" trong Workspace:
 * phòng ban, phân loại, trạng thái, đối tượng liên quan và quyền sửa / xóa.
 */

/** Phòng ban của ABT dùng khi tạo công việc & điều hành chuyên môn (id giữ nguyên giá trị cũ để dữ liệu cũ vẫn khớp) */
export const WORKSPACE_TASK_DEPARTMENTS: { id: string; label: string }[] = [
  { id: "Ban Giám Đốc", label: "Ban Giám Đốc" },
  { id: "Nghiên Cứu R&D", label: "Nghiên Cứu & Phát Triển (R&D)" },
  { id: "Sản Xuất Kit", label: "Sản Xuất Kit Sinh Học Phân Tử" },
  { id: "Tổng Hợp Oligo", label: "Tổng Hợp & Tinh Sạch Oligo" },
  { id: "Kỹ Thuật – Thiết Bị", label: "Kỹ Thuật – Công Nghệ Thiết Bị" },
  { id: "QA/QC", label: "Đảm Bảo & Kiểm Soát Chất Lượng (QA/QC)" },
  { id: "Application", label: "Application (Kỹ Thuật & Ứng Dụng)" },
  { id: "Kinh Doanh", label: "Kinh Doanh (Sales)" },
  { id: "Sales Admin", label: "Sales Admin" },
  { id: "PM", label: "Quản Lý Sản Phẩm (PM)" },
  { id: "Marketing", label: "Marketing & Tiếp Thị" },
  { id: "Kho & Vận Hành", label: "Kho & Vận Hành (Warehouse & Logistics)" },
  { id: "Cung Ứng", label: "Mua Hàng & Cung Ứng (Procurement)" },
  { id: "Kế Toán", label: "Tài Chính – Kế Toán" },
  { id: "Pháp Chế", label: "Pháp Chế & Tuân Thủ (Legal)" },
  { id: "Hành Chính Nhân Sự", label: "Hành Chính – Nhân Sự (HR)" },
  { id: "Lab", label: "Phòng Lab" },
];

/** Chuẩn hóa tên phòng ban về id ở trên (tên trong Nhân sự có thể khác: "Kỹ Thuật & Ứng Dụng", "Mua Hàng & Cung Ứng"...) */
export function normalizeWorkspaceDept(raw: any): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s === "all") return "all";
  const l = s.toLowerCase();
  // các phòng riêng phải xét trước các nhóm rộng (Sales Admin trước Kinh Doanh, Lab trước Application)
  if (l.includes("sales admin")) return "Sales Admin";
  if (l.includes("r&d") || l.includes("nghiên cứu")) return "Nghiên Cứu R&D";
  if (l.includes("sản xuất kit") || l.includes("sx kit") || l === "p-kit") return "Sản Xuất Kit";
  if (l.includes("oligo") || l === "p-oligo") return "Tổng Hợp Oligo";
  if (l.includes("thiết bị") || l.includes("công nghệ") || l === "p-tb") return "Kỹ Thuật – Thiết Bị";
  if (l.includes("qa") || l.includes("qc") || l.includes("chất lượng")) return "QA/QC";
  if (l === "pm" || l.includes("product manager") || l.includes("quản lý sản phẩm")) return "PM";
  if (l.includes("marketing") || l.includes("tiếp thị")) return "Marketing";
  if (l === "lab" || /(^|[\s(])lab($|[\s)])/.test(l) || l.includes("phòng lab")) return "Lab";
  if (l.includes("ứng dụng") || l.includes("application") || l.includes("kỹ thuật") || l === "app") return "Application";
  if (l.includes("kho") || l.includes("vận hành") || l.includes("warehouse") || l.includes("giao nhận")) return "Kho & Vận Hành";
  if (l.includes("cung ứng") || l.includes("mua hàng") || l.includes("procurement")) return "Cung Ứng";
  if (l.includes("kinh doanh") || l.includes("sales")) return "Kinh Doanh";
  if (l.includes("pháp chế") || l.includes("legal") || l.includes("tuân thủ")) return "Pháp Chế";
  if (l.includes("kế toán") || l.includes("tài chính") || l.includes("accounting")) return "Kế Toán";
  if (l.includes("nhân sự") || l.includes("hành chính") || l === "hr") return "Hành Chính Nhân Sự";
  if (l.includes("giám đốc") || l.includes("bod")) return "Ban Giám Đốc";
  return s;
}

export function isSameWorkspaceDept(a: any, b: any): boolean {
  const splitDepts = (raw: any): string[] =>
    String(raw || "")
      .split(/[,;\n]+/)
      .map((d) => normalizeWorkspaceDept(d.trim()))
      .filter(Boolean);
  const listA = splitDepts(a);
  const listB = splitDepts(b);
  if (listA.length === 0 || listB.length === 0) return false;
  if (listA.includes("all") || listB.includes("all")) return true;
  return listA.some((da) => listB.some((db) => da.toLowerCase() === db.toLowerCase()));
}

/**
 * Tên nhân sự để so sánh: cùng một tên có thể được lưu ở dạng Unicode tổ hợp / dựng sẵn khác nhau, hoặc đặt dấu
 * kiểu cũ / mới ("Thùy" - "Thuỳ", "Hòa" - "Hoà"), có khoảng trắng thừa.
 */
export function canonStaffName(name: any): string {
  let s = String(name || "").normalize("NFC").toLowerCase().replace(/[\s \u200b]+/g, " ").trim();
  // đặt dấu kiểu mới (dấu trên chữ thứ hai của oa, oe, uy) -> kiểu cũ, để hai cách gõ trùng nhau
  s = s.normalize("NFD").replace(/([ou])([\u0300\u0301\u0303\u0309\u0323])([aey])/g, "$1$3$2").normalize("NFC");
  return s;
}

/** Hai tên là cùng một người (so sánh sau chuẩn hóa; tên đầy đủ chứa tên ngắn vẫn tính là trùng). */
export function sameStaffName(a: any, b: any): boolean {
  const x = canonStaffName(a);
  const y = canonStaffName(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/** Khóa lưu danh mục phân loại công việc (Quản trị viên sửa được) */
export const TASK_CATEGORY_STORAGE_KEY = "workspace_task_categories";

/** Danh mục phân loại mặc định (theo "Danh sách nội dung tạo công việc", đã gộp mục trùng "Demo" / "Demo sản phẩm") */
export const DEFAULT_TASK_CATEGORIES: string[] = [
  "Đang lên lịch hẹn",
  "Nghỉ phép",
  "Meeting",
  "Chào mẫu",
  "Than phiền",
  "Phản hồi khách hàng",
  "Thông tin đối thủ",
  "Xử lý yêu cầu",
  "CS bằng email",
  "CS bằng điện thoại",
  "Xử lý lỗi",
  "Giao nhận giấy tờ",
  "Thu tiền",
  "Nhắc thanh toán",
  "Đặt hàng",
  "Kiểm kê hàng tồn",
  "Viếng thăm khách hàng",
  "Bảo hành / Bảo trì",
  "Lịch công tác",
  "Xuất hóa đơn",
  "Giao việc",
  "Xét duyệt",
  "Chào hàng chuyên môn",
  "Demo sản phẩm",
  "Đánh giá thử nghiệm",
  "Đề xuất kết hợp nghiên cứu KH",
  "Chào hàng BGĐ",
  "Chào hàng P. Vật tư / Dược",
  "Thảo luận mua bán",
  "Thảo luận chuyên môn",
  "Bảo lãnh hồ sơ thầu",
  "Bàn giao - Nghiệm thu sản phẩm",
  "Xử lý sự cố",
  "Tư vấn chuyên môn",
  "Training quy trình",
  "Hội thảo",
  "Lịch họp quản lý",
  "Giao ban tháng",
  "Check hợp đồng Nhà Cung Cấp",
  "Check hợp đồng Khách Hàng",
  "Check hợp đồng Thầu",
  "Khác",
];

/** Trạng thái công việc ("Cần làm" đổi tên thành "Kế hoạch"; thêm "Hủy bỏ") */
export const TASK_STATUSES: { id: string; label: string }[] = [
  { id: "TODO", label: "Kế hoạch" },
  { id: "IN_PROGRESS", label: "Đang làm" },
  { id: "DONE", label: "Hoàn tất" },
  { id: "CANCELLED", label: "Hủy bỏ" },
];
export const taskStatusLabel = (status: any): string =>
  TASK_STATUSES.find(s => s.id === String(status || "").toUpperCase())?.label || "Kế hoạch";

/** Loại đối tượng "Liên quan tới" */
export const TASK_RELATED_TYPES: { id: string; label: string }[] = [
  { id: "CUSTOMER", label: "Khách hàng" },
  { id: "EMPLOYEE", label: "Nhân viên" },
  { id: "ORDER", label: "Đơn hàng" },
  { id: "CONTACT", label: "Người liên hệ" },
  { id: "LEAD", label: "Đầu mối (Cơ hội bán hàng)" },
  { id: "PROJECT", label: "Dự án" },
];
export const TASK_RELATED_TYPE_IDS = new Set(TASK_RELATED_TYPES.map(t => t.id));

export type TaskActor = { username?: string; full_name?: string; role?: string; department?: string; isAdmin?: boolean };
export type TaskRecord = { department?: string; assignee_name?: string; created_by?: string | null; created_by_name?: string | null };

/** Trưởng / Phó phòng theo vai trò hệ thống (sales_head, app_head, warehouse_lead, accountant_head...) */
export function isDeptManagerRole(role: any): boolean {
  const r = String(role || "").toLowerCase();
  return r.includes("head") || r.includes("lead") || r.includes("manager") || r.includes("trưởng phòng") || r.includes("phó phòng");
}

/**
 * Quyền trên một công việc:
 * - "full": sửa mọi nội dung, đổi người phụ trách, xóa — người tạo, Trưởng / Phó phòng của phòng đó, BGĐ / Quản trị viên
 * - "progress": chỉ cập nhật tiến độ (trạng thái, báo cáo kết quả, đính kèm, trao đổi) — người được giao
 * - "view": chỉ xem
 * Công việc cũ chưa ghi người tạo: chỉ Trưởng phòng / BGĐ / Quản trị viên được sửa toàn bộ.
 */
export function getTaskAccess(actor: TaskActor, task: TaskRecord | null | undefined): "full" | "progress" | "view" {
  if (!task) return "full"; // tạo mới
  if (actor.isAdmin) return "full";
  const creator = String(task.created_by || "").trim().toLowerCase();
  if (creator && actor.username && creator === String(actor.username).trim().toLowerCase()) return "full";
  if (!creator && task.created_by_name && sameStaffName(task.created_by_name, actor.full_name)) return "full";
  if (isDeptManagerRole(actor.role) && isSameWorkspaceDept(actor.department, task.department)) return "full";
  const assignees = String(task.assignee_name || "").split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
  if (actor.full_name && assignees.some(a => sameStaffName(a, actor.full_name))) return "progress";
  return "view";
}

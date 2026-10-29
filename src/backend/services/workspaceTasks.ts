/**
 * Quy tắc dùng chung (giao diện + máy chủ) cho "Công việc" trong Workspace:
 * phòng ban, phân loại, trạng thái, đối tượng liên quan và quyền sửa / xóa.
 */

/** 10 phòng ban của ABT dùng khi tạo công việc (id giữ nguyên giá trị cũ để dữ liệu cũ vẫn khớp) */
export const WORKSPACE_TASK_DEPARTMENTS: { id: string; label: string }[] = [
  { id: "Ban Giám Đốc", label: "Ban Giám Đốc" },
  { id: "Kế Toán", label: "Kế Toán" },
  { id: "Sales Admin", label: "Sales Admin" },
  { id: "PM", label: "PM" },
  { id: "Application", label: "App (Kỹ Thuật & Ứng Dụng)" },
  { id: "Cung Ứng", label: "Mua Hàng & Cung Ứng" },
  { id: "Kinh Doanh", label: "Kinh Doanh" },
  { id: "Lab", label: "Lab" },
  { id: "Marketing", label: "Marketing" },
  { id: "Pháp Chế", label: "Pháp Chế" },
];

/** Chuẩn hóa tên phòng ban về id ở trên (tên trong Nhân sự có thể khác: "Kỹ Thuật & Ứng Dụng", "Mua Hàng & Cung Ứng"...) */
export function normalizeWorkspaceDept(raw: any): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s === "all") return "all";
  const l = s.toLowerCase();
  // các phòng riêng phải xét trước các nhóm rộng (Sales Admin trước Kinh Doanh, Lab trước Application)
  if (l.includes("sales admin")) return "Sales Admin";
  if (l === "pm" || l.includes("product manager") || l.includes("quản lý sản phẩm")) return "PM";
  if (l.includes("marketing")) return "Marketing";
  if (l === "lab" || /(^|[\s(])lab($|[\s)])/.test(l) || l.includes("phòng lab")) return "Lab";
  if (l.includes("ứng dụng") || l.includes("application") || l.includes("kỹ thuật") || l === "app") return "Application";
  if (l.includes("kho") || l.includes("vận hành") || l.includes("warehouse") || l.includes("giao nhận")) return "Kho & Vận Hành";
  if (l.includes("cung ứng") || l.includes("mua hàng") || l.includes("procurement")) return "Cung Ứng";
  if (l.includes("kinh doanh") || l.includes("sales")) return "Kinh Doanh";
  if (l.includes("pháp chế") || l.includes("legal") || l.includes("qa") || l.includes("qc") || l.includes("chất lượng")) return "Pháp Chế";
  if (l.includes("kế toán") || l.includes("tài chính") || l.includes("accounting")) return "Kế Toán";
  if (l.includes("giám đốc") || l.includes("bod")) return "Ban Giám Đốc";
  return s;
}

export function isSameWorkspaceDept(a: any, b: any): boolean {
  const na = normalizeWorkspaceDept(a);
  const nb = normalizeWorkspaceDept(b);
  if (!na || !nb) return false;
  if (na === "all" || nb === "all") return true;
  return na.toLowerCase() === nb.toLowerCase();
}

/**
 * Tên nhân sự để so sánh: cùng một tên có thể được lưu ở dạng Unicode tổ hợp / dựng sẵn khác nhau, hoặc đặt dấu
 * kiểu cũ / mới ("Thùy" - "Thuỳ", "Hòa" - "Hoà"), có khoảng trắng thừa.
 */
export function canonStaffName(name: any): string {
  let s = String(name || "").normalize("NFC").toLowerCase().replace(/[\s ​]+/g, " ").trim();
  // đặt dấu kiểu mới (dấu trên chữ thứ hai của oa, oe, uy) -> kiểu cũ, để hai cách gõ trùng nhau
  s = s.normalize("NFD").replace(/([ou])([̣̀́̉̃])([aey])/g, "$1$3$2").normalize("NFC");
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

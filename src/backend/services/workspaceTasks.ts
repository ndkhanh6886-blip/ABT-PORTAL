/**
 * Quy tắc dùng chung (giao diện + máy chủ) cho "Công việc" trong Workspace:
 * phòng ban, phân loại, trạng thái, đối tượng liên quan và quyền sửa / xóa.
 */

/** Phòng ban của ABT dùng khi tạo công việc & điều hành chuyên môn toàn công ty (Khối Kinh Doanh & Khối Kỹ Thuật – Nhà Máy) */
export const WORKSPACE_TASK_DEPARTMENTS: { id: string; label: string; block?: "EXECUTIVE" | "COMMERCIAL" | "TECHNICAL" }[] = [
  // Ban Giám Đốc & Quản Trị Chung
  { id: "Ban Giám Đốc", label: "Ban Giám Đốc (BOD)", block: "EXECUTIVE" },
  // Khối Kinh Doanh & Văn Phòng
  { id: "Kinh Doanh", label: "Kinh Doanh (Sales)", block: "COMMERCIAL" },
  { id: "Sales Admin", label: "Sales Admin", block: "COMMERCIAL" },
  { id: "Application", label: "Application (Lab Ứng Dụng KD)", block: "COMMERCIAL" },
  { id: "Kho & Vận Hành", label: "Kho Kinh Doanh & Vận Hành (Thương Mại)", block: "COMMERCIAL" },
  { id: "Cung Ứng", label: "Cung Ứng Kinh Doanh (Mua Hàng TM & XNK)", block: "COMMERCIAL" },
  { id: "PM", label: "Quản Lý Sản Phẩm (PM)", block: "COMMERCIAL" },
  { id: "Marketing", label: "Marketing & Tiếp Thị", block: "COMMERCIAL" },
  { id: "Kế Toán", label: "Tài Chính – Kế Toán", block: "COMMERCIAL" },
  { id: "Pháp Chế", label: "Pháp Chế & Tuân Thủ (Legal)", block: "COMMERCIAL" },
  { id: "Hành Chính Nhân Sự", label: "Hành Chính – Nhân Sự (HR)", block: "COMMERCIAL" },
  { id: "Lab", label: "Phòng Lab (Thử nghiệm KD)", block: "COMMERCIAL" },
  // Khối Kỹ Thuật – Nhà Máy
  { id: "Đơn Nội Bộ", label: "Điều Phối Đơn Nội Bộ (KD ↔ Nhà Máy)", block: "TECHNICAL" },
  { id: "Nghiên Cứu R&D", label: "Nghiên Cứu & Phát Triển (R&D)", block: "TECHNICAL" },
  { id: "Sản Xuất Kit", label: "Sản Xuất Kit Sinh Học Phân Tử", block: "TECHNICAL" },
  { id: "Tổng Hợp Oligo", label: "Tổng Hợp & Tinh Sạch Oligo", block: "TECHNICAL" },
  { id: "Kỹ Thuật – Thiết Bị", label: "Kỹ Thuật – Công Nghệ Thiết Bị", block: "TECHNICAL" },
  { id: "QA/QC", label: "Đảm Bảo & Kiểm Soát Chất Lượng (QA/QC)", block: "TECHNICAL" },
  { id: "Kho Nhà Máy", label: "Kho Nhà Máy (Vật Tư, Hóa Chất & Thành Phẩm SX)", block: "TECHNICAL" },
  { id: "Cung Ứng Kỹ Thuật", label: "Cung Ứng Kỹ Thuật (Mua Sắm NVL/Hóa Chất Nhà Máy)", block: "TECHNICAL" },
];

/** Chuẩn hóa tên phòng ban về id ở trên, phân biệt rõ Kho/Cung ứng của Khối Kinh Doanh và Khối Kỹ Thuật – Nhà Máy */
export function normalizeWorkspaceDept(raw: any): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s === "all") return "all";
  const l = s.toLowerCase();
  // 1. Phân biệt rõ Kho Nhà Máy và Cung Ứng Kỹ Thuật (xét trước Kho & Cung ứng chung)
  if (
    l.includes("kho nhà máy") ||
    l.includes("kho kỹ thuật") ||
    l.includes("kho tổng nhà máy") ||
    l.includes("kho vật tư") ||
    l.includes("kho hóa chất") ||
    l === "p-wh" ||
    l === "factory_warehouse"
  ) {
    return "Kho Nhà Máy";
  }
  if (
    l.includes("cung ứng kỹ thuật") ||
    l.includes("cung ứng nhà máy") ||
    l.includes("cung ứng nvl") ||
    l.includes("mua hàng nhà máy") ||
    l.includes("mua hàng kỹ thuật") ||
    l.includes("mua sắm nvl") ||
    l === "p-pur" ||
    l === "factory_procurement"
  ) {
    return "Cung Ứng Kỹ Thuật";
  }
  // 2. Các phòng ban thuộc Khối Kỹ Thuật – Nhà Máy
  if (l.includes("đơn nội bộ") || l.includes("điều phối sản xuất") || l.includes("điều phối đơn")) return "Đơn Nội Bộ";
  if (l.includes("r&d") || l.includes("nghiên cứu") || l === "p-rd") return "Nghiên Cứu R&D";
  if (l.includes("sản xuất kit") || l.includes("sx kit") || l === "p-kit") return "Sản Xuất Kit";
  if (l.includes("oligo") || l === "p-oligo") return "Tổng Hợp Oligo";
  if (l.includes("thiết bị") || l.includes("cơ điện") || l === "p-tb") return "Kỹ Thuật – Thiết Bị";
  if (l.includes("qa") || l.includes("qc") || l.includes("chất lượng") || l === "p-qaqc") return "QA/QC";
  // 3. Các phòng ban thuộc Khối Kinh Doanh & Văn Phòng
  if (l.includes("sales admin")) return "Sales Admin";
  if (l === "pm" || l.includes("product manager") || l.includes("quản lý sản phẩm")) return "PM";
  if (l.includes("marketing") || l.includes("tiếp thị")) return "Marketing";
  if (l === "lab" || /(^|[\s(])lab($|[\s)])/.test(l) || l.includes("phòng lab")) {
    if (!l.includes("application") && !l.includes("ứng dụng")) return "Lab";
  }
  if (l.includes("ứng dụng") || l.includes("application") || l === "app") return "Application";
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
  "Thiết kế mồi/probe & Thực nghiệm R&D",
  "Chuyển giao công nghệ (Tech Transfer)",
  "Pha chế & Sản xuất lô Kit (eBR)",
  "Tổng hợp & Tinh sạch Oligo",
  "Lắp ráp, Hiệu chuẩn & Bảo trì Thiết bị",
  "Kiểm định IQC / IPQC / FQC & Cấp COA",
  "Xử lý NCR / OOS / CAPA (ISO 13485)",
  "Cấp phát NVL/Hóa chất theo FEFO (Kho Nhà máy)",
  "Mua sắm NVL, Hóa chất & Linh kiện SX (Cung ứng KT)",
  "Điều phối Đơn đặt hàng nội bộ (KD ↔ Nhà máy)",
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
  { id: "CUSTOMER", label: "Khách hàng / Viện / Bệnh viện" },
  { id: "EMPLOYEE", label: "Nhân viên" },
  { id: "ORDER", label: "Đơn hàng Kinh doanh (SO / PO KD)" },
  { id: "INTERNAL_ORDER", label: "Đơn đặt hàng Nội bộ (KD → Nhà máy)" },
  { id: "PRODUCTION_BATCH", label: "Lô sản xuất Kit / Mẻ tổng hợp Oligo / Lô NVL" },
  { id: "RND_PROJECT", label: "Đề tài R&D / Thiết bị / Hồ sơ QA-QC" },
  { id: "CONTACT", label: "Người liên hệ" },
  { id: "LEAD", label: "Đầu mối (Cơ hội bán hàng)" },
  { id: "PROJECT", label: "Dự án liên phòng ban" },
];
export const TASK_RELATED_TYPE_IDS = new Set(TASK_RELATED_TYPES.map(t => t.id));

export type TaskActor = { username?: string; full_name?: string; role?: string; department?: string; isAdmin?: boolean };
export type TaskRecord = { department?: string; assignee_name?: string; created_by?: string | null; created_by_name?: string | null };

/** Trưởng / Phó phòng theo vai trò hệ thống (sales_head, app_head, warehouse_lead, rd_head, kit_head, oligo_head, device_head, qa_manager, factory_wh_lead, factory_proc_lead...) */
export function isDeptManagerRole(role: any): boolean {
  const r = String(role || "").toLowerCase();
  return (
    r.includes("head") ||
    r.includes("lead") ||
    r.includes("manager") ||
    r.includes("trưởng phòng") ||
    r.includes("phó phòng") ||
    r.includes("quản đốc") ||
    r.includes("giám đốc chất lượng") ||
    r.includes("chủ nhiệm")
  );
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

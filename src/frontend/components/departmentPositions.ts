import { canonicalDepartment, COMPANY_BLOCKS, COMPANY_DEPARTMENTS } from "@/backend/services/permissions";

export const ABT_ORG_SCHEMA_VERSION = 3;

export type PositionLevel = "Director" | "Manager" | "Specialist" | "Staff";

export interface DepartmentPositionItem {
  title: string;
  defaultRole: string;
  level: PositionLevel;
  desc: string;
}

export interface DepartmentPositionGroup {
  name: string;
  code: string;
  desc: string;
  badgeColor: string;
  borderTheme: string;
  positions: DepartmentPositionItem[];
}

export const DEPARTMENT_POSITIONS: Record<string, DepartmentPositionGroup> = {
  // 11 phòng ban và vị trí thực tế theo danh sách nhân sự toàn công ty ABT; khóa = tên phòng trong hồ sơ nhân sự
  "Ban Giám Đốc": {
    name: "Ban Giám Đốc (Board of Directors)",
    code: "BOD",
    desc: "Hoạch định chiến lược, điều hành toàn công ty; Phó Giám đốc phụ trách khối Kinh doanh và khối Kỹ thuật",
    badgeColor: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/50 dark:text-orange-400 dark:border-orange-800",
    borderTheme: "border-orange-500",
    positions: [
      { title: "Giám đốc", defaultRole: "admin", level: "Director", desc: "Chịu trách nhiệm cao nhất về kết quả kinh doanh, phê duyệt chiến lược và ngân sách" },
      { title: "Phó Giám đốc Kinh doanh", defaultRole: "admin", level: "Director", desc: "Phụ trách khối Kinh doanh: Kinh doanh, Marketing, APP, Kho & Cung ứng Kinh doanh" },
      { title: "Phó Giám đốc Kỹ Thuật", defaultRole: "admin", level: "Director", desc: "Phụ trách khối Kỹ thuật – Nhà máy: R&D, Sản xuất, Tổng hợp Oligo, KTCN, QC/QA, Cung ứng Kho Nhà máy (P-KHO)" },
      { title: "Cố vấn cấp cao", defaultRole: "admin", level: "Director", desc: "Cố vấn chiến lược và chuyên môn cho Ban Giám Đốc; quyền quản trị như Ban Giám Đốc" }
    ]
  },
  "Hành chính": {
    name: "Phòng Hành Chính (Hành chánh – Nhân sự – Kế toán – Pháp chế)",
    code: "HC",
    desc: "Hành chánh văn phòng, hành chánh – nhân sự, kế toán – hóa đơn VAT – công nợ, pháp chế hợp đồng & hồ sơ lưu hành",
    badgeColor: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-400 dark:border-rose-800",
    borderTheme: "border-rose-500",
    positions: [
      { title: "Trưởng phòng Hành chính", defaultRole: "admin_head", level: "Manager", desc: "Điều hành Phòng Hành chính (Hành chánh – Nhân sự – Kế toán – Pháp chế), phê duyệt đề xuất và công nợ" },
      { title: "Phó Trưởng phòng Hành chính", defaultRole: "admin_head", level: "Manager", desc: "Phụ trách chuyên môn Pháp chế / Hành chánh – Nhân sự; thay Trưởng phòng điều hành khi vắng" },
      { title: "Kế toán trưởng", defaultRole: "accountant_head", level: "Manager", desc: "Điều hành công tác kế toán, phê duyệt công nợ vượt hạn mức, ngân sách PO và báo cáo tài chính" },
      { title: "Trưởng bộ phận Pháp chế", defaultRole: "legal_head", level: "Manager", desc: "Phụ trách thẩm định pháp lý hợp đồng, hồ sơ công bố lưu hành IVD và hồ sơ thầu" },
      { title: "Nhân viên Hành chánh", defaultRole: "admin_staff", level: "Staff", desc: "Công tác hành chánh văn phòng, văn thư lưu trữ, quản lý VPP – tài sản văn phòng và điều phối hậu cần" },
      { title: "Nhân viên Hành chánh-Nhân sự", defaultRole: "hr_admin", level: "Staff", desc: "Quản lý hồ sơ nhân sự, chấm công – nghỉ phép, tuyển dụng, chế độ BHXH và công tác hành chánh nội bộ" },
      { title: "Nhân viên Pháp chế", defaultRole: "legal", level: "Staff", desc: "Soạn thảo & rà soát hợp đồng, hồ sơ pháp lý, hồ sơ công bố lưu hành thiết bị y tế IVD và hồ sơ thầu" },
      { title: "Nhân viên Kế toán", defaultRole: "accountant", level: "Staff", desc: "Hạch toán, xuất hóa đơn VAT, đối soát kho và theo dõi công nợ" }
    ]
  },
  "Kinh Doanh": {
    name: "Phòng Kinh Doanh (Sales – Kho & Cung Ứng KD)",
    code: "SALES",
    desc: "Khối Kinh Doanh: bán hàng bệnh viện, phòng khám, CDC; quản lý sản phẩm; Sales Admin phụ trách Kho Kinh Doanh & Cung Ứng Kinh Doanh (tách biệt với Kho Nhà Máy P-KHO)",
    badgeColor: "bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-400 dark:border-indigo-800",
    borderTheme: "border-indigo-500",
    positions: [
      { title: "Trưởng phòng Kinh doanh", defaultRole: "sales_head", level: "Manager", desc: "Quản lý đội kinh doanh, duyệt báo giá, chiết khấu, hợp đồng" },
      { title: "Phó Trưởng phòng Kinh doanh", defaultRole: "sales_head", level: "Manager", desc: "Điều hành đội kinh doanh, duyệt báo giá và đơn hàng" },
      { title: "Quản lý sản phẩm", defaultRole: "sales_rep", level: "Specialist", desc: "Quản lý dòng sản phẩm, làm việc với hãng, đào tạo sản phẩm cho đội sales" },
      { title: "Trưởng nhóm Sales Admin", defaultRole: "sales_admin", level: "Specialist", desc: "Điều phối Sales Admin: đơn hàng, Kho Kinh Doanh và Cung Ứng Kinh Doanh, giao hàng, hóa đơn" },
      { title: "Nhân viên Sales Admin", defaultRole: "sales_admin", level: "Staff", desc: "Đơn hàng; Kho Kinh Doanh (nhập / xuất, lô & HSD hàng thương mại) và Cung Ứng Kinh Doanh (PR, PO, hàng về)" },
      { title: "Nhân viên Sales", defaultRole: "sales_rep", level: "Staff", desc: "Phát triển khách hàng, báo giá, theo dõi đơn hàng" },
      { title: "Nhân viên giao nhận", defaultRole: "warehouse", level: "Staff", desc: "Giao nhận hàng từ Kho Kinh Doanh, chuỗi lạnh, bàn giao chứng từ cho khách" },
      { title: "Nhân viên lái xe", defaultRole: "staff", level: "Staff", desc: "Vận chuyển hàng và nhân sự" }
    ]
  },
  "Marketing": {
    name: "Bộ Phận Marketing",
    code: "MKT",
    desc: "Truyền thông, hội thảo khoa học, tài liệu sản phẩm",
    badgeColor: "bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-950/50 dark:text-pink-400 dark:border-pink-800",
    borderTheme: "border-pink-500",
    positions: [
      { title: "Trưởng bộ phận Marketing", defaultRole: "sales_head", level: "Manager", desc: "Điều hành hoạt động Marketing, truyền thông thương hiệu và hội thảo khoa học" },
      { title: "Phó Trưởng bộ phận Marketing", defaultRole: "sales_head", level: "Manager", desc: "Phụ trách triển khai chiến dịch truyền thông, tài liệu sản phẩm; thay Trưởng bộ phận khi vắng" },
      { title: "Nhân viên Marketing", defaultRole: "marketing", level: "Staff", desc: "Nội dung số, brochure, hội thảo và truyền thông sản phẩm" }
    ]
  },
  "APP": {
    name: "Phòng Ứng Dụng (Application – APP)",
    code: "APP",
    desc: "Ứng dụng lâm sàng, demo & lắp đặt máy tại khách hàng, kỹ thuật thiết bị tại hiện trường",
    badgeColor: "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-400 dark:border-purple-800",
    borderTheme: "border-purple-500",
    positions: [
      { title: "Trưởng phòng Ứng dụng", defaultRole: "app_head", level: "Manager", desc: "Điều hành phòng Ứng dụng, phê duyệt kế hoạch demo/thẩm định và ký nghiệm thu kỹ thuật" },
      { title: "Phó Trưởng phòng Ứng dụng", defaultRole: "app_head", level: "Manager", desc: "Điều hành phòng, phân công kỹ sư, ký nghiệm thu kỹ thuật" },
      { title: "Trưởng nhóm Công nghiệp", defaultRole: "app_rep", level: "Specialist", desc: "Phụ trách nhóm khách hàng công nghiệp" },
      { title: "Nhân viên Ứng dụng", defaultRole: "app_rep", level: "Staff", desc: "Chạy mẫu, demo, hỗ trợ kỹ thuật tại phòng xét nghiệm" },
      { title: "Nhân viên Kỹ thuật thiết bị", defaultRole: "app_rep", level: "Staff", desc: "Lắp đặt, bảo trì, sửa chữa thiết bị tại khách hàng" }
    ]
  },
  "Cung ứng Kho": {
    name: "Phòng Cung Ứng – Kho Nhà Máy (P-KHO)",
    code: "P-KHO",
    desc: "Khối Kỹ Thuật – Nhà Máy: mua NVL/hóa chất sản xuất (Cung ứng Kỹ thuật) và Kho Nhà Máy (P-KHO) — NVL, bán thành phẩm, thành phẩm SX, lô / HSD FEFO, cấp phát cho các phòng sản xuất (tách biệt hoàn toàn với Kho Kinh Doanh & Cung Ứng Kinh Doanh). Quyền làm việc cấp qua Vai trò Nhà máy (WH_HEAD, WH_STAFF, PUR_HEAD, PUR_STAFF).",
    badgeColor: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800",
    borderTheme: "border-amber-500",
    positions: [
      { title: "Trưởng bộ phận Cung ứng Kho", defaultRole: "staff", level: "Manager", desc: "Duyệt cấp phát FEFO Kho Nhà máy, phiếu kho và đề nghị mua NVL nhà máy (vai trò nhà máy WH_HEAD / PUR_HEAD)" },
      { title: "Phó Trưởng bộ phận Cung ứng Kho", defaultRole: "staff", level: "Manager", desc: "Phụ trách điều phối Cung ứng Kỹ thuật & Kho Nhà máy; duyệt phiếu kho và đề nghị mua NVL khi Trưởng bộ phận ủy quyền" },
      { title: "Nhân viên Cung ứng Kho", defaultRole: "staff", level: "Specialist", desc: "Cung ứng Kỹ thuật: đề nghị mua PR, đơn PO NVL/hóa chất sản xuất, theo dõi hàng về, hồ sơ CO/CQ (vai trò nhà máy PUR_STAFF / WH_STAFF)" },
      { title: "Nhân viên Kho", defaultRole: "staff", level: "Staff", desc: "Kho Nhà Máy (P-KHO): nhập, xuất cấp phát NVL theo lô FEFO, thẻ kho, chuỗi lạnh sản xuất (WH_STAFF)" },
      { title: "Nhân viên Admin Kho", defaultRole: "staff", level: "Staff", desc: "Kho Nhà Máy (P-KHO): lập phiếu nhập / xuất / chuyển kho nhà máy, đối soát tồn kho (WH_STAFF)" }
    ]
  },
  "R&D": {
    name: "Phòng Nghiên Cứu & Phát Triển (R&D – P-RD)",
    code: "P-RD",
    desc: "Nghiên cứu phát triển Kit IVD, thiết kế mồi/probe, thẩm định, hồ sơ DHF và chuyển giao sản xuất",
    badgeColor: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-400 dark:border-sky-800",
    borderTheme: "border-sky-500",
    positions: [
      { title: "Trưởng phòng R&D", defaultRole: "rd_head", level: "Manager", desc: "Chỉ đạo đề tài, phê duyệt DHF, công thức và chuyển giao công nghệ" },
      { title: "Phó Trưởng phòng R&D", defaultRole: "rd_head", level: "Manager", desc: "Điều phối chuyên môn nghiên cứu, thẩm định DHF và thay Trưởng phòng phê duyệt khi vắng" },
      { title: "Nhân viên R&D", defaultRole: "rd_staff", level: "Staff", desc: "Thí nghiệm, nhật ký ELN, pha chế mẫu thử, đánh giá độ ổn định" }
    ]
  },
  "Sản xuất": {
    name: "Phòng Sản Xuất Kit (P-KIT)",
    code: "P-KIT",
    desc: "Sản xuất Kit IVD và hóa chất tách chiết theo ISO 13485 / GMP: pha mix, tách chiết, chiết rót, đóng gói, hồ sơ lô eBR",
    badgeColor: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800",
    borderTheme: "border-emerald-500",
    positions: [
      { title: "Trưởng phòng Sản xuất", defaultRole: "kit_head", level: "Manager", desc: "Quản lý toàn diện Phòng Sản xuất Kit, phê duyệt định mức BOM, lệnh sản xuất và hồ sơ lô eBR" },
      { title: "Phó Trưởng phòng Sản xuất", defaultRole: "kit_head", level: "Manager", desc: "Điều hành sản xuất, phát lệnh sản xuất, ký duyệt hồ sơ lô" },
      { title: "Trưởng nhóm Sản xuất tách chiết", defaultRole: "kit_staff", level: "Specialist", desc: "Phụ trách nhóm sản xuất hóa chất tách chiết" },
      { title: "Trưởng nhóm Sản xuất mix", defaultRole: "kit_staff", level: "Specialist", desc: "Phụ trách nhóm pha chế MasterMix" },
      { title: "Nhân viên sản xuất", defaultRole: "kit_staff", level: "Staff", desc: "Thực hiện công đoạn sản xuất, ghi hồ sơ lô eBR" }
    ]
  },
  "Tổng hợp Oligo": {
    name: "Phòng Tổng Hợp Oligo (P-OLIGO)",
    code: "P-OLIGO",
    desc: "Tổng hợp mồi và probe, cắt khử bảo vệ, tinh sạch HPLC/PAGE/OPC, đo OD và giao hàng",
    badgeColor: "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950/50 dark:text-violet-400 dark:border-violet-800",
    borderTheme: "border-violet-500",
    positions: [
      { title: "Trưởng phòng Tổng hợp Oligo", defaultRole: "oligo_head", level: "Manager", desc: "Điều phối đơn Oligo, duyệt mẻ tổng hợp và kết quả QC, duyệt giao hàng" },
      { title: "Phó Trưởng phòng Tổng hợp Oligo", defaultRole: "oligo_head", level: "Manager", desc: "Điều hành chuyên môn tổng hợp & tinh sạch Oligo, duyệt mẻ tổng hợp và kết quả QC khi Trưởng phòng ủy quyền" },
      { title: "Trưởng nhóm Sản xuất", defaultRole: "oligo_staff", level: "Specialist", desc: "Phụ trách nhóm vận hành máy tổng hợp và hậu xử lý" },
      { title: "Nhân viên Tổng hợp Oligo", defaultRole: "oligo_staff", level: "Staff", desc: "Vận hành máy tổng hợp, hậu xử lý, tinh sạch, đo OD, chia lọ" }
    ]
  },
  "KTCN": {
    name: "Phòng Kỹ Thuật Công Nghệ (KTCN – P-DEVICE)",
    code: "P-DEVICE",
    desc: "Thiết kế, sản xuất và lắp ráp thiết bị (DMR/DHR), lắp đặt – bảo trì – sửa chữa, hành chính kỹ thuật, khoa học công nghệ (IT và phát triển phần mềm thuộc Phòng IT – Khối Kinh Doanh)",
    badgeColor: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800",
    borderTheme: "border-amber-500",
    positions: [
      { title: "Trưởng phòng KTCN", defaultRole: "device_head", level: "Manager", desc: "Điều hành phòng; duyệt cổng dự án và ký phát hành phần mềm, ECO, lệnh lắp ráp (chưa bố trí: Ban Giám Đốc duyệt thay)" },
      { title: "Phó Trưởng phòng KTCN", defaultRole: "device_head", level: "Manager", desc: "Phụ trách kỹ thuật thiết bị, hồ sơ DMR/DHR, lệnh lắp ráp và bảo trì sửa chữa" },
      { title: "Trưởng nhóm Sản xuất thiết bị", defaultRole: "device_staff", level: "Specialist", desc: "Phụ trách lắp ráp thiết bị theo lệnh sản xuất, ký phiếu BM 21-01" },
      { title: "Trưởng nhóm Lắp đặt – Bảo trì – Sửa chữa thiết bị", defaultRole: "device_staff", level: "Specialist", desc: "Phụ trách lắp đặt, bảo trì, hiệu chuẩn và sửa chữa thiết bị" },
      { title: "Trưởng nhóm Hành Chính Kỹ Thuật Công Nghệ", defaultRole: "device_staff", level: "Specialist", desc: "Hồ sơ kỹ thuật, kế hoạch và hành chính của phòng" },
      { title: "Nhân viên Sản xuất thiết bị", defaultRole: "device_staff", level: "Staff", desc: "Lắp ráp, chạy lão hóa, ghi hồ sơ DHR" },
      { title: "Nhân viên Thiết kế và phát triển thiết bị", defaultRole: "device_staff", level: "Staff", desc: "Thiết kế cơ khí, điện tử, firmware; bản vẽ gia công" },
      { title: "Nhân viên Kỹ thuật", defaultRole: "device_staff", level: "Staff", desc: "Kỹ thuật thiết bị, gia công và QC chi tiết" },
      { title: "Chuyên viên Khoa học Công nghệ", defaultRole: "device_staff", level: "Specialist", desc: "Đề tài khoa học công nghệ, hồ sơ sở hữu trí tuệ" }
    ]
  },
  "IT": {
    name: "Phòng IT (Công nghệ thông tin – Phát triển phần mềm)",
    code: "IT",
    desc: "Khối Kinh Doanh: IT chung toàn công ty (máy tính, mạng, máy chủ, tài khoản, sao lưu) và nghiên cứu – phát triển phần mềm nội bộ / phần mềm thiết bị (hồ sơ thiết kế IEC 62304)",
    badgeColor: "bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-950/50 dark:text-cyan-300 dark:border-cyan-800",
    borderTheme: "border-cyan-500",
    positions: [
      { title: "Trưởng phòng IT", defaultRole: "it_head", level: "Manager", desc: "Điều hành phòng IT; duyệt cổng dự án và ký phát hành phần mềm (chưa bố trí: Ban Giám Đốc duyệt thay)" },
      { title: "Phó Trưởng phòng IT", defaultRole: "it_head", level: "Manager", desc: "Phụ trách hạ tầng CNTT và dự án phát triển phần mềm IEC 62304; thay Trưởng phòng điều hành khi vắng" },
      { title: "Nhân viên nghiên cứu phần mềm", defaultRole: "it_staff", level: "Staff", desc: "Phát triển phần mềm phân tích và điều khiển thiết bị, phần mềm nội bộ (hồ sơ thiết kế IEC 62304)" },
      { title: "Nhân viên IT", defaultRole: "it_staff", level: "Staff", desc: "IT chung toàn công ty: máy tính, mạng, máy chủ, tài khoản, sao lưu" }
    ]
  },
  "QC/QA": {
    name: "Phòng Đảm Bảo & Kiểm Soát Chất Lượng (QC/QA – P-QA)",
    code: "P-QA",
    desc: "Kiểm nghiệm nguyên liệu – bán thành phẩm – thành phẩm, giải phóng lô, COA, sai lệch/CAPA, hệ thống ISO 13485",
    badgeColor: "bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-950/50 dark:text-teal-400 dark:border-teal-800",
    borderTheme: "border-teal-500",
    positions: [
      { title: "Trưởng phòng QC-QA", defaultRole: "qa_qc_lead", level: "Manager", desc: "Quản lý hệ thống chất lượng ISO 13485, phê duyệt kết quả QC, giải phóng lô và CAPA" },
      { title: "Phó Trưởng phòng QC-QA", defaultRole: "qa_qc_lead", level: "Manager", desc: "Điều hành phòng, duyệt kết quả QC, giải phóng lô, thu hồi" },
      { title: "Nhân viên QC", defaultRole: "qa_qc", level: "Staff", desc: "Lấy mẫu, kiểm nghiệm, ghi kết quả QC" },
      { title: "Nhân viên ISO", defaultRole: "qa_qc", level: "Staff", desc: "Kiểm soát tài liệu, đào tạo, đánh giá nội bộ ISO 13485" }
    ]
  }
};

const ALIAS_TO_CANONICAL_POSITION_KEY: Record<string, string> = {
  "Nghiên Cứu R&D": "R&D",
  "Sản Xuất Kit": "Sản xuất",
  "Tổng Hợp Oligo": "Tổng hợp Oligo",
  "Kỹ Thuật – Thiết Bị": "KTCN",
  "QA / QC": "QC/QA",
  "QA/QC": "QC/QA",
  "Kỹ Thuật & Ứng Dụng": "APP",
  "Application": "APP",
  "Mua Hàng & Cung Ứng": "Kinh Doanh",
  "Cung Ứng": "Kinh Doanh",
  "Kho Vận": "Kinh Doanh",
  "Kế Toán": "Hành chính",
  "Pháp Chế": "Hành chính",
  "Pháp chế": "Hành chính",
  "Hành Chính Nhân Sự": "Hành chính",
};

// Tên phòng cũ / viết tắt vẫn tra được (hồ sơ và tài khoản tạo trước khi đổi sang tên phòng thực tế)
for (const [alias, key] of Object.entries(ALIAS_TO_CANONICAL_POSITION_KEY)) {
  DEPARTMENT_POSITIONS[alias] = DEPARTMENT_POSITIONS[key];
}

/** Phòng ban thực tế, theo thứ tự hiển thị (sơ đồ tổ chức, bộ lọc, chọn phòng). */
export const PRIMARY_DEPT_KEYS = COMPANY_DEPARTMENTS.map((d) => d.key);

/** Phòng ban gom theo khối, theo thứ tự hiển thị (bộ lọc, chọn phòng, sơ đồ tổ chức). */
export const DEPT_KEYS_BY_BLOCK = COMPANY_BLOCKS.map((block) => ({
  block,
  keys: COMPANY_DEPARTMENTS.filter((d) => d.block === block).map((d) => d.key),
}));

/** Hai tên phòng cùng chỉ một phòng thực tế (tên mới, tên cũ, viết tắt đều quy về `canonicalDepartment`). */
export const matchDepartment = (dept1?: string, dept2?: string): boolean => {
  if (!dept1 || !dept2) return false;
  if (dept1.toLowerCase().trim() === dept2.toLowerCase().trim()) return true;
  const c1 = canonicalDepartment(dept1);
  return c1 !== null && c1 === canonicalDepartment(dept2);
};

export const getDeptInfo = (deptName?: string) => {
  if (!deptName) return null;
  if (DEPARTMENT_POSITIONS[deptName]) return DEPARTMENT_POSITIONS[deptName];
  const matchedKey = PRIMARY_DEPT_KEYS.find((k) => matchDepartment(k, deptName));
  return matchedKey ? DEPARTMENT_POSITIONS[matchedKey] : null;
};

const LEGACY_TBR_SHARED_TITLES = new Set([
  "tổng giám đốc / giám đốc điều hành (ceo)",
  "phó giám đốc",
  "trợ lý ban giám đốc (executive assistant)",
  "trưởng phòng kinh doanh (head of sales)",
  "phó phòng kinh doanh",
  "quản lý sản phẩm (product manager - pm)",
  "chuyên viên kinh doanh (senior/junior)",
  "admin kinh doanh (sales admin)",
  "trưởng bộ phận marketing",
  "chuyên viên marketing",
]);

function cloneGroup(g: DepartmentPositionGroup): DepartmentPositionGroup {
  return { ...g, positions: g.positions.map((p) => ({ ...p })) };
}

/**
 * Gộp cấu hình vị trí lưu trên DB/localStorage với chuẩn 4 khối / 11 phòng ABT.
 * - Dữ liệu v2 (`_abtSchemaVersion === 2`): giữ nguyên chỉnh sửa theo từng phòng chuẩn ABT và gắn lại các alias.
 * - Dữ liệu cũ chưa gắn phiên bản (vd: bản lưu từ TBRs Portal thiếu Khối Kỹ thuật): nâng cấp về 11 phòng ABT chuẩn,
 *   loại bỏ các key/chức danh mẫu TBRs cũ nhưng vẫn giữ lại các vị trí tùy biến do người dùng tự thêm vào.
 */
export function mergeStoredDepartmentPositions(
  defaults: Record<string, DepartmentPositionGroup>,
  stored: unknown
): Record<string, DepartmentPositionGroup> {
  const result: Record<string, DepartmentPositionGroup> = {};
  const raw = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, any>) : null;
  const isCurrentSchema = raw?._abtSchemaVersion === ABT_ORG_SCHEMA_VERSION;

  for (const key of PRIMARY_DEPT_KEYS) {
    const def = defaults[key];
    if (!def) continue;
    const saved = raw?.[key];
    const savedPositions: DepartmentPositionItem[] | null =
      saved && typeof saved === "object" && Array.isArray(saved.positions)
        ? saved.positions.filter((p: any) => p && typeof p.title === "string")
        : null;

    if (isCurrentSchema && saved && typeof saved === "object") {
      const basePositions = savedPositions ? savedPositions.map((p) => ({ ...p })) : def.positions.map((p) => ({ ...p }));
      const existingNorms = new Set(basePositions.map((p) => p.title.toLowerCase().replace(/\s*-\s*/g, "-").trim()));
      for (const defPos of def.positions) {
        const defNorm = defPos.title.toLowerCase().replace(/\s*-\s*/g, "-").trim();
        if (!existingNorms.has(defNorm)) {
          basePositions.push({ ...defPos });
          existingNorms.add(defNorm);
        }
      }
      result[key] = {
        ...def,
        ...saved,
        positions: basePositions,
      };
    } else {
      const mergedPositions = def.positions.map((p) => ({ ...p }));
      const knownTitles = new Set(mergedPositions.map((p) => p.title.toLowerCase().trim()));
      if (savedPositions) {
        for (const pos of savedPositions) {
          const norm = pos.title.toLowerCase().trim();
          if (norm && !knownTitles.has(norm) && !LEGACY_TBR_SHARED_TITLES.has(norm)) {
            mergedPositions.push({ ...pos });
            knownTitles.add(norm);
          }
        }
      }
      result[key] = { ...def, positions: mergedPositions };
    }
  }

  for (const alias of Object.keys(defaults)) {
    if (PRIMARY_DEPT_KEYS.includes(alias)) continue;
    const mappedCanonical = ALIAS_TO_CANONICAL_POSITION_KEY[alias] ?? canonicalDepartment(alias) ?? alias;
    result[alias] = result[mappedCanonical] ?? cloneGroup(defaults[alias]);
  }

  return result;
}

export function stripOrgSchemaMetadata(positionsMap: Record<string, any>): Record<string, DepartmentPositionGroup> {
  const clean: Record<string, DepartmentPositionGroup> = {};
  for (const [k, v] of Object.entries(positionsMap || {})) {
    if (k === "_abtSchemaVersion") continue;
    if (v && typeof v === "object" && Array.isArray(v.positions)) {
      clean[k] = v as DepartmentPositionGroup;
    }
  }
  return clean;
}

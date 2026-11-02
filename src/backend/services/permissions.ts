// Hệ thống quản lý và kiểm tra phân quyền chi tiết (Granular & Department Permission Engine)

export interface PermissionItem {
  key: string;
  label: string;
  desc: string;
}

export interface PermissionGroup {
  module: string;
  title: string;
  permissions: PermissionItem[];
}

export interface DepartmentModule {
  key: string;            // Permission key điều khiển hiển thị Tab chính, ví dụ "procurement.view"
  tab: string;            // Tab id tương ứng (navbar & page), ví dụ "procurement"
  name: string;           // Tên phòng ban đầy đủ
  shortName: string;      // Tên Tab hiển thị trên thanh điều hướng
  code: string;           // Mã phân hệ
  desc: string;           // Mô tả chức năng phân hệ
  deptMatch: string[];    // Từ khóa nhận diện phòng ban trực thuộc
  roleMatch: string[];    // Từ khóa nhận diện chức danh chuyên trách
  defaultPermissions: Record<string, boolean>; // Bộ quyền đề xuất khi bật phòng ban này
}

// Danh mục 7 Phân hệ / Phòng ban chính có Tab trên thanh điều hướng
export const DEPARTMENT_MODULES: DepartmentModule[] = [
  {
    key: "procurement.view",
    tab: "procurement",
    name: "Phòng Mua Hàng & Cung Ứng",
    shortName: "Cung Ứng",
    code: "PROCUREMENT",
    desc: "Quản lý chuỗi cung ứng, đơn mua PO từ hãng, đề xuất mua hàng PR & theo dõi tiến độ hàng về",
    deptMatch: ["cung ứng", "mua hàng", "procurement", "purchasing", "thu mua"],
    roleMatch: ["procurement", "cung ứng", "mua hàng", "thu mua", "purchasing"],
    defaultPermissions: {
      "procurement.view": true,
      "procurement.create_pr": true,
      "procurement.approve_po": false,
      "warehouse.view": true,
      "warehouse.inbound": true,
      "warehouse.view_cost_price": true,
      "legal.view": true,
      "sales.view": false,
      "application.view": false
    }
  },
  {
    key: "sales.view",
    tab: "sales",
    name: "Phòng Kinh Doanh & Phân Phối",
    shortName: "Kinh Doanh",
    code: "SALES",
    desc: "Lập báo giá thiết bị & hóa chất, đơn hàng bán buôn/lẻ, đặt hàng nhà máy, hợp đồng & chiết khấu",
    deptMatch: ["kinh doanh", "sales", "bán hàng", "thương mại", "marketing"],
    roleMatch: ["sales", "kinh doanh", "bán hàng", "product manager", "marketing"],
    defaultPermissions: {
      "sales.view": true,
      "sales.create": true,
      "sales.edit": true,
      "sales.delete": false,
      "sales.approve_discount": false,
      "sales.approve_quotes": false,
      "sales.approve_zero_price": false,
      "sales.approve_orders": false,
      "sales.export_excel": false,
      "warehouse.view": true,
      "warehouse.reserve": true,
      "application.view": true,
      "application.create": true,
      "legal.view": true,
      "procurement.view": false
    }
  },
  {
    key: "warehouse.view",
    tab: "warehouse",
    name: "Phòng Kho Vận & Chuỗi Lạnh",
    shortName: "Quản Lý Kho",
    code: "WAREHOUSE",
    desc: "Kiểm soát thẻ kho, số Lô & HSD (EXP), giám sát chuỗi lạnh âm sâu, nhập/xuất kho & in barcode",
    deptMatch: ["kho vận", "kho", "warehouse", "logistics"],
    roleMatch: ["warehouse", "kho", "thủ kho", "logistics"],
    defaultPermissions: {
      "warehouse.view": true,
      "warehouse.inbound": true,
      "warehouse.outbound": true,
      "warehouse.reserve": true,
      "warehouse.view_cost_price": false,
      "warehouse.print_barcode": true,
      "procurement.view": true,
      "sales.view": false,
      "application.view": false,
      "legal.view": false
    }
  },
  {
    key: "application.view",
    tab: "application",
    name: "Phòng Kỹ Thuật & Application",
    shortName: "Application",
    code: "APPLICATION",
    desc: "Điều phối kỹ sư FSE, máy xét nghiệm demo tại bệnh viện, nghiệm thu kỹ thuật và chạy thử mẫu",
    deptMatch: ["kỹ thuật", "ứng dụng", "application", "fse", "lab"],
    roleMatch: ["application", "app", "kỹ thuật", "ứng dụng", "fse"],
    defaultPermissions: {
      "application.view": true,
      "application.create": true,
      "application.assign": false,
      "application.approve": false,
      "warehouse.view": true,
      "warehouse.reserve": true,
      "sales.view": false,
      "procurement.view": false,
      "legal.view": false
    }
  },
  {
    key: "legal.view",
    tab: "legal",
    name: "Phòng Pháp Chế & Thầu",
    shortName: "Pháp Chế",
    code: "LEGAL",
    desc: "Thẩm định pháp lý hợp đồng kinh tế, hồ sơ công bố lưu hành thiết bị IVD, bảo lãnh và hồ sơ thầu",
    deptMatch: ["pháp chế", "legal", "luật", "thầu"],
    roleMatch: ["pháp chế", "legal", "luật"],
    defaultPermissions: {
      "legal.view": true,
      "legal.create": true,
      "legal.approve": true,
      "sales.view": true,
      "procurement.view": true,
      "warehouse.view": false,
      "application.view": false
    }
  },
  {
    key: "zalo.view",
    tab: "zalo",
    name: "Điều Hành Zalo OA 4.0",
    shortName: "Zalo Điều Hành",
    code: "ZALO_OA",
    desc: "Bảng điều hành Zalo OA, thông báo đơn hàng tự động, duyệt báo giá chiết khấu cao từ xa",
    deptMatch: ["ban giám đốc", "điều hành"],
    roleMatch: ["director", "admin", "manager", "head"],
    defaultPermissions: {
      "zalo.view": true
    }
  },
  {
    key: "settings.view",
    tab: "settings",
    name: "Cấu Hình & Quản Trị Hệ Thống",
    shortName: "Cấu Hình & Nhật Ký",
    code: "SETTINGS",
    desc: "Quản lý danh bạ nhân sự, tài khoản người dùng, phân quyền phòng ban & nhật ký audit hệ thống",
    deptMatch: ["ban giám đốc"],
    roleMatch: ["director", "admin"],
    defaultPermissions: {
      "settings.view": true,
      "settings.manage_users": true,
      "settings.view_audit": true
    }
  }
];

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    module: "procurement",
    title: "1. Mua Hàng & Cung Ứng (Procurement)",
    permissions: [
      { key: "procurement.view", label: "Truy Cập Tab Cung Ứng", desc: "Xem đơn hàng PO mua vào, theo dõi tiến độ hàng nhập từ hãng" },
      { key: "procurement.create_pr", label: "Tạo Đề Xuất Mua Hàng PR", desc: "Tạo yêu cầu mua sắm bù tồn kho an toàn hoặc hàng đặt khách" },
      { key: "procurement.approve_po", label: "Phê Duyệt Đơn Mua PO", desc: "Ký duyệt đơn đặt hàng gửi nhà sản xuất (Lead / Trưởng phòng)" },
    ]
  },
  {
    module: "sales",
    title: "2. Kinh Doanh & Đơn Hàng / Báo Giá",
    permissions: [
      { key: "sales.view", label: "Truy Cập Tab Kinh Doanh", desc: "Tra cứu danh sách báo giá, đơn hàng kinh doanh" },
      { key: "sales.create", label: "Tạo Báo Giá Mới", desc: "Soạn thảo báo giá thiết bị & hóa chất gửi khách hàng" },
      { key: "sales.edit", label: "Chỉnh Sửa Thông Tin Đơn", desc: "Điều chỉnh số lượng, ghi chú, đơn giá" },
      { key: "sales.delete", label: "Hủy / Xóa Báo Giá", desc: "Quyền xóa hoặc hủy báo giá đã lập" },
      { key: "sales.approve_quotes", label: "Phê Duyệt Báo Giá & Báo Giá 0 Đồng", desc: "Thay mặt BGĐ phê duyệt báo giá thương mại, báo giá có mặt hàng 0đ / hàng tặng trước khi gửi khách" },
      { key: "sales.approve_zero_price", label: "Phê Duyệt Đơn Hàng 0 Đồng / Hàng Tặng", desc: "Thay mặt BGĐ phê duyệt đơn đặt hàng (SO) có sản phẩm giá 0đ, hàng tặng, hàng mẫu demo" },
      { key: "sales.approve_discount", label: "Phê Duyệt Chiết Khấu Đặc Biệt", desc: "Duyệt báo giá có chiết khấu vượt thẩm quyền" },
      { key: "sales.approve_orders", label: "Duyệt Yêu Cầu Đặt Hàng / Kế Hoạch", desc: "Duyệt hoặc từ chối yêu cầu đặt hàng (SO), kế hoạch chuyên đề và kế hoạch tuần" },
      { key: "sales.export_excel", label: "Xuất Dữ Liệu Excel / PDF", desc: "Tải file danh sách khách hàng và đơn hàng (Bảo mật data)" },
    ]
  },
  {
    module: "warehouse",
    title: "3. Quản Lý Kho & Hàng Hóa",
    permissions: [
      { key: "warehouse.view", label: "Truy Cập Tab Quản Lý Kho", desc: "Tra cứu số lượng tồn, số lô, hạn dùng EXP Kho Trung Tâm" },
      { key: "warehouse.inbound", label: "Tạo Phiếu Nhập Kho", desc: "Nhập hàng từ hãng hoặc nhập hoàn trả" },
      { key: "warehouse.outbound", label: "Tạo Phiếu Xuất Kho", desc: "Lập phiếu xuất hàng giao bệnh viện, phòng khám" },
      { key: "warehouse.reserve", label: "Khóa Giữ Chỗ Hàng Hóa", desc: "Khóa giữ tồn kho lô hàng phục vụ chào thầu" },
      { key: "warehouse.view_cost_price", label: "Xem Giá Vốn / Giá Nhập", desc: "Xem đơn giá nhập khẩu bí mật từ nhà sản xuất" },
      { key: "warehouse.print_barcode", label: "In Tem Barcode & QR Code", desc: "Tạo và in tem nhãn dán kiện hàng" },
    ]
  },
  {
    module: "application",
    title: "4. Application & Kỹ Thuật (FSE)",
    permissions: [
      { key: "application.view", label: "Truy Cập Tab Application", desc: "Tra cứu máy xét nghiệm đang đặt tại bệnh viện" },
      { key: "application.create", label: "Đăng Ký Mượn Máy Demo", desc: "Tạo đề xuất xuất máy demo phục vụ hội thảo/bác sĩ" },
      { key: "application.assign", label: "Phân Công Kỹ Thuật Viên FSE", desc: "Điều phối nhân sự xử lý sự cố thiết bị" },
      { key: "application.approve", label: "Ký Nghiệm Thu Kỹ Thuật", desc: "Phê duyệt biên bản bàn giao và chạy thử máy" },
    ]
  },
  {
    module: "legal",
    title: "5. Pháp Chế & Thầu",
    permissions: [
      { key: "legal.view", label: "Truy Cập Tab Pháp Chế", desc: "Tra cứu hồ sơ pháp lý, chứng từ bảo lãnh thầu" },
      { key: "legal.create", label: "Soạn Thảo Hợp Đồng", desc: "Tạo mới hợp đồng kinh tế mua bán thiết bị y tế" },
      { key: "legal.approve", label: "Phê Duyệt Pháp Lý Hợp Đồng", desc: "Thẩm định và duyệt điều khoản hợp đồng trước khi ký" },
    ]
  },
  {
    module: "settings",
    title: "6. Cấu Hình & Quản Trị Hệ Thống",
    permissions: [
      { key: "settings.view", label: "Truy Cập Tab Cấu Hình", desc: "Mở menu Cấu hình & Nhật ký hệ thống" },
      { key: "settings.manage_users", label: "Quản Lý Tài Khoản & Phân Quyền", desc: "Tạo tài khoản, đổi pass, phân quyền chi tiết cá nhân" },
      { key: "settings.view_audit", label: "Xem Nhật Ký Hệ Thống (Audit Log)", desc: "Theo dõi lịch sử chỉnh sửa và thao tác người dùng" },
    ]
  },
  {
    module: "communication",
    title: "7. Trao Đổi & Điều Hành Di Động",
    permissions: [
      { key: "chat.view", label: "Chat & Trao Đổi Nội Bộ", desc: "Mở tính năng chat trực tuyến cho toàn bộ nhân viên công ty" },
      { key: "zalo.view", label: "Điều Hành Zalo OA 4.0", desc: "Quản trị Zalo OA, cấu hình webhook, duyệt báo giá chiết khấu cao (Ban Giám Đốc / Quản Lý)" },
      { key: "workspace.manage_templates", label: "Quản Lý Quy Trình Phối Hợp Mẫu", desc: "Tạo / sửa / xóa quy trình phối hợp mẫu (các bước, phòng ban, người phụ trách) trong Điều Hành" },
    ]
  }
];

// Bộ quyền mẫu mặc định theo từng Chức danh / Vai trò (Role Templates)
export const ROLE_PRESETS: Record<string, Record<string, boolean>> = {
  director: {
    "*": true
  },
  admin: {
    "*": true
  },
  manager: {
    "procurement.view": true,
    "procurement.create_pr": true,
    "procurement.approve_po": true,
    "sales.view": true,
    "sales.create": true,
    "sales.edit": true,
    "sales.delete": true,
    "sales.approve_discount": true,
    "sales.approve_quotes": true,
    "sales.approve_zero_price": true,
    "sales.approve_orders": true,
    "sales.export_excel": true,
    "warehouse.view": true,
    "warehouse.inbound": true,
    "warehouse.outbound": true,
    "warehouse.reserve": true,
    "warehouse.view_cost_price": true,
    "warehouse.print_barcode": true,
    "application.view": true,
    "application.create": true,
    "application.assign": true,
    "application.approve": true,
    "legal.view": true,
    "legal.create": true,
    "legal.approve": true,
    "settings.view": true,
    "settings.manage_users": false,
    "settings.view_audit": true,
    "chat.view": true,
    "zalo.view": true
  },
  procurement_lead: {
    "procurement.view": true,
    "procurement.create_pr": true,
    "procurement.approve_po": true,
    "warehouse.view": true,
    "warehouse.inbound": true,
    "warehouse.outbound": false,
    "warehouse.reserve": false,
    "warehouse.view_cost_price": true,
    "warehouse.print_barcode": false,
    "sales.view": false,
    "sales.create": false,
    "sales.edit": false,
    "sales.delete": false,
    "sales.approve_discount": false,
    "sales.approve_quotes": false,
    "sales.approve_zero_price": false,
    "sales.approve_orders": false,
    "sales.export_excel": false,
    "application.view": false,
    "application.create": false,
    "application.assign": false,
    "application.approve": false,
    "legal.view": true,
    "legal.create": false,
    "legal.approve": false,
    "settings.view": false,
    "settings.manage_users": false,
    "settings.view_audit": false,
    "chat.view": true,
    "zalo.view": false
  },
  procurement_specialist: {
    "procurement.view": true,
    "procurement.create_pr": true,
    "procurement.approve_po": false,
    "warehouse.view": true,
    "warehouse.inbound": true,
    "warehouse.outbound": false,
    "warehouse.reserve": false,
    "warehouse.view_cost_price": true,
    "warehouse.print_barcode": false,
    "sales.view": false,
    "sales.create": false,
    "sales.edit": false,
    "sales.delete": false,
    "sales.approve_discount": false,
    "sales.approve_quotes": false,
    "sales.approve_zero_price": false,
    "sales.approve_orders": false,
    "sales.export_excel": false,
    "application.view": false,
    "application.create": false,
    "application.assign": false,
    "application.approve": false,
    "legal.view": true,
    "legal.create": false,
    "legal.approve": false,
    "settings.view": false,
    "settings.manage_users": false,
    "settings.view_audit": false,
    "chat.view": true,
    "zalo.view": false
  },
  sales_head: {
    "sales.view": true,
    "sales.create": true,
    "sales.edit": true,
    "sales.delete": true,
    "sales.approve_discount": true,
    "sales.approve_quotes": true,
    "sales.approve_zero_price": true,
    "sales.approve_orders": true,
    "sales.export_excel": true,
    "warehouse.view": true,
    "warehouse.inbound": false,
    "warehouse.outbound": false,
    "warehouse.reserve": true,
    "warehouse.view_cost_price": false,
    "warehouse.print_barcode": true,
    "application.view": true,
    "application.create": true,
    "application.assign": false,
    "application.approve": false,
    "procurement.view": false,
    "procurement.create_pr": true,
    "procurement.approve_po": false,
    "legal.view": true,
    "legal.create": true,
    "legal.approve": false,
    "settings.view": false,
    "settings.manage_users": false,
    "settings.view_audit": false,
    "chat.view": true,
    "zalo.view": true
  },
  sales_rep: {
    "sales.view": true,
    "sales.create": true,
    "sales.edit": true,
    "sales.delete": false,
    "sales.approve_discount": false,
    "sales.approve_quotes": false,
    "sales.approve_zero_price": false,
    "sales.approve_orders": false,
    "sales.export_excel": false,
    "warehouse.view": true,
    "warehouse.inbound": false,
    "warehouse.outbound": false,
    "warehouse.reserve": true,
    "warehouse.view_cost_price": false,
    "warehouse.print_barcode": true,
    "application.view": true,
    "application.create": true,
    "application.assign": false,
    "application.approve": false,
    "procurement.view": false,
    "procurement.create_pr": true,
    "procurement.approve_po": false,
    "legal.view": true,
    "legal.create": true,
    "legal.approve": false,
    "settings.view": false,
    "settings.manage_users": false,
    "settings.view_audit": false,
    "chat.view": true,
    "zalo.view": false
  },
  warehouse_lead: {
    "warehouse.view": true,
    "warehouse.inbound": true,
    "warehouse.outbound": true,
    "warehouse.reserve": true,
    "warehouse.view_cost_price": true,
    "warehouse.print_barcode": true,
    "procurement.view": true,
    "procurement.create_pr": true,
    "procurement.approve_po": false,
    "sales.view": true,
    "sales.create": false,
    "sales.edit": false,
    "sales.delete": false,
    "sales.approve_discount": false,
    "sales.approve_quotes": false,
    "sales.approve_zero_price": false,
    "sales.approve_orders": false,
    "sales.export_excel": false,
    "application.view": false,
    "application.create": false,
    "application.assign": false,
    "application.approve": false,
    "legal.view": false,
    "legal.create": false,
    "legal.approve": false,
    "settings.view": false,
    "settings.manage_users": false,
    "settings.view_audit": false,
    "chat.view": true,
    "zalo.view": true,
    "workspace.manage_templates": true
  },
  warehouse_specialist: {
    "warehouse.view": true,
    "warehouse.inbound": true,
    "warehouse.outbound": true,
    "warehouse.reserve": true,
    "warehouse.view_cost_price": false,
    "warehouse.print_barcode": true,
    "procurement.view": false,
    "procurement.create_pr": false,
    "procurement.approve_po": false,
    "sales.view": false,
    "sales.create": false,
    "sales.edit": false,
    "sales.delete": false,
    "sales.approve_discount": false,
    "sales.approve_quotes": false,
    "sales.approve_zero_price": false,
    "sales.approve_orders": false,
    "sales.export_excel": false,
    "application.view": false,
    "application.create": false,
    "application.assign": false,
    "application.approve": false,
    "legal.view": false,
    "legal.create": false,
    "legal.approve": false,
    "settings.view": false,
    "settings.manage_users": false,
    "settings.view_audit": false,
    "chat.view": true,
    "zalo.view": false
  },
  app_head: {
    "application.view": true,
    "application.create": true,
    "application.assign": true,
    "application.approve": true,
    "warehouse.view": true,
    "warehouse.inbound": false,
    "warehouse.outbound": false,
    "warehouse.reserve": true,
    "warehouse.view_cost_price": false,
    "warehouse.print_barcode": false,
    "sales.view": false,
    "sales.create": false,
    "sales.edit": false,
    "sales.delete": false,
    "sales.approve_discount": false,
    "sales.approve_quotes": false,
    "sales.approve_zero_price": false,
    "sales.approve_orders": false,
    "sales.export_excel": false,
    "procurement.view": false,
    "procurement.create_pr": true,
    "procurement.approve_po": false,
    "legal.view": false,
    "legal.create": false,
    "legal.approve": false,
    "settings.view": false,
    "settings.manage_users": false,
    "settings.view_audit": false,
    "chat.view": true,
    "zalo.view": true,
    "workspace.manage_templates": true
  },
  app_rep: {
    "application.view": true,
    "application.create": true,
    "application.assign": false,
    "application.approve": false,
    "warehouse.view": true,
    "warehouse.inbound": false,
    "warehouse.outbound": false,
    "warehouse.reserve": true,
    "warehouse.view_cost_price": false,
    "warehouse.print_barcode": false,
    "sales.view": false,
    "sales.create": false,
    "sales.edit": false,
    "sales.delete": false,
    "sales.approve_discount": false,
    "sales.approve_quotes": false,
    "sales.approve_zero_price": false,
    "sales.approve_orders": false,
    "sales.export_excel": false,
    "procurement.view": false,
    "procurement.create_pr": true,
    "procurement.approve_po": false,
    "legal.view": false,
    "legal.create": false,
    "legal.approve": false,
    "settings.view": false,
    "settings.manage_users": false,
    "settings.view_audit": false,
    "chat.view": true,
    "zalo.view": false
  },
  legal_head: {
    "legal.view": true,
    "legal.create": true,
    "legal.approve": true,
    "sales.view": true,
    "sales.create": false,
    "sales.edit": false,
    "sales.delete": false,
    "sales.approve_discount": false,
    "sales.approve_quotes": false,
    "sales.approve_zero_price": false,
    "sales.approve_orders": false,
    "sales.export_excel": false,
    "procurement.view": true,
    "procurement.create_pr": false,
    "procurement.approve_po": false,
    "warehouse.view": false,
    "warehouse.inbound": false,
    "warehouse.outbound": false,
    "warehouse.reserve": false,
    "warehouse.view_cost_price": false,
    "warehouse.print_barcode": false,
    "application.view": false,
    "application.create": false,
    "application.assign": false,
    "application.approve": false,
    "settings.view": false,
    "settings.manage_users": false,
    "settings.view_audit": false,
    "chat.view": true,
    "zalo.view": true,
    "workspace.manage_templates": true
  },
  legal: {
    "legal.view": true,
    "legal.create": true,
    "legal.approve": false,
    "sales.view": true,
    "sales.create": false,
    "sales.edit": false,
    "sales.delete": false,
    "sales.approve_discount": false,
    "sales.approve_quotes": false,
    "sales.approve_zero_price": false,
    "sales.approve_orders": false,
    "sales.export_excel": false,
    "procurement.view": true,
    "procurement.create_pr": false,
    "procurement.approve_po": false,
    "warehouse.view": false,
    "warehouse.inbound": false,
    "warehouse.outbound": false,
    "warehouse.reserve": false,
    "warehouse.view_cost_price": false,
    "warehouse.print_barcode": false,
    "application.view": false,
    "application.create": false,
    "application.assign": false,
    "application.approve": false,
    "settings.view": false,
    "settings.manage_users": false,
    "settings.view_audit": false,
    "chat.view": true,
    "zalo.view": false
  },
  accountant_head: {
    "sales.view": true,
    "sales.create": false,
    "sales.edit": false,
    "sales.delete": false,
    "sales.approve_discount": true,
    "sales.approve_quotes": true,
    "sales.approve_zero_price": true,
    "sales.approve_orders": true,
    "sales.export_excel": true,
    "warehouse.view": true,
    "warehouse.inbound": false,
    "warehouse.outbound": false,
    "warehouse.reserve": false,
    "warehouse.view_cost_price": true,
    "warehouse.print_barcode": false,
    "application.view": false,
    "application.create": false,
    "application.assign": false,
    "application.approve": false,
    "procurement.view": true,
    "procurement.create_pr": false,
    "procurement.approve_po": true,
    "legal.view": true,
    "legal.create": false,
    "legal.approve": false,
    "settings.view": false,
    "settings.manage_users": false,
    "settings.view_audit": true,
    "chat.view": true,
    "zalo.view": true,
    "workspace.manage_templates": true
  },
  accountant: {
    "sales.view": true,
    "sales.create": false,
    "sales.edit": false,
    "sales.delete": false,
    "sales.approve_discount": false,
    "sales.approve_quotes": false,
    "sales.approve_zero_price": false,
    "sales.approve_orders": false,
    "sales.export_excel": true,
    "warehouse.view": true,
    "warehouse.inbound": false,
    "warehouse.outbound": false,
    "warehouse.reserve": false,
    "warehouse.view_cost_price": true,
    "warehouse.print_barcode": false,
    "application.view": false,
    "application.create": false,
    "application.assign": false,
    "application.approve": false,
    "procurement.view": true,
    "procurement.create_pr": false,
    "procurement.approve_po": false,
    "legal.view": true,
    "legal.create": false,
    "legal.approve": false,
    "settings.view": false,
    "settings.manage_users": false,
    "settings.view_audit": false,
    "chat.view": true,
    "zalo.view": false
  },
  qa_qc_lead: {
    "warehouse.view": true,
    "warehouse.inbound": true,
    "warehouse.outbound": true,
    "warehouse.reserve": true,
    "warehouse.view_cost_price": false,
    "warehouse.print_barcode": true,
    "application.view": true,
    "application.create": false,
    "application.assign": false,
    "application.approve": true,
    "sales.view": false,
    "sales.create": false,
    "sales.edit": false,
    "sales.delete": false,
    "sales.approve_discount": false,
    "sales.approve_quotes": false,
    "sales.approve_zero_price": false,
    "sales.approve_orders": false,
    "sales.export_excel": false,
    "procurement.view": false,
    "procurement.create_pr": false,
    "procurement.approve_po": false,
    "legal.view": true,
    "legal.create": false,
    "legal.approve": true,
    "settings.view": false,
    "settings.manage_users": false,
    "settings.view_audit": false,
    "chat.view": true,
    "zalo.view": true,
    "workspace.manage_templates": true
  },
  qa_qc: {
    "warehouse.view": true,
    "warehouse.inbound": true,
    "warehouse.outbound": false,
    "warehouse.reserve": true,
    "warehouse.view_cost_price": false,
    "warehouse.print_barcode": true,
    "application.view": true,
    "application.create": false,
    "application.assign": false,
    "application.approve": false,
    "sales.view": false,
    "sales.create": false,
    "sales.edit": false,
    "sales.delete": false,
    "sales.approve_discount": false,
    "sales.approve_quotes": false,
    "sales.approve_zero_price": false,
    "sales.approve_orders": false,
    "sales.export_excel": false,
    "procurement.view": false,
    "procurement.create_pr": false,
    "procurement.approve_po": false,
    "legal.view": true,
    "legal.create": false,
    "legal.approve": false,
    "settings.view": false,
    "settings.manage_users": false,
    "settings.view_audit": false,
    "chat.view": true,
    "zalo.view": false
  },
  marketing: {
    "sales.view": true,
    "sales.create": false,
    "sales.edit": false,
    "sales.delete": false,
    "sales.approve_discount": false,
    "sales.approve_quotes": false,
    "sales.approve_zero_price": false,
    "sales.approve_orders": false,
    "sales.export_excel": false,
    "warehouse.view": false,
    "warehouse.inbound": false,
    "warehouse.outbound": false,
    "warehouse.reserve": false,
    "warehouse.view_cost_price": false,
    "warehouse.print_barcode": false,
    "application.view": false,
    "application.create": false,
    "application.assign": false,
    "application.approve": false,
    "procurement.view": false,
    "procurement.create_pr": false,
    "procurement.approve_po": false,
    "legal.view": false,
    "legal.create": false,
    "legal.approve": false,
    "settings.view": false,
    "settings.manage_users": false,
    "settings.view_audit": false,
    "chat.view": true,
    "zalo.view": false
  },
  staff: {
    "sales.view": false,
    "sales.create": false,
    "sales.edit": false,
    "sales.delete": false,
    "sales.approve_discount": false,
    "sales.approve_quotes": false,
    "sales.approve_zero_price": false,
    "sales.approve_orders": false,
    "sales.export_excel": false,
    "warehouse.view": false,
    "warehouse.inbound": false,
    "warehouse.outbound": false,
    "warehouse.reserve": false,
    "warehouse.view_cost_price": false,
    "warehouse.print_barcode": false,
    "application.view": false,
    "application.create": false,
    "application.assign": false,
    "application.approve": false,
    "procurement.view": false,
    "procurement.create_pr": true,
    "procurement.approve_po": false,
    "legal.view": false,
    "legal.create": false,
    "legal.approve": false,
    "settings.view": false,
    "settings.manage_users": false,
    "settings.view_audit": false,
    "chat.view": true,
    "zalo.view": false
  }
};

// Aliases cho các vai trò thường dùng
ROLE_PRESETS.sales = ROLE_PRESETS.sales_rep;
ROLE_PRESETS.warehouse = ROLE_PRESETS.warehouse_specialist;
ROLE_PRESETS.procurement = ROLE_PRESETS.procurement_specialist;
ROLE_PRESETS.application = ROLE_PRESETS.app_rep;
ROLE_PRESETS.chief_accountant = ROLE_PRESETS.accountant_head;

/**
 * Suy luận mã Vai trò hệ thống (System Role) chuẩn hóa từ Phòng ban, Chức vụ và Vai trò khai báo (nếu có).
 * Phân tách rõ ràng cấp Quản lý (Head / Lead) và cấp Chuyên viên / Nhân viên (Rep / Specialist / Staff).
 */
export function inferSystemRoleFromPosition(deptStr?: string, posStr?: string, explicitRole?: string): string {
  const rawRole = (explicitRole || "").toLowerCase().trim();
  const dept = (deptStr || "").toLowerCase().trim();
  const pos = (posStr || "").toLowerCase().trim();

  const isLeaderPos =
    pos.includes("trưởng") ||
    pos.includes("phó phòng") ||
    pos.includes("phó bộ phận") ||
    pos.includes("head") ||
    pos.includes("lead") ||
    pos.includes("chief") ||
    (pos.includes("manager") && !pos.includes("product manager") && !pos.includes("account manager"));

  // Nếu cột Vai trò hệ thống đã chỉ định rõ mã chuẩn có phân cấp
  const canonicalRoles = new Set([
    "admin",
    "sales_head",
    "sales_rep",
    "warehouse_lead",
    "warehouse",
    "warehouse_specialist",
    "procurement_lead",
    "procurement_specialist",
    "app_head",
    "app_rep",
    "accountant_head",
    "accountant",
    "qa_qc_lead",
    "qa_qc",
    "legal_head",
    "legal",
  ]);

  if (canonicalRoles.has(rawRole)) {
    // Nếu trong file cũ ghi "app_head" nhưng chức vụ thực tế là Kỹ sư (không phải Trưởng/Phó/Head) thì chuẩn hóa về "app_rep"
    if (rawRole === "app_head" && pos && !isLeaderPos && (pos.includes("kỹ sư") || pos.includes("chuyên viên") || pos.includes("nhân viên") || pos.includes("specialist") || pos.includes("engineer"))) {
      return "app_rep";
    }
    // Nếu ghi chung "warehouse" nhưng chức vụ là Trưởng bộ phận kho -> "warehouse_lead"
    if (rawRole === "warehouse" && isLeaderPos) {
      return "warehouse_lead";
    }
    // Nếu ghi chung "accountant" nhưng chức vụ là Kế toán trưởng -> "accountant_head"
    if (rawRole === "accountant" && isLeaderPos) {
      return "accountant_head";
    }
    // Nếu ghi chung "qa_qc" nhưng chức vụ là Trưởng bộ phận QA/QC -> "qa_qc_lead"
    if (rawRole === "qa_qc" && isLeaderPos) {
      return "qa_qc_lead";
    }
    // Nếu ghi chung "legal" nhưng chức vụ là Trưởng bộ phận Pháp chế -> "legal_head"
    if (rawRole === "legal" && isLeaderPos) {
      return "legal_head";
    }
    return rawRole === "warehouse_specialist" ? "warehouse" : rawRole;
  }

  // Nếu cột Vai trò ghi chung "procurement" -> phân tách theo chức vụ
  if (rawRole === "procurement") {
    return isLeaderPos ? "procurement_lead" : "procurement_specialist";
  }

  const combined = `${rawRole} ${pos} ${dept}`;

  // 1. Kế toán / Tài chính (kiểm tra trước để "Kế toán kho" không bị nhận nhầm sang Kho vận)
  if (pos.includes("kế toán") || dept.includes("kế toán") || pos.includes("tài chính") || dept.includes("tài chính") || rawRole.includes("accountant") || rawRole.includes("chief accountant")) {
    return isLeaderPos || rawRole.includes("chief") || rawRole.includes("head") || rawRole.includes("trưởng")
      ? "accountant_head"
      : "accountant";
  }

  // 2. Ban Giám Đốc / Admin (loại trừ "Sales Admin" / "Admin Kinh Doanh")
  const isSalesAdmin = pos.includes("sales admin") || pos.includes("sale admin") || pos.includes("admin kinh doanh") || rawRole.includes("sales admin");
  if (
    !isSalesAdmin &&
    (rawRole === "director" ||
      rawRole === "root" ||
      pos.includes("tổng giám đốc") ||
      pos.includes("phó giám đốc") ||
      pos.includes("giám đốc") ||
      dept.includes("ban giám đốc") ||
      dept === "bod" ||
      rawRole.includes("giám đốc") ||
      rawRole.includes("director") ||
      rawRole.includes("ceo") ||
      (dept.includes("nhân sự") && isLeaderPos))
  ) {
    return "admin";
  }

  // 3. Kinh Doanh & Marketing
  if (
    dept.includes("kinh doanh") ||
    dept.includes("sales") ||
    dept.includes("marketing") ||
    pos.includes("kinh doanh") ||
    pos.includes("sales") ||
    pos.includes("product manager") ||
    rawRole.includes("sales")
  ) {
    return isLeaderPos || rawRole.includes("head") ? "sales_head" : "sales_rep";
  }

  // 4. Kho Vận & Chuỗi Lạnh
  if (dept.includes("kho") || dept.includes("warehouse") || dept.includes("logistics") || pos.includes("kho") || pos.includes("giao nhận") || rawRole.includes("warehouse")) {
    return isLeaderPos || rawRole.includes("lead") || rawRole.includes("manager") ? "warehouse_lead" : "warehouse";
  }

  // 5. Mua Hàng & Cung Ứng
  if (dept.includes("cung ứng") || dept.includes("mua hàng") || dept.includes("procurement") || pos.includes("mua hàng") || pos.includes("cung ứng") || rawRole.includes("procurement")) {
    return isLeaderPos || rawRole.includes("lead") || rawRole.includes("head") ? "procurement_lead" : "procurement_specialist";
  }

  // 6. Kỹ Thuật & Ứng Dụng (Application)
  if (
    dept.includes("kỹ thuật") ||
    dept.includes("ứng dụng") ||
    dept.includes("application") ||
    pos.includes("kỹ thuật") ||
    pos.includes("ứng dụng") ||
    pos.includes("kỹ sư") ||
    pos.includes("service engineer") ||
    rawRole.includes("app") ||
    rawRole.includes("application")
  ) {
    return isLeaderPos || rawRole.includes("head") ? "app_head" : "app_rep";
  }

  // 7. QA / QC
  if (dept.includes("qa") || dept.includes("qc") || dept.includes("chất lượng") || pos.includes("qa") || pos.includes("qc") || pos.includes("chất lượng") || pos.includes("iso") || combined.includes("qa_qc")) {
    return isLeaderPos || rawRole.includes("lead") || rawRole.includes("manager") ? "qa_qc_lead" : "qa_qc";
  }

  // 8. Pháp Chế
  if (dept.includes("pháp chế") || dept.includes("legal") || pos.includes("pháp chế") || pos.includes("pháp lý") || rawRole.includes("legal")) {
    return isLeaderPos || rawRole.includes("head") || rawRole.includes("lead") ? "legal_head" : "legal";
  }

  return "sales_rep";
}

// Hàm phân giải vai trò linh hoạt theo Tên chức danh và Phòng ban
export function resolveRolePreset(roleName?: string, deptName?: string): Record<string, boolean> {
  const role = (roleName || "").toLowerCase().trim();
  const dept = (deptName || "").toLowerCase().trim();

  if (ROLE_PRESETS[role]) {
    return ROLE_PRESETS[role];
  }

  // 1. Ban Giám Đốc / Admin
  if (
    role === "director" || 
    role === "admin" || 
    role.includes("giám đốc")
  ) {
    return ROLE_PRESETS.director;
  }

  // 2. Mua Hàng & Cung Ứng
  if (
    role.includes("procurement") || 
    role.includes("cung ứng") || 
    role.includes("mua hàng") || 
    role.includes("thu mua") || 
    role.includes("purchasing") ||
    dept.includes("cung ứng") || 
    dept.includes("mua hàng") || 
    dept.includes("procurement") ||
    dept.includes("purchasing") ||
    dept.includes("thu mua")
  ) {
    if (role.includes("lead") || role.includes("trưởng") || role.includes("head") || role.includes("manager")) {
      return ROLE_PRESETS.procurement_lead;
    }
    return ROLE_PRESETS.procurement_specialist;
  }

  // 3. Kinh Doanh
  if (
    role.includes("sales") || 
    role.includes("kinh doanh") || 
    role.includes("product manager") ||
    dept.includes("kinh doanh") || 
    dept.includes("sales")
  ) {
    if (role.includes("head") || role.includes("trưởng") || role.includes("phó") || (role.includes("manager") && !role.includes("product manager"))) {
      return ROLE_PRESETS.sales_head;
    }
    return ROLE_PRESETS.sales_rep;
  }

  // 4. Kho Vận
  if (
    role.includes("warehouse") || 
    role.includes("kho") || 
    dept.includes("kho") || 
    dept.includes("warehouse")
  ) {
    if (role.includes("lead") || role.includes("trưởng") || role.includes("phụ trách") || role.includes("manager")) {
      return ROLE_PRESETS.warehouse_lead;
    }
    return ROLE_PRESETS.warehouse_specialist;
  }

  // 5. Application / Kỹ Thuật
  if (
    role.includes("application") || 
    role.includes("app_") || 
    role.includes("ứng dụng") || 
    role.includes("kỹ thuật") ||
    dept.includes("application") || 
    dept.includes("ứng dụng") || 
    dept.includes("kỹ thuật")
  ) {
    if (role.includes("head") || role.includes("trưởng") || role.includes("manager")) {
      return ROLE_PRESETS.app_head;
    }
    return ROLE_PRESETS.app_rep;
  }

  // 6. Pháp Chế
  if (
    role.includes("legal") || 
    role.includes("pháp chế") || 
    dept.includes("pháp chế") || 
    dept.includes("legal")
  ) {
    if (role.includes("head") || role.includes("lead") || role.includes("trưởng")) {
      return ROLE_PRESETS.legal_head;
    }
    return ROLE_PRESETS.legal;
  }

  // 7. Kế Toán
  if (
    role.includes("accountant") || 
    role.includes("kế toán") || 
    dept.includes("kế toán")
  ) {
    if (role.includes("head") || role.includes("chief") || role.includes("trưởng")) {
      return ROLE_PRESETS.accountant_head;
    }
    return ROLE_PRESETS.accountant;
  }

  // 8. QA/QC
  if (role.includes("qa") || role.includes("qc") || dept.includes("qa") || dept.includes("qc")) {
    if (role.includes("lead") || role.includes("head") || role.includes("trưởng") || role.includes("manager")) {
      return ROLE_PRESETS.qa_qc_lead;
    }
    return ROLE_PRESETS.qa_qc;
  }

  // 9. Marketing
  if (role.includes("marketing") || dept.includes("marketing")) {
    return ROLE_PRESETS.marketing;
  }

  // 10. Manager chung
  if (role.includes("manager") || role.includes("quản lý")) {
    return ROLE_PRESETS.manager;
  }

  return ROLE_PRESETS[role] || ROLE_PRESETS.staff;
}

// Lấy bộ quyền mặc định khi chọn gán nhanh theo phòng ban
export function getDefaultDepartmentPermissions(departmentName: string, positionName?: string): Record<string, boolean> {
  const preset = resolveRolePreset(positionName, departmentName);
  const result: Record<string, boolean> = {};

  PERMISSION_GROUPS.forEach(g => {
    g.permissions.forEach(p => {
      result[p.key] = Boolean(preset["*"] || preset[p.key]);
    });
  });

  return result;
}

export function hasPermission(user: any, permissionKey: string): boolean {
  if (!user) return false;

  // 1. Phân hệ dùng chung: Chat nội bộ và Điều hành công việc luôn mở cho toàn bộ nhân sự đã đăng nhập
  if (permissionKey === "chat.view" || permissionKey === "workspace.view") {
    return true;
  }

  const role = (user.role || "").toLowerCase().trim();
  const dept = (user.department || "").toLowerCase().trim();
  const username = (user.username || "").toLowerCase().trim();

  // 2. Ban Giám Đốc hoặc Super Admin: Toàn quyền hệ thống.
  // Chỉ dựa vào vai trò (do Quản trị viên đặt), không dựa vào tên phòng ban: phòng ban là chữ tự do
  // ("Trợ lý Giám đốc", "Phó Giám đốc KD"...) và trước đây tự động thành toàn quyền.
  if (
    role === "director" ||
    role === "admin" ||
    username === "admin" ||
    role.includes("giám đốc")
  ) {
    return true;
  }

  // 3. Phân quyền tùy biến chi tiết (Custom PBAC): Ưu tiên cao nhất nếu Admin đã cấu hình riêng cho tài khoản
  let userPerms = user.permissions;
  if (typeof userPerms === "string") {
    try { userPerms = JSON.parse(userPerms); } catch (e) { userPerms = {}; }
  }
  if (userPerms && typeof userPerms === "object") {
    if (userPerms[permissionKey] !== undefined) {
      return Boolean(userPerms[permissionKey]);
    }
  }

  // 4. BẢO ĐẢM TRUY CẬP PHÒNG BAN (Department Access Guarantee):
  // Nhân sự thuộc phòng ban nào thì BẮT BUỘC ĐƯỢC VÀO phân hệ chính của phòng ban đó!
  if (permissionKey === "procurement.view") {
    if (
      dept.includes("cung ứng") || 
      dept.includes("mua hàng") || 
      dept.includes("procurement") || 
      dept.includes("purchasing") || 
      dept.includes("thu mua") ||
      role.includes("procurement") || 
      role.includes("cung ứng") || 
      role.includes("mua hàng") || 
      role.includes("thu mua")
    ) {
      return true;
    }
  }

  if (permissionKey === "sales.view") {
    if (
      dept.includes("kinh doanh") || 
      dept.includes("sales") || 
      dept.includes("bán hàng") ||
      role.includes("sales") || 
      role.includes("kinh doanh") || 
      role.includes("bán hàng")
    ) {
      return true;
    }
  }

  if (permissionKey === "warehouse.view") {
    if (
      dept.includes("kho") || 
      dept.includes("warehouse") || 
      role.includes("warehouse") || 
      role.includes("kho")
    ) {
      return true;
    }
  }

  if (permissionKey === "application.view") {
    if (
      dept.includes("ứng dụng") || 
      dept.includes("application") || 
      dept.includes("kỹ thuật") || 
      role.includes("application") || 
      role.includes("app") || 
      role.includes("kỹ thuật")
    ) {
      return true;
    }
  }

  if (permissionKey === "legal.view") {
    if (
      dept.includes("pháp chế") || 
      dept.includes("legal") || 
      role.includes("legal") || 
      role.includes("pháp chế")
    ) {
      return true;
    }
  }

  // 5. Điều hành Zalo OA: Dành riêng cho BGĐ, Quản lý, Trưởng/Phó phòng hoặc tài khoản được cấp quyền
  if (permissionKey === "zalo.view") {
    if (
      role.includes("manager") || 
      role.includes("sales_head") || 
      role.includes("head") || 
      role.includes("lead") || 
      role.includes("chief") || 
      role.includes("trưởng") || 
      role.includes("phó")
    ) {
      return true;
    }
    return false;
  }

  // 6. Theo Preset vai trò chuẩn
  const preset = resolveRolePreset(user.role, user.department);
  if (preset["*"]) return true;
  return Boolean(preset[permissionKey]);
}

export function getEffectivePermissions(user: any): Record<string, boolean> {
  if (!user) return {};
  const result: Record<string, boolean> = {};
  
  PERMISSION_GROUPS.forEach(g => {
    g.permissions.forEach(p => {
      result[p.key] = hasPermission(user, p.key);
    });
  });

  DEPARTMENT_MODULES.forEach(m => {
    if (result[m.key] === undefined) {
      result[m.key] = hasPermission(user, m.key);
    }
  });

  // Bảo đảm các quyền tùy biến đã lưu trong user.permissions luôn được ánh xạ chính xác
  let userPerms = user.permissions;
  if (typeof userPerms === "string") {
    try { userPerms = JSON.parse(userPerms); } catch (e) { userPerms = {}; }
  }
  if (userPerms && typeof userPerms === "object") {
    Object.entries(userPerms).forEach(([k, v]) => {
      result[k] = Boolean(v);
    });
  }

  return result;
}

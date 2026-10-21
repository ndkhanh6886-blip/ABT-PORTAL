"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  LayoutDashboard,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Users,
  Calendar,
  Plus,
  Search,
  Filter,
  ArrowRight,
  Building2,
  FlaskConical,
  Briefcase,
  Package,
  ShoppingCart,
  MessageSquare,
  Check,
  X,
  Sparkles,
  ChevronRight,
  Eye,
  Trash2,
  Send,
  ListTodo,
  CalendarDays,
  RefreshCw,
  BarChart3,
  TrendingUp,
  Activity,
  AlertCircle,
  ArrowUpRight,
  Layers,
  ChevronDown,
  ChevronUp,
  Target,
  DollarSign,
  ShieldCheck,
  Lock,
  UserCheck,
  User,
  FileText,
  Paperclip,
  UploadCloud,
  Download,
  Image as ImageIcon,
  ExternalLink,
  FileSpreadsheet,
  Award,
  Printer,
  Pencil,
  Circle,
  ListChecks,
  Star,
  MessageCircle
} from "lucide-react";
import { Modal } from "@/frontend/components/Modal";
import { useNotification } from "@/frontend/contexts/NotificationContext";
import { useAuth } from "@/frontend/contexts/AuthContext";
import { cn } from "@/backend/services/utils";
import { todayVN, toVNDateString, nowVNDateTime } from "@/backend/services/dates";

// Configuration for Departments
export const DEPARTMENTS = [
  { id: "all", name: "Toàn công ty", icon: Building2 },
  { id: "Kinh Doanh", name: "Kinh Doanh", icon: Briefcase },
  { id: "Application", name: "Application (Lab)", icon: FlaskConical },
  { id: "Kho & Vận Hành", name: "Kho & Vận Hành", icon: Package },
  { id: "Cung Ứng", name: "Cung Ứng", icon: ShoppingCart },
  { id: "Pháp Chế", name: "Pháp Chế & Tuân Thủ", icon: ShieldCheck },
];

export const FICTIONAL_WORKSPACE_ASSIGNEES = new Set([
  "phạm quốc tuấn",
  "lê kỹ thuật",
  "nguyễn văn a",
  "nguyễn văn nam",
  "trần thủ kho",
  "trần thị thảo",
  "đội vận chuyển"
]);

export function cleanWorkspaceAssignee(name: any): string {
  const s = String(name || "").trim();
  if (!s) return "";
  if (FICTIONAL_WORKSPACE_ASSIGNEES.has(s.toLowerCase())) return "";
  return s;
}

export function normalizeWorkspaceDept(raw: any): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s === "all") return "all";
  const l = s.toLowerCase();
  if (l.includes("ứng dụng") || l.includes("application") || l.includes("kỹ thuật")) return "Application";
  if (l.includes("kho") || l.includes("vận hành") || l.includes("warehouse")) return "Kho & Vận Hành";
  if (l.includes("cung ứng") || l.includes("mua hàng") || l.includes("procurement")) return "Cung Ứng";
  if (l.includes("kinh doanh") || l.includes("sales") || l.includes("marketing")) return "Kinh Doanh";
  if (l.includes("pháp chế") || l.includes("legal") || l.includes("qa") || l.includes("qc") || l.includes("chất lượng")) return "Pháp Chế";
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

export const DEPARTMENT_CATEGORIES: Record<string, string[]> = {
  "Kinh Doanh": [
    "Chăm sóc KH",
    "Báo giá & Đàm phán",
    "Hợp đồng & Đơn hàng",
    "Theo dõi Giao hàng",
    "Thu hồi Công nợ",
    "Phát triển Thị trường / Khách mới",
    "Hỗ trợ thầu / Dự án",
    "Khác"
  ],
  "Application": [
    "Demo máy & Thiết bị tại viện",
    "Thử nghiệm mẫu & Đánh giá Kit",
    "Đào tạo / HDSD khách hàng",
    "Đánh giá QC nội bộ",
    "Khắc phục sự cố kỹ thuật (Troubleshooting)",
    "Viết SOP / Hướng dẫn quy trình",
    "Bảo trì / Hiệu chuẩn thiết bị",
    "Khác"
  ],
  "Kho & Vận Hành": [
    "Nhập kho PO",
    "Soạn hàng & Đóng gói phiếu xuất",
    "Kiểm kê định kỳ",
    "Giao nhận vận chuyển",
    "Bảo quản kho lạnh / âm sâu",
    "Khác"
  ],
  "Cung Ứng": [
    "Tìm nguồn hàng & Đàm phán NCC",
    "Lập đơn mua hàng (PO)",
    "Theo dõi tiến độ giao hàng NCC",
    "Thủ tục hải quan & Nhập khẩu",
    "Đánh giá định kỳ NCC",
    "Khác"
  ],
  "Pháp Chế": [
    "Thẩm định Hợp đồng Kinh tế & Mua bán",
    "Rà soát tính hợp pháp Hồ sơ Thầu Bệnh viện",
    "Quản lý Giấy phép lưu hành & CFS / COA IVD",
    "Thỏa thuận Bảo mật & Hợp đồng Đại lý",
    "Bảo hộ Sở hữu trí tuệ thương hiệu TBRs",
    "Tư vấn Pháp luật Doanh nghiệp & Lao động",
    "Khác"
  ]
};


export const DEPARTMENT_STAFF: Record<string, string[]> = {
  "Ban Giám Đốc": [
    "Nguyễn Văn Hưng (CEO)",
    "Đỗ Ngọc Diễm Trúc (Phó Giám Đốc)",
    "Võ Thị Cẩm Giang (Phó Giám Đốc)"
  ],
  "Application": [
    "Vũ Nhật Tân (Trưởng Phòng)",
    "Vũ Thị Quỳnh Như",
    "Mai Quí Minh",
    "Huỳnh Ngọc Nhi"
  ],
  "Kinh Doanh": [
    "Lê Hữu Nhân",
    "K' Trọng Nghĩa",
    "Đỗ Phạm Bảo Ngọc",
    "Nguyễn Ánh Nhựt",
    "Phạm Nguyễn Minh Châu",
    "Phan Minh Nghĩa",
    "Phạm Thị Thu Thủy",
    "Lê Thị Thuỳ Trang",
    "Trần Thị Mỹ Linh",
    "Ngô Thị Yến Nhi"
  ],
  "Kho & Vận Hành": [
    "Dương Phương Bảo Khoa (Trưởng Bộ Phận)",
    "Trần Thị Minh Hậu (Thủ Kho)",
    "Hoàng Thị Huệ (Thủ Kho)"
  ],
  "Cung Ứng": [
    "Trần Thị Trà My",
    "Nguyễn Tấn Lộc"
  ],
  "Kế Toán": [
    "Võ Thị Ngọc Giàu (Kế Toán Trưởng)",
    "Nguyễn Thị Hạnh",
    "Nguyễn Lệ Quân"
  ],
  "Pháp Chế": [
    "Nguyễn Thị Ngọc Huyền"
  ]
};

export interface ThematicStageTemplate {
  name: string;
  estimatedDays?: number;
}

export interface ThematicTypeDefinition {
  id: string;
  name: string;
  icon: string;
  codePrefix: string;
  description: string;
  sampleObjectives: string;
  defaultStages: ThematicStageTemplate[];
}

export const DEPARTMENT_THEMATIC_TYPES: Record<string, ThematicTypeDefinition[]> = {
  "Application": [
    {
      id: "app_kit_validation",
      name: "Đánh giá & Thử nghiệm Kit / Sinh phẩm mới",
      icon: "🔬",
      codePrefix: "APP-VAL",
      description: "Thẩm định độ nhạy (LOD), độ đặc hiệu, độ ổn định của Kit thử nghiệm PCR/ELISA/Test nhanh mới.",
      sampleObjectives: "Thử nghiệm trên 50 mẫu lâm sàng, xác định giới hạn phát hiện (LOD), so sánh tương quan với phương pháp chuẩn vàng.",
      defaultStages: [
        { name: "Tiếp nhận mẫu bệnh phẩm & Chuẩn bị hóa chất chứng (Controls)", estimatedDays: 2 },
        { name: "Thiết lập quy trình chạy PCR & Tối ưu nhiệt độ chu trình", estimatedDays: 3 },
        { name: "Chạy đánh giá độ nhạy (LOD), độ đặc hiệu và tính lặp lại", estimatedDays: 5 },
        { name: "Tổng hợp dữ liệu, phân tích biểu đồ & Lập báo cáo nghiệm thu kỹ thuật", estimatedDays: 2 }
      ]
    },
    {
      id: "app_hospital_demo",
      name: "Demo & Thử nghiệm thiết bị tại Bệnh viện / Viện",
      icon: "🏥",
      codePrefix: "APP-DEMO",
      description: "Điều phối chuyên viên và máy móc demo thực tế tại khoa xét nghiệm bệnh viện, hỗ trợ bác sĩ đánh giá lâm sàng.",
      sampleObjectives: "Demo hệ thống tách chiết tự động và Real-time PCR tại BV Chợ Rẫy, chuyển giao kỹ thuật cho 5 KTV khoa Vi sinh.",
      defaultStages: [
        { name: "Khảo sát hạ tầng phòng Lab & Nguồn điện/nước tại bệnh viện", estimatedDays: 1 },
        { name: "Vận chuyển, lắp đặt và hiệu chuẩn thiết bị demo", estimatedDays: 2 },
        { name: "Chạy thử mẫu nội kiểm & Đào tạo thao tác cho KTV bệnh viện", estimatedDays: 3 },
        { name: "Thu thập phản hồi, ký biên bản đánh giá thiết bị & Hoàn tất demo", estimatedDays: 2 }
      ]
    },
    {
      id: "app_protocol_opt",
      name: "Hiệu chuẩn & Tối ưu hóa Protocol xét nghiệm",
      icon: "⚗️",
      codePrefix: "APP-OPT",
      description: "Tối ưu hóa thời gian chạy, thành phần phản ứng MasterMix hoặc giảm thiểu tỉ lệ âm/dương tính giả.",
      sampleObjectives: "Rút ngắn thời gian chu trình PCR từ 90 phút xuống 55 phút mà vẫn giữ nguyên độ nhạy 100%.",
      defaultStages: [
        { name: "Rà soát thông số kỹ thuật và điểm nghẽn của quy trình hiện tại", estimatedDays: 2 },
        { name: "Thiết kế ma trận thử nghiệm biến thiên nhiệt độ và nồng độ mồi/dò", estimatedDays: 4 },
        { name: "Thực nghiệm kiểm chứng độ ổn định trên các dải nồng độ mẫu", estimatedDays: 5 },
        { name: "Ban hành SOP quy trình chuẩn đã tối ưu & Đào tạo nội bộ", estimatedDays: 2 }
      ]
    },
    {
      id: "app_tech_transfer",
      name: "Đào tạo & Chuyển giao công nghệ Lab cho khách hàng",
      icon: "🎓",
      codePrefix: "APP-TRN",
      description: "Chương trình huấn luyện chuyên sâu lý thuyết & thực hành sử dụng hệ thống thiết bị và sinh phẩm cho đối tác.",
      sampleObjectives: "Đào tạo lý thuyết và thực hành giải trình tự gen NGS cho nhóm nghiên cứu Viện Pasteur.",
      defaultStages: [
        { name: "Biên soạn tài liệu đào tạo lý thuyết và cẩm nang thao tác chuẩn (SOP)", estimatedDays: 3 },
        { name: "Tổ chức buổi giảng lý thuyết & Hướng dẫn an toàn sinh học", estimatedDays: 1 },
        { name: "Huấn luyện thực hành trực tiếp 'Cầm tay chỉ việc' trên thiết bị", estimatedDays: 3 },
        { name: "Kiểm tra đánh giá kỹ năng, cấp chứng nhận & Bàn giao tài liệu", estimatedDays: 1 }
      ]
    }
  ],

  "Kinh Doanh": [
    {
      id: "sales_tender_campaign",
      name: "Chiến dịch Thầu & Dự án Bệnh viện Trọng điểm",
      icon: "🏛️",
      codePrefix: "SALES-TND",
      description: "Chuẩn bị hồ sơ thầu, làm việc hãng lấy ủy quyền, xây dựng phương án giá và giải pháp kỹ thuật dự thầu.",
      sampleObjectives: "Tham gia và trúng gói thầu hóa chất sinh phẩm y tế năm 2026 tại Bệnh viện Bạch Mai, quy mô 15 tỷ VNĐ.",
      defaultStages: [
        { name: "Khảo sát danh mục HSMT, phân tích đối thủ & Lập phương án chào giá", estimatedDays: 3 },
        { name: "Làm việc với hãng sản xuất lấy MA, COA, Giấy ủy quyền & Cam kết kỹ thuật", estimatedDays: 5 },
        { name: "Hoàn thiện hồ sơ năng lực, bảo lãnh dự thầu & Đóng gói hồ sơ thầu", estimatedDays: 4 },
        { name: "Tham dự mở thầu, giải trình làm rõ kỹ thuật & Thương thảo hợp đồng", estimatedDays: 5 }
      ]
    },
    {
      id: "sales_key_account",
      name: "Phát triển Tài khoản VIP / Khách hàng Chiến lược",
      icon: "⭐",
      codePrefix: "SALES-VIP",
      description: "Kế hoạch thâm nhập sâu vào các bệnh viện đa khoa, trung tâm kiểm nghiệm lớn để mở rộng danh mục sản phẩm.",
      sampleObjectives: "Tiếp cận Ban Giám đốc và Trưởng khoa Xét nghiệm BV Đa khoa Tỉnh, ký kết biên bản hợp tác cung ứng trọn gói.",
      defaultStages: [
        { name: "Lập bản đồ chân dung khách hàng, người ra quyết định & Nhu cầu cấp thiết", estimatedDays: 2 },
        { name: "Gặp gỡ ban đầu, trình bày giải pháp toàn diện và danh mục sản phẩm chủ lực", estimatedDays: 3 },
        { name: "Phối hợp phòng Application đặt máy thử nghiệm mẫu tại khoa", estimatedDays: 7 },
        { name: "Xây dựng chính sách chiết khấu, đàm phán hợp đồng cung ứng định kỳ", estimatedDays: 4 }
      ]
    },
    {
      id: "sales_new_product_promo",
      name: "Chiến dịch Ra mắt Sản phẩm mới & Hội thảo Chuyên đề",
      icon: "🚀",
      codePrefix: "SALES-PRO",
      description: "Tổ chức hội thảo khoa học, gửi mẫu dùng thử cho các Key Opinion Leaders (KOLs) trong ngành y tế.",
      sampleObjectives: "Giới thiệu dòng kit tách chiết thế hệ mới đến 30 bệnh viện khu vực miền Nam, đạt 20 đơn đặt hàng thử.",
      defaultStages: [
        { name: "Xây dựng tài liệu Marketing, brochure kỹ thuật & Chính sách giá dùng thử", estimatedDays: 3 },
        { name: "Lên danh sách 50 bệnh viện/lab mục tiêu & Gửi thư mời tham gia chương trình", estimatedDays: 2 },
        { name: "Tổ chức Workshop giới thiệu sản phẩm & Bàn giao kit mẫu thử nghiệm", estimatedDays: 5 },
        { name: "Follow-up kết quả dùng thử từ khách hàng, chốt đơn hàng chính thức", estimatedDays: 7 }
      ]
    },
    {
      id: "sales_retention",
      name: "Chăm sóc & Tái kích hoạt Khách hàng Tiềm năng",
      icon: "🔄",
      codePrefix: "SALES-RET",
      description: "Rà soát nhóm khách hàng giảm đơn hoặc tạm dừng mua trong quý trước để giải quyết vướng mắc và khôi phục hợp tác.",
      sampleObjectives: "Tái kích hoạt 15 phòng xét nghiệm tư nhân đã tạm ngưng nhập hóa chất trong 3 tháng qua.",
      defaultStages: [
        { name: "Trích xuất danh sách khách hàng giảm doanh số & Phân tích nguyên nhân", estimatedDays: 2 },
        { name: "Thăm hỏi trực tiếp Trưởng phòng mua hàng/Kỹ thuật để lắng nghe phản hồi", estimatedDays: 4 },
        { name: "Đề xuất gói hỗ trợ kỹ thuật hoặc ưu đãi thanh toán linh hoạt", estimatedDays: 3 },
        { name: "Ký kết lại phụ lục cung ứng định kỳ & Giám sát tiến độ đặt hàng", estimatedDays: 5 }
      ]
    }
  ],

  "Kho & Vận Hành": [
    {
      id: "wh_stock_inventory",
      name: "Kiểm kê Định kỳ & Đối soát Toàn diện Kho Bãi",
      icon: "📦",
      codePrefix: "WH-INV",
      description: "Tổng kiểm kê định kỳ toàn bộ kho hàng thường và kho lạnh, đối soát số liệu thực tế với hệ thống quản lý.",
      sampleObjectives: "Kiểm kê 100% SKU hóa chất, vật tư tiêu hao; tỷ lệ sai lệch tồn kho dưới 0.05%, xử lý dứt điểm hàng cận date.",
      defaultStages: [
        { name: "Khóa sổ chứng từ nhập - xuất & In bảng biểu kiểm đếm vật lý", estimatedDays: 1 },
        { name: "Tổ chức các cặp kiểm đếm thực tế theo từng line kệ và tủ âm sâu", estimatedDays: 2 },
        { name: "Đối chiếu số liệu kiểm đếm thực tế với phần mềm, lập biên bản thừa/thiếu", estimatedDays: 1 },
        { name: "Lập đề xuất xử lý hàng cận date & Cập nhật số dư kho chính xác", estimatedDays: 1 }
      ]
    },
    {
      id: "wh_cold_chain_opt",
      name: "Tối ưu hóa & Chuẩn hóa Chuỗi Cung Ứng Lạnh (Cold Chain)",
      icon: "❄️",
      codePrefix: "WH-COLD",
      description: "Nâng cấp quy trình đóng gói đá gel, thiết bị ghi nhiệt độ (LogTag) và lộ trình giao nhận sinh phẩm nhạy cảm nhiệt độ.",
      sampleObjectives: "Đảm bảo 100% đơn hàng sinh phẩm bảo quản 2-8°C và -20°C duy trì nhiệt độ chuẩn trong suốt thời gian vận chuyển liên tỉnh.",
      defaultStages: [
        { name: "Đánh giá chất lượng thùng xốp cách nhiệt, túi giữ nhiệt và thời gian giữ nhiệt đá khô", estimatedDays: 2 },
        { name: "Kiểm định và hiệu chuẩn các thiết bị đo nhiệt độ tự động Datalogger", estimatedDays: 3 },
        { name: "Thử nghiệm vận chuyển đường dài giả lập để kiểm tra biến thiên nhiệt", estimatedDays: 4 },
        { name: "Ban hành quy chuẩn đóng hàng mới & Đào tạo cho nhân viên giao vận", estimatedDays: 2 }
      ]
    },
    {
      id: "wh_maintenance_calibration",
      name: "Bảo dưỡng, Hiệu chuẩn & Kiểm định Hệ thống Kho Lạnh",
      icon: "🛠️",
      codePrefix: "WH-MNT",
      description: "Bảo trì định kỳ máy lạnh công nghiệp, hệ thống cảnh báo nhiệt độ tự động qua SMS/Email và máy phát điện dự phòng.",
      sampleObjectives: "Bảo dưỡng 4 kho lạnh và 6 tủ âm sâu -80°C, kiểm định sensor nhiệt bởi Trung tâm đo lường chất lượng 3.",
      defaultStages: [
        { name: "Liên hệ đơn vị kiểm định đo lường & Lập lịch bảo trì kỹ thuật", estimatedDays: 2 },
        { name: "Bảo dưỡng hệ thống máy nén, giàn lạnh và kiểm tra ga lạnh", estimatedDays: 3 },
        { name: "Thử nghiệm kích hoạt hệ thống cảnh báo ngắt điện và máy phát tự động", estimatedDays: 1 },
        { name: "Nhận giấy chứng nhận kiểm định & Lưu hồ sơ thiết bị ISO", estimatedDays: 2 }
      ]
    },
    {
      id: "wh_layout_slotting",
      name: "Tái cấu trúc Sơ đồ Kho & Định vị Vị trí Lưu kho (Slotting)",
      icon: "🏗️",
      codePrefix: "WH-LAY",
      description: "Sắp xếp lại các khu vực hàng xuất nhập thường xuyên (hàng Fast-Moving), dán lại barcode vị trí kệ để rút ngắn thời gian nhặt hàng.",
      sampleObjectives: "Giảm 30% thời gian soạn hàng cho các đơn hàng bệnh viện khẩn cấp thông qua tối ưu vị trí kệ hàng.",
      defaultStages: [
        { name: "Phân tích tần suất xuất nhập hàng hóa (ABC Analysis)", estimatedDays: 2 },
        { name: "Thiết kế layout sơ đồ kho mới tối ưu luồng di chuyển xe nâng/xe kéo", estimatedDays: 3 },
        { name: "Thực hiện điều chuyển hàng hóa sang vị trí mới và gắn mã barcode kệ", estimatedDays: 4 },
        { name: "Cập nhật tọa độ vị trí hàng trên hệ thống phần mềm & Hướng dẫn nhân viên", estimatedDays: 1 }
      ]
    }
  ],

  "Cung Ứng": [
    {
      id: "proc_vendor_contract",
      name: "Đàm phán Hợp đồng Phân phối & Giá với Nhà Sản Xuất",
      icon: "🤝",
      codePrefix: "PROC-NEG",
      description: "Làm việc với các hãng quốc tế để chốt hạn mức tín dụng, mức chiết khấu độc quyền năm 2026 và cam kết hỗ trợ thầu.",
      sampleObjectives: "Ký kết thành công phụ lục hợp đồng phân phối độc quyền với Hãng tại Châu Âu, tăng chiết khấu thêm 5%.",
      defaultStages: [
        { name: "Phân tích doanh số quá khứ và dự báo nhu cầu thị trường trong nước", estimatedDays: 3 },
        { name: "Gửi đề xuất thương mại và lịch hẹn làm việc chính thức với Hãng", estimatedDays: 2 },
        { name: "Đàm phán điều khoản thanh toán LC/TT, thời gian lead-time và hỗ trợ giá", estimatedDays: 5 },
        { name: "Ký kết hợp đồng phân phối chính thức & Chốt bảng giá năm 2026", estimatedDays: 3 }
      ]
    },
    {
      id: "proc_import_clearance",
      name: "Kế hoạch Nhập khẩu & Thông quan Lô hàng Trọng điểm",
      icon: "🚢",
      codePrefix: "PROC-IMP",
      description: "Điều phối đơn hàng nhập khẩu số lượng lớn, chuẩn bị hồ sơ hải quan, giấy phép nhập khẩu Bộ Y Tế và kiểm dịch.",
      sampleObjectives: "Thông quan thành công lô container sinh phẩm và máy xét nghiệm từ Hàn Quốc trong vòng 48h kể từ khi cập cảng.",
      defaultStages: [
        { name: "Kiểm tra bộ chứng từ xuất nhập khẩu (Invoice, Packing List, CO, CQ, BL)", estimatedDays: 2 },
        { name: "Đăng ký kiểm tra chất lượng nhà nước / Giấy phép nhập khẩu BYT", estimatedDays: 3 },
        { name: "Truyền tờ khai hải quan điện tử & Phối hợp thông quan tại cửa khẩu", estimatedDays: 2 },
        { name: "Điều xe lạnh chuyên dụng vận chuyển hàng về kho TBRs an toàn", estimatedDays: 1 }
      ]
    },
    {
      id: "proc_supplier_audit",
      name: "Khảo sát, Đánh giá & Phát triển Nhà Cung Cấp Thay Thế",
      icon: "🔍",
      codePrefix: "PROC-AUD",
      description: "Tìm kiếm các nguồn cung cấp vật tư tiêu hao, hóa chất tương đương nhằm giảm thiểu rủi ro đứt gãy chuỗi cung ứng.",
      sampleObjectives: "Tìm kiếm và thẩm định chất lượng 3 nhà cung cấp ống nghiệm và đầu tip pipette thay thế với giá thấp hơn 12%.",
      defaultStages: [
        { name: "Tìm kiếm thông tin nhà sản xuất tiềm năng & Yêu cầu gửi báo giá, catalog", estimatedDays: 3 },
        { name: "Nhận mẫu thử nghiệm và chuyển phòng Application đánh giá kỹ thuật", estimatedDays: 5 },
        { name: "Đánh giá hồ sơ năng lực, chứng chỉ ISO 13485 và uy tín giao hàng", estimatedDays: 3 },
        { name: "Đưa vào danh sách nhà cung cấp đã phê duyệt (Approved Vendor List)", estimatedDays: 1 }
      ]
    },
    {
      id: "proc_safety_stock",
      name: "Kế hoạch Dự báo Nhu cầu & Tồn kho Dự phòng An toàn",
      icon: "📊",
      codePrefix: "PROC-STK",
      description: "Xây dựng định mức tồn kho tối thiểu (Min-Max) cho các mặt hàng thiết yếu mùa dịch hoặc các dự án thầu lớn.",
      sampleObjectives: "Thiết lập mức buffer stock cho 20 nhóm sinh phẩm bán chạy nhất, đảm bảo tỷ lệ sẵn sàng cung ứng đạt 99%.",
      defaultStages: [
        { name: "Thu thập số liệu dự báo bán hàng từ phòng Kinh Doanh theo từng quý", estimatedDays: 3 },
        { name: "Tính toán thời gian đặt hàng (Lead-time) và mức biến động tiêu thụ", estimatedDays: 2 },
        { name: "Xây dựng bảng hạn mức Min - Max cho từng nhóm sản phẩm trọng yếu", estimatedDays: 2 },
        { name: "Trình Ban Giám Đốc phê duyệt hạn mức vốn lưu động dự phòng hàng hóa", estimatedDays: 2 }
      ]
    }
  ],

  "Pháp Chế": [
    {
      id: "leg_license_reg",
      name: "Đăng ký Hồ sơ Lưu hành Trang thiết bị Y tế & IVD",
      icon: "📜",
      codePrefix: "LEG-LIC",
      description: "Chuẩn bị hồ sơ kỹ thuật chung (CSDT) và nộp thủ tục cấp số lưu hành loại C, D tại Bộ Y Tế.",
      sampleObjectives: "Nộp và được cấp phép lưu hành cho 2 hệ thống máy sinh học phân tử mới trước tháng 11/2026.",
      defaultStages: [
        { name: "Thu thập tài liệu kỹ thuật từ Hãng (CFS, ISO, IFU, Báo cáo lâm sàng)", estimatedDays: 5 },
        { name: "Dịch thuật công chứng và hợp pháp hóa lãnh sự hồ sơ giấy tờ", estimatedDays: 4 },
        { name: "Hoàn thiện CSDT và nộp hồ sơ trực tuyến trên Cổng thông tin BYT", estimatedDays: 3 },
        { name: "Theo dõi phản hồi chuyên gia thẩm định & Bổ sung hồ sơ nếu cần", estimatedDays: 10 }
      ]
    },
    {
      id: "leg_contract_review",
      name: "Rà soát Khung Pháp lý Hợp đồng Thầu & Đối tác Chiến lược",
      icon: "⚖️",
      codePrefix: "LEG-REV",
      description: "Thẩm tra các điều khoản rủi ro, bảo hành, thanh toán và phạt vi phạm trong hợp đồng cung ứng bệnh viện lớn.",
      sampleObjectives: "Rà soát và chuẩn hóa 100% hợp đồng thầu y tế của công ty, hạn chế tối đa rủi ro pháp lý và tranh chấp.",
      defaultStages: [
        { name: "Tiếp nhận dự thảo hợp đồng từ phòng Kinh Doanh/Bệnh viện", estimatedDays: 1 },
        { name: "Đối chiếu quy định Luật Đấu thầu, Luật Dân sự & Quy chế nội bộ", estimatedDays: 2 },
        { name: "Soạn thảo biên bản ý kiến pháp lý và đề xuất sửa đổi điều khoản bất lợi", estimatedDays: 2 },
        { name: "Tham gia đàm phán hợp đồng trực tiếp cùng các bên & Ký duyệt pháp lý", estimatedDays: 2 }
      ]
    }
  ]
};

export const PREDEFINED_APP_PROJECTS: any[] = [];

export const DEFAULT_WORKFLOW_TEMPLATES = [
  {
    id: "SALES_TO_APP",
    code: "SALES_TO_APP",
    name: "Sales ──► Application: Yêu cầu Demo & Thử mẫu",
    sourceDept: "Kinh Doanh",
    targetDept: "Application",
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
    id: "SALES_TO_WAREHOUSE",
    code: "SALES_TO_WAREHOUSE",
    name: "Sales ──► Kho: Yêu cầu Soạn & Xuất kho giao hàng",
    sourceDept: "Kinh Doanh",
    targetDept: "Kho & Vận Hành",
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
    id: "TO_PROCUREMENT",
    code: "TO_PROCUREMENT",
    name: "Kho / Sales ──► Cung Ứng: Đề xuất mua hàng (PR)",
    sourceDept: "Kho & Vận Hành",
    targetDept: "Cung Ứng",
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
    id: "APP_TO_WAREHOUSE",
    code: "APP_TO_WAREHOUSE",
    name: "App ──► Kho: Đề nghị xuất vật tư & Mượn máy demo",
    sourceDept: "Application",
    targetDept: "Kho & Vận Hành",
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
    id: "SALES_TO_LEGAL",
    code: "SALES_TO_LEGAL",
    name: "Sales ──► Pháp Chế: Thẩm định hợp đồng & Rà soát hồ sơ thầu",
    sourceDept: "Kinh Doanh",
    targetDept: "Pháp Chế",
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

export const WORKFLOW_TYPES = DEFAULT_WORKFLOW_TEMPLATES;

export function mergeWithDefaultWorkflowTemplates(dbTemplates?: any[]): any[] {
  const dbList = Array.isArray(dbTemplates) ? dbTemplates : [];
  const defaultCodes = new Set(DEFAULT_WORKFLOW_TEMPLATES.map((d) => String(d.code || d.id).toUpperCase()));
  const mergedDefaults = DEFAULT_WORKFLOW_TEMPLATES.map((def) => {
    const defCode = String(def.code || def.id).toUpperCase();
    const matchedDb = dbList.find((t) => String(t.code || "").toUpperCase() === defCode);
    if (matchedDb) {
      return {
        ...def,
        ...matchedDb,
        sourceDept: matchedDb.source_dept || matchedDb.sourceDept || def.sourceDept,
        targetDept: matchedDb.target_dept || matchedDb.targetDept || def.targetDept,
        steps: Array.isArray(matchedDb.steps) && matchedDb.steps.length > 0 ? matchedDb.steps : def.steps
      };
    }
    return def;
  });
  const customTemplates = dbList.filter((t) => !defaultCodes.has(String(t.code || "").toUpperCase()));
  return [...mergedDefaults, ...customTemplates];
}

export const getWorkflowIcon = (iconName?: string) => {
  switch (iconName) {
    case "FlaskConical":
      return FlaskConical;
    case "Package":
      return Package;
    case "ShoppingCart":
      return ShoppingCart;
    case "ShieldCheck":
      return ShieldCheck;
    case "Briefcase":
      return Briefcase;
    case "Activity":
      return Activity;
    case "Building2":
      return Building2;
    case "Layers":
      return Layers;
    case "Target":
      return Target;
    case "FileText":
      return FileText;
    default:
      return ArrowRight;
  }
};


interface PersonnelItem {
  id?: number | string;
  employee_code?: string;
  full_name: string;
  department?: string;
  position?: string;
}

interface SearchablePersonnelSelectProps {
  value: string;
  onChange: (val: string) => void;
  personnelList: PersonnelItem[];
  filterDepartment?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}

const SearchablePersonnelSelect: React.FC<SearchablePersonnelSelectProps> = ({
  value,
  onChange,
  personnelList,
  filterDepartment,
  placeholder = "Chọn nhân sự...",
  disabled = false,
  required = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const filtered = useMemo(() => {
    let list = personnelList;
    if (filterDepartment && filterDepartment !== "all") {
      list = list.filter(p => isSameWorkspaceDept(p.department, filterDepartment));
    }
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(p => 
      p.full_name.toLowerCase().includes(q) ||
      (p.employee_code && p.employee_code.toLowerCase().includes(q)) ||
      (p.position && p.position.toLowerCase().includes(q)) ||
      (p.department && p.department.toLowerCase().includes(q))
    );
  }, [personnelList, filterDepartment, search]);

  const selectedItem = useMemo(() => {
    return personnelList.find(p => p.full_name === value);
  }, [personnelList, value]);

  if (disabled) {
    return (
      <input
        type="text"
        disabled
        value={value}
        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-500 font-bold cursor-not-allowed text-xs"
      />
    );
  }

  return (
    <div ref={containerRef} className="relative w-full text-xs">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white cursor-pointer hover:border-indigo-500 transition-colors"
      >
        <div className="flex items-center gap-2 truncate">
          <User className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
          {value ? (
            <span className="font-bold truncate text-slate-900 dark:text-white">
              {value} {selectedItem?.position ? `(${selectedItem.position})` : ""}
            </span>
          ) : (
            <span className="text-slate-400 font-medium">{placeholder}</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {value && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              className="p-0.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3 h-3" />
            </button>
          )}
          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
        </div>
      </div>

      {isOpen && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2 bg-slate-50/50 dark:bg-slate-950/50">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              type="text"
              autoFocus
              placeholder="Gõ tìm tên, mã NV, chức vụ..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent outline-none text-xs text-slate-900 dark:text-white placeholder-slate-400"
            />
          </div>

          <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
            {filtered.length === 0 ? (
              <div className="p-3 text-center text-slate-400 text-[11px]">
                Không tìm thấy nhân sự trong danh sách
                {search && (
                  <button
                    type="button"
                    onClick={() => {
                      onChange(search.trim());
                      setIsOpen(false);
                      setSearch("");
                    }}
                    className="block mx-auto mt-1.5 text-indigo-500 hover:underline font-semibold"
                  >
                    Dùng tên: "{search.trim()}"
                  </button>
                )}
              </div>
            ) : (
              filtered.map((p) => {
                const isSelected = p.full_name === value;
                return (
                  <div
                    key={p.employee_code || p.full_name}
                    onClick={() => {
                      onChange(p.full_name);
                      setIsOpen(false);
                      setSearch("");
                    }}
                    className={`p-2.5 flex items-center justify-between hover:bg-indigo-50 dark:hover:bg-indigo-950/40 cursor-pointer transition-colors ${
                      isSelected ? "bg-indigo-50/80 dark:bg-indigo-950/60" : ""
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-900 dark:text-white truncate">
                          {p.full_name}
                        </span>
                        {p.employee_code && (
                          <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                            {p.employee_code}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {p.position || "Nhân sự TBRs"} • {p.department || "TBR"}
                      </div>
                    </div>
                    {isSelected && (
                      <Check className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const DEFAULT_CUSTOMERS_LIST: { name: string; customer_code?: string; [k: string]: any }[] = [];

export const DEFAULT_PRODUCTS_LIST: { name: string; code?: string; [k: string]: any }[] = [];

export const ALL_DEPARTMENTS_OPTIONS = [
  { value: "Kinh Doanh", label: "Kinh Doanh" },
  { value: "Application", label: "Application (Kỹ Thuật & Ứng Dụng)" },
  { value: "Kho & Vận Hành", label: "Kho & Vận Hành" },
  { value: "Cung Ứng", label: "Mua Hàng & Cung Ứng" },
  { value: "Pháp Chế", label: "Pháp Chế & Hợp Đồng Thầu" },
  { value: "Kế Toán", label: "Kế Toán - Tài Chính" },
  { value: "Ban Giám Đốc", label: "Ban Giám Đốc (BOD)" },
  { value: "Kỹ Thuật", label: "Kỹ Thuật Thiết Bị" },
  { value: "QA / QC", label: "Đảm Bảo Chất Lượng QA/QC" },
  { value: "Marketing", label: "Tiếp Thị & Marketing" },
  { value: "Hành Chính Nhân Sự", label: "Hành Chính Nhân Sự" }
];

interface SearchableCustomerSelectProps {
  value: string;
  onChange: (val: string) => void;
  customerList?: any[];
  placeholder?: string;
  disabled?: boolean;
}

const SearchableCustomerSelect: React.FC<SearchableCustomerSelectProps> = ({
  value,
  onChange,
  customerList = [],
  placeholder = "Chọn hoặc gõ tìm Bệnh viện / Phòng khám...",
  disabled = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const combinedList = useMemo(() => {
    const merged = [...customerList];
    DEFAULT_CUSTOMERS_LIST.forEach(dc => {
      if (!merged.some(c => (c.name || "").toLowerCase() === dc.name.toLowerCase() || (c.customer_code && c.customer_code === dc.customer_code))) {
        merged.push(dc);
      }
    });
    return merged;
  }, [customerList]);

  const filtered = useMemo(() => {
    if (!search.trim()) return combinedList;
    const q = search.toLowerCase();
    return combinedList.filter(c =>
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.customer_code && c.customer_code.toLowerCase().includes(q)) ||
      (c.address && c.address.toLowerCase().includes(q))
    );
  }, [combinedList, search]);

  if (disabled) {
    return (
      <input
        type="text"
        disabled
        value={value}
        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-500 font-bold cursor-not-allowed text-xs"
      />
    );
  }

  return (
    <div ref={containerRef} className="relative w-full text-xs">
      <div className="relative flex items-center">
        <div className="absolute left-3 pointer-events-none text-indigo-500">
          <Building2 className="w-3.5 h-3.5" />
        </div>
        <input
          type="text"
          value={isOpen ? search : (value || "")}
          onChange={(e) => {
            setSearch(e.target.value);
            onChange(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => {
            setSearch(value || "");
            setIsOpen(true);
          }}
          onKeyDown={(e) => {
            // Enter trong ô tìm: chọn kết quả đầu tiên, KHÔNG gửi form đang nhập
            if (e.key === "Enter") {
              e.preventDefault();
              if (isOpen && search.trim() && filtered.length > 0) onChange(filtered[0].name);
              setIsOpen(false);
              setSearch("");
            }
          }}
          placeholder={placeholder}
          className="w-full pl-9 pr-16 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all placeholder-slate-400"
        />
        <div className="absolute right-2 flex items-center gap-1">
          {value && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
                setSearch("");
              }}
              className="p-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
              title="Xóa lựa chọn"
            >
              <X className="w-3 h-3" />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setIsOpen(!isOpen);
              if (!isOpen) setSearch(value || "");
            }}
            className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
            title="Mở danh sách"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl overflow-hidden max-h-60 overflow-y-auto">
          <div className="p-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/70 flex items-center justify-between text-[11px] text-slate-500 font-bold">
            <span>Danh sách Khách hàng / Bệnh viện ({filtered.length})</span>
            <span className="text-[10px] text-indigo-500 font-normal">Gõ để lọc hoặc chọn</span>
          </div>
          {filtered.length === 0 ? (
            <div className="p-3 text-center text-slate-400 text-xs">
              <p>Chưa có viện này trong danh mục</p>
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    onChange(search.trim());
                    setIsOpen(false);
                  }}
                  className="mt-1 text-xs text-indigo-500 font-bold hover:underline cursor-pointer"
                >
                  Sử dụng: "{search.trim()}"
                </button>
              )}
            </div>
          ) : (
            filtered.map((c: any) => {
              const isSelected = c.name === value;
              return (
                <div
                  key={c.id || c.customer_code || c.name}
                  onClick={() => {
                    onChange(c.name);
                    setIsOpen(false);
                    setSearch("");
                  }}
                  className={`p-2.5 flex items-center justify-between hover:bg-indigo-50 dark:hover:bg-indigo-950/40 cursor-pointer transition-colors border-b border-slate-100/50 dark:border-slate-800/40 last:border-0 ${
                    isSelected ? "bg-indigo-50/80 dark:bg-indigo-950/60" : ""
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-slate-900 dark:text-white truncate">
                        {c.name}
                      </span>
                      {c.customer_code && (
                        <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold">
                          {c.customer_code}
                        </span>
                      )}
                    </div>
                    {c.address && (
                      <div className="text-[10px] text-slate-400 truncate mt-0.5">
                        {c.address}
                      </div>
                    )}
                  </div>
                  {isSelected && (
                    <Check className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

interface SearchableProductSelectProps {
  value: string;
  onChange: (val: string) => void;
  productList?: any[];
  placeholder?: string;
  disabled?: boolean;
}

const SearchableProductSelect: React.FC<SearchableProductSelectProps> = ({
  value,
  onChange,
  productList = [],
  placeholder = "Chọn hoặc gõ tìm Sản phẩm / Kit / Thiết bị...",
  disabled = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const combinedList = useMemo(() => {
    const merged = [...productList];
    DEFAULT_PRODUCTS_LIST.forEach(dp => {
      if (!merged.some(p => (p.name || "").toLowerCase() === dp.name.toLowerCase() || (p.code && p.code === dp.code))) {
        merged.push(dp);
      }
    });
    return merged;
  }, [productList]);

  const filtered = useMemo(() => {
    if (!search.trim()) return combinedList;
    const q = search.toLowerCase();
    return combinedList.filter(p =>
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p.code && p.code.toLowerCase().includes(q)) ||
      (p.category && p.category.toLowerCase().includes(q))
    );
  }, [combinedList, search]);

  if (disabled) {
    return (
      <input
        type="text"
        disabled
        value={value}
        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-500 font-bold cursor-not-allowed text-xs"
      />
    );
  }

  return (
    <div ref={containerRef} className="relative w-full text-xs">
      <div className="relative flex items-center">
        <div className="absolute left-3 pointer-events-none text-purple-500">
          <Package className="w-3.5 h-3.5" />
        </div>
        <input
          type="text"
          value={isOpen ? search : (value || "")}
          onChange={(e) => {
            setSearch(e.target.value);
            onChange(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => {
            setSearch(value || "");
            setIsOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (isOpen && search.trim() && filtered.length > 0) {
                const p: any = filtered[0];
                onChange(p.name ? `${p.name} (${p.code})` : p.code);
              }
              setIsOpen(false);
              setSearch("");
            }
          }}
          placeholder={placeholder}
          className="w-full pl-9 pr-16 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all placeholder-slate-400"
        />
        <div className="absolute right-2 flex items-center gap-1">
          {value && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
                setSearch("");
              }}
              className="p-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
              title="Xóa lựa chọn"
            >
              <X className="w-3 h-3" />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setIsOpen(!isOpen);
              if (!isOpen) setSearch(value || "");
            }}
            className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
            title="Mở danh sách"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl overflow-hidden max-h-60 overflow-y-auto">
          <div className="p-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/70 flex items-center justify-between text-[11px] text-slate-500 font-bold">
            <span>Danh mục Sản phẩm / Thiết bị ({filtered.length})</span>
            <span className="text-[10px] text-purple-500 font-normal">Gõ để lọc hoặc chọn</span>
          </div>
          {filtered.length === 0 ? (
            <div className="p-3 text-center text-slate-400 text-xs">
              <p>Chưa có sản phẩm này trong danh mục</p>
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    onChange(search.trim());
                    setIsOpen(false);
                  }}
                  className="mt-1 text-xs text-purple-500 font-bold hover:underline cursor-pointer"
                >
                  Sử dụng: "{search.trim()}"
                </button>
              )}
            </div>
          ) : (
            filtered.map((p: any) => {
              const isSelected = p.name === value || (p.code && value.includes(p.code));
              return (
                <div
                  key={p.code || p.id || p.name}
                  onClick={() => {
                    onChange(p.name ? `${p.name} (${p.code})` : p.code);
                    setIsOpen(false);
                    setSearch("");
                  }}
                  className={`p-2.5 flex items-center justify-between hover:bg-purple-50 dark:hover:bg-purple-950/40 cursor-pointer transition-colors border-b border-slate-100/50 dark:border-slate-800/40 last:border-0 ${
                    isSelected ? "bg-purple-50/80 dark:bg-purple-950/60" : ""
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-slate-900 dark:text-white truncate">
                        {p.name}
                      </span>
                      {p.code && (
                        <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 font-bold">
                          {p.code}
                        </span>
                      )}
                    </div>
                    {p.category && (
                      <div className="text-[10px] text-slate-400 truncate mt-0.5">
                        Phân loại: {p.category} {p.unit ? `• Đơn vị: ${p.unit}` : ""}
                      </div>
                    )}
                  </div>
                  {isSelected && (
                    <Check className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

interface DepartmentDropdownSelectProps {
  value: string;
  onChange: (val: string) => void;
}

const DepartmentDropdownSelect: React.FC<DepartmentDropdownSelectProps> = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const currentOpt = ALL_DEPARTMENTS_OPTIONS.find(o => o.value === value) || {
    value,
    label: value || "Chọn phòng ban"
  };

  return (
    <div ref={containerRef} className="relative w-full text-xs">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold hover:border-indigo-500 transition-all text-left shadow-2xs cursor-pointer"
      >
        <span className="truncate">{currentOpt.label}</span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" />
      </button>

      {isOpen && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl overflow-hidden max-h-56 overflow-y-auto">
          <div className="p-1.5 border-b border-slate-100 dark:border-slate-800 text-[10px] text-slate-400 font-bold bg-slate-50/70 dark:bg-slate-950/70">
            Chọn Phòng Ban Phụ Trách
          </div>
          {ALL_DEPARTMENTS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              className={`w-full text-left p-2.5 hover:bg-indigo-50 dark:hover:bg-slate-800 flex items-center justify-between transition-colors text-xs border-b border-slate-100/50 dark:border-slate-800/40 last:border-0 cursor-pointer ${
                opt.value === value ? "bg-indigo-50/80 dark:bg-indigo-950/60 font-bold text-indigo-600 dark:text-indigo-400" : "text-slate-800 dark:text-slate-200"
              }`}
            >
              <span className="truncate">{opt.label}</span>
              {opt.value === value && <Check className="w-3.5 h-3.5 text-indigo-500 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const renderWorkflowResultSummary = (summary: any) => {
  if (!summary) return null;

  let itemsList: any[] | null = null;
  let textNote = "";

  if (typeof summary === "string") {
    const trimmed = summary.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          itemsList = parsed;
        } else if (parsed && typeof parsed === "object") {
          if (Array.isArray(parsed.items)) {
            itemsList = parsed.items;
            textNote = parsed.note || parsed.summary || "";
          }
        }
      } catch (e) {
        // text fallback
      }
    }
    if (!itemsList) {
      textNote = summary;
    }
  } else if (Array.isArray(summary)) {
    itemsList = summary;
  }

  // If it's a parsed list of items (e.g. from Purchase Request -> PO conversion)
  if (itemsList && itemsList.length > 0) {
    const totalItems = itemsList.length;
    const poItems = itemsList.filter((it: any) => it.po_code || it.status === "CONVERTED");
    const isFullPO = poItems.length === totalItems;
    const isPartialPO = poItems.length > 0 && !isFullPO;

    // Collect unique PO codes
    const uniquePOCodes = Array.from(new Set(itemsList.map((it: any) => it.po_code).filter(Boolean)));

    return (
      <div className="space-y-2 mt-1">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-slate-800 dark:text-slate-100">
              Danh mục mặt hàng đề xuất:
            </span>
            {isFullPO ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                ✅ Đã hoàn tất lên PO ({poItems.length}/{totalItems} mã)
              </span>
            ) : isPartialPO ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                ⚡ Đã lên PO 1 phần ({poItems.length}/{totalItems} mã)
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
                ⏳ Chờ xử lý PO ({totalItems} mã)
              </span>
            )}

            {uniquePOCodes.length > 0 && (
              <span className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center gap-1">
                <span>• Mã PO:</span>
                {uniquePOCodes.map((code: any) => (
                  <span key={code} className="font-mono font-bold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/60 px-1.5 py-0.2 rounded border border-orange-200 dark:border-orange-800">
                    {code}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>

        {/* Beautiful Table/List of items */}
        <div className="bg-white/90 dark:bg-slate-900/90 rounded-xl border border-emerald-200/80 dark:border-emerald-800/80 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800 shadow-2xs">
          {itemsList.map((it: any, idx: number) => {
            const hasPO = Boolean(it.po_code || it.status === "CONVERTED");
            return (
              <div key={idx} className="p-2 flex flex-wrap items-center justify-between gap-2 text-[11px] hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                  <span className="font-mono font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[10px] border border-slate-200 dark:border-slate-700 shrink-0">
                    {it.product_code || `#${idx + 1}`}
                  </span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {it.product_name}
                  </span>
                  {it.specification && (
                    <span className="text-[10px] text-slate-500 italic hidden sm:inline">
                      ({it.specification})
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono font-bold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/50 px-2 py-0.5 rounded-md border border-orange-200 dark:border-orange-800">
                    x{it.quantity} {it.unit || ""}
                  </span>
                  {hasPO ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      <span>✓ Đã tạo PO</span>
                      {it.po_code && <span className="font-mono font-bold text-emerald-800 dark:text-emerald-200">({it.po_code})</span>}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                      ⏳ Chưa tạo PO
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {textNote && (
          <p className="text-slate-700 dark:text-slate-300 text-xs italic mt-1 bg-white/50 dark:bg-slate-900/50 p-1.5 rounded-lg border border-slate-100 dark:border-slate-800">
            {textNote}
          </p>
        )}
      </div>
    );
  }

  // Plain text representation
  return (
    <p className="mt-1 text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-line">
      {textNote || String(summary)}
    </p>
  );
};

export const UnifiedWorkspace: React.FC = () => {
  const { showToast, notifyActivity } = useNotification();
  const { user, can } = useAuth();
  // Tạo / sửa / xóa quy trình mẫu: Quản trị viên hoặc người được cấp quyền "Quản lý quy trình phối hợp mẫu"
  const canManageTemplates = Boolean(can && can("workspace.manage_templates"));
  const warnNoTemplatePermission = () =>
    showToast("Bạn chưa có quyền tạo / sửa quy trình mẫu. Nhờ Quản trị viên cấp quyền \"Quản lý quy trình phối hợp mẫu\" (Cấu hình → Phân quyền) hoặc gửi nội dung quy trình để Quản trị viên tạo.", "warning");

  // Role-Based Access Control strictly according to the logged-in user:
  // - Ban Giám Đốc (admin / director): Full company-wide access (4 departments)
  // - Trưởng Phòng (head / manager): Department-wide access
  // - Nhân Viên (staff / specialist): Strictly personal view & creation
  const userRole = (user?.role || "").toLowerCase();
  const rawUserDept = (user as any)?.department || "Kinh Doanh";
  const userDept = normalizeWorkspaceDept(rawUserDept) || "Kinh Doanh";
  const currentStaffName = user?.name || (user as any)?.full_name || "Cán bộ TBRs";

  const isDirector = useMemo(() => {
    return userRole === "admin" || userRole.includes("director") || userRole.includes("giám đốc") || rawUserDept.toLowerCase().includes("giám đốc");
  }, [userRole, rawUserDept]);

  const isManager = useMemo(() => {
    if (isDirector) return false;
    return userRole.includes("head") || userRole.includes("lead") || userRole.includes("manager") || userRole.includes("trưởng phòng") || userRole.includes("phó phòng");
  }, [isDirector, userRole]);

  const isStaff = !isDirector && !isManager;
  const rolePerspective = isDirector ? "director" : isManager ? "manager" : "staff";
  const managerDept = userDept && userDept !== "Ban Giám Đốc" ? userDept : "Application";

  const [activeSubTab, setActiveSubTab] = useState<"tasks" | "workflows" | "planner" | "daily" | "analytics">("tasks");
  const [selectedDept, setSelectedDept] = useState<string>("all");
  const [plannerView, setPlannerView] = useState<"calendar" | "lab_projects" | "sales_targets">("calendar");
  const [loading, setLoading] = useState(true);

  // Automatically initialize department according to user role
  useEffect(() => {
    if (isManager && userDept && userDept !== "Ban Giám Đốc") {
      setSelectedDept(userDept);
    } else if (isDirector) {
      setSelectedDept("all");
    } else {
      setSelectedDept(userDept && userDept !== "Ban Giám Đốc" ? userDept : "all");
    }
  }, [isDirector, isManager, userDept]);

  useEffect(() => {
    setSelectedAssignee("all");
  }, [selectedDept]);

  // Core Data Lists
  const [tasks, setTasks] = useState<any[]>([]);
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [dailyLogs, setDailyLogs] = useState<any[]>([]);
  const [personnelList, setPersonnelList] = useState<any[]>([]);
  const [customerList, setCustomerList] = useState<any[]>(DEFAULT_CUSTOMERS_LIST);
  const [productList, setProductList] = useState<any[]>(DEFAULT_PRODUCTS_LIST);

  // Task Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedAssignee, setSelectedAssignee] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"kanban" | "table">("kanban");

  // Modals for Task & Workflow
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isWorkflowModalOpen, setIsWorkflowModalOpen] = useState(false);
  const [isWorkflowDetailModalOpen, setIsWorkflowDetailModalOpen] = useState(false);
  const [selectedWorkflowDetail, setSelectedWorkflowDetail] = useState<any>(null);
  const [workflowCommentText, setWorkflowCommentText] = useState("");
  const [workflowCommentAttachments, setWorkflowCommentAttachments] = useState<any[]>([]);

  // Modals for Recording Workflow Results & Attachments
  const [isRecordResultModalOpen, setIsRecordResultModalOpen] = useState(false);
  const [selectedWorkflowForRecord, setSelectedWorkflowForRecord] = useState<any>(null);
  const [recordResultForm, setRecordResultForm] = useState({
    results_summary: "",
    status: "REVIEW",
    reporter_name: "",
    note: "",
    attachments: [] as Array<{ name: string; url: string; size?: number; type?: string; uploaded_at?: string }>
  });
  const [isUploading, setIsUploading] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<{ url: string; name?: string; type?: string } | null>(null);

  // Modals for Planner Tab
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [scheduleForm, setScheduleForm] = useState<{
    day: string;
    date?: string;
    time: string;
    category: string;
    title: string;
    actor: string;
    location: string;
    attachments?: Array<{ name: string; url: string; size?: number; type?: string; uploaded_at?: string }>;
  }>({
    day: "Thứ 2",
    time: "08:30",
    category: "Application",
    title: "",
    actor: "",
    location: "BV Chợ Rẫy",
    attachments: []
  });
  const [weeklySchedule, setWeeklySchedule] = useState<any[]>([]);
  // Lịch tuần theo NGÀY THẬT: tuần đang xem (0 = tuần này), lịch đang sửa
  const [weekOffset, setWeekOffset] = useState(0);
  const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null);
  const viewedWeek = useMemo(() => {
    const base = new Date(todayVN() + "T00:00:00");
    const dow = (base.getDay() + 6) % 7; // 0 = Thứ 2
    const monday = new Date(base);
    monday.setDate(base.getDate() - dow + weekOffset * 7);
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const names = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
    const days = names.map((name, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return { name, date: iso(d), label: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}` };
    });
    // Số tuần ISO-8601
    const t = new Date(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3));
    const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    const weekNo = 1 + Math.round(((t.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
    return { days, weekNo, year: t.getUTCFullYear() };
  }, [weekOffset]);
  // Lịch cũ chỉ lưu "Thứ 2"... (không có ngày): hiển thị ở tuần hiện tại
  const scheduleOnDay = (s: any, day: { name: string; date: string }) =>
    s.date ? String(s.date).slice(0, 10) === day.date : (weekOffset === 0 && s.day === day.name);
  const openScheduleForm = (date?: string, item?: any) => {
    const defaultActor = selectedAssignee !== "all" ? selectedAssignee : (departmentStaffList[0]?.full_name || currentStaffName);
    const defaultCategory = rolePerspective === "manager" ? managerDept : (selectedDept === "all" ? "Application" : selectedDept);
    const today = todayVN();
    const pick = date || (viewedWeek.days.some(d => d.date === today) ? today : viewedWeek.days[0].date);
    if (item) {
      const itemDate = item.date ? String(item.date).slice(0, 10) : (viewedWeek.days.find(d => d.name === item.day)?.date || pick);
      setEditingScheduleId(item.id);
      setScheduleForm({
        day: item.day, date: itemDate, time: item.time || "08:30", category: item.category || defaultCategory,
        title: item.title || "", actor: item.actor || "", location: item.location || "", attachments: item.attachments || []
      });
    } else {
      setEditingScheduleId(null);
      setScheduleForm({
        day: viewedWeek.days.find(d => d.date === pick)?.name || "Thứ 2", date: pick, time: "08:30",
        category: defaultCategory, title: "", actor: defaultActor, location: "", attachments: []
      });
    }
    setIsScheduleModalOpen(true);
  };

  const [isLabProjectModalOpen, setIsLabProjectModalOpen] = useState(false);
  const [editingThematicId, setEditingThematicId] = useState<string | null>(null);
  const [thematicFilterType, setThematicFilterType] = useState<string>("all");
  const [labProjects, setLabProjects] = useState<any[]>([]);
  const [labProjectForm, setLabProjectForm] = useState({
    id: "APP-VAL-01",
    name: "",
    dept: "Application",
    typeId: "app_kit_validation",
    typeName: "Đánh giá & Thử nghiệm Kit / Sinh phẩm mới",
    lead: "",
    collaborators: [] as string[],
    startDate: "",
    endDate: "",
    slot: "Toàn thời gian (Theo tiến trình)",
    priority: "Cao" as "Cao" | "Trung bình" | "Bình thường",
    status: "Active" as "Planning" | "Active" | "Review" | "Completed",
    tasksCount: 0,
    budget: "",
    description: "",
    stages: [] as Array<{
      id: string;
      name: string;
      status: "pending" | "in_progress" | "completed";
      assignee?: string;
      estimatedDays?: number;
    }>
  });

  const [isSalesTargetModalOpen, setIsSalesTargetModalOpen] = useState(false);
  const [salesTargets, setSalesTargets] = useState<any[]>([]);
  const [salesTargetForm, setSalesTargetForm] = useState({
    customer: "",
    amount: "2.5 Tỷ VNĐ",
    quarter: "Q4/2026",
    lead: "",
    description: "",
    stage: "Đang chào giá & Demo"
  });

  // Task Form State
  const [taskForm, setTaskForm] = useState({
    id: null as any,
    title: "",
    department: "Kinh Doanh",
    task_category: "Chăm sóc KH",
    assignee_name: "",
    customer_name: "",
    priority: "MEDIUM",
    status: "TODO",
    deadline: todayVN(),
    description: "",
    result: "",
    attachments: [] as any[]
  });

  const openEditTask = (t: any) => {
    const atts = Array.isArray(t.attachments)
      ? t.attachments
      : typeof t.attachments === "string"
      ? JSON.parse(t.attachments || "[]")
      : [];
    setTaskForm({
      ...t,
      result: t.result || "",
      attachments: atts
    });
    setIsTaskModalOpen(true);
  };

  // Workflow Form State
  const [wfForm, setWfForm] = useState<{
    workflow_type: string;
    title: string;
    priority: string;
    requester_name: string;
    requester_dept: string;
    assignee_name: string;
    target_dept: string;
    customer_name: string;
    product_info: string;
    due_date: string;
    description: string;
    steps?: any[];
  }>({
    workflow_type: "SALES_TO_APP",
    title: "",
    priority: "HIGH",
    requester_name: "",
    requester_dept: "Kinh Doanh",
    assignee_name: "",
    target_dept: "Application",
    customer_name: "",
    product_info: "",
    due_date: toVNDateString(new Date(Date.now() + 5 * 86400000)),
    description: "",
    steps: []
  });

  // Dynamic Workflow Templates & Custom Template Builder
  const [workflowTemplates, setWorkflowTemplates] = useState<any[]>(DEFAULT_WORKFLOW_TEMPLATES);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [templateForm, setTemplateForm] = useState<any>({
    id: null,
    code: "",
    name: "",
    source_dept: "Kinh Doanh",
    target_dept: "Application",
    icon: "FlaskConical",
    description: "",
    sla_days: 3,
    steps: [
      {
        step_index: 0,
        title: "Tiếp nhận & Thẩm định yêu cầu",
        dept: "Application",
        assignee_name: "",
        sla_hours: 24,
        deliverables: "Xác nhận tính khả thi & phân công nhân sự"
      },
      {
        step_index: 1,
        title: "Triển khai thực hiện chuyên môn",
        dept: "Application",
        assignee_name: "",
        sla_hours: 48,
        deliverables: "Báo cáo tiến độ / kết quả thử nghiệm"
      },
      {
        step_index: 2,
        title: "Nghiệm thu & Bàn giao kết quả",
        dept: "Kinh Doanh",
        assignee_name: "",
        sla_hours: 24,
        deliverables: "Biên bản bàn giao và xác nhận hoàn tất"
      }
    ]
  });

  // Stage-Gate Step Advance Modal State
  const [isAdvanceStepModalOpen, setIsAdvanceStepModalOpen] = useState(false);
  const [advanceStepData, setAdvanceStepData] = useState<{
    workflow: any;
    stepIndex: number;
    currentStep: any;
    nextStep: any | null;
    stepResult: string;
    nextAssigneeName: string;
    attachments: any[];
  }>({
    workflow: null,
    stepIndex: 0,
    currentStep: null,
    nextStep: null,
    stepResult: "",
    nextAssigneeName: "",
    attachments: []
  });

  // Daily Log State & Workflow Management
  const getInitialDailyDay = () => {
    const dayIndex = new Date().getDay();
    const map = ["Thứ 2", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
    return map[dayIndex] || "Thứ 2";
  };

  const [selectedDailyDay, setSelectedDailyDay] = useState<string>(getInitialDailyDay());
  const [selectedDailyStaff, setSelectedDailyStaff] = useState<string>("");
  const [dailyPlanItems, setDailyPlanItems] = useState<Array<{
    id: string | number;
    title: string;
    source: "schedule" | "task" | "extra";
    category?: string;
    location?: string;
    status: "completed" | "partial" | "pending";
    result: string;
    issues: string;
    work_hours: number;
    proportionality: "optimal" | "balanced" | "suboptimal" | "poor";
  }>>([]);
  const [dailyTotalHours, setDailyTotalHours] = useState<number>(8);
  const [dailyProportionalityScore, setDailyProportionalityScore] = useState<string>("Tương xứng & Đạt chuẩn");
  const [dailyPerformanceRating, setDailyPerformanceRating] = useState<string>("Tốt");
  const [dailyTomorrowPlan, setDailyTomorrowPlan] = useState<string>("");
  const [feedbackInput, setFeedbackInput] = useState<Record<number, { managerText?: string; staffText?: string }>>({});
  const [dailyForm, setDailyForm] = useState({
    department: "Kinh Doanh",
    employee_name: "",
    work_content: "",
    result: "",
    issues: "",
    next_day_plan: "",
    related_task_code: ""
  });

  // Fetch Data from API
  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/workflows?action=overview");
      const data = await res.json();
      if (data) {
        setTasks(data.tasks || []);
        setWorkflows(data.workflows || []);
        setDailyLogs(data.daily || []);
        if (data.personnel) setPersonnelList(data.personnel);
        if (Array.isArray(data.customers)) setCustomerList(data.customers);
        if (Array.isArray(data.products)) setProductList(data.products);
        setWorkflowTemplates(mergeWithDefaultWorkflowTemplates(data.templates));
        // Load persistent weekly schedule
        try {
          const schedRes = await fetch("/api/storage?key=unified_weekly_schedule");
          const schedData = await schedRes.json();
          if (Array.isArray(schedData?.data)) {
            setWeeklySchedule(schedData.data);
          } else {
            const local = typeof window !== "undefined" ? localStorage.getItem("unified_weekly_schedule") : null;
            if (local) setWeeklySchedule(JSON.parse(local));
          }
        } catch (err) {
          console.warn("Could not load weekly schedule:", err);
          const local = typeof window !== "undefined" ? localStorage.getItem("unified_weekly_schedule") : null;
          if (local) setWeeklySchedule(JSON.parse(local));
        }

        // Load persistent thematic projects
        try {
          const prjRes = await fetch("/api/storage?key=unified_thematic_projects");
          const prjData = await prjRes.json();
          if (Array.isArray(prjData?.data)) {
            setLabProjects(prjData.data);
          } else {
            const local = typeof window !== "undefined" ? localStorage.getItem("unified_thematic_projects") : null;
            if (local) setLabProjects(JSON.parse(local));
          }
        } catch (err) {
          console.warn("Could not load thematic projects:", err);
          const local = typeof window !== "undefined" ? localStorage.getItem("unified_thematic_projects") : null;
          if (local) setLabProjects(JSON.parse(local));
        }
      }
    } catch (e) {
      console.error("Failed to load workspace data:", e);
      showToast("Không thể tải dữ liệu từ máy chủ", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Sync plannerView when selectedDept changes
  useEffect(() => {
    if (isSameWorkspaceDept(selectedDept, "Application")) {
      setPlannerView("lab_projects");
    } else if (isSameWorkspaceDept(selectedDept, "Kinh Doanh")) {
      setPlannerView("sales_targets");
    }
  }, [selectedDept]);

  // Dynamic list of staff for the active department
  const departmentStaffList = useMemo(() => {
    const currentDept = selectedDept !== "all" ? selectedDept : (rolePerspective === "manager" ? managerDept : "all");

    if (personnelList && personnelList.length > 0) {
      if (!currentDept || currentDept === "all") {
        return personnelList;
      }
      const filtered = personnelList.filter((p: any) => isSameWorkspaceDept(p.department, currentDept));
      if (filtered.length > 0) return filtered;
    }

    const normDept = normalizeWorkspaceDept(currentDept);
    if (normDept && normDept !== "all" && DEPARTMENT_STAFF[normDept]) {
      return DEPARTMENT_STAFF[normDept].map(name => ({
        full_name: name.replace(/\s*\(.*?\)/, ""),
        employee_code: "",
        position: "",
        department: normDept
      }));
    }

    return personnelList || [];
  }, [personnelList, selectedDept, rolePerspective, managerDept]);

  // RBAC Filtered Tasks:
  // - Staff: Views their assigned tasks + unassigned tasks in their department (so they can see incoming Demo/coordination requests)
  // - Manager: Views all tasks in their department (or selected department if switched in dropdown)
  // - Director: Views company-wide or selected department
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      const cleanAssignee = cleanWorkspaceAssignee(t.assignee_name);
      if (rolePerspective === "staff") {
        const currLower = currentStaffName.toLowerCase().trim();
        const assLower = cleanAssignee.toLowerCase();
        const isAssignedToMe = Boolean(cleanAssignee) && (assLower.includes(currLower) || currLower.includes(assLower));
        const isUnassignedInMyDept = !cleanAssignee && isSameWorkspaceDept(t.department, userDept);
        if (!isAssignedToMe && !isUnassignedInMyDept) {
          return false;
        }
      } else if (rolePerspective === "manager") {
        const activeFilterDept = selectedDept === "all" ? "all" : selectedDept;
        if (activeFilterDept !== "all" && !isSameWorkspaceDept(t.department, activeFilterDept)) {
          return false;
        }
      } else {
        if (selectedDept !== "all" && !isSameWorkspaceDept(t.department, selectedDept)) return false;
      }

      // Filter by selected individual staff member (or "__UNASSIGNED__" for waiting assignment)
      if (selectedAssignee === "__UNASSIGNED__") {
        if (cleanAssignee) return false;
      } else if (selectedAssignee !== "all") {
        const tAssignee = cleanAssignee.toLowerCase();
        const target = selectedAssignee.toLowerCase().trim();
        if (!tAssignee || (!tAssignee.includes(target) && !target.includes(tAssignee))) {
          return false;
        }
      }

      const matchStatus = statusFilter === "all" || t.status === statusFilter;
      const matchSearch =
        searchQuery === "" ||
        (t.title && t.title.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (t.task_code && t.task_code.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (cleanAssignee && cleanAssignee.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (t.customer_name && t.customer_name.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchStatus && matchSearch;
    });
  }, [tasks, rolePerspective, managerDept, userDept, selectedDept, selectedAssignee, currentStaffName, statusFilter, searchQuery]);

  // RBAC Filtered Weekly Schedules:
  // - Staff: ONLY sees their own schedule items
  // - Manager: Sees all schedule items belonging to their department (can filter by specific staff)
  // - Director: Sees whole company or selected department (can filter by specific staff)
  const filteredSchedules = useMemo(() => {
    return weeklySchedule.filter((s) => {
      if (rolePerspective === "staff") {
        return s.actor && (s.actor.toLowerCase().includes(currentStaffName.toLowerCase()) || currentStaffName.toLowerCase().includes(s.actor.toLowerCase()));
      }
      if (rolePerspective === "manager") {
        if (selectedDept !== "all" && !isSameWorkspaceDept(s.category, selectedDept)) return false;
      } else if (selectedDept !== "all" && !isSameWorkspaceDept(s.category, selectedDept)) {
        return false;
      }
      if (selectedAssignee !== "all" && selectedAssignee !== "__UNASSIGNED__") {
        const actor = (s.actor || "").toLowerCase().trim();
        const target = selectedAssignee.toLowerCase().trim();
        if (!actor.includes(target) && !target.includes(actor)) return false;
      }
      return true;
    });
  }, [weeklySchedule, rolePerspective, managerDept, selectedDept, selectedAssignee, currentStaffName]);

  // RBAC Filtered Thematic Projects:
  // - Staff: Sees projects they lead, collaborate on, or in their department
  // - Manager: Sees all thematic projects belonging to their department (can filter by staff)
  // - Director: Sees whole company or selected department (can filter by staff)
  const filteredLabProjects = useMemo(() => {
    return labProjects.filter((p) => {
      // Filter by department
      if (rolePerspective === "manager") {
        if (selectedDept !== "all" && !isSameWorkspaceDept(p.dept, selectedDept)) return false;
      } else if (selectedDept !== "all" && !isSameWorkspaceDept(p.dept, selectedDept)) {
        return false;
      }

      // Filter by staff
      if (rolePerspective === "staff") {
        const lead = (p.lead || "").toLowerCase();
        const curr = currentStaffName.toLowerCase();
        const isLead = lead.includes(curr) || curr.includes(lead);
        const isCollab = Array.isArray(p.collaborators) && p.collaborators.some((c: string) => c.toLowerCase().includes(curr));
        if (!isLead && !isCollab) return false;
      } else if (selectedAssignee !== "all" && selectedAssignee !== "__UNASSIGNED__") {
        const lead = (p.lead || "").toLowerCase().trim();
        const target = selectedAssignee.toLowerCase().trim();
        const matchesLead = lead.includes(target) || target.includes(lead);
        const matchesCollab = Array.isArray(p.collaborators) && p.collaborators.some((c: string) => c.toLowerCase().includes(target));
        if (!matchesLead && !matchesCollab) return false;
      }

      // Filter by thematic type if selected
      if (thematicFilterType !== "all" && p.typeId !== thematicFilterType) {
        return false;
      }

      return true;
    });
  }, [labProjects, rolePerspective, managerDept, selectedDept, selectedAssignee, currentStaffName, thematicFilterType]);

  // RBAC Filtered Sales Targets:
  // - Staff: ONLY sees their assigned pipeline targets
  // - Manager: Sees all Kinh Doanh targets
  // - Director: Sees all
  const filteredSalesTargets = useMemo(() => {
    return salesTargets.filter((t) => {
      if (rolePerspective === "staff") {
        return t.lead && (t.lead.toLowerCase().includes(currentStaffName.toLowerCase()) || currentStaffName.toLowerCase().includes(t.lead.toLowerCase()));
      }
      if (rolePerspective === "manager") {
        return isSameWorkspaceDept(managerDept, "Kinh Doanh");
      }
      return selectedDept === "all" || isSameWorkspaceDept(selectedDept, "Kinh Doanh");
    });
  }, [salesTargets, rolePerspective, managerDept, selectedDept, currentStaffName]);

  // RBAC Filtered Daily Logs:
  // - Staff: ONLY sees their own daily logs
  // - Manager: Sees all staff logs in their department
  // - Director: Sees whole company or selected department
  const filteredDailyLogs = useMemo(() => {
    return dailyLogs.filter((log) => {
      if (rolePerspective === "staff") {
        const emp = log.employee_name || log.author || "";
        return emp && (emp.toLowerCase().includes(currentStaffName.toLowerCase()) || currentStaffName.toLowerCase().includes(emp.toLowerCase()));
      }
      if (rolePerspective === "manager") {
        return selectedDept === "all" ? true : isSameWorkspaceDept(log.department, selectedDept);
      }
      return selectedDept === "all" || isSameWorkspaceDept(log.department, selectedDept);
    });
  }, [dailyLogs, rolePerspective, managerDept, selectedDept, currentStaffName]);

  // Filtered Workflows
  const filteredWorkflows = useMemo(() => {
    return workflows.filter((w) => {
      const stepDepts = Array.isArray(w.steps) ? w.steps.map((s: any) => s?.dept).filter(Boolean) : [];
      const matchDept =
        selectedDept === "all" ||
        isSameWorkspaceDept(w.requester_dept, selectedDept) ||
        isSameWorkspaceDept(w.target_dept, selectedDept) ||
        stepDepts.some((d: string) => isSameWorkspaceDept(d, selectedDept));
      const matchSearch =
        searchQuery === "" ||
        (w.title && w.title.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (w.workflow_code && w.workflow_code.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (w.customer_name && w.customer_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (w.product_info && w.product_info.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchDept && matchSearch;
    });
  }, [workflows, selectedDept, searchQuery]);

  // Bộ lọc riêng của "Danh Sách Phiếu Phối Hợp": trạng thái, quá hạn, liên quan đến tôi, ưu tiên, sắp xếp
  const [templatesExpanded, setTemplatesExpanded] = useState<boolean>(() => {
    try { return typeof window !== "undefined" && localStorage.getItem("ws_templates_expanded") === "1"; } catch { return false; }
  });
  const [wfStatusFilter, setWfStatusFilter] = useState<"open" | "PENDING" | "WORKING" | "REVIEW" | "COMPLETED" | "OVERDUE" | "all">("open");
  const [wfMineFilter, setWfMineFilter] = useState<"all" | "requested" | "assigned">("all");
  const [wfPriorityFilter, setWfPriorityFilter] = useState<string>("all");
  const [wfSort, setWfSort] = useState<"newest" | "deadline" | "priority">("newest");
  const wfIsOverdue = (w: any) => {
    const s = String(w.status || "").toUpperCase();
    if (!w.due_date || s === "COMPLETED" || s === "CANCELLED" || s === "REJECTED") return false;
    return String(w.due_date).slice(0, 10) < todayVN();
  };
  const wfStatusBucket = (w: any) => {
    const s = String(w.status || "PENDING").toUpperCase();
    if (s === "PENDING") return "PENDING";
    if (s === "ACCEPTED" || s === "IN_PROGRESS") return "WORKING";
    if (s === "REVIEW") return "REVIEW";
    if (s === "COMPLETED") return "COMPLETED";
    return "OTHER";
  };
  const wfInvolvesMe = (w: any, mode: "requested" | "assigned") => {
    const me = String(currentStaffName || "").trim();
    if (!me) return false;
    if (mode === "requested") return String(w.requester_name || "").trim() === me;
    const steps = Array.isArray(w.steps) ? w.steps : [];
    return cleanWorkspaceAssignee(w.assignee_name) === me || steps.some((s: any) => cleanWorkspaceAssignee(s?.assignee_name) === me);
  };
  const wfBase = useMemo(() => filteredWorkflows.filter((w) =>
    (wfMineFilter === "all" || wfInvolvesMe(w, wfMineFilter)) &&
    (wfPriorityFilter === "all" || String(w.priority || "MEDIUM").toUpperCase() === wfPriorityFilter)
  ), [filteredWorkflows, wfMineFilter, wfPriorityFilter, currentStaffName]); // eslint-disable-line react-hooks/exhaustive-deps
  const wfCounts = useMemo(() => {
    const c: Record<string, number> = { all: wfBase.length, open: 0, PENDING: 0, WORKING: 0, REVIEW: 0, COMPLETED: 0, OVERDUE: 0 };
    wfBase.forEach((w) => {
      const b = wfStatusBucket(w);
      if (c[b] !== undefined) c[b]++;
      if (b !== "COMPLETED" && b !== "OTHER") c.open++;
      if (wfIsOverdue(w)) c.OVERDUE++;
    });
    return c;
  }, [wfBase]); // eslint-disable-line react-hooks/exhaustive-deps
  const listWorkflows = useMemo(() => {
    const prio: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const rows = wfBase.filter((w) => {
      const b = wfStatusBucket(w);
      if (wfStatusFilter === "all") return true;
      if (wfStatusFilter === "open") return b !== "COMPLETED" && b !== "OTHER";
      if (wfStatusFilter === "OVERDUE") return wfIsOverdue(w);
      return b === wfStatusFilter;
    });
    return [...rows].sort((a, b) => {
      if (wfSort === "deadline") return String(a.due_date || "9999").localeCompare(String(b.due_date || "9999"));
      if (wfSort === "priority") return (prio[String(a.priority || "MEDIUM").toUpperCase()] ?? 2) - (prio[String(b.priority || "MEDIUM").toUpperCase()] ?? 2);
      return (Number(b.id) || 0) - (Number(a.id) || 0);
    });
  }, [wfBase, wfStatusFilter, wfSort]); // eslint-disable-line react-hooks/exhaustive-deps

  // Statistics
  const stats = useMemo(() => {
    const totalTasks = filteredTasks.length;
    const todoTasks = filteredTasks.filter((t) => t.status === "TODO").length;
    const inProgressTasks = filteredTasks.filter((t) => t.status === "IN_PROGRESS").length;
    const doneTasks = filteredTasks.filter((t) => t.status === "DONE").length;
    const totalWf = filteredWorkflows.length;
    const pendingWf = filteredWorkflows.filter((w) => w.status === "PENDING" || w.status === "ACCEPTED" || w.status === "IN_PROGRESS").length;
    return { totalTasks, todoTasks, inProgressTasks, doneTasks, totalWf, pendingWf };
  }, [filteredTasks, filteredWorkflows]);

  // Comprehensive Real-time Analytics & KPI Metrics
  const analyticsData = useMemo(() => {
    const isDeptScoped = selectedDept !== "all";
    const currentScopeDept = rolePerspective === "manager" ? managerDept : selectedDept;

    const scopeTasks = tasks.filter(t => {
      if (selectedDept === "all") return true;
      return isSameWorkspaceDept(t.department, selectedDept);
    });

    const scopeWorkflows = workflows.filter(w => {
      if (selectedDept === "all") return true;
      return isSameWorkspaceDept(w.requester_dept, selectedDept) || isSameWorkspaceDept(w.target_dept, selectedDept);
    });

    const scopeDailyLogs = dailyLogs.filter(d => {
      if (selectedDept === "all") return true;
      return isSameWorkspaceDept(d.department, selectedDept);
    });

    const scopeThematicPlans = labProjects.filter(p => {
      if (selectedDept === "all") return true;
      return isSameWorkspaceDept(p.dept, selectedDept);
    });

    const scopePersonnel = personnelList.filter(p => {
      if (selectedDept === "all") return true;
      return isSameWorkspaceDept(p.department, selectedDept);
    });

    // Task metrics
    const totalTasks = scopeTasks.length;
    const doneTasks = scopeTasks.filter(t => t.status === "DONE").length;
    const inProgressTasks = scopeTasks.filter(t => t.status === "IN_PROGRESS").length;
    const todoTasks = scopeTasks.filter(t => t.status === "TODO").length;
    const taskCompletionRate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

    // Workflow metrics & SLA
    const totalWf = scopeWorkflows.length;
    const doneWf = scopeWorkflows.filter(w => w.status === "COMPLETED").length;
    const pendingWf = scopeWorkflows.filter(w => w.status === "PENDING" || w.status === "ACCEPTED").length;
    const overdueWf = scopeWorkflows.filter(w => {
      if (w.status === "COMPLETED") return false;
      if (!w.due_date) return false;
      return new Date(w.due_date) < new Date();
    }).length;
    const wfSlaRate = totalWf > 0 ? Math.max(0, Math.round(((totalWf - overdueWf) / totalWf) * 100)) : 0;

    // Thematic Plans progress
    const totalPlans = scopeThematicPlans.length;
    let completedStagesCount = 0;
    let totalStagesCount = 0;
    scopeThematicPlans.forEach(p => {
      const stages = p.stages || [];
      totalStagesCount += stages.length;
      completedStagesCount += stages.filter((s: any) => s.status === "completed").length;
    });
    const planProgressRate = totalStagesCount > 0 ? Math.round((completedStagesCount / totalStagesCount) * 100) : (totalPlans > 0 ? 50 : 0);

    // Daily discipline
    const staffCount = Math.max(1, scopePersonnel.length);
    const dailySubmittedCount = scopeDailyLogs.length;
    const dailyDisciplineRate = Math.min(100, Math.round((dailySubmittedCount / staffCount) * 100));

    // Difficulties extracted from real daily logs
    const realIssues = scopeDailyLogs
      .filter(l => l.issues && l.issues.trim() !== "")
      .map(l => ({ staff: l.employee_name || "Nhân viên", dept: l.department, issue: l.issues }));

    // Next day plans extracted from real daily logs
    const realNextDayPlans = scopeDailyLogs
      .filter(l => l.next_day_plan && l.next_day_plan.trim() !== "")
      .map(l => ({ staff: l.employee_name || "Nhân viên", dept: l.department, plan: l.next_day_plan }));

    // Composite Score
    const hasData = totalTasks > 0 || totalWf > 0 || dailySubmittedCount > 0 || totalPlans > 0;
    let compositeScore = 0;
    if (hasData) {
      const weights = {
        task: totalTasks > 0 ? 0.4 : 0,
        wf: totalWf > 0 ? 0.3 : 0,
        plan: totalPlans > 0 ? 0.15 : 0,
        daily: dailySubmittedCount > 0 ? 0.3 : 0
      };
      const totalWeight = weights.task + weights.wf + weights.plan + weights.daily;
      if (totalWeight > 0) {
        compositeScore = Math.round(
          ((taskCompletionRate * weights.task) +
          (wfSlaRate * weights.wf) +
          (planProgressRate * weights.plan) +
          (dailyDisciplineRate * weights.daily)) / totalWeight
        );
      }
    }

    let scoreStatus = "Chưa có dữ liệu";
    let scoreColor = "text-slate-400";
    if (hasData) {
      if (compositeScore >= 90) {
        scoreStatus = "Vận hành Xuất sắc";
        scoreColor = "text-emerald-600 dark:text-emerald-400";
      } else if (compositeScore >= 80) {
        scoreStatus = "Vận hành Tốt";
        scoreColor = "text-emerald-600 dark:text-emerald-400";
      } else if (compositeScore >= 65) {
        scoreStatus = "Đạt chuẩn yêu cầu";
        scoreColor = "text-blue-600 dark:text-blue-400";
      } else if (compositeScore >= 50) {
        scoreStatus = "Cần cải thiện";
        scoreColor = "text-amber-600 dark:text-amber-400";
      } else {
        scoreStatus = "Dưới định mức";
        scoreColor = "text-rose-600 dark:text-rose-400";
      }
    }

    // Department Breakdown Scorecard (4 core depts)
    const departments = ["Application", "Kinh Doanh", "Kho & Vận Hành", "Cung Ứng"];
    const deptScorecards = departments.map(dName => {
      const dTasks = tasks.filter(t => isSameWorkspaceDept(t.department, dName));
      const dDone = dTasks.filter(t => t.status === "DONE").length;
      const dInProg = dTasks.filter(t => t.status === "IN_PROGRESS").length;
      const dTodo = dTasks.filter(t => t.status === "TODO").length;
      const dTaskPercent = dTasks.length > 0 ? Math.round((dDone / dTasks.length) * 100) : 0;

      const dPlans = labProjects.filter(p => isSameWorkspaceDept(p.dept, dName));
      let dStagesTotal = 0;
      let dStagesDone = 0;
      dPlans.forEach(p => {
        const st = p.stages || [];
        dStagesTotal += st.length;
        dStagesDone += st.filter((s: any) => s.status === "completed").length;
      });
      const dPlanPercent = dStagesTotal > 0 ? Math.round((dStagesDone / dStagesTotal) * 100) : (dPlans.length > 0 ? 50 : 0);

      const dStaff = personnelList.filter(p => isSameWorkspaceDept(p.department, dName));
      const dLogs = dailyLogs.filter(l => isSameWorkspaceDept(l.department, dName));
      const dDailyPercent = dStaff.length > 0 ? Math.min(100, Math.round((dLogs.length / dStaff.length) * 100)) : 0;

      const hasDeptData = dTasks.length > 0 || dLogs.length > 0 || dPlans.length > 0;
      let dScore = 0;
      let dGrade = "Chưa đánh giá";
      let dGradeClass = "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";

      if (hasDeptData) {
        dScore = Math.round(dTaskPercent * 0.4 + dPlanPercent * 0.3 + dDailyPercent * 0.3);
        if (dScore >= 90) {
          dGrade = "Xuất sắc (A+)";
          dGradeClass = "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
        } else if (dScore >= 80) {
          dGrade = "Tốt (A)";
          dGradeClass = "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300";
        } else if (dScore >= 65) {
          dGrade = "Đạt (B+)";
          dGradeClass = "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300";
        } else if (dScore >= 50) {
          dGrade = "Trung bình (B)";
          dGradeClass = "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
        } else {
          dGrade = "Cần cải thiện (C)";
          dGradeClass = "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300";
        }
      }

      return {
        dept: dName,
        totalTasks: dTasks.length,
        inProgTasks: dInProg,
        todoTasks: dTodo,
        doneTasks: dDone,
        taskPercent: dTaskPercent,
        plansCount: dPlans.length,
        planPercent: dPlanPercent,
        staffCount: dStaff.length,
        dailyCount: dLogs.length,
        dailyPercent: dDailyPercent,
        score: dScore,
        grade: dGrade,
        gradeClass: dGradeClass,
        hasData: hasDeptData
      };
    });

    return {
      scopeTitle: isDeptScoped ? `Phòng ${currentScopeDept}` : "Toàn Công Ty",
      scopeThematicPlans,
      totalTasks,
      doneTasks,
      inProgressTasks,
      todoTasks,
      taskCompletionRate,
      totalWf,
      doneWf,
      pendingWf,
      overdueWf,
      wfSlaRate,
      totalPlans,
      completedStagesCount,
      totalStagesCount,
      planProgressRate,
      staffCount,
      dailySubmittedCount,
      dailyDisciplineRate,
      realIssues,
      realNextDayPlans,
      hasData,
      compositeScore,
      scoreStatus,
      scoreColor,
      deptScorecards
    };
  }, [tasks, workflows, dailyLogs, labProjects, personnelList, selectedDept, rolePerspective, managerDept]);

  // Handle Save Task
  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/workflows?action=task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(taskForm)
      });
      const data = await res.json();
      if (data.success) {
        showToast(taskForm.id ? "Đã cập nhật công việc!" : "Đã tạo mới công việc!", "success");
        const prevTask = taskForm.id ? tasks.find((t: any) => t.id === taskForm.id) : null;
        const linkedWf = (taskForm as any).related_workflow_code
          ? workflows.find((w: any) => w.workflow_code === (taskForm as any).related_workflow_code)
          : null;
        if (linkedWf && String(taskForm.result || "").trim() && String(taskForm.result || "").trim() !== String(prevTask?.result || "").trim()) {
          notifyActivity({
            title: "Phản hồi phiếu phối hợp",
            message: `${currentStaffName} đã báo cáo trên phiếu ${linkedWf.workflow_code}: "${String(taskForm.result).trim().slice(0, 120)}"`,
            type: "info",
            category: "task",
            sender: { name: currentStaffName },
            targetEmployeeNames: [linkedWf.requester_name].filter(Boolean),
            targetDept: linkedWf.requester_dept,
            link: { tab: "workspace", subTab: "workflows" }
          });
        }
        notifyActivity({
          title: taskForm.id ? "Cập nhật công việc" : "Giao công việc mới",
          message: taskForm.id 
            ? `${user?.name || currentStaffName} đã cập nhật công việc "${taskForm.title}".`
            : `${user?.name || currentStaffName} đã giao công việc "${taskForm.title}" cho bạn (${taskForm.department}).`,
          type: "info",
          category: "task",
          sender: { name: user?.name || currentStaffName },
          targetEmployeeNames: taskForm.assignee_name ? [taskForm.assignee_name] : [],
          targetDept: taskForm.department,
          link: { tab: "workspace", subTab: "tasks" }
        });
        setIsTaskModalOpen(false);
        fetchData();
      } else {
        showToast(data.error || "Lỗi khi lưu công việc", "error");
      }
    } catch (e) {
      showToast("Lỗi kết nối máy chủ", "error");
    }
  };

  // Quick Change Task Status
  const handleQuickStatusChange = async (taskId: number, newStatus: string) => {
    const target = tasks.find((t) => t.id === taskId);
    if (!target) return;
    try {
      await fetch("/api/workflows?action=task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...target, status: newStatus })
      });
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)));
      showToast(`Đã chuyển trạng thái: ${newStatus}`, "info");

      notifyActivity({
        title: newStatus === "DONE" ? "Hoàn thành công việc" : "Cập nhật tiến độ công việc",
        message: `${currentStaffName} đã cập nhật công việc "${target.title}" sang trạng thái: ${newStatus === "DONE" ? "Đã hoàn tất (DONE)" : newStatus === "IN_PROGRESS" ? "Đang thực hiện" : "Cần làm"}.`,
        type: newStatus === "DONE" ? "success" : "info",
        category: "task",
        sender: { name: currentStaffName },
        targetEmployeeNames: [target.assignee_name].filter(Boolean),
        targetDept: target.department,
        link: { tab: "workspace", subTab: "tasks" }
      });
    } catch (e) {
      showToast("Lỗi khi cập nhật trạng thái", "error");
    }
  };

  // Handle Save Workflow Request
  const handleSaveWorkflow = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const isCreatorApp = isDirector || isSameWorkspaceDept(userDept, "Application");
      const sanitizedSteps = (wfForm.steps || []).map((s: any, idx: number) => {
        const sDept = s.dept || wfForm.target_dept || "Application";
        let sAssignee = cleanWorkspaceAssignee(s.assignee_name);
        if (wfForm.workflow_type === "SALES_TO_APP" && isSameWorkspaceDept(sDept, "Application") && !isCreatorApp) {
          sAssignee = "";
        }
        return {
          ...s,
          step_index: idx,
          dept: sDept,
          assignee_name: sAssignee
        };
      });
      const step0Assignee = sanitizedSteps.length > 0 ? sanitizedSteps[0].assignee_name : cleanWorkspaceAssignee(wfForm.assignee_name);
      const payload = {
        ...wfForm,
        requester_name: wfForm.requester_name || currentStaffName,
        assignee_name: wfForm.workflow_type === "SALES_TO_APP" && !isCreatorApp ? "" : step0Assignee,
        steps: sanitizedSteps
      };

      const res = await fetch("/api/workflows?action=workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        showToast("Đã khởi tạo quy trình liên phòng ban thành công!", "success");
        const assigneeLabel = payload.assignee_name
          ? `Phụ trách: ${payload.assignee_name}.`
          : `Trạng thái: Chờ bộ phận ${payload.target_dept} phân công nhân sự.`;
        notifyActivity({
          title: "Yêu cầu phối hợp liên phòng",
          message: `${payload.requester_name} (${payload.requester_dept}) đã gửi yêu cầu phối hợp "${payload.title}" tới phòng ${payload.target_dept}. ${assigneeLabel}`,
          type: "warning",
          category: isSameWorkspaceDept(payload.target_dept, "Application") ? "application" : isSameWorkspaceDept(payload.target_dept, "Kho & Vận Hành") ? "warehouse" : "task",
          sender: { name: payload.requester_name },
          targetEmployeeNames: payload.assignee_name ? [payload.assignee_name] : [],
          targetDept: payload.target_dept,
          link: { tab: "workspace", subTab: "workflows" }
        });
        setIsWorkflowModalOpen(false);
        fetchData();
      } else {
        showToast(data.error || "Lỗi khi tạo quy trình", "error");
      }
    } catch (e) {
      showToast("Lỗi kết nối máy chủ", "error");
    }
  };

  // Assign / Self-assign workflow step & linked task (for receiving department e.g. Application)
  const handleAssignWorkflowStep = async (wf: any, assigneeName: string, stepIdx?: number) => {
    const cleanName = cleanWorkspaceAssignee(assigneeName);
    if (!cleanName) {
      showToast("Vui lòng chọn nhân sự phụ trách", "warning");
      return;
    }
    try {
      const res = await fetch("/api/workflows?action=assign_workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: wf.id,
          assignee_name: cleanName,
          step_index: typeof stepIdx === "number" ? stepIdx : (wf.current_step_index || 0),
          actor: currentStaffName
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Đã phân công ${cleanName} phụ trách phiếu ${wf.workflow_code}!`, "success");
        fetchData();
        if (selectedWorkflowDetail && selectedWorkflowDetail.id === wf.id) {
          setSelectedWorkflowDetail({
            ...selectedWorkflowDetail,
            assignee_name: data.assignee_name,
            steps: data.steps,
            status: data.status,
            logs: data.logs
          });
        }
        notifyActivity({
          title: "Phân công thực hiện yêu cầu phối hợp",
          message: `${currentStaffName} đã phân công ${cleanName} phụ trách phiếu "${wf.title}" (${wf.workflow_code}).`,
          type: "info",
          category: isSameWorkspaceDept(wf.target_dept, "Application") ? "application" : "task",
          sender: { name: currentStaffName },
          targetEmployeeNames: [cleanName, wf.requester_name].filter(Boolean),
          targetDept: wf.target_dept,
          link: { tab: "workspace", subTab: "workflows" }
        });
      } else {
        showToast(data.error || "Không thể phân công nhân sự", "error");
      }
    } catch (e: any) {
      showToast("Lỗi kết nối máy chủ", "error");
    }
  };

  // Open Create Template Modal
  const handleOpenCreateTemplate = () => {
    if (!canManageTemplates) { warnNoTemplatePermission(); return; }
    setTemplateForm({
      id: null,
      code: `WF-TMP-${Date.now().toString().slice(-4)}`,
      name: "",
      source_dept: "Kinh Doanh",
      target_dept: "Application",
      icon: "FlaskConical",
      description: "",
      sla_days: 3,
      steps: [
        {
          step_index: 0,
          title: "Tiếp nhận & Thẩm định yêu cầu",
          dept: "Application",
          assignee_name: "",
          sla_hours: 24,
          deliverables: "Xác nhận tính khả thi & phân công nhân sự"
        },
        {
          step_index: 1,
          title: "Triển khai thực hiện chuyên môn",
          dept: "Application",
          assignee_name: "",
          sla_hours: 48,
          deliverables: "Báo cáo tiến độ / kết quả thử nghiệm"
        },
        {
          step_index: 2,
          title: "Nghiệm thu & Bàn giao kết quả",
          dept: "Kinh Doanh",
          assignee_name: "",
          sla_hours: 24,
          deliverables: "Biên bản bàn giao và xác nhận hoàn tất"
        }
      ]
    });
    setIsTemplateModalOpen(true);
  };

  const handleEditTemplate = (tmpl: any) => {
    if (!canManageTemplates) { warnNoTemplatePermission(); return; }
    setTemplateForm({
      id: typeof tmpl.id === "number" ? tmpl.id : null,
      code: tmpl.code || tmpl.id || `WF-TMP-${Date.now().toString().slice(-4)}`,
      name: tmpl.name,
      source_dept: tmpl.source_dept || tmpl.sourceDept || "Kinh Doanh",
      target_dept: tmpl.target_dept || tmpl.targetDept || "Application",
      icon: tmpl.icon || "FlaskConical",
      description: tmpl.description || "",
      sla_days: tmpl.sla_days || 3,
      steps: Array.isArray(tmpl.steps) && tmpl.steps.length > 0 ? tmpl.steps : [
        { step_index: 0, title: "Tiếp nhận", dept: tmpl.target_dept || tmpl.targetDept || "Application", assignee_name: "", sla_hours: 24, deliverables: "Biên bản" }
      ]
    });
    setIsTemplateModalOpen(true);
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateForm.name.trim()) {
      showToast("Vui lòng nhập tên quy trình phối hợp", "warning");
      return;
    }
    try {
      const res = await fetch("/api/workflows?action=template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(templateForm)
      });
      const data = await res.json();
      if (data.success) {
        showToast("Đã lưu mẫu quy trình phối hợp thành công!", "success");
        setIsTemplateModalOpen(false);
        setWorkflowTemplates(mergeWithDefaultWorkflowTemplates(data.templates));
        fetchData();
      } else {
        showToast(data.error || "Lỗi khi lưu mẫu quy trình", "error");
      }
    } catch (e: any) {
      showToast("Lỗi kết nối: " + e.message, "error");
    }
  };

  const handleDeleteTemplate = async (templateId: number) => {
    if (!confirm("Bạn có chắc chắn muốn xóa mẫu quy trình phối hợp này?")) return;
    try {
      const res = await fetch("/api/workflows?action=delete_template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: templateId })
      });
      const data = await res.json();
      if (data.success) {
        showToast("Đã xóa mẫu quy trình", "success");
        setWorkflowTemplates(mergeWithDefaultWorkflowTemplates(data.templates));
      } else {
        showToast(data.error || "Lỗi khi xóa mẫu", "error");
      }
    } catch (e: any) {
      showToast("Lỗi kết nối", "error");
    }
  };

  // Initiate workflow ticket from a template
  const handleInitiateFromTemplate = (tmpl: any) => {
    const rawSteps = Array.isArray(tmpl.steps) ? tmpl.steps : [];
    const isCreatorApp = isDirector || isSameWorkspaceDept(userDept, "Application");
    const tmplCode = tmpl.code || tmpl.id;
    const stepsCopy = rawSteps.map((s: any, idx: number) => {
      const stepDept = s.dept || tmpl.target_dept || tmpl.targetDept || "Application";
      let stepAssignee = cleanWorkspaceAssignee(s.assignee_name);
      // Nếu là quy trình Sales -> App: các bước của Application để trống cho APP tự phân công; bước nghiệm thu của Kinh Doanh gán mặc định người tạo
      if (tmplCode === "SALES_TO_APP") {
        if (isSameWorkspaceDept(stepDept, "Application") && !isCreatorApp) {
          stepAssignee = "";
        } else if (isSameWorkspaceDept(stepDept, "Kinh Doanh") && !stepAssignee) {
          stepAssignee = currentStaffName || "";
        }
      }
      return {
        step_index: idx,
        title: s.title || `Bước ${idx + 1}`,
        dept: stepDept,
        assignee_name: stepAssignee,
        sla_hours: s.sla_hours || 24,
        deliverables: s.deliverables || "",
        status: idx === 0 ? "IN_PROGRESS" : "PENDING"
      };
    });

    setWfForm({
      workflow_type: tmplCode,
      title: `[${tmpl.name}] Yêu cầu phối hợp mới`,
      priority: "HIGH",
      requester_name: currentStaffName || "",
      requester_dept: tmpl.source_dept || tmpl.sourceDept || userDept || "Kinh Doanh",
      assignee_name: stepsCopy.length > 0 ? (stepsCopy[0].assignee_name || "") : "",
      target_dept: stepsCopy.length > 0 && stepsCopy[0].dept ? stepsCopy[0].dept : (tmpl.target_dept || tmpl.targetDept || "Application"),
      customer_name: "",
      product_info: "",
      due_date: toVNDateString(new Date(Date.now() + (tmpl.sla_days || 5) * 86400000)),
      description: tmpl.description || "",
      steps: stepsCopy
    });
    setIsWorkflowModalOpen(true);
  };

  // Open Stage-Gate Step Advance Modal
  const handleOpenAdvanceStep = (wf: any) => {
    const steps = Array.isArray(wf.steps) ? wf.steps : [];
    const currentIdx = typeof wf.current_step_index === "number" ? wf.current_step_index : 0;
    const currentStep = steps[currentIdx] || { title: `Bước ${currentIdx + 1}`, dept: wf.target_dept };
    const nextIdx = currentIdx + 1;
    const nextStep = nextIdx < steps.length ? steps[nextIdx] : null;

    setAdvanceStepData({
      workflow: wf,
      stepIndex: currentIdx,
      currentStep,
      nextStep,
      stepResult: "",
      nextAssigneeName: nextStep ? (nextStep.assignee_name || "") : "",
      attachments: []
    });
    setIsAdvanceStepModalOpen(true);
  };

  // Advance step (Handoff to next step / department)
  const handleAdvanceStep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!advanceStepData.workflow) return;
    if (!advanceStepData.stepResult.trim()) {
      showToast("Vui lòng ghi nhận kết quả / biên bản nghiệm thu bước này", "warning");
      return;
    }
    try {
      const res = await fetch("/api/workflows?action=advance_step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: advanceStepData.workflow.id,
          step_index: advanceStepData.stepIndex,
          step_result: advanceStepData.stepResult,
          actor: currentStaffName || "Nhân viên",
          next_assignee_name: advanceStepData.nextAssigneeName,
          attachments: advanceStepData.attachments
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast("Đã nghiệm thu bước & bàn giao tiếp theo thành công!", "success");
        setIsAdvanceStepModalOpen(false);
        fetchData();

        // Send Activity Notification to Requester and Next Assignee
        const isLastStep = !advanceStepData.nextStep;
        notifyActivity({
          title: isLastStep ? "Hoàn tất quy trình phối hợp" : "Bàn giao bước phối hợp liên phòng",
          message: isLastStep
            ? `${currentStaffName} đã hoàn tất dứt điểm quy trình "${advanceStepData.workflow?.title}".`
            : `${currentStaffName} đã hoàn thành bước "${advanceStepData.currentStep?.title || 'bước quy trình'}" và chuyển tiếp cho ${advanceStepData.nextAssigneeName || "nhân sự phụ trách"}.`,
          type: isLastStep ? "success" : "info",
          category: "application",
          sender: { name: currentStaffName },
          targetEmployeeNames: [
            advanceStepData.workflow?.requester_name,
            advanceStepData.nextAssigneeName
          ].filter(Boolean) as string[],
          targetDept: isLastStep ? advanceStepData.workflow?.requester_dept : advanceStepData.nextStep?.dept,
          link: { tab: "workspace", subTab: "workflows" }
        });
      } else {
        showToast(data.error || "Lỗi khi chuyển bước", "error");
      }
    } catch (e: any) {
      showToast("Lỗi kết nối: " + e.message, "error");
    }
  };

  // Upload attachments via /api/upload
  const handleFileUpload = async (
    files: FileList | null,
    target: "record" | "create" | "comment" | "task" | "schedule"
  ) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    try {
      const uploaded: Array<{ name: string; url: string; size?: number; type?: string; uploaded_at?: string }> = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData
        });
        const data = await res.json();
        if (data.success) {
          uploaded.push({
            name: data.name || file.name,
            url: data.url,
            size: data.size || file.size,
            type: data.type || file.type,
            uploaded_at: nowVNDateTime()
          });
        } else {
          showToast(data.error || `Lỗi tải lên tệp ${file.name}`, "error");
        }
      }

      if (target === "record") {
        setRecordResultForm((prev) => ({
          ...prev,
          attachments: [...(prev.attachments || []), ...uploaded]
        }));
        showToast(`Đã đính kèm ${uploaded.length} tệp thành công!`, "success");
      } else if (target === "create") {
        setWfForm((prev: any) => ({
          ...prev,
          attachments: [...(prev.attachments || []), ...uploaded]
        }));
        showToast(`Đã đính kèm ${uploaded.length} tệp vào phiếu!`, "success");
      } else if (target === "comment") {
        setWorkflowCommentAttachments((prev) => [...prev, ...uploaded]);
        showToast(`Đã đính kèm ${uploaded.length} tệp vào trao đổi!`, "success");
      } else if (target === "task") {
        setTaskForm((prev: any) => ({
          ...prev,
          attachments: [...(prev.attachments || []), ...uploaded]
        }));
        showToast(`Đã đính kèm ${uploaded.length} tệp vào công việc!`, "success");
      } else if (target === "schedule") {
        setScheduleForm((prev: any) => ({
          ...prev,
          attachments: [...(prev.attachments || []), ...uploaded]
        }));
        showToast(`Đã đính kèm ${uploaded.length} tệp vào kế hoạch công tác!`, "success");
      }
    } catch (err: any) {
      showToast("Lỗi tải tệp: " + err.message, "error");
    } finally {
      setIsUploading(false);
    }
  };

  // Open Record Result Modal for a Workflow
  const handleOpenRecordResult = (wf: any) => {
    setSelectedWorkflowForRecord(wf);
    const existingAttachments = Array.isArray(wf.attachments)
      ? wf.attachments
      : typeof wf.attachments === "string"
      ? JSON.parse(wf.attachments || "[]")
      : [];
    let initialSummary = wf.results_summary || "";
    if (typeof initialSummary === "string" && (initialSummary.trim().startsWith("[") || initialSummary.trim().startsWith("{"))) {
      try {
        const parsed = JSON.parse(initialSummary);
        if (Array.isArray(parsed)) {
          const poCodes = Array.from(new Set(parsed.map((it: any) => it.po_code).filter(Boolean)));
          initialSummary = `Đã lập PO cho ${parsed.filter((it: any) => it.po_code || it.status === "CONVERTED").length}/${parsed.length} mặt hàng.${poCodes.length ? " Mã PO liên kết: " + poCodes.join(", ") : ""}`;
        }
      } catch (e) {}
    }

    setRecordResultForm({
      results_summary: initialSummary,
      status: wf.status === "IN_PROGRESS" ? "REVIEW" : wf.status === "PENDING" ? "IN_PROGRESS" : wf.status,
      reporter_name: currentStaffName || wf.assignee_name || "Cán bộ phụ trách",
      note: wf.results_summary ? "Cập nhật bổ sung kết quả và tài liệu" : "Ghi nhận kết quả thực hiện và đính kèm hồ sơ",
      attachments: existingAttachments
    });
    setIsRecordResultModalOpen(true);
  };

  // Save Workflow Result & Attachments
  const handleSaveRecordResult = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWorkflowForRecord) return;
    if (!recordResultForm.results_summary.trim()) {
      showToast("Vui lòng nhập nội dung tóm tắt kết quả thực hiện", "warning");
      return;
    }
    try {
      const res = await fetch("/api/workflows?action=record_result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedWorkflowForRecord.id,
          results_summary: recordResultForm.results_summary.trim(),
          status: recordResultForm.status,
          actor: recordResultForm.reporter_name || currentStaffName,
          note: recordResultForm.note || `Ghi nhận kết quả: ${recordResultForm.results_summary.slice(0, 50)}...`,
          attachments: recordResultForm.attachments
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast("Đã lưu kết quả thực hiện và hồ sơ đính kèm thành công!", "success");
        setIsRecordResultModalOpen(false);
        fetchData();
        // Update selectedWorkflowDetail if it's currently open
        if (selectedWorkflowDetail && selectedWorkflowDetail.id === selectedWorkflowForRecord.id) {
          setSelectedWorkflowDetail((prev: any) => ({
            ...prev,
            results_summary: recordResultForm.results_summary.trim(),
            status: recordResultForm.status,
            attachments: recordResultForm.attachments
          }));
        }

        const targetRecipients = [
          selectedWorkflowForRecord.requester_name,
          selectedWorkflowForRecord.assignee_name
        ].filter(Boolean) as string[];
        notifyActivity({
          title: "Báo cáo kết quả quy trình liên phòng",
          message: `${recordResultForm.reporter_name || currentStaffName} đã ghi nhận kết quả thực hiện cho phiếu "${selectedWorkflowForRecord.title}". Trạng thái: ${recordResultForm.status}.`,
          type: "info",
          category: selectedWorkflowForRecord.target_dept === "Application" ? "application" : "task",
          sender: { name: recordResultForm.reporter_name || currentStaffName },
          targetEmployeeNames: targetRecipients,
          targetDept: selectedWorkflowForRecord.requester_dept || selectedWorkflowForRecord.target_dept,
          link: { tab: "workspace", subTab: "workflows" }
        });
      } else {
        showToast(data.error || "Lỗi khi lưu kết quả", "error");
      }
    } catch (err) {
      showToast("Lỗi kết nối máy chủ", "error");
    }
  };

  // Handle Workflow Status Transition
  const handleWorkflowStatusTransition = async (wfId: number, nextStatus: string, note?: string) => {
    try {
      const res = await fetch("/api/workflows?action=workflow_status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: wfId,
          status: nextStatus,
          actor: currentStaffName || "Cán bộ phụ trách",
          note: note || "Cập nhật tiến độ quy trình"
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Đã chuyển trạng thái sang ${nextStatus}`, "success");
        fetchData();
        if (selectedWorkflowDetail && selectedWorkflowDetail.id === wfId) {
          setSelectedWorkflowDetail({ ...selectedWorkflowDetail, status: nextStatus });
        }
      } else {
        showToast(data.error || "Lỗi cập nhật quy trình", "error");
      }
    } catch (e) {
      showToast("Lỗi kết nối máy chủ", "error");
    }
  };

  // Handle Post Workflow Comment
  // Trả lời trên phiếu phối hợp ngay từ cửa sổ công việc
  const [taskReplyText, setTaskReplyText] = useState("");
  const handleTaskReply = async (wf: any) => {
    const text = taskReplyText.trim();
    if (!text || !wf) return;
    try {
      const res = await fetch("/api/workflows?action=workflow_comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: wf.id, author: currentStaffName || "Nhân viên", text, attachments: [] })
      });
      const data = await res.json();
      if (!data.success) { showToast(data.error || "Không gửi được trao đổi", "error"); return; }
      setWorkflows((prev: any[]) => prev.map((w: any) => (w.id === wf.id ? { ...w, comments: data.comments } : w)));
      setTaskReplyText("");
      showToast("Đã gửi trao đổi tới bên yêu cầu", "success");
      notifyActivity({
        title: "Phản hồi phiếu phối hợp",
        message: `${currentStaffName} đã trả lời trên phiếu ${wf.workflow_code}: "${text.slice(0, 120)}"`,
        type: "info",
        category: "task",
        sender: { name: currentStaffName },
        targetEmployeeNames: [wf.requester_name === currentStaffName ? wf.assignee_name : wf.requester_name].filter(Boolean),
        targetDept: wf.requester_name === currentStaffName ? wf.target_dept : wf.requester_dept,
        link: { tab: "workspace", subTab: "workflows" }
      });
    } catch {
      showToast("Lỗi kết nối máy chủ", "error");
    }
  };

  const handlePostWorkflowComment = async () => {
    if ((!workflowCommentText.trim() && workflowCommentAttachments.length === 0) || !selectedWorkflowDetail) return;
    try {
      const res = await fetch("/api/workflows?action=workflow_comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedWorkflowDetail.id,
          author: currentStaffName || "Nhân viên",
          text: workflowCommentText.trim(),
          attachments: workflowCommentAttachments
        })
      });
      const data = await res.json();
      if (data.success) {
        const newComments = [
          ...(selectedWorkflowDetail.comments || []),
          {
            author: currentStaffName || "Nhân viên",
            text: workflowCommentText.trim(),
            time: "Vừa xong",
            attachments: workflowCommentAttachments
          }
        ];
        setSelectedWorkflowDetail({ ...selectedWorkflowDetail, comments: newComments });
        setWorkflowCommentText("");
        setWorkflowCommentAttachments([]);
        showToast("Đã gửi phản hồi trao đổi", "success");

        const isRequester = currentStaffName === selectedWorkflowDetail.requester_name;
        const targetEmployee = isRequester ? selectedWorkflowDetail.assignee_name : selectedWorkflowDetail.requester_name;
        notifyActivity({
          title: "Trao đổi liên phòng ban mới",
          message: `${currentStaffName} đã gửi trao đổi trong phiếu "${selectedWorkflowDetail.title}": "${workflowCommentText.trim().slice(0, 60)}${workflowCommentText.trim().length > 60 ? '...' : ''}"`,
          type: "info",
          category: "task",
          sender: { name: currentStaffName },
          targetEmployeeNames: targetEmployee ? [targetEmployee] : [],
          targetDept: isRequester ? selectedWorkflowDetail.target_dept : selectedWorkflowDetail.requester_dept,
          link: { tab: "workspace", subTab: "workflows" }
        });
      }
    } catch (e) {
      showToast("Lỗi khi gửi phản hồi", "error");
    }
  };

  // Sync daily items when day or staff changes
  useEffect(() => {
    const targetStaff = selectedDailyStaff || currentStaffName;
    const targetDept = rolePerspective === "manager" ? managerDept : (selectedDept === "all" ? "" : selectedDept);

    const matchingSchedules = weeklySchedule.filter(s => {
      if (s.day !== selectedDailyDay) return false;
      if (targetDept && s.category !== targetDept && rolePerspective === "manager") return false;
      if (targetStaff) {
        const actor = (s.actor || "").toLowerCase().trim();
        const target = targetStaff.toLowerCase().trim();
        return actor.includes(target) || target.includes(actor);
      }
      return true;
    });

    const itemsFromSchedule = matchingSchedules.map((s, idx) => ({
      id: `sched-${s.id || idx}`,
      title: s.title || `Công tác ${s.category || ""}`,
      source: "schedule" as const,
      category: s.category,
      location: s.location,
      status: "completed" as const,
      result: "",
      issues: "",
      work_hours: 2,
      proportionality: "balanced" as const
    }));

    setDailyPlanItems(itemsFromSchedule);
  }, [selectedDailyDay, selectedDailyStaff, weeklySchedule, rolePerspective, managerDept, selectedDept, currentStaffName]);

  // Auto-calculate daily total hours from plan items
  useEffect(() => {
    if (dailyPlanItems.length > 0) {
      const sum = dailyPlanItems.reduce((acc, it) => acc + (Number(it.work_hours) || 0), 0);
      if (sum > 0) setDailyTotalHours(sum);
    }
  }, [dailyPlanItems]);

  const updateDailyPlanItem = (id: string | number, field: string, value: any) => {
    setDailyPlanItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  const handleAddDailyExtraItem = () => {
    const newItem = {
      id: `extra-${Date.now()}`,
      title: "",
      source: "extra" as const,
      category: rolePerspective === "manager" ? managerDept : "Khác",
      location: "",
      status: "completed" as const,
      result: "",
      issues: "",
      work_hours: 2,
      proportionality: "balanced" as const
    };
    setDailyPlanItems(prev => [...prev, newItem]);
  };

  const handleRemoveDailyPlanItem = (id: string | number) => {
    setDailyPlanItems(prev => prev.filter(item => item.id !== id));
  };

  // Handle Save Daily Log with Plan Items and Evaluation
  const handleSaveDaily = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetStaff = selectedDailyStaff || currentStaffName || "Nhân viên";
    const targetDept = rolePerspective === "manager" ? managerDept : (dailyForm.department || "Kinh Doanh");

    const completedItems = dailyPlanItems.filter(p => p.status === "completed");
    
    // Construct summary work content
    const workSummary = dailyPlanItems.length > 0 
      ? dailyPlanItems.map((p, idx) => `${idx + 1}. [${p.status === "completed" ? "Đạt" : p.status === "partial" ? "Một phần" : "Chưa đạt"}] ${p.title} (${p.work_hours || 2}h)${p.result ? " -> " + p.result : ""}`).join("\n")
      : dailyForm.work_content || "Báo cáo công việc ngày";

    const resultsSummary = completedItems.map(p => p.result ? `${p.title}: ${p.result}` : p.title).join("; ") || dailyForm.result;
    const issuesSummary = dailyPlanItems.filter(p => p.issues).map(p => `${p.title}: ${p.issues}`).join("; ") || dailyForm.issues;

    const payload = {
      log_date: todayVN(),
      department: targetDept,
      employee_name: targetStaff,
      work_content: workSummary,
      result: resultsSummary,
      issues: issuesSummary,
      next_day_plan: dailyTomorrowPlan || dailyForm.next_day_plan,
      plan_items: dailyPlanItems,
      performance_rating: dailyPerformanceRating,
      work_hours: dailyTotalHours,
      proportionality_score: dailyProportionalityScore
    };

    try {
      const res = await fetch("/api/workflows?action=daily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Đã gửi báo cáo nhật ký ngày của ${targetStaff}!`, "success");
        setDailyTomorrowPlan("");
        fetchData();

        // Send Activity Notification to Manager/Department
        notifyActivity({
          title: "Báo Cáo Nhật Ký Ngày",
          message: `${targetStaff} (${targetDept}) vừa nộp báo cáo Daily ngày ${new Date().toLocaleDateString('vi-VN')}.${issuesSummary ? ' Ghi nhận vướng mắc cần hỗ trợ!' : ''}`,
          type: issuesSummary ? "warning" : "info",
          category: "daily",
          sender: { name: targetStaff },
          targetDept: targetDept,
          targetRole: "manager",
          link: { tab: "workspace", subTab: "daily" }
        });
      } else {
        showToast(data.error || "Lỗi khi lưu nhật ký", "error");
      }
    } catch (e) {
      showToast("Lỗi kết nối máy chủ", "error");
    }
  };

  // Handle Send Daily Feedback (Manager Guidance or Staff Response)
  const handleSendDailyFeedback = async (logId: number, type: "manager" | "staff", text: string) => {
    if (!text.trim()) {
      showToast("Vui lòng nhập nội dung chỉ đạo / phản hồi", "error");
      return;
    }
    try {
      const res = await fetch("/api/workflows?action=daily_feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: logId,
          type,
          text: text.trim(),
          author: currentStaffName || (type === "manager" ? "Quản lý" : "Nhân viên")
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(type === "manager" ? "Đã gửi ý kiến chỉ đạo của Quản lý!" : "Đã gửi phản hồi chỉ đạo!", "success");
        fetchData();
        setFeedbackInput(prev => ({
          ...prev,
          [logId]: {
            ...prev[logId],
            [type === "manager" ? "managerText" : "staffText"]: ""
          }
        }));

        // Send Activity Notification
        const targetLog = dailyLogs.find((l: any) => l.id === logId);
        const employeeName = targetLog?.employee_name;
        const logDept = targetLog?.department;

        if (type === "manager") {
          notifyActivity({
            title: "Chỉ đạo từ Quản lý - Nhật ký công việc",
            message: `${currentStaffName || "Quản lý"} đã ghi nhận và chỉ đạo: "${text.trim().slice(0, 80)}${text.trim().length > 80 ? '...' : ''}"`,
            type: "info",
            category: "daily",
            sender: { name: currentStaffName || "Quản lý", role: "Trưởng phòng" },
            targetEmployeeNames: employeeName ? [employeeName] : [],
            targetDept: logDept,
            link: { tab: "workspace", subTab: "daily" }
          });
        } else {
          notifyActivity({
            title: "Phản hồi chỉ đạo từ Nhân viên",
            message: `${currentStaffName || employeeName || "Nhân sự"} đã phản hồi chỉ đạo: "${text.trim().slice(0, 80)}${text.trim().length > 80 ? '...' : ''}"`,
            type: "info",
            category: "daily",
            sender: { name: currentStaffName || employeeName || "Nhân sự" },
            targetDept: logDept,
            targetRole: "manager",
            link: { tab: "workspace", subTab: "daily" }
          });
        }
      } else {
        showToast(data.error || "Lỗi khi gửi phản hồi", "error");
      }
    } catch (e) {
      showToast("Lỗi kết nối máy chủ", "error");
    }
  };

  // Handle Save Weekly Schedule Item
  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduleForm.title.trim()) {
      showToast("Vui lòng nhập nội dung lịch công tác", "error");
      return;
    }
    const dateIso = scheduleForm.date || todayVN();
    const dIdx = (new Date(dateIso + "T00:00:00").getDay() + 6) % 7;
    const dayName = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"][dIdx];
    const newItem = {
      id: editingScheduleId || Date.now(),
      day: dayName,
      date: dateIso,
      time: scheduleForm.time,
      category: scheduleForm.category,
      title: scheduleForm.title,
      actor: scheduleForm.actor,
      location: scheduleForm.location,
      attachments: scheduleForm.attachments || []
    };
    const wasEditing = editingScheduleId !== null;
    const updated = wasEditing
      ? weeklySchedule.map((s) => (s.id === editingScheduleId ? { ...s, ...newItem } : s))
      : [...weeklySchedule, newItem];
    setWeeklySchedule(updated);
    setEditingScheduleId(null);
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("unified_weekly_schedule", JSON.stringify(updated));
      }
      await fetch("/api/storage?key=unified_weekly_schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated)
      });
    } catch (err) {
      console.warn("Error saving weekly schedule:", err);
    }
    const dateLabel = `${dateIso.slice(8, 10)}/${dateIso.slice(5, 7)}`;
    showToast(wasEditing ? `Đã cập nhật lịch công tác (${dayName} ${dateLabel})` : `Đã thêm lịch công tác vào ${dayName} ${dateLabel}!`, "success");
    setIsScheduleModalOpen(false);
    if (wasEditing) { setScheduleForm((prev) => ({ ...prev, title: "", attachments: [] })); return; }

    // Send Activity Notification for Weekly Schedule
    const scheduleActors = scheduleForm.actor
      ? scheduleForm.actor.split(/[,;\n]+/).map((s: string) => s.trim()).filter(Boolean)
      : [];
    notifyActivity({
      title: "Lịch Công Tác / Sự Kiện Tuần Mới",
      message: `${currentStaffName} đã lên lịch "${scheduleForm.title}" vào ${dayName} ${dateLabel} (${scheduleForm.time}) tại ${scheduleForm.location || 'Công ty'}.`,
      type: "info",
      category: "plan",
      sender: { name: currentStaffName },
      targetEmployeeNames: scheduleActors,
      targetDept: scheduleForm.category,
      link: { tab: "workspace", subTab: "planner" }
    });

    setScheduleForm((prev) => ({ ...prev, title: "", attachments: [] }));
  };

  // Handle Delete Schedule Item
  const handleDeleteSchedule = async (id: number) => {
    const updated = weeklySchedule.filter((s) => s.id !== id);
    setWeeklySchedule(updated);
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("unified_weekly_schedule", JSON.stringify(updated));
      }
      await fetch("/api/storage?key=unified_weekly_schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated)
      });
    } catch (err) {
      console.warn("Error deleting weekly schedule:", err);
    }
    showToast("Đã xóa lịch trình", "info");
  };

  // Open Create Thematic Project Modal
  const openCreateThematicModal = (deptOverride?: string) => {
    setEditingThematicId(null);
    const targetDept = deptOverride || (rolePerspective === "manager" ? managerDept : (selectedDept === "all" ? "Application" : selectedDept));
    const availableTypes = DEPARTMENT_THEMATIC_TYPES[targetDept] || DEPARTMENT_THEMATIC_TYPES["Application"] || [];
    const firstType = availableTypes[0];
    const prefix = firstType?.codePrefix || "PRJ";
    const existingCount = labProjects.filter((p: any) => p.dept === targetDept).length + 1;
    const newId = `${prefix}-${existingCount < 10 ? "0" + existingCount : existingCount}`;
    const defaultStages = (firstType?.defaultStages || []).map((s, idx) => ({
      id: `stg-${Date.now()}-${idx}`,
      name: s.name,
      status: "pending" as const,
      estimatedDays: s.estimatedDays
    }));
    const defaultLead = selectedAssignee !== "all" ? selectedAssignee : (departmentStaffList[0]?.full_name || currentStaffName);

    setLabProjectForm({
      id: newId,
      name: "",
      dept: targetDept,
      typeId: firstType?.id || "",
      typeName: firstType?.name || "",
      lead: defaultLead,
      collaborators: [],
      startDate: todayVN(),
      endDate: "",
      slot: "Toàn thời gian (Theo tiến trình)",
      priority: "Cao",
      status: "Active",
      tasksCount: 0,
      budget: "",
      description: firstType?.sampleObjectives || "",
      stages: defaultStages
    });
    setIsLabProjectModalOpen(true);
  };

  // Open Edit Thematic Project Modal
  const openEditThematicModal = (prj: any) => {
    setEditingThematicId(prj.id);
    setLabProjectForm({
      id: prj.id,
      name: prj.name || "",
      dept: prj.dept || "Application",
      typeId: prj.typeId || "",
      typeName: prj.typeName || "",
      lead: prj.lead || currentStaffName,
      collaborators: prj.collaborators || [],
      startDate: prj.startDate || "",
      endDate: prj.endDate || "",
      slot: prj.slot || "Toàn thời gian (Theo tiến trình)",
      priority: prj.priority || "Cao",
      status: prj.status || "Active",
      tasksCount: prj.tasksCount || 0,
      budget: prj.budget || "",
      description: prj.description || "",
      stages: prj.stages || []
    });
    setIsLabProjectModalOpen(true);
  };

  // Handle Changing Department inside Modal
  const handleThematicDeptChange = (newDept: string) => {
    const availableTypes = DEPARTMENT_THEMATIC_TYPES[newDept] || DEPARTMENT_THEMATIC_TYPES["Application"] || [];
    const firstType = availableTypes[0];
    const prefix = firstType?.codePrefix || "PRJ";
    const existingCount = labProjects.filter((p: any) => p.dept === newDept).length + 1;
    const newId = `${prefix}-${existingCount < 10 ? "0" + existingCount : existingCount}`;
    const defaultStages = (firstType?.defaultStages || []).map((s, idx) => ({
      id: `stg-${Date.now()}-${idx}`,
      name: s.name,
      status: "pending" as const,
      estimatedDays: s.estimatedDays
    }));
    setLabProjectForm(prev => ({
      ...prev,
      dept: newDept,
      id: newId,
      typeId: firstType?.id || "",
      typeName: firstType?.name || "",
      description: firstType?.sampleObjectives || "",
      stages: defaultStages
    }));
  };

  // Handle Changing Thematic Type inside Modal
  const handleThematicTypeChange = (typeDef: ThematicTypeDefinition) => {
    const existingCount = labProjects.filter((p: any) => p.dept === labProjectForm.dept).length + 1;
    const newId = `${typeDef.codePrefix}-${existingCount < 10 ? "0" + existingCount : existingCount}`;
    const defaultStages = (typeDef.defaultStages || []).map((s, idx) => ({
      id: `stg-${Date.now()}-${idx}`,
      name: s.name,
      status: "pending" as const,
      estimatedDays: s.estimatedDays
    }));
    setLabProjectForm(prev => ({
      ...prev,
      typeId: typeDef.id,
      typeName: typeDef.name,
      id: newId,
      description: typeDef.sampleObjectives,
      stages: defaultStages
    }));
  };

  // Handle Save / Update Thematic Project
  const handleSaveLabProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!labProjectForm.name.trim()) {
      showToast("Vui lòng nhập tên kế hoạch chuyên đề", "error");
      return;
    }
    const projectData = {
      id: labProjectForm.id || `PRJ-0${labProjects.length + 1}`,
      name: labProjectForm.name.trim(),
      dept: labProjectForm.dept,
      typeId: labProjectForm.typeId,
      typeName: labProjectForm.typeName,
      lead: labProjectForm.lead || currentStaffName,
      collaborators: labProjectForm.collaborators || [],
      startDate: labProjectForm.startDate,
      endDate: labProjectForm.endDate,
      slot: labProjectForm.slot,
      priority: labProjectForm.priority,
      status: labProjectForm.status || "Active",
      tasksCount: labProjectForm.tasksCount || 0,
      budget: labProjectForm.budget,
      description: labProjectForm.description,
      stages: labProjectForm.stages || []
    };

    let updated: any[];
    if (editingThematicId) {
      updated = labProjects.map(p => p.id === editingThematicId ? { ...p, ...projectData } : p);
      showToast(`Đã cập nhật chuyên đề: ${projectData.name}!`, "success");
      notifyActivity({
        title: "Cập nhật Kế hoạch Chuyên đề",
        message: `${currentStaffName} đã cập nhật chuyên đề [${projectData.id}] "${projectData.name}".`,
        type: "info",
        category: "plan",
        sender: { name: currentStaffName },
        targetEmployeeNames: [projectData.lead, ...(projectData.collaborators || [])].filter(Boolean),
        targetDept: projectData.dept,
        link: { tab: "workspace", subTab: "planner" }
      });
    } else {
      updated = [...labProjects, projectData];
      showToast(`Đã tạo kế hoạch chuyên đề: ${projectData.name}!`, "success");
      notifyActivity({
        title: "Kế hoạch Chuyên đề Mới",
        message: `${currentStaffName} đã giao/tạo chuyên đề [${projectData.id}] "${projectData.name}" cho chủ trì ${projectData.lead}.`,
        type: "success",
        category: "plan",
        sender: { name: currentStaffName },
        targetEmployeeNames: [projectData.lead, ...(projectData.collaborators || [])].filter(Boolean),
        targetDept: projectData.dept,
        link: { tab: "workspace", subTab: "planner" }
      });
    }

    setLabProjects(updated);
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("unified_thematic_projects", JSON.stringify(updated));
      }
      await fetch("/api/storage?key=unified_thematic_projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated)
      });
    } catch (err) {
      console.warn("Error saving thematic projects:", err);
    }
    setIsLabProjectModalOpen(false);
    setEditingThematicId(null);
  };

  // Handle Toggle Stage Completion directly from Project Card or Modal with Regression Guard
  const handleToggleStage = async (projectId: string, stageId: string) => {
    const targetPrj = labProjects.find(p => p.id === projectId);
    const targetStage = (targetPrj?.stages || []).find((s: any) => s.id === stageId);
    
    // Safety Guard: Chống lùi bước vô ý khi click nhầm vào giai đoạn đã hoàn thành
    if (targetStage?.status === "completed") {
      const confirmReopen = confirm(
        `[CẢNH BÁO LÙI BƯỚC TIẾN TRÌNH]\n\nGiai đoạn "${targetStage.title || targetStage.name || 'này'}" đã được nghiệm thu HOÀN THÀNH.\nBạn có chắc chắn muốn MỞ LẠI (Lùi bước tiến trình về Đang chờ) không?\n\nThao tác này sẽ yêu cầu phải nghiệm thu lại từ đầu!`
      );
      if (!confirmReopen) return;
    }

    const updated = labProjects.map(p => {
      if (p.id !== projectId) return p;
      const updatedStages = (p.stages || []).map((stg: any) => {
        if (stg.id !== stageId) return stg;
        const nextStatus = stg.status === "completed" ? "pending" : "completed";
        return { ...stg, status: nextStatus };
      });
      const allCompleted = updatedStages.length > 0 && updatedStages.every((s: any) => s.status === "completed");
      const anyCompleted = updatedStages.some((s: any) => s.status === "completed" || s.status === "in_progress");
      let newPrjStatus = p.status;
      if (allCompleted) newPrjStatus = "Completed";
      else if (anyCompleted && p.status === "Planning") newPrjStatus = "Active";
      return { ...p, stages: updatedStages, status: newPrjStatus };
    });

    setLabProjects(updated);
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("unified_thematic_projects", JSON.stringify(updated));
      }
      await fetch("/api/storage?key=unified_thematic_projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated)
      });
    } catch (err) {
      console.warn("Error updating thematic stage:", err);
    }
    showToast("Đã cập nhật tiến độ giai đoạn chuyên đề!", "info");

    const prjAfter = labProjects.find(p => p.id === projectId);
    if (prjAfter) {
      const targetStage = (prjAfter.stages || []).find((s: any) => s.id === stageId);
      const isNowCompleted = targetStage?.status !== "completed";
      notifyActivity({
        title: isNowCompleted ? "Hoàn thành giai đoạn chuyên đề" : "Cập nhật giai đoạn chuyên đề",
        message: `${currentStaffName} đã cập nhật giai đoạn "${targetStage?.name || 'Giai đoạn'}" của chuyên đề "${prjAfter.name}" (${isNowCompleted ? 'Hoàn thành' : 'Đang xử lý'}).`,
        type: isNowCompleted ? "success" : "info",
        category: "plan",
        sender: { name: currentStaffName },
        targetEmployeeNames: [prjAfter.lead, ...(prjAfter.collaborators || [])].filter(Boolean),
        targetDept: prjAfter.dept,
        link: { tab: "workspace", subTab: "planner" }
      });
    }
  };

  // Handle Delete Thematic Project
  const handleDeleteThematicProject = async (id: string) => {
    const updated = labProjects.filter(p => p.id !== id);
    setLabProjects(updated);
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("unified_thematic_projects", JSON.stringify(updated));
      }
      await fetch("/api/storage?key=unified_thematic_projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated)
      });
    } catch (err) {
      console.warn("Error deleting thematic project:", err);
    }
    showToast("Đã xóa chuyên đề thành công", "info");
  };

  // Handle Save Sales Target
  const handleSaveSalesTarget = (e: React.FormEvent) => {
    e.preventDefault();
    if (!salesTargetForm.customer.trim()) {
      showToast("Vui lòng nhập tên khách hàng / bệnh viện", "error");
      return;
    }
    const rawVal = parseFloat(salesTargetForm.amount.replace(/[^0-9.]/g, "")) || 1.0;
    const formattedAmount = salesTargetForm.amount.includes("Tỷ") || salesTargetForm.amount.includes("triệu") 
      ? salesTargetForm.amount 
      : `${rawVal} Tỷ VNĐ`;
    const newTarget = {
      id: Date.now(),
      customer: salesTargetForm.customer,
      amount: formattedAmount,
      rawAmount: rawVal,
      quarter: salesTargetForm.quarter,
      lead: salesTargetForm.lead,
      description: salesTargetForm.description,
      stage: salesTargetForm.stage
    };
    setSalesTargets((prev) => [...prev, newTarget]);
    showToast(`Đã thiết lập mục tiêu cho ${newTarget.customer}!`, "success");
    setIsSalesTargetModalOpen(false);
  };

  return (
    <div className="space-y-4 w-full pb-12">
      {/* ==================== LEVEL 1: MASTER HEADER & FEATURE TABS ==================== */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
              <LayoutDashboard className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                ĐIỀU HÀNH CÔNG VIỆC &amp; PHỐI HỢP LIÊN PHÒNG BAN
              </h1>
              <p className="text-xs text-slate-500">
                Không gian làm việc tập trung toàn công ty • Phân ban, phối hợp liên phòng, lịch &amp; nhật ký Daily
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start md:self-auto">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              Tổng việc: <strong className="text-slate-900 dark:text-white">{stats.totalTasks}</strong>
            </span>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300">
              Đang làm: <strong className="text-blue-900 dark:text-blue-200">{stats.inProgressTasks}</strong>
            </span>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300">
              Liên phòng: <strong className="text-purple-900 dark:text-purple-200">{stats.pendingWf}</strong>
            </span>
          </div>
        </div>

        {/* Clean Primary Navigation Tabs */}
        <div className="flex items-center gap-1.5 pt-3 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveSubTab("tasks")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
              activeSubTab === "tasks"
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/20"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <ListTodo className="w-4 h-4" />
            <span>Bảng Công Việc</span>
            <span className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] ${activeSubTab === "tasks" ? "bg-white/20 text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300"}`}>
              {stats.totalTasks}
            </span>
          </button>

          <button
            onClick={() => setActiveSubTab("workflows")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
              activeSubTab === "workflows"
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/20"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Quy Trình Phối Hợp</span>
            {stats.pendingWf > 0 && (
              <span className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold ${activeSubTab === "workflows" ? "bg-white/20 text-white" : "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"}`}>
                {stats.pendingWf}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveSubTab("planner")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
              activeSubTab === "planner"
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/20"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>Lịch &amp; Kế Hoạch Chuyên Đề</span>
          </button>

          <button
            onClick={() => setActiveSubTab("daily")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
              activeSubTab === "daily"
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/20"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <CalendarDays className="w-4 h-4" />
            <span>Nhật Ký Daily</span>
          </button>

          <button
            onClick={() => setActiveSubTab("analytics")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
              activeSubTab === "analytics"
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/20"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Hiệu Suất &amp; KPI</span>
          </button>
        </div>
      </div>

      {/* ==================== LEVEL 2: UNIFIED FILTER & ACTION BAR ==================== */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Left: Department Dropdown + Search + Status */}
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          {/* Department Selector with Staff Personal Locking */}
          {rolePerspective === "staff" ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80 shrink-0">
              <Lock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Kế hoạch cá nhân: {currentStaffName}</span>
            </div>
          ) : (
            <div className="relative shrink-0">
              <select
                value={selectedDept}
                onChange={(e) => setSelectedDept(e.target.value)}
                className="appearance-none pl-8 pr-8 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white border border-transparent hover:border-slate-300 dark:hover:border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer transition-all"
              >
                {DEPARTMENTS.map((d) => (
                  <option key={d.id} value={d.id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white py-1">
                    {d.id === "all"
                      ? "🏢 Toàn công ty"
                      : d.id === "Kinh Doanh"
                      ? "💼 Kinh Doanh"
                      : d.id === "Application"
                      ? "🔬 Application (Kỹ Thuật & Ứng Dụng)"
                      : d.id === "Kho & Vận Hành"
                      ? "📦 Kho & Vận Hành"
                      : d.id === "Cung Ứng"
                      ? "🛒 Mua Hàng & Cung Ứng"
                      : "⚖️ Pháp Chế & Tuân Thủ"}
                  </option>
                ))}
              </select>
              <Filter className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500" />
              <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
            </div>
          )}

          {/* Staff / Assignee Filter Dropdown */}
          {(activeSubTab === "tasks" || activeSubTab === "planner") && (rolePerspective === "manager" || rolePerspective === "director") && (
            <div className="relative shrink-0 min-w-[170px]">
              <User className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <select
                value={selectedAssignee}
                onChange={(e) => setSelectedAssignee(e.target.value)}
                className="w-full appearance-none pl-8 pr-8 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white border border-transparent hover:border-slate-300 dark:hover:border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer transition-all truncate"
                title="Lọc công việc & lịch công tác theo từng nhân viên trong phòng ban"
              >
                <option value="all">
                  {selectedDept === "all" ? "👥 Tất cả nhân sự" : `👥 Tất cả (${departmentStaffList.length} người)`}
                </option>
                {activeSubTab === "tasks" && (
                  <option value="__UNASSIGNED__">
                    ⏳ Chờ phân công ({tasks.filter(t => (selectedDept === "all" || isSameWorkspaceDept(t.department, selectedDept)) && !cleanWorkspaceAssignee(t.assignee_name)).length})
                  </option>
                )}
                {departmentStaffList.map((p: any) => {
                  const name = p.full_name || p;
                  const code = p.employee_code ? ` (${p.employee_code})` : "";
                  const count = activeSubTab === "planner"
                    ? weeklySchedule.filter(s => {
                        const matchesDept = selectedDept === "all" || isSameWorkspaceDept(s.category, selectedDept);
                        const actor = (s.actor || "").toLowerCase().trim();
                        const target = name.toLowerCase().trim();
                        return matchesDept && (actor.includes(target) || target.includes(actor));
                      }).length
                    : tasks.filter(t => {
                        const matchesDept = selectedDept === "all" || isSameWorkspaceDept(t.department, selectedDept);
                        const cleanAss = cleanWorkspaceAssignee(t.assignee_name);
                        return matchesDept && cleanAss && cleanAss.toLowerCase().includes(name.toLowerCase());
                      }).length;
                  return (
                    <option key={p.id || p.employee_code || name} value={name}>
                      {name}{code} {count > 0 ? `(${count})` : ""}
                    </option>
                  );
                })}
              </select>
              <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          )}

          {/* Search Bar */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm theo tiêu đề, mã việc, nhân viên, khách hàng..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Status Filter (when on tasks tab) */}
          {activeSubTab === "tasks" && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-xs px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-semibold"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="TODO">Cần làm</option>
              <option value="IN_PROGRESS">Đang làm</option>
              <option value="DONE">Hoàn tất</option>
            </select>
          )}
        </div>

        {/* Right: Dynamic Actions strictly per active tab */}
        <div className="flex items-center gap-2 shrink-0 justify-between md:justify-end">
          {/* TAB 1: BẢNG CÔNG VIỆC -> CHỈ hiển thị chuyển chế độ và nút Tạo Việc Mới */}
          {activeSubTab === "tasks" && (
            <>
              <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl mr-1">
                <button
                  onClick={() => setViewMode("kanban")}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg ${viewMode === "kanban" ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs" : "text-slate-500"}`}
                >
                  Kanban
                </button>
                <button
                  onClick={() => setViewMode("table")}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg ${viewMode === "table" ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs" : "text-slate-500"}`}
                >
                  Bảng
                </button>
              </div>

              <button
                onClick={() => {
                  const defaultDept = rolePerspective === "manager" ? managerDept : (selectedDept === "all" ? userDept || "Kinh Doanh" : selectedDept);
                  setTaskForm({
                    id: null,
                    title: "",
                    department: defaultDept,
                    task_category: DEPARTMENT_CATEGORIES[defaultDept]?.[0] || "Chung",
                    assignee_name: currentStaffName,
                    customer_name: "",
                    priority: "MEDIUM",
                    status: "TODO",
                    deadline: todayVN(),
                    description: "",
                    result: "",
                    attachments: []
                  });
                  setIsTaskModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition-all shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tạo Việc Mới</span>
              </button>
            </>
          )}

          {/* TAB 2: QUY TRÌNH PHỐI HỢP -> Nút Tạo Quy Trình Mới & Khởi tạo phiếu phối hợp */}
          {activeSubTab === "workflows" && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleOpenCreateTemplate}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-all shadow-2xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Tạo Quy Trình Mới</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const defaultTmpl = (workflowTemplates.length > 0 ? workflowTemplates : DEFAULT_WORKFLOW_TEMPLATES)[0];
                  if (defaultTmpl) {
                    handleInitiateFromTemplate(defaultTmpl);
                  } else {
                    setIsWorkflowModalOpen(true);
                  }
                }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white transition-all shadow-xs"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Khởi Tạo Phiếu Phối Hợp</span>
              </button>
            </div>
          )}

          {/* TAB 3: LỊCH & KẾ HOẠCH -> Hiển thị đúng nút của phân khu đang chọn */}
          {activeSubTab === "planner" && (
            <>
              {plannerView === "calendar" && (
                <button
                  onClick={() => {
                    setScheduleForm({
                      day: "Thứ 2",
                      time: "08:30",
                      category: rolePerspective === "manager" ? managerDept : (selectedDept === "all" ? "Application" : selectedDept),
                      title: "",
                      actor: currentStaffName,
                      location: "BV Chợ Rẫy"
                    });
                    setIsScheduleModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition-all shadow-xs"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Thêm Lịch Tuần</span>
                </button>
              )}

              {plannerView === "lab_projects" && (
                <button
                  onClick={() => openCreateThematicModal()}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white transition-all shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Tạo Kế Hoạch Chuyên Đề</span>
                </button>
              )}

              {plannerView === "sales_targets" && rolePerspective !== "staff" && (
                <button
                  onClick={() => {
                    setSalesTargetForm({
                      customer: "",
                      amount: "2.5 Tỷ VNĐ",
                      quarter: "Q4/2026",
                      lead: currentStaffName,
                      description: "",
                      stage: "Đang chào giá & Demo"
                    });
                    setIsSalesTargetModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-all shadow-xs"
                >
                  <Target className="w-3.5 h-3.5" />
                  <span>Đặt Mục Tiêu Doanh Số</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ==================== LEVEL 3: TAB CONTENTS ==================== */}

      {/* TAB 1: BẢNG CÔNG VIỆC (TASKS & KANBAN) */}
      {activeSubTab === "tasks" && (
        <div className="space-y-3.5">
          {/* Quick Staff Member Filter Chips */}
          {(rolePerspective === "manager" || rolePerspective === "director") && departmentStaffList.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5 no-scrollbar text-xs">
              <span className="text-[11px] font-bold text-slate-400 shrink-0 mr-1 flex items-center gap-1">
                <Users className="w-3.5 h-3.5 text-indigo-400" />
                <span>Xem theo nhân sự:</span>
              </span>
              <button
                type="button"
                onClick={() => setSelectedAssignee("all")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                  selectedAssignee === "all"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                }`}
              >
                Tất cả ({departmentStaffList.length})
              </button>
              {(() => {
                const unassignedCount = tasks.filter(t => {
                  const matchesDept = selectedDept === "all" || isSameWorkspaceDept(t.department, selectedDept);
                  return matchesDept && !cleanWorkspaceAssignee(t.assignee_name);
                }).length;
                if (unassignedCount === 0 && selectedAssignee !== "__UNASSIGNED__") return null;
                const isSelected = selectedAssignee === "__UNASSIGNED__";
                return (
                  <button
                    type="button"
                    onClick={() => setSelectedAssignee(isSelected ? "all" : "__UNASSIGNED__")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer border ${
                      isSelected
                        ? "bg-amber-600 text-white border-amber-600 shadow-xs"
                        : "bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800 hover:bg-amber-100"
                    }`}
                  >
                    <span>⏳ Chờ phân công</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold font-mono ${
                      isSelected ? "bg-white/20 text-white" : "bg-amber-200/80 dark:bg-amber-900 text-amber-900 dark:text-amber-200"
                    }`}>
                      {unassignedCount}
                    </span>
                  </button>
                );
              })()}
              {departmentStaffList.map((p: any) => {
                const name = p.full_name || p;
                const count = tasks.filter(t => {
                  const matchesDept = selectedDept === "all" || isSameWorkspaceDept(t.department, selectedDept);
                  const cleanAss = cleanWorkspaceAssignee(t.assignee_name);
                  return matchesDept && cleanAss && cleanAss.toLowerCase().includes(name.toLowerCase());
                }).length;
                const isSelected = selectedAssignee === name;
                return (
                  <button
                    key={p.id || p.employee_code || name}
                    type="button"
                    onClick={() => setSelectedAssignee(isSelected ? "all" : name)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all shrink-0 cursor-pointer border ${
                      isSelected
                        ? "bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border-indigo-400 dark:border-indigo-600 font-bold shadow-xs ring-2 ring-indigo-500/20"
                        : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    }`}
                  >
                    <span>{name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold font-mono ${
                      count > 0 ? "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400" : "bg-slate-100 dark:bg-slate-800 text-slate-400"
                    }`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {viewMode === "kanban" ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Column 1: TODO */}
              <div className="bg-slate-100/70 dark:bg-slate-900/60 rounded-2xl p-3.5 border border-slate-200/80 dark:border-slate-800">
                <div className="flex items-center justify-between pb-2.5 border-b border-slate-200 dark:border-slate-800 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                    <span className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                      Cần Làm (TODO)
                    </span>
                  </div>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400">
                    {filteredTasks.filter((t) => t.status === "TODO").length}
                  </span>
                </div>

                <div className="space-y-2.5 min-h-[300px]">
                  {filteredTasks
                    .filter((t) => t.status === "TODO")
                    .map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onStatusChange={handleQuickStatusChange}
                        onEdit={openEditTask}
                      />
                    ))}
                  {filteredTasks.filter((t) => t.status === "TODO").length === 0 && (
                    <div className="text-center py-12 text-xs text-slate-400 italic">Không có công việc nào</div>
                  )}
                </div>
              </div>

              {/* Column 2: IN_PROGRESS */}
              <div className="bg-slate-100/70 dark:bg-slate-900/60 rounded-2xl p-3.5 border border-slate-200/80 dark:border-slate-800">
                <div className="flex items-center justify-between pb-2.5 border-b border-slate-200 dark:border-slate-800 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
                    <span className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                      Đang Thực Hiện
                    </span>
                  </div>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400">
                    {filteredTasks.filter((t) => t.status === "IN_PROGRESS").length}
                  </span>
                </div>

                <div className="space-y-2.5 min-h-[300px]">
                  {filteredTasks
                    .filter((t) => t.status === "IN_PROGRESS")
                    .map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onStatusChange={handleQuickStatusChange}
                        onEdit={openEditTask}
                      />
                    ))}
                  {filteredTasks.filter((t) => t.status === "IN_PROGRESS").length === 0 && (
                    <div className="text-center py-12 text-xs text-slate-400 italic">Không có công việc nào</div>
                  )}
                </div>
              </div>

              {/* Column 3: DONE */}
              <div className="bg-slate-100/70 dark:bg-slate-900/60 rounded-2xl p-3.5 border border-slate-200/80 dark:border-slate-800">
                <div className="flex items-center justify-between pb-2.5 border-b border-slate-200 dark:border-slate-800 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                      Đã Hoàn Tất
                    </span>
                  </div>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400">
                    {filteredTasks.filter((t) => t.status === "DONE").length}
                  </span>
                </div>

                <div className="space-y-2.5 min-h-[300px]">
                  {filteredTasks
                    .filter((t) => t.status === "DONE")
                    .map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onStatusChange={handleQuickStatusChange}
                        onEdit={openEditTask}
                      />
                    ))}
                  {filteredTasks.filter((t) => t.status === "DONE").length === 0 && (
                    <div className="text-center py-12 text-xs text-slate-400 italic">Không có công việc nào</div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Table View */
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Mã việc</th>
                    <th className="py-3 px-4">Tiêu đề công việc</th>
                    <th className="py-3 px-4">Phòng ban</th>
                    <th className="py-3 px-4">Phân loại</th>
                    <th className="py-3 px-4">Người phụ trách</th>
                    <th className="py-3 px-4">Khách hàng</th>
                    <th className="py-3 px-4">Ưu tiên</th>
                    <th className="py-3 px-4">Hạn chót</th>
                    <th className="py-3 px-4">Trạng thái</th>
                    <th className="py-3 px-4 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredTasks.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-slate-500">{t.task_code}</td>
                      <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                        {t.title}
                        {t.related_workflow_code && (
                          <span className="ml-2 text-[10px] text-purple-600 dark:text-purple-400 font-normal">
                            (🔗 {t.related_workflow_code})
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">{t.department}</td>
                      <td className="py-3 px-4 text-slate-500">{t.task_category}</td>
                      <td className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">
                        {cleanWorkspaceAssignee(t.assignee_name) || (
                          <span className="text-amber-600 dark:text-amber-400 font-bold">⏳ Chờ phân công</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-500">{t.customer_name || "—"}</td>
                      <td className="py-3 px-4"><PriorityBadge priority={t.priority} /></td>
                      <td className="py-3 px-4 font-mono text-slate-500">{t.deadline ? t.deadline.slice(0, 10) : "—"}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          t.status === "DONE" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" :
                          t.status === "IN_PROGRESS" ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300" :
                          "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                        }`}>
                          {t.status === "DONE" ? "Hoàn tất" : t.status === "IN_PROGRESS" ? "Đang làm" : "Cần làm"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => openEditTask(t)}
                          className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 font-bold"
                        >
                          {cleanWorkspaceAssignee(t.assignee_name) ? "Sửa" : "Phân công / Sửa"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredTasks.length === 0 && (
                    <tr>
                      <td colSpan={10} className="text-center py-8 text-slate-400 italic">
                        Không có công việc nào phù hợp với bộ lọc
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: QUY TRÌNH PHỐI HỢP LIÊN PHÒNG BAN */}
      {activeSubTab === "workflows" && (
        <div className="space-y-4">
          {/* Quy trình mẫu: mặc định 1 thanh "Phát lệnh nhanh", bấm "Chi tiết" để xem dạng thẻ (mô tả, sửa / xóa) */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 shadow-xs flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200 shrink-0">Phát lệnh nhanh:</span>
            {!templatesExpanded && (workflowTemplates.length > 0 ? workflowTemplates : DEFAULT_WORKFLOW_TEMPLATES).map((wf: any) => {
              const Icon = getWorkflowIcon(wf.icon);
              const stepsCount = Array.isArray(wf.steps) ? wf.steps.length : 3;
              return (
                <button
                  key={wf.id || wf.code}
                  type="button"
                  onClick={() => handleInitiateFromTemplate(wf)}
                  title={`${wf.name}
${wf.source_dept || wf.sourceDept || ""} ➔ ${wf.target_dept || wf.targetDept || ""} · ${stepsCount} bước
${wf.description || ""}`}
                  className="inline-flex items-center gap-1.5 max-w-[260px] px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60 transition-colors cursor-pointer"
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{wf.name}</span>
                </button>
              );
            })}
            {templatesExpanded && <span className="text-[11px] text-slate-400">Chọn quy trình ở các thẻ bên dưới</span>}
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleOpenCreateTemplate}
                className="px-2.5 py-1 rounded-lg text-xs font-bold border border-dashed border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 cursor-pointer"
              >
                + Quy trình mới
              </button>
              <button
                type="button"
                onClick={() => setTemplatesExpanded(v => { const n = !v; try { localStorage.setItem("ws_templates_expanded", n ? "1" : "0"); } catch {} return n; })}
                className="px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer flex items-center gap-1"
              >
                {templatesExpanded ? <>Thu gọn <ChevronUp className="w-3.5 h-3.5" /></> : <>Chi tiết <ChevronDown className="w-3.5 h-3.5" /></>}
              </button>
            </div>
          </div>

          {templatesExpanded && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {(workflowTemplates.length > 0 ? workflowTemplates : DEFAULT_WORKFLOW_TEMPLATES).map((wf: any) => {
              const Icon = getWorkflowIcon(wf.icon);
              const stepsCount = Array.isArray(wf.steps) ? wf.steps.length : 3;
              const isCustom = !["SALES_TO_APP", "SALES_TO_WAREHOUSE", "TO_PROCUREMENT", "APP_TO_WAREHOUSE", "SALES_TO_LEGAL"].includes(String(wf.code || wf.id).toUpperCase());

              return (
                <div
                  key={wf.id || wf.code}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-xs flex flex-col justify-between hover:border-indigo-300 dark:hover:border-indigo-700 transition-all group relative"
                >
                  {canManageTemplates && (
                  <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleEditTemplate(wf); }}
                      className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                      title="Chỉnh sửa quy trình này"
                    >
                      <FileText className="w-3.5 h-3.5" />
                    </button>
                    {isCustom && typeof wf.id === "number" && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(wf.id); }}
                        className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                        title="Xóa quy trình này"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  )}

                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0 pr-4">
                        <span className="text-xs font-bold text-slate-900 dark:text-white leading-tight block truncate" title={wf.name}>
                          {wf.name}
                        </span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] font-semibold text-slate-400">
                            {wf.source_dept || wf.sourceDept} ➔ {wf.target_dept || wf.targetDept}
                          </span>
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 border border-indigo-200/50">
                            {stepsCount} bước
                          </span>
                        </div>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed mb-3 line-clamp-2" title={wf.description}>
                      {wf.description}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleInitiateFromTemplate(wf)}
                    className="w-full py-1.5 px-3 rounded-lg text-xs font-bold bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 transition-colors flex items-center justify-center gap-1"
                  >
                    <span>+ Phát lệnh phiếu này</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}

            {/* Quick Add Custom Workflow Card */}
            <div
              onClick={handleOpenCreateTemplate}
              className="border-2 border-dashed border-indigo-200 hover:border-indigo-400 dark:border-indigo-900/60 dark:hover:border-indigo-600 rounded-xl p-3.5 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 transition-all min-h-[140px] group"
            >
              <div className="w-9 h-9 rounded-xl bg-indigo-50 group-hover:bg-indigo-100 dark:bg-indigo-950/60 dark:group-hover:bg-indigo-900/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-2 transition-transform group-hover:scale-110">
                <Plus className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300">
                + Thêm Quy Trình Mới
              </span>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 max-w-[180px]">
                Thiết lập quy trình và các bước thực hiện cho bất kỳ phòng ban nào
              </p>
            </div>
          </div>
          )}

          {/* Workflow List */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Danh Sách Phiếu Phối Hợp Đang Luân Chuyển
                </h3>
                <p className="text-xs text-slate-500">
                  Theo dõi tiến độ, trao đổi liên bộ phận và bàn giao biên bản kết quả kỹ thuật
                </p>
              </div>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                {listWorkflows.length} / {filteredWorkflows.length} phiếu
              </span>
            </div>

            {/* Bộ lọc danh sách phiếu */}
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2 text-xs bg-slate-50/60 dark:bg-slate-950/30">
              <div className="flex flex-wrap items-center gap-1">
                {([
                  ["open", "Đang mở"],
                  ["PENDING", "Chờ tiếp nhận"],
                  ["WORKING", "Đang xử lý"],
                  ["REVIEW", "Đã có kết quả"],
                  ["COMPLETED", "Hoàn tất"],
                  ["OVERDUE", "⚠ Quá hạn"],
                  ["all", "Tất cả"],
                ] as const).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setWfStatusFilter(k)}
                    className={`px-2.5 py-1 rounded-lg font-semibold cursor-pointer transition-colors ${
                      wfStatusFilter === k
                        ? (k === "OVERDUE" ? "bg-rose-600 text-white" : "bg-indigo-600 text-white")
                        : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700"
                    }`}
                  >
                    {label} <span className="opacity-80">({wfCounts[k] ?? 0})</span>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2 ml-auto">
                <select
                  value={wfMineFilter}
                  onChange={(e) => setWfMineFilter(e.target.value as any)}
                  className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold"
                >
                  <option value="all">Mọi phiếu</option>
                  <option value="requested">Tôi yêu cầu</option>
                  <option value="assigned">Tôi phụ trách</option>
                </select>
                <select
                  value={wfPriorityFilter}
                  onChange={(e) => setWfPriorityFilter(e.target.value)}
                  className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold"
                >
                  <option value="all">Mọi mức ưu tiên</option>
                  <option value="URGENT">Khẩn cấp</option>
                  <option value="HIGH">Cao</option>
                  <option value="MEDIUM">Trung bình</option>
                  <option value="LOW">Thấp</option>
                </select>
                <select
                  value={wfSort}
                  onChange={(e) => setWfSort(e.target.value as any)}
                  className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold"
                >
                  <option value="newest">Mới nhất trước</option>
                  <option value="deadline">Hạn chót gần nhất</option>
                  <option value="priority">Ưu tiên cao trước</option>
                </select>
              </div>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {listWorkflows.map((wf) => {
                const wfSteps = Array.isArray(wf.steps) ? wf.steps : [];
                const currentIdx = typeof wf.current_step_index === "number" ? wf.current_step_index : 0;
                const hasSteps = wfSteps.length > 0;
                const currentStepDept = (hasSteps && wfSteps[currentIdx]?.dept) ? wfSteps[currentIdx].dept : wf.target_dept;
                const currentAssignee = cleanWorkspaceAssignee(hasSteps && wfSteps[currentIdx]?.assignee_name ? wfSteps[currentIdx].assignee_name : wf.assignee_name);
                const canAssignThisWf = isDirector || isSameWorkspaceDept(userDept, currentStepDept) || isSameWorkspaceDept(userDept, wf.target_dept);
                const targetDeptStaff = personnelList.filter((p: any) => isSameWorkspaceDept(p.department, currentStepDept));

                return (
                  <div key={wf.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                    <div className="space-y-3">
                      {/* Ticket Header & Metadata */}
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                        <div className="space-y-1.5 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs font-extrabold text-indigo-600 dark:text-indigo-400">
                              {wf.workflow_code}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                              {wf.requester_dept} ──► {wf.target_dept}
                            </span>
                            <WorkflowStatusBadge status={wf.status} />
                            <PriorityBadge priority={wf.priority} />
                          </div>

                          <h4 className="text-sm font-bold text-slate-900 dark:text-white">{wf.title}</h4>

                          <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                            <span>
                              <strong>Khách hàng:</strong> {wf.customer_name || "Nội bộ TBRs"}
                            </span>
                            {wf.product_info && (
                              <span>
                                <strong>Sản phẩm / TB:</strong> {wf.product_info}
                              </span>
                            )}
                            <span>
                              <strong>Người yêu cầu:</strong> {wf.requester_name}
                            </span>
                            <span className="inline-flex items-center gap-1.5 flex-wrap">
                              <strong>Người tiếp nhận hiện tại ({currentStepDept}):</strong>{" "}
                              {currentAssignee ? (
                                <span className="px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold border border-indigo-200 dark:border-indigo-800">
                                  👤 {currentAssignee}
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-bold border border-amber-200 dark:border-amber-800">
                                  ⏳ Chờ {currentStepDept} phân công
                                </span>
                              )}
                              {wf.status !== "COMPLETED" && canAssignThisWf && (
                                <span className="inline-flex items-center gap-1 ml-1">
                                  <select
                                    value={currentAssignee || ""}
                                    onChange={(e) => {
                                      if (e.target.value) {
                                        handleAssignWorkflowStep(wf, e.target.value, currentIdx);
                                      }
                                    }}
                                    className="px-2 py-1 rounded-lg text-[11px] font-bold border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                                    title={`Phân công nhân sự bộ phận ${currentStepDept} phụ trách`}
                                  >
                                    <option value="">-- {currentAssignee ? "Đổi người phụ trách" : `Phân công nhân sự ${currentStepDept}`} --</option>
                                    {(targetDeptStaff.length > 0 ? targetDeptStaff : personnelList).map((p: any) => (
                                      <option key={p.id || p.employee_code || p.full_name} value={p.full_name}>
                                        {p.full_name} {p.position ? `(${p.position})` : ""}
                                      </option>
                                    ))}
                                  </select>
                                  {currentAssignee !== currentStaffName && (
                                    <button
                                      type="button"
                                      onClick={() => handleAssignWorkflowStep(wf, currentStaffName, currentIdx)}
                                      className="px-2 py-1 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs cursor-pointer transition-colors"
                                      title="Nhận phụ trách bước này"
                                    >
                                      Nhận việc
                                    </button>
                                  )}
                                </span>
                              )}
                            </span>
                            <span>
                              <strong>Hạn chót:</strong> {wf.due_date ? wf.due_date.slice(0, 10) : "—"}
                            </span>
                          </div>
                        </div>

                        {/* Top Action buttons */}
                        <div className="flex items-center gap-2 shrink-0 flex-wrap">
                          {hasSteps && wf.status !== "COMPLETED" && (
                            <button
                              type="button"
                              onClick={() => handleOpenAdvanceStep(wf)}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs flex items-center gap-1.5 transition-all"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Nghiệm Thu Bước {currentIdx + 1} &amp; Bàn Giao</span>
                            </button>
                          )}

                          {!hasSteps && wf.status === "PENDING" && (
                            <button
                              onClick={() => handleWorkflowStatusTransition(wf.id, "ACCEPTED", "Tiếp nhận phiếu")}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-xs"
                            >
                              Tiếp Nhận
                            </button>
                          )}
                          {!hasSteps && wf.status === "ACCEPTED" && (
                            <button
                              onClick={() => handleWorkflowStatusTransition(wf.id, "IN_PROGRESS", "Bắt đầu triển khai")}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-xs"
                            >
                              Triển Khai
                            </button>
                          )}

                          {wf.status !== "COMPLETED" && (
                            <button
                              onClick={() => handleOpenRecordResult(wf)}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white shadow-xs flex items-center gap-1"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              <span>Báo Cáo / Đính Kèm</span>
                            </button>
                          )}

                          {wf.status === "REVIEW" && (
                            <button
                              onClick={() => handleWorkflowStatusTransition(wf.id, "COMPLETED", "Nghiệm thu hoàn tất")}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs flex items-center gap-1"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Nghiệm Thu &amp; Đóng</span>
                            </button>
                          )}

                          {wf.status === "COMPLETED" && (
                            <button
                              onClick={() => handleOpenRecordResult(wf)}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
                            >
                              Xem / Sửa Hồ Sơ
                            </button>
                          )}

                          <button
                            onClick={() => {
                              setSelectedWorkflowDetail(wf);
                              setIsWorkflowDetailModalOpen(true);
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Xem &amp; Trao Đổi</span>
                          </button>
                        </div>
                      </div>

                      {/* Interactive Stepper Pipeline (Chuẩn Stage-Gate RACI) */}
                      {hasSteps && (
                        <div className="bg-slate-50/80 dark:bg-slate-950/40 p-3 rounded-xl border border-slate-200/80 dark:border-slate-800 space-y-2">
                          <div className="flex items-center justify-between flex-wrap gap-1 text-[11px]">
                            <div className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                              <Layers className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                              <span>Tiến Trình Phối Hợp Đa Bước ({wfSteps.filter((s: any) => s.status === 'COMPLETED').length}/{wfSteps.length} bước xong)</span>
                            </div>
                            <span className="text-[10px] text-slate-400">
                              Bước hiện tại: <strong className="text-indigo-600 dark:text-indigo-400">{wfSteps[currentIdx]?.title || `Bước ${currentIdx + 1}`}</strong> ({wfSteps[currentIdx]?.dept} - {wfSteps[currentIdx]?.assignee_name || "Chưa gán"})
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                            {wfSteps.map((st: any, sIdx: number) => {
                              const isDone = st.status === "COMPLETED";
                              const isCurrent = currentIdx === sIdx && wf.status !== "COMPLETED";

                              return (
                                <div
                                  key={sIdx}
                                  className={`p-2.5 rounded-xl border text-xs transition-all ${
                                    isDone
                                      ? "bg-emerald-50/80 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-200"
                                      : isCurrent
                                      ? "bg-indigo-50 border-indigo-300 dark:bg-indigo-950/40 dark:border-indigo-700 text-indigo-950 dark:text-indigo-100 shadow-xs ring-1 ring-indigo-400/40"
                                      : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 opacity-70"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-1 mb-1">
                                    <span className={`text-[10px] font-extrabold uppercase px-1.5 py-0.2 rounded ${
                                      isDone ? "bg-emerald-200/60 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200"
                                      : isCurrent ? "bg-indigo-200/80 dark:bg-indigo-900/80 text-indigo-800 dark:text-indigo-200 animate-pulse"
                                      : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                                    }`}>
                                      Bước {sIdx + 1}
                                    </span>
                                    {isDone ? (
                                      <span className="flex items-center gap-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        Hoàn tất
                                      </span>
                                    ) : isCurrent ? (
                                      <span className="flex items-center gap-0.5 text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                                        <Clock className="w-3.5 h-3.5 animate-spin" />
                                        Đang xử lý
                                      </span>
                                    ) : (
                                      <span className="text-[10px] font-semibold text-slate-400">Chờ</span>
                                    )}
                                  </div>

                                  <div className="font-bold text-xs truncate" title={st.title}>
                                    {st.title}
                                  </div>

                                  <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                                    <span className="font-semibold truncate max-w-[120px]">
                                      {st.dept}: <strong>{st.assignee_name || "Chưa gán"}</strong>
                                    </span>
                                    {st.sla_hours && <span>SLA: {st.sla_hours}h</span>}
                                  </div>

                                  {st.deliverables && (
                                    <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400 truncate" title={`Yêu cầu: ${st.deliverables}`}>
                                      📋 {st.deliverables}
                                    </div>
                                  )}

                                  {st.deliverables_note && (
                                    <div className="mt-1.5 pt-1 border-t border-emerald-200/60 dark:border-emerald-800/60 text-[10px] text-emerald-800 dark:text-emerald-300">
                                      <strong>KQ:</strong> {st.deliverables_note}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Results & Attachments summary */}
                      {wf.results_summary ? (
                        <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 rounded-xl p-3 text-xs text-emerald-800 dark:text-emerald-300 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <strong>Tổng hợp kết quả &amp; biên bản bàn giao:</strong>
                              {renderWorkflowResultSummary(wf.results_summary)}
                            </div>
                            <button
                              onClick={() => handleOpenRecordResult(wf)}
                              className="px-2 py-0.5 rounded-lg bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-900/60 dark:hover:bg-emerald-800 text-emerald-800 dark:text-emerald-200 text-[11px] font-bold shrink-0 transition-colors"
                              title="Chỉnh sửa hoặc đính kèm thêm hồ sơ"
                            >
                              ✏️ Sửa / Đính Kèm
                            </button>
                          </div>

                          {/* Display attachments if any */}
                          {wf.attachments && wf.attachments.length > 0 && (
                            <div className="pt-2 border-t border-emerald-200/60 dark:border-emerald-800/60">
                              <div className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 mb-1 flex items-center gap-1">
                                <Paperclip className="w-3 h-3" />
                                <span>Tài liệu &amp; Hình ảnh đính kèm ({wf.attachments.length}):</span>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {wf.attachments.map((att: any, attIdx: number) => {
                                  const isImg = att.type?.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(att.name);
                                  return (
                                    <div
                                      key={attIdx}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/80 text-slate-800 dark:text-slate-200 text-[11px] shadow-2xs"
                                    >
                                      {isImg ? (
                                        <button
                                          type="button"
                                          onClick={() => setPreviewImage(att.url)}
                                          className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold hover:underline"
                                        >
                                          <ImageIcon className="w-3.5 h-3.5" />
                                          <span className="truncate max-w-[140px]">{att.name}</span>
                                        </button>
                                      ) : (
                                        <a
                                          href={att.url}
                                          target="_blank"
                                          rel="noreferrer"
                                          download
                                          className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-semibold hover:underline"
                                        >
                                          <FileText className="w-3.5 h-3.5" />
                                          <span className="truncate max-w-[140px]">{att.name}</span>
                                        </a>
                                      )}
                                      <a
                                        href={att.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        download
                                        title="Tải về"
                                        className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
                                      >
                                        <Download className="w-3 h-3" />
                                      </a>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 pt-0.5">
                          <button
                            onClick={() => handleOpenRecordResult(wf)}
                            className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-semibold"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Ghi nhận kết quả &amp; Đính kèm hình ảnh, tài liệu</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {listWorkflows.length === 0 && (
                <div className="text-center py-12 text-slate-400 italic text-xs">
                  Chưa có phiếu phối hợp nào đang hoạt động
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: LỊCH & KẾ HOẠCH CHUYÊN ĐỀ (RESTRUCTURED & FULLY ACTIONABLE) */}
      {activeSubTab === "planner" && (
        <div className="space-y-4">
          {/* Sub-view Switcher: Master Calendar vs Lab Projects vs Sales Targets */}
          <div className="bg-white dark:bg-slate-900 p-2 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => setPlannerView("calendar")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  plannerView === "calendar"
                    ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>📅 Lịch Công Tác Tuần ({filteredSchedules.length})</span>
              </button>

              <button
                onClick={() => setPlannerView("lab_projects")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  plannerView === "lab_projects"
                    ? "bg-purple-600 text-white shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>📋 Kế Hoạch Chuyên Đề ({filteredLabProjects.length})</span>
              </button>

              <button
                onClick={() => setPlannerView("sales_targets")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  plannerView === "sales_targets"
                    ? "bg-orange-600 text-white shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <Target className="w-3.5 h-3.5" />
                <span>🎯 Mục Tiêu Kinh Doanh ({filteredSalesTargets.length})</span>
              </button>
            </div>

            <span className="text-[11px] text-slate-400 hidden sm:inline font-medium">
              Hiển thị phân bổ theo ngữ cảnh chuyên môn
            </span>
          </div>

          {/* Sub-view 1: Master Weekly Calendar */}
          {plannerView === "calendar" && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <span>Lịch Công Tác &amp; Điều Phối {weekOffset === 0 ? "Tuần Này" : weekOffset === 1 ? "Tuần Sau" : weekOffset === -1 ? "Tuần Trước" : ""}</span>
                    <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                      Tuần {viewedWeek.weekNo} / {viewedWeek.year} · {viewedWeek.days[0].label} – {viewedWeek.days[5].label}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <button type="button" onClick={() => setWeekOffset(w => w - 1)} className="p-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer" title="Tuần trước">
                        <ChevronRight className="w-3.5 h-3.5 rotate-180" />
                      </button>
                      {weekOffset !== 0 && (
                        <button type="button" onClick={() => setWeekOffset(0)} className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 cursor-pointer">Tuần này</button>
                      )}
                      <button type="button" onClick={() => setWeekOffset(w => w + 1)} className="p-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer" title="Tuần sau">
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    Lịch trực Lab, lịch demo tại bệnh viện và các đợt giao nhận hàng hóa lớn
                  </p>
                </div>

                <button
                  onClick={() => openScheduleForm()}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Thêm Lịch Công Tác Tuần</span>
                </button>
              </div>

              {/* Quick Staff Member Filter for Weekly Schedule */}
              {(rolePerspective === "manager" || rolePerspective === "director") && departmentStaffList.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-2.5 mb-3.5 pt-0.5 no-scrollbar text-xs border-b border-slate-100 dark:border-slate-800">
                  <span className="text-[11px] font-bold text-slate-400 shrink-0 mr-1 flex items-center gap-1">
                    <Users className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Lọc lịch theo nhân sự:</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedAssignee("all")}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                      selectedAssignee === "all"
                        ? "bg-indigo-600 text-white shadow-xs"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                    }`}
                  >
                    Tất cả ({departmentStaffList.length})
                  </button>
                  {departmentStaffList.map((p: any) => {
                    const name = p.full_name || p;
                    const schedCount = weeklySchedule.filter(s => {
                      const matchesDept = selectedDept === "all" || s.category === selectedDept || (rolePerspective === "manager" && s.category === managerDept);
                      const actor = (s.actor || "").toLowerCase().trim();
                      const target = name.toLowerCase().trim();
                      return matchesDept && (actor.includes(target) || target.includes(actor));
                    }).length;
                    const isSelected = selectedAssignee === name;
                    return (
                      <button
                        key={p.id || p.employee_code || name}
                        type="button"
                        onClick={() => setSelectedAssignee(isSelected ? "all" : name)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all shrink-0 cursor-pointer border ${
                          isSelected
                            ? "bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border-indigo-400 dark:border-indigo-600 font-bold shadow-xs ring-2 ring-indigo-500/20"
                            : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        }`}
                      >
                        <span>{name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold font-mono ${
                          schedCount > 0 ? "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400" : "bg-slate-100 dark:bg-slate-800 text-slate-400"
                        }`}>
                          {schedCount}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                {viewedWeek.days.map((wd) => {
                  const day = wd.name;
                  const dayEvents = filteredSchedules.filter((s) => scheduleOnDay(s, wd)).sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));
                  const isToday = wd.date === todayVN();
                  return (
                    <div
                      key={wd.date}
                      className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 rounded-xl p-3 min-h-[220px] flex flex-col justify-between"
                    >
                      <div>
                        <div className="text-xs font-bold text-slate-700 dark:text-slate-300 pb-2 border-b border-slate-200 dark:border-slate-700 mb-2 flex items-center justify-between">
                          <span className={isToday ? "text-indigo-600 dark:text-indigo-400" : ""}>{day}{isToday ? " · Hôm nay" : ""}</span>
                          <span className="text-[10px] text-slate-400 font-mono">{wd.label}</span>
                        </div>

                        <div className="space-y-1.5">
                          {dayEvents.map((ev) => {
                            const isApp = ev.category === "Application";
                            const isSales = ev.category === "Kinh Doanh";
                            const isWh = ev.category === "Kho & Vận Hành";

                            return (
                              <div
                                key={ev.id}
                                className={`group relative rounded-lg p-2 text-[11px] font-medium border transition-all ${
                                  isApp
                                    ? "bg-purple-100/80 dark:bg-purple-950/60 border-purple-300 dark:border-purple-800 text-purple-950 dark:text-purple-200"
                                    : isSales
                                    ? "bg-orange-100/80 dark:bg-orange-950/60 border-orange-300 dark:border-orange-800 text-orange-950 dark:text-orange-200"
                                    : isWh
                                    ? "bg-emerald-100/80 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-800 text-emerald-950 dark:text-emerald-200"
                                    : "bg-blue-100/80 dark:bg-blue-950/60 border-blue-300 dark:border-blue-800 text-blue-950 dark:text-blue-200"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1 mb-0.5">
                                  <span className="font-bold font-mono text-[10px]">⏰ {ev.time}</span>
                                  <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      onClick={() => openScheduleForm(undefined, ev)}
                                      title="Sửa lịch trình"
                                      className="hover:text-indigo-600 p-0.5"
                                    >
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                    <button
                                      onClick={() => { if (confirm("Xóa lịch trình này?")) handleDeleteSchedule(ev.id); }}
                                      title="Xóa lịch trình"
                                      className="hover:text-rose-600 p-0.5"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </span>
                                </div>
                                <div className="font-semibold leading-tight">{ev.title}</div>
                                <div className="text-[10px] opacity-75 mt-1 flex items-center justify-between">
                                  <span>👤 {ev.actor}</span>
                                  {ev.location && <span>📍 {ev.location}</span>}
                                </div>
                              </div>
                            );
                          })}

                          {dayEvents.length === 0 && (
                            <div className="text-center py-6 text-[11px] text-slate-400 italic">
                              Chưa có lịch
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-200/50 dark:border-slate-700/50 mt-2">
                        <button
                          onClick={() => openScheduleForm(wd.date)}
                          className="w-full py-1 text-[10px] font-bold text-slate-400 hover:text-indigo-600 hover:bg-indigo-50/50 dark:hover:bg-slate-800 rounded transition-colors flex items-center justify-center gap-1"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Thêm vào {day}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Sub-view 2: Thematic Projects */}
          {plannerView === "lab_projects" && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 text-purple-600 dark:text-purple-400">
                    <Layers className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <span>Kế Hoạch Chuyên Đề &amp; Đề Tài Trọng Điểm</span>
                      <span className="px-2.5 py-0.5 text-[11px] font-bold rounded-full bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                        {filteredLabProjects.length} Chuyên Đề ({selectedDept === "all" ? "Toàn Công Ty" : selectedDept})
                      </span>
                    </h3>
                    <p className="text-xs text-slate-500">
                      Quy trình tiến trình thực hiện chuyên biệt, các mốc nghiệm thu và giám sát hoàn thành theo từng phòng ban
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => openCreateThematicModal()}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white shadow-xs transition-all cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Tạo Kế Hoạch Chuyên Đề Mới</span>
                </button>
              </div>

              {/* Thematic Category Filter Chips */}
              {(() => {
                const currentDept = rolePerspective === "manager" ? managerDept : selectedDept;
                const relevantTypes = currentDept === "all" 
                  ? Object.values(DEPARTMENT_THEMATIC_TYPES).flat()
                  : (DEPARTMENT_THEMATIC_TYPES[currentDept] || []);

                if (relevantTypes.length === 0) return null;

                return (
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-2.5 mb-4 no-scrollbar border-b border-slate-100 dark:border-slate-800">
                    <span className="text-[11px] font-bold text-slate-400 shrink-0 mr-1 flex items-center gap-1">
                      <Filter className="w-3.5 h-3.5 text-purple-500" />
                      <span>Loại chuyên đề:</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setThematicFilterType("all")}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                        thematicFilterType === "all"
                          ? "bg-purple-600 text-white shadow-xs"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                      }`}
                    >
                      Tất cả loại ({filteredLabProjects.length})
                    </button>
                    {relevantTypes.map((t) => {
                      const count = labProjects.filter(p => {
                        const matchDept = selectedDept === "all" || p.dept === selectedDept || (rolePerspective === "manager" && p.dept === managerDept);
                        return matchDept && p.typeId === t.id;
                      }).length;
                      const isSelected = thematicFilterType === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setThematicFilterType(isSelected ? "all" : t.id)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all shrink-0 cursor-pointer border ${
                            isSelected
                              ? "bg-purple-50 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 border-purple-400 dark:border-purple-600 font-bold shadow-xs ring-2 ring-purple-500/20"
                              : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                          }`}
                        >
                          <span>{t.icon}</span>
                          <span>{t.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold font-mono ${
                            count > 0 ? "bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300" : "bg-slate-100 dark:bg-slate-800 text-slate-400"
                          }`}>
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              {filteredLabProjects.length === 0 ? (
                <div className="text-center py-12 px-4 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-950/30">
                  <Layers className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                  <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Chưa có kế hoạch chuyên đề nào
                  </h4>
                  <p className="text-xs text-slate-500 max-w-md mx-auto mb-4">
                    Tạo đề tài hoặc kế hoạch chuyên đề để thiết lập tiến trình thực hiện chuyên biệt và theo dõi các mốc nghiệm thu của phòng ban.
                  </p>
                  <button
                    onClick={() => openCreateThematicModal()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white shadow-xs transition-all cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Tạo Kế Hoạch Chuyên Đề Đầu Tiên</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {filteredLabProjects.map((prj) => {
                    const stages = prj.stages || [];
                    const completedStages = stages.filter((s: any) => s.status === "completed").length;
                    const totalStages = stages.length;
                    const progressPct = totalStages > 0 ? Math.round((completedStages / totalStages) * 100) : 0;
                    
                    const isApp = prj.dept === "Application";
                    const isSales = prj.dept === "Kinh Doanh";
                    const isWh = prj.dept === "Kho & Vận Hành";
                    const isProc = prj.dept === "Cung Ứng";

                    const badgeColor = isApp
                      ? "bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border-purple-200 dark:border-purple-800"
                      : isSales
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800"
                      : isWh
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
                      : isProc
                      ? "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800"
                      : "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800";

                    return (
                      <div
                        key={prj.id}
                        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4.5 flex flex-col justify-between shadow-xs hover:border-purple-400 dark:hover:border-purple-600 transition-all group"
                      >
                        <div>
                          {/* Card Header */}
                          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
                                {prj.id}
                              </span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${badgeColor}`}>
                                {prj.dept}
                              </span>
                              {prj.typeName && (
                                <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 truncate max-w-[200px]" title={prj.typeName}>
                                  • {prj.typeName}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                prj.status === "Completed"
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                                  : prj.status === "Review"
                                  ? "bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300"
                                  : prj.status === "Planning"
                                  ? "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                                  : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                              }`}>
                                {prj.status === "Completed" ? "Đã nghiệm thu" : prj.status === "Review" ? "Đang nghiệm thu" : prj.status === "Planning" ? "Lập đề cương" : "Đang thực hiện"}
                              </span>

                              <button
                                onClick={() => openEditThematicModal(prj)}
                                className="p-1 rounded text-slate-400 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                title="Chỉnh sửa chuyên đề"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteThematicProject(prj.id)}
                                className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                title="Xóa chuyên đề"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Title & Objectives */}
                          <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-2 leading-snug">
                            {prj.name}
                          </h4>
                          {prj.description && (
                            <p className="text-xs text-slate-600 dark:text-slate-400 mb-3 leading-relaxed line-clamp-2">
                              {prj.description}
                            </p>
                          )}

                          {/* Lead & Dates */}
                          <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-500 dark:text-slate-400 mb-3 bg-slate-50 dark:bg-slate-950/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/60">
                            <div>
                              <span className="text-slate-400">Chủ nhiệm / Phụ trách:</span>{" "}
                              <strong className="text-slate-800 dark:text-slate-200">{prj.lead}</strong>
                            </div>
                            <div>
                              <span className="text-slate-400">Thời gian:</span>{" "}
                              <span className="font-semibold text-slate-700 dark:text-slate-300">
                                {prj.startDate ? prj.startDate : "Bắt đầu"} {prj.endDate ? `➔ ${prj.endDate}` : ""}
                              </span>
                            </div>
                          </div>

                          {/* Specialized Progress Section */}
                          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                <ListChecks className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                                <span>Tiến trình thực hiện ({completedStages}/{totalStages} giai đoạn)</span>
                              </span>
                              <span className="font-mono font-bold text-purple-600 dark:text-purple-400">
                                {progressPct}%
                              </span>
                            </div>

                            {/* Progress Bar */}
                            <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                              <div
                                className={`h-full transition-all duration-500 rounded-full ${
                                  progressPct === 100
                                    ? "bg-emerald-500"
                                    : progressPct > 50
                                    ? "bg-purple-600"
                                    : "bg-amber-500"
                                }`}
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>

                            {/* Stage Checklist Items */}
                            {stages.length > 0 && (
                              <div className="space-y-1.5 mt-2.5 max-h-48 overflow-y-auto pr-1">
                                {stages.map((stg: any, sIdx: number) => {
                                  const isDone = stg.status === "completed";
                                  return (
                                    <div
                                      key={stg.id || sIdx}
                                      onClick={() => handleToggleStage(prj.id, stg.id)}
                                      className={`flex items-start gap-2 p-2 rounded-xl text-xs cursor-pointer transition-all border ${
                                        isDone
                                          ? "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-900/40 text-slate-500 dark:text-slate-400"
                                          : "bg-slate-50 dark:bg-slate-800/40 border-slate-200/60 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:border-purple-300 dark:hover:border-purple-700"
                                      }`}
                                    >
                                      <button
                                        type="button"
                                        className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center shrink-0 border transition-all ${
                                          isDone
                                            ? "bg-emerald-600 border-emerald-600 text-white"
                                            : "border-slate-300 dark:border-slate-600 hover:border-purple-500"
                                        }`}
                                      >
                                        {isDone && <Check className="w-3 h-3 stroke-[3]" />}
                                      </button>
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-1">
                                          <span className={`text-[10px] font-bold ${isDone ? "text-emerald-700 dark:text-emerald-400" : "text-purple-600 dark:text-purple-400"}`}>
                                            Giai đoạn {sIdx + 1}
                                            {stg.estimatedDays ? ` (${stg.estimatedDays} ngày)` : ""}
                                          </span>
                                        </div>
                                        <p className={`text-[11px] leading-snug font-medium ${isDone ? "line-through opacity-75" : ""}`}>
                                          {stg.name}
                                        </p>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Card Footer */}
                        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                            {prj.tasksCount || 0} công việc liên kết
                          </span>
                          <button
                            onClick={() => {
                              setSelectedDept(prj.dept);
                              setActiveSubTab("tasks");
                            }}
                            className="font-bold text-purple-600 dark:text-purple-400 hover:text-purple-700 hover:underline flex items-center gap-1 cursor-pointer"
                          >
                            <span>Xem bảng việc</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Sub-view 3: Sales Targets & Pipeline */}
          {plannerView === "sales_targets" && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Target className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <span>Kế Hoạch Khách Hàng Mục Tiêu &amp; Doanh Số (Kinh Doanh)</span>
                      <span className="px-2.5 py-0.5 text-[11px] font-bold rounded-full bg-orange-50 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800">
                        Target Q4: {salesTargets.reduce((acc, t) => acc + (t.rawAmount || 0), 0).toFixed(1)} Tỷ VNĐ
                      </span>
                    </h3>
                    <p className="text-xs text-slate-500">
                      Mục tiêu doanh số quý 4 và tiến độ các gói thầu bệnh viện trọng điểm
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setSalesTargetForm({
                      customer: "",
                      amount: "2.5 Tỷ VNĐ",
                      quarter: "Q4/2026",
                      lead: "Nguyễn Văn A",
                      description: "",
                      stage: "Đang chào giá & Demo"
                    });
                    setIsSalesTargetModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white shadow-xs transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Đặt Mục Tiêu Doanh Số</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {filteredSalesTargets.map((st) => (
                  <div key={st.id} className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 p-4 rounded-xl flex flex-col justify-between shadow-xs hover:border-orange-300 transition-all">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] uppercase font-extrabold text-slate-400 block truncate max-w-[170px]">{st.customer}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300">
                          {st.stage || "Đang chào giá"}
                        </span>
                      </div>
                      <div className="text-lg font-black text-slate-900 dark:text-white">{st.amount}</div>
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed">{st.description}</p>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-[11px] text-slate-500">
                      <span>👤 Phụ trách: <strong>{st.lead}</strong></span>
                      <span className="font-mono font-bold text-slate-400">{st.quarter}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: NHẬT KÝ DAILY - KẾT NỐI KẾ HOẠCH TUẦN & CHỈ ĐẠO 2 CHIỀU */}
      {activeSubTab === "daily" && (
        <div className="space-y-5">
          {/* Top Control Bar: Weekday Navigator & Personnel Filter */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs">
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
              {/* Weekday Switcher */}
              <div className="space-y-1.5 w-full lg:w-auto">
                <div className="flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Chọn ngày báo cáo theo Kế hoạch tuần:
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"].map((day) => {
                    const isSelected = selectedDailyDay === day;
                    // Count planned items for this day
                    const dayItemCount = weeklySchedule.filter(s => {
                      if (s.day !== day) return false;
                      const staff = selectedDailyStaff || currentStaffName;
                      if (staff && s.actor) {
                        return s.actor.toLowerCase().includes(staff.toLowerCase()) || staff.toLowerCase().includes(s.actor.toLowerCase());
                      }
                      if (rolePerspective === "manager" && s.category !== managerDept) return false;
                      return true;
                    }).length;

                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => setSelectedDailyDay(day)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
                          isSelected
                            ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30 scale-102"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                        }`}
                      >
                        <span>{day}</span>
                        {dayItemCount > 0 && (
                          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                            isSelected
                              ? "bg-white/20 text-white"
                              : "bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300"
                          }`}>
                            {dayItemCount} việc
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Staff / Department Context */}
              <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto shrink-0">
                {rolePerspective === "director" ? (
                  <div className="flex items-center gap-2 min-w-[280px]">
                    <span className="text-xs text-slate-500 font-semibold shrink-0">Nhân sự:</span>
                    <SearchablePersonnelSelect
                      value={selectedDailyStaff}
                      onChange={(val) => setSelectedDailyStaff(val)}
                      personnelList={personnelList}
                      placeholder="Chọn nhân viên để theo dõi..."
                    />
                  </div>
                ) : rolePerspective === "manager" ? (
                  <div className="flex items-center gap-2 min-w-[260px]">
                    <span className="text-xs text-slate-500 font-semibold shrink-0">Nhân sự ({managerDept}):</span>
                    <SearchablePersonnelSelect
                      value={selectedDailyStaff || currentStaffName}
                      onChange={(val) => setSelectedDailyStaff(val)}
                      personnelList={personnelList}
                      filterDepartment={managerDept}
                      placeholder={`Chọn nhân viên phòng ${managerDept}...`}
                    />
                  </div>
                ) : (
                  <div className="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-bold flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>Báo cáo cá nhân: <strong>{currentStaffName}</strong></span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Main 2-Column Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column (7 cols): Planned Items & Quick Input & Evaluation */}
            <div className="lg:col-span-7 space-y-4">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <ListChecks className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        Công Việc Kế Hoạch Tuần • {selectedDailyDay}
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        Nhập nhanh kết quả, định lượng thời gian &amp; mức độ tương xứng kết quả thực tế
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddDailyExtraItem}
                    className="px-2.5 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 text-xs font-bold flex items-center gap-1 transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ Việc phát sinh</span>
                  </button>
                </div>

                {/* List of Planned Items */}
                <div className="space-y-3">
                  {dailyPlanItems.length > 0 ? (
                    dailyPlanItems.map((item, idx) => (
                      <div
                        key={item.id}
                        className={`p-3.5 rounded-xl border transition-all space-y-2.5 ${
                          item.status === "completed"
                            ? "bg-slate-50/80 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/80"
                            : item.status === "partial"
                            ? "bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/60"
                            : "bg-rose-50/40 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800/60"
                        }`}
                      >
                        {/* Top row: Status switcher + Title + Category + Remove */}
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div className="flex-1 min-w-[220px]">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="font-mono text-[11px] font-extrabold text-slate-400">
                                #{idx + 1}
                              </span>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                                item.source === "schedule"
                                  ? "bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300"
                                  : "bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300"
                              }`}>
                                {item.source === "schedule" ? "Lịch tuần" : "Phát sinh"}
                              </span>
                              {item.category && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                                  {item.category}
                                </span>
                              )}
                              {item.location && (
                                <span className="text-[10px] text-slate-500 font-medium">
                                  📍 {item.location}
                                </span>
                              )}
                            </div>
                            {item.source === "extra" ? (
                              <input
                                type="text"
                                value={item.title}
                                onChange={(e) => updateDailyPlanItem(item.id, "title", e.target.value)}
                                placeholder="Nhập tên công việc phát sinh..."
                                className="w-full px-2.5 py-1 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                              />
                            ) : (
                              <div className="font-bold text-xs text-slate-900 dark:text-white leading-snug">
                                {item.title}
                              </div>
                            )}
                          </div>

                          {/* Status buttons */}
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => updateDailyPlanItem(item.id, "status", "completed")}
                              className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-all ${
                                item.status === "completed"
                                  ? "bg-emerald-600 text-white shadow-xs"
                                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200"
                              }`}
                            >
                              ✓ Đạt (100%)
                            </button>
                            <button
                              type="button"
                              onClick={() => updateDailyPlanItem(item.id, "status", "partial")}
                              className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-all ${
                                item.status === "partial"
                                  ? "bg-amber-600 text-white shadow-xs"
                                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200"
                              }`}
                            >
                              ⏳ Một phần
                            </button>
                            <button
                              type="button"
                              onClick={() => updateDailyPlanItem(item.id, "status", "pending")}
                              className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-all ${
                                item.status === "pending"
                                  ? "bg-rose-600 text-white shadow-xs"
                                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200"
                              }`}
                            >
                              ✕ Chưa đạt
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveDailyPlanItem(item.id)}
                              title="Xóa đầu việc này khỏi báo cáo"
                              className="p-1 text-slate-400 hover:text-rose-500 transition-colors ml-1"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Quick Inputs: Kết quả & Vướng mắc */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                          <div>
                            <input
                              type="text"
                              value={item.result}
                              onChange={(e) => updateDailyPlanItem(item.id, "result", e.target.value)}
                              placeholder="✓ Nhập nhanh kết quả: Khách duyệt, hoàn tất..."
                              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 font-medium"
                            />
                          </div>
                          <div>
                            <input
                              type="text"
                              value={item.issues}
                              onChange={(e) => updateDailyPlanItem(item.id, "issues", e.target.value)}
                              placeholder="⚠ Vướng mắc / hỗ trợ: Thiếu linh kiện..."
                              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 font-medium"
                            />
                          </div>
                        </div>

                        {/* Proportionality & Hours for this item */}
                        <div className="flex items-center justify-between gap-3 pt-1 border-t border-slate-200/60 dark:border-slate-700/60 text-[11px]">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-500 font-semibold">Thời lượng:</span>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="0.5"
                                min="0.5"
                                max="16"
                                value={item.work_hours || 2}
                                onChange={(e) => updateDailyPlanItem(item.id, "work_hours", parseFloat(e.target.value) || 1)}
                                className="w-14 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-center font-bold text-slate-900 dark:text-white"
                              />
                              <span className="text-slate-400">giờ</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-slate-500 font-semibold">Tương xứng:</span>
                            <select
                              value={item.proportionality || "balanced"}
                              onChange={(e) => updateDailyPlanItem(item.id, "proportionality", e.target.value)}
                              className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold"
                            >
                              <option value="optimal">🌟 Vượt trội (Nhanh &amp; Tốt)</option>
                              <option value="balanced">⚖️ Tương xứng (Đạt chuẩn)</option>
                              <option value="suboptimal">⏳ Cần tối ưu (Tốn nhiều giờ)</option>
                              <option value="poor">⚠️ Chưa tương xứng</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-6 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl space-y-2">
                      <div className="text-slate-400 text-xs italic">
                        Chưa có công việc nào trong kế hoạch tuần của {selectedDailyDay} ({selectedDailyStaff || currentStaffName}).
                      </div>
                      <button
                        type="button"
                        onClick={handleAddDailyExtraItem}
                        className="px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition-all inline-flex items-center gap-1.5"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>+ Thêm Việc Phát Sinh Thực Tế</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Freeform General Work Content (Fallback / Additions) */}
                <div className="space-y-1.5 pt-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Nội dung tổng hợp hoặc bổ sung thêm trong ngày:
                  </label>
                  <textarea
                    rows={2}
                    value={dailyForm.work_content}
                    onChange={(e) => setDailyForm({ ...dailyForm, work_content: e.target.value })}
                    placeholder="Ghi chú tổng hợp thêm công việc đã hoàn thành hoặc trao đổi phát sinh trong ngày..."
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-medium"
                  />
                </div>

                {/* Daily Synthesis & Proportionality Evaluation Form */}
                <div className="p-4 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/60 space-y-3">
                  <div className="text-xs font-extrabold text-indigo-950 dark:text-indigo-200 uppercase tracking-wider flex items-center gap-2">
                    <Activity className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span>Đánh Giá Tổng Hợp Cuối Ngày (Thời Gian ⇄ Khối Lượng ⇄ Kết Quả)</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="block font-bold text-slate-600 dark:text-slate-400 mb-1">
                        Tổng thời gian làm việc
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          step="0.5"
                          min="1"
                          max="24"
                          value={dailyTotalHours}
                          onChange={(e) => setDailyTotalHours(parseFloat(e.target.value) || 8)}
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 font-black text-slate-900 dark:text-white text-center"
                        />
                        <span className="font-bold text-slate-500">Giờ</span>
                      </div>
                    </div>

                    <div>
                      <label className="block font-bold text-slate-600 dark:text-slate-400 mb-1">
                        Mức độ tương xứng
                      </label>
                      <select
                        value={dailyProportionalityScore}
                        onChange={(e) => setDailyProportionalityScore(e.target.value)}
                        className="w-full px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 font-bold text-slate-900 dark:text-white"
                      >
                        <option value="Tối ưu & Vượt trội">🌟 Tối ưu &amp; Vượt trội</option>
                        <option value="Tương xứng & Đạt chuẩn">⚖️ Tương xứng &amp; Đạt chuẩn</option>
                        <option value="Cần tối ưu thời gian">⏳ Cần tối ưu thời gian</option>
                        <option value="Chưa tương xứng">⚠️ Chưa tương xứng</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-bold text-slate-600 dark:text-slate-400 mb-1">
                        Tự đánh giá kết quả
                      </label>
                      <select
                        value={dailyPerformanceRating}
                        onChange={(e) => setDailyPerformanceRating(e.target.value)}
                        className="w-full px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 font-bold text-slate-900 dark:text-white"
                      >
                        <option value="Xuất sắc">⭐ Xuất sắc</option>
                        <option value="Tốt">🟢 Tốt / Đạt chuẩn</option>
                        <option value="Cần cải thiện">🟡 Cần cải thiện</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-600 dark:text-slate-400 mb-1 text-xs">
                      Kế hoạch trọng tâm ngày mai
                    </label>
                    <input
                      type="text"
                      value={dailyTomorrowPlan}
                      onChange={(e) => setDailyTomorrowPlan(e.target.value)}
                      placeholder="Ưu tiên ngày mai: Demo khách hàng A, chốt hợp đồng B, hoàn thành báo cáo kỹ thuật..."
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs font-medium"
                    />
                  </div>
                </div>

                {/* Submit Action */}
                <button
                  type="button"
                  onClick={handleSaveDaily}
                  className="w-full py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white transition-all shadow-md shadow-indigo-600/30 flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  <span>Lưu &amp; Gửi Báo Cáo Nhật Ký Ngày</span>
                </button>
              </div>
            </div>

            {/* Right Column (5 cols): Daily Logs History & 2-Way Feedback Thread */}
            <div className="lg:col-span-5 space-y-4">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      Nhật Ký &amp; Chỉ Đạo Điều Hành
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Trao đổi 2 chiều: Chỉ đạo của Quản lý ⇄ Phản hồi của Nhân sự
                    </p>
                  </div>
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    {filteredDailyLogs.length} báo cáo
                  </span>
                </div>

                <div className="space-y-4 max-h-[850px] overflow-y-auto pr-1">
                  {filteredDailyLogs.map((log) => {
                    const parsedItems = Array.isArray(log.plan_items) ? log.plan_items : [];
                    const currentFeedbackState = feedbackInput[log.id] || {};

                    return (
                      <div
                        key={log.id}
                        className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 rounded-xl p-4 text-xs space-y-3 shadow-xs hover:border-indigo-300 transition-all"
                      >
                        {/* Header: Staff, Dept, Date, Hours, Proportionality */}
                        <div className="flex items-start justify-between gap-2 flex-wrap pb-2 border-b border-slate-200/60 dark:border-slate-700/60">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-extrabold text-sm text-slate-900 dark:text-white">
                                {log.employee_name}
                              </span>
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                                {log.department}
                              </span>
                            </div>
                            <span className="text-slate-400 font-mono text-[11px]">
                              📅 {log.log_date ? log.log_date.slice(0, 10) : ""}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 flex-wrap justify-end">
                            {log.work_hours && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                                ⏱️ {log.work_hours}h
                              </span>
                            )}
                            {log.proportionality_score && (
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                log.proportionality_score.includes("Vượt trội")
                                  ? "bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300"
                                  : log.proportionality_score.includes("Tương xứng")
                                  ? "bg-indigo-100 dark:bg-indigo-950/80 text-indigo-800 dark:text-indigo-300"
                                  : log.proportionality_score.includes("Cần tối ưu")
                                  ? "bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300"
                                  : "bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300"
                              }`}>
                                {log.proportionality_score}
                              </span>
                            )}
                            {log.performance_rating && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300">
                                {log.performance_rating}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Plan Items breakdown or raw work content */}
                        {parsedItems.length > 0 ? (
                          <div className="space-y-1.5">
                            <span className="text-[11px] font-bold text-slate-500 block">Các đầu việc thực hiện:</span>
                            <div className="space-y-1">
                              {parsedItems.map((pi: any, pIdx: number) => (
                                <div
                                  key={pIdx}
                                  className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 text-[11px] space-y-1"
                                >
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="font-bold text-slate-800 dark:text-slate-200">
                                      {pi.status === "completed" ? "🟢" : pi.status === "partial" ? "🟡" : "🔴"} {pi.title}
                                    </span>
                                    {pi.work_hours && (
                                      <span className="text-slate-400 font-mono text-[10px]">{pi.work_hours}h</span>
                                    )}
                                  </div>
                                  {pi.result && (
                                    <div className="text-emerald-700 dark:text-emerald-400 font-medium">
                                      ↳ Kết quả: {pi.result}
                                    </div>
                                  )}
                                  {pi.issues && (
                                    <div className="text-amber-700 dark:text-amber-400 font-medium">
                                      ↳ Vướng mắc: {pi.issues}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="text-slate-700 dark:text-slate-300 leading-relaxed">
                            <strong>Nội dung:</strong> {log.work_content}
                            {log.result && (
                              <div className="text-emerald-700 dark:text-emerald-400 mt-1">
                                <strong>Kết quả:</strong> {log.result}
                              </div>
                            )}
                            {log.issues && (
                              <div className="text-amber-700 dark:text-amber-400 mt-1">
                                <strong>Vướng mắc:</strong> {log.issues}
                              </div>
                            )}
                          </div>
                        )}

                        {log.next_day_plan && (
                          <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 text-[11px]">
                            <strong>Kế hoạch ngày mai:</strong> {log.next_day_plan}
                          </div>
                        )}

                        {/* SECTION: 2-WAY FEEDBACK THREAD */}
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-700/80 space-y-2.5">
                          {/* 1. Manager Guidance Bubble */}
                          {log.manager_feedback ? (
                            <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 text-[11px] space-y-1">
                              <div className="flex items-center justify-between text-indigo-900 dark:text-indigo-300 font-bold">
                                <span className="flex items-center gap-1.5">
                                  <Award className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                                  Chỉ đạo của Quản lý ({log.manager_name || "Trưởng bộ phận"}):
                                </span>
                                {log.manager_feedback_at && (
                                  <span className="text-[10px] text-indigo-400 font-normal">
                                    {new Date(log.manager_feedback_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                                  </span>
                                )}
                              </div>
                              <p className="text-slate-800 dark:text-slate-200 italic">
                                "{log.manager_feedback}"
                              </p>
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-400 italic">
                              Chưa có ý kiến chỉ đạo từ Quản lý.
                            </div>
                          )}

                          {/* Manager Feedback Input (If user is Manager or Director) */}
                          {rolePerspective !== "staff" && (
                            <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                                  <MessageSquare className="w-3 h-3" />
                                  {log.manager_feedback ? "Cập nhật chỉ đạo của bạn:" : "Gửi ý kiến chỉ đạo của Quản lý:"}
                                </span>
                              </div>
                              <div className="flex gap-1.5">
                                <input
                                  type="text"
                                  value={currentFeedbackState.managerText || ""}
                                  onChange={(e) => setFeedbackInput(prev => ({
                                    ...prev,
                                    [log.id]: { ...prev[log.id], managerText: e.target.value }
                                  }))}
                                  placeholder="Nhập ý kiến chỉ đạo, hỗ trợ vướng mắc..."
                                  className="flex-1 px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleSendDailyFeedback(log.id, "manager", currentFeedbackState.managerText || "")}
                                  className="px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 transition-all shrink-0"
                                >
                                  Gửi Chỉ Đạo
                                </button>
                              </div>
                              {/* Quick Chips for Manager */}
                              <div className="flex flex-wrap gap-1 pt-1">
                                {["Ghi nhận tiến độ tốt!", "Cần đẩy nhanh tiến độ", "Đã duyệt hỗ trợ phương tiện", "Tập trung giải quyết vướng mắc"].map((chip) => (
                                  <button
                                    key={chip}
                                    type="button"
                                    onClick={() => setFeedbackInput(prev => ({
                                      ...prev,
                                      [log.id]: { ...prev[log.id], managerText: chip }
                                    }))}
                                    className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 transition-all"
                                  >
                                    + {chip}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* 2. Staff Feedback Response Bubble */}
                          {log.staff_feedback && (
                            <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-[11px] space-y-1">
                              <div className="flex items-center justify-between text-emerald-900 dark:text-emerald-300 font-bold">
                                <span className="flex items-center gap-1.5">
                                  <UserCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                  Phản hồi của Nhân sự ({log.employee_name}):
                                </span>
                                {log.staff_feedback_at && (
                                  <span className="text-[10px] text-emerald-400 font-normal">
                                    {new Date(log.staff_feedback_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                                  </span>
                                )}
                              </div>
                              <p className="text-slate-800 dark:text-slate-200">
                                {log.staff_feedback}
                              </p>
                            </div>
                          )}

                          {/* Staff Response Input (If user is Staff or reviewing) */}
                          <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5">
                            <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                              <MessageCircle className="w-3 h-3" />
                              {log.staff_feedback ? "Cập nhật phản hồi chỉ đạo:" : "Nhân viên phản hồi tiếp thu chỉ đạo:"}
                            </span>
                            <div className="flex gap-1.5">
                              <input
                                type="text"
                                value={currentFeedbackState.staffText || ""}
                                onChange={(e) => setFeedbackInput(prev => ({
                                  ...prev,
                                  [log.id]: { ...prev[log.id], staffText: e.target.value }
                                }))}
                                placeholder="Phản hồi tiếp thu chỉ đạo hoặc báo cáo cập nhật..."
                                className="flex-1 px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                              />
                              <button
                                type="button"
                                onClick={() => handleSendDailyFeedback(log.id, "staff", currentFeedbackState.staffText || "")}
                                className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 transition-all shrink-0"
                              >
                                Gửi Phản Hồi
                              </button>
                            </div>
                            {/* Quick Chips for Staff */}
                            <div className="flex flex-wrap gap-1 pt-1">
                              {["Đã tiếp thu chỉ đạo", "Sẽ hoàn tất trong ngày mai", "Đang phối hợp với phòng liên quan"].map((chip) => (
                                <button
                                  key={chip}
                                  type="button"
                                  onClick={() => setFeedbackInput(prev => ({
                                    ...prev,
                                    [log.id]: { ...prev[log.id], staffText: chip }
                                  }))}
                                  className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 transition-all"
                                >
                                  + {chip}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {filteredDailyLogs.length === 0 && (
                    <div className="text-center py-12 text-slate-400 italic text-xs">
                      Chưa có nhật ký làm việc nào được ghi nhận hôm nay
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: BÁO CÁO PHÂN TÍCH HIỆU SUẤT TOÀN DIỆN (CÔNG VIỆC • KẾ HOẠCH • NHẬT KÝ DAILY) */}
      {activeSubTab === "analytics" && (
        <div className="space-y-6">
          {/* Header Summary Banner - Clean, High Contrast Theme */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-xs font-bold border border-indigo-200 dark:border-indigo-800">
                  <Activity className="w-3.5 h-3.5" />
                  <span>BÁO CÁO HIỆU SUẤT ĐIỀU HÀNH • {analyticsData.scopeTitle.toUpperCase()}</span>
                </div>
                <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight">
                  Phân Tích Hiệu Suất Tổng Hợp: Công Việc • Kế Hoạch • Nhật Ký Daily
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 max-w-3xl leading-relaxed">
                  Hệ thống đối soát chéo 3 chiều dựa trên dữ liệu thực tế: Tiến độ thực thi task, mức độ bám sát kế hoạch/chuyên đề và kỷ luật phản ánh khó khăn qua báo cáo Daily.
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right bg-slate-50 dark:bg-slate-800/60 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 min-w-[160px]">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider block font-bold">
                    Chỉ số KPI • {analyticsData.scopeTitle}
                  </span>
                  <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400">
                    {analyticsData.hasData ? analyticsData.compositeScore : 0} / 100
                  </div>
                  <span className={`text-[10px] font-bold flex items-center justify-end gap-1 ${analyticsData.scoreColor}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" /> {analyticsData.scoreStatus}
                  </span>
                </div>
              </div>
            </div>

            {/* 4 Core Pillars Indicators - High Contrast Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              {/* Pillar 1: Task Completion */}
              <div className="bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between text-slate-500 font-semibold text-[11px]">
                  <span>1. Công việc hoàn thành</span>
                  <span className="font-bold text-emerald-600 font-mono">{analyticsData.taskCompletionRate}%</span>
                </div>
                <div className="text-base font-black text-slate-900 dark:text-white">
                  {analyticsData.doneTasks} / {analyticsData.totalTasks} việc
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                  <div className="bg-emerald-500 h-full rounded-full transition-all" style={{ width: `${analyticsData.taskCompletionRate}%` }} />
                </div>
                <span className="text-[10px] text-slate-400 block pt-0.5">
                  {analyticsData.inProgressTasks} việc đang làm • {analyticsData.todoTasks} cần làm
                </span>
              </div>

              {/* Pillar 2: Workflow SLA */}
              <div className="bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between text-slate-500 font-semibold text-[11px]">
                  <span>2. Phối hợp liên phòng SLA</span>
                  <span className="font-bold text-purple-600 font-mono">
                    {analyticsData.totalWf > 0 ? `Đạt ${analyticsData.wfSlaRate}%` : "Chưa có phiếu"}
                  </span>
                </div>
                <div className="text-base font-black text-slate-900 dark:text-white">
                  {analyticsData.totalWf} phiếu luân chuyển
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                  <div className="bg-purple-600 h-full rounded-full transition-all" style={{ width: `${analyticsData.totalWf > 0 ? analyticsData.wfSlaRate : 0}%` }} />
                </div>
                <span className="text-[10px] text-slate-400 block pt-0.5">
                  {analyticsData.totalWf > 0
                    ? `${analyticsData.doneWf} xong • ${analyticsData.pendingWf} đang chạy${analyticsData.overdueWf > 0 ? ` • ${analyticsData.overdueWf} trễ` : ""}`
                    : "Chưa có quy trình luân chuyển"}
                </span>
              </div>

              {/* Pillar 3: Thematic Plans & Progress */}
              <div className="bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between text-slate-500 font-semibold text-[11px]">
                  <span>3. Kế hoạch chuyên đề</span>
                  <span className="font-bold text-orange-600 font-mono">
                    {analyticsData.totalPlans > 0 ? `${analyticsData.planProgressRate}%` : "Chưa thiết lập"}
                  </span>
                </div>
                <div className="text-base font-black text-slate-900 dark:text-white">
                  {analyticsData.totalPlans} chuyên đề
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                  <div className="bg-orange-500 h-full rounded-full transition-all" style={{ width: `${analyticsData.totalPlans > 0 ? analyticsData.planProgressRate : 0}%` }} />
                </div>
                <span className="text-[10px] text-slate-400 block pt-0.5">
                  {analyticsData.totalPlans > 0
                    ? `${analyticsData.completedStagesCount}/${analyticsData.totalStagesCount} bước hoàn thành`
                    : "Chưa có kế hoạch chuyên đề"}
                </span>
              </div>

              {/* Pillar 4: Daily Discipline */}
              <div className="bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between text-slate-500 font-semibold text-[11px]">
                  <span>4. Kỷ luật Báo cáo Daily</span>
                  <span className="font-bold text-indigo-600 font-mono">{analyticsData.dailyDisciplineRate}%</span>
                </div>
                <div className="text-base font-black text-slate-900 dark:text-white">
                  {analyticsData.dailySubmittedCount} / {analyticsData.staffCount} nhân sự
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                  <div className="bg-indigo-600 h-full rounded-full transition-all" style={{ width: `${analyticsData.dailyDisciplineRate}%` }} />
                </div>
                <span className="text-[10px] text-slate-400 block pt-0.5">
                  {analyticsData.realIssues.length > 0
                    ? `Ghi nhận ${analyticsData.realIssues.length} vướng mắc phát sinh`
                    : "Không có khó khăn phát sinh"}
                </span>
              </div>
            </div>
          </div>

          {/* ==================== PHẦN 1: PHÂN TÍCH CHI TIẾT THEO CÔNG VIỆC ==================== */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <ListTodo className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    1. Phân Tích Thực Thi Công Việc (Task Execution &amp; Workflows)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Chi tiết phân bổ khối lượng, tỷ lệ hoàn tất và tốc độ giải quyết việc giữa 4 phòng ban
                  </p>
                </div>
              </div>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300">
                Hiệu suất thực thi: {analyticsData.taskCompletionRate}/100
              </span>
            </div>

            {/* Department Breakdown Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {[
                { name: "Kinh Doanh", icon: Briefcase },
                { name: "Application", icon: FlaskConical },
                { name: "Kho & Vận Hành", icon: Package },
                { name: "Cung Ứng", icon: ShoppingCart }
              ].map((dept) => {
                const deptTasks = tasks.filter(t => t.department === dept.name);
                const doneCount = deptTasks.filter(t => t.status === "DONE").length;
                const inProgCount = deptTasks.filter(t => t.status === "IN_PROGRESS").length;
                const todoCount = deptTasks.filter(t => t.status === "TODO").length;
                const total = deptTasks.length;
                const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0;
                const Icon = dept.icon;

                return (
                  <div key={dept.name} className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 rounded-xl p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Icon className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                        <span className="text-xs font-bold text-slate-900 dark:text-white">{dept.name}</span>
                      </div>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        {total} việc
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-slate-500">Hoàn thành:</span>
                      <span className="font-mono font-black text-slate-900 dark:text-white">{doneCount}/{total} ({percent}%)</span>
                    </div>

                    <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                      <div className="bg-indigo-600 h-full rounded-full transition-all" style={{ width: `${percent}%` }} />
                    </div>

                    <div className="grid grid-cols-3 gap-1 text-[10px] text-center pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                      <div className="bg-amber-100/60 dark:bg-amber-950/40 rounded p-1 text-amber-800 dark:text-amber-300">
                        <strong>{todoCount}</strong> Cần làm
                      </div>
                      <div className="bg-blue-100/60 dark:bg-blue-950/40 rounded p-1 text-blue-800 dark:text-blue-300">
                        <strong>{inProgCount}</strong> Đang chạy
                      </div>
                      <div className="bg-emerald-100/60 dark:bg-emerald-950/40 rounded p-1 text-emerald-800 dark:text-emerald-300">
                        <strong>{doneCount}</strong> Xong
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Workflow Speed & Bottleneck Analysis */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="p-3.5 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200/60 dark:border-indigo-900/40 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-indigo-900 dark:text-indigo-200">
                  <span>⚡ Tốc Độ Luân Chuyển Quy Trình Liên Phòng</span>
                  <span className="text-indigo-600 dark:text-indigo-400 font-mono">
                    {analyticsData.totalWf > 0 ? `SLA: ${analyticsData.wfSlaRate}%` : "Chưa có dữ liệu"}
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                  {analyticsData.totalWf > 0
                    ? `Hệ thống ghi nhận ${analyticsData.totalWf} phiếu phối hợp luân chuyển liên phòng ban. Tỷ lệ xử lý đúng cam kết thời gian đạt ${analyticsData.wfSlaRate}%, trong đó có ${analyticsData.doneWf} phiếu đã hoàn tất dứt điểm.`
                    : "Chưa có phiếu luân chuyển phối hợp liên phòng ban nào trong phạm vi được chọn. Khi các phòng ban khởi tạo yêu cầu ở tab 'Quy Trình Phối Hợp', dữ liệu thời gian SLA và tốc độ chuyển tiếp sẽ được tự động tổng hợp tại đây."}
                </p>
              </div>

              <div className="p-3.5 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-amber-900 dark:text-amber-200">
                  <span>⚠️ Nhận Diện Điểm Nghẽn Cần Tháo Gỡ</span>
                  <span className="text-amber-600 dark:text-amber-400 font-bold">
                    {analyticsData.overdueWf > 0 ? `${analyticsData.overdueWf} Phiếu Trễ Hạn` : "0 Điểm Nghẽn"}
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                  {analyticsData.overdueWf > 0
                    ? `Có ${analyticsData.overdueWf} phiếu luân chuyển đang vượt quá thời hạn cam kết xử lý (due date). Đề nghị các Trưởng bộ phận liên quan rà soát và tháo gỡ điểm nghẽn cho nhân sự phụ trách.`
                    : analyticsData.totalWf > 0
                    ? "Không phát hiện điểm nghẽn ách tắc: 100% các phiếu phối hợp liên phòng đang được luân chuyển và xử lý trong khung thời hạn SLA cho phép."
                    : "Hệ thống vận hành thông suốt, chưa phát sinh điểm nghẽn hay ách tắc công việc nào."}
                </p>
              </div>
            </div>
          </div>

          {/* ==================== PHẦN 2: PHÂN TÍCH TIẾN ĐỘ THEO KẾ HOẠCH & CHUYÊN ĐỀ ==================== */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    2. Phân Tích Tiến Độ Kế Hoạch &amp; Chuyên Đề Phòng Ban
                  </h3>
                  <p className="text-xs text-slate-500">
                    Đối soát mức độ bám sát các đề tài nghiên cứu, kế hoạch chuyên đề và tiến độ các giai đoạn thực hiện
                  </p>
                </div>
              </div>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300">
                Độ bám kế hoạch: {analyticsData.planProgressRate}/100
              </span>
            </div>

            {analyticsData.scopeThematicPlans.length === 0 ? (
              <div className="p-8 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl space-y-2">
                <Layers className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300">
                  Chưa có kế hoạch chuyên đề nào cho {analyticsData.scopeTitle}
                </h4>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Các phòng ban có thể tạo mới các đề tài, kế hoạch chuyên đề theo quy trình chuyên biệt tại tab <strong>"Lịch &amp; Kế Hoạch Chuyên Đề"</strong> để hệ thống tự động theo dõi tiến độ tại đây.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {analyticsData.scopeThematicPlans.map((prj: any) => {
                  const stages = prj.stages || [];
                  const completed = stages.filter((s: any) => s.status === "completed").length;
                  const total = stages.length;
                  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

                  return (
                    <div key={prj.id} className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/80 dark:border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                          {prj.id}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          percent === 100 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                        }`}>
                          {percent === 100 ? "Hoàn tất" : `${percent}%`}
                        </span>
                      </div>
                      <div className="font-bold text-xs text-slate-900 dark:text-white line-clamp-1">
                        {prj.name}
                      </div>
                      <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                        <div className="bg-purple-600 h-full rounded-full transition-all" style={{ width: `${percent}%` }} />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                        <span>👤 {prj.lead || "Chưa giao"}</span>
                        <span>{completed}/{total} bước</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ==================== PHẦN 3: PHÂN TÍCH NHẬT KÝ DAILY & KỶ LUẬT VẬN HÀNH ==================== */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <CalendarDays className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    3. Phân Tích Nhật Ký Daily &amp; Kỷ Luật Vận Hành Nhân Sự
                  </h3>
                  <p className="text-xs text-slate-500">
                    Đánh giá tính kỷ luật báo cáo ngày, trích xuất các vướng mắc phát sinh và kế hoạch ngày tiếp theo
                  </p>
                </div>
              </div>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                Kỷ luật Daily: {analyticsData.dailyDisciplineRate}%
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              {/* Daily Submission by Department */}
              <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl space-y-2">
                <span className="font-bold text-slate-700 dark:text-slate-300 block">📊 Tỷ Lệ Nộp Báo Cáo Daily</span>
                <div className="space-y-1.5 pt-1">
                  {analyticsData.deptScorecards.map((ds) => (
                    <div key={ds.dept} className="flex justify-between text-[11px]">
                      <span>{ds.dept}:</span>
                      <strong className={ds.dailyCount > 0 ? "text-emerald-600" : "text-slate-400"}>
                        {ds.dailyCount}/{ds.staffCount} ({ds.dailyPercent}%)
                      </strong>
                    </div>
                  ))}
                </div>
              </div>

              {/* Real Difficulties extracted from Daily */}
              <div className="p-3.5 bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200/80 dark:border-rose-900/40 rounded-xl space-y-2">
                <span className="font-bold text-rose-800 dark:text-rose-300 block">🛑 Khó Khăn Đã Ghi Nhận (Từ Daily)</span>
                {analyticsData.realIssues.length > 0 ? (
                  <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed max-h-36 overflow-y-auto">
                    {analyticsData.realIssues.map((it, idx) => (
                      <li key={idx}>
                        <strong>[{it.dept}] {it.staff}:</strong> {it.issue}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] text-slate-500 italic pt-1">
                    ✓ Hiện tại chưa ghi nhận khó khăn / vướng mắc nào từ báo cáo ngày của nhân sự.
                  </p>
                )}
              </div>

              {/* Real Next Day Plans extracted from Daily */}
              <div className="p-3.5 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-900/40 rounded-xl space-y-2">
                <span className="font-bold text-emerald-800 dark:text-emerald-300 block">🎯 Mức Độ Sẵn Sàng Kế Hoạch Ngày Mai</span>
                {analyticsData.realNextDayPlans.length > 0 ? (
                  <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed max-h-36 overflow-y-auto">
                    {analyticsData.realNextDayPlans.map((it, idx) => (
                      <li key={idx}>
                        <strong>[{it.dept}] {it.staff}:</strong> {it.plan}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] text-slate-500 italic pt-1">
                    Chưa có kế hoạch ngày mai được ghi nhận từ báo cáo daily.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* ==================== PHẦN 4: BẢNG TỔNG HỢP XẾP HẠNG KPI & KHUYẾN NGHỊ ĐIỀU HÀNH ==================== */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <BarChart3 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    4. Bảng Tổng Hợp Đánh Giá KPI &amp; Khuyến Nghị Điều Hành Từ Ban Giám Đốc
                  </h3>
                  <p className="text-xs text-slate-500">
                    Bảng điểm trọng số tính toán tự động: Thực thi công việc (40%) + Bám sát kế hoạch (30%) + Kỷ luật Daily (30%)
                  </p>
                </div>
              </div>
              <span className="text-xs font-mono font-bold text-slate-500">
                Kỳ đánh giá: Tháng 09/2026
              </span>
            </div>

            {/* Department KPI Scorecard Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 font-bold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">Phòng ban</th>
                    <th className="py-2.5 px-3">Số lượng việc</th>
                    <th className="py-2.5 px-3">Tỷ lệ hoàn tất</th>
                    <th className="py-2.5 px-3">Tiến độ Kế hoạch / Chuyên đề</th>
                    <th className="py-2.5 px-3">Kỷ luật Daily</th>
                    <th className="py-2.5 px-3">Điểm KPI Tổng</th>
                    <th className="py-2.5 px-3 text-right">Xếp loại</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {analyticsData.deptScorecards.map((ds) => {
                    const Icon = ds.dept === "Application" ? FlaskConical : ds.dept === "Kinh Doanh" ? Briefcase : ds.dept === "Kho & Vận Hành" ? Package : ShoppingCart;
                    const iconColor = ds.dept === "Application" ? "text-purple-600" : ds.dept === "Kinh Doanh" ? "text-orange-600" : ds.dept === "Kho & Vận Hành" ? "text-emerald-600" : "text-blue-600";

                    return (
                      <tr key={ds.dept} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <Icon className={`w-3.5 h-3.5 ${iconColor}`} /> {ds.dept}
                        </td>
                        <td className="py-2.5 px-3">
                          {ds.totalTasks > 0 ? `${ds.totalTasks} việc (${ds.inProgTasks} đang chạy)` : "0 việc"}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-emerald-600">
                          {ds.totalTasks > 0 ? `${ds.taskPercent}%` : "0%"}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-700 dark:text-slate-300">
                          {ds.plansCount > 0 ? `${ds.plansCount} chuyên đề (${ds.planPercent}%)` : "Chưa thiết lập"}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-indigo-600">
                          {ds.dailyCount}/{ds.staffCount} ({ds.dailyPercent}%)
                        </td>
                        <td className="py-2.5 px-3 font-mono font-black text-indigo-600 text-sm">
                          {ds.hasData ? `${ds.score} / 100` : "0 / 100"}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${ds.gradeClass}`}>
                            {ds.grade}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Executive Actionable Insights */}
            <div className="bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/80 rounded-xl p-4 text-xs space-y-2">
              <div className="flex items-center gap-2 font-bold text-indigo-900 dark:text-indigo-200">
                <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>Khuyến Nghị Điều Hành Trọng Tâm Cho Ban Giám Đốc:</span>
              </div>
              <ol className="list-decimal list-inside space-y-1.5 text-slate-700 dark:text-slate-300 leading-relaxed pl-1">
                {!analyticsData.hasData ? (
                  <>
                    <li>
                      <strong>Khởi tạo dữ liệu vận hành:</strong> Dữ liệu vận hành hệ thống hiện đang ở trạng thái sạch (0 công việc, 0 quy trình phối hợp, 0 báo cáo daily). Các Trưởng bộ phận cần bắt đầu phân công nhiệm vụ tuần trên Bảng Công Việc.
                    </li>
                    <li>
                      <strong>Thiết lập quy trình phối hợp liên phòng:</strong> Khuyến khích phòng Kinh Doanh, Application, Kho và Cung Ứng khởi tạo các phiếu phối hợp luân chuyển để chuẩn hóa luồng xử lý và giám sát thời gian SLA.
                    </li>
                    <li>
                      <strong>Thiết lập kỷ luật Daily:</strong> Nhắc nhở nhân sự các phòng ban gửi Nhật Ký Daily mỗi cuối ngày làm việc để hệ thống tự động ghi nhận số giờ, mức độ tương xứng và tính điểm KPI chính xác.
                    </li>
                  </>
                ) : (
                  <>
                    <li>
                      <strong>Thúc đẩy hoàn thành công việc:</strong> Tập trung đẩy nhanh tiến độ {analyticsData.inProgressTasks} đầu việc đang thực hiện trên toàn hệ thống để nâng cao tỷ lệ hoàn thành chung.
                    </li>
                    {analyticsData.overdueWf > 0 && (
                      <li>
                        <strong>Xử lý phiếu luân chuyển trễ hạn:</strong> Khối Cung ứng &amp; Kho cần ưu tiên xử lý dứt điểm {analyticsData.overdueWf} phiếu phối hợp đang quá hạn SLA.
                      </li>
                    )}
                    {analyticsData.realIssues.length > 0 && (
                      <li>
                        <strong>Tháo gỡ vướng mắc nhân sự:</strong> Ban Giám Đốc và các Trưởng phòng cần kiểm tra {analyticsData.realIssues.length} khó khăn được ghi nhận trong Nhật Ký Daily để kịp thời chỉ đạo hỗ trợ.
                      </li>
                    )}
                    <li>
                      <strong>Duy trì kỷ luật báo cáo:</strong> Tiếp tục đôn đốc tỷ lệ nộp báo cáo daily đạt chỉ tiêu 100% nhân sự toàn công ty.
                    </li>
                  </>
                )}
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL 1: CREATE / EDIT TASK ==================== */}
      <Modal
        isOpen={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
        title={taskForm.id ? "CẬP NHẬT CÔNG VIỆC" : "TẠO CÔNG VIỆC MỚI"}
        size="md"
      >
        <form onSubmit={handleSaveTask} className="space-y-3 p-1 text-xs">
          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Tiêu đề công việc *</label>
            <input
              type="text"
              required
              value={taskForm.title}
              onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
              placeholder="VD: Chuẩn bị hóa chất test đối chứng kit HPV..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-medium"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Phòng ban</label>
              <select
                value={taskForm.department}
                onChange={(e) => {
                  const newDept = e.target.value;
                  setTaskForm({
                    ...taskForm,
                    department: newDept,
                    task_category: DEPARTMENT_CATEGORIES[newDept]?.[0] || "Chung"
                  });
                }}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-semibold"
              >
                <option value="Kinh Doanh">Kinh Doanh</option>
                <option value="Application">Application (Lab)</option>
                <option value="Kho & Vận Hành">Kho &amp; Vận Hành</option>
                <option value="Cung Ứng">Cung Ứng</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Phân loại nghiệp vụ</label>
              <select
                value={taskForm.task_category}
                onChange={(e) => setTaskForm({ ...taskForm, task_category: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-semibold"
              >
                {(DEPARTMENT_CATEGORIES[taskForm.department] || []).map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Người phụ trách
                {rolePerspective === "staff" && <span className="text-emerald-600 dark:text-emerald-400 text-[10px] ml-1 font-semibold">(Cá nhân)</span>}
              </label>
              <SearchablePersonnelSelect
                value={taskForm.assignee_name}
                onChange={(val) => setTaskForm({ ...taskForm, assignee_name: val })}
                personnelList={personnelList}
                filterDepartment={rolePerspective === "manager" ? taskForm.department : undefined}
                disabled={rolePerspective === "staff"}
                placeholder="Tìm & chọn nhân sự phụ trách..."
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Khách hàng / Viện</label>
              {/* Chọn từ danh mục khách hàng để công việc hiện trong "Hoạt động với khách hàng" */}
              <SearchableCustomerSelect
                value={taskForm.customer_name}
                onChange={(val) => setTaskForm({ ...taskForm, customer_name: val })}
                customerList={customerList}
                placeholder="Chọn hoặc gõ tìm khách hàng (nếu có)"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Độ ưu tiên</label>
              <select
                value={taskForm.priority}
                onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-semibold"
              >
                <option value="LOW">Thấp</option>
                <option value="MEDIUM">Trung bình</option>
                <option value="HIGH">Cao</option>
                <option value="URGENT">Khẩn cấp</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Trạng thái</label>
              <select
                value={taskForm.status}
                onChange={(e) => setTaskForm({ ...taskForm, status: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-semibold"
              >
                <option value="TODO">Cần làm</option>
                <option value="IN_PROGRESS">Đang làm</option>
                <option value="DONE">Đã hoàn tất</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Hạn chót</label>
              <input
                type="date"
                value={taskForm.deadline ? taskForm.deadline.slice(0, 10) : ""}
                onChange={(e) => setTaskForm({ ...taskForm, deadline: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-medium"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Mô tả chi tiết</label>
            <textarea
              rows={3}
              value={taskForm.description}
              onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-medium"
            />
          </div>

          {/* TRAO ĐỔI VỚI BÊN YÊU CẦU: cùng luồng "Trao đổi nội bộ" của phiếu phối hợp */}
          {(() => {
            const wfCode = (taskForm as any).related_workflow_code;
            const wf = wfCode ? workflows.find((w: any) => w.workflow_code === wfCode) : null;
            if (!wf) return null;
            const comments: any[] = Array.isArray(wf.comments) ? wf.comments : [];
            return (
              <div className="rounded-xl border border-indigo-200 dark:border-indigo-800/70 bg-indigo-50/50 dark:bg-indigo-950/20 p-3 space-y-2">
                <div className="text-xs font-bold text-indigo-800 dark:text-indigo-300">
                  Trao đổi với bên yêu cầu — phiếu {wf.workflow_code} ({comments.length})
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1.5">
                  {comments.length === 0 ? (
                    <div className="text-[11px] text-slate-400 italic">Chưa có trao đổi. Nội dung "Báo cáo kết quả" bên dưới sẽ tự đăng vào đây khi lưu.</div>
                  ) : comments.map((c: any, i: number) => (
                    <div key={i} className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 px-2.5 py-1.5">
                      <div className="flex items-center justify-between text-[10px]">
                        <strong className="text-indigo-600 dark:text-indigo-400">{c.author}{c.source === "task" ? " · báo cáo công việc" : ""}</strong>
                        <span className="text-slate-400 font-mono">{c.time}</span>
                      </div>
                      <p className="text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{c.text}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={taskReplyText}
                    onChange={(e) => setTaskReplyText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleTaskReply(wf); } }}
                    placeholder="Trả lời bên yêu cầu..."
                    className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => handleTaskReply(wf)}
                    disabled={!taskReplyText.trim()}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold disabled:opacity-40 cursor-pointer"
                  >
                    Gửi
                  </button>
                </div>
              </div>
            );
          })()}

          {/* KẾT QUẢ THỰC HIỆN & BÁO CÁO NGHIỆM THU */}
          <div className="bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/80 rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between flex-wrap gap-1">
              <label className="block font-bold text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Báo cáo kết quả thực hiện công việc</span>
              </label>
              <div className="flex items-center gap-1">
                <span className="text-slate-400 text-[10px]">Mẫu nhanh:</span>
                <button
                  type="button"
                  onClick={() => setTaskForm(prev => ({
                    ...prev,
                    result: "Đã hoàn thành toàn bộ nội dung công việc theo đúng yêu cầu và tiêu chuẩn kỹ thuật.",
                    status: "DONE"
                  }))}
                  className="px-2 py-0.5 rounded bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 text-[10px] font-semibold"
                >
                  Hoàn tất chuẩn
                </button>
                <button
                  type="button"
                  onClick={() => setTaskForm(prev => ({
                    ...prev,
                    result: "Đã ban hành SOP, tổ chức đào tạo nội bộ cho nhân sự liên quan và lưu hồ sơ tài liệu đầy đủ.",
                    status: "DONE"
                  }))}
                  className="px-2 py-0.5 rounded bg-purple-100 hover:bg-purple-200 dark:bg-purple-900/60 text-purple-800 dark:text-purple-200 text-[10px] font-semibold"
                >
                  Ban hành SOP
                </button>
                <button
                  type="button"
                  onClick={() => setTaskForm(prev => ({
                    ...prev,
                    result: "Đã làm việc và gửi báo giá / biên bản bàn giao thành công cho khách hàng đối tác.",
                    status: "DONE"
                  }))}
                  className="px-2 py-0.5 rounded bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 text-[10px] font-semibold"
                >
                  Gửi khách hàng
                </button>
              </div>
            </div>

            <textarea
              rows={3}
              value={taskForm.result || ""}
              onChange={(e) => setTaskForm({ ...taskForm, result: e.target.value })}
              placeholder="Nhập chi tiết kết quả xử lý công việc, số liệu thực tế, kết luận nghiệm thu..."
              className="w-full px-3 py-2 rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium"
            />

            {/* ĐÍNH KÈM HÌNH HẢNH & TÀI LIỆU CÔNG VIỆC */}
            <div className="pt-2 border-t border-emerald-200/60 dark:border-emerald-800/60 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                  <Paperclip className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Hình ảnh &amp; Tài liệu đính kèm ({taskForm.attachments?.length || 0})</span>
                </span>

                <label className="cursor-pointer inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] shadow-2xs transition-colors">
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>{isUploading ? "Đang tải lên..." : "+ Đính Kèm Tệp / Hình Ảnh"}</span>
                  <input
                    type="file"
                    multiple
                    disabled={isUploading}
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.xml,.csv"
                    onChange={(e) => handleFileUpload(e.target.files, "task")}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Upload Dropzone Hint */}
              <div className="bg-white/60 dark:bg-slate-900/60 p-2.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-800 text-center">
                <div className="flex items-center justify-center gap-1.5 text-slate-400 text-[11px]">
                  <Paperclip className="w-3.5 h-3.5" />
                  <span>Tải lên tài liệu nghiệm thu (PDF), ảnh chụp kết quả (PNG, JPG), file bảng tính (Excel).</span>
                </div>
              </div>

              {/* Danh sách tệp đính kèm của công việc */}
              {taskForm.attachments && taskForm.attachments.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1">
                  {taskForm.attachments.map((att: any, idx: number) => {
                    const isImg = att.type?.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(att.name);
                    return (
                      <div
                        key={idx}
                        className="bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shadow-2xs"
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
                          {isImg ? (
                            <button
                              type="button"
                              onClick={() => setPreviewDoc({ url: att.url, name: att.name, type: att.type })}
                              className="w-9 h-9 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden shrink-0 border border-slate-200 dark:border-slate-700 relative group cursor-pointer"
                              title="Xem trực tiếp ảnh"
                            >
                              <img src={att.url} alt={att.name} className="w-full h-full object-cover" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setPreviewDoc({ url: att.url, name: att.name, type: att.type })}
                              className="w-9 h-9 rounded bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 cursor-pointer"
                              title="Xem trực tiếp tài liệu"
                            >
                              <FileText className="w-4 h-4" />
                            </button>
                          )}
                          <div className="overflow-hidden text-left">
                            <p className="font-semibold text-slate-800 dark:text-slate-200 truncate text-[11px]" title={att.name}>
                              {att.name}
                            </p>
                            <span className="text-[10px] text-slate-400">
                              {att.size ? `${(att.size / 1024).toFixed(0)} KB` : "Tệp tin"}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => setPreviewDoc({ url: att.url, name: att.name, type: att.type })}
                            className="p-1 rounded text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer"
                            title="Xem trực tiếp trong ứng dụng không cần tải về"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <a
                            href={att.url}
                            target="_blank"
                            rel="noreferrer"
                            download
                            className="p-1 rounded text-indigo-600 hover:text-indigo-800 cursor-pointer"
                            title="Tải về máy"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>
                          <button
                            type="button"
                            onClick={() => {
                              setTaskForm(prev => ({
                                ...prev,
                                attachments: prev.attachments.filter((_, i) => i !== idx)
                              }));
                            }}
                            className="p-1 rounded text-rose-500 hover:text-rose-700"
                            title="Xóa tệp"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsTaskModalOpen(false)}
              className="px-4 py-2 rounded-xl font-bold border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/30"
            >
              {taskForm.id ? "Lưu Cập Nhật" : "Tạo Công Việc"}
            </button>
          </div>
        </form>
      </Modal>

      {/* ==================== MODAL 2: CREATE WORKFLOW ==================== */}
      <Modal
        isOpen={isWorkflowModalOpen}
        onClose={() => setIsWorkflowModalOpen(false)}
        title="KHỞI TẠO PHIẾU PHỐI HỢP LIÊN PHÒNG BAN"
        size="6xl"
      >
        <form onSubmit={handleSaveWorkflow} className="space-y-4 p-2 text-xs">
          {/* Top Section: Template, Title & Priority */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-8 space-y-1">
              <div className="flex items-center justify-between">
                <label className="font-bold text-slate-700 dark:text-slate-300">Mẫu quy trình phối hợp chuẩn *</label>
                <button
                  type="button"
                  onClick={() => {
                    setIsWorkflowModalOpen(false);
                    handleOpenCreateTemplate();
                  }}
                  className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>+ Thiết lập quy trình mẫu mới</span>
                </button>
              </div>
              <select
                value={wfForm.workflow_type}
                style={{ colorScheme: "dark" }}
                onChange={(e) => {
                  const selectedVal = e.target.value;
                  const tmpl = (workflowTemplates.length > 0 ? workflowTemplates : DEFAULT_WORKFLOW_TEMPLATES).find(
                    (w: any) => (w.code || w.id) === selectedVal
                  );
                  if (tmpl) {
                    const rawSteps = Array.isArray(tmpl.steps) ? tmpl.steps : [];
                    const isCreatorAppOrDirector =
                      userRole === "director" || isSameWorkspaceDept(userDept, "Application");
                    const stepsCopy = rawSteps.map((s: any, idx: number) => {
                      const stepDept = normalizeWorkspaceDept(
                        s.dept || tmpl.target_dept || tmpl.targetDept || "Application"
                      );
                      const isAppStep = isSameWorkspaceDept(stepDept, "Application");
                      const cleanedAssignee =
                        isAppStep && !isCreatorAppOrDirector
                          ? ""
                          : cleanWorkspaceAssignee(s.assignee_name);
                      return {
                        step_index: idx,
                        title: s.title || `Bước ${idx + 1}`,
                        dept: stepDept,
                        assignee_name: cleanedAssignee,
                        sla_hours: s.sla_hours || 24,
                        deliverables: s.deliverables || "",
                        status: idx === 0 ? "IN_PROGRESS" : "PENDING"
                      };
                    });
                    setWfForm({
                      ...wfForm,
                      workflow_type: selectedVal,
                      requester_dept: normalizeWorkspaceDept(tmpl.source_dept || tmpl.sourceDept || "Kinh Doanh"),
                      target_dept: stepsCopy.length > 0 ? stepsCopy[0].dept : normalizeWorkspaceDept(tmpl.target_dept || tmpl.targetDept || "Application"),
                      assignee_name: stepsCopy.length > 0 ? stepsCopy[0].assignee_name : "",
                      due_date: toVNDateString(new Date(Date.now() + (tmpl.sla_days || 5) * 86400000)),
                      description: tmpl.description || wfForm.description,
                      steps: stepsCopy
                    });
                  } else {
                    setWfForm({
                      ...wfForm,
                      workflow_type: selectedVal
                    });
                  }
                }}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold cursor-pointer"
              >
                {(workflowTemplates.length > 0 ? workflowTemplates : DEFAULT_WORKFLOW_TEMPLATES).map((wf: any) => (
                  <option key={wf.id || wf.code} value={wf.code || wf.id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white py-1">
                    {wf.name} ({wf.source_dept || wf.sourceDept} ➔ {wf.target_dept || wf.targetDept})
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-4 space-y-1">
              <label className="font-bold text-slate-700 dark:text-slate-300 block">Mức độ ưu tiên</label>
              <select
                value={wfForm.priority || "HIGH"}
                style={{ colorScheme: "dark" }}
                onChange={(e) => setWfForm({ ...wfForm, priority: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold cursor-pointer"
              >
                <option value="CRITICAL" className="bg-white dark:bg-slate-900 text-rose-500 font-bold">🔴 Khẩn cấp (Sự cố viện / Ký thầu gấp)</option>
                <option value="HIGH" className="bg-white dark:bg-slate-900 text-amber-500 font-bold">🟡 Cao (Demo / Soạn đơn xuất kho)</option>
                <option value="MEDIUM" className="bg-white dark:bg-slate-900 text-indigo-500 font-bold">🔵 Bình thường (Kế hoạch định kỳ)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Tiêu đề yêu cầu phối hợp *</label>
            <input
              type="text"
              required
              value={wfForm.title}
              onChange={(e) => setWfForm({ ...wfForm, title: e.target.value })}
              placeholder="VD: Yêu cầu Demo máy Real-time PCR 96 giếng cho Viện Pasteur..."
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-semibold text-xs focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
            />
          </div>

          {/* Key Parameters: Requester, Customer, Product, Due Date */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="block font-bold text-slate-700 dark:text-slate-300">Người yêu cầu</label>
              <SearchablePersonnelSelect
                value={wfForm.requester_name}
                onChange={(val) => setWfForm({ ...wfForm, requester_name: val })}
                personnelList={personnelList}
                placeholder="Chọn nhân viên yêu cầu..."
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="font-bold text-slate-700 dark:text-slate-300">Khách hàng / Viện</label>
                <span className="text-[10px] text-indigo-400">Chọn hoặc gõ tìm</span>
              </div>
              <SearchableCustomerSelect
                value={wfForm.customer_name}
                onChange={(val) => setWfForm({ ...wfForm, customer_name: val })}
                customerList={customerList}
                placeholder="Chọn hoặc gõ tìm Bệnh viện / Viện..."
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="font-bold text-slate-700 dark:text-slate-300">Sản phẩm / Thiết bị</label>
                <span className="text-[10px] text-purple-400">Chọn hoặc gõ tìm</span>
              </div>
              <SearchableProductSelect
                value={wfForm.product_info}
                onChange={(val) => setWfForm({ ...wfForm, product_info: val })}
                productList={productList}
                placeholder="Chọn hoặc gõ tìm Sản phẩm / Kit / Máy..."
              />
            </div>

            <div className="space-y-1">
              <label className="block font-bold text-slate-700 dark:text-slate-300">Hạn chót cần hoàn tất</label>
              <input
                type="date"
                value={wfForm.due_date ? wfForm.due_date.slice(0, 10) : ""}
                onChange={(e) => setWfForm({ ...wfForm, due_date: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-medium"
              />
            </div>
          </div>

          {/* Stepper Pipeline Configuration for this ticket */}
          <div className="bg-slate-50/80 dark:bg-slate-950/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <span className="font-bold text-slate-900 dark:text-white text-xs block">
                    Các bước thực hiện theo quy trình (Stage-Gate Pipeline):
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Khi gửi yêu cầu sang Application, bộ phận Application sẽ chủ động phân công nhân sự phụ trách.
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const currentSteps = wfForm.steps || [];
                  const newStep = {
                    step_index: currentSteps.length,
                    title: `Bước ${currentSteps.length + 1}: Bàn giao`,
                    dept: "Application",
                    assignee_name: "",
                    sla_hours: 24,
                    deliverables: "Biên bản xác nhận",
                    status: "PENDING"
                  };
                  setWfForm({ ...wfForm, steps: [...currentSteps, newStep] });
                }}
                className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 px-3 py-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Thêm bước</span>
              </button>
            </div>

            <div className="space-y-2">
              {(wfForm.steps || []).map((step: any, idx: number) => {
                const isAppStepLockedForSales =
                  isSameWorkspaceDept(step.dept, "Application") &&
                  userRole !== "director" &&
                  !isSameWorkspaceDept(userDept, "Application");
                return (
                  <div
                    key={idx}
                    className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800/80 grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center text-xs shadow-2xs hover:border-indigo-500/40 transition-all"
                  >
                    <div className="md:col-span-1 flex items-center justify-center">
                      <span className="w-7 h-7 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 font-extrabold flex items-center justify-center text-xs border border-indigo-200 dark:border-indigo-800">
                        B{idx + 1}
                      </span>
                    </div>
                    <div className="md:col-span-4">
                      <input
                        type="text"
                        value={step.title}
                        onChange={(e) => {
                          const updated = [...(wfForm.steps || [])];
                          updated[idx].title = e.target.value;
                          setWfForm({ ...wfForm, steps: updated });
                        }}
                        placeholder="Tên công việc của bước..."
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-semibold"
                      />
                    </div>
                    <div className="md:col-span-3">
                      <DepartmentDropdownSelect
                        value={step.dept}
                        onChange={(val) => {
                          const updated = [...(wfForm.steps || [])];
                          updated[idx].dept = val;
                          if (
                            isSameWorkspaceDept(val, "Application") &&
                            userRole !== "director" &&
                            !isSameWorkspaceDept(userDept, "Application")
                          ) {
                            updated[idx].assignee_name = "";
                          }
                          setWfForm({ ...wfForm, steps: updated });
                        }}
                      />
                    </div>
                    <div className="md:col-span-3">
                      {isAppStepLockedForSales ? (
                        <div className="w-full px-3 py-2 rounded-xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/70 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 font-bold text-[11px] flex items-center gap-1.5">
                          <span>⏳ Do Application tự phân công</span>
                        </div>
                      ) : (
                        <SearchablePersonnelSelect
                          value={cleanWorkspaceAssignee(step.assignee_name)}
                          onChange={(val) => {
                            const updated = [...(wfForm.steps || [])];
                            updated[idx].assignee_name = val;
                            setWfForm({ ...wfForm, steps: updated });
                          }}
                          personnelList={personnelList}
                          filterDepartment={step.dept}
                          placeholder="Chờ bộ phận tiếp nhận phân công..."
                        />
                      )}
                    </div>
                    <div className="md:col-span-1 flex justify-end">
                      {(wfForm.steps || []).length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            const updated = (wfForm.steps || []).filter((_: any, i: number) => i !== idx);
                            setWfForm({ ...wfForm, steps: updated });
                          }}
                          className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors cursor-pointer"
                          title="Xóa bước này"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Mô tả yêu cầu chi tiết</label>
            <textarea
              rows={3}
              value={wfForm.description}
              onChange={(e) => setWfForm({ ...wfForm, description: e.target.value })}
              placeholder="Yêu cầu số lượng mẫu, thời gian có mặt tại viện, yêu cầu bảo quản lạnh..."
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-medium"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsWorkflowModalOpen(false)}
              className="px-5 py-2.5 rounded-xl font-bold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 rounded-xl font-bold bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/30 transition-all cursor-pointer flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              <span>Phát Lệnh Phối Hợp</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* ==================== MODAL 2B: CREATE / EDIT WORKFLOW TEMPLATE ==================== */}
      <Modal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        title={templateForm.id ? "CHỈNH SỬA MẪU QUY TRÌNH PHỐI HỢP" : "THIẾT LẬP QUY TRÌNH PHỐI HỢP MỚI CHO CÁC PHÒNG BAN"}
        size="4xl"
      >
        <form onSubmit={handleSaveTemplate} className="space-y-3.5 p-1 text-xs">
          <div className="bg-indigo-50/70 dark:bg-indigo-950/30 p-3 rounded-xl border border-indigo-100 dark:border-indigo-900/60 text-slate-700 dark:text-slate-300 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-indigo-700 dark:text-indigo-400">
              <Sparkles className="w-4 h-4" />
              <span>Thiết kế Quy trình Phối hợp Chuẩn hóa (Stage-Gate Pipeline)</span>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Bạn có thể tự định nghĩa quy trình phối hợp giữa bất kỳ phòng ban nào. Sau khi lưu, quy trình sẽ xuất hiện trong danh mục để toàn thể cán bộ nhân viên áp dụng ngay.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Tên quy trình phối hợp *</label>
              <input
                type="text"
                required
                value={templateForm.name}
                onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
                placeholder="VD: Kỹ Thuật ➔ Kho: Kiểm định & Bảo dưỡng thiết bị Demo..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-bold text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Mã quy trình (viết tắt)</label>
              <input
                type="text"
                value={templateForm.code}
                onChange={(e) => setTemplateForm({ ...templateForm, code: e.target.value })}
                placeholder="VD: TECH_TO_WH"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono font-bold"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Phòng ban đề xuất *</label>
              <DepartmentDropdownSelect
                value={templateForm.source_dept}
                onChange={(val) => setTemplateForm({ ...templateForm, source_dept: val })}
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Phòng ban tiếp nhận chính *</label>
              <DepartmentDropdownSelect
                value={templateForm.target_dept}
                onChange={(val) => setTemplateForm({ ...templateForm, target_dept: val })}
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">SLA mục tiêu (ngày)</label>
              <input
                type="number"
                min={1}
                max={60}
                value={templateForm.sla_days}
                onChange={(e) => setTemplateForm({ ...templateForm, sla_days: parseInt(e.target.value, 10) || 3 })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-semibold"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Mục đích &amp; Hướng dẫn phối hợp</label>
            <textarea
              rows={2}
              value={templateForm.description}
              onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })}
              placeholder="Quy định trách nhiệm, điều kiện bàn giao và yêu cầu hồ sơ giữa các bên..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            />
          </div>

          {/* Steps Pipeline Builder */}
          <div className="bg-slate-50/80 dark:bg-slate-950/40 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-indigo-600" />
                  <span>Cấu Hình Chuỗi Các Bước Bàn Giao (Stage-Gate Pipeline)</span>
                </h4>
                <p className="text-[11px] text-slate-500">
                  Mỗi bước sẽ có phòng ban phụ trách, người thực hiện mặc định và tiêu chuẩn hồ sơ đầu ra bắt buộc.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const cur = templateForm.steps || [];
                  const newSt = {
                    step_index: cur.length,
                    title: `Bước ${cur.length + 1}: Thực hiện`,
                    dept: templateForm.target_dept || "Application",
                    assignee_name: "",
                    sla_hours: 24,
                    deliverables: "Biên bản nghiệm thu kỹ thuật"
                  };
                  setTemplateForm({ ...templateForm, steps: [...cur, newSt] });
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1 shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Thêm Bước</span>
              </button>
            </div>

            <div className="space-y-2.5">
              {(templateForm.steps || []).map((st: any, sIdx: number) => (
                <div
                  key={sIdx}
                  className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-2"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
                    <span className="font-extrabold text-xs px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                      Bước {sIdx + 1}
                    </span>
                    {(templateForm.steps || []).length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const updated = (templateForm.steps || []).filter((_: any, i: number) => i !== sIdx);
                          setTemplateForm({ ...templateForm, steps: updated });
                        }}
                        className="text-rose-500 hover:text-rose-700 text-xs font-bold flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Xóa bước</span>
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
                    <div className="md:col-span-6">
                      <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Tên bước công việc *</label>
                      <input
                        type="text"
                        required
                        value={st.title}
                        onChange={(e) => {
                          const updated = [...(templateForm.steps || [])];
                          updated[sIdx].title = e.target.value;
                          setTemplateForm({ ...templateForm, steps: updated });
                        }}
                        placeholder="VD: Kiểm tra tính khả thi & tiếp nhận mẫu"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 font-bold"
                      />
                    </div>

                    <div className="md:col-span-3">
                      <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Phòng ban thực hiện</label>
                      <DepartmentDropdownSelect
                        value={st.dept}
                        onChange={(val) => {
                          const updated = [...(templateForm.steps || [])];
                          updated[sIdx].dept = val;
                          setTemplateForm({ ...templateForm, steps: updated });
                        }}
                      />
                    </div>

                    <div className="md:col-span-3">
                      <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Thời hạn SLA (giờ)</label>
                      <input
                        type="number"
                        min={1}
                        value={st.sla_hours || 24}
                        onChange={(e) => {
                          const updated = [...(templateForm.steps || [])];
                          updated[sIdx].sla_hours = parseInt(e.target.value, 10) || 24;
                          setTemplateForm({ ...templateForm, steps: updated });
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 font-semibold"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Nhân sự mặc định phụ trách</label>
                      <SearchablePersonnelSelect
                        value={st.assignee_name || ""}
                        onChange={(val) => {
                          const updated = [...(templateForm.steps || [])];
                          updated[sIdx].assignee_name = val;
                          setTemplateForm({ ...templateForm, steps: updated });
                        }}
                        personnelList={personnelList}
                        placeholder="Chọn nhân sự (hoặc để trống)..."
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Tiêu chuẩn đầu ra (Deliverable)</label>
                      <input
                        type="text"
                        value={st.deliverables || ""}
                        onChange={(e) => {
                          const updated = [...(templateForm.steps || [])];
                          updated[sIdx].deliverables = e.target.value;
                          setTemplateForm({ ...templateForm, steps: updated });
                        }}
                        placeholder="VD: Biên bản nghiệm thu có chữ ký bác sĩ / khách hàng..."
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsTemplateModalOpen(false)}
              className="px-4 py-2 rounded-xl font-bold border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/30"
            >
              Lưu Quy Trình Vào Hệ Thống
            </button>
          </div>
        </form>
      </Modal>

      {/* ==================== MODAL 2C: STAGE-GATE STEP ADVANCE & HANDOFF ==================== */}
      <Modal
        isOpen={isAdvanceStepModalOpen}
        onClose={() => setIsAdvanceStepModalOpen(false)}
        title="NGHIỆM THU BƯỚC & CHUYỂN GIAO TIẾP THEO (STAGE-GATE)"
        size="md"
      >
        <form onSubmit={handleAdvanceStep} className="space-y-3.5 p-1 text-xs">
          {advanceStepData.workflow && (
            <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-mono font-black text-indigo-600 dark:text-indigo-400">
                  {advanceStepData.workflow.workflow_code}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-200">
                  Bước {advanceStepData.stepIndex + 1}: {advanceStepData.currentStep?.title}
                </span>
              </div>
              <h4 className="font-bold text-slate-900 dark:text-white">
                {advanceStepData.workflow.title}
              </h4>
              {advanceStepData.currentStep?.deliverables && (
                <div className="text-[11px] text-slate-500 pt-1 border-t border-slate-200 dark:border-slate-700">
                  <strong>Yêu cầu đầu ra của bước:</strong> {advanceStepData.currentStep.deliverables}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
              Ghi chú kết quả &amp; Nội dung nghiệm thu bước này *
            </label>
            <textarea
              rows={3}
              required
              value={advanceStepData.stepResult}
              onChange={(e) => setAdvanceStepData({ ...advanceStepData, stepResult: e.target.value })}
              placeholder="VD: Đã hoàn tất chạy 50 mẫu lâm sàng, cường độ huỳnh quang đạt chuẩn 98%, biên bản đã ký nghiệm thu..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-medium"
            />
          </div>

          {/* Attachments for this step */}
          <div className="bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/80 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <label className="block font-bold text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-1">
                <Paperclip className="w-3.5 h-3.5" />
                <span>Đính kèm hình ảnh / biên bản nghiệm thu:</span>
              </label>
              <label className="cursor-pointer px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] flex items-center gap-1 shadow-2xs">
                <UploadCloud className="w-3 h-3" />
                <span>Tải tệp lên</span>
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    const files = e.target.files;
                    if (!files || files.length === 0) return;
                    setIsUploading(true);
                    try {
                      const uploaded: any[] = [];
                      for (let i = 0; i < files.length; i++) {
                        const file = files[i];
                        const formData = new FormData();
                        formData.append("file", file);
                        const res = await fetch("/api/upload", { method: "POST", body: formData });
                        const data = await res.json();
                        if (data.success) {
                          uploaded.push({
                            name: data.name || file.name,
                            url: data.url,
                            size: data.size || file.size,
                            type: data.type || file.type,
                            uploaded_at: nowVNDateTime()
                          });
                        }
                      }
                      setAdvanceStepData(prev => ({
                        ...prev,
                        attachments: [...prev.attachments, ...uploaded]
                      }));
                      showToast(`Đã tải lên ${uploaded.length} tệp`, "success");
                    } catch (err: any) {
                      showToast("Lỗi tải tệp: " + err.message, "error");
                    } finally {
                      setIsUploading(false);
                    }
                  }}
                />
              </label>
            </div>

            {advanceStepData.attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {advanceStepData.attachments.map((att: any, aIdx: number) => (
                  <span
                    key={aIdx}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 text-[11px]"
                  >
                    <FileText className="w-3 h-3 text-emerald-600" />
                    <span className="truncate max-w-[120px]">{att.name}</span>
                    <button
                      type="button"
                      onClick={() => setAdvanceStepData(prev => ({ ...prev, attachments: prev.attachments.filter((_, i) => i !== aIdx) }))}
                      className="text-rose-500 hover:text-rose-700 ml-1"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Next Step Information / Confirmation */}
          {advanceStepData.nextStep ? (
            <div className="bg-indigo-50/70 dark:bg-indigo-950/30 p-3 rounded-xl border border-indigo-200 dark:border-indigo-800/80 space-y-2">
              <div className="flex items-center gap-1.5 font-bold text-indigo-800 dark:text-indigo-300">
                <ArrowRight className="w-4 h-4" />
                <span>Bàn giao sang Bước {advanceStepData.stepIndex + 2}: {advanceStepData.nextStep.title}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-slate-600 dark:text-slate-400">
                <div>Phòng tiếp nhận: <strong>{advanceStepData.nextStep.dept}</strong></div>
                {advanceStepData.nextStep.sla_hours && <div>Thời hạn: <strong>{advanceStepData.nextStep.sla_hours} giờ</strong></div>}
              </div>
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Nhân sự nhận bàn giao bước tiếp theo:
                </label>
                <SearchablePersonnelSelect
                  value={advanceStepData.nextAssigneeName}
                  onChange={(val) => setAdvanceStepData({ ...advanceStepData, nextAssigneeName: val })}
                  personnelList={personnelList}
                  placeholder="Xác nhận nhân sự nhận bàn giao..."
                />
              </div>
            </div>
          ) : (
            <div className="bg-emerald-50 dark:bg-emerald-950/30 p-3 rounded-xl border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-center font-bold">
              🎉 Đây là bước cuối cùng trong chuỗi quy trình! Bấm xác nhận sẽ nghiệm thu hoàn tất và đóng phiếu.
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsAdvanceStepModalOpen(false)}
              className="px-4 py-2 rounded-xl font-bold border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/30 flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{advanceStepData.nextStep ? "Xác Nhận Nghiệm Thu & Bàn Giao" : "Hoàn Tất Toàn Bộ Quy Trình"}</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* ==================== MODAL 3: WORKFLOW DETAILS & DISCUSSION ==================== */}
      {selectedWorkflowDetail && (
        <Modal
          isOpen={isWorkflowDetailModalOpen}
          onClose={() => setIsWorkflowDetailModalOpen(false)}
          title={`CHI TIẾT PHIẾU PHỐI HỢP: ${selectedWorkflowDetail.workflow_code}`}
          size="lg"
        >
          <div className="space-y-4 p-2 text-xs">
            <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="font-mono font-black text-sm text-indigo-600 dark:text-indigo-400">
                  {selectedWorkflowDetail.workflow_code}
                </span>
                <WorkflowStatusBadge status={selectedWorkflowDetail.status} />
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {selectedWorkflowDetail.title}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-slate-600 dark:text-slate-400 pt-2 border-t border-slate-200 dark:border-slate-700">
                <div>Phòng yêu cầu: <strong>{selectedWorkflowDetail.requester_dept}</strong></div>
                <div>Phòng xử lý: <strong>{selectedWorkflowDetail.target_dept}</strong></div>
                <div>Người yêu cầu: <strong>{selectedWorkflowDetail.requester_name}</strong></div>
                <div>Người xử lý: <strong>{selectedWorkflowDetail.assignee_name || "Chờ phân công"}</strong></div>
              </div>
            </div>

            {/* Interactive Stepper Pipeline in Detail Modal */}
            {selectedWorkflowDetail.steps && selectedWorkflowDetail.steps.length > 0 && (
              <div className="bg-slate-50 dark:bg-slate-800/80 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-1">
                  <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-indigo-600" />
                    <span>Tiến độ Stage-Gate ({selectedWorkflowDetail.steps.filter((s: any) => s.status === 'COMPLETED').length}/{selectedWorkflowDetail.steps.length} bước hoàn tất)</span>
                  </div>
                  {selectedWorkflowDetail.status !== "COMPLETED" && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsWorkflowDetailModalOpen(false);
                        handleOpenAdvanceStep(selectedWorkflowDetail);
                      }}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1 shadow-xs transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Nghiệm Thu Bước &amp; Bàn Giao</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {selectedWorkflowDetail.steps.map((st: any, sIdx: number) => {
                    const isDone = st.status === "COMPLETED";
                    const isCurrent = (selectedWorkflowDetail.current_step_index || 0) === sIdx && selectedWorkflowDetail.status !== "COMPLETED";
                    return (
                      <div
                        key={sIdx}
                        className={`p-2.5 rounded-xl border text-xs ${
                          isDone
                            ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200"
                            : isCurrent
                            ? "bg-indigo-50 border-indigo-300 dark:bg-indigo-950/40 dark:border-indigo-700 text-indigo-900 dark:text-indigo-100 ring-1 ring-indigo-400"
                            : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-400"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-extrabold text-[10px] uppercase">Bước {sIdx + 1}</span>
                          <span className="font-bold text-[10px]">{isDone ? "✓ Xong" : isCurrent ? "⏳ Đang làm" : "Chờ"}</span>
                        </div>
                        <div className="font-bold truncate">{st.title}</div>
                        <div className="text-[10px] mt-0.5 text-slate-500 dark:text-slate-400">
                          {st.dept}: <strong>{st.assignee_name || "Chưa gán"}</strong>
                        </div>
                        {st.deliverables_note && (
                          <div className="mt-1 pt-1 border-t border-emerald-200/50 text-[10px] text-emerald-700 dark:text-emerald-300">
                            <strong>KQ:</strong> {st.deliverables_note}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <label className="block font-bold text-slate-500 uppercase tracking-wider mb-1">Nội dung yêu cầu</label>
              <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 whitespace-pre-line">
                {selectedWorkflowDetail.description || "Không có mô tả chi tiết"}
              </div>
            </div>

            {/* KẾT QUẢ THỰC HIỆN & HỒ SƠ ĐÍNH KÈM */}
            <div className="bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/80 rounded-xl p-3.5 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <h4 className="font-bold text-xs uppercase tracking-wider text-emerald-900 dark:text-emerald-200">
                    Báo Cáo Kết Quả Thực Hiện &amp; Hồ Sơ Bàn Giao
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenRecordResult(selectedWorkflowDetail)}
                  className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1 shadow-xs transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{selectedWorkflowDetail.results_summary ? "Sửa / Bổ Sung Báo Cáo" : "+ Ghi Nhận Kết Quả Mới"}</span>
                </button>
              </div>

              {selectedWorkflowDetail.results_summary ? (
                <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-emerald-200/80 dark:border-emerald-800/50 text-slate-800 dark:text-slate-200 text-xs">
                  {renderWorkflowResultSummary(selectedWorkflowDetail.results_summary)}
                </div>
              ) : (
                <div className="bg-amber-50 dark:bg-amber-950/30 p-3 rounded-xl border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300 text-xs flex items-center justify-between flex-wrap gap-2">
                  <span>Phiếu này hiện chưa có báo cáo kết quả thực hiện được ghi nhận.</span>
                  <button
                    type="button"
                    onClick={() => handleOpenRecordResult(selectedWorkflowDetail)}
                    className="font-bold underline text-amber-900 dark:text-amber-200 hover:text-amber-700"
                  >
                    Bấm vào đây để ghi nhận kết quả &amp; đính kèm hồ sơ
                  </button>
                </div>
              )}

              {/* Attachments List */}
              {selectedWorkflowDetail.attachments && selectedWorkflowDetail.attachments.length > 0 ? (
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between">
                    <label className="block text-[11px] font-bold text-emerald-800 dark:text-emerald-300">
                      📎 Tài liệu &amp; hình ảnh đính kèm ({selectedWorkflowDetail.attachments.length}):
                    </label>
                    <button
                      type="button"
                      onClick={() => handleOpenRecordResult(selectedWorkflowDetail)}
                      className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline font-semibold"
                    >
                      + Đính kèm thêm
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {selectedWorkflowDetail.attachments.map((att: any, idx: number) => {
                      const isImg = att.type?.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(att.name);
                      return (
                        <div
                          key={idx}
                          className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shadow-2xs"
                        >
                          <div className="flex items-center gap-2 overflow-hidden">
                            {isImg ? (
                              <button
                                type="button"
                                onClick={() => setPreviewImage(att.url)}
                                className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden shrink-0 border border-slate-200 dark:border-slate-700 relative group cursor-pointer"
                                title="Bấm để xem phóng to ảnh"
                              >
                                <img src={att.url} alt={att.name} className="w-full h-full object-cover" />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                  <Eye className="w-3.5 h-3.5 text-white" />
                                </div>
                              </button>
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-200 dark:border-indigo-800">
                                <FileText className="w-5 h-5" />
                              </div>
                            )}
                            <div className="overflow-hidden text-left">
                              <p className="font-semibold text-slate-800 dark:text-slate-200 truncate text-xs" title={att.name}>
                                {att.name}
                              </p>
                              <span className="text-[10px] text-slate-400">
                                {att.size ? `${(att.size / 1024).toFixed(0)} KB` : "Tài liệu"} • {att.uploaded_at || "Đã lưu"}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {isImg && (
                              <button
                                type="button"
                                onClick={() => setPreviewImage(att.url)}
                                title="Xem phóng to ảnh"
                                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-white"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <a
                              href={att.url}
                              target="_blank"
                              rel="noreferrer"
                              download
                              title="Tải về tệp này"
                              className="p-1.5 rounded-lg text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-slate-400 italic pt-1">
                  Chưa có tài liệu hay hình ảnh nào được đính kèm cho phiếu này
                </div>
              )}
            </div>

            {/* TRAO ĐỔI NỘI BỘ */}
            <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <label className="block font-bold text-slate-700 dark:text-slate-300">
                Trao đổi nội bộ giữa 2 phòng ban ({selectedWorkflowDetail.comments?.length || 0})
              </label>

              <div className="max-h-48 overflow-y-auto space-y-2 bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                {selectedWorkflowDetail.comments && selectedWorkflowDetail.comments.length > 0 ? (
                  selectedWorkflowDetail.comments.map((c: any, idx: number) => (
                    <div key={idx} className="bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <strong className="text-indigo-600 dark:text-indigo-400">
                          {c.author}
                          {c.source === "task" && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[9px] font-bold">Báo cáo công việc{c.task_code ? ` ${c.task_code}` : ""}</span>}
                        </strong>
                        <span className="text-slate-400 font-mono text-[10px]">{c.time}</span>
                      </div>
                      <p className="text-slate-800 dark:text-slate-200 text-xs whitespace-pre-wrap">{c.text}</p>
                      {c.attachments && c.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {c.attachments.map((cAtt: any, cAttIdx: number) => (
                            <a
                              key={cAttIdx}
                              href={cAtt.url}
                              target="_blank"
                              rel="noreferrer"
                              download
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-semibold text-slate-700 dark:text-slate-300 hover:text-indigo-600"
                            >
                              <Paperclip className="w-2.5 h-2.5" />
                              <span className="truncate max-w-[120px]">{cAtt.name}</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="text-center py-6 text-slate-400 italic">Chưa có phản hồi trao đổi nào</div>
                )}
              </div>

              {/* Pending attachments for comment */}
              {workflowCommentAttachments.length > 0 && (
                <div className="flex flex-wrap gap-1 p-2 bg-slate-100 dark:bg-slate-800 rounded-xl">
                  {workflowCommentAttachments.map((att, attIdx) => (
                    <span key={attIdx} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-slate-900 text-[10px] font-bold border border-slate-200 dark:border-slate-700">
                      <Paperclip className="w-2.5 h-2.5 text-indigo-600" />
                      <span className="truncate max-w-[120px]">{att.name}</span>
                      <button
                        type="button"
                        onClick={() => setWorkflowCommentAttachments(prev => prev.filter((_, i) => i !== attIdx))}
                        className="text-rose-500 hover:text-rose-700 ml-1"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={workflowCommentText}
                  onChange={(e) => setWorkflowCommentText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handlePostWorkflowComment()}
                  placeholder="Nhập nội dung trao đổi, phản hồi kết quả..."
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                />

                <label className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-slate-500 hover:text-indigo-600" title="Đính kèm tệp / ảnh vào trao đổi">
                  <Paperclip className="w-4 h-4" />
                  <input
                    type="file"
                    multiple
                    disabled={isUploading}
                    onChange={(e) => handleFileUpload(e.target.files, "comment")}
                    className="hidden"
                  />
                </label>

                <button
                  type="button"
                  onClick={handlePostWorkflowComment}
                  className="px-4 py-2 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1 shadow-xs shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Gửi</span>
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* ==================== MODAL 3B: GHI NHẬN KẾT QUẢ & ĐÍNH KÈM HỒ SƠ ==================== */}
      {selectedWorkflowForRecord && (
        <Modal
          isOpen={isRecordResultModalOpen}
          onClose={() => setIsRecordResultModalOpen(false)}
          title={`BÁO CÁO KẾT QUẢ & ĐÍNH KÈM HỒ SƠ: ${selectedWorkflowForRecord.workflow_code}`}
          size="lg"
        >
          <form onSubmit={handleSaveRecordResult} className="space-y-4 p-2 text-xs">
            {/* Header info */}
            <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                <span>Mã phiếu: <strong className="font-mono text-indigo-600 dark:text-indigo-400">{selectedWorkflowForRecord.workflow_code}</strong></span>
                <span>Từ: <strong>{selectedWorkflowForRecord.requester_dept}</strong> ──► Sang: <strong>{selectedWorkflowForRecord.target_dept}</strong></span>
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                {selectedWorkflowForRecord.title}
              </h3>
              <div className="text-slate-500 text-[11px] mt-1 flex flex-wrap gap-3">
                <span>Khách hàng: <strong>{selectedWorkflowForRecord.customer_name || "Nội bộ TBRs"}</strong></span>
                {selectedWorkflowForRecord.product_info && <span>Thiết bị / SP: <strong>{selectedWorkflowForRecord.product_info}</strong></span>}
                <span>Người yêu cầu: <strong>{selectedWorkflowForRecord.requester_name}</strong></span>
              </div>
            </div>

            {/* Form controls */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Trạng thái phiếu sau báo cáo *
                </label>
                <select
                  value={recordResultForm.status}
                  onChange={(e) => setRecordResultForm({ ...recordResultForm, status: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-bold"
                >
                  <option value="IN_PROGRESS">🟡 Đang Triển Khai (IN_PROGRESS) - Báo cáo tiến độ từng phần</option>
                  <option value="REVIEW">🟣 Đã Có Kết Quả (REVIEW) - Chuyển sang chờ nghiệm thu</option>
                  <option value="COMPLETED">🟢 Nghiệm Thu Hoàn Tất (COMPLETED) - Đóng quy trình</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Người lập báo cáo / Người ghi nhận *
                </label>
                <input
                  type="text"
                  required
                  value={recordResultForm.reporter_name}
                  onChange={(e) => setRecordResultForm({ ...recordResultForm, reporter_name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-medium"
                />
              </div>
            </div>

            {/* Quick Template Fill Buttons */}
            <div>
              <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
                <label className="block font-bold text-slate-700 dark:text-slate-300">
                  Nội dung kết quả thực hiện / Báo cáo nghiệm thu *
                </label>
                <div className="flex items-center gap-1 text-[11px]">
                  <span className="text-slate-400 text-[10px]">Mẫu gợi ý:</span>
                  <button
                    type="button"
                    onClick={() => setRecordResultForm(prev => ({
                      ...prev,
                      results_summary: "Đã hoàn tất demo thiết bị Real-time PCR và kiểm tra tương thích sinh phẩm. Mẫu đối chứng âm/dương cho kết quả Ct chuẩn đạt yêu cầu của bác sĩ trưởng khoa."
                    }))}
                    className="px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 hover:bg-purple-100 text-[10px] font-semibold"
                  >
                    Demo Lab
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecordResultForm(prev => ({
                      ...prev,
                      results_summary: "Đã soạn đủ số lượng kit theo phiếu xuất, kiểm tra Lot và hạn dùng >12 tháng, đóng gói thùng xốp đá gel chuẩn nhiệt độ 2-8°C, sẵn sàng bàn giao cho đơn vị vận chuyển."
                    }))}
                    className="px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 hover:bg-amber-100 text-[10px] font-semibold"
                  >
                    Kho Xuất Hàng
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecordResultForm(prev => ({
                      ...prev,
                      results_summary: "Đã liên hệ nhà phân phối chính hãng Thermo Fisher, đàm phán thành công mức chiết khấu 15%, thời gian giao hàng dự kiến 5 ngày làm việc."
                    }))}
                    className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 hover:bg-blue-100 text-[10px] font-semibold"
                  >
                    Mua Hàng NCC
                  </button>
                </div>
              </div>
              <textarea
                rows={4}
                required
                value={recordResultForm.results_summary}
                onChange={(e) => setRecordResultForm({ ...recordResultForm, results_summary: e.target.value })}
                placeholder="Nhập chi tiết kết quả thực hiện, số liệu kiểm tra, biên bản nghiệm thu hoặc các thỏa thuận đạt được..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-medium"
              />
            </div>

            {/* ATTACHMENT UPLOAD SECTION */}
            <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <label className="block font-bold text-slate-700 dark:text-slate-300">
                  📎 Đính Kèm Hình Ảnh &amp; Tài Liệu Chứng Minh ({recordResultForm.attachments?.length || 0})
                </label>
                <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-xs transition-colors">
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>{isUploading ? "Đang tải lên..." : "+ Tải Lên Tệp / Hình Ảnh"}</span>
                  <input
                    type="file"
                    multiple
                    disabled={isUploading}
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.xml,.csv"
                    onChange={(e) => handleFileUpload(e.target.files, "record")}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Upload Dropzone Hint */}
              <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-800 text-center">
                <div className="flex items-center justify-center gap-2 text-slate-400 text-xs">
                  <Paperclip className="w-4 h-4" />
                  <span>Hỗ trợ tải lên ảnh hiện trường (PNG, JPG), biên bản nghiệm thu (PDF), file báo giá (Excel, Word). Lưu trữ trực tiếp trên máy chủ.</span>
                </div>
              </div>

              {/* Uploaded Files List */}
              {recordResultForm.attachments && recordResultForm.attachments.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1">
                  {recordResultForm.attachments.map((att, idx) => {
                    const isImg = att.type?.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(att.name);
                    return (
                      <div
                        key={idx}
                        className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shadow-2xs"
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
                          {isImg ? (
                            <button
                              type="button"
                              onClick={() => setPreviewImage(att.url)}
                              className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden shrink-0 border border-slate-200 dark:border-slate-700 relative group cursor-pointer"
                              title="Bấm để xem phóng to ảnh"
                            >
                              <img src={att.url} alt={att.name} className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <Eye className="w-3.5 h-3.5 text-white" />
                              </div>
                            </button>
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-200 dark:border-indigo-800">
                              <FileText className="w-5 h-5" />
                            </div>
                          )}
                          <div className="overflow-hidden text-left">
                            <p className="font-semibold text-slate-800 dark:text-slate-200 truncate text-xs" title={att.name}>
                              {att.name}
                            </p>
                            <span className="text-[10px] text-slate-400">
                              {att.size ? `${(att.size / 1024).toFixed(0)} KB` : "Tệp tin"}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <a
                            href={att.url}
                            target="_blank"
                            rel="noreferrer"
                            download
                            className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                            title="Xem / Tải về"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>
                          <button
                            type="button"
                            onClick={() => {
                              setRecordResultForm(prev => ({
                                ...prev,
                                attachments: prev.attachments.filter((_, i) => i !== idx)
                              }));
                            }}
                            className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50"
                            title="Xóa tệp này"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsRecordResultModalOpen(false)}
                className="px-4 py-2 rounded-xl font-bold border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Đóng
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl font-bold bg-purple-600 hover:bg-purple-700 text-white shadow-md shadow-purple-600/30 flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Lưu Kết Quả &amp; Đính Kèm Hồ Sơ</span>
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ==================== UNIVERSAL DOCUMENT & IMAGE PREVIEW LIGHTBOX ==================== */}
      {(previewDoc || previewImage) && (() => {
        const activeUrl = previewDoc?.url || previewImage!;
        const activeName = previewDoc?.name || "Tài liệu đính kèm";
        const isPdf =
          previewDoc?.type?.includes("pdf") ||
          activeName.toLowerCase().endsWith(".pdf") ||
          activeUrl.toLowerCase().includes(".pdf");
        const isImg =
          previewDoc?.type?.startsWith("image/") ||
          /\.(png|jpe?g|webp|gif)$/i.test(activeName) ||
          (!previewDoc && previewImage);

        const handleClose = () => {
          setPreviewDoc(null);
          setPreviewImage(null);
        };

        return (
          <div
            className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in"
            onClick={handleClose}
          >
            <div
              className="relative w-full max-w-5xl max-h-[92vh] bg-slate-900 rounded-2xl overflow-hidden border border-slate-700 shadow-2xl flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header Toolbar */}
              <div className="flex items-center justify-between p-3.5 text-white border-b border-slate-800 bg-slate-900/90 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0 pr-3">
                  <div className="w-7 h-7 rounded-lg bg-indigo-600/30 text-indigo-400 flex items-center justify-center font-bold text-xs shrink-0">
                    {isPdf ? "PDF" : isImg ? "IMG" : "DOC"}
                  </div>
                  <div className="min-w-0">
                    <span className="text-xs font-bold truncate block">{activeName}</span>
                    <span className="text-[10px] text-slate-400">
                      {isPdf
                        ? "Đang đọc trực tiếp qua Web PDF Engine (Không cần tải về)"
                        : isImg
                        ? "Xem ảnh chi tiết"
                        : "Hồ sơ đính kèm số hóa"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs flex items-center gap-1 font-semibold cursor-pointer"
                    title="In tài liệu"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">In</span>
                  </button>

                  <a
                    href={activeUrl}
                    download={activeName}
                    className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs flex items-center gap-1 font-semibold cursor-pointer shadow-xs"
                    title="Tải tệp về máy"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Tải về</span>
                  </a>

                  <button
                    type="button"
                    onClick={handleClose}
                    className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer ml-1"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Viewer Body */}
              <div className="flex-1 p-2 sm:p-4 overflow-auto flex items-center justify-center bg-slate-950/60 min-h-[55vh]">
                {isPdf ? (
                  <iframe
                    src={activeUrl}
                    className="w-full h-[76vh] rounded-xl border border-slate-700 bg-white shadow-xl"
                    title={activeName}
                  />
                ) : isImg ? (
                  <img
                    src={activeUrl}
                    alt={activeName}
                    className="max-w-full max-h-[78vh] object-contain rounded-xl shadow-xl"
                  />
                ) : (
                  <div className="text-center p-8 space-y-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-700 max-w-md">
                    <FileText className="w-12 h-12 text-indigo-400 mx-auto" />
                    <div className="font-bold text-white text-sm">{activeName}</div>
                    <p className="text-xs text-slate-400">
                      Tệp tin đã được số hóa và lưu trữ an toàn trên máy chủ TBRs Portal.
                    </p>
                    <a
                      href={activeUrl}
                      download={activeName}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold"
                    >
                      <Download className="w-4 h-4" /> Tải Xuống Tệp
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ==================== MODAL 4: THÊM LỊCH CÔNG TÁC TUẦN ==================== */}
      <Modal
        isOpen={isScheduleModalOpen}
        onClose={() => setIsScheduleModalOpen(false)}
        title={editingScheduleId ? "SỬA LỊCH CÔNG TÁC" : "THÊM LỊCH CÔNG TÁC & ĐIỀU PHỐI TUẦN"}
        size="md"
      >
        <form onSubmit={handleSaveSchedule} className="space-y-3 p-1 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Ngày thực hiện *</label>
              <input
                type="date"
                required
                value={scheduleForm.date || ""}
                onChange={(e) => setScheduleForm({ ...scheduleForm, date: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-bold"
              />
              <div className="flex flex-wrap gap-1 mt-1">
                {viewedWeek.days.map((wd) => (
                  <button
                    key={wd.date}
                    type="button"
                    onClick={() => setScheduleForm({ ...scheduleForm, date: wd.date })}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold cursor-pointer ${scheduleForm.date === wd.date ? "bg-indigo-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"}`}
                  >
                    {wd.name.replace("Thứ ", "T")} {wd.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Khung giờ thực hiện *</label>
              <input
                type="text"
                required
                value={scheduleForm.time}
                onChange={(e) => setScheduleForm({ ...scheduleForm, time: e.target.value })}
                placeholder="VD: 08:30, 14:00 - 16:30"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-medium"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Phân loại bộ phận / Mục đích *</label>
            <select
              value={scheduleForm.category}
              onChange={(e) => setScheduleForm({ ...scheduleForm, category: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-bold"
            >
              <option value="Application">🔬 Application: Demo máy / Thử mẫu ngoại viện / Trực Lab</option>
              <option value="Kinh Doanh">💼 Kinh Doanh: Họp giao ban / Đàm phán KH / Chăm sóc bệnh viện</option>
              <option value="Kho & Vận Hành">📦 Kho &amp; Vận Hành: Soạn xuất hàng lớn / Nhập kho container / Kiểm kê</option>
              <option value="Cung Ứng">🛒 Cung Ứng: Làm việc NCC / Thủ tục hải quan</option>
            </select>
          </div>

          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Tiêu đề &amp; Nội dung công tác *</label>
            <input
              type="text"
              required
              value={scheduleForm.title}
              onChange={(e) => setScheduleForm({ ...scheduleForm, title: e.target.value })}
              placeholder="VD: Demo máy Real-time PCR tại BV Chợ Rẫy, Giao 20 kit cho Pasteur..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-medium"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Nhân viên phụ trách / Đi công tác
                {rolePerspective === "staff" && <span className="text-emerald-600 dark:text-emerald-400 text-[10px] ml-1 font-semibold">(Cá nhân)</span>}
              </label>
              {rolePerspective === "staff" ? (
                <input
                  type="text"
                  disabled
                  value={currentStaffName}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-500 font-bold cursor-not-allowed"
                />
              ) : (
                <select
                  value={scheduleForm.actor}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, actor: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-bold"
                >
                  <option value="">-- Chọn nhân sự thực hiện --</option>
                  {(departmentStaffList && departmentStaffList.length > 0 ? departmentStaffList : personnelList).map((p: any) => {
                    const name = p.full_name || p;
                    const code = p.employee_code ? ` (${p.employee_code})` : "";
                    const dept = p.department ? ` - ${p.department}` : "";
                    return (
                      <option key={p.id || p.employee_code || name} value={name}>
                        {name}{code}{dept}
                      </option>
                    );
                  })}
                </select>
              )}
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Địa điểm / Bệnh viện</label>
              <input
                type="text"
                value={scheduleForm.location}
                onChange={(e) => setScheduleForm({ ...scheduleForm, location: e.target.value })}
                placeholder="VD: BV Chợ Rẫy, Kho TBRs..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-medium"
              />
            </div>
          </div>

          {/* Đính kèm tài liệu kế hoạch */}
          <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5 text-indigo-600" />
                <span>Đính kèm tài liệu kế hoạch (PDF, Word, Ảnh)</span>
              </label>
              <label className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer">
                <span>+ Đính kèm file</span>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                  onChange={(e) => handleFileUpload(e.target.files, "schedule")}
                  className="hidden"
                />
              </label>
            </div>

            {scheduleForm.attachments && scheduleForm.attachments.length > 0 && (
              <div className="grid grid-cols-1 gap-2 max-h-32 overflow-y-auto">
                {scheduleForm.attachments.map((att: any, idx: number) => {
                  const isImg = att.type?.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(att.name);
                  return (
                    <div
                      key={idx}
                      className="bg-slate-50 dark:bg-slate-950 p-2 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setPreviewDoc({ url: att.url, name: att.name, type: att.type })}
                          className="w-7 h-7 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold text-[9px] flex items-center justify-center shrink-0 cursor-pointer"
                        >
                          {isImg ? "IMG" : "DOC"}
                        </button>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-800 dark:text-slate-200 truncate text-[11px]">
                            {att.name}
                          </p>
                          <span className="text-[9px] text-slate-400">
                            {att.size ? `${(att.size / 1024).toFixed(0)} KB` : "Tệp tin"}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setPreviewDoc({ url: att.url, name: att.name, type: att.type })}
                          className="p-1 rounded text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer"
                          title="Xem trực tiếp trong ứng dụng"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setScheduleForm((prev: any) => ({
                              ...prev,
                              attachments: prev.attachments.filter((_: any, i: number) => i !== idx)
                            }))
                          }
                          className="p-1 rounded text-rose-500 hover:text-rose-700 cursor-pointer"
                          title="Xóa tệp"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsScheduleModalOpen(false)}
              className="px-4 py-2 rounded-xl font-bold border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/30"
            >
              Lưu Vào Lịch Tuần
            </button>
          </div>
        </form>
      </Modal>

      {/* ==================== MODAL 5: TẠO / SỬA KẾ HOẠCH CHUYÊN ĐỀ PHÒNG BAN ==================== */}
      <Modal
        isOpen={isLabProjectModalOpen}
        onClose={() => setIsLabProjectModalOpen(false)}
        title={editingThematicId ? "CHỈNH SỬA KẾ HOẠCH CHUYÊN ĐỀ" : "TẠO KẾ HOẠCH CHUYÊN ĐỀ PHÒNG BAN"}
        size="lg"
      >
        <form onSubmit={handleSaveLabProject} className="space-y-4 p-1 text-xs">
          {/* Top Bar: Department & ID & Status */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Phòng ban áp dụng *</label>
              {rolePerspective === "manager" ? (
                <div className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-bold text-slate-800 dark:text-slate-200">
                  {managerDept}
                </div>
              ) : (
                <select
                  value={labProjectForm.dept}
                  onChange={(e) => handleThematicDeptChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold cursor-pointer"
                >
                  <option value="Application">🔬 Application (Kỹ thuật &amp; Lab)</option>
                  <option value="Kinh Doanh">💼 Kinh Doanh (Sales)</option>
                  <option value="Kho & Vận Hành">📦 Kho &amp; Vận Hành</option>
                  <option value="Cung Ứng">🛒 Cung Ứng (Procurement)</option>
                  <option value="Pháp Chế">⚖️ Pháp Chế (Legal)</option>
                </select>
              )}
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Mã chuyên đề *</label>
              <input
                type="text"
                required
                value={labProjectForm.id}
                onChange={(e) => setLabProjectForm({ ...labProjectForm, id: e.target.value })}
                placeholder="APP-VAL-01"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono font-bold"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Trạng thái triển khai</label>
              <select
                value={labProjectForm.status}
                onChange={(e) => setLabProjectForm({ ...labProjectForm, status: e.target.value as any })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold cursor-pointer"
              >
                <option value="Planning">Lập đề cương (Planning)</option>
                <option value="Active">Đang thực hiện (Active)</option>
                <option value="Review">Đang nghiệm thu (Review)</option>
                <option value="Completed">Hoàn tất (Completed)</option>
              </select>
            </div>
          </div>

          {/* Section 1: Choose Thematic Type */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                <span>1. Chọn loại chuyên đề cơ bản của phòng {labProjectForm.dept}:</span>
              </label>
              <span className="text-[11px] text-slate-400 italic">
                (Hệ thống tự động nạp khung tiến trình chuẩn)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(DEPARTMENT_THEMATIC_TYPES[labProjectForm.dept] || DEPARTMENT_THEMATIC_TYPES["Application"] || []).map((typeDef) => {
                const isSelected = labProjectForm.typeId === typeDef.id;
                return (
                  <div
                    key={typeDef.id}
                    onClick={() => handleThematicTypeChange(typeDef)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all flex items-start gap-2.5 ${
                      isSelected
                        ? "bg-purple-50/90 dark:bg-purple-950/70 border-purple-500 dark:border-purple-500 shadow-xs ring-2 ring-purple-500/20"
                        : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-purple-300 dark:hover:border-purple-700 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    }`}
                  >
                    <span className="text-xl shrink-0 mt-0.5">{typeDef.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h5 className="font-bold text-xs text-slate-900 dark:text-white leading-tight">
                          {typeDef.name}
                        </h5>
                        {isSelected && <Check className="w-3.5 h-3.5 text-purple-600 shrink-0" />}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug line-clamp-2">
                        {typeDef.description}
                      </p>
                      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-purple-600 dark:text-purple-400 font-semibold font-mono">
                        <span>Tiến trình: {typeDef.defaultStages.length} giai đoạn chuẩn</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 2: Core Details */}
          <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <h5 className="font-bold text-slate-800 dark:text-slate-200 text-xs">
              2. Nội dung chi tiết &amp; Nhân sự thực hiện:
            </h5>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Tên đề tài / Kế hoạch chuyên đề *
              </label>
              <input
                type="text"
                required
                value={labProjectForm.name}
                onChange={(e) => setLabProjectForm({ ...labProjectForm, name: e.target.value })}
                placeholder={`VD: ${labProjectForm.typeName} quý 3/2026...`}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Chủ nhiệm / Người phụ trách chính *
                </label>
                <SearchablePersonnelSelect
                  value={labProjectForm.lead}
                  onChange={(val) => setLabProjectForm({ ...labProjectForm, lead: val })}
                  personnelList={personnelList}
                  filterDepartment={labProjectForm.dept}
                  placeholder={`Chọn nhân sự ${labProjectForm.dept}...`}
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Mức độ ưu tiên
                </label>
                <select
                  value={labProjectForm.priority}
                  onChange={(e) => setLabProjectForm({ ...labProjectForm, priority: e.target.value as any })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium cursor-pointer"
                >
                  <option value="Cao">🔥 Ưu tiên cao (Trọng điểm)</option>
                  <option value="Trung bình">⚡ Ưu tiên trung bình</option>
                  <option value="Bình thường">Tiêu chuẩn (Bình thường)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Ngày bắt đầu</label>
                <input
                  type="date"
                  value={labProjectForm.startDate}
                  onChange={(e) => setLabProjectForm({ ...labProjectForm, startDate: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Hạn hoàn thành (Deadline)</label>
                <input
                  type="date"
                  value={labProjectForm.endDate}
                  onChange={(e) => setLabProjectForm({ ...labProjectForm, endDate: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Ngân sách / Nguồn lực (Nếu có)</label>
                <input
                  type="text"
                  value={labProjectForm.budget}
                  onChange={(e) => setLabProjectForm({ ...labProjectForm, budget: e.target.value })}
                  placeholder="VD: 50.000.000 VNĐ, 2 máy PCR"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Mục tiêu &amp; Tiêu chí nghiệm thu (Deliverables)</label>
              <textarea
                rows={2}
                value={labProjectForm.description}
                onChange={(e) => setLabProjectForm({ ...labProjectForm, description: e.target.value })}
                placeholder="Nêu rõ mục tiêu cụ thể, số lượng mẫu thử hoặc kết quả đầu ra cần đạt được..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium"
              />
            </div>
          </div>

          {/* Section 3: Specialized Workflow Stages / Checklist */}
          <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <div>
                <h5 className="font-bold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-1.5">
                  <ListChecks className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  <span>3. Tiến trình thực hiện chuyên biệt (Các giai đoạn triển khai):</span>
                </h5>
                <p className="text-[11px] text-slate-400">
                  Tùy chỉnh các giai đoạn, gán số ngày dự kiến hoặc đánh dấu trạng thái
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  const newStage = {
                    id: `stg-${Date.now()}-${labProjectForm.stages.length}`,
                    name: `Giai đoạn mới ${labProjectForm.stages.length + 1}`,
                    status: "pending" as const,
                    estimatedDays: 3
                  };
                  setLabProjectForm({
                    ...labProjectForm,
                    stages: [...labProjectForm.stages, newStage]
                  });
                }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 hover:bg-purple-100 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Thêm giai đoạn</span>
              </button>
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {labProjectForm.stages.map((stg, sIdx) => (
                <div
                  key={stg.id || sIdx}
                  className="flex items-center gap-2 p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs"
                >
                  <span className="font-mono font-bold text-purple-600 dark:text-purple-400 px-2 py-1 rounded bg-purple-100 dark:bg-purple-950 text-[10px] shrink-0">
                    B{sIdx + 1}
                  </span>

                  <input
                    type="text"
                    value={stg.name}
                    onChange={(e) => {
                      const updated = [...labProjectForm.stages];
                      updated[sIdx].name = e.target.value;
                      setLabProjectForm({ ...labProjectForm, stages: updated });
                    }}
                    placeholder={`Nội dung bước ${sIdx + 1}...`}
                    className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium text-xs"
                  />

                  <div className="flex items-center gap-1.5 shrink-0">
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={stg.estimatedDays || 2}
                      onChange={(e) => {
                        const updated = [...labProjectForm.stages];
                        updated[sIdx].estimatedDays = parseInt(e.target.value) || 1;
                        setLabProjectForm({ ...labProjectForm, stages: updated });
                      }}
                      title="Số ngày dự kiến"
                      className="w-14 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-center font-mono text-xs"
                    />
                    <span className="text-[10px] text-slate-400">ngày</span>

                    <select
                      value={stg.status}
                      onChange={(e) => {
                        const updated = [...labProjectForm.stages];
                        updated[sIdx].status = e.target.value as any;
                        setLabProjectForm({ ...labProjectForm, stages: updated });
                      }}
                      className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold text-xs cursor-pointer"
                    >
                      <option value="pending">Chờ</option>
                      <option value="in_progress">Đang làm</option>
                      <option value="completed">Đã xong</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => {
                        const updated = labProjectForm.stages.filter((_, i) => i !== sIdx);
                        setLabProjectForm({ ...labProjectForm, stages: updated });
                      }}
                      className="p-1 text-slate-400 hover:text-rose-500 rounded cursor-pointer"
                      title="Xóa giai đoạn này"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsLabProjectModalOpen(false)}
              className="px-4 py-2 rounded-xl font-bold border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl font-bold bg-purple-600 hover:bg-purple-700 text-white shadow-md shadow-purple-600/30 flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>{editingThematicId ? "Lưu Thay Đổi Chuyên Đề" : "Tạo Kế Hoạch Chuyên Đề"}</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* ==================== MODAL 6: ĐẶT MỤC TIÊU DOANH SỐ KINH DOANH ==================== */}
      <Modal
        isOpen={isSalesTargetModalOpen}
        onClose={() => setIsSalesTargetModalOpen(false)}
        title="THIẾT LẬP MỤC TIÊU DOANH SỐ &amp; DỰ ÁN TRỌNG ĐIỂM"
        size="md"
      >
        <form onSubmit={handleSaveSalesTarget} className="space-y-3 p-1 text-xs">
          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Khách hàng / Bệnh viện / Viện mục tiêu *</label>
            <input
              type="text"
              required
              value={salesTargetForm.customer}
              onChange={(e) => setSalesTargetForm({ ...salesTargetForm, customer: e.target.value })}
              placeholder="VD: Bệnh viện Bạch Mai, Bệnh viện Nhi Đồng 1..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-bold"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Mục tiêu doanh số (VNĐ) *</label>
              <input
                type="text"
                required
                value={salesTargetForm.amount}
                onChange={(e) => setSalesTargetForm({ ...salesTargetForm, amount: e.target.value })}
                placeholder="VD: 2.5 Tỷ VNĐ hoặc 2.5"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-extrabold text-orange-600"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Quý / Giai đoạn mục tiêu</label>
              <select
                value={salesTargetForm.quarter}
                onChange={(e) => setSalesTargetForm({ ...salesTargetForm, quarter: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-semibold"
              >
                <option value="Q4/2026">Quý 4 / 2026</option>
                <option value="Q1/2027">Quý 1 / 2027</option>
                <option value="Năm 2026">Cả năm 2026</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Nhân viên kinh doanh phụ trách</label>
              <SearchablePersonnelSelect
                value={salesTargetForm.lead}
                onChange={(val) => setSalesTargetForm({ ...salesTargetForm, lead: val })}
                personnelList={personnelList}
                filterDepartment="Kinh Doanh"
                placeholder="Chọn nhân viên kinh doanh..."
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Giai đoạn tiếp cận / Đấu thầu</label>
              <select
                value={salesTargetForm.stage}
                onChange={(e) => setSalesTargetForm({ ...salesTargetForm, stage: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-medium"
              >
                <option value="Đang tiếp cận & Chào giá">Đang tiếp cận &amp; Chào giá</option>
                <option value="Đang chào giá & Demo">Đang chào giá &amp; Demo Lab</option>
                <option value="Đang đàm phán hợp đồng">Đang đàm phán hợp đồng</option>
                <option value="Tham gia đấu thầu">Tham gia đấu thầu viện</option>
                <option value="Đã trúng thầu / Ký HĐ">Đã trúng thầu / Ký hợp đồng</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Nội dung gói thầu / Sản phẩm trọng điểm</label>
            <textarea
              rows={3}
              value={salesTargetForm.description}
              onChange={(e) => setSalesTargetForm({ ...salesTargetForm, description: e.target.value })}
              placeholder="VD: Gói thầu mua sắm hệ thống sinh phẩm Real-time PCR và hóa chất tách chiết tự động..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-medium"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsSalesTargetModalOpen(false)}
              className="px-4 py-2 rounded-xl font-bold border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl font-bold bg-orange-600 hover:bg-orange-700 text-white shadow-md shadow-orange-600/30"
            >
              Lưu Mục Tiêu Doanh Số
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

// Sub-component: Task Card in Kanban
const TaskCard: React.FC<{
  task: any;
  onStatusChange: (id: number, status: string) => void;
  onEdit: (task: any) => void;
}> = ({ task, onStatusChange, onEdit }) => {
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 rounded-xl p-3.5 shadow-xs hover:shadow-md transition-all space-y-2">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-mono font-bold text-slate-400">{task.task_code}</span>
        <PriorityBadge priority={task.priority} />
      </div>

      <h4
        onClick={() => onEdit(task)}
        className="text-xs font-bold text-slate-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer leading-snug line-clamp-2"
      >
        {task.title}
      </h4>

      {task.related_workflow_code && (
        <span className="inline-flex items-center gap-1 text-[9px] font-bold text-purple-600 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/60 px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-800">
          🔗 Liên phòng: {task.related_workflow_code}
        </span>
      )}

      {task.result && (
        <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/50 rounded-lg p-2 text-[11px] text-emerald-800 dark:text-emerald-300 line-clamp-2">
          <strong className="text-emerald-700 dark:text-emerald-400">Kết quả:</strong> {task.result}
        </div>
      )}

      {task.attachments && task.attachments.length > 0 && (
        <div className="flex items-center gap-1 text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold">
          <Paperclip className="w-3 h-3" />
          <span>{task.attachments.length} tài liệu / ảnh đính kèm</span>
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-700/60">
        {cleanWorkspaceAssignee(task.assignee_name) ? (
          <span className="font-semibold text-slate-700 dark:text-slate-300 truncate max-w-[140px]">
            👤 {cleanWorkspaceAssignee(task.assignee_name)}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onEdit(task)}
            className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 font-bold text-[10px] hover:bg-amber-200 dark:hover:bg-amber-900/70 transition-colors cursor-pointer"
            title="Nhấn để phân công nhân sự phụ trách"
          >
            ⏳ Chờ phân công
          </button>
        )}
        <span className="text-[10px] font-mono">{task.deadline ? task.deadline.slice(5, 10) : ""}</span>
      </div>

      <div className="flex items-center justify-end gap-1 pt-1">
        {task.status === "TODO" && (
          <button
            onClick={() => onStatusChange(task.id, "IN_PROGRESS")}
            className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 hover:bg-blue-100"
          >
            Bắt đầu ►
          </button>
        )}
        {task.status === "IN_PROGRESS" && (
          <button
            onClick={() => onStatusChange(task.id, "DONE")}
            className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 hover:bg-emerald-100"
          >
            Hoàn tất ✓
          </button>
        )}
        {task.status === "DONE" && (
          <button
            onClick={() => onStatusChange(task.id, "TODO")}
            className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300 hover:bg-slate-200"
          >
            Mở lại
          </button>
        )}
      </div>
    </div>
  );
};

// Sub-component: Priority Badge
const PriorityBadge: React.FC<{ priority: string }> = ({ priority }) => {
  const p = (priority || "MEDIUM").toUpperCase();
  if (p === "URGENT") {
    return (
      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
        Khẩn cấp
      </span>
    );
  }
  if (p === "HIGH") {
    return (
      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300 border border-orange-300 dark:border-orange-800">
        Cao
      </span>
    );
  }
  if (p === "LOW") {
    return (
      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400">
        Thấp
      </span>
    );
  }
  return (
    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
      Trung bình
    </span>
  );
};

// Sub-component: Workflow Status Badge
const WorkflowStatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const s = (status || "PENDING").toUpperCase();
  if (s === "PENDING") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
        Chờ tiếp nhận
      </span>
    );
  }
  if (s === "ACCEPTED") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
        Đã tiếp nhận
      </span>
    );
  }
  if (s === "IN_PROGRESS") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-300 dark:border-purple-800 animate-pulse">
        Đang xử lý
      </span>
    );
  }
  if (s === "REVIEW") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300 border border-cyan-300 dark:border-cyan-800">
        Đã có kết quả / Báo cáo
      </span>
    );
  }
  if (s === "COMPLETED") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
        Nghiệm thu hoàn tất
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
      {status}
    </span>
  );
};

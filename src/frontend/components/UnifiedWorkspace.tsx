"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Bell,
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
import { todayVN, toVNDateString, nowVNDateTime, formatVNDate, formatVNDateTime } from "@/backend/services/dates";
import { AttachmentPicker, AttachmentList, uploadSingleFileSmart } from "@/frontend/components/AttachmentPicker";
import { DateInputVN, formatDayVN } from "@/frontend/components/DateInputVN";
import { ProposalsApprovalView, ProposalItem, isProposalWaitingForUser } from "@/frontend/components/ProposalsApprovalView";
import { Pager, usePaged } from "@/frontend/components/Pager";

// Configuration for Departments
export const DEPARTMENTS = [
  { id: "all", name: "Toàn công ty", icon: Building2 },
  { id: "Kinh Doanh", name: "Kinh Doanh", icon: Briefcase },
  { id: "Application", name: "Application (Lab)", icon: FlaskConical },
  { id: "Kho & Vận Hành", name: "Kho & Vận Hành", icon: Package },
  { id: "Cung Ứng", name: "Cung Ứng", icon: ShoppingCart },
  { id: "Pháp Chế", name: "Pháp Chế & Tuân Thủ", icon: ShieldCheck },
  { id: "Kế Toán", name: "Kế Toán - Tài Chính", icon: DollarSign },
  { id: "Ban Giám Đốc", name: "Ban Giám Đốc", icon: Award },
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

/**
 * Tên nhân sự để so sánh: cùng một tên có thể được lưu ở dạng Unicode tổ hợp / dựng sẵn khác nhau, hoặc đặt dấu
 * kiểu cũ / mới ("Thùy" - "Thuỳ", "Hòa" - "Hoà"), có khoảng trắng thừa. Tên ở Tài khoản và ở Nhân sự lệch nhau
 * như vậy làm nhân viên không thấy việc được giao cho mình.
 */
export function canonStaffName(name: any): string {
  let s = String(name || "").normalize("NFC").toLowerCase().replace(/[\s\u00a0\u200b]+/g, " ").trim();
  // đặt dấu kiểu mới (dấu trên chữ thứ hai của oa, oe, uy) -> kiểu cũ, để hai cách gõ trùng nhau
  s = s.normalize("NFD").replace(/([ou])([\u0300\u0301\u0309\u0303\u0323])([aey])/g, "$1$3$2").normalize("NFC");
  return s;
}

/** Hai tên là cùng một người (so sánh sau chuẩn hóa; tên đầy đủ chứa tên ngắn vẫn tính là trùng). */
export function sameStaffName(a: any, b: any): boolean {
  const x = canonStaffName(a);
  const y = canonStaffName(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

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
  if (l.includes("kho") || l.includes("vận hành") || l.includes("warehouse") || l.includes("giao nhận")) return "Kho & Vận Hành";
  if (l.includes("cung ứng") || l.includes("mua hàng") || l.includes("procurement")) return "Cung Ứng";
  if (l.includes("kinh doanh") || l.includes("sales") || l.includes("marketing")) return "Kinh Doanh";
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
    "Bảo hộ Sở hữu trí tuệ thương hiệu TBR",
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
  dept?: string;
}

export interface ThematicTypeDefinition {
  id: string;
  name: string;
  icon: string;
  codePrefix: string;
  description: string;
  sampleObjectives: string;
  participatingDepts?: string[];
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
        { name: "Điều xe lạnh chuyên dụng vận chuyển hàng về kho TBR an toàn", estimatedDays: 1 }
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
  ],
  "Liên Phòng Ban": [
    {
      id: "cross_hospital_tender",
      name: "Dự Án Đấu Thầu & Cung Ứng Trọn Gói Bệnh Viện",
      icon: "🏛️",
      codePrefix: "DA-THAU",
      description: "Phối hợp liên phòng ban từ rà soát HSMT, chuẩn bị pháp lý, đặt hàng hãng, chạy thử mẫu đến giao hàng & nghiệm thu thầu.",
      sampleObjectives: "Trúng thầu và triển khai cung ứng trọn gói hóa chất - sinh phẩm - thiết bị xét nghiệm cho Bệnh viện trọng điểm đúng tiến độ hợp đồng.",
      participatingDepts: ["Kinh Doanh", "Pháp Chế", "Cung Ứng", "Application", "Kho & Vận Hành", "Kế Toán"],
      defaultStages: [
        { name: "Phân tích danh mục HSMT, xây dựng cấu hình kỹ thuật & phương án giá dự thầu", estimatedDays: 3, dept: "Kinh Doanh" },
        { name: "Thẩm định pháp lý hồ sơ thầu, giấy phép lưu hành, ủy quyền hãng (MA/CFS/ISO) & Bảo lãnh", estimatedDays: 4, dept: "Pháp Chế" },
        { name: "Đàm phán giá dự án với Hãng/NCC, chốt tiến độ nhập hàng & CO/CQ", estimatedDays: 4, dept: "Cung Ứng" },
        { name: "Demo thiết bị / chạy thử mẫu lâm sàng & bảo vệ giải pháp kỹ thuật tại khoa Xét nghiệm", estimatedDays: 5, dept: "Application" },
        { name: "Giao nhận theo hợp đồng thầu, bàn giao nghiệm thu & đối soát hồ sơ thanh quyết toán", estimatedDays: 5, dept: "Kho & Vận Hành" }
      ]
    },
    {
      id: "cross_equipment_deploy",
      name: "Dự Án Lắp Đặt & Chuyển Giao Hệ Thống Thiết Bị Xét Nghiệm",
      icon: "🏥",
      codePrefix: "DA-TB",
      description: "Điều phối nhập máy, khảo sát phòng Lab khách hàng, vận chuyển lắp đặt, hiệu chuẩn, đào tạo KTV và bàn giao nghiệm thu.",
      sampleObjectives: "Hoàn tất lắp đặt, hiệu chuẩn đạt chuẩn QC và đào tạo vận hành thành thạo hệ thống máy xét nghiệm tại đơn vị khách hàng.",
      participatingDepts: ["Kinh Doanh", "Cung Ứng", "Kho & Vận Hành", "Application", "Kế Toán"],
      defaultStages: [
        { name: "Chốt hợp đồng/đơn hàng thiết bị & thông báo kế hoạch triển khai với khách hàng", estimatedDays: 2, dept: "Kinh Doanh" },
        { name: "Đặt mua / thông quan máy chính, phụ kiện đi kèm & hóa chất chạy thử nghiệm (Startup Kit)", estimatedDays: 5, dept: "Cung Ứng" },
        { name: "Kiểm tra ngoại quan, đóng gói chuyên dụng & vận chuyển bàn giao máy tận phòng Lab", estimatedDays: 2, dept: "Kho & Vận Hành" },
        { name: "Lắp đặt, hiệu chuẩn thông số, chạy mẫu nội kiểm (QC) & đào tạo KTV vận hành", estimatedDays: 4, dept: "Application" },
        { name: "Ký biên bản nghiệm thu bàn giao (handed-over), kích hoạt bảo hành & xuất hóa đơn thu hồi công nợ", estimatedDays: 2, dept: "Kế Toán" }
      ]
    },
    {
      id: "cross_new_product_launch",
      name: "Dự Án Ra Mắt Dòng Sản Phẩm Mới & Phát Triển Thị Trường",
      icon: "🚀",
      codePrefix: "DA-LAUNCH",
      description: "Phối hợp thẩm định chất lượng Kit/Máy mới, hoàn thiện pháp lý lưu hành, nhập hàng mẫu và tổ chức chiến dịch thương mại hóa.",
      sampleObjectives: "Đưa dòng sản phẩm sinh phẩm/thiết bị mới ra thị trường, hoàn tất đánh giá tại 10 phòng Lab đầu ngành và phát sinh đơn hàng thương mại.",
      participatingDepts: ["Application", "Pháp Chế", "Cung Ứng", "Kinh Doanh", "Kho & Vận Hành"],
      defaultStages: [
        { name: "Chạy thẩm định thực tế độ nhạy/đặc hiệu & biên soạn tài liệu hướng dẫn tiếng Việt (SOP/IFU)", estimatedDays: 5, dept: "Application" },
        { name: "Hoàn tất hồ sơ công bố / đăng ký số lưu hành trang thiết bị y tế (IVD)", estimatedDays: 7, dept: "Pháp Chế" },
        { name: "Đặt nhập lô hàng thương mại đầu tiên & bộ mẫu dùng thử (Demo/Sample Kits)", estimatedDays: 5, dept: "Cung Ứng" },
        { name: "Tổ chức hội thảo giới thiệu, gửi mẫu dùng thử cho khách hàng mục tiêu & chốt đơn mở màn", estimatedDays: 7, dept: "Kinh Doanh" }
      ]
    },
    {
      id: "cross_customer_taskforce",
      name: "Nhóm Đặc Nhiệm Xử Lý Sự Cố Kỹ Thuật & Hỗ Trợ Khách Hàng Trọng Điểm",
      icon: "🛠️",
      codePrefix: "DA-CSKH",
      description: "Phối hợp khẩn cấp giữa Kinh doanh, Application, Kho và Cung ứng để xử lý sự cố kỹ thuật/lô hàng tại bệnh viện lớn.",
      sampleObjectives: "Xử lý dứt điểm vướng mắc kỹ thuật tại phòng Lab khách hàng trong vòng 48-72h, đảm bảo hoạt động xét nghiệm không gián đoạn.",
      participatingDepts: ["Application", "Kinh Doanh", "Kho & Vận Hành", "Cung Ứng"],
      defaultStages: [
        { name: "Tiếp nhận thông tin sự cố từ khách hàng, khoanh vùng mã lô (Lot) & điều kiện bảo quản", estimatedDays: 1, dept: "Kinh Doanh" },
        { name: "Trực tiếp xuống Lab khách hàng kiểm tra thiết bị, chạy mẫu đối chứng & xác định nguyên nhân gốc", estimatedDays: 2, dept: "Application" },
        { name: "Xuất kho khẩn cấp hàng/máy thay thế tạm thời để duy trì hoạt động xét nghiệm cho khách", estimatedDays: 1, dept: "Kho & Vận Hành" },
        { name: "Làm việc với Hãng sản xuất về báo cáo kỹ thuật (CAPA), bảo hành/đổi bù & nghiệm thu với khách hàng", estimatedDays: 3, dept: "Cung Ứng" }
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
    description: "Yêu cầu kỹ sư Application hỗ trợ chạy thử mẫu tại Lab TBR hoặc mang máy đi demo trực tiếp tại viện (Bộ phận Application sẽ tự phân công nhân sự phụ trách).",
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
      { step_index: 2, title: "Theo dõi hải quan / giao nhận & Nhập kho TBR", dept: "Kho & Vận Hành", assignee_name: "", sla_hours: 72, deliverables: "Biên bản kiểm tra CO/CQ và phiếu nhập kho (GRN)" }
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
    let list = Array.isArray(personnelList) ? [...personnelList] : [];
    if (filterDepartment && filterDepartment !== "all") {
      list = list.filter(p => isSameWorkspaceDept(p.department, filterDepartment));
      const normDept = normalizeWorkspaceDept(filterDepartment);
      if (normDept && DEPARTMENT_STAFF[normDept]) {
        DEPARTMENT_STAFF[normDept].forEach(rawName => {
          const cleanName = rawName.replace(/\s*\(.*?\)/, "").trim();
          const posMatch = rawName.match(/\((.*?)\)/);
          if (!list.some(p => sameStaffName(p.full_name, cleanName))) {
            list.push({
              full_name: cleanName,
              employee_code: "",
              position: posMatch ? posMatch[1] : `Nhân sự ${normDept}`,
              department: normDept
            });
          }
        });
      }
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
          {filterDepartment && filterDepartment !== "all" && (
            <div className="px-2.5 py-1.5 bg-indigo-50/80 dark:bg-indigo-950/60 border-b border-indigo-100 dark:border-indigo-900/60 flex items-center justify-between text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
              <span>🏢 Phòng ban: {filterDepartment}</span>
              <span>{filtered.length} nhân sự</span>
            </div>
          )}
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
                        {p.position || "Nhân sự TBR"} • {p.department || "TBR"}
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

// Danh mục mẫu đã bỏ: khách hàng / sản phẩm chỉ lấy từ CSDL
export const DEFAULT_CUSTOMERS_LIST: any[] = [];

export const DEFAULT_PRODUCTS_LIST: any[] = [];

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

// Danh sách nhà cung cấp lấy từ CSDL (trang Nhà cung cấp, đơn mua). Trước đây trộn sẵn 15 tên viết cứng
// (có cả tên pháp nhân sai như "ABT (Công ty TNHH Sinh Học Á Châu)").
export const DEFAULT_KNOWN_SUPPLIERS: Array<{ id?: string; name: string; customer_code?: string; address?: string; entityType: "supplier" }> = [];

interface SearchableCustomerSelectProps {
  value: string;
  onChange: (val: string) => void;
  customerList?: any[];
  supplierList?: any[];
  includeSuppliers?: boolean;
  prioritizeSuppliers?: boolean;
  placeholder?: string;
  disabled?: boolean;
}

const SearchableCustomerSelect: React.FC<SearchableCustomerSelectProps> = ({
  value,
  onChange,
  customerList = [],
  supplierList = [],
  includeSuppliers = true,
  prioritizeSuppliers = false,
  placeholder = "Chọn hoặc gõ tìm Bệnh viện / Phòng khám / Đối tác...",
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
    const custs: any[] = [];
    customerList.forEach(c => {
      if (c && c.name) {
        custs.push({ ...c, entityType: c.entityType || "customer" });
      }
    });
    DEFAULT_CUSTOMERS_LIST.forEach(dc => {
      if (!custs.some(c => (c.name || "").toLowerCase() === dc.name.toLowerCase() || (c.customer_code && c.customer_code === dc.customer_code))) {
        custs.push({ ...dc, entityType: "customer" });
      }
    });

    if (!includeSuppliers) return custs;

    const sups: any[] = [];
    const rawSups = [...supplierList, ...DEFAULT_KNOWN_SUPPLIERS];
    rawSups.forEach(s => {
      const sName = (s?.name || s?.supplier_name || "").trim();
      if (sName && !sups.some(x => (x.name || "").toLowerCase() === sName.toLowerCase())) {
        sups.push({
          ...s,
          name: sName,
          customer_code: s.customer_code || s.supplier_code || s.code || "NCC",
          address: s.address || s.country || "Nhà cung cấp / Đối tác",
          entityType: "supplier"
        });
      }
    });

    return prioritizeSuppliers ? [...sups, ...custs] : [...custs, ...sups];
  }, [customerList, supplierList, includeSuppliers, prioritizeSuppliers]);

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
            <span>
              {prioritizeSuppliers
                ? `Danh mục Nhà cung cấp / Đối tác / Khách hàng (${filtered.length})`
                : `Danh sách Khách hàng / Viện & Đối tác (${filtered.length})`}
            </span>
            <span className="text-[10px] text-indigo-500 font-normal">Gõ để lọc hoặc chọn</span>
          </div>
          {filtered.length === 0 ? (
            <div className="p-3 text-center text-slate-500 text-xs">
              <p className="text-[11px] text-slate-400">Nhập tên nhà cung cấp / đối tác / khách hàng mới:</p>
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    onChange(search.trim());
                    setIsOpen(false);
                  }}
                  className="mt-1.5 px-3 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-xs text-indigo-600 dark:text-indigo-400 font-bold hover:bg-indigo-100 cursor-pointer"
                >
                  + Bấm để chọn tên đối tác / NCC / khách hàng: "{search.trim()}"
                </button>
              )}
            </div>
          ) : (
            filtered.map((c: any) => {
              const isSelected = c.name === value;
              const isSup = c.entityType === "supplier";
              return (
                <div
                  key={`${c.entityType || "cust"}-${c.id || c.customer_code || c.name}`}
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
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded font-extrabold border ${
                          isSup
                            ? "bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800"
                            : "bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800"
                        }`}
                      >
                        {isSup ? "[NCC]" : "[Khách hàng]"}
                      </span>
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
                onChange(p.code && p.name ? `${p.code}: ${p.name}` : (p.name || p.code));
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
                    onChange(p.code && p.name ? `${p.code}: ${p.name}` : (p.name || p.code));
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
  const { showToast, notifyActivity, filteredNotifications, markAsRead } = useNotification();
  const { user, can, updateUser } = useAuth();
  const [serverMyPermissions, setServerMyPermissions] = useState<Record<string, boolean>>({});
  const warnNoTemplatePermission = () =>
    showToast("Bạn chưa có quyền tạo / sửa quy trình mẫu. Nhờ Quản trị viên cấp quyền \"Quản lý quy trình phối hợp mẫu\" (Cấu hình → Phân quyền) hoặc gửi nội dung quy trình để Quản trị viên tạo.", "warning");

  // Role-Based Access Control strictly according to the logged-in user:
  // - Ban Giám Đốc (admin / director): Full company-wide access (4 departments)
  // - Trưởng Phòng (head / manager): Department-wide access
  // - Nhân Viên (staff / specialist): Strictly personal view & creation
  const userRole = (user?.role || "").toLowerCase();
  const rawUserDept = (user as any)?.department || "Kinh Doanh";
  const userDept = normalizeWorkspaceDept(rawUserDept) || "Kinh Doanh";
  const currentStaffName = user?.name || (user as any)?.full_name || "Cán bộ TBR";

  const isDirector = useMemo(() => {
    return userRole === "admin" || userRole.includes("director") || userRole.includes("giám đốc") || rawUserDept.toLowerCase().includes("giám đốc");
  }, [userRole, rawUserDept]);

  const isManager = useMemo(() => {
    if (isDirector) return false;
    return userRole.includes("head") || userRole.includes("lead") || userRole.includes("manager") || userRole.includes("trưởng phòng") || userRole.includes("phó phòng");
  }, [isDirector, userRole]);

  // Tạo / sửa / xóa quy trình mẫu: Ban Giám Đốc, Trưởng/Phó phòng hoặc người được cấp quyền "Quản lý quy trình phối hợp mẫu"
  const canManageTemplates = Boolean(
    isDirector ||
    isManager ||
    (can && can("workspace.manage_templates")) ||
    serverMyPermissions["*"] ||
    serverMyPermissions["workspace.manage_templates"]
  );

  const ensureManageTemplatesPermission = async (): Promise<boolean> => {
    if (canManageTemplates) return true;
    try {
      const r = await fetch("/api/auth?action=session");
      if (r.ok) {
        const d = await r.json().catch(() => null);
        const livePerms = d?.user?.permissions;
        if (livePerms && typeof livePerms === "object") {
          setServerMyPermissions(livePerms);
          updateUser({ permissions: livePerms });
          if (livePerms["*"] || livePerms["workspace.manage_templates"]) {
            return true;
          }
        }
      }
    } catch {}
    warnNoTemplatePermission();
    return false;
  };

  const isStaff = !isDirector && !isManager;
  const rolePerspective = isDirector ? "director" : isManager ? "manager" : "staff";
  const managerDept = userDept && userDept !== "Ban Giám Đốc" ? userDept : "Application";

  const [activeSubTab, setActiveSubTab] = useState<"tasks" | "workflows" | "proposals" | "planner" | "projects" | "daily" | "announcements" | "analytics">("tasks");
  const [selectedDept, setSelectedDept] = useState<string>("all");
  const [plannerView, setPlannerView] = useState<"calendar" | "lab_projects" | "sales_targets">("calendar");
  const [loading, setLoading] = useState(true);

  // State cho Tab Đề Xuất & Phê Duyệt Đa Cấp (Enterprise e-Request & e-Approval)
  const [proposals, setProposals] = useState<ProposalItem[]>([]);
  const [proposalCreateTrigger, setProposalCreateTrigger] = useState<number>(0);
  const [proposalLeaveCreateTrigger, setProposalLeaveCreateTrigger] = useState<number>(0);
  const [proposalLeaveTabTrigger, setProposalLeaveTabTrigger] = useState<number>(0);
  const [proposalTemplateTrigger, setProposalTemplateTrigger] = useState<number>(0);
  const [externalOpenProposalId, setExternalOpenProposalId] = useState<string | null>(null);

  // State cho Tab Thông Báo & Quyết Định Nội Bộ (Enterprise Announcements & Decisions)
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [announcementCategoryFilter, setAnnouncementCategoryFilter] = useState<string>("all");
  const [announcementFromDate, setAnnouncementFromDate] = useState<string>("");
  const [announcementToDate, setAnnouncementToDate] = useState<string>("");
  const [announcementSortBy, setAnnouncementSortBy] = useState<"newest" | "issue_desc" | "issue_asc" | "pinned_first">("newest");
  const [isAnnouncementModalOpen, setIsAnnouncementModalOpen] = useState(false);
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<string | number | null>(null);
  const [selectedAnnouncementDetail, setSelectedAnnouncementDetail] = useState<any>(null);
  const [announcementCommentText, setAnnouncementCommentText] = useState("");
  const [sendingAnnouncementRemindId, setSendingAnnouncementRemindId] = useState<string | number | null>(null);
  const [announcementForm, setAnnouncementForm] = useState<{
    docCode: string;
    docType: "DECISION" | "ANNOUNCEMENT" | "POLICY" | "SALES_POLICY" | "RECOGNITION";
    priority: "URGENT" | "IMPORTANT" | "NORMAL";
    pinned: boolean;
    title: string;
    summary: string;
    content: string;
    issuerName: string;
    issuerRole: string;
    issuerDept: string;
    targetScope: "ALL" | "DEPARTMENTS" | "INDIVIDUALS";
    targetDepts: string[];
    targetStaff: string[];
    issueDate: string;
    effectiveDate: string;
    requireAck: boolean;
    sendChatNotify: boolean;
    sendBellNotify: boolean;
    attachments: Array<{ name: string; url: string; size?: number; type?: string; uploaded_at?: string }>;
  }>({
    docCode: `TB-${new Date().getFullYear()}/001`,
    docType: "ANNOUNCEMENT",
    priority: "IMPORTANT",
    pinned: true,
    title: "",
    summary: "",
    content: "",
    issuerName: "",
    issuerRole: "Ban Giám Đốc",
    issuerDept: "Ban Giám Đốc",
    targetScope: "ALL",
    targetDepts: [],
    targetStaff: [],
    issueDate: todayVN(),
    effectiveDate: todayVN(),
    requireAck: true,
    sendChatNotify: true,
    sendBellNotify: true,
    attachments: []
  });

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
  const [supplierList, setSupplierList] = useState<any[]>(DEFAULT_KNOWN_SUPPLIERS);
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
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    const rawUrl = previewDoc?.url || previewImage || "";
    if (!rawUrl) {
      setPreviewBlobUrl(null);
      return;
    }
    let createdUrl: string | null = null;
    if (rawUrl.startsWith("data:application/pdf;base64,")) {
      try {
        const b64 = rawUrl.split(",")[1] || "";
        const binary = window.atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: "application/pdf" });
        createdUrl = URL.createObjectURL(blob);
        setPreviewBlobUrl(createdUrl);
      } catch {
        setPreviewBlobUrl(null);
      }
    } else {
      setPreviewBlobUrl(null);
    }
    const onKeyCapture = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setPreviewDoc(null);
        setPreviewImage(null);
      }
    };
    window.addEventListener("keydown", onKeyCapture, true);
    return () => {
      window.removeEventListener("keydown", onKeyCapture, true);
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [previewDoc, previewImage]);

  // Modals for Planner Tab
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [scheduleForm, setScheduleForm] = useState<{
    day: string;
    date?: string;
    endDate?: string;
    selectedDates?: string[];
    dateMode?: "SINGLE" | "RANGE" | "MULTI_DAYS";
    startTime?: string;
    endTime?: string;
    time: string;
    category: string;
    title: string;
    actor: string;
    coActors?: string[];
    location: string;
    linkedTaskCodes?: string[];
    autoCreateTask?: boolean;
    eventType?: "WORK" | "MEETING";
    meetingAgenda?: string;
    meetingLink?: string;
    sendChatNotify?: boolean;
    createMeetingGroup?: boolean;
    sendBellNotify?: boolean;
    reminderMinutes?: number;
    customNotifyMessage?: string;
    chatChannelId?: number;
    lastRemindedAt?: string;
    attachments?: Array<{ name: string; url: string; size?: number; type?: string; uploaded_at?: string }>;
  }>({
    day: "Thứ 2",
    date: todayVN(),
    endDate: todayVN(),
    selectedDates: [todayVN()],
    dateMode: "SINGLE",
    startTime: "08:30",
    endTime: "11:30",
    time: "08:30 - 11:30",
    category: "Application",
    title: "",
    actor: "",
    coActors: [],
    location: "",
    linkedTaskCodes: [],
    autoCreateTask: false,
    eventType: "WORK",
    meetingAgenda: "",
    meetingLink: "",
    sendChatNotify: true,
    createMeetingGroup: true,
    sendBellNotify: true,
    reminderMinutes: 30,
    customNotifyMessage: "",
    attachments: []
  });
  const [attendeeSearchQuery, setAttendeeSearchQuery] = useState("");
  const [sendingMeetingRemindId, setSendingMeetingRemindId] = useState<number | string | null>(null);
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
    const sundayDate = new Date(monday);
    sundayDate.setDate(monday.getDate() + 6);
    const all7Days = [
      ...days,
      { name: "Chủ nhật", date: iso(sundayDate), label: `${String(sundayDate.getDate()).padStart(2, "0")}/${String(sundayDate.getMonth() + 1).padStart(2, "0")}` }
    ];
    // Số tuần ISO-8601
    const t = new Date(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3));
    const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    const weekNo = 1 + Math.round(((t.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
    return { days, all7Days, weekNo, year: t.getUTCFullYear() };
  }, [weekOffset]);
  // Lịch cũ chỉ lưu "Thứ 2"... (không có ngày): hiển thị ở tuần hiện tại; hỗ trợ cả lịch kéo dài từ date -> endDate
  const scheduleOnDay = (s: any, day: { name: string; date: string }) => {
    if (s.date) {
      const startIso = String(s.date).slice(0, 10);
      const endIso = s.endDate ? String(s.endDate).slice(0, 10) : startIso;
      if (endIso >= startIso) {
        return day.date >= startIso && day.date <= endIso;
      }
      return startIso === day.date;
    }
    return weekOffset === 0 && s.day === day.name;
  };

  // Khử trùng lặp thẻ lịch công tác tuần (do đồng bộ nhiều lần từ báo cáo tuần Kinh Doanh / Application)
  const dedupeWeeklySchedules = useCallback((rawList: any[]): any[] => {
    if (!Array.isArray(rawList)) return [];
    const seen = new Set<string>();
    const result: any[] = [];
    for (const s of rawList) {
      if (!s || typeof s !== "object") continue;
      const dateOrDay = s.date ? String(s.date).slice(0, 10) : String(s.day || "").trim();
      const timeStr = String(s.time || "").trim();
      const actorStr = canonStaffName(s.actor || "");
      const titleStr = canonStaffName(s.title || "");
      const locStr = canonStaffName(s.location || "");
      const sig = `${dateOrDay}|${timeStr}|${actorStr}|${titleStr}|${locStr}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      result.push(s);
    }
    return result;
  }, []);
  const openScheduleForm = (date?: string, item?: any, defaultEventType: "WORK" | "MEETING" = "WORK") => {
    const defaultActor = selectedAssignee !== "all" && selectedAssignee !== "__UNASSIGNED__"
      ? selectedAssignee
      : (currentStaffName || departmentStaffList[0]?.full_name || "");
    const defaultCategory = rolePerspective === "manager" ? managerDept : (selectedDept === "all" ? "Kinh Doanh" : selectedDept);
    const today = todayVN();
    const pick = date || (viewedWeek.days.some(d => d.date === today) ? today : viewedWeek.days[0].date);
    setAttendeeSearchQuery("");
    if (item) {
      const itemDate = item.date ? String(item.date).slice(0, 10) : (viewedWeek.days.find(d => d.name === item.day)?.date || pick);
      const itemEndDate = item.endDate ? String(item.endDate).slice(0, 10) : itemDate;
      const rawTime = String(item.time || "08:30 - 11:30").trim();
      const rangeMatch = rawTime.match(/^(\d{1,2}:\d{2})\s*[-–→]\s*(\d{1,2}:\d{2})/);
      const parsedActors = String(item.actor || "").split(/[,;\n]+/).map((s: string) => s.trim()).filter(Boolean);
      const hostActor = parsedActors[0] || defaultActor;
      const existingCoActors = Array.isArray(item.coActors) && item.coActors.length > 0
        ? item.coActors
        : parsedActors.slice(1);
      setEditingScheduleId(item.id);
      setScheduleForm({
        day: item.day,
        date: itemDate,
        endDate: itemEndDate,
        selectedDates: [itemDate],
        dateMode: itemEndDate > itemDate ? "RANGE" : "SINGLE",
        startTime: rangeMatch ? rangeMatch[1] : "08:30",
        endTime: rangeMatch ? rangeMatch[2] : "11:30",
        time: rawTime,
        category: item.category || defaultCategory,
        title: item.title || "",
        actor: hostActor,
        coActors: existingCoActors,
        location: item.location || "",
        linkedTaskCodes: Array.isArray(item.linkedTaskCodes) ? item.linkedTaskCodes : [],
        autoCreateTask: false,
        eventType: item.eventType || (String(item.title || "").toLowerCase().includes("họp") ? "MEETING" : "WORK"),
        meetingAgenda: item.meetingAgenda || "",
        meetingLink: item.meetingLink || "",
        sendChatNotify: item.sendChatNotify !== undefined ? item.sendChatNotify : true,
        createMeetingGroup: item.createMeetingGroup !== undefined ? item.createMeetingGroup : true,
        sendBellNotify: item.sendBellNotify !== undefined ? item.sendBellNotify : true,
        reminderMinutes: item.reminderMinutes !== undefined ? Number(item.reminderMinutes) : 30,
        customNotifyMessage: item.customNotifyMessage || "",
        chatChannelId: item.chatChannelId,
        lastRemindedAt: item.lastRemindedAt,
        attachments: item.attachments || []
      });
    } else {
      setEditingScheduleId(null);
      const isMeeting = defaultEventType === "MEETING";
      setScheduleForm({
        day: viewedWeek.all7Days.find(d => d.date === pick)?.name || "Thứ 2",
        date: pick,
        endDate: pick,
        selectedDates: [pick],
        dateMode: "SINGLE",
        startTime: isMeeting ? "08:30" : "08:30",
        endTime: isMeeting ? "10:00" : "11:30",
        time: isMeeting ? "08:30 - 10:00" : "08:30 - 11:30",
        category: defaultCategory,
        title: "",
        actor: defaultActor,
        coActors: [],
        location: isMeeting ? "Phòng họp Công ty" : "",
        linkedTaskCodes: [],
        autoCreateTask: false,
        eventType: defaultEventType,
        meetingAgenda: "",
        meetingLink: "",
        sendChatNotify: true,
        createMeetingGroup: isMeeting,
        sendBellNotify: true,
        reminderMinutes: 30,
        customNotifyMessage: "",
        attachments: []
      });
    }
    setIsScheduleModalOpen(true);
  };

  const [isLabProjectModalOpen, setIsLabProjectModalOpen] = useState(false);
  const [editingThematicId, setEditingThematicId] = useState<string | null>(null);
  const [thematicFilterType, setThematicFilterType] = useState<string>("all");
  const [labProjects, setLabProjects] = useState<any[]>([]);
  const [labProjectForm, setLabProjectForm] = useState({
    id: "DA-01",
    name: "",
    dept: "Liên Phòng Ban",
    participatingDepts: [] as string[],
    customerOrRef: "",
    typeId: "cross_hospital_tender",
    typeName: "Dự Án Đấu Thầu & Cung Ứng Trọn Gói Bệnh Viện",
    lead: "",
    collaborators: [] as string[],
    startDate: todayVN(),
    endDate: todayVN(),
    slot: "Toàn thời gian (Theo tiến trình)",
    priority: "Cao" as "Cao" | "Trung bình" | "Bình thường",
    status: "Active" as "Planning" | "Active" | "Review" | "Completed",
    tasksCount: 0,
    budget: "",
    description: "",
    stages: [] as Array<{
      id: string;
      name: string;
      dept?: string;
      depts?: string[];
      due?: string;
      status: "pending" | "in_progress" | "completed";
      assignee?: string;
      estimatedDays?: number;
      tasks?: Array<{
        id: string;
        title: string;
        dept?: string;
        assignee?: string;
        due?: string;
        status: "pending" | "in_progress" | "completed";
      }>;
    }>
  });
  const [quickTaskStageKey, setQuickTaskStageKey] = useState<string | null>(null);
  const [quickStageTaskForm, setQuickStageTaskForm] = useState<{
    title: string;
    dept: string;
    assignee: string;
    due: string;
  }>({ title: "", dept: "Kinh Doanh", assignee: "", due: todayVN() });

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
    attachments?: Array<{ name: string; url: string; size?: number; type?: string; uploaded_at?: string }>;
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
  const [dailySourceFilter, setDailySourceFilter] = useState<string>("all");
  const [dailyLogStaffScope, setDailyLogStaffScope] = useState<"selected_staff" | "dept">("dept");
  const [analyticsPeriod, setAnalyticsPeriod] = useState<"today" | "week" | "month" | "all">("month");
  const [dailyPlanItems, setDailyPlanItems] = useState<Array<{
    id: string | number;
    title: string;
    source: "schedule" | "task" | "workflow" | "extra";
    origin_tab?: "planner_schedule" | "planner_thematic" | "workflows" | "tasks" | "extra";
    origin_badge?: string;
    origin_detail?: string;
    task_id?: number;
    task_code?: string;
    workflow_id?: number;
    workflow_code?: string;
    project_code?: string;
    schedule_id?: number | string;
    time_slot?: string;
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
  const fetchData = async (opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent && workflows.length === 0 && tasks.length === 0) setLoading(true);
      const wsStorageKeys = [
        "unified_weekly_schedule",
        "unified_thematic_projects",
        "unified_sales_targets",
        "unified_announcements",
        "workspace_proposals"
      ];
      const [res, batchStorageRes] = await Promise.all([
        fetch("/api/workflows?action=overview"),
        fetch(`/api/storage?keys=${wsStorageKeys.join(",")}`).catch(() => null)
      ]);
      const data = await res.json();
      const batchStorageJson = batchStorageRes && batchStorageRes.ok ? await batchStorageRes.json().catch(() => null) : null;
      const batchStorageData: Record<string, any> = batchStorageJson?.data || {};
      if (data) {
        const fetchedTasks: any[] = data.tasks || [];
        setTasks(fetchedTasks);
        setWorkflows(data.workflows || []);
        setDailyLogs(data.daily || []);
        if (data.personnel) setPersonnelList(data.personnel);
        if (Array.isArray(data.customers)) setCustomerList(data.customers);
        if (Array.isArray(data.products)) setProductList(data.products);
        setWorkflowTemplates(mergeWithDefaultWorkflowTemplates(data.templates));

        // Đồng bộ ngay quyền mới nhất từ máy chủ cho tài khoản đang đăng nhập (không cần đăng xuất / F5)
        const mergedMyPerms: Record<string, boolean> = {
          ...(data.currentUserPermissions && typeof data.currentUserPermissions === "object" ? data.currentUserPermissions : {})
        };
        if (Array.isArray(data.users)) {
          data.users.forEach((uRow: any) => {
            const matchByUsername = user?.username && uRow.username && String(uRow.username).toLowerCase() === String(user.username).toLowerCase();
            const matchByName = currentStaffName && uRow.full_name && sameStaffName(uRow.full_name, currentStaffName);
            if (matchByUsername || matchByName) {
              let rowPerms = uRow.permissions;
              if (typeof rowPerms === "string") {
                try { rowPerms = JSON.parse(rowPerms); } catch { rowPerms = {}; }
              }
              if (rowPerms && typeof rowPerms === "object") {
                Object.entries(rowPerms).forEach(([k, v]) => {
                  if (v === true) mergedMyPerms[k] = true;
                });
              }
            }
          });
        }
        if (Object.keys(mergedMyPerms).length > 0) {
          setServerMyPermissions(mergedMyPerms);
          updateUser({ permissions: { ...(user?.permissions || {}), ...mergedMyPerms } });
        }

        // Load persistent weekly schedule & auto-deduplicate (từ batch request đã tải song song)
        try {
          let rawSched: any[] = [];
          if (Array.isArray(batchStorageData.unified_weekly_schedule)) {
            rawSched = batchStorageData.unified_weekly_schedule;
          } else {
            const local = typeof window !== "undefined" ? localStorage.getItem("unified_weekly_schedule") : null;
            if (local) rawSched = JSON.parse(local);
          }
          const cleanedSched = dedupeWeeklySchedules(rawSched);
          setWeeklySchedule(cleanedSched);
          if (cleanedSched.length !== rawSched.length) {
            if (typeof window !== "undefined") {
              localStorage.setItem("unified_weekly_schedule", JSON.stringify(cleanedSched));
            }
            fetch("/api/storage?key=unified_weekly_schedule", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(cleanedSched)
            }).catch(() => {});
          }
        } catch (err) {
          console.warn("Could not load weekly schedule:", err);
          const local = typeof window !== "undefined" ? localStorage.getItem("unified_weekly_schedule") : null;
          if (local) setWeeklySchedule(dedupeWeeklySchedules(JSON.parse(local)));
        }

        // Load persistent thematic projects & sync stage progress with linked company_tasks
        try {
          let rawPrjs: any[] = [];
          if (Array.isArray(batchStorageData.unified_thematic_projects)) {
            rawPrjs = batchStorageData.unified_thematic_projects;
          } else {
            const local = typeof window !== "undefined" ? localStorage.getItem("unified_thematic_projects") : null;
            if (local) rawPrjs = JSON.parse(local);
          }
          const syncedPrjs = rawPrjs.map((prj: any) => {
            const prjIdUpper = String(prj.id || "").toUpperCase();
            const linked = fetchedTasks.filter((t: any) =>
              String(t.related_workflow_code || "").toUpperCase() === prjIdUpper ||
              String(t.task_code || "").toUpperCase().startsWith(`TSK-${prjIdUpper}-S`)
            );
            const stages = (prj.stages || []).map((stg: any, idx: number) => {
              const stageTaskCode = `TSK-${prjIdUpper}-S${idx + 1}`;
              const matchedTask = linked.find((t: any) => String(t.task_code || "").toUpperCase() === stageTaskCode);
              if (matchedTask) {
                const stgStatus = matchedTask.status === "DONE" ? "completed" : matchedTask.status === "IN_PROGRESS" ? "in_progress" : stg.status;
                return { ...stg, status: stgStatus };
              }
              return stg;
            });
            return {
              ...prj,
              stages,
              tasksCount: Math.max(linked.length, stages.length, Number(prj.tasksCount) || 0)
            };
          });
          setLabProjects(syncedPrjs);
        } catch (err) {
          console.warn("Could not load thematic projects:", err);
          const local = typeof window !== "undefined" ? localStorage.getItem("unified_thematic_projects") : null;
          if (local) setLabProjects(JSON.parse(local));
        }

        // Load persistent sales targets
        try {
          if (Array.isArray(batchStorageData.unified_sales_targets)) {
            setSalesTargets(batchStorageData.unified_sales_targets);
          } else {
            const localSt = typeof window !== "undefined" ? localStorage.getItem("unified_sales_targets") : null;
            if (localSt) setSalesTargets(JSON.parse(localSt));
          }
        } catch (err) {
          const localSt = typeof window !== "undefined" ? localStorage.getItem("unified_sales_targets") : null;
          if (localSt) setSalesTargets(JSON.parse(localSt));
        }

        // Load persistent enterprise announcements & decisions
        try {
          if (Array.isArray(batchStorageData.unified_announcements)) {
            setAnnouncements(batchStorageData.unified_announcements);
          } else {
            const localAnn = typeof window !== "undefined" ? localStorage.getItem("unified_announcements") : null;
            if (localAnn) setAnnouncements(JSON.parse(localAnn));
          }
        } catch (err) {
          const localAnn = typeof window !== "undefined" ? localStorage.getItem("unified_announcements") : null;
          if (localAnn) setAnnouncements(JSON.parse(localAnn));
        }

        // Load persistent enterprise proposals & approvals
        try {
          if (Array.isArray(batchStorageData.workspace_proposals)) {
            setProposals(batchStorageData.workspace_proposals);
          } else {
            const localProp = typeof window !== "undefined" ? localStorage.getItem("workspace_proposals") : null;
            if (localProp) setProposals(JSON.parse(localProp));
          }
        } catch (err) {
          const localProp = typeof window !== "undefined" ? localStorage.getItem("workspace_proposals") : null;
          if (localProp) setProposals(JSON.parse(localProp));
        }

        // Bỏ chặn hiển thị giao diện ngay lập tức trước khi tải bổ sung danh mục NCC từ /api/procurement
        setLoading(false);

        // Load suppliers from procurement API & product manufacturers (non-blocking)
        fetch("/api/procurement")
          .then(procRes => procRes.json())
          .then(procData => {
            if (procData) {
              const procProducts = Array.isArray(procData.products) ? procData.products : [];
              const supProducts = Array.isArray(procData.allSupplierProducts) ? procData.allSupplierProducts : [];
              const mergedProdMap = new Map<string, any>();
              for (const p of (Array.isArray(data.products) ? data.products : [])) {
                const k = String(p.code || p.name || "").trim().toUpperCase();
                if (k) mergedProdMap.set(k, p);
              }
              for (const p of procProducts) {
                const k = String(p.code || "").trim().toUpperCase();
                if (k) mergedProdMap.set(k, p);
              }
              for (const sp of supProducts) {
                const k = String(sp.product_code || "").trim().toUpperCase();
                if (k && !mergedProdMap.has(k)) {
                  mergedProdMap.set(k, {
                    code: sp.product_code,
                    name: sp.product_name || sp.product_code,
                    specification: sp.specification || "",
                    unit: sp.unit || "Hộp",
                    category: sp.supplier_short_name || sp.supplier_name || "Danh mục NCC",
                    cost_price: parseFloat(sp.purchase_price) || 0
                  });
                }
              }
              if (mergedProdMap.size > 0) {
                setProductList(Array.from(mergedProdMap.values()));
              }
            }
            const apiSups = Array.isArray(procData?.suppliers)
              ? procData.suppliers
              : Array.isArray(procData?.data?.suppliers)
              ? procData.data.suppliers
              : [];
            const poSups = Array.isArray(procData?.purchaseOrders)
              ? procData.purchaseOrders
                  .map((po: any) => ({
                    name: po.supplier_name || po.vendor_name,
                    customer_code: po.supplier_code || "NCC",
                    address: po.country || "Nhà cung cấp PO"
                  }))
                  .filter((s: any) => s.name)
              : [];
            const mergedSups: any[] = [...DEFAULT_KNOWN_SUPPLIERS];
            [...apiSups, ...poSups].forEach((s: any) => {
              const sName = String(s?.name || s?.supplier_name || s?.company_name || "").trim();
              if (sName && !mergedSups.some((m) => m.name.toLowerCase() === sName.toLowerCase())) {
                mergedSups.push({
                  id: s.id || `sup-${sName}`,
                  name: sName,
                  customer_code: s.customer_code || s.supplier_code || s.code || "NCC",
                  address: s.address || s.country || "Nhà cung cấp / Đối tác",
                  entityType: "supplier"
                });
              }
            });
            setSupplierList(mergedSups);
          })
          .catch(supErr => {
            console.warn("Could not load procurement suppliers:", supErr);
          });
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
    const onRevalidated = (e: any) => {
      if (e?.detail?.pathname === "/api/workflows" || e?.detail?.pathname === "/api/storage") {
        fetchData({ silent: true });
      }
    };
    window.addEventListener("tbr:api-revalidated", onRevalidated);
    return () => window.removeEventListener("tbr:api-revalidated", onRevalidated);
  }, []);

  // Keep planner focused directly on Weekly Schedule

  // Dynamic list of staff for the active department (chỉ trả về đúng nhân sự thuộc phòng ban đang chọn)
  const departmentStaffList = useMemo(() => {
    const currentDept = selectedDept !== "all" ? selectedDept : (rolePerspective === "manager" ? managerDept : "all");

    if (!currentDept || currentDept === "all") {
      return personnelList || [];
    }

    const normDept = normalizeWorkspaceDept(currentDept);
    const list: any[] = [];

    if (personnelList && personnelList.length > 0) {
      personnelList.forEach((p: any) => {
        if (isSameWorkspaceDept(p.department, currentDept)) {
          list.push(p);
        }
      });
    }

    if (normDept && normDept !== "all" && DEPARTMENT_STAFF[normDept]) {
      DEPARTMENT_STAFF[normDept].forEach(rawName => {
        const cleanName = rawName.replace(/\s*\(.*?\)/, "").trim();
        const posMatch = rawName.match(/\((.*?)\)/);
        if (!list.some((p: any) => sameStaffName(p.full_name || p, cleanName))) {
          list.push({
            full_name: cleanName,
            employee_code: "",
            position: posMatch ? posMatch[1] : `Nhân sự ${normDept}`,
            department: normDept
          });
        }
      });
    }

    return list;
  }, [personnelList, selectedDept, rolePerspective, managerDept]);

  // Tự động đồng bộ nhân sự đang chọn ở Bảng việc & Nhật ký Daily khi chuyển Phòng ban
  useEffect(() => {
    if (rolePerspective === "staff") return;
    const currentDept = selectedDept !== "all" ? selectedDept : (rolePerspective === "manager" ? managerDept : "all");
    if (currentDept && currentDept !== "all") {
      if (
        selectedAssignee !== "all" &&
        selectedAssignee !== "__UNASSIGNED__" &&
        !departmentStaffList.some((p: any) => sameStaffName(p.full_name || p, selectedAssignee))
      ) {
        setSelectedAssignee("all");
      }
      if (
        !selectedDailyStaff ||
        !departmentStaffList.some((p: any) => sameStaffName(p.full_name || p, selectedDailyStaff))
      ) {
        const firstStaff = departmentStaffList[0]?.full_name || "";
        setSelectedDailyStaff(firstStaff);
      }
    }
  }, [selectedDept, departmentStaffList, rolePerspective, managerDept, selectedAssignee, selectedDailyStaff]);

  // Đồng bộ khi người dùng chọn 1 nhân sự cụ thể trên thanh lọc chung
  useEffect(() => {
    if (selectedAssignee && selectedAssignee !== "all" && selectedAssignee !== "__UNASSIGNED__") {
      setSelectedDailyStaff(selectedAssignee);
    }
  }, [selectedAssignee]);

  // RBAC Filtered Tasks:
  // - Staff: Views their assigned tasks + unassigned tasks in their department (so they can see incoming Demo/coordination requests)
  // - Manager: Views all tasks in their department (or selected department if switched in dropdown)
  // - Director: Views company-wide or selected department
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      const cleanAssignee = cleanWorkspaceAssignee(t.assignee_name);
      if (rolePerspective === "staff") {
        const isAssignedToMe = Boolean(cleanAssignee) && sameStaffName(cleanAssignee, currentStaffName);
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
        if (!cleanAssignee || !sameStaffName(cleanAssignee, selectedAssignee)) {
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
        return Boolean(s.actor) && sameStaffName(s.actor, currentStaffName);
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
      const partDepts: string[] = Array.isArray(p.participatingDepts) ? p.participatingDepts : [];
      const stageDepts: string[] = Array.isArray(p.stages) ? p.stages.map((s: any) => s.dept).filter(Boolean) : [];
      const matchesDeptFilter = (targetDept: string) => {
        if (!targetDept || targetDept === "all") return true;
        if (p.dept === "Liên Phòng Ban") {
          if (partDepts.length === 0 && stageDepts.length === 0) return true;
        }
        return (
          isSameWorkspaceDept(p.dept, targetDept) ||
          partDepts.some((d) => isSameWorkspaceDept(d, targetDept)) ||
          stageDepts.some((d) => isSameWorkspaceDept(d, targetDept))
        );
      };

      // Filter by department
      if (selectedDept !== "all" && !matchesDeptFilter(selectedDept)) {
        return false;
      }

      // Filter by staff
      if (rolePerspective === "staff") {
        const isLead = sameStaffName(p.lead, currentStaffName);
        const isCollab = Array.isArray(p.collaborators) && p.collaborators.some((c: string) => sameStaffName(c, currentStaffName));
        const isStageAssignee = Array.isArray(p.stages) && p.stages.some((s: any) => s.assignee && sameStaffName(s.assignee, currentStaffName));
        const inMyDeptProject = userDept && matchesDeptFilter(userDept);
        if (!isLead && !isCollab && !isStageAssignee && !inMyDeptProject) return false;
      } else if (selectedAssignee !== "all" && selectedAssignee !== "__UNASSIGNED__") {
        const lead = (p.lead || "").toLowerCase().trim();
        const target = selectedAssignee.toLowerCase().trim();
        const matchesLead = lead.includes(target) || target.includes(lead);
        const matchesCollab = Array.isArray(p.collaborators) && p.collaborators.some((c: string) => c.toLowerCase().includes(target));
        const matchesStageAssignee = Array.isArray(p.stages) && p.stages.some((s: any) => String(s.assignee || "").toLowerCase().includes(target));
        if (!matchesLead && !matchesCollab && !matchesStageAssignee) return false;
      }

      // Filter by thematic type if selected
      if (thematicFilterType !== "all" && p.typeId !== thematicFilterType) {
        return false;
      }

      return true;
    });
  }, [labProjects, rolePerspective, managerDept, userDept, selectedDept, selectedAssignee, currentStaffName, thematicFilterType]);

  // RBAC Filtered Sales Targets:
  // - Staff: ONLY sees their assigned pipeline targets
  // - Manager: Sees all Kinh Doanh targets
  // - Director: Sees all
  const filteredSalesTargets = useMemo(() => {
    return salesTargets.filter((t) => {
      if (rolePerspective === "staff") {
        return Boolean(t.lead) && sameStaffName(t.lead, currentStaffName);
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
      const emp = log.employee_name || log.author || "";
      if (rolePerspective === "staff") {
        return Boolean(emp) && sameStaffName(emp, currentStaffName);
      }
      const activeDept = selectedDept !== "all" ? selectedDept : (rolePerspective === "manager" ? managerDept : "all");
      if (activeDept !== "all") {
        const matchLogDept = isSameWorkspaceDept(log.department, activeDept);
        const matchStaffDept = departmentStaffList.some((p: any) => sameStaffName(p.full_name || p, emp));
        if (!matchLogDept && !matchStaffDept) return false;
      }
      if (dailyLogStaffScope === "selected_staff" && selectedDailyStaff) {
        if (!emp || !sameStaffName(emp, selectedDailyStaff)) return false;
      }
      return true;
    });
  }, [dailyLogs, rolePerspective, managerDept, selectedDept, currentStaffName, departmentStaffList, dailyLogStaffScope, selectedDailyStaff]);

  // Filtered Workflows
  const filteredWorkflows = useMemo(() => {
    return workflows.filter((w) => {
      const stepDepts = Array.isArray(w.steps)
        ? w.steps.flatMap((s: any) => {
            const arr = Array.isArray(s?.departments) ? s.departments : [];
            const split = s?.dept ? String(s.dept).split(",").map((d: string) => d.trim()) : [];
            return [...arr, ...split].filter(Boolean);
          })
        : [];
      const matchDept =
        selectedDept === "all" ||
        isSameWorkspaceDept(w.requester_dept, selectedDept) ||
        String(w.target_dept || "").split(",").some((d: string) => isSameWorkspaceDept(d.trim(), selectedDept)) ||
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

  // Helper to re-index & normalize multi-department / multi-assignee workflow steps
  const reindexWorkflowSteps = useCallback((rawSteps: any[]) => {
    return (rawSteps || []).map((st: any, idx: number) => {
      const depts = Array.from(
        new Set(
          (Array.isArray(st.departments) && st.departments.length > 0
            ? st.departments
            : st.dept
            ? String(st.dept).split(",").map((d: string) => d.trim())
            : ["Application"]
          ).filter(Boolean)
        )
      ) as string[];
      const assignees = Array.from(
        new Set(
          (Array.isArray(st.assignees) && st.assignees.length > 0
            ? st.assignees.map((a: string) => cleanWorkspaceAssignee(a))
            : st.assignee_name
            ? String(st.assignee_name).split(",").map((a: string) => cleanWorkspaceAssignee(a))
            : []
          ).filter(Boolean)
        )
      ) as string[];
      return {
        ...st,
        step_index: idx,
        departments: depts,
        dept: depts.join(", "),
        assignees,
        assignee_name: assignees.join(", ")
      };
    });
  }, []);

  const reconcileProposalsWithNotifications = useCallback((baseList: ProposalItem[], extraNotif?: any): { list: ProposalItem[]; added: boolean } => {
    const safeBase = Array.isArray(baseList) ? [...baseList] : [];
    const knownCodes = new Set(safeBase.map((p) => String(p?.proposalCode || p?.id || "").trim().toUpperCase()).filter(Boolean));
    let rawNotifs: any[] = Array.isArray(filteredNotifications) ? [...filteredNotifications] : [];
    if (typeof window !== "undefined") {
      try {
        const storedNotifs = localStorage.getItem("tbr_activity_notifications");
        if (storedNotifs) {
          const parsed = JSON.parse(storedNotifs);
          if (Array.isArray(parsed)) rawNotifs = [...rawNotifs, ...parsed];
        }
      } catch {}
    }
    if (extraNotif) {
      rawNotifs = [extraNotif.notification || extraNotif, ...rawNotifs];
    }

    let added = false;
    for (const n of rawNotifs) {
      if (!n || typeof n !== "object") continue;
      const nTitle = String(n.title || "").trim();
      const nMsg = String(n.message || "").trim();
      if (!nTitle.toLowerCase().includes("trình duyệt") && !nMsg.toLowerCase().includes("vừa trình duyệt")) continue;

      const codeMatch = `${nTitle} ${nMsg} ${n.link?.itemId || ""}`.match(/\b((?:DXNP|DX|DNTT|DNTU|QT|TTR|DXM)-[A-Z0-9-]+)\b/i);
      if (!codeMatch) continue;
      const code = codeMatch[1].toUpperCase();
      if (knownCodes.has(code)) continue;

      const reqMatch = nMsg.match(/^([^()]+?)\s*\(([^)]+)\)\s*vừa trình duyệt/i);
      const requesterName = String(reqMatch ? reqMatch[1] : n.sender?.name || "Nhân sự").trim();
      const requesterDept = normalizeWorkspaceDept(reqMatch ? reqMatch[2] : n.targetDept || "Kinh Doanh") || "Kinh Doanh";
      const titleMatch = nMsg.match(/"([^"]+)"/);
      const propTitle = titleMatch ? titleMatch[1].trim() : nTitle.replace(/^.*?\]\s*:?\s*/, "").trim() || `Đề xuất ${code}`;
      const waitMatch = nMsg.match(/Đang chờ\s+(.+?)\s+phê duyệt/i);
      const approverName = String(
        waitMatch ? waitMatch[1] : (Array.isArray(n.targetEmployeeNames) && n.targetEmployeeNames[0]) || currentStaffName
      ).trim();

      const dateInTitleMatch = `${propTitle} ${nMsg}`.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const neededIso = dateInTitleMatch
        ? `${dateInTitleMatch[3]}-${dateInTitleMatch[2]}-${dateInTitleMatch[1]}`
        : todayVN();

      const isLeave = code.startsWith("DXNP") || propTitle.toLowerCase().includes("nghỉ phép");
      const isApprovedLater = rawNotifs.some((other) => {
        const ot = String(other?.title || "");
        return ot.toUpperCase().includes(code) && (ot.toLowerCase().includes("đã phê duyệt") || ot.toLowerCase().includes("hoàn tất"));
      });
      const isRejectedLater = rawNotifs.some((other) => {
        const ot = String(other?.title || "");
        return ot.toUpperCase().includes(code) && ot.toLowerCase().includes("từ chối");
      });

      const createdStr = String(n.timestamp || nowVNDateTime());
      const reconstructed: ProposalItem = {
        id: `prop-rec-${code}`,
        proposalCode: code,
        templateId: isLeave ? "tmpl_leave_request" : "tmpl_general_request",
        templateName: isLeave ? "Đơn Xin Nghỉ Phép / Công Tác / Làm Việc Từ Xa" : "Tờ Trình / Đề Xuất Nội Bộ",
        category: isLeave ? "HR_ADMIN" : "TECHNICAL_OPS",
        title: propTitle,
        priority: n.type === "warning" ? "URGENT" : "NORMAL",
        requesterName,
        requesterDept,
        createdAt: createdStr,
        updatedAt: createdStr,
        neededByDate: neededIso,
        totalAmount: 0,
        currency: "VND",
        summaryReason: isLeave ? `${propTitle} (Phục hồi tự động từ thông báo trình duyệt)` : propTitle,
        formValues: isLeave
          ? {
              leaveType: "Nghỉ phép năm (hưởng nguyên lương - AL)",
              fromDate: neededIso,
              toDate: neededIso,
              totalDays: "1",
              shiftSession: "Cả ngày (08:00 - 17:30)",
              handoverStaff: ""
            }
          : {},
        lineItems: [],
        steps: [
          {
            stepOrder: 1,
            stepName: isLeave ? "Trưởng bộ phận / Kế toán phê duyệt" : "Cấp thẩm quyền phê duyệt",
            roleType: "DEPT_HEAD",
            dept: normalizeWorkspaceDept(n.targetDept || "") || userDept || "Kế Toán",
            approverName: approverName || currentStaffName,
            status: isApprovedLater ? "APPROVED" : isRejectedLater ? "REJECTED" : "PENDING_NOW",
            slaHours: 8
          }
        ],
        currentStepIndex: 0,
        status: isApprovedLater ? "APPROVED" : isRejectedLater ? "REJECTED" : "PENDING",
        followers: Array.isArray(n.targetEmployeeNames) ? n.targetEmployeeNames : [approverName].filter(Boolean),
        attachments: [],
        comments: [],
        auditLogs: [
          {
            time: createdStr,
            actor: requesterName,
            action: "Gửi trình duyệt",
            detail: nMsg || `Trình duyệt ${code}`
          }
        ]
      };

      safeBase.unshift(reconstructed);
      knownCodes.add(code);
      added = true;
    }

    return { list: safeBase, added };
  }, [filteredNotifications, currentStaffName, userDept]);

  // Deep-link opener for notifications ("Đi tới xem ↗") -> opens specific Task or Workflow Detail Modal
  const openWorkspaceItemFromNotification = useCallback((rawPayload: any): boolean => {
    if (!rawPayload) return false;
    const notif = rawPayload.notification || rawPayload;
    const rawId = String(rawPayload.id || notif?.taskId || notif?.workflowId || notif?.targetId || notif?.link?.itemId || "").trim();
    const rawCode = String(rawPayload.code || notif?.workflowCode || notif?.orderCode || notif?.link?.itemId || "").trim();
    const rawTitle = String(rawPayload.title || notif?.title || "").trim();
    const rawMsg = String(rawPayload.message || notif?.message || "").trim();
    const subTab = String(rawPayload.subTab || notif?.link?.subTab || "").trim();
    const fullText = `${rawCode} ${rawId} ${rawTitle} ${rawMsg}`.toLowerCase();

    const codeMatch = `${rawCode} ${rawId} ${rawTitle} ${rawMsg}`.match(/\b((?:WF|TASK|DXNP|DX|DNTT|DNTU|QT|TTR|DXM)-[A-Z0-9-]+)\b/i);
    const extractedCode = (codeMatch ? codeMatch[1] : rawCode || rawId).toUpperCase();
    const quoteMatches = Array.from(`${rawTitle} ${rawMsg}`.matchAll(/"([^"]{3,140})"/g)).map((m) => m[1].trim());

    if (
      subTab === "proposals" ||
      /^(?:DXNP|DX|DNTT|DNTU|QT|TTR|DXM)-/i.test(extractedCode) ||
      fullText.includes("trình duyệt") ||
      fullText.includes("nghỉ phép")
    ) {
      setSelectedDept("all");
      setActiveSubTab("proposals");
      const targetPropId = String(extractedCode || rawId || rawCode || "").trim();
      setProposals((prev) => {
        const rec = reconcileProposalsWithNotifications(prev, rawPayload);
        return rec.added ? rec.list : prev;
      });
      if (targetPropId) {
        setExternalOpenProposalId(`${targetPropId}|${Date.now()}`);
      }
      fetch("/api/storage?key=workspace_proposals", { headers: { "x-no-cache": "1" } })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          const serverArr = Array.isArray(j?.data) ? j.data : [];
          const rec = reconcileProposalsWithNotifications(serverArr, rawPayload);
          setProposals(rec.list);
          try {
            localStorage.setItem("workspace_proposals", JSON.stringify(rec.list));
          } catch {}
          if (rec.added) {
            fetch("/api/storage?key=workspace_proposals", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(rec.list)
            }).catch(() => {});
          }
          if (targetPropId) {
            setExternalOpenProposalId(`${targetPropId}|${Date.now()}`);
          }
        })
        .catch(() => {});
      if (typeof window !== "undefined") {
        localStorage.removeItem("workspace_open_task_detail");
      }
      return true;
    }

    const findMatchingWorkflow = () => {
      if (!workflows || workflows.length === 0) return null;
      return (
        workflows.find((w: any) =>
          (rawId && String(w.id) === rawId) ||
          (rawId && String(w.workflow_code || "").toUpperCase() === rawId.toUpperCase()) ||
          (extractedCode && String(w.workflow_code || "").toUpperCase() === extractedCode)
        ) ||
        workflows.find((w: any) =>
          w.workflow_code && fullText.includes(String(w.workflow_code).toLowerCase())
        ) ||
        workflows.find((w: any) =>
          quoteMatches.some((q) => w.title && (w.title.toLowerCase() === q.toLowerCase() || w.title.toLowerCase().includes(q.toLowerCase()) || q.toLowerCase().includes(w.title.toLowerCase())))
        ) ||
        workflows.find((w: any) =>
          w.title && w.title.length >= 5 && fullText.includes(String(w.title).toLowerCase())
        )
      );
    };

    const findMatchingTask = () => {
      if (!tasks || tasks.length === 0) return null;
      return (
        tasks.find((t: any) =>
          (rawId && String(t.id) === rawId) ||
          (rawId && String(t.task_code || "").toUpperCase() === rawId.toUpperCase()) ||
          (extractedCode && String(t.task_code || "").toUpperCase() === extractedCode)
        ) ||
        tasks.find((t: any) =>
          t.task_code && fullText.includes(String(t.task_code).toLowerCase())
        ) ||
        tasks.find((t: any) =>
          quoteMatches.some((q) => t.title && (t.title.toLowerCase() === q.toLowerCase() || t.title.toLowerCase().includes(q.toLowerCase()) || q.toLowerCase().includes(t.title.toLowerCase())))
        ) ||
        tasks.find((t: any) =>
          t.title && t.title.length >= 5 && fullText.includes(String(t.title).toLowerCase())
        )
      );
    };

    const preferWorkflow =
      subTab === "workflows" ||
      extractedCode.startsWith("WF-") ||
      fullText.includes("phối hợp") ||
      fullText.includes("quy trình");

    const matchedWf = preferWorkflow ? (findMatchingWorkflow() || null) : null;
    const matchedTask = !matchedWf ? (findMatchingTask() || null) : null;
    const fallbackWf = !matchedWf && !matchedTask ? findMatchingWorkflow() : null;

    const finalWf = matchedWf || fallbackWf;
    if (finalWf) {
      setSelectedDept("all");
      setWfStatusFilter("all");
      setWfMineFilter("all");
      setWfPriorityFilter("all");
      setSearchQuery("");
      setActiveSubTab("workflows");
      setSelectedWorkflowDetail(finalWf);
      setIsWorkflowDetailModalOpen(true);
      if (typeof window !== "undefined") {
        localStorage.removeItem("workspace_open_task_detail");
      }
      return true;
    }

    if (matchedTask) {
      setSelectedDept("all");
      setSelectedAssignee("all");
      setStatusFilter("all");
      setSearchQuery("");
      setActiveSubTab("tasks");
      openEditTask(matchedTask);
      if (typeof window !== "undefined") {
        localStorage.removeItem("workspace_open_task_detail");
      }
      return true;
    }

    if (subTab === "proposals" || extractedCode.startsWith("DX") || extractedCode.startsWith("DNTT") || extractedCode.startsWith("DNTU") || extractedCode.startsWith("TTR")) {
      setSelectedDept("all");
      setActiveSubTab("proposals");
      const targetPropId = String(rawId || rawCode || extractedCode || "").trim();
      if (targetPropId) {
        setExternalOpenProposalId(targetPropId);
      }
      if (typeof window !== "undefined") {
        localStorage.removeItem("workspace_open_task_detail");
      }
      return true;
    }

    if (subTab === "announcements") {
      setSelectedDept("all");
      setActiveSubTab("announcements");
      const targetAnnId = String(rawId || rawCode || "").trim();
      const matchedAnn = announcements.find(
        (a: any) => String(a.id) === targetAnnId || String(a.docCode || "").toUpperCase() === targetAnnId.toUpperCase()
      );
      if (matchedAnn) {
        setSelectedAnnouncementDetail(matchedAnn);
      }
      if (typeof window !== "undefined") {
        localStorage.removeItem("workspace_open_task_detail");
      }
      return true;
    }

    if (subTab === "workflows") {
      setSelectedDept("all");
      setWfStatusFilter("all");
      setWfMineFilter("all");
      setActiveSubTab("workflows");
    } else if (subTab === "projects") {
      setSelectedDept("all");
      setActiveSubTab("projects");
    } else if (subTab === "planner" || subTab === "plans") {
      setSelectedDept("all");
      setActiveSubTab("planner");
    } else if (subTab === "daily" || subTab === "reports") {
      setSelectedDept("all");
      setActiveSubTab("daily");
    } else if (subTab === "tasks") {
      setSelectedDept("all");
      setSelectedAssignee("all");
      setStatusFilter("all");
      setActiveSubTab("tasks");
    }

    return false;
  }, [workflows, tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen to workspace-open-detail / tbr-navigate / via-navigate and check pending localStorage deep-link
  useEffect(() => {
    if (typeof window === "undefined") return;

    const tryPendingStorage = () => {
      try {
        const raw = localStorage.getItem("workspace_open_task_detail");
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && (!parsed.timestamp || Date.now() - parsed.timestamp < 120000)) {
          const opened = openWorkspaceItemFromNotification(parsed);
          if (opened || (!loading && (tasks.length > 0 || workflows.length > 0))) {
            localStorage.removeItem("workspace_open_task_detail");
          }
        } else {
          localStorage.removeItem("workspace_open_task_detail");
        }
      } catch (e) {}
    };

    tryPendingStorage();

    const handleOpenDetailEvent = (e: Event) => {
      const customEvt = e as CustomEvent;
      if (customEvt.detail) {
        openWorkspaceItemFromNotification(customEvt.detail);
      } else {
        tryPendingStorage();
      }
    };

    const handleNavigateEvent = (e: Event) => {
      const customEvt = e as CustomEvent;
      const detail = customEvt.detail || {};
      if (detail.tab === "workspace" || detail.tab === "tasks" || detail.tab === "workflows") {
        setTimeout(() => {
          const raw = localStorage.getItem("workspace_open_task_detail");
          if (raw) {
            try {
              openWorkspaceItemFromNotification(JSON.parse(raw));
              return;
            } catch {}
          }
          if (detail.itemId || detail.subTab) {
            openWorkspaceItemFromNotification({
              id: detail.itemId,
              code: detail.itemId,
              subTab: detail.subTab || (detail.tab === "workflows" ? "workflows" : "tasks")
            });
          }
        }, 50);
      }
    };

    window.addEventListener("workspace-open-detail", handleOpenDetailEvent);
    window.addEventListener("tbr-navigate", handleNavigateEvent);
    window.addEventListener("via-navigate", handleNavigateEvent);
    return () => {
      window.removeEventListener("workspace-open-detail", handleOpenDetailEvent);
      window.removeEventListener("tbr-navigate", handleNavigateEvent);
      window.removeEventListener("via-navigate", handleNavigateEvent);
    };
  }, [openWorkspaceItemFromNotification, loading, tasks.length, workflows.length]);

  // Bộ lọc riêng của "Danh Sách Phiếu Phối Hợp": trạng thái, quá hạn, liên quan đến tôi, ưu tiên, sắp xếp
  const [templatesExpanded, setTemplatesExpanded] = useState<boolean>(() => {
    try { return typeof window !== "undefined" && localStorage.getItem("ws_templates_expanded") === "1"; } catch { return false; }
  });
  const [wfStatusFilter, setWfStatusFilter] = useState<"open" | "PENDING" | "WORKING" | "REVIEW" | "COMPLETED" | "DUE_SOON" | "OVERDUE" | "all">("open");
  const [wfCategoryFilter, setWfCategoryFilter] = useState<"all" | "TENDER" | "PROCUREMENT" | "WAREHOUSE" | "LAB" | "FINANCE" | "GENERAL">("all");
  const [wfMineFilter, setWfMineFilter] = useState<"all" | "requested" | "assigned">("all");
  const [wfPriorityFilter, setWfPriorityFilter] = useState<string>("all");
  const [wfSort, setWfSort] = useState<"newest" | "deadline" | "priority">("newest");
  const [wfCompactMode, setWfCompactMode] = useState<boolean>(false);
  const [collapsedWfIds, setCollapsedWfIds] = useState<Record<number, boolean>>({});
  const [remindingWfId, setRemindingWfId] = useState<number | null>(null);
  const [slaTick, setSlaTick] = useState<number>(0);

  useEffect(() => {
    const t = setInterval(() => setSlaTick((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, []);

  // Phân loại tự động quy trình / phiếu phối hợp theo ngữ cảnh nghiệp vụ để tách biệt màu sắc & nhãn nhận diện
  const getWorkflowCategoryMeta = (w: any): {
    key: "TENDER" | "PROCUREMENT" | "WAREHOUSE" | "LAB" | "FINANCE" | "GENERAL";
    label: string;
    shortLabel: string;
    icon: string;
    cardBorder: string;
    headerBg: string;
    badgeCls: string;
    codeCls: string;
    progressCls: string;
    stepActiveCls: string;
  } => {
    const code = String(w?.workflow_code || "").toUpperCase();
    const title = String(w?.title || "").toLowerCase();
    const reqDept = String(w?.requester_dept || "").toLowerCase();
    const targetDept = String(w?.target_dept || "").toLowerCase();
    const summary = String(w?.results_summary || "").toLowerCase();

    // 1. Đề xuất mua hàng / Cung ứng (PR / PO)
    if (
      code.startsWith("PR") ||
      code.startsWith("PO") ||
      title.includes("mua ") ||
      title.includes("đặt hàng") ||
      title.includes("nhập hàng") ||
      summary.includes("mã po:") ||
      targetDept.includes("cung ứng") ||
      reqDept.includes("cung ứng")
    ) {
      return {
        key: "PROCUREMENT",
        label: "Đề Xuất Mua Hàng & Cung Ứng",
        shortLabel: "Mua hàng (PR/PO)",
        icon: "🛒",
        cardBorder: "border-emerald-300 dark:border-emerald-800/80 border-l-[6px] border-l-emerald-500",
        headerBg: "bg-gradient-to-r from-emerald-500/15 via-teal-500/5 to-transparent dark:from-emerald-950/60 dark:via-slate-900/80 dark:to-slate-900",
        badgeCls: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-700",
        codeCls: "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/70 border-emerald-200 dark:border-emerald-800",
        progressCls: "bg-emerald-500",
        stepActiveCls: "bg-emerald-50 border-emerald-300 dark:bg-emerald-950/40 dark:border-emerald-700 text-emerald-950 dark:text-emerald-100 ring-1 ring-emerald-400/40"
      };
    }

    // 2. Quy trình Đấu thầu / Dự án bệnh viện
    if (
      title.includes("thầu") ||
      title.includes("ib2") ||
      title.includes("dự án") ||
      title.includes("hồ sơ thầu") ||
      title.includes("bảo lãnh dự thầu")
    ) {
      return {
        key: "TENDER",
        label: "Quy Trình Đấu Thầu & Dự Án",
        shortLabel: "Đấu thầu & Dự án",
        icon: "🏆",
        cardBorder: "border-amber-300 dark:border-amber-800/80 border-l-[6px] border-l-amber-500",
        headerBg: "bg-gradient-to-r from-amber-500/15 via-orange-500/5 to-transparent dark:from-amber-950/60 dark:via-slate-900/80 dark:to-slate-900",
        badgeCls: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-700",
        codeCls: "text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/70 border-amber-200 dark:border-amber-800",
        progressCls: "bg-amber-500",
        stepActiveCls: "bg-amber-50 border-amber-300 dark:bg-amber-950/40 dark:border-amber-700 text-amber-950 dark:text-amber-100 ring-1 ring-amber-400/40"
      };
    }

    // 3. Kho vận & Kiểm kê / Giao nhận
    if (
      title.includes("kho") ||
      title.includes("kiểm kê") ||
      title.includes("giao hàng") ||
      title.includes("vận chuyển") ||
      title.includes("điều拨") ||
      (reqDept.includes("kho") && targetDept.includes("kho"))
    ) {
      return {
        key: "WAREHOUSE",
        label: "Kho Vận & Kiểm Kê Hàng Hóa",
        shortLabel: "Kho vận & Kiểm kê",
        icon: "📦",
        cardBorder: "border-cyan-300 dark:border-cyan-800/80 border-l-[6px] border-l-cyan-500",
        headerBg: "bg-gradient-to-r from-cyan-500/15 via-sky-500/5 to-transparent dark:from-cyan-950/60 dark:via-slate-900/80 dark:to-slate-900",
        badgeCls: "bg-cyan-100 text-cyan-800 border-cyan-300 dark:bg-cyan-950/80 dark:text-cyan-300 dark:border-cyan-700",
        codeCls: "text-cyan-700 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-950/70 border-cyan-200 dark:border-cyan-800",
        progressCls: "bg-cyan-500",
        stepActiveCls: "bg-cyan-50 border-cyan-300 dark:bg-cyan-950/40 dark:border-cyan-700 text-cyan-950 dark:text-cyan-100 ring-1 ring-cyan-400/40"
      };
    }

    // 4. Kỹ thuật & Ứng dụng Lab (Application)
    if (
      title.includes("lab") ||
      title.includes("demo") ||
      title.includes("chạy mẫu") ||
      title.includes("thử nghiệm") ||
      title.includes("kỹ thuật") ||
      targetDept.includes("application") ||
      reqDept.includes("application")
    ) {
      return {
        key: "LAB",
        label: "Kỹ Thuật & Ứng Dụng Lab",
        shortLabel: "Kỹ thuật & Lab",
        icon: "🔬",
        cardBorder: "border-purple-300 dark:border-purple-800/80 border-l-[6px] border-l-purple-500",
        headerBg: "bg-gradient-to-r from-purple-500/15 via-fuchsia-500/5 to-transparent dark:from-purple-950/60 dark:via-slate-900/80 dark:to-slate-900",
        badgeCls: "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/80 dark:text-purple-300 dark:border-purple-700",
        codeCls: "text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/70 border-purple-200 dark:border-purple-800",
        progressCls: "bg-purple-500",
        stepActiveCls: "bg-purple-50 border-purple-300 dark:bg-purple-950/40 dark:border-purple-700 text-purple-950 dark:text-purple-100 ring-1 ring-purple-400/40"
      };
    }

    // 5. Kế toán & Tài chính / Công nợ
    if (
      title.includes("thanh toán") ||
      title.includes("công nợ") ||
      title.includes("hóa đơn") ||
      title.includes("tạm ứng") ||
      targetDept.includes("kế toán") ||
      reqDept.includes("kế toán")
    ) {
      return {
        key: "FINANCE",
        label: "Tài Chính & Kế Toán Công Nợ",
        shortLabel: "Tài chính & Kế toán",
        icon: "💰",
        cardBorder: "border-rose-300 dark:border-rose-800/80 border-l-[6px] border-l-rose-500",
        headerBg: "bg-gradient-to-r from-rose-500/15 via-pink-500/5 to-transparent dark:from-rose-950/60 dark:via-slate-900/80 dark:to-slate-900",
        badgeCls: "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/80 dark:text-rose-300 dark:border-rose-700",
        codeCls: "text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/70 border-rose-200 dark:border-rose-800",
        progressCls: "bg-rose-500",
        stepActiveCls: "bg-rose-50 border-rose-300 dark:bg-rose-950/40 dark:border-rose-700 text-rose-950 dark:text-rose-100 ring-1 ring-rose-400/40"
      };
    }

    // 6. Quy trình phối hợp liên phòng ban chung
    return {
      key: "GENERAL",
      label: "Quy Trình Phối Hợp Liên Bộ Phận",
      shortLabel: "Phối hợp đa bước",
      icon: "🔄",
      cardBorder: "border-indigo-300 dark:border-indigo-800/80 border-l-[6px] border-l-indigo-500",
      headerBg: "bg-gradient-to-r from-indigo-500/15 via-blue-500/5 to-transparent dark:from-indigo-950/60 dark:via-slate-900/80 dark:to-slate-900",
      badgeCls: "bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-950/80 dark:text-indigo-300 dark:border-indigo-700",
      codeCls: "text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/70 border-indigo-200 dark:border-indigo-800",
      progressCls: "bg-indigo-500",
      stepActiveCls: "bg-indigo-50 border-indigo-300 dark:bg-indigo-950/40 dark:border-indigo-700 text-indigo-950 dark:text-indigo-100 ring-1 ring-indigo-400/40"
    };
  };

  // Phân tích mốc thời gian (hỗ trợ ISO, "YYYY-MM-DD HH:mm" giờ VN, hoặc "HH:mm DD/MM/YYYY")
  const parseWfTimestampMs = (raw: any): number | null => {
    if (!raw) return null;
    if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw.getTime();
    const s = String(raw).trim();
    if (!s) return null;
    // "YYYY-MM-DD HH:mm(:ss)" (nowVNDateTime format in UTC+7)
    const vnMatch = s.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)$/);
    if (vnMatch) {
      const t = Date.parse(`${vnMatch[1]}T${vnMatch[2].length === 5 ? vnMatch[2] + ":00" : vnMatch[2]}+07:00`);
      if (!isNaN(t)) return t;
    }
    // "HH:mm(:ss) DD/MM/YYYY" or "DD/MM/YYYY HH:mm"
    const dmyTimeMatch = s.match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}).*?(\d{1,2}):(\d{2})/) || s.match(/(\d{1,2}):(\d{2}).*?(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/);
    if (dmyTimeMatch) {
      const isTimeFirst = s.indexOf(":") < s.indexOf("/");
      const dd = String(isTimeFirst ? dmyTimeMatch[3] : dmyTimeMatch[1]).padStart(2, "0");
      const mm = String(isTimeFirst ? dmyTimeMatch[4] : dmyTimeMatch[2]).padStart(2, "0");
      const yyyy = isTimeFirst ? dmyTimeMatch[5] : dmyTimeMatch[3];
      const hh = String(isTimeFirst ? dmyTimeMatch[1] : dmyTimeMatch[4]).padStart(2, "0");
      const min = String(isTimeFirst ? dmyTimeMatch[2] : dmyTimeMatch[5]).padStart(2, "0");
      const t = Date.parse(`${yyyy}-${mm}-${dd}T${hh}:${min}:00+07:00`);
      if (!isNaN(t)) return t;
    }
    // Date-only "YYYY-MM-DD"
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const t = Date.parse(`${s}T08:00:00+07:00`);
      if (!isNaN(t)) return t;
    }
    const parsed = Date.parse(s);
    return isNaN(parsed) ? null : parsed;
  };

  const formatDurationHours = (hoursFloat: number): string => {
    const absH = Math.abs(hoursFloat);
    if (absH >= 48) {
      const days = Math.floor(absH / 24);
      const remH = Math.round(absH % 24);
      return remH > 0 ? `${days} ngày ${remH}h` : `${days} ngày`;
    }
    const wholeH = Math.floor(absH);
    const mins = Math.max(1, Math.round((absH - wholeH) * 60));
    if (wholeH === 0) return `${mins}p`;
    return mins >= 5 && wholeH < 12 ? `${wholeH}h ${mins}p` : `${wholeH}h`;
  };

  const formatDeadlineShortVN = (ms: number): string => {
    try {
      const d = new Date(ms);
      const hm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
      const dm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit" }).format(d);
      return `${hm} ${dm}`;
    } catch {
      return "";
    }
  };

  // Tính toán trạng thái SLA theo giờ cho từng bước trong quy trình phối hợp
  const getStepSlaMeta = (wf: any, st: any, sIdx: number) => {
    const slaHours = Math.max(1, Number(st?.sla_hours) || 24);
    const wfSteps = Array.isArray(wf?.steps) ? wf.steps : [];
    const currentIdx = typeof wf?.current_step_index === "number" ? wf.current_step_index : 0;
    const wfStatus = String(wf?.status || "").toUpperCase();
    const isWfClosed = ["COMPLETED", "CANCELLED", "REJECTED"].includes(wfStatus);
    const isDone = st?.status === "COMPLETED" || wfStatus === "COMPLETED" || sIdx < currentIdx;
    const isCurrent = !isWfClosed && currentIdx === sIdx && !isDone;

    // Xác định mốc thời gian bắt đầu bước (started_at -> bước trước completed_at -> log khởi tạo -> created_at)
    let rawStart = st?.started_at || st?.returned_at;
    if (!rawStart) {
      if (sIdx === 0) {
        rawStart = (Array.isArray(wf?.logs) && wf.logs[0]?.time) || wf?.created_at;
      } else {
        rawStart = wfSteps[sIdx - 1]?.completed_at || wf?.updated_at || wf?.created_at;
      }
    }
    const startMs = parseWfTimestampMs(rawStart);
    const deadlineMs = startMs ? startMs + slaHours * 3600000 : null;
    const deadlineLabel = deadlineMs ? formatDeadlineShortVN(deadlineMs) : "";

    if (isDone) {
      const doneMs = parseWfTimestampMs(st?.completed_at || wf?.updated_at);
      if (deadlineMs && doneMs && doneMs > deadlineMs) {
        const lateH = (doneMs - deadlineMs) / 3600000;
        return {
          slaHours,
          startMs,
          deadlineMs,
          deadlineLabel,
          remainingHours: -lateH,
          status: "COMPLETED_LATE" as const,
          badgeText: `⚠ Xong trễ SLA (+${formatDurationHours(lateH)})`,
          badgeClass: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-700"
        };
      }
      return {
        slaHours,
        startMs,
        deadlineMs,
        deadlineLabel,
        remainingHours: 0,
        status: "COMPLETED_ON_TIME" as const,
        badgeText: `✓ Đúng SLA (${slaHours}h)`,
        badgeClass: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-700"
      };
    }

    if (!isCurrent || !deadlineMs) {
      return {
        slaHours,
        startMs,
        deadlineMs,
        deadlineLabel,
        remainingHours: null,
        status: "PENDING" as const,
        badgeText: `SLA: ${slaHours}h`,
        badgeClass: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700"
      };
    }

    const nowMs = Date.now();
    const remainingHours = (deadlineMs - nowMs) / 3600000;
    // Ngưỡng "Sắp đến hạn SLA bước": còn <= 25% thời lượng SLA (tối thiểu 1h, tối đa 6h)
    const dueSoonThresholdHours = Math.max(1, Math.min(6, slaHours * 0.25));

    if (remainingHours < 0) {
      return {
        slaHours,
        startMs,
        deadlineMs,
        deadlineLabel,
        remainingHours,
        status: "OVERDUE" as const,
        badgeText: `🔥 Trễ SLA (+${formatDurationHours(remainingHours)})`,
        badgeClass: "bg-rose-600 text-white border-rose-700 shadow-2xs animate-pulse"
      };
    }

    if (remainingHours <= dueSoonThresholdHours) {
      return {
        slaHours,
        startMs,
        deadlineMs,
        deadlineLabel,
        remainingHours,
        status: "DUE_SOON" as const,
        badgeText: `⏰ Sắp hết SLA (còn ${formatDurationHours(remainingHours)})`,
        badgeClass: "bg-amber-500 text-white border-amber-600 shadow-2xs animate-pulse"
      };
    }

    return {
      slaHours,
      startMs,
      deadlineMs,
      deadlineLabel,
      remainingHours,
      status: "ON_TRACK" as const,
      badgeText: `⏱ Còn ${formatDurationHours(remainingHours)} / ${slaHours}h`,
      badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700"
    };
  };

  // Tổng hợp cảnh báo Hạn chót phiếu (Due Date) + SLA bước đang chạy (Step SLA)
  const getWfDeadlineMeta = (w: any) => {
    const s = String(w?.status || "").toUpperCase();
    const isClosed = s === "COMPLETED" || s === "CANCELLED" || s === "REJECTED";
    const wfSteps = Array.isArray(w?.steps) ? w.steps : [];
    const currentIdx = typeof w?.current_step_index === "number" ? w.current_step_index : 0;
    const activeStep = wfSteps.length > 0 ? wfSteps[currentIdx] : null;
    const activeStepSla = activeStep ? getStepSlaMeta(w, activeStep, currentIdx) : null;
    const currentAssignee = cleanWorkspaceAssignee(activeStep?.assignee_name || w?.assignee_name);
    const isUnassigned = !isClosed && !currentAssignee;

    let diffDays: number | null = null;
    if (w?.due_date) {
      const dueIso = String(w.due_date).slice(0, 10);
      const todayIso = todayVN();
      const dueDateMs = Date.parse(`${dueIso}T00:00:00+07:00`);
      const todayDateMs = Date.parse(`${todayIso}T00:00:00+07:00`);
      if (!isNaN(dueDateMs) && !isNaN(todayDateMs)) {
        diffDays = Math.round((dueDateMs - todayDateMs) / 86400000);
      }
    }

    const isTicketOverdue = !isClosed && diffDays !== null && diffDays < 0;
    const isTicketDueToday = !isClosed && diffDays === 0;
    const isTicketDueSoon = !isClosed && diffDays !== null && diffDays >= 0 && diffDays <= 1;
    const isStepOverdue = !isClosed && activeStepSla?.status === "OVERDUE";
    const isStepDueSoon = !isClosed && activeStepSla?.status === "DUE_SOON";

    const isAnyOverdue = isTicketOverdue || isStepOverdue;
    const isAnyDueSoon = !isAnyOverdue && (isTicketDueSoon || isStepDueSoon);

    let ticketDeadlineBadge: { text: string; cls: string } | null = null;
    if (isTicketOverdue && diffDays !== null) {
      ticketDeadlineBadge = {
        text: `⚠ Quá hạn chót ${Math.abs(diffDays)} ngày`,
        cls: "bg-rose-600 text-white animate-pulse"
      };
    } else if (isTicketDueToday) {
      ticketDeadlineBadge = {
        text: "⏰ Hạn chót hôm nay",
        cls: "bg-orange-500 text-white animate-pulse"
      };
    } else if (isTicketDueSoon && diffDays !== null) {
      ticketDeadlineBadge = {
        text: `⏳ Sắp đến hạn (còn ${diffDays} ngày)`,
        cls: "bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-700"
      };
    }

    return {
      isClosed,
      diffDays,
      isTicketOverdue,
      isTicketDueToday,
      isTicketDueSoon,
      isStepOverdue,
      isStepDueSoon,
      isAnyOverdue,
      isAnyDueSoon,
      isUnassigned,
      activeStep,
      activeStepIdx: currentIdx,
      activeStepSla,
      ticketDeadlineBadge
    };
  };

  const wfIsOverdue = (w: any) => getWfDeadlineMeta(w).isAnyOverdue;
  const wfIsDueSoon = (w: any) => getWfDeadlineMeta(w).isAnyDueSoon;

  const wfStatusBucket = (w: any) => {
    const s = String(w.status || "PENDING").toUpperCase();
    if (s === "PENDING") return "PENDING";
    if (s === "ACCEPTED" || s === "IN_PROGRESS") return "WORKING";
    if (s === "REVIEW" || s === "CONVERTED") return "REVIEW";
    if (s === "COMPLETED") return "COMPLETED";
    return "OTHER";
  };
  const wfInvolvesMe = (w: any, mode: "requested" | "assigned") => {
    const me = String(currentStaffName || "").trim();
    if (!me) return false;
    if (mode === "requested") return sameStaffName(String(w.requester_name || "").trim(), me);
    const steps = Array.isArray(w.steps) ? w.steps : [];
    const topAssignees = String(w.assignee_name || "").split(",").map((a: string) => cleanWorkspaceAssignee(a)).filter(Boolean);
    if (topAssignees.some((a: string) => sameStaffName(a, me))) return true;
    return steps.some((s: any) => {
      const sAssignees = Array.isArray(s?.assignees) && s.assignees.length > 0
        ? s.assignees.map((a: string) => cleanWorkspaceAssignee(a))
        : String(s?.assignee_name || "").split(",").map((a: string) => cleanWorkspaceAssignee(a));
      return sAssignees.filter(Boolean).some((a: string) => sameStaffName(a, me));
    });
  };
  const wfBase = useMemo(() => filteredWorkflows.filter((w) =>
    (wfMineFilter === "all" || wfInvolvesMe(w, wfMineFilter)) &&
    (wfPriorityFilter === "all" || String(w.priority || "MEDIUM").toUpperCase() === wfPriorityFilter)
  ), [filteredWorkflows, wfMineFilter, wfPriorityFilter, currentStaffName]); // eslint-disable-line react-hooks/exhaustive-deps

  const wfCategoryCounts = useMemo(() => {
    const c: Record<string, number> = { all: 0, TENDER: 0, PROCUREMENT: 0, WAREHOUSE: 0, LAB: 0, FINANCE: 0, GENERAL: 0 };
    wfBase.forEach((w) => {
      const b = wfStatusBucket(w);
      const matchesStatus =
        wfStatusFilter === "all"
          ? true
          : wfStatusFilter === "open"
          ? b !== "COMPLETED" && b !== "OTHER"
          : wfStatusFilter === "OVERDUE"
          ? wfIsOverdue(w)
          : wfStatusFilter === "DUE_SOON"
          ? wfIsDueSoon(w)
          : b === wfStatusFilter;
      if (!matchesStatus) return;
      c.all++;
      const catKey = getWorkflowCategoryMeta(w).key;
      c[catKey] = (c[catKey] || 0) + 1;
    });
    return c;
  }, [wfBase, wfStatusFilter, slaTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const wfCounts = useMemo(() => {
    const c: Record<string, number> = { all: 0, open: 0, PENDING: 0, WORKING: 0, REVIEW: 0, COMPLETED: 0, DUE_SOON: 0, OVERDUE: 0, UNASSIGNED: 0 };
    wfBase.forEach((w) => {
      if (wfCategoryFilter !== "all" && getWorkflowCategoryMeta(w).key !== wfCategoryFilter) return;
      c.all++;
      const b = wfStatusBucket(w);
      if (c[b] !== undefined) c[b]++;
      if (b !== "COMPLETED" && b !== "OTHER") c.open++;
      const dlMeta = getWfDeadlineMeta(w);
      if (dlMeta.isAnyOverdue) c.OVERDUE++;
      if (dlMeta.isAnyDueSoon) c.DUE_SOON++;
      if (dlMeta.isUnassigned) c.UNASSIGNED++;
    });
    return c;
  }, [wfBase, wfCategoryFilter, slaTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const listWorkflows = useMemo(() => {
    const prio: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const rows = wfBase.filter((w) => {
      if (wfCategoryFilter !== "all" && getWorkflowCategoryMeta(w).key !== wfCategoryFilter) return false;
      const b = wfStatusBucket(w);
      if (wfStatusFilter === "all") return true;
      if (wfStatusFilter === "open") return b !== "COMPLETED" && b !== "OTHER";
      if (wfStatusFilter === "OVERDUE") return wfIsOverdue(w);
      if (wfStatusFilter === "DUE_SOON") return wfIsDueSoon(w);
      return b === wfStatusFilter;
    });
    return [...rows].sort((a, b) => {
      if (wfSort === "deadline") return String(a.due_date || "9999").localeCompare(String(b.due_date || "9999"));
      if (wfSort === "priority") return (prio[String(a.priority || "MEDIUM").toUpperCase()] ?? 2) - (prio[String(b.priority || "MEDIUM").toUpperCase()] ?? 2);
      return (Number(b.id) || 0) - (Number(a.id) || 0);
    });
  }, [wfBase, wfStatusFilter, wfCategoryFilter, wfSort, slaTick]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const todayStr = todayVN();
    const currentMonthPrefix = todayStr.slice(0, 7); // YYYY-MM
    const weekStartStr = viewedWeek.days[0]?.date || todayStr;
    const weekEndStr = viewedWeek.days[viewedWeek.days.length - 1]?.date || todayStr;
    const q = searchQuery.trim().toLowerCase();

    const matchesPeriod = (dateVal: any): boolean => {
      if (analyticsPeriod === "all") return true;
      if (!dateVal) return true;
      const dStr = String(dateVal).slice(0, 10);
      if (dStr.length < 7) return true;
      if (analyticsPeriod === "today") return dStr === todayStr;
      if (analyticsPeriod === "week") return dStr >= weekStartStr && dStr <= weekEndStr;
      if (analyticsPeriod === "month") return dStr.startsWith(currentMonthPrefix);
      return true;
    };

    const matchesSearch = (...fields: any[]): boolean => {
      if (!q) return true;
      return fields.some(f => f && String(f).toLowerCase().includes(q));
    };

    const scopeTasks = tasks.filter(t => {
      if (selectedDept !== "all" && !isSameWorkspaceDept(t.department, selectedDept)) return false;
      if (selectedAssignee === "__UNASSIGNED__" && cleanWorkspaceAssignee(t.assignee_name)) return false;
      if (selectedAssignee !== "all" && selectedAssignee !== "__UNASSIGNED__" && !sameStaffName(cleanWorkspaceAssignee(t.assignee_name), selectedAssignee)) return false;
      if (!matchesSearch(t.title, t.task_code, t.assignee_name, t.customer_name, t.department)) return false;
      return true;
    });

    const scopeWorkflows = workflows.filter(w => {
      if (selectedDept !== "all") {
        const stepDepts = Array.isArray(w.steps)
          ? w.steps.flatMap((s: any) => [
              ...(Array.isArray(s?.departments) ? s.departments : []),
              ...(s?.dept ? String(s.dept).split(",").map((d: string) => d.trim()) : [])
            ])
          : [];
        const matchWfDept =
          isSameWorkspaceDept(w.requester_dept, selectedDept) ||
          String(w.target_dept || "").split(",").some((d: string) => isSameWorkspaceDept(d.trim(), selectedDept)) ||
          stepDepts.some((d: string) => isSameWorkspaceDept(d, selectedDept));
        if (!matchWfDept) return false;
      }
      if (!matchesSearch(w.title, w.workflow_code, w.requester_name, w.assignee_name, w.customer_name, w.product_info)) return false;
      return true;
    });

    const scopeDailyLogs = dailyLogs.filter(d => {
      if (selectedDept !== "all" && !isSameWorkspaceDept(d.department, selectedDept)) return false;
      if (selectedAssignee !== "all" && selectedAssignee !== "__UNASSIGNED__" && !sameStaffName(d.employee_name, selectedAssignee)) return false;
      if (!matchesPeriod(d.log_date || d.created_at)) return false;
      if (!matchesSearch(d.employee_name, d.work_content, d.result, d.issues, d.department)) return false;
      return true;
    });

    const scopeThematicPlans = labProjects.filter(p => {
      if (selectedDept !== "all" && !isSameWorkspaceDept(p.dept, selectedDept)) return false;
      if (!matchesSearch(p.id, p.name, p.lead, p.dept, p.description)) return false;
      return true;
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
    // Điểm tiến độ thực thi (công việc đang làm tính 50% trọng số tiến độ)
    const taskExecutionScore = totalTasks > 0 ? Math.round(((doneTasks + inProgressTasks * 0.5) / totalTasks) * 100) : 0;

    // Workflow metrics & SLA (Đếm đầy đủ PENDING, ACCEPTED, IN_PROGRESS, REVIEW, COMPLETED, CANCELLED/REJECTED)
    const totalWf = scopeWorkflows.length;
    const doneWf = scopeWorkflows.filter(w => String(w.status || "").toUpperCase() === "COMPLETED").length;
    const cancelledWf = scopeWorkflows.filter(w => ["CANCELLED", "REJECTED"].includes(String(w.status || "").toUpperCase())).length;
    const pendingWf = Math.max(0, totalWf - doneWf - cancelledWf);

    const overdueWorkflowList = scopeWorkflows.filter(w => {
      const st = String(w.status || "").toUpperCase();
      if (st === "CANCELLED" || st === "REJECTED") return false;
      if (!w.due_date) return false;
      const dueStr = String(w.due_date).slice(0, 10);
      if (st === "COMPLETED") {
        const doneDateStr = w.updated_at ? String(w.updated_at).slice(0, 10) : "";
        return Boolean(doneDateStr && doneDateStr > dueStr);
      }
      return dueStr < todayStr;
    });
    const overdueWf = overdueWorkflowList.length;
    const overdueDepts = Array.from(
      new Set(
        overdueWorkflowList
          .map(w => {
            const steps = Array.isArray(w.steps) ? w.steps : [];
            const idx = typeof w.current_step_index === "number" ? w.current_step_index : 0;
            return steps[idx]?.dept || w.target_dept || "Các bộ phận liên quan";
          })
          .filter(Boolean)
      )
    );
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

    // Daily discipline: Đếm số nhân sự DUY NHẤT đã nộp báo cáo Daily trong kỳ (không lấy tổng bản ghi lịch sử chia cho nhân sự)
    const staffCount = Math.max(1, scopePersonnel.length);
    const uniqueDailyStaffSet = new Set(
      scopeDailyLogs
        .map(l => canonStaffName(l.employee_name || l.author || ""))
        .filter(Boolean)
    );
    const dailySubmittedCount = uniqueDailyStaffSet.size;
    const totalDailyReportsCount = scopeDailyLogs.length;
    const dailyDisciplineRate = Math.min(100, Math.round((dailySubmittedCount / staffCount) * 100));

    // Difficulties extracted from real daily logs
    const realIssues = scopeDailyLogs
      .filter(l => l.issues && l.issues.trim() !== "")
      .map(l => ({ staff: l.employee_name || "Nhân viên", dept: l.department, issue: l.issues }));

    // Next day plans extracted from real daily logs
    const realNextDayPlans = scopeDailyLogs
      .filter(l => l.next_day_plan && l.next_day_plan.trim() !== "")
      .map(l => ({ staff: l.employee_name || "Nhân viên", dept: l.department, plan: l.next_day_plan }));

    // Composite Score (Chuẩn hóa 4 trụ cột: Thực thi 40% + Phối hợp SLA 30% + Kế hoạch/Lịch 15% + Kỷ luật Daily 15% = 100%)
    const hasData = totalTasks > 0 || totalWf > 0 || totalDailyReportsCount > 0 || totalPlans > 0;
    let compositeScore = 0;
    if (hasData) {
      const weights = {
        task: totalTasks > 0 ? 0.40 : 0,
        wf: totalWf > 0 ? 0.30 : 0,
        plan: totalPlans > 0 ? 0.15 : 0,
        daily: 0.15
      };
      const totalWeight = weights.task + weights.wf + weights.plan + weights.daily;
      if (totalWeight > 0) {
        compositeScore = Math.round(
          ((taskExecutionScore * weights.task) +
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

    // Department Breakdown Scorecard (4 core depts + Khối Hành Chính / Khác nếu có task để tổng số việc luôn khớp 100% với 26/26 việc)
    const coreDepts = ["Kinh Doanh", "Application", "Kho & Vận Hành", "Cung Ứng"];
    const isCoreDept = (deptName: string) => coreDepts.some(c => isSameWorkspaceDept(deptName, c));
    const otherTasksCheck = scopeTasks.filter(t => !isCoreDept(t.department));
    const otherStaffCheck = scopePersonnel.filter(p => !isCoreDept(p.department));
    const departments = (otherTasksCheck.length > 0 || otherStaffCheck.length > 0)
      ? [...coreDepts, "Khối Hành Chính & Khác"]
      : coreDepts;

    const deptScorecards = departments.map(dName => {
      const isOtherGroup = dName === "Khối Hành Chính & Khác";
      const matchDeptFn = (deptVal: string) => isOtherGroup ? !isCoreDept(deptVal) : isSameWorkspaceDept(deptVal, dName);

      const dTasks = scopeTasks.filter(t => matchDeptFn(t.department));
      const dDone = dTasks.filter(t => t.status === "DONE").length;
      const dInProg = dTasks.filter(t => t.status === "IN_PROGRESS").length;
      const dTodo = dTasks.filter(t => t.status === "TODO").length;
      const dTaskPercent = dTasks.length > 0 ? Math.round((dDone / dTasks.length) * 100) : 0;
      const dTaskExecScore = dTasks.length > 0 ? Math.round(((dDone + dInProg * 0.5) / dTasks.length) * 100) : 0;

      const dWfs = scopeWorkflows.filter(w =>
        matchDeptFn(w.target_dept) || matchDeptFn(w.requester_dept)
      );
      const dOverdueWfs = overdueWorkflowList.filter(w =>
        matchDeptFn(w.target_dept) || matchDeptFn(w.requester_dept)
      );
      const dWfSlaPercent = dWfs.length > 0 ? Math.max(0, Math.round(((dWfs.length - dOverdueWfs.length) / dWfs.length) * 100)) : 100;

      const dPlans = scopeThematicPlans.filter(p => matchDeptFn(p.dept));
      const dSchedules = weeklySchedule.filter(s => matchDeptFn(s.dept));
      let dStagesTotal = 0;
      let dStagesDone = 0;
      dPlans.forEach(p => {
        const st = p.stages || [];
        dStagesTotal += st.length;
        dStagesDone += st.filter((s: any) => s.status === "completed").length;
      });
      const dPlanPercent = dStagesTotal > 0
        ? Math.round((dStagesDone / dStagesTotal) * 100)
        : dPlans.length > 0
        ? 50
        : dSchedules.length > 0
        ? Math.min(100, 60 + dSchedules.length * 10)
        : dTaskExecScore;

      const dStaff = scopePersonnel.filter(p => matchDeptFn(p.department));
      const dLogs = scopeDailyLogs.filter(l => matchDeptFn(l.department));
      const dUniqueStaffSet = new Set(dLogs.map(l => canonStaffName(l.employee_name || l.author || "")).filter(Boolean));
      const dUniqueDailyCount = dUniqueStaffSet.size;
      const dDailyPercent = dStaff.length > 0 ? Math.min(100, Math.round((dUniqueDailyCount / dStaff.length) * 100)) : (dLogs.length > 0 ? 100 : 0);

      const hasDeptData = dTasks.length > 0 || dLogs.length > 0 || dPlans.length > 0 || dWfs.length > 0 || dSchedules.length > 0;
      let dScore = 0;
      let dGrade = "Chưa đánh giá";
      let dGradeClass = "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";

      if (hasDeptData) {
        dScore = Math.round(dTaskExecScore * 0.35 + dWfSlaPercent * 0.20 + dPlanPercent * 0.25 + dDailyPercent * 0.20);
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
        wfCount: dWfs.length,
        overdueWfCount: dOverdueWfs.length,
        wfSlaPercent: dWfSlaPercent,
        plansCount: dPlans.length,
        schedulesCount: dSchedules.length,
        planPercent: dPlanPercent,
        staffCount: dStaff.length,
        dailyCount: dUniqueDailyCount,
        totalDailyReports: dLogs.length,
        dailyPercent: dDailyPercent,
        score: dScore,
        grade: dGrade,
        gradeClass: dGradeClass,
        hasData: hasDeptData
      };
    });

    const periodLabel =
      analyticsPeriod === "today"
        ? `Hôm nay (${todayStr.slice(8, 10)}-${todayStr.slice(5, 7)}-${todayStr.slice(0, 4)})`
        : analyticsPeriod === "week"
        ? `Tuần ${viewedWeek.weekNo}/${viewedWeek.year}`
        : analyticsPeriod === "month"
        ? `Tháng ${todayStr.slice(5, 7)}/${todayStr.slice(0, 4)}`
        : "Toàn thời gian";

    return {
      scopeTitle: isDeptScoped ? `Phòng ${currentScopeDept}` : "Toàn Công Ty",
      periodLabel,
      scopeThematicPlans,
      totalTasks,
      doneTasks,
      inProgressTasks,
      todoTasks,
      taskCompletionRate,
      taskExecutionScore,
      totalWf,
      doneWf,
      pendingWf,
      cancelledWf,
      overdueWf,
      overdueDepts,
      wfSlaRate,
      totalPlans,
      completedStagesCount,
      totalStagesCount,
      planProgressRate,
      staffCount,
      dailySubmittedCount,
      totalDailyReportsCount,
      dailyDisciplineRate,
      realIssues,
      realNextDayPlans,
      hasData,
      compositeScore,
      scoreStatus,
      scoreColor,
      deptScorecards
    };
  }, [tasks, workflows, dailyLogs, labProjects, personnelList, selectedDept, selectedAssignee, rolePerspective, managerDept, searchQuery, analyticsPeriod, viewedWeek]);

  // Handle Save Task
  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    // Sửa một việc thành việc khác (đổi hẳn tiêu đề) sẽ làm mất việc cũ: hỏi tạo việc mới thay vì ghi đè
    let payload: any = taskForm;
    const original = taskForm.id ? tasks.find((t: any) => t.id === taskForm.id) : null;
    if (original && canonStaffName(original.title) !== canonStaffName(taskForm.title)) {
      const asNew = window.confirm(
        `Bạn đã đổi tiêu đề công việc ${original.task_code || ""}:\n"${original.title}"\n→ "${taskForm.title}"\n\n` +
        `Bấm OK để TẠO CÔNG VIỆC MỚI (giữ nguyên việc cũ).\nBấm Cancel nếu chỉ muốn sửa tên việc cũ.`
      );
      if (asNew) {
        payload = { ...taskForm, id: null, task_code: undefined, logs: [], result: "", status: "TODO" };
      } else if (!window.confirm(`Ghi đè lên việc "${original.title}"? Nội dung cũ của việc này sẽ được thay bằng nội dung mới.`)) {
        return;
      }
    }
    if (taskReplyText.trim()) {
      const existingLogs = Array.isArray(payload.logs) ? [...payload.logs] : [];
      existingLogs.push({
        type: "comment",
        role: rolePerspective !== "staff" ? "directive" : "comment",
        author: user?.name || currentStaffName || "Nhân viên",
        time: formatVNDateTime(new Date()),
        text: taskReplyText.trim(),
        attachments: []
      });
      payload = { ...payload, logs: existingLogs };
      setTaskReplyText("");
    }
    try {
      const res = await fetch("/api/workflows?action=task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        showToast(payload.id ? "Đã cập nhật công việc!" : "Đã tạo mới công việc!", "success");
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
            workflowId: linkedWf.id,
            workflowCode: linkedWf.workflow_code,
            link: { tab: "workspace", subTab: "workflows", itemId: String(linkedWf.workflow_code || linkedWf.id) }
          });
        }
        const savedTaskId = data.task?.id || payload.id || taskForm.id;
        notifyActivity({
          title: payload.id ? "Cập nhật công việc" : "Giao công việc mới",
          message: payload.id 
            ? `${user?.name || currentStaffName} đã cập nhật công việc "${taskForm.title}".`
            : `${user?.name || currentStaffName} đã giao công việc "${taskForm.title}" cho bạn (${taskForm.department}).`,
          type: "info",
          category: "task",
          sender: { name: user?.name || currentStaffName },
          targetEmployeeNames: taskForm.assignee_name ? taskForm.assignee_name.split(",").map((s: string) => s.trim()).filter(Boolean) : [],
          targetDept: taskForm.department,
          taskId: savedTaskId,
          link: { tab: "workspace", subTab: "tasks", itemId: String(savedTaskId || taskForm.title) }
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
        taskId: target.id,
        link: { tab: "workspace", subTab: "tasks", itemId: String(target.id || target.task_code || target.title) }
      });
    } catch (e) {
      showToast("Lỗi khi cập nhật trạng thái", "error");
    }
  };

  // Handle Save Workflow Request
  const handleSaveWorkflow = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const sanitizedSteps = reindexWorkflowSteps(wfForm.steps || []).map((s: any, idx: number) => {
        const depts = Array.isArray(s.departments) && s.departments.length > 0
          ? s.departments
          : (s.dept || wfForm.target_dept || "Application").split(",").map((d: string) => d.trim()).filter(Boolean);
        const sDept = depts.join(", ");
        const assignees = Array.isArray(s.assignees) && s.assignees.length > 0
          ? s.assignees.map((a: string) => cleanWorkspaceAssignee(a)).filter(Boolean)
          : String(s.assignee_name || "").split(",").map((a: string) => cleanWorkspaceAssignee(a)).filter(Boolean);
        const sAssignee = assignees.join(", ");
        return {
          ...s,
          step_index: idx,
          departments: depts,
          dept: sDept,
          assignees,
          assignee_name: sAssignee
        };
      });
      const isEditingExistingWf = Boolean((wfForm as any).id);
      const rawActiveIdx = typeof (wfForm as any).current_step_index === "number" ? (wfForm as any).current_step_index : 0;
      const activeStepIdx = sanitizedSteps.length > 0
        ? Math.min(Math.max(0, rawActiveIdx), sanitizedSteps.length - 1)
        : 0;
      const activeStepAssignee = sanitizedSteps.length > 0
        ? sanitizedSteps[activeStepIdx].assignee_name
        : cleanWorkspaceAssignee(wfForm.assignee_name);
      const activeStepDept = sanitizedSteps.length > 0 && sanitizedSteps[activeStepIdx].dept
        ? sanitizedSteps[activeStepIdx].dept
        : wfForm.target_dept;
      const effectiveTargetDept = activeStepDept || wfForm.target_dept || "";
      const isProcurementWorkflow =
        wfForm.workflow_type === "TO_PROCUREMENT" ||
        wfForm.workflow_type === "PURCHASE_REQUEST" ||
        String(wfForm.workflow_type || "").toUpperCase().includes("PROCUREMENT") ||
        isSameWorkspaceDept(effectiveTargetDept, "Cung Ứng") ||
        String(effectiveTargetDept).toLowerCase().includes("mua hàng");

      let structuredSummary = (wfForm as any).results_summary || "";
      if (isProcurementWorkflow && !isEditingExistingWf) {
        const rawProd = String(wfForm.product_info || "").trim();
        const matchedCatalogProd = productList.find((p: any) => {
          const pCode = String(p.code || "").trim();
          const pName = String(p.name || "").trim();
          if (pCode && rawProd.toUpperCase().includes(pCode.toUpperCase())) return true;
          if (pName && rawProd.toLowerCase().includes(pName.toLowerCase())) return true;
          return false;
        });

        if (!rawProd || (!matchedCatalogProd && !rawProd.includes(":"))) {
          showToast(
            "⚠️ Lỗi tạo Đề xuất mua hàng (PR): Chưa có Mã sản phẩm (SKU) và Tên hàng cụ thể! Vui lòng chọn đúng sản phẩm từ Bảng mã sản xuất tại ô 'Sản phẩm / Thiết bị'.",
            "error"
          );
          return;
        }

        if (matchedCatalogProd && !structuredSummary) {
          structuredSummary = JSON.stringify([
            {
              product_code: matchedCatalogProd.code,
              product_name: matchedCatalogProd.name,
              specification: matchedCatalogProd.specification || "",
              unit: matchedCatalogProd.unit || "Hộp",
              quantity: 1,
              estimated_price: Number(matchedCatalogProd.cost_price || matchedCatalogProd.standard_price || 0)
            }
          ]);
        }
      }

      const payload = {
        ...wfForm,
        results_summary: structuredSummary,
        target_dept: effectiveTargetDept,
        requester_name: wfForm.requester_name || currentStaffName,
        assignee_name: activeStepAssignee,
        current_step_index: activeStepIdx,
        steps: sanitizedSteps,
        ...(isEditingExistingWf ? { force_rollback: true } : {})
      };

      const res = await fetch("/api/workflows?action=workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        showToast(
          isEditingExistingWf
            ? "✅ Đã lưu cập nhật thông tin phiếu phối hợp, các bước & SLA thành công!"
            : "Đã khởi tạo quy trình liên phòng ban thành công!",
          "success"
        );
        if (isEditingExistingWf && selectedWorkflowDetail && selectedWorkflowDetail.id === (wfForm as any).id) {
          setSelectedWorkflowDetail({
            ...selectedWorkflowDetail,
            ...payload,
            steps: sanitizedSteps
          });
        }
        const allStepAssignees = Array.from(
          new Set(
            [
              ...(payload.assignee_name ? payload.assignee_name.split(",") : []),
              ...sanitizedSteps.flatMap((st: any) => st.assignees || [])
            ]
              .map((s: string) => s.trim())
              .filter(Boolean)
          )
        );
        const assigneeLabel = payload.assignee_name
          ? `Phụ trách: ${payload.assignee_name}.`
          : `Trạng thái: Chờ bộ phận ${payload.target_dept} phân công nhân sự.`;
        const createdWfId = data.workflow?.id || data.id || (wfForm as any).id;
        const createdWfCode = data.workflow?.workflow_code || data.workflow_code || (wfForm as any).workflow_code;
        if (!isEditingExistingWf) {
          notifyActivity({
            title: "Yêu cầu phối hợp liên phòng",
            message: `${payload.requester_name} (${payload.requester_dept}) đã gửi yêu cầu phối hợp "${payload.title}" tới phòng ${payload.target_dept}. ${assigneeLabel}`,
            type: "warning",
            category: isSameWorkspaceDept(payload.target_dept, "Application") ? "application" : isSameWorkspaceDept(payload.target_dept, "Kho & Vận Hành") ? "warehouse" : "task",
            sender: { name: payload.requester_name },
            targetEmployeeNames: allStepAssignees,
            targetDept: payload.target_dept,
            workflowId: createdWfId,
            workflowCode: createdWfCode,
            link: { tab: "workspace", subTab: "workflows", itemId: String(createdWfCode || createdWfId || payload.title) }
          });
        }
        setIsWorkflowModalOpen(false);
        fetchData();
      } else {
        showToast(data.error || "Lỗi khi lưu quy trình", "error");
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

  // Gửi nhắc việc / Đôn đốc tiến độ SLA (Chuông thông báo + Tin nhắn Chat + Nhật ký Phiếu & Bảng công việc)
  const handleRemindWorkflowStep = async (wf: any, silent = false) => {
    if (!wf || !wf.id) return false;
    const dlMeta = getWfDeadlineMeta(wf);
    const wfSteps = Array.isArray(wf.steps) ? wf.steps : [];
    const currentIdx = typeof wf.current_step_index === "number" ? wf.current_step_index : 0;
    const activeStep = wfSteps[currentIdx];
    const stepTitle = activeStep?.title || wf.title || `Bước ${currentIdx + 1}`;
    const stepDept = activeStep?.dept || wf.target_dept || "Bộ phận xử lý";
    const stepAssignee = cleanWorkspaceAssignee(activeStep?.assignee_name || wf.assignee_name);

    const slaParts: string[] = [];
    if (dlMeta.activeStepSla) {
      slaParts.push(`Bước ${currentIdx + 1}: ${dlMeta.activeStepSla.badgeText}`);
    }
    if (dlMeta.ticketDeadlineBadge) {
      slaParts.push(`Hạn phiếu (${wf.due_date ? formatDayVN(wf.due_date) : "—"}): ${dlMeta.ticketDeadlineBadge.text}`);
    } else if (wf.due_date) {
      slaParts.push(`Hạn chót phiếu: ${formatDayVN(wf.due_date)}`);
    }
    if (!stepAssignee) {
      slaParts.push(`Chờ ${stepDept} phân công nhân sự`);
    }
    const slaStatusText = slaParts.join(" • ");

    if (!silent) setRemindingWfId(wf.id);
    try {
      const res = await fetch("/api/workflows?action=remind_workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: wf.id,
          step_index: currentIdx,
          sla_status_text: slaStatusText,
          actor: currentStaffName
        })
      });
      const data = await res.json();
      if (!data.success) {
        if (!silent) showToast(data.error || "Không thể gửi nhắc việc", "error");
        return false;
      }

      // Xác định danh sách người nhận: nếu đã có người phụ trách -> gửi cho người đó; nếu chưa gán -> gửi cho nhân sự thuộc phòng ban đó
      const deptStaffNames = personnelList
        .filter((p: any) => isSameWorkspaceDept(p.department, stepDept))
        .map((p: any) => String(p.full_name || "").trim())
        .filter(Boolean);
      const recipients = stepAssignee
        ? [stepAssignee]
        : (deptStaffNames.length > 0 ? deptStaffNames : [wf.requester_name].filter(Boolean));

      // 1. Phát Thông báo Chuông (Bell Notification)
      notifyActivity({
        title: dlMeta.isAnyOverdue
          ? `🔥 [CẢNH BÁO TRỄ HẠN / SLA] ${wf.workflow_code}`
          : `🔔 [NHẮC VIỆC / SLA] ${wf.workflow_code}`,
        message: `${currentStaffName || "Hệ thống"} nhắc xử lý phiếu "${wf.title}" — Bước ${currentIdx + 1}: ${stepTitle} (${stepAssignee || `Chờ ${stepDept} phân công`}). ${slaStatusText}`,
        type: dlMeta.isAnyOverdue ? "error" : "warning",
        category: isSameWorkspaceDept(stepDept, "Application")
          ? "application"
          : isSameWorkspaceDept(stepDept, "Kho & Vận Hành")
          ? "warehouse"
          : "task",
        sender: { name: currentStaffName || "Hệ thống SLA" },
        targetEmployeeNames: recipients,
        targetDept: stepDept,
        workflowId: wf.id,
        workflowCode: wf.workflow_code,
        link: { tab: "workspace", subTab: "workflows", itemId: String(wf.workflow_code || wf.id) }
      });

      // 2. Bắn tin nhắn trực tiếp qua Chat Nội Bộ tới người phụ trách / bộ phận xử lý
      if (recipients.length > 0) {
        const chatLines = [
          dlMeta.isAnyOverdue
            ? `🔥 [ĐÔN ĐỐC KHẨN - QUÁ HẠN SLA] Phiếu ${wf.workflow_code}: ${wf.title}`
            : `🔔 [NHẮC TIẾN ĐỘ SLA] Phiếu ${wf.workflow_code}: ${wf.title}`,
          `📌 Bước hiện tại: Bước ${currentIdx + 1}/${Math.max(1, wfSteps.length)} — ${stepTitle}`,
          `👤 Đầu mối xử lý (${stepDept}): ${stepAssignee || "⏳ Chưa phân công nhân sự"}`,
          `⏰ Tình trạng SLA / Hạn chót: ${slaStatusText}`,
          activeStep?.deliverables ? `📋 Yêu cầu đầu ra: ${activeStep.deliverables}` : "",
          `👉 Vui lòng kiểm tra tại Tab Điều Hành -> Quy Trình Phối Hợp để cập nhật kết quả hoặc phân công xử lý ngay.`
        ].filter(Boolean);

        try {
          await fetch("/api/chat?action=broadcast_meeting", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: `Nhắc việc ${wf.workflow_code}`,
              content: chatLines.join("\n"),
              attendees: recipients,
              department: stepDept,
              send_direct: true,
              create_group: false
            })
          });
        } catch {}
      }

      if (!silent) {
        showToast(
          `🔔 Đã gửi nhắc việc & cảnh báo SLA phiếu ${wf.workflow_code} tới ${stepAssignee || `bộ phận ${stepDept}`} (Chuông + Chat + Nhật ký phiếu)!`,
          "success"
        );
        fetchData();
      }
      return true;
    } catch (e: any) {
      if (!silent) showToast("Lỗi kết nối khi gửi nhắc việc", "error");
      return false;
    } finally {
      if (!silent) setRemindingWfId(null);
    }
  };

  const handleBulkRemindWorkflows = async (targetWfs: any[]) => {
    if (!Array.isArray(targetWfs) || targetWfs.length === 0) return;
    let count = 0;
    for (const w of targetWfs) {
      const ok = await handleRemindWorkflowStep(w, true);
      if (ok) count++;
    }
    showToast(`🔔 Đã phát lệnh đôn đốc hàng loạt cho ${count}/${targetWfs.length} phiếu đang trễ / sắp hết hạn SLA!`, "success");
    fetchData();
  };

  // Tự động kiểm tra định kỳ các phiếu Sắp hết SLA / Quá hạn SLA / Trễ hạn chót để bật cảnh báo chủ động
  useEffect(() => {
    if (!Array.isArray(workflows) || workflows.length === 0) return;
    const checkWorkflowSlaAlerts = () => {
      const todayKey = `unified_auto_wf_sla_alerts_${todayVN()}`;
      let alertedIds: string[] = [];
      try {
        const raw = typeof window !== "undefined" ? localStorage.getItem(todayKey) : null;
        if (raw) alertedIds = JSON.parse(raw);
      } catch {}

      const myRelevantAlerts: Array<{ wf: any; dlMeta: ReturnType<typeof getWfDeadlineMeta>; alertKey: string }> = [];

      workflows.forEach((wf: any) => {
        const dlMeta = getWfDeadlineMeta(wf);
        if (dlMeta.isClosed) return;
        if (!dlMeta.isAnyOverdue && !dlMeta.isAnyDueSoon) return;

        const stepDept = dlMeta.activeStep?.dept || wf.target_dept;
        const isInvolved =
          isDirector ||
          wfInvolvesMe(wf, "assigned") ||
          wfInvolvesMe(wf, "requested") ||
          (userDept && isSameWorkspaceDept(userDept, stepDept));

        if (!isInvolved) return;

        const kind = dlMeta.isAnyOverdue ? "OVERDUE" : "DUE_SOON";
        const alertKey = `${wf.id}-S${dlMeta.activeStepIdx}-${kind}`;
        if (!alertedIds.includes(alertKey)) {
          myRelevantAlerts.push({ wf, dlMeta, alertKey });
        }
      });

      if (myRelevantAlerts.length === 0) return;

      const nextAlerted = [...alertedIds, ...myRelevantAlerts.map((a) => a.alertKey)].slice(-200);
      try {
        if (typeof window !== "undefined") {
          localStorage.setItem(todayKey, JSON.stringify(nextAlerted));
        }
      } catch {}

      const overdueItems = myRelevantAlerts.filter((a) => a.dlMeta.isAnyOverdue);
      const dueSoonItems = myRelevantAlerts.filter((a) => !a.dlMeta.isAnyOverdue && a.dlMeta.isAnyDueSoon);

      if (overdueItems.length > 0) {
        const first = overdueItems[0];
        const stepNo = first.dlMeta.activeStepIdx + 1;
        showToast(
          `🔥 CẢNH BÁO TRỄ HẠN / SLA: Có ${overdueItems.length} phiếu phối hợp liên quan đến bạn đang quá hạn (VD: ${first.wf.workflow_code} — Bước ${stepNo}: ${first.dlMeta.activeStepSla?.badgeText || first.dlMeta.ticketDeadlineBadge?.text || "Quá hạn"})!`,
          "error"
        );
      } else if (dueSoonItems.length > 0) {
        const first = dueSoonItems[0];
        const stepNo = first.dlMeta.activeStepIdx + 1;
        showToast(
          `⏰ NHẮC SẮP ĐẾN HẠN SLA: Có ${dueSoonItems.length} phiếu phối hợp sắp hết thời gian cam kết (VD: ${first.wf.workflow_code} — Bước ${stepNo}: ${first.dlMeta.activeStepSla?.badgeText || first.dlMeta.ticketDeadlineBadge?.text || "Sắp đến hạn"})!`,
          "warning"
        );
      }
    };

    const initTimer = setTimeout(checkWorkflowSlaAlerts, 2500);
    const intervalTimer = setInterval(checkWorkflowSlaAlerts, 60000);
    return () => {
      clearTimeout(initTimer);
      clearInterval(intervalTimer);
    };
  }, [workflows, currentStaffName, userDept, isDirector]); // eslint-disable-line react-hooks/exhaustive-deps

  // Open Create Template Modal
  const handleOpenCreateTemplate = async () => {
    if (!(await ensureManageTemplatesPermission())) return;
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

  const handleEditTemplate = async (tmpl: any) => {
    if (!(await ensureManageTemplatesPermission())) return;
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
      const normalizedPayload = {
        ...templateForm,
        steps: reindexWorkflowSteps(templateForm.steps || [])
      };
      const res = await fetch("/api/workflows?action=template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizedPayload)
      });
      const data = await res.json();
      if (data.success) {
        showToast("Đã lưu mẫu quy trình phối hợp thành công!", "success");
        setIsTemplateModalOpen(false);
        const mergedTemplates = mergeWithDefaultWorkflowTemplates(data.templates);
        setWorkflowTemplates(mergedTemplates);
        // Nếu đang mở hoặc chọn đúng mẫu quy trình này trong wfForm thì đồng bộ ngay các bước & SLA mới
        const savedCode = String(normalizedPayload.code || normalizedPayload.id || "");
        if (savedCode && String(wfForm.workflow_type) === savedCode) {
          const updatedSteps = reindexWorkflowSteps(
            (normalizedPayload.steps || []).map((s: any, idx: number) => ({
              ...s,
              step_index: idx,
              sla_hours: Number(s.sla_hours) || 24,
              status: idx === 0 ? "IN_PROGRESS" : "PENDING"
            }))
          );
          setWfForm((prev: any) => ({
            ...prev,
            due_date: toVNDateString(new Date(Date.now() + (Number(normalizedPayload.sla_days) || 3) * 86400000)),
            steps: updatedSteps
          }));
        }
        fetchData();
      } else {
        showToast(data.error || "Lỗi khi lưu mẫu quy trình", "error");
      }
    } catch (e: any) {
      showToast("Lỗi kết nối: " + e.message, "error");
    }
  };

  // Lưu trực tiếp các bước & thời gian SLA đang chỉnh sửa trong Modal Khởi Tạo Phiếu vào Mẫu Quy Trình
  const handleSaveCurrentWfStepsToTemplate = async () => {
    if (!(await ensureManageTemplatesPermission())) {
      return;
    }
    const allTemplates = workflowTemplates.length > 0 ? workflowTemplates : DEFAULT_WORKFLOW_TEMPLATES;
    const currentTmpl = allTemplates.find(
      (w: any) => String(w.code || w.id) === String(wfForm.workflow_type)
    );
    const sanitizedSteps = reindexWorkflowSteps(wfForm.steps || []).map((s: any, idx: number) => {
      const depts = Array.isArray(s.departments) && s.departments.length > 0
        ? s.departments
        : String(s.dept || wfForm.target_dept || "Application").split(",").map((d: string) => d.trim()).filter(Boolean);
      const assignees = Array.isArray(s.assignees) && s.assignees.length > 0
        ? s.assignees.map((a: string) => cleanWorkspaceAssignee(a)).filter(Boolean)
        : String(s.assignee_name || "").split(",").map((a: string) => cleanWorkspaceAssignee(a)).filter(Boolean);
      return {
        step_index: idx,
        title: s.title || `Bước ${idx + 1}`,
        dept: depts.join(", "),
        departments: depts,
        assignee_name: assignees.join(", "),
        assignees,
        sla_hours: Math.max(1, Number(s.sla_hours) || 24),
        deliverables: s.deliverables || "Biên bản xác nhận"
      };
    });
    const totalHours = sanitizedSteps.reduce((sum: number, s: any) => sum + (Number(s.sla_hours) || 24), 0);
    const computedSlaDays = Math.max(1, Math.ceil(totalHours / 24));
    const payload = {
      id: currentTmpl && typeof currentTmpl.id === "number" ? currentTmpl.id : null,
      code: currentTmpl ? (currentTmpl.code || currentTmpl.id) : (wfForm.workflow_type || `WF-TMP-${Date.now().toString().slice(-4)}`),
      name: currentTmpl?.name || wfForm.title?.replace(/^\[.*?\]\s*/, "") || "Quy trình phối hợp liên phòng ban",
      source_dept: currentTmpl?.source_dept || currentTmpl?.sourceDept || wfForm.requester_dept || "Kinh Doanh",
      target_dept: sanitizedSteps[0]?.dept || currentTmpl?.target_dept || currentTmpl?.targetDept || wfForm.target_dept || "Application",
      icon: currentTmpl?.icon || "Layers",
      description: currentTmpl?.description || wfForm.description || "",
      sla_days: computedSlaDays,
      steps: sanitizedSteps
    };

    try {
      const res = await fetch("/api/workflows?action=template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        showToast(`✅ Đã lưu cập nhật (${sanitizedSteps.length} bước • Tổng SLA: ${totalHours}h / ${computedSlaDays} ngày) vào Mẫu Quy Trình!`, "success");
        setWorkflowTemplates(mergeWithDefaultWorkflowTemplates(data.templates));
        fetchData();
      } else {
        showToast(data.error || "Không thể lưu cập nhật mẫu quy trình", "error");
      }
    } catch (e: any) {
      showToast("Lỗi kết nối: " + e.message, "error");
    }
  };

  // Mở Modal chỉnh sửa quy trình & SLA cho một phiếu phối hợp đã tạo
  const handleEditWorkflowTicket = (wf: any) => {
    const rawSteps = Array.isArray(wf.steps) && wf.steps.length > 0 ? wf.steps : [];
    const stepsCopy = reindexWorkflowSteps(
      rawSteps.map((s: any, idx: number) => ({
        ...s,
        step_index: idx,
        title: s.title || `Bước ${idx + 1}`,
        dept: s.dept || wf.target_dept || "Application",
        assignee_name: cleanWorkspaceAssignee(s.assignee_name),
        sla_hours: Number(s.sla_hours) || 24,
        deliverables: s.deliverables || "",
        status: s.status || (idx === (wf.current_step_index || 0) ? "IN_PROGRESS" : "PENDING")
      }))
    );
    setWfForm({
      ...(wf as any),
      id: wf.id,
      workflow_code: wf.workflow_code,
      workflow_type: wf.workflow_type || "SALES_TO_APP",
      title: wf.title || "",
      priority: wf.priority || "HIGH",
      requester_name: wf.requester_name || currentStaffName || "",
      requester_dept: wf.requester_dept || userDept || "Kinh Doanh",
      assignee_name: wf.assignee_name || "",
      target_dept: wf.target_dept || "Application",
      customer_name: wf.customer_name || "",
      product_info: wf.product_info || "",
      due_date: wf.due_date ? String(wf.due_date).slice(0, 10) : toVNDateString(new Date(Date.now() + 3 * 86400000)),
      description: wf.description || "",
      attachments: Array.isArray(wf.attachments) ? wf.attachments : [],
      steps: stepsCopy
    } as any);
    setIsWorkflowModalOpen(true);
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
    const stepsCopy = reindexWorkflowSteps(
      rawSteps.map((s: any, idx: number) => {
        const stepDept = s.dept || tmpl.target_dept || tmpl.targetDept || "Application";
        let stepAssignee = cleanWorkspaceAssignee(s.assignee_name);
        if (tmplCode === "SALES_TO_APP") {
          if (isSameWorkspaceDept(stepDept, "Application") && !isCreatorApp) {
            stepAssignee = "";
          } else if (isSameWorkspaceDept(stepDept, "Kinh Doanh") && !stepAssignee) {
            stepAssignee = currentStaffName || "";
          }
        }
        return {
          ...s,
          step_index: idx,
          title: s.title || `Bước ${idx + 1}`,
          dept: stepDept,
          assignee_name: stepAssignee,
          sla_hours: s.sla_hours || 24,
          deliverables: s.deliverables || "",
          status: idx === 0 ? "IN_PROGRESS" : "PENDING"
        };
      })
    );

    setWfForm({
      id: undefined,
      workflow_code: undefined,
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
    } as any);
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
          workflowId: advanceStepData.workflow?.id,
          workflowCode: advanceStepData.workflow?.workflow_code,
          link: { tab: "workspace", subTab: "workflows", itemId: String(advanceStepData.workflow?.workflow_code || advanceStepData.workflow?.id) }
        });
      } else {
        showToast(data.error || "Lỗi khi chuyển bước", "error");
      }
    } catch (e: any) {
      showToast("Lỗi kết nối: " + e.message, "error");
    }
  };

  // Upload attachments via /api/upload (supports automatic 2MB chunked upload for large .rar/.zip/.pdf/video files)
  const handleFileUpload = async (
    files: FileList | null,
    target: "record" | "create" | "comment" | "task" | "schedule" | "announcement"
  ) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    try {
      const uploaded: Array<{ name: string; url: string; size?: number; type?: string; uploaded_at?: string }> = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const res = await uploadSingleFileSmart(file);
        if (res.success && res.url) {
          uploaded.push({
            name: res.name || file.name,
            url: res.url,
            size: res.size || file.size,
            type: res.type || file.type,
            uploaded_at: nowVNDateTime()
          });
        } else {
          showToast(res.error || `Lỗi tải lên tệp ${file.name}`, "error");
        }
      }

      if (uploaded.length === 0) {
        return;
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
      } else if (target === "announcement") {
        setAnnouncementForm((prev) => ({
          ...prev,
          attachments: [...(prev.attachments || []), ...uploaded]
        }));
        showToast(`Đã đính kèm ${uploaded.length} văn bản / tài liệu vào thông báo!`, "success");
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
          workflowId: selectedWorkflowForRecord.id,
          workflowCode: selectedWorkflowForRecord.workflow_code,
          link: { tab: "workspace", subTab: "workflows", itemId: String(selectedWorkflowForRecord.workflow_code || selectedWorkflowForRecord.id) }
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

  // Handle Post Task / Workflow Comment & Directive
  // Trao đổi 2 chiều & Chỉ đạo trực tiếp ngay trong cửa sổ Cập nhật công việc
  const [taskReplyText, setTaskReplyText] = useState("");
  const handleTaskReply = async (wf?: any, options?: { reopenToInProgress?: boolean }) => {
    const text = taskReplyText.trim();
    if (!text) return;
    const isDirective = rolePerspective !== "staff" || Boolean(options?.reopenToInProgress);

    // Nếu đang ở chế độ tạo mới công việc chưa có id trong DB -> lưu tạm vào taskForm.logs
    if (!taskForm.id) {
      const nextLogs = Array.isArray((taskForm as any).logs) ? [...(taskForm as any).logs] : [];
      nextLogs.push({
        type: "comment",
        role: isDirective ? "directive" : "comment",
        author: user?.name || currentStaffName || "Nhân viên",
        time: formatVNDateTime(new Date()),
        text,
        attachments: []
      });
      setTaskForm((prev: any) => ({ ...prev, logs: nextLogs }));
      setTaskReplyText("");
      showToast("Đã thêm ghi chú chỉ đạo vào công việc mới", "info");
      return;
    }

    try {
      const res = await fetch("/api/workflows?action=task_comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: taskForm.id,
          author: user?.name || currentStaffName || "Nhân viên",
          text,
          role_type: isDirective ? "directive" : "comment",
          reopen_status: options?.reopenToInProgress ? "IN_PROGRESS" : undefined,
          attachments: []
        })
      });
      const data = await res.json();
      if (!data.success) {
        showToast(data.error || "Không gửi được trao đổi / chỉ đạo", "error");
        return;
      }

      const nextStatus = data.status || taskForm.status;
      setTaskForm((prev: any) => ({
        ...prev,
        logs: data.logs || prev.logs,
        status: nextStatus
      }));
      setTasks((prev: any[]) =>
        prev.map((t: any) =>
          t.id === taskForm.id
            ? { ...t, logs: data.logs || t.logs, status: nextStatus }
            : t
        )
      );
      if (wf && data.wfComments) {
        setWorkflows((prev: any[]) =>
          prev.map((w: any) => (w.id === wf.id ? { ...w, comments: data.wfComments } : w))
        );
      }

      setTaskReplyText("");
      showToast(
        options?.reopenToInProgress
          ? "Đã gửi chỉ đạo tiếp theo & chuyển trạng thái sang Đang làm!"
          : isDirective
          ? "Đã gửi chỉ đạo trên công việc!"
          : "Đã gửi phản hồi / trao đổi công việc!",
        "success"
      );

      const assignees = taskForm.assignee_name
        ? taskForm.assignee_name.split(",").map((s: string) => s.trim()).filter(Boolean)
        : [];
      const recipients = Array.from(
        new Set([
          ...assignees,
          ...(wf?.requester_name ? [wf.requester_name] : []),
          ...(wf?.assignee_name ? [wf.assignee_name] : [])
        ].filter((n) => n && n !== (user?.name || currentStaffName)))
      );

      notifyActivity({
        title: options?.reopenToInProgress
          ? "Chỉ đạo làm tiếp công việc"
          : isDirective
          ? "Chỉ đạo mới trên công việc"
          : "Trao đổi mới trên công việc",
        message: `${user?.name || currentStaffName} đã ${
          options?.reopenToInProgress
            ? "chỉ đạo triển khai tiếp"
            : isDirective
            ? "gửi chỉ đạo"
            : "phản hồi"
        } tại công việc "${taskForm.title}": "${text.slice(0, 120)}"`,
        type: options?.reopenToInProgress ? "warning" : "info",
        category: "task",
        sender: { name: user?.name || currentStaffName },
        targetEmployeeNames: recipients,
        targetDept: taskForm.department,
        taskId: taskForm.id,
        workflowId: wf?.id,
        workflowCode: wf?.workflow_code,
        link: { tab: "workspace", subTab: "tasks", itemId: String(taskForm.id || taskForm.title) }
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
          message: `${currentStaffName} đã gửi trao đổi trong phiếu "${selectedWorkflowDetail.title}" (${selectedWorkflowDetail.workflow_code}): "${workflowCommentText.trim().slice(0, 60)}${workflowCommentText.trim().length > 60 ? '...' : ''}"`,
          type: "info",
          category: "task",
          sender: { name: currentStaffName },
          targetEmployeeNames: targetEmployee ? [targetEmployee] : [],
          targetDept: isRequester ? selectedWorkflowDetail.target_dept : selectedWorkflowDetail.requester_dept,
          workflowId: selectedWorkflowDetail.id,
          workflowCode: selectedWorkflowDetail.workflow_code,
          link: { tab: "workspace", subTab: "workflows", itemId: String(selectedWorkflowDetail.workflow_code || selectedWorkflowDetail.id) }
        });
      }
    } catch (e) {
      showToast("Lỗi khi gửi phản hồi", "error");
    }
  };

  // Nhân sự đang được chọn để xem/báo cáo tại Tab Nhật Ký Daily (luôn khớp với Phòng ban đang lọc)
  const activeDailyStaff = useMemo(() => {
    if (rolePerspective === "staff") return currentStaffName;
    const activeDept = selectedDept !== "all" ? selectedDept : (rolePerspective === "manager" ? managerDept : "all");
    if (activeDept !== "all") {
      if (selectedDailyStaff && departmentStaffList.some((p: any) => sameStaffName(p.full_name || p, selectedDailyStaff))) {
        return selectedDailyStaff;
      }
      return departmentStaffList[0]?.full_name || "";
    }
    return selectedDailyStaff || currentStaffName;
  }, [rolePerspective, currentStaffName, selectedDept, managerDept, selectedDailyStaff, departmentStaffList]);

  // Hàm phân tích nguồn gốc công việc từ Tab nào (hỗ trợ cả dữ liệu trực tiếp lẫn nhật ký đã lưu trong DB)
  const getDailyItemOriginMeta = useCallback((item: any) => {
    const rawTitle = String(item?.title || "");
    const rawCode = String(item?.task_code || "");
    const wfMatch = rawTitle.match(/\b(WF-[A-Z0-9-]+)\b/i) || String(item?.workflow_code || "").match(/\b(WF-[A-Z0-9-]+)\b/i);
    const thematicMatch = rawCode.match(/^TSK-(.+)-S(\d+)$/i) || rawTitle.match(/\[([A-Z]+-[A-Z]+-\d+)\s*•\s*GĐ/i);
    const taskMatch = rawCode || (rawTitle.match(/\[(TSK-[A-Z0-9-]+)\]/i)?.[1] ?? "");

    if (item?.origin_tab === "workflows" || item?.source === "workflow" || wfMatch) {
      const wfCode = item?.workflow_code || (wfMatch ? wfMatch[1].toUpperCase() : "");
      return {
        originTab: "workflows" as const,
        badgeLabel: "🔄 Nguồn: Tab Quy Trình Phối Hợp",
        subDetail: item?.origin_detail || [wfCode ? `Phiếu: ${wfCode}` : "", taskMatch ? `Mã CV: ${taskMatch}` : ""].filter(Boolean).join(" • "),
        actionLabel: wfCode ? `↗ Mở phiếu ${wfCode}` : "↗ Xem tại Tab Quy Trình Phối Hợp",
        badgeClass: "bg-purple-100 dark:bg-purple-950/80 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-800"
      };
    }

    if (item?.origin_tab === "planner_thematic" || item?.project_code || thematicMatch) {
      const prjCode = item?.project_code || (thematicMatch ? thematicMatch[1].toUpperCase() : "");
      return {
        originTab: "planner_thematic" as const,
        badgeLabel: "🚀 Nguồn: Tab Dự Án",
        subDetail: item?.origin_detail || [prjCode ? `Dự án: ${prjCode}` : "", taskMatch ? `Mã việc: ${taskMatch}` : ""].filter(Boolean).join(" • "),
        actionLabel: prjCode ? `↗ Mở dự án ${prjCode}` : "↗ Xem tại Tab Dự Án",
        badgeClass: "bg-fuchsia-100 dark:bg-fuchsia-950/80 text-fuchsia-800 dark:text-fuchsia-300 border border-fuchsia-300 dark:border-fuchsia-800"
      };
    }

    if (item?.origin_tab === "planner_schedule" || item?.source === "schedule") {
      return {
        originTab: "planner_schedule" as const,
        badgeLabel: "📅 Nguồn: Tab Lịch & Kế Hoạch (Lịch tuần)",
        subDetail: item?.origin_detail || (item?.time_slot ? `⏰ Khung giờ: ${item.time_slot}` : "Lịch công tác tuần"),
        actionLabel: "↗ Xem tại Lịch Công Tác Tuần",
        badgeClass: "bg-indigo-100 dark:bg-indigo-950/80 text-indigo-800 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-800"
      };
    }

    if (item?.origin_tab === "tasks" || item?.source === "task" || taskMatch) {
      return {
        originTab: "tasks" as const,
        badgeLabel: "📋 Nguồn: Tab Bảng Công Việc",
        subDetail: item?.origin_detail || (taskMatch ? `Mã công việc: ${taskMatch}` : "Nhiệm vụ trên Bảng Công Việc"),
        actionLabel: taskMatch ? `↗ Mở việc ${taskMatch}` : "↗ Xem tại Tab Bảng Công Việc",
        badgeClass: "bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
      };
    }

    return {
      originTab: "extra" as const,
      badgeLabel: "⚡ Nguồn: Phát sinh trực tiếp tại Nhật Ký",
      subDetail: item?.origin_detail || "Việc phát sinh ngoài kế hoạch trong ngày",
      actionLabel: "",
      badgeClass: "bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800"
    };
  }, []);

  // Điều hướng 1 chạm từ đầu việc trong Nhật Ký về đúng Tab / Modal gốc
  const handleOpenDailyItemSource = useCallback((item: any) => {
    const meta = getDailyItemOriginMeta(item);
    const rawTitle = String(item?.title || "");
    const rawCode = String(item?.task_code || (rawTitle.match(/\[(TSK-[A-Z0-9-]+)\]/i)?.[1] ?? "")).trim();
    const wfCode = String(item?.workflow_code || (rawTitle.match(/\b(WF-[A-Z0-9-]+)\b/i)?.[1] ?? "")).trim();

    if (meta.originTab === "workflows") {
      const matchedWf = workflows.find(
        (w: any) =>
          (item?.workflow_id && Number(w.id) === Number(item.workflow_id)) ||
          (wfCode && String(w.workflow_code || "").toUpperCase() === wfCode.toUpperCase())
      );
      if (matchedWf) {
        setSelectedWorkflowDetail(matchedWf);
        return;
      }
      setActiveSubTab("workflows");
      return;
    }

    if (meta.originTab === "planner_thematic") {
      setActiveSubTab("projects");
      return;
    }

    if (meta.originTab === "planner_schedule") {
      setActiveSubTab("planner");
      setPlannerView("calendar");
      return;
    }

    if (meta.originTab === "tasks") {
      const matchedTask = tasks.find(
        (t: any) =>
          (item?.task_id && Number(t.id) === Number(item.task_id)) ||
          (rawCode && String(t.task_code || "").toUpperCase() === rawCode.toUpperCase())
      );
      if (matchedTask) {
        openEditTask(matchedTask);
        return;
      }
      setActiveSubTab("tasks");
    }
  }, [getDailyItemOriginMeta, workflows, tasks]);

  // Sync daily items when day or staff changes (Kết nối Lịch Công Tác Tuần + Bảng Công Việc + Quy Trình Phối Hợp + Chuyên đề)
  useEffect(() => {
    const targetStaff = activeDailyStaff;
    const targetDept = selectedDept !== "all" ? selectedDept : (rolePerspective === "manager" ? managerDept : "");
    const targetDayObj = viewedWeek.days.find(d => d.name === selectedDailyDay) || { name: selectedDailyDay, date: todayVN() };

    const matchingSchedules = weeklySchedule.filter(s => {
      if (!scheduleOnDay(s, targetDayObj)) return false;
      if (targetStaff) {
        const actors = String(s.actor || "").split(",").map((a: string) => a.trim()).filter(Boolean);
        if (actors.some((a: string) => sameStaffName(a, targetStaff))) return true;
        const actorLower = String(s.actor || "").toLowerCase().trim();
        const targetLower = targetStaff.toLowerCase().trim();
        return Boolean(actorLower && targetLower && (actorLower.includes(targetLower) || targetLower.includes(actorLower)));
      }
      if (targetDept && !isSameWorkspaceDept(s.category, targetDept)) return false;
      return true;
    });

    const itemsFromSchedule = matchingSchedules.map((s, idx) => ({
      id: `sched-${s.id || idx}`,
      schedule_id: s.id,
      time_slot: s.time || "",
      task_code: s.linked_task_code || "",
      title: s.title || `Công tác ${s.category || ""}`,
      source: "schedule" as const,
      origin_tab: "planner_schedule" as const,
      origin_badge: "📅 Nguồn: Tab Lịch & Kế Hoạch (Lịch tuần)",
      origin_detail: [
        s.time ? `⏰ Khung giờ: ${s.time}` : "Lịch công tác tuần",
        s.linked_task_code ? `🔗 Gắn mã việc: ${s.linked_task_code}` : ""
      ].filter(Boolean).join(" • "),
      category: s.category,
      location: s.location,
      status: "completed" as const,
      result: "",
      issues: "",
      work_hours: 2,
      proportionality: "balanced" as const
    }));

    // Kéo các Công việc đang thực hiện / đến hạn từ Bảng Công Việc (company_tasks) của đúng nhân sự đang chọn
    const matchingTasks = tasks.filter((t: any) => {
      const cleanAssignee = cleanWorkspaceAssignee(t.assignee_name);
      if (targetStaff) {
        if (!cleanAssignee || !sameStaffName(cleanAssignee, targetStaff)) return false;
      } else if (targetDept && !isSameWorkspaceDept(t.department, targetDept)) {
        return false;
      }
      const dl = t.deadline ? String(t.deadline).slice(0, 10) : "";
      if (t.status === "IN_PROGRESS") return true;
      if (t.status === "TODO" && (!dl || dl <= targetDayObj.date)) return true;
      if (t.status === "DONE" && dl === targetDayObj.date) return true;
      return false;
    });

    const itemsFromTasks = matchingTasks.map((t: any) => {
      const relCode = String(t.related_workflow_code || "").trim();
      const tCode = String(t.task_code || "").trim();
      const wfMatch = relCode.match(/^WF-/i) || String(t.title || "").match(/\b(WF-[A-Z0-9-]+)\b/i);
      const thematicStageMatch = tCode.match(/^TSK-(.+)-S(\d+)$/i);
      const isThematic = Boolean(
        thematicStageMatch ||
        t.task_category === "Kế hoạch chuyên đề" ||
        (relCode && !relCode.toUpperCase().startsWith("WF-") && labProjects.some((p: any) => String(p.id).toUpperCase() === relCode.toUpperCase()))
      );

      let origin_tab: "workflows" | "planner_thematic" | "tasks" = "tasks";
      let origin_badge = "📋 Nguồn: Tab Bảng Công Việc";
      let origin_detail = [
        tCode ? `Mã CV: ${tCode}` : "",
        t.task_category ? `Phân loại: ${t.task_category}` : "",
        t.deadline ? `Hạn: ${formatDayVN(String(t.deadline).slice(0, 10))}` : ""
      ].filter(Boolean).join(" • ");
      let workflow_code = "";
      let project_code = "";

      if (wfMatch) {
        origin_tab = "workflows";
        workflow_code = relCode.toUpperCase().startsWith("WF-") ? relCode : (wfMatch[1] || relCode);
        origin_badge = "🔄 Nguồn: Tab Quy Trình Phối Hợp";
        origin_detail = [
          workflow_code ? `Phiếu liên phòng: ${workflow_code}` : "",
          tCode ? `Mã việc đồng bộ: ${tCode}` : ""
        ].filter(Boolean).join(" • ");
      } else if (isThematic) {
        origin_tab = "planner_thematic";
        project_code = relCode || (thematicStageMatch ? thematicStageMatch[1] : "");
        origin_badge = "🎯 Nguồn: Tab Lịch & Kế Hoạch (Chuyên đề)";
        origin_detail = [
          project_code ? `Chuyên đề: ${project_code}` : "",
          tCode ? `Mã giai đoạn: ${tCode}` : ""
        ].filter(Boolean).join(" • ");
      }

      return {
        id: `task-${t.id}`,
        task_id: t.id,
        task_code: t.task_code,
        workflow_code,
        project_code,
        title: `${t.task_code ? `[${t.task_code}] ` : ""}${t.title || ""}`,
        source: "task" as const,
        origin_tab,
        origin_badge,
        origin_detail,
        category: t.department,
        location: t.customer_name || "",
        status: (t.status === "DONE" ? "completed" : "partial") as "completed" | "partial" | "pending",
        result: t.result || "",
        issues: "",
        work_hours: 2,
        proportionality: "balanced" as const
      };
    });

    // Kéo thêm các Phiếu phối hợp liên phòng (Tab Quy Trình Phối Hợp) đang giao cho nhân sự này (nếu chưa có trong danh sách task)
    const representedWfCodes = new Set(
      itemsFromTasks.map(it => String(it.workflow_code || "").toUpperCase()).filter(Boolean)
    );
    const matchingWorkflows = workflows.filter((w: any) => {
      if (w.status === "COMPLETED" || w.status === "REJECTED") return false;
      const wCode = String(w.workflow_code || "").toUpperCase();
      if (wCode && representedWfCodes.has(wCode)) return false;
      const steps = Array.isArray(w.steps) ? w.steps : [];
      const curIdx = typeof w.current_step_index === "number" ? w.current_step_index : 0;
      const curStep = steps[curIdx];
      const stepAssignees = curStep
        ? [
            ...(Array.isArray(curStep.assignees) ? curStep.assignees : []),
            ...String(curStep.assignee_name || "").split(",")
          ].map(a => cleanWorkspaceAssignee(a)).filter(Boolean)
        : [];
      const mainAssignee = cleanWorkspaceAssignee(w.assignee_name);
      if (targetStaff) {
        return (
          (mainAssignee && sameStaffName(mainAssignee, targetStaff)) ||
          stepAssignees.some(a => sameStaffName(a, targetStaff))
        );
      }
      if (targetDept) {
        return isSameWorkspaceDept(w.target_dept, targetDept) || (curStep && isSameWorkspaceDept(curStep.dept, targetDept));
      }
      return false;
    });

    const itemsFromWorkflows = matchingWorkflows.map((w: any) => {
      const steps = Array.isArray(w.steps) ? w.steps : [];
      const curIdx = typeof w.current_step_index === "number" ? w.current_step_index : 0;
      const curStep = steps[curIdx];
      return {
        id: `wf-${w.id}`,
        workflow_id: w.id,
        workflow_code: w.workflow_code,
        title: `[${w.workflow_code}] ${w.title}${curStep?.title ? ` — Bước ${curIdx + 1}: ${curStep.title}` : ""}`,
        source: "workflow" as const,
        origin_tab: "workflows" as const,
        origin_badge: "🔄 Nguồn: Tab Quy Trình Phối Hợp",
        origin_detail: [
          `Phiếu: ${w.workflow_code}`,
          `${w.requester_dept || "Phòng yêu cầu"} ➔ ${w.target_dept || "Phòng xử lý"}`,
          curStep?.title ? `Bước ${curIdx + 1}: ${curStep.title}` : ""
        ].filter(Boolean).join(" • "),
        category: w.target_dept || targetDept,
        location: w.customer_name || "",
        status: "partial" as const,
        result: "",
        issues: "",
        work_hours: 2,
        proportionality: "balanced" as const
      };
    });

    setDailyPlanItems([...itemsFromSchedule, ...itemsFromTasks, ...itemsFromWorkflows]);
  }, [selectedDailyDay, activeDailyStaff, weeklySchedule, tasks, workflows, labProjects, viewedWeek, rolePerspective, managerDept, selectedDept]);

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
    const activeDept = selectedDept !== "all" ? selectedDept : (rolePerspective === "manager" ? managerDept : "Khác");
    const newItem = {
      id: `extra-${Date.now()}`,
      title: "",
      source: "extra" as const,
      origin_tab: "extra" as const,
      origin_badge: "⚡ Nguồn: Phát sinh trực tiếp tại Nhật Ký",
      origin_detail: "Việc phát sinh ngoài kế hoạch trong ngày",
      category: activeDept,
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
    const targetStaff = activeDailyStaff || currentStaffName || "Nhân viên";
    const staffObj = personnelList.find((p: any) => sameStaffName(p.full_name, targetStaff));
    const targetDept = selectedDept !== "all"
      ? selectedDept
      : (staffObj?.department
          ? normalizeWorkspaceDept(staffObj.department)
          : (rolePerspective === "manager" ? managerDept : (dailyForm.department || "Kinh Doanh")));

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
          message: `${targetStaff} (${targetDept}) vừa nộp báo cáo Daily ngày ${formatVNDate(new Date())}.${issuesSummary ? ' Ghi nhận vướng mắc cần hỗ trợ!' : ''}`,
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

  // Hàm gửi Tin nhắn Chat + Thông báo Chuông cho Lịch Họp (Mời họp hoặc Nhắc lịch họp)
  const handleBroadcastMeetingMessage = useCallback(async (
    meetingObj: any,
    mode: "INVITE" | "REMIND" = "INVITE",
    options?: { sendChat?: boolean; createGroup?: boolean; sendBell?: boolean }
  ) => {
    const rawActors = String(meetingObj?.actor || "")
      .split(/[,;\n]+/)
      .map((s: string) => s.trim())
      .filter(Boolean);
    const coList = Array.isArray(meetingObj?.coActors)
      ? meetingObj.coActors.map((s: string) => String(s || "").trim()).filter(Boolean)
      : [];
    const allParticipants = Array.from(new Set([...rawActors, ...coList]));
    const hostName = rawActors[0] || currentStaffName || "Chủ trì";
    const dateStr = meetingObj?.date
      ? `${String(meetingObj.date).slice(8, 10)}-${String(meetingObj.date).slice(5, 7)}-${String(meetingObj.date).slice(0, 4)}`
      : (meetingObj?.day || "Tuần này");
    const dateLabel = meetingObj?.day ? `${meetingObj.day} (${dateStr})` : dateStr;

    const sendChat = options?.sendChat !== undefined ? options.sendChat : (meetingObj?.sendChatNotify !== false);
    const createGroup = options?.createGroup !== undefined ? options.createGroup : Boolean(meetingObj?.createMeetingGroup);
    const sendBell = options?.sendBell !== undefined ? options.sendBell : (meetingObj?.sendBellNotify !== false);

    const headerTitle = mode === "REMIND"
      ? `🔔 [NHẮC LỊCH HỌP SẮP DIỄN RA] ${meetingObj?.title || "Cuộc họp nội bộ"}`
      : `📅 [THÔNG BÁO MỜI HỌP] ${meetingObj?.title || "Cuộc họp nội bộ"}`;

    const msgLines = [
      headerTitle,
      `⏰ Thời gian: ${meetingObj?.time || "08:30"} • ${dateLabel}`,
      `📍 Địa điểm / Phòng họp: ${meetingObj?.location || "Phòng họp Công ty"}`,
      meetingObj?.meetingLink ? `🔗 Link tham dự: ${meetingObj.meetingLink}` : "",
      `👤 Chủ trì: ${hostName} (${meetingObj?.category || "Điều hành"})`,
      `👥 Thành viên tham dự (${allParticipants.length}): ${allParticipants.join(", ")}`,
      meetingObj?.meetingAgenda ? `📝 Nội dung / Chương trình họp: ${meetingObj.meetingAgenda}` : "",
      meetingObj?.customNotifyMessage ? `💬 Lời nhắn: ${meetingObj.customNotifyMessage}` : "",
      mode === "REMIND"
        ? "👉 Đề nghị các thành viên chuẩn bị tài liệu và tham dự đúng giờ!"
        : "👉 Vui lòng sắp xếp công việc và xác nhận tham dự đúng giờ."
    ].filter(Boolean);

    const formattedChatText = msgLines.join("\n");

    let groupChannelId: number | undefined = meetingObj?.chatChannelId;
    let directSentCount = 0;

    if (sendChat && allParticipants.length > 0) {
      try {
        const res = await fetch("/api/chat?action=broadcast_meeting", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: meetingObj?.title || "Cuộc họp nội bộ",
            content: formattedChatText,
            attendees: allParticipants,
            department: meetingObj?.category || "Liên phòng ban",
            send_direct: true,
            create_group: createGroup,
            existing_channel_id: meetingObj?.chatChannelId
          })
        });
        const data = await res.json();
        if (data?.groupChannel?.id) {
          groupChannelId = Number(data.groupChannel.id);
        }
        if (typeof data?.directSentCount === "number") {
          directSentCount = data.directSentCount;
        }
      } catch (err) {
        console.warn("Broadcast meeting chat warning:", err);
      }
    }

    if (sendBell && allParticipants.length > 0) {
      notifyActivity({
        title: mode === "REMIND" ? `🔔 Nhắc lịch họp: ${meetingObj?.title}` : `📅 Thông báo lịch họp: ${meetingObj?.title}`,
        message: `${mode === "REMIND" ? "[NHẮC HỌP]" : "[MỜI HỌP]"} ${dateLabel} lúc ${meetingObj?.time || "08:30"} tại ${meetingObj?.location || "Phòng họp"} • Chủ trì: ${hostName} • Thành viên (${allParticipants.length}): ${allParticipants.slice(0, 5).join(", ")}${allParticipants.length > 5 ? ` (+${allParticipants.length - 5} người)` : ""}`,
        type: mode === "REMIND" ? "warning" : "info",
        category: "plan",
        sender: { name: currentStaffName || hostName },
        targetEmployeeNames: allParticipants,
        targetDept: meetingObj?.category || "all",
        link: { tab: "workspace", subTab: "planner" }
      });
    }

    return { groupChannelId, directSentCount, totalParticipants: allParticipants.length };
  }, [currentStaffName, notifyActivity]);

  // Nút 1 chạm "Nhắc lịch họp ngay" trên thẻ lịch họp
  const handleRemindMeetingNow = useCallback(async (ev: any) => {
    if (!ev) return;
    setSendingMeetingRemindId(ev.id);
    try {
      const res = await handleBroadcastMeetingMessage(ev, "REMIND", {
        sendChat: true,
        createGroup: Boolean(ev.createMeetingGroup || ev.chatChannelId),
        sendBell: true
      });
      const nowLabel = new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
      const updated = weeklySchedule.map((s: any) =>
        s.id === ev.id
          ? {
              ...s,
              lastRemindedAt: nowLabel,
              chatChannelId: res.groupChannelId || s.chatChannelId
            }
          : s
      );
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
      } catch {}
      showToast(
        `🔔 Đã gửi tin nhắn & thông báo nhắc lịch họp "${ev.title}" tới ${res.totalParticipants} thành viên tham dự!`,
        "success"
      );
    } finally {
      setSendingMeetingRemindId(null);
    }
  }, [handleBroadcastMeetingMessage, weeklySchedule, showToast]);

  // Tự động kiểm tra và nhắc lịch họp trước giờ diễn ra (15p / 30p / 60p / 1 ngày)
  useEffect(() => {
    const checkUpcomingMeetings = () => {
      if (!Array.isArray(weeklySchedule) || weeklySchedule.length === 0) return;
      const todayIso = todayVN();
      const now = new Date();
      let remindedKeys: string[] = [];
      try {
        const raw = typeof window !== "undefined" ? localStorage.getItem("unified_auto_reminded_meetings") : null;
        if (raw) remindedKeys = JSON.parse(raw);
      } catch {}

      weeklySchedule.forEach((s: any) => {
        const isMeeting = s.eventType === "MEETING" || String(s.title || "").toLowerCase().includes("họp");
        const remindMins = s.reminderMinutes !== undefined ? Number(s.reminderMinutes) : (isMeeting ? 30 : 0);
        if (!isMeeting || remindMins <= 0) return;

        const sDate = s.date ? String(s.date).slice(0, 10) : "";
        if (!sDate) return;

        const timeMatch = String(s.time || "08:30").match(/(\d{1,2})[:h](\d{2})?/i);
        const hh = timeMatch ? Number(timeMatch[1]) : 8;
        const mm = timeMatch && timeMatch[2] ? Number(timeMatch[2]) : 30;
        const meetingStart = new Date(`${sDate}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`);
        if (isNaN(meetingStart.getTime())) return;

        const diffMins = (meetingStart.getTime() - now.getTime()) / 60000;
        const remindKey = `${s.id || s.title}-${sDate}-${remindMins}`;

        if (diffMins > 0 && diffMins <= remindMins && !remindedKeys.includes(remindKey)) {
          remindedKeys.push(remindKey);
          try {
            if (typeof window !== "undefined") {
              localStorage.setItem("unified_auto_reminded_meetings", JSON.stringify(remindedKeys.slice(-100)));
            }
          } catch {}

          const actors = String(s.actor || "").split(/[,;\n]+/).map((a: string) => a.trim()).filter(Boolean);
          const coActors = Array.isArray(s.coActors) ? s.coActors : [];
          const allMems = [...actors, ...coActors];
          const isMeParticipant = !currentStaffName || allMems.some((m: string) => sameStaffName(m, currentStaffName));

          if (isMeParticipant) {
            showToast(
              `🔔 [NHẮC LỊCH HỌP] "${s.title}" sẽ bắt đầu sau ${Math.max(1, Math.round(diffMins))} phút (${s.time}) tại ${s.location || "Phòng họp"}!`,
              "info"
            );
          }

          // Nếu người đang mở ứng dụng là Chủ trì cuộc họp, tự động phát tin nhắn nhắc họp
          if (actors[0] && currentStaffName && sameStaffName(actors[0], currentStaffName) && sDate === todayIso) {
            handleBroadcastMeetingMessage(s, "REMIND", {
              sendChat: true,
              createGroup: Boolean(s.createMeetingGroup || s.chatChannelId),
              sendBell: true
            });
          }
        }
      });
    };

    const timer = setInterval(checkUpcomingMeetings, 60000);
    const initTimer = setTimeout(checkUpcomingMeetings, 3500);
    return () => {
      clearInterval(timer);
      clearTimeout(initTimer);
    };
  }, [weeklySchedule, currentStaffName, showToast, handleBroadcastMeetingMessage]);

  // Handle Save Weekly Schedule Item / Meeting (Hỗ trợ Lịch Công Tác & Lịch Họp + Chọn thành viên tham dự + Nhắn tin thông báo họp + Nhắc lịch họp)
  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduleForm.title.trim()) {
      showToast("Vui lòng nhập tiêu đề lịch họp / nội dung công tác hoặc chọn từ công việc đang có", "error");
      return;
    }

    const getDayNameFromIso = (isoStr: string) => {
      const idx = (new Date(isoStr + "T00:00:00").getDay() + 6) % 7;
      return ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"][idx] || "Thứ 2";
    };

    const startIso = scheduleForm.date || todayVN();
    const endIso = scheduleForm.dateMode === "RANGE" && scheduleForm.endDate && scheduleForm.endDate >= startIso
      ? scheduleForm.endDate
      : startIso;

    // Xây dựng danh sách các ngày cần tạo lịch
    let targetIsoDates: string[] = [startIso];
    if (scheduleForm.dateMode === "MULTI_DAYS" && Array.isArray(scheduleForm.selectedDates) && scheduleForm.selectedDates.length > 0) {
      targetIsoDates = Array.from(new Set(scheduleForm.selectedDates)).sort();
    } else if (scheduleForm.dateMode === "RANGE" && endIso > startIso) {
      const list: string[] = [];
      const cur = new Date(startIso + "T00:00:00");
      const last = new Date(endIso + "T00:00:00");
      let guard = 0;
      while (cur <= last && guard < 31) {
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, "0");
        const d = String(cur.getDate()).padStart(2, "0");
        list.push(`${y}-${m}-${d}`);
        cur.setDate(cur.getDate() + 1);
        guard++;
      }
      if (list.length > 0) targetIsoDates = list;
    }

    const isMeeting = scheduleForm.eventType === "MEETING";
    const cleanActor = scheduleForm.actor || currentStaffName || "Nhân sự";
    const coActorsList = Array.isArray(scheduleForm.coActors)
      ? scheduleForm.coActors.filter((c) => Boolean(c) && !sameStaffName(c, cleanActor))
      : [];
    const combinedActorDisplay = coActorsList.length > 0
      ? `${cleanActor}, ${coActorsList.join(", ")}`
      : cleanActor;
    const linkedCodes = Array.isArray(scheduleForm.linkedTaskCodes) ? scheduleForm.linkedTaskCodes.filter(Boolean) : [];

    // Nếu người dùng tích chọn "Đồng thời tạo Nhiệm vụ (Task) mới giao cho nhân sự này"
    if (scheduleForm.autoCreateTask && !editingScheduleId) {
      try {
        const taskRes = await fetch("/api/workflows?action=task", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: scheduleForm.title.trim(),
            department: scheduleForm.category || "Kinh Doanh",
            task_category: isMeeting ? "Lịch họp & Điều phối" : "Kế hoạch công tác tuần",
            assignee_name: combinedActorDisplay,
            customer_name: scheduleForm.location || "",
            priority: isMeeting ? "HIGH" : "MEDIUM",
            status: "TODO",
            deadline: targetIsoDates[targetIsoDates.length - 1] || startIso,
            description: `${isMeeting ? "Tạo từ Lịch họp" : "Tự động tạo từ Lịch công tác tuần"} (${scheduleForm.time}) tại ${scheduleForm.location || "Công ty"}${scheduleForm.meetingAgenda ? `\nNội dung họp: ${scheduleForm.meetingAgenda}` : ""}`
          })
        });
        const taskData = await taskRes.json();
        if (taskData?.task?.task_code && !linkedCodes.includes(taskData.task.task_code)) {
          linkedCodes.push(taskData.task.task_code);
        }
        fetchData();
      } catch (err) {
        console.warn("Auto-create task from schedule warning:", err);
      }
    }

    const wasEditing = editingScheduleId !== null;
    const baseId = editingScheduleId || Date.now();
    let createdItems = targetIsoDates.map((isoDate, idx) => ({
      id: wasEditing && idx === 0 ? editingScheduleId : baseId + idx,
      day: getDayNameFromIso(isoDate),
      date: isoDate,
      endDate: scheduleForm.dateMode === "RANGE" ? endIso : isoDate,
      time: scheduleForm.time || "08:30 - 11:30",
      category: scheduleForm.category,
      title: scheduleForm.title.trim(),
      actor: combinedActorDisplay,
      coActors: coActorsList,
      location: scheduleForm.location,
      linkedTaskCodes: linkedCodes,
      eventType: scheduleForm.eventType || "WORK",
      meetingAgenda: scheduleForm.meetingAgenda || "",
      meetingLink: scheduleForm.meetingLink || "",
      sendChatNotify: scheduleForm.sendChatNotify !== false,
      createMeetingGroup: Boolean(scheduleForm.createMeetingGroup),
      sendBellNotify: scheduleForm.sendBellNotify !== false,
      reminderMinutes: scheduleForm.reminderMinutes !== undefined ? Number(scheduleForm.reminderMinutes) : 30,
      customNotifyMessage: scheduleForm.customNotifyMessage || "",
      chatChannelId: scheduleForm.chatChannelId,
      lastRemindedAt: scheduleForm.lastRemindedAt,
      attachments: scheduleForm.attachments || []
    }));

    // Nếu là Lịch Họp (hoặc bật gửi tin nhắn thông báo), phát thông báo qua Chat + Chuông tới các thành viên tham dự
    if (isMeeting && (scheduleForm.sendChatNotify || scheduleForm.sendBellNotify)) {
      const broadcastRes = await handleBroadcastMeetingMessage(createdItems[0], "INVITE", {
        sendChat: Boolean(scheduleForm.sendChatNotify),
        createGroup: Boolean(scheduleForm.createMeetingGroup),
        sendBell: Boolean(scheduleForm.sendBellNotify)
      });
      if (broadcastRes.groupChannelId) {
        createdItems = createdItems.map((it) => ({
          ...it,
          chatChannelId: broadcastRes.groupChannelId
        }));
      }
    }

    const updatedRaw = wasEditing
      ? [
          ...weeklySchedule.map((s) => (s.id === editingScheduleId ? { ...s, ...createdItems[0] } : s)),
          ...createdItems.slice(1)
        ]
      : [...weeklySchedule, ...createdItems];
    const updated = dedupeWeeklySchedules(updatedRaw);
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

    const firstDayName = getDayNameFromIso(targetIsoDates[0]);
    const firstDateLabel = `${targetIsoDates[0].slice(8, 10)}/${targetIsoDates[0].slice(5, 7)}`;
    const rangeSummary = targetIsoDates.length > 1
      ? `${targetIsoDates.length} ngày (${firstDateLabel} → ${targetIsoDates[targetIsoDates.length - 1].slice(8, 10)}/${targetIsoDates[targetIsoDates.length - 1].slice(5, 7)})`
      : `${firstDayName} ${firstDateLabel}`;

    const totalAttendeesCount = 1 + coActorsList.length;
    showToast(
      isMeeting
        ? `🎥 Đã ${wasEditing ? "cập nhật" : "tạo"} lịch họp (${rangeSummary}) & gửi thông báo tới ${totalAttendeesCount} thành viên tham dự!`
        : wasEditing
        ? `Đã cập nhật lịch công tác (${rangeSummary})`
        : `Đã thêm lịch công tác vào ${rangeSummary}!`,
      "success"
    );
    setIsScheduleModalOpen(false);
    if (wasEditing) {
      setScheduleForm((prev) => ({ ...prev, title: "", linkedTaskCodes: [], attachments: [] }));
      return;
    }

    // Nếu là lịch công tác thường (không phải lịch họp đã gửi broadcast ở trên), gửi Activity Notification
    if (!isMeeting) {
      const scheduleActors = combinedActorDisplay
        ? combinedActorDisplay.split(/[,;\n]+/).map((s: string) => s.trim()).filter(Boolean)
        : [];
      notifyActivity({
        title: "Lịch Công Tác / Điều Phối Tuần Mới",
        message: `${currentStaffName} đã lên lịch "${scheduleForm.title}" vào ${rangeSummary} (${scheduleForm.time}) tại ${scheduleForm.location || "Công ty"}.`,
        type: "info",
        category: "plan",
        sender: { name: currentStaffName },
        targetEmployeeNames: scheduleActors,
        targetDept: scheduleForm.category,
        link: { tab: "workspace", subTab: "planner" }
      });
    }

    setScheduleForm((prev) => ({ ...prev, title: "", linkedTaskCodes: [], autoCreateTask: false, attachments: [] }));
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

  // Open Create Thematic / Cross-Department Project Modal
  const openCreateThematicModal = (deptOverride?: string) => {
    setEditingThematicId(null);
    const targetDept = deptOverride || (selectedDept === "all" ? "Liên Phòng Ban" : selectedDept);
    const existingCount = labProjects.length + 1;
    const newId = `DA-${existingCount < 10 ? "0" + existingCount : existingCount}`;
    const defaultPartDepts = targetDept === "Liên Phòng Ban"
      ? (DEPARTMENTS.filter((d) => d.id !== "all").slice(0, 4).map((d) => d.id))
      : [targetDept];
    const defaultLead = selectedAssignee !== "all" && selectedAssignee !== "__UNASSIGNED__"
      ? selectedAssignee
      : (departmentStaffList[0]?.full_name || currentStaffName);
    const defaultDue = toVNDateString(new Date(Date.now() + 14 * 86400000));

    const customStarterStages = [
      {
        id: `stg-${Date.now()}-0`,
        name: "",
        dept: defaultPartDepts[0] || "Kinh Doanh",
        depts: defaultPartDepts.length > 0 ? defaultPartDepts : ["Kinh Doanh"],
        due: defaultDue,
        assignee: defaultLead,
        status: "pending" as const,
        estimatedDays: 3,
        tasks: [
          {
            id: `stgtask-${Date.now()}-0-0`,
            title: "",
            dept: defaultPartDepts[0] || "Kinh Doanh",
            assignee: defaultLead,
            due: defaultDue,
            status: "pending" as const
          }
        ]
      }
    ];

    setLabProjectForm({
      id: newId,
      name: "",
      dept: targetDept,
      participatingDepts: defaultPartDepts,
      customerOrRef: "",
      typeId: "custom_project",
      typeName: "Dự án / Nhóm công việc tùy chỉnh",
      lead: defaultLead,
      collaborators: [],
      startDate: todayVN(),
      endDate: defaultDue,
      slot: "Toàn thời gian (Theo tiến trình)",
      priority: "Cao",
      status: "Active",
      tasksCount: 1,
      budget: "",
      description: "",
      stages: customStarterStages
    });
    setIsLabProjectModalOpen(true);
  };

  // Switch to Custom Arbitrary Project inside Modal
  const handleSelectCustomProjectType = () => {
    const existingCount = labProjects.length + 1;
    const defaultPartDepts = Array.isArray(labProjectForm.participatingDepts) && labProjectForm.participatingDepts.length > 0
      ? labProjectForm.participatingDepts
      : (labProjectForm.dept === "Liên Phòng Ban"
          ? DEPARTMENTS.filter((d) => d.id !== "all").slice(0, 4).map((d) => d.id)
          : [labProjectForm.dept]);
    const blankStages = [
      {
        id: `stg-${Date.now()}-0`,
        name: "",
        dept: defaultPartDepts[0] || "Kinh Doanh",
        depts: defaultPartDepts.length > 0 ? defaultPartDepts : ["Kinh Doanh"],
        due: labProjectForm.endDate || todayVN(),
        assignee: labProjectForm.lead || "",
        status: "pending" as const,
        estimatedDays: 3,
        tasks: [
          {
            id: `stgtask-${Date.now()}-0-0`,
            title: "",
            dept: defaultPartDepts[0] || "Kinh Doanh",
            assignee: labProjectForm.lead || "",
            due: labProjectForm.endDate || todayVN(),
            status: "pending" as const
          }
        ]
      }
    ];

    setLabProjectForm((prev) => ({
      ...prev,
      id: prev.id && !prev.id.startsWith("DA-") ? `DA-${existingCount < 10 ? "0" + existingCount : existingCount}` : prev.id,
      typeId: "custom_project",
      typeName: "Dự án / Nhóm công việc tùy chỉnh",
      description: prev.typeId !== "custom_project" ? "" : prev.description,
      stages: prev.typeId !== "custom_project" ? blankStages : (Array.isArray(prev.stages) && prev.stages.length > 0 ? prev.stages : blankStages),
      tasksCount: prev.typeId !== "custom_project" ? 1 : (prev.stages?.length || 1)
    }));
  };

  // Open Edit Thematic Project Modal
  const openEditThematicModal = (prj: any) => {
    setEditingThematicId(prj.id);
    const derivedDepts = Array.isArray(prj.participatingDepts) && prj.participatingDepts.length > 0
      ? prj.participatingDepts
      : Array.from(new Set([
          ...(prj.dept && prj.dept !== "Liên Phòng Ban" ? [prj.dept] : []),
          ...((prj.stages || []).map((s: any) => s.dept).filter(Boolean))
        ]));
    setLabProjectForm({
      id: prj.id,
      name: prj.name || "",
      dept: prj.dept || "Liên Phòng Ban",
      participatingDepts: derivedDepts,
      customerOrRef: prj.customerOrRef || "",
      typeId: prj.typeId || "custom_project",
      typeName: prj.typeName || "Dự án / Nhóm công việc tùy chỉnh",
      lead: prj.lead || currentStaffName,
      collaborators: prj.collaborators || [],
      startDate: prj.startDate || todayVN(),
      endDate: prj.endDate || todayVN(),
      slot: prj.slot || "Toàn thời gian (Theo tiến trình)",
      priority: prj.priority || "Cao",
      status: prj.status || "Active",
      tasksCount: prj.tasksCount || (prj.stages || []).length || 0,
      budget: prj.budget || "",
      description: prj.description || "",
      stages: (prj.stages || []).map((s: any, idx: number) => {
        const sDept = s.dept || (prj.dept !== "Liên Phòng Ban" ? prj.dept : (derivedDepts[0] || "Kinh Doanh"));
        const sDepts = Array.isArray(s.depts) && s.depts.length > 0 ? s.depts : [sDept];
        const sDue = s.due || prj.endDate || todayVN();
        return {
          ...s,
          dept: sDepts[0] || sDept,
          depts: sDepts,
          due: sDue,
          assignee: s.assignee || "",
          tasks: Array.isArray(s.tasks) && s.tasks.length > 0
            ? s.tasks
            : [
                {
                  id: `stgtask-${prj.id}-${idx}-0`,
                  title: s.name || `Thực hiện giai đoạn ${idx + 1}`,
                  dept: sDepts[0] || sDept,
                  assignee: s.assignee || prj.lead || "",
                  due: sDue,
                  status: s.status || "pending"
                }
              ]
        };
      })
    });
    setIsLabProjectModalOpen(true);
  };

  // Handle Changing Department inside Modal
  const handleThematicDeptChange = (newDept: string) => {
    const defaultPartDepts = newDept === "Liên Phòng Ban"
      ? DEPARTMENTS.filter((d) => d.id !== "all").slice(0, 4).map((d) => d.id)
      : [newDept];
    if (labProjectForm.typeId === "custom_project") {
      setLabProjectForm((prev) => ({
        ...prev,
        dept: newDept,
        participatingDepts: defaultPartDepts
      }));
      return;
    }
    const availableTypes = DEPARTMENT_THEMATIC_TYPES[newDept] || DEPARTMENT_THEMATIC_TYPES["Liên Phòng Ban"] || DEPARTMENT_THEMATIC_TYPES["Application"] || [];
    const firstType = availableTypes[0];
    const prefix = firstType?.codePrefix || "DA";
    const existingCount = labProjects.filter((p: any) => p.dept === newDept).length + 1;
    const newId = `${prefix}-${existingCount < 10 ? "0" + existingCount : existingCount}`;
    const partDepts = firstType?.participatingDepts && firstType.participatingDepts.length > 0
      ? firstType.participatingDepts
      : defaultPartDepts;
    const defaultStages = (firstType?.defaultStages || []).map((s, idx) => {
      const stgDept = s.dept || (newDept === "Liên Phòng Ban" ? (partDepts[idx] || partDepts[0] || "Kinh Doanh") : newDept);
      const stgDue = toVNDateString(new Date(Date.now() + ((idx + 1) * (s.estimatedDays || 3)) * 86400000));
      return {
        id: `stg-${Date.now()}-${idx}`,
        name: s.name,
        dept: stgDept,
        depts: [stgDept],
        due: stgDue,
        assignee: "",
        status: "pending" as const,
        estimatedDays: s.estimatedDays,
        tasks: [
          {
            id: `stgtask-${Date.now()}-${idx}-0`,
            title: s.name,
            dept: stgDept,
            assignee: "",
            due: stgDue,
            status: "pending" as const
          }
        ]
      };
    });
    setLabProjectForm(prev => ({
      ...prev,
      dept: newDept,
      participatingDepts: partDepts,
      id: newId,
      typeId: firstType?.id || "custom_project",
      typeName: firstType?.name || "Dự án / Nhóm công việc tùy chỉnh",
      description: firstType?.sampleObjectives || "",
      stages: defaultStages,
      tasksCount: defaultStages.length
    }));
  };

  // Handle Changing Thematic Type inside Modal
  const handleThematicTypeChange = (typeDef: ThematicTypeDefinition) => {
    const existingCount = labProjects.filter((p: any) => p.dept === labProjectForm.dept).length + 1;
    const newId = `${typeDef.codePrefix}-${existingCount < 10 ? "0" + existingCount : existingCount}`;
    const defaultPartDepts = typeDef.participatingDepts && typeDef.participatingDepts.length > 0
      ? typeDef.participatingDepts
      : (labProjectForm.dept === "Liên Phòng Ban" ? ["Kinh Doanh", "Application", "Cung Ứng", "Kho & Vận Hành"] : [labProjectForm.dept]);
    const defaultStages = (typeDef.defaultStages || []).map((s, idx) => {
      const stgDept = s.dept || (labProjectForm.dept === "Liên Phòng Ban" ? (defaultPartDepts[idx] || defaultPartDepts[0] || "Kinh Doanh") : labProjectForm.dept);
      const stgDue = toVNDateString(new Date(Date.now() + ((idx + 1) * (s.estimatedDays || 3)) * 86400000));
      return {
        id: `stg-${Date.now()}-${idx}`,
        name: s.name,
        dept: stgDept,
        depts: [stgDept],
        due: stgDue,
        assignee: "",
        status: "pending" as const,
        estimatedDays: s.estimatedDays,
        tasks: [
          {
            id: `stgtask-${Date.now()}-${idx}-0`,
            title: s.name,
            dept: stgDept,
            assignee: "",
            due: stgDue,
            status: "pending" as const
          }
        ]
      };
    });
    setLabProjectForm(prev => ({
      ...prev,
      typeId: typeDef.id,
      typeName: typeDef.name,
      participatingDepts: defaultPartDepts,
      id: newId,
      description: typeDef.sampleObjectives,
      stages: defaultStages,
      tasksCount: defaultStages.length
    }));
  };

  // Đồng bộ các công việc trong từng giai đoạn của Dự án sang Bảng Công Việc (company_tasks) theo đúng Phòng ban & Người thực hiện
  const syncThematicProjectTasks = async (prj: any) => {
    const stages = Array.isArray(prj.stages) ? prj.stages : [];
    const prjId = String(prj.id || "").trim();
    if (!prjId || stages.length === 0) return;

    const prioMap: Record<string, string> = { "Cao": "HIGH", "Trung bình": "MEDIUM", "Bình thường": "LOW" };
    const taskPriority = prioMap[prj.priority] || "HIGH";

    for (let idx = 0; idx < stages.length; idx++) {
      const stg = stages[idx];
      const stageDept = stg.dept || (prj.dept !== "Liên Phòng Ban" ? prj.dept : (prj.participatingDepts?.[0] || "Kinh Doanh"));
      const subTasks = Array.isArray(stg.tasks) && stg.tasks.length > 0 ? stg.tasks : null;

      if (subTasks) {
        for (let tIdx = 0; tIdx < subTasks.length; tIdx++) {
          const stTask = subTasks[tIdx];
          if (!stTask.title || !String(stTask.title).trim()) continue;
          const subTaskCode = `TSK-${prjId}-S${idx + 1}-T${tIdx + 1}`;
          const existingTask = tasks.find((t: any) => String(t.task_code || "").toUpperCase() === subTaskCode.toUpperCase());
          const mappedStatus = stTask.status === "completed" || stg.status === "completed"
            ? "DONE"
            : stTask.status === "in_progress" || stg.status === "in_progress"
            ? "IN_PROGRESS"
            : (idx === 0 && tIdx === 0 ? "IN_PROGRESS" : "TODO");
          const itemDept = stTask.dept || stageDept;
          const payload = {
            id: existingTask?.id || null,
            task_code: subTaskCode,
            title: `[${prjId} • GĐ${idx + 1}] ${stTask.title} — ${prj.name}`,
            department: itemDept,
            task_category: prj.typeName || "Dự án liên phòng ban",
            assignee_name: stTask.assignee || stg.assignee || prj.lead || currentStaffName,
            customer_name: prj.customerOrRef || existingTask?.customer_name || "",
            priority: taskPriority,
            status: existingTask?.status === "DONE" && (stTask.status === "completed" || stg.status === "completed") ? "DONE" : mappedStatus,
            deadline: stTask.due || stg.due || prj.endDate || todayVN(),
            description: `Thuộc Dự án [${prjId}]: ${prj.name}
Giai đoạn ${idx + 1}: ${stg.name}
Công việc: ${stTask.title}${prj.customerOrRef ? `
Khách hàng / Mã liên kết: ${prj.customerOrRef}` : ""}
Phòng ban tham gia: ${(prj.participatingDepts || [itemDept]).join(", ")}`,
            related_workflow_code: prjId,
            result: existingTask?.result || (stTask.status === "completed" ? "Đã hoàn thành công việc trong giai đoạn dự án" : ""),
            attachments: existingTask?.attachments || []
          };
          try {
            await fetch("/api/workflows?action=task", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            });
          } catch {}
        }
      } else {
        const stageTaskCode = `TSK-${prjId}-S${idx + 1}`;
        const existingTask = tasks.find((t: any) => String(t.task_code || "").toUpperCase() === stageTaskCode.toUpperCase());
        const taskStatus = stg.status === "completed" ? "DONE" : stg.status === "in_progress" ? "IN_PROGRESS" : (idx === 0 ? "IN_PROGRESS" : "TODO");
        const payload = {
          id: existingTask?.id || null,
          task_code: stageTaskCode,
          title: `[${prjId} • GĐ${idx + 1}/${stages.length}] ${stg.name} — ${prj.name}`,
          department: stageDept,
          task_category: prj.typeName || "Dự án liên phòng ban",
          assignee_name: stg.assignee || prj.lead || currentStaffName,
          customer_name: prj.customerOrRef || existingTask?.customer_name || "",
          priority: taskPriority,
          status: existingTask?.status === "DONE" && stg.status === "completed" ? "DONE" : taskStatus,
          deadline: stg.due || prj.endDate || todayVN(),
          description: `Thuộc Dự án / Chuyên đề [${prjId}]: ${prj.name}${prj.customerOrRef ? `
Khách hàng / Mã liên kết: ${prj.customerOrRef}` : ""}
Phòng ban tham gia: ${(prj.participatingDepts || [stageDept]).join(", ")}
Mục tiêu: ${prj.description || ""}
Giai đoạn ${idx + 1} (${stageDept}): ${stg.name}`,
          related_workflow_code: prjId,
          result: existingTask?.result || (stg.status === "completed" ? "Đã nghiệm thu giai đoạn dự án" : ""),
          attachments: existingTask?.attachments || []
        };
        try {
          await fetch("/api/workflows?action=task", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
        } catch {}
      }
    }
  };

  // Handle Save / Update Thematic Project
  const handleSaveLabProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!labProjectForm.name.trim()) {
      showToast("Vui lòng nhập tên dự án / nhóm công việc", "error");
      return;
    }
    const stagesList = (labProjectForm.stages || []).map((stg: any, sIdx: number) => {
      const subTasks = Array.isArray(stg.tasks) ? stg.tasks.filter((t: any) => t && String(t.title || "").trim()) : [];
      let stgStatus = stg.status;
      if (subTasks.length > 0) {
        const allDone = subTasks.every((t: any) => t.status === "completed");
        const anyDoneOrProg = subTasks.some((t: any) => t.status === "completed" || t.status === "in_progress");
        if (allDone) stgStatus = "completed";
        else if (anyDoneOrProg && stgStatus === "pending") stgStatus = "in_progress";
      }
      return {
        ...stg,
        name: String(stg.name || "").trim() || `Bước ${sIdx + 1}`,
        status: stgStatus,
        tasks: subTasks
      };
    });
    const stageDepts = stagesList.flatMap((s: any) => [
      s.dept,
      ...(Array.isArray(s.depts) ? s.depts : []),
      ...(Array.isArray(s.tasks) ? s.tasks.map((t: any) => t.dept) : [])
    ]).filter(Boolean);
    const mergedPartDepts = Array.from(new Set([
      ...(labProjectForm.dept && labProjectForm.dept !== "Liên Phòng Ban" ? [labProjectForm.dept] : []),
      ...(labProjectForm.participatingDepts || []),
      ...stageDepts
    ]));
    const stageAssignees = stagesList.flatMap((s: any) => [
      s.assignee,
      ...(Array.isArray(s.tasks) ? s.tasks.map((t: any) => t.assignee) : [])
    ]).filter(Boolean);
    const mergedCollaborators = Array.from(new Set([
      ...(labProjectForm.collaborators || []),
      ...stageAssignees
    ])).filter((c) => c && !sameStaffName(c, labProjectForm.lead));

    const totalSubTasksCount = stagesList.reduce((acc: number, s: any) => acc + (Array.isArray(s.tasks) && s.tasks.length > 0 ? s.tasks.length : 1), 0);

    const projectData = {
      id: labProjectForm.id || `DA-0${labProjects.length + 1}`,
      name: labProjectForm.name.trim(),
      dept: mergedPartDepts.length > 1 && labProjectForm.dept === "Liên Phòng Ban" ? "Liên Phòng Ban" : labProjectForm.dept,
      participatingDepts: mergedPartDepts,
      customerOrRef: (labProjectForm.customerOrRef || "").trim(),
      typeId: labProjectForm.typeId || "custom_project",
      typeName: (labProjectForm.typeName || "Dự án / Nhóm công việc tùy chỉnh").trim(),
      lead: labProjectForm.lead || currentStaffName,
      collaborators: mergedCollaborators,
      startDate: labProjectForm.startDate,
      endDate: labProjectForm.endDate,
      slot: labProjectForm.slot,
      priority: labProjectForm.priority,
      status: labProjectForm.status || "Active",
      tasksCount: Math.max(totalSubTasksCount, labProjectForm.tasksCount || 0),
      budget: labProjectForm.budget,
      description: labProjectForm.description,
      stages: stagesList
    };

    let updated: any[];
    if (editingThematicId) {
      updated = labProjects.map(p => p.id === editingThematicId ? { ...p, ...projectData } : p);
      showToast(`Đã cập nhật dự án & đồng bộ ${totalSubTasksCount} công việc sang Bảng Công Việc!`, "success");
      notifyActivity({
        title: "Cập nhật Dự án / Nhóm công việc",
        message: `${currentStaffName} đã cập nhật dự án [${projectData.id}] "${projectData.name}".`,
        type: "info",
        category: "plan",
        sender: { name: currentStaffName },
        targetEmployeeNames: [projectData.lead, ...(projectData.collaborators || [])].filter(Boolean),
        targetDept: projectData.dept,
        link: { tab: "workspace", subTab: "projects" }
      });
    } else {
      updated = [...labProjects, projectData];
      showToast(`Đã tạo dự án mới & phân bổ ${totalSubTasksCount} công việc về các phòng ban!`, "success");
      notifyActivity({
        title: "Dự án / Nhóm công việc mới",
        message: `${currentStaffName} đã khởi tạo dự án [${projectData.id}] "${projectData.name}" do ${projectData.lead} chủ trì.`,
        type: "success",
        category: "plan",
        sender: { name: currentStaffName },
        targetEmployeeNames: [projectData.lead, ...(projectData.collaborators || [])].filter(Boolean),
        targetDept: projectData.dept,
        link: { tab: "workspace", subTab: "projects" }
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
      await syncThematicProjectTasks(projectData);
      fetchData();
    } catch (err) {
      console.warn("Error saving thematic projects:", err);
    }
    setIsLabProjectModalOpen(false);
    setEditingThematicId(null);
  };

  // Toggle an individual sub-task inside a Stage directly from the Project Card
  const handleToggleStageTask = async (projectId: string, stageId: string, taskId: string) => {
    const targetPrj = labProjects.find((p) => p.id === projectId);
    if (!targetPrj) return;

    let updatedProject: any = null;
    const updated = labProjects.map((p) => {
      if (p.id !== projectId) return p;
      const updatedStages = (p.stages || []).map((stg: any) => {
        if (stg.id !== stageId) return stg;
        const currentTasks = Array.isArray(stg.tasks) ? stg.tasks : [];
        const nextTasks = currentTasks.map((t: any) => {
          if (t.id !== taskId) return t;
          const nextStatus = t.status === "completed" ? "pending" : "completed";
          return { ...t, status: nextStatus };
        });
        const allTasksDone = nextTasks.length > 0 && nextTasks.every((t: any) => t.status === "completed");
        const anyTaskActive = nextTasks.some((t: any) => t.status === "completed" || t.status === "in_progress");
        const nextStageStatus = allTasksDone ? "completed" : anyTaskActive ? "in_progress" : "pending";
        return { ...stg, tasks: nextTasks, status: nextStageStatus };
      });
      const allCompleted = updatedStages.length > 0 && updatedStages.every((s: any) => s.status === "completed");
      const anyCompleted = updatedStages.some((s: any) => s.status === "completed" || s.status === "in_progress");
      let newPrjStatus = p.status;
      if (allCompleted) newPrjStatus = "Completed";
      else if (anyCompleted && (p.status === "Planning" || p.status === "Completed")) newPrjStatus = "Active";
      updatedProject = { ...p, stages: updatedStages, status: newPrjStatus };
      return updatedProject;
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
      if (updatedProject) {
        await syncThematicProjectTasks(updatedProject);
        fetchData();
      }
    } catch (err) {
      console.warn("Error toggling stage task:", err);
    }
    showToast("Đã cập nhật trạng thái công việc & đồng bộ Bảng Công Việc!", "info");
  };

  // Quick-add a new sub-task directly into a Stage from the Project Card
  const handleAddQuickStageTask = async (projectId: string, stageId: string) => {
    if (!quickStageTaskForm.title.trim()) {
      showToast("Vui lòng nhập tên công việc cần thêm vào giai đoạn", "error");
      return;
    }
    let updatedProject: any = null;
    const updated = labProjects.map((p) => {
      if (p.id !== projectId) return p;
      const updatedStages = (p.stages || []).map((stg: any) => {
        if (stg.id !== stageId) return stg;
        const existingTasks = Array.isArray(stg.tasks) ? stg.tasks : [];
        const newTask = {
          id: `stgtask-${Date.now()}-${existingTasks.length}`,
          title: quickStageTaskForm.title.trim(),
          dept: quickStageTaskForm.dept || stg.dept || "Kinh Doanh",
          assignee: quickStageTaskForm.assignee.trim(),
          due: quickStageTaskForm.due || p.endDate || todayVN(),
          status: "pending" as const
        };
        const nextTasks = [...existingTasks, newTask];
        const nextStageStatus = stg.status === "completed" ? "in_progress" : stg.status;
        return { ...stg, tasks: nextTasks, status: nextStageStatus };
      });
      const totalSubTasksCount = updatedStages.reduce((acc: number, s: any) => acc + (Array.isArray(s.tasks) && s.tasks.length > 0 ? s.tasks.length : 1), 0);
      const mergedDepts = Array.from(new Set([
        ...(Array.isArray(p.participatingDepts) ? p.participatingDepts : []),
        quickStageTaskForm.dept
      ].filter(Boolean)));
      updatedProject = {
        ...p,
        participatingDepts: mergedDepts,
        tasksCount: Math.max(totalSubTasksCount, p.tasksCount || 0),
        stages: updatedStages
      };
      return updatedProject;
    });

    setLabProjects(updated);
    setQuickTaskStageKey(null);
    setQuickStageTaskForm({ title: "", dept: "Kinh Doanh", assignee: "", due: todayVN() });

    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("unified_thematic_projects", JSON.stringify(updated));
      }
      await fetch("/api/storage?key=unified_thematic_projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated)
      });
      if (updatedProject) {
        await syncThematicProjectTasks(updatedProject);
        fetchData();
      }
    } catch (err) {
      console.warn("Error adding quick stage task:", err);
    }
    showToast("Đã thêm công việc vào giai đoạn & đồng bộ sang Bảng Công Việc!", "success");
  };

  // Delete a sub-task inside a Stage directly from the Project Card
  const handleDeleteStageTask = async (projectId: string, stageId: string, taskId: string) => {
    let updatedProject: any = null;
    const updated = labProjects.map((p) => {
      if (p.id !== projectId) return p;
      const updatedStages = (p.stages || []).map((stg: any) => {
        if (stg.id !== stageId) return stg;
        const nextTasks = (stg.tasks || []).filter((t: any) => t.id !== taskId);
        return { ...stg, tasks: nextTasks };
      });
      updatedProject = { ...p, stages: updatedStages };
      return updatedProject;
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
    } catch {}
    showToast("Đã xóa công việc khỏi giai đoạn", "info");
  };

  // Handle Toggle Stage Completion directly from Project Card or Modal with Regression Guard
  const handleToggleStage = async (projectId: string, stageId: string) => {
    const targetPrj = labProjects.find(p => p.id === projectId);
    const stageIdx = (targetPrj?.stages || []).findIndex((s: any) => s.id === stageId);
    const targetStage = stageIdx >= 0 ? targetPrj?.stages[stageIdx] : null;
    
    // Safety Guard: Chống lùi bước vô ý khi click nhầm vào giai đoạn đã hoàn thành
    if (targetStage?.status === "completed") {
      const confirmReopen = confirm(
        `[CẢNH BÁO LÙI BƯỚC TIẾN TRÌNH]\n\nGiai đoạn "${targetStage.title || targetStage.name || 'này'}" đã được nghiệm thu HOÀN THÀNH.\nBạn có chắc chắn muốn MỞ LẠI (Lùi bước tiến trình về Đang chờ) không?\n\nThao tác này sẽ yêu cầu phải nghiệm thu lại từ đầu!`
      );
      if (!confirmReopen) return;
    }

    const nextStageStatus = targetStage?.status === "completed" ? "pending" : "completed";

    let updatedProject: any = null;
    const updated = labProjects.map(p => {
      if (p.id !== projectId) return p;
      const updatedStages = (p.stages || []).map((stg: any) => {
        if (stg.id !== stageId) return stg;
        const updatedSubTasks = Array.isArray(stg.tasks)
          ? stg.tasks.map((t: any) => ({ ...t, status: nextStageStatus }))
          : [];
        return { ...stg, status: nextStageStatus, tasks: updatedSubTasks };
      });
      const allCompleted = updatedStages.length > 0 && updatedStages.every((s: any) => s.status === "completed");
      const anyCompleted = updatedStages.some((s: any) => s.status === "completed" || s.status === "in_progress");
      let newPrjStatus = p.status;
      if (allCompleted) newPrjStatus = "Completed";
      else if (anyCompleted && p.status === "Planning") newPrjStatus = "Active";
      updatedProject = { ...p, stages: updatedStages, status: newPrjStatus };
      return updatedProject;
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

      if (updatedProject) {
        await syncThematicProjectTasks(updatedProject);
        fetchData();
      }
    } catch (err) {
      console.warn("Error updating thematic stage:", err);
    }
    showToast("Đã cập nhật tiến độ giai đoạn dự án & đồng bộ Bảng Công Việc!", "info");

    const prjAfter = labProjects.find(p => p.id === projectId);
    if (prjAfter) {
      const isNowCompleted = nextStageStatus === "completed";
      notifyActivity({
        title: isNowCompleted ? "Hoàn thành giai đoạn dự án" : "Cập nhật giai đoạn dự án",
        message: `${currentStaffName} đã cập nhật giai đoạn "${targetStage?.name || 'Giai đoạn'}" của dự án "${prjAfter.name}" (${isNowCompleted ? 'Hoàn thành' : 'Đang xử lý'}).`,
        type: isNowCompleted ? "success" : "info",
        category: "plan",
        sender: { name: currentStaffName },
        targetEmployeeNames: [prjAfter.lead, ...(prjAfter.collaborators || [])].filter(Boolean),
        targetDept: prjAfter.dept,
        link: { tab: "workspace", subTab: "projects" }
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
    showToast("Đã xóa dự án thành công", "info");
  };

  // Handle Save Sales Target (Lưu bền vững xuống Database storage)
  const handleSaveSalesTarget = async (e: React.FormEvent) => {
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
      lead: salesTargetForm.lead || currentStaffName,
      description: salesTargetForm.description,
      stage: salesTargetForm.stage
    };
    const updated = [...salesTargets, newTarget];
    setSalesTargets(updated);
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("unified_sales_targets", JSON.stringify(updated));
      }
      await fetch("/api/storage?key=unified_sales_targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated)
      });
    } catch {}
    showToast(`Đã thiết lập mục tiêu cho ${newTarget.customer}!`, "success");
    setIsSalesTargetModalOpen(false);
  };

  const handleDeleteSalesTarget = async (targetId: number | string) => {
    const updated = salesTargets.filter((t: any) => t.id !== targetId);
    setSalesTargets(updated);
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("unified_sales_targets", JSON.stringify(updated));
      }
      await fetch("/api/storage?key=unified_sales_targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated)
      });
    } catch {}
    showToast("Đã xóa mục tiêu doanh số", "info");
  };

  // ==================== HỆ THỐNG ĐỀ XUẤT & PHÊ DUYỆT ĐA CẤP (ENTERPRISE PROPOSALS & APPROVALS) ====================
  const saveProposalsToStorage = async (nextList: ProposalItem[]) => {
    setProposals(nextList);
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("workspace_proposals", JSON.stringify(nextList));
      }
      await fetch("/api/storage?key=workspace_proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextList)
      });
    } catch (err) {
      console.warn("Could not save proposals:", err);
    }
  };

  useEffect(() => {
    if (filteredNotifications && filteredNotifications.length > 0) {
      setProposals((prev) => {
        const rec = reconcileProposalsWithNotifications(prev);
        if (rec.added) {
          try {
            localStorage.setItem("workspace_proposals", JSON.stringify(rec.list));
          } catch {}
          fetch("/api/storage?key=workspace_proposals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(rec.list)
          }).catch(() => {});
          return rec.list;
        }
        return prev;
      });
    }
  }, [filteredNotifications, reconcileProposalsWithNotifications]);

  useEffect(() => {
    if (activeSubTab !== "proposals") return;
    fetch("/api/storage?key=workspace_proposals", { headers: { "x-no-cache": "1" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (Array.isArray(j?.data)) {
          const rec = reconcileProposalsWithNotifications(j.data);
          setProposals(rec.list);
          try {
            localStorage.setItem("workspace_proposals", JSON.stringify(rec.list));
          } catch {}
          if (rec.added) {
            fetch("/api/storage?key=workspace_proposals", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(rec.list)
            }).catch(() => {});
          }
        }
      })
      .catch(() => {});
  }, [activeSubTab, reconcileProposalsWithNotifications]);

  const proposalsWaitingForMeCount = useMemo(() => {
    return (proposals || []).filter((p) =>
      isProposalWaitingForUser(p, currentStaffName, userDept, isDirector, isManager)
    ).length;
  }, [proposals, currentStaffName, userDept, isDirector, isManager]);

  const handleCreateTaskFromProposal = (prop: ProposalItem) => {
    if (!prop) return;
    const defaultDept = prop.requesterDept || (rolePerspective === "manager" ? managerDept : "Kinh Doanh");
    setTaskForm({
      id: null,
      title: `[Thực thi ${prop.proposalCode}] ${prop.title}`,
      department: defaultDept,
      task_category: DEPARTMENT_CATEGORIES[defaultDept]?.[0] || "Chung",
      assignee_name: prop.executorName || currentStaffName,
      customer_name: prop.customerName || "",
      priority: prop.priority === "URGENT" ? "URGENT" : "HIGH",
      status: "TODO",
      deadline: prop.neededByDate || todayVN(),
      description: `Thực thi theo Tờ trình / Đề xuất đã phê duyệt [${prop.proposalCode}] "${prop.title}" (Người đề xuất: ${prop.requesterName} - ${prop.requesterDept}).\n\nNội dung: ${prop.summaryReason}`,
      result: "",
      attachments: Array.isArray(prop.attachments) ? [...prop.attachments] : []
    });
    setActiveSubTab("tasks");
    setIsTaskModalOpen(true);
  };

  // ==================== HỆ THỐNG BAN HÀNH THÔNG BÁO, QUYẾT ĐỊNH & QUY CHẾ (ENTERPRISE ANNOUNCEMENTS) ====================
  const saveAnnouncementsToStorage = async (nextList: any[]) => {
    setAnnouncements(nextList);
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("unified_announcements", JSON.stringify(nextList));
      }
      await fetch("/api/storage?key=unified_announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextList)
      });
    } catch (err) {
      console.warn("Could not save announcements:", err);
    }
  };

  const getDocTypeMeta = (docType: string) => {
    switch (docType) {
      case "DECISION":
        return {
          prefix: "QĐ",
          label: "📜 Quyết định Ban Giám Đốc",
          shortLabel: "📜 QUYẾT ĐỊNH",
          badgeClass: "bg-rose-100 dark:bg-rose-950/90 text-rose-800 dark:text-rose-200 border border-rose-300 dark:border-rose-800"
        };
      case "POLICY":
        return {
          prefix: "QC",
          label: "📘 Quy chế / Quy trình (SOP)",
          shortLabel: "📘 QUY CHẾ / SOP",
          badgeClass: "bg-indigo-100 dark:bg-indigo-950/90 text-indigo-800 dark:text-indigo-200 border border-indigo-300 dark:border-indigo-800"
        };
      case "SALES_POLICY":
        return {
          prefix: "CS",
          label: "💼 Chính sách Kinh doanh & Thưởng",
          shortLabel: "💼 CHÍNH SÁCH KD",
          badgeClass: "bg-emerald-100 dark:bg-emerald-950/90 text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800"
        };
      case "RECOGNITION":
        return {
          prefix: "KT",
          label: "🏆 Khen thưởng & Bổ nhiệm Nhân sự",
          shortLabel: "🏆 VINH DANH / NHÂN SỰ",
          badgeClass: "bg-amber-100 dark:bg-amber-950/90 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-800"
        };
      default:
        return {
          prefix: "TB",
          label: "📢 Thông báo Hành chính / Nội bộ",
          shortLabel: "📢 THÔNG BÁO",
          badgeClass: "bg-blue-100 dark:bg-blue-950/90 text-blue-800 dark:text-blue-200 border border-blue-300 dark:border-blue-800"
        };
    }
  };

  const getTargetStaffForAnnouncement = useCallback(
    (ann: any): Array<{ name: string; dept: string }> => {
      const allStaff = (personnelList || [])
        .map((p: any) => ({
          name: String(p.full_name || p || "").trim(),
          dept: String(p.department || "Nhân sự").trim()
        }))
        .filter((p) => p.name);

      if (!ann || ann.targetScope === "ALL" || !ann.targetScope) {
        return allStaff;
      }
      if (ann.targetScope === "DEPARTMENTS" && Array.isArray(ann.targetDepts) && ann.targetDepts.length > 0) {
        return allStaff.filter((p) =>
          ann.targetDepts.some((d: string) => isSameWorkspaceDept(d, p.dept))
        );
      }
      if (ann.targetScope === "INDIVIDUALS" && Array.isArray(ann.targetStaff) && ann.targetStaff.length > 0) {
        return allStaff.filter((p) =>
          ann.targetStaff.some((s: string) => sameStaffName(s, p.name))
        );
      }
      return allStaff;
    },
    [personnelList]
  );

  const isUserTargetedByAnnouncement = useCallback(
    (ann: any, staffName: string = currentStaffName, staffDept: string = userDept): boolean => {
      if (!ann || ann.targetScope === "ALL" || !ann.targetScope) return true;
      if (sameStaffName(ann.issuerName || "", staffName)) return true;
      if (ann.targetScope === "DEPARTMENTS" && Array.isArray(ann.targetDepts)) {
        return ann.targetDepts.some((d: string) => isSameWorkspaceDept(d, staffDept));
      }
      if (ann.targetScope === "INDIVIDUALS" && Array.isArray(ann.targetStaff)) {
        return ann.targetStaff.some((s: string) => sameStaffName(s, staffName));
      }
      return true;
    },
    [currentStaffName, userDept]
  );

  const hasUserAcknowledgedAnnouncement = useCallback(
    (ann: any, staffName: string = currentStaffName): boolean => {
      const ackList = Array.isArray(ann?.acknowledgedBy) ? ann.acknowledgedBy : [];
      return ackList.some((a: any) => sameStaffName(a?.name || a, staffName));
    },
    [currentStaffName]
  );

  // Số lượng văn bản/quyết định yêu cầu xác nhận mà user hiện tại chưa bấm "Đã đọc"
  const unacknowledgedAnnouncementsForMe = useMemo(() => {
    return (announcements || []).filter((ann: any) => {
      if (ann.requireAck === false) return false;
      if (!isUserTargetedByAnnouncement(ann)) return false;
      return !hasUserAcknowledgedAnnouncement(ann);
    });
  }, [announcements, isUserTargetedByAnnouncement, hasUserAcknowledgedAnnouncement]);

  const generateNextDocCode = (docType: "DECISION" | "ANNOUNCEMENT" | "POLICY" | "SALES_POLICY" | "RECOGNITION") => {
    const meta = getDocTypeMeta(docType);
    const year = new Date().getFullYear();
    const sameTypeCount = (announcements || []).filter((a: any) => a.docType === docType).length + 1;
    return `${meta.prefix}-${year}/${String(sameTypeCount).padStart(3, "0")}`;
  };

  const openCreateAnnouncementModal = (defaultType: "DECISION" | "ANNOUNCEMENT" | "POLICY" | "SALES_POLICY" | "RECOGNITION" = "DECISION") => {
    setEditingAnnouncementId(null);
    const defaultIssuerRole = isDirector ? "Ban Giám Đốc" : isManager ? `Trưởng bộ phận ${managerDept}` : "Cán bộ Ban hành";
    const defaultIssuerDept = isDirector ? "Ban Giám Đốc" : managerDept;
    setAnnouncementForm({
      docCode: generateNextDocCode(defaultType),
      docType: defaultType,
      priority: defaultType === "DECISION" ? "URGENT" : "IMPORTANT",
      pinned: defaultType === "DECISION",
      title: "",
      summary: "",
      content: "",
      issuerName: currentStaffName,
      issuerRole: defaultIssuerRole,
      issuerDept: defaultIssuerDept,
      targetScope: isDirector ? "ALL" : "DEPARTMENTS",
      targetDepts: isDirector ? [] : [managerDept],
      targetStaff: [],
      issueDate: todayVN(),
      effectiveDate: todayVN(),
      requireAck: true,
      sendChatNotify: true,
      sendBellNotify: true,
      attachments: []
    });
    setIsAnnouncementModalOpen(true);
  };

  const openEditAnnouncementModal = (ann: any) => {
    setEditingAnnouncementId(ann.id);
    setAnnouncementForm({
      docCode: ann.docCode || generateNextDocCode(ann.docType || "ANNOUNCEMENT"),
      docType: ann.docType || "ANNOUNCEMENT",
      priority: ann.priority || "IMPORTANT",
      pinned: Boolean(ann.pinned),
      title: ann.title || "",
      summary: ann.summary || "",
      content: ann.content || "",
      issuerName: ann.issuerName || currentStaffName,
      issuerRole: ann.issuerRole || "Ban Giám Đốc",
      issuerDept: ann.issuerDept || "Ban Giám Đốc",
      targetScope: ann.targetScope || "ALL",
      targetDepts: Array.isArray(ann.targetDepts) ? ann.targetDepts : [],
      targetStaff: Array.isArray(ann.targetStaff) ? ann.targetStaff : [],
      issueDate: ann.issueDate || todayVN(),
      effectiveDate: ann.effectiveDate || todayVN(),
      requireAck: ann.requireAck !== false,
      sendChatNotify: false,
      sendBellNotify: false,
      attachments: Array.isArray(ann.attachments) ? ann.attachments : []
    });
    setIsAnnouncementModalOpen(true);
  };

  const handleSaveAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!announcementForm.title.trim()) {
      showToast("Vui lòng nhập tiêu đề Thông báo / Quyết định", "warning");
      return;
    }
    if (!announcementForm.content.trim() && !announcementForm.summary.trim()) {
      showToast("Vui lòng nhập nội dung chi tiết hoặc tóm tắt văn bản", "warning");
      return;
    }

    const nowTimeStr = nowVNDateTime();
    const existingItem = editingAnnouncementId
      ? announcements.find((a: any) => a.id === editingAnnouncementId)
      : null;

    const initialAck = existingItem?.acknowledgedBy || [
      {
        name: announcementForm.issuerName || currentStaffName,
        dept: announcementForm.issuerDept || userDept,
        time: nowTimeStr,
        note: "Người ký ban hành"
      }
    ];

    const savedItem = {
      id: existingItem ? existingItem.id : `ANN-${Date.now()}`,
      docCode: announcementForm.docCode.trim() || generateNextDocCode(announcementForm.docType),
      docType: announcementForm.docType,
      priority: announcementForm.priority,
      pinned: announcementForm.pinned,
      title: announcementForm.title.trim(),
      summary: announcementForm.summary.trim() || announcementForm.content.trim().slice(0, 180),
      content: announcementForm.content.trim(),
      issuerName: announcementForm.issuerName || currentStaffName,
      issuerRole: announcementForm.issuerRole || "Ban Giám Đốc",
      issuerDept: announcementForm.issuerDept || userDept,
      targetScope: announcementForm.targetScope,
      targetDepts: announcementForm.targetDepts,
      targetStaff: announcementForm.targetStaff,
      issueDate: announcementForm.issueDate || todayVN(),
      effectiveDate: announcementForm.effectiveDate || todayVN(),
      requireAck: announcementForm.requireAck,
      acknowledgedBy: initialAck,
      comments: existingItem?.comments || [],
      attachments: announcementForm.attachments || [],
      createdAt: existingItem?.createdAt || nowTimeStr,
      updatedAt: nowTimeStr
    };

    const nextList = existingItem
      ? announcements.map((a: any) => (a.id === editingAnnouncementId ? savedItem : a))
      : [savedItem, ...announcements];

    await saveAnnouncementsToStorage(nextList);
    setIsAnnouncementModalOpen(false);
    if (selectedAnnouncementDetail && selectedAnnouncementDetail.id === savedItem.id) {
      setSelectedAnnouncementDetail(savedItem);
    }

    const recipients = getTargetStaffForAnnouncement(savedItem)
      .map((r) => r.name)
      .filter((n) => n && !sameStaffName(n, currentStaffName));

    const meta = getDocTypeMeta(savedItem.docType);
    const scopeLabel =
      savedItem.targetScope === "ALL"
        ? "Toàn công ty"
        : savedItem.targetScope === "DEPARTMENTS"
        ? `Phòng: ${(savedItem.targetDepts || []).join(", ")}`
        : `${(savedItem.targetStaff || []).length} nhân sự chỉ định`;

    // Gửi thông báo Chuông hệ thống
    if (announcementForm.sendBellNotify) {
      notifyActivity({
        title: `${meta.shortLabel} [${savedItem.docCode}]`,
        message: `${savedItem.issuerName} (${savedItem.issuerRole}) vừa ban hành: "${savedItem.title}". Hiệu lực từ ${formatDayVN(savedItem.effectiveDate)}. Vui lòng mở xem và bấm Xác nhận đã đọc!`,
        type: savedItem.priority === "URGENT" ? "warning" : "info",
        category: "system",
        sender: { name: savedItem.issuerName },
        targetEmployeeNames: recipients,
        targetDept: savedItem.targetScope === "DEPARTMENTS" && savedItem.targetDepts.length === 1 ? savedItem.targetDepts[0] : "all",
        link: { tab: "workspace", subTab: "announcements", itemId: String(savedItem.docCode || savedItem.id) }
      });
    }

    // Gửi tin nhắn Chat nội bộ 1-1 tới tất cả nhân sự thuộc phạm vi nhận
    if (announcementForm.sendChatNotify && recipients.length > 0) {
      try {
        const effStr = formatDayVN(savedItem.effectiveDate);
        const msgLines = [
          `📢 **[BAN HÀNH ${meta.shortLabel} MỚI]**`,
          `• **Số hiệu:** ${savedItem.docCode} ${savedItem.priority === "URGENT" ? "🚨 *(KHẨN CẤP)*" : ""}`,
          `• **Tiêu đề:** **${savedItem.title}**`,
          `• **Người ký ban hành:** ${savedItem.issuerName} (${savedItem.issuerRole})`,
          `• **Phạm vi áp dụng:** ${scopeLabel} | **Hiệu lực từ:** ${effStr}`,
          savedItem.summary ? `• **Trích yếu:** ${savedItem.summary}` : "",
          savedItem.requireAck
            ? `👉 *Đề nghị Anh/Chị vào mục **Điều hành → Thông Báo & Quyết Định** để xem toàn văn và bấm **"✍️ Xác nhận đã đọc"**.*`
            : ""
        ]
          .filter(Boolean)
          .join("\n");

        await fetch("/api/chat?action=broadcast_meeting", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `${savedItem.docCode}: ${savedItem.title}`,
            date_label: effStr,
            time_slot: "Văn bản điều hành",
            location: scopeLabel,
            host_name: savedItem.issuerName,
            attendees: recipients,
            agenda: savedItem.summary || savedItem.content.slice(0, 250),
            custom_message: msgLines,
            mode: "invite",
            create_group: false,
            send_direct: true
          })
        });
      } catch (err) {
        console.warn("Could not broadcast announcement to chat:", err);
      }
    }

    showToast(
      existingItem
        ? `Đã cập nhật văn bản ${savedItem.docCode}!`
        : `Đã ban hành ${meta.shortLabel} [${savedItem.docCode}] & gửi thông báo tới ${recipients.length} nhân sự!`,
      "success"
    );
  };

  const handleAcknowledgeAnnouncement = async (ann: any) => {
    if (!ann) return;
    if (hasUserAcknowledgedAnnouncement(ann)) {
      showToast("Bạn đã xác nhận đọc văn bản này trước đó.", "info");
      return;
    }
    const nowStr = nowVNDateTime();
    const nextAck = [
      ...(Array.isArray(ann.acknowledgedBy) ? ann.acknowledgedBy : []),
      {
        name: currentStaffName,
        dept: userDept,
        time: nowStr
      }
    ];
    const updatedItem = { ...ann, acknowledgedBy: nextAck };
    const nextList = announcements.map((a: any) => (a.id === ann.id ? updatedItem : a));
    await saveAnnouncementsToStorage(nextList);
    if (selectedAnnouncementDetail && selectedAnnouncementDetail.id === ann.id) {
      setSelectedAnnouncementDetail(updatedItem);
    }
    showToast(`✅ Đã xác nhận đọc và nắm rõ văn bản [${ann.docCode}]!`, "success");
  };

  const handleRemindUnreadAnnouncement = async (ann: any) => {
    if (!ann) return;
    const targetStaff = getTargetStaffForAnnouncement(ann);
    const unreadStaff = targetStaff
      .filter((s) => !hasUserAcknowledgedAnnouncement(ann, s.name) && !sameStaffName(s.name, currentStaffName))
      .map((s) => s.name);

    if (unreadStaff.length === 0) {
      showToast("Tất cả nhân sự trong phạm vi áp dụng đều đã xác nhận đọc văn bản này!", "success");
      return;
    }

    setSendingAnnouncementRemindId(ann.id);
    try {
      const meta = getDocTypeMeta(ann.docType);
      const effStr = formatDayVN(ann.effectiveDate);
      await fetch("/api/chat?action=broadcast_meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Nhắc xác nhận văn bản ${ann.docCode}`,
          date_label: effStr,
          time_slot: "Yêu cầu xác nhận đọc",
          location: "Điều hành → Thông Báo & Quyết Định",
          host_name: ann.issuerName || currentStaffName,
          attendees: unreadStaff,
          agenda: `${meta.shortLabel} [${ann.docCode}]: ${ann.title} — Đề nghị Anh/Chị mở văn bản và bấm nút "✍️ Xác nhận Đã đọc & Nắm thông tin".`,
          mode: "remind",
          create_group: false,
          send_direct: true
        })
      });

      notifyActivity({
        title: `⏰ Nhắc đọc & xác nhận [${ann.docCode}]`,
        message: `Bạn chưa xác nhận đọc văn bản "${ann.title}" (${ann.docCode}). Vui lòng mở xem và bấm Xác nhận đã đọc!`,
        type: "warning",
        category: "system",
        sender: { name: currentStaffName },
        targetEmployeeNames: unreadStaff,
        targetDept: "all",
        link: { tab: "workspace", subTab: "announcements", itemId: String(ann.docCode || ann.id) }
      });

      showToast(`🔔 Đã gửi tin nhắn nhắc đọc qua Chat & Chuông tới ${unreadStaff.length} nhân sự chưa xác nhận!`, "success");
    } catch (err) {
      showToast("Lỗi khi gửi tin nhắn nhắc đọc", "error");
    } finally {
      setSendingAnnouncementRemindId(null);
    }
  };

  const handleTogglePinAnnouncement = async (ann: any) => {
    const updatedItem = { ...ann, pinned: !ann.pinned };
    const nextList = announcements.map((a: any) => (a.id === ann.id ? updatedItem : a));
    await saveAnnouncementsToStorage(nextList);
    if (selectedAnnouncementDetail && selectedAnnouncementDetail.id === ann.id) {
      setSelectedAnnouncementDetail(updatedItem);
    }
    showToast(updatedItem.pinned ? `📌 Đã ghim [${ann.docCode}] lên đầu bảng tin!` : `Đã bỏ ghim [${ann.docCode}]`, "info");
  };

  const handleDeleteAnnouncement = async (ann: any) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa văn bản [${ann.docCode}] "${ann.title}"?`)) return;
    const nextList = announcements.filter((a: any) => a.id !== ann.id);
    await saveAnnouncementsToStorage(nextList);
    if (selectedAnnouncementDetail && selectedAnnouncementDetail.id === ann.id) {
      setSelectedAnnouncementDetail(null);
    }
    showToast(`Đã xóa văn bản [${ann.docCode}]`, "info");
  };

  const handleAddAnnouncementComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAnnouncementDetail || !announcementCommentText.trim()) return;
    const newComment = {
      author: currentStaffName,
      dept: userDept,
      text: announcementCommentText.trim(),
      time: nowVNDateTime()
    };
    const updatedItem = {
      ...selectedAnnouncementDetail,
      comments: [...(selectedAnnouncementDetail.comments || []), newComment]
    };
    const nextList = announcements.map((a: any) => (a.id === selectedAnnouncementDetail.id ? updatedItem : a));
    await saveAnnouncementsToStorage(nextList);
    setSelectedAnnouncementDetail(updatedItem);
    setAnnouncementCommentText("");
    showToast("Đã gửi ý kiến phản hồi trên văn bản!", "success");
  };

  const handleCreateTaskFromAnnouncement = (ann: any) => {
    if (!ann) return;
    const defaultDept =
      ann.targetScope === "DEPARTMENTS" && ann.targetDepts?.length > 0
        ? ann.targetDepts[0]
        : rolePerspective === "manager"
        ? managerDept
        : "Kinh Doanh";
    setTaskForm({
      id: null,
      title: `[Triển khai ${ann.docCode}] ${ann.title}`,
      department: defaultDept,
      task_category: DEPARTMENT_CATEGORIES[defaultDept]?.[0] || "Chung",
      assignee_name: currentStaffName,
      customer_name: "",
      priority: ann.priority === "URGENT" ? "URGENT" : "HIGH",
      status: "TODO",
      deadline: todayVN(),
      description: `Triển khai thực hiện theo văn bản [${ann.docCode}] "${ann.title}" do ${ann.issuerName} (${ann.issuerRole}) ban hành (Hiệu lực từ ${formatDayVN(ann.effectiveDate)}).\n\nNội dung trọng tâm:\n${ann.summary || ann.content}`,
      result: "",
      attachments: Array.isArray(ann.attachments) ? [...ann.attachments] : []
    });
    setSelectedAnnouncementDetail(null);
    setIsTaskModalOpen(true);
  };

  const tasksPage = usePaged(filteredTasks, 20);
  const workflowsPage = usePaged(listWorkflows, 20);
  const dailyLogsPage = usePaged(filteredDailyLogs, 20);

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
            onClick={() => setActiveSubTab("proposals")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
              activeSubTab === "proposals"
                ? "bg-emerald-600 text-white shadow-sm shadow-emerald-600/25"
                : "text-slate-600 dark:text-slate-400 hover:bg-emerald-50 dark:hover:bg-slate-800 hover:text-emerald-700 dark:hover:text-white"
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Đề Xuất &amp; Phê Duyệt</span>
            {proposalsWaitingForMeCount > 0 ? (
              <span
                className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-extrabold animate-pulse ${
                  activeSubTab === "proposals"
                    ? "bg-white text-emerald-700"
                    : "bg-amber-500 text-white"
                }`}
                title={`${proposalsWaitingForMeCount} tờ trình / đề xuất đang chờ bạn phê duyệt`}
              >
                {proposalsWaitingForMeCount} chờ duyệt
              </span>
            ) : proposals.length > 0 ? (
              <span
                className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] ${
                  activeSubTab === "proposals"
                    ? "bg-white/20 text-white"
                    : "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                }`}
              >
                {proposals.length}
              </span>
            ) : null}
          </button>

          <button
            onClick={() => setActiveSubTab("planner")}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
              activeSubTab === "planner"
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/20"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>Lịch Công Tác Tuần</span>
          </button>

          <button
            onClick={() => setActiveSubTab("projects")}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
              activeSubTab === "projects"
                ? "bg-purple-600 text-white shadow-sm shadow-purple-600/25"
                : "text-slate-600 dark:text-slate-400 hover:bg-purple-50 dark:hover:bg-slate-800 hover:text-purple-700 dark:hover:text-white"
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Dự Án</span>
            <span className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              activeSubTab === "projects"
                ? "bg-white/20 text-white"
                : "bg-purple-100 text-purple-700 dark:bg-purple-900/70 dark:text-purple-300"
            }`}>
              {filteredLabProjects.length}
            </span>
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
            onClick={() => setActiveSubTab("announcements")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
              activeSubTab === "announcements"
                ? "bg-rose-600 text-white shadow-sm shadow-rose-600/25"
                : "text-slate-600 dark:text-slate-400 hover:bg-rose-50 dark:hover:bg-slate-800 hover:text-rose-700 dark:hover:text-white"
            }`}
          >
            <Bell className="w-4 h-4" />
            <span>Thông Báo &amp; Quyết Định</span>
            {unacknowledgedAnnouncementsForMe.length > 0 ? (
              <span
                className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-extrabold animate-pulse ${
                  activeSubTab === "announcements"
                    ? "bg-white text-rose-700"
                    : "bg-rose-600 text-white"
                }`}
                title={`${unacknowledgedAnnouncementsForMe.length} văn bản cần bạn xác nhận đã đọc`}
              >
                {unacknowledgedAnnouncementsForMe.length} mới
              </span>
            ) : announcements.length > 0 ? (
              <span
                className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] ${
                  activeSubTab === "announcements"
                    ? "bg-white/20 text-white"
                    : "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                }`}
              >
                {announcements.length}
              </span>
            ) : null}
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

        {/* Dải cảnh báo Văn bản / Quyết định mới chưa xác nhận đọc */}
        {unacknowledgedAnnouncementsForMe.length > 0 && activeSubTab !== "announcements" && (
          <div className="mt-3 pt-3 border-t border-rose-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs bg-rose-50/70 dark:bg-rose-950/30 px-3 py-2 rounded-xl border border-rose-200/80 dark:border-rose-900/60">
            <div className="flex items-center gap-2 min-w-0">
              <span className="px-2 py-0.5 rounded-md bg-rose-600 text-white font-extrabold text-[10px] shrink-0">
                📜 VĂN BẢN CẦN XÁC NHẬN ({unacknowledgedAnnouncementsForMe.length})
              </span>
              <span className="font-bold text-rose-950 dark:text-rose-200 truncate">
                [{unacknowledgedAnnouncementsForMe[0].docCode}] {unacknowledgedAnnouncementsForMe[0].title}
              </span>
              <span className="text-[11px] text-slate-500 hidden md:inline shrink-0">
                • Ban hành bởi: {unacknowledgedAnnouncementsForMe[0].issuerName}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleAcknowledgeAnnouncement(unacknowledgedAnnouncementsForMe[0])}
                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] cursor-pointer"
              >
                ✍️ Xác nhận đã đọc ngay
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveSubTab("announcements");
                  setSelectedAnnouncementDetail(unacknowledgedAnnouncementsForMe[0]);
                }}
                className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 font-bold text-[10px] hover:bg-rose-100 cursor-pointer"
              >
                Xem toàn văn ↗
              </button>
            </div>
          </div>
        )}

        {/* Quick Activity Notifications Strip (THÔNG BÁO HOẠT ĐỘNG) */}
        {filteredNotifications && filteredNotifications.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center gap-2 text-xs">
            <div className="flex items-center gap-1.5 shrink-0 font-bold text-orange-600 dark:text-orange-400">
              <Bell className="w-3.5 h-3.5 animate-pulse" />
              <span>THÔNG BÁO HOẠT ĐỘNG CỦA TÔI:</span>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar flex-1">
              {filteredNotifications.slice(0, 3).map((notif: any) => (
                <div
                  key={notif.id}
                  onClick={() => {
                    markAsRead(notif.id);
                    openWorkspaceItemFromNotification({
                      id: notif.taskId || notif.workflowId || notif.targetId || notif.link?.itemId,
                      code: notif.workflowCode || notif.orderCode || notif.link?.itemId,
                      title: notif.title,
                      message: notif.message,
                      subTab: notif.link?.subTab,
                      notification: notif
                    });
                  }}
                  className="group flex items-center gap-2 px-2.5 py-1 rounded-xl bg-orange-50/80 dark:bg-slate-800/80 hover:bg-orange-100/80 dark:hover:bg-slate-800 border border-orange-200/80 dark:border-slate-700 cursor-pointer shrink-0 max-w-md sm:max-w-xl hover:max-w-none transition-all"
                  title={`${notif.title}: ${notif.message}`}
                >
                  <span className="font-bold text-slate-800 dark:text-slate-200 truncate group-hover:whitespace-normal text-[11px]">
                    {notif.title}:
                  </span>
                  <span className="text-slate-600 dark:text-slate-400 truncate group-hover:whitespace-normal text-[11px] max-w-[260px] group-hover:max-w-none">
                    {notif.message}
                  </span>
                  <span className="text-orange-600 dark:text-orange-400 font-bold text-[10px] shrink-0 hover:underline">
                    Đi tới xem ↗
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
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
                      : d.id === "Pháp Chế"
                      ? "⚖️ Pháp Chế & Tuân Thủ"
                      : d.id === "Kế Toán"
                      ? "💰 Kế Toán - Tài Chính"
                      : "🏛️ Ban Giám Đốc"}
                  </option>
                ))}
              </select>
              <Filter className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500" />
              <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
            </div>
          )}

          {/* Staff / Assignee Filter Dropdown */}
          {(activeSubTab === "tasks" || activeSubTab === "planner" || activeSubTab === "projects") && (rolePerspective === "manager" || rolePerspective === "director") && (
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

          {/* Date Range & Sort Filter (when on announcements tab) */}
          {activeSubTab === "announcements" && (
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs">
                <Calendar className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <span className="text-[11px] font-semibold text-slate-500 whitespace-nowrap">Từ ngày:</span>
                <DateInputVN
                  value={announcementFromDate}
                  onChange={(e) => setAnnouncementFromDate(e.target.value)}
                  className="text-xs font-bold bg-transparent text-slate-900 dark:text-white focus:outline-none w-[112px]"
                />
                <span className="text-slate-400">→</span>
                <span className="text-[11px] font-semibold text-slate-500 whitespace-nowrap">Đến ngày:</span>
                <DateInputVN
                  value={announcementToDate}
                  onChange={(e) => setAnnouncementToDate(e.target.value)}
                  className="text-xs font-bold bg-transparent text-slate-900 dark:text-white focus:outline-none w-[112px]"
                />
                {(announcementFromDate || announcementToDate) && (
                  <button
                    type="button"
                    onClick={() => {
                      setAnnouncementFromDate("");
                      setAnnouncementToDate("");
                    }}
                    title="Xóa lọc theo ngày"
                    className="ml-0.5 px-1.5 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300 text-[10px] font-bold hover:bg-rose-200 cursor-pointer"
                  >
                    ✕ Xóa
                  </button>
                )}
              </div>

              <select
                value={announcementSortBy}
                onChange={(e) => setAnnouncementSortBy(e.target.value as any)}
                className="text-xs px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-200 font-bold cursor-pointer"
                title="Thứ tự sắp xếp thông báo"
              >
                <option value="newest">🕒 Mới nhất lên trên</option>
                <option value="issue_desc">📅 Ngày ban hành: Mới → Cũ</option>
                <option value="issue_asc">📅 Ngày ban hành: Cũ → Mới</option>
                <option value="pinned_first">📌 Ghim tiêu điểm lên đầu</option>
              </select>
            </div>
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

          {/* TAB 2B: ĐỀ XUẤT & PHÊ DUYỆT -> Nút Lập Đề Xuất / Tờ Trình + Nút nhanh Xin Nghỉ Phép (DXNP) */}
          {activeSubTab === "proposals" && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setProposalLeaveCreateTrigger((n) => n + 1)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white transition-all shadow-xs cursor-pointer"
                title="Lập nhanh Đơn Xin Nghỉ Phép / Nghỉ Việc Riêng (DXNP)"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>🏖️ Xin Nghỉ Phép (DXNP)</span>
              </button>
              <button
                type="button"
                onClick={() => setProposalCreateTrigger((n) => n + 1)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-all shadow-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>📝 Lập Đề Xuất / Tờ Trình</span>
              </button>
            </div>
          )}

          {/* TAB 3: LỊCH CÔNG TÁC TUẦN -> Hiển thị trực tiếp nút tạo lịch họp & thêm lịch tuần */}
          {activeSubTab === "planner" && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openScheduleForm(undefined, undefined, "MEETING")}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white transition-all shadow-xs cursor-pointer"
              >
                <Users className="w-3.5 h-3.5" />
                <span>🎥 + Tạo Lịch Họp &amp; Mời Họp</span>
              </button>
              <button
                type="button"
                onClick={() => openScheduleForm(undefined, undefined, "WORK")}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition-all shadow-xs cursor-pointer"
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Thêm Lịch Tuần</span>
              </button>
            </div>
          )}

          {/* TAB 3B: DỰ ÁN & NHÓM VIỆC LIÊN PHÒNG -> Mở trực tiếp nút tạo Dự án / Nhóm việc */}
          {activeSubTab === "projects" && (
            <button
              onClick={() => openCreateThematicModal()}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white transition-all shadow-xs cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tạo Dự Án / Nhóm Việc Mới</span>
            </button>
          )}

          {/* TAB 5: THÔNG BÁO & QUYẾT ĐỊNH -> Gộp thành 1 nút duy nhất Ban Hành Thông Báo / Quyết Định */}
          {activeSubTab === "announcements" && (
            <button
              type="button"
              onClick={() => openCreateAnnouncementModal("DECISION")}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white transition-all shadow-xs cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>📜 Ban Hành Thông Báo / Quyết Định</span>
            </button>
          )}
        </div>
      </div>

      {/* ==================== LEVEL 3: TAB CONTENTS ==================== */}

      {/* TAB 2B: ĐỀ XUẤT & PHÊ DUYỆT ĐA CẤP (ENTERPRISE PROPOSALS & E-APPROVAL) */}
      {activeSubTab === "proposals" && (
        <ProposalsApprovalView
          currentStaffName={currentStaffName}
          userDept={userDept}
          rolePerspective={rolePerspective}
          isDirector={isDirector}
          isManager={isManager}
          selectedDept={selectedDept}
          searchQuery={searchQuery}
          departments={DEPARTMENTS}
          personnelList={personnelList}
          customerList={customerList}
          supplierList={supplierList}
          productList={productList}
          proposals={proposals}
          onSaveProposals={saveProposalsToStorage}
          onPreviewAttachment={(att) => {
            const url = att?.url || "";
            if ((att?.type || "").startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(att?.name || url)) {
              setPreviewImage(url);
            } else {
              setPreviewDoc({ url, name: att?.name, type: att?.type });
            }
          }}
          onCreateTaskFromProposal={handleCreateTaskFromProposal}
          notifyActivity={notifyActivity}
          showToast={showToast}
          externalCreateTrigger={proposalCreateTrigger}
          externalLeaveCreateTrigger={proposalLeaveCreateTrigger}
          externalLeaveTabTrigger={proposalLeaveTabTrigger}
          externalTemplateTrigger={proposalTemplateTrigger}
          externalOpenProposalId={externalOpenProposalId}
        />
      )}

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
                    <th className="py-2.5 px-3">Mã &amp; Tiêu đề công việc</th>
                    <th className="py-2.5 px-3">Phòng ban / Phân loại</th>
                    <th className="py-2.5 px-3">Người phụ trách</th>
                    <th className="py-2.5 px-3">Khách hàng</th>
                    <th className="py-2.5 px-3">Ưu tiên</th>
                    <th className="py-2.5 px-3">Hạn chót</th>
                    <th className="py-2.5 px-3">Trạng thái</th>
                    <th className="py-2.5 px-3 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {tasksPage.items.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono font-bold text-[11px] text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-1.5 py-0.2 rounded">{t.task_code}</span>
                          <span className="font-bold text-slate-900 dark:text-white">{t.title}</span>
                          {t.related_workflow_code && (
                            <span className="text-[10px] text-purple-600 dark:text-purple-400 font-normal">
                              (🔗 {t.related_workflow_code})
                            </span>
                          )}
                          {(() => {
                            const taskComments = Array.isArray(t.logs) ? t.logs.filter((l: any) => l?.type === "comment") : [];
                            if (taskComments.length === 0) return null;
                            const hasDirective = taskComments.some((c: any) => c.role === "directive");
                            return (
                              <span
                                onClick={() => openEditTask(t)}
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                                  hasDirective
                                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                                    : "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
                                }`}
                                title={taskComments[taskComments.length - 1]?.text || ""}
                              >
                                {hasDirective ? "👑" : "💬"} {taskComments.length}
                              </span>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-700 dark:text-slate-200">{t.department}</div>
                        <div className="text-[10px] text-slate-500">{t.task_category}</div>
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-700 dark:text-slate-300">
                        {cleanWorkspaceAssignee(t.assignee_name) || (
                          <span className="text-amber-600 dark:text-amber-400 font-bold">⏳ Chờ phân công</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500">{t.customer_name || "—"}</td>
                      <td className="py-2.5 px-3"><PriorityBadge priority={t.priority} /></td>
                      <td className="py-2.5 px-3 font-mono text-slate-500 whitespace-nowrap">{t.deadline ? formatDayVN(t.deadline) : "—"}</td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          t.status === "DONE" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" :
                          t.status === "IN_PROGRESS" ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300" :
                          "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                        }`}>
                          {t.status === "DONE" ? "Hoàn tất" : t.status === "IN_PROGRESS" ? "Đang làm" : "Cần làm"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
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
                      <td colSpan={8} className="text-center py-8 text-slate-400 italic">
                        Không có công việc nào phù hợp với bộ lọc
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="px-4">
                <Pager p={tasksPage} unit="công việc" />
              </div>
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
              const slaDays = wf.sla_days || 3;
              return (
                <div
                  key={wf.id || wf.code}
                  className="inline-flex items-center rounded-lg bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200/60 dark:border-indigo-800/60 overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => handleInitiateFromTemplate(wf)}
                    title={`${wf.name}\n${wf.source_dept || wf.sourceDept || ""} ➔ ${wf.target_dept || wf.targetDept || ""} · ${stepsCount} bước · SLA: ${slaDays} ngày\n${wf.description || ""}`}
                    className="inline-flex items-center gap-1.5 max-w-[240px] px-2.5 py-1 text-xs font-semibold hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 transition-colors cursor-pointer"
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{wf.name}</span>
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 shrink-0">
                      {slaDays}d
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditTemplate(wf);
                    }}
                    title="Chỉnh sửa mẫu quy trình & thời gian SLA"
                    className="px-2 py-1 text-[11px] font-bold border-l border-indigo-200/70 dark:border-indigo-800/70 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-200/70 dark:hover:bg-indigo-800/70 transition-colors cursor-pointer shrink-0"
                  >
                    ✏️ Sửa
                  </button>
                </div>
              );
            })}
            {templatesExpanded && <span className="text-[11px] text-slate-400">Chọn quy trình ở các thẻ bên dưới</span>}
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleOpenCreateTemplate}
                className="px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer flex items-center gap-1 shadow-2xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Tạo mẫu quy trình</span>
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
              const slaDays = wf.sla_days || 3;
              const isCustom = !["SALES_TO_APP", "SALES_TO_WAREHOUSE", "TO_PROCUREMENT", "APP_TO_WAREHOUSE", "SALES_TO_LEGAL"].includes(String(wf.code || wf.id).toUpperCase());

              return (
                <div
                  key={wf.id || wf.code}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-xs flex flex-col justify-between hover:border-indigo-300 dark:hover:border-indigo-700 transition-all group relative"
                >
                  <div className="absolute top-2 right-2 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleEditTemplate(wf); }}
                      className="px-1.5 py-0.5 rounded text-[10px] font-bold text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900 border border-indigo-200/70 dark:border-indigo-800 cursor-pointer"
                      title="Chỉnh sửa mẫu quy trình & thời gian SLA"
                    >
                      ✏️ Sửa
                    </button>
                    {canManageTemplates && isCustom && typeof wf.id === "number" && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(wf.id); }}
                        className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        title="Xóa quy trình này"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0 pr-12">
                        <span className="text-xs font-bold text-slate-900 dark:text-white leading-tight block truncate" title={wf.name}>
                          {wf.name}
                        </span>
                        <div className="flex items-center flex-wrap gap-1.5 mt-0.5">
                          <span className="text-[10px] font-semibold text-slate-400">
                            {wf.source_dept || wf.sourceDept} ➔ {wf.target_dept || wf.targetDept}
                          </span>
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 border border-indigo-200/50">
                            {stepsCount} bước
                          </span>
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200/50">
                            ⏱ SLA: {slaDays} ngày
                          </span>
                        </div>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed mb-3 line-clamp-2" title={wf.description}>
                      {wf.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleEditTemplate(wf)}
                      className="py-1.5 px-2.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer shrink-0"
                      title="Chỉnh sửa các bước & thời gian SLA của quy trình này"
                    >
                      ✏️ Sửa &amp; SLA
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInitiateFromTemplate(wf)}
                      className="flex-1 py-1.5 px-3 rounded-lg text-xs font-bold bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 transition-colors flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <span>+ Phát lệnh</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
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

            {/* Bộ lọc danh sách phiếu: Trạng thái + Phân loại nghiệp vụ + Chế độ hiển thị */}
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 space-y-2.5 text-xs bg-slate-50/60 dark:bg-slate-950/30">
              {/* Hàng 1: Lọc theo Loại Quy Trình / Nghiệp Vụ (Giúp phân biệt tức thì các nhóm công việc) */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200/70 dark:border-slate-800/70">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mr-1">
                    Nhóm quy trình:
                  </span>
                  {([
                    ["all", "🗂️ Tất cả loại", "bg-slate-800 text-white dark:bg-white dark:text-slate-900"],
                    ["TENDER", "🏆 Đấu thầu & Dự án", "bg-amber-600 text-white"],
                    ["PROCUREMENT", "🛒 Mua hàng (PR/PO)", "bg-emerald-600 text-white"],
                    ["WAREHOUSE", "📦 Kho vận & Kiểm kê", "bg-cyan-600 text-white"],
                    ["LAB", "🔬 Kỹ thuật & Lab", "bg-purple-600 text-white"],
                    ["FINANCE", "💰 Tài chính & Kế toán", "bg-rose-600 text-white"],
                    ["GENERAL", "🔄 Phối hợp đa bước", "bg-indigo-600 text-white"],
                  ] as const).map(([catKey, catLabel, activeCls]) => {
                    const count = wfCategoryCounts[catKey] ?? 0;
                    if (catKey !== "all" && count === 0 && wfCategoryFilter !== catKey) return null;
                    const isSelected = wfCategoryFilter === catKey;
                    return (
                      <button
                        key={catKey}
                        type="button"
                        onClick={() => setWfCategoryFilter(catKey)}
                        className={`px-2.5 py-1 rounded-lg font-bold cursor-pointer transition-all flex items-center gap-1 ${
                          isSelected
                            ? `${activeCls} shadow-xs`
                            : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700"
                        }`}
                      >
                        <span>{catLabel}</span>
                        <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${isSelected ? "bg-black/20 text-white dark:bg-slate-700 dark:text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"}`}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Nút chuyển nhanh chế độ Xem Chi Tiết vs Thu Gọn */}
                <button
                  type="button"
                  onClick={() => setWfCompactMode((prev) => !prev)}
                  className={`px-2.5 py-1 rounded-lg font-bold border transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 ${
                    wfCompactMode
                      ? "bg-indigo-50 border-indigo-300 text-indigo-700 dark:bg-indigo-950/60 dark:border-indigo-700 dark:text-indigo-300"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300"
                  }`}
                  title="Thu gọn sơ đồ các bước để dễ nhìn tổng quan nhiều quy trình cùng lúc"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>{wfCompactMode ? "📋 Đang thu gọn các bước (Bấm để mở rộng)" : "📑 Thu gọn sơ đồ bước"}</span>
                </button>
              </div>

              {/* Hàng 2: Lọc theo Trạng thái + Người phụ trách + Mức ưu tiên + Sắp xếp */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap items-center gap-1">
                  {([
                    ["open", "Đang mở"],
                    ["PENDING", "Chờ tiếp nhận"],
                    ["WORKING", "Đang xử lý"],
                    ["REVIEW", "Đã có kết quả"],
                    ["COMPLETED", "Hoàn tất"],
                    ["DUE_SOON", "⏰ Sắp đến hạn"],
                    ["OVERDUE", "⚠ Quá hạn / Trễ SLA"],
                    ["all", "Tất cả"],
                  ] as const).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setWfStatusFilter(k)}
                      className={`px-2.5 py-1 rounded-lg font-semibold cursor-pointer transition-colors ${
                        wfStatusFilter === k
                          ? (k === "OVERDUE"
                              ? "bg-rose-600 text-white"
                              : k === "DUE_SOON"
                              ? "bg-amber-500 text-white"
                              : "bg-indigo-600 text-white")
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
            </div>

            {/* Danh sách các Card Quy Trình / Công Việc tách biệt rõ ràng */}
            <div className="p-4 space-y-4 bg-slate-100/70 dark:bg-slate-950/60">
              {/* Thanh Cảnh Báo & Nhắc Nhở SLA / Hạn Chót Chủ Động */}
              {(wfCounts.OVERDUE > 0 || wfCounts.DUE_SOON > 0 || wfCounts.UNASSIGNED > 0) && (
                <div
                  className={`rounded-xl p-3 border flex flex-col md:flex-row md:items-center justify-between gap-2.5 shadow-2xs ${
                    wfCounts.OVERDUE > 0
                      ? "bg-rose-50/95 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800"
                      : wfCounts.DUE_SOON > 0
                      ? "bg-amber-50/95 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800"
                      : "bg-indigo-50/90 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800"
                  }`}
                >
                  <div className="flex items-start sm:items-center gap-2.5 text-xs flex-wrap">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-extrabold bg-slate-900 text-white dark:bg-white dark:text-slate-900">
                      <Bell className="w-3.5 h-3.5" />
                      <span>CẢNH BÁO TIẾN ĐỘ &amp; SLA</span>
                    </span>
                    {wfCounts.OVERDUE > 0 && (
                      <button
                        type="button"
                        onClick={() => setWfStatusFilter(wfStatusFilter === "OVERDUE" ? "open" : "OVERDUE")}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-extrabold bg-rose-600 hover:bg-rose-700 text-white cursor-pointer shadow-2xs transition-colors"
                      >
                        <span>🔥 {wfCounts.OVERDUE} phiếu Trễ hạn / Quá hạn SLA bước</span>
                      </button>
                    )}
                    {wfCounts.DUE_SOON > 0 && (
                      <button
                        type="button"
                        onClick={() => setWfStatusFilter(wfStatusFilter === "DUE_SOON" ? "open" : "DUE_SOON")}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-extrabold bg-amber-500 hover:bg-amber-600 text-white cursor-pointer shadow-2xs transition-colors"
                      >
                        <span>⏰ {wfCounts.DUE_SOON} phiếu Sắp đến hạn / Sắp hết SLA bước</span>
                      </button>
                    )}
                    {wfCounts.UNASSIGNED > 0 && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-bold bg-white/90 dark:bg-slate-900 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                        <span>⏳ {wfCounts.UNASSIGNED} phiếu đang chờ bộ phận phân công</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {(wfCounts.OVERDUE > 0 || wfCounts.DUE_SOON > 0) && (
                      <button
                        type="button"
                        onClick={() => {
                          const urgentList = wfBase.filter((w) => {
                            const m = getWfDeadlineMeta(w);
                            return m.isAnyOverdue || m.isAnyDueSoon;
                          });
                          handleBulkRemindWorkflows(urgentList);
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-extrabold bg-rose-600 hover:bg-rose-700 text-white shadow-xs flex items-center gap-1.5 cursor-pointer transition-colors"
                        title="Phát thông báo Chuông + Tin nhắn Chat nội bộ + Ghi nhật ký đôn đốc cho toàn bộ các phiếu đang trễ hoặc sắp đến hạn"
                      >
                        <Bell className="w-3.5 h-3.5" />
                        <span>🔔 Nhắc việc tất cả ({wfCounts.OVERDUE + wfCounts.DUE_SOON})</span>
                      </button>
                    )}
                    {(wfStatusFilter === "OVERDUE" || wfStatusFilter === "DUE_SOON") && (
                      <button
                        type="button"
                        onClick={() => setWfStatusFilter("open")}
                        className="px-2.5 py-1 rounded-lg text-xs font-bold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 cursor-pointer"
                      >
                        Xem lại tất cả phiếu mở
                      </button>
                    )}
                  </div>
                </div>
              )}

              {workflowsPage.items.map((wf, wfIdx) => {
                const wfSteps = Array.isArray(wf.steps) ? wf.steps : [];
                const currentIdx = typeof wf.current_step_index === "number" ? wf.current_step_index : 0;
                const hasSteps = wfSteps.length > 0;
                const completedStepsCount = wfSteps.filter((s: any) => s.status === "COMPLETED").length;
                const progressPct = hasSteps ? Math.round((completedStepsCount / wfSteps.length) * 100) : wf.status === "COMPLETED" ? 100 : 50;
                const currentStepDept = (hasSteps && wfSteps[currentIdx]?.dept) ? wfSteps[currentIdx].dept : wf.target_dept;
                const currentAssignee = cleanWorkspaceAssignee(hasSteps && wfSteps[currentIdx]?.assignee_name ? wfSteps[currentIdx].assignee_name : wf.assignee_name);
                const canAssignThisWf = isDirector || isSameWorkspaceDept(userDept, currentStepDept) || isSameWorkspaceDept(userDept, wf.target_dept);
                const targetDeptStaff = personnelList.filter((p: any) => isSameWorkspaceDept(p.department, currentStepDept));
                const catMeta = getWorkflowCategoryMeta(wf);
                const isStepsCollapsed = collapsedWfIds[wf.id] !== undefined ? collapsedWfIds[wf.id] : wfCompactMode;
                const dlMeta = getWfDeadlineMeta(wf);
                const isOverdueWf = dlMeta.isAnyOverdue;
                const activeStepObj = hasSteps ? wfSteps[currentIdx] : null;
                const lastRemindedAt = activeStepObj?.last_reminded_at || "";
                const remindCount = Number(activeStepObj?.remind_count) || 0;

                return (
                  <div
                    key={wf.id}
                    className={`rounded-2xl bg-white dark:bg-slate-900 border-2 ${catMeta.cardBorder} shadow-sm hover:shadow-md transition-all overflow-hidden`}
                  >
                    {/* Thanh Header phân biệt loại Quy trình / Phiếu phối hợp */}
                    <div className={`px-4 py-2.5 border-b border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 ${catMeta.headerBg}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Số thứ tự Phiếu */}
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-black bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-2xs">
                          #{String(wfIdx + 1).padStart(2, "0")}
                        </span>

                        {/* Nhãn Phân Loại Nghiệp Vụ (Màu riêng cho từng loại quy trình) */}
                        <span className={`px-2.5 py-0.5 rounded-lg text-[11px] font-extrabold border flex items-center gap-1 ${catMeta.badgeCls}`}>
                          <span>{catMeta.icon}</span>
                          <span>{catMeta.label}</span>
                        </span>

                        {/* Mã Phiếu */}
                        <span className={`px-2 py-0.5 rounded-md font-mono text-xs font-extrabold border ${catMeta.codeCls}`}>
                          {wf.workflow_code}
                        </span>

                        {/* Luồng Phòng Ban */}
                        <span className="px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-white/90 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-2xs">
                          {wf.requester_dept} ➔ {wf.target_dept}
                        </span>

                        <WorkflowStatusBadge status={wf.status} />
                        <PriorityBadge priority={wf.priority} />

                        {dlMeta.ticketDeadlineBadge && (
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold ${dlMeta.ticketDeadlineBadge.cls}`}>
                            {dlMeta.ticketDeadlineBadge.text}
                          </span>
                        )}

                        {!dlMeta.isClosed && dlMeta.activeStepSla && (
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border ${dlMeta.activeStepSla.badgeClass}`}
                            title={dlMeta.activeStepSla.deadlineLabel ? `Hạn hoàn thành Bước ${currentIdx + 1}: ${dlMeta.activeStepSla.deadlineLabel}` : undefined}
                          >
                            B{currentIdx + 1}: {dlMeta.activeStepSla.badgeText}
                          </span>
                        )}
                      </div>

                      {/* Tiến độ tổng quan & Nút Thu gọn / Mở rộng các bước */}
                      <div className="flex items-center gap-3 ml-auto">
                        {hasSteps ? (
                          <div className="flex items-center gap-2">
                            <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                              Tiến độ: <span className="font-extrabold">{completedStepsCount}/{wfSteps.length} bước</span> ({progressPct}%)
                            </div>
                            <div className="w-20 h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${catMeta.progressCls}`}
                                style={{ width: `${Math.max(8, progressPct)}%` }}
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setCollapsedWfIds((prev) => ({
                                  ...prev,
                                  [wf.id]: !isStepsCollapsed,
                                }))
                              }
                              className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-white/90 hover:bg-white dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 cursor-pointer transition-colors"
                              title={isStepsCollapsed ? "Mở rộng chi tiết các bước" : "Thu gọn sơ đồ bước của phiếu này"}
                            >
                              {isStepsCollapsed ? `▼ Mở ${wfSteps.length} bước` : "▲ Thu gọn bước"}
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                            Phiếu điều phối trực tiếp (1 bước)
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="p-4 space-y-3">
                      {/* Ticket Title, Metadata & Action Buttons */}
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                        <div className="space-y-1.5 flex-1">
                          <h4 className="text-base font-extrabold text-slate-900 dark:text-white leading-snug">
                            {wf.title}
                          </h4>

                          <div className="flex items-center gap-x-4 gap-y-1.5 text-xs text-slate-600 dark:text-slate-400 flex-wrap">
                            <span className="inline-flex items-center gap-1">
                              <strong className="text-slate-700 dark:text-slate-300">Khách hàng / Đơn vị:</strong> {wf.customer_name || "Nội bộ TBR"}
                            </span>
                            {wf.product_info && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800/90 text-slate-800 dark:text-slate-200 font-medium">
                                <strong>Sản phẩm / TB:</strong> {wf.product_info}
                              </span>
                            )}
                            <span>
                              <strong className="text-slate-700 dark:text-slate-300">Người yêu cầu:</strong> {wf.requester_name}
                            </span>
                            <span className={`inline-flex items-center gap-1 font-semibold ${dlMeta.isTicketOverdue ? "text-rose-600 dark:text-rose-400 font-bold" : dlMeta.isTicketDueSoon ? "text-amber-600 dark:text-amber-400 font-bold" : ""}`}>
                              <strong className="text-slate-700 dark:text-slate-300">Hạn chót:</strong> {wf.due_date ? formatDayVN(wf.due_date) : "—"}
                              {!dlMeta.isClosed && dlMeta.diffDays !== null && (
                                <span className="text-[11px]">
                                  {dlMeta.diffDays < 0
                                    ? `(Trễ ${Math.abs(dlMeta.diffDays)} ngày)`
                                    : dlMeta.diffDays === 0
                                    ? "(Hôm nay)"
                                    : `(Còn ${dlMeta.diffDays} ngày)`}
                                </span>
                              )}
                            </span>
                          </div>

                          {/* Dòng thông tin Người tiếp nhận hiện tại tách riêng rõ ràng */}
                          <div className="pt-1 flex items-center gap-2 text-xs flex-wrap">
                            <span className="font-bold text-slate-700 dark:text-slate-300">
                              👉 Đầu mối xử lý hiện tại ({currentStepDept}):
                            </span>
                            {currentAssignee ? (
                              <span className="px-2.5 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold border border-indigo-200 dark:border-indigo-800">
                                👤 {currentAssignee}
                              </span>
                            ) : (
                              <span className="px-2.5 py-0.5 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-bold border border-amber-200 dark:border-amber-800">
                                ⏳ Chờ {currentStepDept} phân công
                              </span>
                            )}
                            {wf.status !== "COMPLETED" && canAssignThisWf && (
                              <span className="inline-flex items-center gap-1.5">
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
                                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs cursor-pointer transition-colors"
                                    title="Nhận phụ trách bước này"
                                  >
                                    Nhận việc
                                  </button>
                                )}
                              </span>
                            )}
                            {lastRemindedAt && (
                              <span className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold">
                                🔔 Đã nhắc lúc {lastRemindedAt.slice(11, 16)} ({lastRemindedAt.slice(8, 10)}/{lastRemindedAt.slice(5, 7)})
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Top Action buttons */}
                        <div className="flex items-center gap-2 shrink-0 flex-wrap">
                          {hasSteps && wf.status !== "COMPLETED" && (
                            <button
                              type="button"
                              onClick={() => handleOpenAdvanceStep(wf)}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Nghiệm Thu Bước {currentIdx + 1} &amp; Bàn Giao</span>
                            </button>
                          )}

                          {!hasSteps && wf.status === "PENDING" && (
                            <button
                              onClick={() => handleWorkflowStatusTransition(wf.id, "ACCEPTED", "Tiếp nhận phiếu")}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-xs cursor-pointer"
                            >
                              Tiếp Nhận
                            </button>
                          )}
                          {!hasSteps && wf.status === "ACCEPTED" && (
                            <button
                              onClick={() => handleWorkflowStatusTransition(wf.id, "IN_PROGRESS", "Bắt đầu triển khai")}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-xs cursor-pointer"
                            >
                              Triển Khai
                            </button>
                          )}

                          {wf.status !== "COMPLETED" && (
                            <button
                              onClick={() => handleOpenRecordResult(wf)}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white shadow-xs flex items-center gap-1 cursor-pointer"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              <span>Báo Cáo / Đính Kèm</span>
                            </button>
                          )}

                          {wf.status === "REVIEW" && (
                            <button
                              onClick={() => handleWorkflowStatusTransition(wf.id, "COMPLETED", "Nghiệm thu hoàn tất")}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs flex items-center gap-1 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Nghiệm Thu &amp; Đóng</span>
                            </button>
                          )}

                          {wf.status === "COMPLETED" && (
                            <button
                              onClick={() => handleOpenRecordResult(wf)}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 cursor-pointer"
                            >
                              Xem / Sửa Hồ Sơ
                            </button>
                          )}

                          {!dlMeta.isClosed && (
                            <button
                              type="button"
                              disabled={remindingWfId === wf.id}
                              onClick={() => handleRemindWorkflowStep(wf)}
                              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer shadow-2xs transition-colors ${
                                dlMeta.isAnyOverdue
                                  ? "border-rose-600 bg-rose-600 hover:bg-rose-700 text-white"
                                  : dlMeta.isAnyDueSoon || dlMeta.isUnassigned
                                  ? "border-orange-400 dark:border-orange-600 bg-orange-50 hover:bg-orange-100 dark:bg-orange-950/60 text-orange-800 dark:text-orange-300"
                                  : "border-slate-300 dark:border-slate-700 bg-white hover:bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                              }`}
                              title={
                                lastRemindedAt
                                  ? `Đã nhắc ${remindCount} lần (gần nhất: ${lastRemindedAt}). Bấm để gửi lại thông báo Chuông + Tin nhắn Chat đôn đốc người phụ trách / bộ phận xử lý.`
                                  : "Gửi thông báo Chuông + Tin nhắn Chat nội bộ + Ghi nhật ký đôn đốc tiến độ SLA cho bước đang chạy"
                              }
                            >
                              <Bell className="w-3.5 h-3.5" />
                              <span>
                                {remindingWfId === wf.id
                                  ? "Đang nhắc..."
                                  : remindCount > 0
                                  ? `🔔 Nhắc việc (${remindCount})`
                                  : "🔔 Nhắc việc"}
                              </span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleEditWorkflowTicket(wf)}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold border border-amber-300 dark:border-amber-700 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-300 cursor-pointer shadow-2xs"
                            title="Chỉnh sửa toàn bộ thông tin phiếu đã khởi tạo: Tiêu đề, Khách hàng, Sản phẩm, Hạn chót, Người thực hiện, Các bước & Thời gian SLA"
                          >
                            <span>✏️ Sửa Thông Tin / SLA</span>
                          </button>

                          <button
                            onClick={() => {
                              setSelectedWorkflowDetail(wf);
                              setIsWorkflowDetailModalOpen(true);
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Xem &amp; Trao Đổi</span>
                          </button>
                        </div>
                      </div>

                      {/* Interactive Stepper Pipeline (Chuẩn Stage-Gate RACI) */}
                      {hasSteps && (
                        <div className="bg-slate-50/90 dark:bg-slate-950/60 p-3 rounded-xl border border-slate-200/80 dark:border-slate-800 space-y-2">
                          <div className="flex items-center justify-between flex-wrap gap-1 text-[11px]">
                            <div className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                              <Layers className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                              <span>Tiến Trình Phối Hợp Đa Bước ({completedStepsCount}/{wfSteps.length} bước xong)</span>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[11px] text-slate-500 dark:text-slate-300 bg-white dark:bg-slate-900 px-2.5 py-0.5 rounded-lg border border-slate-200 dark:border-slate-800">
                                Bước đang chạy:{" "}
                                <strong className="text-indigo-600 dark:text-indigo-400">
                                  Bước {currentIdx + 1} — {wfSteps[currentIdx]?.title || `Bước ${currentIdx + 1}`}
                                </strong>{" "}
                                ({wfSteps[currentIdx]?.dept} • {wfSteps[currentIdx]?.assignee_name || "Chưa gán"})
                                {dlMeta.activeStepSla?.deadlineLabel && (
                                  <span className="ml-1.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                                    • Hạn SLA bước: <strong>{dlMeta.activeStepSla.deadlineLabel}</strong>
                                  </span>
                                )}
                              </span>
                            </div>
                          </div>

                          {!isStepsCollapsed && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                              {wfSteps.map((st: any, sIdx: number) => {
                                const isDone = st.status === "COMPLETED";
                                const isCurrent = currentIdx === sIdx && wf.status !== "COMPLETED";
                                const stepSla = getStepSlaMeta(wf, st, sIdx);

                                return (
                                  <div
                                    key={sIdx}
                                    className={`p-2.5 rounded-xl border text-xs transition-all ${
                                      isDone
                                        ? "bg-emerald-50/80 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-200"
                                        : isCurrent
                                        ? stepSla.status === "OVERDUE"
                                          ? "bg-rose-50/90 border-rose-400 dark:bg-rose-950/40 dark:border-rose-700 text-rose-950 dark:text-rose-100 ring-1 ring-rose-400/50 shadow-xs"
                                          : stepSla.status === "DUE_SOON"
                                          ? "bg-amber-50/90 border-amber-400 dark:bg-amber-950/40 dark:border-amber-700 text-amber-950 dark:text-amber-100 ring-1 ring-amber-400/50 shadow-xs"
                                          : `${catMeta.stepActiveCls} shadow-xs`
                                        : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 opacity-75"
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

                                    <div className="mt-1 flex items-center justify-between gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                                      <span className="font-semibold truncate max-w-[130px]">
                                        {st.dept}: <strong>{st.assignee_name || "Chưa gán"}</strong>
                                      </span>
                                      {st.sla_hours && <span>SLA: {st.sla_hours}h</span>}
                                    </div>

                                    {(isCurrent || isDone) && (
                                      <div className="mt-1 flex items-center justify-between gap-1 flex-wrap">
                                        <span
                                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-extrabold border ${stepSla.badgeClass}`}
                                          title={stepSla.deadlineLabel ? `Hạn SLA bước ${sIdx + 1}: ${stepSla.deadlineLabel}` : undefined}
                                        >
                                          {stepSla.badgeText}
                                        </span>
                                        {isCurrent && stepSla.deadlineLabel && (
                                          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">
                                            Hạn: {stepSla.deadlineLabel}
                                          </span>
                                        )}
                                      </div>
                                    )}

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
                                    {Array.isArray(st.attachments) && st.attachments.length > 0 && (
                                      <div className="mt-1 flex flex-col gap-0.5">
                                        {st.attachments.map((att: any, aIdx: number) => (
                                          <a key={aIdx} href={att.url} target="_blank" rel="noreferrer" className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline truncate" title={att.name}>
                                            📎 {att.name}
                                          </a>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Tài liệu gửi kèm khi tạo phiếu (phiếu triển khai...) khi chưa có tổng hợp kết quả */}
                      {!wf.results_summary && Array.isArray(wf.attachments) && wf.attachments.length > 0 && (
                        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 space-y-1.5">
                          <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1">
                            <Paperclip className="w-3 h-3" /> Tài liệu đính kèm phiếu ({wf.attachments.length})
                          </div>
                          <AttachmentList files={wf.attachments} />
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
              <div className="bg-white dark:bg-slate-900 rounded-xl px-4">
                <Pager p={workflowsPage} unit="phiếu phối hợp" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: LỊCH CÔNG TÁC TUẦN (MỞ TRỰC TIẾP KHÔNG QUA TAB PHỤ) */}
      {activeSubTab === "planner" && (
        <div className="space-y-4">
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
                    Lịch họp nội bộ / liên phòng ban, lịch trực Lab, lịch demo tại bệnh viện và các đợt giao nhận hàng hóa lớn
                  </p>
                </div>
              </div>

              {/* BANNER QUẢN LÝ LỊCH HỌP & NHẮC HỌP TRONG TUẦN ĐANG XEM */}
              {(() => {
                const weekMeetings = filteredSchedules.filter((s: any) => {
                  const isMtg = s.eventType === "MEETING" || String(s.title || "").toLowerCase().includes("họp");
                  if (!isMtg) return false;
                  return viewedWeek.all7Days.some((wd) => scheduleOnDay(s, wd));
                });
                if (weekMeetings.length === 0) return null;
                return (
                  <div className="mb-4 p-3.5 rounded-2xl bg-gradient-to-r from-rose-50/90 via-indigo-50/60 to-purple-50/80 dark:from-rose-950/30 dark:via-slate-900 dark:to-indigo-950/30 border border-rose-200/80 dark:border-rose-900/60 space-y-2.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-lg bg-rose-600 text-white text-[11px] font-extrabold">
                          🎥 LỊCH HỌP TUẦN NÀY ({weekMeetings.length})
                        </span>
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                          Theo dõi thành viên tham dự, gửi tin nhắn thông báo họp &amp; nhắc lịch họp 1 chạm
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => openScheduleForm(undefined, undefined, "MEETING")}
                        className="text-xs font-bold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                      >
                        + Đặt lịch họp mới
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {weekMeetings.map((mtg: any) => {
                        const rawActors = String(mtg.actor || "").split(/[,;\n]+/).map((s: string) => s.trim()).filter(Boolean);
                        const coList = Array.isArray(mtg.coActors) ? mtg.coActors : [];
                        const allAttendees = Array.from(new Set([...rawActors, ...coList]));
                        const isReminding = sendingMeetingRemindId === mtg.id;
                        return (
                          <div
                            key={`mtg-banner-${mtg.id}`}
                            className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-rose-200/70 dark:border-slate-800 shadow-2xs flex flex-col justify-between gap-2 text-xs"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 font-mono font-extrabold text-[10px]">
                                    📅 {mtg.day} {mtg.date ? `(${String(mtg.date).slice(8, 10)}/${String(mtg.date).slice(5, 7)})` : ""} • ⏰ {mtg.time}
                                  </span>
                                  {mtg.reminderMinutes > 0 && (
                                    <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 text-[10px] font-bold">
                                      🔔 Tự nhắc trước {mtg.reminderMinutes >= 1440 ? "1 ngày" : `${mtg.reminderMinutes}p`}
                                    </span>
                                  )}
                                  {mtg.lastRemindedAt && (
                                    <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">
                                      ✓ Đã nhắc lúc {mtg.lastRemindedAt}
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] font-bold text-slate-500">
                                  📍 {mtg.location || "Phòng họp"}
                                </span>
                              </div>
                              <div className="font-extrabold text-slate-900 dark:text-white text-xs">
                                {mtg.title}
                              </div>
                              {mtg.meetingAgenda && (
                                <p className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-2">
                                  📝 Nội dung: {mtg.meetingAgenda}
                                </p>
                              )}
                              {mtg.meetingLink && (
                                <a
                                  href={mtg.meetingLink.startsWith("http") ? mtg.meetingLink : `https://${mtg.meetingLink}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  <span>Link phòng họp trực tuyến</span>
                                </a>
                              )}
                              <div className="flex items-center gap-1 flex-wrap pt-0.5">
                                <span className="text-[10px] font-bold text-slate-500">
                                  👥 Thành viên tham dự ({allAttendees.length}):
                                </span>
                                {allAttendees.slice(0, 6).map((mem: string, mIdx: number) => (
                                  <span
                                    key={mem}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                      mIdx === 0
                                        ? "bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300"
                                        : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                                    }`}
                                  >
                                    {mIdx === 0 ? `⭐ ${mem} (Chủ trì)` : mem}
                                  </span>
                                ))}
                                {allAttendees.length > 6 && (
                                  <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-[10px] font-bold">
                                    +{allAttendees.length - 6} người
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center justify-end gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                              <button
                                type="button"
                                disabled={isReminding}
                                onClick={() => handleRemindMeetingNow(mtg)}
                                className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-[11px] flex items-center gap-1 shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
                                title="Gửi tin nhắn Chat và thông báo chuông nhắc lịch họp ngay cho tất cả thành viên tham dự"
                              >
                                <Bell className="w-3 h-3" />
                                <span>{isReminding ? "Đang gửi nhắc họp..." : "🔔 Nhắc lịch họp ngay"}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openScheduleForm(undefined, mtg, "MEETING")}
                                className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 font-bold text-[11px] flex items-center gap-1 transition-colors cursor-pointer"
                              >
                                <Pencil className="w-3 h-3" />
                                <span>Sửa / Mời thêm</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

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
                            const isMeeting = ev.eventType === "MEETING" || String(ev.title || "").toLowerCase().includes("họp");
                            const isApp = ev.category === "Application";
                            const isSales = ev.category === "Kinh Doanh";
                            const isWh = ev.category === "Kho & Vận Hành";
                            const rawActors = String(ev.actor || "").split(/[,;\n]+/).map((s: string) => s.trim()).filter(Boolean);
                            const coList = Array.isArray(ev.coActors) ? ev.coActors : [];
                            const allAttendees = Array.from(new Set([...rawActors, ...coList]));

                            return (
                              <div
                                key={ev.id}
                                className={`group relative rounded-lg p-2 text-[11px] font-medium border transition-all ${
                                  isMeeting
                                    ? "bg-rose-100/90 dark:bg-rose-950/60 border-rose-300 dark:border-rose-800 text-rose-950 dark:text-rose-100 shadow-2xs"
                                    : isApp
                                    ? "bg-purple-100/80 dark:bg-purple-950/60 border-purple-300 dark:border-purple-800 text-purple-950 dark:text-purple-200"
                                    : isSales
                                    ? "bg-orange-100/80 dark:bg-orange-950/60 border-orange-300 dark:border-orange-800 text-orange-950 dark:text-orange-200"
                                    : isWh
                                    ? "bg-emerald-100/80 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-800 text-emerald-950 dark:text-emerald-200"
                                    : "bg-blue-100/80 dark:bg-blue-950/60 border-blue-300 dark:border-blue-800 text-blue-950 dark:text-blue-200"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1 mb-0.5">
                                  <div className="flex items-center gap-1 flex-wrap">
                                    {isMeeting && (
                                      <span className="px-1.5 py-0.2 rounded bg-rose-600 text-white text-[9px] font-extrabold uppercase">
                                        🎥 HỌP
                                      </span>
                                    )}
                                    <span className="font-bold font-mono text-[10px]">⏰ {ev.time}</span>
                                  </div>
                                  <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      type="button"
                                      onClick={() => handleRemindMeetingNow(ev)}
                                      title="Nhắn tin & Gửi thông báo nhắc lịch ngay"
                                      className="hover:text-amber-600 p-0.5 cursor-pointer"
                                    >
                                      <Bell className="w-3 h-3" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openScheduleForm(undefined, ev)}
                                      title="Sửa lịch trình"
                                      className="hover:text-indigo-600 p-0.5 cursor-pointer"
                                    >
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => { if (confirm("Xóa lịch trình này?")) handleDeleteSchedule(ev.id); }}
                                      title="Xóa lịch trình"
                                      className="hover:text-rose-600 p-0.5 cursor-pointer"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </span>
                                </div>
                                <div className="font-semibold leading-tight">{ev.title}</div>
                                {ev.meetingAgenda && (
                                  <div className="text-[10px] opacity-85 mt-0.5 line-clamp-2 italic">
                                    📝 {ev.meetingAgenda}
                                  </div>
                                )}
                                {Array.isArray(ev.linkedTaskCodes) && ev.linkedTaskCodes.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {ev.linkedTaskCodes.map((code: string) => (
                                      <span
                                        key={code}
                                        className="px-1.5 py-0.5 rounded bg-white/70 dark:bg-slate-900/70 text-[9px] font-mono font-bold border border-current/20"
                                        title={`Liên kết công việc / quy trình: ${code}`}
                                      >
                                        🔗 {code}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <div className="text-[10px] opacity-85 mt-1 flex items-center justify-between gap-1 flex-wrap">
                                  <span className="truncate font-semibold" title={`Thành viên: ${allAttendees.join(", ")}`}>
                                    {allAttendees.length > 1 ? `👥 ${allAttendees[0]} (+${allAttendees.length - 1} TV)` : `👤 ${ev.actor}`}
                                  </span>
                                  {ev.location && <span className="truncate shrink-0">📍 {ev.location}</span>}
                                </div>
                                {isMeeting && (
                                  <div className="mt-1.5 pt-1 border-t border-current/15 flex items-center justify-between gap-1">
                                    <button
                                      type="button"
                                      disabled={sendingMeetingRemindId === ev.id}
                                      onClick={() => handleRemindMeetingNow(ev)}
                                      className="px-1.5 py-0.5 rounded bg-white/80 dark:bg-slate-900/80 hover:bg-white text-rose-700 dark:text-rose-300 font-bold text-[9px] flex items-center gap-1 cursor-pointer transition-colors"
                                      title="Gửi tin nhắn Chat & thông báo nhắc lịch họp cho các thành viên"
                                    >
                                      <Bell className="w-2.5 h-2.5" />
                                      <span>{sendingMeetingRemindId === ev.id ? "Đang nhắc..." : "🔔 Nhắc họp"}</span>
                                    </button>
                                    {ev.lastRemindedAt && (
                                      <span className="text-[9px] opacity-75 font-mono">Đã nhắc {ev.lastRemindedAt}</span>
                                    )}
                                  </div>
                                )}
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

                      <div className="pt-2 border-t border-slate-200/50 dark:border-slate-700/50 mt-2 grid grid-cols-2 gap-1">
                        <button
                          type="button"
                          onClick={() => openScheduleForm(wd.date, undefined, "WORK")}
                          className="py-1 text-[10px] font-bold text-slate-400 hover:text-indigo-600 hover:bg-indigo-50/50 dark:hover:bg-slate-800 rounded transition-colors flex items-center justify-center gap-0.5 cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          <span>+ Công tác</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openScheduleForm(wd.date, undefined, "MEETING")}
                          className="py-1 text-[10px] font-bold text-rose-500 hover:text-rose-600 hover:bg-rose-50/60 dark:hover:bg-slate-800 rounded transition-colors flex items-center justify-center gap-0.5 cursor-pointer"
                        >
                          <Users className="w-3 h-3" />
                          <span>🎥 + Họp</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
        </div>
      )}

      {/* TAB 3B: DỰ ÁN & NHÓM VIỆC LIÊN PHÒNG BAN (MỞ TRỰC TIẾP GIAO DIỆN LÀM VIỆC) */}
      {activeSubTab === "projects" && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 text-purple-600 dark:text-purple-400">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
                    <span>🚀 Dự Án &amp; Nhóm Công Việc Liên Phòng Ban</span>
                    <span className="px-2.5 py-0.5 text-[11px] font-bold rounded-full bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                      {filteredLabProjects.length} Dự Án ({selectedDept === "all" ? "Toàn Công Ty" : selectedDept})
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    Tự thiết kế dự án bất kỳ hoặc chọn từ mẫu gợi ý • Chia theo giai đoạn, tạo &amp; giao nhiều công việc cụ thể trong từng giai đoạn, đồng bộ 2 chiều với Bảng công việc, Quy trình phối hợp &amp; Lịch tuần
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {selectedDept !== "all" && (
                  <button
                    type="button"
                    onClick={() => openCreateThematicModal(selectedDept)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 hover:bg-purple-100 cursor-pointer transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Dự án phòng {selectedDept}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Project Category Filter Chips (bao gồm cả Dự án tự thiết kế & các mẫu) */}
            {(() => {
              const currentDept = selectedDept;
              const relevantTypes = currentDept === "all"
                ? [
                    ...(DEPARTMENT_THEMATIC_TYPES["Liên Phòng Ban"] || []),
                    ...Object.entries(DEPARTMENT_THEMATIC_TYPES)
                      .filter(([k]) => k !== "Liên Phòng Ban")
                      .map(([, v]) => v)
                      .flat()
                  ]
                : [
                    ...(DEPARTMENT_THEMATIC_TYPES["Liên Phòng Ban"] || []),
                    ...(DEPARTMENT_THEMATIC_TYPES[currentDept] || [])
                  ];

              const customCount = labProjects.filter((p) => p.typeId === "custom_project").length;

              return (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-2.5 mb-4 no-scrollbar border-b border-slate-100 dark:border-slate-800">
                  <span className="text-[11px] font-bold text-slate-400 shrink-0 mr-1 flex items-center gap-1">
                    <Filter className="w-3.5 h-3.5 text-purple-500" />
                    <span>Phân loại dự án:</span>
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
                    Tất cả ({filteredLabProjects.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setThematicFilterType(thematicFilterType === "custom_project" ? "all" : "custom_project")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all shrink-0 cursor-pointer border ${
                      thematicFilterType === "custom_project"
                        ? "bg-purple-50 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 border-purple-400 dark:border-purple-600 font-bold shadow-xs ring-2 ring-purple-500/20"
                        : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                    }`}
                  >
                    <span>✨</span>
                    <span>Dự án tự thiết kế</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold font-mono ${
                      customCount > 0 ? "bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300" : "bg-slate-100 dark:bg-slate-800 text-slate-400"
                    }`}>
                      {customCount}
                    </span>
                  </button>
                  {relevantTypes.map((t) => {
                    const count = labProjects.filter(p => p.typeId === t.id).length;
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
                  Chưa có dự án hoặc nhóm công việc liên phòng nào
                </h4>
                <p className="text-xs text-slate-500 max-w-lg mx-auto mb-4">
                  Bạn có thể tự tạo mới một dự án với nội dung bất kỳ hoặc chọn từ các mẫu gợi ý có sẵn, chia theo từng giai đoạn và thêm các công việc cụ thể cho từng thành viên ở các phòng ban.
                </p>
                <button
                  onClick={() => openCreateThematicModal()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white shadow-xs transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Tạo Dự Án / Nhóm Việc Đầu Tiên</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {filteredLabProjects.map((prj) => {
                  const stages = prj.stages || [];
                  const completedStages = stages.filter((s: any) => s.status === "completed").length;
                  const totalStages = stages.length;
                  const allStageTasks = stages.flatMap((s: any) => Array.isArray(s.tasks) ? s.tasks : []);
                  const doneStageTasks = allStageTasks.filter((t: any) => t.status === "completed").length;
                  const progressPct = allStageTasks.length > 0
                    ? Math.round((doneStageTasks / allStageTasks.length) * 100)
                    : totalStages > 0
                    ? Math.round((completedStages / totalStages) * 100)
                    : 0;

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
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${prj.dept === "Liên Phòng Ban" || (Array.isArray(prj.participatingDepts) && prj.participatingDepts.length > 1) ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white border-purple-600" : badgeColor}`}>
                              {prj.dept === "Liên Phòng Ban" || (Array.isArray(prj.participatingDepts) && prj.participatingDepts.length > 1) ? "🚀 Liên Phòng Ban" : prj.dept}
                            </span>
                            {prj.customerOrRef && (
                              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                🔗 {prj.customerOrRef}
                              </span>
                            )}
                            {prj.typeName && (
                              <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 truncate max-w-[220px]" title={prj.typeName}>
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
                              title="Chỉnh sửa dự án / thêm giai đoạn & công việc"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteThematicProject(prj.id)}
                              className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                              title="Xóa dự án"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Title & Objectives */}
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1.5 leading-snug">
                          {prj.name}
                        </h4>
                        {prj.description && (
                          <p className="text-xs text-slate-600 dark:text-slate-400 mb-2.5 leading-relaxed line-clamp-2">
                            {prj.description}
                          </p>
                        )}

                        {/* Participating Departments Strip & Lead/Dates */}
                        {(() => {
                          const partDepts: string[] = Array.isArray(prj.participatingDepts) && prj.participatingDepts.length > 0
                            ? prj.participatingDepts
                            : Array.from(new Set([
                                ...(prj.dept && prj.dept !== "Liên Phòng Ban" ? [prj.dept] : []),
                                ...stages.map((s: any) => s.dept).filter(Boolean)
                              ]));
                          return partDepts.length > 0 ? (
                            <div className="flex items-center gap-1 flex-wrap mb-2.5">
                              <span className="text-[10px] font-bold text-slate-400 mr-0.5">🏢 Phòng tham gia ({partDepts.length}):</span>
                              {partDepts.map((d: string) => (
                                <span
                                  key={d}
                                  className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border border-purple-200/80 dark:border-purple-800/60"
                                >
                                  {d}
                                </span>
                              ))}
                            </div>
                          ) : null;
                        })()}

                        <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-500 dark:text-slate-400 mb-3 bg-slate-50 dark:bg-slate-950/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/60">
                          <div>
                            <span className="text-slate-400">👤 Chủ nhiệm (PM):</span>{" "}
                            <strong className="text-slate-800 dark:text-slate-200">{prj.lead}</strong>
                            {Array.isArray(prj.collaborators) && prj.collaborators.length > 0 && (
                              <div className="text-[10px] text-slate-500 mt-0.5 truncate" title={prj.collaborators.join(", ")}>
                                👥 Thành viên ({prj.collaborators.length}): {prj.collaborators.join(", ")}
                              </div>
                            )}
                          </div>
                          <div>
                            <span className="text-slate-400">📅 Tiến độ:</span>{" "}
                            <span className="font-semibold text-slate-700 dark:text-slate-300">
                              {prj.startDate ? prj.startDate : "Bắt đầu"} {prj.endDate ? `➔ ${prj.endDate}` : ""}
                            </span>
                            {prj.budget && (
                              <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5 truncate">
                                💰 Nguồn lực: {prj.budget}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Specialized Progress Section with Stages & Sub-tasks per Stage */}
                        <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                              <ListChecks className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                              <span>
                                Tiến trình ({completedStages}/{totalStages} giai đoạn
                                {allStageTasks.length > 0 ? ` • ${doneStageTasks}/${allStageTasks.length} công việc` : ""})
                              </span>
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

                          {/* Stages & Nested Tasks List */}
                          {stages.length > 0 && (
                            <div className="space-y-2 mt-2.5 max-h-72 overflow-y-auto pr-1">
                              {stages.map((stg: any, sIdx: number) => {
                                const isDone = stg.status === "completed";
                                const stageTasks = Array.isArray(stg.tasks) ? stg.tasks : [];
                                const doneCount = stageTasks.filter((t: any) => t.status === "completed").length;
                                const stageKey = `${prj.id}::${stg.id}`;
                                const isAddingHere = quickTaskStageKey === stageKey;

                                return (
                                  <div
                                    key={stg.id || sIdx}
                                    className={`rounded-xl text-xs border transition-all p-2.5 space-y-2 ${
                                      isDone
                                        ? "bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200/70 dark:border-emerald-900/40"
                                        : "bg-slate-50/80 dark:bg-slate-800/40 border-slate-200/80 dark:border-slate-800"
                                    }`}
                                  >
                                    {/* Stage Header */}
                                    <div className="flex items-start justify-between gap-2">
                                      <div
                                        onClick={() => handleToggleStage(prj.id, stg.id)}
                                        className="flex items-start gap-2 flex-1 min-w-0 cursor-pointer"
                                      >
                                        <button
                                          type="button"
                                          className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center shrink-0 border transition-all ${
                                            isDone
                                              ? "bg-emerald-600 border-emerald-600 text-white"
                                              : "border-slate-300 dark:border-slate-600 hover:border-purple-500"
                                          }`}
                                          title="Đánh dấu hoàn thành toàn bộ giai đoạn này"
                                        >
                                          {isDone && <Check className="w-3 h-3 stroke-[3]" />}
                                        </button>
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className={`text-[10px] font-extrabold uppercase ${isDone ? "text-emerald-700 dark:text-emerald-400" : "text-purple-700 dark:text-purple-400"}`}>
                                              Giai đoạn {sIdx + 1}
                                            </span>
                                            {stg.due && (
                                              <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                                📅 Hạn: {/^d{4}-d{2}-d{2}$/.test(String(stg.due)) ? String(stg.due).split("-").reverse().join("/") : stg.due}
                                              </span>
                                            )}
                                            {(Array.isArray(stg.depts) && stg.depts.length > 0 ? stg.depts : (stg.dept ? [stg.dept] : [])).map((dName: string) => (
                                              <span
                                                key={dName}
                                                className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                                              >
                                                🏢 {dName}
                                              </span>
                                            ))}
                                            {stg.assignee && (
                                              <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                                👤 {stg.assignee}
                                              </span>
                                            )}
                                            {stageTasks.length > 0 && (
                                              <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-purple-100/80 dark:bg-purple-950 text-purple-700 dark:text-purple-300">
                                                {doneCount}/{stageTasks.length} việc
                                              </span>
                                            )}
                                          </div>
                                          <p className={`text-xs font-bold text-slate-800 dark:text-slate-100 mt-0.5 leading-snug ${isDone ? "line-through opacity-70" : ""}`}>
                                            {stg.name}
                                          </p>
                                        </div>
                                      </div>

                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (isAddingHere) {
                                            setQuickTaskStageKey(null);
                                          } else {
                                            setQuickTaskStageKey(stageKey);
                                            setQuickStageTaskForm({
                                              title: "",
                                              dept: stg.dept || (prj.dept !== "Liên Phòng Ban" ? prj.dept : (prj.participatingDepts?.[0] || "Kinh Doanh")),
                                              assignee: stg.assignee || "",
                                              due: prj.endDate || todayVN()
                                            });
                                          }
                                        }}
                                        className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900 shrink-0 cursor-pointer transition-colors"
                                        title="Thêm công việc cụ thể vào giai đoạn này"
                                      >
                                        + Thêm việc
                                      </button>
                                    </div>

                                    {/* Sub-tasks inside this Stage */}
                                    {stageTasks.length > 0 && (
                                      <div className="pl-5 space-y-1 pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                                        {stageTasks.map((stTask: any, tIdx: number) => {
                                          const isTaskDone = stTask.status === "completed";
                                          return (
                                            <div
                                              key={stTask.id || tIdx}
                                              onClick={() => handleToggleStageTask(prj.id, stg.id, stTask.id)}
                                              className={`group/task flex items-center justify-between gap-2 p-1.5 rounded-lg border text-[11px] cursor-pointer transition-all ${
                                                isTaskDone
                                                  ? "bg-white/60 dark:bg-slate-900/40 border-emerald-200/60 dark:border-emerald-900/40 text-slate-400"
                                                  : "bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:border-purple-300"
                                              }`}
                                            >
                                              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                                <span
                                                  className={`w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 border ${
                                                    isTaskDone
                                                      ? "bg-emerald-600 border-emerald-600 text-white"
                                                      : "border-slate-300 dark:border-slate-600"
                                                  }`}
                                                >
                                                  {isTaskDone && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                                                </span>
                                                <span className="font-mono text-[9px] text-slate-400 shrink-0">
                                                  {sIdx + 1}.{tIdx + 1}
                                                </span>
                                                <span className={`font-medium truncate ${isTaskDone ? "line-through opacity-75" : ""}`} title={stTask.title}>
                                                  {stTask.title}
                                                </span>
                                              </div>
                                              <div className="flex items-center gap-1 shrink-0">
                                                {stTask.dept && (
                                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">
                                                    {stTask.dept}
                                                  </span>
                                                )}
                                                {stTask.assignee && (
                                                  <span className="px-1.5 py-0.2 rounded text-[9px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                                    👤 {stTask.assignee}
                                                  </span>
                                                )}
                                                {stTask.due && (
                                                  <span className="text-[9px] font-mono text-slate-400">
                                                    {String(stTask.due).slice(8, 10)}/{String(stTask.due).slice(5, 7)}
                                                  </span>
                                                )}
                                                <button
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteStageTask(prj.id, stg.id, stTask.id);
                                                  }}
                                                  className="opacity-0 group-hover/task:opacity-100 p-0.5 text-slate-400 hover:text-rose-600 transition-opacity cursor-pointer"
                                                  title="Xóa công việc này"
                                                >
                                                  <X className="w-3 h-3" />
                                                </button>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}

                                    {/* Quick Add Task Form inside Stage */}
                                    {isAddingHere && (
                                      <div
                                        onClick={(e) => e.stopPropagation()}
                                        className="ml-5 p-2 rounded-xl bg-white dark:bg-slate-900 border border-purple-300 dark:border-purple-700 space-y-2 shadow-xs"
                                      >
                                        <div className="text-[10px] font-bold text-purple-700 dark:text-purple-300">
                                          + Thêm công việc mới vào Giai đoạn {sIdx + 1}:
                                        </div>
                                        <input
                                          type="text"
                                          value={quickStageTaskForm.title}
                                          onChange={(e) => setQuickStageTaskForm({ ...quickStageTaskForm, title: e.target.value })}
                                          placeholder="Nhập tên công việc cụ thể..."
                                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-medium"
                                          autoFocus
                                        />
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                                          <select
                                            value={quickStageTaskForm.dept}
                                            onChange={(e) => setQuickStageTaskForm({ ...quickStageTaskForm, dept: e.target.value })}
                                            className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-[11px] font-bold"
                                          >
                                            {DEPARTMENTS.filter((d) => d.id !== "all").map((d) => (
                                              <option key={d.id} value={d.id}>🏢 {d.id}</option>
                                            ))}
                                          </select>
                                          <input
                                            type="text"
                                            value={quickStageTaskForm.assignee}
                                            onChange={(e) => setQuickStageTaskForm({ ...quickStageTaskForm, assignee: e.target.value })}
                                            placeholder="Người thực hiện..."
                                            className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-[11px]"
                                          />
                                          <DateInputVN
                                            value={quickStageTaskForm.due}
                                            onChange={(e) => setQuickStageTaskForm({ ...quickStageTaskForm, due: e.target.value })}
                                            className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-[11px]"
                                          />
                                        </div>
                                        <div className="flex items-center justify-end gap-1.5">
                                          <button
                                            type="button"
                                            onClick={() => setQuickTaskStageKey(null)}
                                            className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                                          >
                                            Hủy
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleAddQuickStageTask(prj.id, stg.id)}
                                            className="px-3 py-1 rounded-lg text-[10px] font-bold bg-purple-600 hover:bg-purple-700 text-white cursor-pointer"
                                          >
                                            Lưu công việc
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Card Footer: 4 Quick Cross-Module Actions */}
                      <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-1.5 flex-wrap text-xs">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDept(prj.dept === "Liên Phòng Ban" || (Array.isArray(prj.participatingDepts) && prj.participatingDepts.length > 1) ? "all" : prj.dept);
                              setSearchQuery(prj.id);
                              setActiveSubTab("tasks");
                            }}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 cursor-pointer inline-flex items-center gap-1"
                            title="Mở Bảng Công Việc của tất cả các phòng ban thuộc dự án này"
                          >
                            <ListTodo className="w-3 h-3" />
                            <span>
                              Bảng việc ({Math.max(
                                tasks.filter((t: any) =>
                                  String(t.related_workflow_code || "").toUpperCase() === String(prj.id || "").toUpperCase() ||
                                  String(t.task_code || "").toUpperCase().startsWith(`TSK-${String(prj.id || "").toUpperCase()}-S`)
                                ).length,
                                allStageTasks.length,
                                stages.length
                              )})
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => openEditThematicModal(prj)}
                            className="px-2 py-1 rounded-lg text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 cursor-pointer"
                            title="Quản lý chi tiết các giai đoạn và danh sách công việc trong dự án"
                          >
                            + Giai đoạn / Việc
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              const partDepts = Array.isArray(prj.participatingDepts) ? prj.participatingDepts : [];
                              const srcDept = partDepts[0] || (prj.dept !== "Liên Phòng Ban" ? prj.dept : "Kinh Doanh");
                              const dstDept = partDepts[1] || "Application";
                              setWfForm((prev) => ({
                                ...prev,
                                title: `[${prj.id}] Phối hợp dự án: ${prj.name}`,
                                requester_name: prj.lead || currentStaffName,
                                requester_dept: srcDept,
                                target_dept: dstDept,
                                customer_name: prj.customerOrRef || "",
                                due_date: prj.endDate || toVNDateString(new Date(Date.now() + 5 * 86400000)),
                                description: `Phiếu phối hợp liên phòng ban thuộc Dự án [${prj.id}] ${prj.name}.\nMục tiêu: ${prj.description || ""}`
                              }));
                              setIsWorkflowModalOpen(true);
                            }}
                            className="px-2 py-1 rounded-lg text-[11px] font-bold bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 hover:bg-purple-100 cursor-pointer"
                            title="Tạo phiếu Quy trình phối hợp liên phòng ban cho dự án này"
                          >
                            ⚡ + Phối hợp WF
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              const stageActors = stages.flatMap((s: any) => [
                                s.assignee,
                                ...(Array.isArray(s.tasks) ? s.tasks.map((t: any) => t.assignee) : [])
                              ]).filter(Boolean);
                              const allMembers = Array.from(new Set([
                                ...(Array.isArray(prj.collaborators) ? prj.collaborators : []),
                                ...stageActors
                              ])).filter((m) => m && !sameStaffName(m, prj.lead || currentStaffName));
                              openScheduleForm(todayVN(), undefined, "MEETING");
                              setScheduleForm((prev) => ({
                                ...prev,
                                title: `Họp điều phối Dự án [${prj.id}] ${prj.name}`,
                                actor: prj.lead || currentStaffName,
                                coActors: allMembers,
                                category: prj.dept === "Liên Phòng Ban" ? (prj.participatingDepts?.[0] || "Kinh Doanh") : prj.dept,
                                meetingAgenda: `Rà soát tiến độ ${stages.length} giai đoạn của Dự án [${prj.id}] ${prj.name} (${completedStages}/${totalStages} hoàn thành).`,
                                linkedTaskCodes: stages.map((_: any, i: number) => `TSK-${prj.id}-S${i + 1}`)
                              }));
                            }}
                            className="px-2 py-1 rounded-lg text-[11px] font-bold bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 hover:bg-rose-100 cursor-pointer"
                            title="Đặt lịch họp điều phối dự án với toàn bộ thành viên các phòng ban"
                          >
                            🎥 + Họp dự án
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: NHẬT KÝ DAILY - KẾT NỐI KẾ HOẠCH TUẦN & CHỈ ĐẠO 2 CHIỀU */}
      {activeSubTab === "daily" && (
        <div className="space-y-5">
          {/* Top Control Bar: Weekday Navigator & Personnel Filter */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs space-y-3.5">
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
              {/* Weekday Switcher */}
              <div className="space-y-1.5 w-full lg:w-auto">
                <div className="flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Chọn ngày báo cáo theo Kế hoạch tuần (Tuần {viewedWeek.weekNo}):
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"].map((day) => {
                    const isSelected = selectedDailyDay === day;
                    const dayObj = viewedWeek.days.find(d => d.name === day) || { name: day, date: todayVN(), label: "" };
                    const staff = activeDailyStaff;
                    const activeDept = selectedDept !== "all" ? selectedDept : (rolePerspective === "manager" ? managerDept : "");
                    // Count planned items for this exact date in the current viewed week + active tasks
                    const schedCount = weeklySchedule.filter(s => {
                      if (!scheduleOnDay(s, dayObj)) return false;
                      if (staff && s.actor) {
                        const actors = String(s.actor || "").split(",").map((a: string) => a.trim()).filter(Boolean);
                        if (actors.some((a: string) => sameStaffName(a, staff))) return true;
                        return s.actor.toLowerCase().includes(staff.toLowerCase()) || staff.toLowerCase().includes(s.actor.toLowerCase());
                      }
                      if (activeDept && !isSameWorkspaceDept(s.category, activeDept)) return false;
                      return true;
                    }).length;
                    const taskCountForDay = tasks.filter((t: any) => {
                      const cleanA = cleanWorkspaceAssignee(t.assignee_name);
                      if (staff) {
                        if (!cleanA || !sameStaffName(cleanA, staff)) return false;
                      } else if (activeDept && !isSameWorkspaceDept(t.department, activeDept)) {
                        return false;
                      }
                      const dl = t.deadline ? String(t.deadline).slice(0, 10) : "";
                      if (t.status === "IN_PROGRESS") return true;
                      if (t.status === "TODO" && (!dl || dl <= dayObj.date)) return true;
                      if (t.status === "DONE" && dl === dayObj.date) return true;
                      return false;
                    }).length;
                    const dayItemCount = schedCount + taskCountForDay;

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
                        <span>{day}{dayObj.label ? ` (${dayObj.label})` : ""}</span>
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

              {/* Staff / Department Context (Chỉ hiển thị đúng nhân sự thuộc Phòng ban đang chọn) */}
              <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto shrink-0">
                {rolePerspective === "director" || rolePerspective === "manager" ? (
                  <div className="flex items-center gap-2 min-w-[290px]">
                    <span className="text-xs text-slate-500 font-semibold shrink-0">
                      Nhân sự ({selectedDept !== "all" ? selectedDept : (rolePerspective === "manager" ? managerDept : "Toàn công ty")}):
                    </span>
                    <SearchablePersonnelSelect
                      value={activeDailyStaff}
                      onChange={(val) => setSelectedDailyStaff(val)}
                      personnelList={departmentStaffList}
                      filterDepartment={selectedDept !== "all" ? selectedDept : (rolePerspective === "manager" ? managerDept : "all")}
                      placeholder={
                        selectedDept !== "all"
                          ? `Chọn nhân sự thuộc ${selectedDept} (${departmentStaffList.length} người)...`
                          : "Chọn nhân sự để theo dõi..."
                      }
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

            {/* Quick Department-Scoped Staff Chips in Daily Log */}
            {(rolePerspective === "director" || rolePerspective === "manager") && departmentStaffList.length > 0 && (
              <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center gap-1.5 overflow-x-auto no-scrollbar text-xs">
                <span className="text-[11px] font-bold text-slate-500 shrink-0 mr-1 flex items-center gap-1">
                  <Users className="w-3.5 h-3.5 text-indigo-500" />
                  <span>
                    Nhân sự {selectedDept !== "all" ? `phòng ${selectedDept}` : "toàn công ty"} ({departmentStaffList.length}):
                  </span>
                </span>
                {departmentStaffList.map((p: any) => {
                  const name = p.full_name || p;
                  const isSelected = sameStaffName(activeDailyStaff, name);
                  const activeTaskCount = tasks.filter((t: any) => {
                    const cleanA = cleanWorkspaceAssignee(t.assignee_name);
                    return cleanA && sameStaffName(cleanA, name) && t.status !== "DONE";
                  }).length;
                  return (
                    <button
                      key={p.id || p.employee_code || name}
                      type="button"
                      onClick={() => setSelectedDailyStaff(name)}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs transition-all shrink-0 cursor-pointer border ${
                        isSelected
                          ? "bg-indigo-600 text-white border-indigo-600 font-bold shadow-xs"
                          : "bg-slate-50 dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-300"
                      }`}
                    >
                      <span>{name}</span>
                      {activeTaskCount > 0 && (
                        <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold font-mono ${
                          isSelected
                            ? "bg-white/20 text-white"
                            : "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300"
                        }`}>
                          {activeTaskCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Main 2-Column Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column (7 cols): Planned Items & Quick Input & Evaluation */}
            <div className="lg:col-span-7 space-y-4">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <ListChecks className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
                        <span>Công Việc Trong Ngày • {selectedDailyDay}</span>
                        {activeDailyStaff && (
                          <span className="px-2 py-0.5 rounded-lg text-xs font-extrabold bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                            👤 {activeDailyStaff}
                          </span>
                        )}
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        Hiển thị rõ nguồn gốc công việc từ từng Tab • Bấm vào nhãn nguồn để mở xem chi tiết tại Tab gốc
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

                {/* Source Tab Filter & Legend Bar */}
                {dailyPlanItems.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap pb-1 text-[11px]">
                    <span className="font-bold text-slate-400 mr-1">Lọc theo Tab nguồn:</span>
                    {[
                      { id: "all", label: "Tất cả nguồn", count: dailyPlanItems.length },
                      {
                        id: "tasks",
                        label: "📋 Tab Bảng Công Việc",
                        count: dailyPlanItems.filter(it => getDailyItemOriginMeta(it).originTab === "tasks").length
                      },
                      {
                        id: "workflows",
                        label: "🔄 Tab Quy Trình Phối Hợp",
                        count: dailyPlanItems.filter(it => getDailyItemOriginMeta(it).originTab === "workflows").length
                      },
                      {
                        id: "planner_schedule",
                        label: "📅 Tab Lịch & Kế Hoạch (Lịch tuần)",
                        count: dailyPlanItems.filter(it => getDailyItemOriginMeta(it).originTab === "planner_schedule").length
                      },
                      {
                        id: "planner_thematic",
                        label: "🎯 Tab Lịch & Kế Hoạch (Chuyên đề)",
                        count: dailyPlanItems.filter(it => getDailyItemOriginMeta(it).originTab === "planner_thematic").length
                      },
                      {
                        id: "extra",
                        label: "⚡ Phát sinh tại Nhật ký",
                        count: dailyPlanItems.filter(it => getDailyItemOriginMeta(it).originTab === "extra").length
                      }
                    ]
                      .filter(f => f.id === "all" || f.count > 0)
                      .map(f => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setDailySourceFilter(f.id)}
                          className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer border ${
                            dailySourceFilter === f.id
                              ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white shadow-2xs"
                              : "bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                          }`}
                        >
                          {f.label} ({f.count})
                        </button>
                      ))}
                  </div>
                )}

                {/* List of Planned Items */}
                <div className="space-y-3">
                  {dailyPlanItems.filter(it => dailySourceFilter === "all" || getDailyItemOriginMeta(it).originTab === dailySourceFilter).length > 0 ? (
                    dailyPlanItems
                      .filter(it => dailySourceFilter === "all" || getDailyItemOriginMeta(it).originTab === dailySourceFilter)
                      .map((item, idx) => {
                        const originMeta = getDailyItemOriginMeta(item);
                        return (
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
                            {/* Top row: Source Tab Banner + Status switcher + Title + Category + Remove */}
                            <div className="flex items-start justify-between gap-2 flex-wrap">
                              <div className="flex-1 min-w-[220px]">
                                {/* Crystal-clear Source Tab Identification Row */}
                                <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                                  <span className="font-mono text-[11px] font-extrabold text-slate-400">
                                    #{idx + 1}
                                  </span>
                                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold ${originMeta.badgeClass}`}>
                                    {originMeta.badgeLabel}
                                  </span>
                                  {originMeta.subDetail && (
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                      {originMeta.subDetail}
                                    </span>
                                  )}
                                  {item.category && (
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                                      🏢 {item.category}
                                    </span>
                                  )}
                                  {item.location && (
                                    <span className="text-[10px] text-slate-500 font-medium">
                                      📍 {item.location}
                                    </span>
                                  )}
                                  {originMeta.actionLabel && (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenDailyItemSource(item)}
                                      className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-100 border border-indigo-200 dark:border-indigo-800 transition-colors cursor-pointer"
                                      title="Mở xem công việc này tại Tab nguồn"
                                    >
                                      {originMeta.actionLabel}
                                    </button>
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
                        );
                      })
                  ) : (
                    <div className="p-6 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl space-y-2">
                      <div className="text-slate-400 text-xs italic">
                        Chưa có công việc nào trong kế hoạch tuần hoặc bảng việc của {selectedDailyDay} ({activeDailyStaff || currentStaffName}).
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
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 gap-2 flex-wrap">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      Nhật Ký &amp; Chỉ Đạo Điều Hành
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Trao đổi 2 chiều: Chỉ đạo của Quản lý ⇄ Phản hồi của Nhân sự
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {(rolePerspective === "director" || rolePerspective === "manager") && activeDailyStaff && (
                      <div className="inline-flex rounded-lg p-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-bold">
                        <button
                          type="button"
                          onClick={() => setDailyLogStaffScope("dept")}
                          className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                            dailyLogStaffScope === "dept"
                              ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-2xs"
                              : "text-slate-500 hover:text-slate-700"
                          }`}
                        >
                          🏢 {selectedDept !== "all" ? selectedDept : "Cả công ty"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDailyLogStaffScope("selected_staff")}
                          className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                            dailyLogStaffScope === "selected_staff"
                              ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-2xs"
                              : "text-slate-500 hover:text-slate-700"
                          }`}
                        >
                          👤 {activeDailyStaff}
                        </button>
                      </div>
                    )}
                    <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                      {filteredDailyLogs.length} báo cáo
                    </span>
                  </div>
                </div>

                <div className="space-y-4 max-h-[850px] overflow-y-auto pr-1">
                  {dailyLogsPage.items.map((log) => {
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
                              📅 {log.log_date ? formatDayVN(log.log_date) : ""}
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
                              {parsedItems.map((pi: any, pIdx: number) => {
                                const piOrigin = getDailyItemOriginMeta(pi);
                                return (
                                  <div
                                    key={pIdx}
                                    className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 text-[11px] space-y-1.5"
                                  >
                                    <div className="flex items-center justify-between gap-1.5 flex-wrap">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold ${piOrigin.badgeClass}`}>
                                          {piOrigin.badgeLabel}
                                        </span>
                                        {piOrigin.subDetail && (
                                          <span className="text-[9px] font-semibold text-slate-500">
                                            {piOrigin.subDetail}
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        {piOrigin.actionLabel && (
                                          <button
                                            type="button"
                                            onClick={() => handleOpenDailyItemSource(pi)}
                                            className="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                                          >
                                            {piOrigin.actionLabel}
                                          </button>
                                        )}
                                        {pi.work_hours && (
                                          <span className="text-slate-400 font-mono text-[10px]">{pi.work_hours}h</span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="font-bold text-slate-800 dark:text-slate-200">
                                      {pi.status === "completed" ? "🟢" : pi.status === "partial" ? "🟡" : "🔴"} {pi.title}
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
                                );
                              })}
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
                                    {new Date(log.manager_feedback_at).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" })}
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
                                    {new Date(log.staff_feedback_at).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" })}
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
                <Pager p={dailyLogsPage} unit="báo cáo nhật ký" />
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
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-xs font-bold border border-indigo-200 dark:border-indigo-800">
                    <Activity className="w-3.5 h-3.5" />
                    <span>BÁO CÁO HIỆU SUẤT ĐIỀU HÀNH • {analyticsData.scopeTitle.toUpperCase()}</span>
                  </div>
                  <div className="inline-flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700">
                    {([
                      { id: "today", label: "Hôm nay" },
                      { id: "week", label: "Tuần này" },
                      { id: "month", label: "Tháng này" },
                      { id: "all", label: "Tất cả" }
                    ] as const).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setAnalyticsPeriod(p.id)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                          analyticsPeriod === p.id
                            ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-2xs"
                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight">
                  Phân Tích Hiệu Suất Tổng Hợp: Công Việc • Quy Trình SLA • Kế Hoạch • Nhật Ký Daily
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 max-w-3xl leading-relaxed">
                  Hệ thống đối soát chéo 4 trụ cột theo dữ liệu thực tế ({analyticsData.periodLabel}): Thực thi công việc (35%) • Phối hợp liên phòng SLA (20%) • Kế hoạch/Lịch tuần (25%) • Kỷ luật báo cáo Daily (20%).
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
                    ? `${analyticsData.doneWf} xong • ${analyticsData.pendingWf} đang chạy${analyticsData.cancelledWf > 0 ? ` • ${analyticsData.cancelledWf} hủy` : ""}${analyticsData.overdueWf > 0 ? ` • ${analyticsData.overdueWf} trễ` : ""}`
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
                  {analyticsData.totalDailyReportsCount} báo cáo đã nộp •{" "}
                  {analyticsData.realIssues.length > 0
                    ? `${analyticsData.realIssues.length} vướng mắc phát sinh`
                    : "0 vướng mắc"}
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
                    Chi tiết phân bổ khối lượng, tỷ lệ hoàn tất và tốc độ giải quyết việc giữa các khối phòng ban ({analyticsData.totalTasks} việc)
                  </p>
                </div>
              </div>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300">
                Hiệu suất thực thi: {analyticsData.taskCompletionRate}/100
              </span>
            </div>

            {/* Department Breakdown Grid - Synchronized 100% with analyticsData.deptScorecards */}
            <div className={`grid grid-cols-1 gap-3 ${analyticsData.deptScorecards.length > 4 ? "md:grid-cols-5" : "md:grid-cols-4"}`}>
              {analyticsData.deptScorecards.map((ds) => {
                const Icon =
                  ds.dept === "Kinh Doanh"
                    ? Briefcase
                    : ds.dept === "Application"
                    ? FlaskConical
                    : ds.dept === "Kho & Vận Hành"
                    ? Package
                    : ds.dept === "Cung Ứng"
                    ? ShoppingCart
                    : Building2;

                return (
                  <div key={ds.dept} className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 rounded-xl p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Icon className="w-4 h-4 text-slate-600 dark:text-slate-300 shrink-0" />
                        <span className="text-xs font-bold text-slate-900 dark:text-white truncate">{ds.dept}</span>
                      </div>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shrink-0">
                        {ds.totalTasks} việc
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-slate-500">Hoàn thành:</span>
                      <span className="font-mono font-black text-slate-900 dark:text-white">{ds.doneTasks}/{ds.totalTasks} ({ds.taskPercent}%)</span>
                    </div>

                    <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                      <div className="bg-indigo-600 h-full rounded-full transition-all" style={{ width: `${ds.taskPercent}%` }} />
                    </div>

                    <div className="grid grid-cols-3 gap-1 text-[10px] text-center pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                      <div className="bg-amber-100/60 dark:bg-amber-950/40 rounded p-1 text-amber-800 dark:text-amber-300">
                        <strong>{ds.todoTasks}</strong> Cần làm
                      </div>
                      <div className="bg-blue-100/60 dark:bg-blue-950/40 rounded p-1 text-blue-800 dark:text-blue-300">
                        <strong>{ds.inProgTasks}</strong> Đang chạy
                      </div>
                      <div className="bg-emerald-100/60 dark:bg-emerald-950/40 rounded p-1 text-emerald-800 dark:text-emerald-300">
                        <strong>{ds.doneTasks}</strong> Xong
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
                    ? `Hệ thống ghi nhận ${analyticsData.totalWf} phiếu phối hợp luân chuyển liên phòng ban (${analyticsData.doneWf} hoàn tất, ${analyticsData.pendingWf} đang xử lý${analyticsData.cancelledWf > 0 ? `, ${analyticsData.cancelledWf} đã hủy` : ""}). Tỷ lệ xử lý đúng cam kết SLA đạt ${analyticsData.wfSlaRate}%.`
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
                    ? `Có ${analyticsData.overdueWf} phiếu luân chuyển đang vượt quá thời hạn cam kết xử lý tại bước của: ${analyticsData.overdueDepts.join(", ") || "bộ phận phụ trách"}. Đề nghị Trưởng bộ phận liên quan rà soát và tháo gỡ ngay.`
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
                    Đánh giá tính kỷ luật báo cáo theo số nhân sự duy nhất đã nộp trong kỳ ({analyticsData.periodLabel}), trích xuất vướng mắc và kế hoạch tiếp theo
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
                <span className="font-bold text-slate-700 dark:text-slate-300 block">📊 Tỷ Lệ Nhân Sự Nộp Báo Cáo Daily</span>
                <div className="space-y-1.5 pt-1">
                  {analyticsData.deptScorecards.map((ds) => (
                    <div key={ds.dept} className="flex justify-between text-[11px]">
                      <span>{ds.dept}:</span>
                      <strong className={ds.dailyCount > 0 ? "text-emerald-600" : "text-slate-400"}>
                        {ds.dailyCount}/{ds.staffCount} NS ({ds.dailyPercent}%)
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
                    Bảng điểm 4 trụ cột đồng nhất: Thực thi công việc (35%) + Phối hợp SLA (20%) + Kế hoạch/Lịch tuần (25%) + Kỷ luật Daily (20%)
                  </p>
                </div>
              </div>
              <span className="text-xs font-mono font-bold text-slate-500">
                Kỳ đánh giá: {analyticsData.periodLabel}
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
                    <th className="py-2.5 px-3">Phối hợp SLA</th>
                    <th className="py-2.5 px-3">Kế hoạch / Lịch tuần</th>
                    <th className="py-2.5 px-3">Kỷ luật Daily</th>
                    <th className="py-2.5 px-3">Điểm KPI Tổng</th>
                    <th className="py-2.5 px-3 text-right">Xếp loại</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {analyticsData.deptScorecards.map((ds) => {
                    const Icon =
                      ds.dept === "Application"
                        ? FlaskConical
                        : ds.dept === "Kinh Doanh"
                        ? Briefcase
                        : ds.dept === "Kho & Vận Hành"
                        ? Package
                        : ds.dept === "Cung Ứng"
                        ? ShoppingCart
                        : Building2;
                    const iconColor =
                      ds.dept === "Application"
                        ? "text-purple-600"
                        : ds.dept === "Kinh Doanh"
                        ? "text-orange-600"
                        : ds.dept === "Kho & Vận Hành"
                        ? "text-emerald-600"
                        : ds.dept === "Cung Ứng"
                        ? "text-blue-600"
                        : "text-slate-600";

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
                        <td className="py-2.5 px-3 font-semibold text-purple-600">
                          {ds.wfCount > 0
                            ? `${ds.wfCount} phiếu (${ds.wfSlaPercent}% SLA${ds.overdueWfCount > 0 ? ` • ${ds.overdueWfCount} trễ` : ""})`
                            : "Chưa phát sinh"}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-700 dark:text-slate-300">
                          {ds.plansCount > 0
                            ? `${ds.plansCount} chuyên đề (${ds.planPercent}%)`
                            : ds.schedulesCount > 0
                            ? `${ds.schedulesCount} lịch tuần (${ds.planPercent}%)`
                            : "Chưa thiết lập"}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-indigo-600">
                          {ds.dailyCount}/{ds.staffCount} NS ({ds.dailyPercent}%)
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
                      <strong>Thúc đẩy hoàn thành công việc:</strong> Tập trung đẩy nhanh tiến độ {analyticsData.inProgressTasks} đầu việc đang thực hiện và {analyticsData.todoTasks} việc chờ xử lý trên toàn hệ thống để nâng cao tỷ lệ hoàn thành chung ({analyticsData.taskCompletionRate}%).
                    </li>
                    {analyticsData.overdueWf > 0 && (
                      <li>
                        <strong>Xử lý phiếu luân chuyển trễ hạn:</strong> Bộ phận{" "}
                        <strong>{analyticsData.overdueDepts.join(", ") || "liên quan"}</strong> cần ưu tiên xử lý dứt điểm {analyticsData.overdueWf} phiếu phối hợp đang quá hạn SLA.
                      </li>
                    )}
                    {analyticsData.realIssues.length > 0 && (
                      <li>
                        <strong>Tháo gỡ vướng mắc nhân sự:</strong> Ban Giám Đốc và các Trưởng phòng cần kiểm tra {analyticsData.realIssues.length} khó khăn được ghi nhận trong Nhật Ký Daily để kịp thời chỉ đạo hỗ trợ.
                      </li>
                    )}
                    <li>
                      <strong>Duy trì kỷ luật báo cáo:</strong> Tiếp tục đôn đốc tỷ lệ nộp báo cáo daily ({analyticsData.dailySubmittedCount}/{analyticsData.staffCount} nhân sự trong kỳ) hướng tới mục tiêu 100% nhân sự toàn công ty.
                    </li>
                  </>
                )}
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 6: THÔNG BÁO, QUYẾT ĐỊNH & VĂN BẢN ĐIỀNH HÀNH (ENTERPRISE ANNOUNCEMENTS) ==================== */}
      {activeSubTab === "announcements" && (() => {
        const normAnnDate = (raw: any): string => {
          const s = String(raw || "").trim();
          if (!s) return "";
          const datePart = s.split(/[ T]/)[0];
          if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
          const dmy = datePart.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
          if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
          return datePart;
        };

        const getAnnCreatedEpoch = (ann: any): number => {
          const idMatch = String(ann?.id || "").match(/^ANN-(\d{10,})$/);
          if (idMatch) {
            return Number(idMatch[1]);
          }
          const rawTime = String(ann?.createdAt || ann?.acknowledgedBy?.[0]?.time || "").trim();
          if (rawTime) {
            const parts = rawTime.split(/[ T]/);
            const d = normAnnDate(parts[0]);
            const t = parts[1] ? (parts[1].length === 5 ? `${parts[1]}:00` : parts[1]) : "00:00:00";
            const ms = Date.parse(`${d}T${t}+07:00`);
            if (!isNaN(ms)) return ms;
          }
          const dIssue = normAnnDate(ann?.issueDate);
          if (dIssue) {
            const ms = Date.parse(`${dIssue}T00:00:00+07:00`);
            if (!isNaN(ms)) return ms;
          }
          return 0;
        };

        const filteredAnnouncements = (announcements || [])
          .map((ann: any, _idx: number) => ({ ann, _idx }))
          .filter(({ ann }) => {
            // Lọc theo phòng ban đang chọn trên thanh Level 2
            if (selectedDept !== "all") {
              const appliesToSelectedDept =
                ann.targetScope === "ALL" ||
                !ann.targetScope ||
                (Array.isArray(ann.targetDepts) && ann.targetDepts.some((d: string) => isSameWorkspaceDept(d, selectedDept))) ||
                isSameWorkspaceDept(ann.issuerDept, selectedDept);
              if (!appliesToSelectedDept) return false;
            }
            // Lọc theo phân loại văn bản
            if (announcementCategoryFilter === "UNACKNOWLEDGED") {
              if (!(ann.requireAck !== false && isUserTargetedByAnnouncement(ann) && !hasUserAcknowledgedAnnouncement(ann))) {
                return false;
              }
            } else if (announcementCategoryFilter !== "all" && ann.docType !== announcementCategoryFilter) {
              return false;
            }
            // Lọc theo khoảng ngày (Từ ngày -> Đến ngày) dựa trên Ngày ban hành hoặc Ngày đăng
            if (announcementFromDate || announcementToDate) {
              const issueD = normAnnDate(ann.issueDate);
              const createdD = normAnnDate(ann.createdAt || ann?.acknowledgedBy?.[0]?.time);
              const checkDate = (d: string) => {
                if (!d) return false;
                if (announcementFromDate && d < announcementFromDate) return false;
                if (announcementToDate && d > announcementToDate) return false;
                return true;
              };
              if (!checkDate(issueD) && !checkDate(createdD)) return false;
            }
            // Lọc theo ô tìm kiếm
            if (searchQuery.trim()) {
              const q = canonStaffName(searchQuery);
              const hay = canonStaffName(
                `${ann.docCode || ""} ${ann.title || ""} ${ann.summary || ""} ${ann.content || ""} ${ann.issuerName || ""}`
              );
              if (!hay.includes(q)) return false;
            }
            return true;
          })
          .sort((itemA, itemB) => {
            const a = itemA.ann;
            const b = itemB.ann;
            if (announcementSortBy === "pinned_first") {
              if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
            }
            if (announcementSortBy === "issue_asc") {
              const cmpAsc = normAnnDate(a.issueDate).localeCompare(normAnnDate(b.issueDate));
              if (cmpAsc !== 0) return cmpAsc;
              return getAnnCreatedEpoch(a) - getAnnCreatedEpoch(b);
            }
            if (announcementSortBy === "issue_desc") {
              const cmpDesc = normAnnDate(b.issueDate).localeCompare(normAnnDate(a.issueDate));
              if (cmpDesc !== 0) return cmpDesc;
              return getAnnCreatedEpoch(b) - getAnnCreatedEpoch(a);
            }
            // Mặc định ("newest"): Thông báo mới tạo / mới ban hành nhất luôn nằm trên cùng
            const timeDiff = getAnnCreatedEpoch(b) - getAnnCreatedEpoch(a);
            if (timeDiff !== 0) return timeDiff;
            const issueDiff = normAnnDate(b.issueDate).localeCompare(normAnnDate(a.issueDate));
            if (issueDiff !== 0) return issueDiff;
            return itemA._idx - itemB._idx;
          })
          .map((x) => x.ann);

        const decisionCount = (announcements || []).filter((a: any) => a.docType === "DECISION").length;
        const policyCount = (announcements || []).filter((a: any) => a.docType === "POLICY" || a.docType === "SALES_POLICY").length;

        // Tính tỷ lệ xác nhận đọc trung bình toàn công ty
        let totalAckPossible = 0;
        let totalAckDone = 0;
        (announcements || []).forEach((ann: any) => {
          if (ann.requireAck === false) return;
          const targets = getTargetStaffForAnnouncement(ann);
          const acked = targets.filter((t) => hasUserAcknowledgedAnnouncement(ann, t.name));
          totalAckPossible += Math.max(1, targets.length);
          totalAckDone += acked.length;
        });
        const overallAckRate = totalAckPossible > 0 ? Math.min(100, Math.round((totalAckDone / totalAckPossible) * 100)) : 100;

        return (
          <div className="space-y-4">
            {/* 4 Thẻ KPI Điều Hành Văn Bản & Quyết Định */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-bold text-slate-400 uppercase">Tổng Văn Bản Đã Ban Hành</span>
                  <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">{announcements.length}</div>
                  <span className="text-[11px] text-slate-500">
                    {announcements.filter((a: any) => a.pinned).length} văn bản đang ghim tiêu điểm
                  </span>
                </div>
                <div className="w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <FileText className="w-5 h-5" />
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 rounded-2xl p-4 shadow-xs flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-bold text-rose-600 dark:text-rose-400 uppercase">Cần Tôi Xác Nhận Đã Đọc</span>
                  <div className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-1">
                    {unacknowledgedAnnouncementsForMe.length}
                  </div>
                  <span className="text-[11px] text-slate-500">
                    {unacknowledgedAnnouncementsForMe.length === 0
                      ? "✅ Bạn đã xác nhận đủ 100%"
                      : "⏳ Bấm xác nhận để hoàn tất"}
                  </span>
                </div>
                <div className="w-11 h-11 rounded-2xl bg-rose-50 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400 flex items-center justify-center">
                  <Bell className="w-5 h-5" />
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-bold text-slate-400 uppercase">Quyết Định BGĐ &amp; Quy Chế SOP</span>
                  <div className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-1">
                    {decisionCount} QĐ • {policyCount} SOP
                  </div>
                  <span className="text-[11px] text-slate-500">Lưu trữ chuẩn hóa theo số hiệu</span>
                </div>
                <div className="w-11 h-11 rounded-2xl bg-purple-50 dark:bg-purple-950/70 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5" />
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/60 rounded-2xl p-4 shadow-xs flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">Tỷ Lệ Nhân Sự Đã Đọc</span>
                  <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{overallAckRate}%</div>
                  <span className="text-[11px] text-slate-500">Giám sát ký nhận đọc (Read Receipt)</span>
                </div>
                <div className="w-11 h-11 rounded-2xl bg-emerald-50 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <UserCheck className="w-5 h-5" />
                </div>
              </div>
            </div>

            {/* Thanh Lọc Nhanh Theo Loại Văn Bản + Nút Ban Hành */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 shadow-xs flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                {[
                  { id: "all", label: `📋 Tất cả (${announcements.length})` },
                  { id: "DECISION", label: `📜 Quyết định BGĐ (${decisionCount})` },
                  { id: "ANNOUNCEMENT", label: "📢 Thông báo nội bộ" },
                  { id: "POLICY", label: "📘 Quy chế / SOP" },
                  { id: "SALES_POLICY", label: "💼 Chính sách KD & Thưởng" },
                  { id: "RECOGNITION", label: "🏆 Vinh danh & Nhân sự" },
                  {
                    id: "UNACKNOWLEDGED",
                    label: `⏳ Chưa xác nhận đọc (${unacknowledgedAnnouncementsForMe.length})`
                  }
                ].map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setAnnouncementCategoryFilter(cat.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      announcementCategoryFilter === cat.id
                        ? cat.id === "UNACKNOWLEDGED"
                          ? "bg-rose-600 text-white shadow-xs"
                          : "bg-indigo-600 text-white shadow-xs"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Bộ lọc Từ ngày - Đến ngày & Sắp xếp trực tiếp trên thanh phân loại */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-xs">
                  <Calendar className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                  <span className="text-[11px] font-semibold text-slate-500 whitespace-nowrap">Từ ngày:</span>
                  <DateInputVN
                    value={announcementFromDate}
                    onChange={(e) => setAnnouncementFromDate(e.target.value)}
                    className="text-xs font-bold bg-transparent text-slate-900 dark:text-white focus:outline-none w-[112px]"
                  />
                  <span className="text-slate-400">→</span>
                  <span className="text-[11px] font-semibold text-slate-500 whitespace-nowrap">Đến ngày:</span>
                  <DateInputVN
                    value={announcementToDate}
                    onChange={(e) => setAnnouncementToDate(e.target.value)}
                    className="text-xs font-bold bg-transparent text-slate-900 dark:text-white focus:outline-none w-[112px]"
                  />
                  {(announcementFromDate || announcementToDate) && (
                    <button
                      type="button"
                      onClick={() => {
                        setAnnouncementFromDate("");
                        setAnnouncementToDate("");
                      }}
                      className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/70 text-rose-600 dark:text-rose-300 text-[10px] font-bold hover:bg-rose-200 cursor-pointer"
                    >
                      ✕ Tất cả ngày
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Danh sách Thông báo, Quyết định & Quy chế */}
            {filteredAnnouncements.length === 0 ? (
              <div className="bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-800 rounded-2xl p-10 text-center space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
                  <FileText className="w-7 h-7" />
                </div>
                <div className="space-y-1 max-w-lg mx-auto">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Chưa có Thông báo hoặc Quyết định nào trong mục này
                  </h3>
                  <p className="text-xs text-slate-500">
                    Ban Giám Đốc và Trưởng bộ phận có thể ban hành Quyết định (`QĐ`), Thông báo hành chính (`TB`), Quy trình chuẩn (`SOP`), hoặc Chính sách kinh doanh (`CS`) kèm file đóng dấu, tự động nhắn tin Chat thông báo và theo dõi danh sách nhân sự xác nhận đã đọc.
                  </p>
                </div>
                <div className="flex items-center justify-center pt-2">
                  <button
                    type="button"
                    onClick={() => openCreateAnnouncementModal("DECISION")}
                    className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs cursor-pointer shadow-sm"
                  >
                    📜 + Ban Hành Thông Báo / Quyết Định Mới
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredAnnouncements.map((ann: any) => {
                  const meta = getDocTypeMeta(ann.docType);
                  const targets = getTargetStaffForAnnouncement(ann);
                  const ackedList = targets.filter((t) => hasUserAcknowledgedAnnouncement(ann, t.name));
                  const unreadList = targets.filter((t) => !hasUserAcknowledgedAnnouncement(ann, t.name));
                  const ackPercent = targets.length > 0 ? Math.min(100, Math.round((ackedList.length / targets.length) * 100)) : 100;
                  const iAmTargeted = isUserTargetedByAnnouncement(ann);
                  const iHaveAcked = hasUserAcknowledgedAnnouncement(ann);
                  const scopeLabel =
                    ann.targetScope === "ALL" || !ann.targetScope
                      ? "🏢 Toàn công ty"
                      : ann.targetScope === "DEPARTMENTS"
                      ? `🏬 Phòng: ${(ann.targetDepts || []).join(", ")}`
                      : `👥 ${(ann.targetStaff || []).length} nhân sự chỉ định`;

                  return (
                    <div
                      key={ann.id}
                      className={`bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border transition-all shadow-xs hover:shadow-md ${
                        ann.pinned
                          ? "border-rose-300 dark:border-rose-800/90 ring-1 ring-rose-500/15"
                          : "border-slate-200 dark:border-slate-800"
                      }`}
                    >
                      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                        {/* Left: Document Info & Content Preview */}
                        <div className="space-y-2.5 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {ann.pinned && (
                              <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/90 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 text-[10px] font-extrabold">
                                📌 GHIM TIÊU ĐIỂM
                              </span>
                            )}
                            <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-extrabold ${meta.badgeClass}`}>
                              {meta.shortLabel}
                            </span>
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono font-bold text-[11px] border border-slate-200 dark:border-slate-700">
                              Số: {ann.docCode}
                            </span>
                            {ann.priority === "URGENT" && (
                              <span className="px-2 py-0.5 rounded-md bg-rose-600 text-white text-[10px] font-extrabold">
                                🚨 KHẨN CẤP / BẮT BUỘC
                              </span>
                            )}
                            {ann.priority === "IMPORTANT" && (
                              <span className="px-2 py-0.5 rounded-md bg-orange-100 dark:bg-orange-950 text-orange-800 dark:text-orange-300 text-[10px] font-bold border border-orange-200 dark:border-orange-800">
                                ⭐ QUAN TRỌNG
                              </span>
                            )}
                            <span className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-md">
                              {scopeLabel}
                            </span>
                          </div>

                          <div
                            onClick={() => setSelectedAnnouncementDetail(ann)}
                            className="cursor-pointer group"
                          >
                            <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                              {ann.title}
                            </h3>
                            {ann.summary && (
                              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mt-1">
                                {ann.summary}
                              </p>
                            )}
                            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 line-clamp-3 whitespace-pre-line leading-relaxed">
                              {ann.content}
                            </p>
                          </div>

                          {/* Metadata Row */}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[11px] text-slate-500">
                            <span>
                              ✍️ Người ký ban hành: <strong className="text-slate-800 dark:text-slate-200">{ann.issuerName}</strong> ({ann.issuerRole})
                            </span>
                            <span>
                              📅 Ngày ban hành: <strong className="text-slate-700 dark:text-slate-300">{formatDayVN(ann.issueDate)}</strong>
                            </span>
                            <span>
                              ⚡ Hiệu lực từ: <strong className="text-emerald-700 dark:text-emerald-400">{formatDayVN(ann.effectiveDate)}</strong>
                            </span>
                            {Array.isArray(ann.attachments) && ann.attachments.length > 0 && (
                              <span className="text-indigo-600 dark:text-indigo-400 font-bold flex items-center gap-1">
                                <Paperclip className="w-3 h-3" /> {ann.attachments.length} tệp văn bản gốc đính kèm
                              </span>
                            )}
                            {Array.isArray(ann.comments) && ann.comments.length > 0 && (
                              <span className="text-slate-600 dark:text-slate-300 font-semibold">
                                💬 {ann.comments.length} thảo luận
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Right: Read Receipt Progress & Action Buttons */}
                        <div className="lg:w-72 shrink-0 flex flex-col justify-between gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800">
                          {ann.requireAck !== false && (
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="font-bold text-slate-700 dark:text-slate-300">
                                  📊 Xác nhận đã đọc:
                                </span>
                                <span className="font-mono font-extrabold text-emerald-600 dark:text-emerald-400">
                                  {ackedList.length}/{targets.length} NS ({ackPercent}%)
                                </span>
                              </div>
                              <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all"
                                  style={{ width: `${ackPercent}%` }}
                                />
                              </div>
                              {unreadList.length > 0 ? (
                                <p className="text-[10px] text-amber-700 dark:text-amber-400 truncate">
                                  ⏳ Còn {unreadList.length} người chưa xác nhận: {unreadList.slice(0, 3).map((u) => u.name).join(", ")}
                                  {unreadList.length > 3 ? "..." : ""}
                                </p>
                              ) : (
                                <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                                  ✅ 100% nhân sự thuộc phạm vi đã đọc
                                </p>
                              )}
                            </div>
                          )}

                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            {ann.requireAck !== false && iAmTargeted && (
                              iHaveAcked ? (
                                <span className="w-full py-1.5 px-2.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 font-bold text-[11px] text-center">
                                  ✅ Bạn đã xác nhận đọc văn bản này
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleAcknowledgeAnnouncement(ann)}
                                  className="w-full py-1.5 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-[11px] shadow-xs cursor-pointer transition-colors"
                                >
                                  ✍️ Xác nhận: Tôi đã đọc &amp; Nắm rõ
                                </button>
                              )
                            )}

                            <button
                              type="button"
                              onClick={() => setSelectedAnnouncementDetail(ann)}
                              className="flex-1 py-1.5 px-2.5 rounded-lg bg-white dark:bg-slate-900 hover:bg-indigo-50 dark:hover:bg-slate-800 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-bold text-[11px] cursor-pointer"
                            >
                              👁️ Xem chi tiết &amp; DS đọc
                            </button>

                            {unreadList.length > 0 && (
                              <button
                                type="button"
                                disabled={sendingAnnouncementRemindId === ann.id}
                                onClick={() => handleRemindUnreadAnnouncement(ann)}
                                className="py-1.5 px-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-[11px] cursor-pointer"
                                title="Nhắn tin Chat & Chuông nhắc các nhân sự chưa xác nhận đọc"
                              >
                                {sendingAnnouncementRemindId === ann.id ? "Đang nhắc..." : `🔔 Nhắc (${unreadList.length})`}
                              </button>
                            )}
                          </div>

                          <div className="flex items-center justify-between gap-1 pt-1 border-t border-slate-200/70 dark:border-slate-800 text-[10px]">
                            <button
                              type="button"
                              onClick={() => handleCreateTaskFromAnnouncement(ann)}
                              className="font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                            >
                              ⚡ Giao việc từ văn bản
                            </button>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleTogglePinAnnouncement(ann)}
                                className="text-slate-500 hover:text-amber-600 font-semibold cursor-pointer"
                              >
                                {ann.pinned ? "Bỏ ghim" : "📌 Ghim"}
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditAnnouncementModal(ann)}
                                className="text-slate-500 hover:text-indigo-600 font-semibold cursor-pointer"
                              >
                                Sửa
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteAnnouncement(ann)}
                                className="text-rose-500 hover:text-rose-700 font-semibold cursor-pointer"
                              >
                                Xóa
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

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
                placeholder="Tìm & chọn nhân sự phụ trách..."
              />
            </div>

            {(() => {
              const isProcTask =
                isSameWorkspaceDept(taskForm.department, "Cung Ứng") ||
                /po|mua hàng|nhập khẩu|ncc|cung ứng|hải quan/i.test(taskForm.task_category || "");
              return (
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {isProcTask
                      ? "Nhà cung cấp / Đối tác / Khách hàng (Gõ để tìm nhanh)"
                      : "Khách hàng / Viện / Đối tác"}
                  </label>
                  <SearchableCustomerSelect
                    value={taskForm.customer_name}
                    onChange={(val) => setTaskForm({ ...taskForm, customer_name: val })}
                    customerList={customerList}
                    supplierList={supplierList}
                    prioritizeSuppliers={isProcTask}
                    placeholder={
                      isProcTask
                        ? "Gõ tìm Nhà cung cấp (VD: Meridian, Liferiver, SSI...) hoặc Khách hàng..."
                        : "Chọn hoặc gõ tìm khách hàng / đối tác (nếu có)"
                    }
                  />
                </div>
              );
            })()}
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
              <DateInputVN
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
                    accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.xml,.csv,.txt,.rtf,.zip,.rar,.7z,.tar,.gz"
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

          {/* TRAO ĐỔI 2 CHIỀU & CHỈ ĐẠO TIẾP THEO TRÊN CÔNG VIỆC */}
          {(() => {
            const wfCode = (taskForm as any).related_workflow_code;
            const wf = wfCode ? workflows.find((w: any) => w.workflow_code === wfCode) : null;
            const taskCommentLogs: any[] = Array.isArray((taskForm as any).logs)
              ? (taskForm as any).logs.filter((l: any) => l?.type === "comment")
              : [];
            const wfComments: any[] = wf && Array.isArray(wf.comments) ? wf.comments : [];

            // Gộp comment của Task và comment của Phiếu phối hợp (nếu có) không trùng lặp
            const seenKeys = new Set<string>();
            const mergedComments: any[] = [];
            for (const c of [...wfComments, ...taskCommentLogs]) {
              const normText = String(c?.text || "").replace(/^\[Chỉ đạo CV [^\]]+\]:\s*/, "").trim();
              const dedupKey = `${c?.author || ""}|${normText}`;
              if (!normText || seenKeys.has(dedupKey)) continue;
              seenKeys.add(dedupKey);
              mergedComments.push(c);
            }

            const isManagerOrDirector = rolePerspective !== "staff";
            const quickChips = isManagerOrDirector
              ? [
                  "Tiếp tục triển khai bước tiếp theo: ",
                  "Bổ sung thêm tài liệu / báo cáo chi tiết",
                  "Phối hợp thêm với bộ phận liên quan để hoàn thiện",
                  "Đã duyệt kết quả báo cáo, hoàn tất tốt!"
                ]
              : [
                  "Đã tiếp thu chỉ đạo, em đang triển khai tiếp",
                  "Em đã bổ sung đầy đủ tài liệu & kết quả theo chỉ đạo",
                  "Đang phối hợp với bộ phận liên quan để xử lý"
                ];

            return (
              <div className="rounded-xl border border-indigo-200 dark:border-indigo-800/80 bg-indigo-50/50 dark:bg-indigo-950/20 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between flex-wrap gap-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-900 dark:text-indigo-200">
                    <MessageSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span>Trao đổi &amp; Chỉ đạo tiếp theo trên công việc ({mergedComments.length})</span>
                  </div>
                  {wf && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                      🔗 Đồng bộ phiếu {wf.workflow_code}
                    </span>
                  )}
                </div>

                {/* Danh sách tin nhắn trao đổi / chỉ đạo */}
                <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                  {mergedComments.length === 0 ? (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 italic bg-white/70 dark:bg-slate-900/60 rounded-lg px-3 py-2 border border-dashed border-indigo-200 dark:border-indigo-800/60">
                      Chưa có trao đổi hoặc chỉ đạo thêm. Quản lý / Sếp có thể nhập chỉ đạo bước tiếp theo hoặc nhân sự phản hồi trực tiếp tại đây.
                    </div>
                  ) : (
                    mergedComments.map((c: any, i: number) => {
                      const isDir = c.role === "directive" || /^\[Chỉ đạo/i.test(String(c.text || ""));
                      return (
                        <div
                          key={i}
                          className={`rounded-xl border px-3 py-2 space-y-1 shadow-2xs ${
                            isDir
                              ? "bg-amber-50/90 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800/80"
                              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 text-[10px]">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {isDir ? (
                                <span className="px-1.5 py-0.5 rounded bg-amber-200/80 dark:bg-amber-900/80 text-amber-900 dark:text-amber-200 font-extrabold text-[9px]">
                                  👑 CHỈ ĐẠO TIẾP THEO
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold text-[9px]">
                                  💬 TRAO ĐỔI
                                </span>
                              )}
                              <strong className={isDir ? "text-amber-900 dark:text-amber-200" : "text-indigo-700 dark:text-indigo-300"}>
                                {c.author}
                              </strong>
                            </div>
                            <span className="text-slate-400 font-mono">{c.time}</span>
                          </div>
                          <p className="text-xs text-slate-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed">
                            {c.text}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Gợi ý mẫu câu chỉ đạo / phản hồi nhanh */}
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[10px] text-slate-400 font-semibold mr-0.5">
                    {isManagerOrDirector ? "Chỉ đạo nhanh:" : "Phản hồi nhanh:"}
                  </span>
                  {quickChips.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setTaskReplyText((prev) => (prev ? `${prev} ${chip}` : chip))}
                      className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800/70 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors cursor-pointer"
                    >
                      + {chip}
                    </button>
                  ))}
                </div>

                {/* Ô nhập nội dung trao đổi / chỉ đạo */}
                <div className="space-y-2">
                  <textarea
                    rows={2}
                    value={taskReplyText}
                    onChange={(e) => setTaskReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleTaskReply(wf);
                      }
                    }}
                    placeholder={
                      isManagerOrDirector
                        ? "Nhập nội dung chỉ đạo tiếp theo (VD: Tiếp tục gửi báo giá & lịch demo cho khách hàng...) — Nhấn Enter để gửi"
                        : "Nhập nội dung trao đổi hoặc phản hồi tiếp thu chỉ đạo... — Nhấn Enter để gửi"
                    }
                    className="w-full px-3 py-2 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-white font-medium"
                  />
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-[10px] text-slate-400">
                      💡 Nhấn <b>Enter</b> để gửi ngay (hoặc tự động lưu kèm khi bấm <b>Lưu Cập Nhật</b>)
                    </span>
                    <div className="flex items-center gap-1.5">
                      {taskForm.status === "DONE" && (
                        <button
                          type="button"
                          onClick={() => handleTaskReply(wf, { reopenToInProgress: true })}
                          disabled={!taskReplyText.trim()}
                          className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold disabled:opacity-40 cursor-pointer shadow-2xs transition-colors flex items-center gap-1"
                          title="Gửi chỉ đạo và tự động chuyển trạng thái công việc từ Đã hoàn tất về Đang làm để nhân sự thực hiện tiếp"
                        >
                          <span>⚡ Gửi &amp; Giao Làm Tiếp</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleTaskReply(wf)}
                        disabled={!taskReplyText.trim()}
                        className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold disabled:opacity-40 cursor-pointer shadow-2xs transition-colors flex items-center gap-1"
                      >
                        <Send className="w-3 h-3" />
                        <span>{isManagerOrDirector ? "Gửi Chỉ Đạo / Bình Luận" : "Gửi Phản Hồi"}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {taskForm.id && Array.isArray((taskForm as any).logs) && (taskForm as any).logs.some((l: any) => l?.type === "change") && (
            <details className="rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 text-[11px]">
              <summary className="cursor-pointer font-bold text-slate-600 dark:text-slate-300">
                Lịch sử thay đổi ({(taskForm as any).logs.filter((l: any) => l?.type === "change").length})
              </summary>
              <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                {(taskForm as any).logs.filter((l: any) => l?.type === "change").slice().reverse().map((l: any, i: number) => (
                  <li key={i} className="text-slate-600 dark:text-slate-400">
                    <span className="font-mono text-slate-400">{l.time}</span> · <b>{l.author || "?"}</b>: {l.text}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="flex items-center justify-between flex-wrap gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <div>
              {taskForm.id && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={async () => {
                      const wfCode = (taskForm as any).related_workflow_code;
                      if (!window.confirm(`Bạn có chắc chắn muốn XÓA / HỦY công việc "${taskForm.title}" để tạo lại không?`)) return;
                      try {
                        const res = await fetch("/api/workflows?action=delete_task", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ id: taskForm.id })
                        });
                        const data = await res.json();
                        if (data.success) {
                          showToast("Đã xóa / hủy công việc thành công!", "info");
                          setIsTaskModalOpen(false);
                          fetchData();
                        } else {
                          showToast(data.error || "Không thể xóa công việc", "error");
                        }
                      } catch {
                        showToast("Lỗi kết nối máy chủ", "error");
                      }
                    }}
                    className="px-3.5 py-2 rounded-xl font-bold border border-rose-200 dark:border-rose-900/80 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 flex items-center gap-1.5 cursor-pointer transition-colors"
                    title="Hủy / Xóa bỏ công việc này nếu tạo nhầm thông tin"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Hủy / Xóa việc</span>
                  </button>

                  {(taskForm as any).related_workflow_code && (
                    <button
                      type="button"
                      onClick={async () => {
                        const wfCode = (taskForm as any).related_workflow_code;
                        if (
                          !window.confirm(
                            `Bạn muốn HỦY & XÓA LUÔN PHIẾU PHỐI HỢP [${wfCode}] cùng toàn bộ các bước công việc liên quan để tạo lại mới từ đầu?`
                          )
                        ) {
                          return;
                        }
                        try {
                          const res = await fetch("/api/workflows?action=delete_task", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              id: taskForm.id,
                              cancel_workflow_code: wfCode,
                              delete_workflow: true
                            })
                          });
                          const data = await res.json();
                          if (data.success) {
                            showToast(`Đã hủy & xóa phiếu ${wfCode} cùng công việc liên quan!`, "info");
                            setIsTaskModalOpen(false);
                            fetchData();
                          } else {
                            showToast(data.error || "Không thể hủy phiếu phối hợp", "error");
                          }
                        } catch {
                          showToast("Lỗi kết nối máy chủ", "error");
                        }
                      }}
                      className="px-3 py-2 rounded-xl font-bold border border-amber-300 dark:border-amber-800 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 flex items-center gap-1 cursor-pointer transition-colors"
                      title="Xóa cả phiếu phối hợp gốc và công việc này để khởi tạo lại nếu bị nhầm"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Hủy cả Phiếu ({(taskForm as any).related_workflow_code})</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={() => setIsTaskModalOpen(false)}
                className="px-4 py-2 rounded-xl font-bold border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Đóng
              </button>
              {taskForm.id && (
                <button
                  type="button"
                  onClick={() => {
                    // Dùng việc này làm mẫu cho một việc mới (việc gốc giữ nguyên)
                    setTaskForm((prev: any) => ({ ...prev, id: null, task_code: undefined, logs: [], result: "", attachments: [], status: "TODO", title: `${prev.title} (bản sao)` }));
                    showToast("Đã chuyển thành việc mới - sửa nội dung rồi bấm Tạo Công Việc", "info");
                  }}
                  className="px-4 py-2 rounded-xl font-bold border border-indigo-300 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                  title="Tạo việc mới từ nội dung việc này, việc gốc giữ nguyên"
                >
                  Nhân bản thành việc mới
                </button>
              )}
              <button
                type="submit"
                className="px-5 py-2 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/30"
              >
                {taskForm.id ? "Lưu Cập Nhật" : "Tạo Công Việc"}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* ==================== MODAL 2: CREATE / EDIT WORKFLOW ==================== */}
      <Modal
        isOpen={isWorkflowModalOpen}
        onClose={() => setIsWorkflowModalOpen(false)}
        title={(wfForm as any).id ? `✏️ CHỈNH SỬA THÔNG TIN PHIẾU PHỐI HỢP & SLA (${(wfForm as any).workflow_code || "ĐÃ KHỞI TẠO"})` : "KHỞI TẠO PHIẾU PHỐI HỢP LIÊN PHÒNG BAN"}
        size="6xl"
      >
        <form onSubmit={handleSaveWorkflow} className="space-y-4 p-2 text-xs">
          {/* Banner & Điều khiển nhanh khi đang CHỈNH SỬA một phiếu phối hợp đã khởi tạo */}
          {Boolean((wfForm as any).id) && (
            <div className="p-3.5 rounded-2xl bg-amber-50/90 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-lg font-mono font-black text-xs bg-amber-500 text-white">
                    {(wfForm as any).workflow_code || `#${(wfForm as any).id}`}
                  </span>
                  <div>
                    <div className="font-extrabold text-amber-950 dark:text-amber-200 text-xs">
                      Chế độ chỉnh sửa Phiếu phối hợp đã khởi tạo
                    </div>
                    <div className="text-[11px] text-amber-800/80 dark:text-amber-300/80">
                      Mọi thay đổi về Tiêu đề, Khách hàng, Sản phẩm, Hạn chót, Phòng ban, Người phụ trách và Thời gian SLA sẽ được cập nhật trực tiếp vào phiếu này và đồng bộ sang Bảng Công Việc.
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-amber-200/80 dark:border-amber-800/60">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Trạng thái phiếu hiện tại
                  </label>
                  <select
                    value={(wfForm as any).status || "IN_PROGRESS"}
                    onChange={(e) => setWfForm({ ...wfForm, status: e.target.value } as any)}
                    className="w-full px-3 py-2 rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold cursor-pointer"
                  >
                    <option value="PENDING">⏳ Chờ tiếp nhận (PENDING)</option>
                    <option value="ACCEPTED">🔵 Đã tiếp nhận (ACCEPTED)</option>
                    <option value="IN_PROGRESS">🟡 Đang triển khai (IN_PROGRESS)</option>
                    <option value="REVIEW">🟣 Đã có kết quả / Chờ nghiệm thu (REVIEW)</option>
                    <option value="COMPLETED">🟢 Hoàn tất quy trình (COMPLETED)</option>
                    <option value="CANCELLED">🔴 Đã hủy phiếu (CANCELLED)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Bước đang thực hiện (Stage-Gate)
                  </label>
                  <select
                    value={Number((wfForm as any).current_step_index) || 0}
                    onChange={(e) => {
                      const nextIdx = parseInt(e.target.value, 10) || 0;
                      const updatedSteps = (wfForm.steps || []).map((st: any, i: number) => ({
                        ...st,
                        status: i < nextIdx ? "COMPLETED" : i === nextIdx ? "IN_PROGRESS" : "PENDING"
                      }));
                      setWfForm({
                        ...wfForm,
                        current_step_index: nextIdx,
                        target_dept: updatedSteps[nextIdx]?.dept || wfForm.target_dept,
                        assignee_name: updatedSteps[nextIdx]?.assignee_name || wfForm.assignee_name,
                        steps: updatedSteps
                      } as any);
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold cursor-pointer"
                  >
                    {(wfForm.steps || []).map((st: any, sIdx: number) => (
                      <option key={sIdx} value={sIdx}>
                        Bước {sIdx + 1}: {st.title || `Bước ${sIdx + 1}`} ({st.dept || "Phòng ban"})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Phòng ban yêu cầu
                  </label>
                  <DepartmentDropdownSelect
                    value={wfForm.requester_dept || "Kinh Doanh"}
                    onChange={(val) => setWfForm({ ...wfForm, requester_dept: val })}
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Phòng ban xử lý chính
                  </label>
                  <DepartmentDropdownSelect
                    value={wfForm.target_dept || "Application"}
                    onChange={(val) => setWfForm({ ...wfForm, target_dept: val })}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Top Section: Template, Title & Priority */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-8 space-y-1">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <label className="font-bold text-slate-700 dark:text-slate-300">Mẫu quy trình phối hợp chuẩn *</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const allTemplates = workflowTemplates.length > 0 ? workflowTemplates : DEFAULT_WORKFLOW_TEMPLATES;
                      const currentTmpl = allTemplates.find(
                        (w: any) => String(w.code || w.id) === String(wfForm.workflow_type)
                      ) || allTemplates[0];
                      if (currentTmpl) {
                        handleEditTemplate({
                          ...currentTmpl,
                          steps: wfForm.steps && wfForm.steps.length > 0 ? wfForm.steps : currentTmpl.steps
                        });
                      }
                    }}
                    className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 dark:hover:bg-amber-900/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 flex items-center gap-1 cursor-pointer"
                    title="Mở cửa sổ chỉnh sửa chi tiết mẫu quy trình & thời gian SLA đang chọn"
                  >
                    <span>✏️ Chỉnh sửa mẫu quy trình &amp; SLA</span>
                  </button>
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
                <label className="font-bold text-slate-700 dark:text-slate-300">
                  {isSameWorkspaceDept(wfForm.requester_dept, "Cung Ứng") || isSameWorkspaceDept(wfForm.target_dept, "Cung Ứng")
                    ? "Nhà cung cấp / Đối tác / Khách hàng"
                    : "Khách hàng / Viện / Đối tác"}
                </label>
                <span className="text-[10px] text-indigo-400">Chọn hoặc gõ tìm</span>
              </div>
              <SearchableCustomerSelect
                value={wfForm.customer_name}
                onChange={(val) => setWfForm({ ...wfForm, customer_name: val })}
                customerList={customerList}
                supplierList={supplierList}
                prioritizeSuppliers={isSameWorkspaceDept(wfForm.requester_dept, "Cung Ứng") || isSameWorkspaceDept(wfForm.target_dept, "Cung Ứng")}
                placeholder="Chọn hoặc gõ tìm Bệnh viện / Nhà cung cấp..."
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="font-bold text-slate-700 dark:text-slate-300">
                  Sản phẩm / Thiết bị
                  {(wfForm.workflow_type === "TO_PROCUREMENT" ||
                    isSameWorkspaceDept(wfForm.target_dept, "Cung Ứng")) && (
                    <span className="text-rose-500 ml-1" title="Bắt buộc chọn Mã & Tên sản phẩm từ Bảng mã sản xuất khi tạo PR">
                      * (Bắt buộc chọn Mã SP)
                    </span>
                  )}
                </label>
                <span className="text-[10px] text-purple-400">Chọn từ Bảng mã SX</span>
              </div>
              <SearchableProductSelect
                value={wfForm.product_info}
                onChange={(val) => setWfForm({ ...wfForm, product_info: val })}
                productList={productList}
                placeholder="Chọn Mã & Tên sản phẩm từ Bảng mã sản xuất..."
              />
            </div>

            <div className="space-y-1">
              <label className="block font-bold text-slate-700 dark:text-slate-300">Hạn chót cần hoàn tất</label>
              <DateInputVN
                value={wfForm.due_date ? wfForm.due_date.slice(0, 10) : ""}
                onChange={(e) => setWfForm({ ...wfForm, due_date: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-medium"
              />
            </div>
          </div>

          {/* Stepper Pipeline Configuration for this ticket */}
          <div className="bg-slate-50/80 dark:bg-slate-950/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-slate-900 dark:text-white text-xs">
                      Các bước thực hiện theo quy trình (Stage-Gate Pipeline):
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                      ⏱ Tổng thời gian SLA:{" "}
                      {(wfForm.steps || []).reduce((sum: number, s: any) => sum + (Number(s.sla_hours) || 24), 0)} giờ (~
                      {Math.max(
                        1,
                        Math.ceil(
                          (wfForm.steps || []).reduce((sum: number, s: any) => sum + (Number(s.sla_hours) || 24), 0) / 24
                        )
                      )}{" "}
                      ngày)
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400 block">
                    Chỉnh sửa trực tiếp nội dung, phòng ban, nhân sự, <strong>Thời gian SLA (giờ)</strong> từng bước và bấm <strong>&quot;💾 Lưu lại vào Mẫu quy trình&quot;</strong> để lưu cố định.
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleSaveCurrentWfStepsToTemplate}
                  className="text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-xl shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Lưu cấu hình các bước và thời gian SLA hiện tại vào Mẫu quy trình chuẩn"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>💾 Lưu lại vào Mẫu quy trình</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const currentSteps = wfForm.steps || [];
                    const newStep = {
                      step_index: currentSteps.length,
                      title: `Bước ${currentSteps.length + 1}: Bàn giao`,
                      dept: "Application",
                      departments: ["Application"],
                      assignee_name: "",
                      assignees: [],
                      sla_hours: 24,
                      deliverables: "Biên bản xác nhận",
                      status: "PENDING"
                    };
                    const nextSteps = reindexWorkflowSteps([...currentSteps, newStep]);
                    const totalHours = nextSteps.reduce((sum: number, s: any) => sum + (Number(s.sla_hours) || 24), 0);
                    setWfForm({
                      ...wfForm,
                      due_date: toVNDateString(new Date(Date.now() + Math.max(1, Math.ceil(totalHours / 24)) * 86400000)),
                      steps: nextSteps
                    });
                  }}
                  className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 px-3 py-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Thêm bước cuối</span>
                </button>
              </div>
            </div>

            <div className="space-y-2.5">
              {(wfForm.steps || []).map((step: any, idx: number) => {
                const totalSteps = (wfForm.steps || []).length;
                const stepDepts: string[] =
                  Array.isArray(step.departments) && step.departments.length > 0
                    ? step.departments
                    : step.dept
                    ? String(step.dept).split(",").map((d: string) => d.trim()).filter(Boolean)
                    : ["Application"];
                const primaryDept = stepDepts[0] || "Application";
                const stepAssignees: string[] =
                  Array.isArray(step.assignees) && step.assignees.length > 0
                    ? step.assignees.map((a: string) => cleanWorkspaceAssignee(a)).filter(Boolean)
                    : step.assignee_name
                    ? String(step.assignee_name).split(",").map((a: string) => cleanWorkspaceAssignee(a)).filter(Boolean)
                    : [];
                const primaryAssignee = stepAssignees[0] || "";

                const updateStepAt = (updater: (cur: any) => any) => {
                  const cloned = [...(wfForm.steps || [])];
                  cloned[idx] = updater({ ...cloned[idx] });
                  setWfForm({ ...wfForm, steps: reindexWorkflowSteps(cloned) });
                };

                const moveStep = (dir: -1 | 1) => {
                  const targetIdx = idx + dir;
                  if (targetIdx < 0 || targetIdx >= totalSteps) return;
                  const cloned = [...(wfForm.steps || [])];
                  const temp = cloned[idx];
                  cloned[idx] = cloned[targetIdx];
                  cloned[targetIdx] = temp;
                  setWfForm({ ...wfForm, steps: reindexWorkflowSteps(cloned) });
                };

                const insertStepBelow = () => {
                  const cloned = [...(wfForm.steps || [])];
                  const newSt = {
                    step_index: idx + 1,
                    title: `Bước phối hợp bổ sung`,
                    dept: primaryDept,
                    departments: [primaryDept],
                    assignee_name: "",
                    assignees: [],
                    sla_hours: 24,
                    deliverables: "Biên bản xác nhận",
                    status: "PENDING"
                  };
                  cloned.splice(idx + 1, 0, newSt);
                  setWfForm({ ...wfForm, steps: reindexWorkflowSteps(cloned) });
                };

                // Candidate personnel filtered by any of the selected departments in this step (fallback to all personnel)
                const matchingDeptPersonnel = personnelList.filter((p: any) =>
                  stepDepts.some((d) => isSameWorkspaceDept(p.department, d))
                );
                const candidatePool = matchingDeptPersonnel.length > 0 ? matchingDeptPersonnel : personnelList;

                return (
                  <div
                    key={idx}
                    className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800/80 space-y-2.5 text-xs shadow-2xs hover:border-indigo-500/40 transition-all"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-start">
                      <div className="md:col-span-1 flex md:flex-col items-center justify-between md:justify-center gap-1">
                        <span className="w-7 h-7 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 font-extrabold flex items-center justify-center text-xs border border-indigo-200 dark:border-indigo-800">
                          B{idx + 1}
                        </span>
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => moveStep(-1)}
                            className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-indigo-100 dark:hover:bg-indigo-900 text-slate-600 dark:text-slate-300 disabled:opacity-30 font-bold text-[10px] cursor-pointer"
                            title="Di chuyển bước lên (↑)"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            disabled={idx === totalSteps - 1}
                            onClick={() => moveStep(1)}
                            className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-indigo-100 dark:hover:bg-indigo-900 text-slate-600 dark:text-slate-300 disabled:opacity-30 font-bold text-[10px] cursor-pointer"
                            title="Di chuyển bước xuống (↓)"
                          >
                            ↓
                          </button>
                        </div>
                      </div>

                      <div className="md:col-span-3 space-y-1">
                        <label className="block text-[10px] font-bold text-slate-400">Nội dung công việc bước {idx + 1}</label>
                        <input
                          type="text"
                          value={step.title}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateStepAt((cur) => ({ ...cur, title: val }));
                          }}
                          placeholder="Tên công việc của bước..."
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-semibold"
                        />
                        <input
                          type="text"
                          value={step.deliverables || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateStepAt((cur) => ({ ...cur, deliverables: val }));
                          }}
                          placeholder="📋 Yêu cầu đầu ra (VD: Biên bản nghiệm thu, phiếu xuất...)"
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 text-[11px]"
                        />
                        {Boolean((wfForm as any).id) && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-0.5">
                            <select
                              value={step.status || "PENDING"}
                              onChange={(e) => {
                                const nextSt = e.target.value;
                                updateStepAt((cur) => ({ ...cur, status: nextSt }));
                              }}
                              className="px-2 py-1 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/50 text-[10px] font-bold text-indigo-800 dark:text-indigo-200 cursor-pointer"
                              title="Trạng thái của bước này"
                            >
                              <option value="PENDING">⏳ Chờ thực hiện</option>
                              <option value="IN_PROGRESS">🔵 Đang xử lý</option>
                              <option value="COMPLETED">✅ Đã hoàn tất</option>
                            </select>
                            <input
                              type="text"
                              value={step.deliverables_note || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                updateStepAt((cur) => ({ ...cur, deliverables_note: val }));
                              }}
                              placeholder="Ghi chú KQ bước này..."
                              className="px-2 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/30 text-[10px] text-emerald-800 dark:text-emerald-200"
                            />
                          </div>
                        )}
                      </div>

                      {/* Multi-Department Selector */}
                      <div className="md:col-span-2 space-y-1.5">
                        <label className="block text-[10px] font-bold text-slate-400">
                          Phòng ban thực hiện ({stepDepts.length} phòng)
                        </label>
                        <DepartmentDropdownSelect
                          value={primaryDept}
                          onChange={(val) => {
                            updateStepAt((cur) => {
                              const others = stepDepts.slice(1).filter((d) => d !== val);
                              const nextDepts = [val, ...others];
                              return {
                                ...cur,
                                departments: nextDepts,
                                dept: nextDepts.join(", ")
                              };
                            });
                          }}
                        />
                        <div className="flex flex-wrap items-center gap-1">
                          {stepDepts.map((dName, dIdx) => (
                            <span
                              key={dName + dIdx}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                            >
                              <span>🏢 {dName}</span>
                              {stepDepts.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    updateStepAt((cur) => {
                                      const nextDepts = stepDepts.filter((_, i) => i !== dIdx);
                                      return {
                                        ...cur,
                                        departments: nextDepts,
                                        dept: nextDepts.join(", ")
                                      };
                                    });
                                  }}
                                  className="hover:text-rose-500 cursor-pointer"
                                  title="Bỏ phòng ban này"
                                >
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              )}
                            </span>
                          ))}
                          <select
                            value=""
                            onChange={(e) => {
                              const addDept = e.target.value;
                              if (!addDept) return;
                              updateStepAt((cur) => {
                                const nextDepts = Array.from(new Set([...stepDepts, addDept]));
                                return {
                                  ...cur,
                                  departments: nextDepts,
                                  dept: nextDepts.join(", ")
                                };
                              });
                            }}
                            className="px-1.5 py-0.5 rounded-lg border border-dashed border-indigo-300 dark:border-indigo-700 bg-transparent text-[10px] font-bold text-indigo-600 dark:text-indigo-400 cursor-pointer"
                          >
                            <option value="">+ Thêm phòng phối hợp</option>
                            {ALL_DEPARTMENTS_OPTIONS.filter((o) => !stepDepts.includes(o.value)).map((o) => (
                              <option key={o.value} value={o.value} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                                + {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* SLA Hours Input per Step */}
                      <div className="md:col-span-2 space-y-1">
                        <label className="block text-[10px] font-bold text-amber-600 dark:text-amber-400">
                          ⏱ Thời gian SLA (giờ)
                        </label>
                        <div className="relative flex items-center">
                          <input
                            type="number"
                            min={1}
                            max={720}
                            value={step.sla_hours ?? 24}
                            onChange={(e) => {
                              const val = Math.max(1, parseInt(e.target.value, 10) || 1);
                              const cloned = [...(wfForm.steps || [])];
                              cloned[idx] = { ...cloned[idx], sla_hours: val };
                              const nextSteps = reindexWorkflowSteps(cloned);
                              const totalHours = nextSteps.reduce((sum: number, s: any) => sum + (Number(s.sla_hours) || 24), 0);
                              setWfForm({
                                ...wfForm,
                                due_date: toVNDateString(new Date(Date.now() + Math.max(1, Math.ceil(totalHours / 24)) * 86400000)),
                                steps: nextSteps
                              });
                            }}
                            className="w-full pl-2.5 pr-9 py-2 rounded-xl border border-amber-300 dark:border-amber-700/80 bg-amber-50/50 dark:bg-amber-950/30 text-slate-900 dark:text-white font-bold focus:ring-2 focus:ring-amber-500/30 outline-none"
                          />
                          <span className="absolute right-2.5 text-[10px] font-bold text-amber-600 dark:text-amber-400 pointer-events-none">
                            giờ
                          </span>
                        </div>
                        <span className="block text-[9px] text-slate-400">
                          ~{((Number(step.sla_hours) || 24) / 24).toFixed(1).replace(/\.0$/, "")} ngày
                        </span>
                      </div>

                      {/* Multi-Assignee Selector */}
                      <div className="md:col-span-3 space-y-1.5">
                        <label className="block text-[10px] font-bold text-slate-400">
                          Nhân sự phối hợp ({stepAssignees.length > 0 ? `${stepAssignees.length} người` : "Tự phân công / Chọn"})
                        </label>
                        <SearchablePersonnelSelect
                          value={primaryAssignee}
                          onChange={(val) => {
                            const cleaned = cleanWorkspaceAssignee(val);
                            updateStepAt((cur) => {
                              const others = stepAssignees.slice(1).filter((a) => a !== cleaned);
                              const nextAssignees = cleaned ? [cleaned, ...others] : others;
                              return {
                                ...cur,
                                assignees: nextAssignees,
                                assignee_name: nextAssignees.join(", ")
                              };
                            });
                          }}
                          personnelList={personnelList}
                          filterDepartment={stepDepts.length === 1 ? primaryDept : undefined}
                          placeholder="Chọn người chủ trì (hoặc để bộ phận phân công)..."
                        />
                        <div className="flex flex-wrap items-center gap-1">
                          {stepAssignees.map((aName, aIdx) => (
                            <span
                              key={aName + aIdx}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                            >
                              <span>👤 {aName}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  updateStepAt((cur) => {
                                    const nextAssignees = stepAssignees.filter((_, i) => i !== aIdx);
                                    return {
                                      ...cur,
                                      assignees: nextAssignees,
                                      assignee_name: nextAssignees.join(", ")
                                    };
                                  });
                                }}
                                className="hover:text-rose-500 cursor-pointer"
                                title="Bỏ nhân sự này"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </span>
                          ))}
                          <select
                            value=""
                            onChange={(e) => {
                              const addPerson = cleanWorkspaceAssignee(e.target.value);
                              if (!addPerson) return;
                              updateStepAt((cur) => {
                                const nextAssignees = Array.from(new Set([...stepAssignees, addPerson]));
                                return {
                                  ...cur,
                                  assignees: nextAssignees,
                                  assignee_name: nextAssignees.join(", ")
                                };
                              });
                            }}
                            className="px-1.5 py-0.5 rounded-lg border border-dashed border-emerald-400 dark:border-emerald-700 bg-transparent text-[10px] font-bold text-emerald-600 dark:text-emerald-400 cursor-pointer max-w-[175px]"
                          >
                            <option value="">+ Thêm người cùng bước</option>
                            {candidatePool
                              .filter((p: any) => p.full_name && !stepAssignees.includes(p.full_name))
                              .map((p: any) => (
                                <option key={p.id || p.employee_code || p.full_name} value={p.full_name} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                                  + {p.full_name} ({p.department || "TBR"})
                                </option>
                              ))}
                          </select>
                        </div>
                      </div>

                      {/* Step Actions: Insert Below & Delete */}
                      <div className="md:col-span-1 flex md:flex-col items-center justify-end gap-1 pt-1">
                        <button
                          type="button"
                          onClick={insertStepBelow}
                          className="px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 border border-indigo-200 dark:border-indigo-800 text-[10px] font-bold transition-colors cursor-pointer whitespace-nowrap"
                          title="Chèn thêm 1 bước mới ngay bên dưới bước này"
                        >
                          + Chèn dưới
                        </button>
                        {totalSteps > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              const updated = (wfForm.steps || []).filter((_: any, i: number) => i !== idx);
                              setWfForm({ ...wfForm, steps: reindexWorkflowSteps(updated) });
                            }}
                            className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors cursor-pointer"
                            title="Xóa bước này"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
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

          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40">
            <AttachmentPicker
              files={wfForm.attachments || []}
              onChange={(files) => setWfForm((prev: any) => ({ ...prev, attachments: files }))}
              label={wfForm.workflow_type === "SALES_TO_APP" ? "Phiếu triển khai & tài liệu kèm theo" : "Tài liệu đính kèm phiếu"}
              hint="Phiếu yêu cầu triển khai, hồ sơ khách hàng, ảnh mẫu... Kết quả triển khai được đính kèm khi từng bước báo hoàn thành."
            />
          </div>

          <div className="flex items-center justify-between flex-wrap gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={handleSaveCurrentWfStepsToTemplate}
              className="px-4 py-2.5 rounded-xl font-bold bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 transition-all cursor-pointer flex items-center gap-2"
              title="Lưu các bước và thời gian SLA đang thiết lập vào Mẫu Quy Trình để dùng lâu dài"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>💾 Lưu Cập Nhật Vào Mẫu Quy Trình</span>
            </button>
            <div className="flex items-center gap-3 ml-auto">
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
                <span>{(wfForm as any).id ? "💾 Lưu Thay Đổi Quy Trình & SLA" : "Phát Lệnh Phối Hợp"}</span>
              </button>
            </div>
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
              {(templateForm.steps || []).map((st: any, sIdx: number) => {
                const totalTmplSteps = (templateForm.steps || []).length;
                const stDepts: string[] =
                  Array.isArray(st.departments) && st.departments.length > 0
                    ? st.departments
                    : st.dept
                    ? String(st.dept).split(",").map((d: string) => d.trim()).filter(Boolean)
                    : [templateForm.target_dept || "Application"];
                const primaryStDept = stDepts[0] || "Application";
                const stAssignees: string[] =
                  Array.isArray(st.assignees) && st.assignees.length > 0
                    ? st.assignees.map((a: string) => cleanWorkspaceAssignee(a)).filter(Boolean)
                    : st.assignee_name
                    ? String(st.assignee_name).split(",").map((a: string) => cleanWorkspaceAssignee(a)).filter(Boolean)
                    : [];
                const primaryStAssignee = stAssignees[0] || "";

                const updateTmplStepAt = (updater: (cur: any) => any) => {
                  const cloned = [...(templateForm.steps || [])];
                  cloned[sIdx] = updater({ ...cloned[sIdx] });
                  setTemplateForm({ ...templateForm, steps: reindexWorkflowSteps(cloned) });
                };

                const moveTmplStep = (dir: -1 | 1) => {
                  const targetIdx = sIdx + dir;
                  if (targetIdx < 0 || targetIdx >= totalTmplSteps) return;
                  const cloned = [...(templateForm.steps || [])];
                  const tmp = cloned[sIdx];
                  cloned[sIdx] = cloned[targetIdx];
                  cloned[targetIdx] = tmp;
                  setTemplateForm({ ...templateForm, steps: reindexWorkflowSteps(cloned) });
                };

                const insertTmplStepBelow = () => {
                  const cloned = [...(templateForm.steps || [])];
                  cloned.splice(sIdx + 1, 0, {
                    step_index: sIdx + 1,
                    title: `Bước phối hợp bổ sung`,
                    dept: primaryStDept,
                    departments: [primaryStDept],
                    assignee_name: "",
                    assignees: [],
                    sla_hours: 24,
                    deliverables: "Biên bản nghiệm thu"
                  });
                  setTemplateForm({ ...templateForm, steps: reindexWorkflowSteps(cloned) });
                };

                return (
                  <div
                    key={sIdx}
                    className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-xs px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                          Bước {sIdx + 1}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={sIdx === 0}
                            onClick={() => moveTmplStep(-1)}
                            className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-indigo-100 text-slate-700 dark:text-slate-300 disabled:opacity-30 text-[10px] font-bold cursor-pointer"
                            title="Di chuyển bước lên (↑)"
                          >
                            ↑ Lên
                          </button>
                          <button
                            type="button"
                            disabled={sIdx === totalTmplSteps - 1}
                            onClick={() => moveTmplStep(1)}
                            className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-indigo-100 text-slate-700 dark:text-slate-300 disabled:opacity-30 text-[10px] font-bold cursor-pointer"
                            title="Di chuyển bước xuống (↓)"
                          >
                            ↓ Xuống
                          </button>
                          <button
                            type="button"
                            onClick={insertTmplStepBelow}
                            className="px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 border border-indigo-200 dark:border-indigo-800 text-[10px] font-bold cursor-pointer"
                            title="Chèn thêm bước mới ngay dưới bước này"
                          >
                            + Chèn bước dưới
                          </button>
                        </div>
                      </div>
                      {totalTmplSteps > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            const updated = (templateForm.steps || []).filter((_: any, i: number) => i !== sIdx);
                            setTemplateForm({ ...templateForm, steps: reindexWorkflowSteps(updated) });
                          }}
                          className="text-rose-500 hover:text-rose-700 text-xs font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Xóa bước</span>
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
                      <div className="md:col-span-5">
                        <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Tên bước công việc *</label>
                        <input
                          type="text"
                          required
                          value={st.title}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateTmplStepAt((cur) => ({ ...cur, title: val }));
                          }}
                          placeholder="VD: Kiểm tra tính khả thi & tiếp nhận mẫu"
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 font-bold"
                        />
                      </div>

                      <div className="md:col-span-4 space-y-1">
                        <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
                          Phòng ban thực hiện ({stDepts.length} phòng)
                        </label>
                        <DepartmentDropdownSelect
                          value={primaryStDept}
                          onChange={(val) => {
                            updateTmplStepAt((cur) => {
                              const others = stDepts.slice(1).filter((d) => d !== val);
                              const nextDepts = [val, ...others];
                              return { ...cur, departments: nextDepts, dept: nextDepts.join(", ") };
                            });
                          }}
                        />
                        <div className="flex flex-wrap items-center gap-1">
                          {stDepts.map((dName, dIdx) => (
                            <span
                              key={dName + dIdx}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                            >
                              <span>🏢 {dName}</span>
                              {stDepts.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateTmplStepAt((cur) => {
                                      const nextDepts = stDepts.filter((_, i) => i !== dIdx);
                                      return { ...cur, departments: nextDepts, dept: nextDepts.join(", ") };
                                    })
                                  }
                                  className="hover:text-rose-500 cursor-pointer"
                                >
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              )}
                            </span>
                          ))}
                          <select
                            value=""
                            onChange={(e) => {
                              const addDept = e.target.value;
                              if (!addDept) return;
                              updateTmplStepAt((cur) => {
                                const nextDepts = Array.from(new Set([...stDepts, addDept]));
                                return { ...cur, departments: nextDepts, dept: nextDepts.join(", ") };
                              });
                            }}
                            className="px-1.5 py-0.5 rounded-lg border border-dashed border-indigo-300 dark:border-indigo-700 bg-transparent text-[10px] font-bold text-indigo-600 dark:text-indigo-400 cursor-pointer"
                          >
                            <option value="">+ Thêm phòng</option>
                            {ALL_DEPARTMENTS_OPTIONS.filter((o) => !stDepts.includes(o.value)).map((o) => (
                              <option key={o.value} value={o.value} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                                + {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="md:col-span-3">
                        <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Thời hạn SLA (giờ)</label>
                        <input
                          type="number"
                          min={1}
                          value={st.sla_hours || 24}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10) || 24;
                            updateTmplStepAt((cur) => ({ ...cur, sla_hours: val }));
                          }}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 font-semibold"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
                          Nhân sự mặc định phụ trách ({stAssignees.length > 0 ? `${stAssignees.length} người` : "Tùy chọn"})
                        </label>
                        <SearchablePersonnelSelect
                          value={primaryStAssignee}
                          onChange={(val) => {
                            const cleaned = cleanWorkspaceAssignee(val);
                            updateTmplStepAt((cur) => {
                              const others = stAssignees.slice(1).filter((a) => a !== cleaned);
                              const nextAssignees = cleaned ? [cleaned, ...others] : others;
                              return { ...cur, assignees: nextAssignees, assignee_name: nextAssignees.join(", ") };
                            });
                          }}
                          personnelList={personnelList}
                          placeholder="Chọn nhân sự (hoặc để trống)..."
                        />
                        <div className="flex flex-wrap items-center gap-1">
                          {stAssignees.map((aName, aIdx) => (
                            <span
                              key={aName + aIdx}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                            >
                              <span>👤 {aName}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  updateTmplStepAt((cur) => {
                                    const nextAssignees = stAssignees.filter((_, i) => i !== aIdx);
                                    return { ...cur, assignees: nextAssignees, assignee_name: nextAssignees.join(", ") };
                                  })
                                }
                                className="hover:text-rose-500 cursor-pointer"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </span>
                          ))}
                          <select
                            value=""
                            onChange={(e) => {
                              const addPerson = cleanWorkspaceAssignee(e.target.value);
                              if (!addPerson) return;
                              updateTmplStepAt((cur) => {
                                const nextAssignees = Array.from(new Set([...stAssignees, addPerson]));
                                return { ...cur, assignees: nextAssignees, assignee_name: nextAssignees.join(", ") };
                              });
                            }}
                            className="px-1.5 py-0.5 rounded-lg border border-dashed border-emerald-400 dark:border-emerald-700 bg-transparent text-[10px] font-bold text-emerald-600 dark:text-emerald-400 cursor-pointer"
                          >
                            <option value="">+ Thêm người phối hợp</option>
                            {personnelList
                              .filter((p: any) => p.full_name && !stAssignees.includes(p.full_name))
                              .map((p: any) => (
                                <option key={p.id || p.employee_code || p.full_name} value={p.full_name} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                                  + {p.full_name} ({p.department || "TBR"})
                                </option>
                              ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Tiêu chuẩn đầu ra (Deliverable)</label>
                        <input
                          type="text"
                          value={st.deliverables || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateTmplStepAt((cur) => ({ ...cur, deliverables: val }));
                          }}
                          placeholder="VD: Biên bản nghiệm thu có chữ ký bác sĩ / khách hàng..."
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
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
                <span>Đính kèm kết quả triển khai (biên bản, ảnh, file kết quả máy):</span>
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
                        const res = await uploadSingleFileSmart(file);
                        if (res.success && res.url) {
                          uploaded.push({
                            name: res.name || file.name,
                            url: res.url,
                            size: res.size || file.size,
                            type: res.type || file.type,
                            uploaded_at: nowVNDateTime()
                          });
                        } else {
                          showToast(res.error || `Không tải lên được tệp ${file.name}`, "error");
                        }
                      }
                      if (uploaded.length > 0) {
                        setAdvanceStepData(prev => ({
                          ...prev,
                          attachments: [...prev.attachments, ...uploaded]
                        }));
                        showToast(`Đã tải lên ${uploaded.length} tệp thành công!`, "success");
                      }
                    } catch (err: any) {
                      showToast("Lỗi tải tệp: " + err.message, "error");
                    } finally {
                      setIsUploading(false);
                      e.target.value = "";
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
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-black text-sm text-indigo-600 dark:text-indigo-400">
                    {selectedWorkflowDetail.workflow_code}
                  </span>
                  <WorkflowStatusBadge status={selectedWorkflowDetail.status} />
                  <PriorityBadge priority={selectedWorkflowDetail.priority} />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsWorkflowDetailModalOpen(false);
                    handleEditWorkflowTicket(selectedWorkflowDetail);
                  }}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <span>✏️ Chỉnh Sửa Thông Tin Phiếu &amp; SLA</span>
                </button>
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {selectedWorkflowDetail.title}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-slate-600 dark:text-slate-400 pt-2 border-t border-slate-200 dark:border-slate-700">
                <div>Phòng yêu cầu: <strong>{selectedWorkflowDetail.requester_dept}</strong></div>
                <div>Phòng xử lý: <strong>{selectedWorkflowDetail.target_dept}</strong></div>
                <div>Người yêu cầu: <strong>{selectedWorkflowDetail.requester_name}</strong></div>
                <div>Người xử lý: <strong>{selectedWorkflowDetail.assignee_name || "Chờ phân công"}</strong></div>
                <div>Khách hàng / ĐV: <strong>{selectedWorkflowDetail.customer_name || "Nội bộ TBR"}</strong></div>
                <div>Sản phẩm / TB: <strong>{selectedWorkflowDetail.product_info || "—"}</strong></div>
                <div>Hạn chót: <strong>{selectedWorkflowDetail.due_date ? formatDayVN(selectedWorkflowDetail.due_date) : "—"}</strong></div>
                <div>Bước hiện tại: <strong>Bước {(Number(selectedWorkflowDetail.current_step_index) || 0) + 1}/{Array.isArray(selectedWorkflowDetail.steps) && selectedWorkflowDetail.steps.length > 0 ? selectedWorkflowDetail.steps.length : 1}</strong></div>
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
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsWorkflowDetailModalOpen(false);
                        handleEditWorkflowTicket(selectedWorkflowDetail);
                      }}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold border border-amber-300 dark:border-amber-800 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-300 flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <span>✏️ Chỉnh sửa quy trình &amp; SLA</span>
                    </button>
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
                <span>Khách hàng: <strong>{selectedWorkflowForRecord.customer_name || "Nội bộ TBR"}</strong></span>
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
                    accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.xml,.csv,.txt,.rtf,.zip,.rar,.7z,.tar,.gz"
                    onChange={(e) => handleFileUpload(e.target.files, "record")}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Upload Dropzone Hint */}
              <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-800 text-center">
                <div className="flex items-center justify-center gap-2 text-slate-400 text-xs">
                  <Paperclip className="w-4 h-4" />
                  <span>Hỗ trợ chọn nhiều tệp cùng lúc hoặc file nén (.RAR, .ZIP, .7Z), hồ sơ thầu/nghiệm thu (PDF, Word, Excel, PowerPoint), ảnh &amp; video (Tối đa 200MB/tệp).</span>
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

      {/* ==================== MODAL 4: THÊM LỊCH CÔNG TÁC TUẦN & TẠO LỊCH HỌP ==================== */}
      <Modal
        isOpen={isScheduleModalOpen}
        onClose={() => setIsScheduleModalOpen(false)}
        title={
          scheduleForm.eventType === "MEETING"
            ? editingScheduleId
              ? "🎥 CẬP NHẬT LỊCH HỌP & THÀNH VIÊN THAM DỰ"
              : "🎥 TẠO LỊCH HỌP, CHỌN THÀNH VIÊN & GỬI THÔNG BÁO HỌP"
            : editingScheduleId
            ? "SỬA LỊCH CÔNG TÁC & ĐIỀU PHỐI TUẦN"
            : "THÊM LỊCH CÔNG TÁC & ĐIỀU PHỐI TUẦN"
        }
        size="lg"
      >
        {(() => {
          const isMeetingMode = scheduleForm.eventType === "MEETING";
          const activeActorName = rolePerspective === "staff" ? currentStaffName : (scheduleForm.actor || currentStaffName);
          const staffSourceList = departmentStaffList && departmentStaffList.length > 0 ? departmentStaffList : personnelList;

          // Danh sách phòng ban phục vụ chọn nhanh thành viên họp theo phòng
          const allDeptGroups = Array.from(
            new Set(
              (personnelList || [])
                .map((p: any) => String(p.department || "").trim())
                .filter(Boolean)
            )
          );

          const filteredPersonnelForMeeting = (personnelList || []).filter((p: any) => {
            const name = String(p.full_name || p || "").trim();
            if (!name || sameStaffName(name, activeActorName)) return false;
            if (!attendeeSearchQuery.trim()) return true;
            const q = canonStaffName(attendeeSearchQuery);
            return (
              canonStaffName(name).includes(q) ||
              canonStaffName(p.department || "").includes(q) ||
              canonStaffName(p.position || "").includes(q) ||
              canonStaffName(p.employee_code || "").includes(q)
            );
          });

          const toggleAttendeeSelection = (staffName: string) => {
            if (!staffName || sameStaffName(staffName, activeActorName)) return;
            const cur = Array.isArray(scheduleForm.coActors) ? scheduleForm.coActors : [];
            const exists = cur.some((c) => sameStaffName(c, staffName));
            const next = exists
              ? cur.filter((c) => !sameStaffName(c, staffName))
              : [...cur, staffName];
            setScheduleForm({ ...scheduleForm, coActors: next });
          };

          const toggleDepartmentAttendees = (deptName: string) => {
            const deptMembers = (personnelList || [])
              .filter((p: any) => {
                const name = String(p.full_name || p || "").trim();
                if (!name || sameStaffName(name, activeActorName)) return false;
                if (deptName === "ALL") return true;
                return isSameWorkspaceDept(deptName, p.department || "");
              })
              .map((p: any) => String(p.full_name || p || "").trim());

            if (deptMembers.length === 0) return;
            const cur = Array.isArray(scheduleForm.coActors) ? scheduleForm.coActors : [];
            const allPicked = deptMembers.every((m) => cur.some((c) => sameStaffName(c, m)));
            let next: string[];
            if (allPicked) {
              next = cur.filter((c) => !deptMembers.some((m) => sameStaffName(m, c)));
            } else {
              const merged = [...cur];
              deptMembers.forEach((m) => {
                if (!merged.some((c) => sameStaffName(c, m))) merged.push(m);
              });
              next = merged;
            }
            setScheduleForm({ ...scheduleForm, coActors: next });
          };

          // 1. Lấy danh sách Công việc (Tasks) + Phiếu phối hợp (Workflows) + Chuyên đề (Projects) đang mở của nhân sự đang chọn
          const personOpenTasks = (tasks || []).filter((t: any) => {
            if (String(t.status || "").toUpperCase() === "DONE") return false;
            if (!activeActorName) return true;
            const assignees = String(t.assignee_name || "")
              .split(/[,;\n]+/)
              .map((a: string) => cleanWorkspaceAssignee(a))
              .filter(Boolean);
            return assignees.some((a: string) => sameStaffName(a, activeActorName));
          });

          const personOpenWorkflows = (workflows || []).filter((w: any) => {
            const st = String(w.status || "").toUpperCase();
            if (st === "COMPLETED" || st === "CANCELLED" || st === "REJECTED") return false;
            if (!activeActorName) return false;
            if (sameStaffName(cleanWorkspaceAssignee(w.assignee_name || ""), activeActorName)) return true;
            if (sameStaffName(cleanWorkspaceAssignee(w.requester_name || ""), activeActorName)) return true;
            const steps = Array.isArray(w.steps) ? w.steps : [];
            return steps.some((s: any) => {
              const sAssignees = Array.isArray(s?.assignees) && s.assignees.length > 0
                ? s.assignees.map((a: string) => cleanWorkspaceAssignee(a))
                : String(s?.assignee_name || "").split(",").map((a: string) => cleanWorkspaceAssignee(a));
              return sAssignees.filter(Boolean).some((a: string) => sameStaffName(a, activeActorName));
            });
          });

          const personActiveProjects = (labProjects || []).filter((p: any) => {
            if (p.status === "Completed") return false;
            if (!activeActorName) return false;
            if (sameStaffName(p.lead || "", activeActorName)) return true;
            const collabs = Array.isArray(p.collaborators) ? p.collaborators : [];
            return collabs.some((c: string) => sameStaffName(c, activeActorName));
          });

          const selectableWorkItems: Array<{
            code: string;
            typeLabel: string;
            title: string;
            location: string;
            dept: string;
            deadline?: string;
            priority?: string;
          }> = [
            ...personOpenTasks.map((t: any) => ({
              code: t.task_code || `TSK-${t.id}`,
              typeLabel: t.status === "IN_PROGRESS" ? "⚡ Đang làm" : "📌 Việc cần làm",
              title: t.title || "",
              location: t.customer_name || "",
              dept: t.department || scheduleForm.category || "Kinh Doanh",
              deadline: t.deadline ? String(t.deadline).slice(0, 10) : undefined,
              priority: t.priority
            })),
            ...personOpenWorkflows.map((w: any) => ({
              code: w.workflow_code || `WF-${w.id}`,
              typeLabel: "🔄 Phối hợp",
              title: w.title || "",
              location: w.customer_name || "",
              dept: w.target_dept || w.requester_dept || scheduleForm.category || "Application",
              deadline: w.due_date ? String(w.due_date).slice(0, 10) : undefined,
              priority: w.priority
            })),
            ...personActiveProjects.map((p: any) => ({
              code: p.id,
              typeLabel: "🎯 Chuyên đề",
              title: p.name || "",
              location: "",
              dept: p.dept || scheduleForm.category || "Application",
              deadline: p.endDate ? String(p.endDate).slice(0, 10) : undefined,
              priority: p.priority === "Cao" ? "HIGH" : "MEDIUM"
            }))
          ];

          // 2. Kiểm tra các lịch đã có của nhân sự này trong ngày đang chọn để tránh trùng giờ
          const activeDateIso = scheduleForm.date || todayVN();
          const existingActorSchedulesOnDate = weeklySchedule.filter((s: any) => {
            if (editingScheduleId && s.id === editingScheduleId) return false;
            const sStart = s.date ? String(s.date).slice(0, 10) : "";
            const sEnd = s.endDate ? String(s.endDate).slice(0, 10) : sStart;
            const onSameDate = sStart ? (activeDateIso >= sStart && activeDateIso <= sEnd) : false;
            if (!onSameDate) return false;
            if (!activeActorName) return false;
            const actors = String(s.actor || "").split(/[,;\n]+/).map((a: string) => a.trim()).filter(Boolean);
            return actors.some((a: string) => sameStaffName(a, activeActorName));
          });

          const timeSlotOptions = [
            "07:00", "07:30", "08:00", "08:30", "09:00", "09:30", "10:00", "10:30",
            "11:00", "11:30", "12:00", "13:00", "13:30", "14:00", "14:30", "15:00",
            "15:30", "16:00", "16:30", "17:00", "17:30", "18:00", "19:00", "20:00", "21:00"
          ];

          const handleToggleWorkItemForSchedule = (item: typeof selectableWorkItems[number]) => {
            const currentCodes = Array.isArray(scheduleForm.linkedTaskCodes) ? scheduleForm.linkedTaskCodes : [];
            const isSelected = currentCodes.includes(item.code);
            let nextCodes: string[];
            if (isSelected) {
              nextCodes = currentCodes.filter(c => c !== item.code);
            } else {
              nextCodes = [...currentCodes, item.code];
            }
            const selectedObjs = selectableWorkItems.filter(w => nextCodes.includes(w.code));
            const nextTitle = selectedObjs.length > 0
              ? selectedObjs.map(o => o.title).join(" + ")
              : scheduleForm.title;
            const firstWithLoc = selectedObjs.find(o => o.location);
            const firstDept = selectedObjs[0]?.dept;
            const validCategories = ["Application", "Kinh Doanh", "Kho & Vận Hành", "Cung Ứng", "Họp & Giao Ban"];
            const matchedCat = firstDept && validCategories.includes(firstDept) ? firstDept : scheduleForm.category;

            setScheduleForm({
              ...scheduleForm,
              linkedTaskCodes: nextCodes,
              title: nextTitle,
              location: firstWithLoc?.location || scheduleForm.location,
              category: matchedCat
            });
          };

          return (
            <form onSubmit={handleSaveSchedule} className="space-y-3.5 p-1 text-xs">
              {/* THANH CHUYỂN CHẾ ĐỘ: LỊCH CÔNG TÁC TUẦN vs TẠO LỊCH HỌP & MỜI THÀNH VIÊN */}
              <div className="grid grid-cols-2 gap-2 p-1.5 rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() =>
                    setScheduleForm({
                      ...scheduleForm,
                      eventType: "WORK",
                      category: scheduleForm.category === "Họp & Giao Ban" ? "Application" : scheduleForm.category
                    })
                  }
                  className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    !isMeetingMode
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <span>🛠️ Lịch Công Tác / Điều Phối Tuần</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setScheduleForm({
                      ...scheduleForm,
                      eventType: "MEETING",
                      category: "Họp & Giao Ban",
                      location: scheduleForm.location || "Phòng họp chính Công ty",
                      sendChatNotify: true,
                      sendBellNotify: true
                    })
                  }
                  className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    isMeetingMode
                      ? "bg-rose-600 text-white shadow-sm"
                      : "text-slate-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                  }`}
                >
                  <span>🎥 Tạo Lịch Họp &amp; Chọn Thành Viên Tham Dự</span>
                </button>
              </div>

              {/* CHỌN NHANH MẪU CUỘC HỌP (KHI Ở CHẾ ĐỘ LỊCH HỌP) */}
              {isMeetingMode && (
                <div className="p-2.5 rounded-xl bg-rose-50/70 dark:bg-rose-950/25 border border-rose-200/80 dark:border-rose-900/60 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-rose-800 dark:text-rose-300">
                      ⚡ Chọn nhanh loại cuộc họp mẫu:
                    </span>
                    <span className="text-[10px] text-rose-600 dark:text-rose-400 font-semibold">
                      Tự động điền tiêu đề, khung giờ &amp; phòng họp
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      {
                        label: "📊 Họp giao ban đầu tuần",
                        title: "Họp giao ban đầu tuần & Rà soát kế hoạch tuần",
                        time: "08:30 - 10:00",
                        st: "08:30",
                        et: "10:00",
                        loc: "Phòng họp chính Công ty",
                        agenda: "1. Báo cáo kết quả tuần trước\n2. Rà soát tiến độ các dự án & thầu trọng điểm\n3. Phân công kế hoạch tuần mới"
                      },
                      {
                        label: "🏛️ Họp Ban Giám Đốc",
                        title: "Họp Ban Giám Đốc & Trưởng bộ phận",
                        time: "14:00 - 16:00",
                        st: "14:00",
                        et: "16:00",
                        loc: "Phòng họp VIP Ban Giám Đốc",
                        agenda: "1. Đánh giá chỉ số KPI & Doanh thu\n2. Phê duyệt ngân sách & hồ sơ thầu chiến lược"
                      },
                      {
                        label: "🔄 Họp phối hợp KD - App - Kho",
                        title: "Họp phối hợp Kinh Doanh - Application - Kho Vận",
                        time: "09:00 - 10:30",
                        st: "09:00",
                        et: "10:30",
                        loc: "Phòng họp chính Công ty",
                        agenda: "1. Điều phối lịch demo máy & giao hàng cho Bệnh viện\n2. Kiểm tra tồn kho hóa chất & vật tư đi kèm"
                      },
                      {
                        label: "🏥 Họp phương án Thầu / Dự án KH",
                        title: "Họp triển khai Hồ sơ thầu & Phương án kỹ thuật KH",
                        time: "15:00 - 16:30",
                        st: "15:00",
                        et: "16:30",
                        loc: "Phòng họp chính Công ty",
                        agenda: "1. Rà soát cấu hình kỹ thuật & bảng giá chào thầu\n2. Phân công chuẩn bị hồ sơ pháp lý & chứng chỉ hãng"
                      },
                      {
                        label: "💻 Họp trực tuyến Online",
                        title: "Họp trực tuyến (Google Meet / Zoom / Teams)",
                        time: "10:00 - 11:30",
                        st: "10:00",
                        et: "11:30",
                        loc: "Họp Online (Google Meet / Zoom)",
                        agenda: "Trao đổi trực tuyến với các thành viên & đối tác từ xa"
                      }
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() =>
                          setScheduleForm({
                            ...scheduleForm,
                            title: preset.title,
                            time: preset.time,
                            startTime: preset.st,
                            endTime: preset.et,
                            location: preset.loc,
                            meetingAgenda: scheduleForm.meetingAgenda || preset.agenda
                          })
                        }
                        className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 hover:bg-rose-600 hover:text-white text-slate-700 dark:text-slate-200 border border-rose-200 dark:border-rose-800/70 text-[10px] font-bold transition-colors cursor-pointer"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* BƯỚC 1: NHÂN SỰ CHỦ TRÌ / PHỤ TRÁCH & CHỌN THÀNH VIÊN THAM DỰ */}
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-200 mb-1">
                      {isMeetingMode ? "1. Người chủ trì cuộc họp *" : "1. Nhân viên phụ trách chính *"}
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
                        onChange={(e) => setScheduleForm({ ...scheduleForm, actor: e.target.value, linkedTaskCodes: [] })}
                        className="w-full px-3 py-2 rounded-xl border border-indigo-300 dark:border-indigo-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-bold"
                      >
                        <option value="">-- Chọn người chủ trì / phụ trách --</option>
                        {staffSourceList.map((p: any) => {
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
                    <label className="block font-bold text-slate-700 dark:text-slate-200 mb-1">
                      Phân loại bộ phận / Mục đích *
                    </label>
                    <select
                      value={scheduleForm.category}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, category: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-bold"
                    >
                      <option value="Họp & Giao Ban">🎥 Họp &amp; Giao Ban: Họp nội bộ / Họp liên phòng / Họp Ban Giám Đốc</option>
                      <option value="Application">🔬 Application: Demo máy / Thử mẫu ngoại viện / Trực Lab</option>
                      <option value="Kinh Doanh">💼 Kinh Doanh: Đàm phán KH / Chăm sóc bệnh viện / Triển khai thầu</option>
                      <option value="Kho & Vận Hành">📦 Kho &amp; Vận Hành: Soạn xuất hàng lớn / Nhập kho container / Kiểm kê</option>
                      <option value="Cung Ứng">🛒 Cung Ứng: Làm việc NCC / Thủ tục hải quan</option>
                    </select>
                  </div>
                </div>

                {/* BẢNG CHỌN THÀNH VIÊN THAM DỰ HỌP (CHUYÊN BIỆT KHI TẠO LỊCH HỌP HOẶC CHỌN NGƯỜI PHỐI HỢP) */}
                {isMeetingMode ? (
                  <div className="p-3 rounded-xl bg-white dark:bg-slate-950 border border-rose-200 dark:border-rose-900/70 space-y-2.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-rose-700 dark:text-rose-300 text-xs">
                          👥 Chọn thành viên tham dự cuộc họp:
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 font-bold text-[10px] border border-rose-200 dark:border-rose-800">
                          Đã chọn {(scheduleForm.coActors || []).length + (activeActorName ? 1 : 0)} người (gồm Chủ trì)
                        </span>
                      </div>
                      {(scheduleForm.coActors || []).length > 0 && (
                        <button
                          type="button"
                          onClick={() => setScheduleForm({ ...scheduleForm, coActors: [] })}
                          className="text-[10px] font-bold text-rose-600 hover:underline cursor-pointer"
                        >
                          Bỏ chọn tất cả thành viên ({(scheduleForm.coActors || []).length})
                        </button>
                      )}
                    </div>

                    {/* Nút chọn nhanh theo Phòng ban / Toàn công ty */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-semibold text-slate-500">Chọn nhanh theo phòng:</span>
                      <button
                        type="button"
                        onClick={() => toggleDepartmentAttendees("ALL")}
                        className="px-2 py-0.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold cursor-pointer"
                      >
                        + Toàn công ty
                      </button>
                      {allDeptGroups.map((dept) => (
                        <button
                          key={dept}
                          type="button"
                          onClick={() => toggleDepartmentAttendees(dept)}
                          className="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-900 hover:bg-indigo-600 hover:text-white text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-[10px] font-semibold transition-colors cursor-pointer"
                        >
                          + {dept}
                        </button>
                      ))}
                    </div>

                    {/* Ô tìm kiếm nhân sự nhanh */}
                    <input
                      type="text"
                      value={attendeeSearchQuery}
                      onChange={(e) => setAttendeeSearchQuery(e.target.value)}
                      placeholder="🔍 Tìm nhanh tên nhân sự, mã NV hoặc phòng ban để tích chọn tham dự..."
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white text-[11px]"
                    />

                    {/* Danh sách checkbox nhân sự */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5 max-h-40 overflow-y-auto pr-1">
                      {filteredPersonnelForMeeting.map((p: any) => {
                        const name = String(p.full_name || p || "").trim();
                        const dept = p.department || "Nhân sự";
                        const checked = (scheduleForm.coActors || []).some((c) => sameStaffName(c, name));
                        return (
                          <button
                            key={p.id || p.employee_code || name}
                            type="button"
                            onClick={() => toggleAttendeeSelection(name)}
                            className={`text-left px-2.5 py-1.5 rounded-lg border flex items-center gap-2 transition-all cursor-pointer ${
                              checked
                                ? "bg-rose-600 text-white border-rose-500 shadow-2xs"
                                : "bg-slate-50 dark:bg-slate-900/70 hover:bg-rose-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-800"
                            }`}
                          >
                            <input
                              type="checkbox"
                              readOnly
                              checked={checked}
                              className="w-3.5 h-3.5 rounded accent-rose-600 pointer-events-none shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="font-bold text-[11px] truncate">{name}</div>
                              <div className={`text-[9px] truncate ${checked ? "text-rose-100" : "text-slate-500"}`}>
                                {dept}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Hiển thị các thẻ thành viên đã chọn */}
                    {Array.isArray(scheduleForm.coActors) && scheduleForm.coActors.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-100 dark:border-slate-800">
                        {scheduleForm.coActors.map((co) => (
                          <span
                            key={co}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 text-[10px] font-bold border border-rose-200 dark:border-rose-800"
                          >
                            <span>👤 {co}</span>
                            <button
                              type="button"
                              onClick={() => toggleAttendeeSelection(co)}
                              className="hover:text-rose-900 dark:hover:text-white font-bold cursor-pointer"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  /* Chế độ Lịch công tác thường: Chọn người đi cùng gọn nhẹ */
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                        Người đi cùng / Phối hợp công tác (Tùy chọn):
                      </span>
                      <select
                        value=""
                        onChange={(e) => {
                          const picked = e.target.value;
                          if (!picked || picked === activeActorName) return;
                          const cur = Array.isArray(scheduleForm.coActors) ? scheduleForm.coActors : [];
                          if (!cur.includes(picked)) {
                            setScheduleForm({ ...scheduleForm, coActors: [...cur, picked] });
                          }
                        }}
                        className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 cursor-pointer"
                      >
                        <option value="">+ Thêm đồng nghiệp đi cùng...</option>
                        {personnelList.map((p: any) => {
                          const name = p.full_name || p;
                          if (name === activeActorName) return null;
                          return (
                            <option key={p.id || p.employee_code || name} value={name}>
                              {name} ({p.department || "Nhân sự"})
                            </option>
                          );
                        })}
                      </select>
                    </div>
                    {Array.isArray(scheduleForm.coActors) && scheduleForm.coActors.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {scheduleForm.coActors.map((co) => (
                          <span
                            key={co}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold border border-indigo-200 dark:border-indigo-800"
                          >
                            <span>👥 {co}</span>
                            <button
                              type="button"
                              onClick={() =>
                                setScheduleForm({
                                  ...scheduleForm,
                                  coActors: (scheduleForm.coActors || []).filter((x) => x !== co)
                                })
                              }
                              className="hover:text-rose-500 font-bold cursor-pointer"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* BƯỚC 2: CHỌN NHANH TỪ CÁC CÔNG VIỆC / PHIẾU PHỐI HỢP ĐANG CÓ CỦA NHÂN SỰ ĐÓ */}
              <div className="p-3 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/25 border border-indigo-200/80 dark:border-indigo-900/60 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <label className="font-bold text-indigo-900 dark:text-indigo-300 flex items-center gap-1.5 text-[11px]">
                    <span>📋 2. Chọn từ công việc đang có của {activeActorName || "nhân sự"} để đưa vào lịch / cuộc họp</span>
                    <span className="px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/80 text-indigo-700 dark:text-indigo-200 font-mono text-[10px]">
                      {selectableWorkItems.length} đầu việc đang mở
                    </span>
                  </label>
                  {Array.isArray(scheduleForm.linkedTaskCodes) && scheduleForm.linkedTaskCodes.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setScheduleForm({ ...scheduleForm, linkedTaskCodes: [] })}
                      className="text-[10px] text-rose-500 hover:underline font-semibold cursor-pointer"
                    >
                      Bỏ chọn ({scheduleForm.linkedTaskCodes.length})
                    </button>
                  )}
                </div>

                {selectableWorkItems.length === 0 ? (
                  <p className="text-[11px] text-slate-500 italic">
                    Hiện {activeActorName || "nhân sự này"} chưa có công việc tồn đọng nào trong danh sách. Bạn có thể nhập trực tiếp nội dung ở mục 4 bên dưới.
                  </p>
                ) : (
                  <div className="max-h-32 overflow-y-auto space-y-1.5 pr-1">
                    {selectableWorkItems.map((item) => {
                      const isPicked = (scheduleForm.linkedTaskCodes || []).includes(item.code);
                      return (
                        <button
                          key={item.code}
                          type="button"
                          onClick={() => handleToggleWorkItemForSchedule(item)}
                          className={`w-full text-left px-2.5 py-1.5 rounded-lg border transition-all flex items-center justify-between gap-2 cursor-pointer ${
                            isPicked
                              ? "bg-indigo-600 text-white border-indigo-500 shadow-xs"
                              : "bg-white dark:bg-slate-900 hover:bg-indigo-50 dark:hover:bg-slate-800/80 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-800"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              readOnly
                              checked={isPicked}
                              className="w-3.5 h-3.5 rounded accent-indigo-500 pointer-events-none shrink-0"
                            />
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold shrink-0 ${
                              isPicked ? "bg-white/20 text-white" : "bg-slate-100 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400"
                            }`}>
                              {item.code}
                            </span>
                            <span className="font-semibold truncate text-[11px]">{item.title}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 text-[10px]">
                            {item.location && (
                              <span className={`truncate max-w-[110px] ${isPicked ? "text-indigo-100" : "text-slate-500"}`}>
                                📍 {item.location}
                              </span>
                            )}
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                              isPicked ? "bg-white/20 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                            }`}>
                              {item.typeLabel}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* BƯỚC 3: CHỌN KHOẢNG THỜI GIAN (1 NGÀY / TỪ NGÀY -> ĐẾN NGÀY / NHIỀU THỨ) & KHUNG GIỜ LINH HOẠT */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
                {/* Cột trái: Ngày / Khoảng ngày */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-1 flex-wrap">
                    <label className="font-bold text-slate-700 dark:text-slate-200">3. Ngày / Khoảng ngày *</label>
                    <div className="inline-flex rounded-lg bg-slate-200/80 dark:bg-slate-800 p-0.5 text-[10px] font-bold">
                      <button
                        type="button"
                        onClick={() => setScheduleForm({ ...scheduleForm, dateMode: "SINGLE" })}
                        className={`px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                          (scheduleForm.dateMode || "SINGLE") === "SINGLE"
                            ? "bg-indigo-600 text-white"
                            : "text-slate-600 dark:text-slate-300"
                        }`}
                      >
                        1 Ngày
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setScheduleForm({
                            ...scheduleForm,
                            dateMode: "RANGE",
                            endDate: scheduleForm.endDate && scheduleForm.endDate >= (scheduleForm.date || "") ? scheduleForm.endDate : scheduleForm.date
                          })
                        }
                        className={`px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                          scheduleForm.dateMode === "RANGE"
                            ? "bg-indigo-600 text-white"
                            : "text-slate-600 dark:text-slate-300"
                        }`}
                      >
                        Từ ngày → Đến ngày
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setScheduleForm({
                            ...scheduleForm,
                            dateMode: "MULTI_DAYS",
                            selectedDates: scheduleForm.selectedDates?.length ? scheduleForm.selectedDates : [scheduleForm.date || todayVN()]
                          })
                        }
                        className={`px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                          scheduleForm.dateMode === "MULTI_DAYS"
                            ? "bg-indigo-600 text-white"
                            : "text-slate-600 dark:text-slate-300"
                        }`}
                      >
                        Chọn nhiều thứ
                      </button>
                    </div>
                  </div>

                  {scheduleForm.dateMode === "RANGE" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="block text-[10px] text-slate-500 mb-0.5">Từ ngày *</span>
                        <DateInputVN
                          required
                          value={scheduleForm.date || ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setScheduleForm({
                              ...scheduleForm,
                              date: v,
                              endDate: scheduleForm.endDate && scheduleForm.endDate >= v ? scheduleForm.endDate : v
                            });
                          }}
                          className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-bold"
                        />
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-500 mb-0.5">Đến ngày *</span>
                        <DateInputVN
                          required
                          min={scheduleForm.date || undefined}
                          value={scheduleForm.endDate || scheduleForm.date || ""}
                          onChange={(e) => setScheduleForm({ ...scheduleForm, endDate: e.target.value })}
                          className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-bold"
                        />
                      </div>
                    </div>
                  ) : (
                    <DateInputVN
                      required={scheduleForm.dateMode !== "MULTI_DAYS"}
                      value={scheduleForm.date || ""}
                      onChange={(e) =>
                        setScheduleForm({
                          ...scheduleForm,
                          date: e.target.value,
                          endDate: e.target.value,
                          selectedDates: [e.target.value]
                        })
                      }
                      className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-bold"
                    />
                  )}

                  {/* Các nút chọn nhanh Thứ 2 -> Chủ nhật trong tuần */}
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {viewedWeek.all7Days.map((wd) => {
                      const shortName = wd.name === "Chủ nhật" ? "CN" : wd.name.replace("Thứ ", "T");
                      const isSelected =
                        scheduleForm.dateMode === "MULTI_DAYS"
                          ? (scheduleForm.selectedDates || []).includes(wd.date)
                          : scheduleForm.dateMode === "RANGE"
                          ? Boolean(scheduleForm.date && scheduleForm.endDate && wd.date >= scheduleForm.date && wd.date <= scheduleForm.endDate)
                          : scheduleForm.date === wd.date;
                      return (
                        <button
                          key={wd.date}
                          type="button"
                          onClick={() => {
                            if (scheduleForm.dateMode === "MULTI_DAYS") {
                              const cur = scheduleForm.selectedDates || [];
                              const next = cur.includes(wd.date)
                                ? cur.filter((d) => d !== wd.date)
                                : [...cur, wd.date];
                              setScheduleForm({
                                ...scheduleForm,
                                date: next[0] || wd.date,
                                selectedDates: next.length > 0 ? next : [wd.date]
                              });
                            } else if (scheduleForm.dateMode === "RANGE") {
                              const curStart = scheduleForm.date || wd.date;
                              if (wd.date < curStart) {
                                setScheduleForm({ ...scheduleForm, date: wd.date, endDate: curStart });
                              } else {
                                setScheduleForm({ ...scheduleForm, endDate: wd.date });
                              }
                            } else {
                              setScheduleForm({ ...scheduleForm, date: wd.date, endDate: wd.date, selectedDates: [wd.date] });
                            }
                          }}
                          className={`px-2 py-1 rounded-lg text-[10px] font-bold cursor-pointer transition-colors ${
                            isSelected
                              ? "bg-indigo-600 text-white shadow-2xs"
                              : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-indigo-400"
                          }`}
                        >
                          {shortName} {wd.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Cột phải: Khung giờ thực hiện linh hoạt (Chọn Từ giờ -> Đến giờ + Chọn nhanh Ca + Gõ tự do) */}
                <div className="space-y-2">
                  <label className="block font-bold text-slate-700 dark:text-slate-200">
                    Khung giờ {isMeetingMode ? "họp" : "thực hiện"} (Chọn khoảng giờ hoặc gõ tự do) *
                  </label>

                  {/* Chọn nhanh Từ giờ -> Đến giờ */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-500 shrink-0">Từ:</span>
                      <select
                        value={scheduleForm.startTime || "08:30"}
                        onChange={(e) => {
                          const st = e.target.value;
                          const et = scheduleForm.endTime || "11:30";
                          setScheduleForm({
                            ...scheduleForm,
                            startTime: st,
                            time: `${st} - ${et}`
                          });
                        }}
                        className="w-full px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-mono font-bold text-xs cursor-pointer"
                      >
                        {timeSlotOptions.map((t) => (
                          <option key={`st-${t}`} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-500 shrink-0">Đến:</span>
                      <select
                        value={scheduleForm.endTime || "11:30"}
                        onChange={(e) => {
                          const et = e.target.value;
                          const st = scheduleForm.startTime || "08:30";
                          setScheduleForm({
                            ...scheduleForm,
                            endTime: et,
                            time: `${st} - ${et}`
                          });
                        }}
                        className="w-full px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-mono font-bold text-xs cursor-pointer"
                      >
                        {timeSlotOptions.map((t) => (
                          <option key={`et-${t}`} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Ô gõ thời gian tự do linh hoạt */}
                  <input
                    type="text"
                    required
                    value={scheduleForm.time}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, time: e.target.value })}
                    placeholder="Gõ tự do VD: 08:30 - 10:00, Sáng 8h30-10h, Đầu giờ chiều..."
                    className="w-full px-3 py-1.5 rounded-xl border border-indigo-300 dark:border-indigo-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-mono font-bold"
                  />

                  {/* Các nút chọn nhanh Ca làm việc / Khung giờ họp */}
                  <div className="flex flex-wrap gap-1">
                    {[
                      { label: "⚡ Họp sáng (08:30 - 10:00)", val: "08:30 - 10:00", st: "08:30", et: "10:00" },
                      { label: "🌅 Ca Sáng (08:00 - 12:00)", val: "08:00 - 12:00", st: "08:00", et: "12:00" },
                      { label: "☀️ Họp chiều (14:00 - 15:30)", val: "14:00 - 15:30", st: "14:00", et: "15:30" },
                      { label: "🌤️ Ca Chiều (13:30 - 17:30)", val: "13:30 - 17:30", st: "13:30", et: "17:30" },
                      { label: "🗓️ Cả ngày (08:00 - 17:30)", val: "08:00 - 17:30", st: "08:00", et: "17:30" }
                    ].map((preset) => (
                      <button
                        key={preset.val}
                        type="button"
                        onClick={() =>
                          setScheduleForm({
                            ...scheduleForm,
                            startTime: preset.st,
                            endTime: preset.et,
                            time: preset.val
                          })
                        }
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold cursor-pointer transition-colors ${
                          scheduleForm.time === preset.val
                            ? "bg-amber-600 text-white"
                            : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-amber-500"
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* CẢNH BÁO TRÙNG LỊCH TRONG NGÀY CỦA NHÂN SỰ (NẾU CÓ) */}
              {existingActorSchedulesOnDate.length > 0 && (
                <div className="px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-2">
                  <span className="shrink-0">⚠️</span>
                  <div>
                    <span className="font-bold">
                      {activeActorName} đã có {existingActorSchedulesOnDate.length} lịch trong ngày {activeDateIso.slice(8, 10)}/{activeDateIso.slice(5, 7)}:
                    </span>{" "}
                    {existingActorSchedulesOnDate.map((s: any) => `[${s.time}: ${s.title}]`).join(" • ")}
                  </div>
                </div>
              )}

              {/* BƯỚC 4: TIÊU ĐỀ NỘI DUNG & ĐỊA ĐIỂM / PHÒNG HỌP + LINK HỌP + AGENDA */}
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                  <div className="md:col-span-7">
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {isMeetingMode ? "4. Chủ đề / Tiêu đề cuộc họp *" : "4. Tiêu đề & Nội dung công tác *"}
                    </label>
                    <input
                      type="text"
                      required
                      value={scheduleForm.title}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, title: e.target.value })}
                      placeholder={
                        isMeetingMode
                          ? "VD: Họp giao ban đầu tuần, Họp phương án thầu BV Chợ Rẫy..."
                          : "VD: Demo máy Real-time PCR tại BV Chợ Rẫy, Giao 20 kit cho Pasteur..."
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-medium"
                    />
                  </div>
                  <div className="md:col-span-5">
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {isMeetingMode ? "Phòng họp / Địa điểm họp" : "Địa điểm / Bệnh viện / KH"}
                    </label>
                    <input
                      type="text"
                      value={scheduleForm.location}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, location: e.target.value })}
                      placeholder={isMeetingMode ? "VD: Phòng họp chính Tầng 2, Online..." : "VD: BV Chợ Rẫy, Viện Pasteur..."}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-medium"
                    />
                  </div>
                </div>

                {/* Mở rộng cho Lịch Họp: Link họp trực tuyến & Nội dung chuẩn bị (Agenda) */}
                {isMeetingMode && (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 p-3 rounded-xl bg-rose-50/40 dark:bg-rose-950/20 border border-rose-200/70 dark:border-rose-900/50">
                    <div className="md:col-span-5 space-y-1">
                      <label className="block font-bold text-slate-700 dark:text-slate-300">
                        🔗 Link họp trực tuyến (Google Meet / Zoom / Teams)
                      </label>
                      <input
                        type="text"
                        value={scheduleForm.meetingLink || ""}
                        onChange={(e) => setScheduleForm({ ...scheduleForm, meetingLink: e.target.value })}
                        placeholder="https://meet.google.com/... hoặc link Zoom (nếu có)"
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-mono text-[11px]"
                      />
                      <p className="text-[10px] text-slate-500">
                        Link họp sẽ được đính kèm trực tiếp vào tin nhắn mời họp &amp; nhắc họp.
                      </p>
                    </div>
                    <div className="md:col-span-7 space-y-1">
                      <label className="block font-bold text-slate-700 dark:text-slate-300">
                        📝 Nội dung chương trình họp &amp; Yêu cầu chuẩn bị (Agenda)
                      </label>
                      <textarea
                        rows={2}
                        value={scheduleForm.meetingAgenda || ""}
                        onChange={(e) => setScheduleForm({ ...scheduleForm, meetingAgenda: e.target.value })}
                        placeholder="Ghi chú các nội dung chính cần thảo luận hoặc tài liệu các thành viên cần chuẩn bị trước khi họp..."
                        className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-[11px]"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* BƯỚC 5: CẤU HÌNH NHẮN TIN THÔNG BÁO HỌP & TỰ ĐỘNG NHẮC LỊCH HỌP */}
              {(isMeetingMode || (scheduleForm.coActors && scheduleForm.coActors.length > 0)) && (
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-indigo-50/90 via-rose-50/60 to-amber-50/70 dark:from-indigo-950/40 dark:via-rose-950/25 dark:to-amber-950/25 border border-indigo-200 dark:border-indigo-800/80 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="font-extrabold text-indigo-950 dark:text-indigo-200 text-xs flex items-center gap-1.5">
                      <span>💬 5. Nhắn tin thông báo mời họp &amp; Cài đặt nhắc lịch họp</span>
                    </div>
                    {editingScheduleId && (
                      <button
                        type="button"
                        onClick={() =>
                          handleRemindMeetingNow({
                            id: editingScheduleId,
                            title: scheduleForm.title,
                            date: scheduleForm.date,
                            endDate: scheduleForm.endDate,
                            time: scheduleForm.time,
                            location: scheduleForm.location,
                            actor: activeActorName,
                            coActors: scheduleForm.coActors,
                            meetingAgenda: scheduleForm.meetingAgenda,
                            meetingLink: scheduleForm.meetingLink,
                            createMeetingGroup: scheduleForm.createMeetingGroup,
                            chatChannelId: scheduleForm.chatChannelId
                          })
                        }
                        className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-[10px] flex items-center gap-1 shadow-xs cursor-pointer"
                      >
                        <span>🔔 Gửi tin nhắn nhắc lịch họp ngay bây giờ</span>
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    <label className="flex items-start gap-2 p-2 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={Boolean(scheduleForm.sendChatNotify)}
                        onChange={(e) => setScheduleForm({ ...scheduleForm, sendChatNotify: e.target.checked })}
                        className="w-4 h-4 mt-0.5 rounded accent-rose-600 cursor-pointer"
                      />
                      <div>
                        <div className="font-bold text-slate-800 dark:text-slate-100 text-[11px]">
                          💬 Nhắn tin thông báo qua Chat nội bộ cho từng thành viên
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Tự động gửi tin nhắn mời họp vào hộp thư Chat 1-1 của từng người tham dự (hiện số tin nhắn chưa đọc).
                        </div>
                      </div>
                    </label>

                    <label className="flex items-start gap-2 p-2 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={Boolean(scheduleForm.createMeetingGroup)}
                        onChange={(e) => setScheduleForm({ ...scheduleForm, createMeetingGroup: e.target.checked })}
                        className="w-4 h-4 mt-0.5 rounded accent-indigo-600 cursor-pointer"
                      />
                      <div>
                        <div className="font-bold text-slate-800 dark:text-slate-100 text-[11px]">
                          👥 Tạo Nhóm Chat riêng cho cuộc họp này
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Tạo phòng chat nhóm <strong>&ldquo;📅 Họp: {scheduleForm.title || "..."}&rdquo;</strong> gồm tất cả thành viên để trao đổi tài liệu &amp; biên bản.
                        </div>
                      </div>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center pt-1">
                    <div className="md:col-span-5 flex items-center gap-2">
                      <label className="font-bold text-slate-700 dark:text-slate-200 text-[11px] shrink-0">
                        ⏰ Tự động nhắc trước:
                      </label>
                      <select
                        value={scheduleForm.reminderMinutes ?? 30}
                        onChange={(e) => setScheduleForm({ ...scheduleForm, reminderMinutes: Number(e.target.value) })}
                        className="w-full px-2.5 py-1.5 rounded-xl border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-bold text-[11px] cursor-pointer"
                      >
                        <option value={15}>🔔 Trước 15 phút (Nhắc qua Chat &amp; Chuông)</option>
                        <option value={30}>🔔 Trước 30 phút (Khuyên dùng)</option>
                        <option value={60}>🔔 Trước 1 giờ</option>
                        <option value={120}>🔔 Trước 2 giờ</option>
                        <option value={1440}>🔔 Trước 1 ngày (24 giờ)</option>
                        <option value={0}>🔕 Không tự động nhắc (Chỉ nhắc thủ công)</option>
                      </select>
                    </div>

                    <div className="md:col-span-7">
                      <input
                        type="text"
                        value={scheduleForm.customNotifyMessage || ""}
                        onChange={(e) => setScheduleForm({ ...scheduleForm, customNotifyMessage: e.target.value })}
                        placeholder="💬 Lời nhắn kèm theo thông báo mời họp (VD: Anh/chị mang theo laptop và số liệu tuần nhé)..."
                        className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-[11px]"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Tùy chọn tự động tạo Nhiệm vụ (Task) nếu lịch này chưa gắn với công việc có sẵn */}
              {!editingScheduleId && (!scheduleForm.linkedTaskCodes || scheduleForm.linkedTaskCodes.length === 0) && (
                <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={Boolean(scheduleForm.autoCreateTask)}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, autoCreateTask: e.target.checked })}
                    className="w-4 h-4 rounded accent-emerald-600 cursor-pointer"
                  />
                  <span className="text-[11px] font-semibold text-emerald-900 dark:text-emerald-300">
                    ⚡ Đồng thời tạo luôn <strong>Nhiệm vụ (Task)</strong> mới giao cho{" "}
                    <strong>
                      {[activeActorName, ...(scheduleForm.coActors || [])].filter(Boolean).join(", ") || "nhân sự này"}
                    </strong>{" "}
                    trong Bảng Công Việc
                  </span>
                </label>
              )}

              {/* Đính kèm tài liệu kế hoạch / tài liệu họp */}
              <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Paperclip className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Đính kèm tài liệu {isMeetingMode ? "cuộc họp / biên bản" : "kế hoạch"} (PDF, Word, Ảnh)</span>
                  </label>
                  <label className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer">
                    <span>+ Đính kèm file</span>
                    <input
                      type="file"
                      multiple
                      accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.xml,.csv,.txt,.rtf,.zip,.rar,.7z,.tar,.gz"
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
                  className="px-4 py-2 rounded-xl font-bold border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className={`px-5 py-2 rounded-xl font-bold text-white shadow-md cursor-pointer ${
                    isMeetingMode
                      ? "bg-rose-600 hover:bg-rose-700 shadow-rose-600/30"
                      : "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/30"
                  }`}
                >
                  {isMeetingMode
                    ? editingScheduleId
                      ? "💾 Cập Nhật Lịch Họp & Gửi Thông Báo"
                      : "🎥 Tạo Lịch Họp & Gửi Tin Nhắn Mời Họp"
                    : "Lưu Vào Lịch Tuần"}
                </button>
              </div>
            </form>
          );
        })()}
      </Modal>

      {/* ==================== MODAL 5: TẠO / SỬA DỰ ÁN LIÊN PHÒNG BAN & KẾ HOẠCH CHUYÊN ĐỀ ==================== */}
      <Modal
        isOpen={isLabProjectModalOpen}
        onClose={() => setIsLabProjectModalOpen(false)}
        title={editingThematicId ? "CHỈNH SỬA DỰ ÁN / KẾ HOẠCH CHUYÊN ĐỀ" : "🚀 TẠO DỰ ÁN LIÊN PHÒNG BAN / KẾ HOẠCH CHUYÊN ĐỀ"}
        size="lg"
      >
        <form onSubmit={handleSaveLabProject} className="space-y-4 p-1 text-xs">
          {/* Top Bar: Scope/Department & ID & Status */}
          <div className="space-y-3 p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Phạm vi / Phòng chủ trì *</label>
                <select
                  value={labProjectForm.dept}
                  onChange={(e) => handleThematicDeptChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold cursor-pointer"
                >
                  <option value="Liên Phòng Ban">🚀 Dự Án Liên Phòng Ban (Nhiều bộ phận phối hợp)</option>
                  <option value="Kinh Doanh">💼 Kinh Doanh (Sales)</option>
                  <option value="Application">🔬 Application (Kỹ thuật &amp; Lab)</option>
                  <option value="Cung Ứng">🛒 Cung Ứng (Procurement)</option>
                  <option value="Kho & Vận Hành">📦 Kho &amp; Vận Hành</option>
                  <option value="Pháp Chế">⚖️ Pháp Chế (Legal)</option>
                  <option value="Kế Toán">💰 Kế Toán - Tài Chính</option>
                  <option value="Ban Giám Đốc">🏆 Ban Giám Đốc</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Mã dự án / chuyên đề *</label>
                <input
                  type="text"
                  required
                  value={labProjectForm.id}
                  onChange={(e) => setLabProjectForm({ ...labProjectForm, id: e.target.value })}
                  placeholder="DA-NPD-01"
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

            {/* Multi-select Participating Departments */}
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                🏢 Các phòng ban cùng tham gia dự án (Bấm để chọn/bỏ chọn nhiều phòng ban):
              </label>
              <div className="flex flex-wrap gap-1.5">
                {DEPARTMENTS.filter((d) => d.id !== "all").map((d) => {
                  const isPicked = Array.isArray(labProjectForm.participatingDepts) && labProjectForm.participatingDepts.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => {
                        const cur = Array.isArray(labProjectForm.participatingDepts) ? labProjectForm.participatingDepts : [];
                        const next = isPicked ? cur.filter((x) => x !== d.id) : [...cur, d.id];
                        setLabProjectForm({ ...labProjectForm, participatingDepts: next });
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                        isPicked
                          ? "bg-purple-600 text-white border-purple-600 shadow-2xs"
                          : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-purple-400"
                      }`}
                    >
                      {isPicked ? "✓ " : "+ "}{d.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Section 1: Compact Dropdown for Custom Project (Default) OR Pre-built Template */}
          <div className="p-3 rounded-xl border border-purple-200/80 dark:border-purple-800/60 bg-purple-50/40 dark:bg-purple-950/20 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 shrink-0">
                <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                <span>1. Mẫu dự án khởi tạo:</span>
              </label>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Mặc định tạo mới tự do — bấm vào nút xổ bên dưới nếu muốn áp dụng mẫu dự án có sẵn
              </span>
            </div>

            {(() => {
              const templateList = DEPARTMENT_THEMATIC_TYPES[labProjectForm.dept] || DEPARTMENT_THEMATIC_TYPES["Liên Phòng Ban"] || DEPARTMENT_THEMATIC_TYPES["Application"] || [];
              const selectedTpl = templateList.find((t) => t.id === labProjectForm.typeId);
              return (
                <>
                  <select
                    value={labProjectForm.typeId || "custom_project"}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "custom_project") {
                        handleSelectCustomProjectType();
                      } else {
                        const found = templateList.find((t) => t.id === val);
                        if (found) handleThematicTypeChange(found);
                      }
                    }}
                    className="w-full px-3 py-2.5 rounded-xl border border-purple-300 dark:border-purple-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold text-xs cursor-pointer shadow-2xs focus:ring-2 focus:ring-purple-500/30 outline-none"
                  >
                    <option value="custom_project">
                      ✨ Tạo mới hoàn toàn (Không theo mẫu có sẵn — tự tạo các bước bên dưới)
                    </option>
                    <optgroup label={`📋 Chọn từ mẫu dự án có sẵn (${labProjectForm.dept})`}>
                      {templateList.map((typeDef) => (
                        <option key={typeDef.id} value={typeDef.id}>
                          {typeDef.icon} Mẫu: {typeDef.name} ({typeDef.defaultStages.length} bước gợi ý)
                        </option>
                      ))}
                    </optgroup>
                  </select>

                  {selectedTpl && (
                    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white/90 dark:bg-slate-900/90 border border-purple-200 dark:border-purple-800 text-[11px]">
                      <div className="text-slate-600 dark:text-slate-300 leading-snug">
                        <span className="font-bold text-purple-700 dark:text-purple-300 mr-1.5">
                          {selectedTpl.icon} Đang áp dụng mẫu ({selectedTpl.defaultStages.length} bước):
                        </span>
                        <span>{selectedTpl.description}</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleSelectCustomProjectType}
                        className="px-2.5 py-1 rounded-lg font-bold text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-purple-100 dark:hover:bg-purple-900/50 hover:text-purple-700 shrink-0 cursor-pointer"
                      >
                        ↺ Tạo mới không theo mẫu
                      </button>
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          {/* Section 2: Core Details */}
          <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <h5 className="font-bold text-slate-800 dark:text-slate-200 text-xs">
              2. Nội dung chi tiết &amp; Nhân sự thực hiện:
            </h5>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Tên dự án / Nhóm công việc *
                </label>
                <input
                  type="text"
                  required
                  value={labProjectForm.name}
                  onChange={(e) => setLabProjectForm({ ...labProjectForm, name: e.target.value })}
                  placeholder="Nhập tên dự án hoặc nhóm công việc bất kỳ..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Phân loại / Nhóm chuyên đề (Tùy chỉnh)
                </label>
                <input
                  type="text"
                  value={labProjectForm.typeName}
                  onChange={(e) => setLabProjectForm({ ...labProjectForm, typeName: e.target.value })}
                  placeholder="VD: Dự án nội bộ, Triển khai KH..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Chủ nhiệm dự án (PM / Lead) *
                </label>
                <SearchablePersonnelSelect
                  value={labProjectForm.lead}
                  onChange={(val) => setLabProjectForm({ ...labProjectForm, lead: val })}
                  personnelList={personnelList}
                  filterDepartment={labProjectForm.dept === "Liên Phòng Ban" ? "all" : labProjectForm.dept}
                  placeholder="Chọn chủ nhiệm dự án..."
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  🔗 Khách hàng / Mã liên kết nghiệp vụ
                </label>
                <input
                  type="text"
                  value={labProjectForm.customerOrRef || ""}
                  onChange={(e) => setLabProjectForm({ ...labProjectForm, customerOrRef: e.target.value })}
                  placeholder="VD: BV Chợ Rẫy / Mã Đơn hàng SO, Báo giá BG, Gói thầu, Mã PR/PO..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium"
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
                <DateInputVN
                  value={labProjectForm.startDate}
                  onChange={(e) => setLabProjectForm({ ...labProjectForm, startDate: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Hạn hoàn thành (Deadline)</label>
                <DateInputVN
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
                placeholder="Nêu rõ mục tiêu cụ thể, phạm vi phối hợp hoặc kết quả đầu ra cần đạt được..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium"
              />
            </div>
          </div>

          {/* Section 3: Stages & Multiple Tasks inside each Stage */}
          <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h5 className="font-bold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-1.5">
                  <ListChecks className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  <span>3. Phân chia Giai đoạn &amp; Danh sách Công việc trong từng giai đoạn:</span>
                </h5>
                <p className="text-[11px] text-slate-400">
                  Mỗi giai đoạn có thể thêm nhiều đầu việc cụ thể, gán phòng ban, người thực hiện và hạn hoàn thành riêng
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  const defaultDepts = labProjectForm.dept === "Liên Phòng Ban"
                    ? (Array.isArray(labProjectForm.participatingDepts) && labProjectForm.participatingDepts.length > 0 ? labProjectForm.participatingDepts : ["Kinh Doanh"])
                    : [labProjectForm.dept];
                  const defaultDept = defaultDepts[0] || "Kinh Doanh";
                  const stageDue = labProjectForm.endDate || todayVN();
                  const newStage = {
                    id: `stg-${Date.now()}-${labProjectForm.stages.length}`,
                    name: "",
                    dept: defaultDept,
                    depts: defaultDepts,
                    due: stageDue,
                    assignee: "",
                    status: "pending" as const,
                    estimatedDays: 3,
                    tasks: [
                      {
                        id: `stgtask-${Date.now()}-${labProjectForm.stages.length}-0`,
                        title: "",
                        dept: defaultDept,
                        assignee: "",
                        due: stageDue,
                        status: "pending" as const
                      }
                    ]
                  };
                  setLabProjectForm({
                    ...labProjectForm,
                    stages: [...labProjectForm.stages, newStage]
                  });
                }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white shadow-2xs transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Thêm Giai Đoạn Mới</span>
              </button>
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {labProjectForm.stages.map((stg, sIdx) => {
                const stgTasks = Array.isArray(stg.tasks) ? stg.tasks : [];
                const stgDepts: string[] = Array.isArray(stg.depts) && stg.depts.length > 0
                  ? stg.depts
                  : [stg.dept || (labProjectForm.dept !== "Liên Phòng Ban" ? labProjectForm.dept : "Kinh Doanh")];
                const stgDue = stg.due || labProjectForm.endDate || todayVN();
                return (
                  <div
                    key={stg.id || sIdx}
                    className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-950 space-y-2.5 text-xs"
                  >
                    {/* Stage Top Row */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span className="font-mono font-extrabold text-white px-2 py-1 rounded-lg bg-purple-600 text-[10px] shrink-0">
                          GĐ {sIdx + 1}
                        </span>

                        <input
                          type="text"
                          value={stg.name}
                          onChange={(e) => {
                            const updated = [...labProjectForm.stages];
                            updated[sIdx] = { ...updated[sIdx], name: e.target.value };
                            setLabProjectForm({ ...labProjectForm, stages: updated });
                          }}
                          placeholder={`Tên giai đoạn ${sIdx + 1} (VD: Khảo sát, Chuẩn bị, Triển khai...)`}
                          className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold text-xs min-w-[160px]"
                        />
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap shrink-0">
                        <input
                          type="text"
                          list={`stg-staff-list-${sIdx}`}
                          value={stg.assignee || ""}
                          onChange={(e) => {
                            const updated = [...labProjectForm.stages];
                            updated[sIdx] = { ...updated[sIdx], assignee: e.target.value };
                            setLabProjectForm({ ...labProjectForm, stages: updated });
                          }}
                          placeholder="Đầu mối GĐ..."
                          className="w-28 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-[11px]"
                        />
                        <datalist id={`stg-staff-list-${sIdx}`}>
                          {personnelList
                            .filter((p: any) => stgDepts.length === 0 || stgDepts.some((d) => isSameWorkspaceDept(p.department, d)))
                            .map((p: any) => (
                              <option key={p.employee_code || p.full_name} value={p.full_name} />
                            ))}
                        </datalist>

                        <div className="flex items-center gap-1" title="Ngày hoàn thành (Deadline) của giai đoạn này">
                          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 shrink-0">📅 Hạn GĐ:</span>
                          <DateInputVN
                            value={stgDue}
                            onChange={(e) => {
                              const newDue = e.target.value;
                              const updated = [...labProjectForm.stages];
                              const oldDue = updated[sIdx].due;
                              const updatedTasks = Array.isArray(updated[sIdx].tasks)
                                ? updated[sIdx].tasks!.map((t: any) => (!t.due || t.due === oldDue) ? { ...t, due: newDue } : t)
                                : [];
                              updated[sIdx] = { ...updated[sIdx], due: newDue, tasks: updatedTasks };
                              setLabProjectForm({ ...labProjectForm, stages: updated });
                            }}
                            className="w-28 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-[11px] font-semibold"
                          />
                        </div>

                        <select
                          value={stg.status}
                          onChange={(e) => {
                            const updated = [...labProjectForm.stages];
                            updated[sIdx] = { ...updated[sIdx], status: e.target.value as any };
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

                    {/* Multi-select Coordinating Departments for this Stage */}
                    <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                      <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 shrink-0">
                        🏢 Phòng ban phối hợp GĐ {sIdx + 1} (chọn 1 hoặc nhiều):
                      </span>
                      {DEPARTMENTS.filter((d) => d.id !== "all").map((d) => {
                        const isPicked = stgDepts.includes(d.id);
                        return (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => {
                              const nextDepts = isPicked
                                ? (stgDepts.length > 1 ? stgDepts.filter((x) => x !== d.id) : stgDepts)
                                : [...stgDepts, d.id];
                              const updated = [...labProjectForm.stages];
                              updated[sIdx] = {
                                ...updated[sIdx],
                                depts: nextDepts,
                                dept: nextDepts[0] || "Kinh Doanh"
                              };
                              setLabProjectForm({ ...labProjectForm, stages: updated });
                            }}
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-all cursor-pointer ${
                              isPicked
                                ? "bg-indigo-600 text-white border-indigo-600 shadow-2xs"
                                : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-indigo-400"
                            }`}
                          >
                            {isPicked ? "✓ " : "+ "}{d.name}
                          </button>
                        );
                      })}
                    </div>

                    {/* Sub-tasks List inside this Stage */}
                    <div className="pl-3 sm:pl-6 border-l-2 border-purple-200 dark:border-purple-800/80 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                          📋 Các công việc cụ thể trong Giai đoạn {sIdx + 1} ({stgTasks.length} việc — mỗi việc gán 1 phòng ban cụ thể):
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = [...labProjectForm.stages];
                            const curTasks = Array.isArray(updated[sIdx].tasks) ? updated[sIdx].tasks! : [];
                            updated[sIdx] = {
                              ...updated[sIdx],
                              tasks: [
                                ...curTasks,
                                {
                                  id: `stgtask-${Date.now()}-${sIdx}-${curTasks.length}`,
                                  title: "",
                                  dept: stgDepts[0] || stg.dept || (labProjectForm.dept !== "Liên Phòng Ban" ? labProjectForm.dept : "Kinh Doanh"),
                                  assignee: stg.assignee || "",
                                  due: stgDue,
                                  status: "pending" as const
                                }
                              ]
                            };
                            setLabProjectForm({ ...labProjectForm, stages: updated });
                          }}
                          className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 hover:bg-purple-200 cursor-pointer flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" />
                          <span>+ Thêm công việc vào GĐ {sIdx + 1}</span>
                        </button>
                      </div>

                      {stgTasks.map((taskItem, tIdx) => {
                        const taskSpecificDept = taskItem.dept || stgDepts[0] || stg.dept || "Kinh Doanh";
                        return (
                        <div
                          key={taskItem.id || tIdx}
                          className="flex flex-col sm:flex-row sm:items-center gap-1.5 p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800"
                        >
                          <div className="flex items-center gap-1.5 flex-1 min-w-0">
                            <span className="font-mono text-[10px] font-bold text-slate-400 shrink-0">
                              {sIdx + 1}.{tIdx + 1}
                            </span>
                            <input
                              type="text"
                              value={taskItem.title}
                              onChange={(e) => {
                                const updated = [...labProjectForm.stages];
                                const nextTasks = [...(updated[sIdx].tasks || [])];
                                nextTasks[tIdx] = { ...nextTasks[tIdx], title: e.target.value };
                                updated[sIdx] = { ...updated[sIdx], tasks: nextTasks };
                                setLabProjectForm({ ...labProjectForm, stages: updated });
                              }}
                              placeholder={`Nhập nội dung công việc ${sIdx + 1}.${tIdx + 1}...`}
                              className="flex-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white text-[11px] font-medium min-w-[140px]"
                            />
                          </div>

                          <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap shrink-0">
                            <select
                              value={taskSpecificDept}
                              onChange={(e) => {
                                const updated = [...labProjectForm.stages];
                                const nextTasks = [...(updated[sIdx].tasks || [])];
                                nextTasks[tIdx] = { ...nextTasks[tIdx], dept: e.target.value };
                                updated[sIdx] = { ...updated[sIdx], tasks: nextTasks };
                                setLabProjectForm({ ...labProjectForm, stages: updated });
                              }}
                              title="Phòng ban cụ thể phụ trách công việc này"
                              className="px-1.5 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-[10px] font-bold cursor-pointer"
                            >
                              {DEPARTMENTS.filter((d) => d.id !== "all").map((d) => (
                                <option key={d.id} value={d.id}>🏢 {d.id}</option>
                              ))}
                            </select>

                            <input
                              type="text"
                              list={`stg-task-staff-list-${sIdx}-${tIdx}`}
                              value={taskItem.assignee || ""}
                              onChange={(e) => {
                                const updated = [...labProjectForm.stages];
                                const nextTasks = [...(updated[sIdx].tasks || [])];
                                nextTasks[tIdx] = { ...nextTasks[tIdx], assignee: e.target.value };
                                updated[sIdx] = { ...updated[sIdx], tasks: nextTasks };
                                setLabProjectForm({ ...labProjectForm, stages: updated });
                              }}
                              placeholder="Người thực hiện..."
                              className="w-28 px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-[10px]"
                            />
                            <datalist id={`stg-task-staff-list-${sIdx}-${tIdx}`}>
                              {personnelList
                                .filter((p: any) => !taskSpecificDept || isSameWorkspaceDept(p.department, taskSpecificDept))
                                .map((p: any) => (
                                  <option key={p.employee_code || p.full_name} value={p.full_name} />
                                ))}
                            </datalist>

                            <DateInputVN
                              value={taskItem.due || stgDue}
                              onChange={(e) => {
                                const updated = [...labProjectForm.stages];
                                const nextTasks = [...(updated[sIdx].tasks || [])];
                                nextTasks[tIdx] = { ...nextTasks[tIdx], due: e.target.value };
                                updated[sIdx] = { ...updated[sIdx], tasks: nextTasks };
                                setLabProjectForm({ ...labProjectForm, stages: updated });
                              }}
                              className="w-28 px-1.5 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-[10px]"
                            />

                            <select
                              value={taskItem.status || "pending"}
                              onChange={(e) => {
                                const updated = [...labProjectForm.stages];
                                const nextTasks = [...(updated[sIdx].tasks || [])];
                                nextTasks[tIdx] = { ...nextTasks[tIdx], status: e.target.value as any };
                                updated[sIdx] = { ...updated[sIdx], tasks: nextTasks };
                                setLabProjectForm({ ...labProjectForm, stages: updated });
                              }}
                              className="px-1.5 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-[10px] font-semibold"
                            >
                              <option value="pending">Chờ</option>
                              <option value="in_progress">Đang làm</option>
                              <option value="completed">Đã xong</option>
                            </select>

                            <button
                              type="button"
                              onClick={() => {
                                const updated = [...labProjectForm.stages];
                                const nextTasks = (updated[sIdx].tasks || []).filter((_, i) => i !== tIdx);
                                updated[sIdx] = { ...updated[sIdx], tasks: nextTasks };
                                setLabProjectForm({ ...labProjectForm, stages: updated });
                              }}
                              className="p-1 text-slate-400 hover:text-rose-500 rounded cursor-pointer"
                              title="Xóa công việc này"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
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
              <span>{editingThematicId ? "Lưu Thay Đổi Dự Án" : "Tạo Dự Án & Phân Bổ Công Việc"}</span>
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

      {/* ==================== MODAL 7: BAN HÀNH / SỬA THÔNG BÁO, QUYẾT ĐỊNH & QUY CHẾ ==================== */}
      <Modal
        isOpen={isAnnouncementModalOpen}
        onClose={() => setIsAnnouncementModalOpen(false)}
        title={
          editingAnnouncementId
            ? "✏️ CẬP NHẬT VĂN BẢN THÔNG BÁO / QUYẾT ĐỊNH"
            : "📜 BAN HÀNH THÔNG BÁO, QUYẾT ĐỊNH & QUY CHẾ ĐIỀU HÀNH"
        }
        size="lg"
      >
        <form onSubmit={handleSaveAnnouncement} className="space-y-3.5 p-1 text-xs">
          {/* Chọn nhanh Mẫu Văn bản chuẩn */}
          <div className="p-2.5 rounded-xl bg-rose-50/60 dark:bg-rose-950/25 border border-rose-200/80 dark:border-rose-900/60 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-rose-800 dark:text-rose-300">
                ⚡ Chọn nhanh mẫu văn bản chuẩn doanh nghiệp:
              </span>
              <span className="text-[10px] text-rose-600 dark:text-rose-400">
                Tự động sinh Số hiệu &amp; khung điều khoản chuẩn
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                {
                  label: "📜 Quyết định Ban Giám Đốc",
                  docType: "DECISION" as const,
                  priority: "URGENT" as const,
                  title: "Quyết định V/v Ban hành định mức & phân công chỉ tiêu trọng điểm",
                  summary: "Quyết định có hiệu lực thi hành đối với các bộ phận liên quan kể từ ngày ký.",
                  content:
                    "Căn cứ chức năng, nhiệm vụ và quyền hạn của Ban Giám Đốc Công ty;\nCăn cứ nhu cầu vận hành thực tế và đề xuất của các Trưởng bộ phận;\n\nQUYẾT ĐỊNH:\nĐiều 1. Ban hành kèm theo Quyết định này kế hoạch và định mức triển khai công tác trọng tâm.\nĐiều 2. Các Trưởng bộ phận Kinh Doanh, Application, Kho & Vận Hành, Cung Ứng chịu trách nhiệm phổ biến và giám sát thực hiện.\nĐiều 3. Quyết định này có hiệu lực kể từ ngày ký. Các bộ phận và cá nhân liên quan chịu trách nhiệm thi hành Quyết định này."
                },
                {
                  label: "📢 Thông báo Hành chính / Nghỉ lễ",
                  docType: "ANNOUNCEMENT" as const,
                  priority: "IMPORTANT" as const,
                  title: "Thông báo V/v Kế hoạch làm việc & Lịch trực vận hành toàn công ty",
                  summary: "Thông báo áp dụng cho toàn thể cán bộ nhân viên các phòng ban.",
                  content:
                    "Ban Giám Đốc trân trọng thông báo đến toàn thể Cán bộ Nhân viên lịch làm việc và phân công trực vận hành:\n1. Thời gian áp dụng: ...\n2. Yêu cầu đối với bộ phận Kho & Vận Hành và Application: Đảm bảo duy trì đầu mối trực hỗ trợ khách hàng bệnh viện.\n3. Đề nghị toàn thể nhân sự xác nhận đã đọc và nghiêm túc thực hiện."
                },
                {
                  label: "📘 Quy chế / Quy trình SOP",
                  docType: "POLICY" as const,
                  priority: "IMPORTANT" as const,
                  title: "Quy trình chuẩn (SOP) V/v Phối hợp xử lý đơn hàng & Bàn giao thiết bị/hóa chất",
                  summary: "Chuẩn hóa SLA phối hợp giữa Kinh Doanh - Application - Kho Vận - Cung Ứng.",
                  content:
                    "1. Mục đích: Chuẩn hóa quy trình luân chuyển phiếu phối hợp và kiểm soát SLA giữa các phòng ban.\n2. Quy định thực hiện:\n- Bước 1: Bộ phận Kinh Doanh khởi tạo yêu cầu kèm đầy đủ thông tin khách hàng/bệnh viện.\n- Bước 2: Bộ phận Application / Kho xác nhận trong vòng 4 giờ làm việc.\n- Bước 3: Cập nhật đầy đủ biên bản nghiệm thu và chứng từ lên hệ thống."
                },
                {
                  label: "💼 Chính sách Kinh doanh & Thưởng",
                  docType: "SALES_POLICY" as const,
                  priority: "IMPORTANT" as const,
                  title: "Chính sách Thưởng KPI & Hoa hồng phát triển dự án/thầu mới",
                  summary: "Áp dụng cho khối Kinh Doanh và Kỹ thuật Application phối hợp.",
                  content:
                    "1. Đối tượng áp dụng: Nhân sự phòng Kinh Doanh và Application tham gia trực tiếp dự án.\n2. Cơ chế tính thưởng & KPI: Căn cứ theo tỷ lệ hoàn thành doanh số thực thu và nghiệm thu kỹ thuật đạt chuẩn.\n3. Thời hạn thanh toán thưởng: Tổng kết vào cuối mỗi Quý."
                },
                {
                  label: "🏆 Vinh danh & Bổ nhiệm Nhân sự",
                  docType: "RECOGNITION" as const,
                  priority: "NORMAL" as const,
                  title: "Quyết định Khen thưởng cá nhân/tập thể đạt thành tích xuất sắc",
                  summary: "Vinh danh đóng góp nổi bật trong công tác chuyên môn và phục vụ khách hàng.",
                  content:
                    "Ban Giám Đốc quyết định biểu dương và khen thưởng cá nhân/tập thể có thành tích xuất sắc trong kỳ.\nChúc mừng các Anh/Chị tiếp tục phát huy tinh thần chủ động, chuyên nghiệp và đồng hành cùng sự phát triển của Công ty!"
                }
              ].map((tpl) => (
                <button
                  key={tpl.label}
                  type="button"
                  onClick={() =>
                    setAnnouncementForm({
                      ...announcementForm,
                      docType: tpl.docType,
                      docCode: generateNextDocCode(tpl.docType),
                      priority: tpl.priority,
                      pinned: tpl.docType === "DECISION",
                      title: tpl.title,
                      summary: tpl.summary,
                      content: tpl.content
                    })
                  }
                  className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 hover:bg-rose-600 hover:text-white text-slate-700 dark:text-slate-200 border border-rose-200 dark:border-rose-800 text-[10px] font-bold transition-colors cursor-pointer"
                >
                  {tpl.label}
                </button>
              ))}
            </div>
          </div>

          {/* Hàng 1: Loại văn bản + Số hiệu văn bản + Độ khẩn + Ghim */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
            <div className="md:col-span-5">
              <label className="block font-bold text-slate-700 dark:text-slate-200 mb-1">
                1. Phân loại văn bản ban hành *
              </label>
              <select
                value={announcementForm.docType}
                onChange={(e) => {
                  const nextType = e.target.value as any;
                  setAnnouncementForm({
                    ...announcementForm,
                    docType: nextType,
                    docCode: editingAnnouncementId ? announcementForm.docCode : generateNextDocCode(nextType)
                  });
                }}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-bold"
              >
                <option value="DECISION">📜 Quyết định Ban Giám Đốc (QĐ)</option>
                <option value="ANNOUNCEMENT">📢 Thông báo Hành chính / Nội bộ (TB)</option>
                <option value="POLICY">📘 Quy chế / Quy trình chuẩn SOP (QC)</option>
                <option value="SALES_POLICY">💼 Chính sách Kinh doanh &amp; Thưởng (CS)</option>
                <option value="RECOGNITION">🏆 Khen thưởng &amp; Bổ nhiệm Nhân sự (KT)</option>
              </select>
            </div>

            <div className="md:col-span-3">
              <label className="block font-bold text-slate-700 dark:text-slate-200 mb-1">
                Số hiệu văn bản *
              </label>
              <input
                type="text"
                required
                value={announcementForm.docCode}
                onChange={(e) => setAnnouncementForm({ ...announcementForm, docCode: e.target.value })}
                placeholder="VD: QĐ-2026/001"
                className="w-full px-3 py-2 rounded-xl border border-indigo-300 dark:border-indigo-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-mono font-extrabold"
              />
            </div>

            <div className="md:col-span-4">
              <label className="block font-bold text-slate-700 dark:text-slate-200 mb-1">
                Cấp độ ưu tiên &amp; Ghim
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={announcementForm.priority}
                  onChange={(e) => setAnnouncementForm({ ...announcementForm, priority: e.target.value as any })}
                  className="flex-1 px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-bold"
                >
                  <option value="URGENT">🚨 Khẩn cấp / Bắt buộc</option>
                  <option value="IMPORTANT">⭐ Quan trọng</option>
                  <option value="NORMAL">📌 Thông thường</option>
                </select>
                <label className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={announcementForm.pinned}
                    onChange={(e) => setAnnouncementForm({ ...announcementForm, pinned: e.target.checked })}
                    className="w-3.5 h-3.5 rounded accent-amber-600"
                  />
                  <span className="font-bold text-amber-800 dark:text-amber-300 text-[10px]">📌 Ghim đầu</span>
                </label>
              </div>
            </div>
          </div>

          {/* Hàng 2: Người ký ban hành + Chức danh + Ngày ban hành + Ngày hiệu lực */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Người ký / Ban hành *
              </label>
              <input
                type="text"
                required
                value={announcementForm.issuerName}
                onChange={(e) => setAnnouncementForm({ ...announcementForm, issuerName: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Chức vụ / Thẩm quyền
              </label>
              <input
                type="text"
                value={announcementForm.issuerRole}
                onChange={(e) => setAnnouncementForm({ ...announcementForm, issuerRole: e.target.value })}
                placeholder="VD: Giám Đốc Điều Hành, Trưởng phòng..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-semibold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Ngày ban hành
              </label>
              <DateInputVN
                value={announcementForm.issueDate}
                onChange={(e) => setAnnouncementForm({ ...announcementForm, issueDate: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Ngày bắt đầu hiệu lực *
              </label>
              <DateInputVN
                value={announcementForm.effectiveDate}
                onChange={(e) => setAnnouncementForm({ ...announcementForm, effectiveDate: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/40 dark:bg-slate-950 text-slate-900 dark:text-white font-bold"
              />
            </div>
          </div>

          {/* Hàng 3: Phạm vi áp dụng (Toàn công ty / Chọn phòng ban / Chọn nhân sự) */}
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className="font-bold text-slate-700 dark:text-slate-200">
                2. Phạm vi đối tượng áp dụng &amp; nhận văn bản *
              </label>
              <div className="inline-flex rounded-lg bg-slate-200/80 dark:bg-slate-800 p-0.5 text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => setAnnouncementForm({ ...announcementForm, targetScope: "ALL" })}
                  className={`px-2.5 py-1 rounded-md cursor-pointer ${
                    announcementForm.targetScope === "ALL"
                      ? "bg-indigo-600 text-white"
                      : "text-slate-600 dark:text-slate-300"
                  }`}
                >
                  🏢 Toàn công ty
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setAnnouncementForm({
                      ...announcementForm,
                      targetScope: "DEPARTMENTS",
                      targetDepts: announcementForm.targetDepts.length ? announcementForm.targetDepts : ["Kinh Doanh"]
                    })
                  }
                  className={`px-2.5 py-1 rounded-md cursor-pointer ${
                    announcementForm.targetScope === "DEPARTMENTS"
                      ? "bg-indigo-600 text-white"
                      : "text-slate-600 dark:text-slate-300"
                  }`}
                >
                  🏬 Chọn theo Phòng ban
                </button>
              </div>
            </div>

            {announcementForm.targetScope === "DEPARTMENTS" && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {DEPARTMENTS.filter((d) => d.id !== "all").map((d) => {
                  const picked = announcementForm.targetDepts.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => {
                        const next = picked
                          ? announcementForm.targetDepts.filter((x) => x !== d.id)
                          : [...announcementForm.targetDepts, d.id];
                        setAnnouncementForm({ ...announcementForm, targetDepts: next });
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                        picked
                          ? "bg-indigo-600 text-white border-indigo-500"
                          : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700"
                      }`}
                    >
                      {picked ? "✓ " : "+ "}
                      {d.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Hàng 4: Tiêu đề, Trích yếu & Nội dung điều khoản */}
          <div className="space-y-2.5">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                3. Tiêu đề Thông báo / Quyết định *
              </label>
              <input
                type="text"
                required
                value={announcementForm.title}
                onChange={(e) => setAnnouncementForm({ ...announcementForm, title: e.target.value })}
                placeholder="VD: Quyết định V/v Ban hành quy chế phối hợp giao nhận & thử mẫu Bệnh viện Quý 4/2026..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-bold"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Trích yếu / Tóm tắt ngắn gọn (Hiển thị nổi bật ngoài bảng tin &amp; tin nhắn Chat)
              </label>
              <input
                type="text"
                value={announcementForm.summary}
                onChange={(e) => setAnnouncementForm({ ...announcementForm, summary: e.target.value })}
                placeholder="Tóm tắt 1 câu mục đích trọng tâm của văn bản..."
                className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-medium"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                4. Nội dung toàn văn (Các Điều 1, Điều 2, Điều 3... hoặc nội dung thông báo chi tiết) *
              </label>
              <textarea
                rows={6}
                required
                value={announcementForm.content}
                onChange={(e) => setAnnouncementForm({ ...announcementForm, content: e.target.value })}
                placeholder="Nhập toàn văn nội dung Quyết định / Thông báo / Quy định..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-medium leading-relaxed"
              />
            </div>
          </div>

          {/* Hàng 5: Tùy chọn Xác nhận đã đọc (Read Receipt) & Phát sóng đa kênh qua Chat/Chuông */}
          <div className="p-3 rounded-xl bg-gradient-to-r from-rose-50/70 via-indigo-50/50 to-emerald-50/60 dark:from-rose-950/30 dark:via-indigo-950/25 dark:to-emerald-950/25 border border-indigo-200 dark:border-indigo-800/80 grid grid-cols-1 md:grid-cols-3 gap-2.5">
            <label className="flex items-start gap-2 p-2 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={announcementForm.requireAck}
                onChange={(e) => setAnnouncementForm({ ...announcementForm, requireAck: e.target.checked })}
                className="w-4 h-4 mt-0.5 rounded accent-emerald-600"
              />
              <div>
                <div className="font-bold text-slate-800 dark:text-slate-100 text-[11px]">
                  ✍️ Bắt buộc ký xác nhận Đã đọc
                </div>
                <div className="text-[10px] text-slate-500">
                  Theo dõi chính xác nhân sự nào đã đọc, nhân sự nào chưa xem để nhắc nhở.
                </div>
              </div>
            </label>

            <label className="flex items-start gap-2 p-2 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={announcementForm.sendChatNotify}
                onChange={(e) => setAnnouncementForm({ ...announcementForm, sendChatNotify: e.target.checked })}
                className="w-4 h-4 mt-0.5 rounded accent-rose-600"
              />
              <div>
                <div className="font-bold text-slate-800 dark:text-slate-100 text-[11px]">
                  💬 Nhắn tin thông báo qua Chat
                </div>
                <div className="text-[10px] text-slate-500">
                  Gửi trực tiếp thẻ văn bản vào hộp thư Chat 1-1 của từng nhân sự nhận.
                </div>
              </div>
            </label>

            <label className="flex items-start gap-2 p-2 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={announcementForm.sendBellNotify}
                onChange={(e) => setAnnouncementForm({ ...announcementForm, sendBellNotify: e.target.checked })}
                className="w-4 h-4 mt-0.5 rounded accent-indigo-600"
              />
              <div>
                <div className="font-bold text-slate-800 dark:text-slate-100 text-[11px]">
                  🔔 Đẩy Chuông thông báo hệ thống
                </div>
                <div className="text-[10px] text-slate-500">
                  Hiển thị thông báo tức thì trên Chuông &amp; thanh cảnh báo đầu trang.
                </div>
              </div>
            </label>
          </div>

          {/* Hàng 6: Đính kèm File PDF Quyết định đóng dấu đỏ / Văn bản gốc */}
          <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5 text-rose-600" />
                <span>Đính kèm bản Scan PDF Quyết định có dấu đỏ / Biểu mẫu đính kèm</span>
              </label>
              <label className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer">
                <span>+ Tải tệp văn bản lên</span>
                <input
                  type="file"
                  multiple
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                  onChange={(e) => handleFileUpload(e.target.files, "announcement")}
                  className="hidden"
                />
              </label>
            </div>

            {announcementForm.attachments && announcementForm.attachments.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {announcementForm.attachments.map((att: any, idx: number) => (
                  <div
                    key={idx}
                    className="p-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-4 h-4 text-rose-600 shrink-0" />
                      <span className="font-semibold truncate text-[11px]">{att.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setAnnouncementForm((prev) => ({
                          ...prev,
                          attachments: prev.attachments.filter((_, i) => i !== idx)
                        }))
                      }
                      className="text-rose-500 hover:text-rose-700 p-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsAnnouncementModalOpen(false)}
              className="px-4 py-2 rounded-xl font-bold border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-600/30 cursor-pointer"
            >
              {editingAnnouncementId ? "💾 Lưu Cập Nhật Văn Bản" : "📜 Chính Thức Ban Hành Văn Bản"}
            </button>
          </div>
        </form>
      </Modal>

      {/* ==================== MODAL 8: XEM TOÀN VĂN QUYẾT ĐỊNH / THÔNG BÁO & DANH SÁCH ĐÃ ĐỌC / CHƯA ĐỌC ==================== */}
      <Modal
        isOpen={Boolean(selectedAnnouncementDetail)}
        onClose={() => setSelectedAnnouncementDetail(null)}
        title={
          selectedAnnouncementDetail
            ? `${getDocTypeMeta(selectedAnnouncementDetail.docType).shortLabel} • SỐ: ${selectedAnnouncementDetail.docCode}`
            : "CHI TIẾT VĂN BẢN"
        }
        size="lg"
      >
        {selectedAnnouncementDetail && (() => {
          const ann = selectedAnnouncementDetail;
          const meta = getDocTypeMeta(ann.docType);
          const targets = getTargetStaffForAnnouncement(ann);
          const ackedList = targets.filter((t) => hasUserAcknowledgedAnnouncement(ann, t.name));
          const unreadList = targets.filter((t) => !hasUserAcknowledgedAnnouncement(ann, t.name));
          const iHaveAcked = hasUserAcknowledgedAnnouncement(ann);

          return (
            <div className="space-y-4 p-1 text-xs">
              {/* Khung Văn Bản Hành Chính Chuẩn */}
              <div className="p-4 sm:p-5 rounded-2xl bg-slate-50/90 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-extrabold ${meta.badgeClass}`}>
                      {meta.label}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-md bg-white dark:bg-slate-900 font-mono font-extrabold text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700">
                      Số: {ann.docCode}
                    </span>
                    {ann.priority === "URGENT" && (
                      <span className="px-2 py-0.5 rounded-md bg-rose-600 text-white font-extrabold text-[10px]">
                        🚨 KHẨN CẤP
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Ngày ban hành: <strong>{formatDayVN(ann.issueDate)}</strong> • Hiệu lực:{" "}
                    <strong className="text-emerald-600 dark:text-emerald-400">{formatDayVN(ann.effectiveDate)}</strong>
                  </div>
                </div>

                <div className="space-y-1">
                  <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                    {ann.title}
                  </h2>
                  {ann.summary && (
                    <p className="text-xs font-bold text-indigo-700 dark:text-indigo-300">
                      Trích yếu: {ann.summary}
                    </p>
                  )}
                </div>

                <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 whitespace-pre-line leading-relaxed">
                  {ann.content}
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 text-[11px] text-slate-600 dark:text-slate-400">
                  <div>
                    Phạm vi áp dụng:{" "}
                    <strong className="text-slate-900 dark:text-white">
                      {ann.targetScope === "ALL" || !ann.targetScope
                        ? "Toàn thể Cán bộ Nhân viên Công ty"
                        : `Phòng: ${(ann.targetDepts || []).join(", ")}`}
                    </strong>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase font-bold text-slate-400">{ann.issuerRole}</div>
                    <div className="font-extrabold text-slate-900 dark:text-white text-xs mt-0.5">
                      ✍️ {ann.issuerName}
                    </div>
                  </div>
                </div>

                {/* Danh sách Tệp văn bản PDF / Ảnh đính kèm */}
                {Array.isArray(ann.attachments) && ann.attachments.length > 0 && (
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                    <div className="font-bold text-slate-700 dark:text-slate-300 text-[11px]">
                      📎 Tệp Quyết định / Văn bản gốc đính kèm ({ann.attachments.length}):
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {ann.attachments.map((att: any, idx: number) => (
                        <div
                          key={idx}
                          className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="w-4 h-4 text-rose-600 shrink-0" />
                            <span className="font-bold truncate text-[11px]">{att.name}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => setPreviewDoc({ url: att.url, name: att.name, type: att.type })}
                              className="px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold text-[10px] cursor-pointer"
                            >
                              👁️ Xem trực tiếp
                            </button>
                            <a
                              href={att.url}
                              download={att.name}
                              className="p-1 text-slate-500 hover:text-indigo-600"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Thanh Hành Động Nhanh: Xác nhận đã đọc + Giao việc triển khai + Nhắc đọc */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/60">
                <div className="flex items-center gap-2 flex-wrap">
                  {!iHaveAcked ? (
                    <button
                      type="button"
                      onClick={() => handleAcknowledgeAnnouncement(ann)}
                      className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs shadow-sm cursor-pointer"
                    >
                      ✍️ Xác nhận: Tôi đã đọc &amp; Nắm rõ văn bản này
                    </button>
                  ) : (
                    <span className="px-3 py-1.5 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-bold text-xs border border-emerald-300 dark:border-emerald-800">
                      ✅ Bạn đã ký xác nhận đọc văn bản này
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => handleCreateTaskFromAnnouncement(ann)}
                    className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs cursor-pointer"
                  >
                    ⚡ Giao việc triển khai từ Quyết định này
                  </button>
                </div>

                {unreadList.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleRemindUnreadAnnouncement(ann)}
                    className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs cursor-pointer"
                  >
                    🔔 Nhắc {unreadList.length} nhân sự chưa xác nhận đọc qua Chat
                  </button>
                )}
              </div>

              {/* Bảng Giám Sát Đã Đọc vs Chưa Đọc (Read Receipt Audit Trail) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/60 space-y-2">
                  <div className="font-bold text-emerald-800 dark:text-emerald-300 text-xs flex items-center justify-between">
                    <span>✅ Đã xác nhận đọc ({ackedList.length} người)</span>
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                    {(ann.acknowledgedBy || []).map((ack: any, i: number) => (
                      <div
                        key={i}
                        className="flex items-center justify-between px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-emerald-100 dark:border-slate-800 text-[11px]"
                      >
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          ✓ {ack.name} <span className="text-slate-400 font-normal">({ack.dept || "TBR"})</span>
                        </span>
                        <span className="font-mono text-[10px] text-slate-400">{ack.time}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 space-y-2">
                  <div className="font-bold text-amber-800 dark:text-amber-300 text-xs flex items-center justify-between">
                    <span>⏳ Chưa xác nhận đọc ({unreadList.length} người)</span>
                  </div>
                  {unreadList.length === 0 ? (
                    <p className="text-[11px] text-emerald-600 font-semibold">
                      Tất cả nhân sự thuộc phạm vi đều đã xác nhận đọc đầy đủ!
                    </p>
                  ) : (
                    <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                      {unreadList.map((u, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-amber-100 dark:border-slate-800 text-[11px]"
                        >
                          <span className="font-semibold text-slate-700 dark:text-slate-300">{u.name}</span>
                          <span className="text-[10px] text-slate-400">{u.dept}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Thảo luận / Hỏi đáp làm rõ Văn bản */}
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-2.5">
                <div className="font-bold text-slate-800 dark:text-slate-200 text-xs">
                  💬 Ý kiến phản hồi / Hỏi đáp thực thi ({(ann.comments || []).length})
                </div>
                {Array.isArray(ann.comments) && ann.comments.length > 0 && (
                  <div className="max-h-36 overflow-y-auto space-y-1.5">
                    {ann.comments.map((c: any, idx: number) => (
                      <div
                        key={idx}
                        className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                      >
                        <div className="flex items-center justify-between text-[10px]">
                          <strong className="text-indigo-600 dark:text-indigo-400">
                            {c.author} ({c.dept})
                          </strong>
                          <span className="text-slate-400 font-mono">{c.time}</span>
                        </div>
                        <p className="text-xs text-slate-800 dark:text-slate-200 mt-0.5">{c.text}</p>
                      </div>
                    ))}
                  </div>
                )}
                <form onSubmit={handleAddAnnouncementComment} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={announcementCommentText}
                    onChange={(e) => setAnnouncementCommentText(e.target.value)}
                    placeholder="Gửi câu hỏi làm rõ hoặc báo cáo triển khai văn bản này..."
                    className="flex-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                  />
                  <button
                    type="submit"
                    className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer"
                  >
                    Gửi phản hồi
                  </button>
                </form>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ==================== UNIVERSAL DOCUMENT & IMAGE PREVIEW LIGHTBOX ==================== */}
      {(previewDoc || previewImage) && (() => {
        const activeUrl = previewDoc?.url || previewImage!;
        const viewerUrl = previewBlobUrl || activeUrl;
        const activeName = previewDoc?.name || "Tài liệu đính kèm";
        const isPdf =
          previewDoc?.type?.includes("pdf") ||
          activeName.toLowerCase().endsWith(".pdf") ||
          activeUrl.toLowerCase().includes("application/pdf") ||
          activeUrl.toLowerCase().includes(".pdf");
        const isImg =
          previewDoc?.type?.startsWith("image/") ||
          /\.(png|jpe?g|webp|gif)$/i.test(activeName) ||
          activeUrl.startsWith("data:image/") ||
          (!previewDoc && previewImage);

        const handleClose = () => {
          setPreviewDoc(null);
          setPreviewImage(null);
        };

        return (
          <div
            style={{ zIndex: 300 }}
            className="fixed inset-0 z-[300] bg-black/85 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in"
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
                  <a
                    href={viewerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs flex items-center gap-1 font-semibold cursor-pointer"
                    title="Mở tài liệu trong tab mới"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Mở tab mới</span>
                  </a>

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
                    title="Đóng trình xem tài liệu (Esc)"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Viewer Body */}
              <div className="flex-1 p-2 sm:p-4 overflow-auto flex items-center justify-center bg-slate-950/60 min-h-[55vh]">
                {isPdf ? (
                  <iframe
                    src={viewerUrl}
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
                      Tệp tin đã được số hóa và lưu trữ an toàn trên máy chủ TBR Portal.
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

      {(() => {
        const taskComments = Array.isArray(task.logs) ? task.logs.filter((l: any) => l?.type === "comment") : [];
        if (taskComments.length === 0) return null;
        const lastComment = taskComments[taskComments.length - 1];
        const isDir = lastComment?.role === "directive" || /^\[Chỉ đạo/i.test(String(lastComment?.text || ""));
        return (
          <div
            onClick={() => onEdit(task)}
            className={`rounded-lg p-2 text-[11px] line-clamp-2 cursor-pointer border transition-colors ${
              isDir
                ? "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 hover:bg-amber-100/70"
                : "bg-indigo-50/70 dark:bg-indigo-950/30 border-indigo-200/60 dark:border-indigo-800/50 text-indigo-900 dark:text-indigo-200 hover:bg-indigo-100/60"
            }`}
          >
            <strong className={isDir ? "text-amber-800 dark:text-amber-300" : "text-indigo-700 dark:text-indigo-300"}>
              {isDir ? `👑 Chỉ đạo (${lastComment.author}):` : `💬 ${lastComment.author}:`}
            </strong>{" "}
            {lastComment.text}
            {taskComments.length > 1 && (
              <span className="ml-1 text-[9px] font-bold opacity-75">
                (+{taskComments.length - 1} trao đổi)
              </span>
            )}
          </div>
        );
      })()}

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
        <span className="text-[10px] font-mono">{task.deadline ? formatDayVN(task.deadline, true) : ""}</span>
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
  if (s === "CONVERTED") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-300 dark:border-teal-800">
        ✓ Đã chuyển PO / Mua hàng
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
  if (s === "REJECTED" || s === "CANCELLED") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
        {s === "REJECTED" ? "Đã từ chối" : "Đã hủy"}
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
      {status}
    </span>
  );
};

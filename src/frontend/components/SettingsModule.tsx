"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import * as XLSX from "xlsx";
import {
  Settings,
  Users,
  Key,
  Shield,
  FileText,
  Plus,
  CheckCircle2,
  Lock,
  UserCheck,
  UserX,
  Search,
  KeyRound,
  Edit3,
  Trash2,
  AlertCircle,
  X,
  RefreshCw,
  RotateCcw,
  Building2,
  MessagesSquare,
  ShieldAlert,
  Check,
  Eye,
  EyeOff,
  Link2,
  UserPlus,
  Sparkles,
  ExternalLink,
  Briefcase,
  TrendingUp,
  FlaskConical,
  ShoppingCart,
  Boxes,
  Calculator,
  Award,
  ChevronRight,
  Phone,
  Mail,
  BadgeCheck,
  ShieldCheck,
  Sliders,
  CheckSquare,
  Square,
  Layers,
  Upload,
  Download,
  FileSpreadsheet,
  Bell,
  Volume2,
  VolumeX,
  Save,
  ToggleLeft,
  ToggleRight,
  Package,
  Scale,
  Smartphone
} from "lucide-react";
import { formatDate } from "@/backend/services/utils";
import { FactoryAccessSection, FactoryFeatureGroups } from "@/frontend/factory/settings/FactoryAccessSection";
import { FACTORY_NOTICE_EVENTS, TECHNICAL_MATRIX_ROLES } from "@/factory/noticeMatrix";
import { PERMISSION_GROUPS, ROLE_PRESETS, DEPARTMENT_MODULES, DepartmentModule, resolveRolePreset, getDefaultDepartmentPermissions, getEffectivePermissions, hasPermission, inferSystemRoleFromPosition } from "@/backend/services/permissions";
import { useNotification, NotificationMatrixEvent } from "@/frontend/contexts/NotificationContext";
import { PaymentMethodsSettings } from "@/frontend/components/PaymentMethodsSettings";

const ROLE_LABELS: Record<string, { label: string; color: string; desc: string }> = {
  admin: { label: "Giám Đốc (Director)", color: "bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800", desc: "Toàn quyền quản trị, phê duyệt và giám sát toàn công ty" },
  Director: { label: "Giám Đốc (Director)", color: "bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800", desc: "Toàn quyền quản trị, phê duyệt và giám sát toàn công ty" },
  sales_head: { label: "Trưởng / Phó Phòng Kinh Doanh", color: "bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800", desc: "Quản lý mục tiêu, đơn hàng, duyệt báo giá, chiết khấu & hợp đồng" },
  "Head of Sales": { label: "Trưởng / Phó Phòng Kinh Doanh", color: "bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800", desc: "Quản lý mục tiêu, đơn hàng, duyệt báo giá, chiết khấu & hợp đồng" },
  sales_rep: { label: "Chuyên Viên Kinh Doanh / PM / Admin KD", color: "bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800", desc: "Tạo báo giá, đơn hàng, theo dõi khách hàng và kế hoạch cá nhân" },
  "Sales Specialist": { label: "Chuyên Viên Kinh Doanh", color: "bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800", desc: "Tạo báo giá, đơn hàng, theo dõi khách hàng và kế hoạch cá nhân" },
  app_head: { label: "Trưởng Phòng Kỹ Thuật & Ứng Dụng", color: "bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800", desc: "Phân công kỹ sư (assign), ký duyệt nghiệm thu & tài liệu thầu (approve)" },
  "Head of Application": { label: "Trưởng Phòng Kỹ Thuật & Ứng Dụng", color: "bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800", desc: "Phân công kỹ sư (assign), ký duyệt nghiệm thu & tài liệu thầu (approve)" },
  app_rep: { label: "Kỹ Sư Ứng Dụng / Kỹ Sư Dịch Vụ", color: "bg-violet-100 dark:bg-violet-950/60 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-800", desc: "Thực hiện test mẫu, lắp đặt/bảo trì máy & hỗ trợ kỹ thuật tại bệnh viện" },
  "Application Specialist": { label: "Kỹ Sư Ứng Dụng / Kỹ Sư Dịch Vụ", color: "bg-violet-100 dark:bg-violet-950/60 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-800", desc: "Thực hiện test mẫu, lắp đặt/bảo trì máy & hỗ trợ kỹ thuật tại bệnh viện" },
  warehouse_lead: { label: "Trưởng Bộ Phận Kho Vận", color: "bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700", desc: "Quản lý toàn diện kho, duyệt phiếu xuất/nhập, xem giá vốn lô & tạo PR mua bù" },
  "Warehouse Manager": { label: "Trưởng Bộ Phận Kho Vận", color: "bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700", desc: "Quản lý toàn diện kho, duyệt phiếu xuất/nhập, xem giá vốn lô & tạo PR mua bù" },
  warehouse: { label: "Thủ Kho / NV Giao Nhận Chuỗi Lạnh", color: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800", desc: "Tạo phiếu xuất/nhập kho, quản lý số Lô & HSD, kiểm soát chuỗi lạnh & giao hàng" },
  "Warehouse Specialist": { label: "Thủ Kho / NV Giao Nhận Chuỗi Lạnh", color: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800", desc: "Tạo phiếu xuất/nhập kho, quản lý số Lô & HSD, kiểm soát chuỗi lạnh & giao hàng" },
  procurement_lead: { label: "Trưởng Bộ Phận Cung Ứng", color: "bg-cyan-100 dark:bg-cyan-950/60 text-cyan-800 dark:text-cyan-300 border-cyan-300 dark:border-cyan-700", desc: "Quản lý nhà cung cấp, thương thảo hợp đồng & phê duyệt đơn đặt hàng PO (approve_po)" },
  "Procurement Lead": { label: "Trưởng Bộ Phận Cung Ứng", color: "bg-cyan-100 dark:bg-cyan-950/60 text-cyan-800 dark:text-cyan-300 border-cyan-300 dark:border-cyan-700", desc: "Quản lý nhà cung cấp, thương thảo hợp đồng & phê duyệt đơn đặt hàng PO (approve_po)" },
  procurement_specialist: { label: "Chuyên Viên Mua Hàng & Cung Ứng", color: "bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800", desc: "Lập đề xuất PR & dự thảo đơn PO, theo dõi tiến độ hàng về & hồ sơ CO/CQ" },
  "Procurement Specialist": { label: "Chuyên Viên Mua Hàng & Cung Ứng", color: "bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800", desc: "Lập đề xuất PR & dự thảo đơn PO, theo dõi tiến độ hàng về & hồ sơ CO/CQ" },
  procurement: { label: "Chuyên Viên Mua Hàng & Cung Ứng", color: "bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800", desc: "Lập đề xuất PR & dự thảo đơn PO, theo dõi tiến độ hàng về & hồ sơ CO/CQ" },
  accountant_head: { label: "Kế Toán Trưởng (Chief Accountant)", color: "bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-700", desc: "Phê duyệt công nợ vượt hạn mức, duyệt ngân sách PO, chốt kỳ kế toán & báo cáo tài chính" },
  "Chief Accountant": { label: "Kế Toán Trưởng (Chief Accountant)", color: "bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-700", desc: "Phê duyệt công nợ vượt hạn mức, duyệt ngân sách PO, chốt kỳ kế toán & báo cáo tài chính" },
  accountant: { label: "Chuyên Viên Kế Toán Kho & Công Nợ", color: "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800", desc: "Đối soát tồn kho FIFO, phát hành hóa đơn VAT, theo dõi & nhắc thu hồi công nợ" },
  "Receivable & Inventory Accountant": { label: "Chuyên Viên Kế Toán Kho & Công Nợ", color: "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800", desc: "Đối soát tồn kho FIFO, phát hành hóa đơn VAT, theo dõi & nhắc thu hồi công nợ" },
  qa_qc_lead: { label: "Trưởng Bộ Phận QA/QC", color: "bg-teal-100 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 border-teal-300 dark:border-teal-700", desc: "Phê duyệt kết quả thẩm định lô, ký lệnh thu hồi Lô khẩn cấp & giải phóng hàng cách ly" },
  "QA/QC Manager": { label: "Trưởng Bộ Phận QA/QC", color: "bg-teal-100 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 border-teal-300 dark:border-teal-700", desc: "Phê duyệt kết quả thẩm định lô, ký lệnh thu hồi Lô khẩn cấp & giải phóng hàng cách ly" },
  qa_qc: { label: "Chuyên Viên QA/QC & ISO 13485", color: "bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-800", desc: "Kiểm soát COA, lập biên bản kiểm định chất lượng lô, ghi nhận sự cố chất lượng" },
  "QA/QC Specialist": { label: "Chuyên Viên QA/QC & ISO 13485", color: "bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-800", desc: "Kiểm soát COA, lập biên bản kiểm định chất lượng lô, ghi nhận sự cố chất lượng" },
  legal_head: { label: "Trưởng Bộ Phận Pháp Chế", color: "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700", desc: "Thẩm định & phê duyệt pháp lý hợp đồng, kiểm soát hồ sơ lưu hành IVD & đấu thầu" },
  legal: { label: "Chuyên Viên Pháp Chế & Tuân Thủ", color: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800", desc: "Soạn thảo hợp đồng, chuẩn bị hồ sơ lưu hành IVD và kiểm soát tuân thủ y tế" },
  "Legal Specialist": { label: "Chuyên Viên Pháp Chế", color: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800", desc: "Soạn thảo hợp đồng, thẩm định pháp lý và kiểm soát rủi ro" },
  "Chuyên Viên Pháp Chế": { label: "Chuyên Viên Pháp Chế", color: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800", desc: "Soạn thảo hợp đồng, thẩm định pháp lý và kiểm soát rủi ro" },
  rd_head: { label: "Trưởng Phòng Nghiên Cứu R&D", color: "bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border-sky-300 dark:border-sky-700", desc: "Quản lý đề tài R&D, hồ sơ thiết kế DHF, phê duyệt công thức & chuyển giao công nghệ sản xuất" },
  rd_staff: { label: "Chuyên Viên Nghiên Cứu R&D", color: "bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-800", desc: "Thực hiện thí nghiệm sinh học phân tử, ghi nhật ký ELN, pha chế mẫu thử & thẩm định hiệu năng" },
  kit_head: { label: "Trưởng Phòng / Quản Đốc Sản Xuất Kit", color: "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700", desc: "Quản lý định mức BOM, phát hành lệnh sản xuất Kit, phê duyệt hồ sơ lô eBR & chuyển kho thành phẩm" },
  kit_staff: { label: "Kỹ Thuật Viên Sản Xuất Kit (GMP)", color: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800", desc: "Pha chế MasterMix, chiết rót bán thành phẩm, đóng gói Kit hoàn chỉnh & ghi nhận hồ sơ lô eBR" },
  oligo_head: { label: "Trưởng Phòng Tổng Hợp Oligo", color: "bg-violet-100 dark:bg-violet-950/60 text-violet-800 dark:text-violet-300 border-violet-300 dark:border-violet-700", desc: "Tiếp nhận đơn Oligo, lập mẻ tổng hợp cột CPG, phê duyệt QC OD/HPLC/PAGE & xuất giao hàng" },
  oligo_staff: { label: "Kỹ Thuật Viên Tổng Hợp Oligo & HPLC", color: "bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-800", desc: "Vận hành máy tổng hợp CPG, cắt khử bảo vệ, tinh sạch HPLC/PAGE/OPC, đo OD & chia lọ" },
  device_head: { label: "Trưởng Phòng Kỹ Thuật – Thiết Bị", color: "bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700", desc: "Quản lý dòng máy xét nghiệm, hồ sơ DMR, phát hành lệnh lắp ráp DHR, nghiệm thu FQC & bảo hành RMA" },
  device_staff: { label: "Kỹ Sư Cơ Điện Tử / Lắp Ráp DHR & FSE", color: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800", desc: "Lắp ráp cơ khí CNC, mạch điện tử PCB, nạp Firmware, chạy già hóa Burn-in & bảo hành thiết bị" }
};

export const DEPARTMENT_POSITIONS: Record<string, {
  name: string;
  code: string;
  desc: string;
  badgeColor: string;
  borderTheme: string;
  positions: { title: string; defaultRole: string; level: "Director" | "Manager" | "Specialist" | "Staff"; desc: string }[];
}> = {
  "Ban Giám Đốc": {
    name: "Ban Giám Đốc (Board of Directors)",
    code: "BOD",
    desc: "Hoạch định chiến lược kinh doanh, quản trị rủi ro và chỉ đạo điều hành toàn bộ bộ máy công ty ABT",
    badgeColor: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/50 dark:text-orange-400 dark:border-orange-800",
    borderTheme: "border-orange-500",
    positions: [
      { title: "Tổng Giám Đốc / Giám Đốc Điều Hành (CEO)", defaultRole: "admin", level: "Director", desc: "Chịu trách nhiệm tối cao về kết quả kinh doanh, quan hệ đối tác chiến lược và phê duyệt ngân sách" },
      { title: "Phó Giám Đốc", defaultRole: "admin", level: "Director", desc: "Quản trị vận hành chuỗi cung ứng, hạ tầng kỹ thuật và điều phối hoạt động liên phòng ban" },
      { title: "Trợ Lý Ban Giám Đốc (Executive Assistant)", defaultRole: "admin", level: "Specialist", desc: "Tổng hợp báo cáo quản trị, thư ký các cuộc họp điều hành và theo dõi tiến độ công việc trọng tâm" }
    ]
  },
  "Kinh Doanh": {
    name: "Phòng Kinh Doanh & Tiếp Thị (Sales & Marketing)",
    code: "SALES",
    desc: "Phát triển thị trường xét nghiệm y tế, quản trị kênh bệnh viện, phòng khám, CDC và chỉ tiêu doanh số",
    badgeColor: "bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-400 dark:border-indigo-800",
    borderTheme: "border-indigo-500",
    positions: [
      { title: "Trưởng Phòng Kinh Doanh (Head of Sales)", defaultRole: "sales_head", level: "Manager", desc: "Quản lý đội ngũ kinh doanh, phê duyệt báo giá thương mại, hợp đồng và giám sát KPI tuần/tháng" },
      { title: "Phó Phòng Kinh Doanh", defaultRole: "sales_head", level: "Manager", desc: "Phụ trách nhóm khách hàng bệnh viện tuyến đầu, cố vấn giải pháp kỹ thuật thương mại cho NVKD" },
      { title: "Quản Lý Sản Phẩm (Product Manager - PM)", defaultRole: "sales_rep", level: "Specialist", desc: "Chuyên sâu dải sản phẩm HPV, vi sinh, sinh học phân tử; đào tạo tính năng sản phẩm cho đội ngũ sales" },
      { title: "Chuyên Viên Kinh Doanh (Senior/Junior)", defaultRole: "sales_rep", level: "Staff", desc: "Tiếp cận khách hàng mới, tư vấn kit chẩn đoán qPCR, gửi báo giá và theo dõi đơn hàng định kỳ" },
      { title: "Admin Kinh Doanh (Sales Admin)", defaultRole: "sales_rep", level: "Staff", desc: "Tạo đơn hàng trên hệ thống, theo dõi tiến độ giao hàng, xuất hóa đơn VAT và đối chiếu công nợ" }
    ]
  },
  "Kỹ Thuật & Ứng Dụng": {
    name: "Phòng Kỹ Thuật & Ứng Dụng Lâm Sàng (Application / App)",
    code: "APP",
    desc: "Chạy thử nghiệm mẫu, kiểm định sinh phẩm, demo máy xét nghiệm PCR và hỗ trợ kỹ thuật tại phòng lab bệnh viện",
    badgeColor: "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-400 dark:border-purple-800",
    borderTheme: "border-purple-500",
    positions: [
      { title: "Trưởng Phòng Kỹ Thuật & Ứng Dụng", defaultRole: "app_head", level: "Manager", desc: "Chỉ đạo demo lâm sàng, phân công kỹ sư (assign) và phê duyệt nghiệm thu & tài liệu kỹ thuật thầu (approve)" },
      { title: "Kỹ Sư Ứng Dụng PCR / Sinh Học Phân Tử", defaultRole: "app_rep", level: "Specialist", desc: "Tối ưu hóa protocol chạy máy Real-time PCR, thẩm định độ nhạy/độ đặc hiệu và hỗ trợ kỹ thuật khách hàng" },
      { title: "Kỹ Sư Dịch Vụ Thiết Bị (Service Engineer)", defaultRole: "app_rep", level: "Specialist", desc: "Lắp đặt, hiệu chuẩn (calibration), bảo dưỡng định kỳ và sửa chữa máy Real-time PCR, máy tách chiết tự động" },
      { title: "Chuyên Viên Quản Lý Hồ Sơ Thầu Kỹ Thuật", defaultRole: "app_rep", level: "Specialist", desc: "Chuẩn bị đầy đủ hồ sơ pháp lý & kỹ thuật thầu: COA, ISO 13485, CFS, kết quả thử nghiệm lâm sàng" }
    ]
  },
  "Mua Hàng & Cung Ứng": {
    name: "Phòng Mua Hàng & Cung Ứng (Procurement)",
    code: "PROC",
    desc: "Đàm phán nhà sản xuất nước ngoài, nhập khẩu ủy thác sinh phẩm IVD, quản lý PR/PO và chuỗi cung ứng",
    badgeColor: "bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-950/50 dark:text-cyan-400 dark:border-cyan-800",
    borderTheme: "border-cyan-500",
    positions: [
      { title: "Trưởng Bộ Phận Cung Ứng", defaultRole: "procurement_lead", level: "Manager", desc: "Đàm phán hợp đồng phân phối độc quyền, giá nhập FOB/CIF, phê duyệt đơn đặt hàng PO (approve_po)" },
      { title: "Chuyên Viên Mua Hàng Quốc Tế / Trong Nước", defaultRole: "procurement_specialist", level: "Specialist", desc: "Lập đề xuất PR & dự thảo đơn PO, thực hiện thủ tục hải quan, kiểm soát giấy phép lưu hành IVD và CO/CQ" },
      { title: "Chuyên Viên Mua Hàng Quốc Tế (Import Specialist)", defaultRole: "procurement_specialist", level: "Specialist", desc: "Thực hiện thủ tục hải quan, mở L/C, kiểm soát giấy phép lưu hành IVD và chứng chỉ CO/CQ sinh phẩm" },
      { title: "Chuyên Viên Mua Hàng Trong Nước", defaultRole: "procurement_specialist", level: "Staff", desc: "Tìm kiếm và mua sắm vật tư tiêu hao, hóa chất phụ trợ, thiết bị văn phòng và dịch vụ logistics nội địa" },
      { title: "Chuyên Viên Điều Phối Chuỗi Cung Ứng", defaultRole: "procurement_specialist", level: "Specialist", desc: "Hoạch định nhu cầu dự trữ tồn kho an toàn, theo dõi tiến độ giao hàng và giảm thiểu rủi ro đứt gãy" }
    ]
  },
  "Kho Vận": {
    name: "Bộ Phận Kho Vận & Chuỗi Lạnh (Warehouse & Logistics)",
    code: "WH",
    desc: "Bảo quản âm sâu sinh phẩm (-20°C, 2-8°C), kiểm soát hạn dùng FEFO và điều vận giao nhận y tế",
    badgeColor: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800",
    borderTheme: "border-amber-500",
    positions: [
      { title: "Trưởng Bộ Phận Kho Vận", defaultRole: "warehouse_lead", level: "Manager", desc: "Chịu trách nhiệm tiêu chuẩn GSP, ký duyệt phiếu xuất/nhập kho, xem giá vốn lô nhập và tạo PR mua bù tồn kho" },
      { title: "Thủ Kho Vật Tư Sinh Phẩm & Hóa Chất", defaultRole: "warehouse", level: "Specialist", desc: "Thực hiện nhập xuất kho vật lý, lập phiếu xuất kho (PXK), ghi chép thẻ kho điện tử và đối soát tồn kho" },
      { title: "Nhân Viên Giao Nhận & Vận Chuyển Lạnh", defaultRole: "warehouse", level: "Staff", desc: "Đóng gói thùng xốp đá gel chuẩn y tế, kiểm soát thiết bị nhiệt độ và bàn giao tận khoa xét nghiệm bệnh viện" },
      { title: "Nhân Viên Quản Lý Chuỗi Lạnh & FEFO", defaultRole: "warehouse", level: "Staff", desc: "Theo dõi nhật ký nhiệt độ tủ âm sâu 24/7, kích hoạt cảnh báo cận date FEFO (<90 ngày) để đẩy bán" }
    ]
  },
  "Kế Toán": {
    name: "Phòng Tài Chính - Kế Toán (Finance & Accounting)",
    code: "ACC",
    desc: "Kiểm soát sổ sách kế toán, phát hành hóa đơn VAT điện tử, đối soát công nợ bệnh viện và báo cáo tài chính",
    badgeColor: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-400 dark:border-rose-800",
    borderTheme: "border-rose-500",
    positions: [
      { title: "Kế Toán Trưởng", defaultRole: "accountant_head", level: "Manager", desc: "Tổ chức công tác tài chính kế toán, phê duyệt hạn mức tín dụng/công nợ, duyệt ngân sách PO và chốt kỳ kế toán" },
      { title: "Chuyên Viên Kế Toán Kho & Công Nợ", defaultRole: "accountant", level: "Specialist", desc: "Đối soát giá trị kho, định giá tồn kho theo FIFO, theo dõi tuổi nợ khách hàng và nhắc nợ theo kỳ hạn thanh toán" },
      { title: "Kế Toán Tổng Hợp", defaultRole: "accountant", level: "Specialist", desc: "Kiểm tra định khoản, đối chiếu sổ phụ ngân hàng, tổng hợp doanh thu - chi phí và hạch toán sổ cái" },
      { title: "Kế Toán Bán Hàng & Hóa Đơn VAT", defaultRole: "accountant", level: "Staff", desc: "Xuất hóa đơn điện tử GTGT cho đơn hàng bệnh viện, đính kèm file PDF hóa đơn đối soát tức thì" },
      { title: "Thủ Quỹ (Cashier)", defaultRole: "accountant", level: "Staff", desc: "Quản lý thu chi tiền mặt, thanh toán tạm ứng công tác phí cho chuyên viên demo và kinh doanh" }
    ]
  },
  "Pháp Chế": {
    name: "Bộ Phận Pháp Chế & Tuân Thủ (Legal & Compliance)",
    code: "LEGAL",
    desc: "Tư vấn pháp lý doanh nghiệp, thẩm định hợp đồng mua bán, đại lý phân phối và tuân thủ quy chế ngành y tế",
    badgeColor: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800",
    borderTheme: "border-emerald-500",
    positions: [
      { title: "Trưởng Bộ Phận Pháp Chế", defaultRole: "legal_head", level: "Manager", desc: "Chỉ đạo công tác pháp lý công ty, phê duyệt hợp đồng kinh tế (legal.approve) và xử lý tranh chấp pháp lý" },
      { title: "Chuyên Viên Pháp Chế & Tuân Thủ", defaultRole: "legal", level: "Specialist", desc: "Soạn thảo hợp đồng, kiểm soát hồ sơ pháp lý lưu hành sản phẩm IVD, thủ tục công bố tiêu chuẩn chất lượng" },
      { title: "Chuyên Viên Pháp Lý & Tuân Thủ (Compliance)", defaultRole: "legal", level: "Specialist", desc: "Kiểm soát tuân thủ quy định y tế, thẩm định tính hợp lệ hồ sơ dự thầu và quản lý giấy phép lưu hành" }
    ]
  },
  "Marketing": {
    name: "Bộ Phận Marketing & Tiếp Thị (Marketing)",
    code: "MKT",
    desc: "Hoạch định chiến lược thương hiệu, tổ chức hội thảo khoa học y khoa, quảng bá hệ thống sinh phẩm chẩn đoán",
    badgeColor: "bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-950/50 dark:text-pink-400 dark:border-pink-800",
    borderTheme: "border-pink-500",
    positions: [
      { title: "Trưởng Bộ Phận Marketing", defaultRole: "sales_head", level: "Manager", desc: "Hoạch định chiến lược thương hiệu, tổ chức hội nghị khoa học, quảng bá dải sản phẩm qPCR & IVD" },
      { title: "Chuyên viên Marketing", defaultRole: "sales_rep", level: "Specialist", desc: "Quản trị nội dung số, thiết kế brochure giải pháp xét nghiệm, tài liệu hội thảo và truyền thông số" }
    ]
  },
  "QA / QC": {
    name: "Phòng Quản Lý Chất Lượng & ISO 13485 (QA / QC)",
    code: "QAQC",
    desc: "Kiểm soát hồ sơ COA, kiểm nghiệm đạt chuẩn sinh phẩm, giám sát CAPA và phát lệnh thu hồi Lô khẩn cấp theo ISO 13485",
    badgeColor: "bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-950/50 dark:text-teal-400 dark:border-teal-800",
    borderTheme: "border-teal-500",
    positions: [
      { title: "Trưởng Bộ Phận QA/QC (QA/QC Manager)", defaultRole: "qa_qc_lead", level: "Manager", desc: "Chỉ đạo hệ thống quản lý chất lượng ISO 13485, phê duyệt thẩm định lô và lệnh cách ly / thu hồi khẩn cấp" },
      { title: "Chuyên Viên Quản Lý Chất Lượng & ISO 13485", defaultRole: "qa_qc", level: "Specialist", desc: "Kiểm soát hồ sơ COA, kiểm nghiệm đạt chuẩn sinh phẩm, giám sát CAPA và ghi nhận sự cố chất lượng" },
      { title: "Chuyên Viên Đảm Bảo Chất Lượng (QA Specialist)", defaultRole: "qa_qc", level: "Specialist", desc: "Xây dựng quy trình SOP, hồ sơ kiểm soát thay đổi, giám sát tuân thủ quy chuẩn nhà xưởng và kho lạnh" }
    ]
  },
  "Hành Chính Nhân Sự": {
    name: "Phòng Hành Chính - Nhân Sự (HR & Administration)",
    code: "HR",
    desc: "Hoạch định nguồn nhân lực, tuyển dụng chuyên ngành công nghệ sinh học/y tế, chính sách lương thưởng KPI",
    badgeColor: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800",
    borderTheme: "border-emerald-500",
    positions: [
      { title: "Trưởng Phòng Hành Chính Nhân Sự", defaultRole: "admin", level: "Manager", desc: "Xây dựng sơ đồ tổ chức, mô tả công việc (JD), thang bảng lương thưởng KPI và văn hóa doanh nghiệp" },
      { title: "Chuyên Viên Tuyển Dụng & Đào Tạo", defaultRole: "admin", level: "Specialist", desc: "Tìm kiếm ứng viên ngành sinh học/xét nghiệm y tế, tổ chức chương trình đào tạo hội nhập cho nhân viên mới" },
      { title: "Chuyên Viên C&B & Pháp Chế Lao Động", defaultRole: "admin", level: "Specialist", desc: "Soạn thảo hợp đồng lao động, chấm công, tính lương thưởng KPI, bảo hiểm xã hội và tuân thủ pháp luật" }
    ]
  },
  "Nghiên Cứu R&D": {
    name: "Phòng Nghiên Cứu & Phát Triển (R&D - P-RD)",
    code: "P-RD",
    desc: "Nghiên cứu phát triển bộ Kit IVD chẩn đoán phân tử, thiết kế mồi/probe, thẩm định độ nhạy/độ đặc hiệu, theo dõi độ ổn định & lập hồ sơ DHF",
    badgeColor: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-400 dark:border-sky-800",
    borderTheme: "border-sky-500",
    positions: [
      { title: "Trưởng Phòng R&D", defaultRole: "rd_head", level: "Manager", desc: "Chỉ đạo đề tài nghiên cứu, phê duyệt hồ sơ thiết kế DHF, công thức gốc và chuyển giao công nghệ sang Sản xuất Kit" },
      { title: "Chuyên Viên R&D Sinh Học Phân Tử", defaultRole: "rd_staff", level: "Specialist", desc: "Thiết kế mồi/probe qPCR, thực hiện thí nghiệm tối ưu hóa phản ứng, ghi nhật ký điện tử ELN và đánh giá độ ổn định" },
      { title: "Kỹ Sư R&D Thiết Bị & Phần Mềm Y Sinh", defaultRole: "rd_staff", level: "Specialist", desc: "Nghiên cứu nguyên mẫu máy xét nghiệm tự động, thuật toán phân tích tín hiệu huỳnh quang và hồ sơ kỹ thuật" }
    ]
  },
  "Sản Xuất Kit": {
    name: "Phòng Sản Xuất Kit Chẩn Đoán (Kit Manufacturing - P-KIT)",
    code: "P-KIT",
    desc: "Sản xuất bộ Kit IVD & hóa chất tách chiết theo chuẩn ISO 13485 / GMP: quản lý định mức BOM, pha chế MasterMix, chia chuẩn .D.IC và hồ sơ lô điện tử eBR",
    badgeColor: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800",
    borderTheme: "border-emerald-500",
    positions: [
      { title: "Trưởng Phòng / Quản Đốc Sản Xuất Kit", defaultRole: "kit_head", level: "Manager", desc: "Quản lý định mức BOM, phát hành lệnh sản xuất Kit (Thường / Chia sẵn .D.IC / Demo), ký duyệt hồ sơ lô eBR" },
      { title: "Tổ Trưởng Pha Chế & Chiết Rót Phòng Sạch", defaultRole: "kit_staff", level: "Specialist", desc: "Giám sát điều kiện phòng sạch, cân đong pha chế bán thành phẩm, kiểm soát chênh lệch hao hụt và lấy mẫu lưu QC" },
      { title: "Kỹ Thuật Viên Sản Xuất & Đóng Gói Kit GMP", defaultRole: "kit_staff", level: "Staff", desc: "Thực hiện chiết rót, dán nhãn UDI/QR, đóng gói hộp Kit hoàn chỉnh và ghi nhận thông số công đoạn eBR" }
    ]
  },
  "Tổng Hợp Oligo": {
    name: "Phòng Tổng Hợp Oligo & Tinh Sạch (Oligo Synthesis - P-OLIGO)",
    code: "P-OLIGO",
    desc: "Tổng hợp mồi (Primer) và mẫu dò huỳnh quang (Probe) trên hệ thống cột CPG, cắt khử bảo vệ, tinh sạch HPLC/PAGE/OPC và đo kiểm OD",
    badgeColor: "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950/50 dark:text-violet-400 dark:border-violet-800",
    borderTheme: "border-violet-500",
    positions: [
      { title: "Trưởng Phòng Tổng Hợp Oligo", defaultRole: "oligo_head", level: "Manager", desc: "Điều phối đơn hàng Oligo, phê duyệt mẻ tổng hợp cột CPG, thẩm định kết quả OD/HPLC/PAGE và duyệt xuất giao" },
      { title: "Kỹ Thuật Viên Vận Hành Máy Tổng Hợp CPG", defaultRole: "oligo_staff", level: "Specialist", desc: "Khai báo chai hóa chất Amidite/Activator, gán cột CPG vào giàn tổng hợp, theo dõi chu kỳ coupling & trityl" },
      { title: "Kỹ Thuật Viên Tinh Sạch HPLC / PAGE & QC OD", defaultRole: "oligo_staff", level: "Specialist", desc: "Thực hiện cắt khử bảo vệ, tinh sạch sắc ký HPLC/PAGE, đo quang phổ OD260, cô quay chân không & chia lọ" }
    ]
  },
  "Kỹ Thuật – Thiết Bị": {
    name: "Phòng Kỹ Thuật – Công Nghệ Thiết Bị (Device Engineering - P-DEVICE)",
    code: "P-DEVICE",
    desc: "Thiết kế chế tạo máy tách chiết tự động (EZ32), máy lắc nhiệt, đèn đọc quang học; quản lý hồ sơ thiết bị gốc DMR, lắp ráp DHR, chạy già hóa Burn-in & bảo hành RMA",
    badgeColor: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800",
    borderTheme: "border-amber-500",
    positions: [
      { title: "Trưởng Phòng Kỹ Thuật – Thiết Bị", defaultRole: "device_head", level: "Manager", desc: "Quản lý danh mục dòng máy, phê duyệt bản phát hành DMR, lệnh lắp ráp DHR, nghiệm thu FQC và cấp phát máy Demo/RMA" },
      { title: "Kỹ Sư Cơ Điện Tử & Firmware Thiết Bị Y Sinh", defaultRole: "device_staff", level: "Specialist", desc: "Thiết kế bản vẽ gia công CNC, mạch PCB, lập trình Firmware điều khiển nhiệt/từ tính và hiệu chuẩn thiết bị" },
      { title: "Kỹ Thuật Viên Lắp Ráp DHR & Bảo Hành RMA", defaultRole: "device_staff", level: "Staff", desc: "Lắp ráp trạm cơ khí/điện tử, chạy già hóa Burn-in 48h, kiểm tra an toàn điện FQC và sửa chữa bảo hành" }
    ]
  }
};

// Aliases for seamless backward compatibility
DEPARTMENT_POSITIONS["Application"] = DEPARTMENT_POSITIONS["Kỹ Thuật & Ứng Dụng"];
DEPARTMENT_POSITIONS["Cung Ứng"] = DEPARTMENT_POSITIONS["Mua Hàng & Cung Ứng"];
DEPARTMENT_POSITIONS["Pháp chế"] = DEPARTMENT_POSITIONS["Pháp Chế"];
DEPARTMENT_POSITIONS["QA/QC"] = DEPARTMENT_POSITIONS["QA / QC"];

/** Portal department modules grouped by khối in "Phân Quyền Chi Tiết Cá Nhân" (Khối Kỹ thuật – Nhà máy has its own section). */
const PORTAL_BLOCKS: { title: string; keys: string[] }[] = [
  { title: "Khối Kinh Doanh", keys: ["sales.view", "warehouse.view", "application.view", "procurement.view"] },
  { title: "Khối Văn Phòng & Điều Hành", keys: ["legal.view", "chat.view", "zalo.view", "settings.view"] },
];

export const PRIMARY_DEPT_KEYS = [
  "Ban Giám Đốc",
  "Kinh Doanh",
  "Nghiên Cứu R&D",
  "Sản Xuất Kit",
  "Tổng Hợp Oligo",
  "Kỹ Thuật – Thiết Bị",
  "QA / QC",
  "Kỹ Thuật & Ứng Dụng",
  "Mua Hàng & Cung Ứng",
  "Kho Vận",
  "Kế Toán",
  "Pháp Chế",
  "Marketing",
  "Hành Chính Nhân Sự"
];

export const matchDepartment = (dept1?: string, dept2?: string): boolean => {
  if (!dept1 || !dept2) return false;
  const d1 = dept1.toLowerCase().trim();
  const d2 = dept2.toLowerCase().trim();
  if (d1 === d2) return true;

  // Khối Kỹ thuật Nhà máy (kiểm tra chuyên biệt trước để không lẫn với Kỹ Thuật & Ứng Dụng)
  const isRd = (s: string) => s.includes("r&d") || s.includes("nghiên cứu");
  if (isRd(d1) || isRd(d2)) return isRd(d1) && isRd(d2);

  const isKit = (s: string) => s.includes("sản xuất kit") || s.includes("sx kit") || s === "p-kit";
  if (isKit(d1) || isKit(d2)) return isKit(d1) && isKit(d2);

  const isOligo = (s: string) => s.includes("oligo") || s === "p-oligo";
  if (isOligo(d1) || isOligo(d2)) return isOligo(d1) && isOligo(d2);

  const isDevice = (s: string) => s.includes("thiết bị") || s === "p-device";
  if (isDevice(d1) || isDevice(d2)) return isDevice(d1) && isDevice(d2);

  // Application / Kỹ Thuật & Ứng Dụng / App
  const isApp = (s: string) => s.includes("ứng dụng") || s.includes("kỹ thuật") || s.includes("application") || s === "app";
  if (isApp(d1) && isApp(d2)) return true;

  // Procurement / Mua Hàng & Cung Ứng / Cung Ứng
  const isProc = (s: string) => s.includes("mua hàng") || s.includes("cung ứng") || s.includes("procurement") || s.includes("purchasing");
  if (isProc(d1) && isProc(d2)) return true;

  // Warehouse / Kho Vận / Kho & Vận Hành
  const isWh = (s: string) => s.includes("kho");
  if (isWh(d1) && isWh(d2)) return true;

  // Accounting / Kế Toán / Tài Chính
  const isAcc = (s: string) => s.includes("kế toán") || s.includes("tài chính");
  if (isAcc(d1) && isAcc(d2)) return true;

  // Board of Directors / Ban Giám Đốc
  const isBod = (s: string) => s.includes("giám đốc") || s.includes("bod");
  if (isBod(d1) && isBod(d2)) return true;

  // Sales / Kinh Doanh
  const isSales = (s: string) => (s.includes("kinh doanh") || s.includes("sales")) && !s.includes("admin kinh doanh");
  if (isSales(d1) && isSales(d2)) return true;

  // Legal / Pháp Chế
  const isLegal = (s: string) => s.includes("pháp chế") || s.includes("legal");
  if (isLegal(d1) && isLegal(d2)) return true;

  // Marketing / Tiếp thị
  const isMkt = (s: string) => s.includes("marketing") || s.includes("mkt") || s.includes("tiếp thị");
  if (isMkt(d1) && isMkt(d2)) return true;

  // QA / QC / Chất lượng
  const isQa = (s: string) => s.includes("qa") || s.includes("qc") || s.includes("chất lượng") || s.includes("iso");
  if (isQa(d1) && isQa(d2)) return true;

  // HR / Hành chính nhân sự
  const isHr = (s: string) => s.includes("hành chính") || s.includes("nhân sự") || s.includes("hr");
  if (isHr(d1) && isHr(d2)) return true;

  return false;
};

export const getDeptInfo = (deptName?: string) => {
  if (!deptName) return null;
  if (DEPARTMENT_POSITIONS[deptName]) return DEPARTMENT_POSITIONS[deptName];
  const matchedKey = PRIMARY_DEPT_KEYS.find(k => matchDepartment(k, deptName));
  return matchedKey ? DEPARTMENT_POSITIONS[matchedKey] : null;
};

export const getBestPositionMatch = (personPosition: string, allPositions: { title: string }[]): string | null => {
  if (!personPosition || !allPositions || allPositions.length === 0) return null;
  const pNorm = personPosition.toLowerCase().trim();

  // 1. Exact match
  for (const pos of allPositions) {
    if (pos.title.toLowerCase().trim() === pNorm) return pos.title;
  }

  const clean = (s: string) => s.toLowerCase().replace(/[\(\)\/\-]/g, " ").replace(/\s+/g, " ").trim();
  const pClean = clean(personPosition);

  // 2. High-priority distinct keyword rules
  // Admin Kinh Doanh / Sales Admin
  if (pClean.includes("sales admin") || pClean.includes("admin kinh doanh")) {
    const found = allPositions.find(pos => {
      const tc = clean(pos.title);
      return tc.includes("sales admin") || tc.includes("admin kinh doanh");
    });
    if (found) return found.title;
  }

  // Product Manager / PM / Quản lý sản phẩm
  if (pClean.includes("product manager") || pClean.includes("quản lý sản phẩm") || pClean.includes("pm")) {
    const found = allPositions.find(pos => {
      const tc = clean(pos.title);
      return tc.includes("product manager") || tc.includes("quản lý sản phẩm") || tc.includes("pm");
    });
    if (found) return found.title;
  }

  // Kỹ sư ứng dụng / Application
  if (pClean.includes("kỹ sư ứng dụng") || pClean.includes("ứng dụng pcr")) {
    const found = allPositions.find(pos => {
      const tc = clean(pos.title);
      return tc.includes("kỹ sư ứng dụng") || tc.includes("ứng dụng pcr");
    });
    if (found) return found.title;
  }

  // Kế toán kho & công nợ
  if (pClean.includes("kế toán kho") || pClean.includes("công nợ")) {
    const found = allPositions.find(pos => {
      const tc = clean(pos.title);
      return tc.includes("kế toán kho") || tc.includes("công nợ");
    });
    if (found) return found.title;
  }

  // Kế toán trưởng
  if (pClean.includes("kế toán trưởng")) {
    const found = allPositions.find(pos => clean(pos.title).includes("kế toán trưởng"));
    if (found) return found.title;
  }

  // Thủ kho
  if (pClean.includes("thủ kho")) {
    const found = allPositions.find(pos => clean(pos.title).includes("thủ kho"));
    if (found) return found.title;
  }

  // Trưởng phòng / Trưởng bộ phận
  if (pClean.includes("trưởng phòng") || pClean.includes("trưởng bộ phận") || pClean.includes("head")) {
    const found = allPositions.find(pos => {
      const tc = clean(pos.title);
      return tc.includes("trưởng phòng") || tc.includes("trưởng bộ phận") || tc.includes("head");
    });
    if (found) return found.title;
  }

  // Phó phòng / Phó trưởng phòng
  if (pClean.includes("phó phòng") || pClean.includes("phó trưởng phòng")) {
    const found = allPositions.find(pos => {
      const tc = clean(pos.title);
      return tc.includes("phó phòng") || tc.includes("phó trưởng phòng");
    });
    if (found) return found.title;
  }

  // Phó giám đốc
  if (pClean.includes("phó giám đốc")) {
    const found = allPositions.find(pos => clean(pos.title).includes("phó giám đốc"));
    if (found) return found.title;
  }

  // Tổng giám đốc / CEO
  if (pClean.includes("tổng giám đốc") || pClean.includes("giám đốc điều hành") || pClean.includes("ceo")) {
    const found = allPositions.find(pos => {
      const tc = clean(pos.title);
      return tc.includes("tổng giám đốc") || tc.includes("ceo");
    });
    if (found) return found.title;
  }

  // Pháp chế
  if (pClean.includes("pháp chế")) {
    const found = allPositions.find(pos => clean(pos.title).includes("pháp chế"));
    if (found) return found.title;
  }

  // Marketing
  if (pClean.includes("marketing")) {
    const found = allPositions.find(pos => clean(pos.title).includes("marketing"));
    if (found) return found.title;
  }

  // Chuyên viên mua hàng / Cung ứng / Procurement
  if (pClean.includes("mua hàng") || pClean.includes("cung ứng") || pClean.includes("procurement") || pClean.includes("import")) {
    const isManager = pClean.includes("trưởng") || pClean.includes("giám đốc") || pClean.includes("head") || pClean.includes("lead");
    if (!isManager) {
      // 1. Try to find non-manager title matching both 'mua hàng'
      const nonHeadPositions = allPositions.filter(pos => {
        const tc = clean(pos.title);
        return !tc.includes("trưởng") && !tc.includes("giám đốc") && !tc.includes("head") && !tc.includes("lead");
      });
      // Prefer exact combined title if candidate has international/domestic keywords
      if (pClean.includes("quốc tế") && pClean.includes("trong nước")) {
        const foundCombined = nonHeadPositions.find(pos => {
          const tc = clean(pos.title);
          return tc.includes("quốc tế") && tc.includes("trong nước");
        });
        if (foundCombined) return foundCombined.title;
      }
      const found = nonHeadPositions.find(pos => {
        const tc = clean(pos.title);
        return tc.includes("mua hàng") || tc.includes("cung ứng") || tc.includes("procurement");
      });
      if (found) return found.title;
    }
  }

  // Chuyên viên kinh doanh
  if (pClean.includes("kinh doanh")) {
    const found = allPositions.find(pos => {
      const tc = clean(pos.title);
      return tc.includes("kinh doanh") && !tc.includes("admin kinh doanh") && !tc.includes("trưởng phòng");
    });
    if (found) return found.title;
  }

  // 3. Fallback: maximum keyword overlap
  let bestPos: string | null = null;
  let maxScore = 0;
  const pWords = pClean.split(" ").filter(w => w.length > 2);

  for (const pos of allPositions) {
    const titleWords = clean(pos.title).split(" ").filter(w => w.length > 2);
    const score = pWords.filter(w => titleWords.includes(w)).length;
    if (score > maxScore) {
      maxScore = score;
      bestPos = pos.title;
    }
  }

  return maxScore >= 2 ? bestPos : null;
};

const PERMISSION_MATRIX = [
  { module: "Điều Hành & Workspace", director: "Toàn quyền", manager: "Phòng ban", staff: "Cá nhân", accountant: "Xem tổng hợp" },
  { module: "Kinh Doanh (Đơn Hàng / Báo Giá)", director: "Toàn quyền duyệt", manager: "Quản lý & Duyệt", staff: "Tạo & Quản lý đơn", accountant: "Theo dõi hóa đơn" },
  { module: "Quản Lý Kho & Thẻ Kho", director: "Xem & Giám sát", manager: "Xem báo cáo", staff: "Xem tồn kho", accountant: "Đối soát xuất nhập" },
  { module: "Application / Phòng Lab", director: "Giám sát", manager: "Phân công", staff: "Xử lý mẫu/sự vụ", accountant: "Xem chi phí" },
  { module: "Cung Ứng & Mua Hàng (PR/PO)", director: "Duyệt đơn mua", manager: "Tạo đề xuất PR", staff: "Đề xuất vật tư", accountant: "Thanh toán NCC" },
  { module: "Pháp Chế & Hợp Đồng Thầu", director: "Phê duyệt ký", manager: "Thẩm định pháp lý", staff: "Soạn thảo hồ sơ", accountant: "Lưu trữ hợp đồng" },
  { module: "Sổ Hóa Đơn & Doanh Thu", director: "Toàn quyền", manager: "Xem doanh thu", staff: "Xem doanh số cá nhân", accountant: "Xuất & đính kèm HĐ" },
  { module: "Cấu Hình & Quản Lý Tài Khoản", director: "Toàn quyền", manager: "Xem danh sách", staff: "Không truy cập", accountant: "Không truy cập" }
];

export interface SettingsModuleProps {
  initialSubTab?: "personnel" | "users" | "departments" | "audit" | "notifications" | "finance" | "factory";
}

export const SettingsModule: React.FC<SettingsModuleProps> = ({ initialSubTab }) => {
  const [subTab, setSubTab] = useState<"personnel" | "users" | "departments" | "audit" | "notifications" | "finance" | "factory">(() => {
    if (initialSubTab) return initialSubTab;
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("settings_target_subtab");
      if (saved && ["personnel", "users", "departments", "audit", "notifications", "finance"].includes(saved)) {
        localStorage.removeItem("settings_target_subtab");
        return saved as any;
      }
    }
    return "users";
  });

  useEffect(() => {
    if (initialSubTab) {
      setSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  // Notification Matrix Hook & State
  const {
    notificationMatrix,
    updateNotificationMatrix,
    resetNotificationMatrix,
    testTriggerNotification,
    personnelList: notifPersonnelList
  } = useNotification();

  const [localMatrix, setLocalMatrix] = useState<Record<string, NotificationMatrixEvent>>({});
  const [matrixSearch, setMatrixSearch] = useState("");
  const [matrixCategoryFilter, setMatrixCategoryFilter] = useState("all");
  const [hasMatrixChanges, setHasMatrixChanges] = useState(false);
  const [expandedPersonnelEvent, setExpandedPersonnelEvent] = useState<string | null>(null);

  useEffect(() => {
    if (notificationMatrix && Object.keys(notificationMatrix).length > 0) {
      setLocalMatrix(notificationMatrix);
    }
  }, [notificationMatrix]);

  const [personnel, setPersonnel] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter & Search states for Users
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDept, setSelectedDept] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");

  // Filter & Search states for Personnel
  const [personnelSearchQuery, setPersonnelSearchQuery] = useState("");
  const [selectedPersonnelDeptFilter, setSelectedPersonnelDeptFilter] = useState("all");
  const [selectedOrgDept, setSelectedOrgDept] = useState("all");

  // Dynamic Positions state (customized positions by department)
  const [customPositions, setCustomPositions] = useState<Record<string, any>>(DEPARTMENT_POSITIONS);

  // Position assignments map: deptKey -> posTitle -> array of employee_codes
  const [positionAssignments, setPositionAssignments] = useState<Record<string, Record<string, string[]>>>({});

  // Position Edit/Add Modal State
  const [posModal, setPosModal] = useState<{
    isOpen: boolean;
    deptKey: string;
    posIndex: number | null;
    title: string;
    level: "Director" | "Manager" | "Specialist" | "Staff";
    defaultRole: string;
    desc: string;
    oldTitle?: string;
  }>({
    isOpen: false,
    deptKey: "",
    posIndex: null,
    title: "",
    level: "Specialist",
    defaultRole: "sales_rep",
    desc: ""
  });

  // Appoint Staff Modal State
  const [appointModal, setAppointModal] = useState<{
    isOpen: boolean;
    deptKey: string;
    posTitle: string;
    selectedEmpCode: string;
    isConcurrent: boolean;
  }>({
    isOpen: false,
    deptKey: "",
    posTitle: "",
    selectedEmpCode: "",
    isConcurrent: true
  });

  // Modal States
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [isPersonnelModalOpen, setIsPersonnelModalOpen] = useState(false);
  const [isResetPasswordModalOpen, setIsResetPasswordModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const handleResetData = async () => {
    const confirmPassword = window.prompt("Nhập mật khẩu của bạn để xác nhận XÓA TOÀN BỘ nhân sự và tài khoản:");
    if (!confirmPassword) return;
    setIsResetting(true);
    try {
      const res = await fetch("/api/settings?action=reset_personnel_and_users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_personnel_and_users", confirm_password: confirmPassword })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert("✅ Đã làm sạch toàn bộ dữ liệu Nhân sự và Tài khoản (ngoại trừ Quản Trị Viên Hệ Thống). Bây giờ bạn có thể nhập mới lại dữ liệu từ đầu.");
        setIsResetModalOpen(false);
        await fetchData();
      } else {
        alert("❌ Lỗi khi làm sạch dữ liệu: " + (data.error || "Không xác định"));
      }
    } catch (e: any) {
      alert("❌ Lỗi kết nối máy chủ: " + e.message);
    } finally {
      setIsResetting(false);
    }
  };

  // Thông báo mật khẩu tạm của các tài khoản vừa tạo (máy chủ chỉ trả về một lần)
  const showInitialCredentials = (list: any) => {
    if (!Array.isArray(list) || list.length === 0) return;
    const lines = list.map((c: any) => `${c.username} (${c.full_name || ""}): ${c.password}`).join("\n");
    alert(`🔑 Mật khẩu tạm của ${list.length} tài khoản mới — hãy lưu lại và giao riêng cho từng người (chỉ hiển thị một lần, phải đổi ở lần đăng nhập đầu):\n\n${lines}`);
  };

  const [isSyncingUsers, setIsSyncingUsers] = useState(false);
  const handleSyncUsersFromPersonnel = async () => {
    setIsSyncingUsers(true);
    try {
      const res = await fetch("/api/settings?action=sync_users_from_personnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_users_from_personnel" })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert("✅ " + data.message);
        showInitialCredentials(data.initial_credentials);
        await fetchData();
      } else {
        alert("❌ Lỗi: " + (data.error || "Không thể đồng bộ"));
      }
    } catch (e: any) {
      alert("❌ Lỗi kết nối: " + e.message);
    } finally {
      setIsSyncingUsers(false);
    }
  };

  const personnelFileInputRef = useRef<HTMLInputElement>(null);
  const [isImportingPersonnelExcel, setIsImportingPersonnelExcel] = useState(false);

  const handleDownloadPersonnelTemplate = () => {
    const sampleData = [
      {
        "Mã nhân viên (*)": "NV-ABT-001",
        "Họ và tên (*)": "Nguyễn Văn A",
        "Tên đăng nhập (*)": "NV-ABT-001",
        "Mật khẩu khởi tạo": "",
        "Phòng ban (*)": "Ban Giám Đốc",
        "Chức vụ / Vị trí (*)": "Tổng Giám Đốc / Giám Đốc Điều Hành (CEO)",
        "Vai trò hệ thống (*)": "admin",
        "Email (*)": "a.nv@abtvn.com",
        "Số điện thoại": "0900000001",
        "Trạng thái": "ACTIVE"
      },
      {
        "Mã nhân viên (*)": "NV-ABT-002",
        "Họ và tên (*)": "Trần Thị B",
        "Tên đăng nhập (*)": "NV-ABT-002",
        "Mật khẩu khởi tạo": "",
        "Phòng ban (*)": "Kinh Doanh",
        "Chức vụ / Vị trí (*)": "Trưởng Phòng Kinh Doanh (Head of Sales)",
        "Vai trò hệ thống (*)": "sales_head",
        "Email (*)": "b.tt@abtvn.com",
        "Số điện thoại": "0900000002",
        "Trạng thái": "ACTIVE"
      },
      {
        "Mã nhân viên (*)": "NV-ABT-003",
        "Họ và tên (*)": "Lê Minh Khoa",
        "Tên đăng nhập (*)": "NV-ABT-003",
        "Mật khẩu khởi tạo": "",
        "Phòng ban (*)": "Nghiên Cứu R&D",
        "Chức vụ / Vị trí (*)": "Trưởng Phòng R&D",
        "Vai trò hệ thống (*)": "rd_head",
        "Email (*)": "khoa.lm@abtvn.com",
        "Số điện thoại": "0900000003",
        "Trạng thái": "ACTIVE"
      },
      {
        "Mã nhân viên (*)": "NV-ABT-004",
        "Họ và tên (*)": "Phạm Hoàng Lan",
        "Tên đăng nhập (*)": "NV-ABT-004",
        "Mật khẩu khởi tạo": "",
        "Phòng ban (*)": "Sản Xuất Kit",
        "Chức vụ / Vị trí (*)": "Trưởng Phòng / Quản Đốc Sản Xuất Kit",
        "Vai trò hệ thống (*)": "kit_head",
        "Email (*)": "lan.ph@abtvn.com",
        "Số điện thoại": "0900000004",
        "Trạng thái": "ACTIVE"
      },
      {
        "Mã nhân viên (*)": "NV-ABT-005",
        "Họ và tên (*)": "Vũ Quốc Tuấn",
        "Tên đăng nhập (*)": "NV-ABT-005",
        "Mật khẩu khởi tạo": "",
        "Phòng ban (*)": "Tổng Hợp Oligo",
        "Chức vụ / Vị trí (*)": "Kỹ Thuật Viên Vận Hành Máy Tổng Hợp CPG",
        "Vai trò hệ thống (*)": "oligo_staff",
        "Email (*)": "tuan.vq@abtvn.com",
        "Số điện thoại": "0900000005",
        "Trạng thái": "ACTIVE"
      },
      {
        "Mã nhân viên (*)": "NV-ABT-006",
        "Họ và tên (*)": "Đặng Thu Hà",
        "Tên đăng nhập (*)": "NV-ABT-006",
        "Mật khẩu khởi tạo": "",
        "Phòng ban (*)": "QA / QC",
        "Chức vụ / Vị trí (*)": "Trưởng Bộ Phận QA/QC (QA/QC Manager)",
        "Vai trò hệ thống (*)": "qa_qc_lead",
        "Email (*)": "ha.dt@abtvn.com",
        "Số điện thoại": "0900000006",
        "Trạng thái": "ACTIVE"
      }
    ];

    const roleMappingData = [
      { "Phòng Ban": "Ban Giám Đốc", "Chức Vụ / Vị Trí Công Việc": "Tổng Giám Đốc / Giám Đốc Điều Hành (CEO)", "Vai Trò Hệ Thống": "admin", "Khối": "Điều Hành" },
      { "Phòng Ban": "Ban Giám Đốc", "Chức Vụ / Vị Trí Công Việc": "Phó Giám Đốc", "Vai Trò Hệ Thống": "admin", "Khối": "Điều Hành" },
      { "Phòng Ban": "Nghiên Cứu R&D", "Chức Vụ / Vị Trí Công Việc": "Trưởng Phòng R&D", "Vai Trò Hệ Thống": "rd_head", "Khối": "Khối Kỹ Thuật – Nhà Máy (P-RD)" },
      { "Phòng Ban": "Nghiên Cứu R&D", "Chức Vụ / Vị Trí Công Việc": "Chuyên Viên R&D Sinh Học Phân Tử", "Vai Trò Hệ Thống": "rd_staff", "Khối": "Khối Kỹ Thuật – Nhà Máy (P-RD)" },
      { "Phòng Ban": "Sản Xuất Kit", "Chức Vụ / Vị Trí Công Việc": "Trưởng Phòng / Quản Đốc Sản Xuất Kit", "Vai Trò Hệ Thống": "kit_head", "Khối": "Khối Kỹ Thuật – Nhà Máy (P-KIT)" },
      { "Phòng Ban": "Sản Xuất Kit", "Chức Vụ / Vị Trí Công Việc": "Kỹ Thuật Viên Sản Xuất & Đóng Gói Kit GMP", "Vai Trò Hệ Thống": "kit_staff", "Khối": "Khối Kỹ Thuật – Nhà Máy (P-KIT)" },
      { "Phòng Ban": "Tổng Hợp Oligo", "Chức Vụ / Vị Trí Công Việc": "Trưởng Phòng Tổng Hợp Oligo", "Vai Trò Hệ Thống": "oligo_head", "Khối": "Khối Kỹ Thuật – Nhà Máy (P-OLIGO)" },
      { "Phòng Ban": "Tổng Hợp Oligo", "Chức Vụ / Vị Trí Công Việc": "Kỹ Thuật Viên Vận Hành Máy Tổng Hợp CPG", "Vai Trò Hệ Thống": "oligo_staff", "Khối": "Khối Kỹ Thuật – Nhà Máy (P-OLIGO)" },
      { "Phòng Ban": "Kỹ Thuật – Thiết Bị", "Chức Vụ / Vị Trí Công Việc": "Trưởng Phòng Kỹ Thuật – Thiết Bị", "Vai Trò Hệ Thống": "device_head", "Khối": "Khối Kỹ Thuật – Nhà Máy (P-DEVICE)" },
      { "Phòng Ban": "Kỹ Thuật – Thiết Bị", "Chức Vụ / Vị Trí Công Việc": "Kỹ Sư Cơ Điện Tử & Firmware Thiết Bị Y Sinh", "Vai Trò Hệ Thống": "device_staff", "Khối": "Khối Kỹ Thuật – Nhà Máy (P-DEVICE)" },
      { "Phòng Ban": "QA / QC", "Chức Vụ / Vị Trí Công Việc": "Trưởng Bộ Phận QA/QC (QA/QC Manager)", "Vai Trò Hệ Thống": "qa_qc_lead", "Khối": "Khối Kỹ Thuật – Nhà Máy (P-QA)" },
      { "Phòng Ban": "QA / QC", "Chức Vụ / Vị Trí Công Việc": "Chuyên Viên Quản Lý Chất Lượng & ISO 13485", "Vai Trò Hệ Thống": "qa_qc", "Khối": "Khối Kỹ Thuật – Nhà Máy (P-QA)" },
      { "Phòng Ban": "Kinh Doanh", "Chức Vụ / Vị Trí Công Việc": "Trưởng Phòng Kinh Doanh", "Vai Trò Hệ Thống": "sales_head", "Khối": "Khối Kinh Doanh" },
      { "Phòng Ban": "Kinh Doanh", "Chức Vụ / Vị Trí Công Việc": "Chuyên Viên Kinh Doanh (Senior/Junior)", "Vai Trò Hệ Thống": "sales_rep", "Khối": "Khối Kinh Doanh" },
      { "Phòng Ban": "Kho Vận", "Chức Vụ / Vị Trí Công Việc": "Trưởng Bộ Phận Kho Vận", "Vai Trò Hệ Thống": "warehouse_lead", "Khối": "Khối Kinh Doanh" },
      { "Phòng Ban": "Kho Vận", "Chức Vụ / Vị Trí Công Việc": "Thủ Kho Vật Tư Sinh Phẩm & Hóa Chất", "Vai Trò Hệ Thống": "warehouse", "Khối": "Khối Kinh Doanh" },
      { "Phòng Ban": "Mua Hàng & Cung Ứng", "Chức Vụ / Vị Trí Công Việc": "Trưởng Bộ Phận Cung Ứng", "Vai Trò Hệ Thống": "procurement_lead", "Khối": "Khối Kinh Doanh" },
      { "Phòng Ban": "Mua Hàng & Cung Ứng", "Chức Vụ / Vị Trí Công Việc": "Chuyên Viên Mua Hàng Quốc Tế / Trong Nước", "Vai Trò Hệ Thống": "procurement_specialist", "Khối": "Khối Kinh Doanh" },
      { "Phòng Ban": "Kỹ Thuật & Ứng Dụng", "Chức Vụ / Vị Trí Công Việc": "Trưởng Phòng Kỹ Thuật & Ứng Dụng", "Vai Trò Hệ Thống": "app_head", "Khối": "Khối Kinh Doanh" },
      { "Phòng Ban": "Kỹ Thuật & Ứng Dụng", "Chức Vụ / Vị Trí Công Việc": "Kỹ Sư Ứng Dụng PCR / Sinh Học Phân Tử", "Vai Trò Hệ Thống": "app_rep", "Khối": "Khối Kinh Doanh" },
      { "Phòng Ban": "Kế Toán", "Chức Vụ / Vị Trí Công Việc": "Kế Toán Trưởng", "Vai Trò Hệ Thống": "accountant_head", "Khối": "Khối Văn Phòng" },
      { "Phòng Ban": "Kế Toán", "Chức Vụ / Vị Trí Công Việc": "Chuyên Viên Kế Toán Kho & Công Nợ", "Vai Trò Hệ Thống": "accountant", "Khối": "Khối Văn Phòng" },
      { "Phòng Ban": "Pháp Chế", "Chức Vụ / Vị Trí Công Việc": "Trưởng Bộ Phận Pháp Chế", "Vai Trò Hệ Thống": "legal_head", "Khối": "Khối Văn Phòng" },
      { "Phòng Ban": "Pháp Chế", "Chức Vụ / Vị Trí Công Việc": "Chuyên Viên Pháp Chế & Tuân Thủ", "Vai Trò Hệ Thống": "legal", "Khối": "Khối Văn Phòng" }
    ];

    const ws = XLSX.utils.json_to_sheet(sampleData);
    const wsRoles = XLSX.utils.json_to_sheet(roleMappingData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "TaiKhoan_NhanSu_ToanCongTy");
    XLSX.utils.book_append_sheet(wb, wsRoles, "Bảng_Tham_Chiếu_Chức_Vụ");

    ws["!cols"] = [
      { wch: 18 }, // Mã NV
      { wch: 24 }, // Họ tên
      { wch: 18 }, // Tên đăng nhập
      { wch: 18 }, // Mật khẩu khởi tạo
      { wch: 22 }, // Phòng ban
      { wch: 38 }, // Chức vụ
      { wch: 20 }, // Vai trò
      { wch: 24 }, // Email
      { wch: 16 }, // SĐT
      { wch: 14 }  // Trạng thái
    ];
    wsRoles["!cols"] = [
      { wch: 24 },
      { wch: 44 },
      { wch: 24 },
      { wch: 34 }
    ];

    XLSX.writeFile(wb, "Mau_TaiKhoan_NhanSu_ToanHeThong_ABT.xlsx");
  };

  const handleImportPersonnelExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isExcelOrCsv = /\.(xlsx|xls|csv)$/i.test(file.name);
    if (!isExcelOrCsv) {
      alert("Vui lòng chọn file định dạng Excel (.xlsx, .xls) hoặc .csv!");
      return;
    }

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        setIsImportingPersonnelExcel(true);
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: "binary" });
        const wsName = wb.SheetNames[0];
        const ws = wb.Sheets[wsName];
        const rawJson: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

        if (!rawJson || rawJson.length === 0) {
          alert("File Excel không có dữ liệu!");
          return;
        }

        const res = await fetch("/api/settings?action=import_personnel_excel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: rawJson })
        });
        const data = await res.json();

        if (res.ok && data.success) {
          alert(`✅ ${data.message || `Đã nạp thành công ${data.count || rawJson.length} nhân sự!`}`);
          showInitialCredentials(data.initial_credentials);
          await fetchData();
        } else {
          alert("❌ Lỗi nạp file Excel: " + (data.error || "Không xác định"));
        }
      } catch (err: any) {
        console.error("Excel import error:", err);
        alert("❌ Lỗi khi đọc file Excel: " + err.message);
      } finally {
        setIsImportingPersonnelExcel(false);
        if (personnelFileInputRef.current) {
          personnelFileInputRef.current.value = "";
        }
      }
    };
    reader.readAsBinaryString(file);
  };

  // Form States for Personnel
  const [personnelFormData, setPersonnelFormData] = useState({
    id: null as number | null,
    employee_code: "",
    full_name: "",
    department: "Kinh Doanh",
    position: "Chuyên Viên Kinh Doanh (Sales Specialist)",
    email: "",
    phone: "",
    status: "ACTIVE"
  });

  // Form States
  const [formData, setFormData] = useState({
    id: null as number | null,
    username: "",
    password: "",
    full_name: "",
    email: "",
    department: "Kinh Doanh",
    role: "sales_rep",
    is_active: true
  });

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // User Granular Permissions Modal state
  const [permissionsModalUser, setPermissionsModalUser] = useState<any | null>(null);
  const [currentEditingPermissions, setCurrentEditingPermissions] = useState<Record<string, boolean>>({});
  const [isSavingPermissions, setIsSavingPermissions] = useState(false);

  const handleOpenPermissionsModal = (u: any) => {
    setPermissionsModalUser(u);
    const eff = getEffectivePermissions(u);
    setCurrentEditingPermissions(eff);
  };

  const handleTogglePermission = (key: string) => {
    setCurrentEditingPermissions(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const getDepartmentIcon = (code: string) => {
    switch (code) {
      case "PROCUREMENT": return ShoppingCart;
      case "SALES": return Briefcase;
      case "WAREHOUSE": return Package;
      case "APPLICATION": return FlaskConical;
      case "LEGAL": return Scale;
      case "ZALO_OA": return Smartphone;
      case "SETTINGS": return Settings;
      case "CHAT": return MessagesSquare;
      default: return Building2;
    }
  };

  const handleToggleDepartmentModule = (deptMod: DepartmentModule) => {
    const isCurrentlyActive = Boolean(currentEditingPermissions[deptMod.key]);
    const nextVal = !isCurrentlyActive;

    const newPerms = { ...currentEditingPermissions };
    newPerms[deptMod.key] = nextVal;

    // Nếu BẬT phòng ban, tự động bật kèm các quyền tính năng cơ bản của phòng ban đó nếu chưa được bật
    if (nextVal && deptMod.defaultPermissions) {
      Object.entries(deptMod.defaultPermissions).forEach(([k, v]) => {
        if (v && newPerms[k] === undefined) {
          newPerms[k] = true;
        }
      });
    }

    setCurrentEditingPermissions(newPerms);
  };

  const handleApplyDepartmentDefaults = (deptName: string, roleName?: string) => {
    const defaultPerms = getDefaultDepartmentPermissions(deptName, roleName);
    setCurrentEditingPermissions(prev => ({
      ...prev,
      ...defaultPerms
    }));
  };

  const handleResetToPreset = () => {
    if (!permissionsModalUser) return;
    const preset = resolveRolePreset(permissionsModalUser.role, permissionsModalUser.department);
    const eff: Record<string, boolean> = {};
    PERMISSION_GROUPS.forEach(g => {
      g.permissions.forEach(p => {
        eff[p.key] = Boolean(preset["*"] || preset[p.key]);
      });
    });
    DEPARTMENT_MODULES.forEach(m => {
      if (eff[m.key] === undefined) {
        eff[m.key] = Boolean(preset["*"] || preset[m.key]);
      }
    });
    setCurrentEditingPermissions(eff);
  };

  const handleSelectAllPermissions = (val: boolean) => {
    const eff: Record<string, boolean> = {};
    PERMISSION_GROUPS.forEach(g => {
      g.permissions.forEach(p => {
        eff[p.key] = val;
      });
    });
    DEPARTMENT_MODULES.forEach(m => {
      eff[m.key] = val;
    });
    setCurrentEditingPermissions(eff);
  };

  const handleSavePermissions = async () => {
    if (!permissionsModalUser) return;
    setIsSavingPermissions(true);
    try {
      const res = await fetch("/api/settings?action=update_permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: permissionsModalUser.id,
          username: permissionsModalUser.username,
          full_name: permissionsModalUser.full_name,
          permissions: currentEditingPermissions
        })
      });
      if (res.ok) {
        setUsers(prev => prev.map(u => (u.id === permissionsModalUser.id || u.username === permissionsModalUser.username) ? { ...u, permissions: currentEditingPermissions } : u));
        setActionMsg({ type: "success", text: `Đã lưu thành công phân quyền phòng ban & tính năng cho ${permissionsModalUser.full_name}!` });
        setTimeout(() => setActionMsg(null), 4000);

        // Đồng bộ realtime vào localStorage nếu đang là user hiện tại
        try {
          const stored = localStorage.getItem("tbr_current_user") || localStorage.getItem("current_user");
          if (stored) {
            const cur = JSON.parse(stored);
            if (cur.id === permissionsModalUser.id || cur.username === permissionsModalUser.username) {
              const updated = { ...cur, permissions: currentEditingPermissions };
              localStorage.setItem("current_user", JSON.stringify(updated));
              localStorage.setItem("tbr_current_user", JSON.stringify(updated));
              localStorage.setItem("via_current_user", JSON.stringify(updated));
            }
          }
        } catch (e) {}

        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("permissions-updated", {
            detail: { userId: permissionsModalUser.id, username: permissionsModalUser.username, permissions: currentEditingPermissions }
          }));
        }
        setPermissionsModalUser(null);
      } else {
        const err = await res.json();
        alert("Lỗi khi lưu phân quyền: " + (err.error || "Không thể cập nhật"));
      }
    } catch (err: any) {
      alert("Lỗi kết nối: " + err.message);
    } finally {
      setIsSavingPermissions(false);
    }
  };

  const getDeptInfoData = (deptName?: string) => {
    if (!deptName) return null;
    if (customPositions[deptName]) return customPositions[deptName];
    const matchedKey = PRIMARY_DEPT_KEYS.find(k => matchDepartment(k, deptName));
    if (matchedKey && customPositions[matchedKey]) return customPositions[matchedKey];
    if (DEPARTMENT_POSITIONS[deptName]) return DEPARTMENT_POSITIONS[deptName];
    return matchedKey ? DEPARTMENT_POSITIONS[matchedKey] : null;
  };

  const getHoldersForPosition = (posTitle: string, deptKey: string, positionsList: any[]) => {
    const fromPersonnel = personnel.filter(p => {
      return matchDepartment(p.department, deptKey) && getBestPositionMatch(p.position, positionsList) === posTitle;
    });

    const assignedKeys = (positionAssignments[deptKey] && positionAssignments[deptKey][posTitle]) || [];
    const fromAssignments = personnel.filter(p =>
      assignedKeys.includes(p.employee_code) ||
      assignedKeys.includes(p.full_name) ||
      assignedKeys.includes(String(p.id))
    );

    const seen = new Set<string>();
    const merged: any[] = [];
    [...fromPersonnel, ...fromAssignments].forEach(p => {
      const key = p.employee_code || String(p.id) || p.full_name;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(p);
      }
    });
    return merged;
  };

  const persistCustomPositions = async (updated: Record<string, any>) => {
    setCustomPositions(updated);
    if (typeof window !== "undefined") {
      localStorage.setItem("tbr_org_department_positions", JSON.stringify(updated));
    }
    try {
      await fetch("/api/storage?key=org_department_positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "org_department_positions", data: updated })
      });
    } catch (e) {
      console.error("Failed to save org positions:", e);
    }
  };

  const persistPositionAssignments = async (updated: Record<string, Record<string, string[]>>) => {
    setPositionAssignments(updated);
    if (typeof window !== "undefined") {
      localStorage.setItem("tbr_org_position_assignments", JSON.stringify(updated));
    }
    try {
      await fetch("/api/storage?key=org_position_assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "org_position_assignments", data: updated })
      });
    } catch (e) {
      console.error("Failed to save position assignments:", e);
    }
  };

  const handleOpenEditPosition = (deptKey: string, posIndex: number, pos: any) => {
    setPosModal({
      isOpen: true,
      deptKey,
      posIndex,
      title: pos.title,
      level: pos.level,
      defaultRole: pos.defaultRole,
      desc: pos.desc,
      oldTitle: pos.title
    });
  };

  const handleOpenAddPosition = (deptKey: string) => {
    const deptInfo = getDeptInfoData(deptKey);
    setPosModal({
      isOpen: true,
      deptKey,
      posIndex: null,
      title: "",
      level: "Specialist",
      defaultRole: deptInfo?.positions[0]?.defaultRole || "sales_rep",
      desc: ""
    });
  };

  const handleDeletePosition = async (deptKey: string, pIdx: number, posTitle: string) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa vị trí chức danh "${posTitle}" khỏi phòng ban ${deptKey}?`)) {
      return;
    }
    const currentDeptInfo = getDeptInfoData(deptKey);
    if (!currentDeptInfo) return;

    const updatedPositionsList = currentDeptInfo.positions.filter((_: any, idx: number) => idx !== pIdx);
    const updatedAll = {
      ...customPositions,
      [deptKey]: {
        ...currentDeptInfo,
        positions: updatedPositionsList
      }
    };
    await persistCustomPositions(updatedAll);

    if (positionAssignments[deptKey]?.[posTitle]) {
      const updatedAssigns = { ...positionAssignments };
      delete updatedAssigns[deptKey][posTitle];
      await persistPositionAssignments(updatedAssigns);
    }
    showToast("success", `Đã xóa vị trí "${posTitle}" khỏi ${deptKey}`);
  };

  const handleSavePosition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!posModal.title.trim()) {
      showToast("error", "Vui lòng nhập tên vị trí chức danh!");
      return;
    }
    const deptKey = posModal.deptKey;
    const currentDeptInfo = getDeptInfoData(deptKey);
    if (!currentDeptInfo) return;

    let updatedPositionsList = [...currentDeptInfo.positions];

    if (posModal.posIndex !== null) {
      const oldTitle = posModal.oldTitle || updatedPositionsList[posModal.posIndex]?.title;
      updatedPositionsList[posModal.posIndex] = {
        title: posModal.title.trim(),
        level: posModal.level,
        defaultRole: posModal.defaultRole,
        desc: posModal.desc.trim()
      };

      if (oldTitle && oldTitle !== posModal.title.trim()) {
        const currentDeptAssigns = positionAssignments[deptKey] || {};
        if (currentDeptAssigns[oldTitle]) {
          const updatedAssigns = {
            ...positionAssignments,
            [deptKey]: {
              ...currentDeptAssigns,
              [posModal.title.trim()]: currentDeptAssigns[oldTitle]
            }
          };
          delete updatedAssigns[deptKey][oldTitle];
          await persistPositionAssignments(updatedAssigns);
        }
      }
    } else {
      updatedPositionsList.push({
        title: posModal.title.trim(),
        level: posModal.level,
        defaultRole: posModal.defaultRole,
        desc: posModal.desc.trim()
      });
    }

    const updatedAll = {
      ...customPositions,
      [deptKey]: {
        ...currentDeptInfo,
        positions: updatedPositionsList
      }
    };

    await persistCustomPositions(updatedAll);
    showToast("success", posModal.posIndex !== null ? `Cập nhật vị trí "${posModal.title}" thành công!` : `Đã thêm vị trí "${posModal.title}" vào ${deptKey}!`);
    setPosModal(prev => ({ ...prev, isOpen: false }));
  };

  const handleOpenAppointModal = (deptKey: string, posTitle: string) => {
    setAppointModal({
      isOpen: true,
      deptKey,
      posTitle,
      selectedEmpCode: "",
      isConcurrent: true
    });
  };

  const handleConfirmAppoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appointModal.selectedEmpCode) {
      showToast("error", "Vui lòng chọn nhân sự từ danh sách công ty!");
      return;
    }
    const emp = personnel.find(p => p.employee_code === appointModal.selectedEmpCode);
    if (!emp) return;

    const deptKey = appointModal.deptKey;
    const posTitle = appointModal.posTitle;

    const currentDeptAssigns = positionAssignments[deptKey] || {};
    const currentPosHolders = currentDeptAssigns[posTitle] || [];

    if (currentPosHolders.includes(emp.employee_code)) {
      showToast("error", `Cán bộ ${emp.full_name} (${emp.employee_code}) đã được bổ nhiệm vào vị trí này!`);
      return;
    }

    const updatedHolders = [...currentPosHolders, emp.employee_code];
    const updatedAssigns = {
      ...positionAssignments,
      [deptKey]: {
        ...currentDeptAssigns,
        [posTitle]: updatedHolders
      }
    };

    await persistPositionAssignments(updatedAssigns);

    if (!appointModal.isConcurrent) {
      try {
        await fetch("/api/settings?action=personnel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...emp,
            department: deptKey,
            position: posTitle
          })
        });
        fetchData();
      } catch (e) {}
    }

    showToast("success", `Bổ nhiệm cán bộ ${emp.full_name} (${emp.employee_code}) vào vị trí "${posTitle}" thành công!`);
    setAppointModal(prev => ({ ...prev, isOpen: false, selectedEmpCode: "" }));
  };

  const handleUnassignStaff = async (deptKey: string, posTitle: string, empCodeOrName: string) => {
    const currentDeptAssigns = positionAssignments[deptKey] || {};
    const currentPosHolders = currentDeptAssigns[posTitle] || [];

    const updatedHolders = currentPosHolders.filter(code => code !== empCodeOrName);
    const updatedAssigns = {
      ...positionAssignments,
      [deptKey]: {
        ...currentDeptAssigns,
        [posTitle]: updatedHolders
      }
    };

    await persistPositionAssignments(updatedAssigns);
    showToast("success", `Đã gỡ bổ nhiệm cán bộ khỏi vị trí "${posTitle}"`);
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/settings?action=overview");
      const data = await res.json();
      if (data) {
        setPersonnel(data.personnel || []);
        setUsers(data.users || []);
        setLogs(data.logs || []);
      }

      // Also load custom positions and assignments from /api/storage
      try {
        const [posRes, assignRes] = await Promise.all([
          fetch("/api/storage?key=org_department_positions").then(r => r.json()).catch(() => null),
          fetch("/api/storage?key=org_position_assignments").then(r => r.json()).catch(() => null)
        ]);

        if (posRes?.data && typeof posRes.data === "object" && Object.keys(posRes.data).length > 0) {
          setCustomPositions((prev: any) => ({ ...prev, ...posRes.data }));
        } else if (typeof window !== "undefined") {
          const local = localStorage.getItem("tbr_org_department_positions");
          if (local) {
            try { setCustomPositions((prev: any) => ({ ...prev, ...JSON.parse(local) })); } catch (e) {}
          }
        }

        if (assignRes?.data && typeof assignRes.data === "object") {
          setPositionAssignments(assignRes.data);
        } else if (typeof window !== "undefined") {
          const localAssign = localStorage.getItem("tbr_org_position_assignments");
          if (localAssign) {
            try { setPositionAssignments(JSON.parse(localAssign)); } catch (e) {}
          }
        }
      } catch (e) {
        console.error("Storage fetch error:", e);
      }
    } catch (e) {
      console.error("Failed to load settings:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const handleNav = (e: any) => {
      if (e.detail && e.detail.tab === "settings" && e.detail.subTab) {
        const validSubTabs = ["personnel", "users", "departments", "audit"];
        if (validSubTabs.includes(e.detail.subTab)) {
          setSubTab(e.detail.subTab);
        }
      }
    };
    window.addEventListener("tbr-navigate" as any, handleNav);
    return () => window.removeEventListener("tbr-navigate" as any, handleNav);
  }, []);

  useEffect(() => {
    if (initialSubTab) {
      setSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  const showToast = (type: "success" | "error", text: string) => {
    setActionMsg({ type, text });
    setTimeout(() => setActionMsg(null), 4000);
  };

  // Open Create / Edit Modal
  const handleOpenUserModal = (userToEdit?: any) => {
    if (userToEdit) {
      setFormData({
        id: userToEdit.id,
        username: userToEdit.username,
        password: "",
        full_name: userToEdit.full_name,
        email: userToEdit.email,
        department: userToEdit.department || "Kinh Doanh",
        role: userToEdit.role || "sales_rep",
        is_active: userToEdit.is_active !== false
      });
    } else {
      setFormData({
        id: null,
        username: "",
        password: "password123",
        full_name: "",
        email: "",
        department: "Kinh Doanh",
        role: "sales_rep",
        is_active: true
      });
    }
    setIsUserModalOpen(true);
  };

  // Submit User Form
  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/settings?action=user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast("success", formData.id ? "Cập nhật tài khoản thành công!" : "Tạo mới tài khoản thành công trên PostgreSQL 18!");
        showInitialCredentials(data.initial_credentials);
        setIsUserModalOpen(false);
        fetchData();
      } else {
        showToast("error", data.error || "Không thể lưu tài khoản");
      }
    } catch (err: any) {
      showToast("error", err.message || "Lỗi lưu dữ liệu");
    }
  };

  // Toggle Account Active/Deactive
  const handleToggleStatus = async (userItem: any) => {
    try {
      const newStatus = !userItem.is_active;
      const res = await fetch("/api/settings?action=toggle_user_status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userItem.id, is_active: newStatus, username: userItem.username })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast("success", `${newStatus ? "Mở khóa" : "Tạm khóa"} tài khoản ${userItem.username} thành công!`);
        fetchData();
      } else {
        showToast("error", data.error || "Không thể cập nhật trạng thái");
      }
    } catch (err: any) {
      showToast("error", err.message || "Lỗi thao tác");
    }
  };

  // Open Reset Password Modal
  const handleOpenResetPassword = (userItem: any) => {
    setSelectedUser(userItem);
    setNewPassword("");
    setConfirmPassword("");
    setIsResetPasswordModalOpen(true);
  };

  // Submit Reset Password
  const handleSaveResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword !== confirmPassword) {
      showToast("error", "Mật khẩu xác nhận không trùng khớp!");
      return;
    }

    try {
      const res = await fetch("/api/settings?action=reset_password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedUser.id, password: newPassword, username: selectedUser.username })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast("success", `Đổi mật khẩu cho tài khoản ${selectedUser.username} thành công!`);
        setIsResetPasswordModalOpen(false);
      } else {
        showToast("error", data.error || "Không thể đổi mật khẩu");
      }
    } catch (err: any) {
      showToast("error", err.message || "Lỗi đổi mật khẩu");
    }
  };

  // Delete User
  const handleDeleteUser = async (userItem: any) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa tài khoản "${userItem.username}" (${userItem.full_name})?`)) return;
    try {
      const res = await fetch("/api/settings?action=delete_user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userItem.id, username: userItem.username })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast("success", `Đã xóa tài khoản ${userItem.username}`);
        fetchData();
      } else {
        showToast("error", data.error || "Không thể xóa tài khoản");
      }
    } catch (err: any) {
      showToast("error", err.message || "Lỗi xóa tài khoản");
    }
  };

  // Open Create / Edit Personnel Modal
  const handleOpenPersonnelModal = (pToEdit?: any, presetDept?: string, presetPosition?: string) => {
    if (pToEdit) {
      setPersonnelFormData({
        id: pToEdit.id,
        employee_code: pToEdit.employee_code,
        full_name: pToEdit.full_name,
        department: pToEdit.department || "Kinh Doanh",
        position: pToEdit.position || "Chuyên Viên Kinh Doanh (Sales Specialist)",
        email: pToEdit.email || "",
        phone: pToEdit.phone || "",
        status: pToEdit.status || "ACTIVE"
      });
    } else {
      const dept = presetDept || "Kinh Doanh";
      const defaultPos = presetPosition || getDeptInfo(dept)?.positions[0]?.title || "Chuyên Viên Kinh Doanh (Senior/Junior)";
      const maxSeq = personnel.reduce((max: number, p: any) => {
        const m = String(p?.employee_code || "").match(/^NV-ABT-(\d+)$/);
        return m ? Math.max(max, Number(m[1])) : max;
      }, 0);
      const nextNum = (maxSeq + 1).toString().padStart(3, "0");
      setPersonnelFormData({
        id: null,
        employee_code: `NV-ABT-${nextNum}`,
        full_name: "",
        department: dept,
        position: defaultPos,
        email: "",
        phone: "",
        status: "ACTIVE"
      });
    }
    setIsPersonnelModalOpen(true);
  };

  // Submit Personnel Form
  const handleSavePersonnel = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/settings?action=personnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(personnelFormData)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast("success", personnelFormData.id ? "Cập nhật hồ sơ nhân sự thành công!" : "Thêm mới nhân sự thành công vào PostgreSQL 18!");
        showInitialCredentials(data.initial_credentials);
        setIsPersonnelModalOpen(false);
        fetchData();
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("tbr_personnel_updated"));
      } else {
        showToast("error", data.error || "Không thể lưu hồ sơ nhân sự");
      }
    } catch (err: any) {
      showToast("error", err.message || "Lỗi lưu dữ liệu");
    }
  };

  // Delete Personnel
  const handleDeletePersonnel = async (p: any) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa nhân sự "${p.full_name}" (${p.employee_code})?`)) return;
    try {
      const res = await fetch("/api/settings?action=delete_personnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, full_name: p.full_name, employee_code: p.employee_code })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast("success", `Đã xóa nhân sự ${p.full_name}`);
        fetchData();
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("tbr_personnel_updated"));
      } else {
        showToast("error", data.error || "Không thể xóa nhân sự");
      }
    } catch (err: any) {
      showToast("error", err.message || "Lỗi xóa nhân sự");
    }
  };

  // Filtered personnel list
  const filteredPersonnel = personnel.filter((p) => {
    const matchSearch =
      !personnelSearchQuery ||
      p.employee_code?.toLowerCase().includes(personnelSearchQuery.toLowerCase()) ||
      p.full_name?.toLowerCase().includes(personnelSearchQuery.toLowerCase()) ||
      p.position?.toLowerCase().includes(personnelSearchQuery.toLowerCase()) ||
      p.email?.toLowerCase().includes(personnelSearchQuery.toLowerCase()) ||
      p.phone?.includes(personnelSearchQuery);
    const matchDept = selectedPersonnelDeptFilter === "all" || matchDepartment(p.department, selectedPersonnelDeptFilter);
    return matchSearch && matchDept;
  });

  // Filtered users list
  const filteredUsers = users.filter((u) => {
    const matchSearch =
      !searchQuery ||
      u.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchDept = selectedDept === "all" || matchDepartment(u.department, selectedDept);
    const matchStatus =
      selectedStatus === "all" ||
      (selectedStatus === "active" && u.is_active !== false) ||
      (selectedStatus === "locked" && u.is_active === false);
    return matchSearch && matchDept && matchStatus;
  });

  // Notification Matrix Roles definition
  const MATRIX_ROLES: { code: string; label: string; short: string; color: string }[] = [
    { code: "admin", label: "Ban Giám Đốc (BOD / CEO)", short: "BGĐ", color: "bg-orange-500/10 text-orange-600 border-orange-500/30" },
    { code: "sales_head", label: "Trưởng Phòng Kinh Doanh", short: "TP.KD", color: "bg-blue-500/10 text-blue-600 border-blue-500/30" },
    { code: "sales_rep", label: "Chuyên Viên Kinh Doanh", short: "NVKD", color: "bg-sky-500/10 text-sky-600 border-sky-500/30" },
    { code: "warehouse", label: "Kho Vận & Thủ Kho", short: "Kho", color: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
    { code: "procurement", label: "Mua Hàng & Cung Ứng", short: "Cung Ứng", color: "bg-cyan-500/10 text-cyan-600 border-cyan-500/30" },
    { code: "app_head", label: "Trưởng Phòng Application", short: "TP.App", color: "bg-purple-500/10 text-purple-600 border-purple-500/30" },
    { code: "app_rep", label: "Chuyên Viên Kỹ Thuật Lab", short: "KT Lab", color: "bg-violet-500/10 text-violet-600 border-violet-500/30" },
    { code: "accountant", label: "Kế Toán & Tài Chính", short: "Kế Toán", color: "bg-rose-500/10 text-rose-600 border-rose-500/30" },
    { code: "qa_qc", label: "Quản Lý Chất Lượng QA/QC", short: "QA/QC", color: "bg-teal-500/10 text-teal-600 border-teal-500/30" },
    { code: "legal", label: "Pháp Chế & Tuân Thủ", short: "Pháp Chế", color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
    // Khối Kỹ thuật – Nhà máy (recipients resolved from factory roles on the server)
    ...TECHNICAL_MATRIX_ROLES.map((r) => ({ code: r.code, label: r.label, short: r.short, color: "bg-teal-500/10 text-teal-700 border-teal-500/30" }))
  ];

  // Matrix Event Filtering
  const matrixEventsList = useMemo(() => {
    const events = Object.values(localMatrix);
    return events.filter(ev => {
      // "technical:<phòng>" narrows the Khối Kỹ thuật to one department
      const matchCategory = matrixCategoryFilter === "all" || ev.category === matrixCategoryFilter ||
        (matrixCategoryFilter.startsWith("technical:") && ev.categoryLabel === `Khối Kỹ thuật · ${matrixCategoryFilter.slice(10)}`);
      const matchSearch = !matrixSearch || 
        ev.name.toLowerCase().includes(matrixSearch.toLowerCase()) ||
        ev.description.toLowerCase().includes(matrixSearch.toLowerCase()) ||
        ev.categoryLabel.toLowerCase().includes(matrixSearch.toLowerCase());
      return matchCategory && matchSearch;
    });
  }, [localMatrix, matrixCategoryFilter, matrixSearch]);

  const handleToggleEventEnabled = (key: string) => {
    setLocalMatrix(prev => {
      const current = prev[key];
      if (!current) return prev;
      setHasMatrixChanges(true);
      return {
        ...prev,
        [key]: { ...current, enabled: !current.enabled }
      };
    });
  };

  const handleToggleEventToast = (key: string) => {
    setLocalMatrix(prev => {
      const current = prev[key];
      if (!current) return prev;
      setHasMatrixChanges(true);
      return {
        ...prev,
        [key]: { ...current, enableToast: !current.enableToast }
      };
    });
  };

  const handleToggleEventRole = (key: string, roleCode: string) => {
    setLocalMatrix(prev => {
      const current = prev[key];
      if (!current) return prev;
      const currentRoles = current.targetRoles || [];
      const exists = currentRoles.includes(roleCode);
      const nextRoles = exists
        ? currentRoles.filter(r => r !== roleCode)
        : [...currentRoles, roleCode];
      setHasMatrixChanges(true);
      return {
        ...prev,
        [key]: { ...current, targetRoles: nextRoles }
      };
    });
  };

  const handleToggleEventPersonnel = (key: string, emp: { employee_id: string; full_name: string }) => {
    setLocalMatrix(prev => {
      const current = prev[key];
      if (!current) return prev;
      const currentIds = current.targetEmployeeIds || [];
      const currentNames = current.targetEmployeeNames || [];
      const exists = currentIds.includes(emp.employee_id);
      const nextIds = exists
        ? currentIds.filter(id => id !== emp.employee_id)
        : [...currentIds, emp.employee_id];
      const nextNames = exists
        ? currentNames.filter(n => n !== emp.full_name)
        : [...currentNames, emp.full_name];
      setHasMatrixChanges(true);
      return {
        ...prev,
        [key]: { ...current, targetEmployeeIds: nextIds, targetEmployeeNames: nextNames }
      };
    });
  };

  const handleSaveMatrix = async () => {
    await updateNotificationMatrix(localMatrix);
    setHasMatrixChanges(false);
  };

  const handleResetMatrix = async () => {
    if (window.confirm("Bạn có chắc muốn khôi phục Ma trận thông báo về cấu hình chuẩn mặc định?")) {
      await resetNotificationMatrix();
      setHasMatrixChanges(false);
    }
  };

  return (
    <div className="space-y-6 text-left">
      {/* Toast Notification */}
      {actionMsg && (
        <div
          className={`fixed bottom-6 right-6 z-50 p-4 rounded-2xl shadow-2xl flex items-center gap-3 border text-xs font-bold transition-all ${
            actionMsg.type === "success"
              ? "bg-emerald-950 text-emerald-300 border-emerald-700/80 shadow-emerald-900/30"
              : "bg-rose-950 text-rose-300 border-rose-700/80 shadow-rose-900/30"
          }`}
        >
          {actionMsg.type === "success" ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <AlertCircle className="w-5 h-5 text-rose-400" />}
          <span>{actionMsg.text}</span>
        </div>
      )}

      {/* Header - Standardized 2-Tier Layout */}
      <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-3.5">
        <input
          type="file"
          ref={personnelFileInputRef}
          accept=".xlsx, .xls, .csv"
          onChange={handleImportPersonnelExcel}
          className="hidden"
        />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
              <Settings className="w-5 h-5 shrink-0" />
              <h2 className="text-lg sm:text-xl font-black tracking-tight text-slate-900 dark:text-white uppercase">
                CẤU HÌNH HỆ THỐNG, TÀI KHOẢN &amp; NHÂN SỰ TOÀN CÔNG TY
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Quản trị tập trung danh sách Nhân sự &amp; Tài khoản cho toàn bộ các khối (Kinh Doanh, Văn Phòng &amp; Khối Kỹ Thuật – Nhà Máy), phân quyền RBAC và Sổ Nhật ký.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDownloadPersonnelTemplate}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
              title="Tải biểu mẫu Excel chuẩn để nhập Tài khoản & Nhân sự cho toàn hệ thống (gồm cả Khối Kỹ thuật & Khối Kinh doanh)"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              <span>Tải Mẫu Tài Khoản &amp; Nhân Sự (.xlsx)</span>
            </button>
            <button
              type="button"
              disabled={isImportingPersonnelExcel}
              onClick={() => personnelFileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs"
              title="Nhập danh sách Tài khoản & Nhân sự toàn hệ thống từ file Excel (.xlsx / .xls)"
            >
              <Upload className={`w-3.5 h-3.5 ${isImportingPersonnelExcel ? "animate-spin" : ""}`} />
              <span>{isImportingPersonnelExcel ? "Đang nạp Excel..." : "Nạp Excel Tài Khoản & Nhân Sự"}</span>
            </button>
          </div>
        </div>

        <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800/80">
          <div className="flex flex-wrap items-center bg-slate-100 dark:bg-slate-800/60 p-1 rounded-xl border border-slate-200 dark:border-slate-700/60 text-xs font-semibold gap-1">
            <button
              onClick={() => setSubTab("users")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                subTab === "users" ? "bg-white dark:bg-slate-700 text-orange-600 dark:text-orange-400 shadow-xs font-bold" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <Key className="w-3.5 h-3.5 shrink-0" /> Quản Lý Tài Khoản ({users.length})
            </button>
            <button
              onClick={() => setSubTab("personnel")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                subTab === "personnel" ? "bg-white dark:bg-slate-700 text-orange-600 dark:text-orange-400 shadow-xs font-bold" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <Users className="w-3.5 h-3.5 shrink-0" /> Danh Bạ Nhân Sự ({personnel.length})
            </button>
            <button
              onClick={() => setSubTab("departments")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                subTab === "departments" ? "bg-white dark:bg-slate-700 text-orange-600 dark:text-orange-400 shadow-xs font-bold" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <Briefcase className="w-3.5 h-3.5 shrink-0" /> Vị Trí &amp; Chức Danh ({Object.keys(DEPARTMENT_POSITIONS).length} Phòng)
            </button>
            <button
              onClick={() => setSubTab("audit")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                subTab === "audit" ? "bg-white dark:bg-slate-700 text-orange-600 dark:text-orange-400 shadow-xs font-bold" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <FileText className="w-3.5 h-3.5 shrink-0" /> Nhật Ký Hệ Thống ({logs.length})
            </button>
            <button
              onClick={() => setSubTab("notifications")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                subTab === "notifications" ? "bg-white dark:bg-slate-700 text-orange-600 dark:text-orange-400 shadow-xs font-bold" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <Bell className="w-3.5 h-3.5 shrink-0" /> Ma Trận Thông Báo ({Object.keys(localMatrix).length || 14})
            </button>
            <button
              onClick={() => setSubTab("finance")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                subTab === "finance" ? "bg-white dark:bg-slate-700 text-orange-600 dark:text-orange-400 shadow-xs font-bold" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <FileText className="w-3.5 h-3.5 shrink-0" /> Tài Chính
            </button>
          </div>
        </div>
      </div>

      {/* SUBTAB: USERS (ACCOUNT MANAGEMENT) */}
      {subTab === "users" && (
        <div className="space-y-6">
          {/* Top KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-slate-400 uppercase block">Tổng Số Tài Khoản</span>
                <span className="text-2xl font-black font-mono text-slate-900 dark:text-white mt-1 block">{users.length}</span>
                <span className="text-[10px] text-slate-500">Lưu trữ trên PostgreSQL 18</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-orange-500/10 text-orange-500 border border-orange-500/20 flex items-center justify-center font-bold">
                <KeyRound className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-slate-400 uppercase block">Đang Hoạt Động</span>
                <span className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1 block">
                  {users.filter(u => u.is_active !== false).length}
                </span>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Được phép đăng nhập</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 flex items-center justify-center font-bold">
                <UserCheck className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-slate-400 uppercase block">Tài Khoản Tạm Khóa</span>
                <span className="text-2xl font-black font-mono text-rose-600 dark:text-rose-400 mt-1 block">
                  {users.filter(u => u.is_active === false).length}
                </span>
                <span className="text-[10px] text-rose-500">Chặn truy cập hệ thống</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-500 border border-rose-500/20 flex items-center justify-center font-bold">
                <UserX className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-slate-400 uppercase block">Ban Quản Lý &amp; BGĐ</span>
                <span className="text-2xl font-black font-mono text-indigo-600 dark:text-indigo-400 mt-1 block">
                  {users.filter(u => ["admin", "Director", "sales_head", "app_head", "warehouse_lead", "procurement_lead", "accountant_head", "qa_qc_lead", "legal_head"].includes(u.role)).length}
                </span>
                <span className="text-[10px] text-indigo-500">Quyền phê duyệt cấp quản lý</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 flex items-center justify-center font-bold">
                <Shield className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Action Toolbar & Filters */}
          <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 flex-1">
              {/* Search */}
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm theo tên đăng nhập, họ tên, email..."
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:border-orange-500 transition-all"
                />
              </div>

              {/* Dept filter */}
              <select
                value={selectedDept}
                onChange={(e) => setSelectedDept(e.target.value)}
                className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-700 dark:text-slate-300 focus:outline-hidden focus:border-orange-500"
              >
                <option value="all">-- Tất cả phòng ban --</option>
                {PRIMARY_DEPT_KEYS.map((dept) => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>

              {/* Status filter */}
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-700 dark:text-slate-300 focus:outline-hidden focus:border-orange-500"
              >
                <option value="all">-- Tất cả trạng thái --</option>
                <option value="active">Đang hoạt động</option>
                <option value="locked">Đang tạm khóa</option>
              </select>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchData()}
                className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl transition-all cursor-pointer"
                title="Làm mới dữ liệu từ PostgreSQL"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </button>
              <button
                onClick={handleSyncUsersFromPersonnel}
                disabled={isSyncingUsers}
                className="flex items-center gap-1.5 px-3 py-2 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 rounded-xl text-xs font-bold transition-all cursor-pointer"
                title="Khởi tạo tài khoản đăng nhập cho toàn bộ nhân sự chưa có tài khoản"
              >
                <Sparkles className={`w-3.5 h-3.5 ${isSyncingUsers ? "animate-spin" : ""}`} />
                <span>{isSyncingUsers ? "Đang đồng bộ..." : "Đồng Bộ Từ Nhân Sự"}</span>
              </button>
              <button
                onClick={() => setIsResetModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800 rounded-xl text-xs font-bold transition-all cursor-pointer"
                title="Xóa toàn bộ dữ liệu Nhân sự & Tài khoản cũ để nhập lại từ đầu"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Dữ Liệu</span>
              </button>
              <button
                onClick={() => handleOpenUserModal()}
                className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-orange-600 to-orange-800 hover:from-orange-500 hover:to-orange-700 text-white font-bold rounded-xl text-xs shadow-md shadow-orange-600/20 transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ Tạo Mới Tài Khoản</span>
              </button>
            </div>
          </div>

          {/* Users Table */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700">
                    <th className="py-3.5 px-4">Tài Khoản (Username)</th>
                    <th className="py-3.5 px-4">Họ Và Tên</th>
                    <th className="py-3.5 px-4">Phòng Ban</th>
                    <th className="py-3.5 px-4">Vai Trò Hệ Thống</th>
                    <th className="py-3.5 px-4">Email Liên Hệ</th>
                    <th className="py-3.5 px-4 text-center">Trạng Thái</th>
                    <th className="py-3.5 px-4 text-right">Thao Tác Quản Trị</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredUsers.map((u) => {
                    const roleInfo = ROLE_LABELS[u.role] || {
                      label: u.role,
                      color: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700",
                      desc: ""
                    };
                    const isActive = u.is_active !== false;

                    return (
                      <tr key={u.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                        {/* Username & Avatar */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-xl bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-400 font-bold flex items-center justify-center text-xs border border-orange-200 dark:border-orange-800 shrink-0">
                              {(String(u?.username || "AD")).slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-mono font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                                <span>{u?.username || "Chưa có tên"}</span>
                                {u.id === 1 && (
                                  <span className="text-[9px] px-1.5 py-0.2 bg-amber-500/20 text-amber-500 border border-amber-500/30 rounded-md font-bold font-sans">
                                    Root Admin
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono">ID: #{u.id}</div>
                            </div>
                          </div>
                        </td>

                        {/* Full Name & Linked Employee Code */}
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-900 dark:text-white">{u?.full_name || u?.username || "—"}</div>
                          {(() => {
                            const emp = personnel.find(
                              (p) => p?.full_name && u?.full_name && String(p.full_name).trim().toLowerCase() === String(u.full_name).trim().toLowerCase()
                            ) || personnel.find(
                              (p) => p?.employee_code && u?.username && String(p.employee_code).toLowerCase().replace(/[^a-z0-9]/g, "").includes(String(u.username).toLowerCase().replace(/[^a-z0-9]/g, ""))
                            ) || personnel.find(
                              (p) => p?.email && u?.email && String(p.email).toLowerCase().trim() === String(u.email).toLowerCase().trim()
                            );
                            if (emp) {
                              return (
                                <div className="flex items-center gap-1 mt-0.5 text-[10px] text-indigo-600 dark:text-indigo-400 font-mono font-medium">
                                  <Link2 className="w-2.5 h-2.5 shrink-0" />
                                  <span>{emp.employee_code} • {emp.position}</span>
                                </div>
                              );
                            }
                            return (
                              <div className="text-[10px] text-slate-400 italic mt-0.5">Tài khoản độc lập</div>
                            );
                          })()}
                        </td>

                        {/* Department */}
                        <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300 font-medium">
                          <div>{u.department}</div>
                          {u.factory_org_code && (
                            <button
                              type="button"
                              onClick={() => setSubTab("factory")}
                              className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 text-[10px] font-mono font-bold hover:bg-teal-100 cursor-pointer"
                              title={`Đơn vị Khối Kỹ thuật / Nhà máy: ${u.factory_org_name || u.factory_org_code} — Bấm để mở Phân quyền Nhà máy`}
                            >
                              <span>🏭 {u.factory_org_code}</span>
                              {u.has_factory_pin && <span className="text-emerald-600 dark:text-emerald-400">• PIN✓</span>}
                            </button>
                          )}
                        </td>

                        {/* Role */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`inline-block px-2.5 py-1 rounded-lg text-[10px] font-bold border ${roleInfo.color}`}
                              title={roleInfo.desc}
                            >
                              {roleInfo.label}
                            </span>
                            {Array.isArray(u.factory_roles) && u.factory_roles.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setSubTab("factory")}
                                className="px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold bg-violet-100 dark:bg-violet-950/70 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 hover:bg-violet-200 cursor-pointer"
                                title="Vai trò chuyên môn tại Khối Kỹ thuật / Nhà máy (21 CFR Part 11)"
                              >
                                {u.factory_roles.join(", ")}
                              </button>
                            )}
                            {u.permissions && Object.keys(u.permissions).length > 0 && (
                              <span
                                className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                                title="Đã được tùy biến phân quyền riêng theo cá nhân"
                              >
                                Tùy Biến
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Email */}
                        <td className="py-3.5 px-4 text-slate-500 font-mono text-[11px]">
                          {u.email}
                        </td>

                        {/* Status Toggle */}
                        <td className="py-3.5 px-4 text-center">
                          <button
                            onClick={() => handleToggleStatus(u)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all cursor-pointer ${
                              isActive
                                ? "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200"
                                : "bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200"
                            }`}
                            title={isActive ? "Bấm để Tạm Khóa tài khoản" : "Bấm để Mở Khóa tài khoản"}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-emerald-500" : "bg-rose-500"}`} />
                            <span>{isActive ? "Đang Hoạt Động" : "Đang Tạm Khóa"}</span>
                          </button>
                        </td>

                        {/* Actions */}
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleOpenPermissionsModal(u)}
                              className="p-1.5 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 rounded-lg transition-all cursor-pointer"
                              title="Cài đặt phân quyền chi tiết cho nhân sự này"
                            >
                              <ShieldCheck className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleOpenResetPassword(u)}
                              className="p-1.5 text-slate-500 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all cursor-pointer"
                              title="Cấp lại mật khẩu (Reset Password)"
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleOpenUserModal(u)}
                              className="p-1.5 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all cursor-pointer"
                              title="Chỉnh sửa thông tin"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            {u.id !== 1 && (
                              <button
                                onClick={() => handleDeleteUser(u)}
                                className="p-1.5 text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all cursor-pointer"
                                title="Xóa tài khoản"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Role & Permission Matrix Section */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-indigo-500" />
                <h3 className="font-bold text-slate-900 dark:text-white text-sm uppercase">
                  Ma Trận Phân Quyền Vai Trò Hệ Thống (Role &amp; Permission Matrix)
                </h3>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">Kiểm soát truy cập chuẩn RBAC</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700">
                    <th className="py-2.5 px-4">Phân Hệ Nghiệp Vụ</th>
                    <th className="py-2.5 px-4 text-orange-600 dark:text-orange-400 font-bold">Ban Giám Đốc (Director)</th>
                    <th className="py-2.5 px-4 text-indigo-600 dark:text-indigo-400 font-bold">Trưởng Phòng (Manager)</th>
                    <th className="py-2.5 px-4 text-blue-600 dark:text-blue-400 font-bold">Chuyên Viên (Staff)</th>
                    <th className="py-2.5 px-4 text-rose-600 dark:text-rose-400 font-bold">Kế Toán (Accountant)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {PERMISSION_MATRIX.map((m, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="py-2.5 px-4 font-bold text-slate-900 dark:text-white">{m.module}</td>
                      <td className="py-2.5 px-4 font-medium text-slate-700 dark:text-slate-300">
                        <span className="px-2 py-0.5 rounded-md bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-800 font-bold text-[10px]">
                          {m.director}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400">{m.manager}</td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400">{m.staff}</td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400">{m.accountant}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB: PERSONNEL (STAFF DIRECTORY) */}
      {subTab === "personnel" && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                Danh Sách Cán Bộ Nhân Viên ABT ({filteredPersonnel.length}/{personnel.length})
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Quản lý hồ sơ hành chính, phân công chức danh chuẩn theo từng phòng ban và kết nối tài khoản portal.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleDownloadPersonnelTemplate}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
                title="Tải file mẫu Excel chuẩn để nhập danh bạ nhân sự & tài khoản toàn hệ thống"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Tải Mẫu Excel</span>
              </button>

              <button
                type="button"
                disabled={isImportingPersonnelExcel}
                onClick={() => personnelFileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs shadow-emerald-600/20"
                title="Nhập danh bạ nhân sự từ file Excel (.xlsx / .xls)"
              >
                <Upload className={`w-3.5 h-3.5 ${isImportingPersonnelExcel ? "animate-spin" : ""}`} />
                <span>{isImportingPersonnelExcel ? "Đang xử lý..." : "Nạp File Excel"}</span>
              </button>

              <button
                onClick={() => fetchData()}
                className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl transition-all cursor-pointer"
                title="Làm mới danh sách từ PostgreSQL"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </button>
              <button
                onClick={() => setIsResetModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800 rounded-xl text-xs font-bold transition-all cursor-pointer"
                title="Xóa toàn bộ dữ liệu Nhân sự & Tài khoản cũ để nhập lại từ đầu"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Dữ Liệu</span>
              </button>
              <button
                onClick={() => handleOpenPersonnelModal()}
                className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-orange-600 to-orange-800 hover:from-orange-500 hover:to-orange-700 text-white font-bold rounded-xl text-xs shadow-md shadow-orange-600/20 transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ Thêm Nhân Sự Mới</span>
              </button>
            </div>
          </div>

          {/* Filters for Personnel */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={personnelSearchQuery}
                onChange={(e) => setPersonnelSearchQuery(e.target.value)}
                placeholder="Tìm kiếm theo Mã NV, Họ tên, Chức vụ, Email, Số điện thoại..."
                className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
              />
            </div>

            <div className="w-full sm:w-auto">
              <select
                value={selectedPersonnelDeptFilter}
                onChange={(e) => setSelectedPersonnelDeptFilter(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
              >
                <option value="all">-- Tất cả phòng ban ({personnel.length}) --</option>
                {PRIMARY_DEPT_KEYS.map((dept) => {
                  const count = personnel.filter(p => matchDepartment(p.department, dept)).length;
                  return (
                    <option key={dept} value={dept}>
                      {dept} ({count})
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700">
                  <th className="py-3 px-4">Mã NV</th>
                  <th className="py-3 px-4">Họ Và Tên</th>
                  <th className="py-3 px-4">Phòng Ban</th>
                  <th className="py-3 px-4">Vị Trí / Chức Danh</th>
                  <th className="py-3 px-4">Email Công Vụ</th>
                  <th className="py-3 px-4">Số Điện Thoại</th>
                  <th className="py-3 px-4 text-center">Trạng Thái</th>
                  <th className="py-3 px-4 text-center">Tài Khoản Portal</th>
                  <th className="py-3 px-4 text-right">Thao Tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredPersonnel.map((p) => {
                  const linkedUser = users.find(
                    (u) => u?.full_name && p?.full_name && String(u.full_name).trim().toLowerCase() === String(p.full_name).trim().toLowerCase()
                  ) || users.find(
                    (u) => u?.username && p?.employee_code && String(p.employee_code).toLowerCase().replace(/[^a-z0-9]/g, "").includes(String(u.username).toLowerCase().replace(/[^a-z0-9]/g, ""))
                  ) || users.find(
                    (u) => u?.email && p?.email && String(u.email).toLowerCase().trim() === String(p.email).toLowerCase().trim()
                  );

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-orange-600 dark:text-orange-400">{p.employee_code}</td>
                      <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">{p.full_name}</td>
                      <td className="py-3 px-4">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {p.department}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {p.position}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">{p.email}</td>
                      <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">{p.phone}</td>
                      <td className="py-3 px-4 text-center">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                          {p.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {linkedUser ? (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                            <span className={`w-1.5 h-1.5 rounded-full ${linkedUser.is_active !== false ? "bg-emerald-500" : "bg-rose-500"}`} />
                            <span className="font-mono font-bold text-slate-900 dark:text-white text-[11px]">@{linkedUser.username}</span>
                            <span className="text-[9px] px-1 py-0.2 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 rounded-md font-mono">
                              {linkedUser.role}
                            </span>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              const autoRole = inferSystemRoleFromPosition(p.department, p.position);

                              setFormData({
                                id: null,
                                username: p.email ? String(p.email).split("@")[0].replace(/[^a-zA-Z0-9_]/g, "") : `user_${String(p.employee_code || "staff").toLowerCase().replace(/[^a-z0-9]/g, "")}`,
                                password: "password123",
                                full_name: p.full_name || "",
                                role: autoRole,
                                department: p.department || "",
                                email: p.email || "",
                                is_active: true,
                              });
                              setSubTab("users");
                              setIsUserModalOpen(true);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-950/40 dark:to-amber-950/40 hover:from-orange-100 hover:to-orange-200 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-800 rounded-lg text-[10px] font-bold transition-all cursor-pointer shadow-xs"
                            title="Tạo tài khoản đăng nhập portal cho nhân viên này"
                          >
                            <UserPlus className="w-3 h-3" />
                            <span>+ Cấp Tài Khoản</span>
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleOpenPersonnelModal(p)}
                            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-orange-600 rounded-lg transition-colors cursor-pointer"
                            title="Chỉnh sửa thông tin nhân sự"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeletePersonnel(p)}
                            className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-slate-400 hover:text-rose-600 rounded-lg transition-colors cursor-pointer"
                            title="Xóa nhân sự khỏi danh bạ"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUBTAB: DEPARTMENTS & POSITIONS (CƠ CẤU VỊ TRÍ & CHỨC DANH) */}
      {subTab === "departments" && (
        <div className="space-y-6">
          {/* Header & KPI */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <Briefcase className="w-5 h-5 text-orange-500" />
                  <h3 className="font-bold text-slate-900 dark:text-white text-base uppercase">
                    Cơ Cấu Tổ Chức &amp; Danh Mục Vị Trí Chức Danh ABT
                  </h3>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Quy chuẩn 7 phòng ban trọng yếu và 35 vị trí chức danh chuyên trách ngành thiết bị &amp; sinh phẩm chẩn đoán IVD.
                </p>
              </div>

              {/* Department Filter Pills */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => setSelectedOrgDept("all")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    selectedOrgDept === "all"
                      ? "bg-orange-600 text-white shadow-md shadow-orange-600/20"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                  }`}
                >
                  Tất Cả ({PRIMARY_DEPT_KEYS.length})
                </button>
                {PRIMARY_DEPT_KEYS.map((deptKey) => {
                  const d = DEPARTMENT_POSITIONS[deptKey];
                  return (
                    <button
                      key={deptKey}
                      onClick={() => setSelectedOrgDept(deptKey)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        selectedOrgDept === deptKey
                          ? "bg-orange-600 text-white shadow-md shadow-orange-600/20"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                      }`}
                    >
                      {deptKey} ({d?.code || "DEPT"})
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Grid of Departments and their positions */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
              {/* MODE 1: When a specific department is selected, show Left = Positions & Right = Real Staff / Recruitment Roster */}
              {selectedOrgDept !== "all" ? (
                <>
                  {/* Left Column: Department Standard Positions */}
                  {(() => {
                    const deptKey = selectedOrgDept;
                    const deptInfo = getDeptInfoData(deptKey);
                    if (!deptInfo) return null;
                    const staffInDept = personnel.filter(p => matchDepartment(p.department, deptKey));

                    return (
                      <div className="bg-slate-50/70 dark:bg-slate-800/40 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-5 space-y-4 hover:border-orange-500/40 transition-all flex flex-col justify-between">
                        <div className="space-y-3">
                          {/* Department Card Header */}
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-extrabold px-2 py-0.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                                  {deptInfo.code}
                                </span>
                                <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                                  {deptInfo.name}
                                </h4>
                              </div>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                                {deptInfo.desc}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="text-xs font-mono font-black text-orange-600 dark:text-orange-400">
                                {staffInDept.length} nhân sự
                              </span>
                              <div className="text-[10px] text-slate-400">{deptInfo.positions.length} vị trí chuẩn</div>
                            </div>
                          </div>

                          {/* Positions List */}
                          <div className="space-y-2 pt-1">
                            {deptInfo.positions.map((pos: any, pIdx: number) => {
                              const holders = getHoldersForPosition(pos.title, deptKey, deptInfo.positions);

                              const levelColor =
                                pos.level === "Director"
                                  ? "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-400 border-orange-200 dark:border-orange-800"
                                  : pos.level === "Manager"
                                  ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800"
                                  : pos.level === "Specialist"
                                  ? "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400 border-blue-200 dark:border-blue-800"
                                  : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600";

                              return (
                                <div
                                  key={pIdx}
                                  className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800/80 shadow-2xs space-y-2 hover:shadow-xs transition-all group"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-bold text-xs text-slate-900 dark:text-white">
                                        {pos.title}
                                      </span>
                                      <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded-md border ${levelColor}`}>
                                        {pos.level}
                                      </span>
                                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                                        RBAC: {pos.defaultRole}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        onClick={() => handleOpenEditPosition(deptKey, pIdx, pos)}
                                        className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-orange-600 rounded transition-colors cursor-pointer"
                                        title="Chỉnh sửa vị trí chức danh này"
                                      >
                                        <Edit3 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        onClick={() => handleDeletePosition(deptKey, pIdx, pos.title)}
                                        className="p-1 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-slate-300 hover:text-rose-600 rounded transition-colors cursor-pointer"
                                        title="Xóa vị trí chức danh này"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                  {pos.desc && (
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                      {pos.desc}
                                    </p>
                                  )}

                                  <div className="flex items-center justify-between pt-1.5 border-t border-slate-100 dark:border-slate-800/60 flex-wrap gap-2">
                                    <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
                                      <span className="text-slate-400">Đang đảm nhiệm:</span>
                                      {holders.length > 0 ? (
                                        <div className="flex items-center gap-1 flex-wrap">
                                          {holders.map(h => (
                                            <span
                                              key={h.id || h.employee_code}
                                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 font-bold border border-emerald-200 dark:border-emerald-800 text-[10px]"
                                              title={`${h.full_name} (${h.employee_code || "NV"})`}
                                            >
                                              <span>{h.full_name}</span>
                                              <button
                                                onClick={() => handleUnassignStaff(deptKey, pos.title, h.employee_code)}
                                                className="hover:text-rose-600 p-0.5 rounded transition-colors cursor-pointer"
                                                title={`Gỡ cán bộ ${h.full_name} khỏi vị trí ${pos.title}`}
                                              >
                                                <X className="w-2.5 h-2.5" />
                                              </button>
                                            </span>
                                          ))}
                                        </div>
                                      ) : (
                                        <span className="text-slate-400 italic">Chưa có nhân sự</span>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                      <button
                                        onClick={() => handleOpenAppointModal(deptKey, pos.title)}
                                        className="px-2 py-0.5 bg-orange-50 hover:bg-orange-100 dark:bg-orange-950/40 dark:hover:bg-orange-900/60 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-800 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer"
                                        title="Bổ nhiệm nhân viên đang có vào vị trí này (chọn từ danh sách xổ xuống, hỗ trợ kiêm nhiệm)"
                                      >
                                        <UserPlus className="w-3 h-3" />
                                        <span>Bổ nhiệm</span>
                                      </button>
                                      <button
                                        onClick={() => handleOpenPersonnelModal(null, deptKey, pos.title)}
                                        className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center gap-0.5 transition-colors cursor-pointer"
                                        title="Thêm nhân sự mới tuyển dụng"
                                      >
                                        <Plus className="w-2.5 h-2.5" /> Tuyển mới
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Bottom Action for Department */}
                        <div className="pt-3 flex items-center justify-between border-t border-slate-200 dark:border-slate-800 gap-2 flex-wrap">
                          <button
                            onClick={() => handleOpenAddPosition(deptKey)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5 text-orange-600" /> + Thêm Vị Trí Mới
                          </button>
                          <button
                            onClick={() => handleOpenPersonnelModal(null, deptKey)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" /> + Thêm Nhân Sự Vào {deptKey}
                          </button>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Right Column: Actual Personnel Roster & Vacancy Recruitment Plan for this Department */}
                  {(() => {
                    const deptKey = selectedOrgDept;
                    const deptInfo = getDeptInfoData(deptKey);
                    if (!deptInfo) return null;
                    const staffInDept = personnel.filter(p => matchDepartment(p.department, deptKey));
                    const vacantPositions = deptInfo.positions.filter(
                      (pos: any) => getHoldersForPosition(pos.title, deptKey, deptInfo.positions).length === 0
                    );

                    return (
                      <div className="bg-slate-50/70 dark:bg-slate-800/40 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-5 space-y-4 flex flex-col justify-between">
                        <div className="space-y-4">
                          {/* Right Column Header */}
                          <div className="flex items-start justify-between gap-3 border-b border-slate-200/80 dark:border-slate-700/80 pb-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <BadgeCheck className="w-5 h-5 text-emerald-500" />
                                <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                                  Hồ Sơ Nhân Sự Thực Tế &amp; Tình Trạng Lấp Đầy Vị Trí
                                </h4>
                              </div>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                                Cán bộ nhân viên đang công tác tại {deptInfo.name} và kế hoạch tuyển dụng bổ nhiệm.
                              </p>
                            </div>

                            <div className="text-right shrink-0">
                              <span className="text-xs font-mono font-black text-emerald-600 dark:text-emerald-400 block">
                                {staffInDept.length}/{deptInfo.positions.length} Vị Trí Đã Có Người
                              </span>
                              <div className="text-[10px] text-slate-400">
                                {vacantPositions.length} vị trí đang chờ bổ nhiệm
                              </div>
                            </div>
                          </div>

                          {/* Section 1: Existing Staff in this department */}
                          <div className="space-y-2">
                            <div className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                              <span>Cán Bộ Đang Công Tác ({staffInDept.length} Nhân Sự)</span>
                              <span className="text-[10px] text-slate-400 font-normal">Cơ sở dữ liệu PostgreSQL 18</span>
                            </div>

                            {staffInDept.length > 0 ? (
                              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                                {staffInDept.map((p) => {
                                  const linkedUser = users.find(
      (u) => u?.full_name && p?.full_name && String(u.full_name).trim().toLowerCase() === String(p.full_name).trim().toLowerCase()
    ) || users.find(
      (u) => u?.username && p?.employee_code && String(p.employee_code).toLowerCase().replace(/[^a-z0-9]/g, "").includes(String(u.username).toLowerCase().replace(/[^a-z0-9]/g, ""))
    ) || users.find(
      (u) => u?.email && p?.email && String(u.email).toLowerCase().trim() === String(p.email).toLowerCase().trim()
    );

                                  return (
                                    <div
                                      key={p.id}
                                      className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs flex items-center justify-between gap-3"
                                    >
                                      <div className="flex items-center gap-2.5">
                                        <div className="w-8 h-8 rounded-xl bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-400 font-bold flex items-center justify-center text-xs border border-orange-200 dark:border-orange-800 shrink-0">
                                          {(String(p?.full_name || p?.employee_code || "NV")).slice(0, 2).toUpperCase()}
                                        </div>
                                        <div>
                                          <div className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-1.5">
                                            <span>{p.full_name}</span>
                                            <span className="font-mono text-[10px] text-orange-600 dark:text-orange-400">({p.employee_code})</span>
                                          </div>
                                          <div className="text-[11px] text-slate-500 dark:text-slate-400">{p.position}</div>
                                          <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono mt-0.5">
                                            {p.email && <span>{p.email}</span>}
                                            {p.phone && <span>• {p.phone}</span>}
                                          </div>
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-2 shrink-0">
                                        {linkedUser ? (
                                          <span className="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 text-[10px] font-mono font-bold flex items-center gap-1">
                                            <Check className="w-3 h-3" /> @{linkedUser.username}
                                          </span>
                                        ) : (
                                          <button
                                            onClick={() => {
                                              setFormData({
                                                id: null,
                                                username: p.email ? String(p.email).split("@")[0].replace(/[^a-zA-Z0-9_]/g, "") : `user_${String(p?.employee_code || "staff").toLowerCase().replace(/[^a-z0-9]/g, "")}`,
                                                password: "password123",
                                                full_name: p.full_name,
                                                role: "sales_rep",
                                                department: p.department,
                                                email: p.email || "",
                                                is_active: true
                                              });
                                              setSubTab("users");
                                              setIsUserModalOpen(true);
                                            }}
                                            className="px-2 py-1 bg-orange-50 dark:bg-orange-950/50 hover:bg-orange-100 text-orange-600 dark:text-orange-400 rounded-lg text-[10px] font-bold border border-orange-200 dark:border-orange-800 transition-all cursor-pointer"
                                          >
                                            + Cấp Tài Khoản
                                          </button>
                                        )}

                                        <button
                                          onClick={() => handleOpenPersonnelModal(p)}
                                          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-orange-600 rounded-lg transition-colors cursor-pointer"
                                          title="Chỉnh sửa nhân sự"
                                        >
                                          <Edit3 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="p-4 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl text-center space-y-2">
                                <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
                                  <Users className="w-5 h-5" />
                                </div>
                                <div className="text-xs font-bold text-amber-900 dark:text-amber-300">
                                  Chưa có nhân sự nào được bổ nhiệm vào {deptKey}
                                </div>
                                <p className="text-[11px] text-amber-700 dark:text-amber-400 max-w-sm mx-auto">
                                  Toàn bộ {deptInfo.positions.length} vị trí chức danh chuyên trách của phòng ban này đang ở trạng thái chờ tuyển dụng hoặc bổ nhiệm cán bộ phụ trách.
                                </p>
                              </div>
                            )}
                          </div>

                          {/* Section 2: Vacant Positions to Hire / Assign */}
                          <div className="space-y-2 pt-2 border-t border-slate-200/80 dark:border-slate-700/80">
                            <div className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                              <span>Kế Hoạch Bổ Nhiệm &amp; Tuyển Dụng ({vacantPositions.length} Vị Trí Còn Trống)</span>
                              <span className="text-[10px] text-orange-500 font-bold">1 Chạm Bổ Nhiệm</span>
                            </div>

                            <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
                              {vacantPositions.map((vPos: any, vIdx: number) => (
                                <div
                                  key={vIdx}
                                  className="p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 hover:border-orange-500/50 transition-colors"
                                >
                                  <div>
                                    <div className="font-bold text-xs text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                                      <span>{vPos.title}</span>
                                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-mono">
                                        {vPos.level}
                                      </span>
                                    </div>
                                    <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">{vPos.desc}</div>
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                      onClick={() => handleOpenAppointModal(deptKey, vPos.title)}
                                      className="px-2.5 py-1 bg-gradient-to-r from-orange-600 to-orange-800 hover:from-orange-500 hover:to-orange-700 text-white rounded-lg text-[10px] font-bold shadow-xs transition-all cursor-pointer flex items-center gap-1"
                                      title="Bổ nhiệm nhân sự đang có trong công ty vào vị trí này"
                                    >
                                      <UserPlus className="w-3 h-3" />
                                      <span>Bổ Nhiệm</span>
                                    </button>
                                    <button
                                      onClick={() => handleOpenPersonnelModal(null, deptKey, vPos.title)}
                                      className="px-2 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-[10px] font-medium transition-all cursor-pointer"
                                      title="Thêm hồ sơ tuyển dụng mới"
                                    >
                                      Tuyển Mới
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Bottom Action */}
                        <div className="pt-3 flex items-center justify-between border-t border-slate-200 dark:border-slate-800">
                          <span className="text-[11px] text-slate-500">Tuyển dụng nhân sự mới cho phòng này:</span>
                          <button
                            onClick={() => handleOpenPersonnelModal(null, deptKey)}
                            className="flex items-center gap-1 px-3.5 py-1.5 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-bold shadow-sm transition-all cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" /> + Thêm Nhân Sự Vào {deptKey}
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </>
              ) : (
                /* MODE 2: When "Tất Cả" is selected, render all 7 department cards + 1 executive summary card to fill the 8th slot evenly! */
                <>
                  {PRIMARY_DEPT_KEYS.map((deptKey) => {
                    const deptInfo = getDeptInfoData(deptKey);
                    if (!deptInfo) return null;
                    const staffInDept = personnel.filter(p => matchDepartment(p.department, deptKey));

                    return (
                      <div
                        key={deptKey}
                        className="bg-slate-50/70 dark:bg-slate-800/40 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-5 space-y-4 hover:border-orange-500/40 transition-all flex flex-col justify-between"
                      >
                        <div className="space-y-3">
                          {/* Department Card Header */}
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-extrabold px-2 py-0.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                                  {deptInfo.code}
                                </span>
                                <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                                  {deptInfo.name}
                                </h4>
                              </div>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                                {deptInfo.desc}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="text-xs font-mono font-black text-orange-600 dark:text-orange-400">
                                {staffInDept.length} nhân sự
                              </span>
                              <div className="text-[10px] text-slate-400">{deptInfo.positions.length} vị trí chuẩn</div>
                            </div>
                          </div>

                          {/* Positions List */}
                          <div className="space-y-2 pt-1">
                            {deptInfo.positions.map((pos: any, pIdx: number) => {
                              const holders = getHoldersForPosition(pos.title, deptKey, deptInfo.positions);

                              const levelColor =
                                pos.level === "Director"
                                  ? "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-400 border-orange-200 dark:border-orange-800"
                                  : pos.level === "Manager"
                                  ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800"
                                  : pos.level === "Specialist"
                                  ? "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400 border-blue-200 dark:border-blue-800"
                                  : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600";

                              return (
                                <div
                                  key={pIdx}
                                  className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800/80 shadow-2xs space-y-2 hover:shadow-xs transition-all group"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-bold text-xs text-slate-900 dark:text-white">
                                        {pos.title}
                                      </span>
                                      <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded-md border ${levelColor}`}>
                                        {pos.level}
                                      </span>
                                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                                        RBAC: {pos.defaultRole}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        onClick={() => handleOpenEditPosition(deptKey, pIdx, pos)}
                                        className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-orange-600 rounded transition-colors cursor-pointer"
                                        title="Chỉnh sửa vị trí chức danh này"
                                      >
                                        <Edit3 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        onClick={() => handleDeletePosition(deptKey, pIdx, pos.title)}
                                        className="p-1 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-slate-300 hover:text-rose-600 rounded transition-colors cursor-pointer"
                                        title="Xóa vị trí chức danh này"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                  {pos.desc && (
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                      {pos.desc}
                                    </p>
                                  )}

                                  <div className="flex items-center justify-between pt-1.5 border-t border-slate-100 dark:border-slate-800/60 flex-wrap gap-2">
                                    <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
                                      <span className="text-slate-400">Đang đảm nhiệm:</span>
                                      {holders.length > 0 ? (
                                        <div className="flex items-center gap-1 flex-wrap">
                                          {holders.map(h => (
                                            <span
                                              key={h.id || h.employee_code}
                                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 font-bold border border-emerald-200 dark:border-emerald-800 text-[10px]"
                                              title={`${h.full_name} (${h.employee_code || "NV"})`}
                                            >
                                              <span>{h.full_name}</span>
                                              <button
                                                onClick={() => handleUnassignStaff(deptKey, pos.title, h.employee_code)}
                                                className="hover:text-rose-600 p-0.5 rounded transition-colors cursor-pointer"
                                                title={`Gỡ cán bộ ${h.full_name} khỏi vị trí ${pos.title}`}
                                              >
                                                <X className="w-2.5 h-2.5" />
                                              </button>
                                            </span>
                                          ))}
                                        </div>
                                      ) : (
                                        <span className="text-slate-400 italic">Chưa có nhân sự</span>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                      <button
                                        onClick={() => handleOpenAppointModal(deptKey, pos.title)}
                                        className="px-2 py-0.5 bg-orange-50 hover:bg-orange-100 dark:bg-orange-950/40 dark:hover:bg-orange-900/60 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-800 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer"
                                        title="Bổ nhiệm nhân viên đang có vào vị trí này (chọn từ danh sách xổ xuống, hỗ trợ kiêm nhiệm)"
                                      >
                                        <UserPlus className="w-3 h-3" />
                                        <span>Bổ nhiệm</span>
                                      </button>
                                      <button
                                        onClick={() => handleOpenPersonnelModal(null, deptKey, pos.title)}
                                        className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center gap-0.5 transition-colors cursor-pointer"
                                        title="Thêm nhân sự mới tuyển dụng"
                                      >
                                        <Plus className="w-2.5 h-2.5" /> Tuyển mới
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Bottom Quick Action for Department */}
                        <div className="pt-3 flex items-center justify-between border-t border-slate-200 dark:border-slate-800 gap-2 flex-wrap">
                          <button
                            onClick={() => handleOpenAddPosition(deptKey)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5 text-orange-600" /> + Thêm Vị Trí Mới
                          </button>
                          <button
                            onClick={() => handleOpenPersonnelModal(null, deptKey)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" /> + Thêm Vào Phòng Này
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {/* 8th Slot: Executive Workforce & Organization Summary Card to fill the grid evenly! */}
                  <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl border border-indigo-800/60 p-6 space-y-5 flex flex-col justify-between shadow-xl">
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-3 border-b border-indigo-800/60 pb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <Layers className="w-5 h-5 text-orange-400" />
                            <h4 className="font-bold text-white text-sm uppercase tracking-wide">
                              Tổng Hợp Định Biên Tổ Chức ABT
                            </h4>
                          </div>
                          <p className="text-[11px] text-slate-300 mt-1">
                            Báo cáo ma trận phân bổ định biên nhân sự toàn bộ 7 phân hệ chuyên trách công ty ABT.
                          </p>
                        </div>
                        <span className="px-2 py-0.5 rounded-lg bg-orange-500/20 text-orange-400 border border-orange-500/30 text-[10px] font-mono font-bold">
                          Toàn Công Ty
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                          <div className="text-[10px] text-slate-400 uppercase font-bold">Quy Chuẩn Phòng Ban</div>
                          <div className="text-xl font-black font-mono text-orange-400 mt-0.5">7 Phòng Ban</div>
                          <div className="text-[10px] text-slate-400">100% chuyên trách IVD</div>
                        </div>

                        <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                          <div className="text-[10px] text-slate-400 uppercase font-bold">Định Biên Vị Trí</div>
                          <div className="text-xl font-black font-mono text-white mt-0.5">35 Chức Danh</div>
                          <div className="text-[10px] text-slate-400">Phân cấp 4 bậc chuẩn</div>
                        </div>

                        <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                          <div className="text-[10px] text-slate-400 uppercase font-bold">Nhân Sự Hiện Hữu</div>
                          <div className="text-xl font-black font-mono text-emerald-400 mt-0.5">{personnel.length} Cán Bộ</div>
                          <div className="text-[10px] text-emerald-400">Lưu trữ PostgreSQL 18</div>
                        </div>

                        <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                          <div className="text-[10px] text-slate-400 uppercase font-bold">Tài Khoản Portal</div>
                          <div className="text-xl font-black font-mono text-cyan-400 mt-0.5">{users.length} Tài Khoản</div>
                          <div className="text-[10px] text-cyan-400">Đã phân quyền RBAC</div>
                        </div>
                      </div>

                      <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-2">
                        <div className="text-xs font-bold text-slate-200">Cơ Cấu Cấp Bậc Toàn Doanh Nghiệp:</div>
                        <div className="grid grid-cols-4 gap-2 text-center text-xs">
                          <div className="p-2 rounded-lg bg-orange-950/60 border border-orange-800/60">
                            <div className="text-orange-400 font-bold font-mono">3</div>
                            <div className="text-[9px] text-slate-400">Director</div>
                          </div>
                          <div className="p-2 rounded-lg bg-indigo-950/60 border border-indigo-800/60">
                            <div className="text-indigo-400 font-bold font-mono">8</div>
                            <div className="text-[9px] text-slate-400">Manager</div>
                          </div>
                          <div className="p-2 rounded-lg bg-blue-950/60 border border-blue-800/60">
                            <div className="text-blue-400 font-bold font-mono">15</div>
                            <div className="text-[9px] text-slate-400">Specialist</div>
                          </div>
                          <div className="p-2 rounded-lg bg-slate-800/60 border border-slate-700/60">
                            <div className="text-slate-300 font-bold font-mono">9</div>
                            <div className="text-[9px] text-slate-400">Staff</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 flex items-center justify-between border-t border-indigo-800/60">
                      <button
                        onClick={() => setSubTab("personnel")}
                        className="text-xs text-orange-400 hover:text-orange-300 font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <span>Xem Danh Bạ Nhân Sự</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleOpenPersonnelModal()}
                        className="px-4 py-2 bg-gradient-to-r from-orange-600 to-orange-800 hover:from-orange-500 hover:to-orange-700 text-white rounded-xl text-xs font-bold shadow-md shadow-orange-600/30 transition-all cursor-pointer flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" /> + Thêm Nhân Sự Mới
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB: AUDIT LOGS */}
      {subTab === "audit" && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          <h3 className="font-bold text-slate-900 dark:text-white text-sm">Nhật Ký Thao Tác Hệ Thống (Audit Trail - PostgreSQL 18)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700">
                  <th className="py-3 px-4">Thời Gian</th>
                  <th className="py-3 px-4">Hành Động</th>
                  <th className="py-3 px-4">Phân Hệ</th>
                  <th className="py-3 px-4">Chi Tiết Thao Tác</th>
                  <th className="py-3 px-4">Người Thực Hiện</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {logs.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4 text-slate-400 whitespace-nowrap font-mono text-[11px]">{formatDate(l.created_at)}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-50 dark:bg-orange-950 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-blue-800 font-mono">
                        {l.action}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">{l.module}</td>
                    <td className="py-3 px-4 text-slate-900 dark:text-white">{l.details}</td>
                    <td className="py-3 px-4 font-medium text-slate-600 dark:text-slate-400">{l.actor_name || l.actor_username}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUBTAB: TÀI CHÍNH (phương thức thanh toán) */}
      {subTab === "finance" && <PaymentMethodsSettings />}

      {/* SUBTAB: NOTIFICATION MATRIX (CÀI ĐẶT MA TRẬN THÔNG BÁO) */}
      {subTab === "notifications" && (
        <div className="space-y-6">
          {/* Top Header Card */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-orange-500/10 text-orange-500 border border-orange-500/20 flex items-center justify-center shrink-0">
                <Bell className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  Cấu Hình Ma Trận Thông Báo Hoạt Động
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-400 border border-orange-200 dark:border-orange-800">
                    Real-time Matrix
                  </span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
                  Chủ động bật/tắt gửi thông báo cho từng sự kiện hoạt động trong doanh nghiệp, cấu hình nhóm vai trò (Roles) hoặc chọn đích danh nhân sự cụ thể nhận thông báo chuông và popup toast.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleResetMatrix}
                className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                title="Khôi phục về cấu hình tiêu chuẩn ban đầu"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Khôi Phục Mặc Định
              </button>
              <button
                onClick={handleSaveMatrix}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-xs cursor-pointer ${
                  hasMatrixChanges
                    ? "bg-orange-600 hover:bg-orange-700 text-white animate-bounce shadow-orange-600/30"
                    : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20"
                }`}
              >
                <Save className="w-4 h-4" /> {hasMatrixChanges ? "Lưu Thay Đổi (Chưa Lưu)" : "Đã Lưu Toàn Bộ"}
              </button>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-[11px] font-bold text-slate-400 uppercase block">Tổng Số Hoạt Động</span>
              <span className="text-2xl font-black font-mono text-slate-900 dark:text-white mt-1 block">
                {Object.keys(localMatrix).length}
              </span>
              <span className="text-[10px] text-slate-500">Phủ sóng 7 phân hệ</span>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-[11px] font-bold text-emerald-500 uppercase block">Đang Kích Hoạt (Bật)</span>
              <span className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1 block">
                {Object.values(localMatrix).filter(e => e.enabled !== false).length}
              </span>
              <span className="text-[10px] text-slate-500">Phát tín hiệu real-time</span>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-[11px] font-bold text-rose-500 uppercase block">Đã Tắt (Muted)</span>
              <span className="text-2xl font-black font-mono text-rose-600 dark:text-rose-400 mt-1 block">
                {Object.values(localMatrix).filter(e => e.enabled === false).length}
              </span>
              <span className="text-[10px] text-slate-500">Không gửi thông báo</span>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-[11px] font-bold text-indigo-500 uppercase block">Có Gán Nhân Sự Riêng</span>
              <span className="text-2xl font-black font-mono text-indigo-600 dark:text-indigo-400 mt-1 block">
                {Object.values(localMatrix).filter(e => e.targetEmployeeIds && e.targetEmployeeIds.length > 0).length}
              </span>
              <span className="text-[10px] text-slate-500">Chỉ định đích danh</span>
            </div>
          </div>

          {/* Filter & Search Bar */}
          <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 max-w-md bg-slate-50 dark:bg-slate-800/80 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700">
              <Search className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                type="text"
                placeholder="Tìm hoạt động, phân hệ, từ khóa..."
                value={matrixSearch}
                onChange={(e) => setMatrixSearch(e.target.value)}
                className="bg-transparent border-none text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden w-full"
              />
              {matrixSearch && (
                <button onClick={() => setMatrixSearch("")} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center flex-wrap gap-1.5 text-xs font-semibold">
              {[
                { id: "all", label: "Tất cả" },
                { id: "sales", label: "Kinh Doanh" },
                { id: "warehouse", label: "Kho Vận" },
                { id: "procurement", label: "Mua Hàng" },
                { id: "application", label: "Lab & App" },
                { id: "workspace", label: "Công Việc" },
                { id: "finance", label: "Tài Chính" },
                { id: "quality", label: "QA/QC" },
                { id: "technical", label: "Khối Kỹ thuật" }
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => setMatrixCategoryFilter(f.id)}
                  className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                    matrixCategoryFilter === f.id || (f.id === "technical" && matrixCategoryFilter.startsWith("technical:"))
                      ? "bg-orange-500 text-white font-bold shadow-xs"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Khối Kỹ thuật: one chip per department */}
          {matrixCategoryFilter.startsWith("technical") && (
            <div className="flex items-center flex-wrap gap-1.5 text-xs font-semibold -mt-2">
              <span className="text-[11px] text-slate-400 mr-1">Phòng:</span>
              {[...new Set(FACTORY_NOTICE_EVENTS.map((e) => e.dept))].map((dept) => {
                const id = `technical:${dept}`;
                const count = FACTORY_NOTICE_EVENTS.filter((e) => e.dept === dept).length;
                return (
                  <button
                    key={id}
                    onClick={() => setMatrixCategoryFilter(matrixCategoryFilter === id ? "technical" : id)}
                    className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer border ${
                      matrixCategoryFilter === id
                        ? "bg-teal-600 text-white border-teal-600"
                        : "bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800 hover:bg-teal-50 dark:hover:bg-teal-950/40"
                    }`}
                  >
                    {dept} ({count})
                  </button>
                );
              })}
            </div>
          )}

          {/* Matrix Event Cards List */}
          <div className="space-y-3">
            {matrixEventsList.map((ev: NotificationMatrixEvent) => {
              const isEnabled = ev.enabled !== false;
              const hasSpecificPersonnel = ev.targetEmployeeIds && ev.targetEmployeeIds.length > 0;
              const isExpanded = expandedPersonnelEvent === ev.key;

              return (
                <div
                  key={ev.key}
                  className={`p-5 rounded-2xl border transition-all ${
                    isEnabled
                      ? "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-xs hover:border-orange-500/40"
                      : "bg-slate-50/70 dark:bg-slate-900/40 border-slate-200/60 dark:border-slate-800/50 opacity-75"
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800/80">
                    <div className="flex items-start gap-3.5">
                      {/* Big Toggle Switch */}
                      <button
                        onClick={() => handleToggleEventEnabled(ev.key)}
                        className={`mt-0.5 shrink-0 transition-transform active:scale-95 cursor-pointer`}
                        title={isEnabled ? "Bấm để tắt gửi thông báo" : "Bấm để bật thông báo"}
                      >
                        {isEnabled ? (
                          <div className="w-12 h-6 rounded-full bg-emerald-500 p-0.5 flex items-center justify-end transition-colors shadow-xs">
                            <div className="w-5 h-5 rounded-full bg-white shadow-xs" />
                          </div>
                        ) : (
                          <div className="w-12 h-6 rounded-full bg-slate-300 dark:bg-slate-700 p-0.5 flex items-center justify-start transition-colors">
                            <div className="w-5 h-5 rounded-full bg-white shadow-xs" />
                          </div>
                        )}
                      </button>

                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className={`text-sm font-bold ${isEnabled ? "text-slate-900 dark:text-white" : "text-slate-500 dark:text-slate-400 line-through"}`}>
                            {ev.name}
                          </h4>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            ev.category === "sales" ? "bg-blue-500/10 text-blue-600 border-blue-500/20" :
                            ev.category === "warehouse" ? "bg-amber-500/10 text-amber-600 border-amber-500/20" :
                            ev.category === "procurement" ? "bg-cyan-500/10 text-cyan-600 border-cyan-500/20" :
                            ev.category === "application" ? "bg-purple-500/10 text-purple-600 border-purple-500/20" :
                            ev.category === "finance" ? "bg-rose-500/10 text-rose-600 border-rose-500/20" :
                            ev.category === "quality" ? "bg-teal-500/10 text-teal-600 border-teal-500/20" :
                            ev.category === "technical" ? "bg-slate-500/10 text-teal-700 dark:text-teal-300 border-teal-500/40" :
                            "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                          }`}>
                            {ev.categoryLabel}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            isEnabled
                              ? "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700"
                          }`}>
                            {isEnabled ? "🟢 Bật thông báo" : "⚪ Đã tạm tắt"}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                          {ev.description}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 self-end lg:self-center">
                      {/* Toast Toggle */}
                      <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 font-medium cursor-pointer">
                        <input
                          type="checkbox"
                          checked={ev.enableToast !== false}
                          onChange={() => handleToggleEventToast(ev.key)}
                          className="rounded text-orange-500 focus:ring-orange-400 w-3.5 h-3.5 cursor-pointer"
                        />
                        <span className="text-[11px]">Bật popup Toast</span>
                      </label>

                      {/* Test Trigger Button */}
                      <button
                        onClick={() => testTriggerNotification(ev.key)}
                        className="px-3 py-1.5 rounded-xl border border-orange-200 dark:border-orange-800/80 bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/60 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                        title="Bấm để phát một thông báo thử nghiệm ngay lập tức"
                      >
                        <Bell className="w-3.5 h-3.5" /> Gửi Thử Nghiệm
                      </button>
                    </div>
                  </div>

                  {/* Matrix Configuration: Roles & Specific Personnel */}
                  <div className="pt-3.5 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Roles Configuration */}
                    <div className="space-y-1.5">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                        1. Nhóm Vai Trò Nhận Thông Báo ({ev.targetRoles?.length || 0})
                      </span>
                      <div className="flex items-center flex-wrap gap-1.5">
                        {/* factory events reach BGĐ + technical groups (server-side); portal events the portal groups */}
                        {MATRIX_ROLES.filter((role) => role.code === "admin" || (ev.category === "technical") === role.code.startsWith("factory_")).map(role => {
                          const isSelected = (ev.targetRoles || []).includes(role.code);
                          return (
                            <button
                              key={role.code}
                              onClick={() => handleToggleEventRole(ev.key, role.code)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                                isSelected
                                  ? `${role.color} border-current shadow-2xs`
                                  : "bg-slate-100 dark:bg-slate-800 text-slate-400 border-transparent hover:border-slate-300 dark:hover:border-slate-700"
                              }`}
                              title={role.label}
                            >
                              {isSelected ? `✓ ${role.short}` : `+ ${role.short}`}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Specific Personnel Configuration */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                          2. Nhân Sự Đích Danh ({ev.targetEmployeeIds?.length || 0})
                        </span>
                        <button
                          onClick={() => setExpandedPersonnelEvent(isExpanded ? null : ev.key)}
                          className="text-[11px] font-bold text-orange-600 dark:text-orange-400 hover:underline cursor-pointer flex items-center gap-1"
                        >
                          {isExpanded ? "Đóng chọn nhân sự" : "+ Thêm nhân sự cụ thể"}
                        </button>
                      </div>

                      {/* Display assigned personnel chips */}
                      <div className="flex items-center flex-wrap gap-1.5 min-h-[28px]">
                        {!hasSpecificPersonnel ? (
                          <span className="text-[11px] text-slate-400 italic">
                            Chưa gán riêng (Mặc định áp dụng theo nhóm Vai trò ở trên)
                          </span>
                        ) : (
                          ev.targetEmployeeIds.map((empId: string, idx: number) => {
                            const empName = ev.targetEmployeeNames?.[idx] || empId;
                            return (
                              <span
                                key={empId}
                                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                              >
                                {empName}
                                <button
                                  onClick={() => handleToggleEventPersonnel(ev.key, { employee_id: empId, full_name: empName })}
                                  className="text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-100 ml-0.5"
                                >
                                  ×
                                </button>
                              </span>
                            );
                          })
                        )}
                      </div>

                      {/* Expanded Picker for Personnel */}
                      {isExpanded && (
                        <div className="p-3 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700 mt-2 space-y-2">
                          <span className="text-[11px] font-bold text-slate-500 block">
                            Chọn nhân sự từ Danh Bạ để nhận thông báo cho sự kiện này:
                          </span>
                          <div className="max-h-40 overflow-y-auto space-y-1 pr-1 text-xs">
                            {notifPersonnelList.map(p => {
                              const isChecked = (ev.targetEmployeeIds || []).includes(p.employee_id);
                              return (
                                <label
                                  key={p.employee_id}
                                  className={`flex items-center justify-between p-1.5 rounded-lg cursor-pointer transition-colors ${
                                    isChecked
                                      ? "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-bold"
                                      : "hover:bg-slate-100 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-300"
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => handleToggleEventPersonnel(ev.key, p)}
                                      className="rounded text-indigo-600 focus:ring-indigo-400 w-3.5 h-3.5"
                                    />
                                    <span>{p.full_name}</span>
                                    <span className="text-[10px] text-slate-400">({p.department})</span>
                                  </div>
                                  <span className="text-[10px] text-slate-400 font-mono">{p.employee_id}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MODAL: CREATE / EDIT USER */}
      {isUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-lg shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Key className="w-5 h-5 text-orange-500" />
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  {formData.id ? "Cập Nhật Thông Tin Tài Khoản" : "Tạo Mới Tài Khoản Người Dùng"}
                </h3>
              </div>
              <button
                onClick={() => setIsUserModalOpen(false)}
                className="p-1 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="space-y-4">
              {/* Quick Link from Personnel Directory */}
              {!formData.id && (
                <div className="p-3 bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/60 rounded-2xl space-y-1.5">
                  <label className="text-xs font-bold text-indigo-900 dark:text-indigo-300 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Link2 className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Liên Kết Nhanh Từ Danh Bạ Nhân Sự</span>
                    </span>
                    <span className="text-[10px] text-indigo-500 font-normal">Tự động điền họ tên, email, phòng ban</span>
                  </label>
                  <select
                    onChange={(e) => {
                      const selectedCode = e.target.value;
                      if (!selectedCode) return;
                      const emp = personnel.find((p) => p.employee_code === selectedCode);
                      if (emp) {
                        const autoRole = inferSystemRoleFromPosition(emp.department, emp.position);

                        setFormData({
                          ...formData,
                          full_name: emp.full_name,
                          email: emp.email || "",
                          department: emp.department,
                          username: emp.email ? String(emp.email).split("@")[0].replace(/[^a-zA-Z0-9_]/g, "") : `user_${String(emp?.employee_code || "staff").toLowerCase().replace(/[^a-z0-9]/g, "")}`,
                          role: autoRole,
                        });
                      }
                    }}
                    defaultValue=""
                    className="w-full px-3 py-1.5 bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-700/60 rounded-xl text-xs text-slate-800 dark:text-slate-200"
                  >
                    <option value="">-- Chọn nhân sự từ danh bạ để liên kết --</option>
                    {personnel.map((p) => {
                      const hasAccount = users.some(
                        (u) =>
                          (u?.email && p?.email && String(u.email).toLowerCase().trim() === String(p.email).toLowerCase().trim()) || (u?.full_name && p?.full_name && String(u.full_name).toLowerCase().trim() === String(p.full_name).toLowerCase().trim())
                      );
                      return (
                        <option key={p.id} value={p.employee_code}>
                          {p.employee_code} - {p.full_name} ({p.department} - {p.position}) {hasAccount ? " [Đã có tài khoản]" : " [Chưa cấp tài khoản]"}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Tên Đăng Nhập (Username)</label>
                  <input
                    type="text"
                    disabled={!!formData.id}
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    placeholder="ví dụ: sales_rep2"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white disabled:opacity-60"
                    required
                  />
                </div>

                {!formData.id && (
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Mật Khẩu Khởi Tạo</label>
                    <input
                      type="text"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      placeholder="password123"
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                      required
                    />
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Họ Và Tên Cán Bộ</label>
                <input
                  type="text"
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  placeholder="ví dụ: Nguyễn Văn An"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Email Công Ty</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="nguyenvanan@abtvn.com"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Phòng Ban</label>
                  <select
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                  >
                    {PRIMARY_DEPT_KEYS.map((dept) => (
                      <option key={dept} value={dept}>{dept}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Vai Trò Hệ Thống</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                  >
                    <optgroup label="👑 Ban Giám Đốc">
                      <option value="admin">Tổng Giám Đốc / Phó Giám Đốc (admin)</option>
                    </optgroup>
                    <optgroup label="🔬 Khối Kỹ Thuật, R&D & Nhà Máy">
                      <option value="rd_head">Trưởng Phòng Nghiên Cứu R&amp;D (rd_head)</option>
                      <option value="rd_staff">Chuyên Viên Nghiên Cứu R&amp;D (rd_staff)</option>
                      <option value="kit_head">Trưởng Phòng Sản Xuất Kit (kit_head)</option>
                      <option value="kit_staff">Kỹ Thuật Viên Sản Xuất Kit (kit_staff)</option>
                      <option value="oligo_head">Trưởng Phòng Tổng Hợp Oligo (oligo_head)</option>
                      <option value="oligo_staff">Kỹ Thuật Viên Tổng Hợp Oligo (oligo_staff)</option>
                      <option value="device_head">Trưởng Phòng Kỹ Thuật – Thiết Bị (device_head)</option>
                      <option value="device_staff">Kỹ Sư Chế Tạo &amp; Bảo Trì Thiết Bị (device_staff)</option>
                    </optgroup>
                    <optgroup label="🧬 Kỹ Thuật & Ứng Dụng (Application)">
                      <option value="app_head">Trưởng Phòng Kỹ Thuật &amp; Ứng Dụng (app_head)</option>
                      <option value="app_rep">Kỹ Sư Ứng Dụng / Kỹ Sư Dịch Vụ (app_rep)</option>
                    </optgroup>
                    <optgroup label="🛡️ Quản Lý Chất Lượng (QA/QC)">
                      <option value="qa_qc_lead">Trưởng Bộ Phận QA/QC (qa_qc_lead)</option>
                      <option value="qa_qc">Chuyên Viên QA/QC &amp; ISO 13485 (qa_qc)</option>
                    </optgroup>
                    <optgroup label="💼 Khối Kinh Doanh, PM & Marketing">
                      <option value="sales_head">Trưởng / Phó Phòng Kinh Doanh (sales_head)</option>
                      <option value="sales_rep">Chuyên Viên KD / PM / Sales Admin / Marketing (sales_rep)</option>
                    </optgroup>
                    <optgroup label="📦 Bộ Phận Kho Vận">
                      <option value="warehouse_lead">Trưởng Bộ Phận Kho Vận (warehouse_lead)</option>
                      <option value="warehouse">Thủ Kho / NV Giao Nhận Chuỗi Lạnh (warehouse)</option>
                    </optgroup>
                    <optgroup label="🛒 Mua Hàng & Cung Ứng">
                      <option value="procurement_lead">Trưởng Bộ Phận Cung Ứng (procurement_lead)</option>
                      <option value="procurement_specialist">Chuyên Viên Mua Hàng (procurement_specialist)</option>
                    </optgroup>
                    <optgroup label="💰 Phòng Kế Toán">
                      <option value="accountant_head">Kế Toán Trưởng (accountant_head)</option>
                      <option value="accountant">Chuyên Viên Kế Toán Kho &amp; Công Nợ (accountant)</option>
                    </optgroup>
                    <optgroup label="⚖️ Bộ Phận Pháp Chế">
                      <option value="legal_head">Trưởng Bộ Phận Pháp Chế (legal_head)</option>
                      <option value="legal">Chuyên Viên Pháp Chế &amp; Tuân Thủ (legal)</option>
                    </optgroup>
                  </select>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsUserModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold rounded-xl text-xs"
                >
                  Hủy Bỏ
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-xl text-xs shadow-md transition-all cursor-pointer"
                >
                  Lưu Vào PostgreSQL
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: RESET PASSWORD */}
      {isResetPasswordModalOpen && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-md shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-amber-500" />
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  Cấp Lại Mật Khẩu Mới
                </h3>
              </div>
              <button
                onClick={() => setIsResetPasswordModalOpen(false)}
                className="p-1 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl text-xs border border-slate-200 dark:border-slate-800">
              <div className="text-slate-500">Tài khoản:</div>
              <div className="font-bold text-slate-900 dark:text-white font-mono text-sm">{selectedUser.username}</div>
              <div className="text-slate-400">{selectedUser.full_name} ({selectedUser.department})</div>
            </div>

            <form onSubmit={handleSaveResetPassword} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Mật Khẩu Mới</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Nhập mật khẩu mới..."
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Xác Nhận Mật Khẩu</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Nhập lại mật khẩu mới..."
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsResetPasswordModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold rounded-xl text-xs"
                >
                  Hủy Bỏ
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl text-xs shadow-md transition-all cursor-pointer"
                >
                  Cập Nhật Mật Khẩu
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CREATE / EDIT PERSONNEL (HỒ SƠ NHÂN SỰ & VỊ TRÍ CHỨC DANH) */}
      {isPersonnelModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-lg shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-orange-500" />
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  {personnelFormData.id ? "Cập Nhật Hồ Sơ Nhân Sự" : "Thêm Mới Cán Bộ Nhân Sự ABT"}
                </h3>
              </div>
              <button
                onClick={() => setIsPersonnelModalOpen(false)}
                className="p-1 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSavePersonnel} className="space-y-4">
              {/* Phòng Ban & Chức Danh Liên Thông */}
              <div className="p-3 bg-orange-50/60 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800/60 rounded-2xl space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-orange-900 dark:text-orange-300">
                  <Briefcase className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                  <span>Phòng Ban &amp; Vị Trí Chức Danh Chuyên Trách</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Phòng Ban Công Tác</label>
                    <select
                      value={personnelFormData.department}
                      onChange={(e) => {
                        const newDept = e.target.value;
                        const availablePos = getDeptInfo(newDept)?.positions || [];
                        setPersonnelFormData({
                          ...personnelFormData,
                          department: newDept,
                          position: availablePos[0]?.title || "Chuyên Viên Kinh Doanh (Senior/Junior)"
                        });
                      }}
                      className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                      required
                    >
                      {PRIMARY_DEPT_KEYS.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept} ({DEPARTMENT_POSITIONS[dept]?.code || "DEPT"})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Vị Trí / Chức Danh</label>
                    <select
                      value={personnelFormData.position}
                      onChange={(e) => setPersonnelFormData({ ...personnelFormData, position: e.target.value })}
                      className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                      required
                    >
                      {(getDeptInfo(personnelFormData.department)?.positions || []).map((pos, idx) => (
                        <option key={idx} value={pos.title}>
                          [{pos.level}] {pos.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Selected position description */}
                {(() => {
                  const currentPos = getDeptInfo(personnelFormData.department)?.positions.find(
                    (p) => p.title === personnelFormData.position
                  );
                  if (!currentPos) return null;
                  return (
                    <div className="text-[11px] text-slate-600 dark:text-slate-400 bg-white/80 dark:bg-slate-900/60 p-2.5 rounded-xl border border-orange-100 dark:border-orange-900/40 space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-bold">
                        <span className="text-orange-700 dark:text-orange-400">Trách nhiệm chính:</span>
                        <span className="font-mono text-slate-500">Vai trò đề xuất: {currentPos.defaultRole}</span>
                      </div>
                      <p>{currentPos.desc}</p>
                    </div>
                  );
                })()}
              </div>

              {/* Thông tin nhân sự */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Họ Và Tên</label>
                  <input
                    type="text"
                    value={personnelFormData.full_name}
                    onChange={(e) => {
                      const name = e.target.value;
                      // Generate suggested email if creating new
                      const cleanName = name
                        .toLowerCase()
                        .normalize("NFD")
                        .replace(/[\u0300-\u036f]/g, "")
                        .replace(/[^a-z0-9 ]/g, "")
                        .trim()
                        .split(" ");
                      const suggestedEmail = cleanName.length > 1
                        ? `${cleanName[cleanName.length - 1]}.${cleanName.slice(0, -1).map(w => w[0]).join("")}@abtvn.com`
                        : `${cleanName[0] || ""}@abtvn.com`;

                      setPersonnelFormData({
                        ...personnelFormData,
                        full_name: name,
                        email: personnelFormData.id ? personnelFormData.email : suggestedEmail
                      });
                    }}
                    placeholder="ví dụ: Nguyễn Văn Hải"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Mã Nhân Viên (Code)</label>
                  <input
                    type="text"
                    value={personnelFormData.employee_code}
                    onChange={(e) => setPersonnelFormData({ ...personnelFormData, employee_code: e.target.value })}
                    placeholder="NV-ABT-012"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Email Công Vụ</label>
                  <input
                    type="email"
                    value={personnelFormData.email}
                    onChange={(e) => setPersonnelFormData({ ...personnelFormData, email: e.target.value })}
                    placeholder="hai.nv@abtvn.com"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Số Điện Thoại</label>
                  <input
                    type="text"
                    value={personnelFormData.phone}
                    onChange={(e) => setPersonnelFormData({ ...personnelFormData, phone: e.target.value })}
                    placeholder="0901234567"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Trạng Thái Làm Việc</label>
                <select
                  value={personnelFormData.status}
                  onChange={(e) => setPersonnelFormData({ ...personnelFormData, status: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                >
                  <option value="ACTIVE">ACTIVE (Đang làm việc chính thức)</option>
                  <option value="PROBATION">PROBATION (Đang thử việc)</option>
                  <option value="ON_LEAVE">ON_LEAVE (Tạm nghỉ chế độ / công tác)</option>
                  <option value="RESIGNED">RESIGNED (Đã thôi việc)</option>
                </select>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsPersonnelModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold rounded-xl text-xs cursor-pointer"
                >
                  Hủy Bỏ
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-xl text-xs shadow-md shadow-orange-600/20 transition-all cursor-pointer"
                >
                  Lưu Hồ Sơ Nhân Sự
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 1: CHỈNH SỬA / THÊM VỊ TRÍ CHỨC DANH */}
      {posModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-orange-100 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400">
                  <Briefcase className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">
                    {posModal.posIndex !== null ? "Chỉnh Sửa Vị Trí Chức Danh" : "Thêm Vị Trí Chức Danh Mới"}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Phòng ban: <span className="font-bold text-orange-600 dark:text-orange-400">{posModal.deptKey}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPosModal(prev => ({ ...prev, isOpen: false }))}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePosition} className="p-5 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Tên Vị Trí Chức Danh <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={posModal.title}
                  onChange={(e) => setPosModal({ ...posModal, title: e.target.value })}
                  placeholder="ví dụ: Chuyên Viên Pháp Chế & Hợp Đồng Thầu"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white font-medium"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Cấp Bậc Quản Lý</label>
                  <select
                    value={posModal.level}
                    onChange={(e) => setPosModal({ ...posModal, level: e.target.value as any })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                  >
                    <option value="Director">Director (Ban Giám Đốc / Khối)</option>
                    <option value="Manager">Manager (Trưởng Phòng / Quản Lý)</option>
                    <option value="Specialist">Specialist (Chuyên Viên / Kỹ Sư)</option>
                    <option value="Staff">Staff (Nhân Viên / Trợ Lý)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Vai Trò RBAC Chuẩn</label>
                  <select
                    value={posModal.defaultRole}
                    onChange={(e) => setPosModal({ ...posModal, defaultRole: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white font-mono"
                  >
                    <option value="director">director (Toàn quyền)</option>
                    <option value="manager">manager (Quản lý bộ phận)</option>
                    <option value="rd_head">rd_head (Trưởng phòng R&amp;D)</option>
                    <option value="rd_staff">rd_staff (Chuyên viên R&amp;D)</option>
                    <option value="kit_head">kit_head (Trưởng phòng SX Kit)</option>
                    <option value="kit_staff">kit_staff (KTV Sản xuất Kit)</option>
                    <option value="oligo_head">oligo_head (Trưởng phòng Oligo)</option>
                    <option value="oligo_staff">oligo_staff (KTV Tổng hợp Oligo)</option>
                    <option value="device_head">device_head (Trưởng phòng Thiết bị)</option>
                    <option value="device_staff">device_staff (Kỹ sư Thiết bị)</option>
                    <option value="sales_rep">sales_rep (Kinh doanh / PM / Marketing)</option>
                    <option value="app_rep">app_rep (Ứng dụng/Lab)</option>
                    <option value="procurement">procurement (Mua hàng)</option>
                    <option value="warehouse_lead">warehouse_lead (Kho vận)</option>
                    <option value="accountant">accountant (Kế toán)</option>
                    <option value="legal">legal (Pháp chế)</option>
                    <option value="qa_qc">qa_qc (Đảm bảo CL)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Mô Tả Nhiệm Vụ &amp; Trách Nhiệm Chuyên Trách
                </label>
                <textarea
                  value={posModal.desc}
                  onChange={(e) => setPosModal({ ...posModal, desc: e.target.value })}
                  placeholder="Mô tả phạm vi công việc, trách nhiệm chính của vị trí..."
                  rows={3}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setPosModal(prev => ({ ...prev, isOpen: false }))}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-xl text-xs transition-colors cursor-pointer"
                >
                  Hủy Bỏ
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-xl text-xs shadow-md shadow-orange-600/20 transition-all cursor-pointer"
                >
                  {posModal.posIndex !== null ? "Lưu Thay Đổi Vị Trí" : "Tạo Vị Trí Mới"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: BỔ NHIỆM CÁN BỘ VÀO VỊ TRÍ (CHỌN TỪ NÚT XỔ DROPDOWN & HỖ TRỢ KIÊM NHIỆM) */}
      {appointModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-orange-100 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">
                    Bổ Nhiệm Cán Bộ Vào Vị Trí Chức Danh
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Phòng: <span className="font-bold text-slate-800 dark:text-slate-200">{appointModal.deptKey}</span> • Vị trí: <span className="font-bold text-orange-600 dark:text-orange-400">{appointModal.posTitle}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAppointModal(prev => ({ ...prev, isOpen: false, selectedEmpCode: "" }))}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmAppoint} className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Chọn Nhân Viên Từ Danh Sách Đang Có ({personnel.length} nhân sự) <span className="text-rose-500">*</span>
                </label>
                <select
                  value={appointModal.selectedEmpCode}
                  onChange={(e) => setAppointModal({ ...appointModal, selectedEmpCode: e.target.value })}
                  className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 cursor-pointer"
                  required
                >
                  <option value="">-- Nhấp để chọn cán bộ nhân viên công ty --</option>
                  {[...personnel]
                    .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""))
                    .map((p) => (
                      <option key={p.id || p.employee_code} value={p.employee_code}>
                        {p.full_name} ({p.employee_code}) — {p.department} [{p.position}]
                      </option>
                    ))}
                </select>
                <p className="text-[11px] text-slate-400">
                  Bạn có thể bổ nhiệm bất kỳ nhân viên nào trong 30+ nhân sự công ty vào vị trí này.
                </p>
              </div>

              {/* Preview card of selected employee */}
              {(() => {
                const selectedStaff = personnel.find(p => p.employee_code === appointModal.selectedEmpCode);
                if (!selectedStaff) return null;
                return (
                  <div className="p-3 bg-orange-50/60 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800/60 rounded-xl space-y-1.5 animate-in fade-in">
                    <div className="flex items-center justify-between">
                      <div className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{selectedStaff.full_name}</span>
                        <span className="font-mono text-[10px] text-orange-600 font-bold">({selectedStaff.employee_code})</span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 font-bold border border-emerald-200 dark:border-emerald-800">
                        {selectedStaff.status || "ACTIVE"}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-400 flex items-center gap-2">
                      <span>Phòng hiện tại: <strong>{selectedStaff.department}</strong></span>
                      <span>•</span>
                      <span>Vị trí hiện tại: <strong>{selectedStaff.position}</strong></span>
                    </div>
                    {selectedStaff.email && (
                      <div className="text-[10px] text-slate-400 font-mono">
                        {selectedStaff.email}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Kiêm nhiệm vs Điều chuyển Option */}
              <label className="flex items-start gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100/60 dark:hover:bg-slate-800/70 transition-colors cursor-pointer">
                <input
                  type="checkbox"
                  checked={appointModal.isConcurrent}
                  onChange={(e) => setAppointModal({ ...appointModal, isConcurrent: e.target.checked })}
                  className="mt-0.5 rounded text-orange-600 focus:ring-orange-500 w-4 h-4 cursor-pointer"
                />
                <div className="space-y-0.5">
                  <div className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-1.5">
                    <span>Bổ Nhiệm Kiêm Nhiệm (Đa Vị Trí)</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-400 font-bold">
                      Khuyên Dùng
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    Giữ nguyên chức danh và quyền hạn tại phòng ban hiện tại, đồng thời phân bổ thêm vai trò và phụ trách vị trí này. Một nhân viên có thể kiêm nhiệm nhiều vị trí cùng lúc.
                  </p>
                </div>
              </label>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setAppointModal(prev => ({ ...prev, isOpen: false, selectedEmpCode: "" }))}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-xl text-xs transition-colors cursor-pointer"
                >
                  Hủy Bỏ
                </button>
                <button
                  type="submit"
                  disabled={!appointModal.selectedEmpCode}
                  className="px-5 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-xs shadow-md shadow-orange-600/20 transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Xác Nhận Bổ Nhiệm</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL PHÂN QUYỀN CHI TIẾT THEO CÁ NHÂN & TÍNH NĂNG */}
      {permissionsModalUser && (
        <div className="fixed inset-0 z-[120] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/40">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                      Phân Quyền Chi Tiết Cá Nhân
                    </h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                      Chuẩn PBAC &amp; RBAC
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="font-bold text-slate-800 dark:text-slate-200">{permissionsModalUser.full_name}</span>
                    <span>•</span>
                    <span className="font-mono text-slate-400">@{permissionsModalUser.username}</span>
                    <span>•</span>
                    <span>Phòng: <strong className="text-slate-700 dark:text-slate-300">{permissionsModalUser.department || "Chưa gán"}</strong></span>
                    <span>•</span>
                    <span>Vai trò gốc: <strong className="text-indigo-600 dark:text-indigo-400">{permissionsModalUser.role}</strong></span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setPermissionsModalUser(null)}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Action Toolbar */}
            <div className="px-6 py-2.5 bg-slate-100/60 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs gap-2 flex-wrap">
              <span className="text-slate-500 font-medium">
                Tích chọn từng tính năng cho phép cán bộ thực hiện trên hệ thống:
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetToPreset}
                  className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-700 hover:bg-slate-50 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 font-bold transition-all cursor-pointer flex items-center gap-1 shadow-2xs"
                  title="Khôi phục các quyền theo vai trò chuẩn"
                >
                  <RefreshCw className="w-3 h-3 text-slate-400" />
                  <span>Khôi Phục Theo Chức Danh</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectAllPermissions(true)}
                  className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-bold transition-all cursor-pointer"
                >
                  Bật Tất Cả
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectAllPermissions(false)}
                  className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-100 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-bold transition-all cursor-pointer"
                >
                  Tắt Tất Cả
                </button>
              </div>
            </div>

            {/* Permission Groups List (Scrollable Area) */}
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {/* SECTION 1: CÀI ĐẶT PHÒNG BAN / PHÂN HỆ ĐƯỢC PHÉP TRUY CẬP (TAB MENU CHÍNH) */}
              <div className="bg-gradient-to-br from-indigo-50/80 via-white to-slate-50 dark:from-slate-800/80 dark:via-slate-850/60 dark:to-slate-900 rounded-2xl border-2 border-indigo-500/40 p-5 space-y-4 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-indigo-200/60 dark:border-indigo-900/60">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold shadow-md shadow-indigo-500/20 shrink-0">
                      <Building2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                        <span>Khối Kinh Doanh &amp; Văn Phòng — Phân Hệ Được Phép Vào</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                          Hiển thị Tab Menu chính
                        </span>
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Cài đặt các phòng ban/phân hệ mà nhân sự này được phép truy cập trên thanh Menu chính của hệ thống.
                      </p>
                    </div>
                  </div>

                  {permissionsModalUser?.department && (
                    <button
                      type="button"
                      onClick={() => handleApplyDepartmentDefaults(permissionsModalUser.department, permissionsModalUser.role)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-sm shadow-indigo-500/20 transition-all cursor-pointer shrink-0"
                      title={`Tự động bật các phân hệ và quyền chuẩn của phòng ${permissionsModalUser.department}`}
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                      <span>Gán Chuẩn Phòng {permissionsModalUser.department}</span>
                    </button>
                  )}
                </div>

                {/* Department Modules Grid, grouped by khối */}
                {PORTAL_BLOCKS.map((block) => (
                <div key={block.title} className="space-y-2">
                <div className="text-[11px] font-extrabold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">{block.title}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {DEPARTMENT_MODULES.filter((m) => block.keys.includes(m.key)).map((deptMod) => {
                    const isAccessible = Boolean(currentEditingPermissions[deptMod.key]);
                    const userDept = (permissionsModalUser?.department || "").toLowerCase();
                    const isOwnDept = deptMod.deptMatch.some(d => userDept.includes(d));
                    const DeptIcon = getDepartmentIcon(deptMod.code);

                    return (
                      <div
                        key={deptMod.key}
                        onClick={() => handleToggleDepartmentModule(deptMod)}
                        className={`relative p-3.5 rounded-xl border-2 transition-all cursor-pointer select-none flex flex-col justify-between gap-3 ${
                          isAccessible
                            ? "bg-white dark:bg-slate-800 border-indigo-500 shadow-sm shadow-indigo-500/10 ring-2 ring-indigo-500/20"
                            : "bg-slate-50/60 dark:bg-slate-850/40 border-slate-200 dark:border-slate-800 opacity-60 hover:opacity-100"
                        }`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2.5">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                                isAccessible 
                                  ? "bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400" 
                                  : "bg-slate-200 dark:bg-slate-800 text-slate-400"
                              }`}>
                                <DeptIcon className="w-4 h-4" />
                              </div>
                              <div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={`text-xs font-black leading-tight ${
                                    isAccessible ? "text-slate-900 dark:text-white" : "text-slate-600 dark:text-slate-400"
                                  }`}>
                                    {deptMod.shortName}
                                  </span>
                                  {isOwnDept && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                      Trực thuộc
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] text-slate-400 block font-medium">
                                  {deptMod.name}
                                </span>
                              </div>
                            </div>

                            {/* Toggle Switch */}
                            <div className={`w-9 h-5 rounded-full transition-colors p-0.5 shrink-0 ${
                              isAccessible ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-700"
                            }`}>
                              <div className={`w-4 h-4 rounded-full bg-white transition-transform ${
                                isAccessible ? "translate-x-4 shadow-sm" : "translate-x-0"
                              }`} />
                            </div>
                          </div>

                          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                            {deptMod.desc}
                          </p>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px]">
                          <span className={`font-bold flex items-center gap-1 ${isAccessible ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}`}>
                            <span>{isAccessible ? "✓ ĐƯỢC PHÉP VÀO" : "✕ ĐANG KHÓA TAB"}</span>
                          </span>
                          <span className="text-slate-400 font-mono text-[9px]">
                            {deptMod.key}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                </div>
                ))}
              </div>

              {/* Khối Kỹ thuật – Nhà máy: role-based factory permissions (separate, audited) */}
              <FactoryAccessSection
                key={permissionsModalUser.id}
                userId={Number(permissionsModalUser.id)}
                username={permissionsModalUser.username}
                isRootAdmin={permissionsModalUser.role === "admin"}
              />

              {/* Divider between Departments and Granular Features */}
              <div className="flex items-center gap-2 pt-2">
                <Sliders className="w-4 h-4 text-slate-400" />
                <h4 className="font-extrabold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Phân Quyền Tính Năng Chi Tiết Trong Từng Phân Hệ
                </h4>
                <div className="flex-1 border-t border-slate-200 dark:border-slate-800" />
              </div>

              {PERMISSION_GROUPS.map((group) => {
                const groupKeys = group.permissions.map(p => p.key);
                const activeCount = groupKeys.filter(k => currentEditingPermissions[k]).length;

                return (
                  <div key={group.module} className="bg-slate-50/50 dark:bg-slate-800/30 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                    {/* Group Header */}
                    <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-700/60">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-sm text-slate-900 dark:text-white">
                          {group.title}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                          activeCount === groupKeys.length
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                            : activeCount > 0
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                            : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400"
                        }`}>
                          {activeCount}/{groupKeys.length} quyền kích hoạt
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            const newPerms = { ...currentEditingPermissions };
                            groupKeys.forEach(k => newPerms[k] = true);
                            setCurrentEditingPermissions(newPerms);
                          }}
                          className="text-[11px] text-indigo-600 dark:text-indigo-400 font-bold hover:underline cursor-pointer"
                        >
                          Chọn nhóm này
                        </button>
                        <span className="text-slate-300 dark:text-slate-600">|</span>
                        <button
                          type="button"
                          onClick={() => {
                            const newPerms = { ...currentEditingPermissions };
                            groupKeys.forEach(k => newPerms[k] = false);
                            setCurrentEditingPermissions(newPerms);
                          }}
                          className="text-[11px] text-slate-500 font-bold hover:underline cursor-pointer"
                        >
                          Bỏ chọn nhóm
                        </button>
                      </div>
                    </div>

                    {/* Permissions Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {group.permissions.map((p) => {
                        const isGranted = Boolean(currentEditingPermissions[p.key]);

                        return (
                          <div
                            key={p.key}
                            onClick={() => handleTogglePermission(p.key)}
                            className={`p-3 rounded-xl border flex items-start gap-3 transition-all cursor-pointer select-none ${
                              isGranted
                                ? "bg-white dark:bg-slate-800 border-indigo-200 dark:border-indigo-800/80 shadow-xs"
                                : "bg-white/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/60 opacity-60 hover:opacity-100"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isGranted}
                              onChange={() => {}} // handled by div onClick
                              className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer shrink-0"
                            />
                            <div className="space-y-0.5 flex-1">
                              <div className="flex items-center justify-between">
                                <span className={`text-xs font-bold ${isGranted ? "text-slate-900 dark:text-white" : "text-slate-600 dark:text-slate-400"}`}>
                                  {p.label}
                                </span>
                                <span className="text-[9px] font-mono text-slate-400">
                                  {p.key}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                                {p.desc}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Khối Kỹ thuật – Nhà máy: feature list per department (held through roles) */}
              <FactoryFeatureGroups
                key={`features-${permissionsModalUser.id}`}
                userId={Number(permissionsModalUser.id)}
                username={permissionsModalUser.username}
                isRootAdmin={permissionsModalUser.role === "admin"}
                startIndex={PERMISSION_GROUPS.length + 1}
              />
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/40">
              <div className="text-xs text-slate-500">
                <span>Số quyền đang cấp: </span>
                <strong className="text-indigo-600 dark:text-indigo-400 font-bold">
                  {Object.values(currentEditingPermissions).filter(Boolean).length}
                </strong>
                <span> / {PERMISSION_GROUPS.reduce((acc, g) => acc + g.permissions.length, 0)} tính năng Kinh doanh – Văn phòng</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPermissionsModalUser(null)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-xl text-xs transition-colors cursor-pointer"
                >
                  Hủy Bỏ
                </button>
                <button
                  type="button"
                  onClick={handleSavePermissions}
                  disabled={isSavingPermissions}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs shadow-md shadow-indigo-600/20 transition-all cursor-pointer flex items-center gap-1.5"
                >
                  {isSavingPermissions ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Đang lưu...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Lưu Cấu Hình Phân Quyền</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RESET DATA CONFIRMATION MODAL */}
      {isResetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-rose-50/50 dark:bg-rose-950/30">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 flex items-center justify-center font-bold">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                    Reset Dữ Liệu Nhân Sự & Tài Khoản
                  </h4>
                  <p className="text-[11px] text-rose-600 dark:text-rose-400 font-medium">
                    Xóa sạch dữ liệu cũ để nhập lại từ đầu
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsResetModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4 text-xs">
              <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-200 space-y-2 leading-relaxed">
                <div className="font-bold flex items-center gap-1.5 text-xs text-amber-900 dark:text-amber-100">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Xác nhận thiết lập lại danh mục:</span>
                </div>
                <ul className="list-disc list-inside space-y-1.5 text-[11px] text-amber-800 dark:text-amber-200">
                  <li>Toàn bộ hồ sơ trong <strong>Danh bạ Nhân sự</strong> sẽ được xóa sạch.</li>
                  <li>Tất cả tài khoản người dùng thường sẽ được xóa, <strong>ngoại trừ tài khoản Quản Trị Viên Hệ Thống (admin)</strong>.</li>
                  <li>Cơ chế tự động nhân bản trùng lặp đã được gỡ bỏ hoàn toàn.</li>
                </ul>
              </div>

              <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-xs">
                Sau khi Reset, bạn có thể nhập mới danh sách cán bộ nhân sự và tài khoản một cách chuẩn xác mà không còn lo bị nhân bản hoặc trùng lặp mã nhân viên.
              </p>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsResetModalOpen(false)}
                disabled={isResetting}
                className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 font-semibold cursor-pointer text-xs"
              >
                Hủy Bỏ
              </button>
              <button
                type="button"
                onClick={handleResetData}
                disabled={isResetting}
                className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-xs transition-all cursor-pointer text-xs"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${isResetting ? "animate-spin" : ""}`} />
                <span>{isResetting ? "Đang xử lý..." : "Xác Nhận Làm Sạch"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

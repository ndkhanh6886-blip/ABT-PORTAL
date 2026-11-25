"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { writeSafePrintDocument } from "@/frontend/utils/safePrint";
import { needsLeaveDates } from "@/frontend/utils/recoveredProposals";
import { isSameWorkspaceDept, defaultConcreteDeptForScope, normalizeWorkspaceDept, WORKSPACE_BLOCKS } from "@/frontend/utils/workspaceScope";
import { canonicalDepartment, isDepartmentLeaderPosition } from "@/backend/services/permissions";
import {
  isDatesMode, parseLeaveDays, normalizeLeaveDays, serializeLeaveDays, expandWeekdays, sumLeaveDays, isOnLeaveOn,
  formatLeaveDays, weekdayOf, SESSION_LABEL, WEEKDAY_LABELS, type LeaveDay, type LeaveSession
} from "@/frontend/utils/leaveDates";
import {
  FileText,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Plus,
  Search,
  Filter,
  ArrowRight,
  DollarSign,
  Users,
  Briefcase,
  FlaskConical,
  Award,
  Check,
  X,
  Eye,
  Trash2,
  Send,
  RefreshCw,
  Printer,
  Pencil,
  Paperclip,
  MessageSquare,
  ShieldCheck,
  UserCheck,
  ChevronRight,
  Sparkles,
  Calendar,
  ListTodo,
  Download,
  ExternalLink
} from "lucide-react";
import { Modal } from "@/frontend/components/Modal";
import { AttachmentPicker, Attachment } from "@/frontend/components/AttachmentPicker";
import { DateInputVN, formatDayVN } from "@/frontend/components/DateInputVN";
import { todayVN, nowVNDateTime, formatVNDateTime } from "@/backend/services/dates";
import { Pager, usePaged } from "@/frontend/components/Pager";


/** Mã hóa HTML cho một chuỗi (dùng khi ghi tài liệu in bằng document.write). */
const escapeHtmlText = (v: any): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Bản sao đã mã hóa HTML mọi chuỗi bên trong (số, boolean giữ nguyên). */
function escapeDeepHtml<T>(v: T): T {
  if (typeof v === "string") return escapeHtmlText(v) as any;
  if (Array.isArray(v)) return v.map(x => escapeDeepHtml(x)) as any;
  if (v && typeof v === "object") {
    const out: any = {};
    for (const [k, x] of Object.entries(v as any)) out[k] = escapeDeepHtml(x);
    return out;
  }
  return v;
}

export type ProposalCategoryKey =
  | "FINANCE"
  | "HR_ADMIN"
  | "COMMERCIAL"
  | "TECHNICAL_OPS"
  | "EXECUTIVE";

export type ProposalStatus =
  | "DRAFT"
  | "PENDING"
  | "RETURNED"
  | "APPROVED"
  | "EXECUTED"
  | "REJECTED"
  | "WITHDRAWN";

/**
 * 3 chế độ hiển thị của Đề xuất / Tờ trình:
 * - "PRIVATE": Bảo mật theo luồng duyệt — chỉ Người trình, Người duyệt các bước, Người thực thi, Người nhận bàn giao, Người theo dõi (Followers) và Ban Giám Đốc thấy.
 * - "DEPT": Nội bộ phòng ban & Người duyệt — mở rộng thêm cho các nhân sự cùng phòng ban với người trình (hoặc Trưởng/Phó phòng các bước liên quan).
 * - "PUBLIC": Công khai toàn công ty — mọi nhân viên đều thấy. Với Đơn xin nghỉ phép (DXNP), người ngoài luồng duyệt sẽ chỉ thấy Lịch ngày nghỉ & Người nhận bàn giao (ẩn lý do riêng tư & tệp đính kèm nhạy cảm).
 */
export type ProposalVisibility = "PRIVATE" | "DEPT" | "PUBLIC";

export const PROPOSAL_VISIBILITY_META: Record<
  ProposalVisibility,
  { label: string; shortLabel: string; desc: string; badgeCls: string }
> = {
  PRIVATE: {
    label: "🔒 Bảo mật theo luồng duyệt (Không công khai)",
    shortLabel: "🔒 Bảo mật theo luồng",
    desc: "Chỉ Người tạo, Người duyệt các bước, Người theo dõi (CC) và Ban Giám Đốc xem được. Nhân viên khác (kể cả cùng phòng hoặc ngoài phòng) không thấy.",
    badgeCls:
      "bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/70 dark:text-rose-300 dark:border-rose-800"
  },
  DEPT: {
    label: "🏢 Nội bộ Phòng ban & Người duyệt",
    shortLabel: "🏢 Nội bộ phòng ban",
    desc: "Nhân sự cùng phòng ban với người trình, các cấp phê duyệt/thực thi, Người theo dõi và Ban Giám Đốc xem được. Phòng ban khác không liên quan không thấy.",
    badgeCls:
      "bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800"
  },
  PUBLIC: {
    label: "🌐 Công khai toàn công ty (Với Đơn nghỉ phép: Công khai lịch & ẩn lý do riêng)",
    shortLabel: "🌐 Công khai toàn công ty",
    desc: "Mọi nhân viên đều thấy. Riêng với Đơn xin nghỉ phép (DXNP), người ngoài luồng chỉ thấy Ngày nghỉ & Người nhận bàn giao, tự động ẩn lý do cá nhân và file đính kèm.",
    badgeCls:
      "bg-teal-50 text-teal-800 border-teal-300 dark:bg-teal-950/70 dark:text-teal-300 dark:border-teal-800"
  }
};

export interface ProposalFieldSchema {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "textarea" | "file";
  placeholder?: string;
  required?: boolean;
  options?: string[];
}

export interface ProposalStepTemplate {
  stepOrder: number;
  stepName: string;
  roleType: "DEPT_HEAD" | "REVIEWER" | "DIRECTOR" | "EXECUTOR";
  defaultDept: string;
  defaultApprover: string;
  slaHours: number;
  conditionMinAmount?: number; // Nếu có: chỉ kích hoạt bước này khi số tiền >= hạn mức
  allowAttachment?: boolean;
  requireAttachment?: boolean;
  attachmentLabel?: string;
}

export interface ProposalTemplate {
  id: string;
  codePrefix: string;
  category: ProposalCategoryKey;
  name: string;
  icon: string;
  description: string;
  hasAmount: boolean;
  hasLineItems: boolean;
  lineItemColumns?: { col1: string; col2: string; col3: string; col4: string };
  autoDirectorThreshold?: number;
  slaTotalHours: number;
  fields: ProposalFieldSchema[];
  defaultSteps: ProposalStepTemplate[];
  defaultFollowers?: string[];
  defaultVisibility?: ProposalVisibility;
}

export interface ProposalStepInstance {
  stepOrder: number;
  stepName: string;
  roleType: "DEPT_HEAD" | "REVIEWER" | "DIRECTOR" | "EXECUTOR";
  dept: string;
  approverName: string;
  status: "WAITING" | "PENDING_NOW" | "APPROVED" | "RETURNED" | "REJECTED" | "SKIPPED";
  slaHours: number;
  decidedAt?: string;
  decidedBy?: string;
  comment?: string;
  allowAttachment?: boolean;
  requireAttachment?: boolean;
  attachmentLabel?: string;
  attachments?: Attachment[];
}

export interface ProposalLineItem {
  id: string;
  itemName: string;
  specification: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  note?: string;
}

export interface ProposalItem {
  id: string;
  proposalCode: string;
  templateId: string;
  templateName: string;
  category: ProposalCategoryKey;
  title: string;
  priority: "NORMAL" | "HIGH" | "URGENT";
  requesterName: string;
  requesterDept: string;
  createdAt: string;
  updatedAt: string;
  neededByDate: string;
  totalAmount: number;
  currency: string;
  summaryReason: string;
  formValues: Record<string, any>;
  lineItems: ProposalLineItem[];
  steps: ProposalStepInstance[];
  currentStepIndex: number;
  status: ProposalStatus;
  visibility?: ProposalVisibility;
  followers: string[];
  executorName?: string;
  executedAt?: string;
  executionNote?: string;
  executionAttachments?: Attachment[];
  linkedRefCode?: string;
  customerName?: string;
  supplierName?: string;
  attachments: Attachment[];
  comments: Array<{
    id: string;
    author: string;
    dept: string;
    role?: string;
    text: string;
    time: string;
    actionTag?: string;
    attachments?: Attachment[];
  }>;
  auditLogs: Array<{
    time: string;
    actor: string;
    action: string;
    detail: string;
  }>;
}

export const PROPOSAL_CATEGORY_META: Record<
  ProposalCategoryKey,
  { label: string; shortLabel: string; icon: string; badgeCls: string; borderCls: string; headerBg: string }
> = {
  FINANCE: {
    label: "💰 Tài chính - Thanh toán - Ngân sách",
    shortLabel: "💰 Tài chính & Thanh toán",
    icon: "💰",
    badgeCls: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-700",
    borderCls: "border-l-[5px] border-l-emerald-500",
    headerBg: "from-emerald-500/10 via-teal-500/5 to-transparent"
  },
  HR_ADMIN: {
    label: "👥 Nhân sự - Nghỉ phép - Công tác - Hành chính",
    shortLabel: "👥 Nhân sự & Hành chính",
    icon: "👥",
    badgeCls: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/80 dark:text-blue-300 dark:border-blue-700",
    borderCls: "border-l-[5px] border-l-blue-500",
    headerBg: "from-blue-500/10 via-indigo-500/5 to-transparent"
  },
  COMMERCIAL: {
    label: "💼 Kinh doanh - Chính sách giá - Công nợ KH",
    shortLabel: "💼 Kinh doanh & Chính sách",
    icon: "💼",
    badgeCls: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-700",
    borderCls: "border-l-[5px] border-l-amber-500",
    headerBg: "from-amber-500/10 via-orange-500/5 to-transparent"
  },
  TECHNICAL_OPS: {
    label: "🔬 Kỹ thuật - Kho vận - Mẫu Demo - Mua sắm",
    shortLabel: "🔬 Kỹ thuật, Kho & Mua sắm",
    icon: "🔬",
    badgeCls: "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/80 dark:text-purple-300 dark:border-purple-700",
    borderCls: "border-l-[5px] border-l-purple-500",
    headerBg: "from-purple-500/10 via-fuchsia-500/5 to-transparent"
  },
  EXECUTIVE: {
    label: "🏛️ Tờ trình Ban Giám Đốc & Chủ trương chung",
    shortLabel: "🏛️ Tờ trình Ban Giám Đốc",
    icon: "🏛️",
    badgeCls: "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/80 dark:text-rose-300 dark:border-rose-700",
    borderCls: "border-l-[5px] border-l-rose-500",
    headerBg: "from-rose-500/10 via-pink-500/5 to-transparent"
  }
};

export const DEFAULT_PROPOSAL_TEMPLATES: ProposalTemplate[] = [
  // 1. TÀI CHÍNH - KẾ TOÁN
  {
    id: "tmpl_payment_request",
    codePrefix: "DNTT",
    category: "FINANCE",
    name: "Đề nghị Thanh toán (Payment Request)",
    icon: "💳",
    description: "Đề nghị thanh toán tiền hàng NCC, phí dịch vụ vận chuyển, hải quan, tiếp khách hoặc chi phí vận hành có hóa đơn/chứng từ.",
    hasAmount: true,
    hasLineItems: true,
    lineItemColumns: { col1: "Nội dung khoản chi / Số HĐ", col2: "Đơn vị / Quy cách", col3: "Số lượng", col4: "Đơn giá (VNĐ)" },
    autoDirectorThreshold: 5000000,
    slaTotalHours: 24,
    fields: [
      { key: "paymentMethod", label: "Hình thức thanh toán", type: "select", options: ["Chuyển khoản ngân hàng", "Tiền mặt tại quỹ", "Thanh toán L/C - Quốc tế", "Cấn trừ công nợ"], required: true },
      { key: "beneficiaryName", label: "Đơn vị / Người thụ hưởng", type: "text", placeholder: "VD: Công ty TNHH Thiết bị Y tế...", required: true },
      { key: "bankAccount", label: "Số tài khoản ngân hàng", type: "text", placeholder: "Nhập số TK nhận tiền..." },
      { key: "bankName", label: "Ngân hàng & Chi nhánh", type: "text", placeholder: "VD: Vietcombank - CN TP.HCM" },
      { key: "invoiceRef", label: "Số Hóa đơn VAT / Số Hợp đồng / Mã PO", type: "text", placeholder: "VD: HĐ 0001245 / PO-2026-089" }
    ],
    defaultSteps: [
      { stepOrder: 1, stepName: "Trưởng bộ phận xác nhận", roleType: "DEPT_HEAD", defaultDept: "Theo phòng người tạo", defaultApprover: "Trưởng bộ phận", slaHours: 4 },
      { stepOrder: 2, stepName: "Kế toán kiểm tra chứng từ & ngân sách", roleType: "REVIEWER", defaultDept: "Kế Toán", defaultApprover: "Kế toán trưởng", slaHours: 8 },
      { stepOrder: 3, stepName: "Ban Giám Đốc phê duyệt chi", roleType: "DIRECTOR", defaultDept: "Ban Giám Đốc", defaultApprover: "Ban Giám Đốc", slaHours: 12, conditionMinAmount: 5000000 }
    ]
  },
  {
    id: "tmpl_cash_advance",
    codePrefix: "DNTU",
    category: "FINANCE",
    name: "Đề nghị Tạm ứng (Cash Advance)",
    icon: "💵",
    description: "Tạm ứng kinh phí đi công tác tỉnh/bệnh viện, tạm ứng mua vật tư gấp, tiếp khách hoặc tổ chức hội thảo.",
    hasAmount: true,
    hasLineItems: true,
    lineItemColumns: { col1: "Hạng mục dự kiến chi", col2: "Đơn vị tính", col3: "Số lượng", col4: "Đơn giá dự kiến (VNĐ)" },
    autoDirectorThreshold: 3000000,
    slaTotalHours: 16,
    fields: [
      { key: "advancePurpose", label: "Mục đích tạm ứng", type: "text", placeholder: "VD: Tạm ứng công tác phí lắp máy tại BV Đa khoa...", required: true },
      { key: "settlementDate", label: "Thời hạn cam kết hoàn ứng", type: "date", required: true },
      { key: "receiveAccount", label: "Tài khoản nhận tiền tạm ứng", type: "text", placeholder: "Số TK cá nhân & Ngân hàng..." }
    ],
    defaultSteps: [
      { stepOrder: 1, stepName: "Trưởng bộ phận duyệt nhu cầu", roleType: "DEPT_HEAD", defaultDept: "Theo phòng người tạo", defaultApprover: "Trưởng bộ phận", slaHours: 4 },
      { stepOrder: 2, stepName: "Kế toán kiểm tra công nợ tạm ứng", roleType: "REVIEWER", defaultDept: "Kế Toán", defaultApprover: "Kế toán trưởng", slaHours: 4 },
      { stepOrder: 3, stepName: "Ban Giám Đốc phê duyệt", roleType: "DIRECTOR", defaultDept: "Ban Giám Đốc", defaultApprover: "Ban Giám Đốc", slaHours: 8 }
    ]
  },
  {
    id: "tmpl_expense_settlement",
    codePrefix: "QTHU",
    category: "FINANCE",
    name: "Đề nghị Hoàn ứng & Quyết toán chi phí",
    icon: "🧾",
    description: "Quyết toán các khoản đã tạm ứng sau chuyến công tác hoặc hoàn lại tiền chi trả hộ có hóa đơn chứng từ.",
    hasAmount: true,
    hasLineItems: true,
    lineItemColumns: { col1: "Khoản mục chi thực tế / Số hóa đơn", col2: "Ngày chứng từ", col3: "Số lượng", col4: "Số tiền thực chi (VNĐ)" },
    autoDirectorThreshold: 5000000,
    slaTotalHours: 24,
    fields: [
      { key: "advanceCodeRef", label: "Mã phiếu Tạm ứng liên quan (nếu có)", type: "text", placeholder: "VD: DNTU-2026-001" },
      { key: "advancedAmount", label: "Số tiền đã tạm ứng trước đó (VNĐ)", type: "number", placeholder: "0" },
      { key: "settlementDiff", label: "Chênh lệch (Chi thêm / Hoàn trả quỹ)", type: "text", placeholder: "VD: Công ty chi thêm 1.200.000đ" }
    ],
    defaultSteps: [
      { stepOrder: 1, stepName: "Trưởng bộ phận xác nhận thực tế", roleType: "DEPT_HEAD", defaultDept: "Theo phòng người tạo", defaultApprover: "Trưởng bộ phận", slaHours: 4 },
      { stepOrder: 2, stepName: "Kế toán hậu kiểm hóa đơn hợp lệ", roleType: "REVIEWER", defaultDept: "Kế Toán", defaultApprover: "Kế toán trưởng", slaHours: 12 },
      { stepOrder: 3, stepName: "Ban Giám Đốc duyệt quyết toán", roleType: "DIRECTOR", defaultDept: "Ban Giám Đốc", defaultApprover: "Ban Giám Đốc", slaHours: 8 }
    ]
  },
  {
    id: "tmpl_invoice_request",
    codePrefix: "DNXHD",
    category: "FINANCE",
    name: "Đề nghị Xuất hóa đơn (Invoice Request)",
    icon: "🧾",
    description: "Đề nghị xuất hóa đơn cho khách hàng",
    hasAmount: true,
    hasLineItems: true,
    lineItemColumns: {
      col1: "Nội dung xuất hóa đơn/ Số hợp đồng/ Mã SO hoặc PXK",
      col2: "Đơn vị / Quy cách",
      col3: "Số lượng",
      col4: "Đơn giá (VNĐ)"
    },
    autoDirectorThreshold: 5000000,
    slaTotalHours: 24,
    fields: [
      { key: "paymentMethod", label: "Hình thức thanh toán", type: "select", options: ["Chuyển khoản ngân hàng", "Tiền mặt tại quỹ", "Thanh toán L/C - Quốc tế", "Cấn trừ công nợ"], required: false },
      { key: "beneficiaryName", label: "Đơn vị / Người thụ hưởng", type: "text", placeholder: "VD: Công ty TNHH Thiết bị Y tế..." },
      { key: "bankAccount", label: "Số tài khoản ngân hàng", type: "text", placeholder: "Nhập số TK nhận tiền..." },
      { key: "bankName", label: "Ngân hàng & Chi nhánh", type: "text", placeholder: "VD: Vietcombank - CN TP.HCM" },
      { key: "invoiceRef", label: "Số hợp đồng/ Mã SO hoặc PXK", type: "text", placeholder: "VD: HĐ 0001245 / SO-2026-089" }
    ],
    defaultSteps: [
      { stepOrder: 1, stepName: "Trưởng bộ phận xác nhận", roleType: "DEPT_HEAD", defaultDept: "Theo phòng người tạo", defaultApprover: "Trưởng bộ phận", slaHours: 4 },
      { stepOrder: 2, stepName: "Kế toán kiểm tra & xuất hóa đơn", roleType: "REVIEWER", defaultDept: "Kế Toán", defaultApprover: "Kế toán trưởng", slaHours: 8, allowAttachment: true, attachmentLabel: "File Hóa đơn VAT đã xuất (PDF / XML / Ảnh)" }
    ]
  },

  // 2. NHÂN SỰ & HÀNH CHÍNH
  {
    id: "tmpl_leave_request",
    codePrefix: "DXNP",
    category: "HR_ADMIN",
    name: "Đơn xin Nghỉ phép / Nghỉ việc riêng",
    icon: "🏖️",
    description: "Đăng ký nghỉ phép năm hưởng lương, nghỉ ốm BHXH, nghỉ chế độ hiếu/hỷ hoặc nghỉ không lương và phân công người thay thế.",
    hasAmount: false,
    hasLineItems: false,
    slaTotalHours: 8,
    fields: [
      { key: "leaveType", label: "Loại hình nghỉ", type: "select", options: ["Nghỉ phép năm (Có hưởng lương)", "Nghỉ việc riêng (Không hưởng lương)", "Nghỉ ốm / Khám chữa bệnh (BHXH)", "Nghỉ chế độ Kết hôn / Hiếu hỷ", "Nghỉ Thai sản", "Làm việc từ xa (WFH)"], required: true },
      { key: "fromDate", label: "Nghỉ từ ngày", type: "date", required: true },
      { key: "toDate", label: "Đến hết ngày", type: "date", required: true },
      { key: "totalDays", label: "Tổng số ngày nghỉ", type: "number", placeholder: "VD: 1 hoặc 0.5", required: true },
      { key: "handoverStaff", label: "Nhân sự nhận bàn giao công việc trong thời gian nghỉ", type: "text", placeholder: "Họ tên đồng nghiệp hỗ trợ xử lý việc gấp...", required: true }
    ],
    defaultSteps: [
      { stepOrder: 1, stepName: "Trưởng bộ phận duyệt & sắp xếp nhân sự", roleType: "DEPT_HEAD", defaultDept: "Theo phòng người tạo", defaultApprover: "Trưởng bộ phận", slaHours: 4 },
      { stepOrder: 2, stepName: "Hành chính - Nhân sự ghi nhận công phép", roleType: "REVIEWER", defaultDept: "Hành Chính Nhân Sự", defaultApprover: "Hành Chính Nhân Sự", slaHours: 4 }
    ]
  },
  {
    id: "tmpl_overtime_request",
    codePrefix: "DKTC",
    category: "HR_ADMIN",
    name: "Phiếu Đăng ký Làm thêm giờ / Tăng ca (OT)",
    icon: "⏰",
    description: "Đăng ký làm thêm giờ ngoài giờ hành chính, cuối tuần hoặc ngày Lễ để kịp tiến độ đơn hàng, thầu, chạy mẫu Lab/Sản xuất.",
    hasAmount: false,
    hasLineItems: false,
    slaTotalHours: 8,
    fields: [
      { key: "otDate", label: "Ngày đăng ký tăng ca", type: "date", required: true },
      { key: "timeSlot", label: "Khung giờ làm thêm", type: "text", placeholder: "VD: 17:30 - 21:00 (3.5 giờ)", required: true },
      { key: "otHours", label: "Tổng số giờ OT", type: "number", placeholder: "3.5", required: true },
      { key: "compensationMode", label: "Hình thức tính công", type: "select", options: ["Tính lương tăng ca theo quy định", "Quy đổi nghỉ bù (Compensatory Leave)"], required: true }
    ],
    defaultSteps: [
      { stepOrder: 1, stepName: "Trưởng bộ phận xác nhận khối lượng việc", roleType: "DEPT_HEAD", defaultDept: "Theo phòng người tạo", defaultApprover: "Trưởng bộ phận", slaHours: 4 },
      { stepOrder: 2, stepName: "Ban Giám Đốc / HCNS phê duyệt", roleType: "DIRECTOR", defaultDept: "Ban Giám Đốc", defaultApprover: "Ban Giám Đốc", slaHours: 4 }
    ]
  },
  {
    id: "tmpl_business_trip",
    codePrefix: "DXCT",
    category: "HR_ADMIN",
    name: "Đề xuất Đi công tác & Lịch trình làm việc",
    icon: "✈️",
    description: "Phê duyệt lịch trình đi công tác tỉnh, làm việc tại Bệnh viện/Viện nghiên cứu, phương tiện di chuyển và dự toán công tác phí.",
    hasAmount: true,
    hasLineItems: true,
    lineItemColumns: { col1: "Khoản mục dự toán (Vé máy bay, KS, Công tác phí...)", col2: "Đơn vị", col3: "Số ngày / Lượt", col4: "Đơn giá dự kiến (VNĐ)" },
    autoDirectorThreshold: 2000000,
    slaTotalHours: 16,
    fields: [
      { key: "destination", label: "Địa điểm / Đơn vị công tác", type: "text", placeholder: "VD: BV Đa khoa Trung ương Cần Thơ", required: true },
      { key: "departureDate", label: "Ngày khởi hành", type: "date", required: true },
      { key: "returnDate", label: "Ngày kết thúc", type: "date", required: true },
      { key: "transport", label: "Phương tiện di chuyển", type: "select", options: ["Xe công ty", "Máy bay", "Xe khách / Tàu hỏa", "Taxi / Grab công vụ", "Phương tiện cá nhân (Hỗ trợ xăng)"]},
      { key: "companions", label: "Thành viên đoàn cùng đi", type: "text", placeholder: "Nhập tên các nhân sự đi cùng..." }
    ],
    defaultSteps: [
      { stepOrder: 1, stepName: "Trưởng bộ phận duyệt lịch trình", roleType: "DEPT_HEAD", defaultDept: "Theo phòng người tạo", defaultApprover: "Trưởng bộ phận", slaHours: 4 },
      { stepOrder: 2, stepName: "Kế toán rà soát định mức công tác phí", roleType: "REVIEWER", defaultDept: "Kế Toán", defaultApprover: "Kế toán trưởng", slaHours: 4 },
      { stepOrder: 3, stepName: "Ban Giám Đốc phê duyệt công lệnh", roleType: "DIRECTOR", defaultDept: "Ban Giám Đốc", defaultApprover: "Ban Giám Đốc", slaHours: 8 }
    ]
  },

  // 3. KINH DOANH & CHÍNH SÁCH BÁN HÀNG
  {
    id: "tmpl_special_discount",
    codePrefix: "DXCK",
    category: "COMMERCIAL",
    name: "Đề xuất Giá bán đặc biệt / Chiết khấu / Hàng tặng",
    icon: "🏷️",
    description: "Trình duyệt giá bán ưu đãi vượt khung cho khách hàng chiến lược, đại lý, gói thầu hoặc chương trình tặng Kit/hóa chất kèm máy.",
    hasAmount: true,
    hasLineItems: true,
    lineItemColumns: { col1: "Mã - Tên sản phẩm áp dụng", col2: "Giá niêm yết", col3: "Số lượng cam kết", col4: "Giá đề xuất duyệt (VNĐ)" },
    autoDirectorThreshold: 0,
    slaTotalHours: 12,
    fields: [
      { key: "quotationRef", label: "Mã Báo giá / Đơn hàng (SO) liên quan", type: "text", placeholder: "VD: BG-2026-045 / SO-2026-012", required: true },
      { key: "discountPercent", label: "Mức chiết khấu / Ưu đãi đề xuất (%)", type: "text", placeholder: "VD: Giảm 12% hoặc tặng kèm 2 hộp chứng dương", required: true },
      { key: "committedVolume", label: "Cam kết doanh số / Sản lượng của Khách hàng", type: "text", placeholder: "VD: Cam kết lấy tối thiểu 50 hộp/quý" },
      { key: "competitorInfo", label: "Thông tin đối thủ cạnh tranh / Lý do cần hỗ trợ giá", type: "textarea", placeholder: "Phân tích giá đối thủ và biên lợi nhuận còn lại..." }
    ],
    defaultSteps: [
      { stepOrder: 1, stepName: "Trưởng bộ phận Kinh doanh thẩm định", roleType: "DEPT_HEAD", defaultDept: "Kinh Doanh", defaultApprover: "Trưởng phòng Kinh Doanh", slaHours: 4 },
      { stepOrder: 2, stepName: "Kế toán kiểm tra biên lợi nhuận (Margin)", roleType: "REVIEWER", defaultDept: "Kế Toán", defaultApprover: "Kế toán trưởng", slaHours: 4 },
      { stepOrder: 3, stepName: "Ban Giám Đốc phê duyệt chính sách giá", roleType: "DIRECTOR", defaultDept: "Ban Giám Đốc", defaultApprover: "Ban Giám Đốc", slaHours: 4 }
    ]
  },
  {
    id: "tmpl_credit_extension",
    codePrefix: "DXCN",
    category: "COMMERCIAL",
    name: "Đề xuất Cấp / Nới hạn mức công nợ & Gia hạn thanh toán",
    icon: "🛡️",
    description: "Xin xuất hàng vượt hạn mức công nợ cho Bệnh viện/Đại lý hoặc gia hạn thời gian thanh toán hóa đơn quá hạn.",
    hasAmount: true,
    hasLineItems: false,
    autoDirectorThreshold: 0,
    slaTotalHours: 12,
    fields: [
      { key: "currentDebt", label: "Dư nợ hiện tại của Khách hàng (VNĐ)", type: "text", placeholder: "VD: 185.000.000 VNĐ", required: true },
      { key: "orderValue", label: "Giá trị đơn hàng xin xuất thêm (VNĐ)", type: "text", placeholder: "VD: 65.000.000 VNĐ", required: true },
      { key: "proposedCreditLimit", label: "Hạn mức công nợ mới / Ngày cam kết trả nợ", type: "date", required: true },
      { key: "guaranteeNote", label: "Căn cứ đảm bảo thu hồi nợ (Hợp đồng thầu, Cam kết...)", type: "textarea", placeholder: "Nêu rõ lịch giải ngân của kho bạc/bệnh viện..." }
    ],
    defaultSteps: [
      { stepOrder: 1, stepName: "Kế toán công nợ đối chiếu tuổi nợ", roleType: "REVIEWER", defaultDept: "Kế Toán", defaultApprover: "Kế toán trưởng", slaHours: 4 },
      { stepOrder: 2, stepName: "Ban Giám Đốc phê duyệt ngoại lệ công nợ", roleType: "DIRECTOR", defaultDept: "Ban Giám Đốc", defaultApprover: "Ban Giám Đốc", slaHours: 8 }
    ]
  },

  // 4. KỸ THUẬT, KHO VẬN & MUA SẮM (PHÂN BIỆT RÕ KHỐI KINH DOANH VÀ KHỐI KỸ THUẬT – NHÀ MÁY)
  {
    id: "tmpl_demo_sample_issue",
    codePrefix: "DXDM",
    category: "TECHNICAL_OPS",
    name: "Đề xuất Xuất Kho Kinh Doanh: Mẫu thử (Sample) / Mượn máy Demo",
    icon: "🧪",
    description: "Dành cho Khối Kinh Doanh & Application: Đề xuất xuất Kho Kinh Doanh hóa chất/Kit mẫu (0đ) để chạy thử nghiệm tại Bệnh viện hoặc mượn máy Demo.",
    hasAmount: true,
    hasLineItems: true,
    lineItemColumns: { col1: "Mã - Tên Kit / Thiết bị xuất mẫu", col2: "Quy cách / Số Lot", col3: "Số lượng", col4: "Giá vốn ước tính (VNĐ)" },
    autoDirectorThreshold: 0,
    slaTotalHours: 16,
    fields: [
      { key: "demoType", label: "Hình thức xuất Kho Kinh Doanh", type: "select", options: ["Xuất mẫu thử không thu hồi (Sample Test)", "Xuất mượn máy / thiết bị Demo có hoàn trả", "Xuất bảo hành / Đổi trả RMA"], required: true },
      { key: "expectedReturnDate", label: "Ngày dự kiến hoàn trả máy / Nghiệm thu kết quả", type: "date", required: true },
      { key: "applicationStaff", label: "Kỹ sư Application phụ trách chạy mẫu", type: "text", placeholder: "Nhập tên kỹ sư Application..." }
    ],
    defaultSteps: [
      { stepOrder: 1, stepName: "Trưởng phòng Application thẩm định", roleType: "DEPT_HEAD", defaultDept: "Application", defaultApprover: "Trưởng phòng Application", slaHours: 4 },
      { stepOrder: 2, stepName: "Ban Giám Đốc phê duyệt xuất mẫu", roleType: "DIRECTOR", defaultDept: "Ban Giám Đốc", defaultApprover: "Ban Giám Đốc", slaHours: 6 },
      { stepOrder: 3, stepName: "Kho Kinh Doanh & Vận hành xuất kho thực thi", roleType: "EXECUTOR", defaultDept: "Kho & Vận Hành", defaultApprover: "Trưởng Kho Kinh Doanh", slaHours: 6 }
    ]
  },
  {
    id: "tmpl_factory_fefo_special_issue",
    codePrefix: "DXKNM",
    category: "TECHNICAL_OPS",
    name: "Đề xuất Xuất Kho Nhà Máy: Cấp phát NVL/Hóa chất R&D & Lô Thẩm định",
    icon: "🏭",
    description: "Độc lập với Kho Kinh Doanh: Đề xuất Kho Nhà Máy xuất nguyên vật liệu, enzyme, cột tổng hợp hoặc bán thành phẩm phục vụ thực nghiệm R&D, thẩm định QC hoặc bù hao hụt sản xuất.",
    hasAmount: true,
    hasLineItems: true,
    lineItemColumns: { col1: "Mã - Tên NVL / Hóa chất / Bán thành phẩm", col2: "Số Lot FEFO & Hạn dùng", col3: "Số lượng lĩnh", col4: "Đơn giá vốn (VNĐ)" },
    autoDirectorThreshold: 3000000,
    slaTotalHours: 12,
    fields: [
      { key: "factoryIssueType", label: "Mục đích lĩnh vật tư tại Kho Nhà Máy", type: "select", options: ["Thực nghiệm Đề tài R&D (ELN)", "Chạy mẫu Kiểm nghiệm QA/QC & Độ ổn định", "Xuất bù hao hụt Lệnh sản xuất Kit / Mẻ Oligo", "Lắp ráp / Thử nghiệm Thiết bị mới"], required: true },
      { key: "batchOrProjectRef", label: "Mã Lệnh sản xuất / Đề tài R&D liên quan", type: "text", placeholder: "VD:LSX-KIT-2611 / RD-HPV-01", required: true }
    ],
    defaultSteps: [
      { stepOrder: 1, stepName: "Trưởng phòng chuyên môn (R&D / SX / Thiết bị) duyệt", roleType: "DEPT_HEAD", defaultDept: "Nghiên Cứu R&D", defaultApprover: "Trưởng bộ phận", slaHours: 4 },
      { stepOrder: 2, stepName: "QA/QC kiểm tra trạng thái lô Released & FEFO", roleType: "REVIEWER", defaultDept: "QA/QC", defaultApprover: "Trưởng phòng QA/QC", slaHours: 4 },
      { stepOrder: 3, stepName: "Kho Nhà Máy xuất cấp phát thực thi", roleType: "EXECUTOR", defaultDept: "Kho Nhà Máy", defaultApprover: "Thủ kho Nhà Máy", slaHours: 4 }
    ]
  },
  {
    id: "tmpl_scrap_writeoff",
    codePrefix: "DXHH",
    category: "TECHNICAL_OPS",
    name: "Tờ trình Xử lý / Hủy hàng hết hạn, hỏng hoặc lệch chuẩn (Kho KD / Kho Nhà Máy)",
    icon: "⚠️",
    description: "Phê duyệt biên bản xử lý, thanh lý hoặc tiêu hủy lô hàng hết hạn sử dụng (Expired), hư hỏng lạnh hoặc không đạt QC (Rejected/OOS).",
    hasAmount: true,
    hasLineItems: true,
    lineItemColumns: { col1: "Mã - Tên hàng hóa / Vật tư", col2: "Số Lot & Hạn dùng", col3: "Số lượng hủy", col4: "Giá trị tổn thất (VNĐ)" },
    autoDirectorThreshold: 0,
    slaTotalHours: 24,
    fields: [
      { key: "warehouseBlock", label: "Thuộc Kho nào", type: "select", options: ["Kho Nhà Máy (NVL / Hóa chất / BTP / Thành phẩm SX)", "Kho Kinh Doanh (Hàng hóa thương mại)"], required: true },
      { key: "causeCategory", label: "Nguyên nhân phát sinh", type: "select", options: ["Hết hạn sử dụng (Expired) lưu kho", "Không đạt kiểm định QA/QC (Rejected / OOS)", "Hư hỏng trong quá trình vận chuyển", "Sự cố nhiệt độ bảo quản / Quá chu kỳ Freeze-Thaw", "Hao hụt thử nghiệm R&D / QC"], required: true },
      { key: "disposalMethod", label: "Phương án xử lý đề xuất", type: "select", options: ["Tiêu hủy theo quy định chất thải y tế / sinh học", "Chuyển mục đích sử dụng nội bộ R&D / Đào tạo", "Trả hàng / Yêu cầu NCC bồi hoàn (Claim)"], required: true }
    ],
    defaultSteps: [
      { stepOrder: 1, stepName: "QA/QC & Trưởng bộ phận Kho xác nhận hiện trạng", roleType: "DEPT_HEAD", defaultDept: "QA/QC", defaultApprover: "Trưởng phòng QA/QC", slaHours: 6 },
      { stepOrder: 2, stepName: "Kế toán hạch toán dự phòng tổn thất", roleType: "REVIEWER", defaultDept: "Kế Toán", defaultApprover: "Kế toán trưởng", slaHours: 8 },
      { stepOrder: 3, stepName: "Ban Giám Đốc phê duyệt quyết định xử lý", roleType: "DIRECTOR", defaultDept: "Ban Giám Đốc", defaultApprover: "Ban Giám Đốc", slaHours: 10 }
    ]
  },
  {
    id: "tmpl_capex_procurement",
    codePrefix: "DXMS-KD",
    category: "TECHNICAL_OPS",
    name: "Đề xuất Cung Ứng Kinh Doanh: Mua sắm Hàng thương mại, VPP & Dịch vụ",
    icon: "🛒",
    description: "Độc lập với Cung ứng Kỹ thuật: Đề xuất Cung Ứng Kinh Doanh mua hàng hóa thương mại phân phối, trang thiết bị văn phòng, IT hoặc dịch vụ thương mại.",
    hasAmount: true,
    hasLineItems: true,
    lineItemColumns: { col1: "Tên hàng hóa thương mại / Thiết bị / Dịch vụ", col2: "Thông số / Hãng", col3: "Số lượng", col4: "Đơn giá báo giá (VNĐ)" },
    autoDirectorThreshold: 3000000,
    slaTotalHours: 24,
    fields: [
      { key: "urgencyReason", label: "Mục đích mua sắm thương mại & Tính cấp thiết", type: "textarea", placeholder: "Giải trình nhu cầu phục vụ đơn hàng khách hàng / văn phòng...", required: true },
      { key: "recommendedVendor", label: "Nhà cung cấp thương mại đề xuất", type: "text", placeholder: "Nhập tên NCC có giá và tiến độ tốt nhất..." }
    ],
    defaultSteps: [
      { stepOrder: 1, stepName: "Trưởng bộ phận duyệt nhu cầu", roleType: "DEPT_HEAD", defaultDept: "Theo phòng người tạo", defaultApprover: "Trưởng bộ phận", slaHours: 4 },
      { stepOrder: 2, stepName: "Cung Ứng Kinh Doanh thẩm định giá & NCC", roleType: "REVIEWER", defaultDept: "Cung Ứng", defaultApprover: "Trưởng bộ phận Cung Ứng KD", slaHours: 8 },
      { stepOrder: 3, stepName: "Ban Giám Đốc phê duyệt ngân sách mua", roleType: "DIRECTOR", defaultDept: "Ban Giám Đốc", defaultApprover: "Ban Giám Đốc", slaHours: 12 }
    ]
  },
  {
    id: "tmpl_factory_nvl_procurement",
    codePrefix: "DXMS-KT",
    category: "TECHNICAL_OPS",
    name: "Đề xuất Cung Ứng Kỹ Thuật: Mua sắm NVL, Hóa chất SX, Linh kiện & Hiệu chuẩn",
    icon: "🧬",
    description: "Độc lập với Cung ứng Kinh doanh: Đề xuất Cung Ứng Kỹ Thuật mua nguyên vật liệu sản xuất Kit, Amidite/cột tổng hợp Oligo, enzyme, linh kiện thiết bị hoặc thuê hiệu chuẩn ISO 13485.",
    hasAmount: true,
    hasLineItems: true,
    lineItemColumns: { col1: "Mã - Tên NVL / Hóa chất / Linh kiện / Dịch vụ HC", col2: "Hãng / Tiêu chuẩn CoA-MSDS", col3: "Số lượng", col4: "Đơn giá dự kiến (VNĐ)" },
    autoDirectorThreshold: 3000000,
    slaTotalHours: 24,
    fields: [
      { key: "techSpecRequirement", label: "Yêu cầu thông số kỹ thuật / Độ tinh khiết / CoA & MSDS", type: "textarea", placeholder: "VD: Độ tinh khiết HPLC ≥ 99%, kèm CoA theo lô và MSDS...", required: true },
      { key: "productionPlanRef", label: "Phục vụ Kế hoạch sản xuất / Đề tài R&D / Thiết bị nào", type: "text", placeholder: "VD: Định mức MRP Quý 4 / Lô Kit HPV / Máy tổng hợp Oligo...", required: true },
      { key: "recommendedTechVendor", label: "Nhà cung cấp Kỹ thuật đề xuất", type: "text", placeholder: "Nhập tên NCC Hóa chất / Linh kiện đạt chuẩn..." }
    ],
    defaultSteps: [
      { stepOrder: 1, stepName: "Trưởng phòng Khối Kỹ Thuật (R&D/SX/QA/Kho NM) duyệt", roleType: "DEPT_HEAD", defaultDept: "Theo phòng người tạo", defaultApprover: "Trưởng bộ phận", slaHours: 4 },
      { stepOrder: 2, stepName: "Cung Ứng Kỹ Thuật thẩm định NCC & Lead-time", roleType: "REVIEWER", defaultDept: "Cung Ứng Kỹ Thuật", defaultApprover: "Phụ trách Cung Ứng Kỹ Thuật", slaHours: 8 },
      { stepOrder: 3, stepName: "Ban Giám Đốc phê duyệt PO Kỹ thuật", roleType: "DIRECTOR", defaultDept: "Ban Giám Đốc", defaultApprover: "Ban Giám Đốc", slaHours: 12 }
    ]
  },

  // 5. TỜ TRÌNH BAN GIÁM ĐỐC
  {
    id: "tmpl_executive_memo",
    codePrefix: "TTr",
    category: "EXECUTIVE",
    name: "Tờ trình Ban Giám Đốc (Chủ trương / Chuyển giao Công nghệ / Dự án)",
    icon: "🏛️",
    description: "Tờ trình xin phê duyệt chủ trương đầu tư, chuyển giao công nghệ R&D sang Sản xuất (Design Transfer), ký kết hợp đồng đại lý hoặc ban hành SOP/quy chế mới.",
    hasAmount: true,
    hasLineItems: false,
    autoDirectorThreshold: 0,
    slaTotalHours: 24,
    fields: [
      { key: "backgroundBasis", label: "Căn cứ pháp lý / Tiêu chuẩn ISO / Bối cảnh thực tiễn", type: "textarea", placeholder: "Trình bày căn cứ và thực trạng hiện nay...", required: true },
      { key: "proposedSolution", label: "Nội dung phương án & Kiến nghị phê duyệt", type: "textarea", placeholder: "Trình bày chi tiết phương án đề xuất...", required: true },
      { key: "expectedImpact", label: "Hiệu quả dự kiến & Rủi ro kiểm soát", type: "textarea", placeholder: "Đánh giá lợi ích kinh tế / vận hành / chất lượng..." }
    ],
    defaultSteps: [
      { stepOrder: 1, stepName: "Trưởng bộ phận / QA-QC / Pháp chế thẩm định", roleType: "REVIEWER", defaultDept: "Pháp Chế", defaultApprover: "Trưởng bộ phận thẩm định", slaHours: 8 },
      { stepOrder: 2, stepName: "Ban Giám Đốc phê duyệt chủ trương", roleType: "DIRECTOR", defaultDept: "Ban Giám Đốc", defaultApprover: "Ban Giám Đốc", slaHours: 16 }
    ]
  }
];

function canonName(name: any): string {
  let s = String(name || "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s*\(.*?\)/g, "")
    .replace(/[\s\u00a0\u200b]+/g, " ")
    .trim();
  s = s
    .normalize("NFD")
    .replace(/([ou])([\u0300\u0301\u0309\u0303\u0323])([aey])/g, "$1$3$2")
    .normalize("NFC");
  return s;
}

export function isSamePerson(a: any, b: any): boolean {
  const x = canonName(a);
  const y = canonName(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

export function formatMoneyVND(val: any): string {
  const n = Number(val) || 0;
  if (n <= 0) return "0 đ";
  return n.toLocaleString("vi-VN", { maximumFractionDigits: 0 }) + " đ";
}

export function getStatusMeta(status: ProposalStatus) {
  switch (status) {
    case "DRAFT":
      return {
        label: "📝 Bản nháp",
        badgeCls: "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
      };
    case "PENDING":
      return {
        label: "⏳ Đang chờ duyệt",
        badgeCls: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-700"
      };
    case "RETURNED":
      return {
        label: "🔄 Yêu cầu bổ sung / Giải trình",
        badgeCls: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/80 dark:text-orange-300 dark:border-orange-700"
      };
    case "APPROVED":
      return {
        label: "✅ Đã phê duyệt",
        badgeCls: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-700"
      };
    case "EXECUTED":
      return {
        label: "🏁 Đã thực thi / Hoàn tất",
        badgeCls: "bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-950/80 dark:text-teal-300 dark:border-teal-700"
      };
    case "REJECTED":
      return {
        label: "❌ Từ chối duyệt",
        badgeCls: "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/80 dark:text-rose-300 dark:border-rose-700"
      };
    case "WITHDRAWN":
      return {
        label: "🚫 Đã rút / Hủy",
        badgeCls: "bg-slate-200 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700"
      };
    default:
      return {
        label: status,
        badgeCls: "bg-slate-100 text-slate-700 border-slate-300"
      };
  }
}

function cleanStaffDisplayName(raw: any): string {
  return String(raw || "").replace(/\s*\(.*?\)/g, "").trim();
}

function isDeputyPositionTitle(posStr?: string | null): boolean {
  const pos = String(posStr || "").toLowerCase().normalize("NFC");
  return /\bphó\b/.test(pos);
}

/**
 * Danh sách Trưởng phòng / Phó trưởng phòng (khi phòng không có Trưởng phòng thì Phó trưởng phòng có vai trò như Trưởng phòng)
 * theo cơ cấu tổ chức ABT. Dùng làm fallback khi danh sách nhân sự chưa tải xong.
 */
const DEFAULT_DEPT_LEADER_FALLBACKS: Record<string, { name: string; position: string; isDeputy: boolean } | null> = {
  "R&D": { name: "Nguyễn Quốc Bảo", position: "Trưởng phòng R&D", isDeputy: false },
  "Tổng hợp Oligo": { name: "Nguyễn Thanh Tùng", position: "Trưởng phòng Tổng hợp Oligo", isDeputy: false },
  "Hành chính": { name: "Nguyễn Văn Hiếu", position: "Trưởng phòng Hành chính", isDeputy: false },
  "QC/QA": { name: "Phan Thị Thảo Trinh", position: "Phó Trưởng phòng QC-QA", isDeputy: true },
  "Sản xuất": { name: "Đoàn Hồng Sơn", position: "Phó Trưởng phòng Sản xuất", isDeputy: true },
  "Kinh Doanh": { name: "Huỳnh Thị Ngọc Huyền", position: "Phó Trưởng phòng kinh doanh", isDeputy: true },
  "APP": { name: "Trần Tài", position: "Phó Trưởng phòng Ứng dụng", isDeputy: true },
  "KTCN": null, // Không có Trưởng/Phó phòng; Giám đốc (Nguyễn Văn Tùng) trực tiếp phụ trách & phê duyệt
  "Cung ứng Kho": null, // Chưa có Trưởng/Phó phòng; PGĐ Kỹ thuật (Nguyễn Duy Khánh) phê duyệt
  "IT": null, // Chưa có Trưởng/Phó phòng; PGĐ Kinh doanh (Đỗ Ngọc Diễm Trúc) phê duyệt
  "Marketing": null // Chưa có Trưởng/Phó phòng; PGĐ Kinh doanh (Đỗ Ngọc Diễm Trúc) phê duyệt
};

const KNOWN_DEPT_LEADERS_AND_DEPUTIES = [
  "Nguyễn Quốc Bảo",
  "Nguyễn Thanh Tùng",
  "Nguyễn Văn Hiếu",
  "Tô Khánh Nhựt",
  "Phan Thị Thảo Trinh",
  "Đoàn Hồng Sơn",
  "Huỳnh Thị Ngọc Huyền",
  "Trần Tài"
];

/**
 * Tìm người đứng đầu phòng ban:
 * 1. Ưu tiên Trưởng phòng / Trưởng bộ phận.
 * 2. Nếu phòng ban không có Trưởng phòng thì Phó trưởng phòng có vai trò như Trưởng phòng.
 */
export function resolveDeptLeaderInfo(
  deptName: string,
  personnelList?: any[]
): { name: string; position: string; isDeputy: boolean } | null {
  const canonDept = canonicalDepartment(deptName);
  const deptMembers = (personnelList || []).filter((p: any) => {
    const pDept = String(p?.department || "").trim();
    if (!pDept) return false;
    if (canonDept && canonicalDepartment(pDept) === canonDept) return true;
    return isSameWorkspaceDept(pDept, deptName);
  });

  // 1. Tìm Trưởng phòng (không có chữ Phó)
  const primaryHead = deptMembers.find((p: any) => {
    const pos = String(p?.position || "");
    return isDepartmentLeaderPosition(pos) && !isDeputyPositionTitle(pos);
  });
  if (primaryHead?.full_name || primaryHead?.name) {
    return {
      name: cleanStaffDisplayName(primaryHead.full_name || primaryHead.name),
      position: String(primaryHead.position || "Trưởng phòng"),
      isDeputy: false
    };
  }

  // 2. Nếu phòng không có Trưởng phòng -> Phó trưởng phòng đảm nhiệm vai trò Trưởng phòng
  const deputyHead = deptMembers.find((p: any) => {
    const pos = String(p?.position || "");
    return isDepartmentLeaderPosition(pos) && isDeputyPositionTitle(pos);
  });
  if (deputyHead?.full_name || deputyHead?.name) {
    return {
      name: cleanStaffDisplayName(deputyHead.full_name || deputyHead.name),
      position: String(deputyHead.position || "Phó Trưởng phòng"),
      isDeputy: true
    };
  }

  // 3. Fallback theo danh mục chuẩn của công ty
  if (canonDept && Object.prototype.hasOwnProperty.call(DEFAULT_DEPT_LEADER_FALLBACKS, canonDept)) {
    return DEFAULT_DEPT_LEADER_FALLBACKS[canonDept];
  }
  return null;
}

/**
 * Xác định Lãnh đạo Ban Giám Đốc phụ trách trực tiếp phòng ban / khối:
 * - Phòng Kỹ thuật Công nghệ (KTCN / Kỹ Thuật – Thiết Bị): Giám đốc (GĐ) — Nguyễn Văn Tùng duyệt.
 * - Các phòng còn lại thuộc Khối Kỹ thuật (R&D, Sản xuất, Tổng hợp Oligo, QC/QA, Cung ứng Kho): PGĐ Kỹ thuật — Nguyễn Duy Khánh duyệt.
 * - Các phòng thuộc Khối Kinh doanh & Văn phòng (Kinh Doanh, APP, Marketing, IT, Hành chính - Kế toán - Nhân sự): PGĐ Kinh doanh — Đỗ Ngọc Diễm Trúc duyệt.
 */
export function getSupervisingBodForDept(
  deptName: string,
  personnelList?: any[]
): { approverName: string; roleTitle: string; dept: string } {
  const canonDept = canonicalDepartment(deptName);
  const normDept = normalizeWorkspaceDept(deptName);
  const dLower = String(deptName || "").toLowerCase().normalize("NFC");

  const isKtcn =
    canonDept === "KTCN" ||
    normDept === "Kỹ Thuật – Thiết Bị" ||
    dLower.includes("ktcn") ||
    dLower.includes("kỹ thuật công nghệ") ||
    dLower.includes("thiết bị");

  if (isKtcn) {
    const gd = (personnelList || []).find((p: any) => {
      const pos = String(p?.position || "").toLowerCase().normalize("NFC").trim();
      return (pos === "giám đốc" || pos.startsWith("tổng giám đốc")) && !pos.includes("phó");
    });
    return {
      approverName: cleanStaffDisplayName(gd?.full_name || gd?.name) || "Nguyễn Văn Tùng",
      roleTitle: "Giám đốc",
      dept: "Ban Giám Đốc"
    };
  }

  const isTechBlock =
    canonDept === "R&D" ||
    canonDept === "Sản xuất" ||
    canonDept === "Tổng hợp Oligo" ||
    canonDept === "QC/QA" ||
    canonDept === "Cung ứng Kho" ||
    WORKSPACE_BLOCKS.BLOCK_TECHNICAL.depts.has(normDept);

  if (isTechBlock) {
    const pgdKt = (personnelList || []).find((p: any) => {
      const pos = String(p?.position || "").toLowerCase().normalize("NFC");
      return (pos.includes("phó giám đốc") || pos.includes("pgđ")) && pos.includes("kỹ thuật");
    });
    return {
      approverName: cleanStaffDisplayName(pgdKt?.full_name || pgdKt?.name) || "Nguyễn Duy Khánh",
      roleTitle: "PGĐ Kỹ thuật",
      dept: "Ban Giám Đốc"
    };
  }

  const pgdKd = (personnelList || []).find((p: any) => {
    const pos = String(p?.position || "").toLowerCase().normalize("NFC");
    return (pos.includes("phó giám đốc") || pos.includes("pgđ")) && pos.includes("kinh doanh");
  });
  return {
    approverName: cleanStaffDisplayName(pgdKd?.full_name || pgdKd?.name) || "Đỗ Ngọc Diễm Trúc",
    roleTitle: "PGĐ Kinh doanh",
    dept: "Ban Giám Đốc"
  };
}

/**
 * Kiểm tra nhân sự có phải là Trưởng phòng hoặc Phó trưởng phòng (cấp lãnh đạo phòng ban) hay không.
 */
export function isPersonDeptHeadOrDeputy(
  personName: string,
  deptName?: string,
  personnelList?: any[]
): boolean {
  const clean = cleanStaffDisplayName(personName);
  if (!clean) return false;
  const matchedPerson = (personnelList || []).find((p: any) =>
    isSamePerson(p?.full_name || p?.name, clean)
  );
  if (matchedPerson) {
    if (isDepartmentLeaderPosition(matchedPerson.position)) return true;
    const r = String(matchedPerson.role || "").toLowerCase();
    if (
      r.endsWith("_head") ||
      r.endsWith("_lead") ||
      r.includes("trưởng phòng") ||
      r.includes("phó trưởng phòng") ||
      r.includes("phó phòng")
    ) {
      return true;
    }
  }
  if (KNOWN_DEPT_LEADERS_AND_DEPUTIES.some((n) => isSamePerson(n, clean))) {
    return true;
  }
  if (deptName) {
    const deptLeader = resolveDeptLeaderInfo(deptName, personnelList);
    if (deptLeader && isSamePerson(deptLeader.name, clean)) {
      return true;
    }
  }
  return false;
}

export function isGenericRoleApproverLabel(label: any): boolean {
  const s = String(label || "").toLowerCase().normalize("NFC").trim();
  if (!s) return true;
  return (
    s === "trưởng bộ phận" ||
    s === "ban giám đốc" ||
    s === "kế toán trưởng" ||
    s === "kế toán viên" ||
    s === "nhân viên kế toán" ||
    s === "chuyên viên kế toán" ||
    s === "thủ quỹ" ||
    s === "hành chính nhân sự" ||
    s === "kế toán" ||
    s === "pháp chế" ||
    s.startsWith("trưởng phòng") ||
    s.startsWith("phó trưởng phòng") ||
    s.startsWith("trưởng bộ phận") ||
    s.startsWith("trưởng kho") ||
    s.startsWith("thủ kho") ||
    s.startsWith("trưởng cung ứng") ||
    s.startsWith("phụ trách")
  );
}

/**
 * Loại bỏ tên nhân sự cũ của TBR (VD: "Võ Thị Ngọc Giàu") nếu còn sót trong biểu mẫu / đề xuất cũ,
 * chuyển về chức danh chuẩn "Kế toán trưởng" của ABT.
 */
export function sanitizeLegacyTbrApproverName(approverRaw: any): string {
  const s = String(approverRaw || "").trim();
  if (/võ\s+thị\s+ngọc\s+giàu|ngọc\s+giàu/i.test(s.normalize("NFC"))) {
    return "Kế toán trưởng";
  }
  return s;
}

/**
 * Tự động suy luận `roleType` đúng theo Phòng ban (`dept`), Người duyệt (`approver`) và Tên bước (`stepName`).
 * Khắc phục lỗi khi người dùng sửa bước `DIRECTOR` (Ban Giám Đốc) hoặc bấm `+ Thêm cấp phê duyệt` trong Thiết kế Biểu mẫu
 * thành `Phòng ban: Kế Toán` / `Người duyệt: Kế toán trưởng` nhưng `roleType` ẩn bên dưới vẫn giữ `"DIRECTOR"`,
 * khiến khi tạo phiếu mới bị ghi đè ngược về `Ban Giám Đốc` (`Đỗ Ngọc Diễm Trúc`).
 */
export function inferProposalStepRoleType(
  deptRaw: any,
  approverRaw: any,
  stepNameRaw: any,
  fallbackRoleType: "DEPT_HEAD" | "REVIEWER" | "DIRECTOR" | "EXECUTOR" = "REVIEWER"
): "DEPT_HEAD" | "REVIEWER" | "DIRECTOR" | "EXECUTOR" {
  const dept = String(deptRaw || "").toLowerCase().normalize("NFC").trim();
  const approver = sanitizeLegacyTbrApproverName(approverRaw).toLowerCase().normalize("NFC").trim();
  const stepName = String(stepNameRaw || "").toLowerCase().normalize("NFC").trim();

  // 1. Nếu chỉ định rõ phòng Kế toán / Kế toán trưởng / Hành chính / Pháp chế / QA-QC / Cung ứng / Kho -> REVIEWER hoặc EXECUTOR
  if (
    dept.includes("kế toán") ||
    approver.includes("kế toán") ||
    stepName.includes("kế toán")
  ) {
    return "REVIEWER";
  }

  // 2. Nếu là bước Trưởng bộ phận của chính phòng người tạo
  if (
    dept === "theo phòng người tạo" ||
    approver === "trưởng bộ phận" ||
    /^trưởng\s+bộ\s+phận\b/i.test(stepName)
  ) {
    return "DEPT_HEAD";
  }

  // 3. Nếu phòng ban hoặc người duyệt là Ban Giám Đốc / Giám đốc / PGĐ
  if (
    dept === "ban giám đốc" ||
    dept === "bgđ" ||
    approver === "ban giám đốc" ||
    approver === "giám đốc" ||
    approver.startsWith("pgđ") ||
    approver.startsWith("phó giám đốc")
  ) {
    return "DIRECTOR";
  }

  // 4. Nếu phòng ban đã ghi cụ thể một phòng chuyên môn khác Ban Giám Đốc -> không giữ roleType DIRECTOR
  if (dept && dept !== "ban giám đốc" && fallbackRoleType === "DIRECTOR") {
    return "REVIEWER";
  }

  return fallbackRoleType;
}

/**
 * Tìm nhân sự có chức danh "Kế toán trưởng" trong danh sách nhân sự ABT (`personnelList`).
 * Nếu công ty chưa bổ nhiệm nhân sự nào mang chức danh "Kế toán trưởng", giữ nguyên nhãn "Kế toán trưởng"
 * đúng như cấu hình trong mẫu quy trình (không tự ý đổi sang Ban Giám Đốc hay Trưởng phòng Hành chính).
 */
export function resolveChiefAccountantApprover(personnelList?: any[]): string {
  const matched = (personnelList || []).find((p: any) => {
    const pos = String(p?.position || "").toLowerCase().normalize("NFC").trim();
    const name = String(p?.full_name || p?.name || "").normalize("NFC");
    if (/võ\s+thị\s+ngọc\s+giàu|ngọc\s+giàu/i.test(name)) return false;
    return pos.includes("kế toán trưởng") || pos === "chief accountant";
  });
  if (matched?.full_name || matched?.name) {
    return cleanStaffDisplayName(matched.full_name || matched.name);
  }
  return "Kế toán trưởng";
}

/**
 * Tìm nhân sự Kế toán viên cụ thể theo cấu hình biểu mẫu (`templateSteps`) hoặc danh sách nhân sự ABT (`personnelList`).
 * Khắc phục trường hợp bước duyệt ghi "Kế toán viên" nhưng chưa hiển thị tên Kế toán viên đã cấu hình trong mẫu (VD: "Trần Hồng Thi").
 */
export function resolveAccountantStaffApprover(
  personnelList?: any[],
  templateSteps?: ProposalStepTemplate[],
  stepName?: string,
  stepIdx?: number
): string {
  if (Array.isArray(templateSteps) && templateSteps.length > 0) {
    const normStepName = canonName(stepName || "");
    const byName = templateSteps.find(
      (t) =>
        (normStepName && canonName(t.stepName) === normStepName) ||
        String(t.stepName || "").toLowerCase().normalize("NFC").includes("kế toán viên")
    );
    if (byName?.defaultApprover && !isGenericRoleApproverLabel(byName.defaultApprover)) {
      return cleanStaffDisplayName(sanitizeLegacyTbrApproverName(byName.defaultApprover));
    }
    if (typeof stepIdx === "number" && templateSteps[stepIdx]?.defaultApprover) {
      const cand = templateSteps[stepIdx].defaultApprover;
      if (!isGenericRoleApproverLabel(cand)) {
        return cleanStaffDisplayName(sanitizeLegacyTbrApproverName(cand));
      }
    }
  }
  const matched = (personnelList || []).find((p: any) => {
    const pos = String(p?.position || "").toLowerCase().normalize("NFC").trim();
    const name = String(p?.full_name || p?.name || "").normalize("NFC");
    if (/võ\s+thị\s+ngọc\s+giàu|ngọc\s+giàu/i.test(name)) return false;
    return (
      pos.includes("kế toán viên") ||
      pos === "kế toán" ||
      (pos.includes("kế toán") && !pos.includes("kế toán trưởng"))
    );
  });
  if (matched?.full_name || matched?.name) {
    return cleanStaffDisplayName(matched.full_name || matched.name);
  }
  return "Trần Hồng Thi";
}

export function formatEscalatedStepName(rawStepName: string, bodRoleTitle: string): string {
  const s = String(rawStepName || "").trim();
  if (!s) return `${bodRoleTitle} phê duyệt`;
  if (s.toLowerCase().startsWith(bodRoleTitle.toLowerCase())) return s;
  const replaced = s
    .replace(/^Trưởng phòng Khối Kỹ Thuật\s*\([^)]*\)/i, bodRoleTitle)
    .replace(/^Trưởng phòng chuyên môn\s*\([^)]*\)/i, bodRoleTitle)
    .replace(
      /^Trưởng\s*\/?\s*(?:Phó\s+)?(?:bộ phận|phòng)(?:\s+[A-Za-zÀ-ỹ0-9/–\-\s]+?(?=\s+(?:duyệt|xác nhận|thẩm định|kiểm tra|phê duyệt)))?/i,
      bodRoleTitle
    )
    .replace(/^Trưởng\s+(?:bộ phận|phòng)(?:\s+(?:Kinh doanh|Application|QA\/QC|R&D|Sản xuất|KTCN))?/i, bodRoleTitle);
  if (replaced !== s) return replaced;
  return `${bodRoleTitle} — ${s}`;
}

/**
 * Chuẩn hóa luồng bước duyệt của một đề xuất dựa theo người đề xuất và phòng ban:
 * - Nhân viên đề xuất -> Trưởng phòng (hoặc Phó trưởng phòng nếu phòng không có Trưởng phòng) duyệt.
 * - Phó/Trưởng phòng đề xuất (hoặc phòng không có Trưởng/Phó phòng như KTCN) -> nâng cấp bước DEPT_HEAD lên
 *   PGĐ phụ trách khối (PGĐ Kỹ thuật Nguyễn Duy Khánh cho Khối Kỹ thuật, PGĐ Kinh doanh Đỗ Ngọc Diễm Trúc cho Khối Kinh doanh),
 *   riêng phòng Kỹ thuật Công nghệ (KTCN) do Giám đốc Nguyễn Văn Tùng duyệt.
 * - Các bước thẩm định chuyên môn như `Kế Toán` / `Kế toán trưởng` giữ nguyên theo đúng cấu hình biểu mẫu,
 *   KHÔNG bị ghi đè sang Ban Giám Đốc.
 */
export function normalizeProposalStepsForRequester(
  steps: ProposalStepInstance[],
  requesterDept: string,
  requesterName: string,
  personnelList?: any[],
  templateSteps?: ProposalStepTemplate[]
): { steps: ProposalStepInstance[]; changed: boolean } {
  if (!Array.isArray(steps) || steps.length === 0) return { steps: [], changed: false };
  const resolvedReqDept = requesterDept && requesterDept !== "all" ? requesterDept : "Kinh Doanh";
  const reqIsLeader = isPersonDeptHeadOrDeputy(requesterName, resolvedReqDept, personnelList);
  let changed = false;

  const mapped = steps.map((rawSt, stepIdx) => {
    // Làm sạch tên Kế toán trưởng TBR cũ ("Võ Thị Ngọc Giàu") nếu có và đồng bộ lại roleType theo phòng ban/người duyệt
    const cleanApprover = sanitizeLegacyTbrApproverName(rawSt.approverName);
    const inferredRole = inferProposalStepRoleType(rawSt.dept, cleanApprover, rawSt.stepName, rawSt.roleType);
    let st = rawSt;
    if (cleanApprover !== rawSt.approverName || inferredRole !== rawSt.roleType) {
      changed = true;
      st = { ...rawSt, approverName: cleanApprover, roleType: inferredRole };
    }

    // Không tự ý đổi các bước đã duyệt xong
    if (st.status === "APPROVED" || st.status === "REJECTED" || st.status === "SKIPPED") {
      return st;
    }

    // Nếu biểu mẫu quy trình đã chỉ định đích danh người duyệt cụ thể cho bước này (VD: Kế toán viên = "Trần Hồng Thi")
    // mà trên bước của phiếu đang để nhãn chức danh chung (VD: "Kế toán viên"), tự động đồng bộ đúng tên người duyệt từ mẫu.
    if (Array.isArray(templateSteps) && templateSteps.length > 0 && isGenericRoleApproverLabel(st.approverName)) {
      const matchedTmplStep =
        templateSteps.find((t) => canonName(t.stepName) === canonName(st.stepName)) ||
        (templateSteps[stepIdx] && canonName(templateSteps[stepIdx].defaultDept) === canonName(st.dept)
          ? templateSteps[stepIdx]
          : undefined);
      if (matchedTmplStep?.defaultApprover && !isGenericRoleApproverLabel(matchedTmplStep.defaultApprover)) {
        const concreteFromTmpl = cleanStaffDisplayName(sanitizeLegacyTbrApproverName(matchedTmplStep.defaultApprover));
        if (concreteFromTmpl && st.approverName !== concreteFromTmpl) {
          changed = true;
          st = { ...st, approverName: concreteFromTmpl };
        }
      }
    }

    const approverLower = String(st.approverName || "").toLowerCase().normalize("NFC").trim();
    const deptLower = String(st.dept || "").toLowerCase().normalize("NFC").trim();
    const stepNameLower = String(st.stepName || "").toLowerCase().normalize("NFC").trim();

    // Nếu bước duyệt được cấu hình cho Kế toán / Kế toán trưởng / Kế toán viên: giữ nguyên phòng Kế Toán & đúng người duyệt
    if (
      approverLower === "kế toán trưởng" ||
      approverLower === "kế toán viên" ||
      approverLower === "kế toán" ||
      deptLower === "kế toán" ||
      stepNameLower.includes("kế toán trưởng") ||
      stepNameLower.includes("kế toán viên")
    ) {
      const targetDept = st.dept && st.dept !== "Ban Giám Đốc" ? st.dept : "Kế Toán";
      const isAccountantStaffStep =
        approverLower === "kế toán viên" ||
        approverLower === "nhân viên kế toán" ||
        approverLower === "chuyên viên kế toán" ||
        (stepNameLower.includes("kế toán viên") && !stepNameLower.includes("kế toán trưởng"));
      const targetApprover = !isGenericRoleApproverLabel(st.approverName)
        ? st.approverName
        : isAccountantStaffStep
          ? resolveAccountantStaffApprover(personnelList, templateSteps, st.stepName, stepIdx)
          : resolveChiefAccountantApprover(personnelList);
      if (st.dept !== targetDept || st.approverName !== targetApprover || st.roleType !== "REVIEWER") {
        changed = true;
        return {
          ...st,
          roleType: "REVIEWER" as const,
          dept: targetDept,
          approverName: targetApprover
        };
      }
      return st;
    }

    const isGenericOwnDeptStep =
      String(st.approverName || "").trim() === "Trưởng bộ phận" ||
      /^trưởng\s+bộ\s+phận/i.test(String(st.stepName || "").trim());
    const stepTargetDept =
      !st.dept || st.dept === "Theo phòng người tạo" || isGenericOwnDeptStep ? resolvedReqDept : st.dept;
    const isOwnDeptStep =
      isGenericOwnDeptStep ||
      isSameWorkspaceDept(stepTargetDept, resolvedReqDept) ||
      (Boolean(canonicalDepartment(stepTargetDept)) &&
        canonicalDepartment(stepTargetDept) === canonicalDepartment(resolvedReqDept));

    const isDeptHeadStep =
      st.roleType === "DEPT_HEAD" ||
      String(st.approverName || "").trim() === "Trưởng bộ phận" ||
      /^trưởng\s+(bộ phận|phòng)/i.test(String(st.stepName || "").trim());

    if (isDeptHeadStep && st.roleType !== "REVIEWER" && st.roleType !== "EXECUTOR") {
      const deptLeader = resolveDeptLeaderInfo(stepTargetDept, personnelList);
      const shouldEscalateToBod =
        (isOwnDeptStep && reqIsLeader) ||
        !deptLeader ||
        isSamePerson(deptLeader.name, requesterName) ||
        isSamePerson(st.approverName, requesterName);

      if (shouldEscalateToBod) {
        const bod = getSupervisingBodForDept(
          isOwnDeptStep ? resolvedReqDept : stepTargetDept,
          personnelList
        );
        const nextStepName = formatEscalatedStepName(st.stepName, bod.roleTitle);
        if (
          st.roleType !== "DIRECTOR" ||
          st.dept !== bod.dept ||
          st.approverName !== bod.approverName ||
          st.stepName !== nextStepName
        ) {
          changed = true;
          return {
            ...st,
            stepName: nextStepName,
            roleType: "DIRECTOR" as const,
            dept: bod.dept,
            approverName: bod.approverName
          };
        }
        return st;
      }

      // Nhân viên thường trình -> gán đích danh Trưởng phòng hoặc Phó trưởng phòng phụ trách phòng đó
      if (deptLeader && isGenericRoleApproverLabel(st.approverName)) {
        if (st.approverName !== deptLeader.name) {
          changed = true;
          return {
            ...st,
            approverName: deptLeader.name
          };
        }
      }
      return st;
    }

    if (st.roleType === "DIRECTOR" || st.dept === "Ban Giám Đốc") {
      if (isGenericRoleApproverLabel(st.approverName)) {
        const bod = getSupervisingBodForDept(resolvedReqDept, personnelList);
        if (st.approverName !== bod.approverName || st.dept !== "Ban Giám Đốc") {
          changed = true;
          return {
            ...st,
            dept: "Ban Giám Đốc",
            approverName: bod.approverName
          };
        }
      }
      return st;
    }

    // Bước REVIEWER / EXECUTOR có nhãn chung (VD: "Trưởng phòng QA/QC", "Hành Chính Nhân Sự")
    if (isGenericRoleApproverLabel(st.approverName)) {
      const deptLeader = resolveDeptLeaderInfo(stepTargetDept, personnelList);
      if (deptLeader) {
        let resolvedName = deptLeader.name;
        if (isSamePerson(resolvedName, requesterName) && canonicalDepartment(stepTargetDept) === "Hành chính") {
          resolvedName = "Tô Khánh Nhựt";
        }
        if (st.approverName !== resolvedName) {
          changed = true;
          return {
            ...st,
            approverName: resolvedName
          };
        }
      }
    }

    return st;
  });

  // Khử bước DIRECTOR trùng lặp liên tiếp (khi bước 1 đã nâng cấp lên đúng PGĐ/GĐ của bước kế tiếp)
  const deduped: ProposalStepInstance[] = [];
  for (const st of mapped) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      prev.roleType === "DIRECTOR" &&
      st.roleType === "DIRECTOR" &&
      isSamePerson(prev.approverName, st.approverName) &&
      prev.status !== "APPROVED" &&
      st.status === "WAITING"
    ) {
      changed = true;
      continue;
    }
    deduped.push(st);
  }

  const reindexed = deduped.map((st, idx) => {
    if (st.stepOrder !== idx + 1) {
      changed = true;
      return { ...st, stepOrder: idx + 1 };
    }
    return st;
  });

  return { steps: reindexed, changed };
}

export function isLeaveProposal(p: Partial<ProposalItem> | null | undefined): boolean {
  if (!p) return false;
  const tid = String(p.templateId || "").toLowerCase();
  const code = String(p.proposalCode || "").toUpperCase();
  const tname = String(p.templateName || "").toLowerCase();
  return (
    tid === "tmpl_leave_request" ||
    code.startsWith("DXNP") ||
    code.startsWith("TBNP") ||
    tname.includes("nghỉ phép") ||
    tname.includes("vắng mặt")
  );
}

export function isBusinessTripProposal(p: Partial<ProposalItem> | null | undefined): boolean {
  if (!p) return false;
  const tid = String(p.templateId || "").toLowerCase();
  const code = String(p.proposalCode || "").toUpperCase();
  const tname = String(p.templateName || "").toLowerCase();
  return (
    tid === "tmpl_business_trip" ||
    code.startsWith("DXCT") ||
    tname.includes("đi công tác") ||
    tname.includes("lịch trình làm việc")
  );
}

/**
 * Xác định chế độ hiển thị mặc định chuẩn quản trị doanh nghiệp cho từng mẫu đề xuất:
 * - "PUBLIC": Đơn xin nghỉ phép (DXNP - công khai lịch ngày nghỉ & người nhận bàn giao nhưng ẩn lý do riêng) và Tờ trình Ban Giám Đốc / Chủ trương chung.
 * - "DEPT": Đề xuất Đi công tác (DXCT), Mua sắm vật tư, Xuất kho mẫu Demo / Kho Nhà máy, Xử lý hàng hỏng.
 * - "PRIVATE": Đề nghị Thanh toán (DNTT), Tạm ứng (DNTU), Hoàn ứng (QTHU), Xuất hóa đơn (DNXHD), Chiết khấu đặc biệt (DXCK), Công nợ (DXCN), Tăng ca (DKTC).
 */
export function resolveDefaultTemplateVisibility(
  tmpl?: Partial<ProposalTemplate> | null
): ProposalVisibility {
  if (tmpl?.defaultVisibility && ["PRIVATE", "DEPT", "PUBLIC"].includes(tmpl.defaultVisibility)) {
    return tmpl.defaultVisibility;
  }
  const id = String(tmpl?.id || "").toLowerCase();
  const prefix = String(tmpl?.codePrefix || "").toUpperCase();
  const cat = String(tmpl?.category || "").toUpperCase();

  if (id === "tmpl_leave_request" || prefix === "DXNP") return "PUBLIC";
  if (cat === "EXECUTIVE" || id === "tmpl_executive_memo" || prefix === "TTR") return "PUBLIC";
  if (id === "tmpl_business_trip" || prefix === "DXCT") return "DEPT";
  if (cat === "TECHNICAL_OPS") return "DEPT";
  // FINANCE, COMMERCIAL, OVERTIME -> mặc định PRIVATE (Bảo mật theo luồng duyệt)
  return "PRIVATE";
}

/**
 * Lấy chế độ hiển thị hiệu lực của một tờ trình (nếu tờ trình cũ chưa có trường `visibility` thì suy luận từ mẫu đề xuất).
 */
export function getEffectiveProposalVisibility(
  p: Partial<ProposalItem> | null | undefined,
  template?: Partial<ProposalTemplate> | null
): ProposalVisibility {
  if (p?.visibility && ["PRIVATE", "DEPT", "PUBLIC"].includes(p.visibility)) {
    return p.visibility;
  }
  if (template?.defaultVisibility && ["PRIVATE", "DEPT", "PUBLIC"].includes(template.defaultVisibility)) {
    return template.defaultVisibility;
  }
  return resolveDefaultTemplateVisibility({
    id: p?.templateId,
    codePrefix: String(p?.proposalCode || "").split("-")[0],
    category: p?.category
  });
}

/**
 * Kiểm tra người dùng có nằm trực tiếp trong luồng phê duyệt / thực thi / theo dõi của tờ trình hay không:
 * - Ban Giám Đốc / Quản trị viên (`isDirector`)
 * - Chính người tạo đề xuất (`requesterName`)
 * - Người duyệt tại bất kỳ bước nào (`steps[].approverName` hoặc `decidedBy`) hoặc Trưởng/Phó phòng của bước mang nhãn chức danh chung cùng phòng
 * - Người thực thi (`executorName`), Người nhận bàn giao công việc (`formValues.handoverStaff`), Thành viên cùng đi công tác (`formValues.companions`)
 * - Người theo dõi (`followers`)
 */
export function isUserDirectlyInProposalFlow(
  p: ProposalItem,
  currentStaffName: string,
  userDept: string,
  isDirector: boolean,
  isManager: boolean,
  personnelList?: any[]
): boolean {
  if (!p) return false;
  if (isDirector) return true;
  if (!currentStaffName) return false;

  if (isSamePerson(p.requesterName, currentStaffName)) return true;
  if (p.executorName && isSamePerson(p.executorName, currentStaffName)) return true;
  if (Array.isArray(p.followers) && p.followers.some((f) => isSamePerson(f, currentStaffName))) return true;

  const handover = String(p.formValues?.handoverStaff || p.formValues?.handover_person || "").trim();
  if (handover && isSamePerson(handover, currentStaffName)) return true;

  const companions = String(p.formValues?.companions || "").trim();
  if (
    companions &&
    companions
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .some((c) => isSamePerson(c, currentStaffName))
  ) {
    return true;
  }

  const isLeader = isManager || isPersonDeptHeadOrDeputy(currentStaffName, userDept, personnelList);
  // Trưởng/Phó phòng của chính người đề xuất luôn nằm trong luồng quản lý trực tiếp của nhân viên phòng mình
  if (
    isLeader &&
    userDept &&
    (isSameWorkspaceDept(p.requesterDept, userDept) ||
      (Boolean(canonicalDepartment(p.requesterDept)) &&
        canonicalDepartment(p.requesterDept) === canonicalDepartment(userDept)))
  ) {
    return true;
  }

  for (const st of p.steps || []) {
    if (!st) continue;
    if (st.approverName && isSamePerson(st.approverName, currentStaffName)) return true;
    if (st.decidedBy && isSamePerson(st.decidedBy, currentStaffName)) return true;
    if (userDept && canonName(st.approverName) === canonName(userDept)) return true;
    // Nếu bước duyệt để nhãn chức danh chung (VD: "Trưởng bộ phận", "Kế toán trưởng", "Hành Chính Nhân Sự") thì Trưởng/Phó phòng của phòng đó nằm trong luồng
    if (isLeader && userDept && isGenericRoleApproverLabel(st.approverName)) {
      const sameStepDept =
        isSameWorkspaceDept(st.dept, userDept) ||
        (Boolean(canonicalDepartment(st.dept)) &&
          canonicalDepartment(st.dept) === canonicalDepartment(userDept));
      if (sameStepDept) return true;
    }
  }

  return false;
}

/**
 * Kiểm tra người dùng có được xem toàn bộ chi tiết nhạy cảm (Lý do riêng tư, Tệp đính kèm, Thảo luận) của Đơn xin nghỉ phép hay không.
 * Với Đơn nghỉ phép để chế độ PUBLIC, đồng nghiệp ngoài luồng vẫn thấy Lịch ngày nghỉ & Người bàn giao nhưng ẩn Lý do cá nhân & File đính kèm.
 */
export function canUserSeeFullLeaveDetails(
  p: ProposalItem,
  currentStaffName: string,
  userDept: string,
  isDirector: boolean,
  isManager: boolean,
  personnelList?: any[]
): boolean {
  if (isUserDirectlyInProposalFlow(p, currentStaffName, userDept, isDirector, isManager, personnelList)) {
    return true;
  }
  // Phòng Hành chính - Nhân sự & Kế toán được xem để tổng hợp chấm công & chế độ BHXH
  const canonUserDept = canonicalDepartment(userDept);
  const normUserDept = normalizeWorkspaceDept(userDept);
  if (
    canonUserDept === "Hành chính" ||
    normUserDept === "Hành Chính Nhân Sự" ||
    normUserDept === "Kế Toán"
  ) {
    return true;
  }
  return false;
}

/**
 * Kiểm tra người dùng hiện tại có quyền nhìn thấy tờ trình `p` trên danh sách hay không, theo 3 chế độ hiển thị:
 * - Bản nháp (`DRAFT`): chỉ người tạo (hoặc BGĐ) thấy.
 * - `PRIVATE` (Bảo mật theo luồng duyệt): chỉ những người trực tiếp trong luồng (`isUserDirectlyInProposalFlow`) thấy.
 * - `DEPT` (Nội bộ phòng ban & Người duyệt): những người trong luồng + nhân sự cùng phòng ban với người tạo (`requesterDept`).
 * - `PUBLIC` (Công khai toàn công ty): mọi nhân viên đã đăng nhập đều thấy.
 */
export function canUserViewProposal(
  p: ProposalItem,
  currentStaffName: string,
  userDept: string,
  isDirector: boolean,
  isManager: boolean,
  personnelList?: any[],
  template?: Partial<ProposalTemplate> | null
): boolean {
  if (!p) return false;
  if (isDirector) return true;
  // Bản nháp chưa gửi duyệt: chỉ chính người tạo mới thấy
  if (p.status === "DRAFT") {
    return isSamePerson(p.requesterName, currentStaffName);
  }
  if (isUserDirectlyInProposalFlow(p, currentStaffName, userDept, isDirector, isManager, personnelList)) {
    return true;
  }
  const vis = getEffectiveProposalVisibility(p, template);
  if (vis === "PUBLIC") {
    return true;
  }
  if (vis === "DEPT") {
    if (!userDept) return false;
    return (
      isSameWorkspaceDept(p.requesterDept, userDept) ||
      (Boolean(canonicalDepartment(p.requesterDept)) &&
        canonicalDepartment(p.requesterDept) === canonicalDepartment(userDept))
    );
  }
  // vis === "PRIVATE"
  return false;
}

export function isProposalWaitingForUser(
  p: ProposalItem,
  currentStaffName: string,
  userDept: string,
  isDirector: boolean,
  isManager: boolean
): boolean {
  if (!p || p.status !== "PENDING") return false;
  const activeStep = (p.steps || []).find((s) => s.status === "PENDING_NOW") || p.steps?.[p.currentStepIndex];
  if (!activeStep) return false;
  // Người đề xuất không tự duyệt bước Trưởng bộ phận của chính mình
  if (activeStep.roleType === "DEPT_HEAD" && isSamePerson(p.requesterName, currentStaffName)) {
    return false;
  }
  if (isSamePerson(activeStep.approverName, currentStaffName)) return true;
  if (userDept && canonName(activeStep.approverName) === canonName(userDept)) return true;
  // Nếu một thành viên BGĐ nghỉ / vắng mặt mà không lập đơn xin nghỉ phép hay thông báo nghỉ phép,
  // bất kỳ thành viên nào khác trong Ban Giám Đốc (isDirector) đều có thể duyệt thay bước DIRECTOR / Ban Giám Đốc để không bị tắc luồng.
  if (isDirector && (activeStep.roleType === "DIRECTOR" || activeStep.dept === "Ban Giám Đốc")) {
    return true;
  }
  // Nếu người hiện tại được chỉ định làm Người nhận bàn giao / Ủy quyền (handoverStaff) trong một phiếu báo vắng mặt đang còn hiệu lực hôm nay của người duyệt bước này -> cho phép duyệt thay theo ủy quyền
  const sameDept =
    canonName(activeStep.dept) === canonName(userDept) ||
    isSameWorkspaceDept(activeStep.dept, userDept) ||
    (Boolean(canonicalDepartment(activeStep.dept)) &&
      canonicalDepartment(activeStep.dept) === canonicalDepartment(userDept));
  if (
    (isManager || isPersonDeptHeadOrDeputy(currentStaffName, userDept)) &&
    (activeStep.roleType === "DEPT_HEAD" || isGenericRoleApproverLabel(activeStep.approverName)) &&
    sameDept
  ) {
    return true;
  }
  return false;
}

export interface ProposalsApprovalViewProps {
  currentStaffName: string;
  userDept: string;
  rolePerspective: "director" | "manager" | "staff";
  isDirector: boolean;
  isManager: boolean;
  selectedDept: string;
  searchQuery: string;
  departments: Array<{ id: string; name: string }>;
  personnelList: any[];
  customerList: any[];
  supplierList: any[];
  productList: any[];
  proposals: ProposalItem[];
  onSaveProposals: (nextList: ProposalItem[]) => Promise<void>;
  onPreviewAttachment: (att: Attachment) => void;
  onCreateTaskFromProposal: (proposal: ProposalItem) => void;
  onViewWeeklyScheduleFromProposal?: (proposal: ProposalItem) => void;
  notifyActivity: (payload: any) => void;
  showToast: (msg: string, type?: "success" | "error" | "warning" | "info") => void;
  externalCreateTrigger?: number;
  externalLeaveCreateTrigger?: number;
  externalLeaveTabTrigger?: number;
  externalTemplateTrigger?: number;
  externalOpenProposalId?: string | null;
  onConsumeTriggers?: () => void;
}

export function ProposalsApprovalView({
  currentStaffName,
  userDept,
  rolePerspective,
  isDirector,
  isManager,
  selectedDept,
  searchQuery,
  departments,
  personnelList,
  customerList,
  supplierList,
  productList,
  proposals,
  onSaveProposals,
  onPreviewAttachment,
  onCreateTaskFromProposal,
  onViewWeeklyScheduleFromProposal,
  notifyActivity,
  showToast,
  externalCreateTrigger,
  externalLeaveCreateTrigger,
  externalLeaveTabTrigger,
  externalTemplateTrigger,
  externalOpenProposalId,
  onConsumeTriggers
}: ProposalsApprovalViewProps) {
  // Danh sách biểu mẫu (cho phép cấu hình & thêm mẫu mới lưu bền vững)
  const [templates, setTemplates] = useState<ProposalTemplate[]>(DEFAULT_PROPOSAL_TEMPLATES);
  const [subView, setSubView] = useState<"to_approve" | "my_proposals" | "following" | "all" | "leave_tracker" | "templates">("all");
  const [leaveMonthFilter, setLeaveMonthFilter] = useState<string>(() => todayVN().slice(0, 7));
  const [leaveDeptFilter, setLeaveDeptFilter] = useState<string>("all");
  const [leaveTypeFilter, setLeaveTypeFilter] = useState<string>("all");
  const [leaveStatusFilter, setLeaveStatusFilter] = useState<string>("all");
  const [hideStaffLeaveForDirector, setHideStaffLeaveForDirector] = useState<boolean>(false);
  const [categoryFilter, setCategoryFilter] = useState<"all" | ProposalCategoryKey>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ProposalStatus>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | "NORMAL" | "HIGH" | "URGENT">("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [selectedIdsForBulk, setSelectedIdsForBulk] = useState<string[]>([]);

  // Modal Tạo / Sửa Đề xuất
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingProposalId, setEditingProposalId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(DEFAULT_PROPOSAL_TEMPLATES[0].id);

  // Chi tiết Đề xuất & Xử lý Duyệt
  const [selectedProposal, setSelectedProposal] = useState<ProposalItem | null>(null);
  const [decisionNote, setDecisionNote] = useState<string>("");
  const [decisionAttachments, setDecisionAttachments] = useState<Attachment[]>([]);
  const [executionNoteInput, setExecutionNoteInput] = useState<string>("");
  const [executionAttachments, setExecutionAttachments] = useState<Attachment[]>([]);
  const [delegateToStaff, setDelegateToStaff] = useState<string>("");
  const [showDelegateBox, setShowDelegateBox] = useState<boolean>(false);
  const [commentInput, setCommentInput] = useState<string>("");
  const [commentAttachments, setCommentAttachments] = useState<Attachment[]>([]);

  // Modal Cấu hình Biểu mẫu & Ma trận Phê duyệt
  const [isTemplateBuilderOpen, setIsTemplateBuilderOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ProposalTemplate | null>(null);
  const [templateCategoryTab, setTemplateCategoryTab] = useState<"all" | ProposalCategoryKey>("all");
  const [templateSearch, setTemplateSearch] = useState<string>("");
  const [quickCatalogCat, setQuickCatalogCat] = useState<"all" | ProposalCategoryKey>("all");
  const [isQuickCatalogOpen, setIsQuickCatalogOpen] = useState<boolean>(false);

  const openNewTemplateModal = (defaultCat: ProposalCategoryKey = "FINANCE") => {
    const resolvedCat: ProposalCategoryKey = defaultCat === ("all" as any) ? "FINANCE" : defaultCat;
    setEditingTemplate({
      id: `tmpl_custom_${Date.now()}`,
      codePrefix: "DXM",
      category: resolvedCat,
      name: "",
      icon: "📋",
      description: "",
      hasAmount: true,
      hasLineItems: true,
      lineItemColumns: { col1: "Nội dung hạng mục", col2: "Đơn vị tính", col3: "Số lượng", col4: "Đơn giá (VNĐ)" },
      autoDirectorThreshold: 5000000,
      slaTotalHours: 24,
      fields: [
        { key: `field_${Date.now()}_1`, label: "Căn cứ / Mục đích đề xuất", type: "text", placeholder: "Nhập chi tiết...", required: true }
      ],
      defaultSteps: [
        { stepOrder: 1, stepName: "Trưởng bộ phận xác nhận", roleType: "DEPT_HEAD", defaultDept: "Theo phòng người tạo", defaultApprover: "Trưởng bộ phận", slaHours: 4 },
        { stepOrder: 2, stepName: "Phòng chuyên môn thẩm định", roleType: "REVIEWER", defaultDept: "Kế Toán", defaultApprover: "Kế toán trưởng", slaHours: 8 },
        { stepOrder: 3, stepName: "Ban Giám Đốc phê duyệt", roleType: "DIRECTOR", defaultDept: "Ban Giám Đốc", defaultApprover: "Ban Giám Đốc", slaHours: 12, conditionMinAmount: 5000000 }
      ],
      defaultFollowers: [],
      defaultVisibility: resolveDefaultTemplateVisibility({ category: resolvedCat })
    });
    setIsTemplateBuilderOpen(true);
  };

  const sanitizeTemplateForAbt = (tmpl: ProposalTemplate): { template: ProposalTemplate; changed: boolean } => {
    let changed = false;
    const nextSteps = (tmpl.defaultSteps || []).map((st) => {
      const cleanApprover = sanitizeLegacyTbrApproverName(st.defaultApprover);
      const inferredRole = inferProposalStepRoleType(st.defaultDept, cleanApprover, st.stepName, st.roleType);
      if (cleanApprover !== st.defaultApprover || inferredRole !== st.roleType) {
        changed = true;
        return { ...st, defaultApprover: cleanApprover, roleType: inferredRole };
      }
      return st;
    });
    return {
      template: changed ? { ...tmpl, defaultSteps: nextSteps } : tmpl,
      changed
    };
  };

  const openInspectOrEditTemplate = (tmpl: ProposalTemplate) => {
    const { template: cleanTmpl } = sanitizeTemplateForAbt(JSON.parse(JSON.stringify(tmpl)));
    setEditingTemplate(cleanTmpl);
    setIsTemplateBuilderOpen(true);
  };

  // Load custom templates from storage & merge local unsynced custom templates to server
  useEffect(() => {
    const mergeTemplateLists = (...lists: ProposalTemplate[][]): { merged: ProposalTemplate[]; sanitizedAny: boolean } => {
      const seenIds = new Set<string>();
      const seenPrefixes = new Set<string>();
      const out: ProposalTemplate[] = [];
      let sanitizedAny = false;
      for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const item of list) {
          if (!item || !item.id || !item.name) continue;
          const idKey = String(item.id).trim();
          const prefKey = String(item.codePrefix || "").trim().toUpperCase();
          if (seenIds.has(idKey) || (prefKey && seenPrefixes.has(prefKey))) continue;
          seenIds.add(idKey);
          if (prefKey) seenPrefixes.add(prefKey);
          const { template: cleanItem, changed } = sanitizeTemplateForAbt(item);
          if (changed) sanitizedAny = true;
          out.push(cleanItem);
        }
      }
      return { merged: out, sanitizedAny };
    };

    const loadTemplates = async () => {
      let serverList: ProposalTemplate[] = [];
      let localList: ProposalTemplate[] = [];

      if (typeof window !== "undefined") {
        const local = localStorage.getItem("workspace_proposal_templates");
        if (local) {
          try {
            const parsed = JSON.parse(local);
            if (Array.isArray(parsed)) localList = parsed;
          } catch {}
        }
      }

      try {
        const res = await fetch("/api/storage?key=workspace_proposal_templates", { headers: { "x-no-cache": "1" } });
        const data = await res.json();
        if (Array.isArray(data?.data)) {
          serverList = data.data;
        }
      } catch {}

      const { merged, sanitizedAny } = mergeTemplateLists(serverList, localList, DEFAULT_PROPOSAL_TEMPLATES);
      setTemplates(merged);
      try {
        if (typeof window !== "undefined") {
          localStorage.setItem("workspace_proposal_templates", JSON.stringify(merged));
        }
      } catch {}

      // Nếu có mẫu mới hoặc vừa làm sạch tên TBR cũ ("Võ Thị Ngọc Giàu") / sửa lại roleType -> tự động lưu đồng bộ lên server
      if (merged.length > serverList.length || sanitizedAny) {
        try {
          await fetch("/api/storage?key=workspace_proposal_templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(merged)
          });
        } catch {}
      }
    };
    loadTemplates();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveTemplatesToStorage = async (nextTemplates: ProposalTemplate[]) => {
    const cleaned = nextTemplates.map((t) => sanitizeTemplateForAbt(t).template);
    setTemplates(cleaned);
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("workspace_proposal_templates", JSON.stringify(cleaned));
      }
      const res = await fetch("/api/storage?key=workspace_proposal_templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleaned)
      });
      if (!res.ok) {
        showToast("Cảnh báo: Không thể đồng bộ biểu mẫu lên máy chủ, vui lòng kiểm tra quyền hoặc kết nối mạng!", "warning");
      }
    } catch {}
  };

  // Danh sách nhân sự chuẩn hóa để chọn người duyệt / người theo dõi
  const allStaffNames = useMemo(() => {
    const names = new Set<string>();
    (personnelList || []).forEach((p: any) => {
      const n = String(p?.full_name || p || "").replace(/\s*\(.*?\)/g, "").trim();
      if (n) names.add(n);
    });
    if (currentStaffName) names.add(currentStaffName);
    return Array.from(names);
  }, [personnelList, currentStaffName]);

  // Tìm Trưởng bộ phận (hoặc Phó trưởng phòng khi phòng không có Trưởng phòng) mặc định theo phòng ban
  const getDefaultDeptHead = (deptName: string): string => {
    const leader = resolveDeptLeaderInfo(deptName, personnelList);
    if (leader?.name) {
      return leader.name;
    }
    const bod = getSupervisingBodForDept(deptName, personnelList);
    if (bod?.approverName) {
      return bod.approverName;
    }
    const d = String(deptName || "").toLowerCase();
    if (d.includes("kho nhà máy")) return "Trưởng Kho Nhà Máy";
    if (d.includes("kho")) return "Trưởng Kho Kinh Doanh";
    if (d.includes("cung ứng kỹ thuật")) return "Trưởng Cung Ứng Kỹ Thuật";
    if (d.includes("cung ứng") || d.includes("mua")) return "Trưởng Cung Ứng Kinh Doanh";
    if (d.includes("r&d") || d.includes("nghiên cứu")) return "Nguyễn Quốc Bảo";
    if (d.includes("sản xuất")) return "Đoàn Hồng Sơn";
    if (d.includes("oligo")) return "Nguyễn Thanh Tùng";
    if (d.includes("thiết bị") || d.includes("ktcn")) return "Nguyễn Văn Tùng";
    if (d.includes("qa") || d.includes("qc")) return "Phan Thị Thảo Trinh";
    if (d.includes("application") || d.includes("ứng dụng") || d === "app") return "Trần Tài";
    if (d.includes("kinh doanh") || d.includes("sales")) return "Huỳnh Thị Ngọc Huyền";
    if (d.includes("kế toán") || d.includes("hành chính") || d.includes("nhân sự") || d.includes("pháp chế")) return "Nguyễn Văn Hiếu";
    return "Trưởng bộ phận";
  };

  // Form State khi tạo/sửa đề xuất
  const [formState, setFormState] = useState<{
    proposalCode: string;
    title: string;
    priority: "NORMAL" | "HIGH" | "URGENT";
    visibility: ProposalVisibility;
    neededByDate: string;
    totalAmount: number;
    summaryReason: string;
    customerName: string;
    supplierName: string;
    linkedRefCode: string;
    formValues: Record<string, any>;
    lineItems: ProposalLineItem[];
    steps: ProposalStepInstance[];
    followers: string[];
    executorName: string;
    attachments: Attachment[];
    sendChatNotify: boolean;
    sendBellNotify: boolean;
  }>({
    proposalCode: `DX-${new Date().getFullYear()}-001`,
    title: "",
    priority: "HIGH",
    visibility: "PRIVATE",
    neededByDate: todayVN(),
    totalAmount: 0,
    summaryReason: "",
    customerName: "",
    supplierName: "",
    linkedRefCode: "",
    formValues: {},
    lineItems: [],
    steps: [],
    followers: [],
    executorName: "",
    attachments: [],
    sendChatNotify: true,
    sendBellNotify: true
  });

  const activeTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) || templates[0],
    [templates, selectedTemplateId]
  );

  // Build steps from template + current requester dept + total amount
  const buildStepsFromTemplate = (
    tmpl: ProposalTemplate,
    reqDept: string,
    amount: number,
    reqName: string = currentStaffName
  ): ProposalStepInstance[] => {
    const resolvedDept = reqDept && reqDept !== "all" ? reqDept : userDept || "Kinh Doanh";
    const filteredSteps = (tmpl.defaultSteps || []).filter((st) => {
      if (st.conditionMinAmount && amount > 0 && amount < st.conditionMinAmount) {
        return false;
      }
      return true;
    });
    const baseList = filteredSteps.length > 0 ? filteredSteps : tmpl.defaultSteps;
    const rawSteps: ProposalStepInstance[] = baseList.map((st, idx) => {
      const stepDept = st.defaultDept === "Theo phòng người tạo" ? resolvedDept : st.defaultDept;
      const stepApprover =
        st.defaultApprover === "Trưởng bộ phận"
          ? getDefaultDeptHead(resolvedDept)
          : st.defaultApprover;
      return {
        stepOrder: idx + 1,
        stepName: st.stepName,
        roleType: st.roleType,
        dept: stepDept,
        approverName: stepApprover,
        status: idx === 0 ? "PENDING_NOW" : "WAITING",
        slaHours: st.slaHours || 8,
        allowAttachment: st.allowAttachment ?? true,
        requireAttachment: Boolean(st.requireAttachment),
        attachmentLabel: st.attachmentLabel || ""
      };
    });
    return normalizeProposalStepsForRequester(
      rawSteps,
      resolvedDept,
      reqName,
      personnelList,
      tmpl.defaultSteps
    ).steps;
  };

  // Tự động chuẩn hóa các đề xuất đang chờ duyệt (PENDING / DRAFT / RETURNED) nếu trước đó gán nhãn chung
  // (VD: "Kế toán viên", "Trưởng phòng QA/QC") hoặc do Phó/Trưởng phòng đề xuất cần chuyển lên PGĐ phụ trách nhóm / GĐ duyệt
  useEffect(() => {
    if (!Array.isArray(proposals) || proposals.length === 0) return;
    let anyChanged = false;
    const nextList = proposals.map((p) => {
      if (!p || (p.status !== "PENDING" && p.status !== "DRAFT" && p.status !== "RETURNED")) return p;
      const tmpl = templates.find((t) => t.id === p.templateId);
      const norm = normalizeProposalStepsForRequester(
        p.steps || [],
        p.requesterDept || "Kinh Doanh",
        p.requesterName || "",
        personnelList,
        tmpl?.defaultSteps
      );
      if (!norm.changed) return p;
      anyChanged = true;
      const activeIdx =
        norm.steps.findIndex((s) => s.status === "PENDING_NOW") >= 0
          ? norm.steps.findIndex((s) => s.status === "PENDING_NOW")
          : Math.min(p.currentStepIndex || 0, Math.max(0, norm.steps.length - 1));
      return {
        ...p,
        steps: norm.steps,
        currentStepIndex: activeIdx
      };
    });
    if (anyChanged) {
      onSaveProposals(nextList);
      if (selectedProposal) {
        const updatedSel = nextList.find((x) => x.id === selectedProposal.id);
        if (updatedSel) setSelectedProposal(updatedSel);
      }
    }
  }, [proposals, personnelList, templates]); // eslint-disable-line react-hooks/exhaustive-deps

  // Khi Modal Tạo Mới Đề Xuất đang mở và danh sách biểu mẫu `templates` vừa tải xong từ máy chủ,
  // tự động đồng bộ lại `steps` và `followers` theo cấu hình mẫu mới nhất (bao gồm cả bước Kế toán viên).
  useEffect(() => {
    if (!isFormModalOpen || editingProposalId) return;
    const tmpl = templates.find((t) => t.id === selectedTemplateId) || templates[0];
    if (!tmpl) return;
    const reqDept = defaultConcreteDeptForScope(selectedDept, userDept);
    const freshSteps = buildStepsFromTemplate(tmpl, reqDept, formState.totalAmount);
    const freshFollowers = Array.isArray(tmpl.defaultFollowers)
      ? Array.from(new Set(tmpl.defaultFollowers.map((n) => cleanStaffDisplayName(n)).filter(Boolean)))
      : [];
    setFormState((prev) => {
      const sameSteps =
        prev.steps.length === freshSteps.length &&
        prev.steps.every(
          (s, i) =>
            s.stepName === freshSteps[i]?.stepName &&
            s.dept === freshSteps[i]?.dept &&
            s.approverName === freshSteps[i]?.approverName
        );
      if (sameSteps && prev.followers.length >= freshFollowers.length) return prev;
      return {
        ...prev,
        steps: freshSteps,
        followers: prev.followers.length > 0 ? prev.followers : freshFollowers,
        executorName: freshSteps[freshSteps.length - 1]?.approverName || prev.executorName
      };
    });
  }, [templates, isFormModalOpen, editingProposalId, selectedTemplateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const generateProposalCode = (tmpl: ProposalTemplate, overridePrefix?: string) => {
    const year = new Date().getFullYear();
    const prefix = overridePrefix || tmpl.codePrefix || "DX";
    // Số lớn nhất đang dùng + 1 (trước đây "số đơn + 1": danh sách thiếu đơn / đã xóa đơn là sinh mã trùng, vd 3 đơn DXNP-2026-007).
    // Máy chủ vẫn kiểm tra lần cuối và cấp lại mã nếu trùng với đơn người khác vừa lập.
    const re = new RegExp("^" + prefix + "-" + year + "-([0-9]+)$", "i");
    const maxSeq = (proposals || []).reduce((m, p) => {
      const mm = re.exec(String(p.proposalCode || "").trim());
      return mm ? Math.max(m, Number(mm[1])) : m;
    }, 0);
    return `${prefix}-${year}-${String(maxSeq + 1).padStart(3, "0")}`;
  };

  const openCreateProposalModal = (tmplId?: string, overrideTemplate?: ProposalTemplate) => {
    const tmpl =
      (overrideTemplate ? sanitizeTemplateForAbt(overrideTemplate).template : undefined) ||
      templates.find((t) => t.id === tmplId) ||
      templates[0];
    setEditingProposalId(null);
    setSelectedTemplateId(tmpl.id);
    const reqDept = defaultConcreteDeptForScope(selectedDept, userDept);
    const initialSteps = buildStepsFromTemplate(tmpl, reqDept, 0);
    const defaultDateValues: Record<string, string> = {};
    (tmpl.fields || []).forEach((f) => {
      if (f.type === "date") defaultDateValues[f.key] = todayVN();
    });
    const isLeaveTmpl = tmpl.id === "tmpl_leave_request" || tmpl.codePrefix === "DXNP";
    const isExecRequester = isDirector || isSameWorkspaceDept(reqDept, "Ban Giám Đốc");
    if (isLeaveTmpl) {
      defaultDateValues.leaveType = isExecRequester
        ? "Nghỉ phép năm (Có hưởng lương)"
        : "Nghỉ phép năm (Có hưởng lương)";
      defaultDateValues.totalDays = "1";
      defaultDateValues.onBehalfOfName = currentStaffName;
      defaultDateValues.onBehalfOfDept = isDirector ? "Ban Giám Đốc" : reqDept;
    }
    setFormState({
      proposalCode: generateProposalCode(tmpl, isLeaveTmpl && isExecRequester ? "TBNP" : undefined),
      title: isLeaveTmpl
        ? isExecRequester
          ? `Thông báo nghỉ phép — ${currentStaffName} (${formatDayVN(todayVN())})`
          : `Xin nghỉ phép — ${currentStaffName} (${formatDayVN(todayVN())})`
        : "",
      priority: isLeaveTmpl ? "NORMAL" : "HIGH",
      visibility: resolveDefaultTemplateVisibility(tmpl),
      neededByDate: todayVN(),
      totalAmount: 0,
      summaryReason: isLeaveTmpl && isExecRequester ? "Thông báo lịch nghỉ phép & phân công người nhận bàn giao/ủy quyền." : "",
      customerName: "",
      supplierName: "",
      linkedRefCode: "",
      formValues: defaultDateValues,
      lineItems: tmpl.hasLineItems
        ? [{ id: `li-${Date.now()}`, itemName: "", specification: "", quantity: 1, unitPrice: 0, amount: 0 }]
        : [],
      steps: isLeaveTmpl && isExecRequester ? [] : initialSteps,
      followers: Array.isArray(tmpl.defaultFollowers)
        ? Array.from(new Set(tmpl.defaultFollowers.map((n) => cleanStaffDisplayName(n)).filter(Boolean)))
        : [],
      executorName: initialSteps[initialSteps.length - 1]?.approverName || "",
      attachments: [],
      sendChatNotify: true,
      sendBellNotify: true
    });
    setIsFormModalOpen(true);

    // Tải đồng bộ biểu mẫu mới nhất từ máy chủ trong nền (phòng trường hợp mẫu vừa được sửa ở tab/tài khoản khác)
    if (!overrideTemplate) {
      fetch("/api/storage?key=workspace_proposal_templates", { headers: { "x-no-cache": "1" } })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (Array.isArray(j?.data) && j.data.length > 0) {
            const cleanedServer = j.data.map((t: ProposalTemplate) => sanitizeTemplateForAbt(t).template);
            setTemplates((prev) => {
              const byId = new Map<string, ProposalTemplate>();
              for (const item of cleanedServer) if (item?.id) byId.set(item.id, item);
              for (const item of prev) if (item?.id && !byId.has(item.id)) byId.set(item.id, item);
              const nextMerged = Array.from(byId.values());
              try {
                if (typeof window !== "undefined") {
                  localStorage.setItem("workspace_proposal_templates", JSON.stringify(nextMerged));
                }
              } catch {}
              return nextMerged;
            });
          }
        })
        .catch(() => {});
    }
  };

  // Switch template inside Create Modal
  const handleSelectTemplateInModal = (tmplId: string) => {
    const tmpl = templates.find((t) => t.id === tmplId);
    if (!tmpl) return;
    setSelectedTemplateId(tmpl.id);
    if (!editingProposalId) {
      const reqDept = defaultConcreteDeptForScope(selectedDept, userDept);
      const nextSteps = buildStepsFromTemplate(tmpl, reqDept, formState.totalAmount);
      const defaultDateValues: Record<string, string> = {};
      (tmpl.fields || []).forEach((f) => {
        if (f.type === "date") defaultDateValues[f.key] = todayVN();
      });
      const isLeaveTmpl = tmpl.id === "tmpl_leave_request" || tmpl.codePrefix === "DXNP";
      if (isLeaveTmpl) {
        defaultDateValues.leaveType = defaultDateValues.leaveType || "Nghỉ phép năm (Có hưởng lương)";
        defaultDateValues.totalDays = defaultDateValues.totalDays || "1";
      }
      setFormState((prev) => ({
        ...prev,
        proposalCode: generateProposalCode(tmpl),
        title: isLeaveTmpl && !prev.title ? `Xin nghỉ phép — ${currentStaffName} (${formatDayVN(todayVN())})` : prev.title,
        visibility: resolveDefaultTemplateVisibility(tmpl),
        formValues: { ...defaultDateValues, ...prev.formValues },
        lineItems:
          tmpl.hasLineItems && prev.lineItems.length === 0
            ? [{ id: `li-${Date.now()}`, itemName: "", specification: "", quantity: 1, unitPrice: 0, amount: 0 }]
            : prev.lineItems,
        steps: nextSteps,
        followers: Array.isArray(tmpl.defaultFollowers)
          ? Array.from(new Set(tmpl.defaultFollowers.map((n) => cleanStaffDisplayName(n)).filter(Boolean)))
          : []
      }));
    }
  };

  // Respond to external triggers from UnifiedWorkspace Action Bar & Deep-link Notifications
  const handledCreateTriggerRef = useRef<number>(0);
  const handledLeaveCreateTriggerRef = useRef<number>(0);

  useEffect(() => {
    if (externalCreateTrigger && externalCreateTrigger > 0 && externalCreateTrigger !== handledCreateTriggerRef.current) {
      handledCreateTriggerRef.current = externalCreateTrigger;
      openCreateProposalModal();
      onConsumeTriggers?.();
    }
  }, [externalCreateTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (
      externalLeaveCreateTrigger &&
      externalLeaveCreateTrigger > 0 &&
      externalLeaveCreateTrigger !== handledLeaveCreateTriggerRef.current
    ) {
      handledLeaveCreateTriggerRef.current = externalLeaveCreateTrigger;
      openCreateProposalModal("tmpl_leave_request");
      onConsumeTriggers?.();
    }
  }, [externalLeaveCreateTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (externalLeaveTabTrigger && externalLeaveTabTrigger > 0) {
      setSubView("leave_tracker");
      onConsumeTriggers?.();
    }
  }, [externalLeaveTabTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (externalTemplateTrigger && externalTemplateTrigger > 0) {
      setSubView("templates");
      onConsumeTriggers?.();
    }
  }, [externalTemplateTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (externalOpenProposalId && proposals.length > 0) {
      const target = String(externalOpenProposalId).split("|")[0].trim().toUpperCase();
      if (!target) return;
      const matched = proposals.find(
        (p) => String(p.id).toUpperCase() === target || String(p.proposalCode || "").toUpperCase() === target
      );
      if (matched) {
        setSelectedProposal(matched);
        const isLeave =
          matched.templateId === "tmpl_leave_request" ||
          String(matched.proposalCode || "").toUpperCase().startsWith("DXNP") ||
          String(matched.templateName || "").toLowerCase().includes("nghỉ phép");
        if (isLeave) {
          const propMonth = String(matched.formValues?.fromDate || matched.neededByDate || matched.createdAt || "").slice(0, 7);
          if (/^\d{4}-\d{2}$/.test(propMonth) && leaveMonthFilter !== "all" && leaveMonthFilter !== propMonth) {
            setLeaveMonthFilter(propMonth);
          }
        }
        if (subView === "templates") {
          setSubView(isLeave ? "leave_tracker" : "all");
        }
      }
    }
  }, [externalOpenProposalId, proposals]); // eslint-disable-line react-hooks/exhaustive-deps

  const openEditProposalModal = (p: ProposalItem) => {
    const tmpl = templates.find((t) => t.id === p.templateId);
    setEditingProposalId(p.id);
    setSelectedTemplateId(p.templateId);
    setFormState({
      proposalCode: p.proposalCode,
      title: p.title,
      priority: p.priority,
      visibility: getEffectiveProposalVisibility(p, tmpl),
      neededByDate: p.neededByDate || todayVN(),
      totalAmount: p.totalAmount || 0,
      summaryReason: p.summaryReason || "",
      customerName: p.customerName || "",
      supplierName: p.supplierName || "",
      linkedRefCode: p.linkedRefCode || "",
      formValues: { ...(p.formValues || {}) },
      lineItems: Array.isArray(p.lineItems) ? [...p.lineItems] : [],
      steps: Array.isArray(p.steps) ? [...p.steps] : [],
      followers: Array.isArray(p.followers) ? [...p.followers] : [],
      executorName: p.executorName || "",
      attachments: Array.isArray(p.attachments) ? [...p.attachments] : [],
      sendChatNotify: true,
      sendBellNotify: true
    });
    setSelectedProposal(null);
    setIsFormModalOpen(true);
  };

  // Tự động cộng tổng tiền từ bảng kê chi tiết (nếu có nhập dòng chi tiết)
  const handleLineItemChange = (idx: number, field: keyof ProposalLineItem, value: any) => {
    const updated = [...formState.lineItems];
    const row = { ...updated[idx], [field]: value };
    if (field === "quantity" || field === "unitPrice") {
      const q = Number(field === "quantity" ? value : row.quantity) || 0;
      const u = Number(field === "unitPrice" ? value : row.unitPrice) || 0;
      row.amount = q * u;
    }
    updated[idx] = row;
    const sumAmount = updated.reduce((acc, r) => acc + (Number(r.amount) || 0), 0);
    setFormState((prev) => ({
      ...prev,
      lineItems: updated,
      totalAmount: sumAmount > 0 ? sumAmount : prev.totalAmount
    }));
  };

  // ===== Đơn nghỉ theo các ngày cụ thể (vd thứ 6, thứ 7 hằng tuần) =====
  const [repeatFrom, setRepeatFrom] = useState("");
  const [repeatTo, setRepeatTo] = useState("");
  const [repeatWeekdays, setRepeatWeekdays] = useState<number[]>([]);
  const [repeatSession, setRepeatSession] = useState<LeaveSession>("FULL");
  const [singleLeaveDate, setSingleLeaveDate] = useState("");

  /** Ghi danh sách ngày vào đơn: fromDate / toDate = ngày đầu / cuối, totalDays = tổng (buổi = 0,5). */
  const setLeaveDaysInForm = (days: LeaveDay[]) => {
    const n = normalizeLeaveDays(days);
    setFormState((prev) => ({
      ...prev,
      formValues: {
        ...prev.formValues,
        leaveMode: "DATES",
        leaveDates: serializeLeaveDays(n),
        fromDate: n[0]?.date || "",
        toDate: n[n.length - 1]?.date || "",
        totalDays: n.length ? String(sumLeaveDays(n)) : "",
      },
    }));
  };

  const switchLeaveMode = (mode: "RANGE" | "DATES") => {
    if (mode === "DATES") {
      const fv = formState.formValues || {};
      setRepeatFrom(String(fv.fromDate || todayVN()).slice(0, 10));
      setRepeatTo(String(fv.toDate || fv.fromDate || todayVN()).slice(0, 10));
      setLeaveDaysInForm(parseLeaveDays({ ...fv, leaveMode: "DATES" }) || []);
      return;
    }
    setFormState((prev) => {
      const { leaveMode, leaveDates, ...rest } = prev.formValues || {};
      void leaveMode; void leaveDates;
      const fd = String(rest.fromDate || todayVN()).slice(0, 10);
      const td = String(rest.toDate || fd).slice(0, 10);
      const diff = td >= fd ? Math.round((new Date(td).getTime() - new Date(fd).getTime()) / 86400000) + 1 : 1;
      return { ...prev, formValues: { ...rest, fromDate: fd, toDate: td, totalDays: String(Math.max(1, diff)) } };
    });
  };

  const renderLeaveDatesEditor = () => {
    const datesMode = isDatesMode(formState.formValues);
    const days = parseLeaveDays(formState.formValues) || [];
    const chip = (on: boolean) =>
      `px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer transition-colors ${on
        ? "bg-indigo-600 text-white border-indigo-600"
        : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400"}`;
    return (
      <div className="space-y-2.5 p-3 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/30">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Kiểu nghỉ:</span>
          <button type="button" className={chip(!datesMode)} onClick={() => switchLeaveMode("RANGE")}>Khoảng liên tục</button>
          <button type="button" className={chip(datesMode)} onClick={() => switchLeaveMode("DATES")}>Các ngày cụ thể (vd thứ 6, thứ 7 hằng tuần)</button>
        </div>
        {datesMode && (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-0.5">Lặp từ ngày</label>
                <DateInputVN value={repeatFrom} onChange={(e) => setRepeatFrom(e.target.value)} className="w-32 px-2 py-1 rounded-lg text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-0.5">đến ngày</label>
                <DateInputVN value={repeatTo} onChange={(e) => setRepeatTo(e.target.value)} className="w-32 px-2 py-1 rounded-lg text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" />
              </div>
              <div className="flex flex-wrap gap-1">
                {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
                  <button
                    key={wd}
                    type="button"
                    className={chip(repeatWeekdays.includes(wd))}
                    onClick={() => setRepeatWeekdays((prev) => (prev.includes(wd) ? prev.filter((x) => x !== wd) : [...prev, wd]))}
                  >
                    {WEEKDAY_LABELS[wd]}
                  </button>
                ))}
              </div>
              <select
                value={repeatSession}
                onChange={(e) => setRepeatSession(e.target.value as LeaveSession)}
                className="px-2 py-1 rounded-lg text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
              >
                {(["FULL", "AM", "PM"] as LeaveSession[]).map((s) => <option key={s} value={s}>{SESSION_LABEL[s]}</option>)}
              </select>
              <button
                type="button"
                onClick={() => {
                  const add = expandWeekdays(repeatFrom, repeatTo, repeatWeekdays, repeatSession);
                  if (add.length === 0) { showToast("Chọn khoảng ngày và ít nhất 1 thứ trong tuần", "warning"); return; }
                  setLeaveDaysInForm([...days, ...add]);
                  showToast(`Đã thêm ${add.length} ngày nghỉ`, "success");
                }}
                className="px-3 py-1 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
              >
                + Thêm các ngày theo thứ
              </button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-0.5">Thêm 1 ngày lẻ</label>
                <DateInputVN value={singleLeaveDate} onChange={(e) => setSingleLeaveDate(e.target.value)} className="w-32 px-2 py-1 rounded-lg text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" />
              </div>
              <button
                type="button"
                onClick={() => { if (singleLeaveDate) { setLeaveDaysInForm([...days, { date: singleLeaveDate, session: repeatSession }]); setSingleLeaveDate(""); } }}
                className="px-3 py-1 rounded-lg text-xs font-bold border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 bg-white dark:bg-slate-900 cursor-pointer"
              >
                + Thêm ngày
              </button>
              {days.length > 0 && (
                <button type="button" onClick={() => setLeaveDaysInForm([])} className="px-3 py-1 rounded-lg text-xs font-bold text-rose-600 cursor-pointer">
                  Xóa hết
                </button>
              )}
            </div>
            <div className="text-[11px] font-bold text-slate-800 dark:text-slate-200">
              Danh sách ngày nghỉ: {days.length} ngày · tổng <span className="text-indigo-700 dark:text-indigo-300">{sumLeaveDays(days)} ngày công</span>
              {days.length > 0 && <span className="font-normal text-slate-500"> (từ {formatDayVN(days[0].date)} đến {formatDayVN(days[days.length - 1].date)})</span>}
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
              {days.map((d) => (
                <span key={d.date} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px]">
                  <strong>{WEEKDAY_LABELS[weekdayOf(d.date)]} {formatDayVN(d.date)}</strong>
                  <select
                    value={d.session}
                    onChange={(e) => setLeaveDaysInForm(days.map((x) => (x.date === d.date ? { ...x, session: e.target.value as LeaveSession } : x)))}
                    className="bg-transparent text-[10px] border-0 p-0 cursor-pointer"
                  >
                    {(["FULL", "AM", "PM"] as LeaveSession[]).map((s) => <option key={s} value={s}>{SESSION_LABEL[s]}</option>)}
                  </select>
                  <button type="button" title="Bỏ ngày này" onClick={() => setLeaveDaysInForm(days.filter((x) => x.date !== d.date))} className="text-rose-500 font-bold cursor-pointer">×</button>
                </span>
              ))}
              {days.length === 0 && <span className="text-[11px] text-slate-500">Chưa có ngày nào — chọn khoảng ngày + thứ trong tuần rồi bấm "Thêm các ngày theo thứ", hoặc thêm từng ngày.</span>}
            </div>
          </>
        )}
      </div>
    );
  };

  // Lưu hoặc Gửi duyệt Đề xuất
  const handleSaveProposal = async (submitMode: "DRAFT" | "PENDING") => {
    if (!formState.title.trim()) {
      showToast("Vui lòng nhập tiêu đề tờ trình / đề xuất", "warning");
      return;
    }
    if (!formState.summaryReason.trim()) {
      showToast("Vui lòng nhập nội dung / lý do đề xuất", "warning");
      return;
    }
    if (submitMode === "PENDING") {
      for (const f of activeTemplate.fields || []) {
        if (!f.required) continue;
        const val = formState.formValues?.[f.key];
        if (f.type === "file") {
          if (!Array.isArray(val) || val.length === 0) {
            showToast(`Vui lòng tải tệp đính kèm cho trường bắt buộc: "${f.label}"`, "warning");
            return;
          }
        } else if (val === undefined || val === null || String(val).trim() === "") {
          showToast(`Vui lòng điền thông tin bắt buộc: "${f.label}"`, "warning");
          return;
        }
      }
    }
    if (isDatesMode(formState.formValues) && (parseLeaveDays(formState.formValues) || []).length === 0) {
      showToast("Đơn nghỉ theo các ngày cụ thể: vui lòng chọn ít nhất 1 ngày nghỉ", "warning");
      return;
    }

    const nowStr = nowVNDateTime();
    const existing = editingProposalId ? proposals.find((p) => p.id === editingProposalId) : null;
    const isLeaveTmpl = activeTemplate.id === "tmpl_leave_request" || activeTemplate.codePrefix === "DXNP";
    const proxyName = isLeaveTmpl ? String(formState.formValues?.onBehalfOfName || "").trim() : "";
    const proxyDept = isLeaveTmpl ? String(formState.formValues?.onBehalfOfDept || "").trim() : "";
    const reqName = existing?.requesterName || proxyName || currentStaffName;
    const reqDept =
      existing?.requesterDept ||
      proxyDept ||
      (isDirector && (!proxyName || isSamePerson(proxyName, currentStaffName))
        ? "Ban Giám Đốc"
        : defaultConcreteDeptForScope(selectedDept, userDept));

    // Kiểm tra nếu người vắng mặt thuộc Ban Giám Đốc -> KHÔNG phải "Đơn xin nghỉ phép" chờ duyệt, mà tự động có hiệu lực ngay (APPROVED)
    const isExecutiveLeave =
      isLeaveTmpl &&
      (isSameWorkspaceDept(reqDept, "Ban Giám Đốc") ||
        (isDirector && isSamePerson(reqName, currentStaffName)) ||
        /giám đốc|pgđ|bgđ|chủ tịch/i.test(
          String(
            (personnelList || []).find((p: any) => isSamePerson(p.full_name || p.name, reqName))?.position || ""
          )
        ));

    // Chuẩn hóa luồng bước duyệt (tự động phân luồng Trưởng/Phó phòng hoặc PGĐ phụ trách nhóm / GĐ)
    const initialStepsList = formState.steps.length > 0
      ? formState.steps.map((s, i) => ({
          ...s,
          stepOrder: i + 1
        }))
      : buildStepsFromTemplate(activeTemplate, reqDept, formState.totalAmount, reqName);
    let stepsList = isExecutiveLeave
      ? [
          {
            stepOrder: 1,
            stepName: "Ban Giám Đốc ghi nhận lịch vắng mặt & ủy quyền (Không qua trình xin phép)",
            roleType: "DIRECTOR" as const,
            dept: "Ban Giám Đốc",
            approverName: reqName,
            status: "APPROVED" as const,
            decidedAt: nowStr,
            decidedBy: currentStaffName,
            comment: isSamePerson(reqName, currentStaffName)
              ? "Ban Giám Đốc xác nhận lịch vắng mặt / ủy quyền điều hành (Hiệu lực ngay)"
              : `${currentStaffName} ghi nhận lịch vắng mặt / ủy quyền theo chỉ đạo của ${reqName}`,
            slaHours: 0
          }
        ]
      : normalizeProposalStepsForRequester(
          initialStepsList,
          reqDept,
          reqName,
          personnelList,
          activeTemplate?.defaultSteps
        ).steps;

    // Nếu Gửi duyệt lại từ trạng thái RETURNED hoặc DRAFT -> đặt bước đầu tiên chưa APPROVED thành PENDING_NOW
    let activeIdx = 0;
    const finalStatus: ProposalStatus =
      submitMode === "PENDING" && isExecutiveLeave ? "APPROVED" : submitMode;
    if (submitMode === "PENDING" && !isExecutiveLeave) {
      const firstNotApproved = stepsList.findIndex((s) => s.status !== "APPROVED");
      activeIdx = firstNotApproved >= 0 ? firstNotApproved : 0;
      stepsList = stepsList.map((s, idx) => {
        if (idx < activeIdx && s.status === "APPROVED") return s;
        if (idx === activeIdx) return { ...s, status: "PENDING_NOW" as const };
        return { ...s, status: "WAITING" as const };
      });
    }

    const actionText =
      submitMode === "DRAFT"
        ? "Lưu bản nháp đề xuất"
        : isExecutiveLeave
        ? "Ghi nhận lịch vắng mặt & ủy quyền Ban Giám Đốc (Hiệu lực ngay — Không qua xin phép)"
        : existing && existing.status === "RETURNED"
        ? "Đã bổ sung giải trình & Gửi duyệt lại"
        : existing
        ? "Cập nhật nội dung đề xuất"
        : "Khởi tạo & Trình phê duyệt đề xuất";

    const newProposal: ProposalItem = {
      id: existing ? existing.id : `PROP-${Date.now()}`,
      // Đơn mới: mã đã có người khác dùng (danh sách vừa cập nhật) thì lấy số kế tiếp ngay lúc gửi; máy chủ vẫn kiểm tra lần cuối
      proposalCode: (() => {
        const typed = formState.proposalCode.trim();
        const taken = !existing && typed && proposals.some((p) => String(p.proposalCode || "").trim().toUpperCase() === typed.toUpperCase());
        return !typed || taken ? generateProposalCode(activeTemplate, isExecutiveLeave ? "TBNP" : undefined) : typed;
      })(),
      templateId: activeTemplate.id,
      templateName: isExecutiveLeave ? "Thông báo Nghỉ phép / Vắng mặt (Ban Giám Đốc)" : activeTemplate.name,
      category: activeTemplate.category,
      title: formState.title.trim(),
      priority: formState.priority,
      requesterName: reqName,
      requesterDept: reqDept,
      createdAt: existing?.createdAt || nowStr,
      updatedAt: nowStr,
      neededByDate: formState.neededByDate || todayVN(),
      totalAmount: Number(formState.totalAmount) || 0,
      currency: "VNĐ",
      summaryReason: formState.summaryReason.trim(),
      formValues: formState.formValues,
      lineItems: formState.lineItems.filter((li) => li.itemName.trim() || li.amount > 0),
      steps: stepsList,
      currentStepIndex: activeIdx,
      status: finalStatus,
      visibility: formState.visibility || resolveDefaultTemplateVisibility(activeTemplate),
      followers: formState.followers,
      executorName: formState.executorName,
      linkedRefCode: formState.linkedRefCode.trim(),
      customerName: formState.customerName.trim(),
      supplierName: formState.supplierName.trim(),
      attachments: formState.attachments,
      comments: existing?.comments || [],
      auditLogs: [
        ...(existing?.auditLogs || []),
        {
          time: nowStr,
          actor: currentStaffName,
          action: actionText,
          detail:
            submitMode === "DRAFT"
              ? "Lưu nháp chưa gửi duyệt"
              : isExecutiveLeave
              ? `Ghi nhận lịch vắng mặt & người nhận bàn giao/ủy quyền (${formState.formValues?.handoverStaff || "Nội bộ BGĐ"}) — Hiệu lực ngay (APPROVED)`
              : `Trình Bước ${activeIdx + 1}: ${stepsList[activeIdx]?.stepName || "Phê duyệt"} (${stepsList[activeIdx]?.approverName || ""})`
        }
      ]
    };

    const nextList = existing
      ? proposals.map((p) => (p.id === existing.id ? newProposal : p))
      : [newProposal, ...proposals];

    await onSaveProposals(nextList);
    setIsFormModalOpen(false);
    setSelectedProposal(newProposal);

    if (submitMode === "PENDING") {
      const currentStep = stepsList[activeIdx];
      const handoverPerson = String(formState.formValues?.handoverStaff || "").trim();
      const targetApprovers = Array.from(
        new Set(
          (isExecutiveLeave
            ? [handoverPerson, ...formState.followers]
            : [currentStep?.approverName, handoverPerson, ...formState.followers]
          ).filter((n) => n && !isSamePerson(n, currentStaffName))
        )
      );

      if (formState.sendBellNotify && targetApprovers.length > 0) {
        notifyActivity({
          title: isExecutiveLeave
            ? `🏛️ Ủy quyền / Vắng mặt [${newProposal.proposalCode}]`
            : `📝 Trình duyệt [${newProposal.proposalCode}]`,
          message: isExecutiveLeave
            ? `${newProposal.requesterName} (${newProposal.requesterDept}) đã ghi nhận lịch vắng mặt & bàn giao/ủy quyền: "${newProposal.title}".`
            : `${newProposal.requesterName} (${newProposal.requesterDept}) vừa trình duyệt "${newProposal.title}"${
                newProposal.totalAmount > 0 ? ` — Số tiền: ${formatMoneyVND(newProposal.totalAmount)}` : ""
              }. Đang chờ ${currentStep?.approverName || "Anh/Chị"} phê duyệt (Bước ${activeIdx + 1}/${stepsList.length}).`,
          type: newProposal.priority === "URGENT" ? "warning" : "info",
          category: "task",
          sender: { name: currentStaffName },
          targetEmployeeNames: targetApprovers,
          targetDept: isExecutiveLeave ? "Ban Giám Đốc" : (currentStep?.dept || "all"),
          link: { tab: "workspace", subTab: "proposals", itemId: newProposal.proposalCode }
        });
      }

      if (formState.sendChatNotify && targetApprovers.length > 0) {
        try {
          await fetch("/api/chat?action=broadcast_meeting", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: isExecutiveLeave
                ? `[ỦY QUYỀN / LỊCH VẮNG MẶT BGĐ] ${newProposal.proposalCode}: ${newProposal.title}`
                : `[ĐỀ XUẤT CẦN DUYỆT] ${newProposal.proposalCode}: ${newProposal.title}`,
              date_label: formatDayVN(newProposal.neededByDate),
              time_slot: newProposal.priority === "URGENT" ? "🚨 KHẨN CẤP" : "Đề xuất phê duyệt",
              location: `Điều hành → Đề Xuất & Phê Duyệt`,
              host_name: newProposal.requesterName,
              attendees: targetApprovers,
              agenda: `Loại đề xuất: ${newProposal.templateName}${
                newProposal.totalAmount > 0 ? ` | Số tiền: ${formatMoneyVND(newProposal.totalAmount)}` : ""
              }\nLý do: ${newProposal.summaryReason}`,
              mode: "invite",
              create_group: false,
              send_direct: true
            })
          });
        } catch {}
      }
    }

    showToast(
      submitMode === "DRAFT"
        ? `Đã lưu nháp đề xuất [${newProposal.proposalCode}]`
        : isExecutiveLeave
        ? `🏛️ Đã ghi nhận lịch vắng mặt & ủy quyền [${newProposal.proposalCode}] (Có hiệu lực ngay, không cần chờ duyệt)!`
        : `🚀 Đã gửi trình duyệt đề xuất [${newProposal.proposalCode}] thành công!`,
      "success"
    );
  };

  // Xử lý Quyết định Phê duyệt / Yêu cầu bổ sung / Từ chối / Xác nhận Thực thi
  const handleDecision = async (
    proposal: ProposalItem,
    decision: "APPROVE" | "RETURN" | "REJECT" | "EXECUTE" | "WITHDRAW",
    customNote?: string
  ) => {
    const note = (customNote !== undefined ? customNote : decisionNote).trim();
    if ((decision === "REJECT" || decision === "RETURN") && !note) {
      showToast(
        decision === "REJECT"
          ? "Vui lòng nhập lý do từ chối phê duyệt để người đề xuất nắm rõ!"
          : "Vui lòng nhập nội dung yêu cầu bổ sung / giải trình!",
        "warning"
      );
      return;
    }

    const nowStr = nowVNDateTime();
    const stepsCopy = [...(proposal.steps || [])];
    const activeIdx =
      stepsCopy.findIndex((s) => s.status === "PENDING_NOW") >= 0
        ? stepsCopy.findIndex((s) => s.status === "PENDING_NOW")
        : proposal.currentStepIndex || 0;

    // Kiểm tra chặt chẽ: chỉ người có thẩm quyền duyệt đúng bước hiện tại mới được bấm Duyệt / Trả lại / Từ chối
    if (decision === "APPROVE" || decision === "RETURN" || decision === "REJECT") {
      const canApproveActiveStep = isProposalWaitingForUser(
        proposal,
        currentStaffName,
        userDept,
        isDirector,
        isManager
      );
      if (!canApproveActiveStep) {
        const targetStep = stepsCopy[activeIdx];
        showToast(
          `Bước ${activeIdx + 1} đang chờ "${targetStep?.approverName || "bộ phận tiếp theo"}" (${targetStep?.dept || ""}) xử lý. Bạn không duyệt thay bước của bộ phận khác!`,
          "warning"
        );
        return;
      }
    }

    if (decision === "APPROVE" && stepsCopy[activeIdx]?.requireAttachment && decisionAttachments.length === 0) {
      showToast(
        `Bước "${stepsCopy[activeIdx]?.stepName}" yêu cầu phải tải tệp lên (${stepsCopy[activeIdx]?.attachmentLabel || "Hóa đơn / Chứng từ kết quả"}) trước khi bấm Phê duyệt!`,
        "warning"
      );
      return;
    }

    let nextStatus: ProposalStatus = proposal.status;
    let nextStepIdx = activeIdx;
    let auditAction = "";
    let auditDetail = "";
    let notifyTitle = "";
    let notifyMsg = "";
    let notifyTargets: string[] = [];

    const stepUploadedFiles = decision === "EXECUTE" ? executionAttachments : decisionAttachments;
    const uploadedFilesNote =
      stepUploadedFiles.length > 0
        ? ` (Đính kèm ${stepUploadedFiles.length} tệp: ${stepUploadedFiles.map((f) => f.name).join(", ")})`
        : "";

    if (decision === "APPROVE") {
      if (stepsCopy[activeIdx]) {
        const prevStepAtts = Array.isArray(stepsCopy[activeIdx].attachments) ? stepsCopy[activeIdx].attachments! : [];
        stepsCopy[activeIdx] = {
          ...stepsCopy[activeIdx],
          status: "APPROVED",
          decidedAt: nowStr,
          decidedBy: currentStaffName,
          comment: note || (decisionAttachments.length > 0 ? `Đã duyệt & tải lên ${decisionAttachments.length} tệp đính kèm` : "Đồng ý phê duyệt"),
          attachments: [...prevStepAtts, ...decisionAttachments]
        };
      }
      const nextWaitingIdx = stepsCopy.findIndex((s, i) => i > activeIdx && s.status !== "APPROVED" && s.status !== "SKIPPED");
      if (nextWaitingIdx >= 0) {
        stepsCopy[nextWaitingIdx] = {
          ...stepsCopy[nextWaitingIdx],
          status: "PENDING_NOW"
        };
        nextStepIdx = nextWaitingIdx;
        nextStatus = "PENDING";
        auditAction = `Phê duyệt Bước ${activeIdx + 1}/${stepsCopy.length}`;
        auditDetail = `${currentStaffName} đã duyệt "${stepsCopy[activeIdx]?.stepName}"${uploadedFilesNote}. Chuyển Bước ${nextWaitingIdx + 1}: ${stepsCopy[nextWaitingIdx].approverName}.${note ? ` Ý kiến: ${note}` : ""}`;
        notifyTitle = `✅ Đã duyệt Bước ${activeIdx + 1} [${proposal.proposalCode}]`;
        notifyMsg = `${currentStaffName} đã duyệt Bước ${activeIdx + 1} đề xuất "${proposal.title}"${uploadedFilesNote}. Đề xuất đã chuyển sang Bước ${nextWaitingIdx + 1} chờ ${stepsCopy[nextWaitingIdx].approverName} phê duyệt.`;
        notifyTargets = [proposal.requesterName, stepsCopy[nextWaitingIdx].approverName, ...(proposal.followers || [])];
      } else {
        nextStatus = "APPROVED";
        auditAction = "Phê duyệt hoàn tất (Final Approved)";
        auditDetail = `${currentStaffName} đã phê duyệt bước cuối${uploadedFilesNote}. Đề xuất chính thức có hiệu lực thi hành.${note ? ` Chỉ đạo: ${note}` : ""}`;
        const isLeaveProp =
          proposal.templateId === "tmpl_leave_request" ||
          String(proposal.proposalCode || "").toUpperCase().startsWith("DXNP") ||
          String(proposal.templateName || "").toLowerCase().includes("nghỉ phép");
        const isTripProp = isBusinessTripProposal(proposal);
        if (isLeaveProp) {
          const lvType = proposal.formValues?.leaveType || "Nghỉ phép";
          const lvFrom = formatDayVN(proposal.formValues?.fromDate || proposal.neededByDate);
          const lvTo = formatDayVN(proposal.formValues?.toDate || proposal.neededByDate);
          const lvDays = proposal.formValues?.totalDays || "1";
          const lvHandover = proposal.formValues?.handoverStaff || "Đồng nghiệp cùng phòng";
          const matchedHandoverStaff = allStaffNames.filter((n) => isSamePerson(n, lvHandover));
          notifyTitle = `🏖️ THÔNG BÁO NGHỈ PHÉP [${proposal.proposalCode}]: ${proposal.requesterName}`;
          notifyMsg = `${proposal.requesterName} (${proposal.requesterDept}) nghỉ ${lvDays} ngày (${lvFrom} → ${lvTo} • ${lvType}). Người nhận bàn giao công việc: ${lvHandover}. Đã được ${currentStaffName} phê duyệt.`;
          notifyTargets = [
            proposal.requesterName,
            ...matchedHandoverStaff,
            ...(proposal.steps || []).map((s) => s.approverName).filter(Boolean),
            ...(proposal.followers || [])
          ];
        } else if (isTripProp) {
          const depStr = formatDayVN(proposal.formValues?.departureDate || proposal.neededByDate);
          const retStr = formatDayVN(proposal.formValues?.returnDate || proposal.formValues?.departureDate || proposal.neededByDate);
          const destStr = proposal.formValues?.destination || proposal.customerName || "Đơn vị công tác";
          const compList = String(proposal.formValues?.companions || "")
            .split(/[,;\n]+/)
            .map((s) => cleanStaffDisplayName(s))
            .filter(Boolean);
          auditDetail = `${currentStaffName} đã phê duyệt công lệnh đi công tác (${depStr} → ${retStr} tại ${destStr}) & tự động đồng bộ lên Lịch Công Tác Tuần${uploadedFilesNote}.${note ? ` Chỉ đạo: ${note}` : ""}`;
          notifyTitle = `✈️ ĐÃ DUYỆT LỊCH CÔNG TÁC [${proposal.proposalCode}]: ${destStr}`;
          notifyMsg = `Đề xuất đi công tác "${proposal.title}" (${depStr} → ${retStr} tại ${destStr}) của ${proposal.requesterName} đã được ${currentStaffName} phê duyệt và tự động cập nhật vào Lịch Công Tác Tuần!`;
          notifyTargets = [
            proposal.requesterName,
            ...compList,
            proposal.executorName || "",
            ...(proposal.followers || [])
          ];
        } else {
          notifyTitle = `🎉 ĐÃ PHÊ DUYỆT HOÀN TẤT [${proposal.proposalCode}]`;
          notifyMsg = `Đề xuất "${proposal.title}" của ${proposal.requesterName} đã được ${currentStaffName} phê duyệt hoàn tất${uploadedFilesNote}!${note ? ` Chỉ đạo: "${note}"` : ""}`;
          notifyTargets = [proposal.requesterName, proposal.executorName || "", ...(proposal.followers || [])];
        }
      }
    } else if (decision === "RETURN") {
      if (stepsCopy[activeIdx]) {
        const prevStepAtts = Array.isArray(stepsCopy[activeIdx].attachments) ? stepsCopy[activeIdx].attachments! : [];
        stepsCopy[activeIdx] = {
          ...stepsCopy[activeIdx],
          status: "RETURNED",
          decidedAt: nowStr,
          decidedBy: currentStaffName,
          comment: note,
          attachments: [...prevStepAtts, ...decisionAttachments]
        };
      }
      nextStatus = "RETURNED";
      auditAction = `Yêu cầu bổ sung / Giải trình (Bước ${activeIdx + 1})`;
      auditDetail = `${currentStaffName} trả lại yêu cầu bổ sung hồ sơ/giải trình: "${note}"${uploadedFilesNote}`;
      notifyTitle = `🔄 Yêu cầu bổ sung đề xuất [${proposal.proposalCode}]`;
      notifyMsg = `${currentStaffName} yêu cầu bổ sung/giải trình cho đề xuất "${proposal.title}": "${note}"${uploadedFilesNote}. Vui lòng chỉnh sửa và gửi duyệt lại!`;
      notifyTargets = [proposal.requesterName, ...(proposal.followers || [])];
    } else if (decision === "REJECT") {
      if (stepsCopy[activeIdx]) {
        const prevStepAtts = Array.isArray(stepsCopy[activeIdx].attachments) ? stepsCopy[activeIdx].attachments! : [];
        stepsCopy[activeIdx] = {
          ...stepsCopy[activeIdx],
          status: "REJECTED",
          decidedAt: nowStr,
          decidedBy: currentStaffName,
          comment: note,
          attachments: [...prevStepAtts, ...decisionAttachments]
        };
      }
      nextStatus = "REJECTED";
      auditAction = `Từ chối phê duyệt (Bước ${activeIdx + 1})`;
      auditDetail = `${currentStaffName} từ chối phê duyệt. Lý do: "${note}"${uploadedFilesNote}`;
      notifyTitle = `❌ Từ chối đề xuất [${proposal.proposalCode}]`;
      notifyMsg = `${currentStaffName} đã từ chối đề xuất "${proposal.title}". Lý do: "${note}"`;
      notifyTargets = [proposal.requesterName, ...(proposal.followers || [])];
    } else if (decision === "EXECUTE") {
      nextStatus = "EXECUTED";
      auditAction = "Xác nhận Đã thực thi / Xuất hóa đơn / Giải ngân";
      auditDetail = `${currentStaffName} xác nhận đã hoàn tất thực thi đề xuất${uploadedFilesNote}.${note ? ` Ghi chú: ${note}` : ""}`;
      notifyTitle = `🏁 Đã thực thi hoàn tất [${proposal.proposalCode}]`;
      notifyMsg = `${currentStaffName} đã thực thi hoàn tất đề xuất "${proposal.title}"${uploadedFilesNote} (${note || "Đã xuất hóa đơn / giải ngân / thực thi hoàn tất"}).`;
      notifyTargets = [proposal.requesterName, ...(proposal.followers || [])];
    } else if (decision === "WITHDRAW") {
      nextStatus = "WITHDRAWN";
      auditAction = "Người đề xuất rút lại / Hủy tờ trình";
      auditDetail = `${currentStaffName} đã chủ động rút lại đề xuất.${note ? ` Lý do: ${note}` : ""}`;
    }

    const updatedComments = (note || stepUploadedFiles.length > 0)
      ? [
          ...(proposal.comments || []),
          {
            id: `cmt-${Date.now()}`,
            author: currentStaffName,
            dept: userDept,
            text: note || `Đã đính kèm ${stepUploadedFiles.length} tệp kết quả (${stepUploadedFiles.map((f) => f.name).join(", ")})`,
            time: nowStr,
            attachments: stepUploadedFiles.length > 0 ? stepUploadedFiles : undefined,
            actionTag:
              decision === "APPROVE"
                ? "✅ Phê duyệt"
                : decision === "RETURN"
                ? "🔄 Yêu cầu bổ sung"
                : decision === "REJECT"
                ? "❌ Từ chối"
                : decision === "EXECUTE"
                ? "🏁 Đã thực thi & Gửi chứng từ"
                : "🚫 Đã rút"
          }
        ]
      : proposal.comments || [];

    const existingAtts = Array.isArray(proposal.attachments) ? proposal.attachments : [];
    const existingUrls = new Set(existingAtts.map((a) => a.url));
    const mergedAttachments = [
      ...existingAtts,
      ...stepUploadedFiles.filter((a) => a && a.url && !existingUrls.has(a.url))
    ];
    const prevExecAtts = Array.isArray(proposal.executionAttachments) ? proposal.executionAttachments : [];
    const mergedExecAtts = decision === "EXECUTE" ? [...prevExecAtts, ...executionAttachments] : prevExecAtts;

    const updatedProposal: ProposalItem = {
      ...proposal,
      steps: stepsCopy,
      currentStepIndex: nextStepIdx,
      status: nextStatus,
      updatedAt: nowStr,
      executedAt: decision === "EXECUTE" ? nowStr : proposal.executedAt,
      executionNote: decision === "EXECUTE" ? note || "Đã thực thi hoàn tất" : proposal.executionNote,
      executionAttachments: mergedExecAtts,
      attachments: mergedAttachments,
      comments: updatedComments,
      auditLogs: [
        ...(proposal.auditLogs || []),
        {
          time: nowStr,
          actor: currentStaffName,
          action: auditAction,
          detail: auditDetail
        }
      ]
    };

    const nextList = proposals.map((p) => (p.id === proposal.id ? updatedProposal : p));
    await onSaveProposals(nextList);
    setSelectedProposal(updatedProposal);
    setDecisionNote("");
    setDecisionAttachments([]);
    setExecutionNoteInput("");
    setExecutionAttachments([]);

    const cleanTargets = Array.from(new Set(notifyTargets.filter((n) => n && !isSamePerson(n, currentStaffName))));
    if (notifyTitle && cleanTargets.length > 0) {
      notifyActivity({
        title: notifyTitle,
        message: notifyMsg,
        type: decision === "REJECT" ? "error" : decision === "RETURN" ? "warning" : "success",
        category: "task",
        sender: { name: currentStaffName },
        targetEmployeeNames: cleanTargets,
        targetDept: proposal.requesterDept || "all",
        link: { tab: "workspace", subTab: "proposals", itemId: proposal.proposalCode }
      });
    }

    showToast(`${auditAction} cho phiếu [${proposal.proposalCode}] thành công!`, "success");
  };

  // Ủy quyền / Chuyển người duyệt bước hiện tại
  const handleDelegateStep = async () => {
    if (!selectedProposal || !delegateToStaff.trim()) {
      showToast("Vui lòng chọn nhân sự nhận ủy quyền duyệt!", "warning");
      return;
    }
    const nowStr = nowVNDateTime();
    const stepsCopy = [...(selectedProposal.steps || [])];
    const activeIdx =
      stepsCopy.findIndex((s) => s.status === "PENDING_NOW") >= 0
        ? stepsCopy.findIndex((s) => s.status === "PENDING_NOW")
        : selectedProposal.currentStepIndex || 0;

    const oldApprover = stepsCopy[activeIdx]?.approverName || "";
    if (stepsCopy[activeIdx]) {
      stepsCopy[activeIdx] = {
        ...stepsCopy[activeIdx],
        approverName: delegateToStaff
      };
    }

    const updatedProposal: ProposalItem = {
      ...selectedProposal,
      steps: stepsCopy,
      updatedAt: nowStr,
      auditLogs: [
        ...(selectedProposal.auditLogs || []),
        {
          time: nowStr,
          actor: currentStaffName,
          action: `Ủy quyền duyệt Bước ${activeIdx + 1}`,
          detail: `Chuyển người duyệt từ ${oldApprover} sang ${delegateToStaff}${decisionNote ? ` (${decisionNote})` : ""}`
        }
      ]
    };

    const nextList = proposals.map((p) => (p.id === selectedProposal.id ? updatedProposal : p));
    await onSaveProposals(nextList);
    setSelectedProposal(updatedProposal);
    setShowDelegateBox(false);
    setDelegateToStaff("");

    notifyActivity({
      title: `↪️ Ủy quyền phê duyệt [${selectedProposal.proposalCode}]`,
      message: `${currentStaffName} đã chuyển quyền phê duyệt đề xuất "${selectedProposal.title}" sang cho ${delegateToStaff}.`,
      type: "info",
      category: "task",
      sender: { name: currentStaffName },
      targetEmployeeNames: [delegateToStaff],
      targetDept: "all",
      link: { tab: "workspace", subTab: "proposals", itemId: selectedProposal.proposalCode }
    });

    showToast(`Đã ủy quyền bước duyệt cho ${delegateToStaff}!`, "success");
  };

  // Duyệt nhanh hàng loạt (Bulk Approve)
  const handleBulkApprove = async () => {
    if (selectedIdsForBulk.length === 0) return;
    const nowStr = nowVNDateTime();
    let count = 0;
    const nextList = proposals.map((p) => {
      if (!selectedIdsForBulk.includes(p.id) || p.status !== "PENDING") return p;
      const stepsCopy = [...(p.steps || [])];
      const activeIdx =
        stepsCopy.findIndex((s) => s.status === "PENDING_NOW") >= 0
          ? stepsCopy.findIndex((s) => s.status === "PENDING_NOW")
          : p.currentStepIndex || 0;
      if (stepsCopy[activeIdx]) {
        stepsCopy[activeIdx] = {
          ...stepsCopy[activeIdx],
          status: "APPROVED",
          decidedAt: nowStr,
          decidedBy: currentStaffName,
          comment: "Phê duyệt nhanh (Bulk Approve)"
        };
      }
      const nextWaitingIdx = stepsCopy.findIndex((s, i) => i > activeIdx && s.status !== "APPROVED" && s.status !== "SKIPPED");
      let nextStatus: ProposalStatus = "APPROVED";
      let nextStepIdx = activeIdx;
      if (nextWaitingIdx >= 0) {
        stepsCopy[nextWaitingIdx] = { ...stepsCopy[nextWaitingIdx], status: "PENDING_NOW" };
        nextStatus = "PENDING";
        nextStepIdx = nextWaitingIdx;
      }
      count++;
      return {
        ...p,
        steps: stepsCopy,
        currentStepIndex: nextStepIdx,
        status: nextStatus,
        updatedAt: nowStr,
        auditLogs: [
          ...(p.auditLogs || []),
          {
            time: nowStr,
            actor: currentStaffName,
            action: `Duyệt nhanh Bước ${activeIdx + 1}`,
            detail: `${currentStaffName} đã phê duyệt hàng loạt.`
          }
        ]
      };
    });
    await onSaveProposals(nextList);
    setSelectedIdsForBulk([]);
    showToast(`⚡ Đã phê duyệt nhanh ${count} đề xuất thành công!`, "success");
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProposal || (!commentInput.trim() && commentAttachments.length === 0)) return;
    const nowStr = nowVNDateTime();
    const newCmt = {
      id: `cmt-${Date.now()}`,
      author: currentStaffName,
      dept: userDept,
      text: commentInput.trim() || `Đã tải lên ${commentAttachments.length} tệp đính kèm`,
      time: nowStr,
      attachments: commentAttachments.length > 0 ? commentAttachments : undefined
    };
    const existingAtts = Array.isArray(selectedProposal.attachments) ? selectedProposal.attachments : [];
    const existingUrls = new Set(existingAtts.map((a) => a.url));
    const mergedAtts = [
      ...existingAtts,
      ...commentAttachments.filter((a) => a && a.url && !existingUrls.has(a.url))
    ];
    const updated: ProposalItem = {
      ...selectedProposal,
      attachments: mergedAtts,
      comments: [...(selectedProposal.comments || []), newCmt]
    };
    const nextList = proposals.map((p) => (p.id === selectedProposal.id ? updated : p));
    await onSaveProposals(nextList);
    setSelectedProposal(updated);
    setCommentInput("");
    setCommentAttachments([]);
    showToast("Đã gửi thảo luận & tệp đính kèm vào tờ trình!", "success");
  };

  // Thêm / Bỏ Người theo dõi (Followers — Chỉ theo dõi tiến độ & nhận thông báo, không có chức năng phê duyệt)
  const handleUpdateProposalFollowers = async (
    proposal: ProposalItem,
    nextFollowersRaw: string[],
    addedPerson?: string
  ) => {
    const cleanList = Array.from(
      new Set(
        (nextFollowersRaw || [])
          .map((n) => cleanStaffDisplayName(n))
          .filter(Boolean)
      )
    );
    const nowStr = nowVNDateTime();
    const updated: ProposalItem = {
      ...proposal,
      followers: cleanList,
      updatedAt: nowStr,
      auditLogs: [
        ...(proposal.auditLogs || []),
        {
          time: nowStr,
          actor: currentStaffName,
          action: addedPerson
            ? `Thêm người theo dõi: ${addedPerson}`
            : "Cập nhật danh sách người theo dõi",
          detail:
            cleanList.length > 0
              ? `Người theo dõi (chỉ xem, không duyệt): ${cleanList.join(", ")}`
              : "Đã xóa danh sách người theo dõi"
        }
      ]
    };
    const nextList = proposals.map((p) => (p.id === proposal.id ? updated : p));
    await onSaveProposals(nextList);
    if (selectedProposal?.id === proposal.id) {
      setSelectedProposal(updated);
    }
    if (addedPerson && !isSamePerson(addedPerson, currentStaffName)) {
      notifyActivity({
        title: `👁️ Mời theo dõi đề xuất [${proposal.proposalCode}]`,
        message: `${currentStaffName} đã thêm bạn làm Người theo dõi (chỉ xem tiến độ, không cần ký duyệt) cho đề xuất "${proposal.title}" của ${proposal.requesterName}.`,
        type: "info",
        category: "task",
        sender: { name: currentStaffName },
        targetEmployeeNames: [addedPerson],
        targetDept: "all",
        link: { tab: "workspace", subTab: "proposals", itemId: proposal.proposalCode }
      });
    }
    showToast(
      addedPerson
        ? `👁️ Đã thêm ${addedPerson} vào danh sách theo dõi (chỉ xem, không duyệt)!`
        : "👁️ Đã cập nhật danh sách người theo dõi đề xuất!",
      "info"
    );
  };

  useEffect(() => {
    const onRecoded = (e: any) => {
      const list = Array.isArray(e?.detail) ? e.detail : [];
      if (list.length === 0) return;
      showToast(`Mã đơn bị trùng với đơn người khác vừa lập nên đã được cấp lại: ${list.map((x: any) => `${x.from} → ${x.to}`).join(", ")}`, "warning");
    };
    window.addEventListener("tbr:proposal-recoded", onRecoded);
    return () => window.removeEventListener("tbr:proposal-recoded", onRecoded);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeleteProposal = async (p: ProposalItem) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa đề xuất [${p.proposalCode}] "${p.title}"?`)) return;
    const nextList = proposals.filter((item) => item.id !== p.id);
    await onSaveProposals(nextList);
    if (selectedProposal?.id === p.id) setSelectedProposal(null);
    showToast(`Đã xóa đề xuất [${p.proposalCode}]`, "info");
  };

  // In Phiếu Đề Xuất & Phê Duyệt chuẩn A4 (có dấu mọc Chữ ký số nội bộ)
  const handlePrintProposal = (rawProposal: ProposalItem) => {
    // Mọi chuỗi người dùng nhập (tiêu đề, nội dung, ý kiến duyệt, tên tệp...) được mã hóa HTML trước khi ghi vào
    // trang in: trước đây chèn thẳng nên một đề xuất có mã <script> sẽ chạy dưới quyền người bấm In (XSS).
    const p = escapeDeepHtml(rawProposal);
    const tmpl = escapeDeepHtml(templates.find((t) => t.id === rawProposal.templateId));
    const win = window.open("", "_blank", "width=950,height=850");
    if (!win) {
      showToast("Vui lòng cho phép trình duyệt mở cửa sổ Pop-up để in phiếu!", "warning");
      return;
    }

    const fieldsHtml = (tmpl?.fields || [])
      .map((f) => {
        const val = p.formValues?.[f.key];
        if (!val || (Array.isArray(val) && val.length === 0)) return "";
        const displayVal =
          f.type === "date"
            ? formatDayVN(val)
            : Array.isArray(val)
            ? val.map((a: any) => a?.name || "").filter(Boolean).join(", ")
            : String(val);
        if (!displayVal) return "";
        return `<tr><td style="padding:6px 10px;border:1px solid #cbd5e1;font-weight:600;width:36%;background:#f8fafc">${f.label}</td><td style="padding:6px 10px;border:1px solid #cbd5e1">${displayVal}</td></tr>`;
      })
      .join("") + (() => {
        const ld = parseLeaveDays(p.formValues || {});
        return ld
          ? `<tr><td style="padding:6px 10px;border:1px solid #cbd5e1;font-weight:600;width:36%;background:#f8fafc">Các ngày nghỉ cụ thể (${ld.length} ngày)</td><td style="padding:6px 10px;border:1px solid #cbd5e1">${formatLeaveDays(ld, 200)}</td></tr>`
          : "";
      })();

    const lineItemsHtml =
      Array.isArray(p.lineItems) && p.lineItems.length > 0
        ? `<h4 style="margin:16px 0 8px;font-size:13px;text-transform:uppercase;color:#1e293b">BẢNG KÊ CHI TIẾT HẠNG MỤC / KINH PHÍ ĐỀ XUẤT:</h4>
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:12px">
          <thead>
            <tr style="background:#f1f5f9">
              <th style="border:1px solid #cbd5e1;padding:6px;width:36px">STT</th>
              <th style="border:1px solid #cbd5e1;padding:6px;text-align:left">${tmpl?.lineItemColumns?.col1 || "Nội dung / Hạng mục"}</th>
              <th style="border:1px solid #cbd5e1;padding:6px;text-align:left">${tmpl?.lineItemColumns?.col2 || "ĐVT / Quy cách"}</th>
              <th style="border:1px solid #cbd5e1;padding:6px;text-align:center">${tmpl?.lineItemColumns?.col3 || "SL"}</th>
              <th style="border:1px solid #cbd5e1;padding:6px;text-align:right">${tmpl?.lineItemColumns?.col4 || "Đơn giá"}</th>
              <th style="border:1px solid #cbd5e1;padding:6px;text-align:right">Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            ${p.lineItems
              .map(
                (li, idx) => `<tr>
                <td style="border:1px solid #cbd5e1;padding:6px;text-align:center">${idx + 1}</td>
                <td style="border:1px solid #cbd5e1;padding:6px;font-weight:600">${li.itemName || ""}</td>
                <td style="border:1px solid #cbd5e1;padding:6px">${li.specification || ""}</td>
                <td style="border:1px solid #cbd5e1;padding:6px;text-align:center">${li.quantity || 0}</td>
                <td style="border:1px solid #cbd5e1;padding:6px;text-align:right">${formatMoneyVND(li.unitPrice)}</td>
                <td style="border:1px solid #cbd5e1;padding:6px;text-align:right;font-weight:700">${formatMoneyVND(li.amount)}</td>
              </tr>`
              )
              .join("")}
            <tr style="background:#f8fafc;font-weight:800">
              <td colspan="5" style="border:1px solid #cbd5e1;padding:8px;text-align:right">TỔNG CỘNG ĐỀ XUẤT:</td>
              <td style="border:1px solid #cbd5e1;padding:8px;text-align:right;color:#be123c;font-size:13px">${formatMoneyVND(p.totalAmount)}</td>
            </tr>
          </tbody>
        </table>`
        : "";

    const signaturesHtml = [
      {
        title: "NGƯỜI ĐỀ XUẤT",
        dept: p.requesterDept,
        actor: p.requesterName,
        status: "SIGNED",
        time: p.createdAt,
        comment: "Đã lập & trình ký"
      },
      ...(p.steps || []).map((st) => ({
        title: st.stepName.toUpperCase(),
        dept: st.dept,
        actor: st.decidedBy || st.approverName,
        status: st.status,
        time: st.decidedAt || "",
        comment: st.comment || ""
      }))
    ]
      .map(
        (sig) => `<div style="flex:1;min-width:150px;border:1px solid #cbd5e1;border-radius:8px;padding:10px;text-align:center;background:#fff">
          <div style="font-size:11px;font-weight:800;color:#334155">${sig.title}</div>
          <div style="font-size:10px;color:#64748b;margin-bottom:8px">${sig.dept || ""}</div>
          ${
            sig.status === "APPROVED" || sig.status === "SIGNED"
              ? `<div style="display:inline-block;border:2px solid #059669;color:#059669;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:800;margin:6px 0">
                  ✓ ĐÃ KÝ DUYỆT ĐIỆN TỬ<br/>
                  <span style="font-size:9px;font-weight:600">${sig.time}</span>
                </div>`
              : sig.status === "REJECTED"
              ? `<div style="display:inline-block;border:2px solid #e11d48;color:#e11d48;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:800;margin:6px 0">✕ TỪ CHỐI DUYỆT</div>`
              : `<div style="height:44px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px;font-style:italic">(Đang chờ ký duyệt)</div>`
          }
          <div style="font-size:12px;font-weight:700;color:#0f172a;margin-top:6px">${sig.actor}</div>
          ${sig.comment ? `<div style="font-size:10px;color:#475569;margin-top:4px;font-style:italic">"${sig.comment}"</div>` : ""}
        </div>`
      )
      .join("");

    writeSafePrintDocument(win, `<!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8"/>
        <title>Phiếu Đề Xuất ${p.proposalCode} - ${p.title}</title>
        <style>
          body { font-family: "Times New Roman", Arial, sans-serif; color: #0f172a; padding: 24px 32px; line-height: 1.45; }
          @media print { .no-print { display: none !important; } body { padding: 10px; } }
        </style>
      </head>
      <body>
        <div class="no-print" style="margin-bottom:16px;text-align:right">
          <button onclick="window.print()" style="background:#4f46e5;color:#fff;border:none;padding:8px 18px;border-radius:8px;font-weight:700;cursor:pointer">🖨️ In Phiếu / Lưu PDF (A4)</button>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:12px;margin-bottom:16px">
          <div>
            <div style="font-weight:800;font-size:14px;text-transform:uppercase">HỆ THỐNG QUẢN TRỊ & ĐIỀU HÀNH DOANH NGHIỆP</div>
            <div style="font-size:12px;color:#334155">Bộ phận trình: <strong>${p.requesterDept}</strong></div>
            <div style="font-size:12px;color:#334155">Số hiệu phiếu: <strong>${p.proposalCode}</strong></div>
          </div>
          <div style="text-align:center">
            <div style="font-weight:700;font-size:13px">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
            <div style="font-weight:700;font-size:12px;text-decoration:underline">Độc lập - Tự do - Hạnh phúc</div>
            <div style="font-size:11px;font-style:italic;margin-top:4px">Ngày lập: ${p.createdAt}</div>
          </div>
        </div>

        <div style="text-align:center;margin:18px 0">
          <h2 style="margin:0;font-size:20px;text-transform:uppercase;letter-spacing:0.5px">${p.templateName}</h2>
          <div style="font-size:14px;font-weight:700;margin-top:4px;color:#1e293b">V/v: ${p.title}</div>
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px">
          <tr>
            <td style="padding:6px 10px;border:1px solid #cbd5e1;font-weight:600;width:36%;background:#f8fafc">Họ tên người đề xuất</td>
            <td style="padding:6px 10px;border:1px solid #cbd5e1"><strong>${p.requesterName}</strong> (${p.requesterDept})</td>
          </tr>
          <tr>
            <td style="padding:6px 10px;border:1px solid #cbd5e1;font-weight:600;background:#f8fafc">Mức độ ưu tiên & Hạn cần duyệt</td>
            <td style="padding:6px 10px;border:1px solid #cbd5e1">${p.priority === "URGENT" ? "KHẨN CẤP" : p.priority === "HIGH" ? "Ưu tiên cao" : "Bình thường"} — Hạn cần duyệt: <strong>${formatDayVN(p.neededByDate)}</strong></td>
          </tr>
          ${
            p.totalAmount > 0
              ? `<tr><td style="padding:6px 10px;border:1px solid #cbd5e1;font-weight:600;background:#f8fafc">Tổng số tiền / Giá trị đề xuất</td><td style="padding:6px 10px;border:1px solid #cbd5e1;font-weight:800;color:#be123c">${formatMoneyVND(p.totalAmount)}</td></tr>`
              : ""
          }
          ${
            p.customerName
              ? `<tr><td style="padding:6px 10px;border:1px solid #cbd5e1;font-weight:600;background:#f8fafc">Khách hàng / Đơn vị liên quan</td><td style="padding:6px 10px;border:1px solid #cbd5e1">${p.customerName}</td></tr>`
              : ""
          }
          ${
            p.supplierName
              ? `<tr><td style="padding:6px 10px;border:1px solid #cbd5e1;font-weight:600;background:#f8fafc">Nhà cung cấp / Đối tác</td><td style="padding:6px 10px;border:1px solid #cbd5e1">${p.supplierName}</td></tr>`
              : ""
          }
          ${fieldsHtml}
          <tr>
            <td style="padding:6px 10px;border:1px solid #cbd5e1;font-weight:600;background:#f8fafc">Nội dung giải trình & Lý do đề xuất</td>
            <td style="padding:6px 10px;border:1px solid #cbd5e1;white-space:pre-line">${p.summaryReason}</td>
          </tr>
        </table>

        ${lineItemsHtml}

        <h4 style="margin:18px 0 8px;font-size:13px;text-transform:uppercase;color:#1e293b">XÁC NHẬN & PHÊ DUYỆT CỦA CÁC CẤP THẨM QUYỀN:</h4>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">
          ${signaturesHtml}
        </div>
      </body>
      </html>`);
  };

  const templateByIdMap = useMemo(() => {
    const m = new Map<string, ProposalTemplate>();
    for (const t of templates) {
      if (t?.id) m.set(t.id, t);
    }
    return m;
  }, [templates]);

  // Danh sách đề xuất mà người dùng hiện tại có quyền nhìn thấy theo 3 chế độ hiển thị (PRIVATE / DEPT / PUBLIC)
  const accessibleProposals = useMemo(
    () =>
      (proposals || []).filter((p) =>
        canUserViewProposal(
          p,
          currentStaffName,
          userDept,
          isDirector,
          isManager,
          personnelList,
          templateByIdMap.get(p?.templateId)
        )
      ),
    [proposals, currentStaffName, userDept, isDirector, isManager, personnelList, templateByIdMap]
  );

  // Thống kê & Lọc danh sách Đề xuất theo phân quyền và phân khu
  const waitingForMeList = useMemo(
    () => accessibleProposals.filter((p) => isProposalWaitingForUser(p, currentStaffName, userDept, isDirector, isManager)),
    [accessibleProposals, currentStaffName, userDept, isDirector, isManager]
  );

  const myProposalsList = useMemo(
    () => accessibleProposals.filter((p) => isSamePerson(p.requesterName, currentStaffName)),
    [accessibleProposals, currentStaffName]
  );

  const followingOrExecList = useMemo(
    () =>
      accessibleProposals.filter(
        (p) =>
          (p.followers || []).some((f) => isSamePerson(f, currentStaffName)) ||
          isSamePerson(p.executorName, currentStaffName) ||
          (p.steps || []).some((s) => isSamePerson(s.approverName, currentStaffName))
      ),
    [accessibleProposals, currentStaffName]
  );

  const filteredProposals = useMemo(() => {
    let base = accessibleProposals;
    if (subView === "to_approve") {
      base = waitingForMeList;
    } else if (subView === "my_proposals") {
      base = myProposalsList;
    } else if (subView === "following") {
      base = followingOrExecList;
    } else {
      // Nếu Ban Giám Đốc / Trưởng phòng đang lọc theo một phòng ban cụ thể trên thanh lọc chung (`selectedDept !== "all"`)
      // thì giữ các đơn thuộc phòng đang lọc, các đơn liên quan trực tiếp tới mình hoặc các đơn Công khai toàn công ty
      if (isDirector && selectedDept !== "all") {
        base = base.filter(
          (p) =>
            getEffectiveProposalVisibility(p, templateByIdMap.get(p.templateId)) === "PUBLIC" ||
            isUserDirectlyInProposalFlow(p, currentStaffName, userDept, false, isManager, personnelList) ||
            isSameWorkspaceDept(p.requesterDept, selectedDept) ||
            (p.steps || []).some((s) => isSameWorkspaceDept(s.dept, selectedDept))
        );
      }
    }

    return base.filter((p) => {
      if (hideStaffLeaveForDirector && isDirector && isLeaveProposal(p)) {
        const involvesDirector =
          isSameWorkspaceDept(p.requesterDept, "Ban Giám Đốc") ||
          isPersonDeptHeadOrDeputy(p.requesterName, p.requesterDept, personnelList) ||
          (p.steps || []).some((s) => s.roleType === "DIRECTOR" || s.dept === "Ban Giám Đốc");
        if (!involvesDirector) return false;
      }
      if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (priorityFilter !== "all" && p.priority !== priorityFilter) return false;

      if (fromDate || toDate) {
        const createdIso = String(p.neededByDate || p.createdAt || "").slice(0, 10);
        if (fromDate && createdIso < fromDate) return false;
        if (toDate && createdIso > toDate) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const canSeeLeaveReason =
          !isLeaveProposal(p) ||
          canUserSeeFullLeaveDetails(p, currentStaffName, userDept, isDirector, isManager, personnelList);
        const hit =
          String(p.proposalCode || "").toLowerCase().includes(q) ||
          String(p.title || "").toLowerCase().includes(q) ||
          String(p.templateName || "").toLowerCase().includes(q) ||
          String(p.requesterName || "").toLowerCase().includes(q) ||
          String(p.customerName || "").toLowerCase().includes(q) ||
          String(p.supplierName || "").toLowerCase().includes(q) ||
          (canSeeLeaveReason && String(p.summaryReason || "").toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [
    accessibleProposals,
    subView,
    waitingForMeList,
    myProposalsList,
    followingOrExecList,
    isDirector,
    isManager,
    userDept,
    personnelList,
    templateByIdMap,
    currentStaffName,
    selectedDept,
    categoryFilter,
    statusFilter,
    priorityFilter,
    fromDate,
    toDate,
    searchQuery,
    hideStaffLeaveForDirector
  ]);

  const totalPendingAmount = useMemo(
    () =>
      accessibleProposals
        .filter((p) => p.status === "PENDING")
        .reduce((acc, p) => acc + (Number(p.totalAmount) || 0), 0),
    [accessibleProposals]
  );

  const totalApprovedCount = useMemo(
    () => accessibleProposals.filter((p) => p.status === "APPROVED" || p.status === "EXECUTED").length,
    [accessibleProposals]
  );

  // ==================== BỘ THEO DÕI NGHỈ PHÉP TOÀN CÔNG TY & TỔNG HỢP CHẤM CÔNG THÁNG ====================
  const isLeaveProposalItem = (p: ProposalItem) =>
    p.templateId === "tmpl_leave_request" ||
    String(p.proposalCode || "").toUpperCase().startsWith("DXNP") ||
    String(p.proposalCode || "").toUpperCase().startsWith("TBNP") ||
    String(p.templateName || "").toLowerCase().includes("nghỉ phép") ||
    String(p.templateName || "").toLowerCase().includes("vắng mặt");

  /** `month` ("YYYY-MM"): với đơn "các ngày cụ thể" chỉ tính các ngày trong tháng đó. */
  const getLeaveDatesAndDays = (p: ProposalItem, month?: string) => {
    const fv = p.formValues || {};
    const leaveDays = parseLeaveDays(fv);
    if (leaveDays) {
      const inMonth = month ? leaveDays.filter((d) => d.date.startsWith(month)) : leaveDays;
      return {
        fDate: leaveDays[0]?.date || "",
        tDate: leaveDays[leaveDays.length - 1]?.date || "",
        days: sumLeaveDays(leaveDays, month),
        leaveType: String(fv.leaveType || fv.hr_sub_type || "Nghỉ phép năm (Có hưởng lương)"),
        handoverStaff: String(fv.handoverStaff || fv.handover_person || "—"),
        leaveDays,
        rangeLabel: formatLeaveDays(inMonth),
        isOffOn: (iso: string) => isOnLeaveOn(leaveDays, iso),
      };
    }
    const fDate = String(fv.fromDate || fv.from_date || p.neededByDate || String(p.createdAt || "").slice(0, 10)).slice(0, 10);
    const tDate = String(fv.toDate || fv.to_date || fDate).slice(0, 10);
    let days = Number(String(fv.totalDays || fv.total_days || "").replace(",", "."));
    if (!Number.isFinite(days) || days <= 0) {
      if (fDate && tDate && tDate >= fDate) {
        const diff = Math.round((new Date(tDate).getTime() - new Date(fDate).getTime()) / 86400000) + 1;
        days = Math.max(1, diff);
      } else {
        days = 1;
      }
    }
    const leaveType = String(fv.leaveType || fv.hr_sub_type || "Nghỉ phép năm (Có hưởng lương)");
    const handoverStaff = String(fv.handoverStaff || fv.handover_person || "—");
    return {
      fDate, tDate, days, leaveType, handoverStaff,
      leaveDays: null as LeaveDay[] | null,
      rangeLabel: "",
      isOffOn: (iso: string) => Boolean(fDate) && fDate <= iso && tDate >= iso,
    };
  };
  const leaveMonthArg = () => (leaveMonthFilter && leaveMonthFilter !== "all" ? leaveMonthFilter : undefined);

  // Đơn nghỉ phục hồi từ thông báo, chưa có ngày nghỉ thật: không tính vào chấm công, liệt kê riêng để bổ sung
  const leaveProposalsMissingDates = useMemo(
    () => accessibleProposals.filter((p) => isLeaveProposalItem(p) && needsLeaveDates(p) && p.status !== "REJECTED" && p.status !== "WITHDRAWN"),
    [accessibleProposals]
  );

  const monthlyLeaveProposals = useMemo(() => {
    return accessibleProposals
      .filter((p) => {
        if (!isLeaveProposalItem(p)) return false;
        if (p.status === "WITHDRAWN" || p.status === "DRAFT") return false;
        if (needsLeaveDates(p)) return false;
        if (hideStaffLeaveForDirector && isDirector) {
          const involvesDirector =
            isSameWorkspaceDept(p.requesterDept, "Ban Giám Đốc") ||
            isPersonDeptHeadOrDeputy(p.requesterName, p.requesterDept, personnelList) ||
            (p.steps || []).some((s) => s.roleType === "DIRECTOR" || s.dept === "Ban Giám Đốc");
          if (!involvesDirector) return false;
        }
        const { fDate, tDate, leaveType, leaveDays } = getLeaveDatesAndDays(p);
        if (leaveMonthFilter && leaveMonthFilter !== "all") {
          const mStart = `${leaveMonthFilter}-01`;
          const mEnd = `${leaveMonthFilter}-31`;
          const overlapsMonth = leaveDays
            ? leaveDays.some((d) => d.date.startsWith(leaveMonthFilter))
            : fDate.startsWith(leaveMonthFilter) ||
              tDate.startsWith(leaveMonthFilter) ||
              (fDate <= mEnd && tDate >= mStart);
          if (!overlapsMonth) return false;
        }
        if (leaveDeptFilter !== "all" && String(p.requesterDept || "").toLowerCase() !== leaveDeptFilter.toLowerCase()) {
          return false;
        }
        if (leaveTypeFilter !== "all" && leaveType !== leaveTypeFilter) {
          return false;
        }
        if (leaveStatusFilter !== "all") {
          if (leaveStatusFilter === "APPROVED_EXEC") {
            if (p.status !== "APPROVED" && p.status !== "EXECUTED") return false;
          } else if (p.status !== leaveStatusFilter) {
            return false;
          }
        }
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const canSeeLeaveReason = canUserSeeFullLeaveDetails(
            p,
            currentStaffName,
            userDept,
            isDirector,
            isManager,
            personnelList
          );
          const hit =
            String(p.requesterName || "").toLowerCase().includes(q) ||
            String(p.proposalCode || "").toLowerCase().includes(q) ||
            String(p.title || "").toLowerCase().includes(q) ||
            (canSeeLeaveReason && String(p.summaryReason || "").toLowerCase().includes(q)) ||
            String(p.formValues?.handoverStaff || "").toLowerCase().includes(q);
          if (!hit) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const da = getLeaveDatesAndDays(a).fDate;
        const db = getLeaveDatesAndDays(b).fDate;
        return db.localeCompare(da);
      });
  }, [accessibleProposals, leaveMonthFilter, leaveDeptFilter, leaveTypeFilter, leaveStatusFilter, searchQuery, currentStaffName, userDept, isDirector, isManager, personnelList, hideStaffLeaveForDirector]);

  const todayIsoStr = todayVN();
  const todayLeaveProposals = useMemo(() => {
    return accessibleProposals.filter((p) => {
      if (!isLeaveProposalItem(p)) return false;
      if (p.status === "REJECTED" || p.status === "WITHDRAWN" || p.status === "DRAFT") return false;
      if (needsLeaveDates(p)) return false;
      return getLeaveDatesAndDays(p).isOffOn(todayIsoStr);
    });
  }, [accessibleProposals, todayIsoStr]);

  const leaveSummaryByStaff = useMemo(() => {
    const map = new Map<
      string,
      {
        staffName: string;
        dept: string;
        totalRequests: number;
        approvedRequests: number;
        pendingRequests: number;
        paidLeaveDays: number;
        unpaidLeaveDays: number;
        socialOrPolicyDays: number;
        wfhDays: number;
        totalAbsentDays: number;
        periods: { code: string; fromDate: string; toDate: string; days: number; type: string; handover: string; status: string }[];
      }
    >();

    monthlyLeaveProposals.forEach((p) => {
      if (p.status === "REJECTED") return;
      const key = String(p.requesterName || "Nhân sự").trim();
      const { fDate, tDate, days, leaveType, handoverStaff, rangeLabel } = getLeaveDatesAndDays(p, leaveMonthArg());
      const existing = map.get(key) || {
        staffName: key,
        dept: p.requesterDept || "—",
        totalRequests: 0,
        approvedRequests: 0,
        pendingRequests: 0,
        paidLeaveDays: 0,
        unpaidLeaveDays: 0,
        socialOrPolicyDays: 0,
        wfhDays: 0,
        totalAbsentDays: 0,
        periods: []
      };

      existing.totalRequests += 1;
      if (p.status === "APPROVED" || p.status === "EXECUTED") {
        existing.approvedRequests += 1;
      } else {
        existing.pendingRequests += 1;
      }

      const ltLower = leaveType.toLowerCase();
      if (ltLower.includes("wfh") || ltLower.includes("từ xa")) {
        existing.wfhDays += days;
      } else if (ltLower.includes("không hưởng lương") || ltLower.includes("việc riêng")) {
        existing.unpaidLeaveDays += days;
        existing.totalAbsentDays += days;
      } else if (ltLower.includes("bhxh") || ltLower.includes("ốm") || ltLower.includes("hiếu") || ltLower.includes("hỷ") || ltLower.includes("thai sản")) {
        existing.socialOrPolicyDays += days;
        existing.totalAbsentDays += days;
      } else {
        existing.paidLeaveDays += days;
        existing.totalAbsentDays += days;
      }

      existing.periods.push({
        code: p.proposalCode,
        fromDate: fDate,
        toDate: tDate,
        days,
        type: rangeLabel ? `${leaveType} — các ngày: ${rangeLabel}` : leaveType,
        handover: handoverStaff,
        status: p.status
      });

      map.set(key, existing);
    });

    return Array.from(map.values()).sort((a, b) => b.totalAbsentDays - a.totalAbsentDays || a.staffName.localeCompare(b.staffName));
  }, [monthlyLeaveProposals]);

  const handleExportMonthlyLeaveCSV = () => {
    if (monthlyLeaveProposals.length === 0) {
      showToast("Chưa có dữ liệu đơn xin nghỉ phép trong kỳ lọc để xuất!", "warning");
      return;
    }
    const monthLabel = leaveMonthFilter === "all" ? "Tat-ca-cac-thang" : leaveMonthFilter;
    const lines: string[] = [];
    lines.push(`"BẢNG TỔNG HỢP CHẤM CÔNG NGHỈ PHÉP TOÀN CÔNG TY - KỲ: ${leaveMonthFilter === "all" ? "TẤT CẢ" : leaveMonthFilter}"`);
    lines.push("");
    lines.push(`"I. TỔNG HỢP SỐ NGÀY NGHỈ THEO NHÂN VIÊN (PHỤC VỤ KẾ TOÁN TÍNH LƯƠNG CUỐI THÁNG)"`);
    lines.push(
      [
        "STT",
        "Họ tên nhân viên",
        "Phòng ban",
        "Số đơn trong tháng",
        "Đơn đã duyệt",
        "Đơn chờ duyệt",
        "Nghỉ phép năm có lương (Ngày)",
        "Nghỉ việc riêng không lương (Ngày)",
        "Nghỉ ốm / BHXH / Chế độ (Ngày)",
        "Làm việc từ xa WFH (Ngày)",
        "Tổng ngày nghỉ vắng mặt",
        "Chi tiết các đợt nghỉ & Người nhận bàn giao"
      ]
        .map((h) => `"${h}"`)
        .join(",")
    );

    leaveSummaryByStaff.forEach((row, idx) => {
      const detailText = row.periods
        .map((pr) => `${formatDayVN(pr.fromDate)}->${formatDayVN(pr.toDate)} (${pr.days}d - ${pr.type} - Bàn giao: ${pr.handover})`)
        .join("; ");
      lines.push(
        [
          idx + 1,
          row.staffName,
          row.dept,
          row.totalRequests,
          row.approvedRequests,
          row.pendingRequests,
          row.paidLeaveDays,
          row.unpaidLeaveDays,
          row.socialOrPolicyDays,
          row.wfhDays,
          row.totalAbsentDays,
          detailText.replace(/"/g, '""')
        ]
          .map((v) => `"${v}"`)
          .join(",")
      );
    });

    lines.push("");
    lines.push(`"II. DANH SÁCH CHI TIẾT CÁC ĐƠN XIN NGHỈ PHÉP (DXNP)"`);
    lines.push(
      [
        "STT",
        "Mã đơn",
        "Họ tên nhân viên",
        "Phòng ban",
        "Loại hình nghỉ",
        "Nghỉ từ ngày",
        "Đến hết ngày",
        "Số ngày nghỉ",
        "Nhân sự nhận bàn giao",
        "Lý do xin nghỉ",
        "Trạng thái phê duyệt",
        "Người duyệt cuối",
        "Ngày lập đơn"
      ]
        .map((h) => `"${h}"`)
        .join(",")
    );

    monthlyLeaveProposals.forEach((p, idx) => {
      const ld = getLeaveDatesAndDays(p, leaveMonthArg());
      const { fDate, tDate, days, handoverStaff } = ld;
      const leaveType = ld.rangeLabel ? `${ld.leaveType} — các ngày: ${ld.rangeLabel}` : ld.leaveType;
      const stMeta = getStatusMeta(p.status);
      const canSeeLeaveReason = canUserSeeFullLeaveDetails(
        p,
        currentStaffName,
        userDept,
        isDirector,
        isManager,
        personnelList
      );
      const lastApprover =
        (p.steps || [])
          .filter((s) => s.status === "APPROVED")
          .slice(-1)[0]?.decidedBy || "—";
      lines.push(
        [
          idx + 1,
          p.proposalCode,
          p.requesterName,
          p.requesterDept,
          leaveType,
          formatDayVN(fDate),
          formatDayVN(tDate),
          days,
          handoverStaff,
          canSeeLeaveReason
            ? String(p.summaryReason || p.title || "").replace(/"/g, '""')
            : "(Lý do riêng tư — Chỉ hiển thị lịch nghỉ & người nhận bàn giao)",
          stMeta.label,
          lastApprover,
          p.createdAt
        ]
          .map((v) => `"${v}"`)
          .join(",")
      );
    });

    const csvContent = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Bang-Cham-Cong-Nghi-Phep-${monthLabel}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`📥 Đã xuất file Excel (CSV) Bảng chấm công nghỉ phép kỳ ${monthLabel}!`, "success");
  };

  const proposalsPage = usePaged(filteredProposals, 20);

  return (
    <div className="space-y-4">
      {/* 1. BẢNG CHỈ SỐ TỔNG QUAN (EXECUTIVE KPI BAR) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div
          onClick={() => setSubView("to_approve")}
          className={`p-4 rounded-2xl border cursor-pointer transition-all ${
            subView === "to_approve"
              ? "bg-amber-50 dark:bg-amber-950/50 border-amber-400 dark:border-amber-700 ring-2 ring-amber-400/30"
              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-amber-300"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">CẦN TÔI PHÊ DUYỆT NGAY</p>
              <p className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">{waitingForMeList.length}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {waitingForMeList.length > 0 ? "⚡ Bấm để xử lý duyệt ngay" : "Không có tờ trình tồn đọng"}
              </p>
            </div>
            <div className="w-11 h-11 rounded-2xl bg-amber-100 dark:bg-amber-950 flex items-center justify-center text-amber-600 dark:text-amber-400">
              <Clock className="w-5 h-5" />
            </div>
          </div>
        </div>

        <div
          onClick={() => setSubView("my_proposals")}
          className={`p-4 rounded-2xl border cursor-pointer transition-all ${
            subView === "my_proposals"
              ? "bg-indigo-50 dark:bg-indigo-950/50 border-indigo-400 dark:border-indigo-700 ring-2 ring-indigo-400/30"
              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-indigo-300"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">ĐỀ XUẤT CỦA TÔI</p>
              <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1">{myProposalsList.length}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {myProposalsList.filter((p) => p.status === "RETURNED").length > 0
                  ? `🔄 ${myProposalsList.filter((p) => p.status === "RETURNED").length} phiếu cần bổ sung giải trình`
                  : "Theo dõi tiến độ trình ký"}
              </p>
            </div>
            <div className="w-11 h-11 rounded-2xl bg-indigo-100 dark:bg-indigo-950 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <FileText className="w-5 h-5" />
            </div>
          </div>
        </div>

        <div
          onClick={() => {
            setSubView("all");
            setStatusFilter("PENDING");
          }}
          className="p-4 rounded-2xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-rose-300 cursor-pointer transition-all"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">GIÁ TRỊ ĐANG TRÌNH DUYỆT</p>
              <p className="text-xl font-black text-rose-600 dark:text-rose-400 mt-1">{formatMoneyVND(totalPendingAmount)}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {accessibleProposals.filter((p) => p.status === "PENDING").length} tờ trình đang trong luồng
              </p>
            </div>
            <div className="w-11 h-11 rounded-2xl bg-rose-100 dark:bg-rose-950 flex items-center justify-center text-rose-600 dark:text-rose-400">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
        </div>

        <div
          onClick={() => {
            setSubView("all");
            setStatusFilter("all");
          }}
          className="p-4 rounded-2xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-emerald-300 cursor-pointer transition-all"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">ĐÃ DUYỆT &amp; THỰC THI</p>
              <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
                {totalApprovedCount} <span className="text-xs font-bold text-slate-400">/ {accessibleProposals.length} phiếu</span>
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">Lưu trữ chứng từ điện tử &amp; chữ ký số</p>
            </div>
            <div className="w-11 h-11 rounded-2xl bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>

      {/* 2. THANH ĐIỀU HƯỚNG PHÂN KHU & BỘ LỌC ĐA CHIỀU (KHÔNG LẶP LẠI NÚT TRÊN CÙNG KHUNG HÌNH) */}
      <div className="bg-gradient-to-r from-indigo-50/85 via-slate-100/90 to-emerald-50/75 dark:from-slate-900 dark:via-indigo-950/35 dark:to-slate-900 border-2 border-indigo-200/85 dark:border-indigo-800/70 rounded-2xl p-3.5 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-200/70 dark:border-slate-800 pb-3">
          <div className="p-1 rounded-xl bg-slate-200/70 dark:bg-slate-800/90 border border-slate-300/70 dark:border-slate-700 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setSubView("all")}
              className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer shrink-0 border ${
                subView === "all"
                  ? "bg-indigo-600 text-white border-indigo-700 shadow-sm shadow-indigo-600/25 ring-2 ring-indigo-400/40"
                  : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 shadow-2xs"
              }`}
            >
              📚 Tất cả đề xuất ({accessibleProposals.length})
            </button>
            <button
              type="button"
              onClick={() => setSubView("to_approve")}
              className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer shrink-0 flex items-center gap-1.5 border ${
                subView === "to_approve"
                  ? "bg-amber-600 text-white border-amber-700 shadow-sm shadow-amber-600/25 ring-2 ring-amber-400/40"
                  : "bg-amber-50 dark:bg-amber-950/70 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-700 hover:bg-amber-100 shadow-2xs"
              }`}
            >
              <span>📥 Cần tôi duyệt</span>
              {waitingForMeList.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-rose-600 text-white">
                  {waitingForMeList.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setSubView("my_proposals")}
              className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer shrink-0 border ${
                subView === "my_proposals"
                  ? "bg-indigo-600 text-white border-indigo-700 shadow-sm shadow-indigo-600/25 ring-2 ring-indigo-400/40"
                  : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 shadow-2xs"
              }`}
            >
              📤 Đề xuất của tôi ({myProposalsList.length})
            </button>
            <button
              type="button"
              onClick={() => setSubView("following")}
              className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer shrink-0 border ${
                subView === "following"
                  ? "bg-indigo-600 text-white border-indigo-700 shadow-sm shadow-indigo-600/25 ring-2 ring-indigo-400/40"
                  : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 shadow-2xs"
              }`}
              title="Các đề xuất bạn được gắn làm Người theo dõi (chỉ xem, không duyệt) hoặc có liên quan"
            >
              👁️ Đang theo dõi &amp; Liên quan ({followingOrExecList.length})
            </button>
            <button
              type="button"
              onClick={() => setSubView("leave_tracker")}
              className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer shrink-0 flex items-center gap-1.5 border ${
                subView === "leave_tracker"
                  ? "bg-teal-600 text-white border-teal-700 shadow-sm shadow-teal-600/25 ring-2 ring-teal-400/40"
                  : "bg-teal-50 dark:bg-teal-950/70 text-teal-900 dark:text-teal-200 border-teal-300 dark:border-teal-700 hover:bg-teal-100 shadow-2xs"
              }`}
              title="Xem lịch nghỉ phép toàn công ty và bảng tổng hợp chấm công nghỉ phép tháng cho Kế toán"
            >
              <span>🏖️ Nghỉ phép &amp; Chấm công tháng ({monthlyLeaveProposals.length})</span>
              {todayLeaveProposals.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-rose-600 text-white">
                  {todayLeaveProposals.length} nghỉ hôm nay
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setSubView("templates")}
              className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer shrink-0 border ${
                subView === "templates"
                  ? "bg-purple-600 text-white border-purple-700 shadow-sm shadow-purple-600/25 ring-2 ring-purple-400/40"
                  : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-purple-50 hover:border-purple-300 hover:text-purple-700 shadow-2xs"
              }`}
            >
              📂 Danh mục Mẫu &amp; Luồng duyệt ({templates.length})
            </button>
          </div>

          {selectedIdsForBulk.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                Đã chọn {selectedIdsForBulk.length} phiếu chờ duyệt
              </span>
              <button
                type="button"
                onClick={handleBulkApprove}
                className="px-3 py-1.5 rounded-xl text-xs font-extrabold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer"
              >
                ⚡ Phê duyệt nhanh ({selectedIdsForBulk.length})
              </button>
              <button
                type="button"
                onClick={() => setSelectedIdsForBulk([])}
                className="px-2 py-1 text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                Bỏ chọn
              </button>
            </div>
          )}
        </div>

        {/* Bộ lọc chi tiết theo Nhóm nghiệp vụ, Trạng thái, Ưu tiên, Ngày */}
        {subView !== "templates" && subView !== "leave_tracker" && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as any)}
              className="text-xs px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-bold shadow-2xs"
            >
              <option value="all">📂 Tất cả nhóm đề xuất</option>
              <option value="FINANCE">💰 Tài chính - Thanh toán - Tạm ứng</option>
              <option value="HR_ADMIN">👥 Nhân sự - Nghỉ phép - Công tác</option>
              <option value="COMMERCIAL">💼 Kinh doanh - Chiết khấu - Công nợ</option>
              <option value="TECHNICAL_OPS">🔬 Kỹ thuật - Kho - Mẫu thử - Mua sắm</option>
              <option value="EXECUTIVE">🏛️ Tờ trình Ban Giám Đốc</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="text-xs px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-bold shadow-2xs"
            >
              <option value="all">🔖 Tất cả trạng thái</option>
              <option value="PENDING">⏳ Đang chờ phê duyệt</option>
              <option value="RETURNED">🔄 Yêu cầu bổ sung / Giải trình</option>
              <option value="APPROVED">✅ Đã phê duyệt</option>
              <option value="EXECUTED">🏁 Đã thực thi hoàn tất</option>
              <option value="REJECTED">❌ Đã từ chối</option>
              <option value="DRAFT">📝 Bản nháp</option>
            </select>

            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as any)}
              className="text-xs px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-bold shadow-2xs"
            >
              <option value="all">⚡ Mọi mức ưu tiên</option>
              <option value="URGENT">🚨 Khẩn cấp (Duyệt ngay)</option>
              <option value="HIGH">🔥 Ưu tiên cao</option>
              <option value="NORMAL">🟢 Bình thường</option>
            </select>

            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs shadow-2xs">
              <Calendar className="w-3.5 h-3.5 text-indigo-500" />
              <span className="text-[11px] text-slate-500 font-semibold">Từ:</span>
              <DateInputVN
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="text-xs font-bold bg-transparent text-slate-900 dark:text-white focus:outline-none w-[114px]"
              />
              <span className="text-slate-400">→</span>
              <DateInputVN
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="text-xs font-bold bg-transparent text-slate-900 dark:text-white focus:outline-none w-[114px]"
              />
              {(fromDate || toDate) && (
                <button
                  type="button"
                  onClick={() => {
                    setFromDate("");
                    setToDate("");
                  }}
                  className="text-[10px] font-bold text-rose-600 px-1.5 py-0.5 rounded bg-rose-50 cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 4A. DANH MỤC BIỂU MẪU ĐỀ XUẤT & MA TRẬN PHÂN QUYỀN DUYỆT (HIỂN THỊ DẠNG DANH MỤC GỌN GÀNG - CLICK ĐỂ XEM/SỬA) */}
      {subView === "templates" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3.5">
            <div>
              <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase flex items-center gap-2">
                <span>📂 DANH MỤC MẪU ĐỀ XUẤT &amp; MA TRẬN LUỒNG PHÊ DUYỆT ({templates.length} MẪU)</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Hiển thị theo danh mục chuẩn. <strong>Click trực tiếp vào bất kỳ dòng mẫu nào</strong> để xem đầy đủ cấu trúc trường dữ liệu, sơ đồ luồng duyệt hoặc chỉnh sửa; bấm <strong>&ldquo;+ Tạo Mẫu Đề Xuất Mới&rdquo;</strong> để thiết kế mẫu riêng.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => openNewTemplateModal(templateCategoryTab === "all" ? "FINANCE" : templateCategoryTab)}
                className="px-3.5 py-2 rounded-xl text-xs font-extrabold bg-purple-600 hover:bg-purple-700 text-white shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Tạo Mẫu Đề Xuất &amp; Luồng Duyệt Mới</span>
              </button>
            </div>
          </div>

          {/* Bộ lọc Nhóm Danh mục & Tìm kiếm Mẫu */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setTemplateCategoryTab("all")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-all ${
                  templateCategoryTab === "all"
                    ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                }`}
              >
                Tất cả danh mục ({templates.length})
              </button>
              {(["FINANCE", "HR_ADMIN", "COMMERCIAL", "TECHNICAL_OPS", "EXECUTIVE"] as ProposalCategoryKey[]).map((catKey) => {
                const meta = PROPOSAL_CATEGORY_META[catKey];
                const cnt = templates.filter((t) => t.category === catKey).length;
                return (
                  <button
                    key={catKey}
                    type="button"
                    onClick={() => setTemplateCategoryTab(catKey)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-all ${
                      templateCategoryTab === catKey
                        ? "bg-indigo-600 text-white shadow-2xs"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                    }`}
                  >
                    {meta.shortLabel} ({cnt})
                  </button>
                );
              })}
            </div>

            <div className="relative min-w-[220px]">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={templateSearch}
                onChange={(e) => setTemplateSearch(e.target.value)}
                placeholder="Tìm tên mẫu, mã viết tắt (DNTT, DXNP...)"
                className="w-full pl-8 pr-3 py-1.5 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
          </div>

          {/* BẢNG DANH MỤC MẪU ĐỀ XUẤT (COMPACT DIRECTORY TABLE) */}
          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/90 dark:bg-slate-800/90 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                  <th className="py-2.5 px-3 text-center w-12">STT</th>
                  <th className="py-2.5 px-3 text-left w-24">Mã mẫu</th>
                  <th className="py-2.5 px-3 text-left">Tên Biểu Mẫu Đề Xuất (Click để Xem đầy đủ / Sửa)</th>
                  <th className="py-2.5 px-3 text-left w-44">Nhóm Danh Mục</th>
                  <th className="py-2.5 px-3 text-left w-44">Cấu Trúc Biểu Mẫu</th>
                  <th className="py-2.5 px-3 text-left">Tóm Tắt Luồng Duyệt &amp; Hạn Mức</th>
                  <th className="py-2.5 px-3 text-right w-48">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800">
                {templates
                  .filter((tmpl) => {
                    if (templateCategoryTab !== "all" && tmpl.category !== templateCategoryTab) return false;
                    if (templateSearch.trim()) {
                      const q = templateSearch.toLowerCase().trim();
                      return (
                        tmpl.name.toLowerCase().includes(q) ||
                        tmpl.codePrefix.toLowerCase().includes(q) ||
                        tmpl.description.toLowerCase().includes(q)
                      );
                    }
                    return true;
                  })
                  .map((tmpl, index) => {
                    const catMeta = PROPOSAL_CATEGORY_META[tmpl.category] || PROPOSAL_CATEGORY_META.EXECUTIVE;
                    return (
                      <tr
                        key={tmpl.id}
                        onClick={() => openInspectOrEditTemplate(tmpl)}
                        className="bg-white dark:bg-slate-900 hover:bg-indigo-50/60 dark:hover:bg-slate-800/70 transition-colors cursor-pointer group"
                        title="Click để mở xem đầy đủ chi tiết & chỉnh sửa mẫu đề xuất này"
                      >
                        <td className="py-2.5 px-3 text-center font-bold text-slate-400">{index + 1}</td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-1 rounded-lg font-mono font-black text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800">
                            {tmpl.codePrefix}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <span className="text-base shrink-0">{tmpl.icon}</span>
                            <div>
                              <div className="font-extrabold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                                {tmpl.name}
                              </div>
                              <div className="text-[11px] text-slate-500 line-clamp-1">{tmpl.description}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-md border ${catMeta.badgeCls}`}>
                            {catMeta.shortLabel}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-[11px] text-slate-600 dark:text-slate-300">
                          <div>• <strong>{tmpl.fields.length}</strong> trường thông tin</div>
                          <div className="text-[10px] text-slate-400">
                            {tmpl.hasLineItems ? "✓ Có bảng kê chi tiết" : "Không bảng kê"} • {tmpl.hasAmount ? "Có số tiền" : "Phi tài chính"}
                          </div>
                          {(() => {
                            const vKey = resolveDefaultTemplateVisibility(tmpl);
                            const vMeta = PROPOSAL_VISIBILITY_META[vKey];
                            return (
                              <div className="mt-1">
                                <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded border ${vMeta.badgeCls}`}>
                                  {vMeta.shortLabel}
                                </span>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1 flex-wrap text-[11px]">
                            <span className="px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold border border-amber-200 dark:border-amber-800">
                              {tmpl.defaultSteps.length} cấp duyệt • SLA {tmpl.slaTotalHours}h
                            </span>
                            {tmpl.defaultSteps.some((s) => s.conditionMinAmount) && (
                              <span className="px-2 py-0.5 rounded bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold text-[10px]">
                                BGĐ ≥ {formatMoneyVND(tmpl.defaultSteps.find((s) => s.conditionMinAmount)?.conditionMinAmount)}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-xs">
                            {tmpl.defaultSteps.map((s, i) => `B${i + 1}: ${s.defaultApprover}`).join(" ➔ ")}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openInspectOrEditTemplate(tmpl)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-indigo-50 hover:text-indigo-600 border border-slate-200 dark:border-slate-700 cursor-pointer"
                            >
                              👁️ Chi tiết / Sửa
                            </button>
                            <button
                              type="button"
                              onClick={() => openCreateProposalModal(tmpl.id)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer"
                            >
                              + Lập phiếu
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

      {/* 4A-2. BẢNG THEO DÕI NGHỈ PHÉP TOÀN CÔNG TY & TỔNG HỢP CHẤM CÔNG THÁNG (CHO TOÀN CÔNG TY & KẾ TOÁN) */}
      {subView === "leave_tracker" && (
        <div className="space-y-4">
          {/* Thanh điều khiển chọn Tháng chấm công, Lọc Phòng ban, Loại nghỉ & Nút Xuất Excel */}
          <div className="bg-white dark:bg-slate-900 border border-teal-200 dark:border-teal-800/80 rounded-2xl p-4 shadow-2xs space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2.5 py-0.5 rounded-lg text-[11px] font-black bg-teal-600 text-white">
                    🏖️ LỊCH NGHỈ PHÉP &amp; CHẤM CÔNG THÁNG (DXNP)
                  </span>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase">
                    Theo dõi Nghỉ phép Toàn công ty &amp; Bảng Tổng hợp Chấm công Cuối tháng
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Toàn bộ nhân sự cùng nắm rõ lịch đồng nghiệp vắng mặt và <strong>người nhận bàn giao công việc thay thế</strong>; Phòng Kế toán - Hành chính tự động tổng hợp số ngày nghỉ có lương / không lương / BHXH và xuất Excel chấm công cuối tháng chỉ với 1 click.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleExportMonthlyLeaveCSV}
                  className="px-3.5 py-2 rounded-xl text-xs font-extrabold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs cursor-pointer flex items-center gap-1.5"
                  title="Tải xuống file Excel (CSV) Bảng tổng hợp chấm công nghỉ phép tháng cho Kế toán tính lương"
                >
                  <span>📥 Xuất Excel Chấm Công Tháng</span>
                </button>
                <button
                  type="button"
                  onClick={() => openCreateProposalModal("tmpl_leave_request")}
                  className="px-3.5 py-2 rounded-xl text-xs font-extrabold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>{isDirector ? "📢 + Thông Báo Nghỉ Phép (BGĐ)" : "🏖️ + Tạo Đơn Xin Nghỉ Phép (DXNP)"}</span>
                </button>
              </div>
            </div>

            {/* Bộ lọc Tháng / Phòng ban / Loại nghỉ / Trạng thái */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-teal-300 dark:border-teal-800 bg-teal-50/70 dark:bg-teal-950/40 text-xs">
                <Calendar className="w-3.5 h-3.5 text-teal-600" />
                <span className="font-bold text-teal-900 dark:text-teal-200">Kỳ chấm công:</span>
                <input
                  type="month"
                  value={leaveMonthFilter === "all" ? "" : leaveMonthFilter}
                  onChange={(e) => setLeaveMonthFilter(e.target.value || "all")}
                  className="bg-transparent font-extrabold text-teal-900 dark:text-teal-100 focus:outline-none cursor-pointer"
                />
                <button
                  type="button"
                  onClick={() => setLeaveMonthFilter(todayVN().slice(0, 7))}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-bold cursor-pointer ${
                    leaveMonthFilter === todayVN().slice(0, 7)
                      ? "bg-teal-600 text-white"
                      : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                  }`}
                >
                  Tháng này
                </button>
                <button
                  type="button"
                  onClick={() => setLeaveMonthFilter("all")}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-bold cursor-pointer ${
                    leaveMonthFilter === "all"
                      ? "bg-teal-600 text-white"
                      : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                  }`}
                >
                  Tất cả
                </button>
              </div>

              <select
                value={leaveDeptFilter}
                onChange={(e) => setLeaveDeptFilter(e.target.value)}
                className="text-xs px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 font-bold"
              >
                <option value="all">🏢 Tất cả phòng ban</option>
                {departments
                  .filter((d) => d.id !== "all")
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>

              <select
                value={leaveTypeFilter}
                onChange={(e) => setLeaveTypeFilter(e.target.value)}
                className="text-xs px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 font-bold"
              >
                <option value="all">🏖️ Mọi loại hình nghỉ</option>
                <option value="Nghỉ phép năm (Có hưởng lương)">Nghỉ phép năm (Có hưởng lương)</option>
                <option value="Nghỉ việc riêng (Không hưởng lương)">Nghỉ việc riêng (Không hưởng lương)</option>
                <option value="Nghỉ ốm / Khám chữa bệnh (BHXH)">Nghỉ ốm / Khám chữa bệnh (BHXH)</option>
                <option value="Nghỉ chế độ Kết hôn / Hiếu hỷ">Nghỉ chế độ Kết hôn / Hiếu hỷ</option>
                <option value="Nghỉ Thai sản">Nghỉ Thai sản</option>
                <option value="Làm việc từ xa (WFH)">Làm việc từ xa (WFH)</option>
              </select>

              <select
                value={leaveStatusFilter}
                onChange={(e) => setLeaveStatusFilter(e.target.value)}
                className="text-xs px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 font-bold"
              >
                <option value="all">🔖 Mọi trạng thái đơn</option>
                <option value="APPROVED_EXEC">✅ Đã phê duyệt</option>
                <option value="PENDING">⏳ Đang chờ phê duyệt</option>
                <option value="RETURNED">🔄 Yêu cầu bổ sung</option>
                <option value="REJECTED">❌ Đã từ chối</option>
              </select>
            </div>

            {/* 4 Thẻ thống kê nhanh trong tháng */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
              <div className="p-3 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20">
                <div className="text-[11px] font-extrabold text-rose-700 dark:text-rose-300 uppercase">
                  🏖️ Nghỉ hôm nay ({formatDayVN(todayIsoStr)})
                </div>
                <div className="text-xl font-black text-rose-600 dark:text-rose-400 mt-1">
                  {todayLeaveProposals.length} <span className="text-xs font-bold">nhân sự</span>
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 truncate">
                  {todayLeaveProposals.length > 0
                    ? todayLeaveProposals.map((p) => `${p.requesterName} (Thay: ${p.formValues?.handoverStaff || "—"})`).join(", ")
                    : "100% quân số làm việc bình thường"}
                </div>
              </div>

              <div className="p-3 rounded-xl border border-teal-200 dark:border-teal-900/60 bg-teal-50/50 dark:bg-teal-950/20">
                <div className="text-[11px] font-extrabold text-teal-800 dark:text-teal-300 uppercase">
                  📋 Tổng đơn xin nghỉ trong kỳ
                </div>
                <div className="text-xl font-black text-teal-700 dark:text-teal-300 mt-1">
                  {monthlyLeaveProposals.length} <span className="text-xs font-bold">đơn ({leaveSummaryByStaff.length} người)</span>
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                  ✅ {monthlyLeaveProposals.filter((p) => p.status === "APPROVED" || p.status === "EXECUTED").length} đã duyệt • ⏳{" "}
                  {monthlyLeaveProposals.filter((p) => p.status === "PENDING").length} chờ duyệt
                </div>
              </div>

              <div className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20">
                <div className="text-[11px] font-extrabold text-emerald-800 dark:text-emerald-300 uppercase">
                  💰 Tổng ngày nghỉ phép có lương
                </div>
                <div className="text-xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
                  {leaveSummaryByStaff.reduce((s, r) => s + r.paidLeaveDays, 0)}{" "}
                  <span className="text-xs font-bold">ngày công phép năm</span>
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                  Cộng thêm {leaveSummaryByStaff.reduce((s, r) => s + r.socialOrPolicyDays, 0)} ngày BHXH / Hiếu hỷ
                </div>
              </div>

              <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20">
                <div className="text-[11px] font-extrabold text-amber-800 dark:text-amber-300 uppercase">
                  📉 Nghỉ không lương &amp; Làm từ xa (WFH)
                </div>
                <div className="text-xl font-black text-amber-600 dark:text-amber-400 mt-1">
                  {leaveSummaryByStaff.reduce((s, r) => s + r.unpaidLeaveDays, 0)}{" "}
                  <span className="text-xs font-bold">ngày không lương</span>
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                  🏠 Làm việc từ xa (WFH): {leaveSummaryByStaff.reduce((s, r) => s + r.wfhDays, 0)} ngày
                </div>
              </div>
            </div>
          </div>

          {leaveProposalsMissingDates.length > 0 && (
            <div className="rounded-2xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-4 space-y-2">
              <div className="text-xs sm:text-sm font-black text-amber-900 dark:text-amber-200">
                ⚠ {leaveProposalsMissingDates.length} đơn nghỉ được hệ thống "phục hồi từ thông báo" — THIẾU NGÀY NGHỈ THẬT, chưa tính vào chấm công
              </div>
              <p className="text-[11px] text-amber-800 dark:text-amber-300">
                Các đơn này được dựng lại tự động khi đơn gốc không còn trong danh sách; ngày nghỉ trước đây bị gán nhầm bằng ngày dựng lại.
                Người xin nghỉ vui lòng lập lại đơn đúng ngày nghỉ, người duyệt từ chối / thu hồi đơn phục hồi tương ứng.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {leaveProposalsMissingDates.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedProposal(p)}
                    className="px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 text-[11px] font-bold text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/50 cursor-pointer"
                    title={String(p.summaryReason || "")}
                  >
                    {p.proposalCode} · {p.requesterName}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* BẢNG 1: BẢNG TỔNG HỢP CHẤM CÔNG NGHỈ PHÉP CUỐI THÁNG THEO NHÂN VIÊN (DÀNH CHO KẾ TOÁN) */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-xs sm:text-sm font-black text-slate-900 dark:text-white uppercase flex items-center gap-2">
                  <span>📊 I. BẢNG TỔNG HỢP CHẤM CÔNG NGHỈ PHÉP THEO NHÂN VIÊN ({leaveSummaryByStaff.length} NHÂN SỰ)</span>
                </h4>
                <p className="text-[11px] text-slate-500">
                  Tự động cộng dồn số ngày nghỉ theo từng phân loại trong kỳ <strong>{leaveMonthFilter === "all" ? "Tất cả các tháng" : leaveMonthFilter}</strong> để Kế toán đối chiếu chấm công cuối tháng.
                </p>
              </div>
            </div>

            {leaveSummaryByStaff.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 dark:bg-slate-950/50 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
                Chưa có nhân viên nào đăng ký nghỉ phép trong kỳ <strong>{leaveMonthFilter}</strong>.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                      <th className="py-2.5 px-3 text-center w-10">STT</th>
                      <th className="py-2.5 px-3 text-left">Họ tên nhân viên</th>
                      <th className="py-2.5 px-3 text-left">Phòng ban</th>
                      <th className="py-2.5 px-3 text-center">Số đơn</th>
                      <th className="py-2.5 px-3 text-center text-emerald-700 dark:text-emerald-300">Phép năm (Có lương)</th>
                      <th className="py-2.5 px-3 text-center text-rose-700 dark:text-rose-300">Nghỉ không lương</th>
                      <th className="py-2.5 px-3 text-center text-purple-700 dark:text-purple-300">Ốm / BHXH / Chế độ</th>
                      <th className="py-2.5 px-3 text-center text-sky-700 dark:text-sky-300">WFH (Từ xa)</th>
                      <th className="py-2.5 px-3 text-center font-black">Tổng ngày nghỉ</th>
                      <th className="py-2.5 px-3 text-left">Chi tiết các đợt nghỉ &amp; Người nhận bàn giao</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800">
                    {leaveSummaryByStaff.map((row, idx) => (
                      <tr key={row.staffName} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="py-2.5 px-3 text-center font-bold text-slate-400">{idx + 1}</td>
                        <td className="py-2.5 px-3 font-extrabold text-slate-900 dark:text-white">{row.staffName}</td>
                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{row.dept}</td>
                        <td className="py-2.5 px-3 text-center">
                          <span className="font-bold">{row.totalRequests}</span>{" "}
                          <span className="text-[10px] text-slate-400">
                            ({row.approvedRequests} duyệt{row.pendingRequests > 0 ? `, ${row.pendingRequests} chờ` : ""})
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center font-extrabold text-emerald-600 dark:text-emerald-400">
                          {row.paidLeaveDays > 0 ? `${row.paidLeaveDays} ngày` : "—"}
                        </td>
                        <td className="py-2.5 px-3 text-center font-extrabold text-rose-600 dark:text-rose-400">
                          {row.unpaidLeaveDays > 0 ? `${row.unpaidLeaveDays} ngày` : "—"}
                        </td>
                        <td className="py-2.5 px-3 text-center font-extrabold text-purple-600 dark:text-purple-400">
                          {row.socialOrPolicyDays > 0 ? `${row.socialOrPolicyDays} ngày` : "—"}
                        </td>
                        <td className="py-2.5 px-3 text-center font-extrabold text-sky-600 dark:text-sky-400">
                          {row.wfhDays > 0 ? `${row.wfhDays} ngày` : "—"}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className="px-2 py-0.5 rounded-lg font-black bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-200">
                            {row.totalAbsentDays} ngày
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex flex-wrap gap-1">
                            {row.periods.map((pr) => (
                              <span
                                key={pr.code}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                              >
                                <strong className="font-mono text-indigo-600 dark:text-indigo-400">{pr.code}:</strong>
                                <span>
                                  {formatDayVN(pr.fromDate)} → {formatDayVN(pr.toDate)} ({pr.days} ngày)
                                </span>
                                <span className="text-teal-700 dark:text-teal-300 font-semibold">• Thay: {pr.handover}</span>
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* BẢNG 2: DANH SÁCH CHI TIẾT CÁC ĐƠN XIN NGHỈ PHÉP TRONG THÁNG (TOÀN CÔNG TY XEM & TRƯỞNG BỘ PHẬN DUYỆT) */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs sm:text-sm font-black text-slate-900 dark:text-white uppercase">
                📋 II. DANH SÁCH CHI TIẾT ĐƠN XIN NGHỈ PHÉP &amp; NGƯỜI NHẬN BÀN GIAO ({monthlyLeaveProposals.length} ĐƠN)
              </h4>

              {isDirector && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setHideStaffLeaveForDirector((prev) => !prev)}
                    className={`px-3 py-1.5 rounded-xl text-[11px] font-extrabold border cursor-pointer transition-all ${
                      hideStaffLeaveForDirector
                        ? "bg-amber-600 text-white border-amber-600 shadow-2xs"
                        : "bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-700 hover:bg-amber-100"
                    }`}
                    title="Nhân viên thường xin nghỉ phép do Trưởng phòng & HCNS duyệt. Bật chế độ này để ẩn đơn nghỉ phép của nhân viên thường khỏi màn hình BGĐ (chỉ hiện cấp Trưởng/Phó phòng trực thuộc BGĐ)."
                  >
                    {hideStaffLeaveForDirector
                      ? "🏛️ Đang ẩn đơn nghỉ phép NV thường (Chỉ hiện Trưởng/Phó phòng & BGĐ) • Bấm để xem tất cả"
                      : "🏛️ Ẩn đơn nghỉ phép NV thường khỏi màn hình BGĐ (Chỉ xem cấp Trưởng phòng)"}
                  </button>
                </div>
              )}
            </div>

            {monthlyLeaveProposals.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Không có đơn xin nghỉ phép nào khớp bộ lọc. Bấm <strong>&ldquo;🏖️ + Tạo Đơn Xin Nghỉ Phép (DXNP)&rdquo;</strong> để đăng ký nghỉ phép mới.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                      <th className="py-2.5 px-3 text-left">Mã đơn</th>
                      <th className="py-2.5 px-3 text-left">Nhân sự xin nghỉ</th>
                      <th className="py-2.5 px-3 text-left">Loại hình nghỉ</th>
                      <th className="py-2.5 px-3 text-left">Thời gian nghỉ (Từ → Đến)</th>
                      <th className="py-2.5 px-3 text-center">Số ngày</th>
                      <th className="py-2.5 px-3 text-left">Nhân sự nhận bàn giao</th>
                      <th className="py-2.5 px-3 text-left">Lý do / Ghi chú</th>
                      <th className="py-2.5 px-3 text-left">Trạng thái duyệt</th>
                      <th className="py-2.5 px-3 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800">
                    {monthlyLeaveProposals.map((p) => {
                      const { fDate, tDate, days, leaveType, handoverStaff, rangeLabel, isOffOn } = getLeaveDatesAndDays(p, leaveMonthArg());
                      const statusMeta = getStatusMeta(p.status);
                      const waitingMe = isProposalWaitingForUser(p, currentStaffName, userDept, isDirector, isManager);
                      const isOffToday = isOffOn(todayIsoStr) && p.status !== "REJECTED";
                      return (
                        <tr key={p.id} className="hover:bg-teal-50/40 dark:hover:bg-slate-800/60 transition-colors">
                          <td className="py-2.5 px-3">
                            <span
                              onClick={() => setSelectedProposal(p)}
                              className="px-2 py-0.5 rounded font-mono font-black text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950 cursor-pointer hover:underline"
                            >
                              {p.proposalCode}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-extrabold text-slate-900 dark:text-white">{p.requesterName}</div>
                            <div className="text-[10px] text-slate-500">{p.requesterDept}</div>
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-200">{leaveType}</td>
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-slate-900 dark:text-white">
                              {formatDayVN(fDate)} → {formatDayVN(tDate)}
                            </div>
                            {rangeLabel && (
                              <div className="text-[10px] text-indigo-700 dark:text-indigo-300 font-semibold max-w-[260px]" title={rangeLabel}>
                                📅 Các ngày nghỉ{leaveMonthArg() ? " trong tháng" : ""}: {rangeLabel}
                              </div>
                            )}
                            {isOffToday && (
                              <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded text-[10px] font-black bg-rose-600 text-white">
                                🏖️ Đang nghỉ hôm nay
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span className="px-2 py-0.5 rounded-lg font-black bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200">
                              {days} ngày
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-1 rounded-lg font-bold bg-teal-50 dark:bg-teal-950/70 text-teal-800 dark:text-teal-200 border border-teal-200 dark:border-teal-800">
                              🤝 {handoverStaff}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 max-w-xs">
                            {canUserSeeFullLeaveDetails(p, currentStaffName, userDept, isDirector, isManager, personnelList) ? (
                              <div className="line-clamp-2 text-slate-600 dark:text-slate-300">{p.summaryReason || p.title}</div>
                            ) : (
                              <div className="text-[11px] italic text-slate-400 dark:text-slate-500">
                                🔒 Lý do riêng tư (Chỉ hiển thị lịch nghỉ &amp; người bàn giao)
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            {String(p.proposalCode || "").toUpperCase().startsWith("TBNP") ||
                            isSameWorkspaceDept(p.requesterDept, "Ban Giám Đốc") ? (
                              <span className="inline-block px-2 py-0.5 rounded-lg text-[10px] font-extrabold border bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/80 dark:text-purple-200 dark:border-purple-700">
                                📢 Thông báo nghỉ (BGĐ)
                              </span>
                            ) : (
                              <span className={`inline-block px-2 py-0.5 rounded-lg text-[10px] font-extrabold border ${statusMeta.badgeCls}`}>
                                {statusMeta.label}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              {waitingMe && (
                                <button
                                  type="button"
                                  onClick={() => handleDecision(p, "APPROVE", "Đồng ý phê duyệt lịch nghỉ phép")}
                                  className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-[11px] cursor-pointer"
                                >
                                  ✓ Duyệt
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setSelectedProposal(p)}
                                className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 font-bold text-[11px] cursor-pointer"
                              >
                                Chi tiết
                              </button>
                              <button
                                type="button"
                                onClick={() => handlePrintProposal(p)}
                                className="p-1 rounded-lg text-slate-500 hover:text-indigo-600 cursor-pointer"
                                title="In đơn xin nghỉ phép"
                              >
                                <Printer className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4B. DANH SÁCH TỜ TRÌNH & ĐỀ XUẤT */}
      {subView !== "templates" && subView !== "leave_tracker" && (
        <div className="space-y-3">
          {filteredProposals.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-10 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto">
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  {subView === "to_approve"
                    ? "Tuyệt vời! Hiện không có tờ trình nào đang chờ bạn phê duyệt."
                    : "Chưa có tờ trình / đề xuất nào trong danh mục này."}
                </h4>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Bấm nút <strong>&ldquo;📝 Lập Đề Xuất / Tờ Trình&rdquo;</strong> ở góc trên bên phải hoặc mở tab <strong>&ldquo;📂 Danh mục Mẫu &amp; Luồng duyệt&rdquo;</strong> để khởi tạo và trình ký điện tử.
                </p>
              </div>
            </div>
          ) : (
            <>
              {proposalsPage.items.map((p) => {
              const catMeta = PROPOSAL_CATEGORY_META[p.category] || PROPOSAL_CATEGORY_META.EXECUTIVE;
              const statusMeta = getStatusMeta(p.status);
              const effVis = getEffectiveProposalVisibility(p, templateByIdMap.get(p.templateId));
              const visMeta = PROPOSAL_VISIBILITY_META[effVis] || PROPOSAL_VISIBILITY_META.PRIVATE;
              const canSeeFullLeave =
                !isLeaveProposal(p) ||
                canUserSeeFullLeaveDetails(p, currentStaffName, userDept, isDirector, isManager, personnelList);
              const waitingMe = isProposalWaitingForUser(p, currentStaffName, userDept, isDirector, isManager);
              const activeStep = (p.steps || []).find((s) => s.status === "PENDING_NOW") || p.steps?.[p.currentStepIndex];
              const isOverdue =
                p.status === "PENDING" && p.neededByDate && String(p.neededByDate).slice(0, 10) < todayVN();
              const isChecked = selectedIdsForBulk.includes(p.id);

              return (
                <div
                  key={p.id}
                  className={`bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs hover:shadow-md transition-all overflow-hidden ${catMeta.borderCls} ${
                    waitingMe ? "ring-2 ring-amber-400/50 dark:ring-amber-500/40" : ""
                  }`}
                >
                  <div className={`px-4 py-3 bg-gradient-to-r ${catMeta.headerBg} border-b border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2`}>
                    <div className="flex flex-wrap items-center gap-2">
                      {waitingMe && (
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedIdsForBulk((prev) => [...prev, p.id]);
                            } else {
                              setSelectedIdsForBulk((prev) => prev.filter((id) => id !== p.id));
                            }
                          }}
                          className="w-4 h-4 rounded accent-emerald-600 cursor-pointer"
                          title="Chọn để phê duyệt nhanh hàng loạt"
                        />
                      )}
                      <span className="px-2.5 py-0.5 rounded-lg text-xs font-black font-mono bg-slate-900 text-white dark:bg-white dark:text-slate-900">
                        {p.proposalCode}
                      </span>
                      <span className={`px-2.5 py-0.5 rounded-lg text-[11px] font-bold border ${catMeta.badgeCls}`}>
                        {catMeta.shortLabel} • {p.templateName}
                      </span>
                      <span className={`px-2.5 py-0.5 rounded-lg text-[11px] font-extrabold border ${statusMeta.badgeCls}`}>
                        {statusMeta.label}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${visMeta.badgeCls}`}
                        title={visMeta.desc}
                      >
                        {visMeta.shortLabel}
                      </span>
                      {p.priority === "URGENT" && (
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-rose-600 text-white animate-pulse">
                          🚨 KHẨN CẤP
                        </span>
                      )}
                      {isOverdue && (
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-extrabold bg-red-100 text-red-700 border border-red-300">
                          ⚠️ Quá hạn cần duyệt ({formatDayVN(p.neededByDate)})
                        </span>
                      )}
                      {waitingMe && (
                        <span className="px-2.5 py-0.5 rounded-lg text-[11px] font-black bg-amber-500 text-white shadow-2xs">
                          🔔 Đang chờ bạn duyệt!
                        </span>
                      )}
                      {!waitingMe && (p.followers || []).some((f) => isSamePerson(f, currentStaffName)) && (
                        <span className="px-2.5 py-0.5 rounded-lg text-[11px] font-extrabold bg-sky-100 text-sky-800 border border-sky-300 dark:bg-sky-950/80 dark:text-sky-300 dark:border-sky-700">
                          👁️ Đang theo dõi (Chỉ xem, không duyệt)
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {p.totalAmount > 0 && (
                        <span className="px-3 py-1 rounded-xl bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-black text-xs">
                          💰 {formatMoneyVND(p.totalAmount)}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handlePrintProposal(p)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        title="In phiếu đề xuất / Xuất PDF chuẩn A4"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Body */}
                  <div className="p-4 space-y-3">
                    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <h3
                          onClick={() => setSelectedProposal(p)}
                          className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer"
                        >
                          {p.title}
                        </h3>
                        {canSeeFullLeave ? (
                          <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 whitespace-pre-line">
                            {p.summaryReason}
                          </p>
                        ) : (
                          <p className="text-xs italic text-slate-500 dark:text-slate-400">
                            🏖️ Lịch nghỉ: <strong>{formatDayVN(p.formValues?.fromDate || p.neededByDate)} → {formatDayVN(p.formValues?.toDate || p.neededByDate)}</strong> ({p.formValues?.totalDays || "1"} ngày) • 🤝 Người nhận bàn giao: <strong className="text-teal-700 dark:text-teal-300">{p.formValues?.handoverStaff || "—"}</strong> • <span className="text-slate-400">🔒 Lý do cá nhân đã được ẩn bảo mật</span>
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 pt-1">
                          <span>
                            👤 Người trình: <strong className="text-slate-800 dark:text-slate-200">{p.requesterName}</strong> ({p.requesterDept})
                          </span>
                          <span>📅 Ngày lập: {p.createdAt}</span>
                          <span>⏰ Hạn cần duyệt: <strong className="text-slate-700 dark:text-slate-200">{formatDayVN(p.neededByDate)}</strong></span>
                          {p.customerName && (
                            <span>🏥 Khách hàng: <strong className="text-indigo-600 dark:text-indigo-400">{p.customerName}</strong></span>
                          )}
                          {p.supplierName && (
                            <span>🏭 Nhà cung cấp: <strong className="text-emerald-600 dark:text-emerald-400">{p.supplierName}</strong></span>
                          )}
                          {p.linkedRefCode && (
                            <span>🔗 Mã tham chiếu: <strong className="font-mono">{p.linkedRefCode}</strong></span>
                          )}
                          {p.attachments?.length > 0 && (
                            <span className="text-indigo-600 dark:text-indigo-400 font-bold">
                              📎 {p.attachments.length} chứng từ đính kèm
                            </span>
                          )}
                          {Array.isArray(p.followers) && p.followers.length > 0 && (
                            <span className="text-sky-700 dark:text-sky-300 font-semibold">
                              👁️ Người theo dõi ({p.followers.length}): <strong>{p.followers.join(", ")}</strong>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Quick Action Buttons on Card */}
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {waitingMe && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleDecision(p, "APPROVE", "Đồng ý phê duyệt")}
                              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs flex items-center gap-1 shadow-xs cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Duyệt ngay</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setSelectedProposal(p)}
                              className="px-2.5 py-1.5 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 dark:bg-amber-950/80 dark:text-amber-200 font-bold text-xs cursor-pointer"
                            >
                              🔄 Yêu cầu bổ sung / Từ chối
                            </button>
                          </>
                        )}

                        {p.status === "RETURNED" && isSamePerson(p.requesterName, currentStaffName) && (
                          <button
                            type="button"
                            onClick={() => openEditProposalModal(p)}
                            className="px-3 py-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs cursor-pointer"
                          >
                            ✏️ Bổ sung &amp; Gửi duyệt lại
                          </button>
                        )}

                        {p.status === "APPROVED" && (
                          <>
                            {isBusinessTripProposal(p) && onViewWeeklyScheduleFromProposal && (
                              <button
                                type="button"
                                onClick={() => onViewWeeklyScheduleFromProposal(p)}
                                className="px-2.5 py-1.5 rounded-xl bg-teal-50 dark:bg-teal-950/70 text-teal-700 dark:text-teal-300 border border-teal-300 dark:border-teal-700 font-extrabold text-xs hover:bg-teal-100 cursor-pointer flex items-center gap-1"
                                title="Đề xuất đi công tác này đã được tự động đồng bộ vào Lịch Công Tác Tuần — Bấm để mở xem trên Lịch tuần"
                              >
                                <Calendar className="w-3.5 h-3.5" />
                                <span>✈️ Xem trên Lịch Công Tác Tuần</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onCreateTaskFromProposal(p)}
                              className="px-2.5 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-bold text-xs hover:bg-indigo-100 cursor-pointer"
                            >
                              📌 Giao việc thực thi
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          onClick={() => setSelectedProposal(p)}
                          className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Chi tiết &amp; Luồng ký</span>
                        </button>
                      </div>
                    </div>

                    {/* Visual Multi-step Approval Stepper */}
                    <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800/80">
                      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                        {(p.steps || []).map((st, idx) => {
                          const isDone = st.status === "APPROVED";
                          const isNow = st.status === "PENDING_NOW" && p.status === "PENDING";
                          const isReturned = st.status === "RETURNED";
                          const isRejected = st.status === "REJECTED";
                          return (
                            <React.Fragment key={idx}>
                              <div
                                onClick={() => setSelectedProposal(p)}
                                className={`px-3 py-1.5 rounded-xl border text-xs flex items-center gap-2 shrink-0 cursor-pointer transition-all ${
                                  isDone
                                    ? "bg-emerald-50/90 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200"
                                    : isNow
                                    ? "bg-amber-50 dark:bg-amber-950/50 border-amber-400 dark:border-amber-700 text-amber-950 dark:text-amber-100 ring-1 ring-amber-400/40 font-bold"
                                    : isReturned
                                    ? "bg-orange-50 dark:bg-orange-950/50 border-orange-400 text-orange-900 dark:text-orange-200"
                                    : isRejected
                                    ? "bg-rose-50 dark:bg-rose-950/50 border-rose-400 text-rose-900 dark:text-rose-200"
                                    : "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500"
                                }`}
                              >
                                <span
                                  className={`w-5 h-5 rounded-full text-[10px] font-black flex items-center justify-center shrink-0 ${
                                    isDone
                                      ? "bg-emerald-600 text-white"
                                      : isNow
                                      ? "bg-amber-500 text-white"
                                      : isReturned
                                      ? "bg-orange-500 text-white"
                                      : isRejected
                                      ? "bg-rose-600 text-white"
                                      : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                                  }`}
                                >
                                  {isDone ? "✓" : isRejected ? "✕" : isReturned ? "↺" : idx + 1}
                                </span>
                                <div>
                                  <div className="text-[11px] font-bold leading-tight">{st.stepName}</div>
                                  <div className="text-[10px] opacity-80">
                                    {st.decidedBy || st.approverName} ({st.dept})
                                    {st.decidedAt ? ` • ${st.decidedAt.slice(0, 16)}` : isNow ? " • Đang chờ duyệt" : ""}
                                  </div>
                                </div>
                              </div>
                              {idx < (p.steps || []).length - 1 && (
                                <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0" />
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
              })}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 px-4">
                <Pager p={proposalsPage} unit="tờ trình / đề xuất" />
              </div>
            </>
          )}
        </div>
      )}

      {/* ==================== MODAL 1: TẠO / CẬP NHẬT TỜ TRÌNH & ĐỀ XUẤT (HOẶC THÔNG BÁO NGHỈ PHÉP BGĐ) ==================== */}
      {(() => {
        const isLeaveTmplModal = activeTemplate.id === "tmpl_leave_request" || activeTemplate.codePrefix === "DXNP";
        const modalProxyName = String(formState.formValues?.onBehalfOfName || currentStaffName).trim();
        const modalProxyDept = String(
          formState.formValues?.onBehalfOfDept ||
            (isDirector && isSamePerson(modalProxyName, currentStaffName) ? "Ban Giám Đốc" : userDept)
        ).trim();
        const isExecLeaveModal =
          isLeaveTmplModal &&
          (isSameWorkspaceDept(modalProxyDept, "Ban Giám Đốc") ||
            (isDirector && isSamePerson(modalProxyName, currentStaffName)) ||
            /giám đốc|pgđ|bgđ|chủ tịch/i.test(
              String(
                (personnelList || []).find((p: any) => isSamePerson(p.full_name || p.name, modalProxyName))?.position || ""
              )
            ));

        return (
          <Modal
            isOpen={isFormModalOpen}
            onClose={() => setIsFormModalOpen(false)}
            title={
              isExecLeaveModal
                ? `📢 THÔNG BÁO NGHỈ PHÉP / LỊCH VẮNG MẶT (BAN GIÁM ĐỐC — KHÔNG QUA PHÊ DUYỆT)`
                : editingProposalId
                ? `✏️ Cập nhật & Trình lại Đề xuất [${formState.proposalCode}]`
                : `📝 Lập Tờ Trình & Đề Xuất Phê Duyệt Mới`
            }
            size="4xl"
          >
            <div className="space-y-4 max-h-[78vh] overflow-y-auto pr-1">
              {/* Bước 1: Chọn Biểu mẫu Đề xuất chuẩn (Ẩn khi BGĐ thông báo nghỉ phép trực tiếp) */}
              {!isExecLeaveModal && (
                <div className="p-3.5 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/80 space-y-2">
                  <label className="block text-xs font-extrabold uppercase tracking-wider text-indigo-900 dark:text-indigo-200">
                    1. Chọn Loại Biểu Mẫu Tờ Trình / Đề Xuất Chuẩn:
                  </label>
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => handleSelectTemplateInModal(e.target.value)}
                    disabled={Boolean(editingProposalId)}
                    className="w-full px-3 py-2 rounded-xl text-xs font-bold bg-white dark:bg-slate-900 border border-indigo-300 dark:border-indigo-700 text-slate-900 dark:text-white"
                  >
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.icon} [{PROPOSAL_CATEGORY_META[t.category]?.shortLabel}] {t.name} ({t.codePrefix})
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400">
                    💡 {activeTemplate.description}
                  </p>
                </div>
              )}

              {/* Bước 2: Thông tin định danh & Mức độ khẩn cấp */}
              <div className={`grid grid-cols-1 ${isExecLeaveModal ? "sm:grid-cols-2" : "sm:grid-cols-4"} gap-3`}>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {isExecLeaveModal ? "Mã Thông báo nghỉ phép (TBNP)" : "Số hiệu phiếu"}
                  </label>
                  <input
                    type="text"
                    value={formState.proposalCode}
                    onChange={(e) => setFormState((prev) => ({ ...prev, proposalCode: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Mức độ ưu tiên
                  </label>
                  <select
                    value={formState.priority}
                    onChange={(e) => setFormState((prev) => ({ ...prev, priority: e.target.value as any }))}
                    className="w-full px-3 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                  >
                    <option value="NORMAL">🟢 Bình thường</option>
                    <option value="HIGH">🔥 Ưu tiên cao</option>
                    <option value="URGENT">{isExecLeaveModal ? "🚨 Quan trọng / Đột xuất" : "🚨 Khẩn cấp (Cần duyệt ngay)"}</option>
                  </select>
                </div>

                {!isExecLeaveModal && (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Hạn cần phê duyệt xong
                    </label>
                    <DateInputVN
                      value={formState.neededByDate}
                      onChange={(e) => setFormState((prev) => ({ ...prev, neededByDate: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                    />
                  </div>
                )}

                {activeTemplate.hasAmount && !isExecLeaveModal && (
                  <div>
                    <label className="block text-[11px] font-bold text-rose-700 dark:text-rose-300 mb-1">
                      Tổng giá trị / Số tiền (VNĐ)
                    </label>
                    <input
                      type="number"
                      value={formState.totalAmount || ""}
                      onChange={(e) => {
                        const amt = Number(e.target.value) || 0;
                        const reqDept = defaultConcreteDeptForScope(selectedDept, userDept);
                        setFormState((prev) => ({
                          ...prev,
                          totalAmount: amt,
                          steps: editingProposalId ? prev.steps : buildStepsFromTemplate(activeTemplate, reqDept, amt)
                        }));
                      }}
                      placeholder="0"
                      className="w-full px-3 py-2 rounded-xl text-xs font-black border border-rose-300 dark:border-rose-700 bg-rose-50/50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300"
                    />
                  </div>
                )}
              </div>

              {/* Tùy chọn Phạm vi Hiển thị */}
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    {isExecLeaveModal
                      ? "📢 Phạm vi nhận Thông báo nghỉ phép của Ban Giám Đốc:"
                      : "🔐 Chế độ Hiển thị & Bảo mật của Đề xuất (Ai được phép nhìn thấy tờ trình này?):"}
                  </label>
                  <span className="text-[11px] text-slate-500">
                    Đang chọn:{" "}
                    <strong className="text-indigo-600 dark:text-indigo-400">
                      {PROPOSAL_VISIBILITY_META[formState.visibility || resolveDefaultTemplateVisibility(activeTemplate)]?.shortLabel}
                    </strong>
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {(["PRIVATE", "DEPT", "PUBLIC"] as ProposalVisibility[]).map((visKey) => {
                    const meta = PROPOSAL_VISIBILITY_META[visKey];
                    const isSelected = (formState.visibility || "PRIVATE") === visKey;
                    return (
                      <button
                        key={visKey}
                        type="button"
                        onClick={() => setFormState((prev) => ({ ...prev, visibility: visKey }))}
                        className={`text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
                          isSelected
                            ? "bg-indigo-50/90 dark:bg-indigo-950/60 border-indigo-500 ring-2 ring-indigo-500/25"
                            : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-indigo-300"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-extrabold text-slate-900 dark:text-white">{meta.shortLabel}</span>
                          {isSelected && (
                            <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-indigo-600 text-white">
                              Đang chọn
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">{meta.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tiêu đề & Liên kết Khách hàng / NCC / Mã đơn */}
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {isExecLeaveModal ? "Tiêu đề Thông báo nghỉ phép / lịch vắng mặt" : "Tiêu đề Tờ trình / Đề xuất"}{" "}
                    <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formState.title}
                    onChange={(e) => setFormState((prev) => ({ ...prev, title: e.target.value }))}
                    placeholder={
                      isExecLeaveModal
                        ? `VD: Thông báo nghỉ phép — ${modalProxyName}...`
                        : `VD: ${activeTemplate.name} — Phục vụ dự án / khách hàng...`
                    }
                    className="w-full px-3 py-2 rounded-xl text-xs font-bold border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                  />
                </div>

                {!isLeaveTmplModal && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                        Khách hàng / Bệnh viện liên quan (Nếu có)
                      </label>
                      <input
                        type="text"
                        list="proposal-customers-datalist"
                        value={formState.customerName}
                        onChange={(e) => setFormState((prev) => ({ ...prev, customerName: e.target.value }))}
                        placeholder="Chọn hoặc nhập tên KH / Bệnh viện..."
                        className="w-full px-3 py-1.5 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                      />
                      <datalist id="proposal-customers-datalist">
                        {(customerList || []).slice(0, 80).map((c: any, idx: number) => (
                          <option key={idx} value={c.name || c.customer_name || c} />
                        ))}
                      </datalist>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                        Nhà cung cấp / Đối tác (Nếu có)
                      </label>
                      <input
                        type="text"
                        list="proposal-suppliers-datalist"
                        value={formState.supplierName}
                        onChange={(e) => setFormState((prev) => ({ ...prev, supplierName: e.target.value }))}
                        placeholder="Chọn hoặc nhập tên Nhà cung cấp..."
                        className="w-full px-3 py-1.5 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                      />
                      <datalist id="proposal-suppliers-datalist">
                        {(supplierList || []).slice(0, 80).map((s: any, idx: number) => (
                          <option key={idx} value={s.name || s.supplier_name || s} />
                        ))}
                      </datalist>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                        Mã tham chiếu (Số SO / PO / Báo giá / HĐ)
                      </label>
                      <input
                        type="text"
                        value={formState.linkedRefCode}
                        onChange={(e) => setFormState((prev) => ({ ...prev, linkedRefCode: e.target.value }))}
                        placeholder="VD: SO-2026-015 / PO-2026-008"
                        className="w-full px-3 py-1.5 rounded-xl text-xs font-mono border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                )}
              </div>

          {/* Các trường thông tin nghiệp vụ chuyên biệt theo từng Mẫu đề xuất */}
          {activeTemplate.fields.length > 0 && (
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="text-xs font-extrabold text-slate-800 dark:text-slate-200 uppercase">
                2. Thông tin nghiệp vụ chi tiết ({activeTemplate.name}):
              </div>
              {activeTemplate.id === "tmpl_leave_request" && (() => {
                const canRecordForOthers =
                  isDirector ||
                  isManager ||
                  isSameWorkspaceDept(userDept, "Hành Chính Nhân Sự");
                const currentProxyName = String(formState.formValues?.onBehalfOfName || currentStaffName).trim();
                const currentProxyDept = String(
                  formState.formValues?.onBehalfOfDept ||
                    (isDirector && isSamePerson(currentProxyName, currentStaffName) ? "Ban Giám Đốc" : userDept)
                ).trim();
                const isExecPerson =
                  isSameWorkspaceDept(currentProxyDept, "Ban Giám Đốc") ||
                  (isDirector && isSamePerson(currentProxyName, currentStaffName)) ||
                  /giám đốc|pgđ|bgđ|chủ tịch/i.test(
                    String(
                      (personnelList || []).find((p: any) => isSamePerson(p.full_name || p.name, currentProxyName))?.position || ""
                    )
                  );
                return (
                  <div className="p-3 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 space-y-2 text-xs">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <div className="font-extrabold text-amber-950 dark:text-amber-200">
                          {isExecPerson
                            ? "🏛️ Chế độ Ban Giám Đốc: Lịch Vắng Mặt & Ủy Quyền Điều Hành (Không cần xin nghỉ phép)"
                            : "👤 Người đăng ký nghỉ phép (HCNS hoặc Quản lý có thể ghi nhận hộ)"}
                        </div>
                        <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-0.5">
                          {isExecPerson
                            ? "Ban Giám Đốc KHÔNG phải lập đơn xin nghỉ phép chờ duyệt và mặc định KHÔNG phát thông báo nghỉ phép ra toàn công ty (chế độ Riêng tư PRIVATE). Phiếu có hiệu lực ngay (APPROVED) để ghi nhận người nhận ủy quyền/bàn giao. Nếu BGĐ hoàn toàn không lập phiếu này, thành viên BGĐ khác vẫn có thể duyệt thay trực tiếp trên mọi tờ trình."
                            : "Nếu lãnh đạo / nhân sự báo vắng mặt qua điện thoại hoặc tin nhắn mà không trực tiếp vào phần mềm, Hành chính – Nhân sự (HCNS) có thể chọn tên bên dưới để ghi nhận hộ lịch nghỉ & người nhận bàn giao."}
                        </p>
                      </div>

                      {canRecordForOthers && (
                        <div className="shrink-0 min-w-[230px]">
                          <label className="block text-[10px] font-extrabold text-amber-900 dark:text-amber-200 mb-0.5">
                            ✍️ Ghi nhận cho nhân sự / lãnh đạo:
                          </label>
                          <select
                            value={currentProxyName}
                            onChange={(e) => {
                              const pickedName = e.target.value;
                              const foundStaff = (personnelList || []).find((p: any) =>
                                isSamePerson(p.full_name || p.name, pickedName)
                              );
                              const pickedDept =
                                foundStaff?.department ||
                                (isSamePerson(pickedName, currentStaffName) && isDirector ? "Ban Giám Đốc" : userDept);
                              const pickedIsExec =
                                isSameWorkspaceDept(pickedDept, "Ban Giám Đốc") ||
                                /giám đốc|pgđ|bgđ|chủ tịch/i.test(String(foundStaff?.position || ""));
                              setFormState((prev) => ({
                                ...prev,
                                title: pickedIsExec
                                  ? `Lịch vắng mặt & Ủy quyền điều hành — ${pickedName} (${formatDayVN(todayVN())})`
                                  : `Xin nghỉ phép — ${pickedName} (${formatDayVN(todayVN())})`,
                                visibility: pickedIsExec ? "PRIVATE" : prev.visibility,
                                sendChatNotify: pickedIsExec ? false : prev.sendChatNotify,
                                sendBellNotify: pickedIsExec ? false : prev.sendBellNotify,
                                formValues: {
                                  ...prev.formValues,
                                  onBehalfOfName: pickedName,
                                  onBehalfOfDept: pickedDept,
                                  leaveType: pickedIsExec
                                    ? "Lịch công tác / Vắng mặt & Ủy quyền điều hành (BGĐ)"
                                    : prev.formValues.leaveType || "Nghỉ phép năm (Có hưởng lương)"
                                }
                              }));
                            }}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-amber-400 dark:border-amber-700 bg-white dark:bg-slate-900 font-bold text-xs text-slate-900 dark:text-white cursor-pointer"
                          >
                            <option value={currentStaffName}>
                              {currentStaffName} ({isDirector ? "Ban Giám Đốc" : userDept}) — Bản thân
                            </option>
                            {(personnelList || [])
                              .filter((p: any) => {
                                const n = cleanStaffDisplayName(p?.full_name || p?.name || "");
                                return n && !isSamePerson(n, currentStaffName);
                              })
                              .map((p: any) => {
                                const n = cleanStaffDisplayName(p?.full_name || p?.name || "");
                                const d = p?.department || "";
                                return (
                                  <option key={p?.id || p?.employee_code || n} value={n}>
                                    {n} {d ? `(${d})` : ""}
                                  </option>
                                );
                              })}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
              {activeTemplate.id === "tmpl_leave_request" && renderLeaveDatesEditor()}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {activeTemplate.fields
                  .filter((f) => !(isDatesMode(formState.formValues) && (f.key === "fromDate" || f.key === "toDate" || f.key === "totalDays")))
                  .map((field) => (
                  <div key={field.key} className={field.type === "textarea" || field.type === "file" ? "sm:col-span-2" : ""}>
                    {field.type === "file" ? (
                      <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                        <AttachmentPicker
                          files={Array.isArray(formState.formValues[field.key]) ? formState.formValues[field.key] : []}
                          onChange={(files) =>
                            setFormState((prev) => ({
                              ...prev,
                              formValues: { ...prev.formValues, [field.key]: files }
                            }))
                          }
                          label={`${field.label}${field.required ? " *" : ""}`}
                          hint={field.placeholder || "Hỗ trợ tải lên PDF, Word, Excel, Ảnh chụp chứng từ..."}
                        />
                      </div>
                    ) : (
                      <>
                        <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                          {field.label} {field.required && <span className="text-rose-500">*</span>}
                        </label>
                        {field.type === "select" ? (
                          <select
                            value={formState.formValues[field.key] || ""}
                            onChange={(e) =>
                              setFormState((prev) => ({
                                ...prev,
                                formValues: { ...prev.formValues, [field.key]: e.target.value }
                              }))
                            }
                            className="w-full px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                          >
                            <option value="">-- Chọn {field.label} --</option>
                            {(field.options || []).map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        ) : field.type === "date" ? (
                          <div className="space-y-1">
                            <DateInputVN
                              value={formState.formValues[field.key] || todayVN()}
                              onChange={(e) => {
                                const newVal = e.target.value;
                                setFormState((prev) => {
                                  const nextFV = { ...prev.formValues, [field.key]: newVal };
                                  if (field.key === "fromDate" || field.key === "toDate") {
                                    const fd = field.key === "fromDate" ? newVal : nextFV.fromDate;
                                    const td = field.key === "toDate" ? newVal : nextFV.toDate;
                                    if (fd && td && td >= fd) {
                                      const diff = Math.round((new Date(td).getTime() - new Date(fd).getTime()) / 86400000) + 1;
                                      nextFV.totalDays = String(Math.max(1, diff));
                                    } else if (field.key === "fromDate" && (!td || td < newVal)) {
                                      nextFV.toDate = newVal;
                                      nextFV.totalDays = "1";
                                    }
                                  }
                                  return { ...prev, formValues: nextFV };
                                });
                              }}
                              className="w-full px-3 py-1.5 rounded-xl text-xs font-semibold border border-teal-300 dark:border-teal-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                            />
                            <div className="flex items-center gap-1 flex-wrap">
                              {[
                                { label: "Hôm nay", offset: 0 },
                                { label: "Ngày mai", offset: 1 },
                                { label: "+2 ngày", offset: 2 },
                                { label: "+3 ngày", offset: 3 }
                              ].map((q) => {
                                const d = new Date();
                                d.setDate(d.getDate() + q.offset);
                                const iso = d.toISOString().slice(0, 10);
                                const isSelected = (formState.formValues[field.key] || todayVN()) === iso;
                                return (
                                  <button
                                    key={q.label}
                                    type="button"
                                    onClick={() => {
                                      setFormState((prev) => {
                                        const nextFV = { ...prev.formValues, [field.key]: iso };
                                        if (field.key === "fromDate" || field.key === "toDate") {
                                          const fd = field.key === "fromDate" ? iso : nextFV.fromDate;
                                          const td = field.key === "toDate" ? iso : nextFV.toDate;
                                          if (fd && td && td >= fd) {
                                            const diff = Math.round((new Date(td).getTime() - new Date(fd).getTime()) / 86400000) + 1;
                                            nextFV.totalDays = String(Math.max(1, diff));
                                          } else if (field.key === "fromDate" && (!td || td < iso)) {
                                            nextFV.toDate = iso;
                                            nextFV.totalDays = "1";
                                          }
                                        }
                                        return { ...prev, formValues: nextFV };
                                      });
                                    }}
                                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-colors cursor-pointer ${
                                      isSelected
                                        ? "bg-teal-600 text-white"
                                        : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-teal-50 dark:hover:bg-teal-950/50"
                                    }`}
                                  >
                                    📅 {q.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : field.type === "textarea" ? (
                          <textarea
                            rows={2}
                            value={formState.formValues[field.key] || ""}
                            onChange={(e) =>
                              setFormState((prev) => ({
                                ...prev,
                                formValues: { ...prev.formValues, [field.key]: e.target.value }
                              }))
                            }
                            placeholder={field.placeholder || ""}
                            className="w-full px-3 py-1.5 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                          />
                        ) : (
                          <input
                            type={field.type === "number" ? "number" : "text"}
                            step={field.type === "number" ? "any" : undefined}
                            list={field.key === "handoverStaff" ? "proposal-approvers-datalist" : undefined}
                            value={formState.formValues[field.key] || ""}
                            onChange={(e) =>
                              setFormState((prev) => ({
                                ...prev,
                                formValues: { ...prev.formValues, [field.key]: e.target.value }
                              }))
                            }
                            placeholder={field.placeholder || ""}
                            className="w-full px-3 py-1.5 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                          />
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bảng kê chi tiết hạng mục / chi phí / sản phẩm (Line Items) */}
          {activeTemplate.hasLineItems && (
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-slate-800 dark:text-slate-200 uppercase">
                  📋 Bảng kê chi tiết hạng mục / Mặt hàng / Kinh phí:
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setFormState((prev) => ({
                      ...prev,
                      lineItems: [
                        ...prev.lineItems,
                        { id: `li-${Date.now()}-${prev.lineItems.length}`, itemName: "", specification: "", quantity: 1, unitPrice: 0, amount: 0 }
                      ]
                    }))
                  }
                  className="px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-[11px] font-bold hover:bg-indigo-700 cursor-pointer"
                >
                  + Thêm dòng
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                      <th className="p-2 text-left rounded-tl-lg">{activeTemplate.lineItemColumns?.col1 || "Nội dung / Hạng mục"}</th>
                      <th className="p-2 text-left w-36">{activeTemplate.lineItemColumns?.col2 || "ĐVT / Quy cách"}</th>
                      <th className="p-2 text-center w-20">{activeTemplate.lineItemColumns?.col3 || "SL"}</th>
                      <th className="p-2 text-right w-32">{activeTemplate.lineItemColumns?.col4 || "Đơn giá"}</th>
                      <th className="p-2 text-right w-32">Thành tiền</th>
                      <th className="p-2 w-8 rounded-tr-lg"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {formState.lineItems.map((row, idx) => (
                      <tr key={row.id || idx} className="bg-white dark:bg-slate-900">
                        <td className="p-1.5">
                          <input
                            type="text"
                            list="proposal-products-datalist"
                            value={row.itemName}
                            onChange={(e) => handleLineItemChange(idx, "itemName", e.target.value)}
                            placeholder="Nhập nội dung hoặc chọn sản phẩm..."
                            className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-transparent"
                          />
                        </td>
                        <td className="p-1.5">
                          <input
                            type="text"
                            value={row.specification}
                            onChange={(e) => handleLineItemChange(idx, "specification", e.target.value)}
                            placeholder="ĐVT / Số HĐ..."
                            className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-transparent"
                          />
                        </td>
                        <td className="p-1.5">
                          <input
                            type="number"
                            value={row.quantity}
                            onChange={(e) => handleLineItemChange(idx, "quantity", Number(e.target.value))}
                            className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-transparent text-center font-bold"
                          />
                        </td>
                        <td className="p-1.5">
                          <input
                            type="number"
                            value={row.unitPrice || ""}
                            onChange={(e) => handleLineItemChange(idx, "unitPrice", Number(e.target.value))}
                            placeholder="0"
                            className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-transparent text-right"
                          />
                        </td>
                        <td className="p-1.5 text-right font-extrabold text-rose-600 dark:text-rose-400">
                          {formatMoneyVND(row.amount)}
                        </td>
                        <td className="p-1.5 text-center">
                          {formState.lineItems.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                const nextRows = formState.lineItems.filter((_, i) => i !== idx);
                                const sum = nextRows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
                                setFormState((prev) => ({ ...prev, lineItems: nextRows, totalAmount: sum }));
                              }}
                              className="text-slate-400 hover:text-rose-600 cursor-pointer"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <datalist id="proposal-products-datalist">
                  {(productList || []).slice(0, 100).map((prod: any, i: number) => (
                    <option key={i} value={`${prod.code ? `[${prod.code}] ` : ""}${prod.name || ""}`} />
                  ))}
                </datalist>
              </div>
            </div>
          )}

          {/* Nội dung giải trình & Lý do đề xuất */}
          <div>
            <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
              {isExecLeaveModal
                ? "Nội dung thông báo nghỉ phép & Bàn giao / Ủy quyền công việc"
                : "Nội dung giải trình chi tiết & Căn cứ đề xuất"}{" "}
              <span className="text-rose-500">*</span>
            </label>
            <textarea
              rows={3}
              value={formState.summaryReason}
              onChange={(e) => setFormState((prev) => ({ ...prev, summaryReason: e.target.value }))}
              placeholder={
                isExecLeaveModal
                  ? "Nhập nội dung thông báo nghỉ phép / vắng mặt và hướng dẫn liên hệ người nhận bàn giao công việc..."
                  : "Trình bày rõ lý do, mục đích, tính cấp thiết và hiệu quả dự kiến để các cấp lãnh đạo đủ cơ sở phê duyệt..."
              }
              className="w-full px-3 py-2 rounded-xl text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
            />
          </div>

          {/* Bước 3: Luồng phê duyệt đa cấp (ẨN HOÀN TOÀN khi Ban Giám Đốc thông báo nghỉ phép vì không có ai duyệt) */}
          {!isExecLeaveModal && (
            <div className="p-3.5 rounded-2xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/80 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-amber-900 dark:text-amber-200 uppercase">
                  3. Luồng Phê Duyệt Đa Cấp ({formState.steps.length} bước):
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setFormState((prev) => ({
                      ...prev,
                      steps: [
                        ...prev.steps,
                        {
                          stepOrder: prev.steps.length + 1,
                          stepName: `Bước duyệt ${prev.steps.length + 1}`,
                          roleType: "DIRECTOR",
                          dept: "Ban Giám Đốc",
                          approverName: getSupervisingBodForDept(
                            defaultConcreteDeptForScope(selectedDept, userDept),
                            personnelList
                          ).approverName,
                          status: "WAITING",
                          slaHours: 8
                        }
                      ]
                    }))
                  }
                  className="px-2.5 py-1 rounded-lg bg-amber-600 text-white text-[11px] font-bold hover:bg-amber-700 cursor-pointer"
                >
                  + Thêm cấp duyệt
                </button>
              </div>

              <div className="space-y-2">
                {formState.steps.map((st, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-white dark:bg-slate-900 p-2 rounded-xl border border-amber-200/80 dark:border-slate-800 text-xs"
                  >
                    <div className="sm:col-span-1 font-black text-amber-700 dark:text-amber-400 text-center">
                      Bước {idx + 1}
                    </div>
                    <div className="sm:col-span-4">
                      <input
                        type="text"
                        value={st.stepName}
                        onChange={(e) => {
                          const copy = [...formState.steps];
                          copy[idx] = { ...copy[idx], stepName: e.target.value };
                          setFormState((prev) => ({ ...prev, steps: copy }));
                        }}
                        className="w-full px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 font-bold bg-transparent"
                        placeholder="Tên bước duyệt..."
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <select
                        value={st.dept}
                        onChange={(e) => {
                          const nextDept = e.target.value;
                          const copy = [...formState.steps];
                          copy[idx] = {
                            ...copy[idx],
                            dept: nextDept,
                            roleType: inferProposalStepRoleType(
                              nextDept,
                              copy[idx].approverName,
                              copy[idx].stepName,
                              copy[idx].roleType
                            )
                          };
                          setFormState((prev) => ({ ...prev, steps: copy }));
                        }}
                        className="w-full px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      >
                        {st.dept &&
                          !departments.some((d) => d.id !== "all" && d.id === st.dept) && (
                            <option value={st.dept}>{st.dept}</option>
                          )}
                        {departments
                          .filter((d) => d.id !== "all")
                          .map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="sm:col-span-3">
                      <input
                        type="text"
                        list="proposal-approvers-datalist"
                        value={st.approverName}
                        onChange={(e) => {
                          const copy = [...formState.steps];
                          copy[idx] = { ...copy[idx], approverName: e.target.value };
                          setFormState((prev) => ({ ...prev, steps: copy }));
                        }}
                        placeholder="Người phê duyệt..."
                        className="w-full px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 font-bold text-indigo-700 dark:text-indigo-300 bg-transparent"
                      />
                    </div>
                    <div className="sm:col-span-1 text-right">
                      {formState.steps.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setFormState((prev) => ({
                              ...prev,
                              steps: prev.steps.filter((_, i) => i !== idx)
                            }))
                          }
                          className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <datalist id="proposal-approvers-datalist">
                  {allStaffNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </div>
            </div>
          )}

          {/* Bước 4: Người nhận thông báo / theo dõi */}
          <div className="p-3.5 rounded-2xl bg-sky-50/70 dark:bg-sky-950/25 border border-sky-200 dark:border-sky-800/80 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-xs font-extrabold text-sky-900 dark:text-sky-200 uppercase flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-sky-600" />
                  <span>
                    {isExecLeaveModal
                      ? `Người Nhận Thông Báo Trực Tiếp (CC thêm cho Trưởng phòng / HCNS) (${formState.followers.length} người):`
                      : `4. Người Theo Dõi Đề Xuất — Chỉ Theo Dõi, Không Phê Duyệt (${formState.followers.length} người):`}
                  </span>
                </span>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {isExecLeaveModal
                    ? "Chọn thêm các Trưởng bộ phận, Hành chính – Nhân sự hoặc cá nhân liên quan để gửi trực tiếp thông báo nghỉ phép & người nhận bàn giao."
                    : "Người theo dõi được xem nội dung, nhận thông báo khi tờ trình qua từng bước và tham gia thảo luận, nhưng không nằm trong luồng ký duyệt và không có nút Phê duyệt."}
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                <select
                  value=""
                  onChange={(e) => {
                    const picked = cleanStaffDisplayName(e.target.value);
                    if (!picked) return;
                    setFormState((prev) => {
                      if (prev.followers.some((f) => isSamePerson(f, picked))) return prev;
                      return { ...prev, followers: [...prev.followers, picked] };
                    });
                  }}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold border border-sky-300 dark:border-sky-700 bg-white dark:bg-slate-900 text-sky-800 dark:text-sky-200 cursor-pointer"
                >
                  <option value="">+ Chọn thêm Người nhận thông báo...</option>
                  {allStaffNames
                    .filter((n) => !formState.followers.some((f) => isSamePerson(f, n)))
                    .map((n) => (
                      <option key={n} value={n}>
                        👁️ {n}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {formState.followers.length === 0 ? (
              <div className="text-[11px] text-slate-500 italic bg-white/70 dark:bg-slate-900/60 px-3 py-2 rounded-xl border border-dashed border-sky-200 dark:border-sky-800/60">
                Chưa chọn người theo dõi. Chọn nhân sự từ ô bên trên nếu cần gửi thông tin phối hợp (CC) cho đồng nghiệp / quản lý liên quan.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {formState.followers.map((fName) => (
                  <span
                    key={fName}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white dark:bg-slate-900 border border-sky-300 dark:border-sky-700 text-xs font-bold text-sky-800 dark:text-sky-200 shadow-2xs"
                  >
                    <Eye className="w-3 h-3 text-sky-600 shrink-0" />
                    <span>{fName}</span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300">
                      Nhận thông báo
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setFormState((prev) => ({
                          ...prev,
                          followers: prev.followers.filter((x) => !isSamePerson(x, fName))
                        }))
                      }
                      className="text-slate-400 hover:text-rose-600 font-bold ml-0.5 cursor-pointer"
                      title="Bỏ người theo dõi này"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Tệp đính kèm (Hóa đơn, Báo giá, Hợp đồng, Biên bản) */}
          {!isExecLeaveModal && (
            <div className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
              <AttachmentPicker
                files={formState.attachments}
                onChange={(files) => setFormState((prev) => ({ ...prev, attachments: files }))}
                label="Chứng từ, Báo giá, Hóa đơn hoặc Văn bản đính kèm"
                hint="Hỗ trợ đính kèm PDF, Word, Excel, Ảnh chụp hóa đơn/biên bản..."
              />
            </div>
          )}

          {/* Tùy chọn gửi thông báo */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-4 text-xs">
              <label className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formState.sendBellNotify}
                  onChange={(e) => setFormState((prev) => ({ ...prev, sendBellNotify: e.target.checked }))}
                  className="rounded accent-indigo-600"
                />
                <span>{isExecLeaveModal ? "🔔 Báo Chuông cho người nhận bàn giao & người liên quan" : "🔔 Báo Chuông cho người duyệt"}</span>
              </label>
              <label className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formState.sendChatNotify}
                  onChange={(e) => setFormState((prev) => ({ ...prev, sendChatNotify: e.target.checked }))}
                  className="rounded accent-indigo-600"
                />
                <span>💬 Bắn tin nhắn Chat nội bộ</span>
              </label>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsFormModalOpen(false)}
                className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Đóng
              </button>
              {!isExecLeaveModal && (
                <button
                  type="button"
                  onClick={() => handleSaveProposal("DRAFT")}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-300 cursor-pointer"
                >
                  📝 Lưu bản nháp
                </button>
              )}
              <button
                type="button"
                onClick={() => handleSaveProposal("PENDING")}
                className={`px-4 py-2 rounded-xl text-xs font-extrabold text-white shadow-sm cursor-pointer flex items-center gap-1.5 ${
                  isExecLeaveModal ? "bg-teal-600 hover:bg-teal-700" : "bg-indigo-600 hover:bg-indigo-700"
                }`}
              >
                <Send className="w-3.5 h-3.5" />
                <span>
                  {isExecLeaveModal
                    ? "📢 Phát Thông Báo Nghỉ Phép Ngay (Không Qua Duyệt)"
                    : editingProposalId
                    ? "🚀 Gửi Duyệt Lại"
                    : "🚀 Trình Ký & Phê Duyệt Ngay"}
                </span>
              </button>
            </div>
          </div>
        </div>
      </Modal>
        );
      })()}

      {/* ==================== MODAL 2: CHI TIẾT TỜ TRÌNH & XỬ LÝ PHÊ DUYỆT ĐA CẤP ==================== */}
      <Modal
        isOpen={Boolean(selectedProposal)}
        onClose={() => {
          setSelectedProposal(null);
          setDecisionNote("");
          setShowDelegateBox(false);
        }}
        title={
          selectedProposal
            ? `📋 [${selectedProposal.proposalCode}] ${selectedProposal.templateName}`
            : "Chi tiết Đề xuất"
        }
        size="4xl"
      >
        {selectedProposal && (() => {
          const p = selectedProposal;
          const tmpl = templates.find((t) => t.id === p.templateId);
          const statusMeta = getStatusMeta(p.status);
          const effVis = getEffectiveProposalVisibility(p, tmpl);
          const visMeta = PROPOSAL_VISIBILITY_META[effVis] || PROPOSAL_VISIBILITY_META.PRIVATE;
          const canSeeFullLeave =
            !isLeaveProposal(p) ||
            canUserSeeFullLeaveDetails(p, currentStaffName, userDept, isDirector, isManager, personnelList);
          const waitingMe = isProposalWaitingForUser(p, currentStaffName, userDept, isDirector, isManager);
          const isRequester = isSamePerson(p.requesterName, currentStaffName);
          // Chỉ đúng người có trách nhiệm duyệt ở bước đang chờ hiện tại (PENDING_NOW) mới hiển thị Bảng Quyết Định Phê Duyệt.
          // Các thành viên BGĐ đã duyệt xong bước trước hoặc Người theo dõi (Followers) chỉ ở chế độ Xem & Theo dõi ở bước của phòng ban khác.
          const canApproverAct = waitingMe;
          const isCurrentUserFollower = (p.followers || []).some((f) => isSamePerson(f, currentStaffName));
          const hasCurrentUserApprovedEarlierStep = (p.steps || []).some(
            (s) => s.status === "APPROVED" && isSamePerson(s.decidedBy || s.approverName, currentStaffName)
          );

          return (
            <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-1">
              {/* Header Info Banner */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-lg text-xs font-black font-mono bg-slate-900 text-white dark:bg-white dark:text-slate-900">
                      {p.proposalCode}
                    </span>
                    <span className={`px-2.5 py-0.5 rounded-lg text-xs font-extrabold border ${statusMeta.badgeCls}`}>
                      {statusMeta.label}
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-lg text-[11px] font-bold border ${visMeta.badgeCls}`}
                      title={visMeta.desc}
                    >
                      {visMeta.shortLabel}
                    </span>
                    {p.priority === "URGENT" && (
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-rose-600 text-white">
                        🚨 KHẨN CẤP
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handlePrintProposal(p)}
                      className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 hover:border-indigo-400 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5 text-indigo-600" />
                      <span>In Phiếu A4 / Xuất PDF</span>
                    </button>
                    {(isRequester || isDirector) && (p.status === "DRAFT" || p.status === "RETURNED" || p.status === "PENDING") && (
                      <button
                        type="button"
                        onClick={() => openEditProposalModal(p)}
                        className="px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-xs font-bold hover:bg-indigo-100 cursor-pointer"
                      >
                        ✏️ Chỉnh sửa / Bổ sung
                      </button>
                    )}
                    {(isRequester || isDirector) && (
                      <button
                        type="button"
                        onClick={() => handleDeleteProposal(p)}
                        className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                        title="Xóa đề xuất"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">{p.title}</h2>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-200/80 dark:border-slate-800 text-xs">
                  <div>
                    <span className="text-slate-500">Người đề xuất:</span>{" "}
                    <strong className="text-slate-900 dark:text-white">{p.requesterName}</strong> ({p.requesterDept})
                  </div>
                  <div>
                    <span className="text-slate-500">Ngày trình:</span>{" "}
                    <strong className="text-slate-900 dark:text-white">{formatVNDateTime(p.createdAt, p.createdAt)}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Hạn cần duyệt:</span>{" "}
                    <strong className="text-indigo-600 dark:text-indigo-400">{formatDayVN(p.neededByDate)}</strong>
                  </div>
                  {p.totalAmount > 0 && (
                    <div className="sm:col-span-3 pt-1">
                      <span className="text-slate-500">Tổng giá trị / Số tiền đề xuất:</span>{" "}
                      <span className="text-base font-black text-rose-600 dark:text-rose-400 ml-1">
                        {formatMoneyVND(p.totalAmount)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Khung Nội dung Giải trình & Các trường nghiệp vụ */}
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
                <div>
                  <div className="font-extrabold text-slate-700 dark:text-slate-300 uppercase mb-1">
                    📌 Nội dung giải trình &amp; Lý do đề xuất:
                  </div>
                  {canSeeFullLeave ? (
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200/70 dark:border-slate-800 whitespace-pre-line text-slate-800 dark:text-slate-200 leading-relaxed">
                      {p.summaryReason}
                    </div>
                  ) : (
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-dashed border-slate-300 dark:border-slate-800 text-slate-500 italic">
                      🔒 Lý do xin nghỉ riêng tư và tài liệu cá nhân chỉ hiển thị cho Người xin nghỉ, Trưởng bộ phận phê duyệt, Hành chính - Nhân sự và Ban Giám Đốc. Đồng nghiệp các phòng ban xem được lịch ngày nghỉ và người nhận bàn giao bên dưới để chủ động phối hợp công việc.
                    </div>
                  )}
                </div>

                {(() => {
                  const ld = parseLeaveDays(p.formValues || {});
                  if (!ld) return null;
                  return (
                    <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-xs">
                      <div className="text-[10px] font-bold text-indigo-500 uppercase">Các ngày nghỉ cụ thể ({ld.length} ngày · tổng {sumLeaveDays(ld)} ngày công)</div>
                      <div className="font-semibold text-slate-900 dark:text-white mt-0.5">{formatLeaveDays(ld, 200)}</div>
                    </div>
                  );
                })()}
                {/* Các trường thông tin động */}
                {tmpl && tmpl.fields.some((f) => {
                  const v = p.formValues?.[f.key];
                  return Array.isArray(v) ? v.length > 0 : Boolean(v);
                }) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                    {tmpl.fields.map((f) => {
                      const val = p.formValues?.[f.key];
                      if (!val || (Array.isArray(val) && val.length === 0)) return null;
                      const isFileList = f.type === "file" || Array.isArray(val);
                      return (
                        <div key={f.key} className={`p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200/60 dark:border-slate-800 ${isFileList ? "sm:col-span-2" : ""}`}>
                          <div className="text-[10px] font-bold text-slate-400 uppercase">{f.label}</div>
                          {isFileList && Array.isArray(val) ? (
                            <div className="flex flex-wrap gap-2 mt-1.5">
                              {val.map((att: Attachment, i: number) => (
                                <div
                                  key={i}
                                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-indigo-50/70 dark:bg-slate-800 border border-indigo-200 dark:border-slate-700"
                                >
                                  <Paperclip className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                                  <span className="font-bold text-slate-800 dark:text-slate-200 truncate max-w-[220px]">
                                    {att.name}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => onPreviewAttachment(att)}
                                    className="px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[10px] font-bold hover:bg-indigo-700 cursor-pointer"
                                  >
                                    👁️ Xem trực tiếp
                                  </button>
                                  <a
                                    href={att.url}
                                    download={att.name}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-slate-500 hover:text-indigo-600"
                                    title="Tải xuống"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </a>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="font-bold text-slate-900 dark:text-white mt-0.5">
                              {f.type === "date" ? formatDayVN(val) : String(val)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Bảng kê chi tiết hạng mục */}
                {Array.isArray(p.lineItems) && p.lineItems.length > 0 && (
                  <div className="pt-2">
                    <div className="font-extrabold text-slate-700 dark:text-slate-300 uppercase mb-1.5">
                      📋 Bảng kê chi tiết hạng mục ({p.lineItems.length} dòng):
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                            <th className="p-2 text-center w-10">#</th>
                            <th className="p-2 text-left">{tmpl?.lineItemColumns?.col1 || "Nội dung / Hạng mục"}</th>
                            <th className="p-2 text-left">{tmpl?.lineItemColumns?.col2 || "ĐVT / Quy cách"}</th>
                            <th className="p-2 text-center">{tmpl?.lineItemColumns?.col3 || "SL"}</th>
                            <th className="p-2 text-right">{tmpl?.lineItemColumns?.col4 || "Đơn giá"}</th>
                            <th className="p-2 text-right">Thành tiền</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                          {p.lineItems.map((li, idx) => (
                            <tr key={li.id || idx}>
                              <td className="p-2 text-center text-slate-400">{idx + 1}</td>
                              <td className="p-2 font-bold text-slate-900 dark:text-white">{li.itemName}</td>
                              <td className="p-2 text-slate-600 dark:text-slate-300">{li.specification}</td>
                              <td className="p-2 text-center font-bold">{li.quantity}</td>
                              <td className="p-2 text-right">{formatMoneyVND(li.unitPrice)}</td>
                              <td className="p-2 text-right font-extrabold text-rose-600 dark:text-rose-400">
                                {formatMoneyVND(li.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Tệp chứng từ đính kèm */}
                {canSeeFullLeave && Array.isArray(p.attachments) && p.attachments.length > 0 && (
                  <div className="pt-2">
                    <div className="font-extrabold text-slate-700 dark:text-slate-300 uppercase mb-1.5">
                      📎 Hồ sơ / Hóa đơn / Chứng từ đính kèm ({p.attachments.length}):
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {p.attachments.map((att, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-indigo-50/70 dark:bg-slate-800 border border-indigo-200 dark:border-slate-700"
                        >
                          <Paperclip className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                          <span className="font-bold text-slate-800 dark:text-slate-200 truncate max-w-[200px]">
                            {att.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => onPreviewAttachment(att)}
                            className="px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[10px] font-bold hover:bg-indigo-700 cursor-pointer"
                          >
                            👁️ Xem trực tiếp
                          </button>
                          <a
                            href={att.url}
                            download={att.name}
                            target="_blank"
                            rel="noreferrer"
                            className="text-slate-500 hover:text-indigo-600"
                            title="Tải xuống"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* SƠ ĐỒ TIẾN TRÌNH PHÊ DUYỆT & CHỮ KÝ SỐ NỘI BỘ */}
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="text-xs font-extrabold text-slate-800 dark:text-slate-200 uppercase">
                  🔐 Tiến trình Phê duyệt &amp; Xác thực chữ ký điện tử ({p.steps.length} cấp):
                </div>
                <div className="space-y-2">
                  {(p.steps || []).map((st, idx) => {
                    const isDone = st.status === "APPROVED";
                    const isNow = st.status === "PENDING_NOW" && p.status === "PENDING";
                    const isReturned = st.status === "RETURNED";
                    const isRejected = st.status === "REJECTED";
                    return (
                      <div
                        key={idx}
                        className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs ${
                          isDone
                            ? "bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800"
                            : isNow
                            ? "bg-amber-50/80 dark:bg-amber-950/40 border-amber-400 dark:border-amber-700 ring-1 ring-amber-400/40"
                            : isReturned
                            ? "bg-orange-50 dark:bg-orange-950/40 border-orange-300"
                            : isRejected
                            ? "bg-rose-50 dark:bg-rose-950/40 border-rose-300"
                            : "bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800"
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          <span
                            className={`w-6 h-6 rounded-full text-xs font-black flex items-center justify-center shrink-0 mt-0.5 ${
                              isDone
                                ? "bg-emerald-600 text-white"
                                : isNow
                                ? "bg-amber-500 text-white"
                                : isReturned
                                ? "bg-orange-500 text-white"
                                : isRejected
                                ? "bg-rose-600 text-white"
                                : "bg-slate-200 dark:bg-slate-800 text-slate-600"
                            }`}
                          >
                            {idx + 1}
                          </span>
                          <div>
                            <div className="font-extrabold text-slate-900 dark:text-white">
                              Bước {idx + 1}: {st.stepName}{" "}
                              <span className="text-[11px] font-semibold text-slate-500">({st.dept})</span>
                            </div>
                            <div className="text-slate-600 dark:text-slate-300 mt-0.5">
                              Người duyệt: <strong>{st.decidedBy || st.approverName}</strong> • SLA: {st.slaHours}h
                            </div>
                            {st.comment && (
                              <div className="mt-1 px-2.5 py-1 rounded-lg bg-white/80 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-200 italic">
                                💬 &ldquo;{st.comment}&rdquo;
                              </div>
                            )}
                            {Array.isArray(st.attachments) && st.attachments.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {st.attachments.map((att, aIdx) => (
                                  <div
                                    key={aIdx}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-slate-800 border border-indigo-200 dark:border-slate-700 text-[11px]"
                                  >
                                    <Paperclip className="w-3 h-3 text-indigo-600 shrink-0" />
                                    <span className="font-bold text-slate-800 dark:text-slate-200 truncate max-w-[180px]">{att.name}</span>
                                    <button
                                      type="button"
                                      onClick={() => onPreviewAttachment(att)}
                                      className="px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[10px] font-bold hover:bg-indigo-700 cursor-pointer"
                                    >
                                      👁️ Xem
                                    </button>
                                    <a
                                      href={att.url}
                                      download={att.name}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-slate-500 hover:text-indigo-600"
                                      title="Tải xuống"
                                    >
                                      <Download className="w-3 h-3" />
                                    </a>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          {isDone ? (
                            <span className="inline-block px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-extrabold text-[10px]">
                              ✓ ĐÃ KÝ DUYỆT ({st.decidedAt})
                            </span>
                          ) : isNow ? (
                            <span className="inline-block px-2.5 py-1 rounded-lg bg-amber-500 text-white font-extrabold text-[10px]">
                              ⏳ ĐANG CHỜ PHÊ DUYỆT
                            </span>
                          ) : isReturned ? (
                            <span className="inline-block px-2.5 py-1 rounded-lg bg-orange-600 text-white font-extrabold text-[10px]">
                              🔄 YÊU CẦU BỔ SUNG ({st.decidedAt})
                            </span>
                          ) : isRejected ? (
                            <span className="inline-block px-2.5 py-1 rounded-lg bg-rose-600 text-white font-extrabold text-[10px]">
                              ✕ TỪ CHỐI ({st.decidedAt})
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400">Chờ bước trước</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* DANH SÁCH NGƯỜI THEO DÕI ĐỀ XUẤT (CHỈ THEO DÕI TIẾN ĐỘ & THẢO LUẬN — KHÔNG CÓ CHỨC NĂNG DUYỆT) */}
              <div className="p-3.5 rounded-2xl bg-sky-50/70 dark:bg-sky-950/25 border border-sky-200 dark:border-sky-800/80 space-y-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-extrabold text-sky-900 dark:text-sky-200 uppercase flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5 text-sky-600" />
                      <span>👁️ Người Theo Dõi Đề Xuất — Chỉ Theo Dõi, Không Phê Duyệt ({(p.followers || []).length}):</span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Người theo dõi nắm bắt tiến độ, nhận thông báo tự động và tham gia trao đổi nhưng <strong>không có chức năng ký duyệt</strong>.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const curList = Array.isArray(p.followers) ? p.followers : [];
                        if (isCurrentUserFollower) {
                          handleUpdateProposalFollowers(
                            p,
                            curList.filter((f) => !isSamePerson(f, currentStaffName))
                          );
                        } else {
                          handleUpdateProposalFollowers(p, [...curList, currentStaffName]);
                        }
                      }}
                      className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold border transition-colors cursor-pointer flex items-center gap-1 ${
                        isCurrentUserFollower
                          ? "bg-sky-600 text-white border-sky-600"
                          : "bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-300 border-sky-300 dark:border-sky-700 hover:bg-sky-100"
                      }`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>{isCurrentUserFollower ? "✓ Đang theo dõi (Bấm để bỏ)" : "+ Tự theo dõi đề xuất này"}</span>
                    </button>

                    <select
                      value=""
                      onChange={(e) => {
                        const picked = cleanStaffDisplayName(e.target.value);
                        if (!picked) return;
                        const curList = Array.isArray(p.followers) ? p.followers : [];
                        if (curList.some((f) => isSamePerson(f, picked))) return;
                        handleUpdateProposalFollowers(p, [...curList, picked], picked);
                      }}
                      className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold border border-sky-300 dark:border-sky-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 cursor-pointer"
                    >
                      <option value="">+ Thêm người theo dõi (Chỉ xem)...</option>
                      {allStaffNames
                        .filter((n) => !(p.followers || []).some((f) => isSamePerson(f, n)))
                        .map((n) => (
                          <option key={n} value={n}>
                            👁️ {n}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                {(p.followers || []).length === 0 ? (
                  <div className="text-[11px] text-slate-500 italic">
                    Chưa có người theo dõi nào được gắn vào đề xuất này.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {(p.followers || []).map((fName) => (
                      <span
                        key={fName}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white dark:bg-slate-900 border border-sky-300 dark:border-sky-700 text-xs font-bold text-sky-800 dark:text-sky-200"
                      >
                        <Eye className="w-3 h-3 text-sky-600 shrink-0" />
                        <span>{fName}</span>
                        <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300">
                          Chỉ theo dõi
                        </span>
                        {(isRequester || isDirector || isManager || isSamePerson(fName, currentStaffName)) && (
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateProposalFollowers(
                                p,
                                (p.followers || []).filter((x) => !isSamePerson(x, fName))
                              )
                            }
                            className="text-slate-400 hover:text-rose-600 font-bold ml-0.5 cursor-pointer"
                            title="Bỏ người theo dõi này"
                          >
                            ×
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* THÔNG BÁO CHẾ ĐỘ XEM / THEO DÕI KHI BƯỚC HIỆN TẠI THUỘC BỘ PHẬN KHÁC */}
              {!canApproverAct && p.status === "PENDING" && (() => {
                const activeIdx =
                  (p.steps || []).findIndex((s) => s.status === "PENDING_NOW") >= 0
                    ? (p.steps || []).findIndex((s) => s.status === "PENDING_NOW")
                    : p.currentStepIndex || 0;
                const activeStepObj = p.steps?.[activeIdx];
                if (!activeStepObj) return null;
                if (hasCurrentUserApprovedEarlierStep) {
                  return (
                    <div className="p-3.5 rounded-2xl bg-emerald-50/90 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200 flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-extrabold uppercase">
                          ✅ Bạn đã hoàn tất ký duyệt bước trước — Đang chờ bộ phận tiếp theo xử lý
                        </div>
                        <p className="mt-0.5 text-emerald-800 dark:text-emerald-300">
                          Tờ trình hiện đang ở <strong>Bước {activeIdx + 1}/{p.steps.length}: {activeStepObj.stepName}</strong> — chờ{" "}
                          <strong>{activeStepObj.approverName}</strong> ({activeStepObj.dept}) phê duyệt. Bạn đang ở chế độ <strong>Theo dõi tiến độ</strong> (không duyệt thay bước của phòng ban khác).
                        </p>
                      </div>
                    </div>
                  );
                }
                if (isCurrentUserFollower) {
                  return (
                    <div className="p-3.5 rounded-2xl bg-sky-50/90 dark:bg-sky-950/30 border border-sky-300 dark:border-sky-800 text-xs text-sky-900 dark:text-sky-200 flex items-start gap-2.5">
                      <Eye className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-extrabold uppercase">
                          👁️ Chế độ Người theo dõi (Chỉ xem tiến độ — Không có chức năng phê duyệt)
                        </div>
                        <p className="mt-0.5 text-sky-800 dark:text-sky-300">
                          Bạn là <strong>Người theo dõi</strong> của đề xuất này. Hiện đề xuất đang ở{" "}
                          <strong>Bước {activeIdx + 1}/{p.steps.length}: {activeStepObj.stepName}</strong> — chờ{" "}
                          <strong>{activeStepObj.approverName}</strong> ({activeStepObj.dept}) phê duyệt.
                        </p>
                      </div>
                    </div>
                  );
                }
                return (
                  <div className="p-3 rounded-2xl bg-slate-100/80 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                    <span>
                      Hiện tờ trình đang ở <strong>Bước {activeIdx + 1}/{p.steps.length}: {activeStepObj.stepName}</strong> — chờ{" "}
                      <strong>{activeStepObj.approverName}</strong> ({activeStepObj.dept}) phê duyệt.
                    </span>
                  </div>
                );
              })()}

              {/* BẢNG ĐIỀU KHIỂN QUYẾT ĐỊNH CỦA NGƯỜI PHÊ DUYỆT */}
              {canApproverAct && p.status === "PENDING" && (() => {
                const activeStepObj = (p.steps || []).find((s) => s.status === "PENDING_NOW") || p.steps?.[p.currentStepIndex];
                return (
                <div className="p-4 rounded-2xl bg-amber-50/90 dark:bg-amber-950/40 border-2 border-amber-400 dark:border-amber-700 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase text-amber-950 dark:text-amber-200">
                      ⚡ BẢNG QUYẾT ĐỊNH PHÊ DUYỆT CỦA BẠN ({currentStaffName}):
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowDelegateBox(!showDelegateBox)}
                      className="text-[11px] font-bold text-indigo-600 hover:underline cursor-pointer"
                    >
                      ↪️ Ủy quyền / Chuyển người khác duyệt
                    </button>
                  </div>

                  {showDelegateBox && (
                    <div className="flex items-center gap-2 p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-indigo-200 dark:border-slate-700">
                      <select
                        value={delegateToStaff}
                        onChange={(e) => setDelegateToStaff(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      >
                        <option value="">-- Chọn cán bộ nhận ủy quyền duyệt bước này --</option>
                        {allStaffNames.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleDelegateStep}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 cursor-pointer"
                      >
                        Xác nhận chuyển
                      </button>
                    </div>
                  )}

                  <textarea
                    rows={2}
                    value={decisionNote}
                    onChange={(e) => setDecisionNote(e.target.value)}
                    placeholder="Nhập ý kiến chỉ đạo, ghi chú phê duyệt (VD: Đã xuất HĐ số...), hoặc lý do yêu cầu bổ sung / từ chối..."
                    className="w-full px-3 py-2 rounded-xl text-xs bg-white dark:bg-slate-900 border border-amber-300 dark:border-slate-700 text-slate-900 dark:text-white"
                  />

                  <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-amber-300/80 dark:border-slate-700">
                    <AttachmentPicker
                      files={decisionAttachments}
                      onChange={setDecisionAttachments}
                      label={`📎 ${activeStepObj?.attachmentLabel || "Tải lên Hóa đơn VAT / Ủy nhiệm chi / Chứng từ kết quả khi duyệt"}${activeStepObj?.requireAttachment ? " *" : ""}`}
                      hint="Kế toán / Người phê duyệt có thể đính kèm trực tiếp file Hóa đơn (PDF/XML), UNC hoặc biên bản ngay tại đây"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleDecision(p, "APPROVE")}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-sm cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>✅ Đồng Ý Phê Duyệt{decisionAttachments.length > 0 ? ` (& Gửi ${decisionAttachments.length} file)` : ""}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDecision(p, "RETURN")}
                      className="px-3.5 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>🔄 Yêu Cầu Bổ Sung / Giải Trình</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDecision(p, "REJECT")}
                      className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                      <span>❌ Từ Chối Phê Duyệt</span>
                    </button>
                  </div>
                </div>
                );
              })()}

              {/* Hậu kiểm Thực thi & Tải Hóa đơn / Chứng từ kết quả sau khi đã được phê duyệt */}
              {(p.status === "APPROVED" || p.status === "EXECUTED") && (
                <div className="p-4 rounded-2xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-black text-emerald-900 dark:text-emerald-200 uppercase">
                        {p.status === "EXECUTED"
                          ? "🏁 ĐỀ XUẤT ĐÃ THỰC THI HOÀN TẤT — HÓA ĐƠN & CHỨNG TỪ KẾT QUẢ"
                          : "✅ ĐỀ XUẤT ĐÃ ĐƯỢC PHÊ DUYỆT — TẢI HÓA ĐƠN / CHỨNG TỪ & XÁC NHẬN THỰC THI"}
                      </div>
                      <p className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-0.5">
                        Kế toán / Bộ phận thực thi có thể tải bổ sung file Hóa đơn VAT, Ủy nhiệm chi (UNC), Biên bản bàn giao và xác nhận hoàn tất tại đây.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {isBusinessTripProposal(p) && onViewWeeklyScheduleFromProposal && (
                        <button
                          type="button"
                          onClick={() => {
                            onViewWeeklyScheduleFromProposal(p);
                            setSelectedProposal(null);
                          }}
                          className="px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-extrabold text-xs cursor-pointer flex items-center gap-1.5 shadow-2xs"
                        >
                          <Calendar className="w-3.5 h-3.5" />
                          <span>✈️ Đã đồng bộ Lịch Công Tác Tuần (Mở xem)</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          onCreateTaskFromProposal(p);
                          setSelectedProposal(null);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 border border-indigo-300 font-bold text-xs hover:bg-indigo-50 cursor-pointer shrink-0"
                      >
                        📌 Giao việc triển khai
                      </button>
                    </div>
                  </div>

                  {Array.isArray(p.executionAttachments) && p.executionAttachments.length > 0 && (
                    <div className="p-2.5 rounded-xl bg-white/90 dark:bg-slate-900 border border-emerald-200 dark:border-slate-700 space-y-1.5">
                      <div className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase">
                        📎 Hóa đơn / Chứng từ kết quả đã tải lên ({p.executionAttachments.length}):
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {p.executionAttachments.map((att, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-2 px-3 py-1 rounded-xl bg-emerald-50 dark:bg-slate-800 border border-emerald-200 dark:border-slate-700 text-xs"
                          >
                            <Paperclip className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span className="font-bold text-slate-800 dark:text-slate-200 truncate max-w-[220px]">{att.name}</span>
                            <button
                              type="button"
                              onClick={() => onPreviewAttachment(att)}
                              className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold hover:bg-emerald-700 cursor-pointer"
                            >
                              👁️ Xem trực tiếp
                            </button>
                            <a
                              href={att.url}
                              download={att.name}
                              target="_blank"
                              rel="noreferrer"
                              className="text-slate-500 hover:text-emerald-600"
                              title="Tải xuống"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-slate-700 space-y-2.5">
                    <AttachmentPicker
                      files={executionAttachments}
                      onChange={setExecutionAttachments}
                      label="📎 Tải lên Hóa đơn VAT / Ủy nhiệm chi (UNC) / Chứng từ kết quả thực thi"
                      hint="Hỗ trợ đính kèm PDF hóa đơn, XML, ảnh chụp UNC, biên bản xuất kho..."
                    />
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <input
                        type="text"
                        value={executionNoteInput}
                        onChange={(e) => setExecutionNoteInput(e.target.value)}
                        placeholder="Ghi chú thực thi (VD: Đã xuất Hóa đơn số 0001234 ngày 16/11/2026)..."
                        className="flex-1 px-3 py-1.5 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          handleDecision(
                            p,
                            "EXECUTE",
                            executionNoteInput.trim() ||
                              (executionAttachments.length > 0
                                ? `Đã tải lên ${executionAttachments.length} chứng từ / hóa đơn thực thi`
                                : "Đã giải ngân / Xuất hóa đơn / Thực thi hoàn tất theo phê duyệt")
                          )
                        }
                        className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-extrabold text-xs cursor-pointer shrink-0"
                      >
                        {p.status === "EXECUTED"
                          ? "📎 Lưu Bổ Sung Hóa Đơn / Chứng Từ"
                          : "🏁 Lưu Hóa Đơn / Chứng Từ & Xác Nhận Hoàn Tất"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Trao đổi & Nhật ký Audit Trail */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Thảo luận trên tờ trình */}
                <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5">
                  <div className="text-xs font-extrabold text-slate-800 dark:text-slate-200 uppercase">
                    💬 Thảo luận &amp; Giải trình ({p.comments?.length || 0}):
                  </div>
                  <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                    {(p.comments || []).length === 0 ? (
                      <p className="text-xs text-slate-400 italic">Chưa có ý kiến trao đổi nào.</p>
                    ) : (
                      (p.comments || []).map((c) => (
                        <div key={c.id} className="p-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200/70 dark:border-slate-800 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-900 dark:text-white">
                              {c.author} <span className="font-normal text-slate-400">({c.dept})</span>
                            </span>
                            <span className="text-[10px] text-slate-400">{c.time}</span>
                          </div>
                          {c.actionTag && (
                            <span className="inline-block text-[10px] font-bold text-indigo-600 mt-0.5">{c.actionTag}</span>
                          )}
                          <p className="text-slate-700 dark:text-slate-300 mt-0.5">{c.text}</p>
                          {Array.isArray(c.attachments) && c.attachments.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {c.attachments.map((att, aIdx) => (
                                <div
                                  key={aIdx}
                                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-slate-800 border border-indigo-200 dark:border-slate-700 text-[10px]"
                                >
                                  <Paperclip className="w-3 h-3 text-indigo-600 shrink-0" />
                                  <span className="font-bold text-slate-800 dark:text-slate-200 truncate max-w-[160px]">{att.name}</span>
                                  <button
                                    type="button"
                                    onClick={() => onPreviewAttachment(att)}
                                    className="px-1.5 py-0.5 rounded bg-indigo-600 text-white font-bold hover:bg-indigo-700 cursor-pointer"
                                  >
                                    👁️ Xem
                                  </button>
                                  <a href={att.url} download={att.name} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-indigo-600">
                                    <Download className="w-3 h-3" />
                                  </a>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                  <form onSubmit={handleAddComment} className="space-y-2 pt-1">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={commentInput}
                        onChange={(e) => setCommentInput(e.target.value)}
                        placeholder="Nhập ý kiến trao đổi / giải trình hoặc đính kèm file..."
                        className="flex-1 px-3 py-1.5 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                      />
                      <button
                        type="submit"
                        className="px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 cursor-pointer"
                      >
                        Gửi
                      </button>
                    </div>
                    <AttachmentPicker
                      files={commentAttachments}
                      onChange={setCommentAttachments}
                      label="Đính kèm tệp vào trao đổi (Tùy chọn)"
                    />
                  </form>
                </div>

                {/* Vết kiểm toán (Audit Log) */}
                <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="text-xs font-extrabold text-slate-800 dark:text-slate-200 uppercase">
                    🛡️ Vết kiểm toán &amp; Lịch sử ký duyệt (Audit Trail):
                  </div>
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {(p.auditLogs || []).map((log, i) => (
                      <div key={i} className="text-xs border-l-2 border-indigo-500 pl-2.5 py-0.5">
                        <div className="font-bold text-slate-800 dark:text-slate-200">
                          {log.action} • <span className="text-indigo-600 dark:text-indigo-400">{log.actor}</span>
                        </div>
                        <div className="text-[11px] text-slate-500">{log.detail}</div>
                        <div className="text-[10px] text-slate-400">{log.time}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ==================== MODAL 3: XEM ĐẦY ĐỦ & THIẾT KẾ BIỂU MẪU + MA TRẬN LUỒNG DUYỆT ==================== */}
      <Modal
        isOpen={isTemplateBuilderOpen && Boolean(editingTemplate)}
        onClose={() => {
          setIsTemplateBuilderOpen(false);
          setEditingTemplate(null);
        }}
        title={
          editingTemplate
            ? `${editingTemplate.icon || "📋"} Chi Tiết & Thiết Kế Biểu Mẫu: ${editingTemplate.name || "Mẫu Đề Xuất Mới"} (${editingTemplate.codePrefix || "DX"})`
            : "⚙️ Thiết Kế Biểu Mẫu & Luồng Phê Duyệt Tự Động"
        }
        size="4xl"
      >
        {editingTemplate && (
          <div className="space-y-4 max-h-[78vh] overflow-y-auto pr-1 text-xs">
            {/* Thanh tóm tắt & hành động nhanh trên đầu modal */}
            <div className="p-3 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-900/60 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">{editingTemplate.icon || "📋"}</span>
                <div>
                  <div className="font-black text-slate-900 dark:text-white text-sm">
                    {editingTemplate.name || "Biểu mẫu đề xuất mới"}
                    <span className="ml-2 px-2 py-0.5 rounded bg-indigo-600 text-white font-mono text-[10px]">
                      {editingTemplate.codePrefix || "DX"}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {editingTemplate.fields.length} trường thông tin • {editingTemplate.defaultSteps.length} bước phê duyệt • Tổng SLA:{" "}
                    <strong>{editingTemplate.slaTotalHours || 24} giờ</strong>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {templates.some((t) => t.id === editingTemplate.id) && (
                  <>
                    <button
                      type="button"
                      onClick={async () => {
                        const target = editingTemplate;
                        const exists = templates.some((t) => t.id === target.id);
                        const next = exists
                          ? templates.map((t) => (t.id === target.id ? target : t))
                          : [target, ...templates];
                        await saveTemplatesToStorage(next);
                        setIsTemplateBuilderOpen(false);
                        setEditingTemplate(null);
                        openCreateProposalModal(target.id, target);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold cursor-pointer shadow-sm"
                    >
                      🚀 Lập Đề Xuất Ngay Từ Mẫu Này
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingTemplate({
                          ...editingTemplate,
                          id: `TMPL_${Date.now()}`,
                          name: `${editingTemplate.name} (Bản sao)`,
                          codePrefix: `${editingTemplate.codePrefix}2`
                        });
                        showToast("Đã nhân bản mẫu! Hãy chỉnh sửa và bấm Lưu.", "info");
                      }}
                      className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold hover:border-indigo-400 cursor-pointer"
                    >
                      📋 Nhân bản
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* PHẦN 1: THÔNG TIN CHUNG & QUY TẮC BIỂU MẪU */}
            <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="font-extrabold uppercase text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                <span>1️⃣ Thông tin định danh &amp; Cấu hình chung của Mẫu duyệt</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-bold mb-1 text-slate-600 dark:text-slate-300">Biểu tượng</label>
                  <select
                    value={editingTemplate.icon || "📋"}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, icon: e.target.value })}
                    className="w-full px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold text-base"
                  >
                    {["📋", "💳", "💵", "🧾", "🏖️", "⏰", "✈️", "🏷️", "🛒", "🔬", "📦", "🏛️", "🛠️", "📑", "🤝"].map((ic) => (
                      <option key={ic} value={ic}>
                        {ic} Icon
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-5">
                  <label className="block font-bold mb-1 text-slate-600 dark:text-slate-300">Tên Biểu mẫu Đề xuất *</label>
                  <input
                    type="text"
                    value={editingTemplate.name}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                    placeholder="VD: Đề nghị Thanh toán / Đề xuất Mua sắm..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-bold mb-1 text-slate-600 dark:text-slate-300">Mã phiếu (Prefix)</label>
                  <input
                    type="text"
                    value={editingTemplate.codePrefix}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, codePrefix: e.target.value.toUpperCase() })}
                    placeholder="VD: DNTT"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold uppercase"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block font-bold mb-1 text-slate-600 dark:text-slate-300">Nhóm danh mục</label>
                  <select
                    value={editingTemplate.category}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, category: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                  >
                    <option value="FINANCE">💰 Tài chính - Kế toán</option>
                    <option value="HR_ADMIN">👥 Nhân sự - Hành chính</option>
                    <option value="COMMERCIAL">💼 Kinh doanh - Chính sách</option>
                    <option value="TECHNICAL_OPS">🔬 Kỹ thuật - Kho - Mua sắm</option>
                    <option value="EXECUTIVE">🏛️ Tờ trình Ban Giám Đốc</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                <div className="sm:col-span-6">
                  <label className="block font-bold mb-1 text-slate-600 dark:text-slate-300">Mô tả hướng dẫn áp dụng (hiển thị cho nhân viên khi lập phiếu)</label>
                  <input
                    type="text"
                    value={editingTemplate.description}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, description: e.target.value })}
                    placeholder="Hướng dẫn khi nào dùng mẫu này, chứng từ cần đính kèm..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
                <div className="sm:col-span-4">
                  <label className="block font-bold mb-1 text-slate-600 dark:text-slate-300">Phạm vi hiển thị mặc định</label>
                  <select
                    value={editingTemplate.defaultVisibility || resolveDefaultTemplateVisibility(editingTemplate)}
                    onChange={(e) =>
                      setEditingTemplate({
                        ...editingTemplate,
                        defaultVisibility: e.target.value as ProposalVisibility
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                  >
                    <option value="PRIVATE">🔒 Bảo mật theo luồng duyệt (Chỉ người duyệt &amp; theo dõi)</option>
                    <option value="DEPT">🏢 Nội bộ Phòng ban &amp; Người duyệt</option>
                    <option value="PUBLIC">🌐 Công khai toàn công ty</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-bold mb-1 text-slate-600 dark:text-slate-300">Tổng SLA (giờ)</label>
                  <input
                    type="number"
                    min={1}
                    value={editingTemplate.slaTotalHours || 24}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, slaTotalHours: Number(e.target.value) || 24 })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                  />
                </div>
              </div>

              {/* Tùy chọn Quản lý Số tiền & Bảng kê chi tiết */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(editingTemplate.hasAmount)}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, hasAmount: e.target.checked })}
                    className="w-4 h-4 accent-indigo-600"
                  />
                  <div>
                    <div className="font-bold text-slate-800 dark:text-slate-200">💰 Biểu mẫu có Quản lý Giá trị / Số tiền (VNĐ)</div>
                    <div className="text-[10px] text-slate-500">Cho phép xét hạn mức tiền để tự động kích hoạt cấp duyệt Ban Giám Đốc</div>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(editingTemplate.hasLineItems)}
                    onChange={(e) =>
                      setEditingTemplate({
                        ...editingTemplate,
                        hasLineItems: e.target.checked,
                        lineItemColumns: editingTemplate.lineItemColumns || {
                          col1: "Nội dung / Hạng mục",
                          col2: "Quy cách / ĐVT",
                          col3: "Số lượng",
                          col4: "Đơn giá (VNĐ)"
                        }
                      })
                    }
                    className="w-4 h-4 accent-indigo-600"
                  />
                  <div>
                    <div className="font-bold text-slate-800 dark:text-slate-200">📑 Có Bảng kê chi tiết nhiều dòng (Line Items)</div>
                    <div className="text-[10px] text-slate-500">Tự động nhân Số lượng × Đơn giá = Thành tiền từng dòng</div>
                  </div>
                </label>
              </div>

              {editingTemplate.hasLineItems && (
                <div className="p-2.5 rounded-xl bg-indigo-50/40 dark:bg-indigo-950/20 border border-indigo-200/60 dark:border-indigo-900/50 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Tiêu đề Cột 1</label>
                    <input
                      type="text"
                      value={editingTemplate.lineItemColumns?.col1 || "Nội dung / Hạng mục"}
                      onChange={(e) =>
                        setEditingTemplate({
                          ...editingTemplate,
                          lineItemColumns: {
                            col1: e.target.value,
                            col2: editingTemplate.lineItemColumns?.col2 || "Quy cách / ĐVT",
                            col3: editingTemplate.lineItemColumns?.col3 || "Số lượng",
                            col4: editingTemplate.lineItemColumns?.col4 || "Đơn giá"
                          }
                        })
                      }
                      className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Tiêu đề Cột 2</label>
                    <input
                      type="text"
                      value={editingTemplate.lineItemColumns?.col2 || "Quy cách / ĐVT"}
                      onChange={(e) =>
                        setEditingTemplate({
                          ...editingTemplate,
                          lineItemColumns: {
                            col1: editingTemplate.lineItemColumns?.col1 || "Nội dung / Hạng mục",
                            col2: e.target.value,
                            col3: editingTemplate.lineItemColumns?.col3 || "Số lượng",
                            col4: editingTemplate.lineItemColumns?.col4 || "Đơn giá"
                          }
                        })
                      }
                      className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Tiêu đề Cột 3 (Số lượng)</label>
                    <input
                      type="text"
                      value={editingTemplate.lineItemColumns?.col3 || "Số lượng"}
                      onChange={(e) =>
                        setEditingTemplate({
                          ...editingTemplate,
                          lineItemColumns: {
                            col1: editingTemplate.lineItemColumns?.col1 || "Nội dung / Hạng mục",
                            col2: editingTemplate.lineItemColumns?.col2 || "Quy cách / ĐVT",
                            col3: e.target.value,
                            col4: editingTemplate.lineItemColumns?.col4 || "Đơn giá"
                          }
                        })
                      }
                      className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Tiêu đề Cột 4 (Đơn giá)</label>
                    <input
                      type="text"
                      value={editingTemplate.lineItemColumns?.col4 || "Đơn giá (VNĐ)"}
                      onChange={(e) =>
                        setEditingTemplate({
                          ...editingTemplate,
                          lineItemColumns: {
                            col1: editingTemplate.lineItemColumns?.col1 || "Nội dung / Hạng mục",
                            col2: editingTemplate.lineItemColumns?.col2 || "Quy cách / ĐVT",
                            col3: editingTemplate.lineItemColumns?.col3 || "Số lượng",
                            col4: e.target.value
                          }
                        })
                      }
                      className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* PHẦN 2: CẤU HÌNH CÁC TRƯỜNG DỮ LIỆU ĐỘNG CỦA BIỂU MẪU (DYNAMIC FORM FIELDS) */}
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-extrabold uppercase text-slate-800 dark:text-slate-200">
                    2️⃣ Các Trường Thông Tin Cần Điền Trên Biểu Mẫu ({editingTemplate.fields.length} trường):
                  </span>
                  <p className="text-[11px] text-slate-500">
                    Thiết kế các ô nhập liệu riêng cho mẫu này (chữ, số, ngày tháng, danh sách chọn)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setEditingTemplate({
                      ...editingTemplate,
                      fields: [
                        ...editingTemplate.fields,
                        {
                          key: `field_${Date.now()}`,
                          label: `Trường thông tin ${editingTemplate.fields.length + 1}`,
                          type: "text",
                          placeholder: "Nhập nội dung...",
                          required: false
                        }
                      ]
                    })
                  }
                  className="px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer"
                >
                  + Thêm trường thông tin
                </button>
              </div>

              <div className="space-y-2">
                {editingTemplate.fields.map((fld, fIdx) => (
                  <div
                    key={fld.key || fIdx}
                    className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800"
                  >
                    <div className="sm:col-span-4">
                      <label className="block text-[10px] font-bold text-slate-400">Tên trường hiển thị *</label>
                      <input
                        type="text"
                        value={fld.label}
                        onChange={(e) => {
                          const nextFields = [...editingTemplate.fields];
                          nextFields[fIdx] = { ...nextFields[fIdx], label: e.target.value };
                          setEditingTemplate({ ...editingTemplate, fields: nextFields });
                        }}
                        placeholder="VD: Đơn vị thụ hưởng / Số TK..."
                        className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 font-bold"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[10px] font-bold text-slate-400">Kiểu dữ liệu</label>
                      <select
                        value={fld.type}
                        onChange={(e) => {
                          const nextFields = [...editingTemplate.fields];
                          nextFields[fIdx] = { ...nextFields[fIdx], type: e.target.value as any };
                          setEditingTemplate({ ...editingTemplate, fields: nextFields });
                        }}
                        className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 font-semibold bg-white dark:bg-slate-900"
                      >
                        <option value="text">Chữ ngắn (Text)</option>
                        <option value="textarea">Đoạn văn (Textarea)</option>
                        <option value="number">Con số (Number)</option>
                        <option value="date">Ngày tháng (Date)</option>
                        <option value="select">Danh sách chọn (Select)</option>
                        <option value="file">📎 Tải tệp đính kèm (File Upload)</option>
                      </select>
                    </div>
                    <div className="sm:col-span-4">
                      <label className="block text-[10px] font-bold text-slate-400">
                        {fld.type === "select"
                          ? "Các lựa chọn (cách nhau dấu phẩy)"
                          : fld.type === "date"
                          ? "📅 Chọn ngày trên lịch (Bấm để mở lịch)"
                          : fld.type === "file"
                          ? "📎 Hướng dẫn loại file cần tải lên"
                          : "Gợi ý nhập (Placeholder)"}
                      </label>
                      {fld.type === "select" ? (
                        <input
                          type="text"
                          value={(fld.options || []).join(", ")}
                          onChange={(e) => {
                            const nextFields = [...editingTemplate.fields];
                            nextFields[fIdx] = {
                              ...nextFields[fIdx],
                              options: e.target.value
                                .split(",")
                                .map((s) => s.trim())
                                .filter(Boolean)
                            };
                            setEditingTemplate({ ...editingTemplate, fields: nextFields });
                          }}
                          placeholder="VD: Chuyển khoản, Tiền mặt, Công nợ..."
                          className="w-full px-2 py-1 rounded border border-indigo-300 dark:border-indigo-700"
                        />
                      ) : fld.type === "date" ? (
                        <DateInputVN
                          value={/^\d{4}-\d{2}-\d{2}$/.test(fld.placeholder || "") ? fld.placeholder! : todayVN()}
                          onChange={(e) => {
                            const nextFields = [...editingTemplate.fields];
                            nextFields[fIdx] = { ...nextFields[fIdx], placeholder: e.target.value };
                            setEditingTemplate({ ...editingTemplate, fields: nextFields });
                          }}
                          className="w-full px-2 py-1 rounded border border-teal-300 dark:border-teal-700 bg-teal-50/30 dark:bg-teal-950/30 font-semibold text-slate-900 dark:text-white"
                        />
                      ) : (
                        <input
                          type="text"
                          value={fld.placeholder || ""}
                          onChange={(e) => {
                            const nextFields = [...editingTemplate.fields];
                            nextFields[fIdx] = { ...nextFields[fIdx], placeholder: e.target.value };
                            setEditingTemplate({ ...editingTemplate, fields: nextFields });
                          }}
                          placeholder="Gợi ý hiển thị trong ô..."
                          className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700"
                        />
                      )}
                    </div>
                    <div className="sm:col-span-1 flex items-center justify-center pt-3">
                      <label className="flex items-center gap-1 cursor-pointer text-[11px] font-bold">
                        <input
                          type="checkbox"
                          checked={Boolean(fld.required)}
                          onChange={(e) => {
                            const nextFields = [...editingTemplate.fields];
                            nextFields[fIdx] = { ...nextFields[fIdx], required: e.target.checked };
                            setEditingTemplate({ ...editingTemplate, fields: nextFields });
                          }}
                          className="accent-indigo-600"
                        />
                        Bắt buộc
                      </label>
                    </div>
                    <div className="sm:col-span-1 text-right pt-3">
                      {editingTemplate.fields.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setEditingTemplate({
                              ...editingTemplate,
                              fields: editingTemplate.fields.filter((_, i) => i !== fIdx)
                            })
                          }
                          className="text-slate-400 hover:text-rose-600 cursor-pointer p-1"
                          title="Xóa trường này"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* PHẦN 3: CẤU HÌNH CÁC CẤP PHÊ DUYỆT MẶC ĐỊNH (WORKFLOW PIPELINE) */}
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-extrabold uppercase text-slate-800 dark:text-slate-200">
                    3️⃣ Luồng Các Cấp Phê Duyệt Mặc Định ({editingTemplate.defaultSteps.length} cấp):
                  </span>
                  <p className="text-[11px] text-slate-500">
                    Thiết lập thứ tự ký duyệt, người duyệt mặc định, SLA từng bước và hạn mức tiền kích hoạt (nếu có)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setEditingTemplate({
                      ...editingTemplate,
                      defaultSteps: [
                        ...editingTemplate.defaultSteps,
                        {
                          stepOrder: editingTemplate.defaultSteps.length + 1,
                          stepName: `Cấp phê duyệt ${editingTemplate.defaultSteps.length + 1}`,
                          roleType: "DIRECTOR",
                          defaultDept: "Ban Giám Đốc",
                          defaultApprover: "Ban Giám Đốc",
                          slaHours: 8
                        }
                      ]
                    })
                  }
                  className="px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer"
                >
                  + Thêm cấp phê duyệt
                </button>
              </div>

              <div className="space-y-2">
                {editingTemplate.defaultSteps.map((st, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800"
                  >
                    <div className="sm:col-span-1 font-black text-indigo-600 text-center">B{idx + 1}</div>
                    <div className="sm:col-span-3">
                      <label className="block text-[10px] font-bold text-slate-400">Tên bước / Vai trò duyệt</label>
                      <input
                        type="text"
                        value={st.stepName}
                        onChange={(e) => {
                          const nextStepName = e.target.value;
                          const copy = [...editingTemplate.defaultSteps];
                          copy[idx] = {
                            ...copy[idx],
                            stepName: nextStepName,
                            roleType: inferProposalStepRoleType(
                              copy[idx].defaultDept,
                              copy[idx].defaultApprover,
                              nextStepName,
                              copy[idx].roleType
                            )
                          };
                          setEditingTemplate({ ...editingTemplate, defaultSteps: copy });
                        }}
                        className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 font-bold"
                        placeholder="VD: Kế toán kiểm tra..."
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[10px] font-bold text-slate-400">Phòng ban</label>
                      <input
                        type="text"
                        value={st.defaultDept}
                        onChange={(e) => {
                          const nextDept = e.target.value;
                          const copy = [...editingTemplate.defaultSteps];
                          copy[idx] = {
                            ...copy[idx],
                            defaultDept: nextDept,
                            roleType: inferProposalStepRoleType(
                              nextDept,
                              copy[idx].defaultApprover,
                              copy[idx].stepName,
                              copy[idx].roleType
                            )
                          };
                          setEditingTemplate({ ...editingTemplate, defaultSteps: copy });
                        }}
                        className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700"
                        placeholder="Phòng ban..."
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-[10px] font-bold text-slate-400">Người duyệt mặc định</label>
                      <input
                        type="text"
                        list="approval-staff-datalist"
                        value={st.defaultApprover}
                        onChange={(e) => {
                          const nextApprover = sanitizeLegacyTbrApproverName(e.target.value);
                          const copy = [...editingTemplate.defaultSteps];
                          copy[idx] = {
                            ...copy[idx],
                            defaultApprover: nextApprover,
                            roleType: inferProposalStepRoleType(
                              copy[idx].defaultDept,
                              nextApprover,
                              copy[idx].stepName,
                              copy[idx].roleType
                            )
                          };
                          setEditingTemplate({ ...editingTemplate, defaultSteps: copy });
                        }}
                        className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 font-semibold"
                        placeholder="Chọn hoặc nhập tên..."
                      />
                    </div>
                    <div className="sm:col-span-1">
                      <label className="block text-[10px] font-bold text-slate-400">SLA (giờ)</label>
                      <input
                        type="number"
                        min={1}
                        value={st.slaHours || 8}
                        onChange={(e) => {
                          const copy = [...editingTemplate.defaultSteps];
                          copy[idx] = { ...copy[idx], slaHours: Number(e.target.value) || 8 };
                          setEditingTemplate({ ...editingTemplate, defaultSteps: copy });
                        }}
                        className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-center font-bold"
                      />
                    </div>
                    <div className="sm:col-span-2 flex items-center gap-1">
                      <div className="flex-1">
                        <label className="block text-[10px] font-bold text-slate-400">Hạn mức kích hoạt</label>
                        <input
                          type="number"
                          value={st.conditionMinAmount || ""}
                          onChange={(e) => {
                            const copy = [...editingTemplate.defaultSteps];
                            copy[idx] = { ...copy[idx], conditionMinAmount: Number(e.target.value) || undefined };
                            setEditingTemplate({ ...editingTemplate, defaultSteps: copy });
                          }}
                          className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700"
                          placeholder="Mọi mức tiền"
                          title="Nếu nhập (VD: 5000000), bước này chỉ kích hoạt khi tổng tiền đề xuất >= hạn mức"
                        />
                      </div>
                      {editingTemplate.defaultSteps.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setEditingTemplate({
                              ...editingTemplate,
                              defaultSteps: editingTemplate.defaultSteps
                                .filter((_, i) => i !== idx)
                                .map((s, i) => ({ ...s, stepOrder: i + 1 }))
                            })
                          }
                          className="text-slate-400 hover:text-rose-600 cursor-pointer pt-4 pl-1"
                          title="Xóa bước duyệt này"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Cấu hình cho phép / bắt buộc người duyệt ở bước này tải file lên (VD: Kế toán tải Hóa đơn VAT / UNC) */}
                    <div className="sm:col-span-12 pt-1.5 mt-1 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-3">
                      <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-indigo-700 dark:text-indigo-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={st.allowAttachment !== false}
                          onChange={(e) => {
                            const copy = [...editingTemplate.defaultSteps];
                            copy[idx] = {
                              ...copy[idx],
                              allowAttachment: e.target.checked,
                              requireAttachment: e.target.checked ? copy[idx].requireAttachment : false
                            };
                            setEditingTemplate({ ...editingTemplate, defaultSteps: copy });
                          }}
                          className="accent-indigo-600"
                        />
                        <span>📎 Cho phép người duyệt bước này tải file lên (Hóa đơn / UNC / Chứng từ kết quả)</span>
                      </label>

                      {st.allowAttachment !== false && (
                        <>
                          <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-rose-600 dark:text-rose-400 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(st.requireAttachment)}
                              onChange={(e) => {
                                const copy = [...editingTemplate.defaultSteps];
                                copy[idx] = { ...copy[idx], requireAttachment: e.target.checked };
                                setEditingTemplate({ ...editingTemplate, defaultSteps: copy });
                              }}
                              className="accent-rose-600"
                            />
                            <span>Bắt buộc phải đính kèm file khi bấm Duyệt</span>
                          </label>

                          <input
                            type="text"
                            value={st.attachmentLabel || ""}
                            onChange={(e) => {
                              const copy = [...editingTemplate.defaultSteps];
                              copy[idx] = { ...copy[idx], attachmentLabel: e.target.value };
                              setEditingTemplate({ ...editingTemplate, defaultSteps: copy });
                            }}
                            placeholder="Nhãn hướng dẫn tải file ở bước này (VD: Tải lên Hóa đơn VAT đã xuất PDF/XML)..."
                            className="flex-1 min-w-[240px] px-2.5 py-1 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-slate-950 text-[11px]"
                          />
                        </>
                      )}
                    </div>
                  </div>
                ))}
                <datalist id="approval-staff-datalist">
                  {allStaffNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </div>
            </div>

            {/* PHẦN 4: NGƯỜI THEO DÕI MẶC ĐỊNH CỦA BIỂU MẪU (DEFAULT FOLLOWERS / CC) */}
            <div className="p-3.5 rounded-2xl bg-sky-50/70 dark:bg-sky-950/25 border border-sky-200 dark:border-sky-800/80 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-extrabold uppercase text-sky-900 dark:text-sky-200 flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-sky-600" />
                    <span>
                      4️⃣ Người Theo Dõi Mặc Định Của Biểu Mẫu — Chỉ Theo Dõi, Không Phê Duyệt ({(editingTemplate.defaultFollowers || []).length} người):
                    </span>
                  </span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Khi nhân viên lập đề xuất từ mẫu này, hệ thống sẽ tự động gắn sẵn những người dưới đây làm <strong>Người theo dõi (CC)</strong> để nhận thông báo &amp; xem tiến độ (không nằm trong luồng ký duyệt).
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    value=""
                    onChange={(e) => {
                      const picked = cleanStaffDisplayName(e.target.value);
                      if (!picked) return;
                      const cur = Array.isArray(editingTemplate.defaultFollowers) ? editingTemplate.defaultFollowers : [];
                      if (cur.some((f) => isSamePerson(f, picked))) return;
                      setEditingTemplate({
                        ...editingTemplate,
                        defaultFollowers: [...cur, picked]
                      });
                    }}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold border border-sky-300 dark:border-sky-700 bg-white dark:bg-slate-900 text-sky-800 dark:text-sky-200 cursor-pointer"
                  >
                    <option value="">+ Chọn nhân sự theo dõi mặc định...</option>
                    {allStaffNames
                      .filter((n) => !(editingTemplate.defaultFollowers || []).some((f) => isSamePerson(f, n)))
                      .map((n) => (
                        <option key={n} value={n}>
                          👁️ {n}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {(editingTemplate.defaultFollowers || []).length === 0 ? (
                <div className="text-[11px] text-slate-500 italic bg-white/70 dark:bg-slate-900/60 px-3 py-2 rounded-xl border border-dashed border-sky-200 dark:border-sky-800/60">
                  Chưa cài người theo dõi mặc định cho biểu mẫu này. Hãy chọn nhân sự ở ô <strong>&ldquo;+ Chọn nhân sự theo dõi mặc định...&rdquo;</strong> góc phải rồi bấm <strong>💾 Lưu Cấu Hình Mẫu</strong>.
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {(editingTemplate.defaultFollowers || []).map((fName) => (
                    <span
                      key={fName}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white dark:bg-slate-900 border border-sky-300 dark:border-sky-700 text-xs font-bold text-sky-800 dark:text-sky-200 shadow-2xs"
                    >
                      <Eye className="w-3 h-3 text-sky-600 shrink-0" />
                      <span>{fName}</span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300">
                        Mặc định theo dõi
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setEditingTemplate({
                            ...editingTemplate,
                            defaultFollowers: (editingTemplate.defaultFollowers || []).filter((x) => !isSamePerson(x, fName))
                          })
                        }
                        className="text-slate-400 hover:text-rose-600 font-bold ml-0.5 cursor-pointer"
                        title="Bỏ người theo dõi mặc định này"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Chân Modal: Xóa mẫu / Hủy / Lưu Cấu Hình */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div>
                {templates.some((t) => t.id === editingTemplate.id) && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (templates.length <= 1) {
                        showToast("Hệ thống cần giữ lại ít nhất 1 biểu mẫu!", "warning");
                        return;
                      }
                      const next = templates.filter((t) => t.id !== editingTemplate.id);
                      await saveTemplatesToStorage(next);
                      setIsTemplateBuilderOpen(false);
                      setEditingTemplate(null);
                      showToast("Đã xóa biểu mẫu khỏi danh mục!", "info");
                    }}
                    className="px-3 py-2 rounded-xl font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Xóa biểu mẫu này
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsTemplateBuilderOpen(false);
                    setEditingTemplate(null);
                  }}
                  className="px-3.5 py-2 rounded-xl font-bold bg-slate-100 dark:bg-slate-800 cursor-pointer"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!editingTemplate.name.trim()) {
                      showToast("Vui lòng nhập tên biểu mẫu đề xuất!", "warning");
                      return;
                    }
                    const exists = templates.some((t) => t.id === editingTemplate.id);
                    const next = exists
                      ? templates.map((t) => (t.id === editingTemplate.id ? editingTemplate : t))
                      : [editingTemplate, ...templates];
                    await saveTemplatesToStorage(next);
                    setIsTemplateBuilderOpen(false);
                    setEditingTemplate(null);
                    showToast("Đã lưu cấu hình biểu mẫu & ma trận phê duyệt!", "success");
                  }}
                  className="px-4 py-2 rounded-xl font-extrabold bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer shadow-sm"
                >
                  💾 Lưu Cấu Hình Mẫu
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

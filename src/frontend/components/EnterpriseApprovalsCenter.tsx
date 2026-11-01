"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  Plus,
  Search,
  FileText,
  DollarSign,
  ShoppingCart,
  Award,
  ShieldCheck,
  Calendar,
  FlaskConical,
  Briefcase,
  Send,
  X,
  Check,
  RotateCcw,
  UserCheck,
  Printer,
  MessageSquare,
  Sliders,
  ArrowRight,
  Paperclip,
  Trash2,
  Edit3,
  Eye,
  Building2,
} from "lucide-react";
import { Modal } from "@/frontend/components/Modal";
import { Pager, usePaged } from "@/frontend/components/Pager";
import { AttachmentPicker, AttachmentList } from "@/frontend/components/AttachmentPicker";
import { useNotification } from "@/frontend/contexts/NotificationContext";
import { escHtml, useDebouncedValue, vnToday } from "@/frontend/factory/api";
import { isSameWorkspaceDept } from "@/backend/services/workspaceTasks";

const CATEGORY_META: Record<
  string,
  { label: string; badgeCls: string; icon: React.ElementType }
> = {
  FINANCE: {
    label: "💰 Tài chính & Thanh toán",
    badgeCls:
      "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
    icon: DollarSign,
  },
  PROCUREMENT: {
    label: "🛒 Mua sắm & Đầu tư CAPEX",
    badgeCls:
      "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800",
    icon: ShoppingCart,
  },
  SALES: {
    label: "💼 Chính sách Kinh doanh & Thầu",
    badgeCls:
      "bg-orange-50 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800",
    icon: Award,
  },
  TECHNICAL: {
    label: "🧪 Kỹ thuật, Sản xuất & ISO 13485",
    badgeCls:
      "bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800",
    icon: FlaskConical,
  },
  HR: {
    label: "👤 Nhân sự, Công tác & Tăng ca",
    badgeCls:
      "bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800",
    icon: Calendar,
  },
  GENERAL: {
    label: "📜 Tờ trình Chủ trương Chung",
    badgeCls:
      "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800",
    icon: FileText,
  },
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  PENDING: {
    label: "⏳ Chờ duyệt Cấp 1",
    cls: "bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800",
  },
  IN_REVIEW: {
    label: "🔄 Đang trình cấp tiếp theo",
    cls: "bg-sky-100 dark:bg-sky-950/80 text-sky-800 dark:text-sky-300 border-sky-300 dark:border-sky-800",
  },
  NEED_INFO: {
    label: "⚠️ Cần bổ sung giải trình",
    cls: "bg-orange-100 dark:bg-orange-950/80 text-orange-800 dark:text-orange-300 border-orange-300 dark:border-orange-800",
  },
  APPROVED: {
    label: "✅ Đã phê duyệt ban hành",
    cls: "bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800",
  },
  REJECTED: {
    label: "❌ Đã từ chối",
    cls: "bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-800",
  },
  WITHDRAWN: {
    label: "↩️ Đã rút lại",
    cls: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700",
  },
};

const PRIORITY_META: Record<string, { label: string; cls: string }> = {
  URGENT: {
    label: "🔥 Khẩn cấp",
    cls: "bg-rose-600 text-white",
  },
  HIGH: {
    label: "⚡ Ưu tiên cao",
    cls: "bg-amber-500 text-white",
  },
  NORMAL: {
    label: "Bình thường",
    cls: "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300",
  },
};

const fmtMoney = (v: number | string | null | undefined) => {
  const n = Number(v || 0);
  return `${n.toLocaleString("vi-VN")} đ`;
};

interface EnterpriseApprovalsCenterProps {
  selectedDeptFilter?: string;
  onPendingCountChange?: (count: number) => void;
}

export const EnterpriseApprovalsCenter: React.FC<EnterpriseApprovalsCenterProps> = ({
  selectedDeptFilter = "all",
  onPendingCountChange,
}) => {
  const { showToast, notifyActivity } = useNotification();

  const [inboxTab, setInboxTab] = useState<
    "PENDING_ME" | "MY_REQUESTS" | "ALL_VISIBLE" | "COMPLETED" | "TEMPLATES"
  >("PENDING_ME");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [searchQ, setSearchQ] = useState<string>("");
  const debouncedQ = useDebouncedValue(searchQ, 300);

  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({
    pending_my_approval: 0,
    my_open_requests: 0,
    need_info_count: 0,
    approved_count: 0,
    rejected_count: 0,
    overdue_count: 0,
  });
  const [staffDirectory, setStaffDirectory] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Modal tạo mới / chỉnh sửa trình lại đề xuất
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [editingRequestId, setEditingRequestId] = useState<number | null>(null);
  const [selectedTemplateCode, setSelectedTemplateCode] = useState<string>("FIN_PAYMENT");
  const [title, setTitle] = useState<string>("");
  const [priority, setPriority] = useState<"URGENT" | "HIGH" | "NORMAL">("NORMAL");
  const [requesterDept, setRequesterDept] = useState<string>("Kinh Doanh");
  const [relatedCustomer, setRelatedCustomer] = useState<string>("");
  const [relatedRefCode, setRelatedRefCode] = useState<string>("");
  const [manualTotalAmount, setManualTotalAmount] = useState<string>("0");
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [lineItems, setLineItems] = useState<
    { description: string; unit: string; qty: string; unit_price: string; note: string }[]
  >([{ description: "", unit: "Bộ", qty: "1", unit_price: "0", note: "" }]);
  const [justification, setJustification] = useState<string>("");
  const [attachments, setAttachments] = useState<any[]>([]);
  const [stageApprovers, setStageApprovers] = useState<Record<string, string>>({});
  const [followers, setFollowers] = useState<string[]>([]);
  const [resubmitNote, setResubmitNote] = useState<string>("");

  // Modal xem chi tiết & phê duyệt
  const [selectedReq, setSelectedReq] = useState<any | null>(null);
  const [decisionNote, setDecisionNote] = useState<string>("");
  const [delegateTargetName, setDelegateTargetName] = useState<string>("");
  const [showDelegateBox, setShowDelegateBox] = useState<boolean>(false);
  const [commentInput, setCommentInput] = useState<string>("");

  // Chỉnh sửa cấu hình mẫu (dành cho BGD/Admin)
  const [configEdits, setConfigEdits] = useState<
    Record<string, { sla_hours: string; bod_threshold_amount: string }>
  >({});

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (categoryFilter !== "ALL") params.set("category", categoryFilter);
      if (debouncedQ.trim()) params.set("q", debouncedQ.trim());

      const res = await fetch(`/api/approvals?${params.toString()}`);
      if (!res.ok) throw new Error("Không tải được dữ liệu đề xuất & phê duyệt");
      const data = await res.json();
      setTemplates(data.templates || []);
      setRequests(data.requests || []);
      setSummary(data.summary || {});
      setStaffDirectory(data.staff_directory || []);
      setCurrentUser(data.current_user || null);
      if (onPendingCountChange) {
        onPendingCountChange(Number(data.summary?.pending_my_approval || 0));
      }

      // Đồng bộ lại chi tiết tờ trình đang mở (nếu có)
      setSelectedReq((prev: any) => {
        if (!prev) return null;
        return (data.requests || []).find((r: any) => r.id === prev.id) || prev;
      });
    } catch (err: any) {
      console.error("[EnterpriseApprovalsCenter] load error:", err);
      showToast(err?.message || "Lỗi tải danh sách Đề xuất & Phê duyệt", "error");
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, debouncedQ, onPendingCountChange, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Nếu người dùng không có tờ trình nào chờ mình duyệt nhưng có đề xuất của mình hoặc tất cả, tự động giữ tab hợp lý lần đầu
  const [didInitTab, setDidInitTab] = useState(false);
  useEffect(() => {
    if (!loading && !didInitTab && requests.length > 0) {
      setDidInitTab(true);
      const pendingMe = requests.filter((r) => r.can_approve_now).length;
      if (pendingMe === 0) {
        const myCount = requests.filter((r) => r.is_my_request).length;
        setInboxTab(myCount > 0 ? "MY_REQUESTS" : "ALL_VISIBLE");
      }
    }
  }, [loading, didInitTab, requests]);

  const activeTemplate = useMemo(
    () => templates.find((t) => t.code === selectedTemplateCode) || templates[0] || null,
    [templates, selectedTemplateCode]
  );

  const computedLineTotal = useMemo(() => {
    if (!activeTemplate?.has_line_items) return Number(manualTotalAmount || 0);
    const sum = lineItems.reduce((acc, it) => {
      if (!it.description.trim()) return acc;
      return acc + Math.max(0, Number(it.qty || 0)) * Math.max(0, Number(it.unit_price || 0));
    }, 0);
    return sum > 0 ? sum : Number(manualTotalAmount || 0);
  }, [activeTemplate, lineItems, manualTotalAmount]);

  /** Lấy danh sách nhân sự gợi ý theo phòng ban của từng cấp phê duyệt */
  const getStaffForStageDept = useCallback(
    (stageDept: string) => {
      const actualDept = stageDept === "REQUESTER_DEPT" ? requesterDept : stageDept;
      const matched = staffDirectory.filter((u) => isSameWorkspaceDept(u.department, actualDept));
      return matched.length > 0 ? matched : staffDirectory;
    },
    [staffDirectory, requesterDept]
  );

  const openCreateModal = (tplCode?: string) => {
    const code = tplCode || templates[0]?.code || "FIN_PAYMENT";
    const tpl = templates.find((t) => t.code === code) || templates[0];
    setEditingRequestId(null);
    setSelectedTemplateCode(code);
    setTitle("");
    setPriority("NORMAL");
    setRequesterDept(currentUser?.department || "Kinh Doanh");
    setRelatedCustomer("");
    setRelatedRefCode("");
    setManualTotalAmount("0");

    const initFields: Record<string, string> = {};
    if (tpl && Array.isArray(tpl.fields_schema)) {
      tpl.fields_schema.forEach((f: any) => {
        if (f.type === "select" && Array.isArray(f.options) && f.options[0]) {
          initFields[f.key] = f.options[0];
        } else if (f.type === "date") {
          initFields[f.key] = vnToday();
        } else {
          initFields[f.key] = "";
        }
      });
    }
    setFormData(initFields);
    setLineItems([{ description: "", unit: "Bộ", qty: "1", unit_price: "0", note: "" }]);
    setJustification("");
    setAttachments([]);
    setStageApprovers({});
    setFollowers([]);
    setResubmitNote("");
    setIsFormOpen(true);
  };

  const openEditAndResubmitModal = (reqItem: any) => {
    setEditingRequestId(reqItem.id);
    setSelectedTemplateCode(reqItem.template_code);
    setTitle(reqItem.title || "");
    setPriority(reqItem.priority || "NORMAL");
    setRequesterDept(reqItem.requester_dept || currentUser?.department || "Kinh Doanh");
    setRelatedCustomer(reqItem.related_customer || "");
    setRelatedRefCode(reqItem.related_ref_code || "");
    setManualTotalAmount(String(reqItem.total_amount || 0));
    setFormData(reqItem.form_data || {});
    const existingLines = Array.isArray(reqItem.line_items) && reqItem.line_items.length > 0
      ? reqItem.line_items.map((l: any) => ({
          description: l.description || "",
          unit: l.unit || "ĐV",
          qty: String(l.qty ?? 1),
          unit_price: String(l.unit_price ?? 0),
          note: l.note || "",
        }))
      : [{ description: "", unit: "Bộ", qty: "1", unit_price: "0", note: "" }];
    setLineItems(existingLines);
    setJustification(reqItem.justification || "");
    setAttachments(Array.isArray(reqItem.attachments) ? reqItem.attachments : []);
    const customApp: Record<string, string> = {};
    (reqItem.approval_stages || []).forEach((st: any) => {
      if (st.approver_name) customApp[String(st.stage_no)] = st.approver_name;
    });
    setStageApprovers(customApp);
    setFollowers(Array.isArray(reqItem.followers) ? reqItem.followers : []);
    setResubmitNote("Đã bổ sung đầy đủ chứng từ / giải trình theo yêu cầu của cấp duyệt.");
    setSelectedReq(null);
    setIsFormOpen(true);
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      showToast("Vui lòng nhập tiêu đề tờ trình / đề xuất.", "warning");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        action: editingRequestId ? "resubmit_request" : "create_request",
        id: editingRequestId || undefined,
        template_code: selectedTemplateCode,
        title: title.trim(),
        priority,
        requester_dept: requesterDept,
        related_customer: relatedCustomer.trim() || null,
        related_ref_code: relatedRefCode.trim() || null,
        total_amount: computedLineTotal,
        form_data: formData,
        line_items: activeTemplate?.has_line_items
          ? lineItems
              .filter((l) => l.description.trim())
              .map((l) => ({
                description: l.description.trim(),
                unit: l.unit.trim() || "ĐV",
                qty: Number(l.qty || 1),
                unit_price: Number(l.unit_price || 0),
                note: l.note.trim(),
              }))
          : [],
        justification: justification.trim(),
        attachments,
        stage_approvers: stageApprovers,
        followers,
        resubmit_note: resubmitNote.trim(),
      };

      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể gửi tờ trình đề xuất");

      showToast(
        editingRequestId
          ? `Đã trình duyệt lại tờ trình ${data.request?.request_code} thành công!`
          : `Đã khởi tạo và trình duyệt tờ trình ${data.request?.request_code} thành công!`,
        "success"
      );
      notifyActivity({
        title: editingRequestId ? "Trình duyệt lại đề xuất" : "Tờ trình đề xuất mới",
        message: `${data.request?.request_code}: ${data.request?.title}`,
        category: "WORKFLOW",
      });
      setIsFormOpen(false);
      await loadData();
      if (data.request) {
        setSelectedReq(data.request);
      }
    } catch (err: any) {
      showToast(err?.message || "Lỗi khi gửi đề xuất", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecision = async (
    actionType: "approve" | "reject" | "return_for_info" | "withdraw" | "delegate"
  ) => {
    if (!selectedReq) return;
    if (actionType === "reject" && !decisionNote.trim()) {
      showToast("Bắt buộc nhập lý do từ chối vào ô nhận xét.", "warning");
      return;
    }
    if (actionType === "return_for_info" && !decisionNote.trim()) {
      showToast("Vui lòng nhập nội dung yêu cầu bổ sung hồ sơ / giải trình.", "warning");
      return;
    }
    if (actionType === "delegate" && !delegateTargetName.trim()) {
      showToast("Vui lòng chọn cán bộ nhận ủy quyền phê duyệt.", "warning");
      return;
    }

    setSubmitting(true);
    try {
      const targetUser = staffDirectory.find((u) => u.full_name === delegateTargetName);
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: actionType,
          id: selectedReq.id,
          comment: decisionNote.trim(),
          delegate_to_name: delegateTargetName.trim(),
          delegate_to_username: targetUser?.username || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Thao tác thất bại");

      const actionLabels: Record<string, string> = {
        approve: "Đã ký phê duyệt tờ trình",
        reject: "Đã từ chối tờ trình",
        return_for_info: "Đã gửi yêu cầu bổ sung giải trình",
        withdraw: "Đã rút lại tờ trình đề xuất",
        delegate: `Đã ủy quyền duyệt sang ${delegateTargetName}`,
      };
      showToast(`${actionLabels[actionType]} (${selectedReq.request_code})!`, "success");
      setDecisionNote("");
      setShowDelegateBox(false);
      await loadData();
    } catch (err: any) {
      showToast(err?.message || "Lỗi xử lý phê duyệt", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendComment = async () => {
    if (!selectedReq || !commentInput.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_comment",
          id: selectedReq.id,
          comment: commentInput.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không gửi được bình luận");
      setCommentInput("");
      await loadData();
    } catch (err: any) {
      showToast(err?.message || "Lỗi gửi bình luận", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveTemplateConfig = async (tpl: any) => {
    const edit = configEdits[tpl.code] || {
      sla_hours: String(tpl.sla_hours ?? 24),
      bod_threshold_amount: tpl.bod_threshold_amount != null ? String(tpl.bod_threshold_amount) : "",
    };
    setSubmitting(true);
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_template_config",
          code: tpl.code,
          sla_hours: Number(edit.sla_hours || 24),
          bod_threshold_amount:
            edit.bod_threshold_amount.trim() === "" ? null : Number(edit.bod_threshold_amount),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không lưu được cấu hình mẫu");
      showToast(`Đã cập nhật hạn mức & SLA cho mẫu "${tpl.name}"!`, "success");
      await loadData();
    } catch (err: any) {
      showToast(err?.message || "Lỗi cập nhật cấu hình", "error");
    } finally {
      setSubmitting(false);
    }
  };

  // =========================================================================
  // TRÌNH THIẾT KẾ MẪU TỜ TRÌNH & LUỒNG PHÊ DUYỆT ĐỘNG (NO-CODE TEMPLATE BUILDER)
  // =========================================================================
  const [isTemplateDesignerOpen, setIsTemplateDesignerOpen] = useState(false);
  const [isEditingExistingTemplate, setIsEditingExistingTemplate] = useState(false);
  const [tplForm, setTplForm] = useState<{
    code: string;
    name: string;
    category: string;
    description: string;
    sla_hours: string;
    bod_threshold_amount: string;
    has_line_items: boolean;
    fields_schema: Array<{
      key: string;
      label: string;
      type: "text" | "textarea" | "select" | "date" | "number";
      required: boolean;
      placeholder?: string;
      optionsText?: string;
    }>;
    default_stages: Array<{
      stage_no: number;
      stage_name: string;
      dept: string;
      conditional_on_threshold: boolean;
    }>;
  }>({
    code: "",
    name: "",
    category: "GENERAL",
    description: "",
    sla_hours: "24",
    bod_threshold_amount: "15000000",
    has_line_items: false,
    fields_schema: [
      {
        key: "noi_dung_chinh",
        label: "Nội dung / Mục đích đề xuất",
        type: "text",
        required: true,
        placeholder: "Nhập nội dung chính...",
      },
    ],
    default_stages: [
      {
        stage_no: 1,
        stage_name: "Trưởng bộ phận xem xét & xác nhận nhu cầu",
        dept: "REQUESTER_DEPT",
        conditional_on_threshold: false,
      },
      {
        stage_no: 2,
        stage_name: "Ban Giám Đốc phê duyệt",
        dept: "Ban Giám Đốc",
        conditional_on_threshold: false,
      },
    ],
  });

  const openNewTemplateDesigner = () => {
    setIsEditingExistingTemplate(false);
    setTplForm({
      code: `TPL_${Date.now().toString().slice(-4)}`,
      name: "",
      category: "GENERAL",
      description: "",
      sla_hours: "24",
      bod_threshold_amount: "15000000",
      has_line_items: true,
      fields_schema: [
        {
          key: "muc_dich_su_dung",
          label: "Mục đích / Phạm vi áp dụng",
          type: "text",
          required: true,
          placeholder: "Nhập mục đích cụ thể...",
        },
        {
          key: "ngay_can_hoan_thanh",
          label: "Ngày cần áp dụng / hoàn thành",
          type: "date",
          required: true,
        },
      ],
      default_stages: [
        {
          stage_no: 1,
          stage_name: "Trưởng bộ phận trực tiếp xác nhận",
          dept: "REQUESTER_DEPT",
          conditional_on_threshold: false,
        },
        {
          stage_no: 2,
          stage_name: "Phòng chuyên môn thẩm định (Kế toán / Cung ứng / QA)",
          dept: "Kế Toán",
          conditional_on_threshold: false,
        },
        {
          stage_no: 3,
          stage_name: "Ban Giám Đốc phê duyệt chủ trương",
          dept: "Ban Giám Đốc",
          conditional_on_threshold: true,
        },
      ],
    });
    setIsTemplateDesignerOpen(true);
  };

  const openEditTemplateDesigner = (tpl: any, isClone = false) => {
    setIsEditingExistingTemplate(!isClone);
    const existingFields = Array.isArray(tpl.fields_schema) ? tpl.fields_schema : [];
    const existingStages = Array.isArray(tpl.default_stages) ? tpl.default_stages : [];
    setTplForm({
      code: isClone ? `${tpl.code}_COPY` : tpl.code,
      name: isClone ? `${tpl.name} (Bản sao)` : tpl.name,
      category: tpl.category || "GENERAL",
      description: tpl.description || "",
      sla_hours: String(tpl.sla_hours ?? 24),
      bod_threshold_amount: tpl.bod_threshold_amount != null ? String(tpl.bod_threshold_amount) : "",
      has_line_items: Boolean(tpl.has_line_items),
      fields_schema: existingFields.map((f: any, idx: number) => ({
        key: f.key || `field_${idx + 1}`,
        label: f.label || "",
        type: f.type || "text",
        required: Boolean(f.required),
        placeholder: f.placeholder || "",
        optionsText: Array.isArray(f.options) ? f.options.join(", ") : "",
      })),
      default_stages: existingStages.map((s: any, idx: number) => ({
        stage_no: idx + 1,
        stage_name: s.stage_name || `Phê duyệt Cấp ${idx + 1}`,
        dept: s.dept || "REQUESTER_DEPT",
        conditional_on_threshold: Boolean(s.conditional_on_threshold),
      })),
    });
    setIsTemplateDesignerOpen(true);
  };

  const handleSaveDesignedTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tplForm.name.trim() || !tplForm.code.trim()) {
      showToast("Vui lòng nhập Mã mẫu và Tên mẫu phê duyệt!", "warning");
      return;
    }
    if (tplForm.default_stages.length === 0) {
      showToast("Vui lòng thiết lập ít nhất 1 cấp phê duyệt!", "warning");
      return;
    }
    setSubmitting(true);
    try {
      const cleanedFields = tplForm.fields_schema
        .filter((f) => f.label.trim() !== "")
        .map((f, idx) => {
          const slugKey =
            f.key.trim() ||
            f.label
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9]+/g, "_")
              .replace(/^_|_$/g, "") ||
            `field_${idx + 1}`;
          return {
            key: slugKey,
            label: f.label.trim(),
            type: f.type,
            required: f.required,
            placeholder: f.placeholder?.trim() || undefined,
            options:
              f.type === "select"
                ? (f.optionsText || "")
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                : undefined,
          };
        });

      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "save_template",
          code: tplForm.code.trim().toUpperCase(),
          name: tplForm.name.trim(),
          category: tplForm.category,
          description: tplForm.description.trim(),
          sla_hours: Number(tplForm.sla_hours || 24),
          bod_threshold_amount:
            tplForm.bod_threshold_amount === "" ? null : Number(tplForm.bod_threshold_amount),
          has_line_items: tplForm.has_line_items,
          fields_schema: cleanedFields,
          default_stages: tplForm.default_stages,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể lưu mẫu phê duyệt");
      showToast(
        isEditingExistingTemplate
          ? `Đã cập nhật mẫu phê duyệt "${tplForm.name}"!`
          : `Đã tạo mẫu phê duyệt mới "${tplForm.name}"!`,
        "success"
      );
      setIsTemplateDesignerOpen(false);
      await loadData();
    } catch (err: any) {
      showToast(err?.message || "Lỗi khi lưu mẫu phê duyệt", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteTemplate = async (tpl: any) => {
    if (!window.confirm(`Bạn có chắc muốn ẩn mẫu "${tpl.name}" khỏi danh sách tạo mới?`)) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "delete_template", code: tpl.code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể xóa mẫu");
      showToast(`Đã ẩn mẫu "${tpl.name}"`, "success");
      await loadData();
    } catch (err: any) {
      showToast(err?.message || "Lỗi khi ẩn mẫu", "error");
    } finally {
      setSubmitting(false);
    }
  };

  /** In Phiếu Đề Xuất & Phê Duyệt Điện Tử chuẩn ISO / Doanh nghiệp (bọc escHtml chống XSS) */
  const handlePrintRequest = (reqItem: any) => {
    const w = window.open("", "_blank", "width=960,height=780");
    if (!w) return;
    const stages = Array.isArray(reqItem.approval_stages) ? reqItem.approval_stages : [];
    const lines = Array.isArray(reqItem.line_items) ? reqItem.line_items : [];
    const fields = reqItem.form_data && typeof reqItem.form_data === "object" ? reqItem.form_data : {};
    const tpl = templates.find((t) => t.code === reqItem.template_code);
    const fieldDefs: any[] = Array.isArray(tpl?.fields_schema) ? tpl.fields_schema : [];

    const fieldsHtml = Object.entries(fields)
      .filter(([, v]) => String(v ?? "").trim() !== "")
      .map(([k, v]) => {
        const def = fieldDefs.find((f) => f.key === k);
        return `<tr>
          <td style="padding:6px 10px;border:1px solid #cbd5e1;font-weight:600;width:35%;background:#f8fafc;">${escHtml(
            def?.label || k
          )}</td>
          <td style="padding:6px 10px;border:1px solid #cbd5e1;">${escHtml(v)}</td>
        </tr>`;
      })
      .join("");

    const linesHtml = lines
      .map(
        (l: any, idx: number) => `<tr>
          <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:center;">${idx + 1}</td>
          <td style="padding:6px 8px;border:1px solid #cbd5e1;">${escHtml(l.description)}</td>
          <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:center;">${escHtml(l.unit)}</td>
          <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:right;">${escHtml(l.qty)}</td>
          <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:right;">${escHtml(
            fmtMoney(l.unit_price)
          )}</td>
          <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:right;font-weight:700;">${escHtml(
            fmtMoney(l.amount)
          )}</td>
          <td style="padding:6px 8px;border:1px solid #cbd5e1;">${escHtml(l.note || "")}</td>
        </tr>`
      )
      .join("");

    const stagesHtml = stages
      .map(
        (s: any) => `<div style="flex:1;min-width:200px;border:1px solid #94a3b8;border-radius:8px;padding:10px;text-align:center;background:${
          s.status === "APPROVED" ? "#f0fdf4" : s.status === "REJECTED" ? "#fef2f2" : "#f8fafc"
        }">
          <div style="font-size:11px;font-weight:700;color:#334155;text-transform:uppercase;">CẤP ${escHtml(
            s.stage_no
          )}: ${escHtml(s.dept)}</div>
          <div style="font-size:11px;color:#475569;margin-top:2px;">${escHtml(s.stage_name)}</div>
          <div style="margin:12px 0;font-size:12px;font-weight:800;color:${
            s.status === "APPROVED" ? "#15803d" : s.status === "REJECTED" ? "#b91c1c" : "#64748b"
          }">
            ${
              s.status === "APPROVED"
                ? `✔ ĐÃ KÝ DUYỆT (${escHtml(s.signature_hash || "E-SIGN")})`
                : s.status === "REJECTED"
                  ? "✖ ĐÃ TỪ CHỐI"
                  : s.status === "SKIPPED"
                    ? "⏭ MIỄN THEO HẠN MỨC"
                    : "⏳ CHỜ PHÊ DUYỆT"
            }
          </div>
          <div style="font-size:12px;font-weight:700;">${escHtml(s.acted_by || s.approver_name || "—")}</div>
          <div style="font-size:10px;color:#64748b;">${escHtml(s.acted_at || "")}</div>
          ${s.comment ? `<div style="font-size:10px;font-style:italic;margin-top:4px;color:#334155;">"${escHtml(s.comment)}"</div>` : ""}
        </div>`
      )
      .join("");

    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Tờ Trình Phê Duyệt — ${escHtml(
      reqItem.request_code
    )}</title>
      <style>body{font-family:'Segoe UI',Arial,sans-serif;padding:24px;color:#0f172a;font-size:12px}table{width:100%;border-collapse:collapse;margin-top:8px}</style>
    </head><body>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:10px;margin-bottom:14px">
        <div>
          <h2 style="margin:0;font-size:16px;">CÔNG TY TNHH GIẢI PHÁP Y SINH ABT (ABT BIOLOGICAL SOLUTIONS)</h2>
          <div style="font-size:12px;color:#334155;margin-top:2px;">HỆ THỐNG TỜ TRÌNH ĐỀ XUẤT &amp; PHÊ DUYỆT ĐIỆN TỬ (E-APPROVAL)</div>
        </div>
        <div style="text-align:right;font-family:monospace;">
          <div style="font-size:14px;font-weight:800;color:#1d4ed8;">Số phiếu: ${escHtml(reqItem.request_code)}</div>
          <div style="font-size:11px;">Trạng thái: <b>${escHtml(reqItem.status)}</b></div>
        </div>
      </div>

      <h3 style="margin:0 0 8px 0;font-size:15px;text-transform:uppercase;color:#0f172a;">${escHtml(
        reqItem.template_name
      )}: ${escHtml(reqItem.title)}</h3>
      <p style="margin:4px 0;">Người đề xuất: <b>${escHtml(reqItem.requester_name)}</b> · Phòng ban: <b>${escHtml(
        reqItem.requester_dept
      )}</b> · Mức ưu tiên: <b>${escHtml(reqItem.priority)}</b> · Tổng giá trị: <b>${escHtml(
        fmtMoney(reqItem.total_amount)
      )}</b></p>
      ${
        reqItem.related_customer || reqItem.related_ref_code
          ? `<p style="margin:4px 0;">Khách hàng / Đối tác liên quan: <b>${escHtml(
              reqItem.related_customer || "—"
            )}</b> · Mã hồ sơ / PO / Lô tham chiếu: <b>${escHtml(reqItem.related_ref_code || "—")}</b></p>`
          : ""
      }

      ${fieldsHtml ? `<h4 style="margin:14px 0 4px;">I. THÔNG TIN CHI TIẾT THEO BIỂU MẪU</h4><table><tbody>${fieldsHtml}</tbody></table>` : ""}

      ${
        lines.length > 0
          ? `<h4 style="margin:14px 0 4px;">II. BẢNG KÊ CHI TIẾT HẠNG MỤC &amp; KINH PHÍ</h4>
             <table><thead><tr style="background:#f1f5f9;">
               <th style="padding:6px;border:1px solid #cbd5e1;">#</th>
               <th style="padding:6px;border:1px solid #cbd5e1;text-align:left;">Nội dung / Hạng mục</th>
               <th style="padding:6px;border:1px solid #cbd5e1;">ĐVT</th>
               <th style="padding:6px;border:1px solid #cbd5e1;text-align:right;">SL</th>
               <th style="padding:6px;border:1px solid #cbd5e1;text-align:right;">Đơn giá</th>
               <th style="padding:6px;border:1px solid #cbd5e1;text-align:right;">Thành tiền</th>
               <th style="padding:6px;border:1px solid #cbd5e1;text-align:left;">Ghi chú</th>
             </tr></thead><tbody>${linesHtml}</tbody></table>`
          : ""
      }

      <h4 style="margin:14px 0 4px;">III. CĂN CỨ &amp; LÝ DO ĐỀ XUẤT CHI TIẾT</h4>
      <div style="border:1px solid #cbd5e1;padding:10px;border-radius:6px;white-space:pre-line;">${escHtml(
        reqItem.justification || "—"
      )}</div>

      <h4 style="margin:16px 0 8px;">IV. XÁC NHẬN &amp; CHỮ KÝ SỐ CỦA CÁC CẤP PHÊ DUYỆT</h4>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">${stagesHtml}</div>
      <script>window.onload=()=>window.print();</script>
    </body></html>`);
    w.document.close();
  };

  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      if (
        selectedDeptFilter &&
        selectedDeptFilter !== "all" &&
        !isSameWorkspaceDept(r.requester_dept, selectedDeptFilter)
      ) {
        return false;
      }
      if (inboxTab === "PENDING_ME") return Boolean(r.can_approve_now);
      if (inboxTab === "MY_REQUESTS") return Boolean(r.is_my_request);
      if (inboxTab === "COMPLETED") return ["APPROVED", "REJECTED", "WITHDRAWN"].includes(r.status);
      return true;
    });
  }, [requests, selectedDeptFilter, inboxTab]);

  const requestsPage = usePaged(filteredRequests, 20);

  return (
    <div className="space-y-4">
      {/* =====================================================================
          1. BANNER TỔNG QUAN & NÚT KHỞI TẠO ĐỀ XUẤT MỚI
         ===================================================================== */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                ✍️ E-APPROVAL &amp; DYNAMIC WORKFLOW
              </span>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                Trung Tâm Đề Xuất &amp; Phê Duyệt Đa Cấp (Chuẩn Doanh Nghiệp)
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Tự động định tuyến phê duyệt đa cấp (Trưởng bộ phận ➔ Kế toán / Pháp chế / QA/QC / Cung ứng ➔ Ban Giám Đốc) theo ngưỡng hạn mức, hỗ trợ yêu cầu bổ sung giải trình, ủy quyền duyệt và ký số điện tử.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => openCreateModal()}
              title="Lập tờ trình đề xuất mới theo biểu mẫu động chuẩn hóa"
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-extrabold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm shadow-indigo-500/20 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>📝 Lập Đề Xuất / Tờ Trình</span>
            </button>
          </div>
        </div>

        {/* 5 Thẻ chỉ số nhanh (KPI Cards) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 pt-1">
          <div
            onClick={() => setInboxTab("PENDING_ME")}
            className={`p-3 rounded-xl border cursor-pointer transition-all ${
              inboxTab === "PENDING_ME"
                ? "border-amber-500 bg-amber-50/90 dark:bg-amber-950/40 ring-2 ring-amber-500/20"
                : "border-amber-200/80 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20 hover:bg-amber-50"
            }`}
          >
            <div className="text-[11px] font-bold text-amber-800 dark:text-amber-300 flex items-center justify-between">
              <span>📥 Cần tôi phê duyệt</span>
              <Clock className="w-3.5 h-3.5 text-amber-600" />
            </div>
            <div className="text-xl font-extrabold text-amber-900 dark:text-amber-200 mt-1">
              {summary.pending_my_approval || 0}{" "}
              <span className="text-xs font-semibold">tờ trình</span>
            </div>
          </div>

          <div
            onClick={() => setInboxTab("MY_REQUESTS")}
            className={`p-3 rounded-xl border cursor-pointer transition-all ${
              inboxTab === "MY_REQUESTS"
                ? "border-indigo-500 bg-indigo-50/90 dark:bg-indigo-950/40 ring-2 ring-indigo-500/20"
                : "border-indigo-200/80 dark:border-indigo-900/50 bg-indigo-50/40 dark:bg-indigo-950/20 hover:bg-indigo-50"
            }`}
          >
            <div className="text-[11px] font-bold text-indigo-800 dark:text-indigo-300 flex items-center justify-between">
              <span>📤 Đề xuất của tôi đang chạy</span>
              <Send className="w-3.5 h-3.5 text-indigo-600" />
            </div>
            <div className="text-xl font-extrabold text-indigo-900 dark:text-indigo-200 mt-1">
              {summary.my_open_requests || 0}{" "}
              <span className="text-xs font-semibold">đang trình</span>
            </div>
          </div>

          <div
            onClick={() => setInboxTab("MY_REQUESTS")}
            className="p-3 rounded-xl border border-orange-200/80 dark:border-orange-900/50 bg-orange-50/40 dark:bg-orange-950/20 cursor-pointer hover:bg-orange-50 transition-all"
          >
            <div className="text-[11px] font-bold text-orange-800 dark:text-orange-300 flex items-center justify-between">
              <span>⚠️ Cần bổ sung giải trình</span>
              <AlertTriangle className="w-3.5 h-3.5 text-orange-600" />
            </div>
            <div className="text-xl font-extrabold text-orange-900 dark:text-orange-200 mt-1">
              {summary.need_info_count || 0}{" "}
              <span className="text-xs font-semibold">cần phản hồi</span>
            </div>
          </div>

          <div
            onClick={() => setInboxTab("COMPLETED")}
            className={`p-3 rounded-xl border cursor-pointer transition-all ${
              inboxTab === "COMPLETED"
                ? "border-emerald-500 bg-emerald-50/90 dark:bg-emerald-950/40 ring-2 ring-emerald-500/20"
                : "border-emerald-200/80 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/20 hover:bg-emerald-50"
            }`}
          >
            <div className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
              <span>✅ Đã phê duyệt ban hành</span>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <div className="text-xl font-extrabold text-emerald-900 dark:text-emerald-200 mt-1">
              {summary.approved_count || 0}{" "}
              <span className="text-xs font-semibold">hoàn tất</span>
            </div>
          </div>

          <div
            onClick={() => setInboxTab("ALL_VISIBLE")}
            className={`p-3 rounded-xl border cursor-pointer transition-all ${
              inboxTab === "ALL_VISIBLE"
                ? "border-rose-500 bg-rose-50/90 dark:bg-rose-950/40 ring-2 ring-rose-500/20"
                : "border-rose-200/80 dark:border-rose-900/50 bg-rose-50/40 dark:bg-rose-950/20 hover:bg-rose-50"
            }`}
          >
            <div className="text-[11px] font-bold text-rose-800 dark:text-rose-300 flex items-center justify-between">
              <span>⏰ Cảnh báo quá hạn SLA</span>
              <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
            </div>
            <div className="text-xl font-extrabold text-rose-900 dark:text-rose-200 mt-1">
              {summary.overdue_count || 0}{" "}
              <span className="text-xs font-semibold">quá hạn</span>
            </div>
          </div>
        </div>

        {/* Thanh chuyển chế độ Hộp thư Phê duyệt & Bộ lọc nhóm nghiệp vụ */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              {
                id: "PENDING_ME" as const,
                label: `📥 Cần tôi duyệt (${summary.pending_my_approval || 0})`,
              },
              {
                id: "MY_REQUESTS" as const,
                label: `📤 Đề xuất của tôi (${requests.filter((r) => r.is_my_request).length})`,
              },
              {
                id: "ALL_VISIBLE" as const,
                label: `🏢 Toàn bộ đề xuất (${requests.length})`,
              },
              {
                id: "COMPLETED" as const,
                label: `✅ Đã xử lý (${
                  requests.filter((r) => ["APPROVED", "REJECTED", "WITHDRAWN"].includes(r.status)).length
                })`,
              },
              {
                id: "TEMPLATES" as const,
                label: `📂 Danh mục Mẫu & Luồng duyệt (${templates.length})`,
              },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setInboxTab(t.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  inboxTab === t.id
                    ? "bg-indigo-600 text-white shadow-2xs"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-200"
            >
              <option value="ALL">Mọi nhóm nghiệp vụ (6 nhóm)</option>
              {Object.entries(CATEGORY_META).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>

            <div className="relative min-w-[220px]">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Tìm mã DX, tiêu đề, người trình, KH..."
                className="w-full pl-8 pr-3 py-1.5 rounded-xl text-xs border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================================
          2. CHẾ ĐỘ XEM DANH SÁCH MẪU & MA TRẬN HẠN MỨC PHÊ DUYỆT (TEMPLATES LIST)
         ===================================================================== */}
      {inboxTab === "TEMPLATES" ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
          {/* Header thanh tiêu đề Danh sách Mẫu & Nút Tạo Mẫu Mới */}
          <div className="px-4 py-3 bg-slate-50/80 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div>
              <div className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <span>📋 Danh Sách Mẫu Tờ Trình &amp; Quy Trình Phê Duyệt Chuẩn Hóa</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                  {templates.length} mẫu đang hoạt động
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Nhấp trực tiếp vào bất kỳ dòng mẫu nào để <b>Xem chi tiết cấu trúc câu hỏi, luồng các cấp duyệt hoặc Chỉnh sửa hạn mức</b>.
              </p>
            </div>
            <button
              type="button"
              onClick={openNewTemplateDesigner}
              title="Tạo một mẫu tờ trình phê duyệt mới với các trường thông tin và các cấp duyệt tùy chỉnh"
              className="px-3.5 py-2 rounded-xl text-xs font-extrabold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs shrink-0 cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Thiết Kế Mẫu Phê Duyệt Mới</span>
            </button>
          </div>

          {/* Header Cột Bảng Danh Sách (Desktop) */}
          <div className="hidden lg:grid lg:grid-cols-12 gap-3 px-4 py-2 bg-slate-100/70 dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">
            <div className="col-span-4">Tên Mẫu Đề Xuất &amp; Nhóm Nghiệp Vụ</div>
            <div className="col-span-4">Luồng Định Tuyến Phê Duyệt Tự Động</div>
            <div className="col-span-2">Cam Kết SLA &amp; Hạn Mức BGĐ</div>
            <div className="col-span-2 text-right">Thao Tác</div>
          </div>

          {/* Danh sách từng dòng mẫu phê duyệt */}
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {templates
              .filter((tpl) => {
                if (categoryFilter !== "ALL" && tpl.category !== categoryFilter) return false;
                if (debouncedQ.trim()) {
                  const q = debouncedQ.toLowerCase();
                  return (
                    String(tpl.name || "").toLowerCase().includes(q) ||
                    String(tpl.code || "").toLowerCase().includes(q) ||
                    String(tpl.description || "").toLowerCase().includes(q)
                  );
                }
                return true;
              })
              .map((tpl) => {
                const cat = CATEGORY_META[tpl.category] || CATEGORY_META.GENERAL;
                const stages: any[] = Array.isArray(tpl.default_stages) ? tpl.default_stages : [];
                const fieldsCount = Array.isArray(tpl.fields_schema) ? tpl.fields_schema.length : 0;
                const thresholdVal = Number(tpl.bod_threshold_amount || 0);

                return (
                  <div
                    key={tpl.code}
                    onClick={() => openEditTemplateDesigner(tpl, false)}
                    title="Nhấp vào dòng này để xem chi tiết hoặc chỉnh sửa cấu trúc mẫu & luồng phê duyệt"
                    className="px-4 py-3 hover:bg-indigo-50/40 dark:hover:bg-slate-800/60 transition-colors cursor-pointer grid grid-cols-1 lg:grid-cols-12 gap-3 items-center text-xs"
                  >
                    {/* Cột 1 (4 cols): Tên mẫu, Nhóm, Mã & Cấu trúc trường */}
                    <div className="lg:col-span-4 space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${cat.badgeCls}`}>
                          {cat.label}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-500">
                          {tpl.code}
                        </span>
                        <span className="text-[10px] font-semibold text-slate-500">
                          • {fieldsCount} trường nhập {tpl.has_line_items ? "+ Bảng kê" : ""}
                        </span>
                      </div>
                      <div className="text-sm font-extrabold text-slate-900 dark:text-white truncate group-hover:text-indigo-600">
                        {tpl.name}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">
                        {tpl.description}
                      </div>
                    </div>

                    {/* Cột 2 (4 cols): Chuỗi các cấp phê duyệt */}
                    <div className="lg:col-span-4 flex flex-wrap items-center gap-1">
                      {stages.map((st, idx) => (
                        <React.Fragment key={st.stage_no}>
                          <span
                            title={`Cấp ${st.stage_no}: ${st.stage_name}`}
                            className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200"
                          >
                            <b className="text-indigo-600 dark:text-indigo-400">Cấp {st.stage_no}:</b>{" "}
                            {st.dept === "REQUESTER_DEPT" ? "Trưởng bộ phận" : st.dept}
                          </span>
                          {idx < stages.length - 1 && (
                            <span className="text-slate-300 dark:text-slate-600 text-[10px]">➔</span>
                          )}
                        </React.Fragment>
                      ))}
                    </div>

                    {/* Cột 3 (2 cols): SLA & Ngưỡng trình BGĐ */}
                    <div className="lg:col-span-2 space-y-0.5 text-[11px]">
                      <div className="text-slate-600 dark:text-slate-300">
                        SLA xử lý: <b className="font-mono text-slate-900 dark:text-white">{tpl.sla_hours} giờ</b>
                      </div>
                      <div className="text-slate-500 dark:text-slate-400">
                        Trình BGĐ:{" "}
                        <b className="font-mono text-emerald-700 dark:text-emerald-400">
                          {thresholdVal > 0 ? `Từ ${fmtMoney(thresholdVal)}` : "Luôn trình BGĐ"}
                        </b>
                      </div>
                    </div>

                    {/* Cột 4 (2 cols): Nút thao tác nhanh */}
                    <div
                      className="lg:col-span-2 flex items-center lg:justify-end gap-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => openEditTemplateDesigner(tpl, false)}
                        title="Xem chi tiết cấu trúc câu hỏi và chỉnh sửa luồng phê duyệt của mẫu này"
                        className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-[11px] cursor-pointer"
                      >
                        ✏️ Chi tiết / Sửa
                      </button>
                      <button
                        type="button"
                        onClick={() => openCreateModal(tpl.code)}
                        title="Mở biểu mẫu để lập tờ trình đề xuất mới theo mẫu này"
                        className="px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] cursor-pointer shrink-0"
                      >
                        + Lập tờ trình
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      ) : (
        /* =====================================================================
           3. DANH SÁCH TỜ TRÌNH ĐỀ XUẤT & TIẾN ĐỘ CÁC CẤP DUYỆT
           ===================================================================== */
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">
              Đang tải danh sách tờ trình đề xuất &amp; phê duyệt...
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <div className="text-sm font-bold text-slate-700 dark:text-slate-300">
                {inboxTab === "PENDING_ME"
                  ? "🎉 Tuyệt vời! Hiện không có tờ trình nào đang chờ bạn phê duyệt."
                  : "Chưa có tờ trình đề xuất nào trong danh mục này."}
              </div>
              <p className="text-xs text-slate-500">
                Bấm nút <b>&ldquo;+ Tạo Đề Xuất / Tờ Trình Mới&rdquo;</b> ở góc phải phía trên để lập đề nghị thanh toán, tạm ứng, mua sắm, duyệt giá/chiết khấu hoặc tờ trình kỹ thuật.
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => openCreateModal()}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                >
                  + Tạo Đề Xuất / Tờ Trình Ngay
                </button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {requestsPage.items.map((r) => {
                const cat = CATEGORY_META[r.category] || CATEGORY_META.GENERAL;
                const st = STATUS_META[r.status] || STATUS_META.PENDING;
                const pri = PRIORITY_META[r.priority] || PRIORITY_META.NORMAL;
                const stages: any[] = Array.isArray(r.approval_stages) ? r.approval_stages : [];

                return (
                  <div
                    key={r.id}
                    onClick={() => {
                      setSelectedReq(r);
                      setDecisionNote("");
                      setShowDelegateBox(false);
                    }}
                    className={`p-3.5 sm:p-4 hover:bg-slate-50/90 dark:hover:bg-slate-800/50 transition-colors cursor-pointer flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${
                      r.can_approve_now
                        ? "bg-amber-50/30 dark:bg-amber-950/15"
                        : r.status === "NEED_INFO" && r.is_my_request
                          ? "bg-orange-50/40 dark:bg-orange-950/20"
                          : ""
                    }`}
                  >
                    {/* Cột trái: Thông tin chính của tờ trình */}
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs font-extrabold text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-md border border-indigo-200 dark:border-indigo-800">
                          {r.request_code}
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${cat.badgeCls}`}>
                          {r.template_name}
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${pri.cls}`}>
                          {pri.label}
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold border ${st.cls}`}>
                          {st.label}
                        </span>
                        {r.is_overdue && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-rose-600 text-white animate-pulse">
                            ⏰ Quá hạn SLA
                          </span>
                        )}
                      </div>

                      <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                        {r.title}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
                        <span>
                          Người trình: <b className="text-slate-800 dark:text-slate-200">{r.requester_name}</b> ({r.requester_dept})
                        </span>
                        {Number(r.total_amount) > 0 && (
                          <span>
                            Giá trị đề xuất:{" "}
                            <b className="font-mono text-emerald-700 dark:text-emerald-400">
                              {fmtMoney(r.total_amount)}
                            </b>
                          </span>
                        )}
                        {r.related_customer && (
                          <span>
                            Đơn vị / KH: <b>{r.related_customer}</b>
                          </span>
                        )}
                        {r.related_ref_code && (
                          <span>
                            Mã tham chiếu: <b className="font-mono">{r.related_ref_code}</b>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Cột phải: Stepper các cấp duyệt trực quan & Nút hành động nhanh */}
                    <div className="flex flex-col sm:flex-row lg:flex-col items-start sm:items-center lg:items-end justify-between gap-2 shrink-0">
                      <div className="flex flex-wrap items-center gap-1">
                        {stages.map((s, idx) => {
                          const isCurr =
                            Number(s.stage_no) === Number(r.current_stage_no) &&
                            ["PENDING", "IN_REVIEW"].includes(r.status);
                          const badgeColor =
                            s.status === "APPROVED"
                              ? "bg-emerald-600 text-white"
                              : s.status === "REJECTED"
                                ? "bg-rose-600 text-white"
                                : s.status === "RETURNED"
                                  ? "bg-orange-500 text-white"
                                  : s.status === "SKIPPED"
                                    ? "bg-slate-200 dark:bg-slate-800 text-slate-400 line-through"
                                    : isCurr
                                      ? "bg-amber-500 text-white ring-2 ring-amber-400/50"
                                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400";
                          return (
                            <React.Fragment key={s.stage_no}>
                              <span
                                title={`Cấp ${s.stage_no} (${s.dept}): ${s.stage_name} — Người duyệt: ${
                                  s.acted_by || s.approver_name
                                }`}
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${badgeColor}`}
                              >
                                Cấp {s.stage_no}: {s.dept}
                                {s.status === "APPROVED" ? " ✓" : isCurr ? " ⏳" : ""}
                              </span>
                              {idx < stages.length - 1 && (
                                <span className="text-slate-300 dark:text-slate-600 text-[10px]">➔</span>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>

                      <div className="flex items-center gap-2">
                        {r.can_approve_now && (
                          <span className="px-2.5 py-1 rounded-lg bg-amber-500 text-white text-[11px] font-extrabold shadow-2xs">
                            ✍️ Đến lượt bạn ký duyệt (Cấp {r.current_stage_no})
                          </span>
                        )}
                        {r.status === "NEED_INFO" && r.is_my_request && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditAndResubmitModal(r);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-[11px] font-extrabold cursor-pointer"
                          >
                            ✏️ Bổ sung &amp; Trình lại ngay
                          </button>
                        )}
                        <button
                          type="button"
                          className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer flex items-center gap-1"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Chi tiết</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {!loading && filteredRequests.length > 0 && (
            <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/40">
              <Pager p={requestsPage} unit="tờ trình / đề xuất" />
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          4. MODAL KHỞI TẠO / CHỈNH SỬA & TRÌNH LẠI TỜ TRÌNH ĐỀ XUẤT
         ===================================================================== */}
      <Modal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={
          editingRequestId
            ? "✏️ Cập Nhật Giải Trình & Trình Duyệt Lại Đề Xuất"
            : "✍️ Khởi Tạo Tờ Trình Đề Xuất & Phê Duyệt Điện Tử"
        }
        size="4xl"
      >
        <form onSubmit={handleSubmitForm} className="space-y-4 text-xs">
          {/* Chọn Mẫu Tờ Trình */}
          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
              1. Chọn Loại Tờ Trình / Biểu Mẫu Đề Xuất Chuẩn Hóa *
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {templates.map((t) => {
                const isSel = t.code === selectedTemplateCode;
                return (
                  <button
                    key={t.code}
                    type="button"
                    disabled={Boolean(editingRequestId)}
                    onClick={() => {
                      setSelectedTemplateCode(t.code);
                      const nextFields: Record<string, string> = {};
                      (t.fields_schema || []).forEach((f: any) => {
                        nextFields[f.key] =
                          f.type === "select" && f.options?.[0]
                            ? f.options[0]
                            : f.type === "date"
                              ? vnToday()
                              : "";
                      });
                      setFormData(nextFields);
                    }}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      isSel
                        ? "border-indigo-600 bg-indigo-50/90 dark:bg-indigo-950/60 ring-2 ring-indigo-500/20"
                        : "border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50 hover:bg-slate-100"
                    }`}
                  >
                    <div className="font-extrabold text-slate-900 dark:text-white line-clamp-1">
                      {t.name}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      SLA: {t.sla_hours}h ·{" "}
                      {t.bod_threshold_amount === 0
                        ? "Luôn trình BGD"
                        : t.bod_threshold_amount
                          ? `BGD từ ${fmtMoney(t.bod_threshold_amount)}`
                          : "Theo phân cấp"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Thông tin chung của tờ trình */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
            <div className="sm:col-span-6">
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Tiêu đề Tờ trình / Đề xuất (Tóm tắt ngắn gọn) *
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="VD: Đề nghị thanh toán tiền mua hóa chất Primer/Probe đợt 2 tháng 10/2026..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold"
              />
            </div>

            <div className="sm:col-span-3">
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Phòng ban đề xuất *
              </label>
              <input
                type="text"
                value={requesterDept}
                onChange={(e) => setRequesterDept(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold"
              />
            </div>

            <div className="sm:col-span-3">
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Mức độ khẩn cấp *
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold"
              >
                <option value="NORMAL">Bình thường (Theo SLA chuẩn)</option>
                <option value="HIGH">⚡ Ưu tiên cao (Cần xử lý trong ngày)</option>
                <option value="URGENT">🔥 Khẩn cấp (Ưu tiên số 1)</option>
              </select>
            </div>

            <div className="sm:col-span-4">
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Khách hàng / Bệnh viện / Nhà cung cấp liên quan
              </label>
              <input
                type="text"
                value={relatedCustomer}
                onChange={(e) => setRelatedCustomer(e.target.value)}
                placeholder="VD: Bệnh viện Chợ Rẫy / NCC IDT..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>

            <div className="sm:col-span-4">
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Mã Đơn hàng / Báo giá / PO / Lô SX tham chiếu
              </label>
              <input
                type="text"
                value={relatedRefCode}
                onChange={(e) => setRelatedRefCode(e.target.value)}
                placeholder="VD: PO-2610-0012 / LSX-KIT-2610-01"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
              />
            </div>

            <div className="sm:col-span-4">
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Tổng giá trị đề xuất (VNĐ — Tự tính nếu có bảng kê)
              </label>
              <input
                type="number"
                min={0}
                value={activeTemplate?.has_line_items ? computedLineTotal : manualTotalAmount}
                onChange={(e) => setManualTotalAmount(e.target.value)}
                disabled={Boolean(
                  activeTemplate?.has_line_items &&
                    lineItems.some((l) => l.description.trim() && Number(l.unit_price) > 0)
                )}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold text-emerald-700 dark:text-emerald-400"
              />
            </div>
          </div>

          {/* Các trường dữ liệu chuyên biệt theo Mẫu (Dynamic Fields) */}
          {activeTemplate &&
            Array.isArray(activeTemplate.fields_schema) &&
            activeTemplate.fields_schema.length > 0 && (
              <div className="p-3.5 rounded-xl border border-indigo-200/80 dark:border-indigo-900/60 bg-indigo-50/30 dark:bg-indigo-950/20 space-y-3">
                <div className="font-extrabold text-indigo-900 dark:text-indigo-300">
                  2. Thông tin chuyên biệt của mẫu &ldquo;{activeTemplate.name}&rdquo;
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {activeTemplate.fields_schema.map((field: any) => (
                    <div
                      key={field.key}
                      className={field.type === "textarea" ? "sm:col-span-2" : ""}
                    >
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                        {field.label} {field.required && <span className="text-rose-500">*</span>}
                      </label>
                      {field.type === "select" ? (
                        <select
                          required={field.required}
                          value={formData[field.key] || ""}
                          onChange={(e) =>
                            setFormData((prev) => ({ ...prev, [field.key]: e.target.value }))
                          }
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                        >
                          {(field.options || []).map((opt: string) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : field.type === "textarea" ? (
                        <textarea
                          rows={2}
                          required={field.required}
                          placeholder={field.placeholder || ""}
                          value={formData[field.key] || ""}
                          onChange={(e) =>
                            setFormData((prev) => ({ ...prev, [field.key]: e.target.value }))
                          }
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      ) : (
                        <input
                          type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
                          required={field.required}
                          placeholder={field.placeholder || ""}
                          value={formData[field.key] || ""}
                          onChange={(e) =>
                            setFormData((prev) => ({ ...prev, [field.key]: e.target.value }))
                          }
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

          {/* Bảng kê chi tiết hạng mục (nếu mẫu có has_line_items) */}
          {activeTemplate?.has_line_items && (
            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-slate-800 dark:text-slate-200">
                  3. Bảng kê chi tiết Hạng mục / Vật tư / Chi phí đề xuất
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setLineItems((prev) => [
                      ...prev,
                      { description: "", unit: "ĐV", qty: "1", unit_price: "0", note: "" },
                    ])
                  }
                  className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold hover:bg-indigo-100 cursor-pointer"
                >
                  + Thêm dòng hạng mục
                </button>
              </div>

              <div className="space-y-2">
                {lineItems.map((line, idx) => {
                  const rowAmt =
                    Math.max(0, Number(line.qty || 0)) * Math.max(0, Number(line.unit_price || 0));
                  return (
                    <div
                      key={idx}
                      className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-slate-50 dark:bg-slate-950/50 p-2 rounded-xl border border-slate-200/70 dark:border-slate-800"
                    >
                      <div className="sm:col-span-4">
                        <input
                          type="text"
                          placeholder={`#${idx + 1} Tên hạng mục / vật tư / nội dung chi...`}
                          value={line.description}
                          onChange={(e) =>
                            setLineItems((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x))
                            )
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      </div>
                      <div className="sm:col-span-1">
                        <input
                          type="text"
                          placeholder="ĐVT"
                          value={line.unit}
                          onChange={(e) =>
                            setLineItems((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x))
                            )
                          }
                          className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-center"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <input
                          type="number"
                          step="any"
                          min={0}
                          placeholder="Số lượng"
                          value={line.qty}
                          onChange={(e) =>
                            setLineItems((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x))
                            )
                          }
                          className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-right font-mono"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <input
                          type="number"
                          step="any"
                          min={0}
                          placeholder="Đơn giá (VNĐ)"
                          value={line.unit_price}
                          onChange={(e) =>
                            setLineItems((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, unit_price: e.target.value } : x))
                            )
                          }
                          className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-right font-mono"
                        />
                      </div>
                      <div className="sm:col-span-2 font-mono font-bold text-right text-emerald-700 dark:text-emerald-400 px-1">
                        {fmtMoney(rowAmt)}
                      </div>
                      <div className="sm:col-span-1 flex justify-end">
                        {lineItems.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setLineItems((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg cursor-pointer"
                            title="Xóa dòng"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end pt-1 text-xs font-extrabold text-slate-800 dark:text-slate-200">
                Tổng cộng bảng kê:{" "}
                <span className="ml-2 font-mono text-emerald-700 dark:text-emerald-400">
                  {fmtMoney(computedLineTotal)}
                </span>
              </div>
            </div>
          )}

          {/* Lý do / Căn cứ đề xuất & Tài liệu đính kèm */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-7">
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                4. Căn cứ, Lý do đề xuất &amp; Giải trình chi tiết *
              </label>
              <textarea
                rows={3}
                required
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Trình bày rõ mục đích, căn cứ thực tế, lợi ích mang lại hoặc rủi ro nếu chậm trễ..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>

            <div className="sm:col-span-5">
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                5. Hồ sơ, Báo giá, Hóa đơn, Hợp đồng đính kèm
              </label>
              <div className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/50">
                <AttachmentPicker
                  files={attachments}
                  onChange={setAttachments}
                  label="Đính kèm chứng từ / báo giá"
                />
              </div>
            </div>
          </div>

          {/* Xem trước Luồng Phê Duyệt Đa Cấp & Chọn Người Duyệt Thực Tế */}
          {activeTemplate && Array.isArray(activeTemplate.default_stages) && (
            <div className="p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-extrabold text-emerald-950 dark:text-emerald-200">
                  6. Luồng Phê Duyệt Tự Động &amp; Phân Công Người Duyệt Thực Tế (Lấy từ Danh sách Nhân sự theo Phòng)
                </span>
                <span className="text-[11px] text-emerald-800 dark:text-emerald-300">
                  Để trống hệ thống sẽ tự động gán Trưởng bộ phận của phòng tương ứng
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {activeTemplate.default_stages.map((st: any) => {
                  const actualDept = st.dept === "REQUESTER_DEPT" ? requesterDept : st.dept;
                  const threshold =
                    activeTemplate.bod_threshold_amount != null
                      ? Number(activeTemplate.bod_threshold_amount)
                      : null;
                  const willAutoSkip =
                    Boolean(st.conditional_on_threshold) &&
                    threshold !== null &&
                    threshold > 0 &&
                    computedLineTotal < threshold;
                  const staffOpts = getStaffForStageDept(st.dept);

                  return (
                    <div
                      key={st.stage_no}
                      className={`p-2.5 rounded-xl border ${
                        willAutoSkip
                          ? "border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-900/40 opacity-75"
                          : "border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-extrabold text-slate-900 dark:text-white">
                          Cấp {st.stage_no}: {actualDept}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                            willAutoSkip
                              ? "bg-slate-200 text-slate-600"
                              : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {willAutoSkip ? "Miễn theo hạn mức" : "Bắt buộc duyệt"}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">
                        {st.stage_name}
                      </div>
                      <input
                        list={`approver-staff-list-${st.stage_no}`}
                        disabled={willAutoSkip}
                        placeholder={`Chọn cán bộ duyệt (${actualDept})...`}
                        value={stageApprovers[String(st.stage_no)] || ""}
                        onChange={(e) =>
                          setStageApprovers((prev) => ({
                            ...prev,
                            [String(st.stage_no)]: e.target.value,
                          }))
                        }
                        className="mt-1.5 w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-semibold"
                      />
                      <datalist id={`approver-staff-list-${st.stage_no}`}>
                        {staffOpts.map((u: any) => (
                          <option key={u.id || u.username} value={u.full_name}>
                            {u.department} — {u.role}
                          </option>
                        ))}
                      </datalist>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {editingRequestId && (
            <div>
              <label className="block font-bold text-orange-700 dark:text-orange-300 mb-1">
                Nội dung phản hồi / Giải trình bổ sung gửi lại cấp phê duyệt *
              </label>
              <input
                type="text"
                required
                value={resubmitNote}
                onChange={(e) => setResubmitNote(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-orange-300 bg-orange-50/40 dark:bg-slate-900 font-semibold"
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsFormOpen(false)}
              className="px-4 py-2 rounded-xl font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-xl font-extrabold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm cursor-pointer"
            >
              {submitting
                ? "Đang gửi tờ trình..."
                : editingRequestId
                  ? "📤 Trình Duyệt Lại Ngay"
                  : "📤 Gửi Tờ Trình Phê Duyệt"}
            </button>
          </div>
        </form>
      </Modal>

      {/* =====================================================================
          5. MODAL CHI TIẾT TỜ TRÌNH & BẢNG ĐIỀU KHIỂN KÝ DUYỆT ĐA CẤP
         ===================================================================== */}
      <Modal
        isOpen={Boolean(selectedReq)}
        onClose={() => setSelectedReq(null)}
        title={
          selectedReq
            ? `Tờ trình ${selectedReq.request_code} — ${selectedReq.template_name}`
            : "Chi tiết Tờ trình"
        }
        size="4xl"
      >
        {selectedReq && (
          <div className="space-y-4 text-xs">
            {/* Header trạng thái & Nút In phiếu */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`px-2.5 py-0.5 rounded-md text-xs font-extrabold border ${
                      (STATUS_META[selectedReq.status] || STATUS_META.PENDING).cls
                    }`}
                  >
                    {(STATUS_META[selectedReq.status] || STATUS_META.PENDING).label}
                  </span>
                  <span className="font-extrabold text-sm text-slate-900 dark:text-white">
                    {selectedReq.title}
                  </span>
                </div>
                <div className="text-slate-500">
                  Người đề xuất: <b className="text-slate-800 dark:text-slate-200">{selectedReq.requester_name}</b> ({selectedReq.requester_dept}) · Tổng giá trị:{" "}
                  <b className="font-mono text-emerald-700 dark:text-emerald-400">
                    {fmtMoney(selectedReq.total_amount)}
                  </b>
                  {selectedReq.related_customer && (
                    <>
                      {" "}
                      · KH/NCC: <b>{selectedReq.related_customer}</b>
                    </>
                  )}
                  {selectedReq.related_ref_code && (
                    <>
                      {" "}
                      · Tham chiếu: <b className="font-mono">{selectedReq.related_ref_code}</b>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePrintRequest(selectedReq)}
                  title="In phiếu đề xuất kèm chữ ký điện tử các cấp"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-indigo-600" />
                  <span>🖨️ In Tờ Trình (Có Mã Ký Số)</span>
                </button>
                {selectedReq.is_my_request &&
                  ["NEED_INFO", "WITHDRAWN"].includes(selectedReq.status) && (
                    <button
                      type="button"
                      onClick={() => openEditAndResubmitModal(selectedReq)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-extrabold cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Chỉnh sửa &amp; Trình lại</span>
                    </button>
                  )}
                {selectedReq.is_my_request &&
                  ["PENDING", "IN_REVIEW"].includes(selectedReq.status) && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleDecision("withdraw")}
                      title="Rút lại tờ trình về để chỉnh sửa"
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-200 font-bold cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Rút lại đề xuất</span>
                    </button>
                  )}
              </div>
            </div>

            {/* Sơ đồ Tiến trình Phê duyệt Đa cấp (Multi-Stage Stepper) */}
            <div className="space-y-2">
              <div className="font-extrabold text-slate-800 dark:text-slate-200">
                1. Tiến trình Thẩm định &amp; Phê duyệt qua các Cấp
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {(selectedReq.approval_stages || []).map((st: any) => {
                  const isCurr =
                    Number(st.stage_no) === Number(selectedReq.current_stage_no) &&
                    ["PENDING", "IN_REVIEW"].includes(selectedReq.status);
                  const cardCls =
                    st.status === "APPROVED"
                      ? "border-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/30"
                      : st.status === "REJECTED"
                        ? "border-rose-400 bg-rose-50/60 dark:bg-rose-950/30"
                        : st.status === "RETURNED"
                          ? "border-orange-400 bg-orange-50/60 dark:bg-orange-950/30"
                          : isCurr
                            ? "border-amber-400 bg-amber-50/80 dark:bg-amber-950/40 ring-2 ring-amber-400/30"
                            : "border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40";

                  return (
                    <div key={st.stage_no} className={`p-3 rounded-xl border space-y-1 ${cardCls}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-extrabold text-slate-900 dark:text-white">
                          Cấp {st.stage_no}: {st.dept}
                        </span>
                        <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                          {st.status === "APPROVED"
                            ? "✅ ĐÃ DUYỆT"
                            : st.status === "REJECTED"
                              ? "❌ TỪ CHỐI"
                              : st.status === "RETURNED"
                                ? "⚠️ YÊU CẦU BỔ SUNG"
                                : st.status === "SKIPPED"
                                  ? "⏭ MIỄN THEO HẠN MỨC"
                                  : isCurr
                                    ? "⏳ ĐANG CHỜ DUYỆT"
                                    : "CHỜ LƯỢT"}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                        {st.stage_name}
                      </div>
                      <div className="text-[11px] text-slate-700 dark:text-slate-200 pt-1">
                        Người phụ trách: <b>{st.acted_by || st.approver_name || st.dept}</b>
                      </div>
                      {st.signature_hash && (
                        <div className="font-mono text-[10px] text-emerald-700 dark:text-emerald-400">
                          Chữ ký số: <b>{st.signature_hash}</b> ({st.acted_at})
                        </div>
                      )}
                      {st.comment && (
                        <div className="text-[11px] italic text-slate-600 dark:text-slate-300 bg-white/80 dark:bg-slate-900/80 p-1.5 rounded border border-slate-200/60 dark:border-slate-800 mt-1">
                          &ldquo;{st.comment}&rdquo;
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* HỘP HÀNH ĐỘNG PHÊ DUYỆT DÀNH CHO NGƯỜI CÓ THẨM QUYỀN Ở BƯỚC HIỆN TẠI */}
            {selectedReq.can_approve_now && (
              <div className="p-3.5 rounded-xl border-2 border-amber-400 bg-amber-50/70 dark:bg-amber-950/30 space-y-2.5">
                <div className="font-extrabold text-amber-950 dark:text-amber-200 flex items-center justify-between">
                  <span>
                    ✍️ BẢNG QUYẾT ĐỊNH PHÊ DUYỆT TẠI CẤP {selectedReq.current_stage_no} (
                    {selectedReq.current_stage?.stage_name})
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowDelegateBox((v) => !v)}
                    className="text-[11px] text-indigo-700 dark:text-indigo-300 underline cursor-pointer"
                  >
                    {showDelegateBox ? "Đóng ủy quyền" : "↪️ Ủy quyền / Chuyển người khác duyệt"}
                  </button>
                </div>

                {showDelegateBox && (
                  <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-indigo-200">
                    <span className="font-bold">Chuyển quyền duyệt bước này cho:</span>
                    <select
                      value={delegateTargetName}
                      onChange={(e) => setDelegateTargetName(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-semibold"
                    >
                      <option value="">-- Chọn nhân sự nhận ủy quyền --</option>
                      {staffDirectory.map((u: any) => (
                        <option key={u.id || u.username} value={u.full_name}>
                          {u.full_name} ({u.department} — {u.role})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleDecision("delegate")}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-bold cursor-pointer"
                    >
                      Xác nhận chuyển người duyệt
                    </button>
                  </div>
                )}

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Ý kiến phê duyệt / Yêu cầu bổ sung giải trình / Lý do từ chối:
                  </label>
                  <input
                    type="text"
                    value={decisionNote}
                    onChange={(e) => setDecisionNote(e.target.value)}
                    placeholder="Nhập ý kiến chỉ đạo, điều kiện phê duyệt hoặc nội dung yêu cầu bổ sung..."
                    className="w-full px-3 py-2 rounded-xl border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => handleDecision("approve")}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold shadow-xs cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    <span>✅ Phê Duyệt &amp; Ký Số Cấp {selectedReq.current_stage_no}</span>
                  </button>

                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => handleDecision("return_for_info")}
                    title="Trả tờ trình về trạng thái Cần bổ sung để người đề xuất đính kèm thêm báo giá/giải trình mà không phải hủy phiếu"
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>⚠️ Yêu Cầu Bổ Sung / Giải Trình Lại</span>
                  </button>

                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => handleDecision("reject")}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>❌ Từ Chối Phê Duyệt</span>
                  </button>
                </div>
              </div>
            )}

            {/* Nội dung chi tiết biểu mẫu & Bảng kê hạng mục */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-6 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
                <div className="font-extrabold text-slate-800 dark:text-slate-200">
                  2. Thông tin Biểu mẫu Chuyên biệt
                </div>
                {Object.keys(selectedReq.form_data || {}).length === 0 ? (
                  <div className="text-slate-400">Không có trường bổ sung.</div>
                ) : (
                  <div className="space-y-1.5">
                    {Object.entries(selectedReq.form_data || {}).map(([k, v]) => {
                      const tpl = templates.find((t) => t.code === selectedReq.template_code);
                      const def = (tpl?.fields_schema || []).find((f: any) => f.key === k);
                      return (
                        <div
                          key={k}
                          className="flex justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-1"
                        >
                          <span className="text-slate-500">{def?.label || k}:</span>
                          <span className="font-semibold text-slate-900 dark:text-white text-right">
                            {String(v || "—")}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="md:col-span-6 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
                <div className="font-extrabold text-slate-800 dark:text-slate-200">
                  3. Căn cứ &amp; Giải trình Chi tiết
                </div>
                <div className="text-slate-700 dark:text-slate-300 whitespace-pre-line">
                  {selectedReq.justification || "—"}
                </div>
                {Array.isArray(selectedReq.attachments) && selectedReq.attachments.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                    <AttachmentList files={selectedReq.attachments} />
                  </div>
                )}
              </div>
            </div>

            {Array.isArray(selectedReq.line_items) && selectedReq.line_items.length > 0 && (
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
                <div className="font-extrabold text-slate-800 dark:text-slate-200">
                  4. Bảng kê Chi tiết Hạng mục &amp; Kinh phí ({selectedReq.line_items.length} dòng)
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                        <th className="py-1.5 pr-2">#</th>
                        <th className="py-1.5 pr-2">Nội dung / Hạng mục</th>
                        <th className="py-1.5 pr-2">ĐVT</th>
                        <th className="py-1.5 pr-2 text-right">SL</th>
                        <th className="py-1.5 pr-2 text-right">Đơn giá</th>
                        <th className="py-1.5 pr-2 text-right">Thành tiền</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {selectedReq.line_items.map((l: any, idx: number) => (
                        <tr key={idx}>
                          <td className="py-1.5 pr-2">{idx + 1}</td>
                          <td className="py-1.5 pr-2 font-semibold">{l.description}</td>
                          <td className="py-1.5 pr-2">{l.unit}</td>
                          <td className="py-1.5 pr-2 text-right font-mono">{l.qty}</td>
                          <td className="py-1.5 pr-2 text-right font-mono">{fmtMoney(l.unit_price)}</td>
                          <td className="py-1.5 pr-2 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                            {fmtMoney(l.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Lịch sử Luân chuyển & Trao đổi trên tờ trình */}
            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50 space-y-2.5">
              <div className="font-extrabold text-slate-800 dark:text-slate-200">
                5. Nhật ký Kiểm toán Phê duyệt &amp; Trao đổi Trực tiếp ({(selectedReq.comments_log || []).length})
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {(selectedReq.comments_log || []).map((lg: any) => (
                  <div
                    key={lg.id}
                    className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 flex items-start justify-between gap-2"
                  >
                    <div>
                      <span className="font-bold text-slate-900 dark:text-white">
                        {lg.actor_name}
                      </span>{" "}
                      {lg.actor_dept && (
                        <span className="text-[10px] text-slate-500">({lg.actor_dept})</span>
                      )}
                      : <span className="text-slate-700 dark:text-slate-300">{lg.comment}</span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400 shrink-0">
                      {lg.created_at}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 pt-1">
                <input
                  type="text"
                  value={commentInput}
                  onChange={(e) => setCommentInput(e.target.value)}
                  placeholder="Gửi câu hỏi hoặc ghi chú bổ sung trực tiếp trên tờ trình này..."
                  className="flex-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
                <button
                  type="button"
                  disabled={submitting || !commentInput.trim()}
                  onClick={handleSendComment}
                  className="px-3.5 py-1.5 rounded-xl bg-indigo-600 text-white font-bold cursor-pointer"
                >
                  Gửi trao đổi
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* =====================================================================
          6. MODAL TRÌNH THIẾT KẾ MẪU TỜ TRÌNH & LUỒNG PHÊ DUYỆT ĐỘNG (NO-CODE BUILDER)
         ===================================================================== */}
      <Modal
        isOpen={isTemplateDesignerOpen}
        onClose={() => setIsTemplateDesignerOpen(false)}
        title={
          isEditingExistingTemplate
            ? `🛠️ Chỉnh Sửa Thiết Kế Mẫu Phê Duyệt (${tplForm.code})`
            : "🛠️ Thiết Kế Mẫu Tờ Trình & Luồng Phê Duyệt Đa Cấp Mới"
        }
        size="4xl"
      >
        <form onSubmit={handleSaveDesignedTemplate} className="space-y-4 text-xs">
          {/* Phần 1: Thông tin cơ bản & Hạn mức */}
          <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 space-y-3">
            <div className="font-extrabold text-slate-900 dark:text-white">
              1. Thông tin định danh Mẫu Tờ Trình &amp; Hạn mức Định tuyến Tự động
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-6">
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Tên mẫu tờ trình / đề xuất *
                </label>
                <input
                  type="text"
                  required
                  value={tplForm.name}
                  onChange={(e) => setTplForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="VD: Tờ trình Xuất mẫu Kit Demo / Thử nghiệm Lâm sàng"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Mã mẫu (Viết liền) *
                </label>
                <input
                  type="text"
                  required
                  disabled={isEditingExistingTemplate}
                  value={tplForm.code}
                  onChange={(e) =>
                    setTplForm((p) => ({
                      ...p,
                      code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"),
                    }))
                  }
                  placeholder="VD: SALES_DEMO_KIT"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold disabled:opacity-60"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Nhóm nghiệp vụ *
                </label>
                <select
                  value={tplForm.category}
                  onChange={(e) => setTplForm((p) => ({ ...p, category: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                >
                  {Object.entries(CATEGORY_META).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-12">
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Mô tả hướng dẫn khi nhân viên chọn mẫu này
                </label>
                <input
                  type="text"
                  value={tplForm.description}
                  onChange={(e) => setTplForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Giải thích ngắn gọn khi nào cần dùng mẫu tờ trình này và cần đính kèm chứng từ gì..."
                  className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>

              <div className="sm:col-span-3">
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Cam kết xử lý SLA (Giờ)
                </label>
                <input
                  type="number"
                  min={1}
                  value={tplForm.sla_hours}
                  onChange={(e) => setTplForm((p) => ({ ...p, sla_hours: e.target.value }))}
                  className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                />
              </div>
              <div className="sm:col-span-5">
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Hạn mức bắt buộc trình Ban Giám Đốc (VNĐ — 0 = Luôn trình)
                </label>
                <input
                  type="number"
                  min={0}
                  value={tplForm.bod_threshold_amount}
                  onChange={(e) => setTplForm((p) => ({ ...p, bod_threshold_amount: e.target.value }))}
                  placeholder="0 = Mọi tờ trình đều trình qua Ban Giám Đốc"
                  className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold"
                />
              </div>
              <div className="sm:col-span-4 flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-800 dark:text-slate-200 select-none">
                  <input
                    type="checkbox"
                    checked={tplForm.has_line_items}
                    onChange={(e) => setTplForm((p) => ({ ...p, has_line_items: e.target.checked }))}
                    className="w-4 h-4 rounded text-indigo-600"
                  />
                  <span>Có Bảng kê chi tiết hạng mục (SL × Đơn giá)</span>
                </label>
              </div>
            </div>
          </div>

          {/* Phần 2: Thiết kế các Trường thông tin động (Dynamic Fields Schema) */}
          <div className="p-3.5 rounded-xl border border-indigo-200/80 dark:border-slate-800 bg-indigo-50/30 dark:bg-slate-900/50 space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-extrabold text-indigo-950 dark:text-indigo-300">
                  2. Thiết kế Các Trường Thông Tin Cần Điền ({tplForm.fields_schema.length} trường)
                </div>
                <div className="text-[11px] text-slate-500">
                  Các câu hỏi / ô nhập liệu sẽ tự động hiển thị khi nhân viên lập tờ trình theo mẫu này.
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setTplForm((p) => ({
                    ...p,
                    fields_schema: [
                      ...p.fields_schema,
                      {
                        key: `truong_${p.fields_schema.length + 1}`,
                        label: "",
                        type: "text",
                        required: true,
                        placeholder: "",
                        optionsText: "",
                      },
                    ],
                  }))
                }
                className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs cursor-pointer"
              >
                + Thêm trường thông tin
              </button>
            </div>

            <div className="space-y-2">
              {tplForm.fields_schema.map((field, idx) => (
                <div
                  key={idx}
                  className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center"
                >
                  <div className="sm:col-span-4">
                    <label className="block text-[10px] font-bold text-slate-400">
                      Tên câu hỏi / Trường thông tin #{idx + 1} *
                    </label>
                    <input
                      type="text"
                      required
                      value={field.label}
                      onChange={(e) => {
                        const val = e.target.value;
                        setTplForm((p) => {
                          const next = [...p.fields_schema];
                          next[idx] = { ...next[idx], label: val };
                          return { ...p, fields_schema: next };
                        });
                      }}
                      placeholder="VD: Lý do xin vượt hạn mức / Số hợp đồng..."
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-semibold"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-[10px] font-bold text-slate-400">Kiểu dữ liệu</label>
                    <select
                      value={field.type}
                      onChange={(e) => {
                        const val = e.target.value as any;
                        setTplForm((p) => {
                          const next = [...p.fields_schema];
                          next[idx] = { ...next[idx], type: val };
                          return { ...p, fields_schema: next };
                        });
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-semibold"
                    >
                      <option value="text">Chữ ngắn (1 dòng)</option>
                      <option value="textarea">Đoạn văn giải trình (Nhiều dòng)</option>
                      <option value="select">Danh sách chọn (Dropdown)</option>
                      <option value="date">Ngày tháng (Date)</option>
                      <option value="number">Con số / Định lượng</option>
                    </select>
                  </div>
                  <div className="sm:col-span-3">
                    {field.type === "select" ? (
                      <>
                        <label className="block text-[10px] font-bold text-indigo-600">
                          Các lựa chọn (Cách nhau dấu phẩy) *
                        </label>
                        <input
                          type="text"
                          value={field.optionsText || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTplForm((p) => {
                              const next = [...p.fields_schema];
                              next[idx] = { ...next[idx], optionsText: val };
                              return { ...p, fields_schema: next };
                            });
                          }}
                          placeholder="VD: Chuyển khoản, Tiền mặt, Công nợ"
                          className="w-full px-2.5 py-1.5 rounded-lg border border-indigo-300 dark:border-indigo-700 bg-indigo-50/40 dark:bg-slate-950"
                        />
                      </>
                    ) : (
                      <>
                        <label className="block text-[10px] font-bold text-slate-400">
                          Gợi ý nhập (Placeholder)
                        </label>
                        <input
                          type="text"
                          value={field.placeholder || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTplForm((p) => {
                              const next = [...p.fields_schema];
                              next[idx] = { ...next[idx], placeholder: val };
                              return { ...p, fields_schema: next };
                            });
                          }}
                          placeholder="Gợi ý mờ trong ô nhập..."
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                        />
                      </>
                    )}
                  </div>
                  <div className="sm:col-span-2 flex items-center justify-between pt-3">
                    <label className="flex items-center gap-1 cursor-pointer font-bold text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setTplForm((p) => {
                            const next = [...p.fields_schema];
                            next[idx] = { ...next[idx], required: checked };
                            return { ...p, fields_schema: next };
                          });
                        }}
                      />
                      <span>Bắt buộc</span>
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setTplForm((p) => ({
                          ...p,
                          fields_schema: p.fields_schema.filter((_, i) => i !== idx),
                        }))
                      }
                      title="Xóa trường thông tin này"
                      className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Phần 3: Thiết kế Chuỗi Cấp Phê Duyệt Đa Cấp (Workflow Stages Builder) */}
          <div className="p-3.5 rounded-xl border border-emerald-200/80 dark:border-emerald-900/50 bg-emerald-50/30 dark:bg-emerald-950/20 space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-extrabold text-emerald-950 dark:text-emerald-300">
                  3. Thiết kế Luồng Định Tuyến Phê Duyệt Đa Cấp ({tplForm.default_stages.length} cấp)
                </div>
                <div className="text-[11px] text-slate-500">
                  Tờ trình sẽ đi tuần tự qua từng cấp từ Cấp 1 ➔ Cấp 2 ➔ Cấp 3. Hệ thống tự động lấy Trưởng phòng tương ứng của bộ phận đó.
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setTplForm((p) => ({
                    ...p,
                    default_stages: [
                      ...p.default_stages,
                      {
                        stage_no: p.default_stages.length + 1,
                        stage_name: `Thẩm định & Phê duyệt Cấp ${p.default_stages.length + 1}`,
                        dept: "Ban Giám Đốc",
                        conditional_on_threshold: false,
                      },
                    ],
                  }))
                }
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer"
              >
                + Thêm cấp phê duyệt
              </button>
            </div>

            <div className="space-y-2">
              {tplForm.default_stages.map((st, idx) => (
                <div
                  key={idx}
                  className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center"
                >
                  <div className="sm:col-span-1 font-extrabold text-emerald-700 dark:text-emerald-400 text-center">
                    Cấp {idx + 1}
                  </div>
                  <div className="sm:col-span-4">
                    <label className="block text-[10px] font-bold text-slate-400">
                      Bộ phận / Cấp có thẩm quyền duyệt *
                    </label>
                    <select
                      value={st.dept}
                      onChange={(e) => {
                        const val = e.target.value;
                        setTplForm((p) => {
                          const next = [...p.default_stages];
                          next[idx] = { ...next[idx], dept: val };
                          return { ...p, default_stages: next };
                        });
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold"
                    >
                      <option value="REQUESTER_DEPT">Trưởng bộ phận của Người trình (Tự động)</option>
                      <option value="Nghiên Cứu R&D">Phòng Nghiên Cứu R&amp;D</option>
                      <option value="Sản Xuất Kit">Phòng Sản Xuất Kit</option>
                      <option value="Tổng Hợp Oligo">Phòng Tổng Hợp Oligo</option>
                      <option value="Kỹ Thuật – Thiết Bị">Phòng Kỹ Thuật – Thiết Bị</option>
                      <option value="QA/QC">Phòng QA/QC (Thẩm định chất lượng &amp; ISO)</option>
                      <option value="Application">Phòng Application (Kỹ thuật &amp; Ứng dụng Lab)</option>
                      <option value="Kinh Doanh">Phòng Kinh Doanh</option>
                      <option value="Sales Admin">Bộ phận Sales Admin</option>
                      <option value="PM">Bộ phận PM (Quản lý Sản phẩm)</option>
                      <option value="Marketing">Bộ phận Marketing</option>
                      <option value="Kho & Vận Hành">Bộ phận Kho &amp; Vận Hành</option>
                      <option value="Cung Ứng">Phòng Cung Ứng (Thẩm định giá &amp; nhà cung cấp)</option>
                      <option value="Kế Toán">Phòng Kế Toán (Kiểm soát ngân sách / chứng từ)</option>
                      <option value="Pháp Chế">Bộ phận Pháp Chế (Thẩm định hợp đồng &amp; pháp lý)</option>
                      <option value="Hành Chính Nhân Sự">Phòng Hành Chính Nhân Sự</option>
                      <option value="Ban Giám Đốc">Ban Giám Đốc (Phê duyệt cuối)</option>
                    </select>
                  </div>
                  <div className="sm:col-span-4">
                    <label className="block text-[10px] font-bold text-slate-400">
                      Nội dung / Trách nhiệm thẩm định tại bước này *
                    </label>
                    <input
                      type="text"
                      required
                      value={st.stage_name}
                      onChange={(e) => {
                        const val = e.target.value;
                        setTplForm((p) => {
                          const next = [...p.default_stages];
                          next[idx] = { ...next[idx], stage_name: val };
                          return { ...p, default_stages: next };
                        });
                      }}
                      placeholder="VD: Kế toán kiểm tra hóa đơn & hạn mức ngân sách"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-semibold"
                    />
                  </div>
                  <div className="sm:col-span-3 flex items-center justify-between pt-3">
                    <label
                      className="flex items-center gap-1 cursor-pointer text-[11px] font-bold text-slate-700 dark:text-slate-300"
                      title="Nếu bật, bước này chỉ kích hoạt khi tổng tiền đề xuất >= Hạn mức trình BGĐ; nếu dưới hạn mức sẽ tự động miễn qua"
                    >
                      <input
                        type="checkbox"
                        checked={st.conditional_on_threshold}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setTplForm((p) => {
                            const next = [...p.default_stages];
                            next[idx] = { ...next[idx], conditional_on_threshold: checked };
                            return { ...p, default_stages: next };
                          });
                        }}
                      />
                      <span>Theo hạn mức tiền</span>
                    </label>
                    {tplForm.default_stages.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setTplForm((p) => ({
                            ...p,
                            default_stages: p.default_stages
                              .filter((_, i) => i !== idx)
                              .map((item, i) => ({ ...item, stage_no: i + 1 })),
                          }))
                        }
                        title="Xóa cấp phê duyệt này"
                        className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2">
              {isEditingExistingTemplate && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingExistingTemplate(false);
                      setTplForm((p) => ({
                        ...p,
                        code: `${p.code}_COPY`,
                        name: `${p.name} (Bản sao)`,
                      }));
                      showToast("Đã chuyển sang chế độ Nhân bản mẫu mới — hãy đặt Mã mẫu mới rồi bấm Lưu!", "info");
                    }}
                    title="Tạo một bản sao từ mẫu này để tùy biến thành mẫu mới"
                    className="px-3.5 py-2 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold cursor-pointer"
                  >
                    📋 Nhân bản thành mẫu mới
                  </button>
                  {currentUser?.is_director && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => {
                        setIsTemplateDesignerOpen(false);
                        handleDeleteTemplate({ code: tplForm.code, name: tplForm.name });
                      }}
                      title="Ẩn mẫu phê duyệt này khỏi danh sách"
                      className="px-3.5 py-2 rounded-xl border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 font-bold cursor-pointer"
                    >
                      🗑️ Ẩn mẫu này
                    </button>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsTemplateDesignerOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-slate-600 dark:text-slate-400 cursor-pointer"
              >
                Đóng
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold shadow-sm cursor-pointer"
              >
                {submitting
                  ? "Đang lưu mẫu..."
                  : isEditingExistingTemplate
                    ? "💾 Lưu Cập Nhật Mẫu Phê Duyệt"
                    : "✨ Tạo & Kích Hoạt Mẫu Phê Duyệt Này"}
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
};

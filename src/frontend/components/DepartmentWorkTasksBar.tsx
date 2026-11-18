"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  Eye,
  MessageSquare,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  User,
  UserCheck,
  Users,
} from "lucide-react";
import { useAuth } from "@/frontend/contexts/AuthContext";
import { todayVN } from "@/backend/services/dates";
import { formatDayVN, DateInputVN } from "@/frontend/components/DateInputVN";
import { uploadSingleFileSmart } from "@/frontend/components/AttachmentPicker";
import {
  canonStaffName,
  isSameWorkspaceDept,
  normalizeWorkspaceDept,
  parseTaskFollowers,
  sameStaffName,
  taskHasFollower,
  WORKSPACE_TASK_DEPARTMENTS,
} from "@/backend/services/workspaceTasks";

export interface DepartmentWorkTasksBarProps {
  deptCode: string;
  deptLabel: string;
  defaultExpanded?: boolean;
}

type ScopeTab = "ASSIGNED_TO_ME" | "CREATED_BY_ME" | "FOLLOWING" | "DEPARTMENT";

const DEPT_TASK_CATEGORIES: Record<string, string[]> = {
  "Sản Xuất Kit": [
    "Pha chế đệm Buffer, Enzyme & MasterMix bán thành phẩm",
    "Chia liều (Dispensing), Đóng gói & Dán nhãn lô Kit IVD",
    "Ghi nhận Hồ sơ lô điện tử (eBR / DHR) & Đối chiếu hao hụt",
    "Kiểm soát chất lượng bán thành phẩm trong quá trình (IPQC)",
    "Cập nhật công thức Định mức BOM & Quy trình Routing",
    "Khác",
  ],
  "Tổng Hợp Oligo": [
    "Kiểm tra trình tự (5'→3') & Ghép mẻ máy tổng hợp Oligo",
    "Cắt cột (Cleavage) & Khử bảo vệ (Deprotection)",
    "Tinh sạch Oligo (Desalt / OPC / HPLC / PAGE)",
    "Đo OD260, Định lượng nmol/µg, Chia tube & Đông khô",
    "Kiểm tra QC trình tự & Xuất COA Đơn hàng",
    "Khác",
  ],
  "Kỹ Thuật – Thiết Bị": [
    "Lắp ráp cơ-điện-quang học & Chạy rà (Burn-in) thiết bị mới",
    "Kiểm định xuất xưởng thiết bị (FQC) & Quản lý số Serial/mBOM",
    "Bảo trì định kỳ & Hiệu chuẩn (Calibration) máy Lab/Nhà máy",
    "Khắc phục sự cố máy sản xuất / máy Lab nội bộ",
    "Xử lý thay đổi kỹ thuật (ECO) & Kiểm thử phần mềm",
    "Khác",
  ],
  "QA/QC": [
    "Lấy mẫu & Kiểm nghiệm nguyên vật liệu đầu vào (IQC)",
    "Kiểm nghiệm bán thành phẩm (IPQC) & Thành phẩm xuất xưởng (FQC)",
    "Thẩm định Hồ sơ lô (DHR) & Phê duyệt giải phóng lô (COA)",
    "Xử lý Sự không phù hợp (NCR / OOS) & Hành động khắc phục (CAPA)",
    "Kiểm soát tài liệu SOP, TCCS & Đánh giá nội bộ ISO 13485",
    "Khác",
  ],
  "Kho Nhà Máy": [
    "Tiếp nhận lô NVL/Hóa chất vào khu Biệt trữ (Quarantine) chờ IQC",
    "Xuất cấp phát NVL/Hóa chất cho Sản xuất & R&D theo FEFO",
    "Nhập kho Bán thành phẩm & Thành phẩm sản xuất đã đạt QC",
    "Xuất bàn giao Thành phẩm từ Kho Nhà Máy sang Kho Kinh Doanh",
    "Giám sát nhiệt độ tủ âm sâu & Kiểm kê định kỳ",
    "Khác",
  ],
  "Cung Ứng Kỹ Thuật": [
    "Xử lý đề nghị mua sắm NVL/Hóa chất sản xuất (PR Nhà máy)",
    "Tìm NCC Hóa chất, Amidite, Cột tổng hợp, Enzyme & Linh kiện",
    "Lập đơn đặt hàng kỹ thuật (PO Nhà máy) & Theo dõi Lead-time",
    "Rà soát hồ sơ chất lượng lô hàng từ NCC (CoA, MSDS)",
    "Khác",
  ],
  "Đơn Nội Bộ": [
    "Tiếp nhận & Điều phối Đơn hàng nội bộ (KD → Nhà máy)",
    "Phát lệnh sản xuất sang Phòng Kit / Oligo / Thiết bị",
    "Theo dõi tiến độ sản xuất & Cam kết ngày giao",
    "Khác",
  ],
  "Nghiên Cứu R&D": [
    "Thiết kế mồi/probe & Đầu vào thiết kế (Design Input)",
    "Thực nghiệm tối ưu phản ứng PCR/qPCR & Nhật ký ELN",
    "Đánh giá độ nhạy (LOD), độ đặc hiệu & Độ ổn định (Stability)",
    "Hoàn thiện Hồ sơ lịch sử thiết kế (DHF) & Chuyển giao công nghệ",
    "Khác",
  ],
  "Kinh Doanh": [
    "Chăm sóc KH & Tư vấn báo giá",
    "Hợp đồng & Đơn hàng bán (SO)",
    "Theo dõi Giao hàng & Thu hồi Công nợ",
    "Phát triển Thị trường / Khách hàng mới",
    "Hỗ trợ thầu / Dự án Bệnh viện",
    "Khác",
  ],
  Application: [
    "Demo máy & Thiết bị tại viện",
    "Thử nghiệm mẫu & Đánh giá Kit cho KH",
    "Đào tạo / Hướng dẫn sử dụng khách hàng",
    "Khắc phục sự cố kỹ thuật tại viện (Troubleshooting)",
    "Viết tài liệu hướng dẫn ứng dụng (App Note)",
    "Khác",
  ],
  "Kho & Vận Hành": [
    "Nhập Kho Kinh Doanh & Kiểm tra hàng về",
    "Soạn hàng & Đóng gói phiếu xuất bán (SO)",
    "Giao nhận vận chuyển tới Khách hàng / Viện",
    "Kiểm kê định kỳ Kho Kinh Doanh",
    "Khác",
  ],
  "Cung Ứng": [
    "Tìm nguồn hàng thương mại & Đàm phán NCC",
    "Lập đơn mua hàng thương mại (PO Kinh Doanh)",
    "Theo dõi tiến độ giao hàng & Thủ tục nhập khẩu",
    "Khác",
  ],
  "Pháp Chế": [
    "Thẩm định Hợp đồng Kinh tế & Mua bán",
    "Rà soát tính hợp pháp Hồ sơ Thầu Bệnh viện",
    "Quản lý Giấy phép lưu hành & CFS / lưu hành IVD",
    "Thỏa thuận Bảo mật (NDA) & Hợp đồng Đại lý",
    "Khác",
  ],
};

function taskHasAssigneeName(rawAssignee: any, staffName: string): boolean {
  if (!rawAssignee || !staffName) return false;
  return String(rawAssignee)
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .some((a) => sameStaffName(a, staffName));
}

function isTaskCreatedBy(t: any, staffName: string, username?: string): boolean {
  if (!t) return false;
  if (username && t.created_by && String(t.created_by).trim().toLowerCase() === String(username).trim().toLowerCase()) {
    return true;
  }
  if (staffName && t.created_by_name && sameStaffName(t.created_by_name, staffName)) {
    return true;
  }
  const logs = Array.isArray(t.logs) ? t.logs : [];
  if (logs.length > 0 && staffName) {
    const firstActor = logs[0]?.actor || logs[0]?.author;
    if (firstActor && sameStaffName(firstActor, staffName)) return true;
  }
  return false;
}

export function DepartmentWorkTasksBar({
  deptCode,
  deptLabel,
  defaultExpanded = false,
}: DepartmentWorkTasksBarProps) {
  const { user } = useAuth();
  const currentStaffName = String((user as any)?.full_name || (user as any)?.name || (user as any)?.username || "").trim();
  const currentUsername = String((user as any)?.username || "").trim();
  const normalizedDept = normalizeWorkspaceDept(deptCode) || deptCode;

  const [expanded, setExpanded] = useState(defaultExpanded);
  const [scopeTab, setScopeTab] = useState<ScopeTab>("ASSIGNED_TO_ME");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "OPEN" | "TODO" | "IN_PROGRESS" | "DONE">("OPEN");
  const [searchQuery, setSearchQuery] = useState("");
  const [tasks, setTasks] = useState<any[]>([]);
  const [personnel, setPersonnel] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Create / Edit modal state
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [followerPick, setFollowerPick] = useState("");
  const [form, setForm] = useState<{
    id: number | null;
    task_code?: string;
    title: string;
    department: string;
    task_category: string;
    assignee_name: string;
    priority: string;
    status: string;
    deadline: string;
    description: string;
    result: string;
    attachments: any[];
    followers: string[];
    logs?: any[];
    created_by?: string | null;
    created_by_name?: string | null;
  }>({
    id: null,
    title: "",
    department: normalizedDept,
    task_category: DEPT_TASK_CATEGORIES[normalizedDept]?.[0] || "Chung",
    assignee_name: currentStaffName,
    priority: "MEDIUM",
    status: "TODO",
    deadline: todayVN(),
    description: "",
    result: "",
    attachments: [],
    followers: [],
  });

  const loadTasks = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/workflows?action=overview", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.tasks)) setTasks(data.tasks);
      if (Array.isArray(data.personnel)) setPersonnel(data.personnel);
    } catch {
      // ignore network error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
    const onFocus = () => loadTasks();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadTasks]);

  const isReadOnlyFollower = useCallback(
    (t: any): boolean => {
      if (!t || !t.id) return false;
      const role = String((user as any)?.role || "").toLowerCase();
      if ((user as any)?.isRootAdmin || role === "admin" || role === "director") return false;
      if (taskHasAssigneeName(t.assignee_name, currentStaffName)) return false;
      if (isTaskCreatedBy(t, currentStaffName, currentUsername)) return false;
      if ((role.includes("head") || role.includes("lead") || role.includes("manager")) && isSameWorkspaceDept(t.department, normalizedDept)) {
        return false;
      }
      return true;
    },
    [user, currentStaffName, currentUsername, normalizedDept]
  );

  const categorized = useMemo(() => {
    const assignedToMe: any[] = [];
    const createdByMe: any[] = [];
    const following: any[] = [];
    const deptTasks: any[] = [];

    for (const t of tasks) {
      if (t.status === "CANCELLED") continue;
      const isMine = taskHasAssigneeName(t.assignee_name, currentStaffName);
      const isCreated = isTaskCreatedBy(t, currentStaffName, currentUsername);
      const isFollowed = taskHasFollower(t.followers, currentStaffName);
      const isDept = isSameWorkspaceDept(t.department, normalizedDept);

      if (isMine) assignedToMe.push(t);
      if (isCreated) createdByMe.push(t);
      if (isFollowed) following.push(t);
      if (isDept || isMine || isCreated || isFollowed) deptTasks.push(t);
    }

    return { assignedToMe, createdByMe, following, deptTasks };
  }, [tasks, currentStaffName, currentUsername, normalizedDept]);

  const activeList = useMemo(() => {
    const base =
      scopeTab === "ASSIGNED_TO_ME"
        ? categorized.assignedToMe
        : scopeTab === "CREATED_BY_ME"
        ? categorized.createdByMe
        : scopeTab === "FOLLOWING"
        ? categorized.following
        : categorized.deptTasks;

    return base.filter((t) => {
      if (statusFilter === "OPEN" && t.status === "DONE") return false;
      if (statusFilter !== "ALL" && statusFilter !== "OPEN" && t.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = canonStaffName(searchQuery);
        const hay = canonStaffName(
          `${t.task_code || ""} ${t.title || ""} ${t.assignee_name || ""} ${t.created_by_name || ""} ${t.description || ""} ${t.task_category || ""}`
        );
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [categorized, scopeTab, statusFilter, searchQuery]);

  const openAssignedCount = useMemo(
    () => categorized.assignedToMe.filter((t) => t.status !== "DONE").length,
    [categorized.assignedToMe]
  );
  const openCreatedCount = useMemo(
    () => categorized.createdByMe.filter((t) => t.status !== "DONE").length,
    [categorized.createdByMe]
  );
  const openFollowingCount = useMemo(
    () => categorized.following.filter((t) => t.status !== "DONE").length,
    [categorized.following]
  );
  const openDeptCount = useMemo(
    () => categorized.deptTasks.filter((t) => t.status !== "DONE").length,
    [categorized.deptTasks]
  );

  const openCreateModal = () => {
    setForm({
      id: null,
      title: "",
      department: normalizedDept,
      task_category: DEPT_TASK_CATEGORIES[normalizedDept]?.[0] || "Chung",
      assignee_name: currentStaffName,
      priority: "MEDIUM",
      status: "TODO",
      deadline: todayVN(),
      description: "",
      result: "",
      attachments: [],
      followers: [],
    });
    setCommentText("");
    setShowForm(true);
    setExpanded(true);
  };

  const openEditModal = (t: any) => {
    const atts = Array.isArray(t.attachments)
      ? t.attachments
      : typeof t.attachments === "string"
      ? (() => {
          try {
            return JSON.parse(t.attachments || "[]");
          } catch {
            return [];
          }
        })()
      : [];
    setForm({
      id: t.id,
      task_code: t.task_code,
      title: t.title || "",
      department: t.department || normalizedDept,
      task_category: t.task_category || DEPT_TASK_CATEGORIES[normalizedDept]?.[0] || "Chung",
      assignee_name: t.assignee_name || "",
      priority: t.priority || "MEDIUM",
      status: t.status || "TODO",
      deadline: t.deadline ? String(t.deadline).slice(0, 10) : todayVN(),
      description: t.description || "",
      result: t.result || "",
      attachments: atts,
      followers: parseTaskFollowers(t.followers),
      logs: Array.isArray(t.logs) ? t.logs : [],
      created_by: t.created_by,
      created_by_name: t.created_by_name,
    });
    setCommentText("");
    setShowForm(true);
  };

  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/workflows?action=task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          actor: currentStaffName,
        }),
      });
      if (res.ok) {
        setShowForm(false);
        await loadTasks();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleQuickStatus = async (t: any, nextStatus: string) => {
    if (isReadOnlyFollower(t)) return;
    await fetch("/api/workflows?action=task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...t,
        status: nextStatus,
        actor: currentStaffName,
      }),
    });
    await loadTasks();
  };

  const handleSendComment = async () => {
    if (!form.id || !commentText.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/workflows?action=task_comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id,
          text: commentText.trim(),
          author: currentStaffName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setCommentText("");
        setForm((prev) => ({ ...prev, logs: data.logs || prev.logs }));
        await loadTasks();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploaded: any[] = [];
      for (const file of Array.from(files)) {
        const item = await uploadSingleFileSmart(file);
        if (item) uploaded.push(item);
      }
      if (uploaded.length > 0) {
        setForm((prev) => ({ ...prev, attachments: [...prev.attachments, ...uploaded] }));
      }
    } finally {
      setUploading(false);
    }
  };

  const deptStaffOptions = useMemo(() => {
    const inDept = personnel.filter((p) => isSameWorkspaceDept(p.department, form.department));
    const others = personnel.filter((p) => !isSameWorkspaceDept(p.department, form.department));
    return { inDept, others };
  }, [personnel, form.department]);

  return (
    <div className="rounded-2xl border border-indigo-200/80 dark:border-indigo-900/60 bg-white dark:bg-slate-900 shadow-2xs overflow-hidden text-xs">
      {/* Compact Top Bar — Always Visible in Every Department Module */}
      <div className="px-3.5 py-2.5 bg-gradient-to-r from-indigo-50/80 via-sky-50/50 to-emerald-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1.5 font-extrabold text-slate-800 dark:text-slate-100 cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            <ClipboardList className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>📋 Quản lý Công việc ({deptLabel})</span>
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setScopeTab("ASSIGNED_TO_ME");
                setExpanded(true);
              }}
              className={`px-2.5 py-1 rounded-lg font-bold text-[11px] cursor-pointer transition-all border ${
                expanded && scopeTab === "ASSIGNED_TO_ME"
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-2xs"
                  : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-indigo-400"
              }`}
            >
              📥 Việc giao cho tôi:{" "}
              <span className="font-mono font-extrabold">{openAssignedCount}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setScopeTab("CREATED_BY_ME");
                setExpanded(true);
              }}
              className={`px-2.5 py-1 rounded-lg font-bold text-[11px] cursor-pointer transition-all border ${
                expanded && scopeTab === "CREATED_BY_ME"
                  ? "bg-emerald-600 text-white border-emerald-600 shadow-2xs"
                  : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-emerald-400"
              }`}
            >
              📤 Việc do tôi tạo:{" "}
              <span className="font-mono font-extrabold">{openCreatedCount}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setScopeTab("FOLLOWING");
                setExpanded(true);
              }}
              className={`px-2.5 py-1 rounded-lg font-bold text-[11px] cursor-pointer transition-all border ${
                expanded && scopeTab === "FOLLOWING"
                  ? "bg-sky-600 text-white border-sky-600 shadow-2xs"
                  : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-sky-400"
              }`}
            >
              👁️ Đang theo dõi:{" "}
              <span className="font-mono font-extrabold">{openFollowingCount}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setScopeTab("DEPARTMENT");
                setExpanded(true);
              }}
              className={`px-2.5 py-1 rounded-lg font-bold text-[11px] cursor-pointer transition-all border ${
                expanded && scopeTab === "DEPARTMENT"
                  ? "bg-purple-600 text-white border-purple-600 shadow-2xs"
                  : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-purple-400"
              }`}
            >
              🏢 Việc chung phòng:{" "}
              <span className="font-mono font-extrabold">{openDeptCount}</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] shadow-2xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ Tạo việc / Giao việc</span>
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold text-[11px] cursor-pointer hover:bg-slate-50"
          >
            {expanded ? "Thu gọn ▲" : "Mở bảng việc ▼"}
          </button>
        </div>
      </div>

      {/* Expanded Department & Personal Task Manager */}
      {expanded && (
        <div className="p-3.5 border-t border-slate-200 dark:border-slate-800 space-y-3">
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: "OPEN", label: "⏳ Đang mở (Cần làm & Đang làm)" },
                  { id: "TODO", label: "📌 Kế hoạch / Cần làm" },
                  { id: "IN_PROGRESS", label: "⚡ Đang thực hiện" },
                  { id: "DONE", label: "✅ Đã hoàn tất" },
                  { id: "ALL", label: "📋 Tất cả" },
                ] as const
              ).map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setStatusFilter(st.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                    statusFilter === st.id
                      ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="🔍 Tìm mã việc, tiêu đề, người nhận, người giao..."
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 w-64 text-[11px]"
              />
              <button
                type="button"
                onClick={loadTasks}
                className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                title="Làm mới danh sách công việc"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {/* Inline Create / Edit Task Form */}
          {showForm && (
            <form
              onSubmit={handleSaveTask}
              className="p-3.5 rounded-2xl border-2 border-indigo-300 dark:border-indigo-800 bg-indigo-50/40 dark:bg-slate-950 space-y-3"
            >
              <div className="flex items-center justify-between border-b border-indigo-200/70 dark:border-slate-800 pb-2">
                <div className="font-extrabold text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
                  <ClipboardList className="w-4 h-4" />
                  <span>
                    {form.id
                      ? isReadOnlyFollower(form)
                        ? `👁️ CHI TIẾT CÔNG VIỆC ${form.task_code || ""} (CHẾ ĐỘ NGƯỜI THEO DÕI — CHỈ XEM)`
                        : `✏️ CẬP NHẬT & BÁO CÁO KẾT QUẢ CÔNG VIỆC ${form.task_code || ""}`
                      : `➕ TẠO CÔNG VIỆC MỚI / GIAO VIỆC (${deptLabel})`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="text-slate-500 hover:text-rose-600 font-bold cursor-pointer"
                >
                  ✕ Đóng
                </button>
              </div>

              {form.id && isReadOnlyFollower(form) && (
                <div className="p-2.5 rounded-xl bg-sky-100/80 dark:bg-sky-950/50 border border-sky-300 dark:border-sky-800 text-sky-900 dark:text-sky-200 text-[11px]">
                  👁️ Bạn là <b>Người theo dõi</b> của công việc này: bạn có thể xem chi tiết nội dung, kết quả và gửi ý kiến trao đổi bên dưới, nhưng không thay đổi trạng thái hoặc nội dung gốc.
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
                <div className="md:col-span-6">
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Tiêu đề công việc *
                  </label>
                  <input
                    type="text"
                    required
                    disabled={Boolean(form.id && isReadOnlyFollower(form))}
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="VD: Kiểm tra hiệu chuẩn máy / Chuẩn bị mẫu / Soạn SOP..."
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold"
                  />
                </div>

                <div className="md:col-span-3">
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Phòng ban thực hiện
                  </label>
                  <select
                    disabled={Boolean(form.id && isReadOnlyFollower(form))}
                    value={form.department}
                    onChange={(e) => {
                      const nextDept = e.target.value;
                      setForm({
                        ...form,
                        department: nextDept,
                        task_category: DEPT_TASK_CATEGORIES[nextDept]?.[0] || "Chung",
                      });
                    }}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold"
                  >
                    {WORKSPACE_TASK_DEPARTMENTS.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-3">
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Phân loại nghiệp vụ
                  </label>
                  <select
                    disabled={Boolean(form.id && isReadOnlyFollower(form))}
                    value={form.task_category}
                    onChange={(e) => setForm({ ...form, task_category: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold"
                  >
                    {(DEPT_TASK_CATEGORIES[form.department] || ["Chung", "Phối hợp liên phòng ban", "Khác"]).map(
                      (cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      )
                    )}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Người thực hiện chính (`Assignee`)
                  </label>
                  <select
                    disabled={Boolean(form.id && isReadOnlyFollower(form))}
                    value={form.assignee_name}
                    onChange={(e) => setForm({ ...form, assignee_name: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold"
                  >
                    <option value={currentStaffName}>👤 Chính tôi ({currentStaffName})</option>
                    {deptStaffOptions.inDept.length > 0 && (
                      <optgroup label={`Nhân sự ${form.department}`}>
                        {deptStaffOptions.inDept.map((p) => (
                          <option key={p.id || p.full_name} value={p.full_name}>
                            {p.full_name} ({p.position || p.department})
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {deptStaffOptions.others.length > 0 && (
                      <optgroup label="Nhân sự phòng ban khác">
                        {deptStaffOptions.others.map((p) => (
                          <option key={p.id || p.full_name} value={p.full_name}>
                            {p.full_name} ({p.department})
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Hạn hoàn thành
                  </label>
                  <DateInputVN
                    value={form.deadline}
                    onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Mức độ ưu tiên
                  </label>
                  <select
                    disabled={Boolean(form.id && isReadOnlyFollower(form))}
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold"
                  >
                    <option value="URGENT">🚨 Khẩn cấp</option>
                    <option value="HIGH">🔥 Cao</option>
                    <option value="MEDIUM">⚡ Trung bình</option>
                    <option value="LOW">📌 Thấp</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Trạng thái tiến độ
                  </label>
                  <select
                    disabled={Boolean(form.id && isReadOnlyFollower(form))}
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold"
                  >
                    <option value="TODO">📌 Kế hoạch / Cần làm</option>
                    <option value="IN_PROGRESS">⚡ Đang thực hiện</option>
                    <option value="DONE">✅ Đã hoàn tất</option>
                  </select>
                </div>
              </div>

              {/* Followers selector */}
              <div className="p-2.5 rounded-xl bg-white/80 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-sky-800 dark:text-sky-300 text-[11px]">
                    👁️ Người theo dõi công việc (Chỉ xem tiến độ &amp; bình luận, không duyệt / đổi trạng thái):
                  </span>
                  {!isReadOnlyFollower(form) && (
                    <div className="flex items-center gap-1.5">
                      <select
                        value={followerPick}
                        onChange={(e) => {
                          const val = e.target.value;
                          setFollowerPick("");
                          if (val && !form.followers.some((f) => sameStaffName(f, val))) {
                            setForm({ ...form, followers: [...form.followers, val] });
                          }
                        }}
                        className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-[11px]"
                      >
                        <option value="">+ Thêm người theo dõi...</option>
                        {personnel.map((p) => (
                          <option key={p.id || p.full_name} value={p.full_name}>
                            {p.full_name} ({p.department})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                {form.followers.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {form.followers.map((fName) => (
                      <span
                        key={fName}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-sky-100 dark:bg-sky-950/70 text-sky-800 dark:text-sky-200 font-bold text-[11px]"
                      >
                        👁️ {fName}
                        {!isReadOnlyFollower(form) && (
                          <button
                            type="button"
                            onClick={() =>
                              setForm({
                                ...form,
                                followers: form.followers.filter((x) => !sameStaffName(x, fName)),
                              })
                            }
                            className="hover:text-rose-600 cursor-pointer ml-0.5"
                          >
                            ✕
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400">Chưa gắn người theo dõi.</div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Mô tả yêu cầu / Nội dung công việc
                  </label>
                  <textarea
                    rows={2}
                    disabled={Boolean(form.id && isReadOnlyFollower(form))}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Ghi rõ yêu cầu kỹ thuật, mã lô / mã thiết bị / hồ sơ liên quan..."
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-emerald-700 dark:text-emerald-400 mb-1">
                    📝 Báo cáo kết quả thực hiện (Tự động đồng bộ sang Nhật ký Daily)
                  </label>
                  <textarea
                    rows={2}
                    disabled={Boolean(form.id && isReadOnlyFollower(form))}
                    value={form.result}
                    onChange={(e) => setForm({ ...form, result: e.target.value })}
                    placeholder="Ghi kết quả đã hoàn thành, số liệu đo kiểm hoặc đường dẫn biên bản..."
                    className="w-full px-3 py-1.5 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              {/* Attachments */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-indigo-600 dark:text-indigo-400 font-bold text-[11px] cursor-pointer">
                    <Paperclip className="w-3.5 h-3.5" />
                    <span>{uploading ? "Đang tải tệp..." : "+ Đính kèm tệp / biên bản"}</span>
                    <input
                      type="file"
                      multiple
                      onChange={(e) => handleUploadFiles(e.target.files)}
                      className="hidden"
                    />
                  </label>
                  {form.attachments.map((att, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px]"
                    >
                      <a
                        href={att.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-indigo-600 hover:underline max-w-[160px] truncate"
                      >
                        {att.name}
                      </a>
                      {!isReadOnlyFollower(form) && (
                        <button
                          type="button"
                          onClick={() =>
                            setForm({
                              ...form,
                              attachments: form.attachments.filter((_, i) => i !== idx),
                            })
                          }
                          className="text-rose-500 hover:text-rose-700 cursor-pointer"
                        >
                          ✕
                        </button>
                      )}
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold text-slate-600 dark:text-slate-300 cursor-pointer"
                  >
                    Đóng
                  </button>
                  {(!form.id || !isReadOnlyFollower(form)) && (
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-xs cursor-pointer disabled:opacity-50"
                    >
                      {saving ? "Đang lưu..." : form.id ? "💾 Lưu cập nhật" : "➕ Lưu & Giao việc"}
                    </button>
                  )}
                </div>
              </div>

              {/* Discussion / Comments inside Task */}
              {form.id && (
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="font-bold text-slate-700 dark:text-slate-300 text-[11px]">
                    💬 Trao đổi / Phản hồi trên công việc:
                  </div>
                  {Array.isArray(form.logs) &&
                    form.logs.filter((l: any) => l?.type === "comment").length > 0 && (
                      <div className="max-h-28 overflow-y-auto space-y-1">
                        {form.logs
                          .filter((l: any) => l?.type === "comment")
                          .map((c: any, idx: number) => (
                            <div
                              key={idx}
                              className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px]"
                            >
                              <span className="font-bold text-indigo-600 dark:text-indigo-400">
                                {c.author}:
                              </span>{" "}
                              <span>{c.text}</span>{" "}
                              <span className="text-[10px] text-slate-400 font-mono">({c.time})</span>
                            </div>
                          ))}
                      </div>
                    )}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder="Nhập ý kiến trao đổi hoặc báo cáo nhanh..."
                      className="flex-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                    <button
                      type="button"
                      disabled={saving || !commentText.trim()}
                      onClick={handleSendComment}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-bold text-[11px] cursor-pointer disabled:opacity-50"
                    >
                      <Send className="w-3 h-3" />
                      Gửi
                    </button>
                  </div>
                </div>
              )}
            </form>
          )}

          {/* Tasks Table */}
          {activeList.length === 0 ? (
            <div className="py-6 text-center text-slate-400 italic bg-slate-50/60 dark:bg-slate-950/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
              Chưa có công việc nào trong mục này. Bấm <b>&ldquo;+ Tạo việc / Giao việc&rdquo;</b> ở góc phải để thêm công việc mới.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2 px-2.5">Mã &amp; Công việc</th>
                    <th className="py-2 px-2.5">Người giao / Tạo</th>
                    <th className="py-2 px-2.5">Người thực hiện &amp; Theo dõi</th>
                    <th className="py-2 px-2.5">Hạn chót</th>
                    <th className="py-2 px-2.5">Trạng thái</th>
                    <th className="py-2 px-2.5 text-right">Thao tác nhanh</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {activeList.slice(0, 15).map((t) => {
                    const readOnlyFollower = isReadOnlyFollower(t);
                    const followers = parseTaskFollowers(t.followers);
                    return (
                      <tr
                        key={t.id}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-2 px-2.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono font-bold text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">
                              {t.task_code}
                            </span>
                            <button
                              type="button"
                              onClick={() => openEditModal(t)}
                              className="font-bold text-slate-900 dark:text-white hover:text-indigo-600 text-left cursor-pointer"
                            >
                              {t.title}
                            </button>
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {t.department} • {t.task_category}
                            {t.result ? (
                              <span className="ml-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                                ✓ KQ: {String(t.result).slice(0, 60)}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="py-2 px-2.5 text-[11px] text-slate-600 dark:text-slate-300">
                          {t.created_by_name || t.created_by || "Hệ thống"}
                        </td>
                        <td className="py-2 px-2.5">
                          <div className="font-semibold text-slate-800 dark:text-slate-200">
                            👤 {t.assignee_name || "Chờ phân công"}
                          </div>
                          {followers.length > 0 && (
                            <div className="text-[10px] text-sky-600 dark:text-sky-400">
                              👁️ Theo dõi: {followers.join(", ")}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2.5 font-mono text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {t.deadline ? formatDayVN(t.deadline) : "—"}
                        </td>
                        <td className="py-2 px-2.5 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              t.status === "DONE"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                : t.status === "IN_PROGRESS"
                                ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                                : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                            }`}
                          >
                            {t.status === "DONE"
                              ? "Hoàn tất"
                              : t.status === "IN_PROGRESS"
                              ? "Đang làm"
                              : "Cần làm"}
                          </span>
                        </td>
                        <td className="py-2 px-2.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            {!readOnlyFollower && t.status === "TODO" && (
                              <button
                                type="button"
                                onClick={() => handleQuickStatus(t, "IN_PROGRESS")}
                                className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold text-[10px] hover:bg-blue-100 cursor-pointer"
                              >
                                ▶ Bắt đầu
                              </button>
                            )}
                            {!readOnlyFollower && t.status !== "DONE" && (
                              <button
                                type="button"
                                onClick={() => handleQuickStatus(t, "DONE")}
                                className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold text-[10px] hover:bg-emerald-100 cursor-pointer"
                              >
                                ✓ Hoàn tất
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openEditModal(t)}
                              className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-[10px] hover:bg-slate-200 cursor-pointer"
                            >
                              {readOnlyFollower ? "👁️ Xem" : "📝 Chi tiết / KQ"}
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
      )}
    </div>
  );
}

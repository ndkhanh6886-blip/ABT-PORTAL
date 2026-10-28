"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/frontend/contexts/AuthContext";
import {
  MessageSquare,
  Send,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Smartphone,
  Settings,
  Users,
  FileText,
  Check,
  X,
  RefreshCw,
  Copy,
  ExternalLink,
  Download,
  Clock,
  Sliders,
  ChevronRight,
  Bot,
  User,
  Zap,
  Building2,
  FileSpreadsheet,
  Package,
  Search,
  Filter,
  Edit2,
  Save,
  Trash2,
  Phone,
  PhoneOff,
  UserCheck,
  UserX,
  HelpCircle,
  Activity,
  Eye,
  Maximize2
} from "lucide-react";

interface ZaloConfig {
  oa_id: string;
  oa_name: string;
  app_id: string;
  secret_key: string;
  access_token: string;
  refresh_token: string;
  webhook_verify_token: string;
  director_discount_threshold: number;
  director_phone: string;
  director_zalo_id: string;
  is_active: boolean;
}

interface ZaloBinding {
  id: number;
  personnel_id?: number;
  employee_id: string;
  display_name: string;
  phone_number: string | null;
  zalo_user_id: string | null;
  department: string;
  position?: string;
  user_type: string;
  role: string;
  connection_status: "CONNECTED" | "PENDING_ZALO" | "NO_PHONE" | string;
  is_active: boolean;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

interface PendingApproval {
  id: number;
  quote_code: string;
  customer_name: string;
  sales_rep_name: string;
  total_amount: string | number;
  subtotal: string | number;
  discount_rate: number;
  discount_amount: string | number;
  tax_amount: string | number;
  status: string;
  date: string;
  items: any;
}

interface ZaloStats {
  total: number;
  connectedCount: number;
  pendingCount: number;
  noPhoneCount: number;
}

export const ZaloOperationsHub: React.FC = () => {
  const { user } = useAuth();
  const [activeSubTab, setActiveSubTab] = useState<"approvals" | "chat_simulator" | "bindings" | "config" | "logs">("bindings");
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<ZaloConfig>({
    oa_id: "125246484401171420",
    oa_name: "Công ty TNHH Khoa học TBR",
    app_id: "2331222115598746556",
    secret_key: "",
    access_token: "",
    refresh_token: "",
    webhook_verify_token: "tbr_webhook_token_2026",
    director_discount_threshold: 10,
    director_phone: "0916033652",
    director_zalo_id: "",
    is_active: true
  });
  const [bindings, setBindings] = useState<ZaloBinding[]>([]);
  const [stats, setStats] = useState<ZaloStats>({ total: 0, connectedCount: 0, pendingCount: 0, noPhoneCount: 0 });
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Modal and expand state for viewing full message & files
  const [selectedLog, setSelectedLog] = useState<any | null>(null);
  const [expandedLogIds, setExpandedLogIds] = useState<Record<number, boolean>>({});

  const extractUrls = (text: string) => {
    if (!text) return [];
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.match(urlRegex) || [];
  };

  // Search & Filtering in Tab 3 (Bindings)
  const [searchTerm, setSearchTerm] = useState("");
  const [filterDept, setFilterDept] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");

  // Modal State for Editing Personnel Zalo
  const [editingBinding, setEditingBinding] = useState<ZaloBinding | null>(null);
  const [editPhone, setEditPhone] = useState("");
  const [editZaloId, setEditZaloId] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [isSavingBinding, setIsSavingBinding] = useState(false);

  // Chat Simulator State with Real Personnel Selection
  const [selectedPersonnelCode, setSelectedPersonnelCode] = useState<string>("NV-TBR-018");
  const [chatMessages, setChatMessages] = useState<Array<{ sender: "user" | "bot"; text: string; time: string; buttons?: any[] }>>([
    {
      sender: "bot",
      text: "👋 Xin chào! Tôi là Trợ lý điều hành Zalo Công ty TNHH Khoa học TBR kết nối cơ sở dữ liệu thực tế. Bạn có thể soạn báo giá, tra cứu tồn kho, giữ chỗ hoặc nộp Daily tại đây!",
      time: "Vừa xong"
    }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [isSendingChat, setIsSendingChat] = useState(false);

  // Test Connection State
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    oa_info?: any;
    errorCode?: number;
    advice?: string;
  } | null>(null);

  // Fetch Overview Data with Cache-Busting
  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/zalo/config?action=overview&_t=${Date.now()}`, {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache"
        }
      });
      const data = await res.json();
      if (data) {
        if (data.config) setConfig(data.config);
        if (data.bindings) setBindings(data.bindings);
        if (data.stats) setStats(data.stats);
        if (data.pendingApprovals) setPendingApprovals(data.pendingApprovals);
        if (data.logs) setLogs(data.logs);
      }
    } catch (e) {
      console.warn("Error fetching Zalo data:", e);
    } finally {
      setLoading(false);
    }
  };

  // Handle Test Zalo OpenAPI Connection
  const handleTestConnection = async () => {
    try {
      setIsTestingConnection(true);
      setTestResult(null);
      const res = await fetch("/api/zalo/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test_connection",
          access_token: config.access_token
        })
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err: any) {
      setTestResult({
        success: false,
        message: "Lỗi kết nối máy chủ kiểm tra: " + err.message
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  // Handle Renew Token using Refresh Token via Zalo OAuth v4
  const [isRenewingToken, setIsRenewingToken] = useState(false);

  const handleRenewToken = async () => {
    if (!config.refresh_token || config.refresh_token === "zalo_refresh_token_demo_valid") {
      alert("⚠️ Vui lòng nhập Refresh Token (được Zalo Developer cấp kèm theo Access Token, thời hạn 3 tháng) vào ô bên dưới trước khi bấm làm mới!");
      return;
    }
    if (!config.secret_key) {
      alert("⚠️ Vui lòng nhập Secret Key của Zalo App trước khi làm mới token!");
      return;
    }

    try {
      setIsRenewingToken(true);
      const res = await fetch("/api/zalo/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "renew_token",
          app_id: config.app_id,
          secret_key: config.secret_key,
          refresh_token: config.refresh_token
        })
      });
      const data = await res.json();
      if (data.success) {
        setConfig((prev) => ({
          ...prev,
          access_token: data.access_token,
          refresh_token: data.refresh_token
        }));
        alert(data.message);
        fetchData();
      } else {
        alert("❌ Làm mới thất bại:\n" + data.message);
      }
    } catch (e: any) {
      alert("Lỗi kết nối máy chủ: " + e.message);
    } finally {
      setIsRenewingToken(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Handle Save Configuration
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/zalo/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_config",
          ...config
        })
      });
      const data = await res.json();
      if (data.success) {
        if (data.config) {
          setConfig(data.config);
        }
        alert("✅ Đã lưu cấu hình Zalo Gateway và Ngưỡng phê duyệt chiết khấu lên máy chủ!");
        fetchData();
      } else {
        alert(data.error || "Lỗi lưu cấu hình");
      }
    } catch (err: any) {
      alert("Lỗi kết nối máy chủ");
    }
  };

  // Handle Force Sync Personnel from personnel table
  const handleSyncPersonnel = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/zalo/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_personnel" })
      });
      const data = await res.json();
      if (data.success) {
        alert(`✅ ${data.message}`);
        fetchData();
      } else {
        alert(data.error || "Lỗi đồng bộ nhân sự");
      }
    } catch (e) {
      alert("Lỗi kết nối khi đồng bộ");
    } finally {
      setLoading(false);
    }
  };

  // Handle Clear Mock Data
  const handleClearMockData = async () => {
    if (!confirm("Bạn có chắc chắn muốn xóa toàn bộ tin nhắn chat thử nghiệm, báo giá demo và đồng bộ danh mục nhân sự thực tế?")) {
      return;
    }
    try {
      setLoading(true);
      const res = await fetch("/api/zalo/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_mock_data" })
      });
      const data = await res.json();
      if (data.success) {
        alert("✅ Đã xóa dữ liệu giả lập thành công! Danh mục nhân sự thực tế đã được đồng bộ.");
        setChatMessages([
          {
            sender: "bot",
            text: "👋 Hệ thống đã sẵn sàng với danh mục nhân sự thực tế. Vui lòng chọn nhân viên để trải nghiệm.",
            time: "Vừa xong"
          }
        ]);
        fetchData();
      } else {
        alert(data.error || "Lỗi khi xóa dữ liệu");
      }
    } catch (e) {
      alert("Lỗi kết nối");
    } finally {
      setLoading(false);
    }
  };

  // Open Edit Modal
  const handleOpenEdit = (binding: ZaloBinding) => {
    setEditingBinding(binding);
    setEditPhone(binding.phone_number || "");
    setEditZaloId(binding.zalo_user_id || "");
    setEditNotes(binding.notes || "");
  };

  // Save Employee Zalo Info
  const handleSaveEmployeeZalo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBinding) return;
    try {
      setIsSavingBinding(true);
      const res = await fetch("/api/zalo/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_employee_zalo",
          id: editingBinding.id,
          employee_id: editingBinding.employee_id,
          phone_number: editPhone,
          zalo_user_id: editZaloId,
          notes: editNotes
        })
      });
      const data = await res.json();
      if (data.success) {
        setEditingBinding(null);
        fetchData();
      } else {
        alert(data.error || "Lỗi cập nhật");
      }
    } catch (e) {
      alert("Lỗi kết nối máy chủ");
    } finally {
      setIsSavingBinding(false);
    }
  };

  // Handle Director Approve/Reject
  const handleDirectorDecision = async (quoteCode: string, decision: "APPROVE" | "REJECT") => {
    try {
      const res = await fetch("/api/zalo/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "director_action",
          quote_code: quoteCode,
          decision,
          approver_name: String(user?.full_name || user?.name || "Ban Giám Đốc")
        })
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message);
        fetchData();
      } else {
        alert(data.error || "Lỗi xử lý");
      }
    } catch (err) {
      alert("Lỗi kết nối máy chủ");
    }
  };

  // Selected Personnel for Simulator
  const activeSimPersonnel = bindings.find(b => b.employee_id === selectedPersonnelCode) || bindings[0];

  // Send Message in Chat Simulator
  const handleSendSimChat = async (presetText?: string) => {
    const textToSend = presetText || chatInput;
    if (!textToSend.trim() || isSendingChat) return;

    const userMsg = {
      sender: "user" as const,
      text: textToSend,
      time: new Date().toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" })
    };

    setChatMessages((prev) => [...prev, userMsg]);
    if (!presetText) setChatInput("");
    setIsSendingChat(true);

    try {
      const senderName = `${activeSimPersonnel?.display_name || "Khách"} (${activeSimPersonnel?.department || "Chưa rõ"})`;

      const res = await fetch("/api/zalo/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test_chat",
          employee_id: activeSimPersonnel?.employee_id || undefined,
          senderName,
          text: textToSend
        })
      });

      const data = await res.json();
      if (data.success && data.reply) {
        const botMsg = {
          sender: "bot" as const,
          text: data.reply.text,
          buttons: data.reply.buttons,
          time: new Date().toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" })
        };
        setChatMessages((prev) => [...prev, botMsg]);
        fetchData(); // refresh approvals & logs
      }
    } catch (err) {
      console.warn("Chat error:", err);
    } finally {
      setIsSendingChat(false);
    }
  };

  const webhookPublicUrl = typeof window !== "undefined" ? `${window.location.origin}/api/zalo/webhook` : "https://tbr-portal.vn/api/zalo/webhook";

  const handleCopyWebhook = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(webhookPublicUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    }
  };

  // Filtered bindings
  const filteredBindings = bindings.filter((b) => {
    const matchSearch =
      (b.display_name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (b.employee_id || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (b.phone_number || "").includes(searchTerm) ||
      (b.department || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (b.position || "").toLowerCase().includes(searchTerm.toLowerCase());

    const matchDept = filterDept === "ALL" || b.department === filterDept;
    const matchStatus =
      filterStatus === "ALL" ||
      (filterStatus === "CONNECTED" && b.connection_status === "CONNECTED") ||
      (filterStatus === "PENDING_ZALO" && b.connection_status === "PENDING_ZALO") ||
      (filterStatus === "NO_PHONE" && b.connection_status === "NO_PHONE");

    return matchSearch && matchDept && matchStatus;
  });

  // Extract unique departments for filter dropdown
  const uniqueDepartments = Array.from(new Set(bindings.map(b => b.department).filter(Boolean)));

  return (
    <div className="space-y-6">
      {/* ========================================================================= */}
      {/* 1. TOP HEADER BANNER */}
      {/* ========================================================================= */}
      <div className="bg-gradient-to-r from-blue-50 via-indigo-50/60 to-slate-50 dark:from-blue-900 dark:via-indigo-950 dark:to-slate-900 text-slate-900 dark:text-white rounded-3xl p-6 sm:p-7 shadow-sm dark:shadow-xl border border-blue-200 dark:border-blue-700/40 relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-96 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-500/10 dark:from-blue-500/20 via-transparent to-transparent pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-3 py-1 rounded-full text-[11px] font-black tracking-wider uppercase bg-blue-100 text-blue-800 border border-blue-300 dark:bg-blue-500/30 dark:text-blue-300 dark:border-blue-400/30 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>ZALO OA DOANH NGHIỆP GATEWAY</span>
              </span>

              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold flex items-center gap-1.5 bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-400/30">
                <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-ping inline-block" />
                <span>Webhook Active • Cổng 3005</span>
              </span>

              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-400/30">
                Ngưỡng duyệt BGĐ: ≥ {config.director_discount_threshold}% chiết khấu
              </span>

              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-900 border border-indigo-300 dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-400/30">
                30 Nhân Sự Thực Tế
              </span>
            </div>

            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-blue-950 dark:text-white uppercase flex items-center gap-2.5">
              <span>TRUNG TÂM ĐIỀU HÀNH DI ĐỘNG QUA ZALO (ZALO OPERATIONS HUB)</span>
            </h1>

            <p className="text-xs text-slate-600 dark:text-blue-200 max-w-3xl leading-relaxed">
              Soạn báo giá PDF tự động từ tin nhắn Zalo, tra cứu tồn kho FEFO, giữ chỗ hàng và cơ chế <strong className="text-slate-900 dark:text-white font-bold">Ban Giám Đốc phê duyệt 1-chạm</strong> mức chiết khấu lớn kết nối trực tiếp với <strong className="text-slate-900 dark:text-white font-bold">danh mục nhân sự thực tế</strong> của TBRs.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={handleCopyWebhook}
              className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 border border-blue-400/40 text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
              title="Sao chép địa chỉ Webhook để cấu hình trên Zalo Developer"
            >
              {copiedUrl ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
              <span>{copiedUrl ? "Đã chép Webhook URL" : "Sao chép Webhook"}</span>
            </button>
            <button
              type="button"
              onClick={fetchData}
              className="p-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 dark:border-slate-700 text-xs font-bold cursor-pointer shadow-2xs"
              title="Làm mới dữ liệu"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* 5 Sub-tabs Navigation */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-6 pt-5 border-t border-blue-200 dark:border-blue-700/40 text-xs font-bold">
          <button
            type="button"
            onClick={() => setActiveSubTab("bindings")}
            className={`py-3 px-3 rounded-2xl flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeSubTab === "bindings"
                ? "bg-blue-600 text-white shadow-md font-black dark:bg-white dark:text-blue-950"
                : "bg-white text-slate-700 hover:bg-blue-50/80 border border-blue-200 shadow-2xs dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/80 dark:border-blue-700/40"
            }`}
          >
            <Users className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span>Định Danh Nhân Sự ({bindings.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab("approvals")}
            className={`py-3 px-3 rounded-2xl flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeSubTab === "approvals"
                ? "bg-blue-600 text-white shadow-md font-black dark:bg-white dark:text-blue-950"
                : "bg-white text-slate-700 hover:bg-blue-50/80 border border-blue-200 shadow-2xs dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/80 dark:border-blue-700/40"
            }`}
          >
            <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-500 shrink-0" />
            <span>Duyệt Chiết Khấu ({pendingApprovals.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab("chat_simulator")}
            className={`py-3 px-3 rounded-2xl flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeSubTab === "chat_simulator"
                ? "bg-blue-600 text-white shadow-md font-black dark:bg-white dark:text-blue-950"
                : "bg-white text-slate-700 hover:bg-blue-50/80 border border-blue-200 shadow-2xs dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/80 dark:border-blue-700/40"
            }`}
          >
            <Smartphone className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>Giả Lập Chat Zalo</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveSubTab("config");
              fetchData();
            }}
            className={`py-3 px-3 rounded-2xl flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeSubTab === "config"
                ? "bg-blue-600 text-white shadow-md font-black dark:bg-white dark:text-blue-950"
                : "bg-white text-slate-700 hover:bg-blue-50/80 border border-blue-200 shadow-2xs dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/80 dark:border-blue-700/40"
            }`}
          >
            <Settings className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
            <span>Cấu Hình Zalo OA</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab("logs")}
            className={`py-3 px-3 rounded-2xl flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeSubTab === "logs"
                ? "bg-blue-600 text-white shadow-md font-black dark:bg-white dark:text-blue-950"
                : "bg-white text-slate-700 hover:bg-blue-50/80 border border-blue-200 shadow-2xs dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/80 dark:border-blue-700/40"
            }`}
          >
            <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <span>Nhật Ký Tin Nhắn ({logs.length})</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SUB-TAB 1: ĐỊNH DANH NHÂN SỰ THỰC TẾ (CHÍNH) */}
      {/* ========================================================================= */}
      {activeSubTab === "bindings" && (
        <div className="space-y-4">
          {/* 4 Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Tổng Nhân Sự Thực Tế</div>
                <div className="text-2xl font-black text-slate-900 dark:text-white mt-0.5">{stats.total || bindings.length}</div>
                <div className="text-[11px] text-slate-400 mt-1">Đồng bộ từ bảng personnel</div>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                <Users className="w-6 h-6" />
              </div>
            </div>

            <div className="p-4 rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20 shadow-xs flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Đã Kết Nối Zalo</div>
                <div className="text-2xl font-black text-emerald-700 dark:text-emerald-300 mt-0.5">{stats.connectedCount || 0}</div>
                <div className="text-[11px] text-emerald-600/80 mt-1">Đã có SĐT &amp; Zalo User ID</div>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-900 text-emerald-600 dark:text-emerald-300 flex items-center justify-center font-bold">
                <CheckCircle2 className="w-6 h-6" />
              </div>
            </div>

            <div className="p-4 rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 shadow-xs flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">Chờ Liên Kết (Có SĐT)</div>
                <div className="text-2xl font-black text-amber-700 dark:text-amber-300 mt-0.5">{stats.pendingCount || 0}</div>
                <div className="text-[11px] text-amber-600/80 mt-1">Để trống Zalo ID (chờ quét OA)</div>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-900 text-amber-600 dark:text-amber-300 flex items-center justify-center font-bold">
                <Clock className="w-6 h-6" />
              </div>
            </div>

            <div className="p-4 rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 shadow-xs flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider">Chưa Có SĐT (Không Kết Nối)</div>
                <div className="text-2xl font-black text-rose-700 dark:text-rose-300 mt-0.5">{stats.noPhoneCount || 0}</div>
                <div className="text-[11px] text-rose-600/80 mt-1">Hệ thống thông báo không kết nối</div>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-900 text-rose-600 dark:text-rose-300 flex items-center justify-center font-bold">
                <PhoneOff className="w-6 h-6" />
              </div>
            </div>
          </div>

          {/* Main Card */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-black text-slate-900 dark:text-white uppercase text-base flex items-center gap-2">
                  <Users className="w-5 h-5 text-indigo-500" />
                  <span>DANH MỤC NHÂN SỰ LIÊN KẾT ĐIỀU HÀNH QUA ZALO</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Đồng bộ trực tiếp từ danh mục nhân sự thực tế. Nhân sự chưa có thông tin sẽ để trống để bổ sung sau; nhân sự chưa có số điện thoại Zalo hệ thống sẽ thông báo <strong>"Không kết nối"</strong>.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleSyncPersonnel}
                  className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
                  title="Đồng bộ lại danh sách nhân sự mới nhất từ cơ sở dữ liệu"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Đồng Bộ Danh Mục Nhân Sự</span>
                </button>

                <button
                  type="button"
                  onClick={handleClearMockData}
                  className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 text-slate-600 dark:text-slate-300 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border border-slate-200 dark:border-slate-700"
                  title="Xóa toàn bộ tin nhắn chat thử nghiệm và báo giá demo"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Xóa Dữ Liệu Thử Nghiệm</span>
                </button>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
              {/* Search Input */}
              <div className="relative w-full sm:w-80">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Tìm theo tên, mã NV, SĐT, phòng ban..."
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Department & Status Filters */}
              <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1">
                <select
                  value={filterDept}
                  onChange={(e) => setFilterDept(e.target.value)}
                  className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 outline-none"
                >
                  <option value="ALL">Tất cả phòng ban ({bindings.length})</option>
                  {uniqueDepartments.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept} ({bindings.filter(b => b.department === dept).length})
                    </option>
                  ))}
                </select>

                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 outline-none"
                >
                  <option value="ALL">Tất cả trạng thái kết nối</option>
                  <option value="CONNECTED">Đã kết nối Zalo ({stats.connectedCount})</option>
                  <option value="PENDING_ZALO">Chờ liên kết (Có SĐT) ({stats.pendingCount})</option>
                  <option value="NO_PHONE">Không kết nối (Chưa có SĐT) ({stats.noPhoneCount})</option>
                </select>
              </div>
            </div>

            {/* Hướng dẫn Quét OA */}
            <div className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-3">
              <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1 flex-1">
                <div className="font-bold uppercase tracking-wide flex items-center justify-between">
                  <span>Trạng thái "Chờ liên kết Zalo" &amp; "Để trống (Chờ quét OA)" là gì?</span>
                </div>
                <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                  Nhân sự đã có Số điện thoại trong hồ sơ nhưng chưa từng tương tác với trang Zalo OA của công ty nên Zalo chưa cấp mã định danh bảo mật <strong>Zalo User ID</strong>.
                  <br />
                  👉 <strong>Cách quét OA (Kích hoạt kết nối):</strong> Nhân sự dùng điện thoại mở Zalo &gt; Tìm kiếm Zalo OA <strong>"Công ty TNHH Khoa học TBR"</strong> (hoặc quét mã QR OA) &gt; Bấm <strong>Quan tâm</strong> &gt; Nhắn 1 tin nhắn bất kỳ (Ví dụ: <code className="bg-amber-100 dark:bg-amber-900/60 px-1 rounded font-mono">menu</code> hoặc <code className="bg-amber-100 dark:bg-amber-900/60 px-1 rounded font-mono">xin chao</code>). Hệ thống sẽ tự động bắt lấy Zalo User ID và chuyển sang trạng thái <strong className="text-emerald-700 dark:text-emerald-400">"Đã kết nối"</strong> (Xanh lá).
                </p>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold text-slate-400 uppercase bg-slate-50/50 dark:bg-slate-850">
                    <th className="py-3 px-3">Mã NV</th>
                    <th className="py-3 px-3">Họ Tên Nhân Sự</th>
                    <th className="py-3 px-3">Phòng Ban &amp; Chức Danh</th>
                    <th className="py-3 px-3">Số Điện Thoại Zalo</th>
                    <th className="py-3 px-3">Zalo User ID</th>
                    <th className="py-3 px-3">Thẩm Quyền</th>
                    <th className="py-3 px-3">Trạng Thái Kết Nối</th>
                    <th className="py-3 px-3 text-right">Thao Tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                  {filteredBindings.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-3 font-mono font-black text-indigo-600 dark:text-indigo-400">
                        {b.employee_id || "—"}
                      </td>

                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <span>{b.display_name}</span>
                          {b.role === "DIRECTOR" && (
                            <span className="px-1.5 py-0.2 text-[9px] font-black rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                              BGĐ
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 line-clamp-1">{b.position || "—"}</div>
                      </td>

                      <td className="py-3 px-3">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">{b.department || "—"}</span>
                      </td>

                      <td className="py-3 px-3 font-mono font-bold">
                        {b.phone_number ? (
                          <span className="text-slate-800 dark:text-slate-200 flex items-center gap-1">
                            <Phone className="w-3.5 h-3.5 text-blue-500" />
                            <span>{b.phone_number}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400 border border-rose-200 dark:border-rose-900">
                            <PhoneOff className="w-3 h-3" />
                            <span>Chưa có SĐT (Để trống)</span>
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-3 font-mono">
                        {b.zalo_user_id ? (
                          <span className="text-slate-700 dark:text-slate-300 font-bold bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-[11px]">
                            {b.zalo_user_id}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400 italic">Để trống (Chờ quét OA)</span>
                        )}
                      </td>

                      <td className="py-3 px-3">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            b.role === "DIRECTOR"
                              ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800"
                              : b.role === "HEAD_OF_DEPT"
                              ? "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300"
                              : b.role === "WAREHOUSE"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              : "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                          }`}
                        >
                          {b.role === "DIRECTOR"
                            ? "Phê Duyệt BGĐ"
                            : b.role === "HEAD_OF_DEPT"
                            ? "Trưởng Phòng"
                            : b.role === "WAREHOUSE"
                            ? "Thủ Kho"
                            : "NVKD / Chuyên viên"}
                        </span>
                      </td>

                      <td className="py-3 px-3">
                        {b.connection_status === "CONNECTED" ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Đã kết nối</span>
                          </span>
                        ) : b.connection_status === "PENDING_ZALO" ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                            <Clock className="w-3.5 h-3.5 text-amber-600" />
                            <span>Chờ liên kết Zalo</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                            <AlertOctagon className="w-3.5 h-3.5 text-rose-600" />
                            <span>Không kết nối</span>
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(b)}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 dark:bg-slate-800 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-300 text-slate-700 dark:text-slate-300 text-[11px] font-bold transition-all cursor-pointer inline-flex items-center gap-1"
                          title="Bấm để bổ sung SĐT hoặc Zalo ID cho nhân sự"
                        >
                          <Edit2 className="w-3 h-3" />
                          <span>Cập nhật</span>
                        </button>
                      </td>
                    </tr>
                  ))}

                  {filteredBindings.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-400">
                        Không tìm thấy nhân sự phù hợp với điều kiện tìm kiếm.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CẬP NHẬT THÔNG TIN ZALO CHO NHÂN SỰ */}
      {/* ========================================================================= */}
      {editingBinding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-black text-slate-900 dark:text-white text-sm">
                    CẬP NHẬT THÔNG TIN ZALO NHÂN SỰ
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    {editingBinding.display_name} ({editingBinding.employee_id}) • {editingBinding.department}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setEditingBinding(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEmployeeZalo} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-blue-500" />
                  <span>Số Điện Thoại Zalo:</span>
                </label>
                <input
                  type="text"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="Ví dụ: 0916033652 (để trống nếu chưa có)"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <p className="text-[10px] text-slate-400">
                  * Nếu để trống, hệ thống sẽ tự động gán trạng thái <strong>"Không kết nối"</strong>.
                </p>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Zalo User ID (ID người dùng Zalo - Dãy số 16-20 ký tự):</span>
                </label>
                <input
                  type="text"
                  value={editZaloId}
                  onChange={(e) => setEditZaloId(e.target.value)}
                  placeholder="Ví dụ: 66093251939302076 (để trống nếu chờ nhân sự nhắn tin vào OA)"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-indigo-500 font-mono text-xs"
                />
                {/^0[0-9]{9,10}$|^84[0-9]{9,10}$/.test(editZaloId.trim()) && (
                  <p className="text-[10.5px] text-amber-600 dark:text-amber-400 font-bold bg-amber-50 dark:bg-amber-950/60 p-2 rounded-lg border border-amber-200 dark:border-amber-800">
                    ⚠️ Chú ý: Bạn đang nhập số điện thoại. Zalo User ID là dãy số định danh do Zalo cấp (Ví dụ: 66093251939302076). Hãy để trống ô này để nhân sự tự nhắn tin vào OA hoặc lấy Zalo ID từ bảng Log.
                  </p>
                )}
                <p className="text-[10px] text-slate-400">
                  * Khi nhân sự nhắn tin lần đầu từ số điện thoại trên, hệ thống sẽ tự động khớp và lưu Zalo User ID.
                </p>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-slate-300">
                  Ghi chú phân quyền bổ sung:
                </label>
                <textarea
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Ghi chú nhân sự..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingBinding(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold cursor-pointer"
                >
                  Hủy Bỏ
                </button>
                <button
                  type="submit"
                  disabled={isSavingBinding}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-50"
                >
                  {isSavingBinding ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>Lưu Cập Nhật</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 2: DUYỆT CHIẾT KHẤU (BAN GIÁM ĐỐC) */}
      {/* ========================================================================= */}
      {activeSubTab === "approvals" && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h3 className="font-black text-slate-900 dark:text-white uppercase text-base flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-amber-500" />
                <span>DANH SÁCH BÁO GIÁ CẦN BAN GIÁM ĐỐC DUYỆT CHIẾT KHẤU</span>
              </h3>
              <p className="text-xs text-slate-500">
                Chính sách quản trị: Mọi báo giá có mức chiết khấu từ <strong>{config.director_discount_threshold}%</strong> trở lên đều phải có sự phê duyệt chính thức từ Ban Giám Đốc trước khi phát hành.
              </p>
            </div>

            <span className="text-xs font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 px-3 py-1 rounded-full border border-amber-200 dark:border-amber-900">
              {pendingApprovals.length} yêu cầu đang chờ
            </span>
          </div>

          {pendingApprovals.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-2">
              <CheckCircle2 className="w-12 h-12 text-emerald-500" />
              <div className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                Tất cả báo giá đã được xử lý xong!
              </div>
              <div className="text-xs text-slate-400 max-w-sm">
                Hiện không có báo giá nào vượt ngưỡng chiết khấu ({config.director_discount_threshold}%) đang chờ duyệt.
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {pendingApprovals.map((q) => (
                <div
                  key={q.id}
                  className="p-5 rounded-2xl border-2 border-amber-300 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-black text-indigo-700 dark:text-indigo-400 text-sm">
                        {q.quote_code}
                      </span>
                      <span className="px-2 py-0.5 text-[10px] font-black rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400 border border-rose-300 dark:border-rose-800">
                        Chiết khấu lớn: {q.discount_rate}%
                      </span>
                      <span className="text-[10px] text-slate-400">
                        Ngày tạo: {new Date(q.date).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
                      </span>
                    </div>

                    <div className="font-bold text-slate-900 dark:text-white text-sm">
                      {q.customer_name}
                    </div>

                    <div className="text-xs text-slate-600 dark:text-slate-300">
                      NVKD phụ trách: <strong>{q.sales_rep_name}</strong>
                    </div>

                    {/* Breakdown Numbers */}
                    <div className="grid grid-cols-3 gap-2 pt-2 max-w-md text-xs">
                      <div className="bg-white dark:bg-slate-800 p-2 rounded-xl border border-slate-200 dark:border-slate-700">
                        <div className="text-[10px] text-slate-400">Tiền hàng:</div>
                        <div className="font-bold text-slate-800 dark:text-slate-200">
                          {new Intl.NumberFormat("vi-VN").format(parseFloat(q.subtotal as any || 0))} đ
                        </div>
                      </div>
                      <div className="bg-rose-50 dark:bg-rose-950/40 p-2 rounded-xl border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300">
                        <div className="text-[10px] text-rose-400">Giảm trừ ({q.discount_rate}%):</div>
                        <div className="font-bold">
                          -{new Intl.NumberFormat("vi-VN").format(parseFloat(q.discount_amount as any || 0))} đ
                        </div>
                      </div>
                      <div className="bg-emerald-50 dark:bg-emerald-950/40 p-2 rounded-xl border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300">
                        <div className="text-[10px] text-emerald-500 font-bold">Thực thu (Gồm VAT):</div>
                        <div className="font-black">
                          {new Intl.NumberFormat("vi-VN").format(parseFloat(q.total_amount as any || 0))} đ
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex sm:flex-col items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleDirectorDecision(q.quote_code, "APPROVE")}
                      className="w-full px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer"
                    >
                      <Check className="w-4 h-4" />
                      <span>Phê Duyệt Ngay</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDirectorDecision(q.quote_code, "REJECT")}
                      className="w-full px-4 py-2 rounded-xl bg-rose-100 hover:bg-rose-200 text-rose-700 dark:bg-rose-950 dark:text-rose-300 font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                      <span>Từ Chối Báo Giá</span>
                    </button>

                    <a
                      href={`/api/zalo/quotation-pdf?code=${q.quote_code}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 mt-1"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Xem chi tiết báo giá</span>
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 3: GIẢ LẬP CHAT ZALO (PHONE SIMULATOR VỚI NHÂN SỰ THỰC TẾ) */}
      {/* ========================================================================= */}
      {activeSubTab === "chat_simulator" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Cột trái: Bảng điều khiển giả lập & Kịch bản mẫu */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
              <div>
                <h3 className="font-black text-slate-900 dark:text-white uppercase text-sm flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-emerald-500" />
                  <span>TRẢI NGHIỆM ĐIỀU HÀNH DI ĐỘNG QUA ZALO</span>
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Chọn một nhân sự thực tế từ cơ sở dữ liệu để trải nghiệm phản hồi tự động theo phân quyền thực tế.
                </p>
              </div>

              {/* Personnel Selector */}
              <div className="space-y-1.5 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                  <span>Chọn nhân sự đang gửi tin:</span>
                  {activeSimPersonnel?.connection_status === "NO_PHONE" ? (
                    <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">
                      Chưa có SĐT - Không kết nối
                    </span>
                  ) : activeSimPersonnel?.role === "DIRECTOR" ? (
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                      Quyền Duyệt BGĐ
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                      Có số Zalo
                    </span>
                  )}
                </label>

                <select
                  value={selectedPersonnelCode}
                  onChange={(e) => setSelectedPersonnelCode(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 font-bold text-slate-900 dark:text-white outline-none"
                >
                  <optgroup label="Ban Giám Đốc">
                    {bindings.filter(b => b.department === "Ban Giám Đốc").map(b => (
                      <option key={b.employee_id} value={b.employee_id}>
                        {b.employee_id} - {b.display_name} ({b.position})
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Kinh Doanh &amp; Marketing">
                    {bindings.filter(b => b.department === "Kinh Doanh" || b.department === "Marketing").map(b => (
                      <option key={b.employee_id} value={b.employee_id}>
                        {b.employee_id} - {b.display_name} {b.phone_number ? `(${b.phone_number})` : "[CHƯA CÓ SĐT]"}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Kho Vận &amp; Cung Ứng">
                    {bindings.filter(b => b.department === "Kho Vận" || b.department === "Mua Hàng & Cung Ứng").map(b => (
                      <option key={b.employee_id} value={b.employee_id}>
                        {b.employee_id} - {b.display_name} ({b.department})
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Kỹ Thuật / Pháp Chế / Kế Toán">
                    {bindings.filter(b => !["Ban Giám Đốc", "Kinh Doanh", "Marketing", "Kho Vận", "Mua Hàng & Cung Ứng"].includes(b.department)).map(b => (
                      <option key={b.employee_id} value={b.employee_id}>
                        {b.employee_id} - {b.display_name} ({b.department})
                      </option>
                    ))}
                  </optgroup>
                </select>

                <div className="text-[10px] text-slate-500 pt-1 flex items-center justify-between">
                  <span>Số điện thoại: <strong>{activeSimPersonnel?.phone_number || "Chưa cập nhật"}</strong></span>
                  <span>Chức vụ: <strong>{activeSimPersonnel?.position || "—"}</strong></span>
                </div>
              </div>

              {/* Preset Buttons */}
              <div className="space-y-2">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Bấm kịch bản mẫu để chạy thử ngay:
                </div>

                <button
                  type="button"
                  disabled={isSendingChat}
                  onClick={() => handleSendSimChat("Báo giá BV Bạch Mai: 20 kit HBV, 2 máy tách chiết 32 mẫu, ck 12%")}
                  className="w-full text-left p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 hover:bg-slate-100 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-all cursor-pointer"
                >
                  <div className="font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5 mb-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>1. Soạn Báo Giá CK 12% (Kích hoạt phê duyệt BGĐ)</span>
                  </div>
                  <div className="text-[11px] text-slate-500 line-clamp-1">
                    "Báo giá BV Bạch Mai: 20 kit HBV, 2 máy tách chiết 32 mẫu, ck 12%"
                  </div>
                </button>

                <button
                  type="button"
                  disabled={isSendingChat}
                  onClick={() => handleSendSimChat("Báo giá BV Chợ Rẫy: 10 kit HBV, 1 máy tách chiết 32 mẫu, ck 5%")}
                  className="w-full text-left p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 hover:bg-slate-100 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-all cursor-pointer"
                >
                  <div className="font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1.5 mb-1">
                    <FileText className="w-3.5 h-3.5" />
                    <span>2. Soạn Báo Giá CK 5% (Tự động duyệt &amp; sinh PDF)</span>
                  </div>
                  <div className="text-[11px] text-slate-500 line-clamp-1">
                    "Báo giá BV Chợ Rẫy: 10 kit HBV, 1 máy tách chiết 32 mẫu, ck 5%"
                  </div>
                </button>

                <button
                  type="button"
                  disabled={isSendingChat}
                  onClick={() => handleSendSimChat("Tồn kho KIT-HBV-100")}
                  className="w-full text-left p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 hover:bg-slate-100 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-all cursor-pointer"
                >
                  <div className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 mb-1">
                    <Package className="w-3.5 h-3.5" />
                    <span>3. Tra Cứu Tồn Kho &amp; Hạn Dùng FEFO</span>
                  </div>
                  <div className="text-[11px] text-slate-500">"Tồn kho KIT-HBV-100"</div>
                </button>

                <button
                  type="button"
                  disabled={isSendingChat}
                  onClick={() => handleSendSimChat("Giữ chỗ 20 KIT-HBV-100 cho BV Bạch Mai 48h")}
                  className="w-full text-left p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 hover:bg-slate-100 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-all cursor-pointer"
                >
                  <div className="font-bold text-purple-600 dark:text-purple-400 flex items-center gap-1.5 mb-1">
                    <Sliders className="w-3.5 h-3.5" />
                    <span>4. Khóa Giữ Chỗ Tồn Kho 48h</span>
                  </div>
                  <div className="text-[11px] text-slate-500 line-clamp-1">
                    "Giữ chỗ 20 KIT-HBV-100 cho BV Bạch Mai 48h"
                  </div>
                </button>

                <button
                  type="button"
                  disabled={isSendingChat}
                  onClick={() => handleSendSimChat("Daily: Đã làm việc với BS Trưởng khoa BV Bạch Mai về gói xét nghiệm")}
                  className="w-full text-left p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 hover:bg-slate-100 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-all cursor-pointer"
                >
                  <div className="font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5 mb-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span>5. Nộp Báo Cáo Nhật Ký Ngày (Daily)</span>
                  </div>
                  <div className="text-[11px] text-slate-500 line-clamp-1">
                    "Daily: Đã làm việc với BS Trưởng khoa BV Bạch Mai..."
                  </div>
                </button>

                {activeSimPersonnel?.role === "DIRECTOR" && (
                  <button
                    type="button"
                    disabled={isSendingChat}
                    onClick={() => handleSendSimChat("Duyệt BG-TBR-2609-0001")}
                    className="w-full text-left p-3 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 text-xs font-semibold transition-all cursor-pointer"
                  >
                    <div className="font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5 mb-1">
                      <Check className="w-3.5 h-3.5" />
                      <span>6. Ban Giám Đốc Phê Duyệt Lệnh (1-Chạm)</span>
                    </div>
                    <div className="text-[11px] text-slate-500">"Duyệt [Mã Báo Giá]"</div>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Cột phải: Khung điện thoại thông minh mô phỏng giao diện Zalo */}
          <div className="lg:col-span-7">
            <div className="max-w-md mx-auto bg-slate-100 dark:bg-slate-950 rounded-[40px] border-4 border-slate-800 p-3 shadow-2xl overflow-hidden flex flex-col h-[650px]">
              {/* Zalo App Bar */}
              <div className="bg-blue-600 text-white px-4 py-3 rounded-t-[30px] flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-white text-blue-600 font-black flex items-center justify-center text-xs shadow-sm">
                    TBRs
                  </div>
                  <div>
                    <div className="font-bold text-xs leading-tight">Công ty TNHH Khoa học TBR</div>
                    <div className="text-[10px] text-blue-100 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 inline-block" />
                      <span>Zalo OA Doanh Nghiệp (Online)</span>
                    </div>
                  </div>
                </div>

                <span className="text-[10px] bg-blue-700 px-2 py-0.5 rounded-full font-bold">
                  {activeSimPersonnel?.role === "DIRECTOR" ? "BGĐ" : activeSimPersonnel?.employee_id || "Khách"}
                </span>
              </div>

              {/* Chat Feed */}
              <div className="flex-1 p-3 overflow-y-auto space-y-3 text-xs bg-slate-100 dark:bg-slate-900">
                {chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
                  >
                    <div
                      className={`max-w-[85%] p-3.5 rounded-2xl shadow-sm leading-relaxed whitespace-pre-wrap ${
                        msg.sender === "user"
                          ? "bg-blue-600 text-white rounded-tr-xs"
                          : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-tl-xs border border-slate-200 dark:border-slate-700"
                      }`}
                    >
                      {msg.text}

                      {/* Interactive Buttons */}
                      {msg.buttons && msg.buttons.length > 0 && (
                        <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-700 space-y-1.5">
                          {msg.buttons.map((btn, bIdx) => (
                            <button
                              key={bIdx}
                              type="button"
                              onClick={() => {
                                if (btn.action === "view_pdf") {
                                  window.open(btn.payload, "_blank");
                                } else {
                                  handleSendSimChat(btn.payload);
                                }
                              }}
                              className={`w-full py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                                btn.action === "approve"
                                  ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                                  : btn.action === "reject"
                                  ? "bg-rose-600 hover:bg-rose-500 text-white"
                                  : "bg-blue-600 hover:bg-blue-500 text-white"
                              }`}
                            >
                              <span>{btn.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="text-[9px] text-slate-400 mt-1 px-1">{msg.time}</span>
                  </div>
                ))}

                {isSendingChat && (
                  <div className="flex items-center gap-1.5 text-slate-400 text-xs italic p-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-500" />
                    <span>Zalo OA đang soạn tin trả lời...</span>
                  </div>
                )}
              </div>

              {/* Chat Input Bar */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendSimChat();
                }}
                className="p-2 bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 rounded-b-[30px] flex items-center gap-2"
              >
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder={`Gõ tin nhắn gửi từ ${activeSimPersonnel?.display_name || "Nhân sự"}...`}
                  className="flex-1 px-3 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim() || isSendingChat}
                  className="p-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 4: CẤU HÌNH THÔNG SỐ ZALO OA & NGƯỠNG CHIẾT KHẤU BGĐ */}
      {/* ========================================================================= */}
      {activeSubTab === "config" && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h3 className="font-black text-slate-900 dark:text-white uppercase text-base flex items-center gap-2">
                <Settings className="w-5 h-5 text-purple-500" />
                <span>CẤU HÌNH KẾT NỐI ZALO OFFICIAL ACCOUNT &amp; CHÍNH SÁCH PHÊ DUYỆT</span>
              </h3>
              <p className="text-xs text-slate-500">
                Nhập các tham số API được cấp từ Cổng Zalo Developer sau khi công ty đăng ký thành công tài khoản Zalo Doanh Nghiệp.
              </p>
            </div>
            <button
              type="button"
              onClick={fetchData}
              disabled={loading}
              className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-2 cursor-pointer transition-all border border-slate-200 dark:border-slate-700 shrink-0 self-start sm:self-auto shadow-2xs"
              title="Tải lại thông tin mới nhất đã lưu từ máy chủ"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>Đồng bộ từ máy chủ</span>
            </button>
          </div>

          <form onSubmit={handleSaveConfig} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 dark:text-slate-300">
                  Tên Zalo Official Account:
                </label>
                <input
                  type="text"
                  value={config.oa_name}
                  onChange={(e) => setConfig({ ...config, oa_name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-semibold"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 dark:text-slate-300">
                  OA ID (Official Account ID):
                </label>
                <input
                  type="text"
                  value={config.oa_id}
                  onChange={(e) => setConfig({ ...config, oa_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 dark:text-slate-300">
                  Zalo App ID:
                </label>
                <input
                  type="text"
                  value={config.app_id}
                  onChange={(e) => setConfig({ ...config, app_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 dark:text-slate-300">
                  Secret Key:
                </label>
                <input
                  type="password"
                  value={config.secret_key}
                  onChange={(e) => setConfig({ ...config, secret_key: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <span>Access Token (Dùng gọi API - Thời hạn 25 giờ):</span>
                  </label>
                  <span className="text-[10px] text-slate-500">Mã cấp quyền gọi API Zalo</span>
                </div>
                <textarea
                  rows={3}
                  value={config.access_token}
                  onChange={(e) => setConfig({ ...config, access_token: e.target.value })}
                  placeholder="Dán mã OA Access Token (bắt đầu bằng chuỗi ký tự được cấp từ developers.zalo.me/tools/explorer)..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-slate-900 dark:text-white text-xs"
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-indigo-700 dark:text-indigo-400 flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Refresh Token (Cấp kèm khi tạo Access Token - Thời hạn 3 tháng):</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleRenewToken}
                    disabled={isRenewingToken}
                    className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] flex items-center gap-1.5 cursor-pointer transition-all disabled:opacity-50 shadow-xs"
                    title="Dùng Secret Key và Refresh Token để lấy ngay Access Token mới"
                  >
                    <RefreshCw className={`w-3 h-3 ${isRenewingToken ? "animate-spin" : ""}`} />
                    <span>{isRenewingToken ? "Đang đổi token..." : "Đổi Access Token Mới Ngay"}</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={config.refresh_token}
                  onChange={(e) => setConfig({ ...config, refresh_token: e.target.value })}
                  placeholder="Dán chuỗi Refresh Token vào đây để hệ thống tự động làm mới Access Token khi hết hạn..."
                  className="w-full px-3 py-2 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 font-mono text-slate-900 dark:text-white text-xs"
                />
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block font-semibold">
                  ⚡ <strong>Cơ chế tự động làm mới đang BẬT:</strong> Mỗi khi gửi tin nhắn hoặc nhận webhook, nếu Access Token hết hạn (hoặc cũ hơn 20 giờ), hệ thống sẽ <strong>tự động đổi token mới qua Zalo OAuth v4 và gửi lại tin nhắn ngay lập tức</strong> mà không cần người dùng phải bấm làm mới thủ công!
                </span>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 dark:text-slate-300">
                  Webhook Verify Token:
                </label>
                <input
                  type="text"
                  value={config.webhook_verify_token}
                  onChange={(e) => setConfig({ ...config, webhook_verify_token: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-amber-500" />
                  <span>Ngưỡng Chiết Khấu Cần Ban Giám Đốc Duyệt (%):</span>
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="100"
                  value={config.director_discount_threshold}
                  onChange={(e) => setConfig({ ...config, director_discount_threshold: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 font-black text-amber-900 dark:text-amber-200 text-sm"
                />
                <span className="text-[10px] text-slate-500">
                  Mọi báo giá từ nhân viên có chiết khấu lớn hơn hoặc bằng mức này sẽ tự động chuyển tiếp tới Ban Giám Đốc.
                </span>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 dark:text-slate-300">
                  Số điện thoại Ban Giám Đốc nhận cảnh báo duyệt:
                </label>
                <input
                  type="text"
                  value={config.director_phone}
                  onChange={(e) => setConfig({ ...config, director_phone: e.target.value })}
                  placeholder="0916033652"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 dark:text-slate-300">
                  Địa Chỉ Webhook URL Cần Khai Báo Trên Zalo Developer:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={webhookPublicUrl}
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-slate-600 dark:text-slate-300 text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleCopyWebhook}
                    className="px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 font-bold text-xs cursor-pointer"
                  >
                    {copiedUrl ? "Đã chép" : "Chép"}
                  </button>
                </div>
              </div>
            </div>

            {/* Test Result Alert */}
            {testResult && (
              <div
                className={`p-4 rounded-2xl border text-xs ${
                  testResult.success
                    ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200"
                    : "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200"
                }`}
              >
                <div className="flex items-start gap-3">
                  {testResult.success ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1.5 flex-1">
                    <div className="font-black text-sm uppercase">
                      {testResult.success ? "Kết Nối Zalo OpenAPI Thành Công" : "Kiểm Tra Kết Nối Chưa Thành Công"}
                    </div>
                    <p className="whitespace-pre-line leading-relaxed font-medium">
                      {testResult.message}
                    </p>
                    {testResult.oa_info && (
                      <div className="mt-2 pt-2 border-t border-emerald-200 dark:border-emerald-800/60 grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-[11px]">
                        <div><strong>OA:</strong> {testResult.oa_info.name}</div>
                        <div><strong>OA ID:</strong> {testResult.oa_info.oa_id}</div>
                        <div><strong>Loại gói:</strong> {testResult.oa_info.package_name || "Doanh nghiệp"}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTestingConnection}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 cursor-pointer shadow-md transition-all disabled:opacity-50"
              >
                <Activity className={`w-4 h-4 ${isTestingConnection ? "animate-spin" : ""}`} />
                <span>{isTestingConnection ? "Đang gọi Zalo OpenAPI..." : "Kiểm Tra Liên Kết Zalo (API)"}</span>
              </button>

              <button
                type="submit"
                className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-2 cursor-pointer shadow-md transition-all"
              >
                <Save className="w-4 h-4" />
                <span>Lưu Cấu Hình Gateway &amp; Ngưỡng Phê Duyệt</span>
              </button>
            </div>
          </form>

          {/* ========================================================================= */}
          {/* HƯỚNG DẪN 4 BƯỚC KIỂM TRA LIÊN KẾT ZALO THỰC TẾ */}
          {/* ========================================================================= */}
          <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-50 to-blue-50/40 dark:from-slate-800/80 dark:to-blue-950/20 border border-slate-200 dark:border-slate-700/60 space-y-4">
            <div className="flex items-center gap-2 text-blue-900 dark:text-blue-300 font-black text-xs uppercase">
              <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>4 Cách Kiểm Tra &amp; Nghiệm Thu Kết Nối Zalo Official Account</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {/* Bước 1 */}
              <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5 shadow-2xs">
                <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 flex items-center justify-center text-[10px] font-black">1</span>
                  <span>Kiểm tra trực tiếp tại nút "Kiểm Tra Liên Kết Zalo"</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Nhấn nút xanh phía trên. Hệ thống sẽ gọi trực tiếp Zalo OpenAPI (<code className="bg-slate-100 dark:bg-slate-800 px-1 rounded font-mono">/v2.0/oa/getoa</code>) để xác minh xem Access Token còn hiệu lực và đúng OA hay không.
                </p>
              </div>

              {/* Bước 2 */}
              <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5 shadow-2xs">
                <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200 flex items-center justify-center text-[10px] font-black">2</span>
                  <span>Xác thực Webhook trên Zalo Developer</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Vào <a href="https://developers.zalo.me" target="_blank" rel="noreferrer" className="text-blue-600 underline font-semibold">developers.zalo.me</a> &gt; App ID <span className="font-mono font-bold">2331222115598746556</span> &gt; Webhook. Dán URL và Verify Token rồi bấm <strong>Kiểm tra</strong> để Zalo xác nhận đường truyền.
                </p>
              </div>

              {/* Bước 3 */}
              <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5 shadow-2xs">
                <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 flex items-center justify-center text-[10px] font-black">3</span>
                  <span>Nhắn tin thực tế từ điện thoại vào OA</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Mở Zalo trên điện thoại, tìm <strong>"Công ty TNHH Khoa học TBR"</strong>, bấm Quan tâm và gửi tin nhắn (ví dụ: <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded font-mono">menu</code> hoặc <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded font-mono">báo giá</code>). Sau đó kiểm tra tab <strong>Nhật Ký Tin Nhắn</strong>.
                </p>
              </div>

              {/* Bước 4 */}
              <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5 shadow-2xs">
                <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 flex items-center justify-center text-[10px] font-black">4</span>
                  <span>Thử nghiệm trong tab "Giả Lập Chat Zalo"</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Chuyển sang tab <strong>Giả Lập Chat Zalo</strong> bên cạnh. Chọn 1 nhân sự đã liên kết SĐT (VD: NV-TBR-018) và gõ lệnh để kiểm tra cơ chế tự động tra kho, tính chiết khấu và kích hoạt duyệt của Ban Giám Đốc.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 5: NHẬT KÝ TIN NHẮN (AUDIT LOGS) */}
      {/* ========================================================================= */}
      {activeSubTab === "logs" && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h3 className="font-black text-slate-900 dark:text-white uppercase text-base flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-500" />
                <span>LỊCH SỬ TIN NHẮN VÀ HOẠT ĐỘNG QUA ZALO</span>
              </h3>
              <p className="text-xs text-slate-500">
                Toàn bộ dữ liệu tin nhắn vào/ra, yêu cầu báo giá và phê duyệt của Ban Giám Đốc đều được lưu vết.
              </p>
            </div>

            <span className="text-xs text-slate-400 font-mono">
              Hiển thị {logs.length} sự kiện gần nhất
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-[10px] font-bold text-slate-400 uppercase">
                  <th className="py-2.5 px-3">Thời Điểm</th>
                  <th className="py-2.5 px-3">Chiều Tin</th>
                  <th className="py-2.5 px-3">Đối Tượng / Người Gửi</th>
                  <th className="py-2.5 px-3">Loại Tin</th>
                  <th className="py-2.5 px-3">Nội Dung Tin Nhắn</th>
                  <th className="py-2.5 px-3">Trạng Thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-3 font-mono text-[10px] text-slate-400">
                      {new Date(log.created_at).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} {new Date(log.created_at).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          log.direction === "INBOUND"
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        }`}
                      >
                        {log.direction === "INBOUND" ? "Nhận Vào" : "Gửi Đi"}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-bold text-slate-800 dark:text-slate-200">{log.sender_name || "Khách"}</div>
                      <div className="text-[10px] font-mono text-slate-400 flex items-center gap-1.5 flex-wrap">
                        <span>{log.zalo_user_id}</span>
                        {log.status === "UNLINKED" && log.zalo_user_id && !log.zalo_user_id.startsWith("0") && (
                          <button
                            type="button"
                            onClick={() => {
                              const targetEmp = bindings.find(b => !b.zalo_user_id || b.zalo_user_id === b.phone_number);
                              if (targetEmp) {
                                handleOpenEdit(targetEmp);
                                setEditZaloId(log.zalo_user_id);
                              } else if (bindings.length > 0) {
                                handleOpenEdit(bindings[0]);
                                setEditZaloId(log.zalo_user_id);
                              }
                            }}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 font-bold cursor-pointer"
                            title="Bấm để gán Zalo User ID này cho nhân sự trong danh bạ"
                          >
                            + Gán Zalo ID
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[10px]">{log.message_type}</td>
                    <td className="py-2.5 px-3 max-w-lg">
                      <div className="relative group">
                        <div className={`${expandedLogIds[log.id] ? "" : "line-clamp-2"} text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed`}>
                          {log.content}
                        </div>

                        {/* File & Link shortcuts directly on row */}
                        {extractUrls(log.content).length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {extractUrls(log.content).map((url: string, uIdx: number) => (
                              <a
                                key={uIdx}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/80 dark:text-blue-300 dark:hover:bg-blue-900 border border-blue-200 dark:border-blue-800 transition-colors shadow-sm"
                                title="Bấm để mở file hoặc xem liên kết"
                              >
                                <FileText className="w-3 h-3 text-blue-600" />
                                <span>{url.includes("pdf") || url.includes("quotation") ? "📄 Mở File Báo Giá PDF" : "🔗 Mở File / Liên kết"}</span>
                                <ExternalLink className="w-2.5 h-2.5 text-blue-500" />
                              </a>
                            ))}
                          </div>
                        )}

                        {/* Toggle expand & view details button */}
                        <div className="flex items-center gap-2 mt-1">
                          {(log.content.length > 80 || log.content.includes("\n")) && (
                            <button
                              type="button"
                              onClick={() => setExpandedLogIds(prev => ({ ...prev, [log.id]: !prev[log.id] }))}
                              className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5"
                            >
                              {expandedLogIds[log.id] ? "Thu gọn ▲" : "Xem thêm ▼"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setSelectedLog(log)}
                            className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:underline cursor-pointer"
                            title="Mở hộp thoại xem chi tiết toàn văn tin nhắn và tệp đính kèm"
                          >
                            <Eye className="w-3 h-3" />
                            <span>Xem chi tiết</span>
                          </button>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      {log.status === "SENT" || log.status === "CONNECTED" || log.status === "SUCCESS" ? (
                        <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                          {log.status}
                        </span>
                      ) : log.status === "UNLINKED" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" title="Tài khoản Zalo này chưa liên kết với hồ sơ nhân sự nào">
                          <AlertTriangle className="w-3 h-3 text-amber-600" />
                          <span>CHƯA LIÊN KẾT</span>
                        </span>
                      ) : log.status?.includes("-224") ? (
                        <div className="space-y-0.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300" title="Zalo OA chưa đăng ký hoặc hết hạn Gói dịch vụ trả phí (Gói Tăng trưởng/Nâng cao) trên Zalo Cloud">
                            <AlertOctagon className="w-3 h-3 text-rose-600" />
                            <span>FAILED -224</span>
                          </span>
                          <div className="text-[9px] text-rose-600 dark:text-rose-400 font-medium">Chưa mua gói OA Zalo Cloud</div>
                        </div>
                      ) : log.status?.includes("-216") || log.status?.includes("-204") || log.status?.includes("FAILED_TOKEN_EXPIRED") ? (
                        <div className="space-y-0.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" title="Refresh Token đã hết hạn 3 tháng hoặc cấu hình Secret Key Zalo không hợp lệ">
                            <AlertTriangle className="w-3 h-3 text-amber-600" />
                            <span>FAILED TOKEN HẾT HẠN</span>
                          </span>
                          <div className="text-[9px] text-amber-600 dark:text-amber-400 font-medium">Cần cấp lại Refresh Token</div>
                        </div>
                      ) : log.status === "FAILED_NO_TOKEN" ? (
                        <div className="space-y-0.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300" title="Hệ thống chưa có Access Token chính thức từ Zalo Developers">
                            <AlertOctagon className="w-3 h-3 text-rose-600" />
                            <span>CHƯA CÓ TOKEN</span>
                          </span>
                          <div className="text-[9px] text-rose-600 dark:text-rose-400 font-medium">Cần dán Access Token vào Cấu hình</div>
                        </div>
                      ) : (
                        <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400">
                          {log.status}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}

                {logs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      Chưa có sự kiện tin nhắn nào được ghi nhận.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL XEM CHI TIẾT TOÀN VĂN TIN NHẮN & FILE ĐÍNH KÈM */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/80">
              <div className="flex items-center gap-2.5">
                <div className={`p-2 rounded-xl ${selectedLog.direction === "INBOUND" ? "bg-blue-100 dark:bg-blue-950 text-blue-600" : "bg-emerald-100 dark:bg-emerald-950 text-emerald-600"}`}>
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm flex items-center gap-2">
                    Chi Tiết Tin Nhắn {selectedLog.direction === "INBOUND" ? "Nhận Vào" : "Gửi Đi"}
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      selectedLog.status === "SENT" || selectedLog.status === "CONNECTED" || selectedLog.status === "SUCCESS"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        : selectedLog.status === "UNLINKED"
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                        : "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                    }`}>
                      {selectedLog.status}
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {new Date(selectedLog.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} • {selectedLog.sender_name || "Người dùng"} ({selectedLog.zalo_user_id})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              {/* If URLs are present, display prominent action cards */}
              {extractUrls(selectedLog.content).length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Tệp & Liên kết đính kèm:</div>
                  {extractUrls(selectedLog.content).map((url: string, uIdx: number) => (
                    <div key={uIdx} className="flex items-center justify-between p-3 rounded-xl bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="p-2 rounded-lg bg-blue-600 text-white shrink-0">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="overflow-hidden">
                          <div className="font-bold text-xs text-blue-900 dark:text-blue-200 truncate">
                            {url.includes("quotation-pdf") ? "Báo Giá Chính Thức (File PDF)" : "Tệp Tài Liệu Đính Kèm"}
                          </div>
                          <div className="text-[10px] text-blue-700/70 dark:text-blue-400 font-mono truncate">{url}</div>
                        </div>
                      </div>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors whitespace-nowrap ml-3 shrink-0"
                      >
                        <span>Mở File Ngay</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Nội dung chi tiết:</span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(selectedLog.content);
                      alert("Đã sao chép nội dung tin nhắn!");
                    }}
                    className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 font-bold cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Sao chép toàn bộ</span>
                  </button>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 font-mono whitespace-pre-wrap leading-relaxed select-text max-h-[350px] overflow-y-auto">
                  {selectedLog.content}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium text-xs transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

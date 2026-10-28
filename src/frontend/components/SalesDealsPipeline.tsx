"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  TrendingUp,
  BarChart3,
  DollarSign,
  Calendar,
  Building2,
  Users,
  Plus,
  Search,
  Filter,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  FileText,
  AlertTriangle,
  Award,
  ChevronRight,
  MoreVertical,
  Check,
  X,
  FileCheck,
  RefreshCw,
  ExternalLink
} from "lucide-react";
import { Modal } from "@/frontend/components/Modal";
import { useNotification } from "@/frontend/contexts/NotificationContext";
import { useAuth } from "@/frontend/contexts/AuthContext";
import { usePersonnel, filterPersonnelByDept } from "@/frontend/utils/usePersonnel";

export type DealStage =
  | "LEAD"          // Giai đoạn 1: Lead / Tiếp cận ban đầu (10%)
  | "NEEDS_SPEC"    // Giai đoạn 2: Khảo sát & Tư vấn cấu hình Spec-in (25%)
  | "DEMO_EVAL"     // Giai đoạn 3: Demo chạy thử & Đánh giá lâm sàng tại viện (50%)
  | "PROPOSAL_BID"  // Giai đoạn 4: Báo giá chính thức / Nộp hồ sơ thầu (70%)
  | "NEGOTIATION"   // Giai đoạn 5: Đàm phán giá & Điều khoản hợp đồng (90%)
  | "CLOSED_WON"    // Giai đoạn 6A: Thành công - Ký hợp đồng (100%)
  | "CLOSED_LOST";  // Giai đoạn 6B: Thất bại - Ghi nhận lý do (0%)

export interface SalesDeal {
  id: string;
  code: string;
  title: string;
  customerName: string;
  hospitalDepartment: string;
  productLine: string;
  estimatedValue: number; // VNĐ
  stage: DealStage;
  winProbability: number; // 0 - 100%
  expectedCloseDate: string; // dd/mm/yyyy
  assignedRep: string;
  assignedRepId?: string;
  priority: "KHAN_CAP" | "CAO" | "TRUNG_BINH";
  notes?: string;
  lostReason?: string;
  appRequestSent?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export const STAGE_CONFIG: Record<
  DealStage,
  {
    title: string;
    stepNumber: number;
    winProbability: number;
    headerColor: string;
    badgeBg: string;
    borderColor: string;
    description: string;
  }
> = {
  LEAD: {
    title: "1. Tiếp Cận Ban Đầu",
    stepNumber: 1,
    winProbability: 10,
    headerColor: "from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800 text-slate-900 dark:text-slate-100",
    badgeBg: "bg-slate-300 text-slate-800 dark:bg-slate-800 dark:text-slate-300",
    borderColor: "border-slate-300 dark:border-slate-700",
    description: "Nhận diện nhu cầu mua sắm thiết bị & hóa chất"
  },
  NEEDS_SPEC: {
    title: "2. Khảo Sát & Spec-in",
    stepNumber: 2,
    winProbability: 25,
    headerColor: "from-blue-100 to-indigo-100 dark:from-blue-900 dark:to-indigo-950 text-blue-950 dark:text-blue-100",
    badgeBg: "bg-blue-200 text-blue-900 dark:bg-blue-900/60 dark:text-blue-300",
    borderColor: "border-blue-200 dark:border-blue-800",
    description: "Tư vấn cấu hình kỹ thuật đưa vào hồ sơ viện"
  },
  DEMO_EVAL: {
    title: "3. Demo Lâm Sàng (App)",
    stepNumber: 3,
    winProbability: 50,
    headerColor: "from-purple-100 to-indigo-100 dark:from-purple-900 dark:to-indigo-950 text-purple-950 dark:text-purple-100",
    badgeBg: "bg-purple-200 text-purple-900 dark:bg-purple-900/60 dark:text-purple-300",
    borderColor: "border-purple-200 dark:border-purple-800",
    description: "Phối hợp phòng App chạy thử máy & kiểm định kit"
  },
  PROPOSAL_BID: {
    title: "4. Báo Giá / Hồ Sơ Thầu",
    stepNumber: 4,
    winProbability: 70,
    headerColor: "from-amber-100 to-orange-100 dark:from-amber-900 dark:to-orange-950 text-amber-950 dark:text-amber-100",
    badgeBg: "bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-300",
    borderColor: "border-amber-200 dark:border-amber-800",
    description: "Gửi báo giá chính thức hoặc nộp hồ sơ dự thầu"
  },
  NEGOTIATION: {
    title: "5. Đàm Phán Hợp Đồng",
    stepNumber: 5,
    winProbability: 90,
    headerColor: "from-teal-100 to-cyan-100 dark:from-cyan-900 dark:to-teal-950 text-teal-950 dark:text-cyan-100",
    badgeBg: "bg-teal-200 text-teal-900 dark:bg-cyan-900/60 dark:text-cyan-300",
    borderColor: "border-teal-200 dark:border-cyan-800",
    description: "Chốt điều khoản công nợ, bảo hành & tiến độ giao"
  },
  CLOSED_WON: {
    title: "6. Ký Hợp Đồng (Won)",
    stepNumber: 6,
    winProbability: 100,
    headerColor: "from-emerald-100 to-green-100 dark:from-emerald-900 dark:to-green-950 text-emerald-950 dark:text-emerald-100",
    badgeBg: "bg-emerald-200 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-300",
    borderColor: "border-emerald-200 dark:border-emerald-800",
    description: "Ký HĐ chính thức & chuyển Cung ứng xuất kho"
  },
  CLOSED_LOST: {
    title: "Đã Đóng (Lost)",
    stepNumber: 0,
    winProbability: 0,
    headerColor: "from-rose-100 to-slate-200 dark:from-rose-950 dark:to-slate-900 text-rose-950 dark:text-rose-100",
    badgeBg: "bg-rose-200 text-rose-900 dark:bg-rose-950/60 dark:text-rose-400",
    borderColor: "border-rose-200 dark:border-rose-900",
    description: "Trượt thầu / Viện hoãn dự án (Có lưu lý do)"
  }
};

const STAGE_ORDER: DealStage[] = [
  "LEAD",
  "NEEDS_SPEC",
  "DEMO_EVAL",
  "PROPOSAL_BID",
  "NEGOTIATION",
  "CLOSED_WON"
];

interface SalesDealsPipelineProps {
  onNavigateToTab?: (tab: string) => void;
}

export const SalesDealsPipeline: React.FC<SalesDealsPipelineProps> = ({ onNavigateToTab }) => {
  const { showToast } = useNotification();
  const { user } = useAuth();
  const personnel = usePersonnel();
  const salesStaff = useMemo(() => filterPersonnelByDept(personnel, ["kinh doanh", "sales", "marketing", "giám đốc"]), [personnel]);

  const [deals, setDeals] = useState<SalesDeal[]>([]);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [repFilter, setRepFilter] = useState("all");
  const [productFilter, setProductFilter] = useState("all");
  const [showLostColumn, setShowLostColumn] = useState(false);

  // Modals
  const [isNewDealModalOpen, setIsNewDealModalOpen] = useState(false);
  const [selectedDealForAction, setSelectedDealForAction] = useState<SalesDeal | null>(null);
  const [isLostReasonModalOpen, setIsLostReasonModalOpen] = useState(false);
  const [lostReasonText, setLostReasonText] = useState("Giá đối thủ thấp hơn");

  // New Deal Form State
  const [newDealForm, setNewDealForm] = useState({
    title: "",
    customerName: "",
    hospitalDepartment: "Khoa Xét Nghiệm",
    productLine: "Real-time PCR & Kit Xét Nghiệm",
    estimatedValue: 500000000,
    stage: "LEAD" as DealStage,
    expectedCloseDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
    assignedRep: String(user?.full_name || user?.name || "").trim(),
    priority: "CAO" as SalesDeal["priority"],
    notes: ""
  });

  // Sync with PostgreSQL
  useEffect(() => {
    const loadDeals = async () => {
      try {
        const res = await fetch("/api/storage?key=sales_deals_pipeline");
        const json = await res.json();
        if (json && Array.isArray(json.data) && json.data.length > 0) {
          setDeals(json.data);
        }
      } catch (err) {
        console.error("Error loading sales deals:", err);
      }
    };
    loadDeals();
  }, []);

  const saveDeals = async (updated: SalesDeal[]) => {
    setDeals(updated);
    try {
      await fetch("/api/storage?key=sales_deals_pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "sales_deals_pipeline", data: updated })
      });
    } catch (e) {
      console.error(e);
    }
  };

  // Executive Pipeline Metrics Calculation
  const pipelineMetrics = useMemo(() => {
    // Chỉ tính các deal đang hoạt động (Stage 1-5, không tính Lost và đã Won)
    const activeDeals = deals.filter(d => d.stage !== "CLOSED_LOST" && d.stage !== "CLOSED_WON");
    const wonDeals = deals.filter(d => d.stage === "CLOSED_WON");
    const lostDeals = deals.filter(d => d.stage === "CLOSED_LOST");

    const totalPipelineValue = activeDeals.reduce((sum, d) => sum + (d.estimatedValue || 0), 0);
    const weightedForecast = activeDeals.reduce((sum, d) => {
      const prob = STAGE_CONFIG[d.stage]?.winProbability || 0;
      return sum + (d.estimatedValue * prob) / 100;
    }, 0);

    const totalClosed = wonDeals.length + lostDeals.length;
    const winRatePercent = totalClosed > 0 ? Math.round((wonDeals.length / totalClosed) * 100) : 0;
    const totalWonValue = wonDeals.reduce((sum, d) => sum + (d.estimatedValue || 0), 0);

    return {
      activeCount: activeDeals.length,
      totalPipelineValue,
      weightedForecast,
      winRatePercent,
      wonCount: wonDeals.length,
      totalWonValue
    };
  }, [deals]);

  // Filtered Deals
  const filteredDeals = useMemo(() => {
    return deals.filter(d => {
      const q = searchQuery.toLowerCase();
      const matchSearch =
        !q ||
        d.title.toLowerCase().includes(q) ||
        d.customerName.toLowerCase().includes(q) ||
        d.productLine.toLowerCase().includes(q) ||
        d.code.toLowerCase().includes(q) ||
        d.assignedRep.toLowerCase().includes(q);

      const matchRep = repFilter === "all" || d.assignedRep === repFilter;
      const matchProduct = productFilter === "all" || d.productLine.includes(productFilter);

      return matchSearch && matchRep && matchProduct;
    });
  }, [deals, searchQuery, repFilter, productFilter]);

  // Move deal to next stage
  const handleAdvanceStage = (deal: SalesDeal) => {
    const currentIndex = STAGE_ORDER.indexOf(deal.stage);
    if (currentIndex >= 0 && currentIndex < STAGE_ORDER.length - 1) {
      const nextStage = STAGE_ORDER[currentIndex + 1];
      const updated = deals.map(d =>
        d.id === deal.id
          ? {
              ...d,
              stage: nextStage,
              winProbability: STAGE_CONFIG[nextStage].winProbability,
              updatedAt: new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
            }
          : d
      );
      saveDeals(updated);
      showToast(`Đã chuyển thương vụ "${deal.title.slice(0, 30)}..." sang "${STAGE_CONFIG[nextStage].title}"!`, "success");
    }
  };

  // Move deal to previous stage
  const handleRegressStage = (deal: SalesDeal) => {
    const currentIndex = STAGE_ORDER.indexOf(deal.stage);
    if (currentIndex > 0) {
      const prevStage = STAGE_ORDER[currentIndex - 1];
      const updated = deals.map(d =>
        d.id === deal.id
          ? {
              ...d,
              stage: prevStage,
              winProbability: STAGE_CONFIG[prevStage].winProbability,
              updatedAt: new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
            }
          : d
      );
      saveDeals(updated);
      showToast(`Đã lùi thương vụ về "${STAGE_CONFIG[prevStage].title}"!`, "info");
    }
  };

  // Mark as Closed Lost
  const handleConfirmLost = () => {
    if (!selectedDealForAction) return;
    const updated = deals.map(d =>
      d.id === selectedDealForAction.id
        ? {
            ...d,
            stage: "CLOSED_LOST" as DealStage,
            winProbability: 0,
            lostReason: lostReasonText,
            updatedAt: new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
          }
        : d
    );
    saveDeals(updated);
    setIsLostReasonModalOpen(false);
    setSelectedDealForAction(null);
    showToast(`Đã ghi nhận thương vụ thất bại và lưu lý do phân tích!`, "info");
  };

  // Quick Action: Send Demo Request to App Dept
  const handleSendAppRequest = (deal: SalesDeal) => {
    const updated = deals.map(d =>
      d.id === deal.id ? { ...d, appRequestSent: true } : d
    );
    saveDeals(updated);
    showToast(`Đã gửi yêu cầu hỗ trợ Demo & Đánh giá lâm sàng sang Phòng Application!`, "success");
  };

  // Create New Deal
  const handleCreateDeal = (e: React.FormEvent) => {
    e.preventDefault();
    const newDeal: SalesDeal = {
      id: `DEAL-${Date.now().toString().slice(-6)}`,
      code: `DEAL-${Date.now().toString().slice(-4)}`,
      title: newDealForm.title,
      customerName: newDealForm.customerName,
      hospitalDepartment: newDealForm.hospitalDepartment,
      productLine: newDealForm.productLine,
      estimatedValue: Number(newDealForm.estimatedValue),
      stage: newDealForm.stage,
      winProbability: STAGE_CONFIG[newDealForm.stage]?.winProbability || 10,
      expectedCloseDate: newDealForm.expectedCloseDate,
      assignedRep: newDealForm.assignedRep,
      priority: newDealForm.priority,
      notes: newDealForm.notes,
      createdAt: new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
    };

    const updated = [newDeal, ...deals];
    saveDeals(updated);
    setIsNewDealModalOpen(false);
    showToast(`Đã thêm thương vụ tiềm năng "${newDeal.title}" vào phễu bán hàng!`, "success");
  };

  const formatVND = (num: number) => {
    if (num >= 1000000000) {
      return `${(num / 1000000000).toFixed(2)} tỷ`;
    }
    return `${(num / 1000000).toFixed(0)} tr`;
  };

  return (
    <div className="space-y-6">
      {/* 4 Executive Pipeline KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
            <span>Tổng Giá Trị Phễu Bán Hàng</span>
            <DollarSign className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">
            {formatVND(pipelineMetrics.totalPipelineValue)} VNĐ
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Từ <strong>{pipelineMetrics.activeCount} thương vụ</strong> đang tiếp cận &amp; đàm phán
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
            <span>Dự Báo Doanh Thu Trọng Số</span>
            <TrendingUp className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
            {formatVND(pipelineMetrics.weightedForecast)} VNĐ
          </div>
          <div className="text-[11px] text-emerald-600 font-medium mt-0.5">
            Dự thu kỳ vọng: Giá trị × Xác suất thành công
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
            <span>Tỷ Lệ Chốt Deal Thành Công</span>
            <Award className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-amber-500 mt-1">
            {pipelineMetrics.winRatePercent}%
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Đã ký: <strong>{pipelineMetrics.wonCount} hợp đồng</strong> ({formatVND(pipelineMetrics.totalWonValue)} VNĐ)
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
            <span>Phối Hợp Phòng Application</span>
            <Sparkles className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-1">
            {deals.filter(d => d.stage === "DEMO_EVAL").length} Dự án Demo
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Chuyên viên FAS đang thẩm định tại bệnh viện
          </div>
        </div>
      </div>

      {/* Filter & Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Tìm theo tên thương vụ, Bệnh viện, NVKD phụ trách, Mã deal..."
            className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={repFilter}
            onChange={e => setRepFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-slate-200 cursor-pointer"
          >
            <option value="all">Tất cả NVKD</option>
            {salesStaff.map(p => (
              <option key={p.employee_code || p.full_name} value={p.full_name}>{p.full_name}{p.position ? ` (${p.position})` : ""}</option>
            ))}
          </select>

          <button
            onClick={() => setShowLostColumn(prev => !prev)}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
              showLostColumn
                ? "bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-900"
                : "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
            }`}
          >
            {showLostColumn ? "Ẩn cột Thất bại (Lost)" : "Hiện cột Thất bại (Lost)"}
          </button>

          <button
            onClick={() => setIsNewDealModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>+ Tạo Cơ Hội Mới (New Deal)</span>
          </button>
        </div>
      </div>

      {/* 6-Stage Kanban Pipeline Board */}
      <div className="overflow-x-auto pb-4">
        <div className="flex gap-4 min-w-[1300px]">
          {STAGE_ORDER.map(stageKey => {
            const config = STAGE_CONFIG[stageKey];
            const stageDeals = filteredDeals.filter(d => d.stage === stageKey);
            const stageTotalValue = stageDeals.reduce((sum, d) => sum + (d.estimatedValue || 0), 0);

            return (
              <div
                key={stageKey}
                className="w-72 shrink-0 flex flex-col bg-slate-100/70 dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xs"
              >
                {/* Stage Column Header */}
                <div className={`p-3 bg-gradient-to-r ${config.headerColor} border-b ${config.borderColor}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs uppercase tracking-tight">{config.title}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-900/10 dark:bg-white/20 text-slate-800 dark:text-white">
                      {config.winProbability}% Win
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-white/80 mt-1.5 pt-1.5 border-t border-slate-900/10 dark:border-white/10 font-mono">
                    <span className="font-medium">{stageDeals.length} thương vụ</span>
                    <span className="font-bold text-slate-900 dark:text-white">{formatVND(stageTotalValue)} VNĐ</span>
                  </div>
                </div>

                {/* Stage Deals Cards Container */}
                <div className="p-2.5 flex-1 space-y-3 overflow-y-auto max-h-[650px] min-h-[220px]">
                  {stageDeals.length === 0 ? (
                    <div className="h-28 flex flex-col items-center justify-center text-slate-400 text-xs italic">
                      Chưa có thương vụ nào
                    </div>
                  ) : (
                    stageDeals.map(deal => (
                      <div
                        key={deal.id}
                        className="p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/80 shadow-2xs hover:shadow-md transition-all space-y-2.5 group"
                      >
                        {/* Card Top: Code & Priority */}
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                            {deal.code}
                          </span>
                          <span
                            className={`px-1.5 py-0.2 rounded font-bold ${
                              deal.priority === "KHAN_CAP"
                                ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                                : deal.priority === "CAO"
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                                : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                            }`}
                          >
                            {deal.priority === "KHAN_CAP" ? "Khẩn cấp" : deal.priority === "CAO" ? "Ưu tiên cao" : "Tiêu chuẩn"}
                          </span>
                        </div>

                        {/* Title & Customer */}
                        <div>
                          <h4 className="font-bold text-xs text-slate-900 dark:text-white leading-snug group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                            {deal.title}
                          </h4>
                          <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                            <Building2 className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="truncate">{deal.customerName}</span>
                          </div>
                        </div>

                        {/* Value & Forecast */}
                        <div className="p-2 bg-slate-50 dark:bg-slate-900/60 rounded-lg flex items-center justify-between text-xs font-mono">
                          <div>
                            <span className="text-[10px] text-slate-400 block font-sans">Giá trị:</span>
                            <span className="font-bold text-slate-900 dark:text-white">{formatVND(deal.estimatedValue)} VNĐ</span>
                          </div>
                          <div className="text-right">
                            <span className="text-[10px] text-slate-400 block font-sans">Dự thu:</span>
                            <span className="font-bold text-emerald-600 dark:text-emerald-400">
                              {formatVND((deal.estimatedValue * deal.winProbability) / 100)} VNĐ
                            </span>
                          </div>
                        </div>

                        {/* Key Action for Stage 3: Demo Request to App */}
                        {deal.stage === "DEMO_EVAL" && (
                          <div className="pt-1">
                            {deal.appRequestSent ? (
                              <div className="p-1.5 bg-purple-50 dark:bg-purple-950/40 rounded-lg border border-purple-200 dark:border-purple-800 text-[10px] text-purple-700 dark:text-purple-300 font-bold flex items-center gap-1.5">
                                <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                                <span>Phòng App đang triển khai Demo</span>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleSendAppRequest(deal)}
                                className="w-full py-1.5 px-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 shadow-xs transition-all cursor-pointer"
                              >
                                <Sparkles className="w-3 h-3" />
                                <span>Gửi Yêu Cầu Demo Sang Phòng App</span>
                              </button>
                            )}
                          </div>
                        )}

                        {/* Key Action for Stage 4/5: Jump to Quotations or Contracts */}
                        {(deal.stage === "PROPOSAL_BID" || deal.stage === "NEGOTIATION") && (
                          <div className="flex gap-1 pt-1 text-[10px]">
                            {onNavigateToTab && (
                              <button
                                type="button"
                                onClick={() => onNavigateToTab("quotations")}
                                className="flex-1 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 rounded font-bold flex items-center justify-center gap-1 border border-indigo-200 dark:border-indigo-800 cursor-pointer"
                              >
                                <FileText className="w-3 h-3" /> Báo giá
                              </button>
                            )}
                            {onNavigateToTab && (
                              <button
                                type="button"
                                onClick={() => onNavigateToTab("contracts")}
                                className="flex-1 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 rounded font-bold flex items-center justify-center gap-1 border border-emerald-200 dark:border-emerald-800 cursor-pointer"
                              >
                                <FileCheck className="w-3 h-3" /> Hợp đồng
                              </button>
                            )}
                          </div>
                        )}

                        {/* Footer: Sales Rep & Expected Date */}
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-[10px] text-slate-400">
                          <span className="font-semibold text-slate-700 dark:text-slate-300 truncate max-w-[130px]">
                            👤 {deal.assignedRep}
                          </span>
                          <span className="flex items-center gap-1 font-mono">
                            <Clock className="w-3 h-3 text-slate-400" />
                            {deal.expectedCloseDate}
                          </span>
                        </div>

                        {/* Stage Progression Buttons */}
                        <div className="flex items-center justify-between pt-1 gap-1">
                          {stageKey !== "LEAD" && (
                            <button
                              type="button"
                              onClick={() => handleRegressStage(deal)}
                              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded cursor-pointer transition-colors"
                              title="Lùi về bước trước"
                            >
                              <ArrowLeft className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {stageKey !== "CLOSED_WON" && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedDealForAction(deal);
                                setIsLostReasonModalOpen(true);
                              }}
                              className="px-2 py-0.5 text-[10px] text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded cursor-pointer"
                              title="Đánh dấu thất bại (Closed Lost)"
                            >
                              Thất bại
                            </button>
                          )}

                          {stageKey !== "CLOSED_WON" && (
                            <button
                              type="button"
                              onClick={() => handleAdvanceStage(deal)}
                              className="flex items-center gap-1 px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 rounded-lg text-[10px] font-bold cursor-pointer transition-all ml-auto"
                            >
                              <span>Bước sau</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}

          {/* Optional Closed Lost Column */}
          {showLostColumn && (
            <div className="w-72 shrink-0 flex flex-col bg-rose-50/50 dark:bg-rose-950/20 rounded-2xl border border-rose-200 dark:border-rose-900/60 overflow-hidden shadow-2xs">
              <div className="p-3 bg-gradient-to-r from-rose-950 to-slate-900 text-rose-300 border-b border-rose-900">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs uppercase tracking-tight">ĐÃ ĐÓNG (LOST)</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-900/60 text-rose-300">
                    0% Win
                  </span>
                </div>
                <div className="text-[11px] text-rose-400/80 mt-1 font-mono">
                  {filteredDeals.filter(d => d.stage === "CLOSED_LOST").length} thương vụ thất bại
                </div>
              </div>

              <div className="p-2.5 flex-1 space-y-3 overflow-y-auto max-h-[650px]">
                {filteredDeals.filter(d => d.stage === "CLOSED_LOST").map(deal => (
                  <div
                    key={deal.id}
                    className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/40 text-xs space-y-2 opacity-80"
                  >
                    <div className="font-bold text-slate-800 dark:text-slate-200">{deal.title}</div>
                    <div className="text-[11px] text-slate-400">{deal.customerName}</div>
                    <div className="p-2 bg-rose-50 dark:bg-rose-950/40 rounded text-rose-700 dark:text-rose-300 text-[11px]">
                      <strong>Lý do thất bại:</strong> {deal.lostReason || "Chưa có lý do"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MODAL 1: TẠO THƯƠNG VỤ BÁN HÀNG MỚI (NEW DEAL MODAL) */}
      {isNewDealModalOpen && (
        <Modal
          isOpen={isNewDealModalOpen}
          onClose={() => setIsNewDealModalOpen(false)}
          title="Thêm Cơ Hội Bán Hàng Mới Vào Pipeline (New Deal)"
          size="2xl"
        >
          <form onSubmit={handleCreateDeal} className="space-y-4">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Tên Thương Vụ / Dự Án Mua Sắm
              </label>
              <input
                type="text"
                value={newDealForm.title}
                onChange={e => setNewDealForm({ ...newDealForm, title: e.target.value })}
                placeholder="Ví dụ: Cung cấp 01 Hệ thống Real-time PCR Gentier 96E &amp; Kit HPV..."
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Bệnh Viện / Đơn Vị Khách Hàng
                </label>
                <input
                  type="text"
                  value={newDealForm.customerName}
                  onChange={e => setNewDealForm({ ...newDealForm, customerName: e.target.value })}
                  placeholder="Ví dụ: Bệnh Viện Chợ Rẫy"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Khoa / Phòng Sử Dụng
                </label>
                <input
                  type="text"
                  value={newDealForm.hospitalDepartment}
                  onChange={e => setNewDealForm({ ...newDealForm, hospitalDepartment: e.target.value })}
                  placeholder="Ví dụ: Khoa Vi Sinh / Sinh Học Phân Tử"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Dòng Sản Phẩm / Hóa Chất
                </label>
                <input
                  type="text"
                  value={newDealForm.productLine}
                  onChange={e => setNewDealForm({ ...newDealForm, productLine: e.target.value })}
                  placeholder="Ví dụ: Máy Real-time PCR, Kit chẩn đoán HPV..."
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Giá Trị Dự Kiến (VNĐ)
                </label>
                <input
                  type="number"
                  value={newDealForm.estimatedValue}
                  onChange={e => setNewDealForm({ ...newDealForm, estimatedValue: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-emerald-600"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Giai Đoạn Khởi Tạo
                </label>
                <select
                  value={newDealForm.stage}
                  onChange={e => setNewDealForm({ ...newDealForm, stage: e.target.value as any })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                >
                  <option value="LEAD">1. Tiếp Cận Ban Đầu (10%)</option>
                  <option value="NEEDS_SPEC">2. Khảo Sát &amp; Spec-in (25%)</option>
                  <option value="DEMO_EVAL">3. Demo Lâm Sàng (50%)</option>
                  <option value="PROPOSAL_BID">4. Báo Giá / Hồ Sơ Thầu (70%)</option>
                  <option value="NEGOTIATION">5. Đàm Phán HĐ (90%)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  NVKD Phụ Trách
                </label>
                <select
                  value={newDealForm.assignedRep}
                  onChange={e => setNewDealForm({ ...newDealForm, assignedRep: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                >
                  <option value="">-- Chọn NVKD --</option>
                  {newDealForm.assignedRep && !salesStaff.some(p => p.full_name === newDealForm.assignedRep) && (
                    <option value={newDealForm.assignedRep}>{newDealForm.assignedRep}</option>
                  )}
                  {salesStaff.map(p => (
                    <option key={p.employee_code || p.full_name} value={p.full_name}>{p.full_name}{p.position ? ` (${p.position})` : ""}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Ngày Dự Kiến Chốt
                </label>
                <input
                  type="text"
                  value={newDealForm.expectedCloseDate}
                  onChange={e => setNewDealForm({ ...newDealForm, expectedCloseDate: e.target.value })}
                  placeholder="dd/mm/yyyy"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                  required
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Ghi Chú Chiến Lược Tiếp Cận
              </label>
              <textarea
                value={newDealForm.notes}
                onChange={e => setNewDealForm({ ...newDealForm, notes: e.target.value })}
                rows={2}
                placeholder="Ai là người quyết định? Nhu cầu cấp thiết là gì? Đối thủ cạnh tranh nếu có..."
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white resize-none"
              />
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsNewDealModalOpen(false)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 rounded-xl text-xs font-bold"
              >
                Hủy
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30"
              >
                Lưu Vào Phễu Bán Hàng
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL 2: GHI NHẬN LÝ DO THẤT BẠI (CLOSED LOST MODAL) */}
      {isLostReasonModalOpen && selectedDealForAction && (
        <Modal
          isOpen={isLostReasonModalOpen}
          onClose={() => setIsLostReasonModalOpen(false)}
          title={`Ghi Nhận Thất Bại Cho Thương Vụ: ${selectedDealForAction.title}`}
          size="md"
        >
          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              Vui lòng chọn lý do chính khiến thương vụ không thành công để hệ thống đúc kết kinh nghiệm đấu thầu và tối ưu chính sách giá:
            </p>

            <div className="space-y-2">
              {[
                "Đối thủ trúng thầu với giá thấp hơn",
                "Khách hàng lựa chọn công nghệ / thương hiệu khác",
                "Bệnh viện hoãn hoặc hủy nguồn vốn ngân sách",
                "Chính sách công nợ & thanh toán của công ty chưa phù hợp",
                "Chưa đạt yêu cầu kỹ thuật trong biên bản chạy thử nghiệm lâm sàng"
              ].map(reason => (
                <label
                  key={reason}
                  className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer text-xs"
                >
                  <input
                    type="radio"
                    name="lostReason"
                    value={reason}
                    checked={lostReasonText === reason}
                    onChange={e => setLostReasonText(e.target.value)}
                    className="text-indigo-600"
                  />
                  <span>{reason}</span>
                </label>
              ))}
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsLostReasonModalOpen(false)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 rounded-xl text-xs font-bold"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleConfirmLost}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-md shadow-rose-600/30"
              >
                Xác Nhận Đóng Thất Bại
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

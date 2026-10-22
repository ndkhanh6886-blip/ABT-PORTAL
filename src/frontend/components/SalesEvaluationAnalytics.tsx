"use client";

import React, { useState, useMemo } from "react";
import {
    Award,
    BarChart3,
    Calendar,
    CheckCircle2,
    Clock,
    AlertTriangle,
    FileText,
    TrendingUp,
    TrendingDown,
    Users,
    Filter,
    Download,
    ChevronLeft,
    ChevronRight,
    Star,
    CheckSquare,
    Target,
    Activity,
    Search,
    Flame,
    ArrowUpRight,
    ShieldCheck,
    Layers
} from "lucide-react";
import * as XLSX from "xlsx";

export interface SalesEvaluationAnalyticsProps {
    tasks: any[];
    plans: any[];
    dailyLogs: any[];
    salesPersonnel: any[];
    selectedWeek: number;
    setSelectedWeek: (week: number) => void;
    selectedAssigneeFilter: string;
    setSelectedAssigneeFilter?: (id: string) => void;
    showToast?: (message: string, type?: "success" | "error" | "warning" | "info") => void;
}

// Helper to format week range string
function getWeekDateRange(weekNum: number, year: number = 2026): string {
    const simple = new Date(year, 0, 1 + (weekNum - 1) * 7);
    const dayOfWeek = simple.getDay();
    const ISOweekStart = new Date(simple);
    if (dayOfWeek <= 4)
        ISOweekStart.setDate(simple.getDate() - (simple.getDay() || 7) + 1);
    else
        ISOweekStart.setDate(simple.getDate() + 8 - (simple.getDay() || 7));

    const startDate = new Date(ISOweekStart);
    const endDate = new Date(ISOweekStart);
    endDate.setDate(startDate.getDate() + 5); // Mon to Sat

    const formatStr = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    return `${formatStr(startDate)} - ${formatStr(endDate)}/${year}`;
}

export const SalesEvaluationAnalytics: React.FC<SalesEvaluationAnalyticsProps> = ({
    tasks = [],
    plans = [],
    dailyLogs = [],
    salesPersonnel = [],
    selectedWeek,
    setSelectedWeek,
    selectedAssigneeFilter,
    setSelectedAssigneeFilter,
    showToast
}) => {
    // Local filter states
    const [viewScope, setViewScope] = useState<"week" | "all">("week");
    const [activeSubView, setActiveSubView] = useState<"leaderboard" | "matrix" | "audit">("leaderboard");
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedEmpForDetail, setSelectedEmpForDetail] = useState<string | null>(null);

    // List of active personnel to evaluate
    const evaluatableStaff = useMemo(() => {
        if (!salesPersonnel || salesPersonnel.length === 0) return [];
        let list = [...salesPersonnel];
        if (selectedAssigneeFilter && selectedAssigneeFilter !== "all") {
            list = list.filter(p => p.employee_id === selectedAssigneeFilter);
        }
        if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase();
            list = list.filter(p => 
                p.full_name?.toLowerCase().includes(q) ||
                p.employee_id?.toLowerCase().includes(q) ||
                p.position?.toLowerCase().includes(q)
            );
        }
        return list;
    }, [salesPersonnel, selectedAssigneeFilter, searchTerm]);

    // Compute metrics for a single employee
    const computeStaffMetrics = (empId: string) => {
        // 1. Tasks
        const empTasks = tasks.filter(t => t.assignee_id === empId);
        const totalTasks = empTasks.length;
        const doneTasks = empTasks.filter(t => {
            const s = (t.status || "").toLowerCase();
            return s === "done" || s === "completed";
        }).length;
        const inProgressTasks = empTasks.filter(t => {
            const s = (t.status || "").toLowerCase();
            return s === "in progress" || s === "in_progress" || s === "doing";
        }).length;
        const todoTasks = totalTasks - doneTasks - inProgressTasks;
        
        const parseFlexibleDate = (raw: any): Date | null => {
            if (!raw) return null;
            const str = String(raw).trim();
            const dmyMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
            if (dmyMatch) {
                const [, dStr, mStr, yStr] = dmyMatch;
                const d = new Date(Number(yStr), Number(mStr) - 1, Number(dStr));
                return isNaN(d.getTime()) ? null : d;
            }
            const ymdMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
            if (ymdMatch) {
                const [, yStr, mStr, dStr] = ymdMatch;
                const d = new Date(Number(yStr), Number(mStr) - 1, Number(dStr));
                return isNaN(d.getTime()) ? null : d;
            }
            const d = new Date(str);
            return isNaN(d.getTime()) ? null : d;
        };

        const now = new Date();
        const todayVnStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(now);
        const overdueTasks = empTasks.filter(t => {
            const s = (t.status || "").toLowerCase();
            if (s === "done" || s === "completed") return false;
            if (!t.due_date) return false;
            const parsedDue = parseFlexibleDate(t.due_date);
            if (!parsedDue) return false;
            const dueVnStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(parsedDue);
            return dueVnStr < todayVnStr;
        }).length;

        const taskCompletionRate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 100;
        const onTimeRate = totalTasks > 0 ? Math.max(0, Math.round(((totalTasks - overdueTasks) / totalTasks) * 100)) : 100;
        const taskScore = Math.round((taskCompletionRate * 0.7) + (onTimeRate * 0.3));

        // 2. Plans
        let empPlans = plans.filter(p => p.assignee_id === empId);
        if (viewScope === "week") {
            empPlans = empPlans.filter(p => Number(p.week_number) === Number(selectedWeek));
        }
        const totalPlans = empPlans.length;
        const completedPlans = empPlans.filter(p => {
            const s = (p.status || "").toLowerCase();
            return s === "completed" || s === "done";
        }).length;
        const inProgressPlans = empPlans.filter(p => {
            const s = (p.status || "").toLowerCase();
            return s === "in progress" || s === "in_progress";
        }).length;
        const pendingPlans = totalPlans - completedPlans - inProgressPlans;
        
        const planCompletionRate = totalPlans > 0 ? Math.round((completedPlans / totalPlans) * 100) : 0;
        const planScore = planCompletionRate;

        // 3. Daily Logs
        let empLogs = dailyLogs.filter(l => (l.employee_id === empId || l.sales_rep_id === empId));
        if (viewScope === "week") {
            // Check logs within the week date range or simple 7-day window
            empLogs = empLogs.filter(l => {
                if (!l.date) return false;
                const d = parseFlexibleDate(l.date);
                if (!d || isNaN(d.getTime())) return false;
                const dCopy = new Date(d.getTime());
                dCopy.setHours(0, 0, 0, 0);
                dCopy.setDate(dCopy.getDate() + 4 - (dCopy.getDay() || 7));
                const yearStart = new Date(dCopy.getFullYear(), 0, 1);
                const w = Math.ceil((((dCopy.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
                return w === Number(selectedWeek);
            });
        }
        const totalLogs = empLogs.length;
        const distinctLogDates = new Set(empLogs.map(l => l.date).filter(Boolean));
        const activeDaysCount = distinctLogDates.size;
        // In a week, target is 5 working days (Mon - Fri or Sat)
        const targetDays = viewScope === "week" ? 5 : 20;
        const dailyDisciplineRate = Math.min(100, Math.round((activeDaysCount / targetDays) * 100));
        const dailyScore = totalLogs > 0 ? Math.max(dailyDisciplineRate, Math.min(100, totalLogs * 15)) : 0;

        // 4. Overall Weighted KPI Score
        // Công thức: Công việc (40%) + Kế hoạch tuần (35%) + Kỷ luật Daily (25%)
        let kpiScore = 0;
        if (totalTasks === 0 && totalPlans === 0 && totalLogs === 0) {
            kpiScore = 0;
        } else if (totalPlans === 0) {
            kpiScore = Math.round((taskScore * 0.6) + (dailyScore * 0.4));
        } else if (totalTasks === 0) {
            kpiScore = Math.round((planScore * 0.6) + (dailyScore * 0.4));
        } else {
            kpiScore = Math.round((taskScore * 0.40) + (planScore * 0.35) + (dailyScore * 0.25));
        }

        // Tier classification
        let tier: "A" | "B" | "C" | "D" = "C";
        let tierLabel = "Đạt Yêu Cầu";
        let tierColor = "text-amber-500 bg-amber-500/10 border-amber-500/30";

        if (kpiScore >= 85) {
            tier = "A";
            tierLabel = "Xuất Sắc";
            tierColor = "text-emerald-500 bg-emerald-500/10 border-emerald-500/30";
        } else if (kpiScore >= 70) {
            tier = "B";
            tierLabel = "Tốt";
            tierColor = "text-indigo-400 bg-indigo-500/10 border-indigo-500/30";
        } else if (kpiScore >= 50) {
            tier = "C";
            tierLabel = "Đạt Yêu Cầu";
            tierColor = "text-amber-500 bg-amber-500/10 border-amber-500/30";
        } else {
            tier = "D";
            tierLabel = "Cần Cải Thiện";
            tierColor = "text-rose-500 bg-rose-500/10 border-rose-500/30";
        }

        // Automatic Smart Assessment Suggestion
        let recommendation = "";
        if (kpiScore >= 85) {
            recommendation = "Hiệu suất xuất sắc toàn diện. Hoàn thành nhiệm vụ vượt trội và duy trì ghi chép nhật ký công tác rất chuẩn mực.";
        } else if (planCompletionRate < 50 && totalPlans > 0) {
            recommendation = "Cần đẩy mạnh thực hiện và báo cáo kết quả các mục tiêu đã đăng ký trong kế hoạch tuần.";
        } else if (activeDaysCount < 3 && totalLogs < 3) {
            recommendation = "Cần nâng cao kỷ luật báo cáo nhật ký Daily đều đặn hàng ngày để minh bạch tiến độ công việc.";
        } else if (overdueTasks > 0) {
            recommendation = `Đang có ${overdueTasks} công việc trễ hạn cần tập trung giải quyết dứt điểm.`;
        } else {
            recommendation = "Duy trì phong độ làm việc và phối hợp chặt chẽ với các phòng ban liên quan.";
        }

        return {
            empId,
            totalTasks,
            doneTasks,
            inProgressTasks,
            todoTasks,
            overdueTasks,
            taskCompletionRate,
            onTimeRate,
            taskScore,
            totalPlans,
            completedPlans,
            inProgressPlans,
            pendingPlans,
            planCompletionRate,
            planScore,
            totalLogs,
            activeDaysCount,
            dailyDisciplineRate,
            dailyScore,
            kpiScore,
            tier,
            tierLabel,
            tierColor,
            recommendation,
            empPlans,
            empLogs,
            empTasks
        };
    };

    // Calculate metrics for all staff and sort by KPI score descending
    const staffEvaluations = useMemo(() => {
        return evaluatableStaff.map(p => {
            const metrics = computeStaffMetrics(p.employee_id);
            return {
                ...p,
                metrics
            };
        }).sort((a, b) => b.metrics.kpiScore - a.metrics.kpiScore);
    }, [evaluatableStaff, tasks, plans, dailyLogs, selectedWeek, viewScope]);

    // Team Summary Aggregates
    const teamSummary = useMemo(() => {
        const totalPeople = staffEvaluations.length;
        if (totalPeople === 0) {
            return {
                avgKpi: 0,
                totalTasks: 0,
                totalDoneTasks: 0,
                taskDoneRate: 0,
                totalPlans: 0,
                totalDonePlans: 0,
                planDoneRate: 0,
                totalLogs: 0,
                topPerformer: null
            };
        }

        const sumKpi = staffEvaluations.reduce((sum, item) => sum + item.metrics.kpiScore, 0);
        const sumTasks = staffEvaluations.reduce((sum, item) => sum + item.metrics.totalTasks, 0);
        const sumDoneTasks = staffEvaluations.reduce((sum, item) => sum + item.metrics.doneTasks, 0);
        const sumPlans = staffEvaluations.reduce((sum, item) => sum + item.metrics.totalPlans, 0);
        const sumDonePlans = staffEvaluations.reduce((sum, item) => sum + item.metrics.completedPlans, 0);
        const sumLogs = staffEvaluations.reduce((sum, item) => sum + item.metrics.totalLogs, 0);

        return {
            avgKpi: Math.round(sumKpi / totalPeople),
            totalTasks: sumTasks,
            totalDoneTasks: sumDoneTasks,
            taskDoneRate: sumTasks > 0 ? Math.round((sumDoneTasks / sumTasks) * 100) : 0,
            totalPlans: sumPlans,
            totalDonePlans: sumDonePlans,
            planDoneRate: sumPlans > 0 ? Math.round((sumDonePlans / sumPlans) * 100) : 0,
            totalLogs: sumLogs,
            topPerformer: staffEvaluations[0] || null
        };
    }, [staffEvaluations]);

    // Export Excel Handler
    const handleExportExcel = () => {
        try {
            const dataToExport = staffEvaluations.map((item, idx) => ({
                "Xếp hạng": idx + 1,
                "Mã NV": item.employee_id,
                "Họ và Tên": item.full_name,
                "Chức vụ": item.position || "NVKD",
                "Phòng ban": item.department || "Kinh Doanh",
                "Điểm KPI Tổng Hợp": item.metrics.kpiScore,
                "Xếp Loại": item.metrics.tierLabel,
                "Tổng Task": item.metrics.totalTasks,
                "Task Hoàn Thành": item.metrics.doneTasks,
                "Tỷ lệ Task (%)": `${item.metrics.taskCompletionRate}%`,
                "Tổng Kế Hoạch Tuần": item.metrics.totalPlans,
                "Kế Hoạch Hoàn Thành": item.metrics.completedPlans,
                "Tỷ lệ Kế Hoạch (%)": `${item.metrics.planCompletionRate}%`,
                "Số Lượt Nhật Ký Daily": item.metrics.totalLogs,
                "Số Ngày Có Log": item.metrics.activeDaysCount,
                "Đánh Giá & Khuyến Nghị": item.metrics.recommendation
            }));

            const ws = XLSX.utils.json_to_sheet(dataToExport);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, `DanhGia_Tuan_${selectedWeek}`);
            XLSX.writeFile(wb, `BaoCao_DanhGia_HieuQua_TBR_Tuan_${selectedWeek}.xlsx`);
            if (showToast) showToast("Đã xuất file báo cáo KPI Excel thành công!", "success");
        } catch (err) {
            console.error("Lỗi xuất Excel:", err);
            if (showToast) showToast("Có lỗi khi xuất file Excel!", "error");
        }
    };

    const activeEmpDetail = useMemo(() => {
        if (!selectedEmpForDetail) return staffEvaluations[0] || null;
        return staffEvaluations.find(s => s.employee_id === selectedEmpForDetail) || staffEvaluations[0] || null;
    }, [selectedEmpForDetail, staffEvaluations]);

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Top Filter & Action Header */}
            <div className="bg-slate-900/95 p-4 rounded-2xl border border-slate-800 shadow-xl flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center text-white shadow-lg shadow-orange-500/20">
                        <Award className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-base font-bold text-white flex items-center gap-2">
                            ĐÁNH GIÁ & THỐNG KÊ HIỆU QUẢ CÔNG VIỆC
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30">
                                3 Chiều: Task • Kế hoạch • Nhật ký
                            </span>
                        </h2>
                        <p className="text-xs text-slate-400">
                            Thang điểm đánh giá đa chiều kết hợp tỷ lệ hoàn thành công việc, mức độ thực thi kế hoạch tuần và kỷ luật ghi nhận daily log.
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                    {/* View Scope Toggle */}
                    <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                        <button
                            onClick={() => setViewScope("week")}
                            className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                                viewScope === "week"
                                    ? "bg-orange-600 text-white shadow"
                                    : "text-slate-400 hover:text-white"
                            }`}
                        >
                            Theo Tuần
                        </button>
                        <button
                            onClick={() => setViewScope("all")}
                            className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                                viewScope === "all"
                                    ? "bg-orange-600 text-white shadow"
                                    : "text-slate-400 hover:text-white"
                            }`}
                        >
                            Toàn Bộ Thời Gian
                        </button>
                    </div>

                    {/* Week Navigator (When in week scope) */}
                    {viewScope === "week" && (
                        <div className="flex items-center bg-slate-950 px-2 py-1 rounded-xl border border-slate-800 gap-1 text-xs">
                            <button
                                onClick={() => setSelectedWeek(Math.max(1, selectedWeek - 1))}
                                className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors cursor-pointer"
                                title="Tuần trước"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <div className="text-center px-2">
                                <span className="text-xs font-bold text-white block">
                                    Tuần {selectedWeek}
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono block">
                                    {getWeekDateRange(selectedWeek)}
                                </span>
                            </div>
                            <button
                                onClick={() => setSelectedWeek(Math.min(52, selectedWeek + 1))}
                                className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors cursor-pointer"
                                title="Tuần sau"
                            >
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    )}

                    {/* Search Input */}
                    <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Tìm nhân sự..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 w-36 md:w-44"
                        />
                    </div>

                    {/* Export Excel Button */}
                    <button
                        onClick={handleExportExcel}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
                    >
                        <Download className="w-3.5 h-3.5" />
                        <span>Xuất Excel</span>
                    </button>
                </div>
            </div>

            {/* Sub View Tabs */}
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                <button
                    onClick={() => setActiveSubView("leaderboard")}
                    className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                        activeSubView === "leaderboard"
                            ? "bg-orange-600 text-white shadow-lg shadow-orange-600/30"
                            : "bg-slate-900/60 text-slate-400 hover:text-white border border-slate-800"
                    }`}
                >
                    <BarChart3 className="w-3.5 h-3.5" />
                    Bảng Xếp Hạng & Đánh Giá Tổng Thể
                </button>
                <button
                    onClick={() => setActiveSubView("matrix")}
                    className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                        activeSubView === "matrix"
                            ? "bg-orange-600 text-white shadow-lg shadow-orange-600/30"
                            : "bg-slate-900/60 text-slate-400 hover:text-white border border-slate-800"
                    }`}
                >
                    <Target className="w-3.5 h-3.5" />
                    Hồ Sơ Hiệu Suất Chi Tiết Nhân Sự
                </button>
                <button
                    onClick={() => setActiveSubView("audit")}
                    className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                        activeSubView === "audit"
                            ? "bg-orange-600 text-white shadow-lg shadow-orange-600/30"
                            : "bg-slate-900/60 text-slate-400 hover:text-white border border-slate-800"
                    }`}
                >
                    <Layers className="w-3.5 h-3.5" />
                    Đối Chiếu Kế Hoạch vs Nhật Ký Daily
                </button>
            </div>

            {/* 4 Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Overall KPI Card */}
                <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800 shadow-md relative overflow-hidden group hover:border-orange-500/40 transition-all">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-orange-500/10 rounded-full blur-2xl -mr-6 -mt-6 group-hover:bg-orange-500/20 transition-all"></div>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                            Điểm KPI Đội Ngũ
                        </span>
                        <div className="w-8 h-8 rounded-lg bg-orange-500/10 text-orange-400 flex items-center justify-center border border-orange-500/20">
                            <Award className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-extrabold text-white font-mono">
                            {teamSummary.avgKpi}
                        </span>
                        <span className="text-xs text-slate-400 font-bold">/ 100 điểm</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs">
                        <span className="text-slate-400">Quy mô:</span>
                        <span className="text-white font-bold">{staffEvaluations.length} nhân sự</span>
                    </div>
                    <div className="w-full bg-slate-950 h-1.5 rounded-full mt-2 overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-orange-600 to-orange-400 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(100, teamSummary.avgKpi)}%` }}
                        ></div>
                    </div>
                </div>

                {/* Tasks Performance Card */}
                <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800 shadow-md relative overflow-hidden group hover:border-indigo-500/40 transition-all">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/10 rounded-full blur-2xl -mr-6 -mt-6 group-hover:bg-indigo-500/20 transition-all"></div>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                            Hiệu Quả Công Việc (Tasks)
                        </span>
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-500/20">
                            <CheckSquare className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-extrabold text-white font-mono">
                            {teamSummary.taskDoneRate}%
                        </span>
                        <span className="text-xs text-emerald-400 font-bold">Đã hoàn thành</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs">
                        <span className="text-slate-400">Đã xong / Tổng số:</span>
                        <span className="text-white font-bold font-mono">
                            {teamSummary.totalDoneTasks} / {teamSummary.totalTasks} việc
                        </span>
                    </div>
                    <div className="w-full bg-slate-950 h-1.5 rounded-full mt-2 overflow-hidden">
                        <div
                            className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(100, teamSummary.taskDoneRate)}%` }}
                        ></div>
                    </div>
                </div>

                {/* Weekly Plans Card */}
                <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800 shadow-md relative overflow-hidden group hover:border-emerald-500/40 transition-all">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl -mr-6 -mt-6 group-hover:bg-emerald-500/20 transition-all"></div>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                            Thực Thi Kế Hoạch Tuần
                        </span>
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
                            <Calendar className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-extrabold text-white font-mono">
                            {teamSummary.planDoneRate}%
                        </span>
                        <span className="text-xs text-emerald-400 font-bold">Mục tiêu đạt</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs">
                        <span className="text-slate-400">Đạt / Đăng ký:</span>
                        <span className="text-white font-bold font-mono">
                            {teamSummary.totalDonePlans} / {teamSummary.totalPlans} mục
                        </span>
                    </div>
                    <div className="w-full bg-slate-950 h-1.5 rounded-full mt-2 overflow-hidden">
                        <div
                            className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(100, teamSummary.planDoneRate)}%` }}
                        ></div>
                    </div>
                </div>

                {/* Daily Discipline Card */}
                <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800 shadow-md relative overflow-hidden group hover:border-amber-500/40 transition-all">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl -mr-6 -mt-6 group-hover:bg-amber-500/20 transition-all"></div>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                            Kỷ Luật Nhật Ký Daily
                        </span>
                        <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/20">
                            <FileText className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-extrabold text-white font-mono">
                            {teamSummary.totalLogs}
                        </span>
                        <span className="text-xs text-amber-400 font-bold">Lượt ghi nhận</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs">
                        <span className="text-slate-400">Nhân sự tích cực nhất:</span>
                        <span className="text-orange-400 font-bold truncate max-w-[120px]">
                            {teamSummary.topPerformer?.full_name || "—"}
                        </span>
                    </div>
                    <div className="w-full bg-slate-950 h-1.5 rounded-full mt-2 overflow-hidden">
                        <div
                            className="h-full bg-amber-500 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(100, teamSummary.totalLogs * 4)}%` }}
                        ></div>
                    </div>
                </div>
            </div>

            {/* TAB 1: LEADERBOARD & MATRIX TABLE */}
            {activeSubView === "leaderboard" && (
                <div className="bg-slate-900/95 rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
                    <div className="p-4 border-b border-slate-800 flex items-center justify-between flex-wrap gap-3">
                        <div>
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                <Award className="w-4 h-4 text-orange-500" />
                                BẢNG XẾP HẠNG HIỆU SUẤT & ĐÁNH GIÁ TỔNG HỢP
                            </h3>
                            <p className="text-[11px] text-slate-400">
                                Nhấp vào từng nhân sự để xem chi tiết hồ sơ phân tích 3 chiều hoặc đối chiếu công việc.
                            </p>
                        </div>
                        <div className="flex items-center gap-3 text-xs font-mono">
                            <span className="flex items-center gap-1.5 text-emerald-400">
                                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                Xuất Sắc (≥85)
                            </span>
                            <span className="flex items-center gap-1.5 text-indigo-400">
                                <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                                Tốt (70-84)
                            </span>
                            <span className="flex items-center gap-1.5 text-amber-400">
                                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                                Đạt (50-69)
                            </span>
                            <span className="flex items-center gap-1.5 text-rose-400">
                                <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                                Cải Thiện (&lt;50)
                            </span>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs text-slate-200">
                            <thead className="bg-slate-950/80 text-[10px] uppercase font-bold text-slate-400 tracking-wider border-b border-slate-800">
                                <tr>
                                    <th className="py-3 px-4 text-center w-12">Hạng</th>
                                    <th className="py-3 px-4">Nhân sự</th>
                                    <th className="py-3 px-4 text-center">Công việc (40%)</th>
                                    <th className="py-3 px-4 text-center">Kế hoạch tuần (35%)</th>
                                    <th className="py-3 px-4 text-center">Nhật ký Daily (25%)</th>
                                    <th className="py-3 px-4 text-center">Điểm KPI</th>
                                    <th className="py-3 px-4 text-center">Xếp loại</th>
                                    <th className="py-3 px-4">Đánh giá & Khuyến nghị</th>
                                    <th className="py-3 px-4 text-center">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60">
                                {staffEvaluations.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="py-8 text-center text-slate-400 italic">
                                            Không có nhân sự nào phù hợp với bộ lọc.
                                        </td>
                                    </tr>
                                ) : (
                                    staffEvaluations.map((staff, idx) => {
                                        const m = staff.metrics;
                                        return (
                                            <tr
                                                key={staff.employee_id}
                                                className="hover:bg-slate-800/40 transition-colors group cursor-pointer"
                                                onClick={() => {
                                                    setSelectedEmpForDetail(staff.employee_id);
                                                    setActiveSubView("matrix");
                                                }}
                                            >
                                                {/* Rank */}
                                                <td className="py-3 px-4 text-center">
                                                    {idx === 0 ? (
                                                        <div className="w-7 h-7 mx-auto rounded-full bg-gradient-to-tr from-amber-500 to-yellow-300 text-slate-950 font-extrabold flex items-center justify-center shadow-lg shadow-yellow-500/30">
                                                            1
                                                        </div>
                                                    ) : idx === 1 ? (
                                                        <div className="w-7 h-7 mx-auto rounded-full bg-gradient-to-tr from-slate-400 to-slate-200 text-slate-950 font-bold flex items-center justify-center">
                                                            2
                                                        </div>
                                                    ) : idx === 2 ? (
                                                        <div className="w-7 h-7 mx-auto rounded-full bg-gradient-to-tr from-amber-700 to-amber-500 text-white font-bold flex items-center justify-center">
                                                            3
                                                        </div>
                                                    ) : (
                                                        <span className="font-mono text-slate-400">{idx + 1}</span>
                                                    )}
                                                </td>

                                                {/* Staff Info */}
                                                <td className="py-3 px-4">
                                                    <div className="flex items-center gap-2.5">
                                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-800 to-slate-700 border border-slate-600 flex items-center justify-center text-white font-bold text-xs uppercase shadow">
                                                            {staff.full_name?.charAt(0) || "U"}
                                                        </div>
                                                        <div>
                                                            <div className="font-bold text-white group-hover:text-orange-400 transition-colors">
                                                                {staff.full_name}
                                                            </div>
                                                            <div className="text-[10px] text-slate-400 font-mono">
                                                                {staff.employee_id} • {staff.position || "NVKD"}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* Tasks */}
                                                <td className="py-3 px-4 text-center">
                                                    <div className="inline-flex flex-col items-center">
                                                        <div className="flex items-center gap-1 font-mono font-bold text-white">
                                                            <span className="text-emerald-400">{m.doneTasks}</span>
                                                            <span className="text-slate-500">/</span>
                                                            <span>{m.totalTasks}</span>
                                                        </div>
                                                        <div className="w-16 bg-slate-950 h-1.5 rounded-full mt-1 overflow-hidden">
                                                            <div
                                                                className="h-full bg-indigo-500 rounded-full"
                                                                style={{ width: `${m.taskCompletionRate}%` }}
                                                            ></div>
                                                        </div>
                                                        <span className="text-[9px] text-slate-400 font-mono mt-0.5">
                                                            {m.taskCompletionRate}%
                                                            {m.overdueTasks > 0 && (
                                                                <span className="text-rose-400 ml-1">({m.overdueTasks} trễ)</span>
                                                            )}
                                                        </span>
                                                    </div>
                                                </td>

                                                {/* Plans */}
                                                <td className="py-3 px-4 text-center">
                                                    <div className="inline-flex flex-col items-center">
                                                        <div className="flex items-center gap-1 font-mono font-bold text-white">
                                                            <span className="text-emerald-400">{m.completedPlans}</span>
                                                            <span className="text-slate-500">/</span>
                                                            <span>{m.totalPlans}</span>
                                                        </div>
                                                        <div className="w-16 bg-slate-950 h-1.5 rounded-full mt-1 overflow-hidden">
                                                            <div
                                                                className="h-full bg-emerald-500 rounded-full"
                                                                style={{ width: `${m.planCompletionRate}%` }}
                                                            ></div>
                                                        </div>
                                                        <span className="text-[9px] text-slate-400 font-mono mt-0.5">
                                                            {m.planCompletionRate}%
                                                        </span>
                                                    </div>
                                                </td>

                                                {/* Daily Logs */}
                                                <td className="py-3 px-4 text-center">
                                                    <div className="inline-flex flex-col items-center">
                                                        <div className="flex items-center gap-1 font-mono font-bold text-amber-400">
                                                            <span>{m.totalLogs} lượt</span>
                                                        </div>
                                                        <div className="w-16 bg-slate-950 h-1.5 rounded-full mt-1 overflow-hidden">
                                                            <div
                                                                className="h-full bg-amber-500 rounded-full"
                                                                style={{ width: `${m.dailyDisciplineRate}%` }}
                                                            ></div>
                                                        </div>
                                                        <span className="text-[9px] text-slate-400 font-mono mt-0.5">
                                                            {m.activeDaysCount} ngày có log
                                                        </span>
                                                    </div>
                                                </td>

                                                {/* Composite KPI Score */}
                                                <td className="py-3 px-4 text-center">
                                                    <div className="inline-flex items-baseline gap-0.5">
                                                        <span className="text-base font-extrabold font-mono text-white">
                                                            {m.kpiScore}
                                                        </span>
                                                        <span className="text-[10px] text-slate-500">/100</span>
                                                    </div>
                                                </td>

                                                {/* Tier Badge */}
                                                <td className="py-3 px-4 text-center">
                                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${m.tierColor}`}>
                                                        {m.tier === "A" && <Flame className="w-3 h-3" />}
                                                        {m.tier === "B" && <ShieldCheck className="w-3 h-3" />}
                                                        {m.tierLabel}
                                                    </span>
                                                </td>

                                                {/* Smart Recommendation */}
                                                <td className="py-3 px-4">
                                                    <p className="text-[11px] text-slate-300 line-clamp-2 max-w-xs">
                                                        {m.recommendation}
                                                    </p>
                                                </td>

                                                {/* Action */}
                                                <td className="py-3 px-4 text-center">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedEmpForDetail(staff.employee_id);
                                                            setActiveSubView("matrix");
                                                        }}
                                                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-orange-600 text-slate-300 hover:text-white transition-colors cursor-pointer"
                                                        title="Xem hồ sơ chi tiết"
                                                    >
                                                        <ArrowUpRight className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* TAB 2: DETAILED DRILLDOWN MATRIX */}
            {activeSubView === "matrix" && activeEmpDetail && (
                <div className="space-y-4">
                    {/* Personnel Selector Banner */}
                    <div className="bg-slate-900/95 p-4 rounded-2xl border border-slate-800 shadow-xl flex flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center text-white font-extrabold text-lg shadow-lg shadow-orange-500/20 uppercase">
                                {activeEmpDetail.full_name?.charAt(0) || "U"}
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h3 className="text-base font-bold text-white">
                                        {activeEmpDetail.full_name}
                                    </h3>
                                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                                        {activeEmpDetail.employee_id}
                                    </span>
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${activeEmpDetail.metrics.tierColor}`}>
                                        Hạng {activeEmpDetail.metrics.tier} • {activeEmpDetail.metrics.tierLabel}
                                    </span>
                                </div>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    {activeEmpDetail.position || "NVKD"} • {activeEmpDetail.department || "Kinh Doanh"} • {activeEmpDetail.email}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <label className="text-xs text-slate-400 font-bold">Chọn nhân sự khác:</label>
                            <select
                                value={activeEmpDetail.employee_id}
                                onChange={(e) => setSelectedEmpForDetail(e.target.value)}
                                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white font-bold outline-none focus:border-orange-500 cursor-pointer"
                            >
                                {staffEvaluations.map(s => (
                                    <option key={s.employee_id} value={s.employee_id}>
                                        {s.full_name} ({s.employee_id}) - KPI: {s.metrics.kpiScore}đ
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* 3 Dimension Cards Breakdown */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Task Column */}
                        <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800 shadow-md">
                            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
                                <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                                    <CheckSquare className="w-4 h-4" />
                                    1. Công Việc (Trọng số 40%)
                                </span>
                                <span className="text-sm font-extrabold font-mono text-indigo-300">
                                    {activeEmpDetail.metrics.taskScore}đ
                                </span>
                            </div>
                            <div className="space-y-2 text-xs">
                                <div className="flex justify-between text-slate-300">
                                    <span>Tổng số việc được giao:</span>
                                    <span className="font-bold font-mono">{activeEmpDetail.metrics.totalTasks} việc</span>
                                </div>
                                <div className="flex justify-between text-slate-300">
                                    <span>Đã hoàn tất (Done):</span>
                                    <span className="font-bold font-mono text-emerald-400">{activeEmpDetail.metrics.doneTasks} việc</span>
                                </div>
                                <div className="flex justify-between text-slate-300">
                                    <span>Đang thực hiện (In Progress):</span>
                                    <span className="font-bold font-mono text-amber-400">{activeEmpDetail.metrics.inProgressTasks} việc</span>
                                </div>
                                <div className="flex justify-between text-slate-300">
                                    <span>Việc quá hạn:</span>
                                    <span className={`font-bold font-mono ${activeEmpDetail.metrics.overdueTasks > 0 ? "text-rose-400" : "text-slate-400"}`}>
                                        {activeEmpDetail.metrics.overdueTasks} việc
                                    </span>
                                </div>
                                <div className="flex justify-between text-slate-300 pt-2 border-t border-slate-800">
                                    <span>Tỷ lệ hoàn thành:</span>
                                    <span className="font-bold font-mono text-emerald-400">{activeEmpDetail.metrics.taskCompletionRate}%</span>
                                </div>
                            </div>
                        </div>

                        {/* Plan Column */}
                        <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800 shadow-md">
                            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
                                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                                    <Calendar className="w-4 h-4" />
                                    2. Kế Hoạch Tuần (Trọng số 35%)
                                </span>
                                <span className="text-sm font-extrabold font-mono text-emerald-300">
                                    {activeEmpDetail.metrics.planScore}đ
                                </span>
                            </div>
                            <div className="space-y-2 text-xs">
                                <div className="flex justify-between text-slate-300">
                                    <span>Tổng mục kế hoạch tuần {selectedWeek}:</span>
                                    <span className="font-bold font-mono">{activeEmpDetail.metrics.totalPlans} mục</span>
                                </div>
                                <div className="flex justify-between text-slate-300">
                                    <span>Đã hoàn thành:</span>
                                    <span className="font-bold font-mono text-emerald-400">{activeEmpDetail.metrics.completedPlans} mục</span>
                                </div>
                                <div className="flex justify-between text-slate-300">
                                    <span>Đang tiến hành:</span>
                                    <span className="font-bold font-mono text-amber-400">{activeEmpDetail.metrics.inProgressPlans} mục</span>
                                </div>
                                <div className="flex justify-between text-slate-300">
                                    <span>Chưa đạt / Tồn đọng:</span>
                                    <span className="font-bold font-mono text-slate-400">{activeEmpDetail.metrics.pendingPlans} mục</span>
                                </div>
                                <div className="flex justify-between text-slate-300 pt-2 border-t border-slate-800">
                                    <span>Tỷ lệ thực thi kế hoạch:</span>
                                    <span className="font-bold font-mono text-emerald-400">{activeEmpDetail.metrics.planCompletionRate}%</span>
                                </div>
                            </div>
                        </div>

                        {/* Daily Column */}
                        <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800 shadow-md">
                            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
                                <span className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                                    <FileText className="w-4 h-4" />
                                    3. Nhật Ký Daily (Trọng số 25%)
                                </span>
                                <span className="text-sm font-extrabold font-mono text-amber-300">
                                    {activeEmpDetail.metrics.dailyScore}đ
                                </span>
                            </div>
                            <div className="space-y-2 text-xs">
                                <div className="flex justify-between text-slate-300">
                                    <span>Tổng số lượt ghi log:</span>
                                    <span className="font-bold font-mono">{activeEmpDetail.metrics.totalLogs} lượt</span>
                                </div>
                                <div className="flex justify-between text-slate-300">
                                    <span>Số ngày ghi nhận trong tuần:</span>
                                    <span className="font-bold font-mono text-emerald-400">{activeEmpDetail.metrics.activeDaysCount} / 5 ngày</span>
                                </div>
                                <div className="flex justify-between text-slate-300">
                                    <span>Độ chuyên cần ghi nhận:</span>
                                    <span className="font-bold font-mono text-amber-400">{activeEmpDetail.metrics.dailyDisciplineRate}%</span>
                                </div>
                                <div className="flex justify-between text-slate-300">
                                    <span>Tính minh bạch & đều đặn:</span>
                                    <span className="font-bold text-white">
                                        {activeEmpDetail.metrics.activeDaysCount >= 4 ? "Tốt (Đều đặn)" : "Cần bổ sung"}
                                    </span>
                                </div>
                                <div className="flex justify-between text-slate-300 pt-2 border-t border-slate-800">
                                    <span>Điểm thành phần Daily:</span>
                                    <span className="font-bold font-mono text-amber-400">{activeEmpDetail.metrics.dailyScore}đ</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Detailed Lists Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Weekly Plans for this employee */}
                        <div className="bg-slate-900/95 p-4 rounded-2xl border border-slate-800 shadow-xl">
                            <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center justify-between">
                                <span className="flex items-center gap-1.5">
                                    <Calendar className="w-4 h-4 text-orange-500" />
                                    Kế hoạch tuần {selectedWeek} của {activeEmpDetail.full_name}
                                </span>
                                <span className="text-[10px] font-mono text-slate-400">
                                    ({activeEmpDetail.metrics.empPlans.length} mục)
                                </span>
                            </h4>
                            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                                {activeEmpDetail.metrics.empPlans.length === 0 ? (
                                    <div className="py-8 text-center text-slate-500 text-xs italic">
                                        Chưa có kế hoạch tuần nào được lập cho tuần {selectedWeek}.
                                    </div>
                                ) : (
                                    activeEmpDetail.metrics.empPlans.map((p: any, idx: number) => (
                                        <div
                                            key={p.plan_id || idx}
                                            className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl flex items-start justify-between gap-3 text-xs"
                                        >
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 font-mono text-[10px] font-bold">
                                                        {p.day_of_week}
                                                    </span>
                                                    <span className="text-slate-400 text-[10px]">
                                                        {p.time_slot}
                                                    </span>
                                                </div>
                                                <div className="font-bold text-white">
                                                    {p.task_name}
                                                </div>
                                                {p.project_name && (
                                                    <div className="text-[10px] text-slate-400">
                                                        Dự án / Nội dung: {p.project_name}
                                                    </div>
                                                )}
                                                {p.result_summary && (
                                                    <div className="text-[10px] text-emerald-400 bg-emerald-950/40 p-1.5 rounded border border-emerald-900/50 mt-1">
                                                        Kết quả: {p.result_summary}
                                                    </div>
                                                )}
                                            </div>
                                            <span
                                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                                                    (p.status || "").toLowerCase() === "completed"
                                                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                                        : (p.status || "").toLowerCase() === "in progress"
                                                        ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                                                        : "bg-slate-800 text-slate-400"
                                                }`}
                                            >
                                                {p.status || "Pending"}
                                            </span>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Recent Daily Logs for this employee */}
                        <div className="bg-slate-900/95 p-4 rounded-2xl border border-slate-800 shadow-xl">
                            <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center justify-between">
                                <span className="flex items-center gap-1.5">
                                    <FileText className="w-4 h-4 text-orange-500" />
                                    Nhật ký Daily của {activeEmpDetail.full_name}
                                </span>
                                <span className="text-[10px] font-mono text-slate-400">
                                    ({activeEmpDetail.metrics.empLogs.length} lượt)
                                </span>
                            </h4>
                            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                                {activeEmpDetail.metrics.empLogs.length === 0 ? (
                                    <div className="py-8 text-center text-slate-500 text-xs italic">
                                        Chưa có nhật ký daily nào được ghi trong kỳ này.
                                    </div>
                                ) : (
                                    activeEmpDetail.metrics.empLogs.map((l: any, idx: number) => (
                                        <div
                                            key={l.log_id || idx}
                                            className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl space-y-1 text-xs"
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className="font-mono text-orange-400 text-[10px] font-bold">
                                                    📅 {l.date}
                                                </span>
                                                <span className="text-[9px] text-slate-500">
                                                    {l.created_at ? new Date(l.created_at).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" }) : ""}
                                                </span>
                                            </div>
                                            <div className="text-slate-200 whitespace-pre-line text-xs font-normal leading-relaxed">
                                                {l.content}
                                            </div>
                                            {l.issues && (
                                                <div className="text-[10px] text-rose-300 bg-rose-950/30 p-1.5 rounded border border-rose-900/40 mt-1 flex items-start gap-1">
                                                    <AlertTriangle className="w-3 h-3 shrink-0 text-rose-400 mt-0.5" />
                                                    <span>Khó khăn/Đề xuất: {l.issues}</span>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 3: PLAN VS ACTUAL DAILY AUDIT */}
            {activeSubView === "audit" && (
                <div className="bg-slate-900/95 p-4 rounded-2xl border border-slate-800 shadow-xl space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-slate-800">
                        <div>
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                <Layers className="w-4 h-4 text-orange-500" />
                                MA TRẬN ĐỐI CHIẾU KẾ HOẠCH TUẦN VS NHẬT KÝ DAILY THỰC TẾ
                            </h3>
                            <p className="text-[11px] text-slate-400">
                                Đối chiếu giữa công việc đã lên kế hoạch theo thứ và nhật ký thực tế được ghi nhận trong ngày.
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-xs text-slate-400 font-bold">Xem nhân sự:</label>
                            <select
                                value={activeEmpDetail?.employee_id || ""}
                                onChange={(e) => setSelectedEmpForDetail(e.target.value)}
                                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white font-bold outline-none focus:border-orange-500 cursor-pointer"
                            >
                                {staffEvaluations.map(s => (
                                    <option key={s.employee_id} value={s.employee_id}>
                                        {s.full_name} ({s.employee_id})
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Days of Week Comparison Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"].map((dayName, dayIdx) => {
                            const dayPlans = (activeEmpDetail?.metrics.empPlans || []).filter((p: any) => p.day_of_week === dayName);
                            const dayLogs = (activeEmpDetail?.metrics.empLogs || []).filter((l: any) => {
                                if (!l.date) return false;
                                const d = new Date(l.date);
                                const dayNum = d.getDay(); // 0: Sun, 1: Mon, ...
                                const targetNum = dayIdx + 1; // 1: Mon, 2: Tue...
                                return dayNum === targetNum;
                            });

                            return (
                                <div
                                    key={dayName}
                                    className="bg-slate-950/70 border border-slate-800 rounded-2xl p-3.5 space-y-3 flex flex-col justify-between hover:border-orange-500/30 transition-all"
                                >
                                    <div>
                                        <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2">
                                            <span className="text-xs font-bold text-orange-400">
                                                {dayName}
                                            </span>
                                            <div className="flex items-center gap-2 text-[10px] font-mono">
                                                <span className="text-indigo-400">{dayPlans.length} kế hoạch</span>
                                                <span className="text-slate-600">•</span>
                                                <span className="text-amber-400">{dayLogs.length} daily log</span>
                                            </div>
                                        </div>

                                        {/* Plans for this day */}
                                        <div className="space-y-1.5 mb-3">
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                                                Kế hoạch đã lập:
                                            </span>
                                            {dayPlans.length === 0 ? (
                                                <p className="text-[11px] text-slate-500 italic">Không có kế hoạch</p>
                                            ) : (
                                                dayPlans.map((p: any, idx: number) => (
                                                    <div
                                                        key={p.plan_id || idx}
                                                        className="p-2 bg-slate-900/80 rounded-lg border border-slate-800 text-[11px] space-y-0.5"
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-[9px] text-slate-400 font-mono">{p.time_slot}</span>
                                                            <span className={`text-[9px] font-bold ${
                                                                (p.status || "").toLowerCase() === "completed" ? "text-emerald-400" : "text-amber-400"
                                                            }`}>
                                                                {p.status || "Pending"}
                                                            </span>
                                                        </div>
                                                        <div className="font-bold text-white text-xs">{p.task_name}</div>
                                                    </div>
                                                ))
                                            )}
                                        </div>

                                        {/* Daily Logs for this day */}
                                        <div className="space-y-1.5">
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                                                Thực tế ghi nhận trong ngày:
                                            </span>
                                            {dayLogs.length === 0 ? (
                                                <p className="text-[11px] text-slate-500 italic">Chưa có nhật ký daily cho ngày này</p>
                                            ) : (
                                                dayLogs.map((l: any, idx: number) => (
                                                    <div
                                                        key={l.log_id || idx}
                                                        className="p-2 bg-amber-950/20 rounded-lg border border-amber-900/30 text-[11px] space-y-1"
                                                    >
                                                        <div className="text-slate-200 leading-snug line-clamp-3">
                                                            {l.content}
                                                        </div>
                                                        {l.issues && (
                                                            <div className="text-[10px] text-rose-300">
                                                                ⚠️ {l.issues}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>

                                    {/* Day Audit Match Indicator */}
                                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px]">
                                        <span className="text-slate-400">Độ khớp Kế hoạch - Thực tế:</span>
                                        {dayPlans.length > 0 && dayLogs.length > 0 ? (
                                            <span className="text-emerald-400 font-bold flex items-center gap-1">
                                                <CheckCircle2 className="w-3 h-3" />
                                                Khớp tốt
                                            </span>
                                        ) : dayPlans.length > 0 && dayLogs.length === 0 ? (
                                            <span className="text-amber-400 font-bold flex items-center gap-1">
                                                <Clock className="w-3 h-3" />
                                                Thiếu daily log
                                            </span>
                                        ) : dayPlans.length === 0 && dayLogs.length > 0 ? (
                                            <span className="text-indigo-400 font-bold flex items-center gap-1">
                                                Phát sinh ngoài KH
                                            </span>
                                        ) : (
                                            <span className="text-slate-500 italic">Trống</span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default SalesEvaluationAnalytics;

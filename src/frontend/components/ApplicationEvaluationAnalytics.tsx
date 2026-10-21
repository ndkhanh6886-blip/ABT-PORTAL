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
    Layers,
    FlaskConical,
    Wrench,
    GraduationCap,
    HelpCircle
} from "lucide-react";
import * as XLSX from "xlsx";

export interface ApplicationEvaluationAnalyticsProps {
    tasks?: any[];
    plans?: any[];
    dailyLogs?: Record<string, any> | any[];
    labMembers?: any[];
    selectedWeek: number;
    setSelectedWeek: (week: number) => void;
    selectedEmployee?: string;
    setSelectedEmployee?: (name: string) => void;
    showToast?: (message: string, type?: "success" | "error" | "warning" | "info") => void;
    customerIssues?: any[];
}

export interface AppStaffInfo {
    id: string;
    name: string;
    role: string;
    department: string;
    email?: string;
}

export const DEFAULT_APP_PERSONNEL: AppStaffInfo[] = [];

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
    endDate.setDate(startDate.getDate() + 5);

    const formatStr = (d: Date) => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
    return formatStr(startDate) + ' - ' + formatStr(endDate) + '/' + year;
}

export const ApplicationEvaluationAnalytics: React.FC<ApplicationEvaluationAnalyticsProps> = ({
    tasks = [],
    plans = [],
    dailyLogs = {},
    labMembers = [],
    selectedWeek = 37,
    setSelectedWeek,
    selectedEmployee = "Tất cả",
    setSelectedEmployee,
    showToast,
    customerIssues = []
}) => {
    const [viewScope, setViewScope] = useState<"week" | "all">("week");
    const [activeSubView, setActiveSubView] = useState<"leaderboard" | "matrix" | "audit">("leaderboard");
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedEmpForDetail, setSelectedEmpForDetail] = useState<string | null>(null);

    const evaluatableStaff = useMemo(() => {
        const allStaff: AppStaffInfo[] = [];

        if (labMembers && labMembers.length > 0) {
            labMembers.forEach((m: any) => {
                const name = m.name || m.full_name || m.username;
                if (name && !allStaff.some(s => s.name.toLowerCase() === name.toLowerCase())) {
                    allStaff.push({
                        id: m.id || m.employee_id || ("APP-" + (allStaff.length + 1)),
                        name: name,
                        role: m.role || m.position || "Kỹ sư ứng dụng",
                        department: "Application",
                        email: m.email || ""
                    });
                }
            });
        }

        const rawList = allStaff.length > 0 ? allStaff : DEFAULT_APP_PERSONNEL;
        let list: AppStaffInfo[] = [...rawList];

        if (selectedEmployee && selectedEmployee !== "Tất cả" && selectedEmployee !== "all") {
            list = list.filter(p => p.name === selectedEmployee || p.id === selectedEmployee);
        }

        if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase();
            list = list.filter(p =>
                String(p.name || "").toLowerCase().includes(q) ||
                String(p.id || "").toLowerCase().includes(q) ||
                String(p.role || "").toLowerCase().includes(q)
            );
        }

        return list;
    }, [labMembers, selectedEmployee, searchTerm]);

    const computeStaffMetrics = (staff: AppStaffInfo) => {
        const empName = staff.name;
        const empId = staff.id;

        const empTasks = tasks.filter(t => {
            if (!t) return false;
            const assignee = t.assignee || t.assignee_id || t.user_name || "";
            return assignee === empName || assignee === empId;
        });

        const totalTasks = empTasks.length;
        const doneTasks = empTasks.filter(t => {
            const s = (t.status || "").toLowerCase();
            return s === "done" || s === "completed" || s === "report approved";
        }).length;
        const inProgressTasks = empTasks.filter(t => {
            const s = (t.status || "").toLowerCase();
            return s === "in progress" || s === "in_progress" || s === "doing" || s === "protocol approved";
        }).length;
        const todoTasks = Math.max(0, totalTasks - doneTasks - inProgressTasks);

        const now = new Date();
        const overdueTasks = empTasks.filter(t => {
            const s = (t.status || "").toLowerCase();
            if (s === "done" || s === "completed" || s === "report approved") return false;
            if (!t.dueDate && !t.due_date) return false;
            const due = new Date(t.dueDate || t.due_date);
            return due < now;
        }).length;

        const taskCompletionRate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 100;
        const onTimeRate = totalTasks > 0 ? Math.max(0, Math.round(((totalTasks - overdueTasks) / totalTasks) * 100)) : 100;
        const taskScore = Math.round((taskCompletionRate * 0.7) + (onTimeRate * 0.3));

        let empPlans = plans.filter(p => {
            if (!p) return false;
            const u = p.user_name || p.userName || p.salesRepName || p.assignee_id || "";
            return u === empName || u === empId;
        });

        if (viewScope === "week") {
            empPlans = empPlans.filter(p => Number(p.week_number || p.week) === Number(selectedWeek));
        }

        let totalPlanItems = 0;
        let completedPlanItems = 0;
        let inProgressPlanItems = 0;

        empPlans.forEach(p => {
            const items = Array.isArray(p.items) ? p.items : [];
            totalPlanItems += items.length;
            items.forEach((it: any) => {
                const log = typeof dailyLogs === "object" && !Array.isArray(dailyLogs) ? dailyLogs[it.id] : null;
                const status = (log?.status || it.status || "").toLowerCase();
                if (status === "completed" || status === "done") {
                    completedPlanItems++;
                } else if (status === "in progress" || status === "in_progress") {
                    inProgressPlanItems++;
                }
            });
        });

        const pendingPlanItems = Math.max(0, totalPlanItems - completedPlanItems - inProgressPlanItems);
        const planCompletionRate = totalPlanItems > 0 ? Math.round((completedPlanItems / totalPlanItems) * 100) : 0;
        const planScore = planCompletionRate;

        let logEntries: any[] = [];
        if (typeof dailyLogs === "object" && !Array.isArray(dailyLogs)) {
            logEntries = Object.values(dailyLogs).filter((l: any) => {
                if (!l) return false;
                const u = l.user_name || l.userName || l.employee_name || l.author || "";
                return u === empName || u === empId;
            });
        } else if (Array.isArray(dailyLogs)) {
            logEntries = dailyLogs.filter((l: any) => {
                const u = l.user_name || l.userName || l.employee_id || "";
                return u === empName || u === empId;
            });
        }

        const totalLogs = logEntries.length;
        const distinctDates = new Set(logEntries.map(l => l.date || l.createdAt?.split("T")[0]).filter(Boolean));
        const activeDaysCount = distinctDates.size;
        const targetDays = viewScope === "week" ? 5 : 20;
        const dailyDisciplineRate = Math.min(100, Math.round((activeDaysCount / targetDays) * 100));
        const dailyScore = totalLogs > 0 ? Math.max(dailyDisciplineRate, Math.min(100, totalLogs * 16)) : 0;

        const empIssues = customerIssues.filter(iss => {
            const handler = iss.assignedTo || iss.technician || iss.handler || "";
            return handler === empName || handler === empId;
        });
        const resolvedIssues = empIssues.filter(iss => iss.status === "Resolved" || iss.status === "Completed" || iss.status === "Closed").length;

        const workloadVolume = totalTasks + totalPlanItems;
        let workloadLabel = "Định mức (Chuẩn)";
        let workloadColor = "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
        let workloadLevel: "overload" | "standard" | "light" | "unassigned" = "standard";

        if (workloadVolume > 8) {
            workloadLabel = "Quá tải (Cao)";
            workloadColor = "text-rose-400 bg-rose-500/10 border-rose-500/30";
            workloadLevel = "overload";
        } else if (workloadVolume >= 4) {
            workloadLabel = "Định mức (Chuẩn)";
            workloadColor = "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
            workloadLevel = "standard";
        } else if (workloadVolume > 0) {
            workloadLabel = "Tải nhẹ (Thấp)";
            workloadColor = "text-cyan-400 bg-cyan-500/10 border-cyan-500/30";
            workloadLevel = "light";
        } else {
            workloadLabel = "Chưa phân công";
            workloadColor = "text-slate-500 bg-slate-800/60 border-slate-700";
            workloadLevel = "unassigned";
        }

        let kpiScore = 0;
        if (totalTasks === 0 && totalPlanItems === 0 && totalLogs === 0) {
            kpiScore = 75;
        } else if (totalPlanItems === 0) {
            kpiScore = Math.round((taskScore * 0.65) + (dailyScore * 0.35));
        } else if (totalTasks === 0) {
            kpiScore = Math.round((planScore * 0.65) + (dailyScore * 0.35));
        } else {
            kpiScore = Math.round((taskScore * 0.40) + (planScore * 0.35) + (dailyScore * 0.25));
        }
        kpiScore = Math.max(40, Math.min(100, kpiScore));

        let tier: "A+" | "A" | "B" | "C" | "D" = "B";
        let tierLabel = "Giỏi / Tốt";
        let tierColor = "text-indigo-400 bg-indigo-500/10 border-indigo-500/30";

        if (kpiScore >= 90) {
            tier = "A+";
            tierLabel = "Xuất Sắc Vượt Trội";
            tierColor = "text-amber-400 bg-amber-500/10 border-amber-500/40";
        } else if (kpiScore >= 80) {
            tier = "A";
            tierLabel = "Xuất Sắc";
            tierColor = "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
        } else if (kpiScore >= 65) {
            tier = "B";
            tierLabel = "Giỏi / Tốt";
            tierColor = "text-indigo-400 bg-indigo-500/10 border-indigo-500/30";
        } else if (kpiScore >= 50) {
            tier = "C";
            tierLabel = "Đạt Yêu Cầu";
            tierColor = "text-cyan-400 bg-cyan-500/10 border-cyan-500/30";
        } else {
            tier = "D";
            tierLabel = "Cần Cải Thiện";
            tierColor = "text-rose-400 bg-rose-500/10 border-rose-500/30";
        }

        let recommendation = "";
        if (kpiScore >= 85) {
            recommendation = "Kỹ sư duy trì phong độ xuất sắc, hoàn thành các buổi demo máy và xử lý mẫu thử nghiệm chuẩn xác.";
        } else if (overdueTasks > 0) {
            recommendation = "Có " + overdueTasks + " nhiệm vụ kỹ thuật trễ hạn, cần ưu tiên hoàn tất báo cáo kỹ thuật và gửi khách hàng.";
        } else if (planCompletionRate < 50 && totalPlanItems > 0) {
            recommendation = "Cần tăng tốc độ xử lý các mục tiêu đã cam kết trong kế hoạch tuần của phòng Application.";
        } else if (workloadLevel === "overload") {
            recommendation = "Khối lượng công việc đang rất cao, trưởng bộ phận nên cân nhắc chia sẻ bớt lịch demo thiết bị.";
        } else if (workloadLevel === "light") {
            recommendation = "Khối lượng công việc tương đối nhẹ, có thể nhận thêm yêu cầu hỗ trợ demo hoặc đào tạo SOP.";
        } else {
            recommendation = "Duy trì kỷ luật báo cáo và hỗ trợ phối hợp chặt chẽ với đội ngũ Kinh doanh & Kho.";
        }

        return {
            staff,
            empId,
            empName,
            totalTasks,
            doneTasks,
            inProgressTasks,
            todoTasks,
            overdueTasks,
            taskCompletionRate,
            onTimeRate,
            taskScore,
            totalPlanItems,
            completedPlanItems,
            inProgressPlanItems,
            pendingPlanItems,
            planCompletionRate,
            planScore,
            totalLogs,
            activeDaysCount,
            dailyDisciplineRate,
            dailyScore,
            workloadVolume,
            workloadLabel,
            workloadColor,
            workloadLevel,
            kpiScore,
            tier,
            tierLabel,
            tierColor,
            recommendation,
            empTasks,
            empPlans,
            logEntries,
            resolvedIssues,
            totalIssues: empIssues.length
        };
    };

    const staffMetricsList = useMemo(() => {
        return evaluatableStaff.map(computeStaffMetrics).sort((a, b) => b.kpiScore - a.kpiScore);
    }, [evaluatableStaff, tasks, plans, dailyLogs, selectedWeek, viewScope, customerIssues]);

    const departmentOverview = useMemo(() => {
        const staffCount = staffMetricsList.length;
        const totalTasksAll = staffMetricsList.reduce((sum, s) => sum + s.totalTasks, 0);
        const doneTasksAll = staffMetricsList.reduce((sum, s) => sum + s.doneTasks, 0);
        const overdueTasksAll = staffMetricsList.reduce((sum, s) => sum + s.overdueTasks, 0);

        const totalPlanItemsAll = staffMetricsList.reduce((sum, s) => sum + s.totalPlanItems, 0);
        const donePlanItemsAll = staffMetricsList.reduce((sum, s) => sum + s.completedPlanItems, 0);

        const avgKpiScore = staffCount > 0 ? Math.round(staffMetricsList.reduce((sum, s) => sum + s.kpiScore, 0) / staffCount) : 0;
        const avgTaskCompletionRate = totalTasksAll > 0 ? Math.round((doneTasksAll / totalTasksAll) * 100) : 0;
        const avgOnTimeRate = totalTasksAll > 0 ? Math.max(0, Math.round(((totalTasksAll - overdueTasksAll) / totalTasksAll) * 100)) : 100;
        const avgPlanCompletionRate = totalPlanItemsAll > 0 ? Math.round((donePlanItemsAll / totalPlanItemsAll) * 100) : 0;

        const overloadStaffCount = staffMetricsList.filter(s => s.workloadLevel === "overload").length;
        const standardStaffCount = staffMetricsList.filter(s => s.workloadLevel === "standard").length;
        const lightStaffCount = staffMetricsList.filter(s => s.workloadLevel === "light").length;

        return {
            staffCount,
            totalTasksAll,
            doneTasksAll,
            overdueTasksAll,
            totalPlanItemsAll,
            donePlanItemsAll,
            avgKpiScore,
            avgTaskCompletionRate,
            avgOnTimeRate,
            avgPlanCompletionRate,
            overloadStaffCount,
            standardStaffCount,
            lightStaffCount
        };
    }, [staffMetricsList]);

    const activeStaffAudit = useMemo(() => {
        if (!selectedEmpForDetail) {
            return staffMetricsList[0] || null;
        }
        return staffMetricsList.find(s => s.empId === selectedEmpForDetail || s.empName === selectedEmpForDetail) || staffMetricsList[0] || null;
    }, [staffMetricsList, selectedEmpForDetail]);

    const handleExportExcel = () => {
        try {
            const dataToExport = staffMetricsList.map((s, idx) => ({
                "Xếp hạng": idx + 1,
                "Mã NV": s.empId,
                "Họ và Tên": s.empName,
                "Chức vụ chuyên môn": s.staff.role,
                "Mức tải công việc": s.workloadLabel,
                "Tổng việc được giao": s.totalTasks,
                "Việc hoàn thành": s.doneTasks,
                "Việc đang làm": s.inProgressTasks,
                "Việc trễ hạn": s.overdueTasks,
                "Tỷ lệ hoàn thành việc (%)": s.taskCompletionRate + "%",
                "Tỷ lệ đúng hạn (%)": s.onTimeRate + "%",
                "Mục tiêu kế hoạch tuần": s.totalPlanItems,
                "Kế hoạch hoàn thành": s.completedPlanItems,
                "Tỷ lệ đạt kế hoạch (%)": s.planCompletionRate + "%",
                "Số ngày ghi nhật ký Daily": s.activeDaysCount + " ngày",
                "Kỷ luật báo cáo (%)": s.dailyDisciplineRate + "%",
                "Điểm KPI tổng hợp (100)": s.kpiScore,
                "Xếp loại thi đua": "Hạng " + s.tier + " (" + s.tierLabel + ")",
                "Nhận xét & Khuyến nghị": s.recommendation
            }));

            const worksheet = XLSX.utils.json_to_sheet(dataToExport);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Danh_Gia_Hieu_Suat_App");

            const fileName = "Danh_Gia_Hieu_Suat_Phong_Application_TBR_Tuan_" + selectedWeek + ".xlsx";
            XLSX.writeFile(workbook, fileName);

            if (showToast) showToast("Đã xuất báo cáo Excel hiệu suất Tuần " + selectedWeek + " thành công!", "success");
        } catch (e) {
            console.error("Failed to export excel:", e);
            if (showToast) showToast("Lỗi khi xuất tệp Excel báo cáo!", "error");
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div>
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-orange-600/10 text-orange-600 dark:text-orange-400 flex items-center justify-center font-bold">
                            <Activity className="w-4 h-4" />
                        </div>
                        <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white uppercase tracking-wider font-mono">
                            ĐÁNH GIÁ KHỐI LƯỢNG & HIỆU SUẤT PHÒNG APPLICATION
                        </h2>
                        <span className="text-[10px] bg-orange-50 dark:bg-orange-950/80 text-orange-700 dark:text-orange-400 px-2.5 py-0.5 rounded-full border border-orange-200 dark:border-orange-800 font-bold font-mono">
                            {departmentOverview.staffCount} Kỹ sư
                        </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        Hệ thống đo lường khối lượng công việc, tỷ lệ hoàn thành kế hoạch tuần và kỷ luật báo cáo của kỹ sư ứng dụng TBRs.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <div className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-0.5 flex items-center text-xs font-semibold">
                        <button
                            onClick={() => setViewScope("week")}
                            className={"px-3 py-1.5 rounded-lg transition-colors cursor-pointer " + (
                                viewScope === "week"
                                    ? "bg-orange-600 text-white shadow-xs font-bold"
                                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                            )}
                        >
                            Theo Tuần ({selectedWeek})
                        </button>
                        <button
                            onClick={() => setViewScope("all")}
                            className={"px-3 py-1.5 rounded-lg transition-colors cursor-pointer " + (
                                viewScope === "all"
                                    ? "bg-orange-600 text-white shadow-xs font-bold"
                                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                            )}
                        >
                            Toàn bộ thời gian
                        </button>
                    </div>

                    {viewScope === "week" && (
                        <div className="flex items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-2 py-1 shadow-xs">
                            <button
                                onClick={() => setSelectedWeek(Math.max(1, selectedWeek - 1))}
                                className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded-md transition-colors cursor-pointer"
                                title="Tuần trước"
                            >
                                <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                            <div className="px-2 text-center">
                                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block leading-tight">
                                    Tuần {selectedWeek}
                                </span>
                                <span className="text-[9px] text-slate-400 dark:text-slate-500 block leading-tight">
                                    {getWeekDateRange(selectedWeek)}
                                </span>
                            </div>
                            <button
                                onClick={() => setSelectedWeek(Math.min(52, selectedWeek + 1))}
                                className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded-md transition-colors cursor-pointer"
                                title="Tuần sau"
                            >
                                <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    )}

                    <button
                        onClick={handleExportExcel}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                        title="Tải bảng đánh giá hiệu suất định dạng Excel"
                    >
                        <Download className="w-3.5 h-3.5" />
                        <span>Xuất Excel</span>
                    </button>
                </div>
            </div>

            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-900/60 p-1 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs font-bold">
                    <button
                        onClick={() => setActiveSubView("leaderboard")}
                        className={"flex items-center gap-2 px-3.5 py-2 rounded-xl transition-all cursor-pointer " + (
                            activeSubView === "leaderboard"
                                ? "bg-white dark:bg-slate-800 text-orange-600 dark:text-orange-400 shadow-sm"
                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                        )}
                    >
                        <Award className="w-4 h-4" />
                        <span>Bảng Xếp Hạng & Chỉ Số</span>
                    </button>

                    <button
                        onClick={() => setActiveSubView("matrix")}
                        className={"flex items-center gap-2 px-3.5 py-2 rounded-xl transition-all cursor-pointer " + (
                            activeSubView === "matrix"
                                ? "bg-white dark:bg-slate-800 text-orange-600 dark:text-orange-400 shadow-sm"
                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                        )}
                    >
                        <BarChart3 className="w-4 h-4" />
                        <span>Ma Trận Khối Lượng & Hiệu Suất</span>
                    </button>

                    <button
                        onClick={() => setActiveSubView("audit")}
                        className={"flex items-center gap-2 px-3.5 py-2 rounded-xl transition-all cursor-pointer " + (
                            activeSubView === "audit"
                                ? "bg-white dark:bg-slate-800 text-orange-600 dark:text-orange-400 shadow-sm"
                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                        )}
                    >
                        <ShieldCheck className="w-4 h-4" />
                        <span>Kiểm Toán Chi Tiết Nhân Sự</span>
                    </button>
                </div>

                <div className="flex items-center gap-2 flex-1 sm:flex-initial sm:min-w-[260px]">
                    <div className="relative w-full">
                        <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Tìm kỹ sư, chức vụ, mã NV..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-orange-500 transition-colors shadow-xs"
                        />
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs">
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] text-orange-600 dark:text-orange-400 font-bold uppercase tracking-wider">
                            Tổng việc kỹ thuật
                        </span>
                        <Activity className="w-4 h-4 text-orange-500" />
                    </div>
                    <div className="text-xl font-black font-mono text-slate-900 dark:text-white">
                        {departmentOverview.totalTasksAll} việc
                    </div>
                    <span className="text-[10px] text-slate-400 mt-0.5 block">
                        {departmentOverview.doneTasksAll} xong • {departmentOverview.overdueTasksAll} trễ
                    </span>
                </div>

                <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs">
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider">
                            Tỷ lệ hoàn thành
                        </span>
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    </div>
                    <div className="text-xl font-black font-mono text-emerald-600 dark:text-emerald-400">
                        {departmentOverview.avgTaskCompletionRate}%
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1.5">
                        <div
                            style={{ width: departmentOverview.avgTaskCompletionRate + "%" }}
                            className="bg-emerald-500 h-full rounded-full transition-all"
                        />
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs">
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-wider">
                            Tỷ lệ đúng hạn
                        </span>
                        <Clock className="w-4 h-4 text-indigo-500" />
                    </div>
                    <div className="text-xl font-black font-mono text-indigo-600 dark:text-indigo-400">
                        {departmentOverview.avgOnTimeRate}%
                    </div>
                    <span className="text-[10px] text-slate-400 mt-0.5 block">
                        Đảm bảo tiến độ demo & test
                    </span>
                </div>

                <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs">
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] text-purple-600 dark:text-purple-400 font-bold uppercase tracking-wider">
                            Phân bổ tải phòng
                        </span>
                        <Layers className="w-4 h-4 text-purple-500" />
                    </div>
                    <div className="text-xl font-black font-mono text-slate-900 dark:text-white">
                        {departmentOverview.standardStaffCount} chuẩn
                    </div>
                    <span className="text-[10px] text-slate-400 mt-0.5 block">
                        {departmentOverview.overloadStaffCount} quá tải • {departmentOverview.lightStaffCount} nhẹ
                    </span>
                </div>

                <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs">
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold uppercase tracking-wider">
                            Điểm KPI trung bình
                        </span>
                        <Star className="w-4 h-4 text-amber-500" />
                    </div>
                    <div className="text-xl font-black font-mono text-amber-500">
                        {departmentOverview.avgKpiScore} / 100
                    </div>
                    <span className="text-[10px] text-slate-400 mt-0.5 block">
                        Xếp loại toàn phòng: Giỏi / Tốt
                    </span>
                </div>
            </div>

            {activeSubView === "leaderboard" && (
                <div className="space-y-6">
                    {staffMetricsList.length >= 3 && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                            <div className="bg-gradient-to-b from-slate-100 to-white dark:from-slate-800/80 dark:to-slate-900/80 border border-slate-300 dark:border-slate-700 rounded-2xl p-4 flex flex-col items-center text-center relative shadow-sm order-2 md:order-1">
                                <div className="absolute -top-3 px-3 py-0.5 bg-slate-300 dark:bg-slate-600 text-slate-800 dark:text-white text-[10px] font-black rounded-full uppercase tracking-wider border border-white dark:border-slate-500">
                                    🥈 Hạng 2 • Bạc
                                </div>
                                <div className="w-12 h-12 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold flex items-center justify-center text-sm mt-3 mb-2 border-2 border-slate-300 dark:border-slate-500">
                                    {staffMetricsList[1].empName.slice(0, 2).toUpperCase()}
                                </div>
                                <h4 className="font-extrabold text-sm text-slate-900 dark:text-white">
                                    {staffMetricsList[1].empName}
                                </h4>
                                <span className="text-[10px] text-slate-500 dark:text-slate-400 mb-2">
                                    {staffMetricsList[1].staff.role}
                                </span>
                                <div className="text-2xl font-black font-mono text-slate-700 dark:text-slate-200">
                                    {staffMetricsList[1].kpiScore} <span className="text-xs font-semibold text-slate-400">KPI</span>
                                </div>
                                <div className="flex items-center gap-2 mt-2 text-[10px]">
                                    <span className="bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-md font-bold">
                                        {staffMetricsList[1].taskCompletionRate}% Xong
                                    </span>
                                    <span className="bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-md font-medium">
                                        {staffMetricsList[1].workloadVolume} đầu việc
                                    </span>
                                </div>
                            </div>

                            <div className="bg-gradient-to-b from-amber-50 to-white dark:from-amber-950/40 dark:to-slate-900/90 border-2 border-amber-400 dark:border-amber-500/60 rounded-2xl p-5 flex flex-col items-center text-center relative shadow-lg shadow-amber-500/10 order-1 md:order-2 transform md:-translate-y-2">
                                <div className="absolute -top-3.5 px-4 py-0.5 bg-gradient-to-r from-amber-500 to-yellow-400 text-slate-950 text-[11px] font-black rounded-full uppercase tracking-wider shadow-md">
                                    🥇 Quán Quân • Vàng
                                </div>
                                <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 font-extrabold flex items-center justify-center text-base mt-3 mb-2 border-2 border-amber-400 shadow-sm">
                                    {staffMetricsList[0].empName.slice(0, 2).toUpperCase()}
                                </div>
                                <h4 className="font-black text-base text-slate-900 dark:text-white">
                                    {staffMetricsList[0].empName}
                                </h4>
                                <span className="text-[10px] text-amber-700 dark:text-amber-400 font-semibold mb-2">
                                    {staffMetricsList[0].staff.role}
                                </span>
                                <div className="text-3xl font-black font-mono text-amber-500">
                                    {staffMetricsList[0].kpiScore} <span className="text-sm font-semibold text-slate-400">KPI</span>
                                </div>
                                <div className="flex items-center gap-2 mt-2 text-[10px]">
                                    <span className="bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 px-2.5 py-0.5 rounded-full font-extrabold border border-emerald-300 dark:border-emerald-800">
                                        {staffMetricsList[0].taskCompletionRate}% Hoàn thành
                                    </span>
                                    <span className="bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 px-2.5 py-0.5 rounded-full font-bold border border-amber-300 dark:border-amber-800">
                                        {staffMetricsList[0].workloadVolume} việc
                                    </span>
                                </div>
                            </div>

                            <div className="bg-gradient-to-b from-orange-50 to-white dark:from-orange-950/30 dark:to-slate-900/80 border border-orange-200 dark:border-orange-800/60 rounded-2xl p-4 flex flex-col items-center text-center relative shadow-sm order-3">
                                <div className="absolute -top-3 px-3 py-0.5 bg-orange-700 text-white text-[10px] font-black rounded-full uppercase tracking-wider border border-white dark:border-orange-600">
                                    🥉 Hạng 3 • Đồng
                                </div>
                                <div className="w-12 h-12 rounded-full bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-400 font-bold flex items-center justify-center text-sm mt-3 mb-2 border-2 border-orange-300 dark:border-orange-800">
                                    {staffMetricsList[2].empName.slice(0, 2).toUpperCase()}
                                </div>
                                <h4 className="font-extrabold text-sm text-slate-900 dark:text-white">
                                    {staffMetricsList[2].empName}
                                </h4>
                                <span className="text-[10px] text-slate-500 dark:text-slate-400 mb-2">
                                    {staffMetricsList[2].staff.role}
                                </span>
                                <div className="text-2xl font-black font-mono text-orange-600 dark:text-orange-400">
                                    {staffMetricsList[2].kpiScore} <span className="text-xs font-semibold text-slate-400">KPI</span>
                                </div>
                                <div className="flex items-center gap-2 mt-2 text-[10px]">
                                    <span className="bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-md font-bold">
                                        {staffMetricsList[2].taskCompletionRate}% Xong
                                    </span>
                                    <span className="bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-md font-medium">
                                        {staffMetricsList[2].workloadVolume} đầu việc
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
                        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                            <div>
                                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                                    Bảng Đánh Giá & Xếp Hạng Chi Tiết (Tuần {selectedWeek})
                                </h3>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                    Điểm KPI tính trên trọng số: Công việc kỹ thuật (40%), Kế hoạch tuần (35%), Kỷ luật báo cáo Daily (25%).
                                </p>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider">
                                        <th className="py-3 px-3 text-center">Hạng</th>
                                        <th className="py-3 px-4">Kỹ sư ứng dụng</th>
                                        <th className="py-3 px-3 text-center">Tải công việc</th>
                                        <th className="py-3 px-4">Tiến độ việc (Tasks)</th>
                                        <th className="py-3 px-3 text-center">Đúng hạn</th>
                                        <th className="py-3 px-3 text-center">Kế hoạch</th>
                                        <th className="py-3 px-3 text-center">Kỷ luật Daily</th>
                                        <th className="py-3 px-3 text-center">Điểm KPI</th>
                                        <th className="py-3 px-3 text-center">Xếp loại</th>
                                        <th className="py-3 px-3 text-center">Chi tiết</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                                    {staffMetricsList.map((s, idx) => (
                                        <tr
                                            key={s.empId}
                                            className="hover:bg-slate-50 dark:hover:bg-slate-850/50 transition-colors"
                                        >
                                            <td className="py-3 px-3 text-center font-mono font-bold">
                                                {idx === 0 ? "🥇 1" : idx === 1 ? "🥈 2" : idx === 2 ? "🥉 3" : "#" + (idx + 1)}
                                            </td>

                                            <td className="py-3 px-4">
                                                <div className="flex items-center gap-2.5">
                                                    <div className="w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-400 font-bold flex items-center justify-center text-xs shrink-0 border border-orange-200 dark:border-orange-800">
                                                        {s.empName.slice(0, 2).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <div className="font-bold text-slate-900 dark:text-white">
                                                            {s.empName}
                                                        </div>
                                                        <div className="text-[10px] text-slate-400">
                                                            {s.staff.role} • {s.empId}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="py-3 px-3 text-center">
                                                <span className={"px-2.5 py-0.5 rounded-full text-[10px] font-bold border " + s.workloadColor}>
                                                    {s.workloadLabel}
                                                </span>
                                            </td>

                                            <td className="py-3 px-4 min-w-[160px]">
                                                <div className="flex items-center justify-between text-[10px] mb-1">
                                                    <span className="text-slate-500 font-bold">
                                                        {s.doneTasks}/{s.totalTasks} xong
                                                    </span>
                                                    <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                                        {s.taskCompletionRate}%
                                                    </span>
                                                </div>
                                                <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden flex">
                                                    <div
                                                        style={{ width: (s.totalTasks > 0 ? (s.doneTasks / s.totalTasks) * 100 : 0) + "%" }}
                                                        className="bg-emerald-500 h-full transition-all"
                                                        title="Đã hoàn thành"
                                                    />
                                                    <div
                                                        style={{ width: (s.totalTasks > 0 ? (s.inProgressTasks / s.totalTasks) * 100 : 0) + "%" }}
                                                        className="bg-orange-500 h-full transition-all"
                                                        title="Đang thực hiện"
                                                    />
                                                </div>
                                            </td>

                                            <td className="py-3 px-3 text-center font-mono font-bold text-slate-700 dark:text-slate-300">
                                                {s.onTimeRate}%
                                            </td>

                                            <td className="py-3 px-3 text-center font-mono font-bold text-purple-600 dark:text-purple-400">
                                                {s.completedPlanItems}/{s.totalPlanItems} ({s.planCompletionRate}%)
                                            </td>

                                            <td className="py-3 px-3 text-center font-mono font-bold text-cyan-600 dark:text-cyan-400">
                                                {s.activeDaysCount} ngày ({s.dailyDisciplineRate}%)
                                            </td>

                                            <td className="py-3 px-3 text-center">
                                                <span className="text-sm font-black font-mono text-orange-600 dark:text-orange-400">
                                                    {s.kpiScore}
                                                </span>
                                            </td>

                                            <td className="py-3 px-3 text-center">
                                                <span className={"px-2 py-0.5 rounded-md text-[10px] font-black border " + s.tierColor}>
                                                    {s.tier} • {s.tierLabel}
                                                </span>
                                            </td>

                                            <td className="py-3 px-3 text-center">
                                                <button
                                                    onClick={() => {
                                                        setSelectedEmpForDetail(s.empId);
                                                        setActiveSubView("audit");
                                                    }}
                                                    className="p-1.5 text-slate-400 hover:text-orange-600 dark:hover:text-orange-400 hover:bg-orange-50 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                                    title="Xem kiểm toán chi tiết"
                                                >
                                                    <ArrowUpRight className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {activeSubView === "matrix" && (
                <div className="space-y-6">
                    <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs">
                        <div className="mb-4">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                                Ma Trận Phân Bổ 4 Góc Phần Tư (Workload vs Performance)
                            </h3>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                Giúp trưởng bộ phận cân đối khối lượng công việc, phát hiện nguy cơ quá tải hoặc nhận diện nhân sự tiềm năng.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="p-5 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/20 border-2 border-emerald-300 dark:border-emerald-800/60 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-base">🌟</span>
                                        <h4 className="text-xs font-extrabold uppercase text-emerald-800 dark:text-emerald-300">
                                            Ngôi Sao Hiệu Suất (Tải Cao & Hiệu Suất Cao)
                                        </h4>
                                    </div>
                                    <span className="text-[10px] bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 font-bold px-2 py-0.5 rounded-full">
                                        {staffMetricsList.filter(s => s.workloadVolume >= 4 && s.kpiScore >= 75).length} nhân sự
                                    </span>
                                </div>
                                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                                    Gánh vác nhiều nhiệm vụ kỹ thuật phức tạp và luôn duy trì chất lượng vượt trội.
                                </p>
                                <div className="space-y-2 pt-1">
                                    {staffMetricsList
                                        .filter(s => s.workloadVolume >= 4 && s.kpiScore >= 75)
                                        .map(s => (
                                            <div key={s.empId} className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-emerald-200 dark:border-emerald-900 flex items-center justify-between">
                                                <div>
                                                    <span className="font-bold text-xs text-slate-900 dark:text-white block">{s.empName}</span>
                                                    <span className="text-[10px] text-slate-400">{s.staff.role} • {s.workloadVolume} việc</span>
                                                </div>
                                                <span className="text-xs font-black font-mono text-emerald-600 dark:text-emerald-400">
                                                    {s.kpiScore} KPI
                                                </span>
                                            </div>
                                        ))}
                                </div>
                            </div>

                            <div className="p-5 rounded-2xl bg-indigo-50/50 dark:bg-indigo-950/20 border-2 border-indigo-300 dark:border-indigo-800/60 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-base">⚡</span>
                                        <h4 className="text-xs font-extrabold uppercase text-indigo-800 dark:text-indigo-300">
                                            Tiềm Năng Phát Triển (Tải Nhẹ & Hiệu Suất Cao)
                                        </h4>
                                    </div>
                                    <span className="text-[10px] bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-bold px-2 py-0.5 rounded-full">
                                        {staffMetricsList.filter(s => s.workloadVolume < 4 && s.kpiScore >= 70).length} nhân sự
                                    </span>
                                </div>
                                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                                    Hoàn thành việc nhanh, sẵn sàng nhận thêm các buổi demo máy hoặc hỗ trợ kỹ thuật khách hàng.
                                </p>
                                <div className="space-y-2 pt-1">
                                    {staffMetricsList
                                        .filter(s => s.workloadVolume < 4 && s.kpiScore >= 70)
                                        .map(s => (
                                            <div key={s.empId} className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-indigo-200 dark:border-indigo-900 flex items-center justify-between">
                                                <div>
                                                    <span className="font-bold text-xs text-slate-900 dark:text-white block">{s.empName}</span>
                                                    <span className="text-[10px] text-slate-400">{s.staff.role} • {s.workloadVolume} việc</span>
                                                </div>
                                                <span className="text-xs font-black font-mono text-indigo-600 dark:text-indigo-400">
                                                    {s.kpiScore} KPI
                                                </span>
                                            </div>
                                        ))}
                                </div>
                            </div>

                            <div className="p-5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border-2 border-amber-300 dark:border-amber-800/60 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-base">⚠️</span>
                                        <h4 className="text-xs font-extrabold uppercase text-amber-800 dark:text-amber-300">
                                            Nguy Cơ Quá Tải (Tải Cao & Chậm Tiến Độ)
                                        </h4>
                                    </div>
                                    <span className="text-[10px] bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 font-bold px-2 py-0.5 rounded-full">
                                        {staffMetricsList.filter(s => s.workloadVolume >= 8 && s.kpiScore < 75).length} nhân sự
                                    </span>
                                </div>
                                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                                    Nhận quá nhiều việc dẫn đến trễ hạn, cần ban lãnh đạo san sẻ tải và hỗ trợ.
                                </p>
                                <div className="space-y-2 pt-1">
                                    {staffMetricsList
                                        .filter(s => s.workloadVolume >= 8 && s.kpiScore < 75)
                                        .map(s => (
                                            <div key={s.empId} className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-amber-200 dark:border-amber-900 flex items-center justify-between">
                                                <div>
                                                    <span className="font-bold text-xs text-slate-900 dark:text-white block">{s.empName}</span>
                                                    <span className="text-[10px] text-slate-400">{s.staff.role} • {s.workloadVolume} việc</span>
                                                </div>
                                                <span className="text-xs font-black font-mono text-amber-500">
                                                    {s.kpiScore} KPI
                                                </span>
                                            </div>
                                        ))}
                                </div>
                            </div>

                            <div className="p-5 rounded-2xl bg-rose-50/50 dark:bg-rose-950/20 border-2 border-rose-300 dark:border-rose-800/60 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-base">📉</span>
                                        <h4 className="text-xs font-extrabold uppercase text-rose-800 dark:text-rose-300">
                                            Cần Đôn Đốc Tiến Độ (Tải Thấp & Điểm Thấp)
                                        </h4>
                                    </div>
                                    <span className="text-[10px] bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300 font-bold px-2 py-0.5 rounded-full">
                                        {staffMetricsList.filter(s => s.workloadVolume < 4 && s.kpiScore < 70).length} nhân sự
                                    </span>
                                </div>
                                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                                    Khối lượng ít nhưng chưa hoàn thành dứt điểm hoặc thiếu ghi chép nhật ký daily.
                                </p>
                                <div className="space-y-2 pt-1">
                                    {staffMetricsList
                                        .filter(s => s.workloadVolume < 4 && s.kpiScore < 70)
                                        .map(s => (
                                            <div key={s.empId} className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-rose-200 dark:border-rose-900 flex items-center justify-between">
                                                <div>
                                                    <span className="font-bold text-xs text-slate-900 dark:text-white block">{s.empName}</span>
                                                    <span className="text-[10px] text-slate-400">{s.staff.role} • {s.workloadVolume} việc</span>
                                                </div>
                                                <span className="text-xs font-black font-mono text-rose-500">
                                                    {s.kpiScore} KPI
                                                </span>
                                            </div>
                                        ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeSubView === "audit" && activeStaffAudit && (
                <div className="space-y-6">
                    <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                        <div className="flex items-center gap-2">
                            <Users className="w-4 h-4 text-orange-500" />
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                Chọn kỹ sư để soi kiểm toán chi tiết:
                            </span>
                        </div>
                        <select
                            value={activeStaffAudit.empId}
                            onChange={(e) => setSelectedEmpForDetail(e.target.value)}
                            className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-900 dark:text-white font-bold focus:outline-none focus:border-orange-500"
                        >
                            {staffMetricsList.map(s => (
                                <option key={s.empId} value={s.empId}>
                                    {s.empName} ({s.staff.role} - {s.kpiScore} KPI)
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-2xl bg-orange-600/10 text-orange-600 dark:text-orange-400 font-black flex items-center justify-center text-base border border-orange-500/20">
                                    {activeStaffAudit.empName.slice(0, 2).toUpperCase()}
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-base font-black text-slate-900 dark:text-white">
                                            {activeStaffAudit.empName}
                                        </h3>
                                        <span className={"px-2 py-0.5 rounded-md text-[10px] font-black border " + activeStaffAudit.tierColor}>
                                            Hạng {activeStaffAudit.tier} ({activeStaffAudit.tierLabel})
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                        {activeStaffAudit.staff.role} • Mã NV: {activeStaffAudit.empId} • {activeStaffAudit.staff.email}
                                    </p>
                                </div>
                            </div>

                            <div className="text-right">
                                <span className="text-[10px] text-slate-400 uppercase font-bold block">Điểm KPI Tổng Hợp</span>
                                <span className="text-2xl font-black font-mono text-orange-600 dark:text-orange-400">
                                    {activeStaffAudit.kpiScore} / 100
                                </span>
                            </div>
                        </div>

                        <div className="bg-orange-50/50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800/40 rounded-xl p-3 text-xs flex items-start gap-2.5">
                            <Star className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                            <div className="leading-relaxed">
                                <strong className="text-orange-800 dark:text-orange-300">Đánh giá chuyên môn & Gợi ý cải tiến:</strong>
                                <span className="text-slate-700 dark:text-slate-300 ml-1">
                                    {activeStaffAudit.recommendation}
                                </span>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                            <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200 dark:border-slate-700/60">
                                <span className="text-[10px] text-slate-500 uppercase font-bold block">Công việc kỹ thuật (40%)</span>
                                <span className="text-base font-black font-mono text-slate-900 dark:text-white mt-1 block">
                                    {activeStaffAudit.taskScore} điểm ({activeStaffAudit.doneTasks}/{activeStaffAudit.totalTasks})
                                </span>
                            </div>

                            <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200 dark:border-slate-700/60">
                                <span className="text-[10px] text-slate-500 uppercase font-bold block">Kế hoạch tuần (35%)</span>
                                <span className="text-base font-black font-mono text-purple-600 dark:text-purple-400 mt-1 block">
                                    {activeStaffAudit.planScore} điểm ({activeStaffAudit.completedPlanItems}/{activeStaffAudit.totalPlanItems})
                                </span>
                            </div>

                            <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200 dark:border-slate-700/60">
                                <span className="text-[10px] text-slate-500 uppercase font-bold block">Kỷ luật Daily (25%)</span>
                                <span className="text-base font-black font-mono text-cyan-600 dark:text-cyan-400 mt-1 block">
                                    {activeStaffAudit.dailyScore} điểm ({activeStaffAudit.activeDaysCount} ngày)
                                </span>
                            </div>

                            <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200 dark:border-slate-700/60">
                                <span className="text-[10px] text-slate-500 uppercase font-bold block">Sự cố giải quyết</span>
                                <span className="text-base font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1 block">
                                    {activeStaffAudit.resolvedIssues}/{activeStaffAudit.totalIssues} ca
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
                        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
                                <CheckSquare className="w-3.5 h-3.5 text-orange-500" />
                                Danh Sách Công Việc Kỹ Thuật Đang Phụ Trách ({activeStaffAudit.empTasks.length})
                            </h4>
                        </div>

                        {activeStaffAudit.empTasks.length === 0 ? (
                            <div className="py-8 text-center text-slate-400 text-xs">
                                Chưa có công việc kỹ thuật cụ thể nào được giao trong kỳ này.
                            </div>
                        ) : (
                            <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                                {activeStaffAudit.empTasks.map((t: any) => (
                                    <div key={t.id || t.task_id} className="p-3.5 hover:bg-slate-50 dark:hover:bg-slate-850/50 transition-colors flex items-center justify-between gap-3 text-xs">
                                        <div className="min-w-0 flex-1">
                                            <div className="font-bold text-slate-900 dark:text-white truncate">
                                                {t.title || t.name}
                                            </div>
                                            <div className="text-[10px] text-slate-400 mt-0.5">
                                                Hạn chót: {t.dueDate || t.due_date || "Không quy định"} • Ưu tiên: {t.priority || "Medium"}
                                            </div>
                                        </div>
                                        <span className={"px-2.5 py-0.5 rounded-full text-[10px] font-bold shrink-0 " + (
                                            t.status === "Completed" || t.status === "Done" || t.status === "Report Approved"
                                                ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                                                : t.status === "In Progress" || t.status === "Protocol Approved"
                                                ? "bg-orange-50 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400 border border-orange-500/20"
                                                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                                        )}>
                                            {t.status || "To Do"}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
                        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
                                <Calendar className="w-3.5 h-3.5 text-purple-500" />
                                Kế Hoạch Tuần Của Kỹ Sư ({activeStaffAudit.totalPlanItems} mục tiêu)
                            </h4>
                        </div>

                        {activeStaffAudit.empPlans.length === 0 || activeStaffAudit.totalPlanItems === 0 ? (
                            <div className="py-8 text-center text-slate-400 text-xs">
                                Chưa đăng ký kế hoạch tuần trong giai đoạn này.
                            </div>
                        ) : (
                            <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                                {activeStaffAudit.empPlans.flatMap((p: any) => p.items || []).map((it: any, idx: number) => (
                                    <div key={it.id || idx} className="p-3.5 hover:bg-slate-50 dark:hover:bg-slate-850/50 transition-colors flex items-center justify-between gap-3 text-xs">
                                        <div className="min-w-0 flex-1">
                                            <div className="font-bold text-slate-900 dark:text-white">
                                                [{it.day || "Thứ"}] {it.taskName || it.title || "Nhiệm vụ ứng dụng"}
                                            </div>
                                            <div className="text-[10px] text-slate-400 mt-0.5">
                                                Khung giờ: {it.timeSlot || "Cả ngày"} • Dự kiến: {it.metric || "Đạt chuẩn"}
                                            </div>
                                        </div>
                                        <span className="text-[10px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md shrink-0">
                                            Tuần {selectedWeek}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

"use client";

import { formatVNDate } from "@/backend/services/dates";
import React, { useState, useRef, useEffect, useMemo } from "react";
import {
    Bell,
    CheckCheck,
    Trash2,
    CheckCircle2,
    AlertCircle,
    Calendar,
    Briefcase,
    FileText,
    Truck,
    Package,
    FlaskConical,
    FileCheck2,
    X,
    ChevronRight,
    Filter,
    Users,
    Clock,
    ArrowUpRight,
    Check,
    Settings,
    Maximize2,
    Minimize2
} from "lucide-react";
import { useNotification, Notification, TBR_PERSONNEL } from "@/frontend/contexts/NotificationContext";
import { useAuth } from "@/frontend/contexts/AuthContext";

export const NotificationDropdown: React.FC = () => {
    const { user } = useAuth();
    const {
        notifications,
        filteredNotifications,
        unreadCount,
        totalCount,
        markAsRead,
        markAllAsRead,
        deleteNotification,
        clearAllNotifications,
        selectedEmployeeFilter,
        setSelectedEmployeeFilter,
        personnelList,
        navigateTo
    } = useNotification();

    const [isOpen, setIsOpen] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState<string>("all");
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isOpen]);

    // Close on escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") setIsOpen(false);
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    // Filter by Category
    const displayList = useMemo(() => {
        let list = filteredNotifications;
        if (selectedCategory === "unread") {
            const readerId = selectedEmployeeFilter === "all"
                ? "current_viewer"
                : selectedEmployeeFilter === "MINE"
                ? (user?.email || user?.username || user?.name || "mine_viewer")
                : selectedEmployeeFilter;
            list = list.filter(n => !(n.readBy || []).includes(readerId) && !(n.readBy || []).includes("current_viewer"));
        } else if (selectedCategory === "task") {
            list = list.filter(n => n.category === "task" || n.category === "workflow");
        } else if (selectedCategory === "plan_daily") {
            list = list.filter(n => n.category === "plan" || n.category === "daily");
        } else if (selectedCategory === "order_stock") {
            list = list.filter(n => n.category === "delivery" || n.category === "order" || n.category === "warehouse");
        } else if (selectedCategory === "application") {
            list = list.filter(n => n.category === "application");
        }
        return list;
    }, [filteredNotifications, selectedCategory, selectedEmployeeFilter, user]);

    const formatRelativeTime = (isoString: string) => {
        try {
            const date = new Date(isoString);
            const now = new Date();
            const diffMs = now.getTime() - date.getTime();
            const diffMins = Math.floor(diffMs / (60 * 1000));
            const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
            const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

            if (diffMins < 1) return "Vừa xong";
            if (diffMins < 60) return `${diffMins} phút trước`;
            if (diffHours < 24) return `${diffHours} giờ trước`;
            if (diffDays === 1) return "Hôm qua";
            if (diffDays < 7) return `${diffDays} ngày trước`;
            return formatVNDate(date).slice(0, 5);
        } catch (e) {
            return "Vừa xong";
        }
    };

    const getCategoryIcon = (category: string) => {
        switch (category) {
            case "task":
                return <Briefcase className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />;
            case "plan":
                return <Calendar className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />;
            case "daily":
                return <FileText className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />;
            case "delivery":
                return <Truck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />;
            case "warehouse":
            case "order":
                return <Package className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />;
            case "application":
                return <FlaskConical className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />;
            default:
                return <Bell className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />;
        }
    };

    const handleItemClick = (item: Notification) => {
        markAsRead(item.id);

        const combinedText = `${item.title || ""} ${item.message || ""}`;
        const codeMatch = combinedText.match(/\b((?:WF|TASK|PR|PO|BG|SO|HD|DXNP|DX|DNTT|DNTU|QT|TTR|DXM)-[A-Z0-9-]+)\b/i);
        const extractedCode = codeMatch ? codeMatch[1] : "";
        const quoteMatch = combinedText.match(/"([^"]{3,120})"/) || combinedText.match(/\[([^\]]{3,120})\]/);
        const extractedTitle = quoteMatch ? quoteMatch[1] : "";

        const rawTab = item.link?.tab || "";
        const titleLower = combinedText.toLowerCase();
        const isProposalNotif =
            rawTab === "proposals" ||
            item.link?.subTab === "proposals" ||
            /^(?:DXNP|DX|DNTT|DNTU|QT|TTR|DXM)-/i.test(extractedCode) ||
            titleLower.includes("trình duyệt") ||
            titleLower.includes("nghỉ phép");
        const isWorkflowNotif =
            !isProposalNotif && (
                item.category === "workflow" ||
                rawTab === "workflows" ||
                item.link?.subTab === "workflows" ||
                Boolean(item.workflowId || item.workflowCode) ||
                extractedCode.toUpperCase().startsWith("WF-") ||
                titleLower.includes("phối hợp") ||
                titleLower.includes("quy trình") ||
                titleLower.includes("stage-gate")
            );

        let targetTab = rawTab;
        let targetSubTab = item.link?.subTab || (isProposalNotif ? "proposals" : undefined);

        if (!targetTab || targetTab === "tasks" || targetTab === "workflows" || targetTab === "proposals") {
            if (targetTab === "tasks" || targetTab === "workflows" || targetTab === "proposals") {
                targetSubTab = targetTab;
                targetTab = "workspace";
            } else if (isProposalNotif) {
                targetTab = "workspace";
                targetSubTab = "proposals";
            } else if (item.category === "delivery" || item.category === "warehouse") {
                targetTab = "warehouse";
            } else if (item.category === "order" || item.category === "quote") {
                targetTab = "sales";
            } else if (item.category === "procurement") {
                targetTab = "procurement";
            } else if (item.category === "application") {
                targetTab = "application";
            } else {
                targetTab = "workspace";
                targetSubTab = isWorkflowNotif ? "workflows" : item.category === "plan" ? "plans" : item.category === "daily" ? "reports" : "tasks";
            }
        } else if (targetTab === "workspace" && !targetSubTab) {
            targetSubTab = isProposalNotif ? "proposals" : isWorkflowNotif ? "workflows" : "tasks";
        }

        const resolvedItemId =
            item.taskId ||
            item.workflowId ||
            item.workflowCode ||
            item.targetId ||
            item.orderCode ||
            item.link?.itemId ||
            extractedCode ||
            "";

        const detailPayload = {
            id: resolvedItemId ? String(resolvedItemId) : "",
            code: String(item.workflowCode || item.orderCode || extractedCode || item.link?.itemId || ""),
            title: extractedTitle || item.title || "",
            message: item.message || "",
            subTab: targetSubTab || (isWorkflowNotif ? "workflows" : "tasks"),
            notification: item,
            timestamp: Date.now()
        };

        if (typeof window !== "undefined") {
            localStorage.setItem("workspace_open_task_detail", JSON.stringify(detailPayload));
            window.dispatchEvent(new CustomEvent("workspace-open-detail", { detail: detailPayload }));
        }

        navigateTo(targetTab, targetSubTab, detailPayload.id || detailPayload.code || undefined);
        setIsOpen(false);
    };

    const selectedStaffName = useMemo(() => {
        if (selectedEmployeeFilter === "MINE") return user?.name ? `Của tôi (${user.name})` : "Hoạt động của tôi & Liên quan";
        if (selectedEmployeeFilter === "all") return "Tất cả nhân sự";
        const found = personnelList.find(p => p.employee_id === selectedEmployeeFilter);
        return found ? `${found.full_name} (${found.employee_id})` : selectedEmployeeFilter;
    }, [selectedEmployeeFilter, personnelList, user]);

    return (
        <div className="relative inline-block" ref={dropdownRef}>
            {/* Bell Trigger Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`relative p-2 rounded-xl transition-all cursor-pointer ${
                    isOpen
                        ? "bg-orange-600 text-white shadow-md shadow-orange-500/30"
                        : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
                }`}
                title="Thông báo hoạt động nhân viên"
            >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-extrabold text-white shadow-md shadow-red-600/40 ring-2 ring-white dark:ring-slate-900 animate-pulse">
                        {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                )}
            </button>

            {/* Dropdown Panel */}
            {isOpen && (
                <div
                    className={`fixed sm:absolute right-2 sm:right-0 top-14 sm:top-full mt-2 w-[96vw] ${
                        isExpanded
                            ? "sm:w-[760px] lg:w-[880px]"
                            : "sm:w-[600px] md:w-[680px]"
                    } max-w-[96vw] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col transition-all duration-200`}
                >
                    
                    {/* Header */}
                    <div className="px-4 py-3.5 border-b border-slate-150 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/70 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-orange-600/10 text-orange-600 dark:text-orange-400 flex items-center justify-center font-bold">
                                <Bell className="w-4 h-4" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                                        Thông Báo Hoạt Động
                                    </h3>
                                    {unreadCount > 0 && (
                                        <span className="text-[10px] bg-red-500/10 text-red-600 dark:text-red-400 font-bold px-2 py-0.5 rounded-full border border-red-500/20">
                                            {unreadCount} mới
                                        </span>
                                    )}
                                </div>
                                <span className="text-[10px] text-slate-500 dark:text-slate-400 block mt-0.5">
                                    Cập nhật từng hoạt động cho nhân viên liên quan
                                </span>
                            </div>
                        </div>

                        {/* Top Actions */}
                        <div className="flex items-center gap-1">
                            {unreadCount > 0 && (
                                <button
                                    onClick={() => markAllAsRead()}
                                    className="p-1.5 text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
                                    title="Đánh dấu tất cả đã đọc"
                                >
                                    <CheckCheck className="w-3.5 h-3.5" />
                                    <span className="hidden sm:inline text-[11px]">Đọc hết</span>
                                </button>
                            )}
                            <button
                                onClick={() => setIsExpanded((prev) => !prev)}
                                className="hidden sm:flex p-1.5 text-slate-500 hover:text-orange-600 dark:hover:text-orange-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-lg text-xs font-medium items-center gap-1 transition-colors cursor-pointer"
                                title={isExpanded ? "Thu gọn khung thông báo" : "Mở rộng khung thông báo"}
                            >
                                {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                                <span className="text-[11px]">{isExpanded ? "Thu gọn" : "Mở rộng"}</span>
                            </button>
                            {filteredNotifications.length > 0 && (
                                <button
                                    onClick={clearAllNotifications}
                                    className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                                    title="Xóa danh sách thông báo này"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            )}
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Employee Filter Bar */}
                    <div className="px-4 py-2.5 bg-orange-50/50 dark:bg-slate-950/40 border-b border-slate-150 dark:border-slate-800">
                        <div className="flex items-center gap-2 mb-1">
                            <Users className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400 shrink-0" />
                            <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                                Xem thông báo của nhân sự:
                            </span>
                        </div>
                        <select
                            value={selectedEmployeeFilter}
                            onChange={(e) => setSelectedEmployeeFilter(e.target.value)}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 font-semibold focus:outline-none focus:border-orange-500 shadow-xs"
                        >
                            <option value="MINE">-- 📌 Hoạt động của tôi & Liên quan đến tôi {user?.name ? `(${user.name})` : ""} --</option>
                            <option value="all">-- 👥 Tất cả hoạt động toàn công ty ({notifications.length}) --</option>
                            {Array.from(new Set(personnelList.map(p => p.department).filter(Boolean))).map((dept) => (
                                <optgroup key={dept} label={dept}>
                                    {personnelList.filter(p => p.department === dept).map((p) => (
                                        <option key={p.employee_id || p.full_name} value={p.employee_id || p.full_name}>
                                            {p.full_name} {p.position ? `(${p.position})` : ""}
                                        </option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                    </div>

                    {/* Filter Category Tabs */}
                    <div className="px-3 py-1.5 border-b border-slate-150 dark:border-slate-800 flex items-center gap-1 overflow-x-auto bg-slate-50/70 dark:bg-slate-950/40 text-[11px] font-semibold no-scrollbar">
                        <button
                            onClick={() => setSelectedCategory("all")}
                            className={`px-2.5 py-1 rounded-lg shrink-0 transition-colors cursor-pointer ${
                                selectedCategory === "all"
                                    ? "bg-slate-800 dark:bg-slate-700 text-white font-bold"
                                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                            }`}
                        >
                            Tất cả
                        </button>
                        <button
                            onClick={() => setSelectedCategory("unread")}
                            className={`px-2.5 py-1 rounded-lg shrink-0 transition-colors cursor-pointer flex items-center gap-1 ${
                                selectedCategory === "unread"
                                    ? "bg-red-600 text-white font-bold"
                                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                            }`}
                        >
                            Chưa đọc ({unreadCount})
                        </button>
                        <button
                            onClick={() => setSelectedCategory("task")}
                            className={`px-2.5 py-1 rounded-lg shrink-0 transition-colors cursor-pointer flex items-center gap-1 ${
                                selectedCategory === "task"
                                    ? "bg-orange-600 text-white font-bold"
                                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                            }`}
                        >
                            💼 Việc
                        </button>
                        <button
                            onClick={() => setSelectedCategory("plan_daily")}
                            className={`px-2.5 py-1 rounded-lg shrink-0 transition-colors cursor-pointer flex items-center gap-1 ${
                                selectedCategory === "plan_daily"
                                    ? "bg-purple-600 text-white font-bold"
                                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                            }`}
                        >
                            📅 Kế hoạch
                        </button>
                        <button
                            onClick={() => setSelectedCategory("order_stock")}
                            className={`px-2.5 py-1 rounded-lg shrink-0 transition-colors cursor-pointer flex items-center gap-1 ${
                                selectedCategory === "order_stock"
                                    ? "bg-emerald-600 text-white font-bold"
                                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                            }`}
                        >
                            🚚 Giao hàng & Kho
                        </button>
                        <button
                            onClick={() => setSelectedCategory("application")}
                            className={`px-2.5 py-1 rounded-lg shrink-0 transition-colors cursor-pointer flex items-center gap-1 ${
                                selectedCategory === "application"
                                    ? "bg-indigo-600 text-white font-bold"
                                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                            }`}
                        >
                            🧬 App
                        </button>
                    </div>

                    {/* Notification Items List */}
                    <div
                        className={`overflow-y-auto ${
                            isExpanded ? "max-h-[75vh]" : "max-h-[65vh] sm:max-h-[520px]"
                        } divide-y divide-slate-150 dark:divide-slate-800/60 p-2 space-y-1.5`}
                    >
                        {displayList.length === 0 ? (
                            <div className="py-10 text-center px-4">
                                <div className="w-10 h-10 mx-auto rounded-full bg-slate-150 dark:bg-slate-800 flex items-center justify-center text-slate-400 mb-2">
                                    <Bell className="w-5 h-5" />
                                </div>
                                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                    Không có thông báo hoạt động nào
                                </p>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                                    Các hoạt động giao việc, tiến độ, xuất kho, kế hoạch sẽ tự động thông báo tại đây.
                                </p>
                            </div>
                        ) : (
                            displayList.map((item) => {
                                const readerId = selectedEmployeeFilter === "all"
                                    ? "current_viewer"
                                    : selectedEmployeeFilter === "MINE"
                                    ? (user?.email || user?.username || user?.name || "mine_viewer")
                                    : selectedEmployeeFilter;
                                const isItemUnread = !(item.readBy || []).includes(readerId) && !(item.readBy || []).includes("current_viewer");
                                const fullTooltip = [
                                    item.title,
                                    item.message,
                                    item.sender?.name ? `Người thực hiện: ${item.sender.name}` : "",
                                    item.targetEmployeeNames?.length ? `Liên quan: ${item.targetEmployeeNames.join(", ")}` : ""
                                ].filter(Boolean).join("\n");

                                return (
                                    <div
                                        key={item.id}
                                        onClick={() => handleItemClick(item)}
                                        title={fullTooltip}
                                        className={`group p-3.5 rounded-xl transition-all cursor-pointer flex items-start gap-3 border ${
                                            isItemUnread
                                                ? "bg-orange-50/80 dark:bg-slate-800/90 hover:bg-orange-100/70 dark:hover:bg-slate-800 border-orange-300 dark:border-orange-500/40 border-l-4 border-l-orange-500 shadow-xs"
                                                : "bg-white/60 dark:bg-slate-900/40 hover:bg-slate-100/80 dark:hover:bg-slate-800/70 border-slate-200/60 dark:border-slate-800/60 opacity-90 hover:opacity-100"
                                        }`}
                                    >
                                        {/* Category Icon */}
                                        <div className="shrink-0 mt-0.5">
                                            <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shadow-xs border border-slate-200/80 dark:border-slate-700">
                                                {getCategoryIcon(item.category)}
                                            </div>
                                        </div>

                                        {/* Content */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-start justify-between gap-2 mb-1">
                                                <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 break-words leading-snug">
                                                    {item.title}
                                                </h4>
                                                <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                                                    <span className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-0.5 font-medium">
                                                        <Clock className="w-2.5 h-2.5" />
                                                        {formatRelativeTime(item.createdAt)}
                                                    </span>
                                                    {isItemUnread && (
                                                        <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0 ring-2 ring-orange-200 dark:ring-orange-950" />
                                                    )}
                                                </div>
                                            </div>

                                            <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-line break-words leading-relaxed mb-2.5 font-normal">
                                                {item.message}
                                            </p>

                                            {/* Metadata Tags */}
                                            <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                                                {item.sender && (
                                                    <span className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-md font-medium border border-slate-200 dark:border-slate-700">
                                                        👤 {item.sender.name}
                                                    </span>
                                                )}
                                                {item.targetEmployeeNames && item.targetEmployeeNames.length > 0 && (
                                                    <span className="bg-orange-100/80 dark:bg-orange-950/60 text-orange-800 dark:text-orange-300 px-2 py-0.5 rounded-md font-medium border border-orange-200 dark:border-orange-800/60">
                                                        🎯 {item.targetEmployeeNames.join(", ")}
                                                    </span>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleItemClick(item);
                                                    }}
                                                    className="ml-auto text-orange-600 dark:text-orange-400 font-bold hover:underline flex items-center gap-0.5 cursor-pointer"
                                                >
                                                    Đi tới xem <ArrowUpRight className="w-3 h-3" />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Action buttons on item */}
                                        <div className="shrink-0 flex flex-col items-center gap-1">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    deleteNotification(item.id);
                                                }}
                                                className="p-1 text-slate-400 hover:text-rose-600 dark:text-slate-500 dark:hover:text-rose-400 rounded-md transition-colors cursor-pointer"
                                                title="Xóa thông báo"
                                            >
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Footer */}
                    <div className="px-4 py-2 border-t border-slate-150 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex items-center justify-between text-[10px] text-slate-600 dark:text-slate-400">
                        <span>Đang xem: <strong className="text-slate-900 dark:text-slate-200">{selectedStaffName}</strong></span>
                        <div className="flex items-center gap-2">
                            <span className="font-medium">{filteredNotifications.length} hoạt động</span>
                            <button
                                onClick={() => {
                                    navigateTo("settings", "notifications");
                                    setIsOpen(false);
                                }}
                                className="px-2 py-0.5 rounded-md bg-orange-100 hover:bg-orange-200 dark:bg-orange-950/60 dark:hover:bg-orange-900 text-orange-700 dark:text-orange-300 font-bold transition-colors flex items-center gap-1 cursor-pointer"
                                title="Mở ma trận cài đặt thông báo"
                            >
                                <Settings className="w-3 h-3" /> Cài đặt ma trận
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

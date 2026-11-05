"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle2, AlertCircle, Info, Bell, CheckSquare, Calendar, FileText, Truck, Package, FlaskConical, FileCheck2 } from "lucide-react";
import { cn } from "@/backend/services/utils";
import { useAuth } from "@/frontend/contexts/AuthContext";
import { FACTORY_NOTICE_EVENTS, factoryNoticeKey } from "@/factory/noticeMatrix";

type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
    id: string;
    message: string;
    type: ToastType;
}

export interface Notification {
    id: string;
    title: string;
    message: string;
    type: "success" | "error" | "info" | "warning";
    category: "task" | "plan" | "daily" | "delivery" | "order" | "quote" | "application" | "warehouse" | "system" | string;
    createdAt: string; // ISO string
    readBy: string[]; // List of user emails or employee_ids who read it
    
    // Sender info
    sender?: {
        id?: string;
        name: string;
        role?: string;
    };

    // Target audience (specific employees or departments)
    targetEmployeeIds?: string[]; // e.g. ["KD-11", "QL-03"]
    targetEmployeeNames?: string[]; // e.g. ["Huỳnh Hồng Hạnh"]
    targetUsers?: string[];
    assignee?: string;
    assignees?: string[];
    creator?: string;
    description?: string;
    metadata?: any;
    taskId?: string | number;
    workflowId?: string | number;
    workflowCode?: string;
    targetId?: string | number;
    orderCode?: string;
    recipientEmail?: string;
    recipientRole?: string;
    targetRoles?: string[];
    recipientDept?: string;
    eventKey?: string;
    
    // Navigation link
    link?: {
        tab: "sales" | "warehouse" | "application" | "procurement" | "settings" | "workspace" | string;
        subTab?: string;
        itemId?: string;
    };
    linkUrl?: string;
}

export interface PersonnelItem {
    employee_id: string;
    full_name: string;
    email: string;
    department: string;
    position: string;
}

export interface NotificationMatrixEvent {
    key: string;
    name: string;
    category: "sales" | "warehouse" | "procurement" | "application" | "workspace" | "finance" | "quality" | "technical";
    categoryLabel: string;
    description: string;
    enabled: boolean;
    enableToast: boolean;
    targetRoles: string[];
    targetEmployeeIds: string[];
    targetEmployeeNames?: string[];
}

export const DEFAULT_NOTIFICATION_MATRIX: Record<string, NotificationMatrixEvent> = {
    quote_approval_request: {
        key: "quote_approval_request",
        name: "Phê duyệt báo giá (Hàng 0đ / Quà tặng)",
        category: "sales",
        categoryLabel: "Kinh Doanh & Báo Giá",
        description: "Gửi thông báo khi có báo giá tạo mới hoặc sửa đổi cần Ban Giám Đốc hoặc Trưởng phòng phê duyệt.",
        enabled: true,
        enableToast: true,
        targetRoles: ["admin", "sales_head"],
        targetEmployeeIds: []
    },
    quote_approved: {
        key: "quote_approved",
        name: "Kết quả duyệt báo giá",
        category: "sales",
        categoryLabel: "Kinh Doanh & Báo Giá",
        description: "Thông báo cho nhân viên kinh doanh phụ trách khi báo giá được duyệt hoặc từ chối.",
        enabled: true,
        enableToast: true,
        targetRoles: ["sales_rep", "sales_head"],
        targetEmployeeIds: []
    },
    order_created: {
        key: "order_created",
        name: "Đơn hàng bán mới",
        category: "sales",
        categoryLabel: "Kinh Doanh & Báo Giá",
        description: "Thông báo khi có đơn hàng bán mới được tạo hoặc xác nhận, gửi tới Kho và Kế toán.",
        enabled: true,
        enableToast: true,
        targetRoles: ["admin", "sales_head", "warehouse", "accountant"],
        targetEmployeeIds: []
    },
    plan_weekly_submit: {
        key: "plan_weekly_submit",
        name: "Gửi duyệt kế hoạch tuần",
        category: "workspace",
        categoryLabel: "Kế Hoạch & Lịch Trình",
        description: "Thông báo khi nhân viên gửi kế hoạch công tác / lịch trình tuần mới để quản lý duyệt.",
        enabled: true,
        enableToast: true,
        targetRoles: ["admin", "sales_head"],
        targetEmployeeIds: []
    },
    task_assigned: {
        key: "task_assigned",
        name: "Giao việc mới & Điều phối",
        category: "workspace",
        categoryLabel: "Công Việc & Tiến Độ",
        description: "Thông báo khi quản lý giao đầu việc mới cho nhân sự hoặc phòng ban cụ thể.",
        enabled: true,
        enableToast: true,
        targetRoles: ["admin"],
        targetEmployeeIds: []
    },
    task_status_updated: {
        key: "task_status_updated",
        name: "Cập nhật tiến độ / Hoàn thành việc",
        category: "workspace",
        categoryLabel: "Công Việc & Tiến Độ",
        description: "Thông báo khi nhân sự chuyển trạng thái công việc sang Đang thực hiện hoặc Hoàn tất (DONE).",
        enabled: true,
        enableToast: true,
        targetRoles: ["admin", "sales_head"],
        targetEmployeeIds: []
    },
    workflow_cross_dept: {
        key: "workflow_cross_dept",
        name: "Yêu cầu phối hợp liên phòng ban",
        category: "workspace",
        categoryLabel: "Quy Trình Phối Hợp",
        description: "Thông báo khi phát sinh đề nghị phối hợp hỗ trợ chéo giữa các bộ phận.",
        enabled: true,
        enableToast: true,
        targetRoles: ["admin"],
        targetEmployeeIds: []
    },
    daily_report_submitted: {
        key: "daily_report_submitted",
        name: "Báo cáo công việc ngày",
        category: "workspace",
        categoryLabel: "Báo Cáo Hoạt Động",
        description: "Thông báo khi nhân sự nộp báo cáo kết quả hoạt động hoặc nhật ký thị trường cuối ngày.",
        enabled: true,
        enableToast: true,
        targetRoles: ["admin", "sales_head", "app_head"],
        targetEmployeeIds: []
    },
    delivery_dispatched: {
        key: "delivery_dispatched",
        name: "Xuất kho & Lệnh giao hàng",
        category: "warehouse",
        categoryLabel: "Kho & Vận Hành",
        description: "Thông báo khi kho xuất hàng thành công hoặc bàn giao cho đơn vị vận chuyển giao tới khách hàng.",
        enabled: true,
        enableToast: true,
        targetRoles: ["sales_rep", "sales_head", "accountant", "warehouse"],
        targetEmployeeIds: []
    },
    warehouse_po_received: {
        key: "warehouse_po_received",
        name: "Nhập kho PO mới từ nhà cung cấp",
        category: "warehouse",
        categoryLabel: "Kho & Vận Hành",
        description: "Thông báo khi hàng hóa từ đơn mua hàng PO được kiểm đếm và hoàn tất nhập kho.",
        enabled: true,
        enableToast: true,
        targetRoles: ["procurement", "warehouse", "qa_qc", "accountant"],
        targetEmployeeIds: []
    },
    procurement_pr_approval: {
        key: "procurement_pr_approval",
        name: "Đề xuất mua hàng (PR) cần duyệt",
        category: "procurement",
        categoryLabel: "Cung Ứng & Mua Hàng",
        description: "Thông báo khi có phiếu đề xuất mua sắm hàng hóa / vật tư cần Ban Giám Đốc phê duyệt.",
        enabled: true,
        enableToast: true,
        targetRoles: ["admin", "procurement"],
        targetEmployeeIds: []
    },
    app_issue_ticket: {
        key: "app_issue_ticket",
        name: "Sự cố thiết bị Lab / Hỗ trợ kỹ thuật",
        category: "application",
        categoryLabel: "Kỹ Thuật & Application",
        description: "Thông báo khi khách hàng hoặc phòng lab ghi nhận sự cố máy móc / sinh phẩm cần xử lý gấp.",
        enabled: true,
        enableToast: true,
        targetRoles: ["app_head", "app_rep", "admin"],
        targetEmployeeIds: []
    },
    invoice_vat_issued: {
        key: "invoice_vat_issued",
        name: "Xuất hóa đơn VAT & Thanh toán",
        category: "finance",
        categoryLabel: "Kế Toán & Tài Chính",
        description: "Thông báo khi kế toán xuất hóa đơn điện tử VAT hoặc xác nhận khách hàng thanh toán.",
        enabled: true,
        enableToast: true,
        targetRoles: ["accountant", "sales_rep", "admin"],
        targetEmployeeIds: []
    },
    quality_coa_alert: {
        key: "quality_coa_alert",
        name: "Cảnh báo chất lượng QA/QC & Hạn sử dụng",
        category: "quality",
        categoryLabel: "Quản Lý Chất Lượng",
        description: "Thông báo cảnh báo lô hàng cận hạn sử dụng, sai lệch nhiệt độ bảo quản hoặc COA.",
        enabled: true,
        enableToast: true,
        targetRoles: ["qa_qc", "warehouse", "admin"],
        targetEmployeeIds: []
    },
    // Khối Kỹ thuật – Nhà máy: built-in recipients always apply, the matrix may switch an event off or add groups
    ...Object.fromEntries(
        FACTORY_NOTICE_EVENTS.map((e): [string, NotificationMatrixEvent] => [
            factoryNoticeKey(e.type),
            { key: factoryNoticeKey(e.type), name: e.name, category: "technical", categoryLabel: `Khối Kỹ thuật · ${e.dept}`, description: e.description, enabled: true, enableToast: true, targetRoles: [], targetEmployeeIds: [] },
        ])
    ),
};

export const TBR_PERSONNEL: PersonnelItem[] = [];

export const DEFAULT_ACTIVITY_NOTIFICATIONS: Notification[] = [];

interface NotificationContextType {
    showToast: (message: string, type?: ToastType) => void;
    notifications: Notification[];
    filteredNotifications: Notification[];
    unreadCount: number;
    totalCount: number;
    addNotification: (params: any) => void;
    notifyActivity: (params: {
        title: string;
        message: string;
        type?: "success" | "error" | "info" | "warning";
        category?: "task" | "plan" | "daily" | "delivery" | "order" | "quote" | "application" | "warehouse" | "system" | string;
        eventKey?: string;
        sender?: { id?: string; name: string; role?: string };
        targetEmployeeIds?: string[];
        targetEmployeeNames?: string[];
        targetUsers?: string[];
        assignee?: string;
        assignees?: string[];
        creator?: string;
        description?: string;
        metadata?: any;
        taskId?: string | number;
        workflowId?: string | number;
        workflowCode?: string;
        targetId?: string | number;
        orderCode?: string;
        targetRoles?: string[];
        targetRole?: string;
        targetDept?: string;
        link?: {
            tab: "sales" | "warehouse" | "application" | "procurement" | "settings" | "workspace" | string;
            subTab?: string;
            itemId?: string;
        };
        linkUrl?: string;
        [key: string]: any;
    }) => void;
    markAsRead: (id: string, readerId?: string) => void;
    markAllAsRead: (readerId?: string) => void;
    deleteNotification: (id: string) => void;
    clearAllNotifications: () => void;
    selectedEmployeeFilter: string;
    setSelectedEmployeeFilter: (empId: string) => void;
    personnelList: PersonnelItem[];
    navigateTo: (tab: string, subTab?: string, itemId?: string) => void;
    notificationMatrix: Record<string, NotificationMatrixEvent>;
    updateNotificationMatrix: (newMatrix: Record<string, NotificationMatrixEvent>) => Promise<void>;
    resetNotificationMatrix: () => Promise<void>;
    testTriggerNotification: (eventKey: string) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const useNotification = () => {
    const context = useContext(NotificationContext);
    if (!context) {
        throw new Error("useNotification must be used within a NotificationProvider");
    }
    return context;
};

export const NotificationProvider = ({ children }: { children: ReactNode }) => {
    const { user } = useAuth();
    const [toasts, setToasts] = useState<Toast[]>([]);
    
    // Employee filter for notification view (default "MINE" for personal & related activities)
    const [selectedEmployeeFilter, setSelectedEmployeeFilter] = useState<string>("MINE");

    // All activity notifications
    const [allNotifications, setAllNotifications] = useState<Notification[]>(() => {
        if (typeof window !== "undefined") {
            const stored = localStorage.getItem("tbr_activity_notifications");
            if (stored) {
                try {
                    const parsed = JSON.parse(stored);
                    if (Array.isArray(parsed)) return parsed;
                } catch (err) {}
            }
        }
        return [];
    });

    const [personnelList, setPersonnelList] = useState<PersonnelItem[]>(TBR_PERSONNEL);

    // Fetch live company personnel
    useEffect(() => {
        if (!user) return;
        fetch("/api/workflows?action=overview")
            .then(res => res.json())
            .then(data => {
                if (data?.personnel && Array.isArray(data.personnel) && data.personnel.length > 0) {
                    const mapped: PersonnelItem[] = data.personnel.map((p: any) => ({
                        employee_id: p.employee_code || p.id?.toString() || p.full_name,
                        full_name: p.full_name,
                        email: p.email || "",
                        department: p.department || "Khác",
                        position: p.position || "Nhân viên"
                    }));
                    setPersonnelList(mapped);
                }
            })
            .catch(() => {});
    }, [user]);

    // Save helper
    const saveNotifications = useCallback((list: Notification[]) => {
        setAllNotifications(list);
        if (typeof window !== "undefined") {
            localStorage.setItem("tbr_activity_notifications", JSON.stringify(list));
            fetch("/api/storage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: "tbr_activity_notifications", data: list })
            }).catch(() => {});
        }
    }, []);

    // Load initial from API storage if available
    useEffect(() => {
        if (typeof window !== "undefined") {
            fetch("/api/storage?key=tbr_activity_notifications")
                .then(res => res.json())
                .then(data => {
                    if (data && Array.isArray(data.data)) {
                        setAllNotifications(data.data);
                        localStorage.setItem("tbr_activity_notifications", JSON.stringify(data.data));
                    }
                })
                .catch(() => {});

            fetch("/api/storage?key=system_notification_matrix")
                .then(res => res.json())
                .then(data => {
                    if (data && data.data && typeof data.data === "object") {
                        const merged = { ...DEFAULT_NOTIFICATION_MATRIX, ...data.data };
                        setMatrixSettings(merged);
                        localStorage.setItem("system_notification_matrix", JSON.stringify(merged));
                    }
                })
                .catch(() => {});
        }
    }, []);

    // Notification Matrix Settings (Configurable by Admin)
    const [matrixSettings, setMatrixSettings] = useState<Record<string, NotificationMatrixEvent>>(() => {
        if (typeof window !== "undefined") {
            const stored = localStorage.getItem("system_notification_matrix");
            if (stored) {
                try {
                    const parsed = JSON.parse(stored);
                    if (parsed && typeof parsed === "object") {
                        return { ...DEFAULT_NOTIFICATION_MATRIX, ...parsed };
                    }
                } catch (e) {}
            }
        }
        return DEFAULT_NOTIFICATION_MATRIX;
    });

    // Sync across browser tabs
    useEffect(() => {
        const handleStorage = (e: StorageEvent) => {
            if (e.key === "tbr_activity_notifications") {
                try {
                    setAllNotifications(JSON.parse(e.newValue || "[]"));
                } catch (err) {}
            } else if (e.key === "system_notification_matrix") {
                try {
                    setMatrixSettings(JSON.parse(e.newValue || "{}"));
                } catch (err) {}
            }
        };
        window.addEventListener("storage", handleStorage);
        return () => window.removeEventListener("storage", handleStorage);
    }, []);

    const showToast = useCallback((message: string, type: ToastType = "info") => {
        const id = Math.random().toString(36).substr(2, 9);
        setToasts((prev) => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 5000);
    }, []);

    const removeToast = (id: string) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    };

    // Global navigation dispatcher
    const navigateTo = useCallback((tab: string, subTab?: string, itemId?: string) => {
        if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("tbr-navigate", {
                detail: { tab, subTab, itemId }
            }));
        }
    }, []);

    // Notification Matrix persistence handlers
    const updateNotificationMatrix = useCallback(async (newMatrix: Record<string, NotificationMatrixEvent>) => {
        setMatrixSettings(newMatrix);
        if (typeof window !== "undefined") {
            localStorage.setItem("system_notification_matrix", JSON.stringify(newMatrix));
            try {
                await fetch("/api/storage", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ key: "system_notification_matrix", data: newMatrix })
                });
            } catch (e) {}
        }
        showToast("Đã cập nhật cấu hình Ma trận thông báo thành công!", "success");
    }, [showToast]);

    const resetNotificationMatrix = useCallback(async () => {
        setMatrixSettings(DEFAULT_NOTIFICATION_MATRIX);
        if (typeof window !== "undefined") {
            localStorage.setItem("system_notification_matrix", JSON.stringify(DEFAULT_NOTIFICATION_MATRIX));
            try {
                await fetch("/api/storage", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ key: "system_notification_matrix", data: DEFAULT_NOTIFICATION_MATRIX })
                });
            } catch (e) {}
        }
        showToast("Đã khôi phục Ma trận thông báo về mặc định tiêu chuẩn!", "info");
    }, [showToast]);

    // Main Activity Notification Dispatcher (Governed by Matrix)
    const notifyActivity = useCallback((params: {
        title: string;
        message: string;
        type?: "success" | "error" | "info" | "warning";
        category?: "task" | "plan" | "daily" | "delivery" | "order" | "quote" | "application" | "warehouse" | "system" | string;
        eventKey?: string;
        sender?: { id?: string; name: string; role?: string };
        targetEmployeeIds?: string[];
        targetEmployeeNames?: string[];
        targetUsers?: string[];
        assignee?: string;
        assignees?: string[];
        creator?: string;
        description?: string;
        metadata?: any;
        taskId?: string | number;
        workflowId?: string | number;
        workflowCode?: string;
        targetId?: string | number;
        orderCode?: string;
        targetRoles?: string[];
        targetRole?: string;
        targetDept?: string;
        link?: {
            tab: "sales" | "warehouse" | "application" | "procurement" | "settings" | "workspace" | string;
            subTab?: string;
            itemId?: string;
        };
        linkUrl?: string;
        [key: string]: any;
    }) => {
        const {
            title,
            message,
            type = "info",
            category = "system",
            sender,
            targetRole,
            targetDept,
            link,
            linkUrl
        } = params;

        // Auto-match or use provided eventKey against Notification Matrix
        let matchedKey = params.eventKey;
        if (!matchedKey) {
            const titleLower = (title || "").toLowerCase();
            const catLower = (category || "").toLowerCase();
            if (titleLower.includes("báo giá") || catLower === "quote" || catLower === "quotation") {
                matchedKey = titleLower.includes("duyệt") || titleLower.includes("cần") ? "quote_approval_request" : "quote_approved";
            } else if (titleLower.includes("kế hoạch tuần") || catLower === "plan") {
                matchedKey = "plan_weekly_submit";
            } else if (titleLower.includes("giao việc") || titleLower.includes("công việc mới")) {
                matchedKey = "task_assigned";
            } else if (titleLower.includes("hoàn thành") || titleLower.includes("tiến độ") || titleLower.includes("cập nhật công việc")) {
                matchedKey = "task_status_updated";
            } else if (titleLower.includes("phối hợp") || catLower === "workflow") {
                matchedKey = "workflow_cross_dept";
            } else if (titleLower.includes("báo cáo") || catLower === "daily") {
                matchedKey = "daily_report_submitted";
            } else if (titleLower.includes("xuất kho") || catLower === "delivery") {
                matchedKey = "delivery_dispatched";
            } else if (titleLower.includes("nhập kho") || titleLower.includes("po")) {
                matchedKey = "warehouse_po_received";
            } else if (titleLower.includes("đề xuất mua") || titleLower.includes("pr") || catLower === "procurement") {
                matchedKey = "procurement_pr_approval";
            } else if (titleLower.includes("sự cố") || catLower === "application") {
                matchedKey = "app_issue_ticket";
            } else if (titleLower.includes("hóa đơn") || titleLower.includes("vat")) {
                matchedKey = "invoice_vat_issued";
            } else if (titleLower.includes("chất lượng") || titleLower.includes("coa")) {
                matchedKey = "quality_coa_alert";
            }
        }

        // Check if event is registered in Notification Matrix
        const matrixConfig = matchedKey ? matrixSettings[matchedKey] : undefined;
        
        // 1. If event is explicitly disabled in Matrix -> MUTED!
        if (matrixConfig && matrixConfig.enabled === false) {
            console.log(`[NotificationMatrix] Event "${matrixConfig.name}" is disabled. Skipping notification.`);
            return;
        }

        // 2. Merge recipients from matrix configuration
        let resolvedEmployeeIds = [...(params.targetEmployeeIds || [])];
        let resolvedEmployeeNames = [...(params.targetEmployeeNames || [])];
        let resolvedRoles = [...(params.targetRoles || [])];
        if (targetRole && !resolvedRoles.includes(targetRole)) {
            resolvedRoles.push(targetRole);
        }

        if (matrixConfig) {
            if (Array.isArray(matrixConfig.targetEmployeeIds) && matrixConfig.targetEmployeeIds.length > 0) {
                resolvedEmployeeIds = Array.from(new Set([...resolvedEmployeeIds, ...matrixConfig.targetEmployeeIds]));
            }
            if (Array.isArray(matrixConfig.targetEmployeeNames) && matrixConfig.targetEmployeeNames.length > 0) {
                resolvedEmployeeNames = Array.from(new Set([...resolvedEmployeeNames, ...matrixConfig.targetEmployeeNames]));
            }
            if (Array.isArray(matrixConfig.targetRoles) && matrixConfig.targetRoles.length > 0) {
                resolvedRoles = Array.from(new Set([...resolvedRoles, ...matrixConfig.targetRoles]));
            }
        }

        const extractedCodeMatch = `${title || ""} ${message || ""}`.match(/\b((?:WF|TASK|PR|PO|BG|SO|HD)-[A-Z0-9-]+)\b/i);
        const autoItemId = link?.itemId
            || (params.taskId ? String(params.taskId) : undefined)
            || (params.workflowId ? String(params.workflowId) : undefined)
            || params.workflowCode
            || (params.targetId ? String(params.targetId) : undefined)
            || params.orderCode
            || (extractedCodeMatch ? extractedCodeMatch[1] : undefined);

        const resolvedLink = link ? {
            ...link,
            itemId: link.itemId || autoItemId
        } : (category === "task" || category === "workflow" || category === "plan" || category === "daily" || (title || "").toLowerCase().includes("phối hợp") || (title || "").toLowerCase().includes("công việc")) ? {
            tab: "workspace",
            subTab: (category === "workflow" || (title || "").toLowerCase().includes("phối hợp") || (autoItemId || "").toUpperCase().startsWith("WF-")) ? "workflows" : "tasks",
            itemId: autoItemId
        } : undefined;

        const newNotif: Notification = {
            id: `ACT-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            title,
            message,
            type,
            category,
            eventKey: matchedKey,
            createdAt: new Date().toISOString(),
            readBy: [],
            sender: sender || { name: user?.name || "Hệ thống ABT" },
            targetEmployeeIds: resolvedEmployeeIds,
            targetEmployeeNames: resolvedEmployeeNames,
            targetUsers: params.targetUsers,
            assignee: params.assignee,
            assignees: params.assignees,
            creator: params.creator,
            description: params.description,
            metadata: params.metadata,
            taskId: params.taskId,
            workflowId: params.workflowId,
            workflowCode: params.workflowCode,
            targetId: params.targetId,
            orderCode: params.orderCode,
            targetRoles: resolvedRoles,
            recipientRole: targetRole,
            recipientDept: targetDept,
            link: resolvedLink,
            linkUrl
        };

        setAllNotifications(prev => {
            // Giữ tối đa 300 thông báo gần nhất (khối dữ liệu dùng chung không tăng mãi, không làm đầy bộ nhớ trình duyệt)
            const updated = [newNotif, ...prev].slice(0, 300);
            if (typeof window !== "undefined") {
                localStorage.setItem("tbr_activity_notifications", JSON.stringify(updated));
                fetch("/api/storage", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ key: "tbr_activity_notifications", data: updated })
                }).catch(() => {});
            }
            return updated;
        });

        // Trigger real-time popup toast if not disabled in matrix
        const shouldShowToast = matrixConfig ? (matrixConfig.enableToast !== false) : true;
        if (shouldShowToast) {
            showToast(`${title}: ${message}`, type);
        }
    }, [user, matrixSettings, showToast]);

    // Test notification trigger helper for Matrix Settings screen
    const testTriggerNotification = useCallback((eventKey: string) => {
        const config = matrixSettings[eventKey] || DEFAULT_NOTIFICATION_MATRIX[eventKey];
        if (!config) {
            showToast(`Không tìm thấy sự kiện ${eventKey}`, "error");
            return;
        }
        notifyActivity({
            eventKey,
            title: `🔔 [Test Matrix] ${config.name}`,
            message: `Thông báo thử nghiệm sự kiện: "${config.name}". Phân hệ: ${config.categoryLabel}. Người nhận: [${config.targetRoles.join(", ") || "Toàn bộ"}].`,
            type: "info",
            category: config.category,
            targetRoles: config.targetRoles,
            targetEmployeeIds: config.targetEmployeeIds
        });
    }, [matrixSettings, notifyActivity, showToast]);

    // Backward-compatible addNotification
    const addNotification = useCallback((params: any) => {
        notifyActivity({
            title: params.title,
            message: params.message,
            type: params.type || "info",
            category: params.category || "system",
            targetEmployeeIds: params.recipientOpts?.email ? [params.recipientOpts.email] : [],
            linkUrl: params.linkUrl
        });
    }, [notifyActivity]);

    // Filter notifications based on selectedEmployeeFilter
    const filteredNotifications = useMemo(() => {
        if (selectedEmployeeFilter === "all") {
            return allNotifications;
        }

        const matchRoleAgainstPerson = (allTargetRoles: string[], deptStr: string, posStr: string, userRoleStr?: string) => {
            const deptLower = (deptStr || "").toLowerCase();
            const posLower = (posStr || "").toLowerCase();
            const uRoleLower = (userRoleStr || "").toLowerCase();
            for (const r of allTargetRoles) {
                const rLower = (r || "").toLowerCase();
                if (rLower === "admin" || rLower === "director") {
                    if (deptLower.includes("giám đốc") || deptLower.includes("bod") || uRoleLower === "admin" || uRoleLower === "director") return true;
                } else if (rLower === "sales_head") {
                    if (deptLower.includes("kinh doanh") && (posLower.includes("trưởng") || posLower.includes("phó") || posLower.includes("head") || posLower.includes("quản lý"))) return true;
                } else if (rLower === "sales_rep" || rLower === "sales") {
                    if (deptLower.includes("kinh doanh") || uRoleLower.includes("sale")) return true;
                } else if (rLower === "warehouse" || rLower === "warehouse_lead" || rLower === "warehouse_specialist") {
                    // Kho hàng kinh doanh: Sales Admin / nhân viên kho kinh doanh (không phải phòng Cung ứng Kho của nhà máy)
                    if (uRoleLower.includes("warehouse") || uRoleLower === "sales_admin" || deptLower === "kho vận") return true;
                } else if (rLower === "procurement" || rLower === "procurement_lead" || rLower === "procurement_specialist") {
                    if (uRoleLower.includes("procurement") || uRoleLower === "sales_admin" || deptLower.includes("xnk") || deptLower === "mua hàng & cung ứng") return true;
                } else if (rLower === "app_head") {
                    if ((deptLower.includes("ứng dụng") || deptLower.includes("kỹ thuật") || deptLower.includes("lab")) && (posLower.includes("trưởng") || posLower.includes("head"))) return true;
                } else if (rLower === "app_rep" || rLower === "application") {
                    if (deptLower.includes("ứng dụng") || deptLower.includes("kỹ thuật") || deptLower.includes("lab") || uRoleLower.includes("app")) return true;
                } else if (rLower === "accountant" || rLower === "accountant_head") {
                    if (deptLower.includes("kế toán") || deptLower.includes("tài chính") || uRoleLower.includes("accountant") || uRoleLower.includes("finance")) return true;
                } else if (rLower === "qa_qc" || rLower === "qa_qc_lead") {
                    if (deptLower.includes("chất lượng") || deptLower.includes("qa") || deptLower.includes("qc")) return true;
                } else if (rLower === "legal" || rLower === "legal_head") {
                    if (deptLower.includes("pháp chế") || deptLower.includes("luật")) return true;
                }
            }
            return false;
        };

        if (selectedEmployeeFilter === "MINE") {
            const uName = ((user as any)?.full_name || user?.name || "").trim().toLowerCase();
            const uEmail = (user?.email || "").trim().toLowerCase();
            const uUsername = (user?.username || "").trim().toLowerCase();
            const uDept = ((user as any)?.department || "").trim().toLowerCase();
            const uRole = ((user as any)?.role || "").trim().toLowerCase();
            const uEmpId = ((user as any)?.employee_id || (user as any)?.employee_code || "").trim().toLowerCase();

            if (!uName && !uEmail && !uUsername && !uEmpId) {
                return allNotifications;
            }

            const matchedPersonnel = personnelList.find(p =>
                (uEmpId && p.employee_id.toLowerCase() === uEmpId) ||
                (uName && p.full_name.toLowerCase() === uName) ||
                (uEmail && p.email && p.email.toLowerCase() === uEmail) ||
                (uName && (p.full_name.toLowerCase().includes(uName) || uName.includes(p.full_name.toLowerCase())))
            );

            const effectiveName = (matchedPersonnel?.full_name || uName).toLowerCase();
            const effectiveEmpId = (matchedPersonnel?.employee_id || uEmpId).toLowerCase();
            const effectiveEmail = (matchedPersonnel?.email || uEmail).toLowerCase();
            const effectiveDept = (matchedPersonnel?.department || uDept).toLowerCase();
            const effectivePos = (matchedPersonnel?.position || "").toLowerCase();

            const nameTokens = Array.from(new Set([uName, effectiveName, uUsername, effectiveEmpId].filter(t => t && t.length >= 2)));

            return allNotifications.filter(n => {
                if (Array.isArray(n.targetEmployeeIds) && n.targetEmployeeIds.some(id => {
                    const idLower = String(id || "").toLowerCase();
                    return idLower === effectiveEmpId || idLower === uEmpId || idLower === effectiveEmail || idLower === uUsername || idLower === effectiveName;
                })) return true;

                const candidateNames = [
                    ...(n.targetEmployeeNames || []),
                    ...(n.targetUsers || []),
                    ...(n.assignees || []),
                    n.assignee || "",
                    n.creator || "",
                    n.sender?.name || "",
                    n.sender?.id || ""
                ].filter(Boolean).map(s => String(s).toLowerCase());

                if (candidateNames.some(cand => nameTokens.some(tok => cand.includes(tok) || tok.includes(cand)))) {
                    return true;
                }

                if (n.recipientEmail && effectiveEmail && n.recipientEmail.toLowerCase() === effectiveEmail) return true;
                if (n.recipientDept && effectiveDept && (
                    n.recipientDept.toLowerCase().includes(effectiveDept) ||
                    effectiveDept.includes(n.recipientDept.toLowerCase())
                )) return true;

                const textBlob = `${n.title || ""} ${n.message || ""} ${n.description || ""} ${n.metadata ? JSON.stringify(n.metadata) : ""}`.toLowerCase();
                if (nameTokens.some(tok => textBlob.includes(`@${tok}`) || (tok.length >= 3 && textBlob.includes(tok)))) {
                    return true;
                }
                if (effectiveDept && effectiveDept.length >= 3 && (textBlob.includes(`@${effectiveDept}`) || textBlob.includes(`phòng ${effectiveDept}`) || textBlob.includes(`[${effectiveDept}]`))) {
                    return true;
                }

                const allTargetRoles = [n.recipientRole, ...(n.targetRoles || [])].filter(Boolean) as string[];
                if (allTargetRoles.length > 0 && matchRoleAgainstPerson(allTargetRoles, effectiveDept, effectivePos, uRole)) {
                    return true;
                }

                return false;
            });
        }

        return allNotifications.filter(n => {
            if (n.targetEmployeeIds && n.targetEmployeeIds.includes(selectedEmployeeFilter)) return true;
            
            const targetPersonnel = personnelList.find(p => 
                p.employee_id === selectedEmployeeFilter || 
                p.full_name.toLowerCase() === selectedEmployeeFilter.toLowerCase()
            );
            const textBlob = `${n.title || ""} ${n.message || ""} ${n.description || ""}`.toLowerCase();
            if (targetPersonnel) {
                const fullLower = targetPersonnel.full_name.toLowerCase();
                if (n.recipientEmail && targetPersonnel.email && n.recipientEmail.toLowerCase() === targetPersonnel.email.toLowerCase()) return true;
                if (n.targetEmployeeNames && n.targetEmployeeNames.some(name => 
                    name.toLowerCase().includes(fullLower) ||
                    fullLower.includes(name.toLowerCase())
                )) return true;
                if (n.targetUsers && n.targetUsers.some(name => name.toLowerCase().includes(fullLower) || fullLower.includes(name.toLowerCase()))) return true;
                if (n.assignees && n.assignees.some(name => name.toLowerCase().includes(fullLower) || fullLower.includes(name.toLowerCase()))) return true;
                if (n.assignee && (n.assignee.toLowerCase().includes(fullLower) || fullLower.includes(n.assignee.toLowerCase()))) return true;
                if (n.sender?.name && (
                    n.sender.name.toLowerCase().includes(fullLower) ||
                    fullLower.includes(n.sender.name.toLowerCase())
                )) return true;
                if (textBlob.includes(fullLower)) return true;
                if (n.recipientDept && targetPersonnel.department && n.recipientDept.toLowerCase() === targetPersonnel.department.toLowerCase()) return true;

                const allTargetRoles = [n.recipientRole, ...(n.targetRoles || [])].filter(Boolean) as string[];
                if (allTargetRoles.length > 0 && matchRoleAgainstPerson(allTargetRoles, targetPersonnel.department || "", targetPersonnel.position || "")) {
                    return true;
                }
            } else {
                const filterLower = selectedEmployeeFilter.toLowerCase();
                if (n.targetEmployeeNames && n.targetEmployeeNames.some(name => 
                    name.toLowerCase().includes(filterLower) ||
                    filterLower.includes(name.toLowerCase())
                )) return true;
                if (n.sender?.name && n.sender.name.toLowerCase().includes(filterLower)) return true;
                if (textBlob.includes(filterLower)) return true;
            }
            
            return false;
        });
    }, [allNotifications, selectedEmployeeFilter, personnelList, user]);

    const getEffectiveReaderId = useCallback((customReader?: string) => {
        if (customReader) return customReader;
        if (selectedEmployeeFilter === "all") return "current_viewer";
        if (selectedEmployeeFilter === "MINE") return user?.email || user?.username || user?.name || "mine_viewer";
        return selectedEmployeeFilter;
    }, [selectedEmployeeFilter, user]);

    // Calculate unread count for the active filter
    const unreadCount = useMemo(() => {
        const readerId = getEffectiveReaderId();
        return filteredNotifications.filter(n => {
            if (!n.readBy || n.readBy.length === 0) return true;
            return !n.readBy.includes(readerId) && !n.readBy.includes("current_viewer");
        }).length;
    }, [filteredNotifications, getEffectiveReaderId]);

    const markAsRead = useCallback((id: string, readerId?: string) => {
        const effectiveReader = getEffectiveReaderId(readerId);
        setAllNotifications(prev => {
            const updated = prev.map(n => {
                if (n.id === id) {
                    const readSet = new Set(n.readBy || []);
                    readSet.add(effectiveReader);
                    readSet.add("current_viewer");
                    return { ...n, readBy: Array.from(readSet) };
                }
                return n;
            });
            saveNotifications(updated);
            return updated;
        });
    }, [getEffectiveReaderId, saveNotifications]);

    const markAllAsRead = useCallback((readerId?: string) => {
        const effectiveReader = getEffectiveReaderId(readerId);
        setAllNotifications(prev => {
            const targetIds = new Set(filteredNotifications.map(n => n.id));
            const updated = prev.map(n => {
                if (targetIds.has(n.id)) {
                    const readSet = new Set(n.readBy || []);
                    readSet.add(effectiveReader);
                    readSet.add("current_viewer");
                    return { ...n, readBy: Array.from(readSet) };
                }
                return n;
            });
            saveNotifications(updated);
            return updated;
        });
    }, [filteredNotifications, getEffectiveReaderId, saveNotifications]);

    const deleteNotification = useCallback((id: string) => {
        setAllNotifications(prev => {
            const updated = prev.filter(n => n.id !== id);
            saveNotifications(updated);
            return updated;
        });
    }, [saveNotifications]);

    const clearAllNotifications = useCallback(() => {
        const readerKeys = [
            user?.id ? String(user.id) : "",
            user?.username || "",
            user?.name || "",
            selectedEmployeeFilter === "all" ? "current_viewer" : selectedEmployeeFilter
        ].filter(Boolean);
        setAllNotifications(prev => {
            const targetIds = new Set(filteredNotifications.map(n => n.id));
            const updated = prev.map(n => {
                if (targetIds.has(n.id)) {
                    const readSet = new Set(n.readBy || []);
                    readerKeys.forEach(k => readSet.add(k));
                    return { ...n, readBy: Array.from(readSet) };
                }
                return n;
            });
            saveNotifications(updated);
            return updated;
        });
    }, [user, filteredNotifications, selectedEmployeeFilter, saveNotifications]);

    return (
        <NotificationContext.Provider
            value={{
                showToast,
                notifications: allNotifications,
                filteredNotifications,
                unreadCount,
                totalCount: filteredNotifications.length,
                addNotification,
                notifyActivity,
                markAsRead,
                markAllAsRead,
                deleteNotification,
                clearAllNotifications,
                selectedEmployeeFilter,
                setSelectedEmployeeFilter,
                personnelList,
                navigateTo,
                notificationMatrix: matrixSettings,
                updateNotificationMatrix,
                resetNotificationMatrix,
                testTriggerNotification
            }}
        >
            {children}

            {/* Floating Toast Notification Popups */}
            <div className="fixed bottom-6 right-6 z-[120] flex flex-col gap-2.5 pointer-events-none max-w-sm sm:max-w-md w-full px-4">
                <AnimatePresence>
                    {toasts.map((toast) => (
                        <motion.div
                            key={toast.id}
                            initial={{ opacity: 0, y: 30, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 15, scale: 0.95 }}
                            transition={{ duration: 0.2 }}
                            className={cn(
                                "pointer-events-auto flex items-start gap-3 p-4 rounded-2xl border shadow-xl backdrop-blur-md text-xs sm:text-sm font-medium",
                                toast.type === "success" && "bg-emerald-950/90 dark:bg-emerald-950/90 border-emerald-500/40 text-emerald-200 shadow-emerald-950/40",
                                toast.type === "error" && "bg-rose-950/90 dark:bg-rose-950/90 border-rose-500/40 text-rose-200 shadow-rose-950/40",
                                toast.type === "warning" && "bg-amber-950/90 dark:bg-amber-950/90 border-amber-500/40 text-amber-200 shadow-amber-950/40",
                                toast.type === "info" && "bg-slate-900/95 dark:bg-slate-900/95 border-orange-500/40 text-orange-200 shadow-orange-950/30"
                            )}
                        >
                            <div className="shrink-0 mt-0.5">
                                {toast.type === "success" && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
                                {toast.type === "error" && <AlertCircle className="w-5 h-5 text-rose-400" />}
                                {toast.type === "warning" && <AlertCircle className="w-5 h-5 text-amber-400" />}
                                {toast.type === "info" && <Bell className="w-5 h-5 text-orange-400 animate-pulse" />}
                            </div>
                            <div className="flex-1 leading-snug">
                                <span className="font-bold block text-white text-xs mb-0.5">Thông báo hoạt động ABT</span>
                                <p className="text-xs text-slate-200">{toast.message}</p>
                            </div>
                            <button
                                onClick={() => removeToast(toast.id)}
                                className="shrink-0 p-1 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </NotificationContext.Provider>
    );
};

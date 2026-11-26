"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect, useMemo, useRef } from "react";
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

export type NotificationMatrixCategory =
    | "sales"
    | "warehouse"
    | "procurement"
    | "application"
    | "workspace"
    | "finance"
    | "quality"
    | "factory_intake"
    | "factory_rd"
    | "factory_kit"
    | "factory_oligo"
    | "factory_device"
    | "factory_warehouse"
    | "factory_procurement";

export interface NotificationMatrixEvent {
    key: string;
    name: string;
    category: NotificationMatrixCategory;
    categoryLabel: string;
    block?: "commercial" | "technical" | "general";
    description: string;
    enabled: boolean;
    enableToast: boolean;
    targetRoles: string[];
    targetEmployeeIds: string[];
    targetEmployeeNames?: string[];
}

const COMMERCIAL_NOTIFICATION_MATRIX: Record<string, NotificationMatrixEvent> = {
    quote_approval_request: {
        key: "quote_approval_request",
        name: "Phê duyệt báo giá (Hàng 0đ / Quà tặng / Vượt chiết khấu)",
        category: "sales",
        categoryLabel: "Kinh Doanh & Báo Giá",
        block: "commercial",
        description: "Gửi thông báo khi có báo giá tạo mới hoặc sửa đổi cần Ban Giám Đốc hoặc Trưởng phòng Kinh doanh phê duyệt.",
        enabled: true,
        enableToast: true,
        targetRoles: ["admin", "sales_head"],
        targetEmployeeIds: []
    },
    quote_approved: {
        key: "quote_approved",
        name: "Kết quả duyệt báo giá (Khối Kinh Doanh)",
        category: "sales",
        categoryLabel: "Kinh Doanh & Báo Giá",
        block: "commercial",
        description: "Thông báo cho nhân viên kinh doanh phụ trách khi báo giá được phê duyệt hoặc từ chối.",
        enabled: true,
        enableToast: true,
        targetRoles: ["sales_rep", "sales_head"],
        targetEmployeeIds: []
    },
    order_created: {
        key: "order_created",
        name: "Đơn hàng bán mới (SO) — Khối Kinh Doanh",
        category: "sales",
        categoryLabel: "Kinh Doanh & Báo Giá",
        block: "commercial",
        description: "Thông báo khi có đơn hàng bán mới được tạo hoặc xác nhận, gửi tới Kho Kinh Doanh và Kế toán.",
        enabled: true,
        enableToast: true,
        targetRoles: ["admin", "sales_head", "warehouse", "accountant"],
        targetEmployeeIds: []
    },
    // --- KHO KINH DOANH (THƯƠNG MẠI) ---
    delivery_dispatched: {
        key: "delivery_dispatched",
        name: "Xuất kho giao hàng đơn bán (SO) — Kho Kinh Doanh",
        category: "warehouse",
        categoryLabel: "Kho Kinh Doanh (Thương Mại)",
        block: "commercial",
        description: "Thông báo khi Kho Kinh Doanh xuất hàng hóa thương mại/thành phẩm theo đơn bán (SO) và bàn giao vận chuyển tới khách hàng.",
        enabled: true,
        enableToast: true,
        targetRoles: ["warehouse", "sales_rep", "sales_head", "accountant"],
        targetEmployeeIds: []
    },
    warehouse_po_received: {
        key: "warehouse_po_received",
        name: "Nhập kho hàng hóa thương mại từ PO — Kho Kinh Doanh",
        category: "warehouse",
        categoryLabel: "Kho Kinh Doanh (Thương Mại)",
        block: "commercial",
        description: "Thông báo khi hàng hóa kinh doanh từ đơn đặt mua thương mại (PO Kinh Doanh) được kiểm đếm và hoàn tất nhập Kho Kinh Doanh.",
        enabled: true,
        enableToast: true,
        targetRoles: ["warehouse", "procurement", "accountant", "sales_head"],
        targetEmployeeIds: []
    },
    warehouse_commercial_low_stock: {
        key: "warehouse_commercial_low_stock",
        name: "Cảnh báo tồn kho thương mại tối thiểu & giữ hàng (Reservation) — Kho Kinh Doanh",
        category: "warehouse",
        categoryLabel: "Kho Kinh Doanh (Thương Mại)",
        block: "commercial",
        description: "Thông báo khi mặt hàng thương mại chạm ngưỡng tồn tối thiểu hoặc được giữ chỗ theo báo giá/đơn bán tại Kho Kinh Doanh.",
        enabled: true,
        enableToast: true,
        targetRoles: ["warehouse", "procurement", "sales_head"],
        targetEmployeeIds: []
    },
    warehouse_internal_transfer_in: {
        key: "warehouse_internal_transfer_in",
        name: "Tiếp nhận thành phẩm từ Kho Nhà Máy sang Kho Kinh Doanh",
        category: "warehouse",
        categoryLabel: "Kho Kinh Doanh (Thương Mại)",
        block: "commercial",
        description: "Thông báo khi Kho Nhà Máy bàn giao lô Kit IVD / Oligo / Thiết bị đã qua QA giải phóng sang Kho Kinh Doanh để sẵn sàng giao khách.",
        enabled: true,
        enableToast: true,
        targetRoles: ["warehouse", "factory_wh", "sales_head", "sales_rep"],
        targetEmployeeIds: []
    },
    // --- CUNG ỨNG KINH DOANH (THƯƠNG MẠI) ---
    procurement_pr_approval: {
        key: "procurement_pr_approval",
        name: "Đề xuất mua hàng thương mại (PR Kinh Doanh) cần duyệt",
        category: "procurement",
        categoryLabel: "Cung Ứng Kinh Doanh (Thương Mại)",
        block: "commercial",
        description: "Thông báo khi có phiếu đề xuất mua sắm hàng hóa kinh doanh / thiết bị thương mại cần Trưởng phòng hoặc Ban Giám Đốc phê duyệt.",
        enabled: true,
        enableToast: true,
        targetRoles: ["admin", "procurement", "sales_head"],
        targetEmployeeIds: []
    },
    procurement_po_commercial_approved: {
        key: "procurement_po_commercial_approved",
        name: "Phê duyệt & phát hành đơn đặt hàng thương mại (PO Kinh Doanh)",
        category: "procurement",
        categoryLabel: "Cung Ứng Kinh Doanh (Thương Mại)",
        block: "commercial",
        description: "Thông báo khi đơn đặt mua hàng hóa thương mại (PO Kinh Doanh) được duyệt phát hành và theo dõi lịch giao về Kho Kinh Doanh.",
        enabled: true,
        enableToast: true,
        targetRoles: ["procurement", "warehouse", "accountant", "admin"],
        targetEmployeeIds: []
    },
    procurement_import_customs_tracking: {
        key: "procurement_import_customs_tracking",
        name: "Theo dõi thông quan XNK & chứng từ CO/CQ lô hàng thương mại",
        category: "procurement",
        categoryLabel: "Cung Ứng Kinh Doanh (Thương Mại)",
        block: "commercial",
        description: "Thông báo tiến độ tờ khai hải quan, lịch hàng cập cảng và hồ sơ CO/CQ của đơn hàng nhập khẩu thương mại khối Kinh Doanh.",
        enabled: true,
        enableToast: true,
        targetRoles: ["procurement", "warehouse", "accountant", "legal"],
        targetEmployeeIds: []
    },
    // --- APPLICATION, CÔNG VIỆC, TÀI CHÍNH ---
    app_issue_ticket: {
        key: "app_issue_ticket",
        name: "Sự cố thiết bị khách hàng / Hỗ trợ kỹ thuật Application",
        category: "application",
        categoryLabel: "Lab & Application (Khối KD)",
        block: "commercial",
        description: "Thông báo khi khách hàng hoặc bộ phận Application ghi nhận sự cố máy móc / sinh phẩm tại hiện trường cần xử lý.",
        enabled: true,
        enableToast: true,
        targetRoles: ["app_head", "app_rep", "admin"],
        targetEmployeeIds: []
    },
    plan_weekly_submit: {
        key: "plan_weekly_submit",
        name: "Gửi duyệt kế hoạch công tác tuần",
        category: "workspace",
        categoryLabel: "Kế Hoạch & Công Việc",
        block: "commercial",
        description: "Thông báo khi nhân viên gửi kế hoạch công tác / lịch trình tuần mới cho Trưởng bộ phận và các nhân sự cùng thực hiện (không làm phiền Ban Giám Đốc trừ khi BGĐ trực tiếp tham gia).",
        enabled: true,
        enableToast: true,
        targetRoles: ["sales_head", "app_head"],
        targetEmployeeIds: []
    },
    task_assigned: {
        key: "task_assigned",
        name: "Giao việc mới & Điều phối công việc",
        category: "workspace",
        categoryLabel: "Kế Hoạch & Công Việc",
        block: "commercial",
        description: "Thông báo khi quản lý giao đầu việc mới cho nhân sự hoặc phòng ban cụ thể.",
        enabled: true,
        enableToast: true,
        targetRoles: ["admin"],
        targetEmployeeIds: []
    },
    task_status_updated: {
        key: "task_status_updated",
        name: "Cập nhật tiến độ / Hoàn thành công việc",
        category: "workspace",
        categoryLabel: "Kế Hoạch & Công Việc",
        block: "commercial",
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
        categoryLabel: "Kế Hoạch & Công Việc",
        block: "commercial",
        description: "Thông báo khi phát sinh đề nghị phối hợp hỗ trợ chéo giữa các bộ phận trong công ty.",
        enabled: true,
        enableToast: true,
        targetRoles: ["admin"],
        targetEmployeeIds: []
    },
    daily_report_submitted: {
        key: "daily_report_submitted",
        name: "Báo cáo kết quả công việc ngày",
        category: "workspace",
        categoryLabel: "Kế Hoạch & Công Việc",
        block: "commercial",
        description: "Thông báo khi nhân sự nộp báo cáo kết quả hoạt động hoặc nhật ký công việc cuối ngày cho Trưởng bộ phận phụ trách.",
        enabled: true,
        enableToast: true,
        targetRoles: ["sales_head", "app_head"],
        targetEmployeeIds: []
    },
    hr_birthday_celebration: {
        key: "hr_birthday_celebration",
        name: "🎂 Tự động thông báo & Chúc mừng sinh nhật nhân sự",
        category: "workspace",
        categoryLabel: "Hành Chính Nhân Sự",
        block: "commercial",
        description: "Tự động tạo thông báo chúc mừng sinh nhật nhân sự trên chuông thông báo toàn công ty, nhắc trước 3 ngày và tự động đăng lời chúc lên kênh chat #Công ty.",
        enabled: true,
        enableToast: true,
        targetRoles: ["admin", "hr_admin", "sales_head", "sales_rep", "app_head", "app_engineer", "warehouse_lead", "warehouse_staff", "procurement_lead", "procurement_staff", "accountant_head", "accountant", "legal_head", "legal_staff", "qa_qc_lead", "qa_qc", "rd_head", "rd_staff", "kit_head", "kit_staff", "oligo_head", "oligo_staff", "device_head", "device_staff"],
        targetEmployeeIds: []
    },
    invoice_vat_issued: {
        key: "invoice_vat_issued",
        name: "Xuất hóa đơn VAT & Xác nhận thanh toán công nợ",
        category: "finance",
        categoryLabel: "Kế Toán & Tài Chính",
        block: "commercial",
        description: "Thông báo khi kế toán xuất hóa đơn điện tử VAT hoặc xác nhận khách hàng thanh toán đơn hàng.",
        enabled: true,
        enableToast: true,
        targetRoles: ["accountant", "sales_rep", "admin"],
        targetEmployeeIds: []
    },
    quality_coa_alert: {
        key: "quality_coa_alert",
        name: "Cảnh báo chất lượng QA/QC, Hồ sơ COA & Hạn sử dụng",
        category: "quality",
        categoryLabel: "QA/QC & Quản Lý Chất Lượng",
        block: "technical",
        description: "Thông báo cảnh báo lô hàng cận hạn sử dụng, sai lệch nhiệt độ bảo quản hoặc phát hành chứng nhận phân tích COA.",
        enabled: true,
        enableToast: true,
        targetRoles: ["qa_qc", "factory_qa", "warehouse", "factory_wh", "admin"],
        targetEmployeeIds: []
    }
};

function resolveFactoryCategoryAndRoles(ev: { type: string; dept: string; defaultRoles?: string[] }): {
    category: NotificationMatrixCategory;
    categoryLabel: string;
    targetRoles: string[];
} {
    const t = ev.type.toUpperCase();
    switch (ev.dept) {
        case "Đơn Nội Bộ":
            return {
                category: "factory_intake",
                categoryLabel: "Đơn Nội Bộ (KD ↔ Nhà Máy)",
                targetRoles: ev.defaultRoles || ["factory_intake", "factory_kit", "factory_oligo", "factory_device", "sales_head"]
            };
        case "Nghiên cứu R&D": {
            const roles = ["factory_rd"];
            if (t.includes("GATE") || t.includes("HOLD") || t.includes("KILL") || t.includes("APPROVE")) roles.push("admin");
            if (t.includes("TECH_TRANSFER")) roles.push("factory_kit", "factory_qa");
            return {
                category: "factory_rd",
                categoryLabel: "Nghiên Cứu R&D (Khối Kỹ Thuật)",
                targetRoles: ev.defaultRoles || Array.from(new Set(roles))
            };
        }
        case "Sản xuất Kit": {
            const roles = ["factory_kit"];
            if (t.includes("QC") || t.includes("QA") || t.includes("EBR") || t.includes("BOM") || t.includes("ROUTING")) roles.push("factory_qa");
            if (t.includes("FAIL_QC")) roles.push("admin");
            return {
                category: "factory_kit",
                categoryLabel: "Sản Xuất Kit (Khối Kỹ Thuật)",
                targetRoles: ev.defaultRoles || Array.from(new Set(roles))
            };
        }
        case "Tổng hợp Oligo": {
            const roles = ["factory_oligo"];
            if (t.includes("QC")) roles.push("factory_qa");
            if (t.includes("QC_PASSED")) roles.push("factory_intake");
            return {
                category: "factory_oligo",
                categoryLabel: "Tổng Hợp Oligo (Khối Kỹ Thuật)",
                targetRoles: ev.defaultRoles || Array.from(new Set(roles))
            };
        }
        case "Kỹ thuật – Thiết bị": {
            const roles = ["factory_device"];
            if (t.includes("FQC") || t.includes("QA") || t.includes("VALIDATION") || t.includes("ECO")) roles.push("factory_qa");
            if (t.includes("COMPLETE_PQ") || t.includes("ECO_SUBMIT")) roles.push("admin");
            return {
                category: "factory_device",
                categoryLabel: "Kỹ Thuật – Thiết Bị (Khối Kỹ Thuật)",
                targetRoles: ev.defaultRoles || Array.from(new Set(roles))
            };
        }
        case "QA/QC": {
            const roles = ["factory_qa", "qa_qc"];
            if (t.includes("CONCESSION") || t.includes("DEVIATION") || t.includes("NCR")) roles.push("admin");
            if (t.includes("IQC")) roles.push("factory_wh");
            return {
                category: "quality",
                categoryLabel: "QA/QC Nhà Máy (Khối Kỹ Thuật)",
                targetRoles: ev.defaultRoles || Array.from(new Set(roles))
            };
        }
        case "Kho Nhà máy": {
            const roles = ["factory_wh", "factory_qa"];
            if (t.includes("REJECT")) roles.push("factory_purchase");
            if (t.includes("RECONCILE")) roles.push("accountant", "admin");
            return {
                category: "factory_warehouse",
                categoryLabel: "Kho Nhà Máy – Vật Tư & TP SX (Khối Kỹ Thuật)",
                targetRoles: ev.defaultRoles || Array.from(new Set(roles))
            };
        }
        case "Mua hàng Nhà máy": {
            const roles = ["factory_purchase"];
            if (t.includes("ESCALATE") || t.includes("BOD")) roles.push("admin");
            if (t.includes("APPROVE") || t.includes("MRP") || t.includes("DELIVERY")) roles.push("factory_wh");
            return {
                category: "factory_procurement",
                categoryLabel: "Cung Ứng Kỹ Thuật – Mua Hàng Nhà Máy",
                targetRoles: ev.defaultRoles || Array.from(new Set(roles))
            };
        }
        default:
            return {
                category: "quality",
                categoryLabel: `${ev.dept} (Khối Kỹ Thuật)`,
                targetRoles: ev.defaultRoles || ["factory_qa"]
            };
    }
}

function buildTechnicalNotificationMatrix(): Record<string, NotificationMatrixEvent> {
    const out: Record<string, NotificationMatrixEvent> = {};
    for (const ev of FACTORY_NOTICE_EVENTS) {
        const key = factoryNoticeKey(ev.type);
        const { category, categoryLabel, targetRoles } = resolveFactoryCategoryAndRoles(ev);
        out[key] = {
            key,
            name: ev.name,
            category,
            categoryLabel,
            block: "technical",
            description: ev.description,
            enabled: true,
            enableToast: true,
            targetRoles,
            targetEmployeeIds: []
        };
    }
    return out;
}

export const DEFAULT_NOTIFICATION_MATRIX: Record<string, NotificationMatrixEvent> = {
    ...COMMERCIAL_NOTIFICATION_MATRIX,
    ...buildTechnicalNotificationMatrix()
};

export function mergeNotificationMatrixWithDefaults(
    stored?: Record<string, Partial<NotificationMatrixEvent>> | null
): Record<string, NotificationMatrixEvent> {
    const merged: Record<string, NotificationMatrixEvent> = {};
    for (const [key, def] of Object.entries(DEFAULT_NOTIFICATION_MATRIX)) {
        const custom = stored?.[key];
        if (custom && typeof custom === "object") {
            merged[key] = {
                ...def,
                enabled: typeof custom.enabled === "boolean" ? custom.enabled : def.enabled,
                enableToast: typeof custom.enableToast === "boolean" ? custom.enableToast : def.enableToast,
                targetRoles: Array.isArray(custom.targetRoles) ? custom.targetRoles : def.targetRoles,
                targetEmployeeIds: Array.isArray(custom.targetEmployeeIds) ? custom.targetEmployeeIds : def.targetEmployeeIds,
                targetEmployeeNames: Array.isArray(custom.targetEmployeeNames) ? custom.targetEmployeeNames : def.targetEmployeeNames,
            };
        } else {
            merged[key] = { ...def };
        }
    }
    return merged;
}

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
    const sanitizeBroadNotificationTargets = (list: Notification[]): Notification[] =>
        list.map((n) => {
            if (Array.isArray(n?.targetEmployeeNames) && n.targetEmployeeNames.length > 12) {
                const titleColon = String(n.title || "").split(":").slice(1).join(":").trim();
                return {
                    ...n,
                    targetEmployeeNames: titleColon ? [titleColon] : []
                };
            }
            return n;
        });

    const [allNotifications, setAllNotifications] = useState<Notification[]>(() => {
        if (typeof window !== "undefined") {
            const stored = localStorage.getItem("tbr_activity_notifications");
            if (stored) {
                try {
                    const parsed = JSON.parse(stored);
                    if (Array.isArray(parsed)) return sanitizeBroadNotificationTargets(parsed);
                } catch (err) {}
            }
        }
        return [];
    });
    // Current list for the 25 s poll to compare against without re-rendering
    const allNotificationsRef = useRef(allNotifications);
    allNotificationsRef.current = allNotifications;

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

    // Refresh unified live activity notifications from server feed (tasks + workflows + proposals + daily + factory notices + R&D)
    const refreshNotifications = useCallback(async () => {
        if (!user || typeof window === "undefined") return;
        try {
            const res = await fetch("/api/notifications/feed", { cache: "no-store" });
            if (!res.ok) return;
            const data = await res.json();
            if (data && Array.isArray(data.notifications)) {
                // Polled every 25 s: keep the same array when nothing changed, otherwise every component using
                // useNotification (Kinh doanh, Cung ứng, Application, Cấu hình… even hidden tabs) re-renders each time.
                const nextJson = JSON.stringify(data.notifications);
                if (JSON.stringify(allNotificationsRef.current) === nextJson) return;
                setAllNotifications(data.notifications);
                try {
                    localStorage.setItem("tbr_activity_notifications", nextJson);
                } catch {}
            }
        } catch {}
    }, [user]);

    // Load initial + periodic background refresh + window focus / visibility sync
    useEffect(() => {
        if (!user || typeof window === "undefined") return;
        refreshNotifications();

        fetch("/api/storage?key=system_notification_matrix")
            .then(res => res.json())
            .then(data => {
                const merged = mergeNotificationMatrixWithDefaults(
                    data && data.data && typeof data.data === "object" ? data.data : undefined
                );
                setMatrixSettings(merged);
                localStorage.setItem("system_notification_matrix", JSON.stringify(merged));
            })
            .catch(() => {});

        const intervalId = window.setInterval(() => {
            if (document.visibilityState === "visible") {
                refreshNotifications();
            }
        }, 25_000);

        const handleFocus = () => {
            refreshNotifications();
        };
        const handleVisibility = () => {
            if (document.visibilityState === "visible") refreshNotifications();
        };

        window.addEventListener("focus", handleFocus);
        document.addEventListener("visibilitychange", handleVisibility);
        return () => {
            window.clearInterval(intervalId);
            window.removeEventListener("focus", handleFocus);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, [user, refreshNotifications]);

    // Notification Matrix Settings (Configurable by Admin)
    const [matrixSettings, setMatrixSettings] = useState<Record<string, NotificationMatrixEvent>>(() => {
        if (typeof window !== "undefined") {
            const stored = localStorage.getItem("system_notification_matrix");
            if (stored) {
                try {
                    const parsed = JSON.parse(stored);
                    if (parsed && typeof parsed === "object") {
                        return mergeNotificationMatrixWithDefaults(parsed);
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
                    setMatrixSettings(mergeNotificationMatrixWithDefaults(JSON.parse(e.newValue || "{}")));
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

        const extractedCodeMatch = `${title || ""} ${message || ""}`.match(/\b((?:WF\d*|TSK|TASK|PR\d*|PO\d*|BG\d*|SO\d*|HD\d*|DXNP|DX|DNTT|DNTU|QT|TTR|DXM)-[A-Z0-9-]+)\b/i);
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
            subTab: (category === "workflow" || (title || "").toLowerCase().includes("phối hợp") || /^WF\d*-/i.test(autoItemId || "")) ? "workflows" : "tasks",
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
            // Giữ tối đa 300 thông báo hiển thị; chỉ gửi patch atomic phần tử mới lên server (không ghi đè dữ liệu người khác)
            const updated = [newNotif, ...prev].slice(0, 300);
            if (typeof window !== "undefined") {
                try {
                    localStorage.setItem("tbr_activity_notifications", JSON.stringify(updated));
                } catch {}
                fetch("/api/storage", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        key: "tbr_activity_notifications",
                        patch: { kind: "array", upserts: [newNotif], deletes: [], order: [`id:${newNotif.id}`] }
                    })
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

    // Filter notifications based on selectedEmployeeFilter & Notification Matrix
    const filteredNotifications = useMemo(() => {
        const resolveNotifMatrixConfig = (n: Notification): NotificationMatrixEvent | undefined => {
            if (n.eventKey && matrixSettings[n.eventKey]) {
                return matrixSettings[n.eventKey];
            }
            const t = String(n.title || "").trim();
            if (!t) return undefined;
            if (t.startsWith("Bạn được giao kiểm tra xuất xưởng (FQC)")) {
                return matrixSettings["factory_device_fqc_assigned"];
            }
            return Object.values(matrixSettings).find(
                (m) => m.name && (t === m.name || t.startsWith(`${m.name}:`))
            );
        };

        const activeNotifications = allNotifications.filter((n) => {
            const cfg = resolveNotifMatrixConfig(n);
            if (cfg && cfg.enabled === false) return false;
            return true;
        });

        if (selectedEmployeeFilter === "all") {
            return activeNotifications;
        }

        const normalizeNotifDeptKey = (raw: string): string => {
            const s = (raw || "").trim().toLowerCase();
            if (!s) return "";
            if (s.includes("r&d") || s.includes("nghiên cứu")) return "factory_rd";
            if (s.includes("sản xuất kit") || s.includes("sx kit")) return "factory_kit";
            if (s.includes("oligo") || s.includes("tổng hợp oligo")) return "factory_oligo";
            if (s.includes("kỹ thuật – thiết bị") || s.includes("kỹ thuật - thiết bị") || s.includes("thiết bị")) return "factory_device";
            if (s.includes("đơn nội bộ") || s.includes("điều phối sản xuất")) return "factory_intake";
            if (s.includes("kho nhà máy") || s.includes("kho kỹ thuật") || s.includes("kho tổng nhà máy")) return "factory_warehouse";
            if (s.includes("cung ứng kỹ thuật") || s.includes("mua hàng nhà máy") || s.includes("cung ứng nhà máy") || s.includes("cung ứng nvl")) return "factory_procurement";
            if (s.includes("ứng dụng") || s.includes("application") || s.includes("lab")) return "application";
            if (s.includes("kho") || s.includes("vận hành") || s.includes("warehouse") || s.includes("giao nhận")) return "warehouse";
            if (s.includes("cung ứng") || s.includes("mua hàng") || s.includes("xnk") || s.includes("procurement")) return "procurement";
            if (s.includes("kinh doanh") || s.includes("sales") || s.includes("marketing")) return "sales";
            if (s.includes("qa") || s.includes("qc") || s.includes("chất lượng")) return "quality";
            if (s.includes("pháp chế") || s.includes("legal")) return "legal";
            if (s.includes("kế toán") || s.includes("tài chính") || s.includes("accounting")) return "accounting";
            if (s.includes("giám đốc") || s.includes("bod")) return "director";
            return s;
        };

        const isSameNotifDept = (deptA: string, deptB: string): boolean => {
            const keysA = String(deptA || "").split(/[,;\n]+/).map(normalizeNotifDeptKey).filter(Boolean);
            const keysB = String(deptB || "").split(/[,;\n]+/).map(normalizeNotifDeptKey).filter(Boolean);
            if (keysA.length === 0 || keysB.length === 0) return false;
            return keysA.some(ka => keysB.some(kb => ka === kb || ka.includes(kb) || kb.includes(ka)));
        };

        const matchRoleAgainstPerson = (allTargetRoles: string[], deptStr: string, posStr: string, userRoleStr?: string, userNameStr?: string) => {
            const deptLower = (deptStr || "").toLowerCase();
            const posLower = (posStr || "").toLowerCase();
            const uRoleLower = (userRoleStr || "").toLowerCase();
            const uNameLower = (userNameStr || "").toLowerCase();
            const isFactoryWhDept = deptLower.includes("kho nhà máy") || deptLower.includes("kho kỹ thuật") || deptLower.includes("kho tổng nhà máy");
            const isFactoryProcurementDept = deptLower.includes("mua hàng nhà máy") || deptLower.includes("cung ứng nhà máy") || deptLower.includes("cung ứng kỹ thuật") || deptLower.includes("cung ứng nvl");

            for (const r of allTargetRoles) {
                const rLower = (r || "").toLowerCase();
                if (rLower === "admin" || rLower === "director") {
                    if (
                        deptLower.includes("giám đốc") ||
                        deptLower.includes("bod") ||
                        uRoleLower === "admin" ||
                        uRoleLower === "director" ||
                        uNameLower.includes("quản trị viên")
                    ) return true;
                } else if (rLower === "sales_head") {
                    if (deptLower.includes("kinh doanh") && (posLower.includes("trưởng") || posLower.includes("phó") || posLower.includes("head") || posLower.includes("quản lý"))) return true;
                } else if (rLower === "sales_rep" || rLower === "sales") {
                    if (deptLower.includes("kinh doanh") || uRoleLower.includes("sale")) return true;
                } else if (rLower === "warehouse" || rLower === "warehouse_lead" || rLower === "warehouse_specialist") {
                    // Kho Kinh Doanh (Thương Mại) — tách biệt với Kho Nhà Máy
                    if ((deptLower.includes("kho") && !isFactoryWhDept) || deptLower.includes("kho kinh doanh") || deptLower.includes("kho vận") || uRoleLower === "warehouse") return true;
                } else if (rLower === "procurement" || rLower === "procurement_lead" || rLower === "procurement_specialist") {
                    // Cung Ứng Kinh Doanh (Thương Mại) — tách biệt với Cung Ứng Nhà Máy
                    if (((deptLower.includes("cung ứng") || deptLower.includes("mua hàng") || deptLower.includes("xnk")) && !isFactoryProcurementDept) || deptLower.includes("cung ứng kinh doanh") || uRoleLower === "procurement") return true;
                } else if (rLower === "app_head") {
                    if ((deptLower.includes("ứng dụng") || deptLower.includes("application") || deptLower.includes("lab")) && (posLower.includes("trưởng") || posLower.includes("head"))) return true;
                } else if (rLower === "app_rep" || rLower === "application") {
                    if (deptLower.includes("ứng dụng") || deptLower.includes("application") || uRoleLower.includes("app")) return true;
                } else if (rLower === "accountant" || rLower === "accountant_head") {
                    if (deptLower.includes("kế toán") || deptLower.includes("tài chính") || uRoleLower.includes("accountant") || uRoleLower.includes("finance")) return true;
                } else if (rLower === "qa_qc" || rLower === "qa_qc_lead" || rLower === "factory_qa") {
                    if (deptLower.includes("chất lượng") || deptLower.includes("qa") || deptLower.includes("qc") || uRoleLower.includes("qa") || uRoleLower.includes("qc")) return true;
                } else if (rLower === "legal" || rLower === "legal_head") {
                    if (deptLower.includes("pháp chế") || deptLower.includes("luật")) return true;
                } else if (rLower === "factory_rd") {
                    if (deptLower.includes("r&d") || deptLower.includes("nghiên cứu") || uRoleLower.includes("rd_")) return true;
                } else if (rLower === "factory_kit") {
                    if (deptLower.includes("sản xuất kit") || deptLower.includes("sx kit") || uRoleLower.includes("kit_")) return true;
                } else if (rLower === "factory_oligo") {
                    if (deptLower.includes("oligo") || uRoleLower.includes("oligo_")) return true;
                } else if (rLower === "factory_device") {
                    if (deptLower.includes("thiết bị") || deptLower.includes("kỹ thuật – thiết bị") || deptLower.includes("kỹ thuật - thiết bị") || uRoleLower.includes("device_")) return true;
                } else if (rLower === "factory_wh") {
                    // Kho Nhà Máy (Khối Kỹ Thuật)
                    if (isFactoryWhDept || (deptLower.includes("kho") && (deptLower.includes("nhà máy") || deptLower.includes("kỹ thuật"))) || uRoleLower.includes("factory_wh")) return true;
                } else if (rLower === "factory_purchase") {
                    // Cung Ứng & Mua Hàng Nhà Máy (Khối Kỹ Thuật)
                    if (isFactoryProcurementDept || ((deptLower.includes("cung ứng") || deptLower.includes("mua hàng")) && (deptLower.includes("nhà máy") || deptLower.includes("kỹ thuật") || deptLower.includes("nvl"))) || uRoleLower.includes("factory_purchase")) return true;
                } else if (rLower === "factory_intake") {
                    if (deptLower.includes("đơn nội bộ") || deptLower.includes("điều phối")) return true;
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

            // Graceful fallback if no user is logged in
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

            const nameTokens = Array.from(new Set([uName, effectiveName, effectiveEmpId].filter(t => t && t.length >= 2)));
            const isViewerAdminOrDirector =
                uRole === "admin" ||
                uRole === "director" ||
                effectiveDept.includes("giám đốc") ||
                effectiveDept.includes("bod");

            return activeNotifications.filter(n => {
                const matrixCfg = resolveNotifMatrixConfig(n);
                const effectiveMatrixRoles = matrixCfg
                    ? (matrixCfg.targetRoles || [])
                    : ([n.recipientRole, ...(n.targetRoles || [])].filter(Boolean) as string[]);
                const matrixAllowsAdmin =
                    effectiveMatrixRoles.includes("admin") || effectiveMatrixRoles.includes("director");
                const isExplicitlyInMatrixEmployees = Boolean(
                    matrixCfg && (
                        (Array.isArray(matrixCfg.targetEmployeeIds) && matrixCfg.targetEmployeeIds.some(id => {
                            const idLower = String(id || "").toLowerCase();
                            return idLower === effectiveEmpId || idLower === uEmpId || idLower === effectiveEmail || idLower === uUsername || idLower === effectiveName;
                        })) ||
                        (Array.isArray(matrixCfg.targetEmployeeNames) && matrixCfg.targetEmployeeNames.some(nm => {
                            const nmLower = String(nm || "").toLowerCase();
                            return nameTokens.some(tok => nmLower.includes(tok) || tok.includes(nmLower));
                        }))
                    )
                );

                // Nếu người xem là Ban Giám Đốc / Admin và sự kiện trong Ma trận thông báo KHÔNG tích chọn gửi cho Ban Giám Đốc:
                // - Với thông báo sản xuất/kỹ thuật nhà máy tự động (Hệ thống Nhà máy ISO 13485 / Khối Kỹ thuật): ẩn hoàn toàn trừ khi BGĐ được gán đích danh trong Ma trận hoặc là Chủ nhiệm/Người thực hiện trực tiếp.
                const isTechnicalSystemNotice =
                    matrixCfg?.block === "technical" ||
                    String(n.id || "").startsWith("FN-") ||
                    String(n.category || "").startsWith("factory_") ||
                    n.sender?.name === "Hệ thống Nhà máy (ISO 13485)";

                if (isViewerAdminOrDirector && !matrixAllowsAdmin && !isExplicitlyInMatrixEmployees) {
                    if (isTechnicalSystemNotice) {
                        const directPersonalNames = [
                            n.assignee || "",
                            ...(n.assignees || []),
                            n.creator || "",
                        ].filter(Boolean).map(s => String(s).toLowerCase());
                        const isDirectPersonalOwner = directPersonalNames.some(cand =>
                            nameTokens.some(tok => cand.includes(tok) || tok.includes(cand))
                        );
                        return isDirectPersonalOwner;
                    }
                }

                if (isExplicitlyInMatrixEmployees) return true;

                // Nếu thông báo từ Hệ thống Nhà máy (FN- / Khối Kỹ thuật) đã có targetRoles từ Ma trận mà phòng ban của người xem không khớp bất kỳ role nào,
                // đồng thời tên người xem không xuất hiện trực tiếp trong nội dung thông báo -> loại bỏ các thông báo cũ từng gán nhầm targetEmployeeNames sang phòng khác.
                const textBlob = `${n.title || ""} ${n.message || ""} ${n.description || ""} ${n.metadata ? JSON.stringify(n.metadata) : ""}`.toLowerCase();
                const isMentionedInText = nameTokens.some(tok => textBlob.includes(`@${tok}`) || (tok.length >= 3 && textBlob.includes(tok)));
                if (isTechnicalSystemNotice && !isViewerAdminOrDirector && !isExplicitlyInMatrixEmployees && !isMentionedInText) {
                    if (effectiveMatrixRoles.length > 0 && !matchRoleAgainstPerson(effectiveMatrixRoles, effectiveDept, effectivePos, uRole, uName)) {
                        return false;
                    }
                }

                // 1. Direct employee ID match
                if (Array.isArray(n.targetEmployeeIds) && n.targetEmployeeIds.some(id => {
                    const idLower = String(id || "").toLowerCase();
                    return idLower === effectiveEmpId || idLower === uEmpId || idLower === effectiveEmail || idLower === uUsername || idLower === effectiveName;
                })) return true;

                // 2. Direct employee name / targetUsers / assignees match
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

                // 3. Recipient email or department match
                if (n.recipientEmail && effectiveEmail && n.recipientEmail.toLowerCase() === effectiveEmail) return true;
                if (n.recipientDept && effectiveDept && (
                    isSameNotifDept(n.recipientDept, effectiveDept) ||
                    n.recipientDept.toLowerCase().includes(effectiveDept) ||
                    effectiveDept.includes(n.recipientDept.toLowerCase())
                )) return true;

                // 4. @mention or name/department in title, message, description, metadata
                if (isMentionedInText) {
                    return true;
                }
                if (effectiveDept && effectiveDept.length >= 3 && (textBlob.includes(`@${effectiveDept}`) || textBlob.includes(`phòng ${effectiveDept}`) || textBlob.includes(`[${effectiveDept}]`))) {
                    return true;
                }

                // 5. Role match against effectiveMatrixRoles (governed by Notification Matrix)
                // Riêng với Kế hoạch / Lịch công tác tuần (`plan_weekly_submit` / `category === "plan"`) và Báo cáo Nhật ký ngày (`daily_report_submitted` / `category === "daily"`):
                // Không tự động đẩy thông báo của toàn bộ nhân viên các phòng ban vào hộp thư cá nhân ("Hoạt động của tôi") của Ban Giám Đốc / Admin,
                // trừ khi thành viên Ban Giám Đốc có tên trực tiếp trong danh sách tham gia / người nhận hoặc được chỉ định đích danh trong Ma trận.
                const isRoutinePlanOrDaily =
                    n.eventKey === "plan_weekly_submit" ||
                    n.eventKey === "daily_report_submitted" ||
                    n.category === "plan" ||
                    n.category === "daily" ||
                    String(n.title || "").includes("Lịch Công Tác / Điều Phối Tuần Mới");
                const rolesForMineMatch =
                    isViewerAdminOrDirector && isRoutinePlanOrDaily && !isExplicitlyInMatrixEmployees
                        ? effectiveMatrixRoles.filter((r) => {
                              const rl = String(r || "").toLowerCase();
                              return rl !== "admin" && rl !== "director";
                          })
                        : effectiveMatrixRoles;

                if (rolesForMineMatch.length > 0 && matchRoleAgainstPerson(rolesForMineMatch, effectiveDept, effectivePos, uRole, uName)) {
                    return true;
                }

                return false;
            });
        }

        return activeNotifications.filter(n => {
            const matrixCfg = resolveNotifMatrixConfig(n);
            const effectiveMatrixRoles = matrixCfg
                ? (matrixCfg.targetRoles || [])
                : ([n.recipientRole, ...(n.targetRoles || [])].filter(Boolean) as string[]);
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
                if (n.recipientDept && targetPersonnel.department && (
                    isSameNotifDept(n.recipientDept, targetPersonnel.department) ||
                    n.recipientDept.toLowerCase() === targetPersonnel.department.toLowerCase()
                )) return true;

                // Role matching against effectiveMatrixRoles (governed by Notification Matrix)
                if (effectiveMatrixRoles.length > 0 && matchRoleAgainstPerson(effectiveMatrixRoles, targetPersonnel.department || "", targetPersonnel.position || "")) {
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
    }, [allNotifications, selectedEmployeeFilter, personnelList, user, matrixSettings]);

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
        const readerKeys = Array.from(
            new Set([effectiveReader, "current_viewer", user?.email || "", user?.username || "", user?.name || ""].filter(Boolean))
        );
        setAllNotifications(prev => {
            const updated = prev.map(n => {
                if (n.id === id) {
                    const readSet = new Set(n.readBy || []);
                    readerKeys.forEach(k => readSet.add(k));
                    return { ...n, readBy: Array.from(readSet) };
                }
                return n;
            });
            try {
                localStorage.setItem("tbr_activity_notifications", JSON.stringify(updated));
            } catch {}
            return updated;
        });
        if (typeof window !== "undefined") {
            fetch("/api/notifications/feed", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "mark_read", ids: [id], readerKeys })
            }).catch(() => {});
        }
    }, [getEffectiveReaderId, user]);

    const markAllAsRead = useCallback((readerId?: string) => {
        const effectiveReader = getEffectiveReaderId(readerId);
        const readerKeys = Array.from(
            new Set([effectiveReader, "current_viewer", user?.email || "", user?.username || "", user?.name || ""].filter(Boolean))
        );
        const targetIdsList = filteredNotifications.map(n => n.id);
        if (targetIdsList.length === 0) return;
        const targetIds = new Set(targetIdsList);
        setAllNotifications(prev => {
            const updated = prev.map(n => {
                if (targetIds.has(n.id)) {
                    const readSet = new Set(n.readBy || []);
                    readerKeys.forEach(k => readSet.add(k));
                    return { ...n, readBy: Array.from(readSet) };
                }
                return n;
            });
            try {
                localStorage.setItem("tbr_activity_notifications", JSON.stringify(updated));
            } catch {}
            return updated;
        });
        if (typeof window !== "undefined") {
            fetch("/api/notifications/feed", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "mark_read", ids: targetIdsList, readerKeys })
            }).catch(() => {});
        }
    }, [filteredNotifications, getEffectiveReaderId, user]);

    const deleteNotification = useCallback((id: string) => {
        const readerKeys = Array.from(
            new Set(["current_viewer", user?.email || "", user?.username || "", user?.name || ""].filter(Boolean))
        );
        setAllNotifications(prev => {
            const updated = prev.filter(n => n.id !== id);
            try {
                localStorage.setItem("tbr_activity_notifications", JSON.stringify(updated));
            } catch {}
            return updated;
        });
        if (typeof window !== "undefined") {
            fetch("/api/storage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    key: "tbr_activity_notifications",
                    patch: { kind: "array", upserts: [], deletes: [`id:${id}`], order: [] }
                })
            }).catch(() => {});
            fetch("/api/notifications/feed", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "mark_read", ids: [id], readerKeys })
            }).catch(() => {});
        }
    }, [user]);

    const clearAllNotifications = useCallback(() => {
        const readerKeys = Array.from(
            new Set([
                user?.id ? String(user.id) : "",
                user?.email || "",
                user?.username || "",
                user?.name || "",
                "current_viewer",
                selectedEmployeeFilter === "all" ? "current_viewer" : selectedEmployeeFilter
            ].filter(Boolean))
        );
        const targetIdsList = filteredNotifications.map(n => n.id);
        if (targetIdsList.length === 0) return;
        const targetIds = new Set(targetIdsList);
        setAllNotifications(prev => {
            const updated = prev.map(n => {
                if (targetIds.has(n.id)) {
                    const readSet = new Set(n.readBy || []);
                    readerKeys.forEach(k => readSet.add(k));
                    return { ...n, readBy: Array.from(readSet) };
                }
                return n;
            });
            try {
                localStorage.setItem("tbr_activity_notifications", JSON.stringify(updated));
            } catch {}
            return updated;
        });
        if (typeof window !== "undefined") {
            fetch("/api/notifications/feed", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "mark_read", ids: targetIdsList, readerKeys })
            }).catch(() => {});
        }
    }, [user, filteredNotifications, selectedEmployeeFilter]);

    // Same object while nothing in it changed: a toast or an unrelated provider state change no longer re-renders
    // every consumer (including the big modules kept mounted in hidden tabs).
    const contextValue = useMemo(
        () => ({
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
            testTriggerNotification,
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [showToast, allNotifications, filteredNotifications, unreadCount, addNotification, notifyActivity, markAsRead, markAllAsRead, deleteNotification, clearAllNotifications, selectedEmployeeFilter, setSelectedEmployeeFilter, personnelList, navigateTo, matrixSettings, updateNotificationMatrix, resetNotificationMatrix, testTriggerNotification]
    );

    return (
        <NotificationContext.Provider
            value={contextValue}
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

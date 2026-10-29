"use client";

import React, { useState, useEffect, useMemo } from "react";
import { writeSafePrintDocument } from "@/frontend/utils/safePrint";
import { uploadSingleFileSmart } from "@/frontend/components/AttachmentPicker";
import {
    ClipboardCheck,
    Calendar,
    ListTodo,
    Database,
    Plus,
    Search,
    Filter,
    Trash2,
    CheckCircle2,
    Clock,
    AlertTriangle,
    TrendingUp,
    User,
    CalendarDays,
    Layers,
    Activity,
    FileText,
    FlaskConical,
    Wrench,
    HeartHandshake,
    PlusCircle,
    FolderPlus,
    ArrowUpRight,
    Lock,
    Settings,
    FileCheck,
    History,
    ChevronLeft,
    ChevronRight,
    Download,
    Send,
    Edit3,
    CheckSquare,
    Eye,
    Upload,
    ShieldAlert,
    Check,
    X,
    Printer,
    Beaker,
    Lightbulb,
    Sparkles,
    CheckCircle,
    Loader2,
    Paperclip,
    RefreshCw
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/backend/services/utils";
import { isLegacyMockAppTask } from "@/frontend/utils/legacyMockData";
import { Modal } from "@/frontend/components/Modal";
import { useNotification } from "@/frontend/contexts/NotificationContext";
import { useAuth } from "@/frontend/contexts/AuthContext";
import * as XLSX from "xlsx";
import { getMesApiBase } from "@/frontend/utils/mesApi";
import { ApplicationEvaluationAnalytics } from "./ApplicationEvaluationAnalytics";
import { CustomerEquipmentService } from "./CustomerEquipmentService";
import { AttachmentPicker, type Attachment } from "./AttachmentPicker";
import { TechCareLog } from "./TechCareLog";
import { todayVN, toVNDateString } from "@/backend/services/dates";
import { DateInputVN } from "@/frontend/components/DateInputVN";

// Allowed roles for access control
const ALLOWED_ROLES = ["admin", "director", "vice_director", "manager", "head", "lead", "leader", "app_head", "app_deputy", "app_tech", "app_rep", "application", "engineer", "kỹ thuật", "ứng dụng", "giám đốc", "phó giám đốc", "quản lý", "trưởng phòng", "chuyên viên", "nhân viên"];

const DAYS_OF_WEEK = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
const TIME_SLOTS = [
    "08:00 - 10:00 (Ca sáng 1)",
    "10:00 - 12:00 (Ca sáng 2)",
    "08:00 - 12:00 (Cả buổi sáng)",
    "13:30 - 15:30 (Ca chiều 1)",
    "15:30 - 17:30 (Ca chiều 2)",
    "13:30 - 17:30 (Cả buổi chiều)",
    "Cả ngày (08:00 - 17:30)",
    "Tự nhập khoảng thời gian (Khác)"
];

const PREDEFINED_PROJECTS = [
    "Đánh giá chất lượng Kit chẩn đoán SARS-CoV-2/Flu A/Flu B",
    "Thử nghiệm lâm sàng dòng sản phẩm Kit PCR HPV",
    "Đánh giá hiệu chuẩn định kỳ hệ thống Real-time PCR",
    "Hoạt động thử nghiệm chung phòng Application"
];

// Helper to get dates range for weeks in 2026
function getWeekDateRangeStr(weekNum: number, year: number = 2026): string {
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
    return `${formatStr(startDate)} - ${formatStr(endDate)}`;
}

function getCurrentWeekNumber(): number {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return weekNo;
}


/**
 * Links an Application task to the Sales request that created it. Tasks created by Sales carry
 * `salesReqId`; older tasks are matched only by the request code or the exact title Sales generated.
 * (Matching on partial titles linked/updated/deleted unrelated tasks with similar titles.)
 */
const taskMatchesSalesRequest = (t: any, sr: any): boolean => {
    if (!t || !sr) return false;
    if (t.salesReqId) return t.salesReqId === sr.id;
    if (!t.title) return false;
    if (sr.id && t.title.includes(sr.id)) return true;
    return Boolean(sr.customerName && sr.title && t.title === `[Sales - ${sr.customerName}] ${sr.title}`);
};

export function ApplicationFullABT() {
    const { showToast, notifyActivity } = useNotification();
    // Kết quả lưu nền lên máy chủ: báo lỗi cho người dùng thay vì bỏ qua im lặng
    const onSaveResult = (label: string) => async (res: Response) => {
      if (res.ok) return;
      const err = await res.json().catch(() => ({}));
      console.error(`[application] Lưu "${label}" thất bại:`, res.status, err);
      showToast(`Chưa lưu được dữ liệu (${label}) lên máy chủ: ${err?.error || `lỗi ${res.status}`}. Vui lòng tải lại trang và thử lại.`, "error");
    };
    const onSaveError = (label: string) => (err: any) => {
      console.error(`[application] Mất kết nối khi lưu "${label}":`, err);
      showToast(`Mất kết nối khi lưu dữ liệu (${label}). Thay đổi có thể chưa được lưu.`, "error");
    };
    const { user, can } = useAuth();
    
    // Tab states: Customer Service (FSE), Lab Resources, Customer Issues, Weekly Planner, Tasks
    const [activeTab, setActiveTab] = useState<"service" | "techcare" | "resources" | "issues" | "planner" | "tasks" | "daily" | "workload">("service");
    const [resourceSubTab, setResourceSubTab] = useState<"equipment" | "materials" | "samples">("equipment");
    
    // Customer Issue Workflow States
    const [customerIssues, setCustomerIssues] = useState<any[]>([]);
    const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
    const [searchIssueQuery, setSearchIssueQuery] = useState("");
    const [filterIssueStatus, setFilterIssueStatus] = useState("Tất cả");
    const [filterIssueProduct, setFilterIssueProduct] = useState("Tất cả");
    const [filterIssueCustomer, setFilterIssueCustomer] = useState("Tất cả");
    const [filterIssueStartDate, setFilterIssueStartDate] = useState("");
    const [filterIssueEndDate, setFilterIssueEndDate] = useState("");
    const [activeViewedStep, setActiveViewedStep] = useState<string | null>(null);

    const saveIssues = (updated: any[]) => {
        setCustomerIssues(updated);
        localStorage.setItem("lab_app_customer_issues", JSON.stringify(updated));
    };

    const [isSyncingIncidents, setIsSyncingIncidents] = useState(false);

    const fetchCustomerIncidentsFromApi = async (isManual = false) => {
        setIsSyncingIncidents(true);
        try {
            const res = await fetch("/api/portal/customer?action=list_incidents");
            const data = await res.json();
            if (res.ok && data.success && Array.isArray(data.incidents)) {
                const dbMapped = data.incidents.map((inc: any) => {
                    let attList: any[] = [];
                    try {
                        attList = Array.isArray(inc.attachments) ? inc.attachments : (typeof inc.attachments === "string" ? JSON.parse(inc.attachments) : []);
                    } catch(e) {}

                    let rcaData: any = {};
                    try {
                        rcaData = typeof inc.root_cause_data === "object" && inc.root_cause_data ? inc.root_cause_data : (typeof inc.root_cause_data === "string" ? JSON.parse(inc.root_cause_data) : {});
                    } catch(e) {}

                    let catList: any[] = [];
                    try {
                        catList = Array.isArray(inc.incident_categories) ? inc.incident_categories : (typeof inc.incident_categories === "string" ? JSON.parse(inc.incident_categories) : [inc.incident_category]);
                    } catch(e) {}

                    const step = inc.current_step || (inc.status === "RESOLVED" ? "Completed" : (inc.status === "CLOSED_NOT_ISSUE" ? "Completed" : "Step1"));
                    const resStatus = inc.resolution_status || (inc.status === "RESOLVED" ? "Resolved" : (inc.status === "CLOSED_NOT_ISSUE" ? "Not an issue" : "Investigating"));

                    return {
                        id: inc.incident_code,
                        dbId: inc.id,
                        isCustomerPortal: true,
                        createdAt: inc.created_at ? toVNDateString(new Date(inc.created_at)) : todayVN(),
                        createdBy: inc.handled_by || inc.customer_name || "Cổng Khách Hàng",
                        status: step,
                        resolutionStatus: resStatus,
                        productCode: inc.product_code || "BIO-KIT",
                        productName: inc.product_name || "Sinh phẩm IVD",
                        lotNumber: inc.lot_number || "LOT-CHUA-RO",
                        description: inc.description || "",
                        customerName: inc.customer_name || "Khách hàng",
                        contactInfo: inc.customer_phone ? `${inc.customer_phone}${inc.customer_email ? " - " + inc.customer_email : ""}` : "",
                        hospitalName: inc.organization || inc.customer_name || "",
                        orderCode: inc.order_code || "",
                        severity: inc.severity || "MEDIUM",
                        patientImpact: inc.patient_impact || "NO_IMPACT",
                        instrumentModel: inc.instrument_model || "",
                        affectedTests: inc.affected_tests || 1,
                        attachments: attList,
                        rootCauseData: rcaData,
                        incidentCategories: catList,
                        isRealIssue: resStatus === "Not an issue" ? false : (step !== "Step1" ? true : null),
                        notRealIssueReason: inc.not_real_issue_reason || "",
                        emergencySolution: "",
                        concludedRootCause: inc.root_cause_conclusion || "",
                        finalCustomerSolution: inc.final_customer_solution || "",
                        correctiveActions: inc.corrective_actions || "",
                        preventiveActions: inc.preventive_actions || "",
                        investigationDetails: typeof inc.investigation_details === "object" && inc.investigation_details ? inc.investigation_details : {}
                    };
                });

                setCustomerIssues(prev => {
                    const localOnly = prev.filter(p => !dbMapped.some((d: any) => d.id === p.id));
                    const combined = [...dbMapped, ...localOnly];
                    localStorage.setItem("lab_app_customer_issues", JSON.stringify(combined));
                    return combined;
                });

                if (dbMapped.length > 0 && !selectedIssueId) {
                    setSelectedIssueId(dbMapped[0].id);
                }

                if (isManual) {
                    showToast(`Đã đồng bộ thành công ${data.incidents.length} phiếu sự cố từ Cổng Khách Hàng!`, "success");
                }
            }
        } catch (e) {
            console.error("fetchCustomerIncidentsFromApi error:", e);
            if (isManual) {
                showToast("Lỗi khi tải dữ liệu từ Cổng Khách Hàng", "error");
            }
        } finally {
            setIsSyncingIncidents(false);
        }
    };

    const syncIncidentToBackend = async (issue: any) => {
        try {
            let status = "INVESTIGATING";
            if (issue.status === "Completed") {
                status = issue.resolutionStatus === "Not an issue" ? "CLOSED_NOT_ISSUE" : "RESOLVED";
            } else if (issue.status === "Step1") {
                status = "RECEIVED";
            }

            let compositeCapa = "";
            if (issue.correctiveActions || issue.preventiveActions || issue.finalCustomerSolution) {
                compositeCapa = [
                    issue.finalCustomerSolution ? `Giải pháp khách hàng: ${issue.finalCustomerSolution}` : "",
                    issue.correctiveActions ? `Biện pháp khắc phục (Corrective): ${issue.correctiveActions}` : "",
                    issue.preventiveActions ? `Biện pháp phòng ngừa (Preventive): ${issue.preventiveActions}` : ""
                ].filter(Boolean).join("\n\n");
            }

            await fetch("/api/portal/customer?action=sync_incident_status", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    incident_code: issue.id,
                    status: status,
                    current_step: issue.status,
                    resolution_status: issue.resolutionStatus || "Investigating",
                    handled_by: user?.name || "Chuyên viên Application",
                    root_cause_conclusion: issue.experimentConclusion || issue.concludedRootCause || "",
                    final_customer_solution: issue.finalCustomerSolution || "",
                    corrective_actions: issue.correctiveActions || "",
                    preventive_actions: issue.preventiveActions || "",
                    not_real_issue_reason: issue.notRealIssueReason || "",
                    investigation_details: issue.investigationDetails || {},
                    capa_action: compositeCapa,
                    attachments: Array.isArray(issue.attachments) ? issue.attachments : undefined
                })
            });
        } catch (e) {
            console.error("Failed to sync incident to backend:", e);
        }
    };

    useEffect(() => {
        if (selectedIssueId) {
            const activeIssue = customerIssues.find(iss => iss.id === selectedIssueId);
            if (activeIssue) {
                setActiveViewedStep(activeIssue.status);
            }
        } else {
            setActiveViewedStep(null);
        }
    }, [selectedIssueId]);
    
    // Mounted & Permission State
    const [hasAccess, setHasAccess] = useState(false);
    const [isMounted, setIsMounted] = useState(false);

    // Active selectors (Planner & Task board)
    const [selectedWeek, setSelectedWeek] = useState<number>(() => getCurrentWeekNumber());
    const [selectedEmployee, setSelectedEmployee] = useState<string>("");

    // Data States
    const [plans, setPlans] = useState<any[]>([]);
    const [tasks, setTasks] = useState<any[]>([]);
    const [equipment, setEquipment] = useState<any[]>([]);
    const [bookings, setBookings] = useState<any[]>([]);
    const [materials, setMaterials] = useState<any[]>([]);
    const [samples, setSamples] = useState<any[]>([]);
    const [labMembers, setLabMembers] = useState<any[]>([]);
    const [dailyLogs, setDailyLogs] = useState<Record<string, any>>({});
    const [quickResults, setQuickResults] = useState<Record<string, string>>({});
    const [selectedDailyDay, setSelectedDailyDay] = useState<string>("Tất cả");

    // Search & filters
    const [sampleSearchQuery, setSampleSearchQuery] = useState("");
    const [sampleCategoryFilter, setSampleCategoryFilter] = useState("Tất Cả");
    const [sampleQcFilter, setSampleQcFilter] = useState("Tất Cả");
    const [taskFilterCategory, setTaskFilterCategory] = useState("all");

    // Modal Control States
    const [isPlanItemModalOpen, setIsPlanItemModalOpen] = useState(false);
    const [isTaskDetailModalOpen, setIsTaskDetailModalOpen] = useState(false);
    const [isTaskCreateModalOpen, setIsTaskCreateModalOpen] = useState(false);
    const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
    const [isMaterialModalOpen, setIsMaterialModalOpen] = useState(false);
    const [materialItemCode, setMaterialItemCode] = useState("");
    const [materialSearchQuery, setMaterialSearchQuery] = useState("");
    const [isMaterialDropdownOpen, setIsMaterialDropdownOpen] = useState(false);
    const [materialMasterItems, setMaterialMasterItems] = useState<any[]>([]);

    const fetchMaterialMasterItems = async () => {
        try {
            const apiBase = getMesApiBase();
            if (!apiBase) {
                const res = await fetch("/api/inventory?action=overview");
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data?.products)) {
                        setMaterialMasterItems(
                            data.products.map((p: any) => ({
                                item_code: p.code,
                                item_name: p.name,
                                unit_of_measure: p.unit || "Hộp",
                                category: p.category || "Hóa chất"
                            }))
                        );
                    }
                }
                return;
            }
            const response = await fetch(`${apiBase}/api/v1/items/`);
            if (response.ok) {
                const data = await response.json();
                setMaterialMasterItems(
                    data.filter(
                        (item: any) =>
                            item.item_type === "raw_material" ||
                            item.category === "raw_material" ||
                            item.category === "chemical"
                    )
                );
            }
        } catch (err) {
            console.error("Error loading master items:", err);
        }
    };
    const [isSampleModalOpen, setIsSampleModalOpen] = useState(false);
    const [isSampleDetailModalOpen, setIsSampleDetailModalOpen] = useState(false);
    const [isProliferateModalOpen, setIsProliferateModalOpen] = useState(false);
    const [isConsumeModalOpen, setIsConsumeModalOpen] = useState(false);

    // Forms: Customer Issues / Quality Complaints
    const [newIssueProductCode, setNewIssueProductCode] = useState("");
    const [newIssueProductName, setNewIssueProductName] = useState("");
    const [newIssueLotNumber, setNewIssueLotNumber] = useState("");
    const [newIssueCustomerName, setNewIssueCustomerName] = useState("");
    const [newIssueContactInfo, setNewIssueContactInfo] = useState("");
    const [newIssueDesc, setNewIssueDesc] = useState("");
    const [newPredictedCauseText, setNewPredictedCauseText] = useState("");
    const [newChecklistItemText, setNewChecklistItemText] = useState("");
    const [guidebookActiveTab, setGuidebookActiveTab] = useState("productKit");
    const [isCreateIssueModalOpen, setIsCreateIssueModalOpen] = useState(false);
    // Master Catalogs for Linked Search & Auto-Fill in Customer Incident
    const [catalogProducts, setCatalogProducts] = useState<any[]>([]);
    const [catalogInventory, setCatalogInventory] = useState<any[]>([]);
    const [catalogCustomers, setCatalogCustomers] = useState<any[]>([]);
    const [isProductDropdownOpen, setIsProductDropdownOpen] = useState(false);
    const [isLotDropdownOpen, setIsLotDropdownOpen] = useState(false);
    const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState(false);
    const [isLoadingCatalogs, setIsLoadingCatalogs] = useState(false);

    const fetchMasterCatalogs = async () => {
        setIsLoadingCatalogs(true);
        try {
            const res = await fetch("/api/inventory?action=overview");
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.products) && data.products.length > 0) {
                    setCatalogProducts(data.products);
                }
                if (Array.isArray(data.items) && data.items.length > 0) {
                    setCatalogInventory(data.items);
                }
                if (Array.isArray(data.customers) && data.customers.length > 0) {
                    setCatalogCustomers(data.customers);
                }
            }
        } catch (err) {
            console.error("Error loading master catalogs from inventory:", err);
        }

        try {
            const salesRes = await fetch("/api/sales?action=overview");
            if (salesRes.ok) {
                const sData = await salesRes.json();
                if (Array.isArray(sData.products) && sData.products.length > 0) {
                    setCatalogProducts(prev => prev.length > 0 ? prev : sData.products);
                }
                if (Array.isArray(sData.customers) && sData.customers.length > 0) {
                    setCatalogCustomers(prev => prev.length > 0 ? prev : sData.customers);
                }
            }
        } catch (err) {
            console.error("Error loading master catalogs from sales:", err);
        } finally {
            setIsLoadingCatalogs(false);
        }
    };

    useEffect(() => {
        fetchMasterCatalogs();
    }, []);

    useEffect(() => {
        if (isCreateIssueModalOpen) {
            fetchMasterCatalogs();
        }
    }, [isCreateIssueModalOpen]);

    // Available lots derived from selected product code
    const availableLotsForProduct = useMemo(() => {
        const prodCode = newIssueProductCode.trim().toLowerCase();
        let matched = catalogInventory.filter((item: any) => {
            const itemCode = String(item.product_code || "").trim().toLowerCase();
            return item.lot_number && (prodCode ? itemCode === prodCode : true);
        });

        if (matched.length === 0 && prodCode) {
            matched = catalogInventory.filter((item: any) => {
                const itemCode = String(item.product_code || "").trim().toLowerCase();
                return item.lot_number && (itemCode.includes(prodCode) || prodCode.includes(itemCode));
            });
        }

        const uniqueMap = new Map<string, any>();
        matched.forEach((item: any) => {
            const lotKey = String(item.lot_number).trim();
            if (lotKey && !uniqueMap.has(lotKey.toLowerCase())) {
                uniqueMap.set(lotKey.toLowerCase(), {
                    lot_number: lotKey,
                    expiration_date: item.expiration_date || item.expiry_date || "",
                    quantity: item.quantity ?? item.stock_quantity ?? item.current_stock,
                    product_code: item.product_code || ""
                });
            }
        });

        customerIssues.forEach((ci: any) => {
            const ciCode = String(ci.productCode || "").trim().toLowerCase();
            const ciLot = String(ci.lotNumber || "").trim();
            if (ciLot && (prodCode ? ciCode === prodCode : true) && !uniqueMap.has(ciLot.toLowerCase())) {
                uniqueMap.set(ciLot.toLowerCase(), {
                    lot_number: ciLot,
                    expiration_date: "",
                    quantity: null,
                    product_code: ci.productCode || ""
                });
            }
        });

        return Array.from(uniqueMap.values());
    }, [catalogInventory, customerIssues, newIssueProductCode]);

    const filteredProductsForDropdown = useMemo(() => {
        const q = newIssueProductCode.trim().toLowerCase();
        if (!q) return catalogProducts.slice(0, 30);
        return catalogProducts.filter((p: any) => 
            String(p.code || "").toLowerCase().includes(q) ||
            String(p.name || "").toLowerCase().includes(q) ||
            String(p.category || "").toLowerCase().includes(q)
        ).slice(0, 30);
    }, [catalogProducts, newIssueProductCode]);

    const filteredCustomersForDropdown = useMemo(() => {
        const q = newIssueCustomerName.trim().toLowerCase();
        if (!q) return catalogCustomers.slice(0, 30);
        return catalogCustomers.filter((c: any) =>
            String(c.name || "").toLowerCase().includes(q) ||
            String(c.customer_code || "").toLowerCase().includes(q) ||
            String(c.contact_person || "").toLowerCase().includes(q) ||
            String(c.phone || "").toLowerCase().includes(q)
        ).slice(0, 30);
    }, [catalogCustomers, newIssueCustomerName]);

    const filteredLotsForDropdown = useMemo(() => {
        const q = newIssueLotNumber.trim().toLowerCase();
        if (!q) return availableLotsForProduct;
        return availableLotsForProduct.filter((l: any) =>
            String(l.lot_number || "").toLowerCase().includes(q)
        );
    }, [availableLotsForProduct, newIssueLotNumber]);

    const handleSelectProduct = (p: any) => {
        setNewIssueProductCode(p.code);
        setNewIssueProductName(p.name || "");
        setIsProductDropdownOpen(false);
        setIsLotDropdownOpen(true);
    };

    const handleProductCodeChange = (val: string) => {
        setNewIssueProductCode(val);
        setIsProductDropdownOpen(true);
        const exact = catalogProducts.find(
            (p: any) => String(p.code || "").trim().toLowerCase() === val.trim().toLowerCase()
        );
        if (exact && exact.name) {
            setNewIssueProductName(exact.name);
        }
    };

    const handleSelectLot = (lot: any) => {
        setNewIssueLotNumber(lot.lot_number);
        setIsLotDropdownOpen(false);
    };

    const handleSelectCustomer = (c: any) => {
        setNewIssueCustomerName(c.name);
        const contactParts = [
            c.contact_person ? `Người LH: ${c.contact_person}` : "",
            c.phone ? `SĐT: ${c.phone}` : "",
            c.email ? `Email: ${c.email}` : "",
            c.address ? `Đ/c: ${c.address}` : ""
        ].filter(Boolean);
        setNewIssueContactInfo(contactParts.join(" | ") || c.phone || c.contact_person || "");
        setIsCustomerDropdownOpen(false);
    };

    const handleCustomerNameChange = (val: string) => {
        setNewIssueCustomerName(val);
        setIsCustomerDropdownOpen(true);
        const exact = catalogCustomers.find(
            (c: any) => String(c.name || "").trim().toLowerCase() === val.trim().toLowerCase()
        );
        if (exact) {
            const contactParts = [
                exact.contact_person ? `Người LH: ${exact.contact_person}` : "",
                exact.phone ? `SĐT: ${exact.phone}` : "",
                exact.email ? `Email: ${exact.email}` : ""
            ].filter(Boolean);
            if (contactParts.length > 0) {
                setNewIssueContactInfo(contactParts.join(" | "));
            }
        }
    };

    // Active detail references
    const [activeTaskDetail, setActiveTaskDetail] = useState<any>(null);
    const isProtocolLocked = ["Pending Protocol", "Protocol Approved", "Pending Report", "Report Approved"].includes(activeTaskDetail?.techStatus);
    const isReportLocked = !["Protocol Approved", "Needs Revision Report"].includes(activeTaskDetail?.techStatus);
    const isAllLocked = activeTaskDetail?.techStatus === "Report Approved";
    const [activeSampleDetail, setActiveSampleDetail] = useState<any>(null);

    // Forms: Plan Item
    const [planDay, setPlanDay] = useState("Thứ 2");
    const [planProject, setPlanProject] = useState("");
    const [planTaskName, setPlanTaskName] = useState("");
    const [planTimeSlot, setPlanTimeSlot] = useState(TIME_SLOTS[0]);
    const [planMetric, setPlanMetric] = useState("");
    const [planNotes, setPlanNotes] = useState("");
    const [customTime, setCustomTime] = useState("");
    const [isCustomTaskName, setIsCustomTaskName] = useState(false);

    // Forms: Task Creation
    const [newTaskTitle, setNewTaskTitle] = useState("");
    const [newTaskDesc, setNewTaskDesc] = useState("");
    const [newTaskAssignee, setNewTaskAssignee] = useState("");
    const [newTaskCategory, setNewTaskCategory] = useState("Triển khai/demo sản phẩm");
    const [newTaskPriority, setNewTaskPriority] = useState("Medium");
    const [newTaskDueDate, setNewTaskDueDate] = useState(() => todayVN());

    // Details Modal active sub-tab
    const [detailTab, setDetailTab] = useState<"logs" | "tech">("logs");

    // Forms: Task Technical Specifications / Reports (Editable inside details modal)
    const [detailProductCode, setDetailProductCode] = useState("");
    const [detailProductLot, setDetailProductLot] = useState("");
    const [detailDeviceInfo, setDetailDeviceInfo] = useState("");
    const [detailAssignee, setDetailAssignee] = useState("");
    const [detailObjective, setDetailObjective] = useState("");
    const [detailMaterials, setDetailMaterials] = useState("");
    const [detailSamplePrep, setDetailSamplePrep] = useState("");
    const [detailMethodology, setDetailMethodology] = useState("");
    const [detailResults, setDetailResults] = useState("");
    const [detailConclusion, setDetailConclusion] = useState("");
    const [detailAttachmentUrl, setDetailAttachmentUrl] = useState("");

    // Forms: Equipment Booking
    const [selectedEqId, setSelectedEqId] = useState("");
    const [bookingDate, setBookingDate] = useState("");
    const [bookingTime, setBookingTime] = useState("08:00 - 12:00");
    const [bookingPurpose, setBookingPurpose] = useState("");

    // Forms: Materials Request
    const [materialName, setMaterialName] = useState("");
    const [materialQty, setMaterialQty] = useState(1);
    const [materialUnit, setMaterialUnit] = useState("vial");
    const [materialReason, setMaterialReason] = useState("");

    // Forms: Clinical Sample Create
    const [sampleBarcode, setSampleBarcode] = useState("");
    const [sampleName, setSampleName] = useState("");
    const [sampleCategory, setSampleCategory] = useState("Bệnh phẩm");
    const [sampleTarget, setSampleTarget] = useState("");
    const [sampleConcentration, setSampleConcentration] = useState("");
    const [sampleQty, setSampleQty] = useState(10);
    const [sampleUnit, setSampleUnit] = useState("Ống");
    const [useBatchImport, setUseBatchImport] = useState(false);
    const [batchSpecimensText, setBatchSpecimensText] = useState("");

    // Forms: Add New Equipment
    const [addEqName, setAddEqName] = useState("");
    const [addEqModel, setAddEqModel] = useState("");
    const [addEqSerial, setAddEqSerial] = useState("");
    const [newIssueAttachments, setNewIssueAttachments] = useState<Attachment[]>([]);
    const [addEqLocation, setAddEqLocation] = useState("Phòng Thử Nghiệm App");
    const [isAddEquipmentModalOpen, setIsAddEquipmentModalOpen] = useState(false);

    // Forms: Add New Reagent/Material
    const [addMatName, setAddMatName] = useState("");
    const [addMatCode, setAddMatCode] = useState("");
    const [addMatLot, setAddMatLot] = useState("");
    const [addMatCategory, setAddMatCategory] = useState("Hóa chất PCR");
    const [addMatQty, setAddMatQty] = useState(1);
    const [addMatUnit, setAddMatUnit] = useState("Hộp");
    const [addMatMinQty, setAddMatMinQty] = useState(5);
    const [addMatSupplier, setAddMatSupplier] = useState("");
    const [isCreateMaterialModalOpen, setIsCreateMaterialModalOpen] = useState(false);
    const [sampleTemp, setSampleTemp] = useState("-20°C");
    const [sampleLocation, setSampleLocation] = useState("");
    const [sampleSource, setSampleSource] = useState("");

    // Forms: Sample Actions
    const [actionVolume, setActionVolume] = useState(1);
    const [actionPerformer, setActionPerformer] = useState("");
    const [actionDetails, setActionDetails] = useState("");

    // Forms: Subtask & Task Logs
    const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
    const [newTaskLogResult, setNewTaskLogResult] = useState("");
    const [newTaskLogAttachment, setNewTaskLogAttachment] = useState("");
    const [newTaskLogFileUrl, setNewTaskLogFileUrl] = useState("");
    const [newTaskLogFileSize, setNewTaskLogFileSize] = useState("");
    const [isUploadingLogFile, setIsUploadingLogFile] = useState(false);
    // Admin state permission check
    const isAdmin = useMemo(() => {
        if (!user) return false;
        const normRole = (user.role || "").toLowerCase().trim();
        return normRole.includes("admin") || normRole === "admin";
    }, [user]);

    // Forms: Edit Equipment (Admin only)
    const [isEditEqModalOpen, setIsEditEqModalOpen] = useState(false);
    const [editEqId, setEditEqId] = useState("");
    const [editEqName, setEditEqName] = useState("");
    const [editEqModel, setEditEqModel] = useState("");
    const [editEqLocation, setEditEqLocation] = useState("");
    const [editEqStatus, setEditEqStatus] = useState("");
    const [editEqSerial, setEditEqSerial] = useState("");

    // Forms: Edit Material (Admin only)
    const [isEditMatModalOpen, setIsEditMatModalOpen] = useState(false);
    const [editMatId, setEditMatId] = useState<string | number>("");
    const [editMatName, setEditMatName] = useState("");
    const [editMatCode, setEditMatCode] = useState("");
    const [editMatLot, setEditMatLot] = useState("");
    const [editMatCategory, setEditMatCategory] = useState("");
    const [editMatQty, setEditMatQty] = useState(0);
    const [editMatUnit, setEditMatUnit] = useState("");
    const [editMatMinQty, setEditMatMinQty] = useState(5);
    const [editMatSupplier, setEditMatSupplier] = useState("");

    // Forms: Direct Material Export/Consume
    const [isDirectExportModalOpen, setIsDirectExportModalOpen] = useState(false);
    const [exportMatId, setExportMatId] = useState<string | number>("");
    const [exportMatName, setExportMatName] = useState("");
    const [exportMatStock, setExportMatStock] = useState(0);
    const [exportMatUnit, setExportMatUnit] = useState("");
    const [exportMatQty, setExportMatQty] = useState(1);
    const [exportMatPerformer, setExportMatPerformer] = useState("");
    const [exportMatReason, setExportMatReason] = useState("");

    // Resolve Manager status
    const isManager = useMemo(() => {
        if (!user) return false;
        if (can && (can("application.approve") || can("application.assign"))) return true;
        if (user.permissions && Boolean((user.permissions as any)["application.approve"] || (user.permissions as any)["application.assign"])) return true;
        const normRole = (user.role || "").toLowerCase().trim();
        const normDept = (user.department || "").toLowerCase().trim();
        const managerKeywords = ["admin", "quản lý", "manager", "giám đốc", "director", "head", "deputy", "trưởng phòng", "phó trưởng phòng", "chủ nhiệm", "trưởng nhóm", "team leader", "tổ trưởng", "app_head"];
        return managerKeywords.some(k => normRole.includes(k) || normDept.includes(k) || normRole === "giám đốc" || normRole === "phó giám đốc");
    }, [user, can]);

    // Initial mount check
    useEffect(() => {
        setIsMounted(true);
        if (user) {
            const roleLower = (user.role || "").toLowerCase().trim();
            const deptLower = (user.department || "").toLowerCase().trim();
            
            // Allow if user has PBAC permission, OR belongs to Application/Kỹ thuật department/role, OR is admin/director/manager
            const hasExplicitPerm = Boolean(can && can("application.view")) || Boolean(user.permissions && Boolean((user.permissions as any)["application.view"]));
            const isDeptMatched = 
                deptLower.includes("application") || 
                deptLower.includes("app") || 
                deptLower.includes("ứng dụng") || 
                deptLower.includes("kỹ thuật") ||
                deptLower === "phòng application";
            const isRoleMatched = 
                roleLower.includes("application") ||
                roleLower.includes("ứng dụng") ||
                roleLower.includes("kỹ thuật") ||
                roleLower.includes("admin") || 
                roleLower.includes("director") || 
                roleLower.includes("giám đốc") || 
                roleLower.includes("quản lý") ||
                roleLower.includes("manager") ||
                ALLOWED_ROLES.some(r => roleLower.includes(r));

            const isAllowed = hasExplicitPerm || isDeptMatched || isRoleMatched;
            
            setHasAccess(isAllowed);
            
            // Resolve if manager/admin
            setSelectedEmployee(isManager ? "Tất cả" : (user.name || "Nhân viên"));
        } else {
            setHasAccess(true);
        }
    }, [user, can, isManager]);

    // Seed/Load database
    useEffect(() => {
        if (!isMounted) return;

        const isProduction = typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1";

        // 1. Load plans from server first, fallback to local
        const storedPlans = localStorage.getItem("lab_app_plans");
        if (storedPlans !== null) {
            try {
                setPlans(JSON.parse(storedPlans));
            } catch (e) {
                setPlans([]);
            }
        }
        fetch("/api/storage?key=lab_app_plans")
            .then(res => res.ok ? res.json() : null)
            .then(resData => {
                if (resData && Array.isArray(resData.data) && resData.data.length > 0) {
                    setPlans(resData.data);
                    if (typeof window !== "undefined") {
                        localStorage.setItem("lab_app_plans", JSON.stringify(resData.data));
                    }
                }
            })
            .catch(() => {});

        // 2. Load Tasks & Merge Cross-Department Requests from Sales
        const storedTasks = localStorage.getItem("lab_app_tasks");
        let initialTasks: any[] = [];
        if (storedTasks !== null) {
            try {
                const parsed = JSON.parse(storedTasks);
                if (Array.isArray(parsed)) {
                    initialTasks = parsed.filter((t: any) => !isLegacyMockAppTask(t));
                }
            } catch (e) {
                initialTasks = [];
            }
        }

        // Merge from shared_app_requests (from Sales Tab)
        try {
            let sharedReqs: any[] = [];
            const storedSharedReqs = localStorage.getItem("shared_app_requests");
            if (storedSharedReqs !== null) {
                try {
                    const parsed = JSON.parse(storedSharedReqs);
                    if (Array.isArray(parsed)) {
                        sharedReqs = parsed.filter((r: any) => !isLegacyMockAppTask(r));
                        if (sharedReqs.length !== parsed.length) {
                            localStorage.setItem("shared_app_requests", JSON.stringify(sharedReqs));
                            fetch("/api/storage?key=shared_app_requests", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify(sharedReqs)
                            }).then(onSaveResult("shared_app_requests")).catch(onSaveError("shared_app_requests"));
                        }
                    }
                } catch (e) {}
            }

            const categoryMap: Record<string, string> = {
                COMPLAINT_HANDLING: "Tiếp nhận khiếu nại & Xử lý sự cố",
                MAINTENANCE_REPAIR: "Bảo trì/sửa chữa thiết bị (bao gồm nội bộ và cho khách hàng)",
                LAB_SETUP: "Tư vấn Setup lab & Quy trình",
                ACCEPTANCE_TRAINING: "Nghiệm thu / Đào tạo sản phẩm",
                VALIDATION: "Thử nghiệm đánh giá chất lượng sản phẩm",
                DEMO: "Triển khai/demo sản phẩm",
                PROTOCOL: "Công việc khác",
                OTHER: "Công việc khác"
            };

            sharedReqs.forEach((sr: any) => {
                const existingIdx = initialTasks.findIndex((t: any) => taskMatchesSalesRequest(t, sr));
                const taskStatus = sr.status === "COMPLETED" ? "Hoàn thành" : (sr.status === "IN_PROGRESS" || sr.status === "REPORT_READY") ? "Đang thực hiện" : "Chưa bắt đầu";
                const taskAssignee = sr.appAssignee || "Chưa phân công";

                if (existingIdx >= 0) {
                    initialTasks[existingIdx] = {
                        ...initialTasks[existingIdx],
                        status: taskStatus,
                        assignee: taskAssignee,
                        category: categoryMap[sr.supportType] || initialTasks[existingIdx].category,
                        dueDate: sr.dueDate || initialTasks[existingIdx].dueDate,
                        salesCustomerName: sr.customerName || initialTasks[existingIdx].salesCustomerName
                    };
                } else {
                    let dynamicChecklist: any[] = [];
                    if (sr.supportType === "ACCEPTANCE_TRAINING") {
                        dynamicChecklist = [
                            { id: "c1", title: "Khảo sát hiện trường & Chuẩn bị tài liệu đào tạo / User Guide", done: true },
                            { id: "c2", title: "Đào tạo lý thuyết & Hướng dẫn thực hành cho KTV khách hàng", done: sr.status === "IN_PROGRESS" || sr.status === "REPORT_READY" || sr.status === "COMPLETED" },
                            { id: "c3", title: "Chạy đối chứng mẫu chuẩn nghiệm thu kỹ thuật", done: sr.status === "REPORT_READY" || sr.status === "COMPLETED" },
                            { id: "c4", title: "Ký Biên bản Nghiệm thu & Bàn giao sản phẩm", done: sr.status === "COMPLETED" }
                        ];
                    } else if (sr.supportType === "LAB_SETUP") {
                        dynamicChecklist = [
                            { id: "c1", title: "Khảo sát mặt bằng & Nhu cầu xét nghiệm của phòng Lab", done: true },
                            { id: "c2", title: "Tư vấn danh mục thiết bị, hóa chất & vật tư chuẩn 1 chiều", done: sr.status === "IN_PROGRESS" || sr.status === "REPORT_READY" || sr.status === "COMPLETED" },
                            { id: "c3", title: "Lên bản vẽ Layout phân khu chức năng & Xây dựng SOP", done: sr.status === "REPORT_READY" || sr.status === "COMPLETED" },
                            { id: "c4", title: "Đào tạo nhân sự vận hành phòng Lab & Bàn giao hồ sơ", done: sr.status === "COMPLETED" }
                        ];
                    } else if (sr.supportType === "COMPLAINT_HANDLING") {
                        dynamicChecklist = [
                            { id: "c1", title: "Tiếp nhận thông tin sự cố, mẫu bệnh phẩm & Lô kit lỗi từ Sales", done: true },
                            { id: "c2", title: "Kiểm tra lô kit lưu đối chứng tại Lab & Phân tích Log máy", done: sr.status === "IN_PROGRESS" || sr.status === "REPORT_READY" || sr.status === "COMPLETED" },
                            { id: "c3", title: "Thực hiện thử nghiệm truy tìm nguyên nhân cốt lõi (Root Cause)", done: sr.status === "REPORT_READY" || sr.status === "COMPLETED" },
                            { id: "c4", title: "Xuất Báo cáo phản hồi khiếu nại (CAPA Report) gửi khách hàng", done: sr.status === "COMPLETED" }
                        ];
                    } else if (sr.supportType === "MAINTENANCE_REPAIR") {
                        dynamicChecklist = [
                            { id: "c1", title: "Khảo sát tình trạng thiết bị & Ghi nhận mã lỗi phát sinh", done: true },
                            { id: "c2", title: "Vệ sinh buồng mẫu, hiệu chuẩn hệ thống nhiệt độ & quang học", done: sr.status === "IN_PROGRESS" || sr.status === "REPORT_READY" || sr.status === "COMPLETED" },
                            { id: "c3", title: "Khắc phục lỗi / Thay thế linh kiện phụ tùng đạt chuẩn", done: sr.status === "REPORT_READY" || sr.status === "COMPLETED" },
                            { id: "c4", title: "Chạy test đĩa chuẩn hóa & Xuất Biên bản bảo trì thiết bị", done: sr.status === "COMPLETED" }
                        ];
                    } else {
                        dynamicChecklist = [
                            { id: "c1", title: "Tiếp nhận & xác nhận mẫu từ Sales", done: true },
                            { id: "c2", title: "Soạn thảo Protocol thử nghiệm", done: sr.status === "IN_PROGRESS" || sr.status === "REPORT_READY" || sr.status === "COMPLETED" },
                            { id: "c3", title: "Chạy Demo/Thử nghiệm tại Lab", done: sr.status === "REPORT_READY" || sr.status === "COMPLETED" },
                            { id: "c4", title: "Hoàn tất Báo cáo kỹ thuật (Technical Report)", done: sr.status === "COMPLETED" }
                        ];
                    }

                    initialTasks.unshift({
                        id: Date.now() + Math.floor(Math.random() * 1000),
                        title: `[Sales - ${sr.customerName}] ${sr.title}`,
                        desc: `Yêu cầu từ NVKD ${sr.salesRepName} (${sr.salesRepId}) cho Khách hàng: ${sr.customerName}.\nLoại hình: ${sr.supportTypeLabel || sr.supportType}.\nSản phẩm/Lot: ${sr.productName || sr.productCode} (${sr.productLot || 'N/A'}).\n\nNội dung: ${sr.description}`,
                        assignee: taskAssignee,
                        category: categoryMap[sr.supportType] || "Triển khai/demo sản phẩm",
                        priority: sr.priority === "Urgent" ? "Critical" : (sr.priority || "High"),
                        status: taskStatus,
                        dueDate: sr.dueDate || todayVN(),
                        productLot: sr.productLot || sr.productCode,
                        isFromSales: true,
                        salesReqId: sr.id,
                        salesCustomerName: sr.customerName,
                        salesRepName: sr.salesRepName,
                        supportType: sr.supportType,
                        checklist: dynamicChecklist,
                        logs: [
                            { id: `l_${Date.now()}`, date: sr.requestDate || todayVN(), summary: `Tiếp nhận yêu cầu phối hợp [${sr.supportTypeLabel || sr.supportType}] từ NVKD ${sr.salesRepName} (${sr.customerName})` }
                        ]
                    });
                }
            });
        } catch (e) {
            console.error("Error merging shared_app_requests:", e);
        }

        setTasks(initialTasks);
        localStorage.setItem("lab_app_tasks", JSON.stringify(initialTasks));

        // 3. Load Equipment
        const storedEquipment = localStorage.getItem("lab_app_equipment");
        if (storedEquipment) {
            setEquipment(JSON.parse(storedEquipment));
        } else {
            const seedEquipment: any[] = [];
            setEquipment(seedEquipment);
            localStorage.setItem("lab_app_equipment", JSON.stringify(seedEquipment));
        }

        // 4. Load Bookings
        const storedBookings = localStorage.getItem("lab_app_bookings");
        if (storedBookings) {
            setBookings(JSON.parse(storedBookings));
        } else {
            const seedBookings: any[] = [];
            setBookings(seedBookings);
            localStorage.setItem("lab_app_bookings", JSON.stringify(seedBookings));
        }

        // 5. Load Materials
        const storedMaterials = localStorage.getItem("lab_app_materials");
        if (storedMaterials) {
            setMaterials(JSON.parse(storedMaterials));
        } else {
            const seedMaterials: any[] = [];
            setMaterials(seedMaterials);
            localStorage.setItem("lab_app_materials", JSON.stringify(seedMaterials));
        }

        // 6. Load Samples
        const storedSamples = localStorage.getItem("lab_app_samples");
        if (storedSamples) {
            setSamples(JSON.parse(storedSamples));
        } else {
            const seedSamples: any[] = [];
            setSamples(seedSamples);
            localStorage.setItem("lab_app_samples", JSON.stringify(seedSamples));
        }

        // 7. Load daily logs
        const storedLogs = localStorage.getItem("lab_app_daily_logs");
        if (storedLogs) {
            try {
                const logsMap = JSON.parse(storedLogs);
                setDailyLogs(logsMap);
                const initialResults: Record<string, string> = {};
                Object.keys(logsMap).forEach(k => {
                    initialResults[k] = logsMap[k].result_summary || "";
                });
                setQuickResults(initialResults);
            } catch(e) {}
        }

        // 8. Load customer issues
        const storedIssues = localStorage.getItem("lab_app_customer_issues");
        if (storedIssues) {
            try {
                const parsed = JSON.parse(storedIssues);
                setCustomerIssues(parsed);
                if (parsed.length > 0 && !selectedIssueId) {
                    setSelectedIssueId(parsed[0].id);
                }
            } catch(e) {}
        } else {
            const seedIssues: any[] = [];
            setCustomerIssues(seedIssues);
            if (seedIssues.length > 0) {
                setSelectedIssueId(seedIssues[0].id);
            }
            localStorage.setItem("lab_app_customer_issues", JSON.stringify(seedIssues));
        }

        // Fetch latest incidents directly from PostgreSQL Customer Portal
        fetchCustomerIncidentsFromApi(false);
    }, [isMounted]);

    useEffect(() => {
        if (activeTab === "issues") {
            fetchCustomerIncidentsFromApi(false);
        }
    }, [activeTab]);

    // Realtime sync listener with Sales coordination requests
    useEffect(() => {
        const handleSync = () => {
            try {
                const storedSharedReqs = localStorage.getItem("shared_app_requests");
                if (storedSharedReqs) {
                    const sharedReqs = JSON.parse(storedSharedReqs);
                    if (Array.isArray(sharedReqs)) {
                        const cleanSharedReqs = sharedReqs.filter((sr: any) => !isLegacyMockAppTask(sr));
                        setTasks(prevTasks => {
                            const categoryMap: Record<string, string> = {
                                COMPLAINT_HANDLING: "Tiếp nhận khiếu nại & Xử lý sự cố",
                                MAINTENANCE_REPAIR: "Bảo trì/sửa chữa thiết bị (bao gồm nội bộ và cho khách hàng)",
                                LAB_SETUP: "Tư vấn Setup lab & Quy trình",
                                ACCEPTANCE_TRAINING: "Nghiệm thu / Đào tạo sản phẩm",
                                VALIDATION: "Thử nghiệm đánh giá chất lượng sản phẩm",
                                DEMO: "Triển khai/demo sản phẩm",
                                PROTOCOL: "Công việc khác",
                                OTHER: "Công việc khác"
                            };
                            const updated = prevTasks.filter((t: any) => !isLegacyMockAppTask(t));
                            cleanSharedReqs.forEach((sr: any) => {
                                const idx = updated.findIndex((t: any) => taskMatchesSalesRequest(t, sr));
                                const taskStatus = sr.status === "COMPLETED" ? "Hoàn thành" : (sr.status === "IN_PROGRESS" || sr.status === "REPORT_READY") ? "Đang thực hiện" : "Chưa bắt đầu";
                                const taskAssignee = sr.appAssignee || "Chưa phân công";

                                if (idx >= 0) {
                                    updated[idx] = {
                                        ...updated[idx],
                                        status: taskStatus,
                                        assignee: taskAssignee,
                                        category: categoryMap[sr.supportType] || updated[idx].category,
                                        dueDate: sr.dueDate || updated[idx].dueDate,
                                        salesCustomerName: sr.customerName || updated[idx].salesCustomerName
                                    };
                                } else {
                                    updated.unshift({
                                        id: Date.now() + Math.floor(Math.random() * 1000),
                                        title: `[Sales - ${sr.customerName}] ${sr.title}`,
                                        desc: `Yêu cầu từ NVKD ${sr.salesRepName} (${sr.salesRepId}) cho Khách hàng: ${sr.customerName}.\nLoại hình: ${sr.supportTypeLabel || sr.supportType}.\nSản phẩm/Lot: ${sr.productName || sr.productCode} (${sr.productLot || 'N/A'}).\n\nNội dung: ${sr.description}`,
                                        assignee: taskAssignee,
                                        category: categoryMap[sr.supportType] || "Triển khai/demo sản phẩm",
                                        priority: sr.priority === "Urgent" ? "Critical" : (sr.priority || "High"),
                                        status: taskStatus,
                                        dueDate: sr.dueDate || todayVN(),
                                        productLot: sr.productLot || sr.productCode,
                                        isFromSales: true,
                                        salesReqId: sr.id,
                                        salesCustomerName: sr.customerName,
                                        salesRepName: sr.salesRepName,
                                        supportType: sr.supportType,
                                        checklist: [
                                            { id: "c1", title: "Tiếp nhận & xác nhận yêu cầu từ Sales", done: true },
                                            { id: "c2", title: "Triển khai thực hiện tại Lab hoặc hiện trường", done: sr.status === "IN_PROGRESS" || sr.status === "REPORT_READY" || sr.status === "COMPLETED" },
                                            { id: "c3", title: "Hoàn tất báo cáo kỹ thuật & Biên bản bàn giao", done: sr.status === "COMPLETED" }
                                        ],
                                        logs: [
                                            { id: `l_${Date.now()}`, date: sr.requestDate || todayVN(), summary: `Tiếp nhận yêu cầu phối hợp [${sr.supportTypeLabel || sr.supportType}] từ NVKD ${sr.salesRepName}` }
                                        ]
                                    });
                                }
                            });
                            localStorage.setItem("lab_app_tasks", JSON.stringify(updated));
                            return updated;
                        });
                    }
                }
            } catch(e) {}
        };

        window.addEventListener("storage", handleSync);
        window.addEventListener("shared_app_requests_updated", handleSync);
        return () => {
            window.removeEventListener("storage", handleSync);
            window.removeEventListener("shared_app_requests_updated", handleSync);
        };
    }, []);

    // Sync active task detail fields to form state
    useEffect(() => {
        if (activeTaskDetail) {
            setDetailProductCode(activeTaskDetail.productCode || "");
            setDetailProductLot(activeTaskDetail.productLot || "");
            setDetailDeviceInfo(activeTaskDetail.deviceInfo || "");
            setDetailAssignee(activeTaskDetail.assignee || "");
            setDetailObjective(activeTaskDetail.objective || "");
            
            // Robust parsing of materials to prevent crashes when materials is stored as array/object
            const matsVal = activeTaskDetail.materials;
            const matsStr = typeof matsVal === 'string' 
                ? matsVal 
                : Array.isArray(matsVal) 
                    ? matsVal.map((m: any) => (m && typeof m === 'object') ? `${m.name || m.item_name || ''} (${m.qty || m.quantity || ''} ${m.unit || ''})` : String(m || '')).join(", ") 
                    : "";
            setDetailMaterials(matsStr);
            
            setDetailSamplePrep(activeTaskDetail.samplePrep || "");
            setDetailMethodology(activeTaskDetail.methodology || "");
            setDetailResults(activeTaskDetail.results || "");
            setDetailConclusion(activeTaskDetail.conclusion || "");
            setDetailAttachmentUrl(activeTaskDetail.attachmentUrl || "");
            setDetailTab("logs"); // reset to logs tab when switching tasks
        }
    }, [activeTaskDetail]);

    // Sync and watch lab_members from local storage
    useEffect(() => {
        const loadMembers = () => {
            const stored = localStorage.getItem("lab_members");
            if (stored) {
                try {
                    const parsed = JSON.parse(stored);
                    if (Array.isArray(parsed)) {
                        const filtered = parsed.filter((m: any) => {
                            const dept = (m.department || m.dept || "").toLowerCase().trim();
                            const role = (m.role || m.position || "").toLowerCase().trim();
                            const name = (m.name || "").toLowerCase().trim();
                            
                            // Only include members of Application department
                            if (dept === "application" || dept === "app" || role.includes("application") || role.includes("app")) {
                                return true;
                            }
                                                        return false;
                        });
                        setLabMembers(filtered);
                    } else {
                        setLabMembers([]);
                    }
                } catch(e) {
                    setLabMembers([]);
                }
            }
        };
        loadMembers();
        window.addEventListener("lab_members_synced", loadMembers);
        window.addEventListener("storage", loadMembers);
        return () => {
            window.removeEventListener("lab_members_synced", loadMembers);
            window.removeEventListener("storage", loadMembers);
        };
    }, []);

    // Fetch and sync actual personnel list from MES API at runtime
    useEffect(() => {
        if (!isMounted) return;

        const syncPersonnelFromMes = async () => {
            const apiBase = getMesApiBase();
            if (!apiBase) return;
            try {
                const mesUrl = `${apiBase}/api/v1/personnel/`;
                const res = await fetch(mesUrl);
                if (res.ok) {
                    const rawData = await res.json();
                    if (Array.isArray(rawData)) {
                        const mappedMembers = rawData
                            .filter((p: any) => {
                                if (!p.employee_id || p.employee_id.trim().toLowerCase() === "admin") return false;
                                
                                const dept = (p.department || "").toLowerCase().trim();
                                const role = (p.position || "").toLowerCase().trim();
                                const name = (p.full_name || "").toLowerCase().trim();
                                
                                // Only include members of Application department
                                if (dept === "application" || dept === "app" || role.includes("application") || role.includes("app")) {
                                    return true;
                                }
                                                                return false;
                            })
                            .map((p: any) => ({
                                id: p.employee_id,
                                name: p.full_name,
                                role: p.position,
                                email: p.email || "",
                                department: p.department || "Application",
                                status: p.status || "Active"
                            }));

                        if (mappedMembers.length > 0) {
                            // Merge with existing members to preserve custom local fields like pin, password, phone, linkedMesUserId
                            const stored = localStorage.getItem("lab_members");
                            let existing: any[] = [];
                            if (stored) {
                                try {
                                    existing = JSON.parse(stored);
                                } catch (e) {}
                            }

                            const mergedMembers = mappedMembers.map((newM: any) => {
                                // Find matching existing member by id or email
                                const match = existing.find((oldM: any) => 
                                    oldM.id === newM.id || 
                                    (oldM.email && newM.email && oldM.email.toLowerCase() === newM.email.toLowerCase()) ||
                                    (oldM.name && newM.name && oldM.name.trim().toLowerCase() === newM.name.trim().toLowerCase())
                                );
                                if (match) {
                                    return {
                                        ...newM,
                                        pin: match.pin || newM.pin,
                                        password: match.password || newM.password,
                                        phone: match.phone || newM.phone,
                                        linkedMesUserId: match.linkedMesUserId || newM.linkedMesUserId
                                    };
                                }
                                return newM;
                            });

                            console.log("Application Page: Syncing personnel list from MES (merged):", mergedMembers);
                            localStorage.setItem("lab_members", JSON.stringify(mergedMembers));
                            window.dispatchEvent(new Event("lab_members_synced"));
                        }
                    }
                }
            } catch (err) {
                console.error("Failed to sync personnel from MES API:", err);
            }
        };

        syncPersonnelFromMes();
    }, [isMounted]);

    const handleSaveDailyLog = (item: any, newStatus: "In Progress" | "Completed") => {
        const summary = quickResults[item.id] || "";
        if (!summary.trim() && newStatus === "Completed") {
            showToast("Vui lòng nhập tóm tắt kết quả trước khi hoàn thành", "error");
            return;
        }

        const logEntry = {
            item_id: item.id,
            user_name: selectedEmployee === "Tất cả" ? (item.user_name || "Nhân viên") : selectedEmployee,
            status: newStatus,
            result_summary: summary.trim(),
            logged_at: new Date().toLocaleTimeString("sv-SE").substring(0, 5) + " " + new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
        };

        const updatedLogs = {
            ...dailyLogs,
            [item.id]: logEntry
        };

        setDailyLogs(updatedLogs);
        localStorage.setItem("lab_app_daily_logs", JSON.stringify(updatedLogs));
        showToast(newStatus === "Completed" ? "Đã ghi nhận HOÀN THÀNH công việc!" : "Đã cập nhật kết quả!", "success");
    };

    const handleSaveTaskTechSpec = (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeTaskDetail) return;

        const updatedTasks = tasks.map(t => {
            if (t.id === activeTaskDetail.id) {
                const updatedTask = {
                    ...t,
                    productCode: detailProductCode,
                    productLot: detailProductLot,
                    deviceInfo: detailDeviceInfo,
                    assignee: detailAssignee,
                    objective: detailObjective,
                    materials: detailMaterials,
                    samplePrep: detailSamplePrep,
                    methodology: detailMethodology,
                    results: detailResults,
                    conclusion: detailConclusion,
                    attachmentUrl: detailAttachmentUrl
                };
                setActiveTaskDetail(updatedTask);
                return updatedTask;
            }
            return t;
        });

        // Two-way sync to shared_app_requests for Sales tab
        if (activeTaskDetail.isFromSales || activeTaskDetail.salesReqId) {
            try {
                const storedReqs = localStorage.getItem("shared_app_requests");
                if (storedReqs) {
                    const reqs = JSON.parse(storedReqs);
                    const updatedReqs = reqs.map((r: any) => {
                        if (r.id === activeTaskDetail.salesReqId || r.customerName === activeTaskDetail.salesCustomerName) {
                            return {
                                ...r,
                                protocolTitle: detailMethodology ? "Protocol kiểm nghiệm chuyên môn phòng App" : r.protocolTitle,
                                testResultSummary: detailResults || detailConclusion || r.testResultSummary,
                                testReportFile: detailAttachmentUrl || r.testReportFile || `Bao_cao_ky_thuat_${r.id}.pdf`,
                                testReportTitle: `Báo cáo kỹ thuật: ${activeTaskDetail.title}`,
                                appAssignee: detailAssignee || r.appAssignee,
                                status: (detailResults || detailConclusion) ? "REPORT_READY" : r.status,
                                statusLabel: (detailResults || detailConclusion) ? "Đã có báo cáo kỹ thuật" : r.statusLabel
                            };
                        }
                        return r;
                    });
                    localStorage.setItem("shared_app_requests", JSON.stringify(updatedReqs));
                    window.dispatchEvent(new Event("storage"));
                }
            } catch (e) {
                console.error("Error syncing tech spec to shared_app_requests:", e);
            }
        }

        setTasks(updatedTasks);
        localStorage.setItem("lab_app_tasks", JSON.stringify(updatedTasks));
        showToast("Đã lưu hồ sơ chuyên môn & đồng bộ sang Phân hệ Kinh doanh!", "success");
    };

    const handleSubmitProtocolForApproval = () => {
        if (!activeTaskDetail) return;
        const updatedTasks = tasks.map(t => {
            if (t.id === activeTaskDetail.id) {
                const updatedTask = {
                    ...t,
                    techStatus: "Pending Protocol"
                };
                setActiveTaskDetail(updatedTask);
                return updatedTask;
            }
            return t;
        });
        setTasks(updatedTasks);
        localStorage.setItem("lab_app_tasks", JSON.stringify(updatedTasks));
        showToast("Đã gửi phê duyệt Đề cương/Phương pháp thực hiện!", "success");
    };

    const handleApproveProtocol = () => {
        if (!activeTaskDetail) return;
        const updatedTasks = tasks.map(t => {
            if (t.id === activeTaskDetail.id) {
                const updatedTask = {
                    ...t,
                    techStatus: "Protocol Approved",
                    techApprovedBy: user?.name || "Trưởng phòng App",
                    techFeedback: null
                };
                setActiveTaskDetail(updatedTask);
                return updatedTask;
            }
            return t;
        });
        setTasks(updatedTasks);
        localStorage.setItem("lab_app_tasks", JSON.stringify(updatedTasks));
        showToast("Đã phê duyệt Đề cương/Phương pháp thành công! Nhân viên có thể tiến hành nhập kết quả.", "success");
    };

    const handleRejectProtocol = () => {
        if (!activeTaskDetail) return;
        const feedback = prompt("Nhập ý kiến chỉ đạo / yêu cầu hiệu chỉnh Đề cương:");
        if (feedback === null) return;

        const updatedTasks = tasks.map(t => {
            if (t.id === activeTaskDetail.id) {
                const updatedTask = {
                    ...t,
                    techStatus: "Needs Revision Protocol",
                    techFeedback: feedback || "Cần điều chỉnh phương pháp/nguyên vật liệu."
                };
                setActiveTaskDetail(updatedTask);
                return updatedTask;
            }
            return t;
        });
        setTasks(updatedTasks);
        localStorage.setItem("lab_app_tasks", JSON.stringify(updatedTasks));
        showToast("Đã yêu cầu hiệu chỉnh Đề cương phương pháp!", "warning");
    };

    const handleSubmitReportForApproval = () => {
        if (!activeTaskDetail) return;
        const updatedTasks = tasks.map(t => {
            if (t.id === activeTaskDetail.id) {
                const updatedTask = {
                    ...t,
                    techStatus: "Pending Report"
                };
                setActiveTaskDetail(updatedTask);
                return updatedTask;
            }
            return t;
        });
        setTasks(updatedTasks);
        localStorage.setItem("lab_app_tasks", JSON.stringify(updatedTasks));
        showToast("Đã gửi phê duyệt Báo cáo Kết quả & Kết luận!", "success");
    };

    const handleApproveReport = () => {
        if (!activeTaskDetail) return;
        const updatedTasks = tasks.map(t => {
            if (t.id === activeTaskDetail.id) {
                const updatedTask = {
                    ...t,
                    techStatus: "Report Approved",
                    techReportApprovedBy: user?.name || "Trưởng phòng App",
                    techFeedback: null
                };
                setActiveTaskDetail(updatedTask);
                return updatedTask;
            }
            return t;
        });
        setTasks(updatedTasks);
        localStorage.setItem("lab_app_tasks", JSON.stringify(updatedTasks));
        showToast("Đã phê duyệt hoàn thành Báo cáo chuyên môn!", "success");
    };

    const handleRejectReport = () => {
        if (!activeTaskDetail) return;
        const feedback = prompt("Nhập ý kiến chỉ đạo / yêu cầu hiệu chỉnh Báo cáo kết quả:");
        if (feedback === null) return;

        const updatedTasks = tasks.map(t => {
            if (t.id === activeTaskDetail.id) {
                const updatedTask = {
                    ...t,
                    techStatus: "Needs Revision Report",
                    techFeedback: feedback || "Cần làm rõ kết quả hoặc thêm tài liệu đính kèm."
                };
                setActiveTaskDetail(updatedTask);
                return updatedTask;
            }
            return t;
        });
        setTasks(updatedTasks);
        localStorage.setItem("lab_app_tasks", JSON.stringify(updatedTasks));
        showToast("Đã yêu cầu hiệu chỉnh Báo cáo kết quả!", "warning");
    };

    const currentWeek = useMemo(() => getCurrentWeekNumber(), []);

    // Week options for week dropdown in planner & daily board
    const weekOptions = useMemo(() => {
        const countsByWeek: Record<number, number> = {};
        plans.forEach(p => {
            const w = Number(p.week_number);
            if (w >= 1 && w <= 52) {
                countsByWeek[w] = (countsByWeek[w] || 0) + (p.items?.length || 0);
            }
        });

        const list: { week: number; count: number }[] = [];
        for (let i = 1; i <= 52; i++) {
            list.push({ week: i, count: countsByWeek[i] || 0 });
        }
        return list;
    }, [plans]);

    // Active plan matching employee, week and year
    const activePlan = useMemo(() => {
        return plans.find(p => p.user_name === selectedEmployee && p.week_number === selectedWeek && p.year === 2026);
    }, [plans, selectedEmployee, selectedWeek]);

    // Unique employees list from system
    const uniqueEmployees = useMemo(() => {
        // Filter members belonging to the Application department or position contains app keywords
        const appMembers = labMembers.filter((m: any) => {
            const dept = (m.department || m.dept || "").toLowerCase().trim();
            const role = (m.role || m.position || "").toLowerCase().trim();
            return dept === "application" || dept === "app" || role.includes("application") || role.includes("app");
        });
        
        // Fallback to all members if no specific Application staff are registered yet
        const targetList = appMembers.length > 0 ? appMembers : labMembers;
        const names = targetList.map((m: any) => m.name || m.username).filter(Boolean);
        return names;
    }, [labMembers]);

    // Available task options for planner based on assignee
    const availableTaskOptions = useMemo(() => {
        const matchedTasks = tasks.filter(t => 
            !isLegacyMockAppTask(t) && (
                selectedEmployee === "Tất cả" || 
                !selectedEmployee || 
                t.assignee === selectedEmployee
            )
        );
        const titles = matchedTasks.map(t => t.title).filter(Boolean);
        const uniqueTitles = Array.from(new Set(titles));
        return uniqueTitles.length > 0 ? uniqueTitles : ["Hoạt động thử nghiệm chung phòng Application"];
    }, [tasks, selectedEmployee]);

    // Keep planProject selected value in sync with available options
    useEffect(() => {
        if (availableTaskOptions.length > 0) {
            if (!availableTaskOptions.includes(planProject)) {
                setPlanProject(availableTaskOptions[0]);
            }
        }
    }, [availableTaskOptions, planProject]);

    // Stats calculations
    const cleanTasks = useMemo(() => tasks.filter(t => !isLegacyMockAppTask(t)), [tasks]);
    const activeTasksCount = cleanTasks.filter(t => t.status === "Đang thực hiện").length;
    const completedTasksCount = cleanTasks.filter(t => t.status === "Hoàn thành").length;
    const totalTasksCount = cleanTasks.length;
    const passRate = totalTasksCount > 0 ? Math.round((completedTasksCount / totalTasksCount) * 100) : 100;
    const pendingPlansCount = plans.filter(p => p.status === "Pending Approval").length;
    const activeBookingsCount = bookings.length;

    // Filters for tasks
    const filteredTasks = useMemo(() => {
        return cleanTasks.filter(t => {
            const matchesAssignee = selectedEmployee === "Tất cả" || !selectedEmployee || t.assignee === selectedEmployee;
            const matchesCategory = taskFilterCategory === "all" || t.category === taskFilterCategory;
            return matchesAssignee && matchesCategory;
        });
    }, [cleanTasks, selectedEmployee, taskFilterCategory]);

    // Filters for samples
    const filteredSamples = useMemo(() => {
        return samples.filter(s => {
            const matchesSearch = s.name.toLowerCase().includes(sampleSearchQuery.toLowerCase()) || 
                                 s.target.toLowerCase().includes(sampleSearchQuery.toLowerCase()) || 
                                 s.barcode.toLowerCase().includes(sampleSearchQuery.toLowerCase());
            const matchesCategory = sampleCategoryFilter === "Tất Cả" || s.category === sampleCategoryFilter;
            const matchesQc = sampleQcFilter === "Tất Cả" || s.status === sampleQcFilter;
            return matchesSearch && matchesCategory && matchesQc;
        });
    }, [samples, sampleSearchQuery, sampleCategoryFilter, sampleQcFilter]);

    if (!isMounted) {
        return (
            <div className="h-screen w-full flex items-center justify-center bg-slate-950 text-slate-400">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    <span>Đang khởi tạo trang...</span>
                </div>
            </div>
        );
    }

    if (!hasAccess) {
        return (
            <div className="h-[80vh] w-full flex items-center justify-center bg-slate-950 p-6">
                <div className="max-w-md p-8 rounded-3xl bg-slate-900 border border-white/10 glass text-center space-y-4 shadow-2xl">
                    <div className="w-16 h-16 mx-auto bg-rose-500/10 rounded-2xl flex items-center justify-center text-rose-500 border border-rose-500/20">
                        <Lock className="w-8 h-8" />
                    </div>
                    <h2 className="text-xl font-bold text-white">Quyền Truy Cập Bị Từ Chối</h2>
                    <p className="text-sm text-slate-400 leading-relaxed">
                        Giao diện này chỉ dành riêng cho Ban Giám Đốc và các thành viên của phòng **Application**.
                        Vui lòng liên hệ Admin nếu bạn cần quyền truy cập.
                    </p>
                </div>
            </div>
        );
    }

    // Operations: Weekly Planner
    const syncPlansToServer = async (newPlans: any[]) => {
        setPlans(newPlans);
        try {
            if (typeof window !== "undefined") {
                localStorage.setItem("lab_app_plans", JSON.stringify(newPlans));
            }
            const res = await fetch("/api/storage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: "lab_app_plans", data: newPlans })
            });
            if (!res.ok) {
                showToast("Mất kết nối máy chủ, chưa lưu được kế hoạch lên hệ thống!", "warning");
            }
        } catch (e) {
            console.error("Failed to sync plans to server:", e);
            showToast("Mất kết nối máy chủ, chưa lưu được kế hoạch lên hệ thống!", "warning");
        }
    };

    const handleInitializeWeekPlan = () => {
        const newPlan = {
            id: `plan-${Date.now()}`,
            user_name: selectedEmployee,
            week_number: selectedWeek,
            year: 2026,
            status: "Draft",
            items: []
        };
        const updated = [...plans, newPlan];
        syncPlansToServer(updated);
        showToast(`Đã khởi tạo kế hoạch nháp tuần ${selectedWeek} thành công!`, "success");
    };

    const handleAddPlanItem = (e: React.FormEvent) => {
        e.preventDefault();
        if (!planTaskName.trim()) return;

        const newItem = {
            id: `pi-${Date.now()}`,
            project_name: planProject,
            task_name: planTaskName,
            day_of_week: planDay,
            time_slot: planTimeSlot === "Tự nhập khoảng thời gian (Khác)" ? (customTime.trim() || "Linh hoạt") : planTimeSlot.split(" (")[0],
            target_metric: planMetric,
            notes: planNotes
        };

        const updated = plans.map(p => {
            if (p.id === activePlan?.id) {
                return { ...p, items: [...p.items, newItem] };
            }
            return p;
        });

        syncPlansToServer(updated);
        
        // Reset & Close
        setPlanTaskName("");
        setPlanMetric("");
        setPlanNotes("");
        setCustomTime("");
        setIsPlanItemModalOpen(false);
        showToast("Đã thêm công việc vào kế hoạch tuần thành công!", "success");
    };

    const handleDeletePlanItem = (itemId: string) => {
        const updated = plans.map(p => {
            if (p.id === activePlan?.id) {
                return { ...p, items: p.items.filter((i: any) => i.id !== itemId) };
            }
            return p;
        });
        syncPlansToServer(updated);
        showToast("Đã xóa công việc khỏi kế hoạch tuần.", "info");
    };

    const handleSubmitPlanForApproval = () => {
        const updated = plans.map(p => {
            if (p.id === activePlan?.id) {
                return { ...p, status: "Pending Approval" };
            }
            return p;
        });
        syncPlansToServer(updated);
        showToast("Đã gửi phê duyệt kế hoạch tuần lên Ban Giám đốc!", "success");
    };

    const handleApprovePlan = () => {
        const updated = plans.map(p => {
            if (p.id === activePlan?.id) {
                return { ...p, status: "Approved", approvedBy: user?.name || "Giám đốc" };
            }
            return p;
        });
        syncPlansToServer(updated);
        showToast("Đã phê duyệt kế hoạch tuần thành công!", "success");
    };

    const handleRejectPlan = () => {
        const updated = plans.map(p => {
            if (p.id === activePlan?.id) {
                return { ...p, status: "Needs Revision" };
            }
            return p;
        });
        syncPlansToServer(updated);
        showToast("Đã yêu cầu điều chỉnh lại kế hoạch.", "warning");
    };

    // Operations: Customer Issues & Quality Complaints
    const updateActiveIssue = (updatedFields: Partial<any>) => {
        let currentUpdatedIssue: any = null;
        const updated = customerIssues.map(iss => {
            if (iss.id === selectedIssueId) {
                if (updatedFields.status) {
                    setActiveViewedStep(updatedFields.status);
                }
                const merged = { ...iss, ...updatedFields };
                currentUpdatedIssue = merged;
                return merged;
            }
            return iss;
        });
        saveIssues(updated);

        // 2-way sync to PostgreSQL customer_incidents
        if (currentUpdatedIssue) {
            syncIncidentToBackend(currentUpdatedIssue);
        }
    };

    const handleCreateCustomerIssue = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newIssueProductCode.trim() || !newIssueProductName.trim() || !newIssueLotNumber.trim() || !newIssueCustomerName.trim() || !newIssueDesc.trim()) {
            showToast("Vui lòng nhập đầy đủ các trường bắt buộc!", "error");
            return;
        }

        // mã mới = số lớn nhất của năm + 1 (đếm theo số lượng sẽ trùng mã sau khi xóa / đồng bộ)
        const incYear = new Date().getFullYear();
        const maxInc = customerIssues.reduce((m, iss) => {
            const mm = String(iss.id || "").match(new RegExp(`^INC-${incYear}-(\\d+)$`));
            return mm ? Math.max(m, Number(mm[1])) : m;
        }, 0);
        const newId = `INC-${incYear}-${String(maxInc + 1).padStart(4, "0")}`;
        const newIssue = {
            id: newId,
            createdAt: todayVN(),
            createdBy: user?.name || "Kỹ thuật viên App",
            status: "Step1",
            resolutionStatus: "Investigating",
            productCode: newIssueProductCode,
            productName: newIssueProductName,
            lotNumber: newIssueLotNumber,
            description: newIssueDesc,
            customerName: newIssueCustomerName,
            contactInfo: newIssueContactInfo,
            hospitalName: newIssueCustomerName,
            attachments: newIssueAttachments,
            isRealIssue: null,
            emergencySolution: "",
            firstTimeUsing: null,
            sampleScope: "Single",
            checkedInvestigationItems: [],
            issueScopeConclusion: "Cục bộ",
            predictedCauses: [],
            goToExperiment: false,
            experimentTaskId: "",
            experimentResults: "",
            experimentConclusion: ""
        };

        const updated = [newIssue, ...customerIssues];
        saveIssues(updated);
        setSelectedIssueId(newId);
        setIsCreateIssueModalOpen(false);

        // Call backend to persist
        fetch("/api/portal/customer?action=create_incident_from_app", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                incident_code: newId,
                customer_name: newIssueCustomerName,
                customer_phone: newIssueContactInfo,
                organization: newIssueCustomerName,
                product_code: newIssueProductCode,
                product_name: newIssueProductName,
                lot_number: newIssueLotNumber,
                description: newIssueDesc,
                handled_by: user?.name || "Kỹ thuật viên App",
                attachments: newIssueAttachments
            })
        })
            .then(async r => { if (!r.ok) { const d = await r.json().catch(() => ({})); showToast(`Chưa lưu được sự cố lên máy chủ: ${d.error || r.status}`, "error"); } })
            .catch(() => showToast("Chưa lưu được sự cố lên máy chủ (mất kết nối)", "error"));

        // Reset
        setNewIssueProductCode("");
        setNewIssueProductName("");
        setNewIssueLotNumber("");
        setNewIssueCustomerName("");
        setNewIssueContactInfo("");
        setNewIssueDesc("");
        setNewIssueAttachments([]);
        setIsProductDropdownOpen(false);
        setIsLotDropdownOpen(false);
        setIsCustomerDropdownOpen(false);

        notifyActivity({
            title: "Sự Cố Khách Hàng Mới (Incident Ticket)",
            message: `Khách hàng ${newIssueCustomerName} vừa phản ánh sự cố ${newId} cho sản phẩm ${newIssueProductName} (Lô: ${newIssueLotNumber}).`,
            category: "application",
            type: "warning",
            eventKey: "customer_issue",
            link: { tab: "application", subTab: "issues" }
        });
        showToast(`Đã tạo phiếu tiếp nhận sự cố ${newId} thành công!`, "success");
    };

    const handleCreateExperimentTask = (issueId: string) => {
        const issue = customerIssues.find(iss => iss.id === issueId);
        if (!issue) return;

        const taskId = Date.now(); // numeric ID for consistency with tasks board
        const newTask = {
            id: taskId,
            title: `[Kiểm chứng sự cố ${issue.id}] - ${issue.productName} Lô ${issue.lotNumber}`,
            desc: `Tiến hành thí nghiệm thực chứng tìm nguyên nhân lỗi chất lượng sản phẩm khách hàng báo cáo:\n"${issue.description}"`,
            assignee: user?.full_name || user?.name || "",
            category: "Xác định nguyên nhân sự cố chất lượng sản phẩm",
            priority: "Cao",
            status: "Chưa bắt đầu",
            dueDate: toVNDateString(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)),
            productCode: issue.productCode || "",
            productLot: issue.lotNumber || "",
            deviceInfo: "",
            objective: `Xác định xem nguyên nhân sự cố của lô ${issue.lotNumber} là cục bộ hay hệ thống`,
            materials: "",
            samplePrep: "",
            methodology: "",
            results: "",
            conclusion: "",
            attachmentUrl: "",
            checklist: [],
            logs: []
        };

        const updatedTasks = [...tasks, newTask];
        setTasks(updatedTasks);
        localStorage.setItem("lab_app_tasks", JSON.stringify(updatedTasks));

        // Update issue with linked task ID
        const updatedIssues = customerIssues.map(iss => {
            if (iss.id === issueId) {
                return {
                    ...iss,
                    experimentTaskId: String(taskId)
                };
            }
            return iss;
        });
        saveIssues(updatedIssues);

        showToast(`Đã tạo thành công công việc kiểm chứng trên Kanban Board!`, "success");
    };

    const handleAddPredictedCause = () => {
        if (!newPredictedCauseText.trim()) return;
        const activeIssue = customerIssues.find(iss => iss.id === selectedIssueId);
        if (!activeIssue) return;

        const currentCauses = activeIssue.predictedCauses || [];
        const updatedCauses = [...currentCauses, { cause: newPredictedCauseText.trim(), status: "Possible" }];
        updateActiveIssue({ predictedCauses: updatedCauses });
        setNewPredictedCauseText("");
        showToast("Đã thêm nguyên nhân giả định!", "success");
    };

    const handleToggleCauseStatus = (index: number, status: "Possible" | "Excluded" | "Confirmed", reason?: string) => {
        const activeIssue = customerIssues.find(iss => iss.id === selectedIssueId);
        if (!activeIssue) return;

        const currentCauses = [...(activeIssue.predictedCauses || [])];
        currentCauses[index] = {
            ...currentCauses[index],
            status,
            exclusionReason: reason || currentCauses[index].exclusionReason || ""
        };
        updateActiveIssue({ predictedCauses: currentCauses });
    };

    const handlePrintIssues = (filteredIssues: any[]) => {
        const printWindow = window.open("", "_blank");
        if (!printWindow) {
            showToast("Vui lòng cho phép trình duyệt mở popup để in!", "warning");
            return;
        }

        const dateStr = new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
        let tableRows = filteredIssues.map(iss => {
            let statusText = "Tiếp nhận";
            if (iss.status === "Step2") statusText = "Xác nhận";
            else if (iss.status === "Step3") statusText = "Khai thác sâu";
            else if (iss.status === "Step4") statusText = "Dự đoán nguyên nhân";
            else if (iss.status === "Step5") statusText = "Thí nghiệm kiểm chứng";
            else if (iss.status === "Step6") statusText = "CAPA";
            else if (iss.status === "Completed") {
                statusText = iss.resolutionStatus === "Not an issue" ? "Không phải sự cố" : "Đã Khắc Phục (Resolved)";
            }

            return `
                <tr>
                    <td style="font-variant-numeric: tabular-nums; font-weight: bold;">${iss.id}</td>
                    <td>${iss.customerName}</td>
                    <td>${iss.productName} (${iss.productCode})</td>
                    <td style="font-variant-numeric: tabular-nums;">${iss.lotNumber}</td>
                    <td>${iss.createdAt}</td>
                    <td>${iss.createdBy}</td>
                    <td style="font-weight: bold;">${statusText}</td>
                </tr>
            `;
        }).join("");

        writeSafePrintDocument(printWindow, `
            <!DOCTYPE html>
            <html>
                <head>
                    <meta charset="utf-8">
                    <title>Báo Cáo Tổng Hợp Sự Cố Khách Hàng - ABT Portal</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; padding: 30px; color: #333; }
                        h2 { text-align: center; color: #0284c7; margin-bottom: 5px; }
                        .subtitle { text-align: center; font-size: 12px; color: #666; margin-bottom: 30px; }
                        table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
                        th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
                        th { background-color: #f3f4f6; color: #475569; font-weight: bold; }
                        tr:nth-child(even) { background-color: #f9fafb; }
                        .footer { margin-top: 40px; text-align: right; font-size: 12px; color: #666; }
                    </style>
                </head>
                <body>
                    <h2>BÁO CÁO TỔNG HỢP SỰ CỐ CHẤT LƯỢNG KHÁCH HÀNG</h2>
                    <div class="subtitle">Ngày xuất báo cáo: ${dateStr} | Hệ thống ABT Portal</div>
                    <table>
                        <thead>
                            <tr>
                                <th>Mã Phiếu</th>
                                <th>Khách Hàng</th>
                                <th>Sản Phẩm</th>
                                <th>Số Lô</th>
                                <th>Ngày Tạo</th>
                                <th>Người Tiếp Nhận</th>
                                <th>Trạng Thái</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRows}
                        </tbody>
                    </table>
                    <div class="footer">
                        <p>Ký tên nhân viên tiếp nhận</p>
                        <br/><br/>
                        <p>_______________________</p>
                    </div>
                    <script>
                        window.onload = function() {
                            window.print();
                        }
                    </script>
                </body>
            </html>
        `);
    };

    const handleExportIssuesExcel = (filteredIssues: any[]) => {
        const worksheet = XLSX.utils.json_to_sheet(filteredIssues.map(iss => {
            let statusText = "Tiếp nhận";
            if (iss.status === "Step2") statusText = "Xác nhận";
            else if (iss.status === "Step3") statusText = "Khai thác sâu";
            else if (iss.status === "Step4") statusText = "Dự đoán nguyên nhân";
            else if (iss.status === "Step5") statusText = "Thí nghiệm kiểm chứng";
            else if (iss.status === "Step6") statusText = "CAPA";
            else if (iss.status === "Completed") {
                statusText = iss.resolutionStatus === "Not an issue" ? "Không phải sự cố" : "Đã Khắc Phục (Resolved)";
            }

            return {
                "Mã Sự Cố": iss.id,
                "Khách Hàng": iss.customerName,
                "Thông Tin Liên Hệ": iss.contactInfo || "",
                "Mã Sản Phẩm": iss.productCode,
                "Tên Sản Phẩm": iss.productName,
                "Số Lô": iss.lotNumber,
                "Ngày Tiếp Nhận": iss.createdAt,
                "Người Tiếp Nhận": iss.createdBy,
                "Trạng Thái Hiện Tại": statusText,
                "Tính Chất": iss.isRealIssue === false ? "Không phải sự cố" : "Sự cố thực tế",
                "Giải Pháp Cấp Bách": iss.emergencySolution || "",
                "Tính Chất Phạm Vi": iss.issueScopeConclusion || "",
                "Nguyên Nhân Kết Luận": iss.experimentConclusion || iss.concludedRootCause || "",
                "Giải Pháp Lâu Dài": iss.finalCustomerSolution || "",
                "Khắc Phục (CAPA)": iss.correctiveActions || "",
                "Phòng Ngừa (CAPA)": iss.preventiveActions || ""
            };
        }));
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Sự Cố Chất Lượng");
        XLSX.writeFile(workbook, `Báo_Cáo_Sự_Cố_Khách_Hàng_${todayVN()}.xlsx`);
        showToast("Đã xuất danh sách sự cố ra file Excel thành công!", "success");
    };

    // Operations: Tasks board & Details Modal
    const handleCreateTask = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTaskTitle.trim()) return;

        const newTask = {
            id: Date.now(),
            title: newTaskTitle,
            desc: newTaskDesc,
            assignee: newTaskAssignee || (uniqueEmployees[0] || ""),
            category: newTaskCategory,
            priority: newTaskPriority,
            status: "Chưa bắt đầu",
            dueDate: newTaskDueDate || "TBD",
            productCode: "",
            productLot: "",
            deviceInfo: "",
            objective: "",
            materials: "",
            samplePrep: "",
            methodology: "",
            results: "",
            conclusion: "",
            attachmentUrl: "",
            checklist: [],
            logs: []
        };

        const updated = [...tasks, newTask];
        setTasks(updated);
        localStorage.setItem("lab_app_tasks", JSON.stringify(updated));

        // Reset
        setNewTaskTitle("");
        setNewTaskDesc("");
        setNewTaskAssignee("");
        setIsTaskCreateModalOpen(false);
        showToast("Đã thêm công việc phòng Application mới!", "success");
    };

    const handleUpdateTaskStatus = (id: number, nextStatus: string) => {
        let changedTask: any = null;
        const updated = tasks.map(t => {
            if (t.id === id) {
                changedTask = { ...t, status: nextStatus };
                return changedTask;
            }
            return t;
        });
        setTasks(updated);
        localStorage.setItem("lab_app_tasks", JSON.stringify(updated));

        // Two-way sync to shared_app_requests for Sales tab
        if (changedTask && (changedTask.isFromSales || changedTask.salesReqId)) {
            try {
                const storedReqs = localStorage.getItem("shared_app_requests");
                if (storedReqs) {
                    const reqs = JSON.parse(storedReqs);
                    const updatedReqs = reqs.map((r: any) => {
                        if (r.id === changedTask.salesReqId || r.customerName === changedTask.salesCustomerName) {
                            const newStatus = nextStatus === "Hoàn thành" ? "COMPLETED" : nextStatus === "Đang thực hiện" ? "IN_PROGRESS" : "PENDING";
                            return {
                                ...r,
                                status: newStatus,
                                statusLabel: nextStatus,
                                appAssignee: changedTask.assignee || r.appAssignee,
                                completedAt: nextStatus === "Hoàn thành" ? todayVN() : r.completedAt
                            };
                        }
                        return r;
                    });
                    localStorage.setItem("shared_app_requests", JSON.stringify(updatedReqs));
                    window.dispatchEvent(new Event("storage"));
                }
            } catch (e) {
                console.error("Error syncing status to shared_app_requests:", e);
            }
        }

        showToast(`Đã chuyển công việc sang "${nextStatus}"`, "info");
    };

    const handleDeleteTask = (id: number | string) => {
        if (confirm("Bạn có chắc chắn muốn xóa công việc này?")) {
            const taskToDelete = tasks.find(t => t.id === id);
            const updated = tasks.filter(t => t.id !== id);
            setTasks(updated);
            localStorage.setItem("lab_app_tasks", JSON.stringify(updated));

            // Sync deleted task with shared_app_requests if it came from sales
            const reqId = taskToDelete?.salesReqId || (typeof id === "string" && id.startsWith("REQ-APP-") ? id : null);
            const storedReqs = localStorage.getItem("shared_app_requests");
            if (storedReqs) {
                try {
                    const parsed = JSON.parse(storedReqs);
                    if (Array.isArray(parsed)) {
                        const updatedReqs = parsed.filter((r: any) => {
                            if (reqId && r.id === reqId) return false;
                            if (r.id === id) return false;
                            // Task cũ chưa có salesReqId: chỉ khớp đúng mã / tiêu đề đầy đủ do Sales tạo
                            if (!reqId && taskToDelete && taskMatchesSalesRequest(taskToDelete, r)) return false;
                            return true;
                        });
                        localStorage.setItem("shared_app_requests", JSON.stringify(updatedReqs));
                        fetch("/api/storage?key=shared_app_requests", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(updatedReqs)
                        }).then(onSaveResult("shared_app_requests")).catch(onSaveError("shared_app_requests"));
                    }
                } catch (e) {}
            }

            // Sync lab_app_tasks to server storage
            fetch("/api/storage?key=lab_app_tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updated)
            }).then(onSaveResult("lab_app_tasks")).catch(onSaveError("lab_app_tasks"));

            if (typeof window !== "undefined") {
                window.dispatchEvent(new Event("storage"));
            }

            showToast("Đã xóa công việc.", "info");
        }
    };

    // Inside Task Details Operations
    const handleAddSubtask = () => {
        if (!newSubtaskTitle.trim() || !activeTaskDetail) return;
        const newSub = { id: `c-${Date.now()}`, title: newSubtaskTitle, done: false };
        const updatedTasks = tasks.map(t => {
            if (t.id === activeTaskDetail.id) {
                const newChecklist = [...(Array.isArray(t.checklist) ? t.checklist : []), newSub];
                setActiveTaskDetail({ ...t, checklist: newChecklist });
                return { ...t, checklist: newChecklist };
            }
            return t;
        });
        setTasks(updatedTasks);
        localStorage.setItem("lab_app_tasks", JSON.stringify(updatedTasks));
        setNewSubtaskTitle("");
        showToast("Đã thêm nhiệm vụ phụ thành công!", "success");
    };

    const handleToggleSubtask = (subId: string) => {
        const updatedTasks = tasks.map(t => {
            if (t.id === activeTaskDetail.id) {
                const checklistArr = Array.isArray(t.checklist) ? t.checklist : [];
                const newChecklist = checklistArr.map((c: any, idx: number) => {
                    const isObj = c && typeof c === 'object';
                    const cId = isObj ? (c.id || String(idx)) : String(idx);
                    if (cId === subId) {
                        return isObj ? { ...c, done: !c.done } : { id: cId, title: String(c), done: true };
                    }
                    return c;
                });
                setActiveTaskDetail({ ...t, checklist: newChecklist });
                return { ...t, checklist: newChecklist };
            }
            return t;
        });
        setTasks(updatedTasks);
        localStorage.setItem("lab_app_tasks", JSON.stringify(updatedTasks));
    };

    const handleTaskLogFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploadingLogFile(true);

        try {
            showToast(`Đang tải lên tệp "${file.name}"...`, "info");
            const data = await uploadSingleFileSmart(file);
            if (data.success && data.url) {
                setNewTaskLogAttachment(data.name || file.name);
                setNewTaskLogFileUrl(data.url);
                setNewTaskLogFileSize(String(data.size || file.size));
                showToast(`Đã tải lên tệp "${file.name}"!`, "success");
            } else {
                showToast(data.error || "Tải tệp lên thất bại", "error");
            }
        } catch (err) {
            console.error("Application log file upload error:", err);
            showToast("Lỗi khi tải tệp lên máy chủ", "error");
        } finally {
            setIsUploadingLogFile(false);
        }
        e.target.value = "";
    };

    const handleAddTaskLog = (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if ((!newTaskLogResult.trim() && !newTaskLogAttachment) || !activeTaskDetail) return;

        const newLog = {
            id: `l-${Date.now()}`,
            date: todayVN(),
            summary: newTaskLogResult.trim() || `Đính kèm tệp: ${newTaskLogAttachment}`,
            attachment: newTaskLogAttachment || "",
            fileUrl: newTaskLogFileUrl || "",
            size: newTaskLogFileSize || ""
        };

        const updatedTasks = tasks.map(t => {
            if (t.id === activeTaskDetail.id) {
                const newLogs = [newLog, ...(Array.isArray(t.logs) ? t.logs : [])];
                setActiveTaskDetail({ ...t, logs: newLogs });
                return { ...t, logs: newLogs };
            }
            return t;
        });
        setTasks(updatedTasks);
        try {
            localStorage.setItem("lab_app_tasks", JSON.stringify(updatedTasks));
        } catch (err) {}

        // Sync to server storage
        fetch("/api/storage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: "lab_app_tasks", data: updatedTasks })
        }).then(onSaveResult("lab_app_tasks")).catch(onSaveError("lab_app_tasks"));
        
        // Reset
        setNewTaskLogResult("");
        setNewTaskLogAttachment("");
        setNewTaskLogFileUrl("");
        setNewTaskLogFileSize("");
        showToast("Đã ghi nhận nhật ký kết quả công việc!", "success");
    };

    const handleDeleteTaskLog = (logId: string) => {
        if (!activeTaskDetail) return;
        const currentLogs = Array.isArray(activeTaskDetail.logs) ? activeTaskDetail.logs : [];
        const updatedLogs = currentLogs.filter((l: any, i: number) => {
            const id = (l && typeof l === 'object' && l.id) || String(i);
            return id !== logId;
        });
        const updatedTasks = tasks.map(t => {
            if (t.id === activeTaskDetail.id) {
                return { ...t, logs: updatedLogs };
            }
            return t;
        });
        setActiveTaskDetail({ ...activeTaskDetail, logs: updatedLogs });
        setTasks(updatedTasks);
        try {
            localStorage.setItem("lab_app_tasks", JSON.stringify(updatedTasks));
        } catch (err) {}
        fetch("/api/storage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: "lab_app_tasks", data: updatedTasks })
        }).then(onSaveResult("lab_app_tasks")).catch(onSaveError("lab_app_tasks"));
        showToast("Đã xóa nhật ký kết quả", "info");
    };

    // Operations: Equipment Booking
    const handleAddBooking = (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedEqId) return;

        const eq = equipment.find(e => e.id === selectedEqId);
        if (!eq) return;

        const newBooking = {
            id: Date.now(),
            eqName: eq.name,
            user: user?.name || "Kỹ thuật viên",
            date: bookingDate || todayVN(),
            slot: bookingTime,
            purpose: bookingPurpose
        };

        const updatedBookings = [...bookings, newBooking];
        setBookings(updatedBookings);
        localStorage.setItem("lab_app_bookings", JSON.stringify(updatedBookings));

        // Mark equipment status as busy and append history
        const updatedEq = equipment.map(item => {
            if (item.id === selectedEqId) {
                return {
                    ...item,
                    status: "Busy",
                    history: [{ user: newBooking.user, purpose: newBooking.purpose, date: newBooking.date, slot: newBooking.slot }, ...(item.history || [])]
                };
            }
            return item;
        });
        setEquipment(updatedEq);
        localStorage.setItem("lab_app_equipment", JSON.stringify(updatedEq));

        // Reset
        setBookingPurpose("");
        setIsBookingModalOpen(false);
        showToast(`Đã đặt chỗ thiết bị "${eq.name}" thành công!`, "success");
    };

    const handleReleaseEquipment = (bookingId: number, eqName: string) => {
        const updatedBookings = bookings.filter(b => b.id !== bookingId);
        setBookings(updatedBookings);
        localStorage.setItem("lab_app_bookings", JSON.stringify(updatedBookings));

        // Mark equipment status back to Available
        const updatedEq = equipment.map(item => {
            if (item.name === eqName) {
                return { ...item, status: "Available" };
            }
            return item;
        });
        setEquipment(updatedEq);
        localStorage.setItem("lab_app_equipment", JSON.stringify(updatedEq));
        showToast(`Đã giải phóng và trả thiết bị "${eqName}" về trạng thái Trống!`, "info");
    };

    const handleAddEquipment = (e: React.FormEvent) => {
        e.preventDefault();
        if (!addEqName.trim()) return;
        const serial = addEqSerial.trim();
        const dupSerial = serial ? equipment.find(eq => String(eq.serial || "").trim().toLowerCase() === serial.toLowerCase()) : null;
        if (dupSerial && !confirm(`Số serial "${serial}" đã có ở thiết bị ${dupSerial.id} - ${dupSerial.name}. Vẫn đăng ký?`)) return;

        // mã mới = số lớn nhất hiện có + 1 (đếm theo số lượng sẽ trùng mã sau khi xóa bớt thiết bị)
        const maxNo = equipment.reduce((m, eq) => Math.max(m, Number(String(eq.id || "").match(/(\d+)$/)?.[1] || 0)), 0);
        const newEq = {
            id: `EQ-APP-${String(maxNo + 1).padStart(3, "0")}`,
            name: addEqName.trim(),
            status: "Available",
            model: addEqModel,
            serial,
            location: addEqLocation,
            history: []
        };

        const updated = [...equipment, newEq];
        setEquipment(updated);
        localStorage.setItem("lab_app_equipment", JSON.stringify(updated));

        setAddEqName("");
        setAddEqModel("");
        setAddEqSerial("");
        setIsAddEquipmentModalOpen(false);
        showToast(`Đã thêm thiết bị "${newEq.name}" thành công!`, "success");
    };

    const handleCreateMaterial = (e: React.FormEvent) => {
        e.preventDefault();
        if (!addMatName.trim()) return;

        const newMat = {
            id: Date.now(),
            name: addMatName,
            category: addMatCategory,
            qty: addMatQty,
            unit: addMatUnit,
            minQty: addMatMinQty,
            supplier: addMatSupplier || "N/A",
            code: addMatCode || "N/A",
            lot: addMatLot || "N/A",
            status: addMatQty > addMatMinQty ? "In Stock" : "Low Stock"
        };

        const updated = [...materials, newMat];
        setMaterials(updated);
        localStorage.setItem("lab_app_materials", JSON.stringify(updated));

        setAddMatName("");
        setAddMatCode("");
        setAddMatLot("");
        setAddMatQty(1);
        setAddMatMinQty(5);
        setAddMatSupplier("");
        setIsCreateMaterialModalOpen(false);
        showToast(`Đã đăng ký hóa chất/vật tư "${newMat.name}" thành công!`, "success");
    };

    // Equipment Admin operations
    const handleStartEditEquipment = (eq: any) => {
        setEditEqId(eq.id);
        setEditEqName(eq.name);
        setEditEqModel(eq.model || "");
        setEditEqLocation(eq.location || "");
        setEditEqStatus(eq.status || "Available");
        setEditEqSerial(eq.serial || "");
        setIsEditEqModalOpen(true);
    };

    const handleSaveEditEquipment = (e: React.FormEvent) => {
        e.preventDefault();
        if (!editEqName.trim()) { showToast("Tên thiết bị không được để trống", "error"); return; }
        const serial = editEqSerial.trim();
        const dupSerial = serial ? equipment.find(eq => eq.id !== editEqId && String(eq.serial || "").trim().toLowerCase() === serial.toLowerCase()) : null;
        if (dupSerial && !confirm(`Số serial "${serial}" đã có ở thiết bị ${dupSerial.id} - ${dupSerial.name}. Vẫn lưu?`)) return;
        const updated = equipment.map(eq => {
            if (eq.id === editEqId) {
                return {
                    ...eq,
                    name: editEqName.trim(),
                    serial,
                    model: editEqModel,
                    location: editEqLocation,
                    status: editEqStatus
                };
            }
            return eq;
        });
        setEquipment(updated);
        localStorage.setItem("lab_app_equipment", JSON.stringify(updated));
        setIsEditEqModalOpen(false);
        showToast("Đã cập nhật thông tin thiết bị!", "success");
    };

    const handleDeleteEquipment = (eqId: string, eqName: string) => {
        if (!confirm(`Bạn có chắc chắn muốn xóa thiết bị "${eqName}"?`)) return;
        const updated = equipment.filter(eq => eq.id !== eqId);
        setEquipment(updated);
        localStorage.setItem("lab_app_equipment", JSON.stringify(updated));
        showToast("Đã xóa thiết bị khỏi hệ thống.", "info");
    };

    // Material Admin operations
    const handleStartEditMaterial = (mat: any) => {
        setEditMatId(mat.id);
        setEditMatName(mat.name);
        setEditMatCode(mat.code || "");
        setEditMatLot(mat.lot || "");
        setEditMatCategory(mat.category || "Hóa chất PCR");
        setEditMatQty(mat.qty || 0);
        setEditMatUnit(mat.unit || "Hộp");
        setEditMatMinQty(mat.minQty || 5);
        setEditMatSupplier(mat.supplier || "");
        setIsEditMatModalOpen(true);
    };

    const handleSaveEditMaterial = (e: React.FormEvent) => {
        e.preventDefault();
        const updated = materials.map(mat => {
            if (mat.id === editMatId) {
                return {
                    ...mat,
                    name: editMatName,
                    code: editMatCode,
                    lot: editMatLot,
                    category: editMatCategory,
                    qty: editMatQty,
                    unit: editMatUnit,
                    minQty: editMatMinQty,
                    supplier: editMatSupplier,
                    status: editMatQty > editMatMinQty ? "In Stock" : "Low Stock"
                };
            }
            return mat;
        });
        setMaterials(updated);
        localStorage.setItem("lab_app_materials", JSON.stringify(updated));
        setIsEditMatModalOpen(false);
        showToast("Đã cập nhật thông tin hóa chất/vật tư!", "success");
    };

    const handleDeleteMaterial = (matId: any, matName: string) => {
        if (!confirm(`Bạn có chắc chắn muốn xóa hóa chất/vật tư "${matName}"?`)) return;
        const updated = materials.filter(mat => mat.id !== matId);
        setMaterials(updated);
        localStorage.setItem("lab_app_materials", JSON.stringify(updated));
        showToast("Đã xóa hóa chất/vật tư khỏi hệ thống.", "info");
    };

    // Direct Material Export operations
    const handleStartDirectExportMaterial = (mat: any) => {
        setExportMatId(mat.id);
        setExportMatName(mat.name);
        setExportMatStock(mat.qty || 0);
        setExportMatUnit(mat.unit || "Hộp");
        setExportMatQty(1);
        setExportMatPerformer(user?.name || "");
        setExportMatReason("");
        setIsDirectExportModalOpen(true);
    };

    const handleSaveDirectExportMaterial = (e: React.FormEvent) => {
        e.preventDefault();
        if (exportMatQty <= 0) {
            alert("Số lượng xuất kho phải lớn hơn 0!");
            return;
        }
        if (exportMatQty > exportMatStock) {
            alert("Không đủ tồn kho để thực hiện xuất!");
            return;
        }

        const updated = materials.map(mat => {
            if (mat.id === exportMatId) {
                const newQty = mat.qty - exportMatQty;
                return {
                    ...mat,
                    qty: newQty,
                    status: newQty > mat.minQty ? "In Stock" : "Low Stock"
                };
            }
            return mat;
        });
        setMaterials(updated);
        localStorage.setItem("lab_app_materials", JSON.stringify(updated));
        setIsDirectExportModalOpen(false);
        showToast(`Đã xuất kho ${exportMatQty} ${exportMatUnit} "${exportMatName}" thành công!`, "success");
    };

    // Operations: Material PR request to Central Warehouse
    const handleAddMaterialRequest = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!materialItemCode) {
            showToast("Vui lòng chọn vật tư từ Cung ứng!", "error");
            return;
        }

        const matchedItem = materialMasterItems.find((it: any) => it.item_code === materialItemCode);
        const itemLabel = matchedItem ? `${materialItemCode} - ${matchedItem.item_name || ""}` : materialItemCode;

        try {
            const response = await fetch("/api/workflows", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "workflow",
                    workflow_code: `PR-APP-${Date.now().toString().slice(-6)}`,
                    workflow_type: "Yêu cầu cấp phát / Mua vật tư Lab",
                    title: `[Application] Yêu cầu vật tư: ${itemLabel} (SL: ${Number(materialQty) || 1})`,
                    priority: "HIGH",
                    status: "PENDING",
                    requester_name: user?.name || "Phòng Application",
                    requester_dept: "Phòng Application",
                    target_dept: "Kho Trung Tâm",
                    product_info: `${itemLabel} | SL: ${Number(materialQty) || 1}`,
                    description: materialReason || "Sử dụng cho các thử nghiệm kiểm định lâm sàng phòng Application.",
                    steps: [
                        { step_order: 1, name: "Gửi yêu cầu vật tư", dept: "Phòng Application", status: "COMPLETED", completed_at: new Date().toISOString() },
                        { step_order: 2, name: "Kiểm tra tồn kho & cấp phát", dept: "Kho Trung Tâm", status: "IN_PROGRESS" },
                        { step_order: 3, name: "Mua hàng bổ sung (nếu thiếu)", dept: "Phòng Mua Hàng", status: "PENDING" }
                    ],
                    current_step_index: 1
                })
            });

            if (response.ok) {
                showToast("Đã gửi phiếu yêu cầu vật tư về Kho Trung Tâm / Phòng Mua Hàng thành công!", "success");
                setIsMaterialModalOpen(false);
                setMaterialItemCode("");
                setMaterialSearchQuery("");
                setMaterialReason("");
            } else {
                const errData = await response.json().catch(() => ({}));
                showToast(`Lỗi: ${errData.error || errData.detail || "Không thể gửi yêu cầu"}`, "error");
            }
        } catch (err) {
            console.error("Error creating internal requisition:", err);
            showToast("Không thể kết nối tới máy chủ Cung ứng!", "error");
        }
    };

    const handleDownloadSpecimenTemplate = () => {
        const headers = ["Mã Mẫu", "Mã Bệnh Nhân", "Kết Quả / Ct", "Thể Tích"];
        const rows = [
            ["CL-SARS-006", "BN-906", "Dương tính (Ct=24.5)", 0.5],
            ["CL-SARS-007", "BN-907", "Âm tính", 0.2],
            ["CL-SARS-008", "BN-908", "Dương tính (Ct=31.2)", 0.4],
            ["CL-SARS-009", "BN-909", "Dương tính (Ct=18.9)", 0.3],
            ["CL-SARS-010", "BN-910", "Âm tính", 0.5]
        ];
        
        const data = [headers, ...rows];
        const worksheet = XLSX.utils.aoa_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Danh sách mẫu bệnh phẩm");
        
        worksheet["!cols"] = [
            { wch: 15 },
            { wch: 15 },
            { wch: 25 },
            { wch: 10 }
        ];

        XLSX.writeFile(workbook, "mau_nhap_benh_pham_app.xlsx");
        showToast("Đã tải xuống file Excel mẫu thành công!", "success");
    };

    const handleLoadExcelFile = (file: File, callback: (csvText: string) => void) => {
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const data = new Uint8Array(evt.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
                
                let startIdx = 0;
                if (rows.length > 0 && rows[0] && isNaN(Number(rows[0][3]))) {
                    startIdx = 1;
                }
                const dataRows = rows.slice(startIdx);
                const csvLines = dataRows.map((row: any) => {
                    if (!row || row.length === 0) return null;
                    const specId = row[0] ? String(row[0]).trim() : "";
                    const patId = row[1] ? String(row[1]).trim() : "";
                    const result = row[2] ? String(row[2]).trim() : "";
                    const vol = row[3] ? parseFloat(row[3]) || 0.5 : 0.5;
                    if (!specId) return null;
                    return `${specId},${patId},${result},${vol}`;
                }).filter(Boolean);

                if (csvLines.length === 0) {
                    showToast("Không tìm thấy dữ liệu mẫu hợp lệ trong file Excel!", "error");
                    return;
                }

                callback(csvLines.join("\n"));
                showToast(`Đã tải ${csvLines.length} mẫu bệnh phẩm từ file Excel thành công!`, "success");
            } catch (err) {
                console.error(err);
                showToast("Lỗi khi đọc file Excel!", "error");
            }
        };
        reader.readAsArrayBuffer(file);
    };

    // Operations: Samples
    const handleAddSample = (e: React.FormEvent) => {
        e.preventDefault();
        if (!sampleName.trim()) return;

        let finalQty = sampleQty;
        let finalConcentration = sampleConcentration;
        let parsedSpecimens: any[] = [];

        if (sampleCategory === "Bệnh phẩm" && useBatchImport) {
            const lines = batchSpecimensText.split("\n");
            lines.forEach((line, idx) => {
                const trimmed = line.trim();
                if (!trimmed) return;
                const parts = trimmed.split(",");
                const specId = parts[0]?.trim();
                const patId = parts[1]?.trim() || `BN-Unknown-${idx + 1}`;
                const resVal = parts[2]?.trim() || "Chờ xét nghiệm";
                const volVal = parseFloat(parts[3]?.trim()) || 0.5;
                if (specId) {
                    parsedSpecimens.push({
                        id: specId,
                        patientId: patId,
                        result: resVal,
                        volume: volVal,
                        status: "Đạt tiêu chuẩn",
                        location: `Khay A, Vị trí ${idx + 1}`
                    });
                }
            });
            
            if (parsedSpecimens.length > 0) {
                finalQty = Math.round(parsedSpecimens.reduce((sum, s) => sum + s.volume, 0) * 100) / 100;
                finalConcentration = `Theo danh sách (${parsedSpecimens.length} mẫu)`;
            }
        }

        const barcodeVal = sampleBarcode.trim() || `SMP-APP-${Math.floor(1000 + Math.random() * 9000)}`;
        const newSample: any = {
            barcode: barcodeVal,
            name: sampleName,
            category: sampleCategory,
            target: sampleTarget,
            concentration: finalConcentration,
            qty: finalQty,
            unit: sampleCategory === "Bệnh phẩm" && useBatchImport ? "mL" : sampleUnit,
            temp: sampleTemp,
            location: sampleLocation || "Tủ mẫu phòng App",
            date: todayVN(),
            status: "Đạt tiêu chuẩn",
            source: sampleSource || "Lab Nội bộ",
            growthStatus: "Stock",
            growthHistory: [
                { 
                    id: "H-1", 
                    date: todayVN(), 
                    action: "Khởi tạo", 
                    performer: user?.name || "Kỹ thuật viên", 
                    details: (sampleCategory === "Bệnh phẩm" && useBatchImport)
                        ? `Nhập lô bệnh phẩm ban đầu gồm ${parsedSpecimens.length} mẫu con. Tổng thể tích: ${finalQty} mL.`
                        : `Nhập lưu trữ ${finalQty} ${sampleUnit} mẫu mới vào hệ thống.`
                }
            ],
            specimens: parsedSpecimens
        };

        const updated = [newSample, ...samples];
        setSamples(updated);
        localStorage.setItem("lab_app_samples", JSON.stringify(updated));

        // Reset
        setSampleBarcode("");
        setSampleName("");
        setSampleTarget("");
        setSampleConcentration("");
        setSampleSource("");
        setUseBatchImport(false);
        setBatchSpecimensText("");
        setIsSampleModalOpen(false);
        showToast(`Đã thêm mẫu "${sampleName}" vào tủ lưu trữ!`, "success");
    };

    const handleDeleteSample = (barcode: string) => {
        if (confirm("Bạn có chắc chắn muốn xóa mẫu này khỏi tủ lưu trữ?")) {
            const updated = samples.filter(s => s.barcode !== barcode);
            setSamples(updated);
            localStorage.setItem("lab_app_samples", JSON.stringify(updated));
            showToast("Đã xóa mẫu thành công.", "info");
        }
    };

    // Proliferate (Tăng sinh) & Consume (Hao hụt) Samples logic
    const handleProliferateSample = (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeSampleDetail) return;

        const newLog = {
            id: `H-${Date.now()}`,
            date: todayVN(),
            action: "Tăng sinh",
            performer: actionPerformer || user?.name || "Kỹ thuật viên",
            details: actionDetails || `Thực hiện cấy chuyền tăng sinh mẫu. Lượng tăng: +${actionVolume} ${activeSampleDetail.unit}`
        };

        const updated = samples.map(s => {
            if (s.barcode === activeSampleDetail.barcode) {
                const newQty = s.qty + Number(actionVolume);
                const updatedSample = { ...s, qty: newQty, growthStatus: "Activated", growthHistory: [newLog, ...(s.growthHistory || [])] };
                setActiveSampleDetail(updatedSample);
                return updatedSample;
            }
            return s;
        });

        setSamples(updated);
        localStorage.setItem("lab_app_samples", JSON.stringify(updated));
        
        // Reset & Close
        setActionVolume(1);
        setActionDetails("");
        setIsProliferateModalOpen(false);
        showToast("Đã cập nhật tăng sinh mẫu thành công!", "success");
    };

    const handleConsumeSample = (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeSampleDetail) return;

        if (activeSampleDetail.qty < Number(actionVolume)) {
            alert("Số lượng tồn kho không đủ để tiêu dùng!");
            return;
        }

        const newLog = {
            id: `H-${Date.now()}`,
            date: todayVN(),
            action: "Sử dụng",
            performer: actionPerformer || user?.name || "Kỹ thuật viên",
            details: actionDetails || `Sử dụng mẫu cho phản ứng chạy thử nghiệm. Lượng tiêu hao: -${actionVolume} ${activeSampleDetail.unit}`
        };

        const updated = samples.map(s => {
            if (s.barcode === activeSampleDetail.barcode) {
                const newQty = s.qty - Number(actionVolume);
                const updatedSample = { ...s, qty: newQty, growthHistory: [newLog, ...(s.growthHistory || [])] };
                setActiveSampleDetail(updatedSample);
                return updatedSample;
            }
            return s;
        });

        setSamples(updated);
        localStorage.setItem("lab_app_samples", JSON.stringify(updated));
        
        // Reset & Close
        setActionVolume(1);
        setActionDetails("");
        setIsConsumeModalOpen(false);
        showToast("Đã cập nhật hao hụt/sử dụng mẫu!", "success");
    };

    // Excel Export
    const handleExportToExcel = () => {
        const worksheet = XLSX.utils.json_to_sheet(samples.map(s => ({
            "Mã Barcode": s.barcode,
            "Tên Mẫu": s.name,
            "Phân Loại": s.category,
            "Gene Đích": s.target,
            "Nồng Độ": s.concentration,
            "Số Lượng": `${s.qty} ${s.unit}`,
            "Nhiệt Độ": s.temp,
            "Vị Trí Bảo Quản": s.location,
            "Ngày Nhận": s.date,
            "Nguồn Mẫu": s.source,
            "Đánh Giá QC": s.status,
            "Tình Trạng Sinh Trưởng": s.growthStatus
        })));
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Mẫu Thử Nghiệm App");
        XLSX.writeFile(workbook, `Mẫu_Bệnh_Phẩm_Application_${todayVN()}.xlsx`);
        showToast("Đã xuất Excel danh sách mẫu thành công!", "success");
    };

    return (
        <div className="space-y-5 pb-12">
            {/* Header - Standardized Compact 2-Tier Layout */}
            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800 relative overflow-hidden shadow-xs space-y-3.5">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 relative z-10">
                    <div>
                        <div className="flex items-center gap-2">
                            <FlaskConical className="w-5 h-5 text-orange-500 shrink-0" />
                            <h1 className="text-lg sm:text-xl font-black text-white tracking-tight uppercase">
                                PHÒNG APPLICATION &amp; KỸ THUẬT LÂM SÀNG
                            </h1>
                            <span className="hidden sm:inline-block text-[10px] font-bold text-primary px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 uppercase tracking-wider">
                                Phân Hệ Chuyên Môn
                            </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                            Nghiên cứu ứng dụng chẩn đoán, bảo trì thiết bị khách hàng (FSE), quản lý nguồn lực phòng Lab và xử lý sự cố CAPA.
                        </p>
                    </div>

                    {/* Quick Action Buttons */}
                    <div className="flex flex-wrap gap-2 relative z-10">
                        {activeTab === "planner" && activePlan && (activePlan.status === "Draft" || activePlan.status === "Needs Revision") && (
                            <button
                                onClick={() => {
                                    setPlanDay("Thứ 2");
                                    setIsPlanItemModalOpen(true);
                                }}
                                className="bg-primary hover:bg-primary/90 text-white font-bold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-sm shadow-primary/20 active:scale-95 transition-all cursor-pointer"
                            >
                                <Plus className="w-3.5 h-3.5" /> Thêm Hoạt Động Ngày
                            </button>
                        )}
                        {activeTab === "tasks" && (
                            <button
                                onClick={() => {
                                    setNewTaskAssignee(selectedEmployee !== "Tất cả" ? selectedEmployee : (uniqueEmployees[0] || ""));
                                    setIsTaskCreateModalOpen(true);
                                }}
                                className="bg-primary hover:bg-primary/90 text-white font-bold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-sm shadow-primary/20 active:scale-95 transition-all cursor-pointer"
                            >
                                <PlusCircle className="w-3.5 h-3.5" /> Tạo Công Việc Mới
                            </button>
                        )}
                        {activeTab === "resources" && resourceSubTab === "equipment" && (
                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={() => {
                                        setSelectedEqId(equipment[0]?.id || "");
                                        setIsBookingModalOpen(true);
                                    }}
                                    className="bg-slate-900 border border-white/10 hover:bg-white/5 text-slate-300 font-bold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer"
                                >
                                    <Wrench className="w-3.5 h-3.5" /> Đặt Chỗ Thiết Bị
                                </button>
                                <button
                                    onClick={() => setIsAddEquipmentModalOpen(true)}
                                    className="bg-primary hover:bg-primary/95 text-white font-bold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-sm shadow-primary/20 active:scale-95 transition-all cursor-pointer"
                                >
                                    <PlusCircle className="w-3.5 h-3.5" /> Đăng Ký Thiết Bị
                                </button>
                            </div>
                        )}
                        {activeTab === "resources" && resourceSubTab === "materials" && (
                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={() => {
                                        fetchMaterialMasterItems();
                                        setIsMaterialModalOpen(true);
                                        setMaterialItemCode("");
                                        setMaterialSearchQuery("");
                                        setIsMaterialDropdownOpen(false);
                                    }}
                                    className="bg-slate-900 border border-white/10 hover:bg-white/5 text-slate-300 font-bold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer"
                                >
                                    <FlaskConical className="w-3.5 h-3.5" /> Yêu Cầu từ Cung ứng
                                </button>
                                <button
                                    onClick={() => setIsCreateMaterialModalOpen(true)}
                                    className="bg-primary hover:bg-primary/95 text-white font-bold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-sm shadow-primary/20 active:scale-95 transition-all cursor-pointer"
                                >
                                    <PlusCircle className="w-3.5 h-3.5" /> Đăng Ký Hóa Chất/Vật Tư
                                </button>
                            </div>
                        )}
                        {activeTab === "resources" && resourceSubTab === "samples" && (
                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={handleExportToExcel}
                                    className="bg-slate-900 border border-white/10 hover:bg-white/5 text-slate-300 font-bold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer"
                                >
                                    <Download className="w-3.5 h-3.5" /> Xuất Excel
                                </button>
                                <button
                                    onClick={() => setIsSampleModalOpen(true)}
                                    className="bg-primary hover:bg-primary/90 text-white font-bold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-sm shadow-primary/20 active:scale-95 transition-all cursor-pointer"
                                >
                                    <FolderPlus className="w-3.5 h-3.5" /> Nhập Lưu Trữ Mẫu
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Tier 2: Sub-Tab Navigation */}
                <div className="pt-2.5 border-t border-slate-800/80">
                    <div className="flex flex-wrap items-center bg-slate-950/70 p-1 rounded-xl border border-slate-800/80 gap-1">
                        <button
                            onClick={() => setActiveTab("service")}
                            className={cn(
                                "px-3.5 py-1.5 font-bold text-xs relative transition-all flex items-center gap-2 whitespace-nowrap rounded-lg cursor-pointer",
                                activeTab === "service" ? "bg-indigo-600 text-white shadow-xs" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                            )}
                        >
                            <Wrench className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            <span>Bảo trì &amp; Dịch vụ KH (FSE)</span>
                            <span className="px-1.5 py-0.5 text-[9px] rounded-full bg-amber-500/20 text-amber-300 font-extrabold border border-amber-500/30">Mới</span>
                        </button>
                        <button
                            onClick={() => setActiveTab("techcare")}
                            className={cn(
                                "px-3.5 py-1.5 font-bold text-xs relative transition-all flex items-center gap-2 whitespace-nowrap rounded-lg cursor-pointer",
                                activeTab === "techcare" ? "bg-indigo-600 text-white shadow-xs" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                            )}
                        >
                            <HeartHandshake className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                            <span>Chăm sóc kỹ thuật</span>
                        </button>
                        <button
                            onClick={() => setActiveTab("resources")}
                            className={cn(
                                "px-3.5 py-1.5 font-bold text-xs relative transition-all flex items-center gap-2 whitespace-nowrap rounded-lg cursor-pointer",
                                activeTab === "resources" ? "bg-indigo-600 text-white shadow-xs" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                            )}
                        >
                            <Database className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <span>Quản lý nguồn lực Lab</span>
                        </button>
                        <button
                            onClick={() => setActiveTab("issues")}
                            className={cn(
                                "px-3.5 py-1.5 font-bold text-xs relative transition-all flex items-center gap-2 whitespace-nowrap rounded-lg cursor-pointer",
                                activeTab === "issues" ? "bg-indigo-600 text-white shadow-xs" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                            )}
                        >
                            <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                            <span>Xử lý Sự cố &amp; CAPA</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Content Area */}
            <div>
                <AnimatePresence mode="wait">
                    {/* Tab 0: Customer Equipment Service & Maintenance (PM/CM) */}
                    {activeTab === "techcare" && (
                        <motion.div key="techcare-tab" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -15 }} transition={{ duration: 0.2 }}>
                            <TechCareLog currentUserName={String((user as any)?.full_name || user?.name || "")} showToast={showToast} />
                        </motion.div>
                    )}

                    {activeTab === "service" && (
                        <motion.div
                            key="service-tab"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            transition={{ duration: 0.2 }}
                        >
                            <CustomerEquipmentService />
                        </motion.div>
                    )}
                    {/* Tab 1: Weekly Planner */}
                    {activeTab === "planner" && (
                        <motion.div
                            key="planner-tab"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            transition={{ duration: 0.2 }}
                            className="space-y-6"
                        >
                            {!activePlan ? (
                                <div className="p-12 rounded-3xl bg-slate-900/40 border border-white/5 glass text-center space-y-4 shadow-xl">
                                    <div className="w-16 h-16 mx-auto bg-slate-800 rounded-full flex items-center justify-center text-slate-400">
                                        <CalendarDays className="w-8 h-8" />
                                    </div>
                                    <h3 className="text-base font-bold text-white">Chưa có kế hoạch tuần này</h3>
                                    <p className="text-xs text-slate-400 max-w-sm mx-auto">
                                        Nhân sự **{selectedEmployee}** chưa lập hoặc khởi tạo thời gian biểu hoạt động cho Tuần {selectedWeek}.
                                    </p>
                                    {selectedEmployee !== "Tất cả" && (
                                        <button
                                            onClick={handleInitializeWeekPlan}
                                            className="px-5 py-2.5 bg-primary hover:bg-primary/95 text-white font-bold rounded-xl text-xs active:scale-95 shadow transition-all"
                                        >
                                            Khởi Tạo Kế Hoạch Nháp
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    {/* Plan Details & Status Header */}
                                    <div className="p-6 rounded-3xl bg-slate-900/40 border border-white/5 glass flex justify-between items-center flex-wrap gap-4 shadow-md">
                                        <div className="flex items-center gap-4">
                                            <div>
                                                <h3 className="text-sm font-black text-white">Kế hoạch Tuần {selectedWeek} của {selectedEmployee}</h3>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="text-[10px] text-slate-500 font-medium">Trạng thái phê duyệt:</span>
                                                    {activePlan.status === "Approved" ? (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold text-[9px] uppercase tracking-wider">
                                                            Đã phê duyệt (Bởi {activePlan.approvedBy})
                                                        </span>
                                                    ) : activePlan.status === "Pending Approval" ? (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold text-[9px] uppercase tracking-wider">
                                                            Chờ phê duyệt
                                                        </span>
                                                    ) : activePlan.status === "Needs Revision" ? (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 font-bold text-[9px] uppercase tracking-wider">
                                                            Yêu cầu điều chỉnh
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20 font-bold text-[9px] uppercase tracking-wider">
                                                            Bản nháp (Draft)
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Actions per status */}
                                        <div className="flex gap-2">
                                            {selectedEmployee !== "Tất cả" && (activePlan.status === "Draft" || activePlan.status === "Needs Revision") && (
                                                <button
                                                    onClick={handleSubmitPlanForApproval}
                                                    className="bg-primary hover:bg-primary/95 text-white font-bold text-xs px-4 py-2.5 rounded-xl flex items-center gap-1.5 active:scale-95 shadow transition-all"
                                                >
                                                    <Send className="w-3.5 h-3.5" /> Gửi Phê Duyệt
                                                </button>
                                            )}

                                            {isManager && activePlan.status === "Pending Approval" && (
                                                <>
                                                    <button
                                                        onClick={handleRejectPlan}
                                                        className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/10 font-bold text-xs px-4 py-2.5 rounded-xl active:scale-95 transition-all"
                                                    >
                                                        Yêu cầu sửa lại
                                                    </button>
                                                    <button
                                                        onClick={handleApprovePlan}
                                                        className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs px-4 py-2.5 rounded-xl active:scale-95 shadow transition-all"
                                                    >
                                                        Phê Duyệt
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {/* Grid view of Days */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                                        {DAYS_OF_WEEK.map(day => {
                                            const dayItems = activePlan.items.filter((i: any) => i.day_of_week === day);
                                            return (
                                                <div key={day} className="p-6 rounded-3xl bg-slate-900/40 border border-white/5 glass flex flex-col gap-4">
                                                    <div className="flex justify-between items-center border-b border-white/5 pb-2">
                                                        <h4 className="font-bold text-white text-xs uppercase tracking-wider flex items-center gap-2">
                                                            <Calendar className="w-4 h-4 text-primary" /> {day}
                                                        </h4>
                                                        {(activePlan.status === "Draft" || activePlan.status === "Needs Revision") && (
                                                            <button
                                                                onClick={() => {
                                                                    setPlanDay(day);
                                                                    setIsPlanItemModalOpen(true);
                                                                }}
                                                                className="text-primary hover:text-primary-light flex items-center gap-1 text-[10px] font-bold"
                                                            >
                                                                <Plus className="w-3.5 h-3.5" /> Thêm việc
                                                            </button>
                                                        )}
                                                    </div>

                                                    <div className="space-y-3 min-h-[120px]">
                                                        {dayItems.length === 0 ? (
                                                            <div className="text-center py-8 text-slate-600 text-[10px] italic">
                                                                Chưa có kế hoạch hoạt động nào.
                                                            </div>
                                                        ) : (
                                                            dayItems.map((item: any) => (
                                                                <div key={item.id} className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-2 relative group text-xs">
                                                                    {(activePlan.status === "Draft" || activePlan.status === "Needs Revision") && (
                                                                        <button
                                                                            onClick={() => handleDeletePlanItem(item.id)}
                                                                            className="absolute top-3 right-3 text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                                                        >
                                                                            <Trash2 className="w-3.5 h-3.5" />
                                                                        </button>
                                                                    )}
                                                                    <div className="flex items-center gap-1 text-[9px] font-bold text-slate-400">
                                                                        <Activity className="w-3 h-3 text-primary" />
                                                                        <span className="truncate max-w-[85%]">{item.project_name}</span>
                                                                    </div>
                                                                    <strong className="text-white font-semibold leading-relaxed block">{item.task_name}</strong>
                                                                    <div className="flex justify-between items-center text-[9px] text-slate-500 font-bold border-t border-white/5 pt-2 mt-1">
                                                                        <span className="text-primary">{item.time_slot.split(" ")[0]}</span>
                                                                        <span className="text-emerald-400 italic">Mục tiêu: {item.target_metric || "TBD"}</span>
                                                                    </div>
                                                                </div>
                                                            ))
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    )}

                    {/* Tab 2: Task Board */}
                    {activeTab === "tasks" && (
                        <motion.div
                            key="tasks-tab"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            transition={{ duration: 0.2 }}
                            className="space-y-6"
                        >
                            {/* Filter Bar */}
                            <div className="p-6 rounded-3xl bg-slate-900/40 border border-white/5 glass flex flex-wrap justify-between items-center gap-4 shadow-sm">
                                <div className="flex flex-wrap items-center gap-4">
                                    <div className="flex items-center gap-2">
                                        <Filter className="w-4 h-4 text-slate-500" />
                                        <span className="text-xs font-bold text-slate-500 uppercase">Bộ Lọc:</span>
                                    </div>

                                    <select
                                        value={taskFilterCategory}
                                        onChange={(e) => setTaskFilterCategory(e.target.value)}
                                        className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                    >
                                        <option value="all">Tất cả nhóm công việc</option>
                                        <option value="Nghiệm thu / Đào tạo sản phẩm">Nghiệm thu / Đào tạo sản phẩm</option>
                                        <option value="Tư vấn Setup lab & Quy trình">Tư vấn Setup lab & Quy trình</option>
                                        <option value="Tiếp nhận khiếu nại & Xử lý sự cố">Tiếp nhận khiếu nại & Xử lý sự cố</option>
                                        <option value="Bảo trì/sửa chữa thiết bị (bao gồm nội bộ và cho khách hàng)">Bảo trì / Sửa chữa thiết bị</option>
                                        <option value="Thử nghiệm đánh giá chất lượng sản phẩm">Thử nghiệm đánh giá chất lượng sản phẩm</option>
                                        <option value="Triển khai/demo sản phẩm">Triển khai/demo sản phẩm</option>
                                        <option value="Công việc khác">Công việc khác</option>
                                    </select>
                                </div>

                                <div className="text-xs text-slate-500 font-bold">
                                    Hiển thị {filteredTasks.length}/{tasks.length} công việc
                                </div>
                            </div>

                            {/* Kanban Board columns */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {/* Column: To Do */}
                                <div className="p-6 rounded-3xl bg-slate-900/30 border border-white/5 glass flex flex-col gap-4">
                                    <div className="flex items-center justify-between pb-2 border-b border-white/5">
                                        <h4 className="font-bold text-slate-300 text-xs uppercase tracking-wider flex items-center gap-2">
                                            <span className="w-2.5 h-2.5 rounded-full bg-slate-500" />
                                            Chưa bắt đầu
                                        </h4>
                                        <span className="text-[10px] font-bold text-slate-500 bg-white/5 px-2 py-0.5 rounded-full">
                                            {filteredTasks.filter(t => t.status === "Chưa bắt đầu").length}
                                        </span>
                                    </div>

                                    <div className="flex flex-col gap-3 min-h-[300px]">
                                        {filteredTasks.filter(t => t.status === "Chưa bắt đầu").map(t => (
                                            <TaskCard
                                                key={t.id}
                                                task={t}
                                                onMove={(ns) => handleUpdateTaskStatus(t.id, ns)}
                                                onDelete={() => handleDeleteTask(t.id)}
                                                onOpenDetails={() => {
                                                    setActiveTaskDetail(t);
                                                    setIsTaskDetailModalOpen(true);
                                                }}
                                            />
                                        ))}
                                    </div>
                                </div>

                                {/* Column: In Progress */}
                                <div className="p-6 rounded-3xl bg-slate-900/30 border border-white/5 glass flex flex-col gap-4">
                                    <div className="flex items-center justify-between pb-2 border-b border-white/5">
                                        <h4 className="font-bold text-amber-400 text-xs uppercase tracking-wider flex items-center gap-2">
                                            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                                            Đang thực hiện
                                        </h4>
                                        <span className="text-[10px] font-bold text-slate-500 bg-white/5 px-2 py-0.5 rounded-full">
                                            {filteredTasks.filter(t => t.status === "Đang thực hiện").length}
                                        </span>
                                    </div>

                                    <div className="flex flex-col gap-3 min-h-[300px]">
                                        {filteredTasks.filter(t => t.status === "Đang thực hiện").map(t => (
                                            <TaskCard
                                                key={t.id}
                                                task={t}
                                                onMove={(ns) => handleUpdateTaskStatus(t.id, ns)}
                                                onDelete={() => handleDeleteTask(t.id)}
                                                onOpenDetails={() => {
                                                    setActiveTaskDetail(t);
                                                    setIsTaskDetailModalOpen(true);
                                                }}
                                            />
                                        ))}
                                    </div>
                                </div>

                                {/* Column: Done */}
                                <div className="p-6 rounded-3xl bg-slate-900/30 border border-white/5 glass flex flex-col gap-4">
                                    <div className="flex items-center justify-between pb-2 border-b border-white/5">
                                        <h4 className="font-bold text-emerald-400 text-xs uppercase tracking-wider flex items-center gap-2">
                                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                                            Hoàn thành
                                        </h4>
                                        <span className="text-[10px] font-bold text-slate-500 bg-white/5 px-2 py-0.5 rounded-full">
                                            {filteredTasks.filter(t => t.status === "Hoàn thành").length}
                                        </span>
                                    </div>

                                    <div className="flex flex-col gap-3 min-h-[300px]">
                                        {filteredTasks.filter(t => t.status === "Hoàn thành").map(t => (
                                            <TaskCard
                                                key={t.id}
                                                task={t}
                                                onMove={(ns) => handleUpdateTaskStatus(t.id, ns)}
                                                onDelete={() => handleDeleteTask(t.id)}
                                                onOpenDetails={() => {
                                                    setActiveTaskDetail(t);
                                                    setIsTaskDetailModalOpen(true);
                                                }}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* Tab 3: Resources */}
                    {activeTab === "resources" && (
                        <motion.div
                            key="resources-tab"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            transition={{ duration: 0.2 }}
                            className="space-y-6"
                        >
                            {/* Resource Sub-tabs navigation */}
                            <div className="flex gap-2 bg-slate-900/40 p-1.5 rounded-2xl border border-white/5 max-w-sm">
                                <button
                                    onClick={() => setResourceSubTab("equipment")}
                                    className={cn(
                                        "flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all",
                                        resourceSubTab === "equipment" ? "bg-primary text-white" : "text-slate-400 hover:text-slate-200"
                                    )}
                                >
                                    Thiết bị Lab
                                </button>
                                <button
                                    onClick={() => setResourceSubTab("materials")}
                                    className={cn(
                                        "flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all",
                                        resourceSubTab === "materials" ? "bg-primary text-white" : "text-slate-400 hover:text-slate-200"
                                    )}
                                >
                                    Hóa chất/Vật tư
                                </button>
                                <button
                                    onClick={() => setResourceSubTab("samples")}
                                    className={cn(
                                        "flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all",
                                        resourceSubTab === "samples" ? "bg-primary text-white" : "text-slate-400 hover:text-slate-200"
                                    )}
                                >
                                    Mẫu bệnh phẩm
                                </button>
                            </div>

                            {/* Sub-tab 1: Equipment */}
                            {resourceSubTab === "equipment" && (
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                    {/* Equipment status list */}
                                    <div className="lg:col-span-2 p-8 rounded-3xl bg-slate-900/40 border border-white/5 glass space-y-6">
                                        <h3 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
                                            <Wrench className="w-4 h-4 text-primary" /> Thiết Bị Phòng Application
                                        </h3>
                                        
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-left border-collapse text-xs">
                                                <thead>
                                                    <tr className="border-b border-white/10 text-slate-500 font-bold uppercase text-[9px] tracking-wider">
                                                        <th className="pb-3 pr-2">Mã thiết bị</th>
                                                        <th className="pb-3 pr-2">Tên thiết bị</th>
                                                        <th className="pb-3 pr-2">Model</th>
                                                        <th className="pb-3 pr-2">Serial</th>
                                                        <th className="pb-3 pr-2">Vị trí</th>
                                                        <th className="pb-3 pr-2">Trạng thái</th>
                                                        <th className="pb-3 text-right">Thao tác</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {equipment.map(item => (
                                                        <tr key={item.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                                            <td className="py-3 font-mono text-[10px] text-slate-400">{item.id}</td>
                                                            <td className="py-3 font-bold text-white pr-2">{item.name}</td>
                                                            <td className="py-3 text-slate-300 pr-2">{item.model}</td>
                                                            <td className="py-3 font-mono text-[10px] text-slate-300 pr-2">{item.serial || <span className="text-slate-500">—</span>}</td>
                                                            <td className="py-3 text-slate-400 pr-2">{item.location}</td>
                                                            <td className="py-3">
                                                                <span className={cn(
                                                                    "text-[8px] font-bold uppercase px-2 py-0.5 rounded border",
                                                                    item.status === "Available" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                                                                )}>
                                                                    {item.status === "Available" ? "Trống" : "Đang dùng"}
                                                                </span>
                                                            </td>
                                                            <td className="py-3 text-right space-x-2.5 whitespace-nowrap">
                                                                {/* Người đăng ký thiết bị cũng sửa được (nhập sai tên / serial); xóa chỉ Quản trị viên */}
                                                                <button
                                                                    onClick={() => handleStartEditEquipment(item)}
                                                                    className="text-[9px] font-bold text-primary hover:underline"
                                                                >
                                                                    ✎ Sửa
                                                                </button>
                                                                {isAdmin && (
                                                                    <button
                                                                        onClick={() => handleDeleteEquipment(item.id, item.name)}
                                                                        className="text-[9px] font-bold text-rose-400 hover:underline"
                                                                    >
                                                                        Xóa
                                                                    </button>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>

                                    {/* Active Bookings list */}
                                    <div className="p-8 rounded-3xl bg-slate-900/40 border border-white/5 glass space-y-6">
                                        <h3 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
                                            <Calendar className="w-4 h-4 text-primary" /> Hoạt Động Mượn/Đặt Máy
                                        </h3>

                                        {bookings.length === 0 ? (
                                            <div className="text-center py-8 text-slate-500 text-xs">
                                                Chưa có lịch đặt máy nào.
                                            </div>
                                        ) : (
                                            <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                                                {bookings.map(b => (
                                                    <div key={b.id} className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-2 text-xs">
                                                        <div className="flex justify-between items-start">
                                                            <strong className="text-white font-bold">{b.eqName}</strong>
                                                            <button
                                                                onClick={() => handleReleaseEquipment(b.id, b.eqName)}
                                                                className="text-[9px] font-bold text-rose-400 hover:text-rose-300"
                                                            >
                                                                Giải Phóng
                                                            </button>
                                                        </div>
                                                        <p className="text-slate-400 font-medium">{b.purpose}</p>
                                                        <div className="flex justify-between text-[9px] text-slate-500 font-bold border-t border-white/5 pt-2">
                                                            <span>{b.user}</span>
                                                            <span>{b.date} ({b.slot.split(" ")[0]})</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Sub-tab 2: Materials */}
                            {resourceSubTab === "materials" && (
                                <div className="p-8 rounded-3xl bg-slate-900/40 border border-white/5 glass space-y-6">
                                    <h3 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
                                        <FlaskConical className="w-4 h-4 text-primary" /> Tồn Kho Hóa Chất & Reagent
                                    </h3>
                                    
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse text-xs text-slate-300">
                                            <thead>
                                                <tr className="border-b border-white/10 text-slate-500 font-bold uppercase text-[9px] tracking-wider">
                                                     <th className="pb-3 pr-2">Mã danh mục</th>
                                                     <th className="pb-3 pr-2">Tên hóa chất / vật tư</th>
                                                     <th className="pb-3 pr-2">Phân loại</th>
                                                     <th className="pb-3 pr-2">Số lô (Lot)</th>
                                                     <th className="pb-3 pr-2">Nhà cung cấp</th>
                                                     <th className="pb-3 pr-2">Số lượng tồn</th>
                                                     <th className="pb-3 pr-2">Trạng thái</th>
                                                     <th className="pb-3 text-right">Thao tác</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {materials.map(m => {
                                                    const isLow = m.qty <= m.minQty;
                                                    return (
                                                        <tr key={m.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                                            <td className="py-3 font-mono text-[10px] text-slate-400 pr-2">{m.code || m.id}</td>
                                                            <td className="py-3 font-bold text-white pr-2">{m.name}</td>
                                                            <td className="py-3 pr-2">{m.category}</td>
                                                            <td className="py-3 pr-2"><span className="text-amber-400 font-semibold">{m.lot || "N/A"}</span></td>
                                                            <td className="py-3 text-slate-400 pr-2">{m.supplier}</td>
                                                            <td className="py-3 pr-2">
                                                                <strong className="text-white">{m.qty} {m.unit}</strong>
                                                                <span className="text-[9px] text-slate-500 ml-1">(min: {m.minQty})</span>
                                                            </td>
                                                            <td className="py-3">
                                                                {isLow ? (
                                                                    <span className="inline-flex items-center gap-1 text-[8px] font-bold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20 uppercase">
                                                                        Cảnh báo tồn
                                                                    </span>
                                                                ) : (
                                                                    <span className="inline-flex items-center gap-1 text-[8px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 uppercase">
                                                                        An toàn
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="py-3 text-right space-x-2 whitespace-nowrap">
                                                                <button
                                                                    onClick={() => handleStartDirectExportMaterial(m)}
                                                                    className="text-[9px] font-bold text-emerald-400 hover:underline"
                                                                >
                                                                    Xuất kho
                                                                </button>
                                                                {isAdmin && (
                                                                    <>
                                                                        <button
                                                                            onClick={() => handleStartEditMaterial(m)}
                                                                            className="text-[9px] font-bold text-primary hover:underline"
                                                                        >
                                                                            Sửa
                                                                        </button>
                                                                        <button
                                                                            onClick={() => handleDeleteMaterial(m.id, m.name)}
                                                                            className="text-[9px] font-bold text-rose-400 hover:underline"
                                                                        >
                                                                            Xóa
                                                                        </button>
                                                                    </>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Sub-tab 3: Samples */}
                            {resourceSubTab === "samples" && (
                                <div className="p-8 rounded-3xl bg-slate-900/40 border border-white/5 glass space-y-6">
                                    <div className="flex justify-between items-center flex-wrap gap-4">
                                        <h3 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
                                            <Database className="w-4 h-4 text-primary" /> Danh Sách Mẫu Bệnh Phẩm
                                        </h3>
                                        
                                        {/* Sample Filters & Search */}
                                        <div className="flex flex-wrap gap-3">
                                            <div className="relative">
                                                <input
                                                    type="text"
                                                    value={sampleSearchQuery}
                                                    onChange={(e) => setSampleSearchQuery(e.target.value)}
                                                    placeholder="Tìm kiếm mẫu, gene..."
                                                    className="bg-slate-950 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-300 outline-none w-48 focus:w-60 focus:ring-1 focus:ring-primary/50 transition-all"
                                                />
                                                <Search className="w-4 h-4 text-slate-600 absolute left-3 top-2.5" />
                                            </div>

                                            <select
                                                value={sampleCategoryFilter}
                                                onChange={(e) => setSampleCategoryFilter(e.target.value)}
                                                className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                            >
                                                <option value="Tất Cả">Tất cả phân loại</option>
                                                <option value="Bệnh phẩm">Bệnh phẩm</option>
                                                <option value="DNA chuẩn">DNA chuẩn</option>
                                                <option value="RNA chuẩn">RNA chuẩn</option>
                                                <option value="Chủng chuẩn">Chủng chuẩn</option>
                                            </select>

                                            <select
                                                value={sampleQcFilter}
                                                onChange={(e) => setSampleQcFilter(e.target.value)}
                                                className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                            >
                                                <option value="Tất Cả">Tất cả trạng thái QC</option>
                                                <option value="Đạt tiêu chuẩn">Đạt tiêu chuẩn</option>
                                                <option value="Cần kiểm tra lại">Cần kiểm tra lại</option>
                                                <option value="Hỏng">Hỏng</option>
                                            </select>
                                        </div>
                                    </div>

                                    {filteredSamples.length === 0 ? (
                                        <div className="text-center py-12 text-slate-500 text-sm">
                                            Không tìm thấy mẫu thử nghiệm nào khớp với điều kiện.
                                        </div>
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-left border-collapse text-xs">
                                                <thead>
                                                    <tr className="border-b border-white/5 text-slate-400 font-bold uppercase tracking-wider">
                                                        <th className="py-4 px-4">Mã Barcode</th>
                                                        <th className="py-4 px-4">Tên Mẫu</th>
                                                        <th className="py-4 px-4">Phân Loại</th>
                                                        <th className="py-4 px-4">Gene Đích</th>
                                                        <th className="py-4 px-4 text-center">Nồng Độ</th>
                                                        <th className="py-4 px-4 text-center">Tồn kho</th>
                                                        <th className="py-4 px-4">Trạng thái QC</th>
                                                        <th className="py-4 px-4 text-right">Thao tác</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/5 text-slate-300">
                                                    {filteredSamples.map(s => (
                                                        <tr key={s.barcode} className="hover:bg-white/5 transition-colors">
                                                            <td className="py-4 px-4 font-bold text-primary whitespace-nowrap">{s.barcode}</td>
                                                            <td className="py-4 px-4 font-semibold text-white">
                                                                <button
                                                                    onClick={() => {
                                                                        setActiveSampleDetail(s);
                                                                        setIsSampleDetailModalOpen(true);
                                                                    }}
                                                                    className="hover:underline text-left"
                                                                >
                                                                    {s.name}
                                                                </button>
                                                            </td>
                                                            <td className="py-4 px-4 text-slate-400">{s.category}</td>
                                                            <td className="py-4 px-4 font-medium text-slate-400">{s.target || "N/A"}</td>
                                                            <td className="py-4 px-4 text-center text-slate-300">{s.concentration || "N/A"}</td>
                                                            <td className="py-4 px-4 text-center font-bold text-white whitespace-nowrap">{s.qty} {s.unit}</td>
                                                            <td className="py-4 px-4 whitespace-nowrap">
                                                                <span className={cn(
                                                                    "px-2.5 py-0.5 rounded-full text-[9px] font-bold border",
                                                                    s.status === "Đạt tiêu chuẩn" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : s.status === "Cần kiểm tra lại" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                                                                )}>
                                                                    {s.status}
                                                                </span>
                                                            </td>
                                                            <td className="py-4 px-4 text-right whitespace-nowrap">
                                                                <div className="flex justify-end gap-1">
                                                                    <button
                                                                        onClick={() => {
                                                                            setActiveSampleDetail(s);
                                                                            setIsSampleDetailModalOpen(true);
                                                                        }}
                                                                        className="p-1.5 bg-slate-900 border border-white/5 hover:bg-white/5 rounded-lg text-slate-300"
                                                                        title="Xem chi tiết"
                                                                    >
                                                                        <Eye className="w-3.5 h-3.5" />
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleDeleteSample(s.barcode)}
                                                                        className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg border border-rose-500/10 transition-colors"
                                                                        title="Xóa mẫu"
                                                                    >
                                                                        <Trash2 className="w-3.5 h-3.5" />
                                                                    </button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}
                        </motion.div>
                    )}

                    {/* Tab 4: Daily Board */}
                    {activeTab === "daily" && (
                        <motion.div
                            key="daily-tab"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            transition={{ duration: 0.2 }}
                            className="space-y-6"
                        >
                            {/* Top Controls: Week Navigator & Employee Switcher */}
                            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-slate-900/70 p-5 rounded-2xl border border-white/5 backdrop-blur-xl shadow-lg">
                                <div>
                                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                                        <CheckSquare className="w-5 h-5 text-primary" />
                                        Nhật Ký &amp; Kết Quả Thực Thi Daily Application
                                    </h3>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        Theo dõi kế hoạch thực thi công việc theo tuần, cập nhật kết quả 1-click và đối soát lịch sử.
                                    </p>
                                </div>

                                <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
                                    {/* Week Selector Bar */}
                                    <div className="flex items-center gap-1.5 bg-slate-950/80 border border-primary/30 px-3 py-1.5 rounded-xl shadow-sm">
                                        <button
                                            onClick={() => setSelectedWeek(w => Math.max(1, w - 1))}
                                            className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
                                            title="Xem tuần trước"
                                        >
                                            <ChevronLeft className="w-4 h-4" />
                                        </button>

                                        <div className="flex items-center gap-2 px-2">
                                            <Calendar className="w-4 h-4 text-primary" />
                                            <select
                                                value={selectedWeek}
                                                onChange={e => setSelectedWeek(Number(e.target.value))}
                                                className="bg-transparent text-xs font-bold text-primary outline-none cursor-pointer"
                                            >
                                                {weekOptions.map(opt => (
                                                    <option key={opt.week} value={opt.week} className="bg-slate-900 text-white">
                                                        Tuần {opt.week} ({getWeekDateRangeStr(opt.week, 2026)}) {opt.count > 0 ? `• [${opt.count} việc]` : ""}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <button
                                            onClick={() => setSelectedWeek(w => Math.min(52, w + 1))}
                                            className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
                                            title="Xem tuần sau"
                                        >
                                            <ChevronRight className="w-4 h-4" />
                                        </button>
                                    </div>

                                    {/* Jump to Current Week Button if not on current week */}
                                    {selectedWeek !== currentWeek && (
                                        <button
                                            onClick={() => setSelectedWeek(currentWeek)}
                                            className="px-3 py-1.5 bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition"
                                        >
                                            <Sparkles className="w-3.5 h-3.5" /> Về Tuần {currentWeek} (Hiện tại)
                                        </button>
                                    )}

                                    {/* Employee Selector */}
                                    <div className="flex items-center gap-2 bg-slate-950/80 border border-white/10 px-3 py-1.5 rounded-xl">
                                        <User className="w-4 h-4 text-slate-400" />
                                        <select
                                            value={selectedEmployee}
                                            onChange={e => setSelectedEmployee(e.target.value)}
                                            className="bg-transparent text-xs font-semibold text-slate-200 outline-none cursor-pointer"
                                        >
                                            <option value="" className="bg-slate-900 text-white">👥 Tất cả nhân viên Application</option>
                                            {uniqueEmployees.map(emp => (
                                                <option key={emp} value={emp} className="bg-slate-900 text-white">
                                                    👤 {emp}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Summary Stats for the selected week */}
                            {(() => {
                                const matchingPlans = plans.filter(p => {
                                    if (Number(p.week_number) !== Number(selectedWeek) || (p.year && Number(p.year) !== 2026)) return false;
                                    if (selectedEmployee && selectedEmployee !== "" && selectedEmployee !== "Tất cả") {
                                        return p.user_name === selectedEmployee;
                                    }
                                    return true;
                                });

                                const allWeekItems = matchingPlans.flatMap(p => (p.items || []).map((item: any) => ({ ...item, user_name: p.user_name })));
                                const total = allWeekItems.length;
                                let completed = 0;
                                let inProgress = 0;

                                allWeekItems.forEach((item: any) => {
                                    const log = dailyLogs[item.id];
                                    if (log?.status === "Completed") completed++;
                                    else if (log?.status === "In Progress") inProgress++;
                                });

                                const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

                                return (
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                        <div className="p-4 bg-slate-900/60 rounded-2xl border border-white/5 flex items-center gap-3">
                                            <div className="p-2.5 bg-blue-500/10 text-blue-400 rounded-xl">
                                                <Calendar className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Tổng việc Tuần {selectedWeek}</div>
                                                <div className="text-xl font-black text-white">{total} <span className="text-xs font-normal text-slate-400">task</span></div>
                                            </div>
                                        </div>
                                        <div className="p-4 bg-slate-900/60 rounded-2xl border border-white/5 flex items-center gap-3">
                                            <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl">
                                                <Clock className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Đang thử nghiệm</div>
                                                <div className="text-xl font-black text-amber-400">{inProgress}</div>
                                            </div>
                                        </div>
                                        <div className="p-4 bg-slate-900/60 rounded-2xl border border-white/5 flex items-center gap-3">
                                            <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl">
                                                <CheckCircle2 className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Đã hoàn thành</div>
                                                <div className="text-xl font-black text-emerald-400">{completed}</div>
                                            </div>
                                        </div>
                                        <div className="p-4 bg-slate-900/60 rounded-2xl border border-white/5 flex items-center gap-3">
                                            <div className="p-2.5 bg-primary/10 text-primary rounded-xl">
                                                <TrendingUp className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Tiến độ tuần</div>
                                                <div className="text-xl font-black text-primary">{percent}%</div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Day Selector */}
                            <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-white/5">
                                <span className="text-xs text-slate-400 font-semibold mr-2 flex items-center gap-1">
                                    <Clock className="w-3.5 h-3.5 text-primary" /> Lọc theo ngày trong tuần:
                                </span>
                                {["Tất cả", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"].map(day => (
                                    <button
                                        key={day}
                                        onClick={() => setSelectedDailyDay(day)}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition whitespace-nowrap ${
                                            selectedDailyDay === day
                                                ? "bg-primary text-white shadow-lg"
                                                : "bg-slate-900/80 text-slate-400 hover:text-white hover:bg-slate-800"
                                        }`}
                                    >
                                        {day === "Tất cả" ? "📅 Tất cả các ngày" : day}
                                    </button>
                                ))}
                            </div>

                            {/* Daily Tasks List */}
                            <div className="space-y-4">
                                {(() => {
                                    // Get items matching selectedWeek and selectedEmployee
                                    const matchingPlans = plans.filter(p => {
                                        if (Number(p.week_number) !== Number(selectedWeek) || (p.year && Number(p.year) !== 2026)) return false;
                                        if (selectedEmployee && selectedEmployee !== "" && selectedEmployee !== "Tất cả") {
                                            return p.user_name === selectedEmployee;
                                        }
                                        return true;
                                    });

                                    const allItems = matchingPlans.flatMap(p => 
                                        (p.items || []).map((item: any) => ({
                                            ...item,
                                            user_name: p.user_name,
                                            plan_id: p.id
                                        }))
                                    );
                                    
                                    const displayItems = selectedDailyDay === "Tất cả" ? allItems : allItems.filter((i: any) => i.day_of_week === selectedDailyDay);

                                    if (displayItems.length === 0) {
                                        return (
                                            <div className="bg-slate-900/40 rounded-3xl border border-white/5 p-12 text-center text-slate-400 space-y-3 glass shadow-xl">
                                                <AlertTriangle className="w-10 h-10 text-slate-500 mx-auto" />
                                                <p className="text-sm font-semibold">
                                                    Chưa có công việc nào trong kế hoạch {selectedDailyDay === "Tất cả" ? `Tuần ${selectedWeek}` : `ngày ${selectedDailyDay} (Tuần ${selectedWeek})`} {selectedEmployee ? `của ${selectedEmployee}` : "của phòng Application"}.
                                                </p>
                                                <p className="text-xs text-slate-500">
                                                    Bạn có thể chọn tuần khác ở thanh điều hướng trên hoặc vào mục <strong className="text-primary">Kế hoạch tuần</strong> để tạo lịch trình.
                                                </p>
                                            </div>
                                        );
                                    }

                                    return displayItems.map((item: any, idx: number) => {
                                        const log = dailyLogs[item.id] || { status: "Pending", result_summary: "", logged_at: "" };
                                        const isCompleted = log.status === "Completed";
                                        const isInProgress = log.status === "In Progress";

                                        return (
                                            <div
                                                key={item.id}
                                                className={`p-6 rounded-3xl border transition backdrop-blur-xl glass shadow-md ${
                                                    isCompleted ? "bg-emerald-950/10 border-emerald-500/20" :
                                                    isInProgress ? "bg-primary/10 border-primary/20" :
                                                    "bg-slate-900/40 border-white/5"
                                                }`}
                                            >
                                                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-4">
                                                    <div>
                                                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-primary font-bold uppercase tracking-wider mb-1">
                                                            <span>{item.day_of_week}</span>
                                                            {item.time_slot && (
                                                                <>
                                                                    <span>•</span>
                                                                    <span className="text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/20">🕒 {item.time_slot}</span>
                                                                </>
                                                            )}
                                                            <span>•</span>
                                                            <span className="text-slate-300">{item.project_name}</span>
                                                            {item.user_name && (
                                                                <>
                                                                    <span>•</span>
                                                                    <span className="text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">👤 {item.user_name}</span>
                                                                </>
                                                            )}
                                                        </div>
                                                        <h3 className="text-sm font-black text-white">
                                                            #{idx + 1}. {item.task_name}
                                                        </h3>
                                                        <div className="text-xs text-slate-400 mt-1 flex items-center gap-3">
                                                            <span>🎯 Mục tiêu: <strong className="text-slate-200">{item.target_metric}</strong></span>
                                                            {log.logged_at && <span className="text-[10px] text-slate-500 font-medium">Cập nhật lúc: {log.logged_at}</span>}
                                                        </div>
                                                    </div>

                                                    {/* Status Badge */}
                                                    <div className="flex items-center gap-2 shrink-0">
                                                        <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold border ${
                                                            isCompleted ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                                                            isInProgress ? "bg-primary/10 text-primary border-primary/20" :
                                                            "bg-slate-800 text-slate-400 border-slate-700"
                                                        }`}>
                                                            {isCompleted ? "✅ ĐÃ HOÀN THÀNH" : isInProgress ? "🧪 ĐANG THỬ NGHIỆM" : "⏳ CHƯA THỰC HIỆN"}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Quick Result Box */}
                                                <div className="bg-slate-950/60 p-4 rounded-2xl border border-white/5 space-y-3">
                                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                                        <FileText className="w-3.5 h-3.5 text-primary" /> Nhập kết quả thử nghiệm
                                                    </label>
                                                    <textarea
                                                        rows={2}
                                                        placeholder="Nhập tóm tắt kết quả (ví dụ: Chạy PCR mẻ #01, Ct = 18.5, đạt độ nhạy LOD 10 copies...)"
                                                        value={quickResults[item.id] || ""}
                                                        onChange={e => setQuickResults({ ...quickResults, [item.id]: e.target.value })}
                                                        className="w-full bg-slate-900 border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-primary/50 transition outline-none"
                                                    />

                                                    <div className="flex flex-col sm:flex-row justify-between items-center gap-3 pt-1">
                                                        <div className="text-[10px] text-slate-500 italic">
                                                            Hỗ trợ lưu tóm tắt kết quả để Quản lý kiểm tra và duyệt nhanh.
                                                        </div>
                                                        <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 justify-end">
                                                            <button
                                                                onClick={() => handleSaveDailyLog(item, "In Progress")}
                                                                className="px-3 py-1.5 bg-slate-850 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold transition border border-white/5 active:scale-95"
                                                            >
                                                                Đang làm
                                                            </button>
                                                            <button
                                                                onClick={() => handleSaveDailyLog(item, "Completed")}
                                                                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition active:scale-95 shadow-lg shadow-emerald-900/20"
                                                            >
                                                                <CheckCircle2 className="w-3.5 h-3.5" /> Hoàn thành &amp; Lưu
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    });
                                })()}
                            </div>
                        </motion.div>
                    )}

                    {/* Tab 5: Workload & Performance */}
                    {activeTab === "workload" && (
                        <motion.div
                            key="workload-tab"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            transition={{ duration: 0.2 }}
                        >
                            <ApplicationEvaluationAnalytics
                                tasks={tasks}
                                plans={plans}
                                dailyLogs={dailyLogs}
                                labMembers={labMembers}
                                selectedWeek={selectedWeek}
                                setSelectedWeek={setSelectedWeek}
                                selectedEmployee={selectedEmployee}
                                setSelectedEmployee={setSelectedEmployee}
                                showToast={showToast}
                                customerIssues={customerIssues}
                            />
                        </motion.div>
                    )}

                    {/* Tab 6: Customer Issues & Quality Complaints */}
                    {activeTab === "issues" && (() => {
                        const filteredIssuesList = customerIssues.filter(iss => {
                            const query = searchIssueQuery.toLowerCase().trim();
                            const matchesSearch = !query || 
                                String(iss.id || "").toLowerCase().includes(query) ||
                                (iss.productCode || "").toLowerCase().includes(query) ||
                                (iss.productName || "").toLowerCase().includes(query) ||
                                (iss.lotNumber || "").toLowerCase().includes(query) ||
                                (iss.customerName || "").toLowerCase().includes(query);
                            const matchesStatus = filterIssueStatus === "Tất cả" || iss.status === filterIssueStatus;
                            const matchesProduct = filterIssueProduct === "Tất cả" || iss.productCode === filterIssueProduct;
                            const matchesCustomer = filterIssueCustomer === "Tất cả" || iss.customerName === filterIssueCustomer;
                            
                            // Date range matching
                            let matchesDate = true;
                            if (filterIssueStartDate) {
                                matchesDate = matchesDate && iss.createdAt >= filterIssueStartDate;
                            }
                            if (filterIssueEndDate) {
                                matchesDate = matchesDate && iss.createdAt <= (filterIssueEndDate + "T23:59:59");
                            }
                            
                            return matchesSearch && matchesStatus && matchesProduct && matchesCustomer && matchesDate;
                        });

                        return (
                            <motion.div
                                key="issues-tab"
                                initial={{ opacity: 0, y: 15 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -15 }}
                                transition={{ duration: 0.2 }}
                                className="space-y-6"
                            >
                                <div className="flex justify-between items-center flex-wrap gap-4">
                                    <div>
                                        <h2 className="text-xl font-black text-white flex items-center gap-2">
                                            <ShieldAlert className="w-6 h-6 text-primary" /> Xử lý Sự cố &amp; Khiếu nại Khách hàng
                                        </h2>
                                        <p className="text-xs text-slate-400 mt-1">Quy trình 6 bước chuẩn hóa để tiếp nhận, phân tích nguyên nhân và đưa ra giải pháp khắc phục sự cố chất lượng sản phẩm.</p>
                                    </div>
                                    <div className="flex items-center gap-2.5">
                                        <button
                                            onClick={() => fetchCustomerIncidentsFromApi(true)}
                                            disabled={isSyncingIncidents}
                                            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-teal-400 border border-teal-500/30 font-bold rounded-xl text-xs active:scale-95 shadow transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                                            title="Tải & đồng bộ tự động tất cả các báo cáo sự cố gửi từ Cổng Khách Hàng (PostgreSQL)"
                                        >
                                            <RefreshCw className={`w-4 h-4 ${isSyncingIncidents ? "animate-spin text-teal-300" : ""}`} />
                                            <span>{isSyncingIncidents ? "Đang đồng bộ..." : "Đồng bộ Cổng Khách Hàng"}</span>
                                        </button>
                                        <button
                                            onClick={() => setIsCreateIssueModalOpen(true)}
                                            className="px-4 py-2.5 bg-primary hover:bg-primary/95 text-white font-bold rounded-xl text-xs active:scale-95 shadow transition-all flex items-center gap-2"
                                        >
                                            <Plus className="w-4 h-4" /> Tiếp nhận sự cố mới
                                        </button>
                                    </div>
                                </div>

                                {/* Search & Filter Bar */}
                                <div className="p-4 rounded-2xl bg-slate-900/40 border border-white/5 glass space-y-4">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                                        <div className="space-y-1.5 lg:col-span-2">
                                            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Tìm kiếm tự do:</span>
                                            <div className="relative">
                                                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                                <input
                                                    type="text"
                                                    placeholder="Tìm kiếm theo mã SP, tên SP, lô, khách hàng..."
                                                    value={searchIssueQuery}
                                                    onChange={(e) => setSearchIssueQuery(e.target.value)}
                                                    className="w-full bg-slate-950 border border-white/5 rounded-xl pl-10 pr-4 py-2 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Khách hàng:</span>
                                            <select
                                                value={filterIssueCustomer}
                                                onChange={(e) => setFilterIssueCustomer(e.target.value)}
                                                className="w-full bg-slate-950 border border-white/5 rounded-xl px-3 py-2 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                            >
                                                <option value="Tất cả">Tất cả khách hàng</option>
                                                {Array.from(new Set(customerIssues.map(iss => iss.customerName))).filter(Boolean).map(c => (
                                                    <option key={c} value={c}>{c}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Mã sản phẩm:</span>
                                            <select
                                                value={filterIssueProduct}
                                                onChange={(e) => setFilterIssueProduct(e.target.value)}
                                                className="w-full bg-slate-950 border border-white/5 rounded-xl px-3 py-2 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                            >
                                                <option value="Tất cả">Tất cả sản phẩm</option>
                                                {Array.from(new Set(customerIssues.map(iss => iss.productCode))).filter(Boolean).map(p => (
                                                    <option key={p} value={p}>{p}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Trạng thái:</span>
                                            <select
                                                value={filterIssueStatus}
                                                onChange={(e) => setFilterIssueStatus(e.target.value)}
                                                className="w-full bg-slate-950 border border-white/5 rounded-xl px-3 py-2 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                            >
                                                <option value="Tất cả">Tất cả trạng thái</option>
                                                <option value="Step1">Bước 1: Tiếp nhận</option>
                                                <option value="Step2">Bước 2: Xác nhận</option>
                                                <option value="Step3">Bước 3: Khai thác sâu</option>
                                                <option value="Step4">Bước 4: Dự đoán nguyên nhân</option>
                                                <option value="Step5">Bước 5: Thí nghiệm kiểm chứng</option>
                                                <option value="Step6">Bước 6: Giải pháp &amp; CAPA</option>
                                                <option value="Completed">Đã Hoàn Thành</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-center pt-2 border-t border-white/5">
                                        <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
                                            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider shrink-0">Thời gian tạo:</span>
                                            <DateInputVN
                                                value={filterIssueStartDate}
                                                onChange={(e) => setFilterIssueStartDate(e.target.value)}
                                                className="bg-slate-950 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                            />
                                            <span className="text-slate-500 text-xs">đến</span>
                                            <DateInputVN
                                                value={filterIssueEndDate}
                                                onChange={(e) => setFilterIssueEndDate(e.target.value)}
                                                className="bg-slate-950 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                            />
                                            {(filterIssueStartDate || filterIssueEndDate || filterIssueCustomer !== "Tất cả" || filterIssueProduct !== "Tất cả" || filterIssueStatus !== "Tất cả" || searchIssueQuery) && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setFilterIssueCustomer("Tất cả");
                                                        setFilterIssueProduct("Tất cả");
                                                        setFilterIssueStatus("Tất cả");
                                                        setFilterIssueStartDate("");
                                                        setFilterIssueEndDate("");
                                                        setSearchIssueQuery("");
                                                        showToast("Đã reset bộ lọc!", "info");
                                                    }}
                                                    className="text-[10px] text-primary hover:underline font-bold"
                                                >
                                                    Xóa lọc
                                                </button>
                                            )}
                                        </div>

                                        <div className="flex justify-end gap-2 shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => handlePrintIssues(filteredIssuesList)}
                                                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl text-xs active:scale-95 transition-all flex items-center gap-1.5 border border-white/5 shadow"
                                            >
                                                <Printer className="w-3.5 h-3.5" /> In danh sách
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleExportIssuesExcel(filteredIssuesList)}
                                                className="px-3 py-1.5 bg-emerald-600/90 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs active:scale-95 transition-all flex items-center gap-1.5 shadow"
                                            >
                                                <Download className="w-3.5 h-3.5" /> Xuất Excel
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Master-Detail Split Grid */}
                                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                                    {/* Left Side: Master List */}
                                    <div className="lg:col-span-4 space-y-4 max-h-[600px] overflow-y-auto pr-1">
                                        {filteredIssuesList.length === 0 ? (
                                            <div className="p-8 rounded-2xl bg-slate-900/20 border border-white/5 glass text-center text-xs text-slate-500">
                                                Không tìm thấy sự cố nào.
                                            </div>
                                        ) : (
                                            filteredIssuesList.map(iss => {
                                            const isSelected = iss.id === selectedIssueId;
                                            
                                            // Status Badge helper
                                            let badgeColor = "bg-slate-800 text-slate-400 border-slate-700";
                                            let badgeText = "Tiếp nhận";
                                            if (iss.status === "Step2") { badgeColor = "bg-amber-500/10 text-amber-400 border-amber-500/20"; badgeText = "Xác nhận"; }
                                            else if (iss.status === "Step3") { badgeColor = "bg-blue-500/10 text-blue-400 border-blue-500/20"; badgeText = "Khai thác sâu"; }
                                            else if (iss.status === "Step4") { badgeColor = "bg-violet-500/10 text-violet-400 border-violet-500/20"; badgeText = "Dự đoán"; }
                                            else if (iss.status === "Step5") { badgeColor = "bg-indigo-500/10 text-indigo-400 border-indigo-500/20"; badgeText = "Thí nghiệm"; }
                                            else if (iss.status === "Step6") { badgeColor = "bg-pink-500/10 text-pink-400 border-pink-500/20"; badgeText = "CAPA"; }
                                            else if (iss.status === "Completed") { 
                                                if (iss.resolutionStatus === "Not an issue") {
                                                    badgeColor = "bg-rose-500/10 text-rose-400 border-rose-500/20"; 
                                                    badgeText = "Không phải sự cố"; 
                                                } else {
                                                    badgeColor = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"; 
                                                    badgeText = "Đã giải quyết"; 
                                                }
                                            }

                                            return (
                                                <div
                                                    key={iss.id}
                                                    onClick={() => setSelectedIssueId(iss.id)}
                                                    className={cn(
                                                        "p-4 rounded-2xl border transition-all cursor-pointer space-y-3",
                                                        isSelected 
                                                            ? "bg-primary/10 border-primary/40 shadow-lg shadow-primary/5" 
                                                            : "bg-slate-900/20 border-white/5 hover:border-white/10 glass"
                                                    )}
                                                >
                                                    <div className="flex justify-between items-center">
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="text-xs font-black text-white">{iss.id}</span>
                                                            {(iss.isCustomerPortal || iss.id.startsWith("INC-")) && (
                                                                <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-teal-950 text-teal-300 border border-teal-800">
                                                                    Portal Viện
                                                                </span>
                                                            )}
                                                        </div>
                                                        <span className={cn("px-2 py-0.5 rounded-full text-[9px] font-bold border", badgeColor)}>
                                                            {badgeText}
                                                        </span>
                                                    </div>
                                                    <div className="space-y-1">
                                                        <p className="text-xs font-bold text-slate-200 line-clamp-1">{iss.productName}</p>
                                                        <p className="text-[10px] text-slate-400">Lô: <span className="font-mono text-slate-300">{iss.lotNumber}</span> | SP: <span className="font-mono text-slate-300">{iss.productCode}</span></p>
                                                    </div>
                                                    <div className="flex justify-between items-center border-t border-white/5 pt-2 text-[10px] text-slate-500">
                                                        <span className="line-clamp-1 max-w-[150px]">🏥 {iss.customerName}</span>
                                                        <span>📅 {iss.createdAt}</span>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>

                                {/* Right Side: Detail Stepper Wizard */}
                                <div className="lg:col-span-8">
                                    {(() => {
                                        const activeIssue = customerIssues.find(iss => iss.id === selectedIssueId);
                                        if (!activeIssue) {
                                            return (
                                                <div className="p-16 rounded-3xl bg-slate-900/20 border border-white/5 glass text-center space-y-4">
                                                    <div className="w-16 h-16 mx-auto bg-slate-800 rounded-full flex items-center justify-center text-slate-400">
                                                        <ShieldAlert className="w-8 h-8" />
                                                    </div>
                                                    <h3 className="text-sm font-bold text-white">Chưa chọn phiếu sự cố</h3>
                                                    <p className="text-xs text-slate-400 max-w-sm mx-auto">Vui lòng chọn một sự cố khách hàng bên cột danh sách để tiến hành phân tích hoặc khởi tạo quy trình tiếp nhận sự cố mới.</p>
                                                </div>
                                            );
                                        }

                                        // Step index for layout
                                        const STEPS = [
                                            { key: "Step1", label: "Tiếp nhận" },
                                            { key: "Step2", label: "Xác nhận" },
                                            { key: "Step3", label: "Khai thác sâu" },
                                            { key: "Step4", label: "Nguyên nhân" },
                                            { key: "Step5", label: "Thí nghiệm" },
                                            { key: "Step6", label: "CAPA" },
                                            { key: "Completed", label: "Hoàn thành" }
                                        ];

                                        const getStepIndex = (status: string) => {
                                            return STEPS.findIndex(s => s.key === status);
                                        };

                                        const currentStepIdx = getStepIndex(activeIssue.status);
                                        const isCompleted = activeIssue.status === "Completed";

                                        const handleNextStep = (next: string) => {
                                            if (activeViewedStep === activeIssue.status) {
                                                updateActiveIssue({ status: next });
                                            } else {
                                                setActiveViewedStep(next);
                                            }
                                        };

                                        const handlePrevStep = (prev: string) => {
                                            setActiveViewedStep(prev);
                                        };

                                        return (
                                            <div className="p-6 rounded-3xl bg-slate-900/40 border border-white/5 glass space-y-6 shadow-xl">
                                                {/* Ảnh / video / tài liệu của sự cố: xem và bổ sung ở mọi bước */}
                                                <div data-no-dirty className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                                                    <AttachmentPicker
                                                        files={Array.isArray(activeIssue.attachments) ? activeIssue.attachments : []}
                                                        onChange={(files) => updateActiveIssue({ attachments: files })}
                                                        label="Hình ảnh, video & tài liệu sự cố"
                                                        hint="Ảnh kết quả chạy máy, video hiện tượng, file dữ liệu máy (.pcrd, .eds), biên bản... Tối đa 200 MB mỗi tệp."
                                                    />
                                                </div>
                                                {/* Stepper visual progress bar */}
                                                <div className="border-b border-white/5 pb-6">
                                                    <div className="flex justify-between items-center flex-wrap gap-4 mb-6">
                                                        <div>
                                                            <h3 className="text-sm font-black text-white flex items-center gap-2">
                                                                🎯 Hồ Sơ Sự Cố: {activeIssue.id}
                                                            </h3>
                                                            <p className="text-xs text-slate-400 mt-0.5">Khách hàng: **{activeIssue.customerName}** | Tạo bởi: {activeIssue.createdBy}</p>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            {isCompleted && (
                                                                <span className={cn(
                                                                    "px-3 py-1 rounded-full text-[10px] font-black border uppercase tracking-wider",
                                                                    activeIssue.resolutionStatus === "Not an issue" 
                                                                        ? "bg-rose-500/10 text-rose-400 border-rose-500/20" 
                                                                        : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                                                )}>
                                                                    {activeIssue.resolutionStatus === "Not an issue" ? "Đã Đóng (Không phải sự cố)" : "Đã Đóng Quy Trình"}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Stepper bubbles */}
                                                    <div className="relative flex justify-between items-center w-full px-2">
                                                        <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-slate-800 -translate-y-1/2 z-0" />
                                                        <div 
                                                            className="absolute top-1/2 left-0 h-0.5 bg-primary -translate-y-1/2 z-0 transition-all duration-300"
                                                            style={{ width: `${(Math.min(currentStepIdx, 6) / 6) * 100}%` }}
                                                        />
                                                        
                                                        {STEPS.map((s, idx) => {
                                                            const isPassed = idx < currentStepIdx;
                                                            const isActive = idx === currentStepIdx;
                                                            const isCurrentlyViewed = s.key === activeViewedStep;
                                                            const isClickable = idx <= currentStepIdx;
                                                            
                                                            return (
                                                                <div 
                                                                    key={s.key} 
                                                                    onClick={() => {
                                                                        if (isClickable) {
                                                                            setActiveViewedStep(s.key);
                                                                        } else {
                                                                            showToast(`Bước "${s.label}" chưa được mở khóa. Hãy hoàn thành các bước trước đó!`, "warning");
                                                                        }
                                                                    }}
                                                                    className={cn(
                                                                        "flex flex-col items-center relative z-10 select-none",
                                                                        isClickable ? "cursor-pointer" : "cursor-not-allowed"
                                                                    )}
                                                                >
                                                                    <div 
                                                                        className={cn(
                                                                            "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border transition-all duration-300",
                                                                            isPassed ? "bg-primary border-primary text-white" :
                                                                            isActive ? "bg-slate-900 border-primary text-primary scale-110 shadow-lg shadow-primary/20" :
                                                                            "bg-slate-950 border-white/10 text-slate-500",
                                                                            isCurrentlyViewed ? "ring-2 ring-primary ring-offset-2 ring-offset-slate-950 scale-110" : ""
                                                                        )}
                                                                    >
                                                                        {isPassed ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                                                                    </div>
                                                                    <span 
                                                                        className={cn(
                                                                            "text-[9px] mt-2 font-bold tracking-tight whitespace-nowrap hidden sm:inline-block",
                                                                            isCurrentlyViewed ? "text-primary underline decoration-2 underline-offset-4" :
                                                                            isActive ? "text-primary" : 
                                                                            isClickable ? "text-slate-300 hover:text-white" : "text-slate-500"
                                                                        )}
                                                                    >
                                                                        {s.label}
                                                                    </span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>

                                                {/* Active Step Panel */}
                                                <div className="space-y-6 min-h-[300px]">
                                                    {/* STEP 1: Reception details */}
                                                    {activeViewedStep === "Step1" && (
                                                        <div className="space-y-4">
                                                            <div className="p-4 rounded-2xl bg-slate-950/40 border border-white/5 space-y-3">
                                                                <div className="flex items-center justify-between">
                                                                    <h4 className="text-xs font-bold text-white uppercase tracking-wider text-primary">Thông tin tiếp nhận ban đầu</h4>
                                                                    {activeIssue.isCustomerPortal && (
                                                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-950 text-teal-300 border border-teal-800">
                                                                            Đồng bộ tự động từ Cổng Khách Hàng
                                                                        </span>
                                                                    )}
                                                                </div>

                                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs p-3 bg-slate-900/60 rounded-xl border border-white/5">
                                                                    <div>
                                                                        <span className="text-slate-500 text-[10px] block">Mã sản phẩm:</span>
                                                                        <p className="font-mono text-slate-200 mt-0.5">{activeIssue.productCode}</p>
                                                                    </div>
                                                                    <div>
                                                                        <span className="text-slate-500 text-[10px] block">Tên sản phẩm:</span>
                                                                        <p className="text-slate-200 mt-0.5 font-semibold line-clamp-1">{activeIssue.productName}</p>
                                                                    </div>
                                                                    <div>
                                                                        <span className="text-slate-500 text-[10px] block">Số lô (Lot):</span>
                                                                        <p className="font-mono text-amber-300 mt-0.5">{activeIssue.lotNumber}</p>
                                                                    </div>
                                                                    <div>
                                                                        <span className="text-slate-500 text-[10px] block">Mức độ ưu tiên:</span>
                                                                        <p className="text-rose-400 font-bold mt-0.5">{activeIssue.severity || "MEDIUM"}</p>
                                                                    </div>
                                                                </div>

                                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs p-3 bg-slate-900/40 rounded-xl border border-white/5">
                                                                    <div>
                                                                        <span className="text-slate-500 text-[10px] block">Đơn vị / Bệnh viện:</span>
                                                                        <p className="text-slate-200 font-bold mt-0.5">🏥 {activeIssue.hospitalName || activeIssue.customerName}</p>
                                                                    </div>
                                                                    <div>
                                                                        <span className="text-slate-500 text-[10px] block">Người liên hệ &amp; SĐT:</span>
                                                                        <p className="text-slate-300 mt-0.5">📞 {activeIssue.contactInfo || "Chưa cập nhật"}</p>
                                                                    </div>
                                                                </div>

                                                                {/* Root cause investigation data if reported by client */}
                                                                {activeIssue.rootCauseData && Object.keys(activeIssue.rootCauseData).length > 0 && (
                                                                    <div className="p-3 bg-slate-900/70 rounded-xl border border-teal-800/40 space-y-2 text-xs">
                                                                        <span className="text-[10px] uppercase font-bold text-teal-400 block tracking-wider">
                                                                            Dữ liệu kỹ thuật do Bệnh viện cung cấp:
                                                                        </span>
                                                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                                                                            {activeIssue.rootCauseData.storage_temp && (
                                                                                <div>
                                                                                    <span className="text-slate-500 block text-[10px]">Nhiệt độ bảo quản:</span>
                                                                                    <strong className="text-slate-200">{activeIssue.rootCauseData.storage_temp}</strong>
                                                                                </div>
                                                                            )}
                                                                            {activeIssue.rootCauseData.internal_control && (
                                                                                <div>
                                                                                    <span className="text-slate-500 block text-[10px]">Chứng nội (IC):</span>
                                                                                    <strong className="text-slate-200">{activeIssue.rootCauseData.internal_control}</strong>
                                                                                </div>
                                                                            )}
                                                                            {activeIssue.rootCauseData.frequency && (
                                                                                <div>
                                                                                    <span className="text-slate-500 block text-[10px]">Tần suất:</span>
                                                                                    <strong className="text-slate-200">{activeIssue.rootCauseData.frequency}</strong>
                                                                                </div>
                                                                            )}
                                                                            {activeIssue.rootCauseData.cross_check && (
                                                                                <div>
                                                                                    <span className="text-slate-500 block text-[10px]">Đối chứng chéo:</span>
                                                                                    <strong className="text-slate-200">{activeIssue.rootCauseData.cross_check}</strong>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                        {activeIssue.incidentCategories && activeIssue.incidentCategories.length > 0 && (
                                                                            <div className="pt-1 border-t border-white/5 text-[11px]">
                                                                                <span className="text-slate-500 text-[10px]">Nhóm lỗi nghi ngờ: </span>
                                                                                <strong className="text-amber-300">{Array.isArray(activeIssue.incidentCategories) ? activeIssue.incidentCategories.join(", ") : activeIssue.incidentCategories}</strong>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )}

                                                                <div className="border-t border-white/5 pt-3">
                                                                    <span className="text-xs text-slate-500">Mô tả sự cố khách hàng báo cáo:</span>
                                                                    <p className="text-xs text-slate-300 mt-1 bg-slate-900/60 p-3 rounded-xl border border-white/5 italic">"{activeIssue.description}"</p>
                                                                </div>

                                                                {/* Attachments from client */}
                                                                {/* tệp đính kèm hiển thị ở khung chung phía trên (mọi bước) */}
                                                            </div>
                                                            <div className="flex justify-end pt-4 border-t border-white/5">
                                                                <button
                                                                    onClick={() => handleNextStep("Step2")}
                                                                    className="px-5 py-2.5 bg-primary hover:bg-primary/95 text-white font-bold rounded-xl text-xs active:scale-95 shadow transition-all"
                                                                >
                                                                    Tiếp tục sang Bước 2: Xác nhận sự cố
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* STEP 2: Verification */}
                                                    {activeViewedStep === "Step2" && (
                                                        <div className="space-y-5">
                                                            <div className="space-y-2">
                                                                <label className="text-xs font-bold text-slate-500 uppercase">Xác minh xem khiếu nại có phải là sự cố thực tế hay không?</label>
                                                                <div className="grid grid-cols-2 gap-4">
                                                                    <div 
                                                                        onClick={() => updateActiveIssue({ isRealIssue: true })}
                                                                        className={cn(
                                                                            "p-4 rounded-2xl border cursor-pointer transition-all space-y-2 text-center",
                                                                            activeIssue.isRealIssue === true 
                                                                                ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400" 
                                                                                : "bg-slate-950/40 border-white/5 hover:border-white/10 text-slate-400"
                                                                        )}
                                                                    >
                                                                        <p className="text-xs font-black">✔️ Đúng là sự cố xảy ra</p>
                                                                        <p className="text-[10px] opacity-75">Cần đi sâu tìm nguyên nhân và hỗ trợ khẩn cấp</p>
                                                                    </div>
                                                                    <div 
                                                                        onClick={() => updateActiveIssue({ isRealIssue: false })}
                                                                        className={cn(
                                                                            "p-4 rounded-2xl border cursor-pointer transition-all space-y-2 text-center",
                                                                            activeIssue.isRealIssue === false 
                                                                                ? "bg-rose-500/10 border-rose-500/40 text-rose-400" 
                                                                                : "bg-slate-950/40 border-white/5 hover:border-white/10 text-slate-400"
                                                                        )}
                                                                    >
                                                                        <p className="text-xs font-black">❌ Không phải sự cố thực tế</p>
                                                                        <p className="text-[10px] opacity-75">Khách hàng thao tác sai hoặc do lý do khách quan khác</p>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {activeIssue.isRealIssue === false && (
                                                                <motion.div 
                                                                    initial={{ opacity: 0, y: 10 }}
                                                                    animate={{ opacity: 1, y: 0 }}
                                                                    className="space-y-2"
                                                                >
                                                                    <label className="text-xs font-bold text-slate-500 uppercase">Giải trình chi tiết vì sao không phải sự cố</label>
                                                                    <textarea
                                                                        rows={3}
                                                                        placeholder="Ví dụ: Medlatec dùng sai chương trình nhiệt trên máy PCR, hoặc nhầm chứng âm thành chứng dương..."
                                                                        value={activeIssue.notRealIssueReason || ""}
                                                                        onChange={(e) => updateActiveIssue({ notRealIssueReason: e.target.value })}
                                                                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                                                    />
                                                                </motion.div>
                                                            )}

                                                            {activeIssue.isRealIssue === true && (
                                                                <motion.div 
                                                                    initial={{ opacity: 0, y: 10 }}
                                                                    animate={{ opacity: 1, y: 0 }}
                                                                    className="space-y-2"
                                                                >
                                                                    <label className="text-xs font-bold text-slate-500 uppercase">Giải pháp cấp bách xử lý nhu cầu hiện tại của khách hàng</label>
                                                                    <textarea
                                                                        required
                                                                        rows={3}
                                                                        placeholder="Ví dụ: Gửi gấp một hộp kit lô khác thay thế, hoặc hướng dẫn chạy giảm nồng độ mẫu..."
                                                                        value={activeIssue.emergencySolution || ""}
                                                                        onChange={(e) => updateActiveIssue({ emergencySolution: e.target.value })}
                                                                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                                                    />
                                                                </motion.div>
                                                            )}

                                                            <div className="flex justify-between items-center pt-4 border-t border-white/5">
                                                                <button
                                                                    onClick={() => handlePrevStep("Step1")}
                                                                    className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white transition-colors"
                                                                >
                                                                    Quay lại
                                                                </button>
                                                                
                                                                {activeIssue.isRealIssue === false && (
                                                                    <button
                                                                        onClick={() => {
                                                                            if (!(activeIssue.notRealIssueReason || "").trim()) {
                                                                                showToast("Vui lòng nhập giải trình chi tiết lý do!", "warning");
                                                                                return;
                                                                            }
                                                                            updateActiveIssue({ status: "Completed", resolutionStatus: "Not an issue" });
                                                                            showToast("Đã đóng quy trình sự cố với kết luận không phải sự cố.", "info");
                                                                        }}
                                                                        className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs active:scale-95 shadow transition-all"
                                                                    >
                                                                        Hoàn thành &amp; Đóng quy trình
                                                                    </button>
                                                                )}

                                                                {activeIssue.isRealIssue === true && (
                                                                    <button
                                                                        onClick={() => {
                                                                            if (!(activeIssue.emergencySolution || "").trim()) {
                                                                                showToast("Vui lòng nhập phương án xử lý khẩn cấp!", "warning");
                                                                                return;
                                                                            }
                                                                            handleNextStep("Step3");
                                                                        }}
                                                                        className="px-5 py-2.5 bg-primary hover:bg-primary/95 text-white font-bold rounded-xl text-xs active:scale-95 shadow transition-all"
                                                                    >
                                                                        Lưu &amp; Chuyển sang Bước 3
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* STEP 3: Deep investigation / Understanding */}
                                                    {activeViewedStep === "Step3" && (
                                                        <div className="space-y-5">
                                                            <div className="grid grid-cols-2 gap-4">
                                                                <div className="space-y-2">
                                                                    <label className="text-xs font-bold text-slate-500 uppercase">Tình trạng mở nắp hộp</label>
                                                                    <select
                                                                        value={activeIssue.firstTimeUsing === null ? "" : String(activeIssue.firstTimeUsing)}
                                                                        onChange={(e) => {
                                                                            const val = e.target.value === "" ? null : e.target.value === "true";
                                                                            updateActiveIssue({ firstTimeUsing: val });
                                                                        }}
                                                                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                                                    >
                                                                        <option value="">-- Chọn tình trạng --</option>
                                                                        <option value="true">Sử dụng lần đầu tiên mới khui hộp</option>
                                                                        <option value="false">Đã qua sử dụng từ lần thứ 2 trở đi</option>
                                                                    </select>
                                                                </div>
                                                                <div className="space-y-2">
                                                                    <label className="text-xs font-bold text-slate-500 uppercase">Phạm vi xảy ra sự cố</label>
                                                                    <select
                                                                        value={activeIssue.sampleScope || "Single"}
                                                                        onChange={(e) => updateActiveIssue({ sampleScope: e.target.value })}
                                                                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                                                    >
                                                                        <option value="Single">Chỉ xảy ra ở một vài mẫu đặc thù</option>
                                                                        <option value="All">Xảy ra trên tất cả mẫu trong phiên chạy</option>
                                                                    </select>
                                                                </div>
                                                            </div>

                                                            {/* Checkbox checks list */}
                                                            <div className="space-y-2">
                                                                <label className="text-xs font-bold text-slate-500 uppercase">Các yếu tố kỹ thuật đã kiểm tra nhanh (Stick chọn)</label>
                                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-2xl bg-slate-950/40 border border-white/5 text-xs">
                                                                    {(() => {
                                                                        const defaultItems = [
                                                                            "Lô hàng mới sử dụng lần đầu",
                                                                            "Xảy ra trên tất cả các mẫu",
                                                                            "Chứng dương chạy bình thường",
                                                                            "Chứng âm không lên (sạch)",
                                                                            "Hóa chất bảo quản đúng nhiệt độ",
                                                                            "Thiết bị PCR đã được hiệu chuẩn định kỳ"
                                                                        ];
                                                                        const items = activeIssue.investigationItems || defaultItems;
                                                                        
                                                                        return items.map((item: string) => {
                                                                            const isChecked = (activeIssue.checkedInvestigationItems || []).includes(item);
                                                                            return (
                                                                                <div key={item} className="flex items-center justify-between gap-2 p-1.5 rounded-lg hover:bg-white/5 transition-colors group">
                                                                                    <label className="flex items-center gap-2.5 text-slate-300 hover:text-white cursor-pointer select-none flex-1 min-w-0">
                                                                                        <input
                                                                                            type="checkbox"
                                                                                            checked={isChecked}
                                                                                            onChange={() => {
                                                                                                const current = activeIssue.checkedInvestigationItems || [];
                                                                                                const next = isChecked 
                                                                                                    ? current.filter((c: any) => c !== item)
                                                                                                    : [...current, item];
                                                                                                updateActiveIssue({ checkedInvestigationItems: next });
                                                                                            }}
                                                                                            className="rounded border-white/10 bg-slate-950 text-primary focus:ring-0 focus:ring-offset-0 w-4 h-4 flex-shrink-0"
                                                                                        />
                                                                                        <span className="truncate">{item}</span>
                                                                                    </label>
                                                                                    
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => {
                                                                                            const nextItems = items.filter((i: string) => i !== item);
                                                                                            const nextChecked = (activeIssue.checkedInvestigationItems || []).filter((c: string) => c !== item);
                                                                                            updateActiveIssue({
                                                                                                investigationItems: nextItems,
                                                                                                checkedInvestigationItems: nextChecked
                                                                                            });
                                                                                        }}
                                                                                        className="text-slate-500 hover:text-rose-400 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                                                                        title="Xóa yếu tố kiểm tra này"
                                                                                    >
                                                                                        <X className="w-3.5 h-3.5" />
                                                                                    </button>
                                                                                </div>
                                                                            );
                                                                        });
                                                                    })()}
                                                                </div>

                                                                {/* Input to add custom checklists */}
                                                                <div className="flex gap-2 mt-2">
                                                                    <input
                                                                        type="text"
                                                                        placeholder="Thêm yếu tố kỹ thuật cần kiểm định khác..."
                                                                        value={newChecklistItemText}
                                                                        onChange={(e) => setNewChecklistItemText(e.target.value)}
                                                                        onKeyDown={(e) => {
                                                                            if (e.key === "Enter") {
                                                                                e.preventDefault();
                                                                                const defaultItems = [
                                                                                    "Lô hàng mới sử dụng lần đầu",
                                                                                    "Xảy ra trên tất cả các mẫu",
                                                                                    "Chứng dương chạy bình thường",
                                                                                    "Chứng âm không lên (sạch)",
                                                                                    "Hóa chất bảo quản đúng nhiệt độ",
                                                                                    "Thiết bị PCR đã được hiệu chuẩn định kỳ"
                                                                                ];
                                                                                const items = activeIssue.investigationItems || defaultItems;
                                                                                const trimmed = newChecklistItemText.trim();
                                                                                if (!trimmed) return;
                                                                                if (items.includes(trimmed)) return;
                                                                                updateActiveIssue({
                                                                                    investigationItems: [...items, trimmed]
                                                                                });
                                                                                setNewChecklistItemText("");
                                                                            }
                                                                        }}
                                                                        className="flex-1 bg-slate-950 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                                                    />
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => {
                                                                            const defaultItems = [
                                                                                "Lô hàng mới sử dụng lần đầu",
                                                                                "Xảy ra trên tất cả các mẫu",
                                                                                "Chứng dương chạy bình thường",
                                                                                "Chứng âm không lên (sạch)",
                                                                                "Hóa chất bảo quản đúng nhiệt độ",
                                                                                "Thiết bị PCR đã được hiệu chuẩn định kỳ"
                                                                            ];
                                                                            const items = activeIssue.investigationItems || defaultItems;
                                                                            const trimmed = newChecklistItemText.trim();
                                                                            if (!trimmed) return;
                                                                            if (items.includes(trimmed)) return;
                                                                            updateActiveIssue({
                                                                                investigationItems: [...items, trimmed]
                                                                            });
                                                                            setNewChecklistItemText("");
                                                                        }}
                                                                        className="px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/5 font-bold rounded-xl text-xs flex items-center gap-1 transition active:scale-95 shadow"
                                                                    >
                                                                        <Plus className="w-3.5 h-3.5" /> Thêm
                                                                    </button>
                                                                </div>
                                                            </div>

                                                            {/* File attachment & production info */}
                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-white/5 pt-4">
                                                                {/* Left: Customer Attachments */}
                                                                <div className="space-y-3">
                                                                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                                                                        <span>1. Tài liệu, hình ảnh từ KHÁCH HÀNG</span>
                                                                        <span className="text-slate-500 font-normal">{(activeIssue.customerAttachments || []).length} tệp</span>
                                                                    </label>

                                                                    {/* Customer Attachments List */}
                                                                    {(activeIssue.customerAttachments || []).length > 0 && (
                                                                        <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                                                                            {(activeIssue.customerAttachments || []).map((file: any) => {
                                                                                const isImage = file.type?.startsWith("image/");
                                                                                return (
                                                                                    <div key={file.id} className="flex items-center justify-between p-2 rounded-xl bg-slate-950/60 border border-white/5 gap-3 group hover:border-white/10 transition-all">
                                                                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                                                                            {isImage && file.dataUrl ? (
                                                                                                <a href={file.dataUrl} target="_blank" rel="noopener noreferrer" className="w-8 h-8 rounded-lg overflow-hidden border border-white/10 flex-shrink-0 cursor-pointer block hover:opacity-85 transition-all">
                                                                                                    <img src={file.dataUrl} alt={file.name} className="w-full h-full object-cover" />
                                                                                                </a>
                                                                                            ) : (
                                                                                                <div className="w-8 h-8 rounded-lg bg-slate-900 border border-white/5 flex items-center justify-center flex-shrink-0">
                                                                                                    <FileText className="w-4 h-4 text-slate-400" />
                                                                                                </div>
                                                                                            )}
                                                                                            <div className="min-w-0 flex-1">
                                                                                                <p className="text-[11px] text-slate-200 truncate font-semibold" title={file.name}>{file.name}</p>
                                                                                                <p className="text-[9px] text-slate-500 font-bold uppercase">{file.size ? `${(file.size / 1024).toFixed(1)} KB` : "N/A"}</p>
                                                                                            </div>
                                                                                        </div>
                                                                                        <button
                                                                                            type="button"
                                                                                            onClick={() => {
                                                                                                const next = (activeIssue.customerAttachments || []).filter((a: any) => a.id !== file.id);
                                                                                                updateActiveIssue({ customerAttachments: next });
                                                                                                showToast("Đã xóa tệp đính kèm khách hàng!", "info");
                                                                                            }}
                                                                                            className="text-slate-500 hover:text-rose-400 p-1.5 rounded-lg hover:bg-white/5 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                                                                                        >
                                                                                            <Trash2 className="w-3.5 h-3.5" />
                                                                                        </button>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    )}

                                                                    {/* Customer Uploader zone */}
                                                                    <div className="flex items-center gap-2">
                                                                        <input
                                                                            type="file"
                                                                            id={`customerAttach-${activeIssue.id}`}
                                                                            multiple
                                                                            onChange={(e) => {
                                                                                const files = Array.from(e.target.files || []);
                                                                                const max_size = 1.5 * 1024 * 1024;
                                                                                files.forEach(file => {
                                                                                    if (file.size > max_size) {
                                                                                        showToast(`File "${file.name}" vượt quá 1.5MB.`, "warning");
                                                                                        return;
                                                                                    }
                                                                                    if (file.type.startsWith("image/")) {
                                                                                        const reader = new FileReader();
                                                                                        reader.onload = (event) => {
                                                                                            const dataUrl = event.target?.result as string;
                                                                                            const newAttach = {
                                                                                                id: Date.now().toString() + "-" + Math.random().toString(36).substr(2, 5),
                                                                                                name: file.name,
                                                                                                size: file.size,
                                                                                                type: file.type,
                                                                                                dataUrl: dataUrl
                                                                                            };
                                                                                            const current = activeIssue.customerAttachments || [];
                                                                                            updateActiveIssue({ customerAttachments: [...current, newAttach] });
                                                                                        };
                                                                                        reader.readAsDataURL(file);
                                                                                    } else {
                                                                                        const newAttach = {
                                                                                            id: Date.now().toString() + "-" + Math.random().toString(36).substr(2, 5),
                                                                                            name: file.name,
                                                                                            size: file.size,
                                                                                            type: file.type
                                                                                        };
                                                                                        const current = activeIssue.customerAttachments || [];
                                                                                        updateActiveIssue({ customerAttachments: [...current, newAttach] });
                                                                                    }
                                                                                });
                                                                                showToast("Đã thêm tài liệu từ khách hàng!", "success");
                                                                                e.target.value = "";
                                                                            }}
                                                                            className="hidden"
                                                                        />
                                                                        <label
                                                                            htmlFor={`customerAttach-${activeIssue.id}`}
                                                                            className="w-full bg-slate-950/40 border border-white/5 hover:bg-white/5 text-slate-400 rounded-xl px-3 py-4 text-xs text-center cursor-pointer border-dashed flex items-center justify-center gap-2 hover:border-primary/40 transition-all font-semibold active:scale-[0.99]"
                                                                        >
                                                                            <Upload className="w-4 h-4 text-slate-500" /> Đính kèm file/Gel từ khách hàng...
                                                                        </label>
                                                                    </div>
                                                                </div>

                                                                {/* Right: Internal Biolab Production & QC Attachments */}
                                                                <div className="space-y-3">
                                                                    <div className="space-y-1.5">
                                                                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">2. Thông tin sản xuất &amp; QC lô hàng (Biolab)</label>
                                                                        <textarea
                                                                            rows={2}
                                                                            placeholder="Tra cứu sổ tay lô: Lô đóng ống ngày 20/07, QA/QC thông qua đạt độ nhạy tối đa..."
                                                                            value={activeIssue.productionQCInfo || ""}
                                                                            onChange={(e) => updateActiveIssue({ productionQCInfo: e.target.value })}
                                                                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                                                        />
                                                                    </div>

                                                                    {/* Internal QC Attachments List */}
                                                                    {(activeIssue.internalQCAttachments || []).length > 0 && (
                                                                        <div className="space-y-2 max-h-[100px] overflow-y-auto pr-1">
                                                                            {(activeIssue.internalQCAttachments || []).map((file: any) => {
                                                                                const isImage = file.type?.startsWith("image/");
                                                                                return (
                                                                                    <div key={file.id} className="flex items-center justify-between p-2 rounded-xl bg-slate-950/60 border border-white/5 gap-3 group hover:border-white/10 transition-all">
                                                                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                                                                            {isImage && file.dataUrl ? (
                                                                                                <a href={file.dataUrl} target="_blank" rel="noopener noreferrer" className="w-8 h-8 rounded-lg overflow-hidden border border-white/10 flex-shrink-0 cursor-pointer block hover:opacity-85 transition-all">
                                                                                                    <img src={file.dataUrl} alt={file.name} className="w-full h-full object-cover" />
                                                                                                </a>
                                                                                            ) : (
                                                                                                <div className="w-8 h-8 rounded-lg bg-slate-900 border border-white/5 flex items-center justify-center flex-shrink-0">
                                                                                                    <FileText className="w-4 h-4 text-slate-400" />
                                                                                                </div>
                                                                                            )}
                                                                                            <div className="min-w-0 flex-1">
                                                                                                <p className="text-[11px] text-slate-200 truncate font-semibold" title={file.name}>{file.name}</p>
                                                                                                <p className="text-[9px] text-slate-500 font-bold uppercase">{file.size ? `${(file.size / 1024).toFixed(1)} KB` : "N/A"}</p>
                                                                                            </div>
                                                                                        </div>
                                                                                        <button
                                                                                            type="button"
                                                                                            onClick={() => {
                                                                                                const next = (activeIssue.internalQCAttachments || []).filter((a: any) => a.id !== file.id);
                                                                                                updateActiveIssue({ internalQCAttachments: next });
                                                                                                showToast("Đã xóa tệp đính kèm nội bộ!", "info");
                                                                                            }}
                                                                                            className="text-slate-500 hover:text-rose-400 p-1.5 rounded-lg hover:bg-white/5 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                                                                                        >
                                                                                            <Trash2 className="w-3.5 h-3.5" />
                                                                                        </button>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    )}

                                                                    {/* Internal QC Uploader zone */}
                                                                    <div className="flex items-center gap-2">
                                                                        <input
                                                                            type="file"
                                                                            id={`internalAttach-${activeIssue.id}`}
                                                                            multiple
                                                                            onChange={(e) => {
                                                                                const files = Array.from(e.target.files || []);
                                                                                const max_size = 1.5 * 1024 * 1024;
                                                                                files.forEach(file => {
                                                                                    if (file.size > max_size) {
                                                                                        showToast(`File "${file.name}" vượt quá 1.5MB.`, "warning");
                                                                                        return;
                                                                                    }
                                                                                    if (file.type.startsWith("image/")) {
                                                                                        const reader = new FileReader();
                                                                                        reader.onload = (event) => {
                                                                                            const dataUrl = event.target?.result as string;
                                                                                            const newAttach = {
                                                                                                id: Date.now().toString() + "-" + Math.random().toString(36).substr(2, 5),
                                                                                                name: file.name,
                                                                                                size: file.size,
                                                                                                type: file.type,
                                                                                                dataUrl: dataUrl
                                                                                            };
                                                                                            const current = activeIssue.internalQCAttachments || [];
                                                                                            updateActiveIssue({ internalQCAttachments: [...current, newAttach] });
                                                                                        };
                                                                                        reader.readAsDataURL(file);
                                                                                    } else {
                                                                                        const newAttach = {
                                                                                            id: Date.now().toString() + "-" + Math.random().toString(36).substr(2, 5),
                                                                                            name: file.name,
                                                                                            size: file.size,
                                                                                            type: file.type
                                                                                        };
                                                                                        const current = activeIssue.internalQCAttachments || [];
                                                                                        updateActiveIssue({ internalQCAttachments: [...current, newAttach] });
                                                                                    }
                                                                                });
                                                                                showToast("Đã thêm tài liệu sản xuất & QC!", "success");
                                                                                e.target.value = "";
                                                                            }}
                                                                            className="hidden"
                                                                        />
                                                                        <label
                                                                            htmlFor={`internalAttach-${activeIssue.id}`}
                                                                            className="w-full bg-slate-950/40 border border-white/5 hover:bg-white/5 text-slate-400 rounded-xl px-3 py-4 text-xs text-center cursor-pointer border-dashed flex items-center justify-center gap-2 hover:border-primary/40 transition-all font-semibold active:scale-[0.99]"
                                                                        >
                                                                            <Upload className="w-4 h-4 text-slate-500" /> Đính kèm file hồ sơ QC & sản xuất...
                                                                        </label>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* GUIDELINES & ANSWERS INPUT SECTION */}
                                                            <div className="space-y-3 border-t border-white/5 pt-4">
                                                                <h4 className="text-xs font-bold text-white uppercase tracking-wider text-primary flex items-center gap-1.5">
                                                                    <span>📋 Cẩm nang Khai thác Thông tin Sự cố (Hỏi từ Chung đến Cụ thể)</span>
                                                                </h4>
                                                                <p className="text-[10px] text-slate-400">Hãy hỏi khách hàng và đối chiếu chi tiết theo 7 nhóm thông tin dưới đây để xác định chính xác nguyên nhân gốc rễ.</p>

                                                                {/* Tab buttons */}
                                                                <div className="flex flex-wrap gap-1.5 bg-slate-950/60 p-1 rounded-xl border border-white/5">
                                                                    {[
                                                                        { key: "productKit", label: "1. Sản phẩm/Kit" },
                                                                        { key: "sampleInfo", label: "2. Mẫu bệnh phẩm" },
                                                                        { key: "protocolInfo", label: "3. Quy trình chạy" },
                                                                        { key: "eqEnvInfo", label: "4. Thiết bị & Môi trường" },
                                                                        { key: "problemObs", label: "5. Kết quả quan sát" },
                                                                        { key: "userHistory", label: "6. Người dùng & Lịch sử" },
                                                                        { key: "otherFactors", label: "7. Yếu tố khác" }
                                                                    ].map(tab => (
                                                                        <button
                                                                            key={tab.key}
                                                                            type="button"
                                                                            onClick={() => setGuidebookActiveTab(tab.key)}
                                                                            className={cn(
                                                                                "px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all",
                                                                                guidebookActiveTab === tab.key 
                                                                                    ? "bg-primary text-white shadow-sm shadow-primary/20" 
                                                                                    : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
                                                                            )}
                                                                        >
                                                                            {tab.label}
                                                                        </button>
                                                                    ))}
                                                                </div>

                                                                {/* Tab contents showing questions and inputs */}
                                                                <div className="p-4 rounded-2xl bg-slate-950/40 border border-white/5 space-y-4">
                                                                    {guidebookActiveTab === "productKit" && (
                                                                        <div className="space-y-3">
                                                                            <div className="bg-primary/5 border border-primary/10 rounded-xl p-3 text-[11px] text-slate-300 space-y-1.5 leading-relaxed">
                                                                                <p className="font-bold text-primary">Các thông tin cần khai thác:</p>
                                                                                <ul className="list-disc pl-4 space-y-1 text-slate-400">
                                                                                    <li>Tên đầy đủ kit, mã sản phẩm (catalog number), số lô (lot/batch), hạn sử dụng.</li>
                                                                                    <li>Điều kiện bảo quản thực tế (nhiệt độ tủ, thời gian để ngoài phòng, số lần đông-rã).</li>
                                                                                    <li>Ngày mở kit lần đầu, số lần sử dụng trước đó, tình trạng các thành phần (đóng băng, kết tủa, màu sắc, thể tích còn lại).</li>
                                                                                    <li>Có dùng kèm reagent/buffer/enzyme từ lô khác hoặc từ hãng khác không.</li>
                                                                                    <li>Phiên bản protocol đang dùng (có cập nhật mới không).</li>
                                                                                </ul>
                                                                            </div>
                                                                            <div className="space-y-1.5">
                                                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Ghi nhận thông tin sản phẩm &amp; kit thực tế:</label>
                                                                                <textarea
                                                                                    rows={3}
                                                                                    value={(activeIssue.investigationDetails || {}).productKit || ""}
                                                                                    onChange={(e) => {
                                                                                        const details = activeIssue.investigationDetails || {};
                                                                                        updateActiveIssue({
                                                                                            investigationDetails: { ...details, productKit: e.target.value }
                                                                                        });
                                                                                    }}
                                                                                    placeholder="Nhập ghi chép chi tiết về tình trạng bảo quản, hạn dùng, phiên bản protocol của khách..."
                                                                                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {guidebookActiveTab === "sampleInfo" && (
                                                                        <div className="space-y-3">
                                                                            <div className="bg-primary/5 border border-primary/10 rounded-xl p-3 text-[11px] text-slate-300 space-y-1.5 leading-relaxed">
                                                                                <p className="font-bold text-primary">Các thông tin cần khai thác:</p>
                                                                                <ul className="list-disc pl-4 space-y-1 text-slate-400">
                                                                                    <li>Loại mẫu (máu, mô, swab, nước tiểu, môi trường, tế bào nuôi cấy…).</li>
                                                                                    <li>Số lượng/thể tích mẫu đầu vào, nồng độ/ước lượng số bản sao (nếu biết).</li>
                                                                                    <li>Cách lấy, bảo quản, vận chuyển và xử lý mẫu trước khi tách (thời gian, nhiệt độ, chất bảo quản, đông-rã).</li>
                                                                                    <li>Tình trạng mẫu (đông, tan, lẫn máu, nhầy, nhiễm bẩn…).</li>
                                                                                    <li>Có mẫu chứng dương/chứng âm đi kèm không và kết quả của chúng.</li>
                                                                                </ul>
                                                                            </div>
                                                                            <div className="space-y-1.5">
                                                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Ghi nhận thông tin về mẫu bệnh phẩm:</label>
                                                                                <textarea
                                                                                    rows={3}
                                                                                    value={(activeIssue.investigationDetails || {}).sampleInfo || ""}
                                                                                    onChange={(e) => {
                                                                                        const details = activeIssue.investigationDetails || {};
                                                                                        updateActiveIssue({
                                                                                            investigationDetails: { ...details, sampleInfo: e.target.value }
                                                                                        });
                                                                                    }}
                                                                                    placeholder="Nhập ghi chép về loại mẫu, thể tích mẫu đầu vào, tình trạng đông rã, kết quả mẫu chứng của khách..."
                                                                                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {guidebookActiveTab === "protocolInfo" && (
                                                                        <div className="space-y-3">
                                                                            <div className="bg-primary/5 border border-primary/10 rounded-xl p-3 text-[11px] text-slate-300 space-y-1.5 leading-relaxed">
                                                                                <p className="font-bold text-primary">Các thông tin cần khai thác:</p>
                                                                                <ul className="list-disc pl-4 space-y-1 text-slate-400">
                                                                                    <li>Protocol chính xác đang theo (từng bước, thời gian ủ, tốc độ ly tâm, nhiệt độ…).</li>
                                                                                    <li>Có sai lệch so với hướng dẫn không (thể tích, thời gian, bước bỏ qua, thay đổi buffer…).</li>
                                                                                    <li>Dụng cụ tiêu hao dùng chung (pipet tip, ống, plate) có DNase/RNase-free, có tiệt trùng không.</li>
                                                                                    <li>Thứ tự thao tác, khu vực làm việc (có tách biệt pre/post-PCR không), biện pháp chống nhiễm chéo.</li>
                                                                                    <li>Tách chiết: phương pháp (cột, hạt từ, organic...), bước rửa, elute, độ tinh sạch (A260/280, A260/230).</li>
                                                                                    <li>PCR/qPCR: thành phần mix (master mix, primer/probe, template), thể tích phản ứng, chương trình nhiệt, nồng độ primer/probe/Mg²⁺.</li>
                                                                                </ul>
                                                                            </div>
                                                                            <div className="space-y-1.5">
                                                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Ghi nhận chi tiết quy trình thực hiện thực tế:</label>
                                                                                <textarea
                                                                                    rows={3}
                                                                                    value={(activeIssue.investigationDetails || {}).protocolInfo || ""}
                                                                                    onChange={(e) => {
                                                                                        const details = activeIssue.investigationDetails || {};
                                                                                        updateActiveIssue({
                                                                                            investigationDetails: { ...details, protocolInfo: e.target.value }
                                                                                        });
                                                                                    }}
                                                                                    placeholder="Ghi nhận sai khác trong thao tác, nồng độ master mix, thông số chương trình nhiệt và chỉ số đo OD 260/280..."
                                                                                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {guidebookActiveTab === "eqEnvInfo" && (
                                                                        <div className="space-y-3">
                                                                            <div className="bg-primary/5 border border-primary/10 rounded-xl p-3 text-[11px] text-slate-300 space-y-1.5 leading-relaxed">
                                                                                <p className="font-bold text-primary">Các thông tin cần khai thác:</p>
                                                                                <ul className="list-disc pl-4 space-y-1 text-slate-400">
                                                                                    <li>Model máy (ly tâm, vortex, PCR/qPCR machine, spectrophotometer…), số serial, lịch hiệu chuẩn gần nhất.</li>
                                                                                    <li>Cài đặt cụ thể (tốc độ, nhiệt độ, ramp rate, detection channel, threshold, baseline…).</li>
                                                                                    <li>Điều kiện phòng lab (nhiệt độ, độ ẩm, ánh sáng UV, luồng khí).</li>
                                                                                    <li>Có sự cố thiết bị gần đây không (lỗi nhiệt, nhiễu baseline, lỗi optical…).</li>
                                                                                </ul>
                                                                            </div>
                                                                            <div className="space-y-1.5">
                                                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Ghi nhận thông tin thiết bị &amp; môi trường phòng Lab:</label>
                                                                                <textarea
                                                                                    rows={3}
                                                                                    value={(activeIssue.investigationDetails || {}).eqEnvInfo || ""}
                                                                                    onChange={(e) => {
                                                                                        const details = activeIssue.investigationDetails || {};
                                                                                        updateActiveIssue({
                                                                                            investigationDetails: { ...details, eqEnvInfo: e.target.value }
                                                                                        });
                                                                                    }}
                                                                                    placeholder="Nhập thông tin model máy chạy PCR, trạng thái bảo dưỡng, nhiệt độ độ ẩm phòng Lab của khách..."
                                                                                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {guidebookActiveTab === "problemObs" && (
                                                                        <div className="space-y-3">
                                                                            <div className="bg-primary/5 border border-primary/10 rounded-xl p-3 text-[11px] text-slate-300 space-y-1.5 leading-relaxed">
                                                                                <p className="font-bold text-primary">Các thông tin cần khai thác:</p>
                                                                                <ul className="list-disc pl-4 space-y-1 text-slate-400">
                                                                                    <li>Hiện tượng cụ thể: không có band/Ct, Ct muộn, đường cong bất thường, yield thấp, smear, nhiễm chéo...</li>
                                                                                    <li>Dữ liệu định lượng: giá trị Ct, melt curve, nồng độ DNA/RNA thu được, tỉ lệ tinh sạch.</li>
                                                                                    <li>Kết quả control dương/âm/internal control (IC), NTC, extraction control.</li>
                                                                                    <li>Hình ảnh gel, amplification plot, melt curve, bảng raw data.</li>
                                                                                    <li>Sự cố xảy ra với tất cả hay một số mẫu/lô/kit; lần đầu hay lặp lại; tần suất.</li>
                                                                                </ul>
                                                                            </div>
                                                                            <div className="space-y-1.5">
                                                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Mô tả chi tiết hiện tượng &amp; kết quả quan sát:</label>
                                                                                <textarea
                                                                                    rows={3}
                                                                                    value={(activeIssue.investigationDetails || {}).problemObs || ""}
                                                                                    onChange={(e) => {
                                                                                        const details = activeIssue.investigationDetails || {};
                                                                                        updateActiveIssue({
                                                                                            investigationDetails: { ...details, problemObs: e.target.value }
                                                                                        });
                                                                                    }}
                                                                                    placeholder="Nhập giá trị Ct mồi/mẫu dò cụ thể, hiện tượng biểu hiện ở mẫu chứng, tần suất lặp lại..."
                                                                                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {guidebookActiveTab === "userHistory" && (
                                                                        <div className="space-y-3">
                                                                            <div className="bg-primary/5 border border-primary/10 rounded-xl p-3 text-[11px] text-slate-300 space-y-1.5 leading-relaxed">
                                                                                <p className="font-bold text-primary">Các thông tin cần khai thác:</p>
                                                                                <ul className="list-disc pl-4 space-y-1 text-slate-400">
                                                                                    <li>Người thực hiện (kinh nghiệm, đã được đào tạo chạy dòng kit này chưa).</li>
                                                                                    <li>Trước đây kit/lô tương tự chạy tốt không; có thay đổi gì gần đây không.</li>
                                                                                    <li>Có chạy song song kit/phương pháp của hãng khác để đối chiếu so sánh không, kết quả ra sao.</li>
                                                                                    <li>Biện pháp đã thử tự khắc phục (pha loãng mẫu, thay đổi lượng template, re-extract...) và kết quả.</li>
                                                                                </ul>
                                                                            </div>
                                                                            <div className="space-y-1.5">
                                                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Ghi nhận thông tin người thực hiện &amp; lịch sử vận hành:</label>
                                                                                <textarea
                                                                                    rows={3}
                                                                                    value={(activeIssue.investigationDetails || {}).userHistory || ""}
                                                                                    onChange={(e) => {
                                                                                        const details = activeIssue.investigationDetails || {};
                                                                                        updateActiveIssue({
                                                                                            investigationDetails: { ...details, userHistory: e.target.value }
                                                                                        });
                                                                                    }}
                                                                                    placeholder="Nhập thông tin nhân sự thao tác, kết quả so sánh chéo với hãng khác, các bước khắc phục khách đã tự làm..."
                                                                                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {guidebookActiveTab === "otherFactors" && (
                                                                        <div className="space-y-3">
                                                                            <div className="bg-primary/5 border border-primary/10 rounded-xl p-3 text-[11px] text-slate-300 space-y-1.5 leading-relaxed">
                                                                                <p className="font-bold text-primary">Các thông tin cần khai thác:</p>
                                                                                <ul className="list-disc pl-4 space-y-1 text-slate-400">
                                                                                    <li>Nghi ngờ nhiễm chéo hoặc sự xuất hiện của tác nhân ức chế (inhibitor: phenol, muối...).</li>
                                                                                    <li>Chất lượng nước cất pha chế, chất lượng các hóa chất phụ trợ dùng chung trong phòng thí nghiệm.</li>
                                                                                    <li>Điều kiện vận chuyển kit từ nhà sản xuất đến lab khách hàng (vận chuyển lạnh, đá gel...).</li>
                                                                                    <li>Có dữ liệu theo dõi nhiệt độ data logger trong suốt quá trình lưu kho/vận chuyển không.</li>
                                                                                </ul>
                                                                            </div>
                                                                            <div className="space-y-1.5">
                                                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Ghi nhận các yếu tố ảnh hưởng khác:</label>
                                                                                <textarea
                                                                                    rows={3}
                                                                                    value={(activeIssue.investigationDetails || {}).otherFactors || ""}
                                                                                    onChange={(e) => {
                                                                                        const details = activeIssue.investigationDetails || {};
                                                                                        updateActiveIssue({
                                                                                            investigationDetails: { ...details, otherFactors: e.target.value }
                                                                                        });
                                                                                    }}
                                                                                    placeholder="Nhập thông tin về quá trình vận chuyển đá gel, nghi ngờ inhibitor trong mẫu tách chiết..."
                                                                                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            {/* Conclusion local vs systemic */}
                                                            <div className="space-y-2 border-t border-white/5 pt-3">
                                                                <label className="text-xs font-bold text-slate-500 uppercase">Kết luận tính chất phạm vi sự cố</label>
                                                                <div className="flex gap-6 mt-1 text-xs">
                                                                    <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                                                                        <input
                                                                            type="radio"
                                                                            name="issueScope"
                                                                            checked={activeIssue.issueScopeConclusion === "Cục bộ"}
                                                                            onChange={() => updateActiveIssue({ issueScopeConclusion: "Cục bộ" })}
                                                                            className="bg-slate-950 border-white/10 text-primary w-4 h-4"
                                                                        />
                                                                        <span>Cục bộ (Chỉ ảnh hưởng tới mẫu lẻ/khách hàng cụ thể)</span>
                                                                    </label>
                                                                    <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                                                                        <input
                                                                            type="radio"
                                                                            name="issueScope"
                                                                            checked={activeIssue.issueScopeConclusion === "Hệ thống"}
                                                                            onChange={() => updateActiveIssue({ issueScopeConclusion: "Hệ thống" })}
                                                                            className="bg-slate-950 border-white/10 text-primary w-4 h-4"
                                                                        />
                                                                        <span>Hệ thống (Nguy cơ lỗi cả lô hàng đang lưu thông)</span>
                                                                    </label>
                                                                </div>
                                                            </div>

                                                            <div className="flex justify-between items-center pt-4 border-t border-white/5">
                                                                <button
                                                                    onClick={() => handlePrevStep("Step2")}
                                                                    className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white transition-colors"
                                                                >
                                                                    Quay lại
                                                                </button>
                                                                <button
                                                                    onClick={() => handleNextStep("Step4")}
                                                                    className="px-5 py-2.5 bg-primary hover:bg-primary/95 text-white font-bold rounded-xl text-xs active:scale-95 shadow transition-all"
                                                                >
                                                                    Lưu &amp; Chuyển sang Bước 4
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* STEP 4: Prediction & Exclusion */}
                                                    {activeViewedStep === "Step4" && (
                                                        <div className="space-y-5">
                                                            {/* Add predicted cause */}
                                                            <div className="space-y-2">
                                                                <label className="text-xs font-bold text-slate-500 uppercase">Dự đoán nguyên nhân có thể xảy ra</label>
                                                                <div className="flex gap-2">
                                                                    <input
                                                                        type="text"
                                                                        placeholder="Nhập nguyên nhân kỹ thuật giả định..."
                                                                        value={newPredictedCauseText}
                                                                        onChange={(e) => setNewPredictedCauseText(e.target.value)}
                                                                        className="flex-1 bg-slate-950 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                                                    />
                                                                    <button
                                                                        onClick={handleAddPredictedCause}
                                                                        className="px-4 bg-primary hover:bg-primary/95 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition active:scale-95 shadow"
                                                                    >
                                                                        <Plus className="w-3.5 h-3.5" /> Thêm giả thuyết
                                                                    </button>
                                                                </div>
                                                            </div>

                                                            {/* Causes table list */}
                                                            <div className="space-y-2">
                                                                <label className="text-xs font-bold text-slate-500 uppercase">Bảng loại trừ nguyên nhân kỹ thuật</label>
                                                                <div className="overflow-x-auto rounded-2xl border border-white/5 bg-slate-950/20">
                                                                    <table className="w-full border-collapse text-left text-xs">
                                                                        <thead>
                                                                            <tr className="bg-slate-950/60 border-b border-white/5 text-slate-500 font-bold uppercase text-[9px] tracking-wider">
                                                                                <th className="p-3">Nguyên nhân kỹ thuật</th>
                                                                                <th className="p-3 w-[150px]">Trạng thái</th>
                                                                                <th className="p-3">Lý do loại trừ / Kiểm chứng</th>
                                                                                <th className="p-3 w-[80px] text-center">Xóa</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody className="divide-y divide-white/5 text-slate-300">
                                                                            {(activeIssue.predictedCauses || []).length === 0 ? (
                                                                                <tr>
                                                                                    <td colSpan={4} className="p-6 text-center text-slate-500 italic">Chưa nhập nguyên nhân giả thuyết nào.</td>
                                                                                </tr>
                                                                            ) : (
                                                                                activeIssue.predictedCauses.map((c: any, index: number) => (
                                                                                    <tr key={index} className="hover:bg-white/5 transition-colors">
                                                                                        <td className="p-3 font-semibold">{c.cause}</td>
                                                                                        <td className="p-3">
                                                                                            <select
                                                                                                value={c.status}
                                                                                                onChange={(e) => handleToggleCauseStatus(index, e.target.value as any)}
                                                                                                className="bg-slate-950/40 border border-white/5 rounded-lg px-2 py-1 text-[11px] outline-none text-slate-300 w-full"
                                                                                            >
                                                                                                <option value="Possible">❓ Khả thi</option>
                                                                                                <option value="Excluded">❌ Loại trừ</option>
                                                                                                <option value="Confirmed">✅ Xác nhận</option>
                                                                                            </select>
                                                                                        </td>
                                                                                        <td className="p-3">
                                                                                            <input
                                                                                                type="text"
                                                                                                placeholder="Nhập lập luận loại trừ hoặc ghi chú..."
                                                                                                value={c.exclusionReason || ""}
                                                                                                onChange={(e) => {
                                                                                                    const current = [...(activeIssue.predictedCauses || [])];
                                                                                                    current[index].exclusionReason = e.target.value;
                                                                                                    updateActiveIssue({ predictedCauses: current });
                                                                                                }}
                                                                                                className="w-full bg-transparent border-b border-white/10 hover:border-white/20 px-1 py-0.5 text-xs outline-none focus:border-primary/50 text-slate-200"
                                                                                            />
                                                                                        </td>
                                                                                        <td className="p-3 text-center">
                                                                                            <button
                                                                                                onClick={() => {
                                                                                                    const next = (activeIssue.predictedCauses || []).filter((_: any, i: number) => i !== index);
                                                                                                    updateActiveIssue({ predictedCauses: next });
                                                                                                }}
                                                                                                className="text-slate-500 hover:text-rose-400 p-1 rounded transition-colors"
                                                                                            >
                                                                                                <Trash2 className="w-3.5 h-3.5" />
                                                                                            </button>
                                                                                        </td>
                                                                                    </tr>
                                                                                ))
                                                                            )}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            </div>

                                                            {/* Option to go to experiment */}
                                                            <div className="p-4 rounded-2xl bg-slate-950/40 border border-white/5 flex items-center justify-between gap-4 text-xs">
                                                                <div className="space-y-1">
                                                                    <p className="font-bold text-white">Yêu cầu Thí nghiệm Thực nghiệm</p>
                                                                    <p className="text-[10px] text-slate-500">Chưa thể đưa ra kết luận duy nhất, cần tạo task thí nghiệm kiểm chứng lâm sàng để khẳng định nguyên nhân.</p>
                                                                </div>
                                                                <label className="relative inline-flex items-center cursor-pointer select-none">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={activeIssue.goToExperiment || false}
                                                                        onChange={(e) => updateActiveIssue({ goToExperiment: e.target.checked })}
                                                                        className="sr-only peer"
                                                                    />
                                                                    <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                                                                </label>
                                                            </div>

                                                            {/* Manual conclusion field if not going to experiment */}
                                                            {!activeIssue.goToExperiment && (
                                                                <motion.div 
                                                                    initial={{ opacity: 0, height: 0 }}
                                                                    animate={{ opacity: 1, height: "auto" }}
                                                                    className="space-y-2"
                                                                >
                                                                    <label className="text-xs font-bold text-slate-500 uppercase">Kết luận nguyên nhân chính sau khi loại trừ</label>
                                                                    <textarea
                                                                        rows={2}
                                                                        placeholder="Ví dụ: Xác định do thiết bị ly tâm lắng cặn của khách hàng không đạt vòng tua dẫn tới mẫu không sạch..."
                                                                        value={activeIssue.concludedRootCause || ""}
                                                                        onChange={(e) => updateActiveIssue({ concludedRootCause: e.target.value })}
                                                                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                                                    />
                                                                </motion.div>
                                                            )}

                                                            <div className="flex justify-between items-center pt-4 border-t border-white/5">
                                                                <button
                                                                    onClick={() => handlePrevStep("Step3")}
                                                                    className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white transition-colors"
                                                                >
                                                                    Quay lại
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        if (activeIssue.goToExperiment) {
                                                                            handleNextStep("Step5");
                                                                        } else {
                                                                            if (!(activeIssue.concludedRootCause || "").trim()) {
                                                                                showToast("Vui lòng ghi rõ kết luận nguyên nhân hoặc chọn 'Yêu cầu Thí nghiệm'!", "warning");
                                                                                return;
                                                                            }
                                                                            handleNextStep("Step6");
                                                                        }
                                                                    }}
                                                                    className="px-5 py-2.5 bg-primary hover:bg-primary/95 text-white font-bold rounded-xl text-xs active:scale-95 shadow transition-all"
                                                                >
                                                                    Lưu &amp; Đi tiếp
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* STEP 5: Verification Experiment */}
                                                    {activeViewedStep === "Step5" && (
                                                        <div className="space-y-5">
                                                            {(() => {
                                                                const hasTask = !!activeIssue.experimentTaskId;
                                                                const linkedTask = tasks.find(t => String(t.id) === activeIssue.experimentTaskId);

                                                                return (
                                                                    <div className="space-y-4">
                                                                        {!hasTask ? (
                                                                            <div className="p-6 rounded-2xl bg-slate-950/40 border border-white/5 text-center space-y-4">
                                                                                <FlaskConical className="w-10 h-10 mx-auto text-slate-500" />
                                                                                <div>
                                                                                    <h4 className="text-xs font-bold text-white">Chưa khởi tạo công việc kiểm chứng</h4>
                                                                                    <p className="text-[10px] text-slate-400 mt-1">Hệ thống sẽ liên kết trực tiếp và tự động tạo công việc có phân loại kỹ thuật trên Kanban board.</p>
                                                                                </div>
                                                                                <button
                                                                                    onClick={() => handleCreateExperimentTask(activeIssue.id)}
                                                                                    className="px-4 py-2 bg-primary hover:bg-primary/95 text-white font-bold rounded-xl text-xs transition active:scale-95 shadow flex items-center gap-1.5 mx-auto"
                                                                                >
                                                                                    <Plus className="w-3.5 h-3.5" /> Tạo thí nghiệm kiểm chứng trên Kanban
                                                                                </button>
                                                                            </div>
                                                                        ) : (
                                                                            <div className="p-4 rounded-2xl bg-slate-950/40/45 border border-white/5 space-y-4">
                                                                                <h4 className="text-xs font-bold text-white uppercase tracking-wider text-primary flex items-center justify-between">
                                                                                    <span>Công việc kiểm chứng liên kết</span>
                                                                                    <span className="text-[9px] bg-slate-900 border border-white/5 text-slate-400 px-2 py-0.5 rounded-full lowercase font-mono">ID: {activeIssue.experimentTaskId}</span>
                                                                                </h4>

                                                                                {linkedTask ? (
                                                                                    <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/5 space-y-3">
                                                                                        <div className="flex justify-between items-start">
                                                                                            <div>
                                                                                                <p className="text-xs font-bold text-slate-200">{linkedTask.title}</p>
                                                                                                <p className="text-[10px] text-slate-400 mt-0.5">Phân loại: <span className="text-slate-300 font-medium">{linkedTask.category}</span></p>
                                                                                            </div>
                                                                                            <span className={cn(
                                                                                                "px-2 py-0.5 rounded-full text-[9px] font-bold border",
                                                                                                linkedTask.status === "Hoàn thành" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
                                                                                                linkedTask.status === "Đang thực hiện" ? "bg-primary/10 border-primary/20 text-primary" :
                                                                                                "bg-slate-800 border-slate-700 text-slate-400"
                                                                                            )}>
                                                                                                {linkedTask.status}
                                                                                            </span>
                                                                                        </div>
                                                                                        <div className="flex justify-between items-center text-[10px] text-slate-500 border-t border-white/5 pt-2">
                                                                                            <span>👤 Người thực hiện: **{linkedTask.assignee}**</span>
                                                                                            <button
                                                                                                onClick={() => {
                                                                                                    setActiveTab("tasks");
                                                                                                    setActiveTaskDetail(linkedTask);
                                                                                                    setIsTaskDetailModalOpen(true);
                                                                                                }}
                                                                                                className="text-primary hover:underline font-bold flex items-center gap-0.5"
                                                                                            >
                                                                                                Chi tiết Kanban <ArrowUpRight className="w-3.5 h-3.5" />
                                                                                            </button>
                                                                                        </div>
                                                                                    </div>
                                                                                ) : (
                                                                                    <p className="text-xs text-rose-400 italic">Không tìm thấy thông tin task trên bảng công việc local (Đã bị xóa).</p>
                                                                                )}
                                                                            </div>
                                                                        )}

                                                                        {/* Result details input */}
                                                                        <div className="space-y-3">
                                                                            <div className="space-y-2">
                                                                                <label className="text-xs font-bold text-slate-500 uppercase">Mô tả kết quả thực nghiệm đạt được</label>
                                                                                <textarea
                                                                                    rows={2}
                                                                                    placeholder="Ví dụ: Tiến hành test chéo mồi/mẫu dò giữa lô cũ và mới. Lô cũ lên Ct trễ 38, lô mới bình thường đạt 29. Khẳng định do mồi lặp mẫu dò lô cũ bị hỏng..."
                                                                                    value={activeIssue.experimentResults || ""}
                                                                                    onChange={(e) => updateActiveIssue({ experimentResults: e.target.value })}
                                                                                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                                                                />
                                                                            </div>
                                                                            <div className="space-y-2">
                                                                                <label className="text-xs font-bold text-slate-500 uppercase">Kết luận nguyên nhân cuối cùng (Sau khi có kết quả thí nghiệm)</label>
                                                                                <textarea
                                                                                    rows={2}
                                                                                    placeholder="Kết luận: Sai sót trong quy trình sấy thăng hoa mẫu dò của lô LOT-SARS-2607A..."
                                                                                    value={activeIssue.experimentConclusion || ""}
                                                                                    onChange={(e) => updateActiveIssue({ experimentConclusion: e.target.value })}
                                                                                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })()}

                                                            <div className="flex justify-between items-center pt-4 border-t border-white/5">
                                                                <button
                                                                    onClick={() => handlePrevStep("Step4")}
                                                                    className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white transition-colors"
                                                                >
                                                                    Quay lại
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        if (!(activeIssue.experimentConclusion || "").trim()) {
                                                                            showToast("Vui lòng ghi rõ kết luận nguyên nhân cuối cùng sau thí nghiệm!", "warning");
                                                                            return;
                                                                        }
                                                                        handleNextStep("Step6");
                                                                    }}
                                                                    className="px-5 py-2.5 bg-primary hover:bg-primary/95 text-white font-bold rounded-xl text-xs active:scale-95 shadow transition-all"
                                                                >
                                                                    Lưu &amp; Chuyển sang Bước 6
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* STEP 6: CAPA & final solution */}
                                                    {activeViewedStep === "Step6" && (
                                                        <div className="space-y-4">
                                                            <div className="space-y-2">
                                                                <label className="text-xs font-bold text-slate-500 uppercase">Giải pháp xử lý lâu dài cho khách hàng</label>
                                                                <textarea
                                                                    rows={2}
                                                                    placeholder="Ví dụ: Đổi trả toàn bộ hộp kit bị lỗi của lô cũ sang lô mới đạt chuẩn."
                                                                    value={activeIssue.finalCustomerSolution || ""}
                                                                    onChange={(e) => updateActiveIssue({ finalCustomerSolution: e.target.value })}
                                                                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                                                />
                                                            </div>
                                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                                <div className="space-y-2">
                                                                    <label className="text-xs font-bold text-slate-500 uppercase">Biện pháp khắc phục (Corrective Action)</label>
                                                                    <textarea
                                                                        rows={3}
                                                                        placeholder="Ví dụ: Thu hồi toàn bộ lô LOT-SARS-2607A trên thị trường, kiểm tra lại lượng hàng tồn kho..."
                                                                        value={activeIssue.correctiveActions || ""}
                                                                        onChange={(e) => updateActiveIssue({ correctiveActions: e.target.value })}
                                                                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                                                    />
                                                                </div>
                                                                <div className="space-y-2">
                                                                    <label className="text-xs font-bold text-slate-500 uppercase">Biện pháp phòng ngừa (Preventive Action)</label>
                                                                    <textarea
                                                                        rows={3}
                                                                        placeholder="Ví dụ: Siết chặt quy trình giám sát QC thăng hoa mẫu dò, tăng thời gian chạy test QC kiểm tra độ nhạy trước khi xuất kho..."
                                                                        value={activeIssue.preventiveActions || ""}
                                                                        onChange={(e) => updateActiveIssue({ preventiveActions: e.target.value })}
                                                                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                                                    />
                                                                </div>
                                                            </div>

                                                            <div className="flex justify-between items-center pt-4 border-t border-white/5">
                                                                <button
                                                                    onClick={() => {
                                                                        if (activeIssue.goToExperiment) {
                                                                            handlePrevStep("Step5");
                                                                        } else {
                                                                            handlePrevStep("Step4");
                                                                        }
                                                                    }}
                                                                    className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white transition-colors"
                                                                >
                                                                    Quay lại
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        if (!(activeIssue.finalCustomerSolution || "").trim() || !(activeIssue.correctiveActions || "").trim() || !(activeIssue.preventiveActions || "").trim()) {
                                                                            showToast("Vui lòng điền đầy đủ giải pháp, biện pháp khắc phục và phòng ngừa CAPA!", "warning");
                                                                            return;
                                                                        }
                                                                        updateActiveIssue({ status: "Completed", resolutionStatus: "Resolved" });
                                                                        showToast("Chúc mừng! Đã hoàn thành đóng hồ sơ xử lý sự cố chất lượng.", "success");
                                                                    }}
                                                                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs active:scale-95 shadow transition-all"
                                                                >
                                                                    Hoàn thành &amp; Đóng phiếu
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* COMPLETED STATUS */}
                                                    {activeViewedStep === "Completed" && (
                                                        <div className="space-y-4 p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/10 text-xs">
                                                            <h4 className="text-sm font-black text-emerald-400 flex items-center gap-1.5">
                                                                <CheckCircle2 className="w-5 h-5 text-emerald-400" /> Báo cáo Tổng kết Xử lý Sự cố
                                                            </h4>
                                                            <div className="grid grid-cols-2 gap-4 border-b border-white/5 pb-3">
                                                                <div>
                                                                    <span className="text-slate-500">Mã phiếu sự cố:</span>
                                                                    <p className="font-mono text-slate-200 mt-0.5">{activeIssue.id}</p>
                                                                </div>
                                                                <div>
                                                                    <span className="text-slate-500">Tình trạng đóng:</span>
                                                                    <p className="text-slate-200 mt-0.5 font-bold text-emerald-400">
                                                                        {activeIssue.resolutionStatus === "Not an issue" ? "Không phải sự cố" : "Đã Khắc Phục (Resolved)"}
                                                                    </p>
                                                                </div>
                                                                <div>
                                                                    <span className="text-slate-500">Khách hàng:</span>
                                                                    <p className="text-slate-200 mt-0.5">{activeIssue.customerName}</p>
                                                                </div>
                                                                <div>
                                                                    <span className="text-slate-500">Sản phẩm &amp; Lô:</span>
                                                                    <p className="text-slate-200 mt-0.5">{activeIssue.productName} (Lô: {activeIssue.lotNumber})</p>
                                                                </div>
                                                            </div>

                                                            {activeIssue.resolutionStatus === "Not an issue" ? (
                                                                <div className="space-y-2">
                                                                    <span className="text-slate-500 font-bold">Lý giải chi tiết không phải sự cố:</span>
                                                                    <p className="p-3 bg-slate-900/60 border border-white/5 rounded-xl text-slate-300 italic">"{activeIssue.notRealIssueReason}"</p>
                                                                </div>
                                                            ) : (
                                                                <div className="space-y-3">
                                                                    <div>
                                                                        <span className="text-slate-500 font-bold">Kết luận nguyên nhân:</span>
                                                                        <p className="mt-1 text-slate-300">{activeIssue.experimentConclusion || activeIssue.concludedRootCause}</p>
                                                                    </div>
                                                                    <div>
                                                                        <span className="text-slate-500 font-bold">Giải pháp xử lý khách hàng:</span>
                                                                        <p className="mt-1 text-slate-300">{activeIssue.finalCustomerSolution}</p>
                                                                    </div>
                                                                    <div className="grid grid-cols-2 gap-4 border-t border-white/5 pt-3">
                                                                        <div>
                                                                            <span className="text-slate-500 font-bold">Biện pháp khắc phục (CAPA):</span>
                                                                            <p className="mt-1 text-slate-300">{activeIssue.correctiveActions}</p>
                                                                        </div>
                                                                        <div>
                                                                            <span className="text-slate-500 font-bold">Biện pháp phòng ngừa (CAPA):</span>
                                                                            <p className="mt-1 text-slate-300">{activeIssue.preventiveActions}</p>
                                                                        </div>
                                                                    </div>

                                                                    {activeIssue.investigationDetails && Object.values(activeIssue.investigationDetails).some(v => !!(v as string).trim()) && (
                                                                        <div className="border-t border-white/5 pt-3 space-y-2">
                                                                            <span className="text-slate-500 font-bold">Thông tin bối cảnh khai thác chi tiết:</span>
                                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] bg-slate-900/40 p-3.5 rounded-xl border border-white/5 max-h-[250px] overflow-y-auto">
                                                                                {activeIssue.investigationDetails.productKit && (
                                                                                    <div>
                                                                                        <span className="text-primary font-bold">1. Sản phẩm &amp; Kit:</span>
                                                                                        <p className="text-slate-300 mt-0.5 whitespace-pre-wrap">{activeIssue.investigationDetails.productKit}</p>
                                                                                    </div>
                                                                                )}
                                                                                {activeIssue.investigationDetails.sampleInfo && (
                                                                                    <div className="border-l border-white/5 pl-3">
                                                                                        <span className="text-primary font-bold">2. Mẫu bệnh phẩm:</span>
                                                                                        <p className="text-slate-300 mt-0.5 whitespace-pre-wrap">{activeIssue.investigationDetails.sampleInfo}</p>
                                                                                    </div>
                                                                                )}
                                                                                {activeIssue.investigationDetails.protocolInfo && (
                                                                                    <div className="border-t border-white/5 pt-2">
                                                                                        <span className="text-primary font-bold">3. Quy trình thực hiện:</span>
                                                                                        <p className="text-slate-300 mt-0.5 whitespace-pre-wrap">{activeIssue.investigationDetails.protocolInfo}</p>
                                                                                    </div>
                                                                                )}
                                                                                {activeIssue.investigationDetails.eqEnvInfo && (
                                                                                    <div className="border-t border-white/5 pt-2 border-l border-white/5 pl-3">
                                                                                        <span className="text-primary font-bold">4. Thiết bị &amp; Môi trường:</span>
                                                                                        <p className="text-slate-300 mt-0.5 whitespace-pre-wrap">{activeIssue.investigationDetails.eqEnvInfo}</p>
                                                                                    </div>
                                                                                )}
                                                                                {activeIssue.investigationDetails.problemObs && (
                                                                                    <div className="border-t border-white/5 pt-2">
                                                                                        <span className="text-primary font-bold">5. Kết quả quan sát:</span>
                                                                                        <p className="text-slate-300 mt-0.5 whitespace-pre-wrap">{activeIssue.investigationDetails.problemObs}</p>
                                                                                    </div>
                                                                                )}
                                                                                {activeIssue.investigationDetails.userHistory && (
                                                                                    <div className="border-t border-white/5 pt-2 border-l border-white/5 pl-3">
                                                                                        <span className="text-primary font-bold">6. Người dùng &amp; Lịch sử:</span>
                                                                                        <p className="text-slate-300 mt-0.5 whitespace-pre-wrap">{activeIssue.investigationDetails.userHistory}</p>
                                                                                    </div>
                                                                                )}
                                                                                {activeIssue.investigationDetails.otherFactors && (
                                                                                    <div className="border-t border-white/5 pt-2 col-span-2">
                                                                                        <span className="text-primary font-bold">7. Yếu tố ảnh hưởng khác:</span>
                                                                                        <p className="text-slate-300 mt-0.5 whitespace-pre-wrap">{activeIssue.investigationDetails.otherFactors}</p>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {activeIssue.customerAttachments && activeIssue.customerAttachments.length > 0 && (
                                                                        <div className="border-t border-white/5 pt-3 space-y-2">
                                                                            <span className="text-slate-500 font-bold">1. Tài liệu, Gel, qPCR nhận từ khách hàng:</span>
                                                                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-[11px]">
                                                                                {activeIssue.customerAttachments.map((file: any) => {
                                                                                    const isImage = file.type?.startsWith("image/");
                                                                                    return (
                                                                                        <div key={file.id} className="flex items-center gap-2.5 p-2 rounded-xl bg-slate-900/40 border border-white/5">
                                                                                            {isImage && file.dataUrl ? (
                                                                                                <a href={file.dataUrl} target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-lg overflow-hidden border border-white/10 flex-shrink-0 block hover:opacity-85">
                                                                                                    <img src={file.dataUrl} alt={file.name} className="w-full h-full object-cover" />
                                                                                                </a>
                                                                                            ) : (
                                                                                                <div className="w-10 h-10 rounded-lg bg-slate-950 border border-white/5 flex items-center justify-center flex-shrink-0">
                                                                                                    <FileText className="w-5 h-5 text-slate-400" />
                                                                                                </div>
                                                                                            )}
                                                                                            <div className="min-w-0 flex-1">
                                                                                                {isImage && file.dataUrl ? (
                                                                                                    <a
                                                                                                        href={file.dataUrl}
                                                                                                        download={file.name}
                                                                                                        className="text-xs text-slate-200 truncate font-semibold block hover:underline"
                                                                                                        title="Nhấp để tải về"
                                                                                                    >
                                                                                                        {file.name}
                                                                                                    </a>
                                                                                                ) : (
                                                                                                    <span className="text-xs text-slate-400 truncate font-semibold block" title={file.name}>
                                                                                                        {file.name}
                                                                                                    </span>
                                                                                                )}
                                                                                                <p className="text-[9px] text-slate-500 font-bold uppercase">{file.size ? `${(file.size / 1024).toFixed(1)} KB` : "N/A"}</p>
                                                                                            </div>
                                                                                        </div>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {activeIssue.internalQCAttachments && activeIssue.internalQCAttachments.length > 0 && (
                                                                        <div className="border-t border-white/5 pt-3 space-y-2">
                                                                            <span className="text-slate-500 font-bold">2. Hồ sơ sản xuất &amp; Tài liệu QC đính kèm (Biolab):</span>
                                                                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-[11px]">
                                                                                {activeIssue.internalQCAttachments.map((file: any) => {
                                                                                    const isImage = file.type?.startsWith("image/");
                                                                                    return (
                                                                                        <div key={file.id} className="flex items-center gap-2.5 p-2 rounded-xl bg-slate-900/40 border border-white/5">
                                                                                            {isImage && file.dataUrl ? (
                                                                                                <a href={file.dataUrl} target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-lg overflow-hidden border border-white/10 flex-shrink-0 block hover:opacity-85">
                                                                                                    <img src={file.dataUrl} alt={file.name} className="w-full h-full object-cover" />
                                                                                                </a>
                                                                                            ) : (
                                                                                                <div className="w-10 h-10 rounded-lg bg-slate-950 border border-white/5 flex items-center justify-center flex-shrink-0">
                                                                                                    <FileText className="w-5 h-5 text-slate-400" />
                                                                                                </div>
                                                                                            )}
                                                                                            <div className="min-w-0 flex-1">
                                                                                                {isImage && file.dataUrl ? (
                                                                                                    <a
                                                                                                        href={file.dataUrl}
                                                                                                        download={file.name}
                                                                                                        className="text-xs text-slate-200 truncate font-semibold block hover:underline"
                                                                                                        title="Nhấp để tải về"
                                                                                                    >
                                                                                                        {file.name}
                                                                                                    </a>
                                                                                                ) : (
                                                                                                    <span className="text-xs text-slate-400 truncate font-semibold block" title={file.name}>
                                                                                                        {file.name}
                                                                                                    </span>
                                                                                                )}
                                                                                                <p className="text-[9px] text-slate-500 font-bold uppercase">{file.size ? `${(file.size / 1024).toFixed(1)} KB` : "N/A"}</p>
                                                                                            </div>
                                                                                        </div>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}

                                                            <div className="flex justify-start pt-4 border-t border-white/5">
                                                                <button
                                                                    onClick={() => updateActiveIssue({ status: "Step1" })}
                                                                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-white/5 text-slate-300 font-bold rounded-xl text-xs transition active:scale-95"
                                                                >
                                                                    Mở lại quy trình để điều chỉnh
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>
                        </motion.div>
                        );
                    })()}
                </AnimatePresence>
            </div>

            {/* Modal: Add Plan Item */}
            <Modal isOpen={isPlanItemModalOpen} onClose={() => setIsPlanItemModalOpen(false)} title={`Lập Kế Hoạch Hoạt Động - ${planDay}`}>
                <form onSubmit={handleAddPlanItem} className="space-y-6 text-slate-300">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Chọn công việc phòng App</label>
                        <select
                            value={planProject}
                            onChange={(e) => setPlanProject(e.target.value)}
                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                        >
                            {availableTaskOptions.map(p => (
                                <option key={p} value={p}>{p}</option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-2">
                        <div className="flex justify-between items-center mb-1">
                            <label className="text-xs font-bold text-slate-500 uppercase">Nội dung công việc *</label>
                            <button
                                type="button"
                                onClick={() => setIsCustomTaskName(!isCustomTaskName)}
                                className="text-xs text-primary hover:underline font-bold"
                            >
                                {isCustomTaskName ? "Chọn từ danh sách" : "Tự nhập nội dung"}
                            </button>
                        </div>
                        {isCustomTaskName ? (
                            <input
                                required
                                type="text"
                                value={planTaskName}
                                onChange={(e) => setPlanTaskName(e.target.value)}
                                placeholder="Ví dụ: Chạy kiểm định đặc hiệu thử nghiệm dòng kit HPV..."
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        ) : (
                            <select
                                required
                                value={planTaskName}
                                onChange={(e) => setPlanTaskName(e.target.value)}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            >
                                <option value="">-- Chọn công việc --</option>
                                {tasks.map(t => (
                                    <option key={t.id} value={t.title}>{t.title}</option>
                                ))}
                            </select>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Khung thời gian</label>
                            <select
                                value={planTimeSlot}
                                onChange={(e) => setPlanTimeSlot(e.target.value)}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            >
                                {TIME_SLOTS.map(slot => (
                                    <option key={slot} value={slot}>{slot}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Chỉ số/Mục tiêu đạt</label>
                            <input
                                type="text"
                                value={planMetric}
                                onChange={(e) => setPlanMetric(e.target.value)}
                                placeholder="Ví dụ: Ct < 28 hoặc LOD < 10 copies"
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        </div>
                    </div>

                    {planTimeSlot === "Tự nhập khoảng thời gian (Khác)" && (
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Nhập thời gian tự do *</label>
                            <input
                                type="text"
                                required
                                value={customTime}
                                onChange={(e) => setCustomTime(e.target.value)}
                                placeholder="Ví dụ: 09:00 - 11:30..."
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Ghi chú thêm</label>
                        <textarea
                            value={planNotes}
                            onChange={(e) => setPlanNotes(e.target.value)}
                            rows={2}
                            placeholder="Nhập thông số hoặc thiết bị đi kèm..."
                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                        />
                    </div>

                    <div className="flex gap-3 pt-4 border-t border-white/5">
                        <button
                            type="button"
                            onClick={() => setIsPlanItemModalOpen(false)}
                            className="flex-1 py-3 bg-white/5 text-slate-400 hover:bg-white/10 border border-white/5 font-bold rounded-xl text-xs transition-all"
                        >
                            Hủy bỏ
                        </button>
                        <button
                            type="submit"
                            className="flex-2 py-3 bg-primary text-white font-bold rounded-xl text-xs shadow-lg shadow-primary/20 transition-all hover:scale-[1.01]"
                        >
                            Thêm công việc
                        </button>
                    </div>
                </form>
            </Modal>

            {/* Modal: Create Task */}
            <Modal isOpen={isTaskCreateModalOpen} onClose={() => setIsTaskCreateModalOpen(false)} title="Thêm Công Việc Mới" size="3xl">
                <form onSubmit={handleCreateTask} className="space-y-6 text-slate-300">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Tên công việc / Yêu cầu</label>
                        <input
                            required
                            type="text"
                            value={newTaskTitle}
                            onChange={(e) => setNewTaskTitle(e.target.value)}
                            placeholder="Ví dụ: Đánh giá độ tương hợp mẫu..."
                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Mô tả chi tiết</label>
                        <textarea
                            value={newTaskDesc}
                            onChange={(e) => setNewTaskDesc(e.target.value)}
                            rows={3}
                            placeholder="Nhập thông số kỹ thuật, gene đích hoặc hướng dẫn thực hiện..."
                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Phân loại công việc</label>
                            <select
                                value={newTaskCategory}
                                onChange={(e) => setNewTaskCategory(e.target.value)}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            >
                                <option value="Triển khai/demo sản phẩm">Triển khai/demo sản phẩm</option>
                                <option value="Thử nghiệm đánh giá chất lượng sản phẩm">Thử nghiệm đánh giá chất lượng sản phẩm</option>
                                <option value="Thử nghiệm xác định nguyên nhân sự cố chất lượng sản phẩm">Thử nghiệm xác định nguyên nhân sự cố chất lượng sản phẩm</option>
                                <option value="Bảo trì/sửa chữa thiết bị (bao gồm nội bộ và cho khách hàng)">Bảo trì/sửa chữa thiết bị (bao gồm nội bộ và cho khách hàng)</option>
                                <option value="Công việc khác">Công việc khác</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Độ ưu tiên</label>
                            <select
                                value={newTaskPriority}
                                onChange={(e) => setNewTaskPriority(e.target.value)}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            >
                                <option value="Low">Thấp (Low)</option>
                                <option value="Medium">Trung bình (Medium)</option>
                                <option value="High">Cao (High)</option>
                                <option value="Critical">Khẩn cấp (Critical)</option>
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Người thực hiện</label>
                            <select
                                value={newTaskAssignee}
                                onChange={(e) => setNewTaskAssignee(e.target.value)}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            >
                                {uniqueEmployees.map(a => (
                                    <option key={a} value={a}>{a}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Hạn hoàn thành</label>
                            <DateInputVN
                                value={newTaskDueDate}
                                onChange={(e) => setNewTaskDueDate(e.target.value)}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        </div>
                    </div>

                    <div className="flex gap-3 pt-4 border-t border-white/5">
                        <button
                            type="button"
                            onClick={() => setIsTaskCreateModalOpen(false)}
                            className="flex-1 py-3 bg-white/5 text-slate-400 hover:bg-white/10 border border-white/5 font-bold rounded-xl text-xs transition-all"
                        >
                            Hủy bỏ
                        </button>
                        <button
                            type="submit"
                            className="flex-2 py-3 bg-primary text-white font-bold rounded-xl text-xs shadow-lg shadow-primary/20 transition-all hover:scale-[1.01]"
                        >
                            Thêm công việc
                        </button>
                    </div>
                </form>
            </Modal>

            {/* Modal: Task Details (Cheklist & Activity logs) */}
            <Modal isOpen={isTaskDetailModalOpen} onClose={() => setIsTaskDetailModalOpen(false)} title="Chi Tiết Công Việc & Nhật Ký Tiến Độ" size="4xl">
                {activeTaskDetail && (
                    <div className="space-y-6 text-slate-300 text-xs">
                        {(activeTaskDetail.isFromSales || activeTaskDetail.salesReqId || activeTaskDetail.salesCustomerName) && (
                            <div className="p-3.5 rounded-2xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-500/30 flex items-center justify-between flex-wrap gap-2">
                                <div className="flex items-center gap-2">
                                    <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                                    <span className="text-xs font-bold text-purple-900 dark:text-purple-200">
                                        Phiếu phối hợp từ Sales: <strong className="text-purple-950 dark:text-white">{activeTaskDetail.salesCustomerName}</strong> (NVKD: {activeTaskDetail.salesRepName || 'Kinh doanh'})
                                    </span>
                                </div>
                                <span className="text-[10px] font-mono text-purple-800 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/60 px-2 py-0.5 rounded-md border border-purple-300 dark:border-purple-500/30 font-bold">
                                    Mã phiếu: {activeTaskDetail.salesReqId || 'REQ-APP'}
                                </span>
                            </div>
                        )}
                        <div className="space-y-1 pb-4 border-b border-white/5">
                            <span className="text-[10px] text-primary font-bold uppercase">{activeTaskDetail.category}</span>
                            <h3 className="text-base font-bold text-white">{activeTaskDetail.title}</h3>
                            <p className="text-slate-400 text-xs leading-relaxed mt-2">{activeTaskDetail.desc}</p>
                            
                            <div className="flex gap-2 flex-wrap mt-2">
                                {activeTaskDetail.productCode && (
                                    <div className="text-[9px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20 w-fit">
                                        Mã sản phẩm: {activeTaskDetail.productCode}
                                    </div>
                                )}
                                {activeTaskDetail.productLot && (
                                    <div className="text-[9px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 w-fit">
                                        Lô sản phẩm: {activeTaskDetail.productLot}
                                    </div>
                                )}
                                {activeTaskDetail.deviceInfo && (
                                    <div className="text-[9px] font-bold text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/20 w-fit">
                                        Thiết bị: {activeTaskDetail.deviceInfo}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Sub-navigation inside details modal */}
                        <div className="flex border-b border-white/5 pb-px gap-4">
                            <button
                                type="button"
                                onClick={() => setDetailTab("logs")}
                                className={cn(
                                    "pb-2 font-bold text-[10px] uppercase tracking-wider relative transition-colors",
                                    detailTab === "logs" ? "text-primary" : "text-slate-500 hover:text-slate-300"
                                )}
                            >
                                Checklist & Nhật ký tiến độ
                                {detailTab === "logs" && (
                                    <motion.div layoutId="modalTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                                )}
                            </button>
                            <button
                                type="button"
                                onClick={() => setDetailTab("tech")}
                                className={cn(
                                    "pb-2 font-bold text-[10px] uppercase tracking-wider relative transition-colors",
                                    detailTab === "tech" ? "text-primary" : "text-slate-500 hover:text-slate-300"
                                )}
                            >
                                Hồ sơ kỹ thuật chuyên môn
                                {detailTab === "tech" && (
                                    <motion.div layoutId="modalTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                                )}
                            </button>
                        </div>

                        {detailTab === "logs" ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Checklist section */}
                                <div className="space-y-4">
                                    <h4 className="font-bold text-white text-xs flex items-center gap-1.5">
                                        <CheckSquare className="w-4 h-4 text-primary" /> Danh sách nhiệm vụ phụ
                                    </h4>
                                    
                                    <div className="space-y-2">
                                        {Array.isArray(activeTaskDetail.checklist) && activeTaskDetail.checklist.filter(Boolean).map((c: any, index: number) => {
                                            const isObj = c && typeof c === 'object';
                                            const cId = isObj ? (c.id || String(index)) : String(index);
                                            const cTitle = isObj ? (c.title || "") : String(c);
                                            const cDone = isObj ? Boolean(c.done) : false;
                                            return (
                                                <label key={cId} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white/5 border border-white/5 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={cDone}
                                                        onChange={() => handleToggleSubtask(cId)}
                                                        className="w-4 h-4 cursor-pointer"
                                                    />
                                                    <span className={cn("text-xs", cDone ? "line-through text-slate-500" : "text-slate-300")}>{cTitle}</span>
                                                </label>
                                            );
                                        })}

                                        <div className="flex gap-2 mt-3 pt-2">
                                            <input
                                                type="text"
                                                value={newSubtaskTitle}
                                                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                                                placeholder="Thêm nhiệm vụ phụ..."
                                                className="flex-1 bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary/50"
                                            />
                                            <button
                                                type="button"
                                                onClick={handleAddSubtask}
                                                className="px-4 py-2 bg-primary hover:bg-primary/95 text-white font-bold rounded-xl text-xs"
                                            >
                                                Thêm
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Daily Results Logging */}
                                <div className="space-y-4">
                                    <h4 className="font-bold text-white text-xs flex items-center gap-1.5">
                                        <History className="w-4 h-4 text-primary" /> Báo Cáo Nhật Ký Kết Quả
                                    </h4>

                                    <form onSubmit={handleAddTaskLog} className="space-y-3 bg-white/5 p-4 rounded-2xl border border-white/5">
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-slate-500 uppercase">Tóm tắt kết quả</label>
                                            <textarea
                                                required
                                                value={newTaskLogResult}
                                                onChange={(e) => setNewTaskLogResult(e.target.value)}
                                                rows={2}
                                                placeholder="Mô tả kết quả đạt được (nồng độ OD, biểu hiện gel...)"
                                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary/50"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <div className="flex items-center justify-between">
                                                <label className="text-[10px] font-bold text-slate-400 uppercase">Chọn tệp đính kèm kết quả</label>
                                                {newTaskLogAttachment && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setNewTaskLogAttachment("");
                                                            setNewTaskLogFileUrl("");
                                                            setNewTaskLogFileSize("");
                                                        }}
                                                        className="text-[10px] text-rose-400 hover:text-rose-300 font-semibold flex items-center gap-1 transition-colors"
                                                        title="Hủy / Không đính kèm tệp này"
                                                    >
                                                        <X className="w-3 h-3" /> Hủy file
                                                    </button>
                                                )}
                                            </div>
                                            <input
                                                type="file"
                                                id="taskLogFile"
                                                onChange={handleTaskLogFileUpload}
                                                className="hidden"
                                                disabled={isUploadingLogFile}
                                            />
                                            {newTaskLogAttachment ? (
                                                <div className="bg-slate-900 border border-indigo-500/40 rounded-xl p-2.5 flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                                        <Paperclip className="w-4 h-4 text-indigo-400 shrink-0" />
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-xs font-semibold text-white truncate" title={newTaskLogAttachment}>
                                                                {newTaskLogAttachment}
                                                            </p>
                                                            {newTaskLogFileSize && (
                                                                <p className="text-[9px] text-slate-400 font-mono">{newTaskLogFileSize}</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1 shrink-0">
                                                        <label
                                                            htmlFor="taskLogFile"
                                                            className="px-2 py-1 bg-slate-800 hover:bg-slate-750 text-indigo-300 text-[10px] font-bold rounded-lg cursor-pointer flex items-center gap-1 transition-colors"
                                                            title="Chọn tệp khác thay thế"
                                                        >
                                                            <Upload className="w-3 h-3" /> Đổi file
                                                        </label>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setNewTaskLogAttachment("");
                                                                setNewTaskLogFileUrl("");
                                                                setNewTaskLogFileSize("");
                                                            }}
                                                            className="p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                                                            title="Xóa tệp đính kèm này"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <label
                                                    htmlFor="taskLogFile"
                                                    className={cn(
                                                        "w-full bg-slate-950 border border-white/10 hover:bg-white/5 text-slate-300 rounded-xl px-3 py-2 text-xs text-center cursor-pointer border-dashed flex items-center justify-center gap-1.5 font-semibold truncate",
                                                        isUploadingLogFile && "opacity-60 cursor-not-allowed"
                                                    )}
                                                >
                                                    {isUploadingLogFile ? (
                                                        <span className="flex items-center gap-1.5 text-sky-400">
                                                            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang tải tệp lên...
                                                        </span>
                                                    ) : (
                                                        <>
                                                            <Upload className="w-3.5 h-3.5" /> <span>Chọn file từ máy tính...</span>
                                                        </>
                                                    )}
                                                </label>
                                            )}
                                        </div>
                                        <button
                                            type="submit"
                                            disabled={isUploadingLogFile}
                                            className="w-full py-2 bg-primary hover:bg-primary/95 disabled:opacity-60 text-white font-bold rounded-xl text-xs transition-colors"
                                        >
                                            Lưu kết quả
                                        </button>
                                    </form>

                                    {/* Logs list */}
                                    <div className="space-y-3 max-h-[180px] overflow-y-auto pr-2 custom-scrollbar">
                                        {Array.isArray(activeTaskDetail.logs) && activeTaskDetail.logs.filter(Boolean).map((log: any, index: number) => {
                                            const isObj = log && typeof log === 'object';
                                            const logId = isObj ? (log.id || String(index)) : String(index);
                                            const logDate = isObj ? (log.date || "") : "";
                                            const logSummary = isObj ? (log.summary || "") : String(log);
                                            const logAttachment = isObj ? log.attachment : null;
                                            const logFileUrl = isObj ? log.fileUrl : null;
                                            const logFileSize = isObj ? log.size : null;
                                            return (
                                                <div key={logId} className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1 group">
                                                    <div className="flex justify-between items-center text-[9px] text-slate-500 font-bold">
                                                        <span>Ngày: {logDate}</span>
                                                        <div className="flex items-center gap-2">
                                                            {logAttachment && (
                                                                <a
                                                                    href={logFileUrl || `/api/upload?file=${encodeURIComponent(logAttachment)}`}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    download={logAttachment}
                                                                    className="text-primary hover:underline flex items-center gap-1 truncate max-w-[130px]"
                                                                    title={`Xem / Tải về ${logAttachment}`}
                                                                >
                                                                    <Paperclip className="w-3 h-3 shrink-0" />
                                                                    <span className="truncate">{logAttachment}</span>
                                                                    {logFileSize && <span className="text-[8px] text-slate-500">({logFileSize})</span>}
                                                                </a>
                                                            )}
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDeleteTaskLog(logId)}
                                                                className="p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors"
                                                                title="Xóa nhật ký này"
                                                            >
                                                                <Trash2 className="w-3 h-3" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <p className="text-slate-300 font-medium">{logSummary}</p>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <form onSubmit={handleSaveTaskTechSpec} className="space-y-4">
                                {/* Technical Record Approval Status Badge & Actions */}
                                <div className="p-4 rounded-2xl bg-slate-950 border border-white/10 flex justify-between items-center gap-4 flex-wrap">
                                    <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-slate-500 font-bold uppercase">Trạng thái hồ sơ:</span>
                                            {activeTaskDetail.techStatus === "Report Approved" ? (
                                                <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                    Đã duyệt Báo cáo (Hoàn tất)
                                                </span>
                                            ) : activeTaskDetail.techStatus === "Pending Report" ? (
                                                <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse">
                                                    Chờ duyệt Báo cáo
                                                </span>
                                            ) : activeTaskDetail.techStatus === "Needs Revision Report" ? (
                                                <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                                    Báo cáo cần hiệu chỉnh
                                                </span>
                                            ) : activeTaskDetail.techStatus === "Protocol Approved" ? (
                                                <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-sky-500/10 text-sky-400 border border-sky-500/20">
                                                    Đề cương đã duyệt (Nhập kết quả)
                                                </span>
                                            ) : activeTaskDetail.techStatus === "Pending Protocol" ? (
                                                <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse">
                                                    Chờ duyệt Đề cương
                                                </span>
                                            ) : activeTaskDetail.techStatus === "Needs Revision Protocol" ? (
                                                <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                                    Đề cương cần hiệu chỉnh
                                                </span>
                                            ) : (
                                                <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-slate-500/10 text-slate-400 border border-slate-500/20">
                                                    Đề cương: Nháp (Draft)
                                                </span>
                                            )}
                                        </div>
                                        {activeTaskDetail.techApprovedBy && (
                                            <span className="text-[10px] text-sky-400 font-medium">Người duyệt Đề cương: {activeTaskDetail.techApprovedBy}</span>
                                        )}
                                        {activeTaskDetail.techReportApprovedBy && (
                                            <span className="text-[10px] text-emerald-400 font-medium">Người duyệt Báo cáo: {activeTaskDetail.techReportApprovedBy}</span>
                                        )}
                                        {activeTaskDetail.techFeedback && (
                                            <div className="text-[10px] text-rose-400/90 font-medium bg-rose-500/5 p-2 rounded-lg border border-rose-500/10 mt-1">
                                                <strong>Ý kiến chỉ đạo:</strong> {activeTaskDetail.techFeedback}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        {/* Stage 1: Submit Protocol (Technician) */}
                                        {(activeTaskDetail.techStatus === "Draft" || activeTaskDetail.techStatus === "Needs Revision Protocol" || !activeTaskDetail.techStatus) && (
                                            <button
                                                type="button"
                                                onClick={handleSubmitProtocolForApproval}
                                                className="px-3.5 py-1.5 bg-primary hover:bg-primary/95 text-white font-bold rounded-xl text-[10px] active:scale-95 transition-all shadow-lg"
                                            >
                                                Gửi duyệt Đề cương
                                            </button>
                                        )}

                                        {/* Stage 1: Approve/Reject Protocol (Manager) */}
                                        {isManager && activeTaskDetail.techStatus === "Pending Protocol" && (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={handleRejectProtocol}
                                                    className="px-3.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 font-bold rounded-xl text-[10px] active:scale-95 transition-all"
                                                >
                                                    Yêu cầu sửa Đề cương
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleApproveProtocol}
                                                    className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl text-[10px] active:scale-95 transition-all shadow-md"
                                                >
                                                    Duyệt Đề cương
                                                </button>
                                            </>
                                        )}

                                        {/* Stage 2: Submit Report (Technician) */}
                                        {(activeTaskDetail.techStatus === "Protocol Approved" || activeTaskDetail.techStatus === "Needs Revision Report") && (
                                            <button
                                                type="button"
                                                onClick={handleSubmitReportForApproval}
                                                className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl text-[10px] active:scale-95 transition-all shadow-lg"
                                            >
                                                Gửi duyệt Báo cáo
                                            </button>
                                        )}

                                        {/* Stage 2: Approve/Reject Report (Manager) */}
                                        {isManager && activeTaskDetail.techStatus === "Pending Report" && (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={handleRejectReport}
                                                    className="px-3.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 font-bold rounded-xl text-[10px] active:scale-95 transition-all"
                                                >
                                                    Yêu cầu sửa Báo cáo
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleApproveReport}
                                                    className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl text-[10px] active:scale-95 transition-all shadow-md"
                                                >
                                                    Duyệt Báo cáo kết quả
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    {(activeTaskDetail.category === "Triển khai/demo sản phẩm" || 
                                      activeTaskDetail.category === "Thử nghiệm đánh giá chất lượng sản phẩm" || 
                                      activeTaskDetail.category === "Thử nghiệm xác định nguyên nhân sự cố chất lượng sản phẩm") ? (
                                        <>
                                            <div className="space-y-1">
                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Mã sản phẩm</label>
                                                <input
                                                    type="text"
                                                    disabled={isProtocolLocked}
                                                    value={detailProductCode}
                                                    onChange={(e) => setDetailProductCode(e.target.value)}
                                                    placeholder="Ví dụ: COV-Kit-01"
                                                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-55"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Lô sản phẩm</label>
                                                <input
                                                    type="text"
                                                    disabled={isProtocolLocked}
                                                    value={detailProductLot}
                                                    onChange={(e) => setDetailProductLot(e.target.value)}
                                                    placeholder="Ví dụ: LOT-2026-08A"
                                                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-55"
                                                />
                                            </div>
                                        </>
                                    ) : (
                                        <div className="space-y-1 col-span-2">
                                            <label className="text-[10px] font-bold text-slate-500 uppercase">Thông tin thiết bị liên quan</label>
                                            <input
                                                type="text"
                                                disabled={isProtocolLocked}
                                                value={detailDeviceInfo}
                                                onChange={(e) => setDetailDeviceInfo(e.target.value)}
                                                placeholder="Ví dụ: Máy PCR ABI 7500 #002, Tủ cấy vô trùng Class II..."
                                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-55"
                                            />
                                        </div>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-slate-500 uppercase">Người thực hiện</label>
                                        <select
                                            disabled={isProtocolLocked}
                                            value={detailAssignee}
                                            onChange={(e) => setDetailAssignee(e.target.value)}
                                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-55"
                                        >
                                            {uniqueEmployees.map(emp => (
                                                <option key={emp} value={emp}>{emp}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-slate-500 uppercase">Chọn tệp đính kèm chuyên môn</label>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="file"
                                                disabled={isProtocolLocked}
                                                id="techSpecFile"
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    if (file) {
                                                        setDetailAttachmentUrl(file.name);
                                                    }
                                                }}
                                                className="hidden"
                                            />
                                            <label
                                                htmlFor="techSpecFile"
                                                className={cn(
                                                    "w-full bg-slate-950 border border-white/10 hover:bg-white/5 text-slate-300 rounded-xl px-3 py-2.5 text-xs text-center cursor-pointer border-dashed flex items-center justify-center gap-1.5 font-semibold",
                                                    isProtocolLocked && "opacity-55 cursor-not-allowed pointer-events-none"
                                                )}
                                            >
                                                <Upload className="w-3.5 h-3.5" /> {detailAttachmentUrl || "Chọn file chuyên môn..."}
                                            </label>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-6 pt-4">
                                    {/* Section: Objective */}
                                    <section className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <div className="w-7 h-7 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
                                                <CheckCircle2 className="w-4 h-4 text-indigo-500" />
                                            </div>
                                            <h4 className="font-bold text-white text-xs uppercase tracking-wider">
                                                Mục tiêu thử nghiệm
                                            </h4>
                                        </div>
                                        <textarea
                                            disabled={isProtocolLocked}
                                            value={detailObjective}
                                            onChange={(e) => setDetailObjective(e.target.value)}
                                            rows={2}
                                            placeholder="Ví dụ: Khảo sát giới hạn phát hiện nhạy tối thiểu..."
                                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-55"
                                        />
                                    </section>

                                    {/* Section: Materials & Prep & Method */}
                                    <section className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                                                <FlaskConical className="w-4 h-4 text-emerald-500" />
                                            </div>
                                            <h4 className="font-bold text-white text-xs uppercase tracking-wider">
                                                Nguyên liệu & Phương pháp tiến hành
                                            </h4>
                                        </div>
                                        
                                        <div className="bg-slate-950/20 border border-white/5 p-4 rounded-xl space-y-4">
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <div className="flex justify-between items-center mb-1">
                                                        <label className="text-[10px] font-bold text-slate-500 uppercase">Nguyên vật liệu / Reagents</label>
                                                        <select
                                                            id="invSelectMat"
                                                            disabled={isProtocolLocked}
                                                            className="bg-slate-950 border border-white/10 rounded-lg px-2 py-1 text-[9px] text-slate-300 max-w-[150px] outline-none cursor-pointer focus:ring-1 focus:ring-primary/50 disabled:opacity-55"
                                                            defaultValue=""
                                                            onChange={(e) => {
                                                                const matId = e.target.value;
                                                                if (!matId) return;
                                                                const mat = materials.find(m => String(m.id) === matId);
                                                                if (mat) {
                                                                    const qtyStr = prompt(`Nhập số lượng sử dụng cho "${mat.name}" (Đơn vị: ${mat.unit}, Tồn kho: ${mat.qty}):`, "1");
                                                                    if (qtyStr === null) return;
                                                                    const qty = Number(qtyStr);
                                                                    if (isNaN(qty) || qty <= 0) {
                                                                        alert("Số lượng không hợp lệ!");
                                                                        return;
                                                                    }
                                                                    if (qty > mat.qty) {
                                                                        alert(`Không đủ tồn kho! Hiện tại chỉ còn ${mat.qty} ${mat.unit}.`);
                                                                        return;
                                                                    }

                                                                    // 1. Deduct qty in inventory
                                                                    const updatedMaterials = materials.map(m => {
                                                                        if (String(m.id) === matId) {
                                                                            const newQty = m.qty - qty;
                                                                            return {
                                                                                ...m,
                                                                                qty: newQty,
                                                                                status: newQty > m.minQty ? "In Stock" : "Low Stock"
                                                                            };
                                                                        }
                                                                        return m;
                                                                    });
                                                                    setMaterials(updatedMaterials);
                                                                    localStorage.setItem("lab_app_materials", JSON.stringify(updatedMaterials));

                                                                    // 2. Append to detailMaterials textarea
                                                                    const appendText = `${mat.name} (${qty} ${mat.unit})`;
                                                                    setDetailMaterials(prev => prev ? `${prev}, ${appendText}` : appendText);
                                                                    
                                                                    // Reset selector
                                                                    e.target.value = "";
                                                                    showToast(`Đã xuất ${qty} ${mat.unit} "${mat.name}" từ kho App vào công việc.`, "success");
                                                                }
                                                            }}
                                                        >
                                                            <option value="">+ Xuất từ kho App...</option>
                                                            {materials.map(m => (
                                                                <option key={m.id} value={m.id} disabled={m.qty <= 0}>
                                                                    {m.name} ({m.qty} {m.unit} {m.qty <= 0 ? "- Hết" : ""})
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <textarea
                                                        disabled={isProtocolLocked}
                                                        value={detailMaterials}
                                                        onChange={(e) => setDetailMaterials(e.target.value)}
                                                        rows={2}
                                                        placeholder="Ví dụ: MasterMix Taq, Primer/Probe FAM hoặc xuất trực tiếp từ kho App..."
                                                        className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-55"
                                                    />
                                                </div>

                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Chuẩn bị mẫu (Sample Prep)</label>
                                                    <textarea
                                                        disabled={isProtocolLocked}
                                                        value={detailSamplePrep}
                                                        onChange={(e) => setDetailSamplePrep(e.target.value)}
                                                        rows={2}
                                                        placeholder="Ví dụ: Tách chiết mẫu ly tâm lấy RNA dịch phết..."
                                                        className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-55"
                                                    />
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Phương pháp tiến hành</label>
                                                <textarea
                                                    disabled={isProtocolLocked}
                                                    value={detailMethodology}
                                                    onChange={(e) => setDetailMethodology(e.target.value)}
                                                    rows={2}
                                                    placeholder="Ví dụ: Chạy Real-time PCR chu kỳ nhiệt 95°C (10s), 60°C (30s) trong 40 chu kỳ..."
                                                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-55"
                                                />
                                            </div>
                                        </div>
                                    </section>

                                    {/* Section: Results */}
                                    <section className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <div className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center border border-cyan-500/20">
                                                <Beaker className="w-4 h-4 text-cyan-500" />
                                            </div>
                                            <h4 className="font-bold text-white text-xs uppercase tracking-wider">
                                                Kết quả thu được
                                            </h4>
                                        </div>
                                        <textarea
                                            disabled={isReportLocked}
                                            value={detailResults}
                                            onChange={(e) => setDetailResults(e.target.value)}
                                            rows={2}
                                            placeholder="Ví dụ: Phát hiện tín hiệu dương tính tại kênh FAM ở Ct = 23.4..."
                                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-55"
                                        />
                                    </section>

                                    {/* Section: Conclusion */}
                                    <section className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
                                                <Lightbulb className="w-4 h-4 text-amber-500" />
                                            </div>
                                            <h4 className="font-bold text-white text-xs uppercase tracking-wider">
                                                Kết luận cuối cùng
                                            </h4>
                                        </div>
                                        <textarea
                                            disabled={isReportLocked}
                                            value={detailConclusion}
                                            onChange={(e) => setDetailConclusion(e.target.value)}
                                            rows={2}
                                            placeholder="Ví dụ: Lô kit hoạt động ổn định và đáp ứng độ nhạy tiêu chuẩn."
                                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-55"
                                        />
                                    </section>
                                </div>

                                <div className="flex justify-end gap-2 pt-2">
                                    <button
                                        type="submit"
                                        disabled={isAllLocked}
                                        className={cn(
                                            "px-6 py-2.5 font-bold rounded-xl text-xs shadow-md",
                                            isAllLocked ? "bg-slate-800 text-slate-500 cursor-not-allowed" : "bg-primary hover:bg-primary/95 text-white"
                                        )}
                                    >
                                        Lưu hồ sơ chuyên môn
                                    </button>
                                </div>
                            </form>
                        )}

                        <div className="flex justify-end pt-4 border-t border-white/5">
                            <button
                                type="button"
                                onClick={() => setIsTaskDetailModalOpen(false)}
                                className="px-5 py-2.5 bg-slate-900 border border-white/10 hover:bg-white/5 rounded-xl font-bold"
                            >
                                Đóng lại
                            </button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Modal: Book Equipment */}
            <Modal isOpen={isBookingModalOpen} onClose={() => setIsBookingModalOpen(false)} title="Đặt Chỗ Thiết Bị Thí Nghiệm">
                <form onSubmit={handleAddBooking} className="space-y-6 text-slate-300">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Chọn thiết bị</label>
                        <select
                            required
                            value={selectedEqId}
                            onChange={(e) => setSelectedEqId(e.target.value)}
                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                        >
                            <option value="">-- Chọn thiết bị --</option>
                            {equipment.map(eq => (
                                <option key={eq.id} value={eq.id}>{eq.name} ({eq.id}) [{eq.status === "Available" ? "Trống" : "Bận"}]</option>
                            ))}
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Ngày sử dụng</label>
                            <DateInputVN
                                required
                                value={bookingDate}
                                onChange={(e) => setBookingDate(e.target.value)}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Khung giờ đặt máy</label>
                            <select
                                value={bookingTime}
                                onChange={(e) => setBookingTime(e.target.value)}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            >
                                <option value="08:00 - 12:00">08:00 - 12:00 (Ca sáng)</option>
                                <option value="13:30 - 17:30">13:30 - 17:30 (Ca chiều)</option>
                                <option value="Cả ngày (08:00 - 17:30)">Cả ngày (08:00 - 17:30)</option>
                            </select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Mục đích sử dụng</label>
                        <input
                            required
                            type="text"
                            value={bookingPurpose}
                            onChange={(e) => setBookingPurpose(e.target.value)}
                            placeholder="Ví dụ: Ly tâm lắng mẫu dịch phết tách chiết RNA..."
                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                        />
                    </div>

                    <div className="flex gap-3 pt-4 border-t border-white/5">
                        <button
                            type="button"
                            onClick={() => setIsBookingModalOpen(false)}
                            className="flex-1 py-3 bg-white/5 text-slate-400 hover:bg-white/10 border border-white/5 font-bold rounded-xl text-xs transition-all"
                        >
                            Hủy bỏ
                        </button>
                        <button
                            type="submit"
                            className="flex-2 py-3 bg-primary text-white font-bold rounded-xl text-xs shadow-lg shadow-primary/20 transition-all hover:scale-[1.01]"
                        >
                            Đặt thiết bị
                        </button>
                    </div>
                </form>
            </Modal>

            {/* Modal: Request Material */}
            <Modal isOpen={isMaterialModalOpen} onClose={() => setIsMaterialModalOpen(false)} title="Yêu Cầu Vật Tư từ Cung ứng (Kho tổng CENTRAL)">
                <form onSubmit={handleAddMaterialRequest} className="space-y-6 text-slate-300 relative">
                    <div className="space-y-2 relative">
                        <label className="text-xs font-bold text-slate-500 uppercase font-mono">1. Chọn Hóa chất / Vật tư tiêu hao</label>
                        {isMaterialDropdownOpen && (
                            <div 
                                className="fixed inset-0 z-40" 
                                onClick={() => setIsMaterialDropdownOpen(false)}
                            />
                        )}
                        <input
                            type="text"
                            value={materialSearchQuery}
                            onChange={(e) => {
                                setMaterialSearchQuery(e.target.value);
                                setMaterialItemCode(""); // Clear selection if typing
                                setIsMaterialDropdownOpen(true);
                            }}
                            onFocus={() => {
                                setIsMaterialDropdownOpen(true);
                            }}
                            placeholder="Gõ mã hoặc tên vật tư để tìm kiếm..."
                            required
                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50 relative z-50"
                        />
                        {isMaterialDropdownOpen && (
                            <div className="absolute z-50 w-full mt-1 max-h-60 overflow-y-auto bg-slate-900 border border-white/10 rounded-xl shadow-2xl custom-scrollbar">
                                {(() => {
                                    const filteredItems = materialMasterItems.filter(item => 
                                        item.item_code.toLowerCase().includes(materialSearchQuery.toLowerCase()) ||
                                        item.item_name.toLowerCase().includes(materialSearchQuery.toLowerCase())
                                    );
                                    if (filteredItems.length === 0) {
                                        return <div className="px-4 py-3 text-sm text-slate-500">Không tìm thấy vật tư nào</div>;
                                    }
                                    return filteredItems.map((item: any) => (
                                        <div
                                            key={item.item_code}
                                            onClick={() => {
                                                setMaterialItemCode(item.item_code);
                                                setMaterialSearchQuery(`${item.item_code} - ${item.item_name}`);
                                                setIsMaterialDropdownOpen(false);
                                            }}
                                            className={`px-4 py-2.5 text-sm text-slate-300 hover:bg-white/5 cursor-pointer transition-all ${
                                                materialItemCode === item.item_code ? "bg-primary/20 text-primary font-bold" : ""
                                            }`}
                                        >
                                            <span className="font-bold font-mono text-xs block text-slate-400">{item.item_code}</span>
                                            <span>{item.item_name}</span>
                                        </div>
                                    ));
                                })()}
                            </div>
                        )}
                        <input type="hidden" value={materialItemCode} required />
                    </div>

                    {(() => {
                        const selectedItem = materialMasterItems.find(item => item.item_code === materialItemCode);
                        const supplyUnit = selectedItem?.unit_of_measure || selectedItem?.unit || '';
                        return (
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase font-mono">
                                    2. Số Lượng Yêu Cầu {supplyUnit && <span className="text-primary font-mono font-bold lowercase">({supplyUnit})</span>}
                                </label>
                                <div className="relative">
                                    <input
                                        type="number" step="any"
                                        min="1"
                                        value={materialQty}
                                        onChange={(e) => setMaterialQty(Number(e.target.value))}
                                        required
                                        className="w-full bg-slate-950 border border-white/10 rounded-xl pl-4 pr-12 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                    />
                                    {supplyUnit && (
                                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500 font-mono">
                                            {supplyUnit}
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })()}

                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">3. Lý do yêu cầu</label>
                        <textarea
                            value={materialReason}
                            onChange={(e) => setMaterialReason(e.target.value)}
                            rows={3}
                            placeholder="Mục đích sử dụng (mã thử nghiệm, dự án,...) để kho đối chiếu cấp phát..."
                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                        />
                    </div>

                    <div className="flex gap-3 pt-4 border-t border-white/5">
                        <button
                            type="button"
                            onClick={() => setIsMaterialModalOpen(false)}
                            className="flex-1 py-3 bg-white/5 text-slate-400 hover:bg-white/10 border border-white/5 font-bold rounded-xl text-xs transition-all"
                        >
                            Hủy bỏ
                        </button>
                        <button
                            type="submit"
                            className="flex-2 py-3 bg-primary text-white font-bold rounded-xl text-xs shadow-lg shadow-primary/20 transition-all hover:scale-[1.01]"
                        >
                            Gửi yêu cầu cấp phát
                        </button>
                    </div>
                </form>
            </Modal>

            <Modal isOpen={isSampleModalOpen} onClose={() => setIsSampleModalOpen(false)} title="Lưu Trữ Mẫu Bệnh Phẩm Mới" size="xl">
                <form onSubmit={handleAddSample} className="space-y-6 text-slate-300">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Mã Barcode (Tùy chọn)</label>
                            <input
                                type="text"
                                value={sampleBarcode}
                                onChange={(e) => setSampleBarcode(e.target.value)}
                                placeholder="Tự động tạo nếu để trống"
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Phân loại mẫu</label>
                            <select
                                value={sampleCategory}
                                onChange={(e) => {
                                    setSampleCategory(e.target.value);
                                    if (e.target.value !== "Bệnh phẩm") {
                                        setUseBatchImport(false);
                                    }
                                }}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            >
                                <option value="Bệnh phẩm">Bệnh phẩm</option>
                                <option value="DNA chuẩn">DNA chuẩn</option>
                                <option value="RNA chuẩn">RNA chuẩn</option>
                                <option value="Chủng chuẩn">Chủng chuẩn</option>
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Tên Mẫu</label>
                            <input
                                required
                                type="text"
                                value={sampleName}
                                onChange={(e) => setSampleName(e.target.value)}
                                placeholder="Ví dụ: Mẫu tăm dịch phết họng cúm A..."
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Gene đích / Tác nhân</label>
                            <input
                                required
                                type="text"
                                value={sampleTarget}
                                onChange={(e) => setSampleTarget(e.target.value)}
                                placeholder="Ví dụ: HPV 16 / Influenza A"
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        </div>
                    </div>

                    {sampleCategory === "Bệnh phẩm" && (
                        <div className="flex items-center gap-2 pb-1">
                            <input 
                                id="useBatchImportApp" 
                                type="checkbox"
                                checked={useBatchImport}
                                onChange={(e) => setUseBatchImport(e.target.checked)}
                                className="rounded border-white/10 bg-slate-950 text-primary focus:ring-0 focus:ring-offset-0 w-4 h-4 cursor-pointer"
                            />
                            <label htmlFor="useBatchImportApp" className="text-xs font-bold text-slate-300 uppercase cursor-pointer select-none">
                                Nhập danh sách bệnh phẩm chi tiết (Ct/Kết quả, Thể tích, Mã BN)
                            </label>
                        </div>
                    )}

                    {useBatchImport ? (
                        <div className="space-y-3 border border-white/5 bg-white/5 p-4 rounded-2xl">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-3 border-b border-white/5 mb-1">
                                <div className="space-y-1.5">
                                    <span className="text-[10px] text-slate-500 font-bold uppercase block">File Mẫu Nhập Liệu</span>
                                    <button
                                        type="button"
                                        onClick={handleDownloadSpecimenTemplate}
                                        className="w-full flex items-center justify-center gap-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 px-3 py-2.5 rounded-xl text-xs font-bold transition-all"
                                    >
                                        <Download className="w-3.5 h-3.5" />
                                        Tải File Excel Mẫu
                                    </button>
                                </div>
                                <div className="space-y-1.5">
                                    <span className="text-[10px] text-slate-500 font-bold uppercase block">Tải Lên File Excel (.xlsx/.csv)</span>
                                    <label className="w-full flex items-center justify-center gap-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 px-3 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer">
                                        <Upload className="w-3.5 h-3.5" />
                                        Chọn file Excel nhập mẫu
                                        <input
                                            type="file"
                                            accept=".xlsx,.xls,.csv"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (file) {
                                                    handleLoadExcelFile(file, setBatchSpecimensText);
                                                }
                                            }}
                                            className="hidden"
                                        />
                                    </label>
                                </div>
                            </div>
                            <div className="flex justify-between items-center mb-1">
                                <label className="text-xs font-bold text-slate-500 uppercase">Dán danh sách bệnh phẩm (CSV/Text)</label>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setBatchSpecimensText(
                                            "CL-SARS-006,BN-906,Dương tính (Ct=24.5),0.5\nCL-SARS-007,BN-907,Âm tính,0.2\nCL-SARS-008,BN-908,Dương tính (Ct=31.2),0.4\nCL-SARS-009,BN-909,Dương tính (Ct=18.9),0.3\nCL-SARS-010,BN-910,Âm tính,0.5"
                                        );
                                    }}
                                    className="px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 rounded text-[10px] font-bold transition-all"
                                >
                                    ✨ Sinh nhanh 5 mẫu thử
                                </button>
                            </div>
                            <textarea
                                value={batchSpecimensText}
                                onChange={(e) => setBatchSpecimensText(e.target.value)}
                                placeholder="Mã_mẫu,Mã_BN,Kết_quả_hoặc_Ct,Thể_tích&#10;Ví dụ:&#10;CL-SARS-006,BN-906,Dương tính (Ct=22.4),0.5&#10;CL-SARS-007,BN-907,Âm tính,0.3"
                                rows={4}
                                required
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-xs font-mono text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase">Nồng độ mẫu</label>
                                    <input
                                        type="text"
                                        value={sampleConcentration}
                                        onChange={(e) => setSampleConcentration(e.target.value)}
                                        placeholder="Ví dụ: Ct = 24.5 hoặc 10^5 copies/uL"
                                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase">Nhiệt độ bảo quản</label>
                                    <select
                                        value={sampleTemp}
                                        onChange={(e) => setSampleTemp(e.target.value)}
                                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                    >
                                        <option value="-20°C">-20°C (Tủ âm thường)</option>
                                        <option value="-80°C">-80°C (Tủ âm sâu)</option>
                                        <option value="2-8°C">2-8°C (Ngăn mát)</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase">Số lượng ban đầu</label>
                                    <input
                                        required
                                        type="number" step="any"
                                        value={sampleQty}
                                        onChange={(e) => setSampleQty(Number(e.target.value))}
                                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase">Đơn vị mẫu</label>
                                    <select
                                        value={sampleUnit}
                                        onChange={(e) => setSampleUnit(e.target.value)}
                                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer"
                                    >
                                        <option value="Ống">ống</option>
                                        <option value="µL">µL</option>
                                        <option value="mL">mL</option>
                                        <option value="g">g</option>
                                        <option value="mg">mg</option>
                                    </select>
                                </div>
                            </div>
                        </>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Nguồn gốc/Bệnh viện gửi</label>
                            <input
                                type="text"
                                value={sampleSource}
                                onChange={(e) => setSampleSource(e.target.value)}
                                placeholder="Ví dụ: Bệnh viện Chợ Rẫy..."
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Vị trí lưu trữ trong tủ</label>
                            <input
                                type="text"
                                value={sampleLocation}
                                onChange={(e) => setSampleLocation(e.target.value)}
                                placeholder="Ví dụ: Tủ A, Ngăn 2, Hộp S-1..."
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        </div>
                    </div>

                    <div className="flex gap-3 pt-4 border-t border-white/5">
                        <button
                            type="button"
                            onClick={() => setIsSampleModalOpen(false)}
                            className="flex-1 py-3 bg-white/5 text-slate-400 hover:bg-white/10 border border-white/5 font-bold rounded-xl text-xs transition-all"
                        >
                            Hủy bỏ
                        </button>
                        <button
                            type="submit"
                            className="flex-2 py-3 bg-primary text-white font-bold rounded-xl text-xs shadow-lg shadow-primary/20 transition-all hover:scale-[1.01]"
                        >
                            Thêm mẫu mới
                        </button>
                    </div>
                </form>
            </Modal>

            {/* Modal: Biological Sample Details & Growth Log */}
            <Modal isOpen={isSampleDetailModalOpen} onClose={() => setIsSampleDetailModalOpen(false)} title="Hồ Sơ Mẫu & Nhật Ký Sinh Trưởng" size="4xl">
                {activeSampleDetail && (
                    <div className="space-y-6 text-slate-300 text-xs">
                        <div className="grid grid-cols-2 gap-4 pb-4 border-b border-white/5">
                            <div>
                                <span className="text-[10px] text-primary font-bold uppercase">{activeSampleDetail.category}</span>
                                <h3 className="text-base font-bold text-white">{activeSampleDetail.name}</h3>
                                <p className="text-slate-500 mt-1">Barcode: <strong>{activeSampleDetail.barcode}</strong></p>
                            </div>
                            <div className="text-right space-y-1">
                                <p className="text-slate-400">Tồn kho hiện tại: <strong className="text-white text-sm">{activeSampleDetail.qty} {activeSampleDetail.unit}</strong></p>
                                <span className={cn(
                                    "inline-block px-2.5 py-0.5 rounded-full text-[9px] font-bold border",
                                    activeSampleDetail.status === "Đạt tiêu chuẩn" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                                )}>
                                    QC: {activeSampleDetail.status}
                                </span>
                            </div>
                        </div>

                        {/* Metadata grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-2xl bg-white/5 border border-white/5">
                            <div>
                                <p className="text-slate-500 font-bold uppercase text-[9px]">Gene Đích</p>
                                <p className="text-slate-200 font-medium mt-0.5">{activeSampleDetail.target || "N/A"}</p>
                            </div>
                            <div>
                                <p className="text-slate-500 font-bold uppercase text-[9px]">Nồng Độ</p>
                                <p className="text-slate-200 font-medium mt-0.5">{activeSampleDetail.concentration || "N/A"}</p>
                            </div>
                            <div>
                                <p className="text-slate-500 font-bold uppercase text-[9px]">Nhiệt Độ Trữ</p>
                                <p className="text-slate-200 font-medium mt-0.5">{activeSampleDetail.temp}</p>
                            </div>
                            <div>
                                <p className="text-slate-500 font-bold uppercase text-[9px]">Vị Trí Tủ</p>
                                <p className="text-slate-200 font-medium mt-0.5">{activeSampleDetail.location}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Growth logs list */}
                            <div className="space-y-4">
                                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                                    <h4 className="font-bold text-white text-xs flex items-center gap-1.5">
                                        <History className="w-4 h-4 text-primary" /> Nhật ký cấy chuyền / cấy sinh
                                    </h4>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setIsProliferateModalOpen(true)}
                                            className="px-2.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-lg text-[9px] uppercase transition-colors"
                                        >
                                            + Tăng sinh
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setIsConsumeModalOpen(true)}
                                            className="px-2.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/10 font-bold rounded-lg text-[9px] uppercase transition-colors"
                                        >
                                            - Chạy Test
                                        </button>
                                    </div>
                                </div>

                                <div className="space-y-3 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
                                    {activeSampleDetail.growthHistory && activeSampleDetail.growthHistory.map((hist: any) => (
                                        <div key={hist.id} className="p-3.5 rounded-xl bg-white/5 border border-white/5 space-y-1">
                                            <div className="flex justify-between text-[9px] font-bold">
                                                <span className={cn(
                                                    "px-1.5 py-0.5 rounded",
                                                    hist.action === "Tăng sinh" ? "bg-emerald-500/10 text-emerald-400" : hist.action === "Sử dụng" ? "bg-rose-500/10 text-rose-400" : "bg-slate-500/10 text-slate-400"
                                                )}>{hist.action}</span>
                                                <span className="text-slate-500">{hist.date} ({hist.performer})</span>
                                            </div>
                                            <p className="text-slate-300 font-medium">{hist.details}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Specimens nested list */}
                            <div className="space-y-4">
                                <h4 className="font-bold text-white text-xs flex items-center gap-1.5 border-b border-white/5 pb-2">
                                    <Layers className="w-4 h-4 text-primary" /> Danh sách ống mẫu lẻ (Specimens)
                                </h4>

                                <div className="space-y-2 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
                                    {activeSampleDetail.specimens && activeSampleDetail.specimens.length > 0 ? (
                                        activeSampleDetail.specimens.map((spec: any) => (
                                            <div key={spec.id} className="p-3 rounded-xl bg-white/5 border border-white/5 flex justify-between items-center">
                                                <div>
                                                    <strong className="text-white text-xs">{spec.id}</strong>
                                                    <p className="text-[10px] text-slate-500 mt-0.5">Bệnh nhân: {spec.patientId} | Vị trí: {spec.location}</p>
                                                </div>
                                                <div className="text-right space-y-0.5">
                                                    <span className="text-[9px] font-bold text-slate-300">{spec.volume} ml</span>
                                                    <p className="text-[8px] font-semibold text-emerald-400 uppercase tracking-wider">{spec.result}</p>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="text-center py-12 text-slate-600 text-[10px] italic">
                                            Chưa ghi nhận ống mẫu nhỏ lẻ.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end pt-4 border-t border-white/5">
                            <button
                                type="button"
                                onClick={() => setIsSampleDetailModalOpen(false)}
                                className="px-5 py-2.5 bg-slate-900 border border-white/10 hover:bg-white/5 rounded-xl font-bold"
                            >
                                Đóng hồ sơ
                            </button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Modal: Proliferate Sample */}
            <Modal isOpen={isProliferateModalOpen} onClose={() => setIsProliferateModalOpen(false)} title="Cập Nhật Tăng Sinh Mẫu">
                <form onSubmit={handleProliferateSample} className="space-y-6 text-slate-300 text-xs">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Lượng cấy sinh tăng thêm</label>
                            <input
                                required
                                type="number" step="any"
                                value={actionVolume}
                                onChange={(e) => setActionVolume(Number(e.target.value))}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Người thực hiện</label>
                            <input
                                required
                                type="text"
                                value={actionPerformer}
                                onChange={(e) => setActionPerformer(e.target.value)}
                                placeholder="Tên kỹ thuật viên"
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Mô tả cấy chuyền tăng sinh</label>
                        <textarea
                            value={actionDetails}
                            onChange={(e) => setActionDetails(e.target.value)}
                            rows={3}
                            placeholder="Mô tả môi trường nuôi cấy hoặc thời gian ủ mẫu..."
                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                        />
                    </div>

                    <div className="flex gap-3 pt-4 border-t border-white/5">
                        <button
                            type="button"
                            onClick={() => setIsProliferateModalOpen(false)}
                            className="flex-1 py-3 bg-white/5 text-slate-400 hover:bg-white/10 border border-white/5 font-bold rounded-xl text-xs transition-all"
                        >
                            Hủy
                        </button>
                        <button
                            type="submit"
                            className="flex-2 py-3 bg-emerald-500 text-white font-bold rounded-xl text-xs shadow-lg transition-all"
                        >
                            Xác nhận tăng sinh
                        </button>
                    </div>
                </form>
            </Modal>

            {/* Modal: Consume Sample */}
            <Modal isOpen={isConsumeModalOpen} onClose={() => setIsConsumeModalOpen(false)} title="Cập Nhật Tiêu Thụ/Hao Hụt Mẫu">
                <form onSubmit={handleConsumeSample} className="space-y-6 text-slate-300 text-xs">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Lượng tiêu hao sử dụng</label>
                            <input
                                required
                                type="number" step="any"
                                value={actionVolume}
                                onChange={(e) => setActionVolume(Number(e.target.value))}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Người thực hiện</label>
                            <input
                                required
                                type="text"
                                value={actionPerformer}
                                onChange={(e) => setActionPerformer(e.target.value)}
                                placeholder="Tên kỹ thuật viên"
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Lý do/Mục đích tiêu thụ</label>
                        <textarea
                            value={actionDetails}
                            onChange={(e) => setActionDetails(e.target.value)}
                            rows={3}
                            placeholder="Ví dụ: Rút mẫu chạy phản ứng PCR kiểm định lô kit X..."
                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                        />
                    </div>

                    <div className="flex gap-3 pt-4 border-t border-white/5">
                        <button
                            type="button"
                            onClick={() => setIsConsumeModalOpen(false)}
                            className="flex-1 py-3 bg-white/5 text-slate-400 hover:bg-white/10 border border-white/5 font-bold rounded-xl text-xs transition-all"
                        >
                            Hủy
                        </button>
                        <button
                            type="submit"
                            className="flex-2 py-3 bg-rose-500 text-white font-bold rounded-xl text-xs shadow-lg transition-all"
                        >
                            Xác nhận hao hụt
                        </button>
                    </div>
                </form>
            </Modal>

            {/* Modal: Register New Equipment */}
            <Modal isOpen={isAddEquipmentModalOpen} onClose={() => setIsAddEquipmentModalOpen(false)} title="Đăng Ký Thiết Bị Mới" size="2xl">
                <form onSubmit={handleAddEquipment} className="space-y-6 text-slate-300">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Tên thiết bị</label>
                        <input
                            required
                            type="text"
                            value={addEqName}
                            onChange={(e) => setAddEqName(e.target.value)}
                            placeholder="Ví dụ: Máy ly tâm lạnh Eppendorf 5424R..."
                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Model / Hãng sản xuất</label>
                            <input
                                required
                                type="text"
                                value={addEqModel}
                                onChange={(e) => setAddEqModel(e.target.value)}
                                placeholder="Ví dụ: ABI 7500 Fast / Applied Biosystems"
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Vị trí lắp đặt (Phòng Lab)</label>
                            <input
                                required
                                type="text"
                                value={addEqLocation}
                                onChange={(e) => setAddEqLocation(e.target.value)}
                                placeholder="Ví dụ: Phòng Thử Nghiệm App"
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Số Serial (S/N)</label>
                        <input
                            type="text"
                            value={addEqSerial}
                            onChange={(e) => setAddEqSerial(e.target.value)}
                            placeholder="Số serial in trên tem máy, ví dụ: 275012345"
                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 font-mono outline-none focus:ring-1 focus:ring-primary/50"
                        />
                    </div>
                    <div className="flex gap-3 pt-4 border-t border-white/5">
                        <button
                            type="button"
                            onClick={() => setIsAddEquipmentModalOpen(false)}
                            className="flex-1 py-3 bg-white/5 text-slate-400 hover:bg-white/10 border border-white/5 font-bold rounded-xl text-xs transition-all"
                        >
                            Hủy bỏ
                        </button>
                        <button
                            type="submit"
                            className="flex-2 py-3 bg-primary text-white font-bold rounded-xl text-xs shadow-lg shadow-primary/20 transition-all hover:scale-[1.01]"
                        >
                            Đăng ký thiết bị
                        </button>
                    </div>
                </form>
            </Modal>

            {/* Modal: Register New Reagent / Material */}
            <Modal isOpen={isCreateMaterialModalOpen} onClose={() => setIsCreateMaterialModalOpen(false)} title="Đăng Ký Hóa Chất / Vật Tư Mới" size="2xl">
                <form onSubmit={handleCreateMaterial} className="space-y-6 text-slate-300">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Tên hóa chất / vật tư</label>
                        <input
                            required
                            type="text"
                            value={addMatName}
                            onChange={(e) => setAddMatName(e.target.value)}
                            placeholder="Ví dụ: Taq Polymerase MasterMix (2X)..."
                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Mã hóa chất / vật tư</label>
                            <input
                                required
                                type="text"
                                value={addMatCode}
                                onChange={(e) => setAddMatCode(e.target.value)}
                                placeholder="Ví dụ: MAT-TAQ-01"
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Số lô sản xuất (Lot)</label>
                            <input
                                required
                                type="text"
                                value={addMatLot}
                                onChange={(e) => setAddMatLot(e.target.value)}
                                placeholder="Ví dụ: LOT-TAQ-2601"
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Phân loại</label>
                            <select
                                value={addMatCategory}
                                onChange={(e) => setAddMatCategory(e.target.value)}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            >
                                <option value="Hóa chất PCR">Hóa chất PCR</option>
                                <option value="Vật tư tiêu hao">Vật tư tiêu hao</option>
                                <option value="Mồi/Dò">Mồi/Dò (Primer/Probe)</option>
                                <option value="Dung dịch đệm">Dung dịch đệm / Buffers</option>
                                <option value="Khác">Phân loại khác</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Nhà cung cấp</label>
                            <input
                                type="text"
                                value={addMatSupplier}
                                onChange={(e) => setAddMatSupplier(e.target.value)}
                                placeholder="Ví dụ: Qiagen, ThermoFisher..."
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Số lượng ban đầu</label>
                            <input
                                required
                                type="number" step="any"
                                min={0}
                                value={addMatQty}
                                onChange={(e) => setAddMatQty(Number(e.target.value))}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Đơn vị</label>
                            <select
                                value={addMatUnit}
                                onChange={(e) => setAddMatUnit(e.target.value)}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer"
                            >
                                <option value="Hộp">Hộp</option>
                                <option value="cái">cái (piece)</option>
                                <option value="test">test (phản ứng)</option>
                                <option value="g">g (grams)</option>
                                <option value="mg">mg (milligrams)</option>
                                <option value="mL">mL (milliliters)</option>
                                <option value="µL">µL (microliters)</option>
                                <option value="Ống">Ống (vial)</option>
                                <option value="Bộ">Bộ (kit)</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Ngưỡng tối thiểu (Cảnh báo)</label>
                            <input
                                required
                                type="number" step="any"
                                min={0}
                                value={addMatMinQty}
                                onChange={(e) => setAddMatMinQty(Number(e.target.value))}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        </div>
                    </div>
                    <div className="flex gap-3 pt-4 border-t border-white/5">
                        <button
                            type="button"
                            onClick={() => setIsCreateMaterialModalOpen(false)}
                            className="flex-1 py-3 bg-white/5 text-slate-400 hover:bg-white/10 border border-white/5 font-bold rounded-xl text-xs transition-all"
                        >
                            Hủy bỏ
                        </button>
                        <button
                            type="submit"
                            className="flex-2 py-3 bg-primary text-white font-bold rounded-xl text-xs shadow-lg shadow-primary/20 transition-all hover:scale-[1.01]"
                        >
                            Đăng ký vật tư
                        </button>
                    </div>
                </form>
            </Modal>

            {/* Modal: Edit Equipment (Admin Only) */}
            <Modal isOpen={isEditEqModalOpen} onClose={() => setIsEditEqModalOpen(false)} title="Chỉnh Sửa Thông Tin Thiết Bị" size="2xl">
                <form onSubmit={handleSaveEditEquipment} className="space-y-6 text-slate-300">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Tên thiết bị</label>
                        <input
                            required
                            type="text"
                            value={editEqName}
                            onChange={(e) => setEditEqName(e.target.value)}
                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Model</label>
                            <input
                                type="text"
                                value={editEqModel}
                                onChange={(e) => setEditEqModel(e.target.value)}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Vị trí lắp đặt</label>
                            <input
                                type="text"
                                value={editEqLocation}
                                onChange={(e) => setEditEqLocation(e.target.value)}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none"
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Số Serial (S/N)</label>
                        <input
                            type="text"
                            value={editEqSerial}
                            onChange={(e) => setEditEqSerial(e.target.value)}
                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 font-mono outline-none"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Trạng thái hoạt động</label>
                        <select
                            value={editEqStatus}
                            onChange={(e) => setEditEqStatus(e.target.value)}
                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none"
                        >
                            <option value="Available">Trống (Available)</option>
                            <option value="Busy">Đang dùng / Bận (Busy)</option>
                        </select>
                    </div>
                    <div className="flex gap-3 pt-4 border-t border-white/5">
                        <button type="button" onClick={() => setIsEditEqModalOpen(false)} className="flex-1 py-3 bg-white/5 text-slate-400 font-bold rounded-xl text-xs">Hủy</button>
                        <button type="submit" className="flex-2 py-3 bg-primary text-white font-bold rounded-xl text-xs">Cập nhật thiết bị</button>
                    </div>
                </form>
            </Modal>

            {/* Modal: Edit Reagent/Material (Admin Only) */}
            <Modal isOpen={isEditMatModalOpen} onClose={() => setIsEditMatModalOpen(false)} title="Chỉnh Sửa Hóa Chất / Vật Tư" size="2xl">
                <form onSubmit={handleSaveEditMaterial} className="space-y-6 text-slate-300">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Tên hóa chất / vật tư</label>
                            <input
                                required
                                type="text"
                                value={editMatName}
                                onChange={(e) => setEditMatName(e.target.value)}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Mã danh mục</label>
                            <input
                                required
                                type="text"
                                value={editMatCode}
                                onChange={(e) => setEditMatCode(e.target.value)}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Số lô sản xuất (Lot)</label>
                            <input
                                required
                                type="text"
                                value={editMatLot}
                                onChange={(e) => setEditMatLot(e.target.value)}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Phân loại</label>
                            <select
                                value={editMatCategory}
                                onChange={(e) => setEditMatCategory(e.target.value)}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none"
                            >
                                <option value="Hóa chất PCR">Hóa chất PCR</option>
                                <option value="Vật tư tiêu hao">Vật tư tiêu hao</option>
                                <option value="Mồi/Dò">Mồi/Dò (Primer/Probe)</option>
                                <option value="Dung dịch đệm">Dung dịch đệm / Buffers</option>
                                <option value="Khác">Phân loại khác</option>
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Số lượng tồn</label>
                            <input
                                required
                                type="number" step="any"
                                value={editMatQty}
                                onChange={(e) => setEditMatQty(Number(e.target.value))}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Đơn vị</label>
                            <select
                                value={editMatUnit}
                                onChange={(e) => setEditMatUnit(e.target.value)}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none cursor-pointer"
                            >
                                <option value="Hộp">Hộp</option>
                                <option value="cái">cái (piece)</option>
                                <option value="test">test (phản ứng)</option>
                                <option value="g">g (grams)</option>
                                <option value="mg">mg (milligrams)</option>
                                <option value="mL">mL (milliliters)</option>
                                <option value="µL">µL (microliters)</option>
                                <option value="Ống">Ống (vial)</option>
                                <option value="Bộ">Bộ (kit)</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Ngưỡng tối thiểu</label>
                            <input
                                required
                                type="number" step="any"
                                value={editMatMinQty}
                                onChange={(e) => setEditMatMinQty(Number(e.target.value))}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none"
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Nhà cung cấp</label>
                        <input
                            type="text"
                            value={editMatSupplier}
                            onChange={(e) => setEditMatSupplier(e.target.value)}
                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none"
                        />
                    </div>
                    <div className="flex gap-3 pt-4 border-t border-white/5">
                        <button type="button" onClick={() => setIsEditMatModalOpen(false)} className="flex-1 py-3 bg-white/5 text-slate-400 font-bold rounded-xl text-xs">Hủy</button>
                        <button type="submit" className="flex-2 py-3 bg-primary text-white font-bold rounded-xl text-xs">Cập nhật hóa chất</button>
                    </div>
                </form>
            </Modal>

            {/* Modal: Direct Material Export/Consume */}
            <Modal isOpen={isDirectExportModalOpen} onClose={() => setIsDirectExportModalOpen(false)} title="Phiếu Xuất Kho Hóa Chất / Vật Tư" size="2xl">
                <form onSubmit={handleSaveDirectExportMaterial} className="space-y-6 text-slate-300">
                    <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs space-y-1">
                        <p className="text-white font-bold">Vật tư: {exportMatName}</p>
                        <p className="text-slate-400">Tồn kho khả dụng: <strong className="text-white">{exportMatStock} {exportMatUnit}</strong></p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Số lượng xuất kho</label>
                            <input
                                required
                                type="number" step="any"
                                min={1}
                                max={exportMatStock}
                                value={exportMatQty}
                                onChange={(e) => setExportMatQty(Number(e.target.value))}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Người nhận/Người thực hiện</label>
                            <select
                                value={exportMatPerformer}
                                onChange={(e) => setExportMatPerformer(e.target.value)}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                            >
                                {uniqueEmployees.map(emp => (
                                    <option key={emp} value={emp}>{emp}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Lý do / Mục đích xuất kho</label>
                        <textarea
                            required
                            value={exportMatReason}
                            onChange={(e) => setExportMatReason(e.target.value)}
                            rows={3}
                            placeholder="Ví dụ: Rút hóa chất phục vụ chạy kiểm tra mẫu đờm Lao ngày 10/08..."
                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                        />
                    </div>
                    <div className="flex gap-3 pt-4 border-t border-white/5">
                        <button type="button" onClick={() => setIsDirectExportModalOpen(false)} className="flex-1 py-3 bg-white/5 text-slate-400 font-bold rounded-xl text-xs">Hủy bỏ</button>
                        <button type="submit" className="flex-2 py-3 bg-emerald-500 text-white font-bold rounded-xl text-xs shadow-lg">Xác nhận xuất kho</button>
                    </div>
                </form>
            </Modal>

            {/* Modal: Create Customer Issue */}
            <Modal
                isOpen={isCreateIssueModalOpen}
                onClose={() => {
                    setIsCreateIssueModalOpen(false);
                    setIsProductDropdownOpen(false);
                    setIsLotDropdownOpen(false);
                    setIsCustomerDropdownOpen(false);
                }}
                title="Tiếp Nhận Sự Cố Khách Hàng Mới"
                size="2xl"
            >
                {/* Backdrop closer for active floating dropdowns */}
                {(isProductDropdownOpen || isLotDropdownOpen || isCustomerDropdownOpen) && (
                    <div 
                        className="fixed inset-0 z-30" 
                        onClick={() => {
                            setIsProductDropdownOpen(false);
                            setIsLotDropdownOpen(false);
                            setIsCustomerDropdownOpen(false);
                        }} 
                    />
                )}

                <form onSubmit={handleCreateCustomerIssue} className="space-y-6 text-slate-300 relative z-40">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* 1. Mã sản phẩm (Combobox tìm kiếm nhanh & liên kết tự động) */}
                        <div className="space-y-2 relative">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5">
                                    <span>MÃ SẢN PHẨM *</span>
                                    {isLoadingCatalogs && <span className="text-[10px] text-teal-400 font-normal lowercase">(đang tải...)</span>}
                                </label>
                                <span className="text-[10px] text-slate-500 font-normal">Gõ tìm mã / tên</span>
                            </div>
                            <div className="relative">
                                <input
                                    required
                                    type="text"
                                    value={newIssueProductCode}
                                    onChange={(e) => handleProductCodeChange(e.target.value)}
                                    onFocus={() => {
                                        setIsProductDropdownOpen(true);
                                        setIsLotDropdownOpen(false);
                                        setIsCustomerDropdownOpen(false);
                                    }}
                                    placeholder="Ví dụ: KIT-SARS-002"
                                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-primary/50 font-mono"
                                />
                                {newIssueProductCode && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setNewIssueProductCode("");
                                            setIsProductDropdownOpen(true);
                                        }}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs p-1"
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>

                            {/* Dropdown danh mục sản phẩm */}
                            {isProductDropdownOpen && (
                                <div className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-slate-900/98 backdrop-blur-md border border-slate-700 rounded-xl shadow-2xl divide-y divide-slate-800/70 custom-scrollbar">
                                    <div className="p-2 bg-slate-800/80 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between sticky top-0 backdrop-blur-sm z-10">
                                        <span>Danh mục sản phẩm ({filteredProductsForDropdown.length})</span>
                                        <span className="text-teal-400 font-normal">Chọn để tự điền tên & lọc lô</span>
                                    </div>
                                    {filteredProductsForDropdown.length === 0 ? (
                                        <div className="p-3 text-xs text-slate-400 text-center">
                                            Không có mã trùng khớp. Bạn vẫn có thể nhập mã mới tự do.
                                        </div>
                                    ) : (
                                        filteredProductsForDropdown.map((p: any) => (
                                            <div
                                                key={p.code}
                                                onClick={() => handleSelectProduct(p)}
                                                className={`p-2.5 hover:bg-slate-800/80 cursor-pointer transition-all ${
                                                    newIssueProductCode.trim().toLowerCase() === String(p.code).toLowerCase() ? "bg-primary/20" : ""
                                                }`}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="font-mono font-bold text-xs text-teal-300">{p.code}</span>
                                                    {p.category && (
                                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                                                            {p.category}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-xs text-slate-300 truncate mt-0.5">{p.name}</div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>

                        {/* 2. Số lô sản xuất (Hiển thị danh mục số lô của mã) */}
                        <div className="space-y-2 relative">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5">
                                    <span>SỐ LÔ SẢN XUẤT *</span>
                                    {newIssueProductCode && availableLotsForProduct.length > 0 && (
                                        <span className="text-[10px] text-emerald-400 font-normal">({availableLotsForProduct.length} lô sẵn có)</span>
                                    )}
                                </label>
                                <span className="text-[10px] text-slate-500 font-normal">Chọn lô hoặc gõ</span>
                            </div>
                            <div className="relative">
                                <input
                                    required
                                    type="text"
                                    value={newIssueLotNumber}
                                    onChange={(e) => {
                                        setNewIssueLotNumber(e.target.value);
                                        setIsLotDropdownOpen(true);
                                    }}
                                    onFocus={() => {
                                        setIsLotDropdownOpen(true);
                                        setIsProductDropdownOpen(false);
                                        setIsCustomerDropdownOpen(false);
                                    }}
                                    placeholder="Ví dụ: LOT-SARS-2607A"
                                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-primary/50 font-mono"
                                />
                                {newIssueLotNumber && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setNewIssueLotNumber("");
                                            setIsLotDropdownOpen(true);
                                        }}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs p-1"
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>

                            {/* Dropdown danh mục số lô */}
                            {isLotDropdownOpen && (
                                <div className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-slate-900/98 backdrop-blur-md border border-slate-700 rounded-xl shadow-2xl divide-y divide-slate-800/70 custom-scrollbar">
                                    <div className="p-2 bg-slate-800/80 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between sticky top-0 backdrop-blur-sm z-10">
                                        <span>
                                            {newIssueProductCode
                                                ? `Số lô của mã [${newIssueProductCode}]`
                                                : "Danh mục số lô kho"}
                                        </span>
                                        <span className="text-emerald-400 font-normal">{filteredLotsForDropdown.length} lô</span>
                                    </div>
                                    {filteredLotsForDropdown.length === 0 ? (
                                        <div className="p-3 text-xs text-slate-400 text-center space-y-1">
                                            <p className="text-slate-400">
                                                {newIssueProductCode
                                                    ? `Chưa có dữ liệu lô lưu kho cho mã ${newIssueProductCode}`
                                                    : "Chưa chọn mã sản phẩm"}
                                            </p>
                                            <p className="text-[11px] text-slate-500">Bạn có thể tự do gõ số lô khách hàng phản ánh.</p>
                                        </div>
                                    ) : (
                                        filteredLotsForDropdown.map((lot: any) => (
                                            <div
                                                key={lot.lot_number}
                                                onClick={() => handleSelectLot(lot)}
                                                className={`p-2.5 hover:bg-slate-800/80 cursor-pointer transition-all ${
                                                    newIssueLotNumber.trim().toLowerCase() === String(lot.lot_number).toLowerCase() ? "bg-emerald-500/20" : ""
                                                }`}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <span className="font-mono font-bold text-xs text-emerald-300">{lot.lot_number}</span>
                                                    {lot.quantity !== undefined && lot.quantity !== null && (
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                                                            Tồn: {lot.quantity}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                                                    {lot.expiration_date && <span>HSD: {lot.expiration_date}</span>}
                                                    {lot.product_code && lot.product_code !== newIssueProductCode && (
                                                        <span>(Mã: {lot.product_code})</span>
                                                    )}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 3. Tên sản phẩm (Tự động hiển thị theo mã sản phẩm) */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5">
                                <span>TÊN SẢN PHẨM *</span>
                                {newIssueProductName && (
                                    <span className="text-[10px] text-teal-400 font-normal">
                                        (Tự động điền theo mã SP)
                                    </span>
                                )}
                            </label>
                            <span className="text-[10px] text-slate-500 font-normal">Có thể chỉnh sửa</span>
                        </div>
                        <input
                            required
                            type="text"
                            value={newIssueProductName}
                            onChange={(e) => setNewIssueProductName(e.target.value)}
                            placeholder="Ví dụ: Kit chẩn đoán SARS-CoV-2 Real-time PCR"
                            className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-primary/50"
                        />
                    </div>

                    {/* 4. Khách hàng & Thông tin liên hệ */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Tên khách hàng / Cơ sở y tế (Searchable Combobox) */}
                        <div className="space-y-2 relative">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-bold text-slate-400 uppercase">
                                    TÊN KHÁCH HÀNG / CƠ SỞ Y TẾ *
                                </label>
                                <span className="text-[10px] text-slate-500 font-normal">Gõ tìm kiếm</span>
                            </div>
                            <div className="relative">
                                <input
                                    required
                                    type="text"
                                    value={newIssueCustomerName}
                                    onChange={(e) => handleCustomerNameChange(e.target.value)}
                                    onFocus={() => {
                                        setIsCustomerDropdownOpen(true);
                                        setIsProductDropdownOpen(false);
                                        setIsLotDropdownOpen(false);
                                    }}
                                    placeholder="Ví dụ: Bệnh viện Đa khoa Medlatec"
                                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-primary/50"
                                />
                                {newIssueCustomerName && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setNewIssueCustomerName("");
                                            setIsCustomerDropdownOpen(true);
                                        }}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs p-1"
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>

                            {/* Dropdown danh mục khách hàng */}
                            {isCustomerDropdownOpen && (
                                <div className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-slate-900/98 backdrop-blur-md border border-slate-700 rounded-xl shadow-2xl divide-y divide-slate-800/70 custom-scrollbar">
                                    <div className="p-2 bg-slate-800/80 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between sticky top-0 backdrop-blur-sm z-10">
                                        <span>Danh mục khách hàng ({filteredCustomersForDropdown.length})</span>
                                        <span className="text-teal-400 font-normal">Tự điền thông tin liên hệ</span>
                                    </div>
                                    {filteredCustomersForDropdown.length === 0 ? (
                                        <div className="p-3 text-xs text-slate-400 text-center">
                                            Không có khách hàng trùng khớp. Bạn vẫn có thể nhập tên cơ sở y tế mới tự do.
                                        </div>
                                    ) : (
                                        filteredCustomersForDropdown.map((c: any) => (
                                            <div
                                                key={c.id || c.customer_code || c.name}
                                                onClick={() => handleSelectCustomer(c)}
                                                className={`p-2.5 hover:bg-slate-800/80 cursor-pointer transition-all ${
                                                    newIssueCustomerName.trim().toLowerCase() === String(c.name).toLowerCase() ? "bg-primary/20" : ""
                                                }`}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="font-bold text-xs text-slate-200">{c.name}</span>
                                                    {c.customer_code && (
                                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 font-mono">
                                                            {c.customer_code}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-1">
                                                    {c.contact_person && <span>LH: {c.contact_person}</span>}
                                                    {c.phone && <span>• SĐT: {c.phone}</span>}
                                                    {c.province && <span>• {c.province}</span>}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Thông tin liên hệ khách hàng (Tự động hiển thị theo khách hàng) */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5">
                                    <span>THÔNG TIN LIÊN HỆ KHÁCH HÀNG</span>
                                    {newIssueContactInfo && (
                                        <span className="text-[10px] text-teal-400 font-normal">
                                            (Tự động điền)
                                        </span>
                                    )}
                                </label>
                                <span className="text-[10px] text-slate-500 font-normal">BS, SĐT, Email</span>
                            </div>
                            <input
                                type="text"
                                value={newIssueContactInfo}
                                onChange={(e) => setNewIssueContactInfo(e.target.value)}
                                placeholder="Tên BS, SĐT liên lạc..."
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-primary/50"
                            />
                        </div>
                    </div>

                    {/* Mô tả chi tiết */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-400 uppercase">MÔ TẢ CHI TIẾT SỰ CỐ BAN ĐẦU *</label>
                        <textarea
                            required
                            rows={3}
                            value={newIssueDesc}
                            onChange={(e) => setNewIssueDesc(e.target.value)}
                            placeholder="Mô tả cụ thể sự cố khách hàng gặp phải (ví dụ: chứng dương không lên, có vạch mờ ở chứng âm...)"
                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
                        />
                    </div>

                    <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
                        <AttachmentPicker
                            files={newIssueAttachments}
                            onChange={setNewIssueAttachments}
                            label="Hình ảnh / video sự cố"
                            hint="Ảnh kết quả, ảnh mẫu, video hiện tượng, file dữ liệu máy... (tối đa 200 MB mỗi tệp)"
                        />
                    </div>

                    <div className="flex gap-3 pt-4 border-t border-white/5">
                        <button
                            type="button"
                            onClick={() => {
                                setIsCreateIssueModalOpen(false);
                                setIsProductDropdownOpen(false);
                                setIsLotDropdownOpen(false);
                                setIsCustomerDropdownOpen(false);
                            }}
                            className="flex-1 py-3 bg-white/5 text-slate-400 hover:bg-white/10 border border-white/5 font-bold rounded-xl text-xs transition-all cursor-pointer"
                        >
                            Hủy bỏ
                        </button>
                        <button
                            type="submit"
                            className="flex-1 py-3 bg-primary hover:bg-primary/95 text-white font-bold rounded-xl text-xs active:scale-95 shadow transition-all cursor-pointer"
                        >
                            Tiếp nhận sự cố
                        </button>
                    </div>
                </form>
            </Modal>
        </div>
    );
}

// Inner helper component for Task Card
interface TaskCardProps {
    task: any;
    onMove: (ns: string) => void;
    onDelete: () => void;
    onOpenDetails: () => void;
}

function TaskCard({ task, onMove, onDelete, onOpenDetails }: TaskCardProps) {
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    const getPriorityColor = (priority: string) => {
        switch (priority?.toLowerCase()) {
            case "critical": return "bg-rose-500/10 text-rose-400 border-rose-500/25";
            case "high": return "bg-orange-500/10 text-orange-400 border-orange-500/25";
            case "medium": return "bg-amber-500/10 text-amber-400 border-amber-500/25";
            default: return "bg-slate-500/10 text-slate-400 border-slate-500/25";
        }
    };

    const getCategoryIcon = (category: string) => {
        switch (category) {
            case "Triển khai/demo sản phẩm": return Send;
            case "Thử nghiệm đánh giá chất lượng sản phẩm": return CheckCircle2;
            case "Thử nghiệm xác định nguyên nhân sự cố chất lượng sản phẩm": return AlertTriangle;
            case "Bảo trì/sửa chữa thiết bị (bao gồm nội bộ và cho khách hàng)": return Wrench;
            default: return FileText;
        }
    };

    const CategoryIcon = getCategoryIcon(task.category);

    return (
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-white/5 hover:border-white/10 transition-all shadow group relative">
            {(task.isFromSales || task.salesReqId || task.salesCustomerName) && (
                <div className="mb-2 bg-purple-100 dark:bg-purple-500/15 border border-purple-300 dark:border-purple-500/30 text-purple-800 dark:text-purple-300 px-2.5 py-1 rounded-lg text-[9px] font-bold flex items-center justify-between shadow-sm">
                    <span className="flex items-center gap-1 truncate">
                        <Sparkles className="w-3 h-3 text-purple-600 dark:text-purple-400 shrink-0" />
                        Từ Sales: <strong className="text-purple-950 dark:text-white">{task.salesCustomerName || task.salesRepName}</strong>
                    </span>
                    <span className="bg-purple-200 dark:bg-purple-900/80 px-1.5 py-0.5 rounded text-[8px] font-mono text-purple-900 dark:text-purple-200 uppercase tracking-wider font-bold">Phối hợp</span>
                </div>
            )}
            <div className="flex justify-between items-start gap-4">
                <div className="space-y-1 max-w-[85%]">
                    <div className="flex items-center gap-1.5">
                        <CategoryIcon className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="text-[10px] text-slate-500 font-bold truncate">{task.category}</span>
                    </div>
                    <button
                        onClick={onOpenDetails}
                        className="font-bold text-white text-xs leading-snug hover:underline text-left block"
                    >
                        {task.title}
                    </button>
                </div>

                {/* Move Status buttons drop-down */}
                <div className="relative">
                    <button
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                        className="p-1 hover:bg-white/5 rounded text-slate-500 hover:text-white animate-all"
                    >
                        <Settings className="w-3.5 h-3.5" />
                    </button>
                    {isMenuOpen && (
                        <>
                            <div className="fixed inset-0 z-30" onClick={() => setIsMenuOpen(false)} />
                            <div className="absolute right-0 mt-1.5 w-36 bg-slate-950 border border-white/10 rounded-xl shadow-xl p-1 z-40 text-[10px] font-bold">
                                {task.status !== "Chưa bắt đầu" && (
                                    <button
                                        onClick={() => { onMove("Chưa bắt đầu"); setIsMenuOpen(false); }}
                                        className="w-full text-left px-3 py-2 text-slate-400 hover:bg-white/5 hover:text-white rounded-lg transition-colors"
                                    >
                                        Chưa bắt đầu
                                    </button>
                                )}
                                {task.status !== "Đang thực hiện" && (
                                    <button
                                        onClick={() => { onMove("Đang thực hiện"); setIsMenuOpen(false); }}
                                        className="w-full text-left px-3 py-2 text-amber-400 hover:bg-white/5 rounded-lg transition-colors"
                                    >
                                        Đang thực hiện
                                    </button>
                                )}
                                {task.status !== "Hoàn thành" && (
                                    <button
                                        onClick={() => { onMove("Hoàn thành"); setIsMenuOpen(false); }}
                                        className="w-full text-left px-3 py-2 text-emerald-400 hover:bg-white/5 rounded-lg transition-colors"
                                    >
                                        Hoàn thành
                                    </button>
                                )}
                                <button
                                    onClick={() => { onDelete(); setIsMenuOpen(false); }}
                                    className="w-full text-left px-3 py-2 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors border-t border-white/5 mt-1"
                                >
                                    Xóa công việc
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            <p className="text-[10px] text-slate-500 mt-2 line-clamp-2 leading-relaxed">{task.desc}</p>

            {task.productLot && (
                <div className="mt-2 text-[9px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 w-fit">
                    Lô sản phẩm: {task.productLot}
                </div>
            )}
            {task.deviceInfo && (
                <div className="mt-2 text-[9px] font-bold text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/20 w-fit">
                    Thiết bị: {task.deviceInfo}
                </div>
            )}

            {/* Checklist progress bar */}
            {Array.isArray(task.checklist) && task.checklist.length > 0 && (
                <div className="mt-3 space-y-1">
                    <div className="flex justify-between text-[8px] font-bold text-slate-500">
                        <span>Tiến độ checklist</span>
                        <span>
                            {task.checklist.filter((c: any) => c && c.done).length}/{task.checklist.length}
                        </span>
                    </div>
                    <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary transition-all duration-300"
                            style={{ width: `${(task.checklist.filter((c: any) => c && c.done).length / task.checklist.length) * 100}%` }}
                        />
                    </div>
                </div>
            )}

            <div className="flex justify-between items-center mt-4 border-t border-white/5 pt-3 text-[9px] font-bold">
                <div className="flex items-center gap-1.5 text-slate-400">
                    <User className="w-3 h-3 text-primary shrink-0" />
                    <span>{task.assignee}</span>
                </div>
                <span className={cn("px-2 py-0.5 rounded border uppercase text-[8px] tracking-wide", getPriorityColor(task.priority))}>
                    {task.priority === "Critical" ? "Khẩn cấp" : task.priority === "High" ? "Cao" : task.priority === "Medium" ? "Trung bình" : "Thấp"}
                </span>
            </div>
        </div>
    );
}

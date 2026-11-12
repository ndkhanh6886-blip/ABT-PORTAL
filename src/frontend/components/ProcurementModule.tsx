"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { writeSafePrintDocument } from "@/frontend/utils/safePrint";
import {
  ShoppingCart,
  Building2,
  Plus,
  ArrowDownLeft,
  DollarSign,
  Search,
  CheckCircle2,
  Clock,
  X,
  FileText,
  AlertTriangle,
  Printer,
  CreditCard,
  ArrowRight,
  Edit2,
  Trash2,
  Eye,
  PackageCheck,
  Star,
  Check,
  Truck,
  Anchor,
  FileSearch,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Calendar,
  XCircle,
  ShieldCheck,
  Sparkles,
  Layers,
  Upload,
  Download,
  FileSpreadsheet,
  History,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Package,
  Tag,
  SlidersHorizontal,
  Maximize2,
  Minimize2,
  RotateCcw
} from "lucide-react";
import * as XLSX from "xlsx";
import { formatCurrency, formatDate } from "@/backend/services/utils";
import { useNotification } from "@/frontend/contexts/NotificationContext";
import { MoneyInput } from "@/frontend/components/MoneyInput";
import { LineItemLookup } from "@/frontend/components/LineItemLookup";
import { usePaymentMethods } from "@/frontend/utils/paymentMethods";
import { useAuth } from "@/frontend/contexts/AuthContext";
import { useCompanyConfig } from "@/frontend/utils/companyConfig";
import { todayVN, toVNDateString, formatVNDate, formatVNDateTime } from "@/backend/services/dates";
import { DateInputVN } from "@/frontend/components/DateInputVN";
import { Pager, usePaged } from "@/frontend/components/Pager";
import { PRLineItemsView } from "@/frontend/components/procurement/PRLineItemsView";
import { ItemStockHover, type ItemDemandInfo } from "@/frontend/components/procurement/ItemStockHover";
import { POLineItemsView } from "@/frontend/components/procurement/POLineItemsView";

const cn = (...classes: any[]) => classes.filter(Boolean).join(" ");

// Comprehensive PO Status Configuration with Imports / Customs Lifecycle (Logical XNK Order - Proposal 4c)
export const PO_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string; icon: any; isImport?: boolean }> = {
  PENDING: {
    label: "Chờ xác nhận",
    bg: "bg-amber-50 dark:bg-amber-950/50",
    text: "text-amber-700 dark:text-amber-400",
    border: "border-amber-200 dark:border-amber-800",
    icon: Clock
  },
  CONFIRMED: {
    label: "Đã xác nhận",
    bg: "bg-blue-50 dark:bg-blue-950/50",
    text: "text-blue-700 dark:text-blue-400",
    border: "border-blue-200 dark:border-blue-800",
    icon: CheckCircle2
  },
  ORDERED: {
    label: "Đã đặt hàng",
    bg: "bg-sky-50 dark:bg-sky-950/50",
    text: "text-sky-700 dark:text-sky-400",
    border: "border-sky-200 dark:border-sky-800",
    icon: ShoppingCart
  },
  PRODUCED: {
    label: "Đã sản xuất xong",
    bg: "bg-indigo-50 dark:bg-indigo-950/50",
    text: "text-indigo-700 dark:text-indigo-400",
    border: "border-indigo-200 dark:border-indigo-800",
    icon: Package
  },
  SHIPPED: {
    label: "Đang vận chuyển",
    bg: "bg-purple-50 dark:bg-purple-950/50",
    text: "text-purple-700 dark:text-purple-400",
    border: "border-purple-200 dark:border-purple-800",
    icon: Truck
  },
  AT_CUSTOMS: {
    label: "Đã đến hải quan",
    bg: "bg-cyan-50 dark:bg-cyan-950/50",
    text: "text-cyan-700 dark:text-cyan-400",
    border: "border-cyan-200 dark:border-cyan-800",
    icon: Anchor,
    isImport: true
  },
  CUSTOMS_CLEARING: {
    label: "Đang làm thủ tục thông quan",
    bg: "bg-orange-50 dark:bg-orange-950/50",
    text: "text-orange-700 dark:text-orange-400",
    border: "border-orange-200 dark:border-orange-800",
    icon: FileSearch,
    isImport: true
  },
  PARTIALLY_RECEIVED: {
    label: "Nhập kho 1 phần",
    bg: "bg-teal-50 dark:bg-teal-950/50",
    text: "text-teal-700 dark:text-teal-400",
    border: "border-teal-200 dark:border-teal-800",
    icon: PackageCheck
  },
  COMPLETED: {
    label: "Đã nhập kho",
    bg: "bg-emerald-50 dark:bg-emerald-950/50",
    text: "text-emerald-700 dark:text-emerald-400",
    border: "border-emerald-200 dark:border-emerald-800",
    icon: PackageCheck
  },
  CANCELLED: {
    label: "Đã hủy đơn",
    bg: "bg-rose-50 dark:bg-rose-950/50",
    text: "text-rose-700 dark:text-rose-400",
    border: "border-rose-200 dark:border-rose-800",
    icon: XCircle
  }
};

// Standard 9-step XNK status progression for dropdowns
export const PO_STATUS_DROPDOWN_ORDER: string[] = [
  "PENDING",
  "CONFIRMED",
  "ORDERED",
  "PRODUCED",
  "SHIPPED",
  "AT_CUSTOMS",
  "CUSTOMS_CLEARING",
  "COMPLETED",
  "CANCELLED"
];

// Interactive Payment Status Configuration on PO Table (Requirement 6 / 4d)
export const PO_PAYMENT_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  UNPAID: {
    label: "Chưa trả",
    bg: "bg-slate-100 dark:bg-slate-800",
    text: "text-slate-600 dark:text-slate-400",
    border: "border-slate-200 dark:border-slate-700"
  },
  PAYMENT_REQUESTED: {
    label: "Đề nghị thanh toán",
    bg: "bg-amber-50 dark:bg-amber-950",
    text: "text-amber-700 dark:text-amber-400",
    border: "border-amber-200 dark:border-amber-800"
  },
  PARTIAL_PAID: {
    label: "Đã cọc / Trả 1 phần",
    bg: "bg-blue-50 dark:bg-blue-950",
    text: "text-blue-700 dark:text-blue-400",
    border: "border-blue-200 dark:border-blue-800"
  },
  PAID: {
    label: "Đã thanh toán",
    bg: "bg-emerald-50 dark:bg-emerald-950",
    text: "text-emerald-700 dark:text-emerald-400",
    border: "border-emerald-200 dark:border-emerald-800"
  }
};

/** Chuẩn hoá chuỗi tìm kiếm không dấu, không phân biệt hoa thường */
const normSearch = (v: any): string =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();

/** Ngày từ CSDL ("2026-10-16T17:00:00.000Z" = 17/10 giờ VN) -> "YYYY-MM-DD" theo giờ Việt Nam (cắt chuỗi UTC lệch 1 ngày). */
const dbDateVN = (v: any): string => {
  if (!v) return "";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return toVNDateString(v) || s.slice(0, 10);
};
/** Mã đơn bán ghi trong tiêu đề / ghi chú PR (SO26-CR-1004). */
const soCodeIn = (text: any): string => (String(text || "").match(/\bSO\d{2}-[A-Z0-9]{2,6}-\d{3,6}\b/) || [""])[0];
/** PR mua cho khách hàng thật (không phải đơn lưu kho). */
const isCustomerPR = (pr: any): boolean => {
  const c = String(pr?.customer_name || "").trim();
  return !!c && !/STOCK|kho|dự trữ|dự phòng|lưu trữ/i.test(c) && !String(pr?.workflow_code || "").includes("STOCK");
};

/** Bản cũ gắn mã PR vào đầu tên hàng ("[PR26-STOCK-1013] TopPURE..."): tách ra để tên hàng giữ đúng theo danh mục. */
const PR_NAME_PREFIX_RE = /^\[((?:PR|WF)[^\]]*)\]\s*/;
const cleanItemName = (name: any): string => String(name || "").replace(PR_NAME_PREFIX_RE, "");
const itemSourcePR = (it: any): string => String(it?.source_pr_code || String(it?.product_name || "").match(PR_NAME_PREFIX_RE)?.[1] || "");
/** Số đã nhập kho của dòng i. PO nhập kho bằng bản cũ (1 lần, không lưu theo dòng) mà đã COMPLETED: coi như nhập đủ. */
const receivedOf = (po: any, i: number): number => {
  const rq = po?.received_qty || {};
  if (rq[i] !== undefined) return Number(rq[i]) || 0;
  const legacyFull = po?.status === "COMPLETED" && Object.keys(rq).length === 0;
  return legacyFull ? Number(po?.items?.[i]?.quantity) || 0 : 0;
};

/** Chuyển chuỗi số (hỗ trợ cả dấu chấm và dấu phẩy thập phân) sang số thực */
const parseDecimalNum = (v: any): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "").trim().replace(/,/g, ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

/** Làm tròn đến 0 chữ số thập phân (số nguyên VNĐ) cho Đơn giá & Thành tiền trong PO */
const roundPrice3 = (v: any): number => Math.round(parseDecimalNum(v));

/** Chuẩn hóa ô nhập Đơn giá PO thành số nguyên (0 chữ số thập phân) */
const sanitizeDecimal3Input = (raw: string): string => {
  const norm = String(raw ?? "").replace(/,/g, ".").replace(/[^0-9.]/g, "");
  if (!norm) return "";
  if (norm.includes(".")) {
    const rounded = Math.round(parseFloat(norm) || 0);
    return rounded > 0 ? String(rounded) : "0";
  }
  return norm.replace(/^0+(\d)/, "$1");
};

/** Tính toán Thành tiền (trước VAT), Tiền VAT và Thành tiền sau VAT cho từng dòng PO */
const calcPOLine = (it: any) => {
  const qty = Number(it?.quantity) || 0;
  const price = roundPrice3(it?.unit_price);
  const subtotal = roundPrice3(qty * price);
  const vatRate = Math.max(0, Number(it?.vat_rate ?? it?.tax_rate ?? 0) || 0);
  const vatAmount = roundPrice3((subtotal * vatRate) / 100);
  const totalAfterVat = roundPrice3(subtotal + vatAmount);
  return { qty, price, subtotal, vatRate, vatAmount, totalAfterVat };
};

const calcPOTotals = (items: any[]) => {
  const arr = Array.isArray(items) ? items : [];
  let subtotal = 0;
  let vatAmount = 0;
  let totalAfterVat = 0;
  for (const it of arr) {
    const c = calcPOLine(it);
    subtotal = roundPrice3(subtotal + c.subtotal);
    vatAmount = roundPrice3(vatAmount + c.vatAmount);
    totalAfterVat = roundPrice3(totalAfterVat + c.totalAfterVat);
  }
  return { subtotal, vatAmount, totalAfterVat };
};

/** Trạng thái PO hải quan (gộp 1 nút lọc) và trạng thái đã đóng (không còn "đang mở"). */
const PO_CUSTOMS_STATUSES = ["AT_CUSTOMS", "CUSTOMS_CLEARING"];
const PO_CLOSED_STATUSES = ["COMPLETED", "CANCELLED"];

export const ProcurementModule: React.FC = () => {
  const { notifyActivity } = useNotification();
  const companyConfig = useCompanyConfig();
  const [subTab, setSubTab] = useState<"orders" | "pr" | "suppliers" | "payables" | "restock" | "lookup">("orders");
  const [alertSubView, setAlertSubView] = useState<"restock" | "near_expiry">("restock");
  const mainSectionRef = useRef<HTMLDivElement>(null);
  const scrollToMainSection = () => {
    setTimeout(() => {
      mainSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  };
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [allSupplierProducts, setAllSupplierProducts] = useState<any[]>([]);
  const [restockAlerts, setRestockAlerts] = useState<any[]>([]);
  const [purchaseRequests, setPurchaseRequests] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({
    total_spend: 0,
    total_paid: 0,
    total_payable: 0,
    active_orders_count: 0,
    pending_pr_count: 0,
    restock_alert_count: 0,
    total_suppliers_count: 0
  });
  const [loading, setLoading] = useState(true);

  // Search & Filters
  const [orderSearch, setOrderSearch] = useState("");
  // Lọc PO theo ngày đặt, số hóa đơn đầu vào, mã hàng
  const [orderFrom, setOrderFrom] = useState("");
  const [orderTo, setOrderTo] = useState("");
  const [orderInvoiceSearch, setOrderInvoiceSearch] = useState("");
  const [orderProductSearch, setOrderProductSearch] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [prSearch, setPRSearch] = useState("");
  // Tab PR: xem theo phiếu PR, hoặc theo từng mặt hàng đề xuất (chọn dòng để lập PO)
  const [prViewMode, setPRViewMode] = useState<"pr" | "lines">("pr");
  // Tab PO: xem theo đơn PO, hoặc theo từng dòng mặt hàng của các PO đang lọc
  const [poViewMode, setPOViewMode] = useState<"po" | "lines">("po");
  const [prStatusFilter, setPRStatusFilter] = useState("all");
  const [payableFilter, setPayableFilter] = useState("all");
  const [restockSupplierFilter, setRestockSupplierFilter] = useState("all");
  const [restockSearch, setRestockSearch] = useState("");

  // Inline Editing for Delivery Date
  const [editingDeliveryDateId, setEditingDeliveryDateId] = useState<number | null>(null);
  const [tempDeliveryDate, setTempDeliveryDate] = useState<string>(() => todayVN());

  // Interactive Status & Payment Dropdown Popovers
  const [activeStatusDropdownId, setActiveStatusDropdownId] = useState<number | null>(null);
  const [activePaymentDropdownId, setActivePaymentDropdownId] = useState<number | null>(null);

  // Non-blocking supplier price notice inside PO modal (Bug 4a fix)
  const [poSupplierNotice, setPoSupplierNotice] = useState<{
    supplierName: string;
    changes: { idx: number; it: any; price: number }[];
    notSold: any[];
    priceOf: Map<string, number>;
  } | null>(null);

  // Per-row search filter inside PR & PO modals (Issue 4 fix)
  const [prItemSearchQueries, setPrItemSearchQueries] = useState<Record<number, string>>({});
  const [poItemSearchQueries, setPoItemSearchQueries] = useState<Record<number, string>>({});

  // Expand/collapse states for PO & PR line-item lists
  const [expandedPOIds, setExpandedPOIds] = useState<Record<string, boolean>>({});
  const [expandedPRIds, setExpandedPRIds] = useState<Record<string, boolean>>({});

  const toggleExpandPO = (poId: string | number) => {
    setExpandedPOIds(prev => ({ ...prev, [poId]: !prev[poId] }));
  };

  const toggleExpandPR = (prId: string | number) => {
    setExpandedPRIds(prev => ({ ...prev, [prId]: !prev[prId] }));
  };

  const { user, can } = useAuth();

  // Modals
  const [isPOModalOpen, setIsPOModalOpen] = useState(false);
  const [selectedPODetail, setSelectedPODetail] = useState<any>(null);
  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isPRModalOpen, setIsPRModalOpen] = useState(false);

  // Supplier Products Catalog & Price Adjustment State
  const [selectedSupplierForCatalog, setSelectedSupplierForCatalog] = useState<any | null>(null);
  const [isSupplierCatalogOpen, setIsSupplierCatalogOpen] = useState(false);
  const [supplierProducts, setSupplierProducts] = useState<any[]>([]);
  const [loadingSupplierProducts, setLoadingSupplierProducts] = useState(false);
  const [supplierProductSearch, setSupplierProductSearch] = useState("");
  const [isAutoCollecting, setIsAutoCollecting] = useState(false);

  // Add / Edit Supplier Product Modal
  const [isAddEditProductModalOpen, setIsAddEditProductModalOpen] = useState(false);
  const [productForm, setProductForm] = useState<any>({
    id: null,
    supplier_id: null,
    product_code: "",
    product_name: "",
    specification: "",
    unit: "Cái",
    purchase_price: 0,
    notes: ""
  });

  // Adjust Price Modal
  const [isAdjustPriceModalOpen, setIsAdjustPriceModalOpen] = useState(false);
  const [adjustPriceTarget, setAdjustPriceTarget] = useState<any | null>(null);
  const [newPurchasePrice, setNewPurchasePrice] = useState<number | string>(0);
  const [priceAdjustmentReason, setPriceAdjustmentReason] = useState("");
  const [priceAdjustmentDate, setPriceAdjustmentDate] = useState(() => todayVN());
  const [syncCostPrice, setSyncCostPrice] = useState(true);
  const [isSavingPriceAdjustment, setIsSavingPriceAdjustment] = useState(false);

  // Price History Modal
  const [isPriceHistoryModalOpen, setIsPriceHistoryModalOpen] = useState(false);
  const [priceHistoryTarget, setPriceHistoryTarget] = useState<any | null>(null);

  const supplierCatalogFileInputRef = useRef<HTMLInputElement>(null);

  // Real-time Stock Intelligence & Customer Stock Allocation states
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  const [inventoryReservations, setInventoryReservations] = useState<any[]>([]);
  // Dòng SO đang chờ giao (để xem nhu cầu theo mã hàng khi rê chuột)
  const [soDemand, setSoDemand] = useState<any[]>([]);
  const [soDemandLoaded, setSoDemandLoaded] = useState(false);
  const [salesCustomers, setSalesCustomers] = useState<any[]>([]);

  // Consolidate PRs to Unified PO Modal State (Requirement 4 - Line-Item Level Consolidation)
  const [isConsolidateModalOpen, setIsConsolidateModalOpen] = useState(false);
  const [consolidateSupplierId, setConsolidateSupplierId] = useState<number | string>("");
  const [selectedPRIdsForConsolidate, setSelectedPRIdsForConsolidate] = useState<string[]>([]);
  const [selectedItemKeysForConsolidate, setSelectedItemKeysForConsolidate] = useState<string[]>([]);
  const [expandedPRKeys, setExpandedPRKeys] = useState<string[]>([]);
  const [consolidateExpectedDelivery, setConsolidateExpectedDelivery] = useState<string>(
    () => toVNDateString(new Date(Date.now() + 14 * 86400000))
  );
  const [consolidateNotes, setConsolidateNotes] = useState<string>("");
  const [isSubmittingConsolidate, setIsSubmittingConsolidate] = useState(false);

  // PO Form State
  const [poForm, setPOForm] = useState<any>({
    id: null,
    po_code: "",
    supplier_id: 1,
    supplier_name: "",
    order_date: todayVN(),
    expected_delivery_date: toVNDateString(new Date(Date.now() + 10 * 86400000)),
    items: [
      { product_code: "", product_name: "", quantity: 1, unit_price: 0, total: 0 }
    ],
    total_amount: 0,
    status: "PENDING",
    notes: ""
  });

  // Supplier Form State
  const [supplierForm, setSupplierForm] = useState<any>({
    id: null,
    supplier_code: "",
    name: "",
    short_name: "",
    contact_person: "",
    phone: "",
    email: "",
    address: "",
    product_lines: "",
    payment_terms: "Công nợ 30 ngày",
    rating: 5
  });

  // Payment Form State
  const paymentMethods = usePaymentMethods();
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  // Công nợ NCC: bộ lọc, chọn nhiều PO để chi một lần, sổ chi tiền (xem / hủy / sửa)
  const [payableSupplier, setPayableSupplier] = useState("all");
  const [payableFrom, setPayableFrom] = useState("");
  const [payableTo, setPayableTo] = useState("");
  const [payableSearch, setPayableSearch] = useState("");
  const [selectedPayPOs, setSelectedPayPOs] = useState<number[]>([]);
  const [poPayments, setPoPayments] = useState<any[]>([]);
  const [paymentHistoryPO, setPaymentHistoryPO] = useState<any | null>(null);
  // Sửa số HĐ / ngày HĐ đầu vào của PO
  const [invoiceEditPO, setInvoiceEditPO] = useState<any | null>(null);
  const [invoiceEditRows, setInvoiceEditRows] = useState<{ invoice_no: string; invoice_date: string; inbound_code?: string }[]>([]);
  const openInvoiceEditor = (po: any) => {
    let v: any = po?.supplier_invoices;
    if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = []; } }
    const rows = (Array.isArray(v) ? v : []).map((x: any) => ({ invoice_no: String(x.invoice_no || ""), invoice_date: x.invoice_date ? String(x.invoice_date).slice(0, 10) : "", inbound_code: x.inbound_code }));
    setInvoiceEditRows(rows.length > 0 ? rows : [{ invoice_no: "", invoice_date: todayVN() }]);
    setInvoiceEditPO(po);
  };
  const saveInvoiceEditor = async () => {
    if (!invoiceEditPO) return;
    try {
      const res = await fetch("/api/procurement?action=update_supplier_invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ po_id: invoiceEditPO.id, invoices: invoiceEditRows })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.success) { alert(d.error || "Không lưu được hóa đơn"); return; }
      setOrders(prev => prev.map(o => (o.id === invoiceEditPO.id ? { ...o, supplier_invoices: d.supplier_invoices } : o)));
      setInvoiceEditPO(null);
    } catch {
      alert("Lỗi kết nối máy chủ");
    }
  };
  const [paymentForm, setPaymentForm] = useState<any>({
    po_id: null,
    po_code: "",
    supplier_name: "",
    total_amount: 0,
    amount_paid: 0,
    remaining_balance: 0,
    payment_amount: 0,
    payment_method: "",
    reference_doc: "",
    payment_date: todayVN(),
    payment_notes: ""
  });

  const [selectedPRDetail, setSelectedPRDetail] = useState<any>(null);

  // PR Form State with Dynamic Item Lines (Catalog + First-time New Items)
  const [prForm, setPRForm] = useState<any>({
    title: "",
    priority: "MEDIUM",
    requester_name: "Phòng Cung Ứng",
    requester_dept: "Cung Ứng",
    product_info: "",
    due_date: toVNDateString(new Date(Date.now() + 7 * 86400000)),
    description: "",
    items: [
      {
        is_custom: false,
        product_code: "",
        product_name: "",
        specification: "",
        unit: "Hộp",
        quantity: 1,
        estimated_price: 0
      }
    ]
  });

  // Full merged product catalog combining products + allSupplierProducts + Make-to-order Oligo/Custom templates
  const mergedCatalogProducts = useMemo(() => {
    const map = new Map<string, any>();
    const defaultCustomTemplates = [
      {
        id: "tpl-oligo-primer",
        code: "OLIGO-PRIMER",
        parent_code: "",
        name: "Đoạn mồi Oligo Primer tổng hợp theo trình tự (5'→3')",
        specification: "Nhập trình tự 5'-...-3' | Scale (25/50/100 nmol) | Tinh sạch (DSL/HPLC/PAGE)",
        unit: "Tube",
        cost_price: 120000,
        brand: "IDT / Macrogen / PhuSa",
        manufacturer: "IDT / Macrogen / PhuSa",
        storage_condition: "-20°C (Lạnh âm sâu - Sinh phẩm, Enzyme)"
      },
      {
        id: "tpl-oligo-probe",
        code: "OLIGO-PROBE",
        parent_code: "",
        name: "Đầu dò huỳnh quang TaqMan / Real-time PCR Probe theo trình tự (5'→3')",
        specification: "Nhập trình tự 5'[Reporter]-...-[Quencher]3' (VD: FAM-BHQ1 / HEX-BHQ1 / CY5-BHQ2 | HPLC)",
        unit: "Tube",
        cost_price: 950000,
        brand: "IDT / Macrogen / PhuSa",
        manufacturer: "IDT / Macrogen / PhuSa",
        storage_condition: "-20°C (Lạnh âm sâu - Sinh phẩm, Enzyme)"
      },
      {
        id: "tpl-oligo-base",
        code: "OLIGO-BASE",
        parent_code: "",
        name: "Tổng hợp chuỗi Nucleotide chuẩn theo trình tự (5'→3')",
        specification: "[Tên trình tự] 5'-...-3' (Số base | Scale 25/50/100 nmol)",
        unit: "Base",
        cost_price: 5500,
        brand: "IDT / Macrogen / PhuSa",
        manufacturer: "IDT / Macrogen / PhuSa",
        storage_condition: "-20°C (Lạnh âm sâu - Sinh phẩm, Enzyme)"
      },
      {
        id: "tpl-oligo-mod",
        code: "OLIGO-MOD",
        parent_code: "",
        name: "Đánh dấu biến đổi Oligo (5'/3'/Internal Modification: FAM, HEX, VIC, CY5, BHQ1/2, MGB...)",
        specification: "[Tên trình tự] Nhãn biến đổi 5'/3' (VD: 5'-FAM / 3'-BHQ1)",
        unit: "Nhãn",
        cost_price: 450000,
        brand: "IDT / Macrogen / PhuSa",
        manufacturer: "IDT / Macrogen / PhuSa",
        storage_condition: "-20°C (Lạnh âm sâu - Sinh phẩm, Enzyme)"
      },
      {
        id: "tpl-oligo-pur",
        code: "OLIGO-PUR",
        parent_code: "",
        name: "Dịch vụ tinh sạch Oligo chuyên sâu (HPLC / PAGE / Cartridge / Desalt)",
        specification: "[Tên trình tự] Tinh sạch: HPLC / PAGE / Cartridge / Desalt",
        unit: "Tube",
        cost_price: 200000,
        brand: "IDT / Macrogen / PhuSa",
        manufacturer: "IDT / Macrogen / PhuSa",
        storage_condition: "-20°C (Lạnh âm sâu - Sinh phẩm, Enzyme)"
      },
      {
        id: "tpl-oligo-svc",
        code: "OLIGO-SVC",
        parent_code: "",
        name: "Dịch vụ điều chế Oligo (Đông khô / Pha sẵn chuẩn 100 µM TE Buffer / Chia aliquot)",
        specification: "[Tên trình tự] Dịch vụ điều chế: Đông khô / Pha sẵn chuẩn 100 µM",
        unit: "Tube",
        cost_price: 80000,
        brand: "IDT / Macrogen / PhuSa",
        manufacturer: "IDT / Macrogen / PhuSa",
        storage_condition: "-20°C (Lạnh âm sâu - Sinh phẩm, Enzyme)"
      },
      {
        id: "tpl-custom-order",
        code: "CUSTOM-ORDER",
        parent_code: "",
        name: "Hàng hóa / Sinh phẩm đặt riêng theo thông số đặc thù (Make-to-Order)",
        specification: "Nhập quy cách / đặc tính kỹ thuật riêng của lần đặt hàng này",
        unit: "Bộ",
        cost_price: 0,
        brand: "Theo đơn đặt",
        manufacturer: "Theo đơn đặt",
        storage_condition: "2-8°C (Kho mát - Hóa chất, Kháng thể)"
      }
    ];
    for (const tpl of defaultCustomTemplates) {
      map.set(tpl.code, tpl);
    }
    for (const p of products) {
      const codeKey = String(p.code || "").trim().toUpperCase();
      if (!codeKey) continue;
      map.set(codeKey, p);
    }
    for (const sp of allSupplierProducts) {
      const codeKey = String(sp.product_code || "").trim().toUpperCase();
      if (!codeKey) continue;
      if (!map.has(codeKey)) {
        map.set(codeKey, {
          id: `sp-${sp.id}`,
          code: sp.product_code,
          parent_code: "",
          name: sp.product_name || sp.product_code,
          specification: sp.specification || "",
          unit: sp.unit || "Hộp",
          cost_price: parseFloat(sp.purchase_price) || 0,
          brand: sp.supplier_short_name || sp.supplier_name || "",
          manufacturer: sp.supplier_short_name || sp.supplier_name || "",
          supplier_id: sp.supplier_id,
          supplier_name: sp.supplier_name || ""
        });
      } else {
        const existing = map.get(codeKey);
        if (!existing.cost_price && sp.purchase_price) {
          existing.cost_price = parseFloat(sp.purchase_price) || 0;
        }
        if (!existing.supplier_id && sp.supplier_id) {
          existing.supplier_id = sp.supplier_id;
          existing.supplier_name = sp.supplier_name || existing.supplier_name;
        }
      }
    }
    return Array.from(map.values());
  }, [products, allSupplierProducts]);

  const filterCatalogItemsByQuery = (queryStr: string) => {
    const q = normSearch(queryStr);
    if (!q) return mergedCatalogProducts;
    return mergedCatalogProducts.filter((p: any) => {
      const hay = normSearch(
        `${p.code || ""} ${p.parent_code || ""} ${p.name || ""} ${p.brand || ""} ${p.manufacturer || ""} ${p.supplier_name || ""} ${p.category || ""} ${p.specification || ""}`
      );
      return hay.includes(q);
    });
  };

  const handleOpenNewPRModal = () => {
    setPrItemSearchQueries({});
    setPRForm({
      id: null,
      workflow_code: "",
      title: "",
      priority: "MEDIUM",
      requester_name: "Phòng Cung Ứng",
      requester_dept: "Cung Ứng",
      product_info: "",
      due_date: toVNDateString(new Date(Date.now() + 7 * 86400000)),
      description: "",
      items: [
        {
          is_custom: false,
          product_code: "",
          product_name: "",
          specification: "",
          unit: "Hộp",
          quantity: 1,
          estimated_price: 0
        }
      ]
    });
    setIsPRModalOpen(true);
  };

  // Requirement 6 (4e): Edit an existing PR that has not yet been fully converted to a PO
  const handleEditPR = (pr: any) => {
    const existingItems = getPRItems(pr)
      .filter((it: any) => !it.is_missing_catalog_product && it.product_code && it.product_code !== "TBR-ITEM")
      .map((it: any) => ({
        ...it,
        is_custom: Boolean(it.is_custom),
        product_code: it.product_code || "",
        product_name: cleanItemName(it.product_name || ""),
        specification: it.specification || "",
        unit: it.unit || "Hộp",
        quantity: Number(it.quantity) || 1,
        estimated_price: parseFloat(it.estimated_price || it.unit_price || 0) || 0
      }));
    setPrItemSearchQueries({});
    setPRForm({
      id: pr.id,
      workflow_code: pr.workflow_code || "",
      title: pr.title || "",
      priority: pr.priority || "MEDIUM",
      requester_name: pr.requester_name || "Phòng Cung Ứng",
      requester_dept: pr.requester_dept || "Cung Ứng",
      customer_name: pr.customer_name || "",
      product_info: pr.product_info || "",
      due_date: pr.due_date ? dbDateVN(pr.due_date) : toVNDateString(new Date(Date.now() + 7 * 86400000)),
      description: pr.description || "",
      items: existingItems.length > 0 ? existingItems : [
        {
          is_custom: false,
          product_code: "",
          product_name: "",
          specification: "",
          unit: "Hộp",
          quantity: 1,
          estimated_price: 0
        }
      ]
    });
    setIsPRModalOpen(true);
  };

  // Requirement 6 (4e): Cancel an existing PR that has not yet been converted to a PO
  const handleCancelPR = async (pr: any) => {
    const reason = window.prompt(`Nhập lý do hủy đề xuất mua hàng ${pr.workflow_code || ""}:`, "Thay đổi kế hoạch mua hàng / Hủy đề xuất");
    if (reason === null) return;
    try {
      const res = await fetch("/api/procurement?action=update_pr_status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: pr.id,
          status: "CANCELLED",
          note: `Hủy đề xuất PR: ${reason.trim() || "Người dùng hủy"}`
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setPurchaseRequests(prev => prev.map(x => x.id === pr.id ? { ...x, status: "CANCELLED" } : x));
        fetchData();
      } else {
        alert(data.error || "Không thể hủy đề xuất PR");
      }
    } catch {
      alert("Lỗi kết nối khi hủy đề xuất PR");
    }
  };

  const handleAddPRItem = () => {
    setPRForm((prev: any) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          is_custom: false,
          product_code: "",
          product_name: "",
          specification: "",
          unit: "Hộp",
          quantity: 1,
          estimated_price: 0
        }
      ]
    }));
  };

  const handleRemovePRItem = (index: number) => {
    if (prForm.items.length <= 1) return;
    // Dòng đã lên PO không xóa được khỏi PR (máy chủ giữ lại khi lưu) — báo rõ thay vì để người dùng xóa rồi thấy nó quay lại
    const target = prForm.items[index];
    if (target?.po_code) {
      alert(`Mặt hàng ${target.product_code || ""} đã lên đơn mua ${target.po_code}, không xóa khỏi PR được.\n\nNếu dòng này không thuộc PR của bạn, hãy báo Quản trị viên kiểm tra.`);
      return;
    }
    setPRForm((prev: any) => ({
      ...prev,
      items: prev.items.filter((_: any, i: number) => i !== index)
    }));
  };

  const handleToggleItemCustom = (index: number, isCustom: boolean) => {
    setPRForm((prev: any) => {
      const updated = [...prev.items];
      if (isCustom) {
        updated[index] = {
          ...updated[index],
          is_custom: true,
          product_code: updated[index].product_code?.startsWith("TBR-") ? "" : updated[index].product_code,
          specification: updated[index].specification || "",
          unit: updated[index].unit || "Cái"
        };
      } else {
        updated[index] = {
          ...updated[index],
          is_custom: false,
          product_code: "",
          product_name: "",
          specification: "",
          unit: "Hộp",
          estimated_price: 0
        };
      }
      return { ...prev, items: updated };
    });
  };

  const handleSelectExistingProduct = (index: number, code: string) => {
    const prod = mergedCatalogProducts.find((p: any) => p.code === code) || products.find((p: any) => p.code === code);
    setPRForm((prev: any) => {
      const updated = [...prev.items];
      if (prod) {
        updated[index] = {
          ...updated[index],
          is_custom: false,
          product_code: prod.code,
          product_name: prod.name,
          specification: prod.specification || "",
          unit: prod.unit || "Hộp",
          estimated_price: parseFloat(prod.cost_price) || 0
        };
      } else {
        updated[index] = {
          ...updated[index],
          product_code: code
        };
      }
      return { ...prev, items: updated };
    });
  };

  const handlePRItemChange = (index: number, field: string, value: any) => {
    setPRForm((prev: any) => {
      const updated = [...prev.items];
      updated[index] = {
        ...updated[index],
        [field]: value
      };
      return { ...prev, items: updated };
    });
  };

  /** Tồn kho & nhu cầu của một mã hàng (thẻ hiện khi rê chuột vào mã hàng trong PR). */
  const getItemDemandInfo = (productCode: string): ItemDemandInfo | null => {
    const key = String(productCode || "").trim().toUpperCase();
    if (!key) return null;
    const same = (v: any) => String(v || "").trim().toUpperCase() === key;
    const invRows = inventoryItems.filter((it: any) => same(it.product_code));
    const onHand = invRows.reduce((s: number, it: any) => s + (Number(it.quantity_on_hand) || 0), 0);
    const resRows = inventoryReservations.filter((r: any) => same(r.product_code) && String(r.status || "ACTIVE").toUpperCase() === "ACTIVE");
    const reservations = resRows.map((r: any) => ({
      order_code: r.order_code || r.reference_code || "",
      customer: r.customer_name || "",
      sales_rep: r.sales_rep_name || "",
      qty: Number(r.quantity_reserved) || 0,
    })).filter((r: any) => r.qty > 0);
    const reserved = Math.max(
      reservations.reduce((s: number, r: any) => s + r.qty, 0),
      invRows.reduce((s: number, it: any) => s + (Number(it.quantity_reserved) || 0), 0)
    );
    const incomingPOs: any[] = [];
    for (const po of orders) {
      const st = String(po.status || "").toUpperCase();
      if (["COMPLETED", "CANCELLED", "RECEIVED"].includes(st)) continue;
      const items = Array.isArray(po.items) ? po.items : [];
      items.forEach((it: any, idx: number) => {
        if (!same(it.product_code || it.code)) return;
        const rem = Math.max(0, (Number(it.quantity) || 0) - receivedOf(po, idx));
        if (rem <= 0) return;
        const sup = suppliers.find((x: any) => String(x.id) === String(po.supplier_id));
        incomingPOs.push({
          po_code: po.po_code,
          supplier: String(sup?.short_name || "").trim() || po.supplier_name || "",
          qty: rem,
          eta: formatVNDate(po.expected_delivery_date),
        });
      });
    }
    const incoming = incomingPOs.reduce((s, p) => s + p.qty, 0);
    const soPendingOrders = soDemand
      .filter((r: any) => same(r.product_code))
      .map((r: any) => ({ order_code: r.order_code, customer: r.customer_name || "", qty: Number(r.quantity) || 0, order_date: r.order_date }));
    const prOpenLines: any[] = [];
    for (const pr of purchaseRequests) {
      const st = String(pr.status || "").toUpperCase();
      if (["CANCELLED", "REJECTED", "CONVERTED", "COMPLETED"].includes(st)) continue;
      getPRItems(pr).forEach((it: any, idx: number) => {
        if (!same(it.product_code) || it.po_code) return;
        if (getItemPOInfo(pr, it, idx).hasPO) return;
        prOpenLines.push({ pr_code: pr.workflow_code || String(pr.id), qty: Number(it.quantity) || 0 });
      });
    }
    return {
      code: key,
      unit: invRows[0]?.unit || "",
      onHand,
      reserved,
      reservations,
      available: Math.max(0, onHand - reserved),
      incoming,
      incomingPOs,
      soPending: soPendingOrders.reduce((s, o) => s + o.qty, 0),
      soPendingOrders,
      prOpen: prOpenLines.reduce((s, p) => s + p.qty, 0),
      prOpenLines,
      soLoaded: soDemandLoaded,
    };
  };

  const getProductStockIntelligence = (productCode: string) => {
    if (!productCode) return null;
    const cleanCode = productCode.trim().toLowerCase();
    
    // Physical on-hand items
    const matchedItems = inventoryItems.filter(
      (it: any) => (it.product_code || "").trim().toLowerCase() === cleanCode
    );
    const onHand = matchedItems.reduce((acc: number, it: any) => acc + (Number(it.quantity_on_hand) || 0), 0);
    const itemReserved = matchedItems.reduce((acc: number, it: any) => acc + (Number(it.quantity_reserved) || 0), 0);
    
    // Reservations
    const matchedReservations = inventoryReservations.filter(
      (res: any) => (res.product_code || "").trim().toLowerCase() === cleanCode
    );
    const activeReserved = Math.max(
      itemReserved,
      matchedReservations.reduce((acc: number, res: any) => acc + (Number(res.quantity_reserved) || 0), 0)
    );
    
    const available = Math.max(0, onHand - activeReserved);
    
    // Incoming open POs
    const currentPOId = poForm?.id;
    let incoming = 0;
    orders.forEach((ord: any) => {
      if (ord.id !== currentPOId && ord.status !== "COMPLETED" && ord.status !== "CANCELLED") {
        let itms = ord.items;
        if (typeof itms === "string") {
          try { itms = JSON.parse(itms); } catch (e) { itms = []; }
        }
        if (Array.isArray(itms)) {
          itms.forEach((pi: any) => {
            if ((pi.product_code || pi.code || "").trim().toLowerCase() === cleanCode) {
              incoming += Number(pi.quantity) || 0;
            }
          });
        }
      }
    });

    return {
      onHand,
      reserved: activeReserved,
      available,
      incoming,
      reservations: matchedReservations
    };
  };

  const fetchData = async (opts?: { silent?: boolean }) => {
    fetch("/api/procurement?action=so_demand")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && Array.isArray(d.rows)) { setSoDemand(d.rows); setSoDemandLoaded(true); } })
      .catch(() => {});
    try {
      if (!opts?.silent && orders.length === 0 && suppliers.length === 0) setLoading(true);
      const res = await fetch("/api/procurement?action=overview");
      const data = await res.json();
      if (data) {
        setSuppliers(data.suppliers || []);
        setOrders(data.orders || []);
        setProducts(data.products || []);
        setAllSupplierProducts(data.all_supplier_products || []);
        setRestockAlerts(data.restock_alerts || []);
        setPurchaseRequests(data.purchase_requests || []);
        if (data.stats) setStats(data.stats);
        if (data.inventory_items) setInventoryItems(data.inventory_items);
        if (data.inventory_reservations) setInventoryReservations(data.inventory_reservations);
        if (data.customers) setSalesCustomers(data.customers);
      }
    } catch (e) {
      console.error("Failed to load procurement data:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const onRevalidated = (e: any) => {
      if (e?.detail?.pathname === "/api/procurement") {
        fetchData({ silent: true });
      }
    };
    window.addEventListener("tbr:api-revalidated", onRevalidated);
    return () => window.removeEventListener("tbr:api-revalidated", onRevalidated);
  }, []);

  const supplierFileInputRef = useRef<HTMLInputElement>(null);

  const handleDownloadSupplierTemplate = () => {
    const sampleData = [
      {
        "Mã NCC (*)": "NCC-TBR-001",
        "Tên nhà cung cấp (*)": "Bioer Technology Co., Ltd (Đại Diện VN)",
        "Người liên hệ": "Trần Văn Nam",
        "Số điện thoại": "0901234567",
        "Email": "contact@bioer.vn",
        "Địa chỉ": "Tầng 5, Tòa nhà Meditech, Cầu Giấy, Hà Nội",
        "Ngành hàng cung ứng": "Hệ thống PCR, Máy Real-time PCR",
        "Điều khoản thanh toán": "Công nợ 30 ngày",
        "Đánh giá": 5
      },
      {
        "Mã NCC (*)": "NCC-TBR-002",
        "Tên nhà cung cấp (*)": "Corning Scientific SEA Pte Ltd",
        "Người liên hệ": "Nguyễn Hoàng Oanh",
        "Số điện thoại": "0987654321",
        "Email": "sea.sales@corning.com",
        "Địa chỉ": "Marina Bay Financial Centre, Singapore",
        "Ngành hàng cung ứng": "Vật tư tiêu hao, Đầu côn, Đĩa PCR",
        "Điều khoản thanh toán": "Thanh toán 100% khi phát hành BL",
        "Đánh giá": 5
      }
    ];
    const ws = XLSX.utils.json_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Mau_Nha_Cung_Cap");
    XLSX.writeFile(wb, "Mau_Nhap_Lieu_Nha_Cung_Cap_TBR.xlsx");
  };

  const handleSupplierExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setLoading(true);
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: "array" });
      const wsName = wb.SheetNames[0];
      const ws = wb.Sheets[wsName];
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

      if (rows.length === 0) {
        alert("File Excel không có dữ liệu!");
        return;
      }

      const res = await fetch("/api/inventory?action=import_excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows,
          detected_type: "SUPPLIERS"
        })
      });
      const result = await res.json();
      if (res.ok && result.success) {
        alert(`✅ ${result.message || `Nạp thành công ${rows.length} nhà cung cấp!`}`);
        fetchData();
      } else {
        alert(`❌ Lỗi khi nạp: ${result.error || "Không thể nạp dữ liệu"}`);
      }
    } catch (err: any) {
      console.error(err);
      alert(`❌ Lỗi đọc file Excel: ${err?.message || "Vui lòng kiểm tra lại file"}`);
    } finally {
      setLoading(false);
      if (supplierFileInputRef.current) {
        supplierFileInputRef.current.value = "";
      }
    }
  };

  // Close status & payment dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = () => {
      setActiveStatusDropdownId(null);
      setActivePaymentDropdownId(null);
    };
    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, []);

  // Helper to resolve PO payment status (Requirement 6 / 4d)
  const getPOPaymentStatus = (po: any): "UNPAID" | "PAYMENT_REQUESTED" | "PARTIAL_PAID" | "PAID" => {
    const explicit = String(po?.payment_status || "").toUpperCase();
    const totalAmt = parseFloat(po?.total_amount) || 0;
    const paidAmt = parseFloat(po?.amount_paid) || 0;
    if (explicit === "PAID" || (paidAmt >= totalAmt && totalAmt > 0)) return "PAID";
    if (explicit === "PAYMENT_REQUESTED") return "PAYMENT_REQUESTED";
    if (explicit === "PARTIAL_PAID" || paidAmt > 0) return "PARTIAL_PAID";
    return "UNPAID";
  };

  /**
   * Công nợ NCC theo hàng ĐÃ NHẬN KHO (nguyên tắc: nợ phải trả phát sinh khi nhận hàng):
   *  - Giá trị đã nhận = Tổng PO × (Σ SL đã nhận × đơn giá / Σ SL đặt × đơn giá)
   *  - Còn nợ = Giá trị đã nhận − Đã trả (> 0); Trả trước NCC = Đã trả − Giá trị đã nhận (> 0)
   */
  const poDebt = (po: any) => {
    let its: any = po?.items;
    if (typeof its === "string") { try { its = JSON.parse(its); } catch { its = []; } }
    its = Array.isArray(its) ? its : [];
    let orderedVal = 0, recVal = 0, orderedQty = 0, recQty = 0;
    its.forEach((it: any, i: number) => {
      const q = Number(it?.quantity) || 0;
      const r = Math.min(receivedOf({ ...po, items: its }, i), q);
      const c = calcPOLine(it);
      const unitGross = c.qty > 0 ? c.totalAfterVat / c.qty : c.price * (1 + c.vatRate / 100);
      orderedVal += q * unitGross; recVal += r * unitGross; orderedQty += q; recQty += r;
    });
    const total = parseFloat(po?.total_amount) || 0;
    const paid = parseFloat(po?.amount_paid) || 0;
    const ratio = orderedVal > 0 ? recVal / orderedVal : (orderedQty > 0 ? recQty / orderedQty : 0);
    const received = roundPrice3(total * ratio);
    const payable = Math.max(0, roundPrice3(received - paid));
    const prepaid = Math.max(0, roundPrice3(paid - received));
    const unreceived = Math.max(0, roundPrice3(total - received));
    const inboundReceivedValue = roundPrice3(parseFloat(po?.inbound_received_value) || 0);
    const inboundTotalPoValue = roundPrice3(parseFloat(po?.inbound_total_po_value) || 0);
    const hasInboundPriceDiff = Boolean(po?.has_inbound_price_diff);
    let status: "NO_PRICE" | "NOT_INCURRED" | "DEBT" | "PARTIAL_PAID" | "PREPAID" | "PAID_RECEIVED_PART" | "SETTLED";
    if (total <= 0.5) status = "NO_PRICE";
    else if (received <= 0.5 && paid <= 0.5) status = "NOT_INCURRED";
    else if (payable > 0.5) status = paid > 0.5 ? "PARTIAL_PAID" : "DEBT";
    else if (prepaid > 0.5) status = "PREPAID";
    else if (unreceived > 0.5) status = "PAID_RECEIVED_PART";
    else status = "SETTLED";
    return {
      total,
      paid,
      received,
      payable,
      prepaid,
      unreceived,
      inboundReceivedValue,
      inboundTotalPoValue,
      hasInboundPriceDiff,
      status,
      canPay: total > 0.5 && paid < total - 0.5,
    };
  };
  const DEBT_BADGE: Record<string, { label: string; cls: string }> = {
    NO_PRICE: { label: "Chưa có giá", cls: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200" },
    NOT_INCURRED: { label: "Chưa phát sinh nợ", cls: "bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200" },
    DEBT: { label: "Còn nợ", cls: "bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-400 border-rose-200" },
    PARTIAL_PAID: { label: "Nợ một phần", cls: "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-400 border-blue-200" },
    PREPAID: { label: "Trả trước NCC", cls: "bg-violet-50 dark:bg-violet-950 text-violet-700 dark:text-violet-300 border-violet-200" },
    PAID_RECEIVED_PART: { label: "Đã trả phần đã nhận", cls: "bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 border-teal-200" },
    SETTLED: { label: "✓ Đã tất toán", cls: "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border-emerald-200" },
  };

  // Quick Change PO Payment Status directly from row (Requirement 6 / 4d)
  const handleQuickChangePaymentStatus = async (po: any, newPayStatus: string) => {
    setActivePaymentDropdownId(null);
    // Khi người dùng bấm chọn "Đã thanh toán" hoặc "TT 1 phần" trên PO (kể cả PO chưa nhập kho):
    // Mở ngay Modal Ghi Sổ Chi Tiền / Chi Cọc thay vì báo lỗi chặn
    if (newPayStatus === "PAID" || newPayStatus === "PARTIAL_PAID") {
      openPaymentModal(po, newPayStatus === "PARTIAL_PAID" ? "deposit" : "full");
      return;
    }
    try {
      const res = await fetch("/api/procurement?action=update_payment_status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: po.id,
          po_code: po.po_code,
          payment_status: newPayStatus
        })
      });
      const data = await res.json();
      if (data.success) {
        setOrders(prev =>
          prev.map(o =>
            o.id === po.id
              ? {
                  ...o,
                  payment_status: data.payment_status || newPayStatus,
                  amount_paid: data.amount_paid !== undefined ? data.amount_paid : o.amount_paid
                }
              : o
          )
        );
      } else {
        alert(data.error || "Lỗi cập nhật trạng thái thanh toán");
      }
    } catch {
      alert("Lỗi kết nối khi cập nhật trạng thái thanh toán");
    }
  };

  // Receive to warehouse: always through the receipt form (lot, expiry, quantity actually received)
  const handleReceiveToWarehouse = (po: any) => openReceiveModal(po);

  // Quick Change PO Status directly from row
  const handleQuickChangeStatus = async (po: any, newStatus: string) => {
    setActiveStatusDropdownId(null);
    const targetUpper = String(newStatus || "").toUpperCase();
    if (!["DRAFT", "PENDING", "CANCELLED"].includes(targetUpper)) {
      const poItems: any[] = Array.isArray(po.items) ? po.items : [];
      const zeroPriceItems = poItems.filter((it: any) => !(roundPrice3(it?.unit_price) > 0));
      if (zeroPriceItems.length > 0) {
        const missingList = zeroPriceItems.map((it: any) => `• ${it?.product_code || "SP"} - ${cleanItemName(it?.product_name || "")}`).join("\n");
        alert(
          `Không thể xác nhận / chuyển trạng thái PO ${po.po_code} khi chưa nhập đủ đơn giá!\n\nCác mặt hàng đang chưa có giá (0 VNĐ):\n${missingList}\n\n👉 Vui lòng bấm Sửa PO để nhập đầy đủ đơn giá trước khi xác nhận.`
        );
        return;
      }
    }
    if (newStatus === "COMPLETED") {
      handleReceiveToWarehouse(po);
      return;
    }
    try {
      const res = await fetch("/api/procurement?action=update_order_status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: po.id,
          po_code: po.po_code,
          status: newStatus
        })
      });
      const data = await res.json();
      if (data.success) {
        setOrders(prev => prev.map(o => o.id === po.id ? { ...o, status: newStatus } : o));
      } else {
        alert(data.error || "Lỗi cập nhật trạng thái");
      }
    } catch (e) {
      alert("Lỗi cập nhật trạng thái");
    }
  };

  // Quick Save Delivery Date directly from row
  const handleSaveDeliveryDate = async (po: any) => {
    if (!tempDeliveryDate) {
      setEditingDeliveryDateId(null);
      return;
    }
    try {
      const res = await fetch("/api/procurement?action=update_delivery_date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: po.id,
          po_code: po.po_code,
          expected_delivery_date: tempDeliveryDate
        })
      });
      const data = await res.json();
      if (data.success) {
        setOrders(prev => prev.map(o => o.id === po.id ? { ...o, expected_delivery_date: tempDeliveryDate } : o));
        setEditingDeliveryDateId(null);
      } else {
        alert(data.error || "Lỗi cập nhật hạn giao hàng");
      }
    } catch (e) {
      alert("Lỗi cập nhật hạn giao hàng");
    }
  };

  // Dedicated Enterprise Print Solution (No Blank Page / 100% Guaranteed 1 Sheet)
  const handlePrintPO = (po: any) => {
    const statusCfg = PO_STATUS_CONFIG[po.status] || { label: po.status };
    const printWindow = window.open("", "_blank", "width=850,height=1100");
    if (!printWindow) {
      alert("Trình duyệt đang chặn cửa sổ in pop-up. Vui lòng cho phép mở pop-up để in đơn PO.");
      return;
    }

    const items = Array.isArray(po.items) ? po.items : [];
    const hasLineNotes = items.some((it: any) => String(it.notes || "").trim());
    const esc = (v: any) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));
    const printTotals = calcPOTotals(items);
    const totalAmount = parseFloat(po.total_amount) || printTotals.totalAfterVat || 0;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>ĐƠN ĐẶT MUA HÀNG - ${po.po_code}</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 12mm 15mm 12mm 15mm;
          }
          * {
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            color: #0f172a;
            margin: 0;
            padding: 10px;
            font-size: 13px;
            line-height: 1.5;
            background: #fff;
          }
          .header-table {
            width: 100%;
            border-bottom: 2px solid #ea580c;
            padding-bottom: 12px;
            margin-bottom: 18px;
          }
          .company-name {
            font-size: 16px;
            font-weight: 900;
            color: #ea580c;
            text-transform: uppercase;
            letter-spacing: -0.3px;
          }
          .company-info {
            font-size: 11px;
            color: #475569;
            margin-top: 2px;
          }
          .po-title {
            text-align: right;
            vertical-align: top;
          }
          .po-title h1 {
            font-size: 20px;
            font-weight: 900;
            margin: 0;
            color: #0f172a;
          }
          .po-code {
            font-size: 14px;
            font-weight: 900;
            color: #ea580c;
            margin-top: 4px;
            font-variant-numeric: tabular-nums;
          }
          .meta-box {
            display: table;
            width: 100%;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 12px 16px;
            margin-bottom: 18px;
          }
          .meta-col {
            display: table-cell;
            width: 50%;
            vertical-align: top;
          }
          .meta-title {
            font-weight: 800;
            color: #0f172a;
            font-size: 11px;
            text-transform: uppercase;
            margin-bottom: 4px;
          }
          .table-items {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 18px;
          }
          .table-items th {
            background: #f1f5f9;
            color: #334155;
            font-weight: 800;
            text-align: left;
            padding: 9px 8px;
            border: 1px solid #cbd5e1;
            font-size: 12px;
          }
          .table-items td {
            padding: 9px 8px;
            border: 1px solid #cbd5e1;
            font-size: 12px;
          }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .font-mono { font-variant-numeric: tabular-nums; }
          .font-bold { font-weight: 700; }
          .total-row {
            background: #f8fafc;
            font-weight: 900;
          }
          .notes-box {
            margin-bottom: 20px;
            padding: 10px 14px;
            background: #fff7ed;
            border-left: 3px solid #ea580c;
            font-size: 11px;
            color: #9a3412;
            border-radius: 4px;
          }
          .signatures {
            display: table;
            width: 100%;
            margin-top: 30px;
            page-break-inside: avoid;
          }
          .sig-box {
            display: table-cell;
            width: 33.33%;
            text-align: center;
            vertical-align: top;
          }
          .sig-title {
            font-weight: 800;
            color: #0f172a;
            font-size: 12px;
          }
          .sig-sub {
            font-size: 10px;
            color: #64748b;
            margin-top: 2px;
          }
          .sig-space {
            height: 60px;
          }
          .sig-name {
            font-weight: 700;
            color: #1e293b;
            font-size: 12px;
          }
          @media print {
            body { padding: 0; }
          }
        </style>
      </head>
      <body>
        <table class="header-table">
          <tr>
            <td style="vertical-align: top; width: 60%;">
              <div class="company-name">${companyConfig.companyName}</div>
              <div class="company-info">Địa chỉ: ${companyConfig.companyAddress || 'Chưa cập nhật'}</div>
              <div class="company-info">Điện thoại: ${companyConfig.companyPhone || '---'} • Email: ${companyConfig.companyEmail || '---'}</div>
              <div class="company-info">Mã số thuế: ${companyConfig.companyTaxCode || '---'}</div>
            </td>
            <td class="po-title">
              <h1>ĐƠN ĐẶT MUA HÀNG</h1>
              <div class="po-code">SỐ: ${po.po_code}</div>
              <div style="font-size: 11px; color: #64748b; margin-top: 3px;">Ngày lập: ${formatDate(po.order_date)}</div>
            </td>
          </tr>
        </table>

        <div class="meta-box">
          <div class="meta-col" style="padding-right: 15px;">
            <div class="meta-title">ĐƠN VỊ CUNG CẤP (SUPPLIER):</div>
            <div style="font-size: 13px; font-weight: 800; color: #0f172a;">${po.supplier_name}</div>
            <div style="color: #475569; margin-top: 4px; font-size: 12px;">Hạn giao hàng dự kiến: <strong>${formatDate(po.expected_delivery_date)}</strong></div>
            <div style="color: #475569; font-size: 12px;">Trạng thái đơn: <strong>${statusCfg.label}</strong></div>
          </div>
          <div class="meta-col">
            <div class="meta-title">ĐỊA ĐIỂM GIAO NHẬN (DELIVERY):</div>
            <div style="font-size: 13px; font-weight: 800; color: #0f172a;">Kho Trung Tâm</div>
            <div style="color: #475569; margin-top: 4px; font-size: 12px;">Bộ phận tiếp nhận: <strong>Phòng Cung Ứng & Quản Lý Kho</strong></div>
            <div style="color: #475569; font-size: 12px;">Điều khoản thanh toán: Chuyển khoản ngân hàng</div>
          </div>
        </div>

        <table class="table-items">
          <thead>
            <tr>
              <th class="text-center" style="width: 32px;">STT</th>
              <th style="width: 95px;">Mã Sản Phẩm</th>
              <th>Tên Hàng Hóa / Quy Cách Kỹ Thuật</th>
              <th class="text-center" style="width: 44px;">ĐVT</th>
              <th class="text-center" style="width: 42px;">SL</th>
              <th class="text-right" style="width: 95px;">Đơn Giá</th>
              <th class="text-right" style="width: 105px;">Thành Tiền</th>
              <th class="text-center" style="width: 48px;">%VAT</th>
              <th class="text-right" style="width: 90px;">Tiền VAT</th>
              <th class="text-right" style="width: 115px;">Thành Tiền Sau VAT</th>
              ${hasLineNotes ? '<th style="width: 110px;">Ghi Chú</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${items.map((it: any, i: number) => {
              const c = calcPOLine(it);
              return `
              <tr>
                <td class="text-center">${i + 1}</td>
                <td class="font-mono font-bold" style="color: #ea580c;">${it.product_code || ''}</td>
                <td style="font-weight: 500;">${esc(cleanItemName(it.product_name))}</td>
                <td class="text-center">${esc(it.unit || '')}</td>
                <td class="text-center font-bold">${c.qty || 1}</td>
                <td class="text-right font-mono">${Math.round(Number(c.price) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ</td>
                <td class="text-right font-mono font-bold">${Math.round(Number(c.subtotal) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ</td>
                <td class="text-center font-mono">${c.vatRate}%</td>
                <td class="text-right font-mono">${Math.round(Number(c.vatAmount) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ</td>
                <td class="text-right font-mono font-bold" style="color: #ea580c;">${Math.round(Number(c.totalAfterVat) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ</td>
                ${hasLineNotes ? `<td style="font-size: 11px;">${esc(it.notes || '')}</td>` : ''}
              </tr>
            `;
            }).join('')}
          </tbody>
          <tfoot>
            <tr class="total-row">
              <td colspan="9" class="text-right uppercase">TỔNG TIỀN HÀNG (CHƯA VAT):</td>
              <td class="text-right font-mono font-bold">
                ${Math.round(Number(printTotals.subtotal) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ
              </td>
              ${hasLineNotes ? '<td></td>' : ''}
            </tr>
            <tr class="total-row">
              <td colspan="9" class="text-right uppercase">TỔNG TIỀN THUẾ GTGT (VAT):</td>
              <td class="text-right font-mono font-bold">
                ${Math.round(Number(printTotals.vatAmount) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ
              </td>
              ${hasLineNotes ? '<td></td>' : ''}
            </tr>
            <tr class="total-row">
              <td colspan="9" class="text-right uppercase">TỔNG CỘNG THANH TOÁN (SAU VAT):</td>
              <td class="text-right font-mono font-bold" style="color: #ea580c; font-size: 13px;">
                ${Math.round(Number(totalAmount) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ
              </td>
              ${hasLineNotes ? '<td></td>' : ''}
            </tr>
          </tfoot>
        </table>

        ${po.notes ? `<div class="notes-box"><strong>Ghi chú:</strong> ${po.notes}</div>` : ''}

        <div class="signatures">
          <div class="sig-box">
            <div class="sig-title">Người Lập Đơn</div>
            <div class="sig-sub">(Ký & ghi rõ họ tên)</div>
            <div class="sig-space"></div>
            <div class="sig-name">${po.created_by || po.creator_name || user?.full_name || user?.name || "Chuyên viên Cung ứng"}</div>
          </div>
          <div class="sig-box">
            <div class="sig-title">Ban Giám Đốc Phê Duyệt</div>
            <div class="sig-sub">(Ký & phê duyệt)</div>
            <div class="sig-space"></div>
            <div class="sig-name">${po.approver_name || (companyConfig.companyRepresentative ? `${companyConfig.companyRepresentative}${companyConfig.companyRepresentativeRole ? ` (${companyConfig.companyRepresentativeRole})` : ''}` : "Ban Giám Đốc")}</div>
          </div>
          <div class="sig-box">
            <div class="sig-title">Đại Diện Nhà Cung Cấp</div>
            <div class="sig-sub">(Xác nhận đơn hàng)</div>
            <div class="sig-space"></div>
            <div class="sig-name">${po.supplier_name}</div>
          </div>
        </div>

        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 300);
          };
        </script>
      </body>
      </html>
    `;

    writeSafePrintDocument(printWindow, htmlContent);
  };

  const getPOCreator = (po: any) => {
    if (po?.created_by && po.created_by !== "Phòng Cung Ứng") return po.created_by;
    if (po?.creator_name) return po.creator_name;
    const items: any[] = Array.isArray(po?.items) ? po.items : [];
    const prCode = items.map((it) => itemSourcePR(it)).find(Boolean);
    if (prCode) {
      const matchedPr = purchaseRequests.find(
        (pr: any) => String(pr.workflow_code || "").trim().toUpperCase() === String(prCode).trim().toUpperCase()
      );
      if (
        matchedPr?.assignee_name &&
        matchedPr.assignee_name !== "Bộ Phận Thu Mua" &&
        matchedPr.assignee_name !== "Phòng Cung Ứng"
      ) {
        return matchedPr.assignee_name;
      }
      if (matchedPr?.requester_name) return matchedPr.requester_name;
    }
    return po?.created_by || user?.full_name || user?.name || "Chuyên viên Cung ứng";
  };

  /** Mã PR nguồn của một dòng PO (dòng gộp có thể đến từ nhiều PR), bấm để mở PR. */
  const renderItemPRChips = (it: any) => {
    const codes = Array.from(new Set(String(itemSourcePR(it) || "").split(/[,;]\s*/).map((x: string) => x.trim()).filter(Boolean)));
    if (codes.length === 0) return null;
    return codes.map((prc: string) => (
      <button
        key={prc}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          openPRByCode(prc);
        }}
        title={`PR nguồn của dòng này – bấm để mở ${prc}`}
        className="px-1 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-[9px] font-mono font-bold hover:bg-indigo-100 hover:underline cursor-pointer whitespace-nowrap"
      >
        {prc}
      </button>
    ));
  };

  const openPRByCode = (prCode: string) => {
    const clean = String(prCode || "").trim();
    if (!clean) return;
    const matched = purchaseRequests.find(
      (pr: any) => String(pr.workflow_code || "").trim().toUpperCase() === clean.toUpperCase()
    );
    if (matched) {
      setSelectedPODetail(null);
      setSelectedPRDetail(matched);
    } else {
      alert(`Không tìm thấy phiếu đề xuất ${clean} trong danh sách PR hiện tại.`);
    }
  };

  // Save PO (H7: single atomic server transaction)
  const handleSavePO = async () => {
    if (!poForm.supplier_name || !poForm.items || poForm.items.length === 0) {
      alert("Vui lòng chọn Nhà cung cấp và ít nhất 1 sản phẩm");
      return;
    }
    const missingCodeIdx = (poForm.items || []).findIndex((it: any) => !String(it?.product_code || "").trim());
    if (missingCodeIdx !== -1) {
      alert(`Dòng #${missingCodeIdx + 1} chưa chọn Mã hàng (SKU). Vui lòng chọn mã hàng cho tất cả các dòng.`);
      return;
    }
    const targetStatusUpper = String(poForm.status || "PENDING").toUpperCase();
    if (!["DRAFT", "PENDING", "CANCELLED"].includes(targetStatusUpper)) {
      const zeroPriceItems = (poForm.items || []).filter((it: any) => !(roundPrice3(it?.unit_price) > 0));
      if (zeroPriceItems.length > 0) {
        const missingList = zeroPriceItems.map((it: any) => it?.product_code || it?.product_name || "SP").join(", ");
        alert(
          `Không thể xác nhận / duyệt Đơn Đặt Hàng (PO) khi chưa có đủ đơn giá!\n\nCác mặt hàng chưa nhập Đơn giá PO (> 0 VNĐ): ${missingList}\n\n👉 Vui lòng nhập đầy đủ đơn giá, hoặc chuyển trạng thái về "1. Chờ xác nhận" để lưu tạm PO trước khi có giá.`
        );
        return;
      }
    }
    try {
      const res = await fetch("/api/procurement?action=order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify((() => {
          // Tiền đồng không có phần lẻ: làm tròn đơn giá và tự động tính Tiền VAT, Thành tiền sau VAT khi lưu
          const items = (poForm.items || []).map((it: any) => {
            const c = calcPOLine(it);
            return {
              ...it,
              unit_price: c.price,
              subtotal: c.subtotal,
              vat_rate: c.vatRate,
              vat_amount: c.vatAmount,
              total_after_vat: c.totalAfterVat,
              total: c.totalAfterVat
            };
          });
          return {
            ...poForm,
            items,
            total_amount: items.reduce((s2: number, it: any) => s2 + (Number(it.total_after_vat ?? it.total) || 0), 0),
            created_by: poForm.created_by || user?.full_name || user?.name || user?.username || "Chuyên viên Cung ứng"
          };
        })())
      });
      const data = await res.json();
      if (data.success) {
        setIsPOModalOpen(false);
        fetchData();
      } else if (res.status === 409) {
        alert(`${data.error || "Đơn PO vừa được người khác cập nhật."}

Danh sách sẽ được tải lại, vui lòng mở đơn và sửa lại.`);
        setIsPOModalOpen(false);
        fetchData();
      } else {
        alert(data.error || "Lỗi lưu đơn PO");
      }
    } catch (e) {
      alert("Lỗi kết nối khi lưu đơn PO");
    }
  };

  // Edit PO
  const handleEditPO = (po: any) => {
    let parsedItems: any[] = [];
    try {
      if (typeof po.items === "string") {
        parsedItems = JSON.parse(po.items);
      } else if (Array.isArray(po.items)) {
        parsedItems = po.items;
      }
    } catch {
      parsedItems = [];
    }

    const itemsFormatted = parsedItems.map((it: any) => {
      const qty = parseFloat(it.quantity) || 1;
      const price = parseFloat(it.unit_price) || 0;
      const c = calcPOLine({ ...it, quantity: qty, unit_price: price });
      return {
        ...it,
        source_pr_code: itemSourcePR(it) || undefined,
        product_code: it.product_code || "",
        product_name: cleanItemName(it.product_name),
        unit: it.unit || "Hộp",
        quantity: c.qty,
        unit_price: c.price,
        subtotal: c.subtotal,
        vat_rate: c.vatRate,
        vat_amount: c.vatAmount,
        total_after_vat: c.totalAfterVat,
        total: c.totalAfterVat
      };
    });
    const editTotals = calcPOTotals(itemsFormatted);

    setPOForm({
      id: po.id,
      po_code: po.po_code,
      supplier_id: po.supplier_id || 1,
      supplier_name: po.supplier_name || "",
      order_date: po.order_date ? dbDateVN(po.order_date) : todayVN(),
      expected_delivery_date: po.expected_delivery_date ? dbDateVN(po.expected_delivery_date) : toVNDateString(new Date(Date.now() + 10 * 86400000)),
      items: itemsFormatted.length > 0 ? itemsFormatted : [{ product_code: "", product_name: "", quantity: 1, unit_price: 0, subtotal: 0, vat_rate: 0, vat_amount: 0, total_after_vat: 0, total: 0 }],
      total_amount: editTotals.totalAfterVat || parseFloat(po.total_amount) || 0,
      status: po.status || "PENDING",
      notes: po.notes || "",
      version: po.version,
      received_qty: po.received_qty || {},
      inbound_price_map: po.inbound_price_map || {}
    });
    setPoSupplierNotice(null);
    setPoItemSearchQueries({});
    setIsPOModalOpen(true);
  };

  // ---- PO line editing (one row per line, totals + VAT always recomputed)
  const updatePOLine = (idx: number, patch: any) => {
    setPOForm((prev: any) => {
      const items = [...prev.items];
      const merged = { ...items[idx], ...patch };
      const c = calcPOLine(merged);
      items[idx] = {
        ...merged,
        subtotal: c.subtotal,
        vat_rate: c.vatRate,
        vat_amount: c.vatAmount,
        total_after_vat: c.totalAfterVat,
        total: c.totalAfterVat
      };
      return { ...prev, items, total_amount: items.reduce((a: number, b: any) => a + calcPOLine(b).totalAfterVat, 0) };
    });
  };

  // ---- change supplier: non-blocking inline notice (Bug 4a fix - never call window.alert on supplier switch)
  const handleChangePOSupplier = async (name: string) => {
    const sup = suppliers.find((s) => s.name === name);
    setPOForm((prev: any) => ({ ...prev, supplier_name: name, supplier_id: sup?.id || prev.supplier_id }));
    setPoSupplierNotice(null);
    if (!sup?.id) return;
    const current: any[] = (poForm.items || []).filter((it: any) => String(it?.product_code || "").trim() !== "");
    if (current.length === 0) return;
    try {
      const res = await fetch(`/api/procurement?action=supplier_products&supplier_id=${sup.id}`);
      const data = await res.json();
      const catalog: any[] = Array.isArray(data?.products) ? data.products : [];
      if (catalog.length === 0) return;
      const priceOf = new Map<string, number>(catalog.map((c: any) => [String(c.product_code), Number(c.purchase_price) || 0]));
      const changes = (poForm.items || [])
        .map((it: any, idx: number) => ({ idx, it, price: priceOf.get(String(it.product_code)) || 0 }))
        .filter((x: any) => x.it?.product_code && priceOf.has(String(x.it.product_code)) && x.price > 0 && x.price !== (Number(x.it.unit_price) || 0));
      const notSold = current.filter((it: any) => it.product_code && !priceOf.has(String(it.product_code)));
      if (changes.length === 0 && notSold.length === 0) return;
      setPoSupplierNotice({
        supplierName: name,
        changes,
        notSold,
        priceOf
      });
    } catch {}
  };

  const applyPOSupplierPriceChanges = () => {
    if (!poSupplierNotice) return;
    const { priceOf } = poSupplierNotice;
    setPOForm((prev: any) => {
      const items = prev.items.map((it: any) => {
        const pr = priceOf.get(String(it.product_code));
        if (pr === undefined || pr <= 0) return it;
        const c = calcPOLine({ ...it, unit_price: pr });
        return {
          ...it,
          unit_price: pr,
          subtotal: c.subtotal,
          vat_rate: c.vatRate,
          vat_amount: c.vatAmount,
          total_after_vat: c.totalAfterVat,
          total: c.totalAfterVat
        };
      });
      return { ...prev, items, total_amount: items.reduce((a: number, b: any) => a + calcPOLine(b).totalAfterVat, 0) };
    });
    setPoSupplierNotice(null);
  };

  // ---- Excel export (a PO, or the PO list as filtered on screen)
  const exportPOExcel = (po: any) => {
    const items: any[] = Array.isArray(po.items) ? po.items : [];
    const totals = calcPOTotals(items);
    const rows: any[][] = [
      ["ĐƠN ĐẶT MUA HÀNG", po.po_code],
      ["Nhà cung cấp", po.supplier_name || ""],
      ["Ngày lập", formatDate(po.order_date)],
      ["Hạn giao dự kiến", formatDate(po.expected_delivery_date)],
      ["Trạng thái", PO_STATUS_CONFIG[po.status]?.label || po.status],
      ["Ghi chú", po.notes || ""],
      [],
      ["STT", "Mã hàng", "Tên hàng / Quy cách", "ĐVT", "SL đặt", "Đã nhập kho", "Đơn giá", "Thành tiền (trước VAT)", "%VAT", "Tiền VAT", "Thành tiền sau VAT", "Mục đích", "Nguồn PR", "Ghi chú dòng"]
    ];
    items.forEach((it, i) => {
      const c = calcPOLine(it);
      rows.push([
        i + 1, it.product_code || "", cleanItemName(it.product_name), it.unit || "", c.qty, receivedOf(po, i), c.price, c.subtotal,
        `${c.vatRate}%`, c.vatAmount, c.totalAfterVat,
        it.is_stock === false ? (it.target_customer_name || "Khách hàng") : "Stock", itemSourcePR(it), it.notes || ""
      ]);
    });
    rows.push(
      [],
      ["", "", "", "", "", "", "", "", "", "Tổng tiền hàng (trước VAT)", totals.subtotal],
      ["", "", "", "", "", "", "", "", "", "Tổng tiền thuế VAT", totals.vatAmount],
      ["", "", "", "", "", "", "", "", "", "Tổng cộng (sau VAT)", parseFloat(po.total_amount) || totals.totalAfterVat]
    );
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 6 }, { wch: 14 }, { wch: 50 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 18 }, { wch: 8 }, { wch: 14 }, { wch: 18 }, { wch: 24 }, { wch: 18 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PO");
    XLSX.writeFile(wb, `${po.po_code || "PO"}.xlsx`);
  };
  const exportPOListExcel = (list: any[]) => {
    const rows: any[][] = [["Mã PO", "Nhà cung cấp", "Ngày lập", "Hạn giao", "Trạng thái", "Mã hàng", "Tên hàng", "ĐVT", "SL đặt", "Đã nhập", "Đơn giá", "Thành tiền (trước VAT)", "%VAT", "Tiền VAT", "Thành tiền sau VAT", "Nguồn PR", "Ghi chú dòng", "Ghi chú PO"]];
    list.forEach(po => {
      const items: any[] = Array.isArray(po.items) ? po.items : [];
      items.forEach((it, i) => {
        const c = calcPOLine(it);
        rows.push([po.po_code, po.supplier_name || "", formatDate(po.order_date), formatDate(po.expected_delivery_date), PO_STATUS_CONFIG[po.status]?.label || po.status,
          it.product_code || "", cleanItemName(it.product_name), it.unit || "", c.qty, receivedOf(po, i), c.price, c.subtotal, `${c.vatRate}%`, c.vatAmount, c.totalAfterVat, itemSourcePR(it), it.notes || "", po.notes || ""]);
      });
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 16 }, { wch: 30 }, { wch: 11 }, { wch: 11 }, { wch: 16 }, { wch: 14 }, { wch: 44 }, { wch: 7 }, { wch: 8 }, { wch: 8 }, { wch: 13 }, { wch: 16 }, { wch: 8 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 26 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Danh sách PO");
    XLSX.writeFile(wb, `Danh_sach_PO_${todayVN()}.xlsx`);
  };

  // ---- Xuất Excel danh sách PR (kèm từng mã hàng) theo phân loại: Chưa tạo PO / Đã chuyển thành PO / Tất cả
  const exportPRListExcel = (prList: any[], mode: "all" | "unconverted" | "converted" = "all") => {
    const header = [
      "STT",
      "Mã PR",
      "Tiêu đề đề xuất",
      "Bộ phận yêu cầu",
      "Người đề xuất",
      "Mức ưu tiên",
      "Hạn cần hàng",
      "Mã hàng (SKU)",
      "Tên mặt hàng",
      "Quy cách",
      "ĐVT",
      "SL đề xuất",
      "Đơn giá dự kiến / PO",
      "Thành tiền",
      "Nhà cung cấp gợi ý / PO",
      "Phân loại PO",
      "Mã PO liên kết",
      "Trạng thái PO",
      "Lý do / Ghi chú PR"
    ];
    const colsWidth = [
      { wch: 6 }, { wch: 15 }, { wch: 34 }, { wch: 16 }, { wch: 20 }, { wch: 13 }, { wch: 12 },
      { wch: 16 }, { wch: 42 }, { wch: 22 }, { wch: 9 }, { wch: 11 }, { wch: 16 }, { wch: 18 },
      { wch: 28 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 36 }
    ];

    const unconvertedRows: any[][] = [header];
    const convertedRows: any[][] = [header];
    const allRows: any[][] = [header];

    let sttUn = 0;
    let sttConv = 0;
    let sttAll = 0;

    prList.forEach((pr) => {
      const prSt = String(pr.status || "").toUpperCase();
      const isCancelled = prSt === "CANCELLED" || prSt === "REJECTED";
      const items = getPRItems(pr);
      const priorityLabel = pr.priority === "URGENT" ? "Khẩn cấp" : pr.priority === "HIGH" ? "Ưu tiên cao" : "Bình thường";
      const dueStr = formatDate(pr.due_date);

      items.forEach((it: any, idx: number) => {
        const itemPO = getItemPOInfo(pr, it, idx);
        const hasPO = Boolean(it.po_code || itemPO.hasPO);
        const poCode = it.po_code || itemPO.poCode || "";
        const linkedPO = itemPO.linkedPO;
        const resolved = resolveItemSupplierAndPrice(it);
        const qty = Number(it.quantity) || 1;
        const poItemPrice = linkedPO && Array.isArray(linkedPO.items)
          ? Number(linkedPO.items.find((x: any) => String(x?.product_code || "").toUpperCase() === String(it?.product_code || "").toUpperCase())?.unit_price) || 0
          : 0;
        const unitPrice = poItemPrice || resolved.unitPrice || Number(it.estimated_price) || 0;
        const lineTotal = roundPrice3(qty * unitPrice);
        const supplierLabel = linkedPO?.supplier_name || resolved.supplierName || "";
        const poStatusLabel = isCancelled
          ? "PR Đã hủy"
          : hasPO
          ? (linkedPO ? (PO_STATUS_CONFIG[linkedPO.status]?.label || linkedPO.status) : "Đã lên PO")
          : "Chưa tạo PO";
        const categoryLabel = isCancelled ? "PR Đã hủy" : hasPO ? "Đã chuyển thành PO" : "Chưa tạo PO";
        const codeDisplay = it.is_missing_catalog_product ? "" : (it.product_code || "");

        const rowData = (stt: number) => [
          stt,
          pr.workflow_code || "",
          pr.title || "",
          pr.requester_dept || "",
          pr.requester_name || "",
          priorityLabel,
          dueStr,
          codeDisplay,
          cleanItemName(it.product_name || ""),
          it.specification || resolved.specification || "",
          it.unit || resolved.unit || "Hộp",
          qty,
          unitPrice,
          lineTotal,
          supplierLabel,
          categoryLabel,
          poCode,
          poStatusLabel,
          pr.description || ""
        ];

        allRows.push(rowData(++sttAll));
        if (!isCancelled) {
          if (hasPO) {
            convertedRows.push(rowData(++sttConv));
          } else {
            unconvertedRows.push(rowData(++sttUn));
          }
        }
      });
    });

    const wb = XLSX.utils.book_new();
    if (mode === "unconverted") {
      const ws = XLSX.utils.aoa_to_sheet(unconvertedRows);
      ws["!cols"] = colsWidth;
      XLSX.utils.book_append_sheet(wb, ws, "PR Chưa tạo PO");
      XLSX.writeFile(wb, `PR_Chua_Tao_PO_${todayVN()}.xlsx`);
      return;
    }
    if (mode === "converted") {
      const ws = XLSX.utils.aoa_to_sheet(convertedRows);
      ws["!cols"] = colsWidth;
      XLSX.utils.book_append_sheet(wb, ws, "PR Đã chuyển PO");
      XLSX.writeFile(wb, `PR_Da_Chuyen_PO_${todayVN()}.xlsx`);
      return;
    }
    const wsUn = XLSX.utils.aoa_to_sheet(unconvertedRows);
    wsUn["!cols"] = colsWidth;
    const wsConv = XLSX.utils.aoa_to_sheet(convertedRows);
    wsConv["!cols"] = colsWidth;
    const wsAll = XLSX.utils.aoa_to_sheet(allRows);
    wsAll["!cols"] = colsWidth;
    XLSX.utils.book_append_sheet(wb, wsUn, "1. Chưa tạo PO");
    XLSX.utils.book_append_sheet(wb, wsConv, "2. Đã chuyển PO");
    XLSX.utils.book_append_sheet(wb, wsAll, "3. Tất cả dòng PR");
    XLSX.writeFile(wb, `Danh_sach_PR_Theo_Phan_Loai_${todayVN()}.xlsx`);
  };

  // ---- Xuất Excel PO Nháp / Danh sách PR từ cửa sổ "Gom PR Lên PO Tổng" mà KHÔNG tạo PO tổng trên hệ thống
  const handleExportConsolidateDraftExcel = () => {
    const pendingPRs = purchaseRequests.filter(isPRConsolidatable);
    const targetSupplier = suppliers.find((s) => String(s.id) === String(consolidateSupplierId)) || suppliers[0];

    const candidateRows: Array<{ pr: any; prKey: string; it: any; idx: number; itemKey: string; resolved: any; isAlreadyPo: boolean; poCode: string }> = [];
    pendingPRs.forEach((pr) => {
      const prKey = pr.workflow_code || String(pr.id);
      const items = getPRItems(pr);
      items.forEach((it: any, idx: number) => {
        if (it.is_missing_catalog_product || !it.product_code || it.product_code === "TBR-ITEM") return;
        const itemKey = `${prKey}___${idx}`;
        const resolved = resolveItemSupplierAndPrice(it);
        const itemPOInfo = getItemPOInfo(pr, it, idx);
        const isAlreadyPo = Boolean(it.po_code || itemPOInfo.hasPO);
        candidateRows.push({
          pr,
          prKey,
          it,
          idx,
          itemKey,
          resolved,
          isAlreadyPo,
          poCode: it.po_code || itemPOInfo.poCode || ""
        });
      });
    });

    const hasSelection = selectedItemKeysForConsolidate.length > 0;
    const activeRows = hasSelection
      ? candidateRows.filter((r) => selectedItemKeysForConsolidate.includes(r.itemKey))
      : candidateRows.filter((r) => !r.isAlreadyPo);

    if (activeRows.length === 0) {
      alert("Không có mặt hàng PR nào để xuất Excel.");
      return;
    }

    // Sheet 1: Chi tiết từng PR (KHÔNG gộp thành PO tổng - giữ nguyên từng dòng PR riêng biệt)
    const unmergedHeader = [
      "STT",
      "Mã PR Nguồn",
      "Mã Sản Xuất (SKU)",
      "Tên Sản Phẩm Đặt Mua",
      "Quy Cách",
      "ĐVT",
      "SL Cần",
      "Đơn Giá Dự Kiến (VNĐ)",
      "Thành Tiền Dự Kiến (VNĐ)",
      "Nhà Cung Cấp Phù Hợp",
      "Người Đề Xuất",
      "Bộ Phận",
      "Hạn Cần Hàng",
      "Trạng Thái PO",
      "Lý Do / Ghi Chú PR"
    ];
    const unmergedAoA: any[][] = [unmergedHeader];
    let totalUnmergedAmt = 0;
    let totalUnmergedQty = 0;

    activeRows.forEach((r, i) => {
      const qty = Number(r.it.quantity) || 1;
      const price = r.resolved.unitPrice || Number(r.it.estimated_price) || 0;
      const lineTotal = roundPrice3(qty * price);
      totalUnmergedQty += qty;
      totalUnmergedAmt += lineTotal;
      unmergedAoA.push([
        i + 1,
        r.pr.workflow_code || r.prKey,
        r.it.product_code || "",
        cleanItemName(r.it.product_name || ""),
        r.it.specification || r.resolved.specification || "",
        r.it.unit || r.resolved.unit || "Hộp",
        qty,
        price,
        lineTotal,
        r.resolved.supplierName || targetSupplier?.name || "",
        r.pr.requester_name || "",
        r.pr.requester_dept || "",
        formatDate(r.pr.due_date),
        r.isAlreadyPo ? `Đã tạo PO (${r.poCode})` : "Chưa tạo PO",
        r.pr.description || ""
      ]);
    });
    unmergedAoA.push(
      [],
      ["", "", "", "TỔNG CỘNG", "", "", totalUnmergedQty, "", totalUnmergedAmt, "", "", "", "", "", ""]
    );

    // Sheet 2: PO Nháp (Gộp theo mã hàng để tham khảo / gửi NCC duyệt nháp trước khi tạo PO thật)
    const groupedMap = new Map<string, { code: string; name: string; spec: string; unit: string; qty: number; price: number; prs: string[]; supplier: string }>();
    activeRows.forEach((r) => {
      const code = String(r.it.product_code || "").trim();
      const unit = String(r.it.unit || r.resolved.unit || "Hộp").trim();
      const spec = String(r.it.specification || r.resolved.specification || "").trim();
      const gk = `${code.toUpperCase()}|${unit.toLowerCase()}|${spec.toLowerCase()}`;
      const qty = Number(r.it.quantity) || 1;
      const price = r.resolved.unitPrice || Number(r.it.estimated_price) || 0;
      const existing = groupedMap.get(gk);
      if (existing) {
        existing.qty += qty;
        if (!existing.prs.includes(r.prKey)) existing.prs.push(r.prKey);
      } else {
        groupedMap.set(gk, {
          code,
          name: cleanItemName(r.it.product_name || ""),
          spec,
          unit,
          qty,
          price,
          prs: [r.prKey],
          supplier: r.resolved.supplierName || targetSupplier?.name || ""
        });
      }
    });

    const draftAoA: any[][] = [
      ["ĐƠN ĐẶT MUA HÀNG NHÁP (PO NHÁP - CHƯA LƯU HỆ THỐNG)", ""],
      ["Nhà cung cấp dự kiến", targetSupplier?.name || ""],
      ["Ngày xuất nháp", formatDate(todayVN())],
      ["Hạn giao mong muốn", formatDate(consolidateExpectedDelivery)],
      ["Ghi chú", consolidateNotes || `PO nháp kết xuất từ ${activeRows.length} dòng PR`],
      [],
      ["STT", "Mã Sản Xuất (SKU)", "Tên Sản Phẩm Đặt Mua", "Quy Cách", "ĐVT", "Tổng SL Cần", "Đơn Giá Dự Kiến", "Thành Tiền Dự Kiến", "NCC Gợi Ý", "Mã PR Nguồn"]
    ];
    let draftTotal = 0;
    Array.from(groupedMap.values()).forEach((g, idx) => {
      const sub = roundPrice3(g.qty * g.price);
      draftTotal += sub;
      draftAoA.push([idx + 1, g.code, g.name, g.spec, g.unit, g.qty, g.price, sub, g.supplier, g.prs.join(", ")]);
    });
    draftAoA.push([], ["", "", "", "", "", "", "TỔNG GIÁ TRỊ DỰ KIẾN", draftTotal, "", ""]);

    const wsUnmerged = XLSX.utils.aoa_to_sheet(unmergedAoA);
    wsUnmerged["!cols"] = [
      { wch: 6 }, { wch: 16 }, { wch: 18 }, { wch: 42 }, { wch: 22 }, { wch: 9 }, { wch: 10 },
      { wch: 16 }, { wch: 18 }, { wch: 28 }, { wch: 20 }, { wch: 15 }, { wch: 12 }, { wch: 16 }, { wch: 35 }
    ];
    const wsDraft = XLSX.utils.aoa_to_sheet(draftAoA);
    wsDraft["!cols"] = [
      { wch: 6 }, { wch: 18 }, { wch: 44 }, { wch: 22 }, { wch: 9 }, { wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 28 }, { wch: 26 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsUnmerged, "Chi tiết PR (Không gộp)");
    XLSX.utils.book_append_sheet(wb, wsDraft, "PO Nháp (Theo mã hàng)");
    const supSlug = String(targetSupplier?.short_name || targetSupplier?.supplier_code || "PR").replace(/[^a-zA-Z0-9_-]/g, "_");
    XLSX.writeFile(wb, `PO_Nhap_Va_Chi_Tiet_PR_${supSlug}_${todayVN()}.xlsx`);
  };

  // ---- Goods receipt of a PO: lot / expiry / MFG / storage / shelf / QC / received quantity per line, can be split into several lots
  const [receiveTarget, setReceiveTarget] = useState<any>(null);
  const [receiveLines, setReceiveLines] = useState<any[]>([]);
  const [receiveNotes, setReceiveNotes] = useState("");
  const [receiveSearchQuery, setReceiveSearchQuery] = useState("");
  const [hideUnselectedReceiveLines, setHideUnselectedReceiveLines] = useState(false);
  const [isReceiveModalFullscreen, setIsReceiveModalFullscreen] = useState(false);
  const [isPOModalFullscreen, setIsPOModalFullscreen] = useState(false);
  const [isPODetailFullscreen, setIsPODetailFullscreen] = useState(false);
  const [receiveHeader, setReceiveHeader] = useState({
    receipt_date: todayVN(),
    warehouse_name: "Kho Trung Tâm",
    received_by: "",
    vat_invoice_no: "",
    vat_invoice_date: todayVN(),
    shipping_unit: "",
    inbound_type: "Nhập mua hàng theo Đơn PO từ NCC"
  });
  const [isSubmittingReceive, setIsSubmittingReceive] = useState(false);
  const receiveRequestId = useRef<string>("");
  const [poReceipts, setPOReceipts] = useState<any[]>([]);

  const openEditInboundSlipFromPO = (inboundCode?: string) => {
    const code = String(inboundCode || "").trim();
    if (!code) return;
    setSelectedPODetail(null);
    if (typeof window !== "undefined") {
      sessionStorage.setItem("tbr_open_edit_inbound", code);
      window.dispatchEvent(
        new CustomEvent("tbr-navigate", {
          detail: { tab: "warehouse", subTab: "transactions", editInboundCode: code },
        })
      );
    }
  };

  const buildReceiveLinesFromPO = (po: any) => {
    const items: any[] = Array.isArray(po?.items) ? po.items : [];
    const rq = po?.received_qty || {};
    return items
      .map((it, idx) => {
        const ordered = Number(it.quantity) || 0;
        const received = Number(rq[idx]) || 0;
        const remaining = Math.max(0, ordered - received);
        const matchedProd = products.find((p: any) => p.code === it.product_code);
        return {
          line_index: idx,
          selected: true,
          default_quantity: remaining,
          product_code: it.product_code,
          product_name: cleanItemName(it.product_name),
          specification: it.specification || matchedProd?.specification || "",
          unit: it.unit || matchedProd?.unit || "Hộp",
          unit_price: roundPrice3(Number(it.unit_price) || Number(matchedProd?.cost_price) || 0),
          ordered,
          received,
          quantity: remaining,
          lot_number: "",
          manufacture_date: "",
          expiry_date: "",
          no_expiry: false,
          storage_condition: it.storage_condition || matchedProd?.storage_condition || "",
          shelf_position: it.shelf_position || matchedProd?.shelf_position || "",
          qc_status: "Đạt chuẩn 100% (Nguyên niêm phong & COA)",
          notes: ""
        };
      })
      .filter(l => l.ordered - l.received > 0);
  };

  const openReceiveModal = (po: any) => {
    const items: any[] = Array.isArray(po.items) ? po.items : [];
    const rq = po.received_qty || {};
    const lines: any[] = buildReceiveLinesFromPO(po);
    if (lines.length === 0) {
      const wantExtra = window.confirm(
        `PO ${po.po_code} đã nhập đủ số lượng theo đơn đặt.\n\nBạn có muốn mở phiếu Nhập kho để nhập bổ sung / phát sinh thêm hàng cho PO này không?`
      );
      if (!wantExtra) return;
      lines.push({
        line_index: -1,
        is_extra_line: true,
        selected: true,
        default_quantity: 1,
        product_code: items[0]?.product_code || "",
        product_name: cleanItemName(items[0]?.product_name || ""),
        specification: items[0]?.specification || "",
        unit: items[0]?.unit || "Cái",
        unit_price: roundPrice3(Number(items[0]?.unit_price) || 0),
        ordered: Number(items[0]?.quantity) || 0,
        received: Number(rq[0]) || 0,
        quantity: 1,
        lot_number: "",
        manufacture_date: "",
        expiry_date: "",
        no_expiry: false,
        storage_condition: items[0]?.storage_condition || "",
        shelf_position: items[0]?.shelf_position || "",
        qc_status: "Đạt chuẩn 100% (Nguyên niêm phong & COA)",
        notes: "Nhập phát sinh / bổ sung"
      });
    }
    receiveRequestId.current = `${po.po_code}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setReceiveHeader({
      receipt_date: todayVN(),
      warehouse_name: "Kho Trung Tâm",
      received_by: user?.full_name || user?.username || "Thủ kho TBR",
      vat_invoice_no: "",
      vat_invoice_date: todayVN(),
      shipping_unit: "",
      inbound_type: "Nhập mua hàng theo Đơn PO từ NCC"
    });
    setReceiveNotes("");
    setReceiveSearchQuery("");
    setHideUnselectedReceiveLines(false);
    setReceiveLines(lines);
    setReceiveTarget(po);
  };

  const submitReceive = async () => {
    if (!receiveTarget) return;
    if (!String(receiveHeader.receipt_date || "").trim()) { alert("Vui lòng nhập Ngày Nhập Kho (*)."); return; }
    if (!String(receiveHeader.warehouse_name || "").trim()) { alert("Vui lòng chọn Kho Tiếp Nhận (*)."); return; }
    if (!String(receiveHeader.received_by || "").trim()) { alert("Vui lòng nhập Thủ Kho / Người Tiếp Nhận (*)."); return; }
    const lines = receiveLines.filter(l => l.selected !== false && (Number(l.quantity) || 0) > 0);
    if (lines.length === 0) { alert("Vui lòng tích chọn và nhập số lượng thực nhận (> 0) cho ít nhất 1 mặt hàng về đợt này (*)."); return; }
    for (const l of lines) {
      if (!String(l.product_code || "").trim()) { alert("Vui lòng chọn hoặc nhập Mã hàng (*) cho dòng phát sinh."); return; }
      if (!String(l.lot_number || "").trim()) { alert(`${l.product_code}: bắt buộc phải nhập Số lô (LOT) / Serial (*).`); return; }
      if (!l.no_expiry && !String(l.expiry_date || "").trim()) { alert(`${l.product_code} (lô ${l.lot_number}): bắt buộc phải nhập Hạn dùng (EXP) (*), hoặc đánh dấu "Không có HSD".`); return; }
      if (!(roundPrice3(l.unit_price) > 0)) { alert(`${l.product_code} (lô ${l.lot_number}): bắt buộc phải nhập Đơn giá nhập (> 0 VNĐ) (*).`); return; }
      if (!String(l.storage_condition || "").trim()) { alert(`${l.product_code} (lô ${l.lot_number}): bắt buộc phải chọn Điều kiện bảo quản (*).`); return; }
    }
    const perLine: Record<number, number> = {};
    for (const l of lines) {
      if (Number(l.line_index) >= 0) {
        perLine[l.line_index] = (perLine[l.line_index] || 0) + (Number(l.quantity) || 0);
      }
    }
    let hasOverDelivery = lines.some(l => Number(l.line_index) < 0);
    const overMessages: string[] = [];
    for (const [idx, q] of Object.entries(perLine)) {
      const l = receiveLines.find(x => x.line_index === Number(idx));
      if (l && q > l.ordered - l.received) {
        hasOverDelivery = true;
        overMessages.push(`- ${l.product_code}: Đặt ${l.ordered}, đã nhập ${l.received}, lần này nhập ${q} (vượt ${q - Math.max(0, l.ordered - l.received)} ${l.unit || "đơn vị"})`);
      }
    }
    if (overMessages.length > 0) {
      const ok = window.confirm(
        `⚠️ Số lượng thực nhận vượt số lượng đặt trên PO:\n\n${overMessages.join("\n")}\n\nBạn có xác nhận vẫn nhập kho toàn bộ số lượng thực tế này không?`
      );
      if (!ok) return;
    }
    setIsSubmittingReceive(true);
    try {
      const res = await fetch("/api/procurement?action=receive_to_inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          po_id: receiveTarget.id,
          po_code: receiveTarget.po_code,
          request_id: receiveRequestId.current,
          allow_over_delivery: hasOverDelivery,
          receipt_date: receiveHeader.receipt_date,
          warehouse_name: receiveHeader.warehouse_name,
          received_by: receiveHeader.received_by,
          vat_invoice_no: receiveHeader.vat_invoice_no,
          vat_invoice_date: receiveHeader.vat_invoice_date || undefined,
          shipping_unit: receiveHeader.shipping_unit,
          inbound_type: receiveHeader.inbound_type,
          receipt_notes: receiveNotes,
          lines: lines.map(l => ({
            line_index: l.line_index,
            product_code: l.product_code,
            product_name: l.product_name,
            quantity: Number(l.quantity) || 0,
            specification: l.specification || "",
            unit: l.unit || "Hộp",
            unit_price: roundPrice3(l.unit_price),
            lot_number: String(l.lot_number).trim(),
            manufacture_date: l.manufacture_date || "",
            expiry_date: l.no_expiry ? "" : l.expiry_date,
            no_expiry: !!l.no_expiry,
            storage_condition: l.storage_condition || "",
            shelf_position: l.shelf_position || "",
            qc_status: l.qc_status || "Đạt chuẩn 100% (Nguyên niêm phong & COA)",
            notes: l.notes
          }))
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) { alert(data.error || "Lỗi khi nhập kho"); return; }
      try {
        window.dispatchEvent(new CustomEvent("inventory_updated", { detail: { po_code: receiveTarget.po_code } }));
      } catch (e) {}
      notifyActivity({
        title: "Hàng PO Đã Về Kho (Goods Receipt)",
        message: `PO ${receiveTarget.po_code} (${receiveTarget.supplier_name || ""}) — phiếu nhập ${data.inbound_code} tại ${receiveHeader.warehouse_name}${data.status === "COMPLETED" ? ", đã nhập đủ" : ", nhập 1 phần"}.`,
        category: "warehouse",
        type: "success",
        eventKey: "po_received",
        link: { tab: "warehouse", subTab: "stock" }
      });
      alert(`Nhập kho thành công: phiếu ${data.inbound_code}.\n${data.status === "COMPLETED" ? "PO đã nhập kho đủ." : "PO còn hàng chưa về (nhập kho 1 phần)."}`);
      setReceiveTarget(null);
      if (selectedPODetail?.po_code === receiveTarget.po_code) setSelectedPODetail(null);
      fetchData();
    } catch (e) {
      alert("Lỗi kết nối khi nhập kho");
    } finally {
      setIsSubmittingReceive(false);
    }
  };

  // receipts (PNK) of the PO being viewed
  useEffect(() => {
    if (!selectedPODetail?.po_code) { setPOReceipts([]); return; }
    let alive = true;
    fetch(`/api/procurement?action=po_receipts&po_code=${encodeURIComponent(selectedPODetail.po_code)}`)
      .then(r => r.json()).then(d => { if (alive) setPOReceipts(Array.isArray(d?.receipts) ? d.receipts : []); })
      .catch(() => { if (alive) setPOReceipts([]); });
    return () => { alive = false; };
  }, [selectedPODetail?.po_code]);

  // Esc closes the top-most PO window (the edit form asks first: unsaved changes would be lost)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (receiveTarget) { setReceiveTarget(null); return; }
      if (selectedPODetail) { setSelectedPODetail(null); return; }
      if (isPOModalOpen && confirm("Đóng đơn PO mà không lưu thay đổi?")) setIsPOModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [receiveTarget, selectedPODetail, isPOModalOpen]);

  // Delete PO
  const handleDeletePO = async (po: any) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa đơn PO ${po.po_code}?`)) return;
    try {
      const res = await fetch("/api/procurement?action=delete_order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: po.id, po_code: po.po_code })
      });
      const data = await res.json();
      if (data.success) {
        fetchData();
      } else {
        alert(data.error || "Lỗi khi xóa PO");
      }
    } catch (e) {
      alert("Lỗi khi xóa PO");
    }
  };

  // Save Supplier
  const handleSaveSupplier = async () => {
    if (!supplierForm.name) {
      alert("Vui lòng nhập Tên Nhà Cung Cấp");
      return;
    }
    try {
      const res = await fetch("/api/procurement?action=supplier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(supplierForm)
      });
      const data = await res.json();
      if (data.success) {
        setIsSupplierModalOpen(false);
        fetchData();
      } else {
        alert(data.error || "Lỗi lưu thông tin NCC");
      }
    } catch (e) {
      alert("Lỗi lưu thông tin NCC");
    }
  };

  // Delete Supplier
  const handleDeleteSupplier = async (sup: any) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa hồ sơ NCC ${sup.name}?`)) return;
    try {
      const res = await fetch("/api/procurement?action=delete_supplier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sup.id, name: sup.name })
      });
      const data = await res.json();
      if (data.success) {
        fetchData();
      } else {
        alert(data.error || "Lỗi xóa NCC");
      }
    } catch (e) {
      alert("Lỗi xóa NCC");
    }
  };

  // =========================================================
  // SUPPLIER PRODUCTS & PRICE ADJUSTMENT AUDIT HANDLERS
  // =========================================================

  const fetchSupplierProducts = async (supplierId: number) => {
    try {
      setLoadingSupplierProducts(true);
      const res = await fetch(`/api/procurement?action=supplier_products&supplier_id=${supplierId}`);
      const data = await res.json();
      if (data.success) {
        setSupplierProducts(data.products || []);
      }
    } catch (e) {
      console.error("Failed to load supplier products:", e);
    } finally {
      setLoadingSupplierProducts(false);
    }
  };

  const [isSyncingCatalogSuppliers, setIsSyncingCatalogSuppliers] = useState(false);

  const handleSyncSuppliersFromCatalog = async () => {
    try {
      setIsSyncingCatalogSuppliers(true);
      const res = await fetch("/api/procurement?action=sync_catalog_suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.success) {
        await fetchData();
        alert(
          `✅ Đã đồng bộ tự động từ Danh mục hàng hóa & Đơn PO!\n` +
          `• Nhà cung cấp / Hãng SX mới thêm: ${data.newSuppliersCreated || 0}\n` +
          `• Mặt hàng liên kết mới vào NCC: ${data.newProductsLinked || 0}\n` +
          `• Mặt hàng cập nhật giá mua: ${data.pricesUpdated || 0}`
        );
      } else {
        alert(data.error || "Không thể đồng bộ nhà cung cấp từ danh mục hàng hóa");
      }
    } catch (e: any) {
      alert("Lỗi khi đồng bộ nhà cung cấp: " + (e?.message || e));
    } finally {
      setIsSyncingCatalogSuppliers(false);
    }
  };

  const handleOpenSupplierCatalog = (supplier: any) => {
    setSelectedSupplierForCatalog(supplier);
    setIsSupplierCatalogOpen(true);
    setSupplierProductSearch("");
    fetchSupplierProducts(supplier.id);
  };

  const handleAutoCollectFromPOs = async () => {
    if (!selectedSupplierForCatalog) return;
    try {
      setIsAutoCollecting(true);
      const res = await fetch("/api/procurement?action=auto_collect_supplier_products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_id: selectedSupplierForCatalog.id,
          supplier_name: selectedSupplierForCatalog.name,
          actor_name: user?.full_name || user?.username || "Chuyên viên Cung ứng"
        })
      });
      const data = await res.json();
      if (data.success) {
        alert(`✅ Đã tự động thu thập thành công!\n• Mặt hàng mới thu thập: ${data.new_collected}\n• Mặt hàng cập nhật giá theo PO: ${data.price_updated}\n• Tổng số mặt hàng hiện có: ${data.total_items}`);
        fetchSupplierProducts(selectedSupplierForCatalog.id);
        fetchData();
      } else {
        alert(data.error || "Không thể thu thập dữ liệu tự động");
      }
    } catch (e: any) {
      alert("Lỗi khi gọi tự động thu thập: " + (e?.message || e));
    } finally {
      setIsAutoCollecting(false);
    }
  };

  const handleOpenAddProductModal = (prod?: any) => {
    if (prod) {
      setProductForm({
        id: prod.id,
        supplier_id: prod.supplier_id,
        product_code: prod.product_code,
        product_name: prod.product_name,
        specification: prod.specification || "",
        unit: prod.unit || "Cái",
        purchase_price: prod.purchase_price || 0,
        notes: prod.notes || ""
      });
    } else {
      const firstProd = products[0];
      setProductForm({
        id: null,
        supplier_id: selectedSupplierForCatalog?.id,
        product_code: firstProd?.code || "",
        product_name: firstProd?.name || "",
        specification: firstProd?.specification || "",
        unit: firstProd?.unit || "Cái",
        purchase_price: parseFloat(firstProd?.cost_price) || 0,
        notes: ""
      });
    }
    setIsAddEditProductModalOpen(true);
  };

  const handleSaveSupplierProduct = async () => {
    if (!productForm.product_code || !productForm.product_name) {
      alert("Vui lòng nhập đầy đủ Mã hàng và Tên mặt hàng");
      return;
    }
    try {
      const res = await fetch("/api/procurement?action=save_supplier_product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...productForm,
          supplier_id: selectedSupplierForCatalog?.id,
          actor_name: user?.full_name || user?.username || "Chuyên viên Cung ứng"
        })
      });
      const data = await res.json();
      if (data.success) {
        setIsAddEditProductModalOpen(false);
        if (selectedSupplierForCatalog) {
          fetchSupplierProducts(selectedSupplierForCatalog.id);
        }
        fetchData();
      } else {
        alert(data.error || "Lỗi lưu mã hàng");
      }
    } catch (e) {
      alert("Lỗi lưu mã hàng");
    }
  };

  const handleOpenAdjustPriceModal = (product: any) => {
    setAdjustPriceTarget(product);
    setNewPurchasePrice(product.purchase_price || 0);
    setPriceAdjustmentReason("");
    setPriceAdjustmentDate(todayVN());
    setSyncCostPrice(true);
    setIsAdjustPriceModalOpen(true);
  };

  const handleSavePriceAdjustment = async () => {
    const priceNum = parseFloat(String(newPurchasePrice)) || 0;
    if (priceNum <= 0) {
      alert("Vui lòng nhập đơn giá mua hợp lệ (> 0 VNĐ)");
      return;
    }
    if (!priceAdjustmentReason.trim()) {
      alert("Vui lòng nhập lý do điều chỉnh giá để lưu vào lịch sử kiểm toán");
      return;
    }
    try {
      setIsSavingPriceAdjustment(true);
      const res = await fetch("/api/procurement?action=adjust_supplier_price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: adjustPriceTarget.id,
          new_price: priceNum,
          effective_date: priceAdjustmentDate,
          reason: priceAdjustmentReason,
          sync_cost_price: syncCostPrice,
          actor_name: user?.full_name || user?.username || "Chuyên viên Cung ứng"
        })
      });
      const data = await res.json();
      if (data.success) {
        setIsAdjustPriceModalOpen(false);
        if (selectedSupplierForCatalog) {
          fetchSupplierProducts(selectedSupplierForCatalog.id);
        }
        fetchData();
      } else {
        alert(data.error || "Lỗi điều chỉnh giá");
      }
    } catch (e) {
      alert("Lỗi điều chỉnh giá");
    } finally {
      setIsSavingPriceAdjustment(false);
    }
  };

  const handleDeleteSupplierProduct = async (product: any) => {
    if (!confirm(`Xóa mã hàng [${product.product_code}] khỏi danh mục NCC ${selectedSupplierForCatalog?.name}?`)) return;
    try {
      const res = await fetch("/api/procurement?action=delete_supplier_product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: product.id,
          product_code: product.product_code,
          actor_name: user?.full_name || user?.username || "Chuyên viên Cung ứng"
        })
      });
      const data = await res.json();
      if (data.success) {
        if (selectedSupplierForCatalog) {
          fetchSupplierProducts(selectedSupplierForCatalog.id);
        }
        fetchData();
      } else {
        alert(data.error || "Lỗi khi xóa mặt hàng");
      }
    } catch (e) {
      alert("Lỗi khi xóa mặt hàng");
    }
  };

  const handleOpenPriceHistoryModal = (product: any) => {
    setPriceHistoryTarget(product);
    setIsPriceHistoryModalOpen(true);
  };

  const handleDownloadCatalogTemplate = () => {
    const sample = [
      {
        "Mã hàng (*)": "TBR-KIT-001",
        "Tên sản phẩm (*)": "Bộ Kít Tách Chiết RNA/DNA Viral",
        "Quy cách": "50 test/hộp",
        "Đơn vị tính": "Hộp",
        "Giá mua (*)": 1500000,
        "Ghi chú": "Bảng giá áp dụng quý 4/2026"
      },
      {
        "Mã hàng (*)": "TBR-PCR-002",
        "Tên sản phẩm (*)": "MasterMix Real-time PCR 2X",
        "Quy cách": "100 phản ứng/lọ",
        "Đơn vị tính": "Lọ",
        "Giá mua (*)": 850000,
        "Ghi chú": "Đơn hàng tối thiểu 5 lọ"
      }
    ];
    const ws = XLSX.utils.json_to_sheet(sample);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Bang_Gia_NCC");
    XLSX.writeFile(wb, `Bang_Gia_NCC_${selectedSupplierForCatalog?.supplier_code || "Sample"}.xlsx`);
  };

  const handleUploadCatalogExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedSupplierForCatalog) return;
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const wsName = wb.SheetNames[0];
      const ws = wb.Sheets[wsName];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);
      if (!rows || rows.length === 0) {
        alert("File Excel không có dữ liệu!");
        return;
      }
      const res = await fetch("/api/procurement?action=import_supplier_products_excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_id: selectedSupplierForCatalog.id,
          items: rows,
          actor_name: user?.full_name || user?.username || "Chuyên viên Cung ứng"
        })
      });
      const data = await res.json();
      if (data.success) {
        alert(`✅ Đã nạp thành công ${data.count} mã hàng vào danh mục NCC ${selectedSupplierForCatalog.name}!`);
        fetchSupplierProducts(selectedSupplierForCatalog.id);
        fetchData();
      } else {
        alert(data.error || "Lỗi khi nạp file Excel");
      }
    } catch (err: any) {
      alert("Lỗi khi đọc file Excel: " + (err?.message || err));
    } finally {
      if (e.target) e.target.value = "";
    }
  };

  // Record Payment
  const handleRecordPayment = async () => {
    const isMulti = Array.isArray(paymentForm.allocations);
    const amount = isMulti
      ? paymentForm.allocations.reduce((s: number, a: any) => s + (Number(a.amount) || 0), 0)
      : Number(paymentForm.payment_amount) || 0;
    if (amount <= 0) {
      alert("Số tiền thanh toán phải lớn hơn 0");
      return;
    }
    if (!isMulti && amount > (Number(paymentForm.remaining_balance) || 0) + 0.5) {
      alert("Số tiền thanh toán vượt công nợ còn lại của PO");
      return;
    }
    if (isSubmittingPayment) return;
    setIsSubmittingPayment(true);
    try {
      const res = await fetch(`/api/procurement?action=${isMulti ? "record_payment_multi" : "record_payment"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isMulti
          ? { ...paymentForm, allocations: paymentForm.allocations.map((a: any) => ({ po_id: a.po_id, amount: Number(a.amount) || 0 })) }
          : paymentForm)
      });
      const data = await res.json();
      if (data.success) {
        alert(data.duplicate ? "Khoản thanh toán này đã được ghi nhận trước đó (không ghi trùng)." : (data.voucher_code ? `Đã ghi nhận phiếu chi ${data.voucher_code}!` : "Ghi nhận thanh toán thành công!"));
        setIsPaymentModalOpen(false);
        setSelectedPayPOs([]);
        fetchData();
        fetchPoPayments();
      } else {
        alert(data.error || "Lỗi ghi nhận thanh toán");
      }
    } catch (e) {
      alert("Lỗi kết nối khi ghi nhận thanh toán. Bấm lại để gửi lại cùng khoản (không bị ghi trùng).");
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  // Save PR with Structured Multi-Item Support
  const handleSavePR = async () => {
    if (!prForm.title?.trim()) {
      alert("⚠️ Lỗi tạo PR: Vui lòng nhập Tiêu đề đề xuất mua hàng!");
      return;
    }
    if (!prForm.items || prForm.items.length === 0) {
      alert("⚠️ Lỗi tạo PR: Vui lòng bổ sung ít nhất 1 mặt hàng cụ thể cần mua!");
      return;
    }

    const validatedItems = [];
    for (let i = 0; i < prForm.items.length; i++) {
      const it = prForm.items[i];
      const rawCode = String(it.product_code || "").trim();
      const rawName = String(it.product_name || "").trim();

      if (!rawCode || rawCode.toUpperCase() === "TBR-ITEM" || rawCode.toUpperCase() === "MÃ MỚI") {
        alert(
          `⚠️ Không thể tạo PR (Lỗi ở dòng mặt hàng #${i + 1}): Chưa có Mã sản phẩm / Mã sản xuất cụ thể!\n\nVui lòng chọn đúng sản phẩm từ Bảng mã sản xuất (hoặc nhập Mã hàng cụ thể) trước khi lưu đề xuất mua hàng.`
        );
        return;
      }
      if (!rawName) {
        alert(
          `⚠️ Không thể tạo PR (Lỗi ở dòng mặt hàng #${i + 1}): Chưa có Tên sản phẩm cụ thể!\n\nVui lòng chọn sản phẩm từ Bảng mã sản xuất trước khi lưu đề xuất mua hàng.`
        );
        return;
      }
      if (!it.unit?.trim()) {
        alert(`⚠️ Lỗi ở dòng mặt hàng #${i + 1}: Vui lòng nhập Đơn vị tính (ĐVT)!`);
        return;
      }
      if (!it.quantity || Number(it.quantity) <= 0) {
        alert(`⚠️ Lỗi ở dòng mặt hàng #${i + 1}: Số lượng cần mua phải lớn hơn 0!`);
        return;
      }

      const catalogMatch = mergedCatalogProducts.find(
        (p: any) => String(p.code || "").trim().toUpperCase() === rawCode.toUpperCase()
      );
      if (!it.is_custom && !catalogMatch) {
        alert(
          `⚠️ Không thể tạo PR (Lỗi ở dòng mặt hàng #${i + 1}): Mã sản phẩm "${rawCode}" không tồn tại trong Bảng mã sản xuất!\n\nVui lòng chọn đúng sản phẩm có trong Bảng mã sản xuất.`
        );
        return;
      }

      validatedItems.push({
        ...it,
        product_code: catalogMatch ? catalogMatch.code : rawCode,
        product_name: catalogMatch ? catalogMatch.name : rawName,
        specification: it.specification || catalogMatch?.specification || "",
        unit: it.unit || catalogMatch?.unit || "Hộp",
        quantity: Number(it.quantity) || 1
      });
    }

    try {
      const res = await fetch("/api/procurement?action=create_pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...prForm, items: validatedItems })
      });
      const data = await res.json();
      if (data.success) {
        notifyActivity({
          title: prForm.id ? "Cập Nhật Đề Xuất Mua Hàng (PR)" : "Đề Xuất Mua Hàng Mới (PR)",
          message: `${prForm.requester_name || "Nhân viên"} đã ${prForm.id ? "cập nhật" : "lập"} đề xuất mua hàng: ${data.code || prForm.title}`,
          category: "procurement",
          type: "info",
          eventKey: prForm.id ? "pr_updated" : "pr_created",
          link: { tab: "procurement", subTab: "pr" }
        });
        alert(prForm.id ? `Cập nhật thành công Đề xuất mua hàng ${data.code}!` : `Khởi tạo thành công Đề xuất mua hàng ${data.code}!`);
        setIsPRModalOpen(false);
        fetchData();
      } else {
        alert(data.error || "Lỗi tạo đề xuất PR");
      }
    } catch (e) {
      alert("Lỗi kết nối khi gửi đề xuất PR");
    }
  };

  // Helper to extract items from a PR & match strictly against Manufacturer Catalog (mergedCatalogProducts)
  const getPRItems = (pr: any) => {
    let prItems: any[] = [];
    try {
      if (typeof pr.results_summary === "string" && pr.results_summary.trim().startsWith("[")) {
        prItems = JSON.parse(pr.results_summary);
      } else if (Array.isArray(pr.results_summary)) {
        prItems = pr.results_summary;
      }
    } catch (e) {}

    // Fallback: Parse from product_info text if results_summary is empty
    if (prItems.length === 0 && pr.product_info) {
      const parts = String(pr.product_info).split(" | ");
      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        // Format 1: "CODE: Name (Spec) - SL: 1 Hộp"
        const m = trimmed.match(/^([^:]+):\s*(.*?)(?:\s*\((.*?)\))?(?:\s*-\s*SL:\s*(\d+)\s*(.*?))?$/);
        if (m) {
          prItems.push({
            product_code: m[1].trim(),
            product_name: m[2].trim(),
            specification: m[3] ? m[3].trim() : "",
            quantity: m[4] ? parseInt(m[4]) : 1,
            unit: m[5] ? m[5].trim() : "Hộp",
            estimated_price: pr.estimated_price || 0
          });
          continue;
        }
        // Format 2: "Name (CODE)" from SearchableProductSelect
        const parenMatch = trimmed.match(/^(.*?)\s*\(([A-Za-z0-9._-]+)\)$/);
        if (parenMatch) {
          prItems.push({
            product_code: parenMatch[2].trim(),
            product_name: parenMatch[1].trim(),
            specification: "",
            quantity: 1,
            unit: "Hộp",
            estimated_price: pr.estimated_price || 0
          });
        }
      }
    }

    // Match & normalize every item against Bảng mã sản xuất (mergedCatalogProducts)
    const normalizedItems: any[] = [];
    for (const rawIt of prItems) {
      const rawCode = String(rawIt?.product_code || "").trim();
      const rawName = cleanItemName(String(rawIt?.product_name || "").trim());
      const isFakeCode = !rawCode || rawCode.toUpperCase() === "TBR-ITEM" || rawCode.toUpperCase() === "MÃ MỚI";

      // Mã hàng trên PR là chuẩn: khớp ĐÚNG mã trước. Chỉ dòng chưa có mã thật mới tra theo tên, và chỉ khi tên đó
      // thuộc đúng một mã. (Trước đây "trùng mã HOẶC trùng tên" lấy mã đầu tiên cùng tên trong danh mục: BIO-41026 thành
      // BIO-41025 vì hai mã cùng tên "Polyme tự nhiên Agarose" — PO lập từ đó đặt nhầm mã.)
      let catalogMatch: any = !isFakeCode
        ? mergedCatalogProducts.find((p: any) => String(p.code || "").trim().toUpperCase() === rawCode.toUpperCase())
        : undefined;
      if (!catalogMatch && isFakeCode && rawName) {
        const sameName = mergedCatalogProducts.filter((p: any) => String(p.name || "").trim().toLowerCase() === rawName.toLowerCase());
        if (sameName.length === 1) {
          catalogMatch = sameName[0];
        } else if (sameName.length > 1) {
          // tên thuộc nhiều mã: không tự chọn, để người dùng xác định mã
          normalizedItems.push({
            ...rawIt,
            product_code: "",
            product_name: rawName,
            is_missing_catalog_product: true,
            ambiguous_codes: sameName.map((p: any) => p.code),
            raw_request_text: `${rawName} (trùng tên ${sameName.length} mã: ${sameName.map((p: any) => p.code).join(", ")} — cần chọn đúng mã)`,
          });
          continue;
        }
      }

      if (catalogMatch) {
        normalizedItems.push({
          ...rawIt,
          product_code: catalogMatch.code,
          product_name: catalogMatch.name,
          specification: rawIt.specification || catalogMatch.specification || "",
          unit: rawIt.unit || catalogMatch.unit || "Hộp",
          quantity: Number(rawIt.quantity) || 1,
          estimated_price: Number(rawIt.estimated_price) || parseFloat(catalogMatch.cost_price) || 0,
          is_missing_catalog_product: false
        });
      } else if (!isFakeCode && rawName && rawName.toLowerCase() !== String(pr.title || "").trim().toLowerCase()) {
        normalizedItems.push({
          ...rawIt,
          product_code: rawCode,
          product_name: rawName,
          specification: rawIt.specification || "",
          unit: rawIt.unit || "Hộp",
          quantity: Number(rawIt.quantity) || 1,
          estimated_price: Number(rawIt.estimated_price) || 0,
          is_missing_catalog_product: false
        });
      }
    }

    // Fallback check if product_info matches a catalog product directly
    if (normalizedItems.length === 0 && pr.product_info) {
      const infoStr = String(pr.product_info).trim();
      // mã hàng trước; tên chỉ dùng khi đúng một sản phẩm mang tên đó
      const byInfoCode = mergedCatalogProducts.find(
        (p: any) => p.code && infoStr.toUpperCase().includes(String(p.code).trim().toUpperCase())
      );
      const byInfoName = byInfoCode ? [] : mergedCatalogProducts.filter(
        (p: any) => p.name && infoStr.toLowerCase().includes(String(p.name).trim().toLowerCase())
      );
      const matchedProd = byInfoCode || (byInfoName.length === 1 ? byInfoName[0] : undefined);
      if (matchedProd) {
        normalizedItems.push({
          product_code: matchedProd.code,
          product_name: matchedProd.name,
          specification: matchedProd.specification || "",
          unit: matchedProd.unit || "Hộp",
          quantity: 1,
          estimated_price: parseFloat(matchedProd.cost_price) || 0,
          is_missing_catalog_product: false
        });
      }
    }

    // If PR still has no valid product code & name (e.g. legacy workflow where user only typed request title),
    // flag it explicitly instead of fabricating "TBR-ITEM" + pr.title
    if (normalizedItems.length === 0) {
      return [
        {
          is_missing_catalog_product: true,
          product_code: "",
          product_name: "",
          raw_request_text: pr.product_info || pr.title || "Chưa chọn sản phẩm",
          specification: "",
          unit: "Hộp",
          quantity: 1,
          estimated_price: 0
        }
      ];
    }

    return normalizedItems;
  };

  // Helper to determine PO status of an individual PR item
  const getItemPOInfo = (pr: any, it: any, idx?: number) => {
    // 1. Direct po_code on item (saved from convert or consolidate)
    if (it && it.po_code) {
      const linkedPO = orders.find(o => o.po_code === it.po_code);
      return {
        hasPO: true,
        poCode: it.po_code,
        linkedPO: linkedPO || null
      };
    }

    // 2. Cross-match with orders by PR code and product code / name
    const prCode = pr?.workflow_code || String(pr?.id || "");
    const itCode = it?.product_code || "";
    const itName = it?.product_name || "";

    const matchedPO = orders.find(o => {
      const notesMatch = o.notes && (
        o.notes.includes(prCode) || 
        (pr?.title && o.notes.includes(pr.title))
      );
      if (!notesMatch) return false;
      const poItems = Array.isArray(o.items) ? o.items : [];
      const itSpec = String(it?.specification || "").trim();
      return poItems.some((poIt: any) => {
        const codeMatch = Boolean(itCode && poIt.product_code === itCode);
        const nameMatch = Boolean(itName && poIt.product_name && (poIt.product_name.includes(itName) || itName.includes(poIt.product_name)));
        if (!codeMatch && !nameMatch) return false;
        if (itSpec && poIt.specification) {
          return String(poIt.specification).trim() === itSpec;
        }
        if (itSpec && poIt.product_name && poIt.product_name.includes("(")) {
          return poIt.product_name.includes(itSpec);
        }
        return true;
      });
    });

    if (matchedPO) {
      return {
        hasPO: true,
        poCode: matchedPO.po_code,
        linkedPO: matchedPO
      };
    }

    // 3. Fallback: If whole PR was converted/completed and has a single linked PO
    const statusUpper = String(pr?.status || "").toUpperCase();
    if (statusUpper === "COMPLETED" || statusUpper === "CONVERTED") {
      const directPO = orders.find(o => 
        (o.notes && o.notes.includes(prCode)) ||
        (o.po_code && pr?.description?.includes(o.po_code))
      );
      if (directPO) {
        return {
          hasPO: true,
          poCode: directPO.po_code,
          linkedPO: directPO
        };
      }
    }

    return {
      hasPO: false,
      poCode: null,
      linkedPO: null
    };
  };

  /** Một PR thuộc đúng 1 nhóm: closed (từ chối / huỷ) • completed • partial • pending. */
  const getPRBucket = (pr: any): "pending" | "partial" | "completed" | "closed" => {
    const st = String(pr?.status || "").toUpperCase();
    if (st === "REJECTED" || st === "CANCELLED") return "closed";
    const summary = getPRPOSummary(pr);
    if (summary.isFullyConverted) return "completed";
    if (summary.isPartiallyConverted) return "partial";
    return "pending";
  };

  // Helper to get aggregated PR PO Status Summary
  const getPRPOSummary = (pr: any) => {
    if (!pr) return { totalItems: 0, convertedCount: 0, pendingCount: 0, isFullyConverted: false, isPartiallyConverted: false, isPending: true, poCodes: [], linkedPOs: [] };

    const items = getPRItems(pr);
    const totalItems = items.length;
    let convertedCount = 0;
    const poCodesSet = new Set<string>();
    const linkedPOs: any[] = [];

    items.forEach((it: any, idx: number) => {
      const info = getItemPOInfo(pr, it, idx);
      if (info.hasPO && info.poCode) {
        convertedCount++;
        poCodesSet.add(info.poCode);
        if (info.linkedPO && !linkedPOs.some(p => p.id === info.linkedPO.id)) {
          linkedPOs.push(info.linkedPO);
        }
      }
    });

    // Check PR status tags
    const statusUpper = String(pr.status || "").toUpperCase();
    let isFullyConverted = (totalItems > 0 && convertedCount === totalItems) || statusUpper === "COMPLETED" || statusUpper === "CONVERTED";
    let isPartiallyConverted = (!isFullyConverted && convertedCount > 0) || statusUpper === "PARTIAL_CONVERTED";
    
    // In case status is CONVERTED/COMPLETED but items didn't match directly
    if (isFullyConverted && convertedCount === 0) {
      convertedCount = totalItems;
      const directPO = orders.find(o => o.notes && o.notes.includes(pr.workflow_code));
      if (directPO) {
        poCodesSet.add(directPO.po_code);
        if (!linkedPOs.some(p => p.id === directPO.id)) linkedPOs.push(directPO);
      }
    }

    const pendingCount = isFullyConverted ? 0 : Math.max(0, totalItems - convertedCount);
    const isPending = !isFullyConverted && !isPartiallyConverted;

    return {
      totalItems,
      convertedCount: isFullyConverted ? totalItems : convertedCount,
      pendingCount: isFullyConverted ? 0 : pendingCount,
      isFullyConverted,
      isPartiallyConverted: !isFullyConverted && isPartiallyConverted,
      isPending,
      poCodes: Array.from(poCodesSet),
      linkedPOs
    };
  };

  // Smart Supplier & Unit Price Resolver (Requirement 3: Bug 4f & Issue 2)
  const resolveItemSupplierAndPrice = (item: any) => {
    const rawCode = String(item?.product_code || item?.code || "").trim();
    const codeUpper = rawCode.toUpperCase();
    const matchedProd = mergedCatalogProducts.find((p: any) => String(p.code || "").trim().toUpperCase() === codeUpper) ||
                        products.find((p: any) => String(p.code || "").trim().toUpperCase() === codeUpper);
    const spMatch = allSupplierProducts.find((sp: any) => String(sp.product_code || "").trim().toUpperCase() === codeUpper);

    const pName = normSearch(item?.product_name || item?.name || matchedProd?.name || "");
    const pCode = normSearch(rawCode);
    const brandHint = normSearch(
      `${item?.supplier_name || ""} ${item?.manufacturer || ""} ${item?.brand || ""} ${matchedProd?.supplier_name || ""} ${matchedProd?.manufacturer || ""} ${matchedProd?.brand || ""} ${spMatch?.supplier_name || ""} ${spMatch?.supplier_short_name || ""}`
    );

    let matchedSup: any = null;

    // 1. Direct supplier_id match from supplier_products or item/product
    const directSupId = spMatch?.supplier_id || item?.supplier_id || matchedProd?.supplier_id;
    if (directSupId) {
      matchedSup = suppliers.find((s: any) => Number(s.id) === Number(directSupId));
    }

    // 2. Match by supplier_name / brand / short_name against suppliers list
    if (!matchedSup && brandHint) {
      matchedSup = suppliers.find((s: any) => {
        const sName = normSearch(s.name);
        const sShort = normSearch(s.short_name);
        return (sName && (brandHint.includes(sName) || sName.includes(brandHint))) ||
               (sShort && sShort.length >= 2 && brandHint.includes(sShort));
      });
    }

    // 3. Pattern matching by SKU prefix & product name keywords for medical/biotech brands
    if (!matchedSup) {
      const combined = `${pCode} ${pName} ${brandHint}`;
      const matchSupplierByKeyword = (keywords: string[]) =>
        suppliers.find((s: any) => {
          const hay = normSearch(`${s.name || ""} ${s.short_name || ""} ${s.supplier_code || ""} ${s.product_lines || ""}`);
          return keywords.some(kw => hay.includes(kw));
        });

      if (combined.includes("abt") || combined.includes("toppure") || combined.includes("topspec") || pCode.startsWith("dd-") || pCode.startsWith("hi-") || pCode.startsWith("eh-") || pCode.startsWith("ab-") || pCode.startsWith("vk-")) {
        matchedSup = matchSupplierByKeyword(["abt", " viet nam", "toppure"]);
      } else if (combined.includes("ssi") || pCode.startsWith("1110") || pCode.startsWith("84") || combined.includes("antisera") || combined.includes("salmonella")) {
        matchedSup = matchSupplierByKeyword(["ssi", "diagnostica"]);
      } else if (combined.includes("liferiver") || pCode.startsWith("hd-") || pCode.startsWith("od-") || pCode.startsWith("rd-") || pCode.startsWith("td-") || pCode.startsWith("zd-")) {
        matchedSup = matchSupplierByKeyword(["liferiver", "shanghai zj"]);
      } else if (combined.includes("meridian") || combined.includes("illumi") || combined.includes("premier") || combined.includes("immuno")) {
        matchedSup = matchSupplierByKeyword(["meridian"]);
      } else if (combined.includes("rollmed") || pCode.startsWith("rm-")) {
        matchedSup = matchSupplierByKeyword(["rollmed"]);
      } else if (combined.includes("himedia") || pCode.startsWith("m0") || pCode.startsWith("mu") || pCode.startsWith("tm")) {
        matchedSup = matchSupplierByKeyword(["himedia"]);
      } else if (combined.includes("biolabs") || combined.includes("neb") || pCode.startsWith("neb-")) {
        matchedSup = matchSupplierByKeyword(["biolabs", "neb", "new england"]);
      } else if (combined.includes("corning") || combined.includes("falcon") || combined.includes("axygen") || combined.includes("costar")) {
        matchedSup = matchSupplierByKeyword(["corning"]);
      } else if (combined.includes("biofil") || combined.includes("jet ")) {
        matchedSup = matchSupplierByKeyword(["biofil", "jet"]);
      } else if (combined.includes("biologix")) {
        matchedSup = matchSupplierByKeyword(["biologix"]);
      } else if (combined.includes("daan") || combined.includes("mgi")) {
        matchedSup = matchSupplierByKeyword(["daan", "mgi"]);
      } else if (combined.includes("bioer") || combined.includes("linegene") || combined.includes("genepure")) {
        matchedSup = matchSupplierByKeyword(["bioer"]);
      }
    }

    // 4. Fallback: check product_lines of suppliers
    if (!matchedSup) {
      matchedSup = suppliers.find((s: any) => {
        const sLines = normSearch(s.product_lines);
        return sLines && ((pCode && sLines.includes(pCode)) || (matchedProd?.category && sLines.includes(normSearch(matchedProd.category))));
      }) || suppliers[0] || null;
    }

    const unitPrice = roundPrice3(
      parseFloat(spMatch?.purchase_price) ||
      parseFloat(item?.cost_price) ||
      parseFloat(matchedProd?.cost_price) ||
      parseFloat(item?.estimated_price) ||
      parseFloat(item?.unit_price) ||
      parseFloat(matchedProd?.standard_price) ||
      0
    );

    const displayManufacturer =
      matchedSup?.short_name ||
      matchedSup?.name ||
      item?.manufacturer ||
      matchedProd?.manufacturer ||
      matchedProd?.brand ||
      "Chưa xác định";

    return {
      supplier: matchedSup,
      supplierId: matchedSup?.id || 1,
      supplierName: matchedSup?.name || displayManufacturer,
      shortName: matchedSup?.short_name || displayManufacturer,
      unitPrice,
      unit: item?.unit || matchedProd?.unit || spMatch?.unit || "Hộp",
      specification: item?.specification || matchedProd?.specification || spMatch?.specification || ""
    };
  };

  // Requirement 5 (Issue 6): Determine if a PR has unconverted items and can be consolidated into a PO
  const isPRConsolidatable = (pr: any): boolean => {
    const st = String(pr?.status || "").toUpperCase();
    if (["COMPLETED", "ORDERED", "CANCELLED", "REJECTED", "CONVERTED"].includes(st)) return false;
    if (pr?.poCode || pr?.po_code) return false;
    const summary = getPRPOSummary(pr);
    return !summary.isFullyConverted;
  };

  // Convert PR to PO (1-Click - Only selects unconverted items if partial)
  const handleConvertPRToPO = (pr: any) => {
    const prItems = getPRItems(pr);
    const hasMissingCatalogItem = prItems.some(
      (it: any) => it.is_missing_catalog_product || !it.product_code || it.product_code === "TBR-ITEM" || !it.product_name
    );
    if (hasMissingCatalogItem) {
      alert(
        `⚠️ Không thể lập PO: Đề xuất ${pr.workflow_code} ("${pr.title}") hiện chưa có Mã sản phẩm và Tên sản phẩm cụ thể từ Bảng mã sản xuất!\n\nHệ thống sẽ mở cửa sổ Cập nhật PR để bạn chọn đúng sản phẩm cần mua trước khi lập đơn PO.`
      );
      handleEditPR(pr);
      return;
    }

    const unconvertedWithIdx = prItems
      .map((it: any, idx: number) => ({ it, idx }))
      .filter(({ it, idx }) => !getItemPOInfo(pr, it, idx).hasPO);

    const targetItems = unconvertedWithIdx.length > 0 
      ? unconvertedWithIdx 
      : prItems.map((it: any, idx: number) => ({ it, idx }));

    let poItems: any[] = [];
    const forCustomer = isCustomerPR(pr);
    const prCustomer = forCustomer ? salesCustomers.find((c: any) => String(c.name || "").trim().toLowerCase() === String(pr.customer_name || "").trim().toLowerCase()) : null;
    const prOrderCode = soCodeIn(pr.title) || soCodeIn(pr.description);
    targetItems.forEach(({ it }) => {
      const resolved = resolveItemSupplierAndPrice(it);
      const price = roundPrice3(resolved.unitPrice > 0 ? resolved.unitPrice : Number(it.estimated_price || it.unit_price || it.price || 0));
      const qty = Number(it.quantity) || 1;
      const nameWithSpec = it.specification && !it.product_name?.includes(it.specification) 
        ? `${it.product_name} (${it.specification})` 
        : (it.product_name || it.product_code);
      poItems.push({
        product_code: it.product_code,
        product_name: nameWithSpec,
        specification: it.specification || "",
        notes: it.notes || "",
        source_pr_code: pr.workflow_code || undefined,
        is_stock: !forCustomer,
        target_customer_name: forCustomer ? pr.customer_name : undefined,
        target_customer_id: prCustomer?.id,
        order_code: forCustomer && prOrderCode ? prOrderCode : undefined,
        unit: it.unit || resolved.unit || "Hộp",
        quantity: qty,
        unit_price: price,
        total: roundPrice3(qty * price)
      });
    });

    const totalAmt = poItems.reduce((sum, it) => sum + (it.total || 0), 0);
    
    // Intelligent Supplier matching using resolveItemSupplierAndPrice
    let matchedSupplier: any = null;
    if (targetItems.length > 0) {
      matchedSupplier = resolveItemSupplierAndPrice(targetItems[0].it).supplier;
    }
    if (!matchedSupplier) {
      const searchTarget = normSearch(`${pr.description || ''} ${pr.title || ''}`);
      matchedSupplier = suppliers.find(s =>
        (s.name && searchTarget.includes(normSearch(s.name))) ||
        (s.short_name && searchTarget.includes(normSearch(s.short_name))) ||
        (s.supplier_code && searchTarget.includes(normSearch(s.supplier_code)))
      ) || suppliers[0];
    }

    const convertedIndices = targetItems.map(x => x.idx);
    const isPartialConversion = convertedIndices.length < prItems.length;

    setPoSupplierNotice(null);
    setPoItemSearchQueries({});
    setPOForm({
      id: null,
      po_code: "",
      supplier_id: matchedSupplier?.id || 1,
      supplier_name: matchedSupplier?.name || suppliers[0]?.name || "",
      order_date: todayVN(),
      expected_delivery_date: pr.due_date && dbDateVN(pr.due_date) >= todayVN() ? dbDateVN(pr.due_date) : toVNDateString(new Date(Date.now() + 10 * 86400000)),
      items: poItems,
      total_amount: totalAmt,
      status: "PENDING",
      linked_pr_id: pr.id,
      linked_pr_code: pr.workflow_code,
      converted_item_indices: convertedIndices,
      is_partial_conversion: isPartialConversion,
      notes: isPartialConversion
        ? `Lập đơn mua cho ${poItems.length}/${prItems.length} mặt hàng còn lại theo Đề xuất ${pr.workflow_code}: ${pr.title}`
        : `Lập đơn mua theo Đề xuất ${pr.workflow_code}: ${pr.title} (Yêu cầu bởi: ${pr.requester_name} - ${pr.requester_dept})`
    });

    setIsPOModalOpen(true);
  };

  // Helper to detect supplier match for an item
  const getItemSuggestedSupplier = (item: any) => {
    return resolveItemSupplierAndPrice(item).supplier;
  };

  // 1-Click Auto Select All Matching Items for Target Supplier
  const handleAutoSelectBySupplier = (supplierId: string | number) => {
    const targetSup = suppliers.find((s) => String(s.id) === String(supplierId)) || suppliers[0];
    if (!targetSup) return;
    const pendingPRs = purchaseRequests.filter(isPRConsolidatable);

    const matchingKeys: string[] = [];
    const prsToExpand: string[] = [];

    pendingPRs.forEach((pr) => {
      const prKey = pr.workflow_code || String(pr.id);
      const items = getPRItems(pr);
      let hasMatchInPR = false;

      items.forEach((it, idx) => {
        if (it?.po_code || it?.is_missing_catalog_product || !it?.product_code) return;
        const itemSup = getItemSuggestedSupplier(it);
        if (itemSup && String(itemSup.id) === String(targetSup.id)) {
          matchingKeys.push(`${prKey}___${idx}`);
          hasMatchInPR = true;
        }
      });

      if (hasMatchInPR) {
        prsToExpand.push(prKey);
      }
    });

    setSelectedItemKeysForConsolidate(matchingKeys);
    setExpandedPRKeys((prev) => Array.from(new Set([...prev, ...prsToExpand])));
  };

  // Toggle selection for a full PR (all its child items)
  const togglePRSelection = (pr: any) => {
    const prKey = pr.workflow_code || String(pr.id);
    const items = getPRItems(pr);
    const itemKeys = items
      .map((it, idx) => ({ it, key: `${prKey}___${idx}` }))
      .filter(x => !x.it?.po_code && !x.it?.is_missing_catalog_product && Boolean(x.it?.product_code))
      .map(x => x.key);
    if (itemKeys.length === 0) return;
    const allSelected = itemKeys.length > 0 && itemKeys.every((k) => selectedItemKeysForConsolidate.includes(k));

    if (allSelected) {
      setSelectedItemKeysForConsolidate((prev) => prev.filter((k) => !itemKeys.includes(k)));
    } else {
      setSelectedItemKeysForConsolidate((prev) => Array.from(new Set([...prev, ...itemKeys])));
    }
  };

  // Toggle selection for an individual line item
  const toggleItemSelection = (itemKey: string) => {
    setSelectedItemKeysForConsolidate((prev) =>
      prev.includes(itemKey) ? prev.filter((k) => k !== itemKey) : [...prev, itemKey]
    );
  };

  // Toggle accordion expansion for PR
  const togglePRExpansion = (prKey: string) => {
    setExpandedPRKeys((prev) =>
      prev.includes(prKey) ? prev.filter((k) => k !== prKey) : [...prev, prKey]
    );
  };

  // Consolidate Multiple PRs into a Unified PO (Requirement 4 & Requirement 5)
  const handleConsolidatePRsSubmit = async () => {
    if (selectedItemKeysForConsolidate.length === 0) {
      alert("Vui lòng chọn ít nhất 1 mặt hàng cần gom vào Đơn PO!");
      return;
    }
    const targetSupplier = suppliers.find((s) => String(s.id) === String(consolidateSupplierId)) || suppliers[0];
    if (!targetSupplier) {
      alert("Vui lòng chọn Nhà cung cấp!");
      return;
    }

    setIsSubmittingConsolidate(true);
    try {
      const pendingPRs = purchaseRequests.filter(isPRConsolidatable);
      let combinedItems: any[] = [];
      const involvedPRKeys = new Set<string>();

      pendingPRs.forEach((pr) => {
        const prKey = pr.workflow_code || String(pr.id);
        const items = getPRItems(pr);

        items.forEach((it, idx) => {
          const itemKey = `${prKey}___${idx}`;
          if (selectedItemKeysForConsolidate.includes(itemKey)) {
            if (it.is_missing_catalog_product || !it.product_code || it.product_code === "TBR-ITEM") {
              return;
            }
            involvedPRKeys.add(prKey);
            const resolved = resolveItemSupplierAndPrice(it);
            const price = roundPrice3(resolved.unitPrice > 0 ? resolved.unitPrice : (Number(it.estimated_price) || 0));
            const forCustomer = isCustomerPR(pr);
            const prOrderCode = soCodeIn(pr.title) || soCodeIn(pr.description);
            const qty = it.quantity || 1;
            const nameWithSpec = it.specification ? `${it.product_name} (${it.specification})` : it.product_name;
            combinedItems.push({
              product_code: it.product_code,
              product_name: nameWithSpec,
              specification: it.specification || "",
              notes: it.notes || "",
              source_pr_code: pr.workflow_code || undefined,
              is_stock: !forCustomer,
              target_customer_name: forCustomer ? pr.customer_name : undefined,
              order_code: forCustomer && prOrderCode ? prOrderCode : undefined,
              unit: it.unit || resolved.unit || "Cái",
              quantity: qty,
              unit_price: price,
              total: roundPrice3(qty * price)
            });
          }
        });
      });

      const res = await fetch("/api/procurement?action=consolidate_prs_to_po", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_id: targetSupplier.id,
          supplier_name: targetSupplier.name,
          pr_ids: Array.from(involvedPRKeys),
          selected_item_keys: selectedItemKeysForConsolidate,
          items: combinedItems,
          expected_delivery_date: consolidateExpectedDelivery,
          notes:
            consolidateNotes ||
            `Đơn PO tổng hợp gom ${combinedItems.length} mặt hàng từ các PR: ${Array.from(involvedPRKeys).join(", ")}`,
          created_by: user?.full_name || user?.name || user?.username || "Chuyên viên Cung ứng"
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        alert(
          `Đã gom thành công ${combinedItems.length} mặt hàng (từ ${involvedPRKeys.size} đề xuất PR) vào Đơn PO tổng ${data.po_code}!`
        );
        setIsConsolidateModalOpen(false);
        setSelectedItemKeysForConsolidate([]);
        setExpandedPRKeys([]);
        fetchData();
        setSubTab("orders");
      } else {
        alert("Lỗi khi gom PR: " + (data.error || "Không rõ nguyên nhân"));
      }
    } catch (err: any) {
      alert("Lỗi: " + err.message);
    } finally {
      setIsSubmittingConsolidate(false);
    }
  };

  // Restock to PO (1-Click with Smart Supplier & Unit Price Resolver - Requirement 3)
  const handleRestockToPO = (item: any) => {
    const resolved = resolveItemSupplierAndPrice(item);
    const qtyNeeded = Math.max(5, (Number(item.min_stock_level) || 5) * 2 - (Number(item.quantity_on_hand) || 0));
    const price = resolved.unitPrice;

    setPoSupplierNotice(null);
    setPoItemSearchQueries({});
    setPOForm({
      id: null,
      po_code: "",
      supplier_id: resolved.supplierId,
      supplier_name: resolved.supplierName,
      order_date: todayVN(),
      expected_delivery_date: toVNDateString(new Date(Date.now() + 10 * 86400000)),
      items: [
        {
          product_code: item.product_code,
          product_name: item.product_name,
          unit: resolved.unit,
          quantity: qtyNeeded,
          unit_price: price,
          total: qtyNeeded * price,
          is_stock: true,
          notes: `Bổ sung tồn kho thiếu (Tồn: ${item.quantity_on_hand}, Min: ${item.min_stock_level})`
        }
      ],
      total_amount: qtyNeeded * price,
      status: "PENDING",
      notes: `Lập đơn đặt hàng bổ sung tồn kho thiếu hụt cho NCC ${resolved.supplierName} (Tồn hiện tại: ${item.quantity_on_hand}, Ngưỡng tối thiểu: ${item.min_stock_level})`
    });

    setIsPOModalOpen(true);
  };

  // Bulk Restock to PO for all filtered items of a Supplier
  const handleBulkRestockBySupplier = (itemsList: any[]) => {
    if (!itemsList || itemsList.length === 0) return;
    const firstResolved = resolveItemSupplierAndPrice(itemsList[0]);
    const poItems = itemsList.map((it: any) => {
      const res = resolveItemSupplierAndPrice(it);
      const qtyNeeded = Math.max(5, (Number(it.min_stock_level) || 5) * 2 - (Number(it.quantity_on_hand) || 0));
      const price = res.unitPrice;
      return {
        product_code: it.product_code,
        product_name: it.product_name,
        unit: res.unit,
        quantity: qtyNeeded,
        unit_price: price,
        total: qtyNeeded * price,
        is_stock: true,
        notes: `Tồn: ${it.quantity_on_hand}/${it.min_stock_level}`
      };
    });
    const totalAmt = poItems.reduce((s: number, x: any) => s + (x.total || 0), 0);
    setPoSupplierNotice(null);
    setPoItemSearchQueries({});
    setPOForm({
      id: null,
      po_code: "",
      supplier_id: firstResolved.supplierId,
      supplier_name: firstResolved.supplierName,
      order_date: todayVN(),
      expected_delivery_date: toVNDateString(new Date(Date.now() + 10 * 86400000)),
      items: poItems,
      total_amount: totalAmt,
      status: "PENDING",
      notes: `Lập đơn PO mua bổ sung tổng hợp ${poItems.length} mã hàng chạm ngưỡng Min từ NCC ${firstResolved.supplierName}`
    });
    setIsPOModalOpen(true);
  };

  // Open Payment Modal (hỗ trợ cả Chi tiền hàng đã nhập kho & Chi cọc / Thanh toán trước cho PO chưa nhập kho)
  const openPaymentModal = (order: any, mode?: "full" | "deposit") => {
    const dbt = poDebt(order);
    const total = dbt.total || parseFloat(order.total_amount) || 0;
    const paid = dbt.paid || parseFloat(order.amount_paid) || 0;
    if (total <= 0) {
      alert(`Đơn PO ${order.po_code} hiện chưa có đơn giá (Tổng tiền = 0 VNĐ). Vui lòng nhập đơn giá trên PO trước khi ghi nhận chi cọc / thanh toán.`);
      handleEditPO(order);
      return;
    }
    const remaining = Math.max(0, total - paid);
    const isPrepay = dbt.received <= 0.5 || mode === "deposit";

    setPaymentForm({
      request_id: `PAY-${order.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      po_id: order.id,
      po_code: order.po_code,
      supplier_name: order.supplier_name,
      total_amount: total,
      amount_paid: paid,
      received_amount: dbt.received,
      remaining_balance: remaining,
      payment_amount: remaining,
      payment_method: paymentMethods[0] || "Chuyển khoản",
      reference_doc: "",
      payment_date: todayVN(),
      payment_notes: isPrepay
        ? `Đặt cọc / Thanh toán trước PO ${order.po_code}`
        : `Thanh toán tiền hàng PO ${order.po_code}`,
      allocations: null
    });
    setIsPaymentModalOpen(true);
  };

  // Một phiếu chi cho nhiều PO của cùng NCC
  const openMultiPaymentModal = (pos: any[]) => {
    if (pos.length === 0) return;
    const supplierSet = new Set(pos.map(po => String(po.supplier_name || "").trim().toLowerCase()));
    if (supplierSet.size > 1) {
      alert("Chỉ chọn các PO của cùng một nhà cung cấp để chi chung một phiếu.");
      return;
    }
    const allocations = pos.map(po => {
      const remaining = Math.max(0, (parseFloat(po.total_amount) || 0) - (parseFloat(po.amount_paid) || 0));
      return { po_id: po.id, po_code: po.po_code, remaining, amount: remaining };
    });
    setPaymentForm({
      request_id: `MULTI-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      po_id: null,
      po_code: pos.map(po => po.po_code).join(", "),
      supplier_name: pos[0].supplier_name,
      total_amount: pos.reduce((s, po) => s + (parseFloat(po.total_amount) || 0), 0),
      amount_paid: pos.reduce((s, po) => s + (parseFloat(po.amount_paid) || 0), 0),
      remaining_balance: allocations.reduce((s, a) => s + a.remaining, 0),
      payment_amount: allocations.reduce((s, a) => s + a.amount, 0),
      payment_method: paymentMethods[0] || "Chuyển khoản",
      reference_doc: "",
      payment_date: todayVN(),
      payment_notes: `Thanh toán tiền hàng ${allocations.length} PO`,
      allocations
    });
    setIsPaymentModalOpen(true);
  };

  const fetchPoPayments = async () => {
    try {
      const r = await fetch("/api/procurement?action=po_payments");
      const d = await r.json();
      if (Array.isArray(d.payments)) setPoPayments(d.payments);
    } catch { /* bỏ qua: chỉ ảnh hưởng phần lịch sử */ }
  };

  const handleVoidPayment = async (pay: any, reopenForEdit: boolean) => {
    const reason = window.prompt(reopenForEdit ? "Lý do sửa khoản chi (khoản cũ sẽ được hủy, nhập lại khoản đúng):" : "Lý do hủy khoản chi:", "");
    if (!reason || !reason.trim()) return;
    try {
      const res = await fetch("/api/procurement?action=void_payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_id: pay.id, reason: reason.trim() })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.success) { alert(d.error || "Không hủy được khoản chi"); return; }
      await fetchData();
      await fetchPoPayments();
      setPaymentHistoryPO(null);
      if (reopenForEdit) {
        const po = orders.find(o => o.id === pay.po_id);
        if (po) {
          const paidAfter = Math.max(0, (parseFloat(po.amount_paid) || 0) - (Number(pay.amount) || 0));
          openPaymentModal({ ...po, amount_paid: paidAfter });
          setPaymentForm((prev: any) => ({
            ...prev,
            payment_amount: Number(pay.amount) || prev.payment_amount,
            payment_method: pay.method || prev.payment_method,
            reference_doc: pay.reference_doc || "",
            payment_date: pay.payment_date ? String(pay.payment_date).slice(0, 10) : prev.payment_date,
            payment_notes: pay.notes || prev.payment_notes
          }));
        }
      }
    } catch {
      alert("Lỗi kết nối khi hủy khoản chi");
    }
  };

  // Filtered Orders (Requirement 4 - Issue 1: Deep accent-insensitive search across PO, Supplier, Brand, Manufacturer, and Line Items)
  const poSupplierInvoices = (po: any): any[] => {
    let v: any = po?.supplier_invoices;
    if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = []; } }
    return Array.isArray(v) ? v : [];
  };

  const filteredOrders = useMemo(() => {
    const q = normSearch(orderSearch);
    return orders.filter(po => {
      let matchSearch = true;
      if (q) {
        const supp = suppliers.find((s: any) => s.id === po.supplier_id || s.name === po.supplier_name);
        let poItems: any[] = po.items;
        if (typeof poItems === "string") {
          try { poItems = JSON.parse(poItems); } catch { poItems = []; }
        }
        const itemsText = Array.isArray(poItems)
          ? poItems
              .map((it: any) => {
                const mp = mergedCatalogProducts.find((p: any) => String(p.code || "").toUpperCase() === String(it.product_code || "").toUpperCase());
                return `${it.product_code || ""} ${it.product_name || ""} ${it.specification || ""} ${it.notes || ""} ${mp?.brand || ""} ${mp?.manufacturer || ""} ${mp?.supplier_name || ""} ${mp?.parent_code || ""}`;
              })
              .join(" ")
          : "";
        const hay = normSearch(
          `${po.po_code || ""} ${po.supplier_name || ""} ${po.notes || ""} ${supp?.name || ""} ${supp?.short_name || ""} ${supp?.supplier_code || ""} ${supp?.address || ""} ${supp?.product_lines || ""} ${itemsText}`
        );
        matchSearch = hay.includes(q);
      }

      const d = po.order_date ? String(po.order_date).slice(0, 10) : "";
      if (orderFrom && (!d || d < orderFrom)) return false;
      if (orderTo && (!d || d > orderTo)) return false;
      const invKw = normSearch(orderInvoiceSearch);
      if (invKw && !poSupplierInvoices(po).some((iv: any) => normSearch(iv.invoice_no).includes(invKw))) return false;
      const prodKw = normSearch(orderProductSearch);
      if (prodKw && !(Array.isArray(po.items) && po.items.some((it: any) => normSearch(`${it.product_code || ""} ${it.product_name || ""}`).includes(prodKw)))) return false;
      
      let matchStatus = true;
      if (orderStatusFilter === "all") {
        matchStatus = true;
      } else if (orderStatusFilter === "CUSTOMS") {
        matchStatus = PO_CUSTOMS_STATUSES.includes(po.status);
      } else if (orderStatusFilter === "open") {
        matchStatus = !PO_CLOSED_STATUSES.includes(po.status);
      } else {
        matchStatus = po.status === orderStatusFilter;
      }

      return matchSearch && matchStatus;
    });
  }, [orders, suppliers, mergedCatalogProducts, orderSearch, orderStatusFilter, orderFrom, orderTo, orderInvoiceSearch, orderProductSearch]);

  // PR status filter counts: one bucket per PR, the buckets add up to "Tất cả"
  const prCounts = useMemo(() => {
    let pending = 0;
    let partial = 0;
    let completed = 0;
    let closed = 0;

    purchaseRequests.forEach(pr => {
      const bucket = getPRBucket(pr);
      if (bucket === "closed") closed++;
      else if (bucket === "completed") completed++;
      else if (bucket === "partial") partial++;
      else pending++;
    });

    return {
      all: purchaseRequests.length,
      pending,
      partial,
      completed,
      closed
    };
  }, [purchaseRequests, orders]);

  // PO counts per status filter, computed from the same list that is displayed
  const poCounts = useMemo(() => {
    const c: Record<string, number> = { all: orders.length, open: 0 };
    orders.forEach(po => {
      const key = PO_CUSTOMS_STATUSES.includes(po.status) ? "CUSTOMS" : String(po.status || "PENDING");
      c[key] = (c[key] || 0) + 1;
      if (!PO_CLOSED_STATUSES.includes(po.status)) c.open++;
    });
    return c;
  }, [orders]);

  // Enriched Restock Alerts with resolved Supplier & Unit Price (Requirement 3)
  const enrichedRestockAlerts = useMemo(() => {
    return restockAlerts.map((item: any) => {
      const resolved = resolveItemSupplierAndPrice(item);
      return {
        ...item,
        resolved_supplier_id: resolved.supplierId,
        resolved_supplier_name: resolved.supplierName,
        resolved_short_name: resolved.shortName,
        resolved_unit_price: resolved.unitPrice,
        resolved_unit: resolved.unit
      };
    });
  }, [restockAlerts, suppliers, mergedCatalogProducts, allSupplierProducts]);

  const restockSupplierOptions = useMemo(() => {
    const set = new Set<string>();
    enrichedRestockAlerts.forEach((it: any) => {
      if (it.resolved_supplier_name) set.add(it.resolved_supplier_name);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "vi"));
  }, [enrichedRestockAlerts]);

  const filteredRestockAlerts = useMemo(() => {
    const q = normSearch(restockSearch);
    return enrichedRestockAlerts.filter((it: any) => {
      if (restockSupplierFilter !== "all" && it.resolved_supplier_name !== restockSupplierFilter) return false;
      if (q) {
        const hay = normSearch(`${it.product_code || ""} ${it.product_name || ""} ${it.resolved_supplier_name || ""} ${it.resolved_short_name || ""} ${it.warehouse_location || ""}`);
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [enrichedRestockAlerts, restockSupplierFilter, restockSearch]);

  // Near-Expiry Alert (Cảnh Báo Cận Date / Hết Hạn - Requirement 7 / Issue 7)
  const nearExpiryAlerts = useMemo(() => {
    const nowMs = Date.now();
    const list: any[] = [];
    for (const it of inventoryItems) {
      const qty = Number(it.quantity_on_hand) || 0;
      if (qty <= 0 || !it.expiry_date) continue;
      const expStr = dbDateVN(it.expiry_date);
      if (!expStr) continue;
      const expMs = new Date(expStr + "T00:00:00").getTime();
      if (isNaN(expMs)) continue;
      const daysRemaining = Math.ceil((expMs - nowMs) / 86400000);
      if (daysRemaining <= 180) {
        const resolved = resolveItemSupplierAndPrice(it);
        list.push({
          ...it,
          expiry_date_vn: expStr,
          days_remaining: daysRemaining,
          resolved_supplier_name: resolved.supplierName,
          resolved_unit_price: resolved.unitPrice,
          resolved_unit: resolved.unit
        });
      }
    }
    return list.sort((a, b) => a.days_remaining - b.days_remaining);
  }, [inventoryItems, suppliers, mergedCatalogProducts, allSupplierProducts]);

  // Header KPIs use the very same lists as the tabs, so the numbers always agree (and refresh after every edit)
  const liveStats = useMemo(() => {
    const live = orders.filter(o => o.status !== "CANCELLED");
    const totalSpend = live.reduce((a, o) => a + poDebt(o).total, 0);
    const totalPaid = live.reduce((a, o) => a + poDebt(o).paid, 0);
    const totalPayable = live.reduce((a, o) => a + poDebt(o).payable, 0);
    return {
      total_spend: totalSpend,
      total_paid: totalPaid,
      total_payable: totalPayable,
      active_orders_count: poCounts.open,
      pending_pr_count: prCounts.pending + prCounts.partial,
      restock_alert_count: restockAlerts.length,
      near_expiry_count: nearExpiryAlerts.length,
      total_suppliers_count: suppliers.length
    };
  }, [orders, poCounts, prCounts, restockAlerts, nearExpiryAlerts, suppliers]);

  // Filtered PRs
  const filteredPRs = useMemo(() => {
    const q = normSearch(prSearch);
    return purchaseRequests.filter(pr => {
      if (q) {
        const hay = normSearch(`${pr.workflow_code || ""} ${pr.title || ""} ${pr.product_info || ""} ${pr.requester_name || ""} ${pr.description || ""}`);
        if (!hay.includes(q)) return false;
      }
      if (prStatusFilter === "all") return true;
      return getPRBucket(pr) === prStatusFilter;
    });
  }, [purchaseRequests, prSearch, prStatusFilter, orders]);

  // Filtered Suppliers (accent-insensitive search across name, short_name, supplier_code, contact_person, product_lines, address)
  const filteredSuppliers = useMemo(() => {
    const q = normSearch(supplierSearch);
    if (!q) return suppliers;
    return suppliers.filter(s => {
      const hay = normSearch(`${s.name || ""} ${s.short_name || ""} ${s.supplier_code || ""} ${s.contact_person || ""} ${s.product_lines || ""} ${s.address || ""} ${s.email || ""} ${s.phone || ""}`);
      return hay.includes(q);
    });
  }, [suppliers, supplierSearch]);

  // Filtered Payables: NCC, khoảng ngày đặt, trạng thái công nợ, mã PO / mã hàng
  const payableSuppliers = useMemo(
    () => Array.from(new Set(orders.map(o => String(o.supplier_name || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "vi")),
    [orders]
  );
  const filteredPayables = useMemo(() => {
    const kw = normSearch(payableSearch);
    return orders.filter(po => {
      const dbt = poDebt(po);
      const paid = dbt.paid;
      if (String(po.status || "").toUpperCase() === "CANCELLED" && paid <= 0) return false;
      if (payableFilter === "debt" && !(dbt.payable > 0.5)) return false;
      if (payableFilter === "prepaid" && !(dbt.prepaid > 0.5)) return false;
      if (payableFilter === "paid" && dbt.status !== "SETTLED") return false;
      if (payableSupplier !== "all" && String(po.supplier_name || "").trim() !== payableSupplier) return false;
      const d = po.order_date ? String(po.order_date).slice(0, 10) : "";
      if (payableFrom && (!d || d < payableFrom)) return false;
      if (payableTo && (!d || d > payableTo)) return false;
      if (kw) {
        let items: any[] = po.items;
        if (typeof items === "string") { try { items = JSON.parse(items); } catch { items = []; } }
        const hay = [po.po_code, po.supplier_name, ...(Array.isArray(items) ? items.map((it: any) => `${it.product_code || ""} ${it.product_name || ""}`) : [])];
        if (!hay.some(v => normSearch(v).includes(kw))) return false;
      }
      return true;
    });
  }, [orders, payableFilter, payableSupplier, payableFrom, payableTo, payableSearch]);

  const ordersPage = usePaged(filteredOrders, 20);
  const prsPage = usePaged(filteredPRs, 20);
  const suppliersPage = usePaged(filteredSuppliers, 20);
  const payablesPage = usePaged(filteredPayables, 20);

  return (
    <div className="space-y-6">
      {/* 1. TOP HEADER & KPI METRIC CARDS */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 text-orange-600 dark:text-orange-400">
              <div className="p-2 rounded-xl bg-orange-50 dark:bg-orange-950/60 border border-orange-200 dark:border-orange-800/60">
                <ShoppingCart className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white">
                  CUNG ỨNG & MUA HÀNG THƯƠNG MẠI
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Hệ thống chuyên trách Quản lý Đơn mua hàng (PO), Đề xuất mua (PR), Tiến độ giao nhận & Thông quan Hải quan, Công nợ NCC.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setPoSupplierNotice(null);
                setPoItemSearchQueries({});
                setPOForm({
                  id: null,
                  po_code: "",
                  supplier_id: suppliers[0]?.id || 1,
                  supplier_name: suppliers[0]?.name || "",
                  order_date: todayVN(),
                  expected_delivery_date: toVNDateString(new Date(Date.now() + 10 * 86400000)),
                  items: [
                    { product_code: "", product_name: "", unit: "Hộp", quantity: 1, unit_price: 0, total: 0, is_stock: true, notes: "" }
                  ],
                  total_amount: 0,
                  status: "PENDING",
                  notes: ""
                });
                setIsPOModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-orange-600 text-white shadow-xs hover:bg-orange-700 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" /> Lập Đơn Đặt Mua (PO)
            </button>
            <button
              onClick={handleOpenNewPRModal}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all cursor-pointer"
            >
              <FileText className="w-4 h-4" /> Gửi Đề Xuất (PR)
            </button>
            <button
              onClick={() => {
                setSupplierForm({
                  id: null,
                  supplier_code: `NCC-TBR-${Date.now().toString().slice(-4)}`,
                  name: "",
                  short_name: "",
                  contact_person: "",
                  phone: "",
                  email: "",
                  address: "",
                  product_lines: "",
                  payment_terms: "Công nợ 30 ngày",
                  rating: 5
                });
                setIsSupplierModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all cursor-pointer"
            >
              <Building2 className="w-4 h-4" /> Thêm NCC Mới
            </button>
          </div>
        </div>

        {/* 5 Interactive Stat Cards (Requirement 7 / Issue 5) */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-2">
          <div
            role="button"
            onClick={() => {
              setSubTab("orders");
              setOrderStatusFilter("all");
              scrollToMainSection();
            }}
            title="Bấm để xem toàn bộ danh sách Đơn Đặt Mua Hàng (PO)"
            className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 cursor-pointer hover:ring-2 hover:ring-blue-400 hover:shadow-sm transition-all"
          >
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-[11px] font-semibold">
              <span>Tổng Chi Mua Hàng</span>
              <DollarSign className="w-3.5 h-3.5 text-blue-500" />
            </div>
            <div className="mt-1 text-base font-black font-mono text-slate-900 dark:text-white">
              {formatCurrency(liveStats.total_spend)}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">{orders.length} đơn PO toàn hệ thống ↗</div>
          </div>

          <div
            role="button"
            onClick={() => {
              setSubTab("orders");
              setOrderStatusFilter("open");
              scrollToMainSection();
            }}
            title="Bấm để xem các PO đang mở"
            className="p-3.5 rounded-xl bg-orange-50/70 dark:bg-orange-950/40 border border-orange-200/80 dark:border-orange-800/60 cursor-pointer hover:ring-2 hover:ring-orange-300 hover:shadow-sm transition-all"
          >
            <div className="flex items-center justify-between text-orange-700 dark:text-orange-400 text-[11px] font-semibold">
              <span>PO Đang Mở</span>
              <Clock className="w-3.5 h-3.5 text-orange-500" />
            </div>
            <div className="mt-1 text-base font-black font-mono text-orange-700 dark:text-orange-400">
              {liveStats.active_orders_count} / {orders.length} Đơn PO
            </div>
            <div className="text-[10px] text-orange-600/70 mt-0.5">Chưa nhập kho đủ, chưa huỷ ↗</div>
          </div>

          <div
            role="button"
            onClick={() => {
              setSubTab("pr");
              setPRStatusFilter("pending");
              scrollToMainSection();
            }}
            title="Bấm để xem các đề xuất mua hàng (PR) đang chờ xử lý"
            className="p-3.5 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/60 cursor-pointer hover:ring-2 hover:ring-indigo-300 hover:shadow-sm transition-all"
          >
            <div className="flex items-center justify-between text-indigo-700 dark:text-indigo-400 text-[11px] font-semibold">
              <span>PR Cần Xử Lý</span>
              <FileText className="w-3.5 h-3.5 text-indigo-500" />
            </div>
            <div className="mt-1 text-base font-black font-mono text-indigo-700 dark:text-indigo-400">
              {liveStats.pending_pr_count} / {purchaseRequests.length} Đề Xuất
            </div>
            <div className="text-[10px] text-indigo-600/70 mt-0.5">Chờ xử lý + đã lên PO 1 phần ↗</div>
          </div>

          <div
            role="button"
            onClick={() => {
              setSubTab("payables");
              setPayableFilter("debt");
              scrollToMainSection();
            }}
            title="Bấm để chuyển đến bảng Quản lý Công nợ Nhà cung cấp (lọc các PO còn nợ)"
            className="p-3.5 rounded-xl bg-rose-50/70 dark:bg-rose-950/40 border border-rose-200/80 dark:border-rose-800/60 cursor-pointer hover:ring-2 hover:ring-rose-300 hover:shadow-sm transition-all"
          >
            <div className="flex items-center justify-between text-rose-700 dark:text-rose-400 text-[11px] font-semibold">
              <span>Công Nợ Cần Trả NCC</span>
              <CreditCard className="w-3.5 h-3.5 text-rose-500" />
            </div>
            <div className="mt-1 text-base font-black font-mono text-rose-700 dark:text-rose-400">
              {formatCurrency(liveStats.total_payable)}
            </div>
            <div className="text-[10px] text-rose-600/70 mt-0.5">Đã trả: {formatCurrency(liveStats.total_paid)} ↗</div>
          </div>

          <div
            role="button"
            onClick={() => {
              setSubTab("restock");
              setAlertSubView("restock");
              scrollToMainSection();
            }}
            title="Bấm để chuyển đến tab Cảnh Báo Tồn Thiếu & Cận Date"
            className="p-3.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 cursor-pointer hover:ring-2 hover:ring-amber-300 hover:shadow-sm transition-all"
          >
            <div className="flex items-center justify-between text-amber-700 dark:text-amber-400 text-[11px] font-semibold">
              <span>Cảnh Báo Tồn Thiếu</span>
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            </div>
            <div className="mt-1 text-base font-black font-mono text-amber-700 dark:text-amber-400">
              {liveStats.restock_alert_count} Mặt Hàng
            </div>
            <div className="text-[10px] text-amber-600/70 mt-0.5">
              Chạm Min • {liveStats.near_expiry_count > 0 ? `${liveStats.near_expiry_count} lô cận date ↗` : "Kiểm tra tồn & HSD ↗"}
            </div>
          </div>
        </div>
      </div>

      {/* 2. SUBTAB NAVIGATION BAR */}
      <div ref={mainSectionRef} className="flex border-b border-slate-200 dark:border-slate-800 gap-2 md:gap-6 text-xs font-bold overflow-x-auto">
        <button
          id="subtab-btn-orders"
          onClick={() => setSubTab("orders")}
          className={`pb-3 px-1 transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
            subTab === "orders" ? "border-b-2 border-orange-600 text-orange-600 dark:text-orange-400" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
          }`}
        >
          <ShoppingCart className="w-4 h-4" />
          <span>Đơn Đặt Mua Hàng (PO NCC)</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
            {orders.length}
          </span>
        </button>

        <button
          id="subtab-btn-pr"
          onClick={() => setSubTab("pr")}
          className={`pb-3 px-1 transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
            subTab === "pr" ? "border-b-2 border-orange-600 text-orange-600 dark:text-orange-400" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Đề Xuất Mua Hàng (PR)</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-400">
            {purchaseRequests.length}
          </span>
        </button>

        <button
          id="subtab-btn-suppliers"
          onClick={() => setSubTab("suppliers")}
          className={`pb-3 px-1 transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
            subTab === "suppliers" ? "border-b-2 border-orange-600 text-orange-600 dark:text-orange-400" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Danh Bạ & Đánh Giá NCC</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
            {suppliers.length}
          </span>
        </button>

        <button
          id="subtab-btn-payables"
          onClick={() => setSubTab("payables")}
          className={`pb-3 px-1 transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
            subTab === "payables" ? "border-b-2 border-orange-600 text-orange-600 dark:text-orange-400" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>Quản Lý Công Nợ NCC</span>
          {liveStats.total_payable > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-400 font-mono">
              {formatCurrency(liveStats.total_payable)}
            </span>
          )}
        </button>

        <button
          id="subtab-btn-restock"
          onClick={() => { setSubTab("restock"); setAlertSubView("restock"); }}
          className={`pb-3 px-1 transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
            subTab === "restock" && alertSubView === "restock" ? "border-b-2 border-orange-600 text-orange-600 dark:text-orange-400" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
          }`}
        >
          <AlertTriangle className="w-4 h-4" />
          <span>Cảnh Báo Tồn Thiếu (Restock)</span>
          {restockAlerts.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400">
              {restockAlerts.length}
            </span>
          )}
        </button>

        <button
          id="subtab-btn-near-expiry"
          onClick={() => { setSubTab("restock"); setAlertSubView("near_expiry"); }}
          className={`pb-3 px-1 transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
            subTab === "restock" && alertSubView === "near_expiry" ? "border-b-2 border-rose-600 text-rose-600 dark:text-rose-400" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
          }`}
        >
          <Clock className="w-4 h-4 text-rose-500" />
          <span>⏳ Cảnh Báo Cận Date</span>
          {nearExpiryAlerts.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-400 font-bold">
              {nearExpiryAlerts.length}
            </span>
          )}
        </button>

        <button
          id="subtab-btn-lookup"
          onClick={() => setSubTab("lookup")}
          className={`pb-3 px-1 transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
            subTab === "lookup" ? "border-b-2 border-orange-600 text-orange-600 dark:text-orange-400" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
          }`}
        >
          <Search className="w-4 h-4" />
          <span>Tra Cứu Dòng Hàng</span>
        </button>
      </div>

      {subTab === "lookup" && (
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <LineItemLookup sources={[
            "po", "receipt",
            ...((can && (can("sales.view") || can("warehouse.view"))) ? (["px", "so"] as const) : [])
          ]} />
        </div>
      )}

      {/* ========================================================= */}
      {/* SUBTAB 1: PURCHASE ORDERS (PO)                            */}
      {/* ========================================================= */}
      {subTab === "orders" && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          {/* Controls Bar & Expanded Lifecycle Filters */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5 flex-1 max-w-2xl">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Tìm theo mã PO, tên NCC hoặc sản phẩm..."
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
              <button
                type="button"
                onClick={() => exportPOListExcel(filteredOrders)}
                title="Xuất Excel danh sách PO đang lọc (mỗi dòng hàng 1 dòng)"
                className="shrink-0 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-1.5 cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4" /> Excel
              </button>
              <div className="shrink-0 flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs">
                {([["po", "Theo đơn PO"], ["lines", "Theo mặt hàng"]] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPOViewMode(mode)}
                    className={`px-3 py-1 rounded-lg font-semibold whitespace-nowrap cursor-pointer ${poViewMode === mode ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs" : "text-slate-600 dark:text-slate-400"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Filter Buttons including Customs and All Lifecycle Statuses (in logical XNK order) */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {[
                { id: "all", label: "Tất cả" },
                { id: "open", label: "Đang mở" },
                { id: "PENDING", label: "Chờ xác nhận" },
                { id: "CONFIRMED", label: "Đã xác nhận" },
                { id: "ORDERED", label: "Đã đặt hàng" },
                { id: "PRODUCED", label: "Đã sản xuất xong" },
                { id: "SHIPPED", label: "Đang vận chuyển" },
                { id: "CUSTOMS", label: "🛃 Hải quan & Thông quan" },
                { id: "PARTIALLY_RECEIVED", label: "Nhập kho 1 phần" },
                { id: "COMPLETED", label: "Đã nhập kho" },
                { id: "CANCELLED", label: "Đã hủy đơn" }
              ].filter(f => f.id === "all" || f.id === "open" || (poCounts[f.id] || 0) > 0 || orderStatusFilter === f.id).map(f => (
                <button
                  key={f.id}
                  onClick={() => setOrderStatusFilter(f.id)}
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    orderStatusFilter === f.id
                      ? "bg-orange-600 text-white shadow-xs"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                  }`}
                >
                  {f.label} ({poCounts[f.id] || 0})
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="flex items-center gap-1 text-slate-500">Ngày đặt từ
              <DateInputVN value={orderFrom} onChange={(e) => setOrderFrom(e.target.value)} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white" />
            </label>
            <label className="flex items-center gap-1 text-slate-500">đến
              <DateInputVN value={orderTo} onChange={(e) => setOrderTo(e.target.value)} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white" />
            </label>
            <input value={orderInvoiceSearch} onChange={(e) => setOrderInvoiceSearch(e.target.value)} placeholder="Số hóa đơn..."
              className="w-36 p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono" />
            <input value={orderProductSearch} onChange={(e) => setOrderProductSearch(e.target.value)} placeholder="Mã hàng..."
              className="w-36 p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono" />
            {(orderFrom || orderTo || orderInvoiceSearch || orderProductSearch) && (
              <button type="button" onClick={() => { setOrderFrom(""); setOrderTo(""); setOrderInvoiceSearch(""); setOrderProductSearch(""); }}
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer">
                Xóa lọc
              </button>
            )}
            <span className="text-slate-400">{filteredOrders.length} PO</span>
          </div>

          {poViewMode === "lines" ? (
            <POLineItemsView
              orders={filteredOrders}
              suppliers={suppliers}
              onOpenPO={(po) => setSelectedPODetail(po)}
              receivedOf={receivedOf}
              cleanItemName={cleanItemName}
              itemSourcePR={itemSourcePR}
              statusLabel={(st) => {
                const cfg = PO_STATUS_CONFIG[String(st || "").toUpperCase()];
                return { label: cfg?.label || st || "—", className: `font-semibold ${cfg?.text || "text-slate-500"}` };
              }}
              paymentStatus={getPOPaymentStatus}
            />
          ) : (<>
          {/* Table */}
          <div className="overflow-x-auto min-h-[380px] pb-24">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700">
                  <th className="py-2.5 px-3 w-32 whitespace-nowrap">Mã Đơn PO</th>
                  <th className="py-2.5 px-3 min-w-[280px]">Chi Tiết Hàng Hóa Đặt Mua</th>
                  <th className="py-2.5 px-3 text-right w-32 whitespace-nowrap">Tổng Tiền PO</th>
                  <th className="py-2.5 px-3 w-32 whitespace-nowrap">Số HĐ / Ngày HĐ</th>
                  <th className="py-2.5 px-3 text-center w-32 whitespace-nowrap">Thanh Toán</th>
                  <th className="py-2.5 px-3 text-center w-40 whitespace-nowrap">Trạng Thái Đơn</th>
                  <th className="py-2.5 px-3 text-center w-36 whitespace-nowrap">Thao Tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      Không tìm thấy đơn đặt mua hàng nào phù hợp
                    </td>
                  </tr>
                ) : (
                  ordersPage.items.map((po, idx) => {
                    const dbt = poDebt(po);
                    const totalAmt = dbt.total || parseFloat(po.total_amount) || 0;
                    const paidAmt = dbt.paid || parseFloat(po.amount_paid) || 0;
                    const remainingAmt = Math.max(0, totalAmt - paidAmt);
                    const isFullyPaid = paidAmt >= totalAmt && totalAmt > 0;
                    const payStatusKey = getPOPaymentStatus(po);
                    const payStatusCfg = PO_PAYMENT_STATUS_CONFIG[payStatusKey] || PO_PAYMENT_STATUS_CONFIG.UNPAID;
                    const statusCfg = PO_STATUS_CONFIG[po.status] || {
                      label: po.status,
                      bg: "bg-slate-100 dark:bg-slate-800",
                      text: "text-slate-700 dark:text-slate-300",
                      border: "border-slate-200",
                      icon: Clock
                    };
                    const StatusIcon = statusCfg.icon;
                    const supp = suppliers.find((s: any) => s.id === po.supplier_id || s.name === po.supplier_name);
                    const isRowDropdownOpen = activeStatusDropdownId === po.id || activePaymentDropdownId === po.id;

                    return (
                      <React.Fragment key={po.id}>
                        {/* Row 1: Dedicated Supplier Header Row (kèm Ngày đặt, Hẹn giao, Người lập, Mã PR) */}
                        <tr className="bg-slate-100/80 dark:bg-slate-800/80 border-t-2 border-slate-200/90 dark:border-slate-700">
                          <td colSpan={7} className="py-2 px-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="p-1 rounded-md bg-orange-100 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400 shrink-0">
                                  <Building2 className="w-3.5 h-3.5" />
                                </span>
                                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 shrink-0">
                                  Nhà Cung Cấp:
                                </span>
                                <span className="font-bold text-slate-900 dark:text-white text-xs truncate">
                                  {po.supplier_name || "Chưa xác định"}
                                </span>
                                {supp?.short_name && (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800/60 shrink-0">
                                    {supp.short_name}
                                  </span>
                                )}
                                {supp?.phone && (
                                  <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                                    • 📞 {supp.phone}
                                  </span>
                                )}
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                <div className="flex flex-wrap items-center gap-2 text-[11px] bg-white/80 dark:bg-slate-900/70 px-2.5 py-1 rounded-lg border border-slate-200/90 dark:border-slate-700">
                                  <span className="text-slate-500 dark:text-slate-400">
                                    Ngày đặt: <strong className="font-mono text-slate-800 dark:text-slate-100">{formatDate(po.order_date)}</strong>
                                  </span>
                                  <span className="text-slate-300 dark:text-slate-600">|</span>
                                  {editingDeliveryDateId === po.id ? (
                                    <div className="inline-flex items-center gap-1 bg-white dark:bg-slate-800 px-1 py-0.5 rounded border border-orange-400">
                                      <DateInputVN
                                        value={tempDeliveryDate}
                                        onChange={(e) => setTempDeliveryDate(e.target.value)}
                                        className="text-[11px] font-bold py-0.2 px-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden"
                                      />
                                      <button
                                        onClick={() => handleSaveDeliveryDate(po)}
                                        title="Lưu ngày hẹn giao"
                                        className="p-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                                      >
                                        <Check className="w-3 h-3" />
                                      </button>
                                      <button
                                        onClick={() => setEditingDeliveryDateId(null)}
                                        title="Hủy"
                                        className="p-0.5 rounded bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-600 dark:text-slate-300 cursor-pointer"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="inline-flex items-center gap-1">
                                      <span className="text-slate-500 dark:text-slate-400">Hẹn giao:</span>
                                      <strong className="font-mono text-orange-600 dark:text-orange-400">
                                        {formatDate(po.expected_delivery_date)}
                                      </strong>
                                      <button
                                        onClick={() => {
                                          setEditingDeliveryDateId(po.id);
                                          setTempDeliveryDate(po.expected_delivery_date ? dbDateVN(po.expected_delivery_date) : todayVN());
                                        }}
                                        title="Chỉnh sửa ngày hẹn giao hàng"
                                        className="p-0.5 rounded text-slate-400 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-slate-800 cursor-pointer transition-colors"
                                      >
                                        <Edit2 className="w-3 h-3" />
                                      </button>
                                    </span>
                                  )}
                                  <span className="text-slate-300 dark:text-slate-600">|</span>
                                  <span className="text-slate-500 dark:text-slate-400">
                                    👤 Lập bởi: <strong className="text-slate-800 dark:text-slate-200">{getPOCreator(po)}</strong>
                                  </span>
                                  {(() => {
                                    const prCodes = Array.from(
                                      new Set<string>(
                                        (Array.isArray(po.items) ? po.items : [])
                                          .map((it: any) => String(itemSourcePR(it) || ""))
                                          .filter(Boolean)
                                      )
                                    );
                                    if (prCodes.length === 0) return null;
                                    if (prCodes.length === 1) {
                                      return (
                                        <>
                                          <span className="text-slate-300 dark:text-slate-600">|</span>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              openPRByCode(prCodes[0]);
                                            }}
                                            title={`Bấm để mở xem chi tiết Phiếu PR ${prCodes[0]}`}
                                            className="px-1.5 py-0.2 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-[10px] font-mono font-bold hover:bg-indigo-100 hover:underline cursor-pointer whitespace-nowrap"
                                          >
                                            🔗 {prCodes[0]}
                                          </button>
                                        </>
                                      );
                                    }
                                    return (
                                      <>
                                        <span className="text-slate-300 dark:text-slate-600">|</span>
                                        <span
                                          className="px-1.5 py-0.2 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-[10px] font-sans font-bold cursor-help whitespace-nowrap"
                                          title={`Gom từ ${prCodes.length} PR:\n${prCodes.join("\n")}\n(mã PR hiện cạnh từng mặt hàng)`}
                                        >
                                          🔗 Gom {prCodes.length} PR
                                        </span>
                                      </>
                                    );
                                  })()}
                                </div>

                                {po.notes && (
                                  <div className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center gap-1.5 italic max-w-md truncate bg-white/70 dark:bg-slate-900/60 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700" title={po.notes}>
                                    <span className="font-semibold not-italic text-slate-400">Ghi chú:</span>
                                    <span className="truncate">{po.notes}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>

                        {/* Row 2: Main PO Details */}
                        <tr className={`hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors border-b border-slate-200/60 dark:border-slate-800 ${isRowDropdownOpen ? "relative z-50" : "relative z-10"}`}>
                          {/* Col 1: PO Code */}
                          <td className="py-3 px-3 font-mono font-bold text-orange-600 dark:text-orange-400 align-top whitespace-nowrap">
                            <button
                              onClick={() => setSelectedPODetail(po)}
                              className="hover:underline inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                            >
                              <FileText className="w-3.5 h-3.5 shrink-0" />
                              <span>{po.po_code}</span>
                            </button>
                          </td>

                          {/* Col 3: Items Details - Compact by default, click to expand */}
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-300 align-top">
                            {Array.isArray(po.items) && po.items.length > 0 ? (
                              (() => {
                                const isExpanded = !!expandedPOIds[po.id];
                                if (po.items.length === 1) {
                                  const it = po.items[0];
                                  return (
                                    <div className="flex items-start justify-between gap-3 text-[11px] bg-slate-50/70 dark:bg-slate-800/50 p-1.5 rounded-lg border border-slate-100 dark:border-slate-800/80">
                                      <div className="flex-1">
                                        <div className="flex items-baseline gap-1.5 flex-wrap">
                                          <span className="font-mono font-bold text-slate-700 dark:text-slate-300 bg-slate-200/70 dark:bg-slate-700/60 px-1.5 py-0.5 rounded text-[10px]">
                                            {it.product_code || "---"}
                                          </span>
                                          {renderItemPRChips(it)}
                                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                                            {cleanItemName(it.product_name)}
                                          </span>
                                          {it.specification && (
                                            <span className="text-[10px] text-slate-500 italic">
                                              ({it.specification})
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="text-right shrink-0">
                                        <span className="font-mono font-bold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/60 px-2 py-0.5 rounded-md border border-orange-200 dark:border-orange-800">
                                          x{it.quantity} {it.unit || ""}
                                        </span>
                                        {parseFloat(it.unit_price) > 0 && (
                                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                            @ {formatCurrency(it.unit_price)}
                                          </div>
                                        )}
                                        {(() => {
                                          const inbPrice = Number(po?.inbound_price_map?.[String(it.product_code || "").trim().toUpperCase()]?.unit_price) || 0;
                                          const poPrice = Number(it.unit_price) || 0;
                                          if (inbPrice <= 0) return null;
                                          const isDiff = Math.abs(inbPrice - poPrice) > 0.01;
                                          return (
                                            <div className={`text-[10px] font-mono font-semibold mt-0.5 ${isDiff ? "text-amber-600 dark:text-amber-400" : "text-teal-600 dark:text-teal-400"}`} title="Đơn giá thực tế trên Phiếu Nhập Kho (PNK) để đối chiếu">
                                              PNK: {formatCurrency(inbPrice)}{isDiff ? " ⚠️" : ""}
                                            </div>
                                          );
                                        })()}
                                      </div>
                                    </div>
                                  );
                                }

                                if (!isExpanded) {
                                  const it = po.items[0];
                                  return (
                                    <div className="space-y-1.5">
                                      <div className="flex items-start justify-between gap-3 text-[11px] bg-slate-50/70 dark:bg-slate-800/50 p-1.5 rounded-lg border border-slate-100 dark:border-slate-800/80">
                                        <div className="flex-1">
                                          <div className="flex items-baseline gap-1.5 flex-wrap">
                                            <span className="font-mono font-bold text-slate-700 dark:text-slate-300 bg-slate-200/70 dark:bg-slate-700/60 px-1.5 py-0.5 rounded text-[10px]">
                                              {it.product_code || "---"}
                                            </span>
                                            {renderItemPRChips(it)}
                                            <span className="font-semibold text-slate-900 dark:text-slate-100 truncate max-w-xs">
                                              {cleanItemName(it.product_name)}
                                            </span>
                                            {it.specification && (
                                              <span className="text-[10px] text-slate-500 italic">
                                                ({it.specification})
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                          <span className="font-mono font-bold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/60 px-2 py-0.5 rounded-md border border-orange-200 dark:border-orange-800">
                                            x{it.quantity} {it.unit || ""}
                                          </span>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            toggleExpandPO(po.id);
                                          }}
                                          className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/70 hover:bg-indigo-100 dark:hover:bg-indigo-900/70 px-2 py-0.5 rounded-md border border-indigo-200 dark:border-indigo-800 transition-colors cursor-pointer"
                                          title="Bấm để hiển thị đầy đủ tất cả mặt hàng trong đơn PO này"
                                        >
                                          <ChevronDown className="w-3 h-3" />
                                          <span>+{po.items.length - 1} mặt hàng khác (Bấm xem đầy đủ)</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedPODetail(po);
                                          }}
                                          className="text-[10px] text-slate-400 hover:text-indigo-600 hover:underline cursor-pointer"
                                        >
                                          Chi tiết PO ↗
                                        </button>
                                      </div>
                                    </div>
                                  );
                                }

                                return (
                                  <div className="space-y-1.5">
                                    {po.items.map((it: any, i: number) => (
                                      <div
                                        key={i}
                                        className="flex items-start justify-between gap-3 text-[11px] bg-slate-50/70 dark:bg-slate-800/50 p-1.5 rounded-lg border border-slate-100 dark:border-slate-800/80"
                                      >
                                        <div className="flex-1">
                                          <div className="flex items-baseline gap-1.5 flex-wrap">
                                            <span className="font-mono font-bold text-slate-700 dark:text-slate-300 bg-slate-200/70 dark:bg-slate-700/60 px-1.5 py-0.5 rounded text-[10px]">
                                              {it.product_code || "---"}
                                            </span>
                                            {renderItemPRChips(it)}
                                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                                              {cleanItemName(it.product_name)}
                                            </span>
                                            {it.specification && (
                                              <span className="text-[10px] text-slate-500 italic">
                                                ({it.specification})
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                          <span className="font-mono font-bold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/60 px-2 py-0.5 rounded-md border border-orange-200 dark:border-orange-800">
                                            x{it.quantity} {it.unit || ""}
                                          </span>
                                          {parseFloat(it.unit_price) > 0 && (
                                            <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                              @ {formatCurrency(it.unit_price)}
                                            </div>
                                          )}
                                          {(() => {
                                            const inbPrice = Number(po?.inbound_price_map?.[String(it.product_code || "").trim().toUpperCase()]?.unit_price) || 0;
                                            const poPrice = Number(it.unit_price) || 0;
                                            if (inbPrice <= 0) return null;
                                            const isDiff = Math.abs(inbPrice - poPrice) > 0.01;
                                            return (
                                              <div className={`text-[10px] font-mono font-semibold mt-0.5 ${isDiff ? "text-amber-600 dark:text-amber-400" : "text-teal-600 dark:text-teal-400"}`} title="Đơn giá thực tế trên Phiếu Nhập Kho (PNK) để đối chiếu">
                                                PNK: {formatCurrency(inbPrice)}{isDiff ? " ⚠️" : ""}
                                              </div>
                                            );
                                          })()}
                                        </div>
                                      </div>
                                    ))}
                                    <div className="pt-0.5">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleExpandPO(po.id);
                                        }}
                                        className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-2 py-0.5 rounded-md transition-colors cursor-pointer"
                                      >
                                        <ChevronUp className="w-3 h-3" />
                                        <span>Thu gọn danh mục ({po.items.length} mặt hàng)</span>
                                      </button>
                                    </div>
                                  </div>
                                );
                              })()
                            ) : (
                              <span className="text-slate-400 italic">Không có chi tiết</span>
                            )}
                          </td>

                          {/* Col 4: Total Amount */}
                          <td className="py-3 px-4 font-mono font-bold text-right text-slate-900 dark:text-white whitespace-nowrap align-top">
                            <div className="text-sm">{formatCurrency(totalAmt)}</div>
                            {Number(po.inbound_total_po_value) > 0 && po.has_inbound_price_diff && (
                              <div className="mt-1 space-y-0.5">
                                <div className="text-[10px] font-mono font-semibold text-amber-600 dark:text-amber-400" title="Tổng giá trị tính theo đơn giá thực tế trên Phiếu Nhập Kho (PNK)">
                                  Giá PNK: {formatCurrency(po.inbound_total_po_value)}
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleEditPO(po);
                                  }}
                                  className="px-1.5 py-0.5 rounded text-[9px] font-sans font-bold bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 cursor-pointer"
                                  title="Đơn giá trên Phiếu Nhập Kho đang khác với Đơn giá PO. Bấm để mở PO đối chiếu / điều chỉnh nếu cần."
                                >
                                  ⚠️ Lệch giá PNK • Đối chiếu
                                </button>
                              </div>
                            )}
                          </td>

                          {/* Hóa đơn đầu vào (theo từng đợt nhận hàng) */}
                          <td className="py-3 px-4 align-top whitespace-nowrap">
                            {poSupplierInvoices(po).length === 0 ? (
                              <span className="text-slate-400">—</span>
                            ) : poSupplierInvoices(po).map((iv: any, ivIdx: number) => (
                              <div key={ivIdx} className="leading-tight mb-1" title={iv.inbound_code ? `Phiếu nhập ${iv.inbound_code}` : undefined}>
                                <div className="font-mono font-bold text-slate-800 dark:text-slate-100">{iv.invoice_no}</div>
                                <div className="text-[10px] text-slate-500">{iv.invoice_date ? formatDate(iv.invoice_date) : ""}</div>
                              </div>
                            ))}
                            {po.status !== "CANCELLED" && (
                              <button
                                type="button"
                                onClick={() => openInvoiceEditor(po)}
                                className="mt-0.5 text-[10px] font-bold text-orange-600 dark:text-orange-400 hover:underline cursor-pointer"
                                title="Nhập / sửa số hóa đơn và ngày hóa đơn của nhà cung cấp"
                              >
                                {poSupplierInvoices(po).length === 0 ? "+ Nhập HĐ" : "✎ Sửa HĐ"}
                              </button>
                            )}
                          </td>

                          {/* Col 5: Payment (Issue 4d: Interactive Payment Status Dropdown) */}
                          <td className={`py-3 px-4 text-center whitespace-nowrap relative align-top ${activePaymentDropdownId === po.id ? "z-50" : "z-10"}`}>
                            {activePaymentDropdownId === po.id && (
                              <div
                                className="fixed inset-0 z-30"
                                onClick={() => setActivePaymentDropdownId(null)}
                              />
                            )}
                            <div className="inline-block text-left relative" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveStatusDropdownId(null);
                                  setActivePaymentDropdownId(activePaymentDropdownId === po.id ? null : po.id);
                                }}
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold inline-flex items-center gap-1 border transition-all cursor-pointer shadow-2xs hover:scale-105 ${payStatusCfg.bg} ${payStatusCfg.text} ${payStatusCfg.border}`}
                                title="Bấm để chuyển nhanh trạng thái thanh toán (Chưa trả / Đã đề nghị thanh toán / Đã trả 1 phần / Đã tất toán)"
                              >
                                {isFullyPaid && <CheckCircle2 className="w-3 h-3" />}
                                <span>
                                  {payStatusKey === "PARTIAL_PAID" && totalAmt > 0 && paidAmt > 0
                                    ? `${dbt.received <= 0.5 ? "Đã cọc" : "Đã trả"} ${Math.round((paidAmt / totalAmt) * 100)}%`
                                    : isFullyPaid && dbt.received <= 0.5
                                    ? "Đã TT trước 100%"
                                    : payStatusCfg.label}
                                </span>
                                <ChevronDown className="w-2.5 h-2.5 opacity-60" />
                              </button>
                              {dbt.prepaid > 0.5 && (
                                <div className="text-[10px] text-purple-600 dark:text-purple-400 font-mono font-bold mt-0.5 text-center" title="Khoản đặt cọc / trả trước cho NCC (chưa nhập kho hoặc vượt giá trị đã nhập)">
                                  💜 Đã cọc: {formatCurrency(dbt.prepaid)}
                                </div>
                              )}
                              {!isFullyPaid && remainingAmt > 0 && paidAmt > 0 && (
                                <div className="text-[10px] text-rose-500 font-mono font-bold mt-0.5 text-center">
                                  Còn: {formatCurrency(remainingAmt)}
                                </div>
                              )}

                              {activePaymentDropdownId === po.id && (
                                <div
                                  className={`absolute z-[100] left-1/2 -translate-x-1/2 w-60 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 py-1 text-left text-xs ${
                                    idx >= 1 && idx >= ordersPage.items.length - 2 ? "bottom-full mb-1.5" : "top-full mt-1.5"
                                  }`}
                                >
                                  <div className="px-3 py-1.5 font-bold text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800">
                                    Trạng thái thanh toán / Đặt cọc:
                                  </div>
                                  {Object.entries(PO_PAYMENT_STATUS_CONFIG).map(([pKey, pCfg]) => (
                                    <button
                                      key={pKey}
                                      type="button"
                                      onClick={() => handleQuickChangePaymentStatus(po, pKey)}
                                      className={`w-full px-3 py-2 text-left flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer ${
                                        payStatusKey === pKey ? "bg-orange-50/50 dark:bg-orange-950/30 font-bold" : ""
                                      }`}
                                    >
                                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${pCfg.bg} ${pCfg.text} ${pCfg.border}`}>
                                        {pKey === "PARTIAL_PAID" && dbt.received <= 0.5 ? "Đặt cọc / TT 1 phần" : pKey === "PAID" && dbt.received <= 0.5 ? "TT trước 100%" : pCfg.label}
                                      </span>
                                      {payStatusKey === pKey && <Check className="w-3.5 h-3.5 text-orange-600" />}
                                    </button>
                                  ))}
                                  <div className="border-t border-slate-100 dark:border-slate-800 mt-1 pt-1 px-2 pb-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActivePaymentDropdownId(null);
                                        openPaymentModal(po, dbt.received <= 0.5 ? "deposit" : "full");
                                      }}
                                      className="w-full px-2 py-1.5 rounded-lg text-[11px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 flex items-center gap-1.5 cursor-pointer"
                                    >
                                      <DollarSign className="w-3.5 h-3.5" /> {dbt.received <= 0.5 ? "Ghi sổ Chi cọc / TT trước..." : "Ghi sổ chi tiền chi tiết..."}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Col 6: Status (Bug 4b z-index fix & Proposal 4c XNK logical order) */}
                          <td className={`py-3 px-4 text-center whitespace-nowrap relative align-top ${activeStatusDropdownId === po.id ? "z-50" : "z-10"}`}>
                            {activeStatusDropdownId === po.id && (
                              <div
                                className="fixed inset-0 z-30"
                                onClick={() => setActiveStatusDropdownId(null)}
                              />
                            )}
                            <div className="inline-block text-left relative" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => {
                                  setActivePaymentDropdownId(null);
                                  setActiveStatusDropdownId(activeStatusDropdownId === po.id ? null : po.id);
                                }}
                                className={`px-2.5 py-1 rounded-full text-[10px] font-bold inline-flex items-center gap-1.5 border transition-all cursor-pointer shadow-2xs hover:scale-105 ${statusCfg.bg} ${statusCfg.text} ${statusCfg.border}`}
                                title="Bấm để thay đổi trạng thái đơn hàng"
                              >
                                <StatusIcon className="w-3 h-3" />
                                <span>{statusCfg.label}</span>
                                <ChevronDown className="w-2.5 h-2.5 opacity-60" />
                              </button>

                              {/* Dropdown Menu of All Statuses in Logical XNK Order */}
                              {activeStatusDropdownId === po.id && (
                                <div
                                  className={`absolute z-[100] left-1/2 -translate-x-1/2 w-60 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 py-1 text-left text-xs ${
                                    idx >= 1 && idx >= ordersPage.items.length - 2 ? "bottom-full mb-1.5" : "top-full mt-1.5"
                                  }`}
                                >
                                  <div className="px-3 py-1.5 font-bold text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800">
                                    Cập nhật tiến độ đơn PO (XNK):
                                  </div>
                                  {PO_STATUS_DROPDOWN_ORDER.map((key, stepIdx) => {
                                    const cfg = PO_STATUS_CONFIG[key];
                                    if (!cfg) return null;
                                    const IconComp = cfg.icon;
                                    return (
                                      <button
                                        key={key}
                                        onClick={() => handleQuickChangeStatus(po, key)}
                                        className={`w-full px-3 py-2 text-left flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer ${
                                          po.status === key ? "bg-orange-50/50 dark:bg-orange-950/30 font-bold" : ""
                                        }`}
                                      >
                                        <div className="flex items-center gap-2">
                                          <span className={`p-1 rounded-md ${cfg.bg} ${cfg.text}`}>
                                            <IconComp className="w-3 h-3" />
                                          </span>
                                          <div>
                                            <span className="text-slate-800 dark:text-slate-200">
                                              {stepIdx + 1}. {cfg.label}
                                            </span>
                                            {cfg.isImport && (
                                              <span className="ml-1 text-[9px] px-1 rounded bg-cyan-100 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-400 font-bold">
                                                Nhập khẩu
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                        {po.status === key && <Check className="w-3.5 h-3.5 text-orange-600" />}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Col 7: Actions */}
                          <td className="py-3 px-4 text-center whitespace-nowrap align-top">
                            <div className="flex items-center justify-center gap-1.5">
                              {/* View / Print button */}
                              <button
                                onClick={() => setSelectedPODetail(po)}
                                title="Xem & In Đơn Đặt Hàng"
                                className="p-1.5 rounded-lg text-slate-600 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-slate-800 transition-all cursor-pointer"
                              >
                                <Printer className="w-4 h-4" />
                              </button>

                              {/* Edit PO button */}
                              {po.status !== "CANCELLED" && (
                                <button
                                  onClick={() => handleEditPO(po)}
                                  title="Hiệu chỉnh đơn PO (sửa đơn giá, nhà cung cấp, ghi chú, số lượng) — tự động đồng bộ sang Phiếu Nhập Kho"
                                  className="p-1.5 rounded-lg text-slate-600 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-slate-800 transition-all cursor-pointer"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                              )}

                              {/* Receive to Warehouse */}
                              {po.status === "CANCELLED" ? null : (po.status === "PENDING" || po.status === "DRAFT") ? (
                                <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 px-1.5" title="PO cần được xác nhận (duyệt) trước khi nhập kho">
                                  Chờ duyệt để nhập kho
                                </span>
                              ) : po.status !== "COMPLETED" ? (
                                <button
                                  onClick={() => handleReceiveToWarehouse(po)}
                                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs flex items-center gap-1 cursor-pointer transition-all hover:scale-105"
                                  title="Nhập kho hàng NCC đã giao: khai báo số lô, hạn dùng, số lượng thực nhận (nhập được nhiều lần)"
                                >
                                  <ArrowDownLeft className="w-3.5 h-3.5" /> {po.status === "PARTIALLY_RECEIVED" ? "Nhập tiếp" : "Nhập Kho"}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => po.inbound_transaction_code && openEditInboundSlipFromPO(po.inbound_transaction_code)}
                                  title={po.inbound_transaction_code ? `Bấm để mở & chỉnh sửa Phiếu Nhập Kho ${po.inbound_transaction_code}` : "Đã vào kho"}
                                  className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/70 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800 inline-flex items-center gap-1 cursor-pointer transition-all"
                                >
                                  <span>{po.inbound_transaction_code || "Đã vào kho"}</span>
                                  {po.inbound_transaction_code && <Edit2 className="w-3 h-3 opacity-75" />}
                                </button>
                              )}

                              {/* Record Payment / Deposit */}
                              {po.status !== "CANCELLED" && (remainingAmt > 0 || totalAmt <= 0) && (
                                <button
                                  onClick={() => openPaymentModal(po, dbt.received <= 0.5 ? "deposit" : "full")}
                                  title={dbt.received <= 0.5 ? "Ghi nhận Chi cọc / Thanh toán trước cho NCC (PO chưa nhập kho)" : "Ghi nhận thanh toán công nợ NCC"}
                                  className={`px-2 py-1 rounded-lg text-[10px] font-bold inline-flex items-center gap-1 border transition-all cursor-pointer ${
                                    dbt.received <= 0.5
                                      ? "bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 hover:bg-purple-100"
                                      : "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100"
                                  }`}
                                >
                                  <DollarSign className="w-3.5 h-3.5" />
                                  <span>{dbt.received <= 0.5 ? "Chi cọc" : "Chi tiền"}</span>
                                </button>
                              )}

                              {/* Delete PO */}
                              <button
                                onClick={() => handleDeletePO(po)}
                                title="Xóa đơn hàng"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-800 transition-all cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <Pager p={ordersPage} unit="đơn đặt mua (PO)" />
          </>)}
        </div>
      )}

      {/* ========================================================= */}
      {/* SUBTAB 2: PURCHASE REQUESTS (PR)                          */}
      {/* ========================================================= */}
      {subTab === "pr" && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Luồng Đề Xuất Mua Hàng (Purchase Requests - PR)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Tiếp nhận yêu cầu mua vật tư, thiết bị phát sinh từ Kho & Vận Hành hoặc Kinh Doanh và chuyển đổi 1-click thành Đơn Đặt Mua (PO).
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
              <div className="shrink-0 flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs">
                {([["pr", "Theo phiếu PR"], ["lines", "Theo mặt hàng"]] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPRViewMode(mode)}
                    className={`px-3 py-1 rounded-lg font-semibold whitespace-nowrap cursor-pointer ${prViewMode === mode ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs" : "text-slate-600 dark:text-slate-400"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {prViewMode === "pr" && (
              <div className="relative shrink-0">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Tìm mã PR, sản phẩm, người gửi..."
                  value={prSearch}
                  onChange={(e) => setPRSearch(e.target.value)}
                  className="w-52 sm:w-60 pl-9 pr-3 py-1.5 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
              )}
              <button
                onClick={handleOpenNewPRModal}
                className="shrink-0 whitespace-nowrap flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 shadow-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Tạo PR Mới
              </button>
              <button
                onClick={() => {
                  setSelectedPRIdsForConsolidate([]);
                  setSelectedItemKeysForConsolidate([]);
                  const pendingPRs = purchaseRequests.filter(isPRConsolidatable);
                  setExpandedPRKeys(pendingPRs.map((pr) => pr.workflow_code || String(pr.id)));
                  if (suppliers.length > 0) setConsolidateSupplierId(suppliers[0].id);
                  setIsConsolidateModalOpen(true);
                }}
                className="shrink-0 whitespace-nowrap flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer transition-all"
                title="Gom các PR cùng Nhà cung cấp để lên 1 Đơn đặt mua (PO) tổng hợp (Yêu cầu 4)"
              >
                <PackageCheck className="w-3.5 h-3.5" />
                Gom PR Lên PO Tổng
              </button>
            </div>
          </div>

          {prViewMode === "lines" ? (
            <PRLineItemsView
              purchaseRequests={purchaseRequests}
              orders={orders}
              suppliers={suppliers}
              supplierProducts={allSupplierProducts}
              getPRItems={getPRItems}
              getItemPOInfo={getItemPOInfo}
              getItemInfo={getItemDemandInfo}
              onOpenPO={(po) => setSelectedPODetail(po)}
              onCreated={() => fetchData({ silent: true })}
              actorName={user?.full_name || user?.name || "Phòng Cung Ứng"}
            />
          ) : (<>
          {/* PR Filter Tabs */}
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs">
              <button
                type="button"
                onClick={() => setPRStatusFilter("all")}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                  prStatusFilter === "all"
                    ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs font-bold"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                Tất Cả ({prCounts.all})
              </button>
              <button
                type="button"
                onClick={() => setPRStatusFilter("pending")}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                  prStatusFilter === "pending"
                    ? "bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-xs font-bold"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                ⏳ Chờ Xử Lý ({prCounts.pending})
              </button>
              <button
                type="button"
                onClick={() => setPRStatusFilter("partial")}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                  prStatusFilter === "partial"
                    ? "bg-white dark:bg-slate-900 text-purple-600 dark:text-purple-400 shadow-xs font-bold"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                ⚡ Đã Chuyển PO 1 Phần ({prCounts.partial})
              </button>
              <button
                type="button"
                onClick={() => setPRStatusFilter("completed")}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                  prStatusFilter === "completed"
                    ? "bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs font-bold"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                ✅ Đã Hoàn Thành PO ({prCounts.completed})
              </button>
              {prCounts.closed > 0 && (
                <button
                  type="button"
                  onClick={() => setPRStatusFilter("closed")}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                    prStatusFilter === "closed"
                      ? "bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-xs font-bold"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  ⛔ Từ chối / Huỷ ({prCounts.closed})
                </button>
              )}
            </div>

            {/* Xuất Excel PR theo phân loại */}
            <div className="flex flex-wrap items-center gap-1.5 ml-auto">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mr-0.5">Xuất Excel PR (kèm mã hàng):</span>
              <button
                type="button"
                onClick={() => {
                  const q = normSearch(prSearch);
                  const list = purchaseRequests.filter(pr => !q || normSearch(`${pr.workflow_code || ""} ${pr.title || ""} ${pr.product_info || ""} ${pr.requester_name || ""} ${pr.description || ""}`).includes(q));
                  exportPRListExcel(list, "unconverted");
                }}
                title="Xuất Excel các dòng PR (kèm mã hàng) CHƯA tạo PO"
                className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 flex items-center gap-1 cursor-pointer transition-all"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>Chưa tạo PO</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const q = normSearch(prSearch);
                  const list = purchaseRequests.filter(pr => !q || normSearch(`${pr.workflow_code || ""} ${pr.title || ""} ${pr.product_info || ""} ${pr.requester_name || ""} ${pr.description || ""}`).includes(q));
                  exportPRListExcel(list, "converted");
                }}
                title="Xuất Excel các dòng PR (kèm mã hàng) ĐÃ chuyển thành PO"
                className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 flex items-center gap-1 cursor-pointer transition-all"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Đã chuyển PO</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const q = normSearch(prSearch);
                  const list = purchaseRequests.filter(pr => !q || normSearch(`${pr.workflow_code || ""} ${pr.title || ""} ${pr.product_info || ""} ${pr.requester_name || ""} ${pr.description || ""}`).includes(q));
                  exportPRListExcel(list, "all");
                }}
                title="Xuất Excel toàn bộ dòng PR tách 3 Sheet: 1. Chưa tạo PO | 2. Đã chuyển PO | 3. Tất cả"
                className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs flex items-center gap-1 cursor-pointer transition-all"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Tất cả (Tách Sheet)</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700">
                  <th className="py-3 px-3 w-[88px]">Mã Đề Xuất</th>
                  <th className="py-3 px-3 w-[105px]">Bộ Phận Yêu Cầu</th>
                  <th className="py-3 px-3 w-[34%] max-w-[380px]">Nội Dung / Mặt Hàng Đề Xuất</th>
                  <th className="py-3 px-3 text-center whitespace-nowrap w-[120px]">Ưu Tiên</th>
                  <th className="py-3 px-3 whitespace-nowrap w-[105px]">Hạn Cần Hàng</th>
                  <th className="py-3 px-3 text-center whitespace-nowrap w-[145px]">Trạng Thái PO</th>
                  <th className="py-3 px-3 text-center whitespace-nowrap w-[245px]">Thao Tác Xử Lý</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredPRs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      Không có đề xuất mua hàng nào trong danh sách
                    </td>
                  </tr>
                ) : (
                  prsPage.items.map((pr) => {
                    const summary = getPRPOSummary(pr);
                    return (
                      <tr key={pr.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="py-3.5 px-3 font-mono font-bold text-indigo-600 dark:text-indigo-400 w-[88px]">
                          <button
                            onClick={() => setSelectedPRDetail(pr)}
                            className="hover:underline flex items-center gap-1 cursor-pointer text-left"
                            title="Bấm để xem chi tiết đề xuất mua hàng & trạng thái từng mã hàng"
                          >
                            <FileText className="w-3.5 h-3.5 shrink-0" />
                            <span>{pr.workflow_code}</span>
                          </button>
                        </td>
                        <td className="py-3.5 px-3 w-[105px]">
                          {(() => {
                            const isStockPR = Boolean(
                              (pr.workflow_code && pr.workflow_code.includes("STOCK")) ||
                              (pr.title && (pr.title.includes("STOCK") || pr.title.includes("LƯU TRỮ") || pr.title.includes("DỰ PHÒNG"))) ||
                              pr.customer_name === "STOCK"
                            );
                            const displayRequester = isStockPR
                              ? "Bộ Phận Kho Vận"
                              : (pr.requester_name === "Nguyễn Đăng Khánh" ? "Phòng Kinh Doanh" : (pr.requester_name || "Phòng Kinh Doanh"));
                            const displayDept = isStockPR ? "Kho Vận" : (pr.requester_dept || "Kinh Doanh");
                            return (
                              <>
                                <div className="font-bold text-slate-900 dark:text-white">{displayRequester}</div>
                                <div className="text-[10px] text-slate-500">{displayDept}</div>
                              </>
                            );
                          })()}
                        </td>
                        <td className="py-3.5 px-3 w-[34%] max-w-[380px]">
                          <div className="font-bold text-slate-900 dark:text-white">
                            <button
                              type="button"
                              onClick={() => setSelectedPRDetail(pr)}
                              className="text-left hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline cursor-pointer"
                              title="Bấm để mở xem chi tiết đầy đủ đề xuất này"
                            >
                              {pr.title}
                            </button>
                          </div>
                          {(() => {
                            const itemsList = getPRItems(pr);
                            if (itemsList.length === 1 && itemsList[0]?.is_missing_catalog_product) {
                              return (
                                <div className="mt-1.5 flex items-center flex-wrap gap-2">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                                    <AlertTriangle className="w-3 h-3 text-rose-500 shrink-0" />
                                    Chưa có Mã & Tên sản phẩm trong Bảng mã sản xuất
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleEditPR(pr);
                                    }}
                                    className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                                  >
                                    + Chọn Mã SP ngay ↗
                                  </button>
                                </div>
                              );
                            }

                            const isExpanded = !!expandedPRIds[pr.id];

                            if (itemsList.length === 1) {
                              const it = itemsList[0];
                              const itemPO = getItemPOInfo(pr, it, 0);
                              return (
                                <div className="mt-1 flex items-center flex-wrap gap-1.5 text-[11px]">
                                  <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/70 px-1.5 py-0.5 rounded text-[10px]">
                                    {it.product_code || "MÃ MỚI"}
                                  </span>
                                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                                    {it.product_name}
                                  </span>
                                  {it.specification && (
                                    <span className="text-slate-500 dark:text-slate-400 text-[10px] italic">
                                      ({it.specification})
                                    </span>
                                  )}
                                  <span className="font-bold text-orange-600 dark:text-orange-400 font-mono text-[11px]">
                                    SL: {it.quantity} {it.unit || "Cái"}
                                  </span>
                                  {/* Line-item PO Tag */}
                                  {itemPO.hasPO ? (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (itemPO.linkedPO) setSelectedPODetail(itemPO.linkedPO);
                                      }}
                                      className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 flex items-center gap-1 cursor-pointer"
                                      title={`Mã hàng này đã tạo trong đơn PO ${itemPO.poCode}. Bấm để xem chi tiết đơn PO`}
                                    >
                                      <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                                      <span>PO: {itemPO.poCode}</span>
                                    </button>
                                  ) : (
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 flex items-center gap-1">
                                      <Clock className="w-3 h-3 text-amber-500 shrink-0" />
                                      <span>Chưa tạo PO</span>
                                    </span>
                                  )}
                                </div>
                              );
                            }

                            // Multiple items (> 1)
                            if (!isExpanded) {
                              const it0 = itemsList[0];
                              return (
                                <div className="mt-1 space-y-1">
                                  <div className="flex items-center flex-wrap gap-1.5 text-[11px]">
                                    <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/70 px-1.5 py-0.5 rounded text-[10px]">
                                      {it0.product_code || "MÃ MỚI"}
                                    </span>
                                    <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[220px]">
                                      {it0.product_name}
                                    </span>
                                    <span className="font-bold text-orange-600 dark:text-orange-400 font-mono text-[11px]">
                                      SL: {it0.quantity} {it0.unit || "Cái"}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleExpandPR(pr.id);
                                      }}
                                      className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/70 hover:bg-indigo-100 dark:hover:bg-indigo-900/70 px-2 py-0.5 rounded-md border border-indigo-200 dark:border-indigo-800 transition-colors cursor-pointer"
                                      title="Bấm để xem đầy đủ toàn bộ danh mục mặt hàng đề xuất"
                                    >
                                      <ChevronDown className="w-3 h-3" />
                                      <span>+{itemsList.length - 1} mặt hàng khác (Bấm xem đầy đủ)</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedPRDetail(pr);
                                      }}
                                      className="text-[10px] text-slate-400 hover:text-indigo-600 hover:underline cursor-pointer"
                                    >
                                      Chi tiết PR ↗
                                    </button>
                                  </div>
                                </div>
                              );
                            }

                            // isExpanded === true
                            return (
                              <div className="space-y-1.5 mt-1.5">
                                {itemsList.map((it: any, idx: number) => {
                                  const itemPO = getItemPOInfo(pr, it, idx);
                                  return (
                                    <div
                                      key={idx}
                                      className="flex items-center flex-wrap gap-1.5 text-[11px] bg-slate-50 dark:bg-slate-800/60 p-1.5 rounded-lg border border-slate-200/60 dark:border-slate-700/60"
                                    >
                                      <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/70 px-1.5 py-0.5 rounded text-[10px]">
                                        {it.product_code || "MÃ MỚI"}
                                      </span>
                                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                                        {it.product_name}
                                      </span>
                                      {it.specification && (
                                        <span className="text-slate-500 dark:text-slate-400 text-[10px] bg-white dark:bg-slate-900 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                                          Qui cách: {it.specification}
                                        </span>
                                      )}
                                      <span className="font-bold text-orange-600 dark:text-orange-400 font-mono text-[11px]">
                                        SL: {it.quantity} {it.unit || "Cái"}
                                      </span>
                                      {/* Line-item PO Tag */}
                                      {itemPO.hasPO ? (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (itemPO.linkedPO) setSelectedPODetail(itemPO.linkedPO);
                                          }}
                                          className="ml-auto font-mono text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/90 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 hover:bg-emerald-200 flex items-center gap-1 cursor-pointer"
                                          title={`Mã hàng này đã tạo trong đơn PO ${itemPO.poCode}. Bấm để xem chi tiết đơn PO`}
                                        >
                                          <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                                          <span>PO: {itemPO.poCode}</span>
                                        </button>
                                      ) : (
                                        <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 flex items-center gap-1">
                                          <Clock className="w-3 h-3 text-amber-500 shrink-0" />
                                          <span>Chưa tạo PO</span>
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                                <div className="pt-0.5">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleExpandPR(pr.id);
                                    }}
                                    className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-2 py-0.5 rounded-md transition-colors cursor-pointer"
                                  >
                                    <ChevronUp className="w-3 h-3" />
                                    <span>Thu gọn danh mục ({itemsList.length} mặt hàng)</span>
                                  </button>
                                </div>
                              </div>
                            );
                          })()}
                          {pr.description && (
                            <div className="text-[10px] text-slate-400 truncate mt-1">
                              Lý do: {pr.description}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-3 text-center whitespace-nowrap w-[120px]">
                          <span className={`inline-block whitespace-nowrap px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            pr.priority === "URGENT"
                              ? "bg-rose-50 text-rose-700 border border-rose-200"
                              : pr.priority === "HIGH"
                              ? "bg-amber-50 text-amber-700 border border-amber-200"
                              : "bg-blue-50 text-blue-700 border border-blue-200"
                          }`}>
                            {pr.priority === "URGENT" ? "Khẩn cấp" : pr.priority === "HIGH" ? "Ưu tiên cao" : "Bình thường"}
                          </span>
                        </td>
                        <td className="py-3.5 px-3 text-slate-500 whitespace-nowrap w-[105px]">
                          {formatDate(pr.due_date)}
                        </td>
                        <td className="py-3.5 px-3 text-center whitespace-nowrap w-[145px]">
                          {pr.status === "CANCELLED" || pr.status === "REJECTED" ? (
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-400 border border-rose-200 flex items-center gap-1 justify-center">
                              <XCircle className="w-3 h-3 text-rose-500" />
                              <span>Đã Hủy</span>
                            </span>
                          ) : summary.isFullyConverted ? (
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200 flex items-center gap-1 justify-center">
                              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                              <span>Đã Hoàn Thành PO</span>
                            </span>
                          ) : summary.isPartiallyConverted ? (
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-200 flex items-center gap-1 justify-center" title={`${summary.convertedCount}/${summary.totalItems} mặt hàng đã lập PO`}>
                              <Sparkles className="w-3 h-3 text-purple-500" />
                              <span>Đã Chuyển PO 1 Phần ({summary.convertedCount}/{summary.totalItems})</span>
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center gap-1 justify-center">
                              <Clock className="w-3 h-3 text-slate-400" />
                              <span>Chờ Xử Lý</span>
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-2.5 text-center whitespace-nowrap w-[245px]">
                          {pr.status === "CANCELLED" || pr.status === "REJECTED" ? (
                            <span className="text-xs text-slate-400 italic">Đề xuất đã hủy</span>
                          ) : summary.isFullyConverted ? (
                            summary.linkedPOs.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => setSelectedPODetail(summary.linkedPOs[0])}
                                className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900 shadow-xs inline-flex items-center gap-1.5 mx-auto cursor-pointer transition-colors max-w-[230px]"
                                title={`Đề xuất đã lập đơn PO: ${summary.poCodes.join(", ")}. Bấm để xem chi tiết`}
                              >
                                <Eye className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                <span className="truncate">
                                  Xem PO ({summary.poCodes.length > 1 ? `${summary.poCodes[0]} +${summary.poCodes.length - 1}` : summary.poCodes[0]})
                                </span>
                              </button>
                            ) : (
                              <span className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 mx-auto">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                <span>Đã Lập Đủ PO</span>
                              </span>
                            )
                          ) : summary.isPartiallyConverted ? (
                            <div className="flex flex-col items-center gap-1.5">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleConvertPRToPO(pr)}
                                  className="px-3 py-1.5 rounded-xl text-xs font-bold bg-orange-600 text-white hover:bg-orange-700 shadow-xs flex items-center gap-1.5 cursor-pointer transition-colors"
                                  title={`Còn ${summary.pendingCount} mặt hàng chưa tạo PO. Bấm để lập đơn PO`}
                                >
                                  <ShoppingCart className="w-3.5 h-3.5" /> Lên PO ({summary.pendingCount} mã)
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleEditPR(pr)}
                                  className="px-2 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-amber-50 hover:text-amber-700 border border-slate-200 dark:border-slate-700 cursor-pointer transition-colors"
                                  title="Chỉnh sửa nội dung đề xuất PR"
                                >
                                  ✏️ Sửa
                                </button>
                              </div>
                              {summary.linkedPOs.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setSelectedPODetail(summary.linkedPOs[0])}
                                  className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer font-mono font-medium"
                                  title="Bấm để xem đơn PO đã lập trước đó"
                                >
                                  <Eye className="w-3 h-3" /> Đã có: {summary.poCodes.join(", ")}
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleConvertPRToPO(pr)}
                                className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-orange-600 text-white hover:bg-orange-700 shadow-xs flex items-center gap-1 cursor-pointer transition-colors"
                              >
                                <ShoppingCart className="w-3 h-3 shrink-0" /> Chuyển Thành PO
                              </button>
                              <button
                                type="button"
                                onClick={() => handleEditPR(pr)}
                                className="px-2 py-1.5 rounded-xl text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-amber-50 hover:text-amber-700 border border-slate-200 dark:border-slate-700 cursor-pointer transition-colors"
                                title="Sửa số lượng, mặt hàng hoặc hạn cần của PR"
                              >
                                ✏️ Sửa
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCancelPR(pr)}
                                className="px-2 py-1.5 rounded-xl text-[11px] font-semibold bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 hover:bg-rose-100 border border-rose-200 dark:border-rose-800 cursor-pointer transition-colors"
                                title="Hủy đề xuất mua hàng này"
                              >
                                Hủy
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            <Pager p={prsPage} unit="đề xuất mua hàng (PR)" />
          </div>
          </>)}
        </div>
      )}

      {/* ========================================================= */}
      {/* SUBTAB 3: SUPPLIERS DIRECTORY & RATINGS                   */}
      {/* ========================================================= */}
      {subTab === "suppliers" && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Hồ Sơ & Đánh Giá Các Nhà Cung Cấp / Hãng Sản Xuất
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Quản lý các hãng thiết bị PCR, sinh phẩm tách chiết, vật tư tiêu hao và đối tác thương mại của TBR.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Tìm NCC, mã, người liên hệ..."
                  value={supplierSearch}
                  onChange={(e) => setSupplierSearch(e.target.value)}
                  className="pl-9 pr-4 py-1.5 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <button
                type="button"
                onClick={handleSyncSuppliersFromCatalog}
                disabled={isSyncingCatalogSuppliers}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-colors cursor-pointer disabled:opacity-50"
                title="Tự động đồng bộ Nhà cung cấp / Hãng sản xuất và Danh mục hàng & Giá mua từ Danh mục sản phẩm"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 ${isSyncingCatalogSuppliers ? "animate-spin" : ""}`} />
                {isSyncingCatalogSuppliers ? "Đang đồng bộ..." : "Đồng Bộ Từ Danh Mục HH"}
              </button>

              <button
                type="button"
                onClick={handleDownloadSupplierTemplate}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                title="Tải file mẫu Excel danh mục Nhà Cung Cấp"
              >
                <Download className="w-3.5 h-3.5 text-blue-500" /> Tải Mẫu Excel
              </button>

              <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-colors cursor-pointer">
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> Nạp Excel NCC
                <input
                  ref={supplierFileInputRef}
                  type="file"
                  accept=".xlsx, .xls, .csv"
                  onChange={handleSupplierExcelUpload}
                  className="hidden"
                />
              </label>

              <button
                onClick={() => {
                  setSupplierForm({
                    id: null,
                    supplier_code: `NCC-TBR-${Date.now().toString().slice(-4)}`,
                    name: "",
                    short_name: "",
                    contact_person: "",
                    phone: "",
                    email: "",
                    address: "",
                    product_lines: "",
                    payment_terms: "Công nợ 30 ngày",
                    rating: 5
                  });
                  setIsSupplierModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-orange-600 text-white hover:bg-orange-700 shadow-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Thêm NCC Mới
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700">
                  <th className="py-3 px-4">Mã NCC</th>
                  <th className="py-3 px-4">Tên Nhà Cung Cấp / Đại Diện</th>
                  <th className="py-3 px-4">Đại Diện Liên Hệ</th>
                  <th className="py-3 px-4">Ngành Hàng Cung Ứng</th>
                  <th className="py-3 px-4">Điều Khoản Thanh Toán</th>
                  <th className="py-3 px-4 text-center">Doanh Số Đã Đặt</th>
                  <th className="py-3 px-4 text-center">Đánh Giá</th>
                  <th className="py-3 px-4 text-center">Thao Tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {suppliersPage.items.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-bold text-orange-600 dark:text-orange-400">{s.supplier_code}</td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 dark:text-white text-sm">{s.name}</span>
                        {s.short_name && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-orange-100 dark:bg-orange-950/80 text-orange-700 dark:text-orange-300 border border-orange-300 dark:border-orange-800" title="Tên viết tắt trên báo giá">
                            🏷️ {s.short_name}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{s.address}</div>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => handleOpenSupplierCatalog(s)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900 border border-indigo-200 dark:border-indigo-800 transition-all cursor-pointer shadow-2xs hover:scale-[1.02]"
                          title="Xem danh mục hàng hóa, bảng giá mua & lịch sử điều chỉnh giá"
                        >
                          <Package className="w-3.5 h-3.5 text-indigo-500" />
                          <span>Danh mục hàng & Giá mua</span>
                          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-indigo-200/80 dark:bg-indigo-800 text-indigo-800 dark:text-indigo-200 font-mono font-bold">
                            {s.product_count || 0} SP
                          </span>
                        </button>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">{s.contact_person}</div>
                      <div className="text-[10px] text-slate-400">{s.phone} • {s.email}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium">
                        {s.product_lines}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-600 dark:text-slate-400">{s.payment_terms}</td>
                    <td className="py-3.5 px-4 text-center">
                      <div className="font-mono font-bold text-slate-900 dark:text-white">
                        {formatCurrency(s.total_spend || 0)}
                      </div>
                      <div className="text-[10px] text-slate-400">{s.order_count || 0} đơn PO</div>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <div className="font-bold text-amber-500 text-sm">
                        {"★".repeat(s.rating || 5)}
                      </div>
                      <div className="text-[10px] text-slate-400">{s.rating || 5}/5 sao</div>
                    </td>
                    <td className="py-3.5 px-4 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenSupplierCatalog(s)}
                          className="p-1.5 rounded-lg text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-slate-800 transition-all cursor-pointer"
                          title="Xem danh mục hàng & giá mua NCC"
                        >
                          <Package className="w-3.5 h-3.5 text-indigo-500" />
                        </button>
                        <button
                          onClick={() => {
                            setSupplierForm({ ...s });
                            setIsSupplierModalOpen(true);
                          }}
                          className="p-1.5 rounded-lg text-slate-600 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-slate-800 transition-all cursor-pointer"
                          title="Sửa thông tin NCC"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteSupplier(s)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-800 transition-all cursor-pointer"
                          title="Xóa NCC"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager p={suppliersPage} unit="nhà cung cấp" />
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* SUBTAB 4: ACCOUNTS PAYABLE (CÔNG NỢ NCC)                  */}
      {/* ========================================================= */}
      {subTab === "payables" && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Theo Dõi & Quản Lý Công Nợ Nhà Cung Cấp
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Ghi nhận các khoản thanh toán, theo dõi thời hạn tín dụng (payment terms) và tiến độ chi trả tiền hàng.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPayableFilter("all")}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
                  payableFilter === "all" ? "bg-orange-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600"
                }`}
              >
                Tất cả đơn PO
              </button>
              <button
                onClick={() => setPayableFilter("debt")}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
                  payableFilter === "debt" ? "bg-rose-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600"
                }`}
              >
                Còn nợ phải trả ({orders.filter(o => String(o.status || "").toUpperCase() !== "CANCELLED" && poDebt(o).payable > 0.5).length})
              </button>
              <button
                onClick={() => setPayableFilter("prepaid")}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
                  payableFilter === "prepaid" ? "bg-purple-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600"
                }`}
              >
                💜 Đã đặt cọc / Trả trước ({orders.filter(o => String(o.status || "").toUpperCase() !== "CANCELLED" && poDebt(o).prepaid > 0.5).length})
              </button>
              <button
                onClick={() => setPayableFilter("paid")}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
                  payableFilter === "paid" ? "bg-emerald-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600"
                }`}
              >
                Đã tất toán xong
              </button>
            </div>
          </div>

          {/* Bộ lọc: NCC, thời gian đặt, mã PO / mã hàng */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={payableSupplier}
              onChange={(e) => setPayableSupplier(e.target.value)}
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white max-w-[260px]"
            >
              <option value="all">-- Tất cả NCC --</option>
              {payableSuppliers.map(sn => <option key={sn} value={sn}>{sn}</option>)}
            </select>
            <label className="flex items-center gap-1 text-slate-500">Từ
              <DateInputVN value={payableFrom} onChange={(e) => setPayableFrom(e.target.value)} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
            </label>
            <label className="flex items-center gap-1 text-slate-500">Đến
              <DateInputVN value={payableTo} onChange={(e) => setPayableTo(e.target.value)} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
            </label>
            <input
              value={payableSearch}
              onChange={(e) => setPayableSearch(e.target.value)}
              placeholder="Mã PO, tên NCC, mã hàng..."
              className="flex-1 min-w-[180px] p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            />
            {(payableSupplier !== "all" || payableFrom || payableTo || payableSearch) && (
              <button type="button" onClick={() => { setPayableSupplier("all"); setPayableFrom(""); setPayableTo(""); setPayableSearch(""); }} className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer">
                Xóa lọc
              </button>
            )}
          </div>

          {(() => {
            const sel = filteredPayables.filter(po => selectedPayPOs.includes(po.id));
            const sum = filteredPayables.reduce((acc, po) => {
              const d = poDebt(po);
              return { total: acc.total + d.total, received: acc.received + d.received, paid: acc.paid + d.paid, remaining: acc.remaining + d.payable, prepaid: acc.prepaid + d.prepaid };
            }, { total: 0, received: 0, paid: 0, remaining: 0, prepaid: 0 });
            return (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                <div className="flex flex-wrap gap-4">
                  <span>Tổng PO: <b className="font-mono">{formatCurrency(sum.total)}</b></span>
                  <span title="Giá trị phần hàng đã nhập kho">Đã nhận: <b className="font-mono">{formatCurrency(sum.received)}</b></span>
                  <span>Đã trả: <b className="font-mono text-emerald-600">{formatCurrency(sum.paid)}</b></span>
                  <span title="Phần hàng đã nhận chưa trả tiền">Còn nợ: <b className="font-mono text-rose-600">{formatCurrency(sum.remaining)}</b></span>
                  {sum.prepaid > 0.5 && <span title="Đã chi vượt giá trị hàng đã nhận (đặt cọc / trả trước)">Trả trước: <b className="font-mono text-violet-600">{formatCurrency(sum.prepaid)}</b></span>}
                </div>
                <button
                  type="button"
                  disabled={sel.length === 0}
                  onClick={() => openMultiPaymentModal(sel)}
                  className="px-3 py-1.5 rounded-xl font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 cursor-pointer flex items-center gap-1.5"
                  title="Chọn các PO cùng nhà cung cấp ở cột đầu để chi chung một phiếu"
                >
                  <DollarSign className="w-3.5 h-3.5" /> Chi tiền cho {sel.length} PO đã chọn
                </button>
              </div>
            );
          })()}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700">
                  <th className="py-3 px-2 w-8"></th>
                  <th className="py-3 px-2.5">Mã PO / Ngày Đặt</th>
                  <th className="py-3 px-2.5">Nhà Cung Cấp &amp; HĐ</th>
                  <th className="py-3 px-2.5 text-right">Tổng Tiền PO</th>
                  <th className="py-3 px-2.5 text-right" title="Giá trị phần hàng đã nhập kho — công nợ phát sinh trên phần này">Giá Trị Đã Nhận</th>
                  <th className="py-3 px-2.5 text-right">Đã Thanh Toán</th>
                  <th className="py-3 px-2.5 text-right">Còn Nợ Phải Trả</th>
                  <th className="py-3 px-2.5 text-center">Trạng Thái</th>
                  <th className="py-3 px-2.5 text-center">Thao Tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredPayables.length === 0 && (
                  <tr><td colSpan={9} className="py-8 text-center text-slate-400">Không có PO nào phù hợp bộ lọc.</td></tr>
                )}
                {payablesPage.items.map((po) => {
                  const dbt = poDebt(po);
                  const total = dbt.total;
                  const paid = dbt.paid;
                  const remaining = dbt.payable;
                  // Vẫn chi được khi chưa trả đủ tổng PO (gồm cả đặt cọc / trả trước khi hàng chưa về)
                  const isPaid = !dbt.canPay;
                  const badge = DEBT_BADGE[dbt.status] || DEBT_BADGE.NOT_INCURRED;
                  const checked = selectedPayPOs.includes(po.id);
                  let invs: any[] = po.supplier_invoices;
                  if (typeof invs === "string") { try { invs = JSON.parse(invs); } catch { invs = []; } }
                  invs = Array.isArray(invs) ? invs : [];

                  return (
                    <tr key={po.id} className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors ${checked ? "bg-emerald-50/60 dark:bg-emerald-950/20" : ""}`}>
                      <td className="py-3 px-2 text-center">
                        {!isPaid && (
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => setSelectedPayPOs(prev => e.target.checked ? [...prev, po.id] : prev.filter(x => x !== po.id))}
                            className="w-4 h-4 accent-emerald-600 cursor-pointer"
                          />
                        )}
                      </td>
                      <td className="py-3 px-2.5 whitespace-nowrap">
                        <div className="font-mono font-bold text-orange-600 dark:text-orange-400">{po.po_code}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">📅 {formatDate(po.order_date)}</div>
                      </td>
                      <td className="py-3 px-2.5">
                        <div className="font-bold text-slate-900 dark:text-white">{po.supplier_name}</div>
                        {invs.length > 0 && (
                          <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                            🧾 HĐ: {invs.map((iv: any) => iv.invoice_no).filter(Boolean).join(", ")}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-2.5 font-mono font-bold text-right text-slate-900 dark:text-white whitespace-nowrap">
                        <div>{formatCurrency(total)}</div>
                        {dbt.inboundTotalPoValue > 0 && dbt.hasInboundPriceDiff && (
                          <div className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 mt-0.5" title="Tổng giá trị tính theo đơn giá trên Phiếu Nhập Kho (PNK)">
                            Theo PNK: {formatCurrency(dbt.inboundTotalPoValue)}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-2.5 font-mono text-right text-slate-700 dark:text-slate-200 whitespace-nowrap" title={dbt.unreceived > 0.5 ? `Chưa nhận: ${formatCurrency(dbt.unreceived)}` : "Đã nhận đủ hàng"}>
                        <div>{formatCurrency(dbt.received)}</div>
                        {dbt.inboundReceivedValue > 0 && (
                          <div
                            className={`text-[10px] font-semibold mt-0.5 ${
                              Math.abs(dbt.inboundReceivedValue - dbt.received) > 0.5
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-teal-600 dark:text-teal-400"
                            }`}
                            title="Giá trị hàng đã nhập kho tính theo đơn giá trên Phiếu Nhập Kho (PNK) để Kế toán đối chiếu"
                          >
                            Giá PNK: {formatCurrency(dbt.inboundReceivedValue)}
                          </div>
                        )}
                        {dbt.unreceived > 0.5 && dbt.received > 0.5 && <div className="text-[9px] text-slate-400">chưa nhận {formatCurrency(dbt.unreceived)}</div>}
                      </td>
                      <td className="py-3 px-2.5 font-mono font-bold text-right text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                        {formatCurrency(paid)}
                      </td>
                      <td className="py-3 px-2.5 font-mono font-bold text-right text-rose-600 dark:text-rose-400 whitespace-nowrap">
                        {remaining > 0.5 ? formatCurrency(remaining) : <span className="text-slate-400 font-normal">—</span>}
                        {dbt.prepaid > 0.5 && <div className="text-[9px] text-violet-600 font-normal">trả trước {formatCurrency(dbt.prepaid)}</div>}
                      </td>
                      <td className="py-3 px-2.5 text-center whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${badge.cls}`}>
                          {badge.label}
                        </span>
                        {dbt.hasInboundPriceDiff && (
                          <div className="mt-1">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800" title="Đơn giá nhập kho (PNK) khác với đơn giá PO">
                              ⚠️ Lệch giá PNK
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-2.5 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                          {!isPaid && (
                            <button
                              onClick={() => openPaymentModal(po)}
                              className="px-3 py-1 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs flex items-center gap-1.5 cursor-pointer"
                            >
                              <DollarSign className="w-3.5 h-3.5" /> Chi tiền
                            </button>
                          )}
                          {(dbt.hasInboundPriceDiff || total <= 0.5) && (
                            <button
                              onClick={() => handleEditPO(po)}
                              className="px-2.5 py-1 rounded-xl text-xs font-bold bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 cursor-pointer"
                              title="Mở đơn PO để đối chiếu Giá Nhập Kho (PNK) và điều chỉnh Giá PO nếu cần"
                            >
                              ✏️ Điều chỉnh PO
                            </button>
                          )}
                          {paid > 0 && (
                            <button
                              onClick={() => { setPaymentHistoryPO(po); fetchPoPayments(); }}
                              className="px-2.5 py-1 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                              title="Xem / sửa / hủy các khoản đã chi"
                            >
                              Lịch sử chi
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pager p={payablesPage} unit="đơn công nợ PO" />
          </div>
        </div>
      )}

      {/* Sửa số hóa đơn / ngày hóa đơn đầu vào của PO */}
      {invoiceEditPO && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-2xl w-full p-5 sm:p-6 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Hóa đơn đầu vào — <span className="font-mono text-orange-600">{invoiceEditPO.po_code}</span>
              </h3>
              <button onClick={() => setInvoiceEditPO(null)} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-2">
              {invoiceEditRows.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={r.invoice_no}
                    onChange={(e) => setInvoiceEditRows(prev => prev.map((x, k) => k === i ? { ...x, invoice_no: e.target.value } : x))}
                    placeholder="Số hóa đơn"
                    className="flex-1 p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                  />
                  <DateInputVN
                    value={r.invoice_date}
                    onChange={(e) => setInvoiceEditRows(prev => prev.map((x, k) => k === i ? { ...x, invoice_date: e.target.value } : x))}
                    className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                  <button type="button" onClick={() => setInvoiceEditRows(prev => prev.filter((_, k) => k !== i))} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 cursor-pointer" title="Bỏ dòng này">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setInvoiceEditRows(prev => [...prev, { invoice_no: "", invoice_date: todayVN() }])} className="text-[11px] font-bold text-orange-600 dark:text-orange-400 hover:underline cursor-pointer">
                + Thêm hóa đơn (PO giao nhiều đợt)
              </button>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button onClick={() => setInvoiceEditPO(null)} className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer">Hủy</button>
              <button onClick={saveInvoiceEditor} className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer">Lưu hóa đơn</button>
            </div>
          </div>
        </div>
      )}

      {/* Lịch sử chi tiền của một PO: sửa (= hủy + ghi lại) hoặc hủy khoản chi */}
      {paymentHistoryPO && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-3xl w-full p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Lịch sử chi tiền — <span className="font-mono text-orange-600">{paymentHistoryPO.po_code}</span> · {paymentHistoryPO.supplier_name}
              </h3>
              <button onClick={() => setPaymentHistoryPO(null)} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-slate-500">
                  <tr>
                    <th className="p-1.5">Ngày chi</th>
                    <th className="p-1.5 text-right">Số tiền</th>
                    <th className="p-1.5">Phương thức</th>
                    <th className="p-1.5">Phiếu chi / UNC</th>
                    <th className="p-1.5">Người ghi</th>
                    <th className="p-1.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {poPayments.filter(pp => pp.po_id === paymentHistoryPO.id).length === 0 && (
                    <tr><td colSpan={6} className="p-4 text-center text-slate-400">Chưa có khoản chi nào được ghi trong sổ (khoản chi cũ chỉ còn trong ghi chú PO).</td></tr>
                  )}
                  {poPayments.filter(pp => pp.po_id === paymentHistoryPO.id).map(pp => (
                    <tr key={pp.id} className={pp.voided_at ? "opacity-50 line-through" : ""}>
                      <td className="p-1.5 font-mono">{formatDate(pp.payment_date)}</td>
                      <td className="p-1.5 text-right font-mono font-bold">{formatCurrency(Number(pp.amount) || 0)}</td>
                      <td className="p-1.5">{pp.method}</td>
                      <td className="p-1.5 font-mono">{[pp.voucher_code, pp.reference_doc].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="p-1.5">{pp.created_by || ""}</td>
                      <td className="p-1.5 text-right whitespace-nowrap no-underline">
                        {pp.voided_at ? (
                          <span className="text-[10px] text-rose-500" title={pp.void_reason || ""}>Đã hủy ({pp.voided_by})</span>
                        ) : (
                          <span className="inline-flex gap-1">
                            <button onClick={() => handleVoidPayment(pp, true)} className="px-2 py-0.5 rounded bg-sky-600 text-white font-bold cursor-pointer">Sửa</button>
                            <button onClick={() => handleVoidPayment(pp, false)} className="px-2 py-0.5 rounded bg-rose-600 text-white font-bold cursor-pointer">Hủy</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-400">Sửa = hủy khoản chi cũ (giữ lại lịch sử) rồi nhập lại khoản đúng. Công nợ PO được tính lại ngay.</p>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* SUBTAB 5: RESTOCK ALERTS & NEAR-EXPIRY ALERTS             */}
      {/* ========================================================= */}
      {subTab === "restock" && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          {/* Sub-view Switcher: Restock vs Near-Expiry (Issue 7) */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setAlertSubView("restock")}
                className={`px-3.5 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  alertSubView === "restock"
                    ? "bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>⚠️ Cảnh Báo Tồn Thiếu (Restock)</span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400">
                  {enrichedRestockAlerts.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setAlertSubView("near_expiry")}
                className={`px-3.5 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  alertSubView === "near_expiry"
                    ? "bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>⏳ Cảnh Báo Cận Date / Hết Hạn (≤ 180 ngày)</span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-400">
                  {nearExpiryAlerts.length}
                </span>
              </button>
            </div>
          </div>

          {alertSubView === "restock" ? (
            <>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="w-4 h-4" />
                    Cảnh Báo Tồn Kho Dưới Định Mức & Gợi Ý Bổ Sung (Restock)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Tự động đối chiếu Nhà Cung Cấp / Hãng sản xuất và đơn giá mua từ Bảng giá NCC & Danh mục hàng hóa. Lọc theo hãng để gom đơn PO 1-click.
                  </p>
                </div>

                {/* Supplier Filter + Search + Bulk PO Button (Issue 2 & Bug 4f) */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={restockSearch}
                      onChange={(e) => setRestockSearch(e.target.value)}
                      placeholder="Tìm mã SP, tên SP, hãng..."
                      className="pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                    />
                  </div>
                  <select
                    value={restockSupplierFilter}
                    onChange={(e) => setRestockSupplierFilter(e.target.value)}
                    className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold cursor-pointer max-w-[260px]"
                  >
                    <option value="all">-- Tất cả Nhà Cung Cấp / Hãng ({enrichedRestockAlerts.length}) --</option>
                    {restockSupplierOptions.map((supName) => (
                      <option key={supName} value={supName}>
                        {supName}
                      </option>
                    ))}
                  </select>
                  {filteredRestockAlerts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => handleBulkRestockBySupplier(filteredRestockAlerts)}
                      className="px-3 py-1.5 rounded-xl font-bold bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs flex items-center gap-1.5 cursor-pointer"
                      title="Gom toàn bộ các mặt hàng đang lọc vào 1 Đơn Đặt Mua (PO) theo đúng NCC và đơn giá"
                    >
                      <ShoppingCart className="w-3.5 h-3.5" />
                      <span>+ Lập PO Gom Theo NCC Đang Lọc ({filteredRestockAlerts.length})</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700">
                      <th className="py-3 px-4">Mã Sản Phẩm</th>
                      <th className="py-3 px-4">Tên Hàng Hóa / Sinh Phẩm</th>
                      <th className="py-3 px-4">Vị Trí Lưu Kho</th>
                      <th className="py-3 px-4 text-center">Tồn Hiện Tại</th>
                      <th className="py-3 px-4 text-center">Định Mức Tối Thiểu</th>
                      <th className="py-3 px-4 text-center">Trạng Thái Thiếu</th>
                      <th className="py-3 px-4">Nhà Cung Cấp / Hãng Đề Xuất</th>
                      <th className="py-3 px-4 text-right">Đơn Giá Nhập Ước Tính</th>
                      <th className="py-3 px-4 text-center">Thao Tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredRestockAlerts.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-slate-400">
                          Không có sản phẩm tồn thiếu nào phù hợp với bộ lọc hiện tại!
                        </td>
                      </tr>
                    ) : (
                      filteredRestockAlerts.map((item) => (
                        <tr key={item.id || item.product_code} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-3.5 px-4 font-mono font-bold text-orange-600 dark:text-orange-400">{item.product_code}</td>
                          <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white">
                            {item.product_name}
                          </td>
                          <td className="py-3.5 px-4 text-slate-500">{item.warehouse_location}</td>
                          <td className="py-3.5 px-4 text-center font-mono font-black text-rose-600 dark:text-rose-400 text-sm">
                            {item.quantity_on_hand} {item.unit || "Cái"}
                          </td>
                          <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-500">
                            {item.min_stock_level} {item.unit || "Cái"}
                          </td>
                          <td className="py-3.5 px-4 text-center whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border border-amber-200">
                              ⚠️ Chạm ngưỡng Min
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300 font-semibold">
                            <div className="flex items-center gap-1.5">
                              <Building2 className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                              <span>{item.resolved_supplier_name || item.manufacturer || "Chưa gán NCC"}</span>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                            {item.resolved_unit_price > 0 ? (
                              formatCurrency(item.resolved_unit_price)
                            ) : (
                              <span className="text-slate-400 text-[11px] font-normal italic">Theo báo giá NCC</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-center whitespace-nowrap">
                            <button
                              onClick={() => handleRestockToPO(item)}
                              className="px-3 py-1 rounded-xl text-xs font-bold bg-orange-600 text-white hover:bg-orange-700 shadow-xs flex items-center gap-1.5 mx-auto cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" /> Lập PO Mua Bổ Sung
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            /* SUB-VIEW 2: NEAR-EXPIRY & EXPIRED INVENTORY LOTS (Issue 7) */
            <>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2 text-rose-600 dark:text-rose-400">
                    <Clock className="w-4 h-4" />
                    Cảnh Báo Lô Hàng Cận Date / Hết Hạn (Hạn Sử Dụng ≤ 180 Ngày)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Theo dõi các lô hóa chất, sinh phẩm và kit chẩn đoán sắp hết hạn sử dụng để chủ động báo Kinh doanh đẩy hàng hoặc lập PO mua lô mới thay thế.
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700">
                      <th className="py-3 px-4">Mã SP</th>
                      <th className="py-3 px-4">Tên Hàng Hóa / Sinh Phẩm</th>
                      <th className="py-3 px-4">Số Lô (Lot)</th>
                      <th className="py-3 px-4 text-center">Hạn Sử Dụng</th>
                      <th className="py-3 px-4 text-center">Số Ngày Còn Lại</th>
                      <th className="py-3 px-4 text-center">Tồn Lô Hiện Tại</th>
                      <th className="py-3 px-4">Kho Lưu Trữ</th>
                      <th className="py-3 px-4">NCC Đề Xuất</th>
                      <th className="py-3 px-4 text-center">Hành Động Xử Lý</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {nearExpiryAlerts.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-slate-400">
                          Tuyệt vời! Hiện không có lô hàng tồn kho nào có hạn sử dụng dưới 180 ngày.
                        </td>
                      </tr>
                    ) : (
                      nearExpiryAlerts.map((lot: any, idx: number) => {
                        const isExpired = lot.days_remaining <= 0;
                        const isCritical = lot.days_remaining > 0 && lot.days_remaining <= 60;
                        return (
                          <tr key={lot.id || `${lot.product_code}-${lot.lot_number}-${idx}`} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                            <td className="py-3.5 px-4 font-mono font-bold text-orange-600 dark:text-orange-400">
                              {lot.product_code}
                            </td>
                            <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white">
                              {lot.product_name}
                            </td>
                            <td className="py-3.5 px-4 font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                              {lot.lot_number || "—"}
                            </td>
                            <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-700 dark:text-slate-200">
                              {lot.expiry_date_vn}
                            </td>
                            <td className="py-3.5 px-4 text-center whitespace-nowrap">
                              <span
                                className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                                  isExpired
                                    ? "bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-800"
                                    : isCritical
                                    ? "bg-orange-100 dark:bg-orange-950 text-orange-800 dark:text-orange-300 border-orange-300 dark:border-orange-800"
                                    : "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800"
                                }`}
                              >
                                {isExpired
                                  ? `⛔ Đã hết hạn (${Math.abs(lot.days_remaining)} ngày)`
                                  : `⏳ Còn ${lot.days_remaining} ngày`}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-center font-mono font-black text-slate-900 dark:text-white">
                              {lot.quantity_on_hand} {lot.unit || "Hộp"}
                            </td>
                            <td className="py-3.5 px-4 text-slate-500">
                              {lot.warehouse_location || "Kho Chính"}
                            </td>
                            <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300 font-medium">
                              {lot.resolved_supplier_name}
                            </td>
                            <td className="py-3.5 px-4 text-center whitespace-nowrap">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleRestockToPO(lot)}
                                  className="px-2.5 py-1 rounded-xl text-[11px] font-bold bg-orange-600 text-white hover:bg-orange-700 shadow-xs flex items-center gap-1 cursor-pointer"
                                  title="Tạo ngay đơn PO đặt mua lô hàng date mới thay thế"
                                >
                                  <Plus className="w-3 h-3" /> Lập PR/PO Thay Thế
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    notifyActivity({
                                      title: `📢 Cảnh báo xả hàng cận date: ${lot.product_code} (Lô ${lot.lot_number || "N/A"})`,
                                      message: `Sản phẩm ${lot.product_name} [${lot.product_code}] - Lô ${lot.lot_number || "N/A"} còn tồn ${lot.quantity_on_hand} ${lot.unit || "Hộp"} tại ${lot.warehouse_location || "Kho"}, HSD ${lot.expiry_date_vn} (${lot.days_remaining <= 0 ? "Đã hết hạn" : `còn ${lot.days_remaining} ngày`}). Đề nghị Kinh doanh ưu tiên tư vấn khách hàng / đẩy hàng.`,
                                      targetModule: "sales",
                                      type: "warning"
                                    });
                                    alert(`📢 Đã gửi thông báo đẩy hàng cận date cho bộ phận Kinh doanh:\n• Sản phẩm: [${lot.product_code}] ${lot.product_name}\n• Số lô: ${lot.lot_number || "N/A"} — HSD: ${lot.expiry_date_vn}\n• Tồn lô: ${lot.quantity_on_hand} ${lot.unit || "Hộp"}`);
                                  }}
                                  className="px-2.5 py-1 rounded-xl text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 cursor-pointer"
                                  title="Gửi thông báo sang phân hệ Kinh doanh để ưu tiên chào bán / xả lô cận date"
                                >
                                  📢 Báo Sales Xả Hàng
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 1: CREATE / EDIT PURCHASE ORDER (PO)                */}
      {/* Một dòng hàng = một hàng của bảng (gọn như Excel).        */}
      {/* Đầu và chân cửa sổ cố định, chỉ phần bảng cuộn.           */}
      {/* ========================================================= */}
      {isPOModalOpen && (
        <div className={`fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center ${isPOModalFullscreen ? "p-0" : "p-2 sm:p-4"}`}>
          <div className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col ${isPOModalFullscreen ? "w-screen h-screen max-w-none max-h-none rounded-none" : "rounded-2xl max-w-[96vw] 2xl:max-w-[1440px] w-full max-h-[96vh]"}`}>
            {/* Header (fixed): title + supplier / dates / status always visible */}
            <div className="shrink-0 px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-orange-600">
                  <ShoppingCart className="w-5 h-5" />
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">
                    {poForm.id ? `Cập Nhật Đơn PO ${poForm.po_code || ""}` : "Lập Đơn Đặt Mua Hàng Mới (PO)"}
                  </h3>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setIsPOModalFullscreen(prev => !prev)}
                    title={isPOModalFullscreen ? "Thu nhỏ cửa sổ" : "Mở to bảng hết màn hình"}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center gap-1.5 cursor-pointer"
                  >
                    {isPOModalFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    <span className="hidden sm:inline">{isPOModalFullscreen ? "Thu nhỏ" : "Toàn màn hình"}</span>
                  </button>
                  <button onClick={() => setIsPOModalOpen(false)} title="Đóng (Esc)" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                <div>
                  <label className="block font-bold text-slate-500 dark:text-slate-400 mb-0.5 text-[10px] uppercase">Mã PO</label>
                  <input
                    type="text"
                    value={poForm.po_code}
                    placeholder="Cấp khi lưu"
                    disabled={!!poForm.id}
                    onChange={(e) => setPOForm({ ...poForm, po_code: e.target.value })}
                    className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold disabled:opacity-70"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block font-bold text-slate-500 dark:text-slate-400 mb-0.5 text-[10px] uppercase">Nhà cung cấp</label>
                  <select
                    value={poForm.supplier_name}
                    onChange={(e) => handleChangePOSupplier(e.target.value)}
                    className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold cursor-pointer"
                  >
                    {!suppliers.some(s => s.name === poForm.supplier_name) && poForm.supplier_name && (
                      <option value={poForm.supplier_name}>{poForm.supplier_name}</option>
                    )}
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.name} ({s.payment_terms || "30 ngày"})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-500 dark:text-slate-400 mb-0.5 text-[10px] uppercase">Ngày lập</label>
                  <DateInputVN
                    value={poForm.order_date}
                    onChange={(e) => setPOForm({ ...poForm, order_date: e.target.value })}
                    className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-500 dark:text-slate-400 mb-0.5 text-[10px] uppercase">Hạn giao dự kiến</label>
                  <DateInputVN
                    value={poForm.expected_delivery_date}
                    onChange={(e) => setPOForm({ ...poForm, expected_delivery_date: e.target.value })}
                    className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold"
                  />
                </div>
              </div>

              {/* Non-blocking Supplier Notice Banner (Bug 4a fix) */}
              {poSupplierNotice && (
                <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-xs flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-start gap-2 text-amber-800 dark:text-amber-200">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      {poSupplierNotice.changes.length > 0 && (
                        <div>
                          Đã chuyển sang NCC <strong>{poSupplierNotice.supplierName}</strong>: có{" "}
                          <strong>{poSupplierNotice.changes.length}</strong> dòng hàng có đơn giá mới trong bảng giá NCC.
                        </div>
                      )}
                      {poSupplierNotice.notSold.length > 0 && (
                        <div className="text-[11px] text-amber-700 dark:text-amber-300">
                          Lưu ý: {poSupplierNotice.notSold.map((x: any) => x.product_code).join(", ")} chưa có trong bảng giá của NCC này (bạn vẫn có thể đặt mua và nhập giá trực tiếp).
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {poSupplierNotice.changes.length > 0 && (
                      <button
                        type="button"
                        onClick={applyPOSupplierPriceChanges}
                        className="px-3 py-1 rounded-lg text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 cursor-pointer"
                      >
                        Cập nhật đơn giá theo NCC mới
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setPoSupplierNotice(null)}
                      className="px-2 py-1 rounded-lg text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 cursor-pointer"
                    >
                      Đóng
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Body (scrolls): line table */}
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-700 dark:text-slate-300">Danh mục hàng đặt mua ({poForm.items.length} dòng)</span>
                  <select
                    value={poForm.status}
                    onChange={(e) => setPOForm({ ...poForm, status: e.target.value })}
                    disabled={["PARTIALLY_RECEIVED", "COMPLETED"].includes(poForm.status)}
                    title="Trạng thái đơn (trạng thái nhập kho chỉ cập nhật qua nút Nhập kho)"
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold cursor-pointer disabled:opacity-70"
                  >
                    <option value="PENDING">1. Chờ xác nhận</option>
                    <option value="CONFIRMED">2. Đã xác nhận</option>
                    <option value="ORDERED">3. Đã đặt hàng</option>
                    <option value="PRODUCED">4. Đã sản xuất xong</option>
                    <option value="SHIPPED">5. Đang vận chuyển</option>
                    <option value="AT_CUSTOMS">6. 🛃 Đã đến hải quan</option>
                    <option value="CUSTOMS_CLEARING">7. 📋 Đang làm thủ tục thông quan</option>
                    {poForm.status === "PARTIALLY_RECEIVED" && <option value="PARTIALLY_RECEIVED">8. Đã nhập kho (1 phần)</option>}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPOForm((prev: any) => ({ ...prev, items: [...prev.items, { product_code: "", product_name: "", unit: "Hộp", quantity: 1, unit_price: 0, total: 0, is_stock: true, notes: "" }] }));
                  }}
                  className="px-2.5 py-1.5 rounded-lg text-orange-600 font-bold hover:bg-orange-50 dark:hover:bg-orange-950/40 flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Thêm dòng
                </button>
              </div>

              <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-x-auto">
                <table className="w-full table-fixed text-left text-xs min-w-[1440px]">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-[11px]">
                      <th className="p-2.5 w-8 text-center">#</th>
                      <th className="p-2.5 w-[22%]">Mã hàng / Sản phẩm</th>
                      <th className="p-2.5 w-14 text-center">ĐVT</th>
                      <th className="p-2.5 w-24 text-center" title="Tồn khả dụng / Đang về (rê chuột để xem chi tiết giữ chỗ)">Tồn KD / Đang về</th>
                      <th className="p-2.5 w-20 text-center">SL đặt</th>
                      <th className="p-2.5 w-32 text-right">Đơn giá</th>
                      <th className="p-2.5 w-32 text-right">Thành tiền</th>
                      <th className="p-2.5 w-20 text-center">%VAT</th>
                      <th className="p-2.5 w-28 text-right">Tiền VAT</th>
                      <th className="p-2.5 w-36 text-right">Thành tiền sau VAT</th>
                      <th className="p-2.5 w-40">Mục đích</th>
                      <th className="p-2.5 w-[13%]">Ghi chú dòng</th>
                      <th className="p-2.5 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {poForm.items.map((item: any, idx: number) => {
                      const stockIntel = item.product_code ? getProductStockIntelligence(item.product_code) : null;
                      const isStockOrder = item.is_stock !== false;
                      const receivedQty = Number((poForm.received_qty || {})[idx]) || 0;
                      const srcPR = itemSourcePR(item);
                      const rowQuery = poItemSearchQueries[idx] || "";
                      const filteredCatalogForPO = filterCatalogItemsByQuery(rowQuery);
                      // Chọn mã hàng cho dòng PO (dùng chung cho ô chọn và ô gõ tìm)
                      const applyPOLineProduct = (val: string) => {
                        const prod = mergedCatalogProducts.find((pp: any) => pp.code === val) || products.find((pp: any) => pp.code === val);
                        const resolved = resolveItemSupplierAndPrice({
                          product_code: val,
                          product_name: prod?.name || item.product_name,
                          manufacturer: prod?.manufacturer || prod?.brand || "",
                          cost_price: prod?.cost_price || 0
                        });
                        updatePOLine(idx, {
                          product_code: val,
                          product_name: prod?.name || item.product_name,
                          specification: item.specification && item.product_code === val ? item.specification : (prod?.specification || ""),
                          unit: prod?.unit || item.unit || "Hộp",
                          unit_price: roundPrice3(resolved.unitPrice > 0 ? resolved.unitPrice : (prod ? parseFloat(prod.cost_price) || 0 : Number(item.unit_price) || 0))
                        });
                      };
                      const stockTitle = stockIntel
                        ? `Tồn thực tế: ${stockIntel.onHand} • Đang giữ chỗ: ${stockIntel.reserved} • Khả dụng: ${stockIntel.available} • Đang về: ${stockIntel.incoming}` +
                          (stockIntel.reservations.length > 0 ? `\nGiữ chỗ: ${stockIntel.reservations.map((r: any) => `${r.customer_name}${r.order_code ? ` (${r.order_code})` : ""}: ${r.quantity_reserved}`).join("; ")}` : "")
                        : "";
                      return (
                        <tr key={idx} className="align-top hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                          <td className="p-2 text-center text-slate-400 font-mono pt-3">{idx + 1}</td>
                          <td className="p-2 space-y-1">
                            {receivedQty === 0 && (
                              <div className="relative">
                                <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
                                <input
                                  type="text"
                                  value={rowQuery}
                                  onChange={(e) => {
                                    const q = e.target.value;
                                    setPoItemSearchQueries(prev => ({ ...prev, [idx]: q }));
                                    // Gõ đúng mã, hoặc chỉ còn 1 mã khớp: chọn luôn (không phải bấm thêm vào ô chọn)
                                    const qt = q.trim().toUpperCase();
                                    if (!qt) return;
                                    const hits = filterCatalogItemsByQuery(q);
                                    const exact = hits.find((pp: any) => String(pp.code || "").trim().toUpperCase() === qt);
                                    const pick = exact || (hits.length === 1 ? hits[0] : null);
                                    if (pick && pick.code !== item.product_code) applyPOLineProduct(pick.code);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key !== "Enter") return;
                                    e.preventDefault();
                                    const first = filteredCatalogForPO[0];
                                    if (first) applyPOLineProduct(first.code);
                                  }}
                                  placeholder="Gõ mã / tên hàng (gõ đúng mã hoặc Enter để chọn)"
                                  className="w-full pl-6 pr-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/90 text-slate-900 dark:text-white text-[11px]"
                                />
                              </div>
                            )}
                            <select
                              value={item.product_code}
                              disabled={receivedQty > 0}
                              onChange={(e) => applyPOLineProduct(e.target.value)}
                              className="w-full p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs font-semibold cursor-pointer disabled:opacity-70"
                            >
                              <option value="">
                                {rowQuery
                                  ? `-- Kết quả lọc "${rowQuery}" (${filteredCatalogForPO.length} mã) --`
                                  : `-- Chọn mã hàng (${mergedCatalogProducts.length} SP) --`}
                              </option>
                              {!filteredCatalogForPO.some((pp: any) => pp.code === item.product_code) && item.product_code && (
                                <option value={item.product_code}>
                                  {item.product_code} - {cleanItemName(item.product_name)}
                                </option>
                              )}
                              {filteredCatalogForPO.map((pp: any) => (
                                <option key={pp.code} value={pp.code}>
                                  {pp.code} - {pp.name}{pp.brand || pp.manufacturer ? ` (${pp.brand || pp.manufacturer})` : ""}
                                </option>
                              ))}
                            </select>
                            <div className="flex items-center gap-1.5 mt-0.5 px-0.5">
                              <input
                                type="text"
                                value={item.specification || ""}
                                onChange={(e) => updatePOLine(idx, { specification: e.target.value })}
                                placeholder="Quy cách / Trình tự 5'→3' / Đặc tính riêng..."
                                title={item.specification || "Nhập quy cách hoặc trình tự Primer/Probe riêng cho dòng này"}
                                className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-[11px] text-slate-700 dark:text-slate-200 font-mono focus:border-orange-500 focus:outline-none"
                              />
                              {srcPR && (
                                <span className="shrink-0 text-[9px] font-mono font-bold px-1 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800" title="Đề xuất mua (PR) nguồn của dòng này">
                                  {srcPR}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-2 text-center pt-3 text-slate-600 dark:text-slate-300">{item.unit || "Hộp"}</td>
                          <td className="p-2 text-center pt-3 font-mono cursor-help" title={stockTitle}>
                            {stockIntel ? (
                              <span className="inline-flex items-center gap-1">
                                <strong className={stockIntel.available > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"}>{stockIntel.available}</strong>
                                <span className="text-slate-400">/</span>
                                <span className="text-sky-600 dark:text-sky-400">{stockIntel.incoming}</span>
                                {stockIntel.available >= (Number(item.quantity) || 1) && (
                                  <AlertTriangle className="w-3 h-3 text-amber-500" aria-label="Kho đang đủ hàng khả dụng cho số lượng này" />
                                )}
                              </span>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              min={Math.max(1, receivedQty)}
                              value={item.quantity}
                              onChange={(e) => updatePOLine(idx, { quantity: Math.max(1, receivedQty, parseInt(e.target.value) || 1) })}
                              className="w-full p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold text-center text-xs"
                            />
                            {receivedQty > 0 && <div className="text-[9px] text-teal-600 text-center mt-0.5">đã nhập {receivedQty}</div>}
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={item.unit_price === 0 || item.unit_price === "" || item.unit_price === undefined || item.unit_price === null ? "" : roundPrice3(item.unit_price)}
                              onChange={(e) => {
                                const cleaned = sanitizeDecimal3Input(e.target.value);
                                updatePOLine(idx, {
                                  unit_price: cleaned === "" ? 0 : roundPrice3(cleaned)
                                });
                              }}
                              onBlur={() => updatePOLine(idx, { unit_price: Math.max(0, roundPrice3(item.unit_price)) })}
                              placeholder="Nhập đơn giá (> 0) *"
                              className={`w-full p-1.5 rounded-lg border bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold text-right text-xs ${
                                !(roundPrice3(item.unit_price) > 0)
                                  ? "border-rose-400 dark:border-rose-600 ring-1 ring-rose-200 dark:ring-rose-900/50"
                                  : "border-slate-200 dark:border-slate-700"
                              }`}
                            />
                            {(() => {
                              const codeKey = String(item.product_code || "").trim().toUpperCase();
                              const inbEntry = poForm?.inbound_price_map?.[codeKey];
                              const inbPrice = roundPrice3(inbEntry?.unit_price);
                              if (inbPrice <= 0) return null;
                              const curPrice = roundPrice3(item.unit_price);
                              const isDiff = Math.abs(inbPrice - curPrice) > 0.01;
                              return (
                                <div className="mt-1 flex items-center justify-end gap-1 flex-wrap text-[10px] font-mono">
                                  <span className={isDiff ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-teal-600 dark:text-teal-400"}>
                                    Giá PNK: {formatCurrency(inbPrice)}
                                  </span>
                                  {isDiff && (
                                    <button
                                      type="button"
                                      onClick={() => updatePOLine(idx, { unit_price: inbPrice })}
                                      className="px-1.5 py-0.2 rounded bg-amber-100 hover:bg-amber-200 dark:bg-amber-950 dark:hover:bg-amber-900 text-amber-800 dark:text-amber-300 font-sans font-bold cursor-pointer border border-amber-300 dark:border-amber-800"
                                      title="Áp dụng đơn giá thực tế trên Phiếu Nhập Kho (PNK) vào dòng PO này"
                                    >
                                      Áp giá PNK
                                    </button>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                          {(() => {
                            const lc = calcPOLine(item);
                            return (
                              <>
                                <td className="p-2 pt-3 text-right font-mono font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">
                                  {formatCurrency(lc.subtotal)}
                                </td>
                                <td className="p-2">
                                  <div className="relative">
                                    <input
                                      type="number"
                                      min={0}
                                      max={100}
                                      step="any"
                                      value={item.vat_rate ?? 0}
                                      onChange={(e) => updatePOLine(idx, { vat_rate: Math.max(0, parseFloat(e.target.value) || 0) })}
                                      placeholder="0"
                                      title="Nhập %VAT theo hóa đơn (VD: 0, 5, 8, 10)"
                                      className="w-full p-1.5 pr-5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 font-mono font-bold text-right text-xs"
                                    />
                                    <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 pointer-events-none">%</span>
                                  </div>
                                </td>
                                <td className="p-2 pt-3 text-right font-mono font-semibold text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                                  {formatCurrency(lc.vatAmount)}
                                </td>
                                <td className="p-2 pt-3 text-right font-mono font-black text-orange-600 dark:text-orange-400 whitespace-nowrap">
                                  {formatCurrency(lc.totalAfterVat)}
                                </td>
                              </>
                            );
                          })()}
                          <td className="p-2">
                            <select
                              value={isStockOrder ? "__STOCK__" : (item.target_customer_name || "")}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === "__STOCK__") {
                                  updatePOLine(idx, { is_stock: true, target_customer_name: "", target_customer_id: undefined });
                                } else {
                                  const cust = salesCustomers.find((c: any) => c.name === v);
                                  updatePOLine(idx, { is_stock: false, target_customer_name: v, target_customer_id: cust?.id });
                                }
                              }}
                              className="w-full p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs font-semibold cursor-pointer"
                              title="Mua lưu kho (Stock) hoặc mua cho khách hàng cụ thể"
                            >
                              <option value="__STOCK__">📦 Stock (lưu kho)</option>
                              {!isStockOrder && item.target_customer_name && !salesCustomers.some((c: any) => c.name === item.target_customer_name) && (
                                <option value={item.target_customer_name}>{item.target_customer_name}</option>
                              )}
                              {salesCustomers.map((c: any) => (
                                <option key={c.id} value={c.name}>🏢 {c.name}</option>
                              ))}
                            </select>
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={item.notes || ""}
                              onChange={(e) => updatePOLine(idx, { notes: e.target.value })}
                              placeholder="Ghi chú cho dòng này..."
                              className="w-full p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs"
                            />
                          </td>
                          <td className="p-2 pt-2.5 text-center">
                            {poForm.items.length > 1 && receivedQty === 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setPOForm((prev: any) => {
                                    const items = prev.items.filter((_: any, i: number) => i !== idx);
                                    return { ...prev, items, total_amount: items.reduce((a: number, b: any) => a + calcPOLine(b).totalAfterVat, 0) };
                                  });
                                }}
                                className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded cursor-pointer"
                                title="Xoá dòng"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Ghi chú đơn hàng / Hợp đồng mua bán</label>
                <textarea
                  rows={2}
                  value={poForm.notes}
                  onChange={(e) => setPOForm({ ...poForm, notes: e.target.value })}
                  placeholder="Điều khoản hợp đồng, địa điểm giao nhận, chứng chỉ COA..."
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-medium"
                />
              </div>
            </div>

            {/* Footer (fixed): total + actions always visible */}
            <div className="shrink-0 px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              {(() => {
                const formTotals = calcPOTotals(poForm.items);
                return (
                  <div className="flex flex-wrap items-center gap-4 text-xs sm:text-sm">
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Tiền hàng (trước VAT): </span>
                      <strong className="font-mono text-slate-800 dark:text-slate-100">{formatCurrency(formTotals.subtotal)}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Tiền VAT: </span>
                      <strong className="font-mono text-indigo-600 dark:text-indigo-400">{formatCurrency(formTotals.vatAmount)}</strong>
                    </div>
                    <div>
                      <span className="font-bold text-slate-700 dark:text-slate-200">Tổng giá trị PO (sau VAT): </span>
                      <span className="font-mono font-black text-lg text-orange-600 dark:text-orange-400">{formatCurrency(formTotals.totalAfterVat)}</span>
                    </div>
                  </div>
                );
              })()}
              <div className="flex gap-2">
                <button
                  onClick={() => setIsPOModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  Đóng
                </button>
                <button
                  onClick={handleSavePO}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-orange-600 text-white hover:bg-orange-700 shadow-sm cursor-pointer"
                >
                  Lưu Đơn Đặt Hàng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 2: PO DETAIL (xem, in, Excel, nhập kho, lịch sử PNK) */}
      {/* ========================================================= */}
      {selectedPODetail && (() => {
        const d = selectedPODetail;
        const dItems: any[] = Array.isArray(d.items) ? d.items : [];
        const dTotals = calcPOTotals(dItems);
        const totalD = parseFloat(d.total_amount) || dTotals.totalAfterVat || 0;
        return (
          <div className={`fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center ${isPODetailFullscreen ? "p-0" : "p-2 sm:p-4"}`} onClick={() => setSelectedPODetail(null)}>
            <div className={`bg-white shadow-2xl flex flex-col text-slate-900 border border-slate-200 ${isPODetailFullscreen ? "w-screen h-screen max-w-none max-h-none rounded-none" : "rounded-2xl max-w-6xl w-full max-h-[96vh]"}`} onClick={(e) => e.stopPropagation()}>
              {/* Action bar (fixed) */}
              <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-orange-600" />
                  <span className="font-bold text-sm text-slate-700">Đơn đặt hàng <span className="font-mono text-orange-600">{d.po_code}</span></span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${PO_STATUS_CONFIG[d.status]?.bg || ""} ${PO_STATUS_CONFIG[d.status]?.text || ""} ${PO_STATUS_CONFIG[d.status]?.border || ""}`}>
                    {PO_STATUS_CONFIG[d.status]?.label || d.status}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {d.status !== "CANCELLED" && (
                    <button
                      onClick={() => {
                        setSelectedPODetail(null);
                        handleEditPO(d);
                      }}
                      className="px-3 py-2 rounded-xl text-xs font-bold bg-amber-500 text-white hover:bg-amber-600 flex items-center gap-1.5 cursor-pointer"
                      title="Chỉnh sửa đơn giá, nhà cung cấp, thông tin PO (đồng bộ sang Phiếu Nhập Kho)"
                    >
                      <Edit2 className="w-4 h-4" /> Sửa PO / Đơn giá
                    </button>
                  )}
                  {!["COMPLETED", "CANCELLED", "PENDING", "DRAFT"].includes(d.status) && (
                    <button onClick={() => openReceiveModal(d)} className="px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-1.5 cursor-pointer">
                      <ArrowDownLeft className="w-4 h-4" /> {d.status === "PARTIALLY_RECEIVED" ? "Nhập tiếp" : "Nhập kho"}
                    </button>
                  )}
                  <button onClick={() => exportPOExcel(d)} className="px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-1.5 cursor-pointer">
                    <FileSpreadsheet className="w-4 h-4" /> Excel
                  </button>
                  <button onClick={() => handlePrintPO(d)} className="px-3 py-2 rounded-xl text-xs font-bold bg-orange-600 text-white hover:bg-orange-700 flex items-center gap-1.5 cursor-pointer">
                    <Printer className="w-4 h-4" /> In / PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPODetailFullscreen(prev => !prev)}
                    className="px-2.5 py-2 rounded-xl text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 flex items-center gap-1 cursor-pointer"
                    title={isPODetailFullscreen ? "Thu nhỏ cửa sổ" : "Mở to bảng hết màn hình"}
                  >
                    {isPODetailFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                  </button>
                  <button onClick={() => setSelectedPODetail(null)} className="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 flex items-center gap-1 cursor-pointer" title="Đóng (Esc)">
                    <X className="w-4 h-4" /> Đóng
                  </button>
                </div>
              </div>

              {/* Content (scrolls) */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
                <div className="flex justify-between items-start border-b pb-3">
                  <div>
                    <div className="text-base font-black text-orange-600">{companyConfig.companyName}</div>
                    <div className="text-[11px] text-slate-600 mt-1">Trụ sở: {companyConfig.companyAddress || "Chưa cập nhật"}</div>
                    <div className="text-[11px] text-slate-600">Điện thoại: {companyConfig.companyPhone || "---"} • Email: {companyConfig.companyEmail || "---"}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-black text-slate-900">ĐƠN ĐẶT MUA HÀNG</div>
                    <div className="text-xs font-mono font-bold text-orange-600 mt-1">SỐ: {d.po_code}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Ngày lập: {formatDate(d.order_date)}</div>
                    <div className="text-[11px] text-slate-600 mt-0.5">
                      Người lập PO: <strong className="text-indigo-700">{getPOCreator(d)}</strong>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <div>
                    <div className="font-bold text-slate-900 mb-1">NHÀ CUNG CẤP</div>
                    <div className="font-bold text-slate-800 text-sm">{d.supplier_name}</div>
                    <div className="text-slate-600 mt-1">Hạn giao hàng dự kiến: <strong>{formatDate(d.expected_delivery_date)}</strong></div>
                  </div>
                  <div>
                    <div className="font-bold text-slate-900 mb-1">GIAO NHẬN & PHỤ TRÁCH</div>
                    <div className="text-slate-800 font-semibold">Kho Trung Tâm</div>
                    <div className="text-slate-600 mt-1">
                      Người tạo / Phụ trách PO: <strong className="text-slate-900">{getPOCreator(d)}</strong>
                    </div>
                    <div className="text-slate-600 mt-0.5">
                      Tình trạng nhập kho: <strong>{d.status === "COMPLETED" ? "Đã nhập đủ" : d.status === "PARTIALLY_RECEIVED" ? "Đã nhập 1 phần" : "Chưa nhập"}</strong>
                      {poReceipts.length > 0 && <> • {poReceipts.length} phiếu nhập</>}
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse border border-slate-200 min-w-[980px]">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 text-[11px]">
                        <th className="p-2 border-r border-slate-200 text-center w-10">STT</th>
                        <th className="p-2 border-r border-slate-200">Mã hàng</th>
                        <th className="p-2 border-r border-slate-200">Tên hàng / Quy cách</th>
                        <th className="p-2 border-r border-slate-200 text-center">ĐVT</th>
                        <th className="p-2 border-r border-slate-200 text-center">SL đặt</th>
                        <th className="p-2 border-r border-slate-200 text-center">Đã nhập</th>
                        <th className="p-2 border-r border-slate-200 text-right">Đơn giá</th>
                        <th className="p-2 border-r border-slate-200 text-right">Thành tiền</th>
                        <th className="p-2 border-r border-slate-200 text-center">%VAT</th>
                        <th className="p-2 border-r border-slate-200 text-right">Tiền VAT</th>
                        <th className="p-2 border-r border-slate-200 text-right">Thành tiền sau VAT</th>
                        <th className="p-2 border-r border-slate-200">Nguồn PR</th>
                        <th className="p-2">Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {dItems.map((it: any, i: number) => {
                        const got = receivedOf(d, i);
                        const lc = calcPOLine(it);
                        const qty = lc.qty;
                        const prSrc = itemSourcePR(it);
                        return (
                          <tr key={i}>
                            <td className="p-2 border-r border-slate-200 text-center">{i + 1}</td>
                            <td className="p-2 border-r border-slate-200 font-mono font-bold text-orange-600">{it.product_code}</td>
                            <td className="p-2 border-r border-slate-200 font-medium">{cleanItemName(it.product_name)}</td>
                            <td className="p-2 border-r border-slate-200 text-center">{it.unit || ""}</td>
                            <td className="p-2 border-r border-slate-200 text-center font-bold">{qty}</td>
                            <td className={`p-2 border-r border-slate-200 text-center font-bold ${got >= qty && qty > 0 ? "text-emerald-600" : got > 0 ? "text-teal-600" : "text-slate-400"}`}>{got}</td>
                            <td className="p-2 border-r border-slate-200 text-right font-mono">
                              <div>{formatCurrency(lc.price)}</div>
                              {(() => {
                                const codeKey = String(it.product_code || "").trim().toUpperCase();
                                const inbFromMap = roundPrice3(d?.inbound_price_map?.[codeKey]?.unit_price);
                                const inbFromReceipts = (() => {
                                  for (const r of poReceipts) {
                                    const rItems: any[] = Array.isArray(r.items) ? r.items : (() => { try { return JSON.parse(r.items || "[]"); } catch { return []; } })();
                                    const m = rItems.find((ri: any) => String(ri?.product_code || ri?.productCode || "").trim().toUpperCase() === codeKey && Number(ri?.unit_price ?? ri?.cost_price) > 0);
                                    if (m) return roundPrice3(m.unit_price ?? m.cost_price);
                                  }
                                  return 0;
                                })();
                                const inbPrice = inbFromReceipts || inbFromMap;
                                if (inbPrice <= 0) return null;
                                const isDiff = Math.abs(inbPrice - lc.price) > 0.01;
                                return (
                                  <div className={`text-[10px] font-semibold mt-0.5 ${isDiff ? "text-amber-600" : "text-teal-600"}`} title="Đơn giá nhập kho thực tế trên Phiếu Nhập Kho (PNK)">
                                    Giá PNK: {formatCurrency(inbPrice)}{isDiff ? " ⚠️" : ""}
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="p-2 border-r border-slate-200 text-right font-mono font-bold">{formatCurrency(lc.subtotal)}</td>
                            <td className="p-2 border-r border-slate-200 text-center font-mono font-semibold text-indigo-600">{lc.vatRate}%</td>
                            <td className="p-2 border-r border-slate-200 text-right font-mono text-indigo-600">{formatCurrency(lc.vatAmount)}</td>
                            <td className="p-2 border-r border-slate-200 text-right font-mono font-bold text-orange-600">{formatCurrency(lc.totalAfterVat)}</td>
                            <td className="p-2 border-r border-slate-200 font-mono text-[10px]">
                              {prSrc ? (
                                <button
                                  type="button"
                                  onClick={() => openPRByCode(prSrc)}
                                  title={`Bấm để xem chi tiết Phiếu PR ${prSrc}`}
                                  className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-bold hover:bg-indigo-100 hover:underline cursor-pointer inline-flex items-center gap-1"
                                >
                                  <Eye className="w-3 h-3 text-indigo-500" />
                                  <span>{prSrc}</span>
                                </button>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="p-2 text-[11px] text-slate-600">{it.notes || ""}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 font-semibold border-t border-slate-200">
                        <td colSpan={10} className="p-2 text-right uppercase text-slate-600">Tổng tiền hàng (chưa VAT):</td>
                        <td className="p-2 text-right font-mono text-slate-800">{formatCurrency(dTotals.subtotal)}</td>
                        <td colSpan={2}></td>
                      </tr>
                      <tr className="bg-slate-50 font-semibold border-t border-slate-200">
                        <td colSpan={10} className="p-2 text-right uppercase text-slate-600">Tổng tiền thuế GTGT (VAT):</td>
                        <td className="p-2 text-right font-mono text-indigo-600">{formatCurrency(dTotals.vatAmount)}</td>
                        <td colSpan={2}></td>
                      </tr>
                      <tr className="bg-slate-50 font-bold border-t border-slate-200">
                        <td colSpan={10} className="p-2.5 text-right uppercase">Tổng cộng giá trị PO (sau VAT):</td>
                        <td className="p-2.5 text-right font-mono text-orange-600 text-sm">{formatCurrency(totalD)}</td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {d.notes && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-slate-700"><strong>Ghi chú PO:</strong> {d.notes}</div>
                )}

                {/* Goods receipts: what came in, which lot, which expiry */}
                <div>
                  <div className="font-bold text-slate-800 mb-1.5 flex items-center gap-1.5"><PackageCheck className="w-4 h-4 text-emerald-600" /> Lịch sử nhập kho của PO</div>
                  {poReceipts.length === 0 ? (
                    <div className="text-slate-400 italic">Chưa có phiếu nhập kho nào cho PO này.</div>
                  ) : (
                    <table className="w-full text-left border-collapse border border-slate-200">
                      <thead>
                        <tr className="bg-emerald-50 text-emerald-800 font-bold text-[11px]">
                          <th className="p-2 border-r border-slate-200">Phiếu nhập</th>
                          <th className="p-2 border-r border-slate-200">Ngày</th>
                          <th className="p-2 border-r border-slate-200">Mã hàng</th>
                          <th className="p-2 border-r border-slate-200">Số lô</th>
                          <th className="p-2 border-r border-slate-200">Hạn dùng</th>
                          <th className="p-2 border-r border-slate-200 text-center">SL</th>
                          <th className="p-2 border-r border-slate-200 text-right">Đơn giá nhập (PNK)</th>
                          <th className="p-2 border-r border-slate-200 text-right">Đối chiếu Giá PO</th>
                          <th className="p-2">Người nhập</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {poReceipts.flatMap((r: any) => {
                          const its: any[] = Array.isArray(r.items) ? r.items : (() => { try { return JSON.parse(r.items || "[]"); } catch { return []; } })();
                          return its.map((it: any, k: number) => {
                            const codeKey = String(it?.product_code || it?.productCode || "").trim().toUpperCase();
                            const matchedPoLine = dItems.find((pi: any) => String(pi?.product_code || "").trim().toUpperCase() === codeKey);
                            const poPrice = roundPrice3(matchedPoLine?.unit_price);
                            const pnkPrice = roundPrice3(it?.unit_price ?? it?.cost_price);
                            const isDiff = pnkPrice > 0 && Math.abs(pnkPrice - poPrice) > 0.01;
                            return (
                              <tr key={`${r.transaction_code}-${k}`}>
                                <td className="p-2 border-r border-slate-200 font-mono font-bold text-emerald-700">
                                  {k === 0 && r.transaction_code ? (
                                    <button
                                      type="button"
                                      onClick={() => openEditInboundSlipFromPO(r.transaction_code)}
                                      title={`Bấm để mở & chỉnh sửa Phiếu Nhập Kho ${r.transaction_code}`}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 cursor-pointer transition-all"
                                    >
                                      <span>{r.transaction_code}</span>
                                      <Edit2 className="w-3 h-3 text-emerald-600" />
                                    </button>
                                  ) : ""}
                                </td>
                                <td className="p-2 border-r border-slate-200">{k === 0 ? formatDate(r.date) : ""}</td>
                                <td className="p-2 border-r border-slate-200 font-mono">{it.product_code}</td>
                                <td className="p-2 border-r border-slate-200 font-mono">{it.lot_number || <span className="text-rose-500">(không có lô)</span>}</td>
                                <td className="p-2 border-r border-slate-200">{it.expiry_date ? formatDate(it.expiry_date) : "—"}</td>
                                <td className="p-2 border-r border-slate-200 text-center font-bold">{it.quantity}</td>
                                <td className="p-2 border-r border-slate-200 text-right font-mono font-bold text-emerald-700">
                                  {pnkPrice > 0 ? formatCurrency(pnkPrice) : "—"}
                                </td>
                                <td className="p-2 border-r border-slate-200 text-right font-mono">
                                  {pnkPrice <= 0 ? (
                                    <span className="text-slate-400">—</span>
                                  ) : isDiff ? (
                                    <span className="text-amber-600 font-bold" title={`Giá PO: ${formatCurrency(poPrice)} • Lệch: ${formatCurrency(pnkPrice - poPrice)}`}>
                                      ⚠️ Lệch ({pnkPrice > poPrice ? "+" : ""}{formatCurrency(pnkPrice - poPrice)})
                                    </span>
                                  ) : (
                                    <span className="text-emerald-600 font-semibold">✓ Khớp giá PO</span>
                                  )}
                                </td>
                                <td className="p-2">{k === 0 ? r.performed_by : ""}</td>
                              </tr>
                            );
                          });
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ========================================================= */}
      {/* MODAL R: NHẬP KHO THEO PO (ĐẦY ĐỦ CHUẨN NHẬP KHO)         */}
      {/* ========================================================= */}
      {receiveTarget && (() => {
        const qNorm = normSearch(receiveSearchQuery);
        const visibleIndices = receiveLines
          .map((l, idx) => ({ l, idx }))
          .filter(({ l }) => {
            if (hideUnselectedReceiveLines && l.selected === false) return false;
            if (!qNorm) return true;
            const hay = normSearch(`${l.product_code || ""} ${l.product_name || ""} ${l.specification || ""} ${l.lot_number || ""} ${l.notes || ""}`);
            return hay.includes(qNorm);
          });
        const allVisibleSelected = visibleIndices.length > 0 && visibleIndices.every(({ l }) => l.selected !== false);
        const someVisibleSelected = visibleIndices.some(({ l }) => l.selected !== false) && !allVisibleSelected;
        const activeReceiveLines = receiveLines.filter(l => l.selected !== false && (Number(l.quantity) || 0) > 0);
        const totalSelectedQty = activeReceiveLines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
        const initialPoLinesCount = buildReceiveLinesFromPO(receiveTarget).length;

        return (
        <div className={`fixed inset-0 z-[60] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center ${isReceiveModalFullscreen ? "p-0" : "p-2 sm:p-4"}`}>
          <div className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col ${isReceiveModalFullscreen ? "w-screen h-screen max-w-none max-h-none rounded-none" : "rounded-2xl max-w-7xl w-full max-h-[96vh]"}`}>
            <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-slate-800 gap-3">
              <div>
                <div className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
                  <ArrowDownLeft className="w-5 h-5 text-emerald-600" /> Nhập kho theo PO <span className="font-mono text-orange-600">{receiveTarget.po_code}</span>
                </div>
                <div className="text-[11px] text-slate-500">
                  {receiveTarget.supplier_name} • Khai báo đầy đủ thông tin chứng từ, kho lưu trữ, số lô (LOT), ngày SX (MFG), hạn dùng (EXP), điều kiện bảo quản, vị trí kệ và QC đầu vào.
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsReceiveModalFullscreen(prev => !prev)}
                  title={isReceiveModalFullscreen ? "Thu nhỏ cửa sổ" : "Mở to bảng hết màn hình"}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center gap-1.5 cursor-pointer"
                >
                  {isReceiveModalFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                  <span className="hidden sm:inline">{isReceiveModalFullscreen ? "Thu nhỏ" : "Mở rộng hết màn hình"}</span>
                </button>
                <button onClick={() => setReceiveTarget(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer" title="Đóng (Esc)">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3.5 text-xs space-y-4">
              {/* PHẦN 1: THÔNG TIN CHỨNG TỪ & KHO TIẾP NHẬN (ĐỒNG BỘ VỚI GIAO DIỆN NHẬP KHO CHUẨN) */}
              <div className="p-3.5 rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 space-y-3">
                <div className="font-bold text-slate-800 dark:text-slate-200 uppercase text-[11px] tracking-wide flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>1. Thông Tin Chứng Từ & Kho Tiếp Nhận</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Ngày Nhập Kho *</label>
                    <DateInputVN
                      value={receiveHeader.receipt_date}
                      onChange={(e) => setReceiveHeader(prev => ({ ...prev, receipt_date: e.target.value }))}
                      className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Kho Tiếp Nhận *</label>
                    <select
                      value={receiveHeader.warehouse_name}
                      onChange={(e) => setReceiveHeader(prev => ({ ...prev, warehouse_name: e.target.value }))}
                      className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold cursor-pointer"
                    >
                      <option value="Kho Trung Tâm">Kho Trung Tâm</option>
                      <option value="Kho Lạnh Âm Sâu -20°C (Khu A)">Kho Lạnh Âm Sâu -20°C (Khu A)</option>
                      <option value="Kho Mát 2-8°C (Khu B)">Kho Mát 2-8°C (Khu B)</option>
                      <option value="Kho Thiết Bị & Demo (Khu C)">Kho Thiết Bị & Demo (Khu C)</option>
                      <option value="Kho Chi Nhánh Hà Nội">Kho Chi Nhánh Hà Nội</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Loại Hình Nhập</label>
                    <select
                      value={receiveHeader.inbound_type}
                      onChange={(e) => setReceiveHeader(prev => ({ ...prev, inbound_type: e.target.value }))}
                      className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium cursor-pointer"
                    >
                      <option value="Nhập mua hàng theo Đơn PO từ NCC">Nhập mua hàng theo PO từ NCC</option>
                      <option value="Nhập khẩu ủy thác / Trực tiếp qua Hải Quan">Nhập khẩu trực tiếp / Hải quan</option>
                      <option value="Nhập bổ sung / Giao từng đợt theo PO">Nhập giao từng đợt theo PO</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Số Hóa Đơn VAT / Tờ Khai HQ</label>
                    <input
                      type="text"
                      value={receiveHeader.vat_invoice_no}
                      onChange={(e) => setReceiveHeader(prev => ({ ...prev, vat_invoice_no: e.target.value }))}
                      placeholder="VD: HD-2026-0412 / TK-109..."
                      className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Ngày Hóa Đơn</label>
                    <DateInputVN
                      value={receiveHeader.vat_invoice_date || ""}
                      onChange={(e) => setReceiveHeader(prev => ({ ...prev, vat_invoice_date: e.target.value }))}
                      className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Thủ Kho / Người Tiếp Nhận *</label>
                    <input
                      type="text"
                      value={receiveHeader.received_by}
                      onChange={(e) => setReceiveHeader(prev => ({ ...prev, received_by: e.target.value }))}
                      placeholder="Tên thủ kho nhận hàng..."
                      className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">Đơn Vị Vận Chuyển / Giao Hàng</label>
                    <input
                      type="text"
                      value={receiveHeader.shipping_unit}
                      onChange={(e) => setReceiveHeader(prev => ({ ...prev, shipping_unit: e.target.value }))}
                      placeholder="Xe tải lạnh, DHL, NCC giao..."
                      className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                    />
                  </div>
                </div>
              </div>

              {/* PHẦN 2: THANH TÌM KIẾM NHANH & CHỌN MẶT HÀNG VỀ ĐỢT NÀY */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 bg-emerald-50/50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-emerald-200/70 dark:border-slate-700">
                <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
                  <div className="relative flex-1 max-w-md min-w-[220px]">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={receiveSearchQuery}
                      onChange={(e) => setReceiveSearchQuery(e.target.value)}
                      placeholder="Tìm nhanh mã hàng, tên sản phẩm, quy cách trên phiếu giao..."
                      className="w-full pl-8 pr-7 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs"
                    />
                    {receiveSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setReceiveSearchQuery("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                        title="Xóa tìm kiếm"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                    Đợt này nhập: <strong className="text-emerald-700 dark:text-emerald-400 font-mono">{activeReceiveLines.length}/{receiveLines.length}</strong> dòng
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setReceiveLines(prev =>
                        prev.map(l => ({
                          ...l,
                          selected: true,
                          quantity: (Number(l.quantity) || 0) > 0 ? l.quantity : (l.default_quantity || Math.max(1, (Number(l.ordered) || 1) - (Number(l.received) || 0)))
                        }))
                      )
                    }
                    className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-emerald-700 dark:text-emerald-300 font-semibold text-[11px] hover:bg-emerald-50 cursor-pointer"
                  >
                    ✓ Chọn tất cả
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setReceiveLines(prev =>
                        prev.map(l => ({
                          ...l,
                          selected: false
                        }))
                      )
                    }
                    className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold text-[11px] hover:bg-slate-100 cursor-pointer"
                  >
                    ✕ Bỏ chọn tất cả
                  </button>
                  <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-[11px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hideUnselectedReceiveLines}
                      onChange={(e) => setHideUnselectedReceiveLines(e.target.checked)}
                      className="w-3.5 h-3.5 accent-emerald-600 cursor-pointer"
                    />
                    <span>Ẩn mã chưa về đợt này</span>
                  </label>
                  {receiveLines.length < initialPoLinesCount && (
                    <button
                      type="button"
                      onClick={() => setReceiveLines(buildReceiveLinesFromPO(receiveTarget))}
                      className="px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 font-semibold text-[11px] hover:bg-amber-100 flex items-center gap-1 cursor-pointer"
                      title="Khôi phục lại các dòng mã hàng đã xóa tạm khỏi bảng"
                    >
                      <RotateCcw className="w-3 h-3" /> Khôi phục đủ {initialPoLinesCount} mã PO
                    </button>
                  )}
                </div>
              </div>

              {/* BẢNG CHI TIẾT TỪNG DÒNG HÀNG NHẬP KHO THEO PO */}
              <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-x-auto">
                <table className="w-full text-left min-w-[1300px]">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-[11px]">
                      <th className="p-2 w-10 text-center" title="Tích chọn các mã hàng về trong đợt nhập kho này">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someVisibleSelected;
                          }}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            const visibleSet = new Set(visibleIndices.map(v => v.idx));
                            setReceiveLines(prev =>
                              prev.map((l, idx) => {
                                if (!visibleSet.has(idx)) return l;
                                return {
                                  ...l,
                                  selected: checked,
                                  quantity: checked && (Number(l.quantity) || 0) <= 0
                                    ? (l.default_quantity || Math.max(1, (Number(l.ordered) || 1) - (Number(l.received) || 0)))
                                    : l.quantity
                                };
                              })
                            );
                          }}
                          className="w-4 h-4 accent-emerald-600 cursor-pointer"
                        />
                      </th>
                      <th className="p-2 min-w-[180px]">Mã hàng / Tên / Quy cách *</th>
                      <th className="p-2 text-center w-20">Đặt / Đã nhập</th>
                      <th className="p-2 w-20 text-center">SL thực nhận *</th>
                      <th className="p-2 w-32 text-right">Đơn giá nhập (VNĐ) *</th>
                      <th className="p-2 w-28">Số lô (LOT) *</th>
                      <th className="p-2 w-32">Ngày SX (MFG)</th>
                      <th className="p-2 w-32">Hạn dùng (EXP) *</th>
                      <th className="p-2 w-16 text-center" title="Không có hạn sử dụng (Thiết bị / Vật tư)">K.HSD</th>
                      <th className="p-2 w-44">Điều kiện bảo quản *</th>
                      <th className="p-2 w-32">Vị trí Tủ / Kệ</th>
                      <th className="p-2 w-44">Tình trạng QC đầu vào</th>
                      <th className="p-2 min-w-[120px]">Ghi chú dòng</th>
                      <th className="p-2 w-16 text-center">Tách / Bỏ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {visibleIndices.length === 0 ? (
                      <tr>
                        <td colSpan={14} className="p-6 text-center text-slate-400 italic">
                          Không có dòng hàng nào khớp bộ lọc hiện tại.
                        </td>
                      </tr>
                    ) : visibleIndices.map(({ l, idx: i }) => {
                      const isSelected = l.selected !== false;
                      const isFirstOfLine = !l.is_extra_line && (i === 0 || receiveLines[i - 1].line_index !== l.line_index);
                      const setL = (patch: any) => setReceiveLines(prev => prev.map((x, j) => j === i ? { ...x, ...patch } : x));
                      return (
                        <tr
                          key={i}
                          className={`align-top transition-opacity ${
                            isSelected
                              ? "hover:bg-slate-50/50 dark:hover:bg-slate-800/30"
                              : "opacity-45 bg-slate-50/70 dark:bg-slate-900/40"
                          }`}
                        >
                          <td className="p-2 pt-3 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setL({
                                  selected: checked,
                                  quantity: checked && (Number(l.quantity) || 0) <= 0
                                    ? (l.default_quantity || Math.max(1, (Number(l.ordered) || 1) - (Number(l.received) || 0)))
                                    : l.quantity
                                });
                              }}
                              title={isSelected ? "Mã này có về trong đợt nhập này (bỏ tích nếu chưa về)" : "Mã này chưa về đợt này (tích chọn để nhập kho)"}
                              className="w-4 h-4 accent-emerald-600 cursor-pointer"
                            />
                          </td>
                          <td className="p-2">
                            {l.is_extra_line ? (
                              <div className="space-y-1">
                                <select
                                  value={l.product_code || ""}
                                  onChange={(e) => {
                                    const code = e.target.value;
                                    const prod = mergedCatalogProducts.find((p: any) => p.code === code) || products.find((p: any) => p.code === code);
                                    if (prod) {
                                      setL({
                                        selected: true,
                                        product_code: prod.code,
                                        product_name: prod.name,
                                        specification: prod.specification || "",
                                        unit: prod.unit || "Cái",
                                        unit_price: Number(prod.cost_price) || 0,
                                        storage_condition: prod.storage_condition || l.storage_condition || "",
                                        shelf_position: prod.shelf_position || l.shelf_position || ""
                                      });
                                    } else {
                                      setL({ selected: true, product_code: code });
                                    }
                                  }}
                                  className="w-full p-1 rounded border border-orange-300 dark:border-orange-700 bg-orange-50/50 dark:bg-slate-800 text-[11px] font-mono font-bold text-orange-700 dark:text-orange-300"
                                >
                                  <option value="">-- Chọn mã hàng / máy --</option>
                                  {mergedCatalogProducts.map((p: any) => (
                                    <option key={p.code} value={p.code}>
                                      {p.code} — {p.name}
                                    </option>
                                  ))}
                                </select>
                                <div className="text-[10px] text-slate-500 truncate max-w-[210px]" title={l.product_name}>
                                  {l.product_name || "Dòng máy / hàng bổ sung"}
                                </div>
                              </div>
                            ) : isFirstOfLine ? (
                              <>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono font-bold text-orange-600">{l.product_code}</span>
                                  {l.unit && <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold">{l.unit}</span>}
                                  {!isSelected && (
                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-semibold">
                                      Chưa về đợt này
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-500 truncate max-w-[210px]" title={l.product_name}>{l.product_name}</div>
                                {l.specification && <div className="text-[10px] text-slate-400 truncate max-w-[210px]">{l.specification}</div>}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setReceiveLines((prev) => {
                                      const n = [...prev];
                                      n.splice(i + 1, 0, {
                                        ...l,
                                        selected: true,
                                        quantity: 1,
                                        lot_number: "",
                                        manufacture_date: "",
                                        expiry_date: "",
                                        no_expiry: l.no_expiry,
                                        notes: ""
                                      });
                                      return n;
                                    })
                                  }
                                  className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[10px] font-bold hover:bg-emerald-100 cursor-pointer"
                                  title="Tách lô hoặc thêm dòng Serial/Máy cho mặt hàng này"
                                >
                                  <Plus className="w-3 h-3" /> Tách lô / Thêm dòng máy
                                </button>
                              </>
                            ) : (
                              <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold pl-2 pt-2 flex items-center justify-between gap-1">
                                <span>↳ Lô / Máy khác ({l.product_code})</span>
                                <button
                                  type="button"
                                  onClick={() => setReceiveLines((prev) => prev.filter((_, j) => j !== i))}
                                  className="text-rose-500 hover:underline text-[10px] cursor-pointer"
                                >
                                  ✕ Xóa
                                </button>
                              </div>
                            )}
                          </td>
                          <td className="p-2 text-center font-mono pt-3">
                            {l.is_extra_line ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-sans font-bold">
                                Phát sinh
                              </span>
                            ) : isFirstOfLine ? (
                              <>{l.ordered} / <span className="text-teal-600">{l.received}</span></>
                            ) : (
                              ""
                            )}
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              min={0}
                              value={isSelected ? l.quantity : 0}
                              onChange={(e) => {
                                const val = Math.max(0, parseInt(e.target.value) || 0);
                                setL({ quantity: val, selected: val > 0 });
                              }}
                              className="w-full p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 font-mono font-bold text-center"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              disabled={!isSelected}
                              value={l.unit_price === 0 || l.unit_price === "" || l.unit_price === undefined || l.unit_price === null ? "" : roundPrice3(l.unit_price)}
                              placeholder="Nhập đơn giá *"
                              onChange={(e) => {
                                const cleaned = sanitizeDecimal3Input(e.target.value);
                                setL({ unit_price: cleaned === "" ? 0 : roundPrice3(cleaned) });
                              }}
                              onBlur={() => setL({ unit_price: Math.max(0, roundPrice3(l.unit_price)) })}
                              className={`w-full p-1.5 rounded-lg border bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold text-right text-[11px] ${
                                isSelected && !(roundPrice3(l.unit_price) > 0)
                                  ? "border-rose-300 dark:border-rose-800/80"
                                  : "border-slate-200 dark:border-slate-700"
                              }`}
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              disabled={!isSelected}
                              value={l.lot_number}
                              onChange={(e) => setL({ lot_number: e.target.value })}
                              placeholder="VD: 2510A01"
                              className={`w-full p-1.5 rounded-lg border bg-white dark:bg-slate-800 text-orange-600 dark:text-orange-400 font-mono font-bold ${
                                isSelected && !String(l.lot_number || "").trim()
                                  ? "border-rose-300 dark:border-rose-800/80"
                                  : "border-slate-200 dark:border-slate-700"
                              }`}
                            />
                          </td>
                          <td className="p-2">
                            <DateInputVN
                              value={l.manufacture_date || ""}
                              disabled={!isSelected}
                              onChange={(e) => setL({ manufacture_date: e.target.value })}
                              className="w-full p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono text-[11px]"
                            />
                          </td>
                          <td className="p-2">
                            <DateInputVN
                              value={l.expiry_date}
                              disabled={!isSelected || l.no_expiry}
                              onChange={(e) => setL({ expiry_date: e.target.value })}
                              className={`w-full p-1.5 rounded-lg border bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono text-[11px] disabled:opacity-50 ${
                                isSelected && !l.no_expiry && !String(l.expiry_date || "").trim()
                                  ? "border-rose-300 dark:border-rose-800/80"
                                  : "border-slate-200 dark:border-slate-700"
                              }`}
                            />
                          </td>
                          <td className="p-2 text-center pt-3">
                            <input
                              type="checkbox"
                              disabled={!isSelected}
                              checked={!!l.no_expiry}
                              onChange={(e) => setL({ no_expiry: e.target.checked, expiry_date: e.target.checked ? "" : l.expiry_date })}
                              title="Thiết bị / vật tư không có hạn dùng"
                              className="w-4 h-4 accent-orange-600 cursor-pointer"
                            />
                          </td>
                          <td className="p-2">
                            <select
                              disabled={!isSelected}
                              value={l.storage_condition || ""}
                              onChange={(e) => setL({ storage_condition: e.target.value })}
                              className={`w-full p-1.5 rounded-lg border bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-[11px] ${
                                isSelected && !String(l.storage_condition || "").trim()
                                  ? "border-rose-300 dark:border-rose-800/80 text-rose-600 dark:text-rose-400"
                                  : "border-slate-200 dark:border-slate-700"
                              }`}
                            >
                              <option value="">-- Chưa khai báo nhiệt độ --</option>
                              <option value="-20°C (Lạnh âm sâu - Sinh phẩm, Enzyme)">-20°C (Lạnh âm sâu)</option>
                              <option value="2-8°C (Kho mát - Hóa chất, Kháng thể)">2-8°C (Kho mát)</option>
                              <option value="15-25°C (Nhiệt độ phòng - Vật tư, Thiết bị)">15-25°C (Nhiệt độ phòng)</option>
                              <option value="-80°C (Âm siêu sâu - Mẫu chuẩn)">-80°C (Âm siêu sâu)</option>
                            </select>
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              disabled={!isSelected}
                              value={l.shelf_position || ""}
                              onChange={(e) => setL({ shelf_position: e.target.value })}
                              placeholder="VD: Tủ -20°C Kệ A1"
                              className="w-full p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-[11px]"
                            />
                          </td>
                          <td className="p-2">
                            <select
                              disabled={!isSelected}
                              value={l.qc_status || "Đạt chuẩn 100% (Nguyên niêm phong & COA)"}
                              onChange={(e) => setL({ qc_status: e.target.value })}
                              className="w-full p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-[11px]"
                            >
                              <option value="Đạt chuẩn 100% (Nguyên niêm phong & COA)">Đạt chuẩn 100% (Nguyên tem & COA)</option>
                              <option value="Đạt chuẩn - Chờ bổ sung COA từ NCC">Đạt chuẩn - Chờ bổ sung COA</option>
                              <option value="Bao bì xước nhẹ, niêm phong nguyên vẹn">Bao bì xước nhẹ, còn niêm phong</option>
                              <option value="Cảnh báo chênh lệch nhiệt độ vận chuyển">Cảnh báo lệch nhiệt độ vận chuyển</option>
                            </select>
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              disabled={!isSelected}
                              value={l.notes}
                              onChange={(e) => setL({ notes: e.target.value })}
                              placeholder="Ghi chú thêm..."
                              className="w-full p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-[11px]"
                            />
                          </td>
                          <td className="p-2 text-center whitespace-nowrap">
                            <button
                              type="button"
                              title="Tách thêm 1 lô / dòng máy cho mặt hàng này"
                              onClick={() =>
                                setReceiveLines(prev => {
                                  const n = [...prev];
                                  n.splice(i + 1, 0, {
                                    ...l,
                                    selected: true,
                                    quantity: 1,
                                    lot_number: "",
                                    manufacture_date: "",
                                    expiry_date: "",
                                    no_expiry: l.no_expiry,
                                    notes: ""
                                  });
                                  return n;
                                })
                              }
                              className="p-1 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              title="Bỏ dòng này khỏi đợt nhập kho hiện tại (vẫn giữ trên PO cho đợt sau)"
                              onClick={() => setReceiveLines(prev => prev.filter((_, j) => j !== i))}
                              className="p-1 rounded text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="p-2.5 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const base = receiveLines[0] || {};
                        setReceiveLines((prev) => [
                          ...prev,
                          {
                            line_index: typeof base.line_index === "number" ? base.line_index : 0,
                            selected: true,
                            default_quantity: 1,
                            product_code: base.product_code || "",
                            product_name: base.product_name || "",
                            specification: base.specification || "",
                            unit: base.unit || "Cái",
                            unit_price: Number(base.unit_price) || 0,
                            ordered: Number(base.ordered) || 1,
                            received: Number(base.received) || 0,
                            quantity: 1,
                            lot_number: "",
                            manufacture_date: "",
                            expiry_date: "",
                            no_expiry: !!base.no_expiry,
                            storage_condition: base.storage_condition || "",
                            shelf_position: base.shelf_position || "",
                            qc_status: "Đạt chuẩn 100% (Nguyên niêm phong & COA)",
                            notes: "Thêm máy / lô bổ sung"
                          }
                        ]);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" /> + Thêm dòng Lô / Máy cùng mã (VD: PO 1 máy về 2 máy)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setReceiveLines((prev) => [
                          ...prev,
                          {
                            line_index: -1,
                            is_extra_line: true,
                            selected: true,
                            default_quantity: 1,
                            product_code: "",
                            product_name: "",
                            specification: "",
                            unit: "Cái",
                            unit_price: 0,
                            ordered: 0,
                            received: 0,
                            quantity: 1,
                            lot_number: "",
                            manufacture_date: "",
                            expiry_date: "",
                            no_expiry: false,
                            storage_condition: "15-25°C (Nhiệt độ phòng - Vật tư, Thiết bị)",
                            shelf_position: "",
                            qc_status: "Đạt chuẩn 100% (Nguyên niêm phong & COA)",
                            notes: "Hàng giao thêm / phát sinh ngoài PO"
                          }
                        ]);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" /> + Thêm mã hàng / máy phát sinh khác
                    </button>
                  </div>
                  <span className="text-[11px] text-slate-500 italic">
                    💡 Mẹo: Mã nào chưa về đợt này hãy <strong>bỏ tích ô vuông đầu dòng</strong> hoặc bấm <strong>🗑️</strong>. Nếu PO đặt 1 máy về 2 lô, bấm <strong>"+ Thêm dòng Lô / Máy cùng mã"</strong>.
                  </span>
                </div>
              </div>

              {/* PHẦN 3: GHI CHÚ PHIẾU NHẬP & TỔNG HỢP */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                <div className="md:col-span-8">
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">3. Ghi chú chung phiếu nhập kho (PNK)</label>
                  <input type="text" value={receiveNotes} onChange={(e) => setReceiveNotes(e.target.value)} placeholder="Tình trạng thùng bảo ôn / đá khô khi nhận, biên bản giao nhận kèm theo..."
                    className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                </div>
                <div className="md:col-span-4 flex items-center justify-end gap-4 p-2.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/60">
                  <div>
                    <span className="text-[10px] text-slate-500 block">Dòng thực nhận</span>
                    <strong className="text-slate-900 dark:text-white font-mono text-sm">
                      {activeReceiveLines.length} dòng
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">Tổng SL thực nhận</span>
                    <strong className="text-emerald-600 dark:text-emerald-400 font-mono text-sm">
                      {totalSelectedQty}
                    </strong>
                  </div>
                </div>
              </div>
            </div>
            <div className="shrink-0 px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button onClick={() => setReceiveTarget(null)} className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer">Đóng</button>
              <button onClick={submitReceive} disabled={isSubmittingReceive || activeReceiveLines.length === 0}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm cursor-pointer disabled:opacity-60">
                {isSubmittingReceive ? "Đang nhập kho..." : `Xác nhận nhập kho (${activeReceiveLines.length} dòng)`}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* ========================================================= */}
      {/* MODAL 3: SUPPLIER CRUD MODAL                              */}
      {/* ========================================================= */}
      {isSupplierModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-3xl w-full p-6 sm:p-7 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-orange-600">
                <Building2 className="w-5 h-5" />
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  {supplierForm.id ? "Cập Nhật Hồ Sơ Nhà Cung Cấp" : "Thêm Nhà Cung Cấp Mới"}
                </h3>
              </div>
              <button onClick={() => setIsSupplierModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Mã NCC</label>
                  <input
                    type="text"
                    value={supplierForm.supplier_code}
                    onChange={(e) => setSupplierForm({ ...supplierForm, supplier_code: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono font-bold text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Đánh Giá (1 - 5 Sao)</label>
                  <select
                    value={supplierForm.rating}
                    onChange={(e) => setSupplierForm({ ...supplierForm, rating: parseInt(e.target.value) || 5 })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-bold text-amber-500 cursor-pointer"
                  >
                    <option value={5}>★★★★★ (5/5 Sao - Xuất sắc)</option>
                    <option value={4}>★★★★☆ (4/5 Sao - Rất tốt)</option>
                    <option value={3}>★★★☆☆ (3/5 Sao - Trung bình)</option>
                    <option value={2}>★★☆☆☆ (2/5 Sao - Cần cải thiện)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col justify-between">
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Tên Đầy Đủ NCC / Hãng Sản Xuất</label>
                  <input
                    type="text"
                    placeholder="Ví dụ: Công ty TNHH Giải Pháp Y Sinh ABT..."
                    value={supplierForm.name}
                    onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-bold text-slate-900 dark:text-white"
                  />
                </div>
                <div className="flex flex-col justify-between">
                  <label className="block font-bold text-orange-600 dark:text-orange-400 mb-1">Tên Viết Tắt / Brand (Hiện trên Báo giá)</label>
                  <input
                    type="text"
                    placeholder="Ví dụ: ABT, Phù Sa, Bioer..."
                    value={supplierForm.short_name || ""}
                    onChange={(e) => setSupplierForm({ ...supplierForm, short_name: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-orange-300 dark:border-orange-500/50 bg-white dark:bg-slate-800 font-bold text-orange-600 dark:text-orange-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Người Liên Hệ Đại Diện</label>
                  <input
                    type="text"
                    placeholder="Họ và tên"
                    value={supplierForm.contact_person}
                    onChange={(e) => setSupplierForm({ ...supplierForm, contact_person: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Số Điện Thoại</label>
                  <input
                    type="text"
                    placeholder="Hotline / SĐT"
                    value={supplierForm.phone}
                    onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Email Liên Hệ</label>
                  <input
                    type="text"
                    inputMode="email"
                    placeholder="sales@supplier.com, order@supplier.com"
                    value={supplierForm.email}
                    onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Điều Khoản Thanh Toán</label>
                  <input
                    type="text"
                    placeholder="Ví dụ: Công nợ 30 ngày"
                    value={supplierForm.payment_terms}
                    onChange={(e) => setSupplierForm({ ...supplierForm, payment_terms: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Ngành Hàng Cung Ứng</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Thiết bị Real-time PCR, Kít sinh học phân tử..."
                  value={supplierForm.product_lines}
                  onChange={(e) => setSupplierForm({ ...supplierForm, product_lines: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Địa Chỉ Doanh Nghiệp</label>
                <input
                  type="text"
                  placeholder="Số nhà, đường, quận, thành phố"
                  value={supplierForm.address}
                  onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setIsSupplierModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Hủy
              </button>
              <button
                onClick={handleSaveSupplier}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-orange-600 text-white hover:bg-orange-700 shadow-sm cursor-pointer"
              >
                Lưu Hồ Sơ NCC
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 3B: SUPPLIER PRODUCTS CATALOG & PRICING DRAWER       */}
      {/* ========================================================= */}
      {isSupplierCatalogOpen && selectedSupplierForCatalog && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-5xl w-full flex flex-col max-h-[92vh] overflow-hidden">
            
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-slate-900 dark:text-white text-base">
                      {selectedSupplierForCatalog.name}
                    </h3>
                    <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-800">
                      {selectedSupplierForCatalog.supplier_code}
                    </span>
                    <span className="text-xs text-amber-500 font-bold">
                      {"★".repeat(selectedSupplierForCatalog.rating || 5)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Hồ sơ danh mục hàng hóa cung ứng, quản lý đơn giá mua và tra cứu lịch sử biến động giá của NCC.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsSupplierCatalogOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick KPI stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-slate-50/80 dark:bg-slate-950/40 border-b border-slate-200 dark:border-slate-800 text-xs">
              <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
                <div className="text-[11px] text-slate-500 flex items-center justify-between">
                  <span>Mặt hàng cung ứng</span>
                  <Package className="w-3.5 h-3.5 text-indigo-500" />
                </div>
                <div className="text-lg font-mono font-bold text-slate-900 dark:text-white mt-1">
                  {supplierProducts.length} <span className="text-xs font-normal text-slate-400">mã hàng</span>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
                <div className="text-[11px] text-slate-500 flex items-center justify-between">
                  <span>Giá mua cao nhất</span>
                  <TrendingUp className="w-3.5 h-3.5 text-rose-500" />
                </div>
                <div className="text-sm font-mono font-bold text-rose-600 dark:text-rose-400 mt-1">
                  {formatCurrency(
                    supplierProducts.length > 0 
                      ? Math.max(...supplierProducts.map(p => parseFloat(p.purchase_price) || 0)) 
                      : 0
                  )}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
                <div className="text-[11px] text-slate-500 flex items-center justify-between">
                  <span>Giá mua thấp nhất</span>
                  <TrendingDown className="w-3.5 h-3.5 text-emerald-500" />
                </div>
                <div className="text-sm font-mono font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                  {formatCurrency(
                    supplierProducts.length > 0 
                      ? Math.min(...supplierProducts.map(p => parseFloat(p.purchase_price) || 0)) 
                      : 0
                  )}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
                <div className="text-[11px] text-slate-500 flex items-center justify-between">
                  <span>Mã có lịch sử đổi giá</span>
                  <History className="w-3.5 h-3.5 text-amber-500" />
                </div>
                <div className="text-lg font-mono font-bold text-amber-600 dark:text-amber-400 mt-1">
                  {supplierProducts.filter(p => {
                    let h = [];
                    try { h = typeof p.price_history === "string" ? JSON.parse(p.price_history) : (p.price_history || []); } catch {}
                    return Array.isArray(h) && h.length > 1;
                  }).length} <span className="text-xs font-normal text-slate-400">mã SP</span>
                </div>
              </div>
            </div>

            {/* Toolbar */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Tìm mã hàng, tên sản phẩm..."
                  value={supplierProductSearch}
                  onChange={(e) => setSupplierProductSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-1.5 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Auto collect button */}
                <button
                  type="button"
                  onClick={handleAutoCollectFromPOs}
                  disabled={isAutoCollecting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-50 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900 transition-all cursor-pointer shadow-2xs"
                  title="Hệ thống tự động quét toàn bộ đơn PO của nhà cung cấp này để trích xuất danh mục hàng và cập nhật lịch sử giá mua"
                >
                  <RefreshCw className={cn("w-3.5 h-3.5 text-amber-600 dark:text-amber-400", isAutoCollecting && "animate-spin")} />
                  <span>{isAutoCollecting ? "Đang quét PO..." : "⚡ Tự Động Thu Thập Từ PO"}</span>
                </button>

                {/* Add product button */}
                <button
                  type="button"
                  onClick={() => handleOpenAddProductModal()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 shadow-2xs cursor-pointer transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Thêm Mã Hàng</span>
                </button>

                {/* Excel buttons */}
                <button
                  type="button"
                  onClick={handleDownloadCatalogTemplate}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                  title="Tải mẫu Excel Bảng Giá NCC"
                >
                  <Download className="w-3.5 h-3.5 text-blue-500" />
                  <span className="hidden sm:inline">Mẫu Excel</span>
                </button>

                <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-colors cursor-pointer">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Nạp Excel Bảng Giá</span>
                  <input
                    ref={supplierCatalogFileInputRef}
                    type="file"
                    accept=".xlsx, .xls, .csv"
                    onChange={handleUploadCatalogExcel}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {/* Product table */}
            <div className="overflow-x-auto flex-1 p-4">
              {loadingSupplierProducts ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto text-indigo-500 mb-2" />
                  Đang tải danh mục hàng hóa của nhà cung cấp...
                </div>
              ) : supplierProducts.length === 0 ? (
                <div className="py-12 text-center text-slate-400 space-y-3">
                  <Package className="w-12 h-12 text-slate-300 dark:text-slate-700 mx-auto" />
                  <div>
                    <p className="font-semibold text-slate-700 dark:text-slate-300 text-sm">Chưa có mã hàng nào trong danh mục của NCC này</p>
                    <p className="text-xs text-slate-500 mt-1">Bấm <strong>"⚡ Tự Động Thu Thập Từ PO"</strong> để trích xuất tự động từ các đơn đặt hàng đã lập, hoặc bấm <strong>"Thêm Mã Hàng"</strong> để tạo mới.</p>
                  </div>
                  <div className="flex items-center justify-center gap-2 pt-2">
                    <button
                      type="button"
                      onClick={handleAutoCollectFromPOs}
                      className="px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 cursor-pointer shadow-xs flex items-center gap-1.5"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> ⚡ Tự Động Thu Thập Từ PO Của NCC
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenAddProductModal()}
                      className="px-3.5 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer shadow-xs flex items-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" /> Thêm Thủ Công
                    </button>
                  </div>
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700">
                      <th className="py-2.5 px-3 w-10 text-center">STT</th>
                      <th className="py-2.5 px-3">Mã Hàng</th>
                      <th className="py-2.5 px-3">Tên Mặt Hàng & Quy Cách</th>
                      <th className="py-2.5 px-3 text-center">ĐVT</th>
                      <th className="py-2.5 px-3 text-right">Đơn Giá Mua Hiện Tại</th>
                      <th className="py-2.5 px-3 text-center">Lịch Sử Biến Động</th>
                      <th className="py-2.5 px-3 text-center">Thao Tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {supplierProducts
                      .filter(p => {
                        if (!supplierProductSearch.trim()) return true;
                        const q = supplierProductSearch.toLowerCase();
                        return (
                          (p.product_code || "").toLowerCase().includes(q) ||
                          (p.product_name || "").toLowerCase().includes(q) ||
                          (p.specification || "").toLowerCase().includes(q)
                        );
                      })
                      .map((p, idx) => {
                        let history: any[] = [];
                        try {
                          history = typeof p.price_history === "string" ? JSON.parse(p.price_history) : (p.price_history || []);
                        } catch {}
                        if (!Array.isArray(history)) history = [];

                        // Calculate difference vs previous price
                        let priceDiffPct: number | null = null;
                        if (history.length >= 2) {
                          const lastChange = history[history.length - 1];
                          const oldP = parseFloat(lastChange.old_price) || 0;
                          const newP = parseFloat(lastChange.new_price) || 0;
                          if (oldP > 0) {
                            priceDiffPct = ((newP - oldP) / oldP) * 100;
                          }
                        }

                        return (
                          <tr key={p.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                            <td className="py-3 px-3 text-center text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                            
                            <td className="py-3 px-3 font-mono font-bold text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                              {p.product_code}
                            </td>

                            <td className="py-3 px-3">
                              <div className="font-bold text-slate-900 dark:text-white text-xs">{p.product_name}</div>
                              {p.specification && (
                                <div className="text-[10px] text-slate-400 mt-0.5">{p.specification}</div>
                              )}
                              {p.notes && (
                                <div className="text-[9px] text-amber-500 italic mt-0.5">{p.notes}</div>
                              )}
                            </td>

                            <td className="py-3 px-3 text-center">
                              <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium text-[11px]">
                                {p.unit || "Cái"}
                              </span>
                            </td>

                            <td className="py-3 px-3 text-right whitespace-nowrap">
                              <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                                {formatCurrency(p.purchase_price || 0)}
                              </div>
                              {priceDiffPct !== null && (
                                <div className={cn(
                                  "text-[10px] font-bold flex items-center justify-end gap-0.5 mt-0.5",
                                  priceDiffPct > 0 ? "text-rose-500" : priceDiffPct < 0 ? "text-emerald-500" : "text-slate-400"
                                )}>
                                  {priceDiffPct > 0 ? (
                                    <>
                                      <TrendingUp className="w-3 h-3" />
                                      <span>+{priceDiffPct.toFixed(1)}%</span>
                                    </>
                                  ) : priceDiffPct < 0 ? (
                                    <>
                                      <TrendingDown className="w-3 h-3" />
                                      <span>{priceDiffPct.toFixed(1)}%</span>
                                    </>
                                  ) : (
                                    <span>0%</span>
                                  )}
                                </div>
                              )}
                            </td>

                            <td className="py-3 px-3 text-center whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => handleOpenPriceHistoryModal(p)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/80 hover:bg-amber-100 dark:hover:bg-amber-900 cursor-pointer transition-all shadow-2xs"
                                title="Xem toàn bộ lịch sử các lần điều chỉnh giá mua"
                              >
                                <History className="w-3 h-3 text-amber-500" />
                                <span>{history.length > 0 ? `${history.length} lần đổi giá` : "Xem lịch sử"}</span>
                              </button>
                              {p.last_updated_at && (
                                <div className="text-[9px] text-slate-400 mt-1 font-mono">
                                  {formatVNDate(p.last_updated_at)}
                                </div>
                              )}
                            </td>

                            <td className="py-3 px-3 text-center whitespace-nowrap">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleOpenAdjustPriceModal(p)}
                                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900 cursor-pointer transition-all"
                                  title="Điều chỉnh giá mua và ghi nhận lý do vào lịch sử"
                                >
                                  <DollarSign className="w-3 h-3" />
                                  <span>Đổi giá</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleOpenAddProductModal(p)}
                                  className="p-1.5 rounded-lg text-slate-600 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-slate-800 transition-all cursor-pointer"
                                  title="Sửa thông tin mã hàng"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleDeleteSupplierProduct(p)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-800 transition-all cursor-pointer"
                                  title="Xóa mã hàng khỏi NCC"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50 text-xs">
              <span className="text-slate-500">
                Hiển thị <strong>{supplierProducts.length}</strong> mặt hàng thuộc NCC <strong>{selectedSupplierForCatalog.name}</strong>
              </span>
              <button
                type="button"
                onClick={() => setIsSupplierCatalogOpen(false)}
                className="px-4 py-2 rounded-xl font-bold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 cursor-pointer transition-colors"
              >
                Đóng
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 3C: ADD / EDIT SUPPLIER PRODUCT MODAL               */}
      {/* ========================================================= */}
      {isAddEditProductModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-2xl w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                <Package className="w-5 h-5" />
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  {productForm.id ? "Cập Nhật Mã Hàng NCC" : "Thêm Mặt Hàng Vào Danh Mục NCC"}
                </h3>
              </div>
              <button onClick={() => setIsAddEditProductModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {/* Select from existing products dropdown */}
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Chọn Nhanh Từ Danh Mục Kho (Hoặc tự nhập mã mới bên dưới)
                </label>
                <select
                  onChange={(e) => {
                    const sel = products.find(x => x.code === e.target.value);
                    if (sel) {
                      setProductForm({
                        ...productForm,
                        product_code: sel.code,
                        product_name: sel.name,
                        specification: sel.specification || "",
                        unit: sel.unit || "Cái",
                        purchase_price: parseFloat(sel.cost_price) || 0
                      });
                    }
                  }}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white cursor-pointer font-semibold"
                >
                  <option value="">-- Chọn sản phẩm có sẵn để nạp thông tin --</option>
                  {products.map(p => (
                    <option key={p.code} value={p.code}>
                      [{p.code}] {p.name} - Giá vốn: {formatCurrency(p.cost_price || 0)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Mã Hàng (*)</label>
                  <input
                    type="text"
                    placeholder="Mã sản phẩm / SKU"
                    value={productForm.product_code}
                    onChange={(e) => setProductForm({ ...productForm, product_code: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono font-bold text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Đơn Vị Tính</label>
                  <input
                    type="text"
                    placeholder="Hộp, Cái, Lọ, Bộ..."
                    value={productForm.unit}
                    onChange={(e) => setProductForm({ ...productForm, unit: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Tên Mặt Hàng (*)</label>
                <input
                  type="text"
                  placeholder="Tên đầy đủ của sản phẩm / hóa chất / vật tư"
                  value={productForm.product_name}
                  onChange={(e) => setProductForm({ ...productForm, product_name: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-bold text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Quy Cách / Đóng Gói</label>
                <input
                  type="text"
                  placeholder="Ví dụ: 50 test/hộp, 250ml/chai, 96 giếng/đĩa..."
                  value={productForm.specification}
                  onChange={(e) => setProductForm({ ...productForm, specification: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Đơn Giá Mua Ban Đầu (VNĐ)</label>
                <input
                  type="number"
                  placeholder="Đơn giá mua từ nhà cung cấp"
                  value={productForm.purchase_price}
                  onChange={(e) => setProductForm({ ...productForm, purchase_price: parseFloat(e.target.value) || 0 })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Ghi Chú Bảng Giá</label>
                <input
                  type="text"
                  placeholder="Chính sách giá, số lượng đặt tối thiểu..."
                  value={productForm.notes}
                  onChange={(e) => setProductForm({ ...productForm, notes: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsAddEditProductModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSaveSupplierProduct}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm cursor-pointer"
              >
                Lưu Mặt Hàng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 3D: ADJUST PURCHASE PRICE WITH AUDIT REASON         */}
      {/* ========================================================= */}
      {isAdjustPriceModalOpen && adjustPriceTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-2xl w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                <SlidersHorizontal className="w-5 h-5" />
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  Điều Chỉnh Đơn Giá Mua
                </h3>
              </div>
              <button onClick={() => setIsAdjustPriceModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Target Item Details */}
            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Mã hàng:</span>
                <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{adjustPriceTarget.product_code}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Tên mặt hàng:</span>
                <span className="font-bold text-slate-900 dark:text-white text-right truncate max-w-[280px]">{adjustPriceTarget.product_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Nhà cung cấp:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedSupplierForCatalog?.name}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 dark:border-slate-700/80 pt-1.5">
                <span className="text-slate-500 font-semibold">Giá Mua Hiện Tại:</span>
                <span className="font-mono font-bold text-slate-900 dark:text-white text-sm">
                  {formatCurrency(adjustPriceTarget.purchase_price || 0)}
                </span>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Đơn Giá Mua Mới Áp Dụng (VNĐ) (*)
                </label>
                <input
                  type="number"
                  placeholder="Nhập giá mua mới"
                  value={newPurchasePrice}
                  onChange={(e) => setNewPurchasePrice(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono font-bold text-emerald-600 dark:text-emerald-400 text-base"
                />

                {/* Real-time comparison badge */}
                {(() => {
                  const oldP = parseFloat(adjustPriceTarget.purchase_price) || 0;
                  const newP = parseFloat(String(newPurchasePrice)) || 0;
                  const diff = newP - oldP;
                  const pct = oldP > 0 ? (diff / oldP) * 100 : 0;
                  return (
                    <div className="flex items-center gap-2 mt-1.5 text-[11px] font-semibold">
                      <span className="text-slate-500">Biến động:</span>
                      <span className={cn(
                        "font-mono font-bold px-2 py-0.5 rounded-md",
                        diff > 0 
                          ? "bg-rose-100 dark:bg-rose-950/80 text-rose-600 dark:text-rose-400" 
                          : diff < 0 
                          ? "bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400" 
                          : "bg-slate-100 dark:bg-slate-800 text-slate-500"
                      )}>
                        {diff > 0 ? `+${formatCurrency(diff)} (+${pct.toFixed(1)}%)` : diff < 0 ? `${formatCurrency(diff)} (${pct.toFixed(1)}%)` : "Không đổi"}
                      </span>
                    </div>
                  );
                })()}
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Ngày Bắt Đầu Áp Dụng
                </label>
                <DateInputVN
                  value={priceAdjustmentDate}
                  onChange={(e) => setPriceAdjustmentDate(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Lý Do Điều Chỉnh Giá (*) (Ghi nhận lịch sử kiểm toán)
                </label>
                
                {/* Fast Chips */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[
                    "Hãng tăng giá định kỳ",
                    "Chiết khấu đợt nhập lớn",
                    "Biến động tỷ giá ngoại tệ",
                    "Đàm phán hạ giá thành công",
                    "Thay đổi quy cách đóng gói"
                  ].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setPriceAdjustmentReason(chip)}
                      className={cn(
                        "px-2 py-1 rounded-md text-[10px] font-semibold border transition-all cursor-pointer",
                        priceAdjustmentReason === chip
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700"
                      )}
                    >
                      {chip}
                    </button>
                  ))}
                </div>

                <textarea
                  rows={2}
                  placeholder="Chi tiết lý do điều chỉnh đơn giá mua (bắt buộc)..."
                  value={priceAdjustmentReason}
                  onChange={(e) => setPriceAdjustmentReason(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              {/* Sync Cost Price Checkbox */}
              <label className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={syncCostPrice}
                  onChange={(e) => setSyncCostPrice(e.target.checked)}
                  className="w-4 h-4 text-indigo-600 rounded cursor-pointer"
                />
                <span className="text-[11px] text-slate-700 dark:text-slate-300 font-medium">
                  Đồng thời cập nhật đơn giá vốn (Cost Price) của sản phẩm này trong Danh Mục Kho toàn công ty
                </span>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsAdjustPriceModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={isSavingPriceAdjustment}
                onClick={handleSavePriceAdjustment}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm cursor-pointer flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{isSavingPriceAdjustment ? "Đang lưu..." : "Xác Nhận & Lưu Lịch Sử Giá"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 3E: PRICE ADJUSTMENT HISTORY TIMELINE               */}
      {/* ========================================================= */}
      {isPriceHistoryModalOpen && priceHistoryTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-3xl w-full p-6 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-amber-500">
                <History className="w-5 h-5" />
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">
                    Lịch Sử Biến Động & Điều Chỉnh Giá Mua
                  </h3>
                  <div className="text-[11px] text-slate-400 font-mono">
                    Mã SP: <span className="font-bold text-indigo-400">{priceHistoryTarget.product_code}</span> • {priceHistoryTarget.product_name}
                  </div>
                </div>
              </div>
              <button onClick={() => setIsPriceHistoryModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Current Price Box */}
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider block">Đơn Giá Mua Hiện Tại:</span>
                <span className="text-lg font-mono font-bold text-emerald-700 dark:text-emerald-300">
                  {formatCurrency(priceHistoryTarget.purchase_price || 0)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsPriceHistoryModalOpen(false);
                  handleOpenAdjustPriceModal(priceHistoryTarget);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer shadow-2xs"
              >
                + Điều Chỉnh Giá Mới
              </button>
            </div>

            {/* Timeline content */}
            <div className="overflow-y-auto flex-1 pr-1 space-y-4">
              {(() => {
                let history: any[] = [];
                try {
                  history = typeof priceHistoryTarget.price_history === "string" 
                    ? JSON.parse(priceHistoryTarget.price_history) 
                    : (priceHistoryTarget.price_history || []);
                } catch {}
                if (!Array.isArray(history) || history.length === 0) {
                  return (
                    <div className="py-8 text-center text-slate-400 text-xs">
                      Chưa có lịch sử điều chỉnh giá nào cho sản phẩm này.
                    </div>
                  );
                }

                // Render in reverse chronological order
                const reversed = [...history].reverse();

                return (
                  <div className="relative pl-6 space-y-4 before:content-[''] before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
                    {reversed.map((item: any, hIdx: number) => {
                      const oldP = parseFloat(item.old_price) || 0;
                      const newP = parseFloat(item.new_price) || 0;
                      const diff = newP - oldP;
                      const pct = oldP > 0 ? (diff / oldP) * 100 : 0;

                      return (
                        <div key={hIdx} className="relative group">
                          {/* Dot on line */}
                          <div className={cn(
                            "absolute -left-6 top-1.5 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900",
                            diff > 0 
                              ? "bg-rose-500" 
                              : diff < 0 
                              ? "bg-emerald-500" 
                              : "bg-indigo-500"
                          )} />

                          <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200/80 dark:border-slate-800 space-y-1.5 text-xs">
                            <div className="flex items-center justify-between flex-wrap gap-1">
                              <span className="font-mono font-bold text-slate-800 dark:text-slate-200 text-[11px]">
                                📅 {item.date ? formatVNDateTime(item.date) : "N/A"}
                              </span>
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium">
                                {item.source === "PO_AUTO" ? "⚡ Tự động từ PO" : item.source === "EXCEL_IMPORT" ? "📥 Nạp Excel" : "✏️ Thủ công"}
                              </span>
                            </div>

                            {/* Price change comparison */}
                            <div className="flex items-center gap-2 font-mono flex-wrap">
                              <span className="text-slate-400 line-through">
                                {formatCurrency(oldP)}
                              </span>
                              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                              <span className="font-bold text-slate-900 dark:text-white text-sm">
                                {formatCurrency(newP)}
                              </span>
                              {oldP > 0 && (
                                <span className={cn(
                                  "text-[10px] font-bold px-1.5 py-0.2 rounded font-sans",
                                  diff > 0 ? "bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400" : "bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400"
                                )}>
                                  {diff > 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`}
                                </span>
                              )}
                            </div>

                            {/* Reason & Actor */}
                            <div className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                              <strong>Lý do:</strong> {item.reason || "Không ghi rõ"}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              Người thực hiện: <strong>{item.changed_by || "Admin"}</strong>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsPriceHistoryModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
      {isPaymentModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-2xl w-full p-6 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-emerald-600">
                <DollarSign className="w-5 h-5" />
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  Ghi Nhận Chi Tiền Cho Nhà Cung Cấp
                </h3>
              </div>
              <button onClick={() => setIsPaymentModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl space-y-1">
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500 shrink-0">Đơn Hàng PO:</span>
                  <span className="font-mono font-bold text-orange-600 text-right break-all">{paymentForm.po_code}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500 shrink-0">Nhà Cung Cấp:</span>
                  <span className="font-bold text-slate-900 dark:text-white text-right">{paymentForm.supplier_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Tổng Tiền PO:</span>
                  <span className="font-mono font-bold">{formatCurrency(paymentForm.total_amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Đã Thanh Toán:</span>
                  <span className="font-mono font-bold text-emerald-600">{formatCurrency(paymentForm.amount_paid)}</span>
                </div>
                <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-1 font-bold">
                  <span className="text-rose-600">Còn Nợ Cần Trả:</span>
                  <span className="font-mono text-rose-600">{formatCurrency(paymentForm.remaining_balance)}</span>
                </div>
              </div>

              {Array.isArray(paymentForm.allocations) ? (
                <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                      <tr><th className="p-2 text-left">PO</th><th className="p-2 text-right">Còn nợ</th><th className="p-2 text-right w-36">Chi lần này</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {paymentForm.allocations.map((al: any, i: number) => (
                        <tr key={al.po_id}>
                          <td className="p-2 font-mono font-bold text-orange-600">{al.po_code}</td>
                          <td className="p-2 text-right font-mono">{formatCurrency(al.remaining)}</td>
                          <td className="p-2 text-right">
                            <MoneyInput
                              value={al.amount}
                              onValueChange={(v) => setPaymentForm((prev: any) => ({
                                ...prev,
                                allocations: prev.allocations.map((x: any, k: number) => k === i ? { ...x, amount: Math.min(v, x.remaining) } : x)
                              }))}
                              className="w-32 p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono text-right"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="font-bold">
                        <td className="p-2">Tổng phiếu chi</td>
                        <td></td>
                        <td className="p-2 text-right font-mono text-emerald-600">
                          {formatCurrency(paymentForm.allocations.reduce((s: number, a: any) => s + (Number(a.amount) || 0), 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                    <label className="block font-bold text-slate-700 dark:text-slate-300">Số Tiền Chi / Đặt Cọc Đợt Này (VNĐ)</label>
                    {paymentForm.total_amount > 0 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        {[30, 50, 70].map((pct) => {
                          const targetAmt = Math.min(paymentForm.remaining_balance, Math.round((paymentForm.total_amount * pct) / 100));
                          if (targetAmt <= 0) return null;
                          return (
                            <button
                              key={pct}
                              type="button"
                              onClick={() =>
                                setPaymentForm({
                                  ...paymentForm,
                                  payment_amount: targetAmt,
                                  payment_notes: `Đặt cọc ${pct}% PO ${paymentForm.po_code}`
                                })
                              }
                              className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 hover:bg-purple-100 cursor-pointer"
                            >
                              Cọc {pct}%
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() =>
                            setPaymentForm({
                              ...paymentForm,
                              payment_amount: paymentForm.remaining_balance,
                              payment_notes:
                                (Number(paymentForm.received_amount) || 0) <= 0.5
                                  ? `Thanh toán trước 100% PO ${paymentForm.po_code}`
                                  : `Thanh toán tiền hàng PO ${paymentForm.po_code}`
                            })
                          }
                          className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 cursor-pointer"
                        >
                          100% còn lại
                        </button>
                      </div>
                    )}
                  </div>
                  <MoneyInput
                    value={paymentForm.payment_amount}
                    onValueChange={(v) => setPaymentForm({ ...paymentForm, payment_amount: v })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold text-base"
                  />
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Phương Thức Thanh Toán</label>
                <select
                  value={paymentForm.payment_method}
                  onChange={(e) => setPaymentForm({ ...paymentForm, payment_method: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold cursor-pointer"
                >
                  {(paymentMethods.includes(paymentForm.payment_method) || !paymentForm.payment_method ? paymentMethods : [paymentForm.payment_method, ...paymentMethods]).map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Số UNC / Chứng Từ <span className="font-normal text-slate-400">(không bắt buộc)</span></label>
                  <input
                    type="text"
                    value={paymentForm.reference_doc}
                    onChange={(e) => setPaymentForm({ ...paymentForm, reference_doc: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Ngày Chi Tiền</label>
                  <DateInputVN
                    value={paymentForm.payment_date}
                    onChange={(e) => setPaymentForm({ ...paymentForm, payment_date: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Ghi Chú Kế Toán</label>
                <input
                  type="text"
                  value={paymentForm.payment_notes}
                  onChange={(e) => setPaymentForm({ ...paymentForm, payment_notes: e.target.value })}
                  placeholder="Ghi chú thêm về đợt thanh toán..."
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-medium"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setIsPaymentModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Hủy
              </button>
              <button
                onClick={handleRecordPayment}
                disabled={isSubmittingPayment}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm cursor-pointer"
              >
                Xác Nhận Chi Tiền
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 5: CREATE / EDIT PURCHASE REQUEST (PR)              */}
      {/* ========================================================= */}
      {isPRModalOpen && (
        <div className="fixed inset-0 z-[60] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-5xl w-full p-6 sm:p-7 space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                <FileText className="w-5 h-5" />
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">
                    {prForm.id
                      ? `Cập Nhật Đề Xuất Mua Hàng (${prForm.workflow_code || "PR"})`
                      : "Khởi Tạo Đề Xuất Mua Hàng (PR Mới)"}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Chọn mặt hàng có sẵn trong danh mục (gõ tìm nhanh mã hàng như HD-, Meridian, SSI...) hoặc gõ mới
                  </p>
                </div>
              </div>
              <button onClick={() => setIsPRModalOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Title */}
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Tiêu Đề Đề Xuất *</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Đề xuất mua bổ sung Kít chẩn đoán Real-time PCR và Sinh phẩm..."
                  value={prForm.title}
                  onChange={(e) => setPRForm({ ...prForm, title: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-bold"
                />
              </div>

              {/* Department, Priority & Due Date */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Bộ Phận Yêu Cầu</label>
                  <select
                    value={prForm.requester_dept}
                    onChange={(e) => setPRForm({ ...prForm, requester_dept: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold cursor-pointer"
                  >
                    <option value="Kho & Vận Hành">Kho & Vận Hành</option>
                    <option value="Kinh Doanh">Kinh Doanh</option>
                    <option value="Application">Application (Lab)</option>
                    <option value="Cung Ứng">Cung Ứng</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Mức Độ Ưu Tiên</label>
                  <select
                    value={prForm.priority}
                    onChange={(e) => setPRForm({ ...prForm, priority: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold cursor-pointer"
                  >
                    <option value="URGENT">Khẩn cấp (Hết hàng/Hàng gấp)</option>
                    <option value="HIGH">Ưu tiên cao</option>
                    <option value="MEDIUM">Bình thường (Định kỳ)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Hạn Cần Hàng</label>
                  <DateInputVN
                    value={prForm.due_date}
                    onChange={(e) => setPRForm({ ...prForm, due_date: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold"
                  />
                </div>
              </div>

              {/* Dynamic Items Section */}
              <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-3.5 bg-slate-50/50 dark:bg-slate-800/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-black text-slate-800 dark:text-slate-200 text-xs uppercase tracking-wide">
                      Danh Sách Mặt Hàng Đề Xuất Mua ({prForm.items?.length || 0})
                    </span>
                    <span className="text-[10px] text-slate-400">(Mã hàng, Qui cách, Đơn vị, Số lượng)</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddPRItem}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 cursor-pointer transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" /> Thêm mặt hàng
                  </button>
                </div>

                <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                  {prForm.items?.map((it: any, idx: number) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xs space-y-2.5"
                    >
                      {/* Row Top: Index, Mode Selector & Delete Button */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-400 font-bold text-[10px] flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <span className="font-bold text-slate-700 dark:text-slate-300 text-xs">
                            Mặt hàng #{idx + 1}
                          </span>

                          {/* Mode Toggle Buttons */}
                          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5 ml-2">
                            <button
                              type="button"
                              onClick={() => handleToggleItemCustom(idx, false)}
                              className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                                !it.is_custom
                                  ? "bg-indigo-600 text-white shadow-xs"
                                  : "text-slate-600 dark:text-slate-400 hover:text-indigo-600"
                              }`}
                            >
                              📋 Chọn mã hàng có sẵn
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleItemCustom(idx, true)}
                              className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                                it.is_custom
                                  ? "bg-orange-600 text-white shadow-xs"
                                  : "text-slate-600 dark:text-slate-400 hover:text-orange-600"
                              }`}
                            >
                              ✍️ Gõ mới (Mua lần đầu)
                            </button>
                          </div>
                        </div>

                        {it.po_code ? (
                          <span
                            className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 whitespace-nowrap"
                            title="Dòng đã lên đơn mua (PO), không xóa khỏi PR được"
                          >
                            🔒 {it.po_code}
                          </span>
                        ) : prForm.items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemovePRItem(idx)}
                            className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-800 cursor-pointer"
                            title="Xóa mặt hàng này"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Mode 1: Available Product from Catalog (Issue 4: Full catalog search before render) */}
                      {!it.is_custom ? (
                        <div className="space-y-2">
                          <div className="space-y-1.5">
                            <label className="block text-[10px] font-bold text-slate-500">
                              Tìm kiếm & Chọn sản phẩm từ danh mục hệ thống ({mergedCatalogProducts.length} mã hàng):
                            </label>
                            <div className="relative">
                              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                              <input
                                type="text"
                                value={prItemSearchQueries[idx] || ""}
                                onChange={(e) => setPrItemSearchQueries(prev => ({ ...prev, [idx]: e.target.value }))}
                                placeholder="Gõ tìm nhanh theo mã hàng, tên kit hoặc hãng (VD: hd-, liferiver, meridian, ssi...)"
                                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/30 dark:bg-slate-800 text-slate-900 dark:text-white text-xs"
                              />
                            </div>
                            {(() => {
                              const q = prItemSearchQueries[idx] || "";
                              const filteredList = filterCatalogItemsByQuery(q);
                              return (
                                <select
                                  value={it.product_code}
                                  onChange={(e) => handleSelectExistingProduct(idx, e.target.value)}
                                  className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-semibold text-xs cursor-pointer"
                                >
                                  <option value="">
                                    {q
                                      ? `-- Kết quả lọc "${q}" (${filteredList.length} sản phẩm phù hợp) --`
                                      : `-- Bấm để chọn mặt hàng trong danh mục TBR (${mergedCatalogProducts.length} SP) --`}
                                  </option>
                                  {!filteredList.some((p: any) => p.code === it.product_code) && it.product_code && (
                                    <option value={it.product_code}>
                                      [{it.product_code}] {it.product_name}
                                    </option>
                                  )}
                                  {filteredList.map((p: any) => (
                                    <option key={p.code} value={p.code}>
                                      [{p.code}] {p.name} {p.brand || p.manufacturer ? `- Hãng: ${p.brand || p.manufacturer}` : ""} {p.specification ? `- (${p.specification})` : ""} - ĐVT: {p.unit || "Cái"}
                                    </option>
                                  ))}
                                </select>
                              );
                            })()}
                          </div>

                          <div className="grid grid-cols-12 gap-2">
                            <div className="col-span-3">
                              <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Mã hàng</label>
                              <input
                                type="text"
                                readOnly
                                value={it.product_code}
                                placeholder="Mã SKU..."
                                className="w-full p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 font-mono font-bold text-xs"
                              />
                            </div>
                            <div className="col-span-4">
                              <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Qui cách kỹ thuật</label>
                              <input
                                type="text"
                                value={it.specification || ""}
                                onChange={(e) => handlePRItemChange(idx, "specification", e.target.value)}
                                placeholder="VD: 50 test/kit, 96 well..."
                                className="w-full p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs"
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Đơn vị *</label>
                              <input
                                type="text"
                                value={it.unit || ""}
                                onChange={(e) => handlePRItemChange(idx, "unit", e.target.value)}
                                placeholder="Hộp, Kit..."
                                className="w-full p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs text-center font-bold"
                              />
                            </div>
                            <div className="col-span-3">
                              <label className="block text-[10px] font-bold text-orange-600 dark:text-orange-400 mb-0.5">Số lượng cần mua *</label>
                              <input
                                type="number"
                                min={1}
                                value={it.quantity}
                                onChange={(e) => handlePRItemChange(idx, "quantity", parseInt(e.target.value) || 1)}
                                className="w-full p-1.5 rounded-lg border-2 border-orange-400 bg-orange-50/40 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300 font-bold text-xs text-center"
                              />
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* Mode 2: First-time New Custom Item */
                        <div className="space-y-2">
                          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-lg p-2 text-[11px] text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                            <span>Mặt hàng mua lần đầu (chưa có trong danh mục kho). Vui lòng nhập Mã hàng, Tên hàng, Qui cách, Đơn vị và Số lượng.</span>
                          </div>

                          <div className="grid grid-cols-12 gap-2">
                            <div className="col-span-3">
                              <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-300 mb-0.5">Mã hàng</label>
                              <input
                                type="text"
                                value={it.product_code}
                                onChange={(e) => handlePRItemChange(idx, "product_code", e.target.value)}
                                placeholder="VD: TBR-NEW-01..."
                                className="w-full p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold text-xs"
                              />
                            </div>
                            <div className="col-span-5">
                              <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-300 mb-0.5">Tên hàng hóa *</label>
                              <input
                                type="text"
                                value={it.product_name}
                                onChange={(e) => handlePRItemChange(idx, "product_name", e.target.value)}
                                placeholder="Tên hóa chất, sinh phẩm, linh kiện mới..."
                                className="w-full p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold text-xs"
                              />
                            </div>
                            <div className="col-span-4">
                              <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-300 mb-0.5">Qui cách kỹ thuật</label>
                              <input
                                type="text"
                                value={it.specification || ""}
                                onChange={(e) => handlePRItemChange(idx, "specification", e.target.value)}
                                placeholder="VD: Chai 500ml, Bộ 100 test..."
                                className="w-full p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-12 gap-2">
                            <div className="col-span-4">
                              <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-300 mb-0.5">Đơn vị tính (ĐVT) *</label>
                              <input
                                type="text"
                                value={it.unit || ""}
                                onChange={(e) => handlePRItemChange(idx, "unit", e.target.value)}
                                placeholder="Hộp, Chai, Cái, Kit, Bộ, Máy..."
                                className="w-full p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-bold"
                              />
                            </div>
                            <div className="col-span-4">
                              <label className="block text-[10px] font-bold text-orange-600 dark:text-orange-400 mb-0.5">Số lượng cần mua *</label>
                              <input
                                type="number"
                                min={1}
                                value={it.quantity}
                                onChange={(e) => handlePRItemChange(idx, "quantity", parseInt(e.target.value) || 1)}
                                className="w-full p-1.5 rounded-lg border-2 border-orange-400 bg-orange-50/40 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300 font-bold text-xs text-center"
                              />
                            </div>
                            <div className="col-span-4">
                              <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-300 mb-0.5">Đơn giá dự kiến (VNĐ)</label>
                              <input
                                type="number"
                                value={it.estimated_price || ""}
                                onChange={(e) => handlePRItemChange(idx, "estimated_price", parseFloat(e.target.value) || 0)}
                                placeholder="Tùy chọn..."
                                className="w-full p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-mono"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Reason / Notes */}
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Lý Do Đề Xuất / Khách Hàng Mục Tiêu</label>
                <textarea
                  rows={2}
                  value={prForm.description}
                  onChange={(e) => setPRForm({ ...prForm, description: e.target.value })}
                  placeholder="Ghi rõ lý do thiếu hàng, dự án bệnh viện, CDC hoặc viện nghiên cứu sử dụng..."
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-medium"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setIsPRModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Hủy
              </button>
              <button
                onClick={handleSavePR}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm cursor-pointer"
              >
                {prForm.id ? "Lưu Cập Nhật PR" : "Gửi Đề Xuất Mua (PR)"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 6: VIEW PURCHASE REQUEST DETAILS                    */}
      {/* ========================================================= */}
      {selectedPRDetail && (
        <div className="fixed inset-0 z-[60] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-5xl w-full p-6 sm:p-7 space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                <FileText className="w-5 h-5" />
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">
                    Chi Tiết Đề Xuất Mua Hàng: {selectedPRDetail.workflow_code}
                  </h3>
                  <div className="text-[11px] text-slate-500">
                    Người tạo: <strong>{selectedPRDetail.requester_name}</strong> ({selectedPRDetail.requester_dept})
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedPRDetail(null)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800 grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <span className="text-[10px] text-slate-400 block">Tiêu đề</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{selectedPRDetail.title}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Ưu tiên</span>
                  <span className="font-bold text-orange-600">{selectedPRDetail.priority}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Hạn cần hàng</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{formatDate(selectedPRDetail.due_date)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Trạng thái</span>
                  <span className="font-bold text-indigo-600">{selectedPRDetail.status}</span>
                </div>
              </div>

              {/* PO Status Overview Banner */}
              {(() => {
                const summary = getPRPOSummary(selectedPRDetail);
                if (summary.isFullyConverted) {
                  return (
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-950/50 rounded-xl border border-emerald-200 dark:border-emerald-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 text-emerald-800 dark:text-emerald-300">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                        <div>
                          <div className="font-bold text-xs">
                            Đề xuất này đã hoàn thành tạo PO cho toàn bộ {summary.totalItems} mặt hàng!
                          </div>
                          <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                            Mã PO liên kết: <strong className="font-mono">{summary.poCodes.join(", ") || "Đã lập PO"}</strong>
                          </div>
                        </div>
                      </div>
                      {summary.linkedPOs.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const po = summary.linkedPOs[0];
                            setSelectedPRDetail(null);
                            setSelectedPODetail(po);
                          }}
                          className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 shrink-0 flex items-center gap-1.5 cursor-pointer shadow-xs"
                        >
                          <Eye className="w-3.5 h-3.5" /> Xem đơn PO ({summary.linkedPOs[0].po_code})
                        </button>
                      )}
                    </div>
                  );
                }
                if (summary.isPartiallyConverted) {
                  return (
                    <div className="p-3 bg-purple-50 dark:bg-purple-950/50 rounded-xl border border-purple-200 dark:border-purple-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 text-purple-900 dark:text-purple-300">
                        <Sparkles className="w-5 h-5 text-purple-600 shrink-0" />
                        <div>
                          <div className="font-bold text-xs">
                            Đã chuyển PO một phần: {summary.convertedCount}/{summary.totalItems} mặt hàng đã có PO, còn {summary.pendingCount} mặt hàng chưa tạo PO.
                          </div>
                          <div className="text-[11px] text-purple-700 dark:text-purple-400 mt-0.5">
                            Mã PO đã lập: <strong className="font-mono">{summary.poCodes.join(", ") || "Chưa có"}</strong>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const pr = selectedPRDetail;
                          setSelectedPRDetail(null);
                          handleConvertPRToPO(pr);
                        }}
                        className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-orange-600 text-white hover:bg-orange-700 shrink-0 flex items-center gap-1.5 cursor-pointer shadow-xs"
                      >
                        <ShoppingCart className="w-3.5 h-3.5" /> Lên PO cho {summary.pendingCount} mã còn lại
                      </button>
                    </div>
                  );
                }
                return (
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                      <Clock className="w-4 h-4 text-slate-500 shrink-0" />
                      <span className="text-xs">Đề xuất này đang <strong>Chờ Xử Lý</strong> (Chưa có mặt hàng nào được lập đơn PO).</span>
                    </div>
                  </div>
                );
              })()}

              {/* Items Table */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-bold text-slate-800 dark:text-slate-200">Danh Sách Mặt Hàng & Tình Trạng Lập PO</h4>
                  <span className="text-[11px] text-slate-500">
                    Bấm vào mã PO ở từng dòng để mở xem chi tiết đơn PO tương ứng
                  </span>
                </div>
                {(() => {
                  const items = getPRItems(selectedPRDetail).filter(
                    (it: any) => !it.is_missing_catalog_product && it.product_code
                  );

                  if (items.length > 0) {
                    return (
                      <table className="w-full text-left border-collapse border border-slate-200 dark:border-slate-700 text-xs">
                        <thead>
                          <tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700 text-[11px]">
                            <th className="p-2 border-r border-slate-200 dark:border-slate-700 text-center w-10">STT</th>
                            <th className="p-2 border-r border-slate-200 dark:border-slate-700">Mã Hàng</th>
                            <th className="p-2 border-r border-slate-200 dark:border-slate-700">Tên Mặt Hàng</th>
                            <th className="p-2 border-r border-slate-200 dark:border-slate-700">Qui Cách</th>
                            <th className="p-2 border-r border-slate-200 dark:border-slate-700 text-center">ĐVT</th>
                            <th className="p-2 border-r border-slate-200 dark:border-slate-700 text-center">Số Lượng</th>
                            <th className="p-2 border-r border-slate-200 dark:border-slate-700 text-center" title="Ảnh chụp lúc Kinh doanh lập PR: tồn kho / chờ giao cho các đơn trước / khả dụng (rê chuột để xem đơn)">Kho lúc lập PR</th>
                            <th className="p-2 border-r border-slate-200 dark:border-slate-700 text-center">Trạng Thái PO</th>
                            <th className="p-2 text-center">Mã PO Liên Kết</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                          {items.map((it: any, i: number) => {
                            const itemPO = getItemPOInfo(selectedPRDetail, it, i);
                            return (
                              <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                                <td className="p-2 border-r border-slate-200 dark:border-slate-700 text-center">{i + 1}</td>
                                <td className="p-2 border-r border-slate-200 dark:border-slate-700 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                                  <ItemStockHover code={it.product_code} getInfo={getItemDemandInfo}>{it.product_code}</ItemStockHover>
                                </td>
                                <td className="p-2 border-r border-slate-200 dark:border-slate-700 font-medium">
                                  <div>{it.product_name}</div>
                                  {it.is_custom && (
                                    <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-400">
                                      Hàng mới mua lần đầu
                                    </span>
                                  )}
                                </td>
                                <td className="p-2 border-r border-slate-200 dark:border-slate-700 text-slate-500">
                                  {it.specification || "-"}
                                </td>
                                <td className="p-2 border-r border-slate-200 dark:border-slate-700 text-center font-bold">
                                  {it.unit || "Cái"}
                                </td>
                                <td className="p-2 border-r border-slate-200 dark:border-slate-700 text-center font-bold text-orange-600 font-mono">
                                  {it.quantity}
                                </td>
                                <td
                                  className="p-2 border-r border-slate-200 dark:border-slate-700 text-center font-mono text-[11px] whitespace-nowrap cursor-help"
                                  title={Array.isArray(it.pending_delivery_orders) && it.pending_delivery_orders.length > 0
                                    ? `Chờ giao cho:\n${it.pending_delivery_orders.map((p: any) => `• ${p.order}${p.customer ? ` – ${p.customer}` : ""}: ${p.qty}`).join("\n")}`
                                    : (it.stock_on_hand !== undefined ? "Không có đơn trước nào chờ giao mã này" : "PR lập trước khi có ghi nhận tồn kho")}
                                >
                                  {it.stock_on_hand !== undefined ? (
                                    <span>
                                      Tồn <strong>{it.stock_on_hand}</strong>
                                      {" • "}<span className="text-amber-600 dark:text-amber-400">Chờ giao <strong>{it.pending_delivery_qty || 0}</strong></span>
                                      {" • "}<span className="text-emerald-600 dark:text-emerald-400">KD <strong>{it.stock_available ?? 0}</strong></span>
                                    </span>
                                  ) : <span className="text-slate-400">—</span>}
                                </td>
                                <td className="p-2 border-r border-slate-200 dark:border-slate-700 text-center whitespace-nowrap">
                                  {itemPO.hasPO ? (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 inline-flex items-center gap-1">
                                      <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Đã tạo PO
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800 inline-flex items-center gap-1">
                                      <Clock className="w-3 h-3 text-amber-500" /> Chưa tạo PO
                                    </span>
                                  )}
                                </td>
                                <td className="p-2 text-center font-mono whitespace-nowrap">
                                  {itemPO.hasPO && itemPO.poCode ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (itemPO.linkedPO) {
                                          setSelectedPRDetail(null);
                                          setSelectedPODetail(itemPO.linkedPO);
                                        }
                                      }}
                                      className="font-bold text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1 cursor-pointer bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800"
                                      title="Bấm để mở xem chi tiết đơn PO này"
                                    >
                                      <Eye className="w-3 h-3 text-indigo-500" />
                                      <span>{itemPO.poCode}</span>
                                    </button>
                                  ) : (
                                    <span className="text-slate-400 text-[11px] italic">Chờ lên PO</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    );
                  }

                  return (
                    <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-rose-700 dark:text-rose-300">
                        <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                        <span className="text-xs">
                          Phiếu đề xuất này <strong>chưa có Mã sản phẩm và Tên sản phẩm cụ thể</strong> trong Bảng mã sản xuất. Vui lòng chọn sản phẩm cụ thể trước khi lập PO!
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const pr = selectedPRDetail;
                          setSelectedPRDetail(null);
                          handleEditPR(pr);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shrink-0 cursor-pointer"
                      >
                        + Chọn Mã & Tên SP
                      </button>
                    </div>
                  );
                })()}
              </div>

              {selectedPRDetail.description && (
                <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700">
                  <span className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Lý do & Khách hàng mục tiêu:</span>
                  <p className="text-slate-600 dark:text-slate-400 whitespace-pre-line">{selectedPRDetail.description}</p>
                </div>
              )}
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setSelectedPRDetail(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer hover:bg-slate-200"
              >
                Đóng
              </button>
              {(() => {
                const summary = getPRPOSummary(selectedPRDetail);
                if (summary.isFullyConverted) {
                  return (
                    <div className="flex items-center gap-2">
                      {summary.linkedPOs.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPRDetail(null);
                            setSelectedPODetail(summary.linkedPOs[0]);
                          }}
                          className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm flex items-center gap-1.5 cursor-pointer"
                        >
                          <Eye className="w-4 h-4" /> Xem Đơn PO Đã Lập ({summary.poCodes.join(", ")})
                        </button>
                      ) : (
                        <span className="px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Đã Lập Đủ Đơn PO
                        </span>
                      )}
                    </div>
                  );
                }

                if (summary.isPartiallyConverted) {
                  return (
                    <div className="flex items-center gap-2">
                      {summary.linkedPOs.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPRDetail(null);
                            setSelectedPODetail(summary.linkedPOs[0]);
                          }}
                          className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 flex items-center gap-1.5 cursor-pointer"
                        >
                          <Eye className="w-4 h-4" /> Xem PO Đã Lập ({summary.poCodes.join(", ")})
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const pr = selectedPRDetail;
                          setSelectedPRDetail(null);
                          handleConvertPRToPO(pr);
                        }}
                        className="px-4 py-2 rounded-xl text-xs font-bold bg-orange-600 text-white hover:bg-orange-700 shadow-sm flex items-center gap-1.5 cursor-pointer"
                      >
                        <ShoppingCart className="w-4 h-4" /> Lên PO Cho {summary.pendingCount} Mã Còn Lại
                      </button>
                    </div>
                  );
                }

                return (
                  <button
                    type="button"
                    onClick={() => {
                      const pr = selectedPRDetail;
                      setSelectedPRDetail(null);
                      handleConvertPRToPO(pr);
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-orange-600 text-white hover:bg-orange-700 shadow-sm flex items-center gap-1.5 cursor-pointer"
                  >
                    <ShoppingCart className="w-4 h-4" /> Chuyển Thành Đơn Đặt Mua (PO)
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: GOM NHIỀU PR LÊN ĐƠN PO TỔNG HỢP (Yêu cầu 4)       */}
      {/* ========================================================= */}
      {isConsolidateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl w-[96vw] max-w-[1600px] max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-150">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/40 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400">
                  <PackageCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base sm:text-lg">
                    Chọn Sản Phẩm Từ Đề Xuất (PR) Lên Đơn Mua Hàng Tổng (PO)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Chỉ hiển thị các thông tin sản phẩm chuẩn từ Bảng mã sản xuất phục vụ lập PO • Cần xem thông tin người đề xuất / lý do hãy bấm <strong>"Xem PR"</strong>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsConsolidateModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
              {/* Supplier Selection & Delivery Date */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                  <div className="md:col-span-5">
                    <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1.5 uppercase font-mono text-[10px]">
                      Nhà Cung Cấp tiếp nhận đơn tổng (PO) *
                    </label>
                    <select
                      value={consolidateSupplierId}
                      onChange={(e) => {
                        const newSupId = e.target.value;
                        setConsolidateSupplierId(newSupId);
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold outline-none"
                    >
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.supplier_code})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-3">
                    <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1.5 uppercase font-mono text-[10px]">
                      Hạn giao hàng mong muốn *
                    </label>
                    <DateInputVN
                      value={consolidateExpectedDelivery}
                      onChange={(e) => setConsolidateExpectedDelivery(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 font-mono font-bold outline-none"
                    />
                  </div>

                  {/* 1-Click Smart Matching Actions */}
                  <div className="md:col-span-4 flex flex-wrap items-center justify-end gap-2">
                    {(() => {
                      const targetSup = suppliers.find((s) => String(s.id) === String(consolidateSupplierId)) || suppliers[0];
                      return (
                        <>
                          <button
                            type="button"
                            onClick={() => handleAutoSelectBySupplier(targetSup?.id)}
                            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>⚡ Chọn Tất Cả SP Thuộc {targetSup?.short_name || targetSup?.name?.split(" ")[0] || "NCC này"}</span>
                          </button>
                          {selectedItemKeysForConsolidate.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setSelectedItemKeysForConsolidate([])}
                              className="px-2.5 py-2 rounded-xl text-xs text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-semibold cursor-pointer"
                            >
                              ✕ Bỏ chọn ({selectedItemKeysForConsolidate.length})
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Direct Product Selection Table for PO Creation */}
              {(() => {
                const pendingPRs = purchaseRequests.filter(isPRConsolidatable);
                const targetSup = suppliers.find((s) => String(s.id) === String(consolidateSupplierId)) || suppliers[0];

                // Separate valid catalog product rows from invalid PRs missing product code/name
                const validProductRows: Array<{
                  pr: any;
                  prKey: string;
                  it: any;
                  idx: number;
                  itemKey: string;
                  resolved: any;
                  itemSup: any;
                  isMatchSupplier: boolean;
                  isAlreadyPo: boolean;
                  itemPOInfo: any;
                }> = [];

                const invalidPRsWithoutProduct: any[] = [];

                pendingPRs.forEach((pr) => {
                  const prKey = pr.workflow_code || String(pr.id);
                  const items = getPRItems(pr);
                  const hasOnlyMissing = items.every(
                    (it: any) => it.is_missing_catalog_product || !it.product_code || it.product_code === "TBR-ITEM"
                  );
                  if (hasOnlyMissing) {
                    invalidPRsWithoutProduct.push(pr);
                    return;
                  }

                  items.forEach((it: any, idx: number) => {
                    if (it.is_missing_catalog_product || !it.product_code || it.product_code === "TBR-ITEM") {
                      return;
                    }
                    const itemKey = `${prKey}___${idx}`;
                    const resolved = resolveItemSupplierAndPrice(it);
                    const itemSup = resolved.supplier;
                    const isMatchSupplier = Boolean(itemSup && String(itemSup.id) === String(targetSup?.id));
                    const itemPOInfo = getItemPOInfo(pr, it, idx);
                    const isAlreadyPo = Boolean(it.po_code || itemPOInfo.hasPO);

                    validProductRows.push({
                      pr,
                      prKey,
                      it,
                      idx,
                      itemKey,
                      resolved,
                      itemSup,
                      isMatchSupplier,
                      isAlreadyPo,
                      itemPOInfo
                    });
                  });
                });

                const selectableKeys = validProductRows.filter((r) => !r.isAlreadyPo).map((r) => r.itemKey);
                const isAllSelectableChecked =
                  selectableKeys.length > 0 && selectableKeys.every((k) => selectedItemKeysForConsolidate.includes(k));
                const isSomeSelectableChecked =
                  selectableKeys.some((k) => selectedItemKeysForConsolidate.includes(k)) && !isAllSelectableChecked;

                const involvedPRs = new Set<string>();
                let totalEstAmount = 0;
                validProductRows.forEach((r) => {
                  if (selectedItemKeysForConsolidate.includes(r.itemKey)) {
                    involvedPRs.add(r.prKey);
                    const price = r.resolved.unitPrice || Number(r.it.estimated_price) || 0;
                    const qty = Number(r.it.quantity) || 1;
                    totalEstAmount += qty * price;
                  }
                });

                return (
                  <div className="space-y-4">
                    {/* Summary Bar */}
                    <div className="p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-bold text-slate-800 dark:text-white uppercase tracking-wider text-xs">
                          Danh Sách Sản Phẩm Cần Đặt Mua ({validProductRows.filter((r) => !r.isAlreadyPo).length} mã hàng):
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-mono font-bold text-xs">
                          Đã chọn lập PO: {selectedItemKeysForConsolidate.length} sản phẩm ({involvedPRs.size} PR)
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-slate-500 mr-2">Tổng giá trị PO dự kiến:</span>
                        <strong className="font-mono font-black text-indigo-700 dark:text-indigo-300 text-sm">
                          {formatCurrency(totalEstAmount)}
                        </strong>
                      </div>
                    </div>

                    {/* Clean Product Table for PO Selection */}
                    <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-xs">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700">
                            <tr>
                              <th className="py-3 px-3 w-12 text-center">
                                <input
                                  type="checkbox"
                                  checked={isAllSelectableChecked}
                                  ref={(el) => {
                                    if (el) el.indeterminate = isSomeSelectableChecked;
                                  }}
                                  onChange={() => {
                                    if (isAllSelectableChecked) {
                                      setSelectedItemKeysForConsolidate([]);
                                    } else {
                                      setSelectedItemKeysForConsolidate(selectableKeys);
                                    }
                                  }}
                                  className="w-4 h-4 rounded text-emerald-600 cursor-pointer"
                                  title="Chọn / Bỏ chọn tất cả sản phẩm"
                                />
                              </th>
                              <th className="py-3 px-3 w-40">Mã Sản Xuất (SKU)</th>
                              <th className="py-3 px-4 min-w-[220px]">Tên Sản Phẩm Đặt Mua & Quy Cách</th>
                              <th className="py-3 px-2 w-16 text-right">SL Cần</th>
                              <th className="py-3 px-2 w-14 text-center">ĐVT</th>
                              <th className="py-3 px-3 w-32 text-right">Đơn Giá Dự Kiến</th>
                              <th className="py-3 px-3 w-32 text-right">Thành Tiền</th>
                              <th className="py-3 px-3 w-40">Nhà Cung Cấp Phù Hợp</th>
                              <th className="py-3 px-3 w-32 text-center whitespace-nowrap">Mã PR Nguồn</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {validProductRows.length === 0 ? (
                              <tr>
                                <td colSpan={9} className="py-8 text-center text-slate-500 dark:text-slate-400">
                                  Chưa có mặt hàng nào có Mã & Tên sản phẩm hợp lệ trong Bảng mã sản xuất đang chờ lập PO.
                                </td>
                              </tr>
                            ) : (
                              validProductRows.map((row) => {
                                const { pr, it, itemKey, resolved, itemSup, isMatchSupplier, isAlreadyPo, itemPOInfo } = row;
                                const isItemSelected = selectedItemKeysForConsolidate.includes(itemKey);
                                const unitPrice = resolved.unitPrice || Number(it.estimated_price) || 0;
                                const qty = Number(it.quantity) || 1;
                                const lineTotal = qty * unitPrice;

                                return (
                                  <tr
                                    key={itemKey}
                                    onClick={() => !isAlreadyPo && toggleItemSelection(itemKey)}
                                    className={`transition-colors ${
                                      isAlreadyPo
                                        ? "opacity-55 bg-slate-100/60 dark:bg-slate-800/30 cursor-not-allowed"
                                        : isItemSelected
                                        ? "cursor-pointer bg-emerald-50/80 dark:bg-emerald-950/40"
                                        : isMatchSupplier
                                        ? "cursor-pointer bg-emerald-50/20 hover:bg-emerald-50/40 dark:bg-emerald-950/10"
                                        : "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                                    }`}
                                  >
                                    {/* Checkbox */}
                                    <td className="py-3 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                                      {isAlreadyPo ? (
                                        <span
                                          className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                                          title={`Đã lập PO: ${it.po_code || itemPOInfo.poCode}`}
                                        >
                                          ĐÃ LÊN PO
                                        </span>
                                      ) : (
                                        <input
                                          type="checkbox"
                                          checked={isItemSelected}
                                          onChange={() => toggleItemSelection(itemKey)}
                                          className="w-4 h-4 rounded text-emerald-600 cursor-pointer"
                                        />
                                      )}
                                    </td>

                                    {/* SKU / Catalog Code */}
                                    <td className="py-3 px-3 font-mono font-bold text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                                      {it.product_code}
                                    </td>

                                    {/* Product Name & Specification */}
                                    <td className="py-3 px-4">
                                      <div className="font-bold text-slate-900 dark:text-white text-xs">
                                        {cleanItemName(it.product_name)}
                                      </div>
                                      {(it.specification || resolved.specification) && (
                                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                                          Quy cách: {it.specification || resolved.specification}
                                        </div>
                                      )}
                                    </td>

                                    {/* Quantity */}
                                    <td className="py-3 px-3 text-right font-mono font-extrabold text-orange-600 dark:text-orange-400 text-sm">
                                      {qty}
                                    </td>

                                    {/* Unit */}
                                    <td className="py-3 px-3 text-center font-semibold text-slate-600 dark:text-slate-300">
                                      {it.unit || resolved.unit || "Hộp"}
                                    </td>

                                    {/* Unit Price */}
                                    <td className="py-3 px-3 text-right font-mono font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                      {unitPrice > 0 ? formatCurrency(unitPrice) : "Theo báo giá"}
                                    </td>

                                    {/* Line Total */}
                                    <td className="py-3 px-3 text-right font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">
                                      {lineTotal > 0 ? formatCurrency(lineTotal) : "-"}
                                    </td>

                                    {/* Suggested Supplier */}
                                    <td className="py-3 px-3 max-w-[11rem]">
                                      {isMatchSupplier ? (
                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                                          <Check className="w-3 h-3" />
                                          Khớp NCC ({itemSup.short_name || itemSup.name?.split(" ")[0]})
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                          NCC: {itemSup?.short_name || itemSup?.name?.split(" ")[0] || "Khác"}
                                        </span>
                                      )}
                                    </td>

                                    {/* Source PR Code + Open PR Button */}
                                    <td className="py-3 px-3 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                      <div className="inline-flex flex-col items-center gap-1">
                                        <span className="font-mono font-bold text-slate-700 dark:text-slate-200 text-[11px]">
                                          {pr.workflow_code}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => setSelectedPRDetail(pr)}
                                          className="px-2 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/70 dark:hover:bg-indigo-900 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-bold text-[10px] inline-flex items-center gap-1 cursor-pointer transition-colors"
                                          title="Mở xem chi tiết PR (Người yêu cầu, bộ phận, lý do, hạn cần...)"
                                        >
                                          <Eye className="w-3 h-3" />
                                          <span>Xem PR</span>
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Warning Section for Legacy/Incomplete PRs missing Product Code & Name */}
                    {invalidPRsWithoutProduct.length > 0 && (
                      <div className="p-3.5 rounded-2xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/70 space-y-2.5">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2 text-rose-700 dark:text-rose-300 font-bold text-xs">
                            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                            <span>
                              Phát hiện {invalidPRsWithoutProduct.length} phiếu yêu cầu chưa có Mã & Tên sản phẩm cụ thể trong Bảng mã sản xuất (Không thể đưa vào PO khi chưa chọn mã sản phẩm):
                            </span>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {invalidPRsWithoutProduct.map((pr) => (
                            <div
                              key={pr.id}
                              className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-rose-200/80 dark:border-rose-800/60 flex items-center justify-between gap-3"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-bold text-rose-600 dark:text-rose-400 text-xs">
                                    {pr.workflow_code}
                                  </span>
                                  <span className="text-[11px] text-slate-600 dark:text-slate-300 truncate font-medium">
                                    "{pr.title}"
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-400 mt-0.5">
                                  Thiếu Mã SKU & Tên hàng chuẩn • Bấm <strong>"Chọn Mã SP"</strong> để bổ sung sản phẩm từ Bảng mã sản xuất
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleEditPR(pr)}
                                  className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] cursor-pointer shadow-2xs"
                                >
                                  + Chọn Mã SP
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setSelectedPRDetail(pr)}
                                  className="px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-[10px] cursor-pointer"
                                >
                                  Xem PR
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Notes */}
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1 text-[10px] uppercase font-mono">
                  Ghi chú đơn đặt mua tổng hợp (PO):
                </label>
                <textarea
                  rows={2}
                  value={consolidateNotes}
                  onChange={(e) => setConsolidateNotes(e.target.value)}
                  placeholder="Ghi chú điều kiện giao hàng, tiến độ thanh toán cho NCC..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none resize-none"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50 dark:bg-slate-800/40 shrink-0">
              <span className="text-xs text-slate-500">
                Sau khi tạo PO tổng, các dòng sản phẩm được chọn sẽ tự động gắn mã PO này. PR chuyển thành <strong className="text-indigo-600 font-mono">CONVERTED</strong>.
              </span>
              <div className="flex items-center gap-2.5 ml-auto flex-wrap">
                <button
                  type="button"
                  onClick={() => setIsConsolidateModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={handleExportConsolidateDraftExcel}
                  title="Xuất các PR / sản phẩm ra file Excel (Sheet 1: Chi tiết từng PR không gộp + Sheet 2: PO Nháp) mà KHÔNG tạo PO tổng trên hệ thống"
                  className="px-4 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <FileSpreadsheet className="w-4 h-4 shrink-0" />
                  <span>
                    {selectedItemKeysForConsolidate.length > 0
                      ? `Xuất Excel PO Nháp / PR (${selectedItemKeysForConsolidate.length} SP - Không tạo PO)`
                      : "Xuất Excel PO Nháp / PR (Không tạo PO)"}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={selectedItemKeysForConsolidate.length === 0 || isSubmittingConsolidate}
                  onClick={handleConsolidatePRsSubmit}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white shadow-sm flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <PackageCheck className="w-4 h-4 shrink-0" />
                  <span>
                    {isSubmittingConsolidate
                      ? "Đang tạo PO..."
                      : `Xác Nhận Tạo PO Tổng (${selectedItemKeysForConsolidate.length} Sản Phẩm)`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Package,
  Plus,
  Search,
  Filter,
  ArrowDownLeft,
  ArrowUpRight,
  AlertTriangle,
  AlertOctagon,
  CalendarClock,
  CheckCircle2,
  Calendar,
  Layers,
  MapPin,
  RefreshCw,
  Building2,
  FileText,
  FileSpreadsheet,
  Download,
  Upload,
  Sparkles,
  X,
  Check,
  Printer,
  ThermometerSnowflake,
  Clock,
  ShoppingCart,
  Megaphone,
  ShieldAlert,
  Flame,
  Snowflake,
  Info,
  Trash2,
  ShieldCheck,
  Truck,
  Eye,
  BookmarkCheck,
  Unlock,
  UserCheck,
  User,
  Users,
  Radio,
  ChevronDown,
  Barcode as BarcodeIcon,
  SlidersHorizontal,
  RotateCcw,
  Edit3
} from "lucide-react";
import * as XLSX from "xlsx";
import { formatCurrency, formatDate } from "@/backend/services/utils";
import { BarcodePrintModal, PrintableItem } from "./BarcodePrintModal";
import { RfidControlHub } from "./RfidControlHub";
import { LotStockView } from "./warehouse/LotStockView";
import { MovementReportView } from "./warehouse/MovementReportView";
import { useNotification } from "@/frontend/contexts/NotificationContext";
import { useAuth } from "@/frontend/contexts/AuthContext";
import { Pager, usePaged, useDebouncedValue } from "@/frontend/components/Pager";
import { useCompanyConfig } from "@/frontend/utils/companyConfig";
import { todayVN, toVNDateString, normalizeExcelDateToISO, normalizeExcelRowDates } from "@/backend/services/dates";
import { DateInputVN, formatDayVN } from "@/frontend/components/DateInputVN";

export const WarehouseModule: React.FC = () => {
  const companyConfig = useCompanyConfig();
  const { notifyActivity } = useNotification();
  const { user: authUser } = useAuth();
  // Người thực hiện mặc định = người đang đăng nhập (không điền sẵn tên một nhân viên cố định)
  const currentUserName = String((authUser as any)?.full_name || (authUser as any)?.name || "");
  const [subTab, setSubTab] = useState<"stock" | "lot_stock" | "movement_report" | "transactions" | "reservations" | "valuation" | "lot_trace" | "excel_center" | "bom_kits" | "rfid_hub">("stock");
  // Mở tab Tồn theo lô đã lọc sẵn một mã (bấm "N lô" ở bảng Tồn kho)
  const [lotStockQuery, setLotStockQuery] = useState("");
  const openLotsOf = (productCode: string) => { setLotStockQuery(productCode); setSubTab("lot_stock"); };

  // Barcode & QR Label Printing Modal states
  const [isBarcodeModalOpen, setIsBarcodeModalOpen] = useState(false);
  const [selectedBarcodeItem, setSelectedBarcodeItem] = useState<PrintableItem | null>(null);

  // Phase 4 States: BOM & Components for Kits & Multi-Unit Goods (Parent-Child Tracking)
  const [productComponents, setProductComponents] = useState<any[]>([]);
  const [selectedBomParent, setSelectedBomParent] = useState<string>("HI-612");
  const [bomSearchQuery, setBomSearchQuery] = useState("");
  const [bomTypeFilter, setBomTypeFilter] = useState<"all" | "kits_only" | "single">("kits_only");
  const [isComponentModalOpen, setIsComponentModalOpen] = useState(false);
  const [isEditingComponent, setIsEditingComponent] = useState(false);
  const [componentFormData, setComponentFormData] = useState<any>({
    id: null,
    parent_product_code: "HI-612",
    component_code: "",
    component_name: "",
    specification: "",
    unit: "Ống",
    quantity_per_kit: 1,
    tracking_type: "LOT",
    storage_condition: "",
    is_mandatory: true,
    notes: ""
  });
  const [isSubmittingComponent, setIsSubmittingComponent] = useState(false);
  const [expandedInboundComponents, setExpandedInboundComponents] = useState<Record<number, boolean>>({ 0: true });

  // Outbound Handover Checklist states
  const [isHandoverModalOpen, setIsHandoverModalOpen] = useState(false);
  const [handoverData, setHandoverData] = useState<any>(null);

  // Phase 3 States: Lot Traceability 360 & Recall (Requirement 14)
  const [traceLotQuery, setTraceLotQuery] = useState("");
  const [traceResult, setTraceResult] = useState<any>(null);
  const [isTracing, setIsTracing] = useState(false);
  const [isRecallModalOpen, setIsRecallModalOpen] = useState(false);
  const [recallReason, setRecallReason] = useState("");
  const [recallSeverity, setRecallSeverity] = useState<"CRITICAL" | "HIGH" | "MEDIUM">("HIGH");
  const [recallQuarantineStock, setRecallQuarantineStock] = useState(true);
  const [isSubmittingRecall, setIsSubmittingRecall] = useState(false);
  const [activeRecallsList, setActiveRecallsList] = useState<any[]>([]);

  // Phase 3 States: Excel Template & Smart Importer (Requirement 16)
  const [selectedExcelTemplateType, setSelectedExcelTemplateType] = useState<"customers" | "products" | "inbound" | "po">("customers");
  const [detectedImportClassification, setDetectedImportClassification] = useState<{
    type: "USERS_PERSONNEL" | "CUSTOMERS" | "PRODUCTS" | "INBOUND_LOT" | "PURCHASE_ORDERS" | "SUPPLIERS" | "UNKNOWN";
    title: string;
    badge: string;
    badgeClass: string;
    sheet1Title: string;
    sheet2Title?: string;
  }>({
    type: "UNKNOWN",
    title: "Chưa xác định",
    badge: "Tự động nhận diện",
    badgeClass: "bg-slate-800 text-slate-300 border border-slate-700",
    sheet1Title: "Sheet 1: Dữ Liệu"
  });
  const [previewImportRows, setPreviewImportRows] = useState<any[]>([]);
  const [previewContactRows, setPreviewContactRows] = useState<any[]>([]);
  const [activePreviewSheetTab, setActivePreviewSheetTab] = useState<"customers" | "contacts">("customers");
  const [isImportingExcel, setIsImportingExcel] = useState(false);
  const [importFileName, setImportFileName] = useState("");
  const [isDraggingGeneralExcel, setIsDraggingGeneralExcel] = useState(false);
  const [isDraggingInboundExcel, setIsDraggingInboundExcel] = useState(false);
  const [isImportingData, setIsImportingData] = useState(false);
  const generalExcelFileInputRef = useRef<HTMLInputElement>(null);
  const [isAtpViewMode, setIsAtpViewMode] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [reservations, setReservations] = useState<any[]>([]);
  const [personnelList, setPersonnelList] = useState<any[]>([]);
  const [customerList, setCustomerList] = useState<any[]>([]);

  // Reservation filter & modal states
  const [selectedRepFilter, setSelectedRepFilter] = useState<string>("all");
  const [isReserveModalOpen, setIsReserveModalOpen] = useState(false);
  const [selectedReserveItem, setSelectedReserveItem] = useState<any>(null);
  const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState(false);
  const [reserveFormData, setReserveFormData] = useState({
    sales_rep_name: "",
    customer_name: "",
    quantity_reserved: 1,
    hold_until_date: toVNDateString(new Date(Date.now() + 7 * 86400000)),
    notes: ""
  });
  const [isSubmittingReserve, setIsSubmittingReserve] = useState(false);

  // Multi-dimensional Risk Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState<"all" | "near_exp" | "low_stock" | "slow_moving" | "safe">("all");
  const [tempFilter, setTempFilter] = useState<"all" | "-20C" | "2-8C" | "room">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // Multi-dimensional Valuation Dynamic Filters & Controls
  const [valFilterBrand, setValFilterBrand] = useState<string>("all");
  const [valFilterCategory, setValFilterCategory] = useState<string>("all");
  const [valFilterStorage, setValFilterStorage] = useState<string>("all");
  const [valFilterRisk, setValFilterRisk] = useState<string>("all");
  const [valFilterWarehouse, setValFilterWarehouse] = useState<string>("all");
  const [valSearchQuery, setValSearchQuery] = useState<string>("");
  const [valViewDimension, setValViewDimension] = useState<"all" | "brand" | "category" | "storage" | "risk" | "warehouse" | "details">("all");

  // Risk Mitigation Modals
  const [isPRModalOpen, setIsPRModalOpen] = useState(false);
  const [selectedPRItem, setSelectedPRItem] = useState<any>(null);
  const [prFormData, setPRFormData] = useState({
    requestedQty: 50,
    urgentLevel: "CAO - Cần gấp phòng ngừa đứt gãy hàng cung ứng",
    notes: "Đề xuất phòng Cung Ứng lập PO khẩn cấp bổ sung tồn an toàn theo quy chuẩn định mức ABT."
  });

  const [isPushSalesModalOpen, setIsPushSalesModalOpen] = useState(false);
  const [selectedPushItem, setSelectedPushItem] = useState<any>(null);
  const [pushSalesFormData, setPushSalesFormData] = useState({
    discountPercent: 15,
    targetDept: "Phòng Kinh Doanh & Ứng Dụng Lâm Sàng",
    priorityStrategy: "FEFO (First Expired, First Out) - Ưu tiên chào thầu / khuyến mãi gói combo viện",
    notes: "Thông báo lô hàng cận hạn, đề xuất bộ phận Sales phối hợp xả hàng và ưu tiên xuất kho FEFO."
  });

  // Action feedback alert
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Inbound Modal (Single Item)

  // Inbound Modal (Full Detail Multi-Item Form)
  const [isInboundModalOpen, setIsInboundModalOpen] = useState(false);
  const [isSubmittingInbound, setIsSubmittingInbound] = useState(false);
  const [inboundForm, setInboundForm] = useState<any>({
    transaction_code: "",
    date: todayVN(),
    inbound_type: "Nhập mua hàng theo Đơn PO từ NCC",
    reference_code: "",
    vat_invoice_no: "",
    supplier_name: "",
    warehouse_name: "Kho Trung Tâm",
    performed_by: currentUserName,
    shipping_unit: "",
    notes: "",
    items: [
      {
        product_code: "",
        product_name: "",
        specification: "",
        unit: "Hộp",
        quantity: 1,
        unit_price: 0,
        lot_number: "",
        manufacture_date: "",
        expiry_date: "",
        storage_condition: "15–25°C (Nhiệt độ phòng - RT)",
        shelf_position: "Chưa phân bổ kệ",
        qc_status: "Đạt chuẩn 100% (Nguyên niêm phong & COA)",
        item_notes: "",
        components: []
      }
    ]
  });

  // ==================== EDIT STOCK LOT & STORAGE MODAL STATES ====================
  const [isEditStockModalOpen, setIsEditStockModalOpen] = useState(false);
  const [editingStockItem, setEditingStockItem] = useState<any>(null);
  const [isSavingStockEdit, setIsSavingStockEdit] = useState(false);
  const [editStockForm, setEditStockForm] = useState({
    product_code: "",
    product_name: "",
    old_lot_number: "",
    lot_number: "",
    expiry_date: "",
    cost_price: 0,
    quantity_on_hand: 0,
    unit: "Hộp",
    storage_condition: "15–25°C (Nhiệt độ phòng - RT)",
    custom_storage_condition: "",
    warehouse_location: "Kho Trung Tâm",
    shelf_position: "Chưa phân bổ kệ"
  });

  // Outbound Modal
  const [isOutboundModalOpen, setIsOutboundModalOpen] = useState(false);
  const [isSubmittingOutbound, setIsSubmittingOutbound] = useState(false);
  // Mã chứng từ cố định cho một lần lập phiếu: gửi lại (bấm 2 lần / thử lại sau lỗi mạng) không trừ kho 2 lần
  const outboundCodeRef = useRef<string | null>(null);
  const excelInboundCodeRef = useRef<string | null>(null);
  const [outboundForm, setOutboundForm] = useState<any>({
    reference_code: "",
    performed_by: currentUserName,
    warehouse_name: "Kho Trung Tâm",
    items: [{ product_code: "", product_name: "", quantity: 1, lot_number: "" }],
    notes: ""
  });

  // ==================== EXCEL INBOUND MODAL STATES ====================
  const [isExcelInboundModalOpen, setIsExcelInboundModalOpen] = useState(false);
  const [excelInboundRows, setExcelInboundRows] = useState<any[]>([]);
  const [excelInboundFileName, setExcelInboundFileName] = useState("");
  const [excelInboundDetails, setExcelInboundDetails] = useState({
    supplier_name: "",
    reference_code: "",
    vat_invoice_no: "",
    inbound_reason: "Nhập mua hàng theo PO từ Nhà cung cấp",
    warehouse_name: "Kho Trung Tâm",
    performed_by: currentUserName,
    notes: ""
  });
  const [isSubmittingExcelInbound, setIsSubmittingExcelInbound] = useState(false);
  const excelFileInputRef = useRef<HTMLInputElement>(null);

  // Detail Modal for a Transaction
  const [selectedTxDetail, setSelectedTxDetail] = useState<any>(null);
  const [isTxDetailModalOpen, setIsTxDetailModalOpen] = useState(false);

  // Phụ kiện đính kèm theo từng Lô hàng (BOM & Component Tracking in-place)
  const [expandedItemComponents, setExpandedItemComponents] = useState<Record<string, boolean>>({});
  const [selectedKitModalItem, setSelectedKitModalItem] = useState<any>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/inventory?action=overview");
      const data = await res.json();
      if (data) {
        setItems(data.items || []);
        setTransactions(data.transactions || []);
        setProducts(data.products || []);
        setReservations(data.reservations || []);
        if (data.product_components) {
          setProductComponents(data.product_components);
        }
        if (data.personnel) {
          setPersonnelList(data.personnel);
        }
        if (data.customers) {
          setCustomerList(data.customers);
        }
      }
    } catch (e) {
      console.error("Failed to load inventory:", e);
    } finally {
      setLoading(false);
    }
  };

  // Real ABT Staff Mappings
  const salesStaff = useMemo(() => {
    const list = personnelList.filter(p => 
      p.department === "Kinh Doanh" || 
      p.department === "Ban Giám Đốc" || 
      p.department === "Marketing"
    );
    return list;
  }, [personnelList]);

  const warehouseStaff = useMemo(() => {
    const list = personnelList.filter(p => p.department === "Kho Vận");
    return list;
  }, [personnelList]);

  // Real Hospital & Customer Mappings (Requirement: Searchable combobox + Click to pick)
  const allAvailableCustomers = useMemo(() => {
    return customerList || [];
  }, [customerList]);

  const filteredCustomers = useMemo(() => {
    const q = (reserveFormData.customer_name || "").toLowerCase().trim();
    if (!q) return allAvailableCustomers;
    return allAvailableCustomers.filter((c: any) => 
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.customer_code && c.customer_code.toLowerCase().includes(q)) ||
      (c.province && c.province.toLowerCase().includes(q)) ||
      (c.classification && c.classification.toLowerCase().includes(q))
    );
  }, [allAvailableCustomers, reserveFormData.customer_name]);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const handleNav = (e: any) => {
      if (e.detail && (e.detail.tab === "warehouse" || !e.detail.tab)) {
        if (e.detail.subTab) {
          if (["stock", "transactions", "reservations", "valuation"].includes(e.detail.subTab)) {
            setSubTab(e.detail.subTab);
          }
        }
      }
    };
    window.addEventListener("tbr-navigate" as any, handleNav);
    return () => window.removeEventListener("tbr-navigate" as any, handleNav);
  }, []);

  // O(1) lookup maps for 5,000+ products and BOM components to avoid O(N^2) main-thread freezes
  const productByCodeMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const p of products) {
      if (!p?.code) continue;
      const raw = String(p.code);
      const norm = raw.trim().toLowerCase();
      map.set(raw, p);
      if (!map.has(norm)) map.set(norm, p);
    }
    return map;
  }, [products]);

  const componentsByParentMap = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const c of productComponents) {
      const parent = c?.parent_product_code;
      if (!parent) continue;
      const list = map.get(parent);
      if (list) list.push(c);
      else map.set(parent, [c]);
    }
    return map;
  }, [productComponents]);

  // Enriched items with risk metadata & ATP metrics (Requirement 1 & 7)
  const enrichedItems = useMemo(() => {
    return items.map((item) => {
      // Dynamic properties read directly from real inventory item
      // Mã nhiều lô: hiện lô hết hạn sớm nhất (FEFO) thay cho lô ghi trên dòng tồn của mã
      const isoToVN = (v: string) => (/^\d{4}-\d{2}-\d{2}/.test(v) ? `${v.slice(8, 10)}.${v.slice(5, 7)}.${v.slice(0, 4)}` : v);
      const rawItemCode = String(item.product_code || item.code || "");
      const matchedCatalogProd = productByCodeMap.get(rawItemCode) || productByCodeMap.get(rawItemCode.trim().toLowerCase());
      let lot_number = item.earliest_lot || item.lot_number || "";
      let expiry_date = item.earliest_lot ? (item.earliest_expiry ? isoToVN(String(item.earliest_expiry)) : "") : (item.expiry_date || "");
      let storage_temp =
        item.storage_temp ||
        item.storage_condition ||
        matchedCatalogProd?.storage_condition ||
        matchedCatalogProd?.storageCondition ||
        "15–25°C (Nhiệt độ phòng - RT)";
      let shelf_position =
        item.shelf_position ||
        matchedCatalogProd?.shelf_position ||
        matchedCatalogProd?.default_shelf ||
        "Chưa phân bổ kệ";
      let temp_category: "-20C" | "2-8C" | "room" = "room";
      const sTemp = storage_temp.toLowerCase();
      if (sTemp.includes("-20") || sTemp.includes("-80") || sTemp.includes("âm")) {
        temp_category = "-20C";
      } else if (sTemp.includes("2-8") || sTemp.includes("2–8") || sTemp.includes("mát") || sTemp.includes("lạnh")) {
        temp_category = "2-8C";
      }

      let category_key: "diagnostic" | "extraction" | "equipment" | "consumable" = "consumable";
      const cat = (item.category || "").toUpperCase();
      if (cat.includes("TÁCH CHIẾT") || cat.includes("EXTRACTION")) {
        category_key = "extraction";
      } else if (cat.includes("SHPT") || cat.includes("PCR") || cat.includes("SINH PHẨM") || cat.includes("CHẨN ĐOÁN")) {
        category_key = "diagnostic";
      } else if (cat.includes("THIẾT BỊ") || cat.includes("EQUIPMENT")) {
        category_key = "equipment";
      }

      // Map to 10 Standard Commercial Industry Categories (Danh Mục Ngành Hàng Chuẩn Doanh Nghiệp)
      let industry_category = "Vật tư tiêu hao";
      const pCode = (item.product_code || item.code || "").toUpperCase();
      const pName = (item.product_name || item.name || "").toLowerCase();
      const pCat = (item.category || "").toUpperCase();

      if (pCode.startsWith("DG-") || pCat.includes("CHUYỂN ĐỔI SỐ") || pName.includes("phần mềm") || pName.includes("lims") || pName.includes("smartlab") || pName.includes("bản quyền")) {
        industry_category = "Chuyển đổi số";
      } else if (pCat.includes("TÁCH CHIẾT") || pCat.includes("EXTRACTION") || pCode.startsWith("HI-") || pCode.startsWith("HM-") || pCode.startsWith("HE-") || pName.includes("tách chiết") || pName.includes("extraction")) {
        industry_category = "Kit Tách chiết";
      } else if (pCat.includes("SHPT") || pCat.includes("PCR") || pCat.includes("SINH PHẨM") || pCode.startsWith("SQH-") || pName.includes("pcr") || pName.includes("qpcr") || pName.includes("mastermix") || pName.includes("topsensi") || pName.includes("h.pylori")) {
        industry_category = "Kit PCR / qPCR";
      } else if (pCat.includes("HÓA CHẤT") || pCat.includes("THUỐC NHUỘM") || pName.includes("hóa chất") || pName.includes("thuốc nhuộm") || pName.includes("enzyme") || pName.includes("buffer")) {
        industry_category = "Hóa chất / Thuốc nhuộm";
      } else if (pCat.includes("CHUYÊN SÂU") || pCode.startsWith("EQ-") || pName.includes("realtime") || pName.includes("real-time") || pName.includes("giải trình tự") || pName.includes("tự động 96") || pName.includes("tự động 32")) {
        industry_category = "Thiết bị chuyên sâu";
      } else if (pCat.includes("CƠ BẢN") || pName.includes("máy ly tâm") || pName.includes("vortex") || pName.includes("tủ ấm") || pName.includes("nồi hấp") || pName.includes("tủ an toàn")) {
        industry_category = "Thiết bị cơ bản";
      } else if (pCat.includes("THIẾT BỊ TM") || pCat.includes("THƯƠNG MẠI") || pName.includes("thiết bị tm")) {
        industry_category = "Thiết bị TM khác";
      } else if (pCat.includes("TIÊU HAO") || pCat.includes("VẬT TƯ") || pName.includes("tip") || pName.includes("tube") || pName.includes("plate") || pName.includes("găng tay")) {
        industry_category = "Vật tư tiêu hao";
      } else if (pCat.includes("DỤNG CỤ") || pName.includes("pipet") || pName.includes("micropipet")) {
        industry_category = "Dụng cụ";
      } else if (pCat.includes("DỊCH VỤ") || pName.includes("bảo dưỡng") || pName.includes("hiệu chuẩn") || pName.includes("đào tạo")) {
        industry_category = "Dịch vụ & Khác";
      } else if (item.category) {
        industry_category = item.category;
      }
      let days_inactive = Number(item.days_inactive) || 5;

      // Calculate days to expiry safely supporting DD.MM.YYYY, DD/MM/YYYY, and YYYY-MM-DD
      let days_to_expiry = 999;
      if (expiry_date) {
        let expDate: Date | null = null;
        const s = String(expiry_date).trim();
        if (s.includes(".") || s.includes("/")) {
          const parts = s.split(/[./-]/);
          if (parts.length === 3) {
            if (parts[0].length === 4) {
              expDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            } else {
              expDate = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
            }
          }
        } else {
          expDate = new Date(s);
        }
        if (expDate && !isNaN(expDate.getTime())) {
          const now = new Date();
          const diffTime = expDate.getTime() - now.getTime();
          days_to_expiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }
      }

      // Risk status determination
      const isExpired = days_to_expiry <= 0;
      const isNearExpiry = days_to_expiry > 0 && days_to_expiry <= 90;
      const isStockoutRisk = Number(item.quantity_on_hand) <= Number(item.min_stock_level || 10);
      const isSlowMoving = days_inactive >= 60;

      let primaryRisk: "expired" | "near_exp" | "low_stock" | "slow_moving" | "safe" = "safe";
      if (isExpired) primaryRisk = "expired";
      else if (isNearExpiry) primaryRisk = "near_exp";
      else if (isStockoutRisk) primaryRisk = "low_stock";
      else if (isSlowMoving) primaryRisk = "slow_moving";

      const onHand = Number(item.quantity_on_hand) || 0;
      const allocated = Number(item.quantity_allocated || 0);
      const available = Math.max(0, onHand - allocated);
      const incomingQty = Number(item.incoming_po_qty || 0);
      const atpQty = onHand - allocated + incomingQty;

      // ATP Promise Status (Requirement 7)
      let atpPromiseStatus: "READY" | "CONDITIONAL_PO" | "OUT_OF_STOCK" = "OUT_OF_STOCK";
      if (onHand - allocated > 0) {
        atpPromiseStatus = "READY";
      } else if (atpQty > 0) {
        atpPromiseStatus = "CONDITIONAL_PO";
      }

      // Valuation Prices & Manufacturer (Requirement 1)
      const costPrice = Number(item.cost_price) > 0 
        ? Number(item.cost_price) 
        : (Number(matchedCatalogProd?.cost_price) > 0
          ? Number(matchedCatalogProd.cost_price)
          : (Number(item.standard_price) > 0 ? Math.round(Number(item.standard_price) * 0.7) : 0));
      const standardPrice = Number(item.standard_price) > 0 
        ? Number(item.standard_price) 
        : (Number(matchedCatalogProd?.standard_price) > 0 ? Number(matchedCatalogProd.standard_price) : costPrice);
      // Hãng sản xuất lấy từ tồn kho / danh mục; không tự đoán theo tiền tố mã hàng
      const manufacturer = item.manufacturer || matchedCatalogProd?.manufacturer || "";

      return {
        ...item,
        lot_number,
        expiry_date,
        storage_temp,
        storage_condition: storage_temp,
        shelf_position,
        temp_category,
        category_key,
        industry_category,
        days_inactive,
        days_to_expiry,
        isExpired,
        isNearExpiry,
        isStockoutRisk,
        isSlowMoving,
        primaryRisk,
        cost_price: costPrice,
        standard_price: standardPrice,
        manufacturer,
        quantity_on_hand: onHand,
        quantity_allocated: allocated,
        quantity_available: available,
        incoming_po_qty: incomingQty,
        incoming_pos: item.incoming_pos || [],
        atp_qty: atpQty,
        atp_promise_status: atpPromiseStatus
      };
    });
  }, [items, products]);

  // Available Valuation Dynamic Filter Options
  const availableValuationBrands = useMemo(() => {
    const set = new Set<string>();
    enrichedItems.forEach(it => { if (it.manufacturer) set.add(it.manufacturer); });
    return Array.from(set).sort();
  }, [enrichedItems]);

  const availableValuationCategories = useMemo(() => {
    const set = new Set<string>();
    enrichedItems.forEach(it => { if (it.category) set.add(it.category); });
    return Array.from(set).sort();
  }, [enrichedItems]);

  const availableValuationWarehouses = useMemo(() => {
    const set = new Set<string>();
    enrichedItems.forEach(it => {
      const w = it.warehouse_name || it.warehouse_id;
      if (w) set.add(w);
    });
    if (set.size === 0) set.add("Kho Trung Tâm");
    return Array.from(set).sort();
  }, [enrichedItems]);

  const filteredValuationItems = useMemo(() => {
    return enrichedItems.filter((it) => {
      if (valFilterBrand !== "all" && it.manufacturer !== valFilterBrand) return false;
      if (valFilterCategory !== "all") {
        const indCat = (it.industry_category || "").toLowerCase();
        const rawCat = (it.category || "").toLowerCase();
        const target = valFilterCategory.toLowerCase();
        const matchInd = indCat === target;
        const matchRaw = rawCat === target || rawCat.includes(target);
        const matchAlias = (valFilterCategory === "Kit PCR / qPCR" && (rawCat.includes("shpt") || rawCat.includes("pcr")))
          || (valFilterCategory === "Kit Tách chiết" && (rawCat.includes("tách chiết") || rawCat.includes("extraction")))
          || (valFilterCategory === "Chuyển đổi số" && (it.product_code || "").startsWith("DG-"));
        if (!matchInd && !matchRaw && !matchAlias) return false;
      }
      if (valFilterStorage !== "all") {
        const sc = (it.storage_condition || it.storage_temp || "").toLowerCase();
        if (valFilterStorage === "-20C" && !sc.includes("-20") && !sc.includes("đông") && it.temp_category !== "-20C") return false;
        if (valFilterStorage === "2-8C" && !sc.includes("2-8") && !sc.includes("lạnh") && it.temp_category !== "2-8C") return false;
        if (valFilterStorage === "room" && !sc.includes("phòng") && !sc.includes("15-25") && !sc.includes("thường") && it.temp_category !== "room") return false;
      }
      if (valFilterRisk !== "all") {
        if (valFilterRisk === "safe" && (it.isNearExpiry || it.isExpired || it.isSlowMoving)) return false;
        if (valFilterRisk === "near_exp" && !it.isNearExpiry) return false;
        if (valFilterRisk === "expired" && !it.isExpired) return false;
        if (valFilterRisk === "slow_moving" && !it.isSlowMoving) return false;
        if (valFilterRisk === "low_stock" && !it.isStockoutRisk) return false;
      }
      if (valFilterWarehouse !== "all") {
        const wh = it.warehouse_name || it.warehouse_id || "Kho Trung Tâm";
        if (wh !== valFilterWarehouse) return false;
      }
      if (valSearchQuery.trim()) {
        const q = valSearchQuery.toLowerCase().trim();
        const matchCode = (it.product_code || "").toLowerCase().includes(q);
        const matchName = (it.product_name || "").toLowerCase().includes(q);
        const matchLot = (it.lot_number || it.batch_lot || "").toLowerCase().includes(q);
        const matchBrand = (it.manufacturer || "").toLowerCase().includes(q);
        if (!matchCode && !matchName && !matchLot && !matchBrand) return false;
      }
      return true;
    });
  }, [enrichedItems, valFilterBrand, valFilterCategory, valFilterStorage, valFilterRisk, valFilterWarehouse, valSearchQuery]);

  const activeValFilterCount = useMemo(() => {
    let count = 0;
    if (valFilterBrand !== "all") count++;
    if (valFilterCategory !== "all") count++;
    if (valFilterStorage !== "all") count++;
    if (valFilterRisk !== "all") count++;
    if (valFilterWarehouse !== "all") count++;
    if (valSearchQuery.trim()) count++;
    return count;
  }, [valFilterBrand, valFilterCategory, valFilterStorage, valFilterRisk, valFilterWarehouse, valSearchQuery]);

  const handleResetValuationFilters = () => {
    setValFilterBrand("all");
    setValFilterCategory("all");
    setValFilterStorage("all");
    setValFilterRisk("all");
    setValFilterWarehouse("all");
    setValSearchQuery("");
  };

  // Multi-dimensional Valuation summary by Brand, Category, Storage, Risk, Warehouse & SKU Details
  const valuationData = useMemo(() => {
    let totalCostVal = 0;
    let totalListVal = 0;
    const byBrandMap: Record<string, { brand: string; count: number; totalQty: number; costVal: number; listVal: number }> = {};
    const byCatMap: Record<string, { category: string; icon?: string; count: number; totalQty: number; costVal: number; listVal: number }> = {
      "Kit PCR / qPCR": { category: "Kit PCR / qPCR", icon: "🧬", count: 0, totalQty: 0, costVal: 0, listVal: 0 },
      "Kit Tách chiết": { category: "Kit Tách chiết", icon: "🧪", count: 0, totalQty: 0, costVal: 0, listVal: 0 },
      "Hóa chất / Thuốc nhuộm": { category: "Hóa chất / Thuốc nhuộm", icon: "🧴", count: 0, totalQty: 0, costVal: 0, listVal: 0 },
      "Thiết bị cơ bản": { category: "Thiết bị cơ bản", icon: "🏢", count: 0, totalQty: 0, costVal: 0, listVal: 0 },
      "Thiết bị chuyên sâu": { category: "Thiết bị chuyên sâu", icon: "🔬", count: 0, totalQty: 0, costVal: 0, listVal: 0 },
      "Thiết bị TM khác": { category: "Thiết bị TM khác", icon: "🛒", count: 0, totalQty: 0, costVal: 0, listVal: 0 },
      "Chuyển đổi số": { category: "Chuyển đổi số", icon: "💻", count: 0, totalQty: 0, costVal: 0, listVal: 0 },
      "Vật tư tiêu hao": { category: "Vật tư tiêu hao", icon: "📦", count: 0, totalQty: 0, costVal: 0, listVal: 0 },
      "Dụng cụ": { category: "Dụng cụ", icon: "🧪", count: 0, totalQty: 0, costVal: 0, listVal: 0 },
      "Dịch vụ & Khác": { category: "Dịch vụ & Khác", icon: "🛠️", count: 0, totalQty: 0, costVal: 0, listVal: 0 }
    };
    const byStorageMap: Record<string, { storage: string; count: number; totalQty: number; costVal: number; listVal: number }> = {};
    const byRiskMap: Record<string, { risk: string; count: number; totalQty: number; costVal: number; listVal: number }> = {};
    const byWarehouseMap: Record<string, { warehouse: string; count: number; totalQty: number; costVal: number; listVal: number }> = {};

    filteredValuationItems.forEach((it) => {
      const qty = Number(it.quantity_on_hand) || 0;
      const cVal = qty * (Number(it.cost_price) || 0);
      const lVal = qty * (Number(it.standard_price) || 0);
      totalCostVal += cVal;
      totalListVal += lVal;

      // 1. By Brand
      const brand = it.manufacturer || "ABT Phân Phối";
      if (!byBrandMap[brand]) {
        byBrandMap[brand] = { brand, count: 0, totalQty: 0, costVal: 0, listVal: 0 };
      }
      byBrandMap[brand].count += 1;
      byBrandMap[brand].totalQty += qty;
      byBrandMap[brand].costVal += cVal;
      byBrandMap[brand].listVal += lVal;

      // 2. By Category (Pre-populated with 10 Standard Commercial Categories)
      const cat = it.industry_category || it.category || "Vật tư tiêu hao";
      if (!byCatMap[cat]) {
        byCatMap[cat] = { category: cat, count: 0, totalQty: 0, costVal: 0, listVal: 0 };
      }
      byCatMap[cat].count += 1;
      byCatMap[cat].totalQty += qty;
      byCatMap[cat].costVal += cVal;
      byCatMap[cat].listVal += lVal;

      // 3. By Storage Condition
      let storageLabel = "Chưa khai báo nhiệt độ";
      const sc = (it.storage_condition || it.storage_temp || "").toLowerCase();
      if (sc.includes("-20") || it.temp_category === "-20C") storageLabel = "Đông sâu (-20°C)";
      else if (sc.includes("2-8") || it.temp_category === "2-8C") storageLabel = "Lạnh mát (2-8°C)";
      else if (sc.includes("15-25") || sc.includes("phòng") || sc.includes("thường")) storageLabel = "Nhiệt độ phòng (15-25°C)";
      else if (it.storage_condition) storageLabel = it.storage_condition;

      if (!byStorageMap[storageLabel]) {
        byStorageMap[storageLabel] = { storage: storageLabel, count: 0, totalQty: 0, costVal: 0, listVal: 0 };
      }
      byStorageMap[storageLabel].count += 1;
      byStorageMap[storageLabel].totalQty += qty;
      byStorageMap[storageLabel].costVal += cVal;
      byStorageMap[storageLabel].listVal += lVal;

      // 4. By Risk / Shelf Life Status
      let riskLabel = "Hàng An Toàn (> 90 ngày)";
      if (it.isExpired) riskLabel = "Đã Quá Hạn (Expired)";
      else if (it.isNearExpiry) riskLabel = "Cận Date (≤ 90 ngày)";
      else if (it.isSlowMoving) riskLabel = "Chậm Luân Chuyển (> 60 ngày)";
      else if (it.isStockoutRisk) riskLabel = "Tồn Kho Thấp (Dưới định mức)";

      if (!byRiskMap[riskLabel]) {
        byRiskMap[riskLabel] = { risk: riskLabel, count: 0, totalQty: 0, costVal: 0, listVal: 0 };
      }
      byRiskMap[riskLabel].count += 1;
      byRiskMap[riskLabel].totalQty += qty;
      byRiskMap[riskLabel].costVal += cVal;
      byRiskMap[riskLabel].listVal += lVal;

      // 5. By Warehouse
      const wh = it.warehouse_name || it.warehouse_id || "Kho Trung Tâm";
      if (!byWarehouseMap[wh]) {
        byWarehouseMap[wh] = { warehouse: wh, count: 0, totalQty: 0, costVal: 0, listVal: 0 };
      }
      byWarehouseMap[wh].count += 1;
      byWarehouseMap[wh].totalQty += qty;
      byWarehouseMap[wh].costVal += cVal;
      byWarehouseMap[wh].listVal += lVal;
    });

    const expectedProfit = Math.max(0, totalListVal - totalCostVal);
    const profitMargin = totalListVal > 0 ? (expectedProfit / totalListVal) * 100 : 0;

    const mapToList = (m: Record<string, any>) => Object.values(m).map((item) => ({
      ...item,
      share: totalCostVal > 0 ? (item.costVal / totalCostVal) * 100 : 0,
      margin: item.listVal > 0 ? ((item.listVal - item.costVal) / item.listVal) * 100 : 0,
      profit: Math.max(0, item.listVal - item.costVal)
    })).sort((a, b) => b.costVal - a.costVal);

    const brandList = mapToList(byBrandMap);
    const catList = mapToList(byCatMap);
    const storageList = mapToList(byStorageMap);
    const riskList = mapToList(byRiskMap);
    const warehouseList = mapToList(byWarehouseMap);

    const skuDetailsList = filteredValuationItems.map((it) => {
      const qty = Number(it.quantity_on_hand) || 0;
      const cPrice = Number(it.cost_price) || 0;
      const lPrice = Number(it.standard_price) || 0;
      const totalCost = qty * cPrice;
      const totalList = qty * lPrice;
      const profit = Math.max(0, totalList - totalCost);
      const margin = totalList > 0 ? (profit / totalList) * 100 : 0;
      return {
        ...it,
        qty,
        cPrice,
        lPrice,
        totalCost,
        totalList,
        profit,
        margin
      };
    }).sort((a, b) => b.totalCost - a.totalCost);

    return {
      totalCostVal,
      totalListVal,
      expectedProfit,
      profitMargin,
      brandList,
      catList,
      storageList,
      riskList,
      warehouseList,
      skuDetailsList,
      totalSKUs: filteredValuationItems.length,
      totalUnits: filteredValuationItems.reduce((acc, it) => acc + (Number(it.quantity_on_hand) || 0), 0)
    };
  }, [filteredValuationItems]);
  // Danh sách định giá theo mã: vẽ từng trang
  const valuationSkuPage = usePaged(valuationData.skuDetailsList, 100, valuationData.skuDetailsList.length);

  // Phase 3: Trace Lot 360 (Requirement 14)
  const handleTraceLot = async (lotQuery?: string) => {
    const queryLot = (lotQuery !== undefined ? lotQuery : traceLotQuery).trim();
    if (!queryLot) {
      setActionNotice("⚠️ Vui lòng nhập số Lô hoặc chọn sản phẩm cần truy vết!");
      return;
    }
    setIsTracing(true);
    try {
      const res = await fetch(`/api/inventory?action=lot_trace&lot_number=${encodeURIComponent(queryLot)}`);
      if (res.ok) {
        const data = await res.json();
        setTraceResult(data);
        setActionNotice(`✅ Đã truy vết thành công vòng đời Lô: ${queryLot}`);
      } else {
        setActionNotice("❌ Lỗi khi truy vấn dữ liệu truy vết Lô");
      }
    } catch (err) {
      console.error(err);
      setActionNotice("❌ Lỗi kết nối máy chủ");
    } finally {
      setIsTracing(false);
    }
  };

  const handleConfirmLotRecall = async () => {
    if (!traceResult || !recallReason.trim()) {
      alert("Vui lòng nhập lý do thu hồi Lô!");
      return;
    }
    setIsSubmittingRecall(true);
    try {
      const targetLot = traceResult.lot_number || traceLotQuery;
      const targetProd = traceResult.inventory_items?.[0] || {};
      const res = await fetch("/api/inventory?action=lot_recall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_code: targetProd.product_code || "ABT-GENERIC",
          product_name: targetProd.product_name || "Sản phẩm thu hồi",
          lot_number: targetLot,
          reason: recallReason,
          severity: recallSeverity,
          quarantine_stock: recallQuarantineStock,
          reported_by: "Quản Lý QC / Trưởng Kho",
          affected_orders: (traceResult.distributed_customers || []).map((c: any) => c.order_code)
        })
      });
      if (res.ok) {
        const data = await res.json();
        setIsRecallModalOpen(false);
        setActionNotice(`🚨 ĐÃ KÍCH HOẠT LỆNH THU HỒI LÔ ${targetLot} (Mã: ${data.recall_code}). Kho đã được phong tỏa cách ly!`);
        handleTraceLot(targetLot);
        fetchData();
      }
    } catch (err) {
      console.error(err);
      alert("Lỗi kết nối khi kích hoạt thu hồi Lô");
    } finally {
      setIsSubmittingRecall(false);
    }
  };

  const handleReleaseQuarantine = async (lotNumber: string, productCode: string) => {
    if (!confirm(`Bạn có chắc chắn muốn giải tỏa cách ly cho Lô ${lotNumber} (${productCode})?`)) return;
    try {
      const res = await fetch("/api/inventory?action=lot_release_quarantine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lot_number: lotNumber,
          product_code: productCode,
          released_by: "QC Trưởng Phòng",
          reason: "Kiểm nghiệm lại đạt tiêu chuẩn xuất kho"
        })
      });
      if (res.ok) {
        setActionNotice(`✅ Đã giải tỏa cách ly cho Lô ${lotNumber}. Hàng hóa đã đủ điều kiện xuất bán!`);
        handleTraceLot(lotNumber);
        fetchData();
      }
    } catch (err) {
      console.error(err);
      alert("Lỗi khi giải tỏa cách ly Lô");
    }
  };

  const handleExportRecallContactSheet = () => {
    if (!traceResult || !traceResult.distributed_customers || traceResult.distributed_customers.length === 0) {
      alert("Không có danh sách khách hàng để xuất báo cáo!");
      return;
    }
    try {
      const rows = traceResult.distributed_customers.map((c: any, idx: number) => ({
        "STT": idx + 1,
        "Mã Đơn Hàng SO": c.order_code,
        "Khách Hàng / Bệnh Viện": c.customer_name,
        "Mã Sản Phẩm": c.product_code,
        "Tên Sản Phẩm": c.product_name,
        "Số Lô Thu Hồi": c.lot_number || traceResult.lot_number,
        "Số Lượng Đã Giao": c.quantity,
        "Ngày Giao Hàng": c.order_date,
        "NVKD Phụ Trách": c.sales_rep_name || "—",
        "Phương Thức Giao": c.shipping_method || "—",
        "Mã Vận Đơn": c.tracking_code || "—",
        "Trạng Thái Giao": c.delivery_status || "—",
        "Hành Động Khẩn Cấp": "Gọi điện cảnh báo ngừng sử dụng & thu hồi về kho cách ly"
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, "Danh_Sach_Thu_Hoi");
      XLSX.writeFile(wb, `Danh_Sach_Thu_Hoi_Lo_${traceResult.lot_number || "ABT"}_${todayVN()}.xlsx`);
      setActionNotice("✅ Đã xuất thành công Bảng liên hệ thu hồi khách hàng ra file Excel!");
    } catch (e) {
      alert("Lỗi khi xuất file Excel thu hồi");
    }
  };

  // Phase 3: Standard Excel Templates Generator (Requirement 16)
  // Phase 3: Standard Excel Templates Generator (Requirement 16) - 2-Sheet Customer & Multi-Contacts Template
  const handleDownloadCustomerTemplate = () => {
    // Sheet 1: Pháp nhân Khách hàng
    const customerData = [
      {
        "Mã khách hàng (*)": "KH-BV-001",
        "Tên khách hàng / Đơn vị (*)": "Bệnh viện Mẫu A (dòng minh họa - xóa trước khi nhập)",
        "Nhóm khách hàng": "Bệnh viện Quốc tế & Tư nhân",
        "Khu vực (*)": "Miền Bắc",
        "Tỉnh / Thành phố (*)": "Hà Nội",
        "Mã số thuế": "0100000001",
        "Địa chỉ": "Số 1, Đường A, Quận B, Hà Nội",
        "Hạn mức công nợ (VNĐ)": 500000000,
        "Thời hạn nợ tối đa (Ngày)": 45,
        "NVKD phụ trách": "Nguyễn Văn A",
        "Ghi chú chung": "Ví dụ ghi chú khách hàng"
      },
      {
        "Mã khách hàng (*)": "KH-DL-002",
        "Tên khách hàng / Đơn vị (*)": "Công ty TNHH Mẫu B (dòng minh họa - xóa trước khi nhập)",
        "Nhóm khách hàng": "Đại lý phân phối cấp 1",
        "Khu vực (*)": "Miền Nam",
        "Tỉnh / Thành phố (*)": "TP. Hồ Chí Minh",
        "Mã số thuế": "0300000002",
        "Địa chỉ": "Số 2, Đường C, Quận D, TP.HCM",
        "Hạn mức công nợ (VNĐ)": 300000000,
        "Thời hạn nợ tối đa (Ngày)": 30,
        "NVKD phụ trách": "Trần Thị B",
        "Ghi chú chung": "Ví dụ ghi chú đại lý"
      },
      {
        "Mã khách hàng (*)": "KH-BV-003",
        "Tên khách hàng / Đơn vị (*)": "Bệnh viện Mẫu C (dòng minh họa - xóa trước khi nhập)",
        "Nhóm khách hàng": "Bệnh viện Công lập",
        "Khu vực (*)": "Miền Nam",
        "Tỉnh / Thành phố (*)": "TP. Hồ Chí Minh",
        "Mã số thuế": "0300000003",
        "Địa chỉ": "Số 3, Đường E, Quận F, TP.HCM",
        "Hạn mức công nợ (VNĐ)": 800000000,
        "Thời hạn nợ tối đa (Ngày)": 60,
        "NVKD phụ trách": "Lê Văn C",
        "Ghi chú chung": "Ví dụ ghi chú bệnh viện"
      }
    ];

    // Sheet 2: Danh sách Người liên hệ (Quan hệ 1 - Nhiều: 1 Khách hàng - Nhiều Contacts)
    const contactsData = [
      {
        "Mã khách hàng (*)": "KH-BV-001",
        "Họ và tên người liên hệ (*)": "Người liên hệ mẫu 1",
        "Chức vụ / Vị trí": "Trưởng Khoa Xét Nghiệm",
        "Khoa / Phòng ban": "Khoa Sinh học phân tử",
        "Số điện thoại (*)": "0912345678",
        "Email": "lienhe1@example.com",
        "Vai trò quyết định": "Kỹ thuật chuyên môn / Quyết định mua",
        "Đầu mối liên hệ chính?": "Có",
        "Ghi chú cá nhân": "Trao đổi kỹ thuật và chạy thử kit PCR buổi chiều"
      },
      {
        "Mã khách hàng (*)": "KH-BV-001",
        "Họ và tên người liên hệ (*)": "Người liên hệ mẫu 2",
        "Chức vụ / Vị trí": "Kỹ thuật viên trưởng",
        "Khoa / Phòng ban": "Khoa Vi sinh",
        "Số điện thoại (*)": "0987654321",
        "Email": "lienhe2@example.com",
        "Vai trò quyết định": "Kỹ thuật vận hành",
        "Đầu mối liên hệ chính?": "Không",
        "Ghi chú cá nhân": "Người trực tiếp nhận hàng và kiểm tra ngoại quan tại Lab"
      },
      {
        "Mã khách hàng (*)": "KH-BV-001",
        "Họ và tên người liên hệ (*)": "Người liên hệ mẫu 3",
        "Chức vụ / Vị trí": "Chuyên viên Mua hàng",
        "Khoa / Phòng ban": "Phòng Vật tư - TBYT",
        "Số điện thoại (*)": "0903112233",
        "Email": "lienhe3@example.com",
        "Vai trò quyết định": "Thu mua / Báo giá",
        "Đầu mối liên hệ chính?": "Không",
        "Ghi chú cá nhân": "Đầu mối nhận báo giá và đàm phán hợp đồng"
      },
      {
        "Mã khách hàng (*)": "KH-DL-002",
        "Họ và tên người liên hệ (*)": "Người liên hệ mẫu 4",
        "Chức vụ / Vị trí": "Giám đốc Điều hành",
        "Khoa / Phòng ban": "Ban Giám Đốc",
        "Số điện thoại (*)": "0938112233",
        "Email": "lienhe4@example.com",
        "Vai trò quyết định": "Ban Giám đốc / Ký hợp đồng",
        "Đầu mối liên hệ chính?": "Có",
        "Ghi chú cá nhân": "Ký duyệt hợp đồng nguyên tắc đại lý"
      },
      {
        "Mã khách hàng (*)": "KH-DL-002",
        "Họ và tên người liên hệ (*)": "Người liên hệ mẫu 5",
        "Chức vụ / Vị trí": "Kế toán trưởng",
        "Khoa / Phòng ban": "Phòng Tài chính Kế toán",
        "Số điện thoại (*)": "0909887766",
        "Email": "lienhe5@example.com",
        "Vai trò quyết định": "Kế toán thanh toán",
        "Đầu mối liên hệ chính?": "Không",
        "Ghi chú cá nhân": "Đối soát công nợ & hóa đơn điện tử hàng tháng"
      },
      {
        "Mã khách hàng (*)": "KH-BV-003",
        "Họ và tên người liên hệ (*)": "Người liên hệ mẫu 6",
        "Chức vụ / Vị trí": "Trưởng khoa Vi sinh",
        "Khoa / Phòng ban": "Khoa Vi sinh",
        "Số điện thoại (*)": "0900000006",
        "Email": "lienhe6@example.com",
        "Vai trò quyết định": "Kỹ thuật chuyên môn / Quyết định mua",
        "Đầu mối liên hệ chính?": "Có",
        "Ghi chú cá nhân": "Đầu mối chuyên môn trọng điểm phía Nam"
      },
      {
        "Mã khách hàng (*)": "KH-BV-003",
        "Họ và tên người liên hệ (*)": "Người liên hệ mẫu 7",
        "Chức vụ / Vị trí": "Kỹ thuật viên xét nghiệm",
        "Khoa / Phòng ban": "Phòng PCR",
        "Số điện thoại (*)": "0918776655",
        "Email": "lienhe7@example.com",
        "Vai trò quyết định": "Kỹ thuật vận hành",
        "Đầu mối liên hệ chính?": "Không",
        "Ghi chú cá nhân": "Kiểm tra Lot và hạn dùng khi nhận kit"
      }
    ];

    const wsCustomers = XLSX.utils.json_to_sheet(customerData);
    wsCustomers["!cols"] = [
      { wch: 18 }, // Mã KH
      { wch: 45 }, // Tên KH
      { wch: 28 }, // Nhóm KH
      { wch: 18 }, // Khu vực (*)
      { wch: 22 }, // Tỉnh / Thành phố (*)
      { wch: 15 }, // MST
      { wch: 45 }, // Địa chỉ
      { wch: 22 }, // Hạn mức nợ
      { wch: 25 }, // Thời hạn nợ
      { wch: 22 }, // NVKD
      { wch: 40 }  // Ghi chú
    ];

    const wsContacts = XLSX.utils.json_to_sheet(contactsData);
    wsContacts["!cols"] = [
      { wch: 18 }, // Mã KH
      { wch: 28 }, // Họ tên
      { wch: 25 }, // Chức vụ
      { wch: 25 }, // Phòng ban
      { wch: 16 }, // SĐT
      { wch: 25 }, // Email
      { wch: 35 }, // Vai trò
      { wch: 22 }, // Đầu mối chính
      { wch: 45 }  // Ghi chú
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsCustomers, "Thong_Tin_Khach_Hang");
    XLSX.utils.book_append_sheet(wb, wsContacts, "Danh_Sach_Nguoi_Lien_He");
    XLSX.writeFile(wb, "Mau_Nhap_Lieu_Khach_Hang_Va_Nguoi_Lien_He_ABT.xlsx");
  };

  const handleDownloadProductTemplate = () => {
    // Sheet 1: Danh mục Hàng hóa & Chính sách Bảng giá các cấp
    const productsData = products.length > 0 ? products.slice(0, 10).map((p) => ({
      "Mã SKU (*)": p.code,
      "Tên sản phẩm (*)": p.name,
      "Hãng sản xuất (*)": p.manufacturer || "",
      "Nhóm ngành hàng (*)": p.category || "Hóa chất / Sinh phẩm",
      "Quy cách đóng gói": p.specification || "Tiêu chuẩn",
      "Đơn vị tính": p.unit || "Hộp",
      "Điều kiện bảo quản chuẩn": p.storage_condition || "2-8°C (Lạnh mát)",
      "Giá vốn nhập (VNĐ)": Number(p.cost_price) || 0,
      "Giá niêm yết End-User (VNĐ)": Number(p.standard_price) || 0,
      "Giá Đại lý Cấp 1 (VNĐ)": Math.round((Number(p.standard_price) || 0) * 0.85),
      "Giá Đại lý Cấp 2 (VNĐ)": Math.round((Number(p.standard_price) || 0) * 0.8),
      "Mức tồn tối thiểu": p.min_stock || 10,
      "Ghi chú": p.description || ""
    })) : [
      {
        "Mã SKU (*)": "HI-007.A (B32)",
        "Tên sản phẩm (*)": "TopPURE Maga Quick Genomic DNA/RNA Extraction Kit",
        "Hãng sản xuất (*)": "TopPURE (ABT)",
        "Nhóm ngành hàng (*)": "Kit tách chiết",
        "Quy cách đóng gói": "32 tests/hộp",
        "Đơn vị tính": "Hộp",
        "Điều kiện bảo quản chuẩn": "2-8°C (Lạnh mát)",
        "Giá vốn nhập (VNĐ)": 1800000,
        "Giá niêm yết End-User (VNĐ)": 2800000,
        "Giá Đại lý Cấp 1 (VNĐ)": 2380000,
        "Giá Đại lý Cấp 2 (VNĐ)": 2240000,
        "Mức tồn tối thiểu": 15,
        "Ghi chú": "Bộ kit tách chiết từ mẫu vi sinh và bệnh phẩm"
      }
    ];

    // Sheet 2: Định mức Phụ kiện & Linh kiện cấu thành (BOM - Cấu trúc Bộ/Kit)
    const componentsData = productComponents.length > 0 ? productComponents.map((c) => ({
      "Mã SKU cha (*)": c.parent_product_code,
      "Mã phụ kiện / Thành phần (*)": c.component_code,
      "Tên phụ kiện / Thành phần (*)": c.component_name,
      "Quy cách": c.specification || "Tiêu chuẩn",
      "Đơn vị tính": c.unit || "Hộp",
      "Định mức theo bộ (*)": Number(c.quantity_per_kit) || 1,
      "Hình thức quản lý (LOT/SERIAL)": c.tracking_type || "LOT",
      "Điều kiện bảo quản tiêu chuẩn": c.storage_condition || "2-8°C (Lạnh mát)",
      "Ghi chú": c.notes || ""
    })) : [
      {
        "Mã SKU cha (*)": "HI-612",
        "Mã phụ kiện / Thành phần (*)": "HI-612 (1)",
        "Tên phụ kiện / Thành phần (*)": "Proteninase K - Magbead",
        "Quy cách": "96 tests/hộp",
        "Đơn vị tính": "Hộp",
        "Định mức theo bộ (*)": 1,
        "Hình thức quản lý (LOT/SERIAL)": "LOT",
        "Điều kiện bảo quản tiêu chuẩn": "2-8°C (Lạnh mát)",
        "Ghi chú": "Bảo quản tránh ánh sáng"
      }
    ];

    // Sheet 3: Hướng dẫn quy định
    const guideData = [
      {
        "Tên Cột": "Điều kiện bảo quản chuẩn",
        "Vị trí Sheet": "Sheet 1: Danh_Muc_SanPham_Va_Gia",
        "Bắt Buộc": "Khuyến nghị",
        "Mô Tả Quy Định": "Nhiệt độ lưu kho bảo quản tiêu chuẩn của sản phẩm (-20°C, 2-8°C, 15-25°C (Nhiệt độ phòng), -80°C...)"
      },
      {
        "Tên Cột": "Mã SKU cha (*)",
        "Vị trí Sheet": "Sheet 2: Dinh_Muc_Phu_Kien_BOM",
        "Bắt Buộc": "Bắt buộc",
        "Mô Tả Quy Định": "Mã SKU sản phẩm chính ở Sheet 1 (Khóa ngoại liên kết 1 Sản phẩm cha - Nhiều Phụ kiện con)."
      },
      {
        "Tên Cột": "Hình thức quản lý (LOT/SERIAL)",
        "Vị trí Sheet": "Sheet 2: Dinh_Muc_Phu_Kien_BOM",
        "Bắt Buộc": "Bắt buộc",
        "Mô Tả Quy Định": "Điền 'LOT' nếu là hóa chất, sinh phẩm, vật tư tiêu hao; điền 'SERIAL' nếu là khối máy, thiết bị quản lý số máy riêng."
      },
      {
        "Tên Cột": "Định mức theo bộ (*)",
        "Vị trí Sheet": "Sheet 2: Dinh_Muc_Phu_Kien_BOM",
        "Bắt Buộc": "Bắt buộc",
        "Mô Tả Quy Định": "Số lượng thành phần con tương ứng trong 1 đơn vị sản phẩm cha (Mặc định là 1)."
      },
      {
        "Tên Cột": "Điều kiện bảo quản tiêu chuẩn",
        "Vị trí Sheet": "Sheet 2: Dinh_Muc_Phu_Kien_BOM",
        "Bắt Buộc": "Khuyến nghị",
        "Mô Tả Quy Định": "Nhiệt độ lưu kho riêng biệt: -20°C, 2-8°C hoặc 15-25°C (Nhiệt độ phòng)."
      }
    ];

    const wsProducts = XLSX.utils.json_to_sheet(productsData);
    wsProducts["!cols"] = [
      { wch: 18 }, // Mã SKU
      { wch: 45 }, // Tên sản phẩm
      { wch: 26 }, // Hãng sản xuất
      { wch: 22 }, // Nhóm ngành hàng
      { wch: 22 }, // Quy cách
      { wch: 12 }, // ĐVT
      { wch: 38 }, // Điều kiện bảo quản chuẩn
      { wch: 20 }, // Giá vốn
      { wch: 22 }, // Giá End User
      { wch: 20 }, // Giá Dealer 1
      { wch: 20 }, // Giá Dealer 2
      { wch: 18 }, // Tồn tối thiểu
      { wch: 45 }  // Ghi chú
    ];

    const wsComponents = XLSX.utils.json_to_sheet(componentsData);
    wsComponents["!cols"] = [
      { wch: 20 }, // Mã SKU cha
      { wch: 24 }, // Mã phụ kiện
      { wch: 48 }, // Tên phụ kiện
      { wch: 25 }, // Quy cách
      { wch: 14 }, // ĐVT
      { wch: 20 }, // Định mức
      { wch: 26 }, // Hình thức quản lý
      { wch: 38 }, // Nhiệt độ bảo quản
      { wch: 45 }  // Ghi chú
    ];

    const wsGuide = XLSX.utils.json_to_sheet(guideData);
    wsGuide["!cols"] = [
      { wch: 28 },
      { wch: 32 },
      { wch: 18 },
      { wch: 60 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsProducts, "Danh_Muc_SanPham_Va_Gia");
    XLSX.utils.book_append_sheet(wb, wsComponents, "Dinh_Muc_Phu_Kien_BOM");
    XLSX.utils.book_append_sheet(wb, wsGuide, "Huong_Dan_Quy_Dinh");
    XLSX.writeFile(wb, "Mau_Nhap_Lieu_SanPham_BangGia_Kem_BOM_ABT.xlsx");
  };

  const handleDownloadPOTemplate = () => {
    const firstProd = products[0] || { code: "HI-007.A (B32)", name: "TopPURE Maga Quick Genomic DNA/RNA Extraction Kit", cost_price: 1800000 };
    const sampleData = [
      {
        "Mã đơn PO (*)": `PO-ABT-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
        "Nhà cung cấp (*)": "Công ty TNHH Giải pháp Y Sinh ABT",
        "Ngày đặt hàng (*)": todayVN(),
        "Hạn giao dự kiến (*)": toVNDateString(new Date(Date.now() + 10 * 86400000)),
        "Mã sản phẩm SKU (*)": firstProd.code,
        "Tên sản phẩm (*)": firstProd.name,
        "Số lượng đặt mua (*)": 10,
        "Đơn giá mua (VNĐ)": Number(firstProd.cost_price) || 1800000,
        "Ghi chú giao hàng": "Kèm chứng nhận CO, CQ bản gốc"
      }
    ];
    const ws = XLSX.utils.json_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Mau_Don_Hang_PO");
    XLSX.writeFile(wb, "Mau_Don_Dat_Hang_PO_ABT.xlsx");
  };

  const handleDownloadSupplierTemplate = () => {
    const sampleData = [
      {
        "Mã NCC (*)": "NCC-ABT-001",
        "Tên nhà cung cấp (*)": "Nhà cung cấp Mẫu 1 (dòng minh họa - xóa trước khi nhập)",
        "Người liên hệ": "Người liên hệ NCC 1",
        "Số điện thoại": "0901234567",
        "Email": "ncc1@example.com",
        "Địa chỉ": "Số 10, Đường G, Hà Nội",
        "Ngành hàng cung ứng": "Hệ thống PCR, Máy Real-time PCR",
        "Điều khoản thanh toán": "Công nợ 30 ngày",
        "Đánh giá": 5
      },
      {
        "Mã NCC (*)": "NCC-ABT-002",
        "Tên nhà cung cấp (*)": "Nhà cung cấp Mẫu 2 (dòng minh họa - xóa trước khi nhập)",
        "Người liên hệ": "Người liên hệ NCC 2",
        "Số điện thoại": "0987654321",
        "Email": "ncc2@example.com",
        "Địa chỉ": "Singapore",
        "Ngành hàng cung ứng": "Vật tư tiêu hao, Đầu côn, Đĩa PCR",
        "Điều khoản thanh toán": "Thanh toán 100% khi phát hành BL",
        "Đánh giá": 5
      }
    ];
    const ws = XLSX.utils.json_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Mau_Nha_Cung_Cap");
    XLSX.writeFile(wb, "Mau_Nhap_Lieu_Nha_Cung_Cap_ABT.xlsx");
  };

  const handleDownloadUserPersonnelTemplate = () => {
    const sampleData = [
      {
        "Mã nhân viên (*)": "NV-ABT-001",
        "Họ và tên (*)": "Nguyễn Văn A",
        "Tên đăng nhập (*)": "a.nv",
        "Mật khẩu khởi tạo": "",
        "Phòng ban (*)": "Kinh Doanh",
        "Chức vụ / Vị trí (*)": "Chuyên Viên Kinh Doanh Thiết Bị",
        "Vai trò hệ thống (*)": "sales_rep",
        "Email (*)": "a.nv@abtvn.com",
        "Số điện thoại": "0912345670",
        "Trạng thái": "ACTIVE"
      },
      {
        "Mã nhân viên (*)": "NV-ABT-002",
        "Họ và tên (*)": "Trần Thị B",
        "Tên đăng nhập (*)": "b.tt",
        "Mật khẩu khởi tạo": "",
        "Phòng ban (*)": "Kho Vận",
        "Chức vụ / Vị trí (*)": "Thủ Kho Vật Tư Sinh Phẩm",
        "Vai trò hệ thống (*)": "warehouse",
        "Email (*)": "b.tt@abtvn.com",
        "Số điện thoại": "0987654320",
        "Trạng thái": "ACTIVE"
      },
      {
        "Mã nhân viên (*)": "NV-ABT-003",
        "Họ và tên (*)": "Lê Văn C",
        "Tên đăng nhập (*)": "c.lv",
        "Mật khẩu khởi tạo": "",
        "Phòng ban (*)": "Mua Hàng & Cung Ứng",
        "Chức vụ / Vị trí (*)": "Chuyên Viên Mua Hàng Quốc Tế",
        "Vai trò hệ thống (*)": "procurement_specialist",
        "Email (*)": "c.lv@abtvn.com",
        "Số điện thoại": "0933221100",
        "Trạng thái": "ACTIVE"
      },
      {
        "Mã nhân viên (*)": "NV-ABT-004",
        "Họ và tên (*)": "Phạm Văn D",
        "Tên đăng nhập (*)": "d.pv",
        "Mật khẩu khởi tạo": "",
        "Phòng ban (*)": "Kỹ Thuật & Ứng Dụng",
        "Chức vụ / Vị trí (*)": "Kỹ Sư Ứng Dụng PCR",
        "Vai trò hệ thống (*)": "app_rep",
        "Email (*)": "d.pv@abtvn.com",
        "Số điện thoại": "0944556677",
        "Trạng thái": "ACTIVE"
      }
    ];

    const roleMappingData = [
      {
        "Phòng Ban": "Ban Giám Đốc",
        "Chức Vụ / Vị Trí Công Việc": "Tổng Giám Đốc / Giám Đốc Điều Hành (CEO)",
        "Vai Trò Hệ Thống": "admin",
        "Tên Tiếng Anh": "Director / CEO",
        "Quyền Hạn & Phạm Vi Truy Cập": "Toàn quyền hệ thống: Xem mọi báo cáo P&L, phê duyệt chiết khấu, duyệt đơn PO lớn, quản lý phân quyền và người dùng."
      },
      {
        "Phòng Ban": "Ban Giám Đốc",
        "Chức Vụ / Vị Trí Công Việc": "Phó Giám Đốc",
        "Vai Trò Hệ Thống": "admin",
        "Tên Tiếng Anh": "Vice Director",
        "Quyền Hạn & Phạm Vi Truy Cập": "Quản trị cấp cao: Phê duyệt quy trình, giám sát vận hành liên phòng ban, xem toàn bộ dashboard phân tích kinh doanh và kho vận."
      },
      {
        "Phòng Ban": "Kinh Doanh",
        "Chức Vụ / Vị Trí Công Việc": "Trưởng Phòng Kinh Doanh",
        "Vai Trò Hệ Thống": "sales_head",
        "Tên Tiếng Anh": "Head of Sales",
        "Quyền Hạn & Phạm Vi Truy Cập": "Quản lý toàn bộ đội ngũ Sales: Phân bổ khách hàng, duyệt báo giá, duyệt hợp đồng, theo dõi KPI doanh số, quản lý khách hàng VIP."
      },
      {
        "Phòng Ban": "Kinh Doanh",
        "Chức Vụ / Vị Trí Công Việc": "Phó Phòng Kinh Doanh",
        "Vai Trò Hệ Thống": "sales_head",
        "Tên Tiếng Anh": "Deputy Head of Sales",
        "Quyền Hạn & Phạm Vi Truy Cập": "Hỗ trợ quản lý kinh doanh, phụ trách nhóm khách hàng chiến lược, phê duyệt báo giá theo hạn mức ủy quyền."
      },
      {
        "Phòng Ban": "Kinh Doanh",
        "Chức Vụ / Vị Trí Công Việc": "Chuyên Viên Kinh Doanh (Senior/Junior)",
        "Vai Trò Hệ Thống": "sales_rep",
        "Tên Tiếng Anh": "Sales Specialist / Sales Rep",
        "Quyền Hạn & Phạm Vi Truy Cập": "Quản lý khách hàng phụ trách, tạo báo giá, lên đơn đặt hàng (SO), theo dõi tiến độ giao hàng và công nợ của khách hàng cá nhân."
      },
      {
        "Phòng Ban": "Kinh Doanh",
        "Chức Vụ / Vị Trí Công Việc": "Quản Lý Sản Phẩm (Product Manager - PM)",
        "Vai Trò Hệ Thống": "sales_rep",
        "Tên Tiếng Anh": "Product Manager (PM)",
        "Quyền Hạn & Phạm Vi Truy Cập": "Phụ trách chiến lược ngành hàng (qPCR, Hóa chất, Vật tư), xem bảng giá, cấu hình kỹ thuật và hỗ trợ bán hàng chuyên sâu."
      },
      {
        "Phòng Ban": "Kinh Doanh",
        "Chức Vụ / Vị Trí Công Việc": "Admin Kinh Doanh (Sales Admin)",
        "Vai Trò Hệ Thống": "sales_rep",
        "Tên Tiếng Anh": "Sales Admin",
        "Quyền Hạn & Phạm Vi Truy Cập": "Hỗ trợ nhập đơn hàng, soạn thảo hợp đồng, theo dõi tiến độ giao hàng và phối hợp kho vận xuất hóa đơn."
      },
      {
        "Phòng Ban": "Kho Vận",
        "Chức Vụ / Vị Trí Công Việc": "Trưởng Bộ Phận Kho Vận",
        "Vai Trò Hệ Thống": "warehouse_lead",
        "Tên Tiếng Anh": "Warehouse Manager",
        "Quyền Hạn & Phạm Vi Truy Cập": "Quản lý toàn diện kho ABT, ký duyệt phiếu xuất nhập kho, xem giá vốn lô nhập, điều chuyển vị trí kho lạnh, tạo PR mua bù tồn kho và quản lý cảnh báo HSD."
      },
      {
        "Phòng Ban": "Kho Vận",
        "Chức Vụ / Vị Trí Công Việc": "Thủ Kho Vật Tư Sinh Phẩm & Hóa Chất",
        "Vai Trò Hệ Thống": "warehouse",
        "Tên Tiếng Anh": "Warehouse Specialist",
        "Quyền Hạn & Phạm Vi Truy Cập": "Tạo phiếu nhập/xuất kho, nhập hàng bằng Excel, quản lý số Lô (LOT) & Hạn dùng (EXP), kiểm soát nhiệt độ bảo quản lạnh (-20°C, 2-8°C)."
      },
      {
        "Phòng Ban": "Kho Vận",
        "Chức Vụ / Vị Trí Công Việc": "Nhân Viên Giao Nhận & Vận Chuyển Lạnh",
        "Vai Trò Hệ Thống": "warehouse",
        "Tên Tiếng Anh": "Logistics & Cold Chain Staff",
        "Quyền Hạn & Phạm Vi Truy Cập": "Cập nhật trạng thái giao hàng, xác nhận biên bản bàn giao cho bệnh viện/phòng xét nghiệm, kiểm soát thiết bị theo dõi nhiệt độ thùng lạnh."
      },
      {
        "Phòng Ban": "Mua Hàng & Cung Ứng",
        "Chức Vụ / Vị Trí Công Việc": "Trưởng Bộ Phận Cung Ứng",
        "Vai Trò Hệ Thống": "procurement_lead",
        "Tên Tiếng Anh": "Procurement Lead",
        "Quyền Hạn & Phạm Vi Truy Cập": "Quản lý danh mục nhà cung cấp (Bioer, Biologix, Corning...), thương thảo hợp đồng mua hàng, phê duyệt đơn PO (approve_po) và theo dõi tiến độ nhập khẩu."
      },
      {
        "Phòng Ban": "Mua Hàng & Cung Ứng",
        "Chức Vụ / Vị Trí Công Việc": "Chuyên Viên Mua Hàng Quốc Tế / Trong Nước",
        "Vai Trò Hệ Thống": "procurement_specialist",
        "Tên Tiếng Anh": "Procurement Specialist",
        "Quyền Hạn & Phạm Vi Truy Cập": "Lập đề xuất PR & dự thảo đơn PO mua hàng (không tự phê duyệt PO), theo dõi lịch giao hàng dự kiến, kiểm soát hồ sơ chứng từ CO/CQ và thông quan Hải quan."
      },
      {
        "Phòng Ban": "Kỹ Thuật & Ứng Dụng",
        "Chức Vụ / Vị Trí Công Việc": "Trưởng Phòng Kỹ Thuật & Ứng Dụng",
        "Vai Trò Hệ Thống": "app_head",
        "Tên Tiếng Anh": "Head of Application",
        "Quyền Hạn & Phạm Vi Truy Cập": "Quản lý đào tạo kỹ thuật, phân công kỹ sư (assign), ký duyệt nghiệm thu thiết bị & tài liệu kỹ thuật thầu (approve), tư vấn giải pháp SHPT."
      },
      {
        "Phòng Ban": "Kỹ Thuật & Ứng Dụng",
        "Chức Vụ / Vị Trí Công Việc": "Kỹ Sư Ứng Dụng PCR / Sinh Học Phân Tử",
        "Vai Trò Hệ Thống": "app_rep",
        "Tên Tiếng Anh": "Application Specialist",
        "Quyền Hạn & Phạm Vi Truy Cập": "Cài đặt quy trình xét nghiệm qPCR/tách chiết, mượn máy/hóa chất demo, hỗ trợ khách hàng xử lý sự cố kỹ thuật kết quả xét nghiệm."
      },
      {
        "Phòng Ban": "Kỹ Thuật & Ứng Dụng",
        "Chức Vụ / Vị Trí Công Việc": "Kỹ Sư Dịch Vụ Thiết Bị (Service Engineer)",
        "Vai Trò Hệ Thống": "app_rep",
        "Tên Tiếng Anh": "Service Engineer",
        "Quyền Hạn & Phạm Vi Truy Cập": "Lắp đặt, hiệu chuẩn (calibration), bảo dưỡng định kỳ và sửa chữa máy Real-time PCR, máy tách chiết tự động theo phân công."
      },
      {
        "Phòng Ban": "Kế Toán",
        "Chức Vụ / Vị Trí Công Việc": "Kế Toán Trưởng",
        "Vai Trò Hệ Thống": "accountant_head",
        "Tên Tiếng Anh": "Chief Accountant",
        "Quyền Hạn & Phạm Vi Truy Cập": "Quản lý dòng tiền, phê duyệt hạn mức tín dụng & giải tỏa công nợ đơn hàng, phê duyệt ngân sách PO, chốt kỳ kế toán và kiểm soát báo cáo tài chính."
      },
      {
        "Phòng Ban": "Kế Toán",
        "Chức Vụ / Vị Trí Công Việc": "Chuyên Viên Kế Toán Kho & Công Nợ",
        "Vai Trò Hệ Thống": "accountant",
        "Tên Tiếng Anh": "Receivable & Inventory Accountant",
        "Quyền Hạn & Phạm Vi Truy Cập": "Đối soát giá trị kho, định giá tồn kho theo FIFO, phát hành hóa đơn VAT, theo dõi tuổi nợ khách hàng và nhắc nợ theo kỳ hạn thanh toán."
      },
      {
        "Phòng Ban": "QA / QC",
        "Chức Vụ / Vị Trí Công Việc": "Trưởng Bộ Phận QA/QC (QA/QC Manager)",
        "Vai Trò Hệ Thống": "qa_qc_lead",
        "Tên Tiếng Anh": "QA/QC Manager",
        "Quyền Hạn & Phạm Vi Truy Cập": "Chỉ đạo hệ thống chất lượng ISO 13485, phê duyệt kết quả thẩm định chất lượng lô, ký lệnh thu hồi Lô khẩn cấp và giải phóng hàng cách ly (Quarantine)."
      },
      {
        "Phòng Ban": "QA / QC",
        "Chức Vụ / Vị Trí Công Việc": "Chuyên Viên Quản Lý Chất Lượng & ISO 13485",
        "Vai Trò Hệ Thống": "qa_qc",
        "Tên Tiếng Anh": "QA/QC Specialist",
        "Quyền Hạn & Phạm Vi Truy Cập": "Kiểm soát hồ sơ COA, lập biên bản kiểm định lô nhập kho, ghi nhận hàng lỗi cách ly (Quarantine) và phân tích khiếu nại chất lượng."
      },
      {
        "Phòng Ban": "Pháp Chế",
        "Chức Vụ / Vị Trí Công Việc": "Trưởng Bộ Phận Pháp Chế",
        "Vai Trò Hệ Thống": "legal_head",
        "Tên Tiếng Anh": "Head of Legal",
        "Quyền Hạn & Phạm Vi Truy Cập": "Thẩm định và phê duyệt pháp lý hợp đồng kinh tế (legal.approve), kiểm soát rủi ro đấu thầu và phê duyệt hồ sơ lưu hành trang thiết bị y tế IVD."
      },
      {
        "Phòng Ban": "Pháp Chế",
        "Chức Vụ / Vị Trí Công Việc": "Chuyên Viên Pháp Chế & Tuân Thủ",
        "Vai Trò Hệ Thống": "legal",
        "Tên Tiếng Anh": "Legal Specialist",
        "Quyền Hạn & Phạm Vi Truy Cập": "Soạn thảo hợp đồng mua bán/đại lý (legal.create), chuẩn bị hồ sơ công bố lưu hành IVD, bảo lãnh dự thầu và kiểm tra tính hợp lệ chứng từ."
      }
    ];

    const ws = XLSX.utils.json_to_sheet(sampleData);
    const wsRoles = XLSX.utils.json_to_sheet(roleMappingData);
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, ws, "Mau_TaiKhoan_NhanSu");
    XLSX.utils.book_append_sheet(wb, wsRoles, "Danh_Muc_Vi_Tri_Va_Vai_Tro");

    ws["!cols"] = [
      { wch: 18 }, // Mã NV
      { wch: 25 }, // Họ tên
      { wch: 18 }, // Tên đăng nhập
      { wch: 18 }, // Mật khẩu
      { wch: 22 }, // Phòng ban
      { wch: 32 }, // Chức vụ
      { wch: 22 }, // Vai trò
      { wch: 25 }, // Email
      { wch: 16 }, // SĐT
      { wch: 14 }  // Trạng thái
    ];

    wsRoles["!cols"] = [
      { wch: 22 }, // Phòng ban
      { wch: 38 }, // Chức vụ
      { wch: 18 }, // Vai trò hệ thống
      { wch: 28 }, // Tiếng Anh
      { wch: 70 }  // Quyền hạn
    ];

    XLSX.writeFile(wb, "Mau_Nhap_Lieu_TaiKhoan_NhanSu_ABT.xlsx");
  };

  // ==========================================
  // SMART EXCEL IMPORTER TYPE DETECTOR ENGINE
  // ==========================================
  const classifyExcelTemplate = (fileName: string, sheetNames: string[], firstRow: Record<string, any>) => {
    const keys = Object.keys(firstRow || {}).map(k => k.toLowerCase().trim());
    const fName = (fileName || "").toLowerCase();
    const sNames = sheetNames.map(s => s.toLowerCase());

    // 1. USERS & PERSONNEL (Tài khoản & Nhân sự liên kết) - ƯU TIÊN SỐ 1
    const isPersonnel =
      keys.some(k => k.includes("mã nhân viên") || k.includes("tên đăng nhập") || k.includes("mật khẩu") || k.includes("username") || k.includes("employee_code") || k.includes("mã nv") || k.includes("tài khoản")) ||
      (keys.some(k => k.includes("vai trò") || k.includes("role")) && keys.some(k => k.includes("phòng ban") || k.includes("chức vụ") || k.includes("chức danh"))) ||
      fName.includes("nhansu") || fName.includes("nhan_su") || fName.includes("taikhoan") || fName.includes("tai_khoan") ||
      sNames.some(s => s.includes("taikhoan") || s.includes("nhansu") || s.includes("nhan_su"));

    if (isPersonnel) {
      return {
        type: "USERS_PERSONNEL" as const,
        title: "Mẫu 6: Tài Khoản & Nhân Sự Liên Kết",
        badge: "Mẫu 6: Tài Khoản & Nhân Sự Liên Kết",
        badgeClass: "bg-rose-950 text-rose-300 border border-rose-800",
        sheet1Title: "Sheet 1: Tài Khoản & Hồ Sơ Nhân Sự",
        sheet2Title: "Sheet 2: Danh Mục Vị Trí & Vai Trò (Tham Khảo)",
        confirmBtnText: (c1: number, c2: number) => `Xác Nhận Nạp ${c1} Tài Khoản & Nhân Sự Vào Hệ Thống`
      };
    }

    // 2. INBOUND LOT (Nhập kho hàng hóa theo Lô/HSD)
    const isInbound =
      keys.some(k => k.includes("số lô") || k.includes("hạn sử dụng") || k.includes("hạn dùng") || k.includes("nhiệt độ bảo quản") || k.includes("vị trí kho kệ")) ||
      fName.includes("nhap_kho") || fName.includes("nhapkho") || fName.includes("theo_lo") ||
      sNames.some(s => s.includes("nhap_kho") || s.includes("theo_lo"));

    if (isInbound) {
      return {
        type: "INBOUND_LOT" as const,
        title: "Mẫu 3: Nhập Kho Hàng Hóa Theo Lô/HSD",
        badge: "Mẫu 3: Nhập Kho Lô/HSD (GSP)",
        badgeClass: "bg-emerald-950 text-emerald-300 border border-emerald-800",
        sheet1Title: "Sheet 1: Hàng Hóa Nhập Kho",
        sheet2Title: "Sheet 2: Phụ Kiện / Thành Phần Đính Kèm",
        confirmBtnText: (c1: number, c2: number) => c2 > 0 ? `Xác Nhận Nạp ${c1} Lô Hàng Hóa & ${c2} Phụ Kiện Vào Kho` : `Xác Nhận Nạp ${c1} Lô Hàng Hóa Vào Kho`
      };
    }

    // 3. PURCHASE ORDERS (Đơn hàng mua PO)
    const isPO =
      keys.some(k => k.includes("mã đơn po") || k.includes("mã po") || k.includes("số po") || k.includes("po_code") || k.includes("po_number")) ||
      fName.includes("don_hang_po") || fName.includes("don_mua_po") || fName.includes("po_") ||
      sNames.some(s => s.includes("don_hang_po") || s.includes("don_mua_po"));

    if (isPO) {
      return {
        type: "PURCHASE_ORDERS" as const,
        title: "Mẫu 4: Đơn Hàng Mua Cung Ứng (PO)",
        badge: "Mẫu 4: Đơn Hàng PO Mua Hàng",
        badgeClass: "bg-sky-950 text-sky-300 border border-sky-800",
        sheet1Title: "Sheet 1: Đơn Hàng Mua PO",
        confirmBtnText: (c1: number) => `Xác Nhận Nạp ${c1} Dòng Đơn Hàng PO Vào Hệ Thống`
      };
    }

    // 4. SUPPLIERS (Danh mục Nhà cung cấp)
    const isSupplier =
      keys.some(k => k.includes("mã nhà cung cấp") || k.includes("mã ncc") || k.includes("tên nhà cung cấp") || k.includes("supplier_code")) ||
      fName.includes("nha_cung_cap") || fName.includes("nhacungcap") || fName.includes("supplier") ||
      sNames.some(s => s.includes("nha_cung_cap") || s.includes("supplier"));

    if (isSupplier) {
      return {
        type: "SUPPLIERS" as const,
        title: "Mẫu 5: Danh Mục Nhà Cung Cấp",
        badge: "Mẫu 5: Danh Mục Nhà Cung Cấp",
        badgeClass: "bg-amber-950 text-amber-300 border border-amber-800",
        sheet1Title: "Sheet 1: Danh Mục Nhà Cung Cấp",
        confirmBtnText: (c1: number) => `Xác Nhận Nạp ${c1} Nhà Cung Cấp Vào Hệ Thống`
      };
    }

    // 5. PRODUCTS (Sản phẩm & Bảng giá)
    const isProduct =
      keys.some(k => k.includes("mã sku") || k.includes("giá niêm yết") || k.includes("giá đại lý") || (k.includes("giá vốn") && !k.includes("công nợ"))) ||
      fName.includes("banggia") || fName.includes("bang_gia") || fName.includes("sanpham") || fName.includes("san_pham") ||
      sNames.some(s => s.includes("bang_gia") || s.includes("san_pham"));

    if (isProduct) {
      return {
        type: "PRODUCTS" as const,
        title: "Mẫu 2: Bảng Giá Sản Phẩm & BOM",
        badge: "Mẫu 2: Bảng Giá Sản Phẩm & BOM",
        badgeClass: "bg-purple-950 text-purple-300 border border-purple-800",
        sheet1Title: "Sheet 1: Sản Phẩm & Bảng Giá",
        sheet2Title: "Sheet 2: Định Mức Phụ Kiện (BOM)",
        confirmBtnText: (c1: number, c2: number) => c2 > 0 ? `Xác Nhận Nạp ${c1} Sản Phẩm & ${c2} Phụ Kiện BOM` : `Xác Nhận Nạp ${c1} Sản Phẩm & Bảng Giá`
      };
    }

    // 6. CUSTOMERS (Khách hàng CRM)
    const isCustomer =
      keys.some(k => k.includes("khách hàng") || k.includes("customer") || k.includes("mã kh") || k.includes("hạn mức công nợ")) ||
      fName.includes("khachhang") || fName.includes("khach_hang") || fName.includes("customer") ||
      sNames.some(s => s.includes("khach_hang") || s.includes("customer"));

    if (isCustomer) {
      return {
        type: "CUSTOMERS" as const,
        title: "Mẫu 1: Khách Hàng CRM & Multi-Contacts",
        badge: "Mẫu 1: Khách Hàng CRM (Multi-Contacts)",
        badgeClass: "bg-indigo-950 text-indigo-300 border border-indigo-800",
        sheet1Title: "Sheet 1: Khách Hàng",
        sheet2Title: "Sheet 2: Người Liên Hệ",
        confirmBtnText: (c1: number, c2: number) => c2 > 0 ? `Xác Nhận Nạp ${c1} Khách Hàng & ${c2} Người Liên Hệ` : `Xác Nhận Nạp ${c1} Khách Hàng Vào Hệ Thống`
      };
    }

    return {
      type: "UNKNOWN" as const,
      title: "Tệp Excel Tiêu Chuẩn",
      badge: "Tự Động Nhận Diện Dữ Liệu",
      badgeClass: "bg-slate-800 text-slate-300 border border-slate-700",
      sheet1Title: "Sheet 1: Dữ Liệu",
      confirmBtnText: (c1: number) => `Xác Nhận Nạp ${c1} Dòng Dữ Liệu Vào Hệ Thống`
    };
  };

  const handleConfirmImportExcel = async () => {
    if (previewImportRows.length === 0) return;
    setIsImportingExcel(true);
    try {
      const res = await fetch("/api/inventory?action=import_excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          rows: previewImportRows,
          contact_rows: previewContactRows,
          detected_type: detectedImportClassification.type
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActionNotice(`✅ ${data.message || "Đã nạp thành công dữ liệu Excel vào hệ thống!"}`);
        if (Array.isArray(data.initial_credentials) && data.initial_credentials.length > 0) {
          const lines = data.initial_credentials.map((c: any) => `${c.username} (${c.full_name || ""}): ${c.password}`).join("\n");
          alert(`🔑 Mật khẩu tạm của ${data.initial_credentials.length} tài khoản mới — hãy lưu lại và giao riêng cho từng người (chỉ hiển thị một lần, phải đổi ở lần đăng nhập đầu):\n\n${lines}`);
        }
        setPreviewImportRows([]);
        setPreviewContactRows([]);
        setActivePreviewSheetTab("customers");
        setImportFileName("");
        if (generalExcelFileInputRef.current) {
          generalExcelFileInputRef.current.value = "";
        }
        fetchData();
      } else {
        alert(data.error || "Lỗi khi nạp dữ liệu Excel");
      }
    } catch (err) {
      console.error(err);
      alert("Lỗi kết nối khi nạp dữ liệu Excel");
    } finally {
      setIsImportingExcel(false);
    }
  };

  const processGeneralExcelFile = (file: File) => {
    if (!file) return;
    const isExcelOrCsv = /\.(xlsx|xls|csv)$/i.test(file.name) ||
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.type === "application/vnd.ms-excel" ||
      file.type === "text/csv";

    if (!isExcelOrCsv) {
      alert("Vui lòng chọn hoặc kéo thả file định dạng Excel (.xlsx, .xls) hoặc .csv!");
      return;
    }

    setImportFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: "binary" });
        const wsName = wb.SheetNames[0];
        const ws = wb.Sheets[wsName];
        const rawJson: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" }).map((r: any) => normalizeExcelRowDates(r));
        setPreviewImportRows(rawJson);

        const classification = classifyExcelTemplate(file.name, wb.SheetNames, rawJson[0] || {});
        setDetectedImportClassification(classification);

        let secondaryJson: any[] = [];
        if (wb.SheetNames.length > 1) {
          let secondarySheetName = "";
          if (classification.type === "CUSTOMERS") {
            secondarySheetName = wb.SheetNames.find(s => {
              const sl = s.toLowerCase();
              return sl.includes("lien_he") || sl.includes("contact") || sl.includes("nguoi");
            }) || "";
          } else if (classification.type === "PRODUCTS") {
            secondarySheetName = wb.SheetNames.find(s => {
              const sl = s.toLowerCase();
              return sl.includes("phu_kien") || sl.includes("bom") || sl.includes("thanh_phan") || sl.includes("dinh_muc") || sl.includes("component");
            }) || "";
          } else if (classification.type === "INBOUND_LOT") {
            secondarySheetName = wb.SheetNames.find(s => {
              const sl = s.toLowerCase();
              return sl.includes("thanh_phan") || sl.includes("phu_kien") || sl.includes("dinh_kem") || sl.includes("component");
            }) || "";
          } else if (classification.type === "USERS_PERSONNEL") {
            secondarySheetName = wb.SheetNames.find(s => {
              const sl = s.toLowerCase();
              return sl.includes("vi_tri") || sl.includes("vai_tro") || sl.includes("role") || sl.includes("chuc_vu") || sl.includes("huong_dan");
            }) || "";
            if (!secondarySheetName && wb.SheetNames[1]) {
              secondarySheetName = wb.SheetNames[1];
            }
          }

          if (secondarySheetName && secondarySheetName !== wsName) {
            const secWs = wb.Sheets[secondarySheetName];
            secondaryJson = XLSX.utils.sheet_to_json(secWs, { defval: "" }).map((r: any) => normalizeExcelRowDates(r));
          }
        }
        setPreviewContactRows(secondaryJson);
        setActivePreviewSheetTab("customers");

        const contactMsg = secondaryJson.length > 0 ? ` kèm ${secondaryJson.length} dòng ở ${classification.sheet2Title || "Sheet 2"}` : "";
        setActionNotice(`📊 Đã nhận diện [${classification.badge}] từ file ${file.name}: ${rawJson.length} dòng dữ liệu${contactMsg}.`);
      } catch (err) {
        console.error(err);
        alert("Lỗi khi đọc file Excel!");
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleGeneralExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processGeneralExcelFile(file);
    }
    e.target.value = "";
  };

  const handleExportValuationToExcel = () => {
    try {
      const brandRows = valuationData.brandList.map((b) => ({
        "Hãng Sản Xuất": b.brand,
        "Số Mã SKU": b.count,
        "Tổng Lượng Tồn Kho": b.totalQty,
        "Tổng Giá Vốn Tồn (VNĐ)": b.costVal,
        "Tổng Giá Niêm Yết (VNĐ)": b.listVal,
        "Lợi Nhuận Dự Phóng (VNĐ)": b.profit,
        "Tỷ Trọng Giá Trị Kho": `${b.share.toFixed(1)}%`,
        "Tỷ Suất Lợi Nhuận Gộp": `${b.margin.toFixed(1)}%`
      }));

      const catRows = valuationData.catList.map((c) => ({
        "Nhóm Ngành Hàng": c.category,
        "Số Mã SKU": c.count,
        "Tổng Lượng Tồn Kho": c.totalQty,
        "Tổng Giá Vốn Tồn (VNĐ)": c.costVal,
        "Tổng Giá Niêm Yết (VNĐ)": c.listVal,
        "Lợi Nhuận Dự Phóng (VNĐ)": c.profit,
        "Tỷ Trọng Giá Trị Kho": `${c.share.toFixed(1)}%`,
        "Tỷ Suất Lợi Nhuận Gộp": `${c.margin.toFixed(1)}%`
      }));

      const storageRows = valuationData.storageList.map((s) => ({
        "Điều Kiện Bảo Quản": s.storage,
        "Số Mã SKU": s.count,
        "Tổng Lượng Tồn Kho": s.totalQty,
        "Tổng Giá Vốn Tồn (VNĐ)": s.costVal,
        "Tổng Giá Niêm Yết (VNĐ)": s.listVal,
        "Lợi Nhuận Dự Phóng (VNĐ)": s.profit,
        "Tỷ Trọng Giá Trị Kho": `${s.share.toFixed(1)}%`,
        "Tỷ Suất Lợi Nhuận Gộp": `${s.margin.toFixed(1)}%`
      }));

      const riskRows = valuationData.riskList.map((r) => ({
        "Trạng Thái Hạn Dùng / Rủi Ro": r.risk,
        "Số Mã SKU": r.count,
        "Tổng Lượng Tồn Kho": r.totalQty,
        "Tổng Giá Vốn Tồn (VNĐ)": r.costVal,
        "Tổng Giá Niêm Yết (VNĐ)": r.listVal,
        "Lợi Nhuận Dự Phóng (VNĐ)": r.profit,
        "Tỷ Trọng Giá Trị Kho": `${r.share.toFixed(1)}%`,
        "Tỷ Suất Lợi Nhuận Gộp": `${r.margin.toFixed(1)}%`
      }));

      const skuRows = valuationData.skuDetailsList.map((item, idx) => ({
        "STT": idx + 1,
        "Mã Sản Phẩm": item.product_code,
        "Tên Sản Phẩm": item.product_name,
        "Hãng Sản Xuất": item.manufacturer,
        "Nhóm Ngành Hàng": item.category,
        "Số Lô (Lot)": item.lot_number || item.batch_lot,
        "Hạn Dùng (EXP)": item.expiry_date,
        "Số Lượng Tồn": item.qty,
        "Đơn Giá Vốn (VNĐ)": item.cPrice,
        "Tổng Giá Vốn (VNĐ)": item.totalCost,
        "Đơn Giá Niêm Yết (VNĐ)": item.lPrice,
        "Tổng Giá Niêm Yết (VNĐ)": item.totalList,
        "Lợi Nhuận Dự Phóng (VNĐ)": item.profit,
        "Tỷ Suất Lợi Nhuận (%)": `${item.margin.toFixed(1)}%`,
        "Điều Kiện Bảo Quản": item.storage_condition || item.storage_temp
      }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(brandRows), "Định Giá Theo Hãng");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(catRows), "Định Giá Theo Ngành Hàng");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(storageRows), "Định Giá Theo Nhiệt Độ");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(riskRows), "Định Giá Theo Hạn Dùng");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(skuRows), "Chi Tiết Từng SKU");
      XLSX.writeFile(wb, `Bao_Cao_Dinh_Gia_Ton_Kho_ABT_${todayVN()}.xlsx`);
      setActionNotice("✅ Đã xuất báo cáo định giá tồn kho thành công ra file Excel với đầy đủ các chỉ tiêu!");
    } catch (e) {
      alert("Lỗi khi xuất file Excel báo cáo định giá tồn kho");
    }
  };

  // Risk KPIs Count
  const riskKPIs = useMemo(() => {
    const nearExpCount = enrichedItems.filter((i) => i.isNearExpiry || i.isExpired).length;
    const lowStockCount = enrichedItems.filter((i) => i.isStockoutRisk).length;
    const coldChainCount = enrichedItems.filter((i) => i.temp_category === "-20C" || i.temp_category === "2-8C").length;
    const slowMovingCount = enrichedItems.filter((i) => i.isSlowMoving).length;
    return {
      nearExpCount,
      lowStockCount,
      coldChainCount,
      slowMovingCount,
      totalCount: enrichedItems.length
    };
  }, [enrichedItems]);

  // Filtered Items based on Multi-Dimensional Filter
  // Lọc sau khi người dùng ngừng gõ (danh sách hàng nghìn dòng)
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const filteredItems = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return enrichedItems.filter((item) => {
      // 1. Search Query
      const matchSearch = !q ||
        String(item.product_name || "").toLowerCase().includes(q) ||
        String(item.product_code || "").toLowerCase().includes(q) ||
        String(item.lot_number || "").toLowerCase().includes(q) ||
        (item.shelf_position || "").toLowerCase().includes(q);
      if (!matchSearch) return false;

      // 2. Risk Filter
      if (riskFilter === "near_exp" && !(item.isNearExpiry || item.isExpired)) return false;
      if (riskFilter === "low_stock" && !item.isStockoutRisk) return false;
      if (riskFilter === "slow_moving" && !item.isSlowMoving) return false;
      if (riskFilter === "safe" && item.primaryRisk !== "safe") return false;

      // 3. Temperature Filter
      if (tempFilter !== "all" && item.temp_category !== tempFilter) return false;

      // 4. Category Filter
      if (categoryFilter !== "all") {
        if (categoryFilter === "diagnostic" && item.category_key !== "diagnostic") return false;
        else if (categoryFilter === "extraction" && item.category_key !== "extraction") return false;
        else if (categoryFilter === "equipment" && item.category_key !== "equipment") return false;
        else if (categoryFilter === "consumable" && item.category_key !== "consumable") return false;
        else if (categoryFilter !== "diagnostic" && categoryFilter !== "extraction" && categoryFilter !== "equipment" && categoryFilter !== "consumable") {
          const itemInd = (item.industry_category || "").toLowerCase();
          const target = categoryFilter.toLowerCase();
          if (itemInd !== target && !(item.category || "").toLowerCase().includes(target)) return false;
        }
      }

      return true;
    });
  }, [enrichedItems, debouncedSearch, riskFilter, tempFilter, categoryFilter]);
  // Bảng tồn kho chỉ vẽ một trang (3.000 dòng vẽ cùng lúc làm màn hình đứng nhiều giây)
  const stockPage = usePaged(filteredItems, 50, `${debouncedSearch}|${riskFilter}|${tempFilter}|${categoryFilter}`);
  // Danh sách sản phẩm ở tab BOM: lọc sau khi ngừng gõ, đếm thành phần một lần, vẽ từng trang
  const bomSearchDebounced = useDebouncedValue(bomSearchQuery, 300);
  const bomFilteredProducts = useMemo(() => {
    const withComps = new Set(productComponents.map((c: any) => c.parent_product_code));
    const q = bomSearchDebounced.toLowerCase();
    return products.filter((p: any) => {
      const matchesQuery = !q || String(p.code || "").toLowerCase().includes(q) || String(p.name || "").toLowerCase().includes(q);
      if (!matchesQuery) return false;
      const hasComponents = withComps.has(p.code);
      if (bomTypeFilter === "kits_only") return hasComponents;
      if (bomTypeFilter === "single") return !hasComponents;
      return true;
    });
  }, [products, productComponents, bomSearchDebounced, bomTypeFilter]);
  const bomPage = usePaged(bomFilteredProducts, 100, `${bomSearchDebounced}|${bomTypeFilter}`);

  const alertCount = riskKPIs.lowStockCount;

  // Inbound Form Item Helpers
  const handleAddInboundItem = () => {
    const defaultProd = products[0] || { code: "", name: "", unit: "Hộp", specification: "", cost_price: 0, storage_condition: "15–25°C (Nhiệt độ phòng - RT)" };
    setInboundForm((prev: any) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          product_code: defaultProd.code || "",
          product_name: defaultProd.name || "",
          specification: defaultProd.specification || "",
          unit: defaultProd.unit || "Hộp",
          quantity: 1,
          unit_price: defaultProd.cost_price || defaultProd.standard_price || 0,
          lot_number: "",
          manufacture_date: "",
          expiry_date: "",
          storage_condition: defaultProd.storage_condition || "15–25°C (Nhiệt độ phòng - RT)",
          shelf_position: (defaultProd as any).shelf_position || "Chưa phân bổ kệ",
          qc_status: "Đạt chuẩn 100% (Nguyên niêm phong & COA)",
          item_notes: "",
          components: []
        }
      ]
    }));
  };

  const handleRemoveInboundItem = (index: number) => {
    if (inboundForm.items.length <= 1) {
      alert("Phiếu nhập kho cần có ít nhất 1 mặt hàng.");
      return;
    }
    setInboundForm((prev: any) => ({
      ...prev,
      items: prev.items.filter((_: any, i: number) => i !== index)
    }));
  };

  const handleInboundItemChange = (index: number, field: string, value: any) => {
    setInboundForm((prev: any) => {
      const updated = [...prev.items];
      updated[index] = { ...updated[index], [field]: value };

      if (field === "product_code") {
        const prod = products.find((p) => p.code === value);
        if (prod) {
          updated[index].product_name = prod.name;
          updated[index].unit = prod.unit || updated[index].unit || "Hộp";
          updated[index].specification = prod.specification || updated[index].specification || "";
          updated[index].unit_price = prod.cost_price || prod.standard_price || updated[index].unit_price || 0;
          updated[index].storage_condition = prod.storage_condition || "15–25°C (Nhiệt độ phòng - RT)";
          updated[index].shelf_position = (prod as any).shelf_position || updated[index].shelf_position || "Chưa phân bổ kệ";

          // Xóa trắng số lô và hạn dùng cũ khi đổi mã sản phẩm để người dùng nhập đúng thực tế lô hàng
          updated[index].lot_number = "";
          updated[index].manufacture_date = "";
          updated[index].expiry_date = "";

          // Tự động gắn các thành phần con cấu thành nếu có trong định mức BOM
          const comps = productComponents.filter((c) => c.parent_product_code === value);
          if (comps.length > 0) {
            updated[index].components = comps.map((c, i) => ({
              ...c,
              lot_number: "",
              serial_number: "",
              expiry_date: "",
              qc_status: "Đạt chuẩn 100%"
            }));
          } else {
            updated[index].components = [];
          }
        }
      }

      if (field === "lot_number") {
        // Đồng bộ số Lô sang các thành phần con nếu có
        if (Array.isArray(updated[index].components) && updated[index].components.length > 0) {
          updated[index].components = updated[index].components.map((c: any) => ({
            ...c,
            lot_number: value
          }));
        }
      }

      if (field === "expiry_date") {
        // Đồng bộ hạn dùng sang các thành phần con nếu có
        if (Array.isArray(updated[index].components) && updated[index].components.length > 0) {
          updated[index].components = updated[index].components.map((c: any) => ({
            ...c,
            expiry_date: value
          }));
        }
      }

      return { ...prev, items: updated };
    });
  };

  const inboundSummary = useMemo(() => {
    const itms = inboundForm.items || [];
    const totalQty = itms.reduce((sum: number, it: any) => sum + (Number(it.quantity) || 0), 0);
    const totalAmount = itms.reduce((sum: number, it: any) => sum + ((Number(it.quantity) || 0) * (Number(it.unit_price) || 0)), 0);
    return { count: itms.length, totalQty, totalAmount };
  }, [inboundForm.items]);

  const handleInboundSubmit = async () => {
    if (!inboundForm.transaction_code?.trim()) {
      alert("Vui lòng nhập Mã Phiếu Nhập Kho");
      return;
    }
    if (!inboundForm.items || inboundForm.items.length === 0) {
      alert("Phiếu nhập kho phải có ít nhất 1 mặt hàng");
      return;
    }
    for (let i = 0; i < inboundForm.items.length; i++) {
      const it = inboundForm.items[i];
      if (!it.product_code?.trim() || !it.product_name?.trim()) {
        alert(`Dòng hàng thứ ${i + 1} chưa có mã hoặc tên sản phẩm`);
        return;
      }
      if (!it.quantity || Number(it.quantity) <= 0) {
        alert(`Dòng hàng thứ ${i + 1} (${it.product_name}) số lượng phải lớn hơn 0`);
        return;
      }
    }

    try {
      setIsSubmittingInbound(true);
      const payload = {
        ...inboundForm,
        transaction_code: inboundForm.transaction_code.trim(),
        reference_code: inboundForm.reference_code?.trim() || inboundForm.vat_invoice_no?.trim() || "N/A",
        notes: `${inboundForm.inbound_type}. Vận chuyển: ${inboundForm.shipping_unit || "N/A"}. HĐ: ${inboundForm.vat_invoice_no || "N/A"}. ${inboundForm.notes || ""}`.trim(),
        items: inboundForm.items.map((it: any) => {
          // Bảo lưu danh sách thành phần con nếu có
          const comps = it.components && it.components.length > 0 
            ? it.components 
            : productComponents.filter((c) => c.parent_product_code === it.product_code).map((c, i) => ({
                ...c,
                lot_number: it.lot_number || `LOT-${c.component_code.slice(-3)}-01`,
                serial_number: `SN-${c.component_code.replace(/[^a-zA-Z0-9]/g, '')}-00${i + 1}`,
                expiry_date: it.expiry_date || "",
                qc_status: "Đạt chuẩn 100%"
              }));

          const matchedCatalogProd = products.find((p) => p.code === it.product_code.trim());
          return {
            product_code: it.product_code.trim(),
            product_name: it.product_name.trim(),
            category: it.category || matchedCatalogProd?.category || "Hàng Thương Mại",
            manufacturer: it.manufacturer || matchedCatalogProd?.manufacturer || inboundForm.supplier_name || "ABT Phân Phối",
            specification: it.specification || matchedCatalogProd?.specification || "",
            unit: it.unit || matchedCatalogProd?.unit || "Hộp",
            quantity: Number(it.quantity) || 1,
            unit_price: Number(it.unit_price) || 0,
            cost_price: Number(it.unit_price) || 0,
            standard_price: Number(it.standard_price) || Number(matchedCatalogProd?.standard_price) || 0,
            lot_number: it.lot_number || "",
            expiry_date: it.expiry_date || "",
            manufacture_date: it.manufacture_date || "",
            storage_condition: it.storage_condition || matchedCatalogProd?.storage_condition || "15–25°C (Nhiệt độ phòng - RT)",
            storage_location: inboundForm.warehouse_name || "Kho Trung Tâm",
            shelf_position: it.shelf_position || (matchedCatalogProd as any)?.shelf_position || "Chưa phân bổ kệ",
            qc_status: it.qc_status || "Đạt chuẩn 100%",
            item_notes: it.item_notes || "",
            components: comps
          };
        })
      };

      const res = await fetch("/api/inventory?action=inbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        notifyActivity({
          title: "Phiếu Nhập Kho Mới (Inbound)",
          message: `Thủ kho đã hoàn tất nhập kho lô hàng: ${payload.transaction_code} (${payload.items.length} mặt hàng).`,
          category: "warehouse",
          type: "success",
          eventKey: "warehouse_inbound",
          link: { tab: "warehouse", subTab: "transactions" }
        });
        setActionNotice(`✅ Lập phiếu nhập kho ${payload.transaction_code} thành công (${payload.items.length} mặt hàng, đã lưu trữ cấu trúc phụ kiện)!`);
        setIsInboundModalOpen(false);
        fetchData();
      } else {
        alert(data.error || "Lỗi khi lập phiếu nhập kho");
      }
    } catch (e) {
      alert("Lỗi kết nối máy chủ khi lập phiếu nhập kho");
    } finally {
      setIsSubmittingInbound(false);
    }
  };

  const handleOutboundSubmit = async () => {
    if (isSubmittingOutbound) return;
    if (!outboundCodeRef.current) {
      outboundCodeRef.current = `PXK-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    }
    setIsSubmittingOutbound(true);
    try {
      const selectedProdCode = outboundForm.items[0]?.product_code;
      const comps = productComponents.filter((c) => c.parent_product_code === selectedProdCode);
      const qty = Number(outboundForm.items[0]?.quantity) || 1;

      const payload = {
        ...outboundForm,
        transaction_code: outboundCodeRef.current,
        items: outboundForm.items.map((it: any) => ({
          ...it,
          components: comps.map((c, i) => ({
            ...c,
            total_qty: (Number(c.quantity_per_kit) || 1) * qty,
            serial_or_lot: c.tracking_type === "SERIAL" ? `SN-${c.component_code.replace(/[^a-zA-Z0-9]/g, '')}-00${i + 1}` : (it.lot_number || "LOT-STD"),
            status: "Đạt chuẩn bàn giao"
          }))
        }))
      };

      const res = await fetch("/api/inventory?action=outbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        // 409 với cùng mã chứng từ = phiếu này đã được ghi nhận trước đó (không trừ kho thêm lần nữa)
        if (res.status === 409 && String(data.error || "").toLowerCase().includes("duplicate")) {
          outboundCodeRef.current = null;
          setIsOutboundModalOpen(false);
          fetchData();
          setActionNotice(`Phiếu xuất ${payload.transaction_code} đã được ghi nhận trước đó.`);
          return;
        }
        alert(data.error || `Lỗi khi lập phiếu xuất kho (mã lỗi ${res.status})`);
        return;
      }
      if (Array.isArray(data.shortfalls) && data.shortfalls.length > 0) {
        alert(`Lưu ý: xuất vượt tồn — ${data.shortfalls.join("; ")}`);
      }
      outboundCodeRef.current = null;
      notifyActivity({
        title: "Phiếu Xuất Kho Giao Hàng (Outbound)",
        message: `Kho đã xuất hàng thành công cho phiếu ${outboundForm.reference_code || "giao nhận"}.`,
        category: "warehouse",
        type: "info",
        eventKey: "warehouse_outbound",
        link: { tab: "warehouse", subTab: "transactions" }
      });
      setActionNotice(`✅ Đã lập phiếu xuất kho ${data.transaction_code || outboundForm.reference_code || "thành công"}!`);
      setIsOutboundModalOpen(false);
      fetchData();
    } catch (e) {
      alert("Lỗi kết nối khi lập phiếu xuất kho. Bấm xác nhận lại để gửi lại cùng phiếu (không bị trừ kho 2 lần).");
    } finally {
      setIsSubmittingOutbound(false);
    }
  };

  // ==================== BOM & KITS HANDLERS ====================
  const handleOpenAddEditComponent = (comp?: any, defaultParentCode?: string) => {
    if (comp) {
      setIsEditingComponent(true);
      setComponentFormData({
        id: comp.id,
        parent_product_code: comp.parent_product_code,
        component_code: comp.component_code,
        component_name: comp.component_name,
        specification: comp.specification || "",
        unit: comp.unit || "Ống",
        quantity_per_kit: comp.quantity_per_kit || 1,
        tracking_type: comp.tracking_type || "LOT",
        storage_condition: comp.storage_condition || "",
        is_mandatory: comp.is_mandatory !== false,
        notes: comp.notes || ""
      });
    } else {
      setIsEditingComponent(false);
      setComponentFormData({
        id: null,
        parent_product_code: defaultParentCode || selectedBomParent || (products[0]?.code || "HI-007.A (B32)"),
        component_code: "",
        component_name: "",
        specification: "",
        unit: "Ống",
        quantity_per_kit: 1,
        tracking_type: "LOT",
        storage_condition: "",
        is_mandatory: true,
        notes: ""
      });
    }
    setIsComponentModalOpen(true);
  };

  const handleSaveComponent = async () => {
    if (!componentFormData.parent_product_code?.trim() || !componentFormData.component_code?.trim() || !componentFormData.component_name?.trim()) {
      alert("Vui lòng điền đầy đủ Mã sản phẩm chính, Mã thành phần con và Tên thành phần!");
      return;
    }
    if (!componentFormData.storage_condition) {
      alert("Vui lòng chọn điều kiện nhiệt độ bảo quản của thành phần.");
      return;
    }

    try {
      setIsSubmittingComponent(true);
      const res = await fetch("/api/inventory?action=save_product_component", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(componentFormData)
      });
      const data = await res.json();
      if (data.success) {
        setActionNotice(`✅ Đã lưu cấu trúc thành phần ${componentFormData.component_name} cho mã chính ${componentFormData.parent_product_code}!`);
        setIsComponentModalOpen(false);
        fetchData();
      } else {
        alert(data.error || "Lỗi khi lưu thành phần");
      }
    } catch (e: any) {
      alert("Lỗi kết nối khi lưu thành phần: " + e.message);
    } finally {
      setIsSubmittingComponent(false);
    }
  };

  const handleDeleteComponent = async (id: number, name: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa thành phần "${name}" khỏi cấu trúc bộ/kit?`)) return;
    try {
      const res = await fetch("/api/inventory?action=delete_product_component", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (data.success) {
        setActionNotice(`🗑️ Đã xóa thành phần khỏi định mức BOM!`);
        fetchData();
      } else {
        alert(data.error || "Lỗi khi xóa thành phần");
      }
    } catch (e: any) {
      alert("Lỗi kết nối khi xóa: " + e.message);
    }
  };

  const handleExportBomExcel = (parentCode?: string) => {
    const targetComps = parentCode 
      ? productComponents.filter((c) => c.parent_product_code === parentCode)
      : productComponents;

    if (targetComps.length === 0) {
      alert("Chưa có dữ liệu thành phần cấu thành để xuất!");
      return;
    }

    const exportRows = targetComps.map((c, i) => {
      const parentProd = products.find((p) => p.code === c.parent_product_code);
      return {
        "STT": i + 1,
        "Mã Hàng Chính (Parent SKU)": c.parent_product_code,
        "Tên Hàng Chính": parentProd?.name || c.parent_product_code,
        "Mã Thành Phần Con (Child SKU)": c.component_code,
        "Tên Thành Phần / Phụ Kiện Đính Kèm": c.component_name,
        "Quy Cách Kỹ Thuật": c.specification || "",
        "Đơn Vị Tính": c.unit || "Cái",
        "Định Mức / Bộ (Qty)": Number(c.quantity_per_kit) || 1,
        "Phương Thức Quản Lý": c.tracking_type === "LOT" ? "Số Lô (LOT & EXP)" : c.tracking_type === "SERIAL" ? "Số Serial (S/N Máy)" : "Phụ kiện tiêu chuẩn",
        "Điều Kiện Nhiệt Độ Bảo Quản": c.storage_condition || "Nhiệt độ phòng",
        "Tính Bắt Buộc": c.is_mandatory ? "Bắt buộc 100%" : "Tùy chọn",
        "Ghi Chú Kỹ Thuật": c.notes || ""
      };
    });

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "DinhMuc_BOM_Kit");
    const fileName = parentCode ? `BOM_${parentCode}_ABT.xlsx` : `Danh_Muc_BOM_Toan_Bo_Kit_ABT.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  const handleInboundComponentChange = (itemIdx: number, compIdx: number, field: string, value: any) => {
    setInboundForm((prev: any) => {
      const updatedItems = [...prev.items];
      const curItem = updatedItems[itemIdx];
      const comps = [...(curItem.components || [])];
      comps[compIdx] = { ...comps[compIdx], [field]: value };
      updatedItems[itemIdx] = { ...curItem, components: comps };
      return { ...prev, items: updatedItems };
    });
  };

  const handleOpenHandoverChecklist = () => {
    const selectedProdCode = outboundForm.items[0]?.product_code || (products[0]?.code || "HI-007.A (B32)");
    const selectedProd = products.find((p) => p.code === selectedProdCode) || outboundForm.items[0];
    const comps = productComponents.filter((c) => c.parent_product_code === selectedProdCode);
    const qty = Number(outboundForm.items[0]?.quantity) || 1;

    setHandoverData({
      delivery_code: `BBBG-${Date.now().toString().slice(-6)}`,
      date: new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
      order_code: outboundForm.reference_code || "SO-2026-088",
      customer_name: outboundForm.customer_name || "Bệnh viện Đa Khoa / Viện Nghiên Cứu",
      warehouse_name: outboundForm.warehouse_name || "Kho Trung Tâm",
      performed_by: outboundForm.performed_by || "Thủ kho ABT",
      product_code: selectedProdCode,
      product_name: selectedProd?.name || outboundForm.items[0]?.product_name,
      quantity: qty,
      unit: selectedProd?.unit || "Bộ / Kit",
      components: comps.map((c, i) => ({
        ...c,
        total_qty: (Number(c.quantity_per_kit) || 1) * qty,
        serial_or_lot: c.tracking_type === "SERIAL" ? `SN-${c.component_code.replace(/[^a-zA-Z0-9]/g, '')}-00${i + 1}` : (outboundForm.items[0]?.lot_number || ""),
        status: "Đạt chuẩn, nguyên niêm phong COA"
      }))
    });
    setIsHandoverModalOpen(true);
  };

  // ==================== EXCEL INBOUND FUNCTIONS ====================

  // 1. Download Sample Inbound Excel Template (Rút gọn 7 cột cốt lõi - Tự động tra cứu Tên SP, Quy cách, ĐVT, Nhãn hiệu từ Bảng Mã Sản Xuất theo Mã SP)
  const handleDownloadInboundTemplate = () => {
    const p1 = products[0] || { code: "HI-007.A (B32)", name: "TopPURE Maga Quick Genomic DNA/RNA Extraction Kit", specification: "32 tests/hộp", unit: "Hộp", cost_price: 1800000, storage_condition: "2-8°C (Tủ mát)" };
    const p2 = products[1] || { code: "HI-612", name: "TopPURE Serum Viral DNA/RNA Extraction Kit", specification: "96 tests/hộp", unit: "Hộp", cost_price: 2400000, storage_condition: "15–25°C (Nhiệt độ phòng - RT)" };

    const sampleData = [
      {
        "Mã SP": p1.code,
        "Số Lô (Lot)": "L260901",
        "Hạn dùng (Date)": "2027-12-31",
        "Số lượng": 50,
        "Giá trị / Đơn giá đầu kỳ": Number(p1.cost_price) || 1800000,
        "Nhiệt độ bảo quản": p1.storage_condition || "2–8°C (Tủ mát)",
        "Khu vực / Vị trí kho": "Kho Mát 2-8°C - Kệ B1"
      },
      {
        "Mã SP": p2.code,
        "Số Lô (Lot)": "L260902",
        "Hạn dùng (Date)": "2028-06-30",
        "Số lượng": 100,
        "Giá trị / Đơn giá đầu kỳ": Number(p2.cost_price) || 2400000,
        "Nhiệt độ bảo quản": p2.storage_condition || "15–25°C (Nhiệt độ phòng - RT)",
        "Khu vực / Vị trí kho": "Kho Trung Tâm - Kệ K02"
      }
    ];

    const guideData = [
      {
        "Nhóm Thông Tin": "CƠ CHẾ TỰ ĐỘNG TRA CỨU",
        "Tên Cột Trên Excel": "(Tự động từ Bảng Mã Sản Xuất)",
        "Bắt Buộc / Tùy Chọn": "TỰ ĐỘNG 100%",
        "Quy Định & Giá Trị Hợp Lệ": "Tên SP, Quy cách, ĐVT, Nhãn hiệu được hệ thống tự động tra cứu từ Bảng Mã Sản Xuất dựa trên cột 'Mã SP'. Người dùng KHÔNG cần nhập các cột này."
      },
      {
        "Nhóm Thông Tin": "1. MÃ HÀNG HÓA",
        "Tên Cột Trên Excel": "Mã SP",
        "Bắt Buộc / Tùy Chọn": "BẮT BUỘC (*)",
        "Quy Định & Giá Trị Hợp Lệ": "Mã SKU sản phẩm hoặc nguyên liệu (VD: HI-007.A, SQH-115, HI-612). Dùng để tự động đối chiếu Tên SP, Quy cách, ĐVT, Nhãn hiệu."
      },
      {
        "Nhóm Thông Tin": "2. THÔNG TIN LÔ HÀNG",
        "Tên Cột Trên Excel": "Số Lô (Lot)",
        "Bắt Buộc / Tùy Chọn": "BẮT BUỘC (*)",
        "Quy Định & Giá Trị Hợp Lệ": "Số Lô sản xuất (LOT/Batch/Serial Number). Phục vụ truy vết ISO 13485 & FEFO."
      },
      {
        "Nhóm Thông Tin": "3. HẠN SỬ DỤNG",
        "Tên Cột Trên Excel": "Hạn dùng (Date)",
        "Bắt Buộc / Tùy Chọn": "BẮT BUỘC (*)",
        "Quy Định & Giá Trị Hợp Lệ": "Định dạng YYYY-MM-DD (VD: 2027-12-31)."
      },
      {
        "Nhóm Thông Tin": "4. SỐ LƯỢNG TỒN / NHẬP",
        "Tên Cột Trên Excel": "Số lượng",
        "Bắt Buộc / Tùy Chọn": "BẮT BUỘC (*)",
        "Quy Định & Giá Trị Hợp Lệ": "Số nguyên dương lớn hơn 0."
      },
      {
        "Nhóm Thông Tin": "5. ĐỊNH GIÁ TỒN ĐẦU KỲ",
        "Tên Cột Trên Excel": "Giá trị / Đơn giá đầu kỳ",
        "Bắt Buộc / Tùy Chọn": "Khuyến nghị (Cho phép trống)",
        "Quy Định & Giá Trị Hợp Lệ": "Đơn giá vốn / Giá đầu kỳ (VNĐ) của lô hàng để tính giá trị tồn kho. Nếu để trống hệ thống lấy giá vốn mặc định từ danh mục SP."
      },
      {
        "Nhóm Thông Tin": "6. ĐIỀU KIỆN BẢO QUẢN",
        "Tên Cột Trên Excel": "Nhiệt độ bảo quản",
        "Bắt Buộc / Tùy Chọn": "Cho phép để trống",
        "Quy Định & Giá Trị Hợp Lệ": "VD: 15–25°C (Nhiệt độ phòng - RT), 2–8°C (Tủ mát), -20°C (Lạnh âm sâu), -80°C (Âm sâu đặc biệt). Nếu trống sẽ lấy theo danh mục SP hoặc mặc định '15–25°C (Nhiệt độ phòng - RT)'."
      },
      {
        "Nhóm Thông Tin": "7. VỊ TRÍ LƯU KHO",
        "Tên Cột Trên Excel": "Khu vực / Vị trí kho",
        "Bắt Buộc / Tùy Chọn": "Cho phép để trống",
        "Quy Định & Giá Trị Hợp Lệ": "Khu vực kho hoặc kệ lưu trữ (VD: Kho Mát - Kệ B1). Nếu để trống hệ thống ghi nhận 'Chưa phân bổ kệ' (có thể chỉnh sửa trực tiếp trên dòng tồn kho sau)."
      }
    ];

    // Sheet 2: Danh sách phụ kiện & thành phần cấu thành đính kèm (BOM & Multi-Unit Components)
    const componentsData = productComponents.length > 0 ? productComponents.map((c) => ({
      "Mã sản phẩm chính (*)": c.parent_product_code,
      "Số Lô chính (*)": "L260901",
      "Mã thành phần / Phụ kiện (*)": c.component_code,
      "Tên thành phần / Phụ kiện (*)": c.component_name,
      "Định mức theo bộ": Number(c.quantity_per_kit) || 1,
      "Đơn vị tính": c.unit || "Hộp",
      "Hình thức quản lý (LOT/SERIAL)": c.tracking_type || "LOT",
      "Số Lô (LOT) / Serial (S/N)": "L260901",
      "Hạn dùng (EXP)": "2027-12-31",
      "Nhiệt độ bảo quản riêng": c.storage_condition || "2-8°C (Lạnh mát)",
      "Tình trạng QC": "Đạt chuẩn 100% (COA đạt chuẩn)",
      "Ghi chú": c.notes || ""
    })) : [
      {
        "Mã sản phẩm chính (*)": "HI-612",
        "Số Lô chính (*)": "L260901",
        "Mã thành phần / Phụ kiện (*)": "HI-612 (1)",
        "Tên thành phần / Phụ kiện (*)": "Proteninase K - Magbead",
        "Định mức theo bộ": 1,
        "Đơn vị tính": "Hộp",
        "Hình thức quản lý (LOT/SERIAL)": "LOT",
        "Số Lô (LOT) / Serial (S/N)": "L260901",
        "Hạn dùng (EXP)": "2027-12-31",
        "Nhiệt độ bảo quản riêng": "2-8°C (Lạnh mát)",
        "Tình trạng QC": "Đạt chuẩn 100% (COA đạt chuẩn)",
        "Ghi chú": "Bảo quản tránh ánh sáng"
      }
    ];

    const ws = XLSX.utils.json_to_sheet(sampleData);
    const wsComps = XLSX.utils.json_to_sheet(componentsData);
    const wsGuide = XLSX.utils.json_to_sheet(guideData);
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, ws, "Phieu_Nhap_Kho_Chinh");
    XLSX.utils.book_append_sheet(wb, wsComps, "Chi_Tiet_Thanh_Phan_Dinh_Kem");
    XLSX.utils.book_append_sheet(wb, wsGuide, "Huong_Dan_Quy_Dinh");

    ws["!cols"] = [
      { wch: 20 }, // 1. Mã SP
      { wch: 18 }, // 2. Số Lô (Lot)
      { wch: 18 }, // 3. Hạn dùng (Date)
      { wch: 14 }, // 4. Số lượng
      { wch: 24 }, // 5. Giá trị / Đơn giá đầu kỳ
      { wch: 30 }, // 6. Nhiệt độ bảo quản
      { wch: 28 }  // 7. Khu vực / Vị trí kho
    ];

    wsComps["!cols"] = [
      { wch: 20 }, // Mã SP chính (*)
      { wch: 20 }, // Số Lô chính (*)
      { wch: 22 }, // Mã thành phần (*)
      { wch: 45 }, // Tên thành phần (*)
      { wch: 16 }, // Định mức
      { wch: 14 }, // ĐVT
      { wch: 24 }, // Hình thức quản lý
      { wch: 22 }, // Số Lô/Serial
      { wch: 16 }, // Hạn dùng
      { wch: 35 }, // Nhiệt độ bảo quản
      { wch: 25 }, // Tình trạng QC
      { wch: 40 }  // Ghi chú
    ];

    wsGuide["!cols"] = [
      { wch: 26 },
      { wch: 32 },
      { wch: 24 },
      { wch: 75 }
    ];

    XLSX.writeFile(wb, "TBR_Mau_Nhap_Kho_Rut_Gon_7_Cot.xlsx");
  };

  // 2. Upload & Parse Excel file (Hỗ trợ mẫu rút gọn 7 cột & tự động tra cứu từ Bảng Mã Sản Xuất)
  const processInboundExcelFile = (file: File) => {
    if (!file) return;
    const isExcelOrCsv = /\.(xlsx|xls|csv)$/i.test(file.name) ||
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.type === "application/vnd.ms-excel" ||
      file.type === "text/csv";

    if (!isExcelOrCsv) {
      alert("Vui lòng chọn hoặc kéo thả file định dạng Excel (.xlsx, .xls)!");
      return;
    }

    setExcelInboundFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: "binary" });
        const wsName = wb.SheetNames[0];
        const ws = wb.Sheets[wsName];
        const rawJson: any[] = XLSX.utils.sheet_to_json(ws).map((r: any) => normalizeExcelRowDates(r));

        if (!rawJson || rawJson.length === 0) {
          alert("File Excel không có dữ liệu hàng hóa");
          return;
        }

        // Auto-extract header details if present in the first row
        const firstRow = rawJson[0] || {};
        const headerSupplier = firstRow["Nhà Cung Cấp"] || firstRow["Nhà cung cấp / Nguồn hàng"] || "";
        const headerPO = firstRow["Mã Đơn Đặt Hàng (PO)"] || firstRow["Mã Đơn Đặt Hàng (PO) Tham Chiếu"] || firstRow["Mã PO"] || "";
        const headerInvoice = firstRow["Số Hóa Đơn VAT / Tờ khai HQ"] || firstRow["Số Hóa Đơn VAT / Tờ Khai Hải Quan"] || firstRow["Số Hóa Đơn VAT"] || "";
        const headerReason = firstRow["Loại hình / Lý do nhập"] || "";
        const headerWarehouse = firstRow["Kho Tiếp Nhận"] || "";
        const headerPerformedBy = firstRow["Thủ Kho / Người Tiếp Nhận"] || "";

        if (headerSupplier || headerPO || headerInvoice || headerWarehouse || headerPerformedBy) {
          setExcelInboundDetails((prev) => ({
            ...prev,
            ...(headerSupplier ? { supplier_name: headerSupplier } : {}),
            ...(headerPO ? { reference_code: headerPO } : {}),
            ...(headerInvoice ? { vat_invoice_no: headerInvoice } : {}),
            ...(headerReason ? { inbound_reason: headerReason } : {}),
            ...(headerWarehouse ? { warehouse_name: headerWarehouse } : {}),
            ...(headerPerformedBy ? { performed_by: headerPerformedBy } : {})
          }));
        }

        const parsed = rawJson.map((r, idx) => {
          const rawCode = String(
            r["Mã SP"] ||
            r["Mã sản phẩm (*)"] ||
            r["Mã sản phẩm"] ||
            r["Mã hàng"] ||
            r["Mã SKU"] ||
            r["sku"] ||
            r["code"] ||
            r["product_code"] ||
            ""
          ).trim();

          // Tự động tra cứu Tên SP, Quy cách, ĐVT, Nhãn hiệu, Giá vốn, Bảo quản từ Bảng Mã Sản Xuất (products)
          const matchedProd = products.find(
            (p) => String(p.code || "").trim().toLowerCase() === rawCode.toLowerCase()
          );

          const product_code = rawCode;
          const product_name =
            String(
              r["Tên hàng hóa / Sinh phẩm (*)"] ||
              r["Tên hàng hóa"] ||
              r["Tên sản phẩm"] ||
              r["Tên SP"] ||
              r["product_name"] ||
              ""
            ).trim() ||
            matchedProd?.name ||
            (rawCode ? `Sản phẩm ${rawCode}` : "");

          const specification =
            String(r["Quy cách đóng gói"] || r["Quy cách"] || r["specification"] || "").trim() ||
            matchedProd?.specification ||
            "";

          const unit =
            String(r["Đơn vị tính"] || r["Đơn vị tính (ĐVT)"] || r["ĐVT"] || r["unit"] || "").trim() ||
            matchedProd?.unit ||
            "Hộp";

          const manufacturer =
            String(r["Nhãn hiệu"] || r["Hãng SX"] || r["Hãng sản xuất"] || r["manufacturer"] || r["brand"] || "").trim() ||
            matchedProd?.manufacturer ||
            "ABT Phân Phối";

          const quantity =
            Number(
              r["Số lượng"] ??
              r["Số lượng nhập (*)"] ??
              r["Số lượng nhập"] ??
              r["quantity"] ??
              0
            ) || 0;

          const rawPrice =
            r["Giá trị / Đơn giá đầu kỳ"] ??
            r["Đơn giá đầu kỳ"] ??
            r["Giá đầu kỳ"] ??
            r["Đơn giá nhập (VNĐ)"] ??
            r["Đơn giá nhập"] ??
            r["Đơn giá"] ??
            r["Giá vốn"] ??
            r["unitCost"] ??
            r["costPrice"] ??
            r["price"];

          const parsedPrice =
            rawPrice !== undefined && rawPrice !== null && String(rawPrice).trim() !== ""
              ? Number(String(rawPrice).replace(/,/g, ""))
              : NaN;

          const unit_price =
            Number.isFinite(parsedPrice) && parsedPrice >= 0
              ? parsedPrice
              : Number(matchedProd?.cost_price) || Number(matchedProd?.standard_price) || 0;

          const lot_number =
            String(
              r["Số Lô (Lot)"] ||
              r["Số Lô (LOT) (*)"] ||
              r["Số Lô (LOT)"] ||
              r["Số Lô"] ||
              r["Lô"] ||
              r["lot_number"] ||
              ""
            ).trim() || "LOT-STD";

          const rawExpDate = String(
            r["Hạn dùng (Date)"] ||
            r["Hạn sử dụng (EXP) (*)"] ||
            r["Hạn sử dụng (EXP)"] ||
            r["Hạn sử dụng"] ||
            r["Hạn dùng"] ||
            r["expiry_date"] ||
            ""
          ).trim();
          const expiry_date = normalizeExcelDateToISO(rawExpDate, rawExpDate);

          const rawMfgDate = String(
            r["Ngày sản xuất (MFG)"] || r["Ngày sản xuất"] || r["mfg_date"] || ""
          ).trim();
          const manufacture_date = normalizeExcelDateToISO(rawMfgDate, rawMfgDate);

          // Không ép mặc định -20°C hoặc Kệ A01 khi người dùng để trống
          const rawTemp = String(
            r["Nhiệt độ bảo quản"] || r["Điều kiện nhiệt độ bảo quản"] || r["storage_condition"] || ""
          ).trim();
          const storage_condition =
            rawTemp || matchedProd?.storage_condition || "15–25°C (Nhiệt độ phòng - RT)";

          const rawLoc = String(
            r["Khu vực / Vị trí kho"] ||
            r["Vị trí tủ / kệ lưu trữ"] ||
            r["Vị trí kho / Tủ lưu trữ"] ||
            r["Vị trí kệ kho"] ||
            r["Vị trí"] ||
            r["shelf_position"] ||
            ""
          ).trim();

          const shelf_position =
            rawLoc || (matchedProd as any)?.shelf_position || "Chưa phân bổ kệ";
          const storage_location = rawLoc || "Kho Trung Tâm";

          const qc_status =
            r["Kiểm nhận / Tình trạng QC"] ||
            r["Tình trạng QC"] ||
            "Đạt chuẩn 100% (Nguyên niêm phong & COA)";
          const notes = r["Ghi chú"] || r["notes"] || "";

          return {
            id: idx + 1,
            product_code,
            product_name,
            specification,
            unit,
            manufacturer,
            quantity,
            unit_price,
            total_amount: quantity * unit_price,
            lot_number,
            expiry_date,
            manufacture_date,
            storage_condition,
            storage_location,
            shelf_position,
            qc_status,
            notes,
            isAutoLookedUp: !!matchedProd,
            isValid: product_code.trim().length > 0 && quantity > 0
          };
        });

        setExcelInboundRows(parsed);
      } catch (err) {
        console.error("Excel parse error:", err);
        alert("Lỗi đọc file Excel. Vui lòng kiểm tra định dạng file.");
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleExcelInboundUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processInboundExcelFile(file);
    }
    e.target.value = "";
  };

  // 3. Confirm Excel Inbound to Server
  const handleConfirmExcelInbound = async () => {
    const validRows = excelInboundRows.filter((r) => r.isValid);
    if (validRows.length === 0) {
      alert("Không có dòng dữ liệu hợp lệ để nhập kho");
      return;
    }

    try {
      setIsSubmittingExcelInbound(true);
      // Giữ nguyên mã phiếu cho tới khi nhập thành công: thử lại sau lỗi mạng không nhập kho 2 lần
      if (!excelInboundCodeRef.current) {
        excelInboundCodeRef.current = `PNK-EXCEL-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      }
      const code = excelInboundCodeRef.current;
      const payload = {
        transaction_code: code,
        date: todayVN(),
        performed_by: excelInboundDetails.performed_by,
        reference_code: excelInboundDetails.reference_code,
        warehouse_name: excelInboundDetails.warehouse_name,
        supplier_name: excelInboundDetails.supplier_name,
        vat_invoice_no: excelInboundDetails.vat_invoice_no,
        inbound_reason: excelInboundDetails.inbound_reason,
        items: validRows.map((r) => ({
          product_code: r.product_code,
          product_name: r.product_name,
          specification: r.specification,
          unit: r.unit,
          manufacturer: r.manufacturer,
          quantity: r.quantity,
          unit_price: r.unit_price,
          cost_price: r.unit_price,
          total_amount: r.total_amount,
          lot_number: r.lot_number,
          expiry_date: r.expiry_date,
          manufacture_date: r.manufacture_date,
          storage_condition: r.storage_condition || "15–25°C (Nhiệt độ phòng - RT)",
          shelf_position: r.shelf_position || "Chưa phân bổ kệ",
          storage_location: r.storage_location || excelInboundDetails.warehouse_name || "Kho Trung Tâm",
          qc_status: r.qc_status,
          notes: r.notes
        })),
        notes: `${excelInboundDetails.inbound_reason}. Hóa đơn: ${excelInboundDetails.vat_invoice_no}. ${excelInboundDetails.notes || ""}`
      };

      const res = await fetch("/api/inventory?action=inbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        excelInboundCodeRef.current = null;
        setActionNotice(`✅ Nhập kho thành công ${validRows.length} mặt hàng theo phiếu ${code} (đã ghi nhận giá vốn đầu kỳ & điều kiện bảo quản)!`);
        setIsExcelInboundModalOpen(false);
        setExcelInboundRows([]);
        setExcelInboundFileName("");
        fetchData();
      } else {
        alert(data.error || "Lỗi khi nhập kho");
      }
    } catch (e) {
      alert("Lỗi kết nối máy chủ");
    } finally {
      setIsSubmittingExcelInbound(false);
    }
  };

  // 4. Export Inventory Items to Excel
  const handleExportStockToExcel = () => {
    if (items.length === 0) {
      alert("Không có dữ liệu tồn kho để xuất");
      return;
    }
    const exportData = enrichedItems.map((i) => ({
      "Mã sản phẩm": i.product_code,
      "Tên hàng hóa / Sinh phẩm": i.product_name,
      "Phân nhóm": i.category || "Hàng thương mại",
      "Tồn kho thực tế": i.quantity_on_hand,
      "Đang giữ chỗ": i.quantity_allocated || 0,
      "Khả dụng": i.quantity_available,
      "Đơn giá vốn / Đầu kỳ (VNĐ)": i.cost_price || 0,
      "Thành tiền tồn kho (VNĐ)": (Number(i.quantity_on_hand) || 0) * (Number(i.cost_price) || 0),
      "Định mức an toàn (Min)": i.min_stock_level || 10,
      "Số Lô (LOT)": i.lot_number,
      "Hạn dùng (EXP)": i.expiry_date,
      "Số ngày còn hạn (ngày)": i.days_to_expiry,
      "Điều kiện nhiệt độ": i.storage_temp,
      "Vị trí lưu kho": `${i.warehouse_location || "Kho Trung Tâm"} - ${i.shelf_position || "Chưa phân bổ kệ"}`,
      "Mức độ rủi ro": i.isNearExpiry ? `CẬN DATE (Còn ${i.days_to_expiry} ngày)` : i.isStockoutRisk ? "TỒN DƯỚI ĐỊNH MỨC" : i.isSlowMoving ? "CHẬM LUÂN CHUYỂN" : "AN TOÀN",
      "Hành động khuyến nghị": i.isNearExpiry ? "Đẩy bán FEFO sang Sales" : i.isStockoutRisk ? "Tạo PO mua hàng sang Cung Ứng" : "Theo dõi thường quy"
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ton_Kho_ABT");
    XLSX.writeFile(wb, `TBR_Bao_Cao_Ton_Kho_${todayVN()}.xlsx`);
  };

  // 5. Open & Save Stock Item / Lot Edit Modal (Chỉnh sửa Lô, Hạn dùng, Giá đầu kỳ, Nhiệt độ bảo quản & Vị trí Kệ trực tiếp trên dòng tồn kho)
  const STANDARD_STORAGE_TEMPS = [
    "15–25°C (Nhiệt độ phòng - RT)",
    "2–8°C (Tủ mát)",
    "-20°C (Lạnh âm sâu)",
    "-80°C (Âm sâu đặc biệt)"
  ];

  const handleOpenEditStockModal = (item: any) => {
    const currentTemp = item.storage_temp || item.storage_condition || "15–25°C (Nhiệt độ phòng - RT)";
    const isStandardTemp = STANDARD_STORAGE_TEMPS.includes(currentTemp);
    setEditingStockItem(item);
    setEditStockForm({
      product_code: String(item.product_code || ""),
      product_name: String(item.product_name || ""),
      old_lot_number: String(item.lot_number || ""),
      lot_number: item.lot_number && item.lot_number !== "Chưa có lô" ? String(item.lot_number) : "",
      expiry_date: item.expiry_date && item.expiry_date !== "N/A" ? String(item.expiry_date) : "",
      cost_price: Number(item.cost_price) || 0,
      quantity_on_hand: Number(item.quantity_on_hand) || 0,
      unit: String(item.unit || "Hộp"),
      storage_condition: isStandardTemp ? currentTemp : "CUSTOM",
      custom_storage_condition: isStandardTemp ? "" : currentTemp,
      warehouse_location: String(item.warehouse_location || "Kho Trung Tâm"),
      shelf_position: String(item.shelf_position || "Chưa phân bổ kệ")
    });
    setIsEditStockModalOpen(true);
  };

  const handleSaveStockEdit = async () => {
    if (!editingStockItem) return;
    const finalStorageCondition =
      editStockForm.storage_condition === "CUSTOM"
        ? (editStockForm.custom_storage_condition.trim() || "15–25°C (Nhiệt độ phòng - RT)")
        : editStockForm.storage_condition;
    const finalShelf = editStockForm.shelf_position.trim() || "Chưa phân bổ kệ";
    const finalWarehouse = editStockForm.warehouse_location.trim() || "Kho Trung Tâm";
    const finalLot = editStockForm.lot_number.trim() || "Chưa có lô";
    const finalExp = editStockForm.expiry_date.trim() || "";
    const finalCostPrice = Number(editStockForm.cost_price) || 0;

    try {
      setIsSavingStockEdit(true);
      const res = await fetch("/api/inventory?action=update_item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingStockItem.id,
          product_code: editingStockItem.product_code,
          old_lot_number: editingStockItem.lot_number,
          lot_number: finalLot,
          expiry_date: finalExp,
          cost_price: finalCostPrice,
          storage_condition: finalStorageCondition,
          warehouse_location: finalWarehouse,
          shelf_position: finalShelf
        })
      });
      const data = await res.json();

      // Cập nhật ngay state ở client để giao diện phản hồi tức thì
      setItems((prev) =>
        prev.map((it) =>
          it.product_code === editingStockItem.product_code &&
          (editingStockItem.id ? it.id === editingStockItem.id : true)
            ? {
                ...it,
                lot_number: finalLot,
                earliest_lot: finalLot,
                expiry_date: finalExp,
                earliest_expiry: finalExp,
                cost_price: finalCostPrice,
                storage_condition: finalStorageCondition,
                warehouse_location: finalWarehouse,
                shelf_position: finalShelf
              }
            : it
        )
      );
      setProducts((prev) =>
        prev.map((p) =>
          p.code === editingStockItem.product_code
            ? {
                ...p,
                cost_price: finalCostPrice > 0 ? finalCostPrice : p.cost_price,
                storage_condition: finalStorageCondition
              }
            : p
        )
      );

      if (data.success) {
        setActionNotice(
          `✅ Đã cập nhật lô & bảo quản cho [${editingStockItem.product_code}]: Lô ${finalLot} • Nhiệt độ: ${finalStorageCondition} • Vị trí: ${finalWarehouse} (${finalShelf}) • Giá vốn đầu kỳ: ${formatCurrency(finalCostPrice)}`
        );
        setIsEditStockModalOpen(false);
        setEditingStockItem(null);
        fetchData();
      } else {
        setActionNotice(
          `✅ Đã cập nhật thông tin lô & bảo quản cho [${editingStockItem.product_code}] trên phiên làm việc.`
        );
        setIsEditStockModalOpen(false);
        setEditingStockItem(null);
      }
    } catch (e) {
      alert("Lỗi kết nối máy chủ khi lưu thông tin lô & bảo quản");
    } finally {
      setIsSavingStockEdit(false);
    }
  };

  // Reservation handlers
  const handleConfirmReserve = async () => {
    if (!selectedReserveItem) return;
    if (!reserveFormData.customer_name.trim()) {
      alert("Vui lòng nhập tên khách hàng dự kiến giữ chỗ");
      return;
    }
    if (Number(reserveFormData.quantity_reserved) <= 0) {
      alert("Số lượng giữ chỗ phải lớn hơn 0");
      return;
    }
    const maxAvailable = selectedReserveItem.quantity_available || 0;
    if (Number(reserveFormData.quantity_reserved) > maxAvailable) {
      alert(`Số lượng giữ chỗ (${reserveFormData.quantity_reserved}) không được vượt quá tồn khả dụng (${maxAvailable})`);
      return;
    }

    try {
      setIsSubmittingReserve(true);
      const res = await fetch("/api/inventory?action=reserve_stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_code: `RES-ABT-${Date.now().toString().slice(-5)}`,
          customer_name: reserveFormData.customer_name,
          sales_rep_name: reserveFormData.sales_rep_name,
          product_code: selectedReserveItem.product_code,
          product_name: selectedReserveItem.product_name,
          lot_number: selectedReserveItem.lot_number,
          quantity_reserved: Number(reserveFormData.quantity_reserved),
          hold_until_date: reserveFormData.hold_until_date,
          notes: reserveFormData.notes
        })
      });
      const data = await res.json();
      if (data.success) {
        setActionNotice(`Đã giữ thành công ${reserveFormData.quantity_reserved} SP (Lô: ${selectedReserveItem.lot_number}) cho NVKD ${reserveFormData.sales_rep_name}!`);
        setIsReserveModalOpen(false);
        fetchData();
      } else {
        alert(data.error || "Lỗi khi tạo giữ chỗ");
      }
    } catch (e) {
      alert("Lỗi kết nối máy chủ");
    } finally {
      setIsSubmittingReserve(false);
    }
  };

  const handleReleaseReservation = async (reservation: any) => {
    if (!confirm(`Bạn có chắc chắn muốn giải phóng phiếu giữ chỗ #${reservation.id} (${reservation.quantity_reserved} ${reservation.product_code} của ${reservation.sales_rep_name}) về lại tồn khả dụng kho?`)) {
      return;
    }

    try {
      const res = await fetch("/api/inventory?action=release_reservation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservation_id: reservation.id,
          product_code: reservation.product_code,
          quantity_reserved: reservation.quantity_reserved,
          actor: "Thủ kho ABT",
          reason: "Thủ kho giải phóng lại cho tồn khả dụng chung"
        })
      });
      const data = await res.json();
      if (data.success) {
        setActionNotice(`Đã giải phóng ${reservation.quantity_reserved} SP về tồn khả dụng kho thành công!`);
        fetchData();
      } else {
        alert(data.error || "Lỗi khi giải phóng");
      }
    } catch (e) {
      alert("Lỗi kết nối máy chủ");
    }
  };

  // Reservation computed metrics
  const activeReservations = useMemo(() => {
    return reservations.filter((r) => r.status === "ACTIVE");
  }, [reservations]);

  const totalReservedQty = useMemo(() => {
    return activeReservations.reduce((sum, r) => sum + (Number(r.quantity_reserved) || 0), 0);
  }, [activeReservations]);

  const distinctSalesReps = useMemo(() => {
    const map = new Map<string, { count: number; qty: number }>();
    activeReservations.forEach((r) => {
      const rep = r.sales_rep_name || "Chưa gán";
      const existing = map.get(rep) || { count: 0, qty: 0 };
      map.set(rep, {
        count: existing.count + 1,
        qty: existing.qty + (Number(r.quantity_reserved) || 0)
      });
    });
    return Array.from(map.entries()).map(([rep, stats]) => ({ rep, ...stats }));
  }, [activeReservations]);

  const overdueCount = useMemo(() => {
    const today = todayVN();
    return activeReservations.filter((r) => r.hold_until_date && r.hold_until_date.slice(0, 10) < today).length;
  }, [activeReservations]);

  const filteredReservations = useMemo(() => {
    return reservations.filter((r) => {
      if (selectedRepFilter !== "all" && r.sales_rep_name !== selectedRepFilter) return false;
      return true;
    });
  }, [reservations, selectedRepFilter]);

  const transactionsPage = usePaged(transactions, 20);
  const reservationsPage = usePaged(filteredReservations, 20);

  // Summary calculations for Excel Inbound
  const excelSummary = useMemo(() => {
    const valid = excelInboundRows.filter((r) => r.isValid);
    const totalQty = valid.reduce((sum, r) => sum + r.quantity, 0);
    const totalAmount = valid.reduce((sum, r) => sum + r.total_amount, 0);
    return { count: valid.length, totalQty, totalAmount };
  }, [excelInboundRows]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
            <Package className="w-6 h-6" />
            <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white">
              HỆ THỐNG QUẢN LÝ KHO ABT
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Phân hệ độc lập quản lý xuất nhập tồn hàng hóa, theo dõi rủi ro lô hạn và giữ chỗ tồn kho (ATP) ABT.
          </p>
        </div>

        {/* Primary Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* QUẢN LÝ GIỮ CHỖ SALES BUTTON */}
          <button
            onClick={() => setSubTab("reservations")}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm shadow-indigo-600/30 transition-all"
          >
            <BookmarkCheck className="w-4 h-4" />
            <span>📦 Giữ Chỗ Sales ({activeReservations.length})</span>
          </button>

          {/* EXCEL IMPORT BUTTON */}
          <button
            onClick={() => setIsExcelInboundModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/30 transition-all"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>📥 Nhập Kho Bằng Excel</span>
          </button>

          <button
            onClick={() => {
              setInboundForm((prev: any) => ({
                ...prev,
                transaction_code: `PNK-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`,
                date: todayVN(),
              }));
              setIsInboundModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white shadow-xs transition-all"
          >
            <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
            <span>Lập Phiếu Nhập Kho</span>
          </button>

          <button
            onClick={() => { outboundCodeRef.current = null; setIsOutboundModalOpen(true); }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white shadow-xs shadow-orange-600/30 transition-all"
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>Xuất Kho (Bán Hàng / Demo)</span>
          </button>

          <button
            onClick={handleExportStockToExcel}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all shadow-xs"
            title="Xuất bảng tồn kho ra file Excel"
          >
            <Download className="w-4 h-4 text-slate-500" />
            <span>Xuất Excel</span>
          </button>
        </div>
      </div>

      {/* Action Notice Alert */}
      {actionNotice && (
        <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 p-4 rounded-2xl flex items-center justify-between text-xs text-emerald-800 dark:text-emerald-200 animate-fade-in shadow-sm">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="font-semibold">{actionNotice}</span>
          </div>
          <button
            onClick={() => setActionNotice(null)}
            className="p-1 text-emerald-600 hover:text-emerald-900 dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 4 BỘ CHỈ SỐ RỦI RO KHO HÀNG & PHÒNG NGỪA (4 RISK KPI CARDS) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Cận Date / Hết Hạn */}
        <div
          onClick={() => setRiskFilter(riskFilter === "near_exp" ? "all" : "near_exp")}
          className={`p-4 rounded-2xl border transition-all cursor-pointer shadow-xs relative overflow-hidden ${
            riskFilter === "near_exp"
              ? "bg-rose-50 dark:bg-rose-950/40 border-rose-400 dark:border-rose-700 ring-2 ring-rose-500/20"
              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-rose-300"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
              <AlertOctagon className="w-4 h-4" /> Rủi Ro Hạn Dùng (EXP)
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200">
              FEFO Priority
            </span>
          </div>
          <div className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-2 font-mono">
            {riskKPIs.nearExpCount} <span className="text-xs font-semibold text-slate-500">mã có lô cận hạn</span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-between">
            <span>Hạn dùng &lt; 90 ngày</span>
            <span className="font-bold text-rose-600 hover:underline">Ưu tiên đẩy bán →</span>
          </div>
        </div>

        {/* Card 2: Rủi ro đứt gãy cung ứng / Tồn thấp */}
        <div
          onClick={() => setRiskFilter(riskFilter === "low_stock" ? "all" : "low_stock")}
          className={`p-4 rounded-2xl border transition-all cursor-pointer shadow-xs relative overflow-hidden ${
            riskFilter === "low_stock"
              ? "bg-amber-50 dark:bg-amber-950/40 border-amber-400 dark:border-amber-700 ring-2 ring-amber-500/20"
              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-amber-300"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" /> Tồn Kho Dưới Định Mức
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
              Stockout Risk
            </span>
          </div>
          <div className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-2 font-mono">
            {riskKPIs.lowStockCount} <span className="text-xs font-semibold text-slate-500">mặt hàng</span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-between">
            <span>Dưới ngưỡng an toàn min</span>
            <span className="font-bold text-amber-600 hover:underline">Tạo đề xuất mua (PR) →</span>
          </div>
        </div>

        {/* Card 3: Chuỗi Lạnh Cold-Chain */}
        <div
          onClick={() => setTempFilter(tempFilter === "-20C" ? "all" : "-20C")}
          className={`p-4 rounded-2xl border transition-all cursor-pointer shadow-xs relative overflow-hidden ${
            tempFilter === "-20C" || tempFilter === "2-8C"
              ? "bg-cyan-50 dark:bg-cyan-950/40 border-cyan-400 dark:border-cyan-700 ring-2 ring-cyan-500/20"
              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-cyan-300"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-cyan-600 dark:text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
              <ThermometerSnowflake className="w-4 h-4" /> Giám Sát Chuỗi Lạnh
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-800 dark:bg-cyan-900/60 dark:text-cyan-200">
              Cold-Chain
            </span>
          </div>
          <div className="text-2xl font-black text-cyan-700 dark:text-cyan-300 mt-2 font-mono">
            {riskKPIs.coldChainCount} <span className="text-xs font-semibold text-slate-500">mã hàng</span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-between">
            <span>-20°C &amp; Kho mát 2-8°C</span>
            <span className="font-bold text-cyan-600">Kiểm soát nhiệt độ</span>
          </div>
        </div>

        {/* Card 4: Chậm luân chuyển / Ứ đọng vốn */}
        <div
          onClick={() => setRiskFilter(riskFilter === "slow_moving" ? "all" : "slow_moving")}
          className={`p-4 rounded-2xl border transition-all cursor-pointer shadow-xs relative overflow-hidden ${
            riskFilter === "slow_moving"
              ? "bg-purple-50 dark:bg-purple-950/40 border-purple-400 dark:border-purple-700 ring-2 ring-purple-500/20"
              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-purple-300"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-4 h-4" /> Chậm Luân Chuyển
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200">
              Slow-Moving
            </span>
          </div>
          <div className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-2 font-mono">
            {riskKPIs.slowMovingCount} <span className="text-xs font-semibold text-slate-500">mặt hàng</span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-between">
            <span>Không xuất &gt;60 ngày</span>
            <span className="font-bold text-purple-600">Ứ đọng vốn kho</span>
          </div>
        </div>
      </div>

      {/* Tabs Switcher: Stock vs Reservations vs Transactions */}
      <div className="flex flex-wrap items-center border-b border-slate-200 dark:border-slate-800 gap-x-4 gap-y-1.5 text-xs font-bold pb-1">
        <button
          onClick={() => setSubTab("stock")}
          title="Bảng Tồn Kho & Theo Dõi Rủi Ro"
          className={`pb-2 pt-1 transition-all flex items-center gap-1.5 shrink-0 ${
            subTab === "stock"
              ? "border-b-2 border-orange-600 text-orange-600 dark:text-orange-400"
              : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          <Layers className="w-4 h-4" /> Tồn Kho &amp; Rủi Ro ({filteredItems.length}/{enrichedItems.length} mã)
        </button>
        <button
          onClick={() => { setLotStockQuery(""); setSubTab("lot_stock"); }}
          title="Tồn kho theo từng lô: Bình thường / Cận date / Hết date, lọc theo hãng, nhóm hàng; xuất Excel theo từng loại"
          className={`pb-2 pt-1 transition-all flex items-center gap-1.5 shrink-0 ${
            subTab === "lot_stock"
              ? "border-b-2 border-orange-600 text-orange-600 dark:text-orange-400"
              : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          <CalendarClock className="w-4 h-4 text-amber-500" /> Tồn Theo Lô &amp; HSD
        </button>
        <button
          onClick={() => setSubTab("movement_report")}
          title="Báo cáo Xuất – Nhập – Tồn theo kỳ (nhập mua, nhập trả, xuất, điều chỉnh)"
          className={`pb-2 pt-1 transition-all flex items-center gap-1.5 shrink-0 ${
            subTab === "movement_report"
              ? "border-b-2 border-orange-600 text-orange-600 dark:text-orange-400"
              : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          <FileSpreadsheet className="w-4 h-4 text-emerald-500" /> Báo Cáo Xuất-Nhập-Tồn
        </button>
        <button
          onClick={() => setSubTab("reservations")}
          title="Quản Lý Giữ Chỗ Sales"
          className={`pb-2 pt-1 transition-all flex items-center gap-1.5 shrink-0 ${
            subTab === "reservations"
              ? "border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          <BookmarkCheck className="w-4 h-4 text-indigo-500" /> Giữ Chỗ Sales ({activeReservations.length})
        </button>
        <button
          onClick={() => setSubTab("transactions")}
          title="Sổ Lịch Sử Xuất Nhập Kho (Thẻ Kho)"
          className={`pb-2 pt-1 transition-all flex items-center gap-1.5 shrink-0 ${
            subTab === "transactions"
              ? "border-b-2 border-orange-600 text-orange-600 dark:text-orange-400"
              : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          <FileText className="w-4 h-4" /> Thẻ Kho &amp; Lịch Sử
        </button>
        <button
          onClick={() => setSubTab("valuation")}
          title="Báo Cáo Định Giá Tồn Kho (Hãng & Nhóm)"
          className={`pb-2 pt-1 transition-all flex items-center gap-1.5 shrink-0 ${
            subTab === "valuation"
              ? "border-b-2 border-emerald-600 text-emerald-600 dark:text-emerald-400"
              : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          <FileSpreadsheet className="w-4 h-4 text-emerald-500" /> Định Giá Tồn Kho
        </button>
        <button
          onClick={() => {
            setSubTab("lot_trace");
            if (!traceResult && enrichedItems.length > 0) {
              const firstLot = enrichedItems.find(i => i.lot_number)?.lot_number;
              if (firstLot) {
                setTraceLotQuery(firstLot);
                handleTraceLot(firstLot);
              }
            }
          }}
          title="Truy Vết Lô 360° & Thu Hồi (ISO 13485)"
          className={`pb-2 pt-1 transition-all flex items-center gap-1.5 shrink-0 ${
            subTab === "lot_trace"
              ? "border-b-2 border-rose-600 text-rose-600 dark:text-rose-400"
              : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          <ShieldAlert className="w-4 h-4 text-rose-500" /> Truy Vết Lô 360°
        </button>
        <button
          onClick={() => setSubTab("excel_center")}
          title="Biểu Mẫu Excel & Import Chuẩn"
          className={`pb-2 pt-1 transition-all flex items-center gap-1.5 shrink-0 ${
            subTab === "excel_center"
              ? "border-b-2 border-teal-600 text-teal-600 dark:text-teal-400"
              : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          <FileSpreadsheet className="w-4 h-4 text-teal-500" /> Excel &amp; Import
        </button>
        <button
          onClick={() => setSubTab("bom_kits")}
          title="Cấu Trúc Bộ / Kit & Phụ Kiện (BOM)"
          className={`pb-2 pt-1 transition-all flex items-center gap-1.5 shrink-0 ${
            subTab === "bom_kits"
              ? "border-b-2 border-purple-600 text-purple-600 dark:text-purple-400"
              : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          <Package className="w-4 h-4 text-purple-500" /> Bộ Kit &amp; Phụ Kiện BOM
        </button>
        <button
          onClick={() => setSubTab("rfid_hub")}
          title="Kiểm Kho Tự Động Bằng Barcode & RFID 4.0"
          className={`pb-2 pt-1 transition-all flex items-center gap-1.5 shrink-0 ${
            subTab === "rfid_hub"
              ? "border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400 font-black"
              : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          <BarcodeIcon className="w-4 h-4 text-emerald-500" />
          <span className="flex items-center gap-1.5">
            <span>Barcode &amp; RFID 4.0</span>
            <span className="px-1.5 py-0.2 rounded-full text-[9px] font-black bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-300">
              NEW
            </span>
          </span>
        </button>
      </div>

      {subTab === "lot_stock" && <LotStockView key={lotStockQuery} productCode={lotStockQuery} />}
      {subTab === "movement_report" && <MovementReportView />}

      {/* TAB 1: STOCK INVENTORY WITH RISK TOOLKIT */}
      {subTab === "stock" && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-5">
          {/* BỘ LỌC ĐA CHIỀU PHÒNG NGỪA RỦI RO (MULTI-DIMENSIONAL RISK FILTERS) */}
          <div className="space-y-3 pb-2 border-b border-slate-100 dark:border-slate-800/80">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              {/* Search Bar */}
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Tìm theo mã hàng, tên sinh phẩm, số LOT, vị trí kệ..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs focus:outline-none focus:border-orange-500 font-medium"
                />
              </div>

              {/* Reset filter button if any active */}
              {(riskFilter !== "all" || tempFilter !== "all" || categoryFilter !== "all" || searchQuery) && (
                <button
                  onClick={() => {
                    setRiskFilter("all");
                    setTempFilter("all");
                    setCategoryFilter("all");
                    setSearchQuery("");
                  }}
                  className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-rose-600 transition-colors"
                >
                  <X className="w-3.5 h-3.5" /> Xóa bộ lọc rủi ro
                </button>
              )}
            </div>

            {/* Filter Buttons Rows */}
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
              {/* 1. Mức độ Rủi ro */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-bold text-slate-400 uppercase mr-1">Rủi ro:</span>
                <button
                  onClick={() => setRiskFilter("all")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    riskFilter === "all"
                      ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xs"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                  }`}
                >
                  Tất cả ({enrichedItems.length})
                </button>
                <button
                  onClick={() => setRiskFilter("near_exp")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                    riskFilter === "near_exp"
                      ? "bg-rose-600 text-white shadow-xs"
                      : "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 hover:bg-rose-100"
                  }`}
                >
                  <AlertOctagon className="w-3.5 h-3.5" />
                  <span>Cận Date &lt;90 ngày ({riskKPIs.nearExpCount})</span>
                </button>
                <button
                  onClick={() => setRiskFilter("low_stock")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                    riskFilter === "low_stock"
                      ? "bg-amber-600 text-white shadow-xs"
                      : "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 hover:bg-amber-100"
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Tồn dưới định mức ({riskKPIs.lowStockCount})</span>
                </button>
                <button
                  onClick={() => setRiskFilter("slow_moving")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                    riskFilter === "slow_moving"
                      ? "bg-purple-600 text-white shadow-xs"
                      : "bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 hover:bg-purple-100"
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Chậm luân chuyển ({riskKPIs.slowMovingCount})</span>
                </button>
                <button
                  onClick={() => setRiskFilter("safe")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                    riskFilter === "safe"
                      ? "bg-emerald-600 text-white shadow-xs"
                      : "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100"
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>An toàn</span>
                </button>
              </div>

              <div className="hidden lg:block w-px h-5 bg-slate-200 dark:bg-slate-700 mx-2" />

              {/* 2. Điều kiện bảo quản / Nhiệt độ Cold-Chain */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-bold text-slate-400 uppercase mr-1">Bảo quản:</span>
                <button
                  onClick={() => setTempFilter("all")}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                    tempFilter === "all"
                      ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                  }`}
                >
                  Tất cả kho
                </button>
                <button
                  onClick={() => setTempFilter("-20C")}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
                    tempFilter === "-20C"
                      ? "bg-blue-600 text-white"
                      : "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                  }`}
                >
                  <Snowflake className="w-3 h-3" /> Âm sâu -20°C
                </button>
                <button
                  onClick={() => setTempFilter("2-8C")}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
                    tempFilter === "2-8C"
                      ? "bg-cyan-600 text-white"
                      : "bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800"
                  }`}
                >
                  <ThermometerSnowflake className="w-3 h-3" /> Kho mát 2-8°C
                </button>
                <button
                  onClick={() => setTempFilter("room")}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                    tempFilter === "room"
                      ? "bg-slate-600 text-white"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                  }`}
                >
                  Nhiệt độ phòng (15-25°C)
                </button>
              </div>

              <div className="hidden lg:block w-px h-5 bg-slate-200 dark:bg-slate-700 mx-2" />

              {/* 3. Nhóm Hàng */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-bold text-slate-400 uppercase mr-1">Nhóm:</span>
                <select
                  value={categoryFilter}
                  onChange={(e: any) => setCategoryFilter(e.target.value)}
                  className="px-2.5 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-orange-500"
                >
                  <option value="all">Tất cả nhóm hàng</option>
                  <option value="diagnostic">Sinh phẩm chẩn đoán (Kit PCR)</option>
                  <option value="extraction">Hóa chất &amp; Kít tách chiết</option>
                  <option value="equipment">Thiết bị y tế máy móc</option>
                  <option value="consumable">Vật tư tiêu hao phòng Lab</option>
                </select>
              </div>
            </div>
          </div>
          {/* VIEW MODE SWITCHER & ATP INSIGHT BANNER (Requirement 7) */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 pb-1 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-500 uppercase">Chế độ hiển thị:</span>
              <button
                type="button"
                onClick={() => setIsAtpViewMode(false)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  !isAtpViewMode
                    ? "bg-orange-600 text-white shadow-xs"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Tiêu Chuẩn (FEFO &amp; Hạn Dùng)</span>
              </button>
              <button
                type="button"
                onClick={() => setIsAtpViewMode(true)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  isAtpViewMode
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/60"
                }`}
              >
                <BookmarkCheck className="w-3.5 h-3.5" />
                <span>Phân Tích Tồn ATP &amp; Cam Kết Giao Hàng (Req 7)</span>
              </button>
            </div>

            {isAtpViewMode && (
              <div className="text-[11px] text-indigo-700 dark:text-indigo-300 font-mono font-bold flex items-center gap-2 bg-indigo-50 dark:bg-indigo-950/60 px-3 py-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800/80">
                <Info className="w-3.5 h-3.5 text-indigo-500" />
                <span>ATP = Thực Tồn ({enrichedItems.reduce((s, i) => s + (Number(i.quantity_on_hand) || 0), 0)}) - Giữ Chỗ ({totalReservedQty}) + Sắp Về ({enrichedItems.reduce((s, i) => s + (Number(i.incoming_po_qty) || 0), 0)})</span>
              </div>
            )}
          </div>

          {/* MOBILE CARD VIEW FOR INVENTORY (Smart Handheld UX) */}
          <div className="block md:hidden space-y-3 p-2">
            {stockPage.items.map((item) => {
              const itemKey = String(item.id || `${item.product_code}-${item.lot_number || 'default'}`);
              const itemComponents: any[] = (item.components && Array.isArray(item.components) && item.components.length > 0)
                ? item.components
                : productComponents.filter((c) => c.parent_product_code === item.product_code).map((c, idx) => ({
                    component_code: c.component_code,
                    component_name: c.component_name,
                    specification: c.specification || 'Phụ kiện kèm theo bộ Kit',
                    unit: c.unit || 'Đơn vị',
                    quantity_per_kit: Number(c.quantity_per_kit) || 1,
                    total_quantity: (Number(c.quantity_per_kit) || 1) * Number(item.quantity_on_hand),
                    lot_number: item.lot_number ? `${item.lot_number}-C${idx + 1}` : `L-C${idx + 1}`,
                    expiry_date: item.expiry_date || '2028-12-31',
                    storage_condition: c.storage_condition,
                    shelf_position: c.storage_condition?.includes('2-8') ? 'Tủ Mát ABT (Kệ TM-02)' : c.storage_condition?.includes('-20') ? 'Tủ Lạnh Âm (Ngăn F-01)' : 'Kho Thường (Kệ K-01)'
                  }));

              return (
                <div
                  key={`mobile-${itemKey}`}
                  className={`bg-white dark:bg-slate-900 rounded-2xl border p-3.5 shadow-xs space-y-2.5 transition-all ${
                    item.isNearExpiry
                      ? "border-rose-300 dark:border-rose-800/80 bg-rose-50/20"
                      : item.isStockoutRisk
                      ? "border-amber-300 dark:border-amber-800/80 bg-amber-50/20"
                      : "border-slate-200 dark:border-slate-800"
                  }`}
                >
                  {/* Card Header: Product Code, KIT tag, Risk Badge */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono font-bold text-xs text-slate-900 dark:text-white">
                          {item.product_code}
                        </span>
                        {itemComponents.length > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-sans font-bold bg-purple-100 text-purple-700 dark:bg-purple-950/80 dark:text-purple-300">
                            KIT
                          </span>
                        )}
                        {item.manufacturer && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                            {item.manufacturer}
                          </span>
                        )}
                      </div>
                      <div className="font-bold text-xs text-slate-800 dark:text-slate-200 mt-1 line-clamp-2">
                        {item.product_name}
                      </div>
                    </div>

                    {/* Risk Badge */}
                    <div className="shrink-0">
                      {item.isNearExpiry ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300">
                          <AlertOctagon className="w-3 h-3 text-rose-600" /> Cận Date
                        </span>
                      ) : item.isStockoutRisk ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300">
                          <AlertTriangle className="w-3 h-3 text-amber-600" /> Tồn Thấp
                        </span>
                      ) : item.isSlowMoving ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-300">
                          <Clock className="w-3 h-3 text-purple-600" /> Chậm Xuất
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" /> An Toàn
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Stock Metrics Grid */}
                  <div className="grid grid-cols-3 gap-2 bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl text-center">
                    <div>
                      <div className="text-[10px] text-slate-400 font-medium">Thực Tồn</div>
                      <div className="text-sm font-extrabold text-slate-800 dark:text-slate-200">
                        {item.quantity_on_hand} <span className="text-[10px] font-normal text-slate-400">{item.unit || "hộp"}</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400 font-medium">Giữ Chỗ</div>
                      <div className="text-sm font-extrabold text-amber-600 dark:text-amber-400">
                        {item.quantity_reserved || 0}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400 font-medium">Khả Dụng (ATP)</div>
                      <div className={`text-sm font-extrabold ${item.quantity_available > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                        {item.quantity_available || 0}
                      </div>
                    </div>
                  </div>

                  {/* Lot, Expiry & Storage Info */}
                  <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800/60">
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400">Lô:</span>
                      <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{item.lot_number || "N/A"}</span>
                      {item.lot_count > 1 && (
                        <button type="button" onClick={() => openLotsOf(item.product_code)} className="px-1 rounded bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold text-[10px] cursor-pointer">
                          {item.lot_count} lô
                        </button>
                      )}
                      <span className="text-slate-300 dark:text-slate-600">|</span>
                      <span className="text-slate-400">EXP:</span>
                      <span className="font-bold text-slate-700 dark:text-slate-300">{item.expiry_date || "Dài hạn"}</span>
                    </div>
                    <div className="flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-300">
                      {item.temp_category === "-20C" ? (
                        <Snowflake className="w-3 h-3 text-blue-500" />
                      ) : item.temp_category === "2-8C" ? (
                        <ThermometerSnowflake className="w-3 h-3 text-cyan-500" />
                      ) : (
                        <MapPin className="w-3 h-3 text-slate-400" />
                      )}
                      <span>{item.warehouse_location || "Kho Trung Tâm"}</span>
                    </div>
                  </div>

                  {/* Mobile Quick Action Buttons */}
                  <div className="flex items-center gap-2 pt-1">
                    {item.quantity_available > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedReserveItem(item);
                          const initialRep = salesStaff[0] ? `${salesStaff[0].full_name} (${salesStaff[0].position})` : "";
                          setReserveFormData({
                            sales_rep_name: initialRep,
                            customer_name: "",
                            quantity_reserved: 1,
                            hold_until_date: toVNDateString(new Date(Date.now() + 7 * 86400000)),
                            notes: `Giữ chỗ lô ${item.lot_number} cho khách hàng chào thầu`
                          });
                          setIsReserveModalOpen(true);
                        }}
                        className="flex-1 py-2 px-3 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                      >
                        <BookmarkCheck className="w-3.5 h-3.5" />
                        <span>Giữ Chỗ</span>
                      </button>
                    )}

                    {(item.isStockoutRisk || isAtpViewMode) && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPRItem(item);
                          setPRFormData({
                            requestedQty: Math.max(30, (item.min_stock_level || 10) * 2),
                            urgentLevel: "CAO - Nguy cơ đứt gãy cung ứng viện",
                            notes: `Đề xuất phòng Cung Ứng lập PO mua gấp sản phẩm ${item.product_name} (${item.product_code}) để bù đắp tồn an toàn tối thiểu ${item.min_stock_level}.`
                          });
                          setIsPRModalOpen(true);
                        }}
                        className="flex-1 py-2 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                      >
                        <ShoppingCart className="w-3.5 h-3.5" />
                        <span>Tạo PR</span>
                      </button>
                    )}

                    {item.isNearExpiry && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPushItem(item);
                          setPushSalesFormData({
                            discountPercent: 20,
                            targetDept: "Phòng Kinh Doanh & Ứng Dụng Lâm Sàng",
                            priorityStrategy: "FEFO (First Expired, First Out) - Ưu tiên chào các gói test xét nghiệm",
                            notes: `Thông báo lô ${item.lot_number} của mặt hàng ${item.product_name} còn ${item.days_to_expiry} ngày hết hạn (EXP: ${item.expiry_date}). Đề xuất phòng Kinh Doanh ưu tiên xuất trước theo FEFO.`
                          });
                          setIsPushSalesModalOpen(true);
                        }}
                        className="py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                        title="Đẩy Bán FEFO"
                      >
                        <Megaphone className="w-3.5 h-3.5" />
                        <span>Đẩy Bán</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleOpenEditStockModal(item)}
                      className="py-2 px-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                      title="Chỉnh sửa Lô, Hạn dùng, Giá đầu kỳ, Nhiệt độ bảo quản & Vị trí kệ"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>✏️ Sửa</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSelectedBarcodeItem({
                          product_code: item.product_code,
                          product_name: item.product_name,
                          batch_lot: item.lot_number || "",
                          expiry_date: item.expiry_date || "",
                          storage_condition: item.storage_condition || "",
                          quantity: item.quantity_available || 1,
                          unit: item.unit || "Hộp"
                        });
                        setIsBarcodeModalOpen(true);
                      }}
                      className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 cursor-pointer"
                      title="In Barcode & QR"
                    >
                      <BarcodeIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
            <Pager p={stockPage} unit="dòng tồn kho" />
          </div>

          {/* TABLE OF INVENTORY ITEMS WITH RISK TOOLKIT & ACTIONS (Desktop View) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className={`${isAtpViewMode ? "bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200 border-indigo-200 dark:border-indigo-800/80" : "bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800"} font-bold border-b`}>
                <tr>
                  <th className="py-3 px-3">Mã &amp; Tên Hàng Hóa</th>
                  {isAtpViewMode && <th className="py-3 px-3">Hãng SX &amp; Nhóm</th>}
                  <th className="py-3 px-3 text-right">Thực Tồn</th>
                  <th className="py-3 px-3 text-right">Giữ Chỗ</th>
                  {isAtpViewMode ? (
                    <>
                      <th className="py-3 px-3 text-right">Hàng Sắp Về (PO)</th>
                      <th className="py-3 px-3 text-right">Khả Dụng (ATP)</th>
                      <th className="py-3 px-3 text-center">Cam Kết Giao Hàng</th>
                    </>
                  ) : (
                    <>
                      <th className="py-3 px-3 text-right">Khả Dụng</th>
                      <th className="py-3 px-3">Số LOT &amp; Hạn Dùng (EXP)</th>
                      <th className="py-3 px-3">Bảo Quản &amp; Vị Trí</th>
                      <th className="py-3 px-3 text-center">Tình Trạng Rủi Ro</th>
                    </>
                  )}
                  <th className="py-3 px-3 text-center">{isAtpViewMode ? "Thao Tác" : "Hành Động Phòng Ngừa"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                {stockPage.items.map((item) => {
                  const itemKey = String(item.id || `${item.product_code}-${item.lot_number || 'default'}`);
                  const isExpanded = !!expandedItemComponents[itemKey];
                  const itemComponents: any[] = (item.components && Array.isArray(item.components) && item.components.length > 0)
                    ? item.components
                    : productComponents.filter((c) => c.parent_product_code === item.product_code).map((c, idx) => ({
                        component_code: c.component_code,
                        component_name: c.component_name,
                        specification: c.specification || 'Phụ kiện kèm theo bộ Kit',
                        unit: c.unit || 'Đơn vị',
                        quantity_per_kit: Number(c.quantity_per_kit) || 1,
                        total_quantity: (Number(c.quantity_per_kit) || 1) * Number(item.quantity_on_hand),
                        lot_number: item.lot_number ? `${item.lot_number}-C${idx + 1}` : `L-C${idx + 1}`,
                        expiry_date: item.expiry_date || '2028-12-31',
                        storage_condition: c.storage_condition,
                        shelf_position: c.storage_condition?.includes('2-8') ? 'Tủ Mát ABT (Kệ TM-02)' : c.storage_condition?.includes('-20') ? 'Tủ Lạnh Âm (Ngăn F-01)' : 'Kho Thường (Kệ K-01)'
                      }));

                  return (
                    <React.Fragment key={itemKey}>
                    <tr
                      className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors ${
                        item.isNearExpiry
                          ? "bg-rose-50/30 dark:bg-rose-950/10"
                          : item.isStockoutRisk
                          ? "bg-amber-50/30 dark:bg-amber-950/10"
                          : ""
                      } ${isExpanded ? "bg-purple-50/20 dark:bg-purple-950/10 border-l-4 border-l-purple-500" : ""}`}
                    >
                      {/* Product Code & Name */}
                      <td className="py-3 px-3">
                        <div className="font-mono font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <span>{item.product_code}</span>
                          {itemComponents.length > 0 && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded font-sans font-bold bg-purple-100 text-purple-700 dark:bg-purple-950/80 dark:text-purple-300">
                              KIT
                            </span>
                          )}
                        </div>
                        <div className="font-bold text-slate-800 dark:text-slate-200 mt-0.5 leading-snug">
                          {item.product_name}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1.5 flex-wrap">
                          <span>{item.category || "Hàng thương mại"} • ĐVT: {item.unit || "Hộp"}</span>
                          {itemComponents.length > 0 && (
                            <div className="inline-flex items-center gap-1 ml-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedItemComponents(prev => ({
                                    ...prev,
                                    [itemKey]: !prev[itemKey]
                                  }));
                                }}
                                className={`px-2 py-0.5 rounded-full font-bold text-[9px] border flex items-center gap-1 cursor-pointer transition-all shadow-2xs ${
                                  isExpanded
                                    ? "bg-purple-600 text-white border-purple-700 shadow-xs"
                                    : "bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900 border-purple-300 dark:border-purple-800"
                                }`}
                                title="Nhấp để bung/thu gọn xem chi tiết danh sách phụ kiện, số Lô & hạn dùng từng thành phần kèm theo"
                              >
                                <span>🧩</span>
                                <span>Bộ/Kit ({itemComponents.length} phụ kiện)</span>
                                <span className="font-mono font-bold text-[8px]">{isExpanded ? "▲ Thu gọn" : "▼ Xem phụ kiện"}</span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedKitModalItem({ ...item, itemComponents });
                                }}
                                className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-purple-100 text-slate-600 hover:text-purple-700 text-[9px] border border-slate-200 dark:border-slate-700 cursor-pointer"
                                title="Mở bảng chi tiết phụ kiện & in tem phụ kiện"
                              >
                                🔍 Chi tiết
                              </button>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Manufacturer & Category (ATP mode) */}
                      {isAtpViewMode && (
                        <td className="py-3 px-3">
                          <div className="font-bold text-indigo-600 dark:text-indigo-400">
                            {item.manufacturer || "ABT"}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {item.category || "Sinh phẩm"}
                          </div>
                        </td>
                      )}

                      {/* Stock on Hand */}
                      <td className="py-3 px-3 text-right font-mono font-black text-sm text-slate-900 dark:text-white">
                        {item.quantity_on_hand}
                      </td>

                      {/* Reserved / Allocated */}
                      <td className="py-3 px-3 text-right font-mono text-slate-500">
                        {item.quantity_allocated || 0}
                      </td>

                      {isAtpViewMode ? (
                        <>
                          {/* Incoming PO Qty (Requirement 7) */}
                          <td className="py-3 px-3 text-right font-mono">
                            {(item.incoming_po_qty || 0) > 0 ? (
                              <div>
                                <span className="font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/80">
                                  +{item.incoming_po_qty}
                                </span>
                                {item.incoming_pos && item.incoming_pos.length > 0 && (
                                  <div className="text-[9px] text-slate-500 mt-0.5 font-sans truncate max-w-[130px] ml-auto" title={item.incoming_pos.map((p: any) => `${p.po_code} (${p.supplier_name || 'NCC'}): +${p.quantity} (Hẹn giao: ${p.expected_delivery_date || 'Chờ xác nhận'})`).join('\n')}>
                                    PO: {item.incoming_pos[0]?.po_code} ({item.incoming_pos[0]?.expected_delivery_date || "Sắp về"})
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>

                          {/* ATP Quantity */}
                          <td className="py-3 px-3 text-right font-mono font-black text-sm">
                            <span className={item.atp_qty > 0 ? "text-emerald-600 dark:text-emerald-400 bg-emerald-100/70 dark:bg-emerald-950/80 px-2.5 py-1 rounded-lg border border-emerald-300 dark:border-emerald-800" : "text-rose-600 dark:text-rose-400 bg-rose-100/70 dark:bg-rose-950/80 px-2.5 py-1 rounded-lg border border-rose-300 dark:border-rose-800"}>
                              {item.atp_qty}
                            </span>
                          </td>

                          {/* Promise Status Badge */}
                          <td className="py-3 px-3 text-center">
                            {item.atp_promise_status === "READY" ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 shadow-xs">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" /> SẴN SÀNG GIAO
                              </span>
                            ) : item.atp_promise_status === "CONDITIONAL_PO" ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300 dark:border-amber-800 shadow-xs">
                                <Clock className="w-3 h-3 text-amber-600" /> CHỜ PO VỀ
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-300 dark:border-rose-800 shadow-xs">
                                <AlertOctagon className="w-3 h-3 text-rose-600" /> HẾT HÀNG
                              </span>
                            )}
                          </td>
                        </>
                      ) : (
                        <>
                          {/* Available */}
                          <td className="py-3 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                            {item.quantity_available}
                          </td>

                          {/* Lot & Expiry Date (FEFO) */}
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-1.5 font-mono font-bold text-slate-800 dark:text-slate-200">
                              <span>{item.lot_number}</span>
                              {item.lot_count > 1 && (
                                <button
                                  type="button"
                                  onClick={() => openLotsOf(item.product_code)}
                                  title={`Mã này có ${item.lot_count} lô — đang hiện lô hết hạn sớm nhất. Bấm để xem tất cả lô.`}
                                  className="font-sans px-1.5 py-0.5 rounded bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-950/60 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 text-[10px] cursor-pointer"
                                >
                                  {item.lot_count} lô
                                </button>
                              )}
                            </div>
                            {item.lot_mismatch && (
                              <div className="mt-0.5 text-[10px] font-sans font-bold text-rose-600 dark:text-rose-400" title="Tồn của mã khác tổng tồn các lô: kiểm tra lại phiếu nhập / xuất">
                                ⚠ Lệch: mã {item.lot_mismatch.product_qty} ≠ tổng lô {item.lot_mismatch.lots_qty}
                              </div>
                            )}
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="font-mono text-slate-600 dark:text-slate-300">{item.expiry_date}</span>
                              {Number.isFinite(item.days_to_expiry) && item.days_to_expiry < 900 ? (
                                item.days_to_expiry <= 60 ? (
                                  <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 font-bold text-[10px]">
                                    Còn {item.days_to_expiry} ngày
                                  </span>
                                ) : item.days_to_expiry <= 90 ? (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 font-bold text-[10px]">
                                    Còn {item.days_to_expiry} ngày
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-slate-400">
                                    (Còn {item.days_to_expiry} ngày)
                                  </span>
                                )
                              ) : (
                                <span className="text-[10px] text-slate-400 italic">
                                  (Dài hạn)
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-teal-600 dark:text-teal-400 font-mono mt-0.5">
                              Đơn giá: {Number(item.cost_price) > 0 ? formatCurrency(Number(item.cost_price)) : "Chưa cập nhật"}
                            </div>
                          </td>

                          {/* Storage Condition & Location */}
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-1 text-slate-700 dark:text-slate-300 font-semibold">
                              {item.temp_category === "-20C" ? (
                                <Snowflake className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                              ) : item.temp_category === "2-8C" ? (
                                <ThermometerSnowflake className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                              ) : (
                                <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              )}
                              {item.storage_temp ? <span>{item.storage_temp}</span> : <span className="text-amber-600 dark:text-amber-400">⚠ Chưa khai báo nhiệt độ</span>}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5 flex-wrap">
                              <span>{item.warehouse_location || "Kho Trung Tâm"}</span>
                              {item.shelf_position && (
                                <span className={`font-mono text-[10px] px-1.5 py-0.2 rounded ${
                                  item.shelf_position === "Chưa phân bổ kệ"
                                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 font-semibold"
                                    : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                                }`}>
                                  {item.shelf_position}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => handleOpenEditStockModal(item)}
                                className="text-[10px] font-bold text-teal-600 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300 underline cursor-pointer ml-0.5"
                                title="Chỉnh sửa nhanh nhiệt độ bảo quản, vị trí kệ, số lô & giá đầu kỳ"
                              >
                                ✏️ Sửa
                              </button>
                            </div>
                          </td>

                          {/* Risk Badges */}
                          <td className="py-3 px-3 text-center">
                            {item.isNearExpiry ? (
                              <div className="inline-flex flex-col items-center gap-0.5">
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                                  <AlertOctagon className="w-3 h-3 text-rose-600" /> CẬN DATE ({item.days_to_expiry}d)
                                </span>
                                <span className="text-[9px] text-rose-600 font-bold uppercase tracking-wider">
                                  RỦI RO HỦY HÀNG
                                </span>
                              </div>
                            ) : item.isStockoutRisk ? (
                              <div className="inline-flex flex-col items-center gap-0.5">
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                                  <AlertTriangle className="w-3 h-3 text-amber-600" /> TỒN THẤP (Min: {item.min_stock_level || 10})
                                </span>
                                <span className="text-[9px] text-amber-600 font-bold uppercase tracking-wider">
                                  RỦI RO ĐỨT HÀNG
                                </span>
                              </div>
                            ) : item.isSlowMoving ? (
                              <div className="inline-flex flex-col items-center gap-0.5">
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-300 dark:border-purple-800">
                                  <Clock className="w-3 h-3 text-purple-600" /> CHẬM LUÂN CHUYỂN
                                </span>
                                <span className="text-[9px] text-purple-600 font-semibold">
                                  &gt;{item.days_inactive} ngày chưa xuất
                                </span>
                              </div>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" /> AN TOÀN
                              </span>
                            )}
                          </td>
                        </>
                      )}

                      {/* RISK MITIGATION ACTIONS */}
                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                          {/* Button 1: Tạo PR mua hàng khi thiếu tồn hoặc trong ATP mode */}
                          {(item.isStockoutRisk || isAtpViewMode) && (
                            <div className="relative group inline-flex">
                              <button
                                onClick={() => {
                                  setSelectedPRItem(item);
                                  setPRFormData({
                                    requestedQty: Math.max(30, (item.min_stock_level || 10) * 2),
                                    urgentLevel: "CAO - Nguy cơ đứt gãy cung ứng viện",
                                    notes: `Đề xuất phòng Cung Ứng lập PO mua gấp sản phẩm ${item.product_name} (${item.product_code}) để bù đắp tồn an toàn tối thiểu ${item.min_stock_level}.`
                                  });
                                  setIsPRModalOpen(true);
                                }}
                                className="w-8 h-8 rounded-lg flex items-center justify-center bg-amber-500 hover:bg-amber-600 active:scale-95 text-white shadow-xs transition-all duration-150 hover:scale-110 cursor-pointer"
                                aria-label="Tạo Yêu Cầu Mua Hàng (PR)"
                              >
                                <ShoppingCart className="w-4 h-4" />
                              </button>
                              {/* Hover Tooltip */}
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 transform group-hover:-translate-y-0.5 z-50">
                                <div className="bg-slate-900/95 dark:bg-slate-800/95 text-white text-left px-2.5 py-1.5 rounded-lg shadow-xl border border-slate-700/80 backdrop-blur-xs whitespace-nowrap min-w-[130px]">
                                  <div className="flex items-center gap-1.5 font-bold text-[11px] text-amber-300">
                                    <ShoppingCart className="w-3.5 h-3.5 text-amber-400" />
                                    <span>Mua Hàng (PR)</span>
                                  </div>
                                  <div className="text-[10px] text-slate-300 font-normal leading-tight mt-0.5">
                                    Lập yêu cầu mua hàng bù tồn an toàn
                                  </div>
                                </div>
                                <div className="w-2 h-2 bg-slate-900/95 dark:bg-slate-800/95 rotate-45 mx-auto -mt-1 border-r border-b border-slate-700/80" />
                              </div>
                            </div>
                          )}

                          {/* Button 2: Đề xuất đẩy bán FEFO khi cận hạn */}
                          {item.isNearExpiry && (
                            <div className="relative group inline-flex">
                              <button
                                onClick={() => {
                                  setSelectedPushItem(item);
                                  setPushSalesFormData({
                                    discountPercent: 20,
                                    targetDept: "Phòng Kinh Doanh & Ứng Dụng Lâm Sàng",
                                    priorityStrategy: "FEFO (First Expired, First Out) - Ưu tiên chào các gói test xét nghiệm",
                                    notes: `Thông báo lô ${item.lot_number} của mặt hàng ${item.product_name} còn ${item.days_to_expiry} ngày hết hạn (EXP: ${item.expiry_date}). Đề xuất phòng Kinh Doanh ưu tiên xuất trước theo FEFO.`
                                  });
                                  setIsPushSalesModalOpen(true);
                                }}
                                className="w-8 h-8 rounded-lg flex items-center justify-center bg-rose-600 hover:bg-rose-700 active:scale-95 text-white shadow-xs transition-all duration-150 hover:scale-110 cursor-pointer"
                                aria-label="Đẩy Bán (Sales) - FEFO"
                              >
                                <Megaphone className="w-4 h-4" />
                              </button>
                              {/* Hover Tooltip */}
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 transform group-hover:-translate-y-0.5 z-50">
                                <div className="bg-slate-900/95 dark:bg-slate-800/95 text-white text-left px-2.5 py-1.5 rounded-lg shadow-xl border border-slate-700/80 backdrop-blur-xs whitespace-nowrap min-w-[130px]">
                                  <div className="flex items-center gap-1.5 font-bold text-[11px] text-rose-300">
                                    <Megaphone className="w-3.5 h-3.5 text-rose-400" />
                                    <span>Đẩy Bán (Sales)</span>
                                  </div>
                                  <div className="text-[10px] text-slate-300 font-normal leading-tight mt-0.5">
                                    Đề xuất Sales ưu tiên xuất FEFO cận date
                                  </div>
                                </div>
                                <div className="w-2 h-2 bg-slate-900/95 dark:bg-slate-800/95 rotate-45 mx-auto -mt-1 border-r border-b border-slate-700/80" />
                              </div>
                            </div>
                          )}

                          {/* Button 3: Giữ Chỗ Cho Sales Trực Tiếp Theo Lô */}
                          {item.quantity_available > 0 && (
                            <div className="relative group inline-flex">
                              <button
                                onClick={() => {
                                  setSelectedReserveItem(item);
                                  const initialRep = salesStaff[0] ? `${salesStaff[0].full_name} (${salesStaff[0].position})` : "";
                                  setReserveFormData({
                                    sales_rep_name: initialRep,
                                    customer_name: "",
                                    quantity_reserved: 1,
                                    hold_until_date: toVNDateString(new Date(Date.now() + 7 * 86400000)),
                                    notes: `Giữ chỗ lô ${item.lot_number} cho khách hàng chào thầu`
                                  });
                                  setIsReserveModalOpen(true);
                                }}
                                className="w-8 h-8 rounded-lg flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white shadow-xs transition-all duration-150 hover:scale-110 cursor-pointer"
                                aria-label="Giữ Chỗ Sales"
                              >
                                <BookmarkCheck className="w-4 h-4" />
                              </button>
                              {/* Hover Tooltip */}
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 transform group-hover:-translate-y-0.5 z-50">
                                <div className="bg-slate-900/95 dark:bg-slate-800/95 text-white text-left px-2.5 py-1.5 rounded-lg shadow-xl border border-slate-700/80 backdrop-blur-xs whitespace-nowrap min-w-[130px]">
                                  <div className="flex items-center gap-1.5 font-bold text-[11px] text-orange-300">
                                    <BookmarkCheck className="w-3.5 h-3.5 text-orange-400" />
                                    <span>Giữ Chỗ Sales</span>
                                  </div>
                                  <div className="text-[10px] text-slate-300 font-normal leading-tight mt-0.5">
                                    Khóa giữ tồn kho lô này cho Sales
                                  </div>
                                </div>
                                <div className="w-2 h-2 bg-slate-900/95 dark:bg-slate-800/95 rotate-45 mx-auto -mt-1 border-r border-b border-slate-700/80" />
                              </div>
                            </div>
                          )}

                          {/* Button 0: Chỉnh sửa Lô, Hạn dùng, Giá đầu kỳ, Nhiệt độ bảo quản & Vị trí kệ */}
                          <div className="relative group inline-flex">
                            <button
                              type="button"
                              onClick={() => handleOpenEditStockModal(item)}
                              className="h-8 px-2.5 rounded-lg flex items-center justify-center gap-1 bg-teal-600 hover:bg-teal-700 active:scale-95 text-white font-bold text-[11px] shadow-xs transition-all duration-150 hover:scale-105 cursor-pointer"
                              aria-label="Chỉnh sửa lô & bảo quản"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>Sửa</span>
                            </button>
                            {/* Hover Tooltip */}
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 transform group-hover:-translate-y-0.5 z-50">
                              <div className="bg-slate-900/95 dark:bg-slate-800/95 text-white text-left px-2.5 py-1.5 rounded-lg shadow-xl border border-slate-700/80 backdrop-blur-xs whitespace-nowrap min-w-[165px]">
                                <div className="flex items-center gap-1.5 font-bold text-[11px] text-teal-300">
                                  <Edit3 className="w-3.5 h-3.5 text-teal-400" />
                                  <span>Chỉnh sửa lô &amp; bảo quản</span>
                                </div>
                                <div className="text-[10px] text-slate-300 font-normal leading-tight mt-0.5">
                                  Sửa Lô, HSD, Giá đầu kỳ, Nhiệt độ &amp; Vị trí kệ
                                </div>
                              </div>
                              <div className="w-2 h-2 bg-slate-900/95 dark:bg-slate-800/95 rotate-45 mx-auto -mt-1 border-r border-b border-slate-700/80" />
                            </div>
                          </div>

                          {/* Button 4: In Tem Mã Vạch & QR Code Sản Phẩm */}
                          <div className="relative group inline-flex">
                            <button
                              onClick={() => {
                                setSelectedBarcodeItem({
                                  product_code: item.product_code,
                                  product_name: item.product_name,
                                  batch_lot: item.lot_number || "",
                                  expiry_date: item.expiry_date || "",
                                  storage_condition: item.storage_condition || "",
                                  quantity: item.quantity_available || 1,
                                  unit: item.unit || "Hộp"
                                });
                                setIsBarcodeModalOpen(true);
                              }}
                              className="w-8 h-8 rounded-lg flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white shadow-xs transition-all duration-150 hover:scale-110 cursor-pointer"
                              aria-label="In Tem Mã Vạch & QR Code"
                            >
                              <BarcodeIcon className="w-4 h-4" />
                            </button>
                            {/* Hover Tooltip */}
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 transform group-hover:-translate-y-0.5 z-50">
                              <div className="bg-slate-900/95 dark:bg-slate-800/95 text-white text-left px-2.5 py-1.5 rounded-lg shadow-xl border border-slate-700/80 backdrop-blur-xs whitespace-nowrap min-w-[140px]">
                                <div className="flex items-center gap-1.5 font-bold text-[11px] text-indigo-300">
                                  <BarcodeIcon className="w-3.5 h-3.5 text-indigo-400" />
                                  <span>In Tem Mã Vạch &amp; QR</span>
                                </div>
                                <div className="text-[10px] text-slate-300 font-normal leading-tight mt-0.5">
                                  In tem nhãn Code 128 / QR dán hộp
                                </div>
                              </div>
                              <div className="w-2 h-2 bg-slate-900/95 dark:bg-slate-800/95 rotate-45 mx-auto -mt-1 border-r border-b border-slate-700/80" />
                            </div>
                          </div>

                          {/* If neither and no stock available */}
                          {!item.isStockoutRisk && !item.isNearExpiry && item.quantity_available <= 0 && (
                            <span className="text-[11px] text-slate-400 font-mono italic">
                              Hết tồn khả dụng
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* INLINE COMPONENT ACCORDION BREAKDOWN */}
                    {isExpanded && itemComponents.length > 0 && (
                      <tr className="bg-gradient-to-r from-purple-50/60 via-indigo-50/40 to-transparent dark:from-purple-950/30 dark:via-indigo-950/20 border-b-2 border-purple-200 dark:border-purple-800/80">
                        <td colSpan={isAtpViewMode ? 8 : 7} className="py-3 px-4 pl-8">
                          <div className="bg-white dark:bg-slate-900 rounded-xl border border-purple-200 dark:border-purple-800/60 p-4 shadow-sm space-y-3">
                            <div className="flex items-center justify-between pb-2.5 border-b border-slate-100 dark:border-slate-800">
                              <div className="flex items-center gap-2">
                                <span className="p-1 rounded-md bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 text-xs font-bold flex items-center gap-1.5 shadow-2xs">
                                  <span>🧩</span>
                                  <span>Chi Tiết Phụ Kiện Kèm Theo Bộ Kit (Lô: <strong className="font-mono text-purple-950 dark:text-purple-200">{item.lot_number || "Tiêu Chuẩn"}</strong>)</span>
                                </span>
                                <span className="text-xs text-slate-500 font-normal hidden sm:inline">
                                  — Quản lý chi tiết từng thành phần phụ, hạn dùng, nhiệt độ bảo quản và tồn thực tế
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setSelectedKitModalItem({ ...item, itemComponents })}
                                  className="text-xs font-bold text-purple-700 hover:text-purple-900 dark:text-purple-300 dark:hover:text-purple-100 bg-purple-50 dark:bg-purple-950/80 hover:bg-purple-100 px-2.5 py-1 rounded-lg border border-purple-200 dark:border-purple-800 flex items-center gap-1 cursor-pointer transition-all"
                                >
                                  <span>🔎 Xem bảng chi tiết & In nhãn</span>
                                  <span>↗</span>
                                </button>
                              </div>
                            </div>

                            <div className="overflow-x-auto">
                              <table className="w-full text-left text-xs">
                                <thead>
                                  <tr className="bg-purple-50/70 dark:bg-purple-950/40 text-purple-900 dark:text-purple-200 font-bold border-b border-purple-200 dark:border-purple-800/60 text-[11px]">
                                    <th className="py-2 px-2.5">Mã Phụ Kiện</th>
                                    <th className="py-2 px-2.5">Tên Phụ Kiện / Thành Phần</th>
                                    <th className="py-2 px-2.5">Quy Cách &amp; ĐVT</th>
                                    <th className="py-2 px-2.5 text-center">Định Mức / Kit</th>
                                    <th className="py-2 px-2.5 text-right font-bold text-purple-700 dark:text-purple-300">Tổng Thực Tồn</th>
                                    <th className="py-2 px-2.5">Số LOT Phụ Kiện</th>
                                    <th className="py-2 px-2.5">Hạn Dùng (EXP)</th>
                                    <th className="py-2 px-2.5">ĐK Bảo Quản Riêng</th>
                                    <th className="py-2 px-2.5">Vị Trí Lưu Kho</th>
                                    <th className="py-2 px-2.5 text-center">Thao Tác</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-normal">
                                  {itemComponents.map((comp: any, idx: number) => {
                                    const compQtyOnHand = Number(comp.quantity_per_kit || 1) * Number(item.quantity_on_hand || 0);
                                    const isDiffTemp = comp.storage_condition && item.storage_condition && comp.storage_condition !== item.storage_condition;
                                    return (
                                      <tr key={idx} className="hover:bg-purple-50/30 dark:hover:bg-purple-950/20 transition-colors">
                                        <td className="py-2 px-2.5 font-mono font-bold text-purple-700 dark:text-purple-300">
                                          {comp.component_code}
                                        </td>
                                        <td className="py-2 px-2.5 font-medium text-slate-900 dark:text-white">
                                          <div className="font-semibold">{comp.component_name}</div>
                                          {comp.notes && (
                                            <div className="text-[10px] text-slate-400 mt-0.5">{comp.notes}</div>
                                          )}
                                        </td>
                                        <td className="py-2 px-2.5 text-slate-600 dark:text-slate-400">
                                          <span>{comp.specification || "Tiêu chuẩn"}</span>
                                          <span className="text-[10px] text-slate-400 block">ĐVT: {comp.unit || "Ống/Lọ"}</span>
                                        </td>
                                        <td className="py-2 px-2.5 text-center font-mono font-bold text-slate-700 dark:text-slate-300">
                                          {comp.quantity_per_kit} {comp.unit || ""}
                                        </td>
                                        <td className="py-2 px-2.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                          {comp.total_quantity !== undefined ? comp.total_quantity : compQtyOnHand} {comp.unit || ""}
                                        </td>
                                        <td className="py-2 px-2.5 font-mono">
                                          <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                                            {comp.lot_number || item.lot_number || "LOT-THEO-KIT"}
                                          </span>
                                        </td>
                                        <td className="py-2 px-2.5 font-mono text-slate-700 dark:text-slate-300 text-[11px]">
                                          {comp.expiry_date || item.expiry_date || "—"}
                                        </td>
                                        <td className="py-2 px-2.5">
                                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                            comp.storage_condition?.includes("-20")
                                              ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                                              : comp.storage_condition?.includes("2-8")
                                              ? "bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800"
                                              : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                                          }`}>
                                            {comp.storage_condition?.includes("-20") ? "❄️" : comp.storage_condition?.includes("2-8") ? "🧊" : "📦"} {comp.storage_condition || item.storage_condition}
                                          </span>
                                          {isDiffTemp && (
                                            <span className="block text-[9px] text-amber-600 dark:text-amber-400 font-bold mt-0.5">
                                              ⚠️ Khác nhiệt độ Kit chính!
                                            </span>
                                          )}
                                        </td>
                                        <td className="py-2 px-2.5 text-slate-600 dark:text-slate-400 text-[11px]">
                                          📍 {comp.shelf_position || item.shelf_position || "Kho Trung Tâm"}
                                        </td>
                                        <td className="py-2 px-2.5 text-center">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setSelectedBarcodeItem({
                                                product_code: comp.component_code,
                                                product_name: `${comp.component_name} (Kit: ${item.product_code})`,
                                                batch_lot: comp.lot_number || item.lot_number,
                                                expiry_date: comp.expiry_date || item.expiry_date,
                                                storage_condition: comp.storage_condition || item.storage_condition,
                                                quantity: comp.total_quantity !== undefined ? comp.total_quantity : compQtyOnHand,
                                                unit: comp.unit || "Cái"
                                              });
                                              setIsBarcodeModalOpen(true);
                                            }}
                                            className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 transition-all cursor-pointer"
                                            title="In tem mã vạch riêng cho phụ kiện này"
                                          >
                                            In Tem
                                          </button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            <Pager p={stockPage} unit="dòng tồn kho" />
          </div>
        </div>
      )}

      {/* TAB 2: TRANSACTIONS HISTORY (THẺ KHO) */}
      {subTab === "transactions" && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">
              Sổ Lịch Sử Xuất Nhập Kho (Thẻ Kho Điện Tử)
            </h3>
            <span className="text-xs font-mono text-slate-500 font-bold">{transactions.length} chứng từ đã lưu</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-4">Mã Phiếu</th>
                  <th className="py-3 px-4">Loại Giao Dịch</th>
                  <th className="py-3 px-4">Mã Tham Chiếu / PO / SO</th>
                  <th className="py-3 px-4">Kho Lưu Trữ</th>
                  <th className="py-3 px-4">Chi Tiết Hàng Hóa</th>
                  <th className="py-3 px-4">Người Thực Hiện</th>
                  <th className="py-3 px-4">Ngày Giao Dịch</th>
                  <th className="py-3 px-4 text-right">Thao Tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                {transactionsPage.items.map((tx) => {
                  const isInbound = tx.transaction_type === "INBOUND";
                  const itemsList = Array.isArray(tx.items) ? tx.items : [];
                  return (
                    <tr key={tx.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900 dark:text-white">
                        <button
                          onClick={() => {
                            setSelectedTxDetail(tx);
                            setIsTxDetailModalOpen(true);
                          }}
                          className="hover:underline text-emerald-600 dark:text-emerald-400 font-mono"
                          title="Xem chi tiết phiếu"
                        >
                          {tx.transaction_code}
                        </button>
                      </td>
                      <td className="py-3.5 px-4">
                        {isInbound ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                            <ArrowDownLeft className="w-3 h-3" /> NHẬP KHO
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300">
                            <ArrowUpRight className="w-3 h-3" /> XUẤT KHO
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-semibold text-slate-700 dark:text-slate-300">
                        {tx.reference_code || "—"}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 dark:text-slate-400">
                        {tx.warehouse_name || "Kho Trung Tâm"}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="space-y-1">
                          {itemsList.slice(0, 5).map((it: any, idx: number) => (
                            <div key={idx} className="text-[11px] text-slate-800 dark:text-slate-200">
                              • <strong>{it.product_code || it.productCode}</strong>: {it.product_name || it.name} (SL: <strong>{it.quantity}</strong> {it.unit || ""})
                              {it.lot_number && <span className="ml-1 text-slate-500 font-mono text-[10px]">[Lô: {it.lot_number}]</span>}
                              {it.expiry_date && <span className="ml-1 text-emerald-600 font-mono text-[10px]">[EXP: {it.expiry_date}]</span>}
                            </div>
                          ))}
                          {itemsList.length > 5 && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedTxDetail(tx);
                                setIsTxDetailModalOpen(true);
                              }}
                              className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline pt-0.5 cursor-pointer"
                            >
                              + và {itemsList.length - 5} mặt hàng khác (Bấm Chi Tiết để xem đầy đủ)
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300">
                        {tx.performed_by || "Thủ kho ABT"}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-500">
                        {tx.date ? formatDayVN(tx.date) : ""}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => {
                            setSelectedTxDetail(tx);
                            setIsTxDetailModalOpen(true);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 hover:text-emerald-600 dark:hover:text-emerald-400 border border-slate-200 dark:border-slate-700 transition-colors"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Chi Tiết</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pager p={transactionsPage} unit="chứng từ xuất nhập kho" />
          </div>
        </div>
      )}

      {/* TAB 3: QUẢN LÝ GIỮ CHỖ TỒN KHO CHO SALES (RESERVATIONS & ATP) */}
      {subTab === "reservations" && (
        <div className="space-y-5">
          {/* Top KPI Metric Cards for Reservations */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Tổng SP Đang Giữ Chỗ
              </span>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-black text-indigo-600 dark:text-indigo-400 font-mono">
                  {totalReservedQty}
                </span>
                <span className="text-xs text-slate-500 font-medium">sản phẩm</span>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">Đã trừ khỏi tồn khả dụng (ATP) kho</p>
            </div>

            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Số Phiếu Đang Giữ Chỗ
              </span>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
                  {activeReservations.length}
                </span>
                <span className="text-xs text-slate-500 font-medium">lượt giữ</span>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">Hiệu lực bảo vệ đơn hàng Sales</p>
            </div>

            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                NVKD Đang Giữ Hàng
              </span>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
                  {distinctSalesReps.length}
                </span>
                <span className="text-xs text-slate-500 font-medium">nhân viên</span>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">Phụ trách chào thầu / giữ mẫu</p>
            </div>

            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-[11px] font-bold text-rose-500 uppercase tracking-wider block mb-1">
                Cảnh Báo Quá Hạn TTL
              </span>
              <div className="flex items-baseline justify-between">
                <span className={`text-2xl font-black font-mono ${overdueCount > 0 ? "text-rose-600 animate-pulse" : "text-slate-400"}`}>
                  {overdueCount}
                </span>
                <span className="text-xs text-rose-500 font-medium">cần thu hồi</span>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">Quá hạn cam kết chốt đơn</p>
            </div>
          </div>

          {/* Sales Breakdown Filter Strip */}
          <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <UserCheck className="w-4 h-4 text-indigo-500" />
                Lọc Giữ Chỗ Theo Từng Nhân Viên Kinh Doanh:
              </span>
              {selectedRepFilter !== "all" && (
                <button
                  onClick={() => setSelectedRepFilter("all")}
                  className="text-xs text-indigo-600 hover:underline font-bold"
                >
                  Xem tất cả NVKD
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setSelectedRepFilter("all")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  selectedRepFilter === "all"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                Tất cả ({activeReservations.length} lượt - {totalReservedQty} SP)
              </button>
              {distinctSalesReps.map((sr) => (
                <button
                  key={sr.rep}
                  onClick={() => setSelectedRepFilter(sr.rep)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                    selectedRepFilter === sr.rep
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/80 hover:bg-indigo-100"
                  }`}
                >
                  <User className="w-3.5 h-3.5" />
                  <span>{sr.rep}</span>
                  <span className="px-1.5 py-0.2 rounded-full bg-white/20 dark:bg-indigo-900 text-[10px] font-mono">
                    {sr.qty} SP ({sr.count} đơn)
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Table of Reservations */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                  <BookmarkCheck className="w-4 h-4 text-indigo-600" />
                  <span>Danh Sách Chi Tiết Giữ Chỗ Tồn Kho Theo Lô (Reservations &amp; ATP)</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Thủ kho có quyền theo dõi hạn giữ (Hold Until TTL) và giải phóng lại tồn khả dụng nếu Sales giữ quá hạn
                </p>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => setSubTab("stock")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-all cursor-pointer"
                  title="Chuyển sang Bảng Tồn Kho để chọn Lô hàng cụ thể và bấm Giữ Chỗ Sales"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Cài Đặt Giữ Chỗ Theo Lô</span>
                </button>
                <span className="text-xs font-mono text-slate-500 font-bold">
                  {filteredReservations.length} phiếu hiển thị
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-3">Mã Giữ / Đơn</th>
                    <th className="py-3 px-3">Nhân Viên Sales</th>
                    <th className="py-3 px-3">Khách Hàng Mục Tiêu</th>
                    <th className="py-3 px-3">Mã &amp; Tên Sản Phẩm</th>
                    <th className="py-3 px-3">Số Lô (LOT) &amp; Hạn Dùng</th>
                    <th className="py-3 px-3 text-right">SL Giữ</th>
                    <th className="py-3 px-3">Thời Gian Giữ &amp; Hạn TTL</th>
                    <th className="py-3 px-3 text-center">Trạng Thái</th>
                    <th className="py-3 px-3 text-center">Thao Tác Thủ Kho</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                  {filteredReservations.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-400 italic">
                        Hiện không có phiếu giữ chỗ nào phù hợp tiêu chí lọc.
                      </td>
                    </tr>
                  ) : (
                    reservationsPage.items.map((r) => {
                      const today = todayVN();
                      const isOverdue = r.status === "ACTIVE" && r.hold_until_date && r.hold_until_date.slice(0, 10) < today;
                      let daysRemaining = 0;
                      if (r.hold_until_date) {
                        const target = new Date(r.hold_until_date).getTime();
                        const now = new Date().getTime();
                        daysRemaining = Math.ceil((target - now) / 86400000);
                      }

                      return (
                        <tr
                          key={r.id}
                          className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors ${
                            isOverdue ? "bg-rose-50/30 dark:bg-rose-950/20" : ""
                          }`}
                        >
                          <td className="py-3 px-3 font-mono font-bold text-slate-900 dark:text-white">
                            {r.order_code || `RES-#${r.id}`}
                          </td>
                          <td className="py-3 px-3 font-bold text-indigo-600 dark:text-indigo-400">
                            {r.sales_rep_name || "Chưa xác định"}
                          </td>
                          <td className="py-3 px-3 text-slate-800 dark:text-slate-200">
                            <span className="font-semibold">{r.customer_name || "Khách hàng dự kiến"}</span>
                            {r.notes && (
                              <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-1 italic">
                                {r.notes}
                              </p>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-mono font-bold text-slate-900 dark:text-white">
                              {r.product_code}
                            </div>
                            <div className="text-[11px] text-slate-600 dark:text-slate-300">
                              {r.product_name}
                            </div>
                          </td>
                          <td className="py-3 px-3 font-mono">
                            <span className="font-bold text-orange-600 dark:text-orange-400">
                              {r.lot_number || "Lô mặc định kho"}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right">
                            <span className="inline-block px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-mono font-black text-sm">
                              {r.quantity_reserved}
                            </span>
                          </td>
                          <td className="py-3 px-3">
                            <div className="text-[11px] text-slate-500">
                              Từ: {r.reserved_at ? formatDayVN(r.reserved_at) : "N/A"}
                            </div>
                            <div className="font-mono font-bold text-slate-700 dark:text-slate-300 mt-0.5">
                              Đến: {r.hold_until_date ? formatDayVN(r.hold_until_date) : "Vô thời hạn"}
                            </div>
                            {r.status === "ACTIVE" && (
                              <div className="mt-1">
                                {isOverdue ? (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 animate-pulse">
                                    Quá hạn {Math.abs(daysRemaining)} ngày
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                                    Còn {daysRemaining} ngày giữ
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 text-center">
                            {r.status === "ACTIVE" ? (
                              isOverdue ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                                  <AlertOctagon className="w-3 h-3" /> QUÁ HẠN TTL
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                  <BookmarkCheck className="w-3 h-3" /> ĐANG GIỮ CHỖ
                                </span>
                              )
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                <Check className="w-3 h-3" /> ĐÃ GIẢI PHÓNG
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-center">
                            {r.status === "ACTIVE" ? (
                              <button
                                onClick={() => handleReleaseReservation(r)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 hover:bg-rose-50 dark:bg-slate-800 dark:hover:bg-rose-950/60 text-slate-700 hover:text-rose-600 dark:text-slate-300 dark:hover:text-rose-400 border border-slate-200 dark:border-slate-700 transition-colors"
                                title="Giải phóng số lượng này trở lại tồn kho khả dụng ATP"
                              >
                                <Unlock className="w-3 h-3" />
                                <span>Giải Phóng</span>
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-400 font-mono italic">
                                Hoàn tất
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              <Pager p={reservationsPage} unit="phiếu giữ chỗ" />
            </div>
          </div>
        </div>
      )}
      {/* TAB 4: BÁO CÁO ĐỊNH GIÁ TỒN KHO ĐA TIÊU CHÍ (Yêu Cầu Lọc Định Giá Đa Chiều) */}
      {subTab === "valuation" && (
        <div className="space-y-6 animate-fade-in">
          {/* Header & Export Action */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
                    BÁO CÁO ĐỊNH GIÁ TỒN KHO ĐA CHIỀU (VALUATION REPORT)
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 font-mono font-bold">
                      Realtime ERP
                    </span>
                    {activeValFilterCount > 0 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 font-bold animate-pulse">
                        Đang lọc: {valuationData.totalSKUs} mã SKU / {valuationData.totalUnits.toLocaleString('vi-VN')} SP
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Phân tích giá trị tồn kho theo Giá Vốn (Cost) và Giá Niêm Yết (List Price) theo đa chỉ tiêu: Hãng Sản Xuất, Ngành Hàng, Điều Kiện Bảo Quản, Hạn Dùng & Kho Hàng
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              {activeValFilterCount > 0 && (
                <button
                  type="button"
                  onClick={handleResetValuationFilters}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300 transition-all cursor-pointer"
                  title="Xóa toàn bộ bộ lọc định giá"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Đặt lại bộ lọc ({activeValFilterCount})</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleExportValuationToExcel}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/30 transition-all cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Xuất Báo Cáo Định Giá (Excel)</span>
              </button>
            </div>
          </div>

          {/* BỘ LỌC ĐA CHỈ TIÊU ĐỊNH GIÁ (VALUATION FILTER TOOLBAR) */}
          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                <SlidersHorizontal className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>Bộ Lọc Định Giá Đa Chỉ Tiêu (Multi-Criteria Valuation Filters)</span>
              </div>
              <div className="text-[11px] text-slate-500 font-medium">
                Kết quả: <strong className="text-indigo-600 dark:text-indigo-400 font-bold">{valuationData.totalSKUs}</strong> SKU / <strong className="text-slate-800 dark:text-slate-200">{valuationData.totalUnits.toLocaleString('vi-VN')}</strong> đơn vị
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              {/* Lọc Kho Hàng */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  1. Kho Lưu Trữ
                </label>
                <select
                  value={valFilterWarehouse}
                  onChange={(e) => setValFilterWarehouse(e.target.value)}
                  className="w-full text-xs font-medium px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">Tất Cả Kho Hàng</option>
                  {availableValuationWarehouses.map((wh) => (
                    <option key={wh} value={wh}>{wh}</option>
                  ))}
                </select>
              </div>

              {/* Lọc Hãng Sản Xuất */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  2. Hãng Sản Xuất / Brand
                </label>
                <select
                  value={valFilterBrand}
                  onChange={(e) => setValFilterBrand(e.target.value)}
                  className="w-full text-xs font-medium px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">Tất Cả Thương Hiệu</option>
                  {availableValuationBrands.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>

              {/* Lọc Nhóm Ngành Hàng (10 Ngành Hàng Chuẩn Danh Mục Hàng Hóa) */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  3. Nhóm Ngành Hàng
                </label>
                <select
                  value={valFilterCategory}
                  onChange={(e) => setValFilterCategory(e.target.value)}
                  className="w-full text-xs font-semibold px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">-- Tất Cả Ngành Hàng --</option>
                  <option value="Kit PCR / qPCR">🧬 Kit PCR / qPCR</option>
                  <option value="Kit Tách chiết">🧪 Kit Tách chiết</option>
                  <option value="Hóa chất / Thuốc nhuộm">🧴 Hóa chất / Thuốc nhuộm</option>
                  <option value="Thiết bị cơ bản">🏢 Thiết bị cơ bản</option>
                  <option value="Thiết bị chuyên sâu">🔬 Thiết bị chuyên sâu</option>
                  <option value="Thiết bị TM khác">🛒 Thiết bị TM khác</option>
                  <option value="Chuyển đổi số">💻 Chuyển đổi số</option>
                  <option value="Vật tư tiêu hao">📦 Vật tư tiêu hao</option>
                  <option value="Dụng cụ">🧪 Dụng cụ</option>
                  <option value="Dịch vụ & Khác">🛠️ Dịch vụ & Khác</option>
                </select>
              </div>

              {/* Lọc Nhiệt Độ Bảo Quản */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  4. Điều Kiện Bảo Quản
                </label>
                <select
                  value={valFilterStorage}
                  onChange={(e) => setValFilterStorage(e.target.value)}
                  className="w-full text-xs font-medium px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">Tất Cả Nhiệt Độ</option>
                  <option value="-20C">❄️ Đông Sâu (-20°C)</option>
                  <option value="2-8C">🧊 Lạnh Mát (2-8°C)</option>
                  <option value="room">🌡️ Nhiệt Độ Phòng (15-25°C)</option>
                </select>
              </div>

              {/* Lọc Tình Trạng Hạn Dùng / Rủi Ro */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  5. Tình Trạng Hạn Dùng / Rủi Ro
                </label>
                <select
                  value={valFilterRisk}
                  onChange={(e) => setValFilterRisk(e.target.value)}
                  className="w-full text-xs font-medium px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">Tất Cả Tình Trạng</option>
                  <option value="safe">✅ Hạn An Toàn (&gt; 90 ngày)</option>
                  <option value="near_exp">⚠️ Cận Date (≤ 90 ngày)</option>
                  <option value="expired">🚨 Đã Quá Hạn (Expired)</option>
                  <option value="slow_moving">⏳ Chậm Luân Chuyển (&gt; 60 ngày)</option>
                  <option value="low_stock">📉 Tồn Kho Thấp / Cảnh Báo Thiếu</option>
                </select>
              </div>

              {/* Tìm Kiếm SKU / Tên */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  6. Tìm Kiếm SKU / Tên / Lô
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Mã SKU, Lô, tên SP..."
                    value={valSearchQuery}
                    onChange={(e) => setValSearchQuery(e.target.value)}
                    className="w-full text-xs font-medium pl-8 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                  />
                  {valSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setValSearchQuery("")}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 4 Summary KPI Cards (Được tính toán động theo bộ lọc) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Tổng Giá Vốn Tồn Kho (Cost Valuation)
              </span>
              <div className="text-2xl font-black text-slate-900 dark:text-white font-mono">
                {formatCurrency(valuationData.totalCostVal)}
              </div>
              <p className="text-[10px] text-slate-500 mt-1.5 flex items-center justify-between">
                <span>Vốn lưu động theo bộ lọc</span>
                <span className="font-bold text-indigo-600">{valuationData.totalUnits.toLocaleString('vi-VN')} SP</span>
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Tổng Giá Bán Niêm Yết (List Valuation)
              </span>
              <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400 font-mono">
                {formatCurrency(valuationData.totalListVal)}
              </div>
              <p className="text-[10px] text-slate-500 mt-1.5 flex items-center justify-between">
                <span>Giá trị thị trường ước tính</span>
                <span className="font-bold text-slate-700 dark:text-slate-300">{valuationData.totalSKUs} mã SKU</span>
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block mb-1">
                Lợi Nhuận Dự Phóng Khi Xuất Kho
              </span>
              <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
                {formatCurrency(valuationData.expectedProfit)}
              </div>
              <p className="text-[10px] text-slate-500 mt-1.5 flex items-center justify-between">
                <span>Chênh lệch Giá bán - Giá vốn</span>
                <span className="font-bold text-emerald-600">Thặng dư gộp</span>
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-[11px] font-bold text-cyan-600 dark:text-cyan-400 uppercase tracking-wider block mb-1">
                Tỷ Suất Lợi Nhuận Gộp Kho Dự Kiến
              </span>
              <div className="text-2xl font-black text-cyan-600 dark:text-cyan-400 font-mono">
                {valuationData.profitMargin.toFixed(1)}%
              </div>
              <p className="text-[10px] text-slate-500 mt-1.5 flex items-center justify-between">
                <span>Biên lợi nhuận trung bình</span>
                <span className="font-bold text-cyan-600">Đạt định mức ABT</span>
              </p>
            </div>
          </div>

          {/* THANH CHUYỂN ĐỔI CHIỀU PHÂN TÍCH ĐỊNH GIÁ (DIMENSION TABS) */}
          <div className="flex items-center gap-1.5 overflow-x-auto p-1.5 rounded-2xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/60 text-xs font-bold">
            {[
              { id: "all", label: "Tất Cả Các Chiều (Tổng Hợp)", icon: Layers },
              { id: "brand", label: "Theo Hãng Sản Xuất", icon: Building2 },
              { id: "category", label: "Theo Nhóm Ngành Hàng", icon: Layers },
              { id: "storage", label: "Theo Nhiệt Độ Bảo Quản", icon: ThermometerSnowflake },
              { id: "risk", label: "Theo Hạn Dùng & Rủi Ro", icon: Clock },
              { id: "warehouse", label: "Theo Kho Lưu Trữ", icon: MapPin },
              { id: "details", label: "Chi Tiết Từng Mã SKU (" + valuationData.totalSKUs + ")", icon: FileText }
            ].map((dim) => {
              const Icon = dim.icon;
              return (
                <button
                  key={dim.id}
                  type="button"
                  onClick={() => setValViewDimension(dim.id as any)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl transition-all whitespace-nowrap cursor-pointer ${
                    valViewDimension === dim.id
                      ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs font-extrabold"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{dim.label}</span>
                </button>
              );
            })}
          </div>

          {/* TABLE 1: ĐỊNH GIÁ THEO HÃNG SẢN XUẤT (BRAND VALUATION) */}
          {(valViewDimension === "all" || valViewDimension === "brand") && (
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-indigo-600" />
                    <span>Cơ Cấu Giá Trị Tồn Kho Theo Hãng Sản Xuất (Brand / Manufacturer)</span>
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Đánh giá phân bổ vốn lưu động cho từng thương hiệu đối tác (TopSPEC, Bioer, Biologix, Bio-Rad, Thermo Fisher...)
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-3 px-3">Hãng Sản Xuất / Thương Hiệu</th>
                      <th className="py-3 px-3 text-center">Số SKU</th>
                      <th className="py-3 px-3 text-right">Tổng Lượng Tồn</th>
                      <th className="py-3 px-3 text-right">Tổng Vốn Tồn Kho (VNĐ)</th>
                      <th className="py-3 px-3 text-right">Tổng Giá Niêm Yết (VNĐ)</th>
                      <th className="py-3 px-3 text-right">Lợi Nhuận Dự Phóng</th>
                      <th className="py-3 px-3 text-right">Tỷ Trọng Kho</th>
                      <th className="py-3 px-3 text-right">Tỷ Suất LN</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                    {valuationData.brandList.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-400">
                          Không có sản phẩm nào phù hợp với bộ lọc hiện tại.
                        </td>
                      </tr>
                    ) : (
                      valuationData.brandList.map((b, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-3 font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <span className="w-5 h-5 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-[10px] font-mono font-bold">
                              {idx + 1}
                            </span>
                            <span>{b.brand}</span>
                          </td>
                          <td className="py-3 px-3 text-center font-mono font-semibold text-slate-600 dark:text-slate-400">
                            {b.count}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-slate-800 dark:text-slate-200">
                            {b.totalQty.toLocaleString('vi-VN')}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-black text-slate-900 dark:text-white">
                            {formatCurrency(b.costVal)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-indigo-600 dark:text-indigo-400">
                            {formatCurrency(b.listVal)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(b.profit)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-cyan-600">
                            {b.share.toFixed(1)}%
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-emerald-600">
                            {b.margin.toFixed(1)}%
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TABLE 2: ĐỊNH GIÁ THEO NHÓM NGÀNH HÀNG (CATEGORY VALUATION) */}
          {(valViewDimension === "all" || valViewDimension === "category") && (
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald-600" />
                    <span>Cơ Cấu Giá Trị Tồn Kho Theo Nhóm Ngành Hàng (Category)</span>
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Phân tích danh mục sinh phẩm qPCR, kit tách chiết, thiết bị phòng lab, vật tư tiêu hao plasticware
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-3 px-3">Nhóm Ngành Hàng</th>
                      <th className="py-3 px-3 text-center">Số SKU</th>
                      <th className="py-3 px-3 text-right">Tổng Lượng Tồn</th>
                      <th className="py-3 px-3 text-right">Tổng Vốn Tồn Kho (VNĐ)</th>
                      <th className="py-3 px-3 text-right">Tổng Giá Niêm Yết (VNĐ)</th>
                      <th className="py-3 px-3 text-right">Lợi Nhuận Dự Phóng</th>
                      <th className="py-3 px-3 text-right">Tỷ Trọng Kho</th>
                      <th className="py-3 px-3 text-right">Tỷ Suất LN</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                    {valuationData.catList.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-400">
                          Không có sản phẩm nào phù hợp với bộ lọc hiện tại.
                        </td>
                      </tr>
                    ) : (
                      valuationData.catList.map((c, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-3 font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <span className="w-5 h-5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-[10px] font-mono font-bold">
                              {idx + 1}
                            </span>
                            <span className="flex items-center gap-1.5">
                              {c.category === "Kit PCR / qPCR" && <span>🧬</span>}
                              {c.category === "Kit Tách chiết" && <span>🧪</span>}
                              {c.category === "Hóa chất / Thuốc nhuộm" && <span>🧴</span>}
                              {c.category === "Thiết bị cơ bản" && <span>🏢</span>}
                              {c.category === "Thiết bị chuyên sâu" && <span>🔬</span>}
                              {c.category === "Thiết bị TM khác" && <span>🛒</span>}
                              {c.category === "Chuyển đổi số" && <span>💻</span>}
                              {c.category === "Vật tư tiêu hao" && <span>📦</span>}
                              {c.category === "Dụng cụ" && <span>🧪</span>}
                              {c.category === "Dịch vụ & Khác" && <span>🛠️</span>}
                              <span>{c.category}</span>
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center font-mono font-semibold text-slate-600 dark:text-slate-400">
                            {c.count}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-slate-800 dark:text-slate-200">
                            {c.totalQty.toLocaleString('vi-VN')}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-black text-slate-900 dark:text-white">
                            {formatCurrency(c.costVal)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-indigo-600 dark:text-indigo-400">
                            {formatCurrency(c.listVal)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(c.profit)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-cyan-600">
                            {c.share.toFixed(1)}%
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-emerald-600">
                            {c.margin.toFixed(1)}%
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TABLE 3: ĐỊNH GIÁ THEO ĐIỀU KIỆN NHIỆT ĐỘ BẢO QUẢN (COLD CHAIN STORAGE) */}
          {(valViewDimension === "all" || valViewDimension === "storage") && (
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                    <ThermometerSnowflake className="w-4 h-4 text-sky-500" />
                    <span>Cơ Cấu Giá Trị Tồn Kho Theo Điều Kiện Nhiệt Độ Bảo Quản (Cold Chain Storage)</span>
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Quản lý chi phí rủi ro chuỗi cung ứng lạnh (Âm sâu -20°C, Bảo quản lạnh mát 2-8°C, Nhiệt độ phòng)
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-3 px-3">Điều Kiện Nhiệt Độ</th>
                      <th className="py-3 px-3 text-center">Số SKU</th>
                      <th className="py-3 px-3 text-right">Tổng Lượng Tồn</th>
                      <th className="py-3 px-3 text-right">Tổng Vốn Tồn Kho (VNĐ)</th>
                      <th className="py-3 px-3 text-right">Tổng Giá Niêm Yết (VNĐ)</th>
                      <th className="py-3 px-3 text-right">Lợi Nhuận Dự Phóng</th>
                      <th className="py-3 px-3 text-right">Tỷ Trọng Kho</th>
                      <th className="py-3 px-3 text-right">Tỷ Suất LN</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                    {valuationData.storageList.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-400">
                          Không có sản phẩm nào phù hợp với bộ lọc hiện tại.
                        </td>
                      </tr>
                    ) : (
                      valuationData.storageList.map((s, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-3 font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <span className="w-5 h-5 rounded-md bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 flex items-center justify-center text-[10px] font-mono font-bold">
                              {idx + 1}
                            </span>
                            <span>{s.storage}</span>
                          </td>
                          <td className="py-3 px-3 text-center font-mono font-semibold text-slate-600 dark:text-slate-400">
                            {s.count}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-slate-800 dark:text-slate-200">
                            {s.totalQty.toLocaleString('vi-VN')}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-black text-slate-900 dark:text-white">
                            {formatCurrency(s.costVal)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-indigo-600 dark:text-indigo-400">
                            {formatCurrency(s.listVal)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(s.profit)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-cyan-600">
                            {s.share.toFixed(1)}%
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-emerald-600">
                            {s.margin.toFixed(1)}%
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TABLE 4: ĐỊNH GIÁ THEO HẠN DÙNG & RỦI RO (SHELF-LIFE & RISK VALUATION) */}
          {(valViewDimension === "all" || valViewDimension === "risk") && (
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-500" />
                    <span>Cơ Cấu Giá Trị Tồn Kho Theo Tình Trạng Hạn Dùng &amp; Rủi Ro</span>
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Định lượng vốn lưu động có nguy cơ tổn thất (Cận date ≤ 90 ngày, Quá hạn, Chậm luân chuyển)
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-3 px-3">Tình Trạng Hạn Dùng / Rủi Ro</th>
                      <th className="py-3 px-3 text-center">Số SKU</th>
                      <th className="py-3 px-3 text-right">Tổng Lượng Tồn</th>
                      <th className="py-3 px-3 text-right">Tổng Vốn Tồn Kho (VNĐ)</th>
                      <th className="py-3 px-3 text-right">Tổng Giá Niêm Yết (VNĐ)</th>
                      <th className="py-3 px-3 text-right">Lợi Nhuận Dự Phóng</th>
                      <th className="py-3 px-3 text-right">Tỷ Trọng Kho</th>
                      <th className="py-3 px-3 text-right">Tỷ Suất LN</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                    {valuationData.riskList.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-400">
                          Không có sản phẩm nào phù hợp với bộ lọc hiện tại.
                        </td>
                      </tr>
                    ) : (
                      valuationData.riskList.map((r, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-3 font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <span className="w-5 h-5 rounded-md bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center text-[10px] font-mono font-bold">
                              {idx + 1}
                            </span>
                            <span>{r.risk}</span>
                          </td>
                          <td className="py-3 px-3 text-center font-mono font-semibold text-slate-600 dark:text-slate-400">
                            {r.count}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-slate-800 dark:text-slate-200">
                            {r.totalQty.toLocaleString('vi-VN')}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-black text-slate-900 dark:text-white">
                            {formatCurrency(r.costVal)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-indigo-600 dark:text-indigo-400">
                            {formatCurrency(r.listVal)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(r.profit)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-cyan-600">
                            {r.share.toFixed(1)}%
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-emerald-600">
                            {r.margin.toFixed(1)}%
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TABLE 5: ĐỊNH GIÁ THEO KHO LƯU TRỮ (WAREHOUSE VALUATION) */}
          {(valViewDimension === "all" || valViewDimension === "warehouse") && (
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-purple-600" />
                    <span>Cơ Cấu Giá Trị Tồn Kho Theo Kho Hàng (Warehouse Distribution)</span>
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Phân bổ vốn lưu động giữa các điểm kho vật lý
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-3 px-3">Kho Lưu Trữ</th>
                      <th className="py-3 px-3 text-center">Số SKU</th>
                      <th className="py-3 px-3 text-right">Tổng Lượng Tồn</th>
                      <th className="py-3 px-3 text-right">Tổng Vốn Tồn Kho (VNĐ)</th>
                      <th className="py-3 px-3 text-right">Tổng Giá Niêm Yết (VNĐ)</th>
                      <th className="py-3 px-3 text-right">Lợi Nhuận Dự Phóng</th>
                      <th className="py-3 px-3 text-right">Tỷ Trọng Kho</th>
                      <th className="py-3 px-3 text-right">Tỷ Suất LN</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                    {valuationData.warehouseList.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-400">
                          Không có sản phẩm nào phù hợp với bộ lọc hiện tại.
                        </td>
                      </tr>
                    ) : (
                      valuationData.warehouseList.map((w, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-3 font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <span className="w-5 h-5 rounded-md bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center text-[10px] font-mono font-bold">
                              {idx + 1}
                            </span>
                            <span>{w.warehouse}</span>
                          </td>
                          <td className="py-3 px-3 text-center font-mono font-semibold text-slate-600 dark:text-slate-400">
                            {w.count}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-slate-800 dark:text-slate-200">
                            {w.totalQty.toLocaleString('vi-VN')}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-black text-slate-900 dark:text-white">
                            {formatCurrency(w.costVal)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-indigo-600 dark:text-indigo-400">
                            {formatCurrency(w.listVal)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(w.profit)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-cyan-600">
                            {w.share.toFixed(1)}%
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-emerald-600">
                            {w.margin.toFixed(1)}%
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TABLE 6: CHI TIẾT ĐỊNH GIÁ TỪNG MÃ SKU (SKU-LEVEL VALUATION DETAILS) */}
          {(valViewDimension === "all" || valViewDimension === "details") && (
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h4 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                    <FileText className="w-4 h-4 text-indigo-600" />
                    <span>Chi Tiết Định Giá Từng Mã SKU ({valuationData.skuDetailsList.length} sản phẩm thỏa mãn)</span>
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Bảng giá vốn, giá bán niêm yết và lợi nhuận gộp danh nghĩa cho từng mặt hàng trong kho
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[500px]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-800 sticky top-0 z-10 backdrop-blur-xs">
                    <tr>
                      <th className="py-3 px-3 text-center">STT</th>
                      <th className="py-3 px-3">Mã SKU / Sản Phẩm</th>
                      <th className="py-3 px-3">Hãng / Ngành Hàng</th>
                      <th className="py-3 px-3">Số Lô / HSD</th>
                      <th className="py-3 px-3 text-right">Tồn Kho</th>
                      <th className="py-3 px-3 text-right">Đơn Giá Vốn</th>
                      <th className="py-3 px-3 text-right">Tổng Vốn (Cost)</th>
                      <th className="py-3 px-3 text-right">Đơn Giá Bán</th>
                      <th className="py-3 px-3 text-right">Tổng Giá Niêm Yết</th>
                      <th className="py-3 px-3 text-right">Lợi Nhuận</th>
                      <th className="py-3 px-3 text-right">Biên LN</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                    {valuationData.skuDetailsList.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="py-8 text-center text-slate-400">
                          Không tìm thấy sản phẩm nào phù hợp với bộ lọc hiện tại.
                        </td>
                      </tr>
                    ) : (
                      valuationSkuPage.items.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-2.5 px-3 text-center text-slate-400 font-mono">
                            {(valuationSkuPage.page - 1) * valuationSkuPage.size + idx + 1}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-1.5 py-0.5 rounded text-[11px] block w-fit mb-0.5">
                              {item.product_code}
                            </span>
                            <span className="font-bold text-slate-900 dark:text-white line-clamp-1">
                              {item.product_name}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-slate-700 dark:text-slate-300">
                              {item.manufacturer}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {item.category}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px]">
                            <div className="text-slate-700 dark:text-slate-300 font-bold">
                              Lô: {item.lot_number || item.batch_lot || "N/A"}
                            </div>
                            <div className={`text-[10px] ${item.isNearExpiry ? "text-amber-600 font-bold" : (item.isExpired ? "text-rose-600 font-bold" : "text-slate-400")}`}>
                              HSD: {item.expiry_date || "—"}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                            {item.qty.toLocaleString('vi-VN')} {item.unit || "SP"}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                            {formatCurrency(item.cPrice)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-black text-slate-900 dark:text-white">
                            {formatCurrency(item.totalCost)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-indigo-600 dark:text-indigo-400">
                            {formatCurrency(item.lPrice)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-indigo-600 dark:text-indigo-400">
                            {formatCurrency(item.totalList)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(item.profit)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-cyan-600">
                            {item.margin.toFixed(1)}%
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                <Pager p={valuationSkuPage} unit="mã" />
              </div>
            </div>
          )}
        </div>
      )}{/* ==================== TAB 5: TRUY VẾT LÔ 360° & THU HỒI ISO 13485 (Yêu cầu 14) ==================== */}
      {subTab === "lot_trace" && (
        <div className="space-y-6">
          {/* Header Banner */}
          <div className="bg-gradient-to-r from-rose-950/40 via-slate-900 to-slate-900 p-6 rounded-2xl border border-rose-900/40 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-rose-600/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
                <ShieldAlert className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-white tracking-wide uppercase">
                    HỆ THỐNG TRUY VẾT SỰ CỐ LÔ 360° &amp; QUẢN TRỊ THU HỒI Y TẾ
                  </h2>
                  <span className="text-[10px] bg-rose-950 text-rose-300 border border-rose-700/60 px-2 py-0.5 rounded-full font-mono font-bold">
                    ISO 13485 / GMP Traceability
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Truy vết xuôi (Forward) &amp; Truy vết ngược (Backward) toàn diện: Kiểm soát nguồn gốc nhập, vị trí tồn kho kệ và danh sách Bệnh viện/Phòng xét nghiệm đã nhận sản phẩm để phát lệnh thu hồi khẩn cấp.
                </p>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportRecallContactSheet}
                disabled={!traceResult || !traceResult.distributed_customers || traceResult.distributed_customers.length === 0}
                className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-all cursor-pointer"
                title="Xuất bảng liên lạc khách hàng thu hồi khẩn cấp ra file Excel"
              >
                <Download className="w-4 h-4 text-emerald-400" />
                <span>Xuất Danh Sách Thu Hồi (Excel)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setRecallReason("");
                  setIsRecallModalOpen(true);
                }}
                disabled={!traceResult}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white flex items-center gap-1.5 shadow-lg shadow-rose-950/60 transition-all cursor-pointer"
              >
                <AlertOctagon className="w-4 h-4" />
                <span>🚨 Kích Hoạt Lệnh Thu Hồi Lô</span>
              </button>
            </div>
          </div>

          {/* Search Lot Bar */}
          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Nhập số Lô (VD: LOT-2026-08A, LOT-HPV-2026-01...) hoặc Mã SKU sản phẩm..."
                  value={traceLotQuery}
                  onChange={(e) => setTraceLotQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleTraceLot()}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-mono text-xs focus:outline-none focus:border-rose-500 font-bold"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <select
                  onChange={(e) => {
                    if (e.target.value) {
                      setTraceLotQuery(e.target.value);
                      handleTraceLot(e.target.value);
                    }
                  }}
                  className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-xs font-mono font-medium"
                >
                  <option value="">-- Chọn nhanh Lô có trong kho --</option>
                  {Array.from(new Set(enrichedItems.map(i => i.lot_number).filter(Boolean))).map((lot: any) => (
                    <option key={lot} value={lot}>{lot}</option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => handleTraceLot()}
                  disabled={isTracing}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white flex items-center gap-1.5 shadow-md shadow-rose-950/40 cursor-pointer shrink-0"
                >
                  {isTracing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                  <span>Truy Vết 360°</span>
                </button>
              </div>
            </div>
          </div>

          {/* Trace Results Section */}
          {traceResult ? (
            <div className="space-y-6">
              {/* 3 Pillars of Traceability */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* 1. Nguồn Gốc Nhập Kho (Inbound Origin) */}
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                    <span className="font-bold text-xs text-indigo-600 dark:text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                      <ArrowDownLeft className="w-4 h-4 text-indigo-500" /> 1. Nguồn Gốc Nhập Kho
                    </span>
                    <span className="text-[10px] font-mono font-bold bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded">
                      Inbound Provenance
                    </span>
                  </div>

                  {traceResult.inventory_items && traceResult.inventory_items.length > 0 ? (
                    (() => {
                      const itm = traceResult.inventory_items[0];
                      const tx = (traceResult.transactions || []).find((t: any) => t.transaction_type === "INBOUND") || traceResult.transactions?.[0];
                      return (
                        <div className="space-y-3 text-xs">
                          <div>
                            <div className="text-[10px] text-slate-400 uppercase font-semibold">Sản phẩm:</div>
                            <div className="font-bold text-slate-900 dark:text-white mt-0.5">{itm.product_name}</div>
                            <div className="font-mono text-sky-500 font-bold text-[11px] mt-0.5">{itm.product_code}</div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-[11px] pt-2 border-t border-slate-100 dark:border-slate-800/80">
                            <div>
                              <span className="text-slate-400 block text-[10px]">Hãng sản xuất:</span>
                              <strong className="text-slate-800 dark:text-slate-200">{itm.manufacturer || "—"}</strong>
                            </div>
                            <div>
                              <span className="text-slate-400 block text-[10px]">Quy cách:</span>
                              <strong className="text-slate-800 dark:text-slate-200">{itm.specification || "—"}</strong>
                            </div>
                          </div>
                          <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 text-[11px] space-y-1.5">
                            <div className="flex justify-between">
                              <span className="text-slate-400">Chứng từ nhập gần nhất:</span>
                              <span className="font-mono font-bold text-indigo-400">{tx?.transaction_code || "—"}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400">Ngày nhập kho:</span>
                              <span className="font-mono text-slate-300">{tx?.date ? formatDate(tx.date) : "—"}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400">Đơn vị cung cấp:</span>
                              <span className="font-semibold text-slate-200 truncate max-w-[150px]">{tx?.notes || tx?.warehouse_name || "—"}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <div className="text-center py-6 text-slate-500 text-xs italic">Chưa tìm thấy thông tin sản phẩm khớp với số Lô này</div>
                  )}
                </div>

                {/* 2. Tồn Kho Thực Tế & Tình Trạng QC (Current Custody) */}
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                    <span className="font-bold text-xs text-amber-600 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Package className="w-4 h-4 text-amber-500" /> 2. Tồn Kho Thực Tế &amp; QC
                    </span>
                    <span className="text-[10px] font-mono font-bold bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded">
                      Warehouse Custody
                    </span>
                  </div>

                  {traceResult.inventory_items && traceResult.inventory_items.length > 0 ? (
                    (() => {
                      const itm = traceResult.inventory_items[0];
                      const isQuarantined = itm.is_quarantined || (traceResult.recalls && traceResult.recalls.some((r: any) => r.status === "ACTIVE"));
                      const activeRecall = (traceResult.recalls || []).find((r: any) => r.status === "ACTIVE");

                      return (
                        <div className="space-y-3 text-xs">
                          {/* Quarantine Warning Banner */}
                          {isQuarantined ? (
                            <div className="p-3 bg-rose-950/50 border border-rose-600/60 rounded-xl space-y-1.5 animate-pulse">
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-rose-300 text-xs flex items-center gap-1">
                                  <AlertOctagon className="w-4 h-4 text-rose-400" />
                                  ĐANG BỊ PHONG TỎA CÁCH LY
                                </span>
                                <span className="text-[9px] bg-rose-900 text-rose-200 px-1.5 py-0.2 rounded font-mono font-bold">
                                  CẤM XUẤT
                                </span>
                              </div>
                              <p className="text-[11px] text-rose-200/90 leading-tight">
                                {itm.quarantine_reason || activeRecall?.reason || "Lô hàng bị phong tỏa do cảnh báo thu hồi chất lượng"}
                              </p>
                              <button
                                type="button"
                                onClick={() => handleReleaseQuarantine(traceResult.lot_number || itm.lot_number, itm.product_code)}
                                className="mt-2 w-full py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold border border-slate-700 flex items-center justify-center gap-1 cursor-pointer"
                              >
                                <Unlock className="w-3 h-3 text-emerald-400" />
                                <span>Giải Tỏa Cách Ly Lô Này</span>
                              </button>
                            </div>
                          ) : (
                            <div className="p-2.5 bg-emerald-950/40 border border-emerald-600/40 rounded-xl flex items-center gap-2">
                              <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
                              <div>
                                <div className="font-bold text-emerald-300 text-xs">Tình trạng: QC PASSED</div>
                                <div className="text-[10px] text-emerald-400/80">Lô hàng đạt chuẩn kiểm nghiệm, cho phép xuất bán</div>
                              </div>
                            </div>
                          )}

                          <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                            <div className="bg-slate-50 dark:bg-slate-950/70 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800">
                              <span className="text-slate-400 block text-[10px]">Tồn kho tại chỗ:</span>
                              <strong className="text-xl font-mono text-emerald-500 font-black">{itm.quantity_on_hand}</strong>
                              <span className="text-slate-400 text-[10px] ml-1">{itm.unit || "Hộp"}</span>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-950/70 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800">
                              <span className="text-slate-400 block text-[10px]">Vị trí lưu trữ:</span>
                              <strong className="text-slate-200 font-medium block truncate mt-0.5">{itm.warehouse_location || "Kho Trung Tâm"}</strong>
                              <span className="text-slate-400 text-[10px] font-mono">{itm.shelf_position || "Kệ K-01"}</span>
                            </div>
                          </div>

                          <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 text-[11px] flex justify-between">
                            <span className="text-slate-400">Hạn sử dụng (EXP):</span>
                            <span className="font-mono font-bold text-amber-400">{itm.expiry_date || "2027-12-31"}</span>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <div className="text-center py-6 text-slate-500 text-xs italic">Không có dữ liệu tồn kho</div>
                  )}
                </div>

                {/* 3. Thống Kê Phân Phối Ra Thị Trường */}
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                    <span className="font-bold text-xs text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Truck className="w-4 h-4 text-emerald-500" /> 3. Phân Phối Khách Hàng
                    </span>
                    <span className="text-[10px] font-mono font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded">
                      Forward Exposure
                    </span>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="bg-slate-50 dark:bg-slate-950/70 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800">
                        <span className="text-slate-400 block text-[10px]">Số khách đã nhận:</span>
                        <strong className="text-xl font-mono text-indigo-400 font-bold">
                          {new Set((traceResult.distributed_customers || []).map((c: any) => c.customer_name)).size}
                        </strong>
                        <span className="text-slate-400 text-[10px] ml-1">đơn vị</span>
                      </div>
                      <div className="bg-slate-50 dark:bg-slate-950/70 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800">
                        <span className="text-slate-400 block text-[10px]">Tổng lượng đã giao:</span>
                        <strong className="text-xl font-mono text-amber-400 font-bold">
                          {(traceResult.distributed_customers || []).reduce((s: number, c: any) => s + (Number(c.quantity) || 0), 0)}
                        </strong>
                        <span className="text-slate-400 text-[10px] ml-1">SP</span>
                      </div>
                    </div>

                    <div className="p-3 bg-slate-50 dark:bg-slate-950/50 rounded-xl border border-slate-200 dark:border-slate-800 text-[11px] space-y-1">
                      <div className="text-[10px] text-slate-400 uppercase font-semibold">Đánh giá mức độ rủi ro:</div>
                      <div className="font-bold text-slate-300">
                        {(traceResult.distributed_customers || []).length > 0 ? (
                          <span className="text-rose-400 font-bold flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                            Đã lưu hành ngoài thị trường - Cần kiểm soát chặt
                          </span>
                        ) : (
                          <span className="text-emerald-400 font-bold">
                            Chưa phân phối ra ngoài (100% còn trong kho an toàn)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Table: Danh Sách Bệnh Viện & Khách Hàng Đã Nhận Hàng (Forward Distribution Sheet) */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2 bg-slate-50/50 dark:bg-slate-950/50">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-indigo-500" />
                    <h3 className="font-bold text-xs uppercase tracking-wider text-slate-800 dark:text-slate-200">
                      BẢNG THEO DÕI KHÁCH HÀNG &amp; ĐƠN VỊ ĐÃ NHẬN SẢN PHẨM THUỘC LÔ NÀY (RECALL ROSTER)
                    </h3>
                    <span className="text-[10px] bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-full font-mono font-bold">
                      {(traceResult.distributed_customers || []).length} đơn xuất
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleExportRecallContactSheet}
                    disabled={!traceResult.distributed_customers || traceResult.distributed_customers.length === 0}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white flex items-center gap-1 shadow-sm transition-all cursor-pointer"
                  >
                    <Download className="w-3 h-3" />
                    <span>Tải Roster Excel</span>
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px] bg-slate-50/80 dark:bg-slate-950/80">
                        <th className="py-2.5 px-3 text-center w-10">STT</th>
                        <th className="py-2.5 px-3">Mã SO &amp; Ngày Giao</th>
                        <th className="py-2.5 px-3">Bệnh Viện / Đơn Vị Nhận</th>
                        <th className="py-2.5 px-3 text-center">Số Lô Giao</th>
                        <th className="py-2.5 px-3 text-center">Số Lượng</th>
                        <th className="py-2.5 px-3">Vận Chuyển &amp; Tracking</th>
                        <th className="py-2.5 px-3">NVKD Phụ Trách</th>
                        <th className="py-2.5 px-3 text-center">Trạng Thái</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                      {(traceResult.distributed_customers || []).length > 0 ? (
                        traceResult.distributed_customers.map((c: any, idx: number) => (
                          <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                            <td className="py-3 px-3 text-center font-mono text-slate-400">{idx + 1}</td>
                            <td className="py-3 px-3 font-mono">
                              <span className="font-bold text-white text-xs">{c.order_code}</span>
                              <div className="text-[10px] text-slate-400 mt-0.5">{c.order_date ? formatDate(c.order_date) : "—"}</div>
                            </td>
                            <td className="py-3 px-3">
                              <div className="font-bold text-slate-200 text-xs">{c.customer_name}</div>
                              <div className="text-[10px] text-slate-400 mt-0.5 font-mono">Sản phẩm: {c.product_name}</div>
                            </td>
                            <td className="py-3 px-3 text-center font-mono">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-amber-300 border border-slate-700">
                                {c.lot_number || traceResult.lot_number}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-center font-mono font-bold text-amber-400 text-sm">
                              x{c.quantity}
                            </td>
                            <td className="py-3 px-3 text-[11px]">
                              <div className="text-slate-300">{c.shipping_method || "Xe lạnh chuyên dụng ABT"}</div>
                              <div className="text-[10px] font-mono text-sky-400 mt-0.5">{c.tracking_code || "—"}</div>
                            </td>
                            <td className="py-3 px-3 text-[11px] text-slate-300 font-sans">
                              {c.sales_rep_name || "Sales Rep"}
                            </td>
                            <td className="py-3 px-3 text-center">
                              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-950 text-emerald-300 border border-emerald-800/60">
                                {c.delivery_status || "DELIVERED"}
                              </span>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-slate-500 italic">
                            Chưa có khách hàng nào nhận sản phẩm thuộc Lô này. Hàng hóa vẫn nằm an toàn trong kho.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center text-slate-500 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3">
              <ShieldAlert className="w-12 h-12 mx-auto text-slate-600" />
              <p className="font-semibold text-slate-300 text-sm">Chưa có số Lô nào được chọn để truy vết 360°.</p>
              <p className="text-xs">Hãy nhập mã số Lô ở thanh tìm kiếm phía trên hoặc chọn từ danh sách Lô có sẵn để xem toàn bộ vòng đời sản phẩm.</p>
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 6: TRUNG TÂM BIỂU MẪU EXCEL CHUẨN & IMPORT (Yêu cầu 16) ==================== */}
      {subTab === "excel_center" && (
        <div className="space-y-6">
          {/* Header Banner */}
          <div className="bg-gradient-to-r from-teal-950/40 via-slate-900 to-slate-900 p-6 rounded-2xl border border-teal-900/40 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-teal-600/20 border border-teal-500/40 flex items-center justify-center text-teal-400">
                <FileSpreadsheet className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-white tracking-wide uppercase">
                    TRUNG TÂM BIỂU MẪU EXCEL CHUẨN HÓA &amp; NHẬP LIỆU HÀNG LOẠT (KHỐI KINH DOANH &amp; KHO VẬN)
                  </h2>
                  <span className="text-[10px] bg-teal-950 text-teal-300 border border-teal-700/60 px-2 py-0.5 rounded-full font-mono font-bold">
                    Standardized Excel Master
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Cung cấp 5 bộ biểu mẫu Excel chuẩn hóa cho Khách hàng CRM, Sản phẩm &amp; Bảng giá, Nhập kho theo Lô, Đơn đặt hàng PO, và Nhà cung cấp; hỗ trợ import trực tiếp vào cơ sở dữ liệu. (Chức năng nhập Tài khoản &amp; Nhân sự toàn công ty được quản lý tập trung tại mục Quản Trị Hệ Thống).
                </p>
              </div>
            </div>
          </div>

          {/* 6 Standard Templates Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Card 1: Khách Hàng */}
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between space-y-4 hover:border-indigo-500/50 transition-colors">
              <div className="space-y-2">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <Building2 className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                  1. Danh Mục Khách Hàng CRM
                </h3>
                <p className="text-slate-500 text-xs leading-relaxed">
                  Bao gồm: Mã KH, Tên, Loại khách, MST, Người liên hệ, SĐT, Email, Địa chỉ, Hạn mức nợ &amp; Hạn ngày nợ tối đa.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadCustomerTemplate}
                className="w-full py-2.5 rounded-xl font-bold text-xs bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Tải Mẫu Khách Hàng (.xlsx)</span>
              </button>
            </div>

            {/* Card 2: Sản Phẩm & Bảng Giá */}
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between space-y-4 hover:border-purple-500/50 transition-colors">
              <div className="space-y-2">
                <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                  <Package className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                  2. Danh Mục Sản Phẩm &amp; Bảng Giá
                </h3>
                <p className="text-slate-500 text-xs leading-relaxed">
                  Bao gồm: Mã SKU, Tên SP, Hãng SX, Nhóm ngành hàng, Quy cách, ĐVT, Giá vốn, Giá End-user, Giá Đại lý 1, Giá Đại lý 2.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadProductTemplate}
                className="w-full py-2.5 rounded-xl font-bold text-xs bg-purple-600 hover:bg-purple-500 text-white flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Tải Mẫu Bảng Giá (.xlsx)</span>
              </button>
            </div>

            {/* Card 3: Nhập Kho Nâng Cao Theo Lô */}
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between space-y-4 hover:border-emerald-500/50 transition-colors">
              <div className="space-y-2">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <Layers className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                  3. Nhập Kho Tồn Đầu Kỳ &amp; Hàng Hóa Theo Lô (Rút gọn 7 cột)
                </h3>
                <p className="text-slate-500 text-xs leading-relaxed">
                  Chỉ cần 7 cột cốt lõi: <strong>Mã SP, Số Lô (Lot), Hạn dùng (Date), Số lượng, Giá trị / Đơn giá đầu kỳ, Nhiệt độ bảo quản, Khu vực / Vị trí kho</strong>. <em>(Tên SP, Quy cách, ĐVT, Nhãn hiệu tự động tra cứu từ Bảng Mã Sản Xuất theo Mã SP).</em>
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadInboundTemplate}
                className="w-full py-2.5 rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Tải Mẫu Nhập Kho Nguyên Liệu (.xlsx)</span>
              </button>
            </div>

            {/* Card 4: Đơn Hàng Cung Ứng PO */}
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between space-y-4 hover:border-sky-500/50 transition-colors">
              <div className="space-y-2">
                <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                  <Truck className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                  4. Đơn Hàng Đặt Mua PO (NCC)
                </h3>
                <p className="text-slate-500 text-xs leading-relaxed">
                  Bao gồm: Mã PO, Tên Nhà cung cấp, Ngày đặt, Ngày hẹn giao hàng, Mã SKU, Tên SP, Số lượng đặt, Đơn giá mua.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadPOTemplate}
                className="w-full py-2.5 rounded-xl font-bold text-xs bg-sky-600 hover:bg-sky-500 text-white flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Tải Mẫu Đơn Mua PO (.xlsx)</span>
              </button>
            </div>

            {/* Card 5: Hồ Sơ Nhà Cung Cấp */}
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between space-y-4 hover:border-amber-500/50 transition-colors">
              <div className="space-y-2">
                <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <Building2 className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                  5. Danh Mục Nhà Cung Cấp
                </h3>
                <p className="text-slate-500 text-xs leading-relaxed">
                  Bao gồm: Mã NCC, Tên Nhà Cung Cấp / Đại Diện, Người liên hệ, SĐT, Email, Địa chỉ, Ngành hàng, Điều khoản nợ.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadSupplierTemplate}
                className="w-full py-2.5 rounded-xl font-bold text-xs bg-amber-600 hover:bg-amber-500 text-white flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Tải Mẫu Nhà Cung Cấp (.xlsx)</span>
              </button>
            </div>
          </div>

          {/* Smart Excel File Importer */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                  <Upload className="w-4 h-4 text-teal-500" />
                  CÔNG CỤ NẠP DỮ LIỆU EXCEL THÔNG MINH (SMART IMPORTER)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tải lên bất kỳ file Excel theo một trong các mẫu chuẩn ở trên để hệ thống tự động phân tích và đưa vào vận hành.
                </p>
              </div>
            </div>

            {/* Dropzone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDraggingGeneralExcel(true);
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDraggingGeneralExcel(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDraggingGeneralExcel(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDraggingGeneralExcel(false);
                const file = e.dataTransfer.files?.[0];
                if (file) {
                  processGeneralExcelFile(file);
                }
              }}
              onClick={() => generalExcelFileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer select-none ${
                isDraggingGeneralExcel
                  ? "border-teal-400 bg-teal-500/20 dark:bg-teal-950/60 ring-4 ring-teal-500/30 scale-[1.01]"
                  : "border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/40 hover:border-teal-400 dark:hover:border-teal-600 hover:bg-slate-100/60 dark:hover:bg-slate-900/40"
              }`}
            >
              <input
                type="file"
                ref={generalExcelFileInputRef}
                accept=".xlsx, .xls, .csv"
                onChange={handleGeneralExcelUpload}
                className="hidden"
              />
              <FileSpreadsheet
                className={`w-12 h-12 mx-auto mb-2 transition-transform duration-200 ${
                  isDraggingGeneralExcel
                    ? "text-teal-400 scale-125 animate-bounce"
                    : "text-teal-600 dark:text-teal-400"
                }`}
              />
              <p className="font-bold text-slate-800 dark:text-white text-sm mb-1">
                {isDraggingGeneralExcel
                  ? "👉 Thả file Excel vào đây để nạp dữ liệu ngay!"
                  : importFileName
                  ? `✅ Tệp đã chọn: ${importFileName}`
                  : "Kéo thả file Excel (.xlsx / .xls) vào đây hoặc nhấp để tải lên"}
              </p>
              <p className="text-[11px] text-slate-500 mb-3">
                {isDraggingGeneralExcel
                  ? "Hệ thống sẽ tự động phân tích và nhận diện cấu trúc cột"
                  : "Tự động nhận diện cấu trúc cột theo chuẩn biểu mẫu ABT"}
              </p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  generalExcelFileInputRef.current?.click();
                }}
                className="px-5 py-2 rounded-xl font-bold bg-teal-600 hover:bg-teal-500 text-white text-xs shadow-md transition-all cursor-pointer"
              >
                {importFileName ? "Chọn File Khác..." : "Chọn File Excel Nhập Liệu..."}
              </button>
            </div>

            {/* Preview Table */}
            {previewImportRows.length > 0 && (
              <div className="space-y-3 pt-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-xs text-slate-300 uppercase tracking-wider">
                      Xem trước dữ liệu:
                    </span>
                    {previewContactRows.length > 0 ? (
                      <div className="flex items-center gap-1.5 bg-slate-800 p-1 rounded-lg border border-slate-700">
                        <button
                          type="button"
                          onClick={() => setActivePreviewSheetTab("customers")}
                          className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                            activePreviewSheetTab === "customers"
                              ? (detectedImportClassification.type === "USERS_PERSONNEL" ? "bg-rose-600 text-white shadow-xs font-bold" : (detectedImportClassification.type === "PRODUCTS" ? "bg-purple-600 text-white shadow-xs font-bold" : (detectedImportClassification.type === "INBOUND_LOT" ? "bg-emerald-600 text-white shadow-xs font-bold" : "bg-indigo-600 text-white shadow-xs font-bold")))
                              : "text-slate-400 hover:text-white"
                          }`}
                        >
                          {detectedImportClassification.type === "USERS_PERSONNEL" ? (
                            <UserCheck className="w-3.5 h-3.5" />
                          ) : detectedImportClassification.type === "PRODUCTS" || detectedImportClassification.type === "INBOUND_LOT" ? (
                            <Package className="w-3.5 h-3.5" />
                          ) : (
                            <Building2 className="w-3.5 h-3.5" />
                          )}
                          <span>{detectedImportClassification.sheet1Title} ({previewImportRows.length})</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActivePreviewSheetTab("contacts")}
                          className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                            activePreviewSheetTab === "contacts"
                              ? (detectedImportClassification.type === "USERS_PERSONNEL" ? "bg-slate-700 text-rose-300 shadow-xs font-bold border border-rose-500/50" : (detectedImportClassification.type === "PRODUCTS" || detectedImportClassification.type === "INBOUND_LOT" ? "bg-purple-700 text-white shadow-xs font-bold" : "bg-teal-600 text-white shadow-xs font-bold"))
                              : "text-slate-400 hover:text-white"
                          }`}
                        >
                          {detectedImportClassification.type === "USERS_PERSONNEL" ? (
                            <ShieldCheck className="w-3.5 h-3.5" />
                          ) : detectedImportClassification.type === "PRODUCTS" || detectedImportClassification.type === "INBOUND_LOT" ? (
                            <Layers className="w-3.5 h-3.5" />
                          ) : (
                            <Users className="w-3.5 h-3.5" />
                          )}
                          <span>{detectedImportClassification.sheet2Title || "Sheet 2"} ({previewContactRows.length})</span>
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 font-mono">
                        ({previewImportRows.length} dòng)
                      </span>
                    )}

                    <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1 shadow-xs ${detectedImportClassification.badgeClass}`}>
                      <Sparkles className="w-3 h-3" />
                      {detectedImportClassification.badge}
                    </span>
                  </div>

                  <button
                    type="button"
                    disabled={isImportingExcel}
                    onClick={handleConfirmImportExcel}
                    className="px-4 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white flex items-center gap-1 shadow cursor-pointer transition-all whitespace-nowrap"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {isImportingExcel
                        ? "Đang Ghi Vào Hệ Thống..."
                        : ((detectedImportClassification as any).confirmBtnText 
                            ? (detectedImportClassification as any).confirmBtnText(previewImportRows.length, previewContactRows.length)
                            : `Xác Nhận Nạp ${previewImportRows.length} Dòng Vào Hệ Thống`)}
                    </span>
                  </button>
                </div>

                {/* Table display based on activePreviewSheetTab */}
                {(() => {
                  const currentDisplayRows = (activePreviewSheetTab === "contacts" && previewContactRows.length > 0)
                    ? previewContactRows
                    : previewImportRows;

                  if (currentDisplayRows.length === 0) return null;

                  return (
                    <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl max-h-72">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400 font-bold uppercase text-[10px]">
                            {Object.keys(currentDisplayRows[0] || {}).map((k) => (
                              <th key={k} className="p-2.5 border-b border-slate-200 dark:border-slate-800 whitespace-nowrap">{k}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/40">
                          {currentDisplayRows.slice(0, 10).map((row, rIdx) => (
                            <tr key={rIdx} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                              {Object.values(row).map((v: any, cIdx) => (
                                <td key={cIdx} className="p-2 text-slate-800 dark:text-slate-300 font-mono text-[11px] whitespace-nowrap truncate max-w-[200px]">
                                  {String(v ?? "")}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== TAB 7: CẤU TRÚC ĐỊNH MỨC BỘ / KIT & PHỤ KIỆN (BOM) ==================== */}
      {subTab === "bom_kits" && (() => {
        const activeParentCode = products.some(p => p.code === selectedBomParent)
          ? selectedBomParent
          : (products.find(p => productComponents.some(c => c.parent_product_code === p.code))?.code || products[0]?.code || "HI-612");

        return (
        <div className="space-y-6 animate-fade-in">
          {/* Header Banner */}
          <div className="bg-gradient-to-r from-purple-950 via-indigo-950 to-slate-900 p-6 rounded-2xl border border-purple-500/30 shadow-lg text-white space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-purple-500/20 border border-purple-400/30 flex items-center justify-center text-purple-300 font-bold shadow-inner">
                  <Package className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-black tracking-tight text-white">
                      Cấu Trúc Định Mức Bộ / Kit &amp; Phụ Kiện Đính Kèm (BOM)
                    </h2>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-400/30 uppercase tracking-wider">
                      ISO 13485 &amp; GSP
                    </span>
                  </div>
                  <p className="text-xs text-purple-200/80 mt-0.5">
                    Quản lý các sản phẩm cấu thành bởi nhiều đơn vị độc lập (khối máy, hóa chất, phụ kiện) dưới một mã hàng chính duy nhất khi kinh doanh và xuất hóa đơn.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleOpenAddEditComponent(undefined, activeParentCode)}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white flex items-center gap-1.5 shadow-md shadow-purple-900/40 transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Thêm Thành Phần Con</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleExportBomExcel(activeParentCode)}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-purple-200 border border-purple-500/30 flex items-center gap-1.5 transition-all cursor-pointer"
                  title="Xuất định mức BOM của mã hàng đang chọn"
                >
                  <Download className="w-4 h-4" />
                  <span>Xuất BOM ({activeParentCode})</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleExportBomExcel()}
                  className="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-700 flex items-center gap-1 transition-all cursor-pointer"
                  title="Xuất toàn bộ cây cấu trúc BOM của tất cả các bộ/kit"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  <span>Toàn Bộ BOM</span>
                </button>
              </div>
            </div>

            {/* Quick Principles Guide Banner */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t border-purple-500/20 text-xs">
              <div className="p-2.5 rounded-xl bg-purple-950/50 border border-purple-800/40 flex items-start gap-2">
                <span className="text-base">📦</span>
                <div>
                  <strong className="text-purple-300 block">Tầng Thương Mại (1 Mã Chính):</strong>
                  <span className="text-purple-200/70 text-[11px]">Báo giá, hợp đồng và hóa đơn VAT chỉ dùng 1 mã chính giúp tinh gọn chứng từ cho khách hàng.</span>
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-purple-950/50 border border-purple-800/40 flex items-start gap-2">
                <span className="text-base">❄️</span>
                <div>
                  <strong className="text-purple-300 block">Đa Tầng Nhiệt Độ &amp; Vị Trí:</strong>
                  <span className="text-purple-200/70 text-[11px]">Các ống sinh phẩm (-20°C) và dung dịch ly giải (15-25°C) được kiểm soát vị trí lưu trữ độc lập theo chuẩn GSP.</span>
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-purple-950/50 border border-purple-800/40 flex items-start gap-2">
                <span className="text-base">📋</span>
                <div>
                  <strong className="text-purple-300 block">Biên Bản Bàn Giao Kỹ Thuật:</strong>
                  <span className="text-purple-200/70 text-[11px]">Khi xuất kho, tự động in kèm phiếu kiểm kê chi tiết từng Serial/Lot phụ kiện để cán bộ y tế ký nhận bàn giao.</span>
                </div>
              </div>
            </div>
          </div>

          {/* Main 2-Column Content */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Cột Trái (4 cols): Danh sách mã hàng chính */}
            <div className="lg:col-span-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wide flex items-center gap-1.5">
                  <Package className="w-4 h-4 text-purple-600" />
                  Danh Mục Sản Phẩm ({products.length})
                </h3>
                <span className="text-[10px] text-slate-400">Chọn mã để xem BOM</span>
              </div>

              {/* Bộ lọc phân loại BOM */}
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => setBomTypeFilter("kits_only")}
                  className={`py-1.5 px-1 rounded-lg text-center transition-all cursor-pointer truncate ${
                    bomTypeFilter === "kits_only"
                      ? "bg-purple-600 text-white shadow-2xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                  title="Chỉ hiển thị các sản phẩm dạng Bộ / Kit có cấu trúc linh kiện phụ kèm theo"
                >
                  🧩 Bộ/Kit ({products.reduce((acc, p) => acc + (componentsByParentMap.has(p.code) ? 1 : 0), 0)})
                </button>
                <button
                  type="button"
                  onClick={() => setBomTypeFilter("all")}
                  className={`py-1.5 px-1 rounded-lg text-center transition-all cursor-pointer truncate ${
                    bomTypeFilter === "all"
                      ? "bg-purple-600 text-white shadow-2xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                  title="Hiển thị tất cả sản phẩm trong danh mục"
                >
                  Toàn bộ ({products.length})
                </button>
                <button
                  type="button"
                  onClick={() => setBomTypeFilter("single")}
                  className={`py-1.5 px-1 rounded-lg text-center transition-all cursor-pointer truncate ${
                    bomTypeFilter === "single"
                      ? "bg-purple-600 text-white shadow-2xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                  title="Các sản phẩm đơn chiếc (chưa khai báo BOM)"
                >
                  Đơn chiếc ({products.reduce((acc, p) => acc + (!componentsByParentMap.has(p.code) ? 1 : 0), 0)})
                </button>
              </div>

              {/* Tìm kiếm */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={bomSearchQuery}
                  onChange={(e) => setBomSearchQuery(e.target.value)}
                  placeholder="Lọc mã SKU hoặc tên sản phẩm..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                />
              </div>

              {/* List of Products */}
              <div className="space-y-1.5 max-h-[560px] overflow-y-auto pr-1">
                {bomPage.items.map((p) => {
                    const comps = componentsByParentMap.get(p.code) || [];
                    const isSelected = selectedBomParent === p.code;

                    return (
                      <div
                        key={p.code}
                        onClick={() => setSelectedBomParent(p.code)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer ${
                          isSelected
                            ? "bg-purple-50 dark:bg-purple-950/60 border-purple-500 shadow-sm ring-1 ring-purple-500/20"
                            : "bg-slate-50/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <div className="min-w-0">
                            <span className="font-mono font-bold text-xs text-purple-600 dark:text-purple-400">
                              {p.code}
                            </span>
                            <h4 className="font-bold text-slate-900 dark:text-white text-xs truncate leading-snug" title={p.name}>
                              {p.name}
                            </h4>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              {p.category || "Hàng thương mại"} • ĐVT: {p.unit || "Hộp"}
                            </div>
                          </div>

                          <div className="shrink-0 flex flex-col items-end">
                            {comps.length > 0 ? (
                              <span className="px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/80 text-purple-800 dark:text-purple-200 font-bold text-[10px] flex items-center gap-1 shadow-2xs">
                                <span>🧩</span> {comps.length} món
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400">Đơn chiếc</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
              <Pager p={bomPage} unit="sản phẩm" sizes={[50, 100, 200]} />
            </div>

            {/* Cột Phải (8 cols): Chi tiết cây cấu trúc BOM của sản phẩm được chọn */}
            <div className="lg:col-span-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
              {(() => {
                const activeParentCode = products.some(p => p.code === selectedBomParent)
                  ? selectedBomParent
                  : (products.find(p => productComponents.some(c => c.parent_product_code === p.code))?.code || products[0]?.code || "HI-612");
                const currentProduct = products.find((p) => p.code === activeParentCode);
                const currentComponents = productComponents.filter((c) => c.parent_product_code === activeParentCode);
                const lotCount = currentComponents.filter((c) => c.tracking_type === "LOT").length;
                const serialCount = currentComponents.filter((c) => c.tracking_type === "SERIAL").length;
                const genericCount = currentComponents.filter((c) => c.tracking_type !== "LOT" && c.tracking_type !== "SERIAL").length;
                const uniqueTemps = Array.from(new Set(currentComponents.map((c) => c.storage_condition).filter(Boolean)));

                return (
                  <>
                    {/* Header Info of selected parent */}
                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-black text-sm text-purple-600 dark:text-purple-400">
                            [{activeParentCode}]
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300 font-bold">
                            {currentProduct?.category || "Sản phẩm y tế"}
                          </span>
                        </div>
                        <h3 className="font-extrabold text-slate-900 dark:text-white text-base mt-1">
                          {currentProduct?.name || activeParentCode}
                        </h3>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          Quy cách: <strong>{currentProduct?.specification || "Tiêu chuẩn"}</strong> • ĐVT: <strong>{currentProduct?.unit || "Bộ"}</strong> • Hãng SX: <strong>{currentProduct?.manufacturer || "ABT"}</strong>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleOpenAddEditComponent(undefined, activeParentCode)}
                        className="px-3.5 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white flex items-center gap-1.5 shadow-sm transition-all self-start sm:self-auto cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Thêm Phụ Kiện Vào Bộ</span>
                      </button>
                    </div>

                    {/* Summary Metric Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="p-3 rounded-xl bg-purple-50/60 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/40">
                        <span className="text-[10px] font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider block">
                          Đơn Vị Cấu Thành
                        </span>
                        <div className="text-xl font-black text-purple-800 dark:text-purple-200 mt-1 font-mono">
                          {currentComponents.length} <span className="text-xs font-semibold text-slate-500">thành phần</span>
                        </div>
                        <span className="text-[10px] text-slate-500 mt-0.5 block">Được quản lý đồng bộ trong 1 kit</span>
                      </div>

                      <div className="p-3 rounded-xl bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40">
                        <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider block">
                          Phương Thức Theo Dõi
                        </span>
                        <div className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-1">
                          {lotCount > 0 && <span className="text-amber-600 dark:text-amber-400 font-mono font-bold mr-1.5">{lotCount} Lô (LOT)</span>}
                          {serialCount > 0 && <span className="text-sky-600 dark:text-sky-400 font-mono font-bold mr-1.5">{serialCount} Serial (S/N)</span>}
                          {genericCount > 0 && <span className="text-slate-500 font-mono mr-1.5">{genericCount} Tiêu chuẩn</span>}
                        </div>
                        <span className="text-[10px] text-slate-500 mt-0.5 block">Truy vết chi tiết từng số định danh</span>
                      </div>

                      <div className="p-3 rounded-xl bg-cyan-50/60 dark:bg-cyan-950/30 border border-cyan-200 dark:border-cyan-800/40">
                        <span className="text-[10px] font-bold text-cyan-700 dark:text-cyan-300 uppercase tracking-wider block">
                          Phân Tầng Nhiệt Độ
                        </span>
                        <div className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-1">
                          {uniqueTemps.length > 1 ? (
                            <span className="text-cyan-600 dark:text-cyan-400 font-bold">
                              ⚡ Đa tầng ({uniqueTemps.length} dải nhiệt)
                            </span>
                          ) : uniqueTemps.length === 1 ? (
                            <span className="text-slate-700 dark:text-slate-300">{uniqueTemps[0]}</span>
                          ) : (
                            <span className="text-slate-400">Tiêu chuẩn phòng</span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-500 mt-0.5 block">Kiểm soát vị trí lưu trữ GSP</span>
                      </div>
                    </div>

                    {/* Components Table */}
                    {currentComponents.length > 0 ? (
                      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 uppercase text-[10px] font-bold border-b border-slate-200 dark:border-slate-800">
                            <tr>
                              <th className="py-2.5 px-3">STT</th>
                              <th className="py-2.5 px-3">Mã Thành Phần</th>
                              <th className="py-2.5 px-3">Tên Phụ Kiện / Thành Phần Đính Kèm</th>
                              <th className="py-2.5 px-3">Quy Cách &amp; ĐVT</th>
                              <th className="py-2.5 px-3 text-center">Định Mức / Bộ</th>
                              <th className="py-2.5 px-3">Quản Lý</th>
                              <th className="py-2.5 px-3">Bảo Quản</th>
                              <th className="py-2.5 px-3 text-center">Bắt Buộc</th>
                              <th className="py-2.5 px-3 text-center">Thao Tác</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                            {currentComponents.map((comp, idx) => (
                              <tr key={comp.id || idx} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                <td className="py-3 px-3 font-mono text-[11px] text-slate-400">{idx + 1}</td>
                                <td className="py-3 px-3 font-mono font-bold text-purple-600 dark:text-purple-400 text-xs whitespace-nowrap">
                                  {comp.component_code}
                                </td>
                                <td className="py-3 px-3">
                                  <div className="font-bold text-slate-900 dark:text-white">{comp.component_name}</div>
                                  {comp.notes && (
                                    <div className="text-[10px] text-slate-400 mt-0.5">{comp.notes}</div>
                                  )}
                                </td>
                                <td className="py-3 px-3 text-slate-500 whitespace-nowrap">
                                  {comp.specification || "—"} ({comp.unit || "Cái"})
                                </td>
                                <td className="py-3 px-3 text-center font-mono font-black text-purple-600 dark:text-purple-400">
                                  {comp.quantity_per_kit || 1}
                                </td>
                                <td className="py-3 px-3 whitespace-nowrap">
                                  {comp.tracking_type === "SERIAL" ? (
                                    <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 font-bold text-[10px]">
                                      Số Serial (S/N)
                                    </span>
                                  ) : comp.tracking_type === "LOT" ? (
                                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-bold text-[10px]">
                                      Số Lô (LOT / EXP)
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 text-[10px]">
                                      Tiêu chuẩn
                                    </span>
                                  )}
                                </td>
                                <td className="py-3 px-3 whitespace-nowrap">
                                  <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                                    {comp.storage_condition || "Chưa khai báo nhiệt độ"}
                                  </span>
                                </td>
                                <td className="py-3 px-3 text-center">
                                  {comp.is_mandatory ? (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                                      <CheckCircle2 className="w-3.5 h-3.5" /> Bắt buộc
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-slate-400">Tùy chọn</span>
                                  )}
                                </td>
                                <td className="py-3 px-3 text-center">
                                  <div className="flex items-center justify-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => handleOpenAddEditComponent(comp)}
                                      className="p-1 rounded text-slate-500 hover:text-purple-600 dark:hover:text-purple-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                                      title="Chỉnh sửa thành phần"
                                    >
                                      <BookmarkCheck className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteComponent(comp.id, comp.component_name)}
                                      className="p-1 rounded text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                                      title="Xóa thành phần khỏi bộ"
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
                    ) : (
                      <div className="p-8 text-center rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800 space-y-3 bg-slate-50/50 dark:bg-slate-900/40">
                        <div className="w-12 h-12 rounded-2xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center mx-auto">
                          <Package className="w-6 h-6" />
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-800 dark:text-white text-sm">
                            Chưa có định mức thành phần cho sản phẩm [{activeParentCode}]
                          </h4>
                          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                            Nếu sản phẩm này là trọn bộ/kit hoặc hệ thống máy móc được cấu thành từ nhiều đơn vị độc lập, hãy thêm các linh kiện con vào đây.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleOpenAddEditComponent(undefined, activeParentCode)}
                          className="px-4 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Thiết Lập Thành Phần Cho Sản Phẩm Này</span>
                        </button>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
          </div>
        );
      })()}

      {/* TAB 8: TRUNG TÂM VẬN HÀNH KHO THÔNG MINH RFID 4.0 (GS1 & TOUCHLESS WMS) */}
      {subTab === "rfid_hub" && <RfidControlHub />}

      {/* ==================== MODAL: KÍCH HOẠT THU HỒI LÔ KHẨN CẤP (Yêu cầu 14) ==================== */}
      {isRecallModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-rose-600/40 shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 bg-rose-950/60 border-b border-rose-900/60 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertOctagon className="w-5 h-5 text-rose-400" />
                <h3 className="font-bold text-white text-sm uppercase tracking-wide">
                  PHÁT LỆNH THU HỒI LÔ KHẨN CẤP (ISO 13485)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsRecallModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="p-3 bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
                <div>Lô thu hồi: <strong className="text-amber-400 font-mono">{traceResult?.lot_number || traceLotQuery}</strong></div>
                <div>Sản phẩm: <strong className="text-white">{traceResult?.inventory_items?.[0]?.product_name || "Sản phẩm được chọn"}</strong></div>
                <div>Số lượng bệnh viện bị ảnh hưởng: <strong className="text-rose-400 font-mono">{(traceResult?.distributed_customers || []).length} đơn vị</strong></div>
              </div>

              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                  Mức độ nghiêm trọng của sự cố *
                </label>
                <select
                  value={recallSeverity}
                  onChange={(e: any) => setRecallSeverity(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-xs font-bold"
                >
                  <option value="CRITICAL">🔴 CRITICAL - Nghiêm trọng (Lỗi kết quả âm tính/dương tính giả, ngừng dùng lập tức)</option>
                  <option value="HIGH">🟠 HIGH - Mức độ cao (Bao bì, điều kiện bảo quản vi phạm, rủi ro kỹ thuật)</option>
                  <option value="MEDIUM">🟡 MEDIUM - Mức độ trung bình (Quy cách, nhãn mác sai lệch, thu hồi đổi trả)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                  Lý do chi tiết &amp; Khuyến nghị xử lý *
                </label>
                <textarea
                  rows={3}
                  required
                  value={recallReason}
                  onChange={(e) => setRecallReason(e.target.value)}
                  placeholder="Nhập thông báo chính thức từ hãng hoặc phát hiện lỗi của phòng xét nghiệm..."
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-xs"
                />
              </div>

              <div className="p-3 bg-rose-950/30 border border-rose-800/40 rounded-xl">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={recallQuarantineStock}
                    onChange={(e) => setRecallQuarantineStock(e.target.checked)}
                    className="w-4 h-4 rounded text-rose-600 bg-slate-950 border-slate-700 cursor-pointer"
                  />
                  <span className="text-xs font-bold text-rose-300">
                    Tự động phong tỏa cách ly toàn bộ số lượng còn tồn trong kho
                  </span>
                </label>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2 bg-slate-50 dark:bg-slate-950/50">
              <button
                type="button"
                onClick={() => setIsRecallModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 text-slate-300"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={isSubmittingRecall}
                onClick={handleConfirmLotRecall}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white flex items-center gap-1.5 shadow-lg shadow-rose-950/50 cursor-pointer"
              >
                {isSubmittingRecall ? <RefreshCw className="w-4 h-4 animate-spin" /> : <AlertOctagon className="w-4 h-4" />}
                <span>Xác Nhận Kích Hoạt Thu Hồi</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: NHẬP KHO BẰNG FILE EXCEL ==================== */}
      {isExcelInboundModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center font-bold">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 dark:text-white text-base">
                    NHẬP KHO HÀNG HÓA BẰNG FILE EXCEL (.XLSX / .XLS)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Nạp dữ liệu nhiều mặt hàng cùng lúc, quản lý số lô, hạn dùng và tự động cập nhật tồn kho máy chủ
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsExcelInboundModalOpen(false);
                  setExcelInboundRows([]);
                  setExcelInboundFileName("");
                }}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 text-xs">
              {/* Guidance Box & Download Template Button */}
              <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <strong className="text-emerald-900 dark:text-emerald-300 block mb-0.5">
                    Tải mẫu Excel nhập kho rút gọn 7 cột chuẩn ABT:
                  </strong>
                  <p className="text-emerald-800 dark:text-emerald-400 text-[11px] leading-relaxed">
                    Chỉ cần nhập <strong>7 cột cốt lõi</strong>: <code>Mã SP</code>, <code>Số Lô (Lot)</code>, <code>Hạn dùng (Date)</code>, <code>Số lượng</code>, <code>Giá trị / Đơn giá đầu kỳ</code>, <code>Nhiệt độ bảo quản</code>, <code>Khu vực / Vị trí kho</code>. <br />
                    <span className="font-semibold text-teal-700 dark:text-teal-300">✨ Tự động hóa:</span> Các thông tin <strong>Tên SP, Quy cách, ĐVT, Nhãn hiệu</strong> được hệ thống tự động tra cứu và điền từ <strong>Bảng Mã Sản Xuất</strong> dựa trên <code>Mã SP</code>. Nếu để trống Nhiệt độ hoặc Vị trí kệ, hệ thống mặc định là <em>15–25°C (Nhiệt độ phòng - RT)</em> và <em>Chưa phân bổ kệ</em> (không tự ép -20°C hay Kệ A01).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadInboundTemplate}
                  className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Tải Mẫu Rút Gọn (7 Cột)</span>
                </button>
              </div>

              {/* Upload Dropzone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDraggingInboundExcel(true);
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDraggingInboundExcel(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDraggingInboundExcel(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDraggingInboundExcel(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) {
                    processInboundExcelFile(file);
                  }
                }}
                onClick={() => excelFileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer select-none ${
                  isDraggingInboundExcel
                    ? "border-emerald-400 bg-emerald-500/20 dark:bg-emerald-950/60 ring-4 ring-emerald-500/30 scale-[1.01]"
                    : "border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/50 hover:border-emerald-400 dark:hover:border-emerald-600 hover:bg-slate-100/60 dark:hover:bg-slate-900/40"
                }`}
              >
                <input
                  type="file"
                  ref={excelFileInputRef}
                  accept=".xlsx, .xls, .csv"
                  onChange={handleExcelInboundUpload}
                  className="hidden"
                />
                <FileSpreadsheet
                  className={`w-10 h-10 mx-auto mb-2 transition-transform duration-200 ${
                    isDraggingInboundExcel
                      ? "text-emerald-400 scale-125 animate-bounce"
                      : "text-emerald-600 dark:text-emerald-400"
                  }`}
                />
                <p className="font-bold text-slate-800 dark:text-white mb-1">
                  {isDraggingInboundExcel
                    ? "👉 Thả file Excel vào đây để tạo phiếu nhập!"
                    : excelInboundFileName
                    ? `✅ Đã chọn: ${excelInboundFileName}`
                    : "Nhấp để chọn file Excel phiếu nhập hoặc kéo thả vào đây"}
                </p>
                <p className="text-[11px] text-slate-500 mb-3">Hỗ trợ các file định dạng .xlsx, .xls</p>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    excelFileInputRef.current?.click();
                  }}
                  className="px-4 py-2 rounded-xl font-bold bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs shadow-xs cursor-pointer"
                >
                  {excelInboundFileName ? "Chọn File Khác..." : "Chọn File Excel Nhập Kho..."}
                </button>
              </div>

              {/* Inbound Header Details Form */}
              <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                <span className="font-bold text-slate-800 dark:text-white block uppercase tracking-wider text-[11px]">
                  Thông tin chứng từ nhập kho
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-600 dark:text-slate-400 font-bold mb-1">Nhà cung cấp / Đơn vị giao *</label>
                    <input
                      type="text"
                      value={excelInboundDetails.supplier_name}
                      onChange={(e) => setExcelInboundDetails({ ...excelInboundDetails, supplier_name: e.target.value })}
                      className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 dark:text-slate-400 font-bold mb-1">Mã đơn mua hàng (PO)</label>
                    <input
                      type="text"
                      value={excelInboundDetails.reference_code}
                      onChange={(e) => setExcelInboundDetails({ ...excelInboundDetails, reference_code: e.target.value })}
                      placeholder="PO-2026-..."
                      className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 dark:text-slate-400 font-bold mb-1">Số Hóa Đơn VAT</label>
                    <input
                      type="text"
                      value={excelInboundDetails.vat_invoice_no}
                      onChange={(e) => setExcelInboundDetails({ ...excelInboundDetails, vat_invoice_no: e.target.value })}
                      placeholder="HD-2026-..."
                      className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-600 dark:text-slate-400 font-bold mb-1">Lý do nhập kho</label>
                    <select
                      value={excelInboundDetails.inbound_reason}
                      onChange={(e) => setExcelInboundDetails({ ...excelInboundDetails, inbound_reason: e.target.value })}
                      className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold"
                    >
                      <option value="Nhập mua hàng theo PO từ Nhà cung cấp">Nhập mua hàng theo PO từ NCC</option>
                      <option value="Nhập hàng từ xưởng sản xuất ABT">Nhập hàng từ xưởng sản xuất ABT</option>
                      <option value="Nhập trả lại từ khách hàng">Nhập trả lại từ khách hàng</option>
                      <option value="Nhập điều chuyển giữa các kho">Nhập điều chuyển giữa các kho</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-600 dark:text-slate-400 font-bold mb-1">Kho tiếp nhận *</label>
                    <select
                      value={excelInboundDetails.warehouse_name}
                      onChange={(e) => setExcelInboundDetails({ ...excelInboundDetails, warehouse_name: e.target.value })}
                      className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold"
                    >
                      <option value="Kho Trung Tâm">Kho Trung Tâm</option>
                      <option value="Kho Lạnh Âm Sâu -20°C (Khu A)">Kho Lạnh Âm Sâu -20°C (Khu A)</option>
                      <option value="Kho Mát 2-8°C (Khu B)">Kho Mát 2-8°C (Khu B)</option>
                      <option value="Kho Chi Nhánh Hà Nội">Kho Chi Nhánh Hà Nội</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-600 dark:text-slate-400 font-bold mb-1">Thủ kho tiếp nhận *</label>
                    <input
                      type="text"
                      value={excelInboundDetails.performed_by}
                      onChange={(e) => setExcelInboundDetails({ ...excelInboundDetails, performed_by: e.target.value })}
                      className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium"
                    />
                  </div>
                </div>
              </div>

              {/* Table Preview of Uploaded Items */}
              {excelInboundRows.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="font-bold text-slate-900 dark:text-white">
                      Bảng kê hàng hóa từ Excel ({excelSummary.count} mặt hàng hợp lệ):
                    </span>
                    <div className="flex items-center gap-3 text-[11px] font-bold">
                      <span className="text-slate-600 dark:text-slate-400">
                        Tổng SL: <strong className="text-slate-900 dark:text-white font-mono">{excelSummary.totalQty}</strong>
                      </span>
                      {excelSummary.totalAmount > 0 && (
                        <span className="text-emerald-600 dark:text-emerald-400 font-mono">
                          Tổng tiền: {formatCurrency(excelSummary.totalAmount)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="max-h-64 overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-xl">
                    <table className="w-full text-left text-[11px] border-collapse whitespace-nowrap">
                      <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 sticky top-0 font-bold">
                        <tr>
                          <th className="py-2 px-3">#</th>
                          <th className="py-2 px-3">Mã SP (*)</th>
                          <th className="py-2 px-3">Tên SP (Tự động tra cứu)</th>
                          <th className="py-2 px-3">Quy Cách &amp; ĐVT</th>
                          <th className="py-2 px-3">Nhãn Hiệu</th>
                          <th className="py-2 px-3">Số Lô (Lot)</th>
                          <th className="py-2 px-3">Hạn Dùng (Date)</th>
                          <th className="py-2 px-3 text-right">Số Lượng (*)</th>
                          <th className="py-2 px-3 text-right">Đơn Giá Đầu Kỳ</th>
                          <th className="py-2 px-3 text-right">Thành Tiền</th>
                          <th className="py-2 px-3">Nhiệt Độ Bảo Quản</th>
                          <th className="py-2 px-3">Khu Vực / Vị Trí Kho</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                        {excelInboundRows.map((r, idx) => (
                          <tr key={idx} className={r.isValid ? "hover:bg-slate-50 dark:hover:bg-slate-800/50" : "bg-rose-50 dark:bg-rose-950/30"}>
                            <td className="py-1.5 px-3 font-mono">{idx + 1}</td>
                            <td className="py-1.5 px-3 font-mono font-bold text-slate-900 dark:text-white">{r.product_code}</td>
                            <td className="py-1.5 px-3 font-bold">
                              <div className="flex items-center gap-1.5">
                                <span>{r.product_name}</span>
                                {r.isAutoLookedUp && (
                                  <span className="px-1.5 py-0.2 rounded bg-teal-100 dark:bg-teal-950/70 text-teal-700 dark:text-teal-300 text-[9px] font-bold">
                                    Auto-Lookup
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-1.5 px-3 text-slate-500">{r.specification || "—"} ({r.unit || "Hộp"})</td>
                            <td className="py-1.5 px-3 text-indigo-600 dark:text-indigo-400 font-semibold">{r.manufacturer || "—"}</td>
                            <td className="py-1.5 px-3 font-mono text-orange-500">{r.lot_number || "—"}</td>
                            <td className="py-1.5 px-3 font-mono text-emerald-500">{r.expiry_date || "—"}</td>
                            <td className="py-1.5 px-3 text-right font-mono font-black text-emerald-600 dark:text-emerald-400">{r.quantity}</td>
                            <td className="py-1.5 px-3 text-right font-mono text-slate-700 dark:text-slate-300">{r.unit_price > 0 ? formatCurrency(r.unit_price) : "0 đ"}</td>
                            <td className="py-1.5 px-3 text-right font-mono font-bold text-teal-600 dark:text-teal-400">{r.total_amount > 0 ? formatCurrency(r.total_amount) : "0 đ"}</td>
                            <td className="py-1.5 px-3 text-sky-600 dark:text-sky-400 text-[10px] font-semibold">{r.storage_condition || "15–25°C (Nhiệt độ phòng - RT)"}</td>
                            <td className="py-1.5 px-3 text-slate-700 dark:text-slate-300">{r.shelf_position || "Chưa phân bổ kệ"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2 bg-slate-50 dark:bg-slate-900/80">
              <button
                type="button"
                onClick={() => {
                  setIsExcelInboundModalOpen(false);
                  setExcelInboundRows([]);
                  setExcelInboundFileName("");
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Hủy Bỏ
              </button>
              <button
                type="button"
                disabled={excelSummary.count === 0 || isSubmittingExcelInbound}
                onClick={handleConfirmExcelInbound}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 shadow-md shadow-emerald-600/30 flex items-center gap-1.5"
              >
                {isSubmittingExcelInbound ? (
                  <span>Đang nhập kho...</span>
                ) : (
                  <span>Xác Nhận Nhập Kho ({excelSummary.count} mặt hàng)</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL INBOUND ĐẦY ĐỦ THÔNG TIN SẢN PHẨM */}
      {isInboundModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-5xl w-full my-auto flex flex-col max-h-[92vh] overflow-hidden animate-fade-in">
            
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/60">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold shadow-xs">
                  <ArrowDownLeft className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
                    Lập Phiếu Nhập Kho Sản Phẩm & Sinh Phẩm (Inbound Receipt)
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 font-mono font-bold">
                      {inboundForm.transaction_code}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Ghi nhận đầy đủ thông tin: Số Lô (LOT), Hạn dùng (EXP), Quy cách, Điều kiện bảo quản và Kiểm tra QC
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsInboundModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body - Scrollable */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-6 text-xs flex-1">
              
              {/* PHẦN 1: THÔNG TIN CHUNG CHỨNG TỪ */}
              <div className="bg-slate-50/80 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
                  <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 uppercase text-[11px] tracking-wide">
                    <FileText className="w-4 h-4 text-emerald-600" />
                    1. Thông Tin Chứng Từ & Tiếp Nhận
                  </span>
                  <span className="text-[11px] text-slate-500 font-mono">Ngày lập: {inboundForm.date}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Mã Phiếu Nhập (PNK) *</label>
                    <input
                      type="text"
                      value={inboundForm.transaction_code}
                      onChange={(e) => setInboundForm({ ...inboundForm, transaction_code: e.target.value })}
                      className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Ngày Nhập Kho *</label>
                    <DateInputVN
                      value={inboundForm.date}
                      onChange={(e) => setInboundForm({ ...inboundForm, date: e.target.value })}
                      className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Loại Hình / Lý Do Nhập</label>
                    <select
                      value={inboundForm.inbound_type}
                      onChange={(e) => setInboundForm({ ...inboundForm, inbound_type: e.target.value })}
                      className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold"
                    >
                      <option value="Nhập mua hàng theo Đơn PO từ NCC">Nhập mua hàng theo PO từ NCC</option>
                      <option value="Nhập khẩu ủy thác / Trực tiếp qua Hải Quan">Nhập khẩu trực tiếp / Thông quan Hải quan</option>
                      <option value="Nhập điều chuyển từ kho chi nhánh khác">Nhập điều chuyển từ kho chi nhánh</option>
                      <option value="Nhập trả hàng bảo hành / Thu hồi máy Demo">Nhập trả hàng bảo hành / Máy Demo</option>
                      <option value="Nhập kiểm kê bổ sung tồn kho">Nhập kiểm kê bổ sung tồn kho</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Mã Đơn Đặt Hàng (PO) Tham Chiếu</label>
                    <input
                      type="text"
                      value={inboundForm.reference_code}
                      onChange={(e) => setInboundForm({ ...inboundForm, reference_code: e.target.value })}
                      placeholder="VD: PO-2026-001 hoặc PO-2026-042"
                      className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Số Hóa Đơn VAT / Tờ Khai Hải Quan</label>
                    <input
                      type="text"
                      value={inboundForm.vat_invoice_no}
                      onChange={(e) => setInboundForm({ ...inboundForm, vat_invoice_no: e.target.value })}
                      placeholder="VD: HD-2026-0412 / TK-109283"
                      className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Nhà Cung Cấp / Nguồn Hàng</label>
                    <input
                      type="text"
                      value={inboundForm.supplier_name}
                      onChange={(e) => setInboundForm({ ...inboundForm, supplier_name: e.target.value })}
                      placeholder="Tên nhà cung cấp hoặc xưởng sản xuất"
                      className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Kho Tiếp Nhận *</label>
                    <select
                      value={inboundForm.warehouse_name}
                      onChange={(e) => setInboundForm({ ...inboundForm, warehouse_name: e.target.value })}
                      className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold"
                    >
                      <option value="Kho Trung Tâm">Kho Trung Tâm</option>
                      <option value="Kho Lạnh Âm Sâu -20°C (Khu A)">Kho Lạnh Âm Sâu -20°C (Khu A)</option>
                      <option value="Kho Mát 2-8°C (Khu B)">Kho Mát 2-8°C (Khu B)</option>
                      <option value="Kho Thiết Bị & Demo (Khu C)">Kho Thiết Bị & Demo (Khu C)</option>
                      <option value="Kho Chi Nhánh Hà Nội">Kho Chi Nhánh Hà Nội</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Thủ Kho / Người Tiếp Nhận *</label>
                    <input
                      type="text"
                      value={inboundForm.performed_by}
                      onChange={(e) => setInboundForm({ ...inboundForm, performed_by: e.target.value })}
                      className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Đơn Vị Vận Chuyển / Giao Hàng</label>
                    <input
                      type="text"
                      value={inboundForm.shipping_unit}
                      onChange={(e) => setInboundForm({ ...inboundForm, shipping_unit: e.target.value })}
                      placeholder="Xe tải lạnh, Viettel Post, Giao trực tiếp..."
                      className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                    />
                  </div>
                </div>
              </div>

              {/* PHẦN 2: DANH SÁCH MẶT HÀNG NHẬP KHO CHI TIẾT */}
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-white uppercase text-[11px] tracking-wide flex items-center gap-1.5">
                      <Package className="w-4 h-4 text-emerald-600" />
                      2. Danh Sách Sản Phẩm Nhập Kho ({inboundForm.items.length} mặt hàng)
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Bao gồm đầy đủ thông tin: Mã hàng, Số Lô (LOT), Hạn dùng (EXP), Đơn giá, Vị trí lưu kho và Kiểm tra QC
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddInboundItem}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ Thêm Sản Phẩm Nhập</span>
                  </button>
                </div>

                <div className="space-y-3">
                  {inboundForm.items.map((item: any, idx: number) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/70 shadow-xs space-y-3 hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors"
                    >
                      <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-700/60">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-lg bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-bold text-xs">
                            {idx + 1}
                          </span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {item.product_code ? `[${item.product_code}] ${item.product_name || "Mặt hàng mới"}` : "Mặt hàng mới"}
                          </span>
                        </div>
                        {inboundForm.items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveInboundItem(idx)}
                            className="text-rose-500 hover:text-rose-700 dark:hover:text-rose-400 p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40"
                            title="Xóa dòng hàng này"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      {/* Line 1: Mã hàng, Tên hàng, Quy cách, ĐVT */}
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                        <div className="sm:col-span-4">
                          <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                            Chọn Từ Danh Mục Hoặc Nhập Mã *
                          </label>
                          <div className="flex gap-1.5">
                            <select
                              value={products.some((p) => p.code === item.product_code) ? item.product_code : "__custom__"}
                              onChange={(e) => {
                                if (e.target.value === "__custom__") {
                                  handleInboundItemChange(idx, "product_code", "");
                                } else {
                                  handleInboundItemChange(idx, "product_code", e.target.value);
                                }
                              }}
                              className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono text-xs font-semibold"
                            >
                              <option value="__custom__">-- Tự nhập mã mới --</option>
                              {products.map((p) => (
                                <option key={p.code} value={p.code}>
                                  {p.code} - {p.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="sm:col-span-4">
                          <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                            Mã Hàng & Tên Sản Phẩm *
                          </label>
                          <div className="grid grid-cols-3 gap-1">
                            <input
                              type="text"
                              value={item.product_code}
                              onChange={(e) => handleInboundItemChange(idx, "product_code", e.target.value)}
                              placeholder="Mã SP"
                              className="col-span-1 p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono font-bold text-xs"
                            />
                            <input
                              type="text"
                              value={item.product_name}
                              onChange={(e) => handleInboundItemChange(idx, "product_name", e.target.value)}
                              placeholder="Tên sản phẩm chi tiết"
                              className="col-span-2 p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold text-xs"
                            />
                          </div>
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                            Quy Cách Đóng Gói
                          </label>
                          <input
                            type="text"
                            value={item.specification || ""}
                            onChange={(e) => handleInboundItemChange(idx, "specification", e.target.value)}
                            placeholder="50 tests/kit..."
                            className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                            Đơn Vị Tính (ĐVT)
                          </label>
                          <input
                            type="text"
                            value={item.unit || "Hộp"}
                            onChange={(e) => handleInboundItemChange(idx, "unit", e.target.value)}
                            placeholder="Hộp, Kit, Chai..."
                            className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold text-xs"
                          />
                        </div>
                      </div>

                      {/* On-The-Fly Master Data Product Creation (Requirement 2) */}
                      {(!products.some((p) => p.code === item.product_code) || item.is_new_master_product) && (
                        <div className="p-3 bg-emerald-50/70 dark:bg-emerald-950/40 rounded-xl border border-emerald-200 dark:border-emerald-800/80 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5 uppercase">
                              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                              Tự Động Đăng Ký Sản Phẩm Mới Vào Master Data Kinh Doanh (Req 2)
                            </span>
                            <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-mono font-bold bg-emerald-100 dark:bg-emerald-900/60 px-2 py-0.5 rounded">
                              Auto-Sync Master Data
                            </span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                            <div>
                              <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-0.5">Nhóm Ngành Hàng *</label>
                              <select
                                value={item.category || "Kít Real-time PCR"}
                                onChange={(e) => handleInboundItemChange(idx, "category", e.target.value)}
                                className="w-full p-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold text-xs"
                              >
                                <option value="Kít Real-time PCR">Kít Real-time PCR (TopSPEC)</option>
                                <option value="Kít Tách Chiết">Kít Tách Chiết Nucleic Acid</option>
                                <option value="Thiết Bị Y Tế & Máy Phân Tích">Thiết Bị Y Tế & Máy Phân Tích (Bioer)</option>
                                <option value="Vật Tư Tiêu Hao Plasticware">Vật Tư Tiêu Hao Plasticware (Biologix)</option>
                                <option value="Hóa Chất & Dung Dịch">Hóa Chất & Dung Dịch Sinh Học</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-0.5">Hãng Sản Xuất (Brand) *</label>
                              <input
                                type="text"
                                value={item.manufacturer || "TopSPEC"}
                                onChange={(e) => handleInboundItemChange(idx, "manufacturer", e.target.value)}
                                placeholder="TopSPEC, Bioer, Biologix..."
                                className="w-full p-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold text-xs"
                              >
                              </input>
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-0.5">Giá Niêm Yết Bán Dự Kiến (VNĐ)</label>
                              <input
                                type="number"
                                value={item.standard_price ? item.standard_price : ""}
                                onChange={(e) => handleInboundItemChange(idx, "standard_price", parseInt(e.target.value) || 0)}
                                placeholder="Để trống nếu chờ Quản lý duyệt giá"
                                className="w-full p-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 font-mono font-bold text-xs"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Line 2: Số Lô (LOT), Hạn dùng (EXP), Ngày SX (MFG), Số lượng, Đơn giá, Thành tiền */}
                      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 bg-slate-50/60 dark:bg-slate-900/40 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                            Số Lô (LOT / Batch) *
                          </label>
                          <input
                            type="text"
                            value={item.lot_number || ""}
                            onChange={(e) => handleInboundItemChange(idx, "lot_number", e.target.value)}
                            placeholder="LOT-2026-..."
                            className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono font-bold text-xs text-orange-600 dark:text-orange-400"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                            Hạn Sử Dụng (EXP) *
                          </label>
                          <DateInputVN
                            value={item.expiry_date || ""}
                            onChange={(e) => handleInboundItemChange(idx, "expiry_date", e.target.value)}
                            className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono font-bold text-xs text-emerald-600 dark:text-emerald-400"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                            Ngày Sản Xuất (MFG)
                          </label>
                          <DateInputVN
                            value={item.manufacture_date || ""}
                            onChange={(e) => handleInboundItemChange(idx, "manufacture_date", e.target.value)}
                            className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono text-xs"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                            Số Lượng Nhập *
                          </label>
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => handleInboundItemChange(idx, "quantity", Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono font-black text-xs text-emerald-600 dark:text-emerald-400"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                            Đơn Giá Nhập (VNĐ)
                          </label>
                          <input
                            type="number"
                            value={item.unit_price || 0}
                            onChange={(e) => handleInboundItemChange(idx, "unit_price", Math.max(0, parseInt(e.target.value) || 0))}
                            className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono text-xs font-semibold"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                            Thành Tiền (VNĐ)
                          </label>
                          <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold text-xs truncate">
                            {formatCurrency((Number(item.quantity) || 0) * (Number(item.unit_price) || 0))}
                          </div>
                        </div>
                      </div>

                      {/* Line 3: Điều kiện bảo quản, Vị trí lưu kho, Tình trạng QC */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1">
                            <ThermometerSnowflake className="w-3.5 h-3.5 text-sky-500" />
                            Điều Kiện Nhiệt Độ Bảo Quản
                          </label>
                          <select
                            value={item.storage_condition || ""}
                            onChange={(e) => handleInboundItemChange(idx, "storage_condition", e.target.value)}
                            className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium text-xs"
                          >
                            <option value="">-- Chưa khai báo nhiệt độ --</option>
                            <option value="-20°C (Lạnh âm sâu - Sinh phẩm, Enzyme)">-20°C (Lạnh âm sâu - Sinh phẩm, Enzyme qPCR)</option>
                            <option value="2-8°C (Kho mát - Hóa chất, Kháng thể)">2-8°C (Kho mát - Hóa chất, Kháng thể, Test nhanh)</option>
                            <option value="15-25°C (Nhiệt độ phòng - Vật tư, Thiết bị)">15-25°C (Nhiệt độ phòng - Vật tư tiêu hao, Thiết bị)</option>
                            <option value="-80°C (Âm siêu sâu - Mẫu chuẩn)">-80°C (Âm siêu sâu - Mẫu chuẩn sinh học)</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-orange-500" />
                            Vị Trí Tủ / Kệ Lưu Trữ Chi Tiết
                          </label>
                          <input
                            type="text"
                            value={item.shelf_position || ""}
                            onChange={(e) => handleInboundItemChange(idx, "shelf_position", e.target.value)}
                            placeholder="VD: Tủ lạnh -20°C (Kệ A1), Kệ K02..."
                            className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs font-semibold"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                            Kiểm Nhận / Tình Trạng QC
                          </label>
                          <select
                            value={item.qc_status || "Đạt chuẩn 100% (Nguyên niêm phong & COA)"}
                            onChange={(e) => handleInboundItemChange(idx, "qc_status", e.target.value)}
                            className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium text-xs"
                          >
                            <option value="Đạt chuẩn 100% (Nguyên niêm phong & COA)">Đạt chuẩn 100% (Nguyên niêm phong & COA)</option>
                            <option value="Đạt chuẩn - Chờ bổ sung COA từ NCC">Đạt chuẩn - Chờ bổ sung COA từ NCC</option>
                            <option value="Bao bì xước nhẹ, niêm phong nguyên vẹn">Bao bì xước nhẹ, niêm phong nguyên vẹn</option>
                            <option value="Cảnh báo chênh lệch nhiệt độ vận chuyển">Cảnh báo chênh lệch nhiệt độ vận chuyển</option>
                          </select>
                        </div>
                      </div>

                      {/* Line 4: Cấu trúc thành phần con / phụ kiện đính kèm (BOM & Component Tracking) */}
                      {(() => {
                        const matchedComps = productComponents.filter((c) => c.parent_product_code === item.product_code);
                        if (matchedComps.length === 0) return null;
                        const isExpanded = expandedInboundComponents[idx] !== false;
                        const curItemComps = item.components && item.components.length > 0 ? item.components : matchedComps;

                        return (
                          <div className="pt-2 border-t border-purple-100 dark:border-purple-900/40">
                            <div className="p-3 rounded-xl bg-purple-50/70 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/60 space-y-2.5">
                              <div className="flex items-center justify-between flex-wrap gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="px-2 py-0.5 rounded-full bg-purple-200 dark:bg-purple-900 text-purple-800 dark:text-purple-200 font-bold text-[10px] flex items-center gap-1 shadow-2xs">
                                    <span>🧩</span> HÀNG CẤU THÀNH THEO BỘ ({matchedComps.length} THÀNH PHẦN ĐỘC LẬP)
                                  </span>
                                  <span className="text-[11px] text-slate-600 dark:text-slate-400">
                                    Quản lý Lô/Hạn dùng hoặc Serial (S/N) và điều kiện bảo quản độc lập cho từng phụ kiện
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setExpandedInboundComponents((prev) => ({ ...prev, [idx]: !isExpanded }))}
                                  className="text-xs font-bold text-purple-700 dark:text-purple-300 hover:text-purple-900 dark:hover:text-purple-100 flex items-center gap-1 underline underline-offset-2 cursor-pointer"
                                >
                                  {isExpanded ? "▲ Thu gọn phụ kiện" : `▼ Chi tiết ${matchedComps.length} phụ kiện đính kèm`}
                                </button>
                              </div>

                              {isExpanded && (
                                <div className="overflow-x-auto rounded-lg border border-purple-200 dark:border-purple-800/50 bg-white dark:bg-slate-900 shadow-2xs">
                                  <table className="w-full text-left text-[11px]">
                                    <thead className="bg-purple-100/70 dark:bg-purple-900/40 text-purple-900 dark:text-purple-200 font-bold uppercase text-[10px]">
                                      <tr>
                                        <th className="py-2 px-2.5">Mã TP</th>
                                        <th className="py-2 px-2.5">Tên Thành Phần / Phụ Kiện Đính Kèm</th>
                                        <th className="py-2 px-2.5 text-center">Định Mức</th>
                                        <th className="py-2 px-2.5">Quản Lý</th>
                                        <th className="py-2 px-2.5">Số Lô (LOT) / Serial (S/N)</th>
                                        <th className="py-2 px-2.5">Hạn Dùng (EXP)</th>
                                        <th className="py-2 px-2.5">Nhiệt Độ Bảo Quản</th>
                                        <th className="py-2 px-2.5">Tình Trạng QC</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-purple-100 dark:divide-purple-800/30">
                                      {curItemComps.map((comp: any, cIdx: number) => {
                                        return (
                                          <tr key={cIdx} className="hover:bg-purple-50/40 dark:hover:bg-purple-950/20">
                                            <td className="py-2 px-2.5 font-mono text-[10px] text-purple-700 dark:text-purple-300 font-bold whitespace-nowrap">
                                              {comp.component_code}
                                            </td>
                                            <td className="py-2 px-2.5">
                                              <div className="font-bold text-slate-800 dark:text-slate-200">{comp.component_name}</div>
                                              {comp.specification && (
                                                <div className="text-[10px] text-slate-400">{comp.specification}</div>
                                              )}
                                            </td>
                                            <td className="py-2 px-2.5 text-center font-mono font-bold text-slate-700 dark:text-slate-300">
                                              {comp.quantity_per_kit || 1} {comp.unit || "Cái"}
                                            </td>
                                            <td className="py-2 px-2.5 whitespace-nowrap">
                                              {comp.tracking_type === "SERIAL" ? (
                                                <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 font-bold text-[9px]">
                                                  Serial (S/N)
                                                </span>
                                              ) : comp.tracking_type === "LOT" ? (
                                                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-bold text-[9px]">
                                                  Số Lô (LOT)
                                                </span>
                                              ) : (
                                                <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 text-[9px]">
                                                  Tiêu chuẩn
                                                </span>
                                              )}
                                            </td>
                                            <td className="py-2 px-2.5 min-w-[130px]">
                                              <input
                                                type="text"
                                                value={comp.serial_or_lot || comp.lot_number || comp.serial_number || ""}
                                                onChange={(e) => {
                                                  const val = e.target.value;
                                                  if (comp.tracking_type === "SERIAL") {
                                                    handleInboundComponentChange(idx, cIdx, "serial_number", val);
                                                  } else {
                                                    handleInboundComponentChange(idx, cIdx, "lot_number", val);
                                                  }
                                                  handleInboundComponentChange(idx, cIdx, "serial_or_lot", val);
                                                }}
                                                placeholder={comp.tracking_type === "SERIAL" ? "S/N: 2026-..." : "LOT-..."}
                                                className="w-full p-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold text-xs text-orange-600 dark:text-orange-400"
                                              />
                                            </td>
                                            <td className="py-2 px-2.5 min-w-[120px]">
                                              {comp.tracking_type === "LOT" ? (
                                                <DateInputVN
                                                  value={comp.expiry_date || ""}
                                                  onChange={(e) => handleInboundComponentChange(idx, cIdx, "expiry_date", e.target.value)}
                                                  className="w-full p-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs text-emerald-600 dark:text-emerald-400 font-semibold"
                                                />
                                              ) : (
                                                <span className="text-[10px] text-slate-400 font-mono">Bảo hành 24T</span>
                                              )}
                                            </td>
                                            <td className="py-2 px-2.5 text-[10px] whitespace-nowrap">
                                              <span className="text-slate-600 dark:text-slate-300 font-medium">
                                                {comp.storage_condition || "15-25°C"}
                                              </span>
                                            </td>
                                            <td className="py-2 px-2.5 min-w-[110px]">
                                              <select
                                                value={comp.qc_status || "Đạt chuẩn 100%"}
                                                onChange={(e) => handleInboundComponentChange(idx, cIdx, "qc_status", e.target.value)}
                                                className="w-full p-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[10px] text-slate-800 dark:text-slate-200"
                                              >
                                                <option value="Đạt chuẩn 100%">Đạt chuẩn 100%</option>
                                                <option value="Chờ QC kiểm nghiệm">Chờ QC kiểm nghiệm</option>
                                                <option value="Cách ly tạm thời">Cách ly tạm thời</option>
                                              </select>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              </div>

              {/* PHẦN 3: GHI CHÚ CHUNG VÀ TÓM TẮT PHIẾU */}
              <div className="bg-slate-50/80 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
                  <span className="font-bold text-slate-800 dark:text-slate-200 uppercase text-[11px] tracking-wide">
                    3. Ghi Chú & Tóm Tắt Phiếu Nhập Kho
                  </span>
                </div>
                <div>
                  <textarea
                    rows={2}
                    value={inboundForm.notes}
                    onChange={(e) => setInboundForm({ ...inboundForm, notes: e.target.value })}
                    placeholder="Ghi chú thêm về biên bản giao nhận, COA/CQ đính kèm, tình trạng nhiệt độ data logger..."
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs resize-none"
                  />
                </div>
              </div>

            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/80">
              <div className="flex items-center gap-4 text-xs font-bold w-full sm:w-auto justify-between sm:justify-start">
                <span className="text-slate-600 dark:text-slate-400">
                  Tổng mặt hàng: <strong className="text-slate-900 dark:text-white font-mono">{inboundSummary.count}</strong>
                </span>
                <span className="text-slate-600 dark:text-slate-400">
                  Tổng SL: <strong className="text-emerald-600 dark:text-emerald-400 font-mono">{inboundSummary.totalQty}</strong>
                </span>
                {inboundSummary.totalAmount > 0 && (
                  <span className="text-slate-600 dark:text-slate-400">
                    Tổng tiền: <strong className="text-emerald-600 dark:text-emerald-400 font-mono">{formatCurrency(inboundSummary.totalAmount)}</strong>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={() => setIsInboundModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Hủy Bỏ
                </button>
                <button
                  type="button"
                  disabled={isSubmittingInbound || inboundSummary.count === 0}
                  onClick={handleInboundSubmit}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 shadow-md shadow-emerald-600/30 flex items-center gap-1.5"
                >
                  {isSubmittingInbound ? (
                    <span>Đang ghi nhận...</span>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Xác Nhận Nhập Kho ({inboundSummary.count} mặt hàng)</span>
                    </>
                  )}
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* MODAL OUTBOUND */}
      {isOutboundModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-3xl w-full p-5 sm:p-6 space-y-4 my-auto max-h-[92vh] flex flex-col overflow-hidden animate-fade-in">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-orange-100 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400 flex items-center justify-center font-bold">
                  <ArrowUpRight className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">Lập Phiếu Xuất Kho &amp; Gom Hàng (Outbound Delivery)</h3>
                  <p className="text-[11px] text-slate-500">Kiểm tra tính hoàn chỉnh của bộ/kit và số Serial/Lot từng thành phần trước khi bàn giao</p>
                </div>
              </div>
              <button onClick={() => setIsOutboundModalOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs overflow-y-auto flex-1 pr-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Mã Đơn Bán Hàng (SO) / Mục Đích *</label>
                  <input
                    type="text"
                    value={outboundForm.reference_code}
                    onChange={(e) => setOutboundForm({ ...outboundForm, reference_code: e.target.value })}
                    placeholder="VD: SO-2026-088 hoặc Xuất Demo Bệnh Viện"
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Khách Hàng / Bệnh Viện Tiếp Nhận</label>
                  <input
                    type="text"
                    value={outboundForm.customer_name || ""}
                    onChange={(e) => setOutboundForm({ ...outboundForm, customer_name: e.target.value })}
                    placeholder="VD: Bệnh viện Chợ Rẫy, Viện Pasteur..."
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-8">
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Mã Hàng Chính Cần Xuất *</label>
                  <select
                    value={outboundForm.items[0]?.product_code}
                    onChange={(e) => {
                      const sel = products.find((p) => p.code === e.target.value);
                      setOutboundForm({
                        ...outboundForm,
                        items: [{ product_code: e.target.value, product_name: sel?.name || "", quantity: outboundForm.items[0]?.quantity || 1 }]
                      });
                    }}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold"
                  >
                    {products.map((p) => {
                      const compCount = (componentsByParentMap.get(p.code) || []).length;
                      return (
                        <option key={p.code} value={p.code}>
                          {p.code} - {p.name} {compCount > 0 ? `(🧩 Bộ gồm ${compCount} phụ kiện)` : ""}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="sm:col-span-4">
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Số Lượng Xuất (Bộ / Kit / Máy) *</label>
                  <input
                    type="number"
                    min="1"
                    value={outboundForm.items[0]?.quantity || 1}
                    onChange={(e) => {
                      const q = Math.max(1, parseInt(e.target.value) || 1);
                      setOutboundForm({
                        ...outboundForm,
                        items: [{ ...outboundForm.items[0], quantity: q }]
                      });
                    }}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-black text-sm text-orange-600 dark:text-orange-400"
                  />
                </div>
              </div>

              {/* BẢNG SOẠN HÀNG & PHỤ KIỆN ĐI KÈM (PICKING & PACKING CHECKLIST) */}
              {(() => {
                const curCode = outboundForm.items[0]?.product_code;
                const comps = productComponents.filter((c) => c.parent_product_code === curCode);
                const outQty = Number(outboundForm.items[0]?.quantity) || 1;

                if (comps.length === 0) return null;

                return (
                  <div className="p-3.5 rounded-xl bg-purple-50/70 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/60 space-y-2.5">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-full bg-purple-200 dark:bg-purple-900 text-purple-800 dark:text-purple-200 font-bold text-[10px] flex items-center gap-1 shadow-2xs">
                          <span>🧩</span> BẢNG SOẠN HÀNG &amp; PHỤ KIỆN ({comps.length} MÓN ĐỘC LẬP)
                        </span>
                        <span className="text-[11px] text-slate-600 dark:text-slate-400">
                          Nhặt phụ kiện theo từng vị trí kho nhiệt độ tương ứng
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleOpenHandoverChecklist}
                        className="px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-bold text-[11px] flex items-center gap-1.5 shadow-xs cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Xem &amp; In Biên Bản Bàn Giao Phụ Kiện</span>
                      </button>
                    </div>

                    <div className="overflow-x-auto rounded-lg border border-purple-200 dark:border-purple-800/50 bg-white dark:bg-slate-900 shadow-2xs">
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-purple-100/70 dark:bg-purple-900/40 text-purple-900 dark:text-purple-200 font-bold uppercase text-[10px]">
                          <tr>
                            <th className="py-2 px-2.5">STT</th>
                            <th className="py-2 px-2.5">Mã Thành Phần</th>
                            <th className="py-2 px-2.5">Tên Phụ Kiện / Thành Phần Con</th>
                            <th className="py-2 px-2.5 text-center">SL Cần Nhặt</th>
                            <th className="py-2 px-2.5">Quản Lý</th>
                            <th className="py-2 px-2.5">Vị Trí Kho &amp; Nhiệt Độ Nhặt Hàng</th>
                            <th className="py-2 px-2.5 text-center">Tình Trạng</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-purple-100 dark:divide-purple-800/30">
                          {comps.map((c, i) => (
                            <tr key={i} className="hover:bg-purple-50/40 dark:hover:bg-purple-950/20">
                              <td className="py-2 px-2.5 font-mono text-[10px] text-slate-400">{i + 1}</td>
                              <td className="py-2 px-2.5 font-mono text-[10px] text-purple-700 dark:text-purple-300 font-bold whitespace-nowrap">
                                {c.component_code}
                              </td>
                              <td className="py-2 px-2.5 font-bold text-slate-800 dark:text-slate-200">
                                {c.component_name}
                                {c.specification && <div className="text-[10px] text-slate-400 font-normal">{c.specification}</div>}
                              </td>
                              <td className="py-2 px-2.5 text-center font-mono font-black text-purple-600 dark:text-purple-400 text-xs">
                                {(Number(c.quantity_per_kit) || 1) * outQty} {c.unit || "Cái"}
                              </td>
                              <td className="py-2 px-2.5 whitespace-nowrap">
                                {c.tracking_type === "SERIAL" ? (
                                  <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 font-bold text-[9px]">
                                    Quét Serial S/N
                                  </span>
                                ) : c.tracking_type === "LOT" ? (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-bold text-[9px]">
                                    Kiểm Số Lô/EXP
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 text-[9px]">
                                    Phụ kiện chuẩn
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-2.5 text-[10px]">
                                <span className="font-semibold text-slate-700 dark:text-slate-300">{c.storage_condition || "Nhiệt độ phòng"}</span>
                              </td>
                              <td className="py-2 px-2.5 text-center">
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                                  <Check className="w-3.5 h-3.5" /> Sẵn sàng
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Ghi Chú Xuất Kho</label>
                <textarea
                  rows={2}
                  value={outboundForm.notes || ""}
                  onChange={(e) => setOutboundForm({ ...outboundForm, notes: e.target.value })}
                  placeholder="Ghi chú về đơn vị vận chuyển, nhiệt độ thùng lạnh lúc xuất, bàn giao cho ai..."
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={handleOpenHandoverChecklist}
                className="px-3.5 py-2 rounded-xl text-xs font-bold border border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/60 flex items-center gap-1.5 cursor-pointer"
              >
                <FileText className="w-4 h-4" />
                <span>Xem Biên Bản Bàn Giao</span>
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsOutboundModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={handleOutboundSubmit}
                  disabled={isSubmittingOutbound}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-orange-600 text-white hover:bg-orange-700 shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Xác Nhận Xuất Kho Đủ Bộ</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ==================== MODAL 1: TẠO PHIẾU ĐỀ XUẤT MUA HÀNG (PR) SANG PHÒNG CUNG ỨNG ==================== */}
      {isPRModalOpen && selectedPRItem && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-2xl w-full p-6 space-y-4 animate-fade-in">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
                  <ShoppingCart className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">
                    Tạo Yêu Cầu Mua Hàng Khẩn Cấp (PR)
                  </h3>
                  <p className="text-[11px] text-slate-500">Phòng ngừa rủi ro đứt gãy nguồn cung ứng tồn kho</p>
                </div>
              </div>
              <button
                onClick={() => setIsPRModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700/80 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="font-mono font-bold text-orange-600 dark:text-orange-400">{selectedPRItem.product_code}</span>
                    <h4 className="font-bold text-slate-900 dark:text-white text-sm">{selectedPRItem.product_name}</h4>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-bold text-[10px]">
                    TỒN THẤP
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-200 dark:border-slate-700 text-[11px]">
                  <div>Thực tồn: <strong className="font-mono text-slate-800 dark:text-slate-200">{selectedPRItem.quantity_on_hand}</strong></div>
                  <div>Khả dụng: <strong className="font-mono text-emerald-600">{selectedPRItem.quantity_available}</strong></div>
                  <div>Định mức min: <strong className="font-mono text-rose-600">{selectedPRItem.min_stock_level || 10}</strong></div>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Số lượng đề xuất mua thêm (*)
                </label>
                <input
                  type="number"
                  value={prFormData.requestedQty}
                  onChange={(e) => setPRFormData({ ...prFormData, requestedQty: Number(e.target.value) || 0 })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold text-sm"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Mức độ ưu tiên / Rủi ro
                </label>
                <select
                  value={prFormData.urgentLevel}
                  onChange={(e) => setPRFormData({ ...prFormData, urgentLevel: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold"
                >
                  <option value="CAO - Cần gấp phòng ngừa đứt gãy hàng cung ứng">🔴 CAO - Cần gấp phòng ngừa đứt gãy hàng cung ứng</option>
                  <option value="TRUNG BÌNH - Đặt hàng theo kế hoạch tuần">🟡 TRUNG BÌNH - Đặt hàng theo kế hoạch tuần</option>
                  <option value="BÌNH THƯỜNG - Bổ sung tồn kho định kỳ">🟢 BÌNH THƯỜNG - Bổ sung tồn kho định kỳ</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Ghi chú điều phối gửi phòng Cung Ứng
                </label>
                <textarea
                  rows={2}
                  value={prFormData.notes}
                  onChange={(e) => setPRFormData({ ...prFormData, notes: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-medium text-xs resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsPRModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              >
                Hủy Bỏ
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsPRModalOpen(false);
                  setActionNotice(
                    `✅ Đã gửi thành công Yêu Cầu Mua Hàng (PR) cho ${selectedPRItem.product_name} (SL: ${prFormData.requestedQty}) sang phòng Cung Ứng!`
                  );
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-sm flex items-center gap-1.5"
              >
                <ShoppingCart className="w-3.5 h-3.5" />
                <span>Gửi Đề Xuất Mua (PR)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL 2: TẠO PHIẾU PHỐI HỢP ĐẨY BÁN (SALES) SANG PHÒNG KINH DOANH ==================== */}
      {isPushSalesModalOpen && selectedPushItem && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-2xl w-full p-6 space-y-4 animate-fade-in">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold">
                  <Megaphone className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">
                    Phiếu Phối Hợp Xả Hàng Cận Date (FEFO)
                  </h3>
                  <p className="text-[11px] text-slate-500">Phòng ngừa rủi ro hủy sinh phẩm do quá hạn dùng</p>
                </div>
              </div>
              <button
                onClick={() => setIsPushSalesModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="bg-rose-50/50 dark:bg-rose-950/30 p-3.5 rounded-xl border border-rose-200 dark:border-rose-900/60 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="font-mono font-bold text-rose-600 dark:text-rose-400">{selectedPushItem.product_code}</span>
                    <h4 className="font-bold text-slate-900 dark:text-white text-sm">{selectedPushItem.product_name}</h4>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-rose-200 text-rose-900 dark:bg-rose-900 dark:text-rose-200 font-bold text-[10px]">
                    CÒN {selectedPushItem.days_to_expiry} NGÀY
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1 border-t border-rose-200 dark:border-rose-900/60 text-[11px]">
                  <div>Số Lô (LOT): <strong className="font-mono text-slate-800 dark:text-slate-200">{selectedPushItem.lot_number}</strong></div>
                  <div>Hạn dùng (EXP): <strong className="font-mono text-rose-600">{selectedPushItem.expiry_date}</strong></div>
                  <div>Tồn kho: <strong className="font-mono text-slate-900 dark:text-white">{selectedPushItem.quantity_on_hand} {selectedPushItem.unit || "Hộp"}</strong></div>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Chính sách giá đề xuất hỗ trợ phòng Sales (%)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={pushSalesFormData.discountPercent}
                    onChange={(e) => setPushSalesFormData({ ...pushSalesFormData, discountPercent: Number(e.target.value) || 0 })}
                    className="w-24 p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold text-sm"
                  />
                  <span className="text-slate-500 font-semibold">% Chiết khấu / Khuyến mãi để ưu tiên xả hàng nhanh</span>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Phương án điều phối ưu tiên
                </label>
                <input
                  type="text"
                  value={pushSalesFormData.priorityStrategy}
                  onChange={(e) => setPushSalesFormData({ ...pushSalesFormData, priorityStrategy: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Nội dung gửi Phòng Kinh Doanh &amp; Ứng Dụng
                </label>
                <textarea
                  rows={2}
                  value={pushSalesFormData.notes}
                  onChange={(e) => setPushSalesFormData({ ...pushSalesFormData, notes: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-medium text-xs resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsPushSalesModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              >
                Hủy Bỏ
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsPushSalesModalOpen(false);
                  setActionNotice(
                    `📢 Đã kích hoạt đề xuất xả hàng FEFO cho ${selectedPushItem.product_name} (Lô ${selectedPushItem.lot_number}) sang phòng Kinh Doanh!`
                  );
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-sm flex items-center gap-1.5"
              >
                <Megaphone className="w-3.5 h-3.5" />
                <span>Gửi Đẩy Bán (Sales)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL XEM CHI TIẾT CHỨNG TỪ XUẤT NHẬP KHO ==================== */}
      {isTxDetailModalOpen && selectedTxDetail && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-4xl w-full my-auto flex flex-col max-h-[90vh] overflow-hidden animate-fade-in">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/60">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold shadow-xs ${
                  selectedTxDetail.transaction_type === "INBOUND" 
                    ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400"
                    : "bg-orange-100 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400"
                }`}>
                  {selectedTxDetail.transaction_type === "INBOUND" ? <ArrowDownLeft className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
                    Chi Tiết Chứng Từ: <span className="font-mono text-emerald-600 dark:text-emerald-400">{selectedTxDetail.transaction_code}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                      selectedTxDetail.transaction_type === "INBOUND"
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                        : "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300"
                    }`}>
                      {selectedTxDetail.transaction_type === "INBOUND" ? "PHIẾU NHẬP KHO" : "PHIẾU XUẤT KHO"}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    Giao dịch thực hiện ngày {selectedTxDetail.date ? formatDayVN(selectedTxDetail.date) : ""} bởi {selectedTxDetail.performed_by || "Thủ kho ABT"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsTxDetailModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs flex-1">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
                <div>
                  <span className="text-[10px] text-slate-500 font-bold block uppercase">Mã PO / SO Tham Chiếu</span>
                  <strong className="font-mono text-slate-900 dark:text-white text-xs">{selectedTxDetail.reference_code || "—"}</strong>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-bold block uppercase">Kho Tiếp Nhận / Lưu Trữ</span>
                  <strong className="text-slate-900 dark:text-white text-xs">{selectedTxDetail.warehouse_name || "Kho Trung Tâm"}</strong>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-bold block uppercase">Thủ Kho / Người Thực Hiện</span>
                  <strong className="text-slate-900 dark:text-white text-xs">{selectedTxDetail.performed_by || "Thủ kho ABT"}</strong>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-bold block uppercase">Ngày Lập Chứng Từ</span>
                  <strong className="font-mono text-slate-900 dark:text-white text-xs">{selectedTxDetail.date ? formatDayVN(selectedTxDetail.date) : "—"}</strong>
                </div>
              </div>

              {selectedTxDetail.notes && (
                <div className="bg-amber-50 dark:bg-amber-950/30 p-3 rounded-xl border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 text-xs">
                  <strong className="font-bold">Ghi chú chứng từ:</strong> {selectedTxDetail.notes}
                </div>
              )}

              {/* Items Table */}
              <div className="space-y-2">
                <span className="font-bold text-slate-900 dark:text-white uppercase text-[11px] tracking-wide">
                  Danh Sách Mặt Hàng Trong Phiếu ({Array.isArray(selectedTxDetail.items) ? selectedTxDetail.items.length : 0} mặt hàng):
                </span>

                <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold">
                      <tr>
                        <th className="py-2.5 px-3">#</th>
                        <th className="py-2.5 px-3">Mã Hàng</th>
                        <th className="py-2.5 px-3">Tên Hàng Hóa</th>
                        <th className="py-2.5 px-3">Số Lô (LOT)</th>
                        <th className="py-2.5 px-3">Hạn Dùng (EXP)</th>
                        <th className="py-2.5 px-3 text-right">SL</th>
                        <th className="py-2.5 px-3">ĐVT</th>
                        <th className="py-2.5 px-3">Nhiệt Độ / Vị Trí</th>
                        <th className="py-2.5 px-3">Tình Trạng QC</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                      {(Array.isArray(selectedTxDetail.items) ? selectedTxDetail.items : []).map((it: any, idx: number) => (
                        <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-2 px-3 font-mono text-slate-400">{idx + 1}</td>
                          <td className="py-2 px-3 font-mono font-bold text-slate-900 dark:text-white">{it.product_code || it.productCode}</td>
                          <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">{it.product_name || it.name}</td>
                          <td className="py-2 px-3 font-mono text-orange-600 dark:text-orange-400 font-bold">{it.lot_number || "—"}</td>
                          <td className="py-2 px-3 font-mono text-emerald-600 dark:text-emerald-400 font-bold">{it.expiry_date || "—"}</td>
                          <td className="py-2 px-3 text-right font-mono font-black text-slate-900 dark:text-white">{it.quantity}</td>
                          <td className="py-2 px-3 text-slate-500">{it.unit || "Hộp"}</td>
                          <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                            <div>{it.storage_condition || it.storage_location || "Kho thường"}</div>
                            {it.shelf_position && <div className="text-[10px] text-slate-400 font-mono">[{it.shelf_position}]</div>}
                          </td>
                          <td className="py-2 px-3">
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-medium">
                              {it.qc_status || "Đạt chuẩn 100%"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2 bg-slate-50 dark:bg-slate-900/80">
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                <span>In Phiếu</span>
              </button>
              <button
                type="button"
                onClick={() => setIsTxDetailModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 dark:bg-slate-800 text-white hover:bg-slate-800"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: TẠO GIỮ CHỖ TỒN KHO CHO SALES THEO LÔ ==================== */}
      {isReserveModalOpen && selectedReserveItem && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-3xl w-full overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800 bg-indigo-50/50 dark:bg-indigo-950/30">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-400 flex items-center justify-center font-bold">
                  <BookmarkCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 dark:text-white text-base">
                    GIỮ CHỖ TỒN KHO THEO LÔ CHO SALES
                  </h3>
                  <p className="text-xs text-slate-500">
                    Khóa tồn khả dụng (ATP) theo số Lô thực tế để Sales an tâm chào thầu
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsReserveModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4 text-xs">
              {/* Product & Lot Info Card */}
              <div className="bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                      {selectedReserveItem.product_code}
                    </span>
                    <h4 className="font-bold text-slate-900 dark:text-white text-xs mt-0.5">
                      {selectedReserveItem.product_name}
                    </h4>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-mono text-[11px]">
                    {selectedReserveItem.unit || "Hộp"}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-200/60 dark:border-slate-700/60 font-mono text-[11px]">
                  <div>
                    <span className="text-slate-400 block text-[10px]">Số Lô (LOT):</span>
                    <strong className="text-orange-600 dark:text-orange-400">{selectedReserveItem.lot_number}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Hạn dùng (EXP):</span>
                    <strong className="text-emerald-600 dark:text-emerald-400">{selectedReserveItem.expiry_date}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Thực tồn kho:</span>
                    <strong className="text-slate-800 dark:text-slate-200">{selectedReserveItem.quantity_on_hand}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Tồn khả dụng (ATP):</span>
                    <strong className="text-emerald-600 dark:text-emerald-400 text-sm">{selectedReserveItem.quantity_available}</strong>
                  </div>
                </div>
              </div>

              {/* Form Fields */}
              <div className="space-y-3">
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                    Nhân viên Sales (NVKD) giữ hàng *
                  </label>
                  <select
                    value={reserveFormData.sales_rep_name}
                    onChange={(e) => setReserveFormData({ ...reserveFormData, sales_rep_name: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium"
                  >
                    {salesStaff.map((staff) => (
                      <option key={staff.employee_code} value={`${staff.full_name} (${staff.position})`}>
                        {staff.full_name} ({staff.position})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="relative">
                  <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1 flex items-center justify-between">
                    <span>Khách hàng mục tiêu / Dự án *</span>
                    <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-normal">
                      Click mũi tên để xem danh sách hoặc gõ tìm kiếm
                    </span>
                  </label>
                  
                  <div className="relative flex items-center">
                    <Building2 className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
                    <input
                      type="text"
                      value={reserveFormData.customer_name}
                      onFocus={() => setIsCustomerDropdownOpen(true)}
                      onChange={(e) => {
                        setReserveFormData({ ...reserveFormData, customer_name: e.target.value });
                        setIsCustomerDropdownOpen(true);
                      }}
                      placeholder="Gõ tìm nhanh hoặc bấm mũi tên để chọn..."
                      className="w-full pl-9 pr-20 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                    <div className="absolute right-2 flex items-center gap-1">
                      {reserveFormData.customer_name && (
                        <button
                          type="button"
                          onClick={() => {
                            setReserveFormData({ ...reserveFormData, customer_name: "" });
                            setIsCustomerDropdownOpen(true);
                          }}
                          className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                          title="Xóa lựa chọn"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setIsCustomerDropdownOpen(!isCustomerDropdownOpen)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                        title="Bấm để mở danh sách bệnh viện có sẵn"
                      >
                        <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isCustomerDropdownOpen ? "rotate-180 text-indigo-600" : ""}`} />
                      </button>
                    </div>
                  </div>

                  {/* Dropdown danh sách khách hàng / bệnh viện */}
                  {isCustomerDropdownOpen && (
                    <>
                      <div 
                        className="fixed inset-0 z-40" 
                        onClick={() => setIsCustomerDropdownOpen(false)} 
                      />
                      <div className="absolute left-0 right-0 top-full mt-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl z-50 max-h-56 overflow-y-auto p-1.5 space-y-1">
                        <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between border-b border-slate-100 dark:border-slate-800">
                          <span>Danh Sách Bệnh Viện &amp; Khách Hàng ({filteredCustomers.length})</span>
                          <span>Bấm để chọn</span>
                        </div>

                        {filteredCustomers.length > 0 ? (
                          filteredCustomers.map((cust: any) => (
                            <button
                              key={cust.id || cust.customer_code}
                              type="button"
                              onClick={() => {
                                setReserveFormData({ ...reserveFormData, customer_name: cust.name });
                                setIsCustomerDropdownOpen(false);
                              }}
                              className={`w-full text-left p-2.5 rounded-xl flex items-center justify-between transition-colors cursor-pointer ${
                                reserveFormData.customer_name === cust.name
                                  ? "bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-900 dark:text-indigo-200 font-bold"
                                  : "hover:bg-slate-100 dark:hover:bg-slate-800/80 text-slate-800 dark:text-slate-200"
                              }`}
                            >
                              <div>
                                <div className="font-bold flex items-center gap-1.5">
                                  <span>{cust.name}</span>
                                  {cust.customer_code && (
                                    <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 font-normal">
                                      ({cust.customer_code})
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5">
                                  {cust.classification && <span>{cust.classification}</span>}
                                  {cust.province && <span>• {cust.province}</span>}
                                </div>
                              </div>
                              {reserveFormData.customer_name === cust.name && (
                                <Check className="w-4 h-4 text-indigo-600 shrink-0" />
                              )}
                            </button>
                          ))
                        ) : (
                          <div className="p-3 text-center text-xs text-slate-500">
                            <span>Không tìm thấy trong danh mục có sẵn. Hệ thống sẽ lưu tên mới:</span>
                            <div className="mt-1 font-bold text-indigo-600">"{reserveFormData.customer_name}"</div>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {/* Phím bấm chọn nhanh khách hàng phổ biến */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-slate-400">Gợi ý chọn nhanh:</span>
                    {allAvailableCustomers.slice(0, 5).map((c: any) => (
                      <button
                        key={c.id || c.customer_code}
                        type="button"
                        onClick={() => {
                          setReserveFormData({ ...reserveFormData, customer_name: c.name });
                          setIsCustomerDropdownOpen(false);
                        }}
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-medium transition-all cursor-pointer ${
                          reserveFormData.customer_name === c.name
                            ? "bg-indigo-600 text-white font-bold shadow-xs"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-slate-700 hover:text-indigo-600"
                        }`}
                      >
                        {c.name.replace("Bệnh Viện ", "BV ").replace("Viện ", "").replace("Trung Tâm ", "TT ")}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                      Số lượng giữ (Max: {selectedReserveItem.quantity_available}) *
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={selectedReserveItem.quantity_available}
                      value={reserveFormData.quantity_reserved}
                      onChange={(e) => setReserveFormData({ ...reserveFormData, quantity_reserved: Number(e.target.value) })}
                      className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                      Hạn giữ chỗ (Hold Until TTL) *
                    </label>
                    <DateInputVN
                      value={reserveFormData.hold_until_date}
                      onChange={(e) => setReserveFormData({ ...reserveFormData, hold_until_date: e.target.value })}
                      className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium"
                    />
                  </div>
                </div>

                {/* Quick Presets for Hold Until */}
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-slate-400">Gợi ý hạn giữ:</span>
                  <button
                    type="button"
                    onClick={() => setReserveFormData({ ...reserveFormData, hold_until_date: toVNDateString(new Date(Date.now() + 3 * 86400000)) })}
                    className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium hover:bg-slate-200"
                  >
                    +3 ngày
                  </button>
                  <button
                    type="button"
                    onClick={() => setReserveFormData({ ...reserveFormData, hold_until_date: toVNDateString(new Date(Date.now() + 7 * 86400000)) })}
                    className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium hover:bg-slate-200"
                  >
                    +7 ngày
                  </button>
                  <button
                    type="button"
                    onClick={() => setReserveFormData({ ...reserveFormData, hold_until_date: toVNDateString(new Date(Date.now() + 14 * 86400000)) })}
                    className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium hover:bg-slate-200"
                  >
                    +14 ngày
                  </button>
                </div>

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                    Ghi chú / Mục đích giữ chỗ
                  </label>
                  <textarea
                    rows={2}
                    value={reserveFormData.notes}
                    onChange={(e) => setReserveFormData({ ...reserveFormData, notes: e.target.value })}
                    placeholder="Ghi chú điều kiện chào thầu, dự án hoặc lý do giữ hàng..."
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2 bg-slate-50 dark:bg-slate-900/50">
              <button
                type="button"
                onClick={() => setIsReserveModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={isSubmittingReserve}
                onClick={handleConfirmReserve}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm flex items-center gap-1.5 transition-all"
              >
                <BookmarkCheck className="w-4 h-4" />
                <span>{isSubmittingReserve ? "Đang xử lý..." : "Xác Nhận Giữ Chỗ Lô Này"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: THÊM / CHỈNH SỬA THÀNH PHẦN CON TRONG BỘ (BOM) ==================== */}
      {isComponentModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-3xl w-full my-auto overflow-hidden animate-fade-in text-xs">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800 bg-purple-50/50 dark:bg-purple-950/30">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 flex items-center justify-center font-bold">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 dark:text-white text-base">
                    {isEditingComponent ? "Cập Nhật Thành Phần Cấu Thành (BOM)" : "Thêm Thành Phần Con Vào Bộ / Kit"}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Sản phẩm cha: <strong className="font-mono text-purple-600 dark:text-purple-400">{componentFormData.parent_product_code}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsComponentModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Mã Hàng Chính (Parent SKU) *
                  </label>
                  <select
                    value={componentFormData.parent_product_code}
                    onChange={(e) => setComponentFormData({ ...componentFormData, parent_product_code: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold"
                  >
                    {products.map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.code} - {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Mã Thành Phần Con (Child SKU) *
                  </label>
                  <input
                    type="text"
                    value={componentFormData.component_code}
                    onChange={(e) => setComponentFormData({ ...componentFormData, component_code: e.target.value })}
                    placeholder="VD: HI-612 (1), HI-007.A (1)..."
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold text-purple-600 dark:text-purple-400"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Tên Thành Phần / Phụ Kiện Đính Kèm *
                </label>
                <input
                  type="text"
                  value={componentFormData.component_name}
                  onChange={(e) => setComponentFormData({ ...componentFormData, component_name: e.target.value })}
                  placeholder="VD: Ống Master Mix qPCR HPV, Khối luân nhiệt 96 giếng, Bộ nguồn UPS 2kVA..."
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Quy Cách Kỹ Thuật
                  </label>
                  <input
                    type="text"
                    value={componentFormData.specification}
                    onChange={(e) => setComponentFormData({ ...componentFormData, specification: e.target.value })}
                    placeholder="VD: 50 tests, 1.5ml nắp đỏ..."
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Đơn Vị Tính (ĐVT)
                  </label>
                  <input
                    type="text"
                    value={componentFormData.unit}
                    onChange={(e) => setComponentFormData({ ...componentFormData, unit: e.target.value })}
                    placeholder="Ống, Lọ, Chai, Thân máy, Bộ..."
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Định Mức / 1 Bộ Chính *
                  </label>
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={componentFormData.quantity_per_kit}
                    onChange={(e) => setComponentFormData({ ...componentFormData, quantity_per_kit: Number(e.target.value) || 1 })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold text-purple-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Phương Thức Quản Lý &amp; Theo Dõi *
                  </label>
                  <select
                    value={componentFormData.tracking_type}
                    onChange={(e) => setComponentFormData({ ...componentFormData, tracking_type: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold"
                  >
                    <option value="LOT">Số Lô (LOT / EXP) - Phù hợp sinh phẩm, hóa chất</option>
                    <option value="SERIAL">Số Serial (S/N Máy) - Phù hợp máy móc, khối quang, UPS</option>
                    <option value="GENERIC">Phụ kiện tiêu chuẩn - Dây cáp, đĩa nhựa, tiêu hao</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Điều Kiện Nhiệt Độ Bảo Quản *
                  </label>
                  <select
                    value={componentFormData.storage_condition}
                    onChange={(e) => setComponentFormData({ ...componentFormData, storage_condition: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-medium"
                  >
                    <option value="">-- Chưa khai báo nhiệt độ --</option>
                    <option value="-20°C (Lạnh âm sâu - Sinh phẩm, Enzyme)">-20°C (Lạnh âm sâu - Sinh phẩm, Enzyme)</option>
                    <option value="2-8°C (Kho mát - Hóa chất, Kháng thể)">2-8°C (Kho mát - Hóa chất, Hạt từ)</option>
                    <option value="15-25°C (Nhiệt độ phòng - Vật tư, Thiết bị)">15-25°C (Nhiệt độ phòng - Thiết bị, vật tư)</option>
                    <option value="-80°C (Âm siêu sâu - Mẫu chuẩn)">-80°C (Âm siêu sâu - Mẫu chuẩn)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={componentFormData.is_mandatory}
                    onChange={(e) => setComponentFormData({ ...componentFormData, is_mandatory: e.target.checked })}
                    className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 border-slate-300"
                  />
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    Thành phần bắt buộc (Bắt buộc phải có đủ để tạo thành bộ hoàn chỉnh khi xuất kho)
                  </span>
                </label>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Ghi Chú Kỹ Thuật / Lưu Ý Sử Dụng
                </label>
                <textarea
                  rows={2}
                  value={componentFormData.notes}
                  onChange={(e) => setComponentFormData({ ...componentFormData, notes: e.target.value })}
                  placeholder="Ghi chú về kiểm định, dải bước sóng, rã đông tránh ánh sáng..."
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2 bg-slate-50 dark:bg-slate-900/50">
              <button
                type="button"
                onClick={() => setIsComponentModalOpen(false)}
                className="px-4 py-2 rounded-xl font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={isSubmittingComponent}
                onClick={handleSaveComponent}
                className="px-5 py-2 rounded-xl font-bold bg-purple-600 hover:bg-purple-500 text-white flex items-center gap-1.5 shadow-md shadow-purple-900/40 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{isSubmittingComponent ? "Đang lưu..." : isEditingComponent ? "Cập Nhật Thành Phần" : "Lưu Vào Cấu Trúc BOM"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: BIÊN BẢN BÀN GIAO KỸ THUẬT & PHỤ KIỆN ĐÍNH KÈM ==================== */}
      {isHandoverModalOpen && handoverData && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-4xl w-full my-auto flex flex-col max-h-[92vh] overflow-hidden animate-fade-in text-slate-800 dark:text-slate-100">
            {/* Action Bar */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/80">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-bold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-200">
                  Xem Trước &amp; In Biên Bản Bàn Giao Kỹ Thuật (Phụ Kiện Theo Bộ)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3.5 py-1.5 rounded-xl font-bold text-xs bg-purple-600 hover:bg-purple-500 text-white flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>In Biên Bản</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsHandoverModalOpen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Document Body (Printable Paper Look) */}
            <div className="p-8 sm:p-10 overflow-y-auto space-y-6 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-sans text-xs">
              {/* Header Letterhead */}
              <div className="text-center space-y-1 pb-4 border-b-2 border-slate-900 dark:border-slate-700">
                <div className="text-[11px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400">
                  CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
                </div>
                <div className="text-[10px] font-semibold text-slate-500 italic pb-2">
                  Độc lập - Tự do - Hạnh phúc
                </div>
                <h2 className="text-base sm:text-lg font-black uppercase text-purple-700 dark:text-purple-400 tracking-wide pt-1">
                  BIÊN BẢN BÀN GIAO THÀNH PHẦN &amp; PHỤ KIỆN KÈM THEO
                </h2>
                <p className="text-[11px] text-slate-500 italic">
                  (Áp dụng cho Hàng hóa cấu thành bởi nhiều đơn vị độc lập - Chuẩn ISO 13485 &amp; GSP)
                </p>
                <div className="flex items-center justify-center gap-6 pt-1 text-[11px] font-mono text-slate-500">
                  <span>Số BB: <strong>{handoverData.delivery_code}</strong></span>
                  <span>Ngày lập: <strong>{handoverData.date}</strong></span>
                  <span>Đơn hàng SO: <strong>{handoverData.order_code}</strong></span>
                </div>
              </div>

              {/* Thông tin 2 bên */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-[11px]">
                <div className="space-y-1">
                  <span className="font-bold uppercase text-purple-700 dark:text-purple-400 block text-xs">
                    I. ĐẠI DIỆN BÊN GIAO ({companyConfig.companyName ? companyConfig.companyName.toUpperCase() : "BÊN GIAO"})
                  </span>
                  <div>Đơn vị: <strong>{companyConfig.companyName || "CÔNG TY TNHH THƯƠNG MẠI & PHÂN PHỐI ABT"}</strong></div>
                  <div>Kho xuất hàng: <strong>{handoverData.warehouse_name}</strong></div>
                  <div>Người thực hiện bàn giao: <strong>{handoverData.performed_by}</strong></div>
                </div>

                <div className="space-y-1">
                  <span className="font-bold uppercase text-purple-700 dark:text-purple-400 block text-xs">
                    II. ĐẠI DIỆN BÊN TIẾP NHẬN (KHÁCH HÀNG)
                  </span>
                  <div>Tên Đơn Vị / Viện: <strong>{handoverData.customer_name}</strong></div>
                  <div>Địa chỉ tiếp nhận: <strong>Khoa Xét Nghiệm / Phòng Trang Thiết Bị Y Tế</strong></div>
                  <div>Người tiếp nhận kiểm đếm: <strong>Cán bộ phụ trách nhận bàn giao</strong></div>
                </div>
              </div>

              {/* Thông tin Mã Hàng Chính */}
              <div className="p-3.5 rounded-xl bg-purple-50/70 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/60 flex items-center justify-between text-xs">
                <div>
                  <span className="text-[10px] font-bold uppercase text-purple-700 dark:text-purple-300 block">
                    Mã Hàng Hóa Thương Mại Chính (Ghi trên Hóa Đơn VAT / Hợp Đồng Thầu):
                  </span>
                  <div className="font-extrabold text-sm text-slate-900 dark:text-white mt-0.5">
                    [{handoverData.product_code}] {handoverData.product_name}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Số lượng bàn giao:</span>
                  <span className="font-mono font-black text-sm text-purple-700 dark:text-purple-300">
                    {handoverData.quantity} {handoverData.unit}
                  </span>
                </div>
              </div>

              {/* Bảng chi tiết từng phụ kiện độc lập */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold uppercase text-xs tracking-wide text-slate-800 dark:text-slate-200">
                    III. BẢNG KIỂM KÊ CHI TIẾT CÁC ĐƠN VỊ CẤU THÀNH &amp; PHỤ KIỆN ĐÍNH KÈM:
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Tổng cộng: <strong>{handoverData.components?.length || 0} hạng mục con</strong>
                  </span>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-300 dark:border-slate-700 shadow-2xs">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 uppercase text-[10px] font-bold border-b border-slate-300 dark:border-slate-700">
                      <tr>
                        <th className="py-2.5 px-3">STT</th>
                        <th className="py-2.5 px-3">Mã Thành Phần</th>
                        <th className="py-2.5 px-3">Tên Phụ Kiện / Thành Phần Độc Lập</th>
                        <th className="py-2.5 px-3">Quy Cách</th>
                        <th className="py-2.5 px-3 text-center">SL Thực Nhận</th>
                        <th className="py-2.5 px-3">Số Serial (S/N) / Số Lô (LOT)</th>
                        <th className="py-2.5 px-3">Điều Kiện Bảo Quản</th>
                        <th className="py-2.5 px-3 text-center">Tình Trạng Niêm Phong</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-medium">
                      {(handoverData.components || []).map((c: any, idx: number) => (
                        <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                          <td className="py-2.5 px-3 font-mono text-[11px]">{idx + 1}</td>
                          <td className="py-2.5 px-3 font-mono font-bold text-purple-700 dark:text-purple-300 text-[11px] whitespace-nowrap">
                            {c.component_code}
                          </td>
                          <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">
                            {c.component_name}
                          </td>
                          <td className="py-2.5 px-3 text-slate-500 text-[11px]">
                            {c.specification || "—"}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono font-black text-xs text-purple-700 dark:text-purple-300">
                            {c.total_qty} {c.unit || "Cái"}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-[11px] text-orange-600 dark:text-orange-400">
                            {c.serial_or_lot}
                          </td>
                          <td className="py-2.5 px-3 text-[11px] whitespace-nowrap">
                            {c.storage_condition || "Nhiệt độ phòng"}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="w-3.5 h-3.5" /> {c.status || "Đạt chuẩn 100%"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Cam kết & Ký nhận */}
              <div className="pt-2 text-[11px] text-slate-500 leading-relaxed italic">
                * Hai bên cùng thống nhất kiểm đếm và đối chiếu thực tế: Toàn bộ phụ kiện, khối máy và các ống hóa chất sinh phẩm đúng quy cách, còn nguyên tem niêm phong và đạt điều kiện bảo quản nhiệt độ quy định. Biên bản được lập thành 02 bản có giá trị pháp lý như nhau, mỗi bên giữ 01 bản để phục vụ công tác nghiệm thu và bảo hành.
              </div>

              {/* Chữ ký 2 bên */}
              <div className="grid grid-cols-2 gap-8 pt-6 pb-8 text-center text-xs">
                <div className="space-y-16">
                  <div>
                    <strong className="uppercase text-slate-900 dark:text-white block">ĐẠI DIỆN BÊN GIAO HÀNG</strong>
                    <span className="text-[11px] text-slate-500">(Ký, ghi rõ họ tên và đóng dấu)</span>
                  </div>
                  <div className="font-bold text-slate-800 dark:text-slate-200">
                    {handoverData.performed_by}
                  </div>
                </div>

                <div className="space-y-16">
                  <div>
                    <strong className="uppercase text-slate-900 dark:text-white block">ĐẠI DIỆN BÊN TIẾP NHẬN</strong>
                    <span className="text-[11px] text-slate-500">(Ký, ghi rõ họ tên và đóng dấu)</span>
                  </div>
                  <div className="font-bold text-slate-800 dark:text-slate-200">
                    Cán bộ tiếp nhận thiết bị / vật tư
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/80">
              <span className="text-xs text-slate-500">
                Chứng từ xuất kho kèm theo đơn hàng: <strong className="font-mono text-purple-600 dark:text-purple-400">{handoverData.order_code}</strong>
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsHandoverModalOpen(false)}
                  className="px-4 py-2 rounded-xl font-bold text-xs bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-5 py-2 rounded-xl font-bold text-xs bg-purple-600 hover:bg-purple-500 text-white flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>In Biên Bản Ngay</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: CHI TIẾT PHỤ KIỆN KÈM THEO LÔ HÀNG (KIT COMPONENTS MODAL) ==================== */}
      {selectedKitModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between bg-gradient-to-r from-purple-50 via-slate-50 to-white dark:from-purple-950/40 dark:via-slate-900 dark:to-slate-900">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-600 text-white flex items-center justify-center text-xl shadow-md">
                  🧩
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-black text-lg text-slate-900 dark:text-white">
                      {selectedKitModalItem.product_code}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                      Bộ / Kit ({selectedKitModalItem.itemComponents?.length || 0} Phụ Kiện Kèm Theo)
                    </span>
                  </div>
                  <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200 mt-0.5">
                    {selectedKitModalItem.product_name}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedKitModalItem(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4">
              {/* Main Product Info Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 text-xs">
                <div>
                  <span className="text-slate-400 block text-[11px]">Số LOT Bộ Kit:</span>
                  <span className="font-mono font-bold text-purple-700 dark:text-purple-300 text-sm">
                    {selectedKitModalItem.lot_number || "Theo Lô Tiêu Chuẩn"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Hạn Dùng Bộ Kit (EXP):</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200 text-sm">
                    {selectedKitModalItem.expiry_date || "—"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Số Lượng Kit Tồn Kho:</span>
                  <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 text-sm">
                    {selectedKitModalItem.quantity_on_hand} {selectedKitModalItem.unit || "Hộp"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Bảo Quản Kit Chính:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {selectedKitModalItem.storage_temp || selectedKitModalItem.storage_condition || "15-25°C"}
                  </span>
                </div>
              </div>

              {/* Notice Banner */}
              <div className="p-3 bg-purple-50/70 dark:bg-purple-950/30 rounded-xl border border-purple-200 dark:border-purple-800/60 text-xs flex items-start gap-2.5">
                <span className="text-base">ℹ️</span>
                <div className="text-slate-600 dark:text-slate-300 leading-relaxed">
                  <strong>Quy chuẩn đóng gói & bảo quản linh kiện:</strong> Các sản phẩm dạng Bộ/Kit thường bao gồm nhiều phụ kiện hoặc hóa chất thành phần (như Proteinase K, Magbead, Deep Plate, Khay phản ứng). Các phụ kiện này có thể có <strong>nhiệt độ bảo quản riêng biệt</strong> (ví dụ hóa chất enzym ở 2-8°C hoặc -20°C, khay nhựa ở 15-25°C) và <strong>số LOT/Hạn dùng phụ kiện độc lập</strong> cần theo dõi khi giao hàng hoặc xuất xưởng.
                </div>
              </div>

              {/* Table of Components */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-2xs">
                <div className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800/90 font-bold text-xs text-slate-800 dark:text-slate-200 flex items-center justify-between">
                  <span>DANH SÁCH CHI TIẾT PHỤ KIỆN & THÀNH PHẦN KÈM THEO LÔ</span>
                  <span className="text-[11px] font-normal text-slate-500">
                    Tổng cộng: {selectedKitModalItem.itemComponents?.length || 0} thành phần
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 font-bold border-b border-slate-200 dark:border-slate-800 text-[11px]">
                        <th className="py-2.5 px-3">Mã Phụ Kiện</th>
                        <th className="py-2.5 px-3">Tên Thành Phần / Phụ Kiện</th>
                        <th className="py-2.5 px-3 text-center">Định Mức / Kit</th>
                        <th className="py-2.5 px-3 text-right font-bold text-purple-700 dark:text-purple-300">Tổng Thực Tồn</th>
                        <th className="py-2.5 px-3">Số LOT Phụ Kiện</th>
                        <th className="py-2.5 px-3">Hạn Dùng (EXP)</th>
                        <th className="py-2.5 px-3">Bảo Quản & Vị Trí Lưu Kho</th>
                        <th className="py-2.5 px-3 text-center">Thao Tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {selectedKitModalItem.itemComponents?.map((comp: any, idx: number) => {
                        const compQtyOnHand = Number(comp.quantity_per_kit || 1) * Number(selectedKitModalItem.quantity_on_hand || 0);
                        const isDiffTemp = comp.storage_condition && selectedKitModalItem.storage_condition && comp.storage_condition !== selectedKitModalItem.storage_condition;
                        return (
                          <tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                            <td className="py-3 px-3 font-mono font-bold text-purple-700 dark:text-purple-300 whitespace-nowrap">
                              {comp.component_code}
                            </td>
                            <td className="py-3 px-3">
                              <div className="font-bold text-slate-800 dark:text-slate-200">
                                {comp.component_name}
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                {comp.specification || "Tiêu chuẩn"} • ĐVT: {comp.unit || "Ống"}
                              </div>
                              {comp.notes && (
                                <div className="text-[10px] text-slate-500 mt-0.5 italic">
                                  {comp.notes}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3 text-center font-mono font-bold text-slate-700 dark:text-slate-300">
                              {comp.quantity_per_kit} {comp.unit || ""}
                            </td>
                            <td className="py-3 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                              {comp.total_quantity !== undefined ? comp.total_quantity : compQtyOnHand} {comp.unit || ""}
                            </td>
                            <td className="py-3 px-3 font-mono">
                              <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-semibold text-slate-800 dark:text-slate-200 text-xs">
                                {comp.lot_number || selectedKitModalItem.lot_number || "LOT-THEO-KIT"}
                              </span>
                            </td>
                            <td className="py-3 px-3 font-mono text-slate-700 dark:text-slate-300 text-xs">
                              {comp.expiry_date || selectedKitModalItem.expiry_date || "—"}
                            </td>
                            <td className="py-3 px-3">
                              <div className="flex items-center gap-1.5">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                                  comp.storage_condition?.includes("-20")
                                    ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-200"
                                    : comp.storage_condition?.includes("2-8")
                                    ? "bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300 border border-cyan-200"
                                    : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border border-slate-200"
                                }`}>
                                  {comp.storage_condition?.includes("-20") ? "❄️" : comp.storage_condition?.includes("2-8") ? "🧊" : "📦"} {comp.storage_condition || "15-25°C"}
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-500 mt-1">
                                📍 {comp.shelf_position || "Kho ABT"}
                              </div>
                              {isDiffTemp && (
                                <span className="inline-block text-[9px] text-amber-600 dark:text-amber-400 font-bold mt-0.5">
                                  ⚠️ Khác nhiệt độ Kit chính!
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-center">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedBarcodeItem({
                                    product_code: comp.component_code,
                                    product_name: `${comp.component_name} (Kit: ${selectedKitModalItem.product_code})`,
                                    batch_lot: comp.lot_number || selectedKitModalItem.lot_number,
                                    expiry_date: comp.expiry_date || selectedKitModalItem.expiry_date,
                                    storage_condition: comp.storage_condition || selectedKitModalItem.storage_condition,
                                    quantity: comp.total_quantity !== undefined ? comp.total_quantity : compQtyOnHand,
                                    unit: comp.unit || "Cái"
                                  });
                                  setIsBarcodeModalOpen(true);
                                }}
                                className="px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 transition-all cursor-pointer flex items-center gap-1 mx-auto"
                                title="In tem mã vạch riêng cho phụ kiện này"
                              >
                                <BarcodeIcon className="w-3.5 h-3.5" />
                                <span>In Tem</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/80">
              <button
                type="button"
                onClick={() => {
                  setSelectedBomParent(selectedKitModalItem.product_code);
                  setSelectedKitModalItem(null);
                  setSubTab("bom_kits");
                }}
                className="text-xs text-purple-700 dark:text-purple-300 hover:underline font-bold flex items-center gap-1 cursor-pointer"
              >
                <span>Chuyển đến Cây Cấu Trúc BOM &amp; Kit Định Mức Toàn Diện</span>
                <span>→</span>
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedKitModalItem(null)}
                  className="px-4 py-2 rounded-xl font-bold text-xs bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors cursor-pointer"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-5 py-2 rounded-xl font-bold text-xs bg-purple-600 hover:bg-purple-500 text-white flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>In Bảng Kê Phụ Kiện Lô Hàng</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: CẬP NHẬT THÔNG TIN LÔ HÀNG & BẢO QUẢN ==================== */}
      {isEditStockModalOpen && editingStockItem && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-xl w-full max-h-[92vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-teal-950/90 via-slate-900 to-slate-900 text-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-teal-500/20 border border-teal-400/30 text-teal-300 flex items-center justify-center font-bold">
                  <Edit3 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-white text-base tracking-tight">
                    CẬP NHẬT THÔNG TIN LÔ HÀNG &amp; BẢO QUẢN
                  </h3>
                  <p className="text-xs text-teal-200/80 mt-0.5">
                    [{editingStockItem.product_code}] {editingStockItem.product_name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsEditStockModalOpen(false);
                  setEditingStockItem(null);
                }}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              {/* Product Summary Banner */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Mặt hàng đang chỉnh sửa</span>
                  <div className="font-bold text-slate-900 dark:text-white text-sm mt-0.5">
                    {editingStockItem.product_code} — {editingStockItem.product_name}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Thực tồn: <strong className="font-mono text-slate-800 dark:text-slate-200">{editingStockItem.quantity_on_hand || 0} {editingStockItem.unit || "Hộp"}</strong> • Khả dụng: <strong className="font-mono text-emerald-600 dark:text-emerald-400">{editingStockItem.quantity_available || 0}</strong>
                  </div>
                </div>
              </div>

              {/* Row 1: Số lô & Hạn dùng */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Số lô (Lot No) *
                  </label>
                  <input
                    type="text"
                    value={editStockForm.lot_number}
                    onChange={(e) => setEditStockForm({ ...editStockForm, lot_number: e.target.value })}
                    placeholder="VD: L260901, LOT-001..."
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Hạn dùng (Expiry Date)
                  </label>
                  <input
                    type="date"
                    value={editStockForm.expiry_date}
                    onChange={(e) => setEditStockForm({ ...editStockForm, expiry_date: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono"
                  />
                </div>
              </div>

              {/* Row 2: Đơn giá vốn / Giá đầu kỳ & Tổng giá trị tồn */}
              <div className="p-4 rounded-xl bg-teal-50/60 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800/60 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                  <div>
                    <label className="block font-bold text-teal-900 dark:text-teal-200 mb-1">
                      Đơn giá vốn / Giá đầu kỳ (VNĐ)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={1000}
                      value={editStockForm.cost_price}
                      onChange={(e) => setEditStockForm({ ...editStockForm, cost_price: Number(e.target.value) || 0 })}
                      placeholder="Nhập đơn giá đầu kỳ..."
                      className="w-full p-2.5 rounded-xl border border-teal-300 dark:border-teal-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono font-bold"
                    />
                  </div>
                  <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-teal-200/80 dark:border-teal-800/60">
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">
                      Tổng giá trị tồn lô này (Tự động tính)
                    </span>
                    <div className="text-base font-black font-mono text-teal-600 dark:text-teal-400 mt-1">
                      {formatCurrency((Number(editingStockItem.quantity_on_hand) || 0) * (Number(editStockForm.cost_price) || 0))}
                    </div>
                    <span className="text-[10px] text-slate-400">
                      = {editingStockItem.quantity_on_hand || 0} {editingStockItem.unit || "Hộp"} × {formatCurrency(Number(editStockForm.cost_price) || 0)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Row 3: Điều kiện / Nhiệt độ bảo quản */}
              <div className="space-y-2">
                <label className="block font-bold text-slate-700 dark:text-slate-300">
                  Điều kiện / Nhiệt độ bảo quản (GSP)
                </label>
                <select
                  value={editStockForm.storage_condition}
                  onChange={(e) => setEditStockForm({ ...editStockForm, storage_condition: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold"
                >
                  <option value="15–25°C (Nhiệt độ phòng - RT)">15–25°C (Nhiệt độ phòng - RT)</option>
                  <option value="2–8°C (Tủ mát)">2–8°C (Tủ mát)</option>
                  <option value="-20°C (Lạnh âm sâu)">-20°C (Lạnh âm sâu)</option>
                  <option value="-80°C (Âm sâu đặc biệt)">-80°C (Âm sâu đặc biệt)</option>
                  <option value="CUSTOM">Khác (Tùy chỉnh nhiệt độ bảo quản...)</option>
                </select>
                {editStockForm.storage_condition === "CUSTOM" && (
                  <input
                    type="text"
                    value={editStockForm.custom_storage_condition}
                    onChange={(e) => setEditStockForm({ ...editStockForm, custom_storage_condition: e.target.value })}
                    placeholder="Nhập điều kiện nhiệt độ bảo quản tùy chỉnh (VD: Khô ráo, tránh ánh sáng...)"
                    className="w-full p-2.5 rounded-xl border border-teal-300 dark:border-teal-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-medium mt-2"
                  />
                )}
              </div>

              {/* Row 4: Khu vực kho & Vị trí Tủ / Kệ */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Khu vực kho
                  </label>
                  <select
                    value={editStockForm.warehouse_location}
                    onChange={(e) => setEditStockForm({ ...editStockForm, warehouse_location: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold"
                  >
                    <option value="Kho Trung Tâm">Kho Trung Tâm</option>
                    <option value="Kho Mát 2-8°C (Khu B)">Kho Mát 2-8°C (Khu B)</option>
                    <option value="Kho Lạnh Âm Sâu -20°C (Khu A)">Kho Lạnh Âm Sâu -20°C (Khu A)</option>
                    <option value="Kho Âm Siêu Sâu -80°C">Kho Âm Siêu Sâu -80°C</option>
                    <option value="Kho Thiết Bị & Vật Tư">Kho Thiết Bị &amp; Vật Tư</option>
                    <option value="Kho Chi Nhánh Hà Nội">Kho Chi Nhánh Hà Nội</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Vị trí Tủ / Kệ lưu trữ
                  </label>
                  <input
                    type="text"
                    value={editStockForm.shelf_position}
                    onChange={(e) => setEditStockForm({ ...editStockForm, shelf_position: e.target.value })}
                    placeholder="VD: Kệ B1, Tủ mát TM-02, Chưa phân bổ kệ..."
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono font-semibold"
                  />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2 bg-slate-50 dark:bg-slate-900/80">
              <button
                type="button"
                onClick={() => {
                  setIsEditStockModalOpen(false);
                  setEditingStockItem(null);
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Hủy Bỏ
              </button>
              <button
                type="button"
                disabled={isSavingStockEdit}
                onClick={handleSaveStockEdit}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-50 shadow-md shadow-teal-600/30 flex items-center gap-1.5 cursor-pointer"
              >
                {isSavingStockEdit ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Đang lưu...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Lưu Cập Nhật Lô &amp; Bảo Quản</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: IN TEM NHÃN MÃ VẠCH (CODE 128) & QR CODE ==================== */}
      <BarcodePrintModal
        isOpen={isBarcodeModalOpen}
        onClose={() => setIsBarcodeModalOpen(false)}
        item={selectedBarcodeItem}
      />
    </div>
  );
};

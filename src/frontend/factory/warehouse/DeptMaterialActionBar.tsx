"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, ArrowRightLeft, Boxes, FileStack, PackagePlus, ShoppingCart } from "lucide-react";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { openExcelImportTemplate } from "../import/FactoryExcelImportModule";
import { CatalogItemCombobox, type CatalogMasterItemOption } from "./CatalogItemCombobox";
import { DocumentDetail, REASON_VI_LABEL, renderWarehouseFlow } from "./DocumentsView";
import { StockCategoryBadge, type StockItemGroup } from "./StockView";
import { DepartmentWorkTasksBar } from "@/frontend/components/DepartmentWorkTasksBar";

const MODULE_IMPORT_TARGET: Record<"RD" | "KIT" | "OLIGO" | "DEVICE" | "QMS", { deptCode: string; warehouseCode: string; taskDeptCode: string }> = {
  OLIGO: { deptCode: "P-OLIGO", warehouseCode: "KHO-OLIGO", taskDeptCode: "Tổng Hợp Oligo" },
  KIT: { deptCode: "P-KIT", warehouseCode: "KHO-KIT", taskDeptCode: "Sản Xuất Kit" },
  RD: { deptCode: "P-RD", warehouseCode: "KHO-RD", taskDeptCode: "Nghiên Cứu R&D" },
  DEVICE: { deptCode: "P-DEVICE", warehouseCode: "KHO-TONG", taskDeptCode: "Kỹ Thuật – Thiết Bị" },
  QMS: { deptCode: "P-QA", warehouseCode: "KHO-QA", taskDeptCode: "QA/QC" },
};

interface WarehouseItem {
  id: string;
  code: string;
  name: string;
  purpose?: string;
  owner_org_unit_id?: string;
  owner_name?: string;
  owner_module_key?: string;
}

interface PrReasonOption {
  id: string;
  category: string;
  label: string;
  value: string;
  entity_type?: string;
  entity_id?: string;
}

interface PrOption {
  id: string;
  code: string;
  name: string;
  module_key?: string;
  warehouses: { id: string; code: string; name: string }[];
  reasons?: PrReasonOption[];
}

type CatalogMasterItem = CatalogMasterItemOption;

interface PrDraftLine {
  mode: "CATALOG" | "NEW";
  item_id: string;
  label: string;
  new_item_code: string;
  new_item_name: string;
  item_type: "RAW_MATERIAL" | "REAGENT" | "CONSUMABLE" | "COMPONENT";
  qty: string;
  uom: string;
  est_price: string;
  notes: string;
}

const DEFAULT_UOM_GROUPS: Array<{ group: string; items: Array<{ code: string; label: string }> }> = [
  {
    group: "📦 Đóng gói & Vật chứa Lab",
    items: [
      { code: "Hộp", label: "Hộp" },
      { code: "Lọ", label: "Lọ (Vial)" },
      { code: "Chai", label: "Chai (Bottle)" },
      { code: "Tube", label: "Tube (Ống)" },
      { code: "Ống", label: "Ống" },
      { code: "Bộ", label: "Bộ (Set)" },
      { code: "Kit", label: "Kit" },
      { code: "Gói", label: "Gói (Pack)" },
      { code: "Túi", label: "Túi (Bag)" },
      { code: "Bịch", label: "Bịch" },
      { code: "Thùng", label: "Thùng (Carton)" },
      { code: "Đĩa", label: "Đĩa (Plate)" },
      { code: "Well", label: "Giếng (Well)" },
      { code: "Cột", label: "Cột (Column)" },
    ],
  },
  {
    group: "💧 Thể tích (Chất lỏng / Dung dịch)",
    items: [
      { code: "mL", label: "mL (Mililít)" },
      { code: "µL", label: "µL (Microlít)" },
      { code: "L", label: "L (Lít)" },
    ],
  },
  {
    group: "⚖️ Khối lượng (Hóa chất rắn / Bột)",
    items: [
      { code: "g", label: "g (Gam)" },
      { code: "mg", label: "mg (Miligam)" },
      { code: "µg", label: "µg (Microgam)" },
      { code: "kg", label: "kg (Kilôgam)" },
    ],
  },
  {
    group: "🧬 Sinh học phân tử & Hoạt độ",
    items: [
      { code: "Rxn", label: "Rxn (Phản ứng)" },
      { code: "Test", label: "Test (Xét nghiệm)" },
      { code: "nmol", label: "nmol (Nanomol)" },
      { code: "µmol", label: "µmol (Micromol)" },
      { code: "pmol", label: "pmol (Picomol)" },
      { code: "OD", label: "OD (Mật độ quang)" },
      { code: "U", label: "U (Unit Enzyme)" },
      { code: "kU", label: "kU (1000 Unit)" },
    ],
  },
  {
    group: "⚙️ Thiết bị, Linh kiện & Vật tư",
    items: [
      { code: "Cái", label: "Cái" },
      { code: "Chiếc", label: "Chiếc" },
      { code: "pcs", label: "pcs (Pieces)" },
      { code: "Cuộn", label: "Cuộn (Roll)" },
      { code: "Tấm", label: "Tấm (Sheet)" },
      { code: "Cây", label: "Cây" },
      { code: "m", label: "m (Mét)" },
      { code: "cm", label: "cm" },
      { code: "mm", label: "mm" },
    ],
  },
];

const DEFAULT_UOM_SUGGESTIONS = DEFAULT_UOM_GROUPS.flatMap((g) => g.items.map((i) => i.code));

function createEmptyPrLine(mode: "CATALOG" | "NEW" = "CATALOG"): PrDraftLine {
  return {
    mode,
    item_id: "",
    label: "",
    new_item_code: "",
    new_item_name: "",
    item_type: "RAW_MATERIAL",
    qty: "1",
    uom: "Hộp",
    est_price: "",
    notes: "",
  };
}

interface StockRow {
  id: string;
  item_id: string;
  location_id: string;
  lot_id: string | null;
  item_code: string;
  item_name: string;
  item_type?: string;
  item_group?: "RAW" | "SEMI_FINISHED" | "FINISHED";
  base_uom: string;
  lot_code: string | null;
  lot_status: string | null;
  expiry_date: string | null;
  warehouse_code: string;
  location_code: string;
  qty_on_hand: string;
  qty_available: string;
}

interface StockGroupCounts {
  total_lots: number;
  total_items: number;
  raw_lots: number;
  raw_items: number;
  semi_lots: number;
  semi_items: number;
  finished_lots: number;
  finished_items: number;
}

export function DeptMaterialActionBar({
  moduleKey,
  deptLabel,
  defaultReasonPlaceholder,
}: {
  moduleKey: "RD" | "KIT" | "OLIGO" | "DEVICE" | "QMS";
  deptLabel: string;
  defaultReasonPlaceholder?: string;
}) {
  const qc = useQueryClient();
  const [panel, setPanel] = useState<"none" | "stock" | "history" | "transfer" | "requisition" | "pr">("none");
  const [historyFlow, setHistoryFlow] = useState<"" | "PURCHASE_IN" | "SUPPLY_TRANSFER" | "PRODUCTION_OUT">("");
  const [historyQ, setHistoryQ] = useState("");
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  const warehouses = useQuery({
    queryKey: ["factory", "warehouses"],
    queryFn: () => api<WarehouseItem[]>("/api/factory/master/warehouses"),
  });

  const centralWarehouse = React.useMemo(
    () =>
      (warehouses.data ?? []).find((w) => w.code === "KHO-TONG") ??
      (warehouses.data ?? []).find((w) => `${w.code} ${w.name}`.toUpperCase().includes("TỔNG")) ??
      null,
    [warehouses.data]
  );

  const deptWarehouses = (warehouses.data ?? []).filter((w) => {
    if (w.owner_module_key === moduleKey) return true;
    const text = `${w.code} ${w.name} ${w.owner_name ?? ""}`.toUpperCase();
    if (moduleKey === "RD") return text.includes("RD") || text.includes("R&D") || text.includes("NGHIÊN CỨU");
    if (moduleKey === "KIT") return text.includes("KIT");
    if (moduleKey === "OLIGO") return text.includes("OLIGO");
    if (moduleKey === "DEVICE") return text.includes("DEV") || text.includes("THIẾT BỊ") || text.includes("KỸ THUẬT");
    if (moduleKey === "QMS") return text.includes("QC") || text.includes("QA");
    return false;
  });

  const activeDeptWhId = deptWarehouses[0]?.id ?? "";
  const [selectedWhId, setSelectedWhId] = useState("");
  const currentWhId = selectedWhId || activeDeptWhId;

  // Quick Stock View state
  const [stockQ, setStockQ] = useState("");
  const [stockGroup, setStockGroup] = useState<StockItemGroup>("");
  const deptStock = useQuery({
    queryKey: ["factory", "dept-quick-stock", currentWhId, stockQ, stockGroup],
    queryFn: () =>
      api<{ rows: StockRow[]; total: number; group_counts?: StockGroupCounts }>(
        `/api/factory/inv/stock?page_size=25${currentWhId ? `&warehouse_id=${currentWhId}` : ""}${stockGroup ? `&item_group=${stockGroup}` : ""}${stockQ.trim() ? `&q=${encodeURIComponent(stockQ.trim())}` : ""}`
      ),
    enabled: panel === "stock" || panel === "requisition",
  });

  // Quick Department Warehouse Receipt / Issue / Supply History
  const deptHistory = useQuery({
    queryKey: ["factory", "dept-quick-history", currentWhId, historyFlow, historyQ],
    queryFn: () =>
      api<{ rows: any[]; total: number }>(
        `/api/factory/inv/documents?view=ledger&page_size=30${currentWhId ? `&warehouse_id=${currentWhId}` : ""}${historyFlow ? `&flow=${historyFlow}` : ""}${historyQ.trim() ? `&q=${encodeURIComponent(historyQ.trim())}` : ""}`
      ),
    enabled: panel === "history",
  });

  // Quick Inter-Warehouse Transfer (Kho Trung Tâm KHO-TONG -> Kho Phòng Ban) state
  const GENERAL_USAGE_PRESETS = React.useMemo(
    () => [
      `Dự trữ & sử dụng chung tại ${deptLabel} (Chưa có Lệnh SX / Dự án cụ thể)`,
      `Bổ sung tồn kho nhánh ${deptLabel} để sử dụng thường xuyên`,
      `Pha chế dung dịch đệm / Bán thành phẩm / Hóa chất dùng chung tại ${deptLabel}`,
      `Chuẩn bị vật tư tiêu hao / Thử nghiệm & đánh giá nội bộ ${deptLabel}`,
    ],
    [deptLabel]
  );
  const [transferSrcWhId, setTransferSrcWhId] = useState("");
  const [transferDstWhId, setTransferDstWhId] = useState("");
  const effectiveTransferSrcWhId = transferSrcWhId || centralWarehouse?.id || "";
  const effectiveTransferDstWhId =
    transferDstWhId ||
    activeDeptWhId ||
    (warehouses.data ?? []).find((w) => w.id !== effectiveTransferSrcWhId)?.id ||
    "";
  const [transferReasonPreset, setTransferReasonPreset] = useState<string>("__GENERAL_0__");
  const [transferNotes, setTransferNotes] = useState<string>(
    () => `Dự trữ & sử dụng chung tại ${deptLabel} (Chưa có Lệnh SX / Dự án cụ thể)`
  );
  const [transferPickQ, setTransferPickQ] = useState("");
  const [transferLines, setTransferLines] = useState<{ row: StockRow; qty: string }[]>([]);
  const [transferSuccessMsg, setTransferSuccessMsg] = useState<string | null>(null);

  const transferStockPick = useQuery({
    queryKey: ["factory", "stock", "quick-transfer-pick", effectiveTransferSrcWhId, transferPickQ],
    queryFn: () =>
      api<{ rows: StockRow[] }>(
        `/api/factory/inv/stock?warehouse_id=${effectiveTransferSrcWhId}&status=RELEASED&page_size=25${
          transferPickQ.trim() ? `&q=${encodeURIComponent(transferPickQ.trim())}` : ""
        }`
      ),
    enabled: panel === "transfer" && Boolean(effectiveTransferSrcWhId) && Boolean(transferPickQ.trim()),
  });

  const hubTransferOverview = useQuery({
    queryKey: ["factory", "warehouse-hub-ops"],
    queryFn: () =>
      api<{
        can_approve_transfer?: boolean;
        pending_transfer_requests?: {
          id: string;
          code: string;
          status: string;
          created_at: string;
          notes: string | null;
          source_warehouse_code: string;
          target_warehouse_ids?: string[];
          target_warehouse_codes?: string[];
          created_by_name: string | null;
          line_summaries: string[];
        }[];
      }>("/api/factory/inv/ops"),
    enabled: panel === "transfer" || panel === "history",
  });

  const deptPendingTransfers = React.useMemo(() => {
    const all = hubTransferOverview.data?.pending_transfer_requests ?? [];
    const deptWhIds = new Set(deptWarehouses.map((w) => w.id));
    const deptWhCodes = new Set(deptWarehouses.map((w) => w.code));
    if (deptWhIds.size === 0 && deptWhCodes.size === 0) return all;
    return all.filter(
      (t) =>
        (t.target_warehouse_ids ?? []).some((id) => deptWhIds.has(id)) ||
        (t.target_warehouse_codes ?? []).some((code) => deptWhCodes.has(code))
    );
  }, [hubTransferOverview.data?.pending_transfer_requests, deptWarehouses]);

  const postTransferMut = useMutation({
    mutationFn: async () => {
      const validLines = transferLines
        .map((l) => ({
          item_id: l.row.item_id,
          lot_id: l.row.lot_id,
          qty: Number(String(l.qty || "").replace(",", ".")),
        }))
        .filter((l) => l.qty > 0);
      return api<{
        document: { code: string };
        status?: "DRAFT" | "POSTED";
        pending_approval?: boolean;
        from_warehouse: string;
        to_warehouse: string;
        lines_count?: number;
      }>("/api/factory/inv/ops", {
        method: "POST",
        idempotent: true,
        json: {
          op: "dispatch_inter_warehouse",
          source_warehouse_id: effectiveTransferSrcWhId,
          target_warehouse_id: effectiveTransferDstWhId,
          lines: validLines,
          auto_post: false,
          notes:
            transferNotes.trim() ||
            `Đề xuất chuyển NVL từ Kho Trung Tâm về Kho ${deptLabel} (Dự trữ / sử dụng chung, chưa gắn Lệnh SX / Dự án cụ thể)`,
        },
      });
    },
    onSuccess: (res) => {
      const docCode = res.document?.code || "Phiếu mới";
      setTransferLines([]);
      setTransferPickQ("");
      setTransferSuccessMsg(
        `⏳ Đã gửi Phiếu đề xuất chuyển kho ${docCode} (${res.from_warehouse} ➔ ${res.to_warehouse}). Phiếu đang ở trạng thái CHỜ THỦ KHO / TRƯỞNG PHÒNG CUNG ỨNG DUYỆT XUẤT KHO.`
      );
      qc.invalidateQueries({ queryKey: ["factory", "warehouse-hub-ops"] });
      qc.invalidateQueries({ queryKey: ["factory", "supply-chain-ops"] });
      qc.invalidateQueries({ queryKey: ["factory", "stock"] });
      qc.invalidateQueries({ queryKey: ["factory", "dept-quick-stock"] });
      qc.invalidateQueries({ queryKey: ["factory", "dept-quick-history"] });
      qc.invalidateQueries({ queryKey: ["factory", "documents"] });
    },
  });

  const approveTransferMut = useMutation({
    mutationFn: (document_id: string) =>
      api<{ code: string }>("/api/factory/inv/ops", {
        method: "POST",
        idempotent: true,
        json: { op: "approve_transfer_request", document_id },
      }),
    onSuccess: (res) => {
      setTransferSuccessMsg(`✅ Thủ kho / Cung ứng đã phê duyệt & xuất cấp phát phiếu ${res.code} về kho phòng ban!`);
      qc.invalidateQueries({ queryKey: ["factory", "warehouse-hub-ops"] });
      qc.invalidateQueries({ queryKey: ["factory", "supply-chain-ops"] });
      qc.invalidateQueries({ queryKey: ["factory", "stock"] });
      qc.invalidateQueries({ queryKey: ["factory", "dept-quick-stock"] });
      qc.invalidateQueries({ queryKey: ["factory", "dept-quick-history"] });
      qc.invalidateQueries({ queryKey: ["factory", "documents"] });
    },
  });

  const rejectTransferMut = useMutation({
    mutationFn: (payload: { document_id: string; reason?: string }) =>
      api<{ code: string }>("/api/factory/inv/ops", {
        method: "POST",
        idempotent: true,
        json: { op: "reject_transfer_request", ...payload },
      }),
    onSuccess: (res) => {
      setTransferSuccessMsg(`Đã hủy / từ chối phiếu yêu cầu chuyển kho ${res.code}.`);
      qc.invalidateQueries({ queryKey: ["factory", "warehouse-hub-ops"] });
      qc.invalidateQueries({ queryKey: ["factory", "supply-chain-ops"] });
      qc.invalidateQueries({ queryKey: ["factory", "dept-quick-history"] });
      qc.invalidateQueries({ queryKey: ["factory", "documents"] });
    },
  });

  // Quick Issue / Requisition state
  const [issueWhId, setIssueWhId] = useState("");
  const targetIssueWhId = issueWhId || currentWhId || warehouses.data?.[0]?.id || "";
  const [issueReason, setIssueReason] = useState(moduleKey === "RD" ? "RND" : moduleKey === "QMS" ? "QC_SAMPLE" : "PRODUCTION");
  const [issueNotes, setIssueNotes] = useState(
    () => `Dự trữ & sử dụng chung tại ${deptLabel} (Chưa có Lệnh SX / Dự án cụ thể)`
  );
  const [issuePickQ, setIssuePickQ] = useState("");
  const [issueLines, setIssueLines] = useState<{ row: StockRow; qty: string }[]>([]);

  const issueStockPick = useQuery({
    queryKey: ["factory", "stock", "quick-issue-pick", targetIssueWhId, issuePickQ],
    queryFn: () =>
      api<{ rows: StockRow[] }>(
        `/api/factory/inv/stock?warehouse_id=${targetIssueWhId}&status=RELEASED&page_size=20${issuePickQ.trim() ? `&q=${encodeURIComponent(issuePickQ.trim())}` : ""}`
      ),
    enabled: panel === "requisition" && Boolean(targetIssueWhId) && Boolean(issuePickQ.trim()),
  });

  const postIssueMut = useMutation({
    mutationFn: () =>
      api("/api/factory/inv/documents", {
        method: "POST",
        idempotent: true,
        json: {
          doc_type: "ISSUE",
          reason_code: issueReason,
          warehouse_id: targetIssueWhId,
          notes: issueNotes || `Xuất sử dụng tại ${deptLabel}`,
          post: true,
          lines: issueLines.map((l) => ({
            item_id: l.row.item_id,
            lot_id: l.row.lot_id,
            from_location_id: l.row.location_id,
            qty: Number(l.qty.replace(",", ".")),
            uom: l.row.base_uom,
          })),
        },
      }),
    onSuccess: () => {
      setIssueLines([]);
      setIssueNotes("");
      qc.invalidateQueries({ queryKey: ["factory", "stock"] });
      qc.invalidateQueries({ queryKey: ["factory", "dept-quick-stock"] });
      qc.invalidateQueries({ queryKey: ["factory", "documents"] });
      setPanel("none");
    },
  });

  // Quick PR (Purchase Requisition) state
  const prOptions = useQuery({
    queryKey: ["factory", "pr-options"],
    queryFn: () => api<PrOption[]>("/api/factory/purchase/request-options"),
    enabled: panel === "pr" || panel === "transfer" || panel === "requisition",
  });
  const uoms = useQuery({
    queryKey: ["factory", "uoms"],
    queryFn: () => api<{ code: string }[]>("/api/factory/master/uoms"),
    enabled: panel === "pr",
  });
  const deptScopeParam = moduleKey === "QMS" ? "QA" : moduleKey;
  const allCatalogItems = useQuery({
    queryKey: ["factory", "items", "pr-catalog-dept", deptScopeParam],
    queryFn: () =>
      api<{ rows: CatalogMasterItem[]; total: number }>(`/api/factory/master/items?page_size=2000&status=ACTIVE&dept_scope=${deptScopeParam}`),
    enabled: panel === "pr",
  });
  const [prOrgUnitId, setPrOrgUnitId] = useState("");
  const [prWhId, setPrWhId] = useState("");
  const [prNeededBy, setPrNeededBy] = useState("");
  const [prReasonPreset, setPrReasonPreset] = useState("");
  const [prReason, setPrReason] = useState("");
  const [prPurposeEntityType, setPrPurposeEntityType] = useState<string | null>(null);
  const [prPurposeEntityId, setPrPurposeEntityId] = useState<string | null>(null);
  const [prLines, setPrLines] = useState<PrDraftLine[]>(() => [createEmptyPrLine("CATALOG")]);

  React.useEffect(() => {
    if (!prOptions.data?.length || prOrgUnitId) return;
    const matched = prOptions.data.find((o) => {
      const t = `${o.code} ${o.name} ${o.module_key ?? ""}`.toUpperCase();
      if (moduleKey === "RD") return t.includes("RD") || t.includes("R&D") || t.includes("NGHIÊN CỨU");
      if (moduleKey === "KIT") return t.includes("KIT");
      if (moduleKey === "OLIGO") return t.includes("OLIGO");
      if (moduleKey === "DEVICE") return t.includes("DEV") || t.includes("THIẾT BỊ") || t.includes("KỸ THUẬT");
      if (moduleKey === "QMS") return t.includes("QC") || t.includes("QA") || t.includes("QMS");
      return false;
    }) ?? prOptions.data[0];
    if (matched) {
      setPrOrgUnitId(matched.id);
      if (matched.warehouses[0]) setPrWhId(matched.warehouses[0].id);
      if (!prReason && matched.reasons?.[0]) {
        setPrReasonPreset(matched.reasons[0].id);
        setPrReason(matched.reasons[0].value);
        setPrPurposeEntityType(matched.reasons[0].entity_type ?? null);
        setPrPurposeEntityId(matched.reasons[0].entity_id ?? null);
      }
    }
  }, [prOptions.data, prOrgUnitId, moduleKey, prReason]);

  const mergedUomOptions = React.useMemo(() => {
    const fromDb = (uoms.data ?? []).map((u) => u.code);
    return Array.from(new Set([...fromDb, ...DEFAULT_UOM_SUGGESTIONS]));
  }, [uoms.data]);

  const updatePrLine = (idx: number, patch: Partial<PrDraftLine>) => {
    setPrLines((prev) => prev.map((item, j) => (j === idx ? { ...item, ...patch } : item)));
  };

  const validPrLines = prLines.filter((l) => {
    const q = Number(String(l.qty || "").replace(",", "."));
    if (!(q > 0)) return false;
    if (l.mode === "CATALOG") return Boolean(l.item_id);
    return Boolean(l.new_item_name.trim() || l.new_item_code.trim());
  });

  const createPrMut = useMutation({
    mutationFn: () =>
      api<{ id: string; code: string }>("/api/factory/purchase/requests", {
        method: "POST",
        idempotent: true,
        json: {
          org_unit_id: prOrgUnitId,
          target_warehouse_id: prWhId,
          needed_by: prNeededBy || null,
          reason: prReason.trim(),
          purpose_entity_type: prPurposeEntityType,
          purpose_entity_id: prPurposeEntityId,
          auto_submit: true,
          lines: validPrLines.map((l) => ({
            item_id: l.mode === "CATALOG" ? l.item_id : null,
            new_item_code: l.mode === "NEW" ? l.new_item_code.trim() || null : null,
            new_item_name: l.mode === "NEW" ? l.new_item_name.trim() || null : null,
            item_type: l.mode === "NEW" ? l.item_type : null,
            qty: Number(l.qty.replace(",", ".")),
            uom: l.uom || "Hộp",
            est_price: l.est_price ? Number(l.est_price) : null,
            notes: l.notes.trim() || null,
          })),
        },
      }),
    onSuccess: () => {
      setPrLines([createEmptyPrLine("CATALOG")]);
      qc.invalidateQueries({ queryKey: ["factory", "prs"] });
      qc.invalidateQueries({ queryKey: ["factory", "items"] });
      setPanel("none");
    },
  });

  const selectedPrUnit = prOptions.data?.find((o) => o.id === prOrgUnitId);
  const groupedReasons = React.useMemo(() => {
    const groups = new Map<string, PrReasonOption[]>();
    for (const r of selectedPrUnit?.reasons ?? []) {
      const list = groups.get(r.category) ?? [];
      list.push(r);
      groups.set(r.category, list);
    }
    return Array.from(groups.entries());
  }, [selectedPrUnit]);

  const navigateToHub = (tab: "factory-warehouse" | "factory-purchase" | "factory-import") => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("tbr-navigate", { detail: { tab } }));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/70 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <Boxes className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
            Kho nhánh &amp; Vật tư {deptLabel}:
          </span>
          {deptWarehouses.length > 0 ? (
            deptWarehouses.map((w) => (
              <span
                key={w.id}
                className="px-2 py-0.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300"
              >
                {w.code} ({w.name})
              </span>
            ))
          ) : (
            <span className="text-slate-500">Dùng chung Kho Nhà Máy</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPanel(panel === "stock" ? "none" : "stock")}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-bold transition-colors cursor-pointer ${
              panel === "stock"
                ? "bg-sky-700 text-white"
                : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-100"
            }`}
          >
            <Boxes className="w-3.5 h-3.5" />
            Tra nhanh tồn kho phòng
          </button>

          <button
            type="button"
            onClick={() => setPanel(panel === "history" ? "none" : "history")}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-bold transition-colors cursor-pointer ${
              panel === "history"
                ? "bg-indigo-700 text-white"
                : "bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50"
            }`}
          >
            <FileStack className="w-3.5 h-3.5" />
            Phiếu Nhập / Xuất &amp; Lịch sử kho
          </button>

          <button
            type="button"
            onClick={() => {
              setTransferSuccessMsg(null);
              setPanel(panel === "transfer" ? "none" : "transfer");
            }}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-bold transition-colors cursor-pointer ${
              panel === "transfer"
                ? "bg-teal-700 text-white"
                : "bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-800 hover:bg-teal-100"
            }`}
            title="Đề xuất / Điều chuyển nguyên vật liệu từ Kho Trung Tâm (KHO-TONG) về Kho nhánh phòng ban (không bắt buộc có Lệnh SX hay Dự án cụ thể)"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            🚚 + Chuyển NVL từ Kho Tổng về Kho Phòng
          </button>

          <button
            type="button"
            onClick={() => setPanel(panel === "requisition" ? "none" : "requisition")}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-bold transition-colors cursor-pointer ${
              panel === "requisition"
                ? "bg-emerald-700 text-white"
                : "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100"
            }`}
          >
            <PackagePlus className="w-3.5 h-3.5" />
            + Xuất / Lĩnh NVL tại kho
          </button>

          <button
            type="button"
            onClick={() => setPanel(panel === "pr" ? "none" : "pr")}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-bold transition-colors cursor-pointer ${
              panel === "pr"
                ? "bg-amber-600 text-white"
                : "bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 hover:bg-amber-100"
            }`}
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            + Báo thiếu / Đề nghị mua (PR)
          </button>

          <button
            type="button"
            onClick={() => navigateToHub("factory-warehouse")}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
            title="Mở phân hệ Kho Nhà Máy tập trung"
          >
            Kho Nhà Máy <ArrowUpRight className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={() => navigateToHub("factory-purchase")}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
            title="Mở phân hệ Cung Ứng NVL tập trung"
          >
            Cung Ứng NVL <ArrowUpRight className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={() => {
              const t = MODULE_IMPORT_TARGET[moduleKey];
              openExcelImportTemplate({
                templateKey: "INVENTORY_STOCK",
                deptFilter: t.deptCode,
                targetDeptCode: t.deptCode,
                targetWarehouseCode: t.warehouseCode,
              });
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 cursor-pointer"
            title="Mở Trung tâm Nhập liệu Excel kéo-thả & Tải biểu mẫu chuẩn cho phòng ban"
          >
            📥 Nhập Excel &amp; Biểu mẫu <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Bảng quản lý Công việc Phòng & Của tôi (liên thông 2 chiều với tab Điều Hành & Nhật ký Daily) */}
      <DepartmentWorkTasksBar
        deptCode={MODULE_IMPORT_TARGET[moduleKey].taskDeptCode}
        deptLabel={deptLabel}
      />

      {/* 1. Quick Department Stock Lookup Drawer */}
      {panel === "stock" && (
        <Card
          title={`Tồn kho khả dụng — ${deptLabel}`}
          actions={<Button variant="ghost" onClick={() => setPanel("none")}>Đóng</Button>}
        >
          <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mr-1">Phân loại:</span>
            <button
              type="button"
              onClick={() => setStockGroup("")}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                stockGroup === ""
                  ? "bg-slate-800 text-white border-slate-800 dark:bg-slate-100 dark:text-slate-900"
                  : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
              }`}
            >
              Tất cả{deptStock.data?.group_counts ? ` (${deptStock.data.group_counts.total_lots})` : ""}
            </button>
            <button
              type="button"
              onClick={() => setStockGroup("RAW")}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                stockGroup === "RAW"
                  ? "bg-sky-700 text-white border-sky-700"
                  : "bg-white dark:bg-slate-800 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800/70 hover:bg-sky-50"
              }`}
            >
              🧪 Nguyên liệu{deptStock.data?.group_counts ? ` (${deptStock.data.group_counts.raw_lots})` : ""}
            </button>
            <button
              type="button"
              onClick={() => setStockGroup("SEMI_FINISHED")}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                stockGroup === "SEMI_FINISHED"
                  ? "bg-violet-700 text-white border-violet-700"
                  : "bg-white dark:bg-slate-800 text-violet-800 dark:text-violet-300 border-violet-200 dark:border-violet-800/70 hover:bg-violet-50"
              }`}
            >
              ⚗️ Bán thành phẩm{deptStock.data?.group_counts ? ` (${deptStock.data.group_counts.semi_lots})` : ""}
            </button>
            <button
              type="button"
              onClick={() => setStockGroup("FINISHED")}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                stockGroup === "FINISHED"
                  ? "bg-emerald-700 text-white border-emerald-700"
                  : "bg-white dark:bg-slate-800 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/70 hover:bg-emerald-50"
              }`}
            >
              📦 Thành phẩm{deptStock.data?.group_counts ? ` (${deptStock.data.group_counts.finished_lots})` : ""}
            </button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 mb-3">
            <select
              className={inputClass}
              value={currentWhId}
              onChange={(e) => setSelectedWhId(e.target.value)}
            >
              <option value="">Tất cả kho được phép xem</option>
              {(warehouses.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
            <input
              className={inputClass}
              placeholder="Gõ tìm nhanh tên hóa chất, mã vật tư, số lô..."
              value={stockQ}
              onChange={(e) => setStockQ(e.target.value)}
            />
          </div>
          <ErrorNote error={deptStock.error} />
          {deptStock.data?.rows.length === 0 && <Empty>Không có lô tồn kho nào khớp bộ lọc.</Empty>}
          {deptStock.data && deptStock.data.rows.length > 0 && (
            <Table head={["Vật tư", "Phân loại", "Số lô", "Trạng thái", "Hạn dùng", "Kho · Vị trí", "Tồn", "Khả dụng", "Lịch sử"]}>
              {deptStock.data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5 pr-3 text-xs">
                    <b>{r.item_code}</b> — {r.item_name}
                  </td>
                  <td className="py-1.5 pr-3">
                    <StockCategoryBadge itemType={r.item_type} itemGroup={r.item_group} />
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{r.lot_code ?? "—"}</td>
                  <td className="py-1.5 pr-3">{r.lot_status ? <StatusBadge status={r.lot_status} /> : "—"}</td>
                  <td className="py-1.5 pr-3 text-xs whitespace-nowrap">{fmtDate(r.expiry_date)}</td>
                  <td className="py-1.5 pr-3 text-xs whitespace-nowrap">{r.warehouse_code} · {r.location_code}</td>
                  <td className="py-1.5 pr-3 text-right text-xs">{fmtQty(r.qty_on_hand)} {r.base_uom}</td>
                  <td className="py-1.5 pr-3 text-right text-xs font-bold text-emerald-700 dark:text-emerald-400">
                    {fmtQty(r.qty_available)} {r.base_uom}
                  </td>
                  <td className="py-1.5 pr-2 text-xs whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => {
                        setHistoryQ(r.item_code);
                        setPanel("history");
                      }}
                      className="text-indigo-600 dark:text-indigo-400 font-bold hover:underline cursor-pointer"
                    >
                      📜 Lịch sử
                    </button>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {/* 1B. Quick Department Warehouse Receipt / Supply / Issue History Drawer */}
      {panel === "history" && (
        <div className="space-y-3">
          {selectedDocId && <DocumentDetail key={selectedDocId} id={selectedDocId} onClose={() => setSelectedDocId(null)} />}
          <Card
            title={`📜 Phiếu Nhập / Xuất & Lịch sử Cấp phát Kho — ${deptLabel}`}
            actions={<Button variant="ghost" onClick={() => setPanel("none")}>Đóng</Button>}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setHistoryFlow("")}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition cursor-pointer ${
                    historyFlow === ""
                      ? "bg-indigo-700 text-white border-indigo-700"
                      : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700"
                  }`}
                >
                  📋 Tất cả giao dịch
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryFlow("SUPPLY_TRANSFER")}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition cursor-pointer ${
                    historyFlow === "SUPPLY_TRANSFER"
                      ? "bg-sky-700 text-white border-sky-700"
                      : "bg-white dark:bg-slate-800 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800"
                  }`}
                >
                  🚚 Lịch sử Cấp phát (Kho Tổng ➔ Kho Phòng)
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryFlow("PURCHASE_IN")}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition cursor-pointer ${
                    historyFlow === "PURCHASE_IN"
                      ? "bg-emerald-700 text-white border-emerald-700"
                      : "bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
                  }`}
                >
                  📥 Nhập mua hàng / Pha chế mới
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryFlow("PRODUCTION_OUT")}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition cursor-pointer ${
                    historyFlow === "PRODUCTION_OUT"
                      ? "bg-rose-700 text-white border-rose-700"
                      : "bg-white dark:bg-slate-800 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800"
                  }`}
                >
                  📤 Phiếu Xuất tiêu hao tại phòng
                </button>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 mb-3">
              <select
                className={inputClass}
                value={currentWhId}
                onChange={(e) => setSelectedWhId(e.target.value)}
              >
                <option value="">🌐 Tất cả các kho (Tra cứu cả Kho Tổng &amp; Kho Phòng)</option>
                {(warehouses.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
              <input
                className={inputClass}
                placeholder="🔍 Tìm mã vật tư, tên hóa chất, số lô, mã phiếu..."
                value={historyQ}
                onChange={(e) => setHistoryQ(e.target.value)}
              />
            </div>

            <ErrorNote error={deptHistory.error} />
            {deptHistory.data?.rows.length === 0 && (
              <Empty>Chưa có lịch sử phiếu nhập / cấp phát / phiếu xuất nào khớp bộ lọc.</Empty>
            )}
            {deptHistory.data && deptHistory.data.rows.length > 0 && (
              <Table
                head={[
                  "Ngày giờ",
                  "Mã phiếu",
                  "Nghiệp vụ",
                  "Vật tư / Hóa chất",
                  "Số lô",
                  "Từ Kho ➔ Đến Kho",
                  "Số lượng",
                  "Người thực hiện",
                ]}
              >
                {deptHistory.data.rows.map((mv) => (
                  <tr
                    key={mv.line_id}
                    onClick={() => setSelectedDocId(mv.document_id)}
                    className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 text-xs align-top"
                  >
                    <td className="py-2 pr-3 whitespace-nowrap text-slate-500">
                      {new Date(mv.occurred_at).toLocaleString("vi-VN", {
                        timeZone: "Asia/Ho_Chi_Minh",
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="py-2 pr-3 font-mono font-bold text-sky-700 dark:text-sky-400 whitespace-nowrap">
                      {mv.document_code}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {REASON_VI_LABEL[mv.reason_code] ?? mv.reason_code}
                      </div>
                      {mv.notes && <div className="text-[11px] text-slate-500">{mv.notes}</div>}
                    </td>
                    <td className="py-2 pr-3">
                      <b>{mv.item_code}</b> — {mv.item_name}
                    </td>
                    <td className="py-2 pr-3 font-mono">{mv.lot_code ?? "—"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {renderWarehouseFlow(mv.doc_type, mv.doc_warehouse_code, mv)}
                    </td>
                    <td
                      className={`py-2 pr-3 font-mono font-bold whitespace-nowrap ${
                        mv.doc_type === "RECEIPT" || mv.doc_type === "RETURN"
                          ? "text-emerald-700 dark:text-emerald-400"
                          : mv.doc_type === "ISSUE"
                            ? "text-rose-700 dark:text-rose-400"
                            : "text-sky-700 dark:text-sky-400"
                      }`}
                    >
                      {mv.doc_type === "RECEIPT" || mv.doc_type === "RETURN"
                        ? "+"
                        : mv.doc_type === "ISSUE"
                          ? "-"
                          : "➔ "}
                      {fmtQty(mv.qty)} {mv.uom}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{mv.performed_by_name ?? "Hệ thống"}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      )}

      {/* 2A. Quick Inter-Warehouse Material Transfer Drawer (Kho Trung Tâm KHO-TONG -> Kho Phòng Ban) */}
      {panel === "transfer" && (
        <Card
          title={`🚚 Đề xuất chuyển nguyên vật liệu từ Kho Trung Tâm về Kho ${deptLabel} (Chờ Thủ kho / Trưởng phòng Cung ứng duyệt)`}
          actions={<Button variant="ghost" onClick={() => setPanel("none")}>Đóng</Button>}
        >
          <form
            className="flex flex-col gap-3 text-xs"
            onSubmit={(e) => {
              e.preventDefault();
              setTransferSuccessMsg(null);
              postTransferMut.mutate();
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-teal-50/80 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800/80">
              <div className="text-[11px] text-teal-900 dark:text-teal-200">
                🔒 <b>Quy trình kiểm soát Kho Tổng (KHO-TONG ➔ Kho Phòng Ban):</b> Khi phòng ban gửi đề xuất chuyển kho tại đây, hệ thống sẽ tạo <b>Phiếu yêu cầu chuyển kho (Chờ duyệt)</b>. Tồn Kho Tổng chỉ được xuất chuyển sang <b>Kho nhánh {deptLabel}</b> sau khi <b>Thủ kho</b> hoặc <b>Trưởng bộ phận Cung ứng Kho</b> phê duyệt xuất cấp phát.
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPanel("requisition")}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-50 cursor-pointer"
                >
                  📤 Chuyển sang Xuất tiêu hao tại kho
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!prReason || prReason.includes("[MO") || prReason.includes("[PRJ")) {
                      setPrReason(transferNotes);
                      setPrPurposeEntityType(null);
                      setPrPurposeEntityId(null);
                    }
                    setPanel("pr");
                  }}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white dark:bg-slate-800 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 hover:bg-amber-50 cursor-pointer"
                >
                  🛒 Kho Tổng hết hàng? Lập Đề nghị mua (PR)
                </button>
              </div>
            </div>

            {deptPendingTransfers.length > 0 && (
              <div className="p-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-amber-900 dark:text-amber-200 text-xs">
                    ⏳ Phiếu yêu cầu chuyển kho từ Kho Tổng đang chờ Thủ kho / Trưởng phòng Cung ứng duyệt ({deptPendingTransfers.length} phiếu)
                  </span>
                  {!hubTransferOverview.data?.can_approve_transfer && (
                    <span className="text-[11px] text-amber-700 dark:text-amber-300">
                      Liên hệ Thủ kho hoặc Trưởng phòng Cung ứng để phê duyệt xuất kho
                    </span>
                  )}
                </div>
                <Table head={["Mã phiếu", "Người đề xuất", "Chi tiết vật tư & Lô đề xuất chuyển", "Lý do / Mục đích", "Trạng thái", "Thao tác"]}>
                  {deptPendingTransfers.map((t) => (
                    <tr key={t.id}>
                      <td className="py-1.5 pr-3 font-mono font-bold text-sky-700 dark:text-sky-400 whitespace-nowrap">{t.code}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{t.created_by_name ?? "Nhân sự phòng"}</td>
                      <td className="py-1.5 pr-3 text-xs font-mono">{t.line_summaries.join(" · ")}</td>
                      <td className="py-1.5 pr-3 text-xs text-slate-600 dark:text-slate-300">{t.notes ?? "—"}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        <StatusBadge status="QUARANTINE" label="Chờ Thủ kho / Cung ứng duyệt" />
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {hubTransferOverview.data?.can_approve_transfer && (
                            <Button
                              type="button"
                              onClick={() => approveTransferMut.mutate(t.id)}
                              disabled={approveTransferMut.isPending}
                            >
                              ✅ Duyệt &amp; Xuất kho
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => rejectTransferMut.mutate({ document_id: t.id, reason: "Hủy yêu cầu chuyển kho" })}
                            disabled={rejectTransferMut.isPending}
                          >
                            ✕ Hủy phiếu
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </Table>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-12">
              <div className="lg:col-span-3">
                <Field label="Từ Kho nguồn (Kho Trung Tâm) *">
                  <select
                    className={inputClass}
                    value={effectiveTransferSrcWhId}
                    onChange={(e) => {
                      setTransferSrcWhId(e.target.value);
                      setTransferLines([]);
                    }}
                    required
                  >
                    {(warehouses.data ?? []).map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code} — {w.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="lg:col-span-3">
                <Field label="Về Kho nhánh Phòng ban nhận *">
                  <select
                    className={inputClass}
                    value={effectiveTransferDstWhId}
                    onChange={(e) => setTransferDstWhId(e.target.value)}
                    required
                  >
                    {(warehouses.data ?? [])
                      .filter((w) => w.id !== effectiveTransferSrcWhId)
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.code} — {w.name}
                        </option>
                      ))}
                  </select>
                </Field>
              </div>

              <div className="lg:col-span-6">
                <Field label="Chọn nhanh Mục đích chuyển kho (Không bắt buộc có Lệnh SX / Dự án) *">
                  <select
                    className={inputClass}
                    value={transferReasonPreset}
                    onChange={(e) => {
                      const val = e.target.value;
                      setTransferReasonPreset(val);
                      if (val.startsWith("__GENERAL_")) {
                        const idx = Number(val.replace("__GENERAL_", "").replace("__", ""));
                        if (GENERAL_USAGE_PRESETS[idx]) {
                          setTransferNotes(GENERAL_USAGE_PRESETS[idx]);
                        }
                        return;
                      }
                      const found = selectedPrUnit?.reasons?.find((r) => r.id === val);
                      if (found) {
                        setTransferNotes(found.value);
                      }
                    }}
                  >
                    <optgroup label="📦 Dự trữ & Sử dụng chung tại phòng ban (Chưa có Lệnh SX / Dự án cụ thể)">
                      {GENERAL_USAGE_PRESETS.map((text, idx) => (
                        <option key={idx} value={`__GENERAL_${idx}__`}>
                          📦 {text}
                        </option>
                      ))}
                    </optgroup>
                    {groupedReasons.map(([cat, items]) => (
                      <optgroup key={cat} label={cat}>
                        {items.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                    <option value="__CUSTOM__">✍️ Tự gõ lý do / mục đích khác ở ô bên dưới...</option>
                  </select>
                </Field>
              </div>
            </div>

            <div>
              <Field label="Chi tiết Lý do / Ghi chú phiếu chuyển kho * (Mặc định: Dự trữ & sử dụng chung tại phòng ban)">
                <input
                  className={inputClass}
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                  placeholder={`VD: Dự trữ & sử dụng chung tại ${deptLabel} (Chưa có Lệnh SX / Dự án cụ thể)...`}
                  required
                />
              </Field>
            </div>

            <div>
              <Field label="Tìm & bấm chọn lô nguyên vật liệu đã duyệt (RELEASED) tại Kho Trung Tâm để chuyển về kho phòng:">
                <input
                  className={inputClass}
                  placeholder="🔍 Gõ mã vật tư, tên hóa chất, số lô trong Kho Trung Tâm rồi bấm vào dòng bên dưới để thêm..."
                  value={transferPickQ}
                  onChange={(e) => setTransferPickQ(e.target.value)}
                />
              </Field>
              {transferPickQ.trim().length > 0 && (
                <ul className="mt-1 max-h-44 overflow-auto rounded-xl border border-slate-200 dark:border-slate-800 text-xs divide-y divide-slate-100 dark:divide-slate-800/60">
                  {transferStockPick.isLoading && (
                    <li className="px-3 py-2 text-slate-400">Đang tìm lô khả dụng tại kho nguồn…</li>
                  )}
                  {!transferStockPick.isLoading && transferStockPick.data?.rows.length === 0 && (
                    <li className="px-3 py-2 text-slate-500">
                      Không tìm thấy lô khả dụng (RELEASED) nào tại kho nguồn khớp từ khóa.
                    </li>
                  )}
                  {transferStockPick.data?.rows.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-1.5 hover:bg-teal-50 dark:hover:bg-teal-950/40 cursor-pointer flex flex-wrap items-center justify-between gap-2"
                        onClick={() => {
                          setTransferLines((prev) =>
                            prev.some((x) => x.row.id === r.id) ? prev : [...prev, { row: r, qty: "1" }]
                          );
                        }}
                      >
                        <span>
                          <b>{r.item_code}</b> — {r.item_name} · Lô <span className="font-mono font-semibold">{r.lot_code ?? "—"}</span> ({r.warehouse_code} · {r.location_code})
                          {r.expiry_date ? ` · HSD: ${fmtDate(r.expiry_date)}` : ""}
                        </span>
                        <span className="font-bold text-teal-700 dark:text-teal-400">
                          Khả dụng: {fmtQty(r.qty_available)} {r.base_uom} ＋ Chọn
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {transferLines.length > 0 && (
              <Table head={["Nguyên vật liệu · Lô · Vị trí tại Kho nguồn", "Số lượng chuyển về Kho phòng", ""]}>
                {transferLines.map((l, idx) => (
                  <tr key={l.row.id}>
                    <td className="py-1.5 pr-3">
                      <b>{l.row.item_code}</b> — {l.row.item_name} · Lô <span className="font-mono">{l.row.lot_code ?? "—"}</span> ({l.row.warehouse_code} · {l.row.location_code})
                    </td>
                    <td className="py-1.5 pr-3 w-48">
                      <div className="flex items-center gap-1.5">
                        <input
                          className={inputClass}
                          inputMode="decimal"
                          placeholder={`Tối đa ${fmtQty(l.row.qty_available)}`}
                          value={l.qty}
                          onChange={(e) =>
                            setTransferLines(
                              transferLines.map((item, j) => (j === idx ? { ...item, qty: e.target.value } : item))
                            )
                          }
                          required
                        />
                        <span className="text-[11px] font-semibold text-slate-500 whitespace-nowrap">
                          / {fmtQty(l.row.qty_available)} {l.row.base_uom}
                        </span>
                      </div>
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      <button
                        type="button"
                        className="text-rose-600 font-bold cursor-pointer"
                        onClick={() => setTransferLines(transferLines.filter((_, j) => j !== idx))}
                      >
                        Xóa
                      </button>
                    </td>
                  </tr>
                ))}
              </Table>
            )}

            {transferSuccessMsg && (
              <div className="px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 font-semibold">
                ✅ {transferSuccessMsg}
              </div>
            )}
            <ErrorNote error={postTransferMut.error ?? approveTransferMut.error ?? rejectTransferMut.error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setPanel("none")}>Hủy</Button>
              <Button
                type="submit"
                disabled={
                  postTransferMut.isPending ||
                  transferLines.length === 0 ||
                  !effectiveTransferSrcWhId ||
                  !effectiveTransferDstWhId ||
                  effectiveTransferSrcWhId === effectiveTransferDstWhId
                }
              >
                {postTransferMut.isPending
                  ? "Đang gửi yêu cầu…"
                  : `📨 Gửi yêu cầu chuyển kho chờ Thủ kho / Cung ứng duyệt (${transferLines.length} dòng)`}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* 2B. Quick Material Issue / Consumption Drawer */}
      {panel === "requisition" && (
        <Card
          title={`Lập phiếu xuất / lĩnh vật tư nhanh (${deptLabel})`}
          actions={<Button variant="ghost" onClick={() => setPanel("none")}>Đóng</Button>}
        >
          <form
            className="flex flex-col gap-3 text-xs"
            onSubmit={(e) => {
              e.preventDefault();
              postIssueMut.mutate();
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70">
              <span className="text-[11px] text-emerald-900 dark:text-emerald-200">
                💡 <b>Xuất tiêu hao tại kho:</b> Ghi nhận vật tư xuất ra để sử dụng ngay (trừ trực tiếp tồn kho). Nếu bạn muốn <b>rút vật tư từ Kho Trung Tâm (KHO-TONG) về dự trữ tại Kho nhánh {deptLabel}</b>, hãy bấm nút bên phải:
              </span>
              <button
                type="button"
                onClick={() => setPanel("transfer")}
                className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-teal-700 hover:bg-teal-800 text-white cursor-pointer"
              >
                🚚 Chuyển NVL từ Kho Trung Tâm về Kho Phòng
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Kho xuất *">
                <select className={inputClass} value={targetIssueWhId} onChange={(e) => { setIssueWhId(e.target.value); setIssueLines([]); }}>
                  {(warehouses.data ?? []).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Mục đích xuất *">
                <select className={inputClass} value={issueReason} onChange={(e) => setIssueReason(e.target.value)}>
                  <option value="PRODUCTION">Xuất cho sản xuất / pha chế / sử dụng tại phòng</option>
                  <option value="RND">Xuất cho nghiên cứu R&amp;D / thử nghiệm</option>
                  <option value="QC_SAMPLE">Xuất mẫu kiểm nghiệm QC/QA</option>
                  <option value="OTHER">Sử dụng chung / Mục đích khác (Chưa gắn Lệnh SX)</option>
                </select>
              </Field>
              <Field label="Chọn nhanh Lý do (Không bắt buộc có Lệnh SX / Dự án)">
                <select
                  className={inputClass}
                  value=""
                  onChange={(e) => {
                    if (e.target.value) setIssueNotes(e.target.value);
                  }}
                >
                  <option value="">-- Chọn nhanh lý do sử dụng chung hoặc Lệnh SX / Dự án --</option>
                  <optgroup label="📦 Sử dụng chung (Chưa có Lệnh SX / Dự án cụ thể)">
                    {GENERAL_USAGE_PRESETS.map((text, idx) => (
                      <option key={idx} value={text}>
                        📦 {text}
                      </option>
                    ))}
                  </optgroup>
                  {groupedReasons.map(([cat, items]) => (
                    <optgroup key={cat} label={cat}>
                      {items.map((r) => (
                        <option key={r.id} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </Field>
            </div>

            <div>
              <Field label="Lý do xuất / Ghi chú mục đích sử dụng (Hoặc Mã Lệnh SX / Dự án nếu có) *">
                <input
                  className={inputClass}
                  value={issueNotes}
                  onChange={(e) => setIssueNotes(e.target.value)}
                  placeholder={defaultReasonPlaceholder ?? `VD: Sử dụng chung tại ${deptLabel} (Chưa có Lệnh SX / Dự án cụ thể)...`}
                  required
                />
              </Field>
            </div>

            <div>
              <input
                className={inputClass}
                placeholder="Tìm lô đã duyệt (RELEASED) trong kho rồi bấm để chọn xuất..."
                value={issuePickQ}
                onChange={(e) => setIssuePickQ(e.target.value)}
              />
              {issuePickQ.trim().length > 0 && (
                <ul className="mt-1 max-h-40 overflow-auto rounded-xl border border-slate-200 dark:border-slate-800 text-xs divide-y divide-slate-100 dark:divide-slate-800/60">
                  {issueStockPick.isLoading && (
                    <li className="px-3 py-2 text-slate-400">Đang tìm lô khả dụng…</li>
                  )}
                  {!issueStockPick.isLoading && issueStockPick.data?.rows.length === 0 && (
                    <li className="px-3 py-2 text-slate-500">
                      Không tìm thấy lô khả dụng (RELEASED) nào khớp từ khóa.
                    </li>
                  )}
                  {issueStockPick.data?.rows.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer"
                        onClick={() => setIssueLines([...issueLines, { row: r, qty: "" }])}
                      >
                        <b>{r.item_code}</b> — {r.item_name} · Lô <span className="font-mono">{r.lot_code ?? "—"}</span> ({r.location_code}) · Khả dụng: <b>{fmtQty(r.qty_available)} {r.base_uom}</b>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {issueLines.length > 0 && (
              <Table head={["Vật tư · Lô · Vị trí", "Số lượng xuất", ""]}>
                {issueLines.map((l, idx) => (
                  <tr key={idx}>
                    <td className="py-1.5 pr-3">
                      <b>{l.row.item_code}</b> — {l.row.item_name} · Lô <span className="font-mono">{l.row.lot_code ?? "—"}</span> ({l.row.location_code})
                    </td>
                    <td className="py-1.5 pr-3 w-40">
                      <input
                        className={inputClass}
                        inputMode="decimal"
                        placeholder={`Tối đa ${fmtQty(l.row.qty_available)} ${l.row.base_uom}`}
                        value={l.qty}
                        onChange={(e) =>
                          setIssueLines(issueLines.map((item, j) => (j === idx ? { ...item, qty: e.target.value } : item)))
                        }
                        required
                      />
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      <button
                        type="button"
                        className="text-rose-600 cursor-pointer"
                        onClick={() => setIssueLines(issueLines.filter((_, j) => j !== idx))}
                      >
                        Xóa
                      </button>
                    </td>
                  </tr>
                ))}
              </Table>
            )}

            <ErrorNote error={postIssueMut.error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setPanel("none")}>Hủy</Button>
              <Button type="submit" disabled={postIssueMut.isPending || issueLines.length === 0}>
                {postIssueMut.isPending ? "Đang ghi sổ…" : "Ghi sổ phiếu xuất"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* 3. Contextual Quick Purchase Requisition (PR) Drawer */}
      {panel === "pr" && (
        <Card
          title={`Báo thiếu / Đề nghị mua nguyên vật liệu (PR) — ${deptLabel}`}
          actions={<Button variant="ghost" onClick={() => setPanel("none")}>Đóng</Button>}
        >
          <form
            className="flex flex-col gap-3.5 text-xs"
            onSubmit={(e) => {
              e.preventDefault();
              createPrMut.mutate();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-12">
              <div className="lg:col-span-3">
                <Field label="Phòng đề nghị *">
                  <select
                    className={inputClass}
                    value={prOrgUnitId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setPrOrgUnitId(nextId);
                      const u = prOptions.data?.find((o) => o.id === nextId);
                      setPrWhId(u?.warehouses[0]?.id ?? "");
                      if (u?.reasons?.[0]) {
                        setPrReasonPreset(u.reasons[0].id);
                        setPrReason(u.reasons[0].value);
                        setPrPurposeEntityType(u.reasons[0].entity_type ?? null);
                        setPrPurposeEntityId(u.reasons[0].entity_id ?? null);
                      }
                    }}
                    required
                  >
                    <option value="">Chọn phòng</option>
                    {prOptions.data?.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.code} — {o.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="lg:col-span-3">
                <Field label="Kho nhánh nhận hàng *">
                  <select className={inputClass} value={prWhId} onChange={(e) => setPrWhId(e.target.value)} required>
                    <option value="">Chọn kho nhận</option>
                    {selectedPrUnit?.warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code} — {w.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="lg:col-span-2">
                <Field label="Cần trước ngày">
                  <input className={inputClass} type="date" value={prNeededBy} onChange={(e) => setPrNeededBy(e.target.value)} />
                </Field>
              </div>
              <div className="lg:col-span-4">
                <Field label="Chọn Lý do / Mã Lệnh SX / Dự án từ danh mục *">
                  <select
                    className={inputClass}
                    value={prReasonPreset}
                    onChange={(e) => {
                      const valId = e.target.value;
                      setPrReasonPreset(valId);
                      if (valId === "__CUSTOM__") {
                        setPrPurposeEntityType(null);
                        setPrPurposeEntityId(null);
                        return;
                      }
                      const found = selectedPrUnit?.reasons?.find((r) => r.id === valId);
                      if (found) {
                        setPrReason(found.value);
                        setPrPurposeEntityType(found.entity_type ?? null);
                        setPrPurposeEntityId(found.entity_id ?? null);
                      }
                    }}
                  >
                    <option value="">-- Chọn từ danh mục Lý do / Dự án / Lệnh SX có sẵn --</option>
                    {groupedReasons.map(([cat, items]) => (
                      <optgroup key={cat} label={cat}>
                        {items.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                    <option value="__CUSTOM__">✍️ Tự nhập lý do / mã tham chiếu khác...</option>
                  </select>
                </Field>
              </div>
            </div>

            <div>
              <Field label="Chi tiết Lý do / Mã Lệnh SX / Dự án / Ghi chú mục đích mua * (Có thể chọn ở trên hoặc gõ bổ sung)">
                <input
                  className={inputClass}
                  value={prReason}
                  onChange={(e) => setPrReason(e.target.value)}
                  placeholder={defaultReasonPlaceholder ?? `VD: Phục vụ dự án ${deptLabel} / Thí nghiệm ELN / Bổ sung định mức kho...`}
                  required
                />
              </Field>
            </div>

            {/* Thanh tiêu đề & nút thêm dòng đề nghị mua */}
            <div className="p-3 rounded-2xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/50 dark:bg-amber-950/20">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                  🧪 Danh sách Nguyên vật liệu / Hóa chất đề nghị mua ({prLines.length} dòng)
                  {allCatalogItems.data?.total ? (
                    <span className="font-normal text-[11px] text-slate-500 dark:text-slate-400">
                      · {allCatalogItems.data.total.toLocaleString("vi-VN")} mã trong danh mục
                    </span>
                  ) : null}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPrLines((prev) => [...prev, createEmptyPrLine("CATALOG")])}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white shadow-2xs cursor-pointer transition-colors"
                  >
                    + Thêm dòng chọn từ DS có sẵn
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrLines((prev) => [...prev, createEmptyPrLine("NEW")])}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-2xs cursor-pointer transition-colors"
                  >
                    ✨ + Gõ mã mới / Tên nguyên liệu mới
                  </button>
                </div>
              </div>
            </div>

            {prLines.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 font-bold border-b border-slate-200 dark:border-slate-700">
                      <th className="py-2 px-2.5 w-8 text-center">#</th>
                      <th className="py-2 px-2.5 w-36">Nguồn chọn</th>
                      <th className="py-2 px-2.5 min-w-[280px]">Mã &amp; Tên Nguyên vật liệu / Hóa chất *</th>
                      <th className="py-2 px-2.5 w-24 text-center">Số lượng *</th>
                      <th className="py-2 px-2.5 w-28 text-center">ĐVT *</th>
                      <th className="py-2 px-2.5 w-36 text-right">Đơn giá dự kiến</th>
                      <th className="py-2 px-2.5 w-44">Quy cách / Ghi chú dòng</th>
                      <th className="py-2 px-2 w-12 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {prLines.map((l, idx) => (
                      <tr key={idx} className="align-top hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                        <td className="py-2 px-2.5 text-center font-mono text-slate-400 pt-3">{idx + 1}</td>
                        <td className="py-2 px-2.5">
                          <select
                            className={inputClass}
                            value={l.mode}
                            onChange={(e) => {
                              const mode = e.target.value as "CATALOG" | "NEW";
                              updatePrLine(idx, { mode });
                            }}
                          >
                            <option value="CATALOG">📚 DS có sẵn</option>
                            <option value="NEW">✨ Gõ mã/tên mới</option>
                          </select>
                        </td>
                        <td className="py-2 px-2.5">
                          {l.mode === "CATALOG" ? (
                            <CatalogItemCombobox
                              value={l.item_id}
                              selectedLabel={l.label}
                              items={allCatalogItems.data?.rows ?? []}
                              totalCatalogCount={allCatalogItems.data?.total}
                              onSelect={(it) => {
                                updatePrLine(idx, {
                                  item_id: it.id,
                                  label: `${it.code} — ${it.name}`,
                                  uom:
                                    it.base_uom && !/^[-–—]+$/.test(it.base_uom.trim())
                                      ? it.base_uom
                                      : l.uom || "Hộp",
                                });
                              }}
                              onClear={() => updatePrLine(idx, { item_id: "", label: "" })}
                              onSwitchToNew={(typed) => {
                                const isCodeLike =
                                  /^[A-Za-z0-9._-]{2,30}$/.test(typed) && /[0-9._-]/.test(typed);
                                updatePrLine(idx, {
                                  mode: "NEW",
                                  item_id: "",
                                  label: "",
                                  new_item_code: isCodeLike ? typed.toUpperCase() : "",
                                  new_item_name: isCodeLike ? "" : typed,
                                });
                              }}
                            />
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-12 gap-1.5">
                              <div className="sm:col-span-4">
                                <input
                                  className={inputClass}
                                  placeholder="Mã mới (VD: NVL-RD-01)"
                                  value={l.new_item_code}
                                  onChange={(e) => updatePrLine(idx, { new_item_code: e.target.value.toUpperCase() })}
                                  title="Nhập mã nguyên vật liệu mới (hoặc để trống hệ thống tự cấp mã)"
                                />
                              </div>
                              <div className="sm:col-span-5">
                                <input
                                  className={inputClass}
                                  placeholder="Tên nguyên liệu / hóa chất mới *"
                                  value={l.new_item_name}
                                  onChange={(e) => updatePrLine(idx, { new_item_name: e.target.value })}
                                  required={l.mode === "NEW"}
                                />
                              </div>
                              <div className="sm:col-span-3">
                                <select
                                  className={inputClass}
                                  value={l.item_type}
                                  onChange={(e) =>
                                    updatePrLine(idx, {
                                      item_type: e.target.value as PrDraftLine["item_type"],
                                    })
                                  }
                                  title="Phân loại vật tư mới"
                                >
                                  <option value="RAW_MATERIAL">Nguyên liệu</option>
                                  <option value="REAGENT">Hóa chất/Thuốc thử</option>
                                  <option value="CONSUMABLE">Vật tư tiêu hao</option>
                                  <option value="COMPONENT">Linh kiện</option>
                                </select>
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2.5">
                          <input
                            className={`${inputClass} text-center font-bold`}
                            inputMode="decimal"
                            placeholder="SL"
                            value={l.qty}
                            onChange={(e) => updatePrLine(idx, { qty: e.target.value })}
                            required
                          />
                        </td>
                        <td className="py-2 px-2.5">
                          <select
                            className={`${inputClass} font-semibold`}
                            value={
                              mergedUomOptions.includes(l.uom) || !l.uom
                                ? l.uom || "Hộp"
                                : l.uom
                            }
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === "__CUSTOM_UOM__") {
                                const custom = window.prompt("Nhập Đơn vị tính (ĐVT) khác:", l.uom || "");
                                if (custom && custom.trim()) {
                                  updatePrLine(idx, { uom: custom.trim() });
                                }
                                return;
                              }
                              updatePrLine(idx, { uom: val });
                            }}
                            required
                          >
                            {l.uom && !DEFAULT_UOM_SUGGESTIONS.includes(l.uom) && (
                              <option value={l.uom}>{l.uom}</option>
                            )}
                            {DEFAULT_UOM_GROUPS.map((grp) => (
                              <optgroup key={grp.group} label={grp.group}>
                                {grp.items.map((it) => (
                                  <option key={it.code} value={it.code}>
                                    {it.label}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                            {(uoms.data ?? [])
                              .filter((u) => !DEFAULT_UOM_SUGGESTIONS.includes(u.code))
                              .map((u) => (
                                <option key={u.code} value={u.code}>
                                  {u.code}
                                </option>
                              ))}
                            <option value="__CUSTOM_UOM__">✍️ + Gõ ĐVT khác...</option>
                          </select>
                        </td>
                        <td className="py-2 px-2.5">
                          <input
                            className={`${inputClass} text-right font-mono`}
                            inputMode="numeric"
                            placeholder="0"
                            value={l.est_price}
                            onChange={(e) => updatePrLine(idx, { est_price: e.target.value.replace(/\D/g, "") })}
                          />
                        </td>
                        <td className="py-2 px-2.5">
                          <input
                            className={inputClass}
                            placeholder="Quy cách, hãng, CAS..."
                            value={l.notes}
                            onChange={(e) => updatePrLine(idx, { notes: e.target.value })}
                          />
                        </td>
                        <td className="py-2 px-2 text-center pt-3">
                          <button
                            type="button"
                            className="text-rose-600 hover:text-rose-700 font-bold cursor-pointer"
                            onClick={() =>
                              setPrLines((prev) =>
                                prev.length > 1 ? prev.filter((_, j) => j !== idx) : [createEmptyPrLine("CATALOG")]
                              )
                            }
                            title="Xóa dòng này"
                          >
                            Xóa
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <datalist id={`pr-uom-list-${moduleKey}`}>
                  {mergedUomOptions.map((code) => (
                    <option key={code} value={code} />
                  ))}
                </datalist>
              </div>
            )}

            <ErrorNote error={createPrMut.error ?? prOptions.error} />
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-slate-500">
                💡 Bạn có thể chọn vật tư có sẵn trong kho hoặc chuyển cột <b>Nguồn chọn</b> sang <b>✨ Gõ mã/tên mới</b> để đề nghị mua vật tư mới chưa có trong danh mục.
              </span>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setPanel("none")}>Hủy</Button>
                <Button type="submit" disabled={createPrMut.isPending || validPrLines.length === 0 || !prReason.trim()}>
                  {createPrMut.isPending ? "Đang gửi…" : `Lưu đề nghị mua (${validPrLines.length} mục → Chuyển sang Cung Ứng NVL)`}
                </Button>
              </div>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

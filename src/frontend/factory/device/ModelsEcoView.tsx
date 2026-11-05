"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate } from "../api";
import { Button, ErrorNote, Field, inputClass, StatusBadge } from "../ui";
import {
  ECO_STATUS,
  MODEL_CATEGORY_LABELS,
  REVISION_STATUS,
  useDeviceOptions,
  type TechPartInventoryItem,
} from "./shared";

const REV_ACTION_LABELS: Record<string, string> = {
  release: "Phát hành phiên bản DMR (Ký điện tử)",
  obsolete: "Thu hồi hiệu lực (OBSOLETE)",
};

const ECO_ACTION_LABELS: Record<string, string> = {
  start_impact: "Bắt đầu đánh giá ảnh hưởng",
  submit_approval: "Trình hội đồng phê duyệt ECO",
  approve: "Hội đồng ký duyệt ECO",
  reject: "Từ chối ECO",
  implement: "Ban hành hiệu lực (Nâng phiên bản DMR)",
  close: "Xác minh & Đóng ECO",
};

export interface LegacyEquipmentBOMItem {
  id: string;
  partCode: string;
  partName: string;
  category: string;
  quantity: number;
  unit: string;
  unitCost: number;
  station: string;
  sourceType?: "BUY" | "OUTSOURCE";
  preferredVendor?: string;
  drawingFile?: string;
  notes?: string;
}

export interface LegacyStandardAccessory {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  specs?: string;
}

export interface LegacyOptionalAccessory {
  id: string;
  code: string;
  name: string;
  quantity: number;
  unit: string;
  price: number;
}

interface BomLineRow {
  id: string;
  line_no: number;
  station_code: string;
  station_label?: string | null;
  item_code: string;
  item_name: string;
  qty_per_unit: number;
  uom: string;
  display_uom?: string | null;
  unit_cost?: number;
  part_category?: string | null;
  preferred_vendor?: string | null;
  source_type: string;
  is_critical: boolean;
  requires_serial: boolean;
  tracking_type?: "SERIAL" | "LOT" | "BULK";
  drawing_code?: string | null;
  notes: string | null;
  stock_qty?: number;
}

interface RevisionDetail {
  id: string;
  revision: string;
  firmware_version: string | null;
  dmr_summary: string;
  effectivity_type: string;
  effectivity_value: string | null;
  eco_code: string | null;
  released_by_name: string | null;
  released_at: string | null;
  status: string;
  version: number;
  bom_lines: BomLineRow[];
  actions: AllowedAction[];
}

interface EcoDetail {
  id: string;
  code: string;
  target_revision: string;
  title: string;
  reason: string;
  change_summary: string;
  impact_documents: string | null;
  impact_training: string | null;
  impact_stock: string | null;
  impact_open_orders: string | null;
  impact_regulatory: string | null;
  effectivity_type: string;
  effectivity_value: string | null;
  proposer_name: string | null;
  approved_by_name: string | null;
  verification_note: string | null;
  status: string;
  version: number;
  actions: AllowedAction[];
}

export interface CatalogModelRow {
  id: string;
  code: string;
  name: string;
  org_unit_id: string;
  org_unit_name: string;
  category: string;
  category_label?: string | null;
  manufacturer?: string | null;
  origin?: string | null;
  price: number;
  price_dealer1: number;
  price_dealer2: number;
  warranty_months: number;
  lead_time_days: number;
  required_burn_in_hours: number;
  image_url?: string | null;
  description: string | null;
  current_revision: string | null;
  current_firmware: string | null;
  specs_json?: Record<string, string>;
  baseline_specs_json?: Record<string, string>;
  accessories_standard?: LegacyStandardAccessory[] | string[];
  accessories_optional?: LegacyOptionalAccessory[];
  production_stages?: string[];
  bom_json?: LegacyEquipmentBOMItem[];
  base_model_code?: string | null;
  unit_count: number;
  eco_count?: number;
  status: string;
  revisions?: RevisionDetail[];
  ecos?: EcoDetail[];
}

const DEFAULT_STATIONS = [
  "1. Lắp ráp Khung Cơ khí & Vỏ máy",
  "2. Lắp đặt Cụm Gia nhiệt / Cảm biến / Quang học",
  "3. Đấu nối Điện - Điện tử & Bo mạch chính",
  "4. Nạp Firmware, Hiệu chuẩn & Chạy thử (Burn-in)",
];

const PART_CATEGORIES = [
  "Bo mạch & Điện tử",
  "Cơ khí & Vỏ máy",
  "Quang học & Cảm biến",
  "Cơ - Nhiệt",
  "Khí động & Lọc",
  "Nguồn & Phụ kiện",
  "Vật tư tiêu hao",
];

function EquipmentThumbnail({ code, name, category, imageUrl }: { code: string; name: string; category: string; imageUrl?: string | null }) {
  const c = code.toUpperCase();
  const isDefaultImg = !imageUrl || imageUrl === "/logo_abt.png" || imageUrl.startsWith("/equipment/");

  if (!isDefaultImg) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className="max-w-full max-h-full object-contain"
        onError={(e) => {
          (e.target as HTMLImageElement).src = "/logo_abt.png";
        }}
      />
    );
  }

  // 1. PCR Cabinet / Biosafety Cabinet on stand (PCR-WD8, PCR-W10, PCR-W8, BSC-*, ISA2-*)
  if (c.startsWith("PCR-W") || c.startsWith("BSC-") || c.startsWith("ISA2-")) {
    return (
      <svg viewBox="0 0 100 100" className="w-20 h-20">
        {/* Stand legs */}
        <line x1="24" y1="62" x2="24" y2="92" stroke="#475569" strokeWidth="3" />
        <line x1="76" y1="62" x2="76" y2="92" stroke="#475569" strokeWidth="3" />
        <line x1="24" y1="84" x2="76" y2="84" stroke="#64748b" strokeWidth="2.5" />
        <circle cx="24" cy="94" r="2.5" fill="#1e293b" />
        <circle cx="76" cy="94" r="2.5" fill="#1e293b" />
        {/* Upper hood */}
        <rect x="18" y="10" width="64" height="52" rx="3" fill="#f1f5f9" stroke="#64748b" strokeWidth="2" />
        <rect x="18" y="10" width="64" height="14" rx="2" fill="#e2e8f0" stroke="#64748b" strokeWidth="1.5" />
        {/* Blue control panel */}
        <rect x="64" y="13" width="12" height="8" rx="1" fill="#2563eb" />
        <rect x="24" y="14" width="22" height="4" rx="1" fill="#1e40af" />
        {/* Glass sash & UV glow */}
        <rect x="23" y="26" width="54" height="28" rx="1.5" fill="#dbeafe" stroke="#93c5fd" strokeWidth="1.5" />
        <line x1="28" y1="30" x2="72" y2="30" stroke="#60a5fa" strokeWidth="2" />
        {/* Work surface */}
        <rect x="20" y="56" width="60" height="6" fill="#3b82f6" />
      </svg>
    );
  }

  // 2. Slide Stainer / RDB / Cytology / Scanner benchtop unit (INS-24, IMS-24, ICP-D2, RDB-A15, IPS-*, LCM-16)
  if (c.startsWith("INS-") || c.startsWith("IMS-") || c.startsWith("ICP-") || c.startsWith("RDB-") || c.startsWith("IPS-") || c.startsWith("LCM-")) {
    return (
      <svg viewBox="0 0 100 100" className="w-20 h-20">
        {/* Base body */}
        <rect x="10" y="34" width="80" height="44" rx="5" fill="#f8fafc" stroke="#64748b" strokeWidth="2" />
        {/* Blue curved top cover / window */}
        <path d="M 14 34 L 22 20 L 78 20 L 86 34 Z" fill="#2563eb" stroke="#1d4ed8" strokeWidth="1.5" />
        {/* Dark acrylic viewing window */}
        <rect x="22" y="38" width="56" height="20" rx="2" fill="#1e293b" stroke="#475569" strokeWidth="1.5" />
        {/* Slide racks inside */}
        <rect x="27" y="43" width="10" height="10" rx="1" fill="#38bdf8" opacity="0.8" />
        <rect x="41" y="43" width="10" height="10" rx="1" fill="#818cf8" opacity="0.8" />
        <rect x="55" y="43" width="10" height="10" rx="1" fill="#34d399" opacity="0.8" />
        {/* Bottom blue trim & touch screen */}
        <rect x="12" y="66" width="76" height="8" rx="2" fill="#1d4ed8" />
        <rect x="68" y="59" width="14" height="6" rx="1" fill="#0ea5e9" />
      </svg>
    );
  }

  // 3. Nucleic Acid Extractor / Real-Time PCR Cycler (EZ32, EZ16, EZ01, EQ-PCR-96, EQ-EXT-32, QPCR48, FQS-16, POC-01)
  if (category === "EXTRACTOR" || category === "THERMAL_CYCLER" || c.startsWith("EZ") || c.startsWith("EQ-") || c.startsWith("FQS") || c.startsWith("QPCR")) {
    return (
      <svg viewBox="0 0 100 100" className="w-20 h-20">
        <rect x="18" y="14" width="64" height="72" rx="7" fill="#f1f5f9" stroke="#475569" strokeWidth="2" />
        {/* Top lid */}
        <rect x="22" y="18" width="56" height="14" rx="4" fill="#1e293b" />
        {/* Touchscreen HMI */}
        <rect x="28" y="36" width="44" height="24" rx="3" fill="#0284c7" stroke="#0369a1" strokeWidth="1.5" />
        <polyline points="32,54 40,46 48,49 58,40 68,42" fill="none" stroke="#38bdf8" strokeWidth="2" />
        {/* Chamber door */}
        <rect x="26" y="64" width="48" height="16" rx="2" fill="#cbd5e1" stroke="#64748b" strokeWidth="1.5" />
        <rect x="42" y="69" width="16" height="3" rx="1" fill="#2563eb" />
      </svg>
    );
  }

  // Default Lab Equipment Icon + ABT Logo badge
  return (
    <svg viewBox="0 0 100 100" className="w-20 h-20">
      <rect x="16" y="22" width="68" height="58" rx="6" fill="#f8fafc" stroke="#64748b" strokeWidth="2" />
      <rect x="22" y="28" width="56" height="12" rx="2" fill="#1e40af" />
      <text x="50" y="37" textAnchor="middle" fill="#ffffff" fontSize="8" fontWeight="bold" fontFamily="monospace">
        ABT BIOLAB
      </text>
      <rect x="24" y="45" width="32" height="24" rx="3" fill="#dbeafe" stroke="#60a5fa" strokeWidth="1.5" />
      <circle cx="68" cy="52" r="6" fill="#0ea5e9" />
      <rect x="62" y="62" width="12" height="6" rx="1.5" fill="#334155" />
    </svg>
  );
}

function normalizeStandardAccessories(raw: unknown): LegacyStandardAccessory[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, idx) => {
    if (typeof item === "string") {
      return { id: `std-${idx + 1}`, name: item, quantity: 1, unit: "Bộ", specs: "Tiêu chuẩn theo máy" };
    }
    const obj = (item ?? {}) as Record<string, unknown>;
    return {
      id: String(obj.id || `std-${idx + 1}`),
      name: String(obj.name || ""),
      quantity: Number(obj.quantity) || 1,
      unit: String(obj.unit || "Cái"),
      specs: obj.specs ? String(obj.specs) : "",
    };
  });
}

function normalizeOptionalAccessories(raw: unknown): LegacyOptionalAccessory[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, idx) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    return {
      id: String(obj.id || `opt-${idx + 1}`),
      code: String(obj.code || `OPT-0${idx + 1}`),
      name: String(obj.name || ""),
      quantity: Number(obj.quantity) || 1,
      unit: String(obj.unit || "Cái"),
      price: Number(obj.price) || 0,
    };
  });
}

function normalizeBomItems(model: CatalogModelRow | undefined): LegacyEquipmentBOMItem[] {
  if (!model) return [];
  if (Array.isArray(model.bom_json) && model.bom_json.length > 0) {
    return model.bom_json.map((b, idx) => ({
      id: b.id || `bom-${idx + 1}`,
      partCode: b.partCode || `PART-${idx + 1}`,
      partName: b.partName || "",
      category: b.category || "Bo mạch & Điện tử",
      quantity: Number(b.quantity) || 1,
      unit: b.unit || "Cái",
      unitCost: Number(b.unitCost) || 0,
      station: b.station || DEFAULT_STATIONS[0],
      sourceType: b.sourceType === "OUTSOURCE" ? "OUTSOURCE" : "BUY",
      preferredVendor: b.preferredVendor || "",
      drawingFile: b.drawingFile || "",
      notes: b.notes || "",
    }));
  }
  const firstRev = model.revisions?.[0];
  if (firstRev && Array.isArray(firstRev.bom_lines) && firstRev.bom_lines.length > 0) {
    return firstRev.bom_lines.map((bl) => ({
      id: bl.id,
      partCode: bl.item_code,
      partName: bl.item_name,
      category: bl.part_category || "Bo mạch & Điện tử",
      quantity: Number(bl.qty_per_unit) || 1,
      unit: bl.display_uom || bl.uom || "Cái",
      unitCost: Number(bl.unit_cost) || 0,
      station: bl.station_label || DEFAULT_STATIONS[0],
      sourceType: bl.source_type === "SUBCONTRACT" ? "OUTSOURCE" : "BUY",
      preferredVendor: bl.preferred_vendor || "",
      drawingFile: bl.drawing_code || "",
      notes: bl.notes || "",
    }));
  }
  return [];
}

function EcoImpactEditor({ eco, onDone }: { eco: EcoDetail; onDone: () => void }) {
  const [form, setForm] = useState({
    impact_documents: eco.impact_documents ?? "",
    impact_training: eco.impact_training ?? "",
    impact_stock: eco.impact_stock ?? "",
    impact_open_orders: eco.impact_open_orders ?? "",
    impact_regulatory: eco.impact_regulatory ?? "",
  });
  const saveMut = useMutation({
    mutationFn: () =>
      api(`/api/factory/device/ecos/${eco.id}/actions`, {
        method: "POST",
        json: { action: "save_impact", version: eco.version, ...form },
      }),
    onSuccess: onDone,
  });

  return (
    <form
      className="grid grid-cols-1 md:grid-cols-2 gap-2 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 mt-2"
      onSubmit={(e) => {
        e.preventDefault();
        saveMut.mutate();
      }}
    >
      <div className="md:col-span-2 text-xs font-bold text-amber-300">
        Bảng đánh giá ảnh hưởng 5 chiều (Bắt buộc trước khi trình duyệt ECO {eco.code})
      </div>
      <Field label="1. Ảnh hưởng tài liệu DMR / SOP lắp ráp *">
        <input className={inputClass} value={form.impact_documents} onChange={(e) => setForm({ ...form, impact_documents: e.target.value })} required />
      </Field>
      <Field label="2. Ảnh hưởng đào tạo kỹ thuật viên *">
        <input className={inputClass} value={form.impact_training} onChange={(e) => setForm({ ...form, impact_training: e.target.value })} required />
      </Field>
      <Field label="3. Xử lý tồn kho linh kiện phiên bản cũ *">
        <input className={inputClass} value={form.impact_stock} onChange={(e) => setForm({ ...form, impact_stock: e.target.value })} required />
      </Field>
      <Field label="4. Ảnh hưởng lệnh lắp ráp đang chạy *">
        <input className={inputClass} value={form.impact_open_orders} onChange={(e) => setForm({ ...form, impact_open_orders: e.target.value })} required />
      </Field>
      <div className="md:col-span-2">
        <Field label="5. Ảnh hưởng hồ sơ đăng ký lưu hành / ISO 13485 *">
          <input className={inputClass} value={form.impact_regulatory} onChange={(e) => setForm({ ...form, impact_regulatory: e.target.value })} required />
        </Field>
      </div>
      <div className="md:col-span-2 flex items-center gap-2">
        <Button type="submit" disabled={saveMut.isPending}>Lưu đánh giá ảnh hưởng</Button>
        <ErrorNote error={saveMut.error} />
      </div>
    </form>
  );
}

export function ModelsEcoView({
  canManage,
  canEcoPropose,
  onStartImprovementProject,
}: {
  canManage: boolean;
  canEcoPropose: boolean;
  onStartImprovementProject?: (model: CatalogModelRow) => void;
}) {
  const qc = useQueryClient();
  const opts = useDeviceOptions();
  const partsInventory: TechPartInventoryItem[] = opts.data?.parts_inventory ?? [];

  const modelsQuery = useQuery({
    queryKey: ["factory", "device", "models"],
    queryFn: () => api<CatalogModelRow[]>("/api/factory/device/models"),
  });

  const models = modelsQuery.data ?? [];

  // Search & Filter state on Catalog Grid
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");

  // Create / Edit Equipment Modal state
  const [showEquipmentModal, setShowEquipmentModal] = useState(false);
  const [editingModel, setEditingModel] = useState<CatalogModelRow | null>(null);
  const [eqForm, setEqForm] = useState({
    code: "",
    name: "",
    org_unit_id: "",
    category: "OTHER",
    category_label: "Thiết bị phụ trợ phòng Lab",
    manufacturer: "CÔNG TY TNHH GIẢI PHÁP Y SINH ABT - CHI NHÁNH LONG HẬU",
    origin: "Việt Nam",
    price: "36300000",
    price_dealer1: "30855000",
    price_dealer2: "32670000",
    warranty_months: "24",
    lead_time_days: "30",
    required_burn_in_hours: "24",
    image_url: "/logo_abt.png",
    revision: "1.0",
    firmware_version: "v1.0.0",
    specs_list: [
      { key: "Kích thước ngoài (DxRxC)", value: "1000 x 742 x 1200 mm" },
      { key: "Kích thước trong (DxRxC)", value: "935 x 590 x 620 mm" },
      { key: "Công suất", value: "~180W" },
      { key: "Cường độ sáng", value: "≥ 750 lux" },
    ],
  });

  // BOM & ECO Modal state (Legacy 3-Tab Modal)
  const [selectedBomModelId, setSelectedBomModelId] = useState<string | null>(null);
  const [bomModalTab, setBomModalTab] = useState<"BOM" | "ACCESSORIES" | "SPECS_ECO">("BOM");
  const [isEditingBom, setIsEditingBom] = useState(false);
  const [bomCheckQty, setBomCheckQty] = useState<number>(1);
  const [mrpFilterMode, setMrpFilterMode] = useState<"ALL" | "SHORTAGE" | "ENOUGH" | "OUTSOURCE">("ALL");
  const [bomEditList, setBomEditList] = useState<LegacyEquipmentBOMItem[]>([]);
  const [stdAccEditList, setStdAccEditList] = useState<LegacyStandardAccessory[]>([]);
  const [optAccEditList, setOptAccEditList] = useState<LegacyOptionalAccessory[]>([]);
  const [stagesEditList, setStagesEditList] = useState<string[]>(DEFAULT_STATIONS);
  const [specsEditList, setSpecsEditList] = useState<{ key: string; value: string }[]>([]);
  const [selectedQuickPartId, setSelectedQuickPartId] = useState("");
  const [showPartPickerModal, setShowPartPickerModal] = useState(false);
  const [partPickerSearch, setPartPickerSearch] = useState("");
  const [selectedPickerPartCodes, setSelectedPickerPartCodes] = useState<string[]>([]);
  const [bomSaveNotice, setBomSaveNotice] = useState<string | null>(null);
  const bomFileInputRef = useRef<HTMLInputElement | null>(null);

  // DMR & ECO sub-forms inside Tab 3
  const [showAddRev, setShowAddRev] = useState(false);
  const [showAddEco, setShowAddEco] = useState(false);
  const [revForm, setRevForm] = useState({ revision: "", firmware_version: "v1.1.0", dmr_summary: "", clone_from_revision_id: "" });
  const [ecoForm, setEcoForm] = useState({
    target_revision: "",
    title: "",
    reason: "",
    change_summary: "",
    effectivity_type: "IMMEDIATE",
    effectivity_value: "",
  });
  const [verifyNote, setVerifyNote] = useState("");

  // Fetch detailed model when BOM modal is open
  const detailQuery = useQuery({
    queryKey: ["factory", "device", "model", selectedBomModelId],
    queryFn: () => api<CatalogModelRow>(`/api/factory/device/models/${selectedBomModelId}`),
    enabled: Boolean(selectedBomModelId),
  });

  const activeBomModel = detailQuery.data ?? models.find((m) => m.id === selectedBomModelId) ?? null;

  // Sync local editable states whenever activeBomModel loads
  useEffect(() => {
    if (!activeBomModel) return;
    setBomEditList(normalizeBomItems(activeBomModel));
    setStdAccEditList(normalizeStandardAccessories(activeBomModel.accessories_standard));
    setOptAccEditList(normalizeOptionalAccessories(activeBomModel.accessories_optional));
    setStagesEditList(
      Array.isArray(activeBomModel.production_stages) && activeBomModel.production_stages.length > 0
        ? activeBomModel.production_stages
        : DEFAULT_STATIONS
    );
    const specsObj = (activeBomModel.specs_json ?? {}) as Record<string, string>;
    setSpecsEditList(Object.entries(specsObj).map(([key, value]) => ({ key, value: String(value ?? "") })));
  }, [activeBomModel?.id, detailQuery.dataUpdatedAt]);

  // Distinct category labels for filter dropdown
  const categoryLabels = useMemo(() => {
    const set = new Set<string>();
    for (const m of models) {
      set.add(m.category_label || MODEL_CATEGORY_LABELS[m.category] || m.category);
    }
    return Array.from(set);
  }, [models]);

  const filteredModels = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return models.filter((m) => {
      const catLabel = m.category_label || MODEL_CATEGORY_LABELS[m.category] || m.category;
      if (categoryFilter !== "ALL" && catLabel !== categoryFilter) return false;
      if (!q) return true;
      return (
        m.code.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        catLabel.toLowerCase().includes(q)
      );
    });
  }, [models, searchTerm, categoryFilter]);

  const openBomModal = (model: CatalogModelRow, defaultTab: "BOM" | "ACCESSORIES" | "SPECS_ECO" = "BOM", edit = false) => {
    setSelectedBomModelId(model.id);
    setBomModalTab(defaultTab);
    setIsEditingBom(edit);
    setBomCheckQty(1);
    setMrpFilterMode("ALL");
    setBomSaveNotice(null);
    setBomEditList(normalizeBomItems(model));
    setStdAccEditList(normalizeStandardAccessories(model.accessories_standard));
    setOptAccEditList(normalizeOptionalAccessories(model.accessories_optional));
    setStagesEditList(
      Array.isArray(model.production_stages) && model.production_stages.length > 0
        ? model.production_stages
        : DEFAULT_STATIONS
    );
    const specsObj = (model.specs_json ?? {}) as Record<string, string>;
    setSpecsEditList(Object.entries(specsObj).map(([key, value]) => ({ key, value: String(value ?? "") })));
  };

  const openCreateEquipmentModal = () => {
    setEditingModel(null);
    setEqForm({
      code: "",
      name: "",
      org_unit_id: opts.data?.units?.[0]?.id ?? "",
      category: "OTHER",
      category_label: "Thiết bị phụ trợ phòng Lab",
      manufacturer: "CÔNG TY TNHH GIẢI PHÁP Y SINH ABT - CHI NHÁNH LONG HẬU",
      origin: "Việt Nam",
      price: "36300000",
      price_dealer1: "30855000",
      price_dealer2: "32670000",
      warranty_months: "24",
      lead_time_days: "30",
      required_burn_in_hours: "24",
      image_url: "/logo_abt.png",
      revision: "1.0",
      firmware_version: "v1.0.0",
      specs_list: [
        { key: "Kích thước ngoài (DxRxC)", value: "1000 x 742 x 1200 mm" },
        { key: "Kích thước trong (DxRxC)", value: "935 x 590 x 620 mm" },
        { key: "Công suất", value: "~180W" },
        { key: "Cường độ sáng", value: "≥ 750 lux" },
      ],
    });
    setShowEquipmentModal(true);
  };

  const openEditEquipmentModal = (model: CatalogModelRow) => {
    setEditingModel(model);
    const specsObj = (model.specs_json ?? {}) as Record<string, string>;
    const entries = Object.entries(specsObj).map(([key, value]) => ({ key, value: String(value ?? "") }));
    setEqForm({
      code: model.code,
      name: model.name,
      org_unit_id: model.org_unit_id,
      category: model.category || "OTHER",
      category_label: model.category_label || MODEL_CATEGORY_LABELS[model.category] || "Thiết bị phụ trợ phòng Lab",
      manufacturer: model.manufacturer || "CÔNG TY TNHH GIẢI PHÁP Y SINH ABT - CHI NHÁNH LONG HẬU",
      origin: model.origin || "Việt Nam",
      price: String(model.price || 0),
      price_dealer1: String(model.price_dealer1 || 0),
      price_dealer2: String(model.price_dealer2 || 0),
      warranty_months: String(model.warranty_months || 24),
      lead_time_days: String(model.lead_time_days || 30),
      required_burn_in_hours: String(model.required_burn_in_hours || 24),
      image_url: model.image_url || "/logo_abt.png",
      revision: model.current_revision || "1.0",
      firmware_version: model.current_firmware || "v1.0.0",
      specs_list: entries.length > 0 ? entries : [{ key: "Kích thước tổng thể", value: "Tiêu chuẩn ABT" }],
    });
    setShowEquipmentModal(true);
  };

  const saveEquipmentMut = useMutation({
    mutationFn: async () => {
      const specsRecord: Record<string, string> = {};
      for (const s of eqForm.specs_list) {
        if (s.key.trim()) specsRecord[s.key.trim()] = s.value.trim();
      }
      if (editingModel) {
        return api("/api/factory/device/models", {
          method: "POST",
          idempotent: true,
          json: {
            kind: "update_catalog_bom",
            model_id: editingModel.id,
            code: eqForm.code.trim().toUpperCase(),
            name: eqForm.name.trim(),
            category: eqForm.category,
            category_label: eqForm.category_label.trim(),
            manufacturer: eqForm.manufacturer.trim(),
            origin: eqForm.origin.trim(),
            price: Number(eqForm.price) || 0,
            price_dealer1: Number(eqForm.price_dealer1) || 0,
            price_dealer2: Number(eqForm.price_dealer2) || 0,
            warranty_months: Number(eqForm.warranty_months) || 24,
            lead_time_days: Number(eqForm.lead_time_days) || 30,
            required_burn_in_hours: Number(eqForm.required_burn_in_hours) || 24,
            image_url: eqForm.image_url.trim() || "/logo_abt.png",
            specs_json: specsRecord,
          },
        });
      }
      return api("/api/factory/device/models", {
        method: "POST",
        idempotent: true,
        json: {
          code: eqForm.code.trim().toUpperCase() || undefined,
          name: eqForm.name.trim(),
          org_unit_id: eqForm.org_unit_id || opts.data?.units?.[0]?.id,
          category: eqForm.category,
          category_label: eqForm.category_label.trim(),
          manufacturer: eqForm.manufacturer.trim(),
          origin: eqForm.origin.trim(),
          price: Number(eqForm.price) || 0,
          price_dealer1: Number(eqForm.price_dealer1) || 0,
          price_dealer2: Number(eqForm.price_dealer2) || 0,
          warranty_months: Number(eqForm.warranty_months) || 24,
          lead_time_days: Number(eqForm.lead_time_days) || 30,
          required_burn_in_hours: Number(eqForm.required_burn_in_hours) || 24,
          image_url: eqForm.image_url.trim() || "/logo_abt.png",
          revision: eqForm.revision.trim() || "1.0",
          firmware_version: eqForm.firmware_version.trim() || "v1.0.0",
          specs_json: specsRecord,
        },
      });
    },
    onSuccess: () => {
      setShowEquipmentModal(false);
      qc.invalidateQueries({ queryKey: ["factory", "device", "models"] });
      if (editingModel) {
        qc.invalidateQueries({ queryKey: ["factory", "device", "model", editingModel.id] });
      }
    },
  });

  const cloneUpgradeMut = useMutation({
    mutationFn: (model: CatalogModelRow) =>
      api<CatalogModelRow>("/api/factory/device/models", {
        method: "POST",
        idempotent: true,
        json: {
          kind: "clone_upgrade",
          source_model_id: model.id,
          target_revision: "2.0",
          upgrade_reason: `Tạo bản nâng cấp thế hệ mới (V2) kế thừa từ thiết bị ${model.code}`,
        },
      }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["factory", "device", "models"] });
      if (created?.id) {
        openBomModal(created, "SPECS_ECO", true);
      }
    },
  });

  const deleteModelMut = useMutation({
    mutationFn: (modelId: string) =>
      api("/api/factory/device/models", {
        method: "POST",
        idempotent: true,
        json: { kind: "delete_model", model_id: modelId },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "device", "models"] });
      if (selectedBomModelId) setSelectedBomModelId(null);
    },
  });

  const saveBomAndCatalogMut = useMutation({
    mutationFn: async () => {
      if (!activeBomModel) return;
      const specsRecord: Record<string, string> = {};
      for (const s of specsEditList) {
        if (s.key.trim()) specsRecord[s.key.trim()] = s.value.trim();
      }
      return api("/api/factory/device/models", {
        method: "POST",
        idempotent: true,
        json: {
          kind: "update_catalog_bom",
          model_id: activeBomModel.id,
          bom_json: bomEditList,
          accessories_standard: stdAccEditList,
          accessories_optional: optAccEditList,
          production_stages: stagesEditList.filter((s) => s.trim().length > 0),
          specs_json: specsRecord,
        },
      });
    },
    onSuccess: () => {
      setIsEditingBom(false);
      setBomSaveNotice("Đã lưu cấu trúc Cây định mức BOM, Phụ kiện & Quy trình vào CSDL thành công!");
      setTimeout(() => setBomSaveNotice(null), 4000);
      qc.invalidateQueries({ queryKey: ["factory", "device", "models"] });
      qc.invalidateQueries({ queryKey: ["factory", "device", "options"] });
      if (activeBomModel) {
        qc.invalidateQueries({ queryKey: ["factory", "device", "model", activeBomModel.id] });
      }
    },
  });

  // DMR Revision & ECO mutations inside Tab 3
  const addRevMut = useMutation({
    mutationFn: () =>
      api("/api/factory/device/models", {
        method: "POST",
        idempotent: true,
        json: {
          kind: "revision",
          model_id: activeBomModel?.id,
          ...revForm,
          clone_from_revision_id: revForm.clone_from_revision_id || null,
        },
      }),
    onSuccess: () => {
      setRevForm({ revision: "", firmware_version: "v1.1.0", dmr_summary: "", clone_from_revision_id: "" });
      setShowAddRev(false);
      if (activeBomModel) qc.invalidateQueries({ queryKey: ["factory", "device", "model", activeBomModel.id] });
      qc.invalidateQueries({ queryKey: ["factory", "device", "models"] });
    },
  });

  const addEcoMut = useMutation({
    mutationFn: () =>
      api("/api/factory/device/ecos", {
        method: "POST",
        idempotent: true,
        json: { model_id: activeBomModel?.id, ...ecoForm },
      }),
    onSuccess: () => {
      setEcoForm({ target_revision: "", title: "", reason: "", change_summary: "", effectivity_type: "IMMEDIATE", effectivity_value: "" });
      setShowAddEco(false);
      if (activeBomModel) qc.invalidateQueries({ queryKey: ["factory", "device", "model", activeBomModel.id] });
      qc.invalidateQueries({ queryKey: ["factory", "device", "models"] });
    },
  });

  // Helper to get stock quantity for a partCode
  const getPartStock = (partCode: string): number => {
    const found = partsInventory.find((p) => p.code.toUpperCase() === partCode.trim().toUpperCase());
    return found ? Number(found.stock_qty) : 0;
  };

  // Export BOM CSV
  const handleExportBomExcel = () => {
    if (!activeBomModel) return;
    const headers = [
      "STT",
      "Mã Linh Kiện",
      "Tên Linh Kiện / Vật Tư",
      "Nguồn Cung (BUY/OUTSOURCE)",
      "Nhà Cung Cấp / Gia Công",
      "Mã Bản Vẽ",
      "Nhóm Kỹ Thuật",
      "Công Đoạn Lắp Ráp",
      "Định Mức (1 Máy)",
      "ĐVT",
      "Đơn Giá Dự Kiến (VNĐ)",
      "Thành Tiền (VNĐ)",
      "Ghi Chú",
    ];
    const rows = bomEditList.map((item, idx) => [
      idx + 1,
      `"${(item.partCode || "").replace(/"/g, '""')}"`,
      `"${(item.partName || "").replace(/"/g, '""')}"`,
      `"${item.sourceType || "BUY"}"`,
      `"${(item.preferredVendor || "").replace(/"/g, '""')}"`,
      `"${(item.drawingFile || "").replace(/"/g, '""')}"`,
      `"${(item.category || "").replace(/"/g, '""')}"`,
      `"${(item.station || "").replace(/"/g, '""')}"`,
      item.quantity,
      `"${(item.unit || "").replace(/"/g, '""')}"`,
      item.unitCost,
      item.quantity * item.unitCost,
      `"${(item.notes || "").replace(/"/g, '""')}"`,
    ]);
    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `BOM_${activeBomModel.code}_Rev${activeBomModel.current_revision || "1.0"}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadBomTemplate = () => {
    const headers = [
      "STT",
      "Mã Linh Kiện",
      "Tên Linh Kiện / Vật Tư",
      "Nguồn Cung (BUY/OUTSOURCE)",
      "Nhà Cung Cấp / Gia Công",
      "Mã Bản Vẽ",
      "Nhóm Kỹ Thuật",
      "Công Đoạn Lắp Ráp",
      "Định Mức (1 Máy)",
      "ĐVT",
      "Đơn Giá Dự Kiến (VNĐ)",
      "Ghi Chú",
    ];
    const sampleRows = [
      [1, '"MCU-STM32H7"', '"Vi điều khiển STM32H743VIT6"', '"BUY"', '"DigiKey"', '""', '"Bo mạch & Điện tử"', '"3. Đấu nối Điện - Điện tử & Bo mạch chính"', 1, '"Con"', 380000, '"IC điều khiển chính"'],
      [2, '"CNC-BODY-01"', '"Khung vỏ máy gia công CNC sơn tĩnh điện"', '"OUTSOURCE"', '"Xưởng Cơ Khí Chính Xác"', '"CAD-BODY-V1.step"', '"Cơ khí & Vỏ máy"', '"1. Lắp ráp Khung Cơ khí & Vỏ máy"', 1, '"Bộ"', 2500000, '"Gia công theo bản vẽ"'],
    ];
    const csvContent = "\uFEFF" + [headers.join(","), ...sampleRows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "File_Mau_Nhap_BOM_Thiet_Bi_ABT.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportBomCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target?.result ?? "");
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length <= 1) return;
      const imported: LegacyEquipmentBOMItem[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map((c) => c.replace(/^"|"$/g, "").trim());
        if (cols.length < 3) continue;
        imported.push({
          id: `imp-${Date.now()}-${i}`,
          partCode: cols[1] || `PART-${i}`,
          partName: cols[2] || `Linh kiện #${i}`,
          sourceType: cols[3]?.toUpperCase() === "OUTSOURCE" ? "OUTSOURCE" : "BUY",
          preferredVendor: cols[4] || "",
          drawingFile: cols[5] || "",
          category: cols[6] || "Bo mạch & Điện tử",
          station: cols[7] || DEFAULT_STATIONS[0],
          quantity: Math.max(1, Number(cols[8]) || 1),
          unit: cols[9] || "Cái",
          unitCost: Math.max(0, Number(cols[10]) || 0),
          notes: cols[12] || cols[11] || "",
        });
      }
      if (imported.length > 0) {
        setBomEditList((prev) => [...prev, ...imported]);
        setIsEditingBom(true);
      }
    };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  };

  // MRP Summary Calculations for active BOM
  const mrpStats = useMemo(() => {
    const qty = Math.max(1, bomCheckQty);
    let totalShortageCost = 0;
    let totalUnitBomCost = 0;
    let shortageLinesCount = 0;
    let maxBuildableMachines = bomEditList.length === 0 ? 0 : 999999;
    let bottleneckPart = "Chưa có dữ liệu";

    for (const item of bomEditList) {
      const stock = getPartStock(item.partCode);
      const reqQty = item.quantity * qty;
      const diff = stock - reqQty;
      totalUnitBomCost += item.quantity * item.unitCost;
      if (diff < 0) {
        shortageLinesCount++;
        totalShortageCost += Math.abs(diff) * item.unitCost;
      }
      const possible = item.quantity > 0 ? Math.floor(stock / item.quantity) : 0;
      if (possible < maxBuildableMachines) {
        maxBuildableMachines = possible;
        bottleneckPart = `${item.partCode} (Tồn: ${stock}, Cần: ${item.quantity}/máy)`;
      }
    }
    if (maxBuildableMachines === 999999) maxBuildableMachines = 0;

    return {
      qty,
      totalShortageCost,
      totalUnitBomCost,
      shortageLinesCount,
      maxBuildableMachines,
      bottleneckPart,
    };
  }, [bomEditList, bomCheckQty, partsInventory]);

  const filteredBomLines = useMemo(() => {
    const qty = Math.max(1, bomCheckQty);
    return bomEditList.filter((item) => {
      const stock = getPartStock(item.partCode);
      const req = item.quantity * qty;
      if (mrpFilterMode === "SHORTAGE") return stock < req;
      if (mrpFilterMode === "ENOUGH") return stock >= req;
      if (mrpFilterMode === "OUTSOURCE") return item.sourceType === "OUTSOURCE";
      return true;
    });
  }, [bomEditList, bomCheckQty, mrpFilterMode, partsInventory]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header Banner matching legacy screenshot */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-5 border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-base font-black text-white uppercase tracking-wider flex items-center gap-2">
              DANH MỤC THIẾT BỊ ĐÃ CHUYỂN GIAO & ĐỊNH MỨC KỸ THUẬT (BOM)
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Các thiết bị đã hoàn tất nghiên cứu, sẵn sàng cho Kinh doanh báo giá và Xưởng nhận PO sản xuất.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto justify-end">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="🔍 Tìm mã máy, tên thiết bị..."
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:border-indigo-500 outline-none w-52"
            />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:border-indigo-500 outline-none"
            >
              <option value="ALL">Tất cả nhóm thiết bị ({models.length})</option>
              {categoryLabels.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <div className="bg-slate-950 px-3.5 py-1.5 rounded-xl border border-slate-800 text-xs text-slate-400">
              Tổng thiết bị thương mại: <strong className="text-white">{filteredModels.length} model</strong>
            </div>
            {canManage && (
              <button
                type="button"
                onClick={openCreateEquipmentModal}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-indigo-500/20 flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <span>+</span> Thêm Thiết Bị Mới
              </button>
            )}
          </div>
        </div>

        <ErrorNote error={modelsQuery.error} />

        {/* 2-Column Equipment Catalog Card Grid matching screenshot */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredModels.map((eq) => {
            const specEntries = Object.entries((eq.specs_json ?? {}) as Record<string, string>);
            const baselineSpecs = (eq.baseline_specs_json ?? {}) as Record<string, string>;
            const catLabel = eq.category_label || MODEL_CATEGORY_LABELS[eq.category] || eq.category;
            const revLabel = eq.current_revision || "1.0";
            const leadTime = eq.lead_time_days || 30;
            const priceVal = Number(eq.price) || 0;

            return (
              <div
                key={eq.id}
                className="bg-slate-950/90 border border-slate-800/90 rounded-2xl p-5 flex flex-col justify-between hover:border-indigo-500/40 transition-all shadow-md"
              >
                <div>
                  <div className="flex gap-4 mb-3">
                    <div className="w-24 h-24 rounded-xl bg-white p-2 shrink-0 flex items-center justify-center border border-slate-700 overflow-hidden shadow-inner">
                      <EquipmentThumbnail
                        code={eq.code}
                        name={eq.name}
                        category={eq.category}
                        imageUrl={eq.image_url}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono font-bold text-indigo-300 bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-500/30">
                            {eq.code}
                          </span>
                          <span className="text-[10px] font-mono font-bold bg-emerald-950/50 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded">
                            Rev {revLabel}
                          </span>
                          {eq.base_model_code && (
                            <span className="text-[10px] font-bold bg-purple-950/50 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded">
                              Kế thừa từ {eq.base_model_code}
                            </span>
                          )}
                          <span className="text-[11px] text-slate-400">{catLabel}</span>
                        </div>
                        {canManage && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => openEditEquipmentModal(eq)}
                              className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-900 rounded-lg transition-colors cursor-pointer"
                              title="Chỉnh sửa thông số thiết bị"
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm(`Xác nhận xóa / ngừng sản xuất thiết bị [${eq.code}] ${eq.name}?`)) {
                                  deleteModelMut.mutate(eq.id);
                                }
                              }}
                              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 rounded-lg transition-colors cursor-pointer"
                              title="Xóa thiết bị"
                            >
                              🗑️
                            </button>
                          </div>
                        )}
                      </div>

                      <h4 className="text-sm font-bold text-white mt-1.5 line-clamp-2">{eq.name}</h4>

                      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-400 flex-wrap">
                        <span>
                          Bảo hành: <strong className="text-cyan-400">{eq.warranty_months} tháng</strong>
                        </span>
                        <span>•</span>
                        <span>
                          Chế tạo: <strong className="text-slate-200">{leadTime} ngày</strong>
                        </span>
                      </div>

                      <div className="mt-1.5 text-xs font-bold text-emerald-400">
                        Giá niêm yết: {priceVal.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ
                      </div>
                    </div>
                  </div>

                  {/* Standard Technical Specs Box matching screenshot */}
                  <div className="bg-slate-900/90 p-3 rounded-xl border border-slate-800/90 mb-4 text-xs">
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">
                      Thông số kỹ thuật tiêu chuẩn (Rev {revLabel}):
                    </p>
                    <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                      {specEntries.slice(0, 4).map(([k, v], i) => {
                        const baseVal = baselineSpecs[k];
                        const isChanged = baseVal !== undefined && baseVal !== v;
                        return (
                          <div key={i} className="truncate">
                            <span className="text-slate-500">{k}: </span>
                            {isChanged ? (
                              <span>
                                <span className="line-through text-slate-600 mr-1">{baseVal}</span>
                                <span className="text-emerald-400 font-bold">{v}</span>
                              </span>
                            ) : (
                              <span className="text-slate-200 font-medium">{v}</span>
                            )}
                          </div>
                        );
                      })}
                      {specEntries.length === 0 && (
                        <div className="col-span-2 text-slate-500 italic">Chưa khai báo thông số kỹ thuật chi tiết</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card Bottom Action Bar matching screenshot */}
                <div className="flex flex-wrap justify-between items-center pt-3 border-t border-slate-800/80 gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        if (onStartImprovementProject) {
                          onStartImprovementProject(eq);
                        } else {
                          openBomModal(eq, "SPECS_ECO", false);
                        }
                      }}
                      className="px-3 py-1.5 bg-purple-950/50 hover:bg-purple-900/60 text-purple-300 border border-purple-500/30 rounded-lg text-xs font-bold transition-all cursor-pointer"
                      title="Mở dự án R&D nghiên cứu cải tiến thiết bị này"
                    >
                      🧬 Nghiên Cứu Cải Tiến
                    </button>
                    {canManage && (
                      <button
                        type="button"
                        disabled={cloneUpgradeMut.isPending}
                        onClick={() => cloneUpgradeMut.mutate(eq)}
                        className="px-3 py-1.5 bg-amber-950/40 hover:bg-amber-900/50 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-bold transition-all cursor-pointer"
                        title="Nhân bản thiết bị để phát triển thế hệ mới (V2, Pro, Plus...)"
                      >
                        📋 Tạo Bản Nâng Cấp (V2)
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => openBomModal(eq, "BOM", false)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-cyan-500/30 rounded-lg text-xs font-bold transition-all cursor-pointer"
                  >
                    ⚙️ Xem Cây BOM & Lịch Sử ECO {(eq.eco_count ?? 0) > 0 ? `(${eq.eco_count})` : ""}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ========================================================================
          MODAL 1: FULL LEGACY 3-TAB BOM, MRP SIMULATOR, ACCESSORIES & ECO/DMR
         ======================================================================== */}
      {selectedBomModelId && activeBomModel && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 md:p-6 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-[96vw] xl:max-w-7xl overflow-hidden shadow-2xl my-auto flex flex-col max-h-[92vh]">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-800 flex flex-wrap justify-between items-center bg-slate-950 shrink-0 gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2.5 py-0.5 bg-cyan-950 text-cyan-400 border border-cyan-500/30 rounded text-[10px] font-bold uppercase">
                    Hồ sơ BOM & Phân tích Vật tư (MRP)
                  </span>
                  <span className="text-xs font-mono font-bold text-indigo-400">{activeBomModel.code}</span>
                  <span className="text-xs font-mono text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/30">
                    Rev {activeBomModel.current_revision || "1.0"}
                  </span>
                  {/* Quick equipment switcher */}
                  <select
                    value={activeBomModel.id}
                    onChange={(e) => {
                      const nextModel = models.find((m) => m.id === e.target.value);
                      if (nextModel) openBomModal(nextModel, bomModalTab, false);
                    }}
                    className="ml-1 bg-slate-900 border border-slate-700 hover:border-indigo-500 rounded-lg px-2.5 py-1 text-xs text-slate-200 font-semibold outline-none cursor-pointer"
                  >
                    {models.map((item) => (
                      <option key={item.id} value={item.id}>
                        Đổi thiết bị: [{item.code}] {item.name}
                      </option>
                    ))}
                  </select>
                </div>
                <h3 className="text-base font-bold text-white mt-1">{activeBomModel.name}</h3>
                <p className="text-[11px] text-slate-400">
                  Xuất xứ: <strong className="text-slate-200">{activeBomModel.origin || "Việt Nam"}</strong> • Bảo hành:{" "}
                  <strong className="text-cyan-400">{activeBomModel.warranty_months} tháng</strong> • Giá niêm yết:{" "}
                  <strong className="text-emerald-400">{(Number(activeBomModel.price) || 0).toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ</strong>
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setIsEditingBom((v) => !v)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                      isEditingBom
                        ? "bg-amber-600 text-white border-amber-500 shadow-lg shadow-amber-500/20"
                        : "bg-slate-800 text-amber-400 border-amber-500/40 hover:bg-slate-700"
                    }`}
                  >
                    {isEditingBom ? "🔒 Đang Mở Chế Độ Chỉnh Sửa" : "✏️ Chỉnh Sửa Định Mức & Phụ Kiện"}
                  </button>
                )}
                {canManage && (
                  <button
                    type="button"
                    disabled={saveBomAndCatalogMut.isPending}
                    onClick={() => saveBomAndCatalogMut.mutate()}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow-lg shadow-emerald-500/20 cursor-pointer"
                  >
                    {saveBomAndCatalogMut.isPending ? "Đang lưu..." : "💾 Lưu Hồ Sơ BOM & Phụ Kiện"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedBomModelId(null)}
                  className="text-slate-400 hover:text-white text-lg px-2 cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            {bomSaveNotice && (
              <div className="bg-emerald-950/80 border-b border-emerald-500/40 px-5 py-2 text-xs font-bold text-emerald-300 flex items-center justify-between">
                <span>✅ {bomSaveNotice}</span>
                <button type="button" onClick={() => setBomSaveNotice(null)} className="text-emerald-400 hover:text-white">✕</button>
              </div>
            )}
            <ErrorNote error={saveBomAndCatalogMut.error} />

            {/* Sub-navigation Tabs inside Modal */}
            <div className="bg-slate-900 border-b border-slate-800 px-5 flex gap-2 shrink-0 overflow-x-auto">
              <button
                type="button"
                onClick={() => setBomModalTab("BOM")}
                className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                  bomModalTab === "BOM"
                    ? "border-cyan-400 text-cyan-400 bg-cyan-950/20"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                🔩 1. Cấu Trúc Linh Kiện (mBOM - {bomEditList.length} mã)
              </button>
              <button
                type="button"
                onClick={() => setBomModalTab("ACCESSORIES")}
                className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                  bomModalTab === "ACCESSORIES"
                    ? "border-indigo-400 text-indigo-400 bg-indigo-950/20"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                🎁 2. Phụ Kiện Đi Kèm & Tùy Chọn ({stdAccEditList.length + optAccEditList.length})
              </button>
              <button
                type="button"
                onClick={() => setBomModalTab("SPECS_ECO")}
                className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                  bomModalTab === "SPECS_ECO"
                    ? "border-emerald-400 text-emerald-400 bg-emerald-950/20"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                📋 3. Thông Số Kỹ Thuật, Quy Trình Lắp Ráp & Lịch Sử ECO / DMR ({activeBomModel.ecos?.length ?? 0})
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-5 flex-1">
              {/* ============================================================
                  TAB 1: CẤU TRÚC LINH KIỆN (mBOM) & MÔ PHỎNG MRP ĐỦ/THIẾU
                 ============================================================ */}
              {bomModalTab === "BOM" && (
                <>
                  {/* Quick Add from 30-part inventory + Excel Import/Export */}
                  <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-3 bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
                    <div>
                      <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                        Cấu Trúc Định Mức Vật Tư - Linh Kiện (Bill of Materials)
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Chọn nhanh từ Kho linh kiện ({partsInventory.length} mã), nhập/xuất file Excel (CSV) hoặc chỉnh sửa trực tiếp trên từng dòng.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto justify-end">
                      <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1">
                        <select
                          value={selectedQuickPartId}
                          onChange={(e) => setSelectedQuickPartId(e.target.value)}
                          className="bg-transparent text-xs text-slate-200 px-2 py-1 outline-none max-w-[230px]"
                        >
                          <option value="" className="bg-slate-900">
                            -- Chọn linh kiện từ kho ({partsInventory.length}) --
                          </option>
                          {partsInventory.map((p) => (
                            <option key={p.id} value={p.code} className="bg-slate-900">
                              [{p.code}] {p.name} (Tồn: {p.stock_qty} {p.unit})
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            if (!selectedQuickPartId) return;
                            const p = partsInventory.find((item) => item.code === selectedQuickPartId);
                            if (!p) return;
                            setIsEditingBom(true);
                            setBomEditList((prev) => {
                              const idx = prev.findIndex((x) => x.partCode === p.code);
                              if (idx >= 0) {
                                const next = [...prev];
                                next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
                                return next;
                              }
                              return [
                                ...prev,
                                {
                                  id: `bom-${Date.now()}`,
                                  partCode: p.code,
                                  partName: p.name,
                                  category: p.category,
                                  quantity: 1,
                                  unit: p.unit,
                                  unitCost: p.unit_cost,
                                  station: DEFAULT_STATIONS[0],
                                  sourceType: "BUY",
                                },
                              ];
                            });
                            setSelectedQuickPartId("");
                          }}
                          disabled={!selectedQuickPartId}
                          className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-xs font-bold rounded transition-all cursor-pointer"
                        >
                          + Thêm
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setPartPickerSearch("");
                          setSelectedPickerPartCodes([]);
                          setShowPartPickerModal(true);
                        }}
                        className="px-3 py-1.5 bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-500/40 text-xs font-bold rounded-lg transition-all cursor-pointer"
                      >
                        📦 Chọn Nhiều Từ Kho ({partsInventory.length})
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsEditingBom(true);
                          setBomEditList((prev) => [
                            ...prev,
                            {
                              id: `bom-${Date.now()}`,
                              partCode: `PART-${prev.length + 1}`,
                              partName: "Linh kiện / Vật tư mới",
                              category: "Bo mạch & Điện tử",
                              quantity: 1,
                              unit: "Cái",
                              unitCost: 150000,
                              station: DEFAULT_STATIONS[0],
                              sourceType: "BUY",
                            },
                          ]);
                        }}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-cyan-500/30 text-xs font-bold rounded-lg transition-all cursor-pointer"
                      >
                        + Dòng Tùy Chỉnh
                      </button>

                      <input
                        type="file"
                        ref={bomFileInputRef}
                        onChange={handleImportBomCsv}
                        accept=".csv,.txt"
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => bomFileInputRef.current?.click()}
                        className="px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-bold rounded-lg cursor-pointer"
                      >
                        📥 Nhập từ Excel/CSV
                      </button>
                      <button
                        type="button"
                        onClick={handleExportBomExcel}
                        className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-bold rounded-lg cursor-pointer"
                      >
                        📤 Xuất Excel/CSV
                      </button>
                      <button
                        type="button"
                        onClick={handleDownloadBomTemplate}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs rounded-lg cursor-pointer"
                      >
                        📄 File Mẫu
                      </button>
                    </div>
                  </div>

                  {/* MRP Simulator Box matching legacy rd-innovation-hub */}
                  <div className="bg-gradient-to-r from-slate-950 via-indigo-950/30 to-slate-950 p-4 rounded-xl border border-indigo-500/30 flex flex-col gap-3">
                    <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-indigo-400 uppercase tracking-wider">
                            📊 Phân Tích Đủ / Thiếu Linh Kiện (MRP)
                          </span>
                          <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 rounded text-[10px] font-bold">
                            Real-time Stock Check
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                          Nhập số lượng máy dự kiến sản xuất để hệ thống đối chiếu định mức BOM với tồn kho linh kiện thực tế:
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-2 bg-slate-900 px-3 py-1.5 rounded-xl border border-indigo-500/40">
                          <span className="text-xs text-slate-300 font-bold">Số lượng máy kiểm tra:</span>
                          <input
                            type="number"
                            min={1}
                            max={1000}
                            value={bomCheckQty}
                            onChange={(e) => setBomCheckQty(Math.max(1, Number(e.target.value) || 1))}
                            className="w-20 bg-slate-950 border border-indigo-500 rounded-lg px-2.5 py-1 text-sm font-black text-center text-amber-400 outline-none"
                          />
                          <span className="text-xs text-slate-400 font-bold">máy</span>
                        </div>
                        <div className="flex items-center gap-1">
                          {[1, 2, 5, 10, 20, 50].map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setBomCheckQty(preset)}
                              className={`px-2 py-1 rounded text-[11px] font-bold border transition-all cursor-pointer ${
                                bomCheckQty === preset
                                  ? "bg-indigo-600 text-white border-indigo-400"
                                  : "bg-slate-900 text-slate-400 border-slate-800 hover:text-white"
                              }`}
                            >
                              {preset} máy
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Filter pills */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-400 mr-1">Bộ lọc:</span>
                        <button
                          type="button"
                          onClick={() => setMrpFilterMode("ALL")}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                            mrpFilterMode === "ALL" ? "bg-slate-700 text-white" : "bg-slate-900 text-slate-400 hover:text-white"
                          }`}
                        >
                          Tất cả ({bomEditList.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setMrpFilterMode("SHORTAGE")}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                            mrpFilterMode === "SHORTAGE"
                              ? "bg-rose-600 text-white"
                              : "bg-rose-950/40 text-rose-400 border border-rose-500/30"
                          }`}
                        >
                          ⚠️ Thiếu ({mrpStats.shortageLinesCount})
                        </button>
                        <button
                          type="button"
                          onClick={() => setMrpFilterMode("ENOUGH")}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                            mrpFilterMode === "ENOUGH"
                              ? "bg-emerald-600 text-white"
                              : "bg-emerald-950/40 text-emerald-400 border border-emerald-500/30"
                          }`}
                        >
                          ✓ Đủ tồn ({Math.max(0, bomEditList.length - mrpStats.shortageLinesCount)})
                        </button>
                        <button
                          type="button"
                          onClick={() => setMrpFilterMode("OUTSOURCE")}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                            mrpFilterMode === "OUTSOURCE"
                              ? "bg-amber-600 text-white"
                              : "bg-amber-950/40 text-amber-400 border border-amber-500/30"
                          }`}
                        >
                          🛠️ Gia công ngoài ({bomEditList.filter((i) => i.sourceType === "OUTSOURCE").length})
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {bomEditList.some((i) => i.sourceType === "OUTSOURCE") && (
                          <button
                            type="button"
                            onClick={() => {
                              const outsourceItems = bomEditList.filter((i) => i.sourceType === "OUTSOURCE");
                              const headers = [
                                "STT",
                                "Mã Chi Tiết Gia Công",
                                "Tên Chi Tiết / Cụm Gia Công",
                                "Xưởng Gia Công Dự Kiến",
                                "Mã Bản Vẽ Kỹ Thuật",
                                `Số Lượng Đặt (${mrpStats.qty} Máy)`,
                                "ĐVT",
                                "Đơn Giá Dự Kiến",
                                "Thành Tiền",
                              ];
                              const rows = outsourceItems.map((it, idx) => [
                                idx + 1,
                                `"${it.partCode}"`,
                                `"${it.partName}"`,
                                `"${it.preferredVendor || "Xưởng Cơ Khí / SMT Đối Tác"}"`,
                                `"${it.drawingFile || `CAD-${it.partCode}.step`}"`,
                                it.quantity * mrpStats.qty,
                                `"${it.unit}"`,
                                it.unitCost,
                                it.quantity * mrpStats.qty * it.unitCost,
                              ]);
                              const csv = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
                              const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `Phieu_Dat_Gia_Cong_OPO_${activeBomModel.code}_${mrpStats.qty}May.csv`;
                              document.body.appendChild(a);
                              a.click();
                              document.body.removeChild(a);
                              URL.revokeObjectURL(url);
                              setBomSaveNotice(`Đã xuất Phiếu đặt gia công ngoài (OPO) cho ${outsourceItems.length} hạng mục (${mrpStats.qty} máy)!`);
                            }}
                            className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-[11px] font-bold shadow cursor-pointer"
                          >
                            🛠️ Đặt Gia Công Ngoài OPO ({mrpStats.qty} máy)
                          </button>
                        )}

                        {mrpStats.shortageLinesCount > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              const shortageItems = bomEditList.filter(
                                (it) => getPartStock(it.partCode) < it.quantity * mrpStats.qty
                              );
                              const headers = [
                                "STT",
                                "Mã Linh Kiện",
                                "Tên Linh Kiện Cần Mua",
                                "Nhóm Kỹ Thuật",
                                `Tổng Cần (${mrpStats.qty} Máy)`,
                                "Tồn Kho Hiện Tại",
                                "Số Lượng Cần Mua Bổ Sung",
                                "ĐVT",
                                "Đơn Giá Dự Kiến",
                                "Thành Tiền Dự Kiến",
                              ];
                              const rows = shortageItems.map((it, idx) => {
                                const st = getPartStock(it.partCode);
                                const req = it.quantity * mrpStats.qty;
                                const lack = Math.max(0, req - st);
                                return [
                                  idx + 1,
                                  `"${it.partCode}"`,
                                  `"${it.partName}"`,
                                  `"${it.category}"`,
                                  req,
                                  st,
                                  lack,
                                  `"${it.unit}"`,
                                  it.unitCost,
                                  lack * it.unitCost,
                                ];
                              });
                              const csv = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
                              const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `De_Nghi_Mua_Vat_Tu_PR_${activeBomModel.code}_${mrpStats.qty}May.csv`;
                              document.body.appendChild(a);
                              a.click();
                              document.body.removeChild(a);
                              URL.revokeObjectURL(url);
                              setBomSaveNotice(`Đã xuất Đề nghị mua vật tư thiếu (PR) cho ${shortageItems.length} mã linh kiện!`);
                            }}
                            className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-[11px] font-bold shadow cursor-pointer"
                          >
                            🛒 Đề Nghị Mua Vật Tư Thiếu (PR)
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 3 KPI Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                      <div
                        className={`p-3 rounded-xl border ${
                          mrpStats.shortageLinesCount === 0
                            ? "bg-emerald-950/30 border-emerald-500/40"
                            : "bg-rose-950/30 border-rose-500/40"
                        }`}
                      >
                        <p className="text-[10px] font-bold uppercase text-slate-400">
                          Kết luận đáp ứng ({mrpStats.qty} máy)
                        </p>
                        <p
                          className={`text-sm font-black mt-1 ${
                            mrpStats.shortageLinesCount === 0 ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {mrpStats.shortageLinesCount === 0
                            ? "✓ ĐỦ 100% LINH KIỆN SẢN XUẤT"
                            : `⚠️ THIẾU ${mrpStats.shortageLinesCount}trên ${bomEditList.length} MÃ LINH KIỆN`}
                        </p>
                      </div>

                      <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800">
                        <p className="text-[10px] font-bold uppercase text-slate-400">
                          Tồn kho hiện tại lắp được tối đa
                        </p>
                        <p className="text-sm font-black text-cyan-400 mt-1">
                          {mrpStats.maxBuildableMachines} máy hoàn chỉnh
                        </p>
                        <p className="text-[10px] text-slate-500 truncate mt-0.5">
                          Giới hạn bởi: {mrpStats.bottleneckPart}
                        </p>
                      </div>

                      <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800">
                        <p className="text-[10px] font-bold uppercase text-slate-400">
                          Chi phí mua bổ sung / Giá vốn BOM 1 máy
                        </p>
                        <p className="text-sm font-black text-amber-400 mt-1">
                          Cần mua thiếu: {mrpStats.totalShortageCost.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ
                        </p>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          Giá vốn định mức / 1 máy:{" "}
                          <strong className="text-emerald-400">{mrpStats.totalUnitBomCost.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ</strong>
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* 13-Column Interactive BOM Table */}
                  <div className="overflow-x-auto border border-slate-800 rounded-xl">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase">
                        <tr>
                          <th className="p-2.5">#</th>
                          <th className="p-2.5">Mã Linh Kiện</th>
                          <th className="p-2.5 min-w-[200px]">Tên Linh Kiện / Vật Tư</th>
                          <th className="p-2.5 min-w-[160px]">Nguồn Cung / Gia Công</th>
                          <th className="p-2.5">Nhóm Kỹ Thuật</th>
                          <th className="p-2.5">Công Đoạn / Trạm</th>
                          <th className="p-2.5 text-center">ĐM (1 Máy)</th>
                          <th className="p-2.5 text-center bg-indigo-950/40 text-indigo-300">Cần ({mrpStats.qty} Máy)</th>
                          <th className="p-2.5 text-center">Tồn Kho</th>
                          <th className="p-2.5 text-center">Đủ / Thiếu (MRP)</th>
                          <th className="p-2.5">ĐVT</th>
                          <th className="p-2.5 text-right">Đơn Giá</th>
                          <th className="p-2.5 text-right">Thành Tiền (1 Máy)</th>
                          {isEditingBom && <th className="p-2.5 text-center">Xóa</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 bg-slate-900/40">
                        {filteredBomLines.map((item, idx) => {
                          const realIndex = bomEditList.findIndex((x) => x.id === item.id);
                          const stockQty = getPartStock(item.partCode);
                          const reqQty = item.quantity * mrpStats.qty;
                          const diffQty = stockQty - reqQty;

                          return (
                            <tr
                              key={item.id || idx}
                              className={`hover:bg-slate-800/40 ${diffQty < 0 ? "bg-rose-950/10" : ""}`}
                            >
                              <td className="p-2.5 text-slate-500 font-mono">{idx + 1}</td>
                              <td className="p-2.5 font-mono font-bold text-indigo-400">
                                {isEditingBom ? (
                                  <input
                                    value={item.partCode}
                                    onChange={(e) => {
                                      const next = [...bomEditList];
                                      next[realIndex] = { ...item, partCode: e.target.value.toUpperCase() };
                                      setBomEditList(next);
                                    }}
                                    className="w-28 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-indigo-300 font-mono"
                                  />
                                ) : (
                                  item.partCode
                                )}
                              </td>
                              <td className="p-2.5 font-bold text-slate-200">
                                {isEditingBom ? (
                                  <input
                                    value={item.partName}
                                    onChange={(e) => {
                                      const next = [...bomEditList];
                                      next[realIndex] = { ...item, partName: e.target.value };
                                      setBomEditList(next);
                                    }}
                                    className="w-full min-w-[180px] bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                                  />
                                ) : (
                                  <div>
                                    <div>{item.partName}</div>
                                    {item.notes && <div className="text-[10px] text-slate-400 font-normal mt-0.5">📝 {item.notes}</div>}
                                  </div>
                                )}
                              </td>
                              <td className="p-2.5">
                                {isEditingBom ? (
                                  <div className="space-y-1 min-w-[150px]">
                                    <select
                                      value={item.sourceType || "BUY"}
                                      onChange={(e) => {
                                        const next = [...bomEditList];
                                        next[realIndex] = {
                                          ...item,
                                          sourceType: e.target.value as "BUY" | "OUTSOURCE",
                                        };
                                        setBomEditList(next);
                                      }}
                                      className="w-full bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-amber-300 font-bold"
                                    >
                                      <option value="BUY">🛒 Mua thương mại</option>
                                      <option value="OUTSOURCE">🛠️ Gia công ngoài (OPO)</option>
                                    </select>
                                    <input
                                      placeholder="NCC / Xưởng gia công..."
                                      value={item.preferredVendor || ""}
                                      onChange={(e) => {
                                        const next = [...bomEditList];
                                        next[realIndex] = { ...item, preferredVendor: e.target.value };
                                        setBomEditList(next);
                                      }}
                                      className="w-full bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-slate-300"
                                    />
                                    <input
                                      placeholder="Mã bản vẽ CAD/Gerber..."
                                      value={item.drawingFile || ""}
                                      onChange={(e) => {
                                        const next = [...bomEditList];
                                        next[realIndex] = { ...item, drawingFile: e.target.value };
                                        setBomEditList(next);
                                      }}
                                      className="w-full bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-cyan-300 font-mono"
                                    />
                                  </div>
                                ) : (
                                  <div className="space-y-0.5">
                                    {item.sourceType === "OUTSOURCE" ? (
                                      <span className="px-2 py-0.5 bg-amber-950/60 text-amber-400 border border-amber-500/30 rounded text-[10px] font-bold inline-block">
                                        🛠️ Gia công ngoài (OPO)
                                      </span>
                                    ) : (
                                      <span className="px-2 py-0.5 bg-slate-800 text-slate-300 rounded text-[10px] inline-block">
                                        🛒 Mua thương mại
                                      </span>
                                    )}
                                    {item.preferredVendor && (
                                      <div className="text-[10px] text-slate-400 truncate max-w-[160px]">{item.preferredVendor}</div>
                                    )}
                                    {item.drawingFile && (
                                      <div className="text-[10px] text-cyan-400 font-mono">📐 {item.drawingFile}</div>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="p-2.5 text-slate-400">
                                {isEditingBom ? (
                                  <select
                                    value={item.category}
                                    onChange={(e) => {
                                      const next = [...bomEditList];
                                      next[realIndex] = { ...item, category: e.target.value };
                                      setBomEditList(next);
                                    }}
                                    className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                                  >
                                    {PART_CATEGORIES.map((c) => (
                                      <option key={c} value={c}>{c}</option>
                                    ))}
                                  </select>
                                ) : (
                                  item.category
                                )}
                              </td>
                              <td className="p-2.5 text-cyan-300 text-[11px]">
                                {isEditingBom ? (
                                  <select
                                    value={item.station}
                                    onChange={(e) => {
                                      const next = [...bomEditList];
                                      next[realIndex] = { ...item, station: e.target.value };
                                      setBomEditList(next);
                                    }}
                                    className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-cyan-300 max-w-[170px]"
                                  >
                                    {DEFAULT_STATIONS.map((st) => (
                                      <option key={st} value={st}>{st}</option>
                                    ))}
                                  </select>
                                ) : (
                                  item.station
                                )}
                              </td>
                              <td className="p-2.5 text-center font-bold text-white">
                                {isEditingBom ? (
                                  <input
                                    type="number"
                                    min={1}
                                    value={item.quantity}
                                    onChange={(e) => {
                                      const next = [...bomEditList];
                                      next[realIndex] = { ...item, quantity: Math.max(1, Number(e.target.value) || 1) };
                                      setBomEditList(next);
                                    }}
                                    className="w-16 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-center text-amber-400 font-bold"
                                  />
                                ) : (
                                  item.quantity
                                )}
                              </td>
                              <td className="p-2.5 text-center font-black bg-indigo-950/20 text-indigo-300">{reqQty}</td>
                              <td className="p-2.5 text-center font-bold">
                                <span className={stockQty > 0 ? "text-slate-200" : "text-rose-400"}>{stockQty}</span>
                              </td>
                              <td className="p-2.5 text-center">
                                {diffQty >= 0 ? (
                                  <span className="px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold">
                                    ✓ Đủ (Dư {diffQty})
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded bg-rose-950/70 text-rose-400 border border-rose-500/40 text-[10px] font-bold">
                                    ⚠️ Thiếu {Math.abs(diffQty)} {item.unit}
                                  </span>
                                )}
                              </td>
                              <td className="p-2.5 text-slate-400">
                                {isEditingBom ? (
                                  <input
                                    value={item.unit}
                                    onChange={(e) => {
                                      const next = [...bomEditList];
                                      next[realIndex] = { ...item, unit: e.target.value };
                                      setBomEditList(next);
                                    }}
                                    className="w-14 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300"
                                  />
                                ) : (
                                  item.unit
                                )}
                              </td>
                              <td className="p-2.5 text-right text-slate-300">
                                {isEditingBom ? (
                                  <input
                                    type="number"
                                    value={item.unitCost}
                                    onChange={(e) => {
                                      const next = [...bomEditList];
                                      next[realIndex] = { ...item, unitCost: Math.max(0, Number(e.target.value) || 0) };
                                      setBomEditList(next);
                                    }}
                                    className="w-24 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-right text-emerald-400"
                                  />
                                ) : (
                                  `${(item.unitCost || 0).toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ`
                                )}
                              </td>
                              <td className="p-2.5 text-right font-bold text-emerald-400">
                                {((item.quantity || 0) * (item.unitCost || 0)).toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ
                              </td>
                              {isEditingBom && (
                                <td className="p-2.5 text-center">
                                  <button
                                    type="button"
                                    onClick={() => setBomEditList(bomEditList.filter((_, i) => i !== realIndex))}
                                    className="text-rose-400 hover:text-rose-300 font-bold px-2 py-1 cursor-pointer"
                                  >
                                    🗑️
                                  </button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-slate-950 font-bold border-t border-slate-800">
                        <tr>
                          <td colSpan={12} className="p-3 text-right text-slate-300 uppercase text-xs">
                            Tổng chi phí vật tư định mức / 01 máy (BOM Cost):
                          </td>
                          <td className="p-3 text-right text-emerald-400 text-sm">
                            {mrpStats.totalUnitBomCost.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ
                          </td>
                          {isEditingBom && <td />}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}

              {/* ============================================================
                  TAB 2: PHỤ KIỆN TIÊU CHUẨN & PHỤ KIỆN TÙY CHỌN (OPTIONS)
                 ============================================================ */}
              {bomModalTab === "ACCESSORIES" && (
                <div className="space-y-6">
                  {/* Table 1: Standard Accessories */}
                  <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider">
                          📦 1. Phụ Kiện Tiêu Chuẩn Đi Kèm Máy (Standard Accessories)
                        </h4>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Danh mục vật tư/phụ kiện bắt buộc đóng gói kèm theo mỗi máy khi xuất xưởng bàn giao cho khách hàng.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsEditingBom(true);
                          setStdAccEditList((prev) => [
                            ...prev,
                            {
                              id: `std-${Date.now()}`,
                              name: "Phụ kiện tiêu chuẩn mới",
                              quantity: 1,
                              unit: "Cái",
                              specs: "Theo tiêu chuẩn nhà sản xuất ABT",
                            },
                          ]);
                        }}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg cursor-pointer"
                      >
                        + Thêm Phụ Kiện Tiêu Chuẩn
                      </button>
                    </div>

                    <div className="overflow-x-auto border border-slate-800 rounded-xl">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase">
                          <tr>
                            <th className="p-2.5 w-12">#</th>
                            <th className="p-2.5">Tên Phụ Kiện Tiêu Chuẩn</th>
                            <th className="p-2.5 text-center w-28">Số Lượng Kèm Máy</th>
                            <th className="p-2.5 w-28">Đơn Vị Tính</th>
                            <th className="p-2.5">Quy Cách / Ghi Chú</th>
                            {isEditingBom && <th className="p-2.5 text-center w-16">Xóa</th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {stdAccEditList.map((acc, idx) => (
                            <tr key={acc.id || idx} className="hover:bg-slate-800/40">
                              <td className="p-2.5 text-slate-500 font-mono">{idx + 1}</td>
                              <td className="p-2.5 font-bold text-white">
                                {isEditingBom ? (
                                  <input
                                    value={acc.name}
                                    onChange={(e) => {
                                      const next = [...stdAccEditList];
                                      next[idx] = { ...acc, name: e.target.value };
                                      setStdAccEditList(next);
                                    }}
                                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                                  />
                                ) : (
                                  acc.name
                                )}
                              </td>
                              <td className="p-2.5 text-center font-bold text-emerald-400">
                                {isEditingBom ? (
                                  <input
                                    type="number"
                                    min={1}
                                    value={acc.quantity}
                                    onChange={(e) => {
                                      const next = [...stdAccEditList];
                                      next[idx] = { ...acc, quantity: Math.max(1, Number(e.target.value) || 1) };
                                      setStdAccEditList(next);
                                    }}
                                    className="w-16 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-center text-emerald-400"
                                  />
                                ) : (
                                  acc.quantity
                                )}
                              </td>
                              <td className="p-2.5 text-slate-300">
                                {isEditingBom ? (
                                  <input
                                    value={acc.unit}
                                    onChange={(e) => {
                                      const next = [...stdAccEditList];
                                      next[idx] = { ...acc, unit: e.target.value };
                                      setStdAccEditList(next);
                                    }}
                                    className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300"
                                  />
                                ) : (
                                  acc.unit
                                )}
                              </td>
                              <td className="p-2.5 text-slate-400">
                                {isEditingBom ? (
                                  <input
                                    value={acc.specs || ""}
                                    onChange={(e) => {
                                      const next = [...stdAccEditList];
                                      next[idx] = { ...acc, specs: e.target.value };
                                      setStdAccEditList(next);
                                    }}
                                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300"
                                  />
                                ) : (
                                  acc.specs || "Tiêu chuẩn theo máy"
                                )}
                              </td>
                              {isEditingBom && (
                                <td className="p-2.5 text-center">
                                  <button
                                    type="button"
                                    onClick={() => setStdAccEditList(stdAccEditList.filter((_, i) => i !== idx))}
                                    className="text-rose-400 hover:text-rose-300 cursor-pointer"
                                  >
                                    🗑️
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                          {stdAccEditList.length === 0 && (
                            <tr>
                              <td colSpan={6} className="p-4 text-center text-slate-500 italic">
                                Chưa có phụ kiện tiêu chuẩn nào.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Table 2: Optional Accessories */}
                  <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                          ✨ 2. Danh Mục Phụ Kiện Mua Thêm / Tùy Chọn Nâng Cấp (Optional Accessories)
                        </h4>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Phụ kiện khách hàng có thể đặt mua thêm (Block nhiệt phụ, khay từ, bộ lưu điện UPS, gói hiệu chuẩn...).
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsEditingBom(true);
                          setOptAccEditList((prev) => [
                            ...prev,
                            {
                              id: `opt-${Date.now()}`,
                              code: `${activeBomModel.code}-OPT0${prev.length + 1}`,
                              name: "Phụ kiện tùy chọn mua thêm",
                              quantity: 1,
                              unit: "Bộ",
                              price: 2500000,
                            },
                          ]);
                        }}
                        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-lg cursor-pointer"
                      >
                        + Thêm Phụ Kiện Tùy Chọn
                      </button>
                    </div>

                    <div className="overflow-x-auto border border-slate-800 rounded-xl">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase">
                          <tr>
                            <th className="p-2.5">Mã Phụ Kiện</th>
                            <th className="p-2.5">Tên Phụ Kiện Tùy Chọn</th>
                            <th className="p-2.5 text-center w-28">Số Lượng Gợi Ý</th>
                            <th className="p-2.5 w-24">ĐVT</th>
                            <th className="p-2.5 text-right w-40">Đơn Giá Niêm Yết</th>
                            {isEditingBom && <th className="p-2.5 text-center w-16">Xóa</th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {optAccEditList.map((opt, idx) => (
                            <tr key={opt.id || idx} className="hover:bg-slate-800/40">
                              <td className="p-2.5 font-mono font-bold text-amber-400">
                                {isEditingBom ? (
                                  <input
                                    value={opt.code}
                                    onChange={(e) => {
                                      const next = [...optAccEditList];
                                      next[idx] = { ...opt, code: e.target.value.toUpperCase() };
                                      setOptAccEditList(next);
                                    }}
                                    className="w-32 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-amber-300"
                                  />
                                ) : (
                                  opt.code
                                )}
                              </td>
                              <td className="p-2.5 font-bold text-white">
                                {isEditingBom ? (
                                  <input
                                    value={opt.name}
                                    onChange={(e) => {
                                      const next = [...optAccEditList];
                                      next[idx] = { ...opt, name: e.target.value };
                                      setOptAccEditList(next);
                                    }}
                                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                                  />
                                ) : (
                                  opt.name
                                )}
                              </td>
                              <td className="p-2.5 text-center font-bold text-slate-200">
                                {isEditingBom ? (
                                  <input
                                    type="number"
                                    min={1}
                                    value={opt.quantity}
                                    onChange={(e) => {
                                      const next = [...optAccEditList];
                                      next[idx] = { ...opt, quantity: Math.max(1, Number(e.target.value) || 1) };
                                      setOptAccEditList(next);
                                    }}
                                    className="w-16 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-center text-white"
                                  />
                                ) : (
                                  opt.quantity
                                )}
                              </td>
                              <td className="p-2.5 text-slate-400">
                                {isEditingBom ? (
                                  <input
                                    value={opt.unit}
                                    onChange={(e) => {
                                      const next = [...optAccEditList];
                                      next[idx] = { ...opt, unit: e.target.value };
                                      setOptAccEditList(next);
                                    }}
                                    className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300"
                                  />
                                ) : (
                                  opt.unit
                                )}
                              </td>
                              <td className="p-2.5 text-right font-bold text-emerald-400">
                                {isEditingBom ? (
                                  <input
                                    type="number"
                                    value={opt.price}
                                    onChange={(e) => {
                                      const next = [...optAccEditList];
                                      next[idx] = { ...opt, price: Math.max(0, Number(e.target.value) || 0) };
                                      setOptAccEditList(next);
                                    }}
                                    className="w-28 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-right text-emerald-400"
                                  />
                                ) : (
                                  `${(opt.price || 0).toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ`
                                )}
                              </td>
                              {isEditingBom && (
                                <td className="p-2.5 text-center">
                                  <button
                                    type="button"
                                    onClick={() => setOptAccEditList(optAccEditList.filter((_, i) => i !== idx))}
                                    className="text-rose-400 hover:text-rose-300 cursor-pointer"
                                  >
                                    🗑️
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                          {optAccEditList.length === 0 && (
                            <tr>
                              <td colSpan={6} className="p-4 text-center text-slate-500 italic">
                                Chưa có phụ kiện tùy chọn nào.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* ============================================================
                  TAB 3: THÔNG SỐ KỸ THUẬT, QUY TRÌNH LẮP RÁP & LỊCH SỬ ECO / DMR
                 ============================================================ */}
              {bomModalTab === "SPECS_ECO" && (
                <div className="space-y-6">
                  {/* Technical Specifications Editor & Baseline Comparison */}
                  <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4">
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                          📐 1. Bảng Thông Số Kỹ Thuật Tiêu Chuẩn (Technical Specifications — Rev {activeBomModel.current_revision || "1.0"})
                        </h4>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Các thông số kỹ thuật hiển thị trên Thẻ thiết bị, Catalogue thương mại và Biên bản kiểm định xuất xưởng (FQC).
                        </p>
                      </div>
                      {isEditingBom && (
                        <button
                          type="button"
                          onClick={() => setSpecsEditList((prev) => [...prev, { key: "Thông số mới", value: "Giá trị tiêu chuẩn" }])}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg cursor-pointer"
                        >
                          + Thêm Thông Số
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {specsEditList.map((sp, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg p-2.5">
                          {isEditingBom ? (
                            <>
                              <input
                                value={sp.key}
                                onChange={(e) => {
                                  const next = [...specsEditList];
                                  next[idx] = { ...sp, key: e.target.value };
                                  setSpecsEditList(next);
                                }}
                                placeholder="Tên thông số"
                                className="w-1/2 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300"
                              />
                              <input
                                value={sp.value}
                                onChange={(e) => {
                                  const next = [...specsEditList];
                                  next[idx] = { ...sp, value: e.target.value };
                                  setSpecsEditList(next);
                                }}
                                placeholder="Giá trị"
                                className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-emerald-400 font-bold"
                              />
                              <button
                                type="button"
                                onClick={() => setSpecsEditList(specsEditList.filter((_, i) => i !== idx))}
                                className="text-rose-400 hover:text-rose-300 px-1 cursor-pointer"
                              >
                                🗑️
                              </button>
                            </>
                          ) : (
                            <div className="flex justify-between w-full text-xs">
                              <span className="text-slate-400">{sp.key}:</span>
                              <span className="text-white font-bold">{sp.value}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Production Stages Routing */}
                  <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4">
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                          🏭 2. Quy Trình Công Đoạn Lắp Ráp & Kiểm Định Chuẩn (Production Routing)
                        </h4>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Các trạm lắp ráp bắt buộc trong Hồ sơ lịch sử thiết bị (DHR) khi xưởng nhận lệnh sản xuất.
                        </p>
                      </div>
                      {isEditingBom && (
                        <button
                          type="button"
                          onClick={() => setStagesEditList((prev) => [...prev, `${prev.length + 1}. Công đoạn lắp ráp mới`])}
                          className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-lg cursor-pointer"
                        >
                          + Thêm Công Đoạn
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {stagesEditList.map((st, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs">
                          <span className="w-6 h-6 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-500/30 flex items-center justify-center font-bold text-[11px] shrink-0">
                            {idx + 1}
                          </span>
                          {isEditingBom ? (
                            <>
                              <input
                                value={st}
                                onChange={(e) => {
                                  const next = [...stagesEditList];
                                  next[idx] = e.target.value;
                                  setStagesEditList(next);
                                }}
                                className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                              />
                              <button
                                type="button"
                                onClick={() => setStagesEditList(stagesEditList.filter((_, i) => i !== idx))}
                                className="text-rose-400 hover:text-rose-300 px-1 cursor-pointer"
                              >
                                🗑️
                              </button>
                            </>
                          ) : (
                            <span className="text-slate-200 font-semibold">{st}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ISO 13485 DMR Revisions & ECO History */}
                  <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider">
                          📜 3. Hồ Sơ Thiết Kế Gốc (DMR Revisions) & Phiếu Thay Đổi Kỹ Thuật (ECO)
                        </h4>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Quản lý phiên bản DMR và phê duyệt thay đổi kỹ thuật 5 chiều theo chuẩn ISO 13485.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {canManage && (
                          <Button variant="ghost" onClick={() => setShowAddRev((v) => !v)}>
                            {showAddRev ? "Đóng form Revision" : "+ Tạo Revision DMR"}
                          </Button>
                        )}
                        {canEcoPropose && (
                          <Button variant="ghost" onClick={() => setShowAddEco((v) => !v)}>
                            {showAddEco ? "Đóng form ECO" : "+ Tạo phiếu ECO"}
                          </Button>
                        )}
                      </div>
                    </div>

                    {showAddRev && canManage && (
                      <form
                        className="rounded-xl border border-slate-800 bg-slate-900 p-3 flex flex-col gap-2 text-xs"
                        onSubmit={(e) => {
                          e.preventDefault();
                          addRevMut.mutate();
                        }}
                      >
                        <div className="font-bold text-slate-200">+ Tạo phiên bản thiết kế mới (Model Revision / DMR)</div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          <Field label="Ký hiệu Revision (VD: 1.1, 2.0, B) *">
                            <input className={inputClass} value={revForm.revision} onChange={(e) => setRevForm({ ...revForm, revision: e.target.value })} required placeholder="2.0" />
                          </Field>
                          <Field label="Phiên bản Firmware">
                            <input className={inputClass} value={revForm.firmware_version} onChange={(e) => setRevForm({ ...revForm, firmware_version: e.target.value })} placeholder="v2.0.0" />
                          </Field>
                          <Field label="Sao chép BOM từ phiên bản trước">
                            <select className={inputClass} value={revForm.clone_from_revision_id} onChange={(e) => setRevForm({ ...revForm, clone_from_revision_id: e.target.value })}>
                              <option value="">-- Khởi tạo trống --</option>
                              {(activeBomModel.revisions ?? []).map((r) => (
                                <option key={r.id} value={r.id}>Rev {r.revision} ({r.bom_lines.length} dòng BOM)</option>
                              ))}
                            </select>
                          </Field>
                        </div>
                        <Field label="Tóm tắt hồ sơ DMR *">
                          <input className={inputClass} value={revForm.dmr_summary} onChange={(e) => setRevForm({ ...revForm, dmr_summary: e.target.value })} required placeholder="Cập nhật sơ đồ mạch công suất & cụm quang học..." />
                        </Field>
                        <div>
                          <Button type="submit" disabled={addRevMut.isPending}>Lưu Revision DMR</Button>
                          <ErrorNote error={addRevMut.error} />
                        </div>
                      </form>
                    )}

                    {showAddEco && canEcoPropose && (
                      <form
                        className="grid grid-cols-1 md:grid-cols-4 gap-2 rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs"
                        onSubmit={(e) => {
                          e.preventDefault();
                          addEcoMut.mutate();
                        }}
                      >
                        <Field label="Phiên bản DMR đích *">
                          <input className={inputClass} value={ecoForm.target_revision} onChange={(e) => setEcoForm({ ...ecoForm, target_revision: e.target.value })} required placeholder="VD: 2.0" />
                        </Field>
                        <div className="md:col-span-2">
                          <Field label="Tiêu đề yêu cầu thay đổi kỹ thuật (ECO) *">
                            <input className={inputClass} value={ecoForm.title} onChange={(e) => setEcoForm({ ...ecoForm, title: e.target.value })} required placeholder="Nâng cấp cụm gia nhiệt Peltier..." />
                          </Field>
                        </div>
                        <Field label="Hiệu lực áp dụng">
                          <select className={inputClass} value={ecoForm.effectivity_type} onChange={(e) => setEcoForm({ ...ecoForm, effectivity_type: e.target.value })}>
                            <option value="IMMEDIATE">Tức thời khi ban hành</option>
                            <option value="FROM_SERIAL">Từ số Serial chỉ định</option>
                            <option value="FROM_DATE">Từ ngày hiệu lực</option>
                          </select>
                        </Field>
                        <div className="md:col-span-2">
                          <Field label="Lý do thay đổi *">
                            <input className={inputClass} value={ecoForm.reason} onChange={(e) => setEcoForm({ ...ecoForm, reason: e.target.value })} required />
                          </Field>
                        </div>
                        <div className="md:col-span-2">
                          <Field label="Tóm tắt nội dung thay đổi kỹ thuật *">
                            <input className={inputClass} value={ecoForm.change_summary} onChange={(e) => setEcoForm({ ...ecoForm, change_summary: e.target.value })} required />
                          </Field>
                        </div>
                        <div className="md:col-span-4 flex items-center gap-2">
                          <Button type="submit" disabled={addEcoMut.isPending}>+ Tạo phiếu ECO</Button>
                          <ErrorNote error={addEcoMut.error} />
                        </div>
                      </form>
                    )}

                    {/* List of Revisions */}
                    <div className="space-y-2">
                      {(activeBomModel.revisions ?? []).map((rev) => (
                        <div key={rev.id} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 flex flex-col gap-2 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-sky-400">Revision {rev.revision}</span>
                              <StatusBadge status={REVISION_STATUS[rev.status]?.[0] ?? "PENDING_QC"} label={REVISION_STATUS[rev.status]?.[1] ?? rev.status} />
                              {rev.firmware_version && <span className="px-2 py-0.5 rounded bg-slate-800 font-mono text-[11px]">FW: {rev.firmware_version}</span>}
                            </div>
                            <span className="text-slate-400 text-[11px]">
                              {rev.released_at ? `Phát hành: ${fmtDate(rev.released_at)}` : "Bản nháp"}
                            </span>
                          </div>
                          <div className="text-slate-300">{rev.dmr_summary}</div>
                          <ActionBar
                            endpoint={`/api/factory/device/revisions/${rev.id}/actions`}
                            version={rev.version}
                            actions={rev.actions}
                            labels={REV_ACTION_LABELS}
                            onDone={() => {
                              qc.invalidateQueries({ queryKey: ["factory", "device", "model", activeBomModel.id] });
                              qc.invalidateQueries({ queryKey: ["factory", "device", "models"] });
                            }}
                          />
                        </div>
                      ))}
                    </div>

                    {/* List of ECOs */}
                    {(activeBomModel.ecos ?? []).length > 0 && (
                      <div className="space-y-2 pt-2 border-t border-slate-800">
                        {(activeBomModel.ecos ?? []).map((eco) => (
                          <div key={eco.id} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 flex flex-col gap-2 text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-indigo-400">{eco.code}</span>
                                <span className="font-bold text-white">{eco.title}</span>
                                <span className="px-2 py-0.5 rounded bg-slate-800 font-mono">Đích: Rev {eco.target_revision}</span>
                              </div>
                              <StatusBadge status={ECO_STATUS[eco.status]?.[0] ?? "PENDING_QC"} label={ECO_STATUS[eco.status]?.[1] ?? eco.status} />
                            </div>
                            <div className="text-slate-300">
                              <b>Lý do:</b> {eco.reason} · <b>Nội dung:</b> {eco.change_summary}
                            </div>
                            {["DRAFT", "IMPACT_ASSESSMENT"].includes(eco.status) && canEcoPropose && (
                              <EcoImpactEditor
                                eco={eco}
                                onDone={() => qc.invalidateQueries({ queryKey: ["factory", "device", "model", activeBomModel.id] })}
                              />
                            )}
                            {eco.status === "IMPLEMENTED" && (
                              <Field label="Ghi chú xác minh sau triển khai (Bắt buộc trước khi Đóng ECO)">
                                <input
                                  className={inputClass}
                                  value={verifyNote}
                                  onChange={(e) => setVerifyNote(e.target.value)}
                                  placeholder="Đã kiểm tra các máy lắp theo Rev mới đạt chuẩn..."
                                />
                              </Field>
                            )}
                            <ActionBar
                              endpoint={`/api/factory/device/ecos/${eco.id}/actions`}
                              version={eco.version}
                              actions={eco.actions}
                              labels={ECO_ACTION_LABELS}
                              extraPayload={eco.status === "IMPLEMENTED" ? { verification_note: verifyNote } : undefined}
                              onDone={() => {
                                qc.invalidateQueries({ queryKey: ["factory", "device", "model", activeBomModel.id] });
                                qc.invalidateQueries({ queryKey: ["factory", "device", "models"] });
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================
          MODAL 2: MULTI-PART INVENTORY PICKER MODAL
         ======================================================================== */}
      {showPartPickerModal && (
        <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950">
              <div>
                <h4 className="text-sm font-bold text-white">📦 Chọn Linh Kiện Từ Kho Kỹ Thuật ({partsInventory.length} mã)</h4>
                <p className="text-[11px] text-slate-400">Tích chọn nhiều linh kiện để nạp nhanh vào Cây định mức BOM của thiết bị.</p>
              </div>
              <button type="button" onClick={() => setShowPartPickerModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <div className="p-3 bg-slate-950/60 border-b border-slate-800 flex items-center gap-3">
              <input
                value={partPickerSearch}
                onChange={(e) => setPartPickerSearch(e.target.value)}
                placeholder="🔍 Tìm mã linh kiện, tên linh kiện, nhóm kỹ thuật..."
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white outline-none"
              />
              <span className="text-xs text-indigo-300 font-bold">Đã chọn: {selectedPickerPartCodes.length} mã</span>
            </div>
            <div className="p-3 overflow-y-auto flex-1">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase">
                  <tr>
                    <th className="p-2 w-10">Chọn</th>
                    <th className="p-2">Mã Linh Kiện</th>
                    <th className="p-2">Tên Linh Kiện</th>
                    <th className="p-2">Nhóm</th>
                    <th className="p-2 text-center">Tồn Kho</th>
                    <th className="p-2 text-right">Đơn Giá</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {partsInventory
                    .filter((p) => {
                      const q = partPickerSearch.trim().toLowerCase();
                      if (!q) return true;
                      return p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
                    })
                    .map((p) => {
                      const checked = selectedPickerPartCodes.includes(p.code);
                      return (
                        <tr
                          key={p.id}
                          onClick={() =>
                            setSelectedPickerPartCodes((prev) =>
                              checked ? prev.filter((c) => c !== p.code) : [...prev, p.code]
                            )
                          }
                          className={`cursor-pointer hover:bg-slate-800/60 ${checked ? "bg-indigo-950/40" : ""}`}
                        >
                          <td className="p-2 text-center">
                            <input type="checkbox" checked={checked} readOnly />
                          </td>
                          <td className="p-2 font-mono font-bold text-indigo-400">{p.code}</td>
                          <td className="p-2 text-white">{p.name}</td>
                          <td className="p-2 text-slate-400">{p.category}</td>
                          <td className="p-2 text-center font-bold text-emerald-400">{p.stock_qty} {p.unit}</td>
                          <td className="p-2 text-right text-slate-300">{p.unit_cost.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t border-slate-800 bg-slate-950 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPartPickerModal(false)}
                className="px-4 py-1.5 bg-slate-800 text-slate-300 rounded-lg text-xs font-bold cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={selectedPickerPartCodes.length === 0}
                onClick={() => {
                  setIsEditingBom(true);
                  setBomEditList((prev) => {
                    const next = [...prev];
                    for (const code of selectedPickerPartCodes) {
                      const p = partsInventory.find((x) => x.code === code);
                      if (!p) continue;
                      const existingIdx = next.findIndex((x) => x.partCode === p.code);
                      if (existingIdx >= 0) {
                        next[existingIdx] = { ...next[existingIdx], quantity: next[existingIdx].quantity + 1 };
                      } else {
                        next.push({
                          id: `bom-${Date.now()}-${p.code}`,
                          partCode: p.code,
                          partName: p.name,
                          category: p.category,
                          quantity: 1,
                          unit: p.unit,
                          unitCost: p.unit_cost,
                          station: DEFAULT_STATIONS[0],
                          sourceType: "BUY",
                        });
                      }
                    }
                    return next;
                  });
                  setShowPartPickerModal(false);
                }}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg text-xs font-bold cursor-pointer"
              >
                + Nạp {selectedPickerPartCodes.length} Linh Kiện Vào BOM
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================
          MODAL 3: CREATE / EDIT EQUIPMENT MODEL MODAL
         ======================================================================== */}
      {showEquipmentModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl my-auto">
            <div className="p-4 border-b border-slate-800 bg-slate-950 flex justify-between items-center">
              <h4 className="text-sm font-bold text-white uppercase">
                {editingModel ? `✏️ Chỉnh Sửa Thiết Bị: [${editingModel.code}] ${editingModel.name}` : "+ Thêm Thiết Bị Thương Mại Mới"}
              </h4>
              <button type="button" onClick={() => setShowEquipmentModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form
              className="p-5 space-y-4 text-xs max-h-[82vh] overflow-y-auto"
              onSubmit={(e) => {
                e.preventDefault();
                saveEquipmentMut.mutate();
              }}
            >
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Mã Thiết Bị (Model Code) *">
                  <input
                    className={inputClass}
                    value={eqForm.code}
                    onChange={(e) => setEqForm({ ...eqForm, code: e.target.value.toUpperCase() })}
                    required
                    placeholder="VD: PCR-WD8"
                  />
                </Field>
                <div className="md:col-span-2">
                  <Field label="Tên Thương Mại Thiết Bị *">
                    <input
                      className={inputClass}
                      value={eqForm.name}
                      onChange={(e) => setEqForm({ ...eqForm, name: e.target.value })}
                      required
                      placeholder="VD: Tủ PCR kích thước 1m"
                    />
                  </Field>
                </div>
                <Field label="Nhóm Thiết Bị Hiển Thị *">
                  <input
                    className={inputClass}
                    value={eqForm.category_label}
                    onChange={(e) => setEqForm({ ...eqForm, category_label: e.target.value })}
                    required
                    placeholder="Thiết bị phụ trợ phòng Lab"
                  />
                </Field>
                <Field label="Phân Loại Kỹ Thuật">
                  <select className={inputClass} value={eqForm.category} onChange={(e) => setEqForm({ ...eqForm, category: e.target.value })}>
                    {Object.entries(MODEL_CATEGORY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Xuất Xứ">
                  <input className={inputClass} value={eqForm.origin} onChange={(e) => setEqForm({ ...eqForm, origin: e.target.value })} />
                </Field>
                <Field label="Giá Niêm Yết (VNĐ) *">
                  <input
                    type="number"
                    className={inputClass}
                    value={eqForm.price}
                    onChange={(e) => setEqForm({ ...eqForm, price: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Bảo Hành (Tháng)">
                  <input
                    type="number"
                    className={inputClass}
                    value={eqForm.warranty_months}
                    onChange={(e) => setEqForm({ ...eqForm, warranty_months: e.target.value })}
                  />
                </Field>
                <Field label="Thời Gian Chế Tạo (Ngày)">
                  <input
                    type="number"
                    className={inputClass}
                    value={eqForm.lead_time_days}
                    onChange={(e) => setEqForm({ ...eqForm, lead_time_days: e.target.value })}
                  />
                </Field>
              </div>

              <div className="border-t border-slate-800 pt-3">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-bold text-slate-300">Thông số kỹ thuật tiêu chuẩn hiển thị trên thẻ:</span>
                  <button
                    type="button"
                    onClick={() =>
                      setEqForm({
                        ...eqForm,
                        specs_list: [...eqForm.specs_list, { key: "", value: "" }],
                      })
                    }
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-400 rounded text-xs font-bold cursor-pointer"
                  >
                    + Thêm dòng thông số
                  </button>
                </div>
                <div className="space-y-2">
                  {eqForm.specs_list.map((sp, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        value={sp.key}
                        onChange={(e) => {
                          const next = [...eqForm.specs_list];
                          next[i] = { ...sp, key: e.target.value };
                          setEqForm({ ...eqForm, specs_list: next });
                        }}
                        placeholder="Tên thông số (VD: Kích thước ngoài)"
                        className={`${inputClass} w-1/2`}
                      />
                      <input
                        value={sp.value}
                        onChange={(e) => {
                          const next = [...eqForm.specs_list];
                          next[i] = { ...sp, value: e.target.value };
                          setEqForm({ ...eqForm, specs_list: next });
                        }}
                        placeholder="Giá trị (VD: 1000 x 742 x 1200 mm)"
                        className={`${inputClass} flex-1`}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setEqForm({
                            ...eqForm,
                            specs_list: eqForm.specs_list.filter((_, idx) => idx !== i),
                          })
                        }
                        className="text-rose-400 px-2"
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <ErrorNote error={saveEquipmentMut.error} />
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <Button type="button" variant="ghost" onClick={() => setShowEquipmentModal(false)}>
                  Hủy
                </Button>
                <Button type="submit" disabled={saveEquipmentMut.isPending}>
                  {saveEquipmentMut.isPending ? "Đang lưu..." : "💾 Lưu Thiết Bị"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

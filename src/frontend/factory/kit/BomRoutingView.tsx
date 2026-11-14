"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActionBar } from "../actions";
import { api, fmtQty, vnToday } from "../api";
import { printElementHtml } from "../coa";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import {
  ABT_KIT_SUPPLY_FORMS,
  ABT_TUBE_STRIP_CATALOG,
  ACTION_LABELS,
  buildAbtKitLotCode,
  CONTAINER_LABELS,
  type KitOptions,
  parseAbtKitLotCode,
  ROLE_LABELS,
  ROUTING_STANDARD_TEMPLATES,
  type RoutingStepDraft,
  STEP_CATEGORY_LABELS,
  STEP_FUNCTION_CATALOG,
  type StepParamDraft,
  WORK_CENTER_PRESETS,
} from "./shared";
import {
  KitLabelStudio,
  VisualLabelCanvas,
  normalizeLabelBundle,
  type KitLabelDesignBundle,
  type LabelSampleData,
} from "./KitLabelStudio";

function classifyBomLineForPackaging(l: any): {
  kind: "PRIMARY_CONTAINER" | "OUTER_BOX_OR_ACCESSORY" | "FILLABLE_SOLUTION";
  containerType?: string;
  capacityMl?: number;
} {
  const code = String(l?.component_code || "").trim().toUpperCase();
  const name = String(l?.component_name || "").trim().toLowerCase();
  const uom = String(l?.uom || "").trim().toLowerCase();
  const role = String(l?.component_role || "REAGENT").toUpperCase();

  const isVolumeOrMassUom =
    uom === "ml" || uom === "µl" || uom === "ul" || uom === "l" || uom === "g" || uom === "mg" || uom === "rxn" || uom === "test";
  if (!isVolumeOrMassUom) {
    if (
      /^CTN2(\b|$)|^CT2(\b|$)/.test(code) ||
      (name.includes("cryotube") && (name.includes("2.0ml") || name.includes("2ml"))) ||
      (name.includes("microtube") && (name.includes("2.0ml") || name.includes("2ml")))
    ) {
      return { kind: "PRIMARY_CONTAINER", containerType: "TUBE_2_0ML", capacityMl: 2.0 };
    }
    if (
      /^CTT1\.5|^CTN1\.5|^CT1\.5|^T1\.5(\b|$)/.test(code) ||
      (name.includes("cryotube") && name.includes("1.5ml")) ||
      (name.includes("tube") && name.includes("1.5ml") && !name.includes("túi"))
    ) {
      return { kind: "PRIMARY_CONTAINER", containerType: "TUBE_1_5ML", capacityMl: 1.5 };
    }
    if (/^CTT0\.5|^CTN0\.5|^CT0\.5/.test(code) || (name.includes("cryotube") && name.includes("0.5ml"))) {
      return { kind: "PRIMARY_CONTAINER", containerType: "TUBE_0_5ML", capacityMl: 0.5 };
    }
    const cppMatch = code.match(/^CPP(\d+)/);
    if (cppMatch || name.includes("chai nhựa") || name.includes("lọ nhựa") || name.includes("chai pet") || name.includes("chai hdpe")) {
      const cap = cppMatch ? Number(cppMatch[1]) : 15;
      return {
        kind: "PRIMARY_CONTAINER",
        containerType: cap >= 25 ? "BOTTLE_50ML" : "BOTTLE_10ML",
        capacityMl: cap,
      };
    }
  }

  if (
    role === "PACKAGING" ||
    role === "DOCUMENT_IFU" ||
    Boolean(l?.is_demo_fixed_component) ||
    /^(HG|DG|TEM|LBL|IFU|HDSD|BOX|BAG|TUI|ZIP|FOAM|XOP|CSR|T1\.5B|MN5N|CNM|DSC|NBM)/.test(code) ||
    name.includes("hộp giấy") ||
    name.includes("đế giấy") ||
    name.includes("nhãn") ||
    name.includes("tờ hướng dẫn") ||
    name.includes("cột lọc") ||
    name.includes("spin column") ||
    name.includes("collection tube") ||
    name.includes("túi zip") ||
    name.includes("túi nhôm") ||
    name.includes("màng nhôm") ||
    name.includes("cuộn màng")
  ) {
    return { kind: "OUTER_BOX_OR_ACCESSORY" };
  }

  return { kind: "FILLABLE_SOLUTION" };
}

export function BomRoutingView({
  options,
  onRefreshOptions,
  onJumpToOrder,
}: {
  options: KitOptions;
  onRefreshOptions: () => void;
  onJumpToOrder?: (orderId: string) => void;
}) {
  const [subTab, setSubTab] = useState<"bom" | "routing">("bom");
  const [boms, setBoms] = useState<any[]>([]);
  const [routings, setRoutings] = useState<any[]>([]);
  const [selectedBomId, setSelectedBomId] = useState<string>("");
  const [bomDetail, setBomDetail] = useState<any | null>(null);
  const [selectedRoutingId, setSelectedRoutingId] = useState<string>("");
  const [routingDetail, setRoutingDetail] = useState<any | null>(null);
  const [error, setError] = useState<unknown>(null);

  // High-scale search & filter for thousands of BOM formulas and thousands of raw material lines
  const [bomSearch, setBomSearch] = useState("");
  const [bomStatusFilter, setBomStatusFilter] = useState("");
  const [bomTypeTab, setBomTypeTab] = useState<"ALL" | "finished_good" | "semi_finished">("ALL");
  const [bomCategoryFilter, setBomCategoryFilter] = useState<string>("");
  const [bomPage, setBomPage] = useState<number>(1);
  const [bomPageSize, setBomPageSize] = useState<number>(15);
  const [rtPage, setRtPage] = useState<number>(1);
  const [rtPageSize, setRtPageSize] = useState<number>(15);
  const bomDetailRef = useRef<HTMLDivElement>(null);
  const rtDetailRef = useRef<HTMLDivElement>(null);
  const labelPreviewRef = useRef<HTMLDivElement>(null);
  const [lineSearch, setLineSearch] = useState("");
  const [lineBoxFilter, setLineBoxFilter] = useState("");
  const [bulkLinesText, setBulkLinesText] = useState("");
  const [showBulkPaste, setShowBulkPaste] = useState(false);
  const [showCreateBom, setShowCreateBom] = useState(false);
  const [showEditHeader, setShowEditHeader] = useState(false);
  const [showAddLine, setShowAddLine] = useState(false);
  const [showAddSub, setShowAddSub] = useState(false);
  const [showAddPack, setShowAddPack] = useState(false);
  const [showEditLabelIfu, setShowEditLabelIfu] = useState(false);
  const [showLabelStudio, setShowLabelStudio] = useState(false);
  const [showPreviewLabelIfu, setShowPreviewLabelIfu] = useState(false);
  const [showCreateRouting, setShowCreateRouting] = useState(false);
  const [showAddStep, setShowAddStep] = useState(false);
  const [showIssueOrder, setShowIssueOrder] = useState(false);
  const [issueOrderBusy, setIssueOrderBusy] = useState(false);
  const [createdOrderResult, setCreatedOrderResult] = useState<any | null>(null);
  const [issueOrderForm, setIssueOrderForm] = useState({
    org_unit_id: options.units[0]?.id ?? "",
    warehouse_id: options.warehouses[0]?.id ?? "",
    internal_order_line_id: "",
    planned_qty: "10",
    supply_form: "NO_SPLIT_NO_IC",
    tube_code: "T02",
    is_demo: false,
    demo_specification: "25 test",
    qc_retention_qty: "1",
    no_retention: false,
    lot_code: "",
    mfg_date: vnToday(),
    priority: "NORMAL" as "LOW" | "NORMAL" | "HIGH" | "URGENT",
    notes: "",
  });

  const [labelIfuForm, setLabelIfuForm] = useState({
    label_template_code: "",
    label_dimensions: "",
    udi_di: "",
    ifu_code: "",
    ifu_version: "",
    ifu_intended_use: "",
    ifu_thermal_profile: "",
    ifu_channels: "",
    ifu_interpretation: "",
    ifu_file_name: "",
    ifu_file_url: "",
    ifu_file_size: "",
    ifu_aliquoted_file_name: "",
    ifu_aliquoted_file_url: "",
    ifu_aliquoted_file_size: "",
  });

  const [labelBundle, setLabelBundle] = useState<KitLabelDesignBundle>(() => normalizeLabelBundle(null));

  const [bomForm, setBomForm] = useState({
    org_unit_id: options.units[0]?.id ?? "",
    product_item_id: "",
    routing_id: "",
    name: "",
    bom_type: "finished_good" as "finished_good" | "semi_finished",
    bom_category: "PCR Kit",
    variant_code: "BASE",
    supply_form: "NO_SPLIT_NO_IC",
    parent_item_code: "",
    tccs_code: "TCCS 01:2026/ABT",
    tccs_file_name: "",
    tccs_file_url: "",
    registration_no: "2400189/ĐKLH-BYT-TB-CT",
    responsible_person_name: (options as any).kit_staff?.[0]?.display_name ?? "",
    qc_assignee_name: (options as any).qa_staff?.[0]?.display_name ?? "",
    specification: "Hộp 50 test (75 test Mix + 80 tube)",
    storage_condition: "-20°C ± 2°C",
    tests_per_kit: "75",
    shelf_life_months: "12",
    shelf_life_days: "365",
    qc_retention_qty: "1",
    ph_min: "",
    ph_max: "",
    clone_from_bom_id: "",
  });

  const [editHeaderForm, setEditHeaderForm] = useState({
    name: "",
    routing_id: "",
    bom_type: "finished_good" as "finished_good" | "semi_finished",
    bom_category: "PCR Kit",
    variant_code: "BASE",
    supply_form: "NO_SPLIT_NO_IC",
    parent_item_code: "",
    tccs_code: "",
    tccs_file_name: "",
    tccs_file_url: "",
    registration_no: "",
    responsible_person_name: "",
    qc_assignee_name: "",
    specification: "",
    storage_condition: "",
    tests_per_kit: "75",
    shelf_life_months: "12",
    shelf_life_days: "365",
    qc_retention_qty: "1",
    ph_min: "",
    ph_max: "",
    notes: "",
  });

  const [lineForm, setLineForm] = useState({
    component_item_id: "",
    qty_per_base: "1",
    qty_per_base_aliquoted: "",
    uom: "",
    scrap_pct: "2",
    box_no: "1",
    component_role: "MASTER_MIX",
    is_critical: true,
    is_bundled: false,
    bundle_parent_code: "",
    allow_substitute: false,
    is_mix_component: true,
    is_demo_fixed_component: false,
    include_in_qc_retention: true,
  });

  const [subForm, setSubForm] = useState({
    bom_line_id: "",
    substitute_item_id: "",
    conversion_factor: "1",
    priority: "1",
    notes: "",
  });

  const [showQuickItem, setShowQuickItem] = useState(false);
  const [quickItemForm, setQuickItemForm] = useState({
    code: "",
    name: "",
    item_type: "FINISHED_KIT",
    base_uom: "KIT",
    storage_temp: "-20°C",
    shelf_life_days: "365",
  });

  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editingPackId, setEditingPackId] = useState<string | null>(null);

  const [packForm, setPackForm] = useState({
    box_no: "1",
    box_name: "Hộp 1: Hóa chất khuếch đại PCR",
    component_name: "Ống Master Mix 2X",
    container_type: "TUBE_1_5ML",
    fill_qty: "500",
    fill_uom: "µL",
    units_per_kit: "2",
    storage_temp: "-20°C",
  });

  const [rtForm, setRtForm] = useState({
    org_unit_id: options.units[0]?.id ?? "",
    product_item_id: "",
    routing_category: "PCR Kit",
    name: "Quy trình pha chế, chiết rót & đóng gói Kit PCR (5 bước)",
    notes: "",
  });

  const [rtTemplateKey, setRtTemplateKey] = useState<string>("PCR_5_STEPS");
  const [rtDraftSteps, setRtDraftSteps] = useState<RoutingStepDraft[]>(() =>
    JSON.parse(JSON.stringify(ROUTING_STANDARD_TEMPLATES[0].steps))
  );
  const [selectedTemplateForLoad, setSelectedTemplateForLoad] = useState<string>("PCR_5_STEPS");
  const [editingStepId, setEditingStepId] = useState<string | null>(null);

  const [stepForm, setStepForm] = useState({
    seq: "10",
    step_code: "STEP-10",
    step_name: "Pha chế Dung dịch gốc & Master Mix",
    category: "FORMULATION",
    step_function: "FORMULATION_MIXING",
    work_center: "Phòng sạch Pha chế (Class 10,000 / ISO 7)",
    instructions: "Rã đông hóa chất trên đá lạnh, phối trộn theo đúng tỷ lệ BOM và vortex nhẹ.",
    sop_doc_code: "SOP-KIT-001",
    std_duration_min: "45",
    required_asset_id: "",
    expected_output: "Dung dịch đồng nhất, pH đạt chuẩn",
    is_qc: false,
    requires_check_signature: true,
    allow_skip: false,
    functional_flags: {
      require_line_clearance: false,
      require_material_scan: true,
      require_env_log: true,
      require_yield_reconcile: false,
      require_label_ifu_check: false,
    },
    params: [
      { key: "temp_c", label: "Nhiệt độ phòng pha chế", type: "number", unit: "°C", min: "18", max: "25", required: true },
    ] as StepParamDraft[],
  });

  const loadList = useCallback(async () => {
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (bomSearch.trim()) qs.set("q", bomSearch.trim());
      if (bomStatusFilter) qs.set("status", bomStatusFilter);
      qs.set("limit", "2000");
      const [bRes, rRes] = await Promise.all([
        api<{ boms: any[] }>(`/api/factory/kit/boms?${qs.toString()}`),
        api<{ routings: any[] }>(`/api/factory/kit/routings?limit=500`),
      ]);
      setBoms(bRes.boms);
      setRoutings(rRes.routings);
    } catch (e) {
      setError(e);
    }
  }, [bomSearch, bomStatusFilter]);

  const loadBomDetail = useCallback(async (id: string, q?: string, boxNo?: string) => {
    if (!id) return;
    try {
      const qs = new URLSearchParams();
      if (q?.trim()) qs.set("q", q.trim());
      if (boxNo) qs.set("box_no", boxNo);
      qs.set("limit", "500");
      const d = await api<any>(`/api/factory/kit/boms/${id}?${qs.toString()}`);
      setBomDetail(d);
      if (d?.bom) {
        const isSemi = d.bom.bom_type === "semi_finished" || d.bom.product_type === "SEMI_FINISHED";
        const baseCode = String(d.bom.product_code || "").replace(/\.D\.IC$/i, "");
        setEditHeaderForm({
          name: d.bom.name ?? "",
          routing_id: d.bom.routing_id ?? "",
          bom_type: isSemi ? "semi_finished" : "finished_good",
          bom_category: d.bom.bom_category ?? "PCR Kit",
          variant_code: d.bom.variant_code ?? "BASE",
          supply_form: d.bom.supply_form ?? "NO_SPLIT_NO_IC",
          parent_item_code: d.bom.parent_item_code ?? (String(d.bom.product_code || "").toUpperCase().endsWith(".D.IC") ? baseCode : ""),
          tccs_code: d.bom.tccs_code ?? (isSemi ? `TCCS-BTP-${baseCode}:2026/ABT` : "TCCS 01:2026/ABT"),
          tccs_file_name: d.bom.tccs_file_name ?? "",
          tccs_file_url: d.bom.tccs_file_url ?? "",
          registration_no: d.bom.registration_no ?? (isSemi ? "" : "2400189/ĐKLH-BYT-TB-CT"),
          responsible_person_name: d.bom.responsible_person_name ?? "",
          qc_assignee_name: d.bom.qc_assignee_name ?? "",
          specification: d.bom.specification ?? (isSemi ? `Lô chuẩn ${d.bom.base_qty} ${d.bom.base_uom}` : `Hộp ${d.bom.tests_per_kit || 50} test`),
          storage_condition: d.bom.storage_condition ?? "-20°C ± 2°C",
          tests_per_kit: String(d.bom.tests_per_kit ?? 50),
          shelf_life_months: String(d.bom.shelf_life_months ?? Math.max(1, Math.round(Number(d.bom.shelf_life_days || 365) / 30))),
          shelf_life_days: String(d.bom.shelf_life_days ?? 365),
          qc_retention_qty: String(d.bom.qc_retention_qty ?? (isSemi ? 0 : 1)),
          ph_min: d.bom.ph_min != null ? String(d.bom.ph_min) : "",
          ph_max: d.bom.ph_max != null ? String(d.bom.ph_max) : "",
          notes: d.bom.notes ?? "",
        });

        const isPcrCat = (d.bom.bom_category ?? "PCR Kit") === "PCR Kit";
        setLabelIfuForm({
          label_template_code: d.bom.label_template_code ?? `LBL-${d.bom.product_code}-V1`,
          label_dimensions:
            d.bom.label_dimensions ??
            (isSemi
              ? "Nhãn Chai/Can BTP: 70×40 mm · Nhãn Ống lưu mẫu: 35×15 mm"
              : isPcrCat
                ? "Nhãn Hộp ngoài: 100×50 mm · Nhãn Hộp phụ: 80×40 mm · Nhãn Ống 1.5mL: 35×15 mm (3 tem/hàng)"
                : "Nhãn Hộp ngoài: 100×50 mm · Nhãn Chai/Lọ thành phần: 50×25 mm (2 tem/hàng)"),
          udi_di: d.bom.udi_di ?? "(01)08936192830117",
          ifu_code: d.bom.ifu_code ?? `IFU-${baseCode}`,
          ifu_version: d.bom.ifu_version ?? `Rev 0${d.bom.bom_version || 1} (Hiệu lực ISO 13485)`,
          ifu_intended_use:
            d.bom.ifu_intended_use ??
            (isPcrCat
              ? "Bộ Kit xét nghiệm chẩn đoán in vitro (IVD) phát hiện và định lượng acid nucleic đặc hiệu bằng kỹ thuật Real-time PCR / RT-qPCR trên mẫu bệnh phẩm lâm sàng."
              : "Bộ Kit / Hóa chất xét nghiệm sinh học phân tử dùng cho quy trình tách chiết acid nucleic hoặc điện di kiểm tra sản phẩm khuếch đại trong phòng xét nghiệm."),
          ifu_thermal_profile:
            d.bom.ifu_thermal_profile ??
            (isPcrCat
              ? "Bước 1 (UNG/RT): 50°C × 10 phút (1 chu kỳ) ➔ Bước 2 (Biến tính đầu): 95°C × 3 phút (1 chu kỳ) ➔ Bước 3 (Khuếch đại 45 chu kỳ): 95°C × 15 giây + 60°C × 45 giây (Thu tín hiệu huỳnh quang tại 60°C)."
              : "Thực hiện theo quy trình chuẩn bị mẫu / tách chiết / điện di quy định trong Tiêu chuẩn cơ sở (TCCS) của sản phẩm."),
          ifu_channels:
            d.bom.ifu_channels ??
            (isPcrCat
              ? "FAM: Đích tác nhân chính (Target) · HEX/VIC: Chứng nội (Internal Control - IC) · ROX: Tham chiếu thụ động"
              : "Không áp dụng (Sản phẩm Tách chiết / Đệm / Điện di)"),
          ifu_interpretation:
            d.bom.ifu_interpretation ??
            (isPcrCat
              ? "Dương tính: Ct (FAM) ≤ 38.0 có đường cong khuếch đại dạng chữ S · Âm tính: Không lên FAM và Ct (HEX/IC) ≤ 35.0 · Không hợp lệ: Không lên cả FAM và HEX/IC."
              : "Đánh giá độ tinh sạch / hiệu suất thu hồi hoặc vạch băng điện di theo tiêu chuẩn chất lượng trong TCCS."),
          ifu_file_name: d.bom.ifu_file_name ?? `HDSD_${baseCode}_Rev0${d.bom.bom_version || 1}.pdf`,
          ifu_file_url: d.bom.ifu_file_url ?? "",
          ifu_file_size: d.bom.ifu_file_size ?? "428 KB (PDF chuẩn ISO 13485)",
          ifu_aliquoted_file_name: d.bom.ifu_aliquoted_file_name ?? `HDSD_${baseCode}.D.IC_ChiaSan_Rev0${d.bom.bom_version || 1}.pdf`,
          ifu_aliquoted_file_url: d.bom.ifu_aliquoted_file_url ?? "",
          ifu_aliquoted_file_size: d.bom.ifu_aliquoted_file_size ?? "452 KB (PDF bản chia sẵn .D.IC)",
        });

        setLabelBundle(
          normalizeLabelBundle(
            d.bom.label_design_json,
            {
              storage: d.bom.storage_condition || (isPcrCat ? "-20°C ± 2°C" : "15-25°C"),
              tccsCode: d.bom.tccs_code || "TCCS 01:2026/ABT",
            },
            isSemi,
            d.bom.bom_category ?? "PCR Kit",
            d.packaging || []
          )
        );

        const defaultSf = d.bom.supply_form || "NO_SPLIT_NO_IC";
        const defaultMfg = vnToday();
        const autoLot =
          !isSemi && isPcrCat
            ? buildAbtKitLotCode({
                mfgDate: defaultMfg,
                seqNo: 1,
                supplyForm: defaultSf,
                tubeCode: "T02",
              })
            : "";
        setIssueOrderForm((prev) => ({
          ...prev,
          org_unit_id: d.bom.org_unit_id || options.units[0]?.id || prev.org_unit_id,
          warehouse_id: options.warehouses[0]?.id || prev.warehouse_id,
          internal_order_line_id: "",
          planned_qty: isSemi ? String(d.bom.base_qty || 1) : "10",
          supply_form: defaultSf,
          tube_code: "T02",
          is_demo: false,
          qc_retention_qty: String(d.bom.qc_retention_qty ?? (isSemi ? 0 : 1)),
          no_retention: isSemi,
          lot_code: autoLot,
          mfg_date: defaultMfg,
          priority: "NORMAL",
          notes: `Phát hành trực tiếp từ ${d.bom.code} (v${d.bom.bom_version}) — ${d.bom.product_code}`,
        }));
      }
    } catch (e) {
      setError(e);
    }
  }, []);

  const loadRoutingDetail = useCallback(async (id: string) => {
    if (!id) return;
    try {
      setRoutingDetail(await api(`/api/factory/kit/routings/${id}`));
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedBomId) loadBomDetail(selectedBomId, lineSearch, lineBoxFilter);
  }, [selectedBomId, lineSearch, lineBoxFilter, loadBomDetail]);

  useEffect(() => {
    if (selectedRoutingId) loadRoutingDetail(selectedRoutingId);
  }, [selectedRoutingId, loadRoutingDetail]);

  const kitProducts = options.items.filter((i) => ["FINISHED_KIT", "KIT", "SEMI_FINISHED"].includes(i.item_type));
  const kitStaffList: Array<{ user_id: number; display_name: string }> = (options as any).kit_staff || [];
  const qaStaffList: Array<{ user_id: number; display_name: string }> = (options as any).qa_staff || [];

  const handleCreateBom = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const shelfMonths = Math.max(1, Number(bomForm.shelf_life_months || 12));
      const shelfDays = Number(bomForm.shelf_life_days) || shelfMonths * 30;
      const res = await api<{ bom: any }>("/api/factory/kit/boms", {
        method: "POST",
        idempotent: true,
        json: {
          org_unit_id: bomForm.org_unit_id || options.units[0]?.id,
          product_item_id: bomForm.product_item_id,
          routing_id: bomForm.routing_id || null,
          name: bomForm.name,
          bom_type: bomForm.bom_type,
          bom_category: bomForm.bom_category,
          variant_code: bomForm.variant_code || "BASE",
          supply_form: bomForm.supply_form || "NO_SPLIT_NO_IC",
          parent_item_code: bomForm.parent_item_code || null,
          tccs_code: bomForm.tccs_code || null,
          tccs_file_name: bomForm.tccs_file_name || null,
          tccs_file_url: bomForm.tccs_file_url || null,
          registration_no: bomForm.registration_no || null,
          responsible_person_name: bomForm.responsible_person_name || null,
          qc_assignee_name: bomForm.qc_assignee_name || null,
          specification: bomForm.specification || null,
          storage_condition: bomForm.storage_condition || null,
          tests_per_kit: Number(bomForm.tests_per_kit || 50),
          shelf_life_months: shelfMonths,
          shelf_life_days: shelfDays,
          qc_retention_qty: Number(bomForm.qc_retention_qty || 0),
          ph_min: bomForm.ph_min !== "" ? Number(bomForm.ph_min) : null,
          ph_max: bomForm.ph_max !== "" ? Number(bomForm.ph_max) : null,
          clone_from_bom_id: bomForm.clone_from_bom_id || null,
        },
      });
      setBomForm((p) => ({ ...p, name: "" }));
      setShowCreateBom(false);
      setSelectedBomId(res.bom.id);
      await loadList();
      await loadBomDetail(res.bom.id);
    } catch (err) {
      setError(err);
    }
  };

  const handleSaveBomHeader = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBomId) return;
    setError(null);
    try {
      await api(`/api/factory/kit/boms/${selectedBomId}`, {
        method: "POST",
        json: {
          kind: "update_header",
          ...editHeaderForm,
          tests_per_kit: Number(editHeaderForm.tests_per_kit || 50),
          shelf_life_months: Number(editHeaderForm.shelf_life_months || 12),
          shelf_life_days: Number(editHeaderForm.shelf_life_days || 365),
          qc_retention_qty: Number(editHeaderForm.qc_retention_qty || 0),
          ph_min: editHeaderForm.ph_min !== "" ? Number(editHeaderForm.ph_min) : null,
          ph_max: editHeaderForm.ph_max !== "" ? Number(editHeaderForm.ph_max) : null,
        },
      });
      setShowEditHeader(false);
      await loadBomDetail(selectedBomId);
      await loadList();
    } catch (err) {
      setError(err);
    }
  };

  const handleQuickAssignRouting = async (routingId: string) => {
    if (!selectedBomId) return;
    setError(null);
    try {
      await api(`/api/factory/kit/boms/${selectedBomId}`, {
        method: "POST",
        json: {
          kind: "assign_routing",
          routing_id: routingId || null,
        },
      });
      await loadBomDetail(selectedBomId, lineSearch, lineBoxFilter);
      await loadList();
    } catch (err) {
      setError(err);
    }
  };

  const handleIssueOrderFromBom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bomDetail?.bom) return;
    setError(null);
    setIssueOrderBusy(true);
    try {
      const b = bomDetail.bom;
      const isSemi = b.bom_type === "semi_finished" || b.product_type === "SEMI_FINISHED";
      const isPcrCat = !isSemi && (b.bom_category ?? "PCR Kit") === "PCR Kit";
      const sfSpec = ABT_KIT_SUPPLY_FORMS[issueOrderForm.supply_form] || ABT_KIT_SUPPLY_FORMS.NO_SPLIT_NO_IC;
      const effectiveMode = issueOrderForm.is_demo
        ? "DEMO"
        : isPcrCat && sfSpec.is_aliquoted
          ? "ALIQUOTED"
          : "STANDARD";
      const res = await api<{ order: any }>("/api/factory/kit/orders", {
        method: "POST",
        idempotent: true,
        json: {
          org_unit_id: issueOrderForm.org_unit_id || b.org_unit_id || options.units[0]?.id,
          product_item_id: b.product_item_id,
          bom_id: b.id,
          warehouse_id: issueOrderForm.warehouse_id || options.warehouses[0]?.id,
          planned_qty: Number(issueOrderForm.planned_qty || 1),
          supply_form: isPcrCat ? issueOrderForm.supply_form : null,
          tube_code: isPcrCat ? issueOrderForm.tube_code || "T02" : null,
          order_mode: effectiveMode,
          is_aliquoted: isPcrCat ? sfSpec.is_aliquoted : false,
          is_demo: !isSemi && issueOrderForm.is_demo,
          demo_specification: !isSemi && issueOrderForm.is_demo ? issueOrderForm.demo_specification : null,
          qc_retention_qty: issueOrderForm.no_retention ? 0 : Number(issueOrderForm.qc_retention_qty || 0),
          no_retention: issueOrderForm.no_retention,
          lot_code: issueOrderForm.lot_code.trim() || null,
          mfg_date: issueOrderForm.mfg_date || vnToday(),
          priority: issueOrderForm.priority || "NORMAL",
          internal_order_line_id: issueOrderForm.internal_order_line_id || null,
          notes: issueOrderForm.notes || `Phát hành từ ${b.code} (v${b.bom_version})`,
        },
      });
      setCreatedOrderResult(res.order);
      setShowIssueOrder(false);
      await loadList();
      await loadBomDetail(b.id);
      onRefreshOptions();
    } catch (err) {
      setError(err);
    } finally {
      setIssueOrderBusy(false);
    }
  };

  const openAndPrintIfuFile = (mode: "STANDARD" | "ALIQUOTED", autoPrint = false) => {
    if (!bomDetail?.bom) return;
    const b = bomDetail.bom;
    const fileUrl = mode === "ALIQUOTED" ? labelIfuForm.ifu_aliquoted_file_url || b.ifu_aliquoted_file_url : labelIfuForm.ifu_file_url || b.ifu_file_url;
    const fileName =
      mode === "ALIQUOTED"
        ? labelIfuForm.ifu_aliquoted_file_name || b.ifu_aliquoted_file_name || `HDSD_${b.product_code}.D.IC.pdf`
        : labelIfuForm.ifu_file_name || b.ifu_file_name || `HDSD_${b.product_code}.pdf`;

    if (fileUrl && (fileUrl.startsWith("data:application/pdf") || fileUrl.startsWith("http"))) {
      const win = window.open(fileUrl, "_blank");
      if (win && autoPrint) {
        setTimeout(() => win.print(), 600);
      }
      return;
    }

    const win = window.open("", "_blank", "width=920,height=860");
    if (!win) return;
    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>${fileName} — Hướng dẫn sử dụng (IFU)</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 28px 36px; color: #0f172a; line-height: 1.5; font-size: 13px; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #0284c7; padding-bottom: 12px; margin-bottom: 16px; }
          .badge { background: #0284c7; color: #fff; font-weight: bold; padding: 4px 10px; border-radius: 4px; font-size: 12px; }
          h1 { font-size: 18px; margin: 0 0 4px 0; color: #0369a1; }
          .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; background: #f8fafc; border: 1px solid #cbd5e1; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; font-size: 12px; }
          .sec { margin-bottom: 14px; }
          .sec-title { font-weight: bold; color: #0f172a; background: #e0f2fe; padding: 5px 10px; border-left: 4px solid #0284c7; margin-bottom: 6px; text-transform: uppercase; font-size: 12px; }
          table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 12px; }
          th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
          th { background: #f1f5f9; }
          @media print { .no-print { display: none; } body { margin: 12mm; } }
        </style>
      </head>
      <body>
        <div class="no-print" style="margin-bottom: 14px; text-align: right;">
          <button onclick="window.print()" style="padding: 8px 16px; background: #0284c7; color: #fff; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;">🖨️ In Tờ Hướng Dẫn Sử Dụng (IFU)</button>
        </div>
        <div class="header">
          <div>
            <img src="${typeof window !== "undefined" ? window.location.origin : ""}/logo-abt.png" alt="ABT" style="height: 34px; object-fit: contain; display: block; margin-bottom: 4px;" />
            <div style="font-size: 11px; font-weight: bold; color: #0284c7;">CÔNG TY TNHH GIẢI PHÁP Y SINH ABT</div>
            <h1>HƯỚNG DẪN SỬ DỤNG (INSTRUCTIONS FOR USE — IFU)</h1>
            <div style="font-size: 13px; font-weight: bold;">${b.product_name} (${mode === "ALIQUOTED" ? `${b.product_code} — Dạng Chia Sẵn .D.IC` : b.product_code})</div>
          </div>
          <div style="text-align: right;">
            <span class="badge">IVD · ISO 13485:2016</span>
            <div style="font-size: 11px; margin-top: 6px; font-family: monospace;">Tệp: ${fileName}</div>
            <div style="font-size: 11px; font-family: monospace;">Mã tài liệu: ${labelIfuForm.ifu_code} · ${labelIfuForm.ifu_version}</div>
          </div>
        </div>
        <div class="meta-grid">
          <div><b>Mã sản phẩm (REF):</b> ${b.product_code}</div>
          <div><b>Quy cách đóng gói:</b> ${b.specification || `Hộp ${b.tests_per_kit || 50} test`}</div>
          <div><b>Tiêu chuẩn cơ sở:</b> ${b.tccs_code || "TCCS 01:2026/ABT"}</div>
          <div><b>Điều kiện bảo quản:</b> ${b.storage_condition || "-20°C ± 2°C"}</div>
          <div><b>Hạn sử dụng:</b> ${b.shelf_life_months || 12} tháng kể từ NSX</div>
          <div><b>Số ĐKLH / UDI-DI:</b> ${b.registration_no || labelIfuForm.udi_di}</div>
        </div>
        ${
          fileUrl && fileUrl.startsWith("data:image/")
            ? `<div style="text-align:center; margin: 12px 0;"><img src="${fileUrl}" style="max-width:100%; border:1px solid #cbd5e1;" /></div>`
            : ""
        }
        <div class="sec">
          <div class="sec-title">1. Mục đích sử dụng (Intended Use)</div>
          <div>${labelIfuForm.ifu_intended_use}</div>
        </div>
        <div class="sec">
          <div class="sec-title">2. Thành phần Bộ Kit & Quy cách ống (${mode === "ALIQUOTED" ? "Bản chia sẵn vào strip/tube .D.IC" : "Bản tiêu chuẩn"})</div>
          <table>
            <thead><tr><th>Hộp</th><th>Tên thành phần</th><th>Định mức / Đơn vị</th><th>Bảo quản</th></tr></thead>
            <tbody>
              ${
                (bomDetail.packaging || []).length > 0
                  ? (bomDetail.packaging || [])
                      .map(
                        (pk: any) =>
                          `<tr><td>Hộp ${pk.box_no}: ${pk.box_name}</td><td><b>${pk.component_name}</b></td><td>${pk.units_per_kit} ống × ${pk.fill_qty} ${pk.fill_uom}</td><td>${pk.storage_temp}</td></tr>`
                      )
                      .join("")
                  : (bomDetail.lines || [])
                      .map(
                        (ln: any) =>
                          `<tr><td>Hộp ${ln.box_no}</td><td><b>${ln.component_code}</b> — ${ln.component_name}</td><td>${mode === "ALIQUOTED" && ln.qty_per_base_aliquoted != null ? ln.qty_per_base_aliquoted : ln.qty_per_base} ${ln.uom}</td><td>${b.storage_condition || "-20°C"}</td></tr>`
                      )
                      .join("")
              }
            </tbody>
          </table>
        </div>
        <div class="sec">
          <div class="sec-title">3. Chương trình Chu kỳ nhiệt Real-time PCR (Thermal Cycling Protocol)</div>
          <div>${labelIfuForm.ifu_thermal_profile}</div>
        </div>
        <div class="sec">
          <div class="sec-title">4. Kênh màu Huỳnh quang & Phiên giải kết quả (Result Interpretation)</div>
          <div><b>Kênh đọc huỳnh quang:</b> ${labelIfuForm.ifu_channels}</div>
          <div style="margin-top: 4px;"><b>Tiêu chuẩn phiên giải Ct:</b> ${labelIfuForm.ifu_interpretation}</div>
        </div>
      </body>
      </html>
    `);
    win.document.close();
    if (autoPrint) {
      setTimeout(() => win.print(), 350);
    }
  };

  const handleAddBomLine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBomId) return;
    setError(null);
    try {
      const item = options.items.find((i) => i.id === lineForm.component_item_id);
      await api(`/api/factory/kit/boms/${selectedBomId}`, {
        method: "POST",
        json: {
          kind: editingLineId ? "update_line" : "line",
          line_id: editingLineId ?? undefined,
          component_item_id: lineForm.component_item_id,
          qty_per_base: Number(lineForm.qty_per_base),
          qty_per_base_aliquoted: lineForm.qty_per_base_aliquoted ? Number(lineForm.qty_per_base_aliquoted) : null,
          uom: lineForm.uom || item?.base_uom || "EA",
          scrap_pct: Number(lineForm.scrap_pct),
          box_no: Number(lineForm.box_no),
          component_role: lineForm.component_role,
          is_critical: lineForm.is_critical,
          is_bundled: lineForm.is_bundled,
          bundle_parent_code: lineForm.bundle_parent_code.trim() || null,
          allow_substitute: lineForm.allow_substitute,
          is_mix_component: lineForm.is_mix_component,
          is_demo_fixed_component: lineForm.is_demo_fixed_component,
          include_in_qc_retention: lineForm.include_in_qc_retention,
        },
      });
      setEditingLineId(null);
      setShowAddLine(false);
      await loadBomDetail(selectedBomId, lineSearch, lineBoxFilter);
      await loadList();
    } catch (err) {
      setError(err);
    }
  };

  const handleStartEditLine = (l: any) => {
    setEditingLineId(l.id);
    setLineForm({
      component_item_id: l.component_item_id || "",
      qty_per_base: String(l.qty_per_base ?? 1),
      qty_per_base_aliquoted: l.qty_per_base_aliquoted != null ? String(l.qty_per_base_aliquoted) : "",
      uom: l.uom || "mL",
      scrap_pct: String(l.scrap_pct ?? 2),
      box_no: String(l.box_no ?? 1),
      component_role: l.component_role || "REAGENT",
      is_critical: l.is_critical !== false,
      is_bundled: Boolean(l.is_bundled),
      bundle_parent_code: l.bundle_parent_code || "",
      allow_substitute: Boolean(l.allow_substitute),
      is_mix_component: l.is_mix_component !== false,
      is_demo_fixed_component: Boolean(l.is_demo_fixed_component),
      include_in_qc_retention: l.include_in_qc_retention !== false,
    });
    setShowAddLine(true);
  };

  const handleDeleteBomLine = async (lineId: string) => {
    if (!selectedBomId) return;
    setError(null);
    try {
      await api(`/api/factory/kit/boms/${selectedBomId}`, {
        method: "POST",
        json: { kind: "delete_line", line_id: lineId },
      });
      if (editingLineId === lineId) {
        setEditingLineId(null);
        setShowAddLine(false);
      }
      await loadBomDetail(selectedBomId, lineSearch, lineBoxFilter);
      await loadList();
    } catch (err) {
      setError(err);
    }
  };

  const handleAddSubstitute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBomId || !subForm.bom_line_id || !subForm.substitute_item_id) return;
    setError(null);
    try {
      await api(`/api/factory/kit/boms/${selectedBomId}`, {
        method: "POST",
        json: {
          kind: "substitute",
          bom_line_id: subForm.bom_line_id,
          substitute_item_id: subForm.substitute_item_id,
          conversion_factor: Number(subForm.conversion_factor || 1),
          priority: Number(subForm.priority || 1),
          notes: subForm.notes || null,
        },
      });
      setSubForm((p) => ({ ...p, substitute_item_id: "", notes: "" }));
      await loadBomDetail(selectedBomId);
    } catch (err) {
      setError(err);
    }
  };

  const handleCreateQuickItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const created = await api<any>("/api/factory/master/items", {
        method: "POST",
        json: {
          code: quickItemForm.code.trim(),
          name: quickItemForm.name.trim(),
          item_type: quickItemForm.item_type,
          base_uom: quickItemForm.base_uom.trim() || "KIT",
          storage_temp: quickItemForm.storage_temp || "-20°C",
          shelf_life_days: Number(quickItemForm.shelf_life_days || 365),
          lot_tracked: true,
          qc_required: ["FINISHED_KIT", "SEMI_FINISHED", "RAW_MATERIAL"].includes(quickItemForm.item_type),
        },
      });
      setQuickItemForm((p) => ({ ...p, code: "", name: "" }));
      setShowQuickItem(false);
      await onRefreshOptions();
      if (["FINISHED_KIT", "SEMI_FINISHED"].includes(created.item_type)) {
        setBomForm((p) => ({ ...p, product_item_id: created.id }));
      }
    } catch (err) {
      setError(err);
    }
  };

  const handleAddPackaging = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBomId) return;
    setError(null);
    try {
      await api(`/api/factory/kit/boms/${selectedBomId}`, {
        method: "POST",
        json: {
          kind: editingPackId ? "update_packaging" : "packaging",
          pack_id: editingPackId ?? undefined,
          box_no: Number(packForm.box_no),
          box_name: packForm.box_name,
          component_name: packForm.component_name,
          container_type: packForm.container_type,
          fill_qty: Number(packForm.fill_qty),
          fill_uom: packForm.fill_uom,
          units_per_kit: Number(packForm.units_per_kit),
          storage_temp: packForm.storage_temp,
        },
      });
      setEditingPackId(null);
      setShowAddPack(false);
      await loadBomDetail(selectedBomId);
      await loadList();
    } catch (err) {
      setError(err);
    }
  };

  const handleStartEditPackaging = (pk: any) => {
    setEditingPackId(pk.id);
    setPackForm({
      box_no: String(pk.box_no ?? 1),
      box_name: pk.box_name || "Hộp 1: Hóa chất khuếch đại PCR",
      component_name: pk.component_name || "",
      container_type: pk.container_type || "TUBE_1_5ML",
      fill_qty: String(pk.fill_qty ?? 500),
      fill_uom: pk.fill_uom || "µL",
      units_per_kit: String(pk.units_per_kit ?? 1),
      storage_temp: pk.storage_temp || "-20°C",
    });
    setShowAddPack(true);
  };

  const handleDeletePackaging = async (packId: string) => {
    if (!selectedBomId) return;
    setError(null);
    try {
      await api(`/api/factory/kit/boms/${selectedBomId}`, {
        method: "POST",
        json: { kind: "delete_packaging", pack_id: packId },
      });
      if (editingPackId === packId) {
        setEditingPackId(null);
        setShowAddPack(false);
      }
      await loadBomDetail(selectedBomId);
      await loadList();
    } catch (err) {
      setError(err);
    }
  };

  const handleSyncPackaging = async () => {
    if (!selectedBomId) return;
    setError(null);
    try {
      await api(`/api/factory/kit/boms/${selectedBomId}`, {
        method: "POST",
        json: { kind: "sync_packaging" },
      });
      await loadBomDetail(selectedBomId, lineSearch, lineBoxFilter);
      await loadList();
    } catch (err) {
      setError(err);
    }
  };

  const handleQuickPairContainer = async (solutionLine: any, containerCode: string) => {
    if (!selectedBomId || !solutionLine?.id) return;
    setError(null);
    try {
      await api(`/api/factory/kit/boms/${selectedBomId}`, {
        method: "POST",
        json: {
          kind: "update_line",
          line_id: solutionLine.id,
          component_item_id: solutionLine.component_item_id,
          qty_per_base: Number(solutionLine.qty_per_base),
          qty_per_base_aliquoted:
            solutionLine.qty_per_base_aliquoted != null ? Number(solutionLine.qty_per_base_aliquoted) : null,
          uom: solutionLine.uom,
          scrap_pct: Number(solutionLine.scrap_pct ?? 0),
          box_no: Number(solutionLine.box_no ?? 1),
          component_role: solutionLine.component_role,
          is_critical: solutionLine.is_critical !== false,
          is_bundled: Boolean(solutionLine.is_bundled),
          bundle_parent_code: containerCode.trim() || null,
          allow_substitute: Boolean(solutionLine.allow_substitute),
          is_mix_component: solutionLine.is_mix_component !== false,
          is_demo_fixed_component: Boolean(solutionLine.is_demo_fixed_component),
          include_in_qc_retention: solutionLine.include_in_qc_retention !== false,
        },
      });
      await api(`/api/factory/kit/boms/${selectedBomId}`, {
        method: "POST",
        json: { kind: "sync_packaging" },
      });
      await loadBomDetail(selectedBomId, lineSearch, lineBoxFilter);
      await loadList();
    } catch (err) {
      setError(err);
    }
  };

  const handleSaveLabelIfu = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedBomId) return;
    setError(null);
    try {
      const dimsSummary = `Nhãn Hộp ngoài: ${labelBundle.outer_box.width_mm}×${labelBundle.outer_box.height_mm} mm · Nhãn Hộp phụ: ${labelBundle.sub_box.width_mm}×${labelBundle.sub_box.height_mm} mm · Nhãn Ống: ${labelBundle.tube.width_mm}×${labelBundle.tube.height_mm} mm (${labelBundle.tube.labels_per_row} tem/hàng)`;
      await api(`/api/factory/kit/boms/${selectedBomId}`, {
        method: "POST",
        json: {
          kind: "label_ifu",
          ...labelIfuForm,
          label_dimensions: labelIfuForm.label_dimensions || dimsSummary,
          label_design_json: labelBundle,
        },
      });
      setShowEditLabelIfu(false);
      await loadBomDetail(selectedBomId);
      await loadList();
    } catch (err) {
      setError(err);
    }
  };

  const handleFastActivateBom = async () => {
    if (!selectedBomId) return;
    setError(null);
    try {
      await api(`/api/factory/kit/boms/${selectedBomId}`, {
        method: "POST",
        json: { kind: "fast_activate" },
      });
      await loadBomDetail(selectedBomId);
      await loadList();
    } catch (err) {
      setError(err);
    }
  };

  const handleCloneRouting = async (id: string) => {
    setError(null);
    try {
      const res = await api<{ routing: any }>(`/api/factory/kit/routings/${id}`, {
        method: "POST",
        json: { operation: "clone" },
      });
      setSelectedRoutingId(res.routing.id);
      await loadList();
      await loadRoutingDetail(res.routing.id);
    } catch (err) {
      setError(err);
    }
  };

  const handleLoadStandardSteps = async (id: string, templateKey?: string) => {
    setError(null);
    try {
      await api(`/api/factory/kit/routings/${id}`, {
        method: "POST",
        json: {
          operation: "load_standard_steps",
          template_key: templateKey || selectedTemplateForLoad || "PCR_5_STEPS",
        },
      });
      await loadList();
      await loadRoutingDetail(id);
    } catch (err) {
      setError(err);
    }
  };

  const handleFastActivateRouting = async (id: string) => {
    setError(null);
    try {
      await api(`/api/factory/kit/routings/${id}`, {
        method: "POST",
        json: { operation: "fast_activate" },
      });
      await loadList();
      await loadRoutingDetail(id);
    } catch (err) {
      setError(err);
    }
  };

  const applyTemplateToDraftSteps = (tplKey: string) => {
    setRtTemplateKey(tplKey);
    if (tplKey === "CUSTOM_EMPTY") {
      setRtDraftSteps([]);
      return;
    }
    const found = ROUTING_STANDARD_TEMPLATES.find((t) => t.key === tplKey);
    if (found) {
      setRtDraftSteps(JSON.parse(JSON.stringify(found.steps)));
      if (!rtForm.name.trim()) {
        setRtForm((p) => ({ ...p, name: found.label.replace(/^[^\s]+\s+/, "") }));
      }
    }
  };

  const handleAddDraftStepFromFunction = (funcKey: string) => {
    const spec = STEP_FUNCTION_CATALOG[funcKey] || STEP_FUNCTION_CATALOG.FORMULATION_MIXING;
    const nextSeq = rtDraftSteps.length > 0 ? Math.max(...rtDraftSteps.map((s) => Number(s.seq) || 0)) + 10 : 10;
    const newStep: RoutingStepDraft = {
      seq: nextSeq,
      step_code: `${spec.defaultStepCodePrefix || "STEP"}-${nextSeq}`,
      step_name: spec.defaultStepName,
      category: spec.defaultCategory,
      step_function: spec.key,
      work_center: spec.defaultWorkCenter,
      instructions: spec.defaultInstructions,
      sop_doc_code: spec.defaultSop,
      std_duration_min: spec.defaultDurationMin,
      required_asset_id: "",
      is_qc: Boolean(spec.defaultFlags.qc_gate),
      requires_check_signature: spec.defaultFlags.dual_sign !== false,
      allow_skip: false,
      functional_flags: { ...spec.defaultFlags },
      param_schema: JSON.parse(JSON.stringify(spec.defaultParams)),
    };
    setRtDraftSteps((prev) => [...prev, newStep]);
  };

  const handleChangeDraftStepFunction = (idx: number, funcKey: string) => {
    const spec = STEP_FUNCTION_CATALOG[funcKey];
    if (!spec) return;
    setRtDraftSteps((prev) =>
      prev.map((step, i) =>
        i !== idx
          ? step
          : {
              ...step,
              step_function: spec.key,
              category: spec.defaultCategory,
              step_name: spec.defaultStepName,
              work_center: spec.defaultWorkCenter,
              sop_doc_code: spec.defaultSop,
              std_duration_min: spec.defaultDurationMin,
              instructions: spec.defaultInstructions,
              is_qc: Boolean(spec.defaultFlags.qc_gate),
              requires_check_signature: spec.defaultFlags.dual_sign !== false,
              functional_flags: { ...spec.defaultFlags },
              param_schema: JSON.parse(JSON.stringify(spec.defaultParams)),
            }
      )
    );
  };

  const handleMoveDraftStep = (idx: number, dir: "UP" | "DOWN") => {
    setRtDraftSteps((prev) => {
      const targetIdx = dir === "UP" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const next = [...prev];
      const temp = next[idx];
      next[idx] = next[targetIdx];
      next[targetIdx] = temp;
      return next.map((s, i) => ({
        ...s,
        seq: (i + 1) * 10,
        step_code: `STEP-${(i + 1) * 10}`,
      }));
    });
  };

  const handleDeleteDraftStep = (idx: number) => {
    setRtDraftSteps((prev) =>
      prev
        .filter((_, i) => i !== idx)
        .map((s, i) => ({
          ...s,
          seq: (i + 1) * 10,
        }))
    );
  };

  const handleCreateRouting = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api<{ routing: any }>("/api/factory/kit/routings", {
        method: "POST",
        idempotent: true,
        json: {
          org_unit_id: rtForm.org_unit_id || options.units[0]?.id,
          product_item_id: rtForm.product_item_id || null,
          routing_category: rtForm.routing_category || "PCR Kit",
          name: rtForm.name,
          notes: rtForm.notes || null,
          steps: rtDraftSteps,
        },
      });
      setRtForm((p) => ({ ...p, name: "", notes: "" }));
      setShowCreateRouting(false);
      setSelectedRoutingId(res.routing.id);
      await loadList();
      await loadRoutingDetail(res.routing.id);
    } catch (err) {
      setError(err);
    }
  };

  const handleSelectStepFunctionInForm = (funcKey: string) => {
    const spec = STEP_FUNCTION_CATALOG[funcKey];
    if (!spec) return;
    setStepForm((prev) => ({
      ...prev,
      step_function: spec.key,
      category: spec.defaultCategory,
      step_name: spec.defaultStepName,
      work_center: spec.defaultWorkCenter,
      sop_doc_code: spec.defaultSop,
      std_duration_min: String(spec.defaultDurationMin),
      instructions: spec.defaultInstructions,
      expected_output: spec.defaultFlags.expected_output || "",
      is_qc: Boolean(spec.defaultFlags.qc_gate),
      requires_check_signature: spec.defaultFlags.dual_sign !== false,
      functional_flags: {
        require_line_clearance: Boolean(spec.defaultFlags.require_line_clearance),
        require_material_scan: Boolean(spec.defaultFlags.require_material_scan),
        require_env_log: Boolean(spec.defaultFlags.require_env_log),
        require_yield_reconcile: Boolean(spec.defaultFlags.require_yield_reconcile),
        require_label_ifu_check: Boolean(spec.defaultFlags.require_label_ifu_check),
      },
      params: JSON.parse(JSON.stringify(spec.defaultParams)),
    }));
  };

  const handleStartEditStep = (s: any) => {
    const flags = s.functional_flags && typeof s.functional_flags === "object" ? s.functional_flags : {};
    setEditingStepId(s.id);
    setStepForm({
      seq: String(s.seq ?? 10),
      step_code: s.step_code || `STEP-${s.seq ?? 10}`,
      step_name: s.step_name || "",
      category: s.category || "FORMULATION",
      step_function: s.step_function || (s.is_qc ? "IPQC_PH_GATE" : s.category || "FORMULATION_MIXING"),
      work_center: s.work_center || "Phòng sạch Pha chế (Class 10,000 / ISO 7)",
      instructions: s.instructions || "",
      sop_doc_code: s.sop_doc_code || "",
      std_duration_min: String(s.std_duration_min ?? 30),
      required_asset_id: s.required_asset_id || "",
      expected_output: s.expected_output || flags.expected_output || "",
      is_qc: Boolean(s.is_qc),
      requires_check_signature: s.requires_check_signature !== false,
      allow_skip: Boolean(s.allow_skip),
      functional_flags: {
        require_line_clearance: Boolean(flags.require_line_clearance),
        require_material_scan: Boolean(flags.require_material_scan),
        require_env_log: Boolean(flags.require_env_log),
        require_yield_reconcile: Boolean(flags.require_yield_reconcile),
        require_label_ifu_check: Boolean(flags.require_label_ifu_check),
      },
      params: Array.isArray(s.param_schema)
        ? s.param_schema.map((p: any) => ({
            key: String(p.key || "param_1"),
            label: String(p.label || p.key || "Thông số"),
            type: (p.type || "number") as "number" | "text" | "boolean",
            unit: String(p.unit ?? ""),
            min: p.min != null ? String(p.min) : "",
            max: p.max != null ? String(p.max) : "",
            required: p.required !== false,
          }))
        : [],
    });
    setShowAddStep(true);
  };

  const handleStartAddNewStep = () => {
    const existingSteps = routingDetail?.steps || [];
    const nextSeq = existingSteps.length > 0 ? Math.max(...existingSteps.map((s: any) => Number(s.seq) || 0)) + 10 : 10;
    const spec = STEP_FUNCTION_CATALOG.FORMULATION_MIXING;
    setEditingStepId(null);
    setStepForm({
      seq: String(nextSeq),
      step_code: `STEP-${nextSeq}`,
      step_name: spec.defaultStepName,
      category: spec.defaultCategory,
      step_function: spec.key,
      work_center: spec.defaultWorkCenter,
      instructions: spec.defaultInstructions,
      sop_doc_code: spec.defaultSop,
      std_duration_min: String(spec.defaultDurationMin),
      required_asset_id: "",
      expected_output: spec.defaultFlags.expected_output || "",
      is_qc: Boolean(spec.defaultFlags.qc_gate),
      requires_check_signature: spec.defaultFlags.dual_sign !== false,
      allow_skip: false,
      functional_flags: {
        require_line_clearance: Boolean(spec.defaultFlags.require_line_clearance),
        require_material_scan: Boolean(spec.defaultFlags.require_material_scan),
        require_env_log: Boolean(spec.defaultFlags.require_env_log),
        require_yield_reconcile: Boolean(spec.defaultFlags.require_yield_reconcile),
        require_label_ifu_check: Boolean(spec.defaultFlags.require_label_ifu_check),
      },
      params: JSON.parse(JSON.stringify(spec.defaultParams)),
    });
    setShowAddStep(true);
  };

  const handleMoveRoutingStep = async (stepId: string, direction: "UP" | "DOWN") => {
    if (!selectedRoutingId) return;
    setError(null);
    try {
      await api(`/api/factory/kit/routings/${selectedRoutingId}`, {
        method: "POST",
        json: {
          operation: "move_step",
          step_id: stepId,
          direction,
        },
      });
      await loadRoutingDetail(selectedRoutingId);
    } catch (err) {
      setError(err);
    }
  };

  const handleDeleteRoutingStep = async (stepId: string) => {
    if (!selectedRoutingId) return;
    setError(null);
    try {
      await api(`/api/factory/kit/routings/${selectedRoutingId}`, {
        method: "POST",
        json: {
          operation: "delete_step",
          step_id: stepId,
        },
      });
      if (editingStepId === stepId) {
        setEditingStepId(null);
        setShowAddStep(false);
      }
      await loadRoutingDetail(selectedRoutingId);
      await loadList();
    } catch (err) {
      setError(err);
    }
  };

  const handleAddRoutingStep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRoutingId) return;
    setError(null);
    try {
      const param_schema = (stepForm.params || [])
        .filter((p) => p.key.trim() || p.label.trim())
        .map((p, idx) => ({
          key: p.key.trim() || `param_${idx + 1}`,
          label: p.label.trim() || p.key.trim() || `Thông số ${idx + 1}`,
          type: p.type || "number",
          unit: p.unit || null,
          min: p.min !== null && p.min !== undefined && String(p.min) !== "" ? Number(p.min) : null,
          max: p.max !== null && p.max !== undefined && String(p.max) !== "" ? Number(p.max) : null,
          required: p.required !== false,
        }));
      await api(`/api/factory/kit/routings/${selectedRoutingId}`, {
        method: "POST",
        json: {
          operation: editingStepId ? "update_step" : undefined,
          step_id: editingStepId ?? undefined,
          seq: Number(stepForm.seq),
          step_code: stepForm.step_code,
          step_name: stepForm.step_name,
          category: stepForm.category,
          step_function: stepForm.step_function,
          work_center: stepForm.work_center || null,
          instructions: stepForm.instructions,
          sop_doc_code: stepForm.sop_doc_code || null,
          std_duration_min: Number(stepForm.std_duration_min || 30),
          required_asset_id: stepForm.required_asset_id || null,
          expected_output: stepForm.expected_output || null,
          is_qc: stepForm.is_qc,
          requires_check_signature: stepForm.requires_check_signature,
          allow_skip: stepForm.allow_skip,
          functional_flags: stepForm.functional_flags,
          param_schema,
        },
      });
      setEditingStepId(null);
      setShowAddStep(false);
      await loadRoutingDetail(selectedRoutingId);
      await loadList();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="space-y-3">
      {/* Thanh hướng dẫn trực quan 3 bước: BOM + Nhãn/IFU -> Routing -> Sản xuất theo PO */}
      <div className="rounded-xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/50 dark:bg-sky-950/20 p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="space-y-0.5">
          <div className="font-extrabold text-sky-900 dark:text-sky-200">
            🧭 Luồng Chuẩn Hóa Sản Xuất Kit Theo PO (Thiết lập 1 lần ➔ Áp dụng tự động cho mọi Lô PO):
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-300">
            <b>Bước 1 (Tab phụ 1 — BOM &amp; Nhãn/IFU)</b>: Khai báo công thức hóa chất, quy cách Hộp/Ống, Thiết kế Nhãn &amp; Tờ HDSD (IFU) ➔{" "}
            <b>Bước 2 (Tab phụ 2 — Routing)</b>: Bấm <i>&ldquo;⚡ Nạp mẫu 4 bước công đoạn chuẩn&rdquo;</i> &amp; <i>&ldquo;✅ Kích hoạt Hiệu lực (EFFECTIVE)&rdquo;</i> ➔{" "}
            <b>Bước 3 (Sang Tab 1 — Lệnh SX &amp; EBR)</b>: Chọn PO để phát hành Lô, hệ thống tự động copy các bước Routing thành Hồ sơ lô (EBR) và tự sinh bộ Nhãn + Tờ HDSD để in!
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button variant={subTab === "bom" ? "primary" : "ghost"} onClick={() => setSubTab("bom")}>
            1. Định mức BOM, Quy cách Hộp/Ống &amp; Thiết kế Nhãn / IFU ({boms.length})
          </Button>
          <Button variant={subTab === "routing" ? "primary" : "ghost"} onClick={() => setSubTab("routing")}>
            2. Quy trình công đoạn sản xuất — Routing ({routings.length})
          </Button>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setShowQuickItem(!showQuickItem)}>
            {showQuickItem ? "Đóng tạo mã" : "+ Tạo nhanh Sản phẩm Kit / Bán TP / NVL"}
          </Button>
          <Button variant="ghost" onClick={onRefreshOptions}>
            Làm mới danh mục
          </Button>
        </div>
      </div>

      {showQuickItem && (
        <Card title="Tạo nhanh Sản phẩm Kit / Bán thành phẩm / Vật tư ngay tại Phòng Sản xuất Kit">
          <form onSubmit={handleCreateQuickItem} className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
            <Field label="Mã sản phẩm / VT">
              <input
                className={`${inputClass} font-mono`}
                placeholder="VD: KIT-ASFV-50T"
                value={quickItemForm.code}
                onChange={(e) => setQuickItemForm({ ...quickItemForm, code: e.target.value })}
                required
              />
            </Field>
            <div className="md:col-span-2">
              <Field label="Tên sản phẩm / Bán TP / Hóa chất">
                <input
                  className={inputClass}
                  placeholder="VD: Kit TopSPEC ASFV qPCR (50 test)"
                  value={quickItemForm.name}
                  onChange={(e) => setQuickItemForm({ ...quickItemForm, name: e.target.value })}
                  required
                />
              </Field>
            </div>
            <Field label="Phân loại">
              <select
                className={inputClass}
                value={quickItemForm.item_type}
                onChange={(e) =>
                  setQuickItemForm({
                    ...quickItemForm,
                    item_type: e.target.value,
                    base_uom: e.target.value === "FINISHED_KIT" ? "KIT" : e.target.value === "SEMI_FINISHED" ? "mL" : "EA",
                  })
                }
              >
                <option value="FINISHED_KIT">Thành phẩm Kit (FINISHED_KIT)</option>
                <option value="SEMI_FINISHED">Bán thành phẩm / Hóa chất tách chiết (SEMI_FINISHED)</option>
                <option value="RAW_MATERIAL">Nguyên liệu / Enzyme (RAW_MATERIAL)</option>
                <option value="PACKAGING">Bao bì / Vỏ hộp / Ống / Tem (PACKAGING)</option>
              </select>
            </Field>
            <Field label="ĐVT & Bảo quản">
              <div className="flex gap-1">
                <input
                  className={`${inputClass} w-20 font-mono`}
                  value={quickItemForm.base_uom}
                  onChange={(e) => setQuickItemForm({ ...quickItemForm, base_uom: e.target.value })}
                  placeholder="KIT"
                  required
                />
                <input
                  className={inputClass}
                  value={quickItemForm.storage_temp}
                  onChange={(e) => setQuickItemForm({ ...quickItemForm, storage_temp: e.target.value })}
                  placeholder="-20°C"
                />
              </div>
            </Field>
            <Button type="submit">Lưu Mã Mới</Button>
          </form>
        </Card>
      )}

      <ErrorNote error={error} />

      {subTab === "bom" ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <div className={`${bomDetail ? "lg:col-span-4" : "lg:col-span-12"} space-y-4`}>
            <Card
              title="Danh sách Định mức BOM (Thành phẩm & Bán thành phẩm)"
              actions={
                <Button onClick={() => setShowCreateBom((v) => !v)}>
                  {showCreateBom ? "Đóng form tạo BOM" : "+ Tạo phiên bản BOM mới"}
                </Button>
              }
            >
              {/* Phân chia rõ BOM Thành phẩm vs BOM Bán thành phẩm */}
              <div className="space-y-2 mb-3">
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setBomTypeTab("finished_good");
                      setBomPage(1);
                    }}
                    className={`px-2.5 py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                      bomTypeTab === "finished_good"
                        ? "bg-sky-600 text-white shadow"
                        : "text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span>📦 BOM Thành phẩm</span>
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/20">
                      {boms.filter((b) => (b.bom_type || (b.product_type === "SEMI_FINISHED" ? "semi_finished" : "finished_good")) === "finished_good").length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBomTypeTab("semi_finished");
                      setBomPage(1);
                    }}
                    className={`px-2.5 py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                      bomTypeTab === "semi_finished"
                        ? "bg-amber-600 text-white shadow"
                        : "text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span>🧪 BOM Bán thành phẩm</span>
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/20">
                      {boms.filter((b) => (b.bom_type || (b.product_type === "SEMI_FINISHED" ? "semi_finished" : "finished_good")) === "semi_finished").length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBomTypeTab("ALL");
                      setBomPage(1);
                    }}
                    className={`px-2.5 py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                      bomTypeTab === "ALL"
                        ? "bg-slate-700 text-white shadow"
                        : "text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span>Tất cả BOM ({boms.length})</span>
                  </button>
                </div>

                {/* Bộ lọc nhóm PCR Kit / Tách chiết & Khác */}
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="text-slate-500 font-semibold">Nhóm:</span>
                  {[
                    { k: "", label: "Tất cả nhóm" },
                    { k: "PCR Kit", label: "🧬 PCR Kit / MasterMix" },
                    { k: "Tách chiết / Khác", label: "🧪 Kit Tách chiết / Hệ đệm Buffer" },
                  ].map((cat) => (
                    <button
                      key={cat.k}
                      type="button"
                      onClick={() => {
                        setBomCategoryFilter(cat.k);
                        setBomPage(1);
                      }}
                      className={`px-2.5 py-1 rounded-full font-semibold border transition ${
                        bomCategoryFilter === cat.k
                          ? "bg-sky-500/20 border-sky-500 text-sky-300"
                          : "border-slate-700 text-slate-400 hover:border-slate-500"
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {showCreateBom && (
                <form onSubmit={handleCreateBom} className="mb-4 p-3.5 rounded-xl border border-sky-500/40 bg-slate-900/80 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <div>
                      <span className="text-xs font-bold text-sky-300 uppercase">
                        + Khởi tạo Định mức BOM mới ({bomForm.bom_type === "semi_finished" ? "Bán thành phẩm" : "Thành phẩm Kit"})
                      </span>
                      <div className="text-[11px] text-slate-400">
                        Cung cấp đầy đủ TCCS, Người phụ trách sản xuất &amp; QC mặc định để hệ thống tự động truy xuất và giao việc khi phát lệnh.
                      </div>
                    </div>
                    <Button type="button" variant="ghost" onClick={() => setShowCreateBom(false)}>
                      Hủy
                    </Button>
                  </div>

                  {/* Chọn loại BOM: Thành phẩm vs Bán thành phẩm & Nhóm sản phẩm */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Field label="Phân loại BOM *">
                      <select
                        className={inputClass}
                        value={bomForm.bom_type}
                        onChange={(e) => {
                          const nextType = e.target.value as "finished_good" | "semi_finished";
                          setBomForm({
                            ...bomForm,
                            bom_type: nextType,
                            specification: nextType === "semi_finished" ? "Lô chuẩn 100 mL" : "Hộp 50 test",
                            qc_retention_qty: nextType === "semi_finished" ? "0" : "1",
                          });
                        }}
                      >
                        <option value="finished_good">📦 BOM Thành phẩm (Finished Good — Kit hoàn chỉnh)</option>
                        <option value="semi_finished">🧪 BOM Bán thành phẩm (Semi-Finished — Mix / Buffer / Oligo)</option>
                      </select>
                    </Field>
                    <Field label="Nhóm công nghệ *">
                      <select
                        className={inputClass}
                        value={bomForm.bom_category}
                        onChange={(e) =>
                          setBomForm({
                            ...bomForm,
                            bom_category: e.target.value,
                            storage_condition: e.target.value === "PCR Kit" ? "-20°C ± 2°C" : "15°C...25°C",
                          })
                        }
                      >
                        <option value="PCR Kit">PCR Kit (Real-time PCR / MasterMix / Primer-Probe)</option>
                        <option value="Tách chiết / Khác">Tách chiết / Khác (Extraction Kit / Dung dịch đệm Buffer)</option>
                      </select>
                    </Field>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Field label="Phòng Sản xuất Kit">
                      <select
                        className={inputClass}
                        value={bomForm.org_unit_id}
                        onChange={(e) => setBomForm({ ...bomForm, org_unit_id: e.target.value })}
                        required
                      >
                        <option value="">-- Chọn đơn vị --</option>
                        {options.units.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.code} — {u.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Sản phẩm Kit / Bán thành phẩm *">
                      <select
                        className={inputClass}
                        value={bomForm.product_item_id}
                        onChange={(e) => {
                          const it = kitProducts.find((x) => x.id === e.target.value);
                          const code = it?.code || "";
                          const isSemi = it?.item_type === "SEMI_FINISHED" || /^(BTP|SFG|ST|MIX)/i.test(code);
                          const parentCode = code.toUpperCase().endsWith(".D.IC") ? code.slice(0, -5) : "";
                          setBomForm({
                            ...bomForm,
                            product_item_id: e.target.value,
                            bom_type: isSemi ? "semi_finished" : "finished_good",
                            parent_item_code: parentCode,
                            name: it ? `BOM chuẩn ${it.name}` : bomForm.name,
                            tccs_code: isSemi ? `TCCS-BTP-${code}:2026/ABT` : `TCCS ${code.replace(/\.D\.IC$/i, "")}:2026/ABT`,
                          });
                        }}
                        required
                      >
                        <option value="">-- Chọn sản phẩm --</option>
                        {kitProducts.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.code} — {i.name} ({i.base_uom})
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div className="sm:col-span-2">
                      <Field label="Tên định mức BOM *">
                        <input
                          className={inputClass}
                          placeholder="VD: BOM Kit Real-time PCR HBV Định lượng (50 test)"
                          value={bomForm.name}
                          onChange={(e) => setBomForm({ ...bomForm, name: e.target.value })}
                          required
                        />
                      </Field>
                    </div>
                    <Field label="Mã SP chính (Gom nhóm COA/Nhãn)">
                      <input
                        className={`${inputClass} font-mono`}
                        placeholder="Tự nhận diện từ .D.IC"
                        value={bomForm.parent_item_code}
                        onChange={(e) => setBomForm({ ...bomForm, parent_item_code: e.target.value })}
                      />
                    </Field>
                  </div>

                  {bomForm.bom_type === "finished_good" && bomForm.bom_category === "PCR Kit" && (
                    <div className="p-2.5 rounded-lg bg-indigo-950/35 border border-indigo-700/50 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-indigo-300 uppercase">
                          🧬 Đặc thù riêng của Kit PCR: Hỗ trợ 4 Dạng Cung Cấp × 8 Mã Tube PCR (Chung 1 Mã Chính — Phân Biệt Qua Lot)
                        </span>
                        <span className="text-[10px] text-slate-300 font-mono">
                          Chỉ cần lập 1 BOM chung (BASE) hoặc tách BOM con (IC / C / C.IC)
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <Field label="Dạng cung cấp chuẩn ABT (Quy định Mix & Ống IC / Tube 1.5mL)">
                          <select
                            className={inputClass}
                            value={bomForm.supply_form}
                            onChange={(e) => {
                              const sfKey = e.target.value;
                              const sf = ABT_KIT_SUPPLY_FORMS[sfKey] || ABT_KIT_SUPPLY_FORMS.NO_SPLIT_NO_IC;
                              const nextVar =
                                sfKey === "SPLIT_WITH_IC"
                                  ? "C.IC"
                                  : sfKey === "SPLIT_NO_IC"
                                    ? "C"
                                    : sfKey === "NO_SPLIT_WITH_IC"
                                      ? "IC"
                                      : "BASE";
                              setBomForm({
                                ...bomForm,
                                supply_form: sfKey,
                                variant_code: nextVar,
                                tests_per_kit: String(sf.mix_tests_per_kit),
                                specification: sf.is_aliquoted
                                  ? `Hộp chia sẵn (${sf.mix_tests_per_kit} test Mix · ${sf.pcr_tubes_per_kit} tube PCR)`
                                  : `Hộp không chia sẵn (${sf.mix_tests_per_kit} test Mix · ${sf.pcr_tubes_per_kit} tube PCR)`,
                              });
                            }}
                          >
                            {Object.values(ABT_KIT_SUPPLY_FORMS).map((sf) => (
                              <option key={sf.key} value={sf.key}>
                                {sf.label} — ({sf.mix_tests_per_kit} test Mix + {sf.pcr_tubes_per_kit} tube PCR)
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Mã công thức (Mặc định BASE = Dùng chung cho cả 4 dạng)">
                          <input
                            className={`${inputClass} font-mono font-bold`}
                            placeholder="BASE (hoặc IC, C, C.IC nếu tách riêng)"
                            value={bomForm.variant_code}
                            onChange={(e) => setBomForm({ ...bomForm, variant_code: e.target.value.toUpperCase() })}
                          />
                        </Field>
                      </div>
                    </div>
                  )}
                  {bomForm.bom_type === "finished_good" && bomForm.bom_category !== "PCR Kit" && (
                    <div className="p-2.5 rounded-lg bg-slate-800/80 border border-slate-700 text-[11px] text-slate-300">
                      🧪 <b>Nhóm Kit Tách chiết / Hệ đệm Buffer / Khác</b>: Không áp dụng quy tắc chia sẵn 64/75 test hay 80/64 tube PCR trên Số Lô. Hệ thống nổ BOM theo định mức chuẩn và hỗ trợ chế độ <b>Kit Demo</b> (giảm hóa chất theo tỉ lệ, giữ nguyên chai chứa).
                    </div>
                  )}

                  {/* Thông tin Truy xuất tự động & Giao việc tự động */}
                  <div className="p-2.5 rounded-lg bg-sky-950/30 border border-sky-800/50 space-y-2">
                    <div className="text-[11px] font-bold text-sky-300 uppercase">
                      🔍 Thông tin Phục vụ Truy xuất Tự động (TCCS · ĐKLH · Giao việc Nhân sự Sản xuất &amp; QC)
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <Field label="Số Tiêu chuẩn cơ sở (TCCS — Tự động in COA)">
                        <input
                          className={`${inputClass} font-mono`}
                          placeholder="VD: TCCS 01:2026/ABT"
                          value={bomForm.tccs_code}
                          onChange={(e) => setBomForm({ ...bomForm, tccs_code: e.target.value })}
                        />
                      </Field>
                      <Field label="Số Đăng ký lưu hành (ĐKLH Bộ Y Tế)">
                        <input
                          className={`${inputClass} font-mono`}
                          placeholder="VD: 2400189/ĐKLH-BYT-TB-CT"
                          value={bomForm.registration_no}
                          onChange={(e) => setBomForm({ ...bomForm, registration_no: e.target.value })}
                        />
                      </Field>
                      <Field label="👤 Người phụ trách SX (Tự động giao khi tạo lệnh)">
                        <select
                          className={inputClass}
                          value={bomForm.responsible_person_name}
                          onChange={(e) => setBomForm({ ...bomForm, responsible_person_name: e.target.value })}
                        >
                          {kitStaffList.map((s) => (
                            <option key={s.user_id} value={s.display_name}>
                              {s.display_name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="🛡️ Người phụ trách QC mặc định (Tự động gán IPQC/FQC)">
                        <select
                          className={inputClass}
                          value={bomForm.qc_assignee_name}
                          onChange={(e) => setBomForm({ ...bomForm, qc_assignee_name: e.target.value })}
                        >
                          {qaStaffList.map((s) => (
                            <option key={s.user_id} value={s.display_name}>
                              {s.display_name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Quy cách đóng gói (Hiển thị trên Nhãn & COA)">
                        <input
                          className={inputClass}
                          placeholder="VD: Hộp 50 test / Chai 100 mL"
                          value={bomForm.specification}
                          onChange={(e) => setBomForm({ ...bomForm, specification: e.target.value })}
                        />
                      </Field>
                      <Field label="Điều kiện bảo quản chuẩn">
                        <input
                          className={inputClass}
                          placeholder="VD: -20°C ± 2°C hoặc 15°C...25°C"
                          value={bomForm.storage_condition}
                          onChange={(e) => setBomForm({ ...bomForm, storage_condition: e.target.value })}
                        />
                      </Field>
                      <div className="sm:col-span-2">
                        <Field label="⚙️ Quy trình công đoạn sản xuất áp dụng (Routing dùng chung cho nhiều BOM)">
                          <select
                            className={inputClass}
                            value={bomForm.routing_id}
                            onChange={(e) => setBomForm({ ...bomForm, routing_id: e.target.value })}
                          >
                            <option value="">-- Tự động gán theo phân loại BOM (Chuẩn ABT) --</option>
                            {routings
                              .filter((r) => r.status !== "OBSOLETE")
                              .map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.code} — {r.name} ({r.step_count ?? 0} bước · {r.routing_category || "Dùng chung"})
                                </option>
                              ))}
                          </select>
                        </Field>
                      </div>
                    </div>

                    {bomForm.bom_type === "semi_finished" ? (
                      <div className="grid grid-cols-3 gap-2 pt-1">
                        <Field label="pH Tiêu chuẩn Min">
                          <input
                            type="number"
                            step="0.01"
                            className={inputClass}
                            placeholder="VD: 8.10"
                            value={bomForm.ph_min}
                            onChange={(e) => setBomForm({ ...bomForm, ph_min: e.target.value })}
                          />
                        </Field>
                        <Field label="pH Tiêu chuẩn Max">
                          <input
                            type="number"
                            step="0.01"
                            className={inputClass}
                            placeholder="VD: 8.50"
                            value={bomForm.ph_max}
                            onChange={(e) => setBomForm({ ...bomForm, ph_max: e.target.value })}
                          />
                        </Field>
                        <Field label="Hạn dùng (tháng)">
                          <input
                            type="number"
                            className={inputClass}
                            value={bomForm.shelf_life_months}
                            onChange={(e) =>
                              setBomForm({
                                ...bomForm,
                                shelf_life_months: e.target.value,
                                shelf_life_days: String(Math.max(1, Number(e.target.value || 12)) * 30),
                              })
                            }
                          />
                        </Field>
                      </div>
                    ) : (
                      <div className="grid grid-cols-4 gap-2 pt-1">
                        <Field label="Số test / bộ Kit">
                          <input
                            type="number"
                            className={inputClass}
                            value={bomForm.tests_per_kit}
                            onChange={(e) => setBomForm({ ...bomForm, tests_per_kit: e.target.value })}
                          />
                        </Field>
                        <Field label="Hạn dùng (tháng)">
                          <input
                            type="number"
                            className={inputClass}
                            value={bomForm.shelf_life_months}
                            onChange={(e) =>
                              setBomForm({
                                ...bomForm,
                                shelf_life_months: e.target.value,
                                shelf_life_days: String(Math.max(1, Number(e.target.value || 12)) * 30),
                              })
                            }
                          />
                        </Field>
                        <Field label="Mẫu lưu QC / lô">
                          <input
                            type="number"
                            min={0}
                            className={inputClass}
                            value={bomForm.qc_retention_qty}
                            onChange={(e) => setBomForm({ ...bomForm, qc_retention_qty: e.target.value })}
                          />
                        </Field>
                        <Field label="Sao chép từ BOM cũ">
                          <select
                            className={inputClass}
                            value={bomForm.clone_from_bom_id}
                            onChange={(e) => setBomForm({ ...bomForm, clone_from_bom_id: e.target.value })}
                          >
                            <option value="">-- Tạo trống --</option>
                            {boms.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.code} (v{b.bom_version})
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => setShowCreateBom(false)}>
                      Đóng
                    </Button>
                    <Button type="submit">Khởi tạo BOM (DRAFT)</Button>
                  </div>
                </form>
              )}

              <div className="flex flex-wrap items-center gap-2 mb-3">
                <input
                  className={`${inputClass} flex-1 min-w-[200px]`}
                  placeholder="Tìm mã BOM, tên công thức, mã SP, số TCCS, người phụ trách..."
                  value={bomSearch}
                  onChange={(e) => {
                    setBomSearch(e.target.value);
                    setBomPage(1);
                  }}
                />
                <select
                  className={`${inputClass} w-40`}
                  value={bomStatusFilter}
                  onChange={(e) => {
                    setBomStatusFilter(e.target.value);
                    setBomPage(1);
                  }}
                >
                  <option value="">Mọi trạng thái</option>
                  <option value="EFFECTIVE">Đang hiệu lực (EFFECTIVE)</option>
                  <option value="DRAFT">Bản nháp (DRAFT)</option>
                  <option value="PENDING_REVIEW">Chờ thẩm định (PENDING_REVIEW)</option>
                  <option value="OBSOLETE">Ngừng hiệu lực (OBSOLETE)</option>
                </select>
                <select
                  className={`${inputClass} w-28`}
                  value={bomPageSize}
                  onChange={(e) => {
                    setBomPageSize(Number(e.target.value) || 15);
                    setBomPage(1);
                  }}
                  title="Số dòng hiển thị trên mỗi trang"
                >
                  <option value={10}>10 dòng/trang</option>
                  <option value={15}>15 dòng/trang</option>
                  <option value={30}>30 dòng/trang</option>
                  <option value={50}>50 dòng/trang</option>
                  <option value={100}>100 dòng/trang</option>
                </select>
              </div>
              {(() => {
                const filteredBoms = boms.filter((b) => {
                  const bType = b.bom_type || (b.product_type === "SEMI_FINISHED" ? "semi_finished" : "finished_good");
                  if (bomTypeTab !== "ALL" && bType !== bomTypeTab) return false;
                  if (bomCategoryFilter && (b.bom_category || "PCR Kit") !== bomCategoryFilter) return false;
                  return true;
                });
                if (filteredBoms.length === 0) {
                  return (
                    <Empty>
                      Chưa có định mức BOM nào trong phân mục này. Nhấn &ldquo;+ Tạo phiên bản BOM mới&rdquo; ở góc phải trên để khởi tạo.
                    </Empty>
                  );
                }
                const totalPages = Math.max(1, Math.ceil(filteredBoms.length / bomPageSize));
                const safePage = Math.min(Math.max(1, bomPage), totalPages);
                const startIdx = (safePage - 1) * bomPageSize;
                const pagedBoms = filteredBoms.slice(startIdx, startIdx + bomPageSize);

                return (
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-300">
                      <div>
                        Hiển thị <b>{startIdx + 1}–{Math.min(startIdx + bomPageSize, filteredBoms.length)}</b> / <b>{filteredBoms.length}</b> công thức{" "}
                        <span className="text-slate-400">· Click vào dòng bất kỳ để xem chi tiết</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={safePage <= 1}
                          onClick={() => setBomPage(1)}
                          className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-semibold cursor-pointer"
                        >
                          « Đầu
                        </button>
                        <button
                          type="button"
                          disabled={safePage <= 1}
                          onClick={() => setBomPage((p) => Math.max(1, p - 1))}
                          className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-semibold cursor-pointer"
                        >
                          ‹ Trước
                        </button>
                        <span className="px-2 font-bold text-sky-700 dark:text-sky-300">
                          Trang {safePage} / {totalPages}
                        </span>
                        <button
                          type="button"
                          disabled={safePage >= totalPages}
                          onClick={() => setBomPage((p) => Math.min(totalPages, p + 1))}
                          className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-semibold cursor-pointer"
                        >
                          Sau ›
                        </button>
                        <button
                          type="button"
                          disabled={safePage >= totalPages}
                          onClick={() => setBomPage(totalPages)}
                          className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-semibold cursor-pointer"
                        >
                          Cuối »
                        </button>
                      </div>
                    </div>

                    <Table head={["Mã SP / BOM", "Tên sản phẩm & Quy cách", "Thao tác"]}>
                      {pagedBoms.map((b) => {
                        const isSemi = (b.bom_type || (b.product_type === "SEMI_FINISHED" ? "semi_finished" : "finished_good")) === "semi_finished";
                        const isSelected = selectedBomId === b.id;
                        const variantLabel = b.variant_code && b.variant_code !== "BASE" ? b.variant_code : null;
                        return (
                          <tr
                            key={b.id}
                            onClick={() => {
                              setSelectedBomId(b.id);
                              setTimeout(() => {
                                bomDetailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                              }, 80);
                            }}
                            className={`cursor-pointer transition-colors hover:bg-sky-500/10 ${
                              isSelected ? "bg-sky-500/15 ring-1 ring-inset ring-sky-500/40" : ""
                            }`}
                          >
                            <td className="px-2 py-2 text-xs whitespace-nowrap">
                              <div className="flex items-center gap-1">
                                <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{b.product_code}</span>
                                {variantLabel && (
                                  <span className="px-1 py-0.2 rounded bg-indigo-500/20 border border-indigo-400/40 text-indigo-300 font-mono text-[10px] font-bold">
                                    .{variantLabel}
                                  </span>
                                )}
                              </div>
                              <div className="font-mono text-[10px] text-sky-600 dark:text-sky-400">
                                {b.code} · v{b.bom_version}
                              </div>
                            </td>
                            <td className="px-2 py-2 text-xs max-w-[165px]">
                              <div className="font-semibold text-slate-800 dark:text-slate-100 truncate" title={b.name}>
                                {b.product_name || b.name}
                              </div>
                              <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                {b.specification || (isSemi ? `Lô ${b.base_qty ?? 1} ${b.base_uom ?? "mL"}` : `${b.tests_per_kit || 50} test`)}
                              </div>
                            </td>
                            <td className="px-2 py-2 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    setSelectedBomId(b.id);
                                    setCreatedOrderResult(null);
                                    setShowIssueOrder(true);
                                    setTimeout(() => {
                                      bomDetailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                                    }, 80);
                                  }}
                                  title="Phát hành Lệnh sản xuất trực tiếp từ BOM này"
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold bg-emerald-600 text-white hover:bg-emerald-500 transition shadow-sm cursor-pointer"
                                >
                                  🚀 Phát lệnh
                                </button>
                                <span
                                  className={`inline-flex items-center gap-1 px-1.5 py-1 rounded-lg text-[11px] font-bold border transition ${
                                    isSelected
                                      ? "bg-sky-600 text-white border-sky-500"
                                      : "bg-sky-500/10 text-sky-600 dark:text-sky-300 border-sky-500/30 hover:bg-sky-500/20"
                                  }`}
                                >
                                  {isSelected ? "Đang xem" : "Chi tiết →"}
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </Table>

                    {totalPages > 1 && (
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-slate-500 dark:text-slate-400">
                        <span>
                          Trang <b>{safePage}</b> / <b>{totalPages}</b> ({filteredBoms.length} công thức)
                        </span>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" disabled={safePage <= 1} onClick={() => setBomPage((p) => Math.max(1, p - 1))}>
                            ‹ Trang trước
                          </Button>
                          <Button variant="ghost" disabled={safePage >= totalPages} onClick={() => setBomPage((p) => Math.min(totalPages, p + 1))}>
                            Trang sau ›
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </Card>
          </div>

          {bomDetail && (
            <div ref={bomDetailRef} className="lg:col-span-8 space-y-4">
              <Card
                title={`${bomDetail.bom.code} (v${bomDetail.bom.bom_version}) — ${bomDetail.bom.product_code} ${bomDetail.bom.product_name}`}
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        (bomDetail.bom.bom_type || (bomDetail.bom.product_type === "SEMI_FINISHED" ? "semi_finished" : "finished_good")) === "semi_finished"
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                          : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      }`}
                    >
                      {(bomDetail.bom.bom_type || (bomDetail.bom.product_type === "SEMI_FINISHED" ? "semi_finished" : "finished_good")) === "semi_finished"
                        ? "🧪 BOM Bán thành phẩm"
                        : "📦 BOM Thành phẩm"}
                    </span>
                    <StatusBadge status={bomDetail.bom.status} />
                    <Button
                      onClick={() => {
                        setCreatedOrderResult(null);
                        setShowIssueOrder((v) => !v);
                      }}
                    >
                      {showIssueOrder ? "Đóng form Phát lệnh SX" : "🚀 Phát lệnh sản xuất từ BOM này"}
                    </Button>
                    <Button variant="ghost" onClick={() => setShowEditHeader((v) => !v)}>
                      {showEditHeader ? "Đóng sửa TT truy xuất" : "✏️ Sửa TT Truy xuất & Giao việc"}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setSelectedBomId("");
                        setBomDetail(null);
                      }}
                    >
                      Đóng chi tiết
                    </Button>
                  </div>
                }
              >
                {/* Bảng thông tin truy xuất tự động & giao việc tự động */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 p-3 rounded-xl bg-slate-900/70 border border-slate-800 text-xs mb-2.5">
                  <div>
                    <div className="text-[11px] text-slate-400">Số Tiêu chuẩn cơ sở (TCCS):</div>
                    <div className="font-mono font-bold text-sky-300">{bomDetail.bom.tccs_code || "TCCS 01:2026/ABT"}</div>
                    {bomDetail.bom.registration_no && (
                      <div className="text-[10px] text-slate-400 font-mono">ĐKLH: {bomDetail.bom.registration_no}</div>
                    )}
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">Người phụ trách SX (Giao lệnh tự động):</div>
                    <div className="font-bold text-emerald-300">
                      👤 {bomDetail.bom.responsible_person_name || "Chưa phân công"}
                    </div>
                    <div className="text-[10px] text-amber-300">
                      🛡️ QC: {bomDetail.bom.qc_assignee_name || "Chưa phân công"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">Quy cách &amp; Điều kiện bảo quản:</div>
                    <div className="font-semibold text-slate-100">
                      {bomDetail.bom.specification || `Hộp ${bomDetail.bom.tests_per_kit} test`}
                    </div>
                    <div className="text-[11px] text-sky-400 font-mono">
                      ❄️ {bomDetail.bom.storage_condition || "-20°C ± 2°C"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">Hạn dùng &amp; Kiểm soát lô:</div>
                    <div className="font-semibold text-slate-100">
                      ⏳ {bomDetail.bom.shelf_life_months || Math.round((bomDetail.bom.shelf_life_days || 365) / 30)} tháng ({bomDetail.bom.shelf_life_days} ngày)
                    </div>
                    {bomDetail.bom.bom_type === "semi_finished" && (bomDetail.bom.ph_min != null || bomDetail.bom.ph_max != null) ? (
                      <div className="text-[11px] text-amber-300 font-mono">
                        🧪 pH chuẩn: {bomDetail.bom.ph_min ?? "-"} – {bomDetail.bom.ph_max ?? "-"}
                      </div>
                    ) : (
                      <div className="text-[11px] text-emerald-300">
                        📦 Mẫu lưu QC mặc định: +{bomDetail.bom.qc_retention_qty ?? 1} bộ/lô
                      </div>
                    )}
                  </div>
                </div>

                {/* Khối chọn Quy trình công đoạn sản xuất (Routing dùng chung) ngay trong từng công thức BOM */}
                <div className="p-2.5 rounded-xl bg-sky-950/35 border border-sky-800/50 flex flex-wrap items-center justify-between gap-2 text-xs mb-3">
                  <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
                    <span className="font-bold text-sky-300 whitespace-nowrap">
                      ⚙️ Quy trình sản xuất áp dụng (Routing):
                    </span>
                    <select
                      className={`${inputClass} py-1 text-xs flex-1 min-w-[240px] font-semibold`}
                      value={bomDetail.bom.routing_id || ""}
                      onChange={(e) => handleQuickAssignRouting(e.target.value)}
                    >
                      <option value="">-- Chọn quy trình công đoạn sản xuất dùng chung --</option>
                      {routings
                        .filter((r) => r.status !== "OBSOLETE" || r.id === bomDetail.bom.routing_id)
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.code} — {r.name} ({r.step_count ?? 0} bước · Đang dùng cho {r.linked_bom_count ?? 0} BOM)
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {bomDetail.bom.routing_id && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRoutingId(bomDetail.bom.routing_id);
                          setShowCreateRouting(false);
                          setSubTab("routing");
                        }}
                        className="px-2.5 py-1 rounded-lg bg-sky-600/25 hover:bg-sky-600/40 border border-sky-500/40 text-sky-200 font-bold text-[11px] cursor-pointer transition"
                      >
                        🔗 Xem {bomDetail.bom.routing_step_count ?? ""} bước công đoạn ({bomDetail.bom.routing_code})
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreateRouting(true);
                        setSubTab("routing");
                      }}
                      className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-[11px] cursor-pointer transition"
                    >
                      + Tạo quy trình mới
                    </button>
                  </div>
                </div>

                {createdOrderResult && (
                  <div className="mb-3 p-3.5 rounded-xl border border-emerald-500/50 bg-emerald-950/40 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-emerald-100 space-y-0.5">
                      <div className="font-bold text-emerald-300 text-sm">
                        ✅ Đã phát hành Lệnh sản xuất <span className="font-mono underline">{createdOrderResult.code}</span> thành công!
                      </div>
                      <div>
                        Sản phẩm: <b>{bomDetail.bom.product_code}</b> · Số Lô (Lot):{" "}
                        <span className="font-mono font-bold text-amber-300">{createdOrderResult.lot_code || "Đã cấp"}</span> · Số lượng:{" "}
                        <b>{createdOrderResult.planned_qty} {createdOrderResult.uom || bomDetail.bom.base_uom}</b>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {onJumpToOrder && (
                        <Button onClick={() => onJumpToOrder(createdOrderResult.id)}>
                          📋 Mở thực thi Lệnh SX &amp; Hồ sơ lô EBR ({createdOrderResult.code}) →
                        </Button>
                      )}
                      <Button variant="ghost" onClick={() => setCreatedOrderResult(null)}>
                        Đóng thông báo
                      </Button>
                    </div>
                  </div>
                )}

                {showIssueOrder && (() => {
                  const isSemi =
                    (bomDetail.bom.bom_type || (bomDetail.bom.product_type === "SEMI_FINISHED" ? "semi_finished" : "finished_good")) ===
                    "semi_finished";
                  const isPcrCat = !isSemi && (bomDetail.bom.bom_category ?? "PCR Kit") === "PCR Kit";
                  const matchingPoLines = (options.po_lines ?? []).filter(
                    (p) => p.item_id === bomDetail.bom.product_item_id || p.item_code === bomDetail.bom.product_code
                  );
                  return (
                    <form
                      onSubmit={handleIssueOrderFromBom}
                      className="mb-3 p-4 rounded-xl border-2 border-emerald-500/60 bg-slate-900/95 space-y-3 shadow-lg"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                        <div>
                          <div className="text-xs font-bold text-emerald-300 uppercase">
                            🚀 Phát hành Lệnh Sản Xuất &amp; Khởi tạo Hồ sơ lô Điện tử (EBR) trực tiếp từ BOM
                          </div>
                          <div className="text-[11px] text-slate-400">
                            Áp dụng công thức <b className="text-white font-mono">{bomDetail.bom.code} (v{bomDetail.bom.bom_version})</b> cho{" "}
                            <b className="text-sky-300">{bomDetail.bom.product_code} — {bomDetail.bom.product_name}</b> ({bomDetail.lines.length} thành phần BOM).
                            Hệ thống tự động nổ định mức nguyên liệu và sinh các bước công đoạn EBR.
                          </div>
                        </div>
                        <Button type="button" variant="ghost" onClick={() => setShowIssueOrder(false)}>
                          Đóng
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
                        <div className="md:col-span-2">
                          <Field label="Đơn hàng PO / Yêu cầu SX Nội bộ (Tùy chọn)">
                            <select
                              className={inputClass}
                              value={issueOrderForm.internal_order_line_id}
                              onChange={(e) => {
                                const lineId = e.target.value;
                                const po = (options.po_lines ?? []).find((x) => x.line_id === lineId);
                                if (!po) {
                                  setIssueOrderForm((prev) => ({ ...prev, internal_order_line_id: "" }));
                                  return;
                                }
                                const remQty = Math.max(1, Number(po.qty_ordered || 10) - Number(po.qty_delivered || 0));
                                const nextSf = po.supply_form || issueOrderForm.supply_form;
                                const nextTube = po.tube_code || issueOrderForm.tube_code || "T02";
                                const nextLot = isPcrCat
                                  ? buildAbtKitLotCode({
                                      mfgDate: issueOrderForm.mfg_date || vnToday(),
                                      seqNo: 1,
                                      supplyForm: nextSf,
                                      tubeCode: nextTube,
                                    })
                                  : issueOrderForm.lot_code;
                                setIssueOrderForm((prev) => ({
                                  ...prev,
                                  internal_order_line_id: lineId,
                                  planned_qty: String(remQty),
                                  supply_form: nextSf,
                                  tube_code: nextTube,
                                  lot_code: nextLot,
                                  notes: `Sản xuất theo PO ${po.kd_po_code} (Đơn nội bộ ${po.internal_order_code}) từ ${bomDetail.bom.code}`,
                                }));
                              }}
                            >
                              <option value="">
                                -- Sản xuất Chủ động / Bù tồn kho / Pha Bán thành phẩm (Không gắn PO) --
                              </option>
                              {matchingPoLines.map((p) => (
                                <option key={p.line_id} value={p.line_id}>
                                  [Khớp SP] PO: {p.kd_po_code} ({p.internal_order_code}) — SL: {p.qty_ordered} {p.uom}
                                </option>
                              ))}
                              {(options.po_lines ?? [])
                                .filter((p) => !matchingPoLines.some((m) => m.line_id === p.line_id))
                                .map((p) => (
                                  <option key={p.line_id} value={p.line_id}>
                                    PO: {p.kd_po_code} — {p.item_code} ({p.qty_ordered} {p.uom})
                                  </option>
                                ))}
                            </select>
                          </Field>
                        </div>

                        <Field label={`Số lượng sản xuất (${bomDetail.bom.base_uom || (isSemi ? "lô/mL" : "bộ/hộp")}) *`}>
                          <input
                            type="number"
                            min={0.01}
                            step="any"
                            className={`${inputClass} font-mono font-bold`}
                            value={issueOrderForm.planned_qty}
                            onChange={(e) => setIssueOrderForm({ ...issueOrderForm, planned_qty: e.target.value })}
                            required
                          />
                        </Field>

                        <Field label="Kho xuất NVL &amp; Nhập thành phẩm *">
                          <select
                            className={inputClass}
                            value={issueOrderForm.warehouse_id}
                            onChange={(e) => setIssueOrderForm({ ...issueOrderForm, warehouse_id: e.target.value })}
                            required
                          >
                            {options.warehouses.map((w) => (
                              <option key={w.id} value={w.id}>
                                {w.code} — {w.name}
                              </option>
                            ))}
                          </select>
                        </Field>

                        {isPcrCat && (
                          <>
                            <div className="md:col-span-2">
                              <Field label="Dạng cung cấp Kit PCR (4 dạng chuẩn ABT)">
                                <select
                                  className={inputClass}
                                  value={issueOrderForm.supply_form}
                                  onChange={(e) => {
                                    const nextSf = e.target.value;
                                    const nextLot = buildAbtKitLotCode({
                                      baseLot: issueOrderForm.lot_code,
                                      mfgDate: issueOrderForm.mfg_date || vnToday(),
                                      seqNo: 1,
                                      supplyForm: nextSf,
                                      tubeCode: issueOrderForm.tube_code,
                                    });
                                    setIssueOrderForm({ ...issueOrderForm, supply_form: nextSf, lot_code: nextLot });
                                  }}
                                >
                                  {Object.values(ABT_KIT_SUPPLY_FORMS).map((sf) => (
                                    <option key={sf.key} value={sf.key}>
                                      {sf.label}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                            </div>

                            <div className="md:col-span-2">
                              <Field label="Loại Tube / Strip PCR đi kèm (8 mã chuẩn)">
                                <select
                                  className={inputClass}
                                  value={issueOrderForm.tube_code}
                                  onChange={(e) => {
                                    const nextTube = e.target.value;
                                    const nextLot = buildAbtKitLotCode({
                                      baseLot: issueOrderForm.lot_code,
                                      mfgDate: issueOrderForm.mfg_date || vnToday(),
                                      seqNo: 1,
                                      supplyForm: issueOrderForm.supply_form,
                                      tubeCode: nextTube,
                                    });
                                    setIssueOrderForm({ ...issueOrderForm, tube_code: nextTube, lot_code: nextLot });
                                  }}
                                >
                                  {ABT_TUBE_STRIP_CATALOG.map((t) => (
                                    <option key={t.code} value={t.code}>
                                      {t.code} — {t.name}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                            </div>
                          </>
                        )}

                        <Field label="Mã số Lô (Lot Code — Tự sinh hoặc nhập tay)">
                          <input
                            className={`${inputClass} font-mono font-bold`}
                            value={issueOrderForm.lot_code}
                            onChange={(e) => {
                              const typed = e.target.value;
                              const parsed = parseAbtKitLotCode(typed);
                              setIssueOrderForm((prev) => ({
                                ...prev,
                                lot_code: typed,
                                supply_form: isPcrCat && parsed.supplyForm ? parsed.supplyForm.key : prev.supply_form,
                                tube_code: isPcrCat && parsed.tubeSpec ? parsed.tubeSpec.code : prev.tube_code,
                              }));
                            }}
                            placeholder={isPcrCat ? "VD: 011126-1.IC.T02" : `VD: LOT-${bomDetail.bom.product_code}-01`}
                          />
                        </Field>

                        <Field label="Ngày sản xuất (NSX)">
                          <input
                            type="date"
                            className={inputClass}
                            value={issueOrderForm.mfg_date}
                            onChange={(e) => {
                              const nextDate = e.target.value;
                              const nextLot = isPcrCat
                                ? buildAbtKitLotCode({
                                    mfgDate: nextDate || vnToday(),
                                    seqNo: 1,
                                    supplyForm: issueOrderForm.supply_form,
                                    tubeCode: issueOrderForm.tube_code,
                                  })
                                : issueOrderForm.lot_code;
                              setIssueOrderForm({ ...issueOrderForm, mfg_date: nextDate, lot_code: nextLot });
                            }}
                          />
                        </Field>

                        <Field label="Mẫu lưu QC bổ sung (Bộ/Lô)">
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              step="any"
                              disabled={issueOrderForm.no_retention}
                              className={`${inputClass} w-20 font-mono`}
                              value={issueOrderForm.no_retention ? "0" : issueOrderForm.qc_retention_qty}
                              onChange={(e) => setIssueOrderForm({ ...issueOrderForm, qc_retention_qty: e.target.value })}
                            />
                            <label className="flex items-center gap-1 text-[11px] text-slate-300 whitespace-nowrap cursor-pointer">
                              <input
                                type="checkbox"
                                checked={issueOrderForm.no_retention}
                                onChange={(e) => setIssueOrderForm({ ...issueOrderForm, no_retention: e.target.checked })}
                              />
                              Không lưu mẫu
                            </label>
                          </div>
                        </Field>

                        <Field label="Mức độ ưu tiên">
                          <select
                            className={inputClass}
                            value={issueOrderForm.priority}
                            onChange={(e) =>
                              setIssueOrderForm({
                                ...issueOrderForm,
                                priority: e.target.value as "LOW" | "NORMAL" | "HIGH" | "URGENT",
                              })
                            }
                          >
                            <option value="NORMAL">Bình thường (NORMAL)</option>
                            <option value="HIGH">Ưu tiên cao (HIGH)</option>
                            <option value="URGENT">Khẩn cấp (URGENT)</option>
                            <option value="LOW">Thấp (LOW)</option>
                          </select>
                        </Field>

                        <div className="md:col-span-4">
                          <Field label="Ghi chú Lệnh sản xuất">
                            <input
                              className={inputClass}
                              value={issueOrderForm.notes}
                              onChange={(e) => setIssueOrderForm({ ...issueOrderForm, notes: e.target.value })}
                              placeholder="Ghi chú cho tổ sản xuất Kit / Pha chế Bán thành phẩm..."
                            />
                          </Field>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800">
                        <div className="text-[11px] text-slate-400">
                          💡 Người phụ trách SX: <b className="text-emerald-300">{bomDetail.bom.responsible_person_name || "Tự động phân công"}</b> ·
                          QC: <b className="text-amber-300">{bomDetail.bom.qc_assignee_name || "Tự động phân công"}</b>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button type="button" variant="ghost" onClick={() => setShowIssueOrder(false)}>
                            Hủy
                          </Button>
                          <Button type="submit" disabled={issueOrderBusy}>
                            {issueOrderBusy ? "⏳ Đang phát hành Lệnh SX..." : "🚀 Xác nhận Phát hành Lệnh Sản Xuất & Khởi tạo EBR"}
                          </Button>
                        </div>
                      </div>
                    </form>
                  );
                })()}

                {showEditHeader && (
                  <form
                    onSubmit={handleSaveBomHeader}
                    className="mb-3 p-3.5 rounded-xl border border-sky-500/40 bg-slate-900/90 space-y-2.5"
                  >
                    <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                      <span className="text-xs font-bold text-sky-300 uppercase">
                        ✏️ Cập nhật Thông tin Truy xuất Tự động &amp; Phân công Nhân sự Mặc định
                      </span>
                      <Button type="button" variant="ghost" onClick={() => setShowEditHeader(false)}>
                        Đóng
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <Field label="Phân loại BOM">
                        <select
                          className={inputClass}
                          value={editHeaderForm.bom_type}
                          onChange={(e) =>
                            setEditHeaderForm({ ...editHeaderForm, bom_type: e.target.value as "finished_good" | "semi_finished" })
                          }
                        >
                          <option value="finished_good">📦 BOM Thành phẩm (Finished Good)</option>
                          <option value="semi_finished">🧪 BOM Bán thành phẩm (Semi-Finished)</option>
                        </select>
                      </Field>
                      <Field label="Nhóm sản phẩm">
                        <select
                          className={inputClass}
                          value={editHeaderForm.bom_category}
                          onChange={(e) => setEditHeaderForm({ ...editHeaderForm, bom_category: e.target.value })}
                        >
                          <option value="PCR Kit">PCR Kit</option>
                          <option value="Tách chiết / Khác">Tách chiết / Khác</option>
                        </select>
                      </Field>
                      <Field label="Mã SP chính (Gom nhóm COA / Nhãn)">
                        <input
                          className={`${inputClass} font-mono`}
                          value={editHeaderForm.parent_item_code}
                          onChange={(e) => setEditHeaderForm({ ...editHeaderForm, parent_item_code: e.target.value })}
                          placeholder="VD: KIT-HBV-50T"
                        />
                      </Field>
                      <Field label="Mã công thức con (Variant Code)">
                        <input
                          className={`${inputClass} font-mono font-bold`}
                          value={editHeaderForm.variant_code}
                          onChange={(e) => setEditHeaderForm({ ...editHeaderForm, variant_code: e.target.value.toUpperCase() })}
                          placeholder="BASE / IC / C / C.IC"
                        />
                      </Field>
                      <Field label="Dạng cung cấp chuẩn ABT">
                        <select
                          className={inputClass}
                          value={editHeaderForm.supply_form}
                          onChange={(e) => setEditHeaderForm({ ...editHeaderForm, supply_form: e.target.value })}
                        >
                          {Object.values(ABT_KIT_SUPPLY_FORMS).map((sf) => (
                            <option key={sf.key} value={sf.key}>
                              {sf.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Số Tiêu chuẩn cơ sở (TCCS)">
                        <input
                          className={`${inputClass} font-mono`}
                          value={editHeaderForm.tccs_code}
                          onChange={(e) => setEditHeaderForm({ ...editHeaderForm, tccs_code: e.target.value })}
                        />
                      </Field>
                      <Field label="Số ĐKLH / Lưu hành Bộ Y Tế">
                        <input
                          className={`${inputClass} font-mono`}
                          value={editHeaderForm.registration_no}
                          onChange={(e) => setEditHeaderForm({ ...editHeaderForm, registration_no: e.target.value })}
                        />
                      </Field>
                      <Field label="Quy cách đóng gói">
                        <input
                          className={inputClass}
                          value={editHeaderForm.specification}
                          onChange={(e) => setEditHeaderForm({ ...editHeaderForm, specification: e.target.value })}
                        />
                      </Field>
                      <Field label="👤 Người phụ trách SX mặc định">
                        <select
                          className={inputClass}
                          value={editHeaderForm.responsible_person_name}
                          onChange={(e) => setEditHeaderForm({ ...editHeaderForm, responsible_person_name: e.target.value })}
                        >
                          {kitStaffList.map((s) => (
                            <option key={s.user_id} value={s.display_name}>
                              {s.display_name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="🛡️ Người phụ trách QC mặc định">
                        <select
                          className={inputClass}
                          value={editHeaderForm.qc_assignee_name}
                          onChange={(e) => setEditHeaderForm({ ...editHeaderForm, qc_assignee_name: e.target.value })}
                        >
                          {qaStaffList.map((s) => (
                            <option key={s.user_id} value={s.display_name}>
                              {s.display_name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Điều kiện bảo quản">
                        <input
                          className={inputClass}
                          value={editHeaderForm.storage_condition}
                          onChange={(e) => setEditHeaderForm({ ...editHeaderForm, storage_condition: e.target.value })}
                        />
                      </Field>
                      <Field label="Hạn sử dụng (Tháng)">
                        <input
                          type="number"
                          className={inputClass}
                          value={editHeaderForm.shelf_life_months}
                          onChange={(e) =>
                            setEditHeaderForm({
                              ...editHeaderForm,
                              shelf_life_months: e.target.value,
                              shelf_life_days: String(Math.max(1, Number(e.target.value || 12)) * 30),
                            })
                          }
                        />
                      </Field>
                      <Field label="Mẫu lưu QC bổ sung (Bộ/Lô)">
                        <input
                          type="number"
                          min={0}
                          className={inputClass}
                          value={editHeaderForm.qc_retention_qty}
                          onChange={(e) => setEditHeaderForm({ ...editHeaderForm, qc_retention_qty: e.target.value })}
                        />
                      </Field>
                      <Field label="Khoảng pH chuẩn (Min – Max cho BTP)">
                        <div className="flex gap-1">
                          <input
                            type="number"
                            step="0.01"
                            placeholder="pH Min"
                            className={inputClass}
                            value={editHeaderForm.ph_min}
                            onChange={(e) => setEditHeaderForm({ ...editHeaderForm, ph_min: e.target.value })}
                          />
                          <input
                            type="number"
                            step="0.01"
                            placeholder="pH Max"
                            className={inputClass}
                            value={editHeaderForm.ph_max}
                            onChange={(e) => setEditHeaderForm({ ...editHeaderForm, ph_max: e.target.value })}
                          />
                        </div>
                      </Field>
                      <div className="md:col-span-2">
                        <Field label="⚙️ Quy trình công đoạn sản xuất áp dụng (Routing dùng chung)">
                          <select
                            className={inputClass}
                            value={editHeaderForm.routing_id}
                            onChange={(e) => setEditHeaderForm({ ...editHeaderForm, routing_id: e.target.value })}
                          >
                            <option value="">-- Chọn quy trình công đoạn sản xuất --</option>
                            {routings
                              .filter((r) => r.status !== "OBSOLETE" || r.id === editHeaderForm.routing_id)
                              .map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.code} — {r.name} ({r.step_count ?? 0} bước)
                                </option>
                              ))}
                          </select>
                        </Field>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <Button type="button" variant="ghost" onClick={() => setShowEditHeader(false)}>
                        Hủy
                      </Button>
                      <Button type="submit">💾 Lưu Thông tin Truy xuất &amp; Phân công</Button>
                    </div>
                  </form>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <ActionBar
                    endpoint={`/api/factory/kit/boms/${bomDetail.bom.id}/actions`}
                    version={bomDetail.bom.version}
                    actions={bomDetail.allowed_actions}
                    labels={ACTION_LABELS}
                    onDone={() => {
                      loadList();
                      loadBomDetail(bomDetail.bom.id);
                    }}
                  />
                  {bomDetail.bom.status !== "EFFECTIVE" && (
                    <Button variant="secondary" onClick={handleFastActivateBom}>
                      ✅ Kích hoạt Hiệu lực ngay (EFFECTIVE)
                    </Button>
                  )}
                </div>
              </Card>

                <Card
                  title={`1. Định mức nguyên liệu / Bán thành phẩm (${bomDetail.lines.length}/${bomDetail.total_lines ?? bomDetail.lines.length} dòng)`}
                  actions={
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        className={`${inputClass} w-44`}
                        placeholder="Lọc mã / tên nguyên liệu..."
                        value={lineSearch}
                        onChange={(e) => setLineSearch(e.target.value)}
                      />
                      <input
                        type="number"
                        className={`${inputClass} w-20`}
                        placeholder="Hộp #"
                        value={lineBoxFilter}
                        onChange={(e) => setLineBoxFilter(e.target.value)}
                      />
                      {bomDetail.bom.status !== "OBSOLETE" && (
                        <>
                          <Button
                            onClick={() => {
                              setEditingLineId(null);
                              setShowAddLine((v) => !v);
                            }}
                          >
                            {showAddLine && !editingLineId ? "Đóng form BOM" : "➕ Thêm dòng BOM"}
                          </Button>
                          <Button variant="ghost" onClick={() => setShowBulkPaste(!showBulkPaste)}>
                            {showBulkPaste ? "Đóng nhập hàng loạt" : "📋 Dán hàng loạt (Excel/TSV)"}
                          </Button>
                        </>
                      )}
                    </div>
                  }
                >
                  {showBulkPaste && bomDetail.bom.status !== "OBSOLETE" && (
                    <div className="mb-3 p-3 rounded-lg border border-amber-200 bg-amber-50/50 space-y-2">
                      <div className="text-xs font-semibold text-stone-800">
                        Nhập nhanh hàng trăm / hàng ngàn dòng nguyên vật liệu (mỗi dòng: <code>MÃ_VẬT_TƯ ; SỐ_LƯỢNG ; ĐVT ; HỘP_SỐ ; VAI_TRÒ ; %_HAO_HỤT</code>)
                      </div>
                      <textarea
                        rows={5}
                        className={`${inputClass} font-mono text-xs`}
                        placeholder={"ENZ-TAQ-01; 0.05; mL; 1; ENZYME; 2\nBUF-PCR-10X; 0.5; mL; 1; MASTER_MIX; 3"}
                        value={bulkLinesText}
                        onChange={(e) => setBulkLinesText(e.target.value)}
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          onClick={async () => {
                            if (!bulkLinesText.trim()) return;
                            setError(null);
                            try {
                              const byCode = new Map(options.items.map((i) => [i.code.toUpperCase(), i]));
                              const parsedLines = bulkLinesText
                                .split(/\r?\n/)
                                .map((l) => l.trim())
                                .filter(Boolean)
                                .map((raw) => {
                                  const [code, qty, uom, boxNo, role, scrap] = raw.split(/\t|;/).map((s) => s.trim());
                                  const it = byCode.get((code || "").toUpperCase());
                                  if (!it) throw new Error(`Không tìm thấy mã vật tư "${code}" trong danh mục.`);
                                  return {
                                    component_item_id: it.id,
                                    qty_per_base: Number(qty || 1),
                                    uom: uom || it.base_uom,
                                    box_no: Number(boxNo || 1),
                                    component_role: role || "REAGENT",
                                    scrap_pct: Number(scrap || 0),
                                    is_critical: true,
                                    is_bundled: false,
                                    allow_substitute: false,
                                  };
                                });
                              await api(`/api/factory/kit/boms/${selectedBomId}`, {
                                method: "POST",
                                json: { kind: "bulk_lines", lines: parsedLines },
                              });
                              setBulkLinesText("");
                              setShowBulkPaste(false);
                              await loadBomDetail(selectedBomId, lineSearch, lineBoxFilter);
                              await loadList();
                            } catch (err) {
                              setError(err);
                            }
                          }}
                        >
                          Lưu hàng loạt vào BOM
                        </Button>
                      </div>
                    </div>
                  )}

                  {bomDetail.bom.status !== "OBSOLETE" && showAddLine && (
                    <form onSubmit={handleAddBomLine} className="mb-4 p-3 rounded-xl border-2 border-sky-400/60 bg-sky-50/40 dark:bg-sky-950/20 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-bold text-sky-900 dark:text-sky-200">
                          {editingLineId
                            ? "✏️ Đang chỉnh sửa dòng thành phần BOM"
                            : "➕ Thêm thành phần mới vào BOM (Chuẩn ABT: Hỗ trợ Định mức thường, Chia sẵn .D.IC & Kit Demo)"}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            setEditingLineId(null);
                            setShowAddLine(false);
                          }}
                        >
                          Đóng
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                        <Field label="Vật tư / Hóa chất / Bán TP">
                          <select
                            className={inputClass}
                            value={lineForm.component_item_id}
                            onChange={(e) => {
                              const it = options.items.find((x) => x.id === e.target.value);
                              const isPack = it?.item_type === "PACKAGING";
                              setLineForm({
                                ...lineForm,
                                component_item_id: e.target.value,
                                uom: it?.base_uom ?? "",
                                component_role: isPack ? "PACKAGING" : lineForm.component_role,
                                is_mix_component: !isPack,
                                is_demo_fixed_component: isPack,
                                include_in_qc_retention: !isPack,
                              });
                            }}
                            required
                          >
                            <option value="">-- Chọn vật tư --</option>
                            {options.items.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.code} — {i.name} ({i.base_uom})
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Vai trò trong Kit">
                          <select
                            className={inputClass}
                            value={lineForm.component_role}
                            onChange={(e) => {
                              const isPack = e.target.value === "PACKAGING";
                              setLineForm({
                                ...lineForm,
                                component_role: e.target.value,
                                is_mix_component: !isPack,
                                is_demo_fixed_component: isPack,
                                include_in_qc_retention: !isPack,
                              });
                            }}
                          >
                            {Object.entries(ROLE_LABELS).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Định mức Thường & ĐVT">
                          <div className="flex gap-1">
                            <input
                              type="number"
                              step="any"
                              className={inputClass}
                              value={lineForm.qty_per_base}
                              onChange={(e) => setLineForm({ ...lineForm, qty_per_base: e.target.value })}
                              required
                            />
                            <input
                              className={`${inputClass} w-20`}
                              placeholder="ĐVT"
                              value={lineForm.uom}
                              onChange={(e) => setLineForm({ ...lineForm, uom: e.target.value })}
                              required
                            />
                          </div>
                        </Field>
                        <Field label="Định mức Chia sẵn (.D.IC)">
                          <input
                            type="number"
                            step="any"
                            className={inputClass}
                            placeholder="Để trống = giống thường"
                            value={lineForm.qty_per_base_aliquoted}
                            onChange={(e) => setLineForm({ ...lineForm, qty_per_base_aliquoted: e.target.value })}
                          />
                        </Field>
                        <Field label="Hộp số & % Hao hụt">
                          <div className="flex gap-1">
                            <input
                              type="number"
                              className={inputClass}
                              value={lineForm.box_no}
                              onChange={(e) => setLineForm({ ...lineForm, box_no: e.target.value })}
                              title="Hộp số"
                            />
                            <input
                              type="number"
                              step="any"
                              className={inputClass}
                              value={lineForm.scrap_pct}
                              onChange={(e) => setLineForm({ ...lineForm, scrap_pct: e.target.value })}
                              title="% Hao hụt"
                            />
                          </div>
                        </Field>
                        <Field label="🫙 Đựng trong Vật chứa (Mã Ống/Chai trong BOM)">
                          <select
                            className={inputClass}
                            value={lineForm.bundle_parent_code}
                            onChange={(e) => setLineForm({ ...lineForm, bundle_parent_code: e.target.value })}
                          >
                            <option value="">-- Tự động ghép hoặc Không áp dụng --</option>
                            {bomDetail.lines
                              .filter((cand: any) => classifyBomLineForPackaging(cand).kind === "PRIMARY_CONTAINER")
                              .map((cand: any) => (
                                <option key={cand.id} value={cand.component_code}>
                                  {cand.component_code} — {cand.component_name} ({fmtQty(cand.qty_per_base)} {cand.uom})
                                </option>
                              ))}
                          </select>
                        </Field>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <div className="flex flex-wrap gap-3 text-xs text-stone-700 dark:text-stone-300">
                          <label className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={lineForm.is_demo_fixed_component}
                              onChange={(e) =>
                                setLineForm({
                                  ...lineForm,
                                  is_demo_fixed_component: e.target.checked,
                                  is_mix_component: !e.target.checked,
                                })
                              }
                            />
                            Cố định 1 bộ khi chạy Kit Demo (Vỏ hộp/Đế/Chai/Tem)
                          </label>
                          <label className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={lineForm.include_in_qc_retention}
                              onChange={(e) => setLineForm({ ...lineForm, include_in_qc_retention: e.target.checked })}
                            />
                            Cộng thêm cho Mẫu lưu QC
                          </label>
                          <label className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={lineForm.allow_substitute}
                              onChange={(e) => setLineForm({ ...lineForm, allow_substitute: e.target.checked })}
                            />
                            Cho phép mã thay thế
                          </label>
                          <label className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={lineForm.is_bundled}
                              onChange={(e) => setLineForm({ ...lineForm, is_bundled: e.target.checked })}
                            />
                            Vật tư bán kèm
                          </label>
                        </div>
                        <div className="flex gap-2">
                          {editingLineId && (
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => {
                                setEditingLineId(null);
                                setShowAddLine(false);
                              }}
                            >
                              Hủy sửa
                            </Button>
                          )}
                          <Button type="submit">{editingLineId ? "💾 Lưu cập nhật dòng BOM" : "➕ Thêm dòng BOM"}</Button>
                        </div>
                      </div>
                    </form>
                  )}

                  {bomDetail.lines.length === 0 ? (
                    <Empty>Chưa có dòng nguyên vật liệu nào trong BOM. Hãy bấm &ldquo;➕ Thêm dòng BOM&rdquo; ở góc phải bên trên.</Empty>
                  ) : (
                    <Table
                      head={[
                        "#",
                        "Hộp",
                        "Vai trò",
                        "Mã VT / Bán TP",
                        "Định mức",
                        "🫙 Đánh dấu Vật chứa & Loại Nhãn",
                        "Cấu hình Nổ BOM",
                        "Thao tác",
                      ]}
                    >
                      {(() => {
                        const containerLines = bomDetail.lines.filter(
                          (cand: any) => classifyBomLineForPackaging(cand).kind === "PRIMARY_CONTAINER"
                        );
                        return bomDetail.lines.map((l: any) => {
                          const lineClass = classifyBomLineForPackaging(l);
                          const pairedContainer =
                            lineClass.kind === "FILLABLE_SOLUTION" && l.bundle_parent_code
                              ? containerLines.find(
                                  (c: any) =>
                                    String(c.component_code || "").toUpperCase() ===
                                    String(l.bundle_parent_code || "").toUpperCase()
                                )
                              : null;
                          const heldSolutions =
                            lineClass.kind === "PRIMARY_CONTAINER"
                              ? bomDetail.lines.filter(
                                  (sol: any) =>
                                    classifyBomLineForPackaging(sol).kind === "FILLABLE_SOLUTION" &&
                                    String(sol.bundle_parent_code || "").toUpperCase() ===
                                      String(l.component_code || "").toUpperCase()
                                )
                              : [];
                          const pairedUnits = pairedContainer ? Math.max(1, Math.round(Number(pairedContainer.qty_per_base) || 1)) : 1;
                          const pairedFillPerUnit =
                            pairedContainer && pairedUnits > 0
                              ? Math.round((Number(l.qty_per_base || 0) / pairedUnits) * 1000) / 1000
                              : Number(l.qty_per_base || 0);

                          return (
                            <tr key={l.id} className={editingLineId === l.id ? "bg-sky-50/70 dark:bg-sky-950/30" : ""}>
                              <td className="px-2 py-2 text-xs w-7">{l.line_no}</td>
                              <td className="px-2 py-2 text-xs font-medium whitespace-nowrap w-12">Hộp {l.box_no}</td>
                              <td className="px-2 py-2 text-xs w-20">{ROLE_LABELS[l.component_role] ?? l.component_role}</td>
                              <td className="px-2 py-2 text-xs max-w-[175px]">
                                <span className="font-mono font-semibold">{l.component_code}</span> — {l.component_name}
                              </td>
                              <td className="px-2 py-2 text-xs font-semibold w-[72px] max-w-[80px] whitespace-nowrap">
                                <div>
                                  {fmtQty(l.qty_per_base)} {l.uom}
                                </div>
                                {Number(l.scrap_pct) > 0 && (
                                  <div className="text-[10px] font-normal text-stone-400">
                                    +{fmtQty(l.scrap_pct)}%
                                  </div>
                                )}
                                {l.qty_per_base_aliquoted != null && (
                                  <div className="text-[10px] text-sky-700 font-mono">
                                    .D.IC: {fmtQty(l.qty_per_base_aliquoted)} {l.uom}
                                  </div>
                                )}
                              </td>
                              <td className="px-2 py-2 text-xs">
                                {lineClass.kind === "FILLABLE_SOLUTION" ? (
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-1">
                                      <span className="text-[11px] font-semibold text-sky-700 dark:text-sky-300 whitespace-nowrap">
                                        🫙 Đựng trong:
                                      </span>
                                      <select
                                        className="rounded border border-sky-300 dark:border-sky-700 bg-white dark:bg-slate-900 px-1.5 py-0.5 text-[11px] font-medium text-slate-800 dark:text-slate-100 max-w-[205px]"
                                        value={l.bundle_parent_code || ""}
                                        disabled={bomDetail.bom.status === "OBSOLETE"}
                                        onChange={(e) => handleQuickPairContainer(l, e.target.value)}
                                        title="Chọn ống/chai rỗng trong BOM chứa dung dịch này (Hệ thống sẽ tự động chia thể tích & cập nhật số nhãn cần in)"
                                      >
                                        <option value="">-- Tự ghép theo dung tích --</option>
                                        {containerLines.map((c: any) => {
                                          const cUnits = Math.max(1, Math.round(Number(c.qty_per_base) || 1));
                                          const fillEach =
                                            cUnits > 0
                                              ? Math.round((Number(l.qty_per_base || 0) / cUnits) * 1000) / 1000
                                              : Number(l.qty_per_base || 0);
                                          return (
                                            <option key={c.id} value={c.component_code}>
                                              {c.component_code} ({cUnits} ống × {fmtQty(fillEach)} {l.uom}/ống)
                                            </option>
                                          );
                                        })}
                                      </select>
                                    </div>
                                    {pairedContainer ? (
                                      <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-[10px] font-semibold">
                                        🏷️ Sinh {pairedUnits} nhãn giống nhau ({fmtQty(pairedFillPerUnit)} {l.uom}/ống)
                                      </div>
                                    ) : (
                                      <div className="text-[10px] text-slate-500">
                                        🏷️ Bấm &ldquo;⚡ Tự nạp quy cách&rdquo; hoặc chọn ống chứa ở trên
                                      </div>
                                    )}
                                  </div>
                                ) : lineClass.kind === "PRIMARY_CONTAINER" ? (
                                  <div className="space-y-0.5">
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-300 text-[11px] font-semibold">
                                      🫙 Vật chứa sơ cấp ({fmtQty(l.qty_per_base)} {l.uom})
                                    </span>
                                    <div className="text-[10px] text-slate-500">
                                      {heldSolutions.length > 0
                                        ? `Đang chứa: ${heldSolutions.map((s: any) => s.component_code).join(", ")} (Không tạo dòng ống thừa)`
                                        : "Ống/Chai rỗng dùng để chiết dung dịch trong BOM"}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-0.5">
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-[11px] font-semibold">
                                      📦 Vỏ hộp / Bao bì ngoài
                                    </span>
                                    <div className="text-[10px] text-slate-500">
                                      Sinh 01 Nhãn Hộp Ngoài sản phẩm
                                    </div>
                                  </div>
                                )}
                              </td>
                              <td className="px-2 py-2 text-[10px] text-stone-600 max-w-[165px]">
                                <div className="flex flex-wrap gap-1">
                                  <span className="px-1.5 py-0.5 rounded bg-stone-100 whitespace-nowrap">
                                    {l.is_bundled ? `Đi kèm (${l.bundle_parent_code || "ngoài"})` : "Trừ kho"}
                                  </span>
                                  {l.is_demo_fixed_component ? (
                                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 whitespace-nowrap">Demo: Cố định 1 bộ</span>
                                  ) : (
                                    <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 whitespace-nowrap">Demo: Co giãn</span>
                                  )}
                                  {l.include_in_qc_retention !== false && (
                                    <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 whitespace-nowrap">+Mẫu lưu QC</span>
                                  )}
                                  {l.allow_substitute && (
                                    <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 whitespace-nowrap">Cho thay thế</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 py-2 text-xs whitespace-nowrap">
                                {bomDetail.bom.status !== "OBSOLETE" && (
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => handleStartEditLine(l)}
                                      className="px-2 py-1 rounded-md text-[11px] font-bold bg-sky-600/15 text-sky-700 dark:text-sky-300 border border-sky-500/40 hover:bg-sky-600 hover:text-white transition"
                                    >
                                      ✏️ Sửa
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteBomLine(l.id)}
                                      className="px-2 py-1 rounded-md text-[11px] font-bold bg-rose-600/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 hover:bg-rose-600 hover:text-white transition"
                                    >
                                      🗑️ Xóa
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </Table>
                  )}

                  {bomDetail.lines.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-stone-200 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-stone-700">
                          Danh mục Vật tư thay thế của BOM ({(bomDetail.substitutes || []).length} quy tắc)
                        </div>
                        <Button variant="ghost" onClick={() => setShowAddSub((v) => !v)}>
                          {showAddSub ? "Đóng gắn VT thay thế" : "+ Gắn VT thay thế"}
                        </Button>
                      </div>
                      {(bomDetail.substitutes || []).length > 0 && (
                        <Table head={["Dòng BOM", "Vật tư thay thế", "Hệ số quy đổi", "Thứ tự ưu tiên", "Ghi chú"]}>
                          {(bomDetail.substitutes || []).map((s: any) => (
                            <tr key={s.id}>
                              <td className="px-3 py-1.5 text-xs font-mono">Dòng #{s.line_no}</td>
                              <td className="px-3 py-1.5 text-xs font-semibold">
                                {s.substitute_code} — {s.substitute_name} ({s.substitute_uom})
                              </td>
                              <td className="px-3 py-1.5 text-xs font-mono">x{fmtQty(s.conversion_factor)}</td>
                              <td className="px-3 py-1.5 text-xs">Ưu tiên #{s.priority}</td>
                              <td className="px-3 py-1.5 text-xs text-stone-500">{s.notes ?? "-"}</td>
                            </tr>
                          ))}
                        </Table>
                      )}
                      {showAddSub && (
                        <form onSubmit={handleAddSubstitute} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end pt-1">
                          <Field label="Chọn dòng BOM gốc">
                            <select
                              className={inputClass}
                              value={subForm.bom_line_id}
                              onChange={(e) => setSubForm({ ...subForm, bom_line_id: e.target.value })}
                              required
                            >
                              <option value="">-- Chọn dòng BOM --</option>
                              {bomDetail.lines.map((l: any) => (
                                <option key={l.id} value={l.id}>
                                  #{l.line_no} — {l.component_code} ({l.component_name})
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Vật tư thay thế khi hết tồn">
                            <select
                              className={inputClass}
                              value={subForm.substitute_item_id}
                              onChange={(e) => setSubForm({ ...subForm, substitute_item_id: e.target.value })}
                              required
                            >
                              <option value="">-- Chọn VT thay thế --</option>
                              {options.items.map((i) => (
                                <option key={i.id} value={i.id}>
                                  {i.code} — {i.name} ({i.base_uom})
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Hệ số quy đổi & Ưu tiên">
                            <div className="flex gap-1">
                              <input
                                type="number"
                                step="any"
                                className={inputClass}
                                value={subForm.conversion_factor}
                                onChange={(e) => setSubForm({ ...subForm, conversion_factor: e.target.value })}
                                title="Hệ số quy đổi"
                              />
                              <input
                                type="number"
                                className={`${inputClass} w-16`}
                                value={subForm.priority}
                                onChange={(e) => setSubForm({ ...subForm, priority: e.target.value })}
                                title="Thứ tự ưu tiên"
                              />
                            </div>
                          </Field>
                          <Field label="Ghi chú thay thế">
                            <input
                              className={inputClass}
                              placeholder="VD: Dùng thay thế tương đương"
                              value={subForm.notes}
                              onChange={(e) => setSubForm({ ...subForm, notes: e.target.value })}
                            />
                          </Field>
                          <Button type="submit">Lưu VT thay thế</Button>
                        </form>
                      )}
                    </div>
                  )}
                </Card>

                <Card
                  title={`2. Cấu trúc đóng gói Bộ Kit → Hộp → Ống/Chai (${bomDetail.packaging.length} quy cách)`}
                  actions={
                    bomDetail.bom.status !== "OBSOLETE" ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {bomDetail.lines.length > 0 && (
                          <Button variant="ghost" onClick={handleSyncPackaging}>
                            ⚡ Tự nạp quy cách đóng gói từ BOM
                          </Button>
                        )}
                        <Button
                          onClick={() => {
                            setEditingPackId(null);
                            setShowAddPack((v) => !v);
                          }}
                        >
                          {showAddPack && !editingPackId ? "Đóng form đóng gói" : "➕ Thêm quy cách đóng gói"}
                        </Button>
                      </div>
                    ) : null
                  }
                >
                  {bomDetail.bom.status !== "OBSOLETE" && showAddPack && (
                    <form onSubmit={handleAddPackaging} className="mb-4 p-3 rounded-xl border-2 border-sky-400/60 bg-sky-50/40 dark:bg-sky-950/20 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-bold text-sky-900 dark:text-sky-200">
                          {editingPackId
                            ? "✏️ Đang chỉnh sửa quy cách đóng gói Ống / Chai / Hộp"
                            : "➕ Khai báo bổ sung quy cách đóng gói Ống / Chai trong Hộp Kit"}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            setEditingPackId(null);
                            setShowAddPack(false);
                          }}
                        >
                          Đóng
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <Field label="Hộp số & Tên hộp">
                          <div className="flex gap-1">
                            <input
                              type="number"
                              className={`${inputClass} w-16`}
                              value={packForm.box_no}
                              onChange={(e) => setPackForm({ ...packForm, box_no: e.target.value })}
                            />
                            <input
                              className={inputClass}
                              value={packForm.box_name}
                              onChange={(e) => setPackForm({ ...packForm, box_name: e.target.value })}
                              required
                            />
                          </div>
                        </Field>
                        <Field label="Tên ống / lọ thành phần">
                          <input
                            className={inputClass}
                            value={packForm.component_name}
                            onChange={(e) => setPackForm({ ...packForm, component_name: e.target.value })}
                            required
                          />
                        </Field>
                        <Field label="Loại ống & Bảo quản">
                          <div className="flex gap-1">
                            <select
                              className={inputClass}
                              value={packForm.container_type}
                              onChange={(e) => setPackForm({ ...packForm, container_type: e.target.value })}
                            >
                              {Object.entries(CONTAINER_LABELS).map(([k, v]) => (
                                <option key={k} value={k}>
                                  {v}
                                </option>
                              ))}
                            </select>
                            <input
                              className={`${inputClass} w-20`}
                              value={packForm.storage_temp}
                              onChange={(e) => setPackForm({ ...packForm, storage_temp: e.target.value })}
                            />
                          </div>
                        </Field>
                      </div>
                      <div className="flex flex-wrap items-end justify-between gap-2">
                        <div className="flex flex-wrap gap-2">
                          <Field label="Lượng chiết rót / ống">
                            <input
                              type="number"
                              step="any"
                              className={`${inputClass} w-28`}
                              value={packForm.fill_qty}
                              onChange={(e) => setPackForm({ ...packForm, fill_qty: e.target.value })}
                              required
                            />
                          </Field>
                          <Field label="ĐVT chiết">
                            <input
                              className={`${inputClass} w-20`}
                              value={packForm.fill_uom}
                              onChange={(e) => setPackForm({ ...packForm, fill_uom: e.target.value })}
                              required
                            />
                          </Field>
                          <Field label="Số ống / bộ Kit">
                            <input
                              type="number"
                              className={`${inputClass} w-24`}
                              value={packForm.units_per_kit}
                              onChange={(e) => setPackForm({ ...packForm, units_per_kit: e.target.value })}
                              required
                            />
                          </Field>
                        </div>
                        <div className="flex gap-2">
                          {editingPackId && (
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => {
                                setEditingPackId(null);
                                setShowAddPack(false);
                              }}
                            >
                              Hủy sửa
                            </Button>
                          )}
                          <Button type="submit">{editingPackId ? "💾 Lưu cập nhật quy cách" : "➕ Lưu quy cách đóng gói"}</Button>
                        </div>
                      </div>
                    </form>
                  )}

                  {bomDetail.packaging.length === 0 ? (
                    <div className="py-5 text-center space-y-2.5">
                      <div className="text-xs text-stone-500">Chưa khai báo quy cách ống/hộp cho BOM này.</div>
                      {bomDetail.bom.status !== "OBSOLETE" && (
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          {bomDetail.lines.length > 0 && (
                            <Button onClick={handleSyncPackaging}>
                              ⚡ Tự nạp quy cách Ống/Chai từ danh sách BOM
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setEditingPackId(null);
                              setShowAddPack(true);
                            }}
                          >
                            ➕ Khai báo thủ công quy cách đóng gói
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <Table head={["Hộp", "Tên ống / thành phần", "Loại bao bì", "Thể tích nạp / ống", "Số ống & Số nhãn / Kit", "Bảo quản", "Thao tác"]}>
                      {bomDetail.packaging.map((pk: any) => (
                        <tr key={pk.id} className={editingPackId === pk.id ? "bg-sky-50/70 dark:bg-sky-950/30" : ""}>
                          <td className="px-3 py-2 text-xs font-medium">
                            Hộp {pk.box_no}: {pk.box_name}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            <div className="font-semibold">{pk.component_name}</div>
                            {pk.label_spec && (
                              <div className="text-[11px] text-sky-700 dark:text-sky-300 mt-0.5">
                                🫙 {pk.label_spec}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs">{CONTAINER_LABELS[pk.container_type] ?? pk.container_type}</td>
                          <td className="px-3 py-2 text-xs font-semibold">
                            {fmtQty(pk.fill_qty)} {pk.fill_uom} / ống
                          </td>
                          <td className="px-3 py-2 text-xs">
                            <div className="font-bold">{pk.units_per_kit} ống</div>
                            <div className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-[10px] font-semibold">
                              🏷️ {pk.units_per_kit} nhãn giống nhau
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs font-mono">{pk.storage_temp}</td>
                          <td className="px-3 py-2 text-xs whitespace-nowrap">
                            {bomDetail.bom.status !== "OBSOLETE" && (
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleStartEditPackaging(pk)}
                                  className="px-2 py-1 rounded-md text-[11px] font-bold bg-sky-600/15 text-sky-700 dark:text-sky-300 border border-sky-500/40 hover:bg-sky-600 hover:text-white transition"
                                >
                                  ✏️ Sửa
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeletePackaging(pk.id)}
                                  className="px-2 py-1 rounded-md text-[11px] font-bold bg-rose-600/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 hover:bg-rose-600 hover:text-white transition"
                                >
                                  🗑️ Xóa
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </Table>
                  )}
                </Card>

                {/* Thẻ 3: Thiết kế Mẫu Nhãn sản phẩm (Label Artwork) & Hướng dẫn sử dụng đính kèm (IFU) */}
                {(() => {
                  const isSemi = (bomDetail.bom.bom_type || (bomDetail.bom.product_type === "SEMI_FINISHED" ? "semi_finished" : "finished_good")) === "semi_finished";
                  const isPcrKit = !isSemi && (bomDetail.bom.bom_category || "PCR Kit") === "PCR Kit";
                  const hasPackaging = (bomDetail.packaging || []).length > 0;
                  const hasSavedCustomLabel = Boolean(
                    bomDetail.bom.label_design_json &&
                      typeof bomDetail.bom.label_design_json === "object" &&
                      Object.keys(bomDetail.bom.label_design_json).length > 0
                  );
                  const sampleData: LabelSampleData = {
                    productName: bomDetail.bom.product_name,
                    productCode: bomDetail.bom.product_code,
                    specification: bomDetail.bom.specification || (isSemi ? `Lô chuẩn ${bomDetail.bom.base_qty} ${bomDetail.bom.base_uom}` : `Hộp ${bomDetail.bom.tests_per_kit || 50} test`),
                    quantity: isSemi ? `${bomDetail.bom.base_qty} ${bomDetail.bom.base_uom}` : `${bomDetail.bom.tests_per_kit || 50} Tests`,
                    storage: bomDetail.bom.storage_condition || (isPcrKit ? "-20°C ± 2°C" : "15-25°C"),
                    mfgDate: "01/11/2026",
                    expDate: "01/11/2027",
                    lotNumber: `LOT-${String(bomDetail.bom.product_code || "KIT").replace(/[^A-Z0-9]/gi, "").slice(0, 6)}-2611`,
                    manufacturer: "CÔNG TY TNHH GIẢI PHÁP Y SINH ABT",
                    udiDi: labelIfuForm.udi_di || "(01)08936192830117",
                    phValue: bomDetail.bom.ph_min != null ? `${bomDetail.bom.ph_min} – ${bomDetail.bom.ph_max}` : "8.30 ± 0.1",
                    tccsCode: bomDetail.bom.tccs_code || "TCCS 01:2026/ABT",
                  };

                  const handleUploadIfuAttachment = (mode: "STANDARD" | "ALIQUOTED", file: File) => {
                    const reader = new FileReader();
                    reader.onload = async () => {
                      const dataUrl = String(reader.result || "");
                      const sizeStr = `${Math.max(1, Math.round(file.size / 1024))} KB (${file.name.split(".").pop()?.toUpperCase() || "FILE"})`;
                      const nextForm =
                        mode === "ALIQUOTED"
                          ? {
                              ...labelIfuForm,
                              ifu_aliquoted_file_name: file.name,
                              ifu_aliquoted_file_url: dataUrl,
                              ifu_aliquoted_file_size: sizeStr,
                            }
                          : {
                              ...labelIfuForm,
                              ifu_file_name: file.name,
                              ifu_file_url: dataUrl,
                              ifu_file_size: sizeStr,
                            };
                      setLabelIfuForm(nextForm);
                      try {
                        await api(`/api/factory/kit/boms/${selectedBomId}`, {
                          method: "POST",
                          json: {
                            kind: "label_ifu",
                            ...nextForm,
                            label_design_json: labelBundle,
                          },
                        });
                        await loadBomDetail(selectedBomId);
                      } catch (err) {
                        setError(err);
                      }
                    };
                    reader.readAsDataURL(file);
                  };

                  return (
                    <Card
                      title={
                        isSemi
                          ? `3. Thiết kế Mẫu Nhãn Bán Thành Phẩm (${labelIfuForm.label_template_code})`
                          : `3. Thiết kế Mẫu Nhãn Trực Quan (Visual Label Artwork) & Tài liệu HDSD Đính Kèm (IFU — ${bomDetail.bom.ifu_code ?? "IFU"})`
                      }
                      actions={
                        <div className="flex flex-wrap gap-1.5">
                          <Button variant="secondary" onClick={() => setShowLabelStudio((v) => !v)}>
                            {showLabelStudio ? "Đóng Studio Thiết kế Nhãn" : "🎨 Mở Studio Thiết Kế Nhãn Hiện Đại (Kéo thả & ISO/IVD)"}
                          </Button>
                          {!isSemi && (
                            <Button variant="ghost" onClick={() => setShowEditLabelIfu((v) => !v)}>
                              {showEditLabelIfu ? "Đóng cấu hình IFU" : "⚙️ Sửa thông số UDI / HDSD (IFU)"}
                            </Button>
                          )}
                        </div>
                      }
                    >
                      {/* PHẦN A: FILE ĐÍNH KÈM HƯỚNG DẪN SỬ DỤNG (IFU) — CHỈ HIỂN THỊ CHO THÀNH PHẨM KIT */}
                      {!isSemi && (
                        <div className="mb-4 p-3.5 rounded-xl border border-emerald-500/35 bg-emerald-950/15 space-y-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="text-xs font-extrabold text-emerald-300 uppercase">
                                📎 Tài Liệu Hướng Dẫn Sử Dụng Đính Kèm Theo BOM (Truy xuất tự động &amp; In ngay tại xưởng sản xuất)
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {isPcrKit
                                  ? "Khi tạo Lệnh sản xuất (Thường hoặc Chia sẵn .D.IC), hệ thống tự động lấy đúng file HDSD đính kèm dưới đây để nhân viên sản xuất xem và in đóng vào hộp Kit."
                                  : "Khi tạo Lệnh sản xuất, hệ thống tự động lấy file HDSD tiêu chuẩn đính kèm dưới đây để nhân viên sản xuất xem và in đóng vào hộp Kit."}
                              </div>
                            </div>
                          </div>

                          <div className={`grid grid-cols-1 ${isPcrKit ? "md:grid-cols-2" : ""} gap-3`}>
                            {/* File 1: HDSD Mặc định */}
                            <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 flex flex-col justify-between gap-2">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                                    📄 {isPcrKit ? "1. FILE HDSD TIÊU CHUẨN (MẶC ĐỊNH)" : "FILE HDSD TIÊU CHUẨN CỦA BỘ KIT"}
                                  </span>
                                  <div className="font-mono font-bold text-xs text-slate-100 mt-1">
                                    {labelIfuForm.ifu_file_name || `HDSD_${bomDetail.bom.product_code}_Rev01.pdf`}
                                  </div>
                                  <div className="text-[11px] text-slate-400">
                                    Mã: {labelIfuForm.ifu_code} · {labelIfuForm.ifu_version} · {labelIfuForm.ifu_file_size || "428 KB"}
                                  </div>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-800/80">
                                <Button variant="ghost" onClick={() => openAndPrintIfuFile("STANDARD", false)}>
                                  👁️ Xem file HDSD
                                </Button>
                                <Button variant="secondary" onClick={() => openAndPrintIfuFile("STANDARD", true)}>
                                  🖨️ In ngay HDSD
                                </Button>
                                <label className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-700 hover:border-sky-500 text-sky-300 cursor-pointer inline-flex items-center gap-1">
                                  📤 Đính kèm / Thay file (PDF/DOCX/Ảnh)
                                  <input
                                    type="file"
                                    accept=".pdf,.doc,.docx,image/*"
                                    style={{ display: "none" }}
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      if (f) handleUploadIfuAttachment("STANDARD", f);
                                    }}
                                  />
                                </label>
                              </div>
                            </div>

                            {/* File 2: HDSD Dạng chia sẵn (.D.IC) — Chỉ áp dụng cho Kit PCR */}
                            {isPcrKit && (
                              <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 flex flex-col justify-between gap-2">
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 text-[10px] font-bold">
                                      🧪 2. FILE HDSD DẠNG CHIA SẴN (.D.IC — ALIQUOTED)
                                    </span>
                                    <div className="font-mono font-bold text-xs text-slate-100 mt-1">
                                      {labelIfuForm.ifu_aliquoted_file_name || `HDSD_${bomDetail.bom.product_code}.D.IC_ChiaSan_Rev01.pdf`}
                                    </div>
                                    <div className="text-[11px] text-slate-400">
                                      Tự động kích hoạt khi PO đặt hàng Kit PCR dạng chia sẵn (.C / .C.IC) · {labelIfuForm.ifu_aliquoted_file_size || "452 KB"}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-800/80">
                                  <Button variant="ghost" onClick={() => openAndPrintIfuFile("ALIQUOTED", false)}>
                                    👁️ Xem file .D.IC
                                  </Button>
                                  <Button variant="secondary" onClick={() => openAndPrintIfuFile("ALIQUOTED", true)}>
                                    🖨️ In ngay .D.IC
                                  </Button>
                                  <label className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-700 hover:border-sky-500 text-sky-300 cursor-pointer inline-flex items-center gap-1">
                                    📤 Đính kèm file .D.IC
                                    <input
                                      type="file"
                                      accept=".pdf,.doc,.docx,image/*"
                                      style={{ display: "none" }}
                                      onChange={(e) => {
                                        const f = e.target.files?.[0];
                                        if (f) handleUploadIfuAttachment("ALIQUOTED", f);
                                      }}
                                    />
                                  </label>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* PHẦN B: HÌNH ẢNH MẪU NHÃN TRỰC QUAN (LIVE VISUAL ARTWORK PREVIEW) */}
                      <div className="p-3.5 rounded-xl border border-sky-500/35 bg-slate-900/80 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-xs font-extrabold text-sky-300 uppercase">
                              🏷️ Hình ảnh Mẫu Nhãn Sản Phẩm Trực Quan ({labelIfuForm.label_template_code}) — Chuẩn ISO 15223 / IVD / Barcode GS1
                            </div>
                            <div className="text-[11px] text-slate-400">
                              Mã UDI-DI: <span className="font-mono text-slate-200">{labelIfuForm.udi_di}</span> · Tự động điền LOT / NSX / HSD thực tế khi phát lệnh sản xuất.
                            </div>
                          </div>
                          <div className="flex gap-1.5">
                            {(isSemi || hasPackaging || hasSavedCustomLabel) && (
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  printElementHtml(
                                    labelPreviewRef.current,
                                    `Bộ Nhãn Sản Phẩm ${labelIfuForm.label_template_code || ""}`
                                  )
                                }
                              >
                                🖨️ In thử bộ nhãn
                              </Button>
                            )}
                            <Button variant="primary" onClick={() => setShowLabelStudio((v) => !v)}>
                              {showLabelStudio ? "Thu gọn Trình thiết kế" : "🎨 Tùy chỉnh / Kéo thả Thiết kế Nhãn"}
                            </Button>
                          </div>
                        </div>

                        {!isSemi && !hasPackaging && !hasSavedCustomLabel ? (
                          <div className="p-5 rounded-xl bg-slate-950/80 border border-dashed border-amber-500/40 text-center space-y-2.5">
                            <div className="text-xs font-bold text-amber-300">
                              📦 Chưa khởi tạo Cấu trúc đóng gói Bộ Kit (Hộp ➔ Ống/Chai thành phần) tại Mục 2
                            </div>
                            <div className="text-[11px] text-slate-400 max-w-2xl mx-auto">
                              Để tránh hiển thị nhãn mẫu không khớp với thực tế của bộ Kit, hệ thống chỉ sinh <b>Nhãn Hộp Ngoài</b> và <b>Nhãn từng Ống/Chai thành phần</b> sau khi bộ Kit đã có quy cách đóng gói tại Mục 2 (hoặc khi bạn thiết kế và lưu mẫu nhãn riêng).
                            </div>
                            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                              {bomDetail.lines.length > 0 && (
                                <Button onClick={handleSyncPackaging}>
                                  ⚡ Tự nạp Cấu trúc Bộ Kit từ BOM &amp; Sinh Bộ Nhãn Thực Tế
                                </Button>
                              )}
                              <Button variant="ghost" onClick={() => setShowLabelStudio(true)}>
                                🎨 Mở Trình Thiết Kế Nhãn Thủ Công
                              </Button>
                            </div>
                          </div>
                        ) : isSemi ? (
                          <div
                            ref={labelPreviewRef}
                            className="flex flex-col items-center justify-center gap-2 p-4 rounded-lg bg-slate-950/80 border border-slate-800 overflow-x-auto"
                          >
                            <div className="text-[11px] font-bold text-amber-300">
                              🧪 {labelBundle.outer_box.name} ({labelBundle.outer_box.width_mm}×{labelBundle.outer_box.height_mm} mm)
                            </div>
                            <VisualLabelCanvas
                              config={labelBundle.outer_box}
                              sample={sampleData}
                              scale={4.2}
                              interactive={false}
                            />
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            {/* Thanh tổng hợp số lượng nhãn thực tế cần in cho 01 Hộp Kit */}
                            <div className="p-2.5 rounded-lg bg-sky-950/60 border border-sky-500/40 flex flex-wrap items-center justify-between gap-2 text-xs">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-extrabold text-sky-300">📋 Định mức Nhãn cần in cho 01 Hộp Kit:</span>
                                <span className="px-2 py-0.5 rounded-md bg-sky-500/20 border border-sky-400/40 text-sky-200 font-bold">
                                  📦 01 Nhãn Hộp Ngoài
                                </span>
                                {(bomDetail.packaging || []).map((pk: any, pIdx: number) => (
                                  <span
                                    key={pk.id || pIdx}
                                    className="px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 font-bold"
                                  >
                                    🧪 {String(pk.units_per_kit || 1).padStart(2, "0")} Nhãn giống nhau cho {pk.component_name} ({fmtQty(pk.fill_qty)} {pk.fill_uom}/ống)
                                  </span>
                                ))}
                              </div>
                              <div className="text-[11px] text-slate-300 font-semibold">
                                Tổng cộng:{" "}
                                <span className="text-amber-300 font-extrabold">
                                  {1 +
                                    (bomDetail.packaging || []).reduce(
                                      (acc: number, pk: any) => acc + Math.max(1, Number(pk.units_per_kit || 1)),
                                      0
                                    )}{" "}
                                  tem nhãn / 01 Hộp Kit
                                </span>
                              </div>
                            </div>

                            <div
                              ref={labelPreviewRef}
                              className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start p-3 rounded-lg bg-slate-950/80 border border-slate-800 overflow-x-auto"
                            >
                              {/* Nhãn Hộp Ngoài */}
                              <div className="xl:col-span-6 flex flex-col items-center gap-2">
                                <div className="text-[11px] font-bold text-sky-300">
                                  📦 01 × {labelBundle.outer_box.name} ({labelBundle.outer_box.width_mm}×{labelBundle.outer_box.height_mm} mm)
                                </div>
                                <VisualLabelCanvas
                                  config={labelBundle.outer_box}
                                  sample={sampleData}
                                  scale={labelBundle.outer_box.width_mm >= 90 ? 3.5 : 4.2}
                                  interactive={false}
                                />
                              </div>

                              {/* Nhãn Ống / Chai Thành Phần Thực Tế (Hiển thị đúng số lượng nhãn giống nhau theo units_per_kit) */}
                              <div className="xl:col-span-6 flex flex-col items-center gap-2.5">
                                {(() => {
                                  const firstPkg = (bomDetail.packaging || [])[0];
                                  const firstUnits = Math.max(1, Number(firstPkg?.units_per_kit || labelBundle.tube.labels_per_row || 1));
                                  const renderFirstCount = Math.min(10, firstUnits);
                                  return (
                                    <div className="flex flex-col items-center gap-1.5 w-full">
                                      <div className="text-[11px] font-bold text-emerald-300 text-center">
                                        🧪 Thành phần #1 ({firstUnits} nhãn giống nhau): {labelBundle.tube.extra_text || labelBundle.tube.name} ({labelBundle.tube.width_mm}×{labelBundle.tube.height_mm} mm)
                                      </div>
                                      <div className="flex flex-wrap justify-center gap-2">
                                        {Array.from({ length: renderFirstCount }).map((_, idx) => (
                                          <div key={idx} className="flex flex-col items-center gap-0.5">
                                            <span className="text-[9px] font-mono text-emerald-400/90">
                                              Nhãn #{idx + 1}/{firstUnits}
                                            </span>
                                            <VisualLabelCanvas
                                              config={labelBundle.tube}
                                              sample={sampleData}
                                              scale={labelBundle.tube.width_mm <= 45 ? 3.8 : 3.0}
                                              interactive={false}
                                            />
                                          </div>
                                        ))}
                                      </div>
                                      {firstUnits > renderFirstCount && (
                                        <div className="text-[10px] text-emerald-300/80 italic">
                                          (+{firstUnits - renderFirstCount} nhãn giống hệt nữa khi in thực tế — tổng {firstUnits} nhãn/Kit)
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                                {(labelBundle.extra_components || []).map((ext, extIdx) => {
                                  const extPkg = (bomDetail.packaging || [])[extIdx + 1];
                                  const extUnits = Math.max(1, Number(extPkg?.units_per_kit || ext.labels_per_row || 1));
                                  const renderExtCount = Math.min(10, extUnits);
                                  return (
                                    <div key={`ext-prev-${extIdx}`} className="flex flex-col items-center gap-1.5 pt-2 border-t border-slate-800 w-full">
                                      <div className="text-[11px] font-bold text-teal-300 text-center">
                                        🧪 Thành phần #{extIdx + 2} ({extUnits} nhãn giống nhau): {ext.extra_text || ext.name} ({ext.width_mm}×{ext.height_mm} mm)
                                      </div>
                                      <div className="flex flex-wrap justify-center gap-2">
                                        {Array.from({ length: renderExtCount }).map((_, idx) => (
                                          <div key={idx} className="flex flex-col items-center gap-0.5">
                                            <span className="text-[9px] font-mono text-teal-400/90">
                                              Nhãn #{idx + 1}/{extUnits}
                                            </span>
                                            <VisualLabelCanvas
                                              config={ext}
                                              sample={sampleData}
                                              scale={ext.width_mm <= 45 ? 3.8 : 3.0}
                                              interactive={false}
                                            />
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })}
                                <div className="text-[10px] text-slate-400">
                                  Khổ cuộn in nhiệt: {labelBundle.tube.labels_per_row} tem/hàng (Khoảng cách ngang {labelBundle.tube.label_gap_mm}mm)
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* PHẦN C: STUDIO THIẾT KẾ NHÃN HIỆN ĐẠI (KÉO THẢ & 18 BIỂU TƯỢNG ISO/GHS) */}
                      {showLabelStudio && (
                        <KitLabelStudio
                          bundle={labelBundle}
                          sample={sampleData}
                          isSemiFinished={isSemi}
                          packagingItems={bomDetail.packaging || []}
                          bomLines={bomDetail.lines || []}
                          onChangeBundle={setLabelBundle}
                          onSave={() => handleSaveLabelIfu()}
                        />
                      )}

                      {/* PHẦN D: CẤU HÌNH MÃ NHÃN, UDI-DI & THÔNG SỐ KỸ THUẬT TRÍCH XUẤT LÊN COA/IFU */}
                      {showEditLabelIfu && (
                        <form
                          onSubmit={handleSaveLabelIfu}
                          className="mt-3 p-3.5 rounded-xl border border-sky-500/40 bg-slate-900/90 space-y-2.5"
                        >
                          <div className="text-xs font-bold text-sky-300 uppercase">
                            ⚙️ Cấu hình Mã Nhãn, Mã định danh UDI-DI (GS1) &amp; Thông số Chu kỳ nhiệt trích xuất tự động
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <Field label="Mã Mẫu Nhãn (Label Template Code)">
                              <input
                                className={`${inputClass} font-mono`}
                                value={labelIfuForm.label_template_code}
                                onChange={(e) => setLabelIfuForm({ ...labelIfuForm, label_template_code: e.target.value })}
                                required
                              />
                            </Field>
                            <Field label="Kích thước tem Hộp & Ống (mm)">
                              <input
                                className={inputClass}
                                value={labelIfuForm.label_dimensions}
                                onChange={(e) => setLabelIfuForm({ ...labelIfuForm, label_dimensions: e.target.value })}
                                required
                              />
                            </Field>
                            <Field label="Mã định danh UDI-DI (GS1)">
                              <input
                                className={`${inputClass} font-mono`}
                                value={labelIfuForm.udi_di}
                                onChange={(e) => setLabelIfuForm({ ...labelIfuForm, udi_di: e.target.value })}
                              />
                            </Field>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <Field label="Mã Tài liệu Hướng dẫn sử dụng (IFU Code)">
                              <input
                                className={`${inputClass} font-mono`}
                                value={labelIfuForm.ifu_code}
                                onChange={(e) => setLabelIfuForm({ ...labelIfuForm, ifu_code: e.target.value })}
                                required
                              />
                            </Field>
                            <Field label="Phiên bản HDSD (IFU Revision)">
                              <input
                                className={inputClass}
                                value={labelIfuForm.ifu_version}
                                onChange={(e) => setLabelIfuForm({ ...labelIfuForm, ifu_version: e.target.value })}
                                required
                              />
                            </Field>
                          </div>
                          <Field label="1. Mục đích sử dụng tóm tắt (Trích xuất lên Phụ lục HDSD & COA)">
                            <textarea
                              rows={2}
                              className={inputClass}
                              value={labelIfuForm.ifu_intended_use}
                              onChange={(e) => setLabelIfuForm({ ...labelIfuForm, ifu_intended_use: e.target.value })}
                            />
                          </Field>
                          <Field label="2. Chương trình Chu kỳ nhiệt Real-time PCR (Thermal Cycling Protocol)">
                            <textarea
                              rows={2}
                              className={inputClass}
                              value={labelIfuForm.ifu_thermal_profile}
                              onChange={(e) => setLabelIfuForm({ ...labelIfuForm, ifu_thermal_profile: e.target.value })}
                            />
                          </Field>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <Field label="3. Kênh màu Huỳnh quang (Fluorescence Channels)">
                              <input
                                className={inputClass}
                                value={labelIfuForm.ifu_channels}
                                onChange={(e) => setLabelIfuForm({ ...labelIfuForm, ifu_channels: e.target.value })}
                              />
                            </Field>
                            <Field label="4. Tiêu chuẩn Phiên giải Kết quả Ct (Result Interpretation)">
                              <input
                                className={inputClass}
                                value={labelIfuForm.ifu_interpretation}
                                onChange={(e) => setLabelIfuForm({ ...labelIfuForm, ifu_interpretation: e.target.value })}
                              />
                            </Field>
                          </div>
                          <div className="flex justify-end gap-2">
                            <Button type="button" variant="ghost" onClick={() => setShowEditLabelIfu(false)}>
                              Hủy
                            </Button>
                            <Button type="submit">💾 Lưu Cấu hình Nhãn &amp; HDSD (IFU)</Button>
                          </div>
                        </form>
                      )}
                    </Card>
                  );
                })()}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <div className={`${routingDetail && !showCreateRouting ? "lg:col-span-4" : "lg:col-span-12"} space-y-4`}>
            <Card
              title="Danh sách phiên bản Quy trình Công đoạn (Routing)"
              actions={
                <Button onClick={() => setShowCreateRouting((v) => !v)}>
                  {showCreateRouting ? "Đóng form tạo Routing" : "+ Tạo quy trình Routing nhiều bước"}
                </Button>
              }
            >
              {showCreateRouting && (
                <form
                  onSubmit={handleCreateRouting}
                  className="mb-4 p-4 rounded-xl border border-sky-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-900/70 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
                    <div>
                      <div className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                        🏗️ Thiết kế Quy trình Công đoạn Sản xuất Nhiều Bước (Multi-Step Routing Builder — ISO 13485 / GMP)
                      </div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-400">
                        Chọn mẫu quy trình chuẩn hoặc tự thêm không giới hạn số bước (Bước 10, 20, 30...), gắn nhãn chức năng công đoạn và cờ kiểm soát EBR cho từng bước ngay khi khởi tạo.
                      </div>
                    </div>
                    <Button type="button" variant="ghost" onClick={() => setShowCreateRouting(false)}>
                      Đóng
                    </Button>
                  </div>

                  {/* Thông tin chung của Routing (Quy trình dùng chung cho nhiều công thức BOM) */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Field label="Phòng Sản xuất Kit *">
                      <select
                        className={inputClass}
                        value={rtForm.org_unit_id}
                        onChange={(e) => setRtForm({ ...rtForm, org_unit_id: e.target.value })}
                        required
                      >
                        <option value="">-- Chọn đơn vị --</option>
                        {options.units.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.code} — {u.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Nhóm quy trình dùng chung (Áp dụng cho nhiều BOM) *">
                      <select
                        className={inputClass}
                        value={rtForm.routing_category}
                        onChange={(e) => {
                          const cat = e.target.value;
                          const suggestedTpl =
                            cat === "Bán thành phẩm (BTP)"
                              ? "SEMI_FINISHED_4_STEPS"
                              : cat === "Kit PCR Đông khô"
                                ? "LYO_6_STEPS"
                                : cat === "Tách chiết / Khác"
                                  ? "EXTRACTION_5_STEPS"
                                  : "PCR_5_STEPS";
                          const foundTpl = ROUTING_STANDARD_TEMPLATES.find((t) => t.key === suggestedTpl);
                          setRtTemplateKey(suggestedTpl);
                          if (foundTpl) {
                            setRtDraftSteps(JSON.parse(JSON.stringify(foundTpl.steps)));
                          }
                          setRtForm((p) => ({
                            ...p,
                            routing_category: cat,
                            name: foundTpl ? `${foundTpl.label.replace(/^[^\s]+\s+/, "")} (Dùng chung)` : p.name,
                          }));
                        }}
                      >
                        <option value="PCR Kit">🧬 Nhóm Kit Real-time PCR / RT-qPCR (Dùng chung)</option>
                        <option value="Kit PCR Đông khô">❄️ Nhóm Kit PCR Đông khô — Lyophilized (Dùng chung)</option>
                        <option value="Tách chiết / Khác">🧪 Nhóm Kit Tách chiết / Hệ đệm Buffer / Điện di (Dùng chung)</option>
                        <option value="Bán thành phẩm (BTP)">🫙 Nhóm Bán thành phẩm MasterMix / Primer / Đệm BTP (Dùng chung)</option>
                        <option value="Dùng chung mọi sản phẩm">⚙️ Quy trình tùy chỉnh dùng chung cho nhiều sản phẩm</option>
                      </select>
                    </Field>
                    <Field label="Tên quy trình công đoạn (Routing dùng chung) *">
                      <input
                        className={inputClass}
                        placeholder="VD: Quy trình pha chế, chiết rót & đóng gói Kit PCR (5 bước)"
                        value={rtForm.name}
                        onChange={(e) => setRtForm({ ...rtForm, name: e.target.value })}
                        required
                      />
                    </Field>
                  </div>

                  {/* Chọn Mẫu quy trình công đoạn chuẩn nhiều bước */}
                  <div className="p-3 rounded-xl border border-sky-200 dark:border-sky-900/60 bg-white dark:bg-slate-950 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        1️⃣ Chọn Khung Quy Trình Mẫu Chuẩn (Tự động nạp danh sách các bước &amp; chức năng chuẩn):
                      </div>
                      <span className="text-[11px] font-semibold text-sky-700 dark:text-sky-300">
                        Đang thiết kế: {rtDraftSteps.length} bước công đoạn · Tổng định mức:{" "}
                        {rtDraftSteps.reduce((acc, s) => acc + Number(s.std_duration_min || 0), 0)} phút ·{" "}
                        {rtDraftSteps.filter((s) => s.is_qc).length} chốt chặn IPQC Gate
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                      {ROUTING_STANDARD_TEMPLATES.map((tpl) => {
                        const active = rtTemplateKey === tpl.key;
                        return (
                          <button
                            key={tpl.key}
                            type="button"
                            onClick={() => applyTemplateToDraftSteps(tpl.key)}
                            className={`text-left p-2.5 rounded-lg border transition-all ${
                              active
                                ? "border-sky-600 bg-sky-50/90 dark:bg-sky-950/60 ring-1 ring-sky-500"
                                : "border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50 hover:border-sky-300"
                            }`}
                          >
                            <div className="text-xs font-bold text-slate-900 dark:text-slate-100">{tpl.label}</div>
                            <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 line-clamp-2">{tpl.subtitle}</div>
                            <div className="mt-1.5 flex items-center gap-1.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300">
                              <span>{tpl.steps.length} bước</span>
                              <span>•</span>
                              <span>{tpl.steps.filter((s) => s.is_qc).length} cổng QC</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Thanh thêm nhanh bước theo 8 chức năng chuẩn */}
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                      <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                        2️⃣ Hoặc bấm để nối thêm Bước mới theo Chức năng Công đoạn chuẩn (Auto-fill SOP, Phòng sạch, Thông số &amp; Cờ EBR):
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.values(STEP_FUNCTION_CATALOG).map((fn) => (
                          <button
                            key={fn.key}
                            type="button"
                            onClick={() => handleAddDraftStepFromFunction(fn.key)}
                            title={fn.description}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:bg-sky-50 dark:hover:bg-sky-950/50 hover:border-sky-400 transition-colors"
                          >
                            + {fn.icon} {fn.shortLabel}
                          </button>
                        ))}
                        {rtDraftSteps.length > 0 && (
                          <button
                            type="button"
                            onClick={() => applyTemplateToDraftSteps("CUSTOM_EMPTY")}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100"
                          >
                            🗑️ Xóa trắng các bước để tự tạo từ đầu
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Danh sách các bước công đoạn trong dự thảo Routing */}
                  <div className="space-y-2.5">
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      3️⃣ Chi tiết từng Bước Công đoạn &amp; Đánh dấu Chức năng Kiểm soát ({rtDraftSteps.length} bước):
                    </div>
                    {rtDraftSteps.length === 0 ? (
                      <Empty>
                        Chưa có bước nào trong dự thảo. Hãy chọn 1 trong 4 khung mẫu bên trên hoặc bấm các nút &ldquo;+ Chức năng công đoạn&rdquo; để thêm bước.
                      </Empty>
                    ) : (
                      <div className="space-y-2.5 max-h-[540px] overflow-y-auto pr-1">
                        {rtDraftSteps.map((st, idx) => {
                          const fnSpec = STEP_FUNCTION_CATALOG[st.step_function] || STEP_FUNCTION_CATALOG.FORMULATION_MIXING;
                          return (
                            <div
                              key={`${st.seq}-${idx}`}
                              className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 space-y-2.5 shadow-2xs"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white dark:bg-sky-600 text-xs font-mono font-bold">
                                    Bước {st.seq}
                                  </span>
                                  <span className={`px-2 py-0.5 rounded-md border text-[11px] font-bold ${fnSpec.badgeClass}`}>
                                    {fnSpec.icon} {fnSpec.label}
                                  </span>
                                  {st.is_qc && (
                                    <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-300 text-[11px] font-bold">
                                      🛡️ Chốt chặn IPQC Gate (Khóa bước sau chờ QC PASS)
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    disabled={idx === 0}
                                    onClick={() => handleMoveDraftStep(idx, "UP")}
                                  >
                                    ↑ Lên
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    disabled={idx === rtDraftSteps.length - 1}
                                    onClick={() => handleMoveDraftStep(idx, "DOWN")}
                                  >
                                    ↓ Xuống
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="danger"
                                    onClick={() => handleDeleteDraftStep(idx)}
                                  >
                                    🗑️ Xóa bước
                                  </Button>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
                                <div className="md:col-span-2">
                                  <Field label="Chức năng chuẩn của Bước (Đánh dấu vai trò)">
                                    <select
                                      className={inputClass}
                                      value={st.step_function}
                                      onChange={(e) => handleChangeDraftStepFunction(idx, e.target.value)}
                                    >
                                      {Object.values(STEP_FUNCTION_CATALOG).map((fn) => (
                                        <option key={fn.key} value={fn.key}>
                                          {fn.icon} {fn.label}
                                        </option>
                                      ))}
                                    </select>
                                  </Field>
                                </div>
                                <Field label="Mã bước">
                                  <input
                                    className={`${inputClass} font-mono`}
                                    value={st.step_code}
                                    onChange={(e) =>
                                      setRtDraftSteps((prev) =>
                                        prev.map((item, i) => (i === idx ? { ...item, step_code: e.target.value } : item))
                                      )
                                    }
                                    required
                                  />
                                </Field>
                                <div className="md:col-span-2">
                                  <Field label="Tên công đoạn hiển thị trên Hồ sơ lô (EBR)">
                                    <input
                                      className={inputClass}
                                      value={st.step_name}
                                      onChange={(e) =>
                                        setRtDraftSteps((prev) =>
                                          prev.map((item, i) => (i === idx ? { ...item, step_name: e.target.value } : item))
                                        )
                                      }
                                      required
                                    />
                                  </Field>
                                </div>
                                <Field label="Định mức (phút)">
                                  <input
                                    type="number"
                                    min={1}
                                    className={inputClass}
                                    value={st.std_duration_min}
                                    onChange={(e) =>
                                      setRtDraftSteps((prev) =>
                                        prev.map((item, i) =>
                                          i === idx ? { ...item, std_duration_min: Number(e.target.value || 15) } : item
                                        )
                                      )
                                    }
                                  />
                                </Field>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                <Field label="Phòng sạch / Khu vực thực hiện (Work Center)">
                                  <input
                                    list="work-center-presets-list"
                                    className={inputClass}
                                    value={st.work_center}
                                    onChange={(e) =>
                                      setRtDraftSteps((prev) =>
                                        prev.map((item, i) => (i === idx ? { ...item, work_center: e.target.value } : item))
                                      )
                                    }
                                  />
                                </Field>
                                <Field label="Mã tài liệu SOP hướng dẫn">
                                  <input
                                    className={`${inputClass} font-mono`}
                                    value={st.sop_doc_code}
                                    onChange={(e) =>
                                      setRtDraftSteps((prev) =>
                                        prev.map((item, i) => (i === idx ? { ...item, sop_doc_code: e.target.value } : item))
                                      )
                                    }
                                  />
                                </Field>
                                <Field label="Đầu ra mong đợi (Expected Output)">
                                  <input
                                    className={inputClass}
                                    value={st.functional_flags.expected_output || ""}
                                    onChange={(e) =>
                                      setRtDraftSteps((prev) =>
                                        prev.map((item, i) =>
                                          i === idx
                                            ? {
                                                ...item,
                                                functional_flags: {
                                                  ...item.functional_flags,
                                                  expected_output: e.target.value,
                                                },
                                              }
                                            : item
                                        )
                                      )
                                    }
                                  />
                                </Field>
                              </div>

                              <Field label="Hướng dẫn thao tác chuẩn tại công đoạn">
                                <input
                                  className={inputClass}
                                  value={st.instructions}
                                  onChange={(e) =>
                                    setRtDraftSteps((prev) =>
                                      prev.map((item, i) => (i === idx ? { ...item, instructions: e.target.value } : item))
                                    )
                                  }
                                />
                              </Field>

                              {/* Các cờ chức năng đánh dấu cho từng bước */}
                              <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                                <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                  🏷️ Đánh dấu Chức năng Kiểm soát bắt buộc tại Bước {st.seq} (Tự động kích hoạt trên Hồ sơ lô điện tử EBR):
                                </div>
                                <div className="flex flex-wrap gap-3 text-xs">
                                  <label className="flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-300 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={st.is_qc}
                                      onChange={(e) =>
                                        setRtDraftSteps((prev) =>
                                          prev.map((item, i) => (i === idx ? { ...item, is_qc: e.target.checked } : item))
                                        )
                                      }
                                    />
                                    🛡️ Chốt chặn IPQC Gate (Khóa bước kế tiếp chờ QA/QC duyệt)
                                  </label>
                                  <label className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={st.requires_check_signature}
                                      onChange={(e) =>
                                        setRtDraftSteps((prev) =>
                                          prev.map((item, i) =>
                                            i === idx ? { ...item, requires_check_signature: e.target.checked } : item
                                          )
                                        )
                                      }
                                    />
                                    ✍️ Ký duyệt kép 2 người (Thực hiện + Kiểm tra chéo)
                                  </label>
                                  <label className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={st.functional_flags.require_line_clearance}
                                      onChange={(e) =>
                                        setRtDraftSteps((prev) =>
                                          prev.map((item, i) =>
                                            i === idx
                                              ? {
                                                  ...item,
                                                  functional_flags: {
                                                    ...item.functional_flags,
                                                    require_line_clearance: e.target.checked,
                                                  },
                                                }
                                              : item
                                          )
                                        )
                                      }
                                    />
                                    🧹 Checklist Line Clearance &amp; UV
                                  </label>
                                  <label className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={st.functional_flags.require_material_scan}
                                      onChange={(e) =>
                                        setRtDraftSteps((prev) =>
                                          prev.map((item, i) =>
                                            i === idx
                                              ? {
                                                  ...item,
                                                  functional_flags: {
                                                    ...item.functional_flags,
                                                    require_material_scan: e.target.checked,
                                                  },
                                                }
                                              : item
                                          )
                                        )
                                      }
                                    />
                                    📦 Quét đối chiếu Lô NVL FEFO
                                  </label>
                                  <label className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={st.functional_flags.require_env_log}
                                      onChange={(e) =>
                                        setRtDraftSteps((prev) =>
                                          prev.map((item, i) =>
                                            i === idx
                                              ? {
                                                  ...item,
                                                  functional_flags: {
                                                    ...item.functional_flags,
                                                    require_env_log: e.target.checked,
                                                  },
                                                }
                                              : item
                                          )
                                        )
                                      }
                                    />
                                    🌡️ Ghi nhận Nhiệt độ / Độ ẩm phòng
                                  </label>
                                  <label className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={st.functional_flags.require_yield_reconcile}
                                      onChange={(e) =>
                                        setRtDraftSteps((prev) =>
                                          prev.map((item, i) =>
                                            i === idx
                                              ? {
                                                  ...item,
                                                  functional_flags: {
                                                    ...item.functional_flags,
                                                    require_yield_reconcile: e.target.checked,
                                                  },
                                                }
                                              : item
                                          )
                                        )
                                      }
                                    />
                                    ⚖️ Cân bằng lượng &amp; Hao hụt
                                  </label>
                                  <label className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={st.functional_flags.require_label_ifu_check}
                                      onChange={(e) =>
                                        setRtDraftSteps((prev) =>
                                          prev.map((item, i) =>
                                            i === idx
                                              ? {
                                                  ...item,
                                                  functional_flags: {
                                                    ...item.functional_flags,
                                                    require_label_ifu_check: e.target.checked,
                                                  },
                                                }
                                              : item
                                          )
                                        )
                                      }
                                    />
                                    🏷️ Đối chiếu 100% Nhãn &amp; Tờ HDSD (IFU)
                                  </label>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
                    <div className="text-xs text-slate-600 dark:text-slate-400">
                      💡 Sau khi khởi tạo, bạn vẫn có thể thêm/sửa/xóa bước hoặc bấm <b>&ldquo;✅ Kích hoạt Hiệu lực ngay (EFFECTIVE)&rdquo;</b> để áp dụng cho Lệnh sản xuất.
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" variant="ghost" onClick={() => setShowCreateRouting(false)}>
                        Hủy
                      </Button>
                      <Button type="submit">
                        🚀 Khởi tạo Quy trình Routing ({rtDraftSteps.length} bước)
                      </Button>
                    </div>
                  </div>
                </form>
              )}

              <datalist id="work-center-presets-list">
                {WORK_CENTER_PRESETS.map((wc) => (
                  <option key={wc} value={wc} />
                ))}
              </datalist>

              {routings.length === 0 ? (
                <Empty>Chưa có quy trình công đoạn nào. Nhấn &ldquo;+ Tạo quy trình Routing nhiều bước&rdquo; ở góc phải trên để khởi tạo.</Empty>
              ) : (() => {
                const totalRtPages = Math.max(1, Math.ceil(routings.length / rtPageSize));
                const safeRtPage = Math.min(Math.max(1, rtPage), totalRtPages);
                const rtStart = (safeRtPage - 1) * rtPageSize;
                const pagedRoutings = routings.slice(rtStart, rtStart + rtPageSize);
                return (
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-300">
                      <div>
                        Hiển thị <b>{rtStart + 1}–{Math.min(rtStart + rtPageSize, routings.length)}</b> / <b>{routings.length}</b> quy trình{" "}
                        <span className="text-slate-400">· Click dòng bất kỳ để xem chi tiết</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <select
                          className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-0.5 text-[11px]"
                          value={rtPageSize}
                          onChange={(e) => {
                            setRtPageSize(Number(e.target.value) || 15);
                            setRtPage(1);
                          }}
                        >
                          <option value={10}>10/trang</option>
                          <option value={15}>15/trang</option>
                          <option value={30}>30/trang</option>
                          <option value={50}>50/trang</option>
                        </select>
                        <button
                          type="button"
                          disabled={safeRtPage <= 1}
                          onClick={() => setRtPage((p) => Math.max(1, p - 1))}
                          className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-semibold cursor-pointer"
                        >
                          ‹ Trước
                        </button>
                        <span className="px-1.5 font-bold text-sky-700 dark:text-sky-300">
                          {safeRtPage}/{totalRtPages}
                        </span>
                        <button
                          type="button"
                          disabled={safeRtPage >= totalRtPages}
                          onClick={() => setRtPage((p) => Math.min(totalRtPages, p + 1))}
                          className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-200/60 dark:hover:bg-slate-800 font-semibold cursor-pointer"
                        >
                          Sau ›
                        </button>
                      </div>
                    </div>

                    <Table head={["Mã Quy trình", "Tên quy trình & Nhóm dùng chung", "Số BOM áp dụng", "Số bước", "Trạng thái", ""]}>
                      {pagedRoutings.map((r) => {
                        const isSelected = selectedRoutingId === r.id;
                        return (
                          <tr
                            key={r.id}
                            onClick={() => {
                              setSelectedRoutingId(r.id);
                              setTimeout(() => {
                                rtDetailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                              }, 80);
                            }}
                            className={`cursor-pointer transition-colors hover:bg-sky-500/10 ${
                              isSelected ? "bg-sky-500/15 ring-1 ring-inset ring-sky-500/40" : ""
                            }`}
                          >
                            <td className="px-2.5 py-2 text-xs whitespace-nowrap">
                              <div className="font-mono font-bold text-sky-600 dark:text-sky-400">
                                {r.code} · v{r.routing_version}
                              </div>
                              <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                                {r.routing_category || (r.product_code ? `SP: ${r.product_code}` : "Dùng chung")}
                              </div>
                            </td>
                            <td className="px-2.5 py-2 text-xs max-w-[260px]">
                              <div className="font-semibold text-slate-800 dark:text-slate-100 truncate" title={r.name}>
                                {r.name}
                              </div>
                            </td>
                            <td className="px-2.5 py-2 text-xs whitespace-nowrap">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-400/40 text-indigo-700 dark:text-indigo-200 font-bold text-[11px]">
                                🔗 {r.linked_bom_count ?? 0} BOM
                              </span>
                            </td>
                            <td className="px-2.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                              {r.step_count} bước
                            </td>
                            <td className="px-2.5 py-2 whitespace-nowrap">
                              <StatusBadge status={r.status} />
                            </td>
                            <td className="px-2.5 py-2 text-right whitespace-nowrap">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold border transition ${
                                  isSelected
                                    ? "bg-sky-600 text-white border-sky-500"
                                    : "bg-sky-500/10 text-sky-600 dark:text-sky-300 border-sky-500/30 hover:bg-sky-500/20"
                                }`}
                              >
                                {isSelected ? "Đang xem" : "Chi tiết →"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </Table>
                  </div>
                );
              })()}
            </Card>
          </div>

          {routingDetail && !showCreateRouting && (
            <div ref={rtDetailRef} className="lg:col-span-8 space-y-4">
              <Card
                title={`${routingDetail.routing.code} (v${routingDetail.routing.routing_version}) — ${routingDetail.routing.name}`}
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={routingDetail.routing.status} />
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setSelectedRoutingId("");
                        setRoutingDetail(null);
                      }}
                    >
                      Đóng chi tiết
                    </Button>
                  </div>
                }
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <ActionBar
                      endpoint={`/api/factory/kit/routings/${routingDetail.routing.id}/actions`}
                      version={routingDetail.routing.version}
                      actions={routingDetail.allowed_actions}
                      labels={ACTION_LABELS}
                      onDone={() => {
                        loadList();
                        loadRoutingDetail(routingDetail.routing.id);
                      }}
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      {routingDetail.routing.status === "DRAFT" && (
                        <div className="flex items-center gap-1">
                          <select
                            className={`${inputClass} py-1 text-xs max-w-[230px]`}
                            value={selectedTemplateForLoad}
                            onChange={(e) => setSelectedTemplateForLoad(e.target.value)}
                          >
                            {ROUTING_STANDARD_TEMPLATES.map((tpl) => (
                              <option key={tpl.key} value={tpl.key}>
                                {tpl.label}
                              </option>
                            ))}
                          </select>
                          <Button
                            variant="ghost"
                            onClick={() => handleLoadStandardSteps(routingDetail.routing.id, selectedTemplateForLoad)}
                          >
                            ⚡ Nạp khung mẫu chuẩn
                          </Button>
                        </div>
                      )}
                      {routingDetail.routing.status !== "EFFECTIVE" && (
                        <Button
                          variant="secondary"
                          onClick={() => handleFastActivateRouting(routingDetail.routing.id)}
                        >
                          ✅ Kích hoạt Hiệu lực ngay (EFFECTIVE)
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        onClick={() => handleCloneRouting(routingDetail.routing.id)}
                      >
                        📋 Nhân bản phiên bản mới (Clone v{Number(routingDetail.routing.routing_version || 1) + 1})
                      </Button>
                    </div>
                  </div>

                  {/* Thông tin nhóm dùng chung & danh sách công thức BOM đang áp dụng quy trình này */}
                  <div className="p-2.5 rounded-xl border border-indigo-500/30 bg-indigo-950/25 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-400/40 text-indigo-200 font-bold text-[11px]">
                        ⚙️ Nhóm quy trình: {routingDetail.routing.routing_category || "Dùng chung nhiều BOM"}
                      </span>
                      <span className="text-slate-300">
                        Đang được chọn áp dụng trong{" "}
                        <b className="text-sky-300">{routingDetail.routing.linked_bom_count ?? (routingDetail.linked_boms?.length || 0)} công thức BOM</b>
                        {" "}(Thay đổi quy trình tại từng BOM ở Tab 1)
                      </span>
                    </div>
                    {Array.isArray(routingDetail.linked_boms) && routingDetail.linked_boms.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 w-full pt-1 border-t border-indigo-500/20">
                        <span className="text-[11px] text-slate-400 mr-1">Các BOM tiêu biểu đang dùng:</span>
                        {routingDetail.linked_boms.slice(0, 12).map((lb: any) => (
                          <button
                            key={lb.id}
                            type="button"
                            onClick={() => {
                              setSelectedBomId(lb.id);
                              setSubTab("bom");
                            }}
                            title={`${lb.code} — ${lb.product_name || lb.name}`}
                            className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-sky-900/60 border border-slate-700 text-[10px] font-mono font-semibold text-sky-300 cursor-pointer transition"
                          >
                            {lb.product_code} ({lb.code})
                          </button>
                        ))}
                        {(routingDetail.routing.linked_bom_count ?? 0) > 12 && (
                          <span className="text-[10px] text-slate-400">
                            +{(routingDetail.routing.linked_bom_count ?? 0) - 12} BOM khác...
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Sơ đồ luồng công đoạn trực quan (Visual Process Flow) */}
                  {routingDetail.steps.length > 0 && (
                    <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/50 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          ⛓️ Sơ đồ Luồng Công đoạn Chuẩn ({routingDetail.steps.length} bước nối tiếp):
                        </span>
                        <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                          ⏱️ Tổng thời gian định mức:{" "}
                          <b>{routingDetail.steps.reduce((acc: number, s: any) => acc + Number(s.std_duration_min || 30), 0)} phút</b> ·{" "}
                          🛡️ Chốt chặn IPQC Gate: <b>{routingDetail.steps.filter((s: any) => s.is_qc).length} bước</b>
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {routingDetail.steps.map((s: any, i: number) => {
                          const fnKey = s.step_function || (s.is_qc ? "IPQC_PH_GATE" : s.category || "FORMULATION_MIXING");
                          const fnSpec = STEP_FUNCTION_CATALOG[fnKey] || STEP_FUNCTION_CATALOG.FORMULATION_MIXING;
                          return (
                            <React.Fragment key={s.id}>
                              <div
                                onClick={() => {
                                  if (routingDetail.routing.status === "DRAFT") handleStartEditStep(s);
                                }}
                                className={`px-2.5 py-1.5 rounded-lg border text-xs transition-all ${
                                  routingDetail.routing.status === "DRAFT" ? "cursor-pointer hover:ring-1 hover:ring-sky-500" : ""
                                } ${
                                  s.is_qc
                                    ? "border-amber-400 bg-amber-50/90 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200"
                                    : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200"
                                }`}
                              >
                                <div className="flex items-center gap-1 font-bold">
                                  <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-white dark:bg-sky-700">
                                    B{s.seq}
                                  </span>
                                  <span>{fnSpec.icon}</span>
                                  <span>{s.step_name}</span>
                                </div>
                                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5">
                                  <span>{fnSpec.shortLabel}</span>
                                  {s.std_duration_min ? <span>• {s.std_duration_min}p</span> : null}
                                  {s.is_qc ? <span className="font-bold text-amber-700 dark:text-amber-300">• 🛡️ IPQC Gate</span> : null}
                                </div>
                              </div>
                              {i < routingDetail.steps.length - 1 && (
                                <span className="text-slate-400 font-bold text-xs">➔</span>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </Card>

              <Card
                title={`Các bước công đoạn chuẩn (${routingDetail.steps.length} bước — Tự động sinh Hồ sơ lô EBR khi chạy PO)`}
                actions={
                  <div className="flex flex-wrap gap-1.5">
                    {routingDetail.routing.status === "DRAFT" && (
                      <Button
                        variant={showAddStep && !editingStepId ? "secondary" : "primary"}
                        onClick={() => {
                          if (showAddStep && !editingStepId) {
                            setShowAddStep(false);
                          } else {
                            handleStartAddNewStep();
                          }
                        }}
                      >
                        {showAddStep && !editingStepId ? "Đóng form thêm bước" : "+ Thêm bước công đoạn mới"}
                      </Button>
                    )}
                  </div>
                }
              >
                {routingDetail.steps.length === 0 ? (
                  <Empty>
                    Chưa có bước công đoạn nào. Hãy chọn khung mẫu ở trên rồi bấm &ldquo;⚡ Nạp khung mẫu chuẩn&rdquo; hoặc bấm &ldquo;+ Thêm bước công đoạn mới&rdquo;.
                  </Empty>
                ) : (
                  <Table
                    head={[
                      "Bước",
                      "Mã & Tên công đoạn / Hướng dẫn",
                      "Chức năng & Khu vực",
                      "SOP / Thiết bị / TG",
                      "Thông số kiểm soát (EBR)",
                      "Cờ chức năng & Chữ ký",
                      ...(routingDetail.routing.status === "DRAFT" ? ["Thao tác"] : []),
                    ]}
                  >
                    {routingDetail.steps.map((s: any, idx: number) => {
                      const fnKey = s.step_function || (s.is_qc ? "IPQC_PH_GATE" : s.category || "FORMULATION_MIXING");
                      const fnSpec = STEP_FUNCTION_CATALOG[fnKey] || STEP_FUNCTION_CATALOG.FORMULATION_MIXING;
                      const flags = s.functional_flags && typeof s.functional_flags === "object" ? s.functional_flags : {};
                      return (
                        <tr key={s.id} className="align-top">
                          <td className="px-3 py-2.5 font-mono text-xs font-bold text-slate-800 dark:text-slate-100">
                            <span className="inline-block px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700">
                              #{s.seq}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-xs max-w-[260px]">
                            <div className="font-bold text-slate-900 dark:text-slate-100">
                              <span className="font-mono text-sky-700 dark:text-sky-300">{s.step_code}</span> — {s.step_name}
                            </div>
                            <div className="text-slate-600 dark:text-slate-400 mt-0.5 leading-snug">{s.instructions}</div>
                            {s.expected_output && (
                              <div className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium mt-1">
                                🎯 Đầu ra: {s.expected_output}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-xs space-y-1">
                            <div>
                              <span className={`inline-block px-2 py-0.5 rounded border text-[11px] font-bold ${fnSpec.badgeClass}`}>
                                {fnSpec.icon} {fnSpec.shortLabel}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              Nhóm: {STEP_CATEGORY_LABELS[s.category] ?? s.category}
                            </div>
                            {s.work_center && (
                              <div className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                                📍 {s.work_center}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-xs space-y-1">
                            {s.sop_doc_code && (
                              <div className="font-mono font-semibold text-sky-800 dark:text-sky-300">📄 {s.sop_doc_code}</div>
                            )}
                            {s.std_duration_min && (
                              <div className="text-[11px] text-slate-600 dark:text-slate-300">⏱️ Định mức: {s.std_duration_min} phút</div>
                            )}
                            {s.asset_code && (
                              <div className="text-[11px] text-slate-600 dark:text-slate-400">⚙️ TB: {s.asset_code}</div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-xs space-y-1">
                            {(s.param_schema || []).length === 0 ? (
                              <span className="text-slate-400 text-[11px]">Không yêu cầu nhập số đo</span>
                            ) : (
                              (s.param_schema || []).map((p: any) => (
                                <div
                                  key={p.key}
                                  className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-[11px]"
                                >
                                  <b>{p.label}</b>: [{p.min ?? "-"} .. {p.max ?? "-"}] {p.unit}
                                </div>
                              ))
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-xs space-y-1">
                            <div className="flex flex-wrap gap-1">
                              {s.is_qc && (
                                <span
                                  title="Bước Kiểm soát Chất lượng Trung gian Xen kẽ (IPQC Gate): Các bước phía sau trong Hồ sơ lô (EBR) sẽ tự động khóa cho tới khi bước này được QA/QC xác nhận thông qua"
                                  className="inline-block px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold text-[10px]"
                                >
                                  🛡️ Chốt chặn IPQC Gate
                                </span>
                              )}
                              <span className="inline-block px-2 py-0.5 rounded bg-sky-50 dark:bg-sky-950/60 text-sky-800 dark:text-sky-200 border border-sky-200 dark:border-sky-800 font-semibold text-[10px]">
                                {s.requires_check_signature ? "✍️ Ký 2 lớp (4-Eyes)" : "✍️ Ký 1 lớp"}
                              </span>
                              {flags.require_line_clearance && (
                                <span className="inline-block px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-medium">
                                  🧹 Line Clearance
                                </span>
                              )}
                              {flags.require_material_scan && (
                                <span className="inline-block px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-200 text-[10px] font-medium">
                                  📦 Quét Lô FEFO
                                </span>
                              )}
                              {flags.require_env_log && (
                                <span className="inline-block px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-200 text-[10px] font-medium">
                                  🌡️ Nhiệt-Ẩm
                                </span>
                              )}
                              {flags.require_yield_reconcile && (
                                <span className="inline-block px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-950/60 text-purple-800 dark:text-purple-200 text-[10px] font-medium">
                                  ⚖️ Cân bằng lượng
                                </span>
                              )}
                              {flags.require_label_ifu_check && (
                                <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 text-[10px] font-medium">
                                  🏷️ Soát Nhãn &amp; IFU
                                </span>
                              )}
                            </div>
                          </td>
                          {routingDetail.routing.status === "DRAFT" && (
                            <td className="px-3 py-2.5 text-xs">
                              <div className="flex flex-wrap gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  disabled={idx === 0}
                                  onClick={() => handleMoveRoutingStep(s.id, "UP")}
                                >
                                  ↑
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  disabled={idx === routingDetail.steps.length - 1}
                                  onClick={() => handleMoveRoutingStep(s.id, "DOWN")}
                                >
                                  ↓
                                </Button>
                                <Button type="button" variant="ghost" onClick={() => handleStartEditStep(s)}>
                                  ✏️ Sửa
                                </Button>
                                <Button type="button" variant="danger" onClick={() => handleDeleteRoutingStep(s.id)}>
                                  🗑️
                                </Button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </Table>
                )}

                {routingDetail.routing.status === "DRAFT" && showAddStep && (
                  <form
                    onSubmit={handleAddRoutingStep}
                    className="mt-4 p-3.5 rounded-xl border border-sky-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-900/70 space-y-3"
                  >
                    <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
                      <div>
                        <div className="text-xs font-extrabold text-slate-900 dark:text-slate-100">
                          {editingStepId
                            ? `✏️ Cập nhật Bước #${stepForm.seq} (${stepForm.step_code} — ${stepForm.step_name})`
                            : "➕ Thêm Bước Công đoạn Mới vào Quy trình Routing"}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          Chọn chức năng chuẩn để tự động điền thông số gợi ý, hoặc tùy chỉnh toàn bộ các cờ kiểm soát và danh sách thông số đo EBR.
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setEditingStepId(null);
                          setShowAddStep(false);
                        }}
                      >
                        Đóng
                      </Button>
                    </div>

                    {/* Chọn nhanh chức năng chuẩn */}
                    <div className="space-y-1">
                      <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                        Chọn nhanh Chức năng chuẩn của Bước (Click để nạp cấu hình gợi ý):
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.values(STEP_FUNCTION_CATALOG).map((fn) => {
                          const active = stepForm.step_function === fn.key;
                          return (
                            <button
                              key={fn.key}
                              type="button"
                              onClick={() => handleSelectStepFunctionInForm(fn.key)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                                active
                                  ? "border-sky-600 bg-sky-600 text-white shadow-2xs"
                                  : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:border-sky-400"
                              }`}
                            >
                              {fn.icon} {fn.shortLabel}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
                      <Field label="Thứ tự (seq) *">
                        <input
                          type="number"
                          className={inputClass}
                          value={stepForm.seq}
                          onChange={(e) => setStepForm({ ...stepForm, seq: e.target.value })}
                          required
                        />
                      </Field>
                      <Field label="Mã bước *">
                        <input
                          className={`${inputClass} font-mono`}
                          value={stepForm.step_code}
                          onChange={(e) => setStepForm({ ...stepForm, step_code: e.target.value })}
                          required
                        />
                      </Field>
                      <div className="md:col-span-2">
                        <Field label="Tên công đoạn hiển thị *">
                          <input
                            className={inputClass}
                            value={stepForm.step_name}
                            onChange={(e) => setStepForm({ ...stepForm, step_name: e.target.value })}
                            required
                          />
                        </Field>
                      </div>
                      <Field label="Nhóm công đoạn">
                        <select
                          className={inputClass}
                          value={stepForm.category}
                          onChange={(e) => setStepForm({ ...stepForm, category: e.target.value })}
                        >
                          {Object.entries(STEP_CATEGORY_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Định mức (phút)">
                        <input
                          type="number"
                          min={1}
                          className={inputClass}
                          value={stepForm.std_duration_min}
                          onChange={(e) => setStepForm({ ...stepForm, std_duration_min: e.target.value })}
                        />
                      </Field>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                      <div className="md:col-span-2">
                        <Field label="Phòng sạch / Khu vực sản xuất (Work Center)">
                          <input
                            list="work-center-presets-list"
                            className={inputClass}
                            placeholder="VD: Phòng sạch Pha chế (Class 10,000 / ISO 7)"
                            value={stepForm.work_center}
                            onChange={(e) => setStepForm({ ...stepForm, work_center: e.target.value })}
                          />
                        </Field>
                      </div>
                      <Field label="Mã SOP hướng dẫn">
                        <input
                          className={`${inputClass} font-mono`}
                          value={stepForm.sop_doc_code}
                          onChange={(e) => setStepForm({ ...stepForm, sop_doc_code: e.target.value })}
                        />
                      </Field>
                      <Field label="Thiết bị bắt buộc">
                        <select
                          className={inputClass}
                          value={stepForm.required_asset_id}
                          onChange={(e) => setStepForm({ ...stepForm, required_asset_id: e.target.value })}
                        >
                          <option value="">-- Không cố định --</option>
                          {options.assets.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code} — {a.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <Field label="Hướng dẫn thao tác chuẩn *">
                        <input
                          className={inputClass}
                          value={stepForm.instructions}
                          onChange={(e) => setStepForm({ ...stepForm, instructions: e.target.value })}
                          required
                        />
                      </Field>
                      <Field label="Kết quả / Bán thành phẩm đầu ra mong đợi (Expected Output)">
                        <input
                          className={inputClass}
                          placeholder="VD: Dung dịch Master Mix đồng nhất, đạt pH chuẩn"
                          value={stepForm.expected_output}
                          onChange={(e) => setStepForm({ ...stepForm, expected_output: e.target.value })}
                        />
                      </Field>
                    </div>

                    {/* Quản lý danh sách nhiều thông số kiểm soát EBR */}
                    <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200">
                          📊 Danh sách Thông số Kiểm soát Định lượng trên Hồ sơ lô EBR ({stepForm.params.length} thông số):
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() =>
                            setStepForm((prev) => ({
                              ...prev,
                              params: [
                                ...prev.params,
                                {
                                  key: `param_${prev.params.length + 1}`,
                                  label: "",
                                  type: "number",
                                  unit: "",
                                  min: "",
                                  max: "",
                                  required: true,
                                },
                              ],
                            }))
                          }
                        >
                          + Thêm thông số đo
                        </Button>
                      </div>
                      {stepForm.params.length === 0 ? (
                        <div className="text-[11px] text-slate-400">
                          Bước này chưa khai báo thông số đo định lượng. Nhấn &ldquo;+ Thêm thông số đo&rdquo; nếu cần ghi nhận nhiệt độ, độ ẩm, pH, thể tích...
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {stepForm.params.map((pm, pIdx) => (
                            <div key={pIdx} className="grid grid-cols-1 md:grid-cols-12 gap-1.5 items-center">
                              <div className="md:col-span-2">
                                <input
                                  className={`${inputClass} font-mono text-xs`}
                                  placeholder="Mã key (vd: ph_val)"
                                  value={pm.key}
                                  onChange={(e) =>
                                    setStepForm((prev) => ({
                                      ...prev,
                                      params: prev.params.map((item, i) => (i === pIdx ? { ...item, key: e.target.value } : item)),
                                    }))
                                  }
                                />
                              </div>
                              <div className="md:col-span-4">
                                <input
                                  className={`${inputClass} text-xs`}
                                  placeholder="Tên thông số hiển thị (vd: Độ pH dung dịch)"
                                  value={pm.label}
                                  onChange={(e) =>
                                    setStepForm((prev) => ({
                                      ...prev,
                                      params: prev.params.map((item, i) => (i === pIdx ? { ...item, label: e.target.value } : item)),
                                    }))
                                  }
                                />
                              </div>
                              <div className="md:col-span-2">
                                <input
                                  type="number"
                                  step="any"
                                  className={`${inputClass} text-xs`}
                                  placeholder="Ngưỡng Min"
                                  value={pm.min ?? ""}
                                  onChange={(e) =>
                                    setStepForm((prev) => ({
                                      ...prev,
                                      params: prev.params.map((item, i) =>
                                        i === pIdx ? { ...item, min: e.target.value } : item
                                      ),
                                    }))
                                  }
                                />
                              </div>
                              <div className="md:col-span-2">
                                <input
                                  type="number"
                                  step="any"
                                  className={`${inputClass} text-xs`}
                                  placeholder="Ngưỡng Max"
                                  value={pm.max ?? ""}
                                  onChange={(e) =>
                                    setStepForm((prev) => ({
                                      ...prev,
                                      params: prev.params.map((item, i) =>
                                        i === pIdx ? { ...item, max: e.target.value } : item
                                      ),
                                    }))
                                  }
                                />
                              </div>
                              <div className="md:col-span-1">
                                <input
                                  className={`${inputClass} text-xs`}
                                  placeholder="Đơn vị"
                                  value={pm.unit ?? ""}
                                  onChange={(e) =>
                                    setStepForm((prev) => ({
                                      ...prev,
                                      params: prev.params.map((item, i) => (i === pIdx ? { ...item, unit: e.target.value } : item)),
                                    }))
                                  }
                                />
                              </div>
                              <div className="md:col-span-1 flex justify-end">
                                <Button
                                  type="button"
                                  variant="danger"
                                  onClick={() =>
                                    setStepForm((prev) => ({
                                      ...prev,
                                      params: prev.params.filter((_, i) => i !== pIdx),
                                    }))
                                  }
                                >
                                  ✕
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Các cờ chức năng đánh dấu cho bước */}
                    <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 space-y-1.5">
                      <div className="text-[11px] font-bold text-slate-800 dark:text-slate-200">
                        🏷️ Đánh dấu Chức năng Kiểm soát tại Bước này:
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs">
                        <label className="flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={stepForm.is_qc}
                            onChange={(e) => setStepForm({ ...stepForm, is_qc: e.target.checked })}
                          />
                          🛡️ Chốt chặn IPQC Gate (Cần QC xác nhận PASS mới mở khóa bước kế tiếp)
                        </label>
                        <label className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={stepForm.requires_check_signature}
                            onChange={(e) => setStepForm({ ...stepForm, requires_check_signature: e.target.checked })}
                          />
                          ✍️ Yêu cầu chữ ký kiểm tra chéo (2 người — 4-Eyes)
                        </label>
                        <label className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={stepForm.functional_flags.require_line_clearance}
                            onChange={(e) =>
                              setStepForm({
                                ...stepForm,
                                functional_flags: { ...stepForm.functional_flags, require_line_clearance: e.target.checked },
                              })
                            }
                          />
                          🧹 Checklist Dọn dây chuyền &amp; Khử trùng UV
                        </label>
                        <label className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={stepForm.functional_flags.require_material_scan}
                            onChange={(e) =>
                              setStepForm({
                                ...stepForm,
                                functional_flags: { ...stepForm.functional_flags, require_material_scan: e.target.checked },
                              })
                            }
                          />
                          📦 Quét đối chiếu Lô NVL FEFO
                        </label>
                        <label className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={stepForm.functional_flags.require_env_log}
                            onChange={(e) =>
                              setStepForm({
                                ...stepForm,
                                functional_flags: { ...stepForm.functional_flags, require_env_log: e.target.checked },
                              })
                            }
                          />
                          🌡️ Nhật ký Nhiệt độ / Độ ẩm phòng sạch
                        </label>
                        <label className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={stepForm.functional_flags.require_yield_reconcile}
                            onChange={(e) =>
                              setStepForm({
                                ...stepForm,
                                functional_flags: { ...stepForm.functional_flags, require_yield_reconcile: e.target.checked },
                              })
                            }
                          />
                          ⚖️ Cân bằng lượng &amp; Hao hụt bán thành phẩm
                        </label>
                        <label className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={stepForm.functional_flags.require_label_ifu_check}
                            onChange={(e) =>
                              setStepForm({
                                ...stepForm,
                                functional_flags: { ...stepForm.functional_flags, require_label_ifu_check: e.target.checked },
                              })
                            }
                          />
                          🏷️ Kiểm tra đối chiếu 100% Nhãn &amp; Tờ HDSD (IFU)
                        </label>
                        <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={stepForm.allow_skip}
                            onChange={(e) => setStepForm({ ...stepForm, allow_skip: e.target.checked })}
                          />
                          Cho phép bỏ qua có duyệt
                        </label>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setEditingStepId(null);
                          setShowAddStep(false);
                        }}
                      >
                        Hủy
                      </Button>
                      <Button type="submit">
                        {editingStepId ? "💾 Lưu cập nhật bước công đoạn" : "💾 Lưu bước công đoạn vào Routing"}
                      </Button>
                    </div>
                  </form>
                )}
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

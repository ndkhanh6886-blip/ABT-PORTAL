"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ActionBar } from "../actions";
import { api, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { ACTION_LABELS, CONTAINER_LABELS, type KitOptions, ROLE_LABELS, STEP_CATEGORY_LABELS } from "./shared";

export function BomRoutingView({ options, onRefreshOptions }: { options: KitOptions; onRefreshOptions: () => void }) {
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
  const [lineSearch, setLineSearch] = useState("");
  const [lineBoxFilter, setLineBoxFilter] = useState("");
  const [bulkLinesText, setBulkLinesText] = useState("");
  const [showBulkPaste, setShowBulkPaste] = useState(false);
  const [showCreateBom, setShowCreateBom] = useState(false);
  const [showAddLine, setShowAddLine] = useState(false);
  const [showAddSub, setShowAddSub] = useState(false);
  const [showAddPack, setShowAddPack] = useState(false);
  const [showEditLabelIfu, setShowEditLabelIfu] = useState(false);
  const [showPreviewLabelIfu, setShowPreviewLabelIfu] = useState(false);
  const [showCreateRouting, setShowCreateRouting] = useState(false);
  const [showAddStep, setShowAddStep] = useState(false);

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
  });

  const [bomForm, setBomForm] = useState({
    org_unit_id: options.units[0]?.id ?? "",
    product_item_id: "",
    name: "",
    tests_per_kit: "50",
    shelf_life_days: "365",
    clone_from_bom_id: "",
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
    name: "",
  });

  const [stepForm, setStepForm] = useState({
    seq: "10",
    step_code: "STEP-01",
    step_name: "Pha chế Master Mix",
    category: "FORMULATION",
    instructions: "Rã đông hóa chất trên đá lạnh, phối trộn theo đúng tỷ lệ BOM và vortex nhẹ.",
    sop_doc_code: "SOP-KIT-001",
    required_asset_id: "",
    is_qc: false,
    requires_check_signature: true,
    allow_skip: false,
    param_key: "temp_c",
    param_label: "Nhiệt độ phòng pha chế",
    param_unit: "°C",
    param_min: "18",
    param_max: "25",
  });

  const loadList = useCallback(async () => {
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (bomSearch.trim()) qs.set("q", bomSearch.trim());
      if (bomStatusFilter) qs.set("status", bomStatusFilter);
      qs.set("limit", "200");
      const [bRes, rRes] = await Promise.all([
        api<{ boms: any[] }>(`/api/factory/kit/boms?${qs.toString()}`),
        api<{ routings: any[] }>(`/api/factory/kit/routings?${qs.toString()}`),
      ]);
      setBoms(bRes.boms);
      setRoutings(rRes.routings);
      if (!selectedBomId && bRes.boms[0]?.id) setSelectedBomId(bRes.boms[0].id);
      if (!selectedRoutingId && rRes.routings[0]?.id) setSelectedRoutingId(rRes.routings[0].id);
    } catch (e) {
      setError(e);
    }
  }, [selectedBomId, selectedRoutingId, bomSearch, bomStatusFilter]);

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
        setLabelIfuForm({
          label_template_code: d.bom.label_template_code ?? `LBL-${d.bom.product_code}-V1`,
          label_dimensions: d.bom.label_dimensions ?? "Nhãn Hộp ngoài: 95×65 mm · Nhãn Ống 1.5mL: 38×19 mm (Chịu lạnh -80°C)",
          udi_di: d.bom.udi_di ?? "(01)08936192830117",
          ifu_code: d.bom.ifu_code ?? `IFU-${d.bom.product_code}`,
          ifu_version: d.bom.ifu_version ?? `Rev 0${d.bom.bom_version || 1} (Hiệu lực ISO 13485)`,
          ifu_intended_use:
            d.bom.ifu_intended_use ??
            "Bộ Kit xét nghiệm chẩn đoán in vitro (IVD) phát hiện và định lượng acid nucleic đặc hiệu bằng kỹ thuật Real-time PCR / RT-qPCR trên mẫu bệnh phẩm lâm sàng.",
          ifu_thermal_profile:
            d.bom.ifu_thermal_profile ??
            "Bước 1 (UNG/RT): 50°C × 10 phút (1 chu kỳ) ➔ Bước 2 (Biến tính đầu): 95°C × 3 phút (1 chu kỳ) ➔ Bước 3 (Khuếch đại 45 chu kỳ): 95°C × 15 giây + 60°C × 45 giây (Thu tín hiệu huỳnh quang tại 60°C).",
          ifu_channels:
            d.bom.ifu_channels ??
            "FAM: Đích tác nhân chính (Target) · HEX/VIC: Chứng nội (Internal Control - IC) · ROX: Tham chiếu thụ động",
          ifu_interpretation:
            d.bom.ifu_interpretation ??
            "Dương tính: Ct (FAM) ≤ 38.0 có đường cong khuếch đại dạng chữ S · Âm tính: Không lên FAM và Ct (HEX/IC) ≤ 35.0 · Không hợp lệ: Không lên cả FAM và HEX/IC.",
        });
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

  const kitProducts = options.items.filter((i) => ["FINISHED_KIT", "SEMI_FINISHED"].includes(i.item_type));

  const handleCreateBom = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api<{ bom: any }>("/api/factory/kit/boms", {
        method: "POST",
        idempotent: true,
        json: {
          org_unit_id: bomForm.org_unit_id || options.units[0]?.id,
          product_item_id: bomForm.product_item_id,
          name: bomForm.name,
          tests_per_kit: Number(bomForm.tests_per_kit),
          shelf_life_days: Number(bomForm.shelf_life_days),
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

  const handleAddBomLine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBomId) return;
    setError(null);
    try {
      const item = options.items.find((i) => i.id === lineForm.component_item_id);
      await api(`/api/factory/kit/boms/${selectedBomId}`, {
        method: "POST",
        json: {
          kind: "line",
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
      await loadBomDetail(selectedBomId);
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
      const created = await api<any>("/api/factory/inv/items", {
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
          kind: "packaging",
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
      await loadBomDetail(selectedBomId);
      await loadList();
    } catch (err) {
      setError(err);
    }
  };

  const handleSaveLabelIfu = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBomId) return;
    setError(null);
    try {
      await api(`/api/factory/kit/boms/${selectedBomId}`, {
        method: "POST",
        json: {
          kind: "label_ifu",
          ...labelIfuForm,
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

  const handleLoadStandardSteps = async (id: string) => {
    setError(null);
    try {
      await api(`/api/factory/kit/routings/${id}`, {
        method: "POST",
        json: { operation: "load_standard_steps" },
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

  const handleCreateRouting = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api<{ routing: any }>("/api/factory/kit/routings", {
        method: "POST",
        idempotent: true,
        json: {
          org_unit_id: rtForm.org_unit_id || options.units[0]?.id,
          product_item_id: rtForm.product_item_id,
          name: rtForm.name,
        },
      });
      setRtForm((p) => ({ ...p, name: "" }));
      setShowCreateRouting(false);
      setSelectedRoutingId(res.routing.id);
      await loadList();
      await loadRoutingDetail(res.routing.id);
    } catch (err) {
      setError(err);
    }
  };

  const handleAddRoutingStep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRoutingId) return;
    setError(null);
    try {
      const param_schema = stepForm.param_key.trim()
        ? [
            {
              key: stepForm.param_key.trim(),
              label: stepForm.param_label.trim() || stepForm.param_key.trim(),
              type: "number",
              unit: stepForm.param_unit || null,
              min: stepForm.param_min !== "" ? Number(stepForm.param_min) : null,
              max: stepForm.param_max !== "" ? Number(stepForm.param_max) : null,
              required: true,
            },
          ]
        : [];
      await api(`/api/factory/kit/routings/${selectedRoutingId}`, {
        method: "POST",
        json: {
          seq: Number(stepForm.seq),
          step_code: stepForm.step_code,
          step_name: stepForm.step_name,
          category: stepForm.category,
          instructions: stepForm.instructions,
          sop_doc_code: stepForm.sop_doc_code || null,
          required_asset_id: stepForm.required_asset_id || null,
          is_qc: stepForm.is_qc,
          requires_check_signature: stepForm.requires_check_signature,
          allow_skip: stepForm.allow_skip,
          param_schema,
        },
      });
      setStepForm((p) => ({ ...p, seq: String(Number(p.seq) + 10) }));
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
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className={`${bomDetail ? "lg:col-span-5" : "lg:col-span-12"} space-y-4`}>
            <Card
              title="Danh sách phiên bản BOM (Hỗ trợ hàng ngàn công thức)"
              actions={
                <Button onClick={() => setShowCreateBom((v) => !v)}>
                  {showCreateBom ? "Đóng form tạo BOM" : "+ Tạo phiên bản BOM mới"}
                </Button>
              }
            >
              {showCreateBom && (
                <form onSubmit={handleCreateBom} className="mb-4 p-3.5 rounded-xl border border-stone-200 dark:border-slate-800 bg-stone-50/70 dark:bg-slate-950/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-stone-800 dark:text-slate-200">Tạo phiên bản BOM mới</span>
                    <Button type="button" variant="ghost" onClick={() => setShowCreateBom(false)}>
                      Hủy
                    </Button>
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
                    <Field label="Sản phẩm Kit / Bán thành phẩm">
                      <select
                        className={inputClass}
                        value={bomForm.product_item_id}
                        onChange={(e) => setBomForm({ ...bomForm, product_item_id: e.target.value })}
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
                  <Field label="Tên định mức BOM">
                    <input
                      className={inputClass}
                      placeholder="VD: BOM Kit Real-time PCR HBV Định lượng (50 test)"
                      value={bomForm.name}
                      onChange={(e) => setBomForm({ ...bomForm, name: e.target.value })}
                      required
                    />
                  </Field>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="Số test / bộ Kit">
                      <input
                        type="number"
                        className={inputClass}
                        value={bomForm.tests_per_kit}
                        onChange={(e) => setBomForm({ ...bomForm, tests_per_kit: e.target.value })}
                      />
                    </Field>
                    <Field label="Hạn dùng (ngày)">
                      <input
                        type="number"
                        className={inputClass}
                        value={bomForm.shelf_life_days}
                        onChange={(e) => setBomForm({ ...bomForm, shelf_life_days: e.target.value })}
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
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => setShowCreateBom(false)}>
                      Đóng
                    </Button>
                    <Button type="submit">Khởi tạo BOM (DRAFT)</Button>
                  </div>
                </form>
              )}
              <div className="flex gap-2 mb-3">
                <input
                  className={inputClass}
                  placeholder="Tìm mã BOM, tên công thức, mã sản phẩm..."
                  value={bomSearch}
                  onChange={(e) => setBomSearch(e.target.value)}
                />
                <select
                  className={`${inputClass} w-36`}
                  value={bomStatusFilter}
                  onChange={(e) => setBomStatusFilter(e.target.value)}
                >
                  <option value="">Mọi trạng thái</option>
                  <option value="EFFECTIVE">Đang hiệu lực (EFFECTIVE)</option>
                  <option value="DRAFT">Bản nháp (DRAFT)</option>
                  <option value="PENDING_REVIEW">Chờ thẩm định (PENDING_REVIEW)</option>
                  <option value="OBSOLETE">Ngừng hiệu lực (OBSOLETE)</option>
                </select>
              </div>
              {boms.length === 0 ? (
                <Empty>Chưa có định mức BOM nào khớp bộ lọc. Nhấn &ldquo;+ Tạo phiên bản BOM mới&rdquo; ở góc phải trên để khởi tạo.</Empty>
              ) : (
                <Table head={["Mã BOM", "Sản phẩm", "Ver", "Số dòng", "Trạng thái"]}>
                  {boms.map((b) => (
                    <tr
                      key={b.id}
                      onClick={() => setSelectedBomId(b.id)}
                      className={`cursor-pointer hover:bg-amber-50/60 ${selectedBomId === b.id ? "bg-amber-50" : ""}`}
                    >
                      <td className="px-3 py-2 font-mono text-xs font-semibold">{b.code}</td>
                      <td className="px-3 py-2 text-xs">
                        <div className="font-medium text-stone-800">{b.product_code}</div>
                        <div className="text-stone-500">{b.name}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">v{b.bom_version}</td>
                      <td className="px-3 py-2 text-xs font-mono">{b.line_count ?? 0}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={b.status} />
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          </div>

          {bomDetail && (
            <div className="lg:col-span-7 space-y-4">
              <Card
                title={`${bomDetail.bom.code} (v${bomDetail.bom.bom_version}) — ${bomDetail.bom.product_code} ${bomDetail.bom.product_name}`}
                actions={
                  <div className="flex items-center gap-2">
                    <StatusBadge status={bomDetail.bom.status} />
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
                  <div className="grid grid-cols-3 gap-3 text-xs text-stone-600 mb-3">
                    <div>
                      Đơn vị cơ sở:{" "}
                      <strong className="text-stone-900">
                        {fmtQty(bomDetail.bom.base_qty)} {bomDetail.bom.base_uom}
                      </strong>
                    </div>
                    <div>
                      Quy cách: <strong className="text-stone-900">{bomDetail.bom.tests_per_kit} phản ứng/Kit</strong>
                    </div>
                    <div>
                      Hạn dùng chuẩn: <strong className="text-stone-900">{bomDetail.bom.shelf_life_days} ngày</strong>
                    </div>
                  </div>
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
                    <div className="flex items-center gap-2">
                      <input
                        className={`${inputClass} w-48`}
                        placeholder="Lọc mã / tên nguyên liệu..."
                        value={lineSearch}
                        onChange={(e) => setLineSearch(e.target.value)}
                      />
                      <input
                        type="number"
                        className={`${inputClass} w-24`}
                        placeholder="Hộp #"
                        value={lineBoxFilter}
                        onChange={(e) => setLineBoxFilter(e.target.value)}
                      />
                      {bomDetail.bom.status === "DRAFT" && (
                        <>
                          <Button onClick={() => setShowAddLine((v) => !v)}>
                            {showAddLine ? "Đóng thêm dòng" : "+ Thêm dòng BOM"}
                          </Button>
                          <Button variant="ghost" onClick={() => setShowBulkPaste(!showBulkPaste)}>
                            {showBulkPaste ? "Đóng nhập hàng loạt" : "+ Dán hàng loạt (Excel/TSV)"}
                          </Button>
                        </>
                      )}
                    </div>
                  }
                >
                  {showBulkPaste && bomDetail.bom.status === "DRAFT" && (
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
                  {bomDetail.lines.length === 0 ? (
                    <Empty>Chưa có dòng nguyên vật liệu nào trong BOM.</Empty>
                  ) : (
                    <Table head={["#", "Hộp", "Vai trò", "Mã VT / Bán TP", "Định mức (Thường / Chia sẵn .D.IC)", "Hao hụt", "Cấu hình Nổ BOM (Demo / Lưu QC / Thay thế)"]}>
                      {bomDetail.lines.map((l: any) => (
                        <tr key={l.id}>
                          <td className="px-3 py-2 text-xs">{l.line_no}</td>
                          <td className="px-3 py-2 text-xs font-medium">Hộp {l.box_no}</td>
                          <td className="px-3 py-2 text-xs">{ROLE_LABELS[l.component_role] ?? l.component_role}</td>
                          <td className="px-3 py-2 text-xs">
                            <span className="font-mono font-semibold">{l.component_code}</span> — {l.component_name}
                          </td>
                          <td className="px-3 py-2 text-xs font-semibold">
                            <div>
                              {fmtQty(l.qty_per_base)} {l.uom}
                            </div>
                            {l.qty_per_base_aliquoted != null && (
                              <div className="text-[11px] text-sky-700 font-mono">
                                .D.IC: {fmtQty(l.qty_per_base_aliquoted)} {l.uom}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs">{fmtQty(l.scrap_pct)}%</td>
                          <td className="px-3 py-2 text-[11px] text-stone-600 space-x-1">
                            <span className="px-1.5 py-0.5 rounded bg-stone-100">
                              {l.is_bundled ? `Đi kèm (${l.bundle_parent_code || "ngoài"})` : "Trừ kho"}
                            </span>
                            {l.is_demo_fixed_component ? (
                              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">Demo: Cố định 1 bộ</span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800">Demo: Co giãn theo test</span>
                            )}
                            {l.include_in_qc_retention !== false && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">+Mẫu lưu QC</span>
                            )}
                            {l.allow_substitute && (
                              <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800">Cho thay thế</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </Table>
                  )}

                  {bomDetail.bom.status === "DRAFT" && showAddLine && (
                    <form onSubmit={handleAddBomLine} className="mt-4 pt-3 border-t border-stone-200 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-stone-700">
                          Thêm thành phần vào BOM (Chuẩn ABT: Hỗ trợ Định mức thường, Chia sẵn .D.IC &amp; Kit Demo)
                        </div>
                        <Button type="button" variant="ghost" onClick={() => setShowAddLine(false)}>
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
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <div className="flex flex-wrap gap-3 text-xs text-stone-700">
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
                        <Button type="submit">Thêm dòng BOM</Button>
                      </div>
                    </form>
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
                    bomDetail.bom.status === "DRAFT" ? (
                      <Button variant="ghost" onClick={() => setShowAddPack((v) => !v)}>
                        {showAddPack ? "Đóng form đóng gói" : "+ Thêm quy cách đóng gói"}
                      </Button>
                    ) : null
                  }
                >
                  {bomDetail.packaging.length === 0 ? (
                    <Empty>Chưa khai báo quy cách ống/hộp cho BOM này.</Empty>
                  ) : (
                    <Table head={["Hộp", "Tên ống / thành phần", "Loại bao bì", "Thể tích nạp", "Số ống/Kit", "Bảo quản"]}>
                      {bomDetail.packaging.map((pk: any) => (
                        <tr key={pk.id}>
                          <td className="px-3 py-2 text-xs font-medium">
                            Hộp {pk.box_no}: {pk.box_name}
                          </td>
                          <td className="px-3 py-2 text-xs font-semibold">{pk.component_name}</td>
                          <td className="px-3 py-2 text-xs">{CONTAINER_LABELS[pk.container_type] ?? pk.container_type}</td>
                          <td className="px-3 py-2 text-xs">
                            {fmtQty(pk.fill_qty)} {pk.fill_uom}
                          </td>
                          <td className="px-3 py-2 text-xs">{pk.units_per_kit} ống</td>
                          <td className="px-3 py-2 text-xs font-mono">{pk.storage_temp}</td>
                        </tr>
                      ))}
                    </Table>
                  )}

                  {bomDetail.bom.status === "DRAFT" && showAddPack && (
                    <form onSubmit={handleAddPackaging} className="mt-4 pt-3 border-t border-stone-200 space-y-2">
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
                      <div className="flex items-end justify-between gap-2">
                        <div className="flex gap-2">
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
                        <Button type="submit">Lưu quy cách đóng gói</Button>
                      </div>
                    </form>
                  )}
                </Card>

                {/* Thẻ 3: Thiết kế Mẫu Nhãn sản phẩm (Label Artwork) & Hướng dẫn sử dụng (IFU) */}
                <Card
                  title={`3. Thiết kế Mẫu Nhãn Sản Phẩm (Label Artwork) & Hướng Dẫn Sử Dụng (IFU — ${bomDetail.bom.ifu_code ?? "IFU"})`}
                  actions={
                    <div className="flex flex-wrap gap-1.5">
                      <Button variant="ghost" onClick={() => setShowPreviewLabelIfu((v) => !v)}>
                        {showPreviewLabelIfu ? "Ẩn Xem trước" : "👁️ Xem trước Mẫu Nhãn & Tờ HDSD (IFU)"}
                      </Button>
                      <Button variant="secondary" onClick={() => setShowEditLabelIfu((v) => !v)}>
                        {showEditLabelIfu ? "Đóng chỉnh sửa" : "✏️ Thiết kế / Sửa Mẫu Nhãn & HDSD (IFU)"}
                      </Button>
                    </div>
                  }
                >
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs mb-2">
                    <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
                      <div className="text-[11px] text-slate-500">Mã Mẫu Nhãn &amp; UDI-DI:</div>
                      <div className="font-mono font-bold text-sky-700 dark:text-sky-400">
                        {bomDetail.bom.label_template_code ?? `LBL-${bomDetail.bom.product_code}-V1`}
                      </div>
                      <div className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
                        UDI-DI: {bomDetail.bom.udi_di ?? "(01)08936192830117"}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
                      <div className="text-[11px] text-slate-500">Quy cách khổ giấy in tem:</div>
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        {bomDetail.bom.label_dimensions ?? "Nhãn Hộp ngoài: 95×65 mm · Nhãn Ống: 38×19 mm"}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
                      <div className="text-[11px] text-slate-500">Tài liệu Hướng dẫn sử dụng (IFU):</div>
                      <div className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                        {bomDetail.bom.ifu_code ?? `IFU-${bomDetail.bom.product_code}`} — {bomDetail.bom.ifu_version ?? "Rev 01"}
                      </div>
                    </div>
                  </div>

                  {showEditLabelIfu && (
                    <form
                      onSubmit={handleSaveLabelIfu}
                      className="mt-2 p-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/40 dark:bg-sky-950/20 space-y-2.5"
                    >
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
                      <Field label="1. Mục đích sử dụng trên Tờ HDSD (Intended Use)">
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
                        <Button type="submit">💾 Lưu Thiết kế Nhãn &amp; HDSD (IFU)</Button>
                      </div>
                    </form>
                  )}

                  {showPreviewLabelIfu && (
                    <div className="mt-3 p-3 rounded-xl border-2 border-sky-600 bg-white dark:bg-slate-950 space-y-3 text-xs">
                      <div className="font-bold text-sky-900 dark:text-sky-300 uppercase">
                        Bản Xem Trước Mẫu Thiết Kế Nhãn &amp; Tờ Hướng Dẫn Sử Dụng (IFU) — Tự Động Ghép Số Lô Khi In Theo PO
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="p-3 border-2 border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-900 space-y-1">
                          <div className="font-bold border-b border-slate-300 pb-1 flex justify-between">
                            <span>NHÃN HỘP NGOÀI ({labelIfuForm.label_template_code})</span>
                            <span className="px-1.5 py-0.5 rounded bg-slate-900 text-white font-mono text-[10px]">IVD</span>
                          </div>
                          <div className="font-bold text-sm text-sky-800 dark:text-sky-300">{bomDetail.bom.product_name}</div>
                          <div className="grid grid-cols-2 gap-1 font-mono text-[11px] pt-1">
                            <div>REF: {bomDetail.bom.product_code}</div>
                            <div>LOT: [Tự điền theo PO]</div>
                            <div>MFG: [Tự điền theo PO]</div>
                            <div>EXP: [MFG + {bomDetail.bom.shelf_life_days} ngày]</div>
                            <div>QUY CÁCH: {bomDetail.bom.tests_per_kit} Tests</div>
                            <div>UDI: {labelIfuForm.udi_di}</div>
                          </div>
                        </div>
                        <div className="p-3 border border-emerald-600 rounded-lg bg-emerald-50/40 dark:bg-emerald-950/20 space-y-1">
                          <div className="font-bold text-emerald-900 dark:text-emerald-200 border-b border-emerald-300 pb-1 flex justify-between">
                            <span>TỜ HƯỚNG DẪN SỬ DỤNG ({labelIfuForm.ifu_code})</span>
                            <span className="font-mono text-[11px]">{labelIfuForm.ifu_version}</span>
                          </div>
                          <div><b>Mục đích:</b> {labelIfuForm.ifu_intended_use}</div>
                          <div><b>Chu kỳ nhiệt qPCR:</b> {labelIfuForm.ifu_thermal_profile}</div>
                          <div><b>Kênh đọc:</b> {labelIfuForm.ifu_channels}</div>
                          <div><b>Phiên giải Ct:</b> {labelIfuForm.ifu_interpretation}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </Card>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className={`${routingDetail ? "lg:col-span-5" : "lg:col-span-12"} space-y-4`}>
            <Card
              title="Danh sách phiên bản Routing"
              actions={
                <Button onClick={() => setShowCreateRouting((v) => !v)}>
                  {showCreateRouting ? "Đóng form tạo Routing" : "+ Tạo quy trình Routing mới"}
                </Button>
              }
            >
              {showCreateRouting && (
                <form onSubmit={handleCreateRouting} className="mb-4 p-3.5 rounded-xl border border-stone-200 dark:border-slate-800 bg-stone-50/70 dark:bg-slate-950/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-stone-800 dark:text-slate-200">Tạo quy trình công đoạn (Routing) mới</span>
                    <Button type="button" variant="ghost" onClick={() => setShowCreateRouting(false)}>
                      Hủy
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Field label="Phòng Sản xuất Kit">
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
                    <Field label="Sản phẩm Kit / Bán TP">
                      <select
                        className={inputClass}
                        value={rtForm.product_item_id}
                        onChange={(e) => setRtForm({ ...rtForm, product_item_id: e.target.value })}
                        required
                      >
                        <option value="">-- Chọn sản phẩm --</option>
                        {kitProducts.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.code} — {i.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label="Tên quy trình công đoạn">
                    <input
                      className={inputClass}
                      placeholder="VD: Quy trình pha chế, chiết rót & đóng gói Kit PCR"
                      value={rtForm.name}
                      onChange={(e) => setRtForm({ ...rtForm, name: e.target.value })}
                      required
                    />
                  </Field>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => setShowCreateRouting(false)}>
                      Đóng
                    </Button>
                    <Button type="submit">Khởi tạo Routing (DRAFT)</Button>
                  </div>
                </form>
              )}
              {routings.length === 0 ? (
                <Empty>Chưa có quy trình công đoạn nào. Nhấn &ldquo;+ Tạo quy trình Routing mới&rdquo; ở góc phải trên để khởi tạo.</Empty>
              ) : (
                <Table head={["Mã Routing", "Sản phẩm", "Ver", "Số bước", "Trạng thái"]}>
                  {routings.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedRoutingId(r.id)}
                      className={`cursor-pointer hover:bg-amber-50/60 ${selectedRoutingId === r.id ? "bg-amber-50" : ""}`}
                    >
                      <td className="px-3 py-2 font-mono text-xs font-semibold">{r.code}</td>
                      <td className="px-3 py-2 text-xs">
                        <div className="font-medium text-stone-800">{r.product_code}</div>
                        <div className="text-stone-500">{r.name}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">v{r.routing_version}</td>
                      <td className="px-3 py-2 text-xs">{r.step_count} bước</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={r.status} />
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          </div>

          {routingDetail && (
            <div className="lg:col-span-7 space-y-4">
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
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      variant="ghost"
                      onClick={() => handleLoadStandardSteps(routingDetail.routing.id)}
                    >
                      ⚡ Nạp mẫu 4 bước công đoạn chuẩn Kit PCR
                    </Button>
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
              </Card>

              <Card
                title={`Các bước công đoạn chuẩn (${routingDetail.steps.length} bước — Tự động sinh Hồ sơ lô EBR khi chạy PO)`}
                actions={
                  <div className="flex flex-wrap gap-1.5">
                    {routingDetail.routing.status === "DRAFT" && (
                      <Button variant="ghost" onClick={() => setShowAddStep((v) => !v)}>
                        {showAddStep ? "Đóng form thêm bước" : "+ Thêm bước thủ công"}
                      </Button>
                    )}
                  </div>
                }
              >
                {routingDetail.steps.length === 0 ? (
                  <Empty>Chưa có bước công đoạn nào.</Empty>
                ) : (
                  <Table head={["Thứ tự", "Mã & Tên công đoạn", "Nhóm", "SOP / Thiết bị", "Thông số kiểm soát", "Chữ ký"]}>
                    {routingDetail.steps.map((s: any) => (
                      <tr key={s.id}>
                        <td className="px-3 py-2 font-mono text-xs font-bold">{s.seq}</td>
                        <td className="px-3 py-2 text-xs">
                          <div className="font-semibold text-stone-800">
                            {s.step_code} — {s.step_name}
                          </div>
                          <div className="text-stone-500">{s.instructions}</div>
                        </td>
                        <td className="px-3 py-2 text-xs">{STEP_CATEGORY_LABELS[s.category] ?? s.category}</td>
                        <td className="px-3 py-2 text-xs">
                          {s.sop_doc_code && <div className="font-mono">{s.sop_doc_code}</div>}
                          {s.asset_code && <div className="text-stone-500">TB: {s.asset_code}</div>}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {(s.param_schema || []).map((p: any) => (
                            <div key={p.key}>
                              {p.label}: [{p.min ?? "-"} .. {p.max ?? "-"}] {p.unit}
                            </div>
                          ))}
                        </td>
                        <td className="px-3 py-2 text-xs space-y-1">
                          <div>{s.requires_check_signature ? "Thực hiện + Kiểm tra chéo" : "Thực hiện"}</div>
                          {s.is_qc && (
                            <span
                              title="Bước Kiểm soát Chất lượng Trung gian Xen kẽ (IPQC Gate): Các bước phía sau trong Hồ sơ lô (EBR) sẽ tự động khóa cho tới khi bước này được QA/QC xác nhận thông qua"
                              className="inline-block px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-bold text-[10px]"
                            >
                              🛡️ Bước QC xen kẽ (Cần QC xác nhận thông qua)
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Table>
                )}

                {routingDetail.routing.status === "DRAFT" && showAddStep && (
                  <form onSubmit={handleAddRoutingStep} className="mt-4 pt-3 border-t border-stone-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-stone-700">Thêm bước công đoạn vào Routing</div>
                      <Button type="button" variant="ghost" onClick={() => setShowAddStep(false)}>
                        Đóng
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                      <Field label="Thứ tự (seq)">
                        <input
                          type="number"
                          className={inputClass}
                          value={stepForm.seq}
                          onChange={(e) => setStepForm({ ...stepForm, seq: e.target.value })}
                          required
                        />
                      </Field>
                      <Field label="Mã bước">
                        <input
                          className={inputClass}
                          value={stepForm.step_code}
                          onChange={(e) => setStepForm({ ...stepForm, step_code: e.target.value })}
                          required
                        />
                      </Field>
                      <Field label="Tên công đoạn">
                        <input
                          className={inputClass}
                          value={stepForm.step_name}
                          onChange={(e) => setStepForm({ ...stepForm, step_name: e.target.value })}
                          required
                        />
                      </Field>
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
                    </div>
                    <Field label="Hướng dẫn thao tác chuẩn">
                      <input
                        className={inputClass}
                        value={stepForm.instructions}
                        onChange={(e) => setStepForm({ ...stepForm, instructions: e.target.value })}
                        required
                      />
                    </Field>
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                      <Field label="Mã SOP">
                        <input
                          className={inputClass}
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
                      <Field label="Thông số đo (key / nhãn)">
                        <div className="flex gap-1">
                          <input
                            className={inputClass}
                            placeholder="key"
                            value={stepForm.param_key}
                            onChange={(e) => setStepForm({ ...stepForm, param_key: e.target.value })}
                          />
                          <input
                            className={inputClass}
                            placeholder="Nhãn"
                            value={stepForm.param_label}
                            onChange={(e) => setStepForm({ ...stepForm, param_label: e.target.value })}
                          />
                        </div>
                      </Field>
                      <Field label="Ngưỡng Min / Max">
                        <div className="flex gap-1">
                          <input
                            type="number"
                            step="any"
                            className={inputClass}
                            placeholder="Min"
                            value={stepForm.param_min}
                            onChange={(e) => setStepForm({ ...stepForm, param_min: e.target.value })}
                          />
                          <input
                            type="number"
                            step="any"
                            className={inputClass}
                            placeholder="Max"
                            value={stepForm.param_max}
                            onChange={(e) => setStepForm({ ...stepForm, param_max: e.target.value })}
                          />
                        </div>
                      </Field>
                      <Field label="Đơn vị thông số">
                        <input
                          className={inputClass}
                          value={stepForm.param_unit}
                          onChange={(e) => setStepForm({ ...stepForm, param_unit: e.target.value })}
                        />
                      </Field>
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex gap-4 text-xs text-stone-700">
                        <label className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={stepForm.requires_check_signature}
                            onChange={(e) => setStepForm({ ...stepForm, requires_check_signature: e.target.checked })}
                          />
                          Yêu cầu chữ ký kiểm tra chéo (Checked)
                        </label>
                        <label
                          className="flex items-center gap-1 font-semibold text-amber-900 dark:text-amber-300"
                          title="Nếu bật: Khi triển khai sản xuất theo PO, các bước phía sau sẽ tự động khóa cho đến khi bộ phận QA/QC xác nhận thông qua bước kiểm soát trung gian (IPQC) này"
                        >
                          <input
                            type="checkbox"
                            checked={stepForm.is_qc}
                            onChange={(e) => setStepForm({ ...stepForm, is_qc: e.target.checked })}
                          />
                          🛡️ Bước QC xen kẽ (Cần QC xác nhận thông qua để chạy bước kế tiếp)
                        </label>
                        <label className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={stepForm.allow_skip}
                            onChange={(e) => setStepForm({ ...stepForm, allow_skip: e.target.checked })}
                          />
                          Cho phép bỏ qua có duyệt
                        </label>
                      </div>
                      <Button type="submit">Lưu bước công đoạn</Button>
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

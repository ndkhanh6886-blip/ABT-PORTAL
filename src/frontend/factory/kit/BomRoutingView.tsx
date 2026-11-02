"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActionBar } from "../actions";
import { api, fmtQty } from "../api";
import { printElementHtml } from "../coa";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { ACTION_LABELS, CONTAINER_LABELS, type KitOptions, ROLE_LABELS, STEP_CATEGORY_LABELS } from "./shared";
import {
  KitLabelStudio,
  VisualLabelCanvas,
  normalizeLabelBundle,
  type KitLabelDesignBundle,
  type LabelSampleData,
} from "./KitLabelStudio";

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
  const [bomTypeTab, setBomTypeTab] = useState<"ALL" | "finished_good" | "semi_finished">("ALL");
  const [bomCategoryFilter, setBomCategoryFilter] = useState<string>("");
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
    name: "",
    bom_type: "finished_good" as "finished_good" | "semi_finished",
    bom_category: "PCR Kit",
    parent_item_code: "",
    tccs_code: "TCCS 01:2026/ABT",
    tccs_file_name: "",
    tccs_file_url: "",
    registration_no: "2400189/ĐKLH-BYT-TB-CT",
    responsible_person_name: (options as any).kit_staff?.[0]?.display_name ?? "",
    qc_assignee_name: (options as any).qa_staff?.[0]?.display_name ?? "",
    specification: "Hộp 50 test",
    storage_condition: "-20°C ± 2°C",
    tests_per_kit: "50",
    shelf_life_months: "12",
    shelf_life_days: "365",
    qc_retention_qty: "1",
    ph_min: "",
    ph_max: "",
    clone_from_bom_id: "",
  });

  const [editHeaderForm, setEditHeaderForm] = useState({
    name: "",
    bom_type: "finished_good" as "finished_good" | "semi_finished",
    bom_category: "PCR Kit",
    parent_item_code: "",
    tccs_code: "",
    tccs_file_name: "",
    tccs_file_url: "",
    registration_no: "",
    responsible_person_name: "",
    qc_assignee_name: "",
    specification: "",
    storage_condition: "",
    tests_per_kit: "50",
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
        const isSemi = d.bom.bom_type === "semi_finished" || d.bom.product_type === "SEMI_FINISHED";
        const baseCode = String(d.bom.product_code || "").replace(/\.D\.IC$/i, "");
        setEditHeaderForm({
          name: d.bom.name ?? "",
          bom_type: isSemi ? "semi_finished" : "finished_good",
          bom_category: d.bom.bom_category ?? "PCR Kit",
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

        setLabelIfuForm({
          label_template_code: d.bom.label_template_code ?? `LBL-${d.bom.product_code}-V1`,
          label_dimensions:
            d.bom.label_dimensions ??
            (isSemi
              ? "Nhãn Chai/Can BTP: 70×40 mm · Nhãn Ống lưu mẫu: 35×15 mm"
              : "Nhãn Hộp ngoài: 100×50 mm · Nhãn Hộp phụ: 80×40 mm · Nhãn Ống 1.5mL: 35×15 mm (3 tem/hàng)"),
          udi_di: d.bom.udi_di ?? "(01)08936192830117",
          ifu_code: d.bom.ifu_code ?? `IFU-${baseCode}`,
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
              storage: d.bom.storage_condition || "-20°C ± 2°C",
              tccsCode: d.bom.tccs_code || "TCCS 01:2026/ABT",
            },
            isSemi
          )
        );
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
          name: bomForm.name,
          bom_type: bomForm.bom_type,
          bom_category: bomForm.bom_category,
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
            <div style="font-size: 11px; font-weight: bold; color: #0284c7;">CÔNG TY TNHH GIẢI PHÁP Y SINH ABT (ABT BIOLAB SOLUTIONS)</div>
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
      await loadBomDetail(selectedBomId);
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
                    onClick={() => setBomTypeTab("finished_good")}
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
                    onClick={() => setBomTypeTab("semi_finished")}
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
                    onClick={() => setBomTypeTab("ALL")}
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
                      onClick={() => setBomCategoryFilter(cat.k)}
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

              <div className="flex gap-2 mb-3">
                <input
                  className={inputClass}
                  placeholder="Tìm mã BOM, tên công thức, mã SP, số TCCS, người phụ trách..."
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
                return (
                  <Table head={["Mã BOM & Phân loại", "Sản phẩm & Truy xuất tự động", "Ver", "Số dòng", "Trạng thái"]}>
                    {filteredBoms.map((b) => {
                      const isSemi = (b.bom_type || (b.product_type === "SEMI_FINISHED" ? "semi_finished" : "finished_good")) === "semi_finished";
                      return (
                        <tr
                          key={b.id}
                          onClick={() => setSelectedBomId(b.id)}
                          className={`cursor-pointer hover:bg-sky-500/10 ${selectedBomId === b.id ? "bg-sky-500/15" : ""}`}
                        >
                          <td className="px-3 py-2 text-xs">
                            <div className="font-mono font-bold text-sky-400">{b.code}</div>
                            <span
                              className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                isSemi ? "bg-amber-500/20 text-amber-300" : "bg-emerald-500/20 text-emerald-300"
                              }`}
                            >
                              {isSemi ? "🧪 Bán thành phẩm" : "📦 Thành phẩm"}
                            </span>
                            <div className="text-[10px] text-slate-400 mt-0.5">{b.bom_category || "PCR Kit"}</div>
                          </td>
                          <td className="px-3 py-2 text-xs">
                            <div className="font-bold text-slate-100">
                              {b.product_code}
                              {b.parent_item_code && (
                                <span className="ml-1.5 px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-mono text-[10px]">
                                  Mã chính: {b.parent_item_code}
                                </span>
                              )}
                            </div>
                            <div className="text-slate-400 line-clamp-1">{b.name}</div>
                            <div className="flex flex-wrap gap-2 mt-1 text-[10px] text-slate-300">
                              {b.tccs_code && <span className="font-mono text-sky-300">📜 {b.tccs_code}</span>}
                              {b.responsible_person_name && <span>👤 {b.responsible_person_name}</span>}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs font-mono">v{b.bom_version}</td>
                          <td className="px-3 py-2 text-xs font-mono">{b.line_count ?? 0}</td>
                          <td className="px-3 py-2">
                            <StatusBadge status={b.status} />
                          </td>
                        </tr>
                      );
                    })}
                  </Table>
                );
              })()}
            </Card>
          </div>

          {bomDetail && (
            <div className="lg:col-span-7 space-y-4">
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
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 p-3 rounded-xl bg-slate-900/70 border border-slate-800 text-xs mb-3">
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
                        "Định mức (Thường / Chia sẵn .D.IC)",
                        "Hao hụt",
                        "Cấu hình Nổ BOM (Demo / Lưu QC / Thay thế)",
                        "Thao tác",
                      ]}
                    >
                      {bomDetail.lines.map((l: any) => (
                        <tr key={l.id} className={editingLineId === l.id ? "bg-sky-50/70 dark:bg-sky-950/30" : ""}>
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
                          <td className="px-3 py-2 text-xs whitespace-nowrap">
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
                      ))}
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
                              ⚡ Tự nạp {bomDetail.lines.length} quy cách Ống/Chai từ danh sách BOM
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
                    <Table head={["Hộp", "Tên ống / thành phần", "Loại bao bì", "Thể tích nạp", "Số ống/Kit", "Bảo quản", "Thao tác"]}>
                      {bomDetail.packaging.map((pk: any) => (
                        <tr key={pk.id} className={editingPackId === pk.id ? "bg-sky-50/70 dark:bg-sky-950/30" : ""}>
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
                  const sampleData: LabelSampleData = {
                    productName: bomDetail.bom.product_name,
                    productCode: bomDetail.bom.product_code,
                    specification: bomDetail.bom.specification || (isSemi ? `Lô chuẩn ${bomDetail.bom.base_qty} ${bomDetail.bom.base_uom}` : `Hộp ${bomDetail.bom.tests_per_kit || 50} test`),
                    quantity: isSemi ? `${bomDetail.bom.base_qty} ${bomDetail.bom.base_uom}` : `${bomDetail.bom.tests_per_kit || 50} Tests`,
                    storage: bomDetail.bom.storage_condition || "-20°C ± 2°C",
                    mfgDate: "01/11/2026",
                    expDate: "01/11/2027",
                    lotNumber: `LOT-${String(bomDetail.bom.product_code || "KIT").replace(/[^A-Z0-9]/gi, "").slice(0, 6)}-2611`,
                    manufacturer: "CÔNG TY TNHH GIẢI PHÁP Y SINH ABT (ABT BIOLAB)",
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
                      title={`3. Thiết kế Mẫu Nhãn Trực Quan (Visual Label Artwork) & Tài liệu HDSD Đính Kèm (IFU — ${bomDetail.bom.ifu_code ?? "IFU"})`}
                      actions={
                        <div className="flex flex-wrap gap-1.5">
                          <Button variant="secondary" onClick={() => setShowLabelStudio((v) => !v)}>
                            {showLabelStudio ? "Đóng Studio Thiết kế Nhãn" : "🎨 Mở Studio Thiết Kế Nhãn Hiện Đại (Kéo thả & ISO/IVD)"}
                          </Button>
                          <Button variant="ghost" onClick={() => setShowEditLabelIfu((v) => !v)}>
                            {showEditLabelIfu ? "Đóng cấu hình IFU" : "⚙️ Sửa thông số UDI / Chu kỳ nhiệt IFU"}
                          </Button>
                        </div>
                      }
                    >
                      {/* PHẦN A: FILE ĐÍNH KÈM HƯỚNG DẪN SỬ DỤNG (IFU) ĐỂ TRUY XUẤT & IN KHI SẢN XUẤT */}
                      <div className="mb-4 p-3.5 rounded-xl border border-emerald-500/35 bg-emerald-950/15 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-xs font-extrabold text-emerald-300 uppercase">
                              📎 Tài Liệu Hướng Dẫn Sử Dụng Đính Kèm Theo BOM (Truy xuất tự động &amp; In ngay tại xưởng sản xuất)
                            </div>
                            <div className="text-[11px] text-slate-400">
                              Khi tạo Lệnh sản xuất (Thường hoặc Chia sẵn .D.IC), hệ thống tự động lấy đúng file HDSD đính kèm dưới đây để nhân viên sản xuất xem và in đóng vào hộp Kit.
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {/* File 1: HDSD Mặc định */}
                          <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 flex flex-col justify-between gap-2">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                                  📄 1. FILE HDSD TIÊU CHUẨN (MẶC ĐỊNH)
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

                          {/* File 2: HDSD Dạng chia sẵn (.D.IC) */}
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
                                  Tự động kích hoạt khi PO đặt hàng dạng chia sẵn (.D.IC) · {labelIfuForm.ifu_aliquoted_file_size || "452 KB"}
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
                        </div>
                      </div>

                      {/* PHẦN B: HÌNH ẢNH MẪU NHÃN TRỰC QUAN LUÔN HIỂN THỊ (LIVE VISUAL ARTWORK PREVIEW) */}
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
                            <Button variant="primary" onClick={() => setShowLabelStudio((v) => !v)}>
                              {showLabelStudio ? "Thu gọn Trình thiết kế" : "🎨 Tùy chỉnh / Kéo thả Thiết kế Nhãn"}
                            </Button>
                          </div>
                        </div>

                        <div
                          ref={labelPreviewRef}
                          className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-center p-3 rounded-lg bg-slate-950/80 border border-slate-800 overflow-x-auto"
                        >
                          {/* Nhãn Hộp Ngoài / Chai BTP */}
                          <div className="xl:col-span-7 flex flex-col items-center gap-2">
                            <div className="text-[11px] font-bold text-sky-300">
                              📦 {labelBundle.outer_box.name} ({labelBundle.outer_box.width_mm}×{labelBundle.outer_box.height_mm} mm)
                            </div>
                            <VisualLabelCanvas
                              config={labelBundle.outer_box}
                              sample={sampleData}
                              scale={labelBundle.outer_box.width_mm >= 90 ? 3.5 : 4.2}
                              interactive={false}
                            />
                          </div>

                          {/* Nhãn Ống Thành Phần (3 tem/hàng) & Các Nhãn Thành Phần Bổ Sung */}
                          <div className="xl:col-span-5 flex flex-col items-center gap-2">
                            <div className="text-[11px] font-bold text-emerald-300">
                              🧪 Ống 1: {labelBundle.tube.extra_text || labelBundle.tube.name} ({labelBundle.tube.width_mm}×{labelBundle.tube.height_mm} mm)
                            </div>
                            <div className="flex flex-wrap justify-center gap-2">
                              {Array.from({ length: Math.min(2, labelBundle.tube.labels_per_row || 2) }).map((_, idx) => (
                                <VisualLabelCanvas
                                  key={idx}
                                  config={labelBundle.tube}
                                  sample={sampleData}
                                  scale={4.0}
                                  interactive={false}
                                />
                              ))}
                            </div>
                            {(labelBundle.extra_components || []).map((ext, extIdx) => (
                              <div key={`ext-prev-${extIdx}`} className="flex flex-col items-center gap-1 pt-2 border-t border-slate-800 w-full">
                                <div className="text-[11px] font-bold text-teal-300">
                                  🧪 Thành phần #{extIdx + 2}: {ext.extra_text || ext.name} ({ext.width_mm}×{ext.height_mm} mm)
                                </div>
                                <div className="flex flex-wrap justify-center gap-2">
                                  {Array.from({ length: Math.min(2, ext.labels_per_row || 1) }).map((_, idx) => (
                                    <VisualLabelCanvas
                                      key={idx}
                                      config={ext}
                                      sample={sampleData}
                                      scale={ext.width_mm <= 45 ? 4.0 : 3.2}
                                      interactive={false}
                                    />
                                  ))}
                                </div>
                              </div>
                            ))}
                            <div className="text-[10px] text-slate-400">
                              Khổ cuộn in nhiệt: {labelBundle.tube.labels_per_row} tem/hàng (Khoảng cách ngang {labelBundle.tube.label_gap_mm}mm)
                            </div>
                          </div>
                        </div>
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
                      className={`cursor-pointer transition-colors hover:bg-sky-50/80 dark:hover:bg-sky-950/40 ${
                        selectedRoutingId === r.id ? "bg-sky-100/80 dark:bg-sky-900/50" : ""
                      }`}
                    >
                      <td className="px-3 py-2 font-mono text-xs font-bold text-sky-700 dark:text-sky-300">{r.code}</td>
                      <td className="px-3 py-2 text-xs">
                        <div className="font-semibold text-slate-800 dark:text-slate-100">{r.product_code}</div>
                        <div className="text-slate-500 dark:text-slate-400">{r.name}</div>
                      </td>
                      <td className="px-3 py-2 text-xs font-mono text-slate-700 dark:text-slate-200">v{r.routing_version}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200">{r.step_count} bước</td>
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
                    {routingDetail.routing.status !== "OBSOLETE" && (
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
                          <div className="font-semibold text-slate-800 dark:text-slate-100">
                            {s.step_code} — {s.step_name}
                          </div>
                          <div className="text-slate-500 dark:text-slate-400">{s.instructions}</div>
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

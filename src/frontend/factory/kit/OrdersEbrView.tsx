"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
import { ActionBar } from "../actions";
import { api, fmtDate, fmtDateTime, fmtQty, vnToday } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import {
  ABT_KIT_SUPPLY_FORMS,
  ABT_TUBE_STRIP_CATALOG,
  ACTION_LABELS,
  buildAbtKitLotCode,
  type KitOptions,
  parseAbtKitLotCode,
  ROLE_LABELS,
  STEP_CATEGORY_LABELS,
} from "./shared";
import { ProductionPlanView } from "./ProductionPlanView";

const SHIFT_LABELS: Record<string, string> = {
  CA_SANG: "🌅 Ca sáng (07:30–16:30)",
  CA_CHIEU: "🌇 Ca chiều (13:30–21:30)",
  CA_TOI: "🌙 Ca tối / Tăng ca",
};

const PRESET_OPERATORS: string[] = [];

function buildScannableQrSvg(payload: string): string {
  try {
    const qr = QRCode.create(payload || "ABT-KIT", { errorCorrectionLevel: "M" });
    const size = qr.modules.size;
    const data = qr.modules.data;
    let d = "";
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (data[r * size + c]) d += `M${c + 1},${r + 1}h1v1h-1z`;
      }
    }
    return `<svg viewBox="0 0 ${size + 2} ${size + 2}" shape-rendering="crispEdges" style="width:16mm;height:16mm;border:1px solid #0f172a;display:block;background:#fff"><rect width="${size + 2}" height="${size + 2}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  } catch {
    return "";
  }
}

function buildScannableCode128Svg(payload: string): string {
  if (typeof document === "undefined") return "";
  try {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    JsBarcode(svg, payload || "ABT-KIT", {
      format: "CODE128",
      displayValue: false,
      height: 26,
      width: 1.2,
      margin: 0,
      lineColor: "#000000",
      background: "#ffffff",
    });
    svg.setAttribute("style", "height:24px;max-width:66mm;display:block");
    return svg.outerHTML;
  } catch {
    return "";
  }
}

export function OrdersEbrView({ options, onRefreshOptions }: { options: KitOptions; onRefreshOptions: () => void }) {
  const [viewMode, setViewMode] = useState<"EBR" | "DAILY_TRACKER" | "PLAN">("PLAN");
  const [orders, setOrders] = useState<any[]>([]);
  const [dailySteps, setDailySteps] = useState<any[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [detail, setDetail] = useState<any | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [showCreateOrder, setShowCreateOrder] = useState(false);
  const [showSplitForm, setShowSplitForm] = useState(false);
  const [showReworkForm, setShowReworkForm] = useState(false);
  const [dailyShiftFilter, setDailyShiftFilter] = useState<string>("ALL");
  const [dailyStatusFilter, setDailyStatusFilter] = useState<string>("ALL");
  const [dailySearch, setDailySearch] = useState<string>("");
  const [qcGateNotes, setQcGateNotes] = useState<Record<string, string>>({});
  const [operatorEdits, setOperatorEdits] = useState<Record<string, { assigned_to_name: string; shift_code: string; planned_date: string }>>({});

  const [orderForm, setOrderForm] = useState({
    org_unit_id: options.units[0]?.id ?? "",
    internal_order_line_id: "",
    product_item_id: "",
    bom_id: "",
    warehouse_id: options.warehouses[0]?.id ?? "",
    planned_qty: "100",
    supply_form: "NO_SPLIT_NO_IC",
    tube_code: "T02",
    is_demo: false,
    order_mode: "STANDARD" as "STANDARD" | "ALIQUOTED" | "DEMO",
    demo_specification: "25 test",
    qc_retention_qty: "2",
    no_retention: false,
    lot_code: "",
    mfg_date: vnToday(),
    priority: "NORMAL",
    notes: "",
  });

  const [lotEditForm, setLotEditForm] = useState({
    lot_code: "",
    mfg_date: "",
  });

  const [splitForm, setSplitForm] = useState({
    child_lot_code: "",
    split_qty: "10",
    mfg_date: "",
    reason: "Tách lô thành phẩm giao đơn hàng lẻ / mẫu đối chứng",
  });
  const [showBomExplosion, setShowBomExplosion] = useState(false);
  const [showProductionWorksheet, setShowProductionWorksheet] = useState(false);
  const [showLabelSheet, setShowLabelSheet] = useState(false);
  const didAutoSelectRef = useRef(false);

  const [stepParams, setStepParams] = useState<Record<string, Record<string, string>>>({});
  const [reconciliationNote, setReconciliationNote] = useState("");
  const [qcForm, setQcForm] = useState({
    good_qty: "",
    scrap_qty: "0",
    sample_qty: "2",
    retain_qty: "2",
    qc_summary: "Đạt các chỉ tiêu QC độ nhạy & độ đặc hiệu",
  });

  const [rwForm, setRwForm] = useState({
    scope: "PARTIAL",
    box_no: "1",
    component_item_id: "",
    qty_to_rework: "10",
    uom: "",
    instructions: "Thay thế lô ống thành phần trong Hộp bị lỗi và kiểm tra lại QC.",
  });

  const loadOrders = useCallback(async () => {
    setError(null);
    try {
      const res = await api<{ orders: any[]; daily_steps?: any[] }>("/api/factory/kit/orders");
      setOrders(res.orders);
      setDailySteps(res.daily_steps ?? []);
      if (!didAutoSelectRef.current && res.orders[0]?.id) {
        didAutoSelectRef.current = true;
        setSelectedOrderId(res.orders[0].id);
      }
    } catch (e) {
      setError(e);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const d = await api<any>(`/api/factory/kit/orders/${id}`);
      setDetail(d);
      setReconciliationNote(d.order.reconciliation_note ?? "");
      setLotEditForm({
        lot_code: d.order.lot_code ?? "",
        mfg_date: d.order.mfg_date ? String(d.order.mfg_date).slice(0, 10) : vnToday(),
      });
      setQcForm((p) => ({ ...p, good_qty: String(d.order.good_qty ?? d.order.planned_qty) }));
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (selectedOrderId) loadDetail(selectedOrderId);
  }, [selectedOrderId, loadDetail]);

  const kitProducts = options.items.filter((i) => ["FINISHED_KIT", "SEMI_FINISHED"].includes(i.item_type));
  const deptOperatorOptions = React.useMemo(() => {
    const kitList = (options.kit_staff ?? []).map((s) => s.label);
    const qaList = (options.qa_staff ?? []).map((s) => s.label);
    const merged = Array.from(new Set([...kitList, ...qaList]));
    return merged.length > 0 ? merged : PRESET_OPERATORS;
  }, [options.kit_staff, options.qa_staff]);

  /** Điền sẵn form Phát hành Lệnh sản xuất theo dòng PO (dùng cho chọn PO và nút "Lập kế hoạch" từ Bảng kế hoạch). */
  const prefillFromPoLine = (lineId: string) => {
    const poLine = (options.po_lines ?? []).find((p) => p.line_id === lineId);
    setOrderForm((prev) => {
      if (!poLine) return { ...prev, internal_order_line_id: "" };
      const matchedItem =
        kitProducts.find((x) => x.id === poLine.item_id) ?? kitProducts.find((x) => x.code === poLine.item_code);
      const autoAliq = Boolean(poLine.item_code?.toUpperCase().includes(".D.IC"));
      const remQty = Math.max(1, Number(poLine.qty_ordered || 100) - Number(poLine.qty_delivered || 0));
      return {
        ...prev,
        internal_order_line_id: lineId,
        product_item_id: matchedItem?.id ?? prev.product_item_id,
        planned_qty: String(remQty),
        order_mode: autoAliq ? "ALIQUOTED" : "STANDARD",
        notes: `Sản xuất theo PO ${poLine.kd_po_code} (Đơn nội bộ ${poLine.internal_order_code})`,
      };
    });
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const sfSpec = ABT_KIT_SUPPLY_FORMS[orderForm.supply_form] || ABT_KIT_SUPPLY_FORMS.NO_SPLIT_NO_IC;
      const effectiveMode = orderForm.is_demo ? "DEMO" : sfSpec.is_aliquoted ? "ALIQUOTED" : "STANDARD";
      const res = await api<{ order: any }>("/api/factory/kit/orders", {
        method: "POST",
        idempotent: true,
        json: {
          org_unit_id: orderForm.org_unit_id || options.units[0]?.id,
          product_item_id: orderForm.product_item_id,
          bom_id: orderForm.bom_id || null,
          warehouse_id: orderForm.warehouse_id || options.warehouses[0]?.id,
          planned_qty: Number(orderForm.planned_qty),
          supply_form: orderForm.supply_form,
          tube_code: orderForm.tube_code || null,
          order_mode: effectiveMode,
          is_aliquoted: sfSpec.is_aliquoted,
          is_demo: orderForm.is_demo,
          demo_specification: orderForm.is_demo ? orderForm.demo_specification : null,
          qc_retention_qty: orderForm.no_retention ? 0 : Number(orderForm.qc_retention_qty || 0),
          no_retention: orderForm.no_retention,
          lot_code: orderForm.lot_code.trim() || null,
          mfg_date: orderForm.mfg_date || null,
          priority: orderForm.priority,
          internal_order_line_id: orderForm.internal_order_line_id || null,
          notes: orderForm.notes || null,
        },
      });
      setOrderForm((p) => ({ ...p, lot_code: "" }));
      setShowCreateOrder(false);
      setSelectedOrderId(res.order.id);
      await loadOrders();
      await loadDetail(res.order.id);
      onRefreshOptions();
    } catch (err) {
      setError(err);
    }
  };

  const handleSplitLot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrderId) return;
    setError(null);
    try {
      await api(`/api/factory/kit/orders/${selectedOrderId}`, {
        method: "POST",
        json: {
          operation: "split_lot",
          child_lot_code: splitForm.child_lot_code.trim() || null,
          split_qty: Number(splitForm.split_qty),
          mfg_date: splitForm.mfg_date || null,
          reason: splitForm.reason || null,
        },
      });
      setSplitForm((p) => ({ ...p, child_lot_code: "" }));
      setShowSplitForm(false);
      await loadDetail(selectedOrderId);
      await loadOrders();
      onRefreshOptions();
    } catch (err) {
      setError(err);
    }
  };

  const handleIssueMaterials = async () => {
    if (!selectedOrderId) return;
    setError(null);
    try {
      await api(`/api/factory/kit/orders/${selectedOrderId}`, {
        method: "POST",
        json: { operation: "issue_materials" },
      });
      await loadDetail(selectedOrderId);
      await loadOrders();
      onRefreshOptions();
    } catch (err) {
      setError(err);
    }
  };

  const handlePrintLabel = async () => {
    if (!selectedOrderId) return;
    setError(null);
    try {
      await api(`/api/factory/kit/orders/${selectedOrderId}`, {
        method: "POST",
        json: { operation: "print_label" },
      });
      await loadDetail(selectedOrderId);
    } catch (err) {
      setError(err);
    }
  };

  /**
   * Mở cửa sổ in Phiếu Sản Xuất & Cấp Phát Nguyên Vật Liệu Theo Lô (Batch Manufacturing Worksheet - ISO 13485)
   * giúp nhân viên sản xuất theo dõi công thức định mức, lượng cần cân/pha, mã lô NVL (FEFO) và các bước công đoạn.
   */
  const printProductionWorksheet = (d: any) => {
    if (!d?.order) return;
    const o = d.order;
    const exploded: any[] = d.exploded_bom || [];
    const cons: any[] = d.consumptions || [];
    const steps: any[] = d.steps || [];
    const packs: any[] = d.packaging || [];
    const poQty = Number(o.planned_qty || 0);
    const retQty = o.no_retention ? 0 : Number(o.qc_retention_qty ?? o.retain_qty ?? 0);
    const modeLabel =
      o.order_mode === "DEMO"
        ? `Kit Demo (${o.demo_specification || "25 test"})`
        : o.order_mode === "ALIQUOTED" || o.is_aliquoted
          ? "Chia sẵn (.D.IC — 48 test)"
          : `Quy cách chuẩn (${o.tests_per_kit || 50} test)`;

    const rowsHtml = (exploded.length > 0 ? exploded : cons).map((item: any, idx: number) => {
      const matchedCons = cons.filter(
        (c: any) => c.bom_line_id === item.bom_line_id || c.item_id === (item.component_item_id ?? item.item_id)
      );
      const lotText =
        matchedCons.length > 0
          ? matchedCons
              .map(
                (c: any) =>
                  `<b>${c.lot_code || "Chưa gán lô"}</b>${c.expiry_date ? ` (HSD: ${fmtDate(c.expiry_date)})` : ""}${c.location_code ? ` [${c.location_code}]` : ""}`
              )
              .join("<br/>")
          : item.lot_code
            ? `<b>${item.lot_code}</b> (HSD: ${fmtDate(item.expiry_date)})`
            : "<i>Theo lô FEFO tại kho</i>";
      const issuedSum = matchedCons.reduce((acc: number, c: any) => acc + Number(c.issued_qty || 0), 0);
      const reqQty = item.required_qty ?? item.planned_qty ?? 0;
      const uom = item.uom || "";
      const roleLabel = ROLE_LABELS[item.component_role] ?? item.component_role ?? "Thành phần";
      return `
        <tr>
          <td style="text-align:center">${idx + 1}</td>
          <td>Hộp ${item.box_no || 1}<br/><span style="font-size:10px;color:#475569">${roleLabel}</span></td>
          <td><b>${item.component_code ?? item.item_code}</b><br/>${item.component_name ?? item.item_name}</td>
          <td style="text-align:right;font-family:monospace">${item.unit_norm !== undefined ? `${fmtQty(item.unit_norm)} ${uom}` : "—"}</td>
          <td style="text-align:right;font-family:monospace;font-weight:700;color:#0c4a6e">${fmtQty(reqQty)} ${uom}</td>
          <td style="font-size:11px">${lotText}</td>
          <td style="text-align:right;font-family:monospace">${issuedSum > 0 ? `${fmtQty(issuedSum)} ${uom}` : o.materials_issued ? `${fmtQty(reqQty)} ${uom}` : "Chờ xuất"}</td>
          <td style="text-align:center">☐ Đã cân/đong</td>
          <td></td>
        </tr>`;
    }).join("");

    const stepsHtml = steps.map((s: any) => {
      const schema: any[] = Array.isArray(s.param_schema) ? s.param_schema : [];
      const vals = s.param_values || {};
      const paramStr =
        schema.length > 0
          ? schema
              .map((f: any) => {
                const v = vals[f.key];
                const range =
                  f.min !== undefined && f.min !== null && f.max !== undefined && f.max !== null
                    ? ` [${f.min}–${f.max} ${f.unit || ""}]`
                    : f.unit
                      ? ` (${f.unit})`
                      : "";
                return `• ${f.label}${range}: <b>${v !== undefined && v !== "" ? v : "................"}</b>`;
              })
              .join("<br/>")
          : "Ghi nhận hoàn thành theo SOP";
      return `
        <tr>
          <td style="text-align:center;font-weight:700">B${s.seq}</td>
          <td><b>${s.step_code} — ${s.step_name}</b><br/><span style="font-size:10px;color:#475569">${s.instructions || ""}</span></td>
          <td>SOP: <b>${s.sop_doc_code || "—"}</b><br/>Thiết bị: ${s.asset_code ? `${s.asset_code} (${s.asset_name})` : "—"}</td>
          <td style="font-size:11px">${paramStr}</td>
          <td>${s.assigned_to_name || s.performed_by_name || "................"}<br/><span style="font-size:10px;color:#475569">${s.status}</span></td>
          <td style="text-align:center">${s.is_qc ? `<b>IPQC GATE</b><br/>(${s.qc_gate_status || "WAITING_QC"})` : "—"}</td>
        </tr>`;
    }).join("");

    const packHtml = packs.map((pk: any, idx: number) => `
      <tr>
        <td style="text-align:center">${idx + 1}</td>
        <td>Hộp ${pk.box_no}: ${pk.box_name}</td>
        <td><b>${pk.component_name}</b> (${pk.tube_code || "Ống chuẩn"})</td>
        <td style="text-align:right;font-family:monospace"><b>${fmtQty(pk.fill_qty)} ${pk.fill_uom}</b> × ${pk.units_per_kit} ống/bộ</td>
        <td style="text-align:right;font-family:monospace;font-weight:700">${(poQty + retQty) * Number(pk.units_per_kit || 1)} ống</td>
        <td style="text-align:center">${pk.storage_temp || "-20°C"}</td>
      </tr>`).join("");

    const w = window.open("", "_blank", "width=1050,height=900");
    if (!w) {
      window.print();
      return;
    }
    w.document.write(`<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8"/>
  <title>Phiếu Sản Xuất ${o.code} - Lô ${o.lot_code}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    body { font-family: "Segoe UI", Arial, sans-serif; color: #0f172a; font-size: 12px; line-height: 1.4; margin: 0; padding: 16px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 12px; }
    .title { text-align: center; margin: 10px 0 14px; }
    .title h1 { font-size: 17px; margin: 0; text-transform: uppercase; letter-spacing: 0.3px; }
    .title p { font-size: 11px; color: #334155; margin: 3px 0 0; }
    .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 14px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px 12px; margin-bottom: 14px; font-size: 11.5px; }
    h2 { font-size: 13px; text-transform: uppercase; background: #e2e8f0; padding: 5px 8px; margin: 14px 0 6px; border-left: 4px solid #0284c7; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 11.5px; }
    th, td { border: 1px solid #94a3b8; padding: 5px 7px; vertical-align: top; }
    th { background: #f1f5f9; font-weight: 700; text-align: left; }
    .sign-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 22px; text-align: center; font-size: 11.5px; }
    .sign-box { border: 1px dashed #94a3b8; border-radius: 6px; padding: 8px 6px 54px; }
    .no-print { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 12px; }
    .btn { background: #0284c7; color: #fff; border: none; padding: 7px 14px; border-radius: 6px; font-weight: 700; cursor: pointer; }
    @media print { .no-print { display: none !important; } body { padding: 0; } }
  </style>
</head>
<body>
  <div class="no-print">
    <button class="btn" onclick="window.print()">🖨️ In Phiếu Sản Xuất (A4)</button>
    <button class="btn" style="background:#475569" onclick="window.close()">Đóng</button>
  </div>
  <div class="header">
    <div>
      <div style="font-weight:800;font-size:13px;color:#0369a1">CÔNG TY TNHH GIẢI PHÁP Y SINH ABT (ABT BIOLOGICAL SOLUTIONS)</div>
      <div style="font-size:11px;color:#475569">Khối Kỹ Thuật & Sản Xuất Sinh Phẩm Chẩn Đoán In-Vitro (IVD) · ISO 13485:2016</div>
    </div>
    <div style="text-align:right;font-family:monospace;font-size:11px">
      <div>Mã biểu mẫu: <b>BM-SX-KIT-01 (Rev 03)</b></div>
      <div>Mã Lệnh SX: <b>${o.code}</b></div>
      <div>Ngày in: ${new Date().toLocaleString("vi-VN")}</div>
    </div>
  </div>
  <div class="title">
    <h1>PHIẾU SẢN XUẤT &amp; CẤP PHÁT NGUYÊN VẬT LIỆU THEO LÔ (BATCH WORKSHEET)</h1>
    <p>Tài liệu đi kèm mẻ sản xuất tại xưởng để pha chế theo định mức BOM, kiểm soát lô nguyên vật liệu FEFO và ghi nhận thông số công đoạn</p>
  </div>
  <div class="meta-grid">
    <div><b>Mã &amp; Tên sản phẩm:</b> ${o.product_code} — ${o.product_name}</div>
    <div><b>Số Lô SX (LOT):</b> <span style="font-family:monospace;font-weight:800;color:#0369a1">${o.lot_code || "—"}</span></div>
    <div><b>NSX / HSD:</b> ${fmtDate(o.mfg_date)} → <b>${fmtDate(o.expiry_date)}</b></div>
    <div><b>Quy mô mẻ (SL Kế hoạch):</b> <b>${fmtQty(poQty)} ${o.uom}</b> (+ Mẫu lưu QC: ${fmtQty(retQty)} ${o.uom})</div>
    <div><b>Chế độ sản xuất:</b> ${modeLabel}</div>
    <div><b>Đơn PO / Đơn nội bộ:</b> ${o.kd_po_code || o.internal_order_code || "Sản xuất kế hoạch"}</div>
    <div><b>Định mức BOM &amp; TCCS:</b> ${o.bom_code} (v${o.bom_version}) · ${o.tccs_code || "TCCS 01:2026/ABT"}</div>
    <div><b>Phụ trách SX / QA Giám sát:</b> ${o.team_lead_name || o.bom_responsible_person_name || "—"} / ${o.qa_assignee_name || o.bom_qc_assignee_name || "—"}</div>
    <div><b>Kho xuất NVL &amp; Trạng thái:</b> ${o.warehouse_code} (${o.materials_issued ? "ĐÃ XUẤT KHO FEFO" : "ĐANG GIỮ CHỖ FEFO"})</div>
  </div>

  <h2>I. BẢNG CÔNG THỨC ĐỊNH MỨC (BOM) &amp; TRUY XUẤT LÔ NGUYÊN VẬT LIỆU SỬ DỤNG (FEFO)</h2>
  <table>
    <thead>
      <tr>
        <th style="width:28px;text-align:center">#</th>
        <th style="width:110px">Hộp / Vai trò</th>
        <th>Mã &amp; Tên Nguyên Vật Liệu / Bán TP</th>
        <th style="width:85px;text-align:right">Định mức/Bộ</th>
        <th style="width:105px;text-align:right">Tổng lượng cần</th>
        <th style="width:190px">Mã Lô NVL (FEFO) &amp; HSD</th>
        <th style="width:90px;text-align:right">Thực xuất</th>
        <th style="width:85px;text-align:center">Tích Cân/Pha</th>
        <th style="width:75px">Ký nháy</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml || '<tr><td colspan="9" style="text-align:center">Chưa có dòng nguyên vật liệu</td></tr>'}
    </tbody>
  </table>

  ${
    packs.length > 0
      ? `<h2>II. QUY CÁCH CHIA ỐNG THÀNH PHẦN (ALIQUOT / FILLING SPECIFICATION)</h2>
  <table>
    <thead>
      <tr>
        <th style="width:28px;text-align:center">#</th>
        <th>Hộp đóng gói</th>
        <th>Tên ống thành phần</th>
        <th style="text-align:right">Thể tích chiết × Số ống/bộ</th>
        <th style="text-align:right">Tổng số ống cần chiết</th>
        <th style="text-align:center">Bảo quản</th>
      </tr>
    </thead>
    <tbody>${packHtml}</tbody>
  </table>`
      : ""
  }

  <h2>III. LƯU ĐỒ CÔNG ĐOẠN SẢN XUẤT (ROUTING / EBR) &amp; KIỂM SOÁT CHẤT LƯỢNG XEN KẼ (IPQC)</h2>
  <table>
    <thead>
      <tr>
        <th style="width:36px;text-align:center">Bước</th>
        <th>Nội dung công đoạn &amp; Hướng dẫn</th>
        <th style="width:140px">SOP &amp; Thiết bị</th>
        <th style="width:210px">Thông số kiểm soát &amp; Kết quả</th>
        <th style="width:125px">Người thực hiện</th>
        <th style="width:95px;text-align:center">Cổng IPQC</th>
      </tr>
    </thead>
    <tbody>
      ${stepsHtml || '<tr><td colspan="6" style="text-align:center">Chưa có công đoạn</td></tr>'}
    </tbody>
  </table>

  <div class="sign-grid">
    <div class="sign-box"><b>THỦ KHO XUẤT NVL</b><br/><span style="font-size:10px;color:#475569">(Ký, ghi rõ họ tên &amp; ngày xuất)</span></div>
    <div class="sign-box"><b>TỔ TRƯỞNG / NGƯỜI PHA CHẾ</b><br/><span style="font-size:10px;color:#475569">${o.team_lead_name || o.bom_responsible_person_name || "(Ký, ghi rõ họ tên)"}</span></div>
    <div class="sign-box"><b>KIỂM SOÁT VIÊN IPQC</b><br/><span style="font-size:10px;color:#475569">${o.qa_assignee_name || o.bom_qc_assignee_name || "(Ký xác nhận thông qua)"}</span></div>
    <div class="sign-box"><b>TRƯỞNG PHÒNG QA/QC</b><br/><span style="font-size:10px;color:#475569">(Phê duyệt Hồ sơ lô BMR)</span></div>
  </div>
</body>
</html>`);
    w.document.close();
    setTimeout(() => w.print(), 250);
  };

  /**
   * Mở cửa sổ in Tem Nhãn Thực Tế (Nhãn Hộp Ngoài 95×65mm + Nhãn Ống Thành Phần 38×19mm)
   * với đầy đủ biểu tượng IVD / ISO 15223-1, mã vạch GS1-128 và QR DataMatrix 2D.
   */
  const printVisualStickersWindow = async (d: any) => {
    if (!d?.order) return;
    if (!d.order.label_printed_at) {
      await handlePrintLabel();
    }
    const o = d.order;
    const packs: any[] = d.packaging || [];
    const poQty = Number(o.planned_qty || 0);
    const retQty = o.no_retention ? 0 : Number(o.qc_retention_qty ?? o.retain_qty ?? 0);
    const totalKits = poQty + retQty;
    const specText =
      o.order_mode === "DEMO"
        ? `DEMO (${o.demo_specification || "25 test"})`
        : o.order_mode === "ALIQUOTED" || o.is_aliquoted
          ? "48 Tests (.D.IC Chia sẵn)"
          : `${o.tests_per_kit || 50} Tests`;
    const udiStr = `${o.udi_di ?? "(01)08936192830117"}(10)${o.lot_code}`;
    const code128Svg = buildScannableCode128Svg(udiStr);
    const qr2dSvg = buildScannableQrSvg(`UDI:${udiStr}|REF:${o.product_code}|LOT:${o.lot_code}|EXP:${o.expiry_date ?? ""}`);

    const tubeCardsHtml = packs
      .map(
        (pk: any) => `
      <div class="tube-sticker">
        <div class="tube-top">
          <span class="brand-mini">ABT® IVD</span>
          <span class="temp-badge">${pk.storage_temp || "-20°C"}</span>
        </div>
        <div class="tube-title">${pk.component_name}</div>
        <div class="tube-sub">REF: ${o.product_code} · Hộp ${pk.box_no}</div>
        <div class="tube-meta">
          <div><b>Vol:</b> ${fmtQty(pk.fill_qty)} ${pk.fill_uom}</div>
          <div><b>LOT:</b> ${o.lot_code}</div>
          <div><b>EXP:</b> ${fmtDate(o.expiry_date)}</div>
          <div><b>SL in:</b> ${totalKits * Number(pk.units_per_kit || 1)} tem</div>
        </div>
      </div>`
      )
      .join("");

    const w = window.open("", "_blank", "width=980,height=860");
    if (!w) {
      window.print();
      return;
    }
    w.document.write(`<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8"/>
  <title>In Tem Nhãn Lô ${o.lot_code} (${o.product_code})</title>
  <style>
    @page { margin: 10mm; }
    body { font-family: "Segoe UI", Arial, sans-serif; background: #f1f5f9; color: #0f172a; margin: 0; padding: 16px; }
    .no-print { display: flex; justify-content: space-between; align-items: center; background: #fff; padding: 10px 14px; border-radius: 8px; border: 1px solid #cbd5e1; margin-bottom: 16px; }
    .btn { background: #0284c7; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 700; cursor: pointer; }
    .sheet-title { font-size: 13px; font-weight: 800; color: #0f172a; margin: 10px 0 8px; text-transform: uppercase; }
    .outer-sticker { width: 95mm; min-height: 65mm; background: #fff; border: 2px solid #0f172a; border-radius: 6px; padding: 3.5mm; box-sizing: border-box; box-shadow: 0 4px 12px rgba(0,0,0,0.08); margin-bottom: 14px; display: flex; flex-direction: column; justify-content: space-between; }
    .outer-hdr { display: flex; justify-content: space-between; align-items: center; background: #0c4a6e; color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 9.5px; font-weight: 800; letter-spacing: 0.4px; }
    .ivd-box { border: 1.5px solid #fff; padding: 1px 5px; font-weight: 900; font-size: 9px; border-radius: 2px; }
    .prod-name { font-size: 13px; font-weight: 800; color: #0f172a; margin: 5px 0 2px; line-height: 1.25; }
    .prod-sub { font-size: 9.5px; color: #334155; margin-bottom: 5px; }
    .iso-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; font-size: 10px; border-top: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1; padding: 5px 0; font-family: monospace; }
    .iso-sym { display: inline-block; border: 1px solid #0f172a; padding: 0 3px; font-weight: 800; font-size: 8.5px; margin-right: 4px; background: #f8fafc; }
    .barcode-row { display: flex; justify-content: space-between; align-items: center; padding-top: 5px; gap: 8px; }
    .barcode-bars { min-height: 24px; }
    .udi-txt { font-family: monospace; font-size: 8.5px; color: #0f172a; margin-top: 2px; }
    .tube-grid { display: flex; flex-wrap: wrap; gap: 10px; }
    .tube-sticker { width: 52mm; min-height: 26mm; background: #fff; border: 1.5px solid #0f172a; border-radius: 5px; padding: 2.5mm; box-sizing: border-box; font-size: 9px; }
    .tube-top { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px; margin-bottom: 3px; }
    .brand-mini { font-weight: 800; color: #0369a1; font-size: 8.5px; }
    .temp-badge { background: #e0f2fe; color: #0369a1; border: 1px solid #7dd3fc; padding: 0 4px; border-radius: 3px; font-family: monospace; font-weight: 700; font-size: 8px; }
    .tube-title { font-weight: 800; font-size: 10.5px; color: #0f172a; }
    .tube-sub { font-size: 8px; color: #475569; margin-bottom: 3px; }
    .tube-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 4px; font-family: monospace; font-size: 8.5px; }
    @media print { body { background: #fff; padding: 0; } .no-print { display: none !important; } .outer-sticker { box-shadow: none; } }
  </style>
</head>
<body>
  <div class="no-print">
    <div>
      <b>🖨️ BẢN IN TEM NHÃN THỰC TẾ — LÔ ${o.lot_code} (${o.product_code})</b>
      <div style="font-size:11px;color:#475569">Định mức in theo PO: ${totalKits} tem hộp ngoài (95×65mm) + bộ tem ống thành phần (38×19mm)</div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn" onclick="window.print()">🖨️ Nhấn Lệnh In Tem Nhãn</button>
      <button class="btn" style="background:#475569" onclick="window.close()">Đóng</button>
    </div>
  </div>

  <div class="sheet-title">1. Mẫu Tem Nhãn Hộp Ngoài Thực Tế (Khổ chuẩn 95 × 65 mm — In ${totalKits} tem)</div>
  <div class="outer-sticker">
    <div>
      <div class="outer-hdr">
        <span>ABT BIOLOGICAL SOLUTIONS · ISO 13485</span>
        <span class="ivd-box">IVD</span>
      </div>
      <div class="prod-name">${o.product_name}</div>
      <div class="prod-sub">Tiêu chuẩn: ${o.tccs_code || "TCCS 01:2026/ABT"} · Bảo quản: ${o.bom_storage_condition || "-20°C ± 5°C"}</div>
      <div class="iso-grid">
        <div><span class="iso-sym">REF</span><b>${o.product_code}</b></div>
        <div><span class="iso-sym">LOT</span><b>${o.lot_code}</b></div>
        <div><span class="iso-sym">MFG</span>${fmtDate(o.mfg_date)}</div>
        <div><span class="iso-sym">EXP</span><b>${fmtDate(o.expiry_date)}</b></div>
        <div><span class="iso-sym">Σ</span>${specText}</div>
        <div><span class="iso-sym">🌡️</span>${o.bom_storage_condition || "-20°C"}</div>
      </div>
    </div>
    <div>
      <div class="barcode-row">
        <div style="flex:1">
          <div class="barcode-bars">${code128Svg}</div>
          <div class="udi-txt">GS1-128 UDI: ${udiStr}</div>
        </div>
        <div>
          ${qr2dSvg}
        </div>
      </div>
    </div>
  </div>

  <div class="sheet-title">2. Bộ Tem Nhãn Từng Ống Thành Phần Thực Tế (Khổ 38 × 19 mm)</div>
  <div class="tube-grid">
    ${tubeCardsHtml || '<div style="font-size:12px;color:#475569">Chưa cấu hình danh sách ống thành phần</div>'}
  </div>
</body>
</html>`);
    w.document.close();
    setTimeout(() => w.print(), 250);
  };

  const handleUpdateOrderLot = async (regenerate = false) => {
    if (!selectedOrderId) return;
    setError(null);
    try {
      await api(`/api/factory/kit/orders/${selectedOrderId}`, {
        method: "POST",
        json: {
          operation: "update_lot",
          lot_code: regenerate ? null : lotEditForm.lot_code.trim() || null,
          mfg_date: lotEditForm.mfg_date || null,
          regenerate_lot_code: regenerate,
        },
      });
      await loadDetail(selectedOrderId);
      await loadOrders();
      onRefreshOptions();
    } catch (err) {
      setError(err);
    }
  };

  const handleLineClearance = async () => {
    if (!selectedOrderId) return;
    setError(null);
    try {
      await api(`/api/factory/kit/orders/${selectedOrderId}`, {
        method: "POST",
        json: {
          operation: "line_clearance",
          previous_lot_removed: true,
          previous_labels_destroyed: true,
          workstation_sanitized_uv: true,
          environmental_temp_humidity_ok: true,
          notes: "Đã kiểm tra dọn sạch dây chuyền, khử trùng UV và loại bỏ toàn bộ nhãn/ống của lô trước.",
        },
      });
      await loadDetail(selectedOrderId);
    } catch (err) {
      setError(err);
    }
  };

  const handleReconcile = async (c: any, actualQty: string, varianceReason: string) => {
    if (!selectedOrderId) return;
    setError(null);
    try {
      await api(`/api/factory/kit/orders/${selectedOrderId}`, {
        method: "POST",
        json: {
          operation: "reconcile_material",
          consumption_id: c.id,
          actual_qty: Number(actualQty),
          returned_qty: 0,
          variance_reason: varianceReason || null,
        },
      });
      await loadDetail(selectedOrderId);
    } catch (err) {
      setError(err);
    }
  };

  const handleCreateRework = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setError(null);
    try {
      const compItem = options.items.find((i) => i.id === rwForm.component_item_id);
      await api("/api/factory/kit/reworks", {
        method: "POST",
        idempotent: true,
        json: {
          org_unit_id: detail.order.org_unit_id,
          production_order_id: detail.order.id,
          scope: rwForm.scope,
          box_no: rwForm.scope === "PARTIAL" ? Number(rwForm.box_no) : null,
          component_item_id: rwForm.component_item_id || null,
          qty_to_rework: Number(rwForm.qty_to_rework),
          uom: rwForm.uom || compItem?.base_uom || detail.order.uom,
          warehouse_id: detail.order.warehouse_id,
          instructions: rwForm.instructions,
        },
      });
      setShowReworkForm(false);
      await loadDetail(detail.order.id);
    } catch (err) {
      setError(err);
    }
  };

  const handleAssignOperator = async (orderId: string, step: any) => {
    setError(null);
    const edit = operatorEdits[step.id] ?? {
      assigned_to_name: step.assigned_to_name ?? "",
      shift_code: step.shift_code ?? "CA_SANG",
      planned_date: step.planned_date ? String(step.planned_date).slice(0, 10) : new Date().toISOString().slice(0, 10),
    };
    if (!edit.assigned_to_name.trim()) {
      setError(new Error("Vui lòng chọn hoặc nhập tên nhân viên phụ trách bước công đoạn trước khi lưu phân công."));
      return;
    }
    try {
      await api(`/api/factory/kit/orders/${orderId}`, {
        method: "POST",
        json: {
          operation: "assign_operator",
          step_id: step.id,
          assigned_to_name: edit.assigned_to_name,
          shift_code: edit.shift_code,
          planned_date: edit.planned_date,
        },
      });
      await loadOrders();
      if (selectedOrderId === orderId) await loadDetail(orderId);
    } catch (err) {
      setError(err);
    }
  };

  const handleVerifyQcGate = async (
    orderId: string,
    step: any,
    decision: "REQUEST_QC" | "PASS" | "REJECT",
    customParams?: Record<string, string>
  ) => {
    setError(null);
    try {
      await api(`/api/factory/kit/orders/${orderId}`, {
        method: "POST",
        json: {
          operation: "verify_qc_gate",
          step_id: step.id,
          decision,
          note: qcGateNotes[step.id] ?? step.qc_gate_note ?? "",
          param_values: customParams ?? stepParams[step.id] ?? step.param_values ?? {},
        },
      });
      await loadOrders();
      if (selectedOrderId === orderId) await loadDetail(orderId);
    } catch (err) {
      setError(err);
    }
  };

  const waitingQcCount = dailySteps.filter((s) => s.is_qc && s.qc_gate_status === "WAITING_QC" && s.status !== "DONE").length;
  const inProgressCount = dailySteps.filter((s) => s.status === "IN_PROGRESS" || s.status === "AWAITING_CHECK").length;

  return (
    <div className="space-y-4">
      <ErrorNote error={error} />

      {/* Thanh chuyển đổi chế độ: Điều hành Lệnh EBR vs Giám sát Nhân viên & Kế hoạch PO Hằng ngày */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-2.5 flex flex-wrap items-center justify-between gap-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={viewMode === "PLAN" ? "primary" : "ghost"}
            title="Trưởng nhóm lập kế hoạch sản xuất dựa trên PO đang có, theo dõi kế hoạch, QA phụ trách và tiến độ theo từng công đoạn của quy trình"
            onClick={() => setViewMode("PLAN")}
          >
            🗓️ Kế hoạch SX theo PO &amp; Tiến độ công đoạn
          </Button>
          <Button
            variant={viewMode === "EBR" ? "primary" : "ghost"}
            title="Màn hình điều hành chi tiết từng Lệnh sản xuất, Hồ sơ lô điện tử (EBR - Electronic Batch Record), Cấp phát vật tư FEFO và In nhãn theo PO"
            onClick={() => setViewMode("EBR")}
          >
            📋 Điều hành Lệnh Sản Xuất &amp; Hồ sơ Lô (EBR) ({orders.length})
          </Button>
          <Button
            variant={viewMode === "DAILY_TRACKER" ? "primary" : "ghost"}
            title="Bảng điều độ ca sản xuất, phân công nhân viên phụ trách từng bước công đoạn và theo dõi tiến độ triển khai kế hoạch PO hằng ngày"
            onClick={() => setViewMode("DAILY_TRACKER")}
          >
            👨‍🔬 Giám sát Nhân viên &amp; Tiến độ PO Hằng ngày ({dailySteps.length} công đoạn)
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {waitingQcCount > 0 && (
            <span
              title="Số bước kiểm soát chất lượng bán thành phẩm xen kẽ (IPQC - In-Process Quality Control) đang chờ bộ phận QA/QC xác nhận thông qua để mở khóa bước tiếp theo"
              className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300 font-bold border border-amber-300 dark:border-amber-800"
            >
              🛡️ {waitingQcCount} bước QC xen kẽ chờ xác nhận thông qua
            </span>
          )}
          <span className="px-2.5 py-1 rounded-full bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300 font-semibold border border-sky-200 dark:border-sky-800">
            ⚡ {inProgressCount} công đoạn đang chạy trên dây chuyền
          </span>
        </div>
      </div>

      {viewMode === "PLAN" && (
        <ProductionPlanView
          mode="LEAD"
          onOpenOrder={(orderId) => {
            setSelectedOrderId(orderId);
            setViewMode("EBR");
          }}
          onPlanFromPo={(lineId) => {
            prefillFromPoLine(lineId);
            setShowCreateOrder(true);
            setViewMode("EBR");
          }}
          onCreateOrder={() => {
            setShowCreateOrder(true);
            setViewMode("EBR");
          }}
        />
      )}

      {viewMode === "DAILY_TRACKER" && (
        <DailyOperatorTrackerSection
          dailySteps={dailySteps}
          operatorOptions={deptOperatorOptions}
          dailyShiftFilter={dailyShiftFilter}
          setDailyShiftFilter={setDailyShiftFilter}
          dailyStatusFilter={dailyStatusFilter}
          setDailyStatusFilter={setDailyStatusFilter}
          dailySearch={dailySearch}
          setDailySearch={setDailySearch}
          operatorEdits={operatorEdits}
          setOperatorEdits={setOperatorEdits}
          qcGateNotes={qcGateNotes}
          setQcGateNotes={setQcGateNotes}
          onAssignOperator={handleAssignOperator}
          onVerifyQcGate={handleVerifyQcGate}
          onOpenOrderEbr={(orderId) => {
            setSelectedOrderId(orderId);
            setViewMode("EBR");
          }}
        />
      )}

      {viewMode === "EBR" && (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className={detail ? "lg:col-span-4 space-y-4" : "lg:col-span-12 space-y-4"}>
          <Card
            title={`Danh sách Lệnh sản xuất (${orders.length})`}
            actions={
              <Button onClick={() => setShowCreateOrder((v) => !v)}>
                {showCreateOrder ? "Đóng form" : "+ Phát hành Lệnh sản xuất Kit"}
              </Button>
            }
          >
            {showCreateOrder && (
              <form
                onSubmit={handleCreateOrder}
                className="mb-4 p-3.5 rounded-xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/40 dark:bg-sky-950/20 space-y-3"
              >
                <div className="flex items-center justify-between border-b border-sky-200/70 dark:border-sky-900/50 pb-2">
                  <div className="text-xs font-bold text-sky-900 dark:text-sky-300">
                    Phát hành Lệnh sản xuất Kit mới
                  </div>
                  <Button type="button" variant="ghost" onClick={() => setShowCreateOrder(false)}>
                    Hủy
                  </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Field label="Phòng Sản xuất Kit">
                    <select
                      className={inputClass}
                      value={orderForm.org_unit_id}
                      onChange={(e) => setOrderForm({ ...orderForm, org_unit_id: e.target.value })}
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
                  <Field label="Kho xuất VT & nhập TP">
                    <select
                      className={inputClass}
                      value={orderForm.warehouse_id}
                      onChange={(e) => setOrderForm({ ...orderForm, warehouse_id: e.target.value })}
                      required
                    >
                      <option value="">-- Chọn kho --</option>
                      {options.warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.code} — {w.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Liên kết Đơn nội bộ (PO Kinh doanh) — Tự động nạp Mã Kit & Số lượng PO">
                  <select
                    className={inputClass}
                    value={orderForm.internal_order_line_id}
                    onChange={(e) => prefillFromPoLine(e.target.value)}
                  >
                    <option value="">-- Lệnh sản xuất độc lập (Hoặc chọn PO Kinh doanh bên dưới) --</option>
                    {(options.po_lines ?? []).map((p) => (
                      <option key={p.line_id} value={p.line_id}>
                        {p.kd_po_code} ({p.internal_order_code}) — {p.item_code}: Cần {p.qty_ordered} {p.uom}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Field label="Mã Chính Thành phẩm Kit / Bán TP (Xuất kho & Giao hàng) *">
                    <select
                      className={inputClass}
                      value={orderForm.product_item_id}
                      onChange={(e) => {
                        const nextProdId = e.target.value;
                        const it = kitProducts.find((x) => x.id === nextProdId);
                        const matchingBoms = (options.effective_boms ?? []).filter((b) => b.product_item_id === nextProdId);
                        const defaultBom = matchingBoms[0];
                        const nextSupplyForm = defaultBom?.supply_form || orderForm.supply_form || "NO_SPLIT_NO_IC";
                        const sf = ABT_KIT_SUPPLY_FORMS[nextSupplyForm] || ABT_KIT_SUPPLY_FORMS.NO_SPLIT_NO_IC;
                        const isSemi = it?.item_type === "SEMI_FINISHED";
                        setOrderForm({
                          ...orderForm,
                          product_item_id: nextProdId,
                          bom_id: defaultBom?.id ?? "",
                          supply_form: nextSupplyForm,
                          tube_code: isSemi ? "" : orderForm.tube_code || "T02",
                          order_mode: orderForm.is_demo ? "DEMO" : sf.is_aliquoted ? "ALIQUOTED" : "STANDARD",
                        });
                      }}
                      required
                    >
                      <option value="">-- Chọn Mã chính (Master SKU) --</option>
                      {kitProducts.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.code} — {i.name} ({i.base_uom})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Công thức BOM theo mã con (Sub-Formula EFFECTIVE)">
                    <select
                      className={inputClass}
                      value={orderForm.bom_id}
                      onChange={(e) => {
                        const nextBomId = e.target.value;
                        const chosenBom = (options.effective_boms ?? []).find((b) => b.id === nextBomId);
                        const nextSf = chosenBom?.supply_form || orderForm.supply_form;
                        const sf = ABT_KIT_SUPPLY_FORMS[nextSf] || ABT_KIT_SUPPLY_FORMS.NO_SPLIT_NO_IC;
                        setOrderForm({
                          ...orderForm,
                          bom_id: nextBomId,
                          supply_form: nextSf,
                          order_mode: orderForm.is_demo ? "DEMO" : sf.is_aliquoted ? "ALIQUOTED" : "STANDARD",
                        });
                      }}
                    >
                      <option value="">-- Tự động chọn BOM khớp Dạng cung cấp --</option>
                      {(options.effective_boms ?? [])
                        .filter((b) => !orderForm.product_item_id || b.product_item_id === orderForm.product_item_id)
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            [{b.variant_code || "BASE"}] {b.code} (v{b.bom_version}) — {b.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                </div>

                {(() => {
                  const selectedProd = kitProducts.find((x) => x.id === orderForm.product_item_id);
                  const matchingBoms = (options.effective_boms ?? []).filter(
                    (b) => b.product_item_id === orderForm.product_item_id
                  );
                  const activeBom =
                    matchingBoms.find((b) => b.id === orderForm.bom_id) || matchingBoms[0];
                  const isPcrKit =
                    selectedProd?.item_type !== "SEMI_FINISHED" &&
                    activeBom?.bom_type !== "semi_finished" &&
                    (activeBom?.bom_category || "PCR Kit") === "PCR Kit";

                  if (!isPcrKit) {
                    return (
                      <div className="p-3 rounded-xl border border-teal-300 dark:border-teal-800/70 bg-teal-50/50 dark:bg-teal-950/25 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px] font-extrabold text-teal-900 dark:text-teal-300 uppercase">
                            🧪 Nhóm Kit Tách Chiết / Bán Thành Phẩm (Nổ BOM theo công thức chuẩn — Không áp dụng hậu tố Tube PCR)
                          </span>
                          <label className="flex items-center gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={orderForm.is_demo}
                              onChange={(e) => {
                                const isDemo = e.target.checked;
                                setOrderForm({
                                  ...orderForm,
                                  is_demo: isDemo,
                                  tube_code: "",
                                  order_mode: isDemo ? "DEMO" : "STANDARD",
                                });
                              }}
                            />
                            🧪 Sản xuất Kit Demo (Giảm nguyên liệu theo tỉ lệ, giữ nguyên chai chứa / vỏ hộp)
                          </label>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {orderForm.is_demo && (
                            <Field label="Quy cách đóng gói Kit Demo (Giảm nguyên liệu theo tỉ lệ)">
                              <select
                                className={inputClass}
                                value={orderForm.demo_specification}
                                onChange={(e) => setOrderForm({ ...orderForm, demo_specification: e.target.value })}
                              >
                                <option value="25 test">25 test (1/2 bộ chuẩn 50T, giữ nguyên chai chứa)</option>
                                <option value="1/2 bộ">1/2 bộ (50% hóa chất, giữ nguyên 1 bộ chai chứa &amp; vỏ hộp)</option>
                                <option value="10 test">10 test (Demo nhỏ, giữ nguyên chai chứa &amp; vỏ hộp)</option>
                              </select>
                            </Field>
                          )}
                          <Field label="Mẫu lưu QC (Bộ/ĐVT)">
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                step="any"
                                disabled={orderForm.no_retention}
                                className={inputClass}
                                value={orderForm.qc_retention_qty}
                                onChange={(e) => setOrderForm({ ...orderForm, qc_retention_qty: e.target.value })}
                              />
                              <label className="flex items-center gap-1 text-[11px] whitespace-nowrap text-stone-600 dark:text-slate-300">
                                <input
                                  type="checkbox"
                                  checked={orderForm.no_retention}
                                  onChange={(e) => setOrderForm({ ...orderForm, no_retention: e.target.checked })}
                                />
                                Không lưu
                              </label>
                            </div>
                          </Field>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div className="p-3 rounded-xl border border-indigo-300 dark:border-indigo-800/70 bg-indigo-50/60 dark:bg-indigo-950/25 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <span className="text-[11px] font-extrabold text-indigo-900 dark:text-indigo-300 uppercase">
                          🧬 Phân Loại: KIT PCR — Quy Cách Cung Cấp &amp; Mã Nhận Diện Lô Chuẩn ABT (Chung 1 Mã Chính — Phân Biệt Qua Lot)
                        </span>
                        <label className="flex items-center gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={orderForm.is_demo}
                            onChange={(e) => {
                              const isDemo = e.target.checked;
                              const sf = ABT_KIT_SUPPLY_FORMS[orderForm.supply_form] || ABT_KIT_SUPPLY_FORMS.NO_SPLIT_NO_IC;
                              setOrderForm({
                                ...orderForm,
                                is_demo: isDemo,
                                order_mode: isDemo ? "DEMO" : sf.is_aliquoted ? "ALIQUOTED" : "STANDARD",
                              });
                            }}
                          />
                          🧪 Sản xuất Kit Demo (Giảm Mix theo tỉ lệ, giữ nguyên chai/vỏ hộp)
                        </label>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <Field label="1. Dạng cung cấp Kit PCR (4 dạng chuẩn ABT)">
                          <select
                            className={inputClass}
                            value={orderForm.supply_form}
                            onChange={(e) => {
                              const sfKey = e.target.value;
                              const sf = ABT_KIT_SUPPLY_FORMS[sfKey] || ABT_KIT_SUPPLY_FORMS.NO_SPLIT_NO_IC;
                              const matchedBom = (options.effective_boms ?? []).find(
                                (b) => b.product_item_id === orderForm.product_item_id && b.supply_form === sfKey
                              );
                              setOrderForm({
                                ...orderForm,
                                supply_form: sfKey,
                                bom_id: matchedBom ? matchedBom.id : orderForm.bom_id,
                                order_mode: orderForm.is_demo ? "DEMO" : sf.is_aliquoted ? "ALIQUOTED" : "STANDARD",
                              });
                            }}
                          >
                            {Object.values(ABT_KIT_SUPPLY_FORMS).map((sf) => (
                              <option key={sf.key} value={sf.key}>
                                {sf.label} ({sf.mix_tests_per_kit}T Mix + {sf.pcr_tubes_per_kit} tube PCR)
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="2. Mã nhận diện Tube / Strip PCR cấp kèm (8 loại chuẩn)">
                          <select
                            className={`${inputClass} font-mono`}
                            value={orderForm.tube_code}
                            onChange={(e) => setOrderForm({ ...orderForm, tube_code: e.target.value })}
                          >
                            <option value="">-- Không kèm mã Tube trên Lot --</option>
                            {ABT_TUBE_STRIP_CATALOG.map((tb) => (
                              <option key={tb.code} value={tb.code}>
                                {tb.code} — {tb.name} ({tb.note})
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>

                      {(() => {
                        const sf = ABT_KIT_SUPPLY_FORMS[orderForm.supply_form] || ABT_KIT_SUPPLY_FORMS.NO_SPLIT_NO_IC;
                        const tb = ABT_TUBE_STRIP_CATALOG.find((t) => t.code === orderForm.tube_code);
                        const yymm = (orderForm.mfg_date || vnToday()).replace(/\D/g, "").slice(2, 6) || "2611";
                        const sampleLot = buildAbtKitLotCode({
                          baseLot: `B${yymm}001`,
                          supplyForm: orderForm.supply_form,
                          tubeCode: orderForm.tube_code,
                        });
                        return (
                          <div className="p-2 rounded-lg bg-white/90 dark:bg-slate-900/90 border border-indigo-200 dark:border-indigo-900/60 text-[11px] flex flex-wrap items-center justify-between gap-2">
                            <div className="space-y-0.5">
                              <div className="font-bold text-slate-800 dark:text-slate-100">
                                📌 Quy tắc nổ BOM tự động: <span className="text-indigo-700 dark:text-indigo-300">{sf.description}</span>
                              </div>
                              <div className="text-slate-600 dark:text-slate-400">
                                • Định mức Mix: <b>{sf.mix_tests_per_kit} test/kit</b> · Số lượng Tube PCR cấp kèm:{" "}
                                <b>
                                  {sf.pcr_tubes_per_kit} tube ({tb ? `${tb.code} — ${tb.name} [${tb.note}]` : "Không kèm tube"})
                                </b>{" "}
                                · Ống IC rời: <b>{sf.include_ic_tube ? "Có cấp kèm" : "Không kèm (Đã pha sẵn trong Mix)"}</b> · Tube 1.5mL chứa Mix:{" "}
                                <b>{sf.include_mix_1_5ml_tubes ? "Có cấp kèm" : "Không kèm (Chia sẵn vào tube PCR)"}</b>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-[10px] uppercase text-slate-500 font-bold">Mẫu Lot tự sinh:</div>
                              <div className="font-mono font-extrabold text-sm text-sky-700 dark:text-sky-300">{sampleLot}</div>
                            </div>
                          </div>
                        );
                      })()}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {orderForm.is_demo && (
                          <Field label="Quy cách đóng gói Kit Demo (Giảm nguyên liệu theo tỉ lệ)">
                            <select
                              className={inputClass}
                              value={orderForm.demo_specification}
                              onChange={(e) => setOrderForm({ ...orderForm, demo_specification: e.target.value })}
                            >
                              <option value="25 test">25 test (Co giãn Mix theo tỉ lệ, giữ nguyên chai/hộp)</option>
                              <option value="24 test">24 test (1/2 bộ chia sẵn, giữ nguyên vỏ hộp)</option>
                              <option value="1/2 bộ">1/2 bộ (50% Mix, giữ nguyên 1 bộ chai chứa &amp; vỏ hộp)</option>
                              <option value="10 test">10 test (Demo nhỏ, giữ nguyên chai chứa &amp; vỏ hộp)</option>
                            </select>
                          </Field>
                        )}
                        <Field label="Mẫu lưu QC (Bộ/ĐVT)">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              step="any"
                              disabled={orderForm.no_retention}
                              className={inputClass}
                              value={orderForm.qc_retention_qty}
                              onChange={(e) => setOrderForm({ ...orderForm, qc_retention_qty: e.target.value })}
                            />
                            <label className="flex items-center gap-1 text-[11px] whitespace-nowrap text-stone-600 dark:text-slate-300">
                              <input
                                type="checkbox"
                                checked={orderForm.no_retention}
                                onChange={(e) => setOrderForm({ ...orderForm, no_retention: e.target.checked })}
                              />
                              Không lưu
                            </label>
                          </div>
                        </Field>
                      </div>
                    </div>
                  );
                })()}

                <Field label="Số Lô thành phẩm (Lot No.) — Gõ trực tiếp (VD: B2611001.C.IC.T02) hệ thống tự nhận diện quy cách & nổ BOM, hoặc để trống hệ thống tự cấp">
                  <input
                    className={`${inputClass} font-mono font-bold`}
                    placeholder="VD: B2611001.C.IC.T02 hoặc B2611001.IC.S01 (Để trống hệ thống tự cấp theo lựa chọn trên)"
                    value={orderForm.lot_code}
                    onChange={(e) => {
                      const typedLot = e.target.value;
                      const parsed = parseAbtKitLotCode(typedLot);
                      if (parsed.isAbtStructuredLot) {
                        const nextSf = parsed.supplyForm?.key || orderForm.supply_form;
                        const sfSpec = ABT_KIT_SUPPLY_FORMS[nextSf] || ABT_KIT_SUPPLY_FORMS.NO_SPLIT_NO_IC;
                        const matchedBom = (options.effective_boms ?? []).find(
                          (b) => b.product_item_id === orderForm.product_item_id && b.supply_form === nextSf
                        );
                        setOrderForm({
                          ...orderForm,
                          lot_code: typedLot,
                          supply_form: nextSf,
                          tube_code: parsed.tubeSpec ? parsed.tubeSpec.code : orderForm.tube_code,
                          bom_id: matchedBom ? matchedBom.id : orderForm.bom_id,
                          order_mode: orderForm.is_demo ? "DEMO" : sfSpec.is_aliquoted ? "ALIQUOTED" : "STANDARD",
                        });
                      } else {
                        setOrderForm({ ...orderForm, lot_code: typedLot });
                      }
                    }}
                  />
                </Field>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="SL kế hoạch">
                    <input
                      type="number"
                      step="any"
                      className={inputClass}
                      value={orderForm.planned_qty}
                      onChange={(e) => setOrderForm({ ...orderForm, planned_qty: e.target.value })}
                      required
                    />
                  </Field>
                  <Field label="Ngày SX">
                    <input
                      type="date"
                      className={inputClass}
                      value={orderForm.mfg_date}
                      onChange={(e) => setOrderForm({ ...orderForm, mfg_date: e.target.value })}
                      required
                    />
                  </Field>
                  <Field label="Ưu tiên">
                    <select
                      className={inputClass}
                      value={orderForm.priority}
                      onChange={(e) => setOrderForm({ ...orderForm, priority: e.target.value })}
                    >
                      <option value="LOW">Thấp</option>
                      <option value="NORMAL">Thường</option>
                      <option value="HIGH">Cao</option>
                      <option value="URGENT">Khẩn</option>
                    </select>
                  </Field>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setShowCreateOrder(false)}>
                    Hủy
                  </Button>
                  <Button type="submit">Tạo lệnh sản xuất &amp; Cấp Số Lô Chuẩn ABT</Button>
                </div>
              </form>
            )}

            {orders.length === 0 ? (
              <Empty>Chưa có lệnh sản xuất Kit nào. Bấm &ldquo;+ Phát hành Lệnh sản xuất Kit&rdquo; ở góc phải để tạo mới.</Empty>
            ) : (
              <Table head={["Mã lệnh", "Mã Chính & Số Lô Phân Biệt Quy Cách", "Tiến độ EBR", "Trạng thái"]}>
                {orders.map((o) => {
                  const decoded = parseAbtKitLotCode(o.lot_code);
                  return (
                    <tr
                      key={o.id}
                      onClick={() => setSelectedOrderId(o.id)}
                      className={`cursor-pointer hover:bg-amber-50/60 dark:hover:bg-slate-800/60 ${selectedOrderId === o.id ? "bg-amber-50 dark:bg-sky-950/30" : ""}`}
                    >
                      <td className="px-3 py-2 font-mono text-xs font-semibold text-sky-700 dark:text-sky-400">
                        <div>{o.code}</div>
                        {o.bom_variant_code && (
                          <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-[10px]">
                            BOM: {o.bom_variant_code}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <div className="font-bold text-stone-800 dark:text-slate-100">
                          {o.product_code} ({fmtQty(o.planned_qty)} {o.uom})
                        </div>
                        <div className="text-sky-700 dark:text-sky-400 font-mono font-bold">
                          {o.lot_code ? `LOT: ${o.lot_code}` : "Chưa cấp lô"}
                          {o.expiry_date ? ` · HSD: ${fmtDate(o.expiry_date)}` : ""}
                        </div>
                        {o.lot_code && (
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                            🧬 {decoded.supplyForm ? decoded.supplyForm.short_label : "Chuẩn"}
                            {decoded.tubeSpec ? ` · Tube ${decoded.tubeSpec.code} (${decoded.tubeSpec.name})` : ""}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {o.done_steps}/{o.total_steps} bước
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={o.status} />
                      </td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </Card>
        </div>

        {detail && (
          <div className="lg:col-span-8 space-y-4">
            <Card
              title={`Lệnh ${detail.order.code} — Mã chính: ${detail.order.product_code} (${detail.order.product_name})`}
              actions={
                <div className="flex items-center gap-2">
                  <StatusBadge status={detail.order.status} />
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSelectedOrderId("");
                      setDetail(null);
                    }}
                  >
                    Đóng chi tiết
                  </Button>
                </div>
              }
            >
                {/* Giải mã trực quan Số Lô chuẩn ABT (Lot Decoder Banner) */}
                {detail.order.lot_code && (() => {
                  const decoded = parseAbtKitLotCode(detail.order.lot_code);
                  const sfSpec =
                    (detail.order.supply_form && ABT_KIT_SUPPLY_FORMS[detail.order.supply_form]) ||
                    decoded.supplyForm ||
                    ABT_KIT_SUPPLY_FORMS.NO_SPLIT_NO_IC;
                  const tubeSpec =
                    ABT_TUBE_STRIP_CATALOG.find((t) => t.code === detail.order.tube_code) ||
                    decoded.tubeSpec;
                  return (
                    <div className="mb-3 p-2.5 rounded-xl border border-indigo-300 dark:border-indigo-800/70 bg-indigo-50/70 dark:bg-indigo-950/30 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="space-y-0.5">
                        <div className="font-bold text-indigo-950 dark:text-indigo-200 flex flex-wrap items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded bg-indigo-600 text-white font-mono text-[11px]">
                            LOT: {detail.order.lot_code}
                          </span>
                          <span>➔ {sfSpec.label}</span>
                          {tubeSpec && (
                            <span className="px-2 py-0.5 rounded bg-sky-500/20 border border-sky-500/40 text-sky-800 dark:text-sky-200 font-mono text-[11px]">
                              Tube: {tubeSpec.code} — {tubeSpec.name} ({tubeSpec.note})
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-300">
                          📦 Xuất kho &amp; Giao hàng theo <b>Mã chính {detail.order.product_code}</b> · Công thức BOM con:{" "}
                          <b className="font-mono">{detail.order.bom_code} [{detail.order.bom_variant_code || "BASE"}]</b> · Định mức Mix:{" "}
                          <b>{detail.order.mix_tests_per_kit || sfSpec.mix_tests_per_kit} test/kit</b> · Tube PCR cấp kèm:{" "}
                          <b>{detail.order.pcr_tubes_per_kit || sfSpec.pcr_tubes_per_kit} tube/kit</b>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Review-by-Exception (RbE) & Actual Batch Costing Banner */}
                {(() => {
                  const steps = detail.steps ?? [];
                  const failedSteps = steps.filter((s: any) => s.status === "FAILED").length;
                  const missingDualSign = steps.filter((s: any) => s.requires_check_signature && !s.checked_by && s.status === "DONE").length;
                  const maxVar = Math.max(0, ...(detail.consumptions ?? []).map((c: any) => Math.abs(Number(c.variance_pct ?? 0))));
                  const hasException = failedSteps > 0 || missingDualSign > 0 || maxVar > 5 || !detail.order.line_clearance_passed;
                  const plannedQty = Math.max(1, Number(detail.order.planned_qty || 1));
                  const goodQty = Math.max(1, Number(detail.order.good_qty || plannedQty));
                  const consumptions = detail.consumptions ?? [];
                  const reconciledCount = consumptions.filter((c: any) => c.actual_qty != null).length;
                  return (
                    <div
                      className={`mb-3 rounded-xl border p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs ${
                        !hasException
                          ? "border-emerald-300 bg-emerald-50/70 dark:bg-emerald-950/30 dark:border-emerald-800"
                          : "border-amber-300 bg-amber-50/70 dark:bg-amber-950/30 dark:border-amber-800"
                      }`}
                    >
                      <div className="space-y-0.5">
                        <div className="font-bold flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-white dark:bg-slate-900">
                            {!hasException ? "🟢 ZERO-EXCEPTION (RbE)" : "⚠️ REVIEW-BY-EXCEPTION"}
                          </span>
                          <span>
                            {!hasException
                              ? "Mọi bước EBR, Line Clearance & tiêu hao BOM nằm trong ngưỡng chuẩn — Đủ điều kiện duyệt xuất xưởng nhanh"
                              : `Cảnh báo thẩm định: Lệch BOM tối đa ${maxVar.toFixed(1)}% · Bước lỗi: ${failedSteps} · Thiếu chữ ký kép: ${missingDualSign}`}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-300 font-mono">
                          📊 Đối soát tiêu hao vật tư BOM: Đã quyết toán <b>{reconciledCount}/{consumptions.length} dòng</b> · Lệch tối đa:{" "}
                          <b>{maxVar.toFixed(2)}%</b> · SL Kế hoạch / Đạt: <b>{fmtQty(plannedQty)} / {fmtQty(goodQty)} {detail.order.uom}</b>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-slate-600 dark:text-slate-300 mb-3">
                  <div>
                    Mã lô Kit:{" "}
                    <strong className="font-mono text-sky-700 dark:text-sky-300">{detail.order.lot_code ?? "Chưa cấp"}</strong>{" "}
                    {detail.order.lot_status && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 font-mono font-bold">
                        {detail.order.lot_status}
                      </span>
                    )}
                  </div>
                  <div>
                    SL Kế hoạch / Đạt:{" "}
                    <strong className="text-slate-900 dark:text-white font-bold">
                      {fmtQty(detail.order.planned_qty)} / {fmtQty(detail.order.good_qty)} {detail.order.uom}
                    </strong>
                  </div>
                  <div>
                    NSX / HSD cố định:{" "}
                    <strong className="text-slate-900 dark:text-white font-mono font-bold">
                      {fmtDate(detail.order.mfg_date)} → {fmtDate(detail.order.expiry_date)}
                    </strong>
                  </div>
                  <div>
                    Nhãn lô:{" "}
                    <strong className="text-slate-900 dark:text-amber-300 font-bold">
                      {detail.order.label_printed_at
                        ? `Đã in & Khóa HSD (${fmtDateTime(detail.order.label_printed_at)})`
                        : "Chưa in nhãn"}
                    </strong>
                  </div>
                  <div>
                    Dọn dây chuyền (GMP):{" "}
                    <strong className={detail.order.line_clearance_passed ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
                      {detail.order.line_clearance_passed ? "ĐÃ ĐẠT LINE CLEARANCE" : "Chưa xác nhận"}
                    </strong>
                  </div>
                  <div>
                    Hiệu suất mẻ (Batch Yield):{" "}
                    <strong className="font-mono text-slate-900 dark:text-white font-bold">
                      {detail.order.yield_pct != null ? `${fmtQty(detail.order.yield_pct)}%` : "Chưa tính"}
                    </strong>
                  </div>
                  <div>
                    Mẫu QC / Mẫu lưu:{" "}
                    <strong className="font-mono text-slate-900 dark:text-white font-bold">
                      {fmtQty(detail.order.sample_qty ?? 0)} /{" "}
                      {detail.order.no_retention ? "Không lưu" : `${fmtQty(detail.order.qc_retention_qty ?? detail.order.retain_qty ?? 0)} ${detail.order.uom}`}
                    </strong>
                  </div>
                  <div>
                    Dạng cung cấp &amp; Chế độ:{" "}
                    <strong className="font-mono text-sky-700 dark:text-sky-300">
                      {detail.order.supply_form && ABT_KIT_SUPPLY_FORMS[detail.order.supply_form]
                        ? ABT_KIT_SUPPLY_FORMS[detail.order.supply_form].short_label
                        : detail.order.order_mode === "ALIQUOTED" || detail.order.is_aliquoted
                          ? "Chia sẵn (.C)"
                          : "Không chia sẵn"}
                      {detail.order.tube_code ? ` · Tube ${detail.order.tube_code}` : ""}
                      {detail.order.order_mode === "DEMO" || detail.order.is_demo
                        ? ` · DEMO (${detail.order.demo_specification || "1/2 bộ"})`
                        : ""}
                    </strong>
                    {detail.order.actual_ph && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 font-mono">
                        pH: {detail.order.actual_ph}
                      </span>
                    )}
                  </div>
                </div>

                {!detail.order.label_printed_at && !["COMPLETED", "CANCELLED"].includes(detail.order.status) && (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end mb-3 p-3 bg-sky-50/80 dark:bg-slate-800/90 rounded-xl border border-sky-200 dark:border-slate-700">
                    <div className="md:col-span-5">
                      <Field label="Số Lô trên Lệnh sản xuất (Lot Code — Mở khóa cho tới khi In nhãn)">
                        <input
                          className={`${inputClass} font-mono font-semibold`}
                          placeholder="Nhập mã lô hoặc bấm Cấp tự động..."
                          value={lotEditForm.lot_code}
                          onChange={(e) => setLotEditForm({ ...lotEditForm, lot_code: e.target.value })}
                        />
                      </Field>
                    </div>
                    <div className="md:col-span-3">
                      <Field label="Ngày sản xuất (Tự tính HSD)">
                        <input
                          type="date"
                          className={inputClass}
                          value={lotEditForm.mfg_date}
                          onChange={(e) => setLotEditForm({ ...lotEditForm, mfg_date: e.target.value })}
                        />
                      </Field>
                    </div>
                    <div className="md:col-span-4 flex flex-wrap gap-1.5">
                      <Button onClick={() => handleUpdateOrderLot(false)}>Lưu Số Lô &amp; NSX</Button>
                      <Button variant="ghost" onClick={() => handleUpdateOrderLot(true)}>
                        ↻ Tự sinh Số Lô mới
                      </Button>
                    </div>
                  </div>
                )}

                {detail.order.status === "PENDING_QC" && (
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-3 p-2.5 bg-amber-50/70 dark:bg-amber-950/30 rounded border border-amber-200 dark:border-amber-800">
                    <Field label="SL Kit đạt QC (good_qty)">
                      <input
                        type="number"
                        step="any"
                        className={inputClass}
                        value={qcForm.good_qty}
                        onChange={(e) => setQcForm({ ...qcForm, good_qty: e.target.value })}
                      />
                    </Field>
                    <Field label="SL hủy (scrap_qty)">
                      <input
                        type="number"
                        step="any"
                        className={inputClass}
                        value={qcForm.scrap_qty}
                        onChange={(e) => setQcForm({ ...qcForm, scrap_qty: e.target.value })}
                      />
                    </Field>
                    <Field label="SL mẫu QC (sample_qty)">
                      <input
                        type="number"
                        step="any"
                        className={inputClass}
                        value={qcForm.sample_qty}
                        onChange={(e) => setQcForm({ ...qcForm, sample_qty: e.target.value })}
                      />
                    </Field>
                    <Field label="SL mẫu lưu (retain_qty)">
                      <input
                        type="number"
                        step="any"
                        className={inputClass}
                        value={qcForm.retain_qty}
                        onChange={(e) => setQcForm({ ...qcForm, retain_qty: e.target.value })}
                      />
                    </Field>
                    <Field label="Kết luận QC xuất xưởng">
                      <input
                        className={inputClass}
                        value={qcForm.qc_summary}
                        onChange={(e) => setQcForm({ ...qcForm, qc_summary: e.target.value })}
                      />
                    </Field>
                  </div>
                )}

                {detail.order.status === "PENDING_RELEASE" && (
                  <div className="mb-3">
                    <Field label="Giải trình quyết toán vật tư tổng thể (bắt buộc nếu có dòng chênh lệch > ngưỡng 5%)">
                      <input
                        className={inputClass}
                        placeholder="Nhập giải trình hao hụt công đoạn chiết rót / đông khô (nếu có)..."
                        value={reconciliationNote}
                        onChange={(e) => setReconciliationNote(e.target.value)}
                      />
                    </Field>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <ActionBar
                    endpoint={`/api/factory/kit/orders/${detail.order.id}/actions`}
                    version={detail.order.version}
                    actions={detail.allowed_actions}
                    labels={ACTION_LABELS}
                    extraPayload={{
                      good_qty: Number(qcForm.good_qty || detail.order.planned_qty),
                      scrap_qty: Number(qcForm.scrap_qty || 0),
                      sample_qty: Number(qcForm.sample_qty || 0),
                      retain_qty: Number(qcForm.retain_qty || 0),
                      qc_summary: qcForm.qc_summary,
                      reconciliation_note: reconciliationNote,
                    }}
                    onDone={() => {
                      loadOrders();
                      loadDetail(detail.order.id);
                      onRefreshOptions();
                    }}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" onClick={() => setShowBomExplosion(!showBomExplosion)}>
                      {showBomExplosion ? "Ẩn Bảng Nổ BOM" : "🔍 Xem Bảng Nổ BOM Thông Minh"}
                    </Button>
                    <Button
                      variant="secondary"
                      title="Xem trước và In Phiếu Sản Xuất & Cấp Phát Nguyên Liệu (gồm công thức BOM, lượng cân/pha, mã lô NVL FEFO và các bước công đoạn)"
                      onClick={() => setShowProductionWorksheet((v) => !v)}
                    >
                      {showProductionWorksheet ? "Ẩn Phiếu Sản Xuất" : "📋 Xem & In Phiếu Sản Xuất (Công Thức & Lô NVL)"}
                    </Button>
                    {!detail.order.line_clearance_passed && ["CONFIRMED", "IN_PROGRESS"].includes(detail.order.status) && (
                      <Button variant="ghost" onClick={handleLineClearance}>
                        ✓ Xác nhận Dọn dây chuyền (Line Clearance)
                      </Button>
                    )}
                    {["CONFIRMED", "IN_PROGRESS"].includes(detail.order.status) && !detail.order.materials_issued && (
                      <Button onClick={handleIssueMaterials}>
                        📦 Xuất kho nguyên vật liệu theo FEFO
                      </Button>
                    )}
                    {detail.order.lot_id && (
                      <Button
                        variant="secondary"
                        title="Xem hình ảnh tem nhãn thực tế (Nhãn hộp ngoài, Nhãn ống thành phần, Mã vạch GS1/QR) và Tờ HDSD (IFU) để nhấn lệnh in"
                        onClick={() => setShowLabelSheet((v) => !v)}
                      >
                        {showLabelSheet ? "Ẩn Mẫu Nhãn & HDSD (IFU)" : "👁️ Xem & In Trọn Bộ Nhãn Kit, Ống & Tờ HDSD (IFU)"}
                      </Button>
                    )}
                  </div>
                </div>

                {showProductionWorksheet && (
                  <div className="mt-3 p-4 rounded-xl border-2 border-indigo-500/80 bg-white dark:bg-slate-950 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2.5">
                      <div>
                        <div className="text-xs font-extrabold text-indigo-900 dark:text-indigo-300 uppercase">
                          📋 PHIẾU SẢN XUẤT &amp; CẤP PHÁT NGUYÊN VẬT LIỆU THEO LÔ (BM-SX-KIT-01 · ISO 13485)
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Lệnh SX: <b>{detail.order.code}</b> · Sản phẩm: <b>{detail.order.product_code}</b> · Số Lô:{" "}
                          <b className="text-sky-600 dark:text-sky-400">{detail.order.lot_code}</b> · Quy mô mẻ:{" "}
                          <b>{fmtQty(detail.order.planned_qty)} {detail.order.uom}</b> (+ Mẫu lưu:{" "}
                          <b>{detail.order.no_retention ? 0 : fmtQty(detail.order.qc_retention_qty ?? detail.order.retain_qty ?? 0)} {detail.order.uom}</b>)
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={() => printProductionWorksheet(detail)}>
                          🖨️ Nhấn Lệnh In Phiếu Sản Xuất (Khổ A4)
                        </Button>
                        <Button variant="ghost" onClick={() => setShowProductionWorksheet(false)}>
                          Đóng
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
                      <div>
                        <span className="text-slate-500">Định mức BOM &amp; TCCS:</span>
                        <div className="font-bold">{detail.order.bom_code} (v{detail.order.bom_version}) · {detail.order.tccs_code || "TCCS 01:2026/ABT"}</div>
                      </div>
                      <div>
                        <span className="text-slate-500">NSX → Hạn dùng cố định:</span>
                        <div className="font-bold font-mono">{fmtDate(detail.order.mfg_date)} → {fmtDate(detail.order.expiry_date)}</div>
                      </div>
                      <div>
                        <span className="text-slate-500">Phụ trách SX / QA Giám sát:</span>
                        <div className="font-bold">{detail.order.team_lead_name || detail.order.bom_responsible_person_name || "—"} / {detail.order.qa_assignee_name || detail.order.bom_qc_assignee_name || "—"}</div>
                      </div>
                      <div>
                        <span className="text-slate-500">Kho xuất NVL &amp; Trạng thái:</span>
                        <div className="font-bold text-emerald-700 dark:text-emerald-400">
                          {detail.order.warehouse_code} ({detail.order.materials_issued ? "Đã xuất kho FEFO" : "Đang giữ chỗ FEFO"})
                        </div>
                      </div>
                    </div>

                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      I. Bảng Công Thức Pha Chế (BOM) &amp; Lô Nguyên Vật Liệu Xuất Dùng (FEFO):
                    </div>
                    <Table
                      head={[
                        "#",
                        "Hộp / Vai trò",
                        "Mã & Tên Nguyên Vật Liệu",
                        "Định mức / 1 Bộ",
                        "Tổng lượng cần cân/pha",
                        "Mã Lô NVL (FEFO) & Hạn dùng",
                        "Vị trí kệ",
                        "Trạng thái xuất",
                      ]}
                    >
                      {((detail.exploded_bom || []).length > 0 ? detail.exploded_bom : detail.consumptions || []).map((eb: any, idx: number) => {
                        const matchedCons = (detail.consumptions || []).filter(
                          (c: any) => c.bom_line_id === eb.bom_line_id || c.item_id === (eb.component_item_id ?? eb.item_id)
                        );
                        return (
                          <tr key={eb.bom_line_id ?? eb.id ?? idx}>
                            <td className="px-2.5 py-1.5 text-xs">{eb.line_no ?? idx + 1}</td>
                            <td className="px-2.5 py-1.5 text-xs">
                              Hộp {eb.box_no || 1} · {ROLE_LABELS[eb.component_role] ?? eb.component_role}
                            </td>
                            <td className="px-2.5 py-1.5 text-xs">
                              <span className="font-mono font-bold text-sky-700 dark:text-sky-300">{eb.component_code ?? eb.item_code}</span> — {eb.component_name ?? eb.item_name}
                            </td>
                            <td className="px-2.5 py-1.5 text-xs font-mono">
                              {eb.unit_norm !== undefined ? `${fmtQty(eb.unit_norm)} ${eb.uom}` : "—"}
                            </td>
                            <td className="px-2.5 py-1.5 text-xs font-mono font-bold text-indigo-700 dark:text-indigo-300">
                              {fmtQty(eb.required_qty ?? eb.planned_qty)} {eb.uom}
                            </td>
                            <td className="px-2.5 py-1.5 text-xs font-mono">
                              {matchedCons.length > 0
                                ? matchedCons.map((c: any) => (
                                    <div key={c.id}>
                                      <b className="text-emerald-700 dark:text-emerald-400">{c.lot_code || "Lô FEFO"}</b>{" "}
                                      {c.expiry_date ? `(HSD: ${fmtDate(c.expiry_date)})` : ""}
                                    </div>
                                  ))
                                : eb.lot_code
                                  ? `${eb.lot_code} (HSD: ${fmtDate(eb.expiry_date)})`
                                  : "Tự động phân bổ FEFO"}
                            </td>
                            <td className="px-2.5 py-1.5 text-xs font-mono">
                              {matchedCons.map((c: any) => c.location_code).filter(Boolean).join(", ") || detail.order.warehouse_code}
                            </td>
                            <td className="px-2.5 py-1.5 text-xs">
                              {detail.order.materials_issued ? (
                                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-300 font-semibold">
                                  ✓ Đã xuất kho
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-300 font-semibold">
                                  ⏳ Đã giữ chỗ FEFO
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </Table>
                  </div>
                )}

                {showBomExplosion && (detail.exploded_bom || []).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-stone-200 space-y-2">
                    <div className="text-xs font-semibold text-stone-800">
                      Bảng Tính Nổ BOM Thông Minh (`explodeKitBom` — Chế độ:{" "}
                      {detail.order.order_mode === "DEMO"
                        ? `Kit Demo (${detail.order.demo_specification})`
                        : detail.order.order_mode === "ALIQUOTED"
                          ? "Chia sẵn (.D.IC)"
                          : "Thường"}
                      )
                    </div>
                    <Table
                      head={[
                        "#",
                        "Hộp / Vai trò",
                        "Mã VT / Bán TP",
                        "Định mức đơn vị",
                        "SL tính (gồm Mẫu lưu)",
                        "Hệ số Demo",
                        "Hao hụt",
                        "Tổng SL cần xuất",
                      ]}
                    >
                      {(detail.exploded_bom || []).map((eb: any) => (
                        <tr key={eb.bom_line_id}>
                          <td className="px-3 py-1.5 text-xs">{eb.line_no}</td>
                          <td className="px-3 py-1.5 text-xs">
                            Hộp {eb.box_no} · {ROLE_LABELS[eb.component_role] ?? eb.component_role}
                          </td>
                          <td className="px-3 py-1.5 text-xs">
                            <span className="font-mono font-semibold">{eb.component_code}</span> — {eb.component_name}
                          </td>
                          <td className="px-3 py-1.5 text-xs font-mono">
                            {fmtQty(eb.unit_norm)} {eb.uom}
                          </td>
                          <td className="px-3 py-1.5 text-xs font-mono">{fmtQty(eb.effective_order_qty)}</td>
                          <td className="px-3 py-1.5 text-xs font-mono">
                            {eb.demo_ratio_applied !== 1 ? `x${eb.demo_ratio_applied}` : "1.0 (Giữ nguyên)"}
                          </td>
                          <td className="px-3 py-1.5 text-xs">{fmtQty(eb.scrap_pct)}%</td>
                          <td className="px-3 py-1.5 text-xs font-mono font-bold text-sky-800">
                            {fmtQty(eb.required_qty)} {eb.uom}
                            {eb.is_bundled && " (Đi kèm)"}
                          </td>
                        </tr>
                      ))}
                    </Table>
                  </div>
                )}

                {showLabelSheet && (
                  <div className="mt-3 p-4 rounded-xl border-2 border-sky-600 bg-white dark:bg-slate-950 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2.5">
                      <div>
                        <div className="text-xs font-extrabold text-sky-900 dark:text-sky-300 uppercase">
                          🏷️ Hình Ảnh Tem Nhãn Thực Tế (WYSIWYG) &amp; Tờ Hướng Dẫn Sử Dụng (IFU) — Lô {detail.order.lot_code} ({detail.order.product_code})
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Mẫu nhãn: <b>{detail.order.label_template_code ?? `LBL-${detail.order.product_code}-V1`}</b> · Khổ tem:{" "}
                          <b>{detail.order.label_dimensions ?? "Hộp 95×65 mm · Ống 38×19 mm"}</b> · Tài liệu IFU:{" "}
                          <b>{detail.order.ifu_code ?? `IFU-${detail.order.product_code}`} ({detail.order.ifu_version ?? "Rev 01"})</b>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          title="Mở cửa sổ Bản in Tem Nhãn Thực Tế (Nhãn hộp ngoài 95×65mm + Nhãn ống thành phần 38×19mm kèm mã vạch GS1-128 & 2D Matrix) và phát lệnh in"
                          onClick={() => printVisualStickersWindow(detail)}
                        >
                          🖨️ {detail.order.label_printed_at ? "In Lại Bộ Tem Nhãn Thực Tế" : "Xem Bản In & Nhấn Lệnh In Tem Nhãn"}
                        </Button>
                        {(detail.order.ifu_file_url || detail.order.ifu_aliquoted_file_url) && (
                          <Button
                            variant="secondary"
                            onClick={() => {
                              const url =
                                (detail.order.is_aliquoted || detail.order.order_mode === "ALIQUOTED") && detail.order.ifu_aliquoted_file_url
                                  ? detail.order.ifu_aliquoted_file_url
                                  : detail.order.ifu_file_url || detail.order.ifu_aliquoted_file_url;
                              if (url) window.open(url, "_blank");
                            }}
                          >
                            📄 Mở &amp; In File HDSD (IFU) Đính Kèm
                          </Button>
                        )}
                        <Button variant="ghost" onClick={() => setShowLabelSheet(false)}>
                          Đóng
                        </Button>
                      </div>
                    </div>

                    {/* Bảng 1: Tự động tính Số lượng bản in Nhãn Hộp, Nhãn Ống & Tờ HDSD theo PO */}
                    {(() => {
                      const poQty = Number(detail.order.planned_qty || 0);
                      const retQty = detail.order.no_retention ? 0 : Number(detail.order.qc_retention_qty ?? detail.order.retain_qty ?? 0);
                      const totalKits = poQty + retQty;
                      return (
                        <div className="rounded-lg border border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/30 p-2.5 text-xs space-y-1.5">
                          <div className="font-bold text-sky-900 dark:text-sky-200">
                            🧮 Bảng Định Mức Số Lượng Bản In Tự Động Cho Lệnh {detail.order.code} {detail.order.kd_po_code ? `(PO: ${detail.order.kd_po_code})` : ""}:
                          </div>
                          <div className="flex flex-wrap gap-3 text-[11px]">
                            <span className="px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                              📦 Nhãn Hộp Ngoài: <b>{totalKits} tem</b> ({poQty} bộ PO + {retQty} bộ mẫu lưu)
                            </span>
                            <span className="px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                              📖 Tờ Hướng dẫn sử dụng ({detail.order.ifu_code ?? `IFU-${detail.order.product_code}`}): <b>{totalKits} tờ</b> (1 tờ/hộp)
                            </span>
                            {(detail.packaging || []).map((pk: any) => (
                              <span
                                key={pk.id}
                                className="px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                              >
                                🧪 Nhãn ống <b>{pk.component_name}</b>: <b>{totalKits * Number(pk.units_per_kit || 1)} tem</b> ({pk.units_per_kit} ống/bộ)
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Bảng 2: Mô phỏng Hình Ảnh Tem Nhãn Thực Tế Trên Nền Giấy In Nhiệt Trắng (ISO 15223-1 + GS1-128 Barcode + 2D DataMatrix) */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          🖼️ Xem Trước Hình Ảnh Tem Nhãn Thực Tế Trên Phôi Giấy In Tem (Chuẩn ISO 15223-1 &amp; GS1 UDI):
                        </div>
                        <span className="text-[11px] text-slate-500">
                          Bấm <b>&ldquo;🖨️ Xem Bản In &amp; Nhấn Lệnh In Tem Nhãn&rdquo;</b> ở góc phải trên để xuất ra máy in tem nhiệt hoặc giấy decal A4
                        </span>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start bg-slate-200/70 dark:bg-slate-900/80 p-4 rounded-xl border border-slate-300 dark:border-slate-800">
                        {/* Tem Nhãn Hộp Ngoài Thực Tế (95x65mm) */}
                        <div className="lg:col-span-6 flex flex-col items-center">
                          <div className="text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1.5 uppercase tracking-wider">
                            📦 Tem Nhãn Hộp Ngoài Thực Tế (Khổ 95 × 65 mm)
                          </div>
                          <div className="w-full max-w-[440px] bg-white text-slate-950 rounded-lg border-2 border-slate-900 shadow-lg p-3.5 space-y-2">
                            {/* Header thương hiệu + IVD */}
                            <div className="flex items-center justify-between bg-sky-900 text-white px-2.5 py-1.5 rounded">
                              <div>
                                <div className="text-[11px] font-black tracking-wide">ABT BIOLOGICAL SOLUTIONS</div>
                                <div className="text-[9px] text-sky-200">ISO 13485:2016 · In-Vitro Diagnostic Medical Device</div>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="px-1.5 py-0.5 border-2 border-white rounded text-[10px] font-black tracking-widest bg-sky-950">
                                  IVD
                                </span>
                                <span className="px-1.5 py-0.5 bg-white text-sky-950 rounded text-[9px] font-extrabold font-mono">
                                  {detail.order.bom_storage_condition || "-20°C"}
                                </span>
                              </div>
                            </div>

                            {/* Tên sản phẩm */}
                            <div className="border-b border-slate-300 pb-1.5">
                              <div className="text-sm font-black text-slate-950 leading-tight">{detail.order.product_name}</div>
                              <div className="text-[10px] text-slate-600 font-medium mt-0.5">
                                Tiêu chuẩn: <b>{detail.order.tccs_code || "TCCS 01:2026/ABT"}</b> · Mẫu nhãn:{" "}
                                <span className="font-mono">{detail.order.label_template_code ?? `LBL-${detail.order.product_code}-V1`}</span>
                              </div>
                            </div>

                            {/* Lưới biểu tượng chuẩn ISO 15223-1 */}
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] font-mono bg-slate-50 p-2 rounded border border-slate-200">
                              <div className="flex items-center gap-1.5">
                                <span className="px-1 py-0.2 border border-slate-900 font-black text-[9px] bg-white">REF</span>
                                <span className="font-bold text-slate-950">{detail.order.product_code}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="px-1 py-0.2 border border-slate-900 font-black text-[9px] bg-white">LOT</span>
                                <span className="font-black text-sky-900">{detail.order.lot_code}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="px-1 py-0.2 border border-slate-900 font-black text-[9px] bg-white" title="Ngày sản xuất">
                                  🏭 MFG
                                </span>
                                <span>{fmtDate(detail.order.mfg_date)}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="px-1 py-0.2 border border-slate-900 font-black text-[9px] bg-white" title="Hạn sử dụng">
                                  ⌛ EXP
                                </span>
                                <span className="font-bold text-rose-800">{fmtDate(detail.order.expiry_date)}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="px-1 py-0.2 border border-slate-900 font-black text-[9px] bg-white" title="Quy cách số phản ứng">
                                  Σ
                                </span>
                                <span className="font-bold">
                                  {detail.order.order_mode === "DEMO"
                                    ? `DEMO (${detail.order.demo_specification})`
                                    : detail.order.order_mode === "ALIQUOTED" || detail.order.is_aliquoted
                                      ? "48 Tests (.D.IC)"
                                      : `${detail.order.tests_per_kit || 50} Tests`}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="px-1 py-0.2 border border-slate-900 font-black text-[9px] bg-white" title="Tham khảo HDSD">
                                  📖 i
                                </span>
                                <span className="truncate">{detail.order.ifu_code ?? `IFU-${detail.order.product_code}`}</span>
                              </div>
                            </div>

                            {/* Khu vực Mã vạch GS1-128 & 2D DataMatrix thực tế */}
                            <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-300">
                              <div className="flex-1">
                                <svg className="w-full h-8" viewBox="0 0 220 32" preserveAspectRatio="none">
                                  {[2, 6, 9, 14, 18, 21, 27, 31, 35, 40, 44, 49, 53, 57, 63, 67, 72, 76, 81, 85, 90, 95, 99, 104, 108, 113, 118, 122, 127, 131, 136, 141, 145, 150, 154, 159, 164, 168, 173, 177, 182, 187, 191, 196, 201, 205, 210, 214].map(
                                    (x, i) => (
                                      <rect key={i} x={x} y={0} width={i % 3 === 0 ? 2.6 : i % 2 === 0 ? 1.6 : 1} height={28} fill="#0f172a" />
                                    )
                                  )}
                                </svg>
                                <div className="font-mono text-[9.5px] font-bold text-slate-900 tracking-tight">
                                  UDI: {detail.order.udi_di ?? "(01)08936192830117"}(10){detail.order.lot_code}
                                </div>
                              </div>
                              <div className="flex flex-col items-center border border-slate-900 p-1 rounded bg-white">
                                <svg width="34" height="34" viewBox="0 0 8 8">
                                  {[
                                    [1, 1, 1, 1, 1, 1, 1, 0],
                                    [1, 0, 1, 0, 1, 0, 1, 1],
                                    [1, 1, 0, 1, 0, 1, 0, 0],
                                    [1, 0, 1, 1, 0, 0, 1, 1],
                                    [1, 1, 0, 0, 1, 1, 0, 0],
                                    [1, 0, 0, 1, 1, 0, 1, 1],
                                    [1, 0, 1, 0, 0, 1, 0, 0],
                                    [1, 1, 1, 1, 1, 1, 1, 1],
                                  ].map((row, r) =>
                                    row.map((cell, c) =>
                                      cell ? <rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill="#0f172a" /> : null
                                    )
                                  )}
                                </svg>
                                <span className="text-[7.5px] font-mono font-bold text-slate-700 mt-0.5">2D GS1</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Bộ Tem Nhãn Ống Thành Phần Thực Tế (38x19mm) */}
                        <div className="lg:col-span-6 space-y-2">
                          <div className="text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1.5 uppercase tracking-wider text-center lg:text-left">
                            🧪 Bộ Tem Nhãn Dán Từng Ống Thành Phần Thực Tế (Khổ 38 × 19 mm)
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {(detail.packaging || []).map((pk: any, idx: number) => {
                              const capColors = [
                                "border-l-4 border-l-sky-600",
                                "border-l-4 border-l-amber-500",
                                "border-l-4 border-l-emerald-600",
                                "border-l-4 border-l-rose-600",
                                "border-l-4 border-l-purple-600",
                              ];
                              return (
                                <div
                                  key={pk.id}
                                  className={`bg-white text-slate-950 rounded-md border border-slate-900 shadow-sm p-2.5 space-y-1 ${capColors[idx % capColors.length]}`}
                                >
                                  <div className="flex items-center justify-between border-b border-slate-200 pb-1">
                                    <span className="text-[9.5px] font-black text-sky-900">ABT® IVD · Hộp {pk.box_no}</span>
                                    <span className="px-1.5 py-0.2 rounded bg-sky-100 text-sky-950 border border-sky-300 font-mono text-[9px] font-bold">
                                      🌡️ {pk.storage_temp || "-20°C"}
                                    </span>
                                  </div>
                                  <div className="text-xs font-black text-slate-950 leading-snug">{pk.component_name}</div>
                                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[10px] text-slate-800 pt-0.5">
                                    <div>
                                      <b>Vol:</b> {fmtQty(pk.fill_qty)} {pk.fill_uom}
                                    </div>
                                    <div>
                                      <b>LOT:</b> <span className="font-bold text-sky-900">{detail.order.lot_code}</span>
                                    </div>
                                    <div>
                                      <b>EXP:</b> <span className="text-rose-800 font-semibold">{fmtDate(detail.order.expiry_date)}</span>
                                    </div>
                                    <div>
                                      <b>Quy cách:</b> {pk.units_per_kit} ống/bộ
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Bảng 3: Bản in Tờ Hướng Dẫn Sử Dụng (IFU - Instructions For Use) đi kèm Hộp Kit */}
                    <div className="p-3.5 rounded-xl border-2 border-emerald-700 bg-emerald-50/30 dark:bg-emerald-950/20 text-xs space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-300 dark:border-emerald-800 pb-1.5">
                        <div className="font-extrabold text-emerald-950 dark:text-emerald-200 uppercase">
                          📖 TỜ HƯỚNG DẪN SỬ DỤNG ĐI KÈM BỘ KIT (IFU — {detail.order.ifu_code ?? `IFU-${detail.order.product_code}`})
                        </div>
                        <div className="font-mono text-[11px] text-emerald-800 dark:text-emerald-300">
                          Phiên bản: {detail.order.ifu_version ?? "Rev 01 (ISO 13485)"} · Áp dụng Lô: <b>{detail.order.lot_code}</b> (HSD: {fmtDate(detail.order.expiry_date)})
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-[11px]">
                        <div>
                          <div className="font-bold text-slate-800 dark:text-slate-100">1. Mục đích sử dụng (Intended Use):</div>
                          <div className="text-slate-700 dark:text-slate-300">
                            {detail.order.ifu_intended_use ??
                              "Bộ Kit xét nghiệm chẩn đoán in vitro (IVD) phát hiện và định lượng acid nucleic đặc hiệu bằng kỹ thuật Real-time PCR / RT-qPCR."}
                          </div>
                        </div>
                        <div>
                          <div className="font-bold text-slate-800 dark:text-slate-100">2. Kênh màu Huỳnh quang (Fluorescence Channels):</div>
                          <div className="text-slate-700 dark:text-slate-300 font-mono">
                            {detail.order.ifu_channels ?? "FAM: Đích tác nhân chính (Target) · HEX/VIC: Chứng nội (IC) · ROX: Tham chiếu"}
                          </div>
                        </div>
                        <div>
                          <div className="font-bold text-slate-800 dark:text-slate-100">3. Chương trình Chu kỳ nhiệt Real-time PCR (Thermal Profile):</div>
                          <div className="text-slate-700 dark:text-slate-300">
                            {detail.order.ifu_thermal_profile ??
                              "50°C × 10 phút (1 chu kỳ) ➔ 95°C × 3 phút (1 chu kỳ) ➔ 45 chu kỳ: [95°C × 15 giây + 60°C × 45 giây (Đọc tín hiệu tại 60°C)]."}
                          </div>
                        </div>
                        <div>
                          <div className="font-bold text-slate-800 dark:text-slate-100">4. Phiên giải Kết quả Ct (Result Interpretation):</div>
                          <div className="text-slate-700 dark:text-slate-300">
                            {detail.order.ifu_interpretation ??
                              "Dương tính: Ct (FAM) ≤ 38.0 · Âm tính: Không lên FAM và Ct (HEX/IC) ≤ 35.0 · Không hợp lệ: Không lên cả FAM và HEX/IC."}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {detail.order.lot_id && (
                  <div className="mt-3 pt-3 border-t border-stone-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-stone-700">
                        Tách lô / Chia lô thành phẩm (`kit.lot_split` — Đã tách {(detail.lot_splits || []).length} lô con)
                      </div>
                      <Button variant="ghost" onClick={() => setShowSplitForm((v) => !v)}>
                        {showSplitForm ? "Đóng tách lô" : "✂️ + Tách lô thành phẩm"}
                      </Button>
                    </div>
                    {(detail.lot_splits || []).length > 0 && (
                      <Table head={["Mã Lô con", "SL tách", "NSX → HSD", "Trạng thái lô con", "Lý do tách"]}>
                        {(detail.lot_splits || []).map((ls: any) => (
                          <tr key={ls.id}>
                            <td className="px-3 py-1.5 font-mono text-xs font-bold text-sky-700">{ls.child_lot_code}</td>
                            <td className="px-3 py-1.5 text-xs font-semibold">
                              {fmtQty(ls.split_qty)} {ls.uom}
                            </td>
                            <td className="px-3 py-1.5 text-xs">
                              {fmtDate(ls.mfg_date)} → {fmtDate(ls.expiry_date)}
                            </td>
                            <td className="px-3 py-1.5">
                              <StatusBadge status={ls.child_lot_status} />
                            </td>
                            <td className="px-3 py-1.5 text-xs text-stone-600">{ls.reason ?? "-"}</td>
                          </tr>
                        ))}
                      </Table>
                    )}
                    {showSplitForm && (
                      <form onSubmit={handleSplitLot} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800">
                        <Field label="Mã Lô con (Trống = tự sinh)">
                          <input
                            className={`${inputClass} font-mono`}
                            placeholder="VD: 010326-B"
                            value={splitForm.child_lot_code}
                            onChange={(e) => setSplitForm({ ...splitForm, child_lot_code: e.target.value })}
                          />
                        </Field>
                        <Field label={`SL tách (${detail.order.uom})`}>
                          <input
                            type="number"
                            step="any"
                            className={inputClass}
                            value={splitForm.split_qty}
                            onChange={(e) => setSplitForm({ ...splitForm, split_qty: e.target.value })}
                            required
                          />
                        </Field>
                        <Field label="NSX lô con (Tùy chọn)">
                          <input
                            type="date"
                            className={inputClass}
                            value={splitForm.mfg_date}
                            onChange={(e) => setSplitForm({ ...splitForm, mfg_date: e.target.value })}
                          />
                        </Field>
                        <Field label="Lý do tách lô">
                          <input
                            className={inputClass}
                            value={splitForm.reason}
                            onChange={(e) => setSplitForm({ ...splitForm, reason: e.target.value })}
                          />
                        </Field>
                        <Button type="submit">
                          Xác nhận Tách lô
                        </Button>
                      </form>
                    )}
                  </div>
                )}
              </Card>

              <Card
                title={`1. Cấp phát FEFO & Quyết toán tiêu hao nguyên vật liệu (${detail.consumptions.length} dòng)`}
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    {detail.order.materials_issued ? (
                      <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-900 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                        ✅ Đã xuất kho NVL theo FEFO ({detail.order.warehouse_code})
                      </span>
                    ) : (
                      ["CONFIRMED", "IN_PROGRESS"].includes(detail.order.status) && (
                        <Button onClick={handleIssueMaterials}>
                          📦 Xuất kho nguyên vật liệu theo FEFO (Tự động trừ tồn lô)
                        </Button>
                      )
                    )}
                    <Button variant="secondary" onClick={() => printProductionWorksheet(detail)}>
                      🖨️ In Phiếu Sản Xuất &amp; Bảng Lô NVL
                    </Button>
                  </div>
                }
              >
                {detail.consumptions.length === 0 ? (
                  <Empty>Xác nhận lệnh sản xuất để hệ thống tự động phân bổ lô nguyên vật liệu theo FEFO.</Empty>
                ) : (
                  <Table
                    head={[
                      "Hộp / Vai trò",
                      "Vật tư / Bán TP",
                      "Lô FEFO & Hạn dùng",
                      "Định mức",
                      "Đã xuất",
                      "Thực dùng & Giải trình",
                    ]}
                  >
                    {detail.consumptions.map((c: any) => (
                      <ConsumptionRow
                        key={c.id}
                        row={c}
                        locked={["COMPLETED", "CANCELLED"].includes(detail.order.status)}
                        onSave={handleReconcile}
                      />
                    ))}
                  </Table>
                )}
              </Card>

              <Card title={`2. Hồ sơ lô điện tử — EBR (${detail.steps.length} bước công đoạn & Chốt chặn QC xen kẽ)`}>
                {detail.steps.length === 0 ? (
                  <Empty>Bấm &ldquo;Xác nhận lệnh &amp; Giữ chỗ nguyên liệu (FEFO)&rdquo; ở trên để hệ thống khởi tạo các bước Hồ sơ lô (EBR) từ Quy trình (Routing).</Empty>
                ) : (
                  <div className="space-y-3">
                    {detail.steps.map((s: any) => {
                      const schema: any[] = Array.isArray(s.param_schema) ? s.param_schema : [];
                      const curVals = { ...(s.param_values || {}), ...(stepParams[s.id] || {}) };
                      const blockingPrevQc = (detail.steps || []).find(
                        (prev: any) => prev.seq < s.seq && prev.is_qc && prev.qc_gate_status !== "PASSED"
                      );
                      const opEdit = operatorEdits[s.id] ?? {
                        assigned_to_name: s.assigned_to_name ?? "",
                        shift_code: s.shift_code ?? "CA_SANG",
                        planned_date: s.planned_date
                          ? String(s.planned_date).slice(0, 10)
                          : vnToday(),
                      };

                      return (
                        <div
                          key={s.id}
                          className={`p-3 rounded-xl border space-y-2.5 ${
                            s.is_qc
                              ? "border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20"
                              : "border-stone-200 dark:border-slate-800 bg-stone-50/60 dark:bg-slate-900/40"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs font-bold text-stone-800 dark:text-slate-100 flex flex-wrap items-center gap-1.5">
                              <span>
                                Bước {s.seq}: {s.step_code} — {s.step_name}
                              </span>
                              <span className="font-normal text-stone-500">
                                ({STEP_CATEGORY_LABELS[s.category] ?? s.category})
                              </span>
                              {s.is_qc && (
                                <span
                                  title="Bước Kiểm soát Chất lượng Trung gian Xen kẽ (IPQC Gate): Các bước công đoạn phía sau sẽ bị khóa cho tới khi bước này được QA/QC xác nhận thông qua"
                                  className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-200/80 text-amber-950 dark:bg-amber-900/70 dark:text-amber-200"
                                >
                                  🛡️ BƯỚC QC XEN KẼ (IPQC GATE)
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {s.deviation_code && (
                                <span className="px-2 py-0.5 text-[11px] rounded bg-red-100 text-red-800 font-mono">
                                  Sai lệch: {s.deviation_code}
                                </span>
                              )}
                              <StatusBadge status={s.status} />
                            </div>
                          </div>

                          {blockingPrevQc && s.status === "PENDING" && (
                            <div className="p-2 rounded-lg border border-rose-300 bg-rose-50/80 dark:bg-rose-950/30 dark:border-rose-800 text-xs text-rose-900 dark:text-rose-200 font-medium">
                              🔒 <b>Đang khóa tự động:</b> Bước này chưa thể bắt đầu vì bước QC xen kẽ phía trước (
                              <b>
                                Bước #{blockingPrevQc.seq}: {blockingPrevQc.step_name}
                              </b>
                              ) chưa được bộ phận QA/QC xác nhận thông qua.
                            </div>
                          )}

                          <div className="text-xs text-stone-600 dark:text-slate-300">{s.instructions}</div>

                          {/* Thanh Phân công Nhân viên & Ca trực cho bước công đoạn */}
                          <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-slate-700 dark:text-slate-300">
                                👨‍🔬 Nhân viên phụ trách &amp; Ca trực:
                              </span>
                              <input
                                list={`preset-operators-${s.id}`}
                                className={`${inputClass} !w-64 !py-1 text-xs`}
                                placeholder="Nhập hoặc chọn nhân viên thực hiện..."
                                value={opEdit.assigned_to_name}
                                onChange={(e) =>
                                  setOperatorEdits((prev) => ({
                                    ...prev,
                                    [s.id]: { ...opEdit, assigned_to_name: e.target.value },
                                  }))
                                }
                              />
                              <datalist id={`preset-operators-${s.id}`}>
                                {deptOperatorOptions.map((op) => (
                                  <option key={op} value={op} />
                                ))}
                              </datalist>
                              <select
                                className={`${inputClass} !w-44 !py-1 text-xs`}
                                value={opEdit.shift_code}
                                onChange={(e) =>
                                  setOperatorEdits((prev) => ({
                                    ...prev,
                                    [s.id]: { ...opEdit, shift_code: e.target.value },
                                  }))
                                }
                              >
                                {Object.entries(SHIFT_LABELS).map(([k, lbl]) => (
                                  <option key={k} value={k}>
                                    {lbl}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="date"
                                className={`${inputClass} !w-36 !py-1 text-xs`}
                                value={opEdit.planned_date}
                                onChange={(e) =>
                                  setOperatorEdits((prev) => ({
                                    ...prev,
                                    [s.id]: { ...opEdit, planned_date: e.target.value },
                                  }))
                                }
                              />
                              <Button
                                variant="secondary"
                                title="Lưu phân công nhân viên và ca sản xuất cho bước công đoạn này để theo dõi trên Bảng kế hoạch PO hằng ngày"
                                onClick={() => handleAssignOperator(detail.order.id, s)}
                              >
                                💾 Lưu phân công
                              </Button>
                            </div>
                            <div className="flex flex-wrap gap-3 text-[11px] text-stone-500">
                              {s.sop_doc_code && <span title="Quy trình thao tác chuẩn (Standard Operating Procedure)">SOP: {s.sop_doc_code}</span>}
                              {s.asset_code && (
                                <span>
                                  Thiết bị: {s.asset_code} ({s.asset_name})
                                </span>
                              )}
                              {s.started_at && <span>Bắt đầu: {fmtDateTime(s.started_at)}</span>}
                              {s.completed_at && <span>Hoàn tất: {fmtDateTime(s.completed_at)}</span>}
                              {s.performed_by_name && <span>Người thực hiện: <b>{s.performed_by_name}</b></span>}
                              {s.checked_by_name && <span>Người kiểm tra chéo: <b>{s.checked_by_name}</b></span>}
                            </div>
                          </div>

                          {schema.length > 0 && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1">
                              {schema.map((f: any) => (
                                <Field
                                  key={f.key}
                                  label={`${f.label} (Chuẩn: ${f.min ?? "-"}..${f.max ?? "-"} ${f.unit ?? ""})`}
                                >
                                  <input
                                    className={inputClass}
                                    disabled={s.status === "DONE"}
                                    placeholder={`Nhập ${f.label}...`}
                                    value={String(curVals[f.key] ?? "")}
                                    onChange={(e) =>
                                      setStepParams((prev) => ({
                                        ...prev,
                                        [s.id]: { ...(prev[s.id] || {}), [f.key]: e.target.value },
                                      }))
                                    }
                                  />
                                </Field>
                              ))}
                            </div>
                          )}

                          {/* Hộp Chốt Chặn Kiểm Soát Chất Lượng Xen Kẽ (IPQC Gate) */}
                          {s.is_qc && (
                            <div
                              className={`p-3 rounded-xl border-2 space-y-2 text-xs ${
                                s.qc_gate_status === "PASSED"
                                  ? "border-emerald-400 bg-emerald-50/70 dark:bg-emerald-950/30 dark:border-emerald-800"
                                  : s.qc_gate_status === "REJECTED"
                                    ? "border-rose-400 bg-rose-50/70 dark:bg-rose-950/30 dark:border-rose-800"
                                    : "border-amber-400 bg-amber-50/80 dark:bg-amber-950/30 dark:border-amber-700"
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="font-extrabold flex items-center gap-2">
                                  <span>🛡️ CỔNG KIỂM SOÁT CHẤT LƯỢNG XEN KẼ (IPQC GATE — CẦN QC XÁC NHẬN THÔNG QUA ĐỂ TIẾP TỤC):</span>
                                  {s.qc_gate_status === "PASSED" ? (
                                    <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[11px]">
                                      ✅ ĐÃ ĐƯỢC QC XÁC NHẬN THÔNG QUA (ĐÃ MỞ KHÓA BƯỚC TIẾP THEO)
                                    </span>
                                  ) : s.qc_gate_status === "REJECTED" ? (
                                    <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white text-[11px]">
                                      ❌ QC TỪ CHỐI THÔNG QUA — YÊU CẦU PHA CHỈNH LẠI
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-full bg-amber-600 text-white text-[11px]">
                                      ⏳ ĐANG CHỜ QC XÁC NHẬN THÔNG QUA
                                    </span>
                                  )}
                                </div>
                                {s.qc_verified_by_name ? (
                                  <div className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                                    Người xác nhận QC: <b>{s.qc_verified_by_name}</b> ({fmtDateTime(s.qc_verified_at)})
                                  </div>
                                ) : (
                                  <div className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                                    QA phụ trách giám sát:{" "}
                                    <b>{s.qa_assignee_name ?? detail.order.qa_assignee_name ?? "Chưa phân công (Phòng QA/QC phân bổ)"}</b>
                                  </div>
                                )}
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                                <div className="md:col-span-5">
                                  <Field label="Nhận xét / Kết luận kiểm tra của QC hoặc Tổ Sản xuất">
                                    <input
                                      className={inputClass}
                                      placeholder="VD: Độ pH đạt 8.32, tín hiệu khuếch đại chuẩn đạt yêu cầu, cho phép chia lẻ..."
                                      value={qcGateNotes[s.id] ?? s.qc_gate_note ?? ""}
                                      onChange={(e) =>
                                        setQcGateNotes((prev) => ({ ...prev, [s.id]: e.target.value }))
                                      }
                                    />
                                  </Field>
                                </div>
                                <div className="md:col-span-7 flex flex-wrap gap-1.5">
                                  {s.qc_gate_status !== "PASSED" && (
                                    <Button
                                      variant="secondary"
                                      title="Tổ Sản xuất gửi mẫu bán thành phẩm và thông báo đẩy sang Phòng Đảm bảo & Kiểm soát Chất lượng (QA/QC) để yêu cầu xác nhận thông qua bước này"
                                      onClick={() => handleVerifyQcGate(detail.order.id, s, "REQUEST_QC", curVals)}
                                    >
                                      📤 Gửi mẫu yêu cầu QC xác nhận thông qua
                                    </Button>
                                  )}
                                  <Button
                                    title="Chuyên viên QA/QC xác nhận bán thành phẩm ĐẠT chất lượng trung gian (IPQC), tự động hoàn tất bước này và mở khóa cho phép chạy bước công đoạn kế tiếp"
                                    onClick={() => handleVerifyQcGate(detail.order.id, s, "PASS", curVals)}
                                  >
                                    🛡️ QC Xác nhận Thông qua (Cho phép chạy bước kế tiếp)
                                  </Button>
                                  <Button
                                    variant="danger"
                                    title="Chuyên viên QA/QC từ chối thông qua do thông số chưa đạt chuẩn, giữ khóa bước tiếp theo và yêu cầu Tổ Sản xuất pha chỉnh lại"
                                    onClick={() => handleVerifyQcGate(detail.order.id, s, "REJECT", curVals)}
                                  >
                                    ❌ QC Từ chối Thông qua (Yêu cầu chỉnh lại)
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )}

                          <ActionBar
                            endpoint={`/api/factory/kit/steps/${s.id}/actions`}
                            version={s.version}
                            actions={s.allowed_actions}
                            labels={ACTION_LABELS}
                            extraPayload={{ param_values: curVals }}
                            onDone={() => {
                              loadDetail(detail.order.id);
                              loadOrders();
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              <Card
                title={`3. Làm lại một phần / Thay thế Hộp thành phần (${detail.reworks.length})`}
                actions={
                  <Button variant="ghost" onClick={() => setShowReworkForm((v) => !v)}>
                    {showReworkForm ? "Đóng form Rework" : "+ Lập lệnh làm lại (Rework)"}
                  </Button>
                }
              >
                {detail.reworks.length === 0 && !showReworkForm && (
                  <Empty>Chưa có lệnh làm lại (Rework) nào cho lô sản xuất này.</Empty>
                )}
                {detail.reworks.length > 0 && (
                  <Table head={["Mã RW", "Phạm vi", "Vật tư cấp bù", "Lô xuất bù", "Trạng thái", "Thao tác"]}>
                    {detail.reworks.map((rw: any) => (
                      <tr key={rw.id}>
                        <td className="px-3 py-2 font-mono text-xs font-semibold">{rw.code}</td>
                        <td className="px-3 py-2 text-xs">
                          {rw.scope === "PARTIAL" ? `Hộp ${rw.box_no}` : "Toàn bộ"} — {rw.instructions}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {rw.component_code ? `${rw.component_code} (${fmtQty(rw.qty_to_rework)} ${rw.uom})` : "-"}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{rw.used_lot_code ?? "-"}</td>
                        <td className="px-3 py-2">
                          <StatusBadge status={rw.status} />
                        </td>
                        <td className="px-3 py-2">
                          <ActionBar
                            endpoint={`/api/factory/kit/reworks/${rw.id}/actions`}
                            version={rw.version}
                            actions={rw.allowed_actions || []}
                            labels={ACTION_LABELS}
                            onDone={() => {
                              loadDetail(detail.order.id);
                              loadOrders();
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </Table>
                )}

                {showReworkForm && (
                  <form onSubmit={handleCreateRework} className="mt-3 pt-3 border-t border-stone-200 space-y-2">
                    <div className="text-xs font-semibold text-stone-700">
                      Tạo lệnh làm lại (Rework) — Hỗ trợ thay thế riêng một Hộp thành phần trong Bộ Kit nhiều hộp
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                      <Field label="Phạm vi & Hộp số">
                        <div className="flex gap-1">
                          <select
                            className={inputClass}
                            value={rwForm.scope}
                            onChange={(e) => setRwForm({ ...rwForm, scope: e.target.value })}
                          >
                            <option value="PARTIAL">Một phần (Theo Hộp)</option>
                            <option value="FULL">Toàn bộ Bộ Kit</option>
                          </select>
                          {rwForm.scope === "PARTIAL" && (
                            <input
                              type="number"
                              className={`${inputClass} w-16`}
                              value={rwForm.box_no}
                              onChange={(e) => setRwForm({ ...rwForm, box_no: e.target.value })}
                            />
                          )}
                        </div>
                      </Field>
                      <Field label="Vật tư / Bán TP xuất bù (FEFO)">
                        <select
                          className={inputClass}
                          value={rwForm.component_item_id}
                          onChange={(e) => {
                            const it = options.items.find((x) => x.id === e.target.value);
                            setRwForm({ ...rwForm, component_item_id: e.target.value, uom: it?.base_uom ?? "" });
                          }}
                        >
                          <option value="">-- Chọn thành phần thay thế --</option>
                          {options.items.map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.code} — {i.name} ({i.base_uom})
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Số lượng bù & ĐVT">
                        <div className="flex gap-1">
                          <input
                            type="number"
                            step="any"
                            className={inputClass}
                            value={rwForm.qty_to_rework}
                            onChange={(e) => setRwForm({ ...rwForm, qty_to_rework: e.target.value })}
                            required
                          />
                          <input
                            className={`${inputClass} w-20`}
                            value={rwForm.uom}
                            onChange={(e) => setRwForm({ ...rwForm, uom: e.target.value })}
                            placeholder="ĐVT"
                          />
                        </div>
                      </Field>
                      <Field label="Hướng dẫn xử lý">
                        <input
                          className={inputClass}
                          value={rwForm.instructions}
                          onChange={(e) => setRwForm({ ...rwForm, instructions: e.target.value })}
                          required
                        />
                      </Field>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="ghost" onClick={() => setShowReworkForm(false)}>
                        Hủy
                      </Button>
                      <Button type="submit">
                        Lập lệnh làm lại (Rework)
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

function DailyOperatorTrackerSection({
  dailySteps,
  operatorOptions,
  dailyShiftFilter,
  setDailyShiftFilter,
  dailyStatusFilter,
  setDailyStatusFilter,
  dailySearch,
  setDailySearch,
  operatorEdits,
  setOperatorEdits,
  qcGateNotes,
  setQcGateNotes,
  onAssignOperator,
  onVerifyQcGate,
  onOpenOrderEbr,
}: {
  dailySteps: any[];
  operatorOptions: string[];
  dailyShiftFilter: string;
  setDailyShiftFilter: (v: string) => void;
  dailyStatusFilter: string;
  setDailyStatusFilter: (v: string) => void;
  dailySearch: string;
  setDailySearch: (v: string) => void;
  operatorEdits: Record<string, { assigned_to_name: string; shift_code: string; planned_date: string }>;
  setOperatorEdits: React.Dispatch<
    React.SetStateAction<Record<string, { assigned_to_name: string; shift_code: string; planned_date: string }>>
  >;
  qcGateNotes: Record<string, string>;
  setQcGateNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onAssignOperator: (orderId: string, step: any) => void;
  onVerifyQcGate: (orderId: string, step: any, decision: "REQUEST_QC" | "PASS" | "REJECT") => void;
  onOpenOrderEbr: (orderId: string) => void;
}) {
  const totalSteps = dailySteps.length;
  const doneSteps = dailySteps.filter((s) => s.status === "DONE" || s.status === "SKIPPED").length;
  const inProgressSteps = dailySteps.filter((s) => s.status === "IN_PROGRESS" || s.status === "AWAITING_CHECK").length;
  const waitingQcSteps = dailySteps.filter((s) => s.is_qc && s.qc_gate_status !== "PASSED").length;

  // Tổng hợp năng suất theo từng nhân viên
  const operatorStatsMap = new Map<
    string,
    { name: string; shift: string; total: number; inProgress: number; waitingQc: number; done: number }
  >();
  for (const s of dailySteps) {
    const name = s.assigned_to_name || "Chưa phân công";
    const cur = operatorStatsMap.get(name) ?? {
      name,
      shift: SHIFT_LABELS[s.shift_code] ?? "Ca sáng",
      total: 0,
      inProgress: 0,
      waitingQc: 0,
      done: 0,
    };
    cur.total += 1;
    if (s.status === "DONE" || s.status === "SKIPPED") cur.done += 1;
    else if (s.status === "IN_PROGRESS" || s.status === "AWAITING_CHECK") cur.inProgress += 1;
    if (s.is_qc && s.qc_gate_status !== "PASSED") cur.waitingQc += 1;
    operatorStatsMap.set(name, cur);
  }
  const operatorStats = Array.from(operatorStatsMap.values());

  const filteredSteps = dailySteps.filter((s) => {
    if (dailyShiftFilter !== "ALL" && (s.shift_code || "CA_SANG") !== dailyShiftFilter) return false;
    if (dailyStatusFilter === "WAITING_QC" && !(s.is_qc && s.qc_gate_status !== "PASSED")) return false;
    if (dailyStatusFilter === "IN_PROGRESS" && !["IN_PROGRESS", "AWAITING_CHECK"].includes(s.status)) return false;
    if (dailyStatusFilter === "DONE" && !["DONE", "SKIPPED"].includes(s.status)) return false;
    if (dailySearch.trim()) {
      const q = dailySearch.toLowerCase();
      const hay = `${s.order_code} ${s.product_code} ${s.lot_code ?? ""} ${s.kd_po_code ?? ""} ${s.internal_order_code ?? ""} ${s.assigned_to_name ?? ""} ${s.step_name}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      {/* KPI Ca sản xuất & Chốt chặn QC trong ngày */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="text-[11px] text-slate-500">Tổng công đoạn theo PO trong ngày</div>
          <div className="text-lg font-extrabold text-slate-900 dark:text-white">{totalSteps} bước</div>
        </div>
        <div className="p-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/30">
          <div className="text-[11px] text-sky-700 dark:text-sky-300">Đang thực hiện / Chờ kiểm tra chéo</div>
          <div className="text-lg font-extrabold text-sky-900 dark:text-sky-200">{inProgressSteps} bước</div>
        </div>
        <div className="p-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30">
          <div className="text-[11px] text-amber-800 dark:text-amber-300">🛡️ Bước QC xen kẽ chờ QC xác nhận thông qua</div>
          <div className="text-lg font-extrabold text-amber-900 dark:text-amber-200">{waitingQcSteps} cổng IPQC</div>
        </div>
        <div className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30">
          <div className="text-[11px] text-emerald-700 dark:text-emerald-300">Đã hoàn tất trong ca</div>
          <div className="text-lg font-extrabold text-emerald-900 dark:text-emerald-200">
            {doneSteps}/{totalSteps} ({totalSteps ? Math.round((doneSteps / totalSteps) * 100) : 0}%)
          </div>
        </div>
      </div>

      {/* Bảng 1: Tổng hợp khối lượng công việc & tiến độ theo từng Nhân viên */}
      <Card title={`1. Bảng Tổng Hợp Phân Công & Năng Suất Nhân Viên Theo Ca (${operatorStats.length} nhân sự)`}>
        {operatorStats.length === 0 ? (
          <Empty>Chưa có công đoạn nào được khởi tạo. Hãy xác nhận Lệnh sản xuất để hệ thống phân bổ công đoạn cho nhân viên.</Empty>
        ) : (
          <Table head={["Nhân viên phụ trách / Tổ chuyên môn", "Ca làm việc chính", "Tổng bước được giao", "Đang thực hiện", "Chờ QC thông qua", "Đã hoàn tất", "Tỷ lệ hoàn thành"]}>
            {operatorStats.map((op) => {
              const pct = op.total ? Math.round((op.done / op.total) * 100) : 0;
              return (
                <tr
                  key={op.name}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  onClick={() => setDailySearch(op.name)}
                >
                  <td className="px-3 py-2 text-xs font-bold text-sky-800 dark:text-sky-300">👨‍🔬 {op.name}</td>
                  <td className="px-3 py-2 text-xs">{op.shift}</td>
                  <td className="px-3 py-2 text-xs font-mono font-semibold">{op.total} bước</td>
                  <td className="px-3 py-2 text-xs font-mono text-sky-700 font-bold">{op.inProgress}</td>
                  <td className="px-3 py-2 text-xs font-mono text-amber-700 font-bold">{op.waitingQc}</td>
                  <td className="px-3 py-2 text-xs font-mono text-emerald-700 font-bold">{op.done}</td>
                  <td className="px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="font-mono font-semibold">{pct}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {/* Bảng 2: Bảng Điều độ & Giám sát chi tiết từng bước công đoạn theo PO hằng ngày */}
      <Card
        title={`2. Bảng Giám Sát Nhân Viên Triển Khai Kế Hoạch Sản Xuất Theo PO Hằng Ngày (${filteredSteps.length} bước)`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={`${inputClass} !w-44 !py-1 text-xs`}
              value={dailyShiftFilter}
              onChange={(e) => setDailyShiftFilter(e.target.value)}
            >
              <option value="ALL">Tất cả ca làm việc</option>
              <option value="CA_SANG">🌅 Ca sáng (07:30–16:30)</option>
              <option value="CA_CHIEU">🌇 Ca chiều (13:30–21:30)</option>
              <option value="CA_TOI">🌙 Ca tối / Tăng ca</option>
            </select>
            <select
              className={`${inputClass} !w-52 !py-1 text-xs`}
              value={dailyStatusFilter}
              onChange={(e) => setDailyStatusFilter(e.target.value)}
            >
              <option value="ALL">Tất cả trạng thái công đoạn</option>
              <option value="WAITING_QC">🛡️ Đang chờ QC xác nhận thông qua</option>
              <option value="IN_PROGRESS">⚡ Đang thực hiện / Chờ kiểm tra</option>
              <option value="DONE">✅ Đã hoàn tất</option>
            </select>
            <input
              className={`${inputClass} !w-56 !py-1 text-xs`}
              placeholder="Tìm PO, Mã lệnh, Lô, Nhân viên..."
              value={dailySearch}
              onChange={(e) => setDailySearch(e.target.value)}
            />
            {dailySearch && (
              <Button variant="ghost" onClick={() => setDailySearch("")}>
                Xóa lọc
              </Button>
            )}
          </div>
        }
      >
        {filteredSteps.length === 0 ? (
          <Empty>Không có công đoạn nào khớp với bộ lọc hiện tại.</Empty>
        ) : (
          <Table
            head={[
              "Đơn PO / Lệnh SX & Lô",
              "Bước công đoạn EBR",
              "Nhân viên phụ trách & Ca trực",
              "Giờ thực hiện & Thông số đo",
              "Trạng thái & Cổng QC Xen Kẽ (IPQC)",
              "Thao tác điều độ & Xác nhận QC",
            ]}
          >
            {filteredSteps.map((s) => {
              const opEdit = operatorEdits[s.id] ?? {
                assigned_to_name: s.assigned_to_name ?? "",
                shift_code: s.shift_code ?? "CA_SANG",
                planned_date: s.planned_date ? String(s.planned_date).slice(0, 10) : new Date().toISOString().slice(0, 10),
              };
              const paramEntries = Object.entries(s.param_values || {});
              return (
                <tr key={s.id} className={s.is_qc && s.qc_gate_status !== "PASSED" ? "bg-amber-50/40 dark:bg-amber-950/20" : ""}>
                  <td className="px-3 py-2 text-xs">
                    <div className="font-mono font-bold text-sky-700 dark:text-sky-400">
                      {s.order_code} · {s.product_code}
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300">
                      Lô: <b className="font-mono">{s.lot_code ?? "Chưa cấp"}</b> ({fmtQty(s.planned_qty)} {s.uom})
                    </div>
                    {s.kd_po_code && (
                      <div className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
                        📦 PO: {s.kd_po_code} ({s.internal_order_code})
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div className="font-bold text-slate-800 dark:text-slate-100">
                      Bước #{s.seq}: {s.step_name}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      {s.step_code} · {STEP_CATEGORY_LABELS[s.category] ?? s.category}
                    </div>
                    {s.asset_code && (
                      <div className="text-[11px] text-slate-500">
                        🔧 Máy: {s.asset_code} ({s.asset_name})
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs space-y-1">
                    <input
                      list={`daily-op-${s.id}`}
                      className={`${inputClass} !py-1 text-xs`}
                      value={opEdit.assigned_to_name}
                      onChange={(e) =>
                        setOperatorEdits((prev) => ({
                          ...prev,
                          [s.id]: { ...opEdit, assigned_to_name: e.target.value },
                        }))
                      }
                    />
                    <datalist id={`daily-op-${s.id}`}>
                      {operatorOptions.map((op) => (
                        <option key={op} value={op} />
                      ))}
                    </datalist>
                    <div className="flex items-center gap-1">
                      <select
                        className={`${inputClass} !py-1 text-[11px]`}
                        value={opEdit.shift_code}
                        onChange={(e) =>
                          setOperatorEdits((prev) => ({
                            ...prev,
                            [s.id]: { ...opEdit, shift_code: e.target.value },
                          }))
                        }
                      >
                        {Object.entries(SHIFT_LABELS).map(([k, lbl]) => (
                          <option key={k} value={k}>
                            {lbl}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="ghost"
                        title="Cập nhật nhân viên phụ trách và ca làm việc cho bước công đoạn này"
                        onClick={() => onAssignOperator(s.order_id, s)}
                      >
                        Lưu
                      </Button>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs space-y-0.5">
                    <div>
                      Bắt đầu: <b>{s.started_at ? fmtDateTime(s.started_at) : "Chưa bắt đầu"}</b>
                    </div>
                    <div>
                      Hoàn tất: <b>{s.completed_at ? fmtDateTime(s.completed_at) : "-"}</b>
                    </div>
                    {s.performed_by_name && <div className="text-[11px] text-slate-500">Thực hiện: {s.performed_by_name}</div>}
                    {s.checked_by_name && <div className="text-[11px] text-slate-500">Kiểm tra: {s.checked_by_name}</div>}
                    {paramEntries.length > 0 && (
                      <div className="pt-1 flex flex-wrap gap-1">
                        {paramEntries.map(([k, v]) => (
                          <span key={k} className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-900 font-mono text-[10px]">
                            {k}: {String(v)}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs space-y-1">
                    <div>
                      <StatusBadge status={s.status} />
                    </div>
                    {s.is_qc && (
                      <div className="pt-0.5">
                        {s.qc_gate_status === "PASSED" ? (
                          <span
                            title="Bước QC xen kẽ đã được QA/QC xác nhận thông qua — Dây chuyền được phép chạy bước tiếp theo"
                            className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-bold text-[10px]"
                          >
                            🛡️ QC Đã thông qua ({s.qc_verified_by_name ?? "QA/QC"})
                          </span>
                        ) : s.qc_gate_status === "REJECTED" ? (
                          <span
                            title="Bước QC xen kẽ bị từ chối — Khóa bước tiếp theo, yêu cầu pha chỉnh lại"
                            className="inline-block px-2 py-0.5 rounded bg-rose-100 text-rose-900 font-bold text-[10px]"
                          >
                            ❌ QC Từ chối thông qua
                          </span>
                        ) : (
                          <span
                            title="Bước QC xen kẽ đang chờ QA/QC xác nhận thông qua để mở khóa bước tiếp theo"
                            className="inline-block px-2 py-0.5 rounded bg-amber-200 text-amber-950 font-bold text-[10px]"
                          >
                            ⏳ Chờ QC xác nhận thông qua (IPQC)
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div className="flex flex-col gap-1.5">
                      {s.is_qc && s.qc_gate_status !== "PASSED" && (
                        <>
                          <input
                            className={`${inputClass} !py-1 text-[11px]`}
                            placeholder="Ghi chú xác nhận QC (VD: pH=8.32 đạt)..."
                            value={qcGateNotes[s.id] ?? s.qc_gate_note ?? ""}
                            onChange={(e) => setQcGateNotes((prev) => ({ ...prev, [s.id]: e.target.value }))}
                          />
                          <div className="flex flex-wrap gap-1">
                            <Button
                              variant="secondary"
                              title="Gửi yêu cầu và thông báo đẩy sang Phòng QA/QC để xác nhận thông qua bước kiểm soát trung gian này"
                              onClick={() => onVerifyQcGate(s.order_id, s, "REQUEST_QC")}
                            >
                              📤 Gửi chờ QC
                            </Button>
                            <Button
                              title="QA/QC xác nhận thông qua bước QC xen kẽ này (Đạt IPQC) và mở khóa cho phép chạy bước công đoạn tiếp theo"
                              onClick={() => onVerifyQcGate(s.order_id, s, "PASS")}
                            >
                              🛡️ QC Xác nhận Thông qua
                            </Button>
                            <Button
                              variant="danger"
                              title="QA/QC từ chối thông qua bước này và giữ khóa bước kế tiếp"
                              onClick={() => onVerifyQcGate(s.order_id, s, "REJECT")}
                            >
                              ❌ Từ chối
                            </Button>
                          </div>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        title="Mở chi tiết Hồ sơ lô điện tử (EBR) của Lệnh sản xuất này để nhập thông số và ký điện tử"
                        onClick={() => onOpenOrderEbr(s.order_id)}
                      >
                        🔎 Mở Hồ sơ Lô (EBR)
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}

function ConsumptionRow({
  row,
  locked,
  onSave,
}: {
  row: any;
  locked: boolean;
  onSave: (row: any, actual: string, reason: string) => void;
}) {
  const [actual, setActual] = useState(String(row.actual_qty ?? row.planned_qty));
  const [reason, setReason] = useState(row.variance_reason ?? "");
  useEffect(() => {
    setActual(String(row.actual_qty ?? row.planned_qty));
    setReason(row.variance_reason ?? "");
  }, [row.actual_qty, row.planned_qty, row.variance_reason]);

  const variance = Number(row.variance_pct || 0);
  return (
    <tr>
      <td className="px-3 py-2 text-xs">
        <div className="font-medium">Hộp {row.box_no}</div>
        <div className="text-stone-500">{ROLE_LABELS[row.component_role] ?? row.component_role}</div>
      </td>
      <td className="px-3 py-2 text-xs">
        <span className="font-mono font-semibold">{row.item_code}</span> — {row.item_name}
      </td>
      <td className="px-3 py-2 text-xs font-mono">
        {row.lot_code} (HSD: {fmtDate(row.expiry_date)})
      </td>
      <td className="px-3 py-2 text-xs">
        {fmtQty(row.planned_qty)} {row.uom}
      </td>
      <td className="px-3 py-2 text-xs">
        {fmtQty(row.issued_qty)} {row.uom}
      </td>
      <td className="px-3 py-2 text-xs">
        <div className="flex items-center gap-1">
          <input
            type="number"
            step="any"
            disabled={locked}
            className={`${inputClass} w-24`}
            value={actual}
            onChange={(e) => setActual(e.target.value)}
          />
          <input
            disabled={locked}
            className={`${inputClass} w-36`}
            placeholder="Lý do chênh lệch"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {!locked && (
            <Button variant="ghost" onClick={() => onSave(row, actual, reason)}>
              Lưu ({variance > 0 ? `+${variance}%` : `${variance}%`})
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

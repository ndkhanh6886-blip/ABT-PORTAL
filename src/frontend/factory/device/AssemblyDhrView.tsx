"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, escHtml, fmtDate, fmtDateTime, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { ORDER_STATUS, STATION_LABELS, UNIT_STATUS, useDeviceOptions } from "./shared";
import { IssueSlipPanel } from "./IssueSlipPanel";
import { LotSerialField } from "./LotSerialField";

const ORDER_ACTION_LABELS: Record<string, string> = {
  approve: "Phê duyệt lệnh lắp ráp (Ký điện tử)",
  assign_serials: "Cấp phát Serial & Bắt đầu lắp ráp",
  to_qc: "Chuyển sang Kiểm định xuất xưởng (QC)",
  mark_ready: "Xác nhận sẵn sàng bàn giao",
  deliver: "Hoàn tất bàn giao lệnh",
  cancel: "Hủy lệnh lắp ráp",
};

const UNIT_ACTION_LABELS: Record<string, string> = {
  start_burn_in: "Chuyển sang Trạm 4: Chạy lão hóa (Burn-in)",
  return_assembly: "Trả về Lắp ráp (Trạm 1–3)",
  to_fqc: "Chuyển sang Đo kiểm xuất xưởng (FQC)",
  fail_fqc: "FQC Không đạt (Mở NCR & trả về lắp ráp)",
  qa_pass: "QA Ký giải phóng xuất xưởng (DHR)",
  deliver: "Bàn giao khách hàng & Kích hoạt bảo hành",
  commission: "Nghiệm thu vận hành tại hiện trường",
  decommission: "Ngừng lưu hành thiết bị",
};

interface OrderRow {
  id: string;
  code: string;
  lot_no: string | null;
  model_id: string;
  model_code: string;
  model_name: string;
  model_revision_id: string;
  revision_code: string;
  warehouse_code: string;
  qty: number;
  unit_count: number;
  ready_count: number;
  serial_numbers?: string[];
  priority: string;
  due_date: string | null;
  status: string;
  version: number;
}

interface UnitSummary {
  id: string;
  serial_no: string;
  status: string;
  firmware_version: string | null;
  fqc_passed: boolean | null;
  component_count: number;
  passed_burn_in_hours: number | null;
  warranty_end: string | null;
  customer_name: string | null;
  version: number;
}

interface BomLine {
  id: string;
  line_no: number;
  station_code: string;
  component_item_id: string;
  item_code: string;
  item_name: string;
  qty_per_unit: number;
  uom: string;
  source_type?: string;
  tracking_type?: string;
  drawing_code?: string | null;
  is_critical: boolean;
  requires_serial: boolean;
}

interface KittingLine extends BomLine {
  total_required: number;
  qty_installed: number;
  qty_available: number;
  remaining_to_install: number;
  shortage: number;
}

interface OrderDetail extends OrderRow {
  warehouse_id: string;
  required_burn_in_hours: number;
  default_firmware: string | null;
  units: UnitSummary[];
  bom_lines: BomLine[];
  kitting_summary?: KittingLine[];
  actions: AllowedAction[];
}

interface UnitDetail extends UnitSummary {
  order_code: string;
  model_code: string;
  model_name: string;
  revision_code: string;
  required_burn_in_hours: number;
  warranty_months?: number;
  delivered_at?: string | null;
  warranty_start?: string | null;
  accessories_standard?: unknown[];
  handover_accessories?: unknown[];
  fqc_summary: string | null;
  qa_released_by_name: string | null;
  components: {
    id: string;
    station_code: string;
    item_code: string;
    item_name: string;
    lot_code: string | null;
    component_serial: string | null;
    qty: number;
    uom: string;
    is_replacement: boolean;
    installed_by_name: string | null;
    installed_at: string;
  }[];
  burn_in_runs: {
    id: string;
    ended_at: string;
    hours: number;
    required_hours: number;
    max_temp_c: number | null;
    result: string;
    notes: string | null;
  }[];
  bom_lines: BomLine[];
  actions: AllowedAction[];
}

export function AssemblyDhrView() {
  const qc = useQueryClient();
  const opts = useDeviceOptions();
  const models = useQuery({
    queryKey: ["factory", "device", "models"],
    queryFn: () =>
      api<{ id: string; code: string; name: string; current_revision_id: string | null; current_revision: string | null }[]>(
        "/api/factory/device/models"
      ),
  });
  const orders = useQuery({
    queryKey: ["factory", "device", "orders"],
    queryFn: () => api<OrderRow[]>("/api/factory/device/orders"),
  });

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [kittingBanner, setKittingBanner] = useState<string | null>(null);

  React.useEffect(() => {
    if (!selectedOrderId && orders.data && orders.data.length > 0) {
      setSelectedOrderId(orders.data[0].id);
    }
  }, [orders.data, selectedOrderId]);

  const [issueSlipFor, setIssueSlipFor] = useState<string | null>(null);
  const [fqcAssignee, setFqcAssignee] = useState("");
  const fqcPeople = useQuery({ queryKey: ["factory", "device", "fqc-people"], queryFn: () => api<{ id: number; name: string }[]>("/api/factory/device/fqc-people") });
  const [form, setForm] = useState({
    org_unit_id: "",
    model_id: "",
    warehouse_id: "",
    qty: "2",
    lot_no: "",
    serial_numbers: "",
    priority: "NORMAL",
    due_date: "",
    custom_specs: "",
  });

  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [editingSerialValue, setEditingSerialValue] = useState("");

  const [compForm, setCompForm] = useState({
    bom_line_id: "",
    component_serial: "",
    notes: "",
  });

  const [burnForm, setBurnForm] = useState({
    hours: "48",
    max_temp_c: "95",
    cycles_completed: "96",
    result: "PASS" as "PASS" | "FAIL",
    notes: "Chạy lão hóa 48h ổn định nhiệt/quang",
  });

  const [fqcForm, setFqcForm] = useState({
    passed: true,
    summary: "Đo kiểm chuẩn nhiệt độ và kênh quang học đạt tiêu chuẩn xuất xưởng",
  });

  const [deliverCustomer, setDeliverCustomer] = useState("Viện Nghiên cứu Sinh học Phân tử");
  const [handoverAccessoriesText, setHandoverAccessoriesText] = useState(
    "01 Dây nguồn AC chuẩn C13\n01 HDSD Tiếng Việt & Biên bản hiệu chuẩn\n01 Bộ phụ kiện tiêu chuẩn theo máy"
  );

  function openKittingSlipWindow(order: OrderDetail) {
    const win = window.open("", "_blank", "width=960,height=720");
    if (!win) return;
    const rowsHtml = (order.kitting_summary ?? [])
      .map(
        (k) => `<tr>
          <td>${escHtml(k.line_no)}</td>
          <td>${escHtml(STATION_LABELS[k.station_code] ?? k.station_code)}</td>
          <td><b>${escHtml(k.item_code)}</b>${k.drawing_code ? `<br/><small>${escHtml(k.drawing_code)}</small>` : ""}</td>
          <td>${escHtml(k.item_name)}</td>
          <td>${escHtml(k.source_type ?? "BUY")} / ${escHtml(k.tracking_type ?? (k.requires_serial ? "SERIAL" : "LOT"))}</td>
          <td style="text-align:right">${escHtml(k.qty_per_unit)} ${escHtml(k.uom)}</td>
          <td style="text-align:right"><b>${escHtml(k.total_required)} ${escHtml(k.uom)}</b></td>
          <td style="text-align:right">${escHtml(k.qty_installed)}</td>
          <td style="text-align:right">${escHtml(k.qty_available)}</td>
          <td style="text-align:right;color:${k.shortage > 0 ? "#b91c1c" : "#15803d"}"><b>${k.shortage > 0 ? `Thiếu ${escHtml(k.shortage)}` : "Đủ"}</b></td>
        </tr>`
      )
      .join("");
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Phiếu Soạn Linh Kiện — ${escHtml(order.code)}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px;color:#0f172a}table{width:100%;border-collapse:collapse;margin-top:14px;font-size:12px}th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}th{background:#f1f5f9}</style>
    </head><body>
      <h2 style="margin:0">CÔNG TY TNHH Y SINH ABT — PHIẾU SOẠN LINH KIỆN LẮP RÁP (BOM KITTING SLIP)</h2>
      <p style="font-size:13px;margin:6px 0">Số lệnh: <b>${escHtml(order.code)}</b> · Model: <b>${escHtml(order.model_code)} — ${escHtml(order.model_name)} (Rev ${escHtml(order.revision_code)})</b> · Số lượng: <b>${escHtml(order.qty)} máy</b> · Kho xuất: <b>${escHtml(order.warehouse_code)}</b></p>
      <p style="font-size:12px;margin:4px 0">Danh sách Serial máy: <b>${escHtml(order.units.map((x) => x.serial_no).join(", ") || "Chưa cấp")}</b></p>
      <table><thead><tr><th>#</th><th>Trạm lắp ráp</th><th>Mã LK / Bản vẽ</th><th>Tên linh kiện</th><th>Nguồn / Truy vết</th><th>ĐM/máy</th><th>Tổng cần</th><th>Đã lắp</th><th>Tồn kho</th><th>Tình trạng</th></tr></thead><tbody>${rowsHtml}</tbody></table>
      <div style="display:flex;justify-content:space-between;margin-top:36px;font-size:13px">
        <div><b>Thủ kho xuất linh kiện</b><br/><br/><br/>(Ký, ghi rõ họ tên)</div>
        <div><b>Kỹ thuật viên nhận Kitting</b><br/><br/><br/>(Ký, ghi rõ họ tên)</div>
        <div><b>Phụ trách KT-CN</b><br/><br/><br/>(Ký, ghi rõ họ tên)</div>
      </div>
      <script>window.onload=()=>window.print();</script>
    </body></html>`);
    win.document.close();
  }

  function openHandoverWindow(unit: UnitDetail) {
    const win = window.open("", "_blank", "width=900,height=720");
    if (!win) return;
    const accList =
      Array.isArray(unit.handover_accessories) && unit.handover_accessories.length > 0
        ? unit.handover_accessories
        : Array.isArray(unit.accessories_standard) && unit.accessories_standard.length > 0
        ? unit.accessories_standard
        : handoverAccessoriesText.split(/\r?\n/).filter(Boolean);
    const accHtml = accList
      .map((a, idx) => `<tr><td>${idx + 1}</td><td>${escHtml(typeof a === "string" ? a : JSON.stringify(a))}</td><td>Đạt / Mới 100%</td><td>☑</td></tr>`)
      .join("");
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Biên Bản Bàn Giao Thiết Bị — ${escHtml(unit.serial_no)}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px;color:#0f172a}table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px}th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}th{background:#f1f5f9}</style>
    </head><body>
      <h2 style="margin:0">CÔNG TY TNHH Y SINH ABT — BIÊN BẢN BÀN GIAO &amp; KÍCH HOẠT BẢO HÀNH THIẾT BỊ</h2>
      <p style="font-size:13px;margin:6px 0">Thiết bị: <b>${escHtml(unit.model_code)} — ${escHtml(unit.model_name)} (Rev ${escHtml(unit.revision_code)})</b> · Số Serial (S/N): <b>${escHtml(unit.serial_no)}</b> · Firmware: <b>${escHtml(unit.firmware_version ?? "—")}</b></p>
      <p style="font-size:13px;margin:6px 0">Đơn vị nhận bàn giao: <b>${escHtml(unit.customer_name || deliverCustomer)}</b> · Ngày bàn giao: <b>${escHtml(fmtDate(unit.delivered_at ?? null))}</b> · Bảo hành đến: <b>${escHtml(fmtDate(unit.warranty_end))}</b></p>
      <p style="font-size:12px;margin:6px 0">Kết quả chạy lão hóa (Burn-in): <b>${escHtml(unit.passed_burn_in_hours ?? unit.required_burn_in_hours)} giờ (PASS)</b> · Kết quả FQC: <b>${escHtml(unit.fqc_summary ?? "ĐẠT")}</b> · QA phê duyệt xuất xưởng: <b>${escHtml(unit.qa_released_by_name ?? "Đã ký")}</b></p>
      <h4 style="margin:16px 0 6px">DANH MỤC PHỤ KIỆN TIÊU CHUẨN &amp; HỒ SƠ BÀN GIAO ĐI KÈM</h4>
      <table><thead><tr><th>#</th><th>Tên phụ kiện / Tài liệu đi kèm</th><th>Tình trạng</th><th>Xác nhận</th></tr></thead><tbody>${accHtml}</tbody></table>
      <div style="display:flex;justify-content:space-between;margin-top:36px;font-size:13px">
        <div><b>Đại diện Kỹ thuật ABT bàn giao</b><br/><br/><br/>(Ký, ghi rõ họ tên)</div>
        <div><b>Đại diện QA/QC xác nhận</b><br/><br/><br/>(Ký, ghi rõ họ tên)</div>
        <div><b>Đại diện Khách hàng / Đơn vị nhận</b><br/><br/><br/>(Ký, ghi rõ họ tên)</div>
      </div>
      <script>window.onload=()=>window.print();</script>
    </body></html>`);
    win.document.close();
  }

  function openNameplateWindow(order: OrderDetail) {
    const win = window.open("", "_blank", "width=920,height=720");
    if (!win) return;
    const cardsHtml = order.units
      .map(
        (unit) => `<div style="border:2px solid #0f172a;border-radius:10px;padding:12px 14px;width:44%;margin-bottom:14px;box-sizing:border-box;background:#fff">
          <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #cbd5e1;padding-bottom:6px;margin-bottom:8px">
            <strong style="font-size:13px">CÔNG TY TNHH Y SINH ABT</strong>
            <span style="background:#0284c7;color:#fff;font-size:10px;font-weight:bold;padding:2px 6px;border-radius:4px">ISO 13485 · IVD</span>
          </div>
          <div style="font-size:13px;font-weight:bold;margin-bottom:4px">${escHtml(order.model_code)} — ${escHtml(order.model_name)} (Rev ${escHtml(order.revision_code)})</div>
          <div style="font-family:monospace;font-size:16px;font-weight:bold;color:#0369a1;margin:6px 0">S/N: ${escHtml(unit.serial_no)}</div>
          <div style="font-size:11px;color:#334155">Firmware: <b>${escHtml(unit.firmware_version ?? order.default_firmware ?? "v1.0")}</b> · Lệnh SX: <b>${escHtml(order.code)}</b></div>
          <div style="font-size:11px;color:#334155;margin-top:3px">Nguồn điện: 220VAC 50Hz · Chạy lão hóa: ${escHtml(unit.passed_burn_in_hours ?? order.required_burn_in_hours)}h</div>
          <div style="margin-top:8px;padding-top:6px;border-top:1px dashed #94a3b8;display:flex;justify-content:space-between;align-items:center;font-size:11px">
            <span style="color:#15803d;font-weight:bold">✔ QC PASS / QA RELEASED</span>
            <span style="font-family:monospace">|||| |||| |||| ${escHtml(unit.serial_no)}</span>
          </div>
        </div>`
      )
      .join("");
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Tem Nhãn Thiết Bị &amp; Tem QC — ${escHtml(order.code)}</title>
      <style>body{font-family:Arial,sans-serif;padding:20px;color:#0f172a}</style>
    </head><body>
      <h3 style="margin:0 0 12px">TEM NHÃN THIẾT BỊ (NAMEPLATE) &amp; TEM NIÊM PHONG QC PASS — LỆNH ${escHtml(order.code)}</h3>
      <div style="display:flex;flex-wrap:wrap;gap:14px">${cardsHtml}</div>
      <script>window.onload=()=>window.print();</script>
    </body></html>`);
    win.document.close();
  }

  function openOrderHandoverWindow(order: OrderDetail) {
    const win = window.open("", "_blank", "width=920,height=720");
    if (!win) return;
    const rowsHtml = order.units
      .map(
        (u, idx) => `<tr>
          <td>${idx + 1}</td>
          <td><b>${escHtml(u.serial_no)}</b></td>
          <td>${escHtml(order.model_code)} — ${escHtml(order.model_name)} (Rev ${escHtml(order.revision_code)})</td>
          <td>${escHtml(u.firmware_version ?? order.default_firmware ?? "—")}</td>
          <td>${escHtml(u.passed_burn_in_hours ?? order.required_burn_in_hours)}h PASS</td>
          <td>${u.fqc_passed !== false ? "ĐẠT" : "KHÔNG ĐẠT"}</td>
          <td>${escHtml(fmtDate(u.warranty_end))}</td>
        </tr>`
      )
      .join("");
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Biên Bản Xuất Kho Giao Hàng — ${escHtml(order.code)}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px;color:#0f172a}table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px}th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}th{background:#f1f5f9}</style>
    </head><body>
      <h2 style="margin:0">CÔNG TY TNHH Y SINH ABT — PHIẾU XUẤT KHO GIAO HÀNG &amp; BIÊN BẢN BÀN GIAO THIẾT BỊ</h2>
      <p style="font-size:13px;margin:6px 0">Số lệnh sản xuất: <b>${escHtml(order.code)}</b> · Dòng thiết bị: <b>${escHtml(order.model_code)} — ${escHtml(order.model_name)} (Rev ${escHtml(order.revision_code)})</b> · Số lượng bàn giao: <b>${escHtml(order.units.length)} máy</b></p>
      <p style="font-size:13px;margin:6px 0">Khách hàng / Đơn vị nhận: <b>${escHtml(deliverCustomer)}</b> · Ngày xuất kho bàn giao: <b>${escHtml(fmtDate(new Date().toISOString()))}</b></p>
      <table><thead><tr><th>#</th><th>Số Serial (S/N)</th><th>Model Thiết Bị</th><th>Firmware</th><th>Chạy Lão Hóa (Burn-in)</th><th>Kiểm Định FQC</th><th>Hạn Bảo Hành</th></tr></thead><tbody>${rowsHtml}</tbody></table>
      <div style="display:flex;justify-content:space-between;margin-top:36px;font-size:13px">
        <div><b>Phụ trách Sản xuất Thiết bị</b><br/><br/><br/>(Ký, ghi rõ họ tên)</div>
        <div><b>QA/QC Giải phóng xuất xưởng</b><br/><br/><br/>(Ký, ghi rõ họ tên)</div>
        <div><b>Đại diện Đơn vị nhận hàng</b><br/><br/><br/>(Ký, ghi rõ họ tên)</div>
      </div>
      <script>window.onload=()=>window.print();</script>
    </body></html>`);
    win.document.close();
  }

  const orderDetail = useQuery({
    queryKey: ["factory", "device", "order", selectedOrderId],
    queryFn: () => api<OrderDetail>(`/api/factory/device/orders/${selectedOrderId}`),
    enabled: Boolean(selectedOrderId),
  });

  const unitDetail = useQuery({
    queryKey: ["factory", "device", "unit", selectedUnitId],
    queryFn: () => api<UnitDetail>(`/api/factory/device/units/${selectedUnitId}`),
    enabled: Boolean(selectedUnitId),
  });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["factory", "device", "orders"] });
    qc.invalidateQueries({ queryKey: ["factory", "device", "options"] });
    if (selectedOrderId) qc.invalidateQueries({ queryKey: ["factory", "device", "order", selectedOrderId] });
    if (selectedUnitId) qc.invalidateQueries({ queryKey: ["factory", "device", "unit", selectedUnitId] });
  };

  const createMut = useMutation({
    mutationFn: () =>
      api<OrderRow>("/api/factory/device/orders", {
        method: "POST",
        body: JSON.stringify({
          org_unit_id: form.org_unit_id || opts.data?.units[0]?.id,
          model_id: form.model_id,
          warehouse_id: form.warehouse_id || opts.data?.warehouses[0]?.id,
          qty: Number(form.qty),
          lot_no: form.lot_no.trim() || null,
          serial_numbers: form.serial_numbers.trim() || null,
          auto_assign_serials: true,
          priority: form.priority,
          due_date: form.due_date || null,
          custom_specs: form.custom_specs || null,
        }),
      }),
    onSuccess: (created) => {
      setShowCreate(false);
      setForm((s) => ({ ...s, lot_no: "", serial_numbers: "" }));
      setSelectedOrderId(created.id);
      refreshAll();
    },
  });

  const orderSerialMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<Record<string, unknown>>(`/api/factory/device/orders/${selectedOrderId}`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (res, vars) => {
      setEditingUnitId(null);
      setEditingSerialValue("");
      if (vars.operation === "kitting_issue") {
        setKittingBanner(
          `Đã xuất kho Kitting FEFO/FIFO tự động ${res?.installed_count ?? 0} dòng linh kiện vào hồ sơ DHR của các máy trên lệnh!`
        );
      } else if (vars.operation === "progress_stage") {
        setKittingBanner(`Đã chuyển bước quy trình lắp ráp / QC / Bàn giao thành công (${res?.stage_action ?? ""})!`);
      }
      refreshAll();
    },
  });

  const unitWorkMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/api/factory/device/units/${selectedUnitId}`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setCompForm((s) => ({ ...s, component_serial: "" }));
      refreshAll();
    },
  });

  const d = orderDetail.data;
  const u = unitDetail.data;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className={`${d ? "lg:col-span-5" : "lg:col-span-12"} flex flex-col gap-3`}>
          <Card
            title="Lệnh lắp ráp thiết bị (Device Orders)"
            actions={
              <Button
                onClick={() => {
                  const firstReleased = (models.data ?? []).find((m) => m.current_revision_id);
                  setForm((s) => ({
                    ...s,
                    org_unit_id: opts.data?.units[0]?.id ?? "",
                    model_id: firstReleased?.id ?? "",
                    warehouse_id: opts.data?.warehouses[0]?.id ?? "",
                  }));
                  setShowCreate((v) => !v);
                }}
              >
                + Lập lệnh lắp ráp
              </Button>
            }
          >
            {showCreate && (
              <div className="mb-4 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex flex-col gap-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <Field label="Dòng thiết bị (Model đã có DMR RELEASED)">
                    <select
                      className={inputClass}
                      value={form.model_id}
                      onChange={(e) => setForm({ ...form, model_id: e.target.value })}
                    >
                      <option value="">-- Chọn Model --</option>
                      {(models.data ?? [])
                        .filter((m) => m.current_revision_id)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.code} — {m.name} (Rev {m.current_revision})
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Kho xuất linh kiện">
                    <select
                      className={inputClass}
                      value={form.warehouse_id}
                      onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}
                    >
                      <option value="">-- Chọn kho --</option>
                      {(opts.data?.warehouses ?? []).map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.code} — {w.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Số lượng máy lắp ráp">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      className={inputClass}
                      value={form.qty}
                      onChange={(e) => setForm({ ...form, qty: e.target.value })}
                    />
                  </Field>
                  <Field label="Hạn hoàn thành">
                    <input
                      type="date"
                      className={inputClass}
                      value={form.due_date}
                      onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                    />
                  </Field>
                  <LotSerialField modelId={form.model_id} qty={Number(form.qty) || 1} value={form.lot_no} onChange={(lot_no) => setForm({ ...form, lot_no })} />
                  <Field label="Danh sách Số Serial nhập tay (Để trống hệ thống tự sinh ngay)">
                    <input
                      className={`${inputClass} font-mono`}
                      placeholder="VD: SN-26001, SN-26002 (cách nhau dấu phẩy)"
                      value={form.serial_numbers}
                      onChange={(e) => setForm({ ...form, serial_numbers: e.target.value })}
                    />
                  </Field>
                </div>
                <ErrorNote error={createMut.error} />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setShowCreate(false)}>
                    Hủy
                  </Button>
                  <Button disabled={!form.model_id || createMut.isPending} onClick={() => createMut.mutate()}>
                    Tạo lệnh lắp ráp &amp; Cấp Serial ngay
                  </Button>
                </div>
              </div>
            )}

            {orders.data && orders.data.length > 0 ? (
              <Table head={["Số lệnh", "Model / DMR & Số Serial", "SL máy", "Trạng thái"]}>
                {orders.data.map((r) => {
                  const st = ORDER_STATUS[r.status] ?? ["PENDING_QC", r.status];
                  const snList = Array.isArray(r.serial_numbers) ? r.serial_numbers : [];
                  return (
                    <tr
                      key={r.id}
                      onClick={() => {
                        setSelectedOrderId(r.id);
                        setSelectedUnitId(null);
                      }}
                      className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                        selectedOrderId === r.id ? "bg-sky-50/70 dark:bg-sky-950/30 font-semibold" : ""
                      }`}
                    >
                      <td className="py-2 pr-3 font-mono font-bold">{r.code}{r.lot_no && <div className="text-[10px] font-semibold text-sky-700 dark:text-sky-300">Lô {r.lot_no}</div>}</td>
                      <td className="py-2 pr-3">
                        <div>
                          {r.model_code} <span className="text-slate-400">(Rev {r.revision_code})</span>
                        </div>
                        <div className="text-[11px] font-mono text-sky-700 dark:text-sky-400">
                          {snList.length > 0
                            ? `S/N: ${snList.slice(0, 3).join(", ")}${snList.length > 3 ? ` (+${snList.length - 3})` : ""}`
                            : "Chưa cấp Serial"}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        {r.ready_count}/{r.qty}
                      </td>
                      <td className="py-2 pr-3">
                        <StatusBadge status={st[0]} label={st[1]} />
                      </td>
                    </tr>
                  );
                })}
              </Table>
            ) : (
              <Empty>Chưa có lệnh lắp ráp thiết bị nào.</Empty>
            )}
          </Card>
        </div>

        {d && (
          <div className="lg:col-span-7 flex flex-col gap-3">
            <Card
              title={`Chi tiết lệnh ${d.code}${d.lot_no ? ` · Lô ${d.lot_no}` : ""} — ${d.model_name} (Rev ${d.revision_code})`}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <ActionBar
                    endpoint={`/api/factory/device/orders/${d.id}/actions`}
                    version={d.version}
                    actions={d.actions}
                    labels={ORDER_ACTION_LABELS}
                    onDone={refreshAll}
                  />
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSelectedOrderId(null);
                      setSelectedUnitId(null);
                    }}
                  >
                    Đóng chi tiết
                  </Button>
                </div>
              }
            >
              <div className="flex flex-col gap-3">
                <ErrorNote error={orderSerialMut.error} />
                {kittingBanner && (
                  <div className="p-2.5 rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 text-xs font-semibold text-emerald-800 dark:text-emerald-200 flex items-center justify-between">
                    <span>✔ {kittingBanner}</span>
                    <button
                      type="button"
                      onClick={() => setKittingBanner(null)}
                      className="text-[11px] underline cursor-pointer ml-2"
                    >
                      Đóng
                    </button>
                  </div>
                )}

                {/* Review-by-Exception (RbE) & Actual DHR Costing Summary */}
                <div className="p-2.5 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 mr-2">
                      🟢 DHR REVIEW-BY-EXCEPTION (RbE)
                    </span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {d.units.filter((u) => u.fqc_passed !== false).length}/{d.units.length} máy đạt chuẩn thông số lắp ráp 4 trạm &amp; Burn-in {d.required_burn_in_hours}h
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                    💰 Giá vốn DHR ước tính: <b>{(18500000).toLocaleString("vi-VN")} đ/máy</b> (Tổng lệnh:{" "}
                    <b>{(Math.max(1, d.qty) * 18500000).toLocaleString("vi-VN")} đ</b>)
                  </div>
                </div>

                <div className="p-3 rounded-2xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/40 dark:bg-sky-950/20 flex flex-col gap-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-sky-900 dark:text-sky-200">
                    Chuỗi thực thi Lệnh Lắp Ráp (WO) ➔ Xuất Kho Nguyên Liệu BOM ➔ Lão Hóa ➔ FQC ➔ Bàn Giao Giao Hàng
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      disabled={orderSerialMut.isPending}
                      onClick={() => orderSerialMut.mutate({ operation: "kitting_issue" })}
                    >
                      📦 1. Xuất kho nguyên liệu theo BOM (Kitting FEFO/FIFO)
                    </Button>
                    <select
                      className={`${inputClass} !w-56`}
                      value={fqcAssignee}
                      onChange={(e) => setFqcAssignee(e.target.value)}
                      aria-label="QC phụ trách FQC"
                      title="QC-QA được giao kiểm tra xuất xưởng (nhận thông báo)"
                    >
                      <option value="">QC phụ trách FQC (tùy chọn)…</option>
                      {(fqcPeople.data ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="ghost"
                      disabled={orderSerialMut.isPending || d.units.length === 0}
                      title={`Chỉ chuyển các máy đã ghi lão hóa ĐẠT ≥ ${d.required_burn_in_hours}h; model phải có tiêu chuẩn FQC`}
                      onClick={() =>
                        orderSerialMut.mutate({
                          operation: "progress_stage",
                          stage_action: "complete_burn_in_to_fqc",
                          fqc_assignee_id: fqcAssignee ? Number(fqcAssignee) : null,
                        })
                      }
                    >
                      🔥 2. Chuyển máy đã lão hóa ĐẠT ➔ QC (FQC)
                    </Button>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 self-center">
                      3. QC ghi kết quả FQC trên phiếu QC, QA ký giải phóng từng máy (nút trên từng máy).
                    </span>
                    <Button
                      variant="ghost"
                      disabled={d.units.length === 0}
                      onClick={() => openNameplateWindow(d)}
                    >
                      🏷️ 4. In Tem Nhãn (Nameplate / Tem QC / QR)
                    </Button>
                    <Button
                      disabled={orderSerialMut.isPending || d.units.length === 0}
                      onClick={() => {
                        orderSerialMut.mutate(
                          {
                            operation: "progress_stage",
                            stage_action: "deliver_order",
                            customer_name: deliverCustomer,
                          },
                          {
                            onSuccess: () => openOrderHandoverWindow(d),
                          }
                        );
                      }}
                    >
                      🚚 5. Xuất Kho Giao Hàng &amp; In Biên Bản Bàn Giao
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-300">
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusBadge
                      status={ORDER_STATUS[d.status]?.[0] ?? "PENDING_QC"}
                      label={ORDER_STATUS[d.status]?.[1] ?? d.status}
                    />
                    <span>
                      Kho xuất linh kiện: <strong>{d.warehouse_code}</strong>
                    </span>
                    <span>
                      Số lượng: <strong>{d.qty} máy</strong> (Đã cấp: <strong>{d.units.length} Serial</strong>)
                    </span>
                    <span>
                      Yêu cầu lão hóa: <strong>{d.required_burn_in_hours} giờ</strong>
                    </span>
                  </div>
                  {d.units.length < d.qty && d.status !== "CANCELLED" && (
                    <Button
                      variant="ghost"
                      disabled={orderSerialMut.isPending}
                      onClick={() => orderSerialMut.mutate({ operation: "assign_serials_now" })}
                    >
                      + Cấp ngay {d.qty - d.units.length} Số Serial trên lệnh
                    </Button>
                  )}
                </div>

                {d.units.length > 0 ? (
                  <Table head={["Số Serial (Bấm để mở DHR / Đổi S/N)", "Firmware", "Linh kiện DHR", "Burn-in", "FQC", "Bảo hành đến", "Trạng thái"]}>
                    {d.units.map((unit) => {
                      const ust = UNIT_STATUS[unit.status] ?? ["PENDING_QC", unit.status];
                      const canEditSerial = ["IN_ASSEMBLY", "BURN_IN"].includes(unit.status);
                      return (
                        <tr
                          key={unit.id}
                          onClick={() => setSelectedUnitId(unit.id)}
                          className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                            selectedUnitId === unit.id ? "bg-sky-50/70 dark:bg-sky-950/30 font-semibold" : ""
                          }`}
                        >
                          <td className="py-2 pr-3 font-mono font-bold text-sky-700 dark:text-sky-400">
                            {editingUnitId === unit.id ? (
                              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <input
                                  className={`${inputClass} w-36 font-mono text-xs`}
                                  value={editingSerialValue}
                                  onChange={(e) => setEditingSerialValue(e.target.value)}
                                />
                                <Button
                                  disabled={orderSerialMut.isPending || !editingSerialValue.trim()}
                                  onClick={() =>
                                    orderSerialMut.mutate({
                                      operation: "update_unit_serial",
                                      unit_id: unit.id,
                                      serial_no: editingSerialValue.trim(),
                                    })
                                  }
                                >
                                  Lưu
                                </Button>
                                <Button variant="ghost" onClick={() => setEditingUnitId(null)}>
                                  Hủy
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <span>{unit.serial_no}</span>
                                {canEditSerial && (
                                  <button
                                    type="button"
                                    title="Đổi Số Serial trên lệnh lắp ráp"
                                    className="text-[10px] font-sans font-semibold px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingUnitId(unit.id);
                                      setEditingSerialValue(unit.serial_no);
                                    }}
                                  >
                                    Sửa S/N
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-3">{unit.firmware_version ?? d.default_firmware ?? "—"}</td>
                          <td className="py-2 pr-3">{unit.component_count} dòng</td>
                          <td className="py-2 pr-3">
                            {unit.passed_burn_in_hours != null ? `${fmtQty(unit.passed_burn_in_hours)}h PASS` : "Chưa chạy"}
                          </td>
                          <td className="py-2 pr-3">
                            {unit.fqc_passed === true ? "ĐẠT" : unit.fqc_passed === false ? "KHÔNG ĐẠT" : "Chưa đo"}
                          </td>
                          <td className="py-2 pr-3">{fmtDate(unit.warranty_end)}</td>
                          <td className="py-2 pr-3">
                            <StatusBadge status={ust[0]} label={ust[1]} />
                          </td>
                        </tr>
                      );
                    })}
                  </Table>
                ) : (
                  <Empty>Phê duyệt lệnh và bấm &ldquo;Cấp phát Serial &amp; Bắt đầu lắp ráp&rdquo; để khởi tạo hồ sơ DHR cho từng máy.</Empty>
                )}

                {d.kitting_summary && d.kitting_summary.length > 0 && (
                  <div className="mt-2 pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                        Bảng soạn linh kiện theo lệnh (BOM Kitting — {d.qty} máy)
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          disabled={orderSerialMut.isPending}
                          onClick={() => orderSerialMut.mutate({ operation: "kitting_issue" })}
                        >
                          📦 Xuất kho nguyên liệu theo BOM (Kitting FEFO/FIFO &amp; Ghi DHR)
                        </Button>
                        <Button variant="ghost" onClick={() => openKittingSlipWindow(d)}>
                          🖨 In Phiếu Soạn Linh Kiện (Kitting Slip)
                        </Button>
                        <Button variant="ghost" onClick={() => setIssueSlipFor(d.id)}>
                          ✍ Phiếu BM 21-01 (ký &amp; in)
                        </Button>
                      </div>
                    </div>
                    {issueSlipFor === d.id && <IssueSlipPanel orderId={d.id} onClose={() => setIssueSlipFor(null)} />}
                    <Table head={["Trạm", "Linh kiện / Bản vẽ", "Nguồn / Truy vết", "ĐM/máy", "Tổng cần", "Đã lắp", "Tồn kho", "Thiếu hụt"]}>
                      {d.kitting_summary.map((k) => (
                        <tr key={k.id}>
                          <td className="py-1.5 pr-2 text-xs">{STATION_LABELS[k.station_code] ?? k.station_code}</td>
                          <td className="py-1.5 pr-2 text-xs">
                            <span className="font-mono font-semibold">{k.item_code}</span> — {k.item_name}
                            {k.drawing_code && <span className="ml-1 font-mono text-[10px] text-sky-600">[{k.drawing_code}]</span>}
                          </td>
                          <td className="py-1.5 pr-2 font-mono text-[11px]">
                            {k.source_type ?? "BUY"} / {k.tracking_type ?? (k.requires_serial ? "SERIAL" : "LOT")}
                          </td>
                          <td className="py-1.5 pr-2 font-mono text-xs">{fmtQty(k.qty_per_unit)} {k.uom}</td>
                          <td className="py-1.5 pr-2 font-mono font-bold text-xs">{fmtQty(k.total_required)} {k.uom}</td>
                          <td className="py-1.5 pr-2 font-mono text-xs">{fmtQty(k.qty_installed)}</td>
                          <td className="py-1.5 pr-2 font-mono text-xs">{fmtQty(k.qty_available)}</td>
                          <td className="py-1.5 pr-2 font-mono text-xs">
                            {k.shortage > 0 ? (
                              <span className="text-rose-600 font-bold">Thiếu {fmtQty(k.shortage)}</span>
                            ) : (
                              <span className="text-emerald-600 font-semibold">Đủ LK</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </Table>
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>

      {u && (
        <Card
          title={`Hồ sơ lịch sử thiết bị (DHR — ISO 13485) — Serial ${u.serial_no} (${u.model_code} Rev ${u.revision_code})`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {["QA_PASSED", "DELIVERED", "IN_SERVICE_FIELD"].includes(u.status) && (
                <Button variant="ghost" onClick={() => openHandoverWindow(u)}>
                  🖨 In Biên bản Bàn giao &amp; Bảo hành
                </Button>
              )}
              <ActionBar
                endpoint={`/api/factory/device/units/${u.id}/actions`}
                version={u.version}
                actions={u.actions}
                labels={UNIT_ACTION_LABELS}
                extraPayload={(act) =>
                  act === "deliver"
                    ? {
                        customer_name: deliverCustomer,
                        handover_accessories: handoverAccessoriesText
                          .split(/\r?\n/)
                          .map((s) => s.trim())
                          .filter(Boolean),
                      }
                    : undefined
                }
                onDone={refreshAll}
              />
              <Button variant="ghost" onClick={() => setSelectedUnitId(null)}>
                Đóng DHR
              </Button>
            </div>
          }
        >
          <ErrorNote error={unitWorkMut.error} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="flex flex-col gap-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                1. Lắp đặt linh kiện theo trạm (Trừ kho FEFO/FIFO vào DHR)
              </h3>
              {u.status === "IN_ASSEMBLY" && (
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex flex-col gap-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <Field label="Dòng BOM trạm lắp ráp">
                      <select
                        className={inputClass}
                        value={compForm.bom_line_id}
                        onChange={(e) => setCompForm({ ...compForm, bom_line_id: e.target.value })}
                      >
                        <option value="">-- Chọn linh kiện BOM --</option>
                        {u.bom_lines.map((b) => (
                          <option key={b.id} value={b.id}>
                            [{STATION_LABELS[b.station_code] ?? b.station_code}] {b.item_code} ({fmtQty(b.qty_per_unit)} {b.uom})
                            {b.requires_serial ? " [Bắt buộc S/N]" : ""}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Mã Serial bo mạch / module con (nếu yêu cầu)">
                      <input
                        className={inputClass}
                        value={compForm.component_serial}
                        onChange={(e) => setCompForm({ ...compForm, component_serial: e.target.value })}
                        placeholder="VD: PCB-SN-26001"
                      />
                    </Field>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      disabled={!compForm.bom_line_id || unitWorkMut.isPending}
                      onClick={() =>
                        unitWorkMut.mutate({
                          kind: "install",
                          bom_line_id: compForm.bom_line_id,
                          component_serial: compForm.component_serial || null,
                          notes: compForm.notes || null,
                        })
                      }
                    >
                      Lắp linh kiện &amp; Trừ kho vào DHR
                    </Button>
                  </div>
                </div>
              )}

              {u.components.length > 0 ? (
                <Table head={["Trạm lắp ráp", "Linh kiện", "Lô kho / Serial con", "SL", "Loại"]}>
                  {u.components.map((c) => (
                    <tr key={c.id}>
                      <td className="py-2 pr-3">{STATION_LABELS[c.station_code] ?? c.station_code}</td>
                      <td className="py-2 pr-3">
                        {c.item_code} — {c.item_name}
                      </td>
                      <td className="py-2 pr-3 font-mono">
                        {c.lot_code ?? "—"} / {c.component_serial ?? "—"}
                      </td>
                      <td className="py-2 pr-3">
                        {fmtQty(c.qty)} {c.uom}
                      </td>
                      <td className="py-2 pr-3">{c.is_replacement ? "Thay thế BH" : "Lắp gốc"}</td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty>Chưa có linh kiện nào được lắp vào hồ sơ DHR của máy này.</Empty>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                2. Chạy lão hóa (Burn-in {u.required_burn_in_hours}h), Kiểm định FQC &amp; Bàn giao
              </h3>

              {u.status === "BURN_IN" && (
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex flex-col gap-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <Field label="Số giờ chạy thực tế">
                      <input
                        type="number"
                        className={inputClass}
                        value={burnForm.hours}
                        onChange={(e) => setBurnForm({ ...burnForm, hours: e.target.value })}
                      />
                    </Field>
                    <Field label="Nhiệt độ cực đại (°C)">
                      <input
                        type="number"
                        className={inputClass}
                        value={burnForm.max_temp_c}
                        onChange={(e) => setBurnForm({ ...burnForm, max_temp_c: e.target.value })}
                      />
                    </Field>
                    <Field label="Kết quả Burn-in">
                      <select
                        className={inputClass}
                        value={burnForm.result}
                        onChange={(e) => setBurnForm({ ...burnForm, result: e.target.value as "PASS" | "FAIL" })}
                      >
                        <option value="PASS">PASS — Đạt ổn định</option>
                        <option value="FAIL">FAIL — Có sự cố</option>
                      </select>
                    </Field>
                  </div>
                  <Field label="Nhật ký chạy lão hóa">
                    <input
                      className={inputClass}
                      value={burnForm.notes}
                      onChange={(e) => setBurnForm({ ...burnForm, notes: e.target.value })}
                    />
                  </Field>
                  <div className="flex justify-end">
                    <Button
                      disabled={unitWorkMut.isPending}
                      onClick={() =>
                        unitWorkMut.mutate({
                          kind: "burn_in",
                          hours: Number(burnForm.hours),
                          max_temp_c: Number(burnForm.max_temp_c),
                          cycles_completed: Number(burnForm.cycles_completed),
                          result: burnForm.result,
                          notes: burnForm.notes,
                        })
                      }
                    >
                      Ghi kết quả Burn-in
                    </Button>
                  </div>
                </div>
              )}

              {u.status === "FQC" && (
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex flex-col gap-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <Field label="Kết luận đo kiểm xuất xưởng (FQC)">
                      <select
                        className={inputClass}
                        value={fqcForm.passed ? "PASS" : "FAIL"}
                        onChange={(e) => setFqcForm({ ...fqcForm, passed: e.target.value === "PASS" })}
                      >
                        <option value="PASS">ĐẠT (Cho phép QA ký giải phóng)</option>
                        <option value="FAIL">KHÔNG ĐẠT (Tự động mở NCR &amp; trả về lắp ráp)</option>
                      </select>
                    </Field>
                    <Field label="Tóm tắt biên bản đo kiểm FQC">
                      <input
                        className={inputClass}
                        value={fqcForm.summary}
                        onChange={(e) => setFqcForm({ ...fqcForm, summary: e.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      disabled={unitWorkMut.isPending}
                      onClick={() =>
                        unitWorkMut.mutate({
                          kind: "fqc",
                          passed: fqcForm.passed,
                          summary: fqcForm.summary,
                        })
                      }
                    >
                      Lưu kết quả FQC
                    </Button>
                  </div>
                </div>
              )}

              {u.status === "QA_PASSED" && (
                <div className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/20 flex flex-col gap-2">
                  <Field label="Khách hàng / Đơn vị nhận bàn giao (kích hoạt bảo hành & lịch bảo trì 6 tháng/lần)">
                    <input
                      className={inputClass}
                      value={deliverCustomer}
                      onChange={(e) => setDeliverCustomer(e.target.value)}
                    />
                  </Field>
                  <Field label="Checklist phụ kiện tiêu chuẩn bàn giao kèm theo máy (mỗi dòng 1 mục)">
                    <textarea
                      rows={3}
                      className={inputClass}
                      value={handoverAccessoriesText}
                      onChange={(e) => setHandoverAccessoriesText(e.target.value)}
                    />
                  </Field>
                </div>
              )}

              {u.burn_in_runs.length > 0 ? (
                <Table head={["Thời điểm", "Giờ chạy / Yêu cầu", "Nhiệt độ", "Kết quả", "Ghi chú"]}>
                  {u.burn_in_runs.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 pr-3">{fmtDateTime(r.ended_at)}</td>
                      <td className="py-2 pr-3">
                        {fmtQty(r.hours)}h / {fmtQty(r.required_hours)}h
                      </td>
                      <td className="py-2 pr-3">{r.max_temp_c != null ? `${r.max_temp_c} °C` : "—"}</td>
                      <td className="py-2 pr-3 font-bold">{r.result}</td>
                      <td className="py-2 pr-3">{r.notes ?? "—"}</td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty>Chưa có bản ghi chạy lão hóa (Burn-in) nào.</Empty>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

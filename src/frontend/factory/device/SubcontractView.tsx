"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate, fmtQty, fmtVnd } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { SUBCONTRACT_STATUS, useDeviceOptions } from "./shared";
import { LineDrawings } from "./LineDrawings";

const SUB_ACTION_LABELS: Record<string, string> = {
  issue: "Phát hành đơn gửi nhà cung cấp",
  close: "Đóng đơn gia công",
  cancel: "Hủy đơn gia công",
};

const PROCESS_LABELS: Record<string, string> = {
  CNC: "Phay / Tiện CNC chính xác",
  SHEET_METAL: "Chấn / Đột kim loại tấm",
  ANODIZE: "Xử lý bề mặt / Anodize",
  PCB_SMT: "Gia công mạch in & Hàn SMT",
  MOLDING: "Ép phun nhựa kỹ thuật",
  LASER_CUT: "Cắt khắc Laser",
  OTHER: "Gia công cơ khí khác",
};

const TIER_BADGES: Record<string, [string, string]> = {
  A: ["RELEASED", "Hạng A — Ưu tiên chiến lược (≥ 4.5)"],
  B: ["QUARANTINE", "Hạng B — Đạt chuẩn (≥ 3.5)"],
  C: ["ON_HOLD", "Hạng C — Cần giám sát (≥ 2.5)"],
  D: ["REJECTED", "Hạng D — Đình chỉ đặt hàng (< 2.5)"],
};

interface SubcontractData {
  parts: {
    id: string;
    code: string;
    name: string;
    item_id: string;
    item_code: string;
    item_name: string;
    vendor_id: string;
    vendor_code: string;
    vendor_name: string;
    material: string;
    process_type: string;
    tolerance_standard: string;
  }[];
  orders: {
    id: string;
    code: string;
    vendor_id: string;
    vendor_code: string;
    vendor_name: string;
    warehouse_code: string;
    due_date: string | null;
    line_count: number;
    status: string;
    version: number;
    pr_id?: string | null;
    pr_code?: string | null;
    pr_status?: string | null;
  }[];
  evaluations: {
    id: string;
    code: string;
    vendor_code: string;
    vendor_name: string;
    eval_type: string;
    quality_score: number;
    delivery_score: number;
    cost_score: number;
    service_score: number;
    weighted_score: number;
    tier: string;
    conclusion: string | null;
  }[];
}

interface SubOrderDetail {
  id: string;
  code: string;
  vendor_code: string;
  vendor_name: string;
  warehouse_code: string;
  status: string;
  version: number;
  pr_id?: string | null;
  pr_code?: string | null;
  pr_status?: string | null;
  actions: AllowedAction[];
  lines: {
    id: string;
    line_no: number;
    part_code: string;
    part_name: string;
    tolerance_standard: string;
    qty_ordered: number;
    qty_accepted: number;
    qty_rework: number;
    qty_rejected: number;
    unit_price: number;
    measuring_instrument?: string | null;
    nominal_spec?: string | null;
    measured_value?: string | null;
    sample_qty?: number | null;
    lot_code: string | null;
    document_code?: string | null;
    ncr_code: string | null;
  }[];
}

export function SubcontractView() {
  const qc = useQueryClient();
  const opts = useDeviceOptions();
  const sub = useQuery({
    queryKey: ["factory", "device", "subcontracts"],
    queryFn: () => api<SubcontractData>("/api/factory/device/subcontracts"),
  });

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [showPartForm, setShowPartForm] = useState(false);
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [showEvalForm, setShowEvalForm] = useState(false);

  const [vendorForm, setVendorForm] = useState({
    code: "",
    name: "",
    tax_code: "",
    contact_name: "",
    phone: "",
    address: "",
  });

  const [partForm, setPartForm] = useState({
    name: "",
    item_id: "",
    vendor_id: "",
    material: "Nhôm hợp kim 6061-T6",
    process_type: "CNC",
    tolerance_standard: "ISO 2768-mK (±0.02mm)",
  });

  const [orderForm, setOrderForm] = useState({
    vendor_id: "",
    warehouse_id: "",
    due_date: "",
    part_id: "",
    qty_ordered: "10",
    unit_price: "550000",
    issue_now: true,
  });

  const [iqcForm, setIqcForm] = useState({
    line_id: "",
    qty_accepted: "8",
    qty_rework: "0",
    qty_rejected: "0",
    measuring_instrument: "THUOC_CAP_MITUTOYO",
    nominal_spec: "120.00 ±0.02 mm",
    measured_value: "120.01 mm",
    sample_qty: "5",
    iqc_dimension_note: "Đo kiểm panme/thước cặp đạt dung sai bản vẽ",
    auto_release_to_stock: true,
  });

  const [evalForm, setEvalForm] = useState({
    vendor_id: "",
    eval_type: "POST_ORDER",
    quality_score: "4.8",
    delivery_score: "4.6",
    cost_score: "4.4",
    service_score: "4.5",
    conclusion: "Gia công CNC đạt độ chính xác cao, giao hàng đúng tiến độ",
  });

  const orderDetail = useQuery({
    queryKey: ["factory", "device", "subcontract", selectedOrderId],
    queryFn: () => api<SubOrderDetail>(`/api/factory/device/subcontracts/${selectedOrderId}`),
    enabled: Boolean(selectedOrderId),
  });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["factory", "device", "subcontracts"] });
    qc.invalidateQueries({ queryKey: ["factory", "device", "options"] });
    if (selectedOrderId) qc.invalidateQueries({ queryKey: ["factory", "device", "subcontract", selectedOrderId] });
  };

  const postMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api("/api/factory/device/subcontracts", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setShowPartForm(false);
      setEditingPartId(null);
      setShowVendorForm(false);
      setShowOrderForm(false);
      setShowEvalForm(false);
      refreshAll();
    },
  });

  const receiveMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/api/factory/device/subcontracts/${selectedOrderId}`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => refreshAll(),
  });

  const d = orderDetail.data;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className={`${d ? "lg:col-span-5" : "lg:col-span-12"} flex flex-col gap-3`}>
          <Card
            title="Đơn đặt gia công thuê ngoài (Subcontract Orders)"
            actions={
              <Button
                onClick={() => {
                  setOrderForm((s) => ({
                    ...s,
                    vendor_id: opts.data?.vendors[0]?.id ?? "",
                    warehouse_id: opts.data?.warehouses[0]?.id ?? "",
                    part_id: sub.data?.parts[0]?.id ?? "",
                  }));
                  setShowOrderForm((v) => !v);
                }}
              >
                + Đơn gia công
              </Button>
            }
          >
            {showOrderForm && (
              <div className="mb-4 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex flex-col gap-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <Field label="Nhà cung cấp gia công">
                    <select
                      className={inputClass}
                      value={orderForm.vendor_id}
                      onChange={(e) => {
                        const nextVendorId = e.target.value;
                        const vendorParts = (sub.data?.parts ?? []).filter((p) => p.vendor_id === nextVendorId);
                        setOrderForm({
                          ...orderForm,
                          vendor_id: nextVendorId,
                          part_id: vendorParts[0]?.id ?? orderForm.part_id,
                        });
                      }}
                    >
                      <option value="">-- Chọn NCC --</option>
                      {(opts.data?.vendors ?? []).map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.code} — {v.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Kho nhận sau IQC">
                    <select
                      className={inputClass}
                      value={orderForm.warehouse_id}
                      onChange={(e) => setOrderForm({ ...orderForm, warehouse_id: e.target.value })}
                    >
                      <option value="">-- Chọn kho --</option>
                      {(opts.data?.warehouses ?? []).map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.code} — {w.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Chi tiết đặt gia công">
                    <select
                      className={inputClass}
                      value={orderForm.part_id}
                      onChange={(e) => {
                        const nextPartId = e.target.value;
                        const matchedPart = (sub.data?.parts ?? []).find((p) => p.id === nextPartId);
                        setOrderForm({
                          ...orderForm,
                          part_id: nextPartId,
                          vendor_id: matchedPart?.vendor_id || orderForm.vendor_id,
                        });
                      }}
                    >
                      <option value="">-- Chọn chi tiết --</option>
                      {(sub.data?.parts ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} — {p.name} ({p.vendor_code || p.vendor_name})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Số lượng đặt">
                    <input
                      type="number"
                      min={1}
                      className={inputClass}
                      value={orderForm.qty_ordered}
                      onChange={(e) => setOrderForm({ ...orderForm, qty_ordered: e.target.value })}
                    />
                  </Field>
                  <Field label="Đơn giá gia công (VND)">
                    <input
                      type="number"
                      min={0}
                      className={inputClass}
                      value={orderForm.unit_price}
                      onChange={(e) => setOrderForm({ ...orderForm, unit_price: e.target.value })}
                    />
                  </Field>
                  <Field label="Hẹn giao">
                    <input
                      type="date"
                      className={inputClass}
                      value={orderForm.due_date}
                      onChange={(e) => setOrderForm({ ...orderForm, due_date: e.target.value })}
                    />
                  </Field>
                </div>
                <ErrorNote error={postMut.error} />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setShowOrderForm(false)}>
                    Hủy
                  </Button>
                  <Button
                    disabled={!orderForm.vendor_id || !orderForm.part_id || postMut.isPending}
                    onClick={() =>
                      postMut.mutate({
                        kind: "order",
                        org_unit_id: opts.data?.units[0]?.id,
                        vendor_id: orderForm.vendor_id,
                        warehouse_id: orderForm.warehouse_id || opts.data?.warehouses[0]?.id,
                        due_date: orderForm.due_date || null,
                        issue_now: true,
                        lines: [
                          {
                            part_id: orderForm.part_id,
                            qty_ordered: Number(orderForm.qty_ordered),
                            unit_price: Number(orderForm.unit_price),
                          },
                        ],
                      })
                    }
                  >
                    Tạo &amp; Phát hành đơn
                  </Button>
                </div>
              </div>
            )}

            {sub.data && sub.data.orders.length > 0 ? (
              <Table head={["Số đơn gia công", "PR Cung ứng", "Nhà cung cấp & Kho nhận", "Hẹn giao", "Trạng thái"]}>
                {sub.data.orders.map((r) => {
                  const st = SUBCONTRACT_STATUS[r.status] ?? ["PENDING_QC", r.status];
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedOrderId(r.id)}
                      className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                        selectedOrderId === r.id ? "bg-sky-50/70 dark:bg-sky-950/30 font-semibold" : ""
                      }`}
                    >
                      <td className="py-2 pr-3 font-mono font-bold text-sky-700 dark:text-sky-400">{r.code}</td>
                      <td className="py-2 pr-3">
                        {r.pr_code ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 dark:bg-amber-950/70 px-1.5 py-0.5 font-mono text-[11px] font-bold text-amber-900 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                            🛒 {r.pr_code}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        <div className="font-semibold">{r.vendor_code} — {r.vendor_name}</div>
                        <div className="text-[11px] text-slate-500">Kho nhận: <span className="font-mono font-bold">{r.warehouse_code}</span></div>
                      </td>
                      <td className="py-2 pr-3 text-xs">{fmtDate(r.due_date)}</td>
                      <td className="py-2 pr-3">
                        <StatusBadge status={st[0]} label={st[1]} />
                      </td>
                    </tr>
                  );
                })}
              </Table>
            ) : (
              <Empty>Chưa có đơn đặt gia công thuê ngoài nào.</Empty>
            )}
          </Card>
        </div>

        {d && (
          <div className="lg:col-span-7 flex flex-col gap-3">
            <Card
              title={`Nghiệm thu IQC đơn gia công ${d.code} — ${d.vendor_name}${d.pr_code ? ` (PR Cung ứng: ${d.pr_code})` : ""}`}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <ActionBar
                    endpoint={`/api/factory/device/subcontracts/${d.id}/actions`}
                    version={d.version}
                    actions={d.actions}
                    labels={SUB_ACTION_LABELS}
                    onDone={refreshAll}
                  />
                  <Button variant="ghost" onClick={() => setSelectedOrderId(null)}>
                    Đóng chi tiết
                  </Button>
                </div>
              }
            >
              <div className="flex flex-col gap-3">
                <Table head={["Chi tiết", "Dung sai / Thiết bị đo", "SL đặt", "Đạt / Làm lại / Hỏng", "Đơn giá", "Lô kho / Phiếu NK / NCR"]}>
                  {d.lines.map((l) => (
                    <tr
                      key={l.id}
                      onClick={() => setIqcForm((s) => ({ ...s, line_id: l.id }))}
                      className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    >
                      <td className="py-2 pr-3">
                        {l.part_code} — {l.part_name}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        <div>{l.tolerance_standard}</div>
                        {l.measured_value && (
                          <div className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
                            Đo: {l.measured_value} ({l.measuring_instrument ?? "IQC"}, n={l.sample_qty ?? 1})
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3">{fmtQty(l.qty_ordered)}</td>
                      <td className="py-2 pr-3 font-semibold">
                        {fmtQty(l.qty_accepted)} / {fmtQty(l.qty_rework)} / {fmtQty(l.qty_rejected)}
                      </td>
                      <td className="py-2 pr-3">{fmtVnd(l.unit_price)}</td>
                      <td className="py-2 pr-3 font-mono text-[11px]">
                        <div>{l.lot_code ? `Lô: ${l.lot_code}` : "—"}</div>
                        {l.document_code && <div className="text-sky-700 dark:text-sky-400 font-bold">Phiếu NK: {l.document_code}</div>}
                        {l.ncr_code && <div className="text-rose-600 font-bold">NCR: {l.ncr_code}</div>}
                      </td>
                    </tr>
                  ))}
                </Table>

                {["ISSUED", "PARTIALLY_RECEIVED"].includes(d.status) && d.lines.length > 0 && (
                  <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex flex-col gap-2.5">
                    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200">
                      Nghiệm thu kích thước IQC (Chỉ nhập kho SL Đạt &gt; 0 · Tự động mở NCR nếu có SL Hỏng)
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                      <Field label="Dòng chi tiết">
                        <select
                          className={inputClass}
                          value={iqcForm.line_id || d.lines[0]?.id || ""}
                          onChange={(e) => setIqcForm({ ...iqcForm, line_id: e.target.value })}
                        >
                          {d.lines.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.part_code} (Đặt {fmtQty(l.qty_ordered)})
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="SL Đạt (Nhập kho)">
                        <input
                          type="number"
                          min={0}
                          className={inputClass}
                          value={iqcForm.qty_accepted}
                          onChange={(e) => setIqcForm({ ...iqcForm, qty_accepted: e.target.value })}
                        />
                      </Field>
                      <Field label="SL Làm lại (Rework)">
                        <input
                          type="number"
                          min={0}
                          className={inputClass}
                          value={iqcForm.qty_rework}
                          onChange={(e) => setIqcForm({ ...iqcForm, qty_rework: e.target.value })}
                        />
                      </Field>
                      <Field label="SL Hỏng (Tự mở NCR)">
                        <input
                          type="number"
                          min={0}
                          className={inputClass}
                          value={iqcForm.qty_rejected}
                          onChange={(e) => setIqcForm({ ...iqcForm, qty_rejected: e.target.value })}
                        />
                      </Field>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                      <Field label="Dụng cụ đo kiểm IQC">
                        <select
                          className={inputClass}
                          value={iqcForm.measuring_instrument}
                          onChange={(e) => setIqcForm({ ...iqcForm, measuring_instrument: e.target.value })}
                        >
                          <option value="THUOC_CAP_MITUTOYO">Thước cặp điện tử Mitutoyo</option>
                          <option value="PANME_NGOAI">Panme đo ngoài (±0.001mm)</option>
                          <option value="CMM_3D">Máy đo tọa độ 3D (CMM)</option>
                          <option value="PIN_GAUGE">Dưỡng kiểm lỗ (Pin Gauge)</option>
                          <option value="AOI_MULTIMETER">Kính AOI &amp; Đồng hồ VOM (PCB)</option>
                        </select>
                      </Field>
                      <Field label="Kích thước & dung sai theo bản vẽ">
                        <input
                          className={`${inputClass} font-mono`}
                          value={iqcForm.nominal_spec}
                          onChange={(e) => setIqcForm({ ...iqcForm, nominal_spec: e.target.value })}
                          placeholder="Theo bản vẽ; không ghi → ISO 2768-m"
                        />
                      </Field>
                      <Field label="Giá trị đo thực tế">
                        <input
                          className={`${inputClass} font-mono`}
                          value={iqcForm.measured_value}
                          onChange={(e) => setIqcForm({ ...iqcForm, measured_value: e.target.value })}
                          placeholder="VD: 120.01 mm"
                        />
                      </Field>
                      <Field label="Cỡ mẫu kiểm (n)">
                        <input
                          type="number"
                          min={1}
                          className={inputClass}
                          value={iqcForm.sample_qty}
                          onChange={(e) => setIqcForm({ ...iqcForm, sample_qty: e.target.value })}
                        />
                      </Field>
                    </div>
                    <Field label="Biên bản đo dung sai bản vẽ (IQC)">
                      <input
                        className={inputClass}
                        value={iqcForm.iqc_dimension_note}
                        onChange={(e) => setIqcForm({ ...iqcForm, iqc_dimension_note: e.target.value })}
                      />
                    </Field>
                    <label className="flex items-center gap-2 p-2.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-900 dark:text-emerald-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={iqcForm.auto_release_to_stock}
                        onChange={(e) => setIqcForm({ ...iqcForm, auto_release_to_stock: e.target.checked })}
                      />
                      <span>
                        ✅ Đã đạt IQC bản vẽ tại chỗ — Giải phóng lô (RELEASED) &amp; Nhập thẳng vào kệ chính của kho <b>{d.warehouse_code}</b> để sẵn sàng cấp phát / lắp ráp ngay (bỏ tích nếu muốn nhập vào Khu Biệt Trữ chờ QA duyệt riêng).
                      </span>
                    </label>
                    <LineDrawings key={iqcForm.line_id || d.lines[0].id} lineId={iqcForm.line_id || d.lines[0].id} />
                    <ErrorNote error={receiveMut.error} />
                    <div className="flex justify-end">
                      <Button
                        disabled={receiveMut.isPending}
                        onClick={() =>
                          receiveMut.mutate({
                            line_id: iqcForm.line_id || d.lines[0].id,
                            qty_accepted: Number(iqcForm.qty_accepted),
                            qty_rework: Number(iqcForm.qty_rework),
                            qty_rejected: Number(iqcForm.qty_rejected),
                            measuring_instrument: iqcForm.measuring_instrument,
                            nominal_spec: iqcForm.nominal_spec,
                            measured_value: iqcForm.measured_value,
                            sample_qty: Number(iqcForm.sample_qty) || 1,
                            iqc_dimension_note: iqcForm.iqc_dimension_note,
                            auto_release_to_stock: iqcForm.auto_release_to_stock,
                          })
                        }
                      >
                        Xác nhận nghiệm thu IQC &amp; Cập nhật kho 1 chạm
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card
          title="Danh mục chi tiết bản vẽ gia công (Subcontract Parts)"
          actions={
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="ghost"
                onClick={() => {
                  setVendorForm({
                    code: `NCC-GC-0${(opts.data?.vendors.length ?? 0) + 1}`,
                    name: "",
                    tax_code: "",
                    contact_name: "",
                    phone: "",
                    address: "",
                  });
                  setShowVendorForm((v) => !v);
                }}
              >
                + Thêm đơn vị gia công
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setEditingPartId(null);
                  setPartForm({
                    name: "",
                    item_id: opts.data?.items[0]?.id ?? "",
                    vendor_id: opts.data?.vendors[0]?.id ?? "",
                    material: "Nhôm hợp kim 6061-T6",
                    process_type: "CNC",
                    tolerance_standard: "ISO 2768-mK (±0.02mm)",
                  });
                  setShowPartForm((v) => !v);
                }}
              >
                + Khai báo chi tiết
              </Button>
            </div>
          }
        >
          {showVendorForm && (
            <div className="mb-3 p-3 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/30 flex flex-col gap-2.5">
              <div className="text-xs font-extrabold text-emerald-900 dark:text-emerald-200">
                🏭 Khai báo Đơn vị Gia công ngoài mới (CNC / Kim loại tấm / Anodize / PCB)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Field label="Mã đơn vị gia công *">
                  <input
                    className={`${inputClass} font-mono uppercase`}
                    value={vendorForm.code}
                    onChange={(e) => setVendorForm({ ...vendorForm, code: e.target.value })}
                    placeholder="VD: NCC-CNC-01"
                  />
                </Field>
                <Field label="Tên đơn vị / Xưởng gia công *">
                  <input
                    className={inputClass}
                    value={vendorForm.name}
                    onChange={(e) => setVendorForm({ ...vendorForm, name: e.target.value })}
                    placeholder="VD: Công ty Cơ khí Chính xác & CNC..."
                  />
                </Field>
                <Field label="Người liên hệ">
                  <input
                    className={inputClass}
                    value={vendorForm.contact_name}
                    onChange={(e) => setVendorForm({ ...vendorForm, contact_name: e.target.value })}
                  />
                </Field>
                <Field label="Số điện thoại">
                  <input
                    className={inputClass}
                    value={vendorForm.phone}
                    onChange={(e) => setVendorForm({ ...vendorForm, phone: e.target.value })}
                  />
                </Field>
              </div>
              <ErrorNote error={postMut.error} />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setShowVendorForm(false)}>
                  Hủy
                </Button>
                <Button
                  disabled={!vendorForm.code.trim() || !vendorForm.name.trim() || postMut.isPending}
                  onClick={() =>
                    postMut.mutate({
                      kind: "vendor",
                      org_unit_id: opts.data?.units[0]?.id,
                      ...vendorForm,
                    })
                  }
                >
                  Lưu đơn vị gia công
                </Button>
              </div>
            </div>
          )}

          <ErrorNote error={postMut.error} />
          {(opts.data?.vendors?.length ?? 0) > 0 && (
            <div className="mb-3 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50">
              <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1.5">
                🏭 Danh sách Đơn vị Gia công ngoài đã khai báo ({opts.data?.vendors.length} đơn vị):
              </div>
              <Table head={["Mã ĐV", "Tên đơn vị / Xưởng gia công", "Người liên hệ", "Số điện thoại", "Thao tác"]}>
                {(opts.data?.vendors ?? []).map((v) => (
                  <tr key={v.id}>
                    <td className="py-1.5 pr-3 font-mono font-bold text-xs text-emerald-700 dark:text-emerald-400">{v.code}</td>
                    <td className="py-1.5 pr-3 text-xs font-medium">{v.name}</td>
                    <td className="py-1.5 pr-3 text-xs">{v.contact_name || "—"}</td>
                    <td className="py-1.5 pr-3 text-xs font-mono">{v.phone || "—"}</td>
                    <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setVendorForm({
                              code: v.code,
                              name: v.name,
                              tax_code: v.tax_code ?? "",
                              contact_name: v.contact_name ?? "",
                              phone: v.phone ?? "",
                              address: v.address ?? "",
                            });
                            setShowVendorForm(true);
                          }}
                        >
                          Sửa
                        </Button>
                        <Button
                          variant="ghost"
                          className="text-rose-600 dark:text-rose-400"
                          disabled={postMut.isPending}
                          onClick={() => {
                            if (window.confirm(`Xóa đơn vị gia công ${v.code} (${v.name})?`)) {
                              postMut.mutate({ kind: "delete_vendor", id: v.id });
                            }
                          }}
                        >
                          Xóa
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
            </div>
          )}

          {showPartForm && (
            <div className="mb-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex flex-col gap-2.5">
              <div className="text-xs font-extrabold text-sky-900 dark:text-sky-200">
                {editingPartId
                  ? "✏️ Cập nhật Chi tiết Gia công & Đơn vị phụ trách"
                  : "➕ Khai báo Chi tiết Bản vẽ & Gán Đơn vị Gia công chính"}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Field label="Tên chi tiết bản vẽ">
                  <input
                    className={inputClass}
                    value={partForm.name}
                    onChange={(e) => setPartForm({ ...partForm, name: e.target.value })}
                    placeholder="VD: Khối nhôm tản nhiệt Peltier 48 giếng"
                  />
                </Field>
                <Field label="Công nghệ gia công">
                  <select
                    className={inputClass}
                    value={partForm.process_type}
                    onChange={(e) => setPartForm({ ...partForm, process_type: e.target.value })}
                  >
                    {Object.entries(PROCESS_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Vật tư kho liên kết (Linh kiện trong BOM)">
                  <select
                    className={inputClass}
                    value={partForm.item_id}
                    onChange={(e) => {
                      const nextItemId = e.target.value;
                      const matchedItem = (opts.data?.items ?? []).find((it) => it.id === nextItemId);
                      setPartForm({
                        ...partForm,
                        item_id: nextItemId,
                        name: partForm.name || matchedItem?.name || "",
                      });
                    }}
                  >
                    <option value="">-- Chọn vật tư --</option>
                    {(opts.data?.items ?? []).map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.code} — {it.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Đơn vị gia công chính (NCC phụ trách chi tiết này)">
                  <select
                    className={inputClass}
                    value={partForm.vendor_id}
                    onChange={(e) => setPartForm({ ...partForm, vendor_id: e.target.value })}
                  >
                    <option value="">-- Chọn đơn vị gia công --</option>
                    {(opts.data?.vendors ?? []).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.code} — {v.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Vật liệu chế tạo">
                  <input
                    className={inputClass}
                    value={partForm.material}
                    onChange={(e) => setPartForm({ ...partForm, material: e.target.value })}
                  />
                </Field>
                <Field label="Tiêu chuẩn dung sai">
                  <input
                    className={inputClass}
                    value={partForm.tolerance_standard}
                    onChange={(e) => setPartForm({ ...partForm, tolerance_standard: e.target.value })}
                  />
                </Field>
              </div>
              <ErrorNote error={postMut.error} />
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowPartForm(false);
                    setEditingPartId(null);
                  }}
                >
                  Hủy
                </Button>
                <Button
                  disabled={!partForm.name || !partForm.item_id || !partForm.vendor_id || postMut.isPending}
                  onClick={() =>
                    postMut.mutate({
                      kind: editingPartId ? "update_part" : "part",
                      id: editingPartId || undefined,
                      org_unit_id: opts.data?.units[0]?.id,
                      ...partForm,
                    })
                  }
                >
                  {editingPartId ? "Lưu cập nhật" : "Lưu chi tiết"}
                </Button>
              </div>
            </div>
          )}

          {sub.data && sub.data.parts.length > 0 ? (
            <Table head={["Mã", "Tên chi tiết", "Đơn vị gia công (NCC)", "Công nghệ", "Vật tư kho", "Dung sai", "Thao tác"]}>
              {sub.data.parts.map((p) => (
                <tr key={p.id}>
                  <td className="py-2 pr-3 font-mono font-bold">{p.code}</td>
                  <td className="py-2 pr-3">{p.name}</td>
                  <td className="py-2 pr-3">
                    <span className="font-semibold text-sky-700 dark:text-sky-300">{p.vendor_name}</span>
                    <div className="text-[10px] font-mono text-slate-500">{p.vendor_code}</div>
                  </td>
                  <td className="py-2 pr-3">{PROCESS_LABELS[p.process_type] ?? p.process_type}</td>
                  <td className="py-2 pr-3 font-mono">{p.item_code}</td>
                  <td className="py-2 pr-3">{p.tolerance_standard}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setEditingPartId(p.id);
                          setPartForm({
                            name: p.name,
                            item_id: p.item_id,
                            vendor_id: p.vendor_id,
                            material: p.material,
                            process_type: p.process_type,
                            tolerance_standard: p.tolerance_standard,
                          });
                          setShowPartForm(true);
                        }}
                      >
                        Sửa
                      </Button>
                      <Button
                        variant="ghost"
                        className="text-rose-600 dark:text-rose-400"
                        disabled={postMut.isPending}
                        onClick={() => {
                          if (window.confirm(`Xóa chi tiết bản vẽ gia công ${p.code} (${p.name})?`)) {
                            postMut.mutate({ kind: "delete_part", id: p.id });
                          }
                        }}
                      >
                        Xóa
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty>Chưa có chi tiết bản vẽ gia công nào. Bấm &ldquo;+ Thêm đơn vị gia công&rdquo; và &ldquo;+ Khai báo chi tiết&rdquo; ở góc trên để gán đơn vị gia công cho từng linh kiện.</Empty>
          )}
        </Card>

        <Card
          title="Đánh giá & Xếp hạng Nhà cung cấp (40% CL · 25% Tiến độ · 20% Giá · 15% Dịch vụ)"
          actions={
            <Button
              variant="ghost"
              onClick={() => {
                setEvalForm((s) => ({ ...s, vendor_id: opts.data?.vendors[0]?.id ?? "" }));
                setShowEvalForm((v) => !v);
              }}
            >
              ★ Chấm điểm NCC
            </Button>
          }
        >
          {showEvalForm && (
            <div className="mb-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex flex-col gap-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <Field label="Nhà cung cấp">
                  <select
                    className={inputClass}
                    value={evalForm.vendor_id}
                    onChange={(e) => setEvalForm({ ...evalForm, vendor_id: e.target.value })}
                  >
                    <option value="">-- Chọn NCC --</option>
                    {(opts.data?.vendors ?? []).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.code} — {v.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Chất lượng (40%, 1–5)">
                  <input
                    type="number"
                    step="0.1"
                    min={1}
                    max={5}
                    className={inputClass}
                    value={evalForm.quality_score}
                    onChange={(e) => setEvalForm({ ...evalForm, quality_score: e.target.value })}
                  />
                </Field>
                <Field label="Tiến độ (25%, 1–5)">
                  <input
                    type="number"
                    step="0.1"
                    min={1}
                    max={5}
                    className={inputClass}
                    value={evalForm.delivery_score}
                    onChange={(e) => setEvalForm({ ...evalForm, delivery_score: e.target.value })}
                  />
                </Field>
                <Field label="Giá thành (20%, 1–5)">
                  <input
                    type="number"
                    step="0.1"
                    min={1}
                    max={5}
                    className={inputClass}
                    value={evalForm.cost_score}
                    onChange={(e) => setEvalForm({ ...evalForm, cost_score: e.target.value })}
                  />
                </Field>
                <Field label="Dịch vụ (15%, 1–5)">
                  <input
                    type="number"
                    step="0.1"
                    min={1}
                    max={5}
                    className={inputClass}
                    value={evalForm.service_score}
                    onChange={(e) => setEvalForm({ ...evalForm, service_score: e.target.value })}
                  />
                </Field>
                <Field label="Kết luận">
                  <input
                    className={inputClass}
                    value={evalForm.conclusion}
                    onChange={(e) => setEvalForm({ ...evalForm, conclusion: e.target.value })}
                  />
                </Field>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setShowEvalForm(false)}>
                  Hủy
                </Button>
                <Button
                  disabled={!evalForm.vendor_id || postMut.isPending}
                  onClick={() =>
                    postMut.mutate({
                      kind: "vendor_eval",
                      org_unit_id: opts.data?.units[0]?.id,
                      vendor_id: evalForm.vendor_id,
                      eval_type: evalForm.eval_type,
                      quality_score: Number(evalForm.quality_score),
                      delivery_score: Number(evalForm.delivery_score),
                      cost_score: Number(evalForm.cost_score),
                      service_score: Number(evalForm.service_score),
                      conclusion: evalForm.conclusion,
                    })
                  }
                >
                  Lưu đánh giá
                </Button>
              </div>
            </div>
          )}

          {sub.data && sub.data.evaluations.length > 0 ? (
            <Table head={["Mã ĐG", "Nhà cung cấp", "CL / TĐ / Giá / DV", "Điểm TB", "Phân hạng"]}>
              {sub.data.evaluations.map((ev) => {
                const tb = TIER_BADGES[ev.tier] ?? ["PENDING_QC", ev.tier];
                return (
                  <tr key={ev.id}>
                    <td className="py-2 pr-3 font-mono font-bold">{ev.code}</td>
                    <td className="py-2 pr-3">
                      {ev.vendor_code} — {ev.vendor_name}
                    </td>
                    <td className="py-2 pr-3">
                      {ev.quality_score} / {ev.delivery_score} / {ev.cost_score} / {ev.service_score}
                    </td>
                    <td className="py-2 pr-3 font-bold">{fmtQty(ev.weighted_score)}</td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={tb[0]} label={tb[1]} />
                    </td>
                  </tr>
                );
              })}
            </Table>
          ) : (
            <Empty>Chưa có bản ghi đánh giá nhà cung cấp nào.</Empty>
          )}
        </Card>
      </div>
    </div>
  );
}

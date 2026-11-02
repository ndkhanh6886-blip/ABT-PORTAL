"use client";

import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Cpu,
  Hammer,
  Plus,
  ShoppingCart,
  Wrench,
} from "lucide-react";
import { api, fmtDate, fmtQty, fmtVnd } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { STATION_LABELS, useDeviceOptions } from "./shared";

interface MrpLine {
  bom_line_id: string;
  line_no: number;
  station_code: string;
  component_item_id: string;
  item_code: string;
  item_name: string;
  base_uom: string;
  qty_per_unit: number;
  uom: string;
  source_type: "BUY" | "SUBCONTRACT" | "MAKE";
  tracking_type: string;
  drawing_code: string | null;
  total_required: number;
  qty_available: number;
  shortage: number;
}

interface PoLine {
  id: string;
  line_no: number;
  kd_item_code: string;
  kd_item_name: string | null;
  kd_unit: string | null;
  qty: number;
  qty_delivered: number;
  transfer_price: number;
  model_id: string | null;
  model_code: string | null;
  model_name: string | null;
  current_revision: string | null;
  firmware_version: string | null;
  work_orders: {
    id: string;
    code: string;
    qty: number;
    status: string;
    serial_numbers: string[];
  }[];
  mrp_lines: MrpLine[];
}

interface DevicePoOrder {
  id: string;
  code: string;
  kd_po_code: string;
  kd_so_code: string | null;
  ship_mode: string;
  ship_to: { name?: string; address?: string } | null;
  requested_date: string | null;
  committed_date: string | null;
  notes: string | null;
  status: string;
  lines: PoLine[];
  purchase_requests: {
    id: string;
    code: string;
    status: string;
    est_total: number;
    reason: string;
    line_count: number;
  }[];
  subcontract_orders: {
    id: string;
    code: string;
    status: string;
    due_date: string | null;
    vendor_code: string;
    vendor_name: string;
    line_count: number;
  }[];
}

const PO_STATUS_BADGE: Record<string, [string, string]> = {
  RECEIVED: ["QUARANTINE", "Mới tiếp nhận"],
  ACCEPTED: ["PENDING_QC", "Đã nhận PO (Chờ lệnh SX)"],
  IN_PRODUCTION: ["QUARANTINE", "Đang lắp ráp theo lệnh WO"],
  READY: ["RELEASED", "Sẵn sàng giao"],
  PARTIALLY_DELIVERED: ["ON_HOLD", "Đã giao một phần"],
  DELIVERED: ["RELEASED", "Đã bàn giao đủ"],
  CLOSED: ["EXPIRED", "Đã đóng PO"],
};

export function DevicePoMrpView({
  initialPoId,
  onNavigateTab,
}: {
  initialPoId?: string | null;
  onNavigateTab?: (tab: "assembly" | "subcontract", targetId?: string) => void;
}) {
  const qc = useQueryClient();
  const opts = useDeviceOptions();

  const poQuery = useQuery({
    queryKey: ["factory", "device", "workflow", "po"],
    queryFn: () => api<{ po_orders: DevicePoOrder[] }>("/api/factory/device/workflow?section=po"),
  });

  const modelsQuery = useQuery({
    queryKey: ["factory", "device", "models"],
    queryFn: () =>
      api<{ id: string; code: string; name: string; current_revision_id: string | null; current_revision: string | null }[]>(
        "/api/factory/device/models"
      ),
  });

  const [selectedPoId, setSelectedPoId] = useState<string | null>(initialPoId ?? null);

  useEffect(() => {
    if (initialPoId) {
      setSelectedPoId(initialPoId);
    }
  }, [initialPoId]);
  const [showCreatePo, setShowCreatePo] = useState(false);
  const [serialPrefix, setSerialPrefix] = useState("");
  const [customSerials, setCustomSerials] = useState("");
  const [actionBanner, setActionBanner] = useState<string | null>(null);

  const [poForm, setPoForm] = useState({
    kd_po_code: "",
    customer_name: "Bệnh viện Quân Y 175 — Khoa Sinh học Phân tử",
    model_id: "",
    qty: "3",
    unit_price: "68000000",
    requested_date: "2026-11-25",
    notes: "Đặt hàng máy mới kèm bộ phụ kiện tiêu chuẩn",
  });

  const pos = poQuery.data?.po_orders ?? [];
  const selectedPo = pos.find((p) => p.id === selectedPoId) ?? pos[0] ?? null;

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["factory", "device", "workflow"] });
    qc.invalidateQueries({ queryKey: ["factory", "device", "orders"] });
    qc.invalidateQueries({ queryKey: ["factory", "device", "subcontracts"] });
    qc.invalidateQueries({ queryKey: ["factory", "prs"] });
  };

  const createPoMut = useMutation({
    mutationFn: () =>
      api<DevicePoOrder>("/api/factory/device/workflow", {
        method: "POST",
        json: {
          action: "create_po_order",
          kd_po_code: poForm.kd_po_code || undefined,
          customer_name: poForm.customer_name,
          model_id: poForm.model_id,
          qty: Number(poForm.qty),
          unit_price: Number(poForm.unit_price),
          requested_date: poForm.requested_date || null,
          notes: poForm.notes || null,
        },
      }),
    onSuccess: (created) => {
      setShowCreatePo(false);
      setSelectedPoId(created.id);
      setActionBanner(`Đã tạo đơn hàng PO thiết bị ${created.kd_po_code} và tự động nổ định mức BOM (MRP).`);
      refreshAll();
    },
  });

  const convertToWoMut = useMutation({
    mutationFn: (poId: string) =>
      api<{ work_order: { id: string; code: string }; serial_numbers: string[] }>("/api/factory/device/workflow", {
        method: "POST",
        json: {
          action: "convert_po_to_wo",
          internal_order_id: poId,
          serial_prefix: serialPrefix.trim() || null,
          serial_numbers: customSerials.trim() || null,
          priority: "HIGH",
        },
      }),
    onSuccess: (res) => {
      setSerialPrefix("");
      setCustomSerials("");
      setActionBanner(
        `Đã chuyển tiếp PO sang Lệnh lắp ráp ${res.work_order.code} và cấp ${res.serial_numbers.length} số Serial: ${res.serial_numbers.join(", ")}`
      );
      refreshAll();
    },
  });

  const proposePrMut = useMutation({
    mutationFn: (poId: string) =>
      api<{ id: string; code: string }>("/api/factory/device/workflow", {
        method: "POST",
        json: {
          action: "propose_pr_from_po",
          internal_order_id: poId,
        },
      }),
    onSuccess: (pr) => {
      setActionBanner(
        `Đã tạo Phiếu đề nghị mua hàng ${pr.code} (Trạng thái: Đã gửi Cung Ứng NVL) cho toàn bộ linh kiện mua ngoài bị thiếu của PO!`
      );
      refreshAll();
    },
  });

  const createSubcontractMut = useMutation({
    mutationFn: (poId: string) =>
      api<{ id: string; code: string }>("/api/factory/device/workflow", {
        method: "POST",
        json: {
          action: "create_subcontract_from_po",
          internal_order_id: poId,
          vendor_id: opts.data?.vendors[0]?.id ?? null,
          only_shortage: false,
        },
      }),
    onSuccess: (so) => {
      setActionBanner(
        `Đã tách & phát hành Đơn đặt gia công ngoài ${so.code} (CNC / Kim loại tấm / PCB) từ cấu trúc BOM của PO!`
      );
      refreshAll();
    },
  });

  const navigateToPurchaseHub = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("tbr-navigate", { detail: { tab: "factory-purchase" } }));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {actionBanner && (
        <div className="p-3 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-xs font-semibold text-emerald-900 dark:text-emerald-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{actionBanner}</span>
          </div>
          <Button variant="ghost" onClick={() => setActionBanner(null)}>
            Đóng
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* Left Column: List of Device POs */}
        <div className={selectedPo ? "lg:col-span-5 flex flex-col gap-3" : "lg:col-span-12 flex flex-col gap-3"}>
          <Card
            title={`Đơn Hàng PO Thiết Bị Từ Kinh Doanh (${pos.length})`}
            actions={
              <Button
                onClick={() => {
                  const firstM = (modelsQuery.data ?? []).find((m) => m.current_revision_id) ?? modelsQuery.data?.[0];
                  setPoForm((s) => ({ ...s, model_id: firstM?.id ?? "" }));
                  setShowCreatePo((v) => !v);
                }}
              >
                + Tiếp nhận / Tạo PO Thiết bị
              </Button>
            }
          >
            {showCreatePo && (
              <form
                className="mb-4 p-3 rounded-xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/40 dark:bg-sky-950/20 flex flex-col gap-2.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  createPoMut.mutate();
                }}
              >
                <div className="text-xs font-bold text-sky-800 dark:text-sky-300">
                  + Tạo Đơn Đặt Hàng Sản Xuất Thiết Bị (PO) &amp; Phân Tích MRP
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Field label="Mã PO Kinh doanh (Để trống tự sinh)">
                    <input
                      className={`${inputClass} font-mono uppercase`}
                      placeholder="VD: PO-KD-DEV-2603"
                      value={poForm.kd_po_code}
                      onChange={(e) => setPoForm({ ...poForm, kd_po_code: e.target.value })}
                    />
                  </Field>
                  <Field label="Ngày yêu cầu giao hàng *">
                    <input
                      type="date"
                      className={inputClass}
                      value={poForm.requested_date}
                      onChange={(e) => setPoForm({ ...poForm, requested_date: e.target.value })}
                      required
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Khách hàng / Đơn vị đặt máy *">
                      <input
                        className={inputClass}
                        value={poForm.customer_name}
                        onChange={(e) => setPoForm({ ...poForm, customer_name: e.target.value })}
                        required
                      />
                    </Field>
                  </div>
                  <Field label="Dòng máy (Model Thiết bị) *">
                    <select
                      className={inputClass}
                      value={poForm.model_id}
                      onChange={(e) => setPoForm({ ...poForm, model_id: e.target.value })}
                      required
                    >
                      <option value="">-- Chọn Model --</option>
                      {(modelsQuery.data ?? []).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.code} — {m.name} (Rev {m.current_revision ?? "A"})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Số lượng máy đặt *">
                    <input
                      type="number"
                      min={1}
                      max={200}
                      className={inputClass}
                      value={poForm.qty}
                      onChange={(e) => setPoForm({ ...poForm, qty: e.target.value })}
                      required
                    />
                  </Field>
                </div>
                <ErrorNote error={createPoMut.error} />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" type="button" onClick={() => setShowCreatePo(false)}>
                    Hủy
                  </Button>
                  <Button type="submit" disabled={!poForm.model_id || createPoMut.isPending}>
                    Tạo PO &amp; Phân tích BOM ngay
                  </Button>
                </div>
              </form>
            )}

            {pos.length === 0 ? (
              <Empty>Chưa có đơn hàng PO thiết bị nào.</Empty>
            ) : (
              <div className="flex flex-col gap-2.5">
                {pos.map((po) => {
                  const firstLine = po.lines?.[0];
                  const mrpLines = firstLine?.mrp_lines ?? [];
                  const buyShortCount = mrpLines.filter((m) => m.source_type === "BUY" && m.shortage > 0).length;
                  const subShortCount = mrpLines.filter((m) => m.source_type === "SUBCONTRACT" && m.shortage > 0).length;
                  const totalShortCount = buyShortCount + subShortCount;
                  const badge = PO_STATUS_BADGE[po.status] ?? ["PENDING_QC", po.status];
                  const isSelected = selectedPo?.id === po.id;

                  return (
                    <div
                      key={po.id}
                      onClick={() => setSelectedPoId(po.id)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? "border-sky-500 bg-sky-50/70 dark:bg-sky-950/30 shadow-sm"
                          : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-bold text-sky-700 dark:text-sky-400">
                          {po.kd_po_code} <span className="text-slate-400 font-normal">({po.code})</span>
                        </span>
                        <StatusBadge status={badge[0]} label={badge[1]} />
                      </div>

                      {firstLine && (
                        <div className="mt-1 text-xs font-bold text-slate-800 dark:text-slate-100">
                          {firstLine.model_code ?? firstLine.kd_item_code} — {firstLine.model_name ?? firstLine.kd_item_name} ×{" "}
                          <span className="text-sky-700 dark:text-sky-300">{fmtQty(firstLine.qty)} máy</span>
                        </div>
                      )}

                      <div className="text-[11px] text-slate-500 mt-1">
                        Khách hàng: <b>{po.ship_to?.name ?? "Kinh doanh ABT"}</b> · Hạn giao: <b>{fmtDate(po.committed_date || po.requested_date)}</b>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t border-slate-200/70 dark:border-slate-800 text-[11px]">
                        {totalShortCount > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold">
                            <AlertTriangle className="w-3 h-3" />
                            Thiếu {totalShortCount} mã LK ({buyShortCount} Mua, {subShortCount} Gia công)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold">
                            <CheckCircle2 className="w-3 h-3" />
                            Đủ 100% linh kiện tồn kho
                          </span>
                        )}

                        {(firstLine?.work_orders?.length ?? 0) > 0 && (
                          <span className="px-2 py-0.5 rounded-md bg-sky-100 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 font-mono font-semibold">
                            WO: {firstLine.work_orders.map((w) => w.code).join(", ")}
                          </span>
                        )}
                        {po.purchase_requests.length > 0 && (
                          <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-mono font-semibold">
                            PR: {po.purchase_requests.map((r) => r.code).join(", ")}
                          </span>
                        )}
                        {po.subcontract_orders.length > 0 && (
                          <span className="px-2 py-0.5 rounded-md bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 font-mono font-semibold">
                            Gia công: {po.subcontract_orders.map((s) => s.code).join(", ")}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Right Column: Selected PO Detail, 3 Action Buttons & BOM MRP Shortage Analyzer */}
        {selectedPo && (
          <div className="lg:col-span-7 flex flex-col gap-3">
            <Card
              title={`Đơn hàng PO: ${selectedPo.kd_po_code} — Phân tích Vật tư BOM (MRP) & Điều độ SX`}
              actions={
                <StatusBadge
                  status={PO_STATUS_BADGE[selectedPo.status]?.[0] ?? "PENDING_QC"}
                  label={PO_STATUS_BADGE[selectedPo.status]?.[1] ?? selectedPo.status}
                />
              }
            >
              <ErrorNote
                error={convertToWoMut.error || proposePrMut.error || createSubcontractMut.error}
              />

              <div className="flex flex-col gap-4 text-xs">
                {/* 3 Prominent 1-Click Action Boxes from PO */}
                <div className="p-3.5 rounded-2xl border border-sky-200 dark:border-sky-900/60 bg-gradient-to-r from-sky-50/70 via-indigo-50/40 to-amber-50/40 dark:from-slate-900 dark:to-slate-900 flex flex-col gap-3">
                  <div className="font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                    ⚡ Trung Tâm Chuyển Tiếp Tác Nghiệp Từ Đơn Hàng PO ({selectedPo.kd_po_code})
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Field label="Tiền tố Serial khi tạo Lệnh lắp ráp (Tùy chọn)">
                      <input
                        className={`${inputClass} font-mono`}
                        placeholder={`Mặc định: ${selectedPo.lines?.[0]?.model_code ?? "DEV"}`}
                        value={serialPrefix}
                        onChange={(e) => setSerialPrefix(e.target.value)}
                      />
                    </Field>
                    <Field label="Hoặc nhập danh sách Serial cụ thể (cách dấu phẩy)">
                      <input
                        className={`${inputClass} font-mono`}
                        placeholder="Để trống hệ thống tự sinh số Serial"
                        value={customSerials}
                        onChange={(e) => setCustomSerials(e.target.value)}
                      />
                    </Field>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={convertToWoMut.isPending}
                      onClick={() => convertToWoMut.mutate(selectedPo.id)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-700 hover:bg-sky-800 text-white font-bold shadow-sm cursor-pointer disabled:opacity-50"
                    >
                      <Cpu className="w-4 h-4" />
                      1. Chuyển tiếp từ PO ➔ Lệnh Lắp Ráp (WO &amp; Cấp Serial)
                    </button>

                    <button
                      type="button"
                      disabled={proposePrMut.isPending}
                      onClick={() => proposePrMut.mutate(selectedPo.id)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold shadow-sm cursor-pointer disabled:opacity-50"
                    >
                      <ShoppingCart className="w-4 h-4" />
                      2. Đề xuất mua linh kiện thiếu từ PO (Tạo PR)
                    </button>

                    <button
                      type="button"
                      disabled={createSubcontractMut.isPending}
                      onClick={() => createSubcontractMut.mutate(selectedPo.id)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-bold shadow-sm cursor-pointer disabled:opacity-50"
                    >
                      <Hammer className="w-4 h-4" />
                      3. Tạo Lệnh Gia Công Ngoài từ PO (CNC / PCB)
                    </button>
                  </div>
                </div>

                {/* Linked Work Orders, PRs, and Subcontract Orders for this PO */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  <div className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50">
                    <div className="font-bold text-slate-700 dark:text-slate-200 flex items-center justify-between">
                      <span>⚙️ Lệnh Lắp Ráp (WO)</span>
                      {onNavigateTab && (
                        <button
                          type="button"
                          onClick={() => onNavigateTab("assembly")}
                          className="text-[11px] text-sky-600 hover:underline flex items-center gap-0.5 cursor-pointer"
                        >
                          Mở tab Lắp ráp <ArrowUpRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {(selectedPo.lines?.[0]?.work_orders?.length ?? 0) === 0 ? (
                      <div className="text-[11px] text-slate-400 mt-1">Chưa chuyển sang lệnh lắp ráp WO.</div>
                    ) : (
                      <div className="mt-1.5 space-y-1">
                        {selectedPo.lines[0].work_orders.map((wo) => (
                          <div key={wo.id} className="text-[11px]">
                            <b className="font-mono text-sky-700 dark:text-sky-400">{wo.code}</b> ({wo.qty} máy — {wo.status})
                            <div className="font-mono text-[10px] text-slate-500">
                              S/N: {(wo.serial_numbers ?? []).join(", ")}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50">
                    <div className="font-bold text-slate-700 dark:text-slate-200 flex items-center justify-between">
                      <span>🛒 Đề Nghị Mua Hàng (PR)</span>
                      <button
                        type="button"
                        onClick={navigateToPurchaseHub}
                        className="text-[11px] text-amber-600 hover:underline flex items-center gap-0.5 cursor-pointer"
                      >
                        Cung Ứng NVL <ArrowUpRight className="w-3 h-3" />
                      </button>
                    </div>
                    {selectedPo.purchase_requests.length === 0 ? (
                      <div className="text-[11px] text-slate-400 mt-1">Chưa lập PR mua linh kiện thiếu.</div>
                    ) : (
                      <div className="mt-1.5 space-y-1">
                        {selectedPo.purchase_requests.map((pr) => (
                          <div key={pr.id} className="text-[11px]">
                            <b className="font-mono text-amber-700 dark:text-amber-400">{pr.code}</b> ({pr.line_count} mã LK —{" "}
                            <b>{pr.status}</b>)
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50">
                    <div className="font-bold text-slate-700 dark:text-slate-200 flex items-center justify-between">
                      <span>🔨 Đơn Gia Công (OPO)</span>
                      {onNavigateTab && (
                        <button
                          type="button"
                          onClick={() => onNavigateTab("subcontract")}
                          className="text-[11px] text-purple-600 hover:underline flex items-center gap-0.5 cursor-pointer"
                        >
                          Mở tab Gia công <ArrowUpRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {selectedPo.subcontract_orders.length === 0 ? (
                      <div className="text-[11px] text-slate-400 mt-1">Chưa tách đơn đặt gia công ngoài.</div>
                    ) : (
                      <div className="mt-1.5 space-y-1">
                        {selectedPo.subcontract_orders.map((so) => (
                          <div key={so.id} className="text-[11px]">
                            <b className="font-mono text-purple-700 dark:text-purple-400">{so.code}</b> — {so.vendor_name} (
                            <b>{so.status}</b>)
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* MRP BOM Explosion & Shortage Table */}
                {selectedPo.lines.map((line) => (
                  <div key={line.id} className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                        Bảng Phân Tích Định Mức BOM &amp; Tồn Kho Linh Kiện (MRP): {line.model_code ?? line.kd_item_code} (Rev{" "}
                        {line.current_revision ?? "A"}) × {fmtQty(line.qty)} máy
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Đã bàn giao: <b>{fmtQty(line.qty_delivered)} / {fmtQty(line.qty)} máy</b>
                      </span>
                    </div>

                    {line.mrp_lines.length === 0 ? (
                      <Empty>Model thiết bị này chưa có cấu trúc BOM phát hành.</Empty>
                    ) : (
                      <Table
                        head={[
                          "Trạm lắp ráp",
                          "Mã LK & Bản vẽ",
                          "Tên chi tiết / Linh kiện",
                          "Nguồn cung",
                          "ĐM/máy",
                          `Tổng cần (${line.qty} máy)`,
                          "Tồn kho khả dụng",
                          "Đủ / Thiếu hụt",
                        ]}
                      >
                        {line.mrp_lines.map((m) => (
                          <tr key={m.bom_line_id}>
                            <td className="py-1.5 pr-2">{STATION_LABELS[m.station_code] ?? m.station_code}</td>
                            <td className="py-1.5 pr-2 font-mono font-bold">
                              {m.item_code}
                              {m.drawing_code && (
                                <div className="text-[10px] text-sky-600 font-normal">[{m.drawing_code}]</div>
                              )}
                            </td>
                            <td className="py-1.5 pr-2">{m.item_name}</td>
                            <td className="py-1.5 pr-2">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${
                                  m.source_type === "SUBCONTRACT"
                                    ? "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300"
                                    : "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
                                }`}
                              >
                                {m.source_type === "SUBCONTRACT" ? "GIA CÔNG NGOÀI" : "MUA THƯƠNG MẠI"}
                              </span>
                            </td>
                            <td className="py-1.5 pr-2 font-mono">
                              {fmtQty(m.qty_per_unit)} {m.uom}
                            </td>
                            <td className="py-1.5 pr-2 font-mono font-bold">
                              {fmtQty(m.total_required)} {m.uom}
                            </td>
                            <td className="py-1.5 pr-2 font-mono">
                              {fmtQty(m.qty_available)} {m.base_uom}
                            </td>
                            <td className="py-1.5 pr-2 font-mono">
                              {m.shortage > 0 ? (
                                <span className="px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold">
                                  Thiếu {fmtQty(m.shortage)} {m.uom}
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold">
                                  Đủ tồn kho
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </Table>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

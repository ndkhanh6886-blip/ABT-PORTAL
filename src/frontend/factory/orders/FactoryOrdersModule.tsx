"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Cpu, Dna, FlaskConical, Plus, Rocket, Truck } from "lucide-react";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate, fmtQty, useFactoryMe } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { ShipmentForm, type OrderLine } from "./ShipmentForm";

const STATUS: Record<string, [string, string]> = {
  RECEIVED: ["QUARANTINE", "Chờ nhận đơn"],
  ACCEPTED: ["PENDING_QC", "Đã nhận đơn"],
  IN_PRODUCTION: ["PENDING_QC", "Đang sản xuất"],
  READY: ["RELEASED", "Sẵn sàng giao"],
  PARTIALLY_DELIVERED: ["ON_HOLD", "Giao một phần"],
  DELIVERED: ["RELEASED", "Đã giao đủ"],
  CLOSED: ["EXPIRED", "Đã đóng"],
  REJECTED: ["REJECTED", "Từ chối"],
  CANCELLED: ["EXPIRED", "KD đã hủy"],
};
const SHIP_STATUS: Record<string, string> = {
  POSTED: "Đã xuất",
  DELIVERED: "Đã giao khách",
  ACKNOWLEDGED: "KD đã xác nhận",
};
const ACTIONS = {
  reject: "Từ chối đơn",
  start_production: "Bắt đầu sản xuất",
  mark_ready: "Sẵn sàng giao",
};

const MODULE_META: Record<
  string,
  { badge: string; color: string; actionLabel: string; targetTab: string; desc: string }
> = {
  KIT: {
    badge: "🧪 Phòng Sản xuất Kit",
    color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300",
    actionLabel: "🚀 Phát Lệnh Sản Xuất Kit (EBR)",
    targetTab: "factory-kit",
    desc: "Nổ BOM Kit ➔ Pha chế MasterMix ➔ Chiết rót ➔ Đóng gói ➔ FQC ➔ Nhập KHO-KIT",
  },
  OLIGO: {
    badge: "🧬 Phòng Tổng hợp Oligo",
    color: "bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300",
    actionLabel: "🧬 Phát Đơn Tổng Hợp Oligo",
    targetTab: "factory-oligo",
    desc: "Tiếp nhận trình tự (5'➔3') ➔ Ghép mẻ máy tổng hợp ➔ Tinh sạch OPC/HPLC ➔ Đo OD260 ➔ QC",
  },
  DEVICE: {
    badge: "⚙️ Phòng Kỹ thuật – Thiết bị",
    color: "bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300",
    actionLabel: "🔧 Phát Lệnh Lắp Ráp WO & Cấp Serial",
    targetTab: "factory-device",
    desc: "Nổ BOM Thiết bị ➔ Báo thiếu PR/Gia công ➔ Lắp ráp 4 Trạm ➔ Burn-in 48h ➔ FQC & DHR",
  },
};

interface OrderDetail {
  id: string;
  code: string;
  kd_po_code: string;
  kd_so_code: string | null;
  org_unit_id: string;
  org_unit_code?: string;
  org_unit_name: string;
  module_key?: string;
  ship_mode: string;
  ship_to: { name?: string; address?: string; receiver?: string; phone?: string } | null;
  requested_date: string | null;
  committed_date: string | null;
  due_date_change_count: number;
  status: string;
  version: number;
  notes: string | null;
  lines: (OrderLine & {
    item_name: string | null;
    transfer_price: string;
    available_fg_qty?: number;
    kit_order_lots?: string[];
    oligo_order_codes?: string[];
    device_order_serials?: string[];
  })[];
  shipments: {
    id: string;
    code: string;
    status: string;
    ship_mode: string;
    created_at: string;
    kd_inbound_code: string | null;
    warehouse_code: string;
  }[];
  actions: AllowedAction[];
}

function AcceptForm({ order, onDone }: { order: OrderDetail; onDone: () => void }) {
  const [date, setDate] = useState(order.requested_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<"PIN" | "PASSWORD">("PIN");
  const [pin, setPin] = useState("123456");
  const accept = useMutation({
    mutationFn: () =>
      api(`/api/factory/intake/orders/${order.id}/actions`, {
        method: "POST",
        json: {
          action: "accept",
          expectedVersion: order.version,
          payload: { committed_date: date },
          credential: { method, secret: pin },
        },
      }),
    onSuccess: onDone,
  });
  return (
    <form
      className="grid gap-2 sm:grid-cols-4 items-end p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50"
      onSubmit={(e) => {
        e.preventDefault();
        accept.mutate();
      }}
    >
      <Field label="Ngày giao cam kết *">
        <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </Field>
      <Field label="Xác thực chữ ký điện tử (PIN: 123456) *">
        <div className="flex gap-1">
          <select
            className={`${inputClass} w-28`}
            value={method}
            onChange={(e) => {
              const m = e.target.value as "PIN" | "PASSWORD";
              setMethod(m);
              setPin(m === "PIN" ? "123456" : "");
            }}
          >
            <option value="PIN">PIN</option>
            <option value="PASSWORD">Mật khẩu</option>
          </select>
          <input className={inputClass} type="password" value={pin} onChange={(e) => setPin(e.target.value)} required />
        </div>
      </Field>
      <Button type="submit" disabled={accept.isPending}>
        Ký Nhận Đơn & Cam Kết SLA ✍
      </Button>
      <div className="sm:col-span-4">
        <ErrorNote error={accept.error} />
      </div>
    </form>
  );
}

function ProofUpload({ shipmentId, onDone }: { shipmentId: string; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const upload = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("file", file!);
      const res = await fetch(`/api/factory/intake/shipments/${shipmentId}/proof`, {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
    },
    onSuccess: onDone,
  });
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <input
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="text-xs"
      />
      <Button variant="ghost" disabled={!file || upload.isPending} onClick={() => upload.mutate()}>
        Tải biên bản & xác nhận đã giao
      </Button>
      {upload.error && <span className="text-rose-600">{(upload.error as Error).message}</span>}
    </span>
  );
}

function NewInternalOrderForm({ onDone }: { onDone: (createdId: string) => void }) {
  const qc = useQueryClient();
  const catalog = useQuery({
    queryKey: ["factory", "internal-order-catalog"],
    queryFn: () =>
      api<{
        departments: { id: string; code: string; name: string; module_key: string }[];
        items: { id: string; code: string; name: string; base_uom: string; domain_key: string }[];
      }>("/api/factory/intake/ops"),
  });

  const [targetModule, setTargetModule] = useState<"KIT" | "OLIGO" | "DEVICE">("KIT");
  const [kdPoCode, setKdPoCode] = useState("");
  const [shipMode, setShipMode] = useState<"TO_KD" | "DROP_SHIP">("TO_KD");
  const [customerName, setCustomerName] = useState("Kho Thương Mại Kinh Doanh ABT");
  const [requestedDate, setRequestedDate] = useState(() =>
    new Date(Date.now() + 7 * 86400 * 1000).toISOString().slice(0, 10)
  );
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("20");
  const [price, setPrice] = useState("2500000");
  const [notes, setNotes] = useState("");

  const domainItems = (catalog.data?.items ?? []).filter((i) => i.domain_key === targetModule);
  const effectiveItemId = itemId && domainItems.some((i) => i.id === itemId) ? itemId : domainItems[0]?.id ?? "";

  const createMut = useMutation({
    mutationFn: () =>
      api<{ id: string; code: string }>("/api/factory/intake/ops", {
        method: "POST",
        idempotent: true,
        json: {
          op: "create_internal_order",
          target_module: targetModule,
          kd_po_code: kdPoCode || undefined,
          ship_mode: shipMode,
          customer_name: customerName,
          requested_date: requestedDate,
          notes: notes || undefined,
          auto_accept: true,
          lines: [
            {
              item_id: effectiveItemId,
              qty: Number(qty.replace(",", ".")) || 1,
              transfer_price: Number(price.replace(/\D/g, "")) || 1500000,
            },
          ],
        },
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["factory", "internal-orders"] });
      onDone(res.id);
    },
  });

  return (
    <Card title="Tạo Đơn Đặt Hàng Nội Bộ Mới (Phân luồng tự động từ Kinh doanh về Phòng Sản xuất)">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          createMut.mutate();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="1. Phân luồng về Phòng Sản Xuất *">
            <select
              className={inputClass}
              value={targetModule}
              onChange={(e) => {
                const m = e.target.value as "KIT" | "OLIGO" | "DEVICE";
                setTargetModule(m);
                setItemId("");
                setQty(m === "DEVICE" ? "2" : m === "OLIGO" ? "10" : "25");
                setPrice(m === "DEVICE" ? "65000000" : m === "OLIGO" ? "850000" : "2800000");
              }}
            >
              <option value="KIT">🧪 Phòng Sản xuất Kit Chẩn đoán (P-KIT)</option>
              <option value="OLIGO">🧬 Phòng Tổng hợp Oligo (P-OLIGO)</option>
              <option value="DEVICE">⚙️ Phòng Kỹ thuật – Thiết bị (P-DEVICE)</option>
            </select>
          </Field>

          <Field label="2. Chọn Sản phẩm / Thiết bị / Bộ Oligo *">
            <select
              className={inputClass}
              value={effectiveItemId}
              onChange={(e) => setItemId(e.target.value)}
              required
            >
              {domainItems.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.code} — {it.name} ({it.base_uom})
                </option>
              ))}
            </select>
          </Field>

          <Field label="3. Số lượng đặt *">
            <input
              className={inputClass}
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              required
            />
          </Field>

          <Field label="4. Giá chuyển giao nội bộ (VND)">
            <input
              className={inputClass}
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>

          <Field label="Mã PO Kinh doanh" hint="Để trống: tự động sinh mã PO-KD-...">
            <input
              className={inputClass}
              placeholder={`VD: PO-KD-${targetModule}-2605`}
              value={kdPoCode}
              onChange={(e) => setKdPoCode(e.target.value)}
            />
          </Field>

          <Field label="Hình thức giao hàng">
            <select
              className={inputClass}
              value={shipMode}
              onChange={(e) => setShipMode(e.target.value as "TO_KD" | "DROP_SHIP")}
            >
              <option value="TO_KD">🏢 Giao về Kho Kinh doanh (TO_KD)</option>
              <option value="DROP_SHIP">🚚 Giao thẳng Khách hàng / Bệnh viện (DROP_SHIP)</option>
            </select>
          </Field>

          <Field label="Ngày yêu cầu giao *">
            <input
              className={inputClass}
              type="date"
              value={requestedDate}
              onChange={(e) => setRequestedDate(e.target.value)}
              required
            />
          </Field>

          <Field label="Đơn vị nhận / Ghi chú">
            <input
              className={inputClass}
              value={notes || customerName}
              onChange={(e) => {
                setCustomerName(e.target.value);
                setNotes(e.target.value);
              }}
            />
          </Field>
        </div>

        <ErrorNote error={createMut.error ?? catalog.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onDone("")}>
            Hủy
          </Button>
          <Button type="submit" disabled={createMut.isPending || !effectiveItemId}>
            {createMut.isPending ? "Đang phân luồng đơn…" : "Gửi & Phân luồng Đơn Nội Bộ"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function OrderPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const me = useFactoryMe();
  const [shipping, setShipping] = useState(false);
  const [toast, setToast] = useState<{ msg: string; targetTab?: string } | null>(null);

  const order = useQuery({
    queryKey: ["factory", "internal-order", id],
    queryFn: () => api<OrderDetail>(`/api/factory/intake/orders/${id}`),
  });

  const refresh = () => {
    setShipping(false);
    qc.invalidateQueries({ queryKey: ["factory", "internal-order", id] });
    qc.invalidateQueries({ queryKey: ["factory", "internal-orders"] });
    qc.invalidateQueries({ queryKey: ["factory", "stock"] });
    qc.invalidateQueries({ queryKey: ["factory", "kit"] });
    qc.invalidateQueries({ queryKey: ["factory", "oligo"] });
    qc.invalidateQueries({ queryKey: ["factory", "device"] });
  };

  const moveDate = useMutation({
    mutationFn: ({ date, reason }: { date: string; reason: string }) =>
      api(`/api/factory/intake/orders/${id}/date`, {
        method: "POST",
        json: { committed_date: date, reason, version: order.data!.version },
      }),
    onSuccess: refresh,
  });

  const dispatchProdMut = useMutation({
    mutationFn: (lineId: string) =>
      api<{ domain: string; order_code: string; target_tab: string; message: string }>("/api/factory/intake/ops", {
        method: "POST",
        idempotent: true,
        json: { op: "dispatch_to_production", order_id: id, line_id: lineId },
      }),
    onSuccess: (res) => {
      setToast({ msg: `✅ ${res.message}`, targetTab: res.target_tab });
      refresh();
    },
  });

  const o = order.data;
  const modMeta = MODULE_META[o?.module_key ?? "KIT"] ?? MODULE_META.KIT;
  const canShip =
    me.data?.permissions.includes("intake.shipment.post") &&
    o &&
    ["ACCEPTED", "IN_PRODUCTION", "READY", "PARTIALLY_DELIVERED"].includes(o.status);

  const navigateToModule = (tabKey: string) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("factory-switch-tab", { detail: { tab: tabKey } }));
    }
  };

  return (
    <Card
      title={o ? `Chi tiết Đơn nội bộ ${o.code} — PO Kinh doanh: ${o.kd_po_code}` : "Đơn nội bộ"}
      actions={
        <Button variant="ghost" onClick={onClose}>
          Đóng
        </Button>
      }
    >
      <ErrorNote error={order.error ?? moveDate.error ?? dispatchProdMut.error} />
      {toast && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-3.5 py-2 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
          <span>{toast.msg}</span>
          <div className="flex items-center gap-2">
            {toast.targetTab && (
              <Button onClick={() => navigateToModule(toast.targetTab!)}>
                Mở phân hệ sản xuất tương ứng →
              </Button>
            )}
            <button type="button" className="text-emerald-600 hover:underline cursor-pointer" onClick={() => setToast(null)}>
              Đóng
            </button>
          </div>
        </div>
      )}

      {o && (
        <div className="flex flex-col gap-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={STATUS[o.status][0]} label={STATUS[o.status][1]} />
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${modMeta.color}`}>
                {modMeta.badge} ({o.org_unit_name})
              </span>
              <span>
                · KD yêu cầu: <b>{fmtDate(o.requested_date)}</b> · Cam kết: <b>{fmtDate(o.committed_date)}</b>
                {o.due_date_change_count > 0 && ` (đã dời ${o.due_date_change_count} lần)`}
              </span>
              <span>
                · Hình thức: <b>{o.ship_mode === "DROP_SHIP" ? "🚚 Giao thẳng khách" : "🏢 Về kho Kinh doanh"}</b>
              </span>
            </div>
            <div className="text-[11px] text-slate-500">{modMeta.desc}</div>
          </div>

          {o.ship_to && (
            <p className="text-slate-600 dark:text-slate-300">
              📍 Địa chỉ giao nhận: <b>{o.ship_to.name}</b> — {o.ship_to.address}{" "}
              {o.ship_to.receiver && `· Người nhận: ${o.ship_to.receiver}`} {o.ship_to.phone}
            </p>
          )}

          <Table
            head={[
              "#",
              "Mã & Tên Sản phẩm Đặt hàng",
              "Số lượng Đặt / Đã giao",
              "Tồn Thành phẩm Khả dụng",
              "Lệnh Sản Xuất / Mẻ Oligo / Lệnh Lắp Ráp (Serial) Đã Gắn",
              "Chuyển tiếp Sản xuất (1-Click)",
            ]}
          >
            {o.lines.map((l) => {
              const tracked = [
                ...(l.kit_order_lots ?? []),
                ...(l.oligo_order_codes ?? []),
                ...(l.device_order_serials ?? []),
              ];
              const remainingQty = Math.max(0, Number(l.qty) - Number(l.qty_delivered));
              const availFg = Number(l.available_fg_qty ?? 0);
              const hasEnoughStock = availFg >= remainingQty && remainingQty > 0;
              return (
                <tr key={l.id}>
                  <td className="py-2 pr-3">{l.line_no}</td>
                  <td className="py-2 pr-3">
                    <div className="font-mono font-bold text-slate-900 dark:text-white">
                      {l.kd_item_code} {l.kd_item_name && `— ${l.kd_item_name}`}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {l.item_code ? (
                        `Mã nhà máy: ${l.item_code} · Giá chuyển giao: ${fmtQty(l.transfer_price)} đ/${l.kd_unit ?? l.base_uom}`
                      ) : (
                        <span className="text-rose-600 font-semibold">Chưa gắn mã nhà máy</span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <div className="font-bold">
                      {fmtQty(l.qty)} {l.kd_unit}
                    </div>
                    <div className="text-[11px] text-slate-500">Đã giao: {fmtQty(l.qty_delivered)}</div>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {hasEnoughStock ? (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                        ✅ Sẵn kho: {fmtQty(availFg)} {l.base_uom}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
                        ⚠️ Tồn TP: {fmtQty(availFg)} {l.base_uom} (Cần SX)
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {tracked.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {tracked.map((t, idx) => (
                          <span
                            key={idx}
                            className="inline-block px-2 py-0.5 rounded-md bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 font-mono text-[11px] text-sky-700 dark:text-sky-300"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-400 italic">Chưa phát lệnh sản xuất</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {remainingQty > 0 && (
                        <Button
                          onClick={() => dispatchProdMut.mutate(l.id)}
                          disabled={dispatchProdMut.isPending}
                        >
                          {modMeta.actionLabel}
                        </Button>
                      )}
                      {hasEnoughStock && canShip && !shipping && (
                        <Button variant="ghost" onClick={() => setShipping(true)}>
                          🚚 Xuất giao ngay
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>

          {o.actions.some((a) => a.action === "accept") && <AcceptForm order={o} onDone={refresh} />}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ActionBar
              endpoint={`/api/factory/intake/orders/${o.id}/actions`}
              version={o.version}
              actions={o.actions.filter((a) => a.action !== "accept")}
              labels={ACTIONS}
              onDone={refresh}
            />
            <div className="flex flex-wrap items-center gap-2">
              {o.committed_date &&
                ["ACCEPTED", "IN_PRODUCTION", "READY", "PARTIALLY_DELIVERED"].includes(o.status) &&
                me.data?.permissions.includes("intake.order.manage") && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const date = window.prompt("Ngày giao mới (YYYY-MM-DD):", o.committed_date?.slice(0, 10));
                      const reason = date && window.prompt("Lý do dời ngày giao:");
                      if (date && reason) moveDate.mutate({ date, reason });
                    }}
                  >
                    Dời ngày giao cam kết
                  </Button>
                )}
              {canShip && !shipping && (
                <Button onClick={() => setShipping(true)}>🚚 Lập Phiếu Xuất Giao Hàng</Button>
              )}
            </div>
          </div>

          {canShip && shipping && (
            <ShipmentForm orderId={o.id} orgUnitId={o.org_unit_id} lines={o.lines} onDone={refresh} />
          )}

          {o.shipments.length > 0 && (
            <div className="flex flex-col gap-1 pt-2 border-t border-slate-200 dark:border-slate-800">
              <b>Lịch sử Phiếu Xuất Giao Hàng (`Shipment`):</b>
              {o.shipments.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold text-sky-700 dark:text-sky-400">{s.code}</span> · Xuất từ kho{" "}
                  <b>{s.warehouse_code}</b> · {SHIP_STATUS[s.status]}
                  {s.kd_inbound_code && ` · KD nhập ${s.kd_inbound_code}`}
                  {s.ship_mode === "DROP_SHIP" && s.status === "POSTED" && (
                    <ProofUpload shipmentId={s.id} onDone={refresh} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/** "Đơn nội bộ": purchase orders of Kinh doanh received by the 3 production departments (Kit, Oligo, Device). */
export function FactoryOrdersModule() {
  const [status, setStatus] = useState("");
  const [moduleFilter, setModuleFilter] = useState<"" | "KIT" | "OLIGO" | "DEVICE">("");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const list = useQuery({
    queryKey: ["factory", "internal-orders", status],
    queryFn: () =>
      api<
        {
          id: string;
          code: string;
          kd_po_code: string;
          kd_so_code: string | null;
          ship_mode: string;
          requested_date: string | null;
          committed_date: string | null;
          status: string;
          org_unit_code?: string;
          org_unit_name: string;
          module_key?: string;
          line_count: number;
          items_summary?: string;
        }[]
      >(`/api/factory/intake/orders${status ? `?status=${status}` : ""}`),
  });

  const allRows = list.data ?? [];
  const filtered = allRows.filter((r) => !moduleFilter || r.module_key === moduleFilter);

  const countByMod = {
    ALL: allRows.length,
    KIT: allRows.filter((r) => r.module_key === "KIT").length,
    OLIGO: allRows.filter((r) => r.module_key === "OLIGO").length,
    DEVICE: allRows.filter((r) => r.module_key === "DEVICE").length,
  };

  return (
    <div className="flex flex-col gap-3">
      {/* SƠ ĐỒ PHÂN LUỒNG 3 PHÒNG SẢN XUẤT */}
      <div className="grid gap-3 sm:grid-cols-4">
        <button
          type="button"
          onClick={() => setModuleFilter("")}
          className={`text-left rounded-2xl border p-3.5 cursor-pointer transition-all ${
            moduleFilter === ""
              ? "border-sky-600 bg-sky-50/80 dark:bg-sky-950/40 shadow-sm"
              : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-sky-400"
          }`}
        >
          <div className="text-xs font-bold text-slate-600 dark:text-slate-300">📋 Tất cả Đơn Nội Bộ</div>
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">{countByMod.ALL} đơn</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Cổng tiếp nhận chung từ Khối Kinh Doanh</div>
        </button>

        <button
          type="button"
          onClick={() => setModuleFilter("KIT")}
          className={`text-left rounded-2xl border p-3.5 cursor-pointer transition-all ${
            moduleFilter === "KIT"
              ? "border-emerald-600 bg-emerald-50/80 dark:bg-emerald-950/40 shadow-sm"
              : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-400"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold text-emerald-700 dark:text-emerald-300">
            <span>🧪 Phòng Sản xuất Kit (P-KIT)</span>
            <FlaskConical className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold text-emerald-800 dark:text-emerald-200 mt-1">
            {countByMod.KIT} đơn
          </div>
          <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5">
            Chuyển thành Lệnh SX Kit (`kit.production_order`)
          </div>
        </button>

        <button
          type="button"
          onClick={() => setModuleFilter("OLIGO")}
          className={`text-left rounded-2xl border p-3.5 cursor-pointer transition-all ${
            moduleFilter === "OLIGO"
              ? "border-purple-600 bg-purple-50/80 dark:bg-purple-950/40 shadow-sm"
              : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-purple-400"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold text-purple-700 dark:text-purple-300">
            <span>🧬 Phòng Tổng hợp Oligo (P-OLIGO)</span>
            <Dna className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold text-purple-800 dark:text-purple-200 mt-1">
            {countByMod.OLIGO} đơn
          </div>
          <div className="text-[11px] text-purple-600 dark:text-purple-400 mt-0.5">
            Chuyển thành Đơn Oligo (`oligo.oligo_order`)
          </div>
        </button>

        <button
          type="button"
          onClick={() => setModuleFilter("DEVICE")}
          className={`text-left rounded-2xl border p-3.5 cursor-pointer transition-all ${
            moduleFilter === "DEVICE"
              ? "border-sky-600 bg-sky-50/80 dark:bg-sky-950/40 shadow-sm"
              : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-sky-400"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold text-sky-700 dark:text-sky-300">
            <span>⚙️ Phòng Kỹ thuật – Thiết bị</span>
            <Cpu className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold text-sky-800 dark:text-sky-200 mt-1">
            {countByMod.DEVICE} đơn
          </div>
          <div className="text-[11px] text-sky-600 dark:text-sky-400 mt-0.5">
            Chuyển thành Lệnh Lắp Ráp (`device.device_order`)
          </div>
        </button>
      </div>

      {creating && (
        <NewInternalOrderForm
          onDone={(newId) => {
            setCreating(false);
            if (newId) setSelected(newId);
          }}
        />
      )}

      {selected && <OrderPanel key={selected} id={selected} onClose={() => setSelected(null)} />}

      <Card
        title="Danh sách Đơn Nội Bộ từ Khối Kinh Doanh & Điều Phối Về 3 Phòng Sản Xuất"
        actions={
          <div className="flex flex-wrap md:flex-nowrap items-center justify-end gap-2">
            <select
              className={`${inputClass} !w-52 shrink-0`}
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value as typeof moduleFilter)}
              aria-label="Phòng sản xuất nhận luồng"
            >
              <option value="">Mọi phòng sản xuất</option>
              <option value="KIT">Phòng Sản xuất Kit</option>
              <option value="OLIGO">Phòng Tổng hợp Oligo</option>
              <option value="DEVICE">Phòng Kỹ thuật – Thiết bị</option>
            </select>
            <select
              className={`${inputClass} !w-44 shrink-0`}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Trạng thái"
            >
              <option value="">Mọi trạng thái</option>
              {Object.entries(STATUS).map(([k, [, v]]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            {!creating && (
              <Button className="whitespace-nowrap shrink-0" onClick={() => setCreating(true)}>+ Tạo Đơn Nội Bộ</Button>
            )}
          </div>
        }
      >
        <ErrorNote error={list.error} />
        {filtered.length === 0 && (
          <Empty>Chưa có đơn nội bộ trong phân luồng này. Bấm "+ Tạo Đơn Nội Bộ" để khởi tạo đơn mới.</Empty>
        )}
        {filtered.length > 0 && (
          <Table
            head={[
              "Mã đơn",
              "PO Kinh doanh",
              "Phòng Sản xuất nhận luồng",
              "Sản phẩm & Số lượng",
              "Hình thức giao",
              "KD yêu cầu",
              "Cam kết SLA",
              "Trạng thái",
              "Thao tác",
            ]}
          >
            {filtered.map((r) => {
              const meta = MODULE_META[r.module_key ?? "KIT"] ?? MODULE_META.KIT;
              return (
                <tr
                  key={r.id}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  onClick={() => setSelected(r.id)}
                >
                  <td className="py-2 pr-3 font-mono font-bold text-sky-700 dark:text-sky-400">{r.code}</td>
                  <td className="py-2 pr-3 font-mono font-semibold">{r.kd_po_code}</td>
                  <td className="py-2 pr-3">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${meta.color}`}>
                      {meta.badge}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-xs font-mono text-slate-700 dark:text-slate-300 max-w-64 truncate">
                    {r.items_summary || `${r.line_count} dòng sản phẩm`}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-xs">
                    {r.ship_mode === "DROP_SHIP" ? "🚚 Giao thẳng khách" : "🏢 Về kho KD"}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(r.requested_date)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap font-semibold">{fmtDate(r.committed_date)}</td>
                  <td className="py-2 pr-3">
                    <StatusBadge status={STATUS[r.status][0]} label={STATUS[r.status][1]} />
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <button
                      type="button"
                      className="text-xs font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(r.id);
                      }}
                    >
                      Điều phối / Phát lệnh →
                    </button>
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

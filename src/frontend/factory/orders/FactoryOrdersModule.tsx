"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
const SHIP_STATUS: Record<string, string> = { POSTED: "Đã xuất", DELIVERED: "Đã giao khách", ACKNOWLEDGED: "KD đã xác nhận" };
const ACTIONS = { reject: "Từ chối đơn", start_production: "Bắt đầu sản xuất", mark_ready: "Sẵn sàng giao" };

interface OrderDetail {
  id: string; code: string; kd_po_code: string; kd_so_code: string | null; org_unit_id: string; org_unit_name: string; ship_mode: string;
  ship_to: { name?: string; address?: string; receiver?: string; phone?: string } | null; requested_date: string | null; committed_date: string | null;
  due_date_change_count: number; status: string; version: number; notes: string | null;
  lines: (OrderLine & { item_name: string | null; transfer_price: string })[];
  shipments: { id: string; code: string; status: string; ship_mode: string; created_at: string; kd_inbound_code: string | null; warehouse_code: string }[];
  actions: AllowedAction[];
}

function AcceptForm({ order, onDone }: { order: OrderDetail; onDone: () => void }) {
  const [date, setDate] = useState(order.requested_date?.slice(0, 10) ?? "");
  const [pin, setPin] = useState("");
  const accept = useMutation({
    mutationFn: () =>
      api(`/api/factory/intake/orders/${order.id}/actions`, {
        method: "POST",
        json: { action: "accept", expectedVersion: order.version, payload: { committed_date: date }, credential: { method: "PIN", secret: pin } },
      }),
    onSuccess: onDone,
  });
  return (
    <form className="grid gap-2 sm:grid-cols-4 items-end p-3 rounded-xl border border-slate-200 dark:border-slate-800" onSubmit={(e) => { e.preventDefault(); accept.mutate(); }}>
      <Field label="Ngày giao cam kết *"><input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
      <Field label="PIN chữ ký *"><input className={inputClass} type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} required /></Field>
      <Button type="submit" disabled={accept.isPending}>Nhận đơn ✍</Button>
      <div className="sm:col-span-4"><ErrorNote error={accept.error} /></div>
    </form>
  );
}

function ProofUpload({ shipmentId, onDone }: { shipmentId: string; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const upload = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("file", file!);
      const res = await fetch(`/api/factory/intake/shipments/${shipmentId}/proof`, { method: "POST", body: fd, credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
    },
    onSuccess: onDone,
  });
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs" />
      <Button variant="ghost" disabled={!file || upload.isPending} onClick={() => upload.mutate()}>Tải biên bản & xác nhận đã giao</Button>
      {upload.error && <span className="text-rose-600">{(upload.error as Error).message}</span>}
    </span>
  );
}

function OrderPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const me = useFactoryMe();
  const [shipping, setShipping] = useState(false);
  const order = useQuery({ queryKey: ["factory", "internal-order", id], queryFn: () => api<OrderDetail>(`/api/factory/intake/orders/${id}`) });
  const refresh = () => {
    setShipping(false);
    qc.invalidateQueries({ queryKey: ["factory", "internal-order", id] });
    qc.invalidateQueries({ queryKey: ["factory", "internal-orders"] });
    qc.invalidateQueries({ queryKey: ["factory", "stock"] });
  };
  const moveDate = useMutation({
    mutationFn: ({ date, reason }: { date: string; reason: string }) =>
      api(`/api/factory/intake/orders/${id}/date`, { method: "POST", json: { committed_date: date, reason, version: order.data!.version } }),
    onSuccess: refresh,
  });
  const o = order.data;
  const canShip = me.data?.permissions.includes("intake.shipment.post") && o && ["ACCEPTED", "IN_PRODUCTION", "READY", "PARTIALLY_DELIVERED"].includes(o.status);
  return (
    <Card title={o ? `Đơn nội bộ ${o.code} — PO ${o.kd_po_code}` : "Đơn nội bộ"} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <ErrorNote error={order.error ?? moveDate.error} />
      {o && (
        <div className="flex flex-col gap-3 text-xs">
          <p>
            <StatusBadge status={STATUS[o.status][0]} label={STATUS[o.status][1]} /> · {o.org_unit_name} · KD yêu cầu {fmtDate(o.requested_date)} · Cam kết <b>{fmtDate(o.committed_date)}</b>
            {o.due_date_change_count > 0 && ` (đã dời ${o.due_date_change_count} lần)`} · {o.ship_mode === "DROP_SHIP" ? "Giao thẳng khách" : "Giao về kho Kinh doanh"}
            {o.kd_so_code && ` · Đơn bán ${o.kd_so_code}`}
          </p>
          {o.ship_to && <p>Giao đến: <b>{o.ship_to.name}</b> — {o.ship_to.address} {o.ship_to.receiver && `· ${o.ship_to.receiver}`} {o.ship_to.phone}</p>}
          <Table head={["#", "Mã hàng KD", "Mã nhà máy", "Số lượng", "Đã giao", "Giá chuyển giao"]}>
            {o.lines.map((l) => (
              <tr key={l.id}>
                <td className="py-2 pr-3">{l.line_no}</td>
                <td className="py-2 pr-3">{l.kd_item_code} {l.kd_item_name && `— ${l.kd_item_name}`}</td>
                <td className="py-2 pr-3">{l.item_code ? `${l.item_code} (1 ${l.kd_unit ?? "ĐV"} = ${fmtQty(l.kd_unit_factor)} ${l.base_uom})` : <span className="text-rose-600 font-semibold">Chưa gắn — vào Danh mục vật tư để khai Mã hàng KD</span>}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{fmtQty(l.qty)} {l.kd_unit}</td>
                <td className="py-2 pr-3">{fmtQty(l.qty_delivered)}</td>
                <td className="py-2 pr-3 text-right">{fmtQty(l.transfer_price)} đ</td>
              </tr>
            ))}
          </Table>
          {o.actions.some((a) => a.action === "accept") && <AcceptForm order={o} onDone={refresh} />}
          <ActionBar endpoint={`/api/factory/intake/orders/${o.id}/actions`} version={o.version} actions={o.actions.filter((a) => a.action !== "accept")} labels={ACTIONS} onDone={refresh} />
          {o.committed_date && ["ACCEPTED", "IN_PRODUCTION", "READY", "PARTIALLY_DELIVERED"].includes(o.status) && me.data?.permissions.includes("intake.order.manage") && (
            <div>
              <Button
                variant="ghost"
                onClick={() => {
                  const date = window.prompt("Ngày giao mới (YYYY-MM-DD):", o.committed_date?.slice(0, 10));
                  const reason = date && window.prompt("Lý do dời ngày giao:");
                  if (date && reason) moveDate.mutate({ date, reason });
                }}
              >
                Dời ngày giao
              </Button>
            </div>
          )}
          {canShip && (shipping ? <ShipmentForm orderId={o.id} orgUnitId={o.org_unit_id} lines={o.lines} onDone={refresh} /> : <div><Button onClick={() => setShipping(true)}>Xuất giao hàng</Button></div>)}
          {o.shipments.length > 0 && (
            <div className="flex flex-col gap-1">
              <b>Phiếu giao</b>
              {o.shipments.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">{s.code}</span> · kho {s.warehouse_code} · {SHIP_STATUS[s.status]}
                  {s.kd_inbound_code && ` · KD nhập ${s.kd_inbound_code}`}
                  {s.ship_mode === "DROP_SHIP" && s.status === "POSTED" && <ProofUpload shipmentId={s.id} onDone={refresh} />}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/** "Đơn nội bộ": purchase orders of Kinh doanh received by the production departments. */
export function FactoryOrdersModule() {
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["factory", "internal-orders", status],
    queryFn: () => api<{ id: string; code: string; kd_po_code: string; kd_so_code: string | null; ship_mode: string; requested_date: string | null; committed_date: string | null; status: string; org_unit_name: string; line_count: number }[]>(`/api/factory/intake/orders${status ? `?status=${status}` : ""}`),
  });
  return (
    <div className="flex flex-col gap-3">
      {selected && <OrderPanel key={selected} id={selected} onClose={() => setSelected(null)} />}
      <Card
        title="Đơn nội bộ từ Kinh doanh"
        actions={
          <select className={`${inputClass} w-48`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Trạng thái">
            <option value="">Mọi trạng thái</option>
            {Object.entries(STATUS).map(([k, [, v]]) => <option key={k} value={k}>{v}</option>)}
          </select>
        }
      >
        <ErrorNote error={list.error} />
        {list.data?.length === 0 && <Empty>Chưa có đơn nội bộ. Kinh doanh gửi PO cho nhà cung cấp nội bộ tại Cung Ứng → Nhà máy.</Empty>}
        {list.data && list.data.length > 0 && (
          <Table head={["Mã đơn", "PO Kinh doanh", "Phòng", "Hình thức", "KD yêu cầu", "Cam kết", "Dòng", "Trạng thái"]}>
            {list.data.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setSelected(r.id)}>
                <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{r.code}</td>
                <td className="py-2 pr-3 font-mono">{r.kd_po_code}</td>
                <td className="py-2 pr-3">{r.org_unit_name}</td>
                <td className="py-2 pr-3">{r.ship_mode === "DROP_SHIP" ? "Giao thẳng" : "Về kho KD"}</td>
                <td className="py-2 pr-3">{fmtDate(r.requested_date)}</td>
                <td className="py-2 pr-3">{fmtDate(r.committed_date)}</td>
                <td className="py-2 pr-3">{r.line_count}</td>
                <td className="py-2 pr-3"><StatusBadge status={STATUS[r.status][0]} label={STATUS[r.status][1]} /></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

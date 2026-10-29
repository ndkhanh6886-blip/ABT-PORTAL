"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate, fmtQty, useFactoryMe } from "../api";
import { Button, Card, Empty, ErrorNote, inputClass, StatusBadge, Table } from "../ui";

const PO_STATUS: Record<string, [string, string]> = {
  DRAFT: ["PENDING_QC", "Nháp"],
  ISSUED: ["QUARANTINE", "Đã phát hành"],
  PARTIALLY_RECEIVED: ["ON_HOLD", "Nhận một phần"],
  RECEIVED: ["RELEASED", "Đã nhận đủ"],
  CLOSED: ["EXPIRED", "Đã đóng"],
  CANCELLED: ["EXPIRED", "Đã hủy"],
};
const ACTION_LABEL = { issue: "Phát hành đơn", cancel: "Hủy đơn", close: "Đóng đơn", short_close: "Đóng đơn (thiếu hàng)" };

interface PoLine {
  id: string; line_no: number; item_code: string; item_name: string; tracking: string; uom: string; qty_ordered: string; qty_received: string;
  unit_price: string; vat_rate: string; warehouse_code: string; pr_code: string;
}
interface PoDetail {
  id: string; code: string; status: string; version: number; supplier_code: string; supplier_name: string; order_date: string; expected_date: string | null;
  total_amount: string; payment_terms: string | null; lines: PoLine[];
  receipts: { id: string; code: string; received_at: string; delivery_note_no: string | null; received_by_name: string | null }[];
  actions: AllowedAction[];
}
interface RecvLine { qty: string; mfr_lot_no: string; mfg_date: string; expiry_date: string; serials: string }

function ReceiveForm({ po, onDone }: { po: PoDetail; onDone: () => void }) {
  const [rows, setRows] = useState<Record<string, RecvLine>>({});
  const [noteNo, setNoteNo] = useState("");
  const recv = useMutation({
    mutationFn: () =>
      api<{ code: string; lots: { code: string; qc_required: boolean }[] }>("/api/factory/purchase/receipts", {
        method: "POST",
        idempotent: true,
        json: {
          po_id: po.id,
          delivery_note_no: noteNo || null,
          lines: Object.entries(rows)
            .filter(([, r]) => r.qty)
            .map(([po_line_id, r]) => ({
              po_line_id,
              qty: Number(r.qty.replace(",", ".")),
              mfr_lot_no: r.mfr_lot_no || null,
              mfg_date: r.mfg_date || null,
              expiry_date: r.expiry_date || null,
              serials: r.serials ? r.serials.split(/[\s,;]+/).filter(Boolean) : undefined,
            })),
        },
      }),
    onSuccess: () => {
      setRows({});
      onDone();
    },
  });
  const set = (id: string, p: Partial<RecvLine>) => setRows({ ...rows, [id]: { ...{ qty: "", mfr_lot_no: "", mfg_date: "", expiry_date: "", serials: "" }, ...rows[id], ...p } });
  const open = po.lines.filter((l) => Number(l.qty_received) < Number(l.qty_ordered));

  return (
    <form className="flex flex-col gap-2 p-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/30" onSubmit={(e) => { e.preventDefault(); recv.mutate(); }}>
      <div className="text-xs font-bold">Nhận hàng vào kho (vị trí biệt trữ). Lô mới ở trạng thái Biệt trữ, chờ QC kiểm tra đầu vào.</div>
      <input className={`${inputClass} sm:w-72`} placeholder="Số phiếu giao hàng của NCC" value={noteNo} onChange={(e) => setNoteNo(e.target.value)} />
      <Table head={["Vật tư", "Còn chờ", "SL nhận", "Lô NSX", "Ngày SX", "Hạn dùng", "Serial (cách nhau dấu phẩy)"]}>
        {open.map((l) => {
          const r = rows[l.id];
          return (
            <tr key={l.id}>
              <td className="py-2 pr-3">{l.item_code} — {l.item_name}</td>
              <td className="py-2 pr-3 whitespace-nowrap">{fmtQty(Number(l.qty_ordered) - Number(l.qty_received))} {l.uom}</td>
              <td className="py-2 pr-3 w-24"><input className={inputClass} inputMode="decimal" value={r?.qty ?? ""} onChange={(e) => set(l.id, { qty: e.target.value })} /></td>
              <td className="py-2 pr-3 w-32"><input className={inputClass} disabled={l.tracking !== "LOT"} value={r?.mfr_lot_no ?? ""} onChange={(e) => set(l.id, { mfr_lot_no: e.target.value })} /></td>
              <td className="py-2 pr-3 w-36"><input className={inputClass} type="date" value={r?.mfg_date ?? ""} onChange={(e) => set(l.id, { mfg_date: e.target.value })} /></td>
              <td className="py-2 pr-3 w-36"><input className={inputClass} type="date" value={r?.expiry_date ?? ""} onChange={(e) => set(l.id, { expiry_date: e.target.value })} /></td>
              <td className="py-2 pr-3 min-w-40"><input className={inputClass} disabled={l.tracking !== "SERIAL"} value={r?.serials ?? ""} onChange={(e) => set(l.id, { serials: e.target.value })} /></td>
            </tr>
          );
        })}
      </Table>
      <ErrorNote error={recv.error} />
      {recv.data && <p className="text-xs text-emerald-700 dark:text-emerald-400">Đã nhận {recv.data.code}: lô {recv.data.lots.map((l) => l.code).join(", ")}.</p>}
      <div><Button type="submit" disabled={recv.isPending || !Object.values(rows).some((r) => r.qty)}>{recv.isPending ? "Đang ghi…" : "Ghi nhận hàng"}</Button></div>
    </form>
  );
}

export function OrderDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const me = useFactoryMe();
  const [receiving, setReceiving] = useState(false);
  const po = useQuery({ queryKey: ["factory", "po", id], queryFn: () => api<PoDetail>(`/api/factory/purchase/orders/${id}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["factory", "po", id] });
    qc.invalidateQueries({ queryKey: ["factory", "pos"] });
    qc.invalidateQueries({ queryKey: ["factory", "stock"] });
  };
  const p = po.data;
  const canReceive = me.data?.permissions.includes("purchase.receipt.post") && p && ["ISSUED", "PARTIALLY_RECEIVED"].includes(p.status);
  return (
    <Card title={p ? `Đơn mua ${p.code} — ${p.supplier_name}` : "Đơn mua"} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <ErrorNote error={po.error} />
      {p && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-slate-600 dark:text-slate-300">
            <StatusBadge status={PO_STATUS[p.status][0]} label={PO_STATUS[p.status][1]} /> · Ngày đặt {fmtDate(p.order_date)} · Giao dự kiến {fmtDate(p.expected_date)} · Tổng {fmtQty(p.total_amount)} đ (gồm VAT)
            {p.payment_terms && <> · {p.payment_terms}</>}
          </p>
          <Table head={["#", "Vật tư", "Đề nghị", "Kho nhận", "Đặt", "Đã nhận", "Đơn giá", "VAT"]}>
            {p.lines.map((l) => (
              <tr key={l.id}>
                <td className="py-2 pr-3">{l.line_no}</td>
                <td className="py-2 pr-3">{l.item_code} — {l.item_name}</td>
                <td className="py-2 pr-3 font-mono">{l.pr_code}</td>
                <td className="py-2 pr-3">{l.warehouse_code}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{fmtQty(l.qty_ordered)} {l.uom}</td>
                <td className="py-2 pr-3">{fmtQty(l.qty_received)}</td>
                <td className="py-2 pr-3 text-right">{fmtQty(l.unit_price)} đ</td>
                <td className="py-2 pr-3">{Number(l.vat_rate)}%</td>
              </tr>
            ))}
          </Table>
          <ActionBar endpoint={`/api/factory/purchase/orders/${p.id}/actions`} version={p.version} actions={p.actions} labels={ACTION_LABEL} onDone={refresh} />
          {canReceive && (receiving ? <ReceiveForm po={p} onDone={() => { setReceiving(false); refresh(); }} /> : <div><Button onClick={() => setReceiving(true)}>Nhận hàng</Button></div>)}
          {p.receipts.length > 0 && (
            <div className="text-xs">
              <b>Phiếu nhận:</b>{" "}
              {p.receipts.map((r) => `${r.code} (${new Date(r.received_at).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}, ${r.received_by_name ?? ""}${r.delivery_note_no ? `, PGH ${r.delivery_note_no}` : ""})`).join(" · ")}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function OrdersView({ openId, onOpen }: { openId: string | null; onOpen: (id: string | null) => void }) {
  const [status, setStatus] = useState("");
  const list = useQuery({
    queryKey: ["factory", "pos", status],
    queryFn: () => api<{ id: string; code: string; status: string; order_date: string; expected_date: string | null; total_amount: string; supplier_name: string; line_count: number }[]>(`/api/factory/purchase/orders${status ? `?status=${status}` : ""}`),
  });
  return (
    <div className="flex flex-col gap-3">
      {openId && <OrderDetail key={openId} id={openId} onClose={() => onOpen(null)} />}
      <Card
        title="Đơn mua NVL"
        actions={
          <select className={`${inputClass} w-48`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Trạng thái">
            <option value="">Mọi trạng thái</option>
            {Object.entries(PO_STATUS).map(([k, [, v]]) => <option key={k} value={k}>{v}</option>)}
          </select>
        }
      >
        <ErrorNote error={list.error} />
        {list.data?.length === 0 && <Empty>Chưa có đơn mua.</Empty>}
        {list.data && list.data.length > 0 && (
          <Table head={["Mã", "Nhà cung cấp", "Ngày đặt", "Giao dự kiến", "Tổng (VND)", "Dòng", "Trạng thái"]}>
            {list.data.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => onOpen(r.id)}>
                <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{r.code}</td>
                <td className="py-2 pr-3">{r.supplier_name}</td>
                <td className="py-2 pr-3">{fmtDate(r.order_date)}</td>
                <td className="py-2 pr-3">{fmtDate(r.expected_date)}</td>
                <td className="py-2 pr-3 text-right">{fmtQty(r.total_amount)}</td>
                <td className="py-2 pr-3">{r.line_count}</td>
                <td className="py-2 pr-3"><StatusBadge status={PO_STATUS[r.status][0]} label={PO_STATUS[r.status][1]} /></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

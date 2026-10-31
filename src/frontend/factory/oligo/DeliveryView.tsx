"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { printWithReprint } from "./labels";
import { ORDER_STATUS, PURIFICATION } from "./shared";

interface QueueRow { id: string; code: string; customer_label: string | null; due_date: string | null; status: string; kd_po_code: string | null; ready: number; delivered: number; total: number }
interface Options {
  order: { id: string; code: string; customer_label: string | null };
  internal_order: { code: string; kd_po_code: string; ship_mode: string; status: string } | null;
  lines: { id: string; line_no: number; kd_item_code: string; kd_item_name: string | null; kd_unit: string | null; qty: number; qty_delivered: number }[];
  sequences: { id: string; code: string; name: string; status: string; base_count: number; scale_code: string; purification: string; tube_count: number; labelled: boolean }[];
  deliveries: { id: string; code: string; recipient: string | null; created_at: string; shipment_status: string | null; sequences: number }[];
}

/** Suggested quantity for a PO line: bases when Kinh doanh sells per base, otherwise one per sequence. */
const suggest = (unit: string | null, picked: Options["sequences"]) => (/base|nu|mer/i.test(unit ?? "") ? picked.reduce((n, s) => n + s.base_count, 0) : picked.length);

function DeliveryPanel({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const opts = useQuery({ queryKey: ["factory", "oligo-delivery", orderId], queryFn: () => api<Options>(`/api/factory/oligo/deliveries/options?order_id=${orderId}`) });
  const [picked, setPicked] = useState<string[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [recipient, setRecipient] = useState("");
  const [notes, setNotes] = useState("");
  const refresh = () => ["oligo-delivery", "oligo-deliveries", "oligo-orders", "oligo-order"].forEach((k) => qc.invalidateQueries({ queryKey: ["factory", k] }));
  const print = useMutation({ mutationFn: (ids: string[]) => printWithReprint(ids), onSuccess: refresh });
  const deliver = useMutation({
    mutationFn: () =>
      api("/api/factory/oligo/deliveries", {
        method: "POST",
        idempotent: true,
        json: {
          order_id: orderId,
          sequence_ids: picked,
          lines: Object.entries(qty).filter(([, v]) => Number(v) > 0).map(([order_line_id, v]) => ({ order_line_id, qty: Number(v) })),
          recipient: recipient || null,
          notes: notes || null,
        },
      }),
    onSuccess: () => {
      setPicked([]);
      setQty({});
      refresh();
    },
  });
  const d = opts.data;
  const sel = d?.sequences.filter((s) => picked.includes(s.id)) ?? [];
  const toggle = (id: string) => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(next);
    if (d?.lines.length === 1) setQty({ [d.lines[0].id]: String(suggest(d.lines[0].kd_unit, d.sequences.filter((s) => next.includes(s.id)))) });
  };

  return (
    <Card title={d ? <span>Giao đơn <span className="font-mono">{d.order.code}</span>{d.order.customer_label ? ` · ${d.order.customer_label}` : ""}</span> : "Giao hàng"} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <ErrorNote error={opts.error ?? print.error} />
      {d && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {d.internal_order
              ? `Đơn nội bộ ${d.internal_order.code} · PO Kinh doanh ${d.internal_order.kd_po_code} · ${d.internal_order.ship_mode === "DROP_SHIP" ? "giao thẳng khách (chứng từ qua Kinh doanh)" : "giao về Kinh doanh"}`
              : "Không gắn PO Kinh doanh: bàn giao nội bộ."}
          </p>
          {d.sequences.length === 0 && <Empty>Không còn trình tự nào đã đạt QC chờ giao.</Empty>}
          {d.sequences.length > 0 && (
            <Table head={["", "Trình tự", "Số base", "Thang / tinh sạch", "Số ống", "Nhãn", ""]}>
              {d.sequences.map((s) => (
                <tr key={s.id}>
                  <td className="py-1.5 pr-3"><input type="checkbox" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} aria-label={`Chọn ${s.code}`} /></td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{s.code} <span className="font-sans text-slate-500">{s.name}</span>{s.status === "POOLED" && <span className="text-slate-400"> (gộp)</span>}</td>
                  <td className="py-1.5 pr-3 text-right">{s.base_count}</td>
                  <td className="py-1.5 pr-3 text-xs">{s.scale_code} · {PURIFICATION[s.purification as keyof typeof PURIFICATION]}</td>
                  <td className="py-1.5 pr-3 text-right">{s.tube_count}</td>
                  <td className="py-1.5 pr-3 text-xs">{s.labelled ? "Đã in" : <span className="text-amber-700 dark:text-amber-400">Chưa in</span>}</td>
                  <td className="py-1.5 pr-3 text-right">
                    {s.status !== "POOLED" && <Button variant="ghost" onClick={() => print.mutate([s.id])} disabled={print.isPending}>{s.labelled ? "In lại" : "In nhãn"}</Button>}
                  </td>
                </tr>
              ))}
            </Table>
          )}
          {picked.length > 0 && (
            <form className="flex flex-col gap-3 p-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/30" onSubmit={(e) => { e.preventDefault(); deliver.mutate(); }}>
              <div className="text-xs font-bold">Giao {sel.length} trình tự ({sel.reduce((n, s) => n + s.tube_count, 0)} ống)</div>
              {d.internal_order ? (
                <Table head={["Dòng PO", "Mã hàng KD", "Đặt", "Đã giao", "Giao lần này"]}>
                  {d.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="py-1 pr-3">{l.line_no}</td>
                      <td className="py-1 pr-3 text-xs">{l.kd_item_code} {l.kd_item_name}</td>
                      <td className="py-1 pr-3 text-right text-xs">{fmtQty(l.qty)} {l.kd_unit}</td>
                      <td className="py-1 pr-3 text-right text-xs">{fmtQty(l.qty_delivered)}</td>
                      <td className="py-1 pr-3"><input className={`${inputClass} w-28`} inputMode="decimal" value={qty[l.id] ?? ""} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} /></td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Field label="Người / bộ phận nhận *"><input className={inputClass} value={recipient} onChange={(e) => setRecipient(e.target.value)} required /></Field>
              )}
              <Field label="Ghi chú"><input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
              <div><Button type="submit" disabled={deliver.isPending}>{deliver.isPending ? "Đang lưu…" : "Lập phiếu giao"}</Button></div>
              <ErrorNote error={deliver.error} />
            </form>
          )}
          {d.deliveries.length > 0 && (
            <Table head={["Phiếu giao", "Ngày", "Số trình tự", "Nhận / Kinh doanh"]}>
              {d.deliveries.map((x) => (
                <tr key={x.id}>
                  <td className="py-1.5 pr-3 font-mono">{x.code}</td>
                  <td className="py-1.5 pr-3 text-xs">{fmtDate(x.created_at)}</td>
                  <td className="py-1.5 pr-3 text-right">{x.sequences}</td>
                  <td className="py-1.5 pr-3 text-xs">{x.recipient ?? ({ POSTED: "Đã gửi Kinh doanh", DELIVERED: "Đã giao khách", ACKNOWLEDGED: "Kinh doanh đã nhận" } as Record<string, string>)[x.shipment_status ?? ""] ?? x.shipment_status}</td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      )}
    </Card>
  );
}

export function OrderDeliverySection({ orderId, canDeliver }: { orderId: string; canDeliver: boolean }) {
  const qc = useQueryClient();
  const opts = useQuery({
    queryKey: ["factory", "oligo-delivery", orderId],
    queryFn: () => api<Options>(`/api/factory/oligo/deliveries/options?order_id=${orderId}`),
    enabled: canDeliver,
  });
  const [picked, setPicked] = useState<string[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [recipient, setRecipient] = useState("");
  const [notes, setNotes] = useState("");
  const refresh = () => ["oligo-delivery", "oligo-deliveries", "oligo-orders", "oligo-order"].forEach((k) => qc.invalidateQueries({ queryKey: ["factory", k] }));
  const print = useMutation({ mutationFn: (ids: string[]) => printWithReprint(ids), onSuccess: refresh });
  const deliver = useMutation({
    mutationFn: () =>
      api("/api/factory/oligo/deliveries", {
        method: "POST",
        idempotent: true,
        json: {
          order_id: orderId,
          sequence_ids: picked,
          lines: Object.entries(qty).filter(([, v]) => Number(v) > 0).map(([order_line_id, v]) => ({ order_line_id, qty: Number(v) })),
          recipient: recipient || null,
          notes: notes || null,
        },
      }),
    onSuccess: () => {
      setPicked([]);
      setQty({});
      refresh();
    },
  });

  if (!canDeliver) return null;
  const d = opts.data;
  if (!d) return null;
  if (d.sequences.length === 0 && d.deliveries.length === 0) return null;

  const sel = d.sequences.filter((s) => picked.includes(s.id));
  const toggle = (id: string) => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(next);
    if (d.lines.length === 1) setQty({ [d.lines[0].id]: String(suggest(d.lines[0].kd_unit, d.sequences.filter((s) => next.includes(s.id)))) });
  };
  const toggleAll = () => {
    const allIds = d.sequences.map((s) => s.id);
    const next = picked.length === allIds.length ? [] : allIds;
    setPicked(next);
    if (d.lines.length === 1) setQty({ [d.lines[0].id]: String(suggest(d.lines[0].kd_unit, d.sequences.filter((s) => next.includes(s.id)))) });
  };

  return (
    <div className="flex flex-col gap-3 p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/40 dark:bg-emerald-950/20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-md bg-emerald-600 text-white font-bold text-[11px]">
            NHÃN &amp; GIAO HÀNG
          </span>
          <span className="text-xs text-slate-600 dark:text-slate-300">
            {d.internal_order
              ? `Đơn nội bộ ${d.internal_order.code} · PO Kinh doanh ${d.internal_order.kd_po_code} · ${d.internal_order.ship_mode === "DROP_SHIP" ? "giao thẳng khách (chứng từ qua Kinh doanh)" : "giao về Kinh doanh"}`
              : "Không gắn PO Kinh doanh: bàn giao nội bộ."}
          </span>
        </div>
        {d.sequences.length > 0 && (
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={toggleAll}>
              {picked.length === d.sequences.length ? "Bỏ chọn tất cả" : `Chọn tất cả (${d.sequences.length})`}
            </Button>
            {picked.length > 0 && (
              <Button variant="ghost" onClick={() => print.mutate(picked)} disabled={print.isPending}>
                In nhãn đã chọn ({picked.length})
              </Button>
            )}
          </div>
        )}
      </div>

      <ErrorNote error={opts.error ?? print.error} />

      {d.sequences.length > 0 && (
        <Table head={["", "Trình tự đạt QC chờ giao", "Số base", "Thang / tinh sạch", "Số ống", "Trạng thái nhãn", ""]}>
          {d.sequences.map((s) => (
            <tr key={s.id}>
              <td className="py-1.5 pr-3"><input type="checkbox" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} aria-label={`Chọn ${s.code}`} /></td>
              <td className="py-1.5 pr-3 font-mono text-xs">{s.code} <span className="font-sans text-slate-500">{s.name}</span></td>
              <td className="py-1.5 pr-3 text-right">{s.base_count}</td>
              <td className="py-1.5 pr-3 text-xs">{s.scale_code} · {PURIFICATION[s.purification as keyof typeof PURIFICATION]}</td>
              <td className="py-1.5 pr-3 text-right">{s.tube_count}</td>
              <td className="py-1.5 pr-3 text-xs">{s.labelled ? <span className="text-emerald-700 dark:text-emerald-400 font-semibold">Đã in nhãn</span> : <span className="text-amber-700 dark:text-amber-400 font-semibold">Chưa in nhãn</span>}</td>
              <td className="py-1.5 pr-3 text-right">
                {s.status !== "POOLED" && <Button variant="ghost" onClick={() => print.mutate([s.id])} disabled={print.isPending}>{s.labelled ? "In lại nhãn" : "In nhãn"}</Button>}
              </td>
            </tr>
          ))}
        </Table>
      )}

      {picked.length > 0 && (
        <form className="flex flex-col gap-3 p-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-white dark:bg-slate-900" onSubmit={(e) => { e.preventDefault(); deliver.mutate(); }}>
          <div className="text-xs font-bold">Lập phiếu giao {sel.length} trình tự ({sel.reduce((n, s) => n + s.tube_count, 0)} ống)</div>
          {d.internal_order ? (
            <Table head={["Dòng PO", "Mã hàng KD", "Đặt", "Đã giao", "Giao lần này"]}>
              {d.lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-1 pr-3">{l.line_no}</td>
                  <td className="py-1 pr-3 text-xs">{l.kd_item_code} {l.kd_item_name}</td>
                  <td className="py-1 pr-3 text-right text-xs">{fmtQty(l.qty)} {l.kd_unit}</td>
                  <td className="py-1 pr-3 text-right text-xs">{fmtQty(l.qty_delivered)}</td>
                  <td className="py-1 pr-3"><input className={`${inputClass} w-28`} inputMode="decimal" value={qty[l.id] ?? ""} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} /></td>
                </tr>
              ))}
            </Table>
          ) : (
            <Field label="Người / bộ phận nhận *"><input className={inputClass} value={recipient} onChange={(e) => setRecipient(e.target.value)} required /></Field>
          )}
          <Field label="Ghi chú"><input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <div><Button type="submit" disabled={deliver.isPending}>{deliver.isPending ? "Đang lưu…" : "Lập phiếu giao hàng"}</Button></div>
          <ErrorNote error={deliver.error} />
        </form>
      )}

      {d.deliveries.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-xs font-bold text-slate-700 dark:text-slate-300">Lịch sử phiếu giao của đơn ({d.deliveries.length})</div>
          <Table head={["Phiếu giao", "Ngày giao", "Số trình tự", "Người nhận / Trạng thái Kinh doanh"]}>
            {d.deliveries.map((x) => (
              <tr key={x.id}>
                <td className="py-1.5 pr-3 font-mono font-semibold">{x.code}</td>
                <td className="py-1.5 pr-3 text-xs">{fmtDate(x.created_at)}</td>
                <td className="py-1.5 pr-3 text-right">{x.sequences}</td>
                <td className="py-1.5 pr-3 text-xs">{x.recipient ?? ({ POSTED: "Đã gửi Kinh doanh", DELIVERED: "Đã giao khách", ACKNOWLEDGED: "Kinh doanh đã nhận" } as Record<string, string>)[x.shipment_status ?? ""] ?? x.shipment_status}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </div>
  );
}

/** Orders with QC-passed sequences waiting for labels and delivery. */
export function DeliveryView({ canManage }: { canManage: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["factory", "oligo-deliveries"], queryFn: () => api<QueueRow[]>("/api/factory/oligo/deliveries") });
  if (!canManage) return <Empty>Bạn chưa có quyền in nhãn / giao Oligo.</Empty>;
  return (
    <div className="flex flex-col gap-3">
      {selected && <DeliveryPanel key={selected} orderId={selected} onClose={() => setSelected(null)} />}
      <Card title="Chờ giao">
        <ErrorNote error={list.error} />
        {list.data?.length === 0 && <Empty>Chưa có đơn nào có trình tự đạt QC chờ giao.</Empty>}
        {list.data && list.data.length > 0 && (
          <Table head={["Đơn", "Khách / yêu cầu", "PO Kinh doanh", "Hạn giao", "Chờ giao", "Đã giao / tổng", "Trạng thái"]}>
            {list.data.map((o) => (
              <tr key={o.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setSelected(o.id)}>
                <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{o.code}</td>
                <td className="py-2 pr-3">{o.customer_label ?? "—"}</td>
                <td className="py-2 pr-3 font-mono">{o.kd_po_code ?? "—"}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(o.due_date)}</td>
                <td className="py-2 pr-3 text-right">{o.ready}</td>
                <td className="py-2 pr-3 text-right">{o.delivered}/{o.total}</td>
                <td className="py-2 pr-3"><StatusBadge status={ORDER_STATUS[o.status][0]} label={ORDER_STATUS[o.status][1]} /></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, fmtDate } from "../api";
import { Button, Card, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { printOrderCoa } from "../coa";
import { OrderDeliverySection } from "./DeliveryView";
import { LabelPreview } from "./LabelPreview";
import { FORMAT, ORDER_STATUS, PRODUCT, PURIFICATION, SEQ_STATUS, useScales } from "./shared";

interface Seq {
  id: string; code: string; name: string; normalized_sequence: string; base_count: number; molecule_type: string; product_type: string; scale_code: string;
  purification: string; format: string; mw: number; tm: number; nmol_per_od: number; ug_per_od: number; ext_coeff_260: number; gc_percent: number;
  raw_sequence: string; modifications: string[]; warnings: string[]; status: string;
  relation: string | null; pool_master_code: string | null; version: number;
}
interface OrderDetail {
  id: string; code: string; status: string; customer_label: string | null; due_date: string | null; kd_po_code: string | null; internal_order_code: string | null;
  sequences: Seq[];
}

/** Parameter table of an order as CSV (Excel opens it through the BOM), for the customer or the COA. */
function exportCsv(o: OrderDetail) {
  const head = ["Mã", "Tên", "Trình tự 5'-3'", "Số base", "Loại", "Thang", "Tinh sạch", "Dạng", "MW (Da)", "Tm (°C)", "GC %", "ε260 (L/mol·cm)", "nmol/OD", "µg/OD", "Modification"];
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = o.sequences
    .filter((s) => s.status !== "CANCELLED")
    .map((s) => [s.code, s.name, s.normalized_sequence, s.base_count, s.molecule_type, s.scale_code, s.purification, s.format, s.mw, s.tm, s.gc_percent, s.ext_coeff_260, s.nmol_per_od, s.ug_per_od, s.modifications.join(" ")].map(q).join(","));
  const blob = new Blob(["﻿" + [head.map(q).join(","), ...rows].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${o.code}-thong-so.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function AddSequences({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const scales = useScales();
  const [text, setText] = useState("");
  const [d, setD] = useState({ scale_code: "100NMOL", purification: "DESALT", format: "LYOPHILIZED" });
  const add = useMutation({
    mutationFn: () => api(`/api/factory/oligo/orders/${orderId}/sequences`, { method: "POST", idempotent: true, json: { text, defaults: d } }),
    onSuccess: () => {
      setText("");
      onDone();
    },
  });
  const lineErrors = add.error instanceof ApiError && Array.isArray(add.error.details) ? (add.error.details as { line: number; message: string }[]) : [];
  return (
    <div className="flex flex-col gap-2 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
      <div className="text-xs text-slate-500">
        Mỗi dòng: <code>Tên; Trình tự; Thang; Tinh sạch; Định dạng</code> (chỉ trình tự là bắt buộc, cột thiếu lấy mặc định). Có lỗi ở bất kỳ dòng nào thì không lưu dòng nào.
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Thang mặc định">
          <select className={inputClass} value={d.scale_code} onChange={(e) => setD({ ...d, scale_code: e.target.value })}>
            {scales.data?.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Tinh sạch mặc định">
          <select className={inputClass} value={d.purification} onChange={(e) => setD({ ...d, purification: e.target.value })}>
            {Object.entries(PURIFICATION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Định dạng mặc định">
          <select className={inputClass} value={d.format} onChange={(e) => setD({ ...d, format: e.target.value })}>
            {Object.entries(FORMAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>
      <textarea
        className="w-full min-h-28 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2 font-mono text-xs"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Primer F; ATGCTTTAGCAGGACAGTC\nProbe; /FAM/ATGCTTTAGCAGGAC/BHQ1/; 200NMOL; HPLC"}
        spellCheck={false}
      />
      {lineErrors.length > 0 ? (
        <ul className="text-xs text-rose-600 list-disc pl-4">{lineErrors.map((e) => <li key={e.line}>Dòng {e.line}: {e.message}</li>)}</ul>
      ) : (
        <ErrorNote error={add.error} />
      )}
      <div><Button onClick={() => add.mutate()} disabled={add.isPending || !text.trim()}>{add.isPending ? "Đang lưu…" : "Thêm trình tự"}</Button></div>
    </div>
  );
}

export function OligoOrderPanel({ id, canDeliver = false, onClose }: { id: string; canDeliver?: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const scales = useScales();
  const [showAddSeq, setShowAddSeq] = useState(false);
  const [labelsFor, setLabelsFor] = useState<string[] | null>(null);
  const order = useQuery({ queryKey: ["factory", "oligo-order", id], queryFn: () => api<OrderDetail>(`/api/factory/oligo/orders/${id}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["factory", "oligo-order", id] });
    qc.invalidateQueries({ queryKey: ["factory", "oligo-orders"] });
    qc.invalidateQueries({ queryKey: ["factory", "oligo-delivery", id] });
  };
  const act = useMutation({ mutationFn: (f: () => Promise<unknown>) => f(), onSuccess: refresh });
  const post = (url: string, json?: unknown) => act.mutate(() => api(url, { method: "POST", json }));
  const o = order.data;

  return (
    <Card
      title={o ? `Đơn Oligo ${o.code}` : "Đơn Oligo"}
      actions={
        <div className="flex items-center gap-2">
          {o && !["COMPLETED", "DELIVERED", "CANCELLED"].includes(o.status) && o.sequences.length > 0 && (
            <Button variant="ghost" onClick={() => setShowAddSeq((v) => !v)}>
              {showAddSeq ? "Đóng thêm trình tự" : "+ Thêm trình tự"}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>Đóng</Button>
        </div>
      }
    >
      <ErrorNote error={order.error ?? act.error} />
      {o && (
        <div className="flex flex-col gap-3 text-xs">
          <p>
            <StatusBadge status={ORDER_STATUS[o.status][0]} label={ORDER_STATUS[o.status][1]} /> · {o.customer_label ?? "—"} · Hạn giao {fmtDate(o.due_date)}
            {o.kd_po_code && ` · PO Kinh doanh ${o.kd_po_code} (${o.internal_order_code})`}
            {o.sequences.length > 0 && <Button variant="ghost" className="ml-2" onClick={() => exportCsv(o)}>Xuất bảng thông số (Excel)</Button>}
            {o.sequences.some((s) => s.status !== "CANCELLED" && s.status !== "SPLIT") && (
              <Button variant="ghost" className="ml-1" onClick={() => setLabelsFor(o.sequences.filter((s) => s.status !== "CANCELLED" && s.status !== "SPLIT").map((s) => s.id))}>Xem / in nhãn ống</Button>
            )}
            {o.sequences.some((s) => ["COMPLETED", "DELIVERED", "POOLED"].includes(s.status)) && (
              <Button variant="ghost" className="ml-1" onClick={() => printOrderCoa(o.id).catch((e) => window.alert(e.message))}>In COA đơn</Button>
            )}
          </p>
          {!["COMPLETED", "DELIVERED", "CANCELLED"].includes(o.status) && (o.sequences.length === 0 || showAddSeq) && (
            <AddSequences
              orderId={o.id}
              onDone={() => {
                setShowAddSeq(false);
                refresh();
              }}
            />
          )}
          <Table head={["Mã", "Tên", "Trình tự", "Dài", "Loại", "Thang / tinh sạch", "MW (Da)", "Tm (°C)", "GC %", "ε260", "nmol/OD", "µg/OD", "Trạng thái", ""]}>
            {o.sequences.map((s) => (
              <tr key={s.id} className={s.status === "CANCELLED" ? "opacity-50" : ""}>
                <td className="py-2 pr-3 font-mono">{s.code}</td>
                <td className="py-2 pr-3">{s.name}{s.relation === "SPLIT" && <span className="text-slate-400"> (ống tách)</span>}</td>
                <td className="py-2 pr-3 font-mono break-all max-w-80">
                  {s.normalized_sequence}
                  {s.raw_sequence !== s.normalized_sequence && <div className="font-sans text-[11px] text-slate-400">nhập: {s.raw_sequence}</div>}
                  {s.modifications.length > 0 && <div className="font-sans text-[11px] text-sky-700 dark:text-sky-400">Modification: {s.modifications.join(", ")}</div>}
                  {s.warnings.map((w, i) => <div key={i} className="font-sans text-[11px] text-amber-700 dark:text-amber-400">⚠ {w}</div>)}
                </td>
                <td className="py-2 pr-3 text-right">{s.base_count}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{s.molecule_type === "RNA" ? "RNA " : ""}{PRODUCT[s.product_type as keyof typeof PRODUCT]}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{scales.data?.find((x) => x.code === s.scale_code)?.label ?? s.scale_code} · {PURIFICATION[s.purification as keyof typeof PURIFICATION]} · {FORMAT[s.format as keyof typeof FORMAT]}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">{s.mw.toLocaleString("vi-VN")}</td>
                <td className="py-2 pr-3 text-right">{s.tm.toLocaleString("vi-VN")}</td>
                <td className="py-2 pr-3 text-right">{s.gc_percent.toLocaleString("vi-VN")}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">{s.ext_coeff_260.toLocaleString("vi-VN")}</td>
                <td className="py-2 pr-3 text-right">{s.nmol_per_od.toLocaleString("vi-VN")}</td>
                <td className="py-2 pr-3 text-right">{s.ug_per_od.toLocaleString("vi-VN")}</td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  <StatusBadge status={SEQ_STATUS[s.status][0]} label={SEQ_STATUS[s.status][1]} />
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {s.status !== "CANCELLED" && s.status !== "SPLIT" && <Button variant="ghost" onClick={() => setLabelsFor([s.id])}>Nhãn</Button>}
                  {s.status === "PENDING" && !s.relation && (
                    <Button variant="ghost" onClick={() => { const n = Number(window.prompt("Tách thành mấy ống?", "2")); const sc = n >= 2 && window.prompt(`Thang cho mỗi ống (${scales.data?.map((x) => x.code).join(", ")}):`, s.scale_code); if (n >= 2 && sc) post(`/api/factory/oligo/sequences/${s.id}/split`, { parts: Array.from({ length: n }, () => ({ scale_code: sc })) }); }}>
                      Tách
                    </Button>
                  )}
                  {s.status === "SPLIT" && <Button variant="ghost" onClick={() => post(`/api/factory/oligo/sequences/${s.id}/unsplit`)}>Hủy tách</Button>}
                  {s.status === "PENDING" && (
                    <Button variant="ghost" onClick={() => { const r = window.prompt("Lý do hủy trình tự:"); if (r) post(`/api/factory/oligo/sequences/${s.id}/cancel`, { reason: r }); }}>Hủy</Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>

          {/* Integrated Labels & Delivery Section inside Order Detail */}
          {labelsFor && <LabelPreview key={labelsFor.join(",")} sequenceIds={labelsFor} canPrint={canDeliver} onClose={() => setLabelsFor(null)} />}
          <OrderDeliverySection orderId={o.id} canDeliver={canDeliver} />

          {!["COMPLETED", "DELIVERED", "CANCELLED"].includes(o.status) && (
            <div><Button variant="ghost" onClick={() => { const r = window.prompt("Lý do hủy cả đơn:"); if (r) post(`/api/factory/oligo/orders/${o.id}/cancel`, { reason: r }); }}>Hủy đơn</Button></div>
          )}
        </div>
      )}
    </Card>
  );
}

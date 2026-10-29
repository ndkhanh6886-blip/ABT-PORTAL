"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtDate } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { OligoOrderPanel } from "./OligoOrderPanel";
import { ORDER_STATUS } from "./shared";

interface Option { id: string; code: string; name: string; internal_orders: { id: string; code: string; kd_po_code: string; committed_date: string | null }[] }

function NewOrder({ onCreated }: { onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const options = useQuery({ queryKey: ["factory", "oligo-intake-options"], queryFn: () => api<Option[]>("/api/factory/oligo/intake-options") });
  const [f, setF] = useState({ org_unit_id: "", internal_order_id: "", customer_label: "", due_date: "", notes: "" });
  const unit = options.data?.find((o) => o.id === f.org_unit_id) ?? (options.data?.length === 1 ? options.data[0] : undefined);
  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/api/factory/oligo/orders", {
        method: "POST",
        idempotent: true,
        json: { ...f, org_unit_id: unit?.id, internal_order_id: f.internal_order_id || null, due_date: f.due_date || null },
      }),
    onSuccess: (o) => {
      qc.invalidateQueries({ queryKey: ["factory", "oligo-orders"] });
      onCreated(o.id);
    },
  });
  if (options.data && !options.data.length) return <Empty>Bạn chưa có quyền lập đơn ở phòng Oligo nào (cần phòng có phân hệ Oligo trong Cơ cấu tổ chức).</Empty>;
  return (
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
      {(options.data?.length ?? 0) > 1 && (
        <Field label="Phòng Oligo">
          <select className={inputClass} value={f.org_unit_id} onChange={(e) => setF({ ...f, org_unit_id: e.target.value, internal_order_id: "" })} required>
            <option value="">Chọn</option>
            {options.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Đơn nội bộ từ Kinh doanh">
        <select className={inputClass} value={f.internal_order_id} onChange={(e) => setF({ ...f, internal_order_id: e.target.value })}>
          <option value="">— không gắn —</option>
          {unit?.internal_orders.map((o) => <option key={o.id} value={o.id}>{o.code} · PO {o.kd_po_code}</option>)}
        </select>
      </Field>
      <Field label="Khách / người yêu cầu"><input className={inputClass} value={f.customer_label} onChange={(e) => setF({ ...f, customer_label: e.target.value })} /></Field>
      <Field label="Hạn giao" hint="Để trống: lấy ngày cam kết của đơn nội bộ"><input className={inputClass} type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
      <Button type="submit" disabled={create.isPending}>+ Tạo đơn Oligo</Button>
      <div className="sm:col-span-2 lg:col-span-5"><ErrorNote error={create.error ?? options.error} /></div>
    </form>
  );
}

export function OligoOrdersView({ canManage }: { canManage: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const list = useQuery({
    queryKey: ["factory", "oligo-orders", status],
    queryFn: () => api<{ id: string; code: string; customer_label: string | null; due_date: string | null; due_date_change_count: number; status: string; kd_po_code: string | null; sequence_count: number }[]>(`/api/factory/oligo/orders${status ? `?status=${status}` : ""}`),
  });
  return (
    <div className="flex flex-col gap-3">
      {selected && <OligoOrderPanel key={selected} id={selected} onClose={() => setSelected(null)} />}
      <Card
        title="Đơn Oligo"
        actions={
          <select className={`${inputClass} w-44`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Trạng thái">
            <option value="">Mọi trạng thái</option>
            {Object.entries(ORDER_STATUS).map(([k, [, v]]) => <option key={k} value={k}>{v}</option>)}
          </select>
        }
      >
        {canManage && <NewOrder onCreated={setSelected} />}
        <ErrorNote error={list.error} />
        {list.data?.length === 0 && <Empty>Chưa có đơn Oligo.</Empty>}
        {list.data && list.data.length > 0 && (
          <Table head={["Mã", "Khách / yêu cầu", "PO Kinh doanh", "Số trình tự", "Hạn giao", "Trạng thái"]}>
            {list.data.map((o) => (
              <tr key={o.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setSelected(o.id)}>
                <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{o.code}</td>
                <td className="py-2 pr-3">{o.customer_label ?? "—"}</td>
                <td className="py-2 pr-3 font-mono">{o.kd_po_code ?? "—"}</td>
                <td className="py-2 pr-3 text-right">{o.sequence_count}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(o.due_date)}{o.due_date_change_count > 0 && ` (dời ${o.due_date_change_count})`}</td>
                <td className="py-2 pr-3"><StatusBadge status={ORDER_STATUS[o.status][0]} label={ORDER_STATUS[o.status][1]} /></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

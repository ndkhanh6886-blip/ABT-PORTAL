"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";

export const PR_STATUS: Record<string, [string, string]> = {
  DRAFT: ["PENDING_QC", "Nháp"],
  SUBMITTED: ["QUARANTINE", "Chờ trưởng phòng duyệt"],
  PENDING_BOD: ["QUARANTINE", "Chờ BGĐ duyệt"],
  APPROVED: ["RELEASED", "Đã duyệt"],
  ORDERED: ["RELEASED", "Đã đặt hàng"],
  REJECTED: ["REJECTED", "Từ chối"],
  CLOSED: ["EXPIRED", "Đã đóng"],
  CANCELLED: ["EXPIRED", "Đã hủy"],
};
const ACTION_LABEL: Record<string, string> = {
  submit: "Gửi duyệt",
  approve: "Duyệt",
  escalate: "Chuyển BGĐ duyệt",
  bod_approve: "BGĐ duyệt",
  reject: "Từ chối",
  return: "Trả lại để sửa",
  cancel: "Hủy đề nghị",
  close: "Đóng đề nghị",
};

interface Option { id: string; code: string; name: string; warehouses: { id: string; code: string; name: string }[] }
interface Line { item_id: string; label: string; qty: string; uom: string; est_price: string }

function ItemPicker({ onPick }: { onPick: (item: { id: string; code: string; name: string; base_uom: string }) => void }) {
  const [q, setQ] = useState("");
  const items = useQuery({
    queryKey: ["factory", "items", "picker", q],
    queryFn: () => api<{ rows: { id: string; code: string; name: string; base_uom: string }[] }>(`/api/factory/master/items?page_size=30&q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
  });
  return (
    <div className="relative">
      <input className={inputClass} placeholder="Gõ ≥ 2 ký tự để tìm vật tư và thêm dòng…" value={q} onChange={(e) => setQ(e.target.value)} />
      {items.data && q.trim().length >= 2 && (
        <ul className="absolute z-10 mt-1 w-full max-h-60 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg text-xs">
          {items.data.rows.length === 0 && <li className="px-3 py-2 text-slate-400">Không tìm thấy.</li>}
          {items.data.rows.map((i) => (
            <li key={i.id}>
              <button type="button" className="w-full text-left px-3 py-2 hover:bg-sky-50 dark:hover:bg-sky-950/40 cursor-pointer" onClick={() => { onPick(i); setQ(""); }}>
                <span className="font-mono font-semibold">{i.code}</span> — {i.name} ({i.base_uom})
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewRequestForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const options = useQuery({ queryKey: ["factory", "pr-options"], queryFn: () => api<Option[]>("/api/factory/purchase/request-options") });
  const uoms = useQuery({ queryKey: ["factory", "uoms"], queryFn: () => api<{ code: string }[]>("/api/factory/master/uoms") });
  const [head, setHead] = useState({ org_unit_id: "", target_warehouse_id: "", needed_by: "", reason: "" });
  const [lines, setLines] = useState<Line[]>([]);
  const unit = options.data?.find((o) => o.id === head.org_unit_id);
  const create = useMutation({
    mutationFn: () =>
      api("/api/factory/purchase/requests", {
        method: "POST",
        idempotent: true,
        json: {
          ...head,
          needed_by: head.needed_by || null,
          lines: lines.map((l) => ({ item_id: l.item_id, qty: Number(l.qty.replace(",", ".")), uom: l.uom, est_price: l.est_price ? Number(l.est_price) : null })),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "prs"] });
      onDone();
    },
  });
  const setL = (i: number, p: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));

  if (options.data && options.data.length === 0) {
    return <Card title="Đề nghị mua mới"><Empty>Bạn chưa được cấp quyền lập đề nghị mua cho phòng nào.</Empty><Button variant="ghost" onClick={onDone}>Đóng</Button></Card>;
  }
  return (
    <Card title="Đề nghị mua NVL mới">
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Phòng đề nghị *">
            <select className={inputClass} value={head.org_unit_id} onChange={(e) => setHead({ ...head, org_unit_id: e.target.value, target_warehouse_id: "" })} required>
              <option value="">Chọn phòng</option>
              {options.data?.map((o) => <option key={o.id} value={o.id}>{o.code} — {o.name}</option>)}
            </select>
          </Field>
          <Field label="Kho nhận *" hint="Chỉ các kho của phòng">
            <select className={inputClass} value={head.target_warehouse_id} onChange={(e) => setHead({ ...head, target_warehouse_id: e.target.value })} required>
              <option value="">Chọn kho</option>
              {unit?.warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </Field>
          <Field label="Cần trước ngày"><input className={inputClass} type="date" value={head.needed_by} onChange={(e) => setHead({ ...head, needed_by: e.target.value })} /></Field>
          <Field label="Mục đích / lý do *"><input className={inputClass} value={head.reason} onChange={(e) => setHead({ ...head, reason: e.target.value })} required /></Field>
        </div>
        <ItemPicker onPick={(i) => setLines([...lines, { item_id: i.id, label: `${i.code} — ${i.name}`, qty: "", uom: i.base_uom, est_price: "" }])} />
        {lines.length > 0 && (
          <Table head={["Vật tư", "Số lượng", "ĐVT", "Đơn giá ước tính (VND)", ""]}>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="py-2 pr-3">{l.label}</td>
                <td className="py-2 pr-3 w-32"><input className={inputClass} inputMode="decimal" value={l.qty} onChange={(e) => setL(i, { qty: e.target.value })} required /></td>
                <td className="py-2 pr-3 w-28">
                  <select className={inputClass} value={l.uom} onChange={(e) => setL(i, { uom: e.target.value })}>
                    {uoms.data?.map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}
                  </select>
                </td>
                <td className="py-2 pr-3 w-44"><input className={inputClass} inputMode="numeric" value={l.est_price} onChange={(e) => setL(i, { est_price: e.target.value.replace(/\D/g, "") })} /></td>
                <td className="py-2 pr-3"><button type="button" className="text-rose-600 text-xs cursor-pointer" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Xóa</button></td>
              </tr>
            ))}
          </Table>
        )}
        <ErrorNote error={create.error ?? options.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>Hủy</Button>
          <Button type="submit" disabled={create.isPending || !lines.length}>{create.isPending ? "Đang lưu…" : "Lưu nháp"}</Button>
        </div>
      </form>
    </Card>
  );
}

interface PrDetail {
  id: string; code: string; status: string; version: number; org_unit_name: string; warehouse_code: string; warehouse_name: string;
  requester_name: string; approver_name: string | null; needed_by: string | null; reason: string; est_total: string; requires_bod: boolean;
  lines: { id: string; line_no: number; item_code: string; item_name: string; qty: string; uom: string; est_price: string | null; qty_ordered: string }[];
  actions: AllowedAction[];
}

function RequestDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const pr = useQuery({ queryKey: ["factory", "pr", id], queryFn: () => api<PrDetail>(`/api/factory/purchase/requests/${id}`) });
  const p = pr.data;
  return (
    <Card title={p ? `Đề nghị ${p.code}` : "Đề nghị mua"} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <ErrorNote error={pr.error} />
      {p && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-slate-600 dark:text-slate-300">
            <StatusBadge status={PR_STATUS[p.status][0]} label={PR_STATUS[p.status][1]} /> · {p.org_unit_name} → kho {p.warehouse_code} · Người lập: {p.requester_name}
            {p.approver_name && <> · Duyệt: {p.approver_name}</>} · Cần trước: {fmtDate(p.needed_by)} · Ước tính: {fmtQty(p.est_total)} đ{p.requires_bod && " (vượt ngưỡng, cần BGĐ)"}
          </p>
          <p className="text-xs">Lý do: {p.reason}</p>
          <Table head={["#", "Vật tư", "Số lượng", "Đã đặt", "Đơn giá ước tính"]}>
            {p.lines.map((l) => (
              <tr key={l.id}>
                <td className="py-2 pr-3">{l.line_no}</td>
                <td className="py-2 pr-3">{l.item_code} — {l.item_name}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{fmtQty(l.qty)} {l.uom}</td>
                <td className="py-2 pr-3">{fmtQty(l.qty_ordered)}</td>
                <td className="py-2 pr-3">{l.est_price ? `${fmtQty(l.est_price)} đ` : "—"}</td>
              </tr>
            ))}
          </Table>
          <ActionBar endpoint={`/api/factory/purchase/requests/${p.id}/actions`} version={p.version} actions={p.actions} labels={ACTION_LABEL} onDone={() => { qc.invalidateQueries({ queryKey: ["factory", "pr", id] }); qc.invalidateQueries({ queryKey: ["factory", "prs"] }); }} />
        </div>
      )}
    </Card>
  );
}

export function RequestsView() {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const list = useQuery({
    queryKey: ["factory", "prs", status],
    queryFn: () => api<{ id: string; code: string; status: string; org_unit_name: string; warehouse_code: string; requester_name: string; needed_by: string | null; est_total: string; line_count: number; reason: string }[]>(`/api/factory/purchase/requests${status ? `?status=${status}` : ""}`),
  });
  const departments = Array.from(new Set((list.data ?? []).map((r) => r.org_unit_name).filter(Boolean)));
  const filteredRows = (list.data ?? []).filter((r) => !deptFilter || r.org_unit_name === deptFilter);

  return (
    <div className="flex flex-col gap-3">
      {creating && <NewRequestForm onDone={() => setCreating(false)} />}
      {selected && <RequestDetail key={selected} id={selected} onClose={() => setSelected(null)} />}
      <Card
        title="Đề nghị mua NVL tập trung (R&D · Sản xuất Kit · Oligo · Kỹ thuật Thiết bị · QA/QC)"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {departments.length > 1 && (
              <select className={`${inputClass} w-52`} value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} aria-label="Phòng ban">
                <option value="">Tất cả phòng ban ({list.data?.length ?? 0})</option>
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
            <select className={`${inputClass} w-48`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Trạng thái">
              <option value="">Mọi trạng thái</option>
              {Object.entries(PR_STATUS).map(([k, [, v]]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {!creating && <Button onClick={() => setCreating(true)}>+ Đề nghị mua</Button>}
          </div>
        }
      >
        <ErrorNote error={list.error} />
        {filteredRows.length === 0 && <Empty>Chưa có đề nghị mua phù hợp bộ lọc.</Empty>}
        {filteredRows.length > 0 && (
          <Table head={["Mã", "Phòng đề xuất", "Kho nhánh nhận", "Người lập", "Mục đích / Lý do", "Cần trước", "Ước tính", "Dòng", "Trạng thái"]}>
            {filteredRows.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setSelected(r.id)}>
                <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{r.code}</td>
                <td className="py-2 pr-3 font-semibold">{r.org_unit_name}</td>
                <td className="py-2 pr-3 font-mono">{r.warehouse_code}</td>
                <td className="py-2 pr-3">{r.requester_name}</td>
                <td className="py-2 pr-3 text-xs text-slate-600 dark:text-slate-300 max-w-64 truncate">{r.reason}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(r.needed_by)}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">{fmtQty(r.est_total)} đ</td>
                <td className="py-2 pr-3">{r.line_count}</td>
                <td className="py-2 pr-3"><StatusBadge status={PR_STATUS[r.status][0]} label={PR_STATUS[r.status][1]} /></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

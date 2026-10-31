"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, Table } from "../ui";

interface Col {
  id: string; code: string; name: string; status: string; retired_reason: string | null; price_vnd: number; design_runs: number; asset_code: string | null; asset_name: string | null;
  cost_per_run: number; runs_used: number; depreciated_vnd: number; last_run_at: string | null;
}
const vnd = (v: number) => `${Math.round(v).toLocaleString("vi-VN")} đ`;

function Runs({ id }: { id: string }) {
  const runs = useQuery({ queryKey: ["factory", "lc-column-runs", id], queryFn: () => api<{ sequence_code: string; step_name: string; cost_vnd: number; run_at: string; run_by_name: string | null }[]>(`/api/factory/assets/columns/${id}/runs`) });
  if (!runs.data?.length) return <p className="text-xs text-slate-400">Chưa có lượt chạy.</p>;
  return (
    <Table head={["Lúc", "Trình tự", "Bước", "Khấu hao", "Người"]}>
      {runs.data.map((r, i) => (
        <tr key={i}>
          <td className="py-1 pr-3 text-xs whitespace-nowrap">{new Date(r.run_at).toLocaleString("vi-VN")}</td>
          <td className="py-1 pr-3 font-mono text-xs">{r.sequence_code}</td>
          <td className="py-1 pr-3 text-xs">{r.step_name}</td>
          <td className="py-1 pr-3 text-right text-xs">{vnd(r.cost_vnd)}</td>
          <td className="py-1 pr-3 text-xs">{r.run_by_name ?? ""}</td>
        </tr>
      ))}
    </Table>
  );
}

/** "Khấu hao & sử dụng cột HPLC" (as OligoFlow): runs used against design life, cost per run, depreciation to date. */
export function ColumnsView({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["factory", "lc-columns"], queryFn: () => api<Col[]>("/api/factory/assets/columns") });
  const assets = useQuery({ queryKey: ["factory", "assets", "all"], queryFn: () => api<{ id: string; code: string; name: string; asset_type: string }[]>("/api/factory/assets") });
  const [f, setF] = useState({ code: "", name: "", asset_id: "", price_vnd: "", design_runs: "" });
  const [open, setOpen] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["factory", "lc-columns"] });
  const add = useMutation({
    mutationFn: () => api("/api/factory/assets/columns", { method: "POST", json: { ...f, asset_id: f.asset_id || null, price_vnd: Number(f.price_vnd), design_runs: Number(f.design_runs) } }),
    onSuccess: () => {
      setF({ code: "", name: "", asset_id: "", price_vnd: "", design_runs: "" });
      setShowAdd(false);
      refresh();
    },
  });
  const retire = useMutation({
    mutationFn: (id: string) => {
      const reason = window.prompt("Lý do thanh lý cột:");
      if (!reason) throw new Error("Cần lý do.");
      return api(`/api/factory/assets/columns/${id}/retire`, { method: "POST", json: { reason } });
    },
    onSuccess: refresh,
  });
  return (
    <Card
      title="Cột sắc ký: khấu hao & sử dụng"
      actions={
        canManage ? (
          <Button onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? "Đóng form" : "+ Thêm cột sắc ký"}
          </Button>
        ) : null
      }
    >
      {canManage && showAdd && (
        <form className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 items-end mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <Field label="Mã / serial *"><input className={inputClass} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required /></Field>
          <Field label="Tên cột *"><input className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
          <Field label="Lắp trên máy">
            <select className={inputClass} value={f.asset_id} onChange={(e) => setF({ ...f, asset_id: e.target.value })}>
              <option value="">—</option>
              {assets.data?.filter((a) => a.asset_type !== "SYNTHESIZER").map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </Field>
          <Field label="Giá mua (VNĐ) *"><input className={inputClass} inputMode="numeric" value={f.price_vnd} onChange={(e) => setF({ ...f, price_vnd: e.target.value.replace(/\D/g, "") })} required /></Field>
          <Field label="Số lượt chạy thiết kế *"><input className={inputClass} type="number" min="1" value={f.design_runs} onChange={(e) => setF({ ...f, design_runs: e.target.value })} required /></Field>
          <Button type="submit" disabled={add.isPending}>+ Thêm cột</Button>
          <div className="sm:col-span-3 lg:col-span-6"><ErrorNote error={add.error} /></div>
        </form>
      )}
      <p className="text-[11px] text-slate-500 mb-2">Bước SOP có thông số loại “Cột sắc ký (khấu hao)”: mỗi trình tự chạy trên cột tính một lượt, khấu hao = giá mua / số lượt thiết kế.</p>
      <ErrorNote error={list.error ?? retire.error} />
      {list.data?.length === 0 && <Empty>Chưa có cột.</Empty>}
      {list.data && list.data.length > 0 && (
        <Table head={["Mã / tên", "Máy", "Giá mua", "Lượt (đã dùng / thiết kế)", "Khấu hao / lượt", "Khấu hao lũy kế", ""]}>
          {list.data.map((c) => (
            <React.Fragment key={c.id}>
              <tr className={c.status === "ACTIVE" ? "" : "opacity-50"}>
                <td className="py-1.5 pr-3 text-xs"><span className="font-mono">{c.code}</span> {c.name}{c.retired_reason && <div className="text-rose-600">Thanh lý: {c.retired_reason}</div>}</td>
                <td className="py-1.5 pr-3 text-xs">{c.asset_code ?? "—"}</td>
                <td className="py-1.5 pr-3 text-right text-xs">{vnd(c.price_vnd)}</td>
                <td className="py-1.5 pr-3 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-24 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden"><div className={`h-full ${c.runs_used >= c.design_runs ? "bg-rose-500" : c.runs_used >= c.design_runs * 0.8 ? "bg-amber-400" : "bg-sky-500"}`} style={{ width: `${Math.min(100, (c.runs_used / c.design_runs) * 100)}%` }} /></div>
                    {c.runs_used} / {c.design_runs}
                  </div>
                </td>
                <td className="py-1.5 pr-3 text-right text-xs">{vnd(c.cost_per_run)}</td>
                <td className="py-1.5 pr-3 text-right text-xs">{vnd(c.depreciated_vnd)}</td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                  <Button variant="ghost" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? "Đóng" : "Lịch sử"}</Button>
                  {canManage && c.status === "ACTIVE" && <Button variant="ghost" onClick={() => retire.mutate(c.id)}>Thanh lý</Button>}
                </td>
              </tr>
              {open === c.id && <tr><td colSpan={7} className="pb-3"><Runs id={c.id} /></td></tr>}
            </React.Fragment>
          ))}
        </Table>
      )}
    </Card>
  );
}

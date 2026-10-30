"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtQty } from "../api";
import { ActionBar, type AllowedAction } from "../actions";
import { Button, Card, ErrorNote, inputClass, StatusBadge, Table } from "../ui";
import { BatchVisual, type BatchLot } from "./BatchVisual";
import { BATCH_STATUS, SEQ_STATUS } from "./shared";

interface Batch {
  id: string;
  code: string;
  status: string;
  version: number;
  synthesizer_id: string;
  program_name: string | null;
  synthesizer_code: string;
  synthesizer_name: string;
  started_at: string | null;
  finished_at: string | null;
  positions: { position_no: number; couplings: number; coupling_efficiency_pct: number | null; result: string | null; sequence_code: string; name: string; normalized_sequence: string; scale_code: string; sequence_status: string; column_lot_code: string }[];
  reagents: { item_id: string; role: string; est_qty_base: number; actual_qty_base: number | null; item_code: string; item_name: string; base_uom: string }[];
  column_positions: number | null;
  lots: BatchLot[];
  actions: AllowedAction[];
}

const LABELS = { start: "Bắt đầu chạy", cancel: "Hủy mẻ", abort: "Dừng mẻ (sự cố)" };
const fmtTime = (v: string | null) => (v ? new Date(v).toLocaleString("vi-VN") : "—");

/** Results of a running batch: coupling efficiency and pass/fail per position, actual quantity per reagent. */
function FinishForm({ batch, onDone }: { batch: Batch; onDone: () => void }) {
  const [pos, setPos] = useState(() => batch.positions.map((p) => ({ position_no: p.position_no, eff: "", ok: true })));
  const [rea, setRea] = useState(() => batch.reagents.map((r) => ({ item_id: r.item_id, qty: String(r.est_qty_base) })));
  const finish = useMutation({
    mutationFn: () =>
      api(`/api/factory/oligo/batches/${batch.id}/actions`, {
        method: "POST",
        json: {
          action: "finish",
          expectedVersion: batch.version,
          payload: {
            positions: pos.map((p) => ({ position_no: p.position_no, coupling_efficiency_pct: Number(p.eff), ok: p.ok })),
            reagents: rea.map((r) => ({ item_id: r.item_id, actual_qty_base: Number(r.qty) })),
          },
        },
      }),
    onSuccess: onDone,
  });
  return (
    <form className="flex flex-col gap-3 p-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/30" onSubmit={(e) => { e.preventDefault(); finish.mutate(); }}>
      <div className="text-xs font-bold">Kết thúc mẻ — nhập kết quả</div>
      <Table head={["Vị trí", "Trình tự", "Hiệu suất ghép TB (%)", "Đạt"]}>
        {pos.map((p, i) => (
          <tr key={p.position_no}>
            <td className="py-1 pr-3">{p.position_no}</td>
            <td className="py-1 pr-3 font-mono text-xs">{batch.positions[i].sequence_code}</td>
            <td className="py-1 pr-3"><input className={`${inputClass} w-28`} type="number" step="0.01" min="0" max="100" required value={p.eff} onChange={(e) => setPos(pos.map((x, j) => (j === i ? { ...x, eff: e.target.value } : x)))} /></td>
            <td className="py-1 pr-3"><input type="checkbox" checked={p.ok} onChange={(e) => setPos(pos.map((x, j) => (j === i ? { ...x, ok: e.target.checked } : x)))} /></td>
          </tr>
        ))}
      </Table>
      <Table head={["Hóa chất", "Dự kiến", "Thực tế"]}>
        {rea.map((r, i) => (
          <tr key={r.item_id}>
            <td className="py-1 pr-3 text-xs">{batch.reagents[i].item_code} · {batch.reagents[i].item_name}</td>
            <td className="py-1 pr-3 text-right text-xs">{fmtQty(batch.reagents[i].est_qty_base)} {batch.reagents[i].base_uom}</td>
            <td className="py-1 pr-3"><input className={`${inputClass} w-28`} type="number" step="any" min="0" required value={r.qty} onChange={(e) => setRea(rea.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></td>
          </tr>
        ))}
      </Table>
      <p className="text-[11px] text-slate-500">Dùng nhiều hơn dự kiến: xuất thêm theo FEFO. Dùng ít hơn: phần thừa nhập lại đúng lô đã xuất. Vị trí không đạt chuyển trình tự sang Lỗi và mở NCR.</p>
      <div><Button type="submit" disabled={finish.isPending}>{finish.isPending ? "Đang lưu…" : "Kết thúc mẻ"}</Button></div>
      <ErrorNote error={finish.error} />
    </form>
  );
}

/** Bottle change during the run: from the given cycle on, the new bottle feeds the port. */
function SwapBottle({ batch, onDone }: { batch: Batch; onDone: () => void }) {
  const ports = useQuery({
    queryKey: ["factory", "oligo-ports", batch.synthesizer_id],
    queryFn: () => api<{ ports: { port_no: number; role: string; lot_code: string | null; lots: { lot_id: string; code: string; available: number }[] }[] }>(`/api/factory/oligo/synthesizers/${batch.synthesizer_id}/ports`),
  });
  const [f, setF] = useState({ port_no: "", lot_id: "", cycle: "" });
  const port = ports.data?.ports.find((p) => String(p.port_no) === f.port_no);
  const maxCycle = Math.max(0, ...batch.positions.map((p) => p.couplings));
  const swap = useMutation({
    mutationFn: () => api(`/api/factory/oligo/batches/${batch.id}/swap-bottle`, { method: "POST", idempotent: true, json: { port_no: Number(f.port_no), lot_id: f.lot_id, cycle: Number(f.cycle) } }),
    onSuccess: () => {
      setF({ port_no: "", lot_id: "", cycle: "" });
      onDone();
    },
  });
  if (!ports.data?.ports.length) return null;
  return (
    <form className="flex flex-wrap gap-2 items-end p-3 rounded-xl border border-slate-200 dark:border-slate-800" onSubmit={(e) => { e.preventDefault(); swap.mutate(); }}>
      <span className="text-xs font-bold w-full">Thay chai trong mẻ</span>
      <select className={`${inputClass} w-56`} value={f.port_no} onChange={(e) => setF({ ...f, port_no: e.target.value, lot_id: "" })} aria-label="Cổng" required>
        <option value="">Chọn cổng</option>
        {ports.data.ports.map((p) => <option key={p.port_no} value={p.port_no}>{p.port_no} · {p.role} (đang: {p.lot_code ?? "trống"})</option>)}
      </select>
      <select className={`${inputClass} w-56`} value={f.lot_id} onChange={(e) => setF({ ...f, lot_id: e.target.value })} aria-label="Chai mới" required>
        <option value="">Chai mới</option>
        {port?.lots.filter((l) => l.code !== port.lot_code).map((l) => <option key={l.lot_id} value={l.lot_id}>{l.code} (còn {fmtQty(l.available)})</option>)}
      </select>
      <input className={`${inputClass} w-36`} type="number" min="2" max={maxCycle} placeholder={`Từ chu kỳ (2–${maxCycle})`} value={f.cycle} onChange={(e) => setF({ ...f, cycle: e.target.value })} required />
      <Button type="submit" variant="ghost" disabled={swap.isPending}>Ghi thay chai</Button>
      <div className="w-full"><ErrorNote error={swap.error} /></div>
    </form>
  );
}

const local = (v: string | null) => {
  if (!v) return "";
  const d = new Date(v);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

/** Correction of the recorded run times, with a reason (audited). */
function EditTimes({ batch, onDone }: { batch: Batch; onDone: () => void }) {
  const [f, setF] = useState({ started_at: local(batch.started_at), finished_at: local(batch.finished_at), reason: "" });
  const save = useMutation({
    mutationFn: () =>
      api(`/api/factory/oligo/batches/${batch.id}/times`, {
        method: "PUT",
        json: {
          version: batch.version,
          started_at: f.started_at ? new Date(f.started_at).toISOString() : null,
          finished_at: batch.status === "RUNNING" ? undefined : f.finished_at ? new Date(f.finished_at).toISOString() : null,
          reason: f.reason,
        },
      }),
    onSuccess: onDone,
  });
  return (
    <form className="flex flex-wrap gap-2 items-end p-3 rounded-xl border border-slate-200 dark:border-slate-800" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <label className="text-xs">Bắt đầu<input className={`${inputClass} w-48`} type="datetime-local" value={f.started_at} onChange={(e) => setF({ ...f, started_at: e.target.value })} required /></label>
      {batch.status !== "RUNNING" && (
        <label className="text-xs">Kết thúc<input className={`${inputClass} w-48`} type="datetime-local" value={f.finished_at} onChange={(e) => setF({ ...f, finished_at: e.target.value })} required /></label>
      )}
      <label className="text-xs">Lý do *<input className={`${inputClass} w-64`} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required /></label>
      <Button type="submit" variant="ghost" disabled={save.isPending}>Lưu giờ</Button>
      <div className="w-full"><ErrorNote error={save.error} /></div>
    </form>
  );
}

export function BatchPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const b = useQuery({ queryKey: ["factory", "oligo-batch", id], queryFn: () => api<Batch>(`/api/factory/oligo/batches/${id}`) });
  const [finishing, setFinishing] = useState(false);
  const [editTimes, setEditTimes] = useState(false);
  const refresh = () => {
    setFinishing(false);
    setEditTimes(false);
    for (const k of ["oligo-batch", "oligo-batches", "oligo-batch-candidates", "oligo-orders", "oligo-order", "oligo-ports"]) qc.invalidateQueries({ queryKey: ["factory", k] });
  };
  const d = b.data;
  const canFinish = d?.actions.some((a) => a.action === "finish");
  return (
    <Card
      title={d ? <span>Mẻ <span className="font-mono">{d.code}</span> · {d.synthesizer_code} {d.synthesizer_name}</span> : "Mẻ tổng hợp"}
      actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}
    >
      <ErrorNote error={b.error} />
      {d && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-4 text-xs text-slate-600 dark:text-slate-300">
            <StatusBadge status={BATCH_STATUS[d.status][0]} label={BATCH_STATUS[d.status][1]} />
            <span>Chương trình: {d.program_name ?? "—"}</span>
            <span>Bắt đầu: {fmtTime(d.started_at)}</span>
            <span>Kết thúc: {fmtTime(d.finished_at)}</span>
            {d.started_at && <button type="button" className="text-sky-700 dark:text-sky-400 underline cursor-pointer" onClick={() => setEditTimes(!editTimes)}>Sửa giờ</button>}
          </div>
          {editTimes && <EditTimes batch={d} onDone={refresh} />}
          <div className="flex flex-wrap gap-2 items-start">
            <ActionBar endpoint={`/api/factory/oligo/batches/${d.id}/actions`} version={d.version} actions={d.actions.filter((a) => a.action !== "finish")} labels={LABELS} onDone={refresh} />
            {canFinish && !finishing && <Button onClick={() => setFinishing(true)}>Kết thúc mẻ…</Button>}
          </div>
          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800">
            <BatchVisual positions={d.positions} columnCount={d.column_positions} lots={d.lots} />
          </div>
          {finishing && <FinishForm batch={d} onDone={refresh} />}
          {d.status === "RUNNING" && canFinish && <SwapBottle batch={d} onDone={refresh} />}
          <Table head={["Vị trí", "Trình tự", "Thang", "Lô cột", "Số lần ghép", "Hiệu suất", "Kết quả", "Trạng thái trình tự"]}>
            {d.positions.map((p) => (
              <tr key={p.position_no}>
                <td className="py-1.5 pr-3">{p.position_no}</td>
                <td className="py-1.5 pr-3 font-mono text-xs" title={p.normalized_sequence}>{p.sequence_code} <span className="font-sans text-slate-500">{p.name}</span></td>
                <td className="py-1.5 pr-3 text-xs">{p.scale_code}</td>
                <td className="py-1.5 pr-3 font-mono text-xs">{p.column_lot_code}</td>
                <td className="py-1.5 pr-3 text-right">{p.couplings}</td>
                <td className="py-1.5 pr-3 text-right">{p.coupling_efficiency_pct == null ? "—" : `${p.coupling_efficiency_pct}%`}</td>
                <td className="py-1.5 pr-3 text-xs">{p.result === "OK" ? "Đạt" : p.result === "FAILED" ? "Không đạt" : "—"}</td>
                <td className="py-1.5 pr-3"><StatusBadge status={SEQ_STATUS[p.sequence_status][0]} label={SEQ_STATUS[p.sequence_status][1]} /></td>
              </tr>
            ))}
          </Table>
          <Table head={["Hóa chất", "Vai trò", "Dự kiến", "Thực tế"]}>
            {d.reagents.map((r) => (
              <tr key={r.item_id}>
                <td className="py-1.5 pr-3 text-xs">{r.item_code} · {r.item_name}</td>
                <td className="py-1.5 pr-3 text-xs">{r.role}</td>
                <td className="py-1.5 pr-3 text-right text-xs">{fmtQty(r.est_qty_base)} {r.base_uom}</td>
                <td className="py-1.5 pr-3 text-right text-xs">{r.actual_qty_base == null ? "—" : `${fmtQty(r.actual_qty_base)} ${r.base_uom}`}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </Card>
  );
}

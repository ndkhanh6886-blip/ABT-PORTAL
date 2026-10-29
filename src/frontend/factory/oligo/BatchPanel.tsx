"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtQty } from "../api";
import { ActionBar, type AllowedAction } from "../actions";
import { Button, Card, ErrorNote, inputClass, StatusBadge, Table } from "../ui";
import { BATCH_STATUS, SEQ_STATUS } from "./shared";

interface Batch {
  id: string;
  code: string;
  status: string;
  version: number;
  program_name: string | null;
  synthesizer_code: string;
  synthesizer_name: string;
  started_at: string | null;
  finished_at: string | null;
  positions: { position_no: number; couplings: number; coupling_efficiency_pct: number | null; result: string | null; sequence_code: string; name: string; normalized_sequence: string; scale_code: string; sequence_status: string; column_lot_code: string }[];
  reagents: { item_id: string; role: string; est_qty_base: number; actual_qty_base: number | null; item_code: string; item_name: string; base_uom: string }[];
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

export function BatchPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const b = useQuery({ queryKey: ["factory", "oligo-batch", id], queryFn: () => api<Batch>(`/api/factory/oligo/batches/${id}`) });
  const [finishing, setFinishing] = useState(false);
  const refresh = () => {
    setFinishing(false);
    for (const k of ["oligo-batch", "oligo-batches", "oligo-batch-candidates", "oligo-orders", "oligo-order"]) qc.invalidateQueries({ queryKey: ["factory", k] });
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
          </div>
          <div className="flex flex-wrap gap-2 items-start">
            <ActionBar endpoint={`/api/factory/oligo/batches/${d.id}/actions`} version={d.version} actions={d.actions.filter((a) => a.action !== "finish")} labels={LABELS} onDone={refresh} />
            {canFinish && !finishing && <Button onClick={() => setFinishing(true)}>Kết thúc mẻ…</Button>}
          </div>
          {finishing && <FinishForm batch={d} onDone={refresh} />}
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

"use client";

import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Empty, ErrorNote, Field, inputClass, Table } from "../ui";
import { PURIFICATION, useOligoUnits } from "./shared";

interface Candidates {
  sequences: { id: string; code: string; name: string; normalized_sequence: string; base_count: number; scale_code: string; purification: string; order_code: string | null; due_date: string | null }[];
  synthesizers: { id: string; code: string; name: string; status: string; next_calibration_due: string | null; column_positions: number; supported_scales: string[] }[];
  column_lots: { id: string; code: string; expiry_date: string | null; item_code: string; item_name: string; available: number }[];
}

/**
 * Plans a batch: pick a synthesizer, tick pending sequences (positions follow the tick order) and a CPG column lot.
 * The server re-checks everything (scale, positions, calibration, stock) and reserves reagents on save.
 */
export function BatchPlanForm({ onCreated }: { onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const units = useOligoUnits("oligo.batch.manage");
  const [unitId, setUnitId] = useState("");
  const unit = unitId || (units.data?.length === 1 ? units.data[0].id : "");
  const cand = useQuery({
    queryKey: ["factory", "oligo-batch-candidates", unit],
    enabled: !!unit,
    queryFn: () => api<Candidates>(`/api/factory/oligo/batch-candidates?org_unit_id=${unit}`),
  });
  const [synthId, setSynthId] = useState("");
  const [lotId, setLotId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [program, setProgram] = useState("");
  const synth = cand.data?.synthesizers.find((s) => s.id === synthId);
  const fits = (scale: string) => !synth || !synth.supported_scales.length || synth.supported_scales.includes(scale);
  const full = !!synth && picked.length >= synth.column_positions;
  const visible = useMemo(() => cand.data?.sequences ?? [], [cand.data]);

  const plan = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/api/factory/oligo/batches", {
        method: "POST",
        idempotent: true,
        json: { org_unit_id: unit, synthesizer_id: synthId, program_name: program || null, positions: picked.map((id) => ({ sequence_id: id, column_lot_id: lotId })) },
      }),
    onSuccess: (b) => {
      setPicked([]);
      qc.invalidateQueries({ queryKey: ["factory", "oligo-batches"] });
      qc.invalidateQueries({ queryKey: ["factory", "oligo-batch-candidates"] });
      qc.invalidateQueries({ queryKey: ["factory", "oligo-orders"] });
      onCreated(b.id);
    },
  });
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : full ? p : [...p, id]));

  if (units.data && !units.data.length) return <Empty>Bạn chưa có quyền lập mẻ tổng hợp ở phòng Oligo nào.</Empty>;
  return (
    <div className="flex flex-col gap-3 mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
        {(units.data?.length ?? 0) > 1 && (
          <Field label="Phòng Oligo">
            <select className={inputClass} value={unitId} onChange={(e) => { setUnitId(e.target.value); setSynthId(""); setLotId(""); setPicked([]); }}>
              <option value="">Chọn</option>
              {units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Máy tổng hợp">
          <select className={inputClass} value={synthId} onChange={(e) => { setSynthId(e.target.value); setPicked([]); }}>
            <option value="">Chọn</option>
            {cand.data?.synthesizers.map((s) => (
              <option key={s.id} value={s.id} disabled={s.status !== "IN_SERVICE"}>
                {s.code} · {s.name} ({s.column_positions} cột{s.next_calibration_due ? `, HC ${fmtDate(s.next_calibration_due)}` : ""})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Lô cột CPG" hint="Mỗi vị trí giữ chỗ 1 cột">
          <select className={inputClass} value={lotId} onChange={(e) => setLotId(e.target.value)}>
            <option value="">Chọn</option>
            {cand.data?.column_lots.map((l) => <option key={l.id} value={l.id}>{l.item_code} · {l.code} (còn {fmtQty(l.available)}{l.expiry_date ? `, HD ${fmtDate(l.expiry_date)}` : ""})</option>)}
          </select>
        </Field>
        <Field label="Chương trình máy"><input className={inputClass} value={program} onChange={(e) => setProgram(e.target.value)} placeholder="tùy chọn" /></Field>
      </div>
      {cand.data && cand.data.synthesizers.length === 0 && <Empty>Phòng chưa khai báo máy tổng hợp (tab Thiết bị & định mức).</Empty>}
      {cand.data && visible.length === 0 && <Empty>Không có trình tự nào đang chờ tổng hợp.</Empty>}
      {visible.length > 0 && (
        <Table head={["Vị trí", "Trình tự", "Đơn", "Hạn giao", "Thang", "Tinh sạch", "Số base", "Chuỗi"]}>
          {visible.map((s) => {
            const pos = picked.indexOf(s.id);
            const ok = fits(s.scale_code);
            return (
              <tr key={s.id} className={ok ? "cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/50" : "opacity-40"} onClick={() => ok && toggle(s.id)}>
                <td className="py-1.5 pr-3"><input type="checkbox" readOnly checked={pos >= 0} disabled={!ok || (full && pos < 0)} /> {pos >= 0 && <b>{pos + 1}</b>}</td>
                <td className="py-1.5 pr-3 font-mono text-xs">{s.code} <span className="font-sans text-slate-500">{s.name}</span></td>
                <td className="py-1.5 pr-3 font-mono text-xs">{s.order_code ?? "gộp"}</td>
                <td className="py-1.5 pr-3 text-xs whitespace-nowrap">{fmtDate(s.due_date)}</td>
                <td className="py-1.5 pr-3 text-xs">{s.scale_code}</td>
                <td className="py-1.5 pr-3 text-xs">{PURIFICATION[s.purification as keyof typeof PURIFICATION]}</td>
                <td className="py-1.5 pr-3 text-right">{s.base_count}</td>
                <td className="py-1.5 pr-3 font-mono text-[11px] break-all max-w-80">{s.normalized_sequence}</td>
              </tr>
            );
          })}
        </Table>
      )}
      <div className="flex items-center gap-3">
        <Button disabled={!synthId || !lotId || !picked.length || plan.isPending} onClick={() => plan.mutate()}>
          + Lập mẻ ({picked.length}{synth ? `/${synth.column_positions}` : ""} vị trí)
        </Button>
        <span className="text-[11px] text-slate-500">Lưu mẻ sẽ giữ chỗ hóa chất theo định mức và chuyển trình tự sang “Đã xếp mẻ”.</span>
      </div>
      <ErrorNote error={plan.error ?? cand.error ?? units.error} />
    </div>
  );
}

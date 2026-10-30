"use client";

import React, { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, fmtQty } from "../api";
import { Button, ErrorNote, inputClass, Table } from "../ui";

interface View {
  master: { id: string; code: string; status: string };
  record: { od_total: number | null; nmol: number | null; ug: number | null; volume_ul: number | null; format: string } | null;
  members: { id: string; code: string; name: string; scale_code: string; status: string; order_code: string | null; customer_label: string | null; agreed_pct: number; ratio_pct: number | null; od: number | null; nmol: number | null; volume_ul: number | null; tube_count: number | null }[];
}

/** "Tách chia ống sau đo nồng độ" (as OligoFlow): share the pool master's measurement between the customer tubes. */
export function PoolAliquotForm({ masterId, canEdit, onDone }: { masterId: string; canEdit: boolean; onDone: () => void }) {
  const v = useQuery({ queryKey: ["factory", "oligo-aliquots", masterId], queryFn: () => api<View>(`/api/factory/oligo/sequences/${masterId}/aliquots`) });
  const [rows, setRows] = useState<Record<string, { ratio: string; tubes: string }>>({});
  useEffect(() => {
    if (v.data) setRows(Object.fromEntries(v.data.members.map((m) => [m.id, { ratio: String(m.ratio_pct ?? m.agreed_pct), tubes: String(m.tube_count ?? 1) }])));
  }, [v.data]);
  const save = useMutation({
    mutationFn: () =>
      api(`/api/factory/oligo/sequences/${masterId}/aliquots`, {
        method: "PUT",
        json: { members: Object.entries(rows).map(([sequence_id, r]) => ({ sequence_id, ratio_pct: Number(r.ratio.replace(",", ".")), tube_count: Number(r.tubes) })) },
      }),
    onSuccess: () => {
      v.refetch();
      onDone();
    },
  });
  const d = v.data;
  if (!d) return <ErrorNote error={v.error} />;
  const total = Object.values(rows).reduce((n, r) => n + (Number(r.ratio.replace(",", ".")) || 0), 0);
  const od = d.record?.od_total ?? 0;
  return (
    <div className="flex flex-col gap-2 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
      <div className="text-xs font-bold">Chia ống cho các đơn trong mẻ gộp — tổng {fmtQty(od)} OD · {fmtQty(d.record?.nmol)} nmol</div>
      <Table head={["Ống khách hàng", "Đơn / khách", "Thang đặt", "Tỷ lệ (%)", "Số ống", "OD phân bổ", "nmol phân bổ", "Đã lưu"]}>
        {d.members.map((m) => {
          const r = rows[m.id] ?? { ratio: "", tubes: "1" };
          const f = (Number(r.ratio.replace(",", ".")) || 0) / 100;
          return (
            <tr key={m.id}>
              <td className="py-1 pr-3 text-xs"><span className="font-mono">{m.code}</span> {m.name}</td>
              <td className="py-1 pr-3 text-xs">{m.order_code ?? ""}{m.customer_label ? ` · ${m.customer_label}` : ""}</td>
              <td className="py-1 pr-3 text-xs">{m.scale_code}</td>
              <td className="py-1 pr-3"><input className={`${inputClass} w-20`} inputMode="decimal" disabled={!canEdit} value={r.ratio} onChange={(e) => setRows({ ...rows, [m.id]: { ...r, ratio: e.target.value } })} /></td>
              <td className="py-1 pr-3"><input className={`${inputClass} w-16`} type="number" min="1" max="100" disabled={!canEdit} value={r.tubes} onChange={(e) => setRows({ ...rows, [m.id]: { ...r, tubes: e.target.value } })} /></td>
              <td className="py-1 pr-3 text-right text-xs">{fmtQty(Math.round(od * f * 1000) / 1000)}</td>
              <td className="py-1 pr-3 text-right text-xs">{fmtQty(Math.round((d.record?.nmol ?? 0) * f * 1000) / 1000)}</td>
              <td className="py-1 pr-3 text-xs">{m.ratio_pct != null ? `${m.ratio_pct} % · ${fmtQty(m.od)} OD` : "—"}</td>
            </tr>
          );
        })}
      </Table>
      <div className="flex gap-2 items-center text-xs">
        <span className={Math.abs(total - 100) > 0.01 ? "text-rose-600 font-bold" : "text-slate-500"}>Tổng {Math.round(total * 100) / 100} %</span>
        {canEdit && <Button variant="ghost" onClick={() => setRows(Object.fromEntries(d.members.map((m) => [m.id, { ...(rows[m.id] ?? { tubes: "1" }), ratio: String(m.agreed_pct) }])))}>Theo tỷ lệ đã gộp</Button>}
        {canEdit && <Button onClick={() => save.mutate()} disabled={save.isPending || !od}>Lưu chia ống</Button>}
      </div>
      <ErrorNote error={save.error} />
    </div>
  );
}

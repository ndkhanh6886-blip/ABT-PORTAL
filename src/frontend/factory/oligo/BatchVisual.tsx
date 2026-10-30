"use client";

import React from "react";
import { fmtDate, fmtQty } from "../api";

export interface BatchLot {
  item_id: string; lot_id: string | null; used: number; held: number; item_code: string; item_name: string; base_uom: string; item_type: string;
  lot_code: string | null; expiry_date: string | null; on_hand: number; port_no: number | null; port_role: string | null;
}
interface Position { position_no: number; sequence_code: string; name: string; couplings: number; result: string | null; sequence_status: string }

const tone = (p?: Position) =>
  !p
    ? "border-dashed border-slate-300 dark:border-slate-700 text-slate-300 dark:text-slate-600"
    : p.result === "FAILED"
      ? "border-rose-400 bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
      : p.result === "OK"
        ? "border-emerald-400 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
        : p.sequence_status === "SYNTHESIZING"
          ? "border-sky-400 bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200"
          : "border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200";

/**
 * The batch at a glance (as OligoFlow's batch card): the column chamber grid with what sits in each position,
 * and the level of every reagent bottle the batch uses — what is left in the lot after this batch, against what
 * the batch takes from it.
 */
export function BatchVisual({ positions, columnCount, lots }: { positions: Position[]; columnCount: number | null; lots: BatchLot[] }) {
  const slots = Math.max(columnCount ?? 0, ...positions.map((p) => p.position_no));
  const reagents = lots.filter((l) => l.item_type !== "CONSUMABLE");
  const columns = lots.filter((l) => l.item_type === "CONSUMABLE");
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div>
        <div className="text-xs font-bold mb-2">Bố cục cột nạp mẫu</div>
        <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-4 gap-2">
          {Array.from({ length: slots }, (_, i) => {
            const p = positions.find((x) => x.position_no === i + 1);
            return (
              <div key={i} title={p ? `${p.sequence_code} · ${p.name} · ${p.couplings} chu kỳ` : "Trống"} className={`aspect-square rounded-full border-2 flex flex-col items-center justify-center text-center p-1 ${tone(p)}`}>
                <span className="text-[10px] opacity-70">#{i + 1}</span>
                {p && <span className="text-[10px] font-bold leading-tight break-all">{p.sequence_code}</span>}
                {p && <span className="text-[9px] opacity-70">{p.couplings} ck</span>}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2 mt-2 text-[10px] text-slate-500">
          <span>● Đang tổng hợp: xanh dương</span><span>● Đạt: xanh lá</span><span>● Không đạt: đỏ</span>
        </div>
      </div>
      <div>
        <div className="text-xs font-bold mb-2">Mức hóa chất của mẻ</div>
        {reagents.length === 0 && <p className="text-xs text-slate-400">Chưa có hóa chất giữ chỗ / xuất cho mẻ.</p>}
        <div className="flex gap-3 overflow-x-auto pb-2">
          {reagents.map((l) => {
            const take = l.used + l.held;
            const total = Math.max(l.on_hand + l.used, take, 1e-9);
            const left = Math.max(0, l.on_hand - l.held);
            const leftPct = Math.min(100, (left / total) * 100);
            const takePct = Math.min(100 - leftPct, (take / total) * 100);
            const low = leftPct < 20;
            return (
              <div key={`${l.item_id}-${l.lot_id}`} className="flex flex-col items-center w-16 shrink-0" title={`${l.item_code} · lô ${l.lot_code ?? "—"}`}>
                <div className="relative h-28 w-8 rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 overflow-hidden">
                  <div className={`absolute bottom-0 left-0 right-0 ${low ? "bg-amber-400" : "bg-sky-400"}`} style={{ height: `${leftPct}%` }} />
                  <div className="absolute left-0 right-0 bg-orange-300/80 dark:bg-orange-500/60" style={{ bottom: `${leftPct}%`, height: `${takePct}%` }} />
                </div>
                <span className="mt-1 text-[10px] font-bold text-center leading-tight">{l.port_role ?? l.item_code}</span>
                <span className="text-[9px] text-slate-500 text-center leading-tight">mẻ: {fmtQty(take)} {l.base_uom}</span>
                <span className={`text-[9px] text-center leading-tight ${low ? "text-amber-700 dark:text-amber-400 font-bold" : "text-slate-500"}`}>còn {fmtQty(left)}</span>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3 text-[10px] text-slate-500 mb-2">
          <span><span className="inline-block w-2 h-2 bg-orange-300 mr-1" />phần mẻ này dùng</span>
          <span><span className="inline-block w-2 h-2 bg-sky-400 mr-1" />còn lại trong lô</span>
          <span><span className="inline-block w-2 h-2 bg-amber-400 mr-1" />dưới 20 %</span>
        </div>
        <div className="text-xs font-bold mb-1">Chai / lô và cột CPG trừ kho</div>
        <table className="w-full text-[11px]">
          <tbody>
            {[...reagents, ...columns].map((l) => (
              <tr key={`r-${l.item_id}-${l.lot_id}`} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-0.5 pr-2">{l.port_no ? `Cổng ${l.port_no} · ` : ""}{l.item_code} {l.item_name}</td>
                <td className="py-0.5 pr-2 font-mono">{l.lot_code ?? "—"}</td>
                <td className="py-0.5 pr-2 text-right whitespace-nowrap">{fmtQty(l.used + l.held)} {l.base_uom}{l.held > 0 && l.used === 0 ? " (giữ chỗ)" : ""}</td>
                <td className="py-0.5 text-right whitespace-nowrap text-slate-500">{l.expiry_date ? `HD ${fmtDate(l.expiry_date)}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

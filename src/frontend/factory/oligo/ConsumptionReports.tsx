"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, inputClass, Table } from "../ui";

interface Report {
  tolerance_pct: number;
  average: { item_id: string; item_code: string; item_name: string; base_uom: string; roles: string; batches: number; est: number; actual: number; couplings: number; ratio: number | null; per_coupling: number | null }[];
  variance: { batch_id: string; batch_code: string; finished_at: string; synthesizer_code: string; item_code: string; item_name: string; base_uom: string; est: number; actual: number; diff: number; diff_pct: number | null; flagged: boolean; operator_name: string | null }[];
}
interface Calibration {
  id: string; port_no: number; role: string; installed_at: string | null; removed_at: string; volume_start: number; volume_left: number; actual_qty: number; booked_qty: number; ratio: number | null;
  rule_qty_before: number | null; suggested_qty: number | null; applied: boolean; notes: string | null; synthesizer_code: string; lot_code: string; item_code: string; base_uom: string; rule_uom: string | null; adjustment_code: string | null;
}

type Tab = "average" | "variance" | "calibration";
const pct = (n: number | null) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n.toLocaleString("vi-VN")} %`);

/** Consumption reports (as OligoFlow): average per reagent, estimate vs actual per batch, and rule calibration from bottles. */
export function ConsumptionReports({ canApply }: { canApply: boolean }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("average");
  const [range, setRange] = useState({ from: "", to: "" });
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const params = new URLSearchParams(Object.entries(range).filter(([, v]) => v));
  const report = useQuery({ queryKey: ["factory", "oligo-consumption", range], queryFn: () => api<Report>(`/api/factory/oligo/reports/consumption?${params}`), enabled: tab !== "calibration" });
  const cals = useQuery({ queryKey: ["factory", "oligo-calibrations"], queryFn: () => api<Calibration[]>("/api/factory/oligo/calibrations"), enabled: tab === "calibration" });
  const apply = useMutation({
    mutationFn: (id: string) => {
      const reason = window.prompt("Lý do áp dụng định mức mới:");
      if (!reason) throw new Error("Cần lý do.");
      return api(`/api/factory/oligo/calibrations/${id}/apply`, { method: "POST", json: { reason } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "oligo-calibrations"] });
      qc.invalidateQueries({ queryKey: ["factory", "oligo-reagent-rules"] });
    },
  });
  const tabs: [Tab, string][] = [["average", "Tiêu hao trung bình"], ["variance", "Chênh lệch tiêu hao"], ["calibration", "Hiệu chuẩn định mức (tháo chai)"]];
  return (
    <Card
      title="Báo cáo tiêu hao hóa chất tổng hợp"
      actions={
        tab !== "calibration" && (
          <div className="flex gap-1 items-center text-xs">
            <input className={`${inputClass} w-36`} type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="Từ ngày" />
            <span>→</span>
            <input className={`${inputClass} w-36`} type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="Đến ngày" />
          </div>
        )
      }
    >
      <div className="flex gap-1 mb-3">
        {tabs.map(([k, v]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${tab === k ? "bg-sky-700 text-white" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"}`}>{v}</button>
        ))}
      </div>
      <ErrorNote error={report.error ?? cals.error ?? apply.error} />
      {tab === "average" && report.data && (
        report.data.average.length === 0 ? <Empty>Chưa có mẻ hoàn thành trong khoảng này.</Empty> : (
          <Table head={["Hóa chất", "Vai trò", "Số mẻ", "Lý thuyết", "Thực tế", "Thực tế / lý thuyết", "Số lần ghép", "Thực tế / lần ghép"]}>
            {report.data.average.map((r) => (
              <tr key={r.item_id}>
                <td className="py-1.5 pr-3 text-xs">{r.item_code} · {r.item_name}</td>
                <td className="py-1.5 pr-3 text-xs">{r.roles}</td>
                <td className="py-1.5 pr-3 text-right">{r.batches}</td>
                <td className="py-1.5 pr-3 text-right text-xs">{fmtQty(r.est)} {r.base_uom}</td>
                <td className="py-1.5 pr-3 text-right text-xs">{fmtQty(r.actual)} {r.base_uom}</td>
                <td className={`py-1.5 pr-3 text-right text-xs font-bold ${r.ratio != null && Math.abs(r.ratio - 1) * 100 > report.data.tolerance_pct ? "text-amber-700 dark:text-amber-400" : ""}`}>{r.ratio == null ? "—" : r.ratio.toLocaleString("vi-VN")}</td>
                <td className="py-1.5 pr-3 text-right">{r.couplings}</td>
                <td className="py-1.5 pr-3 text-right text-xs">{r.per_coupling == null ? "—" : `${fmtQty(r.per_coupling)} ${r.base_uom}`}</td>
              </tr>
            ))}
          </Table>
        )
      )}
      {tab === "variance" && report.data && (
        <>
          <label className="flex items-center gap-1 text-xs mb-2"><input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />Chỉ dòng lệch quá {report.data.tolerance_pct} %</label>
          {report.data.variance.length === 0 ? <Empty>Chưa có số liệu.</Empty> : (
            <Table head={["Mẻ", "Máy / người chạy", "Kết thúc", "Hóa chất", "Lý thuyết", "Thực tế", "Chênh lệch", "Tỷ lệ"]}>
              {report.data.variance.filter((r) => !onlyFlagged || r.flagged).map((r) => (
                <tr key={`${r.batch_id}-${r.item_code}`} className={r.flagged ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}>
                  <td className="py-1.5 pr-3 font-mono text-xs">{r.batch_code}</td>
                  <td className="py-1.5 pr-3 text-xs">{r.synthesizer_code}{r.operator_name ? ` · ${r.operator_name}` : ""}</td>
                  <td className="py-1.5 pr-3 text-xs">{fmtDate(r.finished_at)}</td>
                  <td className="py-1.5 pr-3 text-xs">{r.item_code}</td>
                  <td className="py-1.5 pr-3 text-right text-xs">{fmtQty(r.est)}</td>
                  <td className="py-1.5 pr-3 text-right text-xs">{fmtQty(r.actual)}</td>
                  <td className="py-1.5 pr-3 text-right text-xs">{fmtQty(r.diff)} {r.base_uom}</td>
                  <td className={`py-1.5 pr-3 text-right text-xs ${r.flagged ? "font-bold text-amber-700 dark:text-amber-400" : ""}`}>{pct(r.diff_pct)}</td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}
      {tab === "calibration" && cals.data && (
        cals.data.length === 0 ? <Empty>Chưa có lần tháo chai nào được đo. Tháo chai ở Thiết bị & định mức → Cổng hóa chất → "Tháo chai (đo lượng còn)".</Empty> : (
          <Table head={["Tháo lúc", "Máy / cổng", "Hóa chất / lô", "Chai thực tế đã dùng", "Mẻ ghi sổ", "Tỷ lệ", "Định mức hiện tại → đề xuất", ""]}>
            {cals.data.map((c) => (
              <tr key={c.id}>
                <td className="py-1.5 pr-3 text-xs whitespace-nowrap">{new Date(c.removed_at).toLocaleString("vi-VN")}</td>
                <td className="py-1.5 pr-3 text-xs">{c.synthesizer_code} · cổng {c.port_no} ({c.role})</td>
                <td className="py-1.5 pr-3 text-xs">{c.item_code} · <span className="font-mono">{c.lot_code}</span>{c.adjustment_code && <div className="text-slate-500">Chứng từ chênh lệch {c.adjustment_code}</div>}</td>
                <td className="py-1.5 pr-3 text-right text-xs">{fmtQty(c.actual_qty)} {c.base_uom}<div className="text-slate-500">{fmtQty(c.volume_start)} → còn {fmtQty(c.volume_left)}</div></td>
                <td className="py-1.5 pr-3 text-right text-xs">{fmtQty(c.booked_qty)} {c.base_uom}</td>
                <td className="py-1.5 pr-3 text-right text-xs font-bold">{c.ratio == null ? "—" : c.ratio.toLocaleString("vi-VN")}</td>
                <td className="py-1.5 pr-3 text-right text-xs whitespace-nowrap">{c.rule_qty_before == null ? "—" : `${fmtQty(c.rule_qty_before)} → ${fmtQty(c.suggested_qty)} ${c.rule_uom ?? ""}`}</td>
                <td className="py-1.5 pr-3 text-right">
                  {c.applied ? <span className="text-xs text-emerald-700 dark:text-emerald-400">Đã áp dụng</span> : canApply && c.suggested_qty != null && <Button variant="ghost" onClick={() => apply.mutate(c.id)}>Áp dụng định mức</Button>}
                </td>
              </tr>
            ))}
          </Table>
        )
      )}
    </Card>
  );
}

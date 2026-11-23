"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, RefreshCw, Download } from "lucide-react";

type Row = { ref: string; detail: string; actor?: string; at?: string };
type Section = { key: string; title: string; severity: "high" | "medium" | "low"; why: string; fix: string; rows: Row[] };
type Report = { from: string; to: string; days: number; generatedAt: string; total: number; sections: Section[] };

const SEVERITY: Record<Section["severity"], { label: string; cls: string }> = {
  high: { label: "Cao", cls: "bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800" },
  medium: { label: "Trung bình", cls: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800" },
  low: { label: "Thấp", cls: "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700" },
};

const fmtDay = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
};

/** Báo cáo bất thường: các thao tác / dữ liệu lệch quy trình trong N ngày gần nhất, kèm cách xử lý đúng. */
export function AnomalyReportView() {
  const [days, setDays] = useState(7);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = async (d = days) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/reports?action=anomalies&days=${d}`, { headers: { "x-no-cache": "1" } });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Lỗi ${res.status}`);
      setReport(data);
      const firstOpen: Record<string, boolean> = {};
      (data.sections || []).forEach((s: Section) => { if (s.rows.length > 0 && s.severity === "high") firstOpen[s.key] = true; });
      setOpen(firstOpen);
    } catch (e: any) {
      setError(e?.message || "Không tải được báo cáo");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(days); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportText = () => {
    if (!report) return;
    const lines: string[] = [`BÁO CÁO BẤT THƯỜNG ${fmtDay(report.from)} – ${fmtDay(report.to)} (${report.total} mục)`, ""];
    report.sections.filter(s => s.rows.length > 0).forEach(s => {
      lines.push(`■ ${s.title} (${s.rows.length}) — mức ${SEVERITY[s.severity].label}`);
      lines.push(`  Cách xử lý: ${s.fix}`);
      s.rows.forEach(r => lines.push(`  - ${r.ref}: ${r.detail}${r.actor ? ` — ${r.actor}` : ""}${r.at ? ` (${r.at})` : ""}`));
      lines.push("");
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bao-cao-bat-thuong-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" /> Báo cáo bất thường
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Thao tác và dữ liệu lệch quy trình cần xem lại (chỉ đọc). Mỗi mục kèm cách xử lý đúng để nhắc nhân viên.
            {report && ` Kỳ: ${fmtDay(report.from)} – ${fmtDay(report.to)}.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold"
          >
            <option value={7}>7 ngày</option>
            <option value={14}>14 ngày</option>
            <option value={30}>30 ngày</option>
          </select>
          <button type="button" onClick={() => load(days)} disabled={loading}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Tải lại
          </button>
          <button type="button" onClick={exportText} disabled={!report || report.total === 0}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-orange-600 hover:bg-orange-500 text-white cursor-pointer disabled:opacity-50">
            <Download className="w-3.5 h-3.5" /> Tải về
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-300 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs p-3">{error}</div>}
      {loading && !report && <div className="text-xs text-slate-500 p-4">Đang tổng hợp báo cáo...</div>}

      {report && report.total === 0 && (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 p-4 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> Không có bất thường trong {report.days} ngày qua.
        </div>
      )}

      {report && report.sections.map(s => {
        const isOpen = Boolean(open[s.key]);
        const empty = s.rows.length === 0;
        return (
          <div key={s.key} className={`rounded-2xl border bg-white dark:bg-slate-900 ${empty ? "border-slate-200 dark:border-slate-800 opacity-70" : "border-slate-300 dark:border-slate-700"}`}>
            <button type="button" onClick={() => !empty && setOpen(o => ({ ...o, [s.key]: !isOpen }))}
              className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left ${empty ? "cursor-default" : "cursor-pointer"}`}>
              <span className="flex items-center gap-2 min-w-0">
                {empty ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : isOpen ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                <span className="font-bold text-sm text-slate-800 dark:text-slate-100 truncate">{s.title}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${SEVERITY[s.severity].cls}`}>{SEVERITY[s.severity].label}</span>
              </span>
              <span className={`text-sm font-bold ${empty ? "text-emerald-600" : "text-rose-600"}`}>{s.rows.length}</span>
            </button>
            {isOpen && !empty && (
              <div className="px-4 pb-4 space-y-2">
                <p className="text-xs text-slate-600 dark:text-slate-400"><strong>Vì sao cần xem:</strong> {s.why}</p>
                <p className="text-xs text-emerald-700 dark:text-emerald-400"><strong>Cách làm đúng:</strong> {s.fix}</p>
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                      <tr>
                        <th className="text-left px-3 py-2">Chứng từ</th>
                        <th className="text-left px-3 py-2">Chi tiết</th>
                        <th className="text-left px-3 py-2">Người thực hiện</th>
                        <th className="text-left px-3 py-2 whitespace-nowrap">Thời điểm</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.rows.map((r, i) => (
                        <tr key={`${r.ref}-${i}`} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="px-3 py-1.5 font-mono font-bold whitespace-nowrap">{r.ref}</td>
                          <td className="px-3 py-1.5">{r.detail}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap">{r.actor || "—"}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap text-slate-500">{r.at || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

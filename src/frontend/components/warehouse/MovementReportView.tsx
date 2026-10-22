"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Pager, usePaged, useDebouncedValue } from "@/frontend/components/Pager";
import * as XLSX from "xlsx";
import { FileSpreadsheet, RefreshCw, Search } from "lucide-react";
import { todayVN } from "@/backend/services/dates";
import { DateInputVN } from "@/frontend/components/DateInputVN";

const fmtVN = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

/**
 * Báo cáo Xuất – Nhập – Tồn theo kỳ: tồn đầu kỳ, nhập mua (PO), nhập trả / nhập lại, nhập khác, điều chỉnh,
 * xuất, tồn cuối kỳ cho từng mã hàng; lọc theo hãng / nhóm; xuất Excel.
 */
export function MovementReportView() {
  const today = todayVN();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [onlyMoved, setOnlyMoved] = useState(true);
  const [category, setCategory] = useState("all");
  const [manufacturer, setManufacturer] = useState("all");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`/api/inventory?action=movement_report&from=${from}&to=${to}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || String(r.status));
      setRows(Array.isArray(d.rows) ? d.rows : []);
    } catch (e: any) {
      setError(e?.message || "Lỗi tải báo cáo");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const uniq = (arr: any[]) => Array.from(new Set(arr.map((v) => String(v || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "vi"));
  const categories = useMemo(() => uniq(rows.map((r) => r.category)), [rows]);
  const manufacturers = useMemo(() => uniq(rows.map((r) => r.manufacturer)), [rows]);

  const qDebounced = useDebouncedValue(q, 300);
  const view = useMemo(() => {
    const kw = qDebounced.trim().toLowerCase();
    return rows
      .filter((r) => !onlyMoved || r.total_in !== 0 || r.total_out !== 0)
      .filter((r) => category === "all" || String(r.category || "").trim() === category)
      .filter((r) => manufacturer === "all" || String(r.manufacturer || "").trim() === manufacturer)
      .filter((r) => !kw || `${r.product_code} ${r.product_name}`.toLowerCase().includes(kw))
      .sort((a, b) => String(a.product_code).localeCompare(String(b.product_code)));
  }, [rows, qDebounced, onlyMoved, category, manufacturer]);
  const viewPage = usePaged(view, 100, `${qDebounced}|${onlyMoved}|${category}|${manufacturer}|${from}|${to}`);

  const sum = (k: string) => view.reduce((s, r) => s + (Number(r[k]) || 0), 0);

  const exportExcel = () => {
    const out: any[][] = [
      [`BÁO CÁO XUẤT - NHẬP - TỒN từ ${fmtVN(from)} đến ${fmtVN(to)}`],
      [],
      ["Mã hàng", "Tên hàng", "ĐVT", "Nhóm", "Hãng SX", "Tồn đầu kỳ", "Nhập mua", "Nhập trả / nhập lại", "Nhập khác", "Điều chỉnh tăng", "Xuất", "Điều chỉnh giảm", "Tổng nhập", "Tổng xuất", "Tồn cuối kỳ"],
    ];
    view.forEach((r) => out.push([r.product_code, r.product_name, r.unit || "", r.category || "", r.manufacturer || "", r.opening, r.purchase_in, r.return_in, r.other_in, r.adjust_in, r.out, r.adjust_out, r.total_in, r.total_out, r.closing]));
    out.push(["", "TỔNG CỘNG", "", "", "", sum("opening"), sum("purchase_in"), sum("return_in"), sum("other_in"), sum("adjust_in"), sum("out"), sum("adjust_out"), sum("total_in"), sum("total_out"), sum("closing")]);
    const ws = XLSX.utils.aoa_to_sheet(out);
    ws["!cols"] = [{ wch: 14 }, { wch: 42 }, { wch: 7 }, { wch: 20 }, { wch: 22 }, ...Array(10).fill({ wch: 11 })];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "XNT");
    XLSX.writeFile(wb, `Bao_cao_XNT_${from}_${to}.xlsx`);
  };

  const num = (v: any, cls = "") => <td className={`p-2 text-right font-mono ${cls}`}>{Number(v) ? Number(v).toLocaleString("vi-VN") : <span className="text-slate-300">0</span>}</td>;
  const sel = "px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200";

  return (
    <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4 text-xs">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-bold text-slate-900 dark:text-white text-sm">Báo cáo Xuất – Nhập – Tồn</div>
          <div className="text-[11px] text-slate-500">Tính từ các phiếu nhập / xuất đã ghi nhận; tồn đầu kỳ = tồn cuối kỳ − nhập + xuất trong kỳ.</div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-400 mb-0.5">Từ ngày</label>
            <DateInputVN value={from} onChange={(e) => setFrom(e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono" />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-400 mb-0.5">Đến ngày</label>
            <DateInputVN value={to} onChange={(e) => setTo(e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono" />
          </div>
          <button type="button" onClick={load} className="px-3 py-2 rounded-xl font-bold bg-orange-600 hover:bg-orange-700 text-white flex items-center gap-1.5 cursor-pointer">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Xem báo cáo
          </button>
          <button type="button" onClick={exportExcel} className="px-3 py-2 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 cursor-pointer">
            <FileSpreadsheet className="w-4 h-4" /> Xuất Excel
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mã hàng, tên hàng..."
            className="w-full pl-8 pr-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700" />
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={sel}>
          <option value="all">Tất cả nhóm hàng</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} className={sel}>
          <option value="all">Tất cả hãng sản xuất</option>
          {manufacturers.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 cursor-pointer select-none">
          <input type="checkbox" checked={onlyMoved} onChange={(e) => setOnlyMoved(e.target.checked)} className="accent-orange-600" /> Chỉ mã có phát sinh
        </label>
      </div>

      {error && <div className="p-3 rounded-xl bg-rose-50 text-rose-700 border border-rose-200">{error}</div>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left min-w-[1100px]">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold text-[11px]">
              <th className="p-2">Mã hàng</th>
              <th className="p-2">Tên hàng</th>
              <th className="p-2">ĐVT</th>
              <th className="p-2 text-right">Tồn đầu</th>
              <th className="p-2 text-right">Nhập mua</th>
              <th className="p-2 text-right">Nhập trả/lại</th>
              <th className="p-2 text-right">Nhập khác</th>
              <th className="p-2 text-right">ĐC tăng</th>
              <th className="p-2 text-right">Xuất</th>
              <th className="p-2 text-right">ĐC giảm</th>
              <th className="p-2 text-right">Tồn cuối</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {view.length === 0 ? (
              <tr><td colSpan={11} className="p-6 text-center text-slate-400">{loading ? "Đang tải..." : "Không có dữ liệu trong kỳ."}</td></tr>
            ) : viewPage.items.map((r) => (
              <tr key={r.product_code} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                <td className="p-2 font-mono font-bold text-orange-600 dark:text-orange-400">{r.product_code}</td>
                <td className="p-2 text-slate-800 dark:text-slate-100">{r.product_name}</td>
                <td className="p-2 text-slate-500">{r.unit || ""}</td>
                {num(r.opening, "text-slate-700 dark:text-slate-200")}
                {num(r.purchase_in, "text-emerald-600")}
                {num(r.return_in, "text-teal-600")}
                {num(r.other_in, "text-sky-600")}
                {num(r.adjust_in, "text-indigo-600")}
                {num(r.out, "text-rose-600")}
                {num(r.adjust_out, "text-purple-600")}
                {num(r.closing, "font-bold text-slate-900 dark:text-white")}
              </tr>
            ))}
          </tbody>
          {view.length > 0 && (
            <tfoot>
              <tr className="bg-slate-50 dark:bg-slate-800/60 font-bold">
                <td className="p-2" colSpan={3}>Tổng cộng ({view.length} mã)</td>
                {num(sum("opening"))}{num(sum("purchase_in"))}{num(sum("return_in"))}{num(sum("other_in"))}{num(sum("adjust_in"))}{num(sum("out"))}{num(sum("adjust_out"))}{num(sum("closing"))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <Pager p={viewPage} unit="mã" />
    </div>
  );
}

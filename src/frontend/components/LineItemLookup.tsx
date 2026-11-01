"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Search } from "lucide-react";
import * as XLSX from "xlsx";
import { todayVN } from "@/backend/services/dates";
import { DateInputVN } from "@/frontend/components/DateInputVN";
import { Pager, usePaged } from "@/frontend/components/Pager";

/**
 * Tra cứu chi tiết hàng hóa của nhiều chứng từ trên cùng một trang (mỗi dòng hàng một dòng):
 * Đơn bán (SO), Đơn mua (PO), Phiếu nhập kho, Phiếu giao hàng (xuất).
 */

type Source = "so" | "po" | "receipt" | "px";

const SOURCES: { id: Source; label: string; partner: string }[] = [
  { id: "so", label: "Đơn bán (SO)", partner: "Khách hàng" },
  { id: "po", label: "Đơn mua (PO)", partner: "Nhà cung cấp" },
  { id: "receipt", label: "Phiếu nhập kho", partner: "Nhà cung cấp" },
  { id: "px", label: "Phiếu giao (xuất)", partner: "Khách hàng" },
];

const fmt = (n: any) => (n === null || n === undefined || n === "" ? "—" : new Intl.NumberFormat("vi-VN").format(Math.round(Number(n) || 0)));
const dmy = (iso: string) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso || "—");
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function LineItemLookup({ sources = ["so", "po", "receipt", "px"] }: { sources?: Source[] }) {
  const available = sources.map((id) => SOURCES.find((s) => s.id === id)).filter(Boolean) as typeof SOURCES;
  const [source, setSource] = useState<Source>(available[0]?.id || "so");
  const [from, setFrom] = useState(() => addDays(todayVN(), -90));
  const [to, setTo] = useState(() => todayVN());
  const [q, setQ] = useState("");
  const [partner, setPartner] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<{ truncated: boolean; total: number; showCost: boolean }>({ truncated: false, total: 0, showCost: true });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ action: "line_items", source, from, to, q: q.trim(), partner: partner.trim() });
      const res = await fetch(`/api/sales?${params.toString()}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Lỗi ${res.status}`);
      setRows(Array.isArray(d.rows) ? d.rows : []);
      setMeta({ truncated: Boolean(d.truncated), total: Number(d.total_rows) || 0, showCost: d.show_cost !== false });
    } catch (e: any) {
      setRows([]);
      setError(e?.message || "Không tải được dữ liệu");
    } finally {
      setLoading(false);
    }
  }, [source, from, to, q, partner]);

  // Tải lại khi đổi loại chứng từ / khoảng ngày; ô tìm kiếm áp dụng khi bấm Enter hoặc nút Tìm
  useEffect(() => { load(); }, [source, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const src = SOURCES.find((s) => s.id === source)!;
  const showMoney = source === "so" || (source === "po" && meta.showCost);
  const totals = useMemo(() => rows.reduce((t, r) => ({ qty: t.qty + (Number(r.quantity) || 0), total: t.total + (Number(r.total) || 0) }), { qty: 0, total: 0 }), [rows]);
  const rowsPage = usePaged(rows, 50, `${source}|${from}|${to}|${q}|${partner}`);

  const exportExcel = () => {
    const data = rows.map((r) => ({
      "Chứng từ": r.doc_code, "Ngày": dmy(r.doc_date), [src.partner]: r.partner || "", "Tham chiếu": r.ref || "",
      "Mã hàng": r.product_code || "", "Tên hàng": r.product_name || "", "ĐVT": r.unit || "", "Số lượng": Number(r.quantity) || 0,
      ...(source === "po" ? { "Đã nhận": Number(r.received) || 0 } : {}),
      ...(showMoney ? { "Đơn giá": Number(r.unit_price) || 0, "Thành tiền": Number(r.total) || 0 } : {}),
      ...(source === "receipt" || source === "px" ? { "Số lô": r.lot || "", "Hạn dùng": r.expiry || "" } : {}),
      "Trạng thái": r.status || "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Dong hang");
    XLSX.writeFile(wb, `tra-cuu-${source}-${from}-${to}.xlsx`);
  };

  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-900 dark:text-white">Tra cứu dòng hàng</h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Xem chi tiết hàng hóa của nhiều chứng từ cùng lúc, mỗi mặt hàng một dòng.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {available.map((s) => (
            <button key={s.id} type="button" onClick={() => setSource(s.id)}
              className={`px-3 py-1.5 rounded-lg font-bold cursor-pointer ${source === s.id ? "bg-indigo-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); load(); }}
        className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800"
      >
        <label className="flex items-center gap-1 text-slate-500">Từ
          <DateInputVN value={from} onChange={(e) => setFrom(e.target.value)} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white" />
        </label>
        <label className="flex items-center gap-1 text-slate-500">Đến
          <DateInputVN value={to} onChange={(e) => setTo(e.target.value)} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white" />
        </label>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mã hàng, tên hàng, số chứng từ, số lô..."
            className="w-full pl-8 pr-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white" />
        </div>
        <input value={partner} onChange={(e) => setPartner(e.target.value)} placeholder={src.partner}
          className="w-48 py-1.5 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white" />
        <button type="submit" className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center gap-1 cursor-pointer">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Tìm
        </button>
        <button type="button" onClick={exportExcel} disabled={rows.length === 0} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1 cursor-pointer disabled:opacity-40">
          <Download className="w-3.5 h-3.5" /> Excel
        </button>
      </form>

      {error && <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-200">{error}</div>}

      <div className="flex flex-wrap gap-4 text-slate-500">
        <span>{rows.length} dòng{meta.truncated ? ` (hiển thị 5.000 / ${meta.total} — thu hẹp bộ lọc để xem hết)` : ""}</span>
        <span>Tổng SL: <b className="font-mono text-slate-800 dark:text-slate-100">{fmt(totals.qty)}</b></span>
        {showMoney && <span>Tổng tiền: <b className="font-mono text-emerald-600 dark:text-emerald-400">{fmt(totals.total)}</b></span>}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 max-h-[70vh]">
        <table className="w-full text-left min-w-[1000px]">
          <thead className="sticky top-0 bg-slate-100 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-[10px] uppercase font-bold z-10">
            <tr>
              <th className="p-2">Chứng từ</th>
              <th className="p-2">Ngày</th>
              <th className="p-2">{src.partner}</th>
              <th className="p-2">Mã hàng</th>
              <th className="p-2">Tên hàng</th>
              <th className="p-2 text-center">ĐVT</th>
              <th className="p-2 text-right">SL</th>
              {source === "po" && <th className="p-2 text-right">Đã nhận</th>}
              {showMoney && <th className="p-2 text-right">Đơn giá</th>}
              {showMoney && <th className="p-2 text-right">Thành tiền</th>}
              {(source === "receipt" || source === "px") && <th className="p-2">Lô / HD</th>}
              <th className="p-2">Tham chiếu</th>
              <th className="p-2">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.length === 0 ? (
              <tr><td colSpan={13} className="p-6 text-center text-slate-400">{loading ? "Đang tải..." : "Không có dòng hàng nào trong khoảng đã chọn."}</td></tr>
            ) : rowsPage.items.map((r, i) => (
              <tr key={`${r.doc_code}-${i}`} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                <td className="p-2 font-mono font-bold text-indigo-600 dark:text-indigo-300 whitespace-nowrap">{r.doc_code}</td>
                <td className="p-2 font-mono whitespace-nowrap">{dmy(r.doc_date)}</td>
                <td className="p-2 max-w-[220px] truncate" title={r.partner}>{r.partner || "—"}</td>
                <td className="p-2 font-mono text-sky-700 dark:text-sky-300 whitespace-nowrap">{r.product_code || "—"}</td>
                <td className="p-2 max-w-[280px] truncate" title={r.product_name}>{r.product_name || ""}</td>
                <td className="p-2 text-center">{r.unit || ""}</td>
                <td className="p-2 text-right font-mono font-bold">{fmt(r.quantity)}</td>
                {source === "po" && <td className="p-2 text-right font-mono">{fmt(r.received)}</td>}
                {showMoney && <td className="p-2 text-right font-mono">{fmt(r.unit_price)}</td>}
                {showMoney && <td className="p-2 text-right font-mono font-bold">{fmt(r.total)}</td>}
                {(source === "receipt" || source === "px") && (
                  <td className="p-2 font-mono text-[11px] whitespace-nowrap">{r.lot || "—"}{r.expiry ? ` · ${dmy(String(r.expiry).slice(0, 10))}` : ""}</td>
                )}
                <td className="p-2 font-mono text-[11px] text-slate-500 max-w-[160px] truncate" title={r.ref || ""}>{r.ref || r.person || ""}</td>
                <td className="p-2 text-[11px] text-slate-500 whitespace-nowrap">{r.status || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pager p={rowsPage} unit="dòng hàng" />
      </div>
    </div>
  );
}

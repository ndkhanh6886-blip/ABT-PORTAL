"use client";

import React, { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { AlertOctagon, CheckCircle2, FileSpreadsheet, RefreshCw, Search, XCircle } from "lucide-react";
import { todayVN } from "@/backend/services/dates";

type ExpiryClass = "normal" | "near" | "expired" | "no_expiry";

const NEAR_DAYS_KEY = "tbr_near_expiry_days";

const daysBetween = (fromISO: string, toISO: string) =>
  Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86400000);

const fmtVN = (iso?: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

const CLASS_META: Record<ExpiryClass, { label: string; cls: string }> = {
  normal: { label: "Bình thường", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800" },
  near: { label: "Cận date", cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800" },
  expired: { label: "Hết date", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800" },
  no_expiry: { label: "Không HSD", cls: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700" },
};

const FILTER_BTN_BG: Record<"all" | ExpiryClass, string> = {
  all: "bg-slate-800",
  normal: "bg-emerald-600",
  near: "bg-amber-600",
  expired: "bg-rose-600",
  no_expiry: "bg-slate-500",
};

/**
 * Tồn kho theo từng lô trong 1 kho: phân loại tự động theo hạn dùng (Bình thường / Cận date ≤ N ngày / Hết date),
 * lọc theo hãng sản xuất, nhóm hàng, vị trí, từ khoá; xuất Excel đúng danh sách đang lọc.
 * Không cần chuyển kho bằng tay: một lô tự chuyển sang "Cận date" / "Hết date" khi đến hạn.
 */
export function LotStockView() {
  const [lots, setLots] = useState<any[]>([]);
  const [today, setToday] = useState(todayVN());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nearDays, setNearDays] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(NEAR_DAYS_KEY));
      return v > 0 ? v : 90;
    } catch {
      return 90;
    }
  });
  const [cls, setCls] = useState<"all" | ExpiryClass>("all");
  const [manufacturer, setManufacturer] = useState("all");
  const [category, setCategory] = useState("all");
  const [location, setLocation] = useState("all");
  const [q, setQ] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/inventory?action=lot_stock");
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || String(r.status));
      setLots(Array.isArray(d.lots) ? d.lots : []);
      if (d.today) setToday(d.today);
    } catch (e: any) {
      setError(e?.message || "Lỗi tải dữ liệu");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    try { localStorage.setItem(NEAR_DAYS_KEY, String(nearDays)); } catch {}
  }, [nearDays]);

  const enriched = useMemo(() => lots.map((l) => {
    const exp = l.expiry_date ? String(l.expiry_date).slice(0, 10) : "";
    const left = exp ? daysBetween(today, exp) : null;
    const klass: ExpiryClass = !exp ? "no_expiry" : left! < 0 ? "expired" : left! <= nearDays ? "near" : "normal";
    return { ...l, exp, left, klass };
  }), [lots, today, nearDays]);

  const options = useMemo(() => {
    const uniq = (arr: any[]) => Array.from(new Set(arr.map((v) => String(v || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "vi"));
    return {
      manufacturers: uniq(enriched.map((l) => l.manufacturer)),
      categories: uniq(enriched.map((l) => l.category)),
      locations: uniq(enriched.map((l) => l.warehouse_location)),
    };
  }, [enriched]);

  const baseFiltered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return enriched.filter((l) =>
      (manufacturer === "all" || String(l.manufacturer || "").trim() === manufacturer) &&
      (category === "all" || String(l.category || "").trim() === category) &&
      (location === "all" || String(l.warehouse_location || "").trim() === location) &&
      (!kw || [l.product_code, l.product_name, l.lot_number, l.manufacturer, l.shelf_position].some((v) => String(v || "").toLowerCase().includes(kw)))
    );
  }, [enriched, manufacturer, category, location, q]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: baseFiltered.length, normal: 0, near: 0, expired: 0, no_expiry: 0 };
    baseFiltered.forEach((l) => (c[l.klass] = (c[l.klass] || 0) + 1));
    return c;
  }, [baseFiltered]);

  const rows = useMemo(() => baseFiltered.filter((l) => cls === "all" || l.klass === cls), [baseFiltered, cls]);

  const exportExcel = () => {
    const label = cls === "all" ? "Tat_ca" : cls === "normal" ? "Binh_thuong" : cls === "near" ? `Can_date_${nearDays}_ngay` : cls === "expired" ? "Het_date" : "Khong_HSD";
    const out: any[][] = [["Mã hàng", "Tên hàng", "Hãng sản xuất", "Nhóm hàng", "Số lô", "Hạn dùng", "Số ngày còn lại", "Phân loại", "Tồn", "ĐVT", "Vị trí", "Kệ", "Bảo quản", "Cách ly"]];
    rows.forEach((l) => out.push([
      l.product_code, l.product_name, l.manufacturer || "", l.category || "", l.lot_number, fmtVN(l.exp), l.left ?? "", CLASS_META[l.klass as ExpiryClass].label,
      Number(l.quantity_on_hand) || 0, l.unit || "", l.warehouse_location || "", l.shelf_position || "", l.storage_condition || "", l.is_quarantined ? "Có" : "",
    ]));
    const ws = XLSX.utils.aoa_to_sheet(out);
    ws["!cols"] = [{ wch: 14 }, { wch: 44 }, { wch: 24 }, { wch: 22 }, { wch: 16 }, { wch: 11 }, { wch: 8 }, { wch: 12 }, { wch: 8 }, { wch: 7 }, { wch: 18 }, { wch: 12 }, { wch: 22 }, { wch: 8 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ton theo lo");
    XLSX.writeFile(wb, `Ton_kho_theo_lo_${label}_${today}.xlsx`);
  };

  const sel = "px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200";

  return (
    <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-bold text-slate-900 dark:text-white text-sm">Tồn kho theo lô & hạn dùng</div>
          <div className="text-[11px] text-slate-500">Phân loại tự động theo HSD so với hôm nay ({fmtVN(today)}). Lô hết date bị chặn khi xuất kho / lập phiếu giao.</div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={load} className="px-3 py-2 rounded-xl font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Tải lại
          </button>
          <button type="button" onClick={exportExcel} className="px-3 py-2 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 cursor-pointer">
            <FileSpreadsheet className="w-4 h-4" /> Xuất Excel ({rows.length} lô)
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "normal", "near", "expired", "no_expiry"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setCls(k)}
            className={`px-3 py-1.5 rounded-xl font-bold text-white border border-transparent cursor-pointer flex items-center gap-1.5 ${cls === k ? "ring-2 ring-offset-1 ring-orange-400" : "opacity-80 hover:opacity-100"} ${FILTER_BTN_BG[k]}`}>
            {k === "near" && <AlertOctagon className="w-3.5 h-3.5" />}
            {k === "expired" && <XCircle className="w-3.5 h-3.5" />}
            {k === "normal" && <CheckCircle2 className="w-3.5 h-3.5" />}
            {k === "all" ? "Tất cả" : k === "near" ? `Cận date ≤ ${nearDays} ngày` : CLASS_META[k].label} ({counts[k] || 0})
          </button>
        ))}
        <label className="flex items-center gap-1 text-slate-500 ml-1">
          Ngưỡng cận date:
          <input type="number" min={1} max={730} value={nearDays} onChange={(e) => setNearDays(Math.max(1, Math.min(730, parseInt(e.target.value) || 90)))}
            className="w-16 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono text-center" /> ngày
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mã hàng, tên, số lô, hãng, kệ..."
            className="w-full pl-8 pr-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700" />
        </div>
        <select value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} className={sel}>
          <option value="all">Tất cả hãng sản xuất</option>
          {options.manufacturers.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={sel}>
          <option value="all">Tất cả nhóm hàng</option>
          {options.categories.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={location} onChange={(e) => setLocation(e.target.value)} className={sel}>
          <option value="all">Tất cả vị trí</option>
          {options.locations.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {error && <div className="p-3 rounded-xl bg-rose-50 text-rose-700 border border-rose-200">Không tải được dữ liệu lô: {error}</div>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left min-w-[1000px]">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold text-[11px]">
              <th className="p-2.5">Mã hàng</th>
              <th className="p-2.5">Tên hàng</th>
              <th className="p-2.5">Hãng SX</th>
              <th className="p-2.5">Nhóm</th>
              <th className="p-2.5">Số lô</th>
              <th className="p-2.5">Hạn dùng</th>
              <th className="p-2.5 text-center">Còn (ngày)</th>
              <th className="p-2.5 text-center">Phân loại</th>
              <th className="p-2.5 text-right">Tồn</th>
              <th className="p-2.5">Vị trí</th>
              <th className="p-2.5">Bảo quản</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.length === 0 ? (
              <tr><td colSpan={11} className="p-6 text-center text-slate-400">{loading ? "Đang tải..." : "Không có lô nào phù hợp bộ lọc."}</td></tr>
            ) : rows.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                <td className="p-2.5 font-mono font-bold text-orange-600 dark:text-orange-400">{l.product_code}</td>
                <td className="p-2.5 text-slate-800 dark:text-slate-100 font-medium">{l.product_name}</td>
                <td className="p-2.5 text-slate-600 dark:text-slate-300">{l.manufacturer || "—"}</td>
                <td className="p-2.5 text-slate-600 dark:text-slate-300">{l.category || "—"}</td>
                <td className="p-2.5 font-mono">{l.lot_number}{l.is_quarantined && <span className="ml-1 text-[9px] px-1 rounded bg-rose-100 text-rose-700 font-bold">Cách ly</span>}</td>
                <td className="p-2.5 font-mono">{fmtVN(l.exp)}</td>
                <td className={`p-2.5 text-center font-mono font-bold ${l.klass === "expired" ? "text-rose-600" : l.klass === "near" ? "text-amber-600" : "text-slate-600 dark:text-slate-300"}`}>{l.left ?? "—"}</td>
                <td className="p-2.5 text-center"><span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${CLASS_META[l.klass as ExpiryClass].cls}`}>{CLASS_META[l.klass as ExpiryClass].label}</span></td>
                <td className="p-2.5 text-right font-mono font-bold text-slate-900 dark:text-white">{Number(l.quantity_on_hand) || 0} <span className="text-[10px] text-slate-400 font-normal">{l.unit || ""}</span></td>
                <td className="p-2.5 text-slate-600 dark:text-slate-300">{l.warehouse_location || "—"}{l.shelf_position ? ` • ${l.shelf_position}` : ""}</td>
                <td className="p-2.5 text-slate-500 text-[11px]">{l.storage_condition || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, RefreshCw, Search } from "lucide-react";
import * as XLSX from "xlsx";
import { todayVN } from "@/backend/services/dates";
import { Pager, usePaged } from "@/frontend/components/Pager";

/**
 * Công nợ phải thu theo khách hàng (Kế toán / Quản trị).
 * Số liệu do máy chủ tính: giá trị hàng đã giao - đã thu; hạn thanh toán = ngày giao + số ngày nợ của khách.
 */

interface DebtOrder {
  order_code: string;
  order_date: string | null;
  sales_rep_name?: string;
  total: number;
  delivered: number;
  paid: number;
  outstanding: number;
  prepaid?: number;
  remaining_order?: number;
  delivery_status: string;
  delivered_at: string | null;
  due_date: string | null;
  overdue_days: number;
  invoice_no?: string;
  payment_status?: string;
  payments: { id?: number; amount: number; date: string | null; method?: string; reference?: string; slip?: string; by?: string; voided?: boolean; voided_by?: string; void_reason?: string }[];
}

interface DebtCustomer {
  customer_id: number | null;
  customer_code: string;
  customer_name: string;
  tax_code: string;
  credit_limit: number;
  credit_term_days: number;
  order_total: number;
  delivered: number;
  paid: number;
  outstanding: number;
  prepaid?: number;
  remaining_order?: number;
  overdue: number;
  aging: { current: number; d1_30: number; d31_60: number; d60_plus: number };
  max_overdue_days: number;
  orders: DebtOrder[];
}

const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n || 0));
const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

export function CustomerDebtView({
  onCollect,
  refreshKey = 0,
}: {
  /** Mở cửa sổ thu tiền cho một đơn */
  onCollect?: (order: { order_code: string; customer_name: string; total: number; paid: number }) => void;
  refreshKey?: number;
}) {
  const [rows, setRows] = useState<DebtCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"open" | "prepaid" | "overdue" | "all">("open");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [historyOrder, setHistoryOrder] = useState<string | null>(null);

  // Hủy khoản thu ghi nhầm; "Sửa" = hủy rồi mở lại cửa sổ thu tiền với số liệu cũ
  const voidPayment = async (p: any, order: DebtOrder, customerName: string, reopen: boolean) => {
    const reason = window.prompt(reopen ? "Lý do sửa khoản thu (khoản cũ sẽ bị hủy, nhập lại khoản đúng):" : "Lý do hủy khoản thu:", "");
    if (!reason || !reason.trim()) return;
    try {
      const res = await fetch("/api/sales?action=void_customer_payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_id: p.id, reason: reason.trim() })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.success) { alert(d.error || "Không hủy được khoản thu"); return; }
      await load();
      if (reopen && onCollect) onCollect({ order_code: order.order_code, customer_name: customerName, total: order.total, paid: Number(d.amount_paid) || 0 });
    } catch {
      alert("Lỗi kết nối máy chủ");
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/sales?action=customer_debt");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
      setRows(Array.isArray(data.customers) ? data.customers : []);
    } catch (e: any) {
      setError(e?.message || "Không tải được công nợ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const visible = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return rows.filter((c) => {
      if (filter === "open" && c.outstanding <= 0.5) return false;
      if (filter === "prepaid" && (c.prepaid || 0) <= 0.5) return false;
      if (filter === "overdue" && c.overdue <= 0.5) return false;
      if (!kw) return true;
      return [c.customer_name, c.customer_code, c.tax_code, ...c.orders.map((o) => o.order_code)].some((v) => String(v || "").toLowerCase().includes(kw));
    });
  }, [rows, q, filter]);

  const debtPage = usePaged(visible, 20, `${filter}|${q}`);

  const totals = useMemo(() => visible.reduce((t, c) => ({
    delivered: t.delivered + c.delivered,
    paid: t.paid + c.paid,
    outstanding: t.outstanding + Math.max(0, c.outstanding),
    prepaid: t.prepaid + Math.max(0, c.prepaid || 0),
    overdue: t.overdue + c.overdue,
    current: t.current + c.aging.current,
    d1_30: t.d1_30 + c.aging.d1_30,
    d31_60: t.d31_60 + c.aging.d31_60,
    d60_plus: t.d60_plus + c.aging.d60_plus,
  }), { delivered: 0, paid: 0, outstanding: 0, prepaid: 0, overdue: 0, current: 0, d1_30: 0, d31_60: 0, d60_plus: 0 }), [visible]);

  const exportExcel = () => {
    const summary = visible.map((c) => ({
      "Mã KH": c.customer_code, "Khách hàng": c.customer_name, "MST": c.tax_code, "Hạn nợ (ngày)": c.credit_term_days,
      "Đã giao": Math.round(c.delivered), "Đã thu": Math.round(c.paid), "Còn nợ": Math.round(c.outstanding),
      "Trong hạn": Math.round(c.aging.current), "Quá hạn 1-30": Math.round(c.aging.d1_30), "Quá hạn 31-60": Math.round(c.aging.d31_60),
      "Quá hạn >60": Math.round(c.aging.d60_plus), "Quá hạn lâu nhất (ngày)": c.max_overdue_days,
    }));
    const detail = visible.flatMap((c) => c.orders.map((o) => ({
      "Khách hàng": c.customer_name, "Mã SO": o.order_code, "NVKD": o.sales_rep_name || "", "Số HĐ": o.invoice_no || "",
      "Giá trị SO": Math.round(o.total), "Đã giao": Math.round(o.delivered), "Đã thu": Math.round(o.paid), "Còn nợ": Math.round(o.outstanding),
      "Ngày giao": dmy(o.delivered_at), "Hạn TT": dmy(o.due_date), "Quá hạn (ngày)": o.overdue_days,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Tong hop");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), "Chi tiet SO");
    XLSX.writeFile(wb, `cong-no-khach-hang-${todayVN()}.xlsx`);
  };

  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-white uppercase tracking-wide">Công nợ phải thu khách hàng</h2>
          <p className="text-[11px] text-slate-400">Giá trị hàng đã giao trừ số đã thu. Hạn thanh toán = ngày giao + số ngày nợ của khách.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={load} className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold flex items-center gap-1 cursor-pointer">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Tải lại
          </button>
          <button type="button" onClick={exportExcel} className="px-2.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold flex items-center gap-1 cursor-pointer">
            <Download className="w-3.5 h-3.5" /> Excel
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {[
          ["Đã giao", totals.delivered, "text-white"],
          ["Đã thu", totals.paid, "text-emerald-300"],
          ["Còn nợ", totals.outstanding, "text-amber-300"],
          ["Khách cọc / Trả trước", totals.prepaid, "text-purple-300"],
          ["Trong hạn", totals.current, "text-sky-300"],
          ["Quá hạn 1–30", totals.d1_30, "text-orange-300"],
          ["Quá hạn 31–60", totals.d31_60, "text-orange-400"],
          ["Quá hạn >60", totals.d60_plus, "text-rose-400"],
        ].map(([label, val, cls]) => (
          <div key={label as string} className="p-2 rounded-lg bg-slate-900/70 border border-slate-800">
            <div className="text-[10px] uppercase font-bold text-slate-500">{label as string}</div>
            <div className={`font-mono font-black ${cls}`}>{fmt(val as number)}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([
          ["open", "Còn nợ"],
          ["prepaid", `💜 Khách cọc / Trả trước (${rows.filter((r) => (r.prepaid || 0) > 0.5).length})`],
          ["overdue", "Quá hạn"],
          ["all", "Tất cả"]
        ] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFilter(k)}
            className={`px-2.5 py-1.5 rounded-lg font-semibold cursor-pointer ${
              filter === k
                ? k === "prepaid" ? "bg-purple-600 text-white" : "bg-indigo-600 text-white"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}>
            {label}
          </button>
        ))}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Khách hàng, mã KH, MST, mã SO..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-2 py-1.5 text-white" />
        </div>
      </div>

      {error && <div className="p-3 rounded-lg bg-rose-950/50 border border-rose-800 text-rose-200">{error}</div>}

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left min-w-[1000px]">
          <thead className="bg-slate-900 text-slate-400 text-[10px] uppercase font-bold">
            <tr>
              <th className="p-2">Khách hàng</th>
              <th className="p-2 text-center">Hạn nợ</th>
              <th className="p-2 text-right">Đã giao</th>
              <th className="p-2 text-right">Đã thu</th>
              <th className="p-2 text-right">Còn nợ</th>
              <th className="p-2 text-right">Trong hạn</th>
              <th className="p-2 text-right">1–30</th>
              <th className="p-2 text-right">31–60</th>
              <th className="p-2 text-right">&gt;60</th>
              <th className="p-2 text-center">Hạn mức</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {visible.length === 0 ? (
              <tr><td colSpan={10} className="p-6 text-center text-slate-500">{loading ? "Đang tải..." : "Không có khách hàng nào phù hợp."}</td></tr>
            ) : debtPage.items.map((c) => {
              const key = `${c.customer_id || ""}|${c.customer_name}`;
              const open = Boolean(expanded[key]);
              const overLimit = c.credit_limit > 0 && c.outstanding > c.credit_limit;
              return (
                <React.Fragment key={key}>
                  <tr className="hover:bg-slate-900/50 cursor-pointer" onClick={() => setExpanded((p) => ({ ...p, [key]: !open }))}>
                    <td className="p-2">
                      <div className="flex items-center gap-1.5">
                        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                        <span className="font-bold text-white">{c.customer_name}</span>
                      </div>
                      <div className="pl-5 text-[10px] text-slate-500 font-mono">{c.customer_code}{c.tax_code ? ` · MST ${c.tax_code}` : ""}</div>
                    </td>
                    <td className="p-2 text-center text-slate-300">{c.credit_term_days} ngày</td>
                    <td className="p-2 text-right font-mono">{fmt(c.delivered)}</td>
                    <td className="p-2 text-right font-mono text-emerald-300">
                      <div>{fmt(c.paid)}</div>
                      {(c.prepaid || 0) > 0.5 && (
                        <div className="text-[10px] font-bold text-purple-300">💜 Đã cọc: {fmt(c.prepaid || 0)}</div>
                      )}
                    </td>
                    <td className="p-2 text-right font-mono font-bold text-amber-300">{fmt(c.outstanding)}</td>
                    <td className="p-2 text-right font-mono text-sky-300">{c.aging.current ? fmt(c.aging.current) : "—"}</td>
                    <td className="p-2 text-right font-mono text-orange-300">{c.aging.d1_30 ? fmt(c.aging.d1_30) : "—"}</td>
                    <td className="p-2 text-right font-mono text-orange-400">{c.aging.d31_60 ? fmt(c.aging.d31_60) : "—"}</td>
                    <td className="p-2 text-right font-mono text-rose-400">{c.aging.d60_plus ? fmt(c.aging.d60_plus) : "—"}</td>
                    <td className="p-2 text-center">
                      {c.credit_limit > 0 ? (
                        <span className={`text-[10px] font-mono ${overLimit ? "text-rose-300 font-bold" : "text-slate-400"}`}>{fmt(c.credit_limit)}</span>
                      ) : "—"}
                    </td>
                  </tr>
                  {open && (
                    <tr className="bg-slate-950/50">
                      <td colSpan={10} className="p-2">
                        <table className="w-full text-[11px]">
                          <thead className="text-slate-500">
                            <tr>
                              <th className="p-1.5 text-left">Mã SO</th>
                              <th className="p-1.5 text-left">NVKD</th>
                              <th className="p-1.5 text-left">Số HĐ</th>
                              <th className="p-1.5 text-right">Giá trị SO</th>
                              <th className="p-1.5 text-right">Đã giao</th>
                              <th className="p-1.5 text-right">Đã thu</th>
                              <th className="p-1.5 text-right">Còn nợ</th>
                              <th className="p-1.5 text-center">Ngày giao</th>
                              <th className="p-1.5 text-center">Hạn TT</th>
                              <th className="p-1.5 text-center">Quá hạn</th>
                              <th className="p-1.5"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/70">
                            {c.orders.sort((a, b) => b.overdue_days - a.overdue_days || b.outstanding - a.outstanding).map((o) => (
                              <tr key={o.order_code}>
                                <td className="p-1.5 font-mono text-indigo-300">
                                  {o.order_code}
                                  {o.payments.length > 0 && (
                                    <button type="button" onClick={(e) => { e.stopPropagation(); setHistoryOrder(historyOrder === o.order_code ? null : o.order_code); }}
                                      className="block text-[9px] text-sky-400 hover:text-sky-300 underline cursor-pointer">
                                      {o.payments.filter((p) => !p.voided).length} lần thu{o.payments.some((p) => p.voided) ? ` (+${o.payments.filter((p) => p.voided).length} đã hủy)` : ""}
                                    </button>
                                  )}
                                  {historyOrder === o.order_code && (
                                    <div className="mt-1 p-1.5 rounded bg-slate-900 border border-slate-700 space-y-1 font-sans">
                                      {o.payments.map((p, pi) => (
                                        <div key={pi} className={`flex items-center gap-1.5 text-[10px] ${p.voided ? "opacity-50 line-through" : ""}`}>
                                          <span className="font-mono">{dmy(p.date)}</span>
                                          <span className="font-mono text-emerald-300">{fmt(p.amount)}</span>
                                          {p.slip && <span className="text-slate-400">phiếu {p.slip}</span>}
                                          {p.reference && <span className="text-slate-500 truncate max-w-[120px]">{p.reference}</span>}
                                          {p.voided ? (
                                            <span className="no-underline text-rose-400" title={p.void_reason || ""}>đã hủy ({p.voided_by})</span>
                                          ) : p.id ? (
                                            <span className="ml-auto inline-flex gap-1">
                                              <button type="button" onClick={(e) => { e.stopPropagation(); voidPayment(p, o, c.customer_name, true); }} className="px-1 rounded bg-sky-700 text-white cursor-pointer">Sửa</button>
                                              <button type="button" onClick={(e) => { e.stopPropagation(); voidPayment(p, o, c.customer_name, false); }} className="px-1 rounded bg-rose-700 text-white cursor-pointer">Hủy</button>
                                            </span>
                                          ) : null}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </td>
                                <td className="p-1.5 text-slate-300">{o.sales_rep_name || ""}</td>
                                <td className="p-1.5 font-mono text-slate-300">{o.invoice_no || "—"}</td>
                                <td className="p-1.5 text-right font-mono">{fmt(o.total)}</td>
                                <td className="p-1.5 text-right font-mono">{fmt(o.delivered)}</td>
                                <td className="p-1.5 text-right font-mono text-emerald-300">
                                  <div>{fmt(o.paid)}</div>
                                  {(o.prepaid || 0) > 0.5 && (
                                    <div className="text-[9px] font-bold text-purple-300">💜 Cọc: {fmt(o.prepaid || 0)}</div>
                                  )}
                                </td>
                                <td className="p-1.5 text-right font-mono font-bold text-amber-300">
                                  <div>{fmt(o.outstanding)}</div>
                                  {o.outstanding <= 0.5 && (o.total - o.paid) > 0.5 && (
                                    <div className="text-[9px] font-normal text-slate-400" title="Giá trị SO còn lại chưa thu">
                                      Còn SO: {fmt(o.total - o.paid)}
                                    </div>
                                  )}
                                </td>
                                <td className="p-1.5 text-center font-mono">{dmy(o.delivered_at)}</td>
                                <td className="p-1.5 text-center font-mono">{dmy(o.due_date)}</td>
                                <td className="p-1.5 text-center">
                                  {o.overdue_days > 0 ? <span className="text-rose-300 font-bold">{o.overdue_days} ngày</span> : <span className="text-slate-500">—</span>}
                                </td>
                                <td className="p-1.5 text-right">
                                  {onCollect && (o.outstanding > 0.5 || (o.total - o.paid) > 0.5) && (
                                    <button type="button"
                                      onClick={(e) => { e.stopPropagation(); onCollect({ order_code: o.order_code, customer_name: c.customer_name, total: o.total, paid: o.paid }); }}
                                      className={`px-2 py-0.5 rounded text-white font-bold cursor-pointer ${
                                        o.delivered <= 0.5
                                          ? "bg-purple-700 hover:bg-purple-600"
                                          : "bg-emerald-700 hover:bg-emerald-600"
                                      }`}>
                                      {o.delivered <= 0.5 ? "💰 Thu thêm cọc" : "💰 Thu tiền"}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        <Pager p={debtPage} unit="khách hàng" />
      </div>
    </div>
  );
}

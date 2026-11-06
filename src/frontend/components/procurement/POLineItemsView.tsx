"use client";

/**
 * Đơn đặt mua (PO) xem theo MẶT HÀNG: mỗi dòng hàng của các PO đang lọc là một dòng (đã đặt, đã nhận, còn lại),
 * kèm NCC, PR nguồn, trạng thái đơn và thanh toán. Dùng chung bộ lọc của danh sách PO.
 */

import React, { useMemo, useState } from "react";
import { Eye } from "lucide-react";
import { Pager, usePaged, useDebouncedValue } from "@/frontend/components/Pager";

interface POLineItemsViewProps {
  orders: any[];
  suppliers: any[];
  onOpenPO: (po: any) => void;
  receivedOf: (po: any, idx: number) => number;
  cleanItemName: (name: any) => string;
  itemSourcePR: (it: any) => string;
  statusLabel: (status: string) => { label: string; className: string };
  paymentStatus: (po: any) => "UNPAID" | "PAYMENT_REQUESTED" | "PARTIAL_PAID" | "PAID";
}

const PAYMENT_LABEL: Record<string, { label: string; className: string }> = {
  UNPAID: { label: "Chưa trả", className: "text-slate-500" },
  PAYMENT_REQUESTED: { label: "Đề nghị TT", className: "text-amber-600" },
  PARTIAL_PAID: { label: "TT một phần", className: "text-indigo-600" },
  PAID: { label: "Đã trả", className: "text-emerald-600" },
};

const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(Number(n) || 0));
const day = (v: any) => (v ? String(v).slice(0, 10).split("-").reverse().join("/") : "—");

export function POLineItemsView({ orders, suppliers, onOpenPO, receivedOf, cleanItemName, itemSourcePR, statusLabel, paymentStatus }: POLineItemsViewProps) {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 250);
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [onlyOutstanding, setOnlyOutstanding] = useState(false);

  const supplierShort = (po: any): string => {
    const s = suppliers.find((x: any) => String(x.id) === String(po?.supplier_id));
    return String(s?.short_name || "").trim() || String(s?.name || po?.supplier_name || "—");
  };

  const lines = useMemo(() => {
    const out: any[] = [];
    for (const po of orders || []) {
      const items = Array.isArray(po.items) ? po.items : [];
      items.forEach((it: any, idx: number) => {
        const qty = Number(it?.quantity) || 0;
        const received = receivedOf(po, idx);
        const price = Number(it?.unit_price) || 0;
        out.push({
          key: `${po.po_code}#${idx}`,
          po, idx,
          code: it?.product_code || "",
          name: cleanItemName(it?.product_name),
          spec: it?.specification || "",
          unit: it?.unit || "",
          qty, received,
          remaining: Math.max(0, qty - received),
          price,
          amount: qty * price,
          sourcePR: itemSourcePR(it),
          supplier: supplierShort(po),
        });
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, suppliers]);

  const supplierOptions = useMemo(() => Array.from(new Set(lines.map(l => l.supplier))).sort((a, b) => a.localeCompare(b)), [lines]);

  const visible = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    return lines
      .filter(l => supplierFilter === "all" || l.supplier === supplierFilter)
      .filter(l => !onlyOutstanding || (l.remaining > 0 && !["COMPLETED", "CANCELLED"].includes(String(l.po.status || "").toUpperCase())))
      .filter(l => !q || [l.code, l.name, l.po.po_code, l.sourcePR, l.supplier].some(v => String(v || "").toLowerCase().includes(q)));
  }, [lines, debounced, supplierFilter, onlyOutstanding]);

  const page = usePaged(visible, 50, `${debounced}|${supplierFilter}|${onlyOutstanding}`);
  const totalQty = visible.reduce((s, l) => s + l.qty, 0);
  const totalAmount = visible.reduce((s, l) => s + l.amount, 0);
  const totalRemaining = visible.reduce((s, l) => s + l.remaining, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm mã / tên hàng, mã PO, PR nguồn, NCC..."
          className="px-3 py-1.5 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white w-72"
        />
        <select
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
          className="px-3 py-1.5 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
        >
          <option value="all">Tất cả NCC</option>
          {supplierOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none">
          <input type="checkbox" checked={onlyOutstanding} onChange={(e) => setOnlyOutstanding(e.target.checked)} />
          Chỉ dòng chưa nhận đủ
        </label>
        <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
          {visible.length} dòng • Tổng SL: <strong className="text-slate-800 dark:text-slate-200">{fmt(totalQty)}</strong>
          {" "}• Còn chờ nhận: <strong className="text-amber-600">{fmt(totalRemaining)}</strong>
          {" "}• Tổng tiền: <strong className="text-emerald-600">{fmt(totalAmount)}</strong>
        </span>
      </div>

      <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 font-bold uppercase text-[10px]">
            <tr>
              <th className="py-2.5 px-2 w-28 whitespace-nowrap">Mã PO</th>
              <th className="py-2.5 px-2 w-20 whitespace-nowrap">Ngày đặt</th>
              <th className="py-2.5 px-2 w-20 whitespace-nowrap">Hạn giao</th>
              <th className="py-2.5 px-2 w-24 max-w-[110px]">NCC</th>
              <th className="py-2.5 px-2 min-w-[115px] w-32 whitespace-nowrap">Mã hàng</th>
              <th className="py-2.5 px-2 min-w-[200px] w-[22%]">Tên hàng &amp; Quy cách</th>
              <th className="py-2.5 px-1.5 w-14 text-center whitespace-nowrap">ĐVT</th>
              <th className="py-2.5 px-1.5 w-14 text-right whitespace-nowrap">SL đặt</th>
              <th className="py-2.5 px-1.5 w-14 text-right whitespace-nowrap">Đã nhận</th>
              <th className="py-2.5 px-1.5 w-14 text-right whitespace-nowrap">Còn lại</th>
              <th className="py-2.5 px-2 w-20 text-right whitespace-nowrap">Đơn giá</th>
              <th className="py-2.5 px-2 w-24 text-right whitespace-nowrap">Thành tiền</th>
              <th className="py-2.5 px-2 w-24 whitespace-nowrap">PR nguồn</th>
              <th className="py-2.5 px-2 w-28 whitespace-nowrap">Trạng thái / TT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {page.items.length === 0 ? (
              <tr><td colSpan={14} className="py-8 text-center text-slate-400">Không có dòng hàng nào phù hợp.</td></tr>
            ) : page.items.map(l => {
              const st = statusLabel(String(l.po.status || ""));
              const pay = PAYMENT_LABEL[paymentStatus(l.po)] || PAYMENT_LABEL.UNPAID;
              return (
                <tr key={l.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2 px-2 whitespace-nowrap">
                    <button type="button" onClick={() => onOpenPO(l.po)} className="font-mono font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer inline-flex items-center gap-1">
                      {l.po.po_code} <Eye className="w-3 h-3 shrink-0" />
                    </button>
                  </td>
                  <td className="py-2 px-2 font-mono text-[11px] whitespace-nowrap">{day(l.po.order_date)}</td>
                  <td className="py-2 px-2 font-mono text-[11px] whitespace-nowrap">{day(l.po.expected_delivery_date)}</td>
                  <td className="py-2 px-2 font-semibold max-w-[110px] truncate" title={l.supplier}>{l.supplier}</td>
                  <td className="py-2 px-2 font-mono font-bold text-indigo-700 dark:text-indigo-300 min-w-[115px] w-32 whitespace-nowrap">{l.code || "—"}</td>
                  <td className="py-2 px-2 text-slate-800 dark:text-slate-200 min-w-[200px] w-[22%]">
                    <span className="font-semibold">{l.name}</span>
                    {l.spec && <span className="text-[11px] text-slate-500 dark:text-slate-400"> ({l.spec})</span>}
                  </td>
                  <td className="py-2 px-1.5 text-center whitespace-nowrap">{l.unit}</td>
                  <td className="py-2 px-1.5 text-right font-mono font-bold whitespace-nowrap">{fmt(l.qty)}</td>
                  <td className="py-2 px-1.5 text-right font-mono whitespace-nowrap">{fmt(l.received)}</td>
                  <td className={`py-2 px-1.5 text-right font-mono font-bold whitespace-nowrap ${l.remaining > 0 ? "text-amber-600" : "text-emerald-600"}`}>{fmt(l.remaining)}</td>
                  <td className="py-2 px-2 text-right font-mono whitespace-nowrap">{fmt(l.price)}</td>
                  <td className="py-2 px-2 text-right font-mono font-bold whitespace-nowrap">{fmt(l.amount)}</td>
                  <td className="py-2 px-2 font-mono text-[11px] whitespace-nowrap">{l.sourcePR || "—"}</td>
                  <td className="py-2 px-2 whitespace-nowrap">
                    <div className={`text-[11px] leading-tight ${st.className}`}>{st.label}</div>
                    <div className={`text-[10px] font-semibold mt-0.5 ${pay.className}`}>{pay.label}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager p={page} unit="dòng hàng PO" />
    </div>
  );
}

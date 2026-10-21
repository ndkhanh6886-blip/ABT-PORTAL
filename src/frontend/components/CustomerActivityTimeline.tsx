"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Activity, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";

/**
 * Dòng thời gian hoạt động với MỘT khách hàng (máy chủ gom và kiểm tra quyền):
 * báo giá, hợp đồng, đơn, giao hàng, hóa đơn, thu tiền, trả hàng, phiếu phối hợp, công việc,
 * lịch tuần, nhật ký daily, kế hoạch, cơ hội bán hàng, yêu cầu Application.
 */

const TYPE_META: Record<string, { label: string; cls: string }> = {
  quotation: { label: "Báo giá", cls: "bg-indigo-950 text-indigo-300 border-indigo-700/60" },
  contract: { label: "Hợp đồng", cls: "bg-sky-950 text-sky-300 border-sky-700/60" },
  order: { label: "Đơn hàng", cls: "bg-violet-950 text-violet-300 border-violet-700/60" },
  delivery: { label: "Giao hàng", cls: "bg-teal-950 text-teal-300 border-teal-700/60" },
  invoice: { label: "Hóa đơn", cls: "bg-emerald-950 text-emerald-300 border-emerald-700/60" },
  payment: { label: "Thu tiền", cls: "bg-green-950 text-green-300 border-green-700/60" },
  rma: { label: "Trả hàng", cls: "bg-rose-950 text-rose-300 border-rose-700/60" },
  workflow: { label: "Phiếu phối hợp", cls: "bg-purple-950 text-purple-300 border-purple-700/60" },
  task: { label: "Công việc", cls: "bg-amber-950 text-amber-300 border-amber-700/60" },
  schedule: { label: "Lịch công tác", cls: "bg-cyan-950 text-cyan-300 border-cyan-700/60" },
  daily: { label: "Nhật ký", cls: "bg-slate-800 text-slate-300 border-slate-600" },
  plan: { label: "Kế hoạch", cls: "bg-slate-800 text-slate-300 border-slate-600" },
  deal: { label: "Cơ hội", cls: "bg-orange-950 text-orange-300 border-orange-700/60" },
  app_request: { label: "Yêu cầu App", cls: "bg-fuchsia-950 text-fuchsia-300 border-fuchsia-700/60" },
  other: { label: "Khác", cls: "bg-slate-800 text-slate-300 border-slate-600" },
};
const GROUPS: { key: string; label: string; types: string[] }[] = [
  { key: "all", label: "Tất cả", types: [] },
  { key: "sales", label: "Báo giá / HĐ / Đơn", types: ["quotation", "contract", "order"] },
  { key: "fulfil", label: "Giao hàng / HĐ / Thu tiền", types: ["delivery", "invoice", "payment", "rma"] },
  { key: "care", label: "Chăm sóc & công việc", types: ["workflow", "task", "schedule", "daily", "plan", "deal", "app_request", "other"] },
];

const fmtMoney = (n: any) => new Intl.NumberFormat("vi-VN").format(Math.round(Number(n) || 0));
const dmy = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

export function CustomerActivityTimeline({ customer }: { customer: { id?: any; name?: string } | null }) {
  const [open, setOpen] = useState(true);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [group, setGroup] = useState("all");
  const [person, setPerson] = useState("all");
  const [limit, setLimit] = useState(30);

  const load = async () => {
    if (!customer) return;
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ action: "customer_activity" });
      if (customer.id && /^\d+$/.test(String(customer.id))) qs.set("customer_id", String(customer.id));
      if (customer.name) qs.set("customer_name", customer.name);
      const r = await fetch(`/api/sales?${qs.toString()}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Lỗi ${r.status}`);
      setItems(Array.isArray(d.items) ? d.items : []);
    } catch (e: any) {
      setItems([]);
      setError(e?.message || "Không tải được hoạt động");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { setLimit(30); setPerson("all"); load(); }, [customer?.id, customer?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const people = useMemo(() => Array.from(new Set(items.map((i) => String(i.person || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "vi")), [items]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    GROUPS.forEach((g) => { c[g.key] = g.key === "all" ? items.length : items.filter((i) => g.types.includes(i.type)).length; });
    return c;
  }, [items]);
  const visible = useMemo(() => {
    const g = GROUPS.find((x) => x.key === group);
    return items.filter((i) => (group === "all" || (g && g.types.includes(i.type))) && (person === "all" || String(i.person || "").trim() === person));
  }, [items, group, person]);

  if (!customer) return null;

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-3 py-2.5 flex flex-wrap items-center gap-2 border-b border-slate-800">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 cursor-pointer">
          {open ? <ChevronUp className="w-4 h-4 text-indigo-400" /> : <ChevronDown className="w-4 h-4 text-indigo-400" />}
          <Activity className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-bold text-slate-200 font-mono uppercase tracking-wider">Hoạt động với khách hàng</span>
          <span className="text-[10px] bg-indigo-950 text-indigo-300 border border-indigo-800/80 px-2 py-0.5 rounded font-mono font-bold">{items.length}</span>
        </button>
        {open && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5 text-[11px]">
            {GROUPS.map((g) => (
              <button key={g.key} type="button" onClick={() => setGroup(g.key)}
                className={`px-2 py-1 rounded-lg font-semibold cursor-pointer ${group === g.key ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
                {g.label} ({counts[g.key] || 0})
              </button>
            ))}
            <select value={person} onChange={(e) => setPerson(e.target.value)} className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-700 text-slate-200">
              <option value="all">Mọi nhân viên</option>
              {people.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <button type="button" onClick={load} className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer" title="Tải lại">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        )}
      </div>
      {open && (
        <div className="p-3">
          {error ? (
            <div className="text-xs text-rose-300">{error}</div>
          ) : visible.length === 0 ? (
            <div className="text-xs text-slate-500 italic text-center py-4">{loading ? "Đang tải..." : "Chưa có hoạt động nào được ghi nhận cho khách hàng này."}</div>
          ) : (
            <ol className="relative border-l border-slate-700 ml-2 space-y-2.5">
              {visible.slice(0, limit).map((i, idx) => {
                const meta = TYPE_META[i.type] || TYPE_META.other;
                return (
                  <li key={idx} className="ml-3">
                    <span className="absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-indigo-500 ring-2 ring-slate-900" />
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="font-mono text-slate-400 w-20 shrink-0">{dmy(i.date)}</span>
                      <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${meta.cls}`}>{meta.label}</span>
                      {i.code && <span className="font-mono font-bold text-slate-200">{i.code}</span>}
                      <span className="text-slate-200 min-w-0 truncate max-w-[520px]" title={i.title}>{i.title}</span>
                      {i.amount ? <span className="font-mono text-emerald-300">{fmtMoney(i.amount)} đ</span> : null}
                      {i.status && <span className="text-[10px] text-slate-500">· {String(i.status)}</span>}
                      {i.person && <span className="text-[10px] text-indigo-300">👤 {i.person}</span>}
                    </div>
                    {i.extra && <div className="ml-[5.5rem] text-[10px] text-slate-400 truncate max-w-[640px]" title={i.extra}>{i.extra}</div>}
                  </li>
                );
              })}
            </ol>
          )}
          {visible.length > limit && (
            <button type="button" onClick={() => setLimit((l) => l + 50)} className="mt-2 text-[11px] text-indigo-300 hover:text-indigo-200 cursor-pointer">
              Xem thêm ({visible.length - limit} hoạt động)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

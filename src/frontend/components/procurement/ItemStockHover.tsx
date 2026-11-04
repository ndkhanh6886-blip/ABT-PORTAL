"use client";

/**
 * Rê chuột vào mã hàng: thẻ tồn kho & nhu cầu của mã đó (tồn thực tế, Sale giữ chỗ, khả dụng, hàng đang về theo PO,
 * các SO đang chờ giao, PR chưa lập PO, tổng nhu cầu và cân đối thiếu / dư).
 * Thẻ dùng position: fixed nên không bị bảng có thanh cuộn cắt mất.
 */

import React, { useState } from "react";

export type ItemDemandInfo = {
  code: string;
  unit?: string;
  onHand: number;
  reserved: number;
  reservations: { order_code?: string; customer?: string; sales_rep?: string; qty: number }[];
  available: number;
  incoming: number;
  incomingPOs: { po_code: string; supplier?: string; qty: number; eta?: string }[];
  soPending: number;
  soPendingOrders: { order_code: string; customer?: string; qty: number; order_date?: string }[];
  prOpen: number;
  prOpenLines: { pr_code: string; qty: number }[];
  soLoaded: boolean;
};

const fmt = (n: number) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(Number(n) || 0);
const MAX_ROWS = 8;

function List<T>({ rows, render }: { rows: T[]; render: (r: T, i: number) => React.ReactNode }) {
  if (rows.length === 0) return null;
  return (
    <ul className="mt-0.5 space-y-0.5 pl-3">
      {rows.slice(0, MAX_ROWS).map(render)}
      {rows.length > MAX_ROWS && <li className="text-slate-400">… và {rows.length - MAX_ROWS} dòng khác</li>}
    </ul>
  );
}

function Row({ label, value, className = "" }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`font-mono font-bold ${className}`}>{value}</span>
    </div>
  );
}

export function ItemStockHover({
  code,
  getInfo,
  children,
  className = "",
}: {
  code: string;
  getInfo: (code: string) => ItemDemandInfo | null;
  children: React.ReactNode;
  className?: string;
}) {
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const [info, setInfo] = useState<ItemDemandInfo | null>(null);

  const open = (e: React.MouseEvent<HTMLElement>) => {
    if (!code) return;
    const r = e.currentTarget.getBoundingClientRect();
    const below = r.top < window.innerHeight / 2;
    setInfo(getInfo(code));
    setPos({ x: Math.min(r.left, window.innerWidth - 400), y: below ? r.bottom + 6 : r.top - 6, below });
  };

  const unit = info?.unit ? ` ${info.unit}` : "";
  const totalDemand = info ? info.soPending : 0;
  const balance = info ? info.onHand + info.incoming - totalDemand : 0;

  return (
    <span className={`relative cursor-help ${className}`} onMouseEnter={open} onMouseLeave={() => setPos(null)}>
      <span className="underline decoration-dotted underline-offset-2">{children}</span>
      {pos && info && (
        <div
          className="fixed z-[100] w-[380px] max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl p-3 text-[11px] text-slate-700 dark:text-slate-200 font-sans font-normal text-left whitespace-normal pointer-events-none"
          style={{ left: Math.max(8, pos.x), top: pos.below ? pos.y : undefined, bottom: pos.below ? undefined : window.innerHeight - pos.y }}
        >
          <div className="font-mono font-bold text-indigo-600 dark:text-indigo-400 text-xs mb-1.5">📦 {info.code}</div>

          <div className="space-y-1">
            <Row label="Tồn kho thực tế" value={`${fmt(info.onHand)}${unit}`} />
            <Row label="Sale đang giữ chỗ" value={fmt(info.reserved)} className="text-amber-600" />
            <List
              rows={info.reservations}
              render={(r, i) => (
                <li key={i} className="text-slate-500">• {r.order_code || "—"}{r.customer ? ` – ${r.customer}` : ""}{r.sales_rep ? ` (${r.sales_rep})` : ""}: <b>{fmt(r.qty)}</b></li>
              )}
            />
            <Row label="Khả dụng (sau giữ chỗ)" value={fmt(info.available)} className={info.available > 0 ? "text-emerald-600" : "text-rose-500"} />
            <Row label="Đang về (PO chưa nhận đủ)" value={`+${fmt(info.incoming)}`} className="text-sky-600" />
            <List
              rows={info.incomingPOs}
              render={(p, i) => (
                <li key={i} className="text-slate-500">• {p.po_code}{p.supplier ? ` – ${p.supplier}` : ""}: <b>{fmt(p.qty)}</b>{p.eta ? ` (hẹn ${p.eta})` : ""}</li>
              )}
            />
          </div>

          <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1">
            <Row
              label={`SO đang chờ giao (${info.soPendingOrders.length} đơn)`}
              value={info.soLoaded ? fmt(info.soPending) : "đang tải…"}
              className="text-orange-600"
            />
            <List
              rows={info.soPendingOrders}
              render={(o, i) => (
                <li key={i} className="text-slate-500">• {o.order_code}{o.customer ? ` – ${o.customer}` : ""}: <b>{fmt(o.qty)}</b></li>
              )}
            />
            <Row label={`PR chưa lập PO (${info.prOpenLines.length} dòng)`} value={fmt(info.prOpen)} className="text-indigo-600" />
            <List
              rows={info.prOpenLines}
              render={(p, i) => (
                <li key={i} className="text-slate-500">• {p.pr_code}: <b>{fmt(p.qty)}</b></li>
              )}
            />
          </div>

          <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1">
            <Row label="Tổng nhu cầu (SO chờ giao)" value={fmt(totalDemand)} />
            <Row
              label="Cân đối (tồn + đang về − nhu cầu)"
              value={balance < 0 ? `Thiếu ${fmt(-balance)}` : `Đủ, dư ${fmt(balance)}`}
              className={balance < 0 ? "text-rose-600" : "text-emerald-600"}
            />
          </div>
        </div>
      )}
    </span>
  );
}

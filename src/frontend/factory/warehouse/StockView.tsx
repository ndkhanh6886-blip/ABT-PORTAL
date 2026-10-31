"use client";

import React, { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, fmtDate, fmtQty } from "../api";
import { Card, Empty, ErrorNote, inputClass, LOT_STATUS_LABEL, Pager, StatusBadge, Table } from "../ui";
import { LotPanel } from "./LotPanel";

interface StockRow {
  id: string;
  lot_id: string | null;
  item_code: string;
  item_name: string;
  base_uom: string;
  lot_code: string | null;
  mfr_lot_no: string | null;
  lot_status: string | null;
  expiry_date: string | null;
  warehouse_code: string;
  location_code: string;
  is_quarantine: boolean;
  qty_on_hand: string;
  qty_reserved: string;
  qty_available: string;
  incubation_until: string | null;
}

export function StockView({
  warehouses,
  initialWarehouseId = "",
}: {
  warehouses: { id: string; code: string; name: string; owner_name?: string; owner_module_key?: string }[];
  initialWarehouseId?: string;
}) {
  const [warehouseId, setWarehouseId] = useState(initialWarehouseId);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [lotId, setLotId] = useState<string | null>(null);
  const params = new URLSearchParams({ page: String(page), page_size: "50" });
  if (warehouseId) params.set("warehouse_id", warehouseId);
  if (q.trim()) params.set("q", q.trim());
  if (status) params.set("status", status);

  const stock = useQuery({
    queryKey: ["factory", "stock", params.toString()],
    queryFn: () => api<{ rows: StockRow[]; total: number; page: number; page_size: number }>(`/api/factory/inv/stock?${params}`),
    placeholderData: keepPreviousData,
  });
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <>
    {lotId && <LotPanel key={lotId} lotId={lotId} onClose={() => setLotId(null)} />}
    <Card title="Tồn kho theo lô và vị trí (Kho Tổng & Kho Nhánh Phòng Ban)">
      {warehouses.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <button
            type="button"
            onClick={() => reset(() => setWarehouseId(""))}
            className={`px-3 py-1 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
              warehouseId === ""
                ? "bg-sky-700 text-white border-sky-700"
                : "bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
            }`}
          >
            Tất cả kho ({warehouses.length})
          </button>
          {warehouses.map((w) => {
            const shortLabel =
              w.code === "KHO-TONG"
                ? "KHO-TONG · Kho Trung Tâm"
                : w.code === "KHO-KIT"
                  ? "KHO-KIT · Kho SX Kit"
                  : w.code === "KHO-OLIGO"
                    ? "KHO-OLIGO · Kho Oligo"
                    : w.code === "KHO-DEVICE"
                      ? "KHO-DEVICE · Kho Thiết Bị"
                      : w.code === "KHO-RD"
                        ? "KHO-RD · Kho R&D"
                        : w.code === "KHO-QA"
                          ? "KHO-QA · Kho QA/QC"
                          : `${w.code} · ${w.name}`;
            return (
              <button
                key={w.id}
                type="button"
                title={`${w.code} — ${w.name}${w.owner_name ? ` (${w.owner_name})` : ""}`}
                onClick={() => reset(() => setWarehouseId(w.id))}
                className={`px-2.5 py-1 rounded-xl text-xs font-bold border transition-colors cursor-pointer whitespace-nowrap ${
                  warehouseId === w.id
                    ? "bg-sky-700 text-white border-sky-700"
                    : "bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                }`}
              >
                {shortLabel}
              </button>
            );
          })}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-3 mb-3">
        <select className={inputClass} value={warehouseId} onChange={(e) => reset(() => setWarehouseId(e.target.value))} aria-label="Kho">
          <option value="">Tất cả kho được xem</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {w.name}
            </option>
          ))}
        </select>
        <input className={inputClass} placeholder="Tìm mã, tên vật tư, số lô…" value={q} onChange={(e) => reset(() => setQ(e.target.value))} />
        <select className={inputClass} value={status} onChange={(e) => reset(() => setStatus(e.target.value))} aria-label="Trạng thái lô">
          <option value="">Mọi trạng thái lô</option>
          {Object.entries(LOT_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <ErrorNote error={stock.error} />
      {stock.data && stock.data.rows.length === 0 && <Empty>Chưa có tồn kho phù hợp.</Empty>}
      {stock.data && stock.data.rows.length > 0 && (
        <>
          <Table head={["Vật tư", "Lô / Lô NSX", "Trạng thái", "Hạn dùng", "Kho · Vị trí", "Tồn", "Giữ chỗ", "Khả dụng"]}>
            {stock.data.rows.map((r) => (
              <tr key={r.id}>
                <td className="py-2 pr-3">
                  <div className="font-semibold">{r.item_code}</div>
                  <div className="text-slate-500 dark:text-slate-400">{r.item_name}</div>
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {r.lot_id ? (
                    <button className="font-mono text-sky-700 dark:text-sky-400 underline underline-offset-2 cursor-pointer" onClick={() => setLotId(r.lot_id)} title="Xem lô, QC và thao tác chất lượng">
                      {r.lot_code}
                    </button>
                  ) : (
                    <div className="font-mono">—</div>
                  )}
                  <div className="text-slate-500 dark:text-slate-400">{r.mfr_lot_no ?? ""}</div>
                </td>
                <td className="py-2 pr-3">{r.lot_status ? <StatusBadge status={r.lot_status} /> : "—"}{r.incubation_until && <div className="text-[11px] text-amber-700 dark:text-amber-400">Đang ủ đến {fmtDate(r.incubation_until)}</div>}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(r.expiry_date)}</td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {r.warehouse_code} · {r.location_code}
                  {r.is_quarantine && <span className="ml-1 text-amber-600 dark:text-amber-400">(biệt trữ)</span>}
                </td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">
                  {fmtQty(r.qty_on_hand)} {r.base_uom}
                </td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">{fmtQty(r.qty_reserved)}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap font-semibold">{fmtQty(r.qty_available)}</td>
              </tr>
            ))}
          </Table>
          <Pager page={stock.data.page} pageSize={stock.data.page_size} total={stock.data.total} onPage={setPage} />
        </>
      )}
    </Card>
    </>
  );
}

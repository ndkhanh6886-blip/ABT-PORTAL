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
}

export function StockView({ warehouses }: { warehouses: { id: string; code: string; name: string }[] }) {
  const [warehouseId, setWarehouseId] = useState("");
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
    <Card title="Tồn kho theo lô và vị trí">
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
                <td className="py-2 pr-3">{r.lot_status ? <StatusBadge status={r.lot_status} /> : "—"}</td>
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

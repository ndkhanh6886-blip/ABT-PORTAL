"use client";

import React, { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, fmtDate, fmtQty } from "../api";
import { Button, ErrorNote, Field, inputClass, Table } from "../ui";

export interface OrderLine {
  id: string;
  line_no: number;
  kd_item_code: string;
  kd_item_name: string | null;
  kd_unit: string | null;
  item_id: string | null;
  item_code: string | null;
  base_uom: string | null;
  kd_unit_factor: string | null;
  qty: string;
  qty_delivered: string;
}
interface StockRow { id: string; item_id: string; location_id: string; lot_id: string | null; lot_code: string | null; lot_status: string | null; expiry_date: string | null; location_code: string; is_quarantine: boolean; qty_available: string }
interface Pick { stockId: string; qty: string }

function LineStock({ warehouseId, line, pick, onPick }: { warehouseId: string; line: OrderLine; pick?: Pick; onPick: (p: Pick | undefined) => void }) {
  const stock = useQuery({
    queryKey: ["factory", "stock", "ship", warehouseId, line.item_code],
    queryFn: () => api<{ rows: StockRow[] }>(`/api/factory/inv/stock?warehouse_id=${warehouseId}&status=RELEASED&page_size=50&q=${encodeURIComponent(line.item_code ?? "")}`),
    enabled: Boolean(warehouseId && line.item_code),
  });
  const rows = stock.data?.rows.filter((r) => r.item_id === line.item_id && !r.is_quarantine) ?? [];
  const open = Number(line.qty) - Number(line.qty_delivered);
  return (
    <tr>
      <td className="py-2 pr-3">{line.kd_item_code} → {line.item_code ?? <span className="text-rose-600">chưa gắn mã</span>}</td>
      <td className="py-2 pr-3 whitespace-nowrap">{fmtQty(open)} {line.kd_unit}</td>
      <td className="py-2 pr-3 min-w-64">
        <select className={inputClass} value={pick?.stockId ?? ""} onChange={(e) => onPick(e.target.value ? { stockId: e.target.value, qty: pick?.qty ?? String(open) } : undefined)}>
          <option value="">— không giao dòng này —</option>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              Lô {r.lot_code ?? "—"} · {r.location_code} · HSD {fmtDate(r.expiry_date)} · còn {fmtQty(Number(r.qty_available) / Number(line.kd_unit_factor || 1))} {line.kd_unit}
            </option>
          ))}
        </select>
        <ErrorNote error={stock.error} />
      </td>
      <td className="py-2 pr-3 w-28">{pick && <input className={inputClass} inputMode="decimal" value={pick.qty} onChange={(e) => onPick({ ...pick, qty: e.target.value })} />}</td>
    </tr>
  );
}

/** Ships released, unexpired lots from the department's own warehouse (quantities in the Kinh doanh unit). */
export function ShipmentForm({
  orderId,
  orgUnitId,
  lines,
  onDone,
}: {
  orderId: string;
  orgUnitId: string;
  lines: OrderLine[];
  onDone: () => void;
}) {
  const warehouses = useQuery({
    queryKey: ["factory", "warehouses"],
    queryFn: () => api<{ id: string; code: string; name: string; owner_org_unit_id: string }[]>("/api/factory/master/warehouses"),
  });
  const own = warehouses.data?.filter((w) => w.owner_org_unit_id === orgUnitId) ?? [];
  const [warehouseId, setWarehouseId] = useState("");
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const ship = useMutation({
    mutationFn: async () => {
      const chosen = Object.entries(picks);
      const lookup = await api<{ rows: StockRow[] }>(`/api/factory/inv/stock?warehouse_id=${warehouseId}&status=RELEASED&page_size=200`);
      const byId = new Map(lookup.rows.map((r) => [r.id, r]));
      return api("/api/factory/intake/shipments", {
        method: "POST",
        idempotent: true,
        json: {
          order_id: orderId,
          warehouse_id: warehouseId,
          lines: chosen.map(([order_line_id, p]) => {
            const r = byId.get(p.stockId);
            if (!r) throw new Error("Tồn kho vừa thay đổi. Chọn lại lô.");
            return { order_line_id, lot_id: r.lot_id, from_location_id: r.location_id, qty: Number(p.qty.replace(",", ".")) };
          }),
        },
      });
    },
    onSuccess: onDone,
  });
  const open = lines.filter((l) => Number(l.qty_delivered) < Number(l.qty));

  return (
    <form className="flex flex-col gap-2 p-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/30" onSubmit={(e) => { e.preventDefault(); ship.mutate(); }}>
      <div className="text-xs font-bold">Xuất giao hàng — chỉ lô đã giải phóng, còn hạn, từ kho của phòng.</div>
      <Field label="Kho xuất">
        <select className={`${inputClass} sm:w-72`} value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setPicks({}); }} required>
          <option value="">Chọn kho thành phẩm của phòng</option>
          {own.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
        </select>
      </Field>
      {warehouseId && (
        <Table head={["Mã hàng KD → nhà máy", "Còn phải giao", "Lô / vị trí", "SL giao (ĐV KD)"]}>
          {open.map((l) => (
            <LineStock
              key={l.id}
              warehouseId={warehouseId}
              line={l}
              pick={picks[l.id]}
              onPick={(p) => {
                const next = { ...picks };
                if (p) next[l.id] = p;
                else delete next[l.id];
                setPicks(next);
              }}
            />
          ))}
        </Table>
      )}
      <ErrorNote error={ship.error ?? warehouses.error} />
      <div><Button type="submit" disabled={ship.isPending || !Object.keys(picks).length}>{ship.isPending ? "Đang xuất…" : "Xuất giao hàng"}</Button></div>
    </form>
  );
}

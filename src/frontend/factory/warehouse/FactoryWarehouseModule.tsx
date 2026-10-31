"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, FileStack, ListTree, Network, Warehouse } from "lucide-react";
import { api, useFactoryMe } from "../api";
import { Empty, ErrorNote } from "../ui";
import { DocumentsView } from "./DocumentsView";
import { ItemsView } from "./ItemsView";
import { StockView } from "./StockView";
import { WarehouseHubView } from "./WarehouseHubView";
import { WarehousesView, type WarehouseRow } from "./WarehousesView";

type SubTab = "hub" | "stock" | "documents" | "items" | "warehouses";

/** "Kho Nhà Máy": stock of the factory warehouses, fully separate from the Kinh doanh warehouse. */
export function FactoryWarehouseModule() {
  const me = useFactoryMe();
  const perms = new Set(me.data?.permissions ?? []);
  const warehouses = useQuery({
    queryKey: ["factory", "warehouses"],
    queryFn: () => api<WarehouseRow[]>("/api/factory/master/warehouses"),
    enabled: me.isSuccess,
  });
  const tabs: { key: SubTab; label: string; icon: React.ElementType; show: boolean }[] = [
    { key: "hub", label: "1. Điều phối 6 Kho & FEFO", icon: Network, show: perms.has("inv.stock.view") },
    { key: "stock", label: "2. Tồn kho theo lô", icon: Boxes, show: perms.has("inv.stock.view") },
    { key: "documents", label: "3. Phiếu Nhập / Xuất / Chuyển", icon: FileStack, show: perms.has("inv.stock.view") },
    { key: "items", label: "4. Danh mục vật tư", icon: ListTree, show: perms.has("master.data.view") || perms.has("master.item.manage") },
    { key: "warehouses", label: "5. Cấu hình Kho & Vị trí", icon: Warehouse, show: perms.has("inv.stock.view") || perms.has("master.warehouse.manage") },
  ];
  const visible = tabs.filter((t) => t.show);
  const [tab, setTab] = useState<SubTab | null>(null);
  // warehouse chosen on the hub ("Chi tiết →" / the card): the stock tab opens filtered on it
  const [stockWarehouse, setStockWarehouse] = useState("");
  const active = visible.find((t) => t.key === tab)?.key ?? visible[0]?.key;

  if (me.isLoading) return <div className="text-sm text-slate-400 p-6">Đang tải…</div>;
  if (me.error) return <ErrorNote error={me.error} />;
  if (!visible.length) return <Empty>Bạn chưa được cấp quyền nào trong Kho Nhà Máy. Liên hệ trưởng phòng hoặc quản trị viên.</Empty>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5">
        {visible.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer transition-colors ${
              active === t.key ? "bg-sky-700 text-white" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>
      {active === "hub" && <WarehouseHubView onOpenStock={(id) => { setStockWarehouse(id); setTab("stock"); }} />}
      {active === "stock" && <StockView key={stockWarehouse} warehouses={warehouses.data ?? []} initialWarehouseId={stockWarehouse} />}
      {active === "documents" && <DocumentsView warehouses={warehouses.data ?? []} canCreate={perms.has("inv.document.create") && perms.has("inv.document.post")} />}
      {active === "items" && <ItemsView canManage={perms.has("master.item.manage")} />}
      {active === "warehouses" && <WarehousesView warehouses={warehouses.data ?? []} canManage={perms.has("master.warehouse.manage")} error={warehouses.error} />}
    </div>
  );
}

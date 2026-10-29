"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, Building2, ListTree, Warehouse } from "lucide-react";
import { api, useFactoryMe } from "../api";
import { Empty, ErrorNote } from "../ui";
import { ItemsView } from "./ItemsView";
import { OrgUnitsView } from "./OrgUnitsView";
import { StockView } from "./StockView";
import { WarehousesView, type WarehouseRow } from "./WarehousesView";

type SubTab = "stock" | "items" | "warehouses" | "org";

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
    { key: "stock", label: "Tồn kho theo lô", icon: Boxes, show: perms.has("inv.stock.view") },
    { key: "items", label: "Danh mục vật tư", icon: ListTree, show: perms.has("master.data.view") || perms.has("master.item.manage") },
    { key: "warehouses", label: "Kho & vị trí", icon: Warehouse, show: perms.has("inv.stock.view") || perms.has("master.warehouse.manage") },
    { key: "org", label: "Cơ cấu tổ chức", icon: Building2, show: perms.has("core.org.manage") },
  ];
  const visible = tabs.filter((t) => t.show);
  const [tab, setTab] = useState<SubTab | null>(null);
  const active = visible.find((t) => t.key === tab)?.key ?? visible[0]?.key;

  if (me.isLoading) return <div className="text-sm text-slate-400 p-6">Đang tải…</div>;
  if (me.error) return <ErrorNote error={me.error} />;
  if (!visible.length) return <Empty>Bạn chưa được cấp quyền nào trong Kho Nhà Máy. Liên hệ trưởng phòng hoặc quản trị viên.</Empty>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1">
        {visible.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer transition-colors ${
              active === t.key ? "bg-sky-700 text-white" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>
      {active === "stock" && <StockView warehouses={warehouses.data ?? []} />}
      {active === "items" && <ItemsView canManage={perms.has("master.item.manage")} />}
      {active === "warehouses" && <WarehousesView warehouses={warehouses.data ?? []} canManage={perms.has("master.warehouse.manage")} error={warehouses.error} />}
      {active === "org" && <OrgUnitsView />}
    </div>
  );
}

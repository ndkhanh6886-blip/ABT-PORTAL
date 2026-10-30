"use client";

import React, { useState } from "react";
import { Calculator, ClipboardList, Combine, Beaker, FlaskConical, ListChecks, ListTree, Microscope, Settings2, Truck } from "lucide-react";
import { useFactoryMe } from "../api";
import { Empty } from "../ui";
import { BatchesView } from "./BatchesView";
import { CalculatorView } from "./CalculatorView";
import { CatalogView } from "./CatalogView";
import { DeliveryView } from "./DeliveryView";
import { EquipmentView } from "./EquipmentView";
import { InstrumentsView } from "./InstrumentsView";
import { PostProcessView } from "./PostProcessView";
import { SopConfigView } from "./SopConfigView";
import { PreparationView } from "../prep/PreparationView";
import { OligoOrdersView } from "./OligoOrdersView";
import { PoolsView } from "./PoolsView";

type SubTab = "orders" | "pools" | "batches" | "post" | "delivery" | "equipment" | "sop" | "prep" | "calc" | "catalog";

/** "Tổng Hợp Oligo": screens of the Oligo department (post-synthesis and QC follow). */
export function FactoryOligoModule() {
  const me = useFactoryMe();
  const perms = new Set(me.data?.permissions ?? []);
  const [tab, setTab] = useState<SubTab>("orders");
  const tabs: { key: SubTab; label: string; icon: React.ElementType }[] = [
    { key: "orders", label: "Đơn Oligo", icon: ClipboardList },
    { key: "pools", label: "Gộp tổng hợp", icon: Combine },
    { key: "batches", label: "Mẻ tổng hợp", icon: FlaskConical },
    { key: "post", label: "Hậu tổng hợp & QC", icon: Microscope },
    { key: "delivery", label: "Nhãn & giao hàng", icon: Truck },
    { key: "equipment", label: "Thiết bị & định mức", icon: Settings2 },
    { key: "sop", label: "Quy trình SOP", icon: ListChecks },
    { key: "prep", label: "Pha chế hóa chất", icon: Beaker },
    { key: "calc", label: "Tính thông số", icon: Calculator },
    { key: "catalog", label: "Danh mục modification", icon: ListTree },
  ];
  if (me.isLoading) return <div className="text-sm text-slate-400 p-6">Đang tải…</div>;
  if (!perms.has("oligo.view")) return <Empty>Bạn chưa có quyền trong phân hệ Tổng hợp Oligo.</Empty>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer transition-colors ${
              tab === t.key ? "bg-sky-700 text-white" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>
      {tab === "orders" && <OligoOrdersView canManage={perms.has("oligo.order.manage")} />}
      {tab === "pools" && <PoolsView canManage={perms.has("oligo.order.manage")} />}
      {tab === "batches" && <BatchesView canManage={perms.has("oligo.batch.manage")} canApplyRules={perms.has("oligo.reagent.manage")} />}
      {tab === "post" && <PostProcessView canManage={perms.has("oligo.post.manage")} canLabel={perms.has("oligo.delivery.manage")} />}
      {tab === "delivery" && <DeliveryView canManage={perms.has("oligo.delivery.manage")} />}
      {tab === "equipment" && (
        <div className="flex flex-col gap-3">
          <EquipmentView canManageAssets={perms.has("asset.manage")} canManageRules={perms.has("oligo.reagent.manage")} canManageCatalog={perms.has("oligo.catalog.manage")} canOperate={perms.has("oligo.batch.manage")} />
          <InstrumentsView canManage={perms.has("asset.manage")} canOperate={perms.has("asset.operate")} />
        </div>
      )}
      {tab === "sop" && <SopConfigView canManage={perms.has("oligo.sop.manage")} />}
      {tab === "prep" && <PreparationView canManage={perms.has("prep.formula.manage")} canExecute={perms.has("prep.execute")} />}
      {tab === "calc" && <CalculatorView />}
      {tab === "catalog" && <CatalogView canManage={perms.has("oligo.catalog.manage")} />}
    </div>
  );
}

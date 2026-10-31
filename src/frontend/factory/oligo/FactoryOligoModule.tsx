"use client";

import React, { useState } from "react";
import { ClipboardList, AlertTriangle, Beaker, Dna, FlaskConical, ListChecks, ListTree, Microscope, Settings2 } from "lucide-react";
import { useFactoryMe } from "../api";
import { Empty } from "../ui";
import { AnalysisView } from "./AnalysisView";
import { TraceView } from "./TraceView";
import { IncidentsView } from "../qa/IncidentsView";
import { BatchesView } from "./BatchesView";
import { CatalogView } from "./CatalogView";
import { EquipmentView } from "./EquipmentView";
import { InstrumentsView } from "./InstrumentsView";
import { AssetEventsView } from "./AssetEventsView";
import { ColumnsView } from "./ColumnsView";
import { PostProcessView } from "./PostProcessView";
import { SopConfigView } from "./SopConfigView";
import { PreparationView } from "../prep/PreparationView";
import { OligoOrdersView } from "./OligoOrdersView";
import { DeptMaterialActionBar } from "../warehouse/DeptMaterialActionBar";

type SubTab = "orders" | "analysis" | "batches" | "post" | "equipment" | "rules" | "sop" | "prep" | "quality" | "catalog";

/** "Tổng Hợp Oligo": screens of the Oligo department (post-synthesis and QC follow). */
export function FactoryOligoModule() {
  const me = useFactoryMe();
  const perms = new Set(me.data?.permissions ?? []);
  const [tab, setTab] = useState<SubTab>("orders");
  const tabs: { key: SubTab; label: string; icon: React.ElementType }[] = [
    { key: "orders", label: "Đơn Oligo & Giao hàng", icon: ClipboardList },
    { key: "analysis", label: "Phân tích trình tự", icon: Dna },
    { key: "batches", label: "Mẻ tổng hợp", icon: FlaskConical },
    { key: "post", label: "Hậu tổng hợp & QC", icon: Microscope },
    { key: "quality", label: "Sự cố & Truy vết", icon: AlertTriangle },
    { key: "equipment", label: "Thiết bị", icon: Settings2 },
    { key: "rules", label: "Định mức hóa chất", icon: Beaker },
    { key: "sop", label: "Quy trình SOP", icon: ListChecks },
    { key: "prep", label: "Pha chế", icon: Beaker },
    { key: "catalog", label: "Danh mục Mod", icon: ListTree },
  ];
  if (me.isLoading) return <div className="text-sm text-slate-400 p-6">Đang tải…</div>;
  if (!perms.has("oligo.view")) return <Empty>Bạn chưa có quyền trong phân hệ Tổng hợp Oligo.</Empty>;
  return (
    <div className="flex flex-col gap-3">
      <DeptMaterialActionBar
        moduleKey="OLIGO"
        deptLabel="Tổng hợp Oligo"
        defaultReasonPlaceholder="VD: Hóa chất Amidite / Cột CPG / Dung môi tinh sạch HPLC..."
      />
      <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer transition-colors ${
              tab === t.key ? "bg-sky-700 text-white" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>
      {tab === "orders" && <OligoOrdersView canManage={perms.has("oligo.order.manage")} canDeliver={perms.has("oligo.delivery.manage")} />}
      {tab === "analysis" && <AnalysisView canManageOrders={perms.has("oligo.order.manage")} canManageCatalog={perms.has("oligo.catalog.manage")} />}
      {tab === "batches" && <BatchesView canManage={perms.has("oligo.batch.manage")} canApplyRules={perms.has("oligo.reagent.manage")} />}
      {tab === "post" && <PostProcessView canManage={perms.has("oligo.post.manage")} canLabel={perms.has("oligo.delivery.manage")} />}
      {tab === "quality" && (
        <div className="flex flex-col gap-3">
          <TraceView />
          <IncidentsView canReport={perms.has("qms.deviation.report")} />
        </div>
      )}
      {tab === "equipment" && (
        <div className="flex flex-col gap-3">
          <EquipmentView section="machines" canManageAssets={perms.has("asset.manage")} canManageRules={perms.has("oligo.reagent.manage")} canManageCatalog={perms.has("oligo.catalog.manage")} canOperate={perms.has("oligo.batch.manage")} />
          <InstrumentsView canManage={perms.has("asset.manage")} canOperate={perms.has("asset.operate")} />
          <ColumnsView canManage={perms.has("asset.manage")} />
          <AssetEventsView canPlan={perms.has("asset.operate") || perms.has("asset.manage")} />
        </div>
      )}
      {tab === "rules" && <EquipmentView section="rules" canManageAssets={perms.has("asset.manage")} canManageRules={perms.has("oligo.reagent.manage")} canManageCatalog={perms.has("oligo.catalog.manage")} canOperate={perms.has("oligo.batch.manage")} />}
      {tab === "sop" && <SopConfigView canManage={perms.has("oligo.sop.manage")} />}
      {tab === "prep" && <PreparationView canManage={perms.has("prep.formula.manage")} canExecute={perms.has("prep.execute")} />}
      {tab === "catalog" && <CatalogView canManage={perms.has("oligo.catalog.manage")} />}
    </div>
  );
}

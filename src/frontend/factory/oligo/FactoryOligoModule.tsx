"use client";

import React, { useState } from "react";
import { Calculator, ListTree } from "lucide-react";
import { useFactoryMe } from "../api";
import { Empty } from "../ui";
import { CalculatorView } from "./CalculatorView";
import { CatalogView } from "./CatalogView";

type SubTab = "calc" | "catalog";

/** "Tổng Hợp Oligo": first screens of the Oligo department (orders, synthesis batches and QC follow). */
export function FactoryOligoModule() {
  const me = useFactoryMe();
  const perms = new Set(me.data?.permissions ?? []);
  const [tab, setTab] = useState<SubTab>("calc");
  const tabs: { key: SubTab; label: string; icon: React.ElementType }[] = [
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
      {tab === "calc" && <CalculatorView />}
      {tab === "catalog" && <CatalogView canManage={perms.has("oligo.catalog.manage")} />}
    </div>
  );
}

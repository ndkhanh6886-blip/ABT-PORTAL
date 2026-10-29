"use client";

import React, { useState } from "react";
import { Building, FileText, Inbox, PackageCheck } from "lucide-react";
import { useFactoryMe } from "../api";
import { Empty } from "../ui";
import { InboxView } from "./InboxView";
import { OrdersView } from "./OrdersView";
import { RequestsView } from "./RequestsView";
import { SuppliersView } from "./SuppliersView";

type SubTab = "requests" | "inbox" | "orders" | "suppliers";

/**
 * "Cung Ứng NVL": material purchasing for the factory departments and R&D. Departments raise requests;
 * the purchasing team (different people from Kinh doanh purchasing) turns approved lines into orders;
 * warehouse staff receive into quarantine.
 */
export function FactoryPurchaseModule() {
  const me = useFactoryMe();
  const perms = new Set(me.data?.permissions ?? []);
  const [tab, setTab] = useState<SubTab | null>(null);
  const [openPo, setOpenPo] = useState<string | null>(null);
  const tabs: { key: SubTab; label: string; icon: React.ElementType; show: boolean }[] = [
    { key: "requests", label: "Đề nghị mua", icon: FileText, show: perms.has("purchase.pr.create") || perms.has("purchase.pr.view") || perms.has("purchase.pr.approve") },
    { key: "inbox", label: "Chờ đặt hàng", icon: Inbox, show: perms.has("purchase.po.manage") },
    { key: "orders", label: "Đơn mua & nhận hàng", icon: PackageCheck, show: perms.has("purchase.po.view") || perms.has("purchase.po.manage") || perms.has("purchase.receipt.post") },
    { key: "suppliers", label: "Nhà cung cấp", icon: Building, show: perms.has("master.partner.manage") || perms.has("purchase.po.manage") },
  ];
  const visible = tabs.filter((t) => t.show);
  const active = visible.find((t) => t.key === tab)?.key ?? visible[0]?.key;

  if (me.isLoading) return <div className="text-sm text-slate-400 p-6">Đang tải…</div>;
  if (!visible.length) return <Empty>Bạn chưa có quyền trong Cung Ứng NVL.</Empty>;
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
      {active === "requests" && <RequestsView />}
      {active === "inbox" && <InboxView onCreated={(id) => { setOpenPo(id); setTab("orders"); }} />}
      {active === "orders" && <OrdersView openId={openPo} onOpen={setOpenPo} />}
      {active === "suppliers" && <SuppliersView canManage={perms.has("master.partner.manage")} />}
    </div>
  );
}

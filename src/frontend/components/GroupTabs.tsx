"use client";

import React from "react";
import { Briefcase, Factory, FlaskConical, Package, Settings, ShoppingCart } from "lucide-react";
import { useAuth } from "@/frontend/contexts/AuthContext";
import { useFactoryMe } from "@/frontend/factory/api";
import type { MainTab } from "./Navbar";

interface Item {
  tab: MainTab;
  label: string;
  icon: React.ElementType;
  show: boolean;
}

function SectionTabs({ title, items, active, onChange }: { title: string; items: Item[]; active: MainTab; onChange: (t: MainTab) => void }) {
  const visible = items.filter((i) => i.show);
  if (visible.length < 2) return null;
  return (
    <div className="mb-3 flex items-center gap-2 overflow-x-auto no-scrollbar rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1">
      <span className="hidden sm:block px-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400 whitespace-nowrap">{title}</span>
      {visible.map((i) => (
        <button
          key={i.tab}
          onClick={() => onChange(i.tab)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer transition-colors ${
            active === i.tab ? "bg-orange-600 text-white" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
        >
          <i.icon className="w-3.5 h-3.5" />
          {i.label}
        </button>
      ))}
    </div>
  );
}

export const BUSINESS_TABS: MainTab[] = ["sales", "warehouse", "application", "procurement"];
export const SETTINGS_TABS: MainTab[] = ["settings", "factory-settings"];

/** "Khối Kinh Doanh": Kinh doanh, Quản lý kho, Application and Cung ứng under one Navbar entry. */
export function BusinessTabs({ active, onChange }: { active: MainTab; onChange: (t: MainTab) => void }) {
  const { can } = useAuth();
  return (
    <SectionTabs
      title="Khối Kinh Doanh"
      active={active}
      onChange={onChange}
      items={[
        { tab: "sales", label: "Kinh Doanh", icon: Briefcase, show: can("sales.view") },
        { tab: "warehouse", label: "Quản Lý Kho", icon: Package, show: can("warehouse.view") },
        { tab: "application", label: "Application", icon: FlaskConical, show: can("application.view") },
        { tab: "procurement", label: "Cung Ứng", icon: ShoppingCart, show: can("procurement.view") },
      ]}
    />
  );
}

/** "Cấu Hình": the general ABT Portal settings and the factory settings (PIN, roles, org structure). */
export function SettingsTabs({ active, onChange }: { active: MainTab; onChange: (t: MainTab) => void }) {
  const { can } = useAuth();
  const me = useFactoryMe();
  return (
    <SectionTabs
      title="Cấu Hình"
      active={active}
      onChange={onChange}
      items={[
        { tab: "settings", label: "Cấu hình chung", icon: Settings, show: can("settings.view") },
        { tab: "factory-settings", label: "Cấu hình Nhà Máy", icon: Factory, show: Boolean(me.data?.permissions.length) },
      ]}
    />
  );
}

"use client";

import React from "react";
import {
  BarChart3,
  Briefcase,
  ClipboardList,
  Cpu,
  Factory,
  FileSpreadsheet,
  FlaskConical,
  Microscope,
  Package,
  PackageCheck,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Warehouse,
} from "lucide-react";
import { useAuth } from "@/frontend/contexts/AuthContext";
import { hasAny, useFactoryMe } from "@/frontend/factory/api";
import type { MainTab } from "./Navbar";

interface Item {
  tab: MainTab;
  label: string;
  icon: React.ElementType;
  show: boolean;
}

function SectionTabs({
  title,
  items,
  active,
  onChange,
  activeClass = "bg-orange-600 text-white",
  minItems = 2,
}: {
  title: string;
  items: Item[];
  active: MainTab;
  onChange: (t: MainTab) => void;
  activeClass?: string;
  minItems?: number;
}) {
  const visible = items.filter((i) => i.show);
  if (visible.length < minItems) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5">
      <span className="hidden sm:block px-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400 whitespace-nowrap">{title}</span>
      {visible.map((i) => (
        <a
          key={i.tab}
          href={`/?tab=${i.tab}`}
          onClick={(e) => {
            if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) {
              e.preventDefault();
              onChange(i.tab);
            }
          }}
          title="Giữ Ctrl + Click hoặc Chuột phải -> Mở trong tab mới"
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer transition-colors ${
            active === i.tab ? activeClass : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
        >
          <i.icon className="w-3.5 h-3.5" />
          {i.label}
        </a>
      ))}
    </div>
  );
}

export const BUSINESS_TABS: MainTab[] = ["sales", "warehouse", "application", "procurement"];
export const TECHNICAL_TABS: MainTab[] = [
  "factory-rd",
  "factory-kit",
  "factory-oligo",
  "factory-device",
  "factory-qa",
  "factory-purchase",
  "factory-warehouse",
  "factory-analytics",
  "factory-import",
];
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

/** "Khối Kỹ Thuật": R&D, Sản xuất Kit, Tổng hợp Oligo, Kỹ thuật – Thiết bị, QA/QC, Cung ứng NVL, Kho nhà máy. */
export function TechnicalTabs({ active, onChange }: { active: MainTab; onChange: (t: MainTab) => void }) {
  const me = useFactoryMe();
  return (
    <SectionTabs
      title="Khối Kỹ Thuật"
      active={active}
      onChange={onChange}
      activeClass="bg-sky-700 text-white"
      minItems={1}
      items={[
        { tab: "factory-rd", label: "Nghiên Cứu R&D", icon: Microscope, show: hasAny(me.data, ["rd", "work.plan"]) },
        { tab: "factory-kit", label: "Sản Xuất Kit", icon: Package, show: hasAny(me.data, ["kit"]) },
        { tab: "factory-oligo", label: "Tổng Hợp Oligo", icon: FlaskConical, show: hasAny(me.data, ["oligo"]) },
        { tab: "factory-device", label: "Kỹ Thuật – Thiết Bị", icon: Cpu, show: hasAny(me.data, ["device"]) },
        { tab: "factory-qa", label: "QA/QC", icon: ShieldCheck, show: hasAny(me.data, ["qms.qc.view"]) },
        { tab: "factory-purchase", label: "Cung Ứng NVL", icon: PackageCheck, show: hasAny(me.data, ["purchase", "master.partner"]) },
        { tab: "factory-warehouse", label: "Kho Nhà Máy", icon: Warehouse, show: hasAny(me.data, ["inv", "master"]) },
        { tab: "factory-analytics", label: "Phân Tích & Dự Báo", icon: BarChart3, show: Boolean(me.data?.permissions.length) },
        { tab: "factory-import", label: "Nhập Liệu Excel", icon: FileSpreadsheet, show: Boolean(me.data?.permissions.length) },
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

"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Boxes, ClipboardList, ShieldCheck, Wrench } from "lucide-react";
import { api, useFactoryMe } from "../api";
import { Empty, ErrorNote } from "../ui";
import { BomRoutingView } from "./BomRoutingView";
import { OrdersEbrView } from "./OrdersEbrView";
import { QualityTraceView } from "./QualityTraceView";
import { DepartmentEquipmentView } from "../asset/DepartmentEquipmentView";
import { DeptMaterialActionBar } from "../warehouse/DeptMaterialActionBar";
import type { KitOptions } from "./shared";

const EMPTY_OPTIONS: KitOptions = {
  units: [],
  warehouses: [],
  items: [],
  assets: [],
  lots: [],
};

type TabKey = "orders" | "bom" | "quality" | "equipment";

export default function FactoryKitModule() {
  const me = useFactoryMe();
  const perms = new Set(me.data?.permissions ?? []);
  const [tab, setTab] = useState<TabKey>("orders");
  const [focusOrderId, setFocusOrderId] = useState<string>("");
  const [options, setOptions] = useState<KitOptions>(EMPTY_OPTIONS);
  const [error, setError] = useState<unknown>(null);

  const loadOptions = useCallback(async () => {
    setError(null);
    try {
      const res = await api<KitOptions>("/api/factory/kit/options");
      setOptions(res);
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  const tabs: { key: TabKey; label: string; icon: React.ElementType }[] = [
    { key: "orders", label: "1. Lệnh Sản Xuất & EBR", icon: ClipboardList },
    { key: "bom", label: "2. Định Mức BOM, Nhãn & Quy Trình", icon: Boxes },
    { key: "quality", label: "3. Truy Xuất Lô, COA & Độ Ổn Định", icon: ShieldCheck },
    { key: "equipment", label: "4. Thiết Bị & Đề Xuất Bảo Trì", icon: Wrench },
  ];

  if (me.isLoading) return <div className="text-sm text-slate-400 p-6">Đang tải…</div>;
  if (!perms.has("kit.view")) {
    return <Empty>Bạn chưa có quyền trong phân hệ Sản xuất Kit Sinh học Phân tử.</Empty>;
  }

  return (
    <div className="flex flex-col gap-3">
      <DeptMaterialActionBar
        moduleKey="KIT"
        deptLabel="Sản xuất Kit"
        defaultReasonPlaceholder="VD: Bù nguyên vật liệu cho Lệnh sản xuất Kit..."
      />
      <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer transition-colors ${
              tab === t.key
                ? "bg-sky-700 text-white"
                : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      <ErrorNote error={error} />
      {tab === "orders" && (
        <OrdersEbrView
          options={options}
          onRefreshOptions={loadOptions}
          focusOrderId={focusOrderId}
          onClearFocusOrder={() => setFocusOrderId("")}
        />
      )}
      {tab === "bom" && (
        <BomRoutingView
          options={options}
          onRefreshOptions={loadOptions}
          onJumpToOrder={(orderId: string) => {
            setFocusOrderId(orderId);
            setTab("orders");
          }}
        />
      )}
      {tab === "quality" && <QualityTraceView options={options} />}
      {tab === "equipment" && <DepartmentEquipmentView deptCode="P-KIT" deptLabel="Phòng Sản xuất Kit Chẩn đoán" />}
    </div>
  );
}

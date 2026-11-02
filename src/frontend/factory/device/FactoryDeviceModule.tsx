"use client";

import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Cpu,
  FileCog,
  FlaskConical,
  Hammer,
  ShoppingCart,
  Wrench,
} from "lucide-react";
import { useFactoryMe } from "../api";
import { Empty } from "../ui";
import { DeviceRdTransferView } from "./DeviceRdTransferView";
import { ModelsEcoView } from "./ModelsEcoView";
import { DevicePoMrpView } from "./DevicePoMrpView";
import { AssemblyDhrView } from "./AssemblyDhrView";
import { SubcontractView } from "./SubcontractView";
import { ServiceTicketsView } from "./ServiceTicketsView";
import { IncidentsView } from "../qa/IncidentsView";
import { DeptMaterialActionBar } from "../warehouse/DeptMaterialActionBar";

type TabKey =
  | "rd_transfer"
  | "models"
  | "po_mrp"
  | "assembly"
  | "subcontract"
  | "service"
  | "incidents";

export function FactoryDeviceModule() {
  const me = useFactoryMe();
  const perms = new Set(me.data?.permissions ?? []);
  const [tab, setTab] = useState<TabKey>("rd_transfer");
  const [initialPoId, setInitialPoId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const pendingPoId = window.sessionStorage.getItem("factory_open_device_po_id");
    if (pendingPoId) {
      window.sessionStorage.removeItem("factory_open_device_po_id");
      setInitialPoId(pendingPoId);
      setTab("po_mrp");
    }
    const handleOpenDevicePo = (e: Event) => {
      const custom = e as CustomEvent<{ poId?: string }>;
      if (custom.detail?.poId) {
        setInitialPoId(custom.detail.poId);
      }
      setTab("po_mrp");
    };
    window.addEventListener("factory-open-device-po", handleOpenDevicePo);
    return () => window.removeEventListener("factory-open-device-po", handleOpenDevicePo);
  }, []);

  const tabs: { key: TabKey; label: string; icon: React.ElementType }[] = [
    { key: "rd_transfer", label: "1. R&D & Chuyển giao", icon: FlaskConical },
    { key: "models", label: "2. Model, BOM & ECO", icon: FileCog },
    { key: "po_mrp", label: "3. Đơn PO & Tách PR/Gia công", icon: ShoppingCart },
    { key: "assembly", label: "4. Lệnh lắp ráp & DHR", icon: Cpu },
    { key: "subcontract", label: "5. Gia công ngoài & IQC", icon: Hammer },
    { key: "service", label: "6. Bảo hành & Bảo trì", icon: Wrench },
    { key: "incidents", label: "7. Sự cố & NCR", icon: AlertTriangle },
  ];

  if (me.isLoading) return <div className="text-sm text-slate-400 p-6">Đang tải…</div>;
  if (!perms.has("device.view")) {
    return <Empty>Bạn chưa có quyền trong phân hệ Kỹ thuật – Công nghệ / Thiết bị.</Empty>;
  }

  return (
    <div className="flex flex-col gap-3">
      <DeptMaterialActionBar
        moduleKey="DEVICE"
        deptLabel="Kỹ thuật – Thiết bị"
        defaultReasonPlaceholder="VD: Linh kiện lắp ráp lệnh DHR / Sửa chữa bảo hành..."
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

      {tab === "rd_transfer" && (
        <DeviceRdTransferView onOpenCatalog={() => setTab("models")} />
      )}
      {tab === "models" && (
        <ModelsEcoView
          canManage={perms.has("device.model.manage")}
          canEcoPropose={perms.has("device.eco.propose")}
        />
      )}
      {tab === "po_mrp" && (
        <DevicePoMrpView
          initialPoId={initialPoId}
          onNavigateTab={(target) => {
            setTab(target);
          }}
        />
      )}
      {tab === "assembly" && <AssemblyDhrView />}
      {tab === "subcontract" && <SubcontractView />}
      {tab === "service" && <ServiceTicketsView />}
      {tab === "incidents" && <IncidentsView canReport={perms.has("qms.deviation.report")} />}
    </div>
  );
}

export default FactoryDeviceModule;

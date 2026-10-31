"use client";

import React, { useState } from "react";
import { AlertTriangle, ClipboardCheck, FileWarning, FlaskConical, Microscope, ScrollText, Users, Wrench } from "lucide-react";
import { ProductionPlanView } from "../kit/ProductionPlanView";
import { useFactoryMe } from "../api";
import { Empty } from "../ui";
import { IncidentsView } from "./IncidentsView";
import { NcrView } from "./NcrView";
import { QcMethodsRetentionView } from "./QcMethodsRetentionView";
import { QcTestsView } from "./QcTestsView";
import { ReferenceStandardsView } from "./ReferenceStandardsView";
import { SpecsView } from "./SpecsView";
import { DepartmentEquipmentView } from "../asset/DepartmentEquipmentView";
import { DeptMaterialActionBar } from "../warehouse/DeptMaterialActionBar";

type SubTab = "tests" | "specs" | "standards" | "methods" | "ncr" | "incidents" | "equipment" | "prod_qa";

/** "QA/QC": independent department serving the three production departments and R&D. */
export function FactoryQaModule() {
  const me = useFactoryMe();
  const perms = new Set(me.data?.permissions ?? []);
  const [tab, setTab] = useState<SubTab>("tests");
  const tabs: { key: SubTab; label: string; icon: React.ElementType }[] = [
    { key: "tests", label: "1. Tiếp nhận & Phiếu QC", icon: ClipboardCheck },
    { key: "specs", label: "2. Tiêu chuẩn QC (Specs)", icon: ScrollText },
    { key: "standards", label: "3. Bộ mẫu chuẩn & Panel", icon: FlaskConical },
    { key: "methods", label: "4. Phương pháp & Mẫu lưu", icon: Microscope },
    { key: "incidents", label: "5. Sự cố & CAPA", icon: AlertTriangle },
    { key: "ncr", label: "6. Sai lệch & NCR", icon: FileWarning },
    { key: "equipment", label: "7. Thiết bị Đo & Hiệu chuẩn", icon: Wrench },
    { key: "prod_qa", label: "8. Phân công QA giám sát SX", icon: Users },
  ];
  if (me.isLoading) return <div className="text-sm text-slate-400 p-6">Đang tải…</div>;
  if (!perms.has("qms.qc.view")) return <Empty>Bạn chưa có quyền xem QA/QC. Liên hệ trưởng phòng QA/QC.</Empty>;
  return (
    <div className="flex flex-col gap-3">
      <DeptMaterialActionBar
        moduleKey="QMS"
        deptLabel="QA/QC"
        defaultReasonPlaceholder="VD: Chất chuẩn đối chiếu / Hóa chất kiểm nghiệm QC..."
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
      {tab === "tests" && <QcTestsView />}
      {tab === "prod_qa" && <ProductionPlanView mode="QA" />}
      {tab === "specs" && <SpecsView />}
      {tab === "standards" && <ReferenceStandardsView />}
      {tab === "methods" && <QcMethodsRetentionView />}
      {tab === "ncr" && <NcrView />}
      {tab === "incidents" && <IncidentsView canReport={perms.has("qms.deviation.report")} />}
      {tab === "equipment" && <DepartmentEquipmentView deptCode="P-QA" deptLabel="Phòng Đảm bảo & Kiểm soát Chất lượng (QA/QC)" />}
    </div>
  );
}

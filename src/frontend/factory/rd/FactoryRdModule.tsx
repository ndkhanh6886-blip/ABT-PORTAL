"use client";

import React, { useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  Beaker,
  FolderKanban,
  Lightbulb,
  Microscope,
  TestTubes,
} from "lucide-react";
import { useFactoryMe } from "../api";
import { Empty } from "../ui";
import { IdeasView } from "./IdeasView";
import { ProjectsView } from "./ProjectsView";
import { ElnView } from "./ElnView";
import { SamplesView } from "./SamplesView";
import { TransferView } from "./TransferView";
import { PreparationView } from "../prep/PreparationView";
import { DepartmentEquipmentView } from "../asset/DepartmentEquipmentView";
import { IncidentsView } from "../qa/IncidentsView";
import { DeptMaterialActionBar } from "../warehouse/DeptMaterialActionBar";

type SubTab =
  | "ideas"
  | "projects"
  | "eln"
  | "samples"
  | "transfer"
  | "prep"
  | "equipment";

/** "Nghiên cứu & Phát triển (R&D)": Idea Funnel, Stage-Gate DHF/TPP, ELN, Biobank, Tech Transfer, Software Release. */
export function FactoryRdModule() {
  const me = useFactoryMe();
  const perms = new Set(me.data?.permissions ?? []);
  const [tab, setTab] = useState<SubTab>("projects");

  const tabs: { key: SubTab; label: string; icon: React.ElementType }[] = [
    { key: "ideas", label: "1. Phễu ý tưởng", icon: Lightbulb },
    { key: "projects", label: "2. Dự án Stage-Gate & DHF", icon: FolderKanban },
    { key: "eln", label: "3. Sổ thí nghiệm (ELN)", icon: Microscope },
    { key: "samples", label: "4. Mẫu sinh học (Biobank)", icon: TestTubes },
    { key: "transfer", label: "5. Chuyển giao & Phần mềm", icon: ArrowRightLeft },
    { key: "prep", label: "6. Pha chế R&D", icon: Beaker },
    { key: "equipment", label: "7. Thiết bị & Sự cố", icon: AlertTriangle },
  ];

  if (me.isLoading) return <div className="text-sm text-slate-400 p-6">Đang tải…</div>;
  if (!perms.has("rd.view") && !perms.has("work.plan.submit") && !perms.has("work.plan.approve")) {
    return <Empty>Bạn chưa có quyền trong phân hệ Nghiên cứu & Phát triển (R&D).</Empty>;
  }

  return (
    <div className="flex flex-col gap-3">
      <DeptMaterialActionBar
        moduleKey="RD"
        deptLabel="Nghiên cứu R&D"
        defaultReasonPlaceholder="VD: Phục vụ dự án R&D / Thí nghiệm ELN..."
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

      {tab === "ideas" && (
        <IdeasView
          canPropose={perms.has("rd.idea.propose")}
          canEvaluate={perms.has("rd.idea.evaluate")}
          canApprove={perms.has("rd.idea.approve")}
          canManageProject={perms.has("rd.project.manage")}
        />
      )}
      {tab === "projects" && (
        <ProjectsView
          canManage={perms.has("rd.project.manage")}
          canReviewGate={perms.has("rd.gate.review")}
        />
      )}
      {tab === "eln" && (
        <ElnView
          canWrite={perms.has("rd.eln.write")}
        />
      )}
      {tab === "samples" && (
        <SamplesView canManage={perms.has("rd.sample.manage")} />
      )}
      {tab === "transfer" && (
        <TransferView
          canManage={perms.has("rd.transfer.manage")}
          canAccept={perms.has("rd.transfer.accept")}
        />
      )}
      {tab === "prep" && (
        <PreparationView
          canManage={perms.has("prep.formula.manage")}
          canExecute={perms.has("prep.execute")}
        />
      )}
      {tab === "equipment" && (
        <div className="flex flex-col gap-3">
          <DepartmentEquipmentView deptCode="P-RD" deptLabel="Phòng Nghiên cứu & Phát triển (R&D)" />
          <IncidentsView canReport={perms.has("qms.deviation.report")} />
        </div>
      )}
    </div>
  );
}

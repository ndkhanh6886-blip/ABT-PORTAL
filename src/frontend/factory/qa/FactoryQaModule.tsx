"use client";

import React, { useState } from "react";
import { ClipboardCheck, FileWarning, ScrollText } from "lucide-react";
import { useFactoryMe } from "../api";
import { Empty } from "../ui";
import { NcrView } from "./NcrView";
import { QcTestsView } from "./QcTestsView";
import { SpecsView } from "./SpecsView";

type SubTab = "tests" | "specs" | "ncr";

/** "QA/QC": independent department serving the three production departments. */
export function FactoryQaModule() {
  const me = useFactoryMe();
  const perms = new Set(me.data?.permissions ?? []);
  const [tab, setTab] = useState<SubTab>("tests");
  const tabs: { key: SubTab; label: string; icon: React.ElementType }[] = [
    { key: "tests", label: "Phiếu QC", icon: ClipboardCheck },
    { key: "specs", label: "Tiêu chuẩn QC", icon: ScrollText },
    { key: "ncr", label: "Sai lệch & NCR", icon: FileWarning },
  ];
  if (me.isLoading) return <div className="text-sm text-slate-400 p-6">Đang tải…</div>;
  if (!perms.has("qms.qc.view")) return <Empty>Bạn chưa có quyền xem QA/QC. Liên hệ trưởng phòng QA/QC.</Empty>;
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
      {tab === "tests" && <QcTestsView />}
      {tab === "specs" && <SpecsView />}
      {tab === "ncr" && <NcrView />}
    </div>
  );
}

"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, FileWarning, ScrollText } from "lucide-react";
import { api, fmtDate, useFactoryMe } from "../api";
import { Card, Empty, ErrorNote, StatusBadge, Table } from "../ui";
import { QcTestsView } from "./QcTestsView";
import { SpecsView } from "./SpecsView";

type SubTab = "tests" | "specs" | "ncr";

interface NcrRow {
  id: string;
  code: string;
  status: string;
  disposition: string;
  description: string;
  created_at: string;
  deviation_code: string | null;
  severity: string | null;
  lot_code: string | null;
  item_code: string | null;
}

function NcrView() {
  const list = useQuery({ queryKey: ["factory", "ncrs"], queryFn: () => api<NcrRow[]>("/api/factory/qms/ncrs") });
  return (
    <Card title="Sai lệch và NCR">
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
        NCR tự mở khi phiếu QC không đạt hoặc khi loại lô. Quy trình đề xuất / duyệt hướng xử lý (hủy, làm lại, chấp nhận đặc cách…) và CAPA sẽ được bổ sung ở bước tiếp theo.
      </p>
      <ErrorNote error={list.error} />
      {list.data?.length === 0 && <Empty>Chưa có NCR nào.</Empty>}
      {list.data && list.data.length > 0 && (
        <Table head={["NCR", "Sai lệch", "Mức độ", "Lô / vật tư", "Mô tả", "Trạng thái", "Ngày"]}>
          {list.data.map((n) => (
            <tr key={n.id}>
              <td className="py-2 pr-3 font-mono font-semibold">{n.code}</td>
              <td className="py-2 pr-3 font-mono">{n.deviation_code ?? "—"}</td>
              <td className="py-2 pr-3">{n.severity ?? "—"}</td>
              <td className="py-2 pr-3">{n.lot_code ? `${n.lot_code} · ${n.item_code}` : "—"}</td>
              <td className="py-2 pr-3">{n.description}</td>
              <td className="py-2 pr-3"><StatusBadge status={n.status === "CLOSED" ? "RELEASED" : "ON_HOLD"} label={n.status === "CLOSED" ? "Đã đóng" : "Đang mở"} /></td>
              <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(n.created_at)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

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

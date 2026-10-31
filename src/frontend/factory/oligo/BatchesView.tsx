"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, fmtDate } from "../api";
import { Button, Card, Empty, ErrorNote, inputClass, StatusBadge, Table } from "../ui";
import { BatchPanel } from "./BatchPanel";
import { BatchPlanForm } from "./BatchPlanForm";
import { ConsumptionReports } from "./ConsumptionReports";
import { BATCH_STATUS } from "./shared";

interface Row { id: string; code: string; status: string; program_name: string | null; synthesizer_code: string; synthesizer_name: string; position_count: number; created_at: string; started_at: string | null }

export function BatchesView({ canManage, canApplyRules }: { canManage: boolean; canApplyRules: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  const [status, setStatus] = useState("");
  const list = useQuery({ queryKey: ["factory", "oligo-batches", status], queryFn: () => api<Row[]>(`/api/factory/oligo/batches${status ? `?status=${status}` : ""}`) });
  return (
    <div className="flex flex-col gap-3">
      {selected && <BatchPanel key={selected} id={selected} onClose={() => setSelected(null)} />}
      <Card
        title="Mẻ tổng hợp"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canManage && (
              <Button onClick={() => setShowPlan((v) => !v)}>
                {showPlan ? "Đóng lập mẻ" : "+ Lập mẻ tổng hợp"}
              </Button>
            )}
            <select className={`${inputClass} w-44`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Trạng thái">
              <option value="">Mọi trạng thái</option>
              {Object.entries(BATCH_STATUS).map(([k, [, v]]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        }
      >
        {canManage && showPlan && (
          <BatchPlanForm
            onCreated={(id) => {
              setShowPlan(false);
              setSelected(id);
            }}
          />
        )}
        <ErrorNote error={list.error} />
        {list.data?.length === 0 && <Empty>Chưa có mẻ tổng hợp.</Empty>}
        {list.data && list.data.length > 0 && (
          <Table head={["Mã mẻ", "Máy", "Chương trình", "Số vị trí", "Lập ngày", "Trạng thái"]}>
            {list.data.map((b) => (
              <tr key={b.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setSelected(b.id)}>
                <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{b.code}</td>
                <td className="py-2 pr-3 text-xs">{b.synthesizer_code} · {b.synthesizer_name}</td>
                <td className="py-2 pr-3 text-xs">{b.program_name ?? "—"}</td>
                <td className="py-2 pr-3 text-right">{b.position_count}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(b.created_at)}</td>
                <td className="py-2 pr-3"><StatusBadge status={BATCH_STATUS[b.status][0]} label={BATCH_STATUS[b.status][1]} /></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <ConsumptionReports canApply={canApplyRules} />
    </div>
  );
}

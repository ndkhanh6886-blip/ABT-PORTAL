"use client";

import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, fmtDate } from "../api";
import { Button, Card, Empty, ErrorNote, inputClass, StatusBadge, Table } from "../ui";
import { BatchPanel } from "./BatchPanel";
import { BatchPlanForm } from "./BatchPlanForm";
import { ConsumptionReports } from "./ConsumptionReports";
import { BATCH_STATUS } from "./shared";

interface Row {
  id: string;
  code: string;
  status: string;
  program_name: string | null;
  synthesizer_code: string;
  synthesizer_name: string;
  position_count: number;
  order_codes?: string[];
  created_at: string;
  started_at: string | null;
}

export function BatchesView({ canManage, canApplyRules }: { canManage: boolean; canApplyRules: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [showPlan, setShowPlan] = useState(true);
  const [status, setStatus] = useState("");
  const [orderFilter, setOrderFilter] = useState("");
  const list = useQuery({ queryKey: ["factory", "oligo-batches", status], queryFn: () => api<Row[]>(`/api/factory/oligo/batches${status ? `?status=${status}` : ""}`) });

  const allOrders = useMemo(() => {
    const set = new Set<string>();
    for (const b of list.data ?? []) {
      for (const oc of b.order_codes ?? []) if (oc) set.add(oc);
    }
    return Array.from(set).sort();
  }, [list.data]);

  const filteredBatches = useMemo(() => {
    const rows = list.data ?? [];
    if (!orderFilter) return rows;
    return rows.filter((b) => (b.order_codes ?? []).includes(orderFilter));
  }, [list.data, orderFilter]);

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
            {allOrders.length > 0 && (
              <select
                className={`${inputClass} w-44`}
                value={orderFilter}
                onChange={(e) => setOrderFilter(e.target.value)}
                aria-label="Lọc mẻ theo đơn hàng"
              >
                <option value="">Mọi đơn hàng</option>
                {allOrders.map((oc) => (
                  <option key={oc} value={oc}>Đơn {oc}</option>
                ))}
              </select>
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
        {filteredBatches.length === 0 && <Empty>Chưa có mẻ tổng hợp.</Empty>}
        {filteredBatches.length > 0 && (
          <Table head={["Mã mẻ", "Đơn hàng", "Máy", "Chương trình", "Số vị trí", "Lập ngày", "Trạng thái"]}>
            {filteredBatches.map((b) => (
              <tr key={b.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setSelected(b.id)}>
                <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{b.code}</td>
                <td className="py-2 pr-3 font-mono text-xs">{(b.order_codes ?? []).length > 0 ? (b.order_codes ?? []).join(", ") : "—"}</td>
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

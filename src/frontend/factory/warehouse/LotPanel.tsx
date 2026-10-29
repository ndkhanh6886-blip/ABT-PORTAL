"use client";

import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate, fmtQty, useFactoryMe } from "../api";
import { PutAway } from "./PutAway";
import { Button, Card, ErrorNote, StatusBadge } from "../ui";

interface LotDetail {
  id: string;
  code: string;
  item_code: string;
  item_name: string;
  mfr_lot_no: string | null;
  status: string;
  expiry_date: string | null;
  mfg_date: string | null;
  received_date: string;
  origin: string;
  version: number;
  balances: { location_id: string; location_code: string; is_quarantine: boolean; warehouse_id: string; warehouse_code: string; qty_on_hand: string; qty_reserved: string }[];
  qc_tests: { id: string; code: string; test_kind: string; status: string; overall_result: string | null; created_at: string }[];
  actions: AllowedAction[];
}

export const LOT_ACTION_LABEL: Record<string, string> = {
  sample: "Lấy mẫu QC",
  release: "Giải phóng lô",
  hold: "Tạm giữ",
  unhold: "Gỡ tạm giữ",
  reject: "Loại lô",
};
const QC_STATUS: Record<string, string> = {
  PLANNED: "Chờ kiểm nghiệm",
  IN_PROGRESS: "Đang kiểm nghiệm",
  RESULTS_ENTERED: "Chờ duyệt",
  REVIEWED: "Đã duyệt",
  CANCELLED: "Đã hủy",
};

/** Lot detail: quality status, QC history and the quality actions the user may run (signed where required). */
export function LotPanel({ lotId, onClose }: { lotId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const me = useFactoryMe();
  const lot = useQuery({ queryKey: ["factory", "lot", lotId], queryFn: () => api<LotDetail>(`/api/factory/inv/lots/${lotId}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["factory", "lot", lotId] });
    qc.invalidateQueries({ queryKey: ["factory", "stock"] });
    qc.invalidateQueries({ queryKey: ["factory", "qc-tests"] });
  };
  const l = lot.data;

  return (
    <Card title={l ? `Lô ${l.code} — ${l.item_code} ${l.item_name}` : "Lô"} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <ErrorNote error={lot.error} />
      {l && (
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
            <div><dt className="text-slate-400">Trạng thái</dt><dd><StatusBadge status={l.status} /></dd></div>
            <div><dt className="text-slate-400">Lô NSX</dt><dd className="font-mono">{l.mfr_lot_no ?? "—"}</dd></div>
            <div><dt className="text-slate-400">Ngày SX</dt><dd>{fmtDate(l.mfg_date)}</dd></div>
            <div><dt className="text-slate-400">Hạn dùng</dt><dd>{fmtDate(l.expiry_date)}</dd></div>
            <div><dt className="text-slate-400">Nhận ngày</dt><dd>{fmtDate(l.received_date)}</dd></div>
          </dl>
          <div className="text-xs">
            <b>Tồn theo vị trí:</b>{" "}
            {l.balances.length === 0 ? "không còn tồn" : l.balances.map((b) => `${b.warehouse_code}·${b.location_code}${b.is_quarantine ? " (biệt trữ)" : ""}: ${fmtQty(b.qty_on_hand)}`).join(" · ")}
          </div>
          {l.status === "RELEASED" && me.data?.permissions.includes("inv.document.post") && l.balances.some((b) => b.is_quarantine) && (
            <PutAway lotId={l.id} warehouseId={l.balances.find((b) => b.is_quarantine)!.warehouse_id} onDone={refresh} />
          )}
          <ActionBar endpoint={`/api/factory/inv/lots/${l.id}/actions`} version={l.version} actions={l.actions} labels={LOT_ACTION_LABEL} onDone={refresh} />
          <div>
            <h3 className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">Phiếu QC của lô</h3>
            {l.qc_tests.length === 0 ? (
              <p className="text-xs text-slate-400">Chưa có phiếu QC.</p>
            ) : (
              <ul className="text-xs grid gap-1">
                {l.qc_tests.map((t) => (
                  <li key={t.id} className="flex flex-wrap gap-2 items-center">
                    <span className="font-mono font-semibold">{t.code}</span>
                    <span>{t.test_kind}</span>
                    <span className="text-slate-500">{QC_STATUS[t.status] ?? t.status}</span>
                    {t.overall_result && <StatusBadge status={t.overall_result === "PASS" ? "RELEASED" : "REJECTED"} label={t.overall_result === "PASS" ? "Đạt" : "Không đạt"} />}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";

const DISPOSITION: Record<string, string> = {
  PENDING: "Chưa có",
  SCRAP: "Hủy",
  REWORK: "Làm lại",
  RESYNTHESIZE: "Tổng hợp lại",
  USE_AS_IS: "Chấp nhận đặc cách",
  RETURN_TO_SUPPLIER: "Trả nhà cung cấp",
};
const NCR_STATUS: Record<string, [string, string]> = {
  OPEN: ["ON_HOLD", "Chờ đề xuất xử lý"],
  DISPOSITION_PROPOSED: ["QUARANTINE", "Chờ QA duyệt"],
  PENDING_BOD: ["QUARANTINE", "Chờ BGĐ duyệt đặc cách"],
  APPROVED: ["PENDING_QC", "Đã duyệt, đang xử lý"],
  CLOSED: ["RELEASED", "Đã đóng"],
};
const NCR_ACTIONS = { approve: "QA duyệt", qa_approve_concession: "QA duyệt đặc cách", bod_approve: "BGĐ duyệt đặc cách", reject: "Trả lại đề xuất", close: "Đóng NCR" };
const DEV_ACTIONS = { investigate: "Bắt đầu điều tra", define_action: "Đã xác định hành động", close: "Đóng sai lệch" };

interface NcrRow {
  id: string; code: string; status: string; disposition: string; description: string; created_at: string;
  deviation_code: string | null; severity: string | null; lot_code: string | null; item_code: string | null; item_name: string | null; sequence_code: string | null; sequence_name: string | null;
}
interface NcrDetail extends NcrRow {
  version: number; proposal_note: string | null; proposed_by_name: string | null; approved_by_name: string | null;
  deviation_id: string | null; deviation_status: string | null; deviation_version: number; deviation_description: string | null;
  actions: AllowedAction[]; deviation_actions: AllowedAction[];
}

function ProposeForm({ ncr, onDone }: { ncr: NcrDetail; onDone: () => void }) {
  const [disposition, setDisposition] = useState("");
  const [note, setNote] = useState("");
  const propose = useMutation({
    mutationFn: () => api(`/api/factory/qms/ncrs/${ncr.id}/actions`, { method: "POST", json: { action: "propose", expectedVersion: ncr.version, payload: { disposition, note } } }),
    onSuccess: onDone,
  });
  return (
    <form className="grid gap-2 sm:grid-cols-3 items-end p-3 rounded-xl border border-slate-200 dark:border-slate-800" onSubmit={(e) => { e.preventDefault(); propose.mutate(); }}>
      <Field label="Hướng xử lý *">
        <select className={inputClass} value={disposition} onChange={(e) => setDisposition(e.target.value)} required>
          <option value="">Chọn</option>
          {Object.entries(DISPOSITION).filter(([k]) => k !== "PENDING").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Căn cứ đề xuất *"><input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} required minLength={5} /></Field>
      <Button type="submit" disabled={propose.isPending}>Gửi đề xuất</Button>
      <div className="sm:col-span-3"><ErrorNote error={propose.error} /></div>
    </form>
  );
}

function NcrPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const ncr = useQuery({ queryKey: ["factory", "ncr", id], queryFn: () => api<NcrDetail>(`/api/factory/qms/ncrs/${id}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["factory", "ncr", id] });
    qc.invalidateQueries({ queryKey: ["factory", "ncrs"] });
    qc.invalidateQueries({ queryKey: ["factory", "lot"] });
  };
  const n = ncr.data;
  return (
    <Card title={n ? `NCR ${n.code}` : "NCR"} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <ErrorNote error={ncr.error} />
      {n && (
        <div className="flex flex-col gap-3 text-xs">
          <p>
            <StatusBadge status={NCR_STATUS[n.status][0]} label={NCR_STATUS[n.status][1]} /> · {n.lot_code ? `Lô ${n.lot_code} · ${n.item_code} ${n.item_name}` : n.sequence_code ? `Oligo ${n.sequence_code} · ${n.sequence_name}` : "—"} · Hướng xử lý: <b>{DISPOSITION[n.disposition]}</b>
          </p>
          <p>{n.description}</p>
          {n.proposal_note && <p>Đề xuất ({n.proposed_by_name}): {n.proposal_note}</p>}
          {n.approved_by_name && <p>Người duyệt: {n.approved_by_name}</p>}
          {n.actions.some((a) => a.action === "propose") && <ProposeForm ncr={n} onDone={refresh} />}
          <ActionBar endpoint={`/api/factory/qms/ncrs/${n.id}/actions`} version={n.version} actions={n.actions.filter((a) => a.action !== "propose")} labels={NCR_ACTIONS} onDone={refresh} />
          {n.deviation_id && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-2">
              <p>Sai lệch <b>{n.deviation_code}</b> ({n.severity}) — {n.deviation_status}: {n.deviation_description}</p>
              <ActionBar endpoint={`/api/factory/qms/deviations/${n.deviation_id}/actions`} version={n.deviation_version} actions={n.deviation_actions.filter((a) => a.action !== "define_action")} labels={DEV_ACTIONS} onDone={refresh} />
              {n.deviation_actions.some((a) => a.action === "define_action") && <p className="text-[11px] text-slate-500">Ghi nguyên nhân và CAPA ở tab Sự cố &amp; CAPA.</p>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function NcrView() {
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["factory", "ncrs"], queryFn: () => api<NcrRow[]>("/api/factory/qms/ncrs") });
  return (
    <div className="flex flex-col gap-3">
      {selected && <NcrPanel key={selected} id={selected} onClose={() => setSelected(null)} />}
      <Card title="Sai lệch và NCR">
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          NCR tự mở khi phiếu QC không đạt hoặc khi loại lô. Trưởng bộ phận đề xuất hướng xử lý, QA duyệt có ký; chấp nhận đặc cách cần thêm Ban giám đốc ký.
        </p>
        <ErrorNote error={list.error} />
        {list.data?.length === 0 && <Empty>Chưa có NCR nào.</Empty>}
        {list.data && list.data.length > 0 && (
          <Table head={["NCR", "Sai lệch", "Mức độ", "Lô / vật tư", "Hướng xử lý", "Trạng thái", "Ngày"]}>
            {list.data.map((n) => (
              <tr key={n.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setSelected(n.id)}>
                <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{n.code}</td>
                <td className="py-2 pr-3 font-mono">{n.deviation_code ?? "—"}</td>
                <td className="py-2 pr-3">{n.severity ?? "—"}</td>
                <td className="py-2 pr-3">{n.lot_code ? `${n.lot_code} · ${n.item_code}` : n.sequence_code ? `Oligo ${n.sequence_code}` : "—"}</td>
                <td className="py-2 pr-3">{DISPOSITION[n.disposition] ?? n.disposition}</td>
                <td className="py-2 pr-3"><StatusBadge status={NCR_STATUS[n.status]?.[0] ?? "EXPIRED"} label={NCR_STATUS[n.status]?.[1] ?? n.status} /></td>
                <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(n.created_at)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

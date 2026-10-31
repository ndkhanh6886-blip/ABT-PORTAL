"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";

interface Dev {
  id: string; code: string; title: string | null; severity: string; status: string; description: string; step_ref: string | null; entity_type: string; entity_code: string | null;
  entity_name: string | null; reporter_name: string | null; performer_name: string | null; created_at: string; root_cause: string | null; corrective_action: string | null;
  preventive_action: string | null; action_owner: string | null; action_due: string | null; ncr_code: string | null; version: number; actions: AllowedAction[];
}

const SEVERITY: Record<string, [string, string]> = { LOW: ["EXPIRED", "Thấp"], MEDIUM: ["QUARANTINE", "Trung bình"], HIGH: ["ON_HOLD", "Cao"], CRITICAL: ["REJECTED", "Nghiêm trọng"] };
const STATUS: Record<string, string> = { OPEN: "Mới báo", UNDER_INVESTIGATION: "Đang điều tra", ACTION_DEFINED: "Đã có CAPA", CLOSED: "Đã đóng" };
const SUBJECT: Record<string, string> = { OLIGO_SEQUENCE: "Trình tự", SYNTHESIS_BATCH: "Mẻ tổng hợp", ASSET: "Thiết bị", LOT: "Lô" };

function ReportForm({ onDone, presetCode }: { onDone: () => void; presetCode?: string }) {
  const [f, setF] = useState({ entity_type: "OLIGO_SEQUENCE", entity_code: presetCode ?? "", title: "", severity: "MEDIUM", step_ref: "", description: "", product_affected: false });
  const report = useMutation({
    mutationFn: () => api<{ deviation_id: string }>("/api/factory/qms/deviations", { method: "POST", idempotent: true, json: { ...f, step_ref: f.step_ref || null } }),
    onSuccess: () => {
      setF({ ...f, entity_code: "", title: "", step_ref: "", description: "", product_affected: false });
      onDone();
    },
  });
  return (
    <form className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 items-end mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800" onSubmit={(e) => { e.preventDefault(); report.mutate(); }}>
      <Field label="Đối tượng">
        <select className={inputClass} value={f.entity_type} onChange={(e) => setF({ ...f, entity_type: e.target.value })}>
          {["OLIGO_SEQUENCE", "SYNTHESIS_BATCH", "ASSET"].map((k) => <option key={k} value={k}>{SUBJECT[k]}</option>)}
        </select>
      </Field>
      <Field label="Mã *"><input className={`${inputClass} font-mono`} value={f.entity_code} onChange={(e) => setF({ ...f, entity_code: e.target.value })} required /></Field>
      <Field label="Tiêu đề sự cố *"><input className={inputClass} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></Field>
      <Field label="Mức độ">
        <select className={inputClass} value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>
          {Object.entries(SEVERITY).map(([k, [, v]]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Bước xảy ra"><input className={inputClass} placeholder="vd: Khử bảo vệ, HPLC" value={f.step_ref} onChange={(e) => setF({ ...f, step_ref: e.target.value })} /></Field>
      <label className="flex items-center gap-1 text-xs pb-2"><input type="checkbox" checked={f.product_affected} onChange={(e) => setF({ ...f, product_affected: e.target.checked })} />Sản phẩm bị ảnh hưởng (mở NCR)</label>
      <div className="sm:col-span-3 lg:col-span-5"><Field label="Mô tả chi tiết *"><input className={inputClass} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required /></Field></div>
      <Button type="submit" disabled={report.isPending}>Gửi báo cáo sự cố</Button>
      <div className="sm:col-span-3 lg:col-span-6"><ErrorNote error={report.error} /></div>
    </form>
  );
}

/** The CAPA record of an investigated deviation: root cause, corrective and preventive action, owner, due date. */
function CapaForm({ d, onDone }: { d: Dev; onDone: () => void }) {
  const [f, setF] = useState({ root_cause: "", corrective_action: "", preventive_action: "", action_owner: "", action_due: "" });
  const save = useMutation({
    mutationFn: () =>
      api(`/api/factory/qms/deviations/${d.id}/actions`, {
        method: "POST",
        json: { action: "define_action", expectedVersion: d.version, payload: { ...f, preventive_action: f.preventive_action || null, action_owner: f.action_owner || null, action_due: f.action_due || null } },
      }),
    onSuccess: onDone,
  });
  const serious = ["HIGH", "CRITICAL"].includes(d.severity);
  return (
    <form className="grid gap-2 sm:grid-cols-2 p-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/30" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Field label="Nguyên nhân gốc *"><textarea className={`${inputClass} h-16`} value={f.root_cause} onChange={(e) => setF({ ...f, root_cause: e.target.value })} required /></Field>
      <Field label="Biện pháp khắc phục *"><textarea className={`${inputClass} h-16`} value={f.corrective_action} onChange={(e) => setF({ ...f, corrective_action: e.target.value })} required /></Field>
      <Field label={`Biện pháp phòng ngừa${serious ? " *" : ""}`}><textarea className={`${inputClass} h-16`} value={f.preventive_action} onChange={(e) => setF({ ...f, preventive_action: e.target.value })} required={serious} /></Field>
      <div className="grid gap-2 grid-cols-2 items-end">
        <Field label="Người phụ trách"><input className={inputClass} value={f.action_owner} onChange={(e) => setF({ ...f, action_owner: e.target.value })} /></Field>
        <Field label="Hạn hoàn thành"><input className={inputClass} type="date" value={f.action_due} onChange={(e) => setF({ ...f, action_due: e.target.value })} /></Field>
      </div>
      <div><Button type="submit" disabled={save.isPending}>Lưu CAPA</Button></div>
      <div className="sm:col-span-2"><ErrorNote error={save.error} /></div>
    </form>
  );
}

/** "Sự cố & CAPA" (as OligoFlow's quality incidents): report, investigate, CAPA, signed closure. */
export function IncidentsView({ canReport, presetCode }: { canReport: boolean; presetCode?: string }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState("ACTIVE");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(Boolean(presetCode));
  const list = useQuery({ queryKey: ["factory", "deviations", status, q], queryFn: () => api<Dev[]>(`/api/factory/qms/deviations?status=${status}&q=${encodeURIComponent(q)}`) });
  const refresh = () => {
    setShowReport(false);
    ["deviations", "ncrs", "ncr"].forEach((k) => qc.invalidateQueries({ queryKey: ["factory", k] }));
  };
  return (
    <Card
      title="Sự cố chất lượng & CAPA"
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          {canReport && (
            <Button onClick={() => setShowReport((v) => !v)}>
              {showReport ? "Đóng form báo sự cố" : "+ Báo cáo sự cố"}
            </Button>
          )}
          <input className={`${inputClass} w-48`} placeholder="Tìm mã, tiêu đề…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className={`${inputClass} w-40`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Trạng thái">
            <option value="ACTIVE">Chưa đóng</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      }
    >
      {canReport && showReport && <ReportForm onDone={refresh} presetCode={presetCode} />}
      <ErrorNote error={list.error} />
      {list.data?.length === 0 && <Empty>Không có sự cố.</Empty>}
      {list.data && list.data.length > 0 && (
        <Table head={["Mã", "Sự cố", "Đối tượng / bước", "Mức độ", "Người báo / ngày", "Trạng thái", ""]}>
          {list.data.map((d) => (
            <React.Fragment key={d.id}>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-xs">{d.code}{d.ncr_code && <div className="text-slate-500">NCR {d.ncr_code}</div>}</td>
                <td className="py-1.5 pr-3 text-xs"><b>{d.title ?? "—"}</b><div className="text-slate-500 line-clamp-2">{d.description}</div></td>
                <td className="py-1.5 pr-3 text-xs">{SUBJECT[d.entity_type] ?? d.entity_type} <span className="font-mono">{d.entity_code}</span>{d.step_ref && <div className="text-slate-500">Bước: {d.step_ref}</div>}{d.performer_name && <div className="text-slate-500">Thực hiện: {d.performer_name}</div>}</td>
                <td className="py-1.5 pr-3"><StatusBadge status={SEVERITY[d.severity][0]} label={SEVERITY[d.severity][1]} /></td>
                <td className="py-1.5 pr-3 text-xs whitespace-nowrap">{d.reporter_name ?? ""}<div className="text-slate-500">{fmtDate(d.created_at)}</div></td>
                <td className="py-1.5 pr-3 text-xs">{STATUS[d.status]}</td>
                <td className="py-1.5 pr-3 text-right"><Button variant="ghost" onClick={() => setOpen(open === d.id ? null : d.id)}>{open === d.id ? "Đóng" : "Chi tiết"}</Button></td>
              </tr>
              {open === d.id && (
                <tr>
                  <td colSpan={7} className="pb-3">
                    <div className="flex flex-col gap-2 text-xs">
                      <p className="whitespace-pre-line">{d.description}</p>
                      {d.root_cause && (
                        <div className="grid gap-1 sm:grid-cols-3 p-2 rounded-lg border border-slate-200 dark:border-slate-800">
                          <div><b>Nguyên nhân:</b> {d.root_cause}</div>
                          <div><b>Khắc phục:</b> {d.corrective_action}</div>
                          <div><b>Phòng ngừa:</b> {d.preventive_action ?? "—"}{d.action_owner && ` · ${d.action_owner}`}{d.action_due && ` · hạn ${fmtDate(d.action_due)}`}</div>
                        </div>
                      )}
                      {d.actions.some((a) => a.action === "define_action") && <CapaForm d={d} onDone={() => { setOpen(null); refresh(); }} />}
                      <ActionBar
                        endpoint={`/api/factory/qms/deviations/${d.id}/actions`}
                        version={d.version}
                        actions={d.actions.filter((a) => a.action !== "define_action")}
                        labels={{ investigate: "Bắt đầu điều tra", close: "Đóng sự cố (đã khắc phục)" }}
                        onDone={() => { setOpen(null); refresh(); }}
                      />
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </Table>
      )}
    </Card>
  );
}

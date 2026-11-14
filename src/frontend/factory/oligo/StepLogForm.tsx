"use client";

import React, { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, fmtDate } from "../api";
import { Button, ErrorNote, Field, inputClass, Table } from "../ui";
import type { StepField } from "./SopConfigView";

export interface FrozenStep { step_no: number; method_id: string; name: string; category: string; kind: "STANDARD" | "QUANTIFICATION"; target_hours: number | null; fields: StepField[] }
export interface StepLog { step_no: number; step_name: string; values: Record<string, string | number | null>; performed_at: string; performed_by_name: string | null; stock_document_code: string | null }

interface ColumnOpt { id: string; code: string; name: string; status: string; runs_used: number; design_runs: number }
const useColumns = () => useQuery({ queryKey: ["factory", "lc-columns"], queryFn: () => api<ColumnOpt[]>("/api/factory/assets/columns") });

interface AssetOpt { id: string; code: string; name: string; asset_type: string; status: string; next_calibration_due: string | null }

/** The SOP of a record: steps done (who, when, values) and the next one to do. */
/** Corrects the readings (numbers, text) of a logged step, with a reason; stock-moving fields are not editable. */
function CorrectStep({ seqId, step, log, onDone }: { seqId: string; step: FrozenStep; log: StepLog; onDone: () => void }) {
  const fields = step.fields.filter((f) => f.type === "NUMBER" || f.type === "TEXT");
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, log.values[f.key] == null ? "" : String(log.values[f.key])])));
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: () => api(`/api/factory/oligo/post/${seqId}/correct-step`, { method: "POST", json: { step_no: step.step_no, values, reason } }),
    onSuccess: onDone,
  });
  if (!fields.length) return <span className="text-slate-400">Bước này không có số liệu sửa được.</span>;
  return (
    <form className="flex flex-wrap gap-2 items-end mt-1" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      {fields.map((f) => <label key={f.key} className="text-[11px]">{f.label}<input className={`${inputClass} w-28`} value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} /></label>)}
      <label className="text-[11px]">Lý do sửa *<input className={`${inputClass} w-48`} value={reason} onChange={(e) => setReason(e.target.value)} required /></label>
      <Button type="submit" variant="ghost" disabled={save.isPending}>Lưu sửa</Button>
      {save.error != null && <ErrorNote error={save.error} />}
    </form>
  );
}

export function StepTable({ steps, logs, seqId, canCorrect, onCorrected }: { steps: FrozenStep[]; logs: StepLog[]; seqId?: string; canCorrect?: boolean; onCorrected?: () => void }) {
  const [editing, setEditing] = useState<number | null>(null);
  const assets = useQuery({ queryKey: ["factory", "assets", "P-OLIGO"], queryFn: () => api<AssetOpt[]>("/api/factory/assets?dept=P-OLIGO") });
  const columns = useColumns();
  const show = (f: StepField, v: unknown) => {
    if (v == null || v === "") return null;
    if (f.type === "COLUMN") {
      const c = columns.data?.find((x) => x.id === v);
      return c ? `${c.code} ${c.name}` : String(v);
    }
    if (f.type === "EQUIPMENT") {
      const a = assets.data?.find((x) => x.id === v);
      return a ? `${a.code} ${a.name}` : String(v);
    }
    return `${v}${f.type === "REAGENT" ? ` ${f.uom}` : f.unit ? ` ${f.unit}` : ""}`;
  };
  return (
    <Table head={["Bước", "Phương pháp", "Kết quả ghi", "Người / lúc"]}>
      {steps.map((s) => {
        const l = logs.find((x) => x.step_no === s.step_no);
        return (
          <tr key={s.step_no} className={l ? "" : "text-slate-400"}>
            <td className="py-1.5 pr-3 whitespace-nowrap">{l ? "✓" : "○"} {s.step_no}. {s.name}</td>
            <td className="py-1.5 pr-3 text-xs">{s.category}{s.target_hours ? ` · ${s.target_hours} giờ` : ""}</td>
            <td className="py-1.5 pr-3 text-xs">
              {l ? s.fields.map((f) => show(f, l.values[f.key]) && <div key={f.key}>{f.label}: {show(f, l.values[f.key])}</div>) : "—"}
              {l?.stock_document_code && <div className="text-slate-500">Phiếu xuất {l.stock_document_code}</div>}
            </td>
            <td className="py-1.5 pr-3 text-xs whitespace-nowrap">
              {l ? `${l.performed_by_name ?? ""} · ${new Date(l.performed_at).toLocaleString("vi-VN")}` : ""}
              {l && canCorrect && seqId && <button type="button" className="ml-2 text-sky-700 dark:text-sky-400 underline cursor-pointer" onClick={() => setEditing(editing === s.step_no ? null : s.step_no)}>Sửa</button>}
              {l && editing === s.step_no && seqId && <CorrectStep seqId={seqId} step={s} log={l} onDone={() => { setEditing(null); onCorrected?.(); }} />}
            </td>
          </tr>
        );
      })}
    </Table>
  );
}

/** Form for the next step; `sequenceIds` may hold several sequences at the same step (logged together). */
export function StepLogForm({ step, sequenceIds, odReady, onDone }: { step: FrozenStep; sequenceIds: string[]; odReady: boolean; onDone: () => void }) {
  const assets = useQuery({ queryKey: ["factory", "assets", "P-OLIGO"], queryFn: () => api<AssetOpt[]>("/api/factory/assets?dept=P-OLIGO") });
  const columns = useColumns();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(step.fields.map((f) => [f.key, f.type === "REAGENT" && f.default_qty != null ? String(f.default_qty) : ""]))
  );
  const log = useMutation({
    mutationFn: () =>
      api("/api/factory/oligo/post/steps", {
        method: "POST",
        idempotent: true,
        json: { sequence_ids: sequenceIds, step_no: step.step_no, values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === "" ? null : v])) },
      }),
    onSuccess: onDone,
  });
  return (
    <form className="flex flex-col gap-2 p-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/30" onSubmit={(e) => { e.preventDefault(); log.mutate(); }}>
      <div className="text-xs font-bold">
        Bước {step.step_no}: {step.name}
        {sequenceIds.length > 1 && <span className="font-normal"> — cho {sequenceIds.length} trình tự</span>}
      </div>
      {step.kind === "QUANTIFICATION" && !odReady && <p className="text-[11px] text-amber-700 dark:text-amber-400">Nhập và lưu kết quả đo OD trước khi xác nhận bước này.</p>}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 items-end">
        {step.fields.map((f) => (
          <Field key={f.key} label={`${f.label}${f.required && f.type !== "REAGENT" ? " *" : ""}`} hint={f.type === "REAGENT" ? `${f.uom} / trình tự, trừ kho khi xác nhận` : f.unit ?? undefined}>
            {f.type === "COLUMN" ? (
              <select className={inputClass} value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} required={f.required}>
                <option value="">Chọn cột</option>
                {columns.data?.filter((c) => c.status === "ACTIVE").map((c) => (
                  <option key={c.id} value={c.id}>{c.code} · {c.name} ({c.runs_used}/{c.design_runs} lượt)</option>
                ))}
              </select>
            ) : f.type === "EQUIPMENT" ? (
              <select className={inputClass} value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} required={f.required}>
                <option value="">Chọn thiết bị</option>
                {assets.data?.map((a) => (
                  <option key={a.id} value={a.id} disabled={a.status !== "IN_SERVICE"}>
                    {a.code} · {a.name}{a.next_calibration_due ? ` (HC ${fmtDate(a.next_calibration_due)})` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className={inputClass}
                inputMode={f.type === "TEXT" ? "text" : "decimal"}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                required={f.required && f.type !== "REAGENT"}
              />
            )}
          </Field>
        ))}
      </div>
      <div><Button type="submit" disabled={log.isPending || (step.kind === "QUANTIFICATION" && !odReady)}>Xác nhận hoàn tất bước</Button></div>
      <ErrorNote error={log.error} />
    </form>
  );
}

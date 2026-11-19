"use client";

import React, { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, fmtDate } from "../api";
import { Button, ErrorNote, Field, inputClass, Table } from "../ui";
import { inferEquipmentGroup, type StepField } from "./SopConfigView";

export interface FrozenStep { step_no: number; method_id: string; name: string; category: string; kind: "STANDARD" | "QUANTIFICATION"; target_hours: number | null; fields: StepField[] }
export interface StepLog { step_no: number; step_name: string; values: Record<string, string | number | null>; performed_at: string; performed_by_name: string | null; stock_document_code: string | null }

interface ColumnOpt { id: string; code: string; name: string; status: string; runs_used: number; design_runs: number }
const useColumns = () => useQuery({ queryKey: ["factory", "lc-columns"], queryFn: () => api<ColumnOpt[]>("/api/factory/assets/columns") });

interface AssetOpt {
  id: string;
  code: string;
  name: string;
  asset_type: string;
  equipment_category?: string | null;
  status: string;
  next_calibration_due: string | null;
}

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
  const allAssets = assets.data ?? [];

  const equipmentGroups = React.useMemo(() => {
    const map = new Map<string, AssetOpt[]>();
    for (const a of allAssets) {
      const grp = inferEquipmentGroup(a);
      const list = map.get(grp) ?? [];
      list.push(a);
      map.set(grp, list);
    }
    return Array.from(map.entries());
  }, [allAssets]);

  const [groupFilterByField, setGroupFilterByField] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      step.fields
        .filter((f) => f.type === "EQUIPMENT")
        .map((f) => [f.key, f.equipment_category ?? ""])
    )
  );

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      step.fields.map((f) => [
        f.key,
        f.type === "REAGENT" && f.default_qty != null
          ? String(f.default_qty)
          : f.type === "EQUIPMENT" && f.default_asset_id
            ? String(f.default_asset_id)
            : "",
      ])
    )
  );

  // Tự động chọn thiết bị mặc định (hoặc thiết bị duy nhất của nhóm) khi danh sách thiết bị tải xong
  useEffect(() => {
    if (!allAssets.length) return;
    setValues((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const f of step.fields) {
        if (f.type !== "EQUIPMENT" || next[f.key]) continue;
        // 1. Có default_asset_id từ cấu hình SOP
        if (f.default_asset_id && allAssets.some((a) => a.id === f.default_asset_id)) {
          next[f.key] = f.default_asset_id;
          changed = true;
          continue;
        }
        // 2. Có mã thiết bị lưu trong f.unit từ file Excel import (VD: PO-HIM.01)
        if (f.unit) {
          const byCode = allAssets.find((a) => a.code.toUpperCase() === f.unit!.trim().toUpperCase());
          if (byCode) {
            next[f.key] = byCode.id;
            changed = true;
            continue;
          }
        }
        // 3. Nhóm thiết bị chỉ có 1 thiết bị duy nhất đang sẵn sàng (IN_SERVICE)
        const targetGrp = f.equipment_category || "";
        if (targetGrp) {
          const inGroup = allAssets.filter(
            (a) => inferEquipmentGroup(a) === targetGrp && a.status === "IN_SERVICE"
          );
          if (inGroup.length === 1) {
            next[f.key] = inGroup[0].id;
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [allAssets, step.fields]);

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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
        {step.fields.map((f) => {
          const activeGrp = groupFilterByField[f.key] ?? f.equipment_category ?? "";
          const filteredAssets = activeGrp
            ? allAssets.filter((a) => inferEquipmentGroup(a) === activeGrp)
            : allAssets;

          return (
            <Field
              key={f.key}
              label={`${f.label}${f.required && f.type !== "REAGENT" ? " *" : ""}`}
              hint={
                f.type === "REAGENT"
                  ? `${f.uom} / trình tự, trừ kho khi xác nhận`
                  : f.type === "EQUIPMENT" && activeGrp
                    ? `Nhóm: ${activeGrp} (${filteredAssets.length} máy)`
                    : f.unit ?? undefined
              }
            >
              {f.type === "COLUMN" ? (
                <select className={inputClass} value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} required={f.required}>
                  <option value="">Chọn cột</option>
                  {columns.data?.filter((c) => c.status === "ACTIVE").map((c) => (
                    <option key={c.id} value={c.id}>{c.code} · {c.name} ({c.runs_used}/{c.design_runs} lượt)</option>
                  ))}
                </select>
              ) : f.type === "EQUIPMENT" ? (
                <div className="flex flex-col gap-1">
                  {equipmentGroups.length > 1 && (
                    <select
                      className={`${inputClass} text-xs py-1`}
                      value={activeGrp}
                      aria-label={`Lọc nhóm thiết bị cho ${f.label}`}
                      onChange={(e) => {
                        const nextGrp = e.target.value;
                        setGroupFilterByField((prev) => ({ ...prev, [f.key]: nextGrp }));
                        const grpAssets = nextGrp
                          ? allAssets.filter((a) => inferEquipmentGroup(a) === nextGrp && a.status === "IN_SERVICE")
                          : allAssets.filter((a) => a.status === "IN_SERVICE");
                        if (grpAssets.length === 1) {
                          setValues((prev) => ({ ...prev, [f.key]: grpAssets[0].id }));
                        }
                      }}
                    >
                      <option value="">🔧 Tất cả nhóm thiết bị ({allAssets.length} máy)</option>
                      {equipmentGroups.map(([grp, list]) => (
                        <option key={grp} value={grp}>
                          🔧 Nhóm: {grp} ({list.length} máy)
                        </option>
                      ))}
                    </select>
                  )}
                  <select
                    className={inputClass}
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                    required={f.required}
                  >
                    <option value="">Chọn thiết bị ({filteredAssets.length} máy)</option>
                    {filteredAssets.map((a) => (
                      <option key={a.id} value={a.id} disabled={a.status !== "IN_SERVICE"}>
                        {a.code} · {a.name}{a.next_calibration_due ? ` (HC ${fmtDate(a.next_calibration_due)})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
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
          );
        })}
      </div>
      <div><Button type="submit" disabled={log.isPending || (step.kind === "QUANTIFICATION" && !odReady)}>Xác nhận hoàn tất bước</Button></div>
      <ErrorNote error={log.error} />
    </form>
  );
}

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { QC_STATUS_LABEL } from "../qa/QcTestsView";
import { printWithReprint } from "./labels";
import { PoolAliquotForm } from "./PoolAliquotForm";
import { StepLogForm, StepTable, type FrozenStep, type StepLog } from "./StepLogForm";
import { ColumnsView } from "./ColumnsView";
import { SopConfigView, type StepField } from "./SopConfigView";
import { FORMAT, PURIFICATION, SEQ_STATUS } from "./shared";

interface Row {
  id: string;
  code: string;
  name: string;
  status: string;
  scale_code: string;
  purification: string;
  format: string;
  base_count: number;
  mw: number;
  raw_sequence?: string | null;
  normalized_sequence?: string | null;
  relation?: string | null;
  nmol_per_od?: number | null;
  ug_per_od?: number | null;
  order_code: string | null;
  due_date: string | null;
  post_id?: string | null;
  post_version?: number | null;
  post_status?: string | null;
  a260?: number | null;
  dilution_factor?: number | null;
  path_cm?: number | null;
  stock_volume_ul?: number | null;
  target_conc_um?: number | null;
  tube_count?: number | null;
  od_total: number | null;
  nmol: number | null;
  ug?: number | null;
  resuspend_volume_ul?: number | null;
  od_per_tube?: number | null;
  qc_code: string | null;
  qc_status: string | null;
  qc_result: string | null;
  workflow_id?: string | null;
  workflow_name?: string | null;
  workflow_steps?: FrozenStep[] | null;
  workflow_total_steps?: number;
  workflow_logged_steps?: number;
  last_step_no?: number | null;
  last_step_name?: string | null;
  last_step_values?: Record<string, string | number | null> | null;
  last_step_at?: string | null;
  last_step_by?: string | null;
  last_step_doc?: string | null;
}

interface Rec {
  id: string;
  version: number;
  status: string;
  purification: string;
  format: string;
  workflow_id?: string | null;
  workflow_name?: string | null;
  synthesis_scale_code?: string | null;
  mfg_date?: string | null;
  tubes_detail?: { tube_no: number; label: string; od: number; nmol: number; ug: number; vol_100um_ul: number }[];
  cleavage_done: boolean;
  deprotection_done: boolean;
  purification_done: boolean;
  a260: string | null;
  dilution_factor: string;
  path_cm: string;
  stock_volume_ul: string | null;
  target_conc_um: string | null;
  tube_count: number;
  notes: string | null;
  od_total: string | null;
  nmol: string | null;
  ug: string | null;
  resuspend_volume_ul: string | null;
  od_per_tube: string | null;
  workflow_steps: FrozenStep[] | null;
}

interface SopWorkflowOption {
  id: string;
  name: string;
  purifications: string[];
  steps: { method_id: string; name?: string | null }[];
  status: string;
}

interface Detail {
  sequence: {
    id: string;
    code: string;
    name: string;
    status: string;
    relation: string | null;
    raw_sequence?: string;
    normalized_sequence: string;
    mw: string;
    nmol_per_od: string;
    ug_per_od: string;
    scale_code: string;
    order_code: string | null;
  };
  record: Rec | null;
  steps: StepLog[];
  qc_tests: { id: string; code: string; status: string; overall_result: string | null }[];
}

const refreshKeys = ["oligo-post", "oligo-post-detail", "oligo-orders", "oligo-order", "qc-tests"];

/** Returns the minimum guaranteed recovery yield (nmol) for a synthesis scale (30% of scale, e.g. 100NMOL -> 30 nmol). */
export function getMinGuaranteedNmolForScale(scaleCode: string | null | undefined): number {
  const raw = String(scaleCode ?? "").trim().toUpperCase();
  if (/1\s*U(MOL)?/i.test(raw) || raw === "1000NMOL") return 300;
  const m = raw.match(/(\d+)\s*NMOL/i) ?? raw.match(/^(\d+)$/);
  if (m && Number(m[1]) > 0) {
    return Math.round(Number(m[1]) * 0.3 * 100) / 100;
  }
  return 30;
}

/** Format a compact summary of the last logged step values for the table column "Ghi nhận bước gần nhất". */
function summarizeStepValues(step: FrozenStep | undefined, values: Record<string, string | number | null> | null | undefined): string[] {
  if (!values || typeof values !== "object") return [];
  const lines: string[] = [];
  if (step && Array.isArray(step.fields)) {
    for (const f of step.fields) {
      const v = values[f.key];
      if (v == null || v === "") continue;
      if (f.type === "REAGENT") {
        const itemLabel = (f as any).item_name || f.label;
        lines.push(`${itemLabel}: Tiêu hao ${v} ${f.uom ?? ""}`.trim());
      } else if (f.type === "EQUIPMENT") {
        const eqLabel = (f as any).asset_code ? `${(f as any).asset_code} · ${(f as any).asset_name || ""}` : String(v);
        lines.push(`${f.label}: ${eqLabel}`.trim());
      } else {
        lines.push(`${f.label}: ${v}${f.unit ? ` ${f.unit}` : ""}`);
      }
    }
  } else {
    for (const [k, v] of Object.entries(values)) {
      if (v == null || v === "" || k === "batch_logged") continue;
      lines.push(`${k}: ${v}`);
    }
  }
  return lines;
}

/** Focused modal for executing ONLY the current step (or viewing/editing step history when requested). */
function StepExecutionModal({
  row,
  mode,
  workflows,
  canManage,
  canLabel,
  onClose,
}: {
  row: Row;
  mode: "CURRENT_STEP" | "HISTORY";
  workflows: SopWorkflowOption[];
  canManage: boolean;
  canLabel: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const d = useQuery({
    queryKey: ["factory", "oligo-post-detail", row.id],
    queryFn: () => api<Detail>(`/api/factory/oligo/post/${row.id}`),
  });
  const refresh = () => refreshKeys.forEach((k) => qc.invalidateQueries({ queryKey: ["factory", k] }));

  const rec = d.data?.record;
  const s = d.data?.sequence;
  const steps = rec?.workflow_steps ?? row.workflow_steps ?? null;
  const logs = d.data?.steps ?? [];
  const loggedCount = logs.length;
  const totalSteps = steps?.length ?? 0;
  const currentStep = steps && loggedCount < totalSteps ? steps[loggedCount] : null;

  const [pickedWfId, setPickedWfId] = useState<string>(row.workflow_id || "");
  const [viewMode, setViewMode] = useState<"CURRENT_STEP" | "HISTORY">(mode);

  // OD quantification state (used ONLY when currentStep.kind === "QUANTIFICATION" or when editing OD)
  const [a260, setA260] = useState<string>("");
  const [dilutionFactor, setDilutionFactor] = useState<string>("10");
  const [pathCm, setPathCm] = useState<string>("1");
  const [stockVolUl, setStockVolUl] = useState<string>("200");
  const [targetConcUm, setTargetConcUm] = useState<string>("100");
  const [tubeCount, setTubeCount] = useState<string>("1");
  const [notes, setNotes] = useState<string>("");

  useEffect(() => {
    if (!rec) return;
    setA260(rec.a260 != null ? String(Number(rec.a260)) : "");
    setDilutionFactor(rec.dilution_factor != null ? String(Number(rec.dilution_factor)) : "10");
    setPathCm(rec.path_cm != null ? String(Number(rec.path_cm)) : "1");
    setStockVolUl(rec.stock_volume_ul != null ? String(Number(rec.stock_volume_ul)) : "200");
    setTargetConcUm(rec.target_conc_um != null ? String(Number(rec.target_conc_um)) : "100");
    setTubeCount(String(rec.tube_count || 1));
    setNotes(rec.notes ?? "");
    if (rec.workflow_id) setPickedWfId(rec.workflow_id);
  }, [rec]);

  // Live OD preview calculation
  const liveOdPreview = useMemo(() => {
    const a = Number(a260.replace(",", "."));
    const df = Number(dilutionFactor.replace(",", ".")) || 1;
    const l = Number(pathCm.replace(",", ".")) || 1;
    const vol = Number(stockVolUl.replace(",", "."));
    const tc = Math.max(Number(tubeCount) || 1, 1);
    const nmolPerOd = Number(s?.nmol_per_od ?? row.nmol_per_od ?? 0);
    const ugPerOd = Number(s?.ug_per_od ?? row.ug_per_od ?? 0);
    if (!(a > 0) || !(vol > 0) || !(l > 0)) return null;
    const odTotal = Math.round(((a * df * (vol / 1000)) / l) * 1000) / 1000;
    const nmol = Math.round(odTotal * nmolPerOd * 100) / 100;
    const ug = Math.round(odTotal * ugPerOd * 100) / 100;
    const odPerTube = Math.round((odTotal / tc) * 1000) / 1000;
    const vol100um = Math.round(nmol * 10 * 10) / 10;
    return { odTotal, nmol, ug, odPerTube, vol100um };
  }, [a260, dilutionFactor, pathCm, stockVolUl, tubeCount, s?.nmol_per_od, s?.ug_per_od, row.nmol_per_od, row.ug_per_od]);

  const assignWfMut = useMutation({
    mutationFn: async (wfId: string) =>
      api("/api/factory/oligo/post", {
        method: "POST",
        json: {
          action: "batch_assign_workflow",
          sequence_ids: [row.id],
          workflow_id: wfId,
        },
      }),
    onSuccess: () => {
      refresh();
    },
  });

  const saveOdAndStepMut = useMutation({
    mutationFn: async (submitToQcAfter: boolean) => {
      if (!rec) throw new Error("Chưa mở hồ sơ hậu tổng hợp.");
      const aVal = Number(a260.replace(",", "."));
      const volVal = Number(stockVolUl.replace(",", "."));
      if (!(aVal > 0) || !(volVal > 0)) {
        throw new Error("Vui lòng nhập A260 đo được (> 0) và Thể tích dung dịch gốc (µL > 0).");
      }
      await api(`/api/factory/oligo/post/${row.id}`, {
        method: "PATCH",
        json: {
          version: rec.version,
          a260: aVal,
          dilution_factor: Number(dilutionFactor.replace(",", ".")) || 10,
          path_cm: Number(pathCm.replace(",", ".")) || 1,
          stock_volume_ul: volVal,
          target_conc_um: rec.format === "LIQUID" ? Number(targetConcUm.replace(",", ".")) || 100 : null,
          tube_count: Math.max(Number(tubeCount) || 1, 1),
          notes: notes || null,
        },
      });
      if (currentStep && currentStep.kind === "QUANTIFICATION") {
        // Pre-fill any required NUMBER fields of the QUANTIFICATION method (e.g. sample_vol_ul, od260_val, dilution_factor)
        const autoValues: Record<string, string | number | null> = {};
        for (const f of currentStep.fields) {
          if (f.key.includes("od260") || f.key.includes("a260")) autoValues[f.key] = aVal;
          else if (f.key.includes("dilution")) autoValues[f.key] = Number(dilutionFactor.replace(",", ".")) || 10;
          else if (f.key.includes("vol")) autoValues[f.key] = volVal;
          else if (f.type === "NUMBER" && f.required) autoValues[f.key] = aVal;
        }
        await api("/api/factory/oligo/post/steps", {
          method: "POST",
          idempotent: true,
          json: {
            sequence_ids: [row.id],
            step_no: currentStep.step_no,
            values: autoValues,
          },
        });
      }
      if (submitToQcAfter) {
        await api(`/api/factory/oligo/post/${row.id}/submit`, { method: "POST" });
      }
    },
    onSuccess: () => {
      refresh();
      onClose();
    },
  });

  const submitQcMut = useMutation({
    mutationFn: () => api(`/api/factory/oligo/post/${row.id}/submit`, { method: "POST" }),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });

  const editable = canManage && (s?.status === "POST_PROCESSING" || s?.status === "SYNTHESIZED") && (!rec || rec.status === "OPEN");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-2xl space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {row.name}
              </span>
              <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-sky-700 dark:text-sky-300 font-bold">
                {row.code}
              </span>
              <span className="text-xs text-slate-500">
                {row.scale_code} · {PURIFICATION[row.purification as keyof typeof PURIFICATION] ?? row.purification} · {FORMAT[row.format as keyof typeof FORMAT] ?? row.format}
              </span>
            </div>
            <div className="mt-1 font-mono text-xs text-slate-600 dark:text-slate-400 break-all">
              {s?.normalized_sequence ?? row.raw_sequence ?? row.normalized_sequence}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {totalSteps > 0 && (
              <button
                type="button"
                onClick={() => setViewMode(viewMode === "CURRENT_STEP" ? "HISTORY" : "CURRENT_STEP")}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 cursor-pointer"
              >
                {viewMode === "CURRENT_STEP" ? `📋 Xem nhật ký (${loggedCount}/${totalSteps})` : "⚡ Quay lại bước hiện tại"}
              </button>
            )}
            <Button variant="ghost" onClick={onClose}>
              Đóng
            </Button>
          </div>
        </div>

        <ErrorNote error={d.error ?? assignWfMut.error ?? saveOdAndStepMut.error ?? submitQcMut.error} />

        {/* Step Progress Strip */}
        {steps && totalSteps > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 p-2 border border-slate-200 dark:border-slate-800">
            {steps.map((st, idx) => {
              const isDone = idx < loggedCount;
              const isCurrent = idx === loggedCount;
              return (
                <div
                  key={st.step_no}
                  className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 ${
                    isCurrent
                      ? "bg-amber-500 text-slate-950 font-bold shadow-xs"
                      : isDone
                        ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300"
                        : "bg-slate-200/70 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                  }`}
                >
                  <span>{isDone ? "✓" : `${st.step_no}.`}</span>
                  <span>{st.name}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* CASE 1: No SOP workflow assigned yet -> Prompt to pick SOP from list */}
        {(!steps || totalSteps === 0) && editable && (
          <div className="space-y-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 p-3.5">
            <div className="text-xs font-bold text-amber-900 dark:text-amber-200">
              1️⃣ Chọn Quy trình SOP sau tổng hợp cho trình tự này:
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className={`${inputClass} flex-1 min-w-[260px]`}
                value={pickedWfId}
                onChange={(e) => setPickedWfId(e.target.value)}
              >
                <option value="">-- Chọn quy trình SOP từ danh sách --</option>
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.steps?.length ?? 0} bước)
                  </option>
                ))}
              </select>
              <Button
                disabled={!pickedWfId || assignWfMut.isPending}
                onClick={() => assignWfMut.mutate(pickedWfId)}
              >
                Áp dụng &amp; Bắt đầu Bước 1
              </Button>
            </div>
          </div>
        )}

        {/* CASE 2: Viewing / Editing Step History */}
        {viewMode === "HISTORY" && steps && totalSteps > 0 && (
          <div className="space-y-3">
            <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
              📋 Nhật ký thực hiện quy trình: {rec?.workflow_name ?? row.workflow_name} ({loggedCount}/{totalSteps} bước)
            </div>
            <StepTable
              steps={steps}
              logs={logs}
              seqId={row.id}
              canCorrect={editable}
              onCorrected={refresh}
            />
            {s?.relation === "POOL_MASTER" && rec && Number(rec.od_total) > 0 && (
              <PoolAliquotForm masterId={row.id} canEdit={canManage} onDone={refresh} />
            )}
            {d.data?.qc_tests && d.data.qc_tests.length > 0 && (
              <Table head={["Phiếu QC", "Trạng thái", "Kết quả"]}>
                {d.data.qc_tests.map((t) => (
                  <tr key={t.id}>
                    <td className="py-1.5 pr-3 font-mono text-xs">{t.code}</td>
                    <td className="py-1.5 pr-3 text-xs">{QC_STATUS_LABEL[t.status]}</td>
                    <td className="py-1.5 pr-3">
                      {t.overall_result ? (
                        <StatusBadge
                          status={t.overall_result === "PASS" ? "RELEASED" : "REJECTED"}
                          label={t.overall_result === "PASS" ? "Đạt" : "Không đạt"}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </div>
        )}

        {/* CASE 3: Focused Execution of Current Step */}
        {viewMode === "CURRENT_STEP" && steps && totalSteps > 0 && (
          <>
            {currentStep ? (
              <div className="space-y-3">
                <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 px-3.5 py-2.5">
                  <div className="text-xs font-bold text-amber-800 dark:text-amber-300 uppercase">
                    Bước {currentStep.step_no}/{totalSteps} hiện tại
                  </div>
                  <div className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                    {currentStep.category} — {currentStep.name}
                  </div>
                </div>

                {currentStep.kind === "QUANTIFICATION" ? (
                  /* Focused OD260 Quantification Step Form */
                  <div className="space-y-3 rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/30 p-3.5">
                    <div className="text-xs font-bold text-sky-900 dark:text-sky-200">
                      📏 Nhập số liệu Đo OD260 cho bước "{currentStep.name}"
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label="A260 đo được *">
                        <input
                          className={inputClass}
                          inputMode="decimal"
                          autoFocus
                          placeholder="VD: 0.485"
                          disabled={!editable}
                          value={a260}
                          onChange={(e) => setA260(e.target.value)}
                        />
                      </Field>
                      <Field label="Hệ số pha loãng">
                        <input
                          className={inputClass}
                          inputMode="decimal"
                          disabled={!editable}
                          value={dilutionFactor}
                          onChange={(e) => setDilutionFactor(e.target.value)}
                        />
                      </Field>
                      <Field label="Thể tích dung dịch gốc (µL) *">
                        <input
                          className={inputClass}
                          inputMode="decimal"
                          disabled={!editable}
                          value={stockVolUl}
                          onChange={(e) => setStockVolUl(e.target.value)}
                        />
                      </Field>
                      <Field label="Chiều dài cuvet (cm)">
                        <input
                          className={inputClass}
                          inputMode="decimal"
                          disabled={!editable}
                          value={pathCm}
                          onChange={(e) => setPathCm(e.target.value)}
                        />
                      </Field>
                      <Field label="Số ống chia">
                        <input
                          className={inputClass}
                          inputMode="numeric"
                          disabled={!editable}
                          value={tubeCount}
                          onChange={(e) => setTubeCount(e.target.value)}
                        />
                      </Field>
                      {rec?.format === "LIQUID" && (
                        <Field label="Nồng độ hoàn nguyên (µM)">
                          <input
                            className={inputClass}
                            inputMode="decimal"
                            disabled={!editable}
                            value={targetConcUm}
                            onChange={(e) => setTargetConcUm(e.target.value)}
                          />
                        </Field>
                      )}
                    </div>

                    {liveOdPreview && (() => {
                      const minNmol = getMinGuaranteedNmolForScale(s?.scale_code ?? row.scale_code);
                      const meetsMin = liveOdPreview.nmol >= minNmol;
                      return (
                        <div className="space-y-1.5">
                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 rounded-xl bg-white dark:bg-slate-900 p-2.5 border border-sky-200 dark:border-sky-900 text-xs">
                            <div>
                              <span className="text-slate-500 block text-[11px]">Tổng OD</span>
                              <b className="text-sm text-slate-900 dark:text-slate-100">{fmtQty(liveOdPreview.odTotal)}</b>
                            </div>
                            <div>
                              <span className="text-slate-500 block text-[11px]">Hiệu suất (nmol)</span>
                              <b className={`text-sm ${meetsMin ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                {fmtQty(liveOdPreview.nmol)}
                              </b>
                            </div>
                            <div>
                              <span className="text-slate-500 block text-[11px]">Khối lượng (µg)</span>
                              <b className="text-sm">{fmtQty(liveOdPreview.ug)}</b>
                            </div>
                            <div>
                              <span className="text-slate-500 block text-[11px]">OD / ống</span>
                              <b className="text-sm">{fmtQty(liveOdPreview.odPerTube)}</b>
                            </div>
                            <div>
                              <span className="text-slate-500 block text-[11px]">Pha 100 µM</span>
                              <b className="text-sm text-sky-700 dark:text-sky-400">{fmtQty(liveOdPreview.vol100um)} µL</b>
                            </div>
                          </div>
                          <div className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border ${
                            meetsMin
                              ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
                              : "bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800"
                          }`}>
                            {meetsMin
                              ? `✓ Đạt ngưỡng cam kết thang ${s?.scale_code ?? row.scale_code} (≥ ${fmtQty(minNmol)} nmol)`
                              : `⚠️ Hiệu suất thu hồi (${fmtQty(liveOdPreview.nmol)} nmol) thấp hơn ngưỡng cam kết thang ${s?.scale_code ?? row.scale_code} (≥ ${fmtQty(minNmol)} nmol)`}
                          </div>
                        </div>
                      );
                    })()}

                    <Field label="Ghi chú bước Đo OD (nếu có)">
                      <input
                        className={inputClass}
                        disabled={!editable}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Ghi chú thêm nếu cần..."
                      />
                    </Field>

                    {editable && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Button
                          disabled={saveOdAndStepMut.isPending || !liveOdPreview}
                          onClick={() => saveOdAndStepMut.mutate(false)}
                        >
                          ✅ Lưu kết quả Đo OD &amp; Qua bước tiếp ({currentStep.step_no}/{totalSteps})
                        </Button>
                        {currentStep.step_no === totalSteps && (
                          <Button
                            variant="ghost"
                            disabled={saveOdAndStepMut.isPending || !liveOdPreview}
                            onClick={() => saveOdAndStepMut.mutate(true)}
                          >
                            ✅ Lưu Đo OD &amp; Xác nhận Đạt QC (Hoàn tất)
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  /* Focused Standard Step Form (ONLY shows this step's configured fields) */
                  <StepLogForm
                    key={`${row.id}-${currentStep.step_no}`}
                    step={currentStep}
                    sequenceIds={[row.id]}
                    odReady={Number(rec?.od_total ?? row.od_total ?? 0) > 0}
                    onDone={() => {
                      refresh();
                      onClose();
                    }}
                  />
                )}
              </div>
            ) : (
              /* All SOP steps completed! */
              <div className="space-y-3 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 p-4">
                <div className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                  ✅ Đã hoàn tất toàn bộ {totalSteps}/{totalSteps} bước quy trình SOP ({rec?.workflow_name ?? row.workflow_name})
                </div>
                {Number(rec?.od_total ?? row.od_total ?? 0) > 0 ? (
                  <div className="flex flex-wrap gap-4 text-xs text-slate-700 dark:text-slate-300">
                    <span>Tổng OD: <b>{fmtQty(rec?.od_total ?? row.od_total)}</b></span>
                    <span>Hiệu suất: <b>{fmtQty(rec?.nmol ?? row.nmol)} nmol</b></span>
                    <span>Khối lượng: <b>{fmtQty(rec?.ug ?? row.ug)} µg</b></span>
                    <span>Pha 100 µM: <b className="text-sky-700 dark:text-sky-400">{fmtQty(Number(rec?.nmol ?? row.nmol ?? 0) * 10)} µL</b></span>
                  </div>
                ) : (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Trình tự chưa có số liệu đo OD260. Vui lòng nhập kết quả đo OD trước khi xác nhận QC.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {canManage && (s?.status === "POST_PROCESSING" || s?.status === "QC") && Number(rec?.od_total ?? row.od_total ?? 0) > 0 && (
                    <Button
                      disabled={submitQcMut.isPending}
                      onClick={() => submitQcMut.mutate()}
                    >
                      ✅ Xác nhận Đạt QC &amp; Hoàn tất (Phòng Oligo)
                    </Button>
                  )}
                  {canLabel && Number(rec?.od_total ?? row.od_total ?? 0) > 0 && (
                    <Button
                      variant="ghost"
                      onClick={() => printWithReprint([row.id])}
                    >
                      🏷️ In nhãn ống ({rec?.tube_count ?? row.tube_count ?? 1})
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => setViewMode("HISTORY")}>
                    📋 Xem / Sửa nhật ký các bước
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Modal for "↻ Báo lỗi / Chạy lại" on a sequence row. */
function RerunModal({
  row,
  onClose,
}: {
  row: Row;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"REWIND_STEP" | "RESET_POST" | "RESYNTHESIZE">(
    (row.workflow_logged_steps ?? 0) > 0 ? "REWIND_STEP" : "RESET_POST"
  );
  const [reason, setReason] = useState("");
  const mut = useMutation({
    mutationFn: () =>
      api("/api/factory/oligo/post", {
        method: "POST",
        json: {
          action: "batch_rerun",
          sequence_ids: [row.id],
          rerun_mode: mode,
          reason: reason.trim() || "Kỹ thuật viên yêu cầu chạy lại từ màn hình Hậu tổng hợp",
        },
      }),
    onSuccess: () => {
      refreshKeys.forEach((k) => qc.invalidateQueries({ queryKey: ["factory", k] }));
      onClose();
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-2xl space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
          <div className="text-sm font-bold text-rose-700 dark:text-rose-400">
            ↻ Báo lỗi / Chạy lại: {row.name} ({row.code})
          </div>
          <Button variant="ghost" onClick={onClose}>
            Đóng
          </Button>
        </div>

        <ErrorNote error={mut.error} />

        <div className="space-y-2 text-xs">
          {(row.workflow_logged_steps ?? 0) > 0 && (
            <label className="flex items-start gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60">
              <input
                type="radio"
                name="rerun_mode"
                checked={mode === "REWIND_STEP"}
                onChange={() => setMode("REWIND_STEP")}
                className="mt-0.5"
              />
              <div>
                <div className="font-bold text-slate-800 dark:text-slate-200">
                  ⏪ Lùi lại 1 bước vừa thực hiện (Bước {row.workflow_logged_steps})
                </div>
                <div className="text-slate-500 text-[11px]">
                  Hủy ghi nhận của bước gần nhất để nhập lại thông số bước đó.
                </div>
              </div>
            </label>
          )}

          <label className="flex items-start gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60">
            <input
              type="radio"
              name="rerun_mode"
              checked={mode === "RESET_POST"}
              onChange={() => setMode("RESET_POST")}
              className="mt-0.5"
            />
            <div>
              <div className="font-bold text-slate-800 dark:text-slate-200">
                🔄 Đặt lại Hậu tổng hợp về Bước 1
              </div>
              <div className="text-slate-500 text-[11px]">
                Xóa các bước hậu tổng hợp đã ghi nhận để chạy lại từ Bước 1 hoặc chọn lại quy trình SOP.
              </div>
            </div>
          </label>

          <label className="flex items-start gap-2 p-2.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20 cursor-pointer">
            <input
              type="radio"
              name="rerun_mode"
              checked={mode === "RESYNTHESIZE"}
              onChange={() => setMode("RESYNTHESIZE")}
              className="mt-0.5"
            />
            <div>
              <div className="font-bold text-rose-700 dark:text-rose-300">
                ⚠️ Báo lỗi hỏng mẫu &amp; Đưa về chờ Tổng hợp lại trên máy
              </div>
              <div className="text-rose-600/80 dark:text-rose-400/80 text-[11px]">
                Hủy hồ sơ hậu tổng hợp hiện tại và trả trình tự về tab "Mẻ tổng hợp" để xếp chạy lại từ đầu.
              </div>
            </div>
          </label>
        </div>

        <Field label="Lý do báo lỗi / chạy lại *">
          <input
            className={inputClass}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Nhập lý do (VD: Nhập nhầm bước, hỏng mẫu khi tinh sạch...)"
          />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button
            disabled={mut.isPending || (mode === "RESYNTHESIZE" && reason.trim().length < 3)}
            onClick={() => mut.mutate()}
          >
            Xác nhận thực hiện
          </Button>
        </div>
      </div>
    </div>
  );
}

const FILTERS: [string, string][] = [
  ["", "Cần xử lý"],
  ["SYNTHESIZED", "Đã tổng hợp"],
  ["POST_PROCESSING", "Hậu tổng hợp"],
  ["QC", "Đang QC"],
  ["COMPLETED", "Hoàn thành"],
  ["FAILED", "Lỗi"],
];

export function PostProcessView({ canManage, canLabel }: { canManage: boolean; canLabel: boolean }) {
  const qc = useQueryClient();
  const [subView, setSubView] = useState<"PROCESSING" | "COMPLETED" | "SOP" | "HPLC_COLUMNS">("PROCESSING");
  const [stepModalRow, setStepModalRow] = useState<{ row: Row; mode: "CURRENT_STEP" | "HISTORY" } | null>(null);
  const [rerunRow, setRerunRow] = useState<Row | null>(null);
  const [showBatchOdModal, setShowBatchOdModal] = useState(false);
  const [showBatchStepModal, setShowBatchStepModal] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [orderFilter, setOrderFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [batchA260, setBatchA260] = useState("");
  const [batchTsvText, setBatchTsvText] = useState("");
  const [batchDilution, setBatchDilution] = useState("10");
  const [batchVolUl, setBatchVolUl] = useState("200");
  const [batchTubeCount, setBatchTubeCount] = useState("1");
  const [batchWorkflowId, setBatchWorkflowId] = useState("");

  const effectiveStatus = subView === "COMPLETED" ? "COMPLETED" : status;
  const list = useQuery({
    queryKey: ["factory", "oligo-post", effectiveStatus],
    queryFn: () => api<Row[]>(`/api/factory/oligo/post${effectiveStatus ? `?status=${effectiveStatus}` : ""}`),
  });
  const sopQ = useQuery({
    queryKey: ["factory", "oligo-sop"],
    queryFn: () => api<{ workflows: SopWorkflowOption[]; methods: { id: string; fields: StepField[] }[] }>("/api/factory/oligo/sop"),
  });
  const activeWorkflows = useMemo(
    () => (sopQ.data?.workflows ?? []).filter((w) => w.status === "ACTIVE"),
    [sopQ.data?.workflows]
  );

  // Map method_id -> enriched fields (with item_name, asset_code, etc.) from listSop
  const enrichedMethodFields = useMemo(() => {
    const map = new Map<string, StepField[]>();
    for (const m of sopQ.data?.methods ?? []) {
      if (m.id && Array.isArray(m.fields)) map.set(m.id, m.fields);
    }
    return map;
  }, [sopQ.data?.methods]);

  const batchAct = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api("/api/factory/oligo/post", { method: "POST", json: payload }),
    onSuccess: (_res, variables) => {
      if (variables.action !== "batch_assign_workflow" && variables.action !== "batch_start") {
        setPicked([]);
        setBatchTsvText("");
        setShowBatchOdModal(false);
      }
      refreshKeys.forEach((k) => qc.invalidateQueries({ queryKey: ["factory", k] }));
    },
  });

  const parsedPerSeqA260 = useMemo(() => {
    const map: Record<string, number> = {};
    if (!batchTsvText.trim()) return map;
    const pickedRows = (list.data ?? []).filter((r) => picked.includes(r.id));
    const codeToId = new Map((list.data ?? []).map((r) => [r.code.trim().toUpperCase(), r.id]));
    const lines = batchTsvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    let seqIdx = 0;
    for (const line of lines) {
      const parts = line.split(/[\t,;]+|\s{2,}/).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const matchedId = picked.includes(parts[0]) ? parts[0] : codeToId.get(parts[0].toUpperCase());
        const num = Number(parts[parts.length - 1].replace(",", "."));
        if (matchedId && picked.includes(matchedId) && Number.isFinite(num) && num > 0 && num <= 1000) {
          map[matchedId] = num;
        }
      } else if (parts.length === 1) {
        const num = Number(parts[0].replace(",", "."));
        if (Number.isFinite(num) && num > 0 && num <= 1000) {
          while (seqIdx < pickedRows.length && map[pickedRows[seqIdx].id] !== undefined) seqIdx++;
          if (seqIdx < pickedRows.length) {
            map[pickedRows[seqIdx].id] = num;
            seqIdx++;
          }
        }
      }
    }
    return map;
  }, [batchTsvText, list.data, picked]);

  const orderGroups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    for (const r of list.data ?? []) {
      const key = r.order_code ?? "__POOL__";
      const existing = map.get(key);
      if (existing) existing.count += 1;
      else map.set(key, { key, label: r.order_code ?? "Trình tự gộp", count: 1 });
    }
    return Array.from(map.values());
  }, [list.data]);

  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return (list.data ?? []).filter((r) => {
      if (orderFilter !== "ALL") {
        const key = r.order_code ?? "__POOL__";
        if (key !== orderFilter) return false;
      }
      if (q) {
        const hay = `${r.code} ${r.name ?? ""} ${r.order_code ?? ""} ${r.raw_sequence ?? ""} ${r.normalized_sequence ?? ""} ${r.qc_code ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [list.data, orderFilter, searchQuery]);

  // Shared current step across picked rows (if all picked rows are on the same step_no)
  const sharedBatchStep = useMemo(() => {
    if (picked.length === 0) return null;
    const pickedRows = (list.data ?? []).filter((r) => picked.includes(r.id));
    if (pickedRows.length === 0) return null;
    const first = pickedRows[0];
    const logged = first.workflow_logged_steps ?? 0;
    const step = first.workflow_steps?.[logged];
    if (!step) return null;
    const allSameStep = pickedRows.every(
      (r) =>
        r.workflow_id === first.workflow_id &&
        (r.workflow_logged_steps ?? 0) === logged &&
        r.workflow_steps?.[logged]?.step_no === step.step_no
    );
    return allSameStep ? step : null;
  }, [list.data, picked]);

  return (
    <div className="flex flex-col gap-3">
      {/* Sub-navigation tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => {
            setSubView("PROCESSING");
            setStatus("");
          }}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
            subView === "PROCESSING"
              ? "bg-sky-700 text-white"
              : "bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800"
          }`}
        >
          ⏳ Đang xử lý ({subView === "PROCESSING" ? list.data?.length ?? 0 : "…"})
        </button>
        <button
          type="button"
          onClick={() => {
            setSubView("COMPLETED");
            setStatus("COMPLETED");
          }}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
            subView === "COMPLETED"
              ? "bg-emerald-700 text-white"
              : "bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800"
          }`}
        >
          ✅ Đã hoàn thành
        </button>
        <button
          type="button"
          onClick={() => setSubView("SOP")}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
            subView === "SOP"
              ? "bg-amber-600 text-white"
              : "bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800"
          }`}
        >
          ⚙️ Cấu hình Quy trình SOP
        </button>
        <button
          type="button"
          onClick={() => setSubView("HPLC_COLUMNS")}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
            subView === "HPLC_COLUMNS"
              ? "bg-sky-700 text-white"
              : "bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800"
          }`}
        >
          📊 Khấu hao &amp; Sử dụng Cột HPLC
        </button>
      </div>

      {subView === "SOP" && <SopConfigView canManage={canManage} />}
      {subView === "HPLC_COLUMNS" && <ColumnsView canManage={canManage} />}

      {(subView === "PROCESSING" || subView === "COMPLETED") && (
        <Card
          title="Hậu tổng hợp & QC"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <input
                className={`${inputClass} w-52`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm mã trình tự, tên, đơn..."
              />
              <select
                className={`${inputClass} w-48`}
                value={orderFilter}
                onChange={(e) => setOrderFilter(e.target.value)}
                aria-label="Lọc trình tự theo đơn hàng"
              >
                <option value="ALL">Mọi đơn hàng ({list.data?.length ?? 0})</option>
                {orderGroups.map((og) => (
                  <option key={og.key} value={og.key}>
                    Đơn {og.label} ({og.count} trình tự)
                  </option>
                ))}
              </select>
              {subView === "PROCESSING" && (
                <select
                  className={`${inputClass} w-44`}
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  aria-label="Trạng thái"
                >
                  {FILTERS.map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              )}
            </div>
          }
        >
          <ErrorNote error={list.error ?? batchAct.error} />

          {/* Order Quick Filter Pills */}
          {orderGroups.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              <span className="text-[11px] font-bold text-slate-500 mr-1">📦 Lọc theo Đơn:</span>
              <button
                type="button"
                onClick={() => setOrderFilter("ALL")}
                className={`px-2 py-0.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                  orderFilter === "ALL"
                    ? "bg-sky-700 text-white border-sky-700"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700"
                }`}
              >
                Tất cả ({list.data?.length ?? 0})
              </button>
              {orderGroups.map((og) => (
                <button
                  key={og.key}
                  type="button"
                  onClick={() => setOrderFilter(og.key)}
                  className={`px-2 py-0.5 rounded-lg text-xs font-mono font-bold border transition cursor-pointer ${
                    orderFilter === og.key
                      ? "bg-sky-700 text-white border-sky-700"
                      : "bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800"
                  }`}
                >
                  🧬 {og.label} ({og.count})
                </button>
              ))}
              {canManage && filteredList.some((r) => r.status === "SYNTHESIZED" || r.status === "POST_PROCESSING" || r.status === "QC") && (
                <button
                  type="button"
                  onClick={() => {
                    const selectableIds = filteredList
                      .filter((r) => r.status === "SYNTHESIZED" || r.status === "POST_PROCESSING" || r.status === "QC")
                      .map((r) => r.id);
                    const allSelected = selectableIds.every((id) => picked.includes(id));
                    setPicked(allSelected ? [] : selectableIds);
                  }}
                  className="ml-auto px-2.5 py-0.5 rounded-lg text-xs font-bold border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-200 cursor-pointer"
                >
                  ☑️ Chọn / Bỏ chọn toàn bộ danh sách đang lọc (
                  {filteredList.filter((r) => r.status === "SYNTHESIZED" || r.status === "POST_PROCESSING" || r.status === "QC").length})
                </button>
              )}
            </div>
          )}

          {/* Compact Contextual Batch Action Bar (Only when rows are checked) */}
          {canManage && picked.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-300 dark:border-sky-800 bg-sky-50/70 dark:bg-sky-950/40 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-sky-900 dark:text-sky-200">
                  ⚡ Đang chọn {picked.length} trình tự:
                </span>
                <select
                  className={`${inputClass} max-w-xs text-xs py-1`}
                  value={batchWorkflowId}
                  onChange={(e) => setBatchWorkflowId(e.target.value)}
                  aria-label="Chọn quy trình SOP gán hàng loạt"
                >
                  <option value="">-- Chọn quy trình SOP để gán hàng loạt --</option>
                  {activeWorkflows.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.steps?.length ?? 0} bước)
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  disabled={!batchWorkflowId || batchAct.isPending}
                  onClick={() =>
                    batchAct.mutate({
                      action: "batch_assign_workflow",
                      sequence_ids: picked,
                      workflow_id: batchWorkflowId,
                    })
                  }
                >
                  📋 Gán quy trình SOP ({picked.length})
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {sharedBatchStep && sharedBatchStep.kind === "STANDARD" && (
                  <Button
                    onClick={() => setShowBatchStepModal(true)}
                  >
                    📝 Cập nhật Bước {sharedBatchStep.step_no} ({sharedBatchStep.name}) cho {picked.length} trình tự
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() => setShowBatchOdModal(true)}
                >
                  📏 Nhập / Dán Đo OD hàng loạt ({picked.length})
                </Button>
                <Button
                  variant="ghost"
                  disabled={batchAct.isPending}
                  onClick={() => batchAct.mutate({ action: "batch_confirm_qc", sequence_ids: picked, qc_result: "PASS" })}
                >
                  ✅ Xác nhận Đạt QC &amp; Hoàn tất các chuỗi đã đo OD
                </Button>
              </div>
            </div>
          )}

          {filteredList.length === 0 && <Empty>Không có trình tự nào.</Empty>}

          {/* Main Step-Driven Table patterned directly on Legacy OligoFlow */}
          {filteredList.length > 0 && (
            <Table
              head={[
                "",
                "Trình tự / Đơn hàng",
                "Chuỗi (5' → 3')",
                "Quy trình SOP",
                "Tiến độ / Bước hiện tại",
                "Ghi nhận bước gần nhất",
                "Thao tác",
              ]}
            >
              {filteredList.map((r) => {
                const isEditableRow =
                  canManage &&
                  (r.status === "SYNTHESIZED" || r.status === "POST_PROCESSING") &&
                  r.post_status !== "SUBMITTED";
                const totalSteps = Number(r.workflow_total_steps ?? r.workflow_steps?.length ?? 0);
                const loggedSteps = Number(r.workflow_logged_steps ?? 0);
                const hasWorkflow = Boolean(r.workflow_id && totalSteps > 0);
                const currentStep =
                  hasWorkflow && Array.isArray(r.workflow_steps) && loggedSteps < totalSteps
                    ? r.workflow_steps[loggedSteps]
                    : null;
                const prevStepRaw =
                  hasWorkflow && Array.isArray(r.workflow_steps) && r.last_step_no
                    ? r.workflow_steps.find((s) => s.step_no === r.last_step_no)
                    : undefined;
                const prevStep = prevStepRaw
                  ? {
                      ...prevStepRaw,
                      fields: enrichedMethodFields.get(prevStepRaw.method_id) ?? prevStepRaw.fields,
                    }
                  : undefined;
                const prevLines = summarizeStepValues(prevStep, r.last_step_values);

                return (
                  <tr
                    key={r.id}
                    className="border-b border-slate-100 dark:border-slate-800/70 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 align-top"
                  >
                    {/* 1. Checkbox */}
                    <td className="py-3 pr-2">
                      {canManage && (r.status === "POST_PROCESSING" || r.status === "SYNTHESIZED" || r.status === "QC") && (
                        <input
                          type="checkbox"
                          checked={picked.includes(r.id)}
                          onChange={() =>
                            setPicked(picked.includes(r.id) ? picked.filter((x) => x !== r.id) : [...picked, r.id])
                          }
                          aria-label={`Chọn ${r.code} để xử lý hàng loạt`}
                        />
                      )}
                    </td>

                    {/* 2. Sequence Name, Code & Order */}
                    <td className="py-3 pr-3 min-w-[180px]">
                      <div className="font-bold text-xs text-slate-900 dark:text-slate-100">
                        {r.relation === "POOL_MASTER" ? `[GỘP] ${r.name}` : r.name}
                      </div>
                      {r.relation === "POOL_MASTER" && (
                        <span className="mt-0.5 inline-flex items-center rounded-md bg-purple-100 dark:bg-purple-950/60 px-1.5 py-0.5 text-[10px] font-bold text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-800">
                          🧬 Mẻ Gộp: {r.scale_code}
                        </span>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                        <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                          🏷️ {r.code}
                        </span>
                        <span>·</span>
                        <button
                          type="button"
                          onClick={() => setOrderFilter(r.order_code ?? "__POOL__")}
                          className="font-mono font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                          title="Lọc riêng đơn hàng này"
                        >
                          {r.order_code ?? "Gộp"}
                        </button>
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-400">
                        {r.scale_code} · {PURIFICATION[r.purification as keyof typeof PURIFICATION] ?? r.purification}
                        {r.due_date ? ` · Hạn ${fmtDate(r.due_date)}` : ""}
                      </div>
                    </td>

                    {/* 3. Nucleotide Sequence String (5' -> 3') */}
                    <td className="py-3 pr-3 max-w-[230px]">
                      <div className="font-mono text-xs text-slate-700 dark:text-slate-300 break-all leading-relaxed">
                        {r.raw_sequence || r.normalized_sequence || "—"}
                      </div>
                    </td>

                    {/* 4. Inline SOP Workflow Selector Dropdown */}
                    <td className="py-3 pr-3 min-w-[220px]">
                      {isEditableRow ? (
                        <select
                          aria-label={`Chọn quy trình SOP cho ${r.code}`}
                          value={r.workflow_id ?? ""}
                          disabled={batchAct.isPending}
                          onChange={(e) => {
                            const nextWfId = e.target.value;
                            if (!nextWfId) return;
                            if (loggedSteps > 0 && nextWfId !== r.workflow_id) {
                              const ok = window.confirm(
                                `Đổi quy trình SOP cho "${r.name}" sẽ đặt lại ${loggedSteps} bước đã ghi nhận về Bước 1. Bạn có chắc chắn muốn đổi?`
                              );
                              if (!ok) return;
                            }
                            batchAct.mutate({
                              action: "batch_assign_workflow",
                              sequence_ids: [r.id],
                              workflow_id: nextWfId,
                            });
                          }}
                          className={`w-full rounded-lg px-2.5 py-1.5 text-xs font-semibold transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                            hasWorkflow
                              ? "bg-sky-50 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border border-sky-300 dark:border-sky-800"
                              : "bg-slate-900 text-slate-100 dark:bg-slate-950 dark:text-slate-100 border border-slate-700"
                          }`}
                        >
                          <option value="">-- Chọn quy trình SOP --</option>
                          {activeWorkflows.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="inline-flex items-center rounded-lg bg-sky-50 dark:bg-sky-950/60 px-2.5 py-1 text-xs font-semibold text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                          {r.workflow_name || "Quy trình cơ bản"}
                        </span>
                      )}
                    </td>

                    {/* 5. Current Step Status */}
                    <td className="py-3 pr-3 min-w-[175px]">
                      {!hasWorkflow && r.status !== "QC" && r.status !== "COMPLETED" ? (
                        <span className="inline-flex items-center rounded-lg bg-amber-500/15 dark:bg-amber-950/70 px-2.5 py-1 text-xs font-bold text-amber-700 dark:text-amber-400 border border-amber-400/40 dark:border-amber-800">
                          Chờ Gán Quy Trình
                        </span>
                      ) : currentStep ? (
                        <div className="space-y-0.5">
                          <div className="text-xs font-bold text-amber-600 dark:text-amber-400">
                            Bước {loggedSteps + 1}/{totalSteps}:
                          </div>
                          <div className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-snug">
                            {currentStep.category ? `${currentStep.category} - ` : ""}
                            {currentStep.name}
                          </div>
                        </div>
                      ) : r.status === "QC" ? (
                        <div className="space-y-0.5">
                          <StatusBadge status={SEQ_STATUS[r.status][0]} label="Chờ Xác nhận QC (Phòng Oligo)" />
                          <div className="text-[11px] text-slate-500">
                            {Number(r.od_total) > 0 ? `Đã đo ${fmtQty(r.od_total)} OD · Sẵn sàng xác nhận` : "Chờ xác nhận kết quả"}
                          </div>
                        </div>
                      ) : r.status === "COMPLETED" ? (
                        <StatusBadge status={SEQ_STATUS[r.status][0]} label={SEQ_STATUS[r.status][1]} />
                      ) : (
                        <div className="space-y-0.5">
                          <div className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                            ✅ Hoàn tất {totalSteps}/{totalSteps} bước
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {Number(r.od_total) > 0 ? "Sẵn sàng xác nhận Đạt QC" : "Cần nhập kết quả Đo OD"}
                          </div>
                        </div>
                      )}
                    </td>

                    {/* 6. Last Completed Step Log Summary */}
                    <td className="py-3 pr-3 min-w-[230px]">
                      {loggedSteps === 0 && !(Number(r.od_total) > 0) ? (
                        <span className="text-xs text-slate-400 dark:text-slate-500 italic">
                          Chưa bắt đầu
                        </span>
                      ) : (
                        <div className="space-y-1 text-xs">
                          {r.last_step_name && (
                            <div className="font-bold text-slate-900 dark:text-slate-100 leading-snug">
                              {prevStep?.category ? `${prevStep.category} - ` : ""}
                              {r.last_step_name}:
                              {isEditableRow && (
                                <button
                                  type="button"
                                  onClick={() => setStepModalRow({ row: r, mode: "HISTORY" })}
                                  className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/50 cursor-pointer"
                                >
                                  📝 Sửa
                                </button>
                              )}
                            </div>
                          )}
                          {r.last_step_by && (
                            <div className="text-[11px] font-semibold text-sky-700 dark:text-sky-400">
                              👤 {r.last_step_by}
                            </div>
                          )}
                          {prevLines.map((ln, idx) => (
                            <div key={idx} className="text-[11px] text-slate-500 dark:text-slate-400">
                              • {ln}
                            </div>
                          ))}
                          {r.last_step_doc && (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              • Phiếu xuất kho: <span className="font-mono">{r.last_step_doc}</span>
                            </div>
                          )}
                          {Number(r.od_total) > 0 && (() => {
                            const minNmol = getMinGuaranteedNmolForScale(r.scale_code);
                            const meetsMin = Number(r.nmol ?? 0) >= minNmol;
                            return (
                              <div className={`text-[11px] font-semibold ${meetsMin ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                • Đo OD: {fmtQty(r.od_total)} OD · {fmtQty(r.nmol)} nmol ({meetsMin ? `≥ ${fmtQty(minNmol)} nmol` : `< ${fmtQty(minNmol)} nmol`})
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </td>

                    {/* 7. Contextual Step Actions (Rightmost Column) */}
                    <td className="py-2.5 pl-1">
                      <div className="flex flex-wrap items-center gap-1 max-w-[220px]">
                        {isEditableRow ? (
                          <>
                            {!hasWorkflow || loggedSteps === 0 ? (
                              <button
                                type="button"
                                onClick={() => setStepModalRow({ row: r, mode: "CURRENT_STEP" })}
                                className="rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-[11px] px-2.5 py-1 shadow-xs transition cursor-pointer inline-flex items-center gap-1 whitespace-nowrap"
                              >
                                ▶ Bắt đầu
                              </button>
                            ) : loggedSteps < totalSteps ? (
                              <button
                                type="button"
                                onClick={() => setStepModalRow({ row: r, mode: "CURRENT_STEP" })}
                                className="rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold text-[11px] px-2.5 py-1 shadow-xs transition cursor-pointer inline-flex items-center gap-1 whitespace-nowrap"
                              >
                                📝 Bước tiếp
                              </button>
                            ) : !(Number(r.od_total) > 0) ? (
                              <button
                                type="button"
                                onClick={() => setStepModalRow({ row: r, mode: "CURRENT_STEP" })}
                                className="rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold text-[11px] px-2.5 py-1 shadow-xs transition cursor-pointer inline-flex items-center gap-1 whitespace-nowrap"
                              >
                                📏 Đo OD
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={batchAct.isPending}
                                title="Xác nhận Đạt QC và hoàn tất trình tự này"
                                onClick={() =>
                                  batchAct.mutate({
                                    action: "batch_confirm_qc",
                                    sequence_ids: [r.id],
                                    qc_result: "PASS",
                                  })
                                }
                                className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] px-2.5 py-1 shadow-xs transition cursor-pointer inline-flex items-center gap-1 whitespace-nowrap"
                              >
                                ✅ Đạt QC
                              </button>
                            )}

                            <button
                              type="button"
                              title="Báo lỗi / Yêu cầu tổng hợp hoặc tinh sạch lại"
                              onClick={() => setRerunRow(r)}
                              className="rounded-lg border border-rose-300 dark:border-rose-800/80 bg-rose-50/40 dark:bg-rose-950/20 hover:bg-rose-100/70 dark:hover:bg-rose-950/50 text-rose-700 dark:text-rose-400 font-semibold text-[11px] px-2 py-1 transition cursor-pointer inline-flex items-center gap-1 whitespace-nowrap"
                            >
                              ↻ Chạy lại
                            </button>
                          </>
                        ) : (
                          <>
                            {canManage && r.status === "QC" && (
                              <>
                                <button
                                  type="button"
                                  disabled={batchAct.isPending}
                                  title="Xác nhận trình tự Đạt QC và chuyển sang Đã hoàn thành"
                                  onClick={() =>
                                    batchAct.mutate({
                                      action: "batch_confirm_qc",
                                      sequence_ids: [r.id],
                                      qc_result: "PASS",
                                    })
                                  }
                                  className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] px-2.5 py-1 shadow-xs transition cursor-pointer inline-flex items-center gap-1 whitespace-nowrap"
                                >
                                  ✅ Đạt QC
                                </button>
                                <button
                                  type="button"
                                  title="Không đạt QC / Yêu cầu chạy lại"
                                  onClick={() => setRerunRow(r)}
                                  className="rounded-lg border border-rose-300 dark:border-rose-800/80 bg-rose-50/40 dark:bg-rose-950/20 hover:bg-rose-100/70 dark:hover:bg-rose-950/50 text-rose-700 dark:text-rose-400 font-semibold text-[11px] px-2 py-1 transition cursor-pointer inline-flex items-center gap-1 whitespace-nowrap"
                                >
                                  ↻ Chạy lại
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              title="Xem nhật ký các bước hậu tổng hợp"
                              onClick={() => setStepModalRow({ row: r, mode: "HISTORY" })}
                              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 text-slate-700 dark:text-slate-200 font-semibold text-[11px] px-2 py-1 transition cursor-pointer whitespace-nowrap"
                            >
                              📋 Nhật ký
                            </button>
                            {canLabel && Number(r.od_total) > 0 && (
                              <button
                                type="button"
                                title="In nhãn ống Oligo"
                                onClick={() => printWithReprint([r.id])}
                                className="rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50/60 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300 font-semibold text-[11px] px-2 py-1 transition cursor-pointer whitespace-nowrap"
                              >
                                🏷️ Nhãn
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      )}

      {/* Focused Step Execution / Step History Modal */}
      {stepModalRow && (
        <StepExecutionModal
          row={stepModalRow.row}
          mode={stepModalRow.mode}
          workflows={activeWorkflows}
          canManage={canManage}
          canLabel={canLabel}
          onClose={() => setStepModalRow(null)}
        />
      )}

      {/* Rerun / Report Error Modal */}
      {rerunRow && <RerunModal row={rerunRow} onClose={() => setRerunRow(null)} />}

      {/* Batch Standard Step Modal (when multiple sequences at the same step are updated together) */}
      {showBatchStepModal && sharedBatchStep && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
          onClick={() => setShowBatchStepModal(false)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-2xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                📝 Cập nhật Bước {sharedBatchStep.step_no} ({sharedBatchStep.category} — {sharedBatchStep.name}) cho {picked.length} trình tự
              </div>
              <Button variant="ghost" onClick={() => setShowBatchStepModal(false)}>
                Đóng
              </Button>
            </div>
            <StepLogForm
              key={`${picked.join()}-${sharedBatchStep.step_no}`}
              step={sharedBatchStep}
              sequenceIds={picked}
              odReady
              onDone={() => {
                setShowBatchStepModal(false);
                setPicked([]);
                refreshKeys.forEach((k) => qc.invalidateQueries({ queryKey: ["factory", k] }));
              }}
            />
          </div>
        </div>
      )}

      {/* Batch OD Measurement / 96-Well Reader Paste Modal (Opened ONLY when user clicks "Nhập / Dán Đo OD hàng loạt") */}
      {showBatchOdModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
          onClick={() => setShowBatchOdModal(false)}
        >
          <div
            className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-2xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                📏 Nhập / Dán kết quả Đo OD260 hàng loạt ({picked.length} trình tự đã chọn)
              </div>
              <Button variant="ghost" onClick={() => setShowBatchOdModal(false)}>
                Đóng
              </Button>
            </div>

            <ErrorNote error={batchAct.error} />

            <div className="grid gap-3 sm:grid-cols-4 items-end">
              <Field label="A260 đo được (chung nếu không dán bảng)">
                <input
                  className={inputClass}
                  inputMode="decimal"
                  placeholder="Nhập A260..."
                  value={batchA260}
                  onChange={(e) => setBatchA260(e.target.value)}
                />
              </Field>
              <Field label="Hệ số pha loãng">
                <input
                  className={inputClass}
                  value={batchDilution}
                  onChange={(e) => setBatchDilution(e.target.value)}
                />
              </Field>
              <Field label="Thể tích gốc (µL)">
                <input
                  className={inputClass}
                  value={batchVolUl}
                  onChange={(e) => setBatchVolUl(e.target.value)}
                />
              </Field>
              <Field label="Số ống / chuỗi">
                <input
                  className={inputClass}
                  value={batchTubeCount}
                  onChange={(e) => setBatchTubeCount(e.target.value)}
                />
              </Field>
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-sky-900 dark:text-sky-200">
                <span>
                  📋 Hoặc dán bảng kết quả máy đọc khay / NanoDrop (96 giếng): mỗi dòng <code>Mã_Trình_Tự[Tab]A260</code> hoặc cột số A260 theo thứ tự đã chọn
                </span>
                <span className="font-mono">
                  Đã khớp: <b>{Object.keys(parsedPerSeqA260).length}</b> / {picked.length} trình tự
                </span>
              </div>
              <textarea
                className={`${inputClass} min-h-[100px] font-mono text-xs`}
                placeholder={"VD:\nO261100001\t1.45\nO261100002\t1.62"}
                value={batchTsvText}
                onChange={(e) => setBatchTsvText(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                disabled={
                  batchAct.isPending ||
                  (!(Number(batchA260.replace(",", ".")) > 0) && !picked.every((id) => parsedPerSeqA260[id] > 0))
                }
                onClick={() => {
                  const fallback = Number(batchA260.replace(",", "."));
                  batchAct.mutate({
                    action: "batch_measure",
                    sequence_ids: picked,
                    ...(fallback > 0 ? { a260: fallback } : {}),
                    ...(Object.keys(parsedPerSeqA260).length > 0 ? { per_sequence_a260: parsedPerSeqA260 } : {}),
                    dilution_factor: Number(batchDilution || 10),
                    stock_volume_ul: Number(batchVolUl || 200),
                    tube_count: Number(batchTubeCount || 1),
                    auto_submit_qc: false,
                  });
                }}
              >
                🧪 Lưu kết quả Đo OD hàng loạt
              </Button>
              <Button
                disabled={
                  batchAct.isPending ||
                  (!(Number(batchA260.replace(",", ".")) > 0) && !picked.every((id) => parsedPerSeqA260[id] > 0))
                }
                onClick={() => {
                  const fallback = Number(batchA260.replace(",", "."));
                  batchAct.mutate({
                    action: "batch_measure",
                    sequence_ids: picked,
                    ...(fallback > 0 ? { a260: fallback } : {}),
                    ...(Object.keys(parsedPerSeqA260).length > 0 ? { per_sequence_a260: parsedPerSeqA260 } : {}),
                    dilution_factor: Number(batchDilution || 10),
                    stock_volume_ul: Number(batchVolUl || 200),
                    tube_count: Number(batchTubeCount || 1),
                    auto_submit_qc: true,
                  });
                }}
              >
                ✅ Lưu Đo OD &amp; Xác nhận Đạt QC Hàng loạt
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

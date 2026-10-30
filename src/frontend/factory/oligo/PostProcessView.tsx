"use client";

import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { QC_STATUS_LABEL } from "../qa/QcTestsView";
import { printWithReprint } from "./labels";
import { StepLogForm, StepTable, type FrozenStep, type StepLog } from "./StepLogForm";
import { FORMAT, PURIFICATION, SEQ_STATUS } from "./shared";

interface Row {
  id: string; code: string; name: string; status: string; scale_code: string; purification: string; format: string; base_count: number; mw: number;
  order_code: string | null; due_date: string | null; od_total: number | null; nmol: number | null; qc_code: string | null; qc_status: string | null; qc_result: string | null;
}
interface Rec {
  id: string; version: number; status: string; purification: string; format: string;
  cleavage_done: boolean; deprotection_done: boolean; purification_done: boolean;
  a260: string | null; dilution_factor: string; path_cm: string; stock_volume_ul: string | null; target_conc_um: string | null; tube_count: number; notes: string | null;
  od_total: string | null; nmol: string | null; ug: string | null; resuspend_volume_ul: string | null; od_per_tube: string | null;
  workflow_steps: FrozenStep[] | null;
}
interface Detail {
  sequence: { id: string; code: string; name: string; status: string; normalized_sequence: string; mw: string; nmol_per_od: string; ug_per_od: string; scale_code: string; order_code: string | null };
  record: Rec | null;
  steps: StepLog[];
  qc_tests: { id: string; code: string; status: string; overall_result: string | null }[];
}

const num = (v: string | null | undefined) => (v == null ? "" : String(Number(v)));
const refreshKeys = ["oligo-post", "oligo-post-detail", "oligo-orders", "oligo-order", "qc-tests"];

function PostPanel({ id, canManage, canLabel, onClose }: { id: string; canManage: boolean; canLabel: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const d = useQuery({ queryKey: ["factory", "oligo-post-detail", id], queryFn: () => api<Detail>(`/api/factory/oligo/post/${id}`) });
  const [f, setF] = useState<Record<string, any>>({});
  const rec = d.data?.record;
  useEffect(() => {
    if (!rec) return;
    setF({
      cleavage_done: rec.cleavage_done, deprotection_done: rec.deprotection_done, purification_done: rec.purification_done,
      a260: num(rec.a260), dilution_factor: num(rec.dilution_factor), path_cm: num(rec.path_cm), stock_volume_ul: num(rec.stock_volume_ul),
      target_conc_um: num(rec.target_conc_um), tube_count: String(rec.tube_count), notes: rec.notes ?? "",
    });
  }, [rec]);
  const refresh = () => refreshKeys.forEach((k) => qc.invalidateQueries({ queryKey: ["factory", k] }));
  const act = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: refresh });
  const opt = (v: string) => (v === "" ? null : Number(v.replace(",", ".")));
  const save = () =>
    api(`/api/factory/oligo/post/${id}`, {
      method: "PATCH",
      json: {
        version: rec!.version,
        cleavage_done: f.cleavage_done, deprotection_done: f.deprotection_done, purification_done: f.purification_done,
        a260: opt(f.a260), dilution_factor: opt(f.dilution_factor) ?? 1, path_cm: opt(f.path_cm) ?? 1, stock_volume_ul: opt(f.stock_volume_ul),
        target_conc_um: rec!.format === "LIQUID" ? opt(f.target_conc_um) : null, tube_count: Number(f.tube_count || 1), notes: f.notes || null,
      },
    });
  const s = d.data?.sequence;
  const editable = canManage && s?.status === "POST_PROCESSING" && rec?.status === "OPEN";
  const check = (k: string, label: string) => (
    <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" disabled={!editable} checked={!!f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />{label}</label>
  );
  const input = (k: string, label: string, hint?: string) => (
    <Field label={label} hint={hint}><input className={inputClass} inputMode="decimal" disabled={!editable} value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
  );

  return (
    <Card title={s ? <span>Hậu tổng hợp <span className="font-mono">{s.code}</span> · {s.name}</span> : "Hậu tổng hợp"} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <ErrorNote error={d.error ?? act.error} />
      {s && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-4 text-xs text-slate-600 dark:text-slate-300">
            <StatusBadge status={SEQ_STATUS[s.status][0]} label={SEQ_STATUS[s.status][1]} />
            <span>MW {Number(s.mw)} Da</span>
            <span>{Number(s.nmol_per_od)} nmol/OD · {Number(s.ug_per_od)} µg/OD</span>
            <span className="font-mono break-all">{s.normalized_sequence}</span>
          </div>
          {s.status === "SYNTHESIZED" && canManage && (
            <div><Button onClick={() => act.mutate(() => api(`/api/factory/oligo/post/${id}/start`, { method: "POST" }))} disabled={act.isPending}>Bắt đầu hậu tổng hợp</Button></div>
          )}
          {rec && (
            <>
              {rec.workflow_steps ? (
                <>
                  <StepTable steps={rec.workflow_steps} logs={d.data!.steps} />
                  {editable && rec.workflow_steps[d.data!.steps.length] && (
                    <StepLogForm key={d.data!.steps.length} step={rec.workflow_steps[d.data!.steps.length]} sequenceIds={[id]} odReady={Number(rec.od_total) > 0} onDone={refresh} />
                  )}
                  <span className="text-xs text-slate-500">Dạng giao: {FORMAT[rec.format as keyof typeof FORMAT]} · Đo OD (bước định lượng):</span>
                </>
              ) : (
                <div className="flex flex-wrap gap-4 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                  {check("cleavage_done", "Cắt khỏi cột")}
                  {check("deprotection_done", "Khử bảo vệ")}
                  {check("purification_done", `Tinh sạch ${PURIFICATION[rec.purification as keyof typeof PURIFICATION]}`)}
                  <span className="text-xs text-slate-500">Dạng giao: {FORMAT[rec.format as keyof typeof FORMAT]} · Chưa có quy trình SOP cho kiểu tinh sạch này: dùng các bước cơ bản.</span>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 items-end">
                {input("a260", "A260 đo được")}
                {input("dilution_factor", "Hệ số pha loãng")}
                {input("path_cm", "Chiều dài cuvet (cm)")}
                {input("stock_volume_ul", "Thể tích dung dịch gốc (µL)")}
                {rec.format === "LIQUID" && input("target_conc_um", "Nồng độ hoàn nguyên (µM)")}
                {input("tube_count", "Số ống chia")}
              </div>
              <Field label="Ghi chú"><input className={inputClass} disabled={!editable} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
              <div className="grid gap-2 sm:grid-cols-5 text-xs p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800">
                <div><span className="text-slate-500">Tổng OD: </span><b>{fmtQty(rec.od_total)}</b></div>
                <div><span className="text-slate-500">nmol: </span><b>{fmtQty(rec.nmol)}</b></div>
                <div><span className="text-slate-500">µg: </span><b>{fmtQty(rec.ug)}</b></div>
                <div><span className="text-slate-500">OD / ống: </span><b>{fmtQty(rec.od_per_tube)}</b></div>
                {rec.format === "LIQUID" && <div><span className="text-slate-500">Thể tích hoàn nguyên: </span><b>{fmtQty(rec.resuspend_volume_ul)} µL</b></div>}
              </div>
              <p className="text-[11px] text-slate-500">Tổng OD = A260 × hệ số pha loãng × thể tích (mL) / chiều dài cuvet; nmol, µg tính theo nmol/OD, µg/OD của trình tự; thể tích hoàn nguyên = nmol / µM × 1000. Máy chủ tính khi lưu.</p>
              {editable && (
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => act.mutate(save)} disabled={act.isPending}>Lưu</Button>
                  <Button onClick={() => act.mutate(() => save().then(() => api(`/api/factory/oligo/post/${id}/submit`, { method: "POST" })))} disabled={act.isPending}>Lưu và gửi QC</Button>
                </div>
              )}
              {canLabel && rec.od_total != null && (
                <div>
                  <Button variant="ghost" onClick={() => act.mutate(() => printWithReprint([id]))} disabled={act.isPending}>In nhãn ống ({rec.tube_count})</Button>
                  {s.status !== "COMPLETED" && <span className="text-[11px] text-slate-500 ml-2">Nhãn in trước khi QC đạt ghi “CHƯA XUẤT XƯỞNG”.</span>}
                </div>
              )}
            </>
          )}
          {d.data!.qc_tests.length > 0 && (
            <Table head={["Phiếu QC", "Trạng thái", "Kết quả"]}>
              {d.data!.qc_tests.map((t) => (
                <tr key={t.id}>
                  <td className="py-1.5 pr-3 font-mono">{t.code}</td>
                  <td className="py-1.5 pr-3 text-xs">{QC_STATUS_LABEL[t.status]}</td>
                  <td className="py-1.5 pr-3">{t.overall_result ? <StatusBadge status={t.overall_result === "PASS" ? "RELEASED" : "REJECTED"} label={t.overall_result === "PASS" ? "Đạt" : "Không đạt"} /> : "—"}</td>
                </tr>
              ))}
            </Table>
          )}
          {s.status === "QC" && <p className="text-[11px] text-slate-500">Phòng QA/QC kiểm nghiệm và duyệt tại tab QA/QC → Phiếu QC. Duyệt đạt: trình tự Hoàn thành; không đạt: Lỗi và mở NCR.</p>}
        </div>
      )}
    </Card>
  );
}

const FILTERS: [string, string][] = [["", "Cần xử lý"], ["SYNTHESIZED", "Đã tổng hợp"], ["POST_PROCESSING", "Hậu tổng hợp"], ["QC", "Đang QC"], ["COMPLETED", "Hoàn thành"], ["FAILED", "Lỗi"]];

/** Sequences from finished batches through post-processing and QC. */
/** One step for several sequences at once (same next step of the same SOP), as OligoFlow's batch step logging. */
function BulkStep({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const first = useQuery({ queryKey: ["factory", "oligo-post-detail", ids[0]], queryFn: () => api<Detail>(`/api/factory/oligo/post/${ids[0]}`) });
  const rec = first.data?.record;
  const step = rec?.workflow_steps?.[first.data!.steps.length];
  if (!first.data) return null;
  if (!step) return <p className="text-[11px] text-amber-700 dark:text-amber-400">Trình tự đầu tiên đã chọn không theo SOP hoặc đã xong mọi bước.</p>;
  if (step.kind === "QUANTIFICATION") return <p className="text-[11px] text-slate-500">Bước đo OD ghi riêng từng trình tự (mở từng trình tự để nhập kết quả đo).</p>;
  return <StepLogForm key={`${ids.join()}-${step.step_no}`} step={step} sequenceIds={ids} odReady onDone={onDone} />;
}

export function PostProcessView({ canManage, canLabel }: { canManage: boolean; canLabel: boolean }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const list = useQuery({ queryKey: ["factory", "oligo-post", status], queryFn: () => api<Row[]>(`/api/factory/oligo/post${status ? `?status=${status}` : ""}`) });
  return (
    <div className="flex flex-col gap-3">
      {selected && <PostPanel key={selected} id={selected} canManage={canManage} canLabel={canLabel} onClose={() => setSelected(null)} />}
      <Card
        title="Hậu tổng hợp & QC"
        actions={
          <select className={`${inputClass} w-44`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Trạng thái">
            {FILTERS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        }
      >
        <ErrorNote error={list.error} />
        {list.data?.length === 0 && <Empty>Không có trình tự nào.</Empty>}
        {canManage && picked.length > 0 && (
          <div className="mb-3">
            <BulkStep
              ids={picked}
              onDone={() => {
                setPicked([]);
                refreshKeys.forEach((k) => qc.invalidateQueries({ queryKey: ["factory", k] }));
              }}
            />
          </div>
        )}
        {list.data && list.data.length > 0 && (
          <Table head={["", "Trình tự", "Đơn", "Hạn giao", "Thang / tinh sạch", "Tổng OD", "nmol", "QC", "Trạng thái"]}>
            {list.data.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setSelected(r.id)}>
                <td className="py-2 pr-2" onClick={(e) => e.stopPropagation()}>
                  {canManage && r.status === "POST_PROCESSING" && (
                    <input type="checkbox" checked={picked.includes(r.id)} onChange={() => setPicked(picked.includes(r.id) ? picked.filter((x) => x !== r.id) : [...picked, r.id])} aria-label={`Chọn ${r.code} để ghi bước chung`} />
                  )}
                </td>
                <td className="py-2 pr-3 font-mono text-xs">{r.code} <span className="font-sans text-slate-500">{r.name}</span></td>
                <td className="py-2 pr-3 font-mono text-xs">{r.order_code ?? "gộp"}</td>
                <td className="py-2 pr-3 text-xs whitespace-nowrap">{fmtDate(r.due_date)}</td>
                <td className="py-2 pr-3 text-xs">{r.scale_code} · {PURIFICATION[r.purification as keyof typeof PURIFICATION]}</td>
                <td className="py-2 pr-3 text-right">{fmtQty(r.od_total)}</td>
                <td className="py-2 pr-3 text-right">{fmtQty(r.nmol)}</td>
                <td className="py-2 pr-3 text-xs">{r.qc_code ? `${r.qc_code} · ${QC_STATUS_LABEL[r.qc_status!]}` : "—"}</td>
                <td className="py-2 pr-3"><StatusBadge status={SEQ_STATUS[r.status][0]} label={SEQ_STATUS[r.status][1]} /></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

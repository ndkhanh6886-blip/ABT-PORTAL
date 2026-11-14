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
import { SopConfigView } from "./SopConfigView";
import { FORMAT, PURIFICATION, SEQ_STATUS } from "./shared";

interface Row {
  id: string; code: string; name: string; status: string; scale_code: string; purification: string; format: string; base_count: number; mw: number;
  order_code: string | null; due_date: string | null; od_total: number | null; nmol: number | null; qc_code: string | null; qc_status: string | null; qc_result: string | null;
}
interface Rec {
  id: string; version: number; status: string; purification: string; format: string;
  synthesis_scale_code?: string | null; mfg_date?: string | null;
  tubes_detail?: { tube_no: number; label: string; od: number; nmol: number; ug: number; vol_100um_ul: number }[];
  cleavage_done: boolean; deprotection_done: boolean; purification_done: boolean;
  a260: string | null; dilution_factor: string; path_cm: string; stock_volume_ul: string | null; target_conc_um: string | null; tube_count: number; notes: string | null;
  od_total: string | null; nmol: string | null; ug: string | null; resuspend_volume_ul: string | null; od_per_tube: string | null;
  workflow_steps: FrozenStep[] | null;
}
interface Detail {
  sequence: { id: string; code: string; name: string; status: string; relation: string | null; normalized_sequence: string; mw: string; nmol_per_od: string; ug_per_od: string; scale_code: string; order_code: string | null };
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
      target_conc_um: num(rec.target_conc_um), tube_count: String(rec.tube_count),
      synthesis_scale_code: rec.synthesis_scale_code ?? d.data?.sequence?.scale_code ?? "200NMOL",
      mfg_date: rec.mfg_date ? String(rec.mfg_date).slice(0, 10) : new Date().toISOString().slice(0, 10),
      notes: rec.notes ?? "",
    });
  }, [rec, d.data?.sequence?.scale_code]);
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
        target_conc_um: rec!.format === "LIQUID" ? opt(f.target_conc_um) : null, tube_count: Number(f.tube_count || 1),
        synthesis_scale_code: f.synthesis_scale_code || null,
        mfg_date: f.mfg_date || null,
        notes: f.notes || null,
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
                  <StepTable steps={rec.workflow_steps} logs={d.data!.steps} seqId={id} canCorrect={editable} onCorrected={refresh} />
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
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-8 items-end">
                {input("a260", "A260 đo được")}
                {input("dilution_factor", "Hệ số pha loãng")}
                {input("path_cm", "Chiều dài cuvet (cm)")}
                {input("stock_volume_ul", "Thể tích dung dịch gốc (µL)")}
                {rec.format === "LIQUID" && input("target_conc_um", "Nồng độ hoàn nguyên (µM)")}
                {input("tube_count", "Số ống chia")}
                <Field label="Scale cột chạy máy">
                  <select className={inputClass} disabled={!editable} value={f.synthesis_scale_code ?? ""} onChange={(e) => setF({ ...f, synthesis_scale_code: e.target.value })}>
                    <option value="25NMOL">25 nmol</option>
                    <option value="50NMOL">50 nmol</option>
                    <option value="200NMOL">200 nmol</option>
                    <option value="1UMOL">1 µmol</option>
                    <option value="10UMOL">10 µmol</option>
                  </select>
                </Field>
                <Field label="Ngày MFG (Theo mẻ chạy)">
                  <input type="date" className={inputClass} disabled={!editable} value={f.mfg_date ?? ""} onChange={(e) => setF({ ...f, mfg_date: e.target.value })} />
                </Field>
              </div>
              <Field label="Ghi chú"><input className={inputClass} disabled={!editable} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
              <div className="grid gap-2 sm:grid-cols-6 text-xs p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800">
                <div><span className="text-slate-500">Tổng OD: </span><b>{fmtQty(rec.od_total)}</b></div>
                <div><span className="text-slate-500">nmol: </span><b>{fmtQty(rec.nmol)}</b></div>
                <div><span className="text-slate-500">µg: </span><b>{fmtQty(rec.ug)}</b></div>
                <div><span className="text-slate-500">OD / ống: </span><b>{fmtQty(rec.od_per_tube)}</b></div>
                <div><span className="text-slate-500">Thể tích pha 100 µM: </span><b className="text-sky-700">{rec.nmol ? `${fmtQty(Number(rec.nmol) * 10)} µL` : "—"}</b></div>
                {rec.format === "LIQUID" && <div><span className="text-slate-500">Thể tích hoàn nguyên: </span><b>{fmtQty(rec.resuspend_volume_ul)} µL</b></div>}
              </div>
              {Array.isArray(rec.tubes_detail) && rec.tubes_detail.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Bảng chia ống thành phẩm ({rec.tubes_detail.length} ống · Ngày MFG: {fmtDate(rec.mfg_date)})
                  </div>
                  <Table head={["Ống số", "Nhãn ống", "OD / ống", "nmol / ống", "µg / ống", "Thể tích pha 100 µM (µL)"]}>
                    {rec.tubes_detail.map((tb) => (
                      <tr key={tb.tube_no}>
                        <td className="py-1 pr-3 text-xs font-mono">#{tb.tube_no}</td>
                        <td className="py-1 pr-3 text-xs font-semibold">{tb.label}</td>
                        <td className="py-1 pr-3 text-xs font-mono">{fmtQty(tb.od)}</td>
                        <td className="py-1 pr-3 text-xs font-mono">{fmtQty(tb.nmol)}</td>
                        <td className="py-1 pr-3 text-xs font-mono">{fmtQty(tb.ug)}</td>
                        <td className="py-1 pr-3 text-xs font-mono font-bold text-sky-700">{fmtQty(tb.vol_100um_ul)} µL</td>
                      </tr>
                    ))}
                  </Table>
                </div>
              )}
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
          {s.relation === "POOL_MASTER" && rec && Number(rec.od_total) > 0 && <PoolAliquotForm masterId={id} canEdit={canManage} onDone={refresh} />}
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
  const [subView, setSubView] = useState<"PROCESSING" | "COMPLETED" | "SOP" | "HPLC_COLUMNS">("PROCESSING");
  const [selected, setSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [orderFilter, setOrderFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [batchA260, setBatchA260] = useState("");
  const [batchTsvText, setBatchTsvText] = useState("");
  const [batchDilution, setBatchDilution] = useState("10");
  const [batchVolUl, setBatchVolUl] = useState("200");
  const [batchTubeCount, setBatchTubeCount] = useState("1");
  const effectiveStatus = subView === "COMPLETED" ? "COMPLETED" : status;
  const list = useQuery({
    queryKey: ["factory", "oligo-post", effectiveStatus],
    queryFn: () => api<Row[]>(`/api/factory/oligo/post${effectiveStatus ? `?status=${effectiveStatus}` : ""}`),
  });

  const batchAct = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api("/api/factory/oligo/post", { method: "POST", json: payload }),
    onSuccess: () => {
      setPicked([]);
      setBatchTsvText("");
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
        const hay = `${r.code} ${r.name ?? ""} ${r.order_code ?? ""} ${r.qc_code ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [list.data, orderFilter, searchQuery]);

  return (
    <div className="flex flex-col gap-3">
      {/* Thanh tab con y hệt màn hình Xử lý Sau Tổng Hợp của OligoFlow (abt-portal.online) */}
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
        <>
          {selected && <PostPanel key={selected} id={selected} canManage={canManage} canLabel={canLabel} onClose={() => setSelected(null)} />}
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
                  <select className={`${inputClass} w-44`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Trạng thái">
                    {FILTERS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                )}
              </div>
            }
          >
            <ErrorNote error={list.error ?? batchAct.error} />
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
                {canManage && filteredList.some((r) => r.status === "SYNTHESIZED" || r.status === "POST_PROCESSING") && (
                  <button
                    type="button"
                    onClick={() => {
                      const selectableIds = filteredList
                        .filter((r) => r.status === "SYNTHESIZED" || r.status === "POST_PROCESSING")
                        .map((r) => r.id);
                      const allSelected = selectableIds.every((id) => picked.includes(id));
                      setPicked(allSelected ? [] : selectableIds);
                    }}
                    className="ml-auto px-2.5 py-0.5 rounded-lg text-xs font-bold border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-200 cursor-pointer"
                  >
                    ☑️ Chọn / Bỏ chọn toàn bộ danh sách đang lọc ({filteredList.filter((r) => r.status === "SYNTHESIZED" || r.status === "POST_PROCESSING").length})
                  </button>
                )}
              </div>
            )}
            {filteredList.length === 0 && <Empty>Không có trình tự nào.</Empty>}
            {canManage && picked.length > 0 && (
              <div className="mb-3 space-y-2 rounded-xl border border-sky-300 dark:border-sky-800 bg-sky-50/60 dark:bg-sky-950/30 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-bold text-sky-900 dark:text-sky-200">
                    ⚡ Xử lý Hàng loạt theo Mẻ / Khay ({picked.length} trình tự đã chọn)
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="ghost"
                      disabled={batchAct.isPending}
                      onClick={() => batchAct.mutate({ action: "batch_start", sequence_ids: picked })}
                    >
                      ▶️ Bắt đầu Hậu tổng hợp ({picked.length})
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={batchAct.isPending}
                      onClick={() => batchAct.mutate({ action: "batch_submit_qc", sequence_ids: picked })}
                    >
                      📤 Gửi QC các chuỗi đã đo OD
                    </Button>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-6 items-end pt-1 border-t border-sky-200 dark:border-sky-800/70">
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
                    <input className={inputClass} value={batchDilution} onChange={(e) => setBatchDilution(e.target.value)} />
                  </Field>
                  <Field label="Thể tích gốc (µL)">
                    <input className={inputClass} value={batchVolUl} onChange={(e) => setBatchVolUl(e.target.value)} />
                  </Field>
                  <Field label="Số ống / chuỗi">
                    <input className={inputClass} value={batchTubeCount} onChange={(e) => setBatchTubeCount(e.target.value)} />
                  </Field>
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
                    🧪 Ghi Cắt cột + Tinh sạch + Đo OD Hàng loạt
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
                    🚀 Hoàn tất Hậu tổng hợp &amp; Gửi QC Hàng loạt
                  </Button>
                </div>
                <div className="pt-1 border-t border-sky-200/70 dark:border-sky-800/50 space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium text-sky-900 dark:text-sky-200">
                    <span>📋 Dán bảng kết quả máy đọc khay / NanoDrop (96 giếng): mỗi dòng `Mã_Trình_Tự[Tab]A260` hoặc cột số A260 theo thứ tự đã chọn</span>
                    <span className="font-mono">
                      Đã khớp: <b>{Object.keys(parsedPerSeqA260).length}</b> / {picked.length} trình tự
                    </span>
                  </div>
                  <textarea
                    className={`${inputClass} min-h-[68px] font-mono text-xs`}
                    placeholder={"VD:\nOL-2601-001\t1.45\nOL-2601-002\t1.62"}
                    value={batchTsvText}
                    onChange={(e) => setBatchTsvText(e.target.value)}
                  />
                </div>
                <BulkStep
                  ids={picked}
                  onDone={() => {
                    setPicked([]);
                    refreshKeys.forEach((k) => qc.invalidateQueries({ queryKey: ["factory", k] }));
                  }}
                />
              </div>
            )}
            {filteredList.length > 0 && (
              <Table head={["", "Trình tự", "Đơn", "Hạn giao", "Thang / tinh sạch", "Tổng OD", "nmol", "QC", "Trạng thái"]}>
                {filteredList.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setSelected(r.id)}>
                    <td className="py-2 pr-2" onClick={(e) => e.stopPropagation()}>
                      {canManage && (r.status === "POST_PROCESSING" || r.status === "SYNTHESIZED") && (
                        <input type="checkbox" checked={picked.includes(r.id)} onChange={() => setPicked(picked.includes(r.id) ? picked.filter((x) => x !== r.id) : [...picked, r.id])} aria-label={`Chọn ${r.code} để xử lý hàng loạt`} />
                      )}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{r.code} <span className="font-sans text-slate-500">{r.name}</span></td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOrderFilter(r.order_code ?? "__POOL__");
                        }}
                        title="Bấm để lọc riêng các trình tự thuộc đơn này"
                        className="font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                      >
                        {r.order_code ?? "gộp"}
                      </button>
                    </td>
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
        </>
      )}
    </div>
  );
}

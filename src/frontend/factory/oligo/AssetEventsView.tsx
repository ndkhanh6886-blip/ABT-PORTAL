"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";

interface Ev {
  id: string; code: string; asset_id: string; asset_code: string; asset_name: string; kind: string; status: string; planned_date: string; assignee: string | null; description: string | null;
  out_of_service: boolean; done_date: string | null; performed_by: string | null; result: string | null; passed: boolean | null; next_due: string | null; cost_vnd: number | null;
  cancel_reason: string | null; version: number; files: number; actions: AllowedAction[];
}
interface Due { id: string; code: string; name: string; next_calibration_due: string; status: string; planned: boolean }
interface AssetOpt { id: string; code: string; name: string; status: string }

const KIND: Record<string, string> = { MAINTENANCE: "Bảo trì định kỳ", CALIBRATION: "Hiệu chuẩn", REPAIR: "Sửa chữa", CLEANING: "Vệ sinh / rửa máy", QUALIFICATION: "Thẩm định (IQ/OQ/PQ)" };
const SIGNED = ["CALIBRATION", "REPAIR", "QUALIFICATION"];
const ST: Record<string, [string, string]> = { PLANNED: ["QUARANTINE", "Kế hoạch"], DONE: ["RELEASED", "Đã thực hiện"], CANCELLED: ["EXPIRED", "Đã hủy"] };
const vnd = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ`);
const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

function PlanForm({ assets, preset, onDone }: { assets: AssetOpt[]; preset?: { asset_id: string; kind: string }; onDone: () => void }) {
  const [f, setF] = useState({ asset_id: preset?.asset_id ?? "", kind: preset?.kind ?? "MAINTENANCE", planned_date: today(), assignee: "", description: "", out_of_service: false });
  const plan = useMutation({
    mutationFn: () => api("/api/factory/assets/events", { method: "POST", idempotent: true, json: { ...f, assignee: f.assignee || null, description: f.description || null } }),
    onSuccess: () => {
      setF({ ...f, description: "", assignee: "", out_of_service: false });
      onDone();
    },
  });
  return (
    <form className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 items-end mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800" onSubmit={(e) => { e.preventDefault(); plan.mutate(); }}>
      <Field label="Thiết bị *">
        <select className={inputClass} value={f.asset_id} onChange={(e) => setF({ ...f, asset_id: e.target.value })} required>
          <option value="">Chọn</option>
          {assets.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
        </select>
      </Field>
      <Field label="Loại">
        <select className={inputClass} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Ngày dự kiến *"><input className={inputClass} type="date" value={f.planned_date} onChange={(e) => setF({ ...f, planned_date: e.target.value })} required /></Field>
      <Field label="Người / đơn vị thực hiện"><input className={inputClass} value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })} /></Field>
      <Field label="Mô tả / lý do báo hỏng"><input className={inputClass} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={f.out_of_service} onChange={(e) => setF({ ...f, out_of_service: e.target.checked })} />Báo hỏng: ngừng dùng máy ngay</label>
        <Button type="submit" disabled={plan.isPending}>+ Lập phiếu</Button>
      </div>
      <div className="sm:col-span-3 lg:col-span-6"><ErrorNote error={plan.error} /></div>
    </form>
  );
}

/** Completion with the actual result (and a PIN signature for calibration, repair and qualification). */
function CompleteForm({ ev, onDone }: { ev: Ev; onDone: () => void }) {
  const signed = SIGNED.includes(ev.kind);
  const [f, setF] = useState({ done_date: today(), performed_by: ev.assignee ?? "", result: "", passed: "", next_due: "", cost_vnd: "", pin: "" });
  const complete = useMutation({
    mutationFn: () =>
      api(`/api/factory/assets/events/${ev.id}/actions`, {
        method: "POST",
        json: {
          action: signed ? "complete_signed" : "complete",
          expectedVersion: ev.version,
          payload: {
            done_date: f.done_date, performed_by: f.performed_by, result: f.result, passed: f.passed === "" ? null : f.passed === "true",
            next_due: f.next_due || null, cost_vnd: f.cost_vnd === "" ? null : Number(f.cost_vnd),
          },
          credential: signed ? { method: "PIN", secret: f.pin } : undefined,
        },
      }),
    onSuccess: onDone,
  });
  return (
    <form className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7 items-end p-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/30" onSubmit={(e) => { e.preventDefault(); complete.mutate(); }}>
      <Field label="Ngày thực hiện *"><input className={inputClass} type="date" max={today()} value={f.done_date} onChange={(e) => setF({ ...f, done_date: e.target.value })} required /></Field>
      <Field label="Người / đơn vị *"><input className={inputClass} value={f.performed_by} onChange={(e) => setF({ ...f, performed_by: e.target.value })} required /></Field>
      <Field label="Kết quả / linh kiện thay *"><input className={inputClass} value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })} required /></Field>
      {["CALIBRATION", "QUALIFICATION"].includes(ev.kind) && (
        <Field label="Kết luận *">
          <select className={inputClass} value={f.passed} onChange={(e) => setF({ ...f, passed: e.target.value })} required>
            <option value="">Chọn</option>
            <option value="true">Đạt</option>
            <option value="false">Không đạt</option>
          </select>
        </Field>
      )}
      {ev.kind === "CALIBRATION" && <Field label="Hạn hiệu chuẩn tiếp" hint="Trống: theo chu kỳ của máy"><input className={inputClass} type="date" value={f.next_due} onChange={(e) => setF({ ...f, next_due: e.target.value })} /></Field>}
      <Field label="Chi phí (VNĐ)"><input className={inputClass} inputMode="numeric" value={f.cost_vnd} onChange={(e) => setF({ ...f, cost_vnd: e.target.value.replace(/\D/g, "") })} /></Field>
      {signed && <Field label="Mã PIN chữ ký *"><input className={inputClass} type="password" inputMode="numeric" autoComplete="off" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} required /></Field>}
      <Button type="submit" disabled={complete.isPending}>{signed ? "Ký & hoàn thành" : "Hoàn thành"}</Button>
      <div className="sm:col-span-3 lg:col-span-7"><ErrorNote error={complete.error} /></div>
    </form>
  );
}

function Files({ ev }: { ev: Ev }) {
  const qc = useQueryClient();
  const files = useQuery({ queryKey: ["factory", "asset-event-files", ev.id], queryFn: () => api<{ id: string; file_name: string }[]>(`/api/factory/assets/events/${ev.id}/files`) });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/factory/assets/events/${ev.id}/files`, { method: "POST", body: fd, credentials: "same-origin" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Lỗi ${res.status}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "asset-event-files", ev.id] });
      qc.invalidateQueries({ queryKey: ["factory", "asset-events"] });
    },
  });
  return (
    <div className="flex flex-wrap gap-2 items-center text-xs">
      {files.data?.map((f) => <a key={f.id} className="text-sky-700 dark:text-sky-400 underline" href={`/api/factory/assets/events/${ev.id}/files/${f.id}`} target="_blank" rel="noreferrer">{f.file_name}</a>)}
      <label className="cursor-pointer text-slate-500 hover:text-sky-700">
        + Đính kèm (biên bản, hóa đơn, báo cáo)
        <input type="file" className="hidden" accept=".pdf,.docx,.xlsx,image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
      </label>
      {upload.error != null && <ErrorNote error={upload.error} />}
    </div>
  );
}

/** "Kế hoạch bảo trì, hiệu chuẩn & sửa chữa" (as OligoFlow): plans, breakdowns, completions with cost and documents. */
export function AssetEventsView({ canPlan }: { canPlan: boolean }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState("PLANNED");
  const [open, setOpen] = useState<string | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  const [preset, setPreset] = useState<{ asset_id: string; kind: string } | undefined>();
  const data = useQuery({ queryKey: ["factory", "asset-events", status], queryFn: () => api<{ events: Ev[]; calibration_due: Due[] }>(`/api/factory/assets/events${status ? `?status=${status}` : ""}`) });
  const assets = useQuery({ queryKey: ["factory", "assets", "all"], queryFn: () => api<AssetOpt[]>("/api/factory/assets") });
  const refresh = () => {
    setOpen(null);
    setShowPlan(false);
    setPreset(undefined);
    ["asset-events", "assets", "asset-slots", "oligo-batch-candidates"].forEach((k) => qc.invalidateQueries({ queryKey: ["factory", k] }));
  };
  return (
    <Card
      title="Kế hoạch bảo trì, hiệu chuẩn & sửa chữa"
      actions={
        <div className="flex items-center gap-2">
          {canPlan && (
            <Button onClick={() => setShowPlan((v) => !v)}>
              {showPlan || preset ? "Đóng form lập phiếu" : "+ Lập phiếu bảo trì / hiệu chuẩn"}
            </Button>
          )}
          <select className={`${inputClass} w-40`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Trạng thái">
            <option value="PLANNED">Đang kế hoạch</option>
            <option value="DONE">Đã thực hiện</option>
            <option value="CANCELLED">Đã hủy</option>
            <option value="">Tất cả</option>
          </select>
        </div>
      }
    >
      {canPlan && assets.data && (showPlan || preset) && <PlanForm key={preset ? `${preset.asset_id}-${preset.kind}` : "new"} assets={assets.data} preset={preset} onDone={refresh} />}
      <ErrorNote error={data.error} />
      {data.data && data.data.calibration_due.length > 0 && (
        <div className="mb-3 p-3 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/20 text-xs flex flex-col gap-1">
          <b>Sắp đến / quá hạn hiệu chuẩn (30 ngày)</b>
          {data.data.calibration_due.map((a) => (
            <div key={a.id} className="flex flex-wrap gap-2 items-center">
              <span className="font-mono">{a.code}</span> {a.name} — hạn {fmtDate(a.next_calibration_due)}{a.next_calibration_due < today() && <b className="text-rose-600"> (quá hạn)</b>}
              {a.planned ? <span className="text-slate-500">đã lập phiếu</span> : canPlan && <button className="text-sky-700 dark:text-sky-400 underline cursor-pointer" onClick={() => setPreset({ asset_id: a.id, kind: "CALIBRATION" })}>Lập phiếu hiệu chuẩn</button>}
            </div>
          ))}
        </div>
      )}
      {data.data?.events.length === 0 && <Empty>Không có phiếu.</Empty>}
      {data.data && data.data.events.length > 0 && (
        <Table head={["Phiếu", "Thiết bị", "Loại", "Ngày dự kiến / thực hiện", "Thực hiện / kết quả", "Chi phí", "Trạng thái", ""]}>
          {data.data.events.map((e) => (
            <React.Fragment key={e.id}>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-xs">{e.code}</td>
                <td className="py-1.5 pr-3 text-xs">{e.asset_code} · {e.asset_name}</td>
                <td className="py-1.5 pr-3 text-xs">{KIND[e.kind]}{e.out_of_service && <div className="text-rose-600">Báo hỏng — ngừng máy</div>}</td>
                <td className="py-1.5 pr-3 text-xs whitespace-nowrap">{fmtDate(e.planned_date)}{e.done_date && <div>→ {fmtDate(e.done_date)}</div>}</td>
                <td className="py-1.5 pr-3 text-xs">
                  {e.description && <div className="text-slate-500">{e.description}</div>}
                  {e.performed_by && <div>{e.performed_by}: {e.result}{e.passed != null && <b> — {e.passed ? "Đạt" : "Không đạt"}</b>}{e.next_due && ` · hạn tiếp ${fmtDate(e.next_due)}`}</div>}
                  {e.cancel_reason && <div className="text-rose-600">Hủy: {e.cancel_reason}</div>}
                </td>
                <td className="py-1.5 pr-3 text-right text-xs whitespace-nowrap">{vnd(e.cost_vnd)}</td>
                <td className="py-1.5 pr-3"><StatusBadge status={ST[e.status][0]} label={ST[e.status][1]} /></td>
                <td className="py-1.5 pr-3 text-right"><Button variant="ghost" onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? "Đóng" : "Chi tiết"}</Button></td>
              </tr>
              {open === e.id && (
                <tr>
                  <td colSpan={8} className="pb-3">
                    <div className="flex flex-col gap-2">
                      {/* the server lists only actions the user may run; results are entered in the form, so its guard is not shown */}
                      {e.status === "PLANNED" && e.actions.some((a) => a.action === (SIGNED.includes(e.kind) ? "complete_signed" : "complete")) && <CompleteForm ev={e} onDone={refresh} />}
                      <ActionBar endpoint={`/api/factory/assets/events/${e.id}/actions`} version={e.version} actions={e.actions.filter((a) => a.action === "cancel")} labels={{ cancel: "Hủy phiếu" }} onDone={refresh} />
                      <Files ev={e} />
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

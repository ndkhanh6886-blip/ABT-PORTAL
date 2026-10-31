"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass } from "../ui";
import { useOligoUnits } from "./shared";

interface Task {
  id: string; kind: string; title: string; assignee_id: number | null; assignee_name: string | null; work_date: string; start_time: string; end_time: string;
  duration_h: number; regular_h: number; overtime_h: number; notes: string | null; status: string; version: number; ref_type: string | null;
}
interface Board {
  date: string; window: { start: string; end: string };
  totals: { tasks: number; done: number; hours: number; regular_h: number; overtime_h: number };
  staff: { user_id: number; display_name: string; tasks: Task[]; done: number; regular_h: number; overtime_h: number }[];
  unassigned: Task[];
  backlog: { kind: string; title: string; detail: string; ref_type: string; ref_id: string; count?: number }[];
  can_manage: boolean;
}
interface Draft { id?: string; version?: number; kind: string; title: string; assignee_id: string; work_date: string; start_time: string; end_time: string; notes: string; ref_type?: string; ref_id?: string }

const KIND: Record<string, string> = {
  SYNTHESIS: "Tổng hợp Oligo",
  POST_PROCESS: "Hậu tổng hợp / Tinh sạch",
  QC: "Kiểm định QC / QA",
  PREPARATION: "Pha chế / Sản xuất Kit",
  EQUIPMENT: "Thiết bị / Lắp ráp DHR",
  OTHER: "Nghiên cứu R&D / Khác",
};
const SLOTS: [string, string, string][] = [["Sáng", "08:00", "12:00"], ["Chiều", "13:00", "17:00"], ["Cả ngày", "08:00", "17:00"], ["Tăng ca tối", "17:00", "20:00"]];
const STATUS_STYLE: Record<string, string> = {
  TODO: "border-slate-300 dark:border-slate-700",
  IN_PROGRESS: "border-sky-400 bg-sky-50 dark:bg-sky-950/30",
  DONE: "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 opacity-80",
};
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const h = (n: number) => `${n.toLocaleString("vi-VN")}h`;

function TaskForm({ unit, staff, draft, onClose, onDone }: { unit: string; staff: Board["staff"]; draft: Draft; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState(draft);
  const save = useMutation({
    mutationFn: () => {
      const body = { org_unit_id: unit, kind: f.kind, title: f.title, assignee_id: f.assignee_id ? Number(f.assignee_id) : null, work_date: f.work_date, start_time: f.start_time, end_time: f.end_time, notes: f.notes || null, ref_type: f.ref_type ?? null, ref_id: f.ref_id ?? null };
      return f.id ? api(`/api/factory/plan/tasks/${f.id}`, { method: "PUT", json: { ...body, version: f.version } }) : api("/api/factory/plan/tasks", { method: "POST", idempotent: true, json: body });
    },
    onSuccess: onDone,
  });
  return (
    <form className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 items-end p-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/30" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Field label="Loại việc">
        <select className={inputClass} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <div className="lg:col-span-2"><Field label="Tiêu đề *"><input className={inputClass} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></Field></div>
      <Field label="Nhân sự">
        <select className={inputClass} value={f.assignee_id} onChange={(e) => setF({ ...f, assignee_id: e.target.value })}>
          <option value="">— chưa giao —</option>
          {staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.display_name}</option>)}
        </select>
      </Field>
      <Field label="Ngày *"><input className={inputClass} type="date" value={f.work_date} onChange={(e) => setF({ ...f, work_date: e.target.value })} required /></Field>
      <div className="flex gap-1 items-end">
        <Field label="Từ"><input className={`${inputClass} w-20`} value={f.start_time} onChange={(e) => setF({ ...f, start_time: e.target.value })} placeholder="08:00" required /></Field>
        <Field label="Đến"><input className={`${inputClass} w-20`} value={f.end_time} onChange={(e) => setF({ ...f, end_time: e.target.value })} placeholder="17:00" required /></Field>
      </div>
      <div className="sm:col-span-3 lg:col-span-6 flex flex-wrap gap-1 text-xs">
        {SLOTS.map(([l, s, e]) => (
          <button type="button" key={l} className={`px-2 py-1 rounded-lg border cursor-pointer ${f.start_time === s && f.end_time === e ? "border-sky-500 bg-sky-100 dark:bg-sky-900" : "border-slate-300 dark:border-slate-700"}`} onClick={() => setF({ ...f, start_time: s, end_time: e })}>
            {l} ({s} – {e})
          </button>
        ))}
      </div>
      <div className="sm:col-span-3 lg:col-span-5"><Field label="Ghi chú / chỉ dẫn"><input className={inputClass} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>Hủy</Button>
        <Button type="submit" disabled={save.isPending}>{f.id ? "Lưu" : "Lưu & phân công"}</Button>
      </div>
      <div className="sm:col-span-3 lg:col-span-6"><ErrorNote error={save.error} /></div>
    </form>
  );
}

function TaskChip({ t, canManage, canMove, onEdit, onStatus }: { t: Task; canManage: boolean; canMove: boolean; onEdit: () => void; onStatus: (s: string) => void }) {
  return (
    <div className={`flex flex-col gap-0.5 p-2 rounded-lg border text-xs w-56 ${STATUS_STYLE[t.status] ?? ""}`}>
      <div className="flex justify-between gap-2"><b className="truncate">{t.title}</b><span className="whitespace-nowrap text-slate-500">{t.start_time}–{t.end_time}</span></div>
      <div className="text-slate-500">{KIND[t.kind]} · {h(t.duration_h)}{t.overtime_h > 0 && <span className="text-amber-700 dark:text-amber-400"> · tăng ca {h(t.overtime_h)}</span>}</div>
      {t.notes && <div className="text-slate-500 line-clamp-2">{t.notes}</div>}
      <div className="flex gap-2 mt-1">
        {canMove && t.status === "TODO" && <button className="text-sky-700 dark:text-sky-400 underline cursor-pointer" onClick={() => onStatus("IN_PROGRESS")}>Bắt đầu</button>}
        {canMove && t.status !== "DONE" && <button className="text-emerald-700 dark:text-emerald-400 underline cursor-pointer" onClick={() => onStatus("DONE")}>Xong</button>}
        {canManage && <button className="underline cursor-pointer" onClick={onEdit}>Sửa</button>}
        {canManage && t.status !== "DONE" && <button className="text-rose-600 underline cursor-pointer" onClick={() => onStatus("CANCELLED")}>Hủy</button>}
      </div>
    </div>
  );
}

/** "Kế hoạch & khối lượng công việc" (as OligoFlow): who does what and when, regular and overtime hours, the backlog. */
export function PlannerView({ myUserId, departmentHint }: { myUserId: number | null; departmentHint?: string }) {
  const qc = useQueryClient();
  const units = useOligoUnits("plan.view");
  const [unitId, setUnitId] = useState("");
  const unit = unitId || units.data?.[0]?.id || "";

  React.useEffect(() => {
    if (!departmentHint || departmentHint === "all" || !units.data?.length) return;
    const h = departmentHint.toLowerCase();
    const matched = (units.data as Array<{ id: string; code: string; name: string; module_key?: string }>).find((u) => {
      const n = `${u.code} ${u.name} ${u.module_key ?? ""}`.toLowerCase();
      if (h.includes("r&d") || h.includes("nghiên cứu")) return u.module_key === "RD" || n.includes("r&d") || n.includes("nghiên cứu");
      if (h.includes("kit")) return u.module_key === "KIT" || n.includes("kit");
      if (h.includes("oligo")) return u.module_key === "OLIGO" || n.includes("oligo");
      if (h.includes("thiết bị") || h.includes("kỹ thuật")) return u.module_key === "DEVICE" || n.includes("thiết bị");
      if (h.includes("qa") || h.includes("qc") || h.includes("pháp chế")) return u.module_key === "QMS" || n.includes("qa") || n.includes("qc");
      return n.includes(h);
    });
    if (matched) setUnitId(matched.id);
  }, [departmentHint, units.data]);
  const [date, setDate] = useState(today());
  const [draft, setDraft] = useState<Draft | null>(null);
  const board = useQuery({ queryKey: ["factory", "plan", unit, date], enabled: !!unit, queryFn: () => api<Board>(`/api/factory/plan?org_unit_id=${unit}&date=${date}`) });
  const refresh = () => {
    setDraft(null);
    qc.invalidateQueries({ queryKey: ["factory", "plan"] });
  };
  const status = useMutation({ mutationFn: ({ t, s }: { t: Task; s: string }) => api(`/api/factory/plan/tasks/${t.id}/status`, { method: "POST", json: { status: s, version: t.version } }), onSuccess: refresh });
  const b = board.data;
  const blank = (over: Partial<Draft> = {}): Draft => ({ kind: "OTHER", title: "", assignee_id: "", work_date: date, start_time: "08:00", end_time: "12:00", notes: "", ...over });
  const edit = (t: Task) => setDraft({ id: t.id, version: t.version, kind: t.kind, title: t.title, assignee_id: t.assignee_id ? String(t.assignee_id) : "", work_date: t.work_date.slice(0, 10), start_time: t.start_time, end_time: t.end_time, notes: t.notes ?? "" });
  if (units.data && !units.data.length) return <Empty>Bạn chưa có quyền xem kế hoạch công việc của phòng nào.</Empty>;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (
    <div className="flex flex-col gap-3">
      <Card
        title="Kế hoạch & khối lượng công việc"
        actions={
          <div className="flex gap-1 items-center">
            {(units.data?.length ?? 0) > 1 && (
              <select className={`${inputClass} w-44`} value={unit} onChange={(e) => setUnitId(e.target.value)} aria-label="Phòng">
                {units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
            <Button variant="ghost" onClick={() => setDate(shift(date, -1))} aria-label="Ngày trước">‹</Button>
            <input className={`${inputClass} w-40`} type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <Button variant="ghost" onClick={() => setDate(shift(date, 1))} aria-label="Ngày sau">›</Button>
            <Button variant="ghost" onClick={() => setDate(today())}>Hôm nay</Button>
          </div>
        }
      >
        <ErrorNote error={board.error ?? status.error} />
        {b && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-2 grid-cols-2 lg:grid-cols-4 text-xs">
              {[
                ["Tổng công việc", `${b.totals.tasks}`, `${b.totals.done} đã xong`],
                ["Tổng thời gian", h(b.totals.hours), "khối lượng giờ trong ngày"],
                ["Giờ hành chính", h(b.totals.regular_h), `${b.window.start} – ${b.window.end}${weekday === 0 || weekday === 6 ? " (cuối tuần: tính tăng ca)" : ""}`],
                ["Tăng ca", h(b.totals.overtime_h), "ngoài giờ / cuối tuần"],
              ].map(([k, v, s]) => (
                <div key={k} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="text-slate-500">{k}</div>
                  <div className="text-xl font-bold">{v}</div>
                  <div className="text-[11px] text-slate-500">{s}</div>
                </div>
              ))}
            </div>
            {draft && <TaskForm key={draft.id ?? `${draft.ref_type}-${draft.ref_id}-${draft.title}`} unit={unit} staff={b.staff} draft={draft} onClose={() => setDraft(null)} onDone={refresh} />}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <b className="text-xs">Bảng phân công nhân sự</b>
                  {b.can_manage && <Button variant="ghost" onClick={() => setDraft(blank())}>+ Lập công việc</Button>}
                </div>
                {b.staff.length === 0 && <Empty>Phòng chưa có nhân sự được cấp vai trò.</Empty>}
                {b.staff.map((s) => (
                  <div key={s.user_id} className="p-2 rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="flex justify-between text-xs mb-1">
                      <b>{s.display_name}</b>
                      <span className="text-slate-500">{s.tasks.length} việc ({s.done} xong) · {h(s.regular_h)}{s.overtime_h > 0 && <span className="text-amber-700 dark:text-amber-400"> + {h(s.overtime_h)} tăng ca</span>}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {s.tasks.length === 0 && <span className="text-[11px] text-slate-400">Chưa có công việc trong ngày.</span>}
                      {s.tasks.map((t) => <TaskChip key={t.id} t={t} canManage={b.can_manage} canMove={b.can_manage || t.assignee_id === myUserId} onEdit={() => edit(t)} onStatus={(x) => status.mutate({ t, s: x })} />)}
                    </div>
                  </div>
                ))}
                {b.unassigned.length > 0 && (
                  <div className="p-2 rounded-xl border border-dashed border-amber-300 dark:border-amber-800">
                    <b className="text-xs">Chưa giao người</b>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {b.unassigned.map((t) => <TaskChip key={t.id} t={t} canManage={b.can_manage} canMove={b.can_manage} onEdit={() => edit(t)} onStatus={(x) => status.mutate({ t, s: x })} />)}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <b className="text-xs">Hồ công việc chờ xếp</b>
                {b.backlog.length === 0 && <span className="text-[11px] text-slate-400">Không có việc chờ.</span>}
                {b.backlog.map((x) => (
                  <div key={`${x.ref_type}-${x.ref_id}`} className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-xs flex flex-col gap-1">
                    <div className="flex justify-between gap-2"><b>{x.title}</b><span className="text-slate-500 whitespace-nowrap">{KIND[x.kind]}</span></div>
                    <div className="text-slate-500 line-clamp-2">{x.detail}</div>
                    {b.can_manage && <div><button className="text-sky-700 dark:text-sky-400 underline cursor-pointer" onClick={() => setDraft(blank({ kind: x.kind, title: x.title, notes: x.detail, ref_type: x.ref_type, ref_id: x.ref_id }))}>Xếp việc</button></div>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

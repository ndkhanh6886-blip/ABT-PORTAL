"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { useRdContext } from "./shared";

const PLAN_STATUS: Record<string, [string, string]> = {
  DRAFT: ["QUARANTINE", "Nháp"],
  PENDING_APPROVAL: ["PENDING_QC", "Chờ quản lý duyệt"],
  APPROVED: ["RELEASED", "Đã duyệt (Cho phép ghi kết quả)"],
  NEEDS_REVISION: ["ON_HOLD", "Yêu cầu chỉnh sửa"],
  CLOSED: ["EXPIRED", "Đã đóng & đánh giá tuần"],
};

const TASK_STATUS: Record<string, [string, string]> = {
  PLANNED: ["QUARANTINE", "Kế hoạch"],
  IN_PROGRESS: ["PENDING_QC", "Đang thực hiện"],
  DONE: ["RELEASED", "Hoàn thành"],
  DEFERRED: ["ON_HOLD", "Đã hoãn"],
  REPLACED: ["EXPIRED", "Đã thay thế"],
};

const DAYS = ["", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "CN"];

const PLAN_ACTIONS = {
  submit: "Gửi duyệt kế hoạch tuần",
  approve: "Duyệt kế hoạch tuần",
  return: "Trả lại yêu cầu sửa",
  close: "Đóng tuần & Chốt đánh giá",
};

function currentMonday(): string {
  const now = new Date(Date.now() + 7 * 3600_000);
  const day = now.getUTCDay() || 7; // 1 = Mon .. 7 = Sun
  now.setUTCDate(now.getUTCDate() - day + 1);
  return now.toISOString().slice(0, 10);
}

interface WorkTask {
  id: string;
  title: string;
  day_of_week: number;
  time_slot: string;
  project_code: string | null;
  experiment_code: string | null;
  target_metric: string | null;
  is_unplanned: boolean;
  status: string;
  result_summary: string | null;
  efficiency_rating: number | null;
  manager_comment: string | null;
  defer_category: string | null;
  defer_reason: string | null;
  version: number;
}

interface WorkPlanDetail {
  id: string;
  code: string;
  user_id: number;
  user_name: string;
  org_unit_id: string;
  org_unit_name: string;
  week_start: string;
  summary_notes: string | null;
  status: string;
  approved_by_name: string | null;
  approved_at: string | null;
  review_note: string | null;
  version: number;
  tasks: WorkTask[];
  actions: AllowedAction[];
  can_approve: boolean;
}

function TaskActionRow({
  t,
  planStatus,
  canApprove,
  onDone,
}: {
  t: WorkTask;
  planStatus: string;
  canApprove: boolean;
  onDone: () => void;
}) {
  const [resultText, setResultText] = useState(t.result_summary ?? "");
  const [deferCat, setDeferCat] = useState<"OBJECTIVE" | "SUBJECTIVE">("OBJECTIVE");
  const [deferReason, setDeferReason] = useState("");
  const [rating, setRating] = useState(t.efficiency_rating ?? 5);
  const [comment, setComment] = useState(t.manager_comment ?? "");

  const actMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/api/factory/rd/work-tasks/${t.id}`, {
        method: "POST",
        json: { version: t.version, ...body },
      }),
    onSuccess: onDone,
  });

  return (
    <tr className="border-t border-slate-100 dark:border-slate-800/60 align-top">
      <td className="py-2 pr-2 font-semibold">{DAYS[t.day_of_week]}</td>
      <td className="py-2 pr-3">
        <div className="font-semibold">
          {t.title}{" "}
          {t.is_unplanned && (
            <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-[10px] font-bold">
              Phát sinh sau duyệt
            </span>
          )}
        </div>
        <div className="text-[11px] text-slate-500">
          {t.project_code && `Dự án ${t.project_code} · `}
          {t.target_metric && `Mục tiêu: ${t.target_metric}`}
        </div>
      </td>
      <td className="py-2 pr-3">
        <StatusBadge status={TASK_STATUS[t.status]?.[0] ?? "QUARANTINE"} label={TASK_STATUS[t.status]?.[1] ?? t.status} />
        {t.defer_reason && (
          <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
            Lý do hoãn ({t.defer_category === "OBJECTIVE" ? "Khách quan" : "Chủ quan"}): {t.defer_reason}
          </div>
        )}
      </td>
      <td className="py-2 pr-3">
        {planStatus === "APPROVED" && ["PLANNED", "IN_PROGRESS"].includes(t.status) ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex gap-1">
              <input
                className={inputClass}
                value={resultText}
                onChange={(e) => setResultText(e.target.value)}
                placeholder="Nhập kết quả thực hiện cụ thể..."
              />
              <Button onClick={() => actMut.mutate({ action: "complete", result_summary: resultText })} disabled={actMut.isPending}>
                Hoàn thành
              </Button>
            </div>
            <div className="flex gap-1 items-center">
              <select className={`${inputClass} w-32`} value={deferCat} onChange={(e) => setDeferCat(e.target.value as any)}>
                <option value="OBJECTIVE">Khách quan</option>
                <option value="SUBJECTIVE">Chủ quan</option>
              </select>
              <input
                className={inputClass}
                value={deferReason}
                onChange={(e) => setDeferReason(e.target.value)}
                placeholder="Lý do hoãn việc..."
              />
              <Button variant="ghost" onClick={() => actMut.mutate({ action: "defer", defer_category: deferCat, defer_reason: deferReason })} disabled={actMut.isPending}>
                Hoãn
              </Button>
            </div>
          </div>
        ) : (
          <span>{t.result_summary || "—"}</span>
        )}
      </td>
      <td className="py-2 pr-2">
        {canApprove && t.status === "DONE" ? (
          <div className="flex gap-1 items-center">
            <select className={`${inputClass} w-20`} value={rating} onChange={(e) => setRating(Number(e.target.value))}>
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}/5 ⭐</option>)}
            </select>
            <input
              className={inputClass}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Nhận xét quản lý..."
            />
            <Button variant="ghost" onClick={() => actMut.mutate({ action: "rate", efficiency_rating: rating, manager_comment: comment })} disabled={actMut.isPending}>
              Chấm
            </Button>
          </div>
        ) : t.efficiency_rating ? (
          <div>
            <b>{t.efficiency_rating}/5 ⭐</b> {t.manager_comment && `— ${t.manager_comment}`}
          </div>
        ) : (
          "—"
        )}
        <ErrorNote error={actMut.error} />
      </td>
    </tr>
  );
}

function PlanPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ["factory", "rd", "work-plan", id], queryFn: () => api<WorkPlanDetail>(`/api/factory/rd/work-plans/${id}`) });
  const projects = useQuery({ queryKey: ["factory", "rd", "projects", ""], queryFn: () => api<any[]>("/api/factory/rd/projects") });

  const [title, setTitle] = useState("");
  const [day, setDay] = useState(1);
  const [projId, setProjId] = useState("");
  const [metric, setMetric] = useState("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["factory", "rd", "work-plan", id] });
    qc.invalidateQueries({ queryKey: ["factory", "rd", "work-plans"] });
  };

  const addTaskMut = useMutation({
    mutationFn: () =>
      api(`/api/factory/rd/work-plans/${id}`, {
        method: "POST",
        json: { title, day_of_week: day, project_id: projId || null, target_metric: metric || null },
      }),
    onSuccess: () => {
      setTitle("");
      setMetric("");
      refresh();
    },
  });

  const p = detail.data;
  return (
    <Card title={p ? `Kế hoạch tuần ${p.code} — ${p.user_name} (Tuần từ ${fmtDate(p.week_start)})` : "Chi tiết kế hoạch tuần"} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <ErrorNote error={detail.error ?? addTaskMut.error} />
      {p && (
        <div className="flex flex-col gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={PLAN_STATUS[p.status]?.[0] ?? "QUARANTINE"} label={PLAN_STATUS[p.status]?.[1] ?? p.status} />
            <span>· Phòng: <b>{p.org_unit_name}</b></span>
            {p.approved_by_name && <span>· Người duyệt: <b>{p.approved_by_name}</b> ({fmtDate(p.approved_at)})</span>}
            {p.review_note && <span className="text-amber-700 dark:text-amber-400">· Ghi chú quản lý: &ldquo;{p.review_note}&rdquo;</span>}
          </div>

          {["DRAFT", "NEEDS_REVISION", "APPROVED"].includes(p.status) && (
            <form
              className="grid gap-2 sm:grid-cols-5 items-end p-3 rounded-xl border border-slate-200 dark:border-slate-800"
              onSubmit={(e) => {
                e.preventDefault();
                addTaskMut.mutate();
              }}
            >
              <Field label="Thứ trong tuần">
                <select className={inputClass} value={day} onChange={(e) => setDay(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{DAYS[d]}</option>)}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label={`Nội dung công việc ${p.status === "APPROVED" ? "(Sẽ đánh dấu Phát sinh)" : ""} *`}>
                  <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="VD: Chạy thực nghiệm lặp lại LoD 20 bản sao/phản ứng" required />
                </Field>
              </div>
              <Field label="Gắn dự án R&D">
                <select className={inputClass} value={projId} onChange={(e) => setProjId(e.target.value)}>
                  <option value="">— Không gắn —</option>
                  {projects.data?.map((pr) => <option key={pr.id} value={pr.id}>{pr.code} — {pr.name}</option>)}
                </select>
              </Field>
              <div className="flex gap-1 items-end">
                <Field label="Chỉ tiêu đầu ra">
                  <input className={inputClass} value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="Báo cáo ELN" />
                </Field>
                <Button type="submit" disabled={addTaskMut.isPending}>+ Thêm</Button>
              </div>
            </form>
          )}

          {p.tasks.length === 0 ? (
            <Empty>Chưa có công việc nào trong kế hoạch tuần này.</Empty>
          ) : (
            <Table head={["Thứ", "Công việc & Dự án", "Trạng thái", "Ghi nhận kết quả / Báo hoãn (Chỉ mở khi đã duyệt)", "Đánh giá của quản lý"]}>
              {p.tasks.map((t) => (
                <TaskActionRow key={t.id} t={t} planStatus={p.status} canApprove={p.can_approve} onDone={refresh} />
              ))}
            </Table>
          )}

          <ActionBar endpoint={`/api/factory/rd/work-plans/${p.id}/actions`} version={p.version} actions={p.actions} labels={PLAN_ACTIONS} onDone={refresh} />
        </div>
      )}
    </Card>
  );
}

export function WorkPlansView({ canSubmit, departmentHint }: { canSubmit: boolean; departmentHint?: string }) {
  const qc = useQueryClient();
  const units = useQuery({
    queryKey: ["factory", "work-plan-units"],
    queryFn: () => api<{ id: string; code: string; name: string; module_key?: string }[]>("/api/factory/oligo/units?perm=plan.view"),
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(currentMonday());
  const [orgUnitId, setOrgUnitId] = useState("");

  React.useEffect(() => {
    if (!departmentHint || departmentHint === "all" || !units.data?.length) return;
    const h = departmentHint.toLowerCase();
    const matched = units.data.find((u) => {
      const n = `${u.code} ${u.name} ${u.module_key ?? ""}`.toLowerCase();
      if (h.includes("r&d") || h.includes("nghiên cứu")) return u.module_key === "RD" || n.includes("r&d") || n.includes("nghiên cứu");
      if (h.includes("kit")) return u.module_key === "KIT" || n.includes("kit");
      if (h.includes("oligo")) return u.module_key === "OLIGO" || n.includes("oligo");
      if (h.includes("thiết bị") || h.includes("kỹ thuật")) return u.module_key === "DEVICE" || n.includes("thiết bị");
      if (h.includes("qa") || h.includes("qc") || h.includes("pháp chế")) return u.module_key === "QMS" || n.includes("qa") || n.includes("qc");
      return n.includes(h);
    });
    if (matched) setOrgUnitId(matched.id);
  }, [departmentHint, units.data]);

  const list = useQuery({
    queryKey: ["factory", "rd", "work-plans", orgUnitId],
    queryFn: () => api<any[]>(`/api/factory/rd/work-plans${orgUnitId ? `?org_unit_id=${orgUnitId}` : ""}`),
  });

  const createMut = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/api/factory/rd/work-plans", {
        method: "POST",
        idempotent: true,
        json: {
          org_unit_id: orgUnitId || units.data?.[0]?.id,
          week_start: weekStart,
        },
      }),
    onSuccess: (plan) => {
      qc.invalidateQueries({ queryKey: ["factory", "rd", "work-plans"] });
      if (plan?.id) setSelected(plan.id);
    },
  });

  return (
    <div className="flex flex-col gap-3">
      {selected && <PlanPanel key={selected} id={selected} onClose={() => setSelected(null)} />}

      <Card
        title="Kế hoạch Tuần & Đánh giá Hiệu quả KPI Chuyên môn theo Phòng ban (Lập → Duyệt → Ghi kết quả / Phát sinh / Báo hoãn → Chấm điểm 1–5⭐)"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={`${inputClass} w-52`}
              value={orgUnitId}
              onChange={(e) => setOrgUnitId(e.target.value)}
              aria-label="Phòng ban chuyên môn"
            >
              <option value="">Tất cả phòng chuyên môn</option>
              {units.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.code})
                </option>
              ))}
            </select>
            {canSubmit && (
              <>
                <input type="date" className={`${inputClass} w-40`} value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
                <Button onClick={() => createMut.mutate()} disabled={createMut.isPending || (!orgUnitId && !units.data?.length)}>
                  + Mở / Lập kế hoạch tuần của tôi
                </Button>
              </>
            )}
          </div>
        }
      >
        <ErrorNote error={list.error ?? createMut.error} />
        {list.data?.length === 0 && <Empty>Chưa có kế hoạch tuần nào.</Empty>}
        {list.data && list.data.length > 0 && (
          <Table head={["Mã KH", "Nhân sự", "Phòng", "Tuần bắt đầu", "Tổng việc", "Hoàn thành", "Phát sinh", "Người duyệt", "Trạng thái"]}>
            {list.data.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setSelected(r.id)}>
                <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{r.code}</td>
                <td className="py-2 pr-3 font-semibold">{r.user_name}</td>
                <td className="py-2 pr-3">{r.org_unit_name}</td>
                <td className="py-2 pr-3 font-mono">{fmtDate(r.week_start)}</td>
                <td className="py-2 pr-3 font-mono">{r.task_count}</td>
                <td className="py-2 pr-3 font-mono text-emerald-700 dark:text-emerald-400">{r.done_count}</td>
                <td className="py-2 pr-3 font-mono">{r.unplanned_count}</td>
                <td className="py-2 pr-3">{r.approved_by_name || "—"}</td>
                <td className="py-2 pr-3">
                  <StatusBadge status={PLAN_STATUS[r.status]?.[0] ?? "QUARANTINE"} label={PLAN_STATUS[r.status]?.[1] ?? r.status} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

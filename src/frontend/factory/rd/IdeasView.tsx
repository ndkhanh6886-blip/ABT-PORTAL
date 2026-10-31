"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { DOMAIN_LABEL, useRdContext } from "./shared";

const IDEA_STATUS: Record<string, [string, string]> = {
  DRAFT: ["QUARANTINE", "Nháp"],
  SUBMITTED: ["PENDING_QC", "Đã gửi phễu"],
  EVALUATION: ["PENDING_QC", "Đang chấm điểm"],
  EVALUATED: ["ON_HOLD", "Đã chấm đủ TECH & BIZ"],
  APPROVED: ["RELEASED", "Hội đồng đã duyệt"],
  REJECTED: ["REJECTED", "Từ chối"],
  CONVERTED: ["RELEASED", "Đã lập dự án"],
};

const IDEA_ACTIONS = {
  submit: "Gửi vào phễu đánh giá",
  start_evaluation: "Đưa ra hội đồng",
  complete_evaluation: "Chốt điểm hội đồng",
  approve: "Phê duyệt ý tưởng",
  reject: "Từ chối ý tưởng",
  re_evaluate: "Yêu cầu chấm lại",
};

interface IdeaDetail {
  id: string;
  code: string;
  org_unit_id: string;
  org_unit_name: string;
  title: string;
  description: string;
  target_domain: string;
  goal_id: string | null;
  goal_code: string | null;
  goal_name: string | null;
  proposer_name: string;
  expected_roi: string | null;
  market_summary: string | null;
  status: string;
  version: number;
  project_id: string | null;
  project_code: string | null;
  evaluations: {
    id: string;
    eval_type: "TECH" | "BIZ";
    evaluator_name: string;
    scores: Record<string, number>;
    weighted_score: number;
    analysis: string | null;
    recommendation: string;
    submitted_at: string;
  }[];
  actions: AllowedAction[];
}

function EvaluationForm({
  ideaId,
  evalType,
  criteria,
  onDone,
}: {
  ideaId: string;
  evalType: "TECH" | "BIZ";
  criteria: { code: string; name: string; weight: number; scale_max: number }[];
  onDone: () => void;
}) {
  const [scores, setScores] = useState<Record<string, number>>(() =>
    Object.fromEntries(criteria.map((c) => [c.code, Math.ceil(c.scale_max * 0.8)]))
  );
  const [analysis, setAnalysis] = useState("");
  const [recommendation, setRecommendation] = useState<"APPROVE" | "REJECT" | "REVISE">("APPROVE");
  const submit = useMutation({
    mutationFn: () =>
      api(`/api/factory/rd/ideas/${ideaId}`, {
        method: "POST",
        json: { eval_type: evalType, scores, analysis: analysis || null, recommendation },
      }),
    onSuccess: onDone,
  });

  return (
    <form
      className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 flex flex-col gap-2.5 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        submit.mutate();
      }}
    >
      <div className="font-bold text-sky-700 dark:text-sky-400">
        Chấm điểm {evalType === "TECH" ? "Hội đồng Kỹ thuật (TECH)" : "Hội đồng Kinh doanh (BIZ)"}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {criteria.map((c) => (
          <Field key={c.code} label={`${c.name} (Trọng số ${c.weight}% · tối đa ${c.scale_max})`}>
            <input
              type="number"
              min={0}
              max={c.scale_max}
              step={0.5}
              className={inputClass}
              value={scores[c.code] ?? 0}
              onChange={(e) => setScores({ ...scores, [c.code]: Number(e.target.value) })}
              required
            />
          </Field>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-3 items-end">
        <div className="sm:col-span-2">
          <Field label="Phân tích / Nhận xét hội đồng">
            <input className={inputClass} value={analysis} onChange={(e) => setAnalysis(e.target.value)} placeholder="Nhận định khả thi, rủi ro, lợi thế cạnh tranh..." />
          </Field>
        </div>
        <Field label="Khuyến nghị">
          <select className={inputClass} value={recommendation} onChange={(e) => setRecommendation(e.target.value as any)}>
            <option value="APPROVE">Đề nghị Duyệt (APPROVE)</option>
            <option value="REVISE">Cần bổ sung / chỉnh sửa (REVISE)</option>
            <option value="REJECT">Đề nghị Từ chối (REJECT)</option>
          </select>
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={submit.isPending}>
          Lưu kết quả chấm {evalType}
        </Button>
      </div>
      <ErrorNote error={submit.error} />
    </form>
  );
}

function IdeaPanel({
  id,
  canEvaluate,
  canManageProject,
  onClose,
}: {
  id: string;
  canEvaluate: boolean;
  canManageProject: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const ctx = useRdContext("rd.view");
  const detail = useQuery({ queryKey: ["factory", "rd", "idea", id], queryFn: () => api<IdeaDetail>(`/api/factory/rd/ideas/${id}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["factory", "rd", "idea", id] });
    qc.invalidateQueries({ queryKey: ["factory", "rd", "ideas"] });
    qc.invalidateQueries({ queryKey: ["factory", "rd", "projects"] });
  };
  const convertToProject = useMutation({
    mutationFn: () => {
      const i = detail.data!;
      return api("/api/factory/rd/projects", {
        method: "POST",
        idempotent: true,
        json: {
          name: i.title,
          owner_org_unit_id: i.org_unit_id,
          project_type: "NEW_PRODUCT",
          target_domain: i.target_domain,
          idea_id: i.id,
          description: i.description,
        },
      });
    },
    onSuccess: refresh,
  });

  const d = detail.data;
  const techCriteria = (ctx.data?.criteria ?? []).filter((c) => c.eval_type === "TECH" && c.status === "ACTIVE");
  const bizCriteria = (ctx.data?.criteria ?? []).filter((c) => c.eval_type === "BIZ" && c.status === "ACTIVE");

  return (
    <Card title={d ? `Ý tưởng ${d.code} — ${d.title}` : "Chi tiết ý tưởng"} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <ErrorNote error={detail.error ?? convertToProject.error} />
      {d && (
        <div className="flex flex-col gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={IDEA_STATUS[d.status]?.[0] ?? "QUARANTINE"} label={IDEA_STATUS[d.status]?.[1] ?? d.status} />
            <span>· Phòng: <b>{d.org_unit_name}</b></span>
            <span>· Lĩnh vực: <b>{DOMAIN_LABEL[d.target_domain] ?? d.target_domain}</b></span>
            <span>· Người đề xuất: <b>{d.proposer_name}</b></span>
            {d.goal_code && <span>· Mục tiêu chiến lược: <b>{d.goal_code} ({d.goal_name})</b></span>}
            {d.project_code && <span className="text-emerald-700 dark:text-emerald-400 font-bold">· Đã chuyển thành dự án {d.project_code}</span>}
          </div>
          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/30 space-y-1">
            <div><b>Mô tả & Giải pháp kỹ thuật:</b> {d.description}</div>
            {d.market_summary && <div><b>Thị trường & Khách hàng mục tiêu:</b> {d.market_summary}</div>}
            {d.expected_roi && <div><b>Dự kiến hiệu quả ROI / Giá vốn:</b> {d.expected_roi}</div>}
          </div>

          {d.evaluations.length > 0 && (
            <Table head={["Hội đồng", "Người chấm", "Điểm trọng số (/100)", "Chi tiết tiêu chí", "Phân tích", "Khuyến nghị", "Thời gian"]}>
              {d.evaluations.map((e) => (
                <tr key={e.id}>
                  <td className="py-2 pr-3 font-bold">{e.eval_type === "TECH" ? "Kỹ thuật (TECH)" : "Kinh doanh (BIZ)"}</td>
                  <td className="py-2 pr-3">{e.evaluator_name}</td>
                  <td className="py-2 pr-3 font-mono font-bold text-sky-700 dark:text-sky-400">{e.weighted_score}%</td>
                  <td className="py-2 pr-3 font-mono text-[11px]">
                    {Object.entries(e.scores).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                  </td>
                  <td className="py-2 pr-3">{e.analysis || "—"}</td>
                  <td className="py-2 pr-3 font-semibold">{e.recommendation}</td>
                  <td className="py-2 pr-3">{fmtDate(e.submitted_at)}</td>
                </tr>
              ))}
            </Table>
          )}

          {canEvaluate && ["SUBMITTED", "EVALUATION", "EVALUATED"].includes(d.status) && (
            <div className="grid gap-3 lg:grid-cols-2">
              <EvaluationForm ideaId={d.id} evalType="TECH" criteria={techCriteria} onDone={refresh} />
              <EvaluationForm ideaId={d.id} evalType="BIZ" criteria={bizCriteria} onDone={refresh} />
            </div>
          )}

          <ActionBar
            endpoint={`/api/factory/rd/ideas/${d.id}/actions`}
            version={d.version}
            actions={d.actions.filter((a) => a.action !== "convert")}
            labels={IDEA_ACTIONS}
            onDone={refresh}
          />

          {d.status === "APPROVED" && canManageProject && (
            <div className="pt-1">
              <Button onClick={() => convertToProject.mutate()} disabled={convertToProject.isPending}>
                Khởi tạo Dự án Stage-Gate từ ý tưởng này
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function IdeasView({
  canPropose,
  canEvaluate,
  canApprove,
  canManageProject,
}: {
  canPropose: boolean;
  canEvaluate: boolean;
  canApprove: boolean;
  canManageProject: boolean;
}) {
  const qc = useQueryClient();
  const ctx = useRdContext("rd.view");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [addingIdea, setAddingIdea] = useState(false);
  const [addingGoal, setAddingGoal] = useState(false);

  const [orgUnitId, setOrgUnitId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [domain, setDomain] = useState("KIT");
  const [goalId, setGoalId] = useState("");
  const [market, setMarket] = useState("");
  const [roi, setRoi] = useState("");

  const [goalName, setGoalName] = useState("");
  const [goalPeriod, setGoalPeriod] = useState("2026");

  const list = useQuery({
    queryKey: ["factory", "rd", "ideas", status],
    queryFn: () => api<any[]>(`/api/factory/rd/ideas${status ? `?status=${status}` : ""}`),
  });

  const createIdeaMut = useMutation({
    mutationFn: () =>
      api("/api/factory/rd/ideas", {
        method: "POST",
        idempotent: true,
        json: {
          org_unit_id: orgUnitId || ctx.data?.units[0]?.id,
          title,
          description,
          target_domain: domain,
          goal_id: goalId || null,
          market_summary: market || null,
          expected_roi: roi || null,
          submit_now: true,
        },
      }),
    onSuccess: () => {
      setAddingIdea(false);
      setTitle("");
      setDescription("");
      setMarket("");
      setRoi("");
      qc.invalidateQueries({ queryKey: ["factory", "rd", "ideas"] });
    },
  });

  const createGoalMut = useMutation({
    mutationFn: () =>
      api("/api/factory/rd/units", {
        method: "POST",
        idempotent: true,
        json: { kind: "goal", name: goalName, period: goalPeriod },
      }),
    onSuccess: () => {
      setAddingGoal(false);
      setGoalName("");
      qc.invalidateQueries({ queryKey: ["factory", "rd", "context"] });
    },
  });

  return (
    <div className="flex flex-col gap-3">
      {selected && (
        <IdeaPanel
          key={selected}
          id={selected}
          canEvaluate={canEvaluate}
          canManageProject={canManageProject}
          onClose={() => setSelected(null)}
        />
      )}

      <Card
        title="Mục tiêu chiến lược & Phễu ý tưởng R&D"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select className={`${inputClass} w-44`} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Mọi trạng thái</option>
              {Object.entries(IDEA_STATUS).map(([k, [, v]]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            {canApprove && (
              <Button variant="ghost" onClick={() => setAddingGoal(!addingGoal)}>
                + Mục tiêu chiến lược
              </Button>
            )}
            {canPropose && (
              <Button onClick={() => setAddingIdea(!addingIdea)}>
                + Đề xuất ý tưởng mới
              </Button>
            )}
          </div>
        }
      >
        <ErrorNote error={list.error ?? createIdeaMut.error ?? createGoalMut.error} />

        {(ctx.data?.goals.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {ctx.data?.goals.map((g) => (
              <span key={g.id} className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-xs">
                <b className="font-mono text-sky-700 dark:text-sky-400">{g.code}</b> ({g.period}): {g.name} · <b>{g.idea_count}</b> ý tưởng
              </span>
            ))}
          </div>
        )}

        {addingGoal && (
          <form
            className="grid gap-2 sm:grid-cols-4 items-end p-3 mb-3 rounded-xl border border-slate-200 dark:border-slate-800"
            onSubmit={(e) => {
              e.preventDefault();
              createGoalMut.mutate();
            }}
          >
            <div className="sm:col-span-2">
              <Field label="Tên mục tiêu chiến lược *">
                <input className={inputClass} value={goalName} onChange={(e) => setGoalName(e.target.value)} placeholder="VD: Làm chủ bộ Kit Real-time PCR đa tác nhân hô hấp" required />
              </Field>
            </div>
            <Field label="Kỳ chiến lược *">
              <input className={inputClass} value={goalPeriod} onChange={(e) => setGoalPeriod(e.target.value)} placeholder="2026" required />
            </Field>
            <Button type="submit" disabled={createGoalMut.isPending}>Lưu mục tiêu</Button>
          </form>
        )}

        {addingIdea && (
          <form
            className="grid gap-3 sm:grid-cols-3 p-3 mb-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/40 dark:bg-sky-950/20"
            onSubmit={(e) => {
              e.preventDefault();
              createIdeaMut.mutate();
            }}
          >
            <Field label="Phòng R&D / KT-CN *">
              <select className={inputClass} value={orgUnitId || ctx.data?.units[0]?.id || ""} onChange={(e) => setOrgUnitId(e.target.value)} required>
                {ctx.data?.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label="Lĩnh vực sản phẩm *">
              <select className={inputClass} value={domain} onChange={(e) => setDomain(e.target.value)}>
                {Object.entries(DOMAIN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Gắn mục tiêu chiến lược">
              <select className={inputClass} value={goalId} onChange={(e) => setGoalId(e.target.value)}>
                <option value="">— Không gắn —</option>
                {ctx.data?.goals.map((g) => <option key={g.id} value={g.id}>{g.code} — {g.name}</option>)}
              </select>
            </Field>
            <div className="sm:col-span-3">
              <Field label="Tiêu đề ý tưởng *">
                <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="VD: Kit Multiplex RT-qPCR phát hiện đồng thời RSV / Influenza A/B" />
              </Field>
            </div>
            <div className="sm:col-span-3">
              <Field label="Mô tả giải pháp kỹ thuật & tính mới *">
                <textarea className={inputClass} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} required />
              </Field>
            </div>
            <Field label="Thị trường & Khách hàng mục tiêu">
              <input className={inputClass} value={market} onChange={(e) => setMarket(e.target.value)} placeholder="Bệnh viện tuyến tỉnh, phòng xét nghiệm..." />
            </Field>
            <Field label="Dự kiến ROI & Giá vốn mục tiêu">
              <input className={inputClass} value={roi} onChange={(e) => setRoi(e.target.value)} placeholder="Giá vốn < 45.000đ/test, hoàn vốn sau 6 tháng" />
            </Field>
            <div className="flex items-end justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setAddingIdea(false)}>Hủy</Button>
              <Button type="submit" disabled={createIdeaMut.isPending}>Gửi vào phễu R&D</Button>
            </div>
          </form>
        )}

        {list.data?.length === 0 && <Empty>Chưa có ý tưởng R&D nào trong phễu.</Empty>}
        {list.data && list.data.length > 0 && (
          <Table head={["Mã", "Tiêu đề", "Lĩnh vực", "Mục tiêu", "Người đề xuất", "Điểm TECH", "Điểm BIZ", "Dự án", "Trạng thái"]}>
            {list.data.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setSelected(r.id)}>
                <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{r.code}</td>
                <td className="py-2 pr-3 font-semibold">{r.title}</td>
                <td className="py-2 pr-3">{DOMAIN_LABEL[r.target_domain] ?? r.target_domain}</td>
                <td className="py-2 pr-3">{r.goal_code || "—"}</td>
                <td className="py-2 pr-3">{r.proposer_name}</td>
                <td className="py-2 pr-3 font-mono">{r.tech_score != null ? `${r.tech_score}%` : "—"}</td>
                <td className="py-2 pr-3 font-mono">{r.biz_score != null ? `${r.biz_score}%` : "—"}</td>
                <td className="py-2 pr-3 font-mono text-emerald-700 dark:text-emerald-400">{r.project_code || "—"}</td>
                <td className="py-2 pr-3">
                  <StatusBadge status={IDEA_STATUS[r.status]?.[0] ?? "QUARANTINE"} label={IDEA_STATUS[r.status]?.[1] ?? r.status} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

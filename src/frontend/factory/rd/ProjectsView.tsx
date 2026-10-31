"use client";

import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { DOMAIN_LABEL, IVD_CLASS_LABEL, useRdContext } from "./shared";

const PROJ_STATUS: Record<string, [string, string]> = {
  ACTIVE: ["PENDING_QC", "Đang triển khai"],
  ON_HOLD: ["ON_HOLD", "Tạm dừng"],
  TRANSFERRED: ["RELEASED", "Đã chuyển giao SX"],
  KILLED: ["REJECTED", "Đã dừng dự án"],
};

const PROJ_TYPE_LABEL: Record<string, string> = {
  NEW_PRODUCT: "Nghiên cứu Sản phẩm Mới",
  IMPROVEMENT: "Cải tiến / Tối ưu SP Cũ",
  PROCESS: "Tối ưu Quy trình Công nghệ",
  RESEARCH: "Nghiên cứu Khoa học Cơ bản",
};

const GATE_STATUS: Record<string, [string, string]> = {
  LOCKED: ["EXPIRED", "Đang khóa"],
  OPEN: ["QUARANTINE", "Đang mở (chuẩn bị hồ sơ)"],
  PENDING_REVIEW: ["PENDING_QC", "Chờ hội đồng duyệt"],
  PASSED: ["RELEASED", "Đã qua cổng (GO)"],
  NEEDS_REVISION: ["ON_HOLD", "Yêu cầu bổ sung (RECYCLE)"],
};

const PROJ_ACTIONS = {
  hold: "Tạm dừng dự án",
  resume: "Tiếp tục dự án",
  kill: "Dừng dự án (KILL)",
  mark_transferred: "Đánh dấu Đã chuyển giao SX",
};

const GATE_ACTIONS = {
  submit: "Gửi duyệt cổng Stage-Gate",
  decide_go: "Quyết định GO (Qua cổng)",
  decide_recycle: "Yêu cầu sửa (RECYCLE)",
};

const ENTRY_TYPE_BADGE: Record<string, { status: string; label: string }> = {
  ELN_EXPERIMENT: { status: "PENDING_QC", label: "Xuất từ bài ELN" },
  DIRECT_ISSUE: { status: "RELEASED", label: "Xuất kho cho Dự án" },
  PR_REQUEST: { status: "QUARANTINE", label: "Đề nghị mua (PR)" },
  OLIGO_TRIAL: { status: "ON_HOLD", label: "Đặt Oligo thử nghiệm" },
};

const BOM_ROLES: Record<string, string> = {
  MASTER_MIX: "MasterMix / Phản ứng chính",
  PRIMER_PROBE: "Primer & Probe đặc hiệu",
  ENZYME: "Enzyme (Taq / RT / UDG)",
  POSITIVE_CONTROL: "Chứng dương (Positive Control)",
  NEGATIVE_CONTROL: "Chứng âm (Negative Control)",
  EXTRACTION_BUFFER: "Đệm tách chiết / Hóa chất",
  PACKAGING: "Bao bì / Ống / Vỏ hộp",
  OTHER: "Thành phần khác",
};

interface Deliverable {
  id: string;
  seq: number;
  item_name?: string;
  title?: string;
  doc_type?: string;
  is_required: boolean;
  attachment_id: string | null;
  attachment_name: string | null;
  notes: string | null;
  status: "MISSING" | "SUBMITTED" | "ACCEPTED" | "REJECTED";
  reviewer_comment: string | null;
  reviewed_by_name: string | null;
}

interface Gate {
  id: string;
  gate_no: number;
  gate_name: string;
  stage_after: string;
  status: string;
  version: number;
  submitted_by_name: string | null;
  submitted_at: string | null;
  decision: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  deliverables: Deliverable[];
  actions: AllowedAction[];
}

interface ProjectDetail {
  id: string;
  code: string;
  name: string;
  owner_org_unit_id: string;
  org_unit_name: string;
  project_type: string;
  target_domain: string;
  ivd_class: string | null;
  leader_name: string;
  template_name: string;
  idea_code: string | null;
  current_stage: string;
  status: string;
  planned_start: string | null;
  planned_end: string | null;
  actual_transfer_date: string | null;
  description: string | null;
  version: number;
  gates: Gate[];
  specs: {
    id: string;
    category: string;
    design_stage?: string;
    parameter: string;
    unit: string | null;
    baseline_value: string | null;
    target_value: string;
    actual_value: string | null;
    method_ref: string | null;
    result: "PENDING" | "PASS" | "FAIL";
  }[];
  risks?: {
    id: string;
    code: string;
    hazard: string;
    hazardous_situation: string;
    harm: string;
    severity: number;
    occurrence: number;
    detection: number;
    rpn: number;
    mitigation_measure: string | null;
    status: string;
  }[];
  milestones: {
    id: string;
    title: string;
    due_date: string;
    status: string;
    tags: string[];
    notes: string | null;
  }[];
  actions: AllowedAction[];
}

interface ProjectOpsData {
  project_id: string;
  budget_amount: number;
  estimated_spent: number;
  target_product_item_id: string | null;
  target_product_code: string | null;
  target_product_name: string | null;
  scorecard: {
    dhf_total: number;
    dhf_done: number;
    dhf_pct: number;
    tpp_total: number;
    tpp_passed: number;
    tpp_failed: number;
    tpp_pct: number;
    tasks_total: number;
    tasks_done: number;
    tasks_pct: number;
    material_tx_count: number;
  };
  tasks: {
    id: string;
    code: string;
    gate_no: number;
    title: string;
    assignee_name: string | null;
    due_date: string | null;
    status: "TODO" | "IN_PROGRESS" | "DONE" | "BLOCKED";
    progress_pct: number;
    experiment_code: string | null;
    notes: string | null;
  }[];
  material_ledger: {
    id: string;
    entry_type: string;
    gate_no?: number;
    ref_code: string | null;
    ref_title: string | null;
    item_code: string | null;
    item_name: string | null;
    lot_code: string | null;
    qty: number;
    uom: string | null;
    purpose: string | null;
    document_code: string | null;
    actor_name: string | null;
    created_at: string;
    estimated_cost: number;
  }[];
  material_summary: {
    item_id: string;
    item_code: string;
    item_name: string;
    uom: string;
    qty_eln: number;
    qty_direct: number;
    qty_pr: number;
    total_consumed: number;
    tx_count: number;
  }[];
  prototype_bom: {
    id: string;
    line_no: number;
    component_item_id: string;
    item_code: string;
    item_name: string;
    component_role: string;
    qty_per_base: number;
    uom: string;
    scrap_pct: number;
    available_stock: number;
    notes: string | null;
  }[];
}

function DeliverableRow({
  d,
  gateStatus,
  canManage,
  canReview,
  onDone,
}: {
  d: Deliverable;
  gateStatus: string;
  canManage: boolean;
  canReview: boolean;
  onDone: () => void;
}) {
  const [notes, setNotes] = useState(d.notes ?? "");
  const [comment, setComment] = useState(d.reviewer_comment ?? "");
  const editable = gateStatus === "OPEN" || gateStatus === "NEEDS_REVISION" || gateStatus === "PENDING_REVIEW";

  const updateMut = useMutation({
    mutationFn: (status: "SUBMITTED" | "ACCEPTED" | "REJECTED") =>
      api(`/api/factory/rd/deliverables/${d.id}`, {
        method: "PUT",
        json: { status, notes: notes || null, reviewer_comment: comment || null },
      }),
    onSuccess: onDone,
  });

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/factory/rd/deliverables/${d.id}`, { method: "POST", body: fd, credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
    },
    onSuccess: onDone,
  });

  return (
    <tr className="border-t border-slate-100 dark:border-slate-800/60 align-top">
      <td className="py-2 pr-2 font-mono">{d.seq}</td>
      <td className="py-2 pr-3">
        <div className="font-semibold">{d.item_name || d.title}</div>
        <div className="text-[11px] text-slate-500 font-mono">
          {d.doc_type ? `Mã hồ sơ: ${d.doc_type} · ` : ""}
          {d.is_required ? "Bắt buộc" : "Tùy chọn"}
        </div>
        {d.attachment_id && (
          <a
            href={`/api/factory/rd/deliverables/${d.id}`}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-sky-700 dark:text-sky-400 underline block mt-0.5"
          >
            Tải file: {d.attachment_name || "Hồ sơ đính kèm"}
          </a>
        )}
      </td>
      <td className="py-2 pr-3">
        {canManage && (gateStatus === "OPEN" || gateStatus === "NEEDS_REVISION") ? (
          <div className="flex flex-col gap-1">
            <input
              className={inputClass}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Tham chiếu mã ELN / báo cáo / tóm tắt kết quả..."
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg,.docx,.xlsx"
                onChange={(e) => e.target.files?.[0] && uploadMut.mutate(e.target.files[0])}
                className="text-[11px] max-w-48"
              />
              <Button variant="ghost" onClick={() => updateMut.mutate("SUBMITTED")} disabled={updateMut.isPending}>
                Nộp minh chứng
              </Button>
            </div>
          </div>
        ) : (
          <span>{d.notes || "—"}</span>
        )}
      </td>
      <td className="py-2 pr-3">
        <StatusBadge
          status={d.status === "ACCEPTED" ? "RELEASED" : d.status === "SUBMITTED" ? "PENDING_QC" : d.status === "REJECTED" ? "REJECTED" : "QUARANTINE"}
          label={d.status}
        />
        {d.reviewer_comment && <div className="text-[11px] text-slate-500 mt-0.5">Nhận xét: {d.reviewer_comment}</div>}
      </td>
      <td className="py-2 pr-2">
        {canReview && editable && d.status !== "MISSING" && (
          <div className="flex flex-col gap-1">
            <input
              className={inputClass}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Nhận xét thẩm định..."
            />
            <div className="flex gap-1">
              <Button variant="ghost" onClick={() => updateMut.mutate("ACCEPTED")} disabled={updateMut.isPending}>
                Đạt (Accept)
              </Button>
              <Button variant="ghost" onClick={() => updateMut.mutate("REJECTED")} disabled={updateMut.isPending}>
                Trả lại
              </Button>
            </div>
          </div>
        )}
        <ErrorNote error={updateMut.error ?? uploadMut.error} />
      </td>
    </tr>
  );
}

function ProjectPanel({
  id,
  canManage,
  canReviewGate,
  onClose,
}: {
  id: string;
  canManage: boolean;
  canReviewGate: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ["factory", "rd", "project", id],
    queryFn: () => api<ProjectDetail>(`/api/factory/rd/projects/${id}`),
  });
  const ops = useQuery({
    queryKey: ["factory", "rd", "project-ops", id],
    queryFn: () => api<ProjectOpsData>(`/api/factory/rd/project-ops?project_id=${id}`),
  });
  const itemsQuery = useQuery({
    queryKey: ["factory", "rd", "master-items"],
    queryFn: () => api<{ rows: { id: string; code: string; name: string; base_uom: string; item_type: string }[] }>("/api/factory/master/items?page_size=200"),
  });

  const [subTab, setSubTab] = useState<"gates" | "wbs" | "materials" | "bom" | "tpp" | "risks" | "roadmap">("gates");

  // WBS Task form state
  const [taskGate, setTaskGate] = useState("1");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskAssignee, setTaskAssignee] = useState("");
  const [taskDue, setTaskDue] = useState("");

  // Material Action modal state ("issue" | "pr" | "oligo" | null)
  const [matAction, setMatAction] = useState<"issue" | "pr" | "oligo" | null>(null);
  const [matGate, setMatGate] = useState("1");
  const [matItemId, setMatItemId] = useState("");
  const [matQty, setMatQty] = useState("1");
  const [matCost, setMatCost] = useState("500000");
  const [matPurpose, setMatPurpose] = useState("");
  const [oligoSeqText, setOligoSeqText] = useState("Primer-F; GTGTCTGCGGCGTTTTATCA\nPrimer-R; GACAAACGGGCAACATACCTT\nProbe-FAM; /FAM/CCTCTKCATCCTGCTGCTATGCCTCATC/BHQ1/");
  const [oligoPurif, setOligoPurif] = useState("HPLC");
  const [matNotice, setMatNotice] = useState<string | null>(null);

  // Prototype BOM form state
  const [targetProductItemId, setTargetProductItemId] = useState("");
  const [bomRows, setBomRows] = useState<
    { component_item_id: string; component_role: string; qty_per_base: string; uom: string; scrap_pct: string; notes: string }[]
  >([]);
  const [transferNotice, setTransferNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!ops.data) return;
    setTargetProductItemId(ops.data.target_product_item_id || "");
    if (ops.data.prototype_bom.length > 0) {
      setBomRows(
        ops.data.prototype_bom.map((b) => ({
          component_item_id: b.component_item_id,
          component_role: b.component_role,
          qty_per_base: String(b.qty_per_base),
          uom: b.uom,
          scrap_pct: String(b.scrap_pct ?? 0),
          notes: b.notes ?? "",
        }))
      );
    } else if (bomRows.length === 0 && itemsQuery.data?.rows.length) {
      const firstItem = itemsQuery.data.rows[0];
      setBomRows([
        {
          component_item_id: firstItem.id,
          component_role: "MASTER_MIX",
          qty_per_base: "1",
          uom: firstItem.base_uom || "mL",
          scrap_pct: "5",
          notes: "Thành phần phản ứng chính",
        },
      ]);
    }
  }, [ops.data, itemsQuery.data]);

  // TPP form state
  const [specCat, setSpecCat] = useState("ANALYTICAL");
  const [specStage, setSpecStage] = useState("INPUT");
  const [specParam, setSpecParam] = useState("");
  const [specUnit, setSpecUnit] = useState("");
  const [specTarget, setSpecTarget] = useState("");
  const [specActual, setSpecActual] = useState("");
  const [specResult, setSpecResult] = useState<"PENDING" | "PASS" | "FAIL">("PENDING");

  // Risk (ISO 14971 FMEA) form state
  const [hazard, setHazard] = useState("");
  const [situation, setSituation] = useState("");
  const [harm, setHarm] = useState("");
  const [sev, setSev] = useState("3");
  const [prob, setProb] = useState("2");
  const [det, setDet] = useState("2");
  const [controlMeasure, setControlMeasure] = useState("");

  // Milestone form state
  const [msTitle, setMsTitle] = useState("");
  const [msDate, setMsDate] = useState("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["factory", "rd", "project", id] });
    qc.invalidateQueries({ queryKey: ["factory", "rd", "project-ops", id] });
    qc.invalidateQueries({ queryKey: ["factory", "rd", "projects"] });
  };

  const saveTaskMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api("/api/factory/rd/project-ops", {
        method: "POST",
        json: { op: "save_task", project_id: id, ...payload },
      }),
    onSuccess: () => {
      setTaskTitle("");
      refresh();
    },
  });

  const issueMatMut = useMutation({
    mutationFn: () =>
      api<{ document_code: string }>("/api/factory/rd/project-ops", {
        method: "POST",
        json: {
          op: "issue_material",
          project_id: id,
          gate_no: Number(matGate),
          item_id: matItemId,
          qty: Number(matQty),
          estimated_cost: Number(matCost),
          purpose: matPurpose,
        },
      }),
    onSuccess: (res) => {
      setMatNotice(`✅ Đã xuất kho NVL cho Dự án thành công (Mã phiếu kho: ${res.document_code})`);
      setMatAction(null);
      setMatPurpose("");
      refresh();
    },
  });

  const createPrMut = useMutation({
    mutationFn: () =>
      api<{ pr_code: string }>("/api/factory/rd/project-ops", {
        method: "POST",
        json: {
          op: "create_pr",
          project_id: id,
          gate_no: Number(matGate),
          estimated_cost: Number(matCost),
          purpose: matPurpose,
          lines: [{ item_id: matItemId, qty: Number(matQty), note: matPurpose }],
        },
      }),
    onSuccess: (res) => {
      setMatNotice(`✅ Đã tạo Đề nghị mua hàng (PR: ${res.pr_code}) gắn trực tiếp với Dự án!`);
      setMatAction(null);
      setMatPurpose("");
      refresh();
    },
  });

  const createOligoTrialMut = useMutation({
    mutationFn: () =>
      api<{ oligo_order_code: string; sequence_count: number }>("/api/factory/rd/project-ops", {
        method: "POST",
        json: {
          op: "create_oligo_trial",
          project_id: id,
          gate_no: Number(matGate),
          purification: oligoPurif,
          sequences_text: oligoSeqText,
          purpose: matPurpose || "Đặt tổng hợp mồi Primer/Probe thử nghiệm cho Dự án R&D",
        },
      }),
    onSuccess: (res) => {
      setMatNotice(`✅ Đã gửi đơn đặt tổng hợp ${res.sequence_count} trình tự Oligo (${res.oligo_order_code}) sang Phòng Tổng hợp Oligo!`);
      setMatAction(null);
      refresh();
    },
  });

  const saveBomMut = useMutation({
    mutationFn: () =>
      api("/api/factory/rd/project-ops", {
        method: "POST",
        json: {
          op: "save_prototype_bom",
          project_id: id,
          target_product_item_id: targetProductItemId || null,
          lines: bomRows.map((r) => ({
            component_item_id: r.component_item_id,
            component_role: r.component_role,
            qty_per_base: Number(r.qty_per_base),
            uom: r.uom,
            scrap_pct: Number(r.scrap_pct || 0),
            notes: r.notes || null,
          })),
        },
      }),
    onSuccess: () => {
      setTransferNotice("✅ Đã lưu Công thức / Định mức Thử nghiệm (Prototype BOM) của Dự án!");
      refresh();
    },
  });

  const createTransferMut = useMutation({
    mutationFn: () =>
      api<{ transfer_code: string; created_kit_bom_code: string | null }>("/api/factory/rd/project-ops", {
        method: "POST",
        json: {
          op: "create_transfer_package",
          project_id: id,
        },
      }),
    onSuccess: (res) => {
      setTransferNotice(
        `🚀 Đã đóng gói & tạo Gói Chuyển Giao Công Nghệ ${res.transfer_code}${
          res.created_kit_bom_code ? ` và tự động sinh Định mức Sản xuất ${res.created_kit_bom_code}` : ""
        } thành công!`
      );
      refresh();
    },
  });

  const addSpecMut = useMutation({
    mutationFn: () =>
      api(`/api/factory/rd/projects/${id}`, {
        method: "POST",
        json: {
          kind: "spec",
          category: specCat,
          design_stage: specStage,
          parameter: specParam,
          unit: specUnit || null,
          target_value: specTarget,
          actual_value: specActual || null,
          result: specResult,
        },
      }),
    onSuccess: () => {
      setSpecParam("");
      setSpecTarget("");
      setSpecActual("");
      refresh();
    },
  });

  const addRiskMut = useMutation({
    mutationFn: () =>
      api(`/api/factory/rd/projects/${id}`, {
        method: "POST",
        json: {
          kind: "risk",
          hazard,
          hazardous_situation: situation,
          harm,
          severity: Number(sev),
          probability: Number(prob),
          detectability: Number(det),
          control_measure: controlMeasure || null,
          status: controlMeasure ? "MITIGATED" : "OPEN",
        },
      }),
    onSuccess: () => {
      setHazard("");
      setSituation("");
      setHarm("");
      setControlMeasure("");
      refresh();
    },
  });

  const addMsMut = useMutation({
    mutationFn: () =>
      api(`/api/factory/rd/projects/${id}`, {
        method: "POST",
        json: { kind: "milestone", title: msTitle, due_date: msDate, status: "PLANNED" },
      }),
    onSuccess: () => {
      setMsTitle("");
      setMsDate("");
      refresh();
    },
  });

  const toggleMsDone = useMutation({
    mutationFn: (m: { id: string; title: string; due_date: string; status: string }) =>
      api(`/api/factory/rd/projects/${id}`, {
        method: "POST",
        json: { kind: "milestone", milestone_id: m.id, title: m.title, due_date: m.due_date.slice(0, 10), status: m.status === "DONE" ? "PLANNED" : "DONE" },
      }),
    onSuccess: refresh,
  });

  const p = detail.data;
  const o = ops.data;
  const allItems = itemsQuery.data?.rows ?? [];

  return (
    <Card title={p ? `Dự án ${p.code} — ${p.name}` : "Chi tiết dự án Stage-Gate"} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <ErrorNote
        error={
          detail.error ??
          ops.error ??
          saveTaskMut.error ??
          issueMatMut.error ??
          createPrMut.error ??
          createOligoTrialMut.error ??
          saveBomMut.error ??
          createTransferMut.error ??
          addSpecMut.error ??
          addRiskMut.error ??
          addMsMut.error
        }
      />
      {p && (
        <div className="flex flex-col gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={PROJ_STATUS[p.status]?.[0] ?? "QUARANTINE"} label={PROJ_STATUS[p.status]?.[1] ?? p.status} />
            <span className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold">
              {PROJ_TYPE_LABEL[p.project_type] ?? p.project_type}
            </span>
            <span>· Giai đoạn hiện tại: <b className="font-mono text-sky-700 dark:text-sky-400">{p.current_stage}</b></span>
            <span>· Lĩnh vực: <b>{DOMAIN_LABEL[p.target_domain] ?? p.target_domain}</b></span>
            {p.ivd_class && <span>· Phân loại: <b>{IVD_CLASS_LABEL[p.ivd_class] ?? p.ivd_class}</b></span>}
            <span>· Chủ nhiệm: <b>{p.leader_name}</b></span>
            {p.idea_code && <span>· Từ ý tưởng: <b>{p.idea_code}</b></span>}
          </div>

          {/* 4 Project Health Scorecard KPI Cards */}
          {o && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50">
                <div className="text-[11px] text-slate-500">1. Tiến độ Hồ sơ Thiết kế (DHF)</div>
                <div className="text-base font-bold text-sky-700 dark:text-sky-400 mt-0.5">
                  {o.scorecard.dhf_pct}% ({o.scorecard.dhf_done}/{o.scorecard.dhf_total} hồ sơ)
                </div>
                <div className="text-[11px] text-slate-400">
                  Qua cổng: {p.gates.filter((g) => g.status === "PASSED").length}/{p.gates.length} Gate
                </div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50">
                <div className="text-[11px] text-slate-500">2. Độ đạt Chỉ tiêu Kỹ thuật (TPP)</div>
                <div className="text-base font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">
                  {o.scorecard.tpp_pct}% ĐẠT ({o.scorecard.tpp_passed}/{o.scorecard.tpp_total})
                </div>
                <div className="text-[11px] text-slate-400">
                  Chưa đạt: {o.scorecard.tpp_failed} chỉ tiêu
                </div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50">
                <div className="text-[11px] text-slate-500">3. Tiến độ Công việc WBS</div>
                <div className="text-base font-bold text-indigo-700 dark:text-indigo-400 mt-0.5">
                  {o.scorecard.tasks_pct}% ({o.scorecard.tasks_done}/{o.scorecard.tasks_total} việc)
                </div>
                <div className="text-[11px] text-slate-400">
                  Mốc Milestone: {p.milestones.filter((m) => m.status === "DONE").length}/{p.milestones.length}
                </div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50">
                <div className="text-[11px] text-slate-500">4. Sổ cái Vật tư & Ngân sách R&D</div>
                <div className="text-base font-bold text-amber-700 dark:text-amber-400 mt-0.5">
                  {o.scorecard.material_tx_count} lượt lĩnh / PR / ELN
                </div>
                <div className="text-[11px] text-slate-400">
                  Chi phí ước tính: {o.estimated_spent.toLocaleString("vi-VN")} / {o.budget_amount.toLocaleString("vi-VN")} đ
                </div>
              </div>
            </div>
          )}

          <ActionBar endpoint={`/api/factory/rd/projects/${p.id}/actions`} version={p.version} actions={p.actions} labels={PROJ_ACTIONS} onDone={refresh} />

          <div className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800 pb-2">
            <Button variant={subTab === "gates" ? "primary" : "ghost"} onClick={() => setSubTab("gates")}>
              1. Stage-Gate & DHF ({p.gates.filter((g) => g.status === "PASSED").length}/{p.gates.length})
            </Button>
            <Button variant={subTab === "wbs" ? "primary" : "ghost"} onClick={() => setSubTab("wbs")}>
              2. Công việc WBS ({o?.tasks.length ?? 0})
            </Button>
            <Button variant={subTab === "materials" ? "primary" : "ghost"} onClick={() => setSubTab("materials")}>
              3. Vật tư, PR & Ngân sách ({o?.material_ledger.length ?? 0})
            </Button>
            <Button variant={subTab === "bom" ? "primary" : "ghost"} onClick={() => setSubTab("bom")}>
              4. Công thức (Prototype BOM) & Chuyển giao ({o?.prototype_bom.length ?? 0})
            </Button>
            <Button variant={subTab === "tpp" ? "primary" : "ghost"} onClick={() => setSubTab("tpp")}>
              5. Ma trận TPP ({p.specs.length})
            </Button>
            <Button variant={subTab === "risks" ? "primary" : "ghost"} onClick={() => setSubTab("risks")}>
              6. Rủi ro FMEA ({p.risks?.length ?? 0})
            </Button>
            <Button variant={subTab === "roadmap" ? "primary" : "ghost"} onClick={() => setSubTab("roadmap")}>
              7. Cột mốc & Lịch .ics ({p.milestones.length})
            </Button>
          </div>

          {subTab === "gates" && (
            <div className="flex flex-col gap-3">
              {p.gates.map((g) => (
                <div key={g.id} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <b className="text-sm">{g.gate_name}</b>
                      <span className="ml-2 text-slate-500">→ Mở sang giai đoạn: <code className="font-mono">{g.stage_after}</code></span>
                    </div>
                    <StatusBadge status={GATE_STATUS[g.status]?.[0] ?? "QUARANTINE"} label={GATE_STATUS[g.status]?.[1] ?? g.status} />
                  </div>
                  {g.decided_by_name && (
                    <div className="text-[11px] text-slate-500">
                      Quyết định gần nhất: <b>{g.decision}</b> bởi {g.decided_by_name} ({fmtDate(g.decided_at)}) {g.decision_note && `— "${g.decision_note}"`}
                    </div>
                  )}
                  <Table head={["#", "Hạng mục hồ sơ bắt buộc (Checklist DHF)", "Minh chứng / File đính kèm", "Trạng thái", "Thẩm định cổng"]}>
                    {g.deliverables.map((d) => (
                      <DeliverableRow
                        key={d.id}
                        d={d}
                        gateStatus={g.status}
                        canManage={canManage}
                        canReview={canReviewGate}
                        onDone={refresh}
                      />
                    ))}
                  </Table>
                  <ActionBar endpoint={`/api/factory/rd/gates/${g.id}/actions`} version={g.version} actions={g.actions} labels={GATE_ACTIONS} onDone={refresh} />
                </div>
              ))}
            </div>
          )}

          {subTab === "wbs" && (
            <div className="flex flex-col gap-3">
              <div className="text-slate-500">
                Phân rã công việc nghiên cứu (Work Breakdown Structure) theo từng cổng Stage-Gate, giao người phụ trách và theo dõi tiến độ thực hiện.
              </div>
              {canManage && (
                <form
                  className="grid gap-2 sm:grid-cols-6 items-end p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/40"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveTaskMut.mutate({
                      gate_no: Number(taskGate),
                      title: taskTitle,
                      assignee_name: taskAssignee || p.leader_name,
                      due_date: taskDue || null,
                      status: "TODO",
                      progress_pct: 0,
                    });
                  }}
                >
                  <Field label="Cổng Gate">
                    <select className={inputClass} value={taskGate} onChange={(e) => setTaskGate(e.target.value)}>
                      <option value="0">G0 — Khảo sát & TPP</option>
                      <option value="1">G1 — Khả thi (Feasibility)</option>
                      <option value="2">G2 — Tối ưu hóa</option>
                      <option value="3">G3 — Thẩm định (V&V)</option>
                      <option value="4">G4 — Chuyển giao SX</option>
                    </select>
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Nội dung công việc / Thực nghiệm *">
                      <input className={inputClass} value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="VD: Khảo sát nhiệt độ bắt cặp mồi Annealing 56–62°C" required />
                    </Field>
                  </div>
                  <Field label="Nghiên cứu viên phụ trách">
                    <input className={inputClass} value={taskAssignee} onChange={(e) => setTaskAssignee(e.target.value)} placeholder={p.leader_name} />
                  </Field>
                  <Field label="Hạn hoàn thành">
                    <input type="date" className={inputClass} value={taskDue} onChange={(e) => setTaskDue(e.target.value)} />
                  </Field>
                  <Button type="submit" disabled={saveTaskMut.isPending}>+ Giao việc WBS</Button>
                </form>
              )}

              {(o?.tasks.length ?? 0) === 0 ? (
                <Empty>Chưa có hạng mục công việc WBS nào.</Empty>
              ) : (
                <Table head={["Mã việc", "Cổng", "Nội dung công việc", "Người phụ trách", "Hạn chót", "Tiến độ", "Trạng thái", "Cập nhật nhanh"]}>
                  {o!.tasks.map((t) => (
                    <tr key={t.id}>
                      <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{t.code}</td>
                      <td className="py-2 pr-3 font-mono">G{t.gate_no}</td>
                      <td className="py-2 pr-3 font-semibold">{t.title}</td>
                      <td className="py-2 pr-3">{t.assignee_name || "—"}</td>
                      <td className="py-2 pr-3 font-mono">{fmtDate(t.due_date)}</td>
                      <td className="py-2 pr-3 font-mono">{t.progress_pct}%</td>
                      <td className="py-2 pr-3">
                        <StatusBadge
                          status={t.status === "DONE" ? "RELEASED" : t.status === "IN_PROGRESS" ? "PENDING_QC" : t.status === "BLOCKED" ? "REJECTED" : "QUARANTINE"}
                          label={t.status === "DONE" ? "Hoàn thành" : t.status === "IN_PROGRESS" ? "Đang làm" : t.status === "BLOCKED" ? "Vướng mắc" : "Chưa làm"}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        {canManage && (
                          <div className="flex gap-1">
                            {t.status !== "IN_PROGRESS" && t.status !== "DONE" && (
                              <button
                                type="button"
                                className="px-2 py-0.5 rounded bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 font-semibold cursor-pointer"
                                onClick={() =>
                                  saveTaskMut.mutate({
                                    task_id: t.id,
                                    gate_no: t.gate_no,
                                    title: t.title,
                                    assignee_name: t.assignee_name,
                                    due_date: t.due_date?.slice(0, 10),
                                    status: "IN_PROGRESS",
                                    progress_pct: 50,
                                  })
                                }
                              >
                                Đang làm (50%)
                              </button>
                            )}
                            {t.status !== "DONE" && (
                              <button
                                type="button"
                                className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 font-semibold cursor-pointer"
                                onClick={() =>
                                  saveTaskMut.mutate({
                                    task_id: t.id,
                                    gate_no: t.gate_no,
                                    title: t.title,
                                    assignee_name: t.assignee_name,
                                    due_date: t.due_date?.slice(0, 10),
                                    status: "DONE",
                                    progress_pct: 100,
                                  })
                                }
                              >
                                ✓ Hoàn thành
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </div>
          )}

          {subTab === "materials" && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20">
                <div>
                  <div className="font-bold text-slate-800 dark:text-slate-100">
                    Sổ cái Theo dõi Sử dụng Nguyên vật liệu & Đặt hàng theo Dự án ({p.code})
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Tự động tổng hợp tất cả hóa chất xuất qua các bài thí nghiệm ELN + Xuất kho trực tiếp cho Dự án + Đề nghị mua hàng (PR) + Đơn đặt tổng hợp Oligo thử nghiệm.
                  </div>
                </div>
                {canManage && (
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      onClick={() => {
                        setMatAction(matAction === "issue" ? null : "issue");
                        if (!matItemId && allItems[0]) setMatItemId(allItems[0].id);
                      }}
                    >
                      📦 + Xuất kho NVL cho Dự án
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setMatAction(matAction === "pr" ? null : "pr");
                        if (!matItemId && allItems[0]) setMatItemId(allItems[0].id);
                      }}
                    >
                      🛒 + Đề nghị mua (PR) cho Dự án
                    </Button>
                    <Button variant="ghost" onClick={() => setMatAction(matAction === "oligo" ? null : "oligo")}>
                      🧬 + Đặt Tổng hợp Oligo thử nghiệm
                    </Button>
                  </div>
                )}
              </div>

              {matNotice && (
                <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 font-semibold">
                  {matNotice}
                </div>
              )}

              {matAction === "issue" && (
                <form
                  className="grid gap-2 sm:grid-cols-6 items-end p-3 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-950/20"
                  onSubmit={(e) => {
                    e.preventDefault();
                    issueMatMut.mutate();
                  }}
                >
                  <Field label="Giai đoạn Gate">
                    <select className={inputClass} value={matGate} onChange={(e) => setMatGate(e.target.value)}>
                      {[0, 1, 2, 3, 4].map((g) => (
                        <option key={g} value={g}>G{g}</option>
                      ))}
                    </select>
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Hóa chất / Vật tư xuất cho Dự án *">
                      <select className={inputClass} value={matItemId} onChange={(e) => setMatItemId(e.target.value)} required>
                        <option value="">-- Chọn vật tư trong kho --</option>
                        {allItems.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.code} — {it.name} ({it.base_uom})
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label="Số lượng xuất *">
                    <input type="number" step="any" min="0.001" className={inputClass} value={matQty} onChange={(e) => setMatQty(e.target.value)} required />
                  </Field>
                  <Field label="Giá trị ước tính (VNĐ)">
                    <input type="number" step="1000" min="0" className={inputClass} value={matCost} onChange={(e) => setMatCost(e.target.value)} />
                  </Field>
                  <Field label="Mục đích sử dụng trong dự án *">
                    <input className={inputClass} value={matPurpose} onChange={(e) => setMatPurpose(e.target.value)} placeholder="VD: Khảo sát 50 mẫu chuẩn G2" required />
                  </Field>
                  <div className="sm:col-span-6 flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => setMatAction(null)}>Hủy</Button>
                    <Button type="submit" disabled={issueMatMut.isPending}>Xác nhận Xuất kho FEFO cho Dự án</Button>
                  </div>
                </form>
              )}

              {matAction === "pr" && (
                <form
                  className="grid gap-2 sm:grid-cols-6 items-end p-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-950/20"
                  onSubmit={(e) => {
                    e.preventDefault();
                    createPrMut.mutate();
                  }}
                >
                  <Field label="Giai đoạn Gate">
                    <select className={inputClass} value={matGate} onChange={(e) => setMatGate(e.target.value)}>
                      {[0, 1, 2, 3, 4].map((g) => (
                        <option key={g} value={g}>G{g}</option>
                      ))}
                    </select>
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Vật tư / Hóa chất đề nghị mua (PR) *">
                      <select className={inputClass} value={matItemId} onChange={(e) => setMatItemId(e.target.value)} required>
                        <option value="">-- Chọn vật tư cần mua --</option>
                        {allItems.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.code} — {it.name} ({it.base_uom})
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label="Số lượng đặt mua *">
                    <input type="number" step="any" min="0.001" className={inputClass} value={matQty} onChange={(e) => setMatQty(e.target.value)} required />
                  </Field>
                  <Field label="Dự toán chi phí (VNĐ)">
                    <input type="number" step="1000" min="0" className={inputClass} value={matCost} onChange={(e) => setMatCost(e.target.value)} />
                  </Field>
                  <Field label="Lý do / Thuyết minh mua cho dự án *">
                    <input className={inputClass} value={matPurpose} onChange={(e) => setMatPurpose(e.target.value)} placeholder="VD: Mua Enzyme đặc chủng cho Giai đoạn Tối ưu" required />
                  </Field>
                  <div className="sm:col-span-6 flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => setMatAction(null)}>Hủy</Button>
                    <Button type="submit" disabled={createPrMut.isPending}>Gửi Đề nghị mua hàng (PR) gắn Dự án</Button>
                  </div>
                </form>
              )}

              {matAction === "oligo" && (
                <form
                  className="grid gap-2 sm:grid-cols-4 items-end p-3 rounded-xl border border-indigo-300 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-950/20"
                  onSubmit={(e) => {
                    e.preventDefault();
                    createOligoTrialMut.mutate();
                  }}
                >
                  <Field label="Giai đoạn Gate">
                    <select className={inputClass} value={matGate} onChange={(e) => setMatGate(e.target.value)}>
                      {[0, 1, 2, 3, 4].map((g) => (
                        <option key={g} value={g}>G{g}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Phương pháp tinh sạch mặc định">
                    <select className={inputClass} value={oligoPurif} onChange={(e) => setOligoPurif(e.target.value)}>
                      <option value="DESALT">DESALT (Primer thường)</option>
                      <option value="OPC">OPC (Cột đảo pha)</option>
                      <option value="HPLC">HPLC (Probe huỳnh quang)</option>
                      <option value="PAGE">PAGE (Chuỗi dài)</option>
                    </select>
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Mục đích thử nghiệm">
                      <input className={inputClass} value={matPurpose} onChange={(e) => setMatPurpose(e.target.value)} placeholder="VD: Bộ mồi ứng viên Screening Set #1" />
                    </Field>
                  </div>
                  <div className="sm:col-span-4">
                    <Field label="Danh sách trình tự Primer / Probe cần tổng hợp (Mỗi dòng: Tên; Trình tự 5'->3') *">
                      <textarea className={`${inputClass} h-20 font-mono`} value={oligoSeqText} onChange={(e) => setOligoSeqText(e.target.value)} required />
                    </Field>
                  </div>
                  <div className="sm:col-span-4 flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => setMatAction(null)}>Hủy</Button>
                    <Button type="submit" disabled={createOligoTrialMut.isPending}>Gửi Đơn Tổng Hợp Oligo Nội Bộ cho Dự Án</Button>
                  </div>
                </form>
              )}

              {/* Summary by Item */}
              {o && o.material_summary.length > 0 && (
                <div>
                  <div className="font-bold text-slate-700 dark:text-slate-200 mb-1">
                    A. Bảng Tổng hợp Định lượng Nguyên vật liệu đã tiêu thụ theo Mã hàng
                  </div>
                  <Table head={["Mã NVL", "Tên Hóa chất / Vật tư", "ĐVT", "Xuất qua ELN", "Xuất trực tiếp Dự án", "Tổng đã sử dụng", "Đang đề nghị mua (PR)", "Số lượt giao dịch"]}>
                    {o.material_summary.map((ms) => (
                      <tr key={`${ms.item_code}-${ms.uom}`}>
                        <td className="py-1.5 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{ms.item_code}</td>
                        <td className="py-1.5 pr-3 font-semibold">{ms.item_name}</td>
                        <td className="py-1.5 pr-3 font-mono">{ms.uom}</td>
                        <td className="py-1.5 pr-3 font-mono">{fmtQty(ms.qty_eln)}</td>
                        <td className="py-1.5 pr-3 font-mono">{fmtQty(ms.qty_direct)}</td>
                        <td className="py-1.5 pr-3 font-mono font-bold text-emerald-700 dark:text-emerald-400">{fmtQty(ms.total_consumed)} {ms.uom}</td>
                        <td className="py-1.5 pr-3 font-mono text-amber-700 dark:text-amber-400">{ms.qty_pr > 0 ? `${fmtQty(ms.qty_pr)} ${ms.uom}` : "—"}</td>
                        <td className="py-1.5 pr-3 font-mono">{ms.tx_count} lượt</td>
                      </tr>
                    ))}
                  </Table>
                </div>
              )}

              {/* Detailed Ledger */}
              <div>
                <div className="font-bold text-slate-700 dark:text-slate-200 mb-1">
                  B. Nhật ký Chi tiết Giao dịch Vật tư, ELN, PR & Oligo của Dự án
                </div>
                {(o?.material_ledger.length ?? 0) === 0 ? (
                  <Empty>Chưa có giao dịch xuất vật tư hoặc đề nghị mua nào cho dự án này.</Empty>
                ) : (
                  <Table head={["Loại giao dịch", "Chứng từ / ELN", "Mã & Tên Vật tư", "Lô (Lot)", "Số lượng", "Mục đích / Vai trò trong thí nghiệm", "Người thực hiện", "Thời gian"]}>
                    {o!.material_ledger.map((row) => {
                      const b = ENTRY_TYPE_BADGE[row.entry_type] ?? { status: "QUARANTINE", label: row.entry_type };
                      return (
                        <tr key={row.id}>
                          <td className="py-2 pr-3">
                            <StatusBadge status={b.status} label={b.label} />
                          </td>
                          <td className="py-2 pr-3 font-mono font-semibold">{row.document_code || row.ref_code || "—"}</td>
                          <td className="py-2 pr-3">
                            {row.item_code ? (
                              <>
                                <span className="font-mono font-semibold">{row.item_code}</span> — {row.item_name}
                              </>
                            ) : (
                              <span className="italic text-slate-500">Đơn tổng hợp Oligo nội bộ</span>
                            )}
                          </td>
                          <td className="py-2 pr-3 font-mono">{row.lot_code || "—"}</td>
                          <td className="py-2 pr-3 font-mono font-semibold">
                            {fmtQty(row.qty)} {row.uom || ""}
                          </td>
                          <td className="py-2 pr-3">{row.purpose || row.ref_title || "—"}</td>
                          <td className="py-2 pr-3">{row.actor_name || "—"}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(row.created_at)}</td>
                        </tr>
                      );
                    })}
                  </Table>
                )}
              </div>
            </div>
          )}

          {subTab === "bom" && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/50 dark:bg-sky-950/20">
                <div>
                  <div className="font-bold text-slate-800 dark:text-slate-100">
                    Thiết kế Công thức / Định mức Thử nghiệm (Prototype BOM) & Chuyển giao 1-Click
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Xây dựng cấu trúc định mức nguyên vật liệu chuẩn cho 01 đơn vị sản phẩm ngay trong quá trình R&D. Khi hoàn tất, bấm 1 nút để tự động đóng gói Gói Chuyển Giao Công Nghệ sang Phòng Sản Xuất!
                  </div>
                </div>
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" onClick={() => saveBomMut.mutate()} disabled={saveBomMut.isPending}>
                      💾 Lưu Công thức Prototype BOM
                    </Button>
                    <Button onClick={() => createTransferMut.mutate()} disabled={createTransferMut.isPending}>
                      🚀 Đẩy 1-Click sang Gói Chuyển Giao SX
                    </Button>
                  </div>
                )}
              </div>

              {transferNotice && (
                <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 font-semibold">
                  {transferNotice}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2 items-end">
                <Field label="Mã Thành phẩm Đích (Dùng để tự động tạo BOM Sản xuất & Tiêu chuẩn QC khi chuyển giao)">
                  <select
                    className={inputClass}
                    value={targetProductItemId}
                    onChange={(e) => setTargetProductItemId(e.target.value)}
                    disabled={!canManage}
                  >
                    <option value="">-- Chọn mã thành phẩm đích (hoặc để trống) --</option>
                    {allItems.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.code} — {it.name} ({it.item_type})
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="flex flex-col gap-2">
                {bomRows.map((r, idx) => (
                  <div key={idx} className="grid gap-2 sm:grid-cols-7 items-end p-2.5 rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="sm:col-span-2">
                      <Field label={`#${idx + 1} Nguyên vật liệu thành phần *`}>
                        <select
                          className={inputClass}
                          value={r.component_item_id}
                          onChange={(e) => {
                            const found = allItems.find((x) => x.id === e.target.value);
                            const next = [...bomRows];
                            next[idx] = {
                              ...next[idx],
                              component_item_id: e.target.value,
                              uom: found?.base_uom || next[idx].uom,
                            };
                            setBomRows(next);
                          }}
                        >
                          <option value="">Chọn vật tư</option>
                          {allItems.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.code} — {it.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <Field label="Vai trò trong sản phẩm">
                      <select
                        className={inputClass}
                        value={r.component_role}
                        onChange={(e) => {
                          const next = [...bomRows];
                          next[idx] = { ...next[idx], component_role: e.target.value };
                          setBomRows(next);
                        }}
                      >
                        {Object.entries(BOM_ROLES).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Định mức / 1 ĐVSP *">
                      <input
                        type="number"
                        step="any"
                        min="0.0001"
                        className={inputClass}
                        value={r.qty_per_base}
                        onChange={(e) => {
                          const next = [...bomRows];
                          next[idx] = { ...next[idx], qty_per_base: e.target.value };
                          setBomRows(next);
                        }}
                      />
                    </Field>
                    <Field label="ĐVT">
                      <input
                        className={inputClass}
                        value={r.uom}
                        onChange={(e) => {
                          const next = [...bomRows];
                          next[idx] = { ...next[idx], uom: e.target.value };
                          setBomRows(next);
                        }}
                      />
                    </Field>
                    <Field label="Hao hụt (%)">
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        className={inputClass}
                        value={r.scrap_pct}
                        onChange={(e) => {
                          const next = [...bomRows];
                          next[idx] = { ...next[idx], scrap_pct: e.target.value };
                          setBomRows(next);
                        }}
                      />
                    </Field>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <Field label="Ghi chú pha chế">
                          <input
                            className={inputClass}
                            value={r.notes}
                            onChange={(e) => {
                              const next = [...bomRows];
                              next[idx] = { ...next[idx], notes: e.target.value };
                              setBomRows(next);
                            }}
                          />
                        </Field>
                      </div>
                      {bomRows.length > 1 && canManage && (
                        <button
                          type="button"
                          className="text-rose-600 text-xs font-bold pt-4 cursor-pointer"
                          onClick={() => setBomRows(bomRows.filter((_, j) => j !== idx))}
                        >
                          Xóa
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {canManage && (
                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setBomRows([
                          ...bomRows,
                          {
                            component_item_id: allItems[0]?.id ?? "",
                            component_role: "REAGENT",
                            qty_per_base: "1",
                            uom: allItems[0]?.base_uom ?? "mL",
                            scrap_pct: "2",
                            notes: "",
                          },
                        ])
                      }
                    >
                      + Thêm thành phần vào Công thức
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {subTab === "tpp" && (
            <div className="flex flex-col gap-3">
              {canManage && (
                <form
                  className="grid gap-2 sm:grid-cols-6 items-end p-3 rounded-xl border border-slate-200 dark:border-slate-800"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addSpecMut.mutate();
                  }}
                >
                  <Field label="Nhóm thông số">
                    <select className={inputClass} value={specCat} onChange={(e) => setSpecCat(e.target.value)}>
                      <option value="ANALYTICAL">Hiệu năng phân tích (LoD/Precision)</option>
                      <option value="CLINICAL">Độ nhạy / Độ đặc hiệu lâm sàng</option>
                      <option value="STABILITY">Độ ổn định (Real-time / In-use)</option>
                      <option value="SOFTWARE">Thuật toán / Phần mềm</option>
                      <option value="HARDWARE">Thông số kỹ thuật thiết bị</option>
                    </select>
                  </Field>
                  <Field label="Chỉ tiêu (Design Input) *">
                    <input className={inputClass} value={specParam} onChange={(e) => setSpecParam(e.target.value)} placeholder="VD: Giới hạn phát hiện LoD95" required />
                  </Field>
                  <Field label="Đơn vị">
                    <input className={inputClass} value={specUnit} onChange={(e) => setSpecUnit(e.target.value)} placeholder="copies/rxn, %..." />
                  </Field>
                  <Field label="Mục tiêu (Target) *">
                    <input className={inputClass} value={specTarget} onChange={(e) => setSpecTarget(e.target.value)} placeholder="≤ 10 copies/rxn" required />
                  </Field>
                  <Field label="Kết quả thực tế (Output)">
                    <input className={inputClass} value={specActual} onChange={(e) => setSpecActual(e.target.value)} placeholder="6.5 copies/rxn (ELN #2)" />
                  </Field>
                  <div className="flex gap-1 items-end">
                    <Field label="Đánh giá">
                      <select className={inputClass} value={specResult} onChange={(e) => setSpecResult(e.target.value as any)}>
                        <option value="PENDING">Chờ KQ</option>
                        <option value="PASS">ĐẠT</option>
                        <option value="FAIL">CHƯA ĐẠT</option>
                      </select>
                    </Field>
                    <Button type="submit" disabled={addSpecMut.isPending}>+ Lưu</Button>
                  </div>
                </form>
              )}
              {p.specs.length === 0 ? (
                <Empty>Chưa khai báo thông số mục tiêu (TPP / Design Input - Output).</Empty>
              ) : (
                <Table head={["Nhóm", "Thông số (Design Input)", "Đơn vị", "Mục tiêu (Target)", "Thực tế đạt được (Design Output)", "Kết luận"]}>
                  {p.specs.map((s) => (
                    <tr key={s.id}>
                      <td className="py-2 pr-3 font-mono">{s.category}</td>
                      <td className="py-2 pr-3 font-semibold">{s.parameter}</td>
                      <td className="py-2 pr-3">{s.unit || "—"}</td>
                      <td className="py-2 pr-3 font-mono">{s.target_value}</td>
                      <td className="py-2 pr-3 font-mono">{s.actual_value || "—"}</td>
                      <td className="py-2 pr-3">
                        <StatusBadge
                          status={s.result === "PASS" ? "RELEASED" : s.result === "FAIL" ? "REJECTED" : "PENDING_QC"}
                          label={s.result === "PASS" ? "ĐẠT" : s.result === "FAIL" ? "KHÔNG ĐẠT" : "Đang thử nghiệm"}
                        />
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </div>
          )}

          {subTab === "risks" && (
            <div className="flex flex-col gap-3">
              {canManage && (
                <form
                  className="grid gap-2 sm:grid-cols-6 items-end p-3 rounded-xl border border-slate-200 dark:border-slate-800"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addRiskMut.mutate();
                  }}
                >
                  <Field label="Mối nguy (Hazard) *">
                    <input className={inputClass} value={hazard} onChange={(e) => setHazard(e.target.value)} placeholder="VD: Nhiễm chéo Amplicon" required />
                  </Field>
                  <Field label="Tình huống nguy hại *">
                    <input className={inputClass} value={situation} onChange={(e) => setSituation(e.target.value)} placeholder="VD: Khí dung phát tán khi mở nắp" required />
                  </Field>
                  <Field label="Tổn hại (Harm) *">
                    <input className={inputClass} value={harm} onChange={(e) => setHarm(e.target.value)} placeholder="VD: Dương tính giả lâm sàng" required />
                  </Field>
                  <Field label="S × P × D (1–5)">
                    <div className="flex gap-1">
                      <input type="number" min="1" max="5" className={inputClass} value={sev} onChange={(e) => setSev(e.target.value)} title="Severity" />
                      <input type="number" min="1" max="5" className={inputClass} value={prob} onChange={(e) => setProb(e.target.value)} title="Probability" />
                      <input type="number" min="1" max="5" className={inputClass} value={det} onChange={(e) => setDet(e.target.value)} title="Detectability" />
                    </div>
                  </Field>
                  <div className="sm:col-span-2 flex gap-1 items-end">
                    <div className="flex-1">
                      <Field label="Biện pháp kiểm soát rủi ro (Risk Control)">
                        <input className={inputClass} value={controlMeasure} onChange={(e) => setControlMeasure(e.target.value)} placeholder="VD: Bổ sung enzyme UDG/dUTP chống nhiễm chéo" />
                      </Field>
                    </div>
                    <Button type="submit" disabled={addRiskMut.isPending}>+ Lưu FMEA</Button>
                  </div>
                </form>
              )}
              {(p.risks?.length ?? 0) === 0 ? (
                <Empty>Chưa có mục đánh giá rủi ro ISO 14971 nào.</Empty>
              ) : (
                <Table head={["Mã Rủi ro", "Mối nguy (Hazard)", "Tình huống nguy hại", "Tổn hại (Harm)", "S×P×D = RPN", "Biện pháp kiểm soát", "Trạng thái"]}>
                  {p.risks!.map((rk) => (
                    <tr key={rk.id}>
                      <td className="py-2 pr-3 font-mono font-semibold">{rk.code}</td>
                      <td className="py-2 pr-3 font-semibold">{rk.hazard}</td>
                      <td className="py-2 pr-3">{rk.hazardous_situation}</td>
                      <td className="py-2 pr-3">{rk.harm}</td>
                      <td className="py-2 pr-3 font-mono">
                        {rk.severity}×{rk.occurrence}×{rk.detection} = <b>{rk.rpn}</b>
                      </td>
                      <td className="py-2 pr-3">{rk.mitigation_measure || "—"}</td>
                      <td className="py-2 pr-3">
                        <StatusBadge status={rk.status === "OPEN" ? "ON_HOLD" : "RELEASED"} label={rk.status} />
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </div>
          )}

          {subTab === "roadmap" && (
            <div className="flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Các cột mốc chính của dự án; có thể xuất file lịch chuẩn `.ics` để nhập vào Google Calendar / Outlook.</span>
                <a
                  href={`/api/factory/rd/roadmap/ics?project_id=${p.id}`}
                  className="px-3 py-1.5 rounded-lg bg-sky-700 text-white font-semibold text-xs hover:bg-sky-600"
                >
                  Xuất lịch .ics
                </a>
              </div>
              {canManage && (
                <form
                  className="grid gap-2 sm:grid-cols-4 items-end p-3 rounded-xl border border-slate-200 dark:border-slate-800"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addMsMut.mutate();
                  }}
                >
                  <div className="sm:col-span-2">
                    <Field label="Tên cột mốc (Milestone) *">
                      <input className={inputClass} value={msTitle} onChange={(e) => setMsTitle(e.target.value)} placeholder="VD: Hoàn tất kiểm định 3 lô Pilot & nộp Gate 3" required />
                    </Field>
                  </div>
                  <Field label="Hạn hoàn thành *">
                    <input type="date" className={inputClass} value={msDate} onChange={(e) => setMsDate(e.target.value)} required />
                  </Field>
                  <Button type="submit" disabled={addMsMut.isPending}>+ Thêm cột mốc</Button>
                </form>
              )}
              {p.milestones.length === 0 ? (
                <Empty>Chưa có cột mốc lộ trình nào.</Empty>
              ) : (
                <Table head={["Cột mốc", "Hạn hoàn thành", "Trạng thái", "Thao tác"]}>
                  {p.milestones.map((m) => (
                    <tr key={m.id}>
                      <td className="py-2 pr-3 font-semibold">{m.title}</td>
                      <td className="py-2 pr-3 font-mono">{fmtDate(m.due_date)}</td>
                      <td className="py-2 pr-3">
                        <StatusBadge status={m.status === "DONE" ? "RELEASED" : "PENDING_QC"} label={m.status === "DONE" ? "Đã hoàn thành" : "Theo kế hoạch"} />
                      </td>
                      <td className="py-2 pr-3">
                        {canManage && (
                          <button className="text-sky-700 dark:text-sky-400 underline cursor-pointer" onClick={() => toggleMsDone.mutate(m)}>
                            {m.status === "DONE" ? "Đánh dấu chưa xong" : "Đánh dấu hoàn thành"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

const PIPELINE_STAGES = [
  { key: "G0", label: "1. Khảo sát & TPP (G0)", sub: "Xác lập yêu cầu thiết kế" },
  { key: "G1", label: "2. Khả thi / Feasibility (G1)", sub: "Thử nghiệm công thức sơ bộ" },
  { key: "G2", label: "3. Tối ưu hóa / Optimization (G2)", sub: "Chốt định mức Prototype BOM" },
  { key: "G3", label: "4. Thẩm định / Validation (G3)", sub: "LoD, Độ nhạy & Độ ổn định" },
  { key: "G4", label: "5. Chuyển giao SX (G4 / Transferred)", sub: "Bàn giao BOM & QC Spec" },
];

function matchStageKey(stage: string, status: string, passedGates: number): string {
  if (status === "TRANSFERRED" || stage.includes("TRANSFER") || passedGates >= 4) return "G4";
  if (stage.includes("G3") || stage.includes("VALID") || passedGates === 3) return "G3";
  if (stage.includes("G2") || stage.includes("OPTIM") || passedGates === 2) return "G2";
  if (stage.includes("G1") || stage.includes("FEAS") || passedGates === 1) return "G1";
  return "G0";
}

export function ProjectsView({ canManage, canReviewGate }: { canManage: boolean; canReviewGate: boolean }) {
  const qc = useQueryClient();
  const ctx = useRdContext("rd.view");
  const [domain, setDomain] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [addingMode, setAddingMode] = useState<"NEW_PRODUCT" | "IMPROVEMENT" | null>(null);

  const [name, setName] = useState("");
  const [targetDomain, setTargetDomain] = useState("KIT");
  const [ivdClass, setIvdClass] = useState("CLASS_B");
  const [budgetAmount, setBudgetAmount] = useState("60000000");
  const [plannedEnd, setPlannedEnd] = useState("");
  const [description, setDescription] = useState("");

  const list = useQuery({
    queryKey: ["factory", "rd", "projects", domain],
    queryFn: () => api<any[]>(`/api/factory/rd/projects${domain ? `?domain=${domain}` : ""}`),
  });

  const createMut = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/api/factory/rd/project-ops", {
        method: "POST",
        json: {
          op: "create_project",
          project_type: addingMode ?? "NEW_PRODUCT",
          target_domain: targetDomain,
          ivd_class: ivdClass,
          name,
          budget_amount: Number(budgetAmount || 50000000),
          planned_end: plannedEnd || null,
          description: description || null,
        },
      }),
    onSuccess: (res) => {
      setAddingMode(null);
      setName("");
      setDescription("");
      qc.invalidateQueries({ queryKey: ["factory", "rd", "projects"] });
      if (res?.id) setSelected(res.id);
    },
  });

  const allProjects = list.data ?? [];
  const filteredProjects = stageFilter
    ? allProjects.filter((r) => matchStageKey(r.current_stage || "", r.status || "", Number(r.passed_gates || 0)) === stageFilter)
    : allProjects;

  return (
    <div className="flex flex-col gap-3">
      {/* 5-Stage Visual R&D Pipeline Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {PIPELINE_STAGES.map((st) => {
          const count = allProjects.filter(
            (r) => matchStageKey(r.current_stage || "", r.status || "", Number(r.passed_gates || 0)) === st.key
          ).length;
          const active = stageFilter === st.key;
          return (
            <button
              key={st.key}
              type="button"
              onClick={() => setStageFilter(active ? "" : st.key)}
              className={`text-left p-3 rounded-2xl border transition-all cursor-pointer ${
                active
                  ? "border-sky-600 bg-sky-50 dark:bg-sky-950/60 shadow-sm"
                  : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-sky-400"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-100">{st.label}</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 dark:bg-slate-800 text-sky-700 dark:text-sky-400">
                  {count}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">{st.sub}</div>
            </button>
          );
        })}
      </div>

      {selected && (
        <ProjectPanel key={selected} id={selected} canManage={canManage} canReviewGate={canReviewGate} onClose={() => setSelected(null)} />
      )}

      <Card
        title="Trung tâm Điều hành Dự án R&D theo Stage-Gate & Quản lý Vật tư Dự án (ISO 13485)"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select className={`${inputClass} w-44`} value={domain} onChange={(e) => setDomain(e.target.value)}>
              <option value="">Mọi lĩnh vực</option>
              {Object.entries(DOMAIN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <a href="/api/factory/rd/roadmap/ics" className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold">
              Xuất lịch Roadmap (.ics)
            </a>
            {canManage && (
              <>
                <Button
                  variant="ghost"
                  onClick={() => setAddingMode(addingMode === "IMPROVEMENT" ? null : "IMPROVEMENT")}
                >
                  ✨ + Dự án Cải tiến SP Cũ
                </Button>
                <Button
                  onClick={() => setAddingMode(addingMode === "NEW_PRODUCT" ? null : "NEW_PRODUCT")}
                >
                  🚀 + Dự án Nghiên cứu SP Mới
                </Button>
              </>
            )}
          </div>
        }
      >
        <ErrorNote error={list.error ?? createMut.error} />

        {addingMode && (
          <form
            className="grid gap-3 sm:grid-cols-3 p-3 mb-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/40 dark:bg-sky-950/20"
            onSubmit={(e) => {
              e.preventDefault();
              createMut.mutate();
            }}
          >
            <div className="sm:col-span-3 font-bold text-sky-800 dark:text-sky-300 text-xs">
              {addingMode === "NEW_PRODUCT"
                ? "🚀 Khởi tạo Dự án Nghiên cứu & Phát triển Sản phẩm Mới (5 Cổng Stage-Gate G0 -> G4 + Sổ cái Vật tư)"
                : "✨ Khởi tạo Dự án Cải tiến / Tối ưu hóa Sản phẩm Hiện hữu (Design Change / Bridging Study)"}
            </div>
            <Field label="Lĩnh vực sản phẩm đích *">
              <select className={inputClass} value={targetDomain} onChange={(e) => setTargetDomain(e.target.value)}>
                {Object.entries(DOMAIN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Phân loại IVD / RUO">
              <select className={inputClass} value={ivdClass} onChange={(e) => setIvdClass(e.target.value)}>
                {Object.entries(IVD_CLASS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Ngân sách Vật tư R&D dự kiến (VNĐ)">
              <input type="number" step="1000000" className={inputClass} value={budgetAmount} onChange={(e) => setBudgetAmount(e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Tên dự án R&D *">
                <input
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    addingMode === "NEW_PRODUCT"
                      ? "VD: Nghiên cứu Kit Real-time PCR đa mồi phát hiện Dengue 1-4 đạt chuẩn CE-IVD"
                      : "VD: Cải tiến đệm MasterMix đông khô tăng độ ổn định nhiệt ở 2-8°C"
                  }
                  required
                />
              </Field>
            </div>
            <Field label="Dự kiến hoàn tất chuyển giao">
              <input type="date" className={inputClass} value={plannedEnd} onChange={(e) => setPlannedEnd(e.target.value)} />
            </Field>
            <div className="sm:col-span-3">
              <Field label="Mục tiêu kỹ thuật & Phạm vi nghiên cứu">
                <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Mô tả chỉ tiêu LoD mục tiêu, mẫu chuẩn sử dụng, định hướng công thức..." />
              </Field>
            </div>
            <div className="sm:col-span-3 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setAddingMode(null)}>Hủy</Button>
              <Button type="submit" disabled={createMut.isPending}>
                Khởi tạo Dự án, Sinh Checklist 5 Gate & Bảng việc WBS
              </Button>
            </div>
          </form>
        )}

        {filteredProjects.length === 0 && <Empty>Chưa có dự án R&D nào ở giai đoạn lọc này.</Empty>}
        {filteredProjects.length > 0 && (
          <Table head={["Mã dự án", "Tên dự án", "Loại đề tài", "Lĩnh vực", "Phân loại", "Giai đoạn (Stage)", "Tiến độ Gate", "Số ELN", "Chủ nhiệm", "Trạng thái"]}>
            {filteredProjects.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setSelected(r.id)}>
                <td className="py-2 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400">{r.code}</td>
                <td className="py-2 pr-3 font-semibold">{r.name}</td>
                <td className="py-2 pr-3 text-xs">{PROJ_TYPE_LABEL[r.project_type] ?? r.project_type}</td>
                <td className="py-2 pr-3">{DOMAIN_LABEL[r.target_domain] ?? r.target_domain}</td>
                <td className="py-2 pr-3 font-mono">{r.ivd_class || "—"}</td>
                <td className="py-2 pr-3 font-mono font-semibold">{r.current_stage}</td>
                <td className="py-2 pr-3 font-mono">{r.passed_gates}/{r.total_gates} cổng</td>
                <td className="py-2 pr-3 font-mono">{r.experiment_count}</td>
                <td className="py-2 pr-3">{r.leader_name}</td>
                <td className="py-2 pr-3">
                  <StatusBadge status={PROJ_STATUS[r.status]?.[0] ?? "QUARANTINE"} label={PROJ_STATUS[r.status]?.[1] ?? r.status} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

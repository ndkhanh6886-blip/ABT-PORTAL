"use client";

import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBar, type AllowedAction } from "../actions";
import { api, fmtDate, fmtQty } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { DOMAIN_LABEL, isProjectForPerson, IVD_CLASS_LABEL, staffOfUnit, useRdContext } from "./shared";

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
  unlock: "🔓 Mở khóa cổng sớm",
  submit: "Gửi duyệt cổng Stage-Gate",
  decide_go: "Quyết định GO (Qua cổng)",
  decide_recycle: "Yêu cầu sửa (RECYCLE)",
};

const DOC_TYPE_SUGGESTIONS = [
  "TPP",
  "RISK_ISO14971",
  "FORMULATION",
  "BOM_DRAFT",
  "ANALYTICAL_VAL",
  "STABILITY_ISO23640",
  "CLINICAL_EVAL",
  "IFU_SPEC",
  "DHF_DMR",
  "PRD_FTO",
  "CAD_DFMEA",
  "DVP_IEC61010",
  "DMR",
  "SOP",
  "DHF_DOC",
];

const SW_DOC_TYPE_SUGGESTIONS = [
  "SRS_SPEC",
  "SW_SAFETY_CLASS",
  "ARCH_DESIGN",
  "CYBER_RISK",
  "SOUP_LIST",
  "UNIT_TEST",
  "INTEGRATION_TEST",
  "VERIFICATION_REPORT",
  "TRACE_MATRIX",
  "RELEASE_VAL",
];

const RD_DOMAIN_ENTRIES = Object.entries(DOMAIN_LABEL).filter(([k]) => k !== "SOFTWARE");

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
  leader_name_override?: string | null;
  budget_amount?: string | number | null;
  gate_template_id?: string;
  template_name: string;
  idea_code: string | null;
  current_stage: string;
  status: string;
  planned_start: string | null;
  planned_end: string | null;
  actual_transfer_date: string | null;
  description: string | null;
  version: number;
  has_immutable_handoff?: boolean;
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
    linked_experiment_id: string | null;
    experiment_code: string | null;
    experiment_title: string | null;
    experiment_status: string | null;
    experiment_conclusion: string | null;
    protocol_summary: string | null;
    result_summary: string | null;
    key_metrics_json: { label: string; value: string; unit?: string; target?: string }[];
    outcome_verdict: "PENDING" | "PASS" | "OPTIMIZE" | "FAIL";
    next_steps: string | null;
    attachment_name: string | null;
    attachment_url: string | null;
    completed_at: string | null;
    completed_by_name: string | null;
    notes: string | null;
  }[];
  experiments?: {
    id: string;
    code: string;
    title: string;
    status: string;
    performer_name: string | null;
    wbs_task_code: string | null;
    conclusion: string | null;
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
  projectId,
  gateId,
  gateStatus,
  canManage,
  canReview,
  canCustomize = false,
  onDone,
}: {
  d: Deliverable;
  projectId: string;
  gateId: string;
  gateStatus: string;
  canManage: boolean;
  canReview: boolean;
  canCustomize?: boolean;
  onDone: () => void;
}) {
  const [notes, setNotes] = useState(d.notes ?? "");
  const [comment, setComment] = useState(d.reviewer_comment ?? "");
  const [editingCrit, setEditingCrit] = useState(false);
  const [critName, setCritName] = useState(d.item_name || d.title || "");
  const [critDocType, setCritDocType] = useState(d.doc_type || "DHF_DOC");
  const [critRequired, setCritRequired] = useState(Boolean(d.is_required));
  const editable = gateStatus === "OPEN" || gateStatus === "NEEDS_REVISION" || gateStatus === "PENDING_REVIEW";

  const updateMut = useMutation({
    mutationFn: (status: "SUBMITTED" | "ACCEPTED" | "REJECTED") =>
      api(`/api/factory/rd/deliverables/${d.id}`, {
        method: "PUT",
        json: { status, notes: notes || null, reviewer_comment: comment || null },
      }),
    onSuccess: onDone,
  });

  const saveCritMut = useMutation({
    mutationFn: () =>
      api(`/api/factory/rd/projects/${projectId}`, {
        method: "POST",
        json: {
          kind: "gate_deliverable",
          deliverable_id: d.id,
          project_gate_id: gateId,
          item_name: critName,
          doc_type: critDocType || "DHF_DOC",
          is_required: critRequired,
        },
      }),
    onSuccess: () => {
      setEditingCrit(false);
      onDone();
    },
  });

  const delCritMut = useMutation({
    mutationFn: () =>
      api(`/api/factory/rd/projects/${projectId}`, {
        method: "POST",
        json: {
          kind: "delete_gate_deliverable",
          deliverable_id: d.id,
        },
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
        {editingCrit && canCustomize ? (
          <div className="space-y-1.5 p-2 rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50/40 dark:bg-sky-950/20">
            <input
              className={`${inputClass} text-xs`}
              value={critName}
              onChange={(e) => setCritName(e.target.value)}
              placeholder="Tên tiêu chí / hạng mục hồ sơ *"
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                list="rd-doc-type-datalist"
                className={`${inputClass} w-44 font-mono text-xs`}
                value={critDocType}
                onChange={(e) => setCritDocType(e.target.value)}
                placeholder="Mã hồ sơ (VD: TPP)"
              />
              <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={critRequired}
                  onChange={(e) => setCritRequired(e.target.checked)}
                />
                <span>Bắt buộc</span>
              </label>
              <Button
                type="button"
                className="!px-2.5 !py-1 !text-[11px]"
                disabled={saveCritMut.isPending || critName.trim().length < 2}
                onClick={() => saveCritMut.mutate()}
              >
                {saveCritMut.isPending ? "Đang lưu..." : "Lưu"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="!px-2 !py-1 !text-[11px]"
                onClick={() => setEditingCrit(false)}
              >
                Hủy
              </Button>
            </div>
            <ErrorNote error={saveCritMut.error} />
          </div>
        ) : (
          <>
            <div className="font-semibold">{d.item_name || d.title}</div>
            <div className="text-[11px] text-slate-500 font-mono flex flex-wrap items-center gap-1.5">
              <span>
                {d.doc_type ? `Mã hồ sơ: ${d.doc_type} · ` : ""}
                {d.is_required ? "Bắt buộc" : "Tùy chọn"}
              </span>
              {canCustomize && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      saveCritMut.reset();
                      setCritName(d.item_name || d.title || "");
                      setCritDocType(d.doc_type || "DHF_DOC");
                      setCritRequired(Boolean(d.is_required));
                      setEditingCrit(true);
                    }}
                    className="text-sky-700 dark:text-sky-400 hover:underline font-sans font-semibold cursor-pointer"
                  >
                    ✏️ Sửa
                  </button>
                  <button
                    type="button"
                    disabled={delCritMut.isPending}
                    onClick={() => {
                      if (
                        (d.status !== "MISSING" || d.attachment_id) &&
                        !window.confirm(`Xóa hạng mục "${d.item_name || d.title}" khỏi cổng này?`)
                      ) {
                        return;
                      }
                      delCritMut.mutate();
                    }}
                    className="text-rose-600 dark:text-rose-400 hover:underline font-sans font-semibold cursor-pointer"
                  >
                    🗑️ Xóa
                  </button>
                </>
              )}
            </div>
            <ErrorNote error={delCritMut.error} />
          </>
        )}
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
                accept="application/pdf,image/png,image/jpeg,.doc,.docx,.xls,.xlsx"
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
  canEdit = false,
  canDelete = false,
  onRequestEdit,
  onRequestDelete,
  onClose,
}: {
  id: string;
  canManage: boolean;
  canReviewGate: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  onRequestEdit?: (proj: any) => void;
  onRequestDelete?: (proj: any) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const ctx = useRdContext("rd.view");
  const detail = useQuery({
    queryKey: ["factory", "rd", "project", id],
    queryFn: () => api<ProjectDetail>(`/api/factory/rd/projects/${id}`),
  });
  const ops = useQuery({
    queryKey: ["factory", "rd", "project-ops", id],
    queryFn: () => api<ProjectOpsData>(`/api/factory/rd/project-ops?project_id=${id}`),
  });
  const itemsQuery = useQuery({
    queryKey: ["factory", "rd", "master-items", "RD"],
    queryFn: () => api<{ rows: { id: string; code: string; name: string; base_uom: string; item_type: string; dept_qty_on_hand?: number }[] }>("/api/factory/master/items?page_size=2000&dept_scope=RD"),
  });

  const [subTab, setSubTab] = useState<"gates" | "wbs" | "materials" | "bom" | "tpp" | "risks" | "roadmap">("gates");

  // WBS Task form & filter state
  const [taskGate, setTaskGate] = useState("1");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskAssignee, setTaskAssignee] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [wbsStaffFilter, setWbsStaffFilter] = useState("");
  const [wbsGateFilter, setWbsGateFilter] = useState("");
  const [wbsVerdictFilter, setWbsVerdictFilter] = useState("");
  const [wbsNotice, setWbsNotice] = useState<string | null>(null);

  // Structured Result Recording Drawer / Modal state for WBS Task
  const [editingResultTask, setEditingResultTask] = useState<ProjectOpsData["tasks"][number] | null>(null);
  const [resAssignee, setResAssignee] = useState("");
  const [resStatus, setResStatus] = useState<"TODO" | "IN_PROGRESS" | "DONE" | "BLOCKED">("DONE");
  const [resProgress, setResProgress] = useState("100");
  const [resVerdict, setResVerdict] = useState<"PENDING" | "PASS" | "OPTIMIZE" | "FAIL">("PASS");
  const [resProtocol, setResProtocol] = useState("");
  const [resSummary, setResSummary] = useState("");
  const [resNextSteps, setResNextSteps] = useState("");
  const [resMetrics, setResMetrics] = useState<{ label: string; value: string; unit: string; target: string }[]>([]);
  const [resLinkedExpId, setResLinkedExpId] = useState("");
  const [resSyncToEln, setResSyncToEln] = useState(true);
  const [resAttachName, setResAttachName] = useState("");
  const [resAttachUrl, setResAttachUrl] = useState("");

  // Per-project Stage-Gate & Checklist customization state
  const [addingCritGateId, setAddingCritGateId] = useState<string | null>(null);
  const [newCritName, setNewCritName] = useState("");
  const [newCritDocType, setNewCritDocType] = useState("DHF_DOC");
  const [newCritRequired, setNewCritRequired] = useState(true);

  const [editingGateId, setEditingGateId] = useState<string | null>(null);
  const [editGateName, setEditGateName] = useState("");
  const [editGateStageAfter, setEditGateStageAfter] = useState("");

  const [showAddGateForm, setShowAddGateForm] = useState(false);
  const [newGateNo, setNewGateNo] = useState("");
  const [newGateName, setNewGateName] = useState("");
  const [newGateStageAfter, setNewGateStageAfter] = useState("");

  const [showReapplyTemplate, setShowReapplyTemplate] = useState(false);
  const [reapplyTemplateId, setReapplyTemplateId] = useState("");
  const [gateCustomizeNotice, setGateCustomizeNotice] = useState<string | null>(null);

  const openResultDrawer = (t: ProjectOpsData["tasks"][number]) => {
    setEditingResultTask(t);
    setResAssignee(t.assignee_name || detail.data?.leader_name || "");
    setResStatus(t.status === "TODO" ? "IN_PROGRESS" : t.status);
    setResProgress(String(t.progress_pct > 0 ? t.progress_pct : 100));
    setResVerdict(t.outcome_verdict && t.outcome_verdict !== "PENDING" ? t.outcome_verdict : "PASS");
    setResProtocol(
      t.protocol_summary ||
        "1. Chuẩn bị dải pha loãng mẫu chuẩn 10^5 -> 10^0 copies/rxn (n=3 lặp lại).\n2. Phối trộn MasterMix 2X (10 µL) + Primer/Probe Mix (2.5 µL) + Template (5 µL) + H2O (2.5 µL).\n3. Chương trình nhiệt: 95°C 3p; 45 chu kỳ (95°C 10s, 60°C 30s — đọc FAM/HEX)."
    );
    setResSummary(t.result_summary || "");
    setResNextSteps(t.next_steps || "");
    setResMetrics(
      Array.isArray(t.key_metrics_json) && t.key_metrics_json.length > 0
        ? t.key_metrics_json.map((m) => ({
            label: m.label || "",
            value: m.value || "",
            unit: m.unit || "",
            target: m.target || "",
          }))
        : [
            { label: "Giới hạn phát hiện (LoD95)", value: "10", unit: "copies/rxn", target: "≤ 15 copies/rxn" },
            { label: "Hệ số tuyến tính (R²)", value: "0.998", unit: "", target: "≥ 0.990" },
            { label: "Hiệu suất khuếch đại (E%)", value: "98.4", unit: "%", target: "90–110%" },
          ]
    );
    setResLinkedExpId(t.linked_experiment_id || "");
    setResSyncToEln(true);
    setResAttachName(t.attachment_name || "");
    setResAttachUrl(t.attachment_url || "");
  };

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
  const [resSev, setResSev] = useState("2");
  const [resOcc, setResOcc] = useState("1");
  const [resDet, setResDet] = useState("1");

  // Milestone form state
  const [msTitle, setMsTitle] = useState("");
  const [msDate, setMsDate] = useState("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["factory", "rd", "project", id] });
    qc.invalidateQueries({ queryKey: ["factory", "rd", "project-ops", id] });
    qc.invalidateQueries({ queryKey: ["factory", "rd", "projects"] });
  };

  const addGateCritMut = useMutation({
    mutationFn: (gateId: string) =>
      api(`/api/factory/rd/projects/${id}`, {
        method: "POST",
        json: {
          kind: "gate_deliverable",
          project_gate_id: gateId,
          item_name: newCritName,
          doc_type: newCritDocType || "DHF_DOC",
          is_required: newCritRequired,
        },
      }),
    onSuccess: () => {
      setAddingCritGateId(null);
      setNewCritName("");
      setNewCritDocType("DHF_DOC");
      setNewCritRequired(true);
      setGateCustomizeNotice("✅ Đã thêm tiêu chí / hạng mục hồ sơ vào cổng Stage-Gate.");
      refresh();
    },
  });

  const saveGateMetaMut = useMutation({
    mutationFn: (payload: { gate_id?: string | null; gate_no?: number; gate_name: string; stage_after: string }) =>
      api(`/api/factory/rd/projects/${id}`, {
        method: "POST",
        json: { kind: "gate_meta", ...payload },
      }),
    onSuccess: () => {
      setEditingGateId(null);
      setShowAddGateForm(false);
      setNewGateNo("");
      setNewGateName("");
      setNewGateStageAfter("");
      setGateCustomizeNotice("✅ Đã cập nhật thông tin cổng Stage-Gate của dự án.");
      refresh();
    },
  });

  const deleteGateMut = useMutation({
    mutationFn: (gateId: string) =>
      api(`/api/factory/rd/projects/${id}`, {
        method: "POST",
        json: { kind: "delete_gate", gate_id: gateId },
      }),
    onSuccess: () => {
      setEditingGateId(null);
      setGateCustomizeNotice("✅ Đã xóa cổng Stage-Gate khỏi dự án.");
      refresh();
    },
  });

  const reapplyTemplateMut = useMutation({
    mutationFn: (templateId: string) =>
      api(`/api/factory/rd/projects/${id}`, {
        method: "POST",
        json: { kind: "apply_gate_template", template_id: templateId },
      }),
    onSuccess: () => {
      setShowReapplyTemplate(false);
      setGateCustomizeNotice("✅ Đã áp dụng bộ mẫu Stage-Gate mới cho dự án.");
      refresh();
    },
  });

  const saveTaskMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api("/api/factory/rd/project-ops", {
        method: "POST",
        json: { op: "save_task", project_id: id, ...payload },
      }),
    onSuccess: () => {
      setTaskTitle("");
      if (editingResultTask) {
        setWbsNotice(`✅ Đã lưu kết quả thực nghiệm & minh chứng cho công việc ${editingResultTask.code} thành công!`);
        setEditingResultTask(null);
      }
      refresh();
      qc.invalidateQueries({ queryKey: ["factory", "rd", "experiments"] });
    },
  });

  const createTaskExpMut = useMutation({
    mutationFn: (payload: { task_id: string; protocol_summary?: string | null }) =>
      api<{ experiment_id: string; experiment_code: string; title: string }>("/api/factory/rd/project-ops", {
        method: "POST",
        json: { op: "create_task_experiment", project_id: id, ...payload },
      }),
    onSuccess: (res) => {
      setWbsNotice(`🧪 Đã khởi tạo & liên kết bài thí nghiệm Sổ ELN ${res.experiment_code} ("${res.title}") trực tiếp với công việc WBS!`);
      if (editingResultTask) {
        setResLinkedExpId(res.experiment_id);
      }
      refresh();
      qc.invalidateQueries({ queryKey: ["factory", "rd", "experiments"] });
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
    mutationFn: () => {
      const hasControl = controlMeasure.trim().length > 0;
      return api(`/api/factory/rd/projects/${id}`, {
        method: "POST",
        json: {
          kind: "risk",
          hazard,
          hazardous_situation: situation,
          harm,
          severity: Number(sev),
          probability: Number(prob),
          detectability: Number(det),
          control_measure: controlMeasure.trim() || null,
          status: hasControl ? "MITIGATED" : "OPEN",
          ...(hasControl
            ? {
                residual_severity: Number(resSev),
                residual_occurrence: Number(resOcc),
                residual_detection: Number(resDet),
              }
            : {}),
        },
      });
    },
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
    <Card
      title={p ? `Dự án ${p.code} — ${p.name}` : "Chi tiết dự án Stage-Gate"}
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          {canEdit && p && onRequestEdit && (
            <Button
              variant="ghost"
              onClick={() => onRequestEdit({ ...p, budget_amount: o?.budget_amount ?? p.budget_amount ?? 50000000 })}
            >
              ✏️ Sửa dự án
            </Button>
          )}
          {canDelete && p && onRequestDelete && (
            <Button
              variant="ghost"
              className="text-rose-600 dark:text-rose-400"
              disabled={Boolean(p.has_immutable_handoff)}
              title={
                p.has_immutable_handoff
                  ? "Không thể xóa dự án đã có hồ sơ chuyển giao công nghệ / phát hành phần mềm / dòng máy thương mại"
                  : "Xóa dự án R&D"
              }
              onClick={() => onRequestDelete(p)}
            >
              🗑️ Xóa dự án
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>Đóng</Button>
        </div>
      }
    >
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
                  Chi phí ước tính: {o.estimated_spent.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} / {o.budget_amount.toLocaleString("vi-VN", { maximumFractionDigits: 0 })} đ
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

          {subTab === "gates" && (() => {
            const canCustomizeGates =
              (canManage || canEdit || canReviewGate) &&
              p.status !== "TRANSFERRED" &&
              p.status !== "KILLED" &&
              !p.has_immutable_handoff;
            const canReapplyTemplate =
              canCustomizeGates &&
              !p.gates.some(
                (gt) =>
                  gt.status === "PASSED" ||
                  gt.deliverables.some((d) => d.status === "SUBMITTED" || d.status === "ACCEPTED" || Boolean(d.attachment_id))
              );
            const gateMutationErr =
              addGateCritMut.error ?? saveGateMetaMut.error ?? deleteGateMut.error ?? reapplyTemplateMut.error;

            const scopedProjTemplates = (ctx.data?.templates ?? []).filter((t) =>
              p.target_domain === "SOFTWARE" ? t.domain === "SOFTWARE" : t.domain !== "SOFTWARE"
            );
            const docSuggestions = p.target_domain === "SOFTWARE" ? SW_DOC_TYPE_SUGGESTIONS : DOC_TYPE_SUGGESTIONS;

            return (
              <div className="flex flex-col gap-3">
                <datalist id="rd-doc-type-datalist">
                  {docSuggestions.map((dt) => (
                    <option key={dt} value={dt} />
                  ))}
                </datalist>

                <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 text-xs">
                  <div className="space-y-0.5">
                    <div>
                      <b>Bộ mẫu gốc:</b>{" "}
                      <span className="font-semibold text-sky-700 dark:text-sky-400">
                        {p.template_name || "Tùy chỉnh theo dự án"}
                      </span>
                    </div>
                    {canCustomizeGates && (
                      <div className="text-[11px] text-slate-500">
                        {p.target_domain === "SOFTWARE"
                          ? "Có thể thêm, sửa hoặc bỏ bớt tiêu chí Checklist IEC 62304 trực tiếp trên mọi cổng chưa duyệt qua cổng (PASSED)."
                          : "Có thể thêm, sửa hoặc bỏ bớt tiêu chí Checklist DHF trực tiếp trên mọi cổng chưa duyệt qua cổng (PASSED)."}
                      </div>
                    )}
                  </div>
                  {canCustomizeGates && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        className="!px-2.5 !py-1 !text-[11px]"
                        onClick={() => {
                          saveGateMetaMut.reset();
                          const nextNo = p.gates.length
                            ? Math.min(10, Math.max(...p.gates.map((x) => Number(x.gate_no))) + 1)
                            : 0;
                          setNewGateNo(String(nextNo));
                          setNewGateName(`Gate ${nextNo}: Cổng bổ sung`);
                          setNewGateStageAfter(`G${Math.min(10, nextNo + 1)}_STAGE`);
                          setShowAddGateForm((v) => !v);
                        }}
                      >
                        {showAddGateForm ? "Đóng form thêm cổng" : "➕ Thêm Cổng Gate"}
                      </Button>
                      {canReapplyTemplate && scopedProjTemplates.length > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          className="!px-2.5 !py-1 !text-[11px]"
                          onClick={() => {
                            reapplyTemplateMut.reset();
                            setReapplyTemplateId(
                              scopedProjTemplates.some((t) => t.id === p.gate_template_id)
                                ? (p.gate_template_id as string)
                                : scopedProjTemplates[0]?.id || ""
                            );
                            setShowReapplyTemplate((v) => !v);
                          }}
                        >
                          🔄 Áp dụng lại từ Mẫu Gate
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {gateCustomizeNotice && (
                  <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-semibold flex items-center justify-between">
                    <span>{gateCustomizeNotice}</span>
                    <button type="button" className="underline ml-2" onClick={() => setGateCustomizeNotice(null)}>
                      Đóng
                    </button>
                  </div>
                )}

                <ErrorNote error={gateMutationErr} />

                {canCustomizeGates && showAddGateForm && (
                  <form
                    className="grid gap-2 sm:grid-cols-6 items-end p-3 rounded-xl border border-sky-300 dark:border-sky-800 bg-sky-50/40 dark:bg-sky-950/20"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveGateMetaMut.mutate({
                        gate_no: Number(newGateNo),
                        gate_name: newGateName,
                        stage_after: newGateStageAfter,
                      });
                    }}
                  >
                    <Field label="Số Gate (0–10) *">
                      <input
                        type="number"
                        min={0}
                        max={10}
                        className={inputClass}
                        value={newGateNo}
                        onChange={(e) => setNewGateNo(e.target.value)}
                        required
                      />
                    </Field>
                    <div className="sm:col-span-3">
                      <Field label="Tên Cổng Stage-Gate *">
                        <input
                          className={inputClass}
                          value={newGateName}
                          onChange={(e) => setNewGateName(e.target.value)}
                          placeholder="VD: Gate 5: Theo dõi hậu mại & Nâng cấp v2"
                          required
                        />
                      </Field>
                    </div>
                    <Field label="Mở sang Giai đoạn *">
                      <input
                        className={`${inputClass} font-mono`}
                        value={newGateStageAfter}
                        onChange={(e) => setNewGateStageAfter(e.target.value)}
                        placeholder="VD: G5_POSTMARKET"
                        required
                      />
                    </Field>
                    <div className="flex gap-1.5">
                      <Button type="submit" disabled={saveGateMetaMut.isPending}>
                        {saveGateMetaMut.isPending ? "Đang tạo..." : "Tạo cổng"}
                      </Button>
                    </div>
                  </form>
                )}

                {canReapplyTemplate && showReapplyTemplate && (
                  <form
                    className="flex flex-wrap items-end gap-2 p-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (reapplyTemplateId) reapplyTemplateMut.mutate(reapplyTemplateId);
                    }}
                  >
                    <div className="min-w-72 flex-1">
                      <Field label="Chọn Bộ mẫu Stage-Gate áp dụng cho dự án (thay thế checklist trắng hiện tại)">
                        <select
                          className={inputClass}
                          value={reapplyTemplateId}
                          onChange={(e) => setReapplyTemplateId(e.target.value)}
                          required
                        >
                          <option value="">-- Chọn bộ mẫu Gate --</option>
                          {(ctx.data?.templates ?? [])
                            .filter((t) => (p.target_domain === "SOFTWARE" ? t.domain === "SOFTWARE" : t.domain !== "SOFTWARE"))
                            .map((t) => {
                              const gateCount = new Set(t.items.map((x) => x.gate_no)).size;
                              return (
                                <option key={t.id} value={t.id}>
                                  {t.name} ({t.code} · {gateCount} cổng · {t.items.length} tiêu chí)
                                </option>
                              );
                            })}
                        </select>
                      </Field>
                    </div>
                    <Button type="submit" disabled={reapplyTemplateMut.isPending || !reapplyTemplateId}>
                      {reapplyTemplateMut.isPending ? "Đang áp dụng..." : "Áp dụng mẫu này"}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setShowReapplyTemplate(false)}>
                      Hủy
                    </Button>
                  </form>
                )}

                {p.gates.map((g) => {
                  const gateEditable = canCustomizeGates && g.status !== "PASSED";
                  const isEditingThisGate = editingGateId === g.id;
                  const isAddingCritToGate = addingCritGateId === g.id;
                  return (
                    <div key={g.id} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col gap-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <b className="text-sm">{g.gate_name}</b>
                          <span className="ml-2 text-slate-500">
                            → Mở sang giai đoạn: <code className="font-mono">{g.stage_after}</code>
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {gateEditable && (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                className="!px-2 !py-0.5 !text-[11px]"
                                onClick={() => {
                                  addGateCritMut.reset();
                                  setNewCritName("");
                                  setNewCritDocType("DHF_DOC");
                                  setNewCritRequired(true);
                                  setAddingCritGateId(isAddingCritToGate ? null : g.id);
                                }}
                              >
                                {isAddingCritToGate ? "Đóng" : "+ Thêm tiêu chí"}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                className="!px-2 !py-0.5 !text-[11px]"
                                onClick={() => {
                                  saveGateMetaMut.reset();
                                  setEditGateName(g.gate_name);
                                  setEditGateStageAfter(g.stage_after);
                                  setEditingGateId(isEditingThisGate ? null : g.id);
                                }}
                              >
                                ✏️ Sửa cổng
                              </Button>
                            </>
                          )}
                          <StatusBadge status={GATE_STATUS[g.status]?.[0] ?? "QUARANTINE"} label={GATE_STATUS[g.status]?.[1] ?? g.status} />
                        </div>
                      </div>

                      {gateEditable && isEditingThisGate && (
                        <form
                          className="grid gap-2 sm:grid-cols-6 items-end p-2.5 rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50/40 dark:bg-sky-950/20"
                          onSubmit={(e) => {
                            e.preventDefault();
                            saveGateMetaMut.mutate({
                              gate_id: g.id,
                              gate_name: editGateName,
                              stage_after: editGateStageAfter,
                            });
                          }}
                        >
                          <div className="sm:col-span-3">
                            <Field label="Tên Cổng Stage-Gate *">
                              <input
                                className={inputClass}
                                value={editGateName}
                                onChange={(e) => setEditGateName(e.target.value)}
                                required
                              />
                            </Field>
                          </div>
                          <div className="sm:col-span-2">
                            <Field label="Giai đoạn sau cổng *">
                              <input
                                className={`${inputClass} font-mono`}
                                value={editGateStageAfter}
                                onChange={(e) => setEditGateStageAfter(e.target.value)}
                                required
                              />
                            </Field>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            <Button type="submit" className="!px-2.5 !py-1 !text-[11px]" disabled={saveGateMetaMut.isPending}>
                              Lưu cổng
                            </Button>
                            {p.gates.length > 1 && (
                              <Button
                                type="button"
                                variant="danger"
                                className="!px-2.5 !py-1 !text-[11px]"
                                disabled={deleteGateMut.isPending}
                                onClick={() => {
                                  if (!window.confirm(`Xóa "${g.gate_name}" và toàn bộ tiêu chí chưa nộp của cổng này?`)) return;
                                  deleteGateMut.mutate(g.id);
                                }}
                              >
                                🗑️ Xóa cổng
                              </Button>
                            )}
                          </div>
                        </form>
                      )}

                      {gateEditable && isAddingCritToGate && (
                        <form
                          className="grid gap-2 sm:grid-cols-6 items-end p-2.5 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-950/20"
                          onSubmit={(e) => {
                            e.preventDefault();
                            addGateCritMut.mutate(g.id);
                          }}
                        >
                          <div className="sm:col-span-3">
                            <Field label="Tên tiêu chí / Hạng mục hồ sơ mới *">
                              <input
                                className={inputClass}
                                value={newCritName}
                                onChange={(e) => setNewCritName(e.target.value)}
                                placeholder="VD: Báo cáo so sánh độ tương đồng mẫu lâm sàng với Kit tham chiếu"
                                required
                                autoFocus
                              />
                            </Field>
                          </div>
                          <Field label="Mã hồ sơ">
                            <input
                              list="rd-doc-type-datalist"
                              className={`${inputClass} font-mono`}
                              value={newCritDocType}
                              onChange={(e) => setNewCritDocType(e.target.value)}
                              placeholder="DHF_DOC"
                            />
                          </Field>
                          <div className="pb-1.5">
                            <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                              <input
                                type="checkbox"
                                checked={newCritRequired}
                                onChange={(e) => setNewCritRequired(e.target.checked)}
                              />
                              <span>Bắt buộc</span>
                            </label>
                          </div>
                          <div className="flex gap-1">
                            <Button type="submit" className="!px-2.5 !py-1 !text-[11px]" disabled={addGateCritMut.isPending}>
                              Lưu tiêu chí
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              className="!px-2 !py-1 !text-[11px]"
                              onClick={() => setAddingCritGateId(null)}
                            >
                              Hủy
                            </Button>
                          </div>
                        </form>
                      )}

                      {g.decided_by_name && (
                        <div className="text-[11px] text-slate-500">
                          Quyết định gần nhất: <b>{g.decision}</b> bởi {g.decided_by_name} ({fmtDate(g.decided_at)}) {g.decision_note && `— "${g.decision_note}"`}
                        </div>
                      )}
                      {g.deliverables.length === 0 ? (
                        <div className="text-xs text-slate-500 py-2">
                          Cổng này chưa có tiêu chí/hồ sơ nào. Hãy bấm <b>+ Thêm tiêu chí</b> để bổ sung yêu cầu cần nộp cho cổng.
                        </div>
                      ) : (
                        <Table head={["#", "Tiêu chí / Hạng mục hồ sơ (Checklist DHF)", "Minh chứng / File đính kèm", "Trạng thái", "Thẩm định cổng"]}>
                          {g.deliverables.map((d) => (
                            <DeliverableRow
                              key={d.id}
                              d={d}
                              projectId={p.id}
                              gateId={g.id}
                              gateStatus={g.status}
                              canManage={canManage}
                              canReview={canReviewGate}
                              canCustomize={gateEditable}
                              onDone={refresh}
                            />
                          ))}
                        </Table>
                      )}
                      <ActionBar endpoint={`/api/factory/rd/gates/${g.id}/actions`} version={g.version} actions={g.actions} labels={GATE_ACTIONS} onDone={refresh} />
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {subTab === "wbs" && (
            <div className="flex flex-col gap-3">
              {/* Best-in-Class R&D Execution Loop Banner */}
              <div className="p-3 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/20 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-bold text-indigo-900 dark:text-indigo-200">
                    Chuẩn Ghi Nhận Kết Quả Nghiên Cứu 4 Lớp (Benchling R&D Cloud / SciNote ELN / ISO 13485 Design Control)
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                    <b>Lớp 1:</b> Tóm tắt Protocol & điều kiện thực nghiệm → <b>Lớp 2:</b> Bảng chỉ số định lượng (LoD, Ct, R², CV%) so với Target →{" "}
                    <b>Lớp 3:</b> Kết luận đánh giá (ĐẠT / CẦN TỐI ƯU / KHÔNG ĐẠT) & Hướng xử lý tiếp theo → <b>Lớp 4:</b> Liên kết 2 chiều với Sổ thí nghiệm điện tử (ELN) & File dữ liệu gốc.
                  </div>
                </div>
              </div>

              {wbsNotice && (
                <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 font-semibold flex items-center justify-between">
                  <span>{wbsNotice}</span>
                  <button type="button" className="text-xs underline ml-2" onClick={() => setWbsNotice(null)}>
                    Đóng
                  </button>
                </div>
              )}

              <datalist id="rd-staff-datalist">
                {staffOfUnit(ctx.data, detail.data?.owner_org_unit_id).map((st) => (
                  <option key={st.name} value={st.name}>
                    {st.specialty}
                  </option>
                ))}
              </datalist>

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
                      <input
                        className={inputClass}
                        value={taskTitle}
                        onChange={(e) => setTaskTitle(e.target.value)}
                        placeholder="VD: Khảo sát nhiệt độ bắt cặp mồi Annealing 56–62°C"
                        required
                      />
                    </Field>
                  </div>
                  <Field label="Nghiên cứu viên phụ trách (Phòng R&D)">
                    <input
                      list="rd-staff-datalist"
                      className={inputClass}
                      value={taskAssignee}
                      onChange={(e) => setTaskAssignee(e.target.value)}
                      placeholder={p.leader_name || "Chọn / nhập tên NCV..."}
                    />
                  </Field>
                  <Field label="Hạn hoàn thành">
                    <input type="date" className={inputClass} value={taskDue} onChange={(e) => setTaskDue(e.target.value)} />
                  </Field>
                  <Button type="submit" disabled={saveTaskMut.isPending}>
                    + Giao việc WBS
                  </Button>
                </form>
              )}

              {/* WBS Filter Bar by Researcher, Gate, and Outcome */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">🔎 Lọc công việc WBS:</span>
                  <select className={`${inputClass} w-64`} value={wbsStaffFilter} onChange={(e) => setWbsStaffFilter(e.target.value)}>
                    <option value="">👤 Tất cả nghiên cứu viên phụ trách ({o?.tasks.length ?? 0})</option>
                    {Array.from(
                      new Set([
                        ...(o?.tasks.map((t) => t.assignee_name).filter(Boolean) as string[]),
                        ...staffOfUnit(ctx.data, detail.data?.owner_org_unit_id).map((s) => s.name),
                      ])
                    ).map((staffName) => (
                      <option key={staffName} value={staffName}>
                        {staffName}
                      </option>
                    ))}
                  </select>
                  <select className={`${inputClass} w-44`} value={wbsGateFilter} onChange={(e) => setWbsGateFilter(e.target.value)}>
                    <option value="">Mọi cổng Stage-Gate</option>
                    <option value="0">Cổng G0 (Khảo sát & TPP)</option>
                    <option value="1">Cổng G1 (Feasibility)</option>
                    <option value="2">Cổng G2 (Optimization)</option>
                    <option value="3">Cổng G3 (Validation V&V)</option>
                    <option value="4">Cổng G4 (Transfer SX)</option>
                  </select>
                  <select className={`${inputClass} w-48`} value={wbsVerdictFilter} onChange={(e) => setWbsVerdictFilter(e.target.value)}>
                    <option value="">Mọi kết quả / trạng thái</option>
                    <option value="PASS">✅ Kết luận: ĐẠT MỤC TIÊU</option>
                    <option value="OPTIMIZE">🔧 Kết luận: CẦN TỐI ƯU THÊM</option>
                    <option value="FAIL">❌ Kết luận: KHÔNG ĐẠT</option>
                    <option value="HAS_RESULT">📊 Đã có báo cáo kết quả</option>
                    <option value="NO_RESULT">⏳ Chưa ghi nhận kết quả</option>
                  </select>
                  {(wbsStaffFilter || wbsGateFilter || wbsVerdictFilter) && (
                    <button
                      type="button"
                      className="text-xs text-sky-700 dark:text-sky-400 underline cursor-pointer"
                      onClick={() => {
                        setWbsStaffFilter("");
                        setWbsGateFilter("");
                        setWbsVerdictFilter("");
                      }}
                    >
                      Xóa bộ lọc
                    </button>
                  )}
                </div>
                <div className="text-[11px] text-slate-500">
                  Đã ghi nhận kết quả:{" "}
                  <b className="text-emerald-700 dark:text-emerald-400">
                    {(o?.tasks ?? []).filter((t) => t.result_summary || (t.key_metrics_json?.length ?? 0) > 0).length}/{o?.tasks.length ?? 0} công việc
                  </b>
                </div>
              </div>

              {/* Structured Result Recording Drawer / Panel */}
              {editingResultTask && (
                <form
                  className="p-4 rounded-2xl border-2 border-sky-500/80 dark:border-sky-500/70 bg-sky-50/30 dark:bg-slate-900 shadow-lg flex flex-col gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveTaskMut.mutate({
                      task_id: editingResultTask.id,
                      gate_no: editingResultTask.gate_no,
                      title: editingResultTask.title,
                      assignee_name: resAssignee || editingResultTask.assignee_name || p.leader_name,
                      due_date: editingResultTask.due_date?.slice(0, 10) || null,
                      status: resStatus,
                      progress_pct: Number(resProgress || 100),
                      linked_experiment_id: resLinkedExpId || null,
                      protocol_summary: resProtocol || null,
                      result_summary: resSummary || null,
                      key_metrics_json: resMetrics.filter((m) => m.label.trim() !== "" || m.value.trim() !== ""),
                      outcome_verdict: resVerdict,
                      next_steps: resNextSteps || null,
                      attachment_name: resAttachName || null,
                      attachment_url: resAttachUrl || null,
                      sync_to_eln: resSyncToEln,
                    });
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-200 dark:border-slate-800 pb-2.5">
                    <div>
                      <div className="text-sm font-bold text-sky-900 dark:text-sky-300">
                        📝 Phiếu Ghi Nhận Kết Quả Thực Nghiệm & Minh Chứng Công Việc WBS:{" "}
                        <span className="font-mono">{editingResultTask.code}</span> (Cổng G{editingResultTask.gate_no})
                      </div>
                      <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 mt-0.5">{editingResultTask.title}</div>
                    </div>
                    <Button type="button" variant="ghost" onClick={() => setEditingResultTask(null)}>
                      Đóng phiếu
                    </Button>
                  </div>

                  {/* Row 1: Assignee, Execution Status, Progress %, Verdict, Linked ELN */}
                  <div className="grid gap-2.5 sm:grid-cols-5">
                    <Field label="Nghiên cứu viên thực hiện *">
                      <input
                        list="rd-staff-datalist"
                        className={inputClass}
                        value={resAssignee}
                        onChange={(e) => setResAssignee(e.target.value)}
                        required
                      />
                    </Field>
                    <Field label="Trạng thái công việc">
                      <select className={inputClass} value={resStatus} onChange={(e) => setResStatus(e.target.value as any)}>
                        <option value="IN_PROGRESS">Đang thực hiện</option>
                        <option value="DONE">Hoàn thành (100%)</option>
                        <option value="BLOCKED">Vướng mắc kỹ thuật</option>
                        <option value="TODO">Chưa làm</option>
                      </select>
                    </Field>
                    <Field label="Tiến độ (%)">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        className={inputClass}
                        value={resProgress}
                        onChange={(e) => setResProgress(e.target.value)}
                      />
                    </Field>
                    <Field label="Đánh giá kết luận (Verdict) *">
                      <select className={inputClass} value={resVerdict} onChange={(e) => setResVerdict(e.target.value as any)}>
                        <option value="PASS">✅ ĐẠT MỤC TIÊU (PASS)</option>
                        <option value="OPTIMIZE">🔧 CẦN TỐI ƯU THÊM (OPTIMIZE)</option>
                        <option value="FAIL">❌ KHÔNG ĐẠT (FAIL)</option>
                        <option value="PENDING">⏳ ĐANG ĐÁNH GIÁ</option>
                      </select>
                    </Field>
                    <Field label="Liên kết bài Sổ thí nghiệm ELN">
                      <div className="flex gap-1">
                        <select className={inputClass} value={resLinkedExpId} onChange={(e) => setResLinkedExpId(e.target.value)}>
                          <option value="">-- Chưa liên kết ELN --</option>
                          {(o?.experiments ?? []).map((ex) => (
                            <option key={ex.id} value={ex.id}>
                              {ex.code} — {ex.title}
                            </option>
                          ))}
                        </select>
                        {!resLinkedExpId && (
                          <button
                            type="button"
                            title="Khởi tạo nhanh bài ELN từ công việc WBS này"
                            className="px-2 py-1 rounded-lg bg-indigo-600 text-white font-semibold text-[11px] whitespace-nowrap cursor-pointer hover:bg-indigo-500"
                            onClick={() => createTaskExpMut.mutate({ task_id: editingResultTask.id, protocol_summary: resProtocol })}
                            disabled={createTaskExpMut.isPending}
                          >
                            + Tạo ELN
                          </button>
                        )}
                      </div>
                    </Field>
                  </div>

                  {/* Layer 1 & Layer 3: Protocol Summary & Result Summary */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="1. Phương pháp, Quy trình & Điều kiện thực nghiệm đã chạy (Protocol & Conditions)">
                      <textarea
                        rows={3}
                        className={inputClass}
                        value={resProtocol}
                        onChange={(e) => setResProtocol(e.target.value)}
                        placeholder="Mô tả công thức phối trộn, nồng độ mồi/probe, chu kỳ nhiệt, thiết bị sử dụng, cỡ mẫu..."
                      />
                    </Field>
                    <Field label="2. Tóm tắt Kết quả chính & Nhận xét chuyên môn (Executive Scientific Result) *">
                      <textarea
                        rows={3}
                        className={inputClass}
                        value={resSummary}
                        onChange={(e) => setResSummary(e.target.value)}
                        placeholder="VD: Phản ứng đạt tín hiệu huỳnh quang FAM cao (ΔRn = 4.2), đường chuẩn tuyến tính R² = 0.998, phát hiện 100% (20/20) tại nồng độ 10 copies/rxn, không xuất hiện Primer-dimer ở NTC..."
                        required
                      />
                    </Field>
                  </div>

                  {/* Layer 2: Structured Quantitative Metrics Table */}
                  <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/60 flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <b className="text-xs text-slate-800 dark:text-slate-200">
                        3. Bảng Thông Số Định Lượng Đạt Được (Structured Quantitative Metrics — Ct, LoD95, R², E%, CV%, Độ đặc hiệu...)
                      </b>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-semibold cursor-pointer"
                          onClick={() =>
                            setResMetrics([
                              { label: "Giới hạn phát hiện (LoD95)", value: "10", unit: "copies/rxn", target: "≤ 15 copies/rxn" },
                              { label: "Hệ số tuyến tính (R²)", value: "0.998", unit: "", target: "≥ 0.990" },
                              { label: "Hiệu suất khuếch đại (E%)", value: "98.5", unit: "%", target: "90–110%" },
                              { label: "Độ lệch chuẩn lặp lại (CV%)", value: "1.85", unit: "%", target: "≤ 5.0%" },
                            ])
                          }
                        >
                          ⚡ Mẫu chỉ số qPCR/IVD
                        </button>
                        <button
                          type="button"
                          className="px-2 py-0.5 rounded bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 text-[11px] font-semibold cursor-pointer"
                          onClick={() => setResMetrics([...resMetrics, { label: "", value: "", unit: "", target: "" }])}
                        >
                          + Thêm chỉ số đo
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      {resMetrics.map((m, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                          <div className="col-span-4">
                            <input
                              className={inputClass}
                              value={m.label}
                              onChange={(e) => {
                                const next = [...resMetrics];
                                next[idx] = { ...next[idx], label: e.target.value };
                                setResMetrics(next);
                              }}
                              placeholder="Tên thông số (VD: Ct tại 10^3 copies)"
                            />
                          </div>
                          <div className="col-span-3">
                            <input
                              className={inputClass}
                              value={m.value}
                              onChange={(e) => {
                                const next = [...resMetrics];
                                next[idx] = { ...next[idx], value: e.target.value };
                                setResMetrics(next);
                              }}
                              placeholder="Giá trị đạt được (VD: 26.4 ± 0.2)"
                            />
                          </div>
                          <div className="col-span-2">
                            <input
                              className={inputClass}
                              value={m.unit}
                              onChange={(e) => {
                                const next = [...resMetrics];
                                next[idx] = { ...next[idx], unit: e.target.value };
                                setResMetrics(next);
                              }}
                              placeholder="Đơn vị (copies/rxn, %)"
                            />
                          </div>
                          <div className="col-span-2">
                            <input
                              className={inputClass}
                              value={m.target}
                              onChange={(e) => {
                                const next = [...resMetrics];
                                next[idx] = { ...next[idx], target: e.target.value };
                                setResMetrics(next);
                              }}
                              placeholder="Mục tiêu (≤ 28.0)"
                            />
                          </div>
                          <div className="col-span-1 text-right">
                            <button
                              type="button"
                              className="text-rose-600 hover:underline text-xs cursor-pointer"
                              onClick={() => setResMetrics(resMetrics.filter((_, i) => i !== idx))}
                            >
                              Xóa
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Layer 4: Next Steps, Raw Data File Attachment, and Auto-Sync to ELN */}
                  <div className="grid gap-3 sm:grid-cols-2 items-end">
                    <Field label="4. Đề xuất bước tiếp theo / Khuyến nghị kỹ thuật (Next Action / CAPA / Optimization)">
                      <input
                        className={inputClass}
                        value={resNextSteps}
                        onChange={(e) => setResNextSteps(e.target.value)}
                        placeholder="VD: Chốt công thức MasterMix v1.2 để chuyển sang thẩm định độ ổn định tăng tốc Gate 3..."
                      />
                    </Field>
                    <Field label="5. Đính kèm File Báo cáo / Ảnh điện di Gel / Biểu đồ đường cong qPCR (.pdf, .png, .xlsx, .csv)">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="file"
                          accept=".pdf,.png,.jpg,.jpeg,.xls,.xlsx,.csv,.doc,.docx,.zip"
                          className="text-[11px]"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            setResAttachName(f.name);
                            const reader = new FileReader();
                            reader.onload = () => {
                              if (typeof reader.result === "string") {
                                setResAttachUrl(reader.result);
                              }
                            };
                            reader.readAsDataURL(f);
                          }}
                        />
                        {resAttachName && (
                          <span className="px-2 py-0.5 rounded bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200 font-mono text-[11px]">
                            📎 {resAttachName}
                          </span>
                        )}
                      </div>
                    </Field>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-sky-200 dark:border-slate-800">
                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={resSyncToEln}
                        onChange={(e) => setResSyncToEln(e.target.checked)}
                      />
                      <span>
                        🔄 Tự động ghi đồng bộ kết quả & bảng thông số này vào mục <code className="font-mono">RESULT</code> của bài Sổ thí nghiệm ELN liên kết (ALCOA+ Audit Trail)
                      </span>
                    </label>
                    <div className="flex gap-2">
                      <Button type="button" variant="ghost" onClick={() => setEditingResultTask(null)}>
                        Hủy
                      </Button>
                      <Button type="submit" disabled={saveTaskMut.isPending}>
                        💾 Lưu Kết Quả Thực Nghiệm & Cập Nhật WBS
                      </Button>
                    </div>
                  </div>
                </form>
              )}

              {(o?.tasks.length ?? 0) === 0 ? (
                <Empty>Chưa có hạng mục công việc WBS nào.</Empty>
              ) : (
                <Table
                  head={[
                    "Mã việc",
                    "Cổng",
                    "Nội dung công việc & Kết quả thực nghiệm ghi nhận",
                    "Người phụ trách (R&D)",
                    "Liên kết Sổ ELN",
                    "Hạn chót",
                    "Tiến độ & Kết luận",
                    "Thao tác & Ghi kết quả",
                  ]}
                >
                  {(o?.tasks ?? [])
                    .filter((t) => {
                      if (wbsStaffFilter && (t.assignee_name || "") !== wbsStaffFilter) return false;
                      if (wbsGateFilter && String(t.gate_no) !== wbsGateFilter) return false;
                      if (wbsVerdictFilter === "HAS_RESULT") return Boolean(t.result_summary || (t.key_metrics_json?.length ?? 0) > 0);
                      if (wbsVerdictFilter === "NO_RESULT") return !t.result_summary && (t.key_metrics_json?.length ?? 0) === 0;
                      if (wbsVerdictFilter && t.outcome_verdict !== wbsVerdictFilter) return false;
                      return true;
                    })
                    .map((t) => {
                      const metrics = Array.isArray(t.key_metrics_json) ? t.key_metrics_json : [];
                      const hasResult = Boolean(t.result_summary || metrics.length > 0 || t.protocol_summary);
                      return (
                        <tr key={t.id} className="align-top">
                          <td className="py-2.5 pr-3 font-mono font-semibold text-sky-700 dark:text-sky-400 whitespace-nowrap">{t.code}</td>
                          <td className="py-2.5 pr-3 font-mono font-bold">G{t.gate_no}</td>
                          <td className="py-2.5 pr-3 min-w-80">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">{t.title}</div>
                            {hasResult ? (
                              <div className="mt-1.5 p-2.5 rounded-xl border border-emerald-200/80 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-1.5">
                                {t.protocol_summary && (
                                  <div className="text-[11px] text-slate-600 dark:text-slate-400">
                                    <b className="text-slate-700 dark:text-slate-300">🧪 Protocol:</b> {t.protocol_summary}
                                  </div>
                                )}
                                {t.result_summary && (
                                  <div className="text-[11px] text-slate-800 dark:text-slate-200">
                                    <b className="text-emerald-800 dark:text-emerald-300">📊 Kết quả:</b> {t.result_summary}
                                  </div>
                                )}
                                {metrics.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                                    {metrics.map((m, i) => (
                                      <span
                                        key={i}
                                        className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-800 text-[11px] font-mono"
                                      >
                                        <b>{m.label}:</b> <span className="text-emerald-700 dark:text-emerald-400 font-bold">{m.value}</span>{" "}
                                        {m.unit || ""} {m.target ? <span className="text-slate-400">(Đích: {m.target})</span> : null}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {t.next_steps && (
                                  <div className="text-[11px] text-indigo-700 dark:text-indigo-300">
                                    <b>👉 Bước tiếp theo:</b> {t.next_steps}
                                  </div>
                                )}
                                <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500 pt-0.5">
                                  {t.attachment_name && (
                                    <a
                                      href={t.attachment_url || "#"}
                                      download={t.attachment_name}
                                      className="text-sky-700 dark:text-sky-400 underline font-semibold"
                                    >
                                      📎 File báo cáo: {t.attachment_name}
                                    </a>
                                  )}
                                  {t.completed_by_name && (
                                    <span>
                                      Cập nhật bởi: <b>{t.completed_by_name}</b> {t.completed_at ? `(${fmtDate(t.completed_at)})` : ""}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div className="text-[11px] text-slate-400 mt-0.5 italic">
                                Chưa ghi nhận kết quả thực nghiệm — bấm &ldquo;📝 Ghi nhận Kết quả&rdquo; để nhập số liệu & minh chứng.
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 pr-3">
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-medium text-slate-800 dark:text-slate-200 inline-block">
                              👤 {t.assignee_name || p.leader_name || "—"}
                            </span>
                          </td>
                          <td className="py-2.5 pr-3">
                            {t.experiment_code ? (
                              <div className="flex flex-col gap-0.5">
                                <span className="px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/70 text-indigo-800 dark:text-indigo-300 font-mono font-bold text-[11px] inline-block w-fit">
                                  🧪 {t.experiment_code}
                                </span>
                                {t.experiment_title && <span className="text-[10px] text-slate-500 line-clamp-1">{t.experiment_title}</span>}
                              </div>
                            ) : canManage ? (
                              <button
                                type="button"
                                className="px-2 py-1 rounded-lg border border-indigo-300 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                                onClick={() => createTaskExpMut.mutate({ task_id: t.id, protocol_summary: t.protocol_summary })}
                                disabled={createTaskExpMut.isPending}
                              >
                                🧪 + Tạo & Liên kết ELN
                              </button>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-2.5 pr-3 font-mono whitespace-nowrap">{fmtDate(t.due_date)}</td>
                          <td className="py-2.5 pr-3">
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1.5">
                                <StatusBadge
                                  status={
                                    t.status === "DONE"
                                      ? "RELEASED"
                                      : t.status === "IN_PROGRESS"
                                      ? "PENDING_QC"
                                      : t.status === "BLOCKED"
                                      ? "REJECTED"
                                      : "QUARANTINE"
                                  }
                                  label={
                                    t.status === "DONE"
                                      ? `Hoàn thành (${t.progress_pct}%)`
                                      : t.status === "IN_PROGRESS"
                                      ? `Đang làm (${t.progress_pct}%)`
                                      : t.status === "BLOCKED"
                                      ? "Vướng mắc"
                                      : "Chưa làm"
                                  }
                                />
                              </div>
                              {t.outcome_verdict && t.outcome_verdict !== "PENDING" && (
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold w-fit ${
                                    t.outcome_verdict === "PASS"
                                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                                      : t.outcome_verdict === "OPTIMIZE"
                                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                                      : "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                                  }`}
                                >
                                  {t.outcome_verdict === "PASS"
                                    ? "✅ KẾT LUẬN: ĐẠT"
                                    : t.outcome_verdict === "OPTIMIZE"
                                    ? "🔧 CẦN TỐI ƯU THÊM"
                                    : "❌ KHÔNG ĐẠT"}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 pr-3">
                            {canManage && (
                              <div className="flex flex-col gap-1">
                                <button
                                  type="button"
                                  className="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold text-[11px] cursor-pointer whitespace-nowrap text-left"
                                  onClick={() => openResultDrawer(t)}
                                >
                                  📝 {hasResult ? "Sửa Kết quả & Số liệu" : "Ghi nhận Kết quả"}
                                </button>
                                <div className="flex gap-1">
                                  {t.status !== "IN_PROGRESS" && t.status !== "DONE" && (
                                    <button
                                      type="button"
                                      className="px-2 py-0.5 rounded bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 font-semibold text-[11px] cursor-pointer"
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
                                      className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 font-semibold text-[11px] cursor-pointer"
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
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
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
                    {controlMeasure.trim().length > 0 && (
                      <Field label="Tồn dư S×P×D">
                        <div className="flex gap-1">
                          <input type="number" min="1" max="5" className={`${inputClass} w-12`} value={resSev} onChange={(e) => setResSev(e.target.value)} title="Residual Severity" />
                          <input type="number" min="1" max="5" className={`${inputClass} w-12`} value={resOcc} onChange={(e) => setResOcc(e.target.value)} title="Residual Occurrence" />
                          <input type="number" min="1" max="5" className={`${inputClass} w-12`} value={resDet} onChange={(e) => setResDet(e.target.value)} title="Residual Detection" />
                        </div>
                      </Field>
                    )}
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

const BUILTIN_TEMPLATE_CODES = new Set(["SG_IVD_KIT", "SG_SOFTWARE", "SG_DEVICE_DHF"]);

type GateDraft = {
  gate_no: number;
  gate_name: string;
  stage_after: string;
  items: { item_name: string; doc_type: string; is_required: boolean }[];
};

function groupTemplateToGates(
  tpl?: { items?: { gate_no: number; gate_name: string; stage_after: string; item_name: string; doc_type: string; is_required: boolean }[] } | null,
  mode: "RD" | "SOFTWARE" = "RD"
): GateDraft[] {
  const byGate = new Map<number, GateDraft>();
  for (const it of tpl?.items ?? []) {
    const no = Number(it.gate_no);
    if (!byGate.has(no)) {
      byGate.set(no, {
        gate_no: no,
        gate_name: it.gate_name,
        stage_after: it.stage_after,
        items: [],
      });
    }
    byGate.get(no)!.items.push({
      item_name: it.item_name,
      doc_type: it.doc_type || (mode === "SOFTWARE" ? "SRS_SPEC" : "DHF_DOC"),
      is_required: Boolean(it.is_required),
    });
  }
  const sorted = [...byGate.values()].sort((a, b) => a.gate_no - b.gate_no);
  if (sorted.length > 0) return sorted;
  if (mode === "SOFTWARE") {
    return [
      {
        gate_no: 0,
        gate_name: "Gate 0: Khởi tạo & Đặc tả Yêu cầu SRS",
        stage_after: "G1_ARCHITECTURE",
        items: [
          {
            item_name: "Tài liệu đặc tả yêu cầu phần mềm (SRS) & Phân cấp an toàn IEC 62304",
            doc_type: "SRS_SPEC",
            is_required: true,
          },
        ],
      },
    ];
  }
  return [
    {
      gate_no: 0,
      gate_name: "Gate 0: Khởi tạo & Định hướng",
      stage_after: "G1_FEASIBILITY",
      items: [{ item_name: "Hồ sơ yêu cầu & mục tiêu nghiên cứu", doc_type: "TPP", is_required: true }],
    },
  ];
}

function GateTemplateManagerModal({
  templates,
  mode = "RD",
  onSaved,
  onClose,
}: {
  templates: {
    id: string;
    code: string;
    name: string;
    domain: string;
    description?: string | null;
    project_count?: number;
    items: { id: string; gate_no: number; gate_name: string; stage_after: string; seq: number; item_name: string; doc_type: string; is_required: boolean }[];
  }[];
  mode?: "RD" | "SOFTWARE";
  onSaved: () => void;
  onClose: () => void;
}) {
  const isSw = mode === "SOFTWARE";
  const defaultDomain = isSw ? "SOFTWARE" : "KIT";
  const [selectedId, setSelectedId] = useState<string>(templates[0]?.id ?? "__NEW__");
  const [tplCode, setTplCode] = useState<string>(templates[0]?.code ?? "");
  const [tplName, setTplName] = useState<string>(
    templates[0]?.name ?? (isSw ? "Mẫu Cổng Phát triển Phần mềm Tùy chỉnh" : "Mẫu Stage-Gate R&D Tùy chỉnh")
  );
  const [tplDomain, setTplDomain] = useState<string>(templates[0]?.domain ?? defaultDomain);
  const [tplDesc, setTplDesc] = useState<string>(templates[0]?.description ?? "");
  const [gates, setGates] = useState<GateDraft[]>(() => groupTemplateToGates(templates[0], mode));
  const [notice, setNotice] = useState<string | null>(null);

  const loadIntoDraft = (idOrNew: string) => {
    setNotice(null);
    saveMut.reset();
    delMut.reset();
    setSelectedId(idOrNew);
    if (idOrNew === "__NEW__") {
      setTplCode("");
      setTplName(isSw ? "Mẫu Cổng Phần mềm Tùy chỉnh (IEC 62304)" : "Mẫu Stage-Gate R&D Tùy chỉnh");
      setTplDomain(defaultDomain);
      setTplDesc("");
      setGates(groupTemplateToGates(null, mode));
      return;
    }
    const found = templates.find((t) => t.id === idOrNew);
    if (found) {
      setTplCode(found.code || "");
      setTplName(found.name || "");
      setTplDomain(found.domain || defaultDomain);
      setTplDesc(found.description || "");
      setGates(groupTemplateToGates(found, mode));
    }
  };

  const handleCloneCurrent = () => {
    setNotice(null);
    saveMut.reset();
    delMut.reset();
    setSelectedId("__NEW__");
    setTplCode("");
    setTplName(`${tplName || "Mẫu Stage-Gate"} (Bản sao)`);
  };

  const saveMut = useMutation({
    mutationFn: () =>
      api<{ id: string; code: string; name: string }>("/api/factory/rd/units", {
        method: "POST",
        json: {
          kind: "gate_template",
          id: selectedId === "__NEW__" ? null : selectedId,
          code: tplCode.trim() || null,
          name: tplName,
          domain: tplDomain,
          description: tplDesc.trim() || null,
          gates,
        },
      }),
    onSuccess: (saved) => {
      setSelectedId(saved.id);
      setTplCode(saved.code);
      setNotice(`✅ Đã lưu bộ mẫu "${saved.name}" (${saved.code}).`);
      onSaved();
    },
  });

  const delMut = useMutation({
    mutationFn: (id: string) =>
      api("/api/factory/rd/units", {
        method: "POST",
        json: { kind: "delete_gate_template", id },
      }),
    onSuccess: () => {
      setNotice("✅ Đã xóa / ẩn bộ mẫu Stage-Gate.");
      setSelectedId("__NEW__");
      onSaved();
    },
  });

  const isBuiltinSelected = selectedId !== "__NEW__" && BUILTIN_TEMPLATE_CODES.has(tplCode);
  const currentTpl = templates.find((t) => t.id === selectedId);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <datalist id="rd-doc-type-datalist">
          {(isSw ? SW_DOC_TYPE_SUGGESTIONS : DOC_TYPE_SUGGESTIONS).map((dt) => (
            <option key={dt} value={dt} />
          ))}
        </datalist>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <div className="text-sm font-bold text-slate-900 dark:text-white">
              {isSw
                ? "⚙️ Cài đặt Bộ mẫu Cổng Phát triển Phần mềm (IEC 62304)"
                : "⚙️ Cài đặt Bộ mẫu Cổng Stage-Gate Nghiên cứu R&D (ISO 13485)"}
            </div>
            <div className="text-[11px] text-slate-500">
              {isSw
                ? "Quản lý các cổng kiểm soát vòng đời phần mềm độc lập hoàn toàn với Stage-Gate Nghiên cứu R&D."
                : "Quản lý các cổng kiểm soát đề tài R&D (Kit, Oligo, Thiết bị), tách biệt với Phát triển phần mềm."}
            </div>
          </div>
          <Button type="button" variant="ghost" onClick={onClose}>
            Đóng
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pb-2 border-b border-slate-100 dark:border-slate-800">
          {templates.map((t) => {
            const active = selectedId === t.id;
            const gCnt = new Set(t.items.map((x) => x.gate_no)).size;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => loadIntoDraft(t.id)}
                className={`px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer transition-all ${
                  active
                    ? "border-sky-600 bg-sky-600 text-white shadow-sm"
                    : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:border-sky-400"
                }`}
              >
                {BUILTIN_TEMPLATE_CODES.has(t.code) ? "🏛️ " : "🧩 "}
                {t.name} ({gCnt} cổng · {t.items.length} tiêu chí)
              </button>
            );
          })}
          <Button type="button" variant="ghost" className="!px-2.5 !py-1.5 !text-xs" onClick={() => loadIntoDraft("__NEW__")}>
            + Tạo Bộ Mẫu Mới
          </Button>
          {selectedId !== "__NEW__" && (
            <Button type="button" variant="ghost" className="!px-2.5 !py-1.5 !text-xs" onClick={handleCloneCurrent}>
              📋 Nhân bản mẫu này
            </Button>
          )}
        </div>

        {notice && (
          <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-semibold">
            {notice}
          </div>
        )}
        <ErrorNote error={saveMut.error ?? delMut.error} />

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveMut.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-4 text-xs">
            <div className="sm:col-span-2">
              <Field label="Tên bộ mẫu Stage-Gate *">
                <input
                  className={inputClass}
                  value={tplName}
                  onChange={(e) => setTplName(e.target.value)}
                  required
                  minLength={3}
                />
              </Field>
            </div>
            <Field label={isBuiltinSelected ? "Mã mẫu (Mặc định hệ thống)" : "Mã mẫu (Để trống = tự sinh)"}>
              <input
                className={`${inputClass} font-mono`}
                value={tplCode}
                disabled={isBuiltinSelected}
                onChange={(e) => setTplCode(e.target.value)}
                placeholder="VD: SG_KIT_FAST"
              />
            </Field>
            <Field label="Lĩnh vực mặc định *">
              <select
                className={inputClass}
                value={isSw ? "SOFTWARE" : tplDomain === "SOFTWARE" ? "KIT" : tplDomain}
                disabled={isSw}
                onChange={(e) => setTplDomain(e.target.value)}
              >
                {isSw ? (
                  <option value="SOFTWARE">Phần mềm &amp; Thuật toán (IEC 62304)</option>
                ) : (
                  RD_DOMAIN_ENTRIES.map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))
                )}
              </select>
            </Field>
            <div className="sm:col-span-4">
              <Field label="Mô tả bộ mẫu (Tùy chọn)">
                <input
                  className={inputClass}
                  value={tplDesc}
                  onChange={(e) => setTplDesc(e.target.value)}
                  placeholder="Áp dụng cho loại đề tài nào, lưu ý hồ sơ bắt buộc..."
                />
              </Field>
            </div>
          </div>

          <div className="space-y-3">
            {gates.map((g, gIdx) => (
              <div
                key={`${gIdx}-${g.gate_no}`}
                className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 space-y-2.5"
              >
                <div className="grid gap-2 sm:grid-cols-6 items-end text-xs">
                  <Field label="Số Gate (0–10) *">
                    <input
                      type="number"
                      min={0}
                      max={10}
                      className={inputClass}
                      value={g.gate_no}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setGates((prev) => prev.map((x, i) => (i === gIdx ? { ...x, gate_no: v } : x)));
                      }}
                      required
                    />
                  </Field>
                  <div className="sm:col-span-3">
                    <Field label="Tên Cổng Stage-Gate *">
                      <input
                        className={inputClass}
                        value={g.gate_name}
                        onChange={(e) =>
                          setGates((prev) => prev.map((x, i) => (i === gIdx ? { ...x, gate_name: e.target.value } : x)))
                        }
                        required
                      />
                    </Field>
                  </div>
                  <Field label="Giai đoạn tiếp theo *">
                    <input
                      className={`${inputClass} font-mono`}
                      value={g.stage_after}
                      onChange={(e) =>
                        setGates((prev) => prev.map((x, i) => (i === gIdx ? { ...x, stage_after: e.target.value } : x)))
                      }
                      required
                    />
                  </Field>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      className="!px-2 !py-1 !text-[11px]"
                      onClick={() =>
                        setGates((prev) =>
                          prev.map((x, i) =>
                            i === gIdx
                              ? {
                                  ...x,
                                  items: [
                                    ...x.items,
                                    { item_name: "", doc_type: isSw ? "SRS_SPEC" : "DHF_DOC", is_required: true },
                                  ],
                                }
                              : x
                          )
                        )
                      }
                    >
                      + Tiêu chí
                    </Button>
                    {gates.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        className="!px-2 !py-1 !text-[11px] text-rose-600 dark:text-rose-400"
                        onClick={() => setGates((prev) => prev.filter((_, i) => i !== gIdx))}
                      >
                        🗑️ Xóa cổng
                      </Button>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5 pl-2 border-l-2 border-sky-300 dark:border-sky-800">
                  {g.items.map((it, itIdx) => (
                    <div key={itIdx} className="grid gap-2 sm:grid-cols-12 items-center text-xs">
                      <div className="sm:col-span-1 font-mono text-slate-500">#{itIdx + 1}</div>
                      <div className="sm:col-span-6">
                        <input
                          className={inputClass}
                          value={it.item_name}
                          placeholder="Tên tiêu chí / Hạng mục hồ sơ *"
                          onChange={(e) =>
                            setGates((prev) =>
                              prev.map((xg, i) =>
                                i === gIdx
                                  ? {
                                      ...xg,
                                      items: xg.items.map((xi, j) =>
                                        j === itIdx ? { ...xi, item_name: e.target.value } : xi
                                      ),
                                    }
                                  : xg
                              )
                            )
                          }
                          required
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <input
                          list="rd-doc-type-datalist"
                          className={`${inputClass} font-mono`}
                          value={it.doc_type}
                          placeholder="Mã hồ sơ"
                          onChange={(e) =>
                            setGates((prev) =>
                              prev.map((xg, i) =>
                                i === gIdx
                                  ? {
                                      ...xg,
                                      items: xg.items.map((xi, j) =>
                                        j === itIdx ? { ...xi, doc_type: e.target.value } : xi
                                      ),
                                    }
                                  : xg
                              )
                            )
                          }
                        />
                      </div>
                      <div className="sm:col-span-2 flex items-center justify-between gap-2">
                        <label className="inline-flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={it.is_required}
                            onChange={(e) =>
                              setGates((prev) =>
                                prev.map((xg, i) =>
                                  i === gIdx
                                    ? {
                                        ...xg,
                                        items: xg.items.map((xi, j) =>
                                          j === itIdx ? { ...xi, is_required: e.target.checked } : xi
                                        ),
                                      }
                                    : xg
                                )
                              )
                            }
                          />
                          <span>Bắt buộc</span>
                        </label>
                        {g.items.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setGates((prev) =>
                                prev.map((xg, i) =>
                                  i === gIdx ? { ...xg, items: xg.items.filter((_, j) => j !== itIdx) } : xg
                                )
                              )
                            }
                            className="text-rose-600 dark:text-rose-400 font-semibold cursor-pointer"
                            title="Xóa tiêu chí này"
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                const nextNo = gates.length ? Math.min(10, Math.max(...gates.map((x) => Number(x.gate_no))) + 1) : 0;
                setGates((prev) => [
                  ...prev,
                  {
                    gate_no: nextNo,
                    gate_name: `Gate ${nextNo}: Cổng mới`,
                    stage_after: nextNo >= 4 ? (isSw ? "G4_RELEASED" : "TRANSFERRED") : `G${Math.min(10, nextNo + 1)}_STAGE`,
                    items: [
                      {
                        item_name: isSw ? "Hồ sơ đánh giá cổng phần mềm" : "Hồ sơ đánh giá cổng",
                        doc_type: isSw ? "SRS_SPEC" : "DHF_DOC",
                        is_required: true,
                      },
                    ],
                  },
                ]);
              }}
            >
              ➕ Thêm Cổng Gate mới
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <div>
              {selectedId !== "__NEW__" && !isBuiltinSelected && (
                <Button
                  type="button"
                  variant="danger"
                  disabled={delMut.isPending}
                  onClick={() => {
                    const msg =
                      (currentTpl?.project_count ?? 0) > 0
                        ? `Mẫu "${tplName}" đang gắn với ${currentTpl?.project_count} dự án nên sẽ được ẩn khỏi danh sách chọn mẫu mới (dự án cũ không bị ảnh hưởng). Tiếp tục?`
                        : `Xóa vĩnh viễn bộ mẫu tùy chỉnh "${tplName}"?`;
                    if (!window.confirm(msg)) return;
                    delMut.mutate(selectedId);
                  }}
                >
                  {delMut.isPending ? "Đang xóa..." : "🗑️ Xóa / Ẩn mẫu tùy chỉnh"}
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Đóng
              </Button>
              <Button type="submit" disabled={saveMut.isPending}>
                {saveMut.isPending ? "Đang lưu..." : "💾 Lưu Bộ Mẫu Stage-Gate"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

const PIPELINE_STAGES = [
  { key: "G0", label: "1. Khảo sát & TPP (G0)", sub: "Xác lập yêu cầu thiết kế" },
  { key: "G1", label: "2. Khả thi / Feasibility (G1)", sub: "Thử nghiệm công thức sơ bộ" },
  { key: "G2", label: "3. Tối ưu hóa / Optimization (G2)", sub: "Chốt định mức Prototype BOM" },
  { key: "G3", label: "4. Thẩm định / Validation (G3)", sub: "LoD, Độ nhạy & Độ ổn định" },
  { key: "G4", label: "5. Chuyển giao SX (G4 / Transferred)", sub: "Bàn giao BOM & QC Spec" },
];

const SOFTWARE_PIPELINE_STAGES = [
  { key: "G0", label: "1. Yêu cầu & Phân loại (G0)", sub: "Đặc tả SRS & Phân cấp an toàn IEC 62304" },
  { key: "G1", label: "2. Kiến trúc & Thiết kế (G1)", sub: "Thiết kế kiến trúc, CSDL & Giao diện" },
  { key: "G2", label: "3. Hiện thực & Unit Test (G2)", sub: "Lập trình, Code Review & Kiểm thử đơn vị" },
  { key: "G3", label: "4. Kiểm thử hệ thống & V&V (G3)", sub: "System Test, Bảo mật & Ma trận truy vết" },
  { key: "G4", label: "5. Phát hành Release (G4)", sub: "Đóng gói bản dựng, Checksum & Triển khai" },
];

function matchStageKey(stage: string, status: string, passedGates: number): string {
  const s = (stage || "").toUpperCase();
  if (status === "TRANSFERRED" || s.includes("TRANSFER") || s.includes("REL") || passedGates >= 4) return "G4";
  if (s.includes("G3") || s.includes("VALID") || s.includes("VERIF") || s.includes("VV") || s.includes("SYS_TEST") || passedGates === 3) return "G3";
  if (s.includes("G2") || s.includes("OPTIM") || s.includes("IMPL") || s.includes("CODE") || s.includes("UNIT") || passedGates === 2) return "G2";
  if (s.includes("G1") || s.includes("FEAS") || s.includes("ARCH") || s.includes("DESIGN") || passedGates === 1) return "G1";
  return "G0";
}

/**
 * `domainLock` shows and creates projects of one domain only (KTCN software tab: SOFTWARE); `ownerModule` is the
 * department that runs new projects (R&D by default, DEVICE = KTCN).
 */
export function ProjectsView({
  canManage,
  canReviewGate,
  canEdit = false,
  canDelete = false,
  domainLock,
  ownerModule = "RD",
}: {
  canManage: boolean;
  canReviewGate: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  domainLock?: string;
  ownerModule?: "RD" | "DEVICE" | "IT";
}) {
  const qc = useQueryClient();
  const ctx = useRdContext("rd.view");
  const isSoftwareMode = domainLock === "SOFTWARE";
  const [domain, setDomain] = useState(domainLock ?? "");
  const [stageFilter, setStageFilter] = useState("");
  const [staffFilter, setStaffFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [addingMode, setAddingMode] = useState<"NEW_PRODUCT" | "IMPROVEMENT" | null>(null);
  const [showGateTemplateManager, setShowGateTemplateManager] = useState(false);

  // Master WBS View & Inline WBS Expansion across projects without opening individual project detail
  const [viewMode, setViewMode] = useState<"PROJECTS" | "WBS_BY_PROJECT">("PROJECTS");
  const [expandedWbsProjects, setExpandedWbsProjects] = useState<Record<string, boolean>>({});
  const [wbsProjectFilter, setWbsProjectFilter] = useState<string>("WITH_WBS");
  const [wbsGateFilterMaster, setWbsGateFilterMaster] = useState<string>("");
  const [wbsStatusFilterMaster, setWbsStatusFilterMaster] = useState<string>("");
  const [wbsGroupByProject, setWbsGroupByProject] = useState<boolean>(true);
  const [quickWbsProjectId, setQuickWbsProjectId] = useState<string>("");
  const [quickWbsGate, setQuickWbsGate] = useState<string>("1");
  const [quickWbsTitle, setQuickWbsTitle] = useState<string>("");
  const [quickWbsAssignee, setQuickWbsAssignee] = useState<string>("");
  const [quickWbsDue, setQuickWbsDue] = useState<string>("");
  const [quickWbsNotice, setQuickWbsNotice] = useState<string | null>(null);
  const [editingMasterTask, setEditingMasterTask] = useState<any | null>(null);
  const [mResStatus, setMResStatus] = useState<"TODO" | "IN_PROGRESS" | "DONE" | "BLOCKED">("DONE");
  const [mResProgress, setMResProgress] = useState("100");
  const [mResVerdict, setMResVerdict] = useState<"PENDING" | "PASS" | "OPTIMIZE" | "FAIL">("PASS");
  const [mResProtocol, setMResProtocol] = useState("");
  const [mResSummary, setMResSummary] = useState("");
  const [mResNextSteps, setMResNextSteps] = useState("");
  const [mResAssignee, setMResAssignee] = useState("");
  const [mResMetrics, setMResMetrics] = useState<{ label: string; value: string; unit?: string | null; target?: string | null }[]>([
    { label: "Giới hạn phát hiện (LoD95)", value: "", unit: "copies/rxn", target: "≤ 10 copies/rxn" },
    { label: "Giá trị Ct trung bình", value: "", unit: "Ct", target: "≤ 32.0" },
  ]);

  const [name, setName] = useState("");
  const [targetDomain, setTargetDomain] = useState(isSoftwareMode ? "SOFTWARE" : "KIT");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [ivdClass, setIvdClass] = useState(isSoftwareMode ? "NA" : "CLASS_B");
  const [leaderName, setLeaderName] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("60000000");
  const [plannedEnd, setPlannedEnd] = useState("");
  const [description, setDescription] = useState("");

  // Edit & Delete project modal state
  const [editingProj, setEditingProj] = useState<any | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState("NEW_PRODUCT");
  const [editDomain, setEditDomain] = useState("KIT");
  const [editIvd, setEditIvd] = useState("CLASS_B");
  const [editLeader, setEditLeader] = useState("");
  const [editBudget, setEditBudget] = useState("50000000");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editStatus, setEditStatus] = useState("ACTIVE");
  const [editDesc, setEditDesc] = useState("");
  const [editReason, setEditReason] = useState("");

  const [deletingProj, setDeletingProj] = useState<any | null>(null);
  const [deleteReason, setDeleteReason] = useState("");

  const openEditProj = (proj: any) => {
    editMut.reset();
    setEditingProj(proj);
    setEditName(proj.name || "");
    setEditType(proj.project_type || "NEW_PRODUCT");
    setEditDomain(proj.target_domain || "KIT");
    setEditIvd(proj.ivd_class || "NA");
    setEditLeader(proj.leader_name_override || proj.leader_name || "");
    setEditBudget(String(Math.round(Number(proj.budget_amount ?? 50000000))));
    setEditStart(proj.planned_start ? String(proj.planned_start).slice(0, 10) : "");
    setEditEnd(proj.planned_end ? String(proj.planned_end).slice(0, 10) : "");
    setEditStatus(proj.status || "ACTIVE");
    setEditDesc(proj.description || "");
    setEditReason("");
  };

  const openDeleteProj = (proj: any) => {
    deleteMut.reset();
    setDeletingProj(proj);
    setDeleteReason("");
  };

  const list = useQuery({
    queryKey: ["factory", "rd", "projects", domain, isSoftwareMode ? "SW" : "RD"],
    queryFn: () => {
      const params = new URLSearchParams();
      if (isSoftwareMode) {
        params.set("domain", "SOFTWARE");
      } else if (domain) {
        params.set("domain", domain);
      } else {
        params.set("exclude_domain", "SOFTWARE");
      }
      return api<any[]>(`/api/factory/rd/projects?${params.toString()}`);
    },
  });

  const allWbsQuery = useQuery({
    queryKey: ["factory", "rd", "all-wbs-tasks", domain, isSoftwareMode ? "SW" : "RD"],
    queryFn: () => {
      const params = new URLSearchParams({ op: "all_wbs_tasks" });
      if (isSoftwareMode) {
        params.set("domain", "SOFTWARE");
      } else if (domain) {
        params.set("domain", domain);
      } else {
        params.set("exclude_domain", "SOFTWARE");
      }
      return api<{ tasks: any[] }>(`/api/factory/rd/project-ops?${params.toString()}`);
    },
  });

  const openMasterResultDrawer = (task: any) => {
    setEditingMasterTask(task);
    setMResStatus(task.status === "TODO" ? "DONE" : task.status);
    setMResProgress(String(task.status === "TODO" ? 100 : task.progress_pct || 100));
    setMResVerdict(task.outcome_verdict && task.outcome_verdict !== "PENDING" ? task.outcome_verdict : "PASS");
    setMResProtocol(task.protocol_summary || "");
    setMResSummary(task.result_summary || "");
    setMResNextSteps(task.next_steps || "");
    setMResAssignee(task.assignee_name || task.project_leader_name || "");
    setMResMetrics(
      Array.isArray(task.key_metrics_json) && task.key_metrics_json.length > 0
        ? task.key_metrics_json.map((m: any) => ({
            label: m.label || "",
            value: m.value || "",
            unit: m.unit || "",
            target: m.target || "",
          }))
        : [
            { label: "Giới hạn phát hiện (LoD95)", value: "", unit: "copies/rxn", target: "≤ 10 copies/rxn" },
            { label: "Giá trị Ct trung bình", value: "", unit: "Ct", target: "≤ 32.0" },
          ]
    );
  };

  const masterSaveTaskMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api("/api/factory/rd/project-ops", {
        method: "POST",
        json: { op: "save_task", ...payload },
      }),
    onSuccess: (_res, vars) => {
      if (!vars.task_id) {
        setQuickWbsTitle("");
        setQuickWbsDue("");
        setQuickWbsNotice("✅ Đã giao công việc WBS mới vào dự án!");
      } else {
        setEditingMasterTask(null);
        setQuickWbsNotice("✅ Đã cập nhật tiến độ & kết quả thực nghiệm công việc WBS!");
      }
      qc.invalidateQueries({ queryKey: ["factory", "rd", "all-wbs-tasks"] });
      qc.invalidateQueries({ queryKey: ["factory", "rd", "projects"] });
      if (vars.project_id) {
        qc.invalidateQueries({ queryKey: ["factory", "rd", "project-ops", String(vars.project_id)] });
      }
    },
  });

  const masterCreateExpMut = useMutation({
    mutationFn: (payload: { project_id: string; task_id: string }) =>
      api<{ experiment_code: string; task_code: string }>("/api/factory/rd/project-ops", {
        method: "POST",
        json: { op: "create_task_experiment", ...payload },
      }),
    onSuccess: (res, vars) => {
      setQuickWbsNotice(`🧪 Đã khởi tạo & liên kết bài Sổ thí nghiệm ${res.experiment_code} cho công việc ${res.task_code}`);
      qc.invalidateQueries({ queryKey: ["factory", "rd", "all-wbs-tasks"] });
      qc.invalidateQueries({ queryKey: ["factory", "rd", "projects"] });
      qc.invalidateQueries({ queryKey: ["factory", "rd", "experiments"] });
      qc.invalidateQueries({ queryKey: ["factory", "rd", "project-ops", vars.project_id] });
    },
  });

  const scopedTemplates = (ctx.data?.templates ?? []).filter((t) =>
    isSoftwareMode ? t.domain === "SOFTWARE" : t.domain !== "SOFTWARE"
  );

  const createMut = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/api/factory/rd/project-ops", {
        method: "POST",
        json: {
          op: "create_project",
          owner_module: ownerModule,
          project_type: addingMode ?? "NEW_PRODUCT",
          target_domain: domainLock ?? targetDomain,
          ivd_class: ivdClass,
          gate_template_id: selectedTemplateId || null,
          name,
          leader_name: leaderName || null,
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

  const editMut = useMutation({
    mutationFn: () => {
      const p = editingProj!;
      const origLeader = p.leader_name_override ?? p.leader_name ?? "";
      const leaderPatch =
        editLeader !== origLeader ? (editLeader.trim() || null) : undefined;
      return api(`/api/factory/rd/projects/${p.id}`, {
        method: "PUT",
        json: {
          version: p.version,
          name: editName,
          project_type: editType,
          target_domain: domainLock ?? editDomain,
          ivd_class: editIvd || null,
          ...(leaderPatch !== undefined ? { leader_name_override: leaderPatch } : {}),
          budget_amount: editBudget !== "" ? Number(editBudget) : null,
          planned_start: editStart || null,
          planned_end: editEnd || null,
          description: editDesc || null,
          ...(!p.has_immutable_handoff ? { status: editStatus } : {}),
          reason: editReason.trim() || null,
        },
      });
    },
    onSuccess: () => {
      const projId = editingProj?.id;
      setEditingProj(null);
      qc.invalidateQueries({ queryKey: ["factory", "rd", "projects"] });
      if (projId) {
        qc.invalidateQueries({ queryKey: ["factory", "rd", "project", projId] });
        qc.invalidateQueries({ queryKey: ["factory", "rd", "project-ops", projId] });
      }
    },
  });

  const deleteMut = useMutation({
    mutationFn: () =>
      api(`/api/factory/rd/projects/${deletingProj!.id}`, {
        method: "DELETE",
        json: { reason: deleteReason },
      }),
    onSuccess: () => {
      const deletedId = deletingProj?.id;
      setDeletingProj(null);
      setDeleteReason("");
      if (selected === deletedId) setSelected(null);
      qc.invalidateQueries({ queryKey: ["factory", "rd", "projects"] });
      qc.invalidateQueries({ queryKey: ["factory", "rd", "experiments"] });
      qc.invalidateQueries({ queryKey: ["factory", "rd", "ideas"] });
    },
  });

  const allProjects = list.data ?? [];

  // Build unique R&D staff list from roster + project leaders + WBS assignees
  const staffOptions = Array.from(
    new Set([
      ...((ownerModule === "IT" ? ctx.data?.it_staff : ownerModule === "DEVICE" ? ctx.data?.device_staff : ctx.data?.rd_staff)?.map((s) => s.name) ?? []),
      ...allProjects.map((r) => r.leader_name).filter(Boolean),
      ...allProjects.flatMap((r) => (Array.isArray(r.assignees) ? r.assignees : [])).filter(Boolean),
    ])
  );

  const matchesProjectStaff = (r: any, staff: string) => isProjectForPerson(r, staff);

  const filteredProjects = allProjects.filter((r) => {
    if (stageFilter && matchStageKey(r.current_stage || "", r.status || "", Number(r.passed_gates || 0)) !== stageFilter) {
      return false;
    }
    if (staffFilter && !matchesProjectStaff(r, staffFilter)) {
      return false;
    }
    if (searchQuery.trim() !== "") {
      const q = searchQuery.toLowerCase();
      const assigneesStr = Array.isArray(r.assignees) ? r.assignees.join(" ") : "";
      const hay = `${r.code || ""} ${r.name || ""} ${r.leader_name || ""} ${assigneesStr}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="flex flex-col gap-3">
      {/* 5-Stage Visual Pipeline Bar (Independent Software vs R&D) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {(isSoftwareMode ? SOFTWARE_PIPELINE_STAGES : PIPELINE_STAGES).map((st) => {
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

      {showGateTemplateManager && (
        <GateTemplateManagerModal
          templates={scopedTemplates}
          mode={isSoftwareMode ? "SOFTWARE" : "RD"}
          onSaved={() => qc.invalidateQueries({ queryKey: ["factory", "rd", "context"] })}
          onClose={() => setShowGateTemplateManager(false)}
        />
      )}

      {selected && (
        <ProjectPanel
          key={selected}
          id={selected}
          canManage={canManage}
          canReviewGate={canReviewGate}
          canEdit={canEdit}
          canDelete={canDelete}
          onRequestEdit={openEditProj}
          onRequestDelete={openDeleteProj}
          onClose={() => setSelected(null)}
        />
      )}

      <Card
        title={
          isSoftwareMode
            ? "Trung tâm Quản lý Dự án Phát triển Phần mềm & Cổng Kiểm soát IEC 62304"
            : "Trung tâm Điều hành Dự án R&D theo Stage-Gate & Quản lý Vật tư Dự án (ISO 13485)"
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${inputClass} w-48`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isSoftwareMode ? "🔍 Tìm mã, tên dự án PM, kỹ sư..." : "🔍 Tìm mã, tên dự án, NCV..."}
            />
            <select className={`${inputClass} w-60`} value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)}>
              <option value="">
                {isSoftwareMode ? "👤 Mọi kỹ sư phụ trách Phát triển phần mềm" : "👤 Mọi nhân sự phụ trách Phòng R&D"}
              </option>
              {staffOptions.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
            {!domainLock && (
              <select className={`${inputClass} w-40`} value={domain} onChange={(e) => setDomain(e.target.value)}>
                <option value="">Mọi lĩnh vực R&amp;D</option>
                {RD_DOMAIN_ENTRIES.map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            )}
            <a href="/api/factory/rd/roadmap/ics" className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold">
              Xuất lịch Roadmap (.ics)
            </a>
            {(canManage || canEdit || canReviewGate) && (
              <Button variant="ghost" onClick={() => setShowGateTemplateManager(true)}>
                {isSoftwareMode ? "⚙️ Cài đặt Mẫu Gate Phần mềm" : "⚙️ Cài đặt Mẫu Gate R&D"}
              </Button>
            )}
            {canManage && (
              <>
                <Button
                  variant="ghost"
                  onClick={() => setAddingMode(addingMode === "IMPROVEMENT" ? null : "IMPROVEMENT")}
                >
                  {isSoftwareMode ? "✨ + Dự án Nâng cấp / Bảo trì PM" : "✨ + Dự án Cải tiến SP Cũ"}
                </Button>
                <Button
                  onClick={() => setAddingMode(addingMode === "NEW_PRODUCT" ? null : "NEW_PRODUCT")}
                >
                  {isSoftwareMode ? "🚀 + Dự án Phần mềm Mới" : "🚀 + Dự án Nghiên cứu SP Mới"}
                </Button>
              </>
            )}
          </div>
        }
      >
        <ErrorNote error={list.error ?? createMut.error ?? allWbsQuery.error ?? masterSaveTaskMut.error ?? masterCreateExpMut.error} />

        {/* View Mode Switcher: Danh sách Dự án vs. Danh sách Công việc WBS theo Dự án */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 p-2 rounded-xl border border-indigo-200/80 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/20">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setViewMode("PROJECTS")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all flex items-center gap-1.5 ${
                viewMode === "PROJECTS"
                  ? "bg-sky-600 text-white shadow-sm"
                  : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:border-sky-400"
              }`}
            >
              <span>📁 1. Danh sách Dự án Stage-Gate</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[11px] ${viewMode === "PROJECTS" ? "bg-sky-700 text-white" : "bg-slate-100 dark:bg-slate-800 text-sky-700 dark:text-sky-300"}`}>
                {filteredProjects.length} dự án
              </span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("WBS_BY_PROJECT")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all flex items-center gap-1.5 ${
                viewMode === "WBS_BY_PROJECT"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:border-indigo-400"
              }`}
            >
              <span>📋 2. Xem &amp; Giao Công việc WBS theo Dự án</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[11px] ${viewMode === "WBS_BY_PROJECT" ? "bg-indigo-700 text-white" : "bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300"}`}>
                {(allWbsQuery.data?.tasks ?? []).length} việc WBS
              </span>
            </button>
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-400">
            {viewMode === "PROJECTS" ? (
              <span>💡 Bấm nút <b>&ldquo;📋 Xem WBS ▼&rdquo;</b> trên từng dòng dự án để xổ xem ngay danh sách việc WBS hoặc chuyển sang tab <b>2. Xem &amp; Giao Công việc WBS theo Dự án</b>.</span>
            ) : (
              <span>💡 Xem, lọc, giao việc mới và ghi nhận kết quả thực nghiệm 4 lớp trực tiếp trên tất cả dự án cùng lúc.</span>
            )}
          </div>
        </div>

        {quickWbsNotice && (
          <div className="mb-3 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-semibold flex items-center justify-between">
            <span>{quickWbsNotice}</span>
            <button type="button" className="text-xs underline ml-2 cursor-pointer" onClick={() => setQuickWbsNotice(null)}>
              Đóng
            </button>
          </div>
        )}

        {/* Quick R&D Researcher Workload Filter Bar */}
        {staffOptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-3 pb-2.5 border-b border-slate-100 dark:border-slate-800 text-xs">
            <span className="font-semibold text-slate-500 mr-1">👥 Lọc nhanh theo Nhân sự {ownerModule === "IT" ? "Phòng IT" : ownerModule === "DEVICE" ? "Phòng KTCN" : "Phòng R&D"}:</span>
            <button
              type="button"
              onClick={() => setStaffFilter("")}
              className={`px-2.5 py-1 rounded-full font-semibold cursor-pointer transition-all ${
                staffFilter === ""
                  ? "bg-sky-600 text-white"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
              }`}
            >
              Tất cả ({allProjects.length})
            </button>
            {staffOptions.map((st) => {
              const cnt = allProjects.filter((r) => matchesProjectStaff(r, st)).length;
              const active = staffFilter === st;
              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStaffFilter(active ? "" : st)}
                  className={`px-2.5 py-1 rounded-full font-semibold cursor-pointer transition-all ${
                    active
                      ? "bg-sky-600 text-white shadow-sm"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
                  }`}
                >
                  👤 {st} ({cnt})
                </button>
              );
            })}
          </div>
        )}

        {addingMode && (
          <form
            className="grid gap-3 sm:grid-cols-3 p-3 mb-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/40 dark:bg-sky-950/20"
            onSubmit={(e) => {
              e.preventDefault();
              createMut.mutate();
            }}
          >
            <div className="sm:col-span-3 font-bold text-sky-800 dark:text-sky-300 text-xs">
              {isSoftwareMode
                ? addingMode === "NEW_PRODUCT"
                  ? "🚀 Khởi tạo Dự án Phần mềm Y sinh Mới (Vòng đời Cổng Kiểm soát IEC 62304 & Bảng việc WBS)"
                  : "✨ Khởi tạo Dự án Nâng cấp / Bảo trì Phần mềm (IEC 62304 Design Change)"
                : addingMode === "NEW_PRODUCT"
                  ? "🚀 Khởi tạo Dự án Nghiên cứu & Phát triển Sản phẩm Mới (5 Cổng Stage-Gate G0 -> G4 + Sổ cái Vật tư)"
                  : "✨ Khởi tạo Dự án Cải tiến / Tối ưu hóa Sản phẩm Hiện hữu (Design Change / Bridging Study)"}
            </div>
            {!domainLock && (
              <Field label="Lĩnh vực sản phẩm đích *">
                <select
                  className={inputClass}
                  value={targetDomain}
                  onChange={(e) => {
                    setTargetDomain(e.target.value);
                    setSelectedTemplateId("");
                  }}
                >
                  {RD_DOMAIN_ENTRIES.map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label={isSoftwareMode ? "Bộ mẫu cổng kiểm soát IEC 62304" : "Bộ mẫu cổng Stage-Gate & Checklist DHF"}>
              <select className={inputClass} value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
                <option value="">{isSoftwareMode ? "-- Mặc định IEC 62304 (Khuyến nghị) --" : "-- Tự động theo lĩnh vực (Khuyến nghị) --"}</option>
                {scopedTemplates.map((t) => {
                  const gateCount = new Set(t.items.map((x) => x.gate_no)).size;
                  return (
                    <option key={t.id} value={t.id}>
                      {t.name} ({gateCount} cổng · {t.items.length} tiêu chí)
                    </option>
                  );
                })}
              </select>
            </Field>
            <Field label="Phân loại IVD / RUO">
              <select className={inputClass} value={ivdClass} onChange={(e) => setIvdClass(e.target.value)}>
                {Object.entries(IVD_CLASS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label={`Chủ nhiệm đề tài / Phụ trách chính (${ownerModule === "IT" ? "Phòng IT" : ownerModule === "DEVICE" ? "Phòng KTCN" : "Phòng R&D"})`}>
              <select className={inputClass} value={leaderName} onChange={(e) => setLeaderName(e.target.value)}>
                <option value="">-- Mặc định theo tài khoản hoặc chọn nhân sự --</option>
                {staffOptions.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label={isSoftwareMode ? "Tên dự án Phần mềm *" : "Tên dự án R&D *"}>
                <input
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    isSoftwareMode
                      ? "VD: Phát triển Phần mềm Phân tích Tín hiệu Quang học Đa kênh v2.0"
                      : addingMode === "NEW_PRODUCT"
                        ? "VD: Nghiên cứu Bộ Kit Real-time PCR Đa kênh Chuẩn CE-IVD"
                        : "VD: Cải tiến đệm MasterMix đông khô tăng độ ổn định nhiệt ở 2-8°C"
                  }
                  required
                />
              </Field>
            </div>
            <Field label={isSoftwareMode ? "Ngân sách phát triển dự kiến (VNĐ)" : "Ngân sách Vật tư R&D dự kiến (VNĐ)"}>
              <input type="number" step="1000000" className={inputClass} value={budgetAmount} onChange={(e) => setBudgetAmount(e.target.value)} />
            </Field>
            <Field label="Dự kiến hoàn tất chuyển giao">
              <input type="date" className={inputClass} value={plannedEnd} onChange={(e) => setPlannedEnd(e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
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

        {/* Structured Result Drawer for Master / Inline WBS Task */}
        {editingMasterTask && (
          <form
            className="mb-3 p-4 rounded-2xl border-2 border-indigo-500/80 dark:border-indigo-500/70 bg-indigo-50/30 dark:bg-slate-900 shadow-lg flex flex-col gap-3 text-xs"
            onSubmit={(e) => {
              e.preventDefault();
              masterSaveTaskMut.mutate({
                project_id: editingMasterTask.project_id,
                task_id: editingMasterTask.id,
                gate_no: editingMasterTask.gate_no,
                title: editingMasterTask.title,
                assignee_name: mResAssignee || editingMasterTask.assignee_name || editingMasterTask.project_leader_name,
                due_date: editingMasterTask.due_date ? String(editingMasterTask.due_date).slice(0, 10) : null,
                status: mResStatus,
                progress_pct: Number(mResProgress || 100),
                protocol_summary: mResProtocol || null,
                result_summary: mResSummary || null,
                key_metrics_json: mResMetrics.filter((m) => m.label.trim() !== "" || m.value.trim() !== ""),
                outcome_verdict: mResVerdict,
                next_steps: mResNextSteps || null,
                sync_to_eln: true,
              });
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-200 dark:border-slate-800 pb-2.5">
              <div>
                <div className="text-sm font-bold text-indigo-900 dark:text-indigo-300">
                  📝 Ghi Nhận Kết Quả &amp; Tiến Độ Công Việc WBS:{" "}
                  <span className="font-mono">{editingMasterTask.code}</span> (Cổng G{editingMasterTask.gate_no}) · Dự án{" "}
                  <span className="font-mono text-sky-700 dark:text-sky-400">{editingMasterTask.project_code}</span> — {editingMasterTask.project_name}
                </div>
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 mt-0.5">{editingMasterTask.title}</div>
              </div>
              <Button type="button" variant="ghost" onClick={() => setEditingMasterTask(null)}>
                Đóng phiếu
              </Button>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-4">
              <Field label="Nghiên cứu viên thực hiện *">
                <input
                  list="master-rd-staff-datalist"
                  className={inputClass}
                  value={mResAssignee}
                  onChange={(e) => setMResAssignee(e.target.value)}
                  required
                />
              </Field>
              <Field label="Trạng thái công việc">
                <select className={inputClass} value={mResStatus} onChange={(e) => setMResStatus(e.target.value as any)}>
                  <option value="IN_PROGRESS">Đang thực hiện</option>
                  <option value="DONE">Hoàn thành (100%)</option>
                  <option value="BLOCKED">Vướng mắc kỹ thuật</option>
                  <option value="TODO">Chưa làm</option>
                </select>
              </Field>
              <Field label="Tiến độ (%)">
                <input
                  type="number"
                  min="0"
                  max="100"
                  className={inputClass}
                  value={mResProgress}
                  onChange={(e) => setMResProgress(e.target.value)}
                />
              </Field>
              <Field label="Đánh giá kết luận (Verdict) *">
                <select className={inputClass} value={mResVerdict} onChange={(e) => setMResVerdict(e.target.value as any)}>
                  <option value="PASS">✅ ĐẠT MỤC TIÊU (PASS)</option>
                  <option value="OPTIMIZE">🔧 CẦN TỐI ƯU THÊM (OPTIMIZE)</option>
                  <option value="FAIL">❌ KHÔNG ĐẠT (FAIL)</option>
                  <option value="PENDING">⏳ ĐANG ĐÁNH GIÁ</option>
                </select>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="1. Phương pháp, Quy trình & Điều kiện thực nghiệm (Protocol & Conditions)">
                <textarea
                  rows={2}
                  className={inputClass}
                  value={mResProtocol}
                  onChange={(e) => setMResProtocol(e.target.value)}
                  placeholder="Mô tả công thức phối trộn, điều kiện chạy mẫu, thiết bị, cỡ mẫu..."
                />
              </Field>
              <Field label="2. Tóm tắt Kết quả chính & Nhận xét chuyên môn *">
                <textarea
                  rows={2}
                  className={inputClass}
                  value={mResSummary}
                  onChange={(e) => setMResSummary(e.target.value)}
                  placeholder="VD: Đạt tín hiệu tốt, đường chuẩn R² = 0.998, đạt chỉ tiêu đề ra..."
                  required
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 items-end">
              <Field label="3. Đề xuất bước tiếp theo / Khuyến nghị kỹ thuật">
                <input
                  className={inputClass}
                  value={mResNextSteps}
                  onChange={(e) => setMResNextSteps(e.target.value)}
                  placeholder="VD: Chốt thông số chuyển sang bước thẩm định tiếp theo..."
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setEditingMasterTask(null)}>
                  Hủy
                </Button>
                <Button type="submit" disabled={masterSaveTaskMut.isPending}>
                  💾 Lưu Kết Quả &amp; Cập Nhật WBS
                </Button>
              </div>
            </div>
          </form>
        )}

        <datalist id="master-rd-staff-datalist">
          {staffOptions.map((st) => (
            <option key={st} value={st} />
          ))}
        </datalist>

        {viewMode === "WBS_BY_PROJECT" && (() => {
          const allTasks = allWbsQuery.data?.tasks ?? [];
          const tasksByProjectId = new Map<string, any[]>();
          for (const t of allTasks) {
            const listForProj = tasksByProjectId.get(t.project_id) ?? [];
            listForProj.push(t);
            tasksByProjectId.set(t.project_id, listForProj);
          }

          const filteredWbsTasks = allTasks.filter((t) => {
            if (wbsProjectFilter && wbsProjectFilter !== "ALL" && wbsProjectFilter !== "WITH_WBS" && t.project_id !== wbsProjectFilter) {
              return false;
            }
            if (stageFilter) {
              const proj = allProjects.find((p) => p.id === t.project_id);
              const pStage = matchStageKey(t.project_stage || proj?.current_stage || "", t.project_status || proj?.status || "", Number(proj?.passed_gates || 0));
              if (pStage !== stageFilter) return false;
            }
            if (staffFilter) {
              const nStaff = staffFilter.trim().replace(/\s+/g, " ").toLowerCase();
              const nAssign = String(t.assignee_name || "").trim().replace(/\s+/g, " ").toLowerCase();
              const nLead = String(t.project_leader_name || "").trim().replace(/\s+/g, " ").toLowerCase();
              const matchAssignee = nAssign === nStaff || nLead === nStaff;
              if (!matchAssignee) return false;
            }
            if (wbsGateFilterMaster && String(t.gate_no) !== wbsGateFilterMaster) return false;
            if (wbsStatusFilterMaster) {
              if (["TODO", "IN_PROGRESS", "DONE", "BLOCKED"].includes(wbsStatusFilterMaster) && t.status !== wbsStatusFilterMaster) return false;
              if (["PASS", "OPTIMIZE", "FAIL"].includes(wbsStatusFilterMaster) && t.outcome_verdict !== wbsStatusFilterMaster) return false;
              if (wbsStatusFilterMaster === "HAS_RESULT" && !t.result_summary && (!Array.isArray(t.key_metrics_json) || t.key_metrics_json.length === 0)) return false;
            }
            if (searchQuery.trim() !== "") {
              const q = searchQuery.toLowerCase();
              const hay = `${t.code || ""} ${t.title || ""} ${t.project_code || ""} ${t.project_name || ""} ${t.assignee_name || ""} ${t.result_summary || ""}`.toLowerCase();
              if (!hay.includes(q)) return false;
            }
            return true;
          });

          const projectsToDisplay = filteredProjects.filter((p) => {
            if (wbsProjectFilter && wbsProjectFilter !== "ALL" && wbsProjectFilter !== "WITH_WBS") {
              return p.id === wbsProjectFilter;
            }
            if (wbsProjectFilter === "WITH_WBS") {
              return (tasksByProjectId.get(p.id)?.length ?? 0) > 0;
            }
            return true;
          });

          return (
            <div className="flex flex-col gap-3">
              {/* Quick Add WBS Task Bar across any project */}
              {canManage && (
                <form
                  className="grid gap-2 sm:grid-cols-12 items-end p-3 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/30 dark:bg-slate-900/60 text-xs"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const targetProjId = quickWbsProjectId || filteredProjects[0]?.id;
                    if (!targetProjId) return;
                    const targetProj = allProjects.find((p) => p.id === targetProjId);
                    masterSaveTaskMut.mutate({
                      project_id: targetProjId,
                      gate_no: Number(quickWbsGate),
                      title: quickWbsTitle,
                      assignee_name: quickWbsAssignee || targetProj?.leader_name || null,
                      due_date: quickWbsDue || null,
                      status: "TODO",
                      progress_pct: 0,
                    });
                  }}
                >
                  <div className="sm:col-span-3">
                    <Field label="Chọn Dự án cần giao việc WBS *">
                      <select
                        className={inputClass}
                        value={quickWbsProjectId || filteredProjects[0]?.id || ""}
                        onChange={(e) => setQuickWbsProjectId(e.target.value)}
                        required
                      >
                        {allProjects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.code} — {p.name} ({Number(p.wbs_done ?? 0)}/{Number(p.wbs_total ?? 0)} việc)
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="Cổng Gate">
                      <select className={inputClass} value={quickWbsGate} onChange={(e) => setQuickWbsGate(e.target.value)}>
                        <option value="0">G0 — Khảo sát &amp; TPP</option>
                        <option value="1">G1 — Khả thi (Feasibility)</option>
                        <option value="2">G2 — Tối ưu hóa</option>
                        <option value="3">G3 — Thẩm định (V&amp;V)</option>
                        <option value="4">G4 — Chuyển giao SX</option>
                      </select>
                    </Field>
                  </div>
                  <div className="sm:col-span-3">
                    <Field label="Nội dung công việc / Thực nghiệm WBS *">
                      <input
                        className={inputClass}
                        value={quickWbsTitle}
                        onChange={(e) => setQuickWbsTitle(e.target.value)}
                        placeholder="VD: Khảo sát nhiệt độ bắt cặp mồi 56–62°C..."
                        required
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="NCV phụ trách">
                      <input
                        list="master-rd-staff-datalist"
                        className={inputClass}
                        value={quickWbsAssignee}
                        onChange={(e) => setQuickWbsAssignee(e.target.value)}
                        placeholder="Chọn / nhập tên NCV..."
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-2 flex items-end gap-1.5">
                    <div className="flex-1">
                      <Field label="Hạn chót">
                        <input type="date" className={inputClass} value={quickWbsDue} onChange={(e) => setQuickWbsDue(e.target.value)} />
                      </Field>
                    </div>
                    <Button type="submit" disabled={masterSaveTaskMut.isPending} className="whitespace-nowrap">
                      + Giao việc
                    </Button>
                  </div>
                </form>
              )}

              {/* Filter & Grouping Toolbar for Master WBS View */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-700 dark:text-slate-200">🔎 Lọc WBS theo Dự án:</span>
                  <select className={`${inputClass} w-64`} value={wbsProjectFilter} onChange={(e) => setWbsProjectFilter(e.target.value)}>
                    <option value="WITH_WBS">
                      📂 Các dự án đã có công việc WBS ({allProjects.filter((p) => (tasksByProjectId.get(p.id)?.length ?? 0) > 0).length} dự án)
                    </option>
                    <option value="ALL">📁 Tất cả dự án (kể cả dự án chưa tạo WBS: {allProjects.length})</option>
                    {allProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} — {p.name} ({tasksByProjectId.get(p.id)?.length ?? 0} việc)
                      </option>
                    ))}
                  </select>
                  <select className={`${inputClass} w-40`} value={wbsGateFilterMaster} onChange={(e) => setWbsGateFilterMaster(e.target.value)}>
                    <option value="">Mọi cổng Gate (G0–G4)</option>
                    <option value="0">Cổng G0 (Khảo sát &amp; TPP)</option>
                    <option value="1">Cổng G1 (Feasibility)</option>
                    <option value="2">Cổng G2 (Optimization)</option>
                    <option value="3">Cổng G3 (Validation V&amp;V)</option>
                    <option value="4">Cổng G4 (Transfer SX)</option>
                  </select>
                  <select className={`${inputClass} w-48`} value={wbsStatusFilterMaster} onChange={(e) => setWbsStatusFilterMaster(e.target.value)}>
                    <option value="">Mọi trạng thái &amp; kết luận</option>
                    <option value="TODO">⏳ Chưa làm (TODO)</option>
                    <option value="IN_PROGRESS">🔄 Đang thực hiện</option>
                    <option value="DONE">✅ Đã hoàn thành (100%)</option>
                    <option value="BLOCKED">⚠️ Vướng mắc kỹ thuật</option>
                    <option value="PASS">🏆 Kết luận: ĐẠT (PASS)</option>
                    <option value="OPTIMIZE">🔧 Kết luận: CẦN TỐI ƯU</option>
                    <option value="FAIL">❌ Kết luận: KHÔNG ĐẠT</option>
                    <option value="HAS_RESULT">📊 Đã có báo cáo kết quả</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setWbsGroupByProject(true)}
                    className={`px-2.5 py-1 rounded-lg font-semibold cursor-pointer ${
                      wbsGroupByProject
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    🗂️ Nhóm theo từng Dự án
                  </button>
                  <button
                    type="button"
                    onClick={() => setWbsGroupByProject(false)}
                    className={`px-2.5 py-1 rounded-lg font-semibold cursor-pointer ${
                      !wbsGroupByProject
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    📋 Bảng phẳng toàn bộ việc ({filteredWbsTasks.length})
                  </button>
                </div>
              </div>

              {wbsGroupByProject ? (
                projectsToDisplay.length === 0 ? (
                  <div className="p-6 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-500 space-y-2">
                    <div>Hiện chưa có dự án nào có công việc WBS khớp bộ lọc (hoặc các dự án mới khởi tạo chưa được thêm việc WBS).</div>
                    <div className="flex justify-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setWbsProjectFilter("ALL")}
                      >
                        📁 Hiển thị tất cả {filteredProjects.length} dự án để giao việc WBS ngay
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {projectsToDisplay.map((proj) => {
                      const projTasks = filteredWbsTasks.filter((t) => t.project_id === proj.id);
                      const totalProjTasks = tasksByProjectId.get(proj.id)?.length ?? 0;
                      const doneProjTasks = (tasksByProjectId.get(proj.id) ?? []).filter((t) => t.status === "DONE").length;
                      return (
                        <div
                          key={proj.id}
                          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 overflow-hidden shadow-xs"
                        >
                          <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="px-2 py-0.5 rounded-md bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300 font-mono font-bold text-xs">
                                {proj.code}
                              </span>
                              <span className="font-bold text-sm text-slate-900 dark:text-white">{proj.name}</span>
                              <span className="px-2 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 text-[11px] font-mono font-semibold">
                                {proj.current_stage}
                              </span>
                              <span className="text-xs text-slate-600 dark:text-slate-400">
                                · 👤 Chủ nhiệm: <b>{proj.leader_name}</b>
                              </span>
                              <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950/80 text-indigo-800 dark:text-indigo-300 text-xs font-bold">
                                Tiến độ WBS: {doneProjTasks}/{totalProjTasks} việc hoàn thành
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {canManage && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setQuickWbsProjectId(proj.id);
                                    setQuickWbsAssignee(proj.leader_name || "");
                                    window.scrollTo({ top: 0, behavior: "smooth" });
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-xs font-semibold cursor-pointer hover:bg-indigo-100"
                                >
                                  + Thêm việc WBS cho {proj.code}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setSelected(proj.id)}
                                className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                              >
                                Mở hồ sơ dự án ↗
                              </button>
                            </div>
                          </div>

                          {projTasks.length === 0 ? (
                            <div className="p-3 text-xs text-slate-400 italic flex items-center justify-between">
                              <span>Dự án này hiện chưa có hạng mục công việc WBS nào (hoặc đang ẩn theo bộ lọc).</span>
                              {canManage && (
                                <button
                                  type="button"
                                  className="text-indigo-600 dark:text-indigo-400 font-semibold underline cursor-pointer not-italic"
                                  onClick={() => {
                                    setQuickWbsProjectId(proj.id);
                                    setQuickWbsAssignee(proj.leader_name || "");
                                  }}
                                >
                                  + Chọn dự án {proj.code} trên thanh Giao việc WBS ở trên để tạo việc đầu tiên
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="p-2">
                              <Table
                                head={[
                                  "Mã việc",
                                  "Cổng",
                                  "Nội dung công việc & Kết quả thực nghiệm",
                                  "Người phụ trách",
                                  "Sổ ELN",
                                  "Hạn chót",
                                  "Tiến độ & Kết luận",
                                  "Thao tác nhanh",
                                ]}
                              >
                                {projTasks.map((t) => {
                                  const metrics = Array.isArray(t.key_metrics_json) ? t.key_metrics_json : [];
                                  const hasResult = Boolean(t.result_summary || metrics.length > 0 || t.protocol_summary);
                                  return (
                                    <tr key={t.id} className="align-top">
                                      <td className="py-2 pr-2 font-mono font-semibold text-sky-700 dark:text-sky-400 whitespace-nowrap">{t.code}</td>
                                      <td className="py-2 pr-2 font-mono font-bold whitespace-nowrap">G{t.gate_no}</td>
                                      <td className="py-2 pr-3 min-w-72">
                                        <div className="font-semibold text-slate-900 dark:text-slate-100">{t.title}</div>
                                        {hasResult && (
                                          <div className="mt-1 p-2 rounded-lg border border-emerald-200/80 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-1 text-[11px]">
                                            {t.protocol_summary && (
                                              <div className="text-slate-600 dark:text-slate-400">
                                                <b>🧪 Protocol:</b> {t.protocol_summary}
                                              </div>
                                            )}
                                            {t.result_summary && (
                                              <div className="text-slate-800 dark:text-slate-200">
                                                <b className="text-emerald-800 dark:text-emerald-300">📊 Kết quả:</b> {t.result_summary}
                                              </div>
                                            )}
                                            {metrics.length > 0 && (
                                              <div className="flex flex-wrap gap-1 pt-0.5">
                                                {metrics.map((m: any, idx: number) => (
                                                  <span key={idx} className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-800 font-mono text-[10px]">
                                                    <b>{m.label}:</b> {m.value} {m.unit || ""}
                                                  </span>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </td>
                                      <td className="py-2 pr-2 whitespace-nowrap">
                                        <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-medium text-xs">
                                          👤 {t.assignee_name || proj.leader_name || "—"}
                                        </span>
                                      </td>
                                      <td className="py-2 pr-2 whitespace-nowrap">
                                        {t.experiment_code ? (
                                          <span className="px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/70 text-indigo-800 dark:text-indigo-300 font-mono font-bold text-[11px]">
                                            🧪 {t.experiment_code}
                                          </span>
                                        ) : canManage ? (
                                          <button
                                            type="button"
                                            className="px-2 py-0.5 rounded border border-indigo-300 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-[11px] font-semibold cursor-pointer hover:bg-indigo-50"
                                            onClick={() => masterCreateExpMut.mutate({ project_id: t.project_id, task_id: t.id })}
                                            disabled={masterCreateExpMut.isPending}
                                          >
                                            🧪 + Tạo ELN
                                          </button>
                                        ) : (
                                          <span className="text-slate-400">—</span>
                                        )}
                                      </td>
                                      <td className="py-2 pr-2 font-mono whitespace-nowrap">{fmtDate(t.due_date)}</td>
                                      <td className="py-2 pr-2 whitespace-nowrap">
                                        <div className="flex flex-col gap-1">
                                          <StatusBadge
                                            status={
                                              t.status === "DONE"
                                                ? "RELEASED"
                                                : t.status === "IN_PROGRESS"
                                                ? "PENDING_QC"
                                                : t.status === "BLOCKED"
                                                ? "REJECTED"
                                                : "QUARANTINE"
                                            }
                                            label={
                                              t.status === "DONE"
                                                ? `Hoàn thành (${t.progress_pct}%)`
                                                : t.status === "IN_PROGRESS"
                                                ? `Đang làm (${t.progress_pct}%)`
                                                : t.status === "BLOCKED"
                                                ? "Vướng mắc"
                                                : "Chưa làm"
                                            }
                                          />
                                          {t.outcome_verdict && t.outcome_verdict !== "PENDING" && (
                                            <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                                              {t.outcome_verdict === "PASS" ? "✅ ĐẠT" : t.outcome_verdict === "OPTIMIZE" ? "🔧 CẦN TỐI ƯU" : "❌ KHÔNG ĐẠT"}
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                      <td className="py-2 pr-2 whitespace-nowrap">
                                        {canManage && (
                                          <div className="flex items-center gap-1">
                                            <button
                                              type="button"
                                              className="px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-semibold text-[11px] cursor-pointer"
                                              onClick={() => openMasterResultDrawer(t)}
                                            >
                                              📝 {hasResult ? "Sửa KQ" : "Ghi KQ"}
                                            </button>
                                            {t.status !== "DONE" && (
                                              <button
                                                type="button"
                                                className="px-2 py-1 rounded bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 font-semibold text-[11px] cursor-pointer"
                                                onClick={() =>
                                                  masterSaveTaskMut.mutate({
                                                    project_id: t.project_id,
                                                    task_id: t.id,
                                                    gate_no: t.gate_no,
                                                    title: t.title,
                                                    assignee_name: t.assignee_name,
                                                    due_date: t.due_date ? String(t.due_date).slice(0, 10) : null,
                                                    status: "DONE",
                                                    progress_pct: 100,
                                                  })
                                                }
                                              >
                                                ✓ Xong
                                              </button>
                                            )}
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </Table>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )
              ) : filteredWbsTasks.length === 0 ? (
                <Empty>Chưa có hạng mục công việc WBS nào khớp bộ lọc.</Empty>
              ) : (
                <Table
                  head={[
                    "Dự án",
                    "Mã việc WBS",
                    "Cổng",
                    "Nội dung công việc & Kết quả thực nghiệm",
                    "Người phụ trách",
                    "Sổ ELN",
                    "Hạn chót",
                    "Tiến độ & Kết luận",
                    "Thao tác",
                  ]}
                >
                  {filteredWbsTasks.map((t) => {
                    const metrics = Array.isArray(t.key_metrics_json) ? t.key_metrics_json : [];
                    const hasResult = Boolean(t.result_summary || metrics.length > 0 || t.protocol_summary);
                    return (
                      <tr key={t.id} className="align-top">
                        <td className="py-2 pr-2">
                          <button
                            type="button"
                            onClick={() => setSelected(t.project_id)}
                            className="text-left group cursor-pointer"
                          >
                            <span className="px-2 py-0.5 rounded bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300 font-mono font-bold text-xs group-hover:underline">
                              {t.project_code}
                            </span>
                            <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 line-clamp-1 max-w-52 mt-0.5">
                              {t.project_name}
                            </div>
                          </button>
                        </td>
                        <td className="py-2 pr-2 font-mono font-semibold text-sky-700 dark:text-sky-400 whitespace-nowrap">{t.code}</td>
                        <td className="py-2 pr-2 font-mono font-bold whitespace-nowrap">G{t.gate_no}</td>
                        <td className="py-2 pr-3 min-w-72">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">{t.title}</div>
                          {hasResult && (
                            <div className="mt-1 p-2 rounded-lg border border-emerald-200/80 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/20 text-[11px] space-y-1">
                              {t.result_summary && (
                                <div>
                                  <b className="text-emerald-800 dark:text-emerald-300">📊 Kết quả:</b> {t.result_summary}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-2 whitespace-nowrap">👤 {t.assignee_name || t.project_leader_name || "—"}</td>
                        <td className="py-2 pr-2 whitespace-nowrap">
                          {t.experiment_code ? (
                            <span className="px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/70 text-indigo-800 dark:text-indigo-300 font-mono font-bold text-[11px]">
                              🧪 {t.experiment_code}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 pr-2 font-mono whitespace-nowrap">{fmtDate(t.due_date)}</td>
                        <td className="py-2 pr-2 whitespace-nowrap">
                          <StatusBadge
                            status={t.status === "DONE" ? "RELEASED" : t.status === "IN_PROGRESS" ? "PENDING_QC" : t.status === "BLOCKED" ? "REJECTED" : "QUARANTINE"}
                            label={t.status === "DONE" ? `Hoàn thành (${t.progress_pct}%)` : t.status === "IN_PROGRESS" ? `Đang làm (${t.progress_pct}%)` : t.status === "BLOCKED" ? "Vướng mắc" : "Chưa làm"}
                          />
                        </td>
                        <td className="py-2 pr-2 whitespace-nowrap">
                          {canManage && (
                            <button
                              type="button"
                              className="px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-semibold text-[11px] cursor-pointer"
                              onClick={() => openMasterResultDrawer(t)}
                            >
                              📝 {hasResult ? "Sửa KQ" : "Ghi KQ"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </Table>
              )}
            </div>
          );
        })()}

        {viewMode === "PROJECTS" && filteredProjects.length === 0 && <Empty>Chưa có dự án R&D nào khớp điều kiện lọc.</Empty>}
        {viewMode === "PROJECTS" && filteredProjects.length > 0 && (
          <Table
            head={[
              "Loại đề tài",
              "Lĩnh vực",
              "Giai đoạn (Stage)",
              "Tiến độ Gate",
              "Công việc WBS",
              "Số ELN",
              "Chủ nhiệm & Nhóm NCV phụ trách",
              "Trạng thái",
              ...(canEdit || canDelete ? ["Thao tác"] : []),
            ]}
          >
            {filteredProjects.map((r) => {
              const assignees: string[] = Array.isArray(r.assignees) ? r.assignees : [];
              const colCount = canEdit || canDelete ? 9 : 8;
              const projWbsTasks = (allWbsQuery.data?.tasks ?? []).filter((t) => t.project_id === r.id);
              const wbsTotal = projWbsTasks.length || Number(r.wbs_total ?? 0);
              const wbsDone = projWbsTasks.filter((t) => t.status === "DONE").length || Number(r.wbs_done ?? 0);
              const isWbsExpanded = Boolean(expandedWbsProjects[r.id]);
              return (
                <React.Fragment key={r.id}>
                  <tr
                    className="cursor-pointer bg-slate-50/70 dark:bg-slate-900/50 hover:bg-sky-50/60 dark:hover:bg-slate-800/70 border-t-2 border-slate-200/80 dark:border-slate-800"
                    onClick={() => setSelected(r.id)}
                  >
                    <td colSpan={colCount} className="pt-2.5 pb-1 px-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-md bg-sky-100 dark:bg-sky-950/80 text-sky-800 dark:text-sky-300 font-mono font-bold text-xs shrink-0">
                            {r.code}
                          </span>
                          <span className="font-bold text-sm text-slate-900 dark:text-white">
                            {r.name}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setExpandedWbsProjects((prev) => ({ ...prev, [r.id]: !prev[r.id] }));
                          }}
                          className={`px-2.5 py-0.5 rounded-lg text-[11px] font-bold cursor-pointer border transition-all ${
                            isWbsExpanded
                              ? "bg-indigo-600 text-white border-indigo-600"
                              : wbsTotal > 0
                              ? "bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100"
                              : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:border-indigo-400"
                          }`}
                        >
                          📋 {isWbsExpanded ? `Ẩn WBS (${wbsDone}/${wbsTotal}) ▲` : `Xem nhanh WBS (${wbsDone}/${wbsTotal} việc) ▼`}
                        </button>
                      </div>
                    </td>
                  </tr>
                  <tr
                    className="cursor-pointer hover:bg-sky-50/40 dark:hover:bg-slate-800/50"
                    onClick={() => setSelected(r.id)}
                  >
                    <td className="pb-2.5 pt-1 pl-2 pr-3 text-xs whitespace-nowrap">
                      {PROJ_TYPE_LABEL[r.project_type] ?? r.project_type}
                    </td>
                    <td className="pb-2.5 pt-1 pr-3 whitespace-nowrap">
                      {DOMAIN_LABEL[r.target_domain] ?? r.target_domain}
                      {r.ivd_class ? <span className="ml-1 text-[10px] font-mono text-slate-500">({r.ivd_class})</span> : null}
                    </td>
                    <td className="pb-2.5 pt-1 pr-3 font-mono font-semibold whitespace-nowrap">{r.current_stage}</td>
                    <td className="pb-2.5 pt-1 pr-3 font-mono whitespace-nowrap">{r.passed_gates}/{r.total_gates} cổng</td>
                    <td className="pb-2.5 pt-1 pr-3 whitespace-nowrap" onClick={(ev) => ev.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => setExpandedWbsProjects((prev) => ({ ...prev, [r.id]: !prev[r.id] }))}
                        className={`px-2 py-0.5 rounded-md font-mono text-xs font-bold cursor-pointer ${
                          wbsTotal > 0
                            ? "bg-indigo-100 dark:bg-indigo-950/80 text-indigo-800 dark:text-indigo-300 hover:bg-indigo-200"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200"
                        }`}
                      >
                        {wbsDone}/{wbsTotal} việc {isWbsExpanded ? "▲" : "▼"}
                      </button>
                    </td>
                    <td className="pb-2.5 pt-1 pr-3 font-mono whitespace-nowrap">{r.experiment_count}</td>
                    <td className="pb-2.5 pt-1 pr-3">
                      <div className="font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap">
                        👤 Chủ nhiệm: {r.leader_name}
                      </div>
                      {assignees.length > 0 && (
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          NCV tham gia WBS: {assignees.slice(0, 3).join(", ")}
                          {assignees.length > 3 ? ` (+${assignees.length - 3})` : ""}
                        </div>
                      )}
                    </td>
                    <td className="pb-2.5 pt-1 pr-3 whitespace-nowrap">
                      <StatusBadge status={PROJ_STATUS[r.status]?.[0] ?? "QUARANTINE"} label={PROJ_STATUS[r.status]?.[1] ?? r.status} />
                    </td>
                    {(canEdit || canDelete) && (
                      <td className="pb-2.5 pt-1 pr-2 whitespace-nowrap" onClick={(ev) => ev.stopPropagation()}>
                        <div className="flex items-center gap-1 whitespace-nowrap">
                          {canEdit && (
                            <Button
                              variant="ghost"
                              className="!px-2 !py-1 !text-[11px]"
                              onClick={() => openEditProj(r)}
                            >
                              ✏️ Sửa
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="ghost"
                              disabled={Boolean(r.has_immutable_handoff)}
                              title={
                                r.has_immutable_handoff
                                  ? "Không thể xóa dự án đã có hồ sơ chuyển giao công nghệ / phát hành phần mềm / dòng máy thương mại"
                                  : "Xóa dự án R&D"
                              }
                              className="!px-2 !py-1 !text-[11px] text-rose-600 dark:text-rose-400"
                              onClick={() => openDeleteProj(r)}
                            >
                              🗑️ Xóa
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                  {isWbsExpanded && (
                    <tr className="bg-indigo-50/30 dark:bg-indigo-950/20">
                      <td colSpan={colCount} className="p-3 border-b border-indigo-200/70 dark:border-indigo-900/50">
                        <div className="flex flex-col gap-2 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-bold text-indigo-900 dark:text-indigo-200">
                              📋 Danh sách Công việc WBS của Dự án <span className="font-mono">{r.code}</span> — {r.name} ({wbsDone}/{wbsTotal} hoàn thành)
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 underline cursor-pointer"
                                onClick={() => {
                                  setViewMode("WBS_BY_PROJECT");
                                  setWbsProjectFilter(r.id);
                                  setQuickWbsProjectId(r.id);
                                }}
                              >
                                Mở trong Bảng Tổng hợp WBS ↗
                              </button>
                            </div>
                          </div>

                          {canManage && (
                            <form
                              className="grid gap-2 sm:grid-cols-12 items-end p-2.5 rounded-xl border border-indigo-200 dark:border-indigo-800/70 bg-white dark:bg-slate-900"
                              onSubmit={(e) => {
                                e.preventDefault();
                                masterSaveTaskMut.mutate({
                                  project_id: r.id,
                                  gate_no: Number(quickWbsGate),
                                  title: quickWbsTitle,
                                  assignee_name: quickWbsAssignee || r.leader_name || null,
                                  due_date: quickWbsDue || null,
                                  status: "TODO",
                                  progress_pct: 0,
                                });
                              }}
                            >
                              <div className="sm:col-span-2">
                                <Field label="Cổng Gate">
                                  <select className={inputClass} value={quickWbsGate} onChange={(e) => setQuickWbsGate(e.target.value)}>
                                    <option value="0">G0 — Khảo sát</option>
                                    <option value="1">G1 — Khả thi</option>
                                    <option value="2">G2 — Tối ưu</option>
                                    <option value="3">G3 — Thẩm định</option>
                                    <option value="4">G4 — Chuyển giao</option>
                                  </select>
                                </Field>
                              </div>
                              <div className="sm:col-span-5">
                                <Field label={`Giao nhanh công việc WBS cho dự án ${r.code} *`}>
                                  <input
                                    className={inputClass}
                                    value={quickWbsTitle}
                                    onChange={(e) => setQuickWbsTitle(e.target.value)}
                                    placeholder="Nhập nội dung công việc / thực nghiệm cần thực hiện..."
                                    required
                                  />
                                </Field>
                              </div>
                              <div className="sm:col-span-2">
                                <Field label="NCV phụ trách">
                                  <input
                                    list="master-rd-staff-datalist"
                                    className={inputClass}
                                    value={quickWbsAssignee}
                                    onChange={(e) => setQuickWbsAssignee(e.target.value)}
                                    placeholder={r.leader_name || "Chọn NCV..."}
                                  />
                                </Field>
                              </div>
                              <div className="sm:col-span-3 flex items-end gap-1.5">
                                <div className="flex-1">
                                  <Field label="Hạn hoàn thành">
                                    <input type="date" className={inputClass} value={quickWbsDue} onChange={(e) => setQuickWbsDue(e.target.value)} />
                                  </Field>
                                </div>
                                <Button type="submit" disabled={masterSaveTaskMut.isPending}>
                                  + Giao việc
                                </Button>
                              </div>
                            </form>
                          )}

                          {projWbsTasks.length === 0 ? (
                            <div className="p-2.5 rounded-lg bg-white/70 dark:bg-slate-900/50 text-slate-500 italic">
                              Dự án {r.code} hiện chưa có công việc WBS nào. Bạn có thể nhập ngay vào ô phía trên để giao việc mà không cần mở chi tiết dự án.
                            </div>
                          ) : (
                            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2">
                              <Table
                                head={[
                                  "Mã việc",
                                  "Cổng",
                                  "Nội dung công việc & Kết quả",
                                  "Người phụ trách",
                                  "Sổ ELN",
                                  "Hạn chót",
                                  "Tiến độ",
                                  "Thao tác",
                                ]}
                              >
                                {projWbsTasks.map((t) => {
                                  const hasResult = Boolean(t.result_summary || (Array.isArray(t.key_metrics_json) && t.key_metrics_json.length > 0));
                                  return (
                                    <tr key={t.id} className="align-top">
                                      <td className="py-1.5 pr-2 font-mono font-semibold text-sky-700 dark:text-sky-400 whitespace-nowrap">{t.code}</td>
                                      <td className="py-1.5 pr-2 font-mono font-bold">G{t.gate_no}</td>
                                      <td className="py-1.5 pr-3">
                                        <div className="font-semibold text-slate-900 dark:text-slate-100">{t.title}</div>
                                        {t.result_summary && (
                                          <div className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-0.5">
                                            📊 <b>Kết quả:</b> {t.result_summary}
                                          </div>
                                        )}
                                      </td>
                                      <td className="py-1.5 pr-2 whitespace-nowrap">👤 {t.assignee_name || r.leader_name || "—"}</td>
                                      <td className="py-1.5 pr-2 whitespace-nowrap">
                                        {t.experiment_code ? (
                                          <span className="px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 font-mono font-bold text-[11px]">
                                            🧪 {t.experiment_code}
                                          </span>
                                        ) : canManage ? (
                                          <button
                                            type="button"
                                            className="px-1.5 py-0.5 rounded border border-indigo-300 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-[10px] font-semibold cursor-pointer"
                                            onClick={() => masterCreateExpMut.mutate({ project_id: r.id, task_id: t.id })}
                                          >
                                            + Tạo ELN
                                          </button>
                                        ) : (
                                          "—"
                                        )}
                                      </td>
                                      <td className="py-1.5 pr-2 font-mono whitespace-nowrap">{fmtDate(t.due_date)}</td>
                                      <td className="py-1.5 pr-2 whitespace-nowrap">
                                        <StatusBadge
                                          status={t.status === "DONE" ? "RELEASED" : t.status === "IN_PROGRESS" ? "PENDING_QC" : t.status === "BLOCKED" ? "REJECTED" : "QUARANTINE"}
                                          label={t.status === "DONE" ? `Hoàn thành (${t.progress_pct}%)` : t.status === "IN_PROGRESS" ? `Đang làm (${t.progress_pct}%)` : t.status === "BLOCKED" ? "Vướng mắc" : "Chưa làm"}
                                        />
                                      </td>
                                      <td className="py-1.5 pr-2 whitespace-nowrap">
                                        {canManage && (
                                          <div className="flex items-center gap-1">
                                            <button
                                              type="button"
                                              className="px-2 py-0.5 rounded bg-sky-600 text-white font-semibold text-[11px] cursor-pointer"
                                              onClick={() => openMasterResultDrawer(t)}
                                            >
                                              📝 {hasResult ? "Sửa KQ" : "Ghi KQ"}
                                            </button>
                                            {t.status !== "DONE" && (
                                              <button
                                                type="button"
                                                className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 font-semibold text-[11px] cursor-pointer"
                                                onClick={() =>
                                                  masterSaveTaskMut.mutate({
                                                    project_id: r.id,
                                                    task_id: t.id,
                                                    gate_no: t.gate_no,
                                                    title: t.title,
                                                    assignee_name: t.assignee_name,
                                                    due_date: t.due_date ? String(t.due_date).slice(0, 10) : null,
                                                    status: "DONE",
                                                    progress_pct: 100,
                                                  })
                                                }
                                              >
                                                ✓ Xong
                                              </button>
                                            )}
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </Table>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </Table>
        )}
      </Card>

      {/* Edit Project Modal */}
      {editingProj && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => setEditingProj(null)}
        >
          <form
            className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-xl space-y-3"
            onClick={(ev) => ev.stopPropagation()}
            onSubmit={(ev) => {
              ev.preventDefault();
              editMut.mutate();
            }}
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
              <div>
                <div className="text-sm font-bold text-slate-900 dark:text-white">
                  ✏️ Chỉnh sửa Dự án <span className="font-mono text-sky-700 dark:text-sky-400">{editingProj.code}</span>
                </div>
                <div className="text-[11px] text-slate-500">Mọi thay đổi được lưu nhật ký kiểm toán 21 CFR Part 11</div>
              </div>
              <Button type="button" variant="ghost" onClick={() => setEditingProj(null)}>Đóng</Button>
            </div>

            <ErrorNote error={editMut.error} />

            <div className="grid gap-3 sm:grid-cols-2 text-xs">
              <div className="sm:col-span-2">
                <Field label="Tên dự án R&D *">
                  <input className={inputClass} value={editName} onChange={(ev) => setEditName(ev.target.value)} required minLength={3} />
                </Field>
              </div>
              <Field label="Loại đề tài">
                <select className={inputClass} value={editType} onChange={(ev) => setEditType(ev.target.value)}>
                  {Object.entries(PROJ_TYPE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="Lĩnh vực sản phẩm đích">
                <select className={inputClass} value={editDomain} disabled={Boolean(domainLock)} onChange={(ev) => setEditDomain(ev.target.value)}>
                  {(isSoftwareMode
                    ? Object.entries(DOMAIN_LABEL)
                    : RD_DOMAIN_ENTRIES
                  ).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Phân loại IVD / RUO">
                <select className={inputClass} value={editIvd} onChange={(ev) => setEditIvd(ev.target.value)}>
                  {Object.entries(IVD_CLASS_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="Chủ nhiệm đề tài / Phụ trách chính">
                <select className={inputClass} value={editLeader} onChange={(ev) => setEditLeader(ev.target.value)}>
                  <option value="">-- Mặc định theo người tạo --</option>
                  {Array.from(new Set([...staffOptions, ...(editLeader ? [editLeader] : [])])).map((st) => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
              </Field>
              <Field label="Ngân sách Vật tư dự kiến (VNĐ)">
                <input type="number" min="0" step="100000" className={inputClass} value={editBudget} onChange={(ev) => setEditBudget(ev.target.value)} />
              </Field>
              <Field label="Trạng thái dự án">
                <select
                  className={inputClass}
                  value={editStatus}
                  disabled={Boolean(editingProj.has_immutable_handoff)}
                  onChange={(ev) => setEditStatus(ev.target.value)}
                >
                  {editingProj.has_immutable_handoff ? (
                    <option value={editingProj.status}>Đã chuyển giao SX (Khóa do đã có hồ sơ chuyển giao)</option>
                  ) : (
                    <>
                      <option value="ACTIVE">Đang triển khai (ACTIVE)</option>
                      <option value="ON_HOLD">Tạm dừng (ON_HOLD)</option>
                      <option value="KILLED">Đã dừng dự án (KILLED)</option>
                      {editingProj.status === "TRANSFERRED" && (
                        <option value="TRANSFERRED">Đã chuyển giao SX (TRANSFERRED)</option>
                      )}
                    </>
                  )}
                </select>
              </Field>
              <Field label="Ngày bắt đầu dự kiến">
                <input type="date" className={inputClass} value={editStart} onChange={(ev) => setEditStart(ev.target.value)} />
              </Field>
              <Field label="Dự kiến hoàn tất chuyển giao">
                <input type="date" className={inputClass} value={editEnd} onChange={(ev) => setEditEnd(ev.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Mục tiêu kỹ thuật & Phạm vi nghiên cứu">
                  <textarea className={inputClass} rows={2} value={editDesc} onChange={(ev) => setEditDesc(ev.target.value)} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Lý do chỉnh sửa (Tùy chọn, lưu vào Nhật ký kiểm toán)">
                  <input className={inputClass} value={editReason} onChange={(ev) => setEditReason(ev.target.value)} placeholder="VD: Cập nhật lại tên đề tài / mở lại dự án triển khai..." />
                </Field>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <Button type="button" variant="ghost" onClick={() => setEditingProj(null)}>Hủy</Button>
              <Button type="submit" disabled={editMut.isPending}>
                {editMut.isPending ? "Đang lưu..." : "Lưu thay đổi dự án"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Project Confirmation Modal */}
      {deletingProj && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4"
          onClick={() => setDeletingProj(null)}
        >
          <form
            className="w-full max-w-lg rounded-2xl border border-rose-200 dark:border-rose-900 bg-white dark:bg-slate-900 p-5 shadow-xl space-y-3"
            onClick={(ev) => ev.stopPropagation()}
            onSubmit={(ev) => {
              ev.preventDefault();
              deleteMut.mutate();
            }}
          >
            <div className="text-sm font-bold text-rose-700 dark:text-rose-400">
              🗑️ Xác nhận xóa Dự án R&D {deletingProj.code}
            </div>
            <div className="text-xs text-slate-700 dark:text-slate-200">
              Bạn đang yêu cầu xóa dự án <b>{deletingProj.code} — {deletingProj.name}</b>. Toàn bộ hồ sơ Stage-Gate, công việc WBS và cột mốc chưa chuyển giao của dự án này sẽ bị xóa khỏi danh sách và ghi vào Nhật ký kiểm toán.
            </div>
            {Number(deletingProj.experiment_count ?? 0) > 0 && (
              <div className="rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50/70 dark:bg-violet-950/30 p-2.5 text-xs text-violet-800 dark:text-violet-200">
                🧪 Dự án đang có <b>{deletingProj.experiment_count}</b> sổ thí nghiệm ELN liên kết. Các sổ ELN này sẽ tự động được giữ lại dưới dạng <b>Thử nghiệm độc lập</b> để bảo toàn dữ liệu ALCOA+ &amp; lịch sử vật tư kho.
              </div>
            )}
            <ErrorNote error={deleteMut.error} />
            <Field label="Lý do xóa dự án (Bắt buộc — tối thiểu 3 ký tự) *">
              <input
                className={inputClass}
                value={deleteReason}
                onChange={(ev) => setDeleteReason(ev.target.value)}
                placeholder="VD: Dự án tạo nháp để kiểm thử phần mềm..."
                required
                minLength={3}
                autoFocus
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setDeletingProj(null)}>Hủy</Button>
              <Button
                type="submit"
                variant="danger"
                disabled={deleteMut.isPending || deleteReason.trim().length < 3}
              >
                {deleteMut.isPending ? "Đang xóa..." : "Xác nhận Xóa dự án"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
